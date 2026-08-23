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
   CBZ.CONFIG.SURV_TSUNAMI_V2 (the rebuilt tsunami event arc, default on;
   false restores the legacy wall — see TSUNAMI_LEGACY below) ·
   SURV_SHOW_DONT_TELL · SURV_SHARED_WATER · SURV_SHARED_WEATHER ·
   SURV_SHARED_STRUCTURE (each a one-line revert to the old fork).

   THE STRATOVOLCANO (2026-08-03). The eruption is no longer one hazard with
   a see-through orange box on it. world/volcanofx.js owns four builders —
   opaque crusted lava, the pyroclastic density current, the lahar and the
   ash LOAD — all keyed on a position + a height field so a city-side
   eruption calls the same code. Its flags (VOLCANO_V2 · VOLCANO_PYRO ·
   VOLCANO_LAHAR · VOLCANO_ASH_LOAD) are declared THERE, in the owning file;
   VOLCANO_V2=false (or the older SURV_VOLCANO_LAVA_V2=false) drops this file
   back to the legacy additive streams, which are kept verbatim as the revert
   path and counted by disasterAudit().lavaLegacy.

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
  // visible lava pools + downwind ash choke on the eruption (false = legacy streams/bombs only)
  if (CBZ.CONFIG.SURV_VOLCANO_LAVA_V2 == null) CBZ.CONFIG.SURV_VOLCANO_LAVA_V2 = true;

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
      const depth = surface - floor(a.pos.x, a.pos.z);
      if (depth <= 1.35) { a._survSwim = 0; continue; }
      if (!a._survSwim) { a._survSwim = 1; a._survPh = rnd() * 6.28; a._survLX = a.pos.x; a._survLZ = a.pos.z; }
      // paddle: halve the brain's step, ride the current
      a.pos.x = a._survLX + (a.pos.x - a._survLX) * 0.55 + wx * current * dt;
      a.pos.z = a._survLZ + (a.pos.z - a._survLZ) * 0.55 + wz * current * dt;
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
        b.group.position.x += wx * current * 0.55 * dt;
        b.group.position.z += wz * current * 0.55 * dt;
      }
    }
  }

  function disc(x, z, color, opacity, y) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, floor(x, z) + (y || 0.07), z);
    m.renderOrder = 4; root().add(m); return m;
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
      for (let i = 0; i < 7; i++) CBZ.fx.dropDebris({
        x: b.x + (rnd() - 0.5) * b.w, z: b.z + (rnd() - 0.5) * b.d,
        fromY: b.h * (0.4 + rnd() * 0.6), vy: -1 - rnd() * 2,
        size: 0.5 + rnd() * 1.1, color: 0x8b9097, dmg: scale(14, ctx || { intensity: 0.4 }), keep: true,
      });
      if (CBZ.shake && near({ x: b.x, z: b.z }, 45)) CBZ.shake(0.22);
    }
    if (now >= 1) collapse(b, ctx);
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
  function rattleProps(ctx, amp) {
    if (amp <= 0.001) return;
    const A = ctx.arena, t = CBZ.now * 0.03;
    const cars = A.cars;
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
    const busRoutes = !o.draw || !!(CBZ.CONFIG.IMPACT_BUS !== false &&
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
      name: "LIGHTNING STORM", emoji: "", warnSecs: 4, activeSecs: 16, gap: 6, cause: "struck by lightning", tint: 0x3a4150,
      // THE STORM ROLLS IN. No line of text: the sky darkens, the rain thickens
      // from nothing and the wind gets up, all through the ONE weather system —
      // so wet asphalt, wet grip and the lightning flash come along for free.
      warn(ctx) {
        narrate("hint", "Storm rolling in, keep moving!", 2.4); sound("thunder");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        weather({ rain: 0.15 + k * 0.55, wind: 3 + k * 6, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.4, fogColor: 0x3a4150 });
        ctx.env.sunInt *= 1 - 0.35 * k;
        if (rnd() < dt * (0.3 + k)) sound("thunder");
      },
      start(ctx) {
        ctx.st.pending = []; ctx.st.bolts = []; ctx.st.cd = 0.6;
      },
      active(dt, ctx) {
        ctx.env.fog = 0x3a4150; ctx.env.fogNear = 30; ctx.env.fogFar = 200; ctx.env.sunInt = 0.4; ctx.env.hemiInt = 0.5; ctx.env.hemiColor = 0x8794ad;
        weather({ rain: 0.92, wind: 9, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.5, fogColor: 0x3a4150, lightning: 1 });
        // schedule strikes (bias toward where actors are)
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = (0.9 - 0.5 * ctx.prog) * (0.6 + rnd());
          let tx, tz; const acts = surv().actors();
          if (acts.length && rnd() < 0.7) { const a = acts[(rnd() * acts.length) | 0]; tx = a.pos.x + (rnd() - 0.5) * 10; tz = a.pos.z + (rnd() - 0.5) * 10; }
          else { const p = ctx.arena.randomPoint(0, ctx.R); tx = p.x; tz = p.z; }
          // WHAT IT WILL ACTUALLY HIT — resolved now, not at the moment of the
          // strike, so the leader spends its whole descent pointing at the real
          // termination and the bolt lands where the warning said it would.
          // Skipped entirely on the revert path, which aims at bare coordinates.
          const at = (CBZ.CONFIG.LIGHTNING_FX_V2 !== false) ? attachPoint(tx, tz, ctx) : null;
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
             not change by a line. Falls back to the disc if the renderer is
             absent or LIGHTNING_FX_V2 is off. */
          const tele = (CBZ.CONFIG.LIGHTNING_FX_V2 !== false && CBZ.lightningLeader)
            ? CBZ.lightningLeader(tx, tz)
            : CBZ.fx.groundMarker(tx, tz, 4.5, 0x9fd0ff);
          ctx.st.pending.push({ x: tx, z: tz, t: 0.95, m: tele, at: at });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 0.95);
          if (p.t <= 0) { strike(p.x, p.z, ctx, p.at); p.m.dispose(); ctx.st.pending.splice(i, 1); }
        }
        for (let i = ctx.st.bolts.length - 1; i >= 0; i--) { const b = ctx.st.bolts[i]; b.life -= dt; b.mesh.material.opacity = Math.max(0, b.life / 0.16); if (b.life <= 0) { rmMesh(b.mesh); ctx.st.bolts.splice(i, 1); } }
      },
      // `st.bolts` only ever fills on the LIGHTNING_FX_V2=false path; the live
      // renderer pools its own meshes and hands them back through its reset.
      end(ctx) { weatherOff(); (ctx.st.pending || []).forEach((p) => p.m.dispose()); (ctx.st.bolts || []).forEach((b) => rmMesh(b.mesh)); if (CBZ.lightningFxReset) CBZ.lightningFxReset(); },
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

    // ---- TSUNAMI: assigned right after this roster (DEFS.flood, below).
    //      CBZ.CONFIG.SURV_TSUNAMI_V2 (default true) picks the rebuilt
    //      real-event arc; false restores the legacy layered-plane wall. ----

    /* ---- FLASH FLOOD, REBUILT AS RAIN-FED (2026-08-03) -----------------------
       OWNER: "rain makes flash flood which is gang city water slowly filling
       the ground." The old arc was a storm TIDE — it raised the sea and let the
       coast drown, which is a regional flood, not a flash flood. A flash flood
       is what the RAIN does: it falls faster than the ground can take it, it
       collects in the low channel, and it arrives there as a front with almost
       no warning.

       So the water now comes from two places at once and both are engine levers
       this file does not own:
         · CBZ.weatherDrive({rain, pool}) — the rain that is falling IS the rain
           filling the streets. `pool` is metres of standing water; the level is
           integrated by systems/weather.js and answered by city/waterfield.js's
           mask, which is why swimming, the 28 s breath meter, drowning through
           the killfeed, buoyancy, floating corpses and the gore medium all
           arrive here with no code written for any of them.
         · CBZ.waterSurgeSet — the sea, still, because a coastal island in a
           storm genuinely gets both.
       And a FRONT (CBZ.groundWaterFrontSet) races down the channel: dry ground
       twenty metres ahead of a wall of water, which is the thing that actually
       kills people in the real event. It is a term in the depth field, never a
       mesh — CBZ.groundWaterAudit().privateWaterPlanes stays 0.

       THE KILL MODES ARE PHYSICS, and they are priced in systems/weather.js so
       the gang city gets every one of them too: six inches of moving water
       knocks you flat, two feet floats a car, immersion runs a hypothermia
       clock, and a submerged street light electrifies the water it stands in.
       This def only sets the stage those read. -------------------------------- */
    flashflood: {
      name: "FLASH FLOOD", emoji: "", warnSecs: 5, activeSecs: 18, gap: 6, cause: "swept away by the flash flood", tint: 0x59636b,
      // THE RAIN ARRIVES FIRST. That is the whole warning and it is honest:
      // the sky opens, the light goes, and the gutters start to stand before
      // anything else happens. A player who reads it is already walking uphill.
      warn(ctx) {
        narrate("hint", "FLASH FLOOD, water rising, get HIGH!", 3); sound("water");
        // THE CHANNEL, not a random bearing: water runs the way the ground
        // falls. Sample a ring and take the LOWEST — that is where the front
        // will run and where the water will stand deepest when it stops.
        let lo = 1e9, la = 0;
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const h = floor(ctx.cx + Math.cos(a) * ctx.R * 0.8, ctx.cz + Math.sin(a) * ctx.R * 0.8);
          if (h < lo) { lo = h; la = a; }
        }
        ctx.st.wx = Math.cos(la); ctx.st.wz = Math.sin(la);
        // deliberately UNDER the smallest hill's peak (7) and every building
        // floor slab: the flood takes the streets, never the refuges
        ctx.st.peak = Math.min(5.6, 3.5 + scale(2.2, ctx));
        // metres of standing water in the channel at the height of it: well
        // over two feet, so cars float and the low streets genuinely swim
        ctx.st.pool = Math.min(2.4, 1.15 + scale(0.62, ctx));
        // The front STARTS just upstream of the middle, because the water has
        // already taken the low ground it came from — a flash flood does not
        // begin at the map edge, it arrives from the catchment that is already
        // under. At ~10 m/s it sweeps the centre in the first seconds, which is
        // the beat the player has to survive.
        ctx.st.frontS = -40;
        ctx.st.frontV = 9.5 + scale(2.5, ctx);   // m/s — a real flash-flood front
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        // the sky opens AND the streets start to stand. `pool` is the second
        // half of the telegraph and it is the half you can only read by
        // looking DOWN — which is exactly where the danger is about to be.
        weather({ rain: 0.25 + k * 0.72, wind: 4 + k * 5, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: k * 0.5, fogColor: 0x59636b, pool: 0.02 + k * 0.16 });
        if (rnd() < dt * 3 * k) sound("water");
      },
      start(ctx) {
        // NO MESH. The flood is a level and a front, and both are numbers.
        ctx.st.t = 0;
        ctx.st.level0 = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        if (CBZ.shake) CBZ.shake(0.4);
        sound("water");
      },
      active(dt, ctx) {
        ctx.env.fog = 0x59636b; ctx.env.fogNear = 22; ctx.env.fogFar = 150; ctx.env.sunInt = 0.55; ctx.env.hemiColor = 0x97a6b3;
        ctx.st.t += dt;
        // rise (0.42) → stand (0.26) → drain (0.32). Water goes UP fast and
        // out slowly, which is what makes the drain the part that strands you.
        const u = Math.min(1, ctx.st.t / Math.max(1, ctx.activeSecs));
        const peak = ctx.st.peak;
        let s, pk;
        // the rise CONTINUES from what the warning already put on the ground
        // (0.18 m of standing rain) — starting the ramp at zero would drain the
        // streets for a beat at the exact moment the flood arrives
        if (u < 0.42) { const e = ease(u / 0.42); s = peak * e; pk = 0.18 + (ctx.st.pool - 0.18) * e; }
        else if (u < 0.68) { s = peak * (1 - 0.06 * ((u - 0.42) / 0.26)); pk = ctx.st.pool; }
        else { const e = 1 - ease((u - 0.68) / 0.32); s = peak * 0.94 * e; pk = ctx.st.pool * e; }
        // THE STREETS AND THE SEA, moved together through the two sanctioned
        // levers and nothing else.
        weather({ rain: 1, wind: 8, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: 0.55, fogColor: 0x59636b, pool: pk });
        surgeSet(s);
        // THE FRONT crosses the arena in the first seconds and then stands
        // down, leaving the level behind it — a wall, and then a lake.
        if (CBZ.groundWaterFrontSet) {
          ctx.st.frontS += ctx.st.frontV * dt;
          // past the halfway mark the wall has done its work and the event is
          // a lake: dropping the front lets the level stand everywhere
          if (u > 0.55 || ctx.st.frontS > ctx.R + 60) CBZ.groundWaterFrontSet(null);
          else CBZ.groundWaterFrontSet({
            x: ctx.cx, z: ctx.cz, dx: ctx.st.wx, dz: ctx.st.wz,
            s: ctx.st.frontS, width: 15, crest: 0.6, speed: ctx.st.frontV,
          });
        }
        // a real downhill current in the inundation, published on the ONE
        // water-event descriptor so the swimmer and the debris both feel it
        publishSheetFlood(ctx, u < 0.68 ? "flooded" : "drain", s, u < 0.68 ? 1.4 : -1.1);
        floodActors(dt, ctx, u < 0.68 ? 1.4 : -1.1, "drowned in the floodwater");
        // TWO FEET FLOATS A CAR — the same threshold the gang city uses, read
        // off the same depth field, so a car in the channel is picked up and
        // carried instead of sitting in a puddle looking bolted down.
        const gw = CBZ.groundWaterAt;
        if (ctx.arena.cars) for (let i = 0; i < ctx.arena.cars.length; i++) {
          const car = ctx.arena.cars[i];
          if (car.flung) continue;
          const d = Math.max(floodDepth(car.x, car.z), gw ? gw(car.x, car.z) : 0);
          if (d > 0.6) flingCar(car, ctx.st.wx, ctx.st.wz, 3.5 + scale(2.5, ctx), 1.2);
        }
        if (rnd() < dt * 5) sound("water");
      },
      end(ctx) {
        weatherOff(); surgeSet(0);
        if (CBZ.groundWaterFrontSet) CBZ.groundWaterFrontSet(null);
        const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
        if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; }   // the sea settles back down
        if (CBZ.waterEventClear) CBZ.waterEventClear("survival-flood");
      },
      threat(x, z, ctx) {
        const gw = CBZ.groundWaterAt ? CBZ.groundWaterAt(x, z) : 0;
        if (gw > 0.1) return Math.max(0.4, Math.min(1, 0.4 + gw * 0.35));
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
    //      HURRICANE_V2=false (or hurricane.js missing) plays the legacy
    //      windstorm below, verbatim. ----
    hurricane: {
      name: "HURRICANE", emoji: "", warnSecs: 5, gap: 7, cause: "killed by hurricane debris", tint: 0x46505a,
      // an eye + two eyewalls need room to be three different experiences;
      // the legacy windstorm keeps its old 20 s
      get activeSecs() { return this._v2() ? 26 : 20; },
      _v2() { return CBZ.CONFIG.HURRICANE_V2 !== false && !!CBZ.hurricane; },
      warn(ctx) {
        narrate("hint", "HURRICANE inbound, brace and hold on!", 3); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        ctx.st.gustCd = 2; ctx.st.turn = (rnd() - 0.5) * 0.2;
        if (this._v2()) {
          // the TRACK is a rule (it decides who floods and who stands in the
          // wall), so its bearing and offset come from the seeded stream
          ctx.st.h2 = 1;
          CBZ.hurricane.begin({
            cx: ctx.cx, cz: ctx.cz, R: ctx.R, intensity: ctx.intensity,
            duration: this.warnSecs + this.activeSecs,
            bearing: a, offset: (rnd() - 0.5) * ctx.R * 0.35,
          });
          return;
        }
        ctx.st.debris = CBZ.fx.particleCloud({ mode: "swirl", color: 0x7a6f5a, count: 200, radius: ctx.R * 0.7, top: 10, size: 0.3, opacity: 0.6, vMin: 8, vMax: 16 });
        ctx.st.debris.setActive(0.15);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        if (ctx.st.h2) {
          // the OUTER BANDS: the field's own far edge is already over the
          // island, so the first squalls and the first lean are the real
          // storm arriving, not a scripted ramp
          const H = CBZ.hurricane;
          H.tick(dt, camPos().x, camPos().z);
          weather(H.localWeather(camPos().x, camPos().z));
          const w = H.windAt(CBZ.player.pos.x, CBZ.player.pos.z);
          const p = CBZ.player._phys || (CBZ.player._phys = { kx: 0, kz: 0 });
          p.kx = (p.kx || 0) + w.x * w.speed * 0.09 * k * dt;
          p.kz = (p.kz || 0) + w.z * w.speed * 0.09 * k * dt;
          if (CBZ.shake) CBZ.shake(Math.min(0.12, 0.02 + w.speed * 0.004));
          if (rnd() < dt * 2 * k) sound("wind");
          return;
        }
        weather({ rain: k * 0.5, wind: k * 14, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.35, fogColor: 0x46505a });
        ctx.st.debris.setActive(0.15 + k * 0.5);
        ctx.st.debris.update(dt, camPos().x, 3, camPos().z);
        // a real (small) push on the player from second one: the wind is not a
        // state that switches on, it is a force that grows
        const p = CBZ.player._phys || (CBZ.player._phys = { kx: 0, kz: 0 });
        p.kx = (p.kx || 0) + ctx.st.wx * 2.6 * k * dt;
        p.kz = (p.kz || 0) + ctx.st.wz * 2.6 * k * dt;
        if (CBZ.shake) CBZ.shake(0.03 + 0.08 * k);
        if (rnd() < dt * 2 * k) sound("wind");
      },
      warnThreat() { return 0.35; },
      warnSafeDir(x, z, ctx) {
        if (ctx.st.h2) return CBZ.hurricane.safeDir(x, z);
        return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) };
      },
      start(ctx) {
        if (ctx.st.h2) return;                       // the field is already live
        ctx.st.debris.setActive(0.8);
      },
      active(dt, ctx) {
        // h2 set means V2 ran this storm — never fall into the legacy body
        // (its state was never built) even if the module's storm is gone
        if (ctx.st.h2) { if (CBZ.hurricane && CBZ.hurricane.active()) this._v2Active(dt, ctx); return; }
        ctx.env.fog = 0x46505a; ctx.env.fogNear = 16; ctx.env.fogFar = 120; ctx.env.sunInt = 0.5; ctx.env.hemiColor = 0x8a98a6;
        ctx.st.debris.update(dt, camPos().x, 4, camPos().z);
        // the wind slowly veers so its direction can't be simply outrun
        const ang = Math.atan2(ctx.st.wz, ctx.st.wx) + ctx.st.turn * dt;
        ctx.st.wx = Math.cos(ang); ctx.st.wz = Math.sin(ang);
        // ONE WIND FIELD: the hurricane's bearing IS the weather's bearing, so
        // the rain streaks the way the storm blows and the tornado (which
        // already biases off CBZ.weather) inherits it.
        weather({ rain: 0.95, wind: 20 + 8 * ctx.intensity, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.6, fogColor: 0x46505a });
        const w = windVec();
        const wx = w.speed > 0.5 ? w.x : ctx.st.wx, wz = w.speed > 0.5 ? w.z : ctx.st.wz;
        if (rnd() < dt * 2) sound("wind");
        if (CBZ.shake) CBZ.shake(0.12 + 0.18 * ctx.intensity);
        // steady downwind drag on everyone
        const drag = 3.2 + scale(2, ctx);
        surv().forEachActor(function (a) {
          if (CBZ.body && CBZ.body.busy(a)) return;
          if (sheltered(a)) return;                    // indoors breaks the wind
          if (a.isPlayer) { const p = CBZ.player._phys || (CBZ.player._phys = { kx: 0, kz: 0 }); p.kx = (p.kx || 0) + wx * drag * dt; p.kz = (p.kz || 0) + wz * drag * dt; }
          else { a.pos.x += wx * drag * dt; a.pos.z += wz * drag * dt; if (CBZ.collide) CBZ.collide(a.pos, 0.5); a.pos.y = floor(a.pos.x, a.pos.z); }
        });
        // violent gusts: a hard shove + a chance to be knocked flat
        ctx.st.gustCd -= dt;
        if (ctx.st.gustCd <= 0) {
          ctx.st.gustCd = 1.6 + rnd() * 1.8;
          if (CBZ.shake) CBZ.shake(0.45);
          sound("wind");
          surv().forEachActor(function (a) { if (sheltered(a)) return; if (CBZ.body) CBZ.body.hit(a, { dir: { x: wx, z: wz }, force: 9 + scale(4, ctx), knockdown: rnd() < 0.35 ? 1.0 : 0 }); });
          // A gust that can knock a body flat also strips a roof — but only a
          // little per gust. ~10 gusts in a 20 s hurricane, so 0.02-0.04 each
          // takes the town from intact to glass-out and no further; a
          // hurricane that levelled every building would leave nothing for the
          // quake or the wave to do, and the ledger is shared between them.
          structureSweep(ctx.cx, ctx.cz, ctx.R, 0.02 + 0.02 * ctx.intensity, ctx, { kind: "tornado", dirx: wx, dirz: wz });
        }
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
          const u = 1 - rCam / S.eyeR;
          ctx.env.fog = 0x93a7b8; ctx.env.fogNear = 40; ctx.env.fogFar = 220 + 800 * u;
          ctx.env.sunInt = 0.55 + 0.65 * u; ctx.env.hemiColor = 0xc2d3e0; ctx.env.hemiInt = 0.75;
        } else {
          ctx.env.fog = 0x46505a; ctx.env.fogNear = 14;
          ctx.env.fogFar = Math.max(55, 200 - lw.wind * 3.2);
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
          // TWO FEET FLOATS A CAR — same threshold as the flash flood
          if (ctx.arena.cars) for (let i = 0; i < ctx.arena.cars.length; i++) {
            const car = ctx.arena.cars[i];
            if (car.flung) continue;
            if (floodDepth(car.x, car.z) > 0.6) flingCar(car, S.fwdX, S.fwdZ, 3.2 + scale(2.2, ctx), 1.1);
          }
          if (rnd() < dt * 3) sound("water");
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
            a.pos.y = floor(a.pos.x, a.pos.z);
          }
          // FLYING DEBRIS IS THE WOUND: at eyewall speeds loose material is
          // airborne and a strike is a real hit, not ambient chip damage
          if (w.speed > 24 && rnd() < dt * (w.speed - 24) * 0.022) {
            H.count("debrisStrikes", 1);
            if (CBZ.body) CBZ.body.hit(a, { dir: { x: w.x, z: w.z }, force: 6 + w.speed * 0.22, knockdown: rnd() < 0.4 ? 1.0 : 0 });
            const wasDead = !!a.dead;
            // a 2x4 at eyewall speed is a wound, not chip damage — ~14-20 by
            // intensity, so repeated strikes on someone who stays in the open
            // genuinely finish them
            surv().hurt(a, scale(14, ctx), { cause: "killed by hurricane debris", dir: { x: w.x, z: w.z } });
            if (!wasDead && a.dead) H.count("debrisKills", 1);
          }
        });
        // ---- gust turbulence on top of the mean field ----
        ctx.st.gustCd -= dt;
        if (ctx.st.gustCd <= 0) {
          ctx.st.gustCd = 1.4 + rnd() * 1.7;
          H.count("gusts", 1);
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
        // ---- the EYEWALL scours the roofs it is standing over — an annulus
        //      that walks across the town with the storm, so damage maps the
        //      track. Budget: wall-dwell ≈ glass-out + some spall, never a
        //      levelled town (the ledger is shared with the quake and the
        //      wave). Batched to 4 Hz — per-frame ring walks were the single
        //      biggest V2 sim cost and the ledger integrates the same total.
        ctx.st.scourCd = (ctx.st.scourCd || 0) - dt;
        if (ctx.st.scourCd <= 0) {
          ctx.st.scourCd += 0.25;
          structureSweepRing(ctx, S.eyeX, S.eyeZ, S.eyeR, S.rmw * 2.3,
            (0.032 + 0.022 * ctx.intensity) * 0.25);
        }
      },
      end(ctx) {
        weatherOff();
        if (ctx.st.h2) {
          CBZ.hurricane.end();
          surgeSet(0);
          if (CBZ.waterEventClear) CBZ.waterEventClear("survival-flood");
          const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
          if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; }
          return;
        }
        if (ctx.st.debris) ctx.st.debris.dispose();
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

    // ---- WILDFIRE: fire spreads tree to tree, burns on contact ----
    wildfire: {
      name: "WILDFIRE", emoji: "", warnSecs: 5, activeSecs: 18, gap: 6, cause: "burned alive in the wildfire", tint: 0x4a2814,
      // ONE TREE LIGHTS AND ITS SMOKE STANDS UP. That is how you actually learn
      // a wildfire is coming, and it also gives the fire a real ORIGIN you can
      // put your back to instead of a hazard that materialises everywhere.
      warn(ctx) {
        narrate("hint", "Wildfire spreading, don't get cornered!", 2.6); sound("fire");
        const tr = ctx.arena.flammable;
        const seedTree = tr[(rnd() * tr.length) | 0];
        if (seedTree && !seedTree.burnt) { ignite(seedTree); ctx.st.seed = seedTree; }
        // the wind decides which way it runs — and it is the WEATHER's wind
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        weather({ rain: 0, wind: 3 + k * 7, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.3, fogColor: 0x6a4a30 });
        if (ctx.st.seed) { ctx.st.seed.burning = Math.max(ctx.st.seed.burning, 1); flickerTreeFire(ctx.st.seed); }
        ctx.env.sunColor = lerpHex(ctx.env.sunColor, 0xff9a50, 0.4 * k);
        if (rnd() < dt * 1.2) sound("fire");
      },
      warnThreat(x, z, ctx) {
        const s = ctx.st.seed; if (!s) return 0;
        const d = Math.hypot(x - s.x, z - s.z);
        return d < 16 ? 0.7 * (1 - d / 16) : 0;
      },
      warnSafeDir(x, z, ctx) {
        const s = ctx.st.seed; if (!s) return null;
        const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1;
        return { x: dx / d, z: dz / d };
      },
      start(ctx) {
        ctx.st.embers = CBZ.fx.particleCloud({ mode: "rise", color: 0xff7a1a, count: 320, radius: 28, top: 16, size: 0.26, opacity: 0.7, vMin: 5, vMax: 12, drift: 6 });
        ctx.st.embers.setActive(0.9);
        // a heavy rolling smoke pall above the flames
        ctx.st.smoke = CBZ.fx.particleCloud({ mode: "rise", color: 0x2b2521, count: 240, radius: 34, top: 40, size: 0.95, opacity: 0.26, vMin: 3, vMax: 7, drift: 10 });
        ctx.st.smoke.setActive(0.7);
        const tr = ctx.arena.flammable; ctx.st.spreadCd = 0;
        // the fire GROWS out of the tree that was already burning through the
        // warning — it does not teleport four new fires across the island
        const s = ctx.st.seed;
        for (let i = 0; i < tr.length; i++) {
          const t = tr[i]; if (t.burning || t.burnt || !s) continue;
          if (Math.hypot(t.x - s.x, t.z - s.z) < 22 && rnd() < 0.5) ignite(t);
        }
        if (!tr.some((t) => t.burning)) { const t = tr[(rnd() * tr.length) | 0]; if (t && !t.burnt) ignite(t); }
      },
      active(dt, ctx) {
        // smoke-choked, fire-lit sky: dim orange sun, low red-brown haze
        ctx.env.fog = 0x4a2814; ctx.env.fogNear = 16; ctx.env.fogFar = 145; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff7320; ctx.env.hemiColor = 0xff8a3a; ctx.env.hemiInt = 0.62;
        // fire runs DOWNWIND — the same wind everything else in the game reads
        weather({ rain: 0, wind: 9 + 4 * ctx.intensity, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.45, fogColor: 0x4a2814 });
        ctx.st.embers.update(dt, camPos().x, 2, camPos().z);
        if (ctx.st.smoke) ctx.st.smoke.update(dt, camPos().x, 8, camPos().z);
        const tr = ctx.arena.flammable;
        // burn anyone near a burning tree
        for (let i = 0; i < tr.length; i++) {
          const t = tr[i]; if (!t.burning) continue;
          t.burning -= dt;
          flickerTreeFire(t);
          surv().hurtRadius(t.x, t.z, 3.4, scale(20, ctx) * dt);
          if (t.burning <= 0 && !t.burnt) burnOut(t);
        }
        // spread to neighbours
        ctx.st.spreadCd -= dt;
        if (ctx.st.spreadCd <= 0) {
          ctx.st.spreadCd = 0.5;
          const wx = ctx.st.wx || 0, wz = ctx.st.wz || 0;
          for (let i = 0; i < tr.length; i++) {
            const t = tr[i]; if (!t.burning) continue;
            for (let j = 0; j < tr.length; j++) {
              const o = tr[j]; if (o.burning || o.burnt) continue;
              const dx = o.x - t.x, dz = o.z - t.z, d = Math.hypot(dx, dz);
              if (d > 13 || d < 0.01) continue;
              // downwind neighbours catch far more readily than upwind ones,
              // which is what gives the burn a visible DIRECTION to outrun
              const down = (dx * wx + dz * wz) / d;
              if (rnd() < 0.18 + 0.5 * Math.max(0, down)) ignite(o);
            }
          }
        }
        if (rnd() < dt * 3) sound("fire");
      },
      end(ctx) { weatherOff(); if (ctx.st.embers) ctx.st.embers.dispose(); if (ctx.st.smoke) ctx.st.smoke.dispose(); ctx.arena.flammable.forEach((t) => { if (t.fire) removeTreeFire(t); }); },
      threat(x, z, ctx) { let t = 0; const tr = ctx.arena.flammable; for (let i = 0; i < tr.length; i++) if (tr[i].burning) { const d = Math.hypot(x - tr[i].x, z - tr[i].z); if (d < 7) t = Math.max(t, 1 - d / 7); } return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; const tr = ctx.arena.flammable; for (let i = 0; i < tr.length; i++) if (tr[i].burning) { const dx = x - tr[i].x, dz = z - tr[i].z, d = Math.hypot(dx, dz); if (d < 9 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } } return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- TORNADO: DELEGATED to systems/tornado.js (CBZ.tornado) ----------
    //      This slot used to own a second, weaker vortex: six translucent
    //      cylinders, a swirl particle cloud, a random-walk wander and a
    //      suck-and-hurt loop that touched ACTORS ONLY — it could not move a
    //      car, tip a prop or scratch a building, and none of that arithmetic
    //      was shared with anything. CBZ.tornado is now the ONE vortex in the
    //      game (Rankine field, EF scale, roof-first structural damage,
    //      thrown vehicles priced through CBZ.detonate's `kinetic` row), so
    //      this def authors only what is genuinely survival-specific: the
    //      banner copy, the EF class the round's intensity earns, and the
    //      island bounds it must bounce off. Everything else it gets free.
    //      Deleting the duplicate is the point — see CBZ.tornadoAudit().
    tornado: {
      name: "TORNADO", emoji: "", warnSecs: 5, activeSecs: 18, gap: 6, cause: "torn apart by the tornado", tint: 0x6a6f7a,
      // THE SKY GOES GREEN AND THE AIR STOPS. The pre-tornado sky is the most
      // recognisable weather telegraph there is, and it costs one weatherDrive
      // call: heavy low cloud, a hard yellow-green cast, and wind that dies
      // away to nothing right before the funnel drops.
      warn(ctx) {
        narrate("hint", "TORNADO touching down!", 2.6); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        // wind RISES then falls away — the eerie calm before the drop
        const gust = Math.sin(Math.min(1, k * 1.35) * Math.PI);
        weather({ rain: 0.25 + k * 0.35, wind: 2 + gust * 13, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.2 + k * 0.4, fogColor: 0x6f7a4e });
        ctx.env.hemiColor = lerpHex(ctx.env.hemiColor, 0xc9d67a, 0.5 * k);
        rattleProps(ctx, 0.02 * gust);
        if (rnd() < dt * 1.5 * gust) sound("wind");
      },
      warnThreat() { return 0.2; },
      start(ctx) {
        const p = ctx.arena.randomPoint(0, ctx.R * 0.5);
        ctx.st.x = p.x; ctx.st.z = p.z;              // hazards() reads these
        // the round's escalating intensity picks the EF class: EF1 on the
        // first pass, up to EF4 late. EF5 is reserved for the city.
        const ef = Math.max(1, Math.min(4, Math.round(1 + ctx.intensity * 2)));
        ctx.st.tw = CBZ.tornado ? CBZ.tornado.spawn({
          x: p.x, z: p.z, ef: ef,
          life: this.activeSecs + 1.5,
          // no `by`: nobody is credited for the weather (see tornado.js's
          // note — a non-null `by` makes structural.js blame the player)
          bounds: { x: ctx.cx, z: ctx.cz, r: ctx.R - 6 },   // bounce off the island edge
          /* THE ARENA BRIDGE (TORNADO_V2, declared in tornado.js). The vortex
             file owns the wind field and the timing; what it cannot own is the
             island's machinery, so this def LENDS it: bites land in THE
             structural ledger above (glass → lean → collapse, shared with the
             quake and the wave), thrown cars ride the one flingCar ticker the
             flood uses, and shelter is surv's own physical underRoof test.
             The vortex keeps no structural state; the island keeps one ledger. */
          arena: (CBZ.CONFIG.TORNADO_V2 !== false) ? {
            fragile: function () { return ctx.arena.fragile || []; },
            cars: function () { return ctx.arena.cars || []; },
            hitBuilding: function (b, amount, dirx, dirz) {
              return structureHit(b, amount, ctx, { kind: "tornado", dirx: dirx, dirz: dirz });
            },
            flingCar: function (car, dx, dz, force, up) { flingCar(car, dx, dz, force, up); },
            sheltered: function (a) { return sheltered(a); },
          } : null,
        }) : null;
      },
      active(dt, ctx) {
        // CBZ.tornado owns the field, the funnel, the deaths and the debris.
        // All this def does is mirror the live position for the minimap and
        // keep the parent storm blowing (the funnel already biases off
        // CBZ.weather's wind, so this is the only wind either of us sets).
        // V2 thins the active-phase fog: at 0.45 the whole column washed to
        // the fog colour and the funnel read as weather haze, not a tornado.
        // The dark condensation funnel + wall cloud need the contrast.
        weather({ rain: 0.55, wind: 12, windDir: { x: ctx.st.wx, z: ctx.st.wz },
          fog: CBZ.CONFIG.TORNADO_V2 !== false ? 0.28 : 0.45, fogColor: 0x6a6f7a });
        const a = CBZ.tornado && CBZ.tornado.active()[0];
        if (a) { ctx.st.x = a.x; ctx.st.z = a.z; }
      },
      end(ctx) { weatherOff(); if (CBZ.tornado && ctx.st.tw) CBZ.tornado.stop(ctx.st.tw); ctx.st.tw = null; },
      threat(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.threat(x, z) : 0; },
      safeDir(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.safeDir(x, z) : null; },
    },

    // ---- VOLCANO: lava flood off the mountain, lava bombs, pyro + lahar ----
    volcano: {
      name: "VOLCANIC ERUPTION", emoji: "", warnSecs: 6, activeSecs: 20, gap: 7, cause: "incinerated by lava", tint: 0x2e211c,
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
        narrate("hint", "THE VOLCANO IS WAKING, get off the mountain!", 3);
        sound("rumble"); if (CBZ.shake) CBZ.shake(0.5);
        const h = ctx.arena.hills[0];
        ctx.st.preGlow = disc(h.x, h.z, 0xff5210, 0.0, h.peak + 0.3);
        ctx.st.preGlow.material.blending = THREE.AdditiveBlending;
        ctx.st.preGlow.scale.set(4, 4, 1);
        const wa = rnd() * 6.28; ctx.st.wx = Math.cos(wa); ctx.st.wz = Math.sin(wa);
        // the failing flank, chosen ONCE so the telegraph and the flow can
        // never point at two different sides of the same mountain
        ctx.st.pyroBear = rnd() * 6.28;
        ctx.st.pyroLane = (vfx() && vfx().fallLine) ? vfx().fallLine({
          x: h.x + Math.cos(ctx.st.pyroBear) * 3, z: h.z + Math.sin(ctx.st.pyroBear) * 3,
          groundAt: gAt(ctx), bearing: ctx.st.pyroBear,
          step: 6, count: Math.ceil((h.r + ctx.R * 0.95) / 6) + 1, turn: 0.4, wander: 0.1,
        }) : null;
        ctx.st.rockCd = 0.7;
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        const h = ctx.arena.hills[0];
        if (CBZ.shake) CBZ.shake(0.04 + 0.22 * k * k);
        rattleProps(ctx, 0.015 + 0.05 * k);
        if (ctx.st.preGlow) ctx.st.preGlow.material.opacity = k * (0.55 + 0.3 * Math.sin(CBZ.now * 0.012));
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
              size: 0.4 + rnd() * 0.9, color: 0x4a4038, dmg: 0, linger: 5,
            });
          }
        }
      },
      /* The crowd is already running OFF the mountain while it is still only
         rumbling — and, first, OUT OF THE LANE. That stampede IS the warning
         for anyone who missed the rockfall. */
      warnThreat(x, z, ctx) {
        const h = ctx.arena.hills[0], d = Math.hypot(x - h.x, z - h.z);
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
      start(ctx) {
        if (ctx.st.preGlow) { rmMesh(ctx.st.preGlow); ctx.st.preGlow = null; }
        if (ctx.st.preAsh) { ctx.st.preAsh.dispose(); ctx.st.preAsh = null; }
        startEruption(ctx);
      },
      active(dt, ctx) { tickEruption(dt, ctx); tick0(ctx, dt); },
      end(ctx) {
        if (ctx.st.preGlow) { rmMesh(ctx.st.preGlow); ctx.st.preGlow = null; }
        if (ctx.st.preAsh) { ctx.st.preAsh.dispose(); ctx.st.preAsh = null; }
        weatherOff(); endEruption(ctx);
      },
      threat(x, z, ctx) { return eruptThreat(x, z, ctx); },
      safeDir(x, z, ctx) { const h = ctx.arena.hills[0]; const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
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

    // ---- METEOR SHOWER: telegraphed impacts, big blast ----
    meteor: {
      name: "METEOR SHOWER", emoji: "", warnSecs: 5, activeSecs: 17, gap: 6, cause: "flattened by a meteor", tint: 0x4a3a3a,
      // STREAKS CROSS THE SKY FIRST. Bolides burn up high and harmlessly for a
      // few seconds before anything reaches the ground — which is exactly the
      // real sequence, and it makes the player look UP, which is where the
      // warning for the rest of the event will be.
      warn(ctx) {
        narrate("hint", "METEORS, watch the shadows!", 2.6); sound("rumble");
        ctx.st.streaks = []; ctx.st.streakCd = 0.15;
      },
      warnTick(dt, ctx) {
        ctx.st.streakCd -= dt;
        if (ctx.st.streakCd <= 0) {
          ctx.st.streakCd = 0.18 + rnd() * 0.4;
          skyStreak(ctx);
          if (rnd() < 0.35) soundAt("rumble", camPos().x, camPos().z, { volume: 0.4 });
        }
        tickStreaks(dt, ctx);
      },
      warnThreat() { return 0.12; },   // nowhere is safe; keep the crowd moving
      start(ctx) { ctx.st.pending = []; ctx.st.cd = 0.5; ctx.env.sunInt = 0.7; ctx.st.timers = []; },
      active(dt, ctx) {
        ctx.env.fog = 0x4a3a3a; ctx.env.fogNear = 40; ctx.env.fogFar = 240; ctx.env.hemiColor = 0xffb0a0;
        tickStreaks(dt, ctx);
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = (0.8 - 0.4 * ctx.prog) * (0.6 + rnd());
          const p = ctx.arena.randomPoint(0, ctx.R);
          const r = 5 + scale(2, ctx);
          // the incoming rock is VISIBLE all the way down, not a shadow that
          // appears on the floor — the marker is the shadow it casts
          skyStreak(ctx, p.x, p.z);
          ctx.st.pending.push({ x: p.x, z: p.z, r, t: 1.2, m: CBZ.fx.groundMarker(p.x, p.z, r, 0xff5030) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 1.2);
          if (p.t <= 0) {
            p.m.dispose();
            CBZ.fx.dropDebris({ x: p.x, z: p.z, fromY: 40, vy: -22, size: 2.4, color: 0x3a2018, dmg: 0, linger: 4, keep: true, onLand: (x, z) => {
              // THE BLAST BUS OWNS THE IMPACT. `meteor` is a real ordnance row
              // (systems/impactbus.js) and it is PURE KINETICS — refE 1.2e8 J,
              // a 6 t stone at 200 m/s — so passing this rock's mass and speed
              // makes a late-round meteor genuinely bigger instead of the same
              // constant fireball with a different number typed beside it.
              survBlast("meteor", x, z, {
                r: p.r, cause: "flattened by a meteor", ctx: ctx,
                mass: 4000 + 4000 * ctx.intensity, speed: 190 + 60 * ctx.intensity,
                struct: 0.55 + 0.35 * ctx.intensity, structR: p.r * 2.4,
                fling: 7, knockback: 14, color: 0xffcaa0,
              });
              const cr = disc(x, z, 0x201810, 0.9, 0.05); cr.userData.transient = true;
            } });
            ctx.st.pending.splice(i, 1);
          }
        }
        tick0(ctx, dt);
      },
      end(ctx) { (ctx.st.pending || []).forEach((p) => p.m.dispose()); clearStreaks(ctx); },
      threat(x, z, ctx) { let t = 0; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 3) t = Math.max(t, 1 - d / (p.r + 3)); }); return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < p.r + 4 && d > 0.1) { bx += dx / d; bz += dz / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    /* ---- SINKHOLES: THE GROUND OPENS AND YOU GO DOWN IT ---------------------
       It began as a flat BLACK DISC painted on the grass that instakilled
       anyone standing on it; then it became a real 14-22 m shaft you fell into.
       This is the third pass and it is the owner's reference photograph —
       Guatemala City, 2010 — which changes three things about the ROSTER ENTRY
       (the shaft itself now lives in world/groundshaft.js):

       FEWER, BIGGER, DEEPER. Six 4 m dimples scattered over the island read as
       potholes. The reference is ONE shaft ~20 m across and twice that deep,
       with everything around it untouched, and the untouched surroundings are
       half of why it is frightening. So: one or two per event, r 7-11, depth
       4.2x the radius, and never anywhere the ground is not flat.

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
      name: "SINKHOLES", emoji: "", warnSecs: 6, activeSecs: 20, gap: 6, cause: "swallowed by a sinkhole", tint: 0x5a4a36,
      warn(ctx) {
        narrate("hint", "The ground is giving way!", 2.6); sound("rumble");
        ctx.st.holes = []; ctx.st.pending = []; ctx.st.seqs = [];
        ctx.st.cd = 0;
        sinkSite(ctx, this.warnSecs || 6);        // the first one is telegraphed for the whole warning
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
          ctx.st.cd = 9 + rnd() * 5;
          sinkSite(ctx, 3.2);
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

  // ============================================================
  // TSUNAMI — two implementations share the "flood" roster slot.
  //
  // TSUNAMI_LEGACY is the old build, preserved verbatim (flag off).
  // Why it "didn't work": every water check tested the TERRAIN height
  // (floor(x,z)) instead of the actor's actual Y — so a player on a
  // tower roof 30m above the water was "caught" by the wall and then
  // "drowned" bone dry, while the arena's own comments call roofs the
  // tsunami refuge. And the flood pool rose everywhere AT ONCE, island-
  // wide, from second one — you were drowning in water that visually
  // hadn't arrived, ahead of the wave front. Wall + pool were two
  // unrelated systems; the event had no arc.
  //
  // TSUNAMI_V2 is a real event arc:
  //   WARN   — sirens; the whole OCEAN visibly recedes off the shelf,
  //            exposing a huge ring of seabed (arena.ocean/seabed).
  //   SWEEP  — one towering curling WALL (a single vertex-colored
  //            ribbon mesh) surges across the island from a random
  //            compass direction; the flood sheet advances only BEHIND
  //            the front. Anyone actually below the crest is ragdolled
  //            downstream; cars tumble; small buildings collapse; tower
  //            glass blows out. Actual altitude is what saves you.
  //   FLOOD  — the island stays under: player swims (buoyancy + drag +
  //            stamina-as-air, the city swim.js pattern), bots paddle
  //            and drown, corpses and debris planks float and drift.
  //   DRAIN  — the water runs back out; planks strand; the ocean parks
  //            back at its resting level.
  // ============================================================
  const TSUNAMI_LEGACY = {
    name: "TSUNAMI", emoji: "", warnSecs: 7, activeSecs: 20, gap: 7, cause: "swept away by the tsunami", tint: 0x35607e,
    warn(ctx) { narrate("hint", "TSUNAMI, get to HIGH GROUND!", 3); sound("water"); },
    start(ctx) {
      // the rising flood pool that ultimately drowns the low ground
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ctx.R * 3, ctx.R * 3),
        new THREE.MeshLambertMaterial({ color: 0x2f7fb8, transparent: true, opacity: 0.8 }));
      m.rotation.x = -Math.PI / 2; m.position.set(ctx.cx, -3, ctx.cz); m.renderOrder = 2;
      m.material.depthWrite = false; root().add(m);
      ctx.st.water = m; ctx.st.y = -3; ctx.st.peak = Math.min(ctx.arena.hills[0].peak - 3, 8 + scale(4, ctx));
      const W = ctx.R * 3, Hh = 34;
      const wave = new THREE.Group();
      const planeL = (w, h, col, op, basic) => new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        (basic ? new THREE.MeshBasicMaterial : new THREE.MeshLambertMaterial)({ color: col, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false }));
      const base = planeL(W, Hh, 0x123c5e, 0.96); base.position.y = Hh / 2; base.renderOrder = 3;
      const body = planeL(W, Hh * 0.94, 0x2a7fb1, 0.6); body.position.set(0, Hh * 0.5, 0.6); body.renderOrder = 3;
      const lip = planeL(W, Hh * 0.42, 0x4aa6c8, 0.82); lip.position.set(0, Hh - Hh * 0.18, 2.8); lip.rotation.x = -0.98; lip.renderOrder = 4;
      const crest = planeL(W, 6.5, 0xf2fbff, 0.92, true); crest.position.set(0, Hh - 2.6, 3.7); crest.rotation.x = -0.86; crest.renderOrder = 5;
      const footFoam = planeL(W, 8, 0xeaf6ff, 0.85, true); footFoam.position.set(0, 3.4, 3.4); footFoam.rotation.x = -1.2; footFoam.renderOrder = 5;
      wave.add(base, body, lip, crest, footFoam);
      const streaks = [];
      for (let i = 0; i < 9; i++) {
        const st = planeL(1.2 + rnd() * 2.6, Hh * (0.45 + rnd() * 0.45), 0xdff1fb, 0.3, true);
        st.position.set((rnd() - 0.5) * W * 0.88, Hh * 0.48, 1.1); st.renderOrder = 4;
        wave.add(st); streaks.push(st);
      }
      wave.rotation.y = -Math.PI / 2;          // face +x, the travel direction
      ctx.st.waveX = ctx.cx - (ctx.R + 24);
      wave.position.set(ctx.st.waveX, ctx.st.y, ctx.cz);
      root().add(wave);
      ctx.st.wave = wave; ctx.st.waveH = Hh; ctx.st.passed = false;
      ctx.st.foam = [crest, footFoam]; ctx.st.streaks = streaks;
      ctx.st.waveSpeed = (2 * ctx.R + 48) / (ctx.activeSecs * 0.5);
      ctx.st.waveId = (ctx.st.waveId || 0) + 1 + rnd();
      ctx.st.spray = CBZ.fx.particleCloud({ mode: "fall", color: 0xeaf6ff, count: 340, radius: ctx.R, top: 13, size: 0.24, opacity: 0.75, vMin: 10, vMax: 20, drift: 8 });
      ctx.st.spray.setActive(0.95);
      if (CBZ.shake) CBZ.shake(0.85);
    },
    active(dt, ctx) {
      const baseY = ctx.st.y;
      if (!ctx.st.passed) {
        ctx.st.waveX += ctx.st.waveSpeed * dt;
        ctx.st.wave.position.set(ctx.st.waveX, baseY + Math.sin(CBZ.now * 0.006) * 0.5, ctx.cz);
        ctx.st.wave.rotation.z = Math.sin(CBZ.now * 0.004) * 0.02;
        if (ctx.st.foam) for (let i = 0; i < ctx.st.foam.length; i++) ctx.st.foam[i].material.opacity = 0.62 + 0.3 * Math.abs(Math.sin(CBZ.now * 0.02 + i * 1.7));
        if (ctx.st.streaks) for (let i = 0; i < ctx.st.streaks.length; i++) { const s = ctx.st.streaks[i]; s.material.opacity = 0.18 + 0.22 * Math.abs(Math.sin(CBZ.now * 0.013 + i)); s.position.y = ctx.st.waveH * (0.42 + 0.05 * Math.sin(CBZ.now * 0.01 + i * 2)); }
        ctx.st.spray.update(dt, ctx.st.waveX, baseY + ctx.st.waveH * 0.8, ctx.cz);
        if (rnd() < dt * 7) sound("water");
        const dpx = Math.abs(CBZ.player.pos.x - ctx.st.waveX);
        if (dpx < 26 && CBZ.shake) CBZ.shake(0.28 * (1 - dpx / 26));
        surv().forEachActor(function (a) {
          if (floor(a.pos.x, a.pos.z) > baseY + 7) return;       // safe up high
          if (a.pos.x <= ctx.st.waveX + 1.5 && a.pos.x >= ctx.st.waveX - 6 && a._waveId !== ctx.st.waveId) {
            a._waveId = ctx.st.waveId;
            if (CBZ.body) CBZ.body.hit(a, { dir: { x: 1, z: 0 }, force: 11, fling: 6 });
            surv().hurt(a, scale(26, ctx));
          }
        });
        const A = ctx.arena;
        if (A.cars) for (let i = 0; i < A.cars.length; i++) { const car = A.cars[i]; if (!car.flung && car.x <= ctx.st.waveX + 2 && car.x >= ctx.st.waveX - 9 && floor(car.x, car.z) <= baseY + 7) flingCar(car, 1, 0, 16 + scale(7, ctx), 8); }
        for (let i = 0; i < A.fragile.length; i++) { const b = A.fragile[i]; if (!b.fallen && b.x <= ctx.st.waveX + 2 && b.x >= ctx.st.waveX - 10 && floor(b.x, b.z) <= baseY + 9) collapse(b, ctx); }
        if (ctx.st.waveX > ctx.cx + ctx.R + 24) { ctx.st.passed = true; ctx.st.wave.visible = false; ctx.st.spray.setActive(0); }
      }
      ctx.st.y += (ctx.st.peak - ctx.st.y) * Math.min(1, dt * (ctx.st.passed ? 0.5 : 0.16));
      const wy = ctx.st.y + Math.sin(CBZ.now * 0.004) * 0.18;
      ctx.st.water.position.y = wy;
      let playerSub = false;
      surv().forEachActor(function (a) {
        const gH = floor(a.pos.x, a.pos.z), sub = wy - gH;
        if (sub > 1.7) { surv().hurt(a, scale(22, ctx) * dt, { cause: "drowned in the floodwater" }); if (a.isPlayer) playerSub = true; }
        else if (sub > 0.5 && !a.isPlayer) { a.pos.x += (ctx.arena.hills[0].x - a.pos.x) * 0.02 * dt; a.pos.z += (ctx.arena.hills[0].z - a.pos.z) * 0.02 * dt; }
      });
      if (playerSub) { ctx.env.fog = 0x14506e; ctx.env.fogNear = 2; ctx.env.fogFar = 26; }
    },
    end(ctx) {
      if (ctx.st.water) rmMesh(ctx.st.water);
      if (ctx.st.wave) { ctx.st.wave.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(ctx.st.wave); }
      if (ctx.st.spray) ctx.st.spray.dispose();
    },
    threat(x, z, ctx) {
      let t = 0;
      if (ctx.st.wave && !ctx.st.passed) { const d = Math.abs(x - (ctx.st.waveX || 0)); if (d < 30) t = Math.max(t, 0.6 + 0.4 * (1 - d / 30)); }
      const sub = (ctx.st.y || -3) - floor(x, z); if (sub > -1) t = Math.max(t, Math.min(1, 0.4 + sub * 0.25));
      return t;
    },
    safeDir(x, z, ctx) { const h = ctx.arena.hills[0]; const dx = h.x - x, dz = h.z - z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
  };

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

  // signed sweep coordinate of a point along the travel direction
  function tsuS(ctx, x, z) { const st = ctx.st; return (x - ctx.cx) * st.dx + (z - ctx.cz) * st.dz; }

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

  // ---- THE WALL: one curling ribbon mesh (vertex-colored, lit) + additive
  //      crest/foot foam + face streaks. A real overhanging 3D curl — you can
  //      see up into the barrel as it breaks over you — instead of flat cards.
  const TSU_PROFILE = [
    // [forward z (m @ H=34), height 0..1] — foot → face → apex → curl → lip
    [-8.0, 0.00], [-3.6, 0.30], [-1.4, 0.58], [0.4, 0.80], [2.2, 0.965],
    [3.4, 1.00], [4.6, 0.945], [5.2, 0.80], [4.6, 0.62],
  ];
  const TSU_ROWCOL = [
    [0.03, 0.12, 0.20], [0.05, 0.18, 0.30], [0.08, 0.28, 0.42], [0.12, 0.40, 0.55],
    [0.22, 0.55, 0.68], [0.42, 0.72, 0.82], [0.60, 0.83, 0.90], [0.72, 0.90, 0.95], [0.55, 0.80, 0.88],
  ];
  /* THE FACE IS SHARED NOW. world/water_spec.js owns one bore — the turbid
     gray-black Miyako soup at landfall, the towering blue-green curl in deep
     water — and city/tsunami.js rides the same object, because a tsunami that
     looks different in two modes is two tsunamis. Everything the audit and the
     regression read (st.waveWall, st.waveBasePos, st.waveCols/Rows) is
     re-exported from the handle, so nothing downstream can tell the difference
     except by looking. TSU_FACE_V2=false falls through to the legacy ribbon
     below, which is why it is still here. */
  function tsuBuildWave(ctx) {
    const st = ctx.st, H = st.H, W = ctx.R * 2.7, zs = H / 34;
    if (CBZ.CONFIG.TSU_FACE_V2 !== false && CBZ.tsuFaceBuild) {
      const h = CBZ.tsuFaceBuild({ width: W, height: H, rnd: rnd });
      h.group.rotation.y = Math.atan2(st.dx, st.dz);
      root().add(h.group);
      st.face = h;
      st.wave = h.group; st.waveWall = h.wall; st.waveBasePos = h.basePos;
      st.waveCols = h.cols; st.waveRows = h.rows;
      st.waveFoams = h.foams; st.waveStreaks = h.streaks;
      return;
    }
    const grp = new THREE.Group();
    const COLS = 30, ROWS = TSU_PROFILE.length;
    // per-column jitter so the front churns instead of reading as a ruler
    const zJit = [], hJit = [];
    for (let c = 0; c <= COLS; c++) { zJit.push((rnd() - 0.5) * 4.5); hJit.push(0.9 + rnd() * 0.2); }
    const pos = new Float32Array(ROWS * (COLS + 1) * 3);
    const col = new Float32Array(ROWS * (COLS + 1) * 3);
    let vi = 0;
    for (let r = 0; r < ROWS; r++) {
      const rc = TSU_ROWCOL[r], up = r / (ROWS - 1);
      for (let c = 0; c <= COLS; c++) {
        pos[vi] = (c / COLS - 0.5) * W;
        pos[vi + 1] = TSU_PROFILE[r][1] * H * hJit[c];
        pos[vi + 2] = TSU_PROFILE[r][0] * zs + zJit[c] * up;   // jitter grows toward the crest
        col[vi] = rc[0]; col[vi + 1] = rc[1]; col[vi + 2] = rc[2];
        vi += 3;
      }
    }
    const idx = [];
    for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
      const a0 = r * (COLS + 1) + c, b0 = a0 + 1, a1 = a0 + COLS + 1, b1 = a1 + 1;
      idx.push(a0, a1, b0, b0, a1, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const wall = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      vertexColors: true, transparent: true, opacity: 0.93, side: THREE.DoubleSide, depthWrite: false,
      shininess: 72, specular: 0x9fd9eb, emissive: 0x061b25, emissiveIntensity: 0.18,
    }));
    wall.renderOrder = 3;
    grp.add(wall);
    // Broken ribbons, not two billboard rectangles. Each patch is an
    // independent sloped quad with deterministic gaps, so from below or above
    // the crest reads as churning white water rather than a white roof card.
    function foamRibbon(kind, color, opacity) {
      const fp = [], fi = [];
      const n = 48;
      for (let c = 0; c < n; c++) {
        if ((c * 7 + (kind === "crest" ? 3 : 1)) % 11 < 2) continue;
        const x0 = (c / n - 0.5) * W, x1 = ((c + 1.12) / n - 0.5) * W;
        const w0 = Math.sin(c * 2.31 + (kind === "crest" ? 0.7 : 2.1));
        const w1 = Math.sin((c + 1) * 2.31 + (kind === "crest" ? 0.7 : 2.1));
        const y0 = kind === "crest" ? H * 0.985 + w0 * 0.9 : 1.15 + w0 * 0.18;
        const y1 = kind === "crest" ? H * 0.985 + w1 * 0.9 : 1.15 + w1 * 0.18;
        const z0 = (kind === "crest" ? 3.25 : 4.8) * zs + w0 * 0.45;
        const z1 = (kind === "crest" ? 3.25 : 4.8) * zs + w1 * 0.45;
        const depth = (kind === "crest" ? 2.4 : 4.0) + ((c * 13) % 7) * 0.32;
        const q = fp.length / 3;
        fp.push(x0, y0, z0, x1, y1, z1,
          x0, y0 - (kind === "crest" ? depth * 0.48 : 0.05), z0 + depth,
          x1, y1 - (kind === "crest" ? depth * 0.48 : 0.05), z1 + depth);
        fi.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3)); fg.setIndex(fi); fg.computeVertexNormals();
      const fm = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(fg, fm); mesh.renderOrder = 5; return mesh;
    }
    const crest = foamRibbon("crest", 0xffffff, 0.82);
    const foot = foamRibbon("foot", 0xeaf8ff, 0.66);
    grp.add(crest, foot);
    const streaks = [];
    for (let i = 0; i < 9; i++) {
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.55 + rnd() * 0.85, H * (0.26 + rnd() * 0.34)),
        new THREE.MeshBasicMaterial({ color: 0xdff1fb, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
          depthWrite: false, blending: THREE.AdditiveBlending }));
      sm.position.set((rnd() - 0.5) * W * 0.9, H * 0.45, 1.6 * zs);
      sm.renderOrder = 4; grp.add(sm); streaks.push(sm);
    }
    grp.rotation.y = Math.atan2(st.dx, st.dz);   // local +z → the travel direction
    root().add(grp);
    st.wave = grp; st.waveWall = wall;
    st.waveBasePos = new Float32Array(pos);
    st.waveCols = COLS; st.waveRows = ROWS;
    st.waveFoams = [crest, foot]; st.waveStreaks = streaks;
  }

  // The old wall only bobbed as one rigid group. This small CPU pass moves its
  // 279 vertices in overlapping directional phases, then rebuilds the analytic
  // face normals. The profile and physical front remain unchanged; only the
  // visible water churns, so collision can never drift away from presentation.
  function tsuAnimateWave(st, t) {
    const wall = st.waveWall, base = st.waveBasePos;
    if (!wall || !base) return;
    const a = wall.geometry.attributes.position, p = a.array;
    const cols = st.waveCols, rows = st.waveRows;
    for (let r = 0; r < rows; r++) {
      const up = r / Math.max(1, rows - 1);
      for (let c = 0; c <= cols; c++) {
        const q = (r * (cols + 1) + c) * 3, x = base[q];
        const ph0 = t * 1.55 + x * 0.052 + r * 0.61;
        const ph1 = t * -2.10 + x * 0.091 - r * 0.37;
        p[q] = x + Math.sin(ph1) * up * 0.34;
        p[q + 1] = base[q + 1] + Math.sin(ph0) * (0.16 + up * 0.72) + Math.sin(ph1) * up * 0.22;
        p[q + 2] = base[q + 2] + Math.sin(ph0 * 0.77) * (0.08 + up * 0.78);
      }
    }
    a.needsUpdate = true;
    wall.geometry.computeVertexNormals();
    wall.geometry.attributes.normal.needsUpdate = true;
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
    }
    if (CBZ.waterEventSet) CBZ.waterEventSet({
      owner: "survival-tsunami", kind: "tsunami", phase: st.phase,
      cx: ctx.cx, cz: ctx.cz, dx: st.dx, dz: st.dz,
      frontS: st.frontS, frontWet: -2, frontWidth: 20,
      level: CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.level,
      waveAmp: st.waveAmp, chopAmp: st.chopAmp,
      sediment: st.sediment || 0,
      flow: Number.isFinite(flow) ? flow : 0,
    });
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
    st.debris = CBZ.tsuDebrisField({
      root: root(),
      seaY: seaY,
      groundY: floor,
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
        CBZ.fx.blast(a.pos.x, a.pos.z, { maxR: 2.6, color: 0xcfe6ee, life: 0.32 });
        soundAt("collapse", a.pos.x, a.pos.z);
      },
    });
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

  // ---- floating debris planks — the LEGACY path (TSU_DEBRIS=false) --------
  function tsuSpawnPlanks(ctx) {
    const st = ctx.st;
    st.plankGeo = new THREE.BoxGeometry(1.7, 0.22, 0.55);
    st.plankMats = [new THREE.MeshLambertMaterial({ color: 0x8a6b45 }), new THREE.MeshLambertMaterial({ color: 0x66563c })];
    st.planks = [];
    for (let i = 0; i < 16; i++) {
      const p = ctx.arena.randomPoint(6, ctx.R * 0.9);
      const m = new THREE.Mesh(st.plankGeo, st.plankMats[i % 2]);
      m.rotation.y = rnd() * 6.28; m.visible = false; m.castShadow = false;
      root().add(m);
      st.planks.push({ m, x: p.x, z: p.z, ph: rnd() * 6.28, spin: (rnd() - 0.5) * 0.8 });
    }
  }
  function tsuPlanks(dt, ctx, current) {
    const st = ctx.st; if (!st.planks) return;
    for (let i = 0; i < st.planks.length; i++) {
      const pl = st.planks[i];
      if (st.phase === "sweep" && tsuS(ctx, pl.x, pl.z) > st.frontS - 2) continue;   // not swept yet
      // ONE surface: the same query the swimmer and the shader use
      const surface = seaY(pl.x, pl.z);
      const land = floor(pl.x, pl.z);
      if (surface - land < 0.25) { continue; }
      pl.m.visible = true;
      pl.x += st.dx * current * dt; pl.z += st.dz * current * dt;
      const floatY = surface - 0.08 + Math.sin(CBZ.now * 0.004 + pl.ph) * 0.1;
      pl.m.position.set(pl.x, Math.max(floor(pl.x, pl.z) + 0.12, floatY), pl.z);   // strands on land as it drains
      pl.m.rotation.y += pl.spin * dt;
      pl.m.rotation.z = Math.sin(CBZ.now * 0.003 + pl.ph) * 0.12;
    }
  }

  /* ONE CALL FOR EVERYTHING FLOATING. With TSU_DEBRIS on this is the real
     entrained load (cars, logs, house panels, tumbling and striking); with it
     off it is the sixteen legacy planks and nothing else changes. */
  function tsuFlotsam(dt, ctx, current) {
    const field = tsuDebris(ctx);
    if (field) {
      field.step(dt, { dx: ctx.st.dx, dz: ctx.st.dz, flow: current, sediment: ctx.st.sediment || 0 });
      return;
    }
    tsuPlanks(dt, ctx, current);
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
      CBZ.fx.blast(a.pos.x, a.pos.z, { maxR: 4.5, color: 0xd9f2ff, life: 0.5 });
      sound("water");
    });
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
      field.takeWorld(picks[i], thin ? "panel" : "rubble");
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

  function tsuSmash(ctx) {
    const st = ctx.st, A = ctx.arena;
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
        structureHit(b, 1.25, ctx, { kind: "kinetic", dirx: st.dx, dirz: st.dz });
        if (field && b.fallen) tsuTearWalls(field, b);
      } else {
        const room = Math.max(0, TSU_CONCRETE_CAP - (b._dmg || 0));
        const load = Math.min(room, 0.34 * (0.7 + 0.5 * ctx.intensity));
        if (load > 0.001) structureHit(b, load, ctx, { kind: "kinetic", dirx: st.dx, dirz: st.dz });
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
    st.waveAmp = 1.38; st.chopAmp = 1.72; st.foamGain = 0.62;
    if (st.wave) st.wave.visible = false;
    if (st.spray) st.spray.setActive(0);
    surgeSet(st.floodSurge);
    tsuPublish(ctx, 1.6);
    narrate("hint", "THE ISLAND IS UNDER, swim, climb, survive", 3);
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
  const TSUNAMI_V2 = {
    name: "TSUNAMI", emoji: "",
    get warnSecs() { return TSU_FAST() ? 6 : 10; },
    get activeSecs() { return TSU_FAST() ? 16 : 26; },
    gap: 8,
    cause: "swept away by the tsunami", tint: 0x2c5a78,
    warn(ctx) {
      const st = ctx.st, a = rnd() * Math.PI * 2;
      st.dx = Math.cos(a); st.dz = Math.sin(a);
      st.warnT = 0; st.phase = "warn";
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
      tsuPublish(ctx, 0);
      narrate("hint", "TSUNAMI, the sea is PULLING BACK. GET HIGH!", 3.6);
      soundAt("siren", ctx.cx, ctx.cz);
      if (CBZ.shake) CBZ.shake(0.3);
    },
    warnTick(dt, ctx) {
      const st = ctx.st;
      st.warnT += dt;
      st.eventT = (st.eventT || 0) + dt; st.phaseT = (st.phaseT || 0) + dt;
      const k = Math.min(1, st.warnT / TSUNAMI_V2.warnSecs);
      /* THE DREAD BEAT, AND IT IS THE WHOLE WARNING. The sea empties off the
         shelf — hundreds of metres of wet seabed, boats on the mud, the reef
         showing. It is the signal that has actually saved lives, and it beats
         a siren because it is information you have to KNOW how to read rather
         than a label telling you what to feel (city/tsunami.js's argument,
         and this is now the same one number driving it). */
      surgeSet(TSU_DRAW * (k * k * (3 - 2 * k)));
      st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.level;
      st.waveAmp = 0.86 + k * 0.38;
      st.chopAmp = 0.72 + k * 0.62;
      st.foamGain = 0.34 + k * 0.18;
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
      st.H = 30 + 8 * Math.min(1.4, ctx.intensity);                  // taller than the mountain late-run
      // metres of SURGE at full inundation (rest sea sits at -0.8), chosen so
      // the town goes 1-2 storeys under while the mountain and the tower roofs
      // stay dry — the refuges have to survive or the event has no answer
      st.floodSurge = Math.min(14.3, 8.3 + scale(2.4, ctx));
      st.frontS = -(R + 52);
      /* THE SWEEP'S SHARE OF THE BUDGET. 0.44 of 26 s was 11.4 s to cross
         344 m; 0.46 of 16 s is 7.4 s for the same ground — the front is
         half again as fast, and the beats it has to hit (approach, stand,
         crash, crossing) all still fit inside it. */
      const sweepShare = TSU_FAST() ? 0.46 : 0.44;
      st.speed = (2 * R + 104) / (ctx.activeSecs * sweepShare);   // legacy constant walk
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
        st.speedK = unit / Math.max(2, ctx.activeSecs * sweepShare - st.stallSecs);
      } else st.speedK = 0;
      st.waveAmp = 1.55; st.chopAmp = 2.15; st.foamGain = 0.82;
      st.waveId = "tsu" + CBZ.now + rnd();
      st.landfall = false;
      tsuBuildWave(ctx);
      // NO INUNDATION MESH. The sea itself comes over the island (surgeSet),
      // which is why the swimmer, the buoyancy, the drifting corpses and the
      // submergence test all agree without any of them being told.
      st.spray = CBZ.fx.particleCloud({ mode: "fall", color: 0xeaf6ff, count: 320, radius: R * 0.8, top: 15, size: 0.26, opacity: 0.8, vMin: 11, vMax: 22, drift: st.dx * 9, driftZ: st.dz * 9 });
      st.spray.setActive(0.95);
      st.sediment = 0; st.undertowT = 0; st.carWatch = null;
      st.debris = undefined;                    // built lazily on first contact
      if (CBZ.CONFIG.TSU_DEBRIS === false || !CBZ.tsuDebrisField) tsuSpawnPlanks(ctx);
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
      ctx.env.fog = 0x1c2b34; ctx.env.fogNear = 70; ctx.env.fogFar = 520;
      ctx.env.sunInt = 0.50; ctx.env.sunColor = 0xc9d2d6;
      ctx.env.hemiInt = 0.72; ctx.env.hemiColor = 0x707f88;
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
        /* THE ARC IS MEASURED AGAINST THE ISLAND, NOT AGAINST THE WHOLE RUN.
           The first version of this walked one curve across the entire travel
           (-R-52 → +R+52) with a lag exponent, and the arithmetic of that was
           simply wrong: at the moment the wall reached the island CENTRE the
           surge was still -1.15 m — BELOW resting sea level. The bore arrived
           on dry ground and the water only turned up after the front had left,
           which is the opposite of a tsunami.

           Two beats, each with its own span, because they are two different
           physical events:

           APPROACH (frontS -R-52 → -R): the drawdown COMING BACK. The sea
           returns from TSU_DRAW to rest over the 52 m of open water in front
           of the beach, so it crosses mean level exactly as the wall makes
           landfall — the water and the wall arrive together.

           CROSSING (frontS -R → +R): the run-up piles in, on land^0.75. That
           exponent is what keeps the crest AHEAD of full inundation (the wall
           still reads as an edge, not the top of a rising pool) without ever
           letting the ground behind it be dry. */
        const approach = Math.min(1, (st.frontS + ctx.R + 52) / 52);
        const land = Math.max(0, Math.min(1, (st.frontS + ctx.R) / (2 * ctx.R)));
        surgeSet(land <= 0 ? TSU_DRAW * (1 - ease(approach))
                           : st.floodSurge * Math.pow(land, 0.75));
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0.8;
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
          st.faceH = st.H * hs;
          CBZ.tsuFaceUpdate(st.face, {
            t: CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001, dt: dt,
            height: st.faceH, turbid: turbid,
            // a spent surge does not overhang: the curl goes with the height
            curl: (0.22 + 1.35 * shoal) * (1 - turbid * 0.62) * Math.max(0.22, spent) * crashCurl,
            foam: st.foamGain,
            x: fx0, y: st.level - 2.4 + Math.sin(CBZ.now * 0.005) * 0.4, z: fz0,
            dirX: st.dx, dirZ: st.dz,
          });
          grp.rotation.z = Math.sin(CBZ.now * 0.0035) * 0.016;
        } else {
          grp.position.set(fx0, st.level - 2.4 + Math.sin(CBZ.now * 0.005) * 0.4, fz0);
          grp.rotation.z = Math.sin(CBZ.now * 0.0035) * 0.016;
          grp.scale.y = 1 + 0.035 * Math.sin(CBZ.now * 0.007);
          tsuAnimateWave(st, CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001);
          const fo = st.waveFoams;
          if (fo) for (let i = 0; i < fo.length; i++) fo[i].material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(CBZ.now * 0.02 + i * 1.7));
          const sk = st.waveStreaks;
          if (sk) for (let i = 0; i < sk.length; i++) { const s = sk[i]; s.material.opacity = 0.16 + 0.2 * Math.abs(Math.sin(CBZ.now * 0.013 + i)); s.position.y = st.H * (0.42 + 0.05 * Math.sin(CBZ.now * 0.01 + i * 2)); }
        }
        // the spray-torn crest: thicker the harder the wave is curling, and it
        // rides the LIVE crest — spray hanging at the height of a wave that is
        // no longer there is the tell that the wave never really came down
        // the crash tears the whole crest into the air for a beat; otherwise
        // the mist follows the curl as before
        st.spray.setActive(st.broke && st.crashT < 0.9 ? 1.5
          : (0.6 + 0.4 * shoal) * Math.max(0.18, spent));
        st.spray.update(dt, fx0, st.level + (st.faceH || st.H) * 0.9, fz0);
        tsuPublish(ctx, 2.2);
        // LEGACY LANDFALL (TSU_SHOAL_V2 off): the single blast + "BRACE!".
        // With the flag on, tsuCrash() already fired at the end of the stand
        // and set st.landfall, so this never runs twice.
        if (!st.landfall && st.frontS > -(ctx.R - 6)) {
          st.landfall = true;
          CBZ.fx.blast(fx0, fz0, { maxR: 26, color: 0xd9f2ff, shake: 1.15, life: 0.8 });
          narrate("toast", "BRACE!");
          sound("collapse"); sound("water");
        }
        const pd = Math.abs(tsuS(ctx, CBZ.player.pos.x, CBZ.player.pos.z) - st.frontS);
        if (pd < 40 && CBZ.shake) CBZ.shake(0.45 * (1 - pd / 40));   // the roar closes in
        if (rnd() < dt * 8) sound("water");
        tsuCatch(dt, ctx);
        tsuSmash(ctx);
        tsuCarHandoff(ctx);
        floodActors(dt, ctx, 2.2, "drowned in the flood", st.dx, st.dz);
        // the debris rides the BORE's speed, not a constant: near-still while
        // the wave stands, then surging inland with the released front
        tsuFlotsam(dt, ctx, CBZ.CONFIG.TSU_SHOAL_V2 !== false && st.frontV != null
          ? Math.min(8.5, 2 + st.frontV * 0.12) : 5.4);
        if (st.frontS > ctx.R + 52) tsuEnterFlood(ctx);
      } else if (st.phase === "flooded") {
        st.floodT += dt;
        surgeSet(st.floodSurge);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.floodSurge;
        st.sediment = 0.95;
        tsuPublish(ctx, 1.6);
        ctx.env.fog = 0x21323b; ctx.env.fogNear = 60; ctx.env.fogFar = 440; ctx.env.sunInt = 0.56; ctx.env.hemiInt = 0.78; ctx.env.hemiColor = 0x7a8992;
        floodActors(dt, ctx, 1.6, "drowned in the flood", st.dx, st.dz);
        tsuCarHandoff(ctx);
        tsuFlotsam(dt, ctx, 1.6);
        if (rnd() < dt * 2.5) sound("water");
        st.floodBudget = ctx.activeSecs * (TSU_FAST() ? 0.30 : 0.34);
        if (st.floodT > st.floodBudget) { st.phase = "drain"; st.drainFrom = st.floodSurge; narrate("hint", "The water is DRAINING, move!", 2.4); }
      } else {  // drain — slow, and what it drags out with it is the memory
        const cur = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        const next = Math.max(0, cur - dt * (st.floodSurge + 1.5) / Math.max(1.5, ctx.activeSecs * (TSU_FAST() ? 0.17 : 0.2)));
        surgeSet(next);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
        const drainK = Math.max(0, Math.min(1, next / Math.max(0.1, st.floodSurge)));
        st.drainK = drainK;      // 1 = still fully inundated, 0 = the sea is back
        st.waveAmp = 0.86 + 0.52 * drainK; st.chopAmp = 0.72 + 1.0 * drainK; st.foamGain = 0.34 + 0.28 * drainK;
        // the water that leaves is the dirtiest water there has been — it is
        // carrying the town out with it
        st.sediment = Math.min(1, 0.55 + 0.45 * drainK);
        /* ---- THE UNDERTOW (TSU_UNDERTOW) --------------------------------
           Everything the wave brought in leaves through the same gap, faster
           than it arrived, and this is the half that drowns the people who
           survived the impacts. The number is deliberately past swim.js's
           fast stroke (2.15 m/s): applyCurrent moves you 0.34 x flow, so at
           drainK 1 the sea is taking you seaward at ~3.1 m/s and swimming
           straight at it loses. The answer is not to swim — it is to be
           holding on to something, or to already be high. */
        const undertow = CBZ.CONFIG.TSU_UNDERTOW === false ? -0.7 * drainK : -(1.8 + 7.4 * drainK);
        st.undertow = undertow;
        tsuPublish(ctx, undertow);
        floodActors(dt, ctx, CBZ.CONFIG.TSU_UNDERTOW === false ? -0.7 : -(1.1 + 2.4 * drainK),
          "dragged out to sea by the undertow", st.dx, st.dz);
        tsuCarHandoff(ctx);
        tsuFlotsam(dt, ctx, undertow);
        tsuUndertowDrown(dt, ctx, drainK);
      }
      // heavier fog with your face at the surface — city/swim.js owns the
      // swimmer now, so this reads its published state instead of a local flag
      const sw = CBZ.citySwimState && CBZ.citySwimState();
      if (sw && sw.swimming) { ctx.env.fog = 0x101c22; ctx.env.fogNear = 4; ctx.env.fogFar = 42; }
    },
    end(ctx) {
      const st = ctx.st;
      // ONE LINE PUTS THE SEA BACK. There is no mesh to reposition, no sheet
      // to delete and no swimmer to stand down.
      surgeSet(0);
      // an event cancelled mid-stand must not leave the world muted
      if (CBZ.audioHush) CBZ.audioHush(false);
      const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
      // the sediment goes with it — one match's soup must never tint the next
      if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; W.opacity = 1; W.sediment = 0; }
      const o = ctx.arena && ctx.arena.ocean;
      if (o && CBZ.waterDriveDisasterSurface) CBZ.waterDriveDisasterSurface(o, { amp: 0.86, chop: 0.72, foam: 0.34, opacity: 1, sediment: 0 });
      if (o) o.position.y = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
      if (CBZ.waterEventClear) CBZ.waterEventClear("survival-tsunami");
      st.sediment = 0;
      if (st.face) {
        if (CBZ.tsuFaceDispose) CBZ.tsuFaceDispose(st.face);
        st.face = null; st.wave = null; st.waveWall = null; st.waveBasePos = null;
      }
      if (st.wave) { st.wave.traverse((ob) => { if (ob.geometry) ob.geometry.dispose(); if (ob.material && ob.material.dispose) ob.material.dispose(); }); root().remove(st.wave); st.wave = null; }
      if (st.spray) { st.spray.dispose(); st.spray = null; }
      /* THE DEBRIS DOES NOT LEAVE WITH THE WATER. Everything the wave carried
         is stranded exactly where the drain put it — a car on its roof in a
         street, a pine across a doorway — and it stays there for the rest of
         the match. That wreckage IS the aftermath, and deleting it would be
         throwing away the only thing the event leaves behind. */
      if (st.debris) { st.debris.strandAll(); st.carWatch = null; }
      if (st.planks) {
        for (let i = 0; i < st.planks.length; i++) root().remove(st.planks[i].m);
        if (st.plankGeo) st.plankGeo.dispose();
        if (st.plankMats) { st.plankMats[0].dispose(); st.plankMats[1].dispose(); }
        st.planks = null;
      }
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

  if (CBZ.CONFIG.SURV_TSUNAMI_V2 == null) CBZ.CONFIG.SURV_TSUNAMI_V2 = true;
  DEFS.flood = CBZ.CONFIG.SURV_TSUNAMI_V2 !== false ? TSUNAMI_V2 : TSUNAMI_LEGACY;

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
     read as rock. That material is now the FLAG REVERT and nothing else
     (SURV_VOLCANO_LAVA_V2 / VOLCANO_V2 = false).

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

  /* THE ASH LADDER, in metres of deposited ash, and the three numbers are
     deliberately close together: the whole point of ashfall is that the SAME
     accumulation that starts hurting the people outside is on its way to
     killing the people who correctly went inside. VISUAL_FULL is only when
     the blanket stops thickening on screen; the depth keeps climbing. */
  const ASH_DOT_DEPTH = 0.006;   // shreds unsheltered lungs
  const ASH_VISUAL_FULL = 0.16;  // continuous grey blanket on screen
  const ASH_ROOF_FAIL = 0.055;   // the roof starts failing under the load
  let pyroRuns = 0, laharRuns = 0, ashRoofCollapses = 0, lavaLegacy = 0, whiteouts = 0;
  /* THE BODY COUNT, because the owner's "kills way too many people" deserves
     a number that a later edit cannot quietly undo. `volcanoDeaths` is the
     drop in the live roster across an eruption — measured off the mode's own
     aliveCount() rather than by instrumenting six kill sites, so nothing can
     kill someone by a path this counter does not see. */
  let bombsThrown = 0, volcanoDeaths = 0, volAliveAtStart = -1;
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

  function vfx() { return (CBZ.CONFIG.VOLCANO_V2 !== false && CBZ.CONFIG.SURV_VOLCANO_LAVA_V2 !== false) ? CBZ.volcanoFx : null; }
  // 0 at deep night, 1 at midday — core/daynight.js's own clock, so a disaster
  // tint can DIM the day without ever being able to invent one
  function dayK() {
    if (!CBZ.dayPhase) return 1;
    const t = CBZ.dayPhase();
    return Math.max(0, Math.min(1, Math.sin((t - 0.22) * Math.PI / 0.56)));
  }
  function gAt(ctx) { return ctx.arena.groundHeightAt; }
  function vent(h, ang, r) { return { x: h.x + Math.cos(ang) * r, z: h.z + Math.sin(ang) * r }; }

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

  // ---- THE FLAG REVERT: the old see-through additive stream, verbatim ----
  const ERUPT_UP = window.THREE ? new THREE.Vector3(0, 1, 0) : null;
  const STREAM_BASE_LEN = 1;
  const STREAM_HALF_W = 2.9;
  function makeLavaStream(angle) {
    const geo = new THREE.BoxGeometry(5.2, STREAM_BASE_LEN, 1.1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a18, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 6;
    root().add(m);
    lavaLegacy++;
    return { angle, len: 3, maxLen: 0, mesh: m };
  }
  function streamHit(ax, az, h, s) {
    const dx = ax - h.x, dz = az - h.z;
    const along = dx * Math.cos(s.angle) + dz * Math.sin(s.angle);
    if (along < 0 || along > s.len) return false;
    const perp = Math.abs(-dx * Math.sin(s.angle) + dz * Math.cos(s.angle));
    return perp < STREAM_HALF_W;
  }

  function startEruption(ctx) {
    if (ctx.st.erupting) return; ctx.st.erupting = true;
    const h = ctx.arena.hills[0];
    const V = vfx();
    try { volAliveAtStart = surv().aliveCount(); } catch (e) { volAliveAtStart = -1; }
    narrate("banner", "VOLCANIC ERUPTION");
    narrate("hint", "THE MOUNTAIN ERUPTS, stay off the lava!", 3);
    if (CBZ.shake) CBZ.shake(0.9); sound("explosion"); sound("rumble");
    // a fountain of glowing lava bursting UP out of the summit vent
    ctx.st.erFountain = CBZ.fx.particleCloud({ mode: "rise", color: 0xff6a1a, count: 260, radius: 7, top: 22, size: 0.3, opacity: 0.85, vMin: 12, vMax: 22, drift: 3 }); ctx.st.erFountain.setActive(0.95);
    /* a towering dark ash column above the fountain. V2 gets the SPRITE
       column (volcanofx ashColumn — a pillar with a silhouette, built like
       the pyroclastic current's mass); the flag revert keeps the old dotted
       Points cloud verbatim. */
    if (V && V.ashColumn) {
      ctx.st.erColumn = V.ashColumn({
        x: h.x, z: h.z, y: h.peak + 3,
        height: 52 + 16 * ctx.intensity, r: 6.5 + 2.5 * ctx.intensity,
        parent: root(),
      });
      ctx.st.erSmoke = null;
    } else {
      ctx.st.erSmoke = CBZ.fx.particleCloud({ mode: "rise", color: 0x2a2420, count: 200, radius: 15, top: 52, size: 0.62, opacity: 0.4, vMin: 5, vMax: 10, drift: 9 }); ctx.st.erSmoke.setActive(0.6);
    }
    /* THE COLUMN STANDS ON LIGHT. In the reference night photograph the ash
       pillar is dark — but its BASE is rose-orange, lit from below by the
       vent it is standing on. A second short rising cloud in ember colours
       under the dark one is that underside; without it the column reads as
       a grey smudge that merely starts near the mountain. */
    ctx.st.erSmokeLit = CBZ.fx.particleCloud({ mode: "rise", color: 0xd06a35, count: 110, radius: 8, top: 15, size: 0.5, opacity: 0.32, vMin: 4, vMax: 8, drift: 3 }); ctx.st.erSmokeLit.setActive(0.75);
    /* NO ash raining over the island any more — OWNER, 2026-08-16: "the ash
       everywhere is just so dumb, idc if it's realistic". The 300 grey motes
       that fell here went the same way as the ground blanket. */
    ctx.st.erAsh = null;
    /* The crater itself: the V2 path gets the OPAQUE draped spatter apron
       (world/volcanofx.js ventGlow — the reference photo's white-hot summit).
       The additive disc survives only as the flag revert's crater, because a
       glowing translucent coin is both halves of the owner's complaint —
       see-through AND geometric. */
    if (V && V.ventGlow) {
      ctx.st.erVent = V.ventGlow({
        x: h.x, z: h.z, r: 5.5 + 2.5 * ctx.intensity,
        groundAt: gAt(ctx), parent: root(), salt: 4747,
      });
      ctx.st.erCrater = null;
    } else {
      ctx.st.erCrater = disc(h.x, h.z, 0xff5210, 0.9, h.peak + 0.3); ctx.st.erCrater.material.blending = THREE.AdditiveBlending; ctx.st.erCrater.scale.set(5, 5, 1);
    }

    // THE WIND IS THE WEATHER'S WIND — the warn phase already set a bearing
    // and drove it into systems/weather.js, so the ash falls the same way the
    // rain would and there is no fourth wind field in this file.
    const w0 = windVec();
    const wa = (w0 && w0.speed > 0.5) ? Math.atan2(w0.z, w0.x)
      : (ctx.st.wx != null ? Math.atan2(ctx.st.wz, ctx.st.wx) : rnd() * 6.28);
    ctx.st.erWindX = Math.cos(wa); ctx.st.erWindZ = Math.sin(wa);
    /* The collapse bearing: the side of the cone that fails. Chosen in warn()
       so the telegraph and the flow cannot disagree about which way it goes —
       but the EARTHQUAKE's surprise eruption has no warn phase of its own, so
       the lane is built here too when it is missing. Without this the quake
       path had a flow and no lane, which meant no minimap front and no
       flee-the-corridor field: the same hazard, silently unreadable. */
    if (ctx.st.pyroBear == null) ctx.st.pyroBear = rnd() * 6.28;
    if (!ctx.st.pyroLane && V && V.fallLine) {
      ctx.st.pyroLane = V.fallLine({
        x: h.x + Math.cos(ctx.st.pyroBear) * 3, z: h.z + Math.sin(ctx.st.pyroBear) * 3,
        groundAt: gAt(ctx), bearing: ctx.st.pyroBear,
        step: 6, count: Math.ceil((h.r + ctx.R * 0.95) / 6) + 1, turn: 0.4, wander: 0.1,
      });
    }

    ctx.st.erLava = null; ctx.st.erStreams = null; ctx.st.erPools = null;
    if (V) {
      /* ---- LAVA: braided, branching flow fields down the fall line ----

         OWNER, 2026-08-15, sending the two reference photographs that are
         now this eruption's bible: "magma should be way better... organic
         ... don't make it look geometric". The last wave answered an
         earlier photo with NINE separate uniform threads, and the shots
         proved the problem with that: nine parallel worms of even width and
         even glow are still geometry, just thinner geometry.

         The close-up bible photo is ONE THING that branches: a stem that
         forks into lobes, a dark crusted surface laced with connected
         bright filaments, margins that neck and belly. So the count goes
         DOWN and the structure goes UP: five broad flows, each carrying
         the lace field (the braid now lives in the surface, where the
         photograph has it, instead of in the flow count), each forking
         into narrower children as its front advances. The mountain ends up
         wearing a fan of fifteen-odd noses grown from five stems — organic
         because it is grown, not drawn. */
      const n = 5;
      ctx.st.erLava = [];
      for (let i = 0; i < n; i++) {
        // never straight down the pyroclastic lane — the two hazards want
        // separate faces of the cone so the mountain reads as having sides
        const a = ctx.st.pyroBear + 1.0 + (i / n) * 5.2 + (CBZ.hash01 ? CBZ.hash01(h.x + i, h.z, 91) : 0.5) * 0.34;
        const p = vent(h, a, 2.2);
        ctx.st.erLava.push(V.lavaFlow({
          x: p.x, z: p.z, groundAt: gAt(ctx), parent: root(), bearing: a,
          len: h.r * 1.5 + 18 * ctx.intensity,
          /* A SLOW FLOOD, NOT RIVERS — OWNER, 2026-08-16: "magma coming down
             not in rivers but like a slow flood". At 4.5-5.6 m wide the five
             stems read as separate ribbons with grass between them; at
             ~10-13 m they overlap into one apron at the rim and come down
             the cone as broad lobes that happen to divide. Same station
             count (spacing is set by the lid field, not the width), same
             nine-column grid, so the flood costs what the rivers cost. */
          width: 10 + 3 * ctx.intensity,
          /* YOU WALK AWAY FROM LAVA — that is this file's own doctrine two
             hundred lines up, and at 4.2-6.8 m/s the flows were outrunning a
             SPRINT. Slower still now (1.2-1.9): a flood CREEPS — the wide
             front nosing down the cone is the read, not the sprint. */
          speed: 1.2 + 0.7 * ctx.intensity,
          salt: 4700 + i * 137,
          branches: 2,
          // BUDGET: three real lights for five stems (the vent apron carries
          // its own), haze on the same three — a full set on every stem plus
          // every child is a fog bank, which is what buried an earlier look
          light: i % 2 === 0,
          haze: i % 2 === 0,
        }));
      }
      /* ---- ASHFALL AS A LOAD: one field, plus every standing roof ---- */
      if (CBZ.CONFIG.VOLCANO_ASH_LOAD !== false) {
        const F = ctx.arena.fragile || [];
        const AL = V.ashLoad({
          cx: ctx.cx, cz: ctx.cz, r: ctx.R, groundAt: gAt(ctx),
          parent: root(), roofs: F.length + 8, salt: 6151, full: ASH_VISUAL_FULL,
        });
        ctx.st.erAshLoad = AL;
        ctx.st.erRoofs = [];
        for (let i = 0; i < F.length; i++) {
          const b = F[i]; if (b.fallen) continue;
          ctx.st.erRoofs.push({ b: b, id: AL.addRoof({ x: b.x, z: b.z, y: b.h + 0.05, w: b.w, d: b.d, ref: b }) });
        }
        ctx.st.erRoofT = 0;
      }
      /* ---- the two travelling hazards are SCHEDULED, not immediate: a
              cone has to build a column before it can collapse one ---- */
      ctx.st.pyro = null;
      ctx.st.pyroCd = 4.5 - 2.2 * ctx.intensity;
      ctx.st.lahar = null;
      ctx.st.laharCd = 8.5 - 3.0 * ctx.intensity;
    } else {
      // ---- FLAG REVERT: the legacy additive streams + pulsing pool discs ----
      ctx.st.erStreams = [];
      const base = rnd() * 6.28, n = 5;
      for (let i = 0; i < n; i++) {
        const s = makeLavaStream(base + (i / n) * 6.28 + (rnd() - 0.5) * 0.4);
        s.maxLen = h.r * (0.82 + rnd() * 0.16);
        ctx.st.erStreams.push(s);
      }
      ctx.st.erPools = ctx.st.erStreams.map(function (s) {
        const pm = disc(h.x + Math.cos(s.angle) * 6, h.z + Math.sin(s.angle) * 6, 0xff4a10, 0.9, 0.12);
        pm.material.blending = THREE.AdditiveBlending;
        pm.scale.set(0.6, 0.6, 1);
        return { s, m: pm, r: 0 };
      });
    }
    ctx.st.erBombCd = 1.1;
  }

  function tickEruption(dt, ctx) {
    if (!ctx.st.erupting) return;
    const h = ctx.arena.hills[0];
    const V = vfx();
    /* AN ERUPTION DARKENS THE AIR; IT DOES NOT DELETE THE ISLAND. The old
       22/160 m fog put the far side of a 240 m island inside the wall, so the
       mountain you are supposed to be reading was the murkiest thing on
       screen. Widened again (55/380) with the ash's removal — OWNER,
       2026-08-16: the grey-out was half of "the ash covers everything in a
       dumb way", and with no blanket to excuse it the air only needs enough
       murk to sell the event.

       AND IT MUST NOT TURN NIGHT INTO NOON. survEnv is a flat override, so
       writing sunInt 0.5 unconditionally made a midnight eruption brighter
       than the midnight around it — which is also precisely the condition
       under which the lava's own light is supposed to be the thing you see.
       dayK() is the sun's own elevation off core/daynight.js. */
    const dk = dayK();
    ctx.env.fog = lerpHex(0x120b08, 0x2e211c, dk); ctx.env.fogNear = 55; ctx.env.fogFar = 380;
    /* AND IT MUST NOT PAINT THE ISLAND PEACH. 0xff6a3a is a fully saturated
       orange; run through every diffuse surface on the map it turned grey ash,
       grey concrete and green grass into one warm pastel, which is the
       opposite of the reference photograph the owner sent — that mountain is
       DARK. An ash-shrouded eruption sky is a dirty brown, not a sodium lamp,
       so the sun keeps its warmth and loses most of its saturation. */
    ctx.env.sunInt = 0.5 * dk; ctx.env.sunColor = 0xd9714a;
    ctx.env.hemiInt = 0.14 + 0.42 * dk; ctx.env.hemiColor = 0x9c7461;
    ctx.st.erFountain.update(dt, h.x, h.peak, h.z);
    if (ctx.st.erSmoke) ctx.st.erSmoke.update(dt, h.x + (ctx.st.erWindX || 0) * 14, h.peak + 6, h.z + (ctx.st.erWindZ || 0) * 14);
    // the sprite pillar leans with the same wind the ash falls on
    if (ctx.st.erColumn) ctx.st.erColumn.update(dt, ctx.st.erWindX || 0, ctx.st.erWindZ || 0);
    // the lit underside rides just over the fountain, beneath the dark column
    if (ctx.st.erSmokeLit) ctx.st.erSmokeLit.update(dt, h.x + (ctx.st.erWindX || 0) * 5, h.peak + 1.5, h.z + (ctx.st.erWindZ || 0) * 5);
    if (ctx.st.erVent) ctx.st.erVent.update(dt);
    if (ctx.st.erCrater) ctx.st.erCrater.material.opacity = 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.012));
    // the eruption is still weather — a dimmed sun and a downwind haze — but
    // a light one now the ash is gone: 0.55 fog was the island-wide grey-out
    weather({ rain: 0, wind: 7, windDir: { x: ctx.st.erWindX || 1, z: ctx.st.erWindZ || 0 }, fog: 0.3, fogColor: 0x2e211c });
    if (rnd() < dt * 1.6) sound("rumble");

    // ---------------- LAVA ----------------
    if (ctx.st.erLava) {
      for (let i = 0; i < ctx.st.erLava.length; i++) ctx.st.erLava[i].update(dt);
    } else if (ctx.st.erStreams) {
      // legacy revert path: grow + orient each additive stream down the cone
      for (let i = 0; i < ctx.st.erStreams.length; i++) {
        const s = ctx.st.erStreams[i];
        s.len = Math.min(s.maxLen, s.len + (5 + ctx.intensity * 3) * dt);
        const ex = h.x + Math.cos(s.angle) * s.len, ez = h.z + Math.sin(s.angle) * s.len;
        const ey = floor(ex, ez);
        const dv = new THREE.Vector3(ex - h.x, ey - h.peak, ez - h.z);
        const len3 = dv.length() || 1; dv.multiplyScalar(1 / len3);
        s.mesh.position.set((h.x + ex) / 2, (h.peak + ey) / 2 + 0.45, (h.z + ez) / 2);
        s.mesh.quaternion.setFromUnitVectors(ERUPT_UP, dv);
        s.mesh.scale.set(1, len3 / STREAM_BASE_LEN, 1);
        s.mesh.material.opacity = 0.8 + 0.18 * Math.sin(CBZ.now * 0.02 + i * 1.3);
      }
      if (ctx.st.erPools) for (let i = 0; i < ctx.st.erPools.length; i++) {
        const P = ctx.st.erPools[i], s = P.s;
        const ex = h.x + Math.cos(s.angle) * s.len, ez = h.z + Math.sin(s.angle) * s.len;
        P.m.position.set(ex, floor(ex, ez) + 0.12, ez);
        if (s.len >= s.maxLen - 0.5) P.r = Math.min(8, P.r + dt * 1.1);
        else P.r = Math.max(P.r, 1.2);
        P.m.scale.set(Math.max(0.6, P.r), Math.max(0.6, P.r), 1);
        P.m.material.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.014 + i * 2.1));
      }
    }

    /* ---------------- INCANDESCENT ROCKFALL ----------------
       The wide reference photograph's flanks are STREAKED with fine fire:
       spatter thrown from the vent, bouncing and rolling down the cone,
       each block a glowing tracer. fx.dropDebris already throws on a real
       ballistic arc; `glow` makes the rock unlit ember-orange (incandescent
       by the same doctrine as the melt), and a short linger leaves the
       flank dotted with cooling embers that vanish on their own. Visual
       only — dmg 0 — the bombs below are the ones that hurt, and they
       telegraph. V2 only: the flag revert keeps its exact old look. */
    if (V) {
      ctx.st.erEmberCd = (ctx.st.erEmberCd || 0) - dt;
      if (ctx.st.erEmberCd <= 0) {
        ctx.st.erEmberCd = 0.4;
        const ea = rnd() * 6.28;
        const er = h.r * (0.35 + rnd() * 0.6);
        CBZ.fx.dropDebris({
          x: h.x + Math.cos(ea) * er, z: h.z + Math.sin(ea) * er,
          fromX: h.x + Math.cos(ea) * 1.5, fromZ: h.z + Math.sin(ea) * 1.5,
          fromY: h.peak + 2,
          size: 0.22 + rnd() * 0.3, shape: "rock", color: 0xff7e22, glow: true,
          dmg: 0, linger: 2 + rnd() * 2.5,
        });
      }
    }

    /* ---------------- PYROCLASTIC DENSITY CURRENT ----------------
       The column over-builds, loses buoyancy and DROPS — that is the
       physical event, and it is why this arrives as a bang from the summit
       rather than fading in. One at a time; the next one is armed while the
       first is still running out. */
    if (V && CBZ.CONFIG.VOLCANO_PYRO !== false) {
      ctx.st.pyroCd -= dt;
      if (!ctx.st.pyro && ctx.st.pyroCd <= 0) {
        /* THE WARNED CORRIDOR HAS TO BE THE CORRIDOR. warn() telegraphs ONE
           lane — it is the whole reason the hazard is survivable — and the
           second and third collapses then fanned +-0.55 rad off it, which at
           this island's scale walks the flow sixty metres sideways and lands
           it on people who had correctly cleared the lane they were shown.
           +-0.18 keeps every run inside the corridor that was announced. */
        const a = ctx.st.pyroBear + (pyroRuns % 2 ? 0.18 : -0.12) * (pyroRuns > 0 ? 1 : 0);
        const p = vent(h, a, 3.0);
        ctx.st.pyro = V.pyroclastic({
          x: p.x, z: p.z, groundAt: gAt(ctx), parent: root(), bearing: a,
          speed: 36 + 16 * ctx.intensity,          // ~6x a sprinting bot
          len: h.r + ctx.R * 0.95,
          width: 20 + 14 * ctx.intensity,
          height: 17 + 11 * ctx.intensity,
          tail: 58, salt: 8100 + pyroRuns * 311,
        });
        pyroRuns++;
        // a cone has to rebuild a column before it can drop another one; at
        // 7.5 s it was collapsing three or four times inside one 20 s window
        ctx.st.pyroCd = 12 - 3 * ctx.prog;
        if (CBZ.shake) CBZ.shake(1.15);
        soundAt("explosion", p.x, p.z); sound("rumble");
      }
      if (ctx.st.pyro) {
        ctx.st.pyro.update(dt);
        // the ground under the front is scoured and buried in one pass
        const fp = ctx.st.pyro.frontPos();
        if (CBZ.shake) {
          const dpx = Math.hypot(camPos().x - fp.x, camPos().z - fp.z);
          if (dpx < 70) CBZ.shake(0.5 * (1 - dpx / 70));
        }
        if (ctx.st.pyro.done) { ctx.st.pyro.dispose(); ctx.st.pyro = null; }
      }
    }

    /* ---------------- LAHAR ----------------
       Meltwater takes time to arrive, and it goes down the VALLEY, not the
       face — `channel:true` on the fall-line walk is the whole difference. */
    if (V && CBZ.CONFIG.VOLCANO_LAHAR !== false) {
      ctx.st.laharCd -= dt;
      if (!ctx.st.lahar && ctx.st.laharCd <= 0) {
        const a = ctx.st.pyroBear + Math.PI * 0.62;
        const p = vent(h, a, h.r * 0.45);
        ctx.st.lahar = V.lahar({
          x: p.x, z: p.z, groundAt: gAt(ctx), parent: root(), bearing: a,
          len: ctx.R * 0.85, width: 10 + 5 * ctx.intensity,
          speed: 9 + 5 * ctx.intensity, salt: 2600 + laharRuns * 197,
        });
        laharRuns++;
        soundAt("water", p.x, p.z);
        if (CBZ.shake) CBZ.shake(0.45);
      }
      if (ctx.st.lahar) ctx.st.lahar.update(dt);
    }

    /* ---------------- ASH AS A LOAD ---------------- */
    const AL = ctx.st.erAshLoad;
    if (AL) {
      AL.update(dt, {
        /* Metres of ash per second on the plume axis. Calibrated against the
           ladder above so ONE 20 s eruption walks the whole arc: the ground
           downwind is dusted within a second or two (the choke starts), the
           blanket is continuous downwind near the end, and the downwind roofs
           cross ASH_ROOF_FAIL at about two thirds — so "indoors saves you from
           the ash until the roof goes" is something that HAPPENS inside one
           event instead of a rule on paper. Upwind stays green, which is what
           makes the wedge readable at all. */
        rate: 0.014 + 0.024 * ctx.intensity,
        windX: ctx.st.erWindX, windZ: ctx.st.erWindZ,
        srcX: h.x, srcZ: h.z, spread: 0.16,
      });
      // ROOFS FAIL UNDER THE LOAD, through the ONE ledger. Wet ash is ~1000
      // kg/m3: a quarter-metre on a flat roof is a quarter of a tonne per
      // square metre, and light-frame roofs go at about that. Checked at 2 Hz
      // — the ledger accumulates, so the cadence only sets how fast, not if.
      ctx.st.erRoofT = (ctx.st.erRoofT || 0) - dt;
      if (ctx.st.erRoofT <= 0 && ctx.st.erRoofs) {
        ctx.st.erRoofT = 0.5;
        const wasCause = surv()._cause;
        for (let i = 0; i < ctx.st.erRoofs.length; i++) {
          const R = ctx.st.erRoofs[i];
          if (!R.b || R.b.fallen) continue;
          const dep = AL.roofDepth(R.id);
          if (dep < ASH_ROOF_FAIL) continue;
          // the killfeed has to name the ROOF, not the volcano — collapse()
          // crushes the footprint with the director's default cause
          surv()._cause = "crushed by an ash-laden roof";
          const stage = structureHit(R.b, 0.75 * (dep / ASH_ROOF_FAIL), ctx, { kind: "ashload" });
          if (R.b.fallen) { ashRoofCollapses++; AL.clearCell(R.id); }
          else if (stage >= 2) AL.clearCell(R.id);   // it shed its load as it spalled
        }
        surv()._cause = wasCause;
      }
    }

    /* ---------------- THE ACTOR PASS ----------------
       Ordered by how fast the thing kills you, which is also the order in
       which the world gives you a chance: the flow first (none), then the
       crater and the lava (see it, don't stand in it), then the lahar
       (survivable if you get out of the channel), then the ash (survivable
       indefinitely if you are indoors). */
    const P = ctx.st.pyro, LH = ctx.st.lahar, LV = ctx.st.erLava;
    surv().forEachActor(function (a) {
      const ax = a.pos.x, az = a.pos.z;
      // 1) PYROCLASTIC FLOW — zero survival in the path, no exceptions.
      //    A roof is not shelter from 600 C at 130 m/s and pretending it is
      //    would be the worst lie in the file.
      if (P) {
        const zone = P.contains(ax, az);
        if (zone) {
          if (a.isPlayer) incinerate(1, zone === 1 ? 1.9 : 2.6);
          const fp = P.frontPos();
          /* THE HEAD IS ABSOLUTE. THE TAIL IS NOT.
             Both zones used to be 1e6, which made the whole ~50 m lane behind
             the front an instant kill and turned one pass of one flow into
             most of a lobby. The head keeps its 1e6 and should: there is no
             surviving a wall of 600 C rock at 130 m/s, and pretending a roof
             helps would be the worst lie in the file. The trailing cloud is
             hot gas — lethal, quickly, but it is the kind of lethal you can
             be dragged out of, so it prices as damage over time. Clipped by
             the edge as it sweeps past, you live and you are wrecked; stood
             in it, you die in about a second and a half. */
          if (zone === 1) {
            surv().hurt(a, 1e6, {
              cause: "incinerated by the pyroclastic flow",
              fromX: fp.x, fromZ: fp.z, fling: 9,
            });
            return;
          }
          surv().hurt(a, scale(30, ctx) * dt, {
            cause: "asphyxiated in the ash cloud", fromX: fp.x, fromZ: fp.z,
          });
          if (a.dead) return;
        }
      }
      // 2) the vent itself
      if (Math.hypot(ax - h.x, az - h.z) < 3.4) { surv().hurt(a, 1e6, { cause: "swallowed by the crater", fromX: h.x, fromZ: h.z }); return; }
      // 3) LAVA — what kills you is exactly what glows
      if (LV) {
        for (let i = 0; i < LV.length; i++) if (LV[i].hitTest(ax, az)) {
          const t = LV[i].tip;
          surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: t.x, fromZ: t.z });
          return;
        }
      } else if (ctx.st.erStreams) {
        for (let i = 0; i < ctx.st.erStreams.length; i++) if (streamHit(ax, az, h, ctx.st.erStreams[i])) { surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: h.x, fromZ: h.z }); return; }
        if (ctx.st.erPools) for (let i = 0; i < ctx.st.erPools.length; i++) {
          const PL = ctx.st.erPools[i];
          if (PL.r > 0.7 && Math.hypot(ax - PL.m.position.x, az - PL.m.position.z) < PL.r * 0.85) { surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: PL.m.position.x, fromZ: PL.m.position.z }); return; }
        }
      }
      // 4) LAHAR — it CARRIES you, and then it sets around you
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
      /* 5) ASHFALL — glass in the lungs, and a roof is a real answer to it.
         THE ASH FIELD IS THE ONLY AUTHORITY ON WHERE THERE IS ASH — and
         with VOLCANO_ASH_LOAD now defaulting OFF (owner, 2026-08-16) there
         is usually no ash at all, so there is usually no choke. The old
         geometric downwind wedge that stood in when the field was absent is
         deleted rather than resurrected: it choked people with nothing on
         screen to explain it, which is exactly the death-by-arithmetic the
         owner reported. No picture, no damage. */
      if (!sheltered(a)) {
        let choke = 0;
        /* AND IT IS A GRADIENT, NOT A SWITCH. The measurement that found this:
           with the bombs throttled and the flow's tail made survivable, ONE
           beat of the storyboard still killed 68 of the 100 in eleven seconds
           — and it was this line. A binary test at 6 mm meant a DUSTING did
           the same 11 damage a second as half a metre of the stuff, so within
           a few seconds of the plume establishing, every unsheltered actor on
           the downwind half of the island was on the same clock and the island
           emptied. That is the owner's "kills way too many people" with no
           hazard on screen doing it.

           A gradient makes the ash a place you leave rather than a timer you
           are on: nothing at the edge of the fall, and even standing in the
           worst of it you have the better part of the eruption to move. The
           roofs are still what actually kills indoors, through the ledger. */
        if (AL) {
          /* THE RAMP HAS TO OUTRUN THE FALL. This plume lays down ~0.2 m on
             its axis inside eight seconds — the rate is calibrated so roofs
             actually reach ASH_ROOF_FAIL inside one event, and that feature is
             worth keeping — so a gradient that saturated at 10 cm was back to
             being a switch by the time anyone could walk out of it. At 35 cm
             the worst ground on the island still leaves you most of the
             eruption, and everywhere else is a real gradient you can read off
             the colour of the ground you are standing on. */
          const d = AL.depthAt(ax, az);
          choke = Math.max(0, Math.min(1, (d - ASH_DOT_DEPTH) / 0.35));
        }
        if (choke > 0) surv().hurt(a, scale(3.4, ctx) * choke * dt, { cause: "choked by volcanic ash" });
      }
    });

    /* ---------------- LAVA BOMBS ----------------
       OWNER, 2026-08-13: the volcano "kills way too many people and randomly
       not even with physics". This block was the single worst offender and it
       was wrong in all three of those ways at once.

       ONE BOMB EVERY 0.6-1.0 s, for the whole twenty-second window, is
       twenty-odd bombs. Each was placed at arena.randomPoint(8, R) — a
       UNIFORM draw over the entire island, so a bomb was as likely to land on
       the far beach as on the mountain's own flank. Each then materialised at
       y = 34 directly above that point and fell straight down: there was no
       trajectory to read, no direction to run from, and nothing on screen
       connecting the rock to the volcano that supposedly threw it. And each
       killed twice over — `dmg: 999` is instakill on contact, and the landing
       called survBlast with r: 7 and no dmg, which hurtRadius resolves to 1e6
       with NO falloff. A guaranteed seven-metre circle of death, twenty times,
       everywhere.

       So: it is thrown, from the crater, on a real arc that you can watch
       (fx.dropDebris solves vx/vy/vz for the range against the shared
       gravity); it lands where ballistics puts it, which is CLUSTERED ON THE
       MOUNTAIN and thinning with distance, not spread evenly over the sea's
       edge; there are a third as many; the telegraph outlives the flight; and
       only a direct hit is fatal — the blast around it is now a real number
       that falls off, so being near one is an injury and standing under one
       is a death. */
    ctx.st.erBombCd -= dt;
    if (ctx.st.erBombCd <= 0) {
      ctx.st.erBombCd = 3.4 - 1.1 * ctx.prog;
      /* BALLISTICS DECIDES WHERE IT LANDS. Bearing is uniform, range is not:
         `pow(rnd, 1.7)` piles the throws up on the cone's own flanks and lets
         only the rare one carry to the town. That distribution IS the
         physics — a vent throws most of its mass short. */
      const ba = rnd() * 6.28;
      const rng2 = h.r * 0.5 + Math.pow(rnd(), 1.7) * (ctx.R * 0.82);
      const bx = h.x + Math.cos(ba) * rng2, bz = h.z + Math.sin(ba) * rng2;
      const mk = CBZ.fx.groundMarker(bx, bz, 5.5, 0xff7a30); mk.set(1);
      const vp = vent(h, ba, 2.2);
      const flight = Math.max(0.9, 0.75 + rng2 / 26);
      bombsThrown++;
      CBZ.fx.dropDebris({
        x: bx, z: bz, fromX: vp.x, fromZ: vp.z, fromY: h.peak + 3.5,
        size: 1.7, color: 0x2e2622, shape: "rock", dmg: 999, keep: true,
        onLand: function (x, z) {
          mk.dispose();
          /* A LAVA BOMB IS A ROCK ARRIVING AT SPEED — the bus's `kinetic` row,
             priced by mass and impact velocity, which is why a late-round bomb
             hits harder without a second number typed here. What changed is
             the ROSTER damage: an explicit dmg means hurtRadius stops
             resolving to 1e6, so the splash maims and the rock kills. */
          survBlast("kinetic", x, z, {
            r: 8, dmg: scale(34, ctx), cause: "caught by a volcanic bomb", ctx: ctx,
            mass: 900, speed: 55, struct: 0.4, structR: 12,
            color: 0xff7a30, sfx: "punch", flash: 0.25, knockback: 12, fling: 6,
          });
        },
      });
      // the marker outlives the flight even if the rock never lands cleanly
      setTimeout0(ctx, flight + 1.2, function () { mk.dispose(); });
    }
  }

  function endEruption(ctx) {
    if (!ctx.st.erupting) return;
    if (volAliveAtStart >= 0) {
      try { volcanoDeaths += Math.max(0, volAliveAtStart - surv().aliveCount()); } catch (e) {}
      volAliveAtStart = -1;
    }
    if (ctx.st.erFountain) ctx.st.erFountain.dispose();
    if (ctx.st.erSmoke) ctx.st.erSmoke.dispose();
    if (ctx.st.erColumn) { ctx.st.erColumn.dispose(); ctx.st.erColumn = null; }
    if (ctx.st.erSmokeLit) { ctx.st.erSmokeLit.dispose(); ctx.st.erSmokeLit = null; }
    if (ctx.st.erVent) { ctx.st.erVent.dispose(); ctx.st.erVent = null; }
    if (ctx.st.erCrater) rmMesh(ctx.st.erCrater);
    (ctx.st.erStreams || []).forEach((s) => rmMesh(s.mesh));
    ctx.st.erStreams = null;
    (ctx.st.erPools || []).forEach((P) => rmMesh(P.m));
    ctx.st.erPools = null;
    /* THE LAVA DOES NOT VANISH — IT DIES WHERE IT STANDS. The old line here
       disposed every flow the frame the eruption ended: a glowing river
       popped off the hillside mid-frame. quench() is the physics (the
       supply stops, THEN it chills black over ~8 s, ember seams last) and
       the five stems ride ONE composite scar so the eviction cap below
       counts eruptions, not stems. Cold rock kills nothing: hitTest goes
       false on quench, and this list is nulled out of the actor pass. */
    if (ctx.st.erLava) {
      const flows = ctx.st.erLava;
      if (flows.length && flows.every((f) => typeof f.quench === "function")) {
        flows.forEach((f) => f.quench());
        volScars.push({
          update(dt) { for (let i = 0; i < flows.length; i++) flows[i].update(dt); },
          dispose() { for (let i = 0; i < flows.length; i++) { try { flows[i].dispose(); } catch (e) {} } },
        });
      } else {
        flows.forEach((f) => f.dispose());
      }
      ctx.st.erLava = null;
    }
    if (ctx.st.pyro) { ctx.st.pyro.dispose(); ctx.st.pyro = null; }
    /* THE SCARS OUTLIVE THE EVENT, and that is the point: a lahar SETS, and
       ash does not wash off between disasters. Both stay in the world for the
       rest of the match and are cleared when the mode is torn down. */
    if (ctx.st.lahar) { volScars.push(ctx.st.lahar.harden()); ctx.st.lahar = null; }
    if (ctx.st.erAshLoad) { volScars.push(ctx.st.erAshLoad); ctx.st.erAshLoad = null; }
    /* A SCAR IS A MEMORY, NOT A LEAK. Two eruptions can legitimately happen
       in one match (the volcano, plus the earthquake's surprise one), and a
       third would only be stacking a second full ash field on top of an
       identical one. Oldest out at four. */
    while (volScars.length > 4) { const old = volScars.shift(); try { old.dispose(); } catch (e) {} }
    ctx.st.erRoofs = null;
    ctx.st.erWindX = ctx.st.erWindZ = null;
    ctx.st.erupting = false;
  }

  /* The scars are the one thing here that survives its own disaster, so they
     need their own teardown. 28.06 sits immediately after the mode-exit hook
     that puts the sea and the weather back. */
  CBZ.onAlways(28.06, function (dt) {
    const inSurv = CBZ.game.mode === "survival" && !!(CBZ.surv && CBZ.surv.arena);
    if (volScars.length) {
      if (!inSurv) {
        for (let i = 0; i < volScars.length; i++) { try { volScars[i].dispose(); } catch (e) {} }
        volScars.length = 0;
      } else {
        // a set deposit still has to tick: it is finishing its colour walk
        for (let i = 0; i < volScars.length; i++) { try { volScars[i].update(dt, null); } catch (e) {} }
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
     information this disaster has. A travelling front for the density
     current (the map already draws {line:true} for the tsunami's wall) and a
     ring on the mud head. During the WARNING the lane is still marked — that
     is the entire point of telegraphing an unsurvivable hazard. */
  function pushEruptHazards(st, out) {
    const V = vfx();
    const lane = st.pyroLane;
    if (V && lane) {
      const s = st.pyro ? Math.min(st.pyro.frontS, lane.total) : 0;
      const P = new THREE.Vector3();
      V.pathAt(lane, s, P);
      const i = Math.max(0, Math.min(lane.pts.length - 2, Math.floor(s / lane.seg)));
      const a = lane.pts[i], b = lane.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, dl = Math.hypot(dx, dz) || 1;
      out.push({ line: true, x: P.x, z: P.z, dx: dx / dl, dz: dz / dl });
    }
    if (st.lahar) {
      const V2 = new THREE.Vector3();
      if (V) { V.pathAt(st.lahar.path, st.lahar.length, V2); out.push({ x: V2.x, z: V2.z, r: 9, fill: false }); }
    }
  }

  // threat from an active eruption (shared by quake + volcano threat())
  function eruptThreat(x, z, ctx) {
    if (!ctx.st.erupting) return 0;
    const h = ctx.arena.hills[0];
    let t = 0.12;   // ambient: bombs can fall anywhere
    if (Math.hypot(x - h.x, z - h.z) < 6) t = Math.max(t, 0.9);
    // THE FLOW OUTRANKS EVERYTHING. Nothing else on this mountain is worth
    // fleeing while a density current is coming down your lane.
    if (ctx.st.pyro) t = Math.max(t, ctx.st.pyro.threatAt(x, z));
    if (ctx.st.erLava) {
      for (let i = 0; i < ctx.st.erLava.length; i++) if (ctx.st.erLava[i].hitTest(x, z)) { t = Math.max(t, 0.97); break; }
    }
    (ctx.st.erStreams || []).forEach((s) => {
      const dx = x - h.x, dz = z - h.z;
      const along = dx * Math.cos(s.angle) + dz * Math.sin(s.angle);
      if (along >= -1 && along <= s.len + 1) { const perp = Math.abs(-dx * Math.sin(s.angle) + dz * Math.cos(s.angle)); if (perp < STREAM_HALF_W + 2.5) t = Math.max(t, Math.min(0.98, 1 - (perp - STREAM_HALF_W) / 2.5)); }
    });
    (ctx.st.erPools || []).forEach((P) => {
      if (P.r > 0.7) { const d = Math.hypot(x - P.m.position.x, z - P.m.position.z); if (d < P.r + 3) t = Math.max(t, Math.min(0.95, 1 - (d - P.r * 0.85) / 3)); }
    });
    if (ctx.st.lahar && ctx.st.lahar.hitTest(x, z)) t = Math.max(t, 0.8);
    // no downwind-wedge term any more: with the ash gone (2026-08-16) there
    // is nothing there to flee, and bots emptying a visibly clean half of the
    // island read as broken pathing
    return t;
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
  const QK_MAIN = 14;              // seconds of mainshock inside activeSecs
  const QK_SHOCKS = [3.4, 7.2, 11.0];   // aftershocks, seconds into the tail
  let qkChained = 0, qkGasFires = 0, qkLines = 0;

  // Does the shared core exist? Every call site below is `qk() ? … : <the old
  // behaviour>`, so a build that never loaded systems/quake.js still plays the
  // quake it always played — that is the degrade-safe rule, not a nicety.
  function qk() { return CBZ.quake || null; }
  // one field off the shared core's ratchet, degrade-safe (0 when absent)
  function qkNum(k) {
    if (!CBZ.quakeAudit) return 0;
    try { const a = CBZ.quakeAudit(); return Number(a && a[k]) || 0; } catch (e) { return 0; }
  }

  /* THE STRUCTURAL STAGE, as one 0..1 number the shedder can read. It is the
     SAME `_dmg` the ledger above accumulates, so a building the tsunami
     already spalled sheds harder in the next quake without either event
     knowing about the other. */
  function qkSeverity(b) { return Math.max(0, Math.min(1, (b._dmg || 0) / 1.05)); }

  /* DROP, COVER, HOLD ON — made VISIBLE.
     A third of the crowd are "indoors" people and go for the nearest heavy
     table; the rest keep their own brain, which fleeVector already steers into
     the open. Two populations doing two correct things is what turns a rule
     into a thing you watch happen. */
  function qkTakeCover(dt, ctx) {
    const Q = qk(); if (!Q) return;
    const bots = CBZ.bots; if (!bots) return;
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (!a || a.dead || !a.pos) continue;
      if (CBZ.body && CBZ.body.busy(a)) continue;
      if (i % 3 !== 0) continue;                       // the open-ground two thirds
      let anchor = a._quakeAnchor;
      if (anchor === undefined || anchor === null) {
        anchor = Q.coverNear(a.pos.x, a.pos.z, a.pos.y, 18);
        a._quakeAnchor = anchor || false;              // false = "looked, found none"
      }
      if (!anchor) continue;
      Q.duckUnder(a, anchor, dt, 10);
    }
  }
  function qkStandAll() {
    const Q = qk(); if (!Q) return;
    const bots = CBZ.bots; if (!bots) return;
    for (let i = 0; i < bots.length; i++) { Q.standUp(bots[i]); if (bots[i]) bots[i]._quakeAnchor = null; }
  }

  /* THE AFTERMATH — the secondary killers, fired ONCE when the mainshock
     stops. Both are delegated: the fire goes through CBZ.structure's BURNING
     state where a real lot exists (so spread comes free and no second fire
     model is written), and the pole comes down through the shared core. */
  function qkAftermath(ctx) {
    const Q = qk(); if (!Q) return;
    const hurt = ctx.arena.fragile
      .filter(function (b) { return !b.fallen && (b._dmg || 0) > 0.25; })
      .sort(function (a, b) { return (b._dmg || 0) - (a._dmg || 0); });
    const n = 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < Math.min(n, hurt.length); i++) {
      if (Q.gasFire(hurt[i], { gy: hurt[i].gy })) qkGasFires++;
    }
    // TWO POLES, and they fall AWAY from the buildings — i.e. across exactly
    // the open ground the sensible half of the crowd is standing on. That is
    // the point: "get clear of the structures" is not the whole answer.
    for (let i = 0; i < 2; i++) {
      const px = ctx.cx + (rnd() - 0.5) * ctx.R * 1.6, pz = ctx.cz + (rnd() - 0.5) * ctx.R * 1.6;
      const P = Q.poleNear(px, pz, 400);
      if (P && Q.dropLine({ pole: P })) qkLines++;
    }
  }

  function QUAKE_DEF() {
    return {
      name: "EARTHQUAKE", emoji: "", warnSecs: 5, activeSecs: 26, gap: 7,
      cause: "crushed under collapsing rubble", tint: 0x8a7f6c,
      // THE FORESHOCK IS THE WARNING. A real quake announces itself by rattling
      // everything loose in the room, so the telegraph is a rising tremor with
      // the props visibly buzzing on it — no line of text can say "get out from
      // under that" as fast as the building itself shivering.
      warn(ctx) { narrate("hint", "The ground is rumbling…", 2.2); sound("rumble"); ctx.st.pre = 0; },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        if (CBZ.shake) CBZ.shake(0.02 + 0.10 * k * k);
        rattleProps(ctx, 0.02 + 0.05 * k);
        ctx.st.pre = (ctx.st.pre || 0) - dt;
        if (ctx.st.pre <= 0) { ctx.st.pre = 1.4 - k; soundAt("rumble", ctx.cx, ctx.cz); }
        // the sensible ones are already moving before the first pane falls
        if (k > 0.45) qkTakeCover(dt, ctx);
      },
      // during the sirens the danger is ALREADY the buildings — bots start
      // clearing the streets before the first collapse
      warnThreat(x, z, ctx) { return DEFS.quake.threat(x, z, ctx); },
      start(ctx) {
        ctx.st.T = 0;
        // per-EVENT counters: the audit answers "what did this quake do"
        qkChained = qkGasFires = qkLines = 0;
        ctx.st.dust = CBZ.fx.particleCloud({ mode: "rise", color: 0xb6a892, count: 160, radius: ctx.R, top: 8, size: 0.32, opacity: 0.34, vMin: 1, vMax: 3 });
        ctx.st.dust.setActive(0.7);
        // only SOME buildings come down — a quake doesn't flatten the whole city.
        // shuffle, then cap to a fraction so plenty are left standing.
        const standing = ctx.arena.fragile.filter((b) => !b.fallen).sort(() => rnd() - 0.5);
        ctx.st.order = standing.slice(0, Math.max(1, Math.ceil(standing.length * 0.3)));
        ctx.st.next = 1.2;
        // and EVERY standing structure takes load, so a survivor of this quake
        // is a wounded building when the next disaster arrives
        for (let i = 0; i < ctx.arena.fragile.length; i++) structureHit(ctx.arena.fragile[i], 0.22 + 0.2 * ctx.intensity, ctx, { kind: "quake" });
        // the shared core needs to know WHICH structures are shedding, so its
        // facade-proximity test (the thing that makes standing next to a wall
        // lethal and the open square safe) has something to measure against
        if (qk()) {
          qk().begin(ctx.arena.fragile);
          // fire eats the building's OWN ledger — this file's, not the core's
          qk().hooks.structDamage = function (b, amt) { structureHit(b, amt, ctx, { kind: "fire" }); };
        }

        /* ---- THE SUBDUCTION BRANCH ---------------------------------------
           One rupture, two consequences, and WHERE it broke decides which.
           Offshore + big → the sea. Inland → the magma. Neither is guaranteed,
           because a quake that always ends in a tsunami stops being a quake. */
        ctx.st.chain = null;
        if (CBZ.CONFIG.QUAKE_CHAIN !== false) {
          const ang = rnd() * 6.28, off = 0.3 + rnd() * 0.95;
          ctx.st.epX = ctx.cx + Math.cos(ang) * ctx.R * off;
          ctx.st.epZ = ctx.cz + Math.sin(ang) * ctx.R * off;
          const offshore = off > 0.7;
          if (offshore && ctx.intensity > 0.42 && rnd() < 0.7) ctx.st.chain = "tsunami";
          else if (rnd() < 0.4) ctx.st.chain = "eruption";
        } else if (rnd() < 0.4) ctx.st.chain = "eruption";
        ctx.st.eruptArmed = ctx.st.chain === "eruption";
        ctx.st.eruptAt = 4 + rnd() * 5;     // seconds into the quake it would hit
        ctx.st.shockN = 0;
      },
      active(dt, ctx) {
        ctx.st.T = (ctx.st.T || 0) + dt;
        const T = ctx.st.T, tail = T - QK_MAIN;
        // The mainshock runs at full amplitude; the tail is quiet ground with
        // discrete aftershocks punched into it. A quake that shakes evenly for
        // its whole duration reads as a machine, not as a fault.
        let amp;
        if (tail < 0) amp = 0.16 + 0.5 * ctx.intensity * (0.55 + (T / QK_MAIN) * 0.45);
        else {
          amp = 0.02;
          for (let i = 0; i < QK_SHOCKS.length; i++) {
            const d = tail - QK_SHOCKS[i];
            if (d >= 0 && d < 2.2) amp = Math.max(amp, (0.42 - i * 0.11) * (1 - d / 2.2) * (0.6 + ctx.intensity));
          }
        }
        if (CBZ.shake) CBZ.shake(amp);
        ctx.st.dust.setActive(tail < 0 ? 0.7 : 0.3); ctx.st.dust.update(dt, camPos().x, 0, camPos().z);
        if (rnd() < dt * (tail < 0 ? 1.1 : 0.25)) sound("rumble");

        /* ---- SHEDDING: what actually kills people ------------------------
           Every standing structure sheds in proportion to how close it is to
           coming down, so the debris field IS the damage readout — and the
           strip of ground next to a wounded tower is where you die. */
        const Q = qk();
        if (Q && amp > 0.05) {
          const f = ctx.arena.fragile;
          for (let i = 0; i < f.length; i++) {
            const b = f[i];
            if (b.fallen) continue;
            Q.shedTick(b, dt, { sev: qkSeverity(b), gain: Math.min(1.6, amp * 2.6), gy: b.gy });
          }
        }
        qkTakeCover(dt, ctx);

        // spaced-out collapses (slower cadence; only the capped subset falls)
        ctx.st.next -= dt;
        if (ctx.st.next <= 0 && ctx.st.order.length) {
          ctx.st.next = tail < 0 ? (1.5 - 0.6 * (T / QK_MAIN)) : 2.6;
          // through the ledger, never straight to collapse: a tower already
          // spalled by an earlier disaster goes down on less than a fresh one
          structureHit(ctx.st.order.pop(), 1.2, ctx, { kind: "quake" });
        }
        rattleProps(ctx, (tail < 0 ? 0.10 : 0.02) + 0.10 * ctx.intensity * (amp > 0.2 ? 1 : 0.1));

        // surprise eruption part-way through (if this rupture went inland)
        if (ctx.st.eruptArmed && !ctx.st.erupting) {
          ctx.st.eruptAt -= dt;
          if (ctx.st.eruptAt <= 0) { startEruption(ctx); qkChained++; }
        }
        tickEruption(dt, ctx);
        tick0(ctx, dt);

        // ---- THE MAINSHOCK STOPS, AND THE SECOND WAVE OF DEATHS STARTS ----
        if (tail >= 0 && !ctx.st.aftermath) { ctx.st.aftermath = 1; qkAftermath(ctx); }
        // AFTERSHOCKS re-shed the weakened, which is when the rest go down
        if (tail >= 0) {
          while (ctx.st.shockN < QK_SHOCKS.length && tail >= QK_SHOCKS[ctx.st.shockN]) {
            ctx.st.shockN++;
            sound("rumble");
            const decay = 1 - (ctx.st.shockN - 1) * 0.3;
            const f2 = ctx.arena.fragile;
            for (let i = 0; i < f2.length; i++) {
              const b = f2[i];
              if (b.fallen) continue;
              structureHit(b, 0.14 * decay * (0.6 + ctx.intensity), ctx, { kind: "aftershock" });
              if (Q) Q.shed(b, { sev: qkSeverity(b), count: 2 + ((qkSeverity(b) * 7) | 0), gy: b.gy });
            }
          }
        }

        /* ---- THE HANDOFF -------------------------------------------------
           The drawdown starts while the ground is still moving: the sea pulls
           back over the aftershocks, and only then does the director hand the
           run to the tsunami. Forcing while `dir.t` still has slack is what
           keeps the director's own endActive() from running against a def it
           has already retired — so this is the LAST thing active() does. */
        if (ctx.st.chain === "tsunami" && tail > 2.5) {
          const u = Math.min(1, (tail - 2.5) / 5.5);
          surgeSet(-2.8 * ease(u));
          if (tail > 9.5 && !ctx.st.handed && dir.t > 1.4 && CBZ.disasters && CBZ.disasters.force) {
            ctx.st.handed = 1; qkChained++;
            CBZ.disasters.force("flood");
            return;
          }
        }
      },
      end(ctx) {
        if (ctx.st.dust) { ctx.st.dust.dispose(); ctx.st.dust = null; }
        endEruption(ctx);
        qkStandAll();
        if (qk()) { qk().hooks.structDamage = null; qk().end(); }
        // an armed chain that never fired must not leave the sea sucked out
        if (ctx.st.chain === "tsunami" && !ctx.st.handed) surgeSet(0);
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
  function collapse(b, ctx) {
    if (!b || b.fallen) return; b.fallen = true;
    b._dmg = 1.2;
    // yank ALL of this building's walls (colliders) and floors/stairs/roof
    // (platforms) so survivors can run AND fall through the rubble
    if (b.colliders) for (const c of b.colliders) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (b.platforms) for (const p of b.platforms) { const i = CBZ.platforms.indexOf(p); if (i >= 0) CBZ.platforms.splice(i, 1); }
    // crush anyone in the footprint
    surv().hurtRadius(b.x, b.z, Math.max(b.w, b.d) * 0.62, 1e6);
    // blow every window out of the building as it goes
    if (CBZ.shatterGlass) CBZ.shatterGlass(b.x, b.z, Math.max(b.w, b.d) * 0.85);
    // animate the whole structure crumbling as one piece — walls, every floor,
    // AND the roof sink and tilt together (handled by the transient ticker)
    fallingBuildings.push({ group: b.group, t: 0, h: b.h, tilt: (rnd() - 0.5) * 0.9 });
    // a real rubble field that NEVER cleans up (keep:true) — lots of chunks of
    // varied concrete tones piled across (and a touch beyond) the footprint.
    const RUBBLE = [0x70757e, 0x8b9097, 0x5c6168, 0xb9bec6, 0x9aa0a8];
    const n = 22 + (rnd() * 14 | 0) + (b.h > 24 ? 16 : 0);   // taller towers leave more
    for (let i = 0; i < n; i++) {
      CBZ.fx.dropDebris({
        x: b.x + (rnd() - 0.5) * b.w * 1.4, z: b.z + (rnd() - 0.5) * b.d * 1.4,
        fromY: b.h * (0.15 + rnd() * 0.85), vy: -1 - rnd() * 4,
        size: 0.7 + rnd() * 2.2, color: RUBBLE[(rnd() * RUBBLE.length) | 0],
        dmg: i < 6 && ctx ? scale(30, ctx) : 0, keep: true,
      });
    }
    if (CBZ.shake) CBZ.shake(0.6); sound("collapse");
  }
  const fallingBuildings = [];

  // ---- a car ripped loose by the tsunami: pull its collider, hurl it in the
  //      wave's travel direction with an upward kick + spin; the ticker below
  //      integrates gravity until it crashes back down to rest as wreckage ----
  const flungCars = [];
  function flingCar(car, dirx, dirz, force, up) {
    if (!car || car.flung) return; car.flung = true;
    const i = CBZ.colliders.indexOf(car.collider); if (i >= 0) CBZ.colliders.splice(i, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    flungCars.push({
      car, g: car.group,
      vx: dirx * force + (rnd() - 0.5) * 2, vy: up + rnd() * 3, vz: dirz * force + (rnd() - 0.5) * 2,
      sx: (rnd() - 0.5) * 6, sz: (rnd() - 0.5) * 6, settled: false,
    });
    CBZ.fx.dropDebris({ x: car.group.position.x, z: car.group.position.z, fromY: 2, vy: 4, size: 0.6, color: 0xbfe0ff, linger: 0.4 });
  }

  // ---- WILDFIRE: real flames + glow + smoke + scorch on each burning tree ----
  function addTreeFire(t) {
    if (t.fire) return;
    const g = new THREE.Group();
    const flame = (c, s, y) => {
      const m = new THREE.Mesh(new THREE.ConeGeometry(s, s * 2.4, 6),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.position.y = y; m.renderOrder = 8; g.add(m); return m;
    };
    t.fireMeshes = [flame(0xff3a0e, 2.2, 0.5), flame(0xff7a1e, 1.5, 1.7), flame(0xffd24a, 0.85, 2.8)];
    g.position.set(t.x, floor(t.x, t.z) + 2.6, t.z);
    root().add(g); t.fire = g;
    t.scorch = disc(t.x, t.z, 0x140d08, 0.0, 0.04);
    t.scorch.scale.set(3.4, 3.4, 1);
    // additive orange glow pooling on the ground around the base
    t.glow = disc(t.x, t.z, 0xff5a14, 0.0, 0.05);
    t.glow.material.blending = THREE.AdditiveBlending;
    t.glow.scale.set(6, 6, 1);
    if (t.foliage && t.foliage.material) { t.foliage.material.color.setHex(0xff5a1a); if (t.foliage.material.emissive) { t.foliage.material.emissive.setHex(0xff4a10); t.foliage.material.emissiveIntensity = 0.9; } }
  }
  function flickerTreeFire(t) {
    if (!t.fire) return;
    const f = 0.75 + 0.35 * Math.sin(CBZ.now * 0.02 + t.x);
    for (let k = 0; k < t.fireMeshes.length; k++) {
      const m = t.fireMeshes[k];
      m.scale.set(1 + 0.12 * Math.sin(CBZ.now * 0.03 + k), f * (1 + 0.12 * Math.sin(CBZ.now * 0.035 + k * 2)), 1);
      m.material.opacity = 0.55 + 0.32 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.025 + k + t.z));
    }
    if (t.scorch) t.scorch.material.opacity = Math.min(0.55, t.scorch.material.opacity + 0.4 * 0.016);
    if (t.glow) t.glow.material.opacity = 0.4 + 0.28 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.022 + t.x));
  }
  function removeTreeFire(t) {
    if (t.fire) { t.fire.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(t.fire); t.fire = null; t.fireMeshes = null; }
    if (t.scorch) { rmMesh(t.scorch); t.scorch = null; }
    if (t.glow) { rmMesh(t.glow); t.glow = null; }
  }
  function ignite(t) {
    if (t.burnt || t.burning) return;
    t.burning = 2.5 + rnd() * 2;
    addTreeFire(t);
  }
  function burnOut(t) {
    t.burning = 0; t.burnt = true;
    removeTreeFire(t);
    if (t.foliage && t.foliage.material) { t.foliage.material.color.setHex(0x1a1410); if (t.foliage.material.emissive) t.foliage.material.emissive.setHex(0x000000); }
    if (t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x140d08);
    if (CBZ.fx) CBZ.fx.dropDebris({ x: t.x, z: t.z, fromY: floor(t.x, t.z) + 3, vy: 2, size: 0.5, color: 0x2a2622, linger: 0.6 });
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
        surv().hurt(a, 18 + 62 * k * k, { fromX: bx, fromZ: bz, cause: "killed by the ground current" });
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

     LIGHTNING_FX_V2=false restores the legacy fireball verbatim, below. ------ */
  function strike(x, z, ctx, at) {
    if (CBZ.CONFIG.LIGHTNING_FX_V2 !== false && CBZ.lightningStrike) {
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
      if (at.kind === "tree" && CBZ.fx && CBZ.fx.dropDebris) {
        const t = at.ref, base = floor(at.x, at.z);
        for (let i = 0; i < 4; i++) {
          CBZ.fx.dropDebris({ x: at.x + (rnd() - 0.5) * 2.4, z: at.z + (rnd() - 0.5) * 2.4,
            fromY: base + 2 + rnd() * 2.5, vy: 3 + rnd() * 3, size: 0.28 + rnd() * 0.3,
            color: 0x4a3520, linger: 5 });
        }
        if (t && t.trunk && t.trunk.material) t.trunk.material.color.setHex(0x2a1c10);
      }
      conduct(at, ctx);
      return;
    }

    // ---- LEGACY (LIGHTNING_FX_V2=false): the airstrike-composer fireball ----
    survBlast("kinetic", x, z, {
      r: 5, cause: "struck by lightning", ctx: ctx, up: 0.6,
      mass: 60, speed: 120, struct: 0.18, structR: 9, flash: 0, quiet: true,
      knockback: 11, fling: 5, color: 0xddeeff, sfx: "thunder",
    });
    CBZ.fx.flash(0.7, 0xddeeff);
    if (CBZ.shake) CBZ.shake(0.6);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 40, 0.5), new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 1, depthWrite: false }));
    bolt.position.set(x, floor(x, z) + 20, z); root().add(bolt);
    ctx.st.bolts.push({ mesh: bolt, life: 0.16 });
    sound("thunder");
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
  /* THE COLLAPSE, STAGED. One call per sinkhole and the primitive drives its
     own arc; all this passes is the seam only this file can supply — the
     ENTRAINMENT of the arena's own cars, through the flingCar this file
     already owns, aimed inward and down. */
  function stageHole(ctx, x, z, r) {
    if (!CBZ.groundShaftCollapse) { return { x: x, z: z, r: r, legacy: openHole(ctx, x, z, r) }; }
    return CBZ.groundShaftCollapse(x, z, {
      r: r, depth: r * 4.2, surface: "soil",
      warnSecs: 3.4, growSecs: 4.2,
      entrain(hx, hz, hr) {
        const cars = ctx.arena.cars || [];
        for (let i = 0; i < cars.length; i++) {
          const c = cars[i];
          if (!c || c.flung || !c.group) continue;
          const dx = c.group.position.x - hx, dz = c.group.position.z - hz;
          const d = Math.hypot(dx, dz);
          if (d > hr * 1.15) continue;
          const m = d || 1;
          flingCar(c, -dx / m, -dz / m, 5 + rnd() * 4, -3);   // inward and DOWN
        }
      },
    });
  }
  /* WHERE A SINKHOLE MAY OPEN. The law lives in world/groundshaft.js
     (slope over the whole footprint, sampled off this arena's own ground) —
     this only says how far apart they are and how big this round's is. A site
     that fails is NOT relocated to somewhere flatter-looking: no site, no hole.
     That is what keeps shaftAudit().holesOnSlopes at zero by construction. */
  function sinkSite(ctx, warnSecs) {
    if (!CBZ.groundShaftSite) {
      const p = ctx.arena.randomPoint(0, ctx.R * 0.8);
      const h = openHole(ctx, p.x, p.z, 4 + scale(2, ctx));
      if (h) (ctx.st.holes = ctx.st.holes || []).push(h);
      return null;
    }
    const r = 7 + scale(3.4, ctx);
    /* CLEAR OF THE OTHER HOLES IS LAW TOO, AND IT USED NOT TO BE. Two shafts
       cut into each other are not two sinkholes: the lips carve through one
       another, and the floor query — which answers from the FIRST live shaft
       that contains the point — starts handing out the neighbour's stair, so
       the middle of a 58 m hole reports as 1.6 m deep. Caught by
       tools/sinkhole-check.mjs asserting that floorAt at a mouth's centre drops
       most of the shaft's depth. */
    function nearAnotherHole(x, z) {
      const S = CBZ.groundShafts || [];
      for (let i = 0; i < S.length; i++) if (Math.hypot(x - S[i].x, z - S[i].z) < S[i].r + r + 12) return true;
      const P = ctx.st.seqs || [];
      for (let i = 0; i < P.length; i++) if (Math.hypot(x - P[i].x, z - P[i].z) < P[i].r + r + 12) return true;
      return false;
    }
    /* THE BUILDINGS MUST BE STANDING AT THE LIP, NOT IN THE HOLE. That is
       the whole read of the reference photograph — a tower whose footing
       is inside the mouth is a floating tower, and this file's structural
       ledger has no concept of "undermined". Close is the point; over is
       the bug. */
    function underABuilding(x, z) {
      const B = ctx.arena.fragile || [];
      for (let i = 0; i < B.length; i++) {
        const b = B[i];
        const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
        if (bx == null) continue;
        if (Math.hypot(x - bx, z - bz) < r * 0.85 + (b.w || 8) * 0.5) return true;
      }
      return false;
    }
    const spec = {
      cx: ctx.cx, cz: ctx.cz, R: ctx.R, r: r, rng: rnd, minDist: 14, tries: 90,
      avoid(x, z) { return nearAnotherHole(x, z) || underABuilding(x, z); },
    };
    /* THE SLOPE LAW IS LAW; KEEPING CLEAR OF A BUILDING IS TASTE. If the
       island cannot offer flat ground away from every tower, take flat ground
       — a disaster that silently does nothing because its preferences went
       unmet is worse than a hole beside a wall. The slope refusal is never
       relaxed, which is what keeps holesOnSlopes at zero.

       The relaxed pass used to drop `avoid` ENTIRELY, which threw away the
       hole-spacing rule along with the building rule. It now drops only the
       taste half: no site beside a tower is better than a site inside an
       existing shaft, and if neither can be had there is simply no hole. */
    let site = CBZ.groundShaftSite(spec);
    if (!site) { spec.avoid = nearAnotherHole; site = CBZ.groundShaftSite(spec); }
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

  /* ---- SKY STREAKS: the meteor shower's real warning -----------------------
     A bolide is visible for seconds before anything lands. Each streak is one
     stretched additive box travelling on a straight line — pooled per event,
     disposed with it, and drawn high enough that the first few burn out
     harmlessly and simply make you look up. When a streak is aimed at a real
     impact point it is the SAME rock the ground marker is tracking. */
  function skyStreak(ctx, tx, tz) {
    const st = ctx.st;
    if (!st.streaks) st.streaks = [];
    if (st.streaks.length > 14) return;
    const aimed = tx != null;
    const gx = aimed ? tx : ctx.cx + (rnd() - 0.5) * ctx.R * 2.4;
    const gz = aimed ? tz : ctx.cz + (rnd() - 0.5) * ctx.R * 2.4;
    const a = rnd() * 6.28, D = 210 + rnd() * 90;
    const sx = gx + Math.cos(a) * D, sz = gz + Math.sin(a) * D;
    const sy = 150 + rnd() * 80, gy = aimed ? floor(gx, gz) + 3 : 60 + rnd() * 40;
    const len = 16 + rnd() * 22;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, len),
      new THREE.MeshBasicMaterial({ color: aimed ? 0xffd08a : 0xfff0d0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.renderOrder = 7; root().add(m);
    const dx = gx - sx, dy = gy - sy, dz = gz - sz;
    const L = Math.hypot(dx, dy, dz) || 1;
    const life = aimed ? 1.15 : 1.3 + rnd() * 0.7;
    st.streaks.push({ m, x: sx, y: sy, z: sz, vx: dx / L, vy: dy / L, vz: dz / L, spd: L / life, t: 0, life });
  }
  function tickStreaks(dt, ctx) {
    const S = ctx.st.streaks; if (!S) return;
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i]; s.t += dt;
      s.x += s.vx * s.spd * dt; s.y += s.vy * s.spd * dt; s.z += s.vz * s.spd * dt;
      s.m.position.set(s.x, s.y, s.z);
      s.m.lookAt(s.x + s.vx, s.y + s.vy, s.z + s.vz);
      s.m.material.opacity = 0.9 * Math.max(0, 1 - s.t / s.life);
      if (s.t >= s.life) { rmMesh(s.m); S.splice(i, 1); }
    }
  }
  function clearStreaks(ctx) {
    const S = ctx.st.streaks; if (!S) return;
    for (let i = 0; i < S.length; i++) rmMesh(S[i].m);
    S.length = 0;
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

  const dir = { state: "idle", t: 6, cur: null, curId: null, st: {}, idx: 0, occ: 0, intensity: 0.2, prog: 0, overT: 0, overName: null };
  let curCtx = null;

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

  function beginWarn() {
    // survived a whole arc? reshuffle the next cycle from the same run stream
    // (nuke-last + gentle-first keeps the wraparound pacing legal by itself)
    if (dir.idx > 0 && dir.idx % order.length === 0) order = buildOrder();
    const id = order[dir.idx % order.length];
    dir.idx++; dir.occ++;
    dir.intensity = Math.min(1.7, 0.2 + dir.occ * 0.16);
    dir.cur = DEFS[id]; dir.curId = id; dir.st = {}; dir.state = "warn"; dir.t = dir.cur.warnSecs;
    dir.overT = 0; dir.overName = null;   // a new warning supersedes the all-clear
    curCtx = makeCtx(0);
    narrate("banner", dir.cur.name + " · INCOMING");
    // THE UNIVERSAL TELEGRAPH IS PHYSICAL: every warning lands with a jolt you
    // feel, warnAmbience() below tints the whole sky toward the hazard's mood,
    // and the def's own warnTick starts the world doing the thing. Nothing on
    // screen says what is coming — the world does.
    if (CBZ.CONFIG.SURV_TELEGRAPH !== false && CBZ.shake) CBZ.shake(0.22);
    try { dir.cur.warn(curCtx); } catch (e) { console.error("[disaster warn]", e); }
  }
  function beginActive(ctx) {
    dir.state = "active"; dir.t = dir.cur.activeSecs;
    if (CBZ.surv) CBZ.surv._cause = dir.cur.cause || "killed by the disaster";   // default cause for kill feed
    narrate("banner", dir.cur.name);
    try { dir.cur.start(ctx); } catch (e) { console.error("[disaster start]", e); }
  }
  function endActive(ctx) {
    try { dir.cur.end(ctx); } catch (e) { console.error("[disaster end]", e); }
    if (!CBZ.player.dead) CBZ.surv.stats.disastersSurvived++;
    if (CBZ.surv) CBZ.surv._cause = null;
    // The ALL-CLEAR is now the world going quiet: warnAmbience releases the
    // sky tint, weatherOff() bleeds the rain out over ~3.5 s, and the surge
    // returns to zero. `overName` survives only as state the minimap and the
    // audit read — nothing draws it.
    dir.overName = dir.cur.name;
    dir.overT = Math.min(4, dir.cur.gap || 4);
    dir.state = "idle"; dir.t = dir.cur.gap; dir.cur = null; dir.curId = null;
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
      if (CBZ.survHoles) CBZ.survHoles.length = 0;
      said.banners = said.hints = said.toasts = 0;
      // a fresh SEEDED arc for this run: world seed + run counter → the same
      // match order for every client, a different order every match
      runNo++;
      orderRng = CBZ.seedStream ? CBZ.seedStream("surv-sequence-" + runNo) : null;
      reseedHazards(runNo);      // the hazards themselves, same seed, same run
      order = buildOrder();
      dir.state = "idle"; dir.t = 7; dir.cur = null; dir.curId = null; dir.st = {}; dir.idx = 0; dir.occ = 0; dir.intensity = 0.2; dir.overT = 0; dir.overName = null; curCtx = null; fallingBuildings.length = 0; flungCars.length = 0;
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
        if (!warn && st.x != null) out.push({ x: st.x, z: st.z, r: 18 });
      } else if (id === "volcano") {
        const h = A.hills[0]; out.push({ x: h.x, z: h.z, r: 15 });
        pushEruptHazards(st, out);
      } else if (id === "quake") {
        if (st.erupting) { const h = A.hills[0]; out.push({ x: h.x, z: h.z, r: 15 }); pushEruptHazards(st, out); }
      } else if (id === "storm") {
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: 5 }));
      } else if (id === "meteor") {
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: p.r || 6 }));
      } else if (id === "sinkhole") {
        (st.holes || []).forEach((h2) => out.push({ x: h2.x, z: h2.z, r: h2.r || 4 }));
        (st.pending || []).forEach((p) => out.push({ x: p.x, z: p.z, r: p.r || 4 }));
      } else if (id === "wildfire") {
        const tr = A.flammable || [];
        for (let i = 0, n = 0; i < tr.length && n < 24; i++) if (tr[i].burning) { out.push({ x: tr[i].x, z: tr[i].z, r: 4 }); n++; }
      } else if (id === "nuke") {
        if (st.gx != null) out.push(!st.r ? { x: st.gx, z: st.gz, r: 9 } : { x: st.gx, z: st.gz, r: st.r, fill: false });
      } else if (id === "flashflood") {
        // no front any more — the flood is a LEVEL, so the map marks the low
        // ground that is already under. One ring per drowned hollow beats a
        // line pretending there is a wall.
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
         surgeDriven                true — the sea moved via waterSurgeSet
         weatherDriven              true while a weather disaster is live
         swimShared                 true — city/swim.js answers on the island

       `structureHits`, `detonateAdopted` and `surgeWrites` are printed beside
       the zeros so a build that passes by simply never running a disaster
       cannot be mistaken for a build that migrated one.
       ============================================================ */
    audit() { return CBZ.disasterAudit(); },
    // jump straight to a named disaster's warning (debug / verification aid)
    force(id) {
      const i = order.indexOf(id);   // this run's shuffled arc
      if (i < 0) return false;
      if (dir.cur && dir.cur.end && dir.state === "active") { try { dir.cur.end(makeCtx(0)); } catch (e) {} }
      dir.idx = i; dir.state = "idle"; dir.t = 0.01; dir.cur = null;
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
         live lava mesh and counts transparent/additive ones). `lavaLegacy`
         counts additive stream boxes this run actually built — 0 unless a flag
         was reverted. `nukeUsedNukefx` is asked of city/nukefx.js's own live
         state, so "the finale drew the real mushroom" is a measurement and not
         a claim about which function got called. */
      volcanoV2: CBZ.CONFIG.VOLCANO_V2 !== false && !!CBZ.volcanoFx,
      lavaOpaque: volA ? !!volA.lavaOpaque : true,
      lavaTransparent: volA ? volA.lavaTransparent : 0,
      lavaFlows: volA ? volA.lavaFlows : 0,
      lavaLegacy: lavaLegacy,
      pyroRuns: pyroRuns,
      pyroLive: volA ? volA.pyroLive : 0,
      laharRuns: laharRuns,
      /* THE OWNER'S SECOND COMPLAINT AS TWO NUMBERS. `volcanoDeaths` is the
         drop in the live roster across every eruption this run finished, and
         it is the one to watch: an eruption that empties a 100-player island
         is not a disaster, it is a reset. `volcanoBombs` is how many rocks the
         mountain actually threw — the thing that used to run at one a second
         from a uniform draw over the whole map. */
      volcanoDeaths: volcanoDeaths,
      volcanoBombs: bombsThrown,
      ashRoofCollapses: ashRoofCollapses,
      // the two numbers that say WHY a roof did or did not go: how many roofs
      // are actually carrying a load, and the heaviest load any of them has
      ashRoofs: (st.erRoofs && st.erRoofs.length) || 0,
      ashRoofMax: (function () {
        const R = st.erRoofs, A = st.erAshLoad;
        if (!R || !A) return 0;
        let m = 0;
        for (let i = 0; i < R.length; i++) m = Math.max(m, A.roofDepth(R[i].id));
        return +m.toFixed(3);
      })(),
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
    }
  });

  CBZ.onUpdate(28, function (dt) {
    if (CBZ.game.mode !== "survival" || !CBZ.surv.arena) return;

    // reset the lighting baseline; the active disaster re-tints below
    const e = CBZ.survEnv;
    e.fog = 0xbfe0ff; e.fogNear = 80; e.fogFar = 380; e.sunInt = 1.08; e.sunColor = 0xfff4e0; e.hemiInt = 0.98; e.hemiColor = 0xeaf4ff;

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
    if (dir.state === "active" && dir.cur) dir.prog = 1 - dir.t / dir.cur.activeSecs;
    curCtx = ctx; // refresh for bot fleeVector (1-frame latency is fine)

    if (dir.state === "idle") {
      dir.t -= dt;
      // let the "IT'S OVER" all-clear breathe for a few seconds, then go quiet
      if (dir.overT > 0) { dir.overT -= dt; if (dir.overT <= 0) dir.overName = null; }
      if (dir.t <= 0) beginWarn();
    }
    else if (dir.state === "warn") { dir.t -= dt; warnAmbience(); if (dir.cur.warnTick) try { dir.cur.warnTick(dt, ctx); } catch (e2) {} if (dir.t <= 0) beginActive(ctx); }
    else if (dir.state === "active") { dir.t -= dt; try { dir.cur.active(dt, ctx); } catch (e3) { console.error("[disaster active]", e3); } if (dir.t <= 0) endActive(ctx); }
  });
})();
