/* ============================================================
   systems/disasters.js — the disaster ROUND ENGINE + the roster.

   A director runs an escalating sequence of disasters, each a small
   data def with a lifecycle:  warn → active → (gap) → next, intensity
   ramping every round. The ORDER is seeded-shuffled per run (gentle
   opener, mega-hazards never back-to-back, the nuke always last) so
   no two matches play the same arc. Defs compose the shared kit
   (CBZ.fx) + the damage helpers (CBZ.surv) so the engine never needs
   to know what a "tsunami" is. Each def can also expose
   threat(x,z)/safeDir(x,z) so the bots flee intelligently (uphill from
   a flood, away from a funnel, off the lightning markers), plus a
   `tint` mood colour the universal warn telegraph dims the sky toward
   while the banner counts down.

   Roster (all 12): earthquake · lightning storm · tsunami ·
   flash flood · hurricane · wildfire · tornado · volcanic eruption ·
   blizzard · meteor shower · sinkholes · and a finale NUKE.

   NOTE — the TORNADO slot no longer implements a funnel. It delegates to
   systems/tornado.js (CBZ.tornado), the ONE vortex in the game, which the
   city mode uses too. That file owns the Rankine wind field, the EF scale,
   roof-first building damage through CBZ.structure, thrown vehicles priced
   through CBZ.detonate's `kinetic` row, and the funnel mesh. Ratchet:
   CBZ.tornadoAudit() — baseline 1, now 0.

   ------------------------------------------------------------------
   SHOW, DON'T TELL (2026-08-02 wave). OWNER: "the natural disasters
   really are awful rn."

   The four concurrent text channels this file used to drive — a giant
   pulsing #disasterBanner, a per-frame countdown line, seventeen
   fourth-wall flashHints ("THE VOLCANO IS WAKING — off the mountain,
   out of the ash!") and three flashToasts — were a MAP OF MISSING
   WORLD SIMULATION. Every one of them named an event that should
   simply HAPPEN in front of you. So each is deleted and replaced by a
   physical telegraph carrying the same information diegetically:

     quake      pre-shocks rattle the props before the ground goes
     storm      the WEATHER darkens and the rain thickens, then bolts
     flashflood the rain arrives first and the sea starts climbing
     tsunami    the drawdown itself (the real-world warning) + a crowd
                sprinting for high ground
     hurricane  the wind ramps from zero with debris streaming in it
     wildfire   one distant tree lights and its smoke stands up
     blizzard   visibility closes in; the snow thickens
     volcano    the ground rumbles, the crater glows, ash begins to fall
     meteor     streaks cross the sky before anything lands
     sinkhole   the ground CRACKS, then opens — a real hole with real
                depth that you FALL INTO
     nuke       sirens and a marked ground zero

   The ONLY sanctioned popup left is the killfeed (city/killfeed.js).

   AND IT CONVERGES ON THE ENGINE. Weather and water are engine pillars,
   not mode features, so this file no longer forks them:
     · rain/snow/wind/fog go through CBZ.weatherDrive (systems/weather.js)
       — one wind field, and wet asphalt + wet grip + lightning come free;
     · the sea rises through CBZ.waterSurgeSet (world/water_spec.js) and
       nothing else — there is no flood mesh in this file any more;
     · the swimmer is city/swim.js (sink-unless-you-swim, the 28 s breath
       meter, the drown through the kill bus), not a private paddle;
     · blasts are priced by CBZ.detonate's ordnance table;
     · building damage accumulates in ONE ledger instead of three binary
       hand-rolled collapses.

   Ratchet: CBZ.disasterAudit().

   Flags: CBZ.CONFIG.SURV_SHUFFLE (seeded per-run order, default on) ·
   CBZ.CONFIG.SURV_TELEGRAPH (warn tint/shake/cue, default on) ·
   SURV_SHOW_DONT_TELL · SURV_SHARED_WATER · SURV_SHARED_WEATHER ·
   SURV_SHARED_STRUCTURE (each a one-line revert to the old fork).

   THE STRATOVOLCANO (2026-08-03). The eruption is no longer one hazard with
   a see-through orange box on it. world/volcanofx.js owns four builders —
   opaque crusted lava, the pyroclastic density current, the lahar and the
   ash LOAD — all keyed on a position + a height field so a city-side
   eruption calls the same code. Its flags (VOLCANO_PYRO · VOLCANO_LAHAR ·
   VOLCANO_ASH_LOAD) are declared THERE, in the owning file. volcanofx.js is
   loaded on every page that loads this file; the old additive stream boxes
   were deleted 2026-09-28. Since 2026-10-14 the eruption's SEQUENCE (unrest,
   phreatic blast, Plinian column + umbrella, bombs, plume lightning, lava,
   collapse, lahar, waning) and its effects on houses, trees and cars live in
   world/eruption.js (CBZ.eruption); this file supplies the island and prices
   the consequences through its own ledgers and roster.

   NUKE_FINALE_REAL (declared here, default on) is the finale's LENS: the
   real cloud was always being drawn, it was being clipped at a 1 km far
   plane and hung in front of a 220 m fog wall. See nukeFrustum().

   THE SCARY WATER (2026-08-03). The tsunami's shared flags are declared in
   city/tsunami.js, not here, because there is ONE tsunami design and two
   places it happens and both read the same switch: TSU_FACE_V2 (the shared
   turbid bore face, CBZ.tsuFaceBuild in world/water_spec.js), TSU_DEBRIS (the
   entrained cars/trees/wall pieces that do the actual killing, through
   CBZ.tsuDebrisField — every one of them a REAL world object, nothing
   spawned), TSU_UNDERTOW (the drain's seaward pull, and the drowning that
   follows it out to sea) and TSU_SHOAL_V2 (2026-08-15: the front decelerates
   as it shoals — c = √(g·d) — stands at full towering height for a held beat
   at the beach, the slowest moment of the event, then CRASHES and the
   released bore charges the island) and TSU_PACE_V2 (2026-08-18: the same arc
   at normal speed — the event's clock, not its shape, was what made it drag).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const surv = () => CBZ.surv;
  if (CBZ.CONFIG.SURV_SHUFFLE == null) CBZ.CONFIG.SURV_SHUFFLE = true;
  if (CBZ.CONFIG.SURV_TELEGRAPH == null) CBZ.CONFIG.SURV_TELEGRAPH = true;

  // ---- THE WAVE'S FIVE FLAGS. Each is a genuine one-line revert. ----
  // SHOW DON'T TELL: the banner/hint/toast prose. ON (default) = silence; the
  // world does the talking. false restores the old narration, minus the
  // banner element itself, which is deleted (see survivalhud.js / hud.css).
  if (CBZ.CONFIG.SURV_SHOW_DONT_TELL == null) CBZ.CONFIG.SURV_SHOW_DONT_TELL = true;
  // The sea is CBZ.waterSurgeSet and nothing else. false = the old private
  // ocean writes + inundation sheet.
  if (CBZ.CONFIG.SURV_SHARED_WATER == null) CBZ.CONFIG.SURV_SHARED_WATER = true;
  // Rain/snow/wind/fog go through systems/weather.js. false = the old
  // per-disaster CBZ.fx.particleCloud rain and the hurricane's private wind.
  if (CBZ.CONFIG.SURV_SHARED_WEATHER == null) CBZ.CONFIG.SURV_SHARED_WEATHER = true;
  // ONE damage ledger for arena buildings + CBZ.detonate for blasts.
  if (CBZ.CONFIG.SURV_SHARED_STRUCTURE == null) CBZ.CONFIG.SURV_SHARED_STRUCTURE = true;

  /* ---- THE ONE DRAW EVERY DISASTER MAKES ---------------------------------
     Every def in this file gets its randomness from rnd(): where the lightning
     lands, which way the tsunami comes in, where the meteors fall, which
     buildings the quake takes, where the ground opens. It was `Math.random()`,
     which core/seed.js's determinism law forbids for exactly the reason that
     matters here — two machines running the same seed got two different
     matches, so no multiplayer design above this file could ever have worked,
     and no replay or bug report could be reproduced either.

     It is now a NAMED SEEDED STREAM, reseeded per run in start() from the world
     seed and the run counter, exactly like the arc order already was. Same
     match on every client, a different match every round. The Math.random
     fallback is for a page that somehow loads this file without core/seed.js;
     nothing in the shipped game takes it.

     What is NOT converted, deliberately: the per-particle jitter in
     world/volcanofx.js and systems/tornado.js. Those are runtime FX — smoke
     seats, ember lifetimes, debris spin — that no other client can see and no
     rule reads. Seeding them would cost draws in the shared sequence for
     nothing. The line is: if it moves a body, decides damage, or places a
     hazard, it comes from here. */
  let hazardRng = null;
  function rnd() { return hazardRng ? hazardRng() : Math.random(); }
  function reseedHazards(runNo) {
    hazardRng = CBZ.seedStream ? CBZ.seedStream("surv-hazards-" + runNo) : null;
  }
  reseedHazards(0);
  /* THE SHARED DRAW. systems/quake.js is a second file that decides who a
     disaster kills (facade shedding, gas fires, downed lines) and it had its
     own `Math.random`, with a header explaining that a runtime event does not
     need a seed. That was true right up until two machines had to agree on who
     died. Rather than give it a second stream to keep in step with this one,
     it draws from THIS one while a survival match is running: same sequence,
     same order, one place to reason about. */
  CBZ.survRnd = rnd;
  function camPos() { return CBZ.camera.position; }
  /* WHERE THE VIEWER IS. Alive, that is your body; dead, it is the spectator
     camera (systems/spectator.js) flying over the island. Anything that is a
     matter of what YOU see, hear or feel (the plume closing in, the roar of
     the front, the wind bending into the funnel, which survivor's voice you
     hear) follows the viewer, so a ghost watching the tsunami from a hill
     gets the hill's experience and not the corpse's on the beach. */
  function eyePos() { const P = CBZ.player; return P && P.pos && !P.dead ? P.pos : CBZ.camera.position; }
  function root() { return CBZ.surv.arena.root; }
  function floor(x, z) { return CBZ.surv.arena.groundHeightAt(x, z); }
  function scale(base, ctx) { return base * (0.85 + ctx.intensity); }
  function sound(name) { if (CBZ.sfx) CBZ.sfx(name); }
  function soundAt(name, x, z, opts) { if (CBZ.sfxAt) CBZ.sfxAt(name, x, z, opts); }

  /* ---- THE ONE REMAINING TEXT CHANNEL, AND IT IS OFF ----------------------
     Every former banner/flashHint/flashToast site now calls this. With
     SURV_SHOW_DONT_TELL on (the default) it returns immediately and the
     counters below stay at zero, which is exactly what CBZ.disasterAudit()
     measures: not "how many call sites are in the source" (a number a reader
     has to trust) but how many lines the game ACTUALLY spoke this run. */
  const said = { banners: 0, hints: 0, toasts: 0 };
  function narrate(kind, text, secs) {
    if (CBZ.CONFIG.SURV_SHOW_DONT_TELL !== false) return;
    if (kind === "toast") { said.toasts++; if (CBZ.flashToast) CBZ.flashToast(text); return; }
    if (kind === "banner") { said.banners++; return; }   // the element is gone
    said.hints++;
    if (CBZ.flashHint) CBZ.flashHint(text, secs || 2.4);
  }

  /* ---- WEATHER IS DRIVEN, NEVER FORKED -----------------------------------
     Four disasters used to each build a private CBZ.fx.particleCloud of rain
     or snow and the hurricane additionally invented its own wind vector. One
     call replaces all of it, and the whole downstream stack (wet asphalt via
     world/materials.js, wet grip via city/vehicles.js, night lightning, the
     sky's rain term) comes along because it was always keyed off
     CBZ.weather.intensity. Degrade-safe: with the flag off or weather.js
     absent this is inert and the caller's own env tint still runs. */
  function weather(spec, hold) {
    if (CBZ.CONFIG.SURV_SHARED_WEATHER === false || !CBZ.weatherDrive) return false;
    return CBZ.weatherDrive(spec, hold == null ? 0.6 : hold);
  }
  function weatherOff() { if (CBZ.weatherRelease) CBZ.weatherRelease(); }
  // THE wind vector — the same one the tornado biases off and the same one
  // world/materials.js's wet ramp reads. Never a private bearing again.
  const _wind = { x: 1, z: 0, speed: 0 };
  function windVec() {
    if (CBZ.weatherWind) return CBZ.weatherWind();
    return _wind;
  }

  /* ---- SEA LEVEL IS ONE NUMBER -------------------------------------------
     CBZ.waterSurgeSet is THE only way water rises in this game (see
     scrolls/claude/engine-systems.md). The arena's ocean plane follows it every
     frame (world/disaster_arena.js), so raising the surge floods the island:
     no rising mesh, no second flood sheet, and the swimmer, the buoyant
     corpses, the drifting debris and the submergence query all move together
     because they all read the same surface. */
  function surgeSet(m) {
    if (CBZ.CONFIG.SURV_SHARED_WATER === false || !CBZ.waterSurgeSet) return false;
    CBZ.waterSurgeSet(m);
    surgeWrites++;
    return true;
  }
  let surgeWrites = 0;
  function seaY(x, z) { return CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(x, z) : -0.8; }
  function floodDepth(x, z) { return CBZ.survFloodDepthAt ? CBZ.survFloodDepthAt(x, z) : -9; }
  // city/tsunami.js's easing, so both events in the game breathe the same way
  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  // the tail value of the flash flood recession limb, so the curve can be
  // normalised to reach dry exactly at the horn (see flashflood.active)
  const RECESS_END = Math.exp(-3.1);
  // the nearest hill that will still be DRY at `need` metres — the honest
  // answer to "where do I run", and what the bots' safeDir hands them
  function uphill(ctx, x, z, need) {
    const hills = ctx.arena.hills;
    let best = null, bd = 1e9;
    for (let i = 0; i < hills.length; i++) {
      const h = hills[i]; if (h.peak < need) continue;
      const d = Math.hypot(x - h.x, z - h.z);
      if (d < bd) { bd = d; best = h; }
    }
    if (!best) best = hills[0];
    const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }

  /* Publish the level flood on the ONE shared water-event descriptor
     (world/water_spec.js). Phase "flooded"/"drain" makes waterEventSample
     report wet everywhere, which is what carries the current to the swimmer
     (city/swim.js's applyCurrent) and to the floating debris — without any of
     them being told a flash flood exists. */
  function publishSheetFlood(ctx, phase, level, flow) {
    if (!CBZ.waterEventSet) return;
    const W = CBZ.survSeaWave ? CBZ.survSeaWave() : { amp: 1, chop: 1 };
    W.amp = 1.05 + Math.min(0.5, Math.abs(flow) * 0.2);
    W.chop = 1.2 + Math.min(0.9, Math.abs(flow) * 0.35);
    W.foam = 0.5;
    CBZ.waterEventSet({
      owner: "survival-flood", kind: "flood", phase: phase,
      cx: ctx.cx, cz: ctx.cz, dx: ctx.st.wx || 1, dz: ctx.st.wz || 0,
      frontS: -1e9, frontWet: -2, frontWidth: 20,
      level: (CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : level), waveAmp: W.amp, chopAmp: W.chop,
      flow: flow,
    });
  }

  /* EVERYONE IN THE WATER, and the player is deliberately NOT in this list.
     city/swim.js owns the player's waterline now — sink-unless-you-swim, the
     28 s breath tank, the drown through CBZ.surv.hurt into the killfeed — so
     the private buoyancy solve, the stamina-as-air and the duplicate stroke
     pose that used to live here are DELETED. Bots keep a cheap paddle (99 of
     them cannot each afford the full solve) and drown through the same cause
     strings, and corpses float and drift like any other body in water. */
  const _actFlow = { x: 0, z: 0, speed: 0 };
  const _faRun = {};
  function floodActors(dt, ctx, current, cause, dirx, dirz) {
    // the drift bearing: a tsunami's travel direction, a flash flood's storm
    // bearing — whichever the caller is running. Never a private default.
    const wx = dirx != null ? dirx : (ctx.st.wx != null ? ctx.st.wx : 1);
    const wz = dirz != null ? dirz : (ctx.st.wz != null ? ctx.st.wz : 0);
    const bots = CBZ.bots;
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (a.dead || (CBZ.body && CBZ.body.busy(a))) continue;
      const surface = seaY(a.pos.x, a.pos.z);
      // measured from where the body STANDS: a survivor on a first floor
      // (survivorbot.js publishes `_lift`, metres above the terrain) is only
      // in the water once it is over that floor, not over the street under it
      const depth = surface - floor(a.pos.x, a.pos.z) - (a._survSwim ? 0 : (a._lift || 0));
      if (depth <= 1.35) { a._survSwim = 0; continue; }
      if (!a._survSwim) { a._survSwim = 1; a._survPh = rnd() * 6.28; a._survLX = a.pos.x; a._survLZ = a.pos.z; }
      // paddle: halve the brain's step, ride the current: the tsunami run-up
      // field's own current on the land, else a routed flood's LOCAL current
      // (it goes where the channel goes), else the event's one bearing
      let cu = wx * current, cv = wz * current;
      const fl = CBZ.groundWaterFlowAt ? CBZ.groundWaterFlowAt(a.pos.x, a.pos.z, _actFlow) : null;
      if (fl && fl.speed > 0.05) { cu = fl.x; cv = fl.z; }
      const RF = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
      if (RF) { const r = RF.sample(a.pos.x, a.pos.z, _faRun); if (r.in > 0.5) { cu = r.u * 0.85; cv = r.v * 0.85; } }
      a.pos.x = a._survLX + (a.pos.x - a._survLX) * 0.55 + cu * dt;
      a.pos.z = a._survLZ + (a.pos.z - a._survLZ) * 0.55 + cv * dt;
      a._survLX = a.pos.x; a._survLZ = a.pos.z;
      a.pos.y = surface - 1.12 + Math.sin(CBZ.now * 0.004 + a._survPh) * 0.12;
      const ch = a.char;                        // flail (animChar at 23 already ran)
      if (ch && ch.parts) {
        const ph = CBZ.now * 0.011 + a._survPh;
        if (ch.parts.la) ch.parts.la.rotation.x = -1.4 + Math.sin(ph) * 0.9;
        if (ch.parts.ra) ch.parts.ra.rotation.x = -1.4 - Math.sin(ph) * 0.9;
        if (ch.parts.ll) ch.parts.ll.rotation.x = Math.sin(ph * 1.3) * 0.5;
        if (ch.parts.rl) ch.parts.rl.rotation.x = -Math.sin(ph * 1.3) * 0.5;
      }
      // a bot has no breath meter, so its drowning is a slow bleed rather than
      // the player's tank — but it is the SAME cause string, which is what the
      // killfeed reads
      surv().hurt(a, scale(7, ctx) * dt, { cause: cause });
    }
    // corpses ride the surface and drift out with the water
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.dead || b.culled || !b.group.parent) continue;
      const surface = seaY(b.pos.x, b.pos.z);
      if (surface - floor(b.pos.x, b.pos.z) > 1.4) {
        b.group.position.y = surface - 0.32 + Math.sin(CBZ.now * 0.003 + i) * 0.08;
        const fl = CBZ.groundWaterFlowAt ? CBZ.groundWaterFlowAt(b.group.position.x, b.group.position.z, _actFlow) : null;
        b.group.position.x += (fl && fl.speed > 0.05 ? fl.x : wx * current) * 0.55 * dt;
        b.group.position.z += (fl && fl.speed > 0.05 ? fl.z : wz * current) * 0.55 * dt;
      }
    }
  }

  function rmMesh(m) { if (!m) return; if (m.parent) m.parent.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); }

  // ---- PHYSICAL SHELTER: a roof over your head is a real place, not a circle
  //      on the map. Any walkable platform above head height covering (x,z) —
  //      building floors, roofs, tower landings — counts as "indoors". The
  //      blizzard's warmth, the hurricane's windbreak and the volcano's ash
  //      fallout all test THIS, so the answer to a disaster is running to the
  //      right KIND of place. SURV_PHYSICAL_SHELTER=false disables the checks.
  //      (There are no zones in this mode — just the disasters themselves.) ----
  if (CBZ.CONFIG.SURV_PHYSICAL_SHELTER == null) CBZ.CONFIG.SURV_PHYSICAL_SHELTER = true;
  function underRoof(x, z, y) {
    const plats = CBZ.platforms; if (!plats) return false;
    const head = y + 2.1;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (p.top > head && x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return true;
    }
    return false;
  }
  /* THE SUPERCELL LIGHT: k 0..1 from a normal sky to the sick green-grey of a
     tornadic storm's core light (sun almost gone, a green cast in the fill,
     the horizon pulled in). Shared by the tornado def's warn and active. */
  function tornadoSky(ctx, k) {
    const E = ctx.env;
    if (!E || !(k > 0)) return;
    E.sunInt = (E.sunInt != null ? E.sunInt : 1) * (1 - 0.7 * k);
    E.hemiInt = (E.hemiInt != null ? E.hemiInt : 0.8) * (1 - 0.4 * k);
    if (E.hemiColor != null) E.hemiColor = lerpHex(E.hemiColor, 0x8fa07a, 0.75 * k);
    if (E.sunColor != null) E.sunColor = lerpHex(E.sunColor, 0xb9c79a, 0.6 * k);
    if (E.fog != null) E.fog = lerpHex(E.fog, 0x56604a, 0.8 * k);
    if (E.fogFar != null) E.fogFar = E.fogFar * (1 - 0.45 * k);
  }
  function sheltered(a) {
    if (CBZ.CONFIG.SURV_PHYSICAL_SHELTER === false) return false;
    return underRoof(a.pos.x, a.pos.z, a.pos.y);
  }

  /* ============================================================
     ONE STRUCTURAL LEDGER (SURV_SHARED_STRUCTURE)

     The quake, the tsunami's smash and the eruption each used to call
     collapse() DIRECTLY: a building was intact or it was rubble, decided by a
     coin flip, with no state in between and no memory of the last disaster.
     city/structural.js is the real 7-state ledger, and where a struck footprint
     is a genuine city LOT this delegates to it verbatim — the shape
     systems/tornado.js's migration established. The island's towers are not
     city lots (they are the arena's own `fragile` records), so they keep a
     ledger HERE, but one ledger, with stages, shared by all three callers:

        0.00  intact
        0.35  glass out       — you can see it has been hit
        0.70  spalling, leaning, shedding debris
        1.00  COLLAPSE        — the terminal stage, and the ONLY caller of
                                collapse() left in the file

     What this buys beyond tidiness: a tower that survived the quake is now
     WEAKER when the wave arrives, which is the thing a binary flag can never
     express, and the difference between a set of disasters and a match.
     ============================================================ */
  const STAGE_GLASS = 0.35, STAGE_SPALL = 0.7;
  let structHits = 0, structPrivate = 0;
  // RATCHET (CBZ.disasterAudit().legacyFalls, pinned at 0). Every building the
  // island brings down must go through the shared collapse engine
  // (city/collapse.js). legacyFalls counts the ones that fell back to this
  // file's own sink-into-the-ground ticker instead, which happens only when
  // COLLAPSE_V2 is off — so a non-zero number in a normal run means the engine
  // stopped loading or stopped accepting the island's descriptor, and the
  // island has quietly gone back to having a second, worse collapse of its own.
  let engineFalls = 0, legacyFalls = 0;
  // the building's OWN wall material (the shell mesh wearing its wall colour,
  // else its biggest opaque mesh): what its debris and rubble are made of
  function wallMatOf(b) {
    if (b._wallMat !== undefined) return b._wallMat;
    let best = null, bestN = -1;
    if (b.group) b.group.traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.transparent || !o.material.color) return;
      const pa = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      const n = (pa ? pa.count : 0) + (b.color != null && o.material.color.getHex() === b.color ? 1e7 : 0);
      if (n > bestN) { bestN = n; best = o.material; }
    });
    b._wallMat = best || (CBZ.cmat ? CBZ.cmat(b.color != null ? b.color : 0x8b9097) : null);
    return b._wallMat;
  }
  function structureHit(b, amount, ctx, opts) {
    if (!b || b.fallen) return 0;
    opts = opts || {};
    if (CBZ.CONFIG.SURV_SHARED_STRUCTURE === false) {
      // legacy: the caller's own binary decision, counted so the ratchet sees it
      structPrivate++;
      if (opts.legacyCollapse) collapse(b, ctx);
      return 1;
    }
    // A REAL city lot under this footprint is city/structural.js's business,
    // never ours. Never true on the island today; the seam is what stops the
    // next author writing a second ledger when it is.
    if (CBZ.structure && CBZ.structure.hit && CBZ.structure.lotAt) {
      let lot = null;
      try { lot = CBZ.structure.lotAt(b.x, b.z, 0.8); } catch (e) { lot = null; }
      if (lot) {
        structHits++;
        CBZ.structure.hit(b.x, Math.min(b.h * 0.5, 8), b.z, amount * 6, {
          kind: opts.kind || "disaster", sudden: true, lot: lot,
          dirx: opts.dirx || 0, dirz: opts.dirz || 0,
        });
        return 1;
      }
    }
    structHits++;
    const before = b._dmg || 0;
    const now = b._dmg = Math.min(1.2, before + amount);
    // each threshold fires ONCE, so a caller hitting every frame is safe
    if (before < STAGE_GLASS && now >= STAGE_GLASS && CBZ.shatterGlass) {
      CBZ.shatterGlass(b.x, b.z, Math.max(b.w, b.d) * 0.95);
      soundAt("collapse", b.x, b.z);
    }
    if (before < STAGE_SPALL && now >= STAGE_SPALL) {
      // spalling: the facade starts shedding, and the whole frame takes a
      // permanent lean — a one-time write, so a damaged tower READS damaged
      // from across the island for the rest of the match
      b._lean = (rnd() - 0.5) * 0.06;
      if (b.group) { b.group.rotation.z = b._lean; b.group.rotation.x = b._lean * 0.5; }
      // AND IT LOOKS SPALLED. The lean alone is a 3-degree tilt nobody reads
      // at distance; the damage skin puts blown openings, exposed floor slabs,
      // a hanging panel and an apron of masonry on the pavement — the same
      // dressing a wounded city building gets, from the same file, so the two
      // modes cannot drift.
      if (CBZ.collapse && CBZ.collapse.skin) {
        try {
          CBZ.collapse.skin({
            root: root(), ox: b.x, oz: b.z, gy: b.gy || 0,
            w: b.w, d: b.d, h: b.h, storeys: b.storeys,
            FH: b.h / Math.max(1, b.storeys || 1),
            wall: b.color != null ? b.color : 0x8b9097, style: b.facadeStyle || null,
            key: "isl:" + Math.round(b.x) + "," + Math.round(b.z),
          }, 2, { nx: (opts && opts.dirx) || 1, nz: (opts && opts.dirz) || 0,
                  floor: Math.max(0, Math.round((b.storeys || 2) * 0.4)) });
        } catch (e) {}
      }
      // THE FACADE SHEDS ITS OWN SKIN: slabs of this building's wall, in its
      // own material, come off the face (not grey cubes out of its middle)
      // and break up as they fall onto the pavement below that face.
      const wm = wallMatOf(b);
      for (let i = 0; i < 7; i++) {
        const side = (rnd() * 4) | 0, t = rnd() - 0.5;
        const fxw = side < 2 ? t * b.w : (side === 2 ? -1 : 1) * (b.w / 2 + 0.3);
        const fzw = side < 2 ? (side === 0 ? -1 : 1) * (b.d / 2 + 0.3) : t * b.d;
        const sz = 0.5 + rnd() * 1.1;
        CBZ.fx.dropDebris({
          x: b.x + fxw, z: b.z + fzw,
          fromY: (b.gy || 0) + b.h * (0.4 + rnd() * 0.6), vy: -1 - rnd() * 2,
          size: sz, dims: side < 2 ? { w: sz * 1.3, h: sz, d: 0.28 } : { w: 0.28, h: sz, d: sz * 1.3 },
          material: wm, dmg: scale(14, ctx || { intensity: 0.4 }), keep: true,
        });
      }
      if (CBZ.shake && near({ x: b.x, z: b.z }, 45)) CBZ.shake(0.22);
    }
    if (now >= 1) collapse(b, ctx, opts);
    return b.fallen ? 3 : (now >= STAGE_SPALL ? 2 : (now >= STAGE_GLASS ? 1 : 0));
  }
  // the ANNULUS form — city/structural.js's sweep() shape: damage only what a
  // propagating front has newly reached this tick, so a nuke's wave flattens
  // the core and merely wounds the rim, in one pass with no per-lot bookkeeping.
  function structureSweepRing(ctx, x, z, r0, r1, amount) {
    const A = ctx.arena;
    for (let i = 0; i < A.fragile.length; i++) {
      const b = A.fragile[i];
      if (b.fallen) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < r0 || d >= r1) continue;
      structureHit(b, amount, ctx, { kind: "nuke", dirx: (b.x - x) / (d || 1), dirz: (b.z - z) / (d || 1) });
    }
  }
  // the DISC form, for anything that damages an area (a blast, a gust)
  function structureSweep(x, z, r, amount, ctx, opts) {
    const A = CBZ.surv.arena;
    for (let i = 0; i < A.fragile.length; i++) {
      const b = A.fragile[i];
      if (b.fallen) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > r) continue;
      structureHit(b, amount * (1 - d / r), ctx, opts);
    }
  }

  /* ---- THE FORESHOCK YOU CAN SEE -----------------------------------------
     A camera shake alone is ambiguous — it could be anything. What tells you
     the GROUND is moving is loose objects moving with it while the horizon
     stays put. So the parked cars buzz on their springs and the canopies
     shiver, keyed off each object's own position so the whole street does not
     twitch in unison. Purely visual and self-restoring: the offset is a sine
     about the object's base, so amp 0 puts everything exactly back. */
  // noCars: the quake's own core moves the island's cars on the real ground
  // motion (systems/quake.js), so its rattle leaves them alone
  function rattleProps(ctx, amp, noCars) {
    if (amp <= 0.001) return;
    const A = ctx.arena, t = CBZ.now * 0.03;
    const cars = noCars ? null : A.cars;
    if (cars) for (let i = 0; i < cars.length; i++) {
      const c = cars[i]; if (c.flung || !c.group) continue;
      const ph = c.x * 0.7 + c.z * 0.31;
      c.group.position.x = c.x + Math.sin(t * 2.3 + ph) * amp;
      c.group.position.z = c.z + Math.cos(t * 1.9 + ph * 1.7) * amp;
      c.group.rotation.z = Math.sin(t * 3.1 + ph) * amp * 0.12;
    }
    const tr = A.flammable;
    if (tr) for (let i = 0; i < tr.length; i += 2) {
      const f = tr[i].foliage; if (!f) continue;
      f.rotation.z = Math.sin(t * 2.7 + tr[i].x * 0.4) * amp * 0.5;
      f.rotation.x = Math.cos(t * 2.2 + tr[i].z * 0.4) * amp * 0.5;
    }
  }

  /* ============================================================
     ONE BLAST BUS (SURV_SHARED_STRUCTURE)

     Five sites — the meteor impact, the nuke, a lava bomb, a lightning strike
     and the wave's landfall — each re-typed a fireball, a flash, a shake, a
     sound cue and a private `hurtRadius(..., 1e6)`. systems/impactbus.js
     already owns an ordnance table with `meteor`, `nuke` and `kinetic` rows
     priced by THE KINETIC LAW (mass x speed), plus every FX composer in the
     game — including city/nukefx.js's real mushroom cloud, which is what a
     nuclear finale should look like instead of a cylinder with a sphere on it.

     `noDamage: true` IS LOAD-BEARING AND DELIBERATE. The bus's damage rosters
     are CITY-scoped: its nuclear wave compiles CBZ.cityPeds, CBZ.cityCars and
     CBZ.structure.radialTargets, so a full-damage nuke fired on the island at
     z=600 would reach into the mainland and flatten buildings the player is
     not even looking at. So the bus owns the DRAW, the shake, the sfx and the
     kinetic pricing; this mode owns its own actor roster and its own ledger.
     ============================================================ */
  let detonateAdopted = 0, blastLegacy = 0;
  function survBlast(kind, x, z, o) {
    o = o || {};
    const y = o.y != null ? o.y : floor(x, z) + (o.up || 1.2);
    let priced = false;
    /* A CALLER WITH ITS OWN RENDERER (`o.draw` — the lightning bolt) MUST NOT
       DEGRADE TO A FIREBALL, because that fireball is the exact bug it was
       written to delete. CBZ.detonate answers an unknown kind by drawing a
       generic cityExplosion, and IMPACT_BUS=false makes every kind draw one —
       so a load-order slip or a master revert would have quietly put the RPG
       back. Such a caller therefore only reaches for the bus when the bus can
       actually route its row, and its own draw is the fallback. */
    const busRoutes = !o.draw || !!(
      CBZ.impact && CBZ.impact.row && CBZ.impact.row(kind));
    if (busRoutes && CBZ.CONFIG.SURV_SHARED_STRUCTURE !== false && CBZ.detonate) {
      try {
        CBZ.detonate(x, y, z, kind, {
          noDamage: true, scale: o.scale, mass: o.mass, speed: o.speed,
          dirx: o.dirx, dirz: o.dirz, quiet: o.quiet,
          // `fx` is an opaque bag for the COMPOSER, not for the bus: the bus's
          // own option list is a fixed whitelist, and a caller whose composer
          // needs to know something the table cannot express (here: how much of
          // this strike reaches the turf) had nowhere to put it.
          fx: o.fx,
        });
        detonateAdopted++; priced = true;
      } catch (e) { priced = false; }
    }
    if (!priced) {
      // DEGRADE-SAFE: the bus absent (or a third-party composer throwing) must
      // never leave a disaster with no visible explosion. `fxR` is the visual
      // size for callers whose lethal radius is 0 because they price their own
      // wave — the nuke, mainly, whose fallback must not be a 4 m puff.
      blastLegacy++;
      if (o.draw) { try { o.draw(x, y, z); } catch (e) {} }
      else CBZ.fx.blast(x, z, { maxR: (o.fxR || o.r) + 4, color: o.color || 0xffcaa0, shake: 0.6, flash: o.flash != null ? o.flash : 0.3, sfx: o.sfx || "shoot_shotgun" });
    }
    // the mode's own roster, priced by the mode's own model
    if (o.r > 0) surv().hurtRadius(x, z, o.r, o.dmg != null ? o.dmg : 1e6, {
      cause: o.cause, knockback: o.knockback || 9, fling: o.fling || 4,
    });
    if (o.struct > 0) structureSweep(x, z, o.structR || o.r * 1.6, o.struct, o.ctx, { kind: kind, dirx: o.dirx, dirz: o.dirz });
  }

  // ============================================================
  // THE ROSTER
  // ============================================================
  const DEFS = {

    // ---- EARTHQUAKE. The def is built by QUAKE_DEF(), in its own block
    //      further down ("THE SUBDUCTION-ZONE EARTHQUAKE") — it is the one
    //      disaster whose kill model, survival behaviour, secondary hazards
    //      and CHAIN into the other two are large enough to read as a system
    //      rather than a data row, and most of that system now lives in the
    //      shared systems/quake.js so a city can run it too. ----
    quake: QUAKE_DEF(),

    // ---- LIGHTNING STORM: telegraphed strikes that instakill ----
    storm: {
      name: "LIGHTNING STORM", emoji: "", warnSecs: 4, gap: 6, cause: "struck by lightning", tint: 0x3a4150,
      /* A STORM HAS A SIZE, AND THE SIZE IS A PLACE (2026-08-29).
         Every occurrence used to be the same storm: 16 s, rain pinned at 0.92,
         a bolt a second, and 70% of strikes teleported to within 10 m of an
         actor whatever the sky was doing. Now each occurrence ROLLS A
         MAGNITUDE off the seeded stream (the round's escalating intensity
         BIASES the roll, it does not replace it) and the strikes belong to a
         CELL — a real patch of sky that spawns upwind and tracks past on the
         storm wind. The roll decides the cell's closest approach, so a small
         storm is a cell passing on the horizon: a handful of attenuated bolts
         over the sea, thunder arriving seconds late and rolling, the island
         itself under a lighter sky. A big one parks the cell overhead and puts
         strikes in the street every few seconds under a closed 200 m sky.
         Duration, darkness, rain, strike rate, bolt energy and the damage
         footprint all read the same number. No flag: git is the undo. */
      get activeSecs() { return Math.round(12 + 16 * (this._magF == null ? 0.6 : this._magF)); },
      warn(ctx) {
        narrate("hint", "Storm rolling in, keep moving!", 2.4);
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        /* the magnitude roll. `stormMagNext` is a one-shot debug/storyboard
           override (tools/visual-presets/lightning-strike.mjs uses it to
           photograph a small and a big storm on one page); the stream draw
           happens regardless, so the shared seeded sequence never shifts. */
        const u = rnd();
        const ov = CBZ.disasters ? CBZ.disasters.stormMagNext : null;
        if (CBZ.disasters) CBZ.disasters.stormMagNext = null;
        this._magF = ov != null ? Math.max(0, Math.min(1, +ov))
          : Math.max(0.04, Math.min(1, 0.9 * u + 0.04 + 0.5 * (ctx.intensity - 0.2)));
        ctx.st.mag = this._magF;
        // THE CELL'S TRACK: the magnitude made geographic. Closest approach
        // runs from overhead (mag 1) to nearly two radii offshore (mag 0);
        // the cell starts upwind along that line and crosses over the event.
        const ap = ctx.R * 2.0 * Math.pow(1 - this._magF, 1.7);
        const total = (this.warnSecs || 4) + this.activeSecs;
        const spd = (2.4 * ctx.R) / total;
        const px = -ctx.st.wz, pz = ctx.st.wx;
        const side = rnd() < 0.5 ? -1 : 1;
        ctx.st.cellX = ctx.cx + px * ap * side - ctx.st.wx * spd * total * 0.5;
        ctx.st.cellZ = ctx.cz + pz * ap * side - ctx.st.wz * spd * total * 0.5;
        ctx.st.cellVx = ctx.st.wx * spd; ctx.st.cellVz = ctx.st.wz * spd;
        // the first thunder comes FROM the cell, however far away that is
        soundAt("thunder", ctx.st.cellX, ctx.st.cellZ);
      },
      // how much the cell owns the sky over the island right now, 0..1 —
      // every ambience number below reads this, so a distant cell is a bruise
      // on the horizon instead of a filter over your street
      _mood(ctx) {
        const d = Math.hypot((ctx.st.cellX != null ? ctx.st.cellX : ctx.cx) - ctx.cx,
          (ctx.st.cellZ != null ? ctx.st.cellZ : ctx.cz) - ctx.cz);
        const near = Math.max(0, 1 - d / (2.2 * ctx.R));
        return near * (0.4 + 0.6 * (ctx.st.mag == null ? 0.6 : ctx.st.mag));
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        ctx.st.cellX += ctx.st.cellVx * dt; ctx.st.cellZ += ctx.st.cellVz * dt;
        const m = Math.max(0.1, this._mood(ctx));
        weather({ rain: k * (0.08 + 0.72 * m), wind: 3 + k * 7 * (0.4 + 0.6 * m), windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.45 * m, fogColor: 0x3a4150 });
        ctx.env.sunInt *= 1 - (0.08 + 0.3 * m) * k;
        if (rnd() < dt * (0.3 + k) * (0.4 + 0.6 * (ctx.st.mag == null ? 0.6 : ctx.st.mag))) soundAt("thunder", ctx.st.cellX, ctx.st.cellZ);
      },
      start(ctx) {
        ctx.st.pending = [];
        ctx.st.cd = 1.4 - 0.9 * (ctx.st.mag == null ? 0.6 : ctx.st.mag);
      },
      active(dt, ctx) {
        const mag = ctx.st.mag == null ? 0.6 : ctx.st.mag;
        ctx.st.cellX += ctx.st.cellVx * dt; ctx.st.cellZ += ctx.st.cellVz * dt;
        const mood = this._mood(ctx);
        // A DISTANT CELL DOES NOT DARKEN YOUR STREET. Fog, sun, rain and wind
        // follow how much of the cell is actually overhead.
        ctx.env.fog = 0x3a4150;
        ctx.env.fogNear = 200 - 172 * mood; ctx.env.fogFar = 540 - 340 * mood;
        ctx.env.sunInt = 0.9 - 0.5 * mood; ctx.env.hemiInt = 0.78 - 0.28 * mood; ctx.env.hemiColor = 0x8794ad;
        weather({ rain: 0.08 + 0.84 * mood, wind: 3 + 7 * mood, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.5 * mood, fogColor: 0x3a4150, lightning: 0.25 + 0.75 * mood });
        /* IN-CLOUD FLICKER. Most of a real storm's flashes never reach the
           ground: a soft strobe off the cell with no bolt under it, and the
           rumble arriving from the cell at the speed of sound. This is what a
           small storm mostly IS — sheet lightning over the sea. */
        const cp = camPos();
        const dCam = Math.hypot(ctx.st.cellX - cp.x, ctx.st.cellZ - cp.z);
        if (rnd() < dt * (0.35 + 0.7 * mag)) {
          const soft = 0.07 + 0.12 * rnd();
          if (CBZ.weatherStrobe) CBZ.weatherStrobe(soft * Math.max(0.35, 1 - dCam / 900), 0.08 + rnd() * 0.07);
          if (CBZ.sfx) { try { CBZ.sfx("thunder", { delay: Math.min(7, dCam / 343), dist: dCam, volume: 0.4 }); } catch (e) {} }
        }
        // schedule strikes: they belong to the cell, and only a cell with
        // people under it aims at people
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = (0.45 + 3.6 * Math.pow(1 - mag, 2)) * (1.1 - 0.35 * Math.min(1, ctx.prog)) * (0.7 + 0.6 * rnd());
          const cr = ctx.R * (0.5 + 0.4 * mag);
          let tx, tz; const acts = surv().actors();
          const near = [];
          for (let i = 0; i < acts.length; i++) { const a2 = acts[i]; if (!a2.dead && Math.hypot(a2.pos.x - ctx.st.cellX, a2.pos.z - ctx.st.cellZ) < cr) near.push(a2); }
          /* THE SKY HUNTS THE CARELESS: a player out in the open under the
             cell draws a share of the aimed strikes (a near miss 5-11 m off,
             never a guaranteed hit), so standing in a field during a storm is
             a decision you feel; under a roof you only hear it. */
          const P = CBZ.player, pExposed = !P.dead && !underRoof(P.pos.x, P.pos.z, P.pos.y) && near.some((q) => q.isPlayer);
          if (pExposed && rnd() < 0.22 + 0.2 * mag) { const a3 = rnd() * 6.28, d3 = 5 + rnd() * 6; tx = P.pos.x + Math.cos(a3) * d3; tz = P.pos.z + Math.sin(a3) * d3; }
          else if (near.length && rnd() < 0.3 + 0.45 * mag) { const a2 = near[(rnd() * near.length) | 0]; tx = a2.pos.x + (rnd() - 0.5) * 12; tz = a2.pos.z + (rnd() - 0.5) * 12; }
          else {
            const ang = rnd() * 6.2832, rr = cr * Math.sqrt(rnd());
            tx = ctx.st.cellX + Math.cos(ang) * rr; tz = ctx.st.cellZ + Math.sin(ang) * rr;
            // sea strikes are the distant storm's whole look, but stay inside
            // the world the arena can answer height questions about
            const dc = Math.hypot(tx - ctx.cx, tz - ctx.cz);
            if (dc > ctx.R * 2.4) { tx = ctx.cx + (tx - ctx.cx) * (ctx.R * 2.4) / dc; tz = ctx.cz + (tz - ctx.cz) * (ctx.R * 2.4) / dc; }
          }
          // BOLT ENERGY: a big cell throws hotter strokes — and once in a
          // great while any storm throws a superbolt
          let e = 0.7 + 0.7 * mag + rnd() * 0.3;
          if (rnd() < 0.04) e += 0.9;
          ctx.st.e = e;
          // WHAT IT WILL ACTUALLY HIT — resolved now, not at the moment of the
          // strike, so the leader spends its whole descent pointing at the real
          // termination and the bolt lands where the warning said it would.
          const at = attachPoint(tx, tz, ctx);
          if (at) { tx = at.x; tz = at.z; }
          /* THE TELEGRAPH IS THE BOLT'S OWN APPROACH, not a decal (2026-08-13).
             This was CBZ.fx.groundMarker(tx, tz, 4.5, 0x9fd0ff) — a pulsing
             blue disc painted on the ground where the strike would land, which
             nothing in the world casts and which announces the bolt from the
             one place you cannot see the sky. It is now the STEPPED LEADER:
             the dim branching channel that really does grope down out of the
             cloud before a stroke, seeded off these coordinates so the return
             stroke runs up the same path. Same handle, so the pending list
             below — and the threat model and bot scatter that read it — did
             not change by a line. systems/lightningfx.js is loaded on every
             page that loads this file. */
          const tele = CBZ.lightningLeader(tx, tz);
          ctx.st.pending.push({ x: tx, z: tz, t: 0.95, m: tele, at: at });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 0.95);
          if (p.t <= 0) { strike(p.x, p.z, ctx, p.at); p.m.dispose(); ctx.st.pending.splice(i, 1); }
        }
      },
      // the renderer pools its own meshes and hands them back through its reset
      end(ctx) { weatherOff(); (ctx.st.pending || []).forEach((p) => p.m.dispose()); CBZ.lightningFxReset(); },
      threat(x, z, ctx) { let t = 0.1; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < 7) t = Math.max(t, 0.95 * (1 - d / 7)); }); return t; },
      // in the sirens the smart move is OFF the exposed high ground and out of
      // the open, so the crowd visibly scatters toward the town before the
      // first bolt lands
      warnThreat(x, z, ctx) { return Math.min(0.75, 0.2 + floor(x, z) * 0.05); },
      /* PART OF THE CROWD RUNS FOR THE TREES, AND THAT IS WHAT KILLS THEM.

         Side flash is 30-35% of real lightning casualties and the textbook
         sentence explaining why is always the same: "most often, side flash
         victims have taken shelter under a tree to avoid the rain." It is the
         single most human thing about the whole phenomenon — the shelter that
         feels safest is the one that is about to become the highest point in
         reach of a leader — and without it `conduct()`'s side flash and its
         body-to-body chain almost never fire, because nobody is ever standing
         close enough to the thing that gets hit.

         So SOME trees are shelter, not some bots: the hash is on the TREE's own
         coordinates, which makes the choice stable as a bot walks (a rule keyed
         to the bot's position flips underneath it and it oscillates) and makes
         the crowd CLUSTER — several people under one canopy, which is both the
         real photograph and the reason one strike takes a group.

         The rest still do the sensible thing and get off the high ground. */
      warnSafeDir(x, z, ctx) {
        const tr = ctx.arena.flammable || [];
        let best = null, bd = 1e9;
        for (let i = 0; i < tr.length; i++) {
          const t = tr[i];
          if (t.burnt) continue;
          /* WHICH TREES PEOPLE SHELTER UNDER — decided once per tree, cached on
             it, because this runs per bot per frame through the warn phase.

             Two conditions, and the second one is what makes the whole feature
             work. A tree in the shadow of a tower is not where anybody shelters
             (there is a doorway right there) and it is not what a leader
             attaches to either — `attachPoint`'s cone hands a 30 m building
             every strike within reach of it. The trees that matter are the ones
             standing in the OPEN: they are where people go, and they are the
             high point for fifty metres, so they are what gets hit. Those two
             facts are the same fact, which is exactly why sheltering under a
             tree in a field is the most dangerous thing you can do in a
             thunderstorm. */
          if (t._shelterTree == null) {
            const key = ((Math.round(t.x * 4) * 73856093) ^ (Math.round(t.z * 4) * 19349663)) >>> 0;
            let open = key % 100 < 62;
            if (open) {
              const fr = ctx.arena.fragile || [];
              for (let k = 0; k < fr.length; k++) {
                if (Math.hypot(fr[k].x - t.x, fr[k].z - t.z) < 20) { open = false; break; }
              }
            }
            t._shelterTree = open;
          }
          if (!t._shelterTree) continue;
          const d = Math.hypot(t.x - x, t.z - z);
          if (d < bd) { bd = d; best = t; }
        }
        if (best && bd < 22 && bd > 1.1) return { x: (best.x - x) / bd, z: (best.z - z) / bd };
        const h = ctx.arena.hills[0], dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1;
        return { x: dx / d, z: dz / d };
      },
      /* SHELTER IS A DECISION, NOT A POSITION. Someone who has got in under a
         canopy out of a downpour does not sprint back out into it because the
         sky flickered — they stay, because the tree is where it is dry and
         because standing under it FEELS like the safe move. That belief is the
         mechanism: it is why side flash is a third of all lightning casualties
         and why the safety literature spends its whole first paragraph telling
         people not to do it. Without this the crowd shelters during the warn,
         reads the leader, scatters, and the bolt hits an empty tree.

         Everyone NOT under a tree still scatters from the pending strikes. */
      safeDir(x, z, ctx) {
        const tr = ctx.arena.flammable || [];
        for (let i = 0; i < tr.length; i++) {
          const t = tr[i];
          if (!t.burnt && Math.hypot(t.x - x, t.z - z) < 2.6) return null;
        }
        let bx = 0, bz = 0;
        (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 8 && d > 0.1) { bx += dx / d; bz += dz / d; } });
        return (bx || bz) ? { x: bx, z: bz } : null;
      },
    },

    // ---- TSUNAMI: assigned right after this roster (DEFS.flood, below). ----

    /* ---- FLASH FLOOD: ROUTED DOWN THE ISLAND'S OWN DRAINAGE (2026-10-14) ----
       OWNER: "rain makes flash flood which is gang city water slowly filling
       the ground." A flash flood is what a cloudburst over high ground does:
       it falls faster than the ground can take it, the slopes shed it into
       the channels, and it arrives downstream as a front with almost no
       warning. systems/flashflood.js owns the water: a 2-D shallow-water solve
       over the island's terrain (rain on the storm cell + the rivers' inflow
       from the catchment), installed as THE ground-water field, so swimming,
       drowning, the knock-down physics and the bots all stand in it. Cars,
       debris, bridges, manholes and the silt left behind live there too.

       This def only does what is the weather's and the sea's: the sky opens
       (CBZ.weatherDrive), the coast rises a little (waterSurgeSet: a coastal
       island in a storm really gets both) and the sea takes the mud. The old
       straight-line front (a plane swept across the island at 9.5 m/s
       whatever the ground did) and the fling-the-car-at-60-cm are deleted. */
    flashflood: {
      name: "FLASH FLOOD", emoji: "", warnSecs: 8, activeSecs: 34, gap: 6, cause: "swept away by the flash flood", tint: 0x59636b,
      // THE RAIN ARRIVES FIRST, over the hills. The warning is the honest
      // one: the sky goes, the channels start to run brown, and the roar
      // upstream is the only sign of the wall before it arrives.
      warn(ctx) {
        narrate("hint", "FLASH FLOOD, water rising, get HIGH!", 3); sound("water");
        const FF = CBZ.flashflood;
        ctx.st.ff = false;
        ctx.st.wx = 1; ctx.st.wz = 0;
        if (FF) {
          try {
            const W = FF.islandWorld(ctx);
            ctx.st.ff = FF.start(W, { warnSecs: this.warnSecs, activeSecs: this.activeSecs,
              // the storm's water budget grows with the round
              volume: null, volumeScale: (0.85 + ctx.intensity) / 1.35 });
            // the wind runs from the storm cell out over the island
            const st = FF.storm();
            if (st) { const dx = ctx.cx - st.x, dz = ctx.cz - st.z, d = Math.hypot(dx, dz); if (d > 1) { ctx.st.wx = dx / d; ctx.st.wz = dz / d; } }
          } catch (e) { console.error("[flashflood start]", e); ctx.st.ff = false; }
        }
        // the sea: only the modest rise a coast sees in a cloudburst
        ctx.st.peak = Math.min(1.6, 0.7 + scale(0.45, ctx));
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        weather({ rain: 0.25 + k * 0.72, wind: 4 + k * 5, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: k * 0.5, fogColor: 0x59636b, pool: 0.05 });
        if (ctx.st.ff) CBZ.flashflood.tick(dt);
        if (rnd() < dt * 3 * k) sound("water");
      },
      start(ctx) {
        ctx.st.t = 0;
        if (CBZ.shake) CBZ.shake(0.4);
        sound("water");
      },
      active(dt, ctx) {
        ctx.env.fog = 0x59636b; ctx.env.fogNear = 22; ctx.env.fogFar = 150; ctx.env.sunInt = 0.55; ctx.env.hemiColor = 0x97a6b3;
        ctx.st.t += dt;
        const u = Math.min(1, ctx.st.t / Math.max(1, ctx.activeSecs));
        // the coast: up fast, a short stand, an exponential recession limb
        const peak = ctx.st.peak;
        let s;
        if (u < 0.16) s = peak * ease(u / 0.16);
        else if (u < 0.26) s = peak * (1 - 0.06 * ((u - 0.16) / 0.10));
        else { const r = (u - 0.26) / 0.74; s = peak * 0.94 * (Math.exp(-3.1 * r) - RECESS_END) / (1 - RECESS_END); }
        // the rain eases off as the storm cell spends itself (the flood's own
        // hydrograph lives in flashflood.js; this is only the sky)
        const rain = u < 0.45 ? 1 : Math.max(0.15, 1 - (u - 0.45) * 2);
        // `pool` is a SHEEN here, not a level: the routed field is the water,
        // and this keeps weather.js's water hazards (knock-down, cold,
        // trapped-in-a-car) running on it
        weather({ rain: rain, wind: 8, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.55, fogColor: 0x59636b, pool: 0.05 });
        surgeSet(s);
        if (ctx.st.ff) CBZ.flashflood.tick(dt);
        // THE SEA TAKES THE MUD the flood discharges at the coast
        const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
        if (W) {
          W.sediment = Math.min(1, 0.45 + 0.4 * Math.min(1, ctx.st.t / 8));
          W.frontC = [ctx.cx, ctx.cz]; W.frontDir = [ctx.st.wx, ctx.st.wz];
          W.frontS = ctx.R * 2; W.frontRun = 130;
          W.flowDir = [ctx.st.wx, ctx.st.wz]; W.flowSpeed = 0.5; W.stand = 1;
        }
        publishSheetFlood(ctx, u < 0.68 ? "flooded" : "drain", s, 0);
        floodActors(dt, ctx, 0, "drowned in the floodwater");
        if (rnd() < dt * 5) sound("water");
      },
      end(ctx) {
        weatherOff(); surgeSet(0);
        // the water goes; the mud, the stranded wrecks and the tide marks stay
        if (CBZ.flashflood) CBZ.flashflood.clear({ keepSilt: true });
        const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
        if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; W.sediment = 0; W.flowSpeed = 0; W.stand = 0; }
        if (CBZ.waterEventClear) CBZ.waterEventClear("survival-flood");
      },
      threat(x, z, ctx) {
        const t = CBZ.flashflood ? CBZ.flashflood.threatAt(x, z) : 0;
        if (t > 0) return t;
        const d = floodDepth(x, z);
        if (d > -1) return Math.max(0.35, Math.min(1, 0.4 + d * 0.25));
        return 0.18;                                    // it is still raining on you
      },
      warnThreat(x, z, ctx) { return floor(x, z) < 4 ? 0.55 : 0.06; },
      // `peak` is a SURGE (metres above the resting sea), a hill's `peak` is a
      // world Y — so the comparison has to be made in world Y or the crowd
      // will happily shelter on a hill the flood covers.
      safeDir(x, z, ctx) {
        const rest = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
        return uphill(ctx, x, z, rest + (ctx.st.peak || 5) + 1.5);
      },
    },

    // ---- HURRICANE: a cyclone with STRUCTURE. systems/hurricane.js owns the
    //      field — a storm CENTER tracks across the island, so the arc is
    //      geometry, not a script: outer bands as the wall approaches, the
    //      front eyewall at full scream, then the EYE (sudden calm, the sky
    //      opens, the crowd walks back into the open — the trap), then the
    //      back wall from the OPPOSITE direction, then the tail. The surge is
    //      the killer and it goes through the ONE water lever (surgeSet), so
    //      the drowning, the floating cars and the corpses all come free.
    //      Every occurrence ROLLS A SIZE — a Saffir-Simpson category off the
    //      seeded stream, biased by the round's intensity — and vmax, gusts,
    //      duration, eye quality, surge and scour all follow it. The legacy
    //      one-wind-number windstorm and its HURRICANE_V2 flag are purged;
    //      git is the undo. ----
    hurricane: {
      name: "HURRICANE", emoji: "", warnSecs: 5, gap: 7, cause: "killed in the hurricane", tint: 0x46505a,
      // an eye + two eyewalls need room to be three different experiences,
      // and a BIG storm LASTS: cat-1 ~22 s, cat-5 ~35 s
      get activeSecs() { return Math.round(19 + 3.2 * (this._catF || 3)); },
      _v2() { return !!CBZ.hurricane; },
      warn(ctx) {
        narrate("hint", "HURRICANE inbound, brace and hold on!", 3); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        ctx.st.gustCd = 2;
        /* MAGNITUDE: a Saffir-Simpson category rolled per occurrence off the
           seeded stream. The round's escalating intensity BIASES the roll —
           it does not replace it: an early round can still draw a monster,
           a late round can still draw a cat-3. Everything downstream reads
           this one number (vmax, gusts, duration, eye quality, surge,
           structural scour). Rolled BEFORE activeSecs is read — duration is
           a function of it. */
        const u = rnd();
        this._catF = Math.max(1, Math.min(5, 1 + 4 * (0.8 * u - 0.05 + 0.4 * ctx.intensity)));
        if (!this._v2()) return;
        // the TRACK is a rule (it decides who floods and who stands in the
        // wall), so its bearing and offset come from the seeded stream
        ctx.st.h2 = 1;
        CBZ.hurricane.begin({
          cx: ctx.cx, cz: ctx.cz, R: ctx.R, catF: this._catF,
          duration: this.warnSecs + this.activeSecs,
          bearing: a, offset: (rnd() - 0.5) * ctx.R * 0.35,
          world: this._world(ctx),
        });
      },
      /* THE TOWN THE STORM ACTS ON (systems/hurricane.js's WORLD CONTRACT).
         Read off the island, never typed in: CBZ.island's lists when the
         island publishes them, the arena record otherwise. The damage that
         decides who lives (a crushing tree, a sheet through a body) comes
         back through the same hurt + body pipes as everything else here. */
      _world(ctx) {
        const A = ctx.arena;
        const I = CBZ.island || null;
        const from = function (k, fallback) {
          return function () {
            if (I && I[k]) return typeof I[k] === "function" ? I[k]() : I[k];
            return fallback ? fallback() : (A[k] || null);
          };
        };
        const release = function (c) {
          const k = CBZ.colliders.indexOf(c);
          if (k >= 0) { CBZ.colliders.splice(k, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
        };
        return {
          cx: ctx.cx, cz: ctx.cz, R: ctx.R, root: A.root,
          groundAt: floor,
          seaRest: A.oceanY != null ? A.oceanY : -0.8,
          seaAt: seaY,
          trees: from("trees", function () { return A.flammable; }),
          buildings: from("buildings", function () { return A.fragile; }),
          cars: from("cars", function () { return A.cars; }),
          boats: from("boats", function () { return A.boats || (A.dressing && A.dressing.boats) || null; }),
          signs: from("signs"),
          districts: from("districts"),
          harbour: from("harbour", function () {
            const pr = A.dressing && A.dressing.pier;
            return pr ? [{ x: pr.x1, z: pr.z1 }, { x: (pr.x0 + pr.x1) / 2, z: (pr.z0 + pr.z1) / 2 }] : null;
          }),
          shatter: CBZ.shatterGlass || null,
          structure: function (b, amount, dirx, dirz) { structureHit(b, amount, ctx, { kind: "wind", dirx: dirx, dirz: dirz }); },
          fling: flingCar,
          release: release,
          actors: function (fn) { surv().forEachActor(fn); },
          /* a REAL piece (a roof sheet, a plank) whose swept path crossed this
             body (systems/hurricane.js debrisHits). The wound is its kinetic
             energy at the relative speed: ~1 hp per 40 J, so a 0.3 kg frond
             at 25 m/s is a sting (2), a 3 kg plank at 30 m/s a real wound
             (34), a 12 kg steel sheet at 35 m/s fatal. No sheltered check: a
             piece that reached you came through whatever was in the way. */
          hit: function (a, o) {
            if (CBZ.body && CBZ.body.busy(a)) return;
            CBZ.hurricane.count("debrisStrikes", 1);
            const mom = o.mass * o.speed;               // kg m/s
            if (CBZ.body) CBZ.body.hit(a, { dir: { x: o.dirx, z: o.dirz }, force: Math.min(18, 2 + mom * 0.08), knockdown: mom > 90 ? 1.0 : 0 });
            const wasDead = !!a.dead;
            surv().hurt(a, Math.min(400, o.energy / 40), { cause: "killed by hurricane debris", dir: { x: o.dirx, z: o.dirz } });
            if (!wasDead && a.dead) CBZ.hurricane.count("debrisKills", 1);
          },
          // a windthrown tree comes down across whoever is in its length
          hurtLine: function (x0, z0, x1, z1, w, cause) {
            const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
            surv().forEachActor(function (a) {
              if (a.dead) return;
              const u = Math.max(0, Math.min(1, ((a.pos.x - x0) * dx + (a.pos.z - z0) * dz) / L2));
              const ex = a.pos.x - (x0 + dx * u), ez = a.pos.z - (z0 + dz * u);
              if (ex * ex + ez * ez > w * w) return;
              if (CBZ.body) CBZ.body.hit(a, { dir: { x: dx, z: dz }, force: 8, knockdown: 1.0 });
              surv().hurt(a, scale(55, ctx), { cause: cause });
            });
          },
        };
      },
      warnTick(dt, ctx) {
        if (!ctx.st.h2) return;
        const k = 1 - dir.t / (this.warnSecs || 1);
        // the OUTER BANDS: the field's own far edge is already over the
        // island, so the first squalls and the first lean are the real
        // storm arriving, not a scripted ramp
        const H = CBZ.hurricane;
        H.tick(dt, camPos().x, camPos().z);
        weather(H.localWeather(camPos().x, camPos().z));
        // the outer bands lean on a LIVE body; a corpse is not shoved about
        const w = H.windAt(eyePos().x, eyePos().z);
        if (!CBZ.player.dead) {
          const p = CBZ.player._phys || (CBZ.player._phys = { kx: 0, kz: 0 });
          p.kx = (p.kx || 0) + w.x * w.speed * 0.09 * k * dt;
          p.kz = (p.kz || 0) + w.z * w.speed * 0.09 * k * dt;
        }
        if (CBZ.shake) CBZ.shake(Math.min(0.12, 0.02 + w.speed * 0.004));
        if (rnd() < dt * 2 * k) sound("wind");
      },
      warnThreat() { return 0.35; },
      warnSafeDir(x, z, ctx) {
        if (ctx.st.h2) return CBZ.hurricane.safeDir(x, z);
        return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) };
      },
      start() { /* the field went live in warn() */ },
      active(dt, ctx) {
        if (ctx.st.h2 && CBZ.hurricane && CBZ.hurricane.active()) this._v2Active(dt, ctx);
      },
      /* THE V2 STORM. Everything below reads the FIELD at each body's own
         position — there is no "the wind" any more, only the wind where you
         are standing, which is what makes the eye a real place. */
      _v2Active(dt, ctx) {
        const H = CBZ.hurricane;
        H.tick(dt, camPos().x, camPos().z);
        const S = H.state();
        ctx.st.x = S.eyeX; ctx.st.z = S.eyeZ;        // the minimap tracks the EYE
        // the drift bearing shared helpers read (floodActors, car floats):
        // the storm's forward motion — what actually carries floodwater inland
        ctx.st.wx = S.fwdX; ctx.st.wz = S.fwdZ;
        // sky + weather are LOCAL to the camera: eyewall = whiteout,
        // eye = the rain stops and the sun comes out. The clearing is the trap.
        const lw = H.localWeather(camPos().x, camPos().z);
        weather(lw);
        const rCam = Math.hypot(camPos().x - S.eyeX, camPos().z - S.eyeZ);
        if (rCam < S.eyeR) {
          /* INSIDE THE EYE there is nothing to look AT — the cylinder-mesh
             eyewall (the eye that photographed as an office tower) is gone.
             The wall is the DISTANCE THE RAIN LETS YOU SEE: fog opens to
             about the eyewall's range and no further, so the world ends in
             murk exactly where the wall stands while the sun and sky open
             overhead. `open` scales with eye QUALITY — a ragged low-category
             lull barely brightens; only a real eye springs the trap. */
          const u = 1 - rCam / S.eyeR;
          const open = Math.max(0, 1 - S.calmK * 2.4);
          const wallDist = (S.eyeR - rCam) + S.eyeR * 0.8;
          ctx.env.fog = 0x6e7d8b;
          ctx.env.fogNear = Math.max(18, wallDist * 0.35);
          ctx.env.fogFar = Math.max(40, Math.min(300, wallDist * (1 + 0.6 * open)));
          ctx.env.sunInt = 0.45 + 0.75 * u * open;
          ctx.env.hemiColor = 0xc2d3e0; ctx.env.hemiInt = 0.5 + 0.35 * open;
        } else {
          // VISIBILITY is the rain you are in: a band's squall or the wall's
          // whiteout closes it to a few dozen metres, a slot between bands
          // opens it back up (sideways rain + spray, not just wind)
          ctx.env.fog = 0x46505a; ctx.env.fogNear = Math.max(5, 15 - lw.wind * 0.12);
          ctx.env.fogFar = Math.max(36, 240 - lw.wind * 2.3 - lw.rain * 80);
          ctx.env.sunInt = 0.45; ctx.env.hemiColor = 0x8a98a6;
        }
        if (CBZ.shake) CBZ.shake(Math.min(0.42, lw.wind * 0.009));
        if (rnd() < dt * (0.4 + lw.wind * 0.05)) sound("wind");
        // ---- THE SURGE: the sea is one number and this drives it ----
        surgeSet(S.surge);
        if (S.surge > 0.5) {
          publishSheetFlood(ctx, "flooded", S.surge, 1.1);
          let dead0 = 0;
          for (let i = 0; i < CBZ.bots.length; i++) if (CBZ.bots[i].dead) dead0++;
          floodActors(dt, ctx, 1.15, "drowned in the storm surge", S.fwdX, S.fwdZ);
          /* THE WATER IS THE KILLER — the real event's own arithmetic. The
             flash flood's 7/s bleed never crosses 100 hp in the surge's ~10 s
             of deep water, which makes the surge a light show. A second bleed
             on whoever is still swimming when the water is over 2 m deep
             makes deep water lethal on the surge's own timescale while the
             shallows stay survivable — run UP, not just out. */
          for (let i = 0; i < CBZ.bots.length; i++) {
            const b = CBZ.bots[i];
            if (b.dead || !b._survSwim) continue;
            if (floodDepth(b.pos.x, b.pos.z) > 2) surv().hurt(b, scale(6, ctx) * dt, { cause: "drowned in the storm surge" });
          }
          let dead1 = 0;
          for (let i = 0; i < CBZ.bots.length; i++) if (CBZ.bots[i].dead) dead1++;
          H.count("drownings", Math.max(0, dead1 - dead0));
          // (TWO FEET FLOATS A CAR: systems/hurricane.js floats it, nose-down,
          // drifting with the water — not tossed like a tsunami's)
          if (rnd() < dt * 3) sound("water");
        }
        // ---- the sea ON TOP of the surge: whipped white by the wind you are
        //      standing in (the sheet flood's own floor still holds under it) ----
        {
          const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
          const ss = H.seaState(camPos().x, camPos().z);
          if (W) { W.amp = Math.max(W.amp, ss.amp); W.chop = Math.max(W.chop, ss.chop); W.foam = Math.max(W.foam, ss.foam); }
        }
        // ---- wind loads on every body, from the field at THEIR feet ----
        surv().forEachActor(function (a) {
          if (CBZ.body && CBZ.body.busy(a)) return;
          if (sheltered(a)) return;                  // a roof still breaks the wind
          const w = H.windAt(a.pos.x, a.pos.z);
          const drag = w.speed * (0.14 + 0.06 * ctx.intensity);
          if (a.isPlayer) {
            const p = CBZ.player._phys || (CBZ.player._phys = { kx: 0, kz: 0 });
            p.kx = (p.kx || 0) + w.x * drag * dt; p.kz = (p.kz || 0) + w.z * drag * dt;
          } else {
            a.pos.x += w.x * drag * dt; a.pos.z += w.z * drag * dt;
            if (CBZ.collide) CBZ.collide(a.pos, 0.5);
            if (!a._lift) a.pos.y = floor(a.pos.x, a.pos.z);   // a body on a floor keeps it (the mover re-stands it)
          }
          /* NO INVISIBLE DEBRIS. This used to roll a hidden "strike" on anyone
             in eyewall wind (a 14-20 hp wound billed "killed by hurricane
             debris" with nothing in the air near them). Debris wounds now come
             only from real pieces crossing a body (world.hit above, fed by
             systems/hurricane.js debrisHits). What the open eyewall does to a
             body by itself is EXPOSURE: wind-driven rain, grit and being
             thrown about. It is slow, it is said for what it is, and a cat-1
             band costs nothing: about 2 hp/s at 40 m/s, 4 at 55, 6 at 70. */
          if (w.speed > 32) {
            surv().hurt(a, (w.speed - 32) * 0.16 * dt, { cause: "battered to death by the hurricane winds" });
          }
        });
        // ---- gust turbulence on top of the mean field ----
        // a gust is an IMPULSE, not a new constant: the burst spikes the whole
        // field's envelope (drag, debris, rain lean, shake all breathe as one)
        // and the body shove lands on top of it. Big storms gust harder and
        // more often.
        ctx.st.gustCd -= dt;
        if (ctx.st.gustCd <= 0) {
          ctx.st.gustCd = (1.0 + rnd() * 1.6) * (S.catF >= 4 ? 0.75 : 1);
          H.count("gusts", 1);
          H.gustBurst(0.2 + 0.06 * S.catF + rnd() * 0.2);
          sound("wind");
          const camW = H.windAt(camPos().x, camPos().z);
          if (CBZ.shake && camW.speed > 14) CBZ.shake(Math.min(0.5, camW.speed * 0.012));
          surv().forEachActor(function (a) {
            if (sheltered(a)) return;
            const w = H.windAt(a.pos.x, a.pos.z);
            if (w.speed < 16) return;                // the eye's calm is REAL
            const down = rnd() < Math.min(0.55, (w.speed - 16) * 0.02);
            if (down) H.count("knockdowns", 1);
            if (CBZ.body) CBZ.body.hit(a, { dir: { x: w.x, z: w.z }, force: 4 + w.speed * 0.24, knockdown: down ? 1.0 : 0 });
          });
        }
        /* Cars (rocking, shoved, flipped, floated), trees, roofs, windows,
           signs, boats, the grid and the frame load on every building are
           systems/hurricane.js's town pass, run inside H.tick above off the
           wind AT each object — the old eyewall-annulus scour and the
           private car shiver/fling that lived here are gone. */
      },
      end(ctx) {
        weatherOff();
        /* THE CHAIN: a Cat 2+ cyclone dumps its rain on the hills behind the
           town, and the water comes down the channel after the wind has
           gone. The flash flood is the hurricane's next link, not a second
           roll of the dice. */
        if (!ctx.st.chainTo && (this._catF || 0) >= 2 && rnd() < 0.7) ctx.st.chainTo = { id: "flashflood", delay: 2, why: "hurricane" };
        if (!ctx.st.h2) return;
        CBZ.hurricane.end();
        surgeSet(0);
        if (CBZ.waterEventClear) CBZ.waterEventClear("survival-flood");
        const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
        if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; }
      },
      threat(x, z, ctx) {
        if (ctx.st.h2 && CBZ.hurricane.active()) {
          if (floodDepth(x, z) > 0.4) return 0.85;    // the water outranks the wind
          return CBZ.hurricane.threat(x, z);
        }
        return 0.4;
      },
      safeDir(x, z, ctx) {
        if (ctx.st.h2 && CBZ.hurricane.active()) {
          const S = CBZ.hurricane.state();
          // flooded or about to be: the answer is UP, measured in world Y
          // (same lesson the flash flood's safeDir learned)
          if (S.surge > 0.5 && floodDepth(x, z) > -1.0) {
            const rest = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
            return uphill(ctx, x, z, rest + S.surgeMax + 1.2);
          }
          return CBZ.hurricane.safeDir(x, z);
        }
        return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) };
      },
    },

    // ---- WILDFIRE: systems/wildfire.js (CBZ.wildfire) owns the fire ------
    //      The fuel bed (grass, brush, litter) and its wind/slope spread, the
    //      crowns, spotting, ember attack on the houses, burning cars, the
    //      plume that kills more than the flame does, the burn scar and the
    //      crosswind escape all live there. This def keeps what is the
    //      director's: pacing, the sky, the weatherDrive call (the fire's
    //      bearing IS the weather's), and the BRIDGE that lends the fire the
    //      island's machinery: THE structural ledger (a burned-out house pays
    //      in here, so it collapses on the same engine as a quake's), the
    //      survival blast (a car's tank) and the physical shelter test.
    wildfire: {
      name: "WILDFIRE", emoji: "", warnSecs: 5, gap: 6, cause: "burned alive in the wildfire", tint: 0x4a2814,
      // the DURATION is the magnitude's: a brush fire is done in ~12 s, a
      // wind-driven run takes ~28 (read at active-start, after the roll)
      get activeSecs() {
        const m = CBZ.wildfire ? CBZ.wildfire.magnitude() : null;
        return m == null ? 18 : Math.round(12 + 16 * m);
      },
      // ONE TREE LIGHTS AND ITS SMOKE STANDS UP: how you actually learn a
      // wildfire is coming, and the fire's real ORIGIN
      warn(ctx) {
        narrate("hint", "Wildfire spreading, don't get cornered!", 2.6); sound("fire");
        if (!CBZ.wildfire) return;
        // a chained fire (the eruption lit it) grows from where it already burns
        if (ctx.st.chainSeed) ctx.seed = ctx.st.chainSeed;
        CBZ.wildfire.beginWarn(ctx, {
          hitBuilding: function (b, amount, o) { return structureHit(b, amount, ctx, Object.assign({ kind: "fire" }, o || {})); },
          blast: function (kind, x, z, o) { survBlast(kind, x, z, Object.assign({ ctx: ctx }, o || {})); },
          sheltered: function (a) { return sheltered(a); },
        });
        const w = CBZ.wildfire.wind(); ctx.st.wx = w.x; ctx.st.wz = w.z;
      },
      warnTick(dt, ctx) {
        if (!CBZ.wildfire) return;
        const k = 1 - dir.t / (this.warnSecs || 1);
        const w = CBZ.wildfire.wind(); ctx.st.wx = w.x; ctx.st.wz = w.z;
        const mg = CBZ.wildfire.magnitude();
        // the telegraph is sized to the fire it telegraphs
        weather({ rain: 0, wind: 3 + k * Math.max(1, w.speed - 3), windDir: { x: w.x, z: w.z }, fog: k * (0.12 + 0.3 * mg), fogColor: 0x6a4a30 });
        CBZ.wildfire.tick(dt, ctx, true);
        ctx.env.sunColor = lerpHex(ctx.env.sunColor, 0xff9a50, (0.15 + 0.45 * mg) * k);
        if (rnd() < dt * 1.2) sound("fire");
      },
      warnThreat(x, z) { return CBZ.wildfire ? CBZ.wildfire.threat(x, z) : 0; },
      warnSafeDir(x, z) { return CBZ.wildfire ? CBZ.wildfire.safeDir(x, z) : null; },
      start(ctx) { if (CBZ.wildfire) CBZ.wildfire.begin(ctx); },
      active(dt, ctx) {
        if (!CBZ.wildfire) return;
        const w = CBZ.wildfire.wind(); ctx.st.wx = w.x; ctx.st.wz = w.z;
        const mg = CBZ.wildfire.magnitude(), sz = CBZ.wildfire.size();
        // THE SKY IS SIZED TO THE FIRE: a brush fire is a smudge on an
        // ordinary afternoon; a big run's pall turns the sun orange-red and
        // closes the horizon in, deepening as the fire grows
        const big = Math.min(1, mg * 0.7 + sz * 0.6);
        ctx.env.fog = 0x4a2814;
        ctx.env.fogNear = 30 - 14 * big; ctx.env.fogFar = 320 - 175 * big;
        ctx.env.sunInt = 0.86 - 0.36 * big; ctx.env.sunColor = lerpHex(0xffc27a, 0xff6018, big);
        ctx.env.hemiColor = 0xff8a3a; ctx.env.hemiInt = 0.74 - 0.12 * big;
        weather({ rain: 0, wind: w.speed, windDir: { x: w.x, z: w.z }, fog: 0.18 + 0.3 * big, fogColor: 0x4a2814 });
        CBZ.wildfire.tick(dt, ctx);
        // the sky YOU are under: standing in the plume closes the world in
        const p = eyePos();
        const s = Math.min(1, CBZ.wildfire.smokeAt(p.x, p.z));
        if (s > 0.15) {
          ctx.env.fogNear = Math.min(ctx.env.fogNear, 16 - 11 * s);
          ctx.env.fogFar = Math.min(ctx.env.fogFar, 145 - 100 * s);
          ctx.env.sunInt = Math.min(ctx.env.sunInt, 0.5 - 0.25 * s);
          ctx.env.sunColor = lerpHex(ctx.env.sunColor, 0xd8400c, s * 0.6);
        }
        if (rnd() < dt * 3) sound("fire");
      },
      end() {
        weatherOff();
        if (CBZ.wildfire) CBZ.wildfire.stop();   // the black, the snags, the wrecks STAY
      },
      threat(x, z) { return CBZ.wildfire ? CBZ.wildfire.threat(x, z) : 0; },
      safeDir(x, z) { return CBZ.wildfire ? CBZ.wildfire.safeDir(x, z) : null; },
    },

    // ---- TORNADO: DELEGATED to systems/tornado.js (CBZ.tornado) ----------
    //      CBZ.tornado is the ONE vortex (the parent storm, the funnel, the EF
    //      damage on real building parts, the thrown cars, the path, the hail).
    //      This def authors only what is the ISLAND's: the sky, the siren, the
    //      bridge to the island's buildings / cars / trees / ground, and the
    //      phase timing. See CBZ.tornadoAudit().
    tornado: {
      name: "TORNADO", emoji: "", warnSecs: 7, activeSecs: 22, gap: 6, cause: "torn apart by the tornado", tint: 0x5d6650,
      /* THE SKY GOES GREEN-GREY AND THE AIR STOPS. A supercell's core light
         through deep cloud and hail goes that sick green; the sun dies, the
         wind rises and then falls away to nothing right before the drop, and
         the civil-defence siren starts. */
      warn(ctx) {
        narrate("hint", "TORNADO touching down!", 2.6); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        if (CBZ.tornado && CBZ.tornado.siren) CBZ.tornado.siren(true);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        const gust = Math.sin(Math.min(1, k * 1.35) * Math.PI);
        weather({ rain: 0.2 + k * 0.35, wind: 2 + gust * 13, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.2 + k * 0.35, fogColor: 0x56604a, lightning: 0.25 * k });
        tornadoSky(ctx, k);
        rattleProps(ctx, 0.02 * gust);
        if (rnd() < dt * 1.5 * gust) sound("wind");
      },
      warnThreat() { return 0.2; },
      start(ctx) {
        const p = ctx.arena.randomPoint(0, ctx.R * 0.5);
        ctx.st.x = p.x; ctx.st.z = p.z;              // hazards() reads these
        // A MAGNITUDE, ROLLED PER OCCURRENCE: intensity biases a seeded roll,
        // so the same round can hand you a rope one run and a wedge the next.
        // EF5 stays scripted-only. capLife maps the vortex's own lifetime into
        // the phase window (a small one ropes out early and the sky clears).
        let mag = Math.max(0.5, Math.min(4.5, 0.7 + ctx.intensity * 2.2 + (rnd() - 0.5) * 2.6));
        if (dir.forceMag != null) { mag = dir.forceMag; dir.forceMag = null; }
        const A = ctx.arena;
        ctx.st.tw = CBZ.tornado ? CBZ.tornado.spawn({
          x: p.x, z: p.z, mag: mag,
          capLife: this.activeSecs + 1.5,
          // no `by`: nobody is credited for the weather
          bounds: { x: ctx.cx, z: ctx.cz, r: ctx.R - 6 },   // bounce off the island edge
          /* THE ISLAND BRIDGE: the vortex reads the island's own records and
             writes its damage through the island's own machinery (the ONE
             structural ledger above, the car's own glass, surv's shelter). */
          arena: {
            fragile: function () { return A.fragile || []; },
            cars: function () { return A.cars || []; },
            trees: function () { return A.flammable ? A.flammable.filter(function (f) { return f.trunk || f.foliage; }) : []; },
            ground: function (x, z) { return A.groundHeightAt(x, z); },
            hitBuilding: function (b, amount, dirx, dirz) {
              return structureHit(b, amount, ctx, { kind: "tornado", dirx: dirx, dirz: dirz });
            },
            carGlass: function (car, dx, dz) { shatterCarGlass(car, dx, dz); },
            sheltered: function (a) { return sheltered(a); },
          },
        }) : null;
      },
      active(dt, ctx) {
        // mirror the live position for the minimap; keep the parent storm
        // blowing. Near the funnel the storm's own wind bends INTO it and the
        // rain thins (the rain-free base under the updraft), then hammers
        // again once it has passed.
        const a = CBZ.tornado && CBZ.tornado.active()[0];
        if (a) { ctx.st.x = a.x; ctx.st.z = a.z; ctx.st.r = a.r; }
        let wx = ctx.st.wx, wz = ctx.st.wz, wind = 12, rain = 0.55;
        const E = eyePos();
        if (a && E) {
          const dx = a.x - E.x, dz = a.z - E.z, d = Math.hypot(dx, dz) || 1;
          const k = Math.max(0, 1 - d / 320);            // inflow influence
          wx = wx * (1 - k) + (dx / d) * k;
          wz = wz * (1 - k) + (dz / d) * k;
          const wl = Math.hypot(wx, wz) || 1; wx /= wl; wz /= wl;
          wind = 12 + 16 * k;
          rain = 0.55 - 0.38 * Math.max(0, 1 - d / (a.r * 3));
        }
        // the light comes back as it ropes out: the clear slot behind the
        // rear-flank downdraft arrives with the end of it
        const clear = a ? a.rope : 1;
        weather({ rain: rain * (1 - 0.5 * clear), wind: wind, windDir: { x: wx, z: wz }, fog: 0.26 - 0.1 * clear, fogColor: 0x56604a, lightning: 0.3 * (1 - clear) });
        tornadoSky(ctx, 1 - 0.6 * clear);
      },
      end(ctx) {
        weatherOff();
        if (CBZ.tornado && ctx.st.tw) CBZ.tornado.stop(ctx.st.tw);
        if (CBZ.tornado && CBZ.tornado.siren) CBZ.tornado.siren(false);
        ctx.st.tw = null;
      },
      threat(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.threat(x, z) : 0; },
      safeDir(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.safeDir(x, z) : null; },
    },

    // ---- VOLCANO: lava flood off the mountain, lava bombs, pyro + lahar ----
    volcano: {
      name: "VOLCANIC ERUPTION", emoji: "", warnSecs: 6,
      /* THE SIZE IS PART OF THE ROLL: a burp is over in ~11 s, the big one
         runs half a minute. volMagCur is set by rollMag() in warn(), which
         always runs before the director reads this getter at active-start. */
      get activeSecs() { return 10 + Math.round(24 * (volMagCur == null ? 0.42 : volMagCur)); },
      gap: 7, cause: "incinerated by lava", tint: 0x2e211c,
      /* THE MOUNTAIN WAKES UP IN FRONT OF YOU. A rising rumble under your
         feet, the crater rim starting to glow, and rock coming down the lane
         — physical facts that between them say everything the banner said,
         and unlike the banner they tell you WHICH mountain and WHICH flank.

         (The grey ash rain that used to fall here is gone with the rest of
         the ash — OWNER, 2026-08-16: "the ash everywhere is just so dumb".)

         AND, NEW: WHICH WAY THE MOUNTAIN IS GOING TO FALL. A pyroclastic
         flow is unsurvivable inside its lane, so a hazard the player cannot
         read BEFORE it moves is not a hazard, it is a coin flip. The lane is
         the fall line off the failing side of the cone, and it announces
         itself the way a real one does: rock starts coming down it. Debris
         trickles, then bounces, then rolls, all down the same corridor the
         flow will take — plus the crowd, whose warnThreat now clears that
         corridor first. Nothing is drawn that is not a physical object. */
      warn(ctx) {
        /* the size of THIS eruption is decided while the mountain is still
           only rumbling, so the telegraph and the event can agree on it */
        const M = rollMag(ctx);
        narrate("hint", "THE VOLCANO IS WAKING, get off the mountain!", 3);
        sound("rumble"); if (CBZ.shake) CBZ.shake(0.3 + 0.4 * M);
        /* NO GLOWING COIN ON THE SUMMIT. Before an eruption there is no magma
           at the surface to glow: what a waking volcano shows is STEAM — the
           groundwater over the rising magma boiling off through the summit
           vents, harder and harder — and a ground that hums. Both are the
           eruption's own UNREST (world/eruption.js), driven from warnTick. */
        const wa = rnd() * 6.28; ctx.st.wx = Math.cos(wa); ctx.st.wz = Math.sin(wa);
        // the failing flank, chosen ONCE so the telegraph and the flow can
        // never point at two different sides of the same mountain
        ctx.st.pyroBear = rnd() * 6.28;
        erCreate(ctx);            // sets ctx.st.pyroLane: the valley the collapse will take
        ctx.st.rockCd = 0.7;
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        const h = erSite(ctx);
        // harmonic tremor + the summit steaming harder (world/eruption.js)
        if (ctx.st.er) ctx.st.er.unrest(dt, k);
        rattleProps(ctx, 0.015 + 0.05 * k);
        weather({ rain: 0, wind: 3 + k * 5, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.2, fogColor: 0x2e211c });
        ctx.st.rumbleCd = (ctx.st.rumbleCd || 0) - dt;
        if (ctx.st.rumbleCd <= 0) { ctx.st.rumbleCd = 1.8 - k; soundAt("rumble", h.x, h.z); }
        // ROCKFALL DOWN THE LANE — the telegraph, and it accelerates
        const lane = ctx.st.pyroLane;
        if (lane) {
          ctx.st.rockCd -= dt;
          if (ctx.st.rockCd <= 0) {
            ctx.st.rockCd = 0.55 - 0.36 * k;
            const P = lane.pts;
            const i = 1 + ((rnd() * Math.min(P.length - 1, 6)) | 0);
            const p = P[i];
            CBZ.fx.dropDebris({
              x: p.x + (rnd() - 0.5) * 5, z: p.z + (rnd() - 0.5) * 5,
              fromY: p.y + 3 + rnd() * 4, vy: -2 - rnd() * 3,
              size: 0.4 + rnd() * 0.9, shape: "rock", color: 0x4a4038, dmg: 0, linger: 5,
            });
          }
        }
      },
      /* The crowd is already running OFF the mountain while it is still only
         rumbling — and, first, OUT OF THE LANE. That stampede IS the warning
         for anyone who missed the rockfall. */
      warnThreat(x, z, ctx) {
        const h = erSite(ctx), d = Math.hypot(x - h.x, z - h.z);
        let t = d < h.r + 12 ? 0.9 * (1 - d / (h.r + 12)) : 0.05;
        const lane = ctx.st.pyroLane;
        if (lane && vfx()) {
          const c = vfx().pathCoord(lane, x, z, lane.total);
          if (c.perp < 26) t = Math.max(t, 0.95 * (1 - c.perp / 26));
        }
        return t;
      },
      // out of the lane SIDEWAYS beats away-from-the-peak: you cannot outrun
      // a density current down its own corridor, you can only leave it
      warnSafeDir(x, z, ctx) {
        const lane = ctx.st.pyroLane;
        if (lane && vfx()) {
          const c = vfx().pathCoord(lane, x, z, lane.total);
          if (c.perp < 30) {
            const V = new THREE.Vector3();
            vfx().pathAt(lane, c.s, V);
            const dx = x - V.x, dz = z - V.z, dl = Math.hypot(dx, dz);
            if (dl > 0.4) return { x: dx / dl, z: dz / dl };
          }
        }
        return DEFS.volcano.safeDir(x, z, ctx);
      },
      start(ctx) { startEruption(ctx); },
      active(dt, ctx) { tickEruption(dt, ctx); tick0(ctx, dt); },
      end(ctx) {
        weatherOff(); endEruption(ctx);
        /* THE CHAIN: the lava, the bombs and the density current lit the
           island's fuel bed (the wildfire as a service). If that fire is
           still going when the mountain quietens, it does not smoulder on
           under the next disaster's warning: it BECOMES the next link, a
           wildfire that grows out of the flank the eruption set alight. A
           burp that lit nothing ends clean. */
        const WF = CBZ.wildfire;
        if (!ctx.st.chainTo && WF && WF.serving && WF.serving() && (ctx.st.erMag || 0) > 0.2 && rnd() < 0.75) {
          const V = erSite(ctx);
          const sx = V.x + (ctx.cx - V.x) * 0.35, sz = V.z + (ctx.cz - V.z) * 0.35;
          ctx.st.chainTo = { id: "wildfire", delay: 2, why: "volcano", st: { chainSeed: { x: sx, z: sz } } };
        }
      },
      threat(x, z, ctx) { return eruptThreat(x, z, ctx); },
      safeDir(x, z, ctx) { const h = erSite(ctx); const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
    },

    /* ---- BLIZZARD: whiteout, freeze if you stop — AND THE SNOW LIES ---------
       OWNER: "blizzard should fill ground with white slowly just like how the
       top of the mountain tip in nat disaster has white."

       That mountain tip is a second cone of white geometry bolted onto the
       peak at build time — a look, permanently, that no weather can produce or
       take away. The same LOOK is now a live coverage scalar: `cover` in
       systems/weather.js drives one shared uniform that whitens every large
       up-facing surface in the world, so the ground, the roofs and the props
       go white progressively while the blizzard blows and melt back after it.
       The def asserts the coverage it wants; it paints nothing itself. ------ */
    blizzard: {
      name: "BLIZZARD", emoji: "", warnSecs: 5, activeSecs: 17, gap: 6, cause: "frozen solid in the blizzard", tint: 0xdbe6f0,
      // VISIBILITY CLOSES IN. The horizon walks toward you over five seconds
      // and the first flakes start crossing the light. Nothing has to say
      // "whiteout" — you can measure it by how much island you can still see,
      // and by how much of the grass has gone white under your feet.
      warn(ctx) {
        narrate("hint", "Blizzard incoming, get INDOORS or keep moving!", 2.8); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        // V2 (systems/blizzard.js): seed the drift field on this wind bearing
        // and reset the windchill clock. Absent or flagged off, the legacy
        // storm below plays untouched.
        if (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) CBZ.blizzard.begin(ctx.st.wx, ctx.st.wz, ctx);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        // the first flakes already start to settle: a dusting on the grass is
        // the earliest honest warning a blizzard gives
        weather({ rain: 0, snow: 0.2 + k * 0.7, wind: 5 + k * 9, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: k * 0.8, fogColor: 0xdbe6f0, cover: 0.10 * k });
        // the fog wall closing: 380 m of visibility down to 120 m before it hits
        ctx.env.fogFar = 380 - 260 * k; ctx.env.fogNear = 80 - 60 * k;
        ctx.env.fog = lerpHex(ctx.env.fog, 0xdbe6f0, 0.7 * k);
        if (rnd() < dt * 1.5) sound("wind");
      },
      // shelter is the answer, so the crowd converges on the lee faces while
      // the sky is still darkening (V2), or just keeps moving (legacy)
      warnThreat(x, z, ctx) { return 0.3; },
      warnSafeDir(x, z, ctx) {
        return (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) ? CBZ.blizzard.safeDir(x, z) : null;
      },
      start(ctx) { ctx.st.t = 0; },
      active(dt, ctx) {
        /* V2: systems/blizzard.js owns the event — the gusting whiteout, the
           windchill clock on every unsheltered actor, the windbreak query,
           the lee-side drifts and the burial. This def hands it dt+ctx and
           keeps the wind sound. Flag off / file missing = the storm below,
           exactly as it always played. */
        if (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) {
          CBZ.blizzard.storm(dt, ctx);
          if (rnd() < dt * 2) sound("wind");
          return;
        }
        ctx.env.fog = 0xdbe6f0; ctx.env.fogNear = 8; ctx.env.fogFar = 60; ctx.env.sunInt = 0.6; ctx.env.sunColor = 0xcfe0ff; ctx.env.hemiInt = 1.1; ctx.env.hemiColor = 0xeaf2ff;
        // THE GROUND GOES WHITE AS THE EVENT RUNS. `cover` ramps with the
        // progress of the storm rather than snapping to 1, so the arc reads
        // green ground → half-whitened → buried, and a late-round blizzard
        // (higher intensity) buries more of it than an early one.
        ctx.st.t += dt;
        const p = Math.min(1, ctx.st.t / Math.max(1, ctx.activeSecs));
        weather({ rain: 0, snow: 1, wind: 16 + 6 * ctx.intensity, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: 0.85, fogColor: 0xdbe6f0, cover: Math.min(1, (0.25 + 0.75 * p) * (0.7 + 0.3 * ctx.intensity)) });
        const cold = scale(12, ctx);
        surv().forEachActor(function (a) {
          if (sheltered(a)) return;                    // a roof overhead = warmth; shelter is physical
          if ((a.speed || 0) < 1.6) surv().hurt(a, cold * dt);
        });
        if (rnd() < dt * 2) sound("wind");
      },
      // weatherOff() drops the driven coverage back to the ambient integrator,
      // which MELTS it over minutes instead of deleting it — the island stays
      // white for a while after, which is the whole point of state on the ground.
      end(ctx) {
        weatherOff();
        // V2: the drifts and the buried stay; blizzard.js melts them over
        // minutes, the same clock weather.js melts the ground cover on.
        if (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) CBZ.blizzard.end();
      },
      threat(x, z) {
        // V2: the open is a countdown (0.5), a lee face is holding on (0.1),
        // a roof is warmth (0.05) — which is what steers the crowd into the
        // huddle behind the wall. Legacy: a flat 0.25 with nowhere to go.
        return (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) ? CBZ.blizzard.threat(x, z) : 0.25;
      },
      safeDir(x, z) {
        return (CBZ.blizzard && CBZ.CONFIG.BLIZZARD_V2 !== false) ? CBZ.blizzard.safeDir(x, z) : null;
      },
    },

    // ---- METEOR SHOWER: built on systems/meteor.js (CBZ.meteor). The def is
    //      METEOR_DEF(), in its own block further down ("THE METEOR SHOWER"). ----
    meteor: METEOR_DEF(),

    /* ---- SINKHOLES: THE GROUND OPENS AND YOU GO DOWN IT ---------------------
       It began as a flat BLACK DISC painted on the grass that instakilled
       anyone standing on it; then it became a real 14-22 m shaft you fell into.
       This is the third pass and it is the owner's reference photograph —
       Guatemala City, 2010 — which changes three things about the ROSTER ENTRY
       (the shaft itself now lives in world/groundshaft.js):

       FEWER, BIGGER, DEEPER. Six 4 m dimples scattered over the island read as
       potholes. The reference is ONE shaft ~20 m across and much deeper than
       wide, with everything around it untouched, and the untouched
       surroundings are half of why it is frightening. So: one or two per
       event, r 7-11, about three radii deep, never anywhere the ground is not
       flat — and (2026-10-14) at the site with the most standing on it: a
       road, parked cars, a building at the lip. world/sinkhole.js is the
       event itself: the warning signs, the cover collapse, the calving rim,
       and the cars, posts, trees and buildings going in.

       THE WARNING HAPPENS WHERE THE HOLE WILL BE. The old warn scattered
       cracks at random points across the whole island — information that could
       not be acted on, which is the same fault as a banner. The site is now
       chosen (by CBZ.groundShaftSite, which refuses any slope over the law) at
       the START of the warning, and the cracks, the dust venting out of them
       and the slabs tipping inward are AT it. warnThreat/warnSafeDir therefore
       answer honestly, so the crowd runs off the ground that is about to go —
       which is exactly the owner's own survival note: run to stable ground
       outside the expanding radius.

       AND THE HOLE STAYS. end() no longer fills it in.                       */
    sinkhole: {
      // 8 s of warning: long enough to SEE it coming (cracks running out
      // across the road, the cover sagging, the posts leaning) and run
      name: "SINKHOLES", emoji: "", warnSecs: 8, activeSecs: 22, gap: 6, cause: "swallowed by a sinkhole", tint: 0x5a4a36,
      warn(ctx) {
        narrate("hint", "The ground is giving way!", 2.6); sound("rumble");
        ctx.st.holes = []; ctx.st.pending = []; ctx.st.seqs = [];
        ctx.st.cd = 0;
        sinkSite(ctx, this.warnSecs || 8);        // the first one is telegraphed for the whole warning
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        if (CBZ.shake) CBZ.shake(0.02 + 0.06 * k);
        rattleProps(ctx, 0.01 + 0.03 * k);
        if (rnd() < dt * 1.4) soundAt("rumble", ctx.cx, ctx.cz);
      },
      // the warning is a PLACE now, so the bots can act on it
      warnThreat(x, z, ctx) { return sinkThreat(x, z, ctx, 1.35); },
      warnSafeDir(x, z, ctx) { return sinkSafeDir(x, z, ctx); },
      start(ctx) { ctx.st.cd = 7 + rnd() * 4; },
      active(dt, ctx) {
        // a second (and at high intensity a third) collapse somewhere else on
        // the island, each with its own full warn→drop→grow arc
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0 && (ctx.st.seqs || []).length < 1 + Math.round(ctx.intensity * 1.6)) {
          ctx.st.cd = 10 + rnd() * 5;
          sinkSite(ctx, 4.5);
        }
        sinkSync(ctx);
        tickHoles(dt, ctx);
      },
      end(ctx) {
        // the telegraph goes; THE HOLE STAYS (closeHoles only clears the list —
        // the shafts are the island's new terrain until the match resets)
        (ctx.st.pending || []).forEach((p) => { if (p.m) p.m.dispose(); });
        (ctx.st.cracks || []).forEach((m) => rmMesh(m));
        closeHoles(ctx);
      },
      threat(x, z, ctx) { return sinkThreat(x, z, ctx, 1.25); },
      safeDir(x, z, ctx) { return sinkSafeDir(x, z, ctx); },
    },

    // ---- NUKE: the finale. Blinding flash, expanding lethal shockwave ----
    nuke: {
      name: "NUCLEAR STRIKE", emoji: "", warnSecs: 7, activeSecs: 12, gap: 8, cause: "vaporized by the nuclear blast", tint: 0x2a2a30,
      // THE SIREN AND THE MARKED GROUND ZERO ARE THE WHOLE WARNING. A siren is
      // a diegetic object — something in the world is making that noise — so it
      // stays; the "INCOMING" toast and the pulsing banner over it were the
      // same fact, said twice, in the HUD's voice.
      warn(ctx) {
        narrate("toast", "INCOMING");
        narrate("banner", "NUCLEAR STRIKE INCOMING");
        ctx.st.gx = ctx.cx; ctx.st.gz = ctx.cz;
        soundAt("siren", ctx.st.gx, ctx.st.gz);
        ctx.st.warnMk = CBZ.fx.groundMarker(ctx.st.gx, ctx.st.gz, 8, 0xff3020); ctx.st.warnMk.set(1);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        // the light goes out of the day and the wind drops to nothing
        ctx.env.sunInt = 0.85 - 0.5 * k; ctx.env.fog = lerpHex(ctx.env.fog, 0x2a2a30, 0.8 * k);
        weather({ rain: 0, wind: 1, fog: 0.25 * k, fogColor: 0x2a2a30 });
        if (rnd() < dt) soundAt("siren", ctx.st.gx, ctx.st.gz);
        if (k > 0.75 && CBZ.shake) CBZ.shake(0.05);
      },
      warnThreat(x, z, ctx) {
        const d = Math.hypot(x - ctx.cx, z - ctx.cz);
        return d < ctx.R ? 1 - d / (ctx.R * 1.4) : 0.2;      // run, and keep running
      },
      warnSafeDir(x, z, ctx) {
        const dx = x - ctx.cx, dz = z - ctx.cz, d = Math.hypot(dx, dz) || 1;
        return { x: dx / d, z: dz / d };
      },
      start(ctx) {
        if (ctx.st.warnMk) ctx.st.warnMk.dispose();
        /* THE ORDNANCE BUS DRAWS THE BOMB. `nuke` is a real row
           (systems/impactbus.js) with city/nukefx.js registered as its FX
           composer — the actual mushroom cloud, the flash, the ground shock
           and the sfx, all of which this def used to approximate with a
           cylinder, a squashed sphere and four re-typed calls.

           noDamage:true is not timidity, it is scope: the bus's nuclear wave
           compiles CBZ.cityPeds / CBZ.cityCars / CBZ.structure.radialTargets
           out to 3.3 km, and the island sits 600 m off the mainland — a
           full-damage row here would silently flatten the real city while the
           player is looking at an island. The blast the PLAYER stands in is
           priced below, against this mode's own roster and its own island. */
        weather({ rain: 0, wind: 30, windDir: { x: 1, z: 0 }, fog: 0.5, fogColor: 0x3a2a22 }, 12);
        // OPEN THE LENS BEFORE THE BOMB, not after — the first frame is the
        // one with the fireball in it. See nukeFrustum().
        nukeFrustum();
        survBlast("nuke", ctx.st.gx, ctx.st.gz, {
          r: 0, up: 2, ctx: ctx, fxR: ctx.R * 0.5, color: 0xfff3d0,
          struct: 1.6, structR: ctx.R * 0.55, sfx: "explosion",
        });
        /* DID THE REAL CLOUD ACTUALLY RUN? Asked of nukefx's own live state
           rather than assumed, because "the bus was called" and "the mushroom
           exists" are different claims and only the second one is the one the
           player can see. disasterAudit() reports it. */
        let hasFlash = false;
        ctx.st.nukeFx = false;
        if (CBZ.nukeFxDebug) {
          try {
            const d = CBZ.nukeFxDebug();
            ctx.st.nukeFx = !!(d && d.live);
            hasFlash = !!(d && d.flash);
          } catch (e) { ctx.st.nukeFx = false; }
        }
        nukeFxRuns += ctx.st.nukeFx ? 1 : 0;
        // YOU SEE LIGHT, NOT GEOMETRY. nukefx's own sheet is the whiteout; we
        // only raise one if it did not (the degrade path), and the mode's
        // additive flash drops to a supporting bloom so two white sheets never
        // fight over the same frame.
        if (!hasFlash) incinerate(1, 3.2);
        CBZ.fx.flash(ctx.st.nukeFx ? 0.5 : 1, 0xffffff);
        if (CBZ.shake) CBZ.shake(1.8);
        ctx.st.r = 2; ctx.st.maxR = ctx.R * 0.95; ctx.st.killed = false;
      },
      active(dt, ctx) {
        /* THE HAZE HAS TO LET YOU SEE THE THING. The old 30/220 m fog was
           what turned the cloud into cut-outs: nukefx's lobes are fogproof by
           design (NUKE_FX_FOGPROOF), so a 220 m fog wall dissolved the entire
           world behind them and left unfogged geometry hanging in front of a
           flat brown sheet. A nuclear column is seen from tens of kilometres;
           the air after the flash is dirty, not opaque. */
        ctx.env.fog = 0x3a2a22; ctx.env.fogNear = 90; ctx.env.fogFar = 2400; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff8a4a; ctx.env.hemiColor = 0xffae7a;
        nukeFrustum();
        // expanding lethal shockwave front — this is the ISLAND-scale pressure
        // wave, priced against the mode's roster (see start()'s note)
        const prev = ctx.st.r;
        ctx.st.r = Math.min(ctx.st.maxR, ctx.st.r + (ctx.st.maxR / 6) * dt);
        const inner = ctx.st.r - 4;
        surv().forEachActor(function (a) {
          const d = Math.hypot(a.pos.x - ctx.st.gx, a.pos.z - ctx.st.gz);
          if (d <= ctx.st.r && d >= inner) {
            // the front reaching YOU is not a picture of an explosion, it is
            // the last thing you see: the same whiteout, at full peak
            if (a.isPlayer) incinerate(1, 2.2);
            surv().hurt(a, 1e6, { fromX: ctx.st.gx, fromZ: ctx.st.gz, fling: 9 });   // caught by the front
          } else if (d < inner) surv().hurt(a, scale(8, ctx) * dt, { cause: "killed by nuclear fallout" });           // lingering radiation
        });
        // the front takes the town down as it passes, through the ONE ledger
        if (ctx.st.r > prev) structureSweepRing(ctx, ctx.st.gx, ctx.st.gz, prev, ctx.st.r, 1.4);
        tick0(ctx, dt);
      },
      /* The lens stays open. NUKE_FX_AFTERMATH keeps the cloud standing over
         the island as a landmark for minutes after the blast, and clipping it
         back off at the far plane the moment the 12-second "active" window
         ends would undo the whole fix. The restore is on mode exit. */
      end(ctx) { weatherOff(); },
      threat(x, z, ctx) { const d = Math.hypot(x - (ctx.st.gx || 0), z - (ctx.st.gz || 0)); const front = ctx.st.r || 0; return d < front + 20 ? 1 : 0.4; },
      safeDir(x, z, ctx) { const dx = x - (ctx.st.gx || 0), dz = z - (ctx.st.gz || 0), d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
    },
  };

  // TSUNAMI: one event arc, TSUNAMI_V2 below. (The legacy build that tested
  // terrain height instead of the actor and rose one island-wide pool from
  // second one was deleted 2026-09-27; it lives in history.)

  /* ---------------- TSUNAMI V2 ----------------------------------------------
     REBUILT AS A CONSUMER OF THE SHARED SEA (SURV_SHARED_WATER).

     city/tsunami.js is the taste target and it authors NO WATER: the whole
     event is CBZ.waterSurgeSet(metres) walked through draw → lull → surge →
     hold → drain, and everything downstream (the rendered waterline, the
     buoyancy solve, the swimmer, the submergence test, floating corpses)
     follows because they all already read sea level.

     This one now does the same. What was deleted: the private inundation
     plane, the direct ocean.position.y writes, and the whole hand-rolled
     swimmer (tsuPlayerWater / tsuWater's player branch / the duplicate stroke
     pose at order 46.5) — city/swim.js owns the player's waterline here now.

     WHAT SURVIVES, AND WHY: the curling wall mesh. A breaking bore is not a
     single-valued height field — you can see UP INTO the barrel — so it stays
     as a PRESENTATION layer riding the surge front. It carries no wetness
     truth and no second collision: `tsuS` puts it on the front, and the front
     is a scalar on the one published water event.
     -------------------------------------------------------------------------
     THE DRAWDOWN IS THE WARNING, and it is the only one. No siren text, no
     hint: the sea goes out, hundreds of metres of seabed appear, and the crowd
     starts running uphill. That is the signal that has actually saved lives.  */
  const TSU_DRAW = -6.7;          // metres of surge at the bottom of the drawdown

  /* TWO WATER LEVELS, NOT ONE (2026-09-27). The event used to be a single
     sea level walked up and down, so the moment the wave "crossed" the
     island every street on it was rising at once, including the ones the
     wall had not reached; the far side was a lake before the bore got
     there. A tsunami has an EDGE. `behind` is the surge of the water the
     front has already brought in (the flood); `ahead` is the surge of the
     water it has not reached yet (the drawn-back sea, the dry town, the calm
     far side). The ocean mesh rides `behind` and the sheet is pulled down
     by the difference ahead of the front (water_spec.js uDwAhead), and every
     survival water query subtracts the same difference
     (CBZ.waterFrontDropAt), so the swimmer, the bots and the debris are wet
     exactly where the flood is drawn. */
  function tsuLevels(st, behind, ahead) {
    surgeSet(behind);
    st.behindSurge = behind; st.aheadSurge = ahead;
    st.aheadDrop = Math.max(0, behind - ahead);
  }

  // signed sweep coordinate of a point along the travel direction
  function tsuS(ctx, x, z) { const st = ctx.st; return (x - ctx.cx) * st.dx + (z - ctx.cz) * st.dz; }

  /* ---- ONE SIDE, NOT ALL OF THEM (2026-10-20) -----------------------------
     Owner: "the tsunami seems to come from all sides of the island and meet
     in the middle. It should come from one side and go to the other." The
     levels above were island-wide: once the straight front had passed the
     flanks and the far beach, every coast stood under the same head of sea
     and the run-up (world/tsunami_runup.js forces its sea cells to exactly
     that) poured in from all of them at once. Now the sea carries the
     island's SHADOW (world/water_spec.js cbzLeeShadow / waterLeeShadow): the
     facing coast takes the whole wave, the flanks a glancing share, and the
     lee only a small late wrap-around, so the water crosses the island in
     the wave's direction and runs out of the far side. `lee` is published
     on the event: b / a = metres the fully shadowed sea sits below the
     water behind / ahead of the front. */
  /* the sea after a tsunami: brown and heaving, settling over ~45 s */
  let tsuSeaCalm = null;
  function tsuSeaCalmStep(dt) {
    const c = tsuSeaCalm;
    if (!c) return;
    const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
    if (!W) { tsuSeaCalm = null; return; }
    c.t += dt;
    const k = Math.min(1, c.t / c.dur), e = 1 - (1 - k) * (1 - k);
    W.amp = c.amp + (0.86 - c.amp) * e;
    W.chop = c.chop + (0.72 - c.chop) * e;
    W.foam = c.foam + (0.34 - c.foam) * e;
    W.sediment = c.sed * (1 - e);
    W.flowSpeed = 0.5 * (1 - e);
    W.churn = c.churn * (1 - e);
    W.lineFoam = 0.3 + 0.7 * e;
    if (k >= 1) { W.sediment = 0; W.stand = 0; W.flowSpeed = 0; W.churn = 0; W.lineFoam = 1; tsuSeaCalm = null; }
  }
  const TSU_WRAP = 0.16;          // the lee's wrap-around crest, as a share of the facing one
  const TSU_LEE_DRAW = 0.45;      // ...and of the drawdown (it reaches the lee late)
  function tsuLeeGeom(ctx) {
    const st = ctx.st, A = ctx.arena;
    const rest = A && A.oceanY != null ? A.oceanY : -0.8;
    const cx = ctx.cx, cz = ctx.cz, dx = st.dx, dz = st.dz;
    let x0 = cx - ctx.R * 1.3, x1 = cx + ctx.R * 1.3, z0 = cz - ctx.R * 1.3, z1 = cz + ctx.R * 1.3;
    const IB = CBZ.island && CBZ.island.bounds;
    if (IB && Number.isFinite(IB.x0) && Number.isFinite(IB.x1) && Number.isFinite(IB.z0) && Number.isFinite(IB.z1)) {
      x0 = IB.x0; x1 = IB.x1; z0 = IB.z0; z1 = IB.z1;
    }
    const step = Math.max(4, Math.max(x1 - x0, z1 - z0) / 96);
    let sMin = 1e9, sMax = -1e9, lMin = 1e9, lMax = -1e9, n = 0;
    for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) {
      if (!(floor(x, z) > rest + 0.4)) continue;
      const rx = x - cx, rz = z - cz, s = rx * dx + rz * dz, l = -rx * dz + rz * dx;
      if (s < sMin) sMin = s; if (s > sMax) sMax = s;
      if (l < lMin) lMin = l; if (l > lMax) lMax = l;
      n++;
    }
    if (!n) { sMin = lMin = -ctx.R; sMax = lMax = ctx.R; }
    const lw = Math.max(20, (lMax - lMin) * 0.5 * 0.9);
    return { on: 1, b: 0, a: 0, lc: (lMin + lMax) * 0.5, lw: lw, d0: 22 + 0.18 * lw,
      sMid: (sMin + sMax) * 0.5, sMin: sMin, sMax: sMax };
  }
  // set the lee from the three levels (surge metres): the sea behind the
  // front, ahead of it, and what the fully shadowed lee is standing at
  function tsuLee(st, behind, ahead, leeBehind, leeAhead) {
    const L = st.lee;
    if (!L) return;
    L.b = behind - leeBehind;
    L.a = ahead - (leeAhead == null ? leeBehind : leeAhead);
  }

  /* ---- THE WAVE'S SPEED OVER GROUND (TSU_SHOAL_V2) ------------------------
     c = √(g·d): a tsunami is fastest over deep water and SPENDS that speed
     standing up as the bottom rises. The only bathymetry this arena has is
     the 52 m of open water in front of the beach — the same span shoal and
     the approach easing already use — so the speed reads off it directly:
     full speed far out, a crawl in the last metres (where the wall is at its
     tallest and most overhung: the reference frame), and after the crash a
     released bore over land that slows again as it spends itself. Relative
     speeds only; start() integrates this profile and normalizes it so the
     whole sweep still fits the director's same activeSecs budget. */
  function tsuVRel(ctx, fs) {
    const R = ctx.R;
    const toShore = -(fs + R);
    /* THE FLOOR ON THE APPROACH (TSU_PACE_V2). √(d) goes to zero at the
       shoreline, and 0.085 let it: the last few metres of open water took
       longer than the entire crossing of the island behind them, which is
       where most of "the tsunami is too slow" actually lived. 0.30 keeps the
       deceleration — the front still arrives at a fraction of its open-sea
       speed, still stands, still breaks — without the approach out-lasting
       the event it is the approach to. */
    const floor = CBZ.CONFIG.TSU_PACE_V2 !== false ? 0.30 : 0.085;
    if (toShore > 0) return Math.max(floor, Math.sqrt(Math.min(1, toShore / 52)));
    const land = Math.max(0, Math.min(1, (fs + R) / (2 * R)));
    const spent = Math.max(0.08, Math.pow(1 - land, 1.45));
    return 1.18 * (0.5 + 0.5 * spent);
  }

  /* THE CRASH. The stand ends: the lip comes down along the whole front at
     once — a line of white water, the roar, the hardest shake the event has —
     and the bore is released into the town. This IS landfall now; the old
     single-blast landfall beat stays behind the flag as the legacy read. */
  function tsuCrash(ctx) {
    const st = ctx.st;
    st.landfall = true;
    // the silence releases FAST, so the roar below lands into it
    if (CBZ.audioHush) CBZ.audioHush(false, { fade: 0.12 });
    const fx0 = ctx.cx + st.dx * st.frontS, fz0 = ctx.cz + st.dz * st.frontS;
    const px = -st.dz, pz = st.dx;
    for (let i = -2; i <= 2; i++) {
      CBZ.fx.blast(fx0 + px * i * (ctx.R * 0.28), fz0 + pz * i * (ctx.R * 0.28),
        { maxR: i === 0 ? 26 : 18, color: 0xd9f2ff, shake: i === 0 ? 1.25 : 0, life: 0.8 });
    }
    narrate("toast", "BRACE!");
    sound("collapse"); sound("water"); sound("rumble");
  }

  /* THE FACE IS SHARED: world/water_spec.js owns one bore and city/tsunami.js
     rides the same object. Everything the audit and the regression read
     (st.waveWall, st.waveBasePos, st.waveCols/Rows) is re-exported from it. */
  function tsuBuildWave(ctx) {
    const st = ctx.st, H = st.H, W = ctx.R * 2.7;
    const h = CBZ.tsuFaceBuild({ width: W, height: H, rnd: rnd });
    h.group.rotation.y = Math.atan2(st.dx, st.dz);
    root().add(h.group);
    st.face = h;
    st.wave = h.group; st.waveWall = h.wall; st.waveBasePos = h.basePos;
    st.waveCols = h.cols; st.waveRows = h.rows;
    st.waveFoams = h.foams; st.waveStreaks = h.streaks;
  }

  const tsuSampleScratch = {};
  /* ONE PUBLISH. The roughness goes onto the arena's own live wave record (the
     arena drives the shader from it every frame, and CBZ.survSeaHeightAt reads
     the SAME two numbers), and the front/phase/flow go onto water_spec.js's
     one shared disaster-water descriptor. There is no second surface to drive
     any more, which is why the old `if (st.flood) drive(st.flood)` is gone. */
  function tsuPublish(ctx, flow) {
    const st = ctx.st;
    const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
    if (W) {
      W.amp = st.waveAmp; W.chop = st.chopAmp; W.foam = st.foamGain;
      /* THE SEDIMENT LOAD RIDES THE ARENA'S OWN WAVE RECORD, so the ocean
         shader picks it up on the SAME 47.9 pass that already follows the
         surge (world/disaster_arena.js) — no second drive call, and nothing
         can render a clean blue sea on the frame the soup arrives. */
      W.sediment = st.sediment || 0;
      W.frontC = [ctx.cx, ctx.cz];
      W.frontDir = [st.dx, st.dz];
      W.frontS = st.frontS;
      W.frontRun = 130;
      /* THE FLOW GOES TO THE SURFACE TOO. The shader cannot draw a river
         without a direction: every ripple, silt plume and foam streak on the
         flood is dragged along this vector, so the water reads as GOING
         somewhere. It is the front's own heading while the wave sweeps and
         while the flood stands, and it REVERSES on the drain — which is the
         only way an undertow is visible from outside the water. `stand` is the
         other end of the same idea: 0 while a live bore is tearing streaks off
         itself, 1 for water that has been sitting long enough to grow a scum
         network instead. */
      const seaward = Number.isFinite(flow) && flow < 0;
      W.flowDir = seaward ? [-st.dx, -st.dz] : [st.dx, st.dz];
      W.flowSpeed = 0.6 + Math.abs(Number.isFinite(flow) ? flow : 0) * 0.9;
      W.stand = st.phase === "sweep" ? 0 : (st.phase === "flooded" ? 1 : 0.8);
      W.aheadDrop = st.aheadDrop || 0;
      /* THE BOIL AND THE WHITE WATER (world/water_spec.js uDwChurn /
         dwFoamClumps): the sea heaves hardest behind a live bore, keeps
         churning while the town is under and through the wave train, and
         its crest lines give way to the flood's own clumps. */
      const rise = st.phase === "drain" ? Math.min(1, Math.abs(st.undertow || 0) / 6) : 0;
      W.churn = st.phase === "warn" ? 0 : st.phase === "sweep" ? (st.broke ? 1 : 0.35 + 0.5 * (st.shoal || 0))
        : st.phase === "flooded" ? 0.55 : 0.3 + 0.45 * rise;
      W.lineFoam = 0.3;
    }
    if (CBZ.waterEventSet) CBZ.waterEventSet({
      owner: "survival-tsunami", kind: "tsunami", phase: st.phase,
      cx: ctx.cx, cz: ctx.cz, dx: st.dx, dz: st.dz,
      frontS: st.frontS, frontWet: -2, frontWidth: 20, aheadDrop: st.aheadDrop || 0,
      lee: st.lee || null,
      level: CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.level,
      waveAmp: st.waveAmp, chopAmp: st.chopAmp,
      sediment: st.sediment || 0,
      flow: Number.isFinite(flow) ? flow : 0,
    });
  }

  /* ============================================================
     THE RUN-UP IS PHYSICS (world/tsunami_runup.js)

     Everything below the waterline is still this director's: the sea draws
     back, the bore stands up over the shelf, the sea rises behind it, holds
     and falls. But the moment the water is ON THE LAND it is a shallow-water
     flow over the island's real ground: up the streets and between the
     buildings, deepest in the low town, stopped by the slope, filling the
     ground floors through their doors, and running back down to the sea
     when the sea falls. The field's open-sea cells are forced to the level
     this director publishes (the same straight-front formula the sheet is
     drawn by outside the field), so there is one sea and one flood.

     The field is built once per arena (its bed a few rows a frame during the
     drawdown, off the load path) and reset per event. After end() it stays
     attached until the backwash has drained the land, so the last of the
     water and the wreckage it drags really do go back out to sea.
     ============================================================ */
  let tsuRun = null, tsuRunArena = null;
  function tsuBlocks(A) {
    const I = CBZ.island;
    const list = (I && Array.isArray(I.buildings) && I.buildings.length) ? I.buildings : (A.fragile || []);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !(b.w > 0) || !(b.d > 0) || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
      out.push({ x: b.x, z: b.z, w: b.w, d: b.d, yaw: b.yaw || 0, gy: b.gy, h: b.h, fallen: !!b.fallen, ref: b });
    }
    return out;
  }
  function tsuRunupFor(ctx) {
    if (!CBZ.tsuRunup) return null;
    const A = ctx.arena;
    if (tsuRun && tsuRunArena === A) return tsuRun;
    if (tsuRun) CBZ.tsuRunup.detach(tsuRun);
    const rest = A.oceanY != null ? A.oceanY : -0.8;
    const cx = A.center.x, cz = A.center.z;
    /* THE DOMAIN: the island, out to its last dry ground on every bearing
       (a gap of open water 30 m wide ends the island: the archipelago's
       islets are not its coast), plus a margin of sea for the forcing. */
    let maxR = A.radius;
    const IB = CBZ.island && CBZ.island.bounds;
    if (IB && Number.isFinite(IB.x0) && Number.isFinite(IB.x1) && Number.isFinite(IB.z0) && Number.isFinite(IB.z1)) {
      maxR = Math.max(Math.abs(IB.x0 - cx), Math.abs(IB.x1 - cx), Math.abs(IB.z0 - cz), Math.abs(IB.z1 - cz));
    } else if (IB && Number.isFinite(IB.r)) maxR = IB.r;
    else for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      let last = 0, wet = 0;
      for (let r = 0; r < A.radius * 3 + 200; r += 3) {
        if (floor(cx + c * r, cz + sn * r) > rest - 0.25) { last = r; wet = 0; }
        else if ((wet += 3) > 30) break;
      }
      if (last > maxR) maxR = last;
    }
    tsuRun = CBZ.tsuRunup.create({
      cx: cx, cz: cz, half: maxR + 16, cell: 2.5, maxN: 160,
      groundAt: floor, restY: rest, blocks: tsuBlocks(A), build: false,
    });
    tsuRunArena = A;
    return tsuRun;
  }
  function tsuRunStart(ctx) {
    const F = tsuRunupFor(ctx);
    if (!F) return null;
    if (!F.ready) F.bedSlice(F.n);
    F.reset();
    F.after.length = 0;
    F.setBlocks(tsuBlocks(ctx.arena));
    F._endT = null;
    CBZ.tsuRunup.attach(F, {
      // the sea, exactly as published: the mean minus the straight front
      forcing: function (x, z) {
        const m = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : -0.8;
        return m - (CBZ.waterFrontFormulaDrop ? CBZ.waterFrontFormulaDrop(x, z) : 0);
      },
      live: function () { return !!(CBZ.game && CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena === tsuRunArena); },
      // stays on after the event for the backwash; off when another water
      // event takes the sea, or the land has drained (or 40 s have passed)
      until: function (f) {
        const e = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
        if (e && e.owner !== "survival-tsunami") return true;
        if (e || f._endT == null) return false;
        /* NO CLOCK (2026-10-20). This used to detach 18.5 s after the card
           whatever the land still held, and the ponds blinked off with it.
           The field now stays until the ground has really taken the water
           (the seep in end() below), and the director's calm waits for it
           (busyList "backwash"): the next card does not start on a drowned
           town. */
        return f.landVol < Math.max(3, f.peakLandVol * 0.0015);
      },
    });
    ctx.st.run = F;
    return F;
  }
  // the field's answer at (x, z), or null when it is not running
  const _runQ = {};
  function tsuRunAt(ctx, x, z) {
    const F = ctx.st.run;
    if (!F || !CBZ.tsuRunup.current || CBZ.tsuRunup.current() !== F) return null;
    const r = F.sample(x, z, _runQ);
    return r.in > 0.5 ? r : null;
  }
  /* ONE DOOR FOR WATER DAMAGE (the coordinator's seam): when the shared
     collapse system grows CBZ.collapse.damage(building, point, radius,
     energy, dir), the flood's loads go through it; until then, through this
     file's own ledger. The point is the middle of the wetted face. */
  function tsuHitBuilding(b, load, ctx, o) {
    o = o || {};
    if (CBZ.collapse && typeof CBZ.collapse.damage === "function") {
      try {
        CBZ.collapse.damage(b, { x: o.x != null ? o.x : b.x, y: o.y != null ? o.y : (b.gy || 0) + 1, z: o.z != null ? o.z : b.z },
          Math.max(b.w || 4, b.d || 4) * 0.6, load, { x: o.dirx || 0, y: 0, z: o.dirz || 0 });
      } catch (e) {}
    } else structureHit(b, load, ctx, { kind: "kinetic", dirx: o.dirx || 0, dirz: o.dirz || 0 });
    if (b.fallen && ctx.st.run) ctx.st.run.setFallen(b);
  }

  /* ============================================================
     THE DEBRIS IS THE KILLER (TSU_DEBRIS)

     Owner's science, and it is the whole reason the old sixteen decorative
     planks were not good enough: "tsunami deaths are rarely just drowning. The
     wave is a churning high-speed soup of cars, trees, steel, building
     fragments. Primary death: blunt force trauma — battered and crushed by
     debris acting as battering rams."

     So the front now PICKS UP THE ISLAND. The cars that were parked on the
     seafront are ripped loose through the same flingCar() the wave always
     used, and when they come down they do not stop being a hazard — they roll
     inland inside the flow. The trees go with them WHOLE — the actual trunk
     and canopy meshes, re-parented into the water, not a stand-in cylinder.
     The houses the water takes lose their own walls to it: the biggest real
     pieces of the swept building's group travel with the flow wearing the
     building's own materials, while the rest of the frame sinks. Everything
     is a REAL object that was standing there a second ago; nothing is
     spawned scenery (the kit's manufacture path is deleted — owner: no fake
     debris). And when the drain leaves, it leaves them where they stopped.

     The motion, the tumble and the strike test are city/tsunami.js's
     CBZ.tsuDebrisField — one kit, both tsunamis. This file only says which of
     ITS objects the water has reached, and routes the strike into CBZ.surv's
     kill bus with the cause the kit worked out.
     ============================================================ */
  /* The stranded wreckage outlives its own event on purpose, so exactly ONE
     event's worth of it can be alive at a time: the next tsunami clears the
     last one's before it starts making its own. Bounded, and the aftermath
     still stands for the rest of the match you are playing. */
  let tsuLastDebris = null;
  function tsuDebris(ctx) {
    const st = ctx.st;
    if (st.debris !== undefined) return st.debris;
    if (CBZ.CONFIG.TSU_DEBRIS === false || !CBZ.tsuDebrisField) { st.debris = null; return null; }
    if (tsuLastDebris) { try { tsuLastDebris.dispose(); } catch (e) {} tsuLastDebris = null; }
    const A = ctx.arena;
    const RF = st.run || null;
    st.debris = CBZ.tsuDebrisField({
      root: root(),
      seaY: seaY,
      groundY: floor,
      // the run-up field's own current and walls: carried where the water
      // actually goes, piled where a building stops it
      flowAt: RF ? CBZ.tsuRunup.debrisFlow(RF, seaY, floor) : null,
      blockedAt: RF ? function (x, z) { return !!RF.blockAt(x, z); } : null,
      // a body with a standing wall behind it has nowhere to give
      againstWall(x, z) {
        for (let i = 0; i < A.fragile.length; i++) {
          const b = A.fragile[i];
          if (b.fallen) continue;
          if (Math.abs(x - b.x) < b.w * 0.5 + 2.4 && Math.abs(z - b.z) < b.d * 0.5 + 2.4) return true;
        }
        return false;
      },
      forEachActor(fn) { surv().forEachActor(fn); },
      strike(a, info) {
        if (CBZ.body) CBZ.body.hit(a, {
          dir: { x: info.dirX, z: info.dirZ }, force: info.force,
          fling: info.wall ? 0 : 3.5, knockdown: info.wall ? 1.4 : 0,
        });
        surv().hurt(a, scale(info.damage * 0.45, ctx), { cause: info.cause, dir: { x: info.dirX, z: info.dirZ } });
        if (a.isPlayer && CBZ.shake) CBZ.shake(0.75);
        soundAt("collapse", a.pos.x, a.pos.z);
      },
    });
    /* THE TOE ARRIVES LOADED with lumber, pallets and roof sections that ride
       the foot of the front and drop out of it across the crossing. No cars:
       it used to clone the old prop cars' meshes into the toe, cars that were
       never parked anywhere. The cars in this wave are the island's real
       vehicles, taken off the street where they stand (tsuSmash*). */
    st.debris.churn({ cars: [], halfW: ctx.R * 1.05 });
    /* THE BOATS GO TOO: the hulls the drawdown left on the mud
       (world/tsunami_scene.js), and anything the island's harbour publishes
       as afloat or stacked on its quay (CBZ.island.harbour.boats /
       .containers, Object3Ds). Taken where they lie; the field lifts each
       one when the water under it is deeper than its draft. */
    if (RF) {
      const hulls = CBZ.tsunamiScene && CBZ.tsunamiScene.boats ? CBZ.tsunamiScene.boats() : [];
      for (let i = 0; i < hulls.length; i++) st.debris.takeWorld(hulls[i], "boat");
      const H = CBZ.island && CBZ.island.harbour;
      if (H) {
        (Array.isArray(H.boats) ? H.boats : []).forEach(function (o) { const ob = o && (o.isObject3D ? o : o.group || o.mesh); if (ob && ob.isObject3D) st.debris.takeWorld(ob, "boat"); });
        (Array.isArray(H.containers) ? H.containers : []).forEach(function (o) { const ob = o && (o.isObject3D ? o : o.group || o.mesh); if (ob && ob.isObject3D) st.debris.takeWorld(ob, "container"); });
      }
    }
    tsuLastDebris = st.debris;
    return st.debris;
  }

  /* THE CAR HANDOFF. flingCar() is the one verb for "a vehicle just got ripped
     off the street" — it pulls the collider, registers the ballistic arc and
     leaves the wreck settled. What it never knew is that a car in a BORE does
     not stop when it lands: it keeps going, rolling, at the speed of the
     water. So the wave watches its own flung cars and hands each one to the
     debris field the moment its arc settles. No second physics bus; the two
     integrators are strictly sequential and never both own the same group. */
  function tsuWatchCar(ctx, car) {
    const st = ctx.st;
    const rec = flungCars.length ? flungCars[flungCars.length - 1] : null;
    if (!rec || rec.car !== car) return;
    (st.carWatch || (st.carWatch = [])).push(rec);
  }
  function tsuCarHandoff(ctx) {
    const st = ctx.st, W = st.carWatch;
    if (!W || !W.length) return;
    const field = tsuDebris(ctx); if (!field) { st.carWatch = null; return; }
    for (let i = W.length - 1; i >= 0; i--) {
      const rec = W[i];
      if (!rec.settled) continue;
      W.splice(i, 1);
      const g = rec.g; if (!g) continue;
      // it stops being wreckage and becomes two tonnes of moving water
      field.take(g, g.position.x, g.position.z, "car");
    }
  }

  /* ONE CALL FOR EVERYTHING FLOATING: the real entrained load (cars, logs,
     house panels, tumbling and striking). The old sixteen box planks that
     stood in with TSU_DEBRIS off were deleted 2026-09-28. */
  function tsuFlotsam(dt, ctx, current) {
    const field = tsuDebris(ctx);
    if (!field) return;
    const st = ctx.st;
    // the front the churn rides: only while the wall is standing in the sweep
    const front = (st.phase === "sweep" && st.face && st.wave && st.wave.visible !== false && st.faceH && st.faceY != null) ? {
      x: ctx.cx + st.dx * (st.faceS != null ? st.faceS : st.frontS), z: ctx.cz + st.dz * (st.faceS != null ? st.faceS : st.frontS), dx: st.dx, dz: st.dz,
      H: st.faceH, seaY: st.faceY + 1.2, turbid: st.sediment || 0,
      t: CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001,
      v: st.frontV != null ? st.frontV : st.speed,
      land: Math.max(0, Math.min(1, (st.frontS + ctx.R) / (2 * ctx.R))),
    } : null;
    field.step(dt, { dx: st.dx, dz: st.dz, flow: current, sediment: st.sediment || 0, front: front });
  }

  /* THE DROWNING ARC, and it has its own words because it is its own death.
     swim.js owns the air — the 28 s tank, the sink-unless-you-swim, the
     surfacing. What it cannot know is WHY you ran out: you were taken past the
     shoreline by water going the other way, and there was nothing left to
     climb. So the cause is written here, and only once the tank is genuinely
     failing over genuinely deep water, which is exactly the situation the flag
     exists to create. */
  function tsuUndertowDrown(dt, ctx, drainK) {
    if (CBZ.CONFIG.TSU_UNDERTOW === false) return;
    const st = ctx.st;
    const sw = CBZ.citySwimState && CBZ.citySwimState();
    if (!sw || !sw.swimming) return;
    const P = CBZ.player;
    if (!P || P.dead) return;
    if (floor(P.pos.x, P.pos.z) > st.level - 3.2) return;     // still over the town
    st.undertowT = (st.undertowT || 0) + dt;
    if (sw.breath > 0.42) return;
    const a = surv().playerActor;
    if (a) surv().hurt(a, scale(26, ctx) * dt, { cause: "dragged out to sea by the undertow" });
  }

  // ---- the wave front catches everyone genuinely below the crest ----
  function tsuCatch(dt, ctx) {
    const st = ctx.st;
    /* WITH THE RUN-UP FIELD: you are taken where the flood is deep AND
       fast enough to take your legs (h v^2, the momentum flux per metre of
       width, past ~2.5 m^3/s^2 for an adult), with your feet under its
       surface. A roof is a roof; the slack water in a cul-de-sac is a swim,
       not a blow. */
    if (st.run && CBZ.tsuRunup.current() === st.run) {
      surv().forEachActor(function (a) {
        if (a._waveId === st.waveId) return;
        const r = tsuRunAt(ctx, a.pos.x, a.pos.z);
        if (!r || r.depth < 0.7) return;
        const feet = a.pos.y != null ? a.pos.y : floor(a.pos.x, a.pos.z);
        if (feet > r.bed + r.depth - 0.3) return;
        const hv2 = r.depth * r.speed * r.speed;
        if (hv2 < 2.5) return;
        a._waveId = st.waveId;
        const sp = r.speed || 1, fx = r.u / sp, fz = r.v / sp;
        const k = Math.min(1.6, hv2 / 12);
        if (a.isPlayer) {
          if (CBZ.body) CBZ.body.hit(a, { dir: { x: fx, z: fz }, force: (10 + 8 * k) + 3 * ctx.intensity, knockdown: 1.1 });
          CBZ.player.vy = Math.max(CBZ.player.vy, 3 + 3 * k); CBZ.player.grounded = false;
          if (CBZ.shake) CBZ.shake(0.6 + 0.5 * k);
          if (CBZ.doSlowmo && k > 0.8) CBZ.doSlowmo(0.5);
          narrate("toast", "SWEPT AWAY");
        } else if (CBZ.body) {
          CBZ.body.hit(a, { dir: { x: fx, z: fz }, force: 11 + 8 * k, fling: 3 + 4 * k });
        }
        surv().hurt(a, scale(14 + 16 * k, ctx), { cause: "swept away by the tsunami", dir: { x: fx, z: fz } });
        sound("water");
      });
      return;
    }
    // ACTUAL altitude saves you (roofs work). Absolute cap 24: the mountain
    // summit (26) and the tallest tower roofs stay guaranteed refuges no
    // matter how late in the crossing the wall reaches them.
    const catchY = Math.min(24, st.level + Math.min(22, st.H * 0.72));
    surv().forEachActor(function (a) {
      if (a._waveId === st.waveId) return;
      const s = tsuS(ctx, a.pos.x, a.pos.z);
      if (s > st.frontS + 2 || s < st.frontS - 8) return;
      if (a.pos.y > catchY) return;                        // above the wall — safe, enjoy the view
      a._waveId = st.waveId;
      if (a.isPlayer) {
        if (CBZ.body) CBZ.body.hit(a, { dir: { x: st.dx, z: st.dz }, force: 14 + 5 * ctx.intensity, knockdown: 1.1 });
        CBZ.player.vy = Math.max(CBZ.player.vy, 6.5); CBZ.player.grounded = false;
        if (CBZ.shake) CBZ.shake(1.1);
        if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
        // being lifted off your feet, thrown, slow-motioned and dumped in
        // moving water IS "SWEPT AWAY" — the word was the weakest part of it
        narrate("toast", "SWEPT AWAY");
      } else if (CBZ.body) {
        CBZ.body.hit(a, { dir: { x: st.dx, z: st.dz }, force: 15 + 6 * ctx.intensity, fling: 6.5 + rnd() * 3.5 });
      }
      surv().hurt(a, scale(30, ctx), { cause: "swept away by the tsunami", dir: { x: st.dx, z: st.dz } });
      sound("water");
    });
  }

  /* WADING IS NOT SAFE. Swimming players already ride the current
     (city/swim.js reads waterEventSample), but a player still on their feet
     in knee-to-waist deep flood walked through it as if it were a puddle.
     Moving water at that depth takes your legs: you are shoved along the
     flow, harder the deeper and the closer to the bore, and you cannot hold
     a line against it. Pushed, not teleported: the body's own collision
     still resolves against walls next step. */
  const _wadeS = {};
  function tsuWade(dt, ctx) {
    const P = CBZ.player, st = ctx.st;
    if (!P || P.dead || !CBZ.waterEventSample) return;
    const sw = CBZ.citySwimState && CBZ.citySwimState();
    if (sw && sw.swimming) return;
    const s = CBZ.waterEventSample(P.pos.x, P.pos.z, null, _wadeS);
    if (!s || !s.wet) return;
    const depth = s.mean - (P.pos.y != null ? Math.max(P.pos.y, floor(P.pos.x, P.pos.z)) : floor(P.pos.x, P.pos.z));
    if (depth < 0.25) return;
    const k = Math.min(1, depth / 1.2);
    const v = Math.min(3.2, Math.hypot(s.currentX || 0, s.currentZ || 0) * 0.32 * k) * dt;
    const dl = Math.hypot(s.currentX || 0, s.currentZ || 0) || 1;
    P.pos.x += (s.currentX || 0) / dl * v;
    P.pos.z += (s.currentZ || 0) / dl * v;
  }

  /* THE WRECKAGE IS THE BUILDING'S OWN WALLS. A swept house sheds no invented
     brown boxes any more: the biggest solid pieces of its actual group — the
     walls and slabs the arena built it from, wearing the building's own
     materials — are torn off (Object3D re-parent, world pose kept) and handed
     to the water, while the rest of the frame sinks through the collapse
     animation it always had. Glass is skipped (it shattered when the building
     fell) and so is anything under panel size — stair treads and trim would
     read as confetti, not wreckage. */
  function tsuTearWalls(field, b) {
    if (!field || !b.group || b._tsuTorn) return;
    b._tsuTorn = 1;
    const kids = b.group.children, picks = [];
    for (let i = 0; i < kids.length && picks.length < 6; i++) {
      const m = kids[i];
      if (!m || !m.isMesh || !m.geometry || !m.geometry.parameters) continue;
      const p = m.geometry.parameters;
      if (p.width == null || p.height == null || p.depth == null) continue;   // walls and slabs are boxes
      if (m.material && m.material.transparent) continue;                     // glass shatters; it does not float
      const dims = [p.width, p.height, p.depth].sort(function (q, w) { return q - w; });
      if (dims[1] < 1.1 || dims[2] < 2.2) continue;
      picks.push(m);
    }
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i].geometry.parameters;
      const thin = Math.min(p.width, p.height, p.depth) <= 0.45;
      // a body in the shared debris sim, carried by the water as a force
      (field.takePiece || field.takeWorld)(picks[i], thin ? "panel" : "rubble");
    }
  }

  // ---- the front wrecks the low town: cars tumble, small buildings go
  //      down, big ones lose their glass. High ground is spared. ----
  /* VERTICAL EVACUATION WORKS AND WOOD FRAMES DO NOT. This is the one piece of
     real tsunami doctrine the event has to encode, because it is the answer to
     the question the event asks: a light 1-3 storey frame in the flood path is
     swept OFF ITS FOUNDATIONS (and its wreckage joins the water), while a
     reinforced concrete tower loses its glass, spalls, leans — and STANDS, so
     its upper floors and its roof are a place you can survive by climbing.
     CONCRETE_CAP is what makes that a guarantee rather than a probability: the
     wave alone can never walk a tall frame past 0.92 of the ledger, so the
     refuge cannot be taken away from you while you are standing on it. */
  const TSU_LIGHT_H = 12;        // metres — 1-3 storeys at FH 3.4: the town
  const TSU_CONCRETE_CAP = 0.92; // the wave alone never collapses a tower

  /* THE FLOOD'S LOADS (with the run-up field). Real fragility, as the
     post-2011 surveys measured it: a car floats at ~0.6 m and is shoved at
     less; a wood frame is swept off its foundations past ~2 m of fast water;
     a reinforced tower loses its glass and its ground floor and stands. The
     load is the momentum flux h v^2 the field reports round each object
     (plus the depth for the hydrostatic part), so a building in the lee of
     another is spared and the one at the head of the street takes it. */
  function tsuSmashRun(ctx, F) {
    const st = ctx.st, A = ctx.arena;
    const field = tsuDebris(ctx);
    /* THE CARS GO WITH THE WATER (owner: "only trees get swept up in the
       tsunami, cars should too"). Every car is a real vehicle: the water
       takes it through the vehicle door (takeCar: woken, out of the parked
       pools, the driver out, billed as a wreck), and the debris field carries
       it from where it stood: afloat past ~0.55 m (CBZ.tsuDebrisDraft.car),
       moving with the run-up's own local current, tumbling at the water's
       speed, piling against the walls that stop it and onto the cars already
       stopped there, and grounded where the water leaves it. Shallower but
       fast water still drags one along on its wheels (the field's grounded
       push). The old punt (flingCar's arc first, the field after it landed)
       is gone from this path: a bore does not throw a car, it carries it. */
    const draft = CBZ.tsuDebrisDraft ? CBZ.tsuDebrisDraft.car : 0.55;
    if (A.cars) for (let i = 0; i < A.cars.length; i++) {
      const car = A.cars[i]; if (car.flung || !car.group) continue;
      const p = car.group.position;
      const r = tsuRunAt(ctx, p.x, p.z);
      if (!r || r.depth < draft * 0.5) continue;
      const hv2 = r.depth * r.speed * r.speed;
      if (!field) {
        if (hv2 > 14) { const sp = r.speed || 1; flingCar(car, r.u / sp, r.v / sp, 12, 6); }
        continue;
      }
      if (r.depth < draft && hv2 < 6 * draft) continue;          // ankle-deep and slack: it stays parked
      if (!takeCar(car, "swept away by the tsunami")) continue;
      const it = field.takeWorld(car.group, "car");
      if (it) { it.vx = r.u * 0.4; it.vz = r.v * 0.4; }
    }
    if (field && A.flammable) for (let i = 0; i < A.flammable.length; i++) {
      const t = A.flammable[i];
      if (t._tsuUproot || t.burnt) continue;
      const r = tsuRunAt(ctx, t.x, t.z);
      if (!r || r.depth < 0.8 || r.depth * r.speed * r.speed < 18) continue;
      t._tsuUproot = 1;
      if (t.trunkCol) { const k = CBZ.colliders.indexOf(t.trunkCol); if (k >= 0) { CBZ.colliders.splice(k, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
      const g = new THREE.Group();
      g.position.set(t.x, t.trunk ? t.trunk.position.y : floor(t.x, t.z) + 2, t.z);
      root().add(g);
      if (t.trunk) g.attach(t.trunk);
      if (t.foliage) g.attach(t.foliage);
      field.take(g, t.x, t.z, "log");
    }
    const blocks = F.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const B = blocks[i], b = B.ref;
      if (!b || b.fallen || B.fallen) continue;
      const h = B.hNow || 0, hv2 = B.hv2Now || 0;
      if (h < 0.8) continue;
      // one blow per surge peak: re-armed when the load has risen 30% past
      // the last one that was charged
      const load = hv2 + 4.9 * h * h * 0.25;        // dynamic + hydrostatic (per rho, per metre)
      if (b._tsuLoad != null && b._tsuHit === st.waveId && load < b._tsuLoad * 1.3) continue;
      b._tsuHit = st.waveId; b._tsuLoad = load;
      let ux = 0, uz = 0;
      const rs = F.sample(b.x - st.dx * ((b.w || 8) * 0.5 + 3), b.z - st.dz * ((b.d || 8) * 0.5 + 3), _runQ);
      const ul = Math.hypot(rs.u || 0, rs.v || 0);
      if (ul > 0.1) { ux = rs.u / ul; uz = rs.v / ul; } else { ux = st.dx; uz = st.dz; }
      const at = { x: b.x - ux * (b.w || 8) * 0.5, y: (b.gy || 0) + h * 0.5, z: b.z - uz * (b.d || 8) * 0.5, dirx: ux, dirz: uz };
      if (b.h < TSU_LIGHT_H) {
        // a frame house goes when the water is deep and moving: ~2 m at 3 m/s
        const k = Math.max(0, Math.min(1.4, (load - 14) / 26));
        if (k <= 0) continue;
        tsuHitBuilding(b, 0.45 + 0.85 * k, ctx, at);
        if (field && b.fallen) tsuTearWalls(field, b);
      } else {
        const room = Math.max(0, TSU_CONCRETE_CAP - (b._dmg || 0));
        const amt = Math.min(room, Math.min(0.34, load / 140) * (0.7 + 0.5 * ctx.intensity));
        if (amt > 0.001) tsuHitBuilding(b, amt, ctx, at);
      }
    }
  }

  function tsuSmash(ctx) {
    const st = ctx.st, A = ctx.arena;
    if (st.run && CBZ.tsuRunup.current() === st.run) { tsuSmashRun(ctx, st.run); return; }
    const field = tsuDebris(ctx);
    if (A.cars) for (let i = 0; i < A.cars.length; i++) {
      const car = A.cars[i]; if (car.flung) continue;
      const s = tsuS(ctx, car.x, car.z);
      if (s <= st.frontS + 2 && s >= st.frontS - 10 && floor(car.x, car.z) <= st.level + 4) {
        // a lower arc than the old one: a bore ROLLS a car, it does not punt
        // it — and what it lands in is moving water, so it keeps travelling
        flingCar(car, st.dx, st.dz, field ? 11 + scale(4, ctx) : 17 + scale(7, ctx), field ? 3.5 : 9);
        if (field) tsuWatchCar(ctx, car);
      }
    }
    /* THE TREES GO TOO, and they are the classic tsunami battering ram: a
       whole pine, trunk-first, at the speed of the water. The tree stops
       being planted (its trunk collider leaves CBZ.colliders) but it never
       stops being ITSELF: the actual trunk and canopy meshes are re-parented
       into a group pivoted at the trunk's middle and handed to the flow —
       the same tree you could weave around a second ago, now rolling. */
    if (field && A.flammable) for (let i = 0; i < A.flammable.length; i++) {
      const t = A.flammable[i];
      if (t._tsuUproot || t.burnt) continue;
      const s = tsuS(ctx, t.x, t.z);
      if (s > st.frontS + 2 || s < st.frontS - 14) continue;
      if (floor(t.x, t.z) > st.level + 3) continue;
      t._tsuUproot = 1;
      if (t.trunkCol) { const k = CBZ.colliders.indexOf(t.trunkCol); if (k >= 0) { CBZ.colliders.splice(k, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); } }
      const g = new THREE.Group();
      g.position.set(t.x, t.trunk ? t.trunk.position.y : floor(t.x, t.z) + 2, t.z);
      root().add(g);
      if (t.trunk) g.attach(t.trunk);
      if (t.foliage) g.attach(t.foliage);
      field.take(g, t.x, t.z, "log");
    }
    for (let i = 0; i < A.fragile.length; i++) {
      const b = A.fragile[i];
      const s = tsuS(ctx, b.x, b.z);
      if (s > st.frontS + 2 || s < st.frontS - 12 || b._tsuHit === st.waveId) continue;
      b._tsuHit = st.waveId;
      if (floor(b.x, b.z) > st.level + 5) continue;        // on high ground — spared
      // THROUGH THE ONE LEDGER, and the two classes take genuinely different
      // loads rather than one formula with a soft edge.
      if (b.h < TSU_LIGHT_H) {
        tsuHitBuilding(b, 1.25, ctx, { dirx: st.dx, dirz: st.dz });
        if (field && b.fallen) tsuTearWalls(field, b);
      } else {
        const room = Math.max(0, TSU_CONCRETE_CAP - (b._dmg || 0));
        const load = Math.min(room, 0.34 * (0.7 + 0.5 * ctx.intensity));
        if (load > 0.001) tsuHitBuilding(b, load, ctx, { dirx: st.dx, dirz: st.dz });
      }
    }
  }

  /* ---- THE PLAYER IN THE WATER IS city/swim.js's JOB NOW ------------------
     Deleted from this file in the SHOW-DON'T-TELL wave: `tsuPlayerWater` (a
     private buoyancy step with stamina-as-air), `tsuEndSwim`, `tsuWater`'s
     player branch, and the duplicate stroke-pose pass at order 46.5. All four
     existed only because city/swim.js was gated to `g.mode === "city"`; it no
     longer is (SURV_SHARED_SWIM), so the island gets the real thing —
     sink-unless-you-swim, a 28 s breath tank, a dive axis, the haul-out onto
     any roof standing clear of the flood, and a drown that goes through
     CBZ.surv.hurt into the killfeed. Bots and corpses go through the shared
     `floodActors` above, with the same cause strings.                        */

  function tsuEnterFlood(ctx) {
    const st = ctx.st;
    st.phase = "flooded"; st.floodT = 0;
    st.frontV = 0;                 // the front is gone; a stale sweep speed is a lie
    st.waveAmp = 1.06; st.chopAmp = 0.98; st.foamGain = 0.62;
    if (st.wave) st.wave.visible = false;
    tsuLevels(st, st.floodSurge, st.floodSurge);
    tsuLee(st, st.floodSurge, st.floodSurge, TSU_WRAP * st.floodSurge);
    tsuPublish(ctx, 1.6);
    narrate("hint", "The town is under. Climb.", 3);
  }

  /* THE CLOCK (TSU_PACE_V2, declared in city/tsunami.js — which loads after
     this file, so every read of it is lazy). Owner: "the tsunami is too slow
     right now... just make it normal." The wave itself was already doing
     30-50 m/s; what was slow was the SCRIPT around it — ten seconds of
     drawdown, an eleven-second sweep with a second and a quarter of dead stop
     in the middle of it, nine seconds of standing flood and six of drain: a
     36-second event of which the wave was moving for eleven. The budget is
     now 22 s and the front spends more of it moving. ?cfg_TSU_PACE_V2=0
     restores the old numbers exactly. */
  const TSU_FAST = () => CBZ.CONFIG.TSU_PACE_V2 !== false;
  /* THE TRAIN after the first crest: [seconds since the backwash began,
     level]. A positive level is that share of the first crest's flood
     surge, a negative one that share of the trough (half the drawdown). */
  const TSU_TRAIN = [
    [0, 1.0], [6.0, -1.0], [9.0, -1.0],          // the backwash, and the sea held out
    [14.0, 0.52], [16.0, 0.52], [21.0, -0.55],   // the second crest, and its run back
    [25.0, 0.26], [26.5, 0.26], [31.5, 0.0],     // the third, and the sea settling
  ];
  const TSUNAMI_V2 = {
    name: "TSUNAMI", emoji: "",
    get warnSecs() { return TSU_FAST() ? 6 : 10; },
    /* 26 s (was 16): the wave itself is no slower (the sweep keeps its 7.4 s
       below); the extra ten seconds are the run-up finishing its climb and
       the BACKWASH, which used to be a 2.7 s fade and is now the water
       actually running back down the streets to the sea. */
    // an upper bound: the card ends itself when the wave train has run out
    // (st.endIn in the drain), ~50 s in, the backwash and two more crests
    get activeSecs() { return TSU_FAST() ? 58 : 70; },
    gap: 8,
    cause: "swept away by the tsunami", tint: 0x2c5a78,
    warn(ctx) {
      const st = ctx.st;
      /* A CHAINED WAVE COMES FROM ITS SOURCE: the quake's epicentre or the
         meteor's splash sits at `chainBearing` from the island, and the wave
         travels away from it (the front runs along +d). */
      const a = st.chainBearing != null ? st.chainBearing + Math.PI : rnd() * Math.PI * 2;
      st.dx = Math.cos(a); st.dz = Math.sin(a);
      st.lee = tsuLeeGeom(ctx);    // the island's shadow on this bearing
      st.warnT = 0; st.phase = "warn";
      /* THE SIZE OF THIS ONE (2026-08-29, owner: "all the natural disasters
         are cookie cutter size"). A per-occurrence magnitude roll — the
         round's escalating intensity BIASES it, never replaces it, so an
         early round can still draw a monster and a late one a survivable
         surge. It moves the drawdown, the wall height and the flood depth
         together (st.draw here, st.H / st.floodSurge in start()). */
      const mr = rnd();
      st.mag = Math.max(0.3, Math.min(1.45,
        (0.42 + 1.0 * mr * mr) * (0.75 + 0.45 * Math.min(1.4, ctx.intensity || 0))));
      // window.__tsunamiMagPin: the key-art staging pin (same pattern as
      // __volcanoMagPin; no game code sets it). The dice are still thrown.
      const tpin = (typeof window !== "undefined") ? window.__tsunamiMagPin : null;
      if (Number.isFinite(tpin)) st.mag = Math.max(0.3, Math.min(1.45, tpin));
      st.draw = TSU_DRAW * (0.35 + 0.65 * Math.min(1.2, st.mag));
      /* THE CLOCK. "Too slow" is a complaint about SECONDS, and until now the
         event published none: the storyboard could photograph every beat and
         still not say when any of them happened. eventT runs from the first
         frame of the drawdown to the last frame of the drain, phaseT resets on
         each beat, and both are in the audit — so pacing is a number two
         builds can be compared on instead of a feeling. */
      st.eventT = 0; st.phaseT = 0; st.activeT = 0; st.sweepT = 0; st.crashAtT = -1;
      st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : -0.8;
      st.waveAmp = 0.86; st.chopAmp = 0.72; st.foamGain = 0.34;
      st.frontS = -1e9; st.frontV = 0; st.stallT = 0; st.broke = false; st.crashT = -1;
      st.aheadDrop = 0; st.behindSurge = 0; st.aheadSurge = 0;
      st.run = null;
      tsuRunupFor(ctx);            // its bed is laid a few rows a frame below
      tsuPublish(ctx, 0);
      narrate("hint", "TSUNAMI, the sea is PULLING BACK. GET HIGH!", 3.6);
      soundAt("siren", ctx.cx, ctx.cz);
      if (CBZ.shake) CBZ.shake(0.3);
    },
    warnTick(dt, ctx) {
      const st = ctx.st;
      st.warnT += dt;
      if (tsuRun && !tsuRun.ready) tsuRun.bedSlice(6);
      st.eventT = (st.eventT || 0) + dt; st.phaseT = (st.phaseT || 0) + dt;
      const k = Math.min(1, st.warnT / TSUNAMI_V2.warnSecs);
      /* THE DREAD BEAT, AND IT IS THE WHOLE WARNING. The sea empties off the
         shelf — hundreds of metres of wet seabed, boats on the mud, the reef
         showing. It is the signal that has actually saved lives, and it beats
         a siren because it is information you have to KNOW how to read rather
         than a label telling you what to feel (city/tsunami.js's argument,
         and this is now the same one number driving it). */
      const drawK = (st.draw != null ? st.draw : TSU_DRAW) * (k * k * (3 - 2 * k));
      surgeSet(drawK);
      /* THE TROUGH COMES FROM THE WAVE'S SIDE. A leading-depression tsunami
         empties the facing shelf first; the lee only feels it late and
         weakly (the island shelters it), so the drawdown is a half-strength
         echo there that starts once the facing side is already bare. */
      const lk = Math.max(0, Math.min(1, (k - 0.45) / 0.55));
      tsuLee(st, drawK, drawK, drawK * TSU_LEE_DRAW * lk * lk * (3 - 2 * lk));
      st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.level;
      st.waveAmp = 0.86 + k * 0.38;
      st.chopAmp = 0.72 + k * 0.62;
      st.foamGain = 0.34 + k * 0.18;
      /* THE WHITE LINE ON THE HORIZON. Every piece of footage has it: while
         the reef is still draining, a thin bright line appears far out and
         grows. The bore is built here, 330 m out, and runs in at open-sea
         speed to the 52 m mark where the sweep takes over, standing up as it
         comes: long, low and mostly foam at first, a wall by the end. */
      if (k > 0.3) {
        if (!st.face) {
          if (st.H == null) st.H = Math.max(10, Math.min(44, 34 * (st.mag != null ? st.mag : 1)));
          tsuBuildWave(ctx);
        }
        const u = Math.min(1, (k - 0.3) / 0.7);
        st.frontS = -(ctx.R + 330) + (330 - 52) * u;
        const oy = (ctx.arena && ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8) + (st.draw != null ? st.draw : TSU_DRAW) * (k * k * (3 - 2 * k));
        st.faceH = st.H * (0.10 + 0.26 * u * u);
        if (st.face) CBZ.tsuFaceUpdate(st.face, {
          t: CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001, dt: dt,
          height: st.faceH, turbid: 0.12 * u, curl: 0.12 + 0.25 * u, foam: 0.9,
          x: ctx.cx + st.dx * st.frontS, y: oy - 1.0, z: ctx.cz + st.dz * st.frontS, seaY: oy,
          dirX: st.dx, dirZ: st.dz,
        });
        // the roar arrives before the water does
        st.roarCd = (st.roarCd || 0) - dt;
        if (st.roarCd <= 0) { st.roarCd = 1.1 - 0.6 * u; sound("rumble"); }
        if (CBZ.shake) CBZ.shake(0.04 + 0.16 * u * u);
      }
      tsuPublish(ctx, -0.5 * k);
      if (CBZ.shake) CBZ.shake(0.05);
      st.sirenCd = (st.sirenCd || 0) - dt;
      if (st.sirenCd <= 0) { st.sirenCd = 2.6; soundAt("siren", ctx.cx, ctx.cz); }
      if (rnd() < dt * 0.7) sound("water");
      if (!st.saidBed && k > 0.62) { st.saidBed = 1; narrate("hint", "The seabed is EXPOSED. IT'S COMING", 2.6); }
    },
    // during the drawdown the whole low island is the danger — that is what
    // puts 99 survivors on the mountain path, and a crowd running uphill IS
    // the tsunami warning for anyone who was not looking at the sea
    warnThreat(x, z, ctx) { return floor(x, z) < 8 ? 0.75 : 0.05; },
    warnSafeDir(x, z, ctx) { return uphill(ctx, x, z, 9); },
    start(ctx) {
      const st = ctx.st, R = ctx.R;
      st.phase = "sweep";
      /* SIZED BY THE ROLL (st.mag, rolled in warn(), intensity-biased): a
         small one is a ~10 m wall and a town-deep flood you can outclimb on
         any roof; the monster is a 44 m wall taller than the mountain path
         and a flood pushing the 14.3 cap. The refuges still have to survive
         — the caps are unchanged — or the event has no answer. */
      const mg = st.mag != null ? st.mag : 1;
      st.H = Math.max(10, Math.min(44, 34 * mg));
      // metres of SURGE at full inundation (rest sea sits at -0.8), chosen so
      // the town goes 1-2 storeys under while the mountain and the tower roofs
      // stay dry — the refuges have to survive or the event has no answer
      st.floodSurge = Math.min(14.3, 4.6 + 7.6 * mg);
      st.frontS = -(R + 52);
      /* THE SWEEP'S SHARE OF THE BUDGET. 0.44 of 26 s was 11.4 s to cross
         344 m; 0.46 of 16 s is 7.4 s for the same ground — the front is
         half again as fast, and the beats it has to hit (approach, stand,
         crash, crossing) all still fit inside it. */
      // the sweep's own budget (it was 0.46 x a 16 s event: 7.4 s)
      const sweepSecs = TSU_FAST() ? 7.4 : 11.4;
      st.speed = (2 * R + 104) / sweepSecs;   // legacy constant walk
      /* SHOALING (TSU_SHOAL_V2): integrate the relative-speed profile over
         the whole travel and scale it so approach + stand + crash + crossing
         land in the SAME sweep budget the constant speed used — the director's
         clock, the flood phase and the drain cannot tell the difference. */
      st.broke = false; st.stallT = 0; st.crashT = -1; st.frontV = st.speed;
      if (CBZ.CONFIG.TSU_SHOAL_V2 !== false) {
        /* THE STAND IS A BEAT, NOT A PAUSE. At 1.25 s the wall came to a
           genuine halt at the seawall and you could watch it not move; the
           held breath and the crash still land at 0.45 s, and the wave reads
           as standing up rather than as stopped. */
        st.stallSecs = TSU_FAST() ? 0.45 : 1.25;
        let unit = 0;
        for (let s0 = -(R + 52); s0 < R + 52; s0 += 0.5) unit += 0.5 / tsuVRel(ctx, s0);
        st.speedK = unit / Math.max(2, sweepSecs - st.stallSecs);
      } else st.speedK = 0;
      st.waveAmp = 1.55; st.chopAmp = 2.15; st.foamGain = 0.82;
      st.waveId = "tsu" + CBZ.now + rnd();
      st.landfall = false;
      if (!st.wave) tsuBuildWave(ctx);
      // NO INUNDATION MESH. The sea itself comes over the island (surgeSet),
      // which is why the swimmer, the buoyancy, the drifting corpses and the
      // submergence test all agree without any of them being told.
      /* NO ISLAND-WIDE SPRAY CLOUD. A 320-mote fx.particleCloud used to rain
         square white points over 80% of the island from the moment the sweep
         began: stars in the sky of every shot. The spray belongs to the lip
         (the face's own GPU spray, below), and nowhere else. */
      st.sediment = 0; st.undertowT = 0; st.carWatch = null;
      st.faceS = null;
      tsuRunStart(ctx);                         // the land is a flow from here on
      st.debris = undefined;                    // built lazily on first contact
      tsuPublish(ctx, 2.2);
      if (CBZ.shake) CBZ.shake(0.5);
      sound("water"); sound("rumble");
    },
    active(dt, ctx) {
      const st = ctx.st;
      st.eventT = (st.eventT || 0) + dt;
      st.activeT = (st.activeT || 0) + dt;
      if (st.phase !== st.timedPhase) { st.timedPhase = st.phase; st.phaseT = 0; }
      st.phaseT = (st.phaseT || 0) + dt;
      if (st.phase === "sweep") st.sweepT = (st.sweepT || 0) + dt;
      /* A LEADEN SKY, and it took a screenshot to learn why the old one was
         not. modes/survival.js paints BOTH the fog and the sky dome from
         env.fog, and the renderer is sRGB — so 0x35607e, which reads as a dark
         slate in a hex picker, came out of the encoder as a pale cyan haze
         that turned every tsunami shot white and drowned the water in it. The
         values below are chosen for what leaves the renderer, not for what
         they look like in the source: overcast, desaturated, and dark enough
         that gray-black water can read as gray-black water. */
      /* ...AND IT IS A WARM ONE. 0x1c2b34 was a cold slate: correct for a
         winter storm, wrong for the day the sea comes in, and it was fighting
         the water — a gray-brown flood under a blue-gray sky reads as two
         unrelated materials, because the sheen the sheet reflects IS this
         colour. Warmed and very slightly desaturated (a haze of atomised
         seawater and pulverised town), with the sun knocked back and the
         hemisphere dropped and dirtied so nothing is lit from a clean sky.
         Deliberately small: the buildings have to stay readable, and murk is
         not the same feeling as dread. */
      ctx.env.fog = 0x2b2724; ctx.env.fogNear = 65; ctx.env.fogFar = 500;
      ctx.env.sunInt = 0.47; ctx.env.sunColor = 0xd6cec2;
      ctx.env.hemiInt = 0.70; ctx.env.hemiColor = 0x7a736c;
      if (st.phase === "sweep") {
        if (CBZ.CONFIG.TSU_SHOAL_V2 !== false && st.speedK) {
          /* ---- SLOWEST AT ITS TALLEST, THEN THE CRASH ---------------------
             The front decelerates up the shelf (tsuVRel), and in the last
             metre and a half of open water it all but stops: the wall STANDS
             at full height over the beach for stallSecs — the reference
             frame, and the slowest the wave will ever move — still creeping,
             still boiling, and then the lip comes down. */
          let v = st.speedK * tsuVRel(ctx, st.frontS);
          if (!st.broke && -(st.frontS + ctx.R) <= 1.6) {
            if (st.stallT < st.stallSecs) {
              // THE HELD BREATH: the world goes quiet while the wave stands,
              // so the crash has silence to land in (CBZ.audioHush)
              if (!st.stallT && CBZ.audioHush) CBZ.audioHush(true);
              st.stallT += dt; v = st.speedK * 0.02;
            }
            else { st.broke = true; st.crashT = 0; st.crashAtT = st.eventT || 0; tsuCrash(ctx); }
          }
          if (st.crashT >= 0) st.crashT += dt;
          st.frontV = v;
          st.frontS += v * dt;
        } else {
          st.frontV = st.speed;
          st.frontS += st.speed * dt;
        }
        /* 2026-09-27, THE EDGE (tsuLevels above). The single-level arc this
           replaced walked the WHOLE island's water up with `land^0.75`, so
           the street 200 m ahead of the wall was already under 7 m of sea.
           Now: AHEAD of the front the reef stays drained until the wall is
           on it (the stranded boats and the bare seabed are in frame right
           up to the impact), and the far side's sea eases back to rest as
           the front crosses. BEHIND it the flood is deep at once (a bore
           brings its water with it) and deepens to the full inundation by
           the far shore; past the far beach the two levels meet, so the
           flood phase inherits one sea with no pop. */
        const approach = Math.min(1, (st.frontS + ctx.R + 52) / 52);
        const land = Math.max(0, Math.min(1, (st.frontS + ctx.R) / (2 * ctx.R)));
        const drawM = st.draw != null ? st.draw : TSU_DRAW;
        const out = Math.max(0, Math.min(1, (st.frontS - ctx.R) / 52));   // past the far beach
        let behind, ahead;
        // the face is drawn off the old schedule's step (its look is tuned to
        // it); the field's sea behind the bore stands higher, see below
        const faceBehind = land <= 0 ? drawM + (1.2 - drawM) * ease(approach) : 1.2 + (st.floodSurge - 1.2) * Math.sqrt(land);
        if (land <= 0) {
          // with the field, the sea behind the bore climbs to its landfall
          // head across the approach, so there is no step at the shoreline
          const top = st.run ? st.floodSurge * 0.8 : 1.2;
          behind = drawM + (top - drawM) * ease(approach); ahead = drawM;
        }
        else if (st.run) {
          /* WITH THE RUN-UP FIELD the sea behind the bore is AT HEIGHT the
             moment it reaches the shore: the bore brings its water with it,
             and it is that standing head of sea that drives the run-up up
             the streets. (Without the field the island was the sea, and a
             full-height sea at landfall drowned the whole town at once.) */
          behind = st.floodSurge * (0.8 + 0.2 * Math.min(1, land * 3));
          ahead = drawM * (1 - land) * (1 - land);
          ahead += (behind - ahead) * ease(out);
        } else {
          behind = 1.2 + (st.floodSurge - 1.2) * Math.sqrt(land);
          ahead = drawM * (1 - land) * (1 - land);
          ahead += (behind - ahead) * ease(out);
        }
        tsuLevels(st, behind, ahead);
        /* THE LEE: still drawn (the half-strength trough) until the front is
           across, then a small late wrap-around once the wave has passed the
           island's far shore. The water that reaches the lee coast first is
           the run-up crossing the land, not the sea coming round. */
        {
          const L = st.lee;
          const leeAhead = drawM * TSU_LEE_DRAW * (1 - land) * (1 - land);
          const sM = L ? L.sMax : ctx.R;
          const wk = Math.max(0, Math.min(1, (st.frontS - sM) / (0.6 * ctx.R + 52)));
          const wrapTop = TSU_WRAP * st.floodSurge;
          tsuLee(st, behind, ahead, leeAhead + (wrapTop - leeAhead) * ease(wk), leeAhead);
        }
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0.8;
        const aheadY = (ctx.arena && ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8) + ahead;
        const fx0 = ctx.cx + st.dx * st.frontS, fz0 = ctx.cz + st.dz * st.frontS;
        /* ---- THE FACE IS SCALED BY THE WATER UNDER IT ---------------------
           A tsunami in open water is long, low and barely visible; it stands
           up when it FEELS THE BOTTOM, and it is at its tallest, steepest and
           most overhung the instant before it breaks. Then it stops being a
           wave at all and becomes a gray-black soup with an edge.

           THE ARENA HAS NO BATHYMETRY, and pretending otherwise was wrong:
           `groundHeightAt` returns a flat 0 everywhere outside the hills while
           the sea rests at -0.8, so a literal depth query offshore reads
           NEGATIVE and reported "fully shoaled, fully turbid" from the first
           frame — the open-sea curl never existed. The honest signal in this
           world is the water the bore still has in front of it: the 52 m of
           open water between the wall's start and the beach, which is the same
           span the APPROACH easing above already uses. One number, and it can
           never disagree with the surge because it IS the surge's span. */
        const toShore = -(st.frontS + ctx.R);          // m of open water left
        const shoal = 1 - Math.max(0, Math.min(1, toShore / 52));
        /* Clean out at sea and filthy by the time it is in the streets — and
           the important half of that curve is that it is ALREADY DIRTY WHEN IT
           BREAKS. A bore does not pick up its load after landfall; it scours
           the shelf on the way in, which is why the wave that comes over the
           seawall at Miyako is gray-black before it has touched a building.
           So shoaling alone carries it to 0.62, and the town takes it to 1. */
        let turbid = Math.max(0, Math.min(1, (st.frontS + ctx.R + 8) / 34));
        turbid = Math.max(turbid, Math.pow(shoal, 1.5) * 0.62);
        // the crash aerates and muddies the whole face at once: a broken wave
        // is foam and scoured bottom, whatever it was the instant before
        if (st.broke) turbid = Math.max(turbid, Math.min(1, 0.78 + st.crashT * 0.4));
        st.sediment = turbid;
        st.shoal = shoal;
        /* ---- AND THEN IT SPENDS ITSELF, FROM THE SHORELINE ----------------
           The collapse used to begin at `st.frontS > 0` — the island's
           CENTRE. A 240 m crossing therefore held the full landfall height
           for its entire first half and was still floored at 40% of it as it
           left the far side: a wall of water touring an island rather than a
           bore breaking on one, which is exactly what it looked like.

           A bore stops being a wall the moment it is over land. It is
           climbing, and it is spending itself on every metre of ground,
           building and tree it runs through — the wall becomes a fast, deep,
           dirty flood, and the flood is the surge, which is already rising
           underneath it on the very same span. So the decay is measured
           against `land`, the crossing fraction surgeSet is built from: as
           the wall gives its height up, the water it was carrying is the
           water filling in behind it, and the two can never disagree because
           they are the same number. Nothing here touches wetness, depth or
           the catch height — the face has never owned any of those. */
        const spent = Math.max(0.08, Math.pow(1 - land, 1.45));
        st.spent = spent;
        const grp = st.wave;
        if (st.face) {
          /* Tallest at the instant it breaks — and the GROWTH is concentrated
             late (shoal^1.7): long and low over deep water, visibly STANDING
             UP in the final approach as the speed drains out of it, which is
             Green's law arriving on screen. The crash then drops the lip 26%
             in one beat (recovering into the lower broken-bore face) and
             folds the overhang away — a collapsing mass, not a curl. */
          const crashDip = st.broke ? (1 - 0.26 * Math.exp(-Math.max(0, st.crashT) * 1.15)) : 1;
          const crashCurl = st.broke ? Math.max(0.3, 1 - Math.max(0, st.crashT) * 1.1) : 1;
          const hs = (0.40 + 0.74 * Math.pow(shoal, 1.7)) * spent * crashDip;
          /* THE FACE STANDS ON THE WATER IN FRONT OF IT, not on the flood
             behind it: its foot is the drained reef / the dry street, and it
             is as tall as the step it is carrying plus the breaking crest
             above that. The crest's height over the flood is the old faceH,
             unchanged; only the base moved down to where the water is. */
          const step = Math.max(0, (ctx.arena && ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8) + faceBehind - aheadY);
          st.faceH = Math.max(2, st.H * hs + step - 1.2);
          st.faceY = aheadY - 1.2;
          /* AFTER THE CRASH THE WALL IS THE FLOOD. With the run-up field on,
             the broken bore over the town is the field's own front (its
             surface and froth on the shared sheet), so the presentation wall
             collapses into it in about a second and a half: it rolls in at a
             bore's speed (~9 m/s, not the scripted offshore front's) and
             sinks into the water it became. */
          if (st.run && st.broke) {
            if (st.faceS == null) st.faceS = st.frontS;
            st.faceS += 9 * dt;
            const post = Math.exp(-Math.max(0, st.crashT) * 1.7);
            st.faceH = Math.max(0.5, st.faceH * post);
            if (post < 0.06 && st.wave) st.wave.visible = false;
          }
          CBZ.tsuFaceUpdate(st.face, {
            t: CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001, dt: dt,
            height: st.faceH, turbid: turbid,
            // a spent surge does not overhang: the curl goes with the height
            curl: (0.22 + 1.35 * shoal) * (1 - turbid * 0.62) * Math.max(0.22, spent) * crashCurl,
            foam: st.foamGain,
            // the crash tears the whole crest into the air for a beat
            spray: st.broke && st.crashT < 0.9 ? 1.9 - st.crashT : 1,
            x: st.faceS != null ? ctx.cx + st.dx * st.faceS : fx0, y: st.faceY + Math.sin(CBZ.now * 0.005) * 0.4,
            z: st.faceS != null ? ctx.cz + st.dz * st.faceS : fz0, seaY: aheadY,
            dirX: st.dx, dirZ: st.dz,
          });
          grp.rotation.z = Math.sin(CBZ.now * 0.0035) * 0.016;
        }
        tsuPublish(ctx, 4.2);
        // LEGACY LANDFALL (TSU_SHOAL_V2 off): the single blast + "BRACE!".
        // With the flag on, tsuCrash() already fired at the end of the stand
        // and set st.landfall, so this never runs twice.
        if (!st.landfall && st.frontS > -(ctx.R - 6)) {
          st.landfall = true;
          CBZ.fx.blast(fx0, fz0, { maxR: 26, color: 0xd9f2ff, shake: 1.15, life: 0.8 });
          narrate("toast", "BRACE!");
          sound("collapse"); sound("water");
        }
        /* THE ROAR CLOSES IN. Shake and rumble scale with how close the
           front is to YOU (ahead of it or already behind it), from 150 m
           out, and with how big this one is; a tower roof 30 m up feels
           the building shudder but not the water's fist. */
        const E = eyePos(), pS = tsuS(ctx, E.x, E.z);
        const pd = Math.abs(pS - st.frontS);
        const near = Math.max(0, 1 - pd / 150);
        if (near > 0) {
          const hk = Math.max(0.35, 1 - Math.max(0, E.y - st.level) / 30);
          const mk = 0.6 + 0.4 * Math.min(1.3, st.mag != null ? st.mag : 1);
          if (CBZ.shake) CBZ.shake((0.08 + 0.62 * near * near * near) * hk * mk);
          st.roarCd = (st.roarCd || 0) - dt;
          if (st.roarCd <= 0) { st.roarCd = 0.55 + 1.1 * (1 - near); soundAt("rumble", fx0, fz0); if (near > 0.6) sound("water"); }
        }
        if (rnd() < dt * 8) sound("water");
        tsuCatch(dt, ctx);
        tsuWade(dt, ctx);
        tsuSmash(ctx);
        tsuCarHandoff(ctx);
        floodActors(dt, ctx, 4.2, "drowned in the flood", st.dx, st.dz);
        // the debris rides the BORE's speed, not a constant: near-still while
        // the wave stands, then surging inland with the released front
        tsuFlotsam(dt, ctx, CBZ.CONFIG.TSU_SHOAL_V2 !== false && st.frontV != null
          ? Math.min(8.5, 2 + st.frontV * 0.12) : 5.4);
        if (st.frontS > ctx.R + 52) tsuEnterFlood(ctx);
      } else if (st.phase === "flooded") {
        st.floodT += dt;
        tsuLevels(st, st.floodSurge, st.floodSurge);
        tsuLee(st, st.floodSurge, st.floodSurge, TSU_WRAP * st.floodSurge);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.floodSurge;
        st.sediment = 0.95;
        tsuPublish(ctx, 1.6);
        // the standing flood: the haze thickens a little and warms a little
        // more (the town is in the water now), but the light comes back up —
        // this is the beat the player has to read roofs and routes across.
        ctx.env.fog = 0x322d28; ctx.env.fogNear = 58; ctx.env.fogFar = 440; ctx.env.sunInt = 0.54; ctx.env.hemiInt = 0.76; ctx.env.hemiColor = 0x857d74;
        floodActors(dt, ctx, 1.6, "drowned in the flood", st.dx, st.dz);
        tsuCarHandoff(ctx);
        tsuFlotsam(dt, ctx, 1.6);
        if (rnd() < dt * 2.5) sound("water");
        /* THE SEA HOLDS while the run-up is still climbing (the land's water
           still growing by more than 3% a second), at least the old beat
           and never past 11 s: a long-period wave's crest, not a fixed one. */
        const base = TSU_FAST() ? 4.8 : 8.8;
        if (st.run) {
          const v = st.run.landVol, pv = st.runVolPrev != null ? st.runVolPrev : v;
          st.runVolPrev = v;
          const growing = dt > 0 && (v - pv) / dt > 0.03 * Math.max(1, v);
          if (st.floodT < base) st.floodBudget = base;
          else if (growing) st.floodBudget = Math.min(11, Math.max(st.floodBudget || base, st.floodT + 0.25));
        } else st.floodBudget = base;
        if (st.floodT > st.floodBudget) { st.phase = "drain"; st.drainFrom = st.floodSurge; st.trainT = 0; st.trainPrev = st.floodSurge; narrate("hint", "It's going back out. Hold on.", 2.4); }
      } else {  // drain — the backwash and the wave train behind it
        /* A TSUNAMI IS A WAVE TRAIN, NOT ONE WAVE (2026-10-20, owner: "the
           way tsunamis disappear is unrealistic"). The old drain walked the
           sea down to a trough and the event ended on a clock: one crest and
           a fade. Every Tohoku and Aceh record shows the sea going out HARD
           (the backwash, the half that drags the town out with it), then a
           second and a third crest, each lower, minutes apart, the sea brown
           and heaving the whole time. Time-compressed here to ~30 s; the
           crests come from the same side as the first (the lee shadow still
           holds), and what the land still holds after the last one drains
           on its own (world/tsunami_runup.js), long after this card. */
        st.trainT = (st.trainT || 0) + dt;
        const F0 = st.floodSurge, T0 = 0.5 * (st.draw != null ? st.draw : TSU_DRAW);
        const sc = TSU_FAST() ? 0.8 : 1;
        const K = TSU_TRAIN;
        const tt = st.trainT / sc;
        let lvl = 0;
        if (tt >= K[K.length - 1][0]) lvl = 0;
        else for (let i = 1; i < K.length; i++) {
          if (tt > K[i][0]) continue;
          const a0 = K[i - 1], a1 = K[i];
          const u = Math.max(0, Math.min(1, (tt - a0[0]) / Math.max(0.001, a1[0] - a0[0])));
          const v0 = a0[1] >= 0 ? a0[1] * F0 : -a0[1] * T0, v1 = a1[1] >= 0 ? a1[1] * F0 : -a1[1] * T0;
          lvl = v0 + (v1 - v0) * u * u * (3 - 2 * u);
          break;
        }
        const dS = dt > 0 ? (lvl - (st.trainPrev != null ? st.trainPrev : lvl)) / dt : 0;
        st.trainPrev = lvl;
        tsuLevels(st, lvl, lvl);
        // the lee: a small late echo of each crest, a weaker trough
        tsuLee(st, lvl, lvl, lvl > 0 ? TSU_WRAP * lvl : lvl * 0.6);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
        const drainK = Math.max(0, Math.min(1, Math.max(0, lvl) / Math.max(0.1, F0)));
        st.drainK = drainK;      // 1 = still fully inundated, 0 = the sea is at or under rest
        // the sea stays heaving and brown through the whole train
        const agit = 1 - 0.4 * Math.min(1, tt / K[K.length - 1][0]);
        st.waveAmp = 0.86 + 0.42 * agit; st.chopAmp = 0.72 + 0.62 * agit; st.foamGain = 0.40 + 0.30 * agit;
        st.sediment = Math.min(1, 0.62 + 0.38 * agit);
        /* ---- THE UNDERTOW (TSU_UNDERTOW) --------------------------------
           Everything the wave brought in leaves through the same gap, faster
           than it arrived, and this is the half that drowns the people who
           survived the impacts. Strongest while the sea is FALLING fastest
           (the first backwash is the violent one), and each later crest
           pushes back in before its own, weaker, run back out. */
        const fall = Math.max(0, Math.min(1, -dS / Math.max(0.5, F0 / 5)));
        const rise = Math.max(0, Math.min(1, dS / Math.max(0.5, F0 / 5)));
        const undertow = CBZ.CONFIG.TSU_UNDERTOW === false ? -0.7 * drainK
          : (rise > 0.05 ? 1.2 + 2.6 * rise : -(1.2 + 8.0 * fall));
        st.undertow = undertow;
        tsuPublish(ctx, undertow);
        floodActors(dt, ctx, CBZ.CONFIG.TSU_UNDERTOW === false ? -0.7 : (rise > 0.05 ? 1.2 * rise : -(1.1 + 2.4 * fall)),
          rise > 0.05 ? "drowned in the flood" : "dragged out to sea by the undertow", st.dx, st.dz);
        tsuCarHandoff(ctx);
        tsuFlotsam(dt, ctx, undertow);
        tsuUndertowDrown(dt, ctx, Math.max(drainK, fall));
        tsuWade(dt, ctx);
        if (tt >= K[K.length - 1][0]) st.endIn = 0;     // the sea is back at rest: the card ends here
      }
      // heavier fog with your face at the surface — city/swim.js owns the
      // swimmer now, so this reads its published state instead of a local flag
      const sw = CBZ.citySwimState && CBZ.citySwimState();
      if (sw && sw.swimming) { ctx.env.fog = 0x101c22; ctx.env.fogNear = 4; ctx.env.fogFar = 42; }
    },
    end(ctx) {
      const st = ctx.st;
      /* THE BACKWASH OUTLIVES THE CARD. The sea is put back below, but the
         water still on the land keeps running down to it (the field stays
         attached until it has drained) and the wreckage keeps riding it. */
      if (st.run && CBZ.tsuRunup.current() === st.run) {
        st.run._endT = st.run.t;
        const deb = st.debris, sdx = st.dx, sdz = st.dz, F = st.run;
        if (deb) F.after.push(function (dt) { deb.step(dt, { dx: sdx, dz: sdz, flow: 0, sediment: 0.6, front: null }); });
        // and the ground soaks up what is left standing in the hollows: the
        // same few centimetres a second everywhere, so the thin sheets on
        // the rises go first and the deep hollows hold their water longest.
        // F.hurry (the calm running long) only steepens the ramp.
        F.hurry = 0;
        F.after.push(function () {
          const a = F.t - F._endT;
          F.seep = Math.min(0.025 + 0.06 * F.hurry, (0.0012 + 0.004 * F.hurry) * a);
        });
      }
      // ONE LINE PUTS THE SEA BACK. There is no mesh to reposition, no sheet
      // to delete and no swimmer to stand down.
      surgeSet(0);
      st.aheadDrop = 0; st.behindSurge = 0; st.aheadSurge = 0; st.faceY = null;
      // an event cancelled mid-stand must not leave the world muted
      if (CBZ.audioHush) CBZ.audioHush(false);
      const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
      /* THE SEA DOES NOT SNAP CLEAN. The soup and the heave settle over the
         calm (tsuSeaCalmStep, on the director's tick); a new card's own
         writes cancel it, so one event's soup never tints the next. */
      if (W) {
        W.opacity = 1; W.flowSpeed = 0.5; W.stand = 1; W.aheadDrop = 0;
        tsuSeaCalm = { t: 0, dur: 45, amp: W.amp, chop: W.chop, foam: W.foam, sed: Math.max(0.55, W.sediment || 0), churn: Math.max(0.25, W.churn || 0) };
      }
      const o = ctx.arena && ctx.arena.ocean;
      if (o) o.position.y = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
      if (CBZ.waterEventClear) CBZ.waterEventClear("survival-tsunami");
      st.sediment = 0;
      if (st.face) {
        if (CBZ.tsuFaceDispose) CBZ.tsuFaceDispose(st.face);
        st.face = null; st.wave = null; st.waveWall = null; st.waveBasePos = null;
      }
      if (st.wave) { st.wave.traverse((ob) => { if (ob.geometry) ob.geometry.dispose(); if (ob.material && ob.material.dispose) ob.material.dispose(); }); root().remove(st.wave); st.wave = null; }
      /* THE DEBRIS DOES NOT LEAVE WITH THE WATER. Everything the wave carried
         is stranded exactly where the drain put it — a car on its roof in a
         street, a pine across a doorway — and it stays there for the rest of
         the match. That wreckage IS the aftermath, and deleting it would be
         throwing away the only thing the event leaves behind. */
      if (st.debris) { st.debris.strandAll(); st.carWatch = null; }
      const bots = CBZ.bots;
      for (let i = 0; i < bots.length; i++) bots[i]._survSwim = 0;
    },
    threat(x, z, ctx) {
      const st = ctx.st;
      const gH = floor(x, z);
      if (!st.phase || st.phase === "warn") return gH < 8 ? 0.75 : 0.05;   // stampede uphill during the drawdown
      if (st.phase === "sweep") {
        let t = 0;
        if (gH < Math.min(24, st.level + Math.min(22, (st.H || 34) * 0.72))) {
          const d = tsuS(ctx, x, z) - st.frontS;               // + = ahead of the wall
          if (d > -6 && d < 55) t = 0.55 + 0.45 * (1 - Math.max(0, d) / 55);
        }
        if (floodDepth(x, z) > -1 && tsuS(ctx, x, z) < st.frontS) t = Math.max(t, 0.6);
        return t;
      }
      const depth = floodDepth(x, z);
      if (st.phase === "flooded") return depth > 0.4 ? Math.min(1, 0.45 + depth * 0.1) : 0.08;
      return depth > 0.6 ? 0.35 : 0.05;
    },
    safeDir(x, z, ctx) {
      const st = ctx.st;
      // the mean sea level the flood will REACH, in world Y — a hill lower
      // than that is not a refuge, it is a slower drowning
      const rest = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
      return uphill(ctx, x, z, rest + (st.floodSurge != null ? st.floodSurge : 10) + 2);
    },
  };

  DEFS.flood = TSUNAMI_V2;

  /* THE DUPLICATE STROKE POSE IS GONE. This file used to run a second
     order-46.5 pass that copied the player rig onto the water-owned position
     and wrote a swim pose — a byte-for-byte sibling of city/swim.js's own late
     pass, which exists for exactly the same ordering reason (animChar runs at
     23-46 and would otherwise stomp the pose). With swim.js un-gated for
     survival there is one of them again, in the file that owns the swimmer. */

  // tiny in-loop timer queue (avoids setTimeout drift / pausing issues)
  function setTimeout0(ctx, secs, fn) { (ctx.st.timers || (ctx.st.timers = [])).push({ t: secs, fn }); }
  function tick0(ctx, dt) { const T = ctx.st.timers; if (!T) return; for (let i = T.length - 1; i >= 0; i--) { T[i].t -= dt; if (T[i].t <= 0) { const f = T[i].fn; T.splice(i, 1); try { f(); } catch (e) {} } } }

  function near(pos, r) { const c = CBZ.camera.position; const dx = pos.x - c.x, dz = pos.z - c.z; return dx * dx + dz * dz < r * r; }

  /* ============================================================
     VOLCANIC ERUPTION — THE STRATOVOLCANO (2026-08-03 wave).

     OWNER: "lava in current game is dumb and see thru". It was, and the
     reason was one line of material setup: the old streams were
     MeshBasicMaterial + AdditiveBlending + opacity 0.95 BOXES. Additive
     blending cannot be opaque — it only ever ADDS to what is behind it —
     so grass showed through the lava, two crossing streams showed through
     each other, and no amount of colour tuning was ever going to make that
     read as rock. That material is gone (deleted 2026-09-28).

     What replaces it lives in world/volcanofx.js, keyed on a position and
     a height field so a city-side volcano can call exactly the same four
     builders. And it stopped being one hazard, because a stratovolcano
     is not one hazard. The owner's own science, implemented as the four
     things that actually kill people:

       LAVA          slow, and honestly the LEAST dangerous of the four —
                     you walk away from lava. It is opaque crusted rock
                     with an incandescent channel, it lights the hillside,
                     and it kills only what stands in it.
       PYROCLASTIC   THE killer. 400+ mph of 600 C rock and gas hugging
                     the ground down the FALL LINE. Nobody in the path
                     lives; there is no cover, no mitigation and no
                     mechanic except being somewhere else. So the lane is
                     telegraphed during the warning (rockfall trickles
                     down it, the crowd runs out of it) and inside it the
                     player gets the incineration WHITEOUT, not a health
                     bar.
       LAHAR         boiling ash + meltwater with the consistency of wet
                     concrete, down the VALLEY rather than the fall line.
                     Slower, relentless, drags you and crushes you, and
                     when it stops it SETS — the scar stays for the match.
       ASHFALL       microscopic glass. Unsheltered it shreds the lungs;
                     indoors you are safe from it, which is the whole
                     indoor/outdoor tension — until enough of it piles on
                     the roof, and then the roof is what kills you. That
                     load goes through the ONE structural ledger
                     (structureHit), never a second collapse rule.

     Shared by the standalone `volcano` disaster AND the earthquake's
     surprise eruption.
     ============================================================ */
  // THE NUKE FINALE (and every "you were IN it" death) draws its light
  // through city/nukefx.js's real whiteout sheet instead of a second one.
  if (CBZ.CONFIG.NUKE_FINALE_REAL == null) CBZ.CONFIG.NUKE_FINALE_REAL = true;

  /* THE ASH LADDER lives with the eruption (world/eruption.js, CBZ.eruption.ASH):
     the deposit that starts hurting the people outside is the same one on its
     way to killing the people who correctly went inside. Read, never copied. */
  const ER_ASH = (CBZ.eruption && CBZ.eruption.ASH) || { DOT: 0.006, FULL: 0.16, ROOF_FAIL: 0.055 };
  const ASH_DOT_DEPTH = ER_ASH.DOT;
  const ASH_VISUAL_FULL = ER_ASH.FULL;
  let pyroRuns = 0, laharRuns = 0, ashRoofCollapses = 0, whiteouts = 0;
  /* THE BODY COUNT, because the owner's "kills way too many people" deserves
     a number that a later edit cannot quietly undo. `volcanoDeaths` is the
     drop in the live roster across an eruption — measured off the mode's own
     aliveCount() rather than by instrumenting six kill sites, so nothing can
     kill someone by a path this counter does not see. */
  let bombsThrown = 0, volcanoDeaths = 0, volAliveAtStart = -1;
  /* ---- PER-ERUPTION MAGNITUDE --------------------------------------------
     OWNER, 2026-08-29: "all the natural disasters are cookie cutter size —
     there's no big one or small one." Every eruption now ROLLS a size off
     the seeded stream: M in [0.06, 1]. ~0.1 is a steam-and-ash burp you can
     stand and watch (short window, a modest column, two lava tongues, no
     collapse, no lahar, rare bombs); 1.0 is the big one (a ~190 m column
     that blots the sun, a six-stem fan, fast wide collapses, ash to the
     town, half a minute of it). The round's escalating ctx.intensity BIASES
     the roll — it bends the exponent, it never replaces the dice — so late
     rounds still throw the odd burp and an early round can throw the
     monster. window.__volcanoMagPin is the storyboard's staging pin
     (tools/visual-presets/volcano-stages.mjs), the same pattern as its wind
     pin — NOT a cfg flag, and no game code sets it. */
  let volMagCur = null;
  function rollMag(ctx) {
    if (ctx.st.erMag != null) return ctx.st.erMag;
    let M;
    const pin = (typeof window !== "undefined") ? window.__volcanoMagPin : null;
    if (Number.isFinite(pin)) M = Math.min(1, Math.max(0.04, pin));
    else M = 0.06 + 0.94 * Math.pow(rnd(), 1.7 - 0.9 * Math.min(1, ctx.intensity));
    ctx.st.erMag = M; volMagCur = M;
    return M;
  }
  let nukeFxRuns = 0;
  const volScars = [];           // set lahar + ash blanket: they OUTLIVE the eruption

  /* ---- THE LENS THE FINALE NEEDS -----------------------------------------
     WHY THE ARENA NUKE READ AS "orange geometric fake smoke", and it was
     never the fxR fallback. The real composer DOES run here: survBlast ->
     CBZ.detonate -> the `nuke` row -> city/nukefx.js's composeNuke, which
     registers itself lazily on the ALWAYS chain with no city gate anywhere
     in the file. What was wrong was the CAMERA.

       1. nukefx puts a researched cloud cap ~2.5 km up and ~1.4 km wide
          (formationDims: capY = R*20, capW = R*11 at R=126 m). The survival
          camera's far plane is 1000 m, because the pass that widens it
          (city/mode.js@94) returns immediately unless mode === "city". So
          the cap, the crown and the top of the stem were CLIPPED OFF at the
          far plane every frame, and the only survivors were the low ground-
          surge lobes sitting near the deck: detached orange blobs, no
          mushroom silhouette. Exactly what the owner described.
       2. This def then forced scene fog to 30/220 m. nukefx's lobes are
          fogproof by design, so a 220 m fog wall dissolved the entire world
          behind them and left unfogged geometry floating in front of a flat
          brown sheet — the "slightly opaque" half of the complaint.

     Both are lens settings, both belong to the caller, and both are fixed
     here from the cloud's OWN reported size. Nothing in city/nukefx.js
     changes. Degrade-safe: no debug hook, no camera, or the flag off, and
     this is inert. */
  let nukeFarSaved = null, nukeFarT = 0;
  function nukeFrustum() {
    if (CBZ.CONFIG.NUKE_FINALE_REAL === false || !CBZ.camera) return 0;
    let need = 0;
    if (CBZ.nukeFxDebug) {
      try {
        const d = CBZ.nukeFxDebug();
        if (d && d.live) need = (d.live.capYNow || d.live.riseH || 0) + (d.live.capWNow || d.live.capW || 0) * 1.2 + 600;
      } catch (e) { need = 0; }
    }
    if (!(need > 0)) need = 4200;      // the cloud is there whether or not the hook is
    need = Math.min(14000, Math.max(2600, need));
    if (CBZ.camera.far < need) {
      if (nukeFarSaved == null) nukeFarSaved = CBZ.camera.far;
      CBZ.camera.far = need;
      CBZ.camera.updateProjectionMatrix();
    }
    return need;
  }
  function nukeFrustumRestore() {
    if (nukeFarSaved == null || !CBZ.camera) return;
    CBZ.camera.far = nukeFarSaved; nukeFarSaved = null;
    CBZ.camera.updateProjectionMatrix();
  }

  function vfx() { return CBZ.volcanoFx; }
  // 0 at deep night, 1 at midday — core/daynight.js's own clock, so a disaster
  // tint can DIM the day without ever being able to invent one
  // survEnv is a DAYLIGHT grade: modes/survival.js darkens it for the hour
  // (one night grade for every disaster), so a def writes its daytime mood
  // and must not apply the night itself a second time.
  function dayK() { return 1; }
  function gAt(ctx) { return ctx.arena.groundHeightAt; }

  /* ---- THE INCINERATION WHITEOUT -----------------------------------------
     One grammar for every death where the answer to "what did you see" is
     LIGHT, not geometry: the pyroclastic front, and the nuke you are
     standing under. city/nukefx.js already owns that sheet (#nukeFlash) with
     a researched double-pulse envelope, and it is DOM — so it works at any
     camera distance, in any mode, and it still runs while the run is over.
     Degrade-safe: no nukefx, and the mode's own additive survEnv flash
     stands in exactly as it did before. */
  function incinerate(peak, fade) {
    if (CBZ.CONFIG.NUKE_FINALE_REAL !== false && CBZ.cityNukeWhiteout) {
      try {
        CBZ.cityNukeWhiteout(fade == null ? 2.4 : fade, peak == null ? 1 : peak, true);
        whiteouts++;
        return true;
      } catch (e) { /* fall through to the mode's own flash */ }
    }
    CBZ.fx.flash(peak == null ? 1 : peak, 0xfff2e0);
    return false;
  }

  /* ============================================================
     THE ERUPTION ITSELF IS world/eruption.js's (CBZ.eruption): the sequence
     (unrest -> phreatic blast -> Plinian column + umbrella -> bombs, plume
     lightning, lava -> collapse into a density current, lahar -> waning) and
     what it does to the houses, trees and cars around the mountain. This file
     hands it the ISLAND — the volcano's site (CBZ.island.volcano, else the
     arena's volcano hill), the height field, the buildings / trees / cars —
     and the hooks that price every consequence through this mode's ONE
     ledgers: structureHit for roofs, lava and bombs, THE fire (wildfire.js
     as a service: the lava margin, hot bombs and the density current light
     the fuel bed, the crowns, the houses and the cars, and it spreads from
     there), the blast bus, the roster.
     ============================================================ */
  function erSite(ctx) {
    if (ctx.st.erS) return ctx.st.erS;
    const S = CBZ.eruption ? CBZ.eruption.site(ctx.arena) : null;
    const h = ctx.arena.hills[0];
    ctx.st.erS = S || { x: h.x, z: h.z, peak: h.peak, r: h.r, rim: h.rim || 6.2 };
    return ctx.st.erS;
  }
  /* THE ISLAND'S ONE FIRE AS A SERVICE (systems/wildfire.js): a disaster
     that starts fires (the eruption, the meteor) lends it the same bridge
     the wildfire event gets: THE structural ledger, the blast bus for a
     car's tank, the shelter test, the wind, and a magnitude of its own. */
  function wfService(ctx, mag) {
    const WF = CBZ.wildfire;
    if (!WF || !WF.attach) return null;
    WF.attach(ctx.arena, {
      hitBuilding: function (b, amount, o) { return structureHit(b, amount, ctx, Object.assign({ kind: "fire" }, o || {})); },
      blast: function (kind, x, z, o) { survBlast(kind, x, z, Object.assign({ ctx: ctx }, o || {})); },
      sheltered: function (a) { return sheltered(a); },
      wind: function () { return windVec(); },
      mag: mag,
    });
    return WF;
  }
  function erHooks(ctx) {
    const WF = CBZ.wildfire;
    // the eruption's fires burn at a magnitude tied to the eruption's
    wfService(ctx, 0.3 + 0.3 * Math.min(1, rollMag(ctx)));
    return {
      shake(k) { if (CBZ.shake) CBZ.shake(k); },
      sound(name, x, z) { if (x != null) soundAt(name, x, z); else sound(name); },
      night() { return 1 - dayK(); },
      wind() { return windVec(); },
      igniteTree(t, why) { return !!(WF && WF.igniteTree(t, why || "eruption")); },
      igniteGround(x, z, r, why) { return !!(WF && WF.igniteAt(x, z, why || "eruption", r)); },
      // a house the lava reached, a hot bomb lodged in, a density current
      // rolled over: it burns floor by floor and pays the ledger as it goes
      burnBuilding(b, how) { return !!(WF && WF.igniteBuilding(b, how || "lava")); },
      damageBuilding(b, amount, kind) {
        const was = surv()._cause;
        // the killfeed names what actually came through the ceiling
        surv()._cause = kind === "ashload" ? "crushed by an ash-laden roof"
          : (kind === "lava" ? "buried when the lava took the house" : "crushed by a volcanic bomb through the roof");
        const stage = structureHit(b, amount, ctx, { kind: kind });
        surv()._cause = was;
        if (kind === "ashload" && b.fallen) ashRoofCollapses++;
        return stage;
      },
      // a car in the lava or under a hot bomb: the engine bay, then the tank
      carFire(c, why) { if (WF) WF.igniteCar(c, why || "lava"); },
      /* A BOMB IS A ROCK ARRIVING AT SPEED, priced by its own mass and impact
         speed. The real juvenile bombs go through the blast bus (the `kinetic`
         row, a volcano picture); the small clots and the cold lithics only
         bruise, so they price straight onto the roster. A direct hit by a
         big one kills; near it maims; the crater and the dust are drawn by
         the bomb field itself. */
      bombLand(info) {
        const massK = Math.min(1.2, Math.max(0.1, info.mass / 2500));
        const roof = info.hit && info.hit.kind === "roof";
        const cause = info.hot ? "caught by a volcanic bomb" : "struck by a block from the blast";
        if (info.hot && info.size >= 0.4) {
          survBlast("kinetic", info.x, info.z, {
            r: 3 + 5 * Math.min(1, info.size), dmg: scale(34, ctx) * massK, cause: cause, ctx: ctx,
            mass: info.mass, speed: info.speed, struct: roof ? 0 : 0.3 * massK, structR: 6 + 6 * massK,
            fx: { kind: "volcano" }, color: 0xff7a30, sfx: "punch", flash: 0.12 * massK,
            knockback: 12 * massK, fling: 6 * massK, y: info.y + 0.5,
          });
        } else {
          surv().hurtRadius(info.x, info.z, 1.2 + 2.2 * info.size, scale(30, ctx) * massK, { cause: cause, knockback: 6, fling: 2 });
          soundAt("punch", info.x, info.z);
        }
      },
      // a bolt out of the ash cloud to the flank: the storm's own strike
      groundStrike(x, z) {
        survBlast("lightning", x, z, {
          r: 0, ctx: ctx, up: 0.6, struct: 0.06, structR: 4.5, fx: { groundScale: 1 },
          draw: function (bx, by, bz) { if (CBZ.lightningStrike) CBZ.lightningStrike(bx, bz, { y: by, groundScale: 1 }); },
        });
        surv().forEachActor(function (a) {
          if (Math.hypot(a.pos.x - x, a.pos.z - z) < 2.6) surv().hurt(a, 1e6, { cause: "struck by lightning in the ash cloud", fromX: x, fromZ: z });
        });
      },
    };
  }
  // the eruption's handle, built at the WARNING (so the unrest and the lane
  // belong to the same object as the blast) or, for the earthquake's surprise
  // eruption, at the blast itself
  function erCreate(ctx) {
    if (ctx.st.er) return ctx.st.er;
    if (!CBZ.eruption) return null;
    const S = erSite(ctx);
    const M = rollMag(ctx);
    if (ctx.st.pyroBear == null) ctx.st.pyroBear = rnd() * 6.28;
    const A = ctx.arena;
    ctx.st.er = CBZ.eruption.create({
      site: S, groundAt: gAt(ctx), parent: root(), mag: M, rnd: rnd,
      region: { cx: ctx.cx, cz: ctx.cz, R: ctx.R },
      collapseBearing: ctx.st.pyroBear,
      world: { buildings: A.fragile || [], trees: A.flammable || [], cars: A.cars || [] },
      hooks: erHooks(ctx),
    });
    if (ctx.st.er) ctx.st.pyroLane = ctx.st.er.lane;
    return ctx.st.er;
  }

  function startEruption(ctx) {
    if (ctx.st.erupting) return;
    const E = erCreate(ctx);
    if (!E) return;
    ctx.st.erupting = true;
    try { volAliveAtStart = surv().aliveCount(); } catch (e) { volAliveAtStart = -1; }
    narrate("banner", "VOLCANIC ERUPTION");
    narrate("hint", "THE MOUNTAIN ERUPTS, stay off the lava!", 3);
    E.erupt();
    ctx.st.erWindX = E.windX; ctx.st.erWindZ = E.windZ;
  }

  function tickEruption(dt, ctx) {
    if (!ctx.st.erupting) return;
    const E = ctx.st.er;
    if (!E) return;
    const S = E.site, M = E.mag;
    const dk = dayK();
    const cp = camPos();
    /* THE AIR WHERE YOU STAND. The eruption answers three things about the
       camera's position: how much umbrella is overhead, how hard ash is
       falling through the air there, and how much has landed island-wide.

         DARKNESS AT NOON  every eyewitness account of an ashfall agrees on
                           it. Under the deck the sun goes (86%), and the
                           deposit browns the rest of the sky as it builds.
                           Out from under it, it is a dim brown afternoon.
         VISIBILITY        is where you stand: 380 m in the clear, the far
                           side of the street in the heaviest fall — a
                           hazard with an outside, because walking out of
                           the fall walks you back into the light.
         MIDNIGHT STAYS MIDNIGHT: dayK is the sun's own elevation, so a night
                           eruption is lit by its lava, not by a grade. */
    const env = E.envAt(cp.x, cp.z);
    const ashK = env.ashK, dark = env.dark;
    ctx.env.fog = lerpHex(0x120b08, lerpHex(0x2e211c, 0x181310, Math.max(ashK, env.cover)), dk);
    ctx.env.fogFar = Math.max(70, 380 - 90 * ashK - 300 * env.fall);
    ctx.env.fogNear = Math.min(55, ctx.env.fogFar * 0.3);
    /* the sun keeps its warmth and loses its strength: an ash sky is a dirty
       brown, never the saturated orange that painted the island peach */
    ctx.env.sunInt = 0.5 * dk * (1 - dark); ctx.env.sunColor = 0xd9714a;
    ctx.env.hemiInt = (0.14 + 0.42 * dk) * (1 - 0.6 * dark); ctx.env.hemiColor = 0x9c7461;
    /* THE DEPOSIT IS WEATHER ON THE GROUND (systems/weather.js's surface
       coat greys the downwind sector off the same wedge the ledger fills),
       and the GRAINS IN THE AIR are weather too — the same particle cloud the
       rain uses, in its ash look, as dense as the fall at the camera. */
    weather({
      rain: 0, wind: 5 + 4 * M, windDir: { x: E.windX, z: E.windZ },
      fog: 0.14 + 0.24 * M + 0.2 * ashK + 0.3 * env.fall, fogColor: 0x2e211c,
      ash: E.wedge(), ashfall: env.fall,
    });
    if (rnd() < dt * (0.8 + 1.6 * M)) sound("rumble");
    /* THE GROUND NEVER STOPS TALKING: a continuous tremor scaled by the size
       of the event, breathing slowly — the body's channel, not the eyes'. */
    if (CBZ.shake) CBZ.shake((0.012 + 0.1 * M) * (0.7 + 0.3 * Math.sin(CBZ.now * 0.0019)));

    E.update(dt, ctx.prog);

    /* INCANDESCENT ROCKFALL. The flanks are streaked with fine fire: spatter
       off the vent bouncing and rolling down the cone, each block a glowing
       tracer that cools to an ember and goes. Visual only — the bombs are
       the ones that hurt. */
    if (E.phase === "plinian") {
      ctx.st.erEmberCd = (ctx.st.erEmberCd || 0) - dt;
      if (ctx.st.erEmberCd <= 0) {
        ctx.st.erEmberCd = 0.4;
        const ea = rnd() * 6.28;
        const er = S.r * (0.35 + rnd() * 0.6);
        CBZ.fx.dropDebris({
          x: S.x + Math.cos(ea) * er, z: S.z + Math.sin(ea) * er,
          fromX: S.x + Math.cos(ea) * 1.5, fromZ: S.z + Math.sin(ea) * 1.5,
          fromY: S.peak + 2,
          size: 0.22 + rnd() * 0.3, shape: "rock", color: 0xff7e22, glow: true,
          dmg: 0, linger: 2 + rnd() * 2.5,
        });
      }
    }
    if (E.pyro && CBZ.shake) {
      const fp = E.pyro.frontPos();
      const dpx = Math.hypot(cp.x - fp.x, cp.z - fp.z);
      if (dpx < 70) CBZ.shake(0.5 * (1 - dpx / 70));
    }

    /* ---------------- THE ACTOR PASS ----------------
       Ordered by how fast the thing kills you, which is also the order in
       which the world gives you a chance: the density current first (none),
       the base surge, the crater and the lava (see it, don't stand in it),
       the lahar (get out of the channel), then the ash (survivable
       indefinitely indoors — until the roof goes, through the ledger). */
    const P = E.pyro, LH = E.lahar, LV = E.lava, AL = E.field, PH = E.phreatic;
    surv().forEachActor(function (a) {
      const ax = a.pos.x, az = a.pos.z;
      // 1) PYROCLASTIC FLOW. The HEAD is absolute: there is no surviving a
      //    wall of 600 C rock at 130 m/s, and a roof is no shelter. The
      //    trailing cloud is hot gas: lethal quickly, but the kind of lethal
      //    you can be dragged out of, so it prices as damage over time.
      if (P) {
        const zone = P.contains(ax, az);
        if (zone) {
          if (a.isPlayer) incinerate(1, zone === 1 ? 1.9 : 2.6);
          const fp = P.frontPos();
          if (zone === 1) {
            surv().hurt(a, 1e6, { cause: "incinerated by the pyroclastic flow", fromX: fp.x, fromZ: fp.z, fling: 9 });
            return;
          }
          surv().hurt(a, scale(30, ctx) * dt, { cause: "asphyxiated in the ash cloud", fromX: fp.x, fromZ: fp.z });
          if (a.dead) return;
        }
      }
      // 2) THE BASE SURGE off the phreatic blast: scalding steam and grit
      //    rolling down the cone. A wall stops it; out in the open it burns.
      if (PH && !sheltered(a)) {
        const k = PH.surgeAt(ax, az);
        if (k > 0) {
          surv().hurt(a, scale(26, ctx) * k * dt, { cause: "scalded by the blast's steam surge", fromX: S.x, fromZ: S.z });
          if (a.dead) return;
        }
      }
      // 3) the vent itself
      if (Math.hypot(ax - S.x, az - S.z) < S.rim * 0.55) { surv().hurt(a, 1e6, { cause: "swallowed by the crater", fromX: S.x, fromZ: S.z }); return; }
      // 4) LAVA — what kills you is exactly what glows
      if (LV) {
        for (let i = 0; i < LV.length; i++) if (LV[i].hitTest(ax, az)) {
          const t = LV[i].tip;
          surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: t.x, fromZ: t.z });
          return;
        }
      }
      // 5) LAHAR — it CARRIES you, and then it sets around you
      if (LH) {
        const m = LH.hitTest(ax, az);
        if (m) {
          if (CBZ.body) CBZ.body.hit(a, { dir: { x: m.dirx, z: m.dirz }, force: 4 + 6 * m.depth, fling: 0 });
          a.pos.x += m.dirx * (2.2 + 3.4 * m.depth) * dt;
          a.pos.z += m.dirz * (2.2 + 3.4 * m.depth) * dt;
          surv().hurt(a, scale(26, ctx) * m.depth * dt, { cause: "crushed in the lahar", fromX: ax - m.dirx, fromZ: az - m.dirz });
          return;
        }
      }
      /* 6) ASHFALL — glass in the lungs, and a roof is a real answer to it.
         The ledger is the only authority on where ash is (no picture, no
         damage), and it is a GRADIENT, not a switch: nothing at the edge of
         the fall, and even in the worst of it you have most of the eruption
         to walk out. */
      if (AL && !sheltered(a)) {
        const d = AL.depthAt(ax, az);
        const choke = Math.max(0, Math.min(1, (d - ASH_DOT_DEPTH) / 0.35));
        if (choke > 0) surv().hurt(a, scale(3.4, ctx) * choke * dt, { cause: "choked by volcanic ash" });
      }
    });
  }

  function endEruption(ctx) {
    if (!ctx.st.erupting) {
      // a warning that never reached the blast still owns its steam
      if (ctx.st.er) { const s0 = ctx.st.er.end(); for (let i = 0; i < s0.length; i++) volScars.push(s0[i]); ctx.st.er = null; }
      return;
    }
    if (volAliveAtStart >= 0) {
      try { volcanoDeaths += Math.max(0, volAliveAtStart - surv().aliveCount()); } catch (e) {}
      volAliveAtStart = -1;
    }
    const E = ctx.st.er;
    if (E) {
      pyroRuns += E.stats.pdcRuns; laharRuns += E.stats.laharRuns;
      bombsThrown += E.bombStats ? E.bombStats.thrown : 0;
      /* NOTHING POPS. The lava quenches black where it stands, the set lahar
         and the ash stay and erode, the bombs cool in their craters, and the
         sky — the column dispersing, the umbrella drifting off downwind —
         reports done when there is nothing left of it. */
      const scars = E.end();
      for (let i = 0; i < scars.length; i++) volScars.push(scars[i]);
      ctx.st.lastEr = E;
      ctx.st.er = null;
    }
    /* A SCAR IS A MEMORY, NOT A LEAK: two eruptions can happen in one match
       (the volcano and the earthquake's surprise one) and each leaves five
       (lava, lahar, ash, bombs, sky — the sky retires itself). Ten holds both. */
    while (volScars.length > 10) { const old = volScars.shift(); try { old.dispose(); } catch (e) {} }
    ctx.st.erWindX = ctx.st.erWindZ = null;
    ctx.st.erupting = false;
  }

  /* The scars are the one thing here that survives its own disaster, so they
     need their own teardown. 28.06 sits immediately after the mode-exit hook
     that puts the sea and the weather back. */
  // reused per frame: the aftermath re-asserts the ash veil every tick and a
  // fresh literal each time is allocation for nothing
  const _ashScar = { srcX: 0, srcZ: 0, windX: 1, windZ: 0, amount: 0, reach: 60, lobe: 3, spread: 0.05 };
  /* THE CALM SPEEDS THE SKY UP: the column and the umbrella disperse on
     their own physics, which is minutes; inside the director's settle window
     the sky scar runs on a 5x clock so the plume is gone before the next
     siren (and the calm cuts it, on the record, if it still is not). */
  let volSettleT = 0;
  CBZ.onAlways(28.06, function (dt) {
    let skyDt = dt;
    if (volSettleT > 0) { volSettleT -= dt; skyDt = dt * 5; }
    const inSurv = CBZ.game.mode === "survival" && !!(CBZ.surv && CBZ.surv.arena);
    if (volScars.length) {
      if (!inSurv) {
        for (let i = 0; i < volScars.length; i++) { try { volScars[i].dispose(); } catch (e) {} }
        volScars.length = 0;
      } else {
        /* a set deposit still has to tick — and the ASH is being WORKED ON
           by the weather now: the live wind strips it into streaks, rain
           washes it (world/volcanofx.js ashLoad's no-supply branch). The
           lava scar just finishes its colour walk. */
        let scarSpec = null;
        for (let i = 0; i < volScars.length; i++) {
          try {
            const sc = volScars[i];
            if (sc && sc.kind === "ash") {
              if (!scarSpec) {
                const w = windVec();
                let rn = 0; try { rn = (CBZ.weather && CBZ.weather.intensity) || 0; } catch (e2) {}
                scarSpec = { windX: w.x, windZ: w.z, rain: rn };
              }
              sc.update(dt, scarSpec);
              /* AND THE GROUND STAYS GREY UNTIL THE LEDGER SAYS OTHERWISE.
                 The veil is a DRIVEN weather term, and every driven term
                 bleeds out over RELEASE (3.5 s) the moment nobody asserts
                 it — which would wipe the island clean three and a half
                 seconds after an eruption ends, while the ledger still
                 holds a third of a metre of ash. So the scar keeps
                 asserting the same wedge it was fed, with the amount now
                 following its OWN decaying peak: the grey thins exactly as
                 the deposit erodes, and disappears when the deposit does.
                 Ash-only, so the eruption's brown fog still releases on
                 schedule (see ashHold in systems/weather.js). */
              const W = sc.wedge;
              if (W && CBZ.weatherDrive) {
                _ashScar.srcX = W.srcX; _ashScar.srcZ = W.srcZ;
                _ashScar.windX = W.ux; _ashScar.windZ = W.uz;
                _ashScar.reach = W.reach; _ashScar.lobe = W.lobe; _ashScar.spread = W.spread;
                _ashScar.amount = Math.min(6, sc.peakDepth / ASH_VISUAL_FULL);
                CBZ.weatherDrive({ ash: _ashScar }, 0.6);
              }
            } else sc.update(sc && sc.kind === "sky" ? skyDt : dt, null);
            // the sky retires itself once the column and the deck are gone
            if (sc && sc.done) { sc.dispose(); volScars.splice(i, 1); i--; }
          } catch (e) {}
        }
      }
    }
    /* THE FRUSTUM FOLLOWS THE CLOUD, NOT THE DISASTER. The nuke's active
       window is 12 s; NUKE_FX_AFTERMATH keeps the cloud maturing over the
       island for another seven MINUTES, and it is still climbing and
       spreading the whole time. Widening the far plane only inside the 12 s
       window froze it at the size the cloud had when it was young, and the
       landmark got clipped off again exactly when it became a landmark. So
       this re-asks every frame there is a live cloud, and only puts the lens
       back when the mode ends. */
    if (!inSurv) { nukeFrustumRestore(); return; }
    // 4 Hz: nukeFxDebug() builds a fat report object, and a far plane that
    // updates four times a second is four times more often than a cloud
    // rising at 30 m/s can outgrow it.
    nukeFarT -= dt;
    if (nukeFarT > 0 || !CBZ.nukeFxDebug) return;
    nukeFarT = 0.25;
    let liveCloud = false;
    try { const d = CBZ.nukeFxDebug(); liveCloud = !!(d && d.live); } catch (e) {}
    if (liveCloud) nukeFrustum();
  });

  /* THE MAP MARKS THE LANE, because the lane is the only survival
     information a density current gives you: a travelling front down the
     warned valley (the map draws {line:true} as it does the tsunami's wall)
     and a ring on the lahar's head. During the WARNING the lane is marked
     too — that is the point of telegraphing an unsurvivable hazard. */
  function pushEruptHazards(st, out) {
    if (st.er) { st.er.hazards(out); return; }
    const lane = st.pyroLane;
    if (lane && lane.pts && lane.pts.length > 1) {
      const a = lane.pts[0], b = lane.pts[1], dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1;
      out.push({ line: true, x: a.x, z: a.z, dx: dx / dl, dz: dz / dl });
    }
  }

  // threat from an active eruption (shared by quake + volcano threat()):
  // world/eruption.js answers it off its own live hazards
  function eruptThreat(x, z, ctx) {
    if (!ctx.st.erupting || !ctx.st.er) return 0;
    return ctx.st.er.threat(x, z);
  }

  /* ============================================================
     THE SUBDUCTION-ZONE EARTHQUAKE

     OWNER: "connect earthquake volcano and tsunami LIKE THEY SHOULD BE
     CONNECTED", and the science that goes with it: the shaking rarely kills.
     People are killed by DEBRIS and by PANCAKING, and then, minutes later, by
     the FIRES the ruptured gas mains started and the DOWNED CONDUCTORS lying
     live in the street. So this def's job is no longer "shake the camera and
     topple some boxes":

       warn      pre-shocks. The props buzz on the ground while the horizon
                 holds still, which is the only way a picture can say GROUND.
       main      the mainshock. Every standing structure takes load through
                 the ONE ledger, and every structure SHEDS — glass first, then
                 masonry, hardest from the ones closest to going. A person
                 pressed against a facade is in the kill zone; a person in the
                 middle of the square is fine. Some bots run for open ground,
                 some dive under the day-room tables, and WHICH ONES LIVE is
                 the lesson, taught with no text at all.
       aftermath 1-3 gas fires at the worst-hit buildings and two poles down
                 across the open ground people just ran to.
       tail      aftershocks, decaying, re-shedding the buildings the
                 mainshock already weakened — which is when most of the
                 remaining collapses actually happen.

     THE CHAIN. A subduction megathrust is one fault doing two things: the
     seaward half lifts the water column and the landward half loads the arc's
     magma plumbing. So the rupture's position IS the branch — an offshore
     break on a big quake hands off to the TSUNAMI (the drawdown begins while
     the ground is still moving, which is what makes it one event and not two
     in a row), and an inland one can crack the mountain open exactly as it
     always could. The handoff is CBZ.disasters.force() — this def does not
     know how to run a tsunami and must never learn.

     Flag: CBZ.CONFIG.QUAKE_CHAIN (default on) — one line back to a quake
     that ends and lets the shuffled arc pick whatever is next.
     ============================================================ */
  if (CBZ.CONFIG.QUAKE_CHAIN == null) CBZ.CONFIG.QUAKE_CHAIN = true;
  let qkChained = 0, qkGasFires = 0, qkLines = 0;

  /* THE MAGNITUDE AND THE SOURCE. Each occurrence ROLLS a moment magnitude
     off the run's seeded stream (the round's escalating ctx.intensity BIASES
     the roll — Gutenberg-Richter says small quakes dominate, and the bend
     weakens as the round escalates — but never replaces it: an early round
     can still draw the big one), and then WHERE it broke: an offshore
     megathrust tens of km out, or a shallow crustal fault close by
     (systems/quake.js sourceRoll). The ground the island feels is that
     source attenuated to the island (quake.js magParams): an M7.6 100 km
     offshore is a long sway and a tsunami; an M6.4 under the town is a
     wrecking ball. An M4 is a few seconds of rattling crockery.

     HONESTY (the 2026-08-29 "M7.4 every time" finding): the old def handed
     every quake collapseFrac 0.3, i.e. an M7.4 directly underneath, every
     time. Nothing here picks how many buildings fall any more: each
     building's own fragility against its own site's shaking decides. */
  let qkQ = null;                        // this occurrence's rolled quake
  let qkRollNo = -1;                     // which dir.occ the roll belongs to
  /* ONE ROLL PER OCCURRENCE, whoever asks first. beginWarn's makeCtx reads
     the activeSecs getter BEFORE warn() runs, so a naive "roll in warn()"
     would roll twice — and the second roll would have already spent the
     forceMag pin on the first. Keyed on dir.occ (bumped once per warning),
     every reader of this occurrence sees the same quake. */
  function qkEnsureRoll(intensity) {
    if (qkRollNo !== dir.occ || !qkQ) { qkQ = qkRoll(intensity); qkRollNo = dir.occ; }
    return qkQ;
  }
  function qkRoll(intensity) {
    const Q = qk();
    // no shared core (a build that never loaded systems/quake.js): a plain
    // twenty-second shake, nothing more
    if (!Q || !Q.magParams) return { M: 0, activeSecs: 20, legacy: true, pga01: 0.4, mainDur: 14, sLag: 0, src: {} };
    const forced = Q.takeForcedMag ? Q.takeForcedMag() : null;
    let M;
    if (forced != null) M = forced;
    else {
      const u = rnd();
      const skew = Math.max(0.5, 1.9 - 1.0 * Math.min(1.4, intensity || 0.2));
      M = 4.0 + 4.6 * Math.pow(u, skew);
    }
    const src = Q.sourceRoll ? Q.sourceRoll(M, rnd) : null;
    return Q.magParams(M, src);
  }

  function qk() { return CBZ.quake || null; }
  // one field off the shared core's ratchet, degrade-safe (0 when absent)
  function qkNum(k) {
    if (!CBZ.quakeAudit) return 0;
    try { const a = CBZ.quakeAudit(); return Number(a && a[k]) || 0; } catch (e) { return 0; }
  }

  /* THE LEDGER HEARS THE CORE. systems/quake.js decides each building's
     damage state from its own fragility; this file's ONE ledger (`_dmg`,
     shared with the tsunami and the eruption) is brought up to match, so a
     building the quake left extensive goes down to the wave on less. The
     targets sit just under the ledger's own glass (0.35) and spall (0.70)
     thresholds on purpose: the quake core has already drawn this building's
     glass and wounds on its own geometry, and the ledger must not draw a
     second, generic set. The collapse itself goes through structureHit (the
     shared collapse engine), on the side the building failed towards. */
  const QK_LEDGER = [0, 0.15, 0.34, 0.69, 1.0];
  function qkLedger(b, ds, ctx) {
    if (!b || b.fallen || ds >= 4) return;
    const want = QK_LEDGER[ds] || 0, have = b._dmg || 0;
    if (want > have) structureHit(b, want - have, ctx, { kind: "quake" });
  }

  /* THE AFTERMATH — the secondary killers, fired ONCE when the mainshock
     stops, at the buildings the quake actually hurt. The fire goes through
     CBZ.structure's BURNING state where a real lot exists (else quake.js's
     local flame on this file's ledger); the poles come down through the
     shared core, falling AWAY from the buildings, across the open ground
     the sensible half of the crowd just ran to. */
  function qkAftermath(ctx) {
    const Q = qk(); if (!Q) return;
    const hurt = ctx.arena.fragile
      .filter(function (b) { return !b.fallen && (b._dmg || 0) > 0.25; })
      .sort(function (a, b) { return (b._dmg || 0) - (a._dmg || 0); });
    if (!hurt.length) return;               // nothing broke: no mains, no lines
    const n = 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < Math.min(n, hurt.length); i++) {
      if (Q.gasFire(hurt[i], { gy: hurt[i].gy })) qkGasFires++;
    }
    for (let i = 0; i < 2; i++) {
      const px = ctx.cx + (rnd() - 0.5) * ctx.R * 1.6, pz = ctx.cz + (rnd() - 0.5) * ctx.R * 1.6;
      const P = Q.poleNear(px, pz, 400);
      if (P && Q.dropLine({ pole: P })) qkLines++;
    }
  }

  function QUAKE_DEF() {
    return {
      name: "EARTHQUAKE", emoji: "", warnSecs: 5, gap: 7,
      /* DURATION IS THE QUAKE'S: the S-P gap (the distance), the strong
         motion (the rupture's run time) and the aftershock window. A ROUND,
         NOT A SEISMOGRAM: a great quake's physical record runs well past a
         minute, and a match measured 70-100 s of aftershock rattle in which
         nothing happened, so the round ends at 55 s. */
      get activeSecs() { return Math.min(55, qkEnsureRoll(dir.intensity).activeSecs); },
      cause: "crushed under collapsing rubble", tint: 0x8a7f6c,
      // THE FORESHOCK IS THE WARNING: a rising tremor with the props buzzing
      // on it, sized by the quake that is coming (an M4's is barely a shiver)
      warn(ctx) {
        ctx.st.q = qkEnsureRoll(ctx.intensity);
        narrate("hint", "The ground is rumbling…", 2.2); sound("rumble"); ctx.st.pre = 0;
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        const mk = ctx.st.q ? (0.25 + ctx.st.q.pga01 * 0.9) : 1;
        if (CBZ.shake) CBZ.shake((0.02 + 0.10 * k * k) * mk);
        rattleProps(ctx, (0.02 + 0.05 * k) * mk);
        ctx.st.pre = (ctx.st.pre || 0) - dt;
        if (ctx.st.pre <= 0) { ctx.st.pre = 1.4 - k; soundAt("rumble", ctx.cx, ctx.cz); }
      },
      // during the sirens the danger is ALREADY the buildings
      warnThreat(x, z, ctx) { return DEFS.quake.threat(x, z, ctx); },
      start(ctx) {
        ctx.st.T = 0;
        const q = ctx.st.q || (ctx.st.q = qkEnsureRoll(ctx.intensity));
        qkChained = qkGasFires = qkLines = 0;
        ctx.st.dust = CBZ.fx.particleCloud({ mode: "rise", color: 0xb6a892, count: 160, radius: ctx.R, top: 8, size: 0.32, opacity: 0.34, vMin: 1, vMax: 3 });
        // an M4 shakes dust off nothing; an M8 hazes the whole island
        ctx.st.dust.setActive(0.1 + 0.7 * q.pga01);
        const Q = qk();
        if (Q && !q.legacy) {
          /* THE WHOLE EARTHQUAKE is the shared core's event: the wave train,
             every building's answer by type and height, the ground (cracks,
             mains, liquefaction), the cars, the crowd, and what falls on whom.
             This def keeps the round, the ledger, the chain and the aftermath. */
          Q.eventStart({
            M: q.M, params: q, src: q.src, cx: ctx.cx, cz: ctx.cz, R: ctx.R,
            structures: ctx.arena.fragile, cars: ctx.arena.cars || [],
            actors: function () { return CBZ.bots; },
            onRoad: ctx.arena.onRoad || null, groundAt: floor,
            hooks: {
              damage: function (b, ds) { qkLedger(b, ds, ctx); },
              collapse: function (b, n) { structureHit(b, 2, ctx, { kind: "quake", dirx: n.x, dirz: n.z }); },
            },
          });
          // fire eats the building's OWN ledger — this file's, not the core's
          Q.hooks.structDamage = function (b, amt) { structureHit(b, amt, ctx, { kind: "fire" }); };
        }

        /* ---- THE SUBDUCTION BRANCH ---------------------------------------
           One rupture, two consequences, and WHERE it broke decides which:
           the source roll already said offshore or inland. Offshore + big
           (tsunamigenic, ~M7.4+) → the sea. Inland and big → the magma.
           Neither is guaranteed, because a quake that always ends in a
           tsunami stops being a quake. */
        ctx.st.chain = null;
        const src = q.src || {};
        const off = src.offshore ? 1.3 : 0.55;
        ctx.st.epX = ctx.cx + Math.cos(src.bearing || 0) * ctx.R * off;
        ctx.st.epZ = ctx.cz + Math.sin(src.bearing || 0) * ctx.R * off;
        /* 2026-10-15 (owner: "some should overlap, like earthquake to
           tsunami or earthquake to volcano, but right now it's dumb"): the
           branch is DECIDED by the rupture, never by a coin. An offshore
           megathrust of M7.5+ always lifts the water column; an inland break
           of M6.0+ whose epicentre is close under the mountain always loads
           the magma. Either way the follow-on is a CHAIN (the director runs
           it as the next link of this same round, with its own warning),
           not an eruption smuggled inside the quake's own round. */
        if (CBZ.CONFIG.QUAKE_CHAIN !== false) {
          if (src.offshore && q.M >= 7.5) ctx.st.chain = "tsunami";
          else if (!src.offshore && q.M >= 6.0) {
            const V = erSite(ctx);
            if (V && Math.hypot(ctx.st.epX - V.x, ctx.st.epZ - V.z) < ctx.R * 0.6) ctx.st.chain = "eruption";
          }
        }
      },
      active(dt, ctx) {
        ctx.st.T = (ctx.st.T || 0) + dt;
        const T = ctx.st.T, q = ctx.st.q, Q = qk();
        const live = !!(Q && q && !q.legacy);
        const mainEnd = live ? q.sLag + q.mainDur : 14;
        const tail = T - mainEnd;
        let amp, pga, phase, shockHit = 0;
        if (live) {
          const m = Q.eventTick(dt);
          amp = m.amp; pga = m.pga01; phase = m.phase; shockHit = m.shockFired;
        } else {
          amp = tail < 0 ? 0.3 : 0.02; pga = amp; phase = tail < 0 ? "s" : "coda";
        }
        if (CBZ.shake && amp > 0.004) CBZ.shake(amp);
        ctx.st.dust.setActive(Math.min(0.85, 0.08 + pga * 1.1)); ctx.st.dust.update(dt, camPos().x, 0, camPos().z);
        // the rumble ARRIVES BEFORE THE MOTION: constant during the P gap,
        // then proportional to the shaking
        if (phase === "p" ? rnd() < dt * 1.6 : rnd() < dt * (0.15 + pga * 1.4)) sound("rumble");
        // the trees sway on the same ground (the cars are the core's now)
        rattleProps(ctx, 0.015 + amp * 0.38, true);

        /* SURFACE RUPTURE: a big shallow crustal quake under the island
           breaks the ground along one bearing through the epicentre, reusing
           the ground-shaft primitive the sinkhole roster already owns. */
        if (q && q.rupture && !ctx.st.ruptured && tail < 0 && T > q.sLag + q.mainDur * 0.3) {
          ctx.st.ruptured = 1;
          const bx = ctx.st.epX - ctx.cx, bz = ctx.st.epZ - ctx.cz;
          const bl = Math.hypot(bx, bz) || 1;
          const ux = bx / bl, uz = bz / bl;
          for (let i = -1; i <= 1; i++) {
            const rx = ctx.cx + ux * i * (18 + rnd() * 10) + (rnd() - 0.5) * 6;
            const rz = ctx.cz + uz * i * (18 + rnd() * 10) + (rnd() - 0.5) * 6;
            openHole(ctx, rx, rz, 2.6 + rnd() * 1.6);
          }
        }

        // THE MOUNTAIN ANSWERS: the mainshock loaded the plumbing, the round
        // closes on the unrest and the eruption is the chain's next link
        if (ctx.st.chain === "eruption" && tail > 4 && !ctx.st.handed) {
          ctx.st.handed = 1; qkChained++;
          ctx.st.chainTo = { id: "volcano", delay: 1.5, why: "quake" };
          ctx.st.endIn = 0;
        }
        tick0(ctx, dt);

        // ---- THE MAINSHOCK STOPS, AND THE SECOND WAVE OF DEATHS STARTS ----
        if (tail >= 0 && !ctx.st.aftermath) { ctx.st.aftermath = 1; qkAftermath(ctx); }
        if (shockHit > 0) sound("rumble");

        /* ---- THE HANDOFF -------------------------------------------------
           The drawdown starts while the ground is still moving: the sea pulls
           back over the aftershocks, and only then does the director hand the
           run to the tsunami. Forcing while `dir.t` still has slack is what
           keeps the director's own endActive() from running against a def it
           has already retired — so this is the LAST thing active() does. */
        if (ctx.st.chain === "tsunami" && tail > 2.5) {
          const u = Math.min(1, (tail - 2.5) / 5.5);
          surgeSet(-2.8 * ease(u));
          if (tail > 9.5 && !ctx.st.handed) {
            ctx.st.handed = 1; qkChained++;
            // the wave comes FROM the epicentre: it travels along -bearing
            ctx.st.chainTo = { id: "flood", delay: 0.3, why: "quake", st: { chainBearing: (q && q.src && q.src.bearing) || 0 } };
            ctx.st.endIn = 0;
            return;
          }
        }
      },
      end(ctx) {
        if (ctx.st.dust) { ctx.st.dust.dispose(); ctx.st.dust = null; }
        endEruption(ctx);
        if (qk()) { qk().hooks.structDamage = null; qk().end(); }   // .end() also ends the event
        qkQ = null;                       // the next occurrence rolls its own quake
        /* a decided chain whose round ran out before its beat still hands
           off: the rupture already happened, so the sea or the mountain
           answers whatever the clock says */
        if (ctx.st.chainTo) { /* already handed off (or staged) */ }
        else if (!ctx.st.handed && ctx.st.chain === "tsunami") {
          ctx.st.handed = 1; qkChained++;
          ctx.st.chainTo = { id: "flood", delay: 0.3, why: "quake", st: { chainBearing: (ctx.st.q && ctx.st.q.src && ctx.st.q.src.bearing) || 0 } };
        } else if (!ctx.st.handed && ctx.st.chain === "eruption") {
          ctx.st.handed = 1; qkChained++;
          ctx.st.chainTo = { id: "volcano", delay: 1.5, why: "quake" };
        }
      },
      threat(x, z, ctx) {
        let t = 0.2; const f = ctx.arena.fragile;
        // THE KILL ZONE IS THE FACADE. 8 m of a standing building is where the
        // glass and the masonry land, and the bots' flee vector reads this.
        for (let i = 0; i < f.length; i++) if (!f[i].fallen) { const d = Math.hypot(x - f[i].x, z - f[i].z); if (d < 8) t = Math.max(t, 0.9 * (1 - d / 8)); }
        if (ctx.st.erupting) t = Math.max(t, eruptThreat(x, z, ctx));
        return t;
      },
      safeDir(x, z, ctx) {
        let bx = 0, bz = 0; const f = ctx.arena.fragile;
        for (let i = 0; i < f.length; i++) if (!f[i].fallen) { const dx = x - f[i].x, dz = z - f[i].z, d = Math.hypot(dx, dz); if (d < 9 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } }
        return (bx || bz) ? { x: bx, z: bz } : null;
      },
    };
  }

  // ---- earthquake / wildfire helpers ----
  /* THE TERMINAL STAGE OF THE LEDGER, and its only caller is structureHit().
     Three disasters used to reach in here directly with a coin flip; if you
     find yourself wanting to call this, you want structureHit() with an
     amount — that is what lets damage from two different disasters add up. */
  function collapse(b, ctx, opts) {
    if (!b || b.fallen) return; b.fallen = true;
    b._dmg = 1.2;
    opts = opts || {};

    /* ---- THE ISLAND USED TO SINK ITS BUILDINGS INTO THE GROUND -----------
       The whole animation was three lines in the update loop: drop the group
       at h*0.6 m/s, spin it by a random tilt, hide it at t > 1.8 s. Nothing
       broke, nothing shed, nothing landed — a dressed tower with a Gothic or
       a bundled-tube facade on it slid neatly into the island like a lift
       going down, which is the single least convincing thing a building can
       do. And it was a SECOND collapse system: the city had a choreographed
       one and the island had this, so every improvement had to be written
       twice or (in practice) once.

       city/collapse.js is now the only collapse in the game. It reads what
       the building is MADE OF from the facade grammar the arena dressed it
       with (b.facadeStyle → the grammar's `structure:` field) and picks the
       motion to match — the island's masonry blocks topple and crumble where
       its glass towers pancake, and every one of them disintegrates into real
       debris that lands and stays. Same engine, same quality, same fix, as
       the city gets from an RPG or a plane.
    --------------------------------------------------------------------- */
    const yank = function () {
      // yank ALL of this building's walls (colliders) and floors/stairs/roof
      // (platforms) so survivors can run AND fall through the rubble
      if (b.colliders) for (const c of b.colliders) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      if (b.platforms) for (const p of b.platforms) { const i = CBZ.platforms.indexOf(p); if (i >= 0) CBZ.platforms.splice(i, 1); }
      // crush anyone in the footprint
      surv().hurtRadius(b.x, b.z, Math.max(b.w, b.d) * 0.62, 1e6, { box: b, cause: "crushed under a collapsing building" });   // the footprint, not a circle past its walls
      // blow every window out of the building as it goes
      if (CBZ.shatterGlass) CBZ.shatterGlass(b.x, b.z, Math.max(b.w, b.d) * 0.85);
      if (b.group) b.group.visible = false;
      // the wound dressing (if it earned one at the spall stage) goes with it
      if (CBZ.collapse && CBZ.collapse.skinClear) CBZ.collapse.skinClear({ ox: b.x, oz: b.z });
    };
    // THE PERMANENT FIELD. collapse.js's fragments are live physics and thin
    // out after half a minute; this is the rubble that is still there at the
    // end of the match, and it lands when the building does, not when it
    // starts falling.
    //   It is a MOUND OF THE BUILDING: its own wall material broken into real
    //   pieces plus its pale floor slabs, seated on each other by
    //   CBZ.debris.pile and frozen solid (you climb it). Taller towers leave a
    //   higher, wider heap. The last few storeys still come down on whoever
    //   is standing at the edge of the footprint.
    const layRubble = function (job) {
      // a building that fell INTO a sinkhole leaves its rubble down the shaft
      // (the collapse engine's fragments land on the hole's floor); a mound
      // on the footprint would be rubble standing on air
      if (opts.noRubble) return;
      // came down through collapse.js's structural model: the building's own
      // chunks already lie where they fell, kept as solid rubble; no mound
      // (and no invented hits: those chunks are the bodies that land on people)
      if (!CBZ.debris || (job && job.S)) return;
      // THE MOUND LANDS ON WHOEVER IS UNDER IT, and only inside the mound's
      // own footprint (it used to scatter hits half a footprint past it)
      if (ctx && surv()) {
        for (let i = 0; i < 6; i++) {
          surv().hurtRadius(b.x + (rnd() - 0.5) * b.w * 1.15, b.z + (rnd() - 0.5) * b.d * 1.15, 1.6, scale(30, ctx), { cause: "crushed under collapsing rubble" });
        }
      }
      const tall = b.h > 24;
      CBZ.debris.pile({
        x: b.x, z: b.z, y: b.gy || undefined,
        w: b.w * 1.25, d: b.d * 1.25, h: Math.min(tall ? 4.5 : 3, 0.9 + b.h * 0.1),
        materials: [
          { material: wallMatOf(b), weight: 3 },
          { material: CBZ.cmat ? CBZ.cmat(0xb4b9c1) : wallMatOf(b), kind: "concrete", weight: 1 },
        ],
        owner: "fx", solid: true,
      });
    };

    const job = (CBZ.collapse && CBZ.CONFIG.COLLAPSE_V2) ? CBZ.collapse.play({
      root: root(), ox: b.x, oz: b.z, gy: b.gy || 0,
      /* THE BUILDING ITSELF. Without its group collapse.js had nothing to
         read and fell back to its proxy: grey boxes in the wall colour with
         a window strip, so every island house came down as a different,
         blank building. With it, the stand-in is cut from this building's
         own walls, facade, slabs and glass (collapse.js gatherSolids), its
         whole-building merged meshes split by triangle into storey bands. */
      group: b.group,
      w: b.w, d: b.d, h: b.h, storeys: b.storeys, FH: b.h / Math.max(1, b.storeys || 1),
      wall: b.color != null ? b.color : (b.wallColor != null ? b.wallColor : 0x8b9097),
      style: b.facadeStyle || null,
      // the island is hills, a beach and a volcano skirt, so debris thrown
      // clear of the footprint has to land on the ground that is actually
      // there rather than on the height the building's own base sat at
      groundAt: opts.groundAt || floor,
      key: "isl:" + Math.round(b.x) + "," + Math.round(b.z),
    }, {
      // a caller that KNOWS the motion (a sinkhole undermining one side: a
      // topple toward the hole) says so; everything else is chosen by what
      // the building is made of
      mode: opts.mode || undefined,
      wound: { nx: opts.dirx || (b._lean ? 1 : 0), nz: opts.dirz || 0, floor: opts.floor || 0 },
      // the island has been shaking for ten seconds by the time anything
      // comes down — it does not need the city's 1.15 s "something is about
      // to happen" tell, it needs to get on with it
      preShudder: opts.preShudder != null ? opts.preShudder : 0.35,
      onSwap: yank,
      onGround: layRubble,
    }) : null;

    if (job) engineFalls++;
    else {                                        // engine off: the old behaviour
      legacyFalls++;
      yank(); layRubble();
      fallingBuildings.push({ group: b.group, t: 0, h: b.h, tilt: (rnd() - 0.5) * 0.9 });
      if (b.group) b.group.visible = true;        // the legacy ticker hides it itself
    }
    if (CBZ.shake) CBZ.shake(0.6); sound("collapse");
  }
  // Only fed by the COLLAPSE_V2=false fallback above. Kept so the one-line
  // revert restores the exact old picture rather than an empty screen.
  const fallingBuildings = [];

  // ---- a car ripped loose by the tsunami: pull its collider, hurl it in the
  //      wave's travel direction with an upward kick + spin; the ticker below
  //      integrates gravity until it crashes back down to rest as wreckage ----
  /* THE ONE DOOR TO A CAR. The island's cars are real vehicles (world/
     island_vehicles.js on city/vehicles.js): a disaster that is about to move
     one takes it through CBZ.vehicleDisaster first (woken out of the parked
     pools so it draws, the driver put out, billed as a wreck, left out of the
     car solve and the parked seat while it is carried). `flung` stays the
     flag the island's records and every disaster's skip test read. */
  function takeCar(car, why) {
    if (!car || car.flung) return false;
    if (CBZ.vehicleDisaster && car.pos && car.group) CBZ.vehicleDisaster.take(car, why || surv()._cause || "wrecked by the disaster");
    car.flung = true;
    const i = car.collider ? CBZ.colliders.indexOf(car.collider) : -1;
    if (i >= 0) { CBZ.colliders.splice(i, 1); if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    return true;
  }
  const flungCars = [];
  function flingCar(car, dirx, dirz, force, up) {
    if (!takeCar(car)) return;
    flungCars.push({
      car, g: car.group,
      vx: dirx * force + (rnd() - 0.5) * 2, vy: up + rnd() * 3, vz: dirz * force + (rnd() - 0.5) * 2,
      sx: (rnd() - 0.5) * 6, sz: (rnd() - 0.5) * 6, settled: false,
    });
    shatterCarGlass(car, dirx, dirz);
  }
  // the windows go as it is ripped off the street: THIS car's own glass
  // shatters (a single-material glass mesh on its body), else a burst of
  // glass grit where the windows were. Shared by the wave's fling and the
  // tornado (through its island bridge).
  function shatterCarGlass(car, dirx, dirz) {
    if (!car || car._pane || !car.group) return;
    if (CBZ.debris) {
      const gp = car.group.position;
      let pane = null;
      car.group.traverse(function (o) {
        if (!pane && o.isMesh && o.visible && o.material && !Array.isArray(o.material) && CBZ.debris.kindOf(o.material, o) === "glass") pane = o;
      });
      const at = { x: gp.x, y: gp.y + 1.2, z: gp.z };
      if (pane) { car._pane = pane; CBZ.debris.shatter(pane, { kind: "glass", at, dir: { x: dirx, y: 0.4, z: dirz }, power: 1.2, maxPieces: 12, owner: "fx" }); }
      else CBZ.debris.chips(at.x, at.y, at.z, { kind: "glass", count: 18, power: 1.2, dir: { x: dirx, y: 0.5, z: dirz }, spread: 1.4 });
    }
  }

  /* ============================================================
     WHAT A BOLT HITS, AND WHO THAT KILLS (2026-08-13)

     OWNER: "make lightning realer — how it can go from tree to person, or
     person to nearby person." It can, and the way it does is the single most
     load-bearing fact about lightning casualties. From the epidemiology
     (Cooper & Holle; National Lightning Safety Council; NWS):

       ground current / step voltage   50-55%   THE leading killer
       side flash / side splash        30-35%
       upward streamer                 10-15%
       direct strike                    3-5%
       contact injury                   3-5%

     Ground current and side flash together are about 60% of all casualties.
     The bolt landing ON someone — the only mechanism this file used to model —
     is the RAREST one at 3-5%.

     ATTACHMENT. Lightning does not choose a patch of grass; it connects to
     whatever the descending leader reaches first, which in the open is the
     tallest thing around (the rolling-sphere model: strike distance
     R ≈ 10·I^0.65 m, ~90 m for a nominal 30 kA stroke, so over a wide area the
     high point wins). `attachPoint` is that, at arena scale: the tallest
     candidate inside ATTRACT_R of where the storm aimed — a tree, a building
     roof, or a person if they happen to be the high point of open ground.

     SIDE FLASH. The bolt hits a TREE, and a tree is a bad conductor. Part of
     the current jumps the air to something better on its way to earth — the
     person sheltering under it. (It is worse for trees than for metal towers
     for exactly that reason: high trunk resistance pushes current to find
     another path.) Real jumps are a foot or two; SIDE_R below is generous
     because this game's people and trees are metre-scale blocks and the beat
     has to read on screen.

     PERSON TO PERSON. The jump does not stop at the first body. It goes on to
     the next one close enough to be a better path than the ground, which is
     why groups go down together — and why one strike can kill a whole herd.
     CHAIN_HOPS limits how far, and each hop is weaker than the last.

     GROUND CURRENT. Current spreads radially through the soil; what hurts you
     is the potential difference between your two feet. Lethal close in, merely
     bad further out, ~zero by about 20 m — measured danger radii are ~5-8 m
     for humans, further in wet ground, and far worse for four-legged animals
     whose feet are further apart (323 reindeer died to one strike in Norway in
     2016, over ~50 m). Modelled here as a falloff, not a step function, so
     standing 8 m away hurts and standing 15 m away does not.

     Every one of these gets its own kill-feed cause, because "struck by
     lightning" is wrong for four out of five of them.
     ============================================================ */
  const ATTRACT_R = 14;    // m — how far a bolt will reach for a high point
  const SIDE_R = 2.4;      // m — side flash off the struck object
  const CHAIN_R = 2.8;     // m — and on from one body to the next
  const CHAIN_HOPS = 2;
  const GROUND_LETHAL = 4.5;
  const GROUND_R = 11;     // m — outer edge of the step-voltage field

  /* WHAT THE LEADER REACHES FIRST — and that is a CONE, not a height contest.

     The first version of this took the tallest candidate within ATTRACT_R, and
     it was wrong in a way that quietly broke the whole feature: trees here vary
     by about 1.5 m, so a tree twelve metres away routinely out-ranked the one
     the crowd was actually huddled under, the bolt landed twelve metres from
     anybody, and the side flash never fired once in eleven strikes.

     A descending leader attaches to whichever object it enters the striking
     distance of first, which depends on height AND on how far it has to reach
     sideways — the same geometry behind the protective angle a lightning rod
     covers. So the score is `height − distance × PROTECT_SLOPE`: a 0.8 slope is
     roughly a 50° cone, which means a distant object must be about as much
     taller as it is further away. A tower still dominates its whole block, as
     it should. A tree two metres from where the leader came down beats an
     identical tree twelve metres away, as it should. */
  const PROTECT_SLOPE = 0.8;

  function attachPoint(tx, tz, ctx) {
    const A = ctx.arena;
    let bestScore = floor(tx, tz) - 0.4;    // bare ground, as the baseline
    let best = { x: tx, z: tz, y: floor(tx, tz), top: 0, kind: "ground", ref: null };
    const consider = (x, z, top, kind, ref) => {
      const score = top - Math.hypot(x - tx, z - tz) * PROTECT_SLOPE;
      if (score <= bestScore) return;
      bestScore = score;
      best = { x: x, z: z, y: top, top: top, kind: kind, ref: ref };
    };
    const tr = A.flammable || [];
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (t.burnt || Math.hypot(t.x - tx, t.z - tz) > ATTRACT_R) continue;
      // canopy top: the foliage box is 2.6 tall about its own centre
      const top = (t.foliage ? t.foliage.position.y + 1.3 : floor(t.x, t.z) + 4);
      consider(t.x, t.z, top, "tree", t);
    }
    const fr = A.fragile || [];
    for (let i = 0; i < fr.length; i++) {
      const b = fr[i];
      if (b.fallen) continue;
      const cx = Math.max(b.x - b.w * 0.42, Math.min(b.x + b.w * 0.42, tx));
      const cz = Math.max(b.z - b.d * 0.42, Math.min(b.z + b.d * 0.42, tz));
      if (Math.hypot(cx - tx, cz - tz) > ATTRACT_R) continue;
      consider(cx, cz, (b.gy || 0) + b.h, "building", b);
    }
    /* A PERSON CAN BE THE HIGH POINT — scored by the same cone as everything
       else, which is what makes the answer come out right on its own. Standing
       in the open with nothing within reach, you ARE the tallest object and the
       bolt takes you: the real 3-5% direct strike. Standing under a canopy two
       metres away, the tree outranks you every time — and then it kills you
       anyway, sideways, which is the 30-35%. */
    const acts = surv().actors();
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a.dead) continue;
      if (Math.hypot(a.pos.x - tx, a.pos.z - tz) > 8) continue;
      consider(a.pos.x, a.pos.z, floor(a.pos.x, a.pos.z) + 1.8, "actor", a);
    }
    return best;
  }

  /* WHO THE CURRENT REACHES, once it is in the ground. Returns the number of
     casualties so the audit can report that a strike killed more than the one
     person it landed on — which is the whole point of the model. */
  function conduct(at, ctx) {
    const acts = surv().actors();
    const hit = [];                       // actors already carrying current
    const arc = CBZ.lightningArc || null;
    const bx = at.x, bz = at.z, bgy = floor(bx, bz);
    let kills = 0, sideFlashes = 0, chained = 0;

    const zap = (a, dmg, cause, fromX, fromZ) => {
      const was = a.dead;
      surv().hurt(a, dmg, { fromX: fromX, fromZ: fromZ, fling: dmg >= 1e5 ? 1.4 : 0, cause: cause });
      if (!was && a.dead) kills++;
      hit.push(a);
    };

    // ---- 1) DIRECT. The bolt terminated on a person. ----------------------
    if (at.kind === "actor" && at.ref && !at.ref.dead) {
      zap(at.ref, 1e6, "struck by lightning", bx, bz);
    }

    // ---- 2) SIDE FLASH off whatever the bolt hit. -------------------------
    if (at.kind === "tree" || at.kind === "building") {
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        if (a.dead || hit.indexOf(a) >= 0) continue;
        const d = Math.hypot(a.pos.x - bx, a.pos.z - bz);
        if (d > SIDE_R) continue;
        // the jump leaves the trunk about head height and lands on the body
        if (arc) arc(bx, bgy + 1.9, bz, a.pos.x, floor(a.pos.x, a.pos.z) + 1.15, a.pos.z, { w: 0.05 });
        sideFlashes++;
        zap(a, 1e6, at.kind === "tree"
          ? "caught the side flash off a tree"
          : "caught the side flash off a building", bx, bz);
      }
    }

    /* ---- 3) PERSON TO PERSON, BEFORE the ground current gets a say.
       The two mechanisms overlap in the real world and they overlap here, so
       the ORDER decides which one claims a casualty — and the specific, local
       one should win over the diffuse one. Run the other way round, the 11 m
       step-voltage field claims everyone the 2.8 m body-to-body jump could
       have reached, the chain never fires at all, and the kill feed says
       "ground current" for a row of people who visibly went down off the man
       next to them. ---- */
    let front = hit.slice();
    for (let hop = 0; hop < CHAIN_HOPS && front.length; hop++) {
      const next = [];
      for (let i = 0; i < front.length; i++) {
        const src = front[i];
        for (let j = 0; j < acts.length; j++) {
          const a = acts[j];
          if (a.dead || hit.indexOf(a) >= 0 || next.indexOf(a) >= 0) continue;
          const d = Math.hypot(a.pos.x - src.pos.x, a.pos.z - src.pos.z);
          if (d > CHAIN_R) continue;
          const sy = floor(src.pos.x, src.pos.z) + 1.2;
          if (arc) arc(src.pos.x, sy, src.pos.z, a.pos.x, floor(a.pos.x, a.pos.z) + 1.2, a.pos.z, { w: 0.042, life: 0.11 });
          chained++;
          // each hop is a weaker path than the last
          const dmg = hop === 0 ? 1e6 : 55;
          surv().hurt(a, dmg, { fromX: src.pos.x, fromZ: src.pos.z, cause: "the current jumped from the body beside them" });
          if (a.dead) kills++;
          next.push(a);
        }
      }
      for (let i = 0; i < next.length; i++) hit.push(next[i]);
      front = next;
    }

    // ---- 4) GROUND CURRENT — the leading killer, and a falloff not a step --
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (a.dead || hit.indexOf(a) >= 0) continue;
      const d = Math.hypot(a.pos.x - bx, a.pos.z - bz);
      if (d > GROUND_R) continue;
      if (d <= GROUND_LETHAL) zap(a, 1e6, "killed by the ground current", bx, bz);
      else {
        // step voltage falls away with distance: survivable, and it hurts
        const k = 1 - (d - GROUND_LETHAL) / (GROUND_R - GROUND_LETHAL);
        surv().hurt(a, 30 * k * k + 8 * k, { fromX: bx, fromZ: bz, cause: "killed by the ground current" });   // 38 at the lethal edge (no worse than disasterhurt's warning inside it), ~0 at GROUND_R (was 18-80: an 18 hp cliff at 11 m)
        if (a.dead) kills++;
        hit.push(a);
      }
    }

    boltLedger.strikes++;
    boltLedger.last = { x: at.x, z: at.z, y: at.y, kind: at.kind, kills: kills, side: sideFlashes, chain: chained };
    boltLedger.kills += kills;
    boltLedger.sideFlashes += sideFlashes;
    boltLedger.chained += chained;
    boltLedger.byKind[at.kind] = (boltLedger.byKind[at.kind] || 0) + 1;
    if (kills > boltLedger.worstStrike) boltLedger.worstStrike = kills;
    return kills;
  }
  const boltLedger = { strikes: 0, kills: 0, sideFlashes: 0, chained: 0, worstStrike: 0, byKind: {}, last: null };

  /* ---- A STRIKE IS NOT AN EXPLOSION (2026-08-13) --------------------------
     OWNER: "lightning currently looks like an RPG on impact, which is dumb."
     It did, and for a reason you can point at. This site routed the strike
     through the bus's `kinetic` row — the generic "something heavy arrived at
     speed" row — and `kinetic` names no composer, so it fell through to
     COMPOSERS.heavy, i.e. cityAirstrikeExplosion. Every ground strike drew a
     literal airstrike: orange fireball, smoke column, debris ejecta cone. It
     then priced 60 kg at 120 m/s through THE KINETIC LAW, flung bodies 5 m and
     swept nine metres of structural damage, because that is what a warhead
     does. And the bolt itself was BoxGeometry(0.5, 40, 0.5) — a white fence
     post, dead straight, on screen for one sixth of a second.

     Lightning has no fuel, no fragments and no chemistry. Nothing at the
     contact point can burn and there is nothing there to throw. What it does
     have is a forked channel, three-to-five RETURN STROKES that make it strobe
     rather than fade, surface flashover crawling out across the ground, steam
     off wet earth, and a burn that stays. All of that now lives in
     systems/lightningfx.js as a `lightning` ordnance row + FX composer, so the
     city can fire one too and nobody re-types a bolt.

     What is left HERE is what was always this file's business: who it kills —
     and that is now `conduct()` above rather than one flat radius. The bolt
     terminates on the tallest thing in reach, and the casualties come from side
     flash, ground current and the jump from body to body, which between them
     are ~85% of real lightning deaths. `r: 0` on the blast below is deliberate:
     the bus must not ALSO sweep a radius, or everyone inside it dies twice and
     the kill feed says the wrong thing about how.

     (The old fireball + BoxGeometry fence-post bolt was deleted 2026-09-28.) */
  function strike(x, z, ctx, at) {
    at = at || attachPoint(x, z, ctx);
    // The bus still owns the draw and this mode still owns the ledger. No
    // `quiet` flag is needed — the row carries no shake, no rumble and no cue
    // of its own, so the bus's feel stage is a no-op and the composer owns
    // the crack and the flicker.
    /* HOW MUCH OF IT REACHES THE TURF. Open ground: all of it. A tree: the
       current runs to earth down the trunk and out through the roots, so the
       base scorches but less. A building: it goes to earth inside the
       structure and the lawn outside is untouched. */
    const gScale = at.kind === "tree" ? 0.5 : (at.kind === "ground" || at.kind === "actor" ? 1 : 0);
    survBlast("lightning", at.x, at.z, {
      r: 0, ctx: ctx, up: 0.6, y: at.kind === "ground" ? undefined : at.y,
      struct: 0.06, structR: 4.5, fx: { groundScale: gScale },
      // and if the bus cannot route it — script order, or IMPACT_BUS off —
      // draw the bolt directly rather than let it degrade to a fireball
      draw: function (bx, by, bz) { CBZ.lightningStrike(bx, bz, { y: by, groundScale: gScale }); },
    });
    // A TREE THAT IS STRUCK EXPLODES. The sap inside the trunk flashes to
    // steam and blows the bark off in strips — the one piece of genuine
    // blunt-trauma debris a strike produces, and nothing like an ejecta cone.
    // The strips are cut from THIS trunk: a bark-thick slab of its own
    // surface on the struck side, in its own bark material, split along the
    // grain by CBZ.debris (wood fractures into long splinters).
    if (at.kind === "tree") {
      const t = at.ref, base = floor(at.x, at.z);
      if (CBZ.debris && t && t.trunk && t.trunk.geometry && t.trunk.material) {
        const tr = t.trunk;
        tr.updateWorldMatrix(true, false);
        if (!tr.geometry.boundingBox) tr.geometry.computeBoundingBox();
        const bb = tr.geometry.boundingBox.clone().applyMatrix4(tr.matrixWorld);
        const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
        const rad = Math.max(0.08, Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2);
        const y0 = Math.max(bb.min.y, base) + 0.6, y1 = Math.min(bb.max.y, y0 + 2.6);
        // (a trunk mesh wider than a tree is a merged forest: no strips off that)
        const strips = (bb.max.x - bb.min.x < 3 && bb.max.z - bb.min.z < 3) ? 2 + ((rnd() * 2) | 0) : 0;
        for (let i = 0; i < strips && y1 > y0 + 0.4; i++) {
          const a = rnd() * 6.283, ux = Math.cos(a), uz = Math.sin(a);
          const sx = cx + ux * rad * 0.9, sz = cz + uz * rad * 0.9;
          const hw = Math.max(0.05, rad * 0.45), th = Math.min(0.06, rad * 0.35) / 2;
          CBZ.debris.shatterBox({
            minX: sx - Math.abs(uz) * hw - Math.abs(ux) * th, maxX: sx + Math.abs(uz) * hw + Math.abs(ux) * th,
            minY: y0, maxY: y1,
            minZ: sz - Math.abs(ux) * hw - Math.abs(uz) * th, maxZ: sz + Math.abs(ux) * hw + Math.abs(uz) * th,
          }, tr.material, { kind: "wood", at: { x: sx, y: (y0 + y1) / 2, z: sz }, dir: { x: ux, y: 0.35, z: uz },
            power: 1.4, maxPieces: 4, owner: "fx", snap: false });
        }
      }
      if (t && t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x2a1c10);
    }
    conduct(at, ctx);
  }

  /* ============================================================
     A HOLE HAS A BOTTOM — AND THE HOLE NOW LIVES IN world/groundshaft.js

     This file used to OWN the shaft: a cylinder, a disc and a dark ring, 30
     lines, welded to this arena's root and this mode's actor list. That is
     exactly the shape city/tsunami.js's header warns about — a hazard built
     against one mode's private geometry can never leave it, which is why the
     main world (the one with the intersections, the parked cars and the
     buildings that make the owner's reference photograph work) could not have
     a sinkhole at all.

     `CBZ.groundShaft` / `CBZ.groundShaftCollapse` are that shaft, promoted and
     rebuilt to the reference: sheer stratified walls that go black with depth,
     a torn overhanging lip where the surface was sheared, a talus cone with
     WEDGED VOID POCKETS at the floor, a spiral of ledges you can climb out on,
     and a collapse that is a SEQUENCE (cracks → the core drops → the radius
     grows and takes what is standing on it) instead of a pop.

     CBZ.survHoles is still the ONE published record of "the ground is gone
     here" and modes/survival.js's floorAt still subtracts it — groundshaft.js
     ADOPTED that array rather than opening a second one, so this mode needed
     no edit for any of it. What is left here is the roster entry: WHERE and
     WHEN, which is the only part that is this file's business.
     ============================================================ */
  CBZ.survHoles = CBZ.survHoles || [];
  const HOLE_MIN_D = 14, HOLE_VAR_D = 8;   // legacy fallback depth (no groundshaft.js)
  // Degrade-safe: with world/groundshaft.js absent the roster still runs, it
  // just gets the old plain shaft back instead of the stratified one.
  function openHole(ctx, x, z, r) {
    if (CBZ.groundShaft) {
      return CBZ.groundShaft(x, z, { r: r, depth: r * 4.2, surface: "soil" });
    }
    const gy = floor(x, z), depth = HOLE_MIN_D + rnd() * HOLE_VAR_D, bottom = gy - depth;
    const grp = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.78, depth, 20, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x3a2b1e, side: THREE.DoubleSide }));
    wall.position.y = gy - depth / 2;
    const floorM = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 20), new THREE.MeshLambertMaterial({ color: 0x1a120c }));
    floorM.rotation.x = -Math.PI / 2; floorM.position.y = bottom + 0.05;
    grp.add(wall, floorM);
    grp.position.set(x, 0, z);
    root().add(grp);
    if (CBZ.shake) CBZ.shake(0.3);
    sound("collapse");
    const h = { x, z, r, mouth: r * 0.86, gy, bottom, depth, grp, seen: {} };
    CBZ.survHoles.push(h);
    return h;
  }
  /* THE COLLAPSE, STAGED. One call per sinkhole and world/sinkhole.js drives
     the whole event (cracks and sag, the cover dropping, the edges calving,
     the things on top going in). What this file supplies is what only it
     owns: the island's CARS (their records, their colliders, the flung flag
     the arena's reset puts back), its BUILDINGS (and the structural ledger a
     falling one must go through) and whether the site is a road. The old seam
     threw every car inside the radius straight down with flingCar; a car now
     goes in when the ground under its wheels does, nose first. */
  function stageHole(ctx, x, z, r) {
    if (!CBZ.groundShaftCollapse) { return { x: x, z: z, r: r, legacy: openHole(ctx, x, z, r) }; }
    const A = ctx.arena;
    const road = !!(A.onRoad && A.onRoad(x, z));
    // as deep as the island allows: a karst throat a good three radii down,
    // kept above the depth debris and bodies are culled at
    const gy = floor(x, z);
    const depth = Math.max(r * 2.4, Math.min(r * 3.2, gy + 52));
    return CBZ.groundShaftCollapse(x, z, {
      r: r, depth: depth, surface: road ? "asphalt" : "soil", road: road,
      warnSecs: 3.4, growSecs: 6,
      cars: function () {
        const out = [], C = A.cars || [];
        for (let i = 0; i < C.length; i++) {
          const c = C[i];
          if (!c || c.flung || !c.group) continue;
          out.push({ obj: c.group, x: c.group.position.x, z: c.group.position.z, yaw: c.group.rotation.y, rec: c,
            // off the street: its collider goes, and `flung` is the flag the
            // arena's reset() parks it back by
            take: function () { takeCar(c, "swallowed by the sinkhole"); } });
        }
        return out;
      },
      buildings: function () {
        const out = [], B = A.fragile || [];
        for (let i = 0; i < B.length; i++) {
          const b = B[i];
          if (!b || b.fallen || !b.group) continue;
          const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
          out.push({ x: bx, z: bz, w: b.w || 8, d: b.d || b.w || 8, h: b.h || 8, gy: b.gy || 0, storeys: b.storeys,
            group: b.group, colliders: b.colliders, platforms: b.platforms, color: b.color, facadeStyle: b.facadeStyle, rec: b,
            // the ledger owns the fall: a topple TOWARD the hole, its rubble
            // going down the shaft rather than heaped on the footprint
            onFall: function (nx, nz, info) {
              collapse(b, ctx, { dirx: nx, dirz: nz, preShudder: 0.05, mode: "topple", noRubble: true, groundAt: info && info.groundAt });
              return { phase: 1, ledger: true };
            } });
        }
        return out;
      },
    });
  }
  /* WHERE A SINKHOLE MAY OPEN. The law lives in world/groundshaft.js
     (slope over the whole footprint, sampled off this arena's own ground) —
     this only says how far apart they are, how big this round's is, and
     which of the legal sites is WORTH it.

     A sinkhole in an empty field is a hole; the one that matters swallows a
     street. So several legal sites are drawn and scored by what is standing
     at them: road under it, parked cars in reach, a building at the lip
     (allowed now — the event undermines it properly instead of leaving it
     floating), trees. A site that fails the law is never relocated
     somewhere flatter-looking: no site, no hole. That is what keeps
     shaftAudit().holesOnSlopes at zero by construction. */
  function sinkSite(ctx, warnSecs) {
    if (!CBZ.groundShaftSite) {
      const p = ctx.arena.randomPoint(0, ctx.R * 0.8);
      const h = openHole(ctx, p.x, p.z, 4 + scale(2, ctx));
      if (h) (ctx.st.holes = ctx.st.holes || []).push(h);
      return null;
    }
    const r = 7 + scale(3.4, ctx);
    /* CLEAR OF THE OTHER HOLES IS LAW TOO. Two shafts cut into each other
       are not two sinkholes: the floor query answers from the FIRST live shaft
       that contains the point, so the middle of a 58 m hole reported as 1.6 m
       deep. Caught by tools/sinkhole-check.mjs. */
    function nearAnotherHole(x, z) {
      const S = CBZ.groundShafts || [];
      for (let i = 0; i < S.length; i++) if (Math.hypot(x - S[i].x, z - S[i].z) < S[i].r + r + 12) return true;
      const P = ctx.st.seqs || [];
      for (let i = 0; i < P.length; i++) if (Math.hypot(x - P[i].x, z - P[i].z) < P[i].r + r + 12) return true;
      return false;
    }
    function worth(x, z) {
      const A = ctx.arena;
      let s = 0;
      if (A.onRoad && A.onRoad(x, z)) s += 3;
      const C = A.cars || [];
      for (let i = 0; i < C.length; i++) { const c = C[i]; if (c && !c.flung && Math.hypot(c.x - x, c.z - z) < r + 2.5) s += 2; }
      const B = A.fragile || [];
      for (let i = 0; i < B.length; i++) {
        const b = B[i]; if (!b || b.fallen) continue;
        const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
        const half = Math.max(b.w || 8, b.d || 8) * 0.5, d = Math.hypot(bx - x, bz - z);
        if (d < r + half * 0.9) { s += 4; break; }
      }
      const T = A.flammable || [];
      for (let i = 0; i < T.length; i++) if (T[i] && Math.hypot(T[i].x - x, T[i].z - z) < r) s += 0.5;
      return s;
    }
    const spec = { cx: ctx.cx, cz: ctx.cz, R: ctx.R, r: r, rng: rnd, minDist: 14, tries: 90, undermine: true, avoid: nearAnotherHole };
    let site = null, best = -1;
    for (let k = 0; k < 8; k++) {
      const s = CBZ.groundShaftSite(spec);
      if (!s) continue;
      const w = worth(s.x, s.z);
      if (w > best) { best = w; site = s; }
    }
    if (!site) return null;
    const seq = stageHole(ctx, site.x, site.z, r);
    if (seq && seq.warnSecs != null && warnSecs) seq.warnSecs = warnSecs;
    if (seq) { (ctx.st.seqs = ctx.st.seqs || []).push(seq); (ctx.st.pending = ctx.st.pending || []).push(seq); }
    return seq;
  }
  /* The minimap and the bot brain read ctx.st.holes / ctx.st.pending (this
     file's own shapes). Promote a sequence from "pending" to "hole" the moment
     its shaft actually exists — no second record, just the same object moving
     lists as its state changes. */
  function sinkSync(ctx) {
    const P = ctx.st.pending || [], H = ctx.st.holes = ctx.st.holes || [];
    for (let i = P.length - 1; i >= 0; i--) {
      const s = P[i];
      if (s && s.shaft) { P.splice(i, 1); if (H.indexOf(s.shaft) < 0) H.push(s.shaft); }
    }
  }
  function sinkThreat(x, z, ctx, pad) {
    let t = 0;
    const H = ctx.st.holes || [], P = ctx.st.pending || [];
    for (let i = 0; i < H.length; i++) { const h = H[i]; const d = Math.hypot(x - h.x, z - h.z); const R = h.r * pad + 5; if (d < R) t = Math.max(t, 1 - d / R); }
    for (let i = 0; i < P.length; i++) { const p = P[i]; const d = Math.hypot(x - p.x, z - p.z); const R = p.r * pad + 6; if (d < R) t = Math.max(t, 0.9 * (1 - d / R)); }
    return t;
  }
  function sinkSafeDir(x, z, ctx) {
    let bx = 0, bz = 0;
    const all = (ctx.st.holes || []).concat(ctx.st.pending || []);
    for (let i = 0; i < all.length; i++) {
      const h = all[i];
      const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
      if (d < h.r * 1.6 + 8 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; }
    }
    return (bx || bz) ? { x: bx, z: bz } : null;
  }
  function tickHoles(dt, ctx) {
    // the shaft primitive owns falling, crushing and burial on its own updater
    // (order 28.6) in every mode; nothing is left to poll here.
    if (!CBZ.groundShaft && ctx.st.holes) legacyHoleKill(ctx);
  }
  function legacyHoleKill(ctx) {
    const holes = ctx.st.holes || [];
    surv().forEachActor(function (a) {
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (!h || h.legacy === undefined && h.mouth == null) continue;
        const hh = h.legacy || h;
        if (Math.hypot(a.pos.x - hh.x, a.pos.z - hh.z) > hh.mouth) continue;
        if (a.pos.y <= hh.bottom + 1.6) surv().hurt(a, 1e6, { cause: "swallowed by a sinkhole", fromX: hh.x, fromZ: hh.z });
        return;
      }
    });
  }
  /* THE HOLE STAYS. A sinkhole that heals when the round timer runs out is the
     same lie the black disc was — the ground does not come back. The shafts are
     disposed by the primitive when the MATCH resets (the director empties
     CBZ.survHoles, which is groundshaft.js's own reset signal), not when the
     disaster ends. All this closes is the telegraph. */
  function closeHoles(ctx) {
    if (!CBZ.groundShaft) {
      const holes = ctx.st.holes || [];
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i].legacy || holes[i];
        const k = CBZ.survHoles.indexOf(h);
        if (k >= 0) CBZ.survHoles.splice(k, 1);
        if (h.grp) { h.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(h.grp); }
      }
    }
    (ctx.st.holes || []).length = 0;
  }

  /* ============================================================
     THE METEOR SHOWER (METEOR_V2 wave). OWNER'S BRIEF: judge it against
     what a meteor event really is.

     The old shower (deleted 2026-09-28) was streaks on random headings, a
     brown box teleport-dropping from y=40, an instant bang and a painted
     decal. The event delegates the SKY to
     systems/meteor.js — one RADIANT all rocks share, visible bolides with
     smoke trains, AIRBURSTS carrying most of the energy, the flash arriving
     seconds before the bang (the pressure front expands at the same dramatic
     sound speed the audio is scheduled at, so the ring you watch sweep the
     island IS the noise), real craters through CBZ.groundCrater and
     incandescent ejecta on ballistic arcs.

     THIS FILE STILL OWNS THE GAME: which points get hit comes from the
     seeded stream, an impact is priced by survBlast's kinetic `meteor` row
     exactly as before, and the airburst's annulus damage runs on the mode's
     own actor roster via the damage callbacks handed to CBZ.meteor.begin().
     Ground strikes keep their marker telegraph (the bolide's shadow) so
     threat()/safeDir() still answer honestly; an airburst is not dodgeable,
     which is the point of an airburst — it wounds and knocks down rather
     than instakills.

     meteor.js is loaded on every page that loads this file (index.html and
     the generated disaster.html). Ratchet: CBZ.meteorAudit() (+ the meteor
     fields in CBZ.disasterAudit()).
     ============================================================ */
  function METEOR_DEF() {
    let mCtx = null;   // the live ctx, refreshed every tick, for the callbacks

    function beginV2(ctx) {
      mCtx = ctx;
      // what the thermal pulse, a gutted house and a glowing block light is
      // the island's one fire (meteor.js calls CBZ.wildfire directly)
      wfService(ctx, 0.25 + 0.35 * Math.min(1, ctx.intensity || 0));
      CBZ.meteor.begin({
        root: root(), floor, rnd,
        cx: ctx.cx, cz: ctx.cz, R: ctx.R, intensity: ctx.intensity,
        damage: {
          // A GROUND STRIKE: the kinetic pricing on the mode's own roster —
          // the bus draws the fireball (quiet: the bang is scheduled late by
          // meteor.js). Buildings are NOT swept here: the front reaches them
          // through meteor.js's damageBuilding() at their own overpressure.
          impact(x, z, spec) {
            const c = mCtx; if (!c) return;
            const big = spec.cls === "impact";
            survBlast("meteor", x, z, {
              r: spec.r || 6, cause: "flattened by a meteor", ctx: c, quiet: true,
              mass: big ? 300 : 4000 + 4000 * c.intensity, speed: big ? 13000 : 190 + 60 * c.intensity,
              struct: 0, fling: big ? 12 : 7, knockback: big ? 22 : 14, color: 0xffcaa0,
            });
          },
          // THE PRESSURE FRONT: an annulus sweeping outward at the speed of
          // sound, `k` from its real overpressure. Chelyabinsk's model — it
          // knocks you down and cuts you with the glass, it does not
          // vaporise you; a ground impact's near field does far worse.
          front(x, z, r0, r1, k) {
            const c = mCtx; if (!c || !surv().forEachActor) return;
            surv().forEachActor((a) => {
              const dx = a.pos.x - x, dz = a.pos.z - z, d = Math.hypot(dx, dz);
              if (d < r0 || d >= r1) return;
              /* A ROOF IS THE ANSWER THE CARD GIVES, so it has to be the
                 answer the physics gives: indoors the front rattles you and
                 the glass nicks you (a quarter of the wound, no throw); in the
                 open it knocks you flat and flings you. */
              const roofed = sheltered(a);
              if (CBZ.body) CBZ.body.hit(a, { fromX: x, fromZ: z, force: (5 + 13 * k) * (roofed ? 0.3 : 1), fling: !roofed && k > 0.45 ? 2.5 + 4 * k : 0 });
              if (k > 0.12) surv().hurt(a, (6 + 10 * k + 40 * k * k) * (roofed ? 0.25 : 1), { fromX: x, fromZ: z, cause: "caught in the meteor airburst" });
            });
          },
          // the island's structural ledger, reached through meteor.js's one
          // building adapter (CBZ.collapse.damage wins there when it exists)
          building(b, amount, dir) {
            structureHit(b, amount, mCtx, { kind: "meteor", dirx: dir ? dir.x : 0, dirz: dir ? dir.z : 0 });
          },
        },
      });
      // THE SHOWER: the debris stream itself, streaks and a few low pops all
      // event long; the ground strikes below are the def's (seeded, marked)
      CBZ.meteor.shower({ rate: 2 + 2.5 * (ctx.intensity || 0), pop: 0.1, ground: 0 });
    }
    // a low bolide is BRIGHTER THAN THE SUN: feed meteor.js's light into the
    // scene so the flash visibly lights the island before it makes a sound
    function lightV2(ctx) {
      const b = CBZ.meteor.lightBoost();
      if (b > 0.01) {
        ctx.env.sunInt = Math.min(1.7, ctx.env.sunInt + b * 1.3);
        ctx.env.hemiInt = Math.min(1.6, ctx.env.hemiInt + b * 0.9);
      }
    }
    /* THE HEADLINE BODY escalates with the arc: early rounds get the
       Chelyabinsk airburst (glass across the island, people knocked flat),
       later ones a low Tunguska burst (the forest flattened radially) or an
       iron that reaches the ground (the crater). CONFIG.METEOR_HEADLINE pins
       it (?cfg_METEOR_HEADLINE=impact). */
    function headlineClass(ctx) {
      const pin = CBZ.CONFIG.METEOR_HEADLINE;
      if (pin && CBZ.meteor.law.CLASSES[pin]) return pin;
      const u = rnd(), I = ctx.intensity || 0;
      if (I < 0.35) return u < 0.8 ? "chelyabinsk" : "tunguska";
      if (I < 0.7) return u < 0.35 ? "chelyabinsk" : u < 0.7 ? "tunguska" : "impact";
      return u < 0.3 ? "tunguska" : "impact";
    }
    function activeV2(dt, ctx) {
      mCtx = ctx;
      // a thin haze, not a 240 m soup: the flashes need a sky to light
      ctx.env.fog = 0x4a3a3a; ctx.env.fogNear = 70; ctx.env.fogFar = 480; ctx.env.hemiColor = 0xffb0a0;
      CBZ.meteor.tick(dt);
      lightV2(ctx);
      ctx.st.clock = (ctx.st.clock || 0) + dt;
      /* THE HEADLINE, once per event on a fixed beat (so every seed and both
         storyboard sides stage the same second): one big body crossing low.
         The flash whites the island, and then NOTHING for the seconds the
         front takes to crawl out to you. */
      if (!ctx.st.big && ctx.st.clock >= 5) {
        ctx.st.big = true;
        const cls = headlineClass(ctx);
        let p = null;
        /* AN IRON INTO THE SEA. Most of a planet is water, and an impact
           offshore does not dig a crater on the island: it lifts the sea.
           That splash is the chain into the TSUNAMI (the wave comes from the
           impact's bearing), and the shower round closes once it lands. */
        if (cls === "impact" && rnd() < 0.35) {
          for (let k2 = 0; k2 < 12 && !p; k2++) {
            const a3 = rnd() * 6.28, d3 = ctx.R * (1.15 + 0.25 * rnd());
            const qx = ctx.cx + Math.cos(a3) * d3, qz = ctx.cz + Math.sin(a3) * d3;
            if (floor(qx, qz) < seaY(qx, qz) - 2) { p = { x: qx, z: qz }; ctx.st.seaImpact = { x: qx, z: qz, bearing: a3, at: ctx.st.clock + 3.2 }; }
          }
        }
        if (cls === "impact") {
          // an iron needs ground a crater can be dug in (flat, dry, clear)
          for (let k2 = 0; k2 < 10 && !p; k2++) {
            const q = ctx.arena.randomPoint(ctx.R * 0.1, ctx.R * 0.6);
            if (!CBZ.groundShaftCanOpen || CBZ.groundShaftCanOpen(q.x, q.z, 18).ok) p = q;
          }
        }
        if (!p) { const a = rnd() * 6.28, d0 = ctx.R * (0.15 + 0.35 * rnd()); p = { x: ctx.cx + Math.cos(a) * d0, z: ctx.cz + Math.sin(a) * d0 }; }
        const eta = 3.2;
        CBZ.meteor.strike({ x: p.x, z: p.z, cls, eta });
        ctx.st.headline = { cls, x: p.x, z: p.z };
        // an impact's shadow is a place you can run from: marked at 2.5 crater radii
        if (cls === "impact") {
          const C = CBZ.meteor.law.CLASSES.impact, cr = CBZ.meteor.law.craterOf(C.L, C.dens, C.v, 0.8);
          const r = Math.min(18, cr.R) * 2.5;
          ctx.st.pending.push({ x: p.x, z: p.z, r, t: eta, t0: eta, m: CBZ.fx.groundMarker(p.x, p.z, r, 0xff5030) });
        }
      }
      // the splash has landed: the round closes and the sea is the next link
      const SI = ctx.st.seaImpact;
      if (SI && !SI.handed && ctx.st.clock > SI.at + 2.5) {
        SI.handed = true;
        ctx.st.chainTo = { id: "flood", delay: 0.5, why: "meteor", st: { chainBearing: SI.bearing } };
        ctx.st.endIn = 0;
      }
      ctx.st.cd -= dt;
      if (ctx.st.cd <= 0) {
        ctx.st.cd = (1.25 - 0.5 * ctx.prog) * (0.6 + rnd());
        const r = 5 + scale(2, ctx);
        // MOST OF A METEOR EVENT NEVER TOUCHES THE GROUND. The first strike
        // is a ground hit (the event must be felt); after that the majority
        // pop in the air, which is the real energy split.
        const ground = !ctx.st.first || rnd() < 0.4;
        ctx.st.first = true;
        let p = ctx.arena.randomPoint(0, ctx.R * 0.9);
        // an exposed player draws one ground strike in four (8-16 m off, the
        // marker gives ~1.7 s to move), so the roof is the answer you FEEL
        const PL = CBZ.player;
        const hunt = ground && !PL.dead && !underRoof(PL.pos.x, PL.pos.z, PL.pos.y) && rnd() < 0.25;
        if (hunt) { const a4 = rnd() * 6.28, d4 = 8 + rnd() * 8; p = { x: PL.pos.x + Math.cos(a4) * d4, z: PL.pos.z + Math.sin(a4) * d4 }; }
        else if (ground && CBZ.groundShaftCanOpen) {
          for (let k2 = 0; k2 < 5; k2++) {
            const q = ctx.arena.randomPoint(0, ctx.R * 0.8);
            if (CBZ.groundShaftCanOpen(q.x, q.z, 6).ok) { p = q; break; }
          }
        }
        const eta = 1.5 + rnd() * 0.6;
        CBZ.meteor.strike({ x: p.x, z: p.z, cls: ground ? "small" : "pop", alt: 30 + 45 * rnd(), eta, r });
        // the marker is the bolide's shadow — ground strikes only; you
        // cannot stand clear of an airburst and the map should not pretend
        if (ground) ctx.st.pending.push({ x: p.x, z: p.z, r, t: eta, t0: eta, m: CBZ.fx.groundMarker(p.x, p.z, r, 0xff5030) });
      }
      for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
        const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / (p.t0 || 1.2));
        if (p.t <= 0) { p.m.dispose(); ctx.st.pending.splice(i, 1); }
      }
      tick0(ctx, dt);
    }

    return {
      name: "METEOR SHOWER", emoji: "", warnSecs: 5, activeSecs: 17, gap: 6, cause: "flattened by a meteor", tint: 0x4a3a3a,
      _meteorDelegated: true,
      // STREAKS CROSS THE SKY FIRST. Bolides burn up high and harmlessly for a
      // few seconds before anything reaches the ground — which is exactly the
      // real sequence, and it makes the player look UP, which is where the
      // warning for the rest of the event will be. They all come from ONE
      // RADIANT, because a shower is one debris stream, not fireworks.
      warn(ctx) {
        narrate("hint", "METEORS, watch the shadows!", 2.6); sound("rumble");
        ctx.st.pending = []; ctx.st.timers = []; beginV2(ctx);
      },
      warnTick(dt, ctx) { mCtx = ctx; CBZ.meteor.tick(dt); lightV2(ctx); },
      warnThreat() { return 0.12; },   // nowhere is safe; keep the crowd moving
      start(ctx) {
        if (!CBZ.meteor.live()) beginV2(ctx);   // force() can skip warn
        ctx.st.pending = ctx.st.pending || []; ctx.st.cd = 1.0; ctx.st.clock = 0;
        ctx.env.sunInt = 0.85; ctx.st.timers = ctx.st.timers || [];
      },
      active(dt, ctx) { activeV2(dt, ctx); },
      end(ctx) {
        (ctx.st.pending || []).forEach((p) => p.m.dispose());
        if (CBZ.meteor.live()) CBZ.meteor.stop();
        mCtx = null;
      },
      threat(x, z, ctx) { let t = 0; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 3) t = Math.max(t, 1 - d / (p.r + 3)); }); return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < p.r + 4 && d > 0.1) { bx += dx / d; bz += dz / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    };
  }

  // ============================================================
  // DIRECTOR
  // ============================================================
  /* OWNER, 2026-08-15: "there doesn't need to be a finale... I never
     mentioned nuke". He is right about the premise, not just the pacing:
     this is a NATURAL disaster survival mode — eleven acts of nature and
     then, for no reason the island knows about, somebody nukes it. The bomb
     was only ever here because city/nukefx.js existed and the arc wanted a
     closer. The arc does not need one: it already reshuffles and repeats
     until the lobby resolves itself, which IS the battle royale.

     So the nuke is out of the rotation. The def stays registered — the city
     bomber still detonates through the same bus, debug/`force("nuke")` still
     works, and the pyroclastic whiteout still borrows nukefx's flash sheet —
     it is only no longer something the weather does to an island.
     SURV_NUKE_FINALE=true is the one-line revert. */
  if (CBZ.CONFIG.SURV_NUKE_FINALE == null) CBZ.CONFIG.SURV_NUKE_FINALE = false;
  // the classic arc — also the fallback when SURV_SHUFFLE is off
  const SEQUENCE_ALL = ["quake", "storm", "flashflood", "flood", "wildfire", "tornado", "hurricane", "blizzard", "meteor", "sinkhole", "volcano", "nuke"];
  const SEQUENCE = CBZ.CONFIG.SURV_NUKE_FINALE ? SEQUENCE_ALL.slice() : SEQUENCE_ALL.filter((id) => id !== "nuke");
  // pacing classes for the shuffled order: a run OPENS gentle, and the
  // island-wreckers never land back-to-back; the gentle opener keeps every
  // cycle boundary legal when the arc repeats (with the finale flag on, the
  // nuke is pinned last exactly as before)
  const GENTLE = { storm: 1, wildfire: 1, blizzard: 1, sinkhole: 1 };
  const MEGA = { flood: 1, volcano: 1, nuke: 1 };
  let runNo = 0, orderRng = null;
  let order = SEQUENCE.slice();

  // per-run SEEDED order (CBZ.seedStream ⇒ deterministic per world seed +
  // run counter — never Math.random: the arc is shared run structure).
  // Rejection-sample a Fisher–Yates shuffle of the natural hazards until the
  // pacing constraints hold. Under SURV_NUKE_FINALE the nuke is pinned last,
  // exactly as it always was; by default the arc is nature all the way.
  function buildOrder() {
    if (CBZ.CONFIG.SURV_SHUFFLE === false || !orderRng) return SEQUENCE.slice();
    const pool = SEQUENCE.filter((id) => id !== "nuke");
    for (let tries = 0; tries < 40; tries++) {
      for (let i = pool.length - 1; i > 0; i--) { const j = (orderRng() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      if (!GENTLE[pool[0]]) continue;                    // gentle opener
      // no mega in the closing slot: it either abuts the pinned nuke or, in
      // the natural arc, lands right before the next cycle's opener jolt
      if (MEGA[pool[pool.length - 1]]) continue;
      let ok = true;
      for (let i = 1; i < pool.length; i++) if (MEGA[pool[i]] && MEGA[pool[i - 1]]) { ok = false; break; }
      if (ok) return CBZ.CONFIG.SURV_NUKE_FINALE ? pool.concat("nuke") : pool;
    }
    return SEQUENCE.slice();   // vanishingly unlikely — fall back to the classic arc
  }

  const dir = { state: "idle", t: 6, cur: null, curId: null, st: {}, idx: 0, pos: 0, occ: 0, intensity: 0.2, prog: 0, overT: 0, overName: null,
    nextId: null, aliveAt: 0, killed: 0, cap: 0, last: null,
    // pacing (see THE CALM below)
    calm: false, calmT: 0, calmLen: 0, quietWait: 0, chain: null, link: null, links: [], clock: 0, log: [], cur_log: null };
  let curCtx = null;

  /* ============================================================
     THE ROUND IS A DECISION, NOT A DICE ROLL (2026-09-27).

     Measured on seed 90210 before this: the director gave 4-7 s of warning
     with no word on screen, so a new player never knew what was coming or
     what the right move was, and the crowd (whose only brain was "run down
     the local threat gradient") could not know either. The lobby's fate was
     the shuffle: one hurricane killed 65 of 100, one volcano 55 of 92, while
     the gentle openers killed 0-4. Nothing the player did mattered and the
     first ninety seconds were empty.

     Three things fix it and they live here because the director owns the
     round:

       BRIEF. Every disaster is ANNOUNCED `BRIEF` seconds before its def's
       own warn starts, with its name and the one kind of place that saves
       you (`advice()`). The physical telegraph still plays in the warn; the
       brief is the beat where the island decides where to run. The HUD and
       the crowd both read advice(), so the smart survivors are visibly
       running to the answer while the card is still up.

       THE CURVE. Each disaster may take at most a share of the living
       lobby, and the share climbs with the round number (10% on the first,
       nearly half by the ninth, 60% after that). A disaster that would
       kill past its share leaves the remaining bots on their feet, hurt.
       The PLAYER is never governed: you die honestly, the crowd thins on a
       schedule, and a match runs ten-plus disasters instead of three.

       INTENSITY. The escalation floor is higher, so the opener is a real
       event instead of a storm cell passing on the horizon.
     ============================================================ */
  const BRIEF = 7;          // s of announcement before the def's warn

  /* ============================================================
     THE CALM, AND THE CHAIN (2026-10-15).

     OWNER: "meteors last way too long and go into other disasters. There
     needs to be a time of no disaster between each; right now they overlap,
     which is dumb. Some should overlap, like earthquake to tsunami or
     earthquake to volcano, but right now it's dumb."

     What was wrong, measured in the code rather than guessed:
       - the director's "gap" was max(def.gap, 11 s) and the 7 s brief lived
         INSIDE it, so the island had about four quiet seconds between an
         all-clear and the next siren;
       - "ended" meant the def's timer ran out, not that its system stopped.
         The meteor afterglow ran up to 120 s (a big body's dust train is
         born with a 55-75 s life) and the fires its strikes lit kept
         SPREADING as the wildfire service; the blizzard's snow melts on a
         seven-minute clock and its drifts on four, so the town was still
         white under the next tsunami; the storm deck takes half a minute to
         clear; the tsunami backwash ran 40 s;
       - the quake's follow-ons were bolted on: an eruption started INSIDE
         the quake round on a 40% coin, and the tsunami was a force("flood")
         that also jumped the run's shuffled order to wherever "flood" sat.

     Now a round is: [chain of 1-3 linked disasters] -> CALM -> BRIEF -> next.

       THE CALM. When a round ends the director calls settleWorld(): every
       system with a lingering effect gets SETTLE seconds to fade it (snow
       melts, water drains, the sky clears, the fire burns out and nothing
       new catches, the meteor haze thins, the eruption's sky disperses).
       Then a seeded SURV_CALM_MIN..MAX seconds of nothing at all. If a
       system is still busy when the calm runs out (it should not be), the
       calm waits up to QUIET_CAP more seconds and then cuts it, and the
       timeline records what had to be cut.
       What PERSISTS is damage: rubble, burn scars, craters, stranded
       wrecks, the hardened lahar and the ash blanket on their own erosion.

       THE CHAIN. A def that CAUSES another sets ctx.st.chainTo = { id,
       delay, why, st } (and ctx.st.endIn to close its own round). The
       director then skips the calm and the order: the next link's warning
       starts `delay` seconds later as the same round (same round number,
       same death share, one "survived"), its card naming what caused it.
       Causal links only, each decided by the event's own physics:
         quake offshore M7.5+            -> tsunami (from the epicentre)
         quake inland M6+ under the cone -> volcano
         volcano whose fires still burn  -> wildfire (from the flank)
         hurricane Cat 2+                -> flash flood
         meteor iron into the sea        -> tsunami (from the splash)
       A chained id is struck from the rest of this cycle's order, so the
       same disaster does not come round again a minute later.
     ============================================================ */
  if (CBZ.CONFIG.SURV_CALM_MIN == null) CBZ.CONFIG.SURV_CALM_MIN = 12;
  if (CBZ.CONFIG.SURV_CALM_MAX == null) CBZ.CONFIG.SURV_CALM_MAX = 20;
  const QUIET_CAP = 10;     // s the calm may stretch for a slow system before it is cut
  const WATER_CAP = 120;    // s more it waits for water on the land (a runaway guard, never the plan)
  function hurryWater(k) {
    const F = CBZ.tsuRunup && CBZ.tsuRunup.current ? CBZ.tsuRunup.current() : null;
    if (F && F._endT != null) F.hurry = Math.max(F.hurry || 0, k);
    if (CBZ.flashflood && CBZ.flashflood.hurry) { try { CBZ.flashflood.hurry(k); } catch (e) {} }
  }
  const CHAIN_MAX = 3;      // links in one round
  function calmMin() { return Math.max(2, +CBZ.CONFIG.SURV_CALM_MIN || 12); }
  function calmMax() { return Math.max(calmMin(), +CBZ.CONFIG.SURV_CALM_MAX || 20); }
  // every lingering effect is gone by this far into the calm
  function settleSecs() { return Math.max(3, calmMin() * 0.7); }

  /* ONE CALL PUTS THE ISLAND BACK TO A CLEAR DAY OVER `secs`. Each system
     owns its own fade; this only asks. Damage is never on this list. */
  function settleWorld(secs) {
    weatherOff();
    if (CBZ.weatherSettle) { try { CBZ.weatherSettle(secs); } catch (e) {} }
    if (CBZ.blizzard && CBZ.blizzard.settle) { try { CBZ.blizzard.settle(secs); } catch (e) {} }
    if (CBZ.meteor && CBZ.meteor.settle) { try { CBZ.meteor.settle(secs); } catch (e) {} }
    if (CBZ.wildfire && CBZ.wildfire.settle) { try { CBZ.wildfire.settle(secs); } catch (e) {} }
    if (CBZ.tornado && CBZ.tornado.count && CBZ.tornado.count()) { try { CBZ.tornado.stop(); CBZ.tornado.siren && CBZ.tornado.siren(false); } catch (e) {} }
    if (CBZ.audioHush) { try { CBZ.audioHush(false); } catch (e) {} }
    // the high-water marks come off the walls (world/tsunami_scene.js, the
    // flash flood's own); a mark is never left standing into the next round
    if (CBZ.tsunamiScene && CBZ.tsunamiScene.settle) { try { CBZ.tsunamiScene.settle(secs); } catch (e) {} }
    if (CBZ.flashflood && CBZ.flashflood.settleMarks) { try { CBZ.flashflood.settleMarks(); } catch (e) {} }
    surgeSet(0);
    volSettleT = calmMax() + QUIET_CAP;     // the whole calm, at most
  }
  /* WHAT IS STILL GOING. [] = the island is quiet. Read by the calm, the
     timeline and the pacing check (tools/disaster-pacing-check.mjs). */
  function busyList() {
    const out = [];
    try { if (CBZ.meteor && CBZ.meteor.busy && CBZ.meteor.busy()) out.push("meteor"); } catch (e) {}
    try { if (CBZ.wildfire && CBZ.wildfire.busy && CBZ.wildfire.busy()) out.push("fire"); } catch (e) {}
    try { if (CBZ.tornado && CBZ.tornado.count && CBZ.tornado.count()) out.push("tornado"); } catch (e) {}
    try { if (CBZ.tsuRunup && CBZ.tsuRunup.current && CBZ.tsuRunup.current()) out.push("backwash"); } catch (e) {}
    try { if (CBZ.flashflood && CBZ.flashflood.busy && CBZ.flashflood.busy()) out.push("flood"); } catch (e) {}
    try { if (CBZ.blizzard && CBZ.blizzard.busy && CBZ.blizzard.busy()) out.push("drifts"); } catch (e) {}
    try {
      const W = CBZ.weather;
      if (W && ((W.snowCover || 0) > 0.02 || (W.groundWater || 0) > 0.02 || W.driven)) out.push("weather");
    } catch (e) {}
    for (let i = 0; i < volScars.length; i++) if (volScars[i] && volScars[i].kind === "sky" && !volScars[i].done) { out.push("ashcloud"); break; }
    return out;
  }
  // the calm ran out and something is STILL going: cut it, and say so
  function forceQuiet(list) {
    if (list.indexOf("meteor") >= 0 && CBZ.meteor && CBZ.meteor.hardStop) { try { CBZ.meteor.hardStop(); } catch (e) {} }
    if (list.indexOf("fire") >= 0 && CBZ.wildfire && CBZ.wildfire.settle) { try { CBZ.wildfire.settle(0.5); } catch (e) {} }
    if (list.indexOf("tornado") >= 0 && CBZ.tornado && CBZ.tornado.clear) { try { CBZ.tornado.clear(); } catch (e) {} }
    if (list.indexOf("backwash") >= 0 && CBZ.tsuRunup) { try { CBZ.tsuRunup.detach(); } catch (e) {} }
    if (list.indexOf("flood") >= 0 && CBZ.flashflood) { try { CBZ.flashflood.clear({ keepSilt: true, now: true }); } catch (e) {} }
    if (list.indexOf("drifts") >= 0 && CBZ.blizzard && CBZ.blizzard.settle) { try { CBZ.blizzard.settle(0.5); } catch (e) {} }
    if (list.indexOf("weather") >= 0 && CBZ.weatherSettle) { try { CBZ.weatherSettle(0.5); } catch (e) {} }
    if (list.indexOf("ashcloud") >= 0) {
      for (let i = volScars.length - 1; i >= 0; i--) if (volScars[i] && volScars[i].kind === "sky") { try { volScars[i].dispose(); } catch (e) {} volScars.splice(i, 1); }
    }
  }
  function logPush(rec) { dir.log.push(rec); if (dir.log.length > 200) dir.log.shift(); return rec; }
  const r1 = (v) => Math.round(v * 10) / 10;
  const ADVICE = {
    flood:      { kind: "high",        tip: "Get to high ground. Hills or the top floors of a tall building." },
    flashflood: { kind: "high",        tip: "Get off the low ground. Climb." },
    storm:      { kind: "indoors",     tip: "Get inside a building. Stay away from trees and open ground." },
    hurricane:  { kind: "indoors",     tip: "Get inside a building and go upstairs. The sea comes in behind the wind." },
    blizzard:   { kind: "indoors",     tip: "Get inside a building or you will freeze." },
    meteor:     { kind: "indoors",     tip: "Get under a solid roof." },
    volcano:    { kind: "indoors_far", tip: "Get away from the mountain and get inside." },
    quake:      { kind: "open",        tip: "Get out of the buildings. Open ground." },
    wildfire:   { kind: "clear",       tip: "Get to a road, the beach or burnt ground." },
    tornado:    { kind: "away",        tip: "Watch the funnel. Run across its path, not ahead of it." },
    sinkhole:   { kind: "away",        tip: "Watch the ground. When it cracks, run." },
    nuke:       { kind: "indoors_far", tip: "Get inside, as far from the blast as you can." },
  };
  function deathShare(occ, alive) {
    return Math.min(0.6, 0.1 + 0.045 * Math.max(0, occ - 1));
  }
  /* THE ENDGAME. Measured with the curve alone: the last eight bots sat
     through four disasters that took nobody, then one tornado took all of
     them at once and the match ended on a frame. So the final few are a
     countdown instead: at most ONE bot per disaster once the lobby is down
     to the last handful, and the sky gets meaner and quicker as it thins. */
  const ENDGAME = 4;
  function liveBotCount() { return CBZ.surv && CBZ.surv.liveBots ? CBZ.surv.liveBots() : 0; }
  // the next id in this run's arc, reshuffling at the cycle boundary exactly
  // once (beginWarn and the brief both ask; whoever asks first shuffles)
  function peekNext() {
    if (dir.pos >= order.length) { order = buildOrder(); dir.pos = 0; }
    return order[dir.pos];
  }

  function makeCtx(dt) {
    const A = CBZ.surv.arena;
    return {
      dt, now: CBZ.now, arena: A, cx: A.center.x, cz: A.center.z, R: A.radius,
      surv: CBZ.surv, fx: CBZ.fx, env: CBZ.survEnv, st: dir.st,
      intensity: dir.intensity, prog: dir.prog,
      // Definitions author their own pacing and several (both tsunami paths
      // included) derive travel speed from it. Omitting this made divisions
      // produce NaN even though the director timer itself kept counting down.
      warnSecs: dir.cur ? dir.cur.warnSecs : 0,
      activeSecs: dir.cur ? dir.cur.activeSecs : 0,
      gap: dir.cur ? dir.cur.gap : 0,
    };
  }

  // universal warn-phase ambience: as the countdown runs, the sun dims and
  // the fog/sky lerps toward the incoming hazard's `tint` mood colour — the
  // whole world says "something is coming" even if you missed the banner.
  // A def's own warnTick runs after this and can still override (the nuke).
  function lerpHex(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
  }
  function warnAmbience() {
    if (CBZ.CONFIG.SURV_TELEGRAPH === false || !dir.cur) return;
    const k = Math.min(1, Math.max(0, 1 - dir.t / (dir.cur.warnSecs || 1)));
    const e = CBZ.survEnv;
    e.sunInt *= 1 - 0.3 * k;
    e.hemiInt *= 1 - 0.18 * k;
    if (dir.cur.tint != null) e.fog = lerpHex(e.fog, dir.cur.tint, 0.5 * k);
  }

  /* ---- THE SURVIVORS TALK -----------------------------------------------
     The only words in this game are people's: the nearest survivor to you
     notices the thing starting, cries out when it lands, and says what it
     cost him when it is over. Over his own head (systems/speech.js). Never
     advice, never where to go: what saves you is yours to work out. */
  const VOICE = {
    warn: ["Do you feel that?", "What is that?", "Oh no. Not again.", "The birds just left.", "My phone has no signal."],
    warnBy: {
      quake: ["The glasses are rattling.", "Did the ground just move?"],
      tornado: ["Look at that sky. It's gone green.", "That's not a cloud."],
      flood: ["Why is the sea going out?", "Where did the water go?"],
      flashflood: ["The drains are backing up.", "Hear that? Upstream."],
      wildfire: ["I smell smoke.", "The hills are orange."],
      volcano: ["The mountain's smoking again.", "It's raining ash."],
      meteor: ["Is that a plane?", "Something's burning up there."],
      hurricane: ["My ears just popped.", "Here it comes."],
      storm: ["Here it comes.", "That thunder's close."],
      blizzard: ["I can't feel my fingers.", "It was sunny an hour ago."],
      nuke: ["Those are the real sirens.", "That's not a drill. That's not a drill."],
      sinkhole: ["The road's cracking.", "Did you hear that under us?"],
    },
    active: ["Oh God. Oh God.", "Mama!", "Somebody help me!", "I can't see!", "Where's my daughter?", "Don't leave me!", "Not like this!", "Grab my hand!"],
    after: ["I'm still here. I'm still here.", "Has anyone seen Rosa?", "My whole street. Gone.",
      "I just paid that house off.", "My dog was in the yard.", "He was right behind me.",
      "I should have left last year.", "Is it over? Is it really over?", "I can't stop shaking.", "Somebody call my mother."],
  };
  const voiceUsed = {};
  function voiceLine(pool) {
    // skip the last line said from this pool so two in a row never repeat
    let i = (Math.random() * pool.length) | 0;
    if (pool.length > 1 && voiceUsed[pool[0]] === i) i = (i + 1) % pool.length;
    voiceUsed[pool[0]] = i;
    return pool[i];
  }
  function survivorSays(pool, delay) {
    setTimeout(function () {
      const SP = CBZ.speech, P = { pos: eyePos() }, B = CBZ.bots;
      if (!SP || !SP.say || !P.pos || !B || !CBZ.game || CBZ.game.mode !== "survival") return;
      let who = null, bd = 26 * 26;
      for (let i = 0; i < B.length; i++) {
        const b = B[i]; if (!b || b.dead || !b.pos) continue;
        const dx = b.pos.x - P.pos.x, dz = b.pos.z - P.pos.z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; who = b; }
      }
      if (!who) return;
      try { SP.say(who, voiceLine(pool), { secs: 2.8 }); } catch (e) {}
    }, delay * 1000);
  }

  function beginWarn() {
    const chain = dir.chain;
    dir.chain = null;
    tsuSeaCalm = null;          // a new card owns the sea's look from here
    let id;
    if (chain && DEFS[chain.id]) {
      /* THE NEXT LINK OF THIS ROUND: no new round number, no new death
         share (the cap grows by half, the second wave is a second killer),
         the order is untouched — the chained id was struck from it. */
      id = chain.id;
      dir.cap = Math.max(dir.cap + 1, Math.ceil(dir.cap * 1.5));
      dir.links.push(id);
    } else {
      // survived a whole arc? reshuffle the next cycle from the same run stream
      // (nuke-last + gentle-first keeps the wraparound pacing legal by itself)
      id = peekNext();
      dir.pos++; dir.idx++; dir.occ++;
      dir.links = [id]; dir.link = null;
      // the curve: this disaster's share of the living lobby
      dir.aliveAt = liveBotCount(); dir.killed = 0;
      dir.cap = dir.aliveAt <= ENDGAME ? 1 : Math.max(1, Math.ceil(dir.aliveAt * deathShare(dir.occ, dir.aliveAt)));
      const late = dir.aliveAt <= 15 ? (15 - dir.aliveAt) / 15 : 0;
      dir.intensity = Math.min(1.7, 0.42 + dir.occ * 0.12 + 0.5 * late);   // 1.7: the ceiling every def was tuned under
    }
    dir.nextId = null;
    dir.calm = false;
    if (CBZ.wildfire && CBZ.wildfire.unlock) CBZ.wildfire.unlock();
    dir.cur = DEFS[id]; dir.curId = id; dir.st = Object.assign({}, chain && chain.st); dir.state = "warn"; dir.t = dir.cur.warnSecs;
    dir.overT = 0; dir.overName = null;   // a new warning supersedes the all-clear
    curCtx = makeCtx(0);
    dir.cur_log = logPush({ id, round: dir.occ, chainFrom: chain ? chain.from : null, warnAt: r1(dir.clock), activeAt: null, endAt: null });
    narrate("banner", dir.cur.name + " · INCOMING");
    // THE UNIVERSAL TELEGRAPH IS PHYSICAL: every warning lands with a jolt you
    // feel, warnAmbience() below tints the whole sky toward the hazard's mood,
    // and the def's own warnTick starts the world doing the thing. Nothing on
    // screen says what is coming — the world does.
    if (CBZ.CONFIG.SURV_TELEGRAPH !== false && CBZ.shake) CBZ.shake(0.22);
    try { dir.cur.warn(curCtx); } catch (e) { console.error("[disaster warn]", e); }
    survivorSays(VOICE.warnBy[id] && Math.random() < 0.7 ? VOICE.warnBy[id] : VOICE.warn, 1.2 + Math.random());
  }
  function beginActive(ctx) {
    dir.state = "active"; dir.t = dir.cur.activeSecs;
    if (dir.cur_log) dir.cur_log.activeAt = r1(dir.clock);
    if (CBZ.surv) CBZ.surv._cause = dir.cur.cause || "killed by the disaster";   // default cause for kill feed
    narrate("banner", dir.cur.name);
    try { dir.cur.start(ctx); } catch (e) { console.error("[disaster start]", e); }
    survivorSays(VOICE.active, 0.8 + Math.random() * 1.5);
  }
  function endActive(ctx) {
    try { dir.cur.end(ctx); } catch (e) { console.error("[disaster end]", e); }
    if (dir.cur_log) dir.cur_log.endAt = r1(dir.clock);
    /* A CAUSE HANDS OFF TO ITS EFFECT. The next link's warning is this
       round's next beat: no calm, no settle (the quake's drawdown IS the
       tsunami's first second, the eruption's fire IS the wildfire's seed). */
    const ch = dir.st && dir.st.chainTo;
    if (ch && DEFS[ch.id] && dir.links.length < CHAIN_MAX && ch.id !== dir.curId) {
      // strike the effect from the rest of this cycle: it just happened
      const k = order.indexOf(ch.id, dir.pos);
      if (k >= 0) order.splice(k, 1);
      dir.chain = { id: ch.id, from: dir.curId, why: ch.why || dir.curId, st: ch.st || null };
      dir.link = dir.cur.name;
      if (dir.cur_log) dir.cur_log.chainTo = ch.id;
      if (CBZ.surv) CBZ.surv._cause = null;
      dir.state = "idle"; dir.calm = false; dir.t = Math.max(0.05, +ch.delay || 0.5);
      dir.nextId = ch.id;
      dir.cur = null; dir.curId = null;
      return;
    }
    if (!CBZ.player.dead) { CBZ.surv.stats.disastersSurvived++; survivorSays(VOICE.after, 2 + Math.random() * 2); }
    if (CBZ.surv) CBZ.surv._cause = null;
    // The ALL-CLEAR is now the world going quiet: warnAmbience releases the
    // sky tint, weatherOff() bleeds the rain out over ~3.5 s, and the surge
    // returns to zero. `overName` survives only as state the minimap and the
    // audit read — nothing draws it.
    dir.overName = dir.cur.name;
    dir.overT = Math.min(4, dir.cur.gap || 4);
    // what the round cost, for the SURVIVED card (systems/survivalhud.js)
    dir.last = { id: dir.curId, name: dir.links.map(function (k) { return DEFS[k] ? DEFS[k].name : k; }).join(" > "), chain: dir.links.slice(),
      n: dir.occ, killed: Math.max(0, dir.aliveAt - liveBotCount()), alive: CBZ.surv.aliveCount(), you: !CBZ.player.dead, t: CBZ.now };
    // THE CALM: everything this round left lingering fades over settleSecs(),
    // then nothing at all until the calm runs out; then the brief. The last
    // handful get the short end of the calm.
    const sec = settleSecs();
    settleWorld(sec);
    dir.calmLen = liveBotCount() <= ENDGAME ? calmMin() : calmMin() + (calmMax() - calmMin()) * rnd();
    dir.calm = true; dir.calmT = dir.calmLen; dir.quietWait = 0;
    dir.link = null;
    if (dir.cur_log) dir.cur_log.calm = r1(dir.calmLen);
    dir.state = "idle"; dir.t = dir.calmLen + BRIEF; dir.cur = null; dir.curId = null;
  }

  // one answer to "how dangerous is (x,z) right now", warn phase included
  function liveThreat(x, z) {
    if (!dir.cur || !curCtx) return 0;
    if (dir.state === "warn" && dir.cur.warnThreat) {
      try { return dir.cur.warnThreat(x, z, curCtx) || 0; } catch (e) { return 0; }
    }
    if (!dir.cur.threat) return 0;
    try { return dir.cur.threat(x, z, curCtx) || 0; } catch (e) { return 0; }
  }

  CBZ.disasters = {
    // RATCHET MARKER (systems/tornado.js's CBZ.tornadoAudit reads this). The
    // roster's `tornado` slot no longer owns a vortex of its own — it calls
    // CBZ.tornado.spawn/stop and reads CBZ.tornado.threat/safeDir. If this
    // file ever grows a second funnel again, delete this line and the audit
    // will count it. The number may only go DOWN.
    _tornadoDelegated: true,
    start() {
      // if a previous match ended mid-disaster, tear its meshes down cleanly
      if (dir.cur && dir.cur.end && dir.state === "active") { try { dir.cur.end(makeCtx(0)); } catch (e) {} }
      // a fresh match starts on a flat sea, clear weather and no open holes
      surgeSet(0); weatherOff();
      // the hurricane's town (felled trees, peeled roofs, dark districts,
      // beached boats, debris) stands back up for the new match
      if (CBZ.hurricane && CBZ.hurricane.resetWorld) {
        CBZ.hurricane.resetWorld();
        try { if (CBZ.surv && CBZ.surv.arena) CBZ.hurricane.prewire(DEFS.hurricane._world(makeCtx(0))); } catch (e) {}
      }
      // the tornado's journal: every roof, wall, tree and car it moved goes
      // back, its debris, hail and scar are cleared, the siren stops
      if (CBZ.tornado && CBZ.tornado.restoreWorld) { try { CBZ.tornado.restoreWorld(); } catch (e) {} }
      if (CBZ.survHoles) CBZ.survHoles.length = 0;
      said.banners = said.hints = said.toasts = 0;
      // a fresh SEEDED arc for this run: world seed + run counter → the same
      // match order for every client, a different order every match
      runNo++;
      orderRng = CBZ.seedStream ? CBZ.seedStream("surv-sequence-" + runNo) : null;
      reseedHazards(runNo);      // the hazards themselves, same seed, same run
      order = buildOrder();
      // 10 s: three seconds to look around the island, then the first card
      if (CBZ.tsuRunup) CBZ.tsuRunup.detach();   // a new match: no backwash left running
      dir.state = "idle"; dir.t = 10; dir.cur = null; dir.curId = null; dir.st = {}; dir.idx = 0; dir.occ = 0; dir.intensity = 0.2; dir.overT = 0; dir.overName = null; curCtx = null; fallingBuildings.length = 0; flungCars.length = 0;
      dir.nextId = null; dir.pos = 0; dir.aliveAt = 0; dir.killed = 0; dir.cap = 0; dir.last = null;
      dir.calm = false; dir.calmT = 0; dir.calmLen = 0; dir.quietWait = 0; dir.chain = null; dir.link = null; dir.links = [];
      dir.clock = 0; dir.log.length = 0; dir.cur_log = null; volSettleT = 0;
      // a fresh match starts dry and green, whatever the last one left
      if (CBZ.weatherGroundReset) { try { CBZ.weatherGroundReset(); } catch (e) {} }
    },
    /* WHAT IS COMING AND WHAT SAVES YOU. null when the sky is quiet. phase
       "brief" = announced, the def's warn has not started; tLeft = seconds
       until the disaster goes ACTIVE. `from` is the hazard's origin where it
       has one (the volcano, the funnel). Read by the HUD card and the crowd. */
    advice() {
      const id = dir.curId || dir.nextId;
      if (!id) return null;
      const def = DEFS[id]; if (!def) return null;
      const a = ADVICE[id] || { kind: "away", tip: "Get clear of it." };
      const phase = dir.curId ? dir.state : "brief";
      let tLeft = 0;
      if (phase === "brief") tLeft = dir.t + (def.warnSecs || 0);
      else if (phase === "warn") tLeft = dir.t;
      else tLeft = -Math.max(0, dir.t);        // active: negative = seconds of it left
      let from = null;
      const A = CBZ.surv && CBZ.surv.arena;
      if ((id === "volcano" || id === "nuke") && A && A.hills && A.hills[0]) {
        const vs = (dir.st && dir.st.erS) || A.hills[0];
        from = { x: vs.x, z: vs.z };
      }
      if (id === "nuke" && dir.st && dir.st.gx != null) from = { x: dir.st.gx, z: dir.st.gz };
      if (id === "tornado" && dir.curId === "tornado" && dir.st && dir.st.x != null) from = { x: dir.st.x, z: dir.st.z };
      return { id, name: def.name, link: dir.link, phase, kind: a.kind, tip: a.tip, from, tLeft,
        warnSecs: def.warnSecs || 0, activeSecs: def.activeSecs || 0, brief: BRIEF, n: dir.curId ? dir.occ : dir.occ + 1 };
    },
    /* IS THIS SPOT THE RIGHT KIND OF PLACE for what is coming? One oracle
       for the HUD's SAFE / EXPOSED chip and anyone else who asks, graded off
       the same physical tests the disasters use (underRoof is the blizzard's,
       hurricane's and ash's own shelter test). `y` is feet height.
       Returns { safe, kind } or null when nothing is coming. */
    safeAt(x, z, y) {
      const adv = CBZ.disasters.advice(); if (!adv) return null;
      const A = CBZ.surv && CBZ.surv.arena; if (!A) return null;
      let safe = false;
      const roof = underRoof(x, z, y);
      if (adv.kind === "indoors") {
        safe = roof;
        // the hurricane's surge floods every ground floor on this flat island
        if (safe && adv.id === "hurricane") safe = y - (CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0) >= 3;
      }
      else if (adv.kind === "indoors_far") {
        const f = adv.from || A.center;
        safe = roof && Math.hypot(x - f.x, z - f.z) > (adv.id === "volcano" ? 65 : 70);
      } else if (adv.kind === "high") {
        const sea = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
        safe = y - sea >= (adv.id === "flood" ? 11 : 4.5);
      } else if (adv.kind === "open") {
        safe = !roof;
        for (let i = 0; safe && i < A.fragile.length; i++) {
          const b = A.fragile[i]; if (b.fallen) continue;
          const ex = Math.max(0, Math.abs(x - b.ox) - b.w / 2), ez = Math.max(0, Math.abs(z - b.oz) - b.d / 2);
          if (Math.hypot(ex, ez) < Math.max(6, Math.min(24, (b.h || 10) * 0.6))) safe = false;
        }
      } else if (adv.kind === "clear" && CBZ.wildfire && CBZ.wildfire.refuge) {
        // bare or already-burnt ground, clear air, nothing alight beside you
        safe = CBZ.wildfire.refuge(x, z) >= 0.5;
      } else if (adv.kind === "clear") {
        safe = true;
        const T = A.flammable || [];
        for (let i = 0; safe && i < T.length; i++) {
          const t = T[i]; if (t.burnt) continue;
          if (Math.hypot(x - t.x, z - t.z) < (t.burning ? 14 : 9)) safe = false;
        }
      } else {
        safe = liveThreat(x, z) < 0.15;
        if (adv.from && Math.hypot(x - adv.from.x, z - adv.from.z) < 30) safe = false;
      }
      return { safe, kind: adv.kind };
    },
    /* THE SIZE OF THIS ONE, in the unit the real world measures it in, for
       the HUD. Read off the def's own roll, so it is the number the event is
       actually being simulated at, never a label picked to sound scary.
       null until the roll exists (most defs roll in warn(), the tornado at
       touchdown), and null for the disasters with no public scale. */
    scale() {
      const id = dir.curId;
      if (!id) return null;
      const st = dir.st || {}, def = DEFS[id];
      if (id === "quake") return (qkQ && qkRollNo === dir.occ && !qkQ.legacy && qkQ.M) ? "M" + qkQ.M.toFixed(1) : null;
      if (id === "hurricane") return def._catF ? "Cat " + Math.max(1, Math.min(5, Math.floor(def._catF))) : null;
      if (id === "tornado") return st.tw && st.tw.ef != null ? "EF" + Math.max(0, Math.min(5, st.tw.ef | 0)) : null;
      if (id === "volcano") return st.erMag != null ? "VEI " + Math.max(1, Math.min(6, Math.round(1 + 5 * st.erMag))) : null;
      if (id === "flood") {
        const H = st.H != null ? st.H : (st.mag != null ? Math.max(10, Math.min(44, 34 * st.mag)) : null);
        return H != null ? Math.round(H) + " m wave" : null;
      }
      // the standing water in the channel at the height of it (st.peak is the sea's rise)
      if (id === "flashflood") return st.pool != null ? st.pool.toFixed(1) + " m deep" : null;
      if (id === "wildfire") {
        const m = CBZ.wildfire && CBZ.wildfire.magnitude ? CBZ.wildfire.magnitude() : null;
        if (m == null || dir.state === "warn") return null;
        // the US fire danger adjective scale
        return m < 0.2 ? "Low danger" : m < 0.4 ? "Moderate danger" : m < 0.6 ? "High danger" : m < 0.8 ? "Very high danger" : "Extreme danger";
      }
      if (id === "sinkhole") {
        let r = 0;
        (st.holes || []).forEach((h) => { r = Math.max(r, h.r || 0); });
        (st.pending || []).forEach((h) => { r = Math.max(r, h.r || 0); });
        return r > 0 ? Math.round(r * 2) + " m wide" : null;
      }
      return null;
    },
    // the round just finished (name, number, what it cost), for the HUD
    lastResult() { return dir.last; },
    /* THE PACE, for the HUD and the pacing check. calm: the quiet between
       rounds (calmLeft = seconds until the next brief); chain: the next link
       is already decided (its card is up as a brief). busy: what is still
       fading. */
    pace() {
      return { calm: dir.calm, calmLeft: dir.calm ? Math.max(0, dir.calmT) : 0, calmLen: dir.calmLen,
        chain: dir.chain ? dir.chain.id : null, link: dir.link, links: dir.links.slice(), busy: busyList(), clock: dir.clock };
    },
    // every warn / active / end / calm this match, in director seconds
    timeline() { return dir.log.map(function (r) { return Object.assign({}, r); }); },
    /* QA / storyboard: close the ACTIVE disaster now and hand off to `id`
       through exactly the path a def's own chain takes (ctx.st.chainTo).
       The physics normally decides this; this only lets a check stage it. */
    chainNow(id, opts) {
      if (dir.state !== "active" || !dir.st || !DEFS[id]) return false;
      dir.st.chainTo = Object.assign({ id: id, delay: 0.5, why: "qa" }, opts || {});
      dir.st.endIn = 0;
      return true;
    },
    round() { return dir.occ; },
    /* THE CURVE'S GATE (see BRIEF above). modes/survival.js killBot asks this
       before a disaster may take a bot: true = spare it (the share for this
       disaster is spent). Counts every bot death from the warn until the
       next warn, so the after-effects of a disaster bill to it. */
    spareBot(b, cause) {
      if (CBZ.game.mode !== "survival" || !dir.occ) return false;
      if (cause && /beaten|punch|thrown|shoved|fists|run over/.test(cause)) return false;   // your hands (and your bumper) are not the weather
      if (dir.killed >= dir.cap) return true;
      dir.killed++;
      return false;
    },
    threatAt(x, z) { return (dir.cur && curCtx) ? liveThreat(x, z) : 0; },
    /* THE CROWD IS THE WARNING. This is what turns 99 bots from set dressing
       into the loudest telegraph in the mode: during the WARN phase a def can
       now answer `warnThreat`/`warnSafeDir` for a hazard that has not happened
       yet, so the island empties off the mountain before the volcano blows and
       floods uphill before the sea comes back. A player who has never read a
       word of UI learns the tsunami from a hundred people running past him. */
    fleeVector(x, z) {
      if (dir.state === "idle" || !dir.cur || !curCtx) return null;
      const t = liveThreat(x, z);
      if (t < 0.15) return null;
      const warn = dir.state === "warn";
      const sd = (warn && dir.cur.warnSafeDir) ? dir.cur.warnSafeDir(x, z, curCtx)
        : (dir.cur.safeDir ? dir.cur.safeDir(x, z, curCtx) : null);
      if (!sd) return { x: 0, z: 0, w: t };
      const m = Math.hypot(sd.x, sd.z) || 1;
      return { x: sd.x / m, z: sd.z / m, w: t };
    },
    current() { return dir.cur ? dir.cur.name : null; },
    /* The two reads a snapshot needs and a name cannot give: WHICH def (by the
       roster id, which is stable across builds and localisations) and how hard
       this occurrence is hitting. net/survnet.js writes both into the wire
       format; nothing else in the game reads them. */
    currentId() { return dir.curId; },
    intensity() { return dir.intensity; },
    state() { return dir.state; },
    timeLeft() { return Math.max(0, dir.t); },
    /* THE TSUNAMI'S EVIDENCE. Field NAMES and expected VALUES are unchanged
       from the browser regression (tools/test-survival-tsunami-browser.mjs) —
       what changed is that `floodMode`/`floodGrid` now describe the ARENA
       OCEAN, because the private inundation sheet they used to describe no
       longer exists. `floodIsOcean` is the new evidence that this is a
       migration and not a deletion: ONE surface floods the island, it is the
       sea, and `surge` is the single number that moved it. */
    tsunamiAudit() {
      const A = CBZ.surv && CBZ.surv.arena, st = dir.st || {};
      if (!A) return { ok: false, reason: "arena-not-built" };
      const ev = CBZ.waterEventGet ? CBZ.waterEventGet() : null;
      const om = A.ocean && A.ocean.material;
      let ahead = null, behind = null;
      if (st.dx != null && st.frontS != null && st.frontS > -1e8 && CBZ.waterEventSample) {
        const ax = A.center.x + st.dx * (st.frontS + 14), az = A.center.z + st.dz * (st.frontS + 14);
        const bx = A.center.x + st.dx * (st.frontS - 14), bz = A.center.z + st.dz * (st.frontS - 14);
        ahead = Object.assign({}, CBZ.waterEventSample(ax, az, null, {}));
        behind = Object.assign({}, CBZ.waterEventSample(bx, bz, null, {}));
      }
      const og = A.ocean && A.ocean.geometry && A.ocean.geometry.userData.waterDisasterGrid;
      const mode = om && om.userData && om.userData.waterMode;
      const U = om && om.userData && om.userData.waterUniforms;
      const dbg = st.debris ? st.debris.stats() : null;
      const refuges = { total: 0, standing: 0, swept: 0 };
      for (let i = 0; i < A.fragile.length; i++) {
        const b = A.fragile[i];
        if (b.h >= 12) { refuges.total++; if (!b.fallen) refuges.standing++; }
        else if (b.fallen) refuges.swept++;
      }
      return {
        ok: true, active: dir.curId === "flood", directorState: dir.state, phase: st.phase || null,
        eventOwner: ev && ev.owner, eventPhase: ev && ev.phase,
        oceanMode: mode,
        // the flooding surface IS the ocean now — same mode, same grid
        floodMode: mode, floodGrid: og || null, floodIsOcean: true,
        oceanGrid: og || null,
        waveAnimated: !!(st.waveWall && st.waveBasePos),
        aheadWet: ahead && ahead.wet, behindWet: behind && behind.wet,
        aheadHeight: ahead && ahead.height, behindHeight: behind && behind.height,
        level: st.level, frontS: st.frontS,
        // ONE WATER: the whole event as one number, plus the roughness the
        // shader and the CPU height query are BOTH reading
        surge: CBZ.waterSurge ? CBZ.waterSurge() : 0,
        meanY: CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : null,
        amp: U ? U.uDisasterAmp.value : null, chop: U ? U.uDisasterChop.value : null,
        seaTime: U ? U.uSeaTime.value : null,
        privateSurfaces: root && CBZ.surv.arena.root.getObjectByName("tsunami-inundation-surface") ? 1 : 0,
        /* ---- THE SCARY WATER: turbidity, the load it is carrying, and the
           pull on the way out. Every one of these is read off live state, so a
           run that never entrained anything reports zeros and cannot be
           mistaken for a run that did. ---- */
        faceShared: !!(CBZ.CONFIG.TSU_FACE_V2 !== false && st.face),
        sediment: st.sediment != null ? +(+st.sediment).toFixed(3) : 0,
        shaderSediment: U && U.uDwSediment ? +U.uDwSediment.value.toFixed(3) : null,
        shoal: st.shoal != null ? +(+st.shoal).toFixed(3) : null,
        /* How much of itself the bore has left, and how tall the wall
           actually is right now. `spent` is 1 at the beach and runs to nearly
           nothing at the far shore, so "did the wave come down as it crossed"
           stops being an opinion about a screenshot. */
        spent: st.spent != null ? +(+st.spent).toFixed(3) : null,
        faceH: st.faceH != null ? +(+st.faceH).toFixed(1) : null,
        /* THE SHOALING ARC (TSU_SHOAL_V2), as numbers: how fast the front is
           actually moving over ground right now, whether the wave is in its
           held stand at the beach, and how long ago the lip came down. A
           build that predates these reports nothing, which reads as 0 /
           false / null — "not measured", never "no wave". */
        frontV: st.frontV != null ? +(+st.frontV).toFixed(2) : null,
        /* ---- THE CLOCK, so pacing is a measurement ----------------------
           eventT is seconds since the sea started going out; sweepT is how
           long the front has been travelling; crashAtT is the eventT the lip
           came down at. The budgets it is spending are published beside them,
           because "the wave is slow" and "the wave has 26 seconds to fill"
           are different bugs with different fixes. A build that predates
           these reports null = not measured. */
        eventT: st.eventT != null ? +(+st.eventT).toFixed(2) : null,
        activeT: st.activeT != null ? +(+st.activeT).toFixed(2) : null,
        sweepT: st.sweepT != null ? +(+st.sweepT).toFixed(2) : null,
        phaseT: st.phaseT != null ? +(+st.phaseT).toFixed(2) : null,
        crashAtT: st.crashAtT != null && st.crashAtT >= 0 ? +(+st.crashAtT).toFixed(2) : null,
        warnBudget: TSUNAMI_V2.warnSecs, activeBudget: TSUNAMI_V2.activeSecs,
        floodT: st.floodT != null ? +(+st.floodT).toFixed(2) : null,
        floodBudget: st.floodBudget != null ? +(+st.floodBudget).toFixed(2) : null,
        // how much of the inundation is still standing, 1 -> 0 across the
        // drain: the physical read of "how far through the undertow are we"
        drainK: st.drainK != null ? +(+st.drainK).toFixed(3) : null,
        stalled: !!(st.phase === "sweep" && st.stallT > 0 && !st.broke),
        crashAge: st.crashT != null && st.crashT >= 0 ? +(+st.crashT).toFixed(2) : null,
        /* THE RUN-UP, measured: how far inland and how high the water got,
           the deepest it stood on the land, how much of it is still there,
           and what the solver costs a step. */
        runup: st.run ? st.run.stats() : null,
        runupAttached: !!(st.run && CBZ.tsuRunup && CBZ.tsuRunup.current() === st.run),
        debris: dbg,
        debrisEntrained: dbg ? dbg.entrained : 0,
        debrisLive: dbg ? dbg.live : 0,
        debrisStrikes: dbg ? dbg.strikes : 0,
        debrisKills: dbg ? dbg.kills : 0,
        undertowPull: st.undertow != null ? +(+st.undertow).toFixed(2) : 0,
        undertowSecs: st.undertowT != null ? +(+st.undertowT).toFixed(2) : 0,
        // the refuge invariant, as a NUMBER: tall frames the wave may wound
        // but may never take down, because they are the answer to the event
        refugesStanding: refuges.standing, refugesTotal: refuges.total,
        lightSwept: refuges.swept,
      };
    },
    // the name of the disaster that JUST finished, while its short "it's
    // over" beat is still live (the HUD status line reads this in the gap)
    justEnded() { return dir.overT > 0 ? dir.overName : null; },
    // the ACTUAL location(s) of the live hazard for the minimap: circles
    // ({x,z,r[,fill:false]}) and travelling fronts ({line:true,x,z,dx,dz}).
    // Empty when the danger is everywhere (hurricane/blizzard) or when the
    // def's telegraphs haven't materialised yet. No zones — the map marks
    // the disaster itself, where it really is.
    hazards() {
      const A = CBZ.surv && CBZ.surv.arena;
      if (!A || !dir.cur) return [];
      const id = dir.curId, st = dir.st, out = [];
      const warn = dir.state === "warn";
      if (id === "tornado") {
        if (!warn && st.x != null) out.push({ x: st.x, z: st.z, r: st.r ? Math.max(10, st.r * 1.4) : 18 });
      } else if (id === "volcano") {
        const h = st.erS || A.hills[0]; out.push({ x: h.x, z: h.z, r: 15 });
        pushEruptHazards(st, out);
      } else if (id === "quake") {
        if (st.erupting) { const h = st.erS || A.hills[0]; out.push({ x: h.x, z: h.z, r: 15 }); pushEruptHazards(st, out); }
      } else if (id === "storm") {
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: 5 }));
      } else if (id === "meteor") {
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: p.r || 6 }));
      } else if (id === "sinkhole") {
        (st.holes || []).forEach((h2) => out.push({ x: h2.x, z: h2.z, r: h2.r || 4 }));
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: p.r || 4 }));
      } else if (id === "wildfire") {
        if (CBZ.wildfire) CBZ.wildfire.hazards(24).forEach((h2) => out.push(h2));
      } else if (id === "nuke") {
        if (st.gx != null) out.push(!st.r ? { x: st.gx, z: st.gz, r: 9 } : { x: st.gx, z: st.gz, r: st.r, fill: false });
      } else if (id === "flashflood") {
        // the routed front is not a line: it is wherever the water is
        // arriving right now, down each channel it found (flashflood.js)
        if (!warn && CBZ.flashflood) {
          const fp = CBZ.flashflood.frontPoints(8);
          for (let i = 0; i < fp.length; i++) out.push({ x: fp[i].x, z: fp[i].z, r: 6 });
        }
        // ...and the low ground that is already under stays ringed
        if (!warn) for (let i = 0; i < A.hills.length; i++) {
          const h = A.hills[i];
          if (h.peak < (st.peak || 0) + 1) out.push({ x: h.x, z: h.z, r: h.r, fill: false });
        }
      } else if (id === "flood") {
        if (st.phase === "sweep" && st.dx != null) out.push({ line: true, x: A.center.x + st.dx * st.frontS, z: A.center.z + st.dz * st.frontS, dx: st.dx, dz: st.dz });   // tsunami V2 wall
        else if (!warn && st.wave && !st.passed && st.waveX != null) out.push({ line: true, x: st.waveX, z: A.center.z, dx: 1, dz: 0 });   // legacy wall
      }
      return out;
    },
    /* ============================================================
       CBZ.disasterAudit() — THE RATCHET FOR THIS WAVE.

       Every field is measured from LIVE STATE, not counted in the source, so
       a "fix" that leaves the code in and merely stops calling it still fails.
       Expected, with every flag at its default:

         banners / hints / toasts   0   — lines the game actually spoke
         privateRain                0   — CBZ.fx particle clouds standing in
                                          for systems/weather.js
         privateSwim                0   — hand-rolled player-in-water solves
         privateWater               0   — water meshes this file owns
         privateCollapse            0   — binary collapses bypassing the ledger
         legacyFalls                0   — buildings that came down on this
                                          file's own sink-into-the-ground
                                          ticker instead of on the shared
                                          collapse engine (city/collapse.js)
         surgeDriven                true — the sea moved via waterSurgeSet
         weatherDriven              true while a weather disaster is live
         swimShared                 true — city/swim.js answers on the island

       `structureHits`, `detonateAdopted` and `surgeWrites` are printed beside
       the zeros so a build that passes by simply never running a disaster
       cannot be mistaken for a build that migrated one.
       ============================================================ */
    audit() { return CBZ.disasterAudit(); },
    // jump straight to a named disaster's warning (debug / verification aid)
    // opts.mag (QA): the size the next occurrence is built at, instead of the
    // seeded roll (the tornado reads it; tools/disaster-check.mjs --mag)
    force(id, opts) {
      let i = order.indexOf(id, dir.pos);   // this run's shuffled arc, from here on
      if (i < 0) i = order.indexOf(id);
      if (i < 0) {
        // struck by a chain (or never in the arc): slot it in at the cursor
        if (!DEFS[id]) return false;
        i = Math.min(dir.pos, order.length);
        order.splice(i, 0, id);
      }
      dir.forceMag = opts && opts.mag != null ? +opts.mag : null;
      /* A WARNING HAS MESHES TOO. Ending only an ACTIVE def left every warn-
         phase artefact of the interrupted one in the world — the volcano's
         crater glow disc, its telegraph lane — because warn() built them and
         only end() removes them. Every def's end() already tolerates a run
         that never reached start() (endEruption returns on !erupting). */
      if (dir.cur && dir.cur.end && (dir.state === "active" || dir.state === "warn")) { try { dir.cur.end(makeCtx(0)); } catch (e) {} }
      dir.pos = i; dir.state = "idle"; dir.t = 0.01; dir.cur = null; dir.curId = null;
      dir.calm = false; dir.chain = null; dir.link = null; dir.nextId = null;
      return true;
    },
  };

  CBZ.disasterAudit = function () {
    const A = CBZ.surv && CBZ.surv.arena;
    const st = dir.st || {};
    // PRIVATE WATER: any mesh in the arena claiming to be a water surface that
    // is not the arena's own ocean. The tsunami's inundation sheet was one;
    // the flash flood's pool and wall were two more. All three are deleted, so
    // this is a live scan and not a promise.
    let privateWater = 0;
    if (A && A.root) {
      A.root.traverse(function (o) {
        if (o.userData && o.userData.waterSurface && o !== A.ocean) privateWater++;
      });
    }
    // PRIVATE RAIN: the four disasters that used to each own a rain/snow cloud
    // now own none. `st.rain` / `st.snow` are the exact fields they used.
    const privateRain = (st.rain ? 1 : 0) + (st.snow ? 1 : 0);
    // ONE read of the debris field, so every number below is from the same
    // instant rather than from two calls that could straddle a strike
    // (guarded: the legacy hurricane parks a particleCloud in st.debris,
    // which has no stats() — auditing mid-hurricane used to throw)
    const dbgT = st.debris && typeof st.debris.stats === "function" ? st.debris.stats() : null;
    // PRIVATE SWIM: the deleted player solve set these two on CBZ.player.
    const privateSwim = (CBZ.player && CBZ.player._tsuSwim ? 1 : 0);
    // the sinkhole's own ratchet, exported by world/groundshaft.js
    const shaftA = CBZ.shaftAudit ? CBZ.shaftAudit() : null;
    // the volcano's own ratchet, exported by world/volcanofx.js
    const volA = CBZ.volcanoAudit ? CBZ.volcanoAudit() : null;
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
    // the storm's own ratchet, exported by systems/lightningfx.js
    const boltA = CBZ.lightningFxAudit ? CBZ.lightningFxAudit() : null;
    return {
      // ---- SHOW DON'T TELL: lines this run actually spoke ----
      banners: said.banners, hints: said.hints, toasts: said.toasts,
      showDontTell: CBZ.CONFIG.SURV_SHOW_DONT_TELL !== false,
      // ---- ONE WEATHER ----
      privateRain: privateRain,
      weatherDriven: !!(CBZ.weather && CBZ.weather.driven),
      weatherShared: CBZ.CONFIG.SURV_SHARED_WEATHER !== false && !!CBZ.weatherDrive,
      windSpeed: CBZ.weather ? +(CBZ.weather.wind || 0).toFixed(2) : 0,
      // ---- ONE WATER ----
      privateWater: privateWater,
      surgeDriven: surgeWrites > 0,
      surgeWrites: surgeWrites,
      surge: CBZ.waterSurge ? +CBZ.waterSurge().toFixed(3) : 0,
      // ---- THE FLASH FLOOD (systems/flashflood.js) ----
      // live evidence the flood was routed, not scripted: its depth and front
      // speed, cars swept, bridges failed, lids blown, the field installed.
      flashflood: CBZ.flashflood ? CBZ.flashflood.audit() : null,
      // ---- ONE SWIM ----
      privateSwim: privateSwim,
      /* ---- THE STORM'S BOLTS. `boltStrokes / boltStrikes` is the whole
         before/after in one ratio: the old strike drew ONE flat frame per
         strike, so a build still on the fireball reports exactly 1.0 (or 0
         strokes, if it never had a renderer at all). A real flash is 3-5. ---- */
      boltFxV2: !!(boltA && boltA.on && boltA.wired),
      /* WHERE THE NEXT BOLTS ARE GOING, and how long is left on each. Published
         because the telegraph stopped being a mesh: tools/visual-presets/
         lightning-strike.mjs used to find the ground marker by fingerprinting
         its geometry, and a leader in the sky is not a thing you can pick out
         of a scene graph by radius and colour. `dir.curId` gates it because the
         meteor def keeps its own `st.pending` of a different shape. */
      stormPending: dir.curId === "storm" && st.pending
        ? st.pending.map(function (p) { return { x: +(+p.x).toFixed(2), z: +(+p.z).toFixed(2), t: +(+p.t).toFixed(3) }; })
        : null,
      /* HOW THE CURRENT GOT THERE. The old strike had exactly one mechanism —
         the bolt landed on you — which is the RAREST one in the real
         epidemiology (3-5%). These count the other four: boltSideFlash is the
         jump off a struck tree or wall, boltChained is the jump onward from one
         body to the next, and boltWorst is the most people a single strike has
         killed this run, which is >1 the moment the model is working. */
      boltAttach: Object.assign({}, boltLedger.byKind),
      boltLast: boltLedger.last,
      boltSideFlash: boltLedger.sideFlashes,
      boltChained: boltLedger.chained,
      boltKills: boltLedger.kills,
      boltWorst: boltLedger.worstStrike,
      boltStrikes: boltA ? boltA.strikes : 0,
      boltStrokes: boltA ? boltA.strokes : 0,
      boltScars: boltA ? boltA.scarsCut : 0,
      boltLive: boltA ? boltA.live : 0,
      /* ---- THE METEOR'S RADIANT AND ITS LATE SOUND (systems/meteor.js).
         `meteor` is that file's whole ratchet (airbursts, craters dug,
         ejecta, flash-to-bang seconds, the live bolide/burst positions the
         storyboard cameras solve off). ---- */
      meteorV2: !!CBZ.meteor,
      meteor: CBZ.meteorAudit ? CBZ.meteorAudit() : null,
      /* ---- THE WILDFIRE — delegated to systems/wildfire.js, whose audit is
         live-measured off the same tree records the legacy path mutates, so
         `wildfire.v2:false` (the revert) still reports honest burn counts and
         zeros for the mechanisms only the module has (spotting, smoke
         deaths, the persistent scar). */
      wildfire: CBZ.wildfireAudit ? CBZ.wildfireAudit() : null,
      /* ---- THE TSUNAMI'S FOUR: what the water was carrying, what it hit
         with, how dirty it was and how hard it pulled on the way out. Zero
         unless a tsunami is actually running, which is the point.

         THE `tsu` PREFIX IS LOad-BEARING, and it was earned: the first version
         of these called themselves `debrisEntrained`/`debrisKills`, and a
         sibling disaster in this same object literal already publishes a
         `debrisKills` of its own further down. Later key wins in a JS object,
         so the tsunami's number was silently replaced by the earthquake's and
         the audit reported 0 debris kills on a run that had just made one.
         One shared audit means one shared namespace. */
      /* ---- THE HURRICANE'S STRUCTURE (systems/hurricane.js). Nested under
         one `hur` key — the tsunami's namespace lesson above, applied in
         advance. Live-state answers: eyePassedCam only fires if the camera
         saw real wind BEFORE the calm, windReversed is two sampled bearings
         at the island center dotted across the eye's passage, surgePeak is
         the biggest number this def actually fed the sea. ---- */
      hur: CBZ.hurricaneAudit ? CBZ.hurricaneAudit() : null,
      tsuDebrisEntrained: dbgT ? dbgT.entrained : 0,
      tsuDebrisStrikes: dbgT ? dbgT.strikes : 0,
      tsuDebrisKills: dbgT ? dbgT.kills : 0,
      tsuUndertowPull: st.undertow != null ? +(+st.undertow).toFixed(2) : 0,
      tsuSediment: st.sediment != null ? +(+st.sediment).toFixed(3) : 0,
      tsuKitShared: !!(CBZ.tsuFaceBuild && CBZ.tsuDebrisField),
      swimShared: !!(CBZ.CONFIG.SURV_SHARED_SWIM !== false && CBZ.citySwimState && CBZ.survSeaHeightAt),
      swimming: !!(sw && sw.swimming),
      breath: sw && sw.breath != null ? sw.breath : null,
      /* ---- THE BLIZZARD (systems/blizzard.js's own ratchet, re-exported
         whole so one audit call answers for the roster: the windchill clock,
         who is holding on in a lee vs freezing in the open, the drift field's
         live height and the bodies the storm has buried). null on a build
         without the module — "not measured", never "no storm". */
      blizzard: CBZ.blizzardAudit ? CBZ.blizzardAudit() : null,
      // ---- ONE STRUCTURE + ONE BLAST BUS ----
      privateCollapse: structPrivate,
      // ---- ONE COLLAPSE (city/collapse.js) ----
      legacyFalls: legacyFalls,
      engineFalls: engineFalls,
      collapseShared: !!(CBZ.collapse && CBZ.collapse.play && CBZ.CONFIG.COLLAPSE_V2 !== false),
      structureHits: structHits,
      detonateAdopted: detonateAdopted,
      blastLegacy: blastLegacy,
      structureShared: CBZ.CONFIG.SURV_SHARED_STRUCTURE !== false && !!CBZ.detonate,
      // ---- the sinkhole actually has a bottom ----
      openHoles: CBZ.survHoles ? CBZ.survHoles.length : 0,
      holeDepth: CBZ.survHoles && CBZ.survHoles.length ? +CBZ.survHoles[0].depth.toFixed(1) : 0,
      /* THE SHAFT IS SHARED NOW — world/groundshaft.js owns it and the numbers
         that matter are ITS invariants, re-exported here so one audit call
         still answers for the whole roster. holesOnSlopes is the owner's law
         ("sinkholes should only happen on the ground not on sides of mountain")
         measured on live shafts, and it may only ever read 0. deepOverWide is
         the reference photograph as arithmetic: a shaft, not a crater. */
      /* ---- THE STRATOVOLCANO ----
         `lavaOpaque` is the owner's complaint as a boolean, and it is measured
         off the LIVE materials by world/volcanofx.js (volcanoAudit walks every
         live lava mesh and counts transparent/additive ones). `nukeUsedNukefx` is asked of city/nukefx.js's own live
         state, so "the finale drew the real mushroom" is a measurement and not
         a claim about which function got called. */
      volcanoV2: !!CBZ.volcanoFx,
      lavaOpaque: volA ? !!volA.lavaOpaque : true,
      lavaTransparent: volA ? volA.lavaTransparent : 0,
      lavaFlows: volA ? volA.lavaFlows : 0,
      pyroRuns: pyroRuns + (st.er ? st.er.stats.pdcRuns : 0),
      pyroLive: volA ? volA.pyroLive : 0,
      laharRuns: laharRuns + (st.er ? st.er.stats.laharRuns : 0),
      /* THE OWNER'S SECOND COMPLAINT AS TWO NUMBERS. `volcanoDeaths` is the
         drop in the live roster across every eruption this run finished, and
         it is the one to watch: an eruption that empties a 100-player island
         is not a disaster, it is a reset. `volcanoBombs` is how many rocks the
         mountain actually threw — the thing that used to run at one a second
         from a uniform draw over the whole map. */
      volcanoDeaths: volcanoDeaths,
      volcanoBombs: bombsThrown + (st.er && st.er.bombStats ? st.er.bombStats.thrown : 0),
      /* the sequence, as the eruption itself counted it (live, else the last one) */
      eruption: (function () {
        const E = st.er || st.lastEr;
        if (!E) return null;
        const s2 = E.stats;
        return { phase: E.phase, mag: s2.mag, lithics: s2.lithics, bombs: s2.bombs, lightning: s2.lightningIC + s2.lightningCG,
          collapses: s2.columnCollapses, umbrellaR: s2.umbrellaR, surgeR: s2.surgeR, treesLit: s2.treesLit,
          housesLit: s2.buildingsLit, housesInLava: s2.buildingsInLava, carsEngulfed: s2.carsEngulfed, roofsFailed: s2.roofsFailed,
          site: E.site.src };
      })(),
      ashRoofCollapses: ashRoofCollapses,
      // the two numbers that say WHY a roof did or did not go: how many roofs
      // are actually carrying a load, and the heaviest load any of them has
      ashRoofs: st.er ? st.er.roofs.length : 0,
      ashRoofMax: st.er ? +st.er.roofAshMax().toFixed(3) : 0,
      ashCarMax: st.er ? +st.er.carAshMax().toFixed(3) : 0,
      ashPeakDepth: volA ? volA.ashPeakDepth : 0,
      volcanoLights: volA ? volA.lights : 0,
      nukeUsedNukefx: nukeFxRuns > 0,
      nukeFxRuns: nukeFxRuns,
      nukeWhiteouts: whiteouts,
      cameraFar: CBZ.camera ? Math.round(CBZ.camera.far) : 0,
      shaftShared: !!CBZ.groundShaft,
      holesOnSlopes: shaftA ? shaftA.holesOnSlopes : 0,
      holeSlopeMax: shaftA ? shaftA.holeSlopeMax : 0,
      holeDeepOverWide: shaftA ? shaftA.deepOverWide : 0,
      cityShaftReady: shaftA ? shaftA.cityShaftReady : false,
      shaftFalls: shaftA ? shaftA.falls : 0,
      shaftCrushed: shaftA ? shaftA.crushed : 0,
      shaftBuried: shaftA ? shaftA.buried : 0,
      shaftVoidSaves: shaftA ? shaftA.voidSaves : 0,
      /* ---- THE QUAKE KILLS WITH DEBRIS, NOT WITH THE SHAKE ----
         Read straight off the shared core (systems/quake.js), so a build that
         merely shakes the camera reads debrisSpawned 0 and cannot pass as this
         feature. `chained` counts the handoffs this run actually made — the
         earthquake→tsunami force() and the earthquake→eruption call — which is
         the evidence that the big three are connected and not three unrelated
         rows in a roster. `quakeShared` false means the core never loaded and
         the def fell back to the pre-2026-08-03 quake (which still plays). */
      debrisSpawned: qkNum("debrisSpawned"),
      debrisKills: qkNum("debrisKills"),
      debrisHits: qkNum("debrisHits"),
      coverAnchors: qkNum("coverAnchors"),
      coverSaves: qkNum("coverSaves"),
      ducked: qkNum("ducked"),
      gasFires: qkGasFires,
      gasFiresShared: qkNum("gasFiresShared"),
      linesDown: qkLines,
      lineKills: qkNum("lineKills"),
      chained: qkChained,
      quakeShared: !!CBZ.quake,
      quakeChain: CBZ.CONFIG.QUAKE_CHAIN !== false,
      // this occurrence's rolled size — 0 when no quake is current (and on a
      // build whose every quake was the same quake, which is the point)
      quakeMag: (dir.curId === "quake" && qkQ && qkQ.M) ? +qkQ.M.toFixed(1) : 0,
      quakeActiveSecs: (dir.curId === "quake" && dir.cur) ? dir.cur.activeSecs : 0,
      // ---- context so a no-op run cannot pass as a migrated one ----
      mode: CBZ.game.mode, state: dir.state, current: dir.curId, phase: st.phase || null,
    };
  };

  /* LEAVING THE MODE HAS TO PUT THE WORLD BACK. Three of this wave's systems
     are GLOBAL by design — the sea level, the weather and the floor override
     — which is the whole point of them being engine pillars, and it is also
     exactly how a quit-to-menu mid-tsunami could leave the main city under
     four metres of water in a rainstorm. Cheap, unconditional, and it runs
     even on the frame the mode changes. */
  let wasSurvival = false;
  CBZ.onAlways(28.05, function () {
    const isSurv = CBZ.game.mode === "survival";
    if (isSurv === wasSurvival) return;
    wasSurvival = isSurv;
    if (!isSurv) {
      surgeSet(0);
      weatherOff();
      if (CBZ.survHoles) CBZ.survHoles.length = 0;
      if (CBZ.waterEventClear) { CBZ.waterEventClear("survival-tsunami"); CBZ.waterEventClear("survival-flood"); }
      if (CBZ.tsuRunup) CBZ.tsuRunup.detach();
    }
  });

  CBZ.onUpdate(28, function (dt) {
    if (CBZ.game.mode !== "survival" || !CBZ.surv.arena) return;

    // reset the lighting baseline; the active disaster re-tints below
    const e = CBZ.survEnv;
    Object.assign(e, CBZ.SURV_CLEAR_SKY || { fog: 0xbfe0ff, fogNear: 80, fogFar: 380, sunInt: 1.08, sunColor: 0xfff4e0, hemiInt: 0.98, hemiColor: 0xeaf4ff });

    // crumble animation for collapsed buildings (runs across states): the
    // whole group (walls + every floor + roof) sinks into the ground and
    // tilts as it goes, then is hidden once it's fully buried.
    for (let i = fallingBuildings.length - 1; i >= 0; i--) {
      const f = fallingBuildings[i]; f.t += dt;
      f.group.position.y -= f.h * dt * 0.6;
      f.group.rotation.z += f.tilt * dt;
      f.group.rotation.x += (f.tilt * 0.4) * dt;
      if (f.t > 1.8) { f.group.visible = false; fallingBuildings.splice(i, 1); }
    }

    // tossed cars: arc + tumble under gravity, then settle on their side as wreckage
    for (let i = flungCars.length - 1; i >= 0; i--) {
      const f = flungCars[i]; if (f.settled) continue;
      f.vy -= 22 * dt;
      f.g.position.x += f.vx * dt; f.g.position.y += f.vy * dt; f.g.position.z += f.vz * dt;
      f.g.rotation.x += f.sx * dt; f.g.rotation.z += f.sz * dt;
      const fl = CBZ.surv.arena.groundHeightAt(f.g.position.x, f.g.position.z);
      if (f.g.position.y <= fl + 0.4 && f.vy <= 0) {
        f.g.position.y = fl + 0.4; f.settled = true;
        f.g.rotation.x = (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.8);   // come to rest crumpled
        f.g.rotation.z = (rnd() - 0.5) * 1.2;
        if (CBZ.shake && near(f.g.position, 20)) CBZ.shake(0.18);
      }
    }

    const ctx = makeCtx(dt);
    tsuSeaCalmStep(dt);
    if (dir.state === "active" && dir.cur) dir.prog = 1 - dir.t / dir.cur.activeSecs;
    curCtx = ctx; // refresh for bot fleeVector (1-frame latency is fine)
    dir.clock += dt;

    if (dir.state === "idle" && dir.calm) {
      // THE CALM: nothing happens; the lingering effects finish fading
      if (dir.overT > 0) { dir.overT -= dt; if (dir.overT <= 0) dir.overName = null; }
      dir.calmT -= dt;
      dir.t = Math.max(0, dir.calmT) + BRIEF;
      if (dir.calmT <= 0) {
        const busy = busyList();
        dir.quietWait += dt;
        /* WATER IS NEVER CUT (2026-10-20, owner: "the way tsunamis and flash
           floods disappear is unrealistic"). A drowned town still draining
           holds the calm open instead of being switched off: past QUIET_CAP
           the ground is only asked to take it faster (still a falling level,
           never a snap), and the next card waits until it is mostly gone. */
        const wet = busy.filter(function (b) { return b === "backwash" || b === "flood"; });
        const dryBusy = busy.filter(function (b) { return b !== "backwash" && b !== "flood"; });
        if (wet.length && dir.quietWait > QUIET_CAP) hurryWater(Math.min(1, (dir.quietWait - QUIET_CAP) / 30));
        const waterOver = !wet.length || dir.quietWait > QUIET_CAP + WATER_CAP;
        // the dry stragglers (a fire, the ash) are still cut on the old cap
        if (!waterOver && dir.quietWait > QUIET_CAP && dryBusy.length) forceQuiet(dryBusy);
        if (!busy.length || (dir.quietWait > QUIET_CAP && waterOver)) {
          if (busy.length) forceQuiet(busy);
          const L = dir.cur_log;
          if (L) { L.quietAt = r1(dir.clock); if (busy.length) L.cut = busy; }
          dir.calm = false; dir.calmT = 0; dir.t = BRIEF;
        }
      }
    }
    else if (dir.state === "idle") {
      dir.t -= dt;
      // let the "IT'S OVER" all-clear breathe for a few seconds, then go quiet
      if (dir.overT > 0) { dir.overT -= dt; if (dir.overT <= 0) dir.overName = null; }
      // THE BRIEF: name the next one while there is still time to act on it
      if (!dir.nextId && dir.t <= BRIEF) {
        dir.nextId = peekNext();
        if (CBZ.shake) CBZ.shake(0.08);
        // disaster_siren.m4a: the island's warning horn
        if (CBZ.sfx) { try { CBZ.sfx("siren"); } catch (e) {} }
      }
      if (dir.t <= 0) beginWarn();
    }
    else if (dir.state === "warn") { dir.t -= dt; warnAmbience(); if (dir.cur.warnTick) try { dir.cur.warnTick(dt, ctx); } catch (e2) {} if (dir.t <= 0) beginActive(ctx); }
    else if (dir.state === "active") {
      dir.t -= dt;
      try { dir.cur.active(dt, ctx); } catch (e3) { console.error("[disaster active]", e3); }
      // a def may close its own round early (a cause handing off to its effect)
      if (dir.st && dir.st.endIn != null) { dir.t = Math.min(dir.t, dir.st.endIn); dir.st.endIn = null; }
      if (dir.t <= 0) endActive(ctx);
    }
  });
})();
