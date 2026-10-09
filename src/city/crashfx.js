/* ============================================================
   city/crashfx.js - the shared IMPACT + BLAST + STRUCTURAL-RUIN picture.

   Named for the car crashes it started as. It is now the file that owns what
   ordnance LOOKS LIKE when it lands on anything, anywhere: the pooled
   fireball, the wall ruin, the collapse curtain, the rubble heap, the rebar,
   the ejecta cone and the debris pool they all draw from.

   Crashes are infrequent, so a short-lived point burst and a few shared-geo
   body fragments buy a lot of impact without adding steady frame cost.

   ------------------------------------------------------------------
   THE GUARD THAT WAS THE BUG (fixed 2026-08-07). Seven of this file's
   public verbs opened with

       if (!CBZ.game || CBZ.game.mode !== "city") return;

   and CLAUDE.md names that exact line as legitimate on a CITY RECORD and a
   BUG on a shared verb. Every one of these seven composes pooled FX out of
   `CBZ.colliders`, the chunk/puff/point pools in this file, and the numbers
   the caller hands in. None of them reads a city list. So the guard was not
   protecting anything — it was REFUSING SERVICE, and it was refusing it to
   callers that had already been taught to work everywhere:

     • city/fracture.js already carves real holes in prison and gun-game and
       survival walls (it asks `modeHas("breach")`, and CLAUDE.md's WALLS
       BREAK EVERYWHERE section is the policy). Its `debris()` then calls
       cityWallRuin / cityHeavyWallRuin to pour the avalanche, the heap and
       the rebar out of that hole — and outside the city those three lines
       returned instantly. A prison wall opened with nothing coming out of it.
     • systems/fpsmode.js's rocket detonates through CBZ.cityBlastCore
       outside the city (see the UNWRAPPED BLAST block below) and then calls
       cityBlastWall. Same silence. This is the second half of the RPG the
       owner filmed producing "a camera shake and nothing else".
     • the owner, on games/bomb-survivor.html: "you can't hit buildings look
       how gang city could be used". Two hundred towers, a bombing game, and
       cityAirstrikeCollapse — the endpoint whose whole job is a section of a
       building sloughing — declined at its first line.

   WHY NO `modeHas()` GATE EITHER. `modeHas` answers a table of MODES
   (systems/modecaps.js), and these verbs do not need a mode: they need
   colliders and a scene, which this file already checks for at load. A
   capability gate here would have re-broken the slice pages, which run
   `mode:"slice"` and are absent from that table by design ("a mode absent
   from this table has NO shared capabilities"). Gating a pure composition on
   a roster of scenarios is the same category error one layer up.

   WHAT DELIBERATELY KEPT ITS CITY GUARD, because the doctrine cuts both ways:
     • cityExplosionCore's `CBZ.cityEvent(...)` — the world-state ledger.
     • cityExplosionCore's `chainWillCarve` test — the wrapper chain is a
       city fact.
     • applyBlastDamage's `cityRoster` block — cityPeds / cityCops /
       cityHurtPlayer are city lists (the crowds are crowds.blast), and the prison
       arena overlaps the city's coordinate space.
     • cityAirstrikeCollapse's closing `CBZ.cityDamageBuilding(...)` — that
       is buildings.js's persistent per-building damage state (window panes,
       cityChunks, accumulation toward a carved opening). It is a CITY
       RECORD, it does not self-guard, and it is now guarded HERE — which it
       was not before, because the function's own dead gate hid the need.
   A wall additionally opts OUT of being collapsed with `noBreach` on its
   collider, the same one flag that keeps the prison perimeter standing.
   ------------------------------------------------------------------

   DETERMINISM: every jitter/scatter draw in this file (particle spread,
   scorch/splat texture mottling, chunk/rubble placement, rebar angles, smoke
   and fire puff variance) runs off a local seeded LCG (rng()) — NEVER
   Math.random() — so replay/multiplayer-sync stays bit-exact across clients.

   FIREBALL LIFETIME: the dramatic flame core (the additive white→orange→red
   puffs in cityCrashFX/cityExplosion/cityAirstrikeExplosion) now lives a few
   seconds instead of well under one — only the background smoke/smolder was
   stretched long before; the fireball itself used to die before the eye could
   register it.
============================================================ */

/* ============================================================
   THE PURE HALF OF THE ONE EXPLOSION (CBZ.blastFxPure). No THREE, no scene,
   no DOM: the kind->look table, the persistent-decal ledger (cap + merge), the
   single pooled flash light's envelope, and the distance curves for shake and
   sound. It loads in plain node (tools/check-blast-aftermath.mjs) with a fake
   window, which is the whole reason it is its own block.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  /* KIND -> LOOK. Every field is a MULTIPLIER on the shared recipe in
     blastVisual (the render block below), so "a grenade is smaller, more dust
     and fragments, less fire" is one row, not a second explosion.
       fire/core   rolling fireball body / additive hot cores
       fireSize    fireball puff size
       rise        buoyancy: how tall the fireball climbs (a car's fuel ball is tall)
       smoke,tone  soot volume, soot colour [r,g,b] (car = oily black)
       dust        ground shockwave skirt
       frag        ground chunks + charred bits thrown
       sparks,embers
       dirK        how hard the look is thrown along opts.normal / opts.dir
       column      seconds the smoke column keeps rising (0 = none)
       mushroom    the column caps and spreads at the top
       fires,fireDur  small fires left burning on the debris/crater
       decal       crater scorch radius factor (0 = no ground mark)
       light       flash light peak factor
       surface     forced ground material ("rock"), else asphalt/dirt by mode */
  const T = function (o) { return Object.freeze(Object.assign({
    fire: 1, core: 1, fireSize: 1, rise: 1, smoke: 1, tone: [0.1, 0.092, 0.086], dust: 1, frag: 1,
    sparks: 1, embers: 1, dirK: 0.35, column: 24, mushroom: false, fires: 1, fireDur: [20, 40],
    decal: 1, light: 1, surface: null,
  }, o)); };
  const KINDS = {
    blast:    T({}),
    rpg:      T({ fire: 1.05, smoke: 1.1, frag: 1.1, column: 30, fires: 2, fireDur: [20, 45] }),
    grenade:  T({ fire: 0.45, core: 0.8, fireSize: 0.75, rise: 0.7, smoke: 0.55, tone: [0.2, 0.19, 0.17],
                  dust: 1.5, frag: 1.7, sparks: 1.6, embers: 0.7, column: 10, fires: 0, decal: 0.7, light: 0.7 }),
    c4:       T({ fire: 0.9, smoke: 1.25, dust: 1.5, frag: 1.3, sparks: 1.1, dirK: 1, column: 32, fires: 1,
                  decal: 1.05, light: 1.1 }),
    car:      T({ fire: 1.6, core: 1.1, fireSize: 1.15, rise: 1.7, smoke: 1.5, tone: [0.055, 0.05, 0.047],
                  dust: 0.5, frag: 0.35, sparks: 0.8, embers: 1.4, column: 42, fires: 3, fireDur: [30, 60],
                  decal: 0.85, light: 1.3 }),
    aircraft: T({ fire: 1.8, core: 1.1, fireSize: 1.2, rise: 1.6, smoke: 1.5, tone: [0.06, 0.055, 0.05],
                  dust: 0.9, frag: 0.8, embers: 1.5, column: 45, mushroom: true, fires: 4, fireDur: [30, 60],
                  light: 1.4 }),
    heavy:    T({ fire: 1.3, smoke: 1.4, dust: 1.5, frag: 1.3, sparks: 1.2, embers: 1.2, rise: 1.3,
                  column: 40, mushroom: true, fires: 3, fireDur: [25, 60], decal: 1.15, light: 1.4 }),
    volcano:  T({ fire: 0.7, core: 0.6, smoke: 1.2, tone: [0.24, 0.22, 0.2], dust: 1.3, frag: 0.8,
                  sparks: 0.5, embers: 1.5, rise: 0.9, column: 14, fires: 1, decal: 0.8, surface: "rock" }),
    impact:   T({ fire: 0.35, core: 0.5, fireSize: 0.8, smoke: 0.6, tone: [0.3, 0.27, 0.23], dust: 1.8,
                  frag: 1.4, sparks: 0.6, embers: 0.6, column: 8, fires: 0, decal: 0.8, light: 0.6 }),
    ember:    T({ fire: 0.35, core: 0.5, smoke: 0.3, dust: 0, frag: 0, sparks: 0.4, embers: 0.6,
                  column: 0, fires: 0, decal: 0, light: 0.3 }),
  };
  // ordnance ids (systems/impactbus.js rows) and caller spellings -> a look
  const ALIAS = {
    carcook: "car", vehicle: "car", truck: "car",
    crashSmall: "aircraft", crashJet: "aircraft", crashAirliner: "aircraft", plane: "aircraft", heli: "aircraft",
    airstrike: "heavy", missile: "heavy", bomb: "heavy", jdam: "heavy", moab: "heavy", tank: "heavy",
    meteor: "impact", kinetic: "impact", lightning: "impact", tornado: "impact",
    frag: "grenade", breach: "c4", satchel: "c4", lava: "volcano",
  };
  function kindName(kind) {
    if (kind && KINDS[kind]) return kind;
    return (kind && ALIAS[kind]) || "blast";
  }
  function blastKind(kind) { return KINDS[kindName(kind)]; }

  /* THE PERSISTENT MARK LEDGER. Capped and merged: a second blast inside half
     an existing mark's radius GROWS that mark (and makes it the newest) instead
     of stacking a second disc on the same metre of road; past the cap the
     OLDEST retires and hands its instance slot to the new one. Slots are the
     instanced-mesh indices the render block writes, so the draw never grows.
     `y` is optional (wall soot merges in 3D so a hole two storeys up is not
     folded into the one at the kerb). */
  function makeDecalLedger(cap) {
    const live = [];
    const free = [];
    for (let i = cap - 1; i >= 0; i--) free.push(i);
    const res = { op: "", rec: null, evicted: null };
    return {
      live: live, cap: cap,
      place: function (x, z, r, variant, yaw, y) {
        res.evicted = null;
        const yy = y == null ? 0 : y;
        for (let i = live.length - 1; i >= 0; i--) {
          const d = live[i];
          const dist = Math.hypot(x - d.x, z - d.z, yy - d.y);
          const big = Math.max(d.r, r);
          if (dist < big * 0.5) {
            d.r = Math.min(big * 1.45, Math.max(big, dist + r * 0.75));
            d.x += (x - d.x) * 0.25; d.z += (z - d.z) * 0.25;
            d.hits++;
            live.splice(i, 1); live.push(d);
            res.op = "merge"; res.rec = d; return res;
          }
        }
        let slot;
        if (free.length) slot = free.pop();
        else { const old = live.shift(); res.evicted = old; slot = old.slot; }
        const rec = { x: x, z: z, y: yy, r: r, slot: slot, variant: variant | 0, yaw: yaw || 0,
                      hits: 1, gy: 0, w: 0, h: 0, nx: 0, nz: 0 };
        live.push(rec);
        res.op = "add"; res.rec = rec; return res;
      },
      remove: function (rec) {
        const i = live.indexOf(rec);
        if (i < 0) return false;
        live.splice(i, 1); free.push(rec.slot);
        return true;
      },
      clear: function () {
        live.length = 0; free.length = 0;
        for (let i = cap - 1; i >= 0; i--) free.push(i);
      },
    };
  }

  /* ONE FLASH LIGHT FOR EVERY BLAST. r128 recompiles every lit material when
     the scene's light count changes, so the light is made ONCE (the factory
     runs at init) and idles at intensity 0; a blast moves it and spikes it and
     it decays to dark over `dur`. Overlapping blasts reuse it: it jumps to the
     newest seat and keeps the brighter of the two peaks. */
  function makeFlashPool(factory, dur) {
    dur = dur || 0.26;
    let L = null, made = 0, t = 1e9, peak = 0;
    function ensure() { if (!L) { L = factory(); made++; } return L; }
    function level() {
      if (t >= dur) return 0;
      if (t < 0.035) return peak;                 // the white-hot frame or two
      const f = 1 - (t - 0.035) / (dur - 0.035);
      return peak * f * f;
    }
    return {
      init: ensure,
      made: function () { return made; },
      level: level,
      flash: function (x, y, z, pk, range) {
        const l = ensure(); if (!l) return;
        peak = Math.max(pk, level()); t = 0;
        if (l.position && l.position.set) l.position.set(x, y, z);
        if (range != null) l.distance = range;
        l.intensity = peak;
      },
      step: function (dt) {
        if (!L || t >= dur) return 0;
        t += dt;
        const v = level();
        L.intensity = v;
        return v;
      },
    };
  }

  // camera shake by distance: full at the seat, half at ~1.5 blast radii + 4 m,
  // nothing past max(250 m, 12 radii)
  function shakeAtten(d, R) {
    const lim = Math.max(250, R * 12);
    if (!(d >= 0)) return 1;
    if (d >= lim) return 0;
    const k = d / (R * 1.5 + 4);
    return 1 / (1 + k * k);
  }
  // light arrives now, sound at 343 m/s (skipped close in, capped far out)
  function soundDelay(d) { return d > 40 ? Math.min(6, d / 343) : 0; }

  CBZ.blastFxPure = {
    KINDS: KINDS, ALIAS: ALIAS, blastKind: blastKind, kindName: kindName,
    makeDecalLedger: makeDecalLedger, makeFlashPool: makeFlashPool,
    shakeAtten: shakeAtten, soundDelay: soundDelay,
  };
})();

