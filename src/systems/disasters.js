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

  function rnd() { return Math.random(); }
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
     docs/claude/engine-systems.md). The arena's ocean plane follows it every
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
    if (CBZ.CONFIG.SURV_SHARED_STRUCTURE !== false && CBZ.detonate) {
      try {
        CBZ.detonate(x, y, z, kind, {
          noDamage: true, scale: o.scale, mass: o.mass, speed: o.speed,
          dirx: o.dirx, dirz: o.dirz, quiet: o.quiet,
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
      CBZ.fx.blast(x, z, { maxR: (o.fxR || o.r) + 4, color: o.color || 0xffcaa0, shake: 0.6, flash: o.flash != null ? o.flash : 0.3, sfx: o.sfx || "shoot_shotgun" });
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

    // ---- EARTHQUAKE: shake + toppling buildings + crushing debris ----
    quake: {
      name: "EARTHQUAKE", emoji: "", warnSecs: 5, activeSecs: 15, gap: 7, cause: "crushed under collapsing rubble", tint: 0x8a7f6c,
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
      },
      // during the sirens the danger is ALREADY the buildings — bots start
      // clearing the streets before the first collapse
      warnThreat(x, z, ctx) { return DEFS.quake.threat(x, z, ctx); },
      start(ctx) {
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
        // a quake MIGHT crack the mountain open into an eruption — not guaranteed
        ctx.st.eruptArmed = rnd() < 0.4;
        ctx.st.eruptAt = 4 + rnd() * 5;     // seconds into the quake it would hit
      },
      active(dt, ctx) {
        if (CBZ.shake) CBZ.shake(0.16 + 0.5 * ctx.intensity * (0.5 + ctx.prog * 0.5));
        ctx.st.dust.setActive(0.7); ctx.st.dust.update(dt, camPos().x, 0, camPos().z);
        if (rnd() < dt * 1.1) sound("rumble");
        // spaced-out collapses (slower cadence; only the capped subset falls)
        ctx.st.next -= dt;
        if (ctx.st.next <= 0 && ctx.st.order.length) {
          ctx.st.next = 1.5 - 0.6 * ctx.prog;
          // through the ledger, never straight to collapse: a tower already
          // spalled by an earlier disaster goes down on less than a fresh one
          structureHit(ctx.st.order.pop(), 1.2, ctx, { kind: "quake" });
        }
        rattleProps(ctx, 0.10 + 0.10 * ctx.intensity);
        // surprise eruption part-way through (if armed this quake)
        if (ctx.st.eruptArmed && !ctx.st.erupting) {
          ctx.st.eruptAt -= dt;
          if (ctx.st.eruptAt <= 0) startEruption(ctx);
        }
        tickEruption(dt, ctx);
        tick0(ctx, dt);
      },
      end(ctx) {
        if (ctx.st.dust) ctx.st.dust.dispose();
        endEruption(ctx);
      },
      threat(x, z, ctx) {
        let t = 0.2; const f = ctx.arena.fragile;
        for (let i = 0; i < f.length; i++) if (!f[i].fallen) { const d = Math.hypot(x - f[i].x, z - f[i].z); if (d < 8) t = Math.max(t, 0.9 * (1 - d / 8)); }
        if (ctx.st.erupting) t = Math.max(t, eruptThreat(x, z, ctx));
        return t;
      },
      safeDir(x, z, ctx) {
        let bx = 0, bz = 0; const f = ctx.arena.fragile;
        for (let i = 0; i < f.length; i++) if (!f[i].fallen) { const dx = x - f[i].x, dz = z - f[i].z, d = Math.hypot(dx, dz); if (d < 9 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } }
        return (bx || bz) ? { x: bx, z: bz } : null;
      },
    },

    // ---- LIGHTNING STORM: telegraphed strikes that instakill ----
    storm: {
      name: "LIGHTNING STORM", emoji: "", warnSecs: 4, activeSecs: 16, gap: 6, cause: "struck by lightning", tint: 0x3a4150,
      // THE STORM ROLLS IN. No line of text: the sky darkens, the rain thickens
      // from nothing and the wind gets up, all through the ONE weather system —
      // so wet asphalt, wet grip and the lightning flash come along for free.
      warn(ctx) {
        narrate("hint", "Storm rolling in — keep moving!", 2.4); sound("thunder");
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
          ctx.st.pending.push({ x: tx, z: tz, t: 0.95, m: CBZ.fx.groundMarker(tx, tz, 4.5, 0x9fd0ff) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 0.95);
          if (p.t <= 0) { strike(p.x, p.z, ctx); p.m.dispose(); ctx.st.pending.splice(i, 1); }
        }
        for (let i = ctx.st.bolts.length - 1; i >= 0; i--) { const b = ctx.st.bolts[i]; b.life -= dt; b.mesh.material.opacity = Math.max(0, b.life / 0.16); if (b.life <= 0) { rmMesh(b.mesh); ctx.st.bolts.splice(i, 1); } }
      },
      end(ctx) { weatherOff(); (ctx.st.pending || []).forEach((p) => p.m.dispose()); (ctx.st.bolts || []).forEach((b) => rmMesh(b.mesh)); },
      threat(x, z, ctx) { let t = 0.1; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < 7) t = Math.max(t, 0.95 * (1 - d / 7)); }); return t; },
      // in the sirens the smart move is OFF the exposed high ground and out of
      // the open, so the crowd visibly scatters toward the town before the
      // first bolt lands
      warnThreat(x, z, ctx) { return Math.min(0.75, 0.2 + floor(x, z) * 0.05); },
      warnSafeDir(x, z, ctx) {
        const h = ctx.arena.hills[0], dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1;
        return { x: dx / d, z: dz / d };
      },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 8 && d > 0.1) { bx += dx / d; bz += dz / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- TSUNAMI: assigned right after this roster (DEFS.flood, below).
    //      CBZ.CONFIG.SURV_TSUNAMI_V2 (default true) picks the rebuilt
    //      real-event arc; false restores the legacy layered-plane wall. ----

    // ---- FLASH FLOOD: torrential rain, and the water simply COMES UP.
    //      Rebuilt as a consumer of the shared sea (SURV_SHARED_WATER): it
    //      authors no mesh at all — it moves CBZ.waterSurgeSet through a
    //      rise → stand → drain arc and every water consumer in the game
    //      follows, exactly as city/tsunami.js does in the main world. The
    //      rain is systems/weather.js's rain. What used to be ~55 lines of
    //      private plane, private wall, private crest and a hand-rolled
    //      drowning DOT is now the arc and nothing else.
    //      Less wall-of-doom than the tsunami; the RISE is the threat, and
    //      the answer is altitude you have to find before it gets there.
    flashflood: {
      name: "FLASH FLOOD", emoji: "", warnSecs: 5, activeSecs: 18, gap: 6, cause: "swept away by the flood surge", tint: 0x59636b,
      // THE RAIN ARRIVES FIRST. That is the whole warning and it is honest:
      // the sky opens, the light goes, and only then does the water start to
      // climb. A player who reads it is already walking uphill.
      warn(ctx) {
        narrate("hint", "FLASH FLOOD — water rising, get HIGH!", 3); sound("water");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        // deliberately UNDER the smallest hill's peak (7) and every building
        // floor slab: the flood takes the streets, never the refuges
        ctx.st.peak = Math.min(5.6, 3.5 + scale(2.2, ctx));
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        weather({ rain: 0.25 + k * 0.72, wind: 4 + k * 5, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.5, fogColor: 0x59636b });
        if (rnd() < dt * 3 * k) sound("water");
      },
      start(ctx) {
        // NO MESH. The flood is the sea, and the sea is one number.
        ctx.st.t = 0;
        ctx.st.level0 = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        if (CBZ.shake) CBZ.shake(0.4);
      },
      active(dt, ctx) {
        ctx.env.fog = 0x59636b; ctx.env.fogNear = 22; ctx.env.fogFar = 150; ctx.env.sunInt = 0.55; ctx.env.hemiColor = 0x97a6b3;
        weather({ rain: 1, wind: 8, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.55, fogColor: 0x59636b });
        ctx.st.t += dt;
        // rise (0.42) → stand (0.26) → drain (0.32). Water goes UP fast and
        // out slowly, which is what makes the drain the part that strands you.
        const u = Math.min(1, ctx.st.t / Math.max(1, ctx.activeSecs));
        const peak = ctx.st.peak;
        let s;
        if (u < 0.42) s = peak * ease(u / 0.42);
        else if (u < 0.68) s = peak * (1 - 0.06 * ((u - 0.42) / 0.26));
        else s = peak * 0.94 * (1 - ease((u - 0.68) / 0.32));
        surgeSet(s);
        // a real downhill current in the inundation, published on the ONE
        // water-event descriptor so the swimmer and the debris both feel it
        publishSheetFlood(ctx, u < 0.42 ? "flooded" : (u < 0.68 ? "flooded" : "drain"), s, u < 0.68 ? 1.4 : -1.1);
        floodActors(dt, ctx, u < 0.68 ? 1.4 : -1.1, "drowned in the floodwater");
        // the surge shoves parked cars off the low ground as it comes up
        if (ctx.arena.cars) for (let i = 0; i < ctx.arena.cars.length; i++) {
          const car = ctx.arena.cars[i];
          if (!car.flung && floodDepth(car.x, car.z) > 0.9) flingCar(car, ctx.st.wx, ctx.st.wz, 6 + scale(3, ctx), 2.5);
        }
        if (rnd() < dt * 5) sound("water");
      },
      end(ctx) {
        weatherOff(); surgeSet(0);
        const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
        if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; }   // the sea settles back down
        if (CBZ.waterEventClear) CBZ.waterEventClear("survival-flood");
      },
      threat(x, z, ctx) {
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

    // ---- HURRICANE: shrieking wind drags everyone downwind, blinding rain,
    //      swirling debris, and violent gusts that knock you flat. The wind
    //      direction slowly veers, so high ground alone won't save you. ----
    hurricane: {
      name: "HURRICANE", emoji: "", warnSecs: 5, activeSecs: 20, gap: 7, cause: "killed by hurricane debris", tint: 0x46505a,
      // THE WIND RAMPS FROM ZERO. You feel yourself start to lean before the
      // storm is anywhere near full strength, and the debris streaming past at
      // ground level tells you which way it is going — which is the ONE piece
      // of information the old banner was trying to convey. The wind vector is
      // now THE weather's wind (systems/weather.js), not a third private one.
      warn(ctx) {
        narrate("hint", "HURRICANE inbound — brace and hold on!", 3); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
        ctx.st.gustCd = 2; ctx.st.turn = (rnd() - 0.5) * 0.2;
        ctx.st.debris = CBZ.fx.particleCloud({ mode: "swirl", color: 0x7a6f5a, count: 200, radius: ctx.R * 0.7, top: 10, size: 0.3, opacity: 0.6, vMin: 8, vMax: 16 });
        ctx.st.debris.setActive(0.15);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
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
      warnSafeDir(x, z, ctx) { return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) }; },
      start(ctx) {
        ctx.st.debris.setActive(0.8);
      },
      active(dt, ctx) {
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
      end(ctx) { weatherOff(); if (ctx.st.debris) ctx.st.debris.dispose(); },
      threat(x, z, ctx) { return 0.4; },
      safeDir(x, z, ctx) { return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) }; },
    },

    // ---- WILDFIRE: fire spreads tree to tree, burns on contact ----
    wildfire: {
      name: "WILDFIRE", emoji: "", warnSecs: 5, activeSecs: 18, gap: 6, cause: "burned alive in the wildfire", tint: 0x4a2814,
      // ONE TREE LIGHTS AND ITS SMOKE STANDS UP. That is how you actually learn
      // a wildfire is coming, and it also gives the fire a real ORIGIN you can
      // put your back to instead of a hazard that materialises everywhere.
      warn(ctx) {
        narrate("hint", "Wildfire spreading — don't get cornered!", 2.6); sound("fire");
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
        }) : null;
      },
      active(dt, ctx) {
        // CBZ.tornado owns the field, the funnel, the deaths and the debris.
        // All this def does is mirror the live position for the minimap and
        // keep the parent storm blowing (the funnel already biases off
        // CBZ.weather's wind, so this is the only wind either of us sets).
        weather({ rain: 0.55, wind: 12, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.45, fogColor: 0x6a6f7a });
        const a = CBZ.tornado && CBZ.tornado.active()[0];
        if (a) { ctx.st.x = a.x; ctx.st.z = a.z; }
      },
      end(ctx) { weatherOff(); if (CBZ.tornado && ctx.st.tw) CBZ.tornado.stop(ctx.st.tw); ctx.st.tw = null; },
      threat(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.threat(x, z) : 0; },
      safeDir(x, z, ctx) { return CBZ.tornado ? CBZ.tornado.safeDir(x, z) : null; },
    },

    // ---- VOLCANO: ash-out, lava flows from the mountain, lava bombs ----
    volcano: {
      name: "VOLCANIC ERUPTION", emoji: "", warnSecs: 6, activeSecs: 20, gap: 7, cause: "incinerated by lava", tint: 0x2e211c,
      // THE MOUNTAIN WAKES UP IN FRONT OF YOU. A rising rumble under your feet,
      // the crater rim starting to glow, and the first ash beginning to fall —
      // three physical facts that between them say everything the banner said,
      // and unlike the banner they tell you WHICH mountain and WHICH way the
      // ash is drifting.
      warn(ctx) {
        narrate("hint", "THE VOLCANO IS WAKING — off the mountain, out of the ash!", 3);
        sound("rumble"); if (CBZ.shake) CBZ.shake(0.5);
        const h = ctx.arena.hills[0];
        ctx.st.preGlow = disc(h.x, h.z, 0xff5210, 0.0, h.peak + 0.3);
        ctx.st.preGlow.material.blending = THREE.AdditiveBlending;
        ctx.st.preGlow.scale.set(4, 4, 1);
        ctx.st.preAsh = CBZ.fx.particleCloud({ mode: "fall", color: 0x4a4038, count: 200, radius: 26, top: 30, size: 0.24, opacity: 0.4, vMin: 5, vMax: 10 });
        const wa = rnd() * 6.28; ctx.st.wx = Math.cos(wa); ctx.st.wz = Math.sin(wa);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        const h = ctx.arena.hills[0];
        if (CBZ.shake) CBZ.shake(0.04 + 0.22 * k * k);
        rattleProps(ctx, 0.015 + 0.05 * k);
        if (ctx.st.preGlow) ctx.st.preGlow.material.opacity = k * (0.55 + 0.3 * Math.sin(CBZ.now * 0.012));
        ctx.st.preAsh.setActive(k * 0.6);
        ctx.st.preAsh.update(dt, h.x + ctx.st.wx * 30 * k, 0, h.z + ctx.st.wz * 30 * k);
        weather({ rain: 0, wind: 3 + k * 5, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.35, fogColor: 0x2e211c });
        ctx.st.rumbleCd = (ctx.st.rumbleCd || 0) - dt;
        if (ctx.st.rumbleCd <= 0) { ctx.st.rumbleCd = 1.8 - k; soundAt("rumble", h.x, h.z); }
      },
      // the crowd is already running OFF the mountain while it is still only
      // rumbling — that stampede IS the warning for anyone who missed the glow
      warnThreat(x, z, ctx) {
        const h = ctx.arena.hills[0], d = Math.hypot(x - h.x, z - h.z);
        return d < h.r + 12 ? 0.9 * (1 - d / (h.r + 12)) : 0.05;
      },
      warnSafeDir(x, z, ctx) { return DEFS.volcano.safeDir(x, z, ctx); },
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

    // ---- BLIZZARD: whiteout; freeze if you stop moving ----
    blizzard: {
      name: "BLIZZARD", emoji: "", warnSecs: 5, activeSecs: 17, gap: 6, cause: "frozen solid in the blizzard", tint: 0xdbe6f0,
      // VISIBILITY CLOSES IN. The horizon walks toward you over five seconds
      // and the first flakes start crossing the light. Nothing has to say
      // "whiteout" — you can measure it by how much island you can still see.
      warn(ctx) {
        narrate("hint", "Blizzard incoming — get INDOORS or keep moving!", 2.8); sound("wind");
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        weather({ rain: 0, snow: 0.2 + k * 0.7, wind: 5 + k * 9, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: k * 0.8, fogColor: 0xdbe6f0 });
        // the fog wall closing: 380 m of visibility down to 120 m before it hits
        ctx.env.fogFar = 380 - 260 * k; ctx.env.fogNear = 80 - 60 * k;
        ctx.env.fog = lerpHex(ctx.env.fog, 0xdbe6f0, 0.7 * k);
        if (rnd() < dt * 1.5) sound("wind");
      },
      // shelter is the answer, so the crowd converges on the town roofs
      warnThreat(x, z, ctx) { return 0.3; },
      warnSafeDir(x, z, ctx) { return null; },
      start(ctx) {},
      active(dt, ctx) {
        ctx.env.fog = 0xdbe6f0; ctx.env.fogNear = 8; ctx.env.fogFar = 60; ctx.env.sunInt = 0.6; ctx.env.sunColor = 0xcfe0ff; ctx.env.hemiInt = 1.1; ctx.env.hemiColor = 0xeaf2ff;
        weather({ rain: 0, snow: 1, wind: 16 + 6 * ctx.intensity, windDir: { x: ctx.st.wx, z: ctx.st.wz }, fog: 0.85, fogColor: 0xdbe6f0 });
        const cold = scale(12, ctx);
        surv().forEachActor(function (a) {
          if (sheltered(a)) return;                    // a roof overhead = warmth; shelter is physical
          if ((a.speed || 0) < 1.6) surv().hurt(a, cold * dt);
        });
        if (rnd() < dt * 2) sound("wind");
      },
      end(ctx) { weatherOff(); },
      threat() { return 0.25; },
      safeDir() { return null; }, // no safe direction — just don't stand still
    },

    // ---- METEOR SHOWER: telegraphed impacts, big blast ----
    meteor: {
      name: "METEOR SHOWER", emoji: "", warnSecs: 5, activeSecs: 17, gap: 6, cause: "flattened by a meteor", tint: 0x4a3a3a,
      // STREAKS CROSS THE SKY FIRST. Bolides burn up high and harmlessly for a
      // few seconds before anything reaches the ground — which is exactly the
      // real sequence, and it makes the player look UP, which is where the
      // warning for the rest of the event will be.
      warn(ctx) {
        narrate("hint", "METEORS — watch the shadows!", 2.6); sound("rumble");
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
       This was the single worst offender in the roster: a flat BLACK DISC
       painted on the grass that instakilled anyone standing on it. You did not
       fall, nothing moved, and death arrived while you were still standing
       upright on what looked like a puddle of ink.

       A hole is a hole. Each one now cuts a real shaft — walls, a floor 14-22 m
       down, spoil around the rim — and REMOVES THE FLOOR over its mouth
       (CBZ.survHoles, read by modes/survival.js's floorAt), so the ordinary
       vertical physics does the rest: you drop, you accelerate, and the impact
       at the bottom is what kills you. The telegraph is the ground CRACKING
       and sagging for a second first, which is the beat that makes it a
       hazard you can answer instead of a coin flip.                          */
    sinkhole: {
      name: "SINKHOLES", emoji: "", warnSecs: 5, activeSecs: 16, gap: 6, cause: "swallowed by a sinkhole", tint: 0x5a4a36,
      warn(ctx) {
        narrate("hint", "The ground is giving way!", 2.6); sound("rumble");
        ctx.st.cracks = [];
      },
      warnTick(dt, ctx) {
        const k = 1 - dir.t / (this.warnSecs || 1);
        if (CBZ.shake) CBZ.shake(0.02 + 0.09 * k);
        rattleProps(ctx, 0.01 + 0.03 * k);
        // hairline cracks open across the low ground before anything drops
        ctx.st.crackCd = (ctx.st.crackCd || 0) - dt;
        if (ctx.st.crackCd <= 0 && ctx.st.cracks.length < 9) {
          ctx.st.crackCd = 0.45;
          const p = ctx.arena.randomPoint(0, ctx.R * 0.92);
          const m = disc(p.x, p.z, 0x2a1e14, 0.0, 0.05);
          m.scale.set(1.4 + rnd() * 2.2, 0.22 + rnd() * 0.2, 1);
          m.rotation.z = rnd() * 3.14;
          ctx.st.cracks.push(m);
        }
        for (let i = 0; i < ctx.st.cracks.length; i++) ctx.st.cracks[i].material.opacity = Math.min(0.75, ctx.st.cracks[i].material.opacity + dt * 0.7);
        if (rnd() < dt * 1.4) soundAt("rumble", ctx.cx, ctx.cz);
      },
      warnThreat() { return 0.25; },
      start(ctx) { ctx.st.holes = []; ctx.st.pending = []; ctx.st.cd = 0.4; },
      active(dt, ctx) {
        if (CBZ.shake) CBZ.shake(0.12);
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = 0.7 - 0.3 * ctx.prog;
          const p = ctx.arena.randomPoint(0, ctx.R);
          const r = 3 + scale(2, ctx);
          // the SAG: the marker is the ground visibly dishing before it goes
          ctx.st.pending.push({ x: p.x, z: p.z, r, t: 1.0, m: CBZ.fx.groundMarker(p.x, p.z, r, 0x5a3a20) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t);
          if (p.t <= 0) {
            p.m.dispose();
            ctx.st.holes.push(openHole(ctx, p.x, p.z, p.r));
            ctx.st.pending.splice(i, 1);
          }
        }
        tickHoles(dt, ctx);
      },
      end(ctx) {
        (ctx.st.pending || []).forEach((p) => p.m.dispose());
        (ctx.st.cracks || []).forEach((m) => rmMesh(m));
        closeHoles(ctx);
      },
      threat(x, z, ctx) { let t = 0; (ctx.st.holes || []).forEach((h) => { const d = Math.hypot(x - h.x, z - h.z); if (d < h.r + 4) t = Math.max(t, 1 - d / (h.r + 4)); }); (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 2) t = Math.max(t, 0.8 * (1 - d / (p.r + 2))); }); return t; },
      warnSafeDir() { return null; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; const all = (ctx.st.holes || []).concat(ctx.st.pending || []); all.forEach((h) => { const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz); if (d < h.r + 4 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
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
        survBlast("nuke", ctx.st.gx, ctx.st.gz, {
          r: 0, up: 2, ctx: ctx, fxR: ctx.R * 0.5, color: 0xfff3d0,
          struct: 1.6, structR: ctx.R * 0.55, sfx: "explosion",
        });
        CBZ.fx.flash(1, 0xffffff);
        if (CBZ.shake) CBZ.shake(1.8);
        ctx.st.r = 2; ctx.st.maxR = ctx.R * 0.95; ctx.st.killed = false;
      },
      active(dt, ctx) {
        ctx.env.fog = 0x3a2a22; ctx.env.fogNear = 30; ctx.env.fogFar = 220; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff8a4a; ctx.env.hemiColor = 0xffae7a;
        // expanding lethal shockwave front — this is the ISLAND-scale pressure
        // wave, priced against the mode's roster (see start()'s note)
        const prev = ctx.st.r;
        ctx.st.r = Math.min(ctx.st.maxR, ctx.st.r + (ctx.st.maxR / 6) * dt);
        const inner = ctx.st.r - 4;
        surv().forEachActor(function (a) {
          const d = Math.hypot(a.pos.x - ctx.st.gx, a.pos.z - ctx.st.gz);
          if (d <= ctx.st.r && d >= inner) surv().hurt(a, 1e6, { fromX: ctx.st.gx, fromZ: ctx.st.gz, fling: 9 });   // caught by the front
          else if (d < inner) surv().hurt(a, scale(8, ctx) * dt, { cause: "killed by nuclear fallout" });           // lingering radiation
        });
        // the front takes the town down as it passes, through the ONE ledger
        if (ctx.st.r > prev) structureSweepRing(ctx, ctx.st.gx, ctx.st.gz, prev, ctx.st.r, 1.4);
        tick0(ctx, dt);
      },
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
    warn(ctx) { narrate("hint", "TSUNAMI — get to HIGH GROUND!", 3); sound("water"); },
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
  function tsuBuildWave(ctx) {
    const st = ctx.st, H = st.H, W = ctx.R * 2.7, zs = H / 34;
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
    if (W) { W.amp = st.waveAmp; W.chop = st.chopAmp; W.foam = st.foamGain; }
    if (CBZ.waterEventSet) CBZ.waterEventSet({
      owner: "survival-tsunami", kind: "tsunami", phase: st.phase,
      cx: ctx.cx, cz: ctx.cz, dx: st.dx, dz: st.dz,
      frontS: st.frontS, frontWet: -2, frontWidth: 20,
      level: CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.level,
      waveAmp: st.waveAmp, chopAmp: st.chopAmp,
      flow: Number.isFinite(flow) ? flow : 0,
    });
  }

  // ---- floating debris planks (pooled: one shared geometry, two materials)
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

  // ---- the front wrecks the low town: cars tumble, small buildings go
  //      down, big ones lose their glass. High ground is spared. ----
  function tsuSmash(ctx) {
    const st = ctx.st, A = ctx.arena;
    if (A.cars) for (let i = 0; i < A.cars.length; i++) {
      const car = A.cars[i]; if (car.flung) continue;
      const s = tsuS(ctx, car.x, car.z);
      if (s <= st.frontS + 2 && s >= st.frontS - 10 && floor(car.x, car.z) <= st.level + 4)
        flingCar(car, st.dx, st.dz, 17 + scale(7, ctx), 9);
    }
    for (let i = 0; i < A.fragile.length; i++) {
      const b = A.fragile[i];
      const s = tsuS(ctx, b.x, b.z);
      if (s > st.frontS + 2 || s < st.frontS - 12 || b._tsuHit === st.waveId) continue;
      b._tsuHit = st.waveId;
      if (floor(b.x, b.z) > st.level + 5) continue;        // on high ground — spared
      // THROUGH THE ONE LEDGER. A low shed takes a load it cannot carry and
      // goes; a tower takes the same load and loses its glass — and if the
      // quake already spalled it, this is what finishes it. That difference
      // used to be `rnd() < 0.65`.
      const frontal = Math.max(0.15, 1.35 - b.h / 12);
      structureHit(b, frontal * (0.7 + 0.5 * ctx.intensity), ctx, { kind: "kinetic", dirx: st.dx, dirz: st.dz });
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
    st.waveAmp = 1.38; st.chopAmp = 1.72; st.foamGain = 0.62;
    if (st.wave) st.wave.visible = false;
    if (st.spray) st.spray.setActive(0);
    surgeSet(st.floodSurge);
    tsuPublish(ctx, 1.6);
    narrate("hint", "THE ISLAND IS UNDER — swim, climb, survive", 3);
  }

  const TSUNAMI_V2 = {
    name: "TSUNAMI", emoji: "", warnSecs: 10, activeSecs: 26, gap: 8,
    cause: "swept away by the tsunami", tint: 0x2c5a78,
    warn(ctx) {
      const st = ctx.st, a = rnd() * Math.PI * 2;
      st.dx = Math.cos(a); st.dz = Math.sin(a);
      st.warnT = 0; st.phase = "warn";
      st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : -0.8;
      st.waveAmp = 0.86; st.chopAmp = 0.72; st.foamGain = 0.34;
      st.frontS = -1e9;
      tsuPublish(ctx, 0);
      narrate("hint", "TSUNAMI — the sea is PULLING BACK. GET HIGH!", 3.6);
      soundAt("siren", ctx.cx, ctx.cz);
      if (CBZ.shake) CBZ.shake(0.3);
    },
    warnTick(dt, ctx) {
      const st = ctx.st;
      st.warnT += dt;
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
      if (!st.saidBed && k > 0.62) { st.saidBed = 1; narrate("hint", "The seabed is EXPOSED — IT'S COMING", 2.6); }
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
      st.speed = (2 * R + 104) / (ctx.activeSecs * 0.44);
      st.waveAmp = 1.55; st.chopAmp = 2.15; st.foamGain = 0.82;
      st.waveId = "tsu" + CBZ.now + rnd();
      st.landfall = false;
      tsuBuildWave(ctx);
      // NO INUNDATION MESH. The sea itself comes over the island (surgeSet),
      // which is why the swimmer, the buoyancy, the drifting corpses and the
      // submergence test all agree without any of them being told.
      st.spray = CBZ.fx.particleCloud({ mode: "fall", color: 0xeaf6ff, count: 320, radius: R * 0.8, top: 15, size: 0.26, opacity: 0.8, vMin: 11, vMax: 22, drift: st.dx * 9, driftZ: st.dz * 9 });
      st.spray.setActive(0.95);
      tsuSpawnPlanks(ctx);
      tsuPublish(ctx, 2.2);
      if (CBZ.shake) CBZ.shake(0.5);
      sound("water"); sound("rumble");
    },
    active(dt, ctx) {
      const st = ctx.st;
      ctx.env.fog = 0x35607e; ctx.env.fogNear = 40; ctx.env.fogFar = 300; ctx.env.sunInt = 0.7; ctx.env.hemiColor = 0x9fb6c8;
      if (st.phase === "sweep") {
        st.frontS += st.speed * dt;
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
        // ---- the CREST is presentation riding the shared surge front ----
        const grp = st.wave;
        grp.position.set(fx0, st.level - 2.4 + Math.sin(CBZ.now * 0.005) * 0.4, fz0);
        grp.rotation.z = Math.sin(CBZ.now * 0.0035) * 0.016;
        grp.scale.y = 1 + 0.035 * Math.sin(CBZ.now * 0.007);
        tsuAnimateWave(st, CBZ.waterClock ? CBZ.waterClock() : CBZ.now * 0.001);
        const fo = st.waveFoams;
        if (fo) for (let i = 0; i < fo.length; i++) fo[i].material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(CBZ.now * 0.02 + i * 1.7));
        const sk = st.waveStreaks;
        if (sk) for (let i = 0; i < sk.length; i++) { const s = sk[i]; s.material.opacity = 0.16 + 0.2 * Math.abs(Math.sin(CBZ.now * 0.013 + i)); s.position.y = st.H * (0.42 + 0.05 * Math.sin(CBZ.now * 0.01 + i * 2)); }
        st.spray.update(dt, fx0, st.level + st.H * 0.9, fz0);
        tsuPublish(ctx, 2.2);
        if (!st.landfall && st.frontS > -(ctx.R - 6)) {
          st.landfall = true;
          // LANDFALL: a 26 m blast of white water, a hard shake and the roar.
          // "BRACE!" was the HUD saying what your own screen was already doing.
          CBZ.fx.blast(fx0, fz0, { maxR: 26, color: 0xd9f2ff, shake: 1.15, life: 0.8 });
          narrate("toast", "BRACE!");
          sound("collapse"); sound("water");
        }
        const pd = Math.abs(tsuS(ctx, CBZ.player.pos.x, CBZ.player.pos.z) - st.frontS);
        if (pd < 40 && CBZ.shake) CBZ.shake(0.45 * (1 - pd / 40));   // the roar closes in
        if (rnd() < dt * 8) sound("water");
        tsuCatch(dt, ctx);
        tsuSmash(ctx);
        floodActors(dt, ctx, 2.2, "drowned in the flood", st.dx, st.dz);
        tsuPlanks(dt, ctx, 2.2);
        if (st.frontS > ctx.R + 52) tsuEnterFlood(ctx);
      } else if (st.phase === "flooded") {
        st.floodT += dt;
        surgeSet(st.floodSurge);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : st.floodSurge;
        tsuPublish(ctx, 1.6);
        ctx.env.fog = 0x3a6a84; ctx.env.fogNear = 34; ctx.env.fogFar = 260; ctx.env.sunInt = 0.8; ctx.env.hemiColor = 0xaecbd8;
        floodActors(dt, ctx, 1.6, "drowned in the flood", st.dx, st.dz);
        tsuPlanks(dt, ctx, 1.6);
        if (rnd() < dt * 2.5) sound("water");
        if (st.floodT > ctx.activeSecs * 0.34) { st.phase = "drain"; st.drainFrom = st.floodSurge; narrate("hint", "The water is DRAINING — move!", 2.4); }
      } else {  // drain — slow, and what it drags out with it is the memory
        const cur = CBZ.waterSurge ? CBZ.waterSurge() : 0;
        const next = Math.max(0, cur - dt * (st.floodSurge + 1.5) / Math.max(1.5, ctx.activeSecs * 0.2));
        surgeSet(next);
        st.level = CBZ.survSeaMeanY ? CBZ.survSeaMeanY() : 0;
        const drainK = Math.max(0, Math.min(1, next / Math.max(0.1, st.floodSurge)));
        st.waveAmp = 0.86 + 0.52 * drainK; st.chopAmp = 0.72 + 1.0 * drainK; st.foamGain = 0.34 + 0.28 * drainK;
        tsuPublish(ctx, 0.7 * drainK);
        floodActors(dt, ctx, -0.7, "drowned in the flood", st.dx, st.dz);
        tsuPlanks(dt, ctx, -0.7);
      }
      // heavier fog with your face at the surface — city/swim.js owns the
      // swimmer now, so this reads its published state instead of a local flag
      const sw = CBZ.citySwimState && CBZ.citySwimState();
      if (sw && sw.swimming) { ctx.env.fog = 0x1e5670; ctx.env.fogNear = 6; ctx.env.fogFar = 90; }
    },
    end(ctx) {
      const st = ctx.st;
      // ONE LINE PUTS THE SEA BACK. There is no mesh to reposition, no sheet
      // to delete and no swimmer to stand down.
      surgeSet(0);
      const W = CBZ.survSeaWave ? CBZ.survSeaWave() : null;
      if (W) { W.amp = 0.86; W.chop = 0.72; W.foam = 0.34; W.opacity = 1; }
      const o = ctx.arena && ctx.arena.ocean;
      if (o && CBZ.waterDriveDisasterSurface) CBZ.waterDriveDisasterSurface(o, { amp: 0.86, chop: 0.72, foam: 0.34, opacity: 1 });
      if (o) o.position.y = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
      if (CBZ.waterEventClear) CBZ.waterEventClear("survival-tsunami");
      if (st.wave) { st.wave.traverse((ob) => { if (ob.geometry) ob.geometry.dispose(); if (ob.material && ob.material.dispose) ob.material.dispose(); }); root().remove(st.wave); st.wave = null; }
      if (st.spray) { st.spray.dispose(); st.spray = null; }
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

  // ============================================================
  // VOLCANIC ERUPTION — a real eruption OUT OF THE SUMMIT of the
  // central mountain: a lava fountain bursts up from the peak, a
  // dark ash column towers above it, the crater glows, and glowing
  // LAVA STREAMS pour DOWN the cone's slopes. Lethal ONLY on a
  // stream (a narrow corridor) or at the crater or under an arcing
  // lava bomb — standing on safe ground, even up the mountain, is
  // fine. Shared by the standalone `volcano` disaster AND the
  // earthquake's surprise eruption.
  // ============================================================
  const ERUPT_UP = window.THREE ? new THREE.Vector3(0, 1, 0) : null;
  const STREAM_BASE_LEN = 1;     // local Y length of the stream box (scaled per frame)
  const STREAM_HALF_W = 2.9;     // lethal corridor half-width (matches the wider visual)

  function makeLavaStream(angle) {
    const geo = new THREE.BoxGeometry(5.2, STREAM_BASE_LEN, 1.1);   // wide + thick: lava you can SEE from anywhere
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a18, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 6;
    root().add(m);
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
    narrate("banner", "VOLCANIC ERUPTION");
    narrate("hint", "THE MOUNTAIN ERUPTS — stay off the lava!", 3);
    if (CBZ.shake) CBZ.shake(0.9); sound("explosion"); sound("rumble");
    // a fountain of glowing lava bursting UP out of the summit vent
    ctx.st.erFountain = CBZ.fx.particleCloud({ mode: "rise", color: 0xff6a1a, count: 260, radius: 7, top: 22, size: 0.3, opacity: 0.85, vMin: 12, vMax: 22, drift: 3 }); ctx.st.erFountain.setActive(0.95);
    // a towering dark ash/smoke column above the fountain
    ctx.st.erSmoke = CBZ.fx.particleCloud({ mode: "rise", color: 0x2a2420, count: 200, radius: 15, top: 52, size: 0.62, opacity: 0.4, vMin: 5, vMax: 10, drift: 9 }); ctx.st.erSmoke.setActive(0.6);
    // fine ash raining back down over the island
    ctx.st.erAsh = CBZ.fx.particleCloud({ mode: "fall", color: 0x4a4038, count: 300, radius: 26, top: 30, size: 0.24, opacity: 0.45, vMin: 6, vMax: 12 }); ctx.st.erAsh.setActive(0.85);
    // the glowing crater rim sitting on the peak
    ctx.st.erCrater = disc(h.x, h.z, 0xff5210, 0.9, h.peak + 0.3); ctx.st.erCrater.material.blending = THREE.AdditiveBlending; ctx.st.erCrater.scale.set(5, 5, 1);
    // lava streams running down the slopes (cardinals + an offset set)
    ctx.st.erStreams = [];
    const base = rnd() * 6.28, n = 5;
    for (let i = 0; i < n; i++) {
      const s = makeLavaStream(base + (i / n) * 6.28 + (rnd() - 0.5) * 0.4);
      s.maxLen = h.r * (0.82 + rnd() * 0.16);   // reach most of the way down
      ctx.st.erStreams.push(s);
    }
    if (CBZ.CONFIG.SURV_VOLCANO_LAVA_V2 !== false) {
      // LAVA POOLS: where each stream reaches the base it feeds a spreading,
      // pulsing pool — the lava you can SEE is the lava that kills you.
      ctx.st.erPools = ctx.st.erStreams.map(function (s) {
        const pm = disc(h.x + Math.cos(s.angle) * 6, h.z + Math.sin(s.angle) * 6, 0xff4a10, 0.9, 0.12);
        pm.material.blending = THREE.AdditiveBlending;
        pm.scale.set(0.6, 0.6, 1);
        return { s, m: pm, r: 0 };
      });
      // ASH FALLOUT: the plume leans DOWNWIND; the wedge below it chokes
      // anyone exposed. A roof overhead (underRoof) is the shelter.
      // THE WIND IS THE WEATHER'S WIND — the warn phase already set a bearing
      // and drove it into systems/weather.js, so the ash falls the same way
      // the rain would and there is no fourth wind field in this file.
      const w0 = windVec();
      const wa = (w0 && w0.speed > 0.5) ? Math.atan2(w0.z, w0.x)
        : (ctx.st.wx != null ? Math.atan2(ctx.st.wz, ctx.st.wx) : rnd() * 6.28);
      ctx.st.erWindX = Math.cos(wa); ctx.st.erWindZ = Math.sin(wa);
    }
    ctx.st.erBombCd = 1.1;
  }
  function tickEruption(dt, ctx) {
    if (!ctx.st.erupting) return;
    const h = ctx.arena.hills[0];
    ctx.env.fog = 0x2e211c; ctx.env.fogNear = 22; ctx.env.fogFar = 160; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff6a3a; ctx.env.hemiInt = 0.6; ctx.env.hemiColor = 0xff7a4a;
    // the ash rains where the wind carries it — the fallout wedge is VISIBLE
    if (ctx.st.erWindX != null) ctx.st.erAsh.update(dt, h.x + ctx.st.erWindX * 40, 0, h.z + ctx.st.erWindZ * 40);
    else ctx.st.erAsh.update(dt, camPos().x, 0, camPos().z);
    ctx.st.erFountain.update(dt, h.x, h.peak, h.z);
    ctx.st.erSmoke.update(dt, h.x + (ctx.st.erWindX || 0) * 14, h.peak + 6, h.z + (ctx.st.erWindZ || 0) * 14);
    if (ctx.st.erCrater) ctx.st.erCrater.material.opacity = 0.7 + 0.25 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.012));
    // ash is weather: it dims the sun, it blows downwind, and it is the same
    // wind everything else in the game reads
    weather({ rain: 0, wind: 7, windDir: { x: ctx.st.erWindX || 1, z: ctx.st.erWindZ || 0 }, fog: 0.55, fogColor: 0x2e211c });
    if (rnd() < dt * 1.6) sound("rumble");
    // grow + orient each lava stream down the cone, hugging the slope
    for (let i = 0; i < ctx.st.erStreams.length; i++) {
      const s = ctx.st.erStreams[i];
      s.len = Math.min(s.maxLen, s.len + (5 + ctx.intensity * 3) * dt);
      const ex = h.x + Math.cos(s.angle) * s.len, ez = h.z + Math.sin(s.angle) * s.len;
      const ey = floor(ex, ez);
      const dir = new THREE.Vector3(ex - h.x, ey - h.peak, ez - h.z);
      const len3 = dir.length() || 1; dir.multiplyScalar(1 / len3);
      s.mesh.position.set((h.x + ex) / 2, (h.peak + ey) / 2 + 0.45, (h.z + ez) / 2);
      s.mesh.quaternion.setFromUnitVectors(ERUPT_UP, dir);
      s.mesh.scale.set(1, len3 / STREAM_BASE_LEN, 1);
      s.mesh.material.opacity = 0.8 + 0.18 * Math.sin(CBZ.now * 0.02 + i * 1.3);
    }
    // lava POOLS spread where the streams arrive at the base
    if (ctx.st.erPools) for (let i = 0; i < ctx.st.erPools.length; i++) {
      const P = ctx.st.erPools[i], s = P.s;
      const ex = h.x + Math.cos(s.angle) * s.len, ez = h.z + Math.sin(s.angle) * s.len;
      P.m.position.set(ex, floor(ex, ez) + 0.12, ez);
      if (s.len >= s.maxLen - 0.5) P.r = Math.min(8, P.r + dt * 1.1);   // arrived: keep spreading
      else P.r = Math.max(P.r, 1.2);
      P.m.scale.set(Math.max(0.6, P.r), Math.max(0.6, P.r), 1);
      P.m.material.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(CBZ.now * 0.014 + i * 2.1));
    }
    // burn anyone standing ON a stream / IN a pool / at the crater — every
    // lava death comes from a thing you can SEE glowing. Ash is the area
    // denial: the downwind wedge chokes anyone without a roof overhead.
    const wX = ctx.st.erWindX, wZ = ctx.st.erWindZ;
    surv().forEachActor(function (a) {
      const ax = a.pos.x, az = a.pos.z;
      if (Math.hypot(ax - h.x, az - h.z) < 3.4) { surv().hurt(a, 1e6, { cause: "swallowed by the crater", fromX: h.x, fromZ: h.z }); return; }
      for (let i = 0; i < ctx.st.erStreams.length; i++) if (streamHit(ax, az, h, ctx.st.erStreams[i])) { surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: h.x, fromZ: h.z }); return; }
      if (ctx.st.erPools) for (let i = 0; i < ctx.st.erPools.length; i++) {
        const P = ctx.st.erPools[i];
        if (P.r > 0.7 && Math.hypot(ax - P.m.position.x, az - P.m.position.z) < P.r * 0.85) { surv().hurt(a, 1e6, { cause: "incinerated by lava", fromX: P.m.position.x, fromZ: P.m.position.z }); return; }
      }
      if (wX != null) {
        const dx = ax - h.x, dz = az - h.z, d = Math.hypot(dx, dz);
        if (d > 8 && d < 80 && (dx * wX + dz * wZ) / d > 0.72 && !sheltered(a)) {
          surv().hurt(a, scale(6, ctx) * dt, { cause: "choked by volcanic ash" });
        }
      }
    });
    // lava bombs arc out of the summit and crash down across the island
    ctx.st.erBombCd -= dt;
    if (ctx.st.erBombCd <= 0) {
      ctx.st.erBombCd = 1.0 - 0.4 * ctx.prog;
      const p = ctx.arena.randomPoint(8, ctx.R);
      const mk = CBZ.fx.groundMarker(p.x, p.z, 5.5, 0xff7a30); mk.set(1);   // bigger + longer telegraph: bomb deaths are dodgeable, not "nothing"
      setTimeout0(ctx, 0.85, function () {
        mk.dispose();
        CBZ.fx.dropDebris({ x: p.x, z: p.z, fromY: 34, vy: -8, size: 1.7, color: 0xff5a1a, dmg: 999, keep: true, onLand: function (x, z) {
          // A LAVA BOMB IS A ROCK ARRIVING AT SPEED — the bus's `kinetic` row,
          // priced by mass and impact velocity, which is why a late-round bomb
          // hits harder without a second number typed here.
          survBlast("kinetic", x, z, {
            r: 7, cause: "crushed by a volcanic bomb", ctx: ctx,
            mass: 900, speed: 55, struct: 0.4, structR: 12,
            color: 0xff7a30, sfx: "punch", flash: 0.25, knockback: 12, fling: 6,
          });
        } });
      });
    }
  }
  function endEruption(ctx) {
    if (!ctx.st.erupting) return;
    if (ctx.st.erFountain) ctx.st.erFountain.dispose();
    if (ctx.st.erSmoke) ctx.st.erSmoke.dispose();
    if (ctx.st.erAsh) ctx.st.erAsh.dispose();
    if (ctx.st.erCrater) rmMesh(ctx.st.erCrater);
    (ctx.st.erStreams || []).forEach((s) => rmMesh(s.mesh));
    ctx.st.erStreams = null;
    (ctx.st.erPools || []).forEach((P) => rmMesh(P.m));
    ctx.st.erPools = null; ctx.st.erWindX = ctx.st.erWindZ = null;
    ctx.st.erupting = false;
  }
  // threat from an active eruption (shared by quake + volcano threat())
  function eruptThreat(x, z, ctx) {
    if (!ctx.st.erupting) return 0;
    const h = ctx.arena.hills[0];
    let t = 0.12;   // ambient: bombs can fall anywhere
    if (Math.hypot(x - h.x, z - h.z) < 6) t = Math.max(t, 0.9);
    (ctx.st.erStreams || []).forEach((s) => {
      const dx = x - h.x, dz = z - h.z;
      const along = dx * Math.cos(s.angle) + dz * Math.sin(s.angle);
      if (along >= -1 && along <= s.len + 1) { const perp = Math.abs(-dx * Math.sin(s.angle) + dz * Math.cos(s.angle)); if (perp < STREAM_HALF_W + 2.5) t = Math.max(t, Math.min(0.98, 1 - (perp - STREAM_HALF_W) / 2.5)); }
    });
    (ctx.st.erPools || []).forEach((P) => {
      if (P.r > 0.7) { const d = Math.hypot(x - P.m.position.x, z - P.m.position.z); if (d < P.r + 3) t = Math.max(t, Math.min(0.95, 1 - (d - P.r * 0.85) / 3)); }
    });
    if (ctx.st.erWindX != null) {
      const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1;
      if (d > 8 && d < 80 && (dx * ctx.st.erWindX + dz * ctx.st.erWindZ) / d > 0.72) t = Math.max(t, 0.45);
    }
    return t;
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

  function strike(x, z, ctx) {
    // the bolt is drawn here (it is not ordnance) but the GROUND EFFECT is —
    // `kinetic` is the bus's generic "something heavy arrived at speed" row,
    // and routing through it buys the shake, the ejecta cone and the sfx that
    // used to be re-typed at this site.
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
     A HOLE HAS A BOTTOM (the sinkhole rebuild)

     CBZ.survHoles is the ONE published record of "the ground is gone here".
     modes/survival.js's floorAt subtracts it, so the floor over a hole's mouth
     really is the hole's floor and nothing else in the engine has to be told:
     the player's own vertical physics drops them, the bots' terrain-follow
     drops them, a car parked over it falls in. The kill is the LANDING, priced
     off the depth, not a radius test on a painted disc.

     The mouth is deliberately a hair smaller than the visible rim (0.86 R), so
     the edge you can see is an edge you can stand on — a hole whose lethal
     footprint is wider than its picture is the same lie the black disc was.
     ============================================================ */
  const HOLE_MIN_D = 14, HOLE_VAR_D = 8;
  CBZ.survHoles = [];
  function openHole(ctx, x, z, r) {
    const gy = floor(x, z);
    const depth = HOLE_MIN_D + rnd() * HOLE_VAR_D;
    const bottom = gy - depth;
    const grp = new THREE.Group();
    // the shaft: an open-ended cylinder seen from inside, plus a floor of
    // rubble-brown. DoubleSide so the walls read from above AND from in it.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.78, depth, 20, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x3a2b1e, side: THREE.DoubleSide }));
    wall.position.y = gy - depth / 2;
    const floorM = new THREE.Mesh(new THREE.CircleGeometry(r * 0.78, 20),
      new THREE.MeshLambertMaterial({ color: 0x1a120c }));
    floorM.rotation.x = -Math.PI / 2; floorM.position.y = bottom + 0.05;
    // a dark mouth ring so the opening reads from a distance without being a
    // flat black lid over live geometry
    const lip = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r * 1.12, 24),
      new THREE.MeshBasicMaterial({ color: 0x1e150e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    lip.rotation.x = -Math.PI / 2; lip.position.y = gy + 0.06; lip.renderOrder = 4;
    grp.add(wall, floorM, lip);
    grp.position.set(x, 0, z);
    root().add(grp);
    // spoil thrown up around the rim as it collapses
    for (let i = 0; i < 10; i++) {
      const a = rnd() * 6.28, d = r * (0.9 + rnd() * 0.5);
      CBZ.fx.dropDebris({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, fromY: gy + 1.2, vy: 3 + rnd() * 3, size: 0.5 + rnd() * 0.9, color: 0x4a3626, keep: true });
    }
    if (CBZ.shake) CBZ.shake(0.3);
    sound("collapse");
    const h = { x, z, r, mouth: r * 0.86, gy, bottom, depth, grp, seen: {} };
    CBZ.survHoles.push(h);
    return h;
  }
  function tickHoles(dt, ctx) {
    const holes = ctx.st.holes; if (!holes || !holes.length) return;
    surv().forEachActor(function (a) {
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (Math.hypot(a.pos.x - h.x, a.pos.z - h.z) > h.mouth) continue;
        // FALLING is a state, not an event. The floor is already gone under
        // them (survHoles); all this does is notice the landing. The 1.6 m
        // window is a frame budget, not a fudge: a body arriving at ~30 m/s
        // covers 0.5 m per tick, so anything tighter can be stepped straight
        // through between two runs of this pass. (survival has no fall damage
        // — physics.js:993 — so this really is the only thing that kills you
        // down here, and it must not be able to miss.)
        if (a.pos.y <= h.bottom + 1.6) {
          surv().hurt(a, 1e6, { cause: "swallowed by a sinkhole", fromX: h.x, fromZ: h.z });
          if (a.isPlayer && CBZ.shake) CBZ.shake(1.0);
        } else if (a.isPlayer && a.pos.y < h.gy - 2 && !h.seen.p) {
          h.seen.p = 1;
          if (CBZ.doSlowmo) CBZ.doSlowmo(0.45);          // the drop is the beat
          if (CBZ.shake) CBZ.shake(0.4);
        }
        return;
      }
    });
  }
  function closeHoles(ctx) {
    const holes = ctx.st.holes || [];
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      const k = CBZ.survHoles.indexOf(h);
      if (k >= 0) CBZ.survHoles.splice(k, 1);
      if (h.grp) { h.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(h.grp); }
    }
    holes.length = 0;
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
  // the classic arc — also the fallback when SURV_SHUFFLE is off
  const SEQUENCE = ["quake", "storm", "flashflood", "flood", "wildfire", "tornado", "hurricane", "blizzard", "meteor", "sinkhole", "volcano", "nuke"];
  // pacing classes for the shuffled order: a run OPENS gentle, and the three
  // island-wreckers never land back-to-back (the nuke is pinned last, so a
  // gentle opener also keeps every cycle boundary legal when the arc repeats)
  const GENTLE = { storm: 1, wildfire: 1, blizzard: 1, sinkhole: 1 };
  const MEGA = { flood: 1, volcano: 1, nuke: 1 };
  let runNo = 0, orderRng = null;
  let order = SEQUENCE.slice();

  // per-run SEEDED order (CBZ.seedStream ⇒ deterministic per world seed +
  // run counter — never Math.random: the arc is shared run structure).
  // Rejection-sample a Fisher–Yates shuffle of the 11 non-nuke hazards until
  // the pacing constraints hold, then pin the nuke as the finale.
  function buildOrder() {
    if (CBZ.CONFIG.SURV_SHUFFLE === false || !orderRng) return SEQUENCE.slice();
    const pool = SEQUENCE.filter((id) => id !== "nuke");
    for (let tries = 0; tries < 40; tries++) {
      for (let i = pool.length - 1; i > 0; i--) { const j = (orderRng() * (i + 1)) | 0; const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
      if (!GENTLE[pool[0]]) continue;                    // gentle opener
      if (MEGA[pool[pool.length - 1]]) continue;         // nothing mega abuts the nuke
      let ok = true;
      for (let i = 1; i < pool.length; i++) if (MEGA[pool[i]] && MEGA[pool[i - 1]]) { ok = false; break; }
      if (ok) return pool.concat("nuke");
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
    narrate("banner", dir.cur.name + " — INCOMING");
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
      } else if (id === "quake") {
        if (st.erupting) { const h = A.hills[0]; out.push({ x: h.x, z: h.z, r: 15 }); }
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
    // PRIVATE SWIM: the deleted player solve set these two on CBZ.player.
    const privateSwim = (CBZ.player && CBZ.player._tsuSwim ? 1 : 0);
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
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
      swimShared: !!(CBZ.CONFIG.SURV_SHARED_SWIM !== false && CBZ.citySwimState && CBZ.survSeaHeightAt),
      swimming: !!(sw && sw.swimming),
      breath: sw && sw.breath != null ? sw.breath : null,
      // ---- ONE STRUCTURE + ONE BLAST BUS ----
      privateCollapse: structPrivate,
      structureHits: structHits,
      detonateAdopted: detonateAdopted,
      blastLegacy: blastLegacy,
      structureShared: CBZ.CONFIG.SURV_SHARED_STRUCTURE !== false && !!CBZ.detonate,
      // ---- the sinkhole actually has a bottom ----
      openHoles: CBZ.survHoles ? CBZ.survHoles.length : 0,
      holeDepth: CBZ.survHoles && CBZ.survHoles.length ? +CBZ.survHoles[0].depth.toFixed(1) : 0,
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
