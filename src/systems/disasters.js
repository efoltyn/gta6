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

   Flags: CBZ.CONFIG.SURV_SHUFFLE (seeded per-run order, default on) ·
   CBZ.CONFIG.SURV_TELEGRAPH (warn tint/shake/cue, default on) ·
   CBZ.CONFIG.SURV_TSUNAMI_V2 (the rebuilt tsunami event arc, default on;
   false restores the legacy wall — see TSUNAMI_LEGACY below).
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

  function rnd() { return Math.random(); }
  function camPos() { return CBZ.camera.position; }
  function root() { return CBZ.surv.arena.root; }
  function floor(x, z) { return CBZ.surv.arena.groundHeightAt(x, z); }
  function scale(base, ctx) { return base * (0.85 + ctx.intensity); }
  function sound(name) { if (CBZ.sfx) CBZ.sfx(name); }
  function banner(html, on) { if (CBZ.survHud && CBZ.survHud.banner) CBZ.survHud.banner(html, on); }

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
  //      right KIND of place. SURV_PHYSICAL_SHELTER=false disables the checks
  //      (and survival.js brings the legacy zone ring back). ----
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

  // ============================================================
  // THE ROSTER
  // ============================================================
  const DEFS = {

    // ---- EARTHQUAKE: shake + toppling buildings + crushing debris ----
    quake: {
      name: "EARTHQUAKE", emoji: "🌋", warnSecs: 5, activeSecs: 15, gap: 7, cause: "crushed under collapsing rubble", tint: 0x8a7f6c,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("The ground is rumbling…", 2.2); sound("rumble"); },
      start(ctx) {
        ctx.st.dust = CBZ.fx.particleCloud({ mode: "rise", color: 0xb6a892, count: 160, radius: ctx.R, top: 8, size: 0.32, opacity: 0.34, vMin: 1, vMax: 3 });
        ctx.st.dust.setActive(0.7);
        // only SOME buildings come down — a quake doesn't flatten the whole city.
        // shuffle, then cap to a fraction so plenty are left standing.
        const standing = ctx.arena.fragile.filter((b) => !b.fallen).sort(() => rnd() - 0.5);
        ctx.st.order = standing.slice(0, Math.max(1, Math.ceil(standing.length * 0.3)));
        ctx.st.next = 1.2;
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
          collapse(ctx.st.order.pop(), ctx);
        }
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
      name: "LIGHTNING STORM", emoji: "⚡", warnSecs: 4, activeSecs: 16, gap: 6, cause: "struck by lightning", tint: 0x3a4150,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("Storm rolling in — keep moving!", 2.4); sound("thunder"); },
      start(ctx) {
        ctx.st.rain = CBZ.fx.particleCloud({ mode: "fall", color: 0xaebfd0, count: 360, radius: 20, top: 22, size: 0.14, opacity: 0.5, vMin: 30, vMax: 46, drift: 6 });
        ctx.st.pending = []; ctx.st.bolts = []; ctx.st.cd = 0.6;
      },
      active(dt, ctx) {
        ctx.env.fog = 0x3a4150; ctx.env.fogNear = 30; ctx.env.fogFar = 200; ctx.env.sunInt = 0.4; ctx.env.hemiInt = 0.5; ctx.env.hemiColor = 0x8794ad;
        ctx.st.rain.setActive(0.9); ctx.st.rain.update(dt, camPos().x, 0, camPos().z);
        // schedule strikes (bias toward where actors are)
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = (0.9 - 0.5 * ctx.prog) * (0.6 + rnd());
          let tx, tz; const acts = surv().actors();
          if (acts.length && rnd() < 0.7) { const a = acts[(rnd() * acts.length) | 0]; tx = a.pos.x + (rnd() - 0.5) * 10; tz = a.pos.z + (rnd() - 0.5) * 10; }
          else { const p = ctx.arena.randomPoint(0, ctx.zone ? ctx.zone.radius : ctx.R); tx = p.x; tz = p.z; }
          ctx.st.pending.push({ x: tx, z: tz, t: 0.95, m: CBZ.fx.groundMarker(tx, tz, 4.5, 0x9fd0ff) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 0.95);
          if (p.t <= 0) { strike(p.x, p.z, ctx); p.m.dispose(); ctx.st.pending.splice(i, 1); }
        }
        for (let i = ctx.st.bolts.length - 1; i >= 0; i--) { const b = ctx.st.bolts[i]; b.life -= dt; b.mesh.material.opacity = Math.max(0, b.life / 0.16); if (b.life <= 0) { rmMesh(b.mesh); ctx.st.bolts.splice(i, 1); } }
      },
      end(ctx) { if (ctx.st.rain) ctx.st.rain.dispose(); (ctx.st.pending || []).forEach((p) => p.m.dispose()); (ctx.st.bolts || []).forEach((b) => rmMesh(b.mesh)); },
      threat(x, z, ctx) { let t = 0.1; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < 7) t = Math.max(t, 0.95 * (1 - d / 7)); }); return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 8 && d > 0.1) { bx += dx / d; bz += dz / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- TSUNAMI: assigned right after this roster (DEFS.flood, below).
    //      CBZ.CONFIG.SURV_TSUNAMI_V2 (default true) picks the rebuilt
    //      real-event arc; false restores the legacy layered-plane wall. ----

    // ---- FLASH FLOOD: torrential rain + a fast, muddy surge that swamps the
    //      low ground (the old-style sweeping wall, smaller + slower, plus a
    //      rising flood pool). Less wall-of-doom than the tsunami; the rain is
    //      the mood. ----
    flashflood: {
      name: "FLASH FLOOD", emoji: "🌧️", warnSecs: 5, activeSecs: 18, gap: 6, cause: "swept away by the flood surge", tint: 0x59636b,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("FLASH FLOOD — water rising, get HIGH!", 3); sound("alarm"); sound("water"); },
      start(ctx) {
        ctx.st.rain = CBZ.fx.particleCloud({ mode: "fall", color: 0x9fb4c4, count: 460, radius: ctx.R, top: 26, size: 0.13, opacity: 0.55, vMin: 34, vMax: 52, drift: 10 });
        ctx.st.rain.setActive(0.95);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(ctx.R * 3, ctx.R * 3),
          new THREE.MeshLambertMaterial({ color: 0x4a5a3e, transparent: true, opacity: 0.82 }));
        m.rotation.x = -Math.PI / 2; m.position.set(ctx.cx, -3, ctx.cz); m.renderOrder = 2; m.material.depthWrite = false; root().add(m);
        ctx.st.water = m; ctx.st.y = -3; ctx.st.peak = Math.min(ctx.arena.hills[0].peak - 4, 5 + scale(3, ctx));
        // the OLD-style surge: a flat translucent wall + a thin white crest
        const W = ctx.R * 3, Hh = 13;
        const wave = new THREE.Group();
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.MeshLambertMaterial({ color: 0x3c6a72, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }));
        wall.position.y = Hh / 2; wall.renderOrder = 3;
        const crest = new THREE.Mesh(new THREE.PlaneGeometry(W, 3.2), new THREE.MeshBasicMaterial({ color: 0xe8f4ee, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        crest.position.set(0, Hh - 1.4, 1.4); crest.rotation.x = -0.6; crest.renderOrder = 4;
        wave.add(wall, crest); wave.rotation.y = -Math.PI / 2;
        ctx.st.waveX = ctx.cx - (ctx.R + 20); wave.position.set(ctx.st.waveX, ctx.st.y, ctx.cz); root().add(wave);
        ctx.st.wave = wave; ctx.st.waveH = Hh; ctx.st.passed = false;
        ctx.st.waveSpeed = (2 * ctx.R + 40) / (ctx.activeSecs * 0.62);
        ctx.st.waveId = (ctx.st.waveId || 0) + 1 + rnd();
        if (CBZ.shake) CBZ.shake(0.4);
      },
      active(dt, ctx) {
        ctx.env.fog = 0x59636b; ctx.env.fogNear = 22; ctx.env.fogFar = 150; ctx.env.sunInt = 0.55; ctx.env.hemiColor = 0x97a6b3;
        ctx.st.rain.update(dt, camPos().x, 0, camPos().z);
        const baseY = ctx.st.y;
        if (!ctx.st.passed) {
          ctx.st.waveX += ctx.st.waveSpeed * dt;
          ctx.st.wave.position.set(ctx.st.waveX, baseY + Math.sin(CBZ.now * 0.006) * 0.2, ctx.cz);
          surv().forEachActor(function (a) {
            if (floor(a.pos.x, a.pos.z) > baseY + 6) return;
            if (a.pos.x <= ctx.st.waveX + 1.5 && a.pos.x >= ctx.st.waveX - 6 && a._waveId !== ctx.st.waveId) { a._waveId = ctx.st.waveId; if (CBZ.body) CBZ.body.hit(a, { dir: { x: 1, z: 0 }, force: 7, fling: 3.5 }); surv().hurt(a, scale(16, ctx)); }
          });
          // the surge shoves cars around on the low ground too
          if (ctx.arena.cars) for (let i = 0; i < ctx.arena.cars.length; i++) { const car = ctx.arena.cars[i]; if (!car.flung && car.x <= ctx.st.waveX + 2 && car.x >= ctx.st.waveX - 8 && floor(car.x, car.z) <= baseY + 6) flingCar(car, 1, 0, 9 + scale(4, ctx), 4); }
          if (ctx.st.waveX > ctx.cx + ctx.R + 20) { ctx.st.passed = true; ctx.st.wave.visible = false; }
        }
        ctx.st.y += (ctx.st.peak - ctx.st.y) * Math.min(1, dt * (ctx.st.passed ? 0.5 : 0.2));
        const wy = ctx.st.y + Math.sin(CBZ.now * 0.004) * 0.14; ctx.st.water.position.y = wy;
        let playerSub = false;
        surv().forEachActor(function (a) {
          const gH = floor(a.pos.x, a.pos.z), sub = wy - gH;
          if (sub > 1.5) { surv().hurt(a, scale(18, ctx) * dt, { cause: "drowned in the floodwater" }); if (a.isPlayer) playerSub = true; }
          else if (sub > 0.4 && !a.isPlayer) { a.pos.x += (ctx.arena.hills[0].x - a.pos.x) * 0.02 * dt; a.pos.z += (ctx.arena.hills[0].z - a.pos.z) * 0.02 * dt; }
        });
        if (playerSub) { ctx.env.fog = 0x2c3a30; ctx.env.fogNear = 2; ctx.env.fogFar = 24; }
        if (rnd() < dt * 5) sound("water");
      },
      end(ctx) { if (ctx.st.rain) ctx.st.rain.dispose(); if (ctx.st.water) rmMesh(ctx.st.water); if (ctx.st.wave) { ctx.st.wave.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(ctx.st.wave); } },
      threat(x, z, ctx) { let t = 0; if (ctx.st.wave && !ctx.st.passed) { const d = Math.abs(x - (ctx.st.waveX || 0)); if (d < 22) t = Math.max(t, 0.5 + 0.4 * (1 - d / 22)); } const sub = (ctx.st.y || -3) - floor(x, z); if (sub > -1) t = Math.max(t, Math.min(1, 0.4 + sub * 0.25)); return t; },
      safeDir(x, z, ctx) { const h = ctx.arena.hills[0]; const dx = h.x - x, dz = h.z - z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
    },

    // ---- HURRICANE: shrieking wind drags everyone downwind, blinding rain,
    //      swirling debris, and violent gusts that knock you flat. The wind
    //      direction slowly veers, so high ground alone won't save you. ----
    hurricane: {
      name: "HURRICANE", emoji: "🌀", warnSecs: 5, activeSecs: 20, gap: 7, cause: "killed by hurricane debris", tint: 0x46505a,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("HURRICANE inbound — brace and hold on!", 3); sound("alarm"); sound("wind"); },
      start(ctx) {
        ctx.st.rain = CBZ.fx.particleCloud({ mode: "fall", color: 0xb3c4d2, count: 520, radius: ctx.R, top: 24, size: 0.12, opacity: 0.5, vMin: 40, vMax: 60, drift: 22 });
        ctx.st.rain.setActive(0.95);
        ctx.st.debris = CBZ.fx.particleCloud({ mode: "swirl", color: 0x7a6f5a, count: 200, radius: ctx.R * 0.7, top: 10, size: 0.3, opacity: 0.6, vMin: 8, vMax: 16 });
        ctx.st.debris.setActive(0.8);
        const a = rnd() * 6.28; ctx.st.wx = Math.cos(a); ctx.st.wz = Math.sin(a);   // wind heading
        ctx.st.gustCd = 2; ctx.st.turn = (rnd() - 0.5) * 0.2;
      },
      active(dt, ctx) {
        ctx.env.fog = 0x46505a; ctx.env.fogNear = 16; ctx.env.fogFar = 120; ctx.env.sunInt = 0.5; ctx.env.hemiColor = 0x8a98a6;
        ctx.st.rain.update(dt, camPos().x, 0, camPos().z);
        ctx.st.debris.update(dt, camPos().x, 4, camPos().z);
        // the wind slowly veers so its direction can't be simply outrun
        const ang = Math.atan2(ctx.st.wz, ctx.st.wx) + ctx.st.turn * dt;
        ctx.st.wx = Math.cos(ang); ctx.st.wz = Math.sin(ang);
        const wx = ctx.st.wx, wz = ctx.st.wz;
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
        }
      },
      end(ctx) { if (ctx.st.rain) ctx.st.rain.dispose(); if (ctx.st.debris) ctx.st.debris.dispose(); },
      threat(x, z, ctx) { return 0.4; },
      safeDir(x, z, ctx) { return { x: -(ctx.st.wx || 0), z: -(ctx.st.wz || 0) }; },
    },

    // ---- WILDFIRE: fire spreads tree to tree, burns on contact ----
    wildfire: {
      name: "WILDFIRE", emoji: "🔥", warnSecs: 5, activeSecs: 18, gap: 6, cause: "burned alive in the wildfire", tint: 0x4a2814,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("Wildfire spreading — don't get cornered!", 2.6); sound("fire"); },
      start(ctx) {
        ctx.st.embers = CBZ.fx.particleCloud({ mode: "rise", color: 0xff7a1a, count: 320, radius: 28, top: 16, size: 0.26, opacity: 0.7, vMin: 5, vMax: 12, drift: 6 });
        ctx.st.embers.setActive(0.9);
        // a heavy rolling smoke pall above the flames
        ctx.st.smoke = CBZ.fx.particleCloud({ mode: "rise", color: 0x2b2521, count: 240, radius: 34, top: 40, size: 0.95, opacity: 0.26, vMin: 3, vMax: 7, drift: 10 });
        ctx.st.smoke.setActive(0.7);
        const tr = ctx.arena.flammable; ctx.st.spreadCd = 0;
        for (let i = 0; i < 4; i++) { const t = tr[(rnd() * tr.length) | 0]; if (t && !t.burnt) ignite(t); }
      },
      active(dt, ctx) {
        // smoke-choked, fire-lit sky: dim orange sun, low red-brown haze
        ctx.env.fog = 0x4a2814; ctx.env.fogNear = 16; ctx.env.fogFar = 145; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff7320; ctx.env.hemiColor = 0xff8a3a; ctx.env.hemiInt = 0.62;
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
          for (let i = 0; i < tr.length; i++) {
            const t = tr[i]; if (!t.burning) continue;
            for (let j = 0; j < tr.length; j++) { const o = tr[j]; if (o.burning || o.burnt) continue; if (Math.hypot(o.x - t.x, o.z - t.z) < 11 && rnd() < 0.5) ignite(o); }
          }
        }
        if (rnd() < dt * 3) sound("fire");
      },
      end(ctx) { if (ctx.st.embers) ctx.st.embers.dispose(); if (ctx.st.smoke) ctx.st.smoke.dispose(); ctx.arena.flammable.forEach((t) => { if (t.fire) removeTreeFire(t); }); },
      threat(x, z, ctx) { let t = 0; const tr = ctx.arena.flammable; for (let i = 0; i < tr.length; i++) if (tr[i].burning) { const d = Math.hypot(x - tr[i].x, z - tr[i].z); if (d < 7) t = Math.max(t, 1 - d / 7); } return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; const tr = ctx.arena.flammable; for (let i = 0; i < tr.length; i++) if (tr[i].burning) { const dx = x - tr[i].x, dz = z - tr[i].z, d = Math.hypot(dx, dz); if (d < 9 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } } return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- TORNADO: a wandering funnel that sucks in and flings ----
    tornado: {
      name: "TORNADO", emoji: "🌪️", warnSecs: 5, activeSecs: 18, gap: 6, cause: "torn apart by the tornado", tint: 0x6a6f7a,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("TORNADO touching down!", 2.6); sound("wind"); },
      start(ctx) {
        const grp = new THREE.Group();
        for (let i = 0; i < 6; i++) { const r = 1.2 + i * 1.5; const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, 4, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0x6a6f7a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })); m.position.y = 2 + i * 3.6; grp.add(m); }
        root().add(grp);
        const p = ctx.arena.randomPoint(0, ctx.R * 0.5);
        ctx.st.fx = grp; ctx.st.x = p.x; ctx.st.z = p.z; ctx.st.vx = (rnd() - 0.5) * 6; ctx.st.vz = (rnd() - 0.5) * 6;
        ctx.st.swirl = CBZ.fx.particleCloud({ mode: "swirl", color: 0x8a8f9a, count: 160, radius: 12, top: 20, size: 0.3, opacity: 0.6, vMin: 4, vMax: 10 });
        ctx.st.swirl.setActive(1);
      },
      active(dt, ctx) {
        // wander, bounce off the zone edge
        ctx.st.x += ctx.st.vx * dt; ctx.st.z += ctx.st.vz * dt;
        const cx = ctx.zone ? ctx.zone.cx : ctx.cx, cz = ctx.zone ? ctx.zone.cz : ctx.cz, rr = (ctx.zone ? ctx.zone.radius : ctx.R) - 6;
        if (Math.hypot(ctx.st.x - cx, ctx.st.z - cz) > rr) { ctx.st.vx += (cx - ctx.st.x) * 0.05; ctx.st.vz += (cz - ctx.st.z) * 0.05; }
        if (rnd() < dt) { ctx.st.vx += (rnd() - 0.5) * 3; ctx.st.vz += (rnd() - 0.5) * 3; }
        const gy = floor(ctx.st.x, ctx.st.z);
        ctx.st.fx.position.set(ctx.st.x, gy, ctx.st.z); ctx.st.fx.rotation.y += dt * 3;
        ctx.st.swirl.update(dt, ctx.st.x, gy, ctx.st.z);
        if (CBZ.shake) { const dp = Math.hypot(CBZ.player.pos.x - ctx.st.x, CBZ.player.pos.z - ctx.st.z); if (dp < 30) CBZ.shake(0.3 * (1 - dp / 30)); }
        if (rnd() < dt * 4) sound("wind");
        const suck = 18, kill = 4.5;
        surv().forEachActor(function (a) {
          const dx = ctx.st.x - a.pos.x, dz = ctx.st.z - a.pos.z, d = Math.hypot(dx, dz);
          if (d < kill) { surv().hurt(a, 1e6); }
          else if (d < suck) { const pull = (1 - d / suck) * 9 * dt; a.pos.x += dx / d * pull; a.pos.z += dz / d * pull; surv().hurt(a, scale(5, ctx) * dt); }
        });
      },
      end(ctx) { if (ctx.st.fx) { ctx.st.fx.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(ctx.st.fx); } if (ctx.st.swirl) ctx.st.swirl.dispose(); },
      threat(x, z, ctx) { const d = Math.hypot(x - (ctx.st.x || 0), z - (ctx.st.z || 0)); return d < 22 ? 1 - d / 22 : 0; },
      safeDir(x, z, ctx) { const dx = x - (ctx.st.x || 0), dz = z - (ctx.st.z || 0), d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
    },

    // ---- VOLCANO: ash-out, lava flows from the mountain, lava bombs ----
    volcano: {
      name: "VOLCANIC ERUPTION", emoji: "🌋", warnSecs: 6, activeSecs: 20, gap: 7, cause: "incinerated by lava", tint: 0x2e211c,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("THE VOLCANO IS WAKING — off the mountain, out of the ash!", 3); sound("rumble"); if (CBZ.shake) CBZ.shake(0.5); },
      start(ctx) { startEruption(ctx); },
      active(dt, ctx) { tickEruption(dt, ctx); tick0(ctx, dt); },
      end(ctx) { endEruption(ctx); },
      threat(x, z, ctx) { return eruptThreat(x, z, ctx); },
      safeDir(x, z, ctx) { const h = ctx.arena.hills[0]; const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz) || 1; return { x: dx / d, z: dz / d }; },
    },

    // ---- BLIZZARD: whiteout; freeze if you stop moving ----
    blizzard: {
      name: "BLIZZARD", emoji: "❄️", warnSecs: 5, activeSecs: 17, gap: 6, cause: "frozen solid in the blizzard", tint: 0xdbe6f0,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("Blizzard incoming — get INDOORS or keep moving!", 2.8); sound("wind"); },
      start(ctx) { ctx.st.snow = CBZ.fx.particleCloud({ mode: "fall", color: 0xffffff, count: 380, radius: 22, top: 22, size: 0.2, opacity: 0.8, vMin: 10, vMax: 20, drift: 8 }); ctx.st.snow.setActive(1); },
      active(dt, ctx) {
        ctx.env.fog = 0xdbe6f0; ctx.env.fogNear = 8; ctx.env.fogFar = 60; ctx.env.sunInt = 0.6; ctx.env.sunColor = 0xcfe0ff; ctx.env.hemiInt = 1.1; ctx.env.hemiColor = 0xeaf2ff;
        ctx.st.snow.update(dt, camPos().x, 0, camPos().z);
        const cold = scale(12, ctx);
        surv().forEachActor(function (a) {
          if (sheltered(a)) return;                    // a roof overhead = warmth; shelter is physical
          if ((a.speed || 0) < 1.6) surv().hurt(a, cold * dt);
        });
        if (rnd() < dt * 2) sound("wind");
      },
      end(ctx) { if (ctx.st.snow) ctx.st.snow.dispose(); },
      threat() { return 0.25; },
      safeDir() { return null; }, // no safe direction — just don't stand still
    },

    // ---- METEOR SHOWER: telegraphed impacts, big blast ----
    meteor: {
      name: "METEOR SHOWER", emoji: "☄️", warnSecs: 5, activeSecs: 17, gap: 6, cause: "flattened by a meteor", tint: 0x4a3a3a,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("METEORS — watch the shadows!", 2.6); sound("rumble"); },
      start(ctx) { ctx.st.pending = []; ctx.st.cd = 0.5; ctx.env.sunInt = 0.7; ctx.st.timers = []; },
      active(dt, ctx) {
        ctx.env.fog = 0x4a3a3a; ctx.env.fogNear = 40; ctx.env.fogFar = 240; ctx.env.hemiColor = 0xffb0a0;
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = (0.8 - 0.4 * ctx.prog) * (0.6 + rnd());
          const p = ctx.arena.randomPoint(0, ctx.zone ? ctx.zone.radius : ctx.R);
          const r = 5 + scale(2, ctx);
          ctx.st.pending.push({ x: p.x, z: p.z, r, t: 1.2, m: CBZ.fx.groundMarker(p.x, p.z, r, 0xff5030) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t / 1.2);
          if (p.t <= 0) {
            p.m.dispose();
            CBZ.fx.dropDebris({ x: p.x, z: p.z, fromY: 40, vy: -22, size: 2.4, color: 0x3a2018, dmg: 0, linger: 4, keep: true, onLand: (x, z) => { CBZ.fx.blast(x, z, { maxR: p.r + 4, color: 0xffcaa0, shake: 0.6, flash: 0.4, sfx: "shoot_shotgun" }); surv().hurtRadius(x, z, p.r, 1e6); const cr = disc(x, z, 0x201810, 0.9, 0.05); cr.userData.transient = true; } });
            ctx.st.pending.splice(i, 1);
          }
        }
        tick0(ctx, dt);
      },
      end(ctx) { (ctx.st.pending || []).forEach((p) => p.m.dispose()); },
      threat(x, z, ctx) { let t = 0; (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 3) t = Math.max(t, 1 - d / (p.r + 3)); }); return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; (ctx.st.pending || []).forEach((p) => { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < p.r + 4 && d > 0.1) { bx += dx / d; bz += dz / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- SINKHOLES: ground gives way; fall in = death ----
    sinkhole: {
      name: "SINKHOLES", emoji: "🕳️", warnSecs: 5, activeSecs: 16, gap: 6, cause: "swallowed by a sinkhole", tint: 0x5a4a36,
      warn(ctx) { CBZ.flashHint && CBZ.flashHint("The ground is giving way!", 2.6); sound("rumble"); },
      start(ctx) { ctx.st.holes = []; ctx.st.pending = []; ctx.st.cd = 0.4; },
      active(dt, ctx) {
        if (CBZ.shake) CBZ.shake(0.12);
        ctx.st.cd -= dt;
        if (ctx.st.cd <= 0) {
          ctx.st.cd = 0.7 - 0.3 * ctx.prog;
          const p = ctx.arena.randomPoint(0, ctx.zone ? ctx.zone.radius : ctx.R);
          const r = 3 + scale(2, ctx);
          ctx.st.pending.push({ x: p.x, z: p.z, r, t: 1.0, m: CBZ.fx.groundMarker(p.x, p.z, r, 0x5a3a20) });
        }
        for (let i = ctx.st.pending.length - 1; i >= 0; i--) {
          const p = ctx.st.pending[i]; p.t -= dt; p.m.set(1 - p.t);
          if (p.t <= 0) { p.m.dispose(); const m = disc(p.x, p.z, 0x0a0a0c, 0.96, 0.04); ctx.st.holes.push({ x: p.x, z: p.z, r: p.r, m }); if (CBZ.shake) CBZ.shake(0.3); ctx.st.pending.splice(i, 1); }
        }
        // anyone over an open hole falls
        for (const h of ctx.st.holes) surv().hurtRadius(h.x, h.z, h.r, 1e6);
      },
      end(ctx) { (ctx.st.pending || []).forEach((p) => p.m.dispose()); (ctx.st.holes || []).forEach((h) => rmMesh(h.m)); },
      threat(x, z, ctx) { let t = 0; (ctx.st.holes || []).forEach((h) => { const d = Math.hypot(x - h.x, z - h.z); if (d < h.r + 4) t = Math.max(t, 1 - d / (h.r + 4)); }); (ctx.st.pending || []).forEach((p) => { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 2) t = Math.max(t, 0.8 * (1 - d / (p.r + 2))); }); return t; },
      safeDir(x, z, ctx) { let bx = 0, bz = 0; const all = (ctx.st.holes || []).concat(ctx.st.pending || []); all.forEach((h) => { const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz); if (d < h.r + 4 && d > 0.1) { bx += dx / d / d; bz += dz / d / d; } }); return (bx || bz) ? { x: bx, z: bz } : null; },
    },

    // ---- NUKE: the finale. Blinding flash, expanding lethal shockwave ----
    nuke: {
      name: "NUCLEAR STRIKE", emoji: "☢️", warnSecs: 7, activeSecs: 12, gap: 8, cause: "vaporized by the nuclear blast", tint: 0x2a2a30,
      warn(ctx) {
        CBZ.flashToast && CBZ.flashToast("☢ INCOMING ☢");
        banner("☢ NUCLEAR STRIKE INCOMING ☢", true);
        if (CBZ.sfx) CBZ.sfx("alarm");
        sound("siren");
        ctx.st.gx = ctx.zone ? ctx.zone.cx : ctx.cx; ctx.st.gz = ctx.zone ? ctx.zone.cz : ctx.cz;
        ctx.st.warnMk = CBZ.fx.groundMarker(ctx.st.gx, ctx.st.gz, 8, 0xff3020); ctx.st.warnMk.set(1);
      },
      warnTick(dt, ctx) { ctx.env.sunInt = 0.5; ctx.env.fog = 0x2a2a30; if (rnd() < dt) sound("siren"); },
      start(ctx) {
        if (ctx.st.warnMk) ctx.st.warnMk.dispose();
        // blinding flash + huge blast + mushroom cloud
        CBZ.fx.flash(1, 0xffffff);
        CBZ.fx.blast(ctx.st.gx, ctx.st.gz, { maxR: ctx.R * 0.5, color: 0xfff3d0, shake: 1.6, life: 1.4 });
        if (CBZ.shake) CBZ.shake(1.8);
        sound("explosion");
        const grp = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 26, 16), new THREE.MeshBasicMaterial({ color: 0xc9c2b6, transparent: true, opacity: 0.85 }));
        stem.position.y = 13; grp.add(stem);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xd8d0c2 }));
        cap.position.y = 30; cap.scale.y = 0.7; grp.add(cap);
        grp.position.set(ctx.st.gx, floor(ctx.st.gx, ctx.st.gz), ctx.st.gz); root().add(grp);
        ctx.st.cloud = grp; ctx.st.r = 2; ctx.st.maxR = ctx.R * 0.95; ctx.st.killed = false;
      },
      active(dt, ctx) {
        ctx.env.fog = 0x3a2a22; ctx.env.fogNear = 30; ctx.env.fogFar = 220; ctx.env.sunInt = 0.5; ctx.env.sunColor = 0xff8a4a; ctx.env.hemiColor = 0xffae7a;
        if (ctx.st.cloud) { ctx.st.cloud.position.y += dt * 1.2; ctx.st.cloud.scale.addScalar(dt * 0.08); }
        // expanding lethal shockwave front
        ctx.st.r = Math.min(ctx.st.maxR, ctx.st.r + (ctx.st.maxR / 6) * dt);
        const inner = ctx.st.r - 4;
        surv().forEachActor(function (a) {
          const d = Math.hypot(a.pos.x - ctx.st.gx, a.pos.z - ctx.st.gz);
          if (d <= ctx.st.r && d >= inner) surv().hurt(a, 1e6);          // caught by the front
          else if (d < inner) surv().hurt(a, scale(8, ctx) * dt, { cause: "killed by nuclear fallout" });        // lingering radiation
        });
        tick0(ctx, dt);
      },
      end(ctx) { banner("", false); if (ctx.st.cloud) { ctx.st.cloud.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); }); root().remove(ctx.st.cloud); } },
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
    name: "TSUNAMI", emoji: "🌊", warnSecs: 7, activeSecs: 20, gap: 7, cause: "swept away by the tsunami", tint: 0x35607e,
    warn(ctx) { CBZ.flashHint && CBZ.flashHint("TSUNAMI — get to HIGH GROUND!", 3); sound("alarm"); sound("water"); },
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

  // ---------------- TSUNAMI V2 ----------------
  const TSU_RECEDE_Y = -7.5;      // where the warn pulls the ocean down to (rest is arena.oceanY)
  let tsuSwim = null;             // {ph,lx,lz} while the PLAYER is swimming (drives the late pose pass)

  // the wave travels (dx,dz), so it arrives FROM the opposite compass point
  // (+x = east on the minimap, +z = south)
  function tsuFrom(dx, dz) {
    return (Math.abs(dx) >= Math.abs(dz)) ? (dx > 0 ? "WEST" : "EAST") : (dz > 0 ? "NORTH" : "SOUTH");
  }
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
    const wall = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.93, side: THREE.DoubleSide, depthWrite: false,
    }));
    wall.renderOrder = 3;
    grp.add(wall);
    const mkFoam = (w, h, c2, op) => new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: c2, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    const crest = mkFoam(W, 6, 0xffffff, 0.85); crest.position.set(0, H * 0.99, 3.6 * zs); crest.rotation.x = -1.05; crest.renderOrder = 5;
    const foot = mkFoam(W, 7.5, 0xeaf8ff, 0.8); foot.position.set(0, 1.7, 5.6 * zs); foot.rotation.x = -1.25; foot.renderOrder = 5;
    grp.add(crest, foot);
    const streaks = [];
    for (let i = 0; i < 9; i++) {
      const sm = mkFoam(1.4 + rnd() * 2.4, H * (0.4 + rnd() * 0.4), 0xdff1fb, 0.26);
      sm.position.set((rnd() - 0.5) * W * 0.9, H * 0.45, 1.6 * zs);
      sm.renderOrder = 4; grp.add(sm); streaks.push(sm);
    }
    grp.rotation.y = Math.atan2(st.dx, st.dz);   // local +z → the travel direction
    root().add(grp);
    st.wave = grp; st.waveFoams = [crest, foot]; st.waveStreaks = streaks;
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
  function tsuPlanks(dt, ctx, wy) {
    const st = ctx.st; if (!st.planks) return;
    for (let i = 0; i < st.planks.length; i++) {
      const pl = st.planks[i];
      if (st.phase === "sweep" && tsuS(ctx, pl.x, pl.z) > st.frontS - 2) continue;   // not swept yet
      pl.m.visible = true;
      pl.x += st.dx * 2.0 * dt; pl.z += st.dz * 2.0 * dt;
      const floatY = wy - 0.08 + Math.sin(CBZ.now * 0.004 + pl.ph) * 0.1;
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
        CBZ.flashToast && CBZ.flashToast("🌊 SWEPT AWAY");
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
      if (!b.fallen && b.h <= 7.5 && rnd() < 0.65) collapse(b, ctx);
      else if (CBZ.shatterGlass) CBZ.shatterGlass(b.x, b.z, Math.max(b.w, b.d) * 0.95);
    }
  }

  // ---- PLAYER in the water: buoyancy + drag + stamina-as-air (the city
  //      swim.js pattern, self-contained for survival). Runs at order 28;
  //      the 46.5 pass below re-syncs the rig + poses the stroke AFTER
  //      animChar so the pose actually renders. ----
  function tsuPlayerWater(dt, ctx, wy, current) {
    const st = ctx.st, P = CBZ.player;
    if (P.dead) { tsuEndSwim(); return; }
    const p = P._phys;
    if (p && p.down > 0) return;                 // mid-knockdown from the wall: let the ragdoll play
    const support = CBZ.groundAt ? CBZ.groundAt(P.pos.x, P.pos.z, wy + 1.7) : floor(P.pos.x, P.pos.z);
    if (wy - support <= 1.15) {
      // shallow or a standable surface (roof, slope) within reach — haul out
      if (tsuSwim) {
        if (P.pos.y < support) { P.pos.y = support + 0.1; P.vy = 1.6; P.grounded = false; }
        tsuEndSwim();
        sound("water");
      }
      return;
    }
    if (!tsuSwim) {
      tsuSwim = { ph: rnd() * 6.28, lx: P.pos.x, lz: P.pos.z };
      P._tsuSwim = true;
      if (CBZ.playerChar) CBZ.playerChar.swimming = true;
      if (CBZ.shake) CBZ.shake(0.3);
      sound("water");
      CBZ.flashHint && CBZ.flashHint("🏊 SWIM — stamina is your air. Get to high ground!", 2.6);
    }
    const S = tsuSwim;
    // heavy water: drag this frame's walk step, ride the current downstream
    P.pos.x = S.lx + (P.pos.x - S.lx) * 0.55 + st.dx * current * dt;
    P.pos.z = S.lz + (P.pos.z - S.lz) * 0.55 + st.dz * current * dt;
    if (CBZ.collide) CBZ.collide(P.pos, P.radius || 0.55);
    S.lx = P.pos.x; S.lz = P.pos.z;
    S.ph += dt * (2.6 + Math.min(3, P.speed || 0) * 0.25);
    P.pos.y = wy - 1.28 + Math.sin(S.ph * 2) * 0.05;
    P.vy = 0; P.grounded = true; P.sprint = false;
    if (P.stamina != null) {
      P.stamina = Math.max(0, P.stamina - 24 * dt);       // outdrains the 14/s regen
      if (P.stamina <= 0) surv().hurt(surv().playerActor, 9 * dt, { cause: "drowned in the tsunami flood" });
    }
  }
  function tsuEndSwim() {
    if (!tsuSwim && !(CBZ.player && CBZ.player._tsuSwim)) return;
    tsuSwim = null;
    if (CBZ.player) CBZ.player._tsuSwim = false;
    const ch = CBZ.playerChar;
    if (ch) { ch.swimming = false; if (ch.body) { ch.body.rotation.x = 0; ch.body.position.y = 0; } }
  }

  // ---- everyone in the water: player swims, live bots paddle + drown,
  //      corpses float face-up and drift downstream. ----
  function tsuWater(dt, ctx, wy, current) {
    const st = ctx.st;
    surv().forEachActor(function (a) {
      if (a.isPlayer) { tsuPlayerWater(dt, ctx, wy, current); return; }
      if (CBZ.body && CBZ.body.busy(a)) return;            // mid-ragdoll: let it fly
      const depth = wy - floor(a.pos.x, a.pos.z);
      if (depth <= 1.5) { a._tsuSwim = 0; return; }        // wading/dry — brain owns it
      if (st.phase === "sweep" && tsuS(ctx, a.pos.x, a.pos.z) > st.frontS - 4) return;   // ahead of the front
      if (!a._tsuSwim) { a._tsuSwim = 1; a._tsuPh = rnd() * 6.28; a._tsuLX = a.pos.x; a._tsuLZ = a.pos.z; }
      // paddle: halve the brain's step, add the current
      a.pos.x = a._tsuLX + (a.pos.x - a._tsuLX) * 0.55 + st.dx * current * dt;
      a.pos.z = a._tsuLZ + (a.pos.z - a._tsuLZ) * 0.55 + st.dz * current * dt;
      a._tsuLX = a.pos.x; a._tsuLZ = a.pos.z;
      a.pos.y = wy - 1.12 + Math.sin(CBZ.now * 0.004 + a._tsuPh) * 0.12;
      const ch = a.char;                                    // flail (order 23 animChar ran already; our writes stick)
      if (ch && ch.parts) {
        const ph = CBZ.now * 0.011 + a._tsuPh;
        if (ch.parts.la) ch.parts.la.rotation.x = -1.4 + Math.sin(ph) * 0.9;
        if (ch.parts.ra) ch.parts.ra.rotation.x = -1.4 - Math.sin(ph) * 0.9;
        if (ch.parts.ll) ch.parts.ll.rotation.x = Math.sin(ph * 1.3) * 0.5;
        if (ch.parts.rl) ch.parts.rl.rotation.x = -Math.sin(ph * 1.3) * 0.5;
      }
      surv().hurt(a, scale(7, ctx) * dt, { cause: "drowned in the flood" });
    });
    const bots = CBZ.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b.dead || b.culled || !b.group.parent) continue;
      if (wy - floor(b.pos.x, b.pos.z) > 1.4) {
        b.group.position.y = wy - 0.32 + Math.sin(CBZ.now * 0.003 + i) * 0.08;
        b.group.position.x += st.dx * current * 0.55 * dt;
        b.group.position.z += st.dz * current * 0.55 * dt;
      }
    }
  }

  function tsuEnterFlood(ctx) {
    const st = ctx.st;
    st.phase = "flooded"; st.floodT = 0; st.level = st.floodY;
    if (st.wave) st.wave.visible = false;
    if (st.spray) st.spray.setActive(0);
    const o = ctx.arena.ocean; if (o) o.position.y = st.floodY - 0.35;
    CBZ.flashHint && CBZ.flashHint("🌊 THE ISLAND IS UNDER — swim, climb, survive", 3);
  }

  const TSUNAMI_V2 = {
    name: "TSUNAMI", emoji: "🌊", warnSecs: 10, activeSecs: 26, gap: 8,
    cause: "swept away by the tsunami", tint: 0x2c5a78,
    warn(ctx) {
      const st = ctx.st, a = rnd() * Math.PI * 2;
      st.dx = Math.cos(a); st.dz = Math.sin(a);
      st.from = tsuFrom(st.dx, st.dz);
      st.oceanY0 = ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8;
      st.warnT = 0; st.phase = "warn";
      CBZ.flashHint && CBZ.flashHint("🌊 TSUNAMI from the " + st.from + " — the sea is PULLING BACK. GET HIGH!", 3.6);
      sound("alarm"); sound("siren");
      if (CBZ.shake) CBZ.shake(0.3);
    },
    warnTick(dt, ctx) {
      const st = ctx.st;
      st.warnT += dt;
      const k = Math.min(1, st.warnT / TSUNAMI_V2.warnSecs);
      // THE DREAD BEAT: the whole ocean drains off the shelf, exposing seabed
      const o = ctx.arena.ocean;
      if (o) o.position.y = st.oceanY0 + (TSU_RECEDE_Y - st.oceanY0) * (k * k * (3 - 2 * k));
      if (CBZ.shake) CBZ.shake(0.05);
      st.sirenCd = (st.sirenCd || 0) - dt;
      if (st.sirenCd <= 0) { st.sirenCd = 2.6; sound("siren"); }
      if (rnd() < dt * 0.7) sound("water");
      if (!st.saidBed && k > 0.62) { st.saidBed = 1; CBZ.flashHint && CBZ.flashHint("The seabed is EXPOSED — IT'S COMING", 2.6); }
    },
    start(ctx) {
      const st = ctx.st, R = ctx.R;
      st.phase = "sweep";
      st.H = 30 + 8 * Math.min(1.4, ctx.intensity);                  // taller than the mountain late-run
      st.floodY = Math.min(13.5, 7.5 + scale(2.4, ctx));             // 1-2 storeys under; towers/mountain stay dry
      st.frontS = -(R + 52);
      st.speed = (2 * R + 104) / (ctx.activeSecs * 0.44);
      st.level = 0.8;
      st.waveId = "tsu" + CBZ.now + rnd();
      st.landfall = false;
      tsuBuildWave(ctx);
      const fm = new THREE.Mesh(new THREE.PlaneGeometry(520, 520),
        new THREE.MeshLambertMaterial({ color: 0x2a6f9a, transparent: true, opacity: 0.84, depthWrite: false }));
      fm.rotation.x = -Math.PI / 2; fm.renderOrder = 2; fm.visible = false;
      root().add(fm); st.flood = fm;
      st.spray = CBZ.fx.particleCloud({ mode: "fall", color: 0xeaf6ff, count: 320, radius: R * 0.8, top: 15, size: 0.26, opacity: 0.8, vMin: 11, vMax: 22, drift: st.dx * 9, driftZ: st.dz * 9 });
      st.spray.setActive(0.95);
      tsuSpawnPlanks(ctx);
      if (CBZ.shake) CBZ.shake(0.5);
      sound("water"); sound("rumble");
    },
    active(dt, ctx) {
      const st = ctx.st;
      ctx.env.fog = 0x35607e; ctx.env.fogNear = 40; ctx.env.fogFar = 300; ctx.env.sunInt = 0.7; ctx.env.hemiColor = 0x9fb6c8;
      if (st.phase === "sweep") {
        st.frontS += st.speed * dt;
        const prog = Math.min(1, (st.frontS + ctx.R + 52) / (2 * ctx.R + 104));
        st.level = 0.8 + (st.floodY - 0.8) * prog;                   // the flood height rides the front
        const fx0 = ctx.cx + st.dx * st.frontS, fz0 = ctx.cz + st.dz * st.frontS;
        const grp = st.wave;
        grp.position.set(fx0, st.level - 2.4 + Math.sin(CBZ.now * 0.005) * 0.4, fz0);
        grp.rotation.z = Math.sin(CBZ.now * 0.0035) * 0.016;
        grp.scale.y = 1 + 0.035 * Math.sin(CBZ.now * 0.007);
        const fo = st.waveFoams;
        if (fo) for (let i = 0; i < fo.length; i++) fo[i].material.opacity = 0.55 + 0.3 * Math.abs(Math.sin(CBZ.now * 0.02 + i * 1.7));
        const sk = st.waveStreaks;
        if (sk) for (let i = 0; i < sk.length; i++) { const s = sk[i]; s.material.opacity = 0.16 + 0.2 * Math.abs(Math.sin(CBZ.now * 0.013 + i)); s.position.y = st.H * (0.42 + 0.05 * Math.sin(CBZ.now * 0.01 + i * 2)); }
        st.spray.update(dt, fx0, st.level + st.H * 0.9, fz0);
        // the flood sheet exists only BEHIND the front — no more drowning ahead of the wave
        st.flood.visible = true;
        const wy = st.level + Math.sin(CBZ.now * 0.0035) * 0.22;
        st.flood.position.set(fx0 - st.dx * 262, wy, fz0 - st.dz * 262);
        const o = ctx.arena.ocean;
        if (o) o.position.y = TSU_RECEDE_Y + (st.floodY - 0.35 - TSU_RECEDE_Y) * prog * prog;   // the sea surges back in
        if (!st.landfall && st.frontS > -(ctx.R - 6)) {
          st.landfall = true;
          CBZ.fx.blast(fx0, fz0, { maxR: 26, color: 0xd9f2ff, shake: 1.15, life: 0.8 });
          CBZ.flashToast && CBZ.flashToast("🌊 BRACE!");
          sound("collapse"); sound("water");
        }
        const pd = Math.abs(tsuS(ctx, CBZ.player.pos.x, CBZ.player.pos.z) - st.frontS);
        if (pd < 40 && CBZ.shake) CBZ.shake(0.45 * (1 - pd / 40));   // the roar closes in
        if (rnd() < dt * 8) sound("water");
        tsuCatch(dt, ctx);
        tsuSmash(ctx);
        tsuWater(dt, ctx, wy, 2.2);
        tsuPlanks(dt, ctx, wy);
        if (st.frontS > ctx.R + 52) tsuEnterFlood(ctx);
      } else if (st.phase === "flooded") {
        st.floodT += dt;
        const wy = st.floodY + Math.sin(CBZ.now * 0.0035) * 0.22;
        st.level = st.floodY;
        st.flood.visible = true;
        st.flood.position.set(ctx.cx, wy, ctx.cz);
        const o = ctx.arena.ocean; if (o) o.position.y = wy - 0.35;
        ctx.env.fog = 0x3a6a84; ctx.env.fogNear = 34; ctx.env.fogFar = 260; ctx.env.sunInt = 0.8; ctx.env.hemiColor = 0xaecbd8;
        tsuWater(dt, ctx, wy, 1.6);
        tsuPlanks(dt, ctx, wy);
        if (rnd() < dt * 2.5) sound("water");
        if (st.floodT > ctx.activeSecs * 0.34) { st.phase = "drain"; CBZ.flashHint && CBZ.flashHint("The water is DRAINING — move!", 2.4); }
      } else {  // drain
        st.level = Math.max(st.oceanY0, st.level - dt * (st.floodY + 1.5) / Math.max(1.5, ctx.activeSecs * 0.2));
        const wy = st.level + Math.sin(CBZ.now * 0.0035) * 0.15;
        st.flood.position.set(ctx.cx, wy, ctx.cz);
        st.flood.material.opacity = 0.84 * Math.max(0, Math.min(1, (st.level + 0.4) / 2));
        if (st.level < 0.05) st.flood.visible = false;               // below the island surface
        const o = ctx.arena.ocean; if (o) o.position.y = Math.max(st.oceanY0, wy - 0.35);
        tsuWater(dt, ctx, wy, 0.7);
        tsuPlanks(dt, ctx, wy);
      }
      // heavier fog when the swimming player's face is at the surface
      if (tsuSwim) { ctx.env.fog = 0x1e5670; ctx.env.fogNear = 6; ctx.env.fogFar = 90; }
    },
    end(ctx) {
      const st = ctx.st;
      tsuEndSwim();
      const o = ctx.arena && ctx.arena.ocean;
      if (o) o.position.y = st.oceanY0 != null ? st.oceanY0 : (ctx.arena.oceanY != null ? ctx.arena.oceanY : -0.8);
      if (st.wave) { st.wave.traverse((ob) => { if (ob.geometry) ob.geometry.dispose(); if (ob.material && ob.material.dispose) ob.material.dispose(); }); root().remove(st.wave); st.wave = null; }
      if (st.flood) { rmMesh(st.flood); st.flood = null; }
      if (st.spray) { st.spray.dispose(); st.spray = null; }
      if (st.planks) {
        for (let i = 0; i < st.planks.length; i++) root().remove(st.planks[i].m);
        if (st.plankGeo) st.plankGeo.dispose();
        if (st.plankMats) { st.plankMats[0].dispose(); st.plankMats[1].dispose(); }
        st.planks = null;
      }
      const bots = CBZ.bots;
      for (let i = 0; i < bots.length; i++) bots[i]._tsuSwim = 0;
    },
    threat(x, z, ctx) {
      const st = ctx.st;
      const gH = floor(x, z);
      if (!st.phase || st.phase === "warn") return gH < 7 ? 0.55 : 0.05;   // stampede uphill during the sirens
      if (st.phase === "sweep") {
        let t = 0;
        if (gH < Math.min(24, st.level + Math.min(22, (st.H || 34) * 0.72))) {
          const d = tsuS(ctx, x, z) - st.frontS;               // + = ahead of the wall
          if (d > -6 && d < 55) t = 0.55 + 0.45 * (1 - Math.max(0, d) / 55);
        }
        if ((st.level || 0) - gH > -1 && tsuS(ctx, x, z) < st.frontS) t = Math.max(t, 0.6);
        return t;
      }
      const depth = (st.level != null ? st.level : -1) - gH;
      if (st.phase === "flooded") return depth > 0.4 ? Math.min(1, 0.45 + depth * 0.1) : 0.08;
      return depth > 0.6 ? 0.35 : 0.05;
    },
    safeDir(x, z, ctx) {
      const st = ctx.st, hills = ctx.arena.hills;
      const need = (st.floodY != null ? st.floodY : 10) + 2;
      let best = null, bd = 1e9;
      for (let i = 0; i < hills.length; i++) {
        const h = hills[i]; if (h.peak < need) continue;      // that hill will be UNDER water
        const d = Math.hypot(x - h.x, z - h.z);
        if (d < bd) { bd = d; best = h; }
      }
      if (!best) best = hills[0];
      const dx = best.x - x, dz = best.z - z, d = Math.hypot(dx, dz) || 1;
      return { x: dx / d, z: dz / d };
    },
  };

  if (CBZ.CONFIG.SURV_TSUNAMI_V2 == null) CBZ.CONFIG.SURV_TSUNAMI_V2 = true;
  DEFS.flood = CBZ.CONFIG.SURV_TSUNAMI_V2 !== false ? TSUNAMI_V2 : TSUNAMI_LEGACY;

  // late pass (after animChar at orders 30–46): sync the swimming player's rig
  // to the water-owned position and write the stroke pose — same ordering trick
  // the city's swim.js uses, so the pose isn't stomped by the animator.
  CBZ.onUpdate(46.5, function () {
    if (!tsuSwim || CBZ.game.mode !== "survival") return;
    const P = CBZ.player, ch = CBZ.playerChar;
    if (!ch || !ch.group || P.dead) return;
    ch.group.position.copy(P.pos);
    const sw = Math.sin(tsuSwim.ph);
    if (ch.body) { ch.body.rotation.x = 0.24; ch.body.position.y = Math.sin(tsuSwim.ph * 2) * 0.03; }
    if (ch.parts) {
      if (ch.parts.la) { ch.parts.la.rotation.x = -1.2 + sw * 0.62; ch.parts.la.rotation.z = -0.28; }
      if (ch.parts.ra) { ch.parts.ra.rotation.x = -1.2 - sw * 0.62; ch.parts.ra.rotation.z = 0.28; }
      if (ch.parts.ll) ch.parts.ll.rotation.x = sw * 0.3;
      if (ch.parts.rl) ch.parts.rl.rotation.x = -sw * 0.3;
    }
  });

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
    banner("🌋 VOLCANIC ERUPTION", true);
    CBZ.flashHint && CBZ.flashHint("THE MOUNTAIN ERUPTS — stay off the lava!", 3);
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
      const wa = rnd() * 6.28;
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
        CBZ.fx.dropDebris({ x: p.x, z: p.z, fromY: 34, vy: -8, size: 1.7, color: 0xff5a1a, dmg: 999, keep: true, onLand: function (x, z) { CBZ.fx.blast(x, z, { maxR: 8, color: 0xff7a30, shake: 0.4, flash: 0.25, sfx: "punch" }); surv().hurtRadius(x, z, 7, 1e6, { cause: "crushed by a volcanic bomb" }); } });
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
  function collapse(b, ctx) {
    if (!b || b.fallen) return; b.fallen = true;
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
    surv().hurtRadius(x, z, 5, 1e6);
    CBZ.fx.flash(0.7, 0xddeeff);
    if (CBZ.shake) CBZ.shake(0.6);
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 40, 0.5), new THREE.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 1, depthWrite: false }));
    bolt.position.set(x, floor(x, z) + 20, z); root().add(bolt);
    ctx.st.bolts.push({ mesh: bolt, life: 0.16 });
    sound("thunder");
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

  const dir = { state: "idle", t: 6, cur: null, st: {}, idx: 0, occ: 0, intensity: 0.2, prog: 0 };
  let curCtx = null;

  function makeCtx(dt) {
    const A = CBZ.surv.arena;
    return { dt, now: CBZ.now, arena: A, cx: A.center.x, cz: A.center.z, R: A.radius, zone: CBZ.surv.zone, surv: CBZ.surv, fx: CBZ.fx, env: CBZ.survEnv, st: dir.st, intensity: dir.intensity, prog: dir.prog };
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
    dir.cur = DEFS[id]; dir.st = {}; dir.state = "warn"; dir.t = dir.cur.warnSecs;
    curCtx = makeCtx(0);
    banner(dir.cur.emoji + " " + dir.cur.name + " — INCOMING", true);
    // universal telegraph: every warning lands with a physical jolt on top of
    // the banner + hint + per-def audio; warnAmbience() below tints the sky
    if (CBZ.CONFIG.SURV_TELEGRAPH !== false && CBZ.shake) CBZ.shake(0.22);
    try { dir.cur.warn(curCtx); } catch (e) { console.error("[disaster warn]", e); }
  }
  function beginActive(ctx) {
    dir.state = "active"; dir.t = dir.cur.activeSecs;
    if (CBZ.surv) CBZ.surv._cause = dir.cur.cause || "killed by the disaster";   // default cause for kill feed
    banner(dir.cur.emoji + " " + dir.cur.name, true);
    try { dir.cur.start(ctx); } catch (e) { console.error("[disaster start]", e); }
  }
  function endActive(ctx) {
    try { dir.cur.end(ctx); } catch (e) { console.error("[disaster end]", e); }
    if (!CBZ.player.dead) CBZ.surv.stats.disastersSurvived++;
    if (CBZ.surv) CBZ.surv._cause = null;
    banner("", false);
    dir.state = "idle"; dir.t = dir.cur.gap; dir.cur = null;
  }

  CBZ.disasters = {
    start() {
      // if a previous match ended mid-disaster, tear its meshes down cleanly
      if (dir.cur && dir.cur.end && dir.state === "active") { try { dir.cur.end(makeCtx(0)); } catch (e) {} }
      banner("", false);
      // a fresh SEEDED arc for this run: world seed + run counter → the same
      // match order for every client, a different order every match
      runNo++;
      orderRng = CBZ.seedStream ? CBZ.seedStream("surv-sequence-" + runNo) : null;
      order = buildOrder();
      dir.state = "idle"; dir.t = 7; dir.cur = null; dir.st = {}; dir.idx = 0; dir.occ = 0; dir.intensity = 0.2; curCtx = null; fallingBuildings.length = 0; flungCars.length = 0;
    },
    threatAt(x, z) { return (dir.cur && curCtx && dir.cur.threat) ? dir.cur.threat(x, z, curCtx) : 0; },
    fleeVector(x, z) {
      if (dir.state === "idle" || !dir.cur || !curCtx) return null;
      const t = dir.cur.threat ? dir.cur.threat(x, z, curCtx) : 0;
      if (t < 0.15) return null;
      const sd = dir.cur.safeDir ? dir.cur.safeDir(x, z, curCtx) : null;
      if (!sd) return { x: 0, z: 0, w: t };
      const m = Math.hypot(sd.x, sd.z) || 1;
      return { x: sd.x / m, z: sd.z / m, w: t };
    },
    current() { return dir.cur ? dir.cur.name : null; },
    state() { return dir.state; },
    timeLeft() { return Math.max(0, dir.t); },
    // jump straight to a named disaster's warning (debug / verification aid)
    force(id) {
      const i = order.indexOf(id);   // this run's shuffled arc
      if (i < 0) return false;
      if (dir.cur && dir.cur.end && dir.state === "active") { try { dir.cur.end(makeCtx(0)); } catch (e) {} }
      dir.idx = i; dir.state = "idle"; dir.t = 0.01; dir.cur = null;
      return true;
    },
  };

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

    if (dir.state === "idle") { dir.t -= dt; if (dir.t <= 0) beginWarn(); }
    else if (dir.state === "warn") { dir.t -= dt; warnAmbience(); if (dir.cur.warnTick) try { dir.cur.warnTick(dt, ctx); } catch (e2) {} if (dir.t <= 0) beginActive(ctx); }
    else if (dir.state === "active") { dir.t -= dt; try { dir.cur.active(dt, ctx); } catch (e3) { console.error("[disaster active]", e3); } if (dir.t <= 0) endActive(ctx); }
  });
})();