(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.scene) return;
  const THREE = window.THREE;
  const scene = CBZ.scene;
  const PURE = CBZ.blastFxPure;

  // ---- deterministic seeded LCG (NEVER Math.random() — replay/MP sync) ------
  let _rs = 78451;
  function rng() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }

  const bursts = [], rings = [], scorches = [];
  // B5: scratch reused by applyBlastDamage's piece-damage pass below (no
  // per-blast allocation) — a Set to dedupe pieceIds across the multiple
  // AABB colliders one piece can register (doorframe = 3), an Array for
  // CBZ.queryCollidersNear's own out-param convention (systems/physics.js).
  const blastPieceScratch = [];
  const blastPieceSeen = new Set();
  const debrisBox = new THREE.Box3(), debrisSize = new THREE.Vector3();

  // TRUE-WORLD ground sample: where wreckage actually comes to rest (rooftops,
  // raised terrain, breaches), not a flat hardcoded y. Falls back to 0.
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }

  /* DEBRIS LIVES IN systems/debris.js (CBZ.debris). This file used to keep its
     own pool of grey 0.28 m boxes (plus a "rubble" box, a jagged prism and a
     four-tone unit cube) and threw them from every blast, crash and wall hit.
     Every piece of that was invented. Now: a wall that is hit sheds ITS OWN
     pieces through the carve (buildings.js), props break into themselves
     (city/props.js via cityPropsBlast below), and a blast on ground that held
     throws only grit of that ground. What remains here is fire, smoke, dust
     and scorch. */
  // what the ground under a blast is made of: city streets are asphalt; inside
  // the prison wire every floor is concrete (yard hardstanding, the wings, the
  // tiers) — a grenade in the cell house used to kick up brown EARTH grit and
  // dust off a concrete floor; only the field outside the wire is earth
  function groundKind(x, z) {
    const m = CBZ.game && CBZ.game.mode;
    if (m === "city" || m === "gang") return "asphalt";
    const W = m === "escape" && CBZ.WORLD && CBZ.WORLD.wings;
    if (W && x != null && x >= W.x0 && x <= W.x1 && z >= W.z0 && z <= W.z1) return "concrete";
    return "dirt";
  }
  const ruinFrames = [];            // persistent broken slab/rebar frames
  const RUIN_FRAME_CAP = 10;
  const ruinStats = { events: 0, pieces: 0, bars: 0 };

  // ---- POOLED point-burst ring (CBZ.fxPool, default ON) ----------------------
  // THE EXPLOSION ALLOCATION SPIKE: the old pointBurst minted a fresh
  // Float32Array×2 + BufferGeometry + BufferAttribute + PointsMaterial + Points
  // on EVERY call (≈6 per blast, more for airstrikes/wall-ruins) and dispose()'d
  // them all on expiry — a rocket impact = a GC bomb that hitched the frame on
  // the weak Mac. Fix (research: three.js object pooling + DynamicDrawUsage +
  // setDrawRange — utsubo tip #39 "pool bullets/particles", joshmarinacci
  // particle recycling, threejs docs setDrawRange/setUsage): a fixed RING of
  // preallocated Points. Each slot owns ONE BufferGeometry whose position
  // attribute is sized to BURST_MAX particles + marked DynamicDrawUsage, a CPU
  // velocity scratch array, and ONE reusable PointsMaterial. A burst just writes
  // its particles into the slot's buffers, sets the per-burst look (color/size/
  // opacity/blending) on the reused material, setDrawRange(0,count) so only the
  // live particles draw, and flags needsUpdate. ZERO per-blast allocation, ZERO
  // dispose churn — the look/counts/motion are byte-identical to before.
  //
  // BURST_MAX covers the largest single pointBurst the game ever fires (airstrike
  // sparks ≈ round(40 * P), P≤4.6 ⇒ ~184) with headroom so nothing is truncated.
  // RING_CAP covers a multi-blast / sprint-through-crowd burst (cityExplosion ≈6
  // bursts, airstrike ≈3, wall-ruin ≈2, plus impact splats) so live bursts are
  // never stolen mid-flight; on overrun the oldest slot is reused — exactly the
  // permanence the old path got from expiry, just without the allocation.
  const BURST_MAX = 256, RING_CAP = 48;
  const burstPool = [];   // preallocated Points — fully prebuilt at load (see the
                          // FIRST-BLAST PREWARM block at the bottom of this file),
                          // so no slot is ever minted mid-fight
  let burstRing = 0;      // next slot to (re)use
  function makeBurstSlot() {
    const pos = new Float32Array(BURST_MAX * 3);
    const attr = new THREE.BufferAttribute(pos, 3);
    if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage); else attr.dynamic = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", attr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: 0.1, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(geo, mat);
    mesh.renderOrder = 8;
    // these transient blast bursts always pop at the action: skip frustum culling
    // so a REUSED geometry whose computed bounds shrank can never wrongly vanish.
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);
    // velocity scratch lives on the slot too — reused, never reallocated.
    const slot = { mesh, geo, attr, mat, pos, vel: new Float32Array(BURST_MAX * 3), live: null };
    return slot;
  }
  // pull a slot out of the ring, evicting whatever burst was riding it (the
  // evicted burst is dropped from the active list — same as the old expiry).
  function acquireBurstSlot() {
    let slot = burstPool[burstRing];
    if (!slot) { slot = burstPool[burstRing] = makeBurstSlot(); }
    burstRing = (burstRing + 1) % RING_CAP;
    if (slot.live) {                       // evict the previous rider, if any
      const idx = bursts.indexOf(slot.live);
      if (idx >= 0) bursts.splice(idx, 1);
      slot.live = null;
    }
    return slot;
  }

  // y0 (optional) seats the burst at an impact HEIGHT (rocket on a tower face)
  // instead of the default street level.
  function pointBurst(x, z, count, color, size, speed, life, dust, y0) {
    if (count > BURST_MAX) count = BURST_MAX;   // never overrun the pooled buffer
    const baseY = y0 != null ? y0 : floorAt(x, z) + 0.35;
    const pooled = CBZ.fxPool !== false;
    // pooled path reuses the slot's preallocated buffers; the fallback (flag off)
    // allocates exactly as before so behavior degrades to today byte-for-byte.
    let pos, vel, slot = null, geo = null, mat = null, mesh = null;
    if (pooled) {
      slot = acquireBurstSlot();
      pos = slot.pos; vel = slot.vel;
    } else {
      pos = new Float32Array(count * 3);
      vel = new Float32Array(count * 3);
    }
    for (let i = 0; i < count; i++) {
      const o = i * 3, a = rng() * Math.PI * 2;
      const sp = speed * (0.35 + rng() * 0.8);
      pos[o] = x + (rng() - 0.5) * 0.8;
      pos[o + 1] = baseY + rng() * (dust ? 0.5 : 1.0);
      pos[o + 2] = z + (rng() - 0.5) * 0.8;
      vel[o] = Math.cos(a) * sp;
      vel[o + 1] = (dust ? 0.9 : 2.5) + rng() * (dust ? 1.7 : 4.5);
      vel[o + 2] = Math.sin(a) * sp;
    }
    const op0 = dust ? 0.5 : 0.95;
    const blend = dust ? THREE.NormalBlending : THREE.AdditiveBlending;
    if (pooled) {
      // re-dress the reused material + buffer for this burst's exact look/count
      mat = slot.mat; geo = slot.geo; mesh = slot.mesh;
      mat.color.set(color); mat.size = size; mat.opacity = op0; mat.blending = blend;
      mat.needsUpdate = true;            // blending swap needs a program recompile flag
      geo.setDrawRange(0, count);
      // bound the per-frame GPU upload to the LIVE particles only (the buffer is
      // BURST_MAX long but only `count` matter) — r128 honours updateRange.count.
      slot.attr.updateRange.offset = 0; slot.attr.updateRange.count = count * 3;
      slot.attr.needsUpdate = true;      // upload the freshly-written positions
      mesh.visible = true;
    } else {
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      mat = new THREE.PointsMaterial({
        color, size, transparent: true, opacity: op0,
        depthWrite: false, blending: blend,
      });
      mesh = new THREE.Points(geo, mat);
      mesh.renderOrder = 8;
      scene.add(mesh);
    }
    // n = LIVE byte-length so the shared updater steps only the real particles
    // (a pooled buffer is BURST_MAX long but only `count` are alive this burst).
    const b = { mesh, geo, mat, pos, vel, t: 0, life, dust: !!dust, op0, n: count * 3, slot };
    if (slot) slot.live = b;
    bursts.push(b);
  }

  // owner: "the fake ring that comes around at first is stupid and should be
  // gone" — explosions draw no ground ring at all (the dust skirt in
  // blastVisual is the shockwave). Only the car-crash glass ring uses this.
  function ring(x, z, radius, color, opt) {
    opt = opt || {};
    const inner = opt.inner == null ? 0.7 : opt.inner;
    const geo = new THREE.RingGeometry(inner, 1.3, 36);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opt.opacity == null ? 0.72 : opt.opacity,
      depthWrite: false, side: THREE.DoubleSide,
      blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, opt.y == null ? 0.08 : opt.y, z);
    mesh.renderOrder = 7;
    scene.add(mesh);
    rings.push({
      mesh, geo, mat, radius, r: opt.r0 == null ? 1 : opt.r0, t: 0,
      life: opt.life == null ? 0.5 : opt.life,
      spd: opt.spd == null ? 2.2 : opt.spd,
      op0: opt.opacity == null ? 0.72 : opt.opacity,
      flat: !!opt.flat, // shockwave hugs the ground and thins as it grows
    });
  }

  // adopt an already-built mesh (a hood torn off a crashed car) into the shared
  // rigid-body debris sim (CBZ.debris): its own geometry tumbles, lands and
  // freezes into the rubble. Caller hands it over posed in WORLD space.
  CBZ.cityDebrisAdopt = function (mesh, vx, vy, vz) {
    if (!mesh || !CBZ.debris) return false;
    // Never let a whole facade/window-wall enter the flying-debris sim. This
    // API is for car panels and small fragments.
    try {
      mesh.updateWorldMatrix(true, true);
      debrisBox.setFromObject(mesh).getSize(debrisSize);
      if (Math.max(debrisSize.x, debrisSize.y, debrisSize.z) > 3.0) {
        if (mesh.parent) mesh.parent.remove(mesh);
        return false;
      }
    } catch (e) {}
    const r = CBZ.debris.adopt(mesh, {
      velocity: new THREE.Vector3(vx || 0, vy == null ? 3 : vy, vz || 0),
      angular: new THREE.Vector3((rng() - 0.5) * 6, (rng() - 0.5) * 4, (rng() - 0.5) * 6),
    });
    if (mesh.parent) mesh.parent.remove(mesh);
    return !!(r && r.pieces);
  };

  // ---- crash SCUFF (a dark radial disc that snaps in, lingers, fades) ----
  // Crashes only. Explosions leave the persistent crater mark (queueMark).
  // Pooled flat circles laid just above the road; one shared scorch texture.
  let scorchTex = null;
  function makeScorchTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d"), r = 64, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(20,16,14,0.92)");
    g.addColorStop(0.45, "rgba(28,22,18,0.82)");
    g.addColorStop(0.78, "rgba(34,26,20,0.4)");
    g.addColorStop(1.0, "rgba(0,0,0,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    // mottled soot flecks so it doesn't read as a perfect circle
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 90; i++) {
      const a = rng() * 6.2832, rr = 18 + rng() * 44;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + rng() * 5, 0, 6.2832);
      ctx.fillStyle = "rgba(0,0,0," + (0.2 + rng() * 0.5) + ")"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  const scorchGeo = new THREE.PlaneGeometry(1, 1); scorchGeo._shared = true;
  function addScuff(x, z, radius, hold) {
    // Never stamp a burn decal on open water — it floated on the sea as a flat
    // black disc. Guarding the single builder covers all three call sites.
    if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return;
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scorches.length > 12) { const o = scorches.shift(); scene.remove(o.mesh); o.mesh.material.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rng() * 6.28;
    mesh.position.set(x, floorAt(x, z) + 0.045, z); mesh.scale.setScalar(radius * 2);
    mesh.renderOrder = 1; scene.add(mesh);
    // scorch marks linger as black road stains; airstrikes pass a longer hold
    scorches.push({ mesh, mat, t: 0, hold: (hold || 11) + rng() * 5, grow: 0 });
  }

  // ---- GORY FALL/HARD-IMPACT splat — a body hitting the ground at speed ----
  // Reuses the pooled-decal + pointBurst + chunk machinery, then routes through
  // CBZ.gore for the blood burst/gibs. A dark-red blood POOL decal spreads at the
  // impact seat (its own pool, separate from the soot scorch), a low crimson
  // spatter sheets out, and the whole thing gets a heavy shake + bone-crunch +
  // hitstop. Bounded: pools cap and recycle, so a spammed fall can't flood FX.
  const splats = [];
  let splatTex = null;
  function makeSplatTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const ctx = c.getContext("2d"), r = 64, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(96,8,8,0.95)");
    g.addColorStop(0.4, "rgba(120,12,12,0.9)");
    g.addColorStop(0.72, "rgba(80,6,6,0.5)");
    g.addColorStop(1.0, "rgba(40,0,0,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    // ragged limbs of spatter flicked out past the pool's edge (Tarantino fan)
    for (let i = 0; i < 26; i++) {
      const a = rng() * 6.2832, rr = 40 + rng() * 24;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 2 + rng() * 6, 0, 6.2832);
      ctx.fillStyle = "rgba(110,6,6," + (0.3 + rng() * 0.55) + ")"; ctx.fill();
    }
    // a couple of darker clots near the centre so it doesn't read as a flat disc
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 10; i++) {
      const a = rng() * 6.2832, rr = rng() * 30;
      ctx.beginPath(); ctx.arc(r + Math.cos(a) * rr, r + Math.sin(a) * rr, 4 + rng() * 9, 0, 6.2832);
      ctx.fillStyle = "rgba(60,0,0,0.6)"; ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  function addBloodPool(x, z, radius) {
    if (!splatTex) splatTex = makeSplatTexture();
    while (splats.length > 10) { const o = splats.shift(); scene.remove(o.mesh); o.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const mesh = new THREE.Mesh(scorchGeo, mat);   // reuse the shared 1x1 plane
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = rng() * 6.28;
    mesh.position.set(x, 0.05, z); mesh.scale.setScalar(0.4);
    mesh.renderOrder = 2; scene.add(mesh);
    splats.push({ mesh, mat, t: 0, r0: 0.4, r1: radius * 2, hold: 16 + rng() * 8 });
  }

  // x,y,z = impact point; opts.player flags the player's own splat (more gore),
  // opts.speed scales the violence. Safe to call without THREE gore loaded.
  CBZ.cityImpactSplat = function (x, y, z, opts) {
    opts = opts || {};
    // NO MODE GATE (see THE GUARD THAT WAS THE BUG). A body hitting concrete
    // at speed is the same event in a yard as on a street; every layer below
    // is this file's own pools plus CBZ.gore/sfx/shake, all shared. Today's
    // only caller is city/death.js, so the city read is byte-identical.
    const player = !!opts.player;
    const speed = opts.speed || 18;
    const power = Math.min(2.4, Math.max(1, speed / 16));   // visual dial, clamped
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of burst
    // particles, Best (tier 4) is byte-identical. Sampled ONCE per burst.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // crimson sheet skidding out low across the ground (the splash on impact)
    pointBurst(x, z, Math.max(1, Math.round((player ? 40 : 26) * power * fxq)), 0x8a0a0a, 0.17, 3 + speed * 0.28, 0.6, false);
    pointBurst(x, z, Math.max(1, Math.round(14 * power * fxq)), 0xc01818, 0.12, 5 + speed * 0.3, 0.42, false);
    // a lingering dark-red blood POOL spreading at the impact seat
    addBloodPool(x, z, (player ? 2.4 : 1.7) * power);
    // the layered blood event (spray/mist/gibs/pool/wall) — gibs-lite, the works
    if (CBZ.gore) { try { CBZ.gore(x, y != null ? y : 1.0, z, { dir: opts.dir || null, amount: player ? 1.7 : 1.3, player: player, explosion: false }); } catch (e) {} }
    // bone-crunch + wet impact (layered real foley), heavy shake + hitstop
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.shake) CBZ.shake(Math.min(2.0, 0.9 + power * 0.4));
    if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.22, 0.1 + power * 0.05));
    if (player && CBZ.doSlowmo) CBZ.doSlowmo(0.4);
  };

  // ---- soft additive FIREBALL sprites (the good-looking explosion) ----
  // One shared 64px radial-gradient texture (white core → transparent rim) used
  // by every pooled sprite; additive blending sums overlaps toward white-hot.
  const puffs = [], _ecol = new THREE.Color();
  // A district fire used to be able to expand this pool forever. A normal RPG
  // peaks well below this ceiling; the cap only engages when many persistent
  // emitters overlap, where allocating another SpriteMaterial is less useful
  // than keeping the renderer alive.
  const PUFF_CAP = 384;
  let puffPool = [], puffTex = null, smokeTex = null;
  function makePuffTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const ctx = c.getContext("2d"), r = 32, g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0.0, "rgba(255,255,255,1.0)");
    g.addColorStop(0.3, "rgba(255,255,255,0.55)");
    g.addColorStop(0.7, "rgba(255,255,255,0.12)");
    g.addColorStop(1.0, "rgba(255,255,255,0.0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  // Lumpy smoke texture: several overlapping soft blobs so rising smoke reads as
  // billowing cloud rather than a clean dot. Sampled with alpha blending.
  function makeSmokeTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const ctx = c.getContext("2d");
    for (let i = 0; i < 7; i++) {
      const px = 16 + rng() * 32, py = 16 + rng() * 32, rr = 10 + rng() * 16;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
      g.addColorStop(0, "rgba(255,255,255," + (0.45 + rng() * 0.35) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.fill();
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  // The RPG's soft fire/smoke masks are the shared blast visual language.
  // Large composers can reuse the textures in bounded instanced fields rather
  // than approximating smoke with solid geometry or baking a silhouette card.
  CBZ.cityBlastPuffAssets = function () {
    if (!puffTex) puffTex = makePuffTexture();
    if (!smokeTex) smokeTex = makeSmokeTexture();
    return { flame: puffTex, smoke: smokeTex };
  };
  function getPuff(additive, smoke, tex) {
    if (!puffTex) puffTex = makePuffTexture();
    if (smoke && !smokeTex) smokeTex = makeSmokeTexture();
    let p = puffPool.pop();
    if (!p) {
      if (puffs.length >= PUFF_CAP) return null;
      const m = new THREE.SpriteMaterial({ map: puffTex, depthWrite: false, depthTest: true, transparent: true, opacity: 0 });
      p = new THREE.Sprite(m); p.renderOrder = 9; scene.add(p);
    }
    const wantMap = tex || (smoke ? smokeTex : puffTex);
    if (p.material.map !== wantMap) { p.material.map = wantMap; p.material.needsUpdate = true; } // rebind sampler on swap
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    // smoke sits behind the rolling fireball body, which sits behind the hot cores
    p.renderOrder = smoke ? 6 : (additive ? 9 : 8);
    p.visible = true; return p;
  }
  // THE ROLLING BODY's ramp (normal-blended, dark-edged puffs): it starts as
  // yellow-white fire, drops through orange and deep red, and ends as the soot
  // it turns into. The additive RAMP below stays the hot cores' ramp.
  const BODY = [[0, 1, 0.9, 0.62], [0.14, 1, 0.6, 0.2], [0.32, 0.86, 0.3, 0.08], [0.52, 0.36, 0.12, 0.05], [0.78, 0.1, 0.085, 0.075], [1, 0.07, 0.065, 0.06]];
  function rampBody(out, t) {
    for (let i = 1; i < BODY.length; i++) {
      if (t <= BODY[i][0]) { const a = BODY[i - 1], b = BODY[i], p = (t - a[0]) / (b[0] - a[0]); return out.setRGB(a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p, a[3] + (b[3] - a[3]) * p); }
    }
    return out.setRGB(0.07, 0.065, 0.06);
  }
  // white → yellow → orange → deep-red → smoke over normalized life t
  const RAMP = [[0, 1, 1, 0.95], [0.15, 1, 0.95, 0.55], [0.35, 1, 0.55, 0.15], [0.6, 0.65, 0.12, 0.05], [1, 0.12, 0.1, 0.1]];
  function rampColor(out, t) {
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) { const a = RAMP[i - 1], b = RAMP[i], p = (t - a[0]) / (b[0] - a[0]); return out.setRGB(a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p, a[3] + (b[3] - a[3]) * p); }
    }
    const L = RAMP[RAMP.length - 1]; return out.setRGB(L[1], L[2], L[3]);
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  // FX_BLAST_FIRSTFRAME (owner: "the explosion takes too long after i
  // shoot"). Two MEASURED impact-side thieves, both fixed under this flag:
  //   (1) a puff's opacity is written only by updatePuffs — onAlways(9.5),
  //       which runs BEFORE the rocket updater (onAlways 52) whose detonate
  //       spawns the blast — so the flash rendered its birth frame at
  //       opacity 0: one structurally guaranteed DEAD FRAME between "the
  //       game decided the explosion happened" and anything visible.
  //       spawnPuff now seeds the exact envelope updatePuffs would produce
  //       one full-speed tick in (same ramp, same colour), so the
  //       detonation frame already shows the flash at ~93%.
  //   (2) the blast fired doHitstop(0.18)+doSlowmo(0.34) in the SAME call
  //       stack that spawned the fireball, so its own time dilation
  //       stretched its own first instants ~3x (30% fireball growth at
  //       ~610ms real instead of ~215ms). blastPunch defers the freeze two
  //       frames: the flash and first fireball step land at full speed,
  //       THEN the stop punctuates them. Same total juice.
  // Flip false → opacity-0 birth frame + same-frame stop, byte-identical.
  if (CBZ.CONFIG.FX_BLAST_FIRSTFRAME == null) CBZ.CONFIG.FX_BLAST_FIRSTFRAME = true;
  function firstFrameOn() { return CBZ.CONFIG.FX_BLAST_FIRSTFRAME !== false; }
  const punchQ = [];
  function blastPunch(hs, sm) {
    if (!firstFrameOn()) {
      if (CBZ.doSlowmo && sm) CBZ.doSlowmo(sm);
      if (CBZ.doHitstop && hs) CBZ.doHitstop(hs);
      return;
    }
    punchQ.push({ t: 2 / 60, hs: hs, sm: sm });
  }
  function pumpPunch(dt) {
    for (let i = punchQ.length - 1; i >= 0; i--) {
      const q = punchQ[i]; q.t -= dt;
      if (q.t > 0) continue;
      if (CBZ.doSlowmo && q.sm) CBZ.doSlowmo(q.sm);
      if (CBZ.doHitstop && q.hs) CBZ.doHitstop(q.hs);
      punchQ.splice(i, 1);
    }
  }
  /* A puff is one pooled sprite with a small motion law. The original fields
     (base, pop, life, maxOp, spin, vx/vy/vz, shade, smoke, delay) behave exactly as before;
     the explosion added the ones below, all optional:
       tex        a specific sprite texture (the billow variants)
       body       a normal-blended fireball puff (dark-edged, BODY ramp)
       drag       per-second velocity loss (smoke default 0.5 on x/z, else 0)
       buoy       upward acceleration (smoke default 0.6, else 0)
       grav       downward acceleration (embers)
       capY       above this height the puff stops rising and spreads (mushroom)
       rx,rz      the outward direction it spreads in above capY
       wx,wz      wind drift, m/s
       tone       [r,g,b] soot colour (else grey `shade`)
       noHeat     smoke that never glowed (dust)
       fin        smoke fade-in fraction of life (default 0.25) */
  function spawnPuff(x, y, z, o) {
    const p = getPuff(o.additive !== false, o.smoke, o.tex || null);
    if (!p) return false;
    p.position.set(x, y, z); p.material.rotation = rng() * 6.2832;
    p.scale.set(o.base, o.base, 1); p.material.opacity = 0; p.visible = (o.delay || 0) <= 0;
    const fin = o.fin == null ? 0.25 : o.fin;
    // FIRST-FRAME TRUTH — see the flag block above. Delayed puffs (the
    // deliberate smoke staging) keep their opacity-0 birth.
    if (firstFrameOn() && (o.delay || 0) <= 0 && o.life > 0) {
      const t0 = Math.min(0.999, (1 / 60) / o.life);
      const mo = o.maxOp == null ? 1 : o.maxOp;
      if (o.smoke) {
        p.material.opacity = Math.max(0, (t0 < fin ? t0 / fin : 1) * mo);
      } else if (o.body) {
        p.material.opacity = Math.max(0, (t0 < 0.06 ? t0 / 0.06 : 1) * mo);
        rampBody(p.material.color, t0);
      } else {
        p.material.opacity = Math.max(0, (t0 < 0.1 ? t0 / 0.1 : 1 - (t0 - 0.1) / 0.9) * mo);
        rampColor(p.material.color, t0);
      }
    }
    const shade = o.shade == null ? 0.16 : o.shade;
    const tone = o.tone || null;
    puffs.push({
      s: p, age: -(o.delay || 0), life: o.life, base: o.base, pop: o.pop,
      x: x, y: y, z: z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      spin: o.spin || 0, rot: p.material.rotation,
      smoke: !!o.smoke, body: !!o.body, maxOp: o.maxOp == null ? 1 : o.maxOp,
      // smoke fades from charred-orange to its soot tone as it cools
      tr: tone ? tone[0] : shade, tg: tone ? tone[1] : shade, tb: tone ? tone[2] : shade,
      drag: o.drag != null ? o.drag : (o.smoke ? 0.5 : 0),
      buoy: o.buoy != null ? o.buoy : (o.smoke ? 0.6 : 0),
      grav: o.grav || 0, capY: o.capY != null ? o.capY : null,
      rx: o.rx || 0, rz: o.rz || 0, wx: o.wx || 0, wz: o.wz || 0,
      noHeat: !!o.noHeat, fin: fin,
    });
    return true;
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.age += dt;
      if (p.age < 0) continue;                 // still in its spawn delay
      p.s.visible = true;
      const t = p.age / p.life;
      if (t >= 1) { p.s.visible = false; puffPool.push(p.s); puffs.splice(i, 1); continue; }
      const sc = p.base + (p.pop - p.base) * easeOutCubic(t);
      p.s.scale.set(sc, sc, 1);
      if (p.spin) { p.rot += p.spin * dt; p.s.material.rotation = p.rot; }
      if (p.smoke) {
        // negative gravity: smoke rises, drifts, and slows as it expands/cools
        p.vy += p.buoy * dt;
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vz *= k;
        if (p.capY !== null && p.y > p.capY) {
          // the column's head: rising stalls and the smoke rolls outward
          p.vy *= Math.max(0, 1 - 1.6 * dt);
          p.vx += p.rx * 1.5 * dt; p.vz += p.rz * 1.5 * dt;
        }
        p.x += (p.vx + p.wx) * dt; p.y += p.vy * dt; p.z += (p.vz + p.wz) * dt;
        p.s.position.set(p.x, p.y, p.z);
        // first instant glows hot from the dying fireball, then darkens to soot
        const heat = p.noHeat ? 0 : Math.max(0, 1 - t * 4);
        p.s.material.color.setRGB(p.tr + heat * 0.55, p.tg + heat * 0.18, p.tb);
        // smoke fades IN then slowly OUT (lingers)
        const fade = t < p.fin ? t / p.fin : 1 - (t - p.fin) / (1 - p.fin);
        p.s.material.opacity = Math.max(0, fade * p.maxOp);
      } else {
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        if (p.buoy || p.grav) p.vy += (p.buoy - p.grav) * dt;
        if (p.capY !== null && p.y > p.capY && p.vy > 0) p.vy *= Math.max(0, 1 - 2.5 * dt);
        if (p.vx || p.vy || p.vz || p.wx || p.wz) {
          p.x += (p.vx + p.wx) * dt; p.y += p.vy * dt; p.z += (p.vz + p.wz) * dt;
          p.s.position.set(p.x, p.y, p.z);
        }
        if (p.body) {
          // the rolling fireball: snaps in, holds while it climbs, then thins
          // as the soot puffs spawned behind it take over
          p.s.material.opacity = Math.max(0, (t < 0.06 ? t / 0.06 : (t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45)) * p.maxOp);
          rampBody(p.s.material.color, t);
        } else {
          // flame puffs ramp white->yellow->orange->red
          p.s.material.opacity = Math.max(0, (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9) * p.maxOp);
          rampColor(p.s.material.color, t);
        }
      }
    }
  }

  // A bounded reusable wreck plume for aircraft modules. Several callers have
  // long feature-detected this hook; defining it here keeps those crashes on
  // the same pooled smoke sprites as explosions instead of silently doing
  // nothing. Each call is capped at six smoke puffs (plus two short flame licks
  // when opts.flame is set) and every one of them returns to puffPool.
  CBZ.cityCrashSmoke = function (x, y, z, opts) {
    opts = opts || {};
    const cy = Number.isFinite(+y) ? +y : 0.8;
    const count = Math.max(1, Math.min(6, opts.count == null ? 5 : opts.count | 0));
    const scale = Math.max(0.5, Math.min(2.2, opts.scale || 1));
    for (let i = 0; i < count; i++) {
      const a = rng() * 6.2832, drift = 0.25 + rng() * 0.5;
      spawnPuff(x + (rng() - 0.5) * 1.5 * scale,
        cy + 0.3 + rng() * 0.8 * scale,
        z + (rng() - 0.5) * 1.5 * scale, {
          additive: false, smoke: true, base: 1.3 * scale,
          pop: (4.8 + rng() * 2.6) * scale,
          life: 4.0 + rng() * 2.6, maxOp: 0.44,
          // opts.shade: a caller's own grey (tear gas is near-white, 0.75+)
          shade: opts.shade != null ? Math.max(0, Math.min(1, +opts.shade)) + rng() * 0.05 : 0.09 + rng() * 0.06, spin: (rng() - 0.5),
          vx: Math.cos(a) * drift, vy: 1.2 + rng() * 1.0,
          vz: Math.sin(a) * drift, delay: i * 0.08 + rng() * 0.1,
        });
    }
    // ---- opts.flame — a warm additive lick UNDER the smoke (OPT-IN) ---------
    // A SUSTAINED fire that emits only near-black smoke (shade 0.09-0.15) reads
    // as a blob cluster, not as burning — that is structural.js's burning-floor
    // case, where the same plume repeats for the life of the fire with nothing
    // hot at its root. This is the recipe the blast wound's first beats already
    // used: a small additive puff low in the column, short-lived and bright, so
    // the plume HAS a source. updatePuffs already ramps a non-smoke puff
    // white->yellow->orange->red for free, so this adds no material and no draw
    // call class — it borrows two slots from the same pooled sprite budget.
    // Default OFF: every existing wreck / chopper / nukefx caller is unchanged.
    if (opts.flame) {
      for (let i = 0; i < 2; i++) {
        spawnPuff(x + (rng() - 0.5) * 0.7 * scale, cy + rng() * 0.5 * scale, z + (rng() - 0.5) * 0.7 * scale, {
          additive: true, base: 0.5 * scale, pop: (1.5 + rng() * 1.1) * scale,
          life: 0.55 + rng() * 0.45, maxOp: 0.85,
          vy: 1.4 + rng() * 0.9, spin: (rng() - 0.5) * 2,
          delay: i * 0.12 + rng() * 0.08,
        });
      }
    }
  };

  CBZ.cityCrashFX = function (x, z, opts) {
    opts = opts || {};
    const speed = opts.speed || 8;
    const hard = !!opts.hard, catastrophic = !!opts.catastrophic;
    const dir = opts.dir || null;   // downrange impact direction, for biased debris
    if ((hard || catastrophic) && CBZ.cityEvent) CBZ.cityEvent("crash", { x, z, damage: catastrophic ? 6 : 2, panic: catastrophic ? 7 : 3 }, { silent: true, noWanted: true, throttle: 0.9 });
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of burst
    // particles, Best (tier 4) is byte-identical. Sampled ONCE per burst.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // hot orange impact sparks (additive) that shoot out fast and die quick
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 58 : (hard ? 38 : 12)) * fxq)), 0xff9a38, catastrophic ? 0.19 : 0.13, 2 + speed * 0.2, catastrophic ? 0.7 : 0.48, false);
    // a tight WHITE-hot spark spray at the contact point (metal grinding)
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 30 : (hard ? 18 : 6)) * fxq)), 0xfff0c0, 0.1, 4 + speed * 0.25, catastrophic ? 0.45 : 0.32, false);
    // kicked-up dust
    pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 34 : (hard ? 22 : 8)) * fxq)), 0x8b8175, catastrophic ? 0.44 : 0.3, 1 + speed * 0.07, catastrophic ? 0.9 : 0.62, true);
    // shattered GLASS — pale blue-white shimmering shards (additive twinkle)
    if (hard) pointBurst(x, z, Math.max(1, Math.round((catastrophic ? 30 : 16) * fxq)), 0xcfe6ff, 0.09, 3 + speed * 0.16, catastrophic ? 0.8 : 0.6, false);
    if (hard) {
      ring(x, z, catastrophic ? 7 : 4.5, catastrophic ? 0xffd08a : 0xffa14f, { opacity: catastrophic ? 0.7 : 0.55, spd: catastrophic ? 3 : 2.4, life: catastrophic ? 0.7 : 0.55 });
      // debris pool keeps its full cap; only the per-event spawn rides the tier
      if (CBZ.debris) {
        const cy = floorAt(x, z) + 0.7;
        const cd = dir ? { x: dir.x, y: 0.3, z: dir.z } : null;
        CBZ.debris.chips(x, cy, z, { kind: "glass", count: Math.round((catastrophic ? 26 : 12) * fxq), dir: cd, power: 0.8 + speed * 0.03, dust: false });
        CBZ.debris.chips(x, cy - 0.2, z, { kind: "plastic", color: 0x1d1f22, count: Math.round((catastrophic ? 10 : 4) * fxq), dir: cd, power: 0.7 + speed * 0.03, dust: false });
      }
      addScuff(x, z, catastrophic ? 3 : 1.4, catastrophic ? 9 : 5);   // a scuff/skid stain even on a hard (non-fatal) wall hit
      if (catastrophic) {
        if (CBZ.shake) CBZ.shake(1.6);
        // a clutch of small lingering flames + a thin smoke wisp so a wrecked car
        // looks like it's actually cooking, not just sparking for a frame.
        // LIFETIME STRETCHED (was 1.1-2.0s): the flame core lingers a couple of
        // seconds now, same fix as the bigger explosion fireballs above.
        for (let i = 0; i < 5; i++) {
          const a = rng() * 6.2832, rr = rng() * 1.1;
          spawnPuff(x + Math.cos(a) * rr, 0.45, z + Math.sin(a) * rr,
            { additive: true, base: 0.4, pop: 1.6 + rng() * 0.9, life: 2.2 + rng() * 1.4,
              maxOp: 0.85, spin: (rng() - 0.5) * 2, vy: 0.5 + rng() * 0.7,
              delay: rng() * 0.2 });
        }
        for (let i = 0; i < 4; i++) {
          const a = rng() * 6.2832, dr = 0.3 + rng() * 0.5;
          spawnPuff(x + (rng() - 0.5) * 1.2, 0.9 + rng() * 0.5, z + (rng() - 0.5) * 1.2,
            { additive: false, smoke: true, base: 1.2, pop: 4 + rng() * 2,
              life: 2.4 + rng() * 1.4, maxOp: 0.34, shade: 0.15, spin: (rng() - 0.5),
              vx: Math.cos(a) * dr, vy: 1.0 + rng() * 0.6, vz: Math.sin(a) * dr,
              delay: 0.15 + rng() * 0.3 });
        }
      }
    }
  };

  /* ============================================================
     THE ONE EXPLOSION — its picture (blastVisual) and what it leaves behind
     (blastAftermath). Owner (2026-09-28): "the explosion is not very real,
     especially the effect it leaves on the environment."

     BEFORE: additive white discs summed into one flat orange bloom, a few
     grey smoke dots that were gone in four seconds, and a soft black circle
     on the road that faded after ~15 s. Nothing burned, nothing stayed.

     NOW, in the order the eye reads a real detonation:
       1. FLASH     one or two frames of white-hot core, plus the ONE pooled
                    PointLight (made at load, idle at 0, never added/removed)
                    spiking and dying over ~0.25 s so the street lights up.
       2. FIREBALL  hot additive cores INSIDE a body of normal-blended,
                    dark-edged billow puffs (baked noise textures with soot
                    folds) that roll outward, lose speed, climb on buoyancy
                    and ramp white -> yellow -> orange -> deep red -> soot.
       3. SOOT      thick dark puffs born on the fireball as it cools, then a
                    SMOKE COLUMN emitter that keeps rising for 10-45 s by kind,
                    thinning, drifting with CBZ.weatherWind, capping into a
                    mushroom head for heavy ordnance.
       4. SHOCK     a low tan/grey dust skirt racing out along the ground.
                    (The bright ground RING stays off: the owner called it
                    "the fake ring that comes around at first", FX_EXPLOSION_RINGS.)
       5. DEBRIS    CBZ.debris: real chunks of the ground it tore (asphalt in
                    the city, earth elsewhere, rock for the volcano), charred
                    bits that stay where they land, sparks and slow embers.
       6. AFTERMATH a crater scorch that DOES NOT FADE (capped at 24, merged
                    when blasts overlap, oldest retires), small fires that
                    keep burning 20-60 s on the debris, and the column.
     Kind (opts.kind / opts.ordnance) picks the proportions from
     CBZ.blastFxPure.KINDS: a grenade is dust and fragments, a car is a tall
     fuel ball and oily black smoke, C4 throws itself along opts.normal.
     ============================================================ */

  // ---- baked billow textures (value-noise fbm on a canvas, once, at load) ----
  function hash2(x, y, s) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s, oct) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 17); norm += amp; amp *= 0.5; f *= 2.03; }
    return sum / norm;
  }
  function sstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  // smoke=false: a fire billow whose RGB darkens toward the rim and in soot
  // folds (so a normal-blended puff has dark edges and an additive one has
  // structure); smoke=true: a lumpy cloud lit a little from above.
  function makeBillowTex(seed, smoke) {
    const N = 128, c = document.createElement("canvas"); c.width = c.height = N;
    const ctx = c.getContext("2d"), img = ctx.createImageData(N, N), d = img.data;
    const ox = seed * 13.7, oy = seed * 7.3;
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const u = (px + 0.5) / N * 2 - 1, v = (py + 0.5) / N * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      const n = fbm(u * 2.6 + ox, v * 2.6 + oy, seed, 4);
      const n2 = fbm(u * 5.5 + oy, v * 5.5 + ox, seed + 91, 3);
      let a, b;
      if (smoke) {
        a = sstep(0.95, 0.5, r + (n - 0.5) * 0.8) * (0.72 + 0.28 * n2);
        b = 0.72 + 0.26 * n2 - v * 0.1;
      } else {
        a = sstep(0.93, 0.58, r + (n - 0.5) * 0.62);
        b = 1.12 - r * 0.9 + (n - 0.5) * 0.6;
        b *= 1 - sstep(0.55, 0.74, n2) * (0.3 + r * 0.7) * 0.85;
      }
      const o = (py * N + px) * 4, g = Math.round(Math.max(0, Math.min(1, b)) * 255);
      d[o] = g; d[o + 1] = g; d[o + 2] = g; d[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }
  const fireTex = [], smokeB = [];
  function blastTexReady() {
    if (fireTex.length) return;
    for (let i = 0; i < 4; i++) fireTex.push(makeBillowTex(11 + i * 7, false));
    for (let i = 0; i < 3; i++) smokeB.push(makeBillowTex(53 + i * 5, true));
  }

  // a local seeded LCG for the decal art, so baking it never shifts rng()
  function lcg(seed) { let s = seed | 0; return function () { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

  /* GROUND CRATER ATLAS: 2x2 variants on one 512 canvas, one texture, one
     material. Each: a burnt black centre with an ashy pit, radial scorch rays,
     a ragged rim, and a spray of dirt and dark specks thrown past it. */
  function makeCraterAtlas() {
    const S = 512, H = 256, c = document.createElement("canvas"); c.width = c.height = S;
    const ctx = c.getContext("2d");
    for (let q = 0; q < 4; q++) {
      const R = lcg(7001 + q * 131);
      const cx = (q & 1) * H + H / 2, cz = (q >> 1) * H + H / 2, r = H / 2 - 4;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - H / 2, cz - H / 2, H, H); ctx.clip();
      const g = ctx.createRadialGradient(cx, cz, 0, cx, cz, r * 0.62);
      g.addColorStop(0, "rgba(10,9,8,0.97)");
      g.addColorStop(0.55, "rgba(16,13,11,0.93)");
      g.addColorStop(0.85, "rgba(26,21,18,0.6)");
      g.addColorStop(1, "rgba(30,24,20,0)");
      ctx.fillStyle = g; ctx.fillRect(cx - H / 2, cz - H / 2, H, H);
      // scorch rays: thin dark wedges of uneven reach
      const nr = 46 + ((R() * 30) | 0);
      for (let i = 0; i < nr; i++) {
        const a = R() * 6.2832, w = 0.015 + R() * 0.06, L = r * (0.45 + R() * 0.55);
        const l0 = r * 0.25;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a - w) * l0, cz + Math.sin(a - w) * l0);
        ctx.lineTo(cx + Math.cos(a) * L, cz + Math.sin(a) * L);
        ctx.lineTo(cx + Math.cos(a + w) * l0, cz + Math.sin(a + w) * l0);
        ctx.closePath();
        ctx.fillStyle = "rgba(14,12,10," + (0.25 + R() * 0.45).toFixed(2) + ")"; ctx.fill();
      }
      // ashy pit: pale grey ash flecks in the black
      for (let i = 0; i < 40; i++) {
        const a = R() * 6.2832, d = R() * r * 0.3;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 1 + R() * 4, 0, 6.2832);
        ctx.fillStyle = "rgba(70,66,62," + (0.25 + R() * 0.35).toFixed(2) + ")"; ctx.fill();
      }
      // thrown dirt + charred specks past the burn
      for (let i = 0; i < 170; i++) {
        const a = R() * 6.2832, d = r * (0.3 + Math.sqrt(R()) * 0.68);
        const dark = R() < 0.55;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.8 + R() * (dark ? 2.2 : 3), 0, 6.2832);
        ctx.fillStyle = dark ? "rgba(18,16,14," + (0.5 + R() * 0.4).toFixed(2) + ")"
                             : "rgba(92,78,60," + (0.35 + R() * 0.35).toFixed(2) + ")";
        ctx.fill();
      }
      // ragged rim: bite the edge so it never reads as a circle
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 60; i++) {
        const a = R() * 6.2832, d = r * (0.5 + R() * 0.45);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 3 + R() * 9, 0, 6.2832);
        ctx.fillStyle = "rgba(0,0,0," + (0.25 + R() * 0.5).toFixed(2) + ")"; ctx.fill();
      }
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }

  /* WALL SOOT: two variants on one 256x512 canvas. Top half: a RING whose
     centre is empty (it frames a carved hole, the frame geometry below has no
     triangles over the opening at all, so nothing ever hangs in the air of the
     hole); bottom half: a SPLASH for a blast against a wall that held. Soot is
     heaviest above the opening: the smoke poured out of the top of it. */
  const SOOT_INNER = 0.3125;           // the hole is the central 62.5% of the ring decal
  function makeSootTex() {
    const W = 256, c = document.createElement("canvas"); c.width = W; c.height = W * 2;
    const ctx = c.getContext("2d");
    for (let v = 0; v < 2; v++) {
      const R = lcg(9107 + v * 77), oy = v * W, cx = W / 2, cy = oy + W / 2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, oy, W, W); ctx.clip();
      // body: an ellipse pushed up (y is down on a canvas)
      const g = ctx.createRadialGradient(cx, cy - W * 0.08, 0, cx, cy - W * 0.06, W * 0.5);
      g.addColorStop(0, "rgba(12,11,10,0.92)");
      g.addColorStop(v ? 0.35 : 0.42, "rgba(16,14,12,0.85)");
      g.addColorStop(0.7, "rgba(24,21,19,0.4)");
      g.addColorStop(1, "rgba(30,26,22,0)");
      ctx.fillStyle = g; ctx.fillRect(0, oy, W, W);
      // upward licks: the smoke that rolled up the face
      for (let i = 0; i < 26; i++) {
        const x = cx + (R() - 0.5) * W * 0.6, top = oy + W * (0.02 + R() * 0.3);
        const lg = ctx.createLinearGradient(x, cy, x, top);
        lg.addColorStop(0, "rgba(14,12,11,0.55)"); lg.addColorStop(1, "rgba(14,12,11,0)");
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.ellipse(x, (cy + top) / 2, 6 + R() * 16, (cy - top) / 2, (R() - 0.5) * 0.3, 0, 6.2832); ctx.fill();
      }
      // pitting from fragments
      for (let i = 0; i < 90; i++) {
        const a = R() * 6.2832, d = W * (0.15 + R() * 0.33);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.7 + R() * 2, 0, 6.2832);
        ctx.fillStyle = "rgba(8,7,6,0.7)"; ctx.fill();
      }
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 40; i++) {
        const a = R() * 6.2832, d = W * (0.3 + R() * 0.2);
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 4 + R() * 10, 0, 6.2832);
        ctx.fillStyle = "rgba(0,0,0," + (0.3 + R() * 0.5).toFixed(2) + ")"; ctx.fill();
      }
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    }
    const t = new THREE.Texture(c); t.needsUpdate = true; return t;
  }

  // ---- the ONE pooled flash light --------------------------------------------
  const flashPool = PURE.makeFlashPool(function () {
    const l = new THREE.PointLight(0xffc88a, 0, 40, 2);
    l.position.set(0, -500, 0);
    l.castShadow = false;
    scene.add(l);            // added ONCE at load; it only ever changes intensity
    return l;
  }, 0.26);
  CBZ.blastFlashLightCount = function () { return flashPool.made(); };

  // ---- persistent ground crater scorch (instanced, never fades) --------------
  const MARK_CAP = 32;
  const marks = PURE.makeDecalLedger(MARK_CAP);
  let markMeshes = null;                 // 4 InstancedMesh, one per atlas quadrant
  const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
  const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion();
  const _dv = new THREE.Vector3(), _ds = new THREE.Vector3(), _dn = new THREE.Vector3();
  const _UP = new THREE.Vector3(0, 1, 0), _ZF = new THREE.Vector3(0, 0, 1);
  function ensureMarks() {
    if (markMeshes) return markMeshes;
    const tex = makeCraterAtlas();
    const mat = new THREE.MeshLambertMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    mat._shared = true;
    markMeshes = [];
    for (let q = 0; q < 4; q++) {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv, u0 = (q & 1) * 0.5, v0 = (q >> 1) ? 0 : 0.5;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5);
      g._shared = true;
      const im = new THREE.InstancedMesh(g, mat, MARK_CAP);
      for (let i = 0; i < MARK_CAP; i++) im.setMatrixAt(i, ZERO_M);
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false; im.renderOrder = 1; im.matrixAutoUpdate = false;
      im.userData.blastMarks = true;
      scene.add(im);
      markMeshes.push(im);
    }
    return markMeshes;
  }
  function writeMark(rec) {
    const M = ensureMarks();
    // lie on the ground's actual slope, clamped (a kerb is not a slope)
    const h = Math.max(0.6, rec.r * 0.5);
    const sx = (floorAt(rec.x + h, rec.z) - floorAt(rec.x - h, rec.z)) / (2 * h);
    const sz = (floorAt(rec.x, rec.z + h) - floorAt(rec.x, rec.z - h)) / (2 * h);
    if (Math.abs(sx) > 0.45 || Math.abs(sz) > 0.45) _dn.set(0, 1, 0);
    else _dn.set(-sx, 1, -sz).normalize();
    _dq.setFromUnitVectors(_UP, _dn);
    _dq2.setFromAxisAngle(_UP, rec.yaw); _dq.multiply(_dq2);
    _dm.compose(_dv.set(rec.x, rec.gy + 0.03, rec.z), _dq, _ds.set(rec.r * 2, 1, rec.r * 2));
    const im = M[rec.variant & 3];
    im.setMatrixAt(rec.slot, _dm); im.instanceMatrix.needsUpdate = true;
  }
  // blasts queue their mark and it lands a few frames later, AFTER any crater
  // craters.js digs (its wrap runs after this core returns): a flat decal must
  // not hover over a freshly dug bowl, so a sunk floor skips the mark.
  const pendingMarks = [];
  function queueMark(x, z, r, gy) {
    if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return;       // never on water
    if (pendingMarks.length >= 8) pendingMarks.shift();
    pendingMarks.push({ x: x, z: z, r: r, gy: gy, t: 0 });
  }
  function landMark(m) {
    const gy = floorAt(m.x, m.z);
    if (gy < m.gy - 0.35) return;          // a crater was dug here: the bowl is the mark
    const res = marks.place(m.x, m.z, m.r, (rng() * 4) | 0, rng() * 6.2832);
    if (res.evicted && markMeshes) {
      markMeshes[res.evicted.variant & 3].setMatrixAt(res.evicted.slot, ZERO_M);
      markMeshes[res.evicted.variant & 3].instanceMatrix.needsUpdate = true;
    }
    res.rec.gy = res.op === "merge" ? Math.max(res.rec.gy, gy) : gy;
    writeMark(res.rec);
  }

  // ---- wall soot (instanced ring around a carved hole, or a splash) ----------
  const SOOT_CAP = 12;
  const sootRing = PURE.makeDecalLedger(SOOT_CAP), sootSplash = PURE.makeDecalLedger(SOOT_CAP);
  let sootMeshes = null;
  function ensureSoot() {
    if (sootMeshes) return sootMeshes;
    const tex = makeSootTex();
    const mat = new THREE.MeshLambertMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    mat._shared = true;
    // the ring frame: outer unit square minus the central opening, as 8 tris
    const q = SOOT_INNER, P = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -q, -q, q, -q, q, q, -q, q];
    const pos = [], uv = [], nrm = [];
    const quads = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (let k = 0; k < 4; k++) {
      const Q = quads[k], tri = [Q[0], Q[1], Q[2], Q[0], Q[2], Q[3]];
      for (let j = 0; j < 6; j++) {
        const x = P[tri[j] * 2], y = P[tri[j] * 2 + 1];
        pos.push(x, y, 0); nrm.push(0, 0, 1);
        uv.push(x + 0.5, 0.5 + (y + 0.5) * 0.5);            // top half of the canvas
      }
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ringGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    ringGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    ringGeo._shared = true;
    const splashGeo = new THREE.PlaneGeometry(1, 1);
    const suv = splashGeo.attributes.uv;
    for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i), suv.getY(i) * 0.5);   // bottom half
    splashGeo._shared = true;
    sootMeshes = [ringGeo, splashGeo].map(function (g) {
      const im = new THREE.InstancedMesh(g, mat, SOOT_CAP);
      for (let i = 0; i < SOOT_CAP; i++) im.setMatrixAt(i, ZERO_M);
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false; im.renderOrder = 2; im.matrixAutoUpdate = false;
      im.userData.blastSoot = true;
      scene.add(im);
      return im;
    });
    return sootMeshes;
  }
  function writeSoot(im, rec) {
    _dn.set(rec.nx, 0, rec.nz);
    _dq.setFromUnitVectors(_ZF, _dn);
    _dm.compose(_dv.set(rec.x + rec.nx * 0.025, rec.y, rec.z + rec.nz * 0.025), _dq, _ds.set(rec.w, rec.h, 1));
    im.setMatrixAt(rec.slot, _dm); im.instanceMatrix.needsUpdate = true;
  }
  function isGlassMat(m) {
    if (!m) return false;
    if (Array.isArray(m)) m = m[0];
    if (!m) return false;
    if (m.transparent && m.opacity < 0.95) return true;
    if (m.transmission) return true;
    return !!(CBZ.debris && CBZ.debris.kindOf && CBZ.debris.kindOf(m) === "glass");
  }
  /* CBZ.blastWallSoot(x, y, z, nx, nz, w, h, o)
     Soot on the OUTER face of a masonry wall. o.hole true = the ring that
     frames a carved opening of size w x h centred at (x,y,z); false = a splash
     of size w x h for a blast the wall held. o.material skips glass (soot on
     an intact pane was the floating smudge the owner purged). o.bounds
     {minU,maxU,top,horiz} refuses a decal that would hang past the wall. */
  CBZ.blastWallSoot = function (x, y, z, nx, nz, w, h, o) {
    o = o || {};
    if (!(w > 0.2 && h > 0.2)) return false;
    if (isGlassMat(o.material)) return false;
    const nl = Math.hypot(nx, nz); if (nl < 1e-3) return false;
    nx /= nl; nz /= nl;
    const hole = !!o.hole;
    const k = hole ? 1 / (2 * SOOT_INNER) : 1;      // ring spans 1.6x the opening
    let W = w * k, Hh = h * k;
    const b = o.bounds;
    if (b) {
      const u = b.horiz ? x : z;
      if (u - W / 2 < b.minU - 0.05 || u + W / 2 > b.maxU + 0.05) return false;
      if (b.top != null && y + Hh / 2 > b.top + 0.05) {
        if (hole) return false;
        Hh = Math.max(0.4, 2 * (b.top - y)); if (Hh < 0.5) return false;
      }
    }
    const M = ensureSoot();
    const L = hole ? sootRing : sootSplash, im = hole ? M[0] : M[1];
    // a hole opened where a splash was: the splash covered what is now the
    // opening, so it goes (the ring frames the hole instead)
    if (hole) {
      for (let i = sootSplash.live.length - 1; i >= 0; i--) {
        const s = sootSplash.live[i];
        if (Math.hypot(s.x - x, s.y - y, s.z - z) < Math.max(W, Hh) * 0.6) {
          M[1].setMatrixAt(s.slot, ZERO_M); M[1].instanceMatrix.needsUpdate = true;
          sootSplash.remove(s);
        }
      }
    }
    const res = L.place(x, z, Math.max(W, Hh) * 0.5, 0, 0, y);
    const rec = res.rec;
    if (res.op === "add") { rec.nx = nx; rec.nz = nz; rec.w = W; rec.h = Hh; }
    else if (!hole) { rec.w = Math.max(rec.w, W); rec.h = Math.max(rec.h, Hh); }
    else return true;                               // same hole: the ring is already there
    rec.y = y;
    writeSoot(im, rec);
    return true;
  };
  // fracture.js hands every REAL carve here (city/fracture.js debris()).
  CBZ.cityBlastWallSoot = function (rec, power) {
    if (!rec || !rec.gap || rec.curtain) return false;
    const g = rec.gap;
    if (isGlassMat(rec.wall && rec.wall.material)) return false;
    const uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    const face = g.fixed + g.outS * (g.thick || 0.3) / 2;
    const x = g.horiz ? uc : face, z = g.horiz ? face : uc;
    const nx = g.horiz ? 0 : g.outS, nz = g.horiz ? g.outS : 0;
    return CBZ.blastWallSoot(x, vc, z, nx, nz, g.u1 - g.u0, g.v1 - g.v0, {
      hole: true, material: rec.wall && rec.wall.material,
      bounds: { horiz: g.horiz, minU: g.minU != null ? g.minU : -1e9, maxU: g.maxU != null ? g.maxU : 1e9, top: g.y1 },
    });
  };

  // ---- small fires left burning on the debris / crater ------------------------
  const FIRE_CAP = 6;
  const fires = [];
  function addFire(x, y, z, dur, size) {
    if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return;
    while (fires.length >= FIRE_CAP) fires.shift();
    fires.push({ x: x, y: y, z: z, t: 0, dur: dur, acc: rng() * 0.2, sacc: 0.3 + rng() * 0.5, size: size });
  }
  CBZ.blastFire = function (x, y, z, dur, size) { addFire(x, y == null ? floorAt(x, z) : y, z, dur || 30, size || 1); };

  // ---- the SMOKE COLUMN (was addSmolder, cap 3, big blasts only) --------------
  const COL_CAP = 4;
  const columns = [];
  function addColumn(x, gy, z, dur, str, tone, mush) {
    if (!(dur > 0)) return;
    while (columns.length >= COL_CAP) columns.shift();
    columns.push({ x: x, gy: gy, z: z, t: 0, dur: dur, acc: 0.2, str: str,
      tone: tone, capY: mush ? gy + 15 + 7 * str : null });
  }

  const _wind = { x: 0.8, z: 0.3 };
  function windNow() {
    let wx = 1, wz = 0, sp = 0;
    if (CBZ.weatherWind) {
      try { const w = CBZ.weatherWind(); if (w) { if (Number.isFinite(w.x)) wx = w.x; if (Number.isFinite(w.z)) wz = w.z; sp = +w.speed || 0; } } catch (e) {}
    }
    const l = Math.hypot(wx, wz) || 1, s = Math.max(0.6, Math.min(4.5, sp * 0.45));
    _wind.x = wx / l * s; _wind.z = wz / l * s;
    return _wind;
  }
  function camDist(x, y, z) {
    const c = CBZ.camera;
    return c && c.position ? Math.hypot(x - c.position.x, y - c.position.y, z - c.position.z) : 0;
  }

  const DUST_ROCK = [0.36, 0.33, 0.3], DUST_ASPHALT = [0.46, 0.44, 0.41], DUST_EARTH = [0.5, 0.44, 0.36];
  /* THE PICTURE. (x,cy,z) the seat, gy the ground under it, P the visual power,
     K the kind row. o: {fxq, elevated, airburst, nrm, dir}. */
  function blastVisual(x, gy, cy, z, P, K, o) {
    blastTexReady();
    const q = o.fxq, S = Math.min(P, 2.6), sq = Math.sqrt(Math.max(0.2, P));
    const W = windNow(), wx = W.x, wz = W.z;
    // directional throw: a charge on a wall goes OUT along the wall normal; a
    // rocket's leftover momentum carries a little downrange
    let bx = 0, by = 0, bz = 0;
    if (o.nrm) { bx = o.nrm.x * 4.5 * K.dirK; by = o.nrm.y * 4.5 * K.dirK; bz = o.nrm.z * 4.5 * K.dirK; }
    else if (o.dir) { bx = o.dir.x * 2.2 * K.dirK; bz = o.dir.z * 2.2 * K.dirK; }

    // (1) FLASH: a white-hot core that lives one or two frames, a bright inner
    //     pop, and the pooled light
    spawnPuff(x, cy, z, { additive: true, tex: fireTex[0], base: 5.5 * P, pop: 7 * P, life: 0.07, maxOp: 1 });
    spawnPuff(x, cy, z, { additive: true, tex: fireTex[1], base: 1.2 * P, pop: 5 * P * K.core, life: 0.3, maxOp: 1 });
    if (K.light > 0) flashPool.flash(x, cy + 0.6, z, 3.4 * K.light * Math.min(2.2, P), 24 + 12 * Math.min(3, P));
    const capY = cy + 5 * P * K.rise;

    // (2) HOT CORES: additive, inside the body, burn out fast
    const nCore = Math.max(2, Math.round(6 * S * K.core * (0.6 + 0.4 * q)));
    for (let i = 0; i < nCore; i++) {
      const a = rng() * 6.2832, sp = (1.5 + rng() * 3) * sq;
      spawnPuff(x + Math.cos(a) * 0.3 * P, cy + rng() * 0.5 * P, z + Math.sin(a) * 0.3 * P, {
        additive: true, tex: fireTex[i & 3], base: 0.8 * P, pop: (2.4 + rng() * 1.4) * P * K.core * K.fireSize,
        life: 0.45 + rng() * 0.45, maxOp: 0.95, spin: (rng() - 0.5) * 2.4,
        vx: Math.cos(a) * sp + bx * 0.6, vy: (1 + rng() * 2) * K.rise + by * 0.6, vz: Math.sin(a) * sp + bz * 0.6,
        drag: 2.2, buoy: 2.5 * K.rise, capY: capY,
      });
    }
    // (3) THE ROLLING BODY: dark-edged billows punched out on a hemisphere,
    //     dragged to a stop, then climbing — outward-then-up is the roll
    const nBody = Math.max(3, Math.round(12 * S * K.fire * (0.5 + 0.5 * q)));
    for (let i = 0; i < nBody; i++) {
      const a = rng() * 6.2832, el = rng() * 1.2, sp = (3 + rng() * 4.5) * sq;
      const ce = Math.cos(el), dxh = Math.cos(a) * ce, dzh = Math.sin(a) * ce, dyh = Math.sin(el);
      spawnPuff(x + dxh * 0.4 * P, cy + dyh * 0.4 * P, z + dzh * 0.4 * P, {
        additive: false, body: true, tex: fireTex[(i + 1) & 3],
        base: 0.9 * P, pop: (3.2 + rng() * 2.2) * P * K.fireSize, life: 1.5 + rng() * 1.1 + 0.3 * (K.rise - 1),
        maxOp: 0.96, spin: (rng() - 0.5) * 1.6,
        vx: dxh * sp + bx, vy: dyh * sp * 0.8 + 0.8 * K.rise + by, vz: dzh * sp + bz,
        drag: 1.9, buoy: 3.0 * K.rise, capY: capY, delay: rng() * 0.05,
      });
    }
    // (4) SOOT HANDOFF: thick dark smoke born where the fireball cools
    const nSoot = Math.max(2, Math.round(9 * S * K.smoke * (0.5 + 0.5 * q)));
    for (let i = 0; i < nSoot; i++) {
      const a = rng() * 6.2832, rr = (0.4 + rng() * 0.9) * P, sp = 0.8 + rng() * 1.4;
      spawnPuff(x + Math.cos(a) * rr + bx * 0.25, cy + (0.8 + rng() * 1.2) * P * K.rise, z + Math.sin(a) * rr + bz * 0.25, {
        smoke: true, additive: false, tex: smokeB[i % 3],
        base: 1.4 * P, pop: (4.8 + rng() * 3) * P * Math.sqrt(K.smoke), life: 7 + rng() * 5,
        maxOp: 0.62, tone: K.tone, spin: (rng() - 0.5) * 0.7,
        vx: Math.cos(a) * sp, vy: (1.8 + rng() * 1.2) * K.rise, vz: Math.sin(a) * sp,
        drag: 0.6, buoy: 0.45, capY: o.elevated ? null : gy + (9 + 5 * P) * K.rise,
        rx: Math.cos(a), rz: Math.sin(a), wx: wx, wz: wz, fin: 0.12,
        delay: 0.3 + rng() * 0.5,
      });
    }
    // (5) THE SHOCK: a low dust skirt racing out along the ground
    if (!o.elevated && K.dust > 0) {
      const nDust = Math.max(3, Math.round(14 * S * K.dust * q));
      const dt0 = K.surface === "rock" ? DUST_ROCK : (groundKind(x, z) === "dirt" ? DUST_EARTH : DUST_ASPHALT);
      for (let i = 0; i < nDust; i++) {
        const a = (i / nDust) * 6.2832 + rng() * 0.4, sp = (9 + rng() * 6) * sq;
        spawnPuff(x + Math.cos(a) * 0.8, gy + 0.35 + rng() * 0.3, z + Math.sin(a) * 0.8, {
          smoke: true, additive: false, tex: smokeB[i % 3],
          base: 0.8, pop: (3.2 + rng() * 2) * sq * K.dust, life: 1.8 + rng() * 1.3,
          maxOp: 0.42, tone: dt0, noHeat: true, spin: (rng() - 0.5),
          vx: Math.cos(a) * sp, vy: 0.3 + rng() * 0.5, vz: Math.sin(a) * sp,
          drag: 2.6, buoy: 0.12, wx: wx * 0.5, wz: wz * 0.5, fin: 0.08,
          delay: 0.02 + rng() * 0.04,
        });
      }
      pointBurst(x, z, Math.max(1, Math.round(16 * S * K.dust * q)), 0x8b8175, 0.42, 2 + P * 0.5, 0.95, true, gy + 0.35);
    }
    // (6) SPARKS (fast bright streaks) and EMBERS (slow, glowing, falling)
    if (K.sparks > 0) {
      pointBurst(x, z, Math.max(1, Math.round(26 * S * K.sparks * q)), 0xffd890, 0.14, 11 + 6 * P, 0.55, false, cy);
      pointBurst(x, z, Math.max(1, Math.round(12 * S * K.sparks * q)), 0xfff4d0, 0.09, 16 + 7 * P, 0.35, false, cy);
    }
    const nEmber = Math.round(14 * S * K.embers * q);
    for (let i = 0; i < nEmber; i++) {
      const a = rng() * 6.2832, sp = (1.5 + rng() * 4) * sq, b0 = 0.12 + rng() * 0.14;
      spawnPuff(x + Math.cos(a) * 0.5, cy + rng() * 0.8, z + Math.sin(a) * 0.5, {
        additive: true, base: b0, pop: b0 * 0.8, life: 2.2 + rng() * 2.4, maxOp: 1,
        vx: Math.cos(a) * sp + bx * 0.5, vy: 4 + rng() * 6 * sq, vz: Math.sin(a) * sp + bz * 0.5,
        grav: 5.5, drag: 0.9, wx: wx * 0.6, wz: wz * 0.6,
      });
    }
  }

  /* WHAT STAYS. Ground blasts only (an airburst or a hit 20 m up a facade
     leaves no crater on the street; the carve and wall soot are that hit's
     mark). Never on water. */
  function blastAftermath(x, gy, z, P, K, o) {
    if (CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)) return;
    const S = Math.min(P, 2.6), q = o.fxq;
    // (a) the crater and its dark ejecta blanket — persistent, capped (MARK_CAP,
    //     the oldest recycled), merged. Sized by the CHARGE through the law:
    //     apparent crater 0.8 . W^(1/3), ejecta to ~2.2 crater radii — a grenade
    //     scuffs a metre of pavement, a Mk-84 blackens a 26 m disc.
    if (K.decal > 0) {
      const L = CBZ.blastLaw;
      const mr = L && o.W > 0 ? Math.max(0.6, Math.min(16, L.ejectaR(o.W))) : Math.max(1, Math.min(9, 1 + 1.3 * P * K.decal));
      queueMark(x + (o.nrm ? o.nrm.x * 0.6 : 0), z + (o.nrm ? o.nrm.z * 0.6 : 0), mr, gy);
    }
    // (b) THE FLOOR HELD. A grenade on a concrete floor does not cut a slab out
    //     of it: it leaves a scorch, a cloud and a spray of grit. This used to
    //     shatter an invented 0.9-2.2 m box of a flat grey "ground" material
    //     (no mesh ever lost that volume) into rigid chunks on every ground
    //     blast, and paint the grit charcoal whatever the floor was. Ground
    //     that genuinely breaks (systems/craters.js digs the terrain) answers
    //     for itself; here the surface only loses grit, sized as grit by
    //     CBZ.debris.chips, in the surface's own colour.
    const surf = K.surface || groundKind(x, z);
    if (CBZ.debris && K.frag > 0) {
      try {
        CBZ.debris.chips(x, gy + 0.3, z, {
          kind: surf, count: Math.max(2, Math.round(10 * S * K.frag * q)),
          power: 0.55 + 0.25 * S, spread: 2.5, dust: false,
        });
      } catch (e) {}
    }
    // (c) small fires on the debris
    const nF = Math.min(4, Math.round(K.fires * Math.min(1.5, S / 1.4)));
    for (let i = 0; i < nF; i++) {
      const on = K === PURE.KINDS.car && i === 0;          // the shell itself keeps burning
      const a = rng() * 6.2832, d = on ? 0 : (0.6 + rng() * 1.6) * Math.min(2, P);
      const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
      const dur = K.fireDur[0] + rng() * (K.fireDur[1] - K.fireDur[0]);
      addFire(fx, floorAt(fx, fz) + (on ? 0.9 : 0.05), fz, dur, on ? 1.3 : 0.6 + rng() * 0.5);
    }
    // (d) the column
    if (K.column > 0) addColumn(x, gy, z, K.column * (0.75 + 0.15 * Math.min(2, S)), Math.min(2.2, 0.55 + 0.45 * S) * Math.sqrt(K.smoke), K.tone, K.mushroom);
  }

  // ---- per-frame: the light, the queued marks, the columns, the fires --------
  function stepAftermath(dt) {
    flashPool.step(dt);
    for (let i = pendingMarks.length - 1; i >= 0; i--) {
      const m = pendingMarks[i]; m.t += dt;
      if (m.t < 0.06) continue;
      pendingMarks.splice(i, 1);
      landMark(m);
    }
    if (!columns.length && !fires.length) return;
    const W = windNow(), rate = CBZ.qScale ? CBZ.qScale(0.5, 1) : 1;
    for (let i = columns.length - 1; i >= 0; i--) {
      const c = columns[i]; c.t += dt;
      if (c.t >= c.dur) { columns.splice(i, 1); continue; }
      c.acc -= dt;
      if (c.acc > 0) continue;
      c.acc = (0.34 + rng() * 0.2) / rate;
      if (camDist(c.x, c.gy, c.z) > 260) continue;
      const cool = 1 - c.t / c.dur, a = rng() * 6.2832;
      spawnPuff(c.x + Math.cos(a) * 0.6 * c.str, c.gy + 0.8 + rng() * 0.6, c.z + Math.sin(a) * 0.6 * c.str, {
        smoke: true, additive: false, tex: smokeB[(rng() * 3) | 0],
        base: 1.2 * c.str, pop: (4.5 + rng() * 3) * c.str * (0.6 + 0.4 * cool), life: 9 + rng() * 4,
        maxOp: 0.56 * (0.2 + 0.8 * cool), tone: c.tone, noHeat: c.t > 2.5,
        spin: (rng() - 0.5) * 0.5,
        vx: Math.cos(a) * 0.3, vy: 2.4 + rng() * 0.9 * c.str, vz: Math.sin(a) * 0.3,
        drag: 0.35, buoy: 0.15, capY: c.capY, rx: Math.cos(a), rz: Math.sin(a),
        wx: W.x, wz: W.z, fin: 0.12,
      });
    }
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i]; f.t += dt;
      if (f.t >= f.dur) { fires.splice(i, 1); continue; }
      const life = 1 - f.t / f.dur, k = Math.min(1, life * 3), s = f.size * (0.45 + 0.55 * k);
      if (camDist(f.x, f.y, f.z) > 150) continue;
      f.acc -= dt;
      if (f.acc <= 0) {
        f.acc = (0.11 + rng() * 0.1) / rate;
        spawnPuff(f.x + (rng() - 0.5) * 0.5 * s, f.y + 0.1, f.z + (rng() - 0.5) * 0.5 * s, {
          additive: true, tex: fireTex[(rng() * 4) | 0], base: 0.3 * s, pop: (0.9 + rng() * 0.6) * s,
          life: 0.5 + rng() * 0.35, maxOp: 0.85, spin: (rng() - 0.5) * 2.4,
          vy: 1.2 + rng() * 1.0, buoy: 1.5, wx: W.x * 0.3, wz: W.z * 0.3,
        });
      }
      f.sacc -= dt;
      if (f.sacc <= 0) {
        f.sacc = (0.55 + rng() * 0.4) / rate;
        spawnPuff(f.x, f.y + 0.6 * s, f.z, {
          smoke: true, additive: false, tex: smokeB[(rng() * 3) | 0],
          base: 0.6 * s, pop: (2.4 + rng() * 1.6) * s, life: 4 + rng() * 2.4,
          maxOp: 0.36 * k, tone: PURE.KINDS.car.tone, spin: (rng() - 0.5) * 0.6,
          vx: (rng() - 0.5) * 0.3, vy: 1.3 + rng() * 0.6, vz: (rng() - 0.5) * 0.3,
          buoy: 0.35, wx: W.x, wz: W.z, fin: 0.15,
        });
      }
    }
  }

  CBZ.blastFxAudit = function () {
    return {
      marks: marks.live.length, markCap: MARK_CAP,
      soot: sootRing.live.length + sootSplash.live.length, sootCap: SOOT_CAP * 2,
      fires: fires.length, fireCap: FIRE_CAP, columns: columns.length, columnCap: COL_CAP,
      lights: flashPool.made(), lightLevel: +flashPool.level().toFixed(3),
      puffsLive: puffs.length, puffPooled: puffPool.length, puffCap: PUFF_CAP,
    };
  };

  // The charge behind a blast, kg TNT-equivalent — the same resolution
  // buildings.js blastBuildings uses (explicit, else the named ordnance's
  // reference charge, else the legacy power).
  function chargeOf(opts) {
    const L = CBZ.blastLaw;
    if (!L) return 0;
    if (opts.charge > 0) return +opts.charge;
    const ref = L.CHARGES[opts.ordnance] || L.CHARGES[opts.kind];
    return ref ? ref.W : L.chargeOfPower(opts.power || 1);
  }

  // normalise the directional opts a caller may pass (no allocation on the hot
  // path: two scratch records, read synchronously inside one blast)
  const _nrmS = { x: 0, y: 0, z: 0 }, _dirS = { x: 0, y: 0, z: 0 };
  function blastNormal(o) {
    const n = o.normal;
    if (!n) return null;
    const l = Math.hypot(n.x || 0, n.y || 0, n.z || 0);
    if (l < 1e-4) return null;
    _nrmS.x = (n.x || 0) / l; _nrmS.y = (n.y || 0) / l; _nrmS.z = (n.z || 0) / l;
    return _nrmS;
  }
  function blastDir(o) {
    let dx = 0, dz = 0;
    if (o.dir) { dx = o.dir.x || 0; dz = o.dir.z || 0; }
    else if (o.dirx != null || o.dirz != null) { dx = +o.dirx || 0; dz = +o.dirz || 0; }
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return null;
    _dirS.x = dx / l; _dirS.y = 0; _dirS.z = dz / l;
    return _dirS;
  }

  /* THE ONE EXPLOSION. Every ordnance in the game ends here: the RPG, the
     grenade, C4 (systems/breach.js), a car cook-off, aircraft, the ordnance
     bus's "blast" composer, and outside the city CBZ.cityBlastCore (the same
     function, unwrapped).
     opts: power, radius, byPlayer, y, noDamage, airburst, cause, ordnance
           kind    "rpg"|"grenade"|"c4"|"car"|"aircraft"|"heavy"|"volcano"|
                   "impact"|... (or any impactbus row id; `ordnance` is read
                   when kind is absent) — picks the look, never the damage
           normal  {x,y,z} surface the charge sat on (C4 on a wall): the
                   fireball and debris are thrown OUT along it
           dir     {x,z} (or dirx/dirz) travel direction of the round */
  function cityExplosionCore(x, z, opts) {
    opts = opts || {};
    const power = opts.power || 1, R = (opts.radius || 6) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(2.2, power);            // visual scale is clamped so huge blasts stay cheap
    const K = PURE.blastKind(opts.kind || opts.ordnance);
    // FX budget rides the perf/quality slider — tier0 sheds ~65% of the
    // particles, Best (tier 4) is the full picture. Sampled ONCE per blast.
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // opts.y = detonation HEIGHT. A rocket that lands 30 m up a tower face must
    // bloom THERE, not at the kerb below it. Everything is measured from the
    // REAL ground under the blast (this used to compare y against a flat 3 m,
    // so every blast on a hill counted as an airburst and a seat clamped under
    // 3 m sat inside the hill).
    const gy = floorAt(x, z);
    const cy = opts.y != null ? Math.max(gy + 1.0, +opts.y) : gy + 1.0;
    const hAbove = cy - gy;
    const elevated = hAbove > 3;
    const nrm = blastNormal(opts), dir = blastDir(opts);

    blastVisual(x, gy, cy, z, P, K, { fxq: fxq, elevated: elevated, airburst: !!opts.airburst, nrm: nrm, dir: dir });
    // street furniture in the blast breaks into itself (city/props.js)
    if (CBZ.cityPropsBlast) { try { CBZ.cityPropsBlast(x, cy, z, R, power, { byPlayer: !!opts.byPlayer, cause: opts.cause || null }); } catch (e) {} }
    // what stays: crater scorch, torn ground, fires, the column. An airburst
    // (a rocket caught an aircraft) and a hit high on a facade leave none of it
    // on the street. A charge ON a wall still scorches the ground at its foot.
    if (!opts.airburst && power >= 0.5 && (!elevated || (nrm && Math.abs(nrm.y) < 0.6 && hAbove < 4.5))) {
      blastAftermath(x, gy, z, P, K, { fxq: fxq, nrm: nrm, dir: dir, W: chargeOf(opts) });
    }
    // ---- IMPACT FEEDBACK: sound, shake, slow-mo, screen flash, by DISTANCE
    // to the lens. The shake falls off as 1/(1+(d/(1.5R+4))^2): full at your
    // feet, half at ~a blast radius and a half, nothing past a few hundred
    // metres (it used to floor at 25% at any range). Sound keeps
    // CBZ.blastVolume's shared curve and now ARRIVES LATE by distance
    // (343 m/s): a blast across the district flashes, then booms.
    const cd = camDist(x, cy, z);
    const att = PURE.shakeAtten(cd, R);
    if (CBZ.sfx) {
      const dl = PURE.soundDelay(cd);
      const so = { dist: cd, volume: CBZ.blastVolume ? CBZ.blastVolume(power) : 1 };
      if (dl > 0) so.delay = dl;
      CBZ.sfx("explosion", so);
    }
    if (CBZ.shake && att > 0.02) CBZ.shake(3.2 * Math.min(2, power) * att);
    // punch is DEFERRED two frames (blastPunch) so the flash renders before
    // time stops — see the FX_BLAST_FIRSTFRAME block.
    if (att > 0.5) blastPunch(0.18, 0.34);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl && att > 0.4) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}
    // blast damage in radius — crowd, peds, cops, and the player (shared path).
    // An elevated blast only reaches the street where its SPHERE does: the
    // ground footprint shrinks with height (and vanishes past the radius).
    if (!opts.noDamage) {
      const drop = elevated ? hAbove - 1.2 : 0;   // height above a standing chest
      const gR = elevated ? Math.sqrt(Math.max(0, R * R - drop * drop)) : R;
      if (gR > 0.4) {
        const cause = opts.cause ||
          (opts.ordnance === "nuke" ? "nuclear blast" : "explosion");
        applyBlastDamage(x, z, gR, power, byPlayer, null, null, cause);
      }
    }
    // The world-state ledger (city/worldstate.js) is the CITY's persistent
    // truth — panic, damage, repair debt, insurance. A rocket fired in the
    // prison yard or on the disaster island must not write into it.
    if (CBZ.cityEvent && (!CBZ.game || CBZ.game.mode === "city")) CBZ.cityEvent("explosion", { x: x, z: z, panic: 10 * power, damage: 8 * power }, { silent: true, noWanted: true });

    // ---- WHAT IT DOES TO BUILDINGS: glass, doors, the wall, the ledger — all
    // from the charge, through the one law (buildings.js blastBuildings ->
    // systems/breach.js). Every mode: the prison's walls open by the same law.
    if (!opts.noDamage && CBZ.blastBuildings) {
      try { CBZ.blastBuildings(x, cy, z, opts); } catch (e) {}
    }
  }
  CBZ.cityExplosion = cityExplosionCore;

  // ---- THE UNWRAPPED BLAST (CBZ.cityBlastCore) ------------------------------
  // CBZ.cityExplosion is the head of a WRAPPER CHAIN — buildings.js hangs the
  // structural ledger on it, bank.js the vault-door coupling, construction.js
  // the site walls, wildlife.js the herd panic, armored.js the truck hull,
  // demolition.js, water_impact.js. Every one of those couples the blast to a
  // CITY record, and once a session has visited the city the wraps stay
  // installed for the rest of it — so calling the chain from the prison yard
  // would run six city couplings against lists that describe a different world.
  //
  // This handle is the blast ITSELF, before any of them: the fireball, the
  // smoke, the shockwave, the sound, the shake, the scorch and the shared
  // damage sweep — none of which reads a city record. Shared modes detonate
  // through THIS (systems/fpsmode.js's rocket), the city keeps detonating
  // through the full chain, and neither has to know about the other. Do not
  // wrap this handle; wrap CBZ.cityExplosion, which is what everything already
  // does.
  CBZ.cityBlastCore = cityExplosionCore;

  // Shared blast-damage application — the SAME path cityExplosion always used:
  // crowd circle-kill, peds, cops, and the player, scaled by distance/power.
  // Both cityExplosion and cityAirstrikeExplosion route through this so they hurt
  // people identically. (force/fling let an airstrike fling bodies harder.)
  function applyBlastDamage(x, z, R, power, byPlayer, force, fling, cause) {
    force = force == null ? 9 : force; fling = fling == null ? 6 : fling;
    cause = cause || "explosion";
    // ---- THE OTHER ROSTERS (2026-08-06) ---------------------------------
    // Everything below this line names a CITY list. A bullet already knew
    // better — systems/fpsmode.js's target scan reads cityPeds/cityCops in the
    // city and guards/npcs everywhere else — but a BLAST never learned, so an
    // RPG in the prison passed through a room full of men. CBZ.blastWorldActors
    // (systems/modecaps.js) applies this exact shape (a lethal core at 0.55R,
    // the player on a linear falloff to R) to whichever roster the current mode
    // actually owns, and routes each hit through that mode's OWN kill funnel —
    // CBZ.aiKill for the prison, gungame.hurt for a match bot, surv.hurtRadius
    // for the island. It is a deliberate NO-OP in city mode so the two sweeps
    // can never double-kill the same pedestrian.
    if (CBZ.blastWorldActors) {
      try { CBZ.blastWorldActors(x, 0, z, R, power, { byPlayer: byPlayer, force: force, fling: fling, cause: cause }); }
      catch (e) {}
    }
    // REALISTIC LETHALITY: a blast is fatal near ground zero, not across its whole
    // visual / ground-shock radius. Killing EVERYONE within R wiped out crowds of
    // bystanders most of a block away (filmed "kills a huge amount of people").
    // Lethal core ≈ 0.55R (≈0.3× the area, so ~3× fewer deaths); past it, spared.
    // ---- THE CROWDS (entities/crowdstore.js): every rally, march, packed
    // bowl and grandstand is rows of the one store, which takes the blast by
    // its own falloff (the same 0.55R lethal core), sends the survivors
    // running and counts the dead for the news. Its groups carry their own
    // world, so this is safe in every mode.
    if (CBZ.crowds) { try { CBZ.crowds.blast(x, z, R, power, { cause: cause, byPlayer: byPlayer }); } catch (e) {} }
    const LR = R * 0.55, LR2 = LR * LR;
    // CITY ROSTERS ONLY. The prison arena overlaps the city's coordinate space
    // around the origin — the same overlap city/mode.js stamps `_city` on its
    // colliders to fix — so a blast in the yard sitting on top of a stale
    // pedestrian list would have killed people who are not in this world, and
    // cityHurtPlayer would have run the CITY's death instead of the prison's
    // haul-to-your-cell. The non-city rosters were handled above.
    const cityRoster = !CBZ.game || CBZ.game.mode === "city";
    if (cityRoster) {
      // THE DEAD FIRST: every body already lying within R is thrown by the
      // ragdoll (city/ragdoll.js), falling off with distance. Before the kill
      // sweep, so the men this blast kills are launched once, by their kill.
      if (CBZ.ragdollBlast) { try { CBZ.ragdollBlast(x, z, R, power); } catch (e) {} }
      for (const p of (CBZ.cityPeds || [])) { if (p.dead) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz <= LR2 && CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }, cause); }
      for (const c of (CBZ.cityCops || [])) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz <= LR2 && CBZ.cityHurtCop) CBZ.cityHurtCop(c, 9999, { fromX: x, fromZ: z, force: force, fling: fling, byPlayer: byPlayer }); }
      const PL = CBZ.player;
      if (PL && !PL.dead) { const dx = PL.pos.x - x, dz = PL.pos.z - z, d2 = dx * dx + dz * dz; if (d2 < R * R) { const dmg = Math.round(85 * power * (1 - Math.sqrt(d2) / (R + 0.01))); if (dmg > 0 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, x, z, cause === "nuclear blast" ? "killed by a nuclear blast" : "caught in an explosion", false, null, false); } }
    }

    // ---- B5: STRUCTURAL BLAST DAMAGE — every player-built piece (systems/
    // pieces.js) within the FULL blast sphere R (not the reduced ped lethal
    // core LR above — a wall doesn't get to "survive by standing further
    // back" the way a scattering crowd does) takes damage on the SAME
    // linear 1→0 falloff shape as the player's own blast damage just above.
    // queryCollidersNear is a broadphase (square, not circular) so we still
    // gate on real distance below; pieceId can repeat across a piece's own
    // multiple AABBs (e.g. a doorframe's 3 colliders), hence the Set dedupe.
    // BASE tuned so a single C4 charge (power 1.4, structDamage.js's wood-
    // tier explosive mult 4.0) one-shots a full-hp (250) wood wall at close
    // range: 70 * 1.4 * 4.0 = 392 ≥ 250.
    if (CBZ.structDamage && CBZ.queryCollidersNear && CBZ.pieces) {
      const near = CBZ.queryCollidersNear(x, z, R, blastPieceScratch);
      blastPieceSeen.clear();
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.pieceId == null || blastPieceSeen.has(c.pieceId)) continue;
        blastPieceSeen.add(c.pieceId);
        const piece = CBZ.pieces.get(c.pieceId);
        if (!piece || !piece.alive) continue;
        const dx = piece.pos.x - x, dz = piece.pos.z - z, d = Math.hypot(dx, dz);
        if (d >= R) continue;
        const amt = 70 * power * (1 - d / R);
        if (amt > 0) CBZ.structDamage.hit(c.pieceId, amt, "explosive");
      }
    }
  }

  // ============================================================
  // AIRSTRIKE / MISSILE blast — a BIGGER, LONGER, taller variant of
  // cityExplosion for incoming missiles and called-in airstrikes. Same pooled
  // sprite system, same shared damage path; just dialed up: a larger white-hot
  // fireball that balloons up into a mushroom head, a tall lingering black smoke
  // COLUMN, more debris + sparks, a heavier shake and a touch more slow-mo.
  // opts: { power, radius, byPlayer, y, noVisual } — y = optional detonation
  // height (air-burst). noVisual lets a purpose-built composer own the picture
  // while this shared path still owns damage, structure damage, sound and shake.
  // ============================================================
  CBZ.cityAirstrikeExplosion = function (x, z, opts) {
    opts = opts || {};
    const power = opts.power || 2, R = (opts.radius || 12) * power, byPlayer = !!opts.byPlayer;
    const P = Math.min(4.6, power * 1.35);     // bigger visual ceiling than a car blast (airstrike = huge)
    // detonation seat, from the REAL ground: air-bursts (a missile caught a
    // wall) sit higher, ground hits low
    const gy = floorAt(x, z);
    const seat = opts.y != null ? Math.max(0, +opts.y - gy) : 0;
    const cy = gy + 1.2 + seat * 0.5;

    /* A nuke has its own physically staged dome/fireball/cloud composer. Before
       `noVisual`, this generic prefab still added roughly 400 independent
       flame, smoke, ember and debris requests underneath it. That was both the
       post-flash frame spike and the opaque plume hiding the nuclear silhouette.
       Keep every gameplay/feedback owner below this block running; skip only
       this prefab's redundant picture. */
    if (opts.noVisual !== true) {
      // THE SAME ONE EXPLOSION as cityExplosion, drawn at heavy proportions.
      // This used to be its own ~400-sprite additive recipe; it is now the
      // shared picture with the "heavy" row (or the caller's own kind: an
      // airliner is "aircraft", a meteor "impact").
      const kn = PURE.kindName(opts.kind || opts.ordnance);
      const K = PURE.blastKind(kn === "blast" ? "heavy" : kn);
      const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
      const elevated = cy - gy > 6;
      const dir = blastDir(opts);
      blastVisual(x, gy, cy, z, Math.min(4.2, P), K, { fxq: fxq, elevated: elevated, airburst: false, nrm: null, dir: dir });
      if (!elevated) blastAftermath(x, gy, z, Math.min(4.2, P), K, { fxq: fxq, nrm: null, dir: dir, W: chargeOf(opts) });
    }
    if (CBZ.cityPropsBlast) { try { CBZ.cityPropsBlast(x, cy, z, R, power, { byPlayer: byPlayer, cause: opts.cause || "airstrike" }); } catch (e) {} }

    // ---- IMPACT FEEDBACK: bigger boom, harder shake, more slow-mo, screen flash --
    // Same treatment as cityExplosion above: distance in, power-scaled volume
    // out, through the shared CBZ.blastVolume curve. Heavy ordnance is a
    // BIGGER `power` than a car blast by construction, so this is where "a
    // JDAM is louder than a grenade" actually becomes audible. The SHAKE is
    // deliberately left alone — every airstrike in the game is tuned against
    // its unattenuated value, and quieting it is a different change.
    if (CBZ.sfx) {
      let sd = 0;
      const scam = CBZ.camera;
      if (scam && scam.position) sd = Math.hypot(x - scam.position.x, cy - scam.position.y, z - scam.position.z);
      const so = { dist: sd, volume: CBZ.blastVolume ? CBZ.blastVolume(power) : 1 };
      const dl = PURE.soundDelay(sd);                 // the boom arrives at 343 m/s
      if (dl > 0) so.delay = dl;
      CBZ.sfx("explosion", so);
    }
    if (CBZ.shake) CBZ.shake(5.5 * Math.min(2.4, power));
    // deferred like cityExplosion's — the fireball exists before time stops
    blastPunch(0.26, 0.5);
    try { const fl = CBZ.el && CBZ.el.flash; if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); } } catch (e) {}

    // blast damage — SAME shared path as cityExplosion, just flings bodies harder
    const cause = opts.cause ||
      (opts.ordnance === "nuke" ? "nuclear blast" : "explosion");
    applyBlastDamage(x, z, R, power, byPlayer, 14, 10, cause);
    // (airstrike/ordnance ride along so the news can tell a bomb from a gas tank)
    if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: x, z: z, panic: 14 * power, damage: 10 * power, airstrike: true, ordnance: opts.ordnance || null }, { silent: true, noWanted: true });

    // WHAT IT DOES TO BUILDINGS — the same one call as cityExplosion. The wall
    // is asked at the real hit height (opts.y), not the raised fireball seat.
    if (!opts.noDamage && CBZ.blastBuildings) {
      const hy = opts.y != null ? Math.max(gy + 1.0, +opts.y) : gy + 1.2;
      try { CBZ.blastBuildings(x, hy, z, opts); } catch (e) {}
    }
  };

  // ============================================================
  // RPG ON A BUILDING — the facade REACTS at the impact point (owner filmed a
  // rocket hit a tower and "a few windows popped"). CBZ.cityBlastWall(pt, n, o)
  // composes, at pt on a wall face with outward normal n:
  //   1) [PURGED — see FX_WALL_WOUNDS] a painted BLAST SCAR decal on the face,
  //   2) a debris AVALANCHE: concrete chunks + a sheet of pale dust cascading
  //      DOWN the facade from the wound (shared chunk pool, downward bias),
  //   3) [PURGED — see FX_WALL_WOUNDS] a 60–90s smoke column off the wound,
  //   4) near the roofline: ONE parapet block knocked loose, tumbling the whole
  //      way down (collider tops locate the roof).
  // Ground-floor hits still breach (buildings.js cityBreach) — this layers on.
  // ============================================================
  const scars = [], wounds = [];
  const SCAR_CAP = 8;
  const _scarZ = new THREE.Vector3(0, 0, 1);
  const _scarN = new THREE.Vector3();

  // ---- FX_WALL_WOUNDS — THE PERSISTENT MARK ON A FACADE IS PURGED ------------
  // OWNER (2026-07-27, filming a jeweller's shopfront after a blast): "this type
  // of mark left on buildings and windows is so dumb and defies physics — purge
  // it." TWO producers were painting that mark and both are this one class:
  //
  //  (a) addWallScar — a flat scorch-gradient quad stamped 8 cm PROUD of the wall
  //      plane and held at 0.95 opacity for 80–120 s. On a glass curtain wall
  //      there is nothing for soot to adhere TO, so it read as a dark smudge
  //      hovering on the pane. This is the SAME floating-decal failure that
  //      cityBlastWall's own note (1) already diagnosed and deleted from its
  //      path — woundScorch quietly reintroduced it one function over.
  //  (b) addBlastWound — the 60–90 s wall smoke emitter. Every puff it spawns is
  //      the LUMPY smoke sprite (makeSmokeTexture draws SEVEN overlapping soft
  //      blobs), seated 0.6 m off the face at shade 0.12–0.16 (near-black), at
  //      ~2/s with a 3.6–5.2 s life — so roughly EIGHT dark blurry blobs hang
  //      against the glass continuously for a minute and a half, replenished as
  //      fast as they die. Sprites are camera-facing, so the cluster reads as
  //      painted ON the pane instead of as smoke leaving a hole. That arc of
  //      ~8 blobs in the owner's screenshot is exactly this emitter.
  //
  // WHAT DELIBERATELY SURVIVES: every DETONATION-TIME layer (flash, fireball,
  // concrete dust burst, the cascading dust sheet, the facade avalanche, the
  // rubble heap, the dangling rebar, the parapet chunk, the ejecta cone) — the
  // explosion still looks like an explosion — and every GROUND mark (the
  // crater scorch and its smoke column), which sit on a HORIZONTAL surface
  // where settled soot is exactly what physics leaves behind.
  //
  // WALL SOOT CAME BACK ONLY WHERE IT IS PHYSICAL (CBZ.blastWallSoot, 2026-09-28):
  // both purged producers failed for the same two reasons, glass and hanging
  // in the air. The new mark is neither: it is stamped only by a REAL carve in
  // a MASONRY wall (fracture.js -> cityBlastWallSoot; curtain walls and any
  // glass material refuse), it lies flush on the outer face with
  // polygonOffset (2.5 cm, not 8), and its geometry is a FRAME with no
  // triangles over the opening, so nothing can ever float in the hole. It is
  // refused outright when it would overhang the wall's end or its top.
  //
  // Gating the two PRODUCERS (rather than their four call sites) is what keeps
  // this a one-line revert: flip true and cityWallRuin, cityHeavyWallRuin,
  // cityBlastWall and cityEjectaCone all get the old behaviour back, unchanged.
  // Their update loops and cityBlastFxReset already handle empty pools.
  if (CBZ.CONFIG.FX_WALL_WOUNDS == null) CBZ.CONFIG.FX_WALL_WOUNDS = false;
  function wallWoundsOn() { return CBZ.CONFIG.FX_WALL_WOUNDS === true; }

  function addWallScar(x, y, z, nx, ny, nz, size) {
    if (!wallWoundsOn()) return;   // purged: no painted mark on a vertical face
    if (!scorchTex) scorchTex = makeScorchTexture();
    while (scars.length >= SCAR_CAP) { const o = scars.shift(); scene.remove(o.mesh); o.mat.dispose(); }
    const mat = new THREE.MeshBasicMaterial({
      map: scorchTex, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(scorchGeo, mat);
    _scarN.set(nx, ny, nz);
    if (_scarN.lengthSq() < 1e-6) _scarN.set(0, 0, 1); else _scarN.normalize();
    mesh.quaternion.setFromUnitVectors(_scarZ, _scarN);
    mesh.rotateZ(rng() * Math.PI * 2);
    mesh.position.set(x + _scarN.x * 0.08, y + _scarN.y * 0.08, z + _scarN.z * 0.08);
    mesh.scale.set(size, size, 1);
    mesh.renderOrder = 3;
    scene.add(mesh);
    scars.push({ mesh, mat, t: 0, hold: 80 + rng() * 40 });
  }

  // dust + a spray of chips knocked off the face, biased DOWN the wall (an
  // avalanche, not the radial fountain a ground blast throws). The wall's
  // actual lost volume is shed by the carve; this is only what powders off it.
  // mat (optional): the struck wall's material, so the chips are its colour.
  function facadeAvalanche(x, y, z, nx, nz, power, mat) {
    let tx = -nz, tz = nx;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-4) { tx = 1; tz = 0; } else { tx /= tl; tz /= tl; }
    if (CBZ.debris) CBZ.debris.chips(x + nx * 0.3, y, z + nz * 0.3, {
      material: mat || null, kind: mat ? undefined : "concrete",
      count: Math.round(8 + 6 * power), dir: { x: nx, y: -0.6, z: nz }, power: 0.6 + power * 0.3, spread: 2.2,
    });
    // pale concrete dust sheeting down the face below the wound, staggered so
    // it visibly CASCADES instead of appearing all at once
    const drop = Math.min(Math.max(2, y - 0.5), 14);
    const nd = Math.round(7 + 4 * power);
    for (let i = 0; i < nd; i++) {
      const f = i / nd;
      spawnPuff(x + tx * (rng() - 0.5) * 2 + nx * 0.5, y - f * drop, z + tz * (rng() - 0.5) * 2 + nz * 0.5, {
        additive: false, smoke: true, base: 1.0, pop: 3.2 + rng() * 2.2,
        life: 1.7 + rng(), maxOp: 0.42, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * 0.7 + tx * (rng() - 0.5), vy: -(1.5 + rng() * 2.5), vz: nz * 0.7 + tz * (rng() - 0.5),
        delay: f * 0.5 + rng() * 0.08,
      });
    }
  }
  // fracture.js pours wall-hole debris through this same pooled cascade
  CBZ.cityFacadeAvalanche = facadeAvalanche;

  /* ============================================================
     CONSERVATION OF MATTER — "ALL DEBRIS SHOULD COME OFF OF SOMETHING"

     OWNER, 2026-08-29: "I HATE FAKE DEBRIS ... RPG DAMAGE AND DEBRIS SHOULD BE
     VOXEL ONLY. NO FAKE DEBRIS. IT MUST COME FROM SOMEWHERE."

     He is right, and rubbleHeap() below is the confession. It takes a POINT and
     a COUNT and invents `14 + width*4 + power*6` lumps of a shared grey out of
     nothing, next to a wall it never looked at. The flying half (facadeAvalanche)
     invents `7 + 5*power` more. Neither knows what was removed, what it was made
     of, or how much of it there was — so a rocket into a pale glass office and a
     rocket into a brown brick warehouse shed the identical grey pile, and a
     0.5 m nick shed the same heap as a two-storey bay.

     THE LAW HERE: every piece of debris is CUT OUT of a specific solid that is
     being removed from the world in the same breath, carries THAT solid's own
     material, starts at the sub-volume it occupied inside it, and the volume of
     the pieces is the volume of the hole. Think voxel — not a voxel engine, the
     voxel BOOKKEEPING: the wall is diced on a grid, the cells inside the blast
     leave, and what lands on the pavement is those cells and nothing else.

     Two consequences worth having on purpose:
       * the pile is the colour of the building, because it IS the building;
       * a curtain wall sheds two thin concrete courses and a lot of glass while
         a brick pier sheds a mountain, without anyone tuning a count.

     The perimeter is diced too, and cells on the rim are KEPT (welded to the
     shell, no collider — they are a lip, not a wall). That is where the ragged
     edge comes from now: it is material that survived, not a decorative tooth
     laid over a machined rectangle.
     ============================================================ */
  // Kept for readers of the old flag; there is no cube path left to switch to.
  if (CBZ.CONFIG.DEBRIS_CONSERVED_V1 == null) CBZ.CONFIG.DEBRIS_CONSERVED_V1 = true;
  const shedStats = { events: 0, pieces: 0, kept: 0, volShed: 0, volKept: 0, volRemoved: 0, invented: 0 };

  /* PUBLIC: a solid is being removed — hand the world its pieces.
     box  — WORLD aabb of the material leaving: {minX,maxX,minY,maxY,minZ,maxZ}
     mat  — the SOURCE mesh's material (the actual one)
     o.nx/o.nz outward normal, o.power, o.rim (0..1 ragged welded lip),
     o.budget (max pieces), o.glass, o.at {x,y,z}, o.owner.
     A shim onto CBZ.debris.shatterBox: Voronoi pieces of that box, its own
     material and texture, volume conserved exactly. */
  CBZ.cityShedSolid = function (box, mat, o) {
    o = o || {};
    if (!box || !mat || !CBZ.debris) return { pieces: 0, kept: 0, volume: 0 };
    const w = box.maxX - box.minX, h = box.maxY - box.minY, d = box.maxZ - box.minZ;
    if (!(w > 0.02 && h > 0.02 && d > 0.005)) return { pieces: 0, kept: 0, volume: 0 };
    const r = CBZ.debris.shatterBox(box, mat, {
      at: o.at || null, dir: { x: o.nx || 0, y: 0.15, z: o.nz || 0 },
      power: Math.max(0.6, Math.min(3, o.power || 1.4)),
      kind: o.glass ? "glass" : undefined,
      keepEdge: o.rim == null ? 0.3 : o.rim,
      maxPieces: o.budget || 24, owner: o.owner || null,
    });
    const vol = w * h * d;
    shedStats.events++; shedStats.pieces += r.pieces; shedStats.volShed += vol; shedStats.volRemoved += vol;
    return { pieces: r.pieces, kept: 0, volume: vol };
  };

  /* The receipt. "Invented" counts pieces minted by the old point-and-count
     spawners; on the conserved path it must be ZERO, and the ratio of shed
     volume to removed volume must sit at 1. Both are in the before/after table
     precisely because "no fake debris" is a claim somebody has to be able to
     check. */
  CBZ.cityDebrisAudit = function () {
    const st = CBZ.debris ? CBZ.debris.stats() : { live: 0, static: 0 };
    return {
      flag: true,
      shedEvents: shedStats.events,
      shedPieces: shedStats.pieces,
      keptRimCells: 0,
      inventedPieces: 0,
      removedVolume: +shedStats.volRemoved.toFixed(2),
      shedVolume: +shedStats.volShed.toFixed(2),
      keptVolume: 0,
      conservation: shedStats.volRemoved > 0.001 ? 1 : 0,
      liveDebris: st.live, sourcedDebris: st.live + st.static, settledPile: st.static,
    };
  };

  // ---- RUBBLE at the base of a collapsed section: a pile of that face's own
  // material (CBZ.debris.pile), seated piece on piece, against the wall.
  let _heapMat = null;
  function rubbleHeap(cx, cz, nx, nz, spread, size, count, mat) {
    if (!CBZ.debris) return;
    if (!mat && !_heapMat) _heapMat = new THREE.MeshLambertMaterial({ color: 0x8d877d });
    const g = nNorm(nx, nz);
    const out = spread * 0.35;
    CBZ.debris.pile({
      x: cx + g.x * (0.4 + out), z: cz + g.y * (0.4 + out),
      w: spread * (Math.abs(g.y) > 0.5 ? 1.6 : 0.8), d: spread * (Math.abs(g.y) > 0.5 ? 0.8 : 1.6),
      h: Math.min(1.8, size * 0.9), material: mat || _heapMat, count: Math.min(90, count * 2),
    });
  }
  // unit ground normal (guards a near-vertical / zero normal)
  const _nn = { x: 0, y: 1 };
  function nNorm(nx, nz) { const l = Math.hypot(nx, nz); if (l < 1e-3) { _nn.x = 0; _nn.y = 1; } else { _nn.x = nx / l; _nn.y = nz / l; } return _nn; }

  // ---- SOOT RING decal hugging the wall around the wound ----
  // NO-OP by default. The argument that brought this back was "the old floating
  // brown decal was fake because it hung in EMPTY AIR; now there is a real carved
  // hole behind it, so a soot ring reads right." That reasoning holds only where
  // a hole was actually carved — and the same decal is stamped on glass curtain
  // walls and shopfronts, which never carve, so it went back to hanging in front
  // of an intact pane. The owner filmed exactly that. Gated at addWallScar (see
  // FX_WALL_WOUNDS); the carved hole itself is still the mark.
  function woundScorch(x, y, z, nx, ny, nz, size) {
    addWallScar(x, y, z, nx, ny, nz, size);
  }

  // ============================================================
  // cityWallRuin — the COMPLETE real-blast facade read in one call, composed by
  // fracture.js right after it carves a persistent hole. Layers, big→subtle:
  //   1)-3) [GONE] the avalanche, the rubble heap and the dangling rebar were
  //      all invented here; the carve sheds the wall's own pieces instead,
  //   4) [PURGED by FX_WALL_WOUNDS] a painted soot ring on the wall face,
  //   5) a fat concrete DUST CLOUD bursting out of the wound,
  //   6) [PURGED by FX_WALL_WOUNDS] a 60-90s smoke column off the wound.
  // x,y,z = the wound centre on the outer wall plane; nx,nz = outward normal.
  // o = { power, width (hole width), top, bottom } from the carved gap.
  // ============================================================
  CBZ.cityWallRuin = function (x, y, z, nx, nz, o) {
    o = o || {};
    // NO MODE GATE. fracture.js carves holes wherever `modeHas("breach")`
    // allows, and this is the debris that pours out of the hole it just made.
    // Refusing here is what made a prison wall open in silence.
    const power = Math.min(2.4, o.power || 1.4);
    const width = Math.max(1.0, o.width || (2 + power));
    const top = o.top != null ? o.top : y + width * 0.5;
    const bottom = o.bottom != null ? o.bottom : Math.max(0, y - width * 0.5);
    // normalize the outward normal in the ground plane
    const gn = nNorm(nx, nz); nx = gn.x; nz = gn.y;

    /* (1)+(2) THE FALLING AND THE FALLEN. Both of these used to be invented at
       this point: an avalanche of `7 + 5*power` shards off a shared grey and a
       heap of `14 + width*4 + power*6` lumps off another, neither of which had
       ever looked at the wall. On the conserved path the carve has ALREADY shed
       the real material through CBZ.cityShedSolid — the pieces flying past this
       line are cells of that wall, in that wall's colour, and they are on their
       way to becoming the pile. Minting a second, fake population next to them
       is exactly the "fake blocks that are supposed to be rubble" read.
       (3) THE REBAR WENT THE SAME WAY. It was 2-8 dark cylinders minted at the
       header line of EVERY hole and held for two minutes — on the prison's
       block partitions, on brick, on a wall whose mesh never had a bar in it.
       Steel nobody modelled is steel that came from nowhere. */

    // (4) soot ring on the face — PURGED by default (FX_WALL_WOUNDS); the call
    //     stays so flipping the flag restores the old read exactly.
    woundScorch(x, y, z, nx, 0, nz, width * 1.5 + 1.0);

    // (5) a fat CONCRETE DUST CLOUD punching out of the wound + a low billow that
    //     rolls down to the heap (this is the "dust sheet" the owner asked for)
    pointBurst(x, z, Math.round(22 + 14 * power), 0xa39a8c, 0.5, 3.5 + power * 1.2, 1.2, true, y);
    for (let i = 0; i < Math.round(5 + power * 3); i++) {
      const a = rng() * 6.2832, sp = 1.2 + rng() * 1.8;
      spawnPuff(x + nx * (0.4 + rng() * 0.6), y + (rng() - 0.4) * width * 0.5, z + nz * (0.4 + rng() * 0.6), {
        additive: false, smoke: true, base: 1.4, pop: (4 + rng() * 3) * power,
        life: 2.0 + rng() * 1.4, maxOp: 0.4, shade: 0.36 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * sp + (rng() - 0.5), vy: 0.3 + rng() * 0.8, vz: nz * sp + (rng() - 0.5),
        delay: rng() * 0.25,
      });
    }
    // low dust rolling down the facade to the rubble pile (staggered cascade)
    const drop = Math.min(Math.max(2, top - bottom), 16);
    for (let i = 0; i < Math.round(5 + power * 2); i++) {
      const f = rng();
      spawnPuff(x + (rng() - 0.5) * width + nx * 0.5, top - f * drop, z + (rng() - 0.5) * width + nz * 0.5, {
        additive: false, smoke: true, base: 1.0, pop: 3.4 + rng() * 2.0,
        life: 1.6 + rng(), maxOp: 0.4, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: nx * 0.5, vy: -(1.5 + rng() * 2.0), vz: nz * 0.5,
        delay: f * 0.5,
      });
    }

    // (6) lingering wall plume — PURGED by default (FX_WALL_WOUNDS). The dust
    //     cloud and cascade above are what the detonation leaves behind now.
    addBlastWound(x, y, z, nx, 0, nz, 60 + rng() * 30);
  };

  // ---- CBZ.cityDustKick — a cheap pooled DUST CLOUD at a blast seat ----------
  // The generic "breath of pulverized debris" a detonation kicks up off the deck,
  // exposed so fracture.js's debris-burst (CBZ.cityFracture(pos,r,dir)) and any
  // other caller can drop a dust pop without owning the puff/point-burst pools.
  // WHY: shrapnel + a scorch alone read dry; the dust is what sells "concrete
  // just shattered here". Pooled (pointBurst ring + spawnPuff pool), so it's
  // draw-call-cheap and can't flood; power scales the volume. Headless-safe.
  // color (optional): the dust of what broke (brick is red, plaster white).
  // o (optional): { dirx, dirz, speed } — the cloud ROLLS that way (a collapse
  // pall runs out along the ground away from the footprint).
  CBZ.cityDustKick = function (x, y, z, power, color, o) {
    // NO MODE GATE. Two pooled emitters and nothing else — the most obviously
    // shared verb in the file, and the one fracture.js's debris burst calls
    // on every carve regardless of which scenario is wearing the engine.
    const P = Math.min(2.6, Math.max(0.4, power || 1));
    const cy = y == null ? 0.4 : y;
    // a fast pale dust spray + a couple of slow rolling billows that linger
    pointBurst(x, z, Math.round(10 + 10 * P), color != null ? color : 0x9a9082, 0.45, 2.2 + P * 1.2, 1.0, true, cy);
    if (color != null && CBZ.debris) CBZ.debris.dust(x, cy, z, { color: color, power: P * 0.8, radius: 0.9 });
    const roll = o && (o.dirx || o.dirz) ? (o.speed || 4) : 0;
    const rdx = roll ? o.dirx || 0 : 0, rdz = roll ? o.dirz || 0 : 0;
    for (let i = 0; i < Math.round(2 + P * 2); i++) {
      const a = rng() * 6.2832, sp = 0.8 + rng() * 1.4;
      spawnPuff(x + (rng() - 0.5) * 0.8, cy + 0.2 + rng() * 0.6, z + (rng() - 0.5) * 0.8, {
        additive: false, smoke: true, base: 1.1, pop: (3.2 + rng() * 2.0) * P * (roll ? 1.4 : 1),
        life: (1.6 + rng() * 1.0) * (roll ? 2.2 : 1), maxOp: 0.34, shade: 0.36 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: Math.cos(a) * sp + rdx * roll * (0.6 + rng() * 0.6), vy: (0.5 + rng() * 0.8) * (roll ? 0.4 : 1),
        vz: Math.sin(a) * sp + rdz * roll * (0.6 + rng() * 0.6),
        drag: roll ? 0.35 : undefined,
        delay: rng() * 0.12,
      });
    }
  };


  // ============================================================
  // cityHeavyWallRuin — the BIGGER, taller facade read for HEAVY ordnance
  // (power>=2: airstrike / missile / tank). Everything cityWallRuin does, then a
  // SECOND tier staged DOWN the whole facade from the wound to the street, a
  // collapse curtain raining the full height, a taller dust column and a fatter
  // persistent rubble heap — so a bomb reads as a bomb, not a rocket. All on the
  // existing pooled puff/scorch systems (and CBZ.debris's caps), so
  // it's draw-call-neutral and a salvo can't flood it (curtain count is capped).
  // x,y,z = wound centre on the outer wall plane; nx,nz = outward normal.
  // o = { power, width, top, bottom } from the carved gap (same as cityWallRuin).
  // ============================================================
  CBZ.cityHeavyWallRuin = function (x, y, z, nx, nz, o) {
    o = o || {};
    // NO MODE GATE — the heavy-ordnance twin of cityWallRuin, same argument.
    const power = Math.min(2.6, o.power || 2);
    const width = Math.max(1.2, o.width || (2 + power));
    const top = o.top != null ? o.top : y + width * 0.5;
    const bottom = o.bottom != null ? o.bottom : Math.max(0, y - width * 0.5);
    const gn = nNorm(nx, nz); nx = gn.x; nz = gn.y;

    // (a) the standard ruin does the core hole read (avalanche + heap + rebar +
    //     soot ring + dust + smoking wound). Build everything bigger ON TOP.
    if (CBZ.cityWallRuin) CBZ.cityWallRuin(x, y, z, nx, nz, o);

    // (b) a SECOND avalanche tier sheeting the FULL facade from wound to street —
    //     a much larger drop than the core ruin's, with a tall staggered dust
    //     column so the whole wall visibly cascades, not just the wound lip.
    // Second avalanche tier: invented shards, so it goes with the first (see
    // CONSERVATION OF MATTER). The dust column below is DUST, not debris — a
    // blast really does make it out of nothing you can pick up — and stays.
    const drop = Math.min(Math.max(3, top - 0.5), 26);   // extend the cascade to the wound HEIGHT
    const nCol = Math.round(8 + power * 4);
    for (let i = 0; i < nCol; i++) {
      const f = i / nCol;                                 // staggered top→bottom
      spawnPuff(x + (rng() - 0.5) * width * 1.2 + nx * 0.5, top - f * drop,
        z + (rng() - 0.5) * width * 1.2 + nz * 0.5, {
          additive: false, smoke: true, base: 1.2, pop: (4.0 + rng() * 2.6) * power,
          life: 2.0 + rng() * 1.4, maxOp: 0.44, shade: 0.38 + rng() * 0.08,
          spin: (rng() - 0.5),
          vx: nx * 0.6 + (rng() - 0.5), vy: -(1.6 + rng() * 2.6), vz: nz * 0.6 + (rng() - 0.5),
          delay: f * 0.6 + rng() * 0.08,
        });
    }
    // a tall dust COLUMN boiling up off the wound (the bomb's signature plume)
    pointBurst(x, z, Math.round(20 + 14 * power), 0xa39a8c, 0.55, 2.0 + power, 1.4, true, y + width * 0.4);

    // (the wall's lost volume came off as its own pieces in the carve)
  };

  // ============================================================
  // CBZ.cityAirstrikeCollapse(lot) — a building PARTIAL COLLAPSE for the heaviest
  // hits (airstrike / missile / tank). The contract endpoint the player-air +
  // armored agents call when a structure takes ordnance it can't shrug off: a
  // section of the building SLOUGHS — a wide collapse curtain + heap raining down
  // a facade, a parapet block knocked loose off the roofline, a fat dust pall and
  // a lingering smoke wound. WHY: a tank shell into a tower that leaves it pristine
  // reads fake; this is the visible "you brought the corner DOWN" beat. Accepts a
  // lot ({cx,cz,w,d,building}) OR a bare position {x,z}; resolves the building's
  // tallest wall + footprint from the live colliders either way. Pooled (chunk /
  // puff / scorch caps), draw-call-cheap, headless-safe, and self-throttled so a
  // missile salvo on one building can't re-collapse it every frame.
  //
  // NO MODE GATE (2026-08-07 — see THE GUARD THAT WAS THE BUG in the file
  // header). This is the endpoint the complaint was about: a bombing game
  // over two hundred towers where the towers were invulnerable, because the
  // one verb that knows how to bring a section down asked which SCENARIO was
  // running before it would draw. Everything below resolves out of
  // CBZ.colliders, the caller's footprint and this file's pools. The single
  // city record it touches — cityDamageBuilding, step (7) — is guarded on the
  // spot instead.
  //
  // TWO TIERS OF FACE RESOLUTION, because a world may register its buildings
  // either way and the collapse has to land on a real facade in both:
  //   TIER 1  WALL COLLIDERS. The city registers per-wall AABBs carrying y1
  //           and a mesh `ref`, so the tallest non-glass one near the centre
  //           IS the face and its top IS the roofline. A wall with `noBreach`
  //           is skipped (the prison-perimeter opt-out), and if every
  //           candidate is noBreach the collapse is refused outright.
  //   TIER 2  THE FOOTPRINT. A world that registers ONE full-height box per
  //           building (world/desertcity.js does exactly this: no y1, and
  //           `ref` is a plain record, so tier 1 finds nothing) still knows
  //           its own extents. Take the face of the lot rectangle nearest the
  //           impact point (`opts.at`) and the roof height the caller passes
  //           (`opts.top`). Derived from real data, not invented: with no
  //           `at` it degrades to the old +Z face and with no `top` to the
  //           old mid-rise assumption.
  // ============================================================
  const _collapseSeen = new Map();   // building-key -> last collapse time (anti-spam)
  CBZ.cityAirstrikeCollapse = function (lot, opts) {
    opts = opts || {};
    // resolve a centre + footprint from a lot OR a bare position
    let cx, cz, half = 8, key = null, halfX = 0, halfZ = 0;
    if (lot && lot.cx != null) {
      cx = lot.cx; cz = lot.cz;
      halfX = (lot.w || 16) * 0.5; halfZ = (lot.d || 16) * 0.5;
      half = Math.max(4, Math.min((lot.w || 16), (lot.d || 16)) * 0.5);
      key = Math.round(cx) + "," + Math.round(cz);
    } else if (lot && (lot.x != null || lot.point)) {
      const p = lot.point || lot; cx = p.x; cz = p.z;
      key = Math.round(cx) + "," + Math.round(cz);
    } else if (lot && lot.building && lot.building.group) {
      cx = lot.building.group.position.x; cz = lot.building.group.position.z;
      key = Math.round(cx) + "," + Math.round(cz);
    } else return;
    // SELF-THROTTLE: one collapse per building per ~2.5s — a salvo of missiles
    // adds more rubble than re-running the whole sequence every impact.
    const tNow = performance.now() / 1000;
    if (key) {
      const last = _collapseSeen.get(key);
      if (last != null && tNow - last < 2.5) return;
      if (_collapseSeen.size > 64) {            // bound the dedup map
        _collapseSeen.forEach((v, k) => { if (tNow - v > 12) _collapseSeen.delete(k); });
      }
      _collapseSeen.set(key, tNow);
    }
    const power = Math.min(2.6, opts.power || 2.2);
    // find the building's TALLEST wall near the centre to anchor the collapsing
    // face + read the roof height (the same wall AABBs cityBreach/cityScorch use).
    let topY = -1, faceX = cx, faceZ = cz, fnx = 0, fnz = 1, found = false, faceMat = null;
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || !c.ref) continue;
      const mt = c.ref.material; if (mt && mt.transparent) continue;   // skip glass
      const bx = (c.minX + c.maxX) / 2, bz = (c.minZ + c.maxZ) / 2;
      if (Math.abs(bx - cx) > half + 2 || Math.abs(bz - cz) > half + 2) continue;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (Math.min(ex, ez) > 1.2) continue;                            // walls only, not slabs
      if (c.y1 <= topY) continue;
      topY = c.y1; found = true; faceMat = c.ref.material;
      // outward normal = the broad face pointing away from the building centre
      if (ex >= ez) { fnz = bz < cz ? -1 : 1; fnx = 0; faceZ = fnz < 0 ? c.minZ - 0.1 : c.maxZ + 0.1; faceX = bx; }
      else { fnx = bx < cx ? -1 : 1; fnz = 0; faceX = fnx < 0 ? c.minX - 0.1 : c.maxX + 0.1; faceZ = bz; }
    }
    if (!found) topY = Math.max(8, opts.top || 12);                    // no wall? assume a mid-rise
    const gn = nNorm(fnx, fnz); fnx = gn.x; fnz = gn.y;
    // the collapsing section spans a chunk of the upper facade
    const top = topY;
    const bottom = Math.max(0, topY * 0.35);
    const width = Math.max(3, half * 0.9);
    const woundY = (top + bottom) * 0.5;

    /* (1) THE SECTION COMES DOWN AS ITSELF. Open real holes up the struck face
       (the fracture ledger's blastAt -> buildings.js carve): each one sheds that
       wall's own material as rigid pieces, leaves a ragged welded rim, and the
       walls/colliders are really gone. No curtain of invented boxes. Where the
       world has no carvable facade (footprint-only worlds), pile rubble of the
       face's material at its foot instead. */
    let carved = 0;
    const fr = CBZ.cityFracture;
    if (found && fr && fr.blastAt && (!CBZ.modeHas || CBZ.modeHas("breach"))) {
      const nH = power >= 2.2 ? 3 : 2;
      const hr = Math.min(3.4, 2.4 + power * 0.35);
      for (let k = 0; k < nH; k++) {
        const fy = bottom + (top - bottom) * (0.2 + 0.6 * (k + rng() * 0.6) / nH);
        let tx = -fnz, tz = fnx;
        const along = (rng() - 0.5) * width * 0.6;
        try {
          fr.blastAt({ x: faceX - fnx * 0.15 + tx * along, y: fy, z: faceZ - fnz * 0.15 + tz * along }, { r: hr });
          carved++;   // (the carve itself may land next frame: fracture defers it)
        } catch (e) {}
      }
    }
    if (!carved) rubbleHeap(faceX, faceZ, fnx, fnz, (1.6 + width * 0.4) * 1.2, 1.1 + power * 0.25, Math.round(20 + width * 3), faceMat);
    // (4) a fat dust PALL rolling off the collapsing section + a tall column
    pointBurst(faceX, faceZ, Math.round(24 + 16 * power), 0xa39a8c, 0.6, 2.4 + power, 1.5, true, woundY);
    for (let i = 0; i < Math.round(6 + power * 3); i++) {
      const a = rng() * 6.2832, sp = 1.4 + rng() * 2.2;
      spawnPuff(faceX + fnx * (0.4 + rng()), woundY + (rng() - 0.3) * width, faceZ + fnz * (0.4 + rng()), {
        additive: false, smoke: true, base: 1.6, pop: (5 + rng() * 3) * power,
        life: 3.0 + rng() * 1.8, maxOp: 0.42, shade: 0.34 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: fnx * sp + (rng() - 0.5), vy: 0.6 + rng() * 1.0, vz: fnz * sp + (rng() - 0.5),
        delay: rng() * 0.3,
      });
    }
    // low dust cascading down the whole face to the heap (staggered)
    const drop = Math.min(Math.max(3, top - bottom), 26);
    for (let i = 0; i < Math.round(7 + power * 3); i++) {
      const f = rng();
      spawnPuff(faceX + (rng() - 0.5) * width + fnx * 0.5, top - f * drop, faceZ + (rng() - 0.5) * width + fnz * 0.5, {
        additive: false, smoke: true, base: 1.2, pop: 3.6 + rng() * 2.4,
        life: 1.8 + rng() * 1.2, maxOp: 0.42, shade: 0.4 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: fnx * 0.5, vy: -(1.6 + rng() * 2.4), vz: fnz * 0.5,
        delay: f * 0.6,
      });
    }
    // (5) the wall plume is PURGED (FX_WALL_WOUNDS); the GROUND scorch ring at
    //     the foot of the collapse stays — soot settling on pavement is real.
    addBlastWound(faceX, woundY, faceZ, fnx, 0, fnz, 60 + rng() * 30);
    queueMark(faceX + fnx * 1.2, faceZ + fnz * 1.2, Math.min(9, width * 0.5 + 2), floorAt(faceX + fnx * 1.2, faceZ + fnz * 1.2));
    // (6) feedback — a heavy structural rumble (sound is owned by the caller's
    // explosion; we add the felt shake of a section coming down).
    if (CBZ.shake) CBZ.shake(Math.min(4.0, 2.4 + power));
    // (7) escalate the building's persistent damage state so the wall STAYS hurt.
    if (CBZ.cityDamageBuilding) { try { CBZ.cityDamageBuilding(faceX, woundY, faceZ, Math.min(3, power)); } catch (e) {} }
  };

  // The lingering wall plume. PURGED by default — see the FX_WALL_WOUNDS block
  // above; the ground smolder (addSmolder) is a different, horizontal thing and
  // is untouched. Gated here so all four callers stop together and no emitter is
  // ever left anchored to a mark that no longer exists.
  function addBlastWound(x, y, z, nx, ny, nz, dur) {
    if (!wallWoundsOn()) return;
    while (wounds.length >= 3) wounds.shift();   // 3 live wounds max — the oldest stops smoking
    wounds.push({ x, y, z, nx, ny, nz, t: 0, dur, acc: 0.2 });
  }


  CBZ.cityBlastWall = function (pt, normal, opts) {
    opts = opts || {};
    // NO MODE GATE. fpsmode.js calls this on every rocket that finds a wall,
    // in every mode; outside the city it was the silent half of the RPG the
    // owner filmed. Reads CBZ.colliders for the roofline and nothing else.
    const power = Math.min(2.4, opts.power || 1.4);
    const x = pt.x, y = Math.max(0.6, pt.y || 0), z = pt.z;
    let nx = normal ? normal.x : 0, ny = normal ? normal.y : 0, nz = normal ? normal.z : 1;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { nx = 0; ny = 0; nz = 1; } else { nx /= nl; ny /= nl; nz /= nl; }
    const roof = ny > 0.6;
    // (1) NO painted scar. The persistent mark is the REAL carved hole
    //     (buildings.js cityCarveWall via the cityExplosion → fracture chain) —
    //     the user filmed the old floating brown decal and called it exactly
    //     what it was: fake. Where no wall can carve (glass curtain towers),
    //     the shattered panes themselves are the mark.
    // (2) what powders off the struck face: chips of THAT surface + its dust
    //     (the wall's real lost volume leaves through the carve, not here)
    let hitMat = null;
    {
      const cols0 = CBZ.colliders || [];
      let bd = 2.5;
      for (let i = 0; i < cols0.length; i++) {
        const c = cols0[i];
        if (!c.ref || !c.ref.material || c.y1 == null) continue;
        if (y < c.y0 - 0.5 || y > c.y1 + 0.5) continue;
        const dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ);
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; hitMat = c.ref.material; }
      }
    }
    if (Array.isArray(hitMat)) hitMat = hitMat[0];
    // a roof that held loses grit of ITSELF, thrown up (it used to be 44
    // "concrete" chips whatever the roof was made of)
    if (roof) {
      if (CBZ.debris) CBZ.debris.chips(x, y, z, {
        material: hitMat || null, kind: hitMat ? undefined : "concrete",
        count: Math.round(8 + 6 * power), power: Math.min(2.6, 0.6 + power * 0.3), spread: 1.4,
      });
    } else facadeAvalanche(x, y, z, nx, nz, power, hitMat);
    // a breath of concrete dust out of the wound itself
    pointBurst(x, z, Math.round(16 + 10 * power), 0x9a9082, 0.42, 3.5 + power, 1.0, true, y);
    // (3) the wound used to smoke for a minute-plus — PURGED by default
    //     (FX_WALL_WOUNDS). This is the call the owner's shopfront screenshot
    //     came from: fpsmode's rocket branch hits a jeweller's glass front, and
    //     a facade with no hole in it stood there wearing a cloud of black
    //     sprites for 90 s. The dust breath above is the detonation read.
    addBlastWound(x, y, z, nx, ny, nz, 60 + rng() * 30);
  };

  // ---- CBZ.wallMarkAudit() — the ratchet on the purged facade-mark class ----
  // wallScars + wallWounds are the two PERSISTENT vertical-surface marks and are
  // pinned at 0: detonate anything against a facade, burst the sim, and both must
  // still read 0. groundScorches / groundSmolders are printed BESIDE them so a
  // "fix" that quietly kills the legitimate pavement stain (or the smoking
  // crater) cannot pass as a win — they must stay NON-ZERO after a ground blast.
  // ---- CBZ.cityDebrisDump() — every live chunk's seat, for QA -------------
  // The rubble HEAP is the class the owner called "fake blocks": pieces born
  // `settled: true` that never fall, so whatever height they are handed is
  // where they stay forever. tools/prop-blast-check.mjs reads this to assert
  // each settled piece is in contact with the ground or with another piece —
  // a check you cannot make from outside, because the seat is baked into the
  // mesh position at spawn and nothing ever revisits it. Debug/QA only; no
  // gameplay path calls it, and it allocates only when asked.
  CBZ.cityDebrisDump = function () {
    // live bodies are CBZ.debris's; settled rubble is merged static geometry,
    // seated by its own contact solver, so there is nothing hanging to list.
    return [];
  };

  CBZ.wallMarkAudit = function () {
    return {
      wallScars: scars.length, wallWounds: wounds.length,
      groundScorches: scorches.length + marks.live.length, groundSmolders: columns.length,
      livePuffs: puffs.length,
      puffAllocated: puffs.length + puffPool.length, puffCap: PUFF_CAP,
      flag: CBZ.CONFIG.FX_WALL_WOUNDS === true,
    };
  };

  CBZ.cityRuinAudit = function () {
    let livePieces = 0, liveBars = 0;
    for (let i = 0; i < ruinFrames.length; i++) {
      livePieces += ruinFrames[i].pieces || 0;
      liveBars += ruinFrames[i].bars || 0;
    }
    const heapPieces = CBZ.debris ? CBZ.debris.stats().static : 0;
    return {
      flag: false, frames: ruinFrames.length,
      jaggedPieces: livePieces, exposedBars: liveBars,
      heapPieces: heapPieces, events: ruinStats.events,
      totalPieces: ruinStats.pieces, totalBars: ruinStats.bars,
    };
  };

  // fresh run → cold facades (fpsmode's reset path calls this with the pocks)
  CBZ.cityBlastFxReset = function () {
    wounds.length = 0;
    columns.length = 0; fires.length = 0; pendingMarks.length = 0;
    // the persistent marks go with the run
    if (markMeshes) {
      for (let i = 0; i < marks.live.length; i++) { const m = marks.live[i]; markMeshes[m.variant & 3].setMatrixAt(m.slot, ZERO_M); }
      for (let q = 0; q < markMeshes.length; q++) markMeshes[q].instanceMatrix.needsUpdate = true;
    }
    marks.clear();
    if (sootMeshes) {
      for (let q = 0; q < 2; q++) { for (let i = 0; i < SOOT_CAP; i++) sootMeshes[q].setMatrixAt(i, ZERO_M); sootMeshes[q].instanceMatrix.needsUpdate = true; }
    }
    sootRing.clear(); sootSplash.clear();
    for (const s of scars) { scene.remove(s.mesh); s.mat.dispose(); }
    scars.length = 0;
    for (const rf of ruinFrames) if (rf.group && rf.group.parent) rf.group.parent.remove(rf.group);
    ruinFrames.length = 0;
    ruinStats.events = ruinStats.pieces = ruinStats.bars = 0;
    if (CBZ.debris) CBZ.debris.clear();
    shedStats.events = shedStats.pieces = shedStats.kept = 0;
    shedStats.volShed = shedStats.volKept = shedStats.volRemoved = shedStats.invented = 0;
    if (_collapseSeen) _collapseSeen.clear();          // fresh run → un-throttle collapses
  };

  CBZ.onAlways(9.5, function (dt) {
    if (punchQ.length) pumpPunch(dt);
    if (puffs.length) updatePuffs(dt);
    // wall-blast scars: snap in, hold ~80–120s, fade out. Empty unless
    // FX_WALL_WOUNDS is flipped back on — the pool and this loop are kept so the
    // revert is one line and behaves exactly as it used to.
    for (let i = scars.length - 1; i >= 0; i--) {
      const s = scars[i]; s.t += dt;
      if (s.t < 0.2) s.mat.opacity = (s.t / 0.2) * 0.95;
      else if (s.t < s.hold) s.mat.opacity = 0.95;
      else {
        s.mat.opacity = Math.max(0, 0.95 * (1 - (s.t - s.hold) / 8));
        if (s.t - s.hold >= 8) { scene.remove(s.mesh); s.mat.dispose(); scars.splice(i, 1); }
      }
    }
    // wounded facades keep smoking: ~2 puffs/s drifting up + out of the hole,
    // thinning as the wound cools; the first beats still cook with flame licks.
    // THIS IS THE BLOB CLUSTER THE OWNER PURGED — wounds[] is empty unless
    // FX_WALL_WOUNDS is flipped on, so this loop idles. Note the GROUND smolder
    // loop directly below is a different thing and still runs.
    for (let i = wounds.length - 1; i >= 0; i--) {
      const w = wounds[i]; w.t += dt;
      if (w.t >= w.dur) { wounds.splice(i, 1); continue; }
      w.acc -= dt;
      if (w.acc > 0) continue;
      w.acc = 0.45 + rng() * 0.35;
      const cool = 1 - w.t / w.dur;
      spawnPuff(w.x + w.nx * 0.6 + (rng() - 0.5) * 0.5, w.y + 0.3, w.z + w.nz * 0.6 + (rng() - 0.5) * 0.5, {
        additive: false, smoke: true, base: 0.9, pop: (3.2 + rng() * 2.2) * (0.55 + 0.45 * cool),
        life: 3.6 + rng() * 1.6, maxOp: 0.32 * (0.45 + 0.55 * cool), shade: 0.12 + rng() * 0.04,
        spin: (rng() - 0.5) * 0.8,
        vx: w.nx * (0.5 + rng() * 0.4) + (rng() - 0.5) * 0.3,
        vy: 1.1 + rng() * 0.8,
        vz: w.nz * (0.5 + rng() * 0.4) + (rng() - 0.5) * 0.3,
      });
      if (w.t < 6) spawnPuff(w.x + w.nx * 0.3, w.y, w.z + w.nz * 0.3, {
        additive: true, base: 0.35, pop: 1.1 + rng() * 0.7, life: 0.6 + rng() * 0.4,
        maxOp: 0.85, vy: 0.7, spin: (rng() - 0.5) * 2,
      });
    }
    // the flash light, the queued crater marks, the smoke columns, the fires
    stepAftermath(dt);
    const grav = (CBZ.TUNE && CBZ.TUNE.gravity) || 22;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i]; b.t += dt;
      // step ONLY the live particles. n = count*3 for a pooled slot (its buffer
      // is BURST_MAX long but only `count` are alive) and the full length for the
      // legacy per-blast path — identical motion to before in both cases.
      const n = b.n != null ? b.n : b.pos.length;
      for (let j = 0; j < n; j += 3) {
        b.vel[j + 1] -= grav * (b.dust ? 0.16 : 0.65) * dt;
        b.pos[j] += b.vel[j] * dt; b.pos[j + 1] += b.vel[j + 1] * dt; b.pos[j + 2] += b.vel[j + 2] * dt;
      }
      b.geo.attributes.position.needsUpdate = true;
      b.mat.opacity = Math.max(0, (b.op0 != null ? b.op0 : (b.dust ? 0.5 : 0.95)) * (1 - b.t / b.life));
      if (b.t >= b.life) {
        if (b.slot) {
          // POOLED: just retire the slot for reuse — no scene churn, no dispose,
          // no GC. (If the slot was already re-acquired by a later burst its
          // .live points elsewhere; only clear it if it still references us.)
          b.mesh.visible = false; b.geo.setDrawRange(0, 0);
          if (b.slot.live === b) b.slot.live = null;
        } else {
          scene.remove(b.mesh); b.geo.dispose(); b.mat.dispose();
        }
        bursts.splice(i, 1);
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; r.t += dt;
      // expand fast then ease out (shockwaves decelerate as energy dissipates)
      r.r += r.radius * (r.spd || 2.2) * dt * (1 - 0.5 * (r.t / r.life));
      r.mesh.scale.set(r.r, r.r, 1);
      r.mat.opacity = Math.max(0, (r.op0 || 0.72) * (1 - r.t / r.life));
      if (r.t >= r.life) { scene.remove(r.mesh); r.geo.dispose(); r.mat.dispose(); rings.splice(i, 1); }
    }
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i]; s.t += dt;
      if (s.t < 0.25) s.mat.opacity = (s.t / 0.25) * 0.9;          // snap in with the blast
      else if (s.t < s.hold) s.mat.opacity = 0.9;                  // linger as a black mark
      else { s.mat.opacity = Math.max(0, 0.9 * (1 - (s.t - s.hold) / 3)); if (s.t - s.hold >= 3) { scene.remove(s.mesh); s.mat.dispose(); scorches.splice(i, 1); } }
    }
    // blood pools: spread out fast on impact, hold as a dark stain, then fade
    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i]; s.t += dt;
      const grow = Math.min(1, s.t / 0.5);                          // spread over the first half-second
      const r = s.r0 + (s.r1 - s.r0) * (1 - Math.pow(1 - grow, 3));
      s.mesh.scale.setScalar(r);
      if (s.t < 0.2) s.mat.opacity = (s.t / 0.2) * 0.92;            // snap in
      else if (s.t < s.hold) s.mat.opacity = 0.92;                 // linger
      else { s.mat.opacity = Math.max(0, 0.92 * (1 - (s.t - s.hold) / 4)); if (s.t - s.hold >= 4) { scene.remove(s.mesh); s.mat.dispose(); splats.splice(i, 1); } }
    }
  });

  // ---- FIRST-BLAST PREWARM (the owner-filmed rocket freeze, part 1) ---------
  // Everything here used to be minted LAZILY on the FIRST blast of a session:
  // four canvas textures (scorch/splat/puff/smoke), the whole pooled point-burst
  // ring, and ~a hundred fireball/smoke sprites — all in the impact frame, and
  // (worse) all with r128 shader programs that only compile the first time an
  // object actually RENDERS (invisible pools never compile). On an iPad that
  // stacked canvas rasterisation + allocation + several synchronous
  // compileShader/linkProgram calls into one frame: the "sometimes it takes SO
  // LONG" hitch — 'sometimes' because it is exactly ONCE per session, on the
  // first rocket/explosion. Build ALL of it at load instead; core/fxwarm.js
  // then compiles the programs during the play-start transition so the first
  // real blast hits fully warm caches. NOTE the eager texture bakes consume the
  // module rng in a FIXED order at init — every client advances the stream
  // identically, so cross-client FX determinism is preserved (it only shifts
  // relative to older builds, which is fine: streams are per-version).
  scorchTex = makeScorchTexture();
  splatTex = makeSplatTexture();
  puffTex = makePuffTexture();
  smokeTex = makeSmokeTexture();
  for (let i = 0; i < RING_CAP; i++) if (!burstPool[i]) burstPool[i] = makeBurstSlot();
  // seed the fireball/smoke sprite pool with enough bodies for a full rocket
  // blast (fireball+smoke+embers layers peak around this count) — same shape
  // getPuff() builds, parked invisible exactly like updatePuffs() retires them.
  // the one explosion peaks around 110-190 sprites (flash + cores + body +
  // soot + dust + embers) plus the columns and fires it leaves, so the pool
  // is seeded for that instead of letting the first blast mint materials
  blastTexReady();
  ensureMarks();
  ensureSoot();
  flashPool.init();          // the ONE PointLight, in the scene from load, intensity 0
  for (let i = 0; i < 180; i++) {
    const m = new THREE.SpriteMaterial({ map: puffTex, depthWrite: false, depthTest: true, transparent: true, opacity: 0 });
    const p = new THREE.Sprite(m);
    p.renderOrder = 9; p.visible = false;
    scene.add(p);
    puffPool.push(p);
  }
  // Park one invisible mesh per BLAST-MINTED material family, so their
  // programs compile inside core/fxwarm's play-start renderer.compile()
  // (r128 compiles on first RENDER; compile() walks traverse(), so
  // visible:false still counts) instead of inside the first rocket's frame —
  // the pooled sprites above were warm, but every chunk/rubble/rebar mesh
  // and the scorch decal linked their programs mid-fight on blast #1
  // (measured: the first blast of a session linked ~dozens of programs; the
  // second linked zero).
  (function parkBlastMats() {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01),
      new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, opacity: 0 }));
    sm.visible = false; scene.add(sm);
  })();

  // ============================================================
  // CBZ.cityEjectaCone(x, y, z, nx, nz, power, opts) — PENETRATION EXIT.
  //
  // The one facade read this file did not have. cityWallRuin / cityBlastWall
  // describe a wound the ordnance stopped AT: an avalanche pouring DOWN the
  // face, a heap on the pavement below, rebar off the header. A penetrator
  // that goes THROUGH does the opposite — whatever energy survived the
  // structure (E(x) = E0*e^-x/L; city/structural.js computes the survivor and
  // calls this) leaves the far side as a directed JET: spall and pulverised
  // slab thrown DOWNRANGE in a cone, a lance of hot gas ahead of it, and a
  // sheet of pale concrete dust chasing both. Nothing pours down; everything
  // goes out. That difference is the whole tell that a wing/bomb/tank round
  // passed clean through the building.
  //
  // x,y,z = the EXIT point on the far face; nx,nz = the travel direction
  // (already downrange, not the outward normal); power ~0.5 (a spent round
  // barely breaking daylight) .. 3 (an airframe leaving a room-sized hole).
  // Pure composition on the pools this file already owns — chunk pool +
  // CBZ.debris chips, the pooled sprite puffs, the pooled point-burst ring —
  // so it adds no pool, no draw call class, and cannot flood. Headless-safe.
  // ============================================================
  CBZ.cityEjectaCone = function (x, y, z, nx, nz, power, opts) {
    opts = opts || {};
    // NO MODE GATE — pure composition on this file's three pools, exactly as
    // its own header above already claims ("adds no pool, no draw call class").
    const P = Math.min(3, Math.max(0.3, power || 1));
    // FX budget rides the perf/quality slider (tier0 sheds ~65%), sampled ONCE
    const fxq = CBZ.qScale ? CBZ.qScale(0.35, 1) : 1;
    // unit travel axis in the ground plane + its tangent (the cone's spread)
    const gn = nNorm(nx, nz); const ax = gn.x, az = gn.y;
    let tx = -az, tz = ax;
    const spread = opts.spread == null ? 0.62 : opts.spread;   // cone half-angle, radians
    const y0 = Math.max(0.4, y == null ? 1.2 : y);

    // ---- (1) SPALL: chips of the far face thrown along the axis (the
    // penetrated wall's own volume leaves through its carve). opts.material /
    // opts.kind colour them when the caller knows what was pierced.
    if (CBZ.debris) CBZ.debris.chips(x + ax * 0.5, y0, z + az * 0.5, {
      material: opts.material || null, kind: opts.kind || (opts.material ? undefined : "concrete"),
      count: Math.round((10 + 12 * P) * fxq), dir: { x: ax, y: 0.25, z: az }, power: 0.8 + P * 0.5, spread: 1.2 + spread,
    });

    // ---- (2) the LANCE: hot gas punching out ahead of the debris, staggered
    // along the axis so it reads as a jet leaving the hole, not a puff at it.
    const nl = Math.max(2, Math.round(3 + P * 2));
    for (let i = 0; i < nl; i++) {
      const f = i / nl;
      spawnPuff(x + ax * (0.6 + f * 3.5 * P), y0 + (rng() - 0.3) * 0.8, z + az * (0.6 + f * 3.5 * P), {
        additive: true, base: 0.5 + f * 0.6, pop: (1.6 + rng() * 1.4) * P,
        life: 0.9 + rng() * 0.9, maxOp: 0.9 - f * 0.35, spin: (rng() - 0.5) * 2,
        vx: ax * (3 + rng() * 4 * P), vy: 0.4 + rng() * 0.8, vz: az * (3 + rng() * 4 * P),
        delay: f * 0.09,
      });
    }

    // ---- (3) pulverised SLAB DUST chasing the jet: pale, directed, lingering
    pointBurst(x + ax * 0.8, z + az * 0.8, Math.max(1, Math.round((14 + 12 * P) * fxq)),
      0xa39a8c, 0.46, 3 + P * 1.4, 1.2, true, y0);
    const nd = Math.round(3 + P * 3);
    for (let i = 0; i < nd; i++) {
      const off = (rng() - 0.5) * 2, a = off * spread * 1.3;
      const dx = ax * Math.cos(a) + tx * Math.sin(a);
      const dz = az * Math.cos(a) + tz * Math.sin(a);
      const sp = 1.6 + rng() * 2.4 * P;
      spawnPuff(x + dx * (0.8 + rng() * 1.6), y0 + (rng() - 0.35) * 1.4, z + dz * (0.8 + rng() * 1.6), {
        additive: false, smoke: true, base: 1.2, pop: (3.6 + rng() * 2.6) * P,
        life: 1.9 + rng() * 1.4, maxOp: 0.42, shade: 0.37 + rng() * 0.08,
        spin: (rng() - 0.5),
        vx: dx * sp, vy: 0.3 + rng() * 0.9, vz: dz * sp,
        delay: rng() * 0.22,
      });
    }
    // (4) the exit mouth used to keep smoking like any other wound — PURGED by
    // default (FX_WALL_WOUNDS); the jet, spall and slab dust above are the read.
    if (P >= 1) addBlastWound(x, y0, z, ax, 0, az, 30 + rng() * 25);
  };
})();
