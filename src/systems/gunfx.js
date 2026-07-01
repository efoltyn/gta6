/* ============================================================
   systems/gunfx.js — lightweight, mode-AGNOSTIC gunfire visuals
   (tracer beams + muzzle flashes) for the prison/escape game,
   where the survival VFX kit (CBZ.fx) is gated off.

   Used by the watch-tower armed response (systems/capture.js) and
   by armed inmates returning fire in a stand-off (systems/
   intimidate.js). Everything is pooled and self-animating on a
   single always-updater; no per-frame allocation.

     CBZ.tracer(from, to, opts)  — a fading line + (by default) a
                                   muzzle flash at `from`.
     CBZ.muzzleFlash(pos, opts)  — a brief additive glow.

   INCOMING FIRE READS (owner demand: "make it clearer when you're
   getting shot" — with NO UI): tracer() detects a round travelling
   AT the player and answers with a bigger/brighter/longer two-layer
   muzzle flash at the shooter plus a thick additive BOLT down the
   shot line (a head-on 1px line foreshortens to a dot; a cylinder
   still reads). All of it swells after dark, when the flash is the
   only thing visible at 40u. The flash IS the "you're being shot"
   indicator.

   SUPPRESSION (combat-realism pass): being shot AT and missed should still
   cost you something, or "incoming fire" is purely cosmetic. tracer()
   already computes `inc` (0..1, how close a round's closest approach came to
   a target) for the player's own camera — that EXACT near-miss test is now
   reused, generically, against any target passed as opts.targetActor (an
   NPC defender, a guard, anyone with a {x,y,z}-ish .pos), so a shot that
   buzzes a ped's head rattles THEM too, not just the player. A connecting
   `inc` above SUPPRESS_THRESH stacks a decaying "rattled" meter on the
   target (an internal WeakMap keyed by the target object itself — CBZ.player
   included, so no actor needs a reserved field) that callers read via
   CBZ.suppressionLevel(actor)
   (0 = composed, 1 = freshly buzzed) and CBZ.suppressionAccuracyMul(actor)
   (a ready-to-multiply 1..~1.6 spread/sway penalty). Pure data — gunfx.js
   never touches anyone's aim itself; fpsmode.js (player) folds the mul into
   its spread cone, and any NPC shooter can do the same with zero coupling
   back to this file. Decays linearly over SUPPRESS_DECAY seconds back to 0.
     CBZ.bulletImpact(pos,n,o)   — debris burst; o.power scales it by
                                   CALIBER, o.kind "chip" + o.color =
                                   paint flecks in a shot car's coat.
     CBZ.bulletHole(pos, n, o)   — PERSISTENT pocked decal (pooled,
                                   64 cap, oldest recycled, skipped
                                   past 50u). o.parent mounts it on a
                                   car body so the hole RIDES the car.

   WHY the holes: the evidence a firefight leaves is half its drama —
   a wall you magdumped must STAY pocked, and a 7.62 hole must read
   bigger than a 9mm (o.size carries the caliber).

   `from`/`to` are any {x,y,z}. opts: {color, life, muzzle:false,
   muzzleScale, scale}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;

  // DETERMINISM (owner rule): this file used raw Math.random() for every
  // sprite/particle jitter — harmless-looking cosmetic VFX, but the project
  // rule is no Math.random() ANYWHERE, full stop, so a file already open for
  // the combat-realism pass gets fixed here too. Seeded LCG, same formula as
  // every other file in the codebase.
  let _s = 50321;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // ---- SUPPRESSION STATE (c) -------------------------------------------------
  // A WeakMap keyed by the target object itself (CBZ.player, a ped/cop actor —
  // anything with a .pos) so nobody needs a reserved field on actors they
  // don't own. Value: { t: secondsRemainingAtFullStrength-ish counter, peak }.
  // We store a simple decaying TIMER (not a 0..1 level) so re-triggering while
  // already suppressed EXTENDS the clock instead of needing max() bookkeeping
  // at every read site; level is derived from the timer at read time.
  const SUPPRESS_THRESH = 0.22;   // near-miss `inc` below this is "not close enough to flinch"
  const SUPPRESS_DECAY = 3.2;     // seconds for a fresh max-strength flinch to fully decay
  const SUPPRESS_MAX_MUL = 1.65;  // worst-case spread/sway multiplier at peak suppression
  const suppression = new WeakMap();

  // tick every live suppression timer down. Lazily walks a side-list of
  // recently-touched targets (a WeakMap can't be iterated) so this stays
  // cheap regardless of how many actors exist in the city.
  const suppressedRecent = [];
  // mark `target` as freshly shot-at-and-missed, strength 0..1 (how close the
  // round's closest approach came). Re-triggering refreshes/extends the timer
  // rather than just overwriting it, so a hail of near-misses keeps someone
  // rattled instead of each shot resetting to the same single-shot decay.
  function noteSuppressed(target, strength) {
    if (!target || strength <= 0) return;
    const cur = suppression.get(target);
    const add = strength * SUPPRESS_DECAY;
    const t = cur ? Math.min(SUPPRESS_DECAY * 1.6, cur.t + add * 0.6) : add;
    suppression.set(target, { t, peak: cur ? Math.max(cur.peak, strength) : strength });
    if (suppressedRecent.indexOf(target) < 0) suppressedRecent.push(target);
  }
  // 0 (composed) .. 1 (freshly buzzed) — callers that want a raw "how rattled"
  // read (HUD shake, AI morale, etc.) rather than the ready-to-use multiplier.
  CBZ.suppressionLevel = function (target) {
    const s = target && suppression.get(target);
    if (!s || s.t <= 0) return 0;
    return Math.max(0, Math.min(1, s.t / SUPPRESS_DECAY));
  };
  // ready-to-multiply accuracy/aim-sway penalty: 1 = unaffected, up to
  // SUPPRESS_MAX_MUL at peak. Quadratic ease so a faint near-miss barely
  // registers but a close shave genuinely throws the aim off.
  CBZ.suppressionAccuracyMul = function (target) {
    const lvl = CBZ.suppressionLevel(target);
    if (lvl <= 0) return 1;
    return 1 + (SUPPRESS_MAX_MUL - 1) * lvl * lvl;
  };
  CBZ.onAlways(53, function (dt) {
    for (let i = suppressedRecent.length - 1; i >= 0; i--) {
      const tgt = suppressedRecent[i];
      const s = suppression.get(tgt);
      if (!s) { suppressedRecent.splice(i, 1); continue; }
      s.t -= dt;
      if (s.t <= 0) { suppression.delete(tgt); suppressedRecent.splice(i, 1); }
    }
  });

  // Generic near-miss closest-approach test, factored out of the player-only
  // check tracer() used to do inline (SAME math, now reusable for any actor
  // with a .pos). Returns 0..1 (0 = not close / not heading at them, 1 =
  // dead-on) for a shot segment from→to versus a point at (px,py,pz).
  function closestApproachInc(from, to, px, py, pz) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    const ox = px - from.x, oy = py - from.y, oz = pz - from.z;
    if (len2 <= 16 || ox * ox + oy * oy + oz * oz <= 16) return 0;
    let t = (ox * dx + oy * dy + oz * dz) / len2;
    if (t <= 0.45) return 0;          // travelling toward the target's half of the line
    if (t > 1) t = 1;
    const mx = from.x + dx * t - px, my = from.y + dy * t - py, mz = from.z + dz * t - pz;
    const miss = Math.sqrt(mx * mx + my * my + mz * mz);
    return miss < 3.4 ? 1 - miss / 3.4 : 0;
  }

  // ---- pooled fading tracer lines ----
  const linePool = [];
  const liveLines = [];
  function takeLine() {
    let m = linePool.pop();
    if (!m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95, depthWrite: false });
      m = new THREE.Line(geo, mat);
      m.frustumCulled = false; m.renderOrder = 8;
      scene.add(m);
    }
    return m;
  }

  // ---- pooled muzzle-flash sprites (a soft additive glow) ----
  let flashTex = null;
  function makeFlashTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,244,200,1)");
    g.addColorStop(0.4, "rgba(255,184,80,0.7)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const flashPool = [];
  const liveFlashes = [];
  function takeFlash() {
    let s = flashPool.pop();
    if (!s) {
      if (!flashTex) flashTex = makeFlashTex();
      s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: flashTex, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      s.renderOrder = 9;
      scene.add(s);
    }
    return s;
  }

  CBZ.muzzleFlash = function (pos, opts) {
    opts = opts || {};
    const s = takeFlash();
    s.position.set(pos.x, pos.y, pos.z);
    const sc = (opts.scale || 1) * (0.7 + rng() * 0.5);
    s.scale.set(sc, sc, sc);
    // pooled sprites keep their last tint/peak — reset both every take
    s.material.color.setHex(opts.color != null ? opts.color : 0xffffff);
    const peak = opts.peak != null ? opts.peak : 1;
    s.material.opacity = peak;
    s.visible = true;
    const life = opts.life || 0.06;
    liveFlashes.push({ spr: s, life: life, max: life, peak: peak });
    return s;
  };

  // ---- INCOMING-fire bolt pool: thin additive cylinders. A head-on tracer
  // LINE foreshortens to a single pixel, which is why you couldn't tell who
  // was shooting at you — a cylinder keeps its radius from every angle. ----
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  beamGeo._shared = true;
  const beams = [];
  let beamIdx = 0;
  function takeBeam() {
    let b;
    if (beams.length < 10) {
      const bm = new THREE.MeshBasicMaterial({
        color: 0xffe9b8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      bm._shared = true;
      b = { mesh: new THREE.Mesh(beamGeo, bm), life: 0, max: 0.001, peak: 1 };
      b.mesh.visible = false; b.mesh.frustumCulled = false; b.mesh.renderOrder = 9;
      scene.add(b.mesh);
      beams.push(b);
    } else {
      b = beams[beamIdx];
      beamIdx = (beamIdx + 1) % beams.length;
    }
    return b;
  }
  const _beamDir = new THREE.Vector3();
  function fireIncomingBeam(from, to, inc, night) {
    _beamDir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = _beamDir.length();
    if (len < 2.5) return;
    _beamDir.multiplyScalar(1 / len);
    const L = Math.max(2, len - 2.2);   // stop short of the lens — never a screen-filling smear
    const b = takeBeam();
    b.mesh.position.set(from.x + _beamDir.x * L * 0.5, from.y + _beamDir.y * L * 0.5, from.z + _beamDir.z * L * 0.5);
    b.mesh.quaternion.setFromUnitVectors(UP, _beamDir);
    // thicker with range + after dark so it still reads head-on at 40u
    const r = 0.035 + len * 0.0014 + night * 0.025;
    b.mesh.scale.set(r, L, r);
    b.peak = 0.55 + inc * 0.3 + night * 0.15;
    b.mesh.material.opacity = b.peak;
    b.mesh.visible = true;
    b.life = b.max = 0.09 + inc * 0.05 + night * 0.05;
  }

  CBZ.tracer = function (from, to, opts) {
    opts = opts || {};
    // ---- is this round travelling AT the player? Closest approach of the
    // shot segment to the player's chest line decides; the boost scales with
    // how dead-on the shot is (inc 0..1). Player-origin / point-blank-adjacent
    // shots are excluded so your own allies' barrels don't flare in your face.
    // (closestApproachInc factors out the exact math that used to live inline
    // here — SAME numbers for the player — so it can also drive SUPPRESSION
    // below without duplicating the geometry test.)
    let inc = 0;
    const P = CBZ.player;
    if (P && P.pos && from && to) {
      inc = closestApproachInc(from, to, P.pos.x, P.pos.y + 1.45, P.pos.z);
    }
    // SUPPRESSION (c): a round that buzzed the PLAYER rattles their own aim
    // for a few seconds (fpsmode.js reads CBZ.suppressionAccuracyMul(CBZ.player)
    // into its spread cone). opts.shooter excludes the player's own outgoing
    // fire from suppressing themselves (mirrors the existing "player-origin
    // shots are excluded" muzzle-flash rule above).
    if (inc >= SUPPRESS_THRESH && P && opts.shooter !== P) noteSuppressed(P, inc);
    // GENERIC near-miss for any other target (NPC defenders, guards, cops…):
    // shooters that know WHO they're aiming at pass opts.targetActor (an
    // object with .pos) so that actor gets rattled too, independent of the
    // player-only `inc` above. Computed separately (NOT reusing `inc`) since
    // the target here is rarely the player and the test must run against the
    // target's own position, not the camera's.
    if (opts.targetActor && opts.targetActor !== opts.shooter && opts.targetActor.pos && from && to) {
      const ta = opts.targetActor.pos;
      const tInc = closestApproachInc(from, to, ta.x, (ta.y || 0) + 1.4, ta.z);
      if (tInc >= SUPPRESS_THRESH) noteSuppressed(opts.targetActor, tInc);
    }
    const night = inc > 0 ? Math.min(1, CBZ.nightAmount || 0) : 0;

    // ---- THE CITY REACTS to the round itself ------------------------------
    // Every shot in the game draws a tracer, so this segment IS the bullet's
    // whole path — route it once at the street furniture (props.js reacts:
    // lamps shatter dark, hydrants geyser, cans go flying), and stamp the
    // ROAD when the line carries below the pavement plane: the shot resolver
    // only raycasts walls/cars, so a round fired into the asphalt used to
    // vanish without a mark. Player pellets, NPC guns and cop fire all pass
    // through here, so the whole firefight leaves evidence.
    if (CBZ.game && CBZ.game.mode === "city" && opts.muzzle !== false) {
      if (CBZ.cityShootProp) CBZ.cityShootProp(from, to);
      if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "gunshot", pos: from, radius: 40, intensity: 0.9 });   // crowd panic bus (cityevents.js): a gunshot is a wide, sharp scare
      const GY = 0.09;                                  // pavement top (sidewalk 0.08 / lot pad 0.10)
      if (to.y < GY && from.y > GY + 0.3) {
        const gt = (from.y - GY) / (from.y - to.y);
        const gp = { x: from.x + (to.x - from.x) * gt, y: GY, z: from.z + (to.z - from.z) * gt };
        CBZ.bulletHole(gp, { x: 0, y: 1, z: 0 }, { size: 0.2, noProp: true });
        CBZ.bulletImpact(gp, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.8 });
      }
    }

    const m = takeLine();
    const p = m.geometry.attributes.position.array;
    p[0] = from.x; p[1] = from.y; p[2] = from.z;
    p[3] = to.x;   p[4] = to.y;   p[5] = to.z;
    m.geometry.attributes.position.needsUpdate = true;
    m.material.color.setHex(opts.color != null ? opts.color : (inc > 0 ? 0xfff7d6 : 0xfff2b0));
    m.material.opacity = 0.95;
    m.visible = true;
    const life = opts.life || (inc > 0 ? 0.07 + inc * 0.05 : 0.07);
    liveLines.push({ mesh: m, life: life, max: life });
    if (opts.muzzle !== false) {
      if (inc > 0) {
        const base = opts.muzzleScale || 0.9;
        // hot core — bigger, brighter, a beat longer than an outgoing flash
        CBZ.muzzleFlash(from, { scale: base * (1.9 + inc * 0.9 + night * 0.8), life: 0.1 + inc * 0.05 + night * 0.05 });
        // wide pale halo blooming around it — the "that one's aimed at YOU" flare
        CBZ.muzzleFlash(from, { scale: base * (3.1 + inc * 1.5 + night * 1.4), life: 0.16 + night * 0.07, color: 0xfff4da, peak: 0.4 + night * 0.25 });
        // the round itself: a hot volumetric bolt down the shot line at you
        fireIncomingBeam(from, to, inc, night);
      } else CBZ.muzzleFlash(from, { scale: opts.muzzleScale || 0.9 });
    }
    return m;
  };

  // ---- JUICY bullet impacts: a short-lived burst of debris streaks that fly
  // out along the surface normal (GTA/Max-Payne style stretched billboards),
  // plus a flat scorch puff. Pooled, additive sparks + soft dust. Drive with
  // CBZ.bulletImpact(pos, normal, {kind, power}). kind: "spark" (metal/stone,
  // bright orange sparks) | "dust" (concrete/dirt, brown puff) | "wood".
  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _vn = new THREE.Vector3();
  const _vt = new THREE.Vector3();
  const _vb = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function makeSparkTex() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,235,1)");
    g.addColorStop(0.4, "rgba(255,196,96,0.9)");
    g.addColorStop(1, "rgba(180,60,10,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  function makePuffTex() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, "rgba(220,210,190,0.9)");
    g.addColorStop(0.5, "rgba(150,135,110,0.5)");
    g.addColorStop(1, "rgba(120,105,80,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  let sparkTex = null, puffTex = null;

  // streak particles (thin stretched boxes) for flying sparks/debris
  const streakGeo = new THREE.BoxGeometry(1, 1, 1);
  const streaks = [];
  let streakIdx = 0;
  for (let i = 0; i < 56; i++) {
    const m = new THREE.Mesh(streakGeo, new THREE.MeshBasicMaterial({
      color: 0xffc864, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.visible = false; m.frustumCulled = false; m.renderOrder = 9;
    scene.add(m);
    streaks.push({ mesh: m, vel: new THREE.Vector3(), life: 0, max: 0.001, grav: 0, len: 0, w: 0 });
  }
  // flat scorch/dust puffs that bloom and fade at the impact point
  const puffs = [];
  let puffIdx = 0;
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true, opacity: 0, depthWrite: false, depthTest: true,
    }));
    s.visible = false; s.renderOrder = 8;
    scene.add(s);
    puffs.push({ spr: s, life: 0, max: 0.001, grow: 1 });
  }

  CBZ.bulletImpact = function (pos, normal, opts) {
    opts = opts || {};
    if (!sparkTex) { sparkTex = makeSparkTex(); puffTex = makePuffTex(); }
    const kind = opts.kind || "spark";
    const power = opts.power != null ? opts.power : 1;
    _vn.set(normal ? normal.x : 0, normal ? normal.y : 1, normal ? normal.z : 0);
    if (_vn.lengthSq() < 1e-6) _vn.set(0, 1, 0); else _vn.normalize();
    // GROUND hit wearing a wall normal: the shot resolver reflects bullets off
    // near-vertical surfaces, but a round into the STREET (the city's ground
    // raycast plane sits at y≈0.085) must kick its debris UP off the asphalt,
    // not sideways along it.
    if (pos.y < 0.2 && Math.abs(_vn.y) < 0.5) _vn.set(_vn.x * 0.3, 1, _vn.z * 0.3).normalize();
    // tangent basis on the surface for cone-spread debris
    _vt.crossVectors(_vn, UP);
    if (_vt.lengthSq() < 1e-5) _vt.set(1, 0, 0); else _vt.normalize();
    _vb.crossVectors(_vn, _vt).normalize();

    const dust = kind === "dust" || kind === "wood";
    // "chip": solid (non-glowing) flecks in the SURFACE's own colour — paint
    // off a shot car panel. opts.color carries the coat; heavier rounds throw more.
    const chip = kind === "chip";
    const baseColor = opts.color != null ? opts.color
      : (kind === "wood" ? 0xb98b50 : dust ? 0xc8b48c : 0xffc864);
    // power is the round's CALIBER dial: an AK burst chews visibly harder than 9mm
    const count = Math.min(12, Math.round((dust ? 4 : chip ? 5 : 6) * power) + 2);
    for (let i = 0; i < count; i++) {
      const p = streaks[streakIdx];
      streakIdx = (streakIdx + 1) % streaks.length;
      // ricochet cone hugging the normal, with random tangential scatter
      const a = rng() * Math.PI * 2;
      const spread = 0.35 + rng() * 0.75;
      const speed = (dust ? 2.2 : chip ? 3.4 : 5.5) + rng() * (dust ? 2.5 : chip ? 3 : 7) * power;
      p.vel.copy(_vn).multiplyScalar(0.6 + rng() * 0.5)
        .addScaledVector(_vt, Math.cos(a) * spread)
        .addScaledVector(_vb, Math.sin(a) * spread)
        .normalize().multiplyScalar(speed);
      p.mesh.position.copy(pos).addScaledVector(_vn, 0.02);
      p.mesh.material.color.setHex(baseColor);
      p.mesh.material.opacity = dust ? 0.7 : 1;
      p.mesh.material.blending = (dust || chip) ? THREE.NormalBlending : THREE.AdditiveBlending;
      p.len = dust ? 0.05 : chip ? 0.09 : (0.14 + rng() * 0.22);
      p.w = dust ? 0.05 : chip ? 0.032 : 0.018;
      p.grav = dust ? 1.5 : chip ? 11 : 16;
      p.life = dust ? (0.16 + rng() * 0.12) : chip ? (0.13 + rng() * 0.1) : (0.1 + rng() * 0.14);
      p.max = p.life;
      p.mesh.visible = true;
    }
    // a flat puff at the surface (chips kick a small grey paint-powder puff)
    const soft = dust || chip;
    const f = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % puffs.length;
    f.spr.material.map = soft ? puffTex : sparkTex;
    f.spr.material.color.setHex(dust ? 0xffffff : chip ? 0xb9b9b9 : 0xffd28c);
    f.spr.material.blending = soft ? THREE.NormalBlending : THREE.AdditiveBlending;
    f.spr.position.copy(pos).addScaledVector(_vn, 0.03);
    const s0 = (dust ? 0.28 : chip ? 0.18 : 0.2) * (0.8 + power * 0.4);
    f.spr.scale.set(s0, s0, s0);
    f.spr.material.opacity = dust ? 0.75 : chip ? 0.6 : 1;
    f.spr.visible = true;
    f.life = soft ? 0.22 : 0.1;
    f.max = f.life;
    f.grow = dust ? 4.5 : chip ? 3.5 : 2;
  };

  // ---- PERSISTENT BULLET HOLES — the world REMEMBERS the firefight ---------
  // A fixed pool of small dark pock decals (cap 64, oldest recycled) stamped at
  // the hit point along the surface normal. opts.size carries CALIBER (an AK
  // pock reads visibly bigger than a 9mm), opts.parent mounts the decal on a
  // moving body (a car group) so the hole rides the panel it punched —
  // parented hits are SNAPPED onto the real bodywork by a short refinement
  // ray (the caller's point/normal come off the car's bounding box) and
  // capped at HOLE_PER_CAR per body (oldest on that body reused). LOD: a
  // pock you can't see isn't worth a slot — skipped beyond 50u of the camera.
  // The shared geo/material are flagged _shared so vehicles.js' teardown
  // traversal (explodeCar/clearCars disposes non-shared resources) spares them.
  const HOLE_CAP = 64, HOLE_LOD = 50, HOLE_PER_CAR = 10;
  const holes = [];
  let holeIdx = 0, holeSeq = 0, holeGeo = null, holeMat = null;
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _hq = new THREE.Quaternion();
  const _hp = new THREE.Vector3();
  const _hn = new THREE.Vector3();
  const _ray = new THREE.Raycaster();
  const _nm = new THREE.Matrix3();
  function makeHoleMat() {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, "rgba(6,6,8,0.96)");
    g.addColorStop(0.42, "rgba(16,16,20,0.85)");
    g.addColorStop(0.72, "rgba(36,36,42,0.3)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    const m = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    m._shared = true;
    return m;
  }
  let routingProps = false;   // re-entry guard: prop reactions stamp holes of their own
  CBZ.bulletHole = function (pos, normal, opts) {
    opts = opts || {};
    const cam = CBZ.camera;
    // PLAYER-SHOT PROP ROUTING: fpsmode is the only caller that stamps holes,
    // and the player's eye IS the camera — so camera→impact is the round's
    // real path. Street furniture along it reacts (props.js cityShootProp:
    // lamps die, hydrants geyser, cans fly). Runs BEFORE the 50u decal LOD so
    // a sniped hydrant still pops. opts.noProp opts out (NPC ground stamps
    // come in via CBZ.tracer, which already routed the true shooter→target line).
    if (!routingProps && !opts.noProp && CBZ.cityShootProp && CBZ.game && CBZ.game.mode === "city" && cam) {
      routingProps = true;
      try { CBZ.cityShootProp(cam.position, pos); } finally { routingProps = false; }
    }
    const d = opts.dist != null ? opts.dist
      : (cam ? Math.hypot(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z) : 0);
    if (d > HOLE_LOD) return null;
    if (!holeMat) {
      holeMat = makeHoleMat();
      holeGeo = new THREE.PlaneGeometry(1, 1);
      holeGeo._shared = true;
    }
    const parent = opts.parent || scene;
    _hn.set(normal ? normal.x : 0, normal ? normal.y : 0, normal ? normal.z : 1);
    if (_hn.lengthSq() < 1e-6) _hn.set(0, 0, 1); else _hn.normalize();
    _hp.set(pos.x, pos.y, pos.z);
    // CAR SNAP: a parented hit point/normal comes off the car's BOUNDING-BOX
    // slab test (fpsmode findCarHit) — on the real bodywork that point can
    // float a metre off the hood/windshield (the filmed "plastic shield in
    // front of the car"). Refine it: back outside the hull along the entry
    // normal, fire a short ray back IN, and stamp on the first real panel
    // mesh struck — true surface point + true face normal. Nothing visible
    // along the ray means the slab test grazed past the bodywork: no panel,
    // no hole (a floating disc is exactly the bug).
    if (parent !== scene) {
      if (parent.updateWorldMatrix) parent.updateWorldMatrix(true, true);
      _ray.ray.origin.copy(_hp).addScaledVector(_hn, 1.5);
      _ray.ray.direction.copy(_hn).negate();
      _ray.near = 0; _ray.far = 4;
      let best = null;
      parent.traverse(function (o) {
        // meshes only (sprites need a camera + a smoke puff is not a panel);
        // skip shattered/hidden parts and the decals we already stamped
        if (!o.isMesh || !o.visible || o._bulletHole) return;
        const its = _ray.intersectObject(o, false);
        if (its.length && its[0].face && (!best || its[0].distance < best.distance)) best = its[0];
      });
      if (!best) return null;
      _hp.copy(best.point);
      _nm.getNormalMatrix(best.object.matrixWorld);
      _hn.copy(best.face.normal).applyMatrix3(_nm).normalize();
      if (_hn.lengthSq() < 1e-6) _hn.set(0, 1, 0);
    }
    let m = null;
    // PER-CAR CAP: one riddled sedan must not eat the whole pool — past
    // HOLE_PER_CAR on this body, recycle ITS oldest pock instead of a slot.
    if (parent !== scene) {
      let count = 0, oldest = null;
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (h.parent !== parent || !h.visible) continue;
        count++;
        if (!oldest || h._holeSeq < oldest._holeSeq) oldest = h;
      }
      if (count >= HOLE_PER_CAR) m = oldest;
    }
    if (!m) {
      if (holes.length < HOLE_CAP) {
        m = new THREE.Mesh(holeGeo, holeMat);
        m.renderOrder = 4;
        m._bulletHole = true;
        holes.push(m);
      } else {
        m = holes[holeIdx];
        holeIdx = (holeIdx + 1) % HOLE_CAP;
      }
    }
    m._holeSeq = ++holeSeq;
    if (m.parent !== parent) parent.add(m);   // .add() detaches from any old parent
    m.visible = true;
    // street-level hit with a wall-style horizontal normal → the pock lies
    // FLAT on the asphalt (same ground correction as bulletImpact); cars are
    // exempt — a rocker-panel hole at y0.15 really is on a vertical surface.
    if (pos.y < 0.2 && Math.abs(_hn.y) < 0.5 && (!opts.parent || opts.parent === scene)) _hn.set(0, 1, 0);
    if (parent !== scene) {
      // mount in the parent's LOCAL frame so the pock moves with the panel
      parent.worldToLocal(_hp);
      parent.getWorldQuaternion(_hq);
      _hn.applyQuaternion(_hq.invert()).normalize();
    }
    m.position.copy(_hp).addScaledVector(_hn, 0.025);  // nudge off the surface — no z-fight
    m.quaternion.setFromUnitVectors(_zAxis, _hn);
    m.rotateZ(rng() * Math.PI);
    const s = (opts.size || 0.24) * (0.85 + rng() * 0.3);
    m.scale.set(s, s, 1);
    return m;
  };
  // wipe every pock (new run / world rebuild) — pool survives, marks don't
  CBZ.bulletHolesReset = function () {
    for (let i = 0; i < holes.length; i++) {
      holes[i].visible = false;
      if (holes[i].parent !== scene) scene.add(holes[i]);  // un-mount from dead cars
    }
  };

  // one always-updater fades + recycles every transient (runs in all modes,
  // like the rig/facial layers, so brief bursts never freeze mid-fade).
  CBZ.onAlways(54, function (dt) {
    for (let i = liveLines.length - 1; i >= 0; i--) {
      const t = liveLines[i];
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / t.max) * 0.95;
      if (t.life <= 0) { t.mesh.visible = false; linePool.push(t.mesh); liveLines.splice(i, 1); }
    }
    for (let i = liveFlashes.length - 1; i >= 0; i--) {
      const f = liveFlashes[i];
      f.life -= dt;
      f.spr.material.opacity = Math.max(0, f.life / f.max) * (f.peak != null ? f.peak : 1);
      if (f.life <= 0) { f.spr.visible = false; flashPool.push(f.spr); liveFlashes.splice(i, 1); }
    }
    // incoming-fire bolts fade fast (round's already landed)
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.mesh.material.opacity = Math.max(0, b.life / b.max) * b.peak;
      if (b.life <= 0) b.mesh.visible = false;
    }
    // bullet-impact streaks: integrate velocity + gravity, stretch along motion
    for (let i = 0; i < streaks.length; i++) {
      const p = streaks[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      p.vel.y -= p.grav * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const sp = p.vel.length();
      if (sp > 0.01) {
        _v0.copy(p.vel).multiplyScalar(1 / sp);
        p.mesh.quaternion.setFromUnitVectors(UP, _v0);
      }
      p.mesh.scale.set(p.w, p.len + Math.min(0.4, sp * 0.012), p.w);
      p.mesh.material.opacity = Math.max(0, p.life / p.max) * (p.grav > 5 ? 1 : 0.7);
    }
    for (let i = 0; i < puffs.length; i++) {
      const f = puffs[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.spr.visible = false; continue; }
      const k = 1 + f.grow * dt;
      f.spr.scale.multiplyScalar(k);
      f.spr.material.opacity = Math.max(0, f.life / f.max) * (f.spr.material.blending === THREE.NormalBlending ? 0.75 : 1);
    }
  });
})();
