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
     CBZ.bulletImpact(pos,n,o)   — impact burst; o.power scales it by
                                   CALIBER. o.material (+ o.object,
                                   o.color) = the SURFACE that was hit:
                                   it throws chips + dust of THAT
                                   material through CBZ.debris (sparks
                                   only off metal). o.kind "chip" +
                                   o.color = paint flecks off a car.
     CBZ.bulletHole(pos, n, o)   — PERSISTENT pocked decal (pooled;
                                   cap + draw distance ride the LIVE
                                   quality tier, oldest recycled).
                                   o.parent mounts it on a car body
                                   so the hole RIDES the car.
                                   o.mm = the round's BORE in millimetres
                                   (the honest input); o.size is the
                                   legacy metres-wide dial, rescaled onto
                                   the same law by WOUND_DECAL_V2.

   WHY the holes: the evidence a firefight leaves is half its drama —
   a wall you magdumped must STAY pocked, and a 7.62 hole must read
   bigger than a 9mm (o.mm / o.size carries the caliber). What it must
   NOT do is read bigger than the thing it hit: see boreMm()/SPREAD for the
   25-46 cm craters this used to stamp for a pistol round.

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
        CBZ.bulletHole(gp, { x: 0, y: 1, z: 0 }, { size: 0.2, noProp: true, surface: "asphalt" });
        CBZ.bulletImpact(gp, { x: 0, y: 1, z: 0 }, { kind: "dust", surface: "asphalt", power: 0.8 });
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
    m.name = "gunfx-streak"; m.userData.fx = true;       // (a transient impact spark: probes skip it)
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

    /* THE SURFACE THROWS ITSELF. When the caller knows what the round hit
       (opts.material, the struck mesh's own material, and opts.color, its
       real colour at the hit), the burst is chips + dust of that material:
       grey concrete grit off a wall, brick-red crumbs off brick, splinters
       off wood, glass grit off glass, dirt off the ground. Sparks are what
       METAL throws, so only metal (or an unknown surface) still sparks. The
       chips are CBZ.debris's irregular instanced solids that bounce and
       settle, never stretched boxes. */
    const D = CBZ.debris;
    if (D) {
      const mat = opts.material ? (Array.isArray(opts.material) ? opts.material[0] : opts.material) : null;
      let surf = null;
      if (opts.surface) surf = opts.surface;             // a debris.js kind, stated outright
      else if (mat) surf = D.kindOf(mat, opts.object || null);
      else if (kind === "dust") surf = "dirt";
      else if (kind === "wood") surf = "wood";
      else if (kind === "chip") surf = "paint";
      if (surf && surf !== "metal") {
        const px = pos.x + _vn.x * 0.03, py = pos.y + _vn.y * 0.03, pz = pos.z + _vn.z * 0.03;
        if (surf === "paint") {
          D.chips(px, py, pz, { kind: "plastic", color: opts.color, count: Math.min(8, 2 + Math.round(3 * power)),
            dir: _vn, power: 0.6 + 0.3 * power, size: 0.022, spread: 0.2, dust: false });
        } else {
          D.chips(px, py, pz, { kind: surf, material: mat || undefined,
            color: opts.color != null ? opts.color : (mat ? undefined : (kind === "dust" ? 0xc8b48c : undefined)),
            count: Math.min(10, 3 + Math.round(3 * power)), dir: _vn, power: 0.5 + 0.35 * power,
            size: surf === "glass" ? 0.028 : 0.035, spread: 0.25, radius: 0.22 + 0.1 * power });
        }
        return;
      }
    }
    const dust = kind === "dust" || kind === "wood";
    // "chip" without CBZ.debris on the page: solid flecks in the car's coat
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
  //
  //  BULLET_HOLE_MATERIALS (2026-09-29, owner: "bullet holes ... realness").
  //  WHAT WAS FAKE: every surface in the game got the SAME grey smudge — one
  //  radial gradient on one canvas — whether the round went into brick, a
  //  steel lamp post, a pine door, a windscreen or asphalt. A hole is the
  //  most material-specific mark a firefight leaves, and ours said nothing.
  //  Worse, each pock was its own Mesh (one draw call per hole, up to 128),
  //  lit by nothing (MeshBasic), so a pale crater in a shaded alley glowed at
  //  full daylight brightness, and a wall hole took its normal from the SHOT
  //  direction flattened to horizontal, so a hole at an angle on a wall
  //  tilted off the surface by the angle of fire.
  //
  //  NOW:
  //   • ONE ATLAS (4x2 tiles, painted once at load) — a hole per MATERIAL:
  //       concrete  chipped pale crater, hairline cracks, grey dust halo
  //       brick     same crater in fresh brick core, orange dust
  //       metal     bright punched rim, bare-steel ring where the paint went
  //       wood      torn pit elongated along the grain, raw splinters
  //       glass     spider web: crushed white cone, radial + ring cracks
  //       asphalt   dark gouge with a grey scuff of pulverised aggregate
  //       carpaint  punched sheet: steel lip, bare-metal ring, primer halo
  //                 (neutral, so it reads right on every paint colour)
  //       soft      plastic / rubber / upholstery: torn hole, stress-white
  //   • WORLD holes are ONE InstancedMesh (one draw call for all of them, so
  //     the cap goes UP, not down — owner: perf via instancing, never looks).
  //     A per-instance `aTile` attribute picks the atlas tile in the vertex
  //     shader (onBeforeCompile on the uv chunk; r128 has no batched tiling).
  //   • MOUNTED holes (car panels, opening doors) stay real meshes so they ride
  //     the body; they share the SAME material through per-tile geometries
  //     that carry aTile per vertex — one program, eight tiny buffers.
  //   • LAMBERT, receiveShadow: the mark is lit and shadowed exactly like the
  //     surface it sits on (same normal), so it never glows in the shade.
  //   • FLUSH: offset 2-4 mm along the TRUE surface normal (callers pass the
  //     struck face's normal now), polygonOffset does the z-fight work.
  //
  //  Surface is chosen by, in order: opts.surface (a kind named outright),
  //  opts.material/opts.object (debris.js kindOf — the same classifier the
  //  impact chips already use, so the hole and the chips can never disagree),
  //  the snapped panel's own material for a mounted hole, else concrete.
  //  HOLES STAY (owner 2026-10-09: "bullet holes disappear after a while,
  //  which is dumb"). Nothing here has a timer; a hole goes only when a cap
  //  is reached, and then the one recycled is the one FURTHEST from the lens
  //  (behind it first), never the oldest-in-a-ring that may be the wall you
  //  are looking at. World holes are one InstancedMesh (one draw call for
  //  all of them), so the cap is generous: 4096 on desktop, a few hundred on
  //  a phone / iPad. The stamp range went 30-90 m -> 90-300 m, so a hole made
  //  down the street is still there when you walk up to it.
  const HOLE_MAX = 4096;      // instanced capacity (the tier cap never exceeds it)
  function holeCap() {
    const hi = CBZ.isMobileDevice ? 600 : HOLE_MAX;
    return (CBZ.qScale ? CBZ.qScale(Math.min(256, hi), hi) : hi) | 0;
  }
  function holeLod()    { return CBZ.qScale ? CBZ.qScale(90, 300) : 200; }
  function holePerCar() { return (CBZ.qScale ? CBZ.qScale(16, 48) : 32) | 0; }
  function mountCap()   { return (CBZ.qScale ? CBZ.qScale(60, CBZ.isMobileDevice ? 120 : 320) : 160) | 0; }
  // per-slot world position of every instanced hole, for the far-first recycle
  const slotPos = new Float32Array(HOLE_MAX * 3);
  const _cf = new THREE.Vector3();
  // the hole the player is least likely to be looking at: far, then behind the
  // lens; `n` candidates, position read by `at(i, out3)`
  function farthestOf(n, at) {
    const cam = CBZ.camera;
    if (!cam || n <= 0) return 0;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    cam.getWorldDirection(_cf);
    let best = 0, bs = -Infinity;
    const p = _fp3;
    for (let i = 0; i < n; i++) {
      if (!at(i, p)) return i;                       // a free/dead slot: take it
      const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
      let sc = dx * dx + dy * dy + dz * dz;
      if (dx * _cf.x + dy * _cf.y + dz * _cf.z < 0) sc += 1e6;   // behind the lens
      if (sc > bs) { bs = sc; best = i; }
    }
    return best;
  }
  const _fp3 = [0, 0, 0];
  function slotAt(i, out) { out[0] = slotPos[i * 3]; out[1] = slotPos[i * 3 + 1]; out[2] = slotPos[i * 3 + 2]; return true; }

  // ---- HOW BIG IS A BULLET HOLE, ACTUALLY (WOUND_DECAL_V2) -----------------
  //  A 9 mm bore leaves a ~9 mm hole; what you SEE is the spall / chip ring /
  //  web around it, whose width depends on the MATERIAL. The quad's width is
  //  bore x SPREAD[kind]. Concrete keeps the old 10x law exactly (a 9 mm wall
  //  hole is still a 9 cm mark); metal punches clean (4x), glass webs wide.
  //  Legacy `size` callers are rescaled by HOLE_V2_MUL onto the same law.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.WOUND_DECAL_V2 == null) CBZ.CONFIG.WOUND_DECAL_V2 = true;
  const HOLE_SPALL = 10;      // concrete: quad width ÷ bore
  const HOLE_V2_MUL = 0.36;   // legacy `size` dial → the same law
  const TILE = { concrete: 0, brick: 1, metal: 2, wood: 3, glass: 4, asphalt: 5, carpaint: 6, soft: 7 };
  const SPREAD = { concrete: 10, brick: 11, metal: 4.4, wood: 8.5, glass: 34, asphalt: 9, carpaint: 5, soft: 5.5 };
  function boreMm(opts) {
    if (opts.mm != null) return Math.max(2, Math.min(30, opts.mm));
    const v2 = CBZ.CONFIG.WOUND_DECAL_V2 !== false;
    const legacy = opts.size || 0.24;
    return (v2 ? legacy * HOLE_V2_MUL : legacy) * 1000 / HOLE_SPALL;
  }
  // debris.js kinds (and our own) → an atlas tile
  function tileKind(k) {
    if (TILE[k] != null) return k;
    if (k === "rock") return "concrete";
    if (k === "dirt") return "asphalt";
    if (k === "plastic" || k === "rubber" || k === "fabric" || k === "cloth") return "soft";
    if (k === "foliage") return "wood";
    return "concrete";
  }
  function kindFor(mat, obj) {
    const D = CBZ.debris;
    if (!mat && !obj) return null;
    if (D && D.kindOf) { try { return D.kindOf(mat, obj || null); } catch (e) { /* fall through */ } }
    return null;
  }

  // ---- the atlas: eight holes, painted once --------------------------------
  const AT_COLS = 4, AT_ROWS = 2, AT_PX = 128;
  function paintAtlas() {
    const c = document.createElement("canvas");
    c.width = AT_COLS * AT_PX; c.height = AT_ROWS * AT_PX;
    const x = c.getContext("2d");
    let s = 7741;
    const r = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const R = AT_PX * 0.47;                       // usable radius (3 px clear margin: no mip bleed)
    function blob(cx, cy, rad, n, jit, fill, sx, sy) {
      x.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i % n) / n * Math.PI * 2, k = rad * (1 - jit + r() * jit * 2);
        const px = cx + Math.cos(a) * k * (sx || 1), py = cy + Math.sin(a) * k * (sy || 1);
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.fillStyle = fill; x.fill();
    }
    function halo(cx, cy, r0, r1, rgb, a0) {
      const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1);
      g.addColorStop(0, "rgba(" + rgb + "," + a0 + ")"); g.addColorStop(1, "rgba(" + rgb + ",0)");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r1, 0, Math.PI * 2); x.fill();
    }
    function bore(cx, cy, rad) {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, "rgba(3,3,4,1)"); g.addColorStop(0.62, "rgba(6,6,7,0.97)"); g.addColorStop(1, "rgba(10,10,12,0)");
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
    }
    function crack(cx, cy, a, r0, r1, w, col) {
      x.strokeStyle = col; x.lineWidth = w; x.lineCap = "round";
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const rr = r0 + (r1 - r0) * i / steps, aa = a + (r() - 0.5) * 0.22;
        x.lineTo(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr);
      }
      x.stroke();
    }
    function chips(cx, cy, n, r0, r1, sz, fill) {
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = r0 + r() * (r1 - r0);
        blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, sz * (0.5 + r()), 5, 0.4, fill);
      }
    }
    // a masonry crater: dust halo → chipped fresh face → shaded pit → bore
    function masonry(cx, cy, dust, face, faceDark, chip) {
      halo(cx, cy, R * 0.2, R * 0.98, dust, 0.30);
      chips(cx, cy, 14, R * 0.38, R * 0.72, R * 0.045, chip);
      blob(cx, cy, R * 0.44, 18, 0.28, face);
      blob(cx, cy, R * 0.30, 14, 0.25, faceDark);
      for (let i = 0; i < 4; i++) crack(cx, cy, r() * 6.28, R * 0.3, R * (0.62 + r() * 0.3), 1, "rgba(28,26,24,0.45)");
      bore(cx, cy, R * 0.19);
    }
    for (let t = 0; t < 8; t++) {
      const cx = (t % AT_COLS) * AT_PX + AT_PX / 2, cy = ((t / AT_COLS) | 0) * AT_PX + AT_PX / 2;
      x.save();
      x.beginPath(); x.rect(cx - AT_PX / 2 + 2, cy - AT_PX / 2 + 2, AT_PX - 4, AT_PX - 4); x.clip();
      if (t === 0) {          // concrete
        masonry(cx, cy, "70,67,62", "rgba(184,179,169,0.92)", "rgba(120,116,108,0.9)", "rgba(170,165,156,0.7)");
      } else if (t === 1) {   // brick
        masonry(cx, cy, "150,92,64", "rgba(196,112,78,0.94)", "rgba(126,62,40,0.92)", "rgba(186,106,72,0.75)");
      } else if (t === 2) {   // bare / painted metal (poles, hydrants, propane)
        halo(cx, cy, R * 0.3, R * 0.8, "22,20,18", 0.22);               // scorch / lead wipe
        blob(cx, cy, R * 0.56, 20, 0.22, "rgba(196,200,206,0.95)");     // paint knocked off: bare steel
        blob(cx, cy, R * 0.50, 20, 0.18, "rgba(168,172,178,0.95)");
        x.strokeStyle = "rgba(235,238,242,1)"; x.lineWidth = R * 0.09;  // the punched lip, bright
        x.beginPath(); x.arc(cx, cy, R * 0.25, 0, Math.PI * 2); x.stroke();
        for (let i = 0; i < 7; i++) crack(cx, cy, i / 7 * 6.28 + r() * 0.4, R * 0.18, R * 0.3, 1.4, "rgba(60,62,66,0.8)"); // petals
        bore(cx, cy, R * 0.22);
      } else if (t === 3) {   // wood — the grain runs along the tile's Y
        halo(cx, cy, R * 0.1, R * 0.7, "40,26,14", 0.22);
        for (let i = 0; i < 16; i++) {                                   // splinters, along the grain
          const up = i % 2 ? -1 : 1, off = (r() - 0.5) * R * 0.5, len = R * (0.35 + r() * 0.55);
          const w = R * (0.03 + r() * 0.05);
          x.fillStyle = r() < 0.7 ? "rgba(222,186,128,0.95)" : "rgba(160,118,70,0.9)";
          x.beginPath(); x.moveTo(cx + off - w, cy); x.lineTo(cx + off + w, cy);
          x.lineTo(cx + off + (r() - 0.5) * w * 2, cy + up * len); x.closePath(); x.fill();
        }
        blob(cx, cy, R * 0.22, 14, 0.3, "rgba(214,176,120,0.95)", 0.8, 1.5);   // raw torn fibre
        blob(cx, cy, R * 0.15, 12, 0.3, "rgba(44,28,14,0.96)", 0.75, 1.6);
        bore(cx, cy, R * 0.12);
      } else if (t === 4) {   // glass — spider web
        const n = 12, ang = [], len = [];
        for (let i = 0; i < n; i++) { ang.push(i / n * 6.28 + (r() - 0.5) * 0.4); len.push(R * (0.55 + r() * 0.42)); }
        for (let i = 0; i < n; i++) crack(cx, cy, ang[i], R * 0.04, len[i], 1.3, "rgba(236,244,247,0.85)");
        const rings = [0.16, 0.3, 0.48];
        x.strokeStyle = "rgba(226,236,240,0.6)"; x.lineWidth = 1;
        for (let k = 0; k < rings.length; k++) {
          x.beginPath();
          for (let i = 0; i <= n; i++) {
            const j = i % n; if (len[j] < R * rings[k] * 1.1) { x.moveTo(cx, cy); continue; }
            const rr = R * rings[k] * (0.85 + r() * 0.3);
            const px = cx + Math.cos(ang[j]) * rr, py = cy + Math.sin(ang[j]) * rr;
            if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
          }
          x.stroke();
        }
        halo(cx, cy, 0, R * 0.13, "238,244,246", 0.9);                  // crushed cone
        bore(cx, cy, R * 0.04);
      } else if (t === 5) {   // asphalt / dirt
        blob(cx, cy, R * 0.62, 16, 0.3, "rgba(118,113,104,0.35)", 1, 0.8); // pulverised aggregate
        chips(cx, cy, 10, R * 0.3, R * 0.7, R * 0.04, "rgba(140,134,124,0.6)");
        blob(cx, cy, R * 0.32, 14, 0.3, "rgba(22,22,22,0.92)");
        bore(cx, cy, R * 0.18);
      } else if (t === 6) {   // car paint over sheet steel
        blob(cx, cy, R * 0.66, 22, 0.25, "rgba(146,146,140,0.85)");     // primer where the coat flaked
        for (let i = 0; i < 6; i++) crack(cx, cy, r() * 6.28, R * 0.5, R * (0.72 + r() * 0.2), 1, "rgba(40,40,40,0.35)");
        blob(cx, cy, R * 0.42, 18, 0.2, "rgba(204,208,212,0.97)");     // bare metal
        x.strokeStyle = "rgba(90,92,96,0.9)"; x.lineWidth = R * 0.06;
        x.beginPath(); x.arc(cx, cy, R * 0.24, 0, Math.PI * 2); x.stroke();   // lip turned in
        bore(cx, cy, R * 0.2);
      } else {                // soft: plastic, rubber, upholstery
        blob(cx, cy, R * 0.5, 16, 0.3, "rgba(222,222,216,0.35)");       // stress whitening
        blob(cx, cy, R * 0.3, 22, 0.45, "rgba(18,18,18,0.9)");          // torn, ragged
        bore(cx, cy, R * 0.2);
      }
      x.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  let holeMat = null, holeInst = null, aTileI = null;
  const tileGeos = {};          // kind → PlaneGeometry carrying aTile per VERTEX (mounted holes)
  function tileOff(kind, out, o) {
    const t = TILE[kind] | 0;
    out[o] = (t % AT_COLS) / AT_COLS;
    out[o + 1] = 1 - (((t / AT_COLS) | 0) + 1) / AT_ROWS;   // canvas y runs down, uv v runs up
  }
  function ensureHoles() {
    if (holeMat) return;
    holeMat = new THREE.MeshLambertMaterial({
      map: paintAtlas(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    holeMat._shared = true;
    holeMat.onBeforeCompile = function (sh) {
      sh.vertexShader = "attribute vec2 aTile;\n" + sh.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\n#ifdef USE_UV\n  vUv = vUv * vec2(0.25, 0.5) + aTile;\n#endif");
    };
    holeMat.customProgramCacheKey = function () { return "cbzHoleAtlas1"; };
    const g = new THREE.PlaneGeometry(1, 1);
    aTileI = new THREE.InstancedBufferAttribute(new Float32Array(HOLE_MAX * 2), 2);
    aTileI.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aTile", aTileI);
    g._shared = true;
    holeInst = new THREE.InstancedMesh(g, holeMat, HOLE_MAX);
    holeInst.count = 0;
    holeInst.frustumCulled = false;            // holes are scattered city-wide
    holeInst.receiveShadow = true;
    holeInst.renderOrder = 4;
    holeInst._bulletHole = true;
    holeInst.userData.noHit = true;
    holeInst.name = "bulletHoles";
    scene.add(holeInst);
    const ks = Object.keys(TILE);
    for (let i = 0; i < ks.length; i++) {
      const pg = new THREE.PlaneGeometry(1, 1);
      const a = new Float32Array(pg.attributes.position.count * 2);
      for (let v = 0; v < pg.attributes.position.count; v++) tileOff(ks[i], a, v * 2);
      pg.setAttribute("aTile", new THREE.BufferAttribute(a, 2));
      pg._shared = true;
      tileGeos[ks[i]] = pg;
    }
  }
  let instFill = 0;
  const mounted = [];            // real meshes riding a car / door
  let holeSeq = 0;
  const _zAxis = new THREE.Vector3(0, 0, 1);
  const _hq = new THREE.Quaternion();
  const _spinQ = new THREE.Quaternion();
  const _hp = new THREE.Vector3();
  const _hn = new THREE.Vector3();
  const _hy = new THREE.Vector3();
  const _ht = new THREE.Vector3();
  const _hs = new THREE.Vector3();
  const _hm = new THREE.Matrix4();
  const _ray = new THREE.Raycaster();
  const _nm = new THREE.Matrix3();
  const _UP = new THREE.Vector3(0, 1, 0);
  // Orient +Z along the normal and spin in-plane. Wood keeps its splinters on
  // the grain (the tile's Y to world-up); everything else spins freely so no
  // two holes on a wall share a silhouette.
  function orientHole(q, n, kind) {
    q.setFromUnitVectors(_zAxis, n);
    let spin = rng() * Math.PI * 2;
    if (kind === "wood") {
      _ht.copy(_UP).addScaledVector(n, -n.y);                 // world-up, in the surface
      if (_ht.lengthSq() > 0.09) {
        _ht.normalize();
        _hy.set(0, 1, 0).applyQuaternion(q);
        _hs.crossVectors(_hy, _ht);
        spin = Math.atan2(_hs.dot(n), _hy.dot(_ht)) + (rng() - 0.5) * 0.25;
      }
    }
    _spinQ.setFromAxisAngle(_zAxis, spin);
    q.multiply(_spinQ);
    return q;
  }
  let routingProps = false;   // re-entry guard: prop reactions stamp holes of their own
  CBZ.bulletHole = function (pos, normal, opts) {
    opts = opts || {};
    const cam = CBZ.camera;
    // PLAYER-SHOT PROP ROUTING (see props.js cityShootProp) — before the LOD,
    // so a sniped hydrant still pops. opts.noProp opts out.
    if (!routingProps && !opts.noProp && CBZ.cityShootProp && CBZ.game && CBZ.game.mode === "city" && cam) {
      routingProps = true;
      try { CBZ.cityShootProp(cam.position, pos); } finally { routingProps = false; }
    }
    const d = opts.dist != null ? opts.dist
      : (cam ? Math.hypot(pos.x - cam.position.x, pos.y - cam.position.y, pos.z - cam.position.z) : 0);
    if (d > holeLod()) return null;
    ensureHoles();
    const parent = opts.parent || scene;
    _hn.set(normal ? normal.x : 0, normal ? normal.y : 0, normal ? normal.z : 1);
    if (_hn.lengthSq() < 1e-6) _hn.set(0, 0, 1); else _hn.normalize();
    _hp.set(pos.x, pos.y, pos.z);
    let kind = opts.surface || kindFor(opts.material, opts.object);
    // CAR / DOOR SNAP: a parented point/normal comes off a bounding-box slab
    // test; back out along the normal, fire a short ray back in, and stamp on
    // the first REAL panel struck (true point + true face normal + that
    // panel's own material). No panel on the ray = no hole: a floating disc
    // is exactly the bug.
    if (parent !== scene) {
      if (parent.updateWorldMatrix) parent.updateWorldMatrix(true, true);
      _ray.ray.origin.copy(_hp).addScaledVector(_hn, 1.5);
      _ray.ray.direction.copy(_hn).negate();
      _ray.near = 0; _ray.far = 4;
      let best = null;
      parent.traverse(function (o) {
        if (!o.isMesh || !o.visible || o._bulletHole) return;
        const its = _ray.intersectObject(o, false);
        if (its.length && its[0].face && (!best || its[0].distance < best.distance)) best = its[0];
      });
      if (!best) return null;
      _hp.copy(best.point);
      _nm.getNormalMatrix(best.object.matrixWorld);
      _hn.copy(best.face.normal).applyMatrix3(_nm).normalize();
      if (_hn.lengthSq() < 1e-6) _hn.set(0, 1, 0);
      if (!opts.surface) {
        let pm = best.object.material;
        if (Array.isArray(pm)) pm = pm[(best.face && best.face.materialIndex) || 0] || pm[0];
        const k = kindFor(pm, best.object);
        if (k) kind = k;
      }
      // painted bodywork: the classifier's grey-default is sheet steel here
      if (opts.car && (kind == null || kind === "concrete" || kind === "metal" || kind === "brick" || kind === "wood")) kind = "carpaint";
    }
    kind = tileKind(kind || "concrete");
    // street-level hit with a wall-style normal → the pock lies FLAT on the
    // asphalt; mounted bodywork is exempt (a rocker-panel hole is vertical).
    if (pos.y < 0.2 && Math.abs(_hn.y) < 0.5 && parent === scene) _hn.set(0, 1, 0);
    const s = boreMm(opts) * 0.001 * SPREAD[kind] * (0.85 + rng() * 0.3);
    // FLUSH: a hair along the TRUE normal (never a visible gap edge-on) and
    // polygonOffset wins the depth test. Mounted panels lead the transform by
    // a frame, so they keep a slightly larger floor.
    const off = Math.max(parent !== scene ? 0.004 : 0.002, Math.min(0.006, s * 0.03));
    _hp.addScaledVector(_hn, off);
    const seq = ++holeSeq;
    if (parent === scene) {
      orientHole(_hq, _hn, kind);
      _hm.compose(_hp, _hq, _hs.set(s, s, 1));
      const cap = Math.min(HOLE_MAX, holeCap());
      let slot;
      if (instFill < cap) { slot = instFill++; }
      else {
        // full: recycle the hole furthest from the lens (a tier drop shrinks
        // the cap: the instances past it simply stop drawing)
        if (instFill > cap) instFill = cap;
        slot = farthestOf(instFill, slotAt);
      }
      slotPos[slot * 3] = _hp.x; slotPos[slot * 3 + 1] = _hp.y; slotPos[slot * 3 + 2] = _hp.z;
      if (holeInst.parent !== scene) scene.add(holeInst);   // a world rebuild swept the scene
      holeInst.setMatrixAt(slot, _hm);
      tileOff(kind, aTileI.array, slot * 2);
      holeInst.count = instFill;
      holeInst.instanceMatrix.needsUpdate = true;
      aTileI.needsUpdate = true;
      return holeInst;
    }
    // ---- mounted: a real mesh on the moving body ----
    let m = null;
    let count = 0, oldest = null;
    for (let i = 0; i < mounted.length; i++) {
      const h = mounted[i];
      if (!h.visible) { if (!m) m = h; continue; }
      if (h.parent !== parent) {
        // a hole on a car that has left the world (scrapped, despawned) is
        // nobody's hole any more: the first free slot
        if (!m && !inScene(h)) { m = h; }
        continue;
      }
      count++;
      if (!oldest || h._holeSeq < oldest._holeSeq) oldest = h;
    }
    if (count >= holePerCar()) m = oldest;          // one riddled sedan must not eat the pool
    if (!m) {
      if (mounted.length < mountCap()) {
        m = new THREE.Mesh(tileGeos[kind], holeMat);
        m.renderOrder = 4;
        m.receiveShadow = true;
        m._bulletHole = true;
        mounted.push(m);
      } else m = mounted[farthestOf(mounted.length, mountAt)];
    }
    m.geometry = tileGeos[kind];
    m._holeSeq = seq;
    if (m.parent !== parent) parent.add(m);
    m.visible = true;
    parent.worldToLocal(_hp);
    parent.getWorldQuaternion(_hq);
    _hn.applyQuaternion(_hq.invert()).normalize();
    orientHole(m.quaternion, _hn, kind);
    m.position.copy(_hp);
    m.scale.set(s, s, 1);
    return m;
  };
  function inScene(o) { while (o) { if (o === scene) return true; o = o.parent; } return false; }
  const _mw = new THREE.Vector3();
  function mountAt(i, out) {
    const h = mounted[i];
    if (!h.visible || !inScene(h)) return false;
    h.getWorldPosition(_mw);
    out[0] = _mw.x; out[1] = _mw.y; out[2] = _mw.z;
    return true;
  }
  // wipe every pock (new run / world rebuild) — pools survive, marks don't
  CBZ.bulletHolesReset = function () {
    instFill = 0;
    if (holeInst) holeInst.count = 0;
    for (let i = 0; i < mounted.length; i++) {
      mounted[i].visible = false;
      if (mounted[i].parent !== scene) scene.add(mounted[i]);  // un-mount from dead cars
    }
  };
  // for the tools: how many marks of each surface are live
  CBZ.bulletHoleAudit = function () {
    const by = {};
    if (aTileI) {
      for (let i = 0; i < instFill; i++) {
        const u = aTileI.array[i * 2], v = aTileI.array[i * 2 + 1];
        const t = Math.round(u * AT_COLS) + (AT_ROWS - 1 - Math.round(v * AT_ROWS)) * AT_COLS;
        const k = Object.keys(TILE)[t] || "?";
        by[k] = (by[k] || 0) + 1;
      }
    }
    let mountedLive = 0;
    for (let i = 0; i < mounted.length; i++) if (mounted[i].visible) mountedLive++;
    return { world: instFill, mounted: mountedLive, bySurface: by, drawCalls: (instFill ? 1 : 0) + mountedLive };
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

  // ---- FIRST-SHOT PREWARM (same de-spike as crashfx's first-blast block) ----
  // The tracer Line, the muzzle-flash sprite and the impact textures were all
  // minted lazily on the FIRST shot of a session — and r128 only compiles a
  // material's shader program the first time an object using it actually
  // renders, so the first trigger pull paid canvas bakes + allocations + a
  // LineBasicMaterial/SpriteMaterial program compile inside one frame. Build
  // them at load instead (visible=false, exactly the shape the pools recycle
  // into); core/fxwarm.js compiles their programs during the play-start
  // transition, so the first shot of the session hits warm caches.
  flashTex = makeFlashTex();
  sparkTex = makeSparkTex();
  puffTex = makePuffTex();
  // the impact-puff sprites above were built map-LESS (their map used to arrive
  // with the first bulletImpact, without needsUpdate). That only worked because
  // their first render happened after that assignment; with the play-start
  // renderer.compile() pass (core/fxwarm.js) their program would be frozen in
  // the no-map variant — r128 only re-keys a program on needsUpdate. Seat the
  // map NOW so the material carries one from birth and every later swap at
  // bulletImpact is texture↔texture (uniform rebind, never a program change).
  for (let i = 0; i < puffs.length; i++) puffs[i].spr.material.map = puffTex;
  // the hole atlas + its one InstancedMesh: painted and parented at load, so
  // the first pock of the session is a setMatrixAt, not a canvas bake.
  try { ensureHoles(); } catch (e) { /* headless: built lazily on first hole */ }
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    s.renderOrder = 9; s.visible = false;
    scene.add(s);
    flashPool.push(s);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95, depthWrite: false }));
    m.frustumCulled = false; m.renderOrder = 8; m.visible = false;
    scene.add(m);
    linePool.push(m);
  }
})();
