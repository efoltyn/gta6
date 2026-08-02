/* ============================================================
   systems/tornado.js — CBZ.tornado, THE CITY VORTEX.

   OWNER ASK: "tornadoes that hit buildings."

   WHAT WAS THERE BEFORE: exactly one funnel, in systems/disasters.js, which
   (a) only existed inside survival mode's separate arena, (b) was six
   translucent cylinders and a swirl particle cloud, and (c) damaged ACTORS
   ONLY — it could not touch a building, a car, a prop or the terrain. A
   tornado that cannot wreck the city is a weather decal.

   This file is the real one, and per THE BLOCK LAW the survival funnel MOVED
   onto it in the same change (systems/disasters.js's `tornado` def is now ~15
   lines that call CBZ.tornado.spawn/stop and read CBZ.tornado.threat). There
   is no second implementation left. CBZ.tornadoAudit() is the ratchet.

   ------------------------------------------------------------------
   THE MODEL — a RANKINE COMBINED VORTEX. Analytic, ~20 flops, no solver.

     tangential   vt(r) = vmax * r/R      inside the core radius R
                  vt(r) = vmax * R/r      outside it (free-vortex tail)
     radial       vr(r) = -0.5 * vt(r)    inflow, pointing at the axis
     vertical      w(r) = wmax * exp(-((r - 0.6R)/0.7R)^2)
                                          updraft, peaked in the core annulus

   The spiral is the whole point. Pure tangential wind makes debris circle
   forever; tangential + inflow + updraft makes it corkscrew IN and UP, which
   is what a tornado visibly does to a car. The funnel's own FORWARD velocity
   is added to the field, so the right-hand side of a northbound tornado is
   genuinely stronger than the left — the single most-cited real asymmetry.

   THE EF SCALE drives everything else (NWS 3-second-gust bands):
     EF0 29-38 m/s   shingles, gutters              -> SCARRED
     EF1 38-49       roofs stripped, windows out    -> WOUNDED
     EF2 50-60       roofs gone, weak walls fail    -> CRITICAL, cars lifted
     EF3 61-74       whole storeys destroyed        -> shops COLLAPSE
     EF4 74-89       structures levelled            -> blocks COLLAPSE
     EF5 >89         swept clean off the foundation -> towers COLLAPSE
   Core radius 26-140 m, forward speed 11-19 m/s, path length a kilometre-plus.

   ROOF-FIRST IS THE SIGNATURE. A bomb wrecks a building from the outside in
   at the height it went off. A tornado wrecks it from the TOP DOWN: it takes
   the roof, then the top storey, then the next. So every structural hit this
   file makes is SEATED AT THE HIGHEST FLOOR THAT IS STILL INTACT — read back
   from city/structural.js's own per-floor integrity array through its public
   state() seam, never from a private mirror. As the top floors fail the seat
   walks down the building on its own. That is what makes a tornado read
   differently from an airstrike even though both drive the same ledger.

   ------------------------------------------------------------------
   WHAT THIS FILE REUSES (i.e. what it deliberately did NOT write):
     buildings      CBZ.structure.hit(...{kind:"tornado"})   — the ONE ledger
     debris strikes CBZ.detonate(x,y,z,"kinetic",{mass,speed}) — the ONE bus,
                    which prices E=1/2mv^2 itself (cube root for FX, 2/3 power
                    for structural). A thrown car into a facade is ONE call.
     deaths         CBZ.cityKillPed / cityCrowdCircleKill / cityHurtPlayer.
                    The killfeed is the only sanctioned popup; we toast nothing.
     panic/police   CBZ.cityPostEvent — buys crowd flee + police reaction free.
     street props   CBZ.cityShootProp — the existing public "something passed
                    through here" verb; bins, cones, meters and newsboxes tip
                    over and propane tanks cook off with zero new code.
     glass          CBZ.cityShatter (idempotent per pane, so overlap is free)
     particles      cityDustKick / cityChunk / cityCrashSmoke — ALL pooled and
                    capped already. THIS FILE ADDS NO NEW PARTICLE POOL.
     vehicles       CBZ.cityDamageCar / cityCarIgnite, and the existing
                    `c.ai` gate in city/vehicles.js's updater is how we take
                    ownership of a lifted car without a second car controller.
     budget         CBZ.qScale(lo, hi) — every count in this file.

   THE ONE GENUINELY NEW DRAW is the funnel: a stack of open, leaning,
   counter-rotating cylinder shells on a scrolling procedural CanvasTexture,
   a wider dust skirt at the base, and a handful of orbiting debris boxes.
   One THREE.Group, disposed whole.

   FLAGS: TORNADO_CITY (master) · TORNADO_STRUCTURAL (buildings) ·
          TORNADO_LIFT (cars/debris carried and thrown).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  if (CBZ.tornado) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // TORNADO_CITY — the owner's ask: "tornadoes that hit buildings". ON => a
  // city-level vortex exists at all (CBZ.tornado.spawn does something).
  // Flip false (or ?cfg_TORNADO_CITY=0) and spawn() returns null, the survival
  // roster's funnel degrades to nothing, and the game plays exactly as it did
  // before this file — a one-line revert of the entire feature.
  if (CBZ.CONFIG.TORNADO_CITY == null) CBZ.CONFIG.TORNADO_CITY = true;
  // TORNADO_STRUCTURAL — ON => the funnel grinds buildings through
  // city/structural.js (roof-first) and can genuinely fell them.
  // Flip false to keep the spectacle, the deaths and the thrown cars while
  // leaving the skyline untouched (the pre-consolidation behaviour).
  if (CBZ.CONFIG.TORNADO_STRUCTURAL == null) CBZ.CONFIG.TORNADO_STRUCTURAL = true;
  // TORNADO_LIFT — ON => vehicles are picked up, orbited and thrown, and the
  // landing is a `kinetic` detonation. Flip false and cars are only shoved
  // along the ground (cheapest path; nothing is ever taken off its wheels).
  if (CBZ.CONFIG.TORNADO_LIFT == null) CBZ.CONFIG.TORNADO_LIFT = true;
  // How many funnels may exist at once. The brief caps this at 1 (2 absolute
  // max) because every world query below is per-vortex; two doubles them.
  if (CBZ.CONFIG.TORNADO_MAX == null) CBZ.CONFIG.TORNADO_MAX = 1;

  const T = (CBZ.tornado = {});

  /* ============================================================
     THE EF TABLE. vmax = 3-second gust in m/s at the core radius R (metres).
     These are the NWS bands' midpoints, not invented numbers; everything else
     in the file is derived from them so re-tuning a class is one row.
     ============================================================ */
  const EF = [
    { vmax: 33,  R: 26,  fwd: 11.0, life: 40 },   // EF0
    { vmax: 43,  R: 38,  fwd: 12.6, life: 52 },   // EF1
    { vmax: 55,  R: 52,  fwd: 14.2, life: 64 },   // EF2
    { vmax: 67,  R: 72,  fwd: 15.8, life: 78 },   // EF3
    { vmax: 81,  R: 100, fwd: 17.4, life: 94 },   // EF4
    { vmax: 100, R: 140, fwd: 19.0, life: 112 },  // EF5
  ];
  // Beyond OUTER_MUL * R the free-vortex tail is faded to nothing, so every
  // world query in this file has a hard, small bound instead of the 1/r tail's
  // infinite reach. 4.5 core radii is ~120 m for an EF1 and ~630 m for an EF5.
  const OUTER_MUL = 4.5;
  // The DAMAGE PATH is narrower than the wind field: real EF-rated damage
  // tracks roughly the core, not the inflow. 1.25 R.
  const DAMAGE_MUL = 1.25;
  // Updraft as a fraction of peak tangential speed (observed 0.3-0.6).
  const LIFT_MUL = 0.45;
  // A car comes off the ground at ~EF2 gusts — the EF2 damage indicator is
  // literally "cars lifted off ground". Below this nothing is ever airborne.
  const LIFT_MIN_SPEED = 42;

  /* ------------------------------------------------------------------
     THE EF -> DAMAGE CALIBRATION (the number that decides the whole feel).

     THE DRIVER IS NOT WIND SPEED. What a facade actually feels is DYNAMIC
     PRESSURE, q = 0.5 * rho * v^2 (rho = 1.225 kg/m^3 at sea level):

       EF0  667 Pa    EF1 1132 Pa    EF2 1853 Pa
       EF3 2750 Pa    EF4 4019 Pa    EF5 6125 Pa

     and what a facade actually LOSES per second is the aerodynamic POWER
     FLUX carried past it — work rate = force x velocity, i.e.

       P = q * v = 0.5 * rho * v^3     watts per square metre

     the same v^3 law wind engineering uses for everything from turbine yield
     to debris-generation rate. Using q alone (v^2) makes EF5 only 9x EF0,
     which cannot reproduce the published damage descriptors; using power flux
     gives 27.8x, which does. So DPS = DPS0 * (v/33)^3, and `pressure` is
     published on the field query below for anyone who wants the force rather
     than the damage rate.

     IT IS A SUSTAINED LOAD, NOT A STRIKE. Every hit below is a small
     continuous DPS bite with NO `sudden` flag: the dynamic-amplification
     bonus city/structural.js gives an impulsive strike is exactly wrong for a
     tornado, which grinds a building down over seconds rather than flicking
     it over. That difference is most of why this reads as weather.

     city/structural.js sizes a building at `12 + storeys*7 + (w*d)/26`:
       corner shop      ~23      4-storey block   ~55      11-storey  ~110

     Effective full-strength dwell (path width 2*1.25R divided by forward
     speed, halved for the 1-r/R falloff) is ~3.0 s at EF0 rising to ~9.2 s at
     EF5 — the wider classes linger as well as hit harder, which is the second
     half of why the ladder is so steep. At DPS0 = 0.85 that lands:

       EF0 -> shop frac 0.11   SCARRED    shingles, gutters             ✓
       EF1 -> shop frac 0.31   WOUNDED    roof stripped, windows out    ✓
       EF2 -> shop frac 0.79   CRITICAL   roof gone, weak walls fail    ✓
       EF3 -> shop COLLAPSES (1.76), 4-storey block CRITICAL (0.74)     ✓
       EF4 -> shop + block COLLAPSE, 11-storey CRITICAL (0.82)          ✓
       EF5 -> the 11-storey goes too (1.97): swept clean                ✓

     which is the published EF damage description, level for level. DPS0 is
     therefore the single tuning knob for "how many seconds is a building".
  ------------------------------------------------------------------ */
  const AIR_RHO = 1.225;                       // kg/m^3 — sea-level air
  const DPS0 = 0.85;

  /* ============================================================
     STATE. `live` is capped at CONFIG.TORNADO_MAX (1). Everything else is
     per-vortex and bounded by the caps in the perf block further down.
     ============================================================ */
  const live = [];
  let idSeq = 0;
  let rngStream = null;
  function rng() {
    if (!rngStream) rngStream = CBZ.seedStream ? CBZ.seedStream("tornado") : function () { return 0.5; };
    return rngStream();
  }

  function arenaRoot() {
    const g = CBZ.game;
    if (g && g.mode === "city" && CBZ.city && CBZ.city.arena && CBZ.city.arena.root) return CBZ.city.arena.root;
    if (g && g.mode === "survival" && CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) return CBZ.surv.arena.root;
    return CBZ.scene || null;
  }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function floorAt(x, z) { return CBZ.floorAt ? (+CBZ.floorAt(x, z) || 0) : 0; }
  function camDist(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    return c ? Math.hypot(x - c.x, z - c.z) : 0;
  }

  /* ============================================================
     THE FUNNEL MESH — the one new draw.

     A stack of OPEN cylinder shells (r128: CylinderGeometry(rTop, rBot, h,
     radial, height, openEnded)) whose radius grows with height, each leaning
     a little off the axis so the column visibly bends the way real funnels
     do, all sharing two scrolling CanvasTexture materials (inner column and
     outer veil) so the whole thing costs two draw states, not N.

     Everything rides CBZ.qScale: at tier 0 it is 4 rings and 3 debris boxes,
     at tier 4 it is 9 rings and 10. The texture is built ONCE for the module
     and never disposed; the geometries and the two per-funnel materials are.
     ============================================================ */
  let funnelTex = null;
  function funnelTexture() {
    if (funnelTex) return funnelTex;
    const c = document.createElement("canvas");
    c.width = 64; c.height = 256;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 64, 256);
    // DETERMINISTIC streaks (materials.js's concreteTex pattern — a fixed
    // arithmetic sequence, never Math.random, so texture generation is
    // reproducible and two clients build byte-identical funnels).
    for (let i = 0; i < 220; i++) {
      const x = (i * 53) % 64;
      const y = (i * 97) % 256;
      const h = 12 + ((i * 29) % 46);
      const a = 0.10 + ((i * 37) % 45) / 260;
      g.fillStyle = "rgba(214,210,200," + a.toFixed(3) + ")";
      g.fillRect(x, y, 1 + (i % 3), h);
    }
    // a few darker debris ropes so the column is not uniform grey
    for (let i = 0; i < 40; i++) {
      const x = (i * 41) % 64;
      const y = (i * 61) % 256;
      g.fillStyle = "rgba(58,54,48,0.30)";
      g.fillRect(x, y, 2, 26 + ((i * 17) % 40));
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    funnelTex = t;
    return t;
  }

  let debrisGeo = null;
  function debrisGeometry() {
    if (!debrisGeo) debrisGeo = new THREE.BoxGeometry(1.15, 0.5, 0.8);
    return debrisGeo;                            // module-shared: never disposed
  }

  function buildFunnel(t) {
    const root = arenaRoot();
    if (!root) return;
    const grp = new THREE.Group();
    // MOVES EVERY FRAME: core/batch.js and core/farcull.js both refuse to
    // touch anything under a userData.dynamic node. Without this the batcher
    // would happily freeze the funnel into a static merged buffer.
    grp.userData.dynamic = true;
    grp.name = "tornado-funnel";

    const nRing = Math.max(3, Math.round(CBZ.qScale ? CBZ.qScale(4, 9) : 7));
    const H = Math.max(55, Math.min(260, t.R * 2.4));
    const rBase = t.R * 0.45, rTop = t.R * 1.5;
    const tex = funnelTexture();
    // Two materials: the dense inner column and a translucent outer veil that
    // scrolls at a different rate. Parallax for the price of one extra state.
    // Both take a CLONE of the module texture — the canvas image is shared
    // (one upload) but offset/repeat are per-funnel, so animating one funnel's
    // scroll can never drag the other's (the cap is 2) or leave the module
    // texture permanently mutated after every funnel is gone.
    const texIn = tex.clone(), texOut = tex.clone();
    texIn.wrapS = texIn.wrapT = texOut.wrapS = texOut.wrapT = THREE.RepeatWrapping;
    texIn.needsUpdate = texOut.needsUpdate = true;
    texIn.repeat.set(3, 1);
    texOut.repeat.set(2, 1);
    const matIn = new THREE.MeshBasicMaterial({
      map: texIn, color: 0x6d6f74, transparent: true, opacity: 0.62,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const matOut = new THREE.MeshBasicMaterial({
      map: texOut, color: 0x8e9096, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false,
    });

    const rings = [];
    const seg = Math.max(8, Math.round(CBZ.qScale ? CBZ.qScale(9, 16) : 14));
    for (let i = 0; i < nRing; i++) {
      const k0 = i / nRing, k1 = (i + 1) / nRing;
      const h = H / nRing;
      const r0 = rBase + (rTop - rBase) * Math.pow(k0, 0.72);
      const r1 = rBase + (rTop - rBase) * Math.pow(k1, 0.72);
      const geo = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true);
      const m = new THREE.Mesh(geo, i === nRing - 1 ? matOut : matIn);
      m.position.set(Math.sin(i * 0.8) * t.R * 0.13, h * (i + 0.5), Math.cos(i * 0.62) * t.R * 0.11);
      m.rotation.z = Math.sin(i * 0.8) * 0.07;
      m.castShadow = false; m.receiveShadow = false;
      m.renderOrder = 3;
      grp.add(m);
      rings.push({ mesh: m, spin: 1.0 + i * 0.16 });
    }
    // the DEBRIS BALL at the base — the visual tell. One wide, short, very
    // translucent shell of the outer material.
    const skirtGeo = new THREE.CylinderGeometry(t.R * 1.15, t.R * 1.45, Math.max(6, t.R * 0.30), seg, 1, true);
    const skirt = new THREE.Mesh(skirtGeo, matOut);
    skirt.position.y = Math.max(3, t.R * 0.15);
    skirt.castShadow = skirt.receiveShadow = false;
    skirt.renderOrder = 3;
    grp.add(skirt);

    // orbiting debris — the "flung junk in the column" read, as real meshes
    // rather than a particle system, so it costs a fixed handful of draws.
    const nDeb = Math.max(2, Math.round(CBZ.qScale ? CBZ.qScale(3, 10) : 7));
    const dgeo = debrisGeometry();
    const dmat = CBZ.cmat ? CBZ.cmat(0x5b5347) : new THREE.MeshLambertMaterial({ color: 0x5b5347 });
    const debris = [];
    for (let i = 0; i < nDeb; i++) {
      const m = new THREE.Mesh(dgeo, dmat);
      m.castShadow = false; m.receiveShadow = false;
      grp.add(m);
      debris.push({
        mesh: m,
        rad: t.R * (0.5 + (i % 4) * 0.22),
        y: 4 + (i * H) / (nDeb + 1),
        ang: (i * 2.399),                         // golden-angle spread
        rate: 1.5 + (i % 3) * 0.5,
        sc: 0.7 + (i % 5) * 0.35,
      });
    }

    grp.position.set(t.x, floorAt(t.x, t.z), t.z);
    root.add(grp);
    t.mesh = { grp: grp, rings: rings, skirt: skirt, debris: debris, matIn: matIn, matOut: matOut, H: H };
  }

  function disposeFunnel(t) {
    const M = t.mesh;
    if (!M) return;
    try {
      if (M.grp.parent) M.grp.parent.remove(M.grp);
      // ONLY the geometries this funnel created; the debris boxes share the
      // module geometry and CBZ.cmat's _shared material — never dispose those.
      for (const r of M.rings) if (r.mesh.geometry) r.mesh.geometry.dispose();
      if (M.skirt.geometry) M.skirt.geometry.dispose();
      if (M.matIn.map && M.matIn.map !== funnelTex) M.matIn.map.dispose();
      if (M.matOut.map && M.matOut.map !== funnelTex) M.matOut.map.dispose();
      M.matIn.dispose(); M.matOut.dispose();
    } catch (e) {}
    t.mesh = null;
  }

  function animateFunnel(t, dt) {
    const M = t.mesh;
    if (!M) return;
    const gy = floorAt(t.x, t.z);
    M.grp.position.set(t.x, gy, t.z);
    // the whole column turns; each ring adds its own differential so the
    // funnel visibly shears with height instead of spinning as one solid.
    const base = (t.vmax / Math.max(1, t.R)) * 0.55;
    t.spin = (t.spin || 0) + base * dt;
    M.grp.rotation.y = t.spin;
    for (let i = 0; i < M.rings.length; i++) M.rings[i].mesh.rotation.y += base * M.rings[i].spin * dt;
    M.skirt.rotation.y -= base * 0.7 * dt;
    // scrolling texture = the sense of material rushing UP the column
    const sc = 0.55 * dt * (t.vmax / 60);
    if (M.matIn.map) M.matIn.map.offset.y -= sc;
    if (M.matOut.map) M.matOut.map.offset.y -= sc * 0.62;
    // orbiting debris corkscrews up, wraps at the top
    for (let i = 0; i < M.debris.length; i++) {
      const d = M.debris[i];
      d.ang += d.rate * dt * (t.vmax / 55);
      d.y += (t.wmax * 0.22) * dt;
      if (d.y > M.H) d.y = 3;
      const m = d.mesh;
      m.position.set(Math.cos(d.ang) * d.rad, d.y, Math.sin(d.ang) * d.rad);
      m.rotation.y = -d.ang * 2.4;
      m.rotation.x += dt * 4.5;
      m.scale.setScalar(d.sc);
    }
    // fade the whole thing in over the first second and out over the last
    const k = Math.min(1, t.age / 1.0) * Math.min(1, Math.max(0, t.life - t.age) / 1.6);
    M.matIn.opacity = 0.62 * k;
    M.matOut.opacity = 0.30 * k;
  }

  /* ============================================================
     THE WIND FIELD — CBZ.tornado.at(x, z).

     Public because the tornado is an environment other systems should be able
     to REACT to without knowing anything about this file: aircraft can be
     thrown off course, boats can be swamped, a flag can stream, an AI can be
     told which way to run. One query, no coupling.

     Returns {speed, inflow, lift, vx, vz, r, ef} — speed/inflow/lift in m/s,
     vx/vz the resolved horizontal wind vector INCLUDING the funnel's own
     forward motion, r the distance to the nearest funnel axis.
     ============================================================ */
  const _fieldOut = { speed: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: Infinity, ef: -1, pressure: 0 };
  // one reusable scratch record so the per-frame queries below never allocate
  const _scratch = { speed: 0, inflow: 0, lift: 0, vx: 0, vz: 0, r: 0, ef: -1, pressure: 0 };
  function fieldInto(t, x, z, out) {
    const dx = x - t.x, dz = z - t.z;
    let r = Math.hypot(dx, dz);
    if (r > t.outer) { out.speed = out.inflow = out.lift = out.vx = out.vz = out.pressure = 0; out.r = r; out.ef = t.ef; return out; }
    if (r < 0.35) r = 0.35;
    // Rankine: solid-body rotation inside the core, free vortex outside.
    let vt = r <= t.R ? t.vmax * (r / t.R) : t.vmax * (t.R / r);
    // taper the free-vortex tail to zero at `outer` so every query is bounded
    if (r > t.R) {
      const tail = 1 - (r - t.R) / (t.outer - t.R);
      vt *= Math.max(0, tail) * Math.max(0, tail);
    }
    const inflow = 0.5 * vt;                          // radial, toward the axis
    // updraft peaks in the core annulus, not on the axis (real vortices have
    // a downdraft core at EF3+; this gaussian is the cheap, honest shape).
    const u = (r - 0.6 * t.R) / (0.7 * t.R);
    const lift = t.wmax * Math.exp(-u * u);
    const ux = dx / r, uz = dz / r;                   // radial unit, outward
    const tx = -uz, tz = ux;                          // tangential unit, cyclonic
    out.speed = vt;
    out.inflow = inflow;
    out.lift = lift;
    // DYNAMIC PRESSURE in pascals — the force a facade, a windscreen, a sail
    // or an aerofoil actually feels. Published so a neighbour can compute a
    // real load without re-deriving it (and without importing our damage
    // model, which is the power flux q*v, not q).
    out.pressure = 0.5 * AIR_RHO * vt * vt;
    out.vx = tx * vt - ux * inflow + t.fvx;
    out.vz = tz * vt - uz * inflow + t.fvz;
    out.r = r;
    out.ef = t.ef;
    return out;
  }
  T.at = function (x, z) {
    _fieldOut.speed = _fieldOut.inflow = _fieldOut.lift = _fieldOut.vx = _fieldOut.vz = _fieldOut.pressure = 0;
    _fieldOut.r = Infinity; _fieldOut.ef = -1;
    if (!live.length) return _fieldOut;
    // strongest wins (they are capped at 1-2, so this is at most two passes)
    let best = null, bs = -1;
    for (let i = 0; i < live.length; i++) {
      fieldInto(live[i], x, z, _scratch);
      if (_scratch.speed > bs) { bs = _scratch.speed; best = live[i]; }
    }
    if (!best) return _fieldOut;
    return fieldInto(best, x, z, _fieldOut);
  };

  // AI / HUD convenience, same shape systems/disasters.js's roster uses.
  T.threat = function (x, z) {
    let t = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      const d = Math.hypot(x - v.x, z - v.z);
      const reach = v.R * 2.2;
      if (d < reach) t = Math.max(t, 1 - d / reach);
    }
    return t;
  };
  T.safeDir = function (x, z) {
    if (!live.length) return null;
    let bx = 0, bz = 0;
    for (let i = 0; i < live.length; i++) {
      const v = live[i];
      const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz) || 1;
      if (d > v.R * 3.2) continue;
      // run PERPENDICULAR to the track, not straight away: you cannot outrun
      // 17 m/s of forward motion in a straight line, and every safety brief
      // says move at right angles to the path. That is a real tactic the AI
      // and the player both get for free out of this one seam.
      bx += (dx / d) * 0.45 - v.fvz / Math.max(1, Math.hypot(v.fvx, v.fvz));
      bz += (dz / d) * 0.45 + v.fvx / Math.max(1, Math.hypot(v.fvx, v.fvz));
    }
    return (bx || bz) ? { x: bx, z: bz } : null;
  };

  /* ============================================================
     SPAWN / STOP.
     DETERMINISM: the path is world/sim state that must agree across clients,
     so the spawn point, the class and the heading come from
     CBZ.seedStream("tornado") when the caller does not supply them, and the
     per-step wobble is CBZ.hash01 on the CURRENT POSITION (order-independent:
     the same funnel at the same metre wobbles the same way on every client,
     no matter how many frames it took to get there). Never Math.random —
     that is reserved for the cosmetic FX jitter further down.
     ============================================================ */
  T.spawn = function (opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.TORNADO_CITY) return null;
    const cap = Math.max(1, Math.min(2, CBZ.CONFIG.TORNADO_MAX | 0));
    while (live.length >= cap) retire(live[0], true);

    // `* 4` capped an unspecified tornado at EF3, so the EF4/EF5 rows — the
    // entire reason the EF table goes that high, and the only two that can
    // take a building all the way down — were unreachable unless a caller
    // named them explicitly. `* 6` covers EF0-EF5.
    const ef = Math.max(0, Math.min(5, opts.ef != null ? (opts.ef | 0) : Math.floor(rng() * 6)));
    const row = EF[ef];
    let x = opts.x, z = opts.z;
    if (x == null || z == null) {
      // no site given: pick one off the seeded stream, biased to the built-up
      // part of the world (the lots) so a tornado is a CITY event, not a
      // photogenic column out in the desert nobody ever sees.
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.lots && A.lots.length) {
        const lot = A.lots[(rng() * A.lots.length) | 0];
        x = lot.cx; z = lot.cz;
      } else { x = (rng() - 0.5) * 400; z = (rng() - 0.5) * 400; }
    }
    const heading = opts.heading != null ? opts.heading : rng() * 6.2832;
    const fwd = opts.speed != null ? +opts.speed : row.fwd;
    const t = {
      id: ++idSeq,
      x: +x, z: +z, ef: ef,
      R: row.R, vmax: row.vmax, wmax: row.vmax * LIFT_MUL,
      outer: row.R * OUTER_MUL,
      dmgR: row.R * DAMAGE_MUL,
      heading: heading, fwd: fwd,
      fvx: Math.cos(heading) * fwd, fvz: Math.sin(heading) * fwd,
      life: opts.life != null ? +opts.life : row.life,
      age: 0, spin: 0,
      // WHO IS TO BLAME — and the answer is NOBODY, by default.
      // city/structural.js reads `by` as the credited ATTACKER: a non-null
      // rec.by makes its collapse kill everyone in the footprint with
      // `byPlayer: true` and posts the event with `noWanted: false`, i.e. the
      // player picks up a murder charge and a wanted level for every block the
      // weather flattens. So a natural tornado passes `by: null` and only a
      // caller that genuinely wants the credit (a weather-machine mission,
      // a cheat, a scripted set piece) passes an actor through spawn({by}).
      by: opts.by || null,
      bounds: opts.bounds || null,               // {x,z,r} — bounce off this circle
      dps: DPS0 * Math.pow(row.vmax / 33, 3),
      // per-vortex timers (all throttles, never per-frame world queries)
      tStruct: 0, tCars: 0, tPeople: 0, tFx: 0, tSfx: 0, tShake: 0, tGlass: 0, tProp: 0, tEvent: 0,
      // roof-seat cache: lot -> {y, t}. Bounded by the lot cap below and
      // cleared on retire. NOT a damage ledger — it stores only where the
      // NEXT hit should be seated, read back from CBZ.structure.state().
      roofs: new Map(),
      lifted: [],                                 // vehicles under our control
      dead: false,
    };
    live.push(t);
    buildFunnel(t);
    try {
      if (CBZ.sfx) { CBZ.sfx("wind"); CBZ.sfx("rumble", { delay: 0.4 }); }
      if (CBZ.shake) CBZ.shake(0.5);
    } catch (e) {}
    fireHook(T.onSpawn, snapshot(t));
    return t;
  };

  function snapshot(t) {
    return { id: t.id, x: +t.x.toFixed(2), z: +t.z.toFixed(2), ef: t.ef, r: t.R, vmax: t.vmax, age: +t.age.toFixed(2) };
  }
  T.active = function () { return live.map(snapshot); };
  T.count = function () { return live.length; };

  T.stop = function (handle) {
    if (handle && handle.id != null) { retire(handle, false); return true; }
    if (!live.length) return false;
    while (live.length) retire(live[live.length - 1], false);
    return true;
  };
  T.clear = function () { while (live.length) retire(live[live.length - 1], true); };

  function retire(t, hard) {
    const i = live.indexOf(t);
    if (i >= 0) live.splice(i, 1);
    t.dead = true;
    // every car we still own is handed back / dropped, never left frozen
    for (let k = t.lifted.length - 1; k >= 0; k--) releaseCar(t, t.lifted[k], hard);
    t.lifted.length = 0;
    t.roofs.clear();
    disposeFunnel(t);
    if (!hard) { try { if (CBZ.sfx) CBZ.sfx("wind", { volume: 0.5 }); } catch (e) {} }
    fireHook(T.onEnd, snapshot(t));
  }

  /* ============================================================
     SEAMS — mirroring CBZ.structure.onCollapse's shape exactly, so a mission
     ("survive the outbreak", "clear the path", "the storm chaser job") hangs
     off this file without editing it.
       T.onSpawn  fn({id,x,z,ef,r,vmax})
       T.onPath   fn({id,x,z,ef,r,vmax,age})       every path step (~5 Hz)
       T.onDamage fn({id,x,z,lot,amount,stage})    every structural bite
       T.onEnd    fn({id,x,z,ef,r,vmax,age})
     ============================================================ */
  T.onSpawn = null; T.onPath = null; T.onDamage = null; T.onEnd = null;
  function fireHook(fn, arg) { if (typeof fn === "function") { try { fn(arg); } catch (e) {} } }

  /* ============================================================
     MOVEMENT. Forward at `fwd` m/s along `heading`, with a deterministic
     wobble hashed off the CURRENT POSITION. Bounces off an optional bounding
     circle (survival's island) and is clamped into the city otherwise.
     ============================================================ */
  function move(t, dt) {
    // wobble: hash01 quantizes to decimetres, so this is stable per metre of
    // track and identical on every client regardless of frame rate.
    const w = CBZ.hash01 ? CBZ.hash01(t.x, t.z, 0x7043) : 0.5;
    t.heading += (w - 0.5) * 0.55 * dt;
    t.fvx = Math.cos(t.heading) * t.fwd;
    t.fvz = Math.sin(t.heading) * t.fwd;
    t.x += t.fvx * dt;
    t.z += t.fvz * dt;
    if (t.bounds) {
      const dx = t.x - t.bounds.x, dz = t.z - t.bounds.z, d = Math.hypot(dx, dz);
      if (d > t.bounds.r) {
        t.heading = Math.atan2(t.bounds.z - t.z, t.bounds.x - t.x) + (w - 0.5) * 0.8;
        t.fvx = Math.cos(t.heading) * t.fwd; t.fvz = Math.sin(t.heading) * t.fwd;
      }
    } else if (CBZ.city && CBZ.city.arena && CBZ.city.arena.clampToCity) {
      // keep it over land: the same clamp traffic uses, so a funnel never
      // wanders off into the ocean and grinds an empty water plane.
      const p = { x: t.x, z: t.z };
      try {
        CBZ.city.arena.clampToCity(p, t.R * 0.5);
        if (Math.abs(p.x - t.x) > 0.01 || Math.abs(p.z - t.z) > 0.01) {
          t.x = p.x; t.z = p.z;
          t.heading += Math.PI * 0.55;
          t.fvx = Math.cos(t.heading) * t.fwd; t.fvz = Math.sin(t.heading) * t.fwd;
        }
      } catch (e) {}
    }
  }

  /* ============================================================
     BUILDINGS — roof-first, sustained, through THE ledger.

     Not one big hit: a DPS bite every STRUCT_TICK while the funnel overlaps
     the footprint, so the building visibly walks INTACT -> SCARRED -> WOUNDED
     -> CRITICAL -> COLLAPSING under a funnel that parks on it, and merely gets
     scuffed by one that clips it. That escalation IS the feature.

     PERF: one bounded pass over lots every 0.2 s (city/structural.js's own
     blast wave does the same pass at 20 Hz, so this is 4x cheaper than
     precedent), and the number of lots actually hit per tick is capped by
     qScale — over the cap we keep the NEAREST, because those are the ones the
     player is looking at. Buildings already condemned are skipped outright so
     the budget always goes to something still standing.

     TALL BUILDINGS ARE FELLABLE NOW (structural.js reads
     CBZ.CONFIG.DEMO_MAX_STOREYS, default 64, instead of the old hard 11-storey
     immunity), so a sustained EF4/EF5 parked on a tower is a real event rather
     than a light show. The cost of that is NOT ours to bound: every
     condemnation lands in structural.js's own `condemned` queue, which drains
     at qScale(1,3) teardowns per frame nearest-first. A funnel walking a
     downtown block therefore produces a steady trickle of collapses, never one
     catastrophic frame — which is exactly why the budget lives there, once,
     for every condemnation source, and not here.
     ============================================================ */
  const STRUCT_TICK = 0.2;
  const _lotHits = [];
  function hitBuildings(t, dt) {
    if (!CBZ.CONFIG.TORNADO_STRUCTURAL || !CBZ.structure || !CBZ.structure.hit) return;
    t.tStruct += dt;
    if (t.tStruct < STRUCT_TICK) return;
    const step = t.tStruct; t.tStruct = 0;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots) return;

    const reach = t.dmgR;
    _lotHits.length = 0;
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i], b = lot.building;
      if (!b || lot.demolished) continue;
      // cheap box distance from the axis to the footprint
      const dx = Math.max(0, Math.abs(b.ox - t.x) - b.w * 0.5);
      const dz = Math.max(0, Math.abs(b.oz - t.z) - b.d * 0.5);
      const d = Math.hypot(dx, dz);
      if (d >= reach) continue;
      _lotHits.push(lot, d);
    }
    if (!_lotHits.length) return;

    const cap = Math.max(3, Math.round(CBZ.qScale ? CBZ.qScale(6, 18) : 12)) * 2;
    if (_lotHits.length > cap) {
      // over budget: keep the nearest. A simple selection pass beats a sort
      // here because the list is already short and this runs at 5 Hz.
      for (let a = 0; a < cap; a += 2) {
        let bi = a;
        for (let c = a + 2; c < _lotHits.length; c += 2) if (_lotHits[c + 1] < _lotHits[bi + 1]) bi = c;
        if (bi !== a) {
          const l0 = _lotHits[a], d0 = _lotHits[a + 1];
          _lotHits[a] = _lotHits[bi]; _lotHits[a + 1] = _lotHits[bi + 1];
          _lotHits[bi] = l0; _lotHits[bi + 1] = d0;
        }
      }
      _lotHits.length = cap;
    }

    for (let i = 0; i < _lotHits.length; i += 2) {
      const lot = _lotHits[i], d = _lotHits[i + 1], b = lot.building;
      const q = Math.max(0, 1 - d / reach);
      const amount = t.dps * q * step;
      if (amount <= 0.001) continue;
      // ---- ROOF-FIRST SEAT. The tornado is always working on the highest
      //      floor that still has integrity, so it eats a building downward.
      const info = roofInfo(t, lot, b);
      // Already condemned (city/structural.js's doomedIn >= 0): it is coming
      // down on its own timer and hit() would early-out anyway. Skipping frees
      // this tick's lot budget for something still standing, which is what
      // keeps an EF5 over a dense district working on the whole block instead
      // of re-hitting the same six ruins.
      if (info.doomed) continue;
      const y = info.y;
      fieldInto(t, b.ox, b.oz, _scratch);
      let nx = _scratch.vx, nz = _scratch.vz;
      const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      let stage = 0;
      try {
        const rec = CBZ.structure.hit(b.ox, y, b.oz, amount, {
          kind: "tornado", pen: 0, fire: 0,
          dirx: nx, dirz: nz, by: t.by, lot: lot,
        });
        stage = (rec && rec.stage) || 0;
      } catch (e) {}
      if (T.onDamage) fireHook(T.onDamage, { id: t.id, x: b.ox, z: b.oz, lot: lot, amount: +amount.toFixed(3), stage: stage });
      // the visible read of the roof coming off — only where it can be seen,
      // only on the strong side of the path, on the already-pooled systems.
      if (q > 0.45 && camDist(b.ox, b.oz) < (CBZ.cityCullRadius || 320)) {
        try {
          if (CBZ.cityChunk) CBZ.cityChunk(b.ox + (Math.random() - 0.5) * b.w * 0.7, y, b.oz + (Math.random() - 0.5) * b.d * 0.7,
            { count: Math.round(CBZ.qScale ? CBZ.qScale(1, 4) : 3), force: 5 + 7 * q, dirx: nx, dirz: nz });
        } catch (e) {}
      }
    }
  }

  // WHERE THE NEXT BITE LANDS: the highest floor that still has integrity, in
  // metres, plus whether the building is already condemned. BOTH are read back
  // from city/structural.js's public state() — this file keeps NO damage
  // number of its own (that is the whole point of one ledger), and the cache
  // below stores only a Y and a boolean, refreshed twice a second.
  const _roofOut = { y: 1, doomed: false };
  function roofInfo(t, lot, b) {
    const FH = b.FH || 3.2;
    const roofY = Math.max(1, (b.h || b.storeys * FH) - FH * 0.35);
    let rec = t.roofs.get(lot);
    if (rec && CBZ.now - rec.t < 500) { _roofOut.y = rec.y; _roofOut.doomed = rec.doomed; return _roofOut; }
    let y = roofY, doomed = false;
    try {
      const st = CBZ.structure.state ? CBZ.structure.state(lot) : null;
      if (st) {
        // `doomedIn` (seconds to collapse, -1 = standing) is structural.js's
        // own countdown; `stage >= 5` is the pre-doomedIn fallback so this
        // still behaves if that seam is not present.
        doomed = (st.doomedIn != null && st.doomedIn >= 0) || (st.stage || 0) >= 5;
        if (st.floors && st.floors.length) {
          let top = -1;
          for (let i = st.floors.length - 1; i >= 0; i--) if (st.floors[i] > 0.2) { top = i; break; }
          // every floor gone: keep grinding the ground floor rather than
          // seating the hit below the world (which resolves to floor 0 anyway).
          y = top < 0 ? Math.max(1, FH * 0.5) : Math.max(1, (top + 0.85) * FH);
        }
      }
    } catch (e) {}
    if (!rec) { rec = { y: y, doomed: doomed, t: 0 }; t.roofs.set(lot, rec); }
    rec.y = y; rec.doomed = doomed; rec.t = CBZ.now;
    // BOUND the cache: it only ever holds lots the funnel is currently over,
    // and the funnel moves, so trim it whenever it outgrows the lot cap.
    if (t.roofs.size > 64) t.roofs.clear();
    _roofOut.y = y; _roofOut.doomed = doomed;
    return _roofOut;
  }

  /* ============================================================
     VEHICLES — lifted, orbited, thrown, and priced as `kinetic` on landing.

     OWNERSHIP: city/vehicles.js's updater skips any car with `ai` falsy, so
     clearing `ai`/`road` is how we take a car off its own controller without
     writing a second car physics loop. We hand it back (as a wreck) on impact.

     PERF: one bounded scan every 0.3 s; concurrent lifted cars hard-capped by
     qScale (2 at tier 0, 8 at tier 4). Over the cap we EJECT the farthest —
     it becomes a thrown car, which is the cheap path and also the good-looking
     one. Nothing ever queues.
     ============================================================ */
  const CAR_TICK = 0.3;
  function liftedCap() { return Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(2, 8) : 5)); }

  function scanCars(t, dt) {
    if (!CBZ.CONFIG.TORNADO_LIFT || !inCity() || !CBZ.cityCars) return;
    t.tCars += dt;
    if (t.tCars < CAR_TICK) return;
    t.tCars = 0;
    const cars = CBZ.cityCars, cap = liftedCap();
    const reach = t.R * 1.3;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c._twLift) continue;
      const dx = c.pos.x - t.x, dz = c.pos.z - t.z;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      if (dx * dx + dz * dz > reach * reach) continue;
      fieldInto(t, c.pos.x, c.pos.z, _scratch);
      if (c.player) {
        // NEVER seize the car the player is driving — city/vehicles.js owns
        // that transform every frame and two writers would fight. Instead the
        // wind SHOVES it: nudging pos before vehicles.js's order-37 tick means
        // the controller integrates from the shoved position, so it reads as
        // the storm pushing you across the road, which is the honest effect.
        continue;
      }
      if (_scratch.speed < LIFT_MIN_SPEED) continue;
      if (t.lifted.length >= cap) {
        // degrade over the cap: throw the FARTHEST one out now.
        let fi = 0, fd = -1;
        for (let k = 0; k < t.lifted.length; k++) {
          const L = t.lifted[k];
          if (L.phase !== "orbit") continue;
          if (L.rad > fd) { fd = L.rad; fi = k; }
        }
        if (fd < 0) break;                     // everything already in flight
        eject(t, t.lifted[fi]);
      }
      if (t.lifted.length >= cap) break;
      seizeCar(t, c);
    }
  }

  function seizeCar(t, c) {
    c._twLift = true;
    c._twAi = c.ai; c._twRoad = c.road;
    c.ai = false; c.road = null;
    c.v = 0; c.vx = 0; c.vz = 0;
    c._airborne = false; c._airY = 0; c._airVy = 0;
    const dx = c.pos.x - t.x, dz = c.pos.z - t.z;
    t.lifted.push({
      car: c, phase: "orbit",
      ang: Math.atan2(dz, dx), rad: Math.max(3, Math.hypot(dx, dz)),
      y: c.group ? c.group.position.y : 0, vy: 2,
      rx: 0, rz: 0, sx: (Math.random() - 0.5) * 5, sz: (Math.random() - 0.5) * 4,
      age: 0, mass: c.mass || 1450,
    });
    try {
      if (CBZ.cityDustKick) CBZ.cityDustKick(c.pos.x, 0.4, c.pos.z, 1.6);
    } catch (e) {}
  }

  function eject(t, L) {
    if (L.phase !== "orbit") return;
    L.phase = "thrown";
    fieldInto(t, L.car.pos.x, L.car.pos.z, _scratch);
    // launched along the tangential+outward resultant at most of the local
    // wind speed — that is what makes the throw read as "the vortex spat it".
    const sp = Math.max(18, _scratch.speed * 0.8);
    const tx = -Math.sin(L.ang), tz = Math.cos(L.ang);
    const ox = Math.cos(L.ang), oz = Math.sin(L.ang);
    L.vx = (tx * 0.8 + ox * 0.6) * sp;
    L.vz = (tz * 0.8 + oz * 0.6) * sp;
    L.vy = Math.max(4, _scratch.lift * 0.55);
    try { if (CBZ.sfx && camDist(L.car.pos.x, L.car.pos.z) < 120) CBZ.sfx("whoosh"); } catch (e) {}
  }

  function stepLifted(t, dt) {
    for (let i = t.lifted.length - 1; i >= 0; i--) {
      const L = t.lifted[i], c = L.car;
      if (!c || !c.pos) { t.lifted.splice(i, 1); continue; }
      // something else killed the car while we had it (a stray blast, a run
      // reset, the vehicle pool recycling it) — hand it straight back rather
      // than flying a corpse around.
      if (c.dead) { releaseCar(t, L, true); t.lifted.splice(i, 1); continue; }
      L.age += dt;

      if (L.phase === "orbit") {
        fieldInto(t, c.pos.x, c.pos.z, _scratch);
        // the corkscrew: angular rate from tangential speed, radius eaten by
        // the inflow, height driven by the updraft against gravity.
        L.ang += (_scratch.speed / Math.max(2, L.rad)) * dt;
        L.rad = Math.max(2.5, L.rad - _scratch.inflow * dt * 0.55);
        L.vy += (_scratch.lift * 0.75 - L.vy) * Math.min(1, dt * 2.2);
        L.y += L.vy * dt;
        L.rx += L.sx * dt; L.rz += L.sz * dt;
        const nx = t.x + Math.cos(L.ang) * L.rad, nz = t.z + Math.sin(L.ang) * L.rad;
        c.pos.x = nx; c.pos.z = nz;
        if (c.group) {
          c.group.position.set(nx, L.y, nz);
          c.group.rotation.set(L.rx, -L.ang, L.rz);
          c.group.visible = true;
        }
        // spat out when it reaches the top, gets sucked to the axis, or has
        // simply been up there long enough (bounded ride, never forever).
        const H = t.mesh ? t.mesh.H : t.R * 2.4;
        if (L.y > H * 0.8 || L.rad <= 3.0 || L.age > 6) eject(t, L);
        continue;
      }

      // ---- THROWN: plain ballistics until it hits something ---------------
      L.vy -= 19.2 * dt;
      const px = c.pos.x, pz = c.pos.z, py = L.y;
      c.pos.x += L.vx * dt; c.pos.z += L.vz * dt; L.y += L.vy * dt;
      L.rx += L.sx * dt * 1.6; L.rz += L.sz * dt * 1.6;
      if (c.group) {
        c.group.position.set(c.pos.x, L.y, c.pos.z);
        c.group.rotation.set(L.rx, Math.atan2(L.vz, L.vx), L.rz);
      }
      const spd = Math.hypot(L.vx, L.vy, L.vz);
      // (a) into a FACADE — the money shot, and it is one bus call.
      if (spd > 16 && CBZ.structure && CBZ.structure.lotAt) {
        let lot = null;
        try { lot = CBZ.structure.lotAt(c.pos.x, c.pos.z, 0.8); } catch (e) {}
        if (lot && lot.building && L.y > 0.6 && L.y < (lot.building.h || 12)) {
          impact(t, L, spd, lot, px, py, pz);
          t.lifted.splice(i, 1);
          continue;
        }
      }
      // (b) into the GROUND
      const gy = floorAt(c.pos.x, c.pos.z);
      if (L.y <= gy + 0.45) {
        L.y = gy + 0.45;
        impact(t, L, spd, null, px, py, pz);
        t.lifted.splice(i, 1);
        continue;
      }
    }
  }

  // The landing. ONE `kinetic` detonation — the bus prices mass x speed
  // (E = 1/2 m v^2, cube root for FX, 2/3 power for the ledger) and resolves
  // the struck lot itself, so a thrown car through a third-floor window is a
  // single call and not a bespoke damage model.
  //
  // WE DELIBERATELY DO NOT PASS `frontal`. That option (metres of frontal
  // width) buys a COLUMN-SEVER term, and a 1.5 t car at 40 m/s carries ~1.2 MJ
  // — three orders below what it takes to cut a floorplate's load path. The
  // model would correctly return ~0 anyway; omitting it says so honestly and
  // saves the arithmetic. A tornado wrecks buildings by grinding them, not by
  // sniping their columns with the contents of a car park.
  function impact(t, L, spd, lot, px, py, pz) {
    const c = L.car;
    const dx = L.vx, dz = L.vz, dl = Math.hypot(dx, dz) || 1;
    try {
      if (CBZ.detonate) {
        CBZ.detonate(c.pos.x, L.y, c.pos.z, "kinetic", {
          mass: L.mass, speed: spd,
          dirx: dx / dl, dirz: dz / dl,
          by: t.by, byPlayer: false, lot: lot || null,
        });
      } else if (CBZ.cityDustKick) {
        CBZ.cityDustKick(c.pos.x, L.y, c.pos.z, 2.0);
      }
    } catch (e) {}
    // the car itself is now a wreck — the existing damage/fire path owns that.
    try {
      if (c.npcDriver && !c.npcDriver.dead && CBZ.cityKillPed) {
        CBZ.cityKillPed(c.npcDriver, { fromX: t.x, fromZ: t.z, force: 8, fling: 5, byPlayer: false }, "thrown by the tornado");
      }
      if (CBZ.cityDamageCar) CBZ.cityDamageCar(c, 600, {});
      if (spd > 26 && CBZ.cityCarIgnite) CBZ.cityCarIgnite(c, false);
      if (CBZ.shake) { const d = camDist(c.pos.x, c.pos.z); if (d < 120) CBZ.shake(Math.min(1.5, spd * 0.03) * (1 - d / 120)); }
    } catch (e) {}
    releaseCar(t, L, false);
  }

  // Give the car back. It never returns to traffic (it is wreckage), but it
  // stops being ours, sits on the ground, and every other system sees a
  // perfectly ordinary abandoned car again.
  function releaseCar(t, L, hard) {
    const c = L && L.car;
    if (!c) return;
    c._twLift = false;
    c.ai = false; c.road = null;
    c.v = 0; c.vx = 0; c.vz = 0;
    c._airborne = false; c._airY = 0; c._airVy = 0;
    c.abandoned = true;
    c.wreckT = 0;
    const gy = floorAt(c.pos.x, c.pos.z);
    if (c.group) {
      c.group.position.set(c.pos.x, gy + 0.4, c.pos.z);
      if (!hard) {
        // come to rest crumpled on its side, like every other tossed wreck
        c.group.rotation.set((Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.8), c.heading || 0, (Math.random() - 0.5) * 1.2);
      } else {
        c.group.rotation.set(0, c.heading || 0, 0);
      }
    }
  }

  /* ============================================================
     PEOPLE. Every death funnels through the SHARED kill bus — this file
     never toasts anything (CLAUDE.md: the killfeed is the only popup).
     PERF: the ped list is scanned at 5 Hz with an AABB reject before the
     hypot, and the instanced crowd is handled by ONE circle-kill call rather
     than a second per-agent loop.
     ============================================================ */
  const PEOPLE_TICK = 0.2;
  const CAUSE = "torn apart by the tornado";
  function hitPeople(t, dt) {
    t.tPeople += dt;
    const tick = t.tPeople >= PEOPLE_TICK;
    const step = t.tPeople;
    if (tick) t.tPeople = 0;

    // ---- SURVIVAL MODE: the roster's actors, through surv's own hurt path
    //      (which already resolves the kill-feed cause). Nothing city-side
    //      exists there, so we stop here.
    if (!inCity()) {
      if (CBZ.surv && CBZ.surv.forEachActor) {
        const kill = t.R * 0.75;
        CBZ.surv.forEachActor(function (a) {
          if (!a || !a.pos) return;
          const d = Math.hypot(a.pos.x - t.x, a.pos.z - t.z);
          if (d > t.outer) return;
          fieldInto(t, a.pos.x, a.pos.z, _scratch);
          if (d < kill) { try { CBZ.surv.hurt(a, 1e6, { fromX: t.x, fromZ: t.z, fling: 8 }); } catch (e) {} return; }
          // dragged toward the axis, and hurt in proportion to the wind
          const drag = Math.min(9, _scratch.speed * 0.10);
          if (a.isPlayer) dragPlayer(t, dt, drag);
          else {
            a.pos.x += (_scratch.vx / Math.max(1, _scratch.speed)) * drag * dt;
            a.pos.z += (_scratch.vz / Math.max(1, _scratch.speed)) * drag * dt;
            if (CBZ.collide) { try { CBZ.collide(a.pos, 0.5); } catch (e) {} }
          }
          if (_scratch.speed > 26) { try { CBZ.surv.hurt(a, _scratch.speed * 0.22 * dt); } catch (e) {} }
        });
      }
      return;
    }

    // ---- CITY: crowd, peds, player -------------------------------------
    if (tick) {
      const kill = t.R * 0.7;
      if (CBZ.cityCrowdCircleKill) {
        try {
          CBZ.cityCrowdCircleKill(t.x, t.z, kill, {
            byCar: true, quiet: true, fromX: t.x, fromZ: t.z, noCrime: true,
          });
        } catch (e) {}
      }
      const peds = CBZ.cityPeds;
      if (peds && peds.length) {
        const reach = t.outer;
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || !p.pos) continue;
          const dx = p.pos.x - t.x, dz = p.pos.z - t.z;
          if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
          const d = Math.hypot(dx, dz);
          if (d > reach) continue;
          if (d < kill) {
            try { CBZ.cityKillPed(p, { fromX: t.x, fromZ: t.z, force: 16, fling: 12, byPlayer: false }, CAUSE); } catch (e) {}
            continue;
          }
          fieldInto(t, p.pos.x, p.pos.z, _scratch);
          const drag = Math.min(10, _scratch.speed * 0.12);
          const inv = 1 / Math.max(1, _scratch.speed);
          p.pos.x += _scratch.vx * inv * drag * step;
          p.pos.z += _scratch.vz * inv * drag * step;
          if (CBZ.collideSlide) { try { CBZ.collideSlide(p.pos, 0.4, p.pos.y, p.pos.y + 1.7); } catch (e) {} }
        }
      }
    }
    // the player is handled every frame (their motion must never be chunky)
    hitPlayer(t, dt);
  }

  // Drag toward the axis, lift at the core, hurt throughout. The ballistic
  // launch reuses systems/physics.js's `_phys.air` branch — the SAME state
  // systems/predator.js's knockPlayer() sets, so there is one airborne-player
  // model in the game and this file does not add a second.
  function hitPlayer(t, dt) {
    const P = CBZ.player;
    if (!P || P.dead || !P.pos) return;
    if (P.driving) { shovePlayerCar(t, dt); return; }
    const d = Math.hypot(P.pos.x - t.x, P.pos.z - t.z);
    if (d > t.outer) return;
    fieldInto(t, P.pos.x, P.pos.z, _scratch);
    const ph = P._phys;
    if (ph && ph.air) return;                        // already in flight

    if (d < t.R * 0.85 && _scratch.speed > 40) {
      // INTO THE CORE. Thrown, hard, along the local wind + straight up.
      const inv = 1 / Math.max(1, _scratch.speed);
      const p2 = P._phys = P._phys || {};
      p2.air = true; p2.down = 0; p2.kx = p2.kz = 0;
      p2.vx = _scratch.vx * inv * Math.min(26, _scratch.speed * 0.45);
      p2.vz = _scratch.vz * inv * Math.min(26, _scratch.speed * 0.45);
      p2.vy = Math.min(20, 6 + _scratch.lift * 0.5);
      p2.spin = (Math.random() < 0.5 ? -1 : 1) * 5.5;
      P.grounded = false;
      try {
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.round(18 + t.ef * 9), t.x, t.z, CAUSE, false, null, false);
        if (CBZ.shake) CBZ.shake(2.0);
      } catch (e) {}
      return;
    }
    // OUTSIDE THE CORE: dragged. Scaled well down — the player must be able to
    // fight it at the edge and lose at the middle, which is the whole tension.
    dragPlayer(t, dt, Math.min(7, _scratch.speed * 0.075));
    if (_scratch.speed > 30) {
      t.tHurt = (t.tHurt || 0) + dt;
      if (t.tHurt >= 0.5) {
        t.tHurt = 0;
        try { if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.round(_scratch.speed * 0.12), t.x, t.z, "battered by the tornado", false, null, false); } catch (e) {}
      }
    }
  }

  function dragPlayer(t, dt, drag) {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    fieldInto(t, P.pos.x, P.pos.z, _scratch);
    const inv = 1 / Math.max(1, _scratch.speed);
    P.pos.x += _scratch.vx * inv * drag * dt;
    P.pos.z += _scratch.vz * inv * drag * dt;
    if (CBZ.collideSlide) { try { CBZ.collideSlide(P.pos, 0.45, P.pos.y, P.pos.y + 1.8); } catch (e) {} }
    else if (CBZ.collide) { try { CBZ.collide(P.pos, 0.45); } catch (e) {} }
  }

  // The player's own car is never seized (see scanCars) — instead the wind
  // pushes it. We run at 34.35, city/vehicles.js drives at 37, so nudging
  // car.pos here means the controller integrates from the shoved position and
  // the shove reads as steering resistance rather than a teleport.
  function shovePlayerCar(t, dt) {
    const car = CBZ.player && CBZ.player._vehicle;
    if (!car || !car.pos) return;
    const d = Math.hypot(car.pos.x - t.x, car.pos.z - t.z);
    if (d > t.outer) return;
    fieldInto(t, car.pos.x, car.pos.z, _scratch);
    const inv = 1 / Math.max(1, _scratch.speed);
    // a tonne and a half resists: ~12% of the wind, which is a hard drift at
    // EF2 and genuinely unsurvivable at EF5.
    const push = Math.min(14, _scratch.speed * 0.12);
    car.pos.x += _scratch.vx * inv * push * dt;
    car.pos.z += _scratch.vz * inv * push * dt;
    if (_scratch.speed > LIFT_MIN_SPEED) {
      try {
        if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, _scratch.speed * 0.35 * dt, {});
        if (CBZ.shake) CBZ.shake(Math.min(1.2, _scratch.speed * 0.012));
      } catch (e) {}
    }
  }

  /* ============================================================
     WORLD FX + AMBIENCE. Every call here is into an EXISTING pooled system;
     this file owns no particle pool. Everything is throttled on its own timer
     and gated on camera distance, and every count rides CBZ.qScale.
     ============================================================ */
  function worldFx(t, dt) {
    const near = camDist(t.x, t.z);
    const cull = CBZ.cityCullRadius || 320;

    // --- camera shake, ~7 Hz, distance-attenuated -------------------------
    t.tShake += dt;
    if (t.tShake > 0.14) {
      t.tShake = 0;
      if (near < 260 && CBZ.shake) {
        const k = 1 - near / 260;
        try { CBZ.shake((0.25 + t.ef * 0.16) * k * k); } catch (e) {}
      }
    }

    // --- the roar. Two closed-set names only: wind + rumble. --------------
    t.tSfx += dt;
    if (t.tSfx > (near < 120 ? 0.8 : 2.2)) {
      t.tSfx = 0;
      try {
        if (CBZ.sfx && near < 300) {
          CBZ.sfx("wind", { volume: Math.max(0.25, 1 - near / 300) });
          if (t.ef >= 2 && near < 180) CBZ.sfx("rumble", { delay: 0.25, volume: 0.6 });
        }
      } catch (e) {}
    }

    if (!inCity()) return;                            // the rest is city-only

    // --- the debris skirt at the base ------------------------------------
    t.tFx += dt;
    const every = CBZ.qScale ? CBZ.qScale(0.5, 0.16) : 0.25;
    if (t.tFx > every && near < cull) {
      t.tFx = 0;
      const a = Math.random() * 6.2832, rr = t.R * (0.3 + Math.random() * 0.8);
      const dx2 = t.x + Math.cos(a) * rr, dz2 = t.z + Math.sin(a) * rr;
      try {
        if (CBZ.cityDustKick) CBZ.cityDustKick(dx2, floorAt(dx2, dz2) + 0.4, dz2, 1.6 + t.ef * 0.2);
        if (CBZ.cityChunk && Math.random() < 0.5) {
          const ux = (dx2 - t.x) / (rr || 1), uz = (dz2 - t.z) / (rr || 1);
          CBZ.cityChunk(dx2, 1.0, dz2, { count: Math.round(CBZ.qScale ? CBZ.qScale(1, 3) : 2), force: 9, dirx: -uz, dirz: ux });
        }
        if (CBZ.cityCrashSmoke && t.ef >= 3 && Math.random() < 0.25) CBZ.cityCrashSmoke(t.x, 6 + Math.random() * 10, t.z);
      } catch (e) {}
    }

    // --- glass. The pressure drop blows windows out ahead of the debris.
    //     cityShatter skips already-shattered panes, so overlap is free.
    t.tGlass += dt;
    if (t.tGlass > 0.55) {
      t.tGlass = 0;
      try { if (CBZ.cityShatter) CBZ.cityShatter(t.x, t.z, t.R * (0.9 + t.ef * 0.06)); } catch (e) {}
    }

    // --- street furniture. cityShootProp is the existing public "something
    //     travelled through here" verb: bins, cones, meters and newsboxes tip
    //     over and a propane cage cooks off, all with no new code and no new
    //     registry. We cast a short chord across the funnel base each tick.
    t.tProp += dt;
    if (t.tProp > 0.35 && CBZ.cityShootProp) {
      t.tProp = 0;
      const a = Math.random() * 6.2832, L = t.R * 1.1;
      const gy = floorAt(t.x, t.z);
      // ONE WRINKLE: city/props.js's propane branch reports a cooked-off tank
      // as a WITNESSED CRIME (CBZ.cityCrime) and attributes the fireball to
      // the player, because its only caller until now was a bullet. A storm
      // is not something you did. props.js belongs to another domain, so
      // rather than edit it we suspend the crime reporter for the duration of
      // this one call and restore it in a `finally` — the alarm still sounds
      // (police responding to an explosion is correct), only the blame is
      // dropped. If props.js ever grows an un-attributed knock verb
      // (cityKnockProp(x, z, dirx, dirz)), delete this and call that instead.
      const crime = CBZ.cityCrime;
      try {
        CBZ.cityCrime = null;
        CBZ.cityShootProp(
          { x: t.x - Math.cos(a) * L, y: gy + 0.9, z: t.z - Math.sin(a) * L },
          { x: t.x + Math.cos(a) * L, y: gy + 0.9, z: t.z + Math.sin(a) * L });
      } catch (e) {}
      finally { CBZ.cityCrime = crime; }
    }

    // --- the city REACTS. One event post buys crowd flee, police attention
    //     and the news/worldstate reaction that every other atrocity gets.
    t.tEvent += dt;
    if (t.tEvent > 1.0) {
      t.tEvent = 0;
      try {
        if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: { x: t.x, z: t.z }, radius: t.outer, intensity: 1.4 + t.ef * 0.3 });
      } catch (e) {}
    }
  }

  /* ============================================================
     TICK — order 34.35.

     WHY 34.35: it must run BEFORE systems/impactbus.js (34.4) so a `kinetic`
     detonation from a thrown car and a structural bite dealt this frame are
     both processed by the bus (34.4) and the ledger (34.45) in the SAME frame
     rather than one frame late, and it must run AFTER the ped brains (34) so
     we drag people after they have chosen where to walk, not before. It is
     also before city/vehicles.js (37), which is what makes the player-car
     shove read as the controller fighting the wind. 34.35 was free.

     Costs one length check when nothing is spinning.
     ============================================================ */
  /* ============================================================
     THE WEATHER DIRECTOR — how a tornado actually reaches a player.

     Without this the whole file is unreachable: `T.spawn` existed, and the
     ONLY caller in the game was survival mode's disaster roster. A player in
     city mode — which is the mode the owner asked for tornadoes hitting
     buildings in — could never see one however long they played. A capability
     nothing in the world triggers is a stat fiction, which CLAUDE.md bans by
     name.

     So a tornado forms the way a real one does: out of a severe storm.
     `systems/weather.js` already runs an intensity state machine that builds
     to `0.7 + rand*0.3` for a heavy storm and fades again over minutes — we
     just read it. No second weather model, no timer of our own.

     DETERMINISM. Which day a tornado forms, and how strong, is world state
     that two clients on one seed must agree on, so the roll is a position-free
     `CBZ.hash01` over the in-game DAY NUMBER — not `Math.random`, and not a
     draw on a shared stream (order-fragile). One roll per day: the same day
     always answers the same way, however many times we ask it.

     Flip `?cfg_TORNADO_WEATHER=0` and storms stay storms.
     ============================================================ */
  if (CBZ.CONFIG.TORNADO_WEATHER == null) CBZ.CONFIG.TORNADO_WEATHER = true;
  const STORM_MIN = 0.82;        // intensity a storm must reach to be tornadic
  const DAY_CHANCE = 0.22;       // of the days that DO storm this hard
  let lastDay = -1;

  function director() {
    if (!CBZ.CONFIG.TORNADO_CITY || !CBZ.CONFIG.TORNADO_WEATHER) return;
    if (live.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const w = CBZ.weather;
    if (!w || !(w.intensity >= STORM_MIN)) return;
    const day = CBZ.dayCount ? (CBZ.dayCount() | 0) : 0;
    if (day === lastDay) return;              // one attempt per in-game day
    lastDay = day;
    if (!CBZ.hash01) return;
    if (CBZ.hash01(day, 0, 0x7075a) >= DAY_CHANCE) return;
    // Strength is the storm's own: a marginal supercell throws an EF1, a
    // full-intensity one an EF4. EF5 stays reserved for a scripted event —
    // the weather should never, unprompted, sweep the map clean.
    const ef = Math.max(1, Math.min(4, 1 + Math.round((w.intensity - STORM_MIN) / (1 - STORM_MIN) * 3)));
    try { T.spawn({ ef: ef, by: null, byPlayer: false }); } catch (e) {}
  }

  if (CBZ.onUpdate) CBZ.onUpdate(34.35, function (dt) {
    if (!CBZ.CONFIG.TORNADO_CITY) { if (live.length) T.clear(); return; }
    director();
    if (!live.length) return;
    const d = dt > 0.25 ? 0.25 : dt;                  // spike-cap: a stalled
                                                      // frame must not teleport
                                                      // the funnel across a block
    for (let i = live.length - 1; i >= 0; i--) {
      const t = live[i];
      t.age += d;
      if (t.age >= t.life) { retire(t, false); continue; }
      move(t, d);
      animateFunnel(t, d);
      worldFx(t, d);
      hitBuildings(t, d);
      scanCars(t, d);
      stepLifted(t, d);
      hitPeople(t, d);
      // the path seam, at the structural cadence rather than per frame
      if (T.onPath) {
        t.tPath = (t.tPath || 0) + d;
        if (t.tPath >= 0.2) { t.tPath = 0; fireHook(T.onPath, snapshot(t)); }
      }
    }
  });

  // A fresh run must not inherit a funnel. cityGlassReset is the existing
  // run-reset chokepoint city/demolition.js and city/structural.js both hang
  // off; wrap it the same lazy, marker-copying way (CLAUDE.md's wrapper rule)
  // so every reset fires and none clobbers the others.
  if (CBZ.onUpdate) CBZ.onUpdate(0.03, function () {
    const orig = CBZ.cityGlassReset;
    if (typeof orig !== "function" || orig._tornadoResetWrapped) return;
    const wrapped = function () { try { T.clear(); } catch (e) {} return orig.apply(this, arguments); };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._tornadoResetWrapped = true;
    CBZ.cityGlassReset = wrapped;
  });

  /* ============================================================
     CBZ.tornadoAudit() — THE RATCHET (BLOCK LAW rule 5).

     Counts VORTEX IMPLEMENTATIONS in the game that are not this one. Each is
     a place where "what does a tornado do to the world" is answered
     separately and can therefore disagree.

       1. systems/disasters.js  survival funnel   -> MIGRATED in this change.
          It now calls CBZ.tornado.spawn/stop and publishes the marker below;
          if that marker ever disappears, this counts again.

     Baseline 1, currently 0. Pin it in tools/math-gate.mjs's PASS block. It
     may only ever DECREASE — copying CBZ.treeAudit()'s contract exactly.
     ============================================================ */
  CBZ.tornadoAudit = function () {
    let n = 0;
    if (CBZ.disasters && !CBZ.disasters._tornadoDelegated) n++;
    return n;
  };

  /* ============================================================
     DEV/QA — read live state from a CDP probe with no rendering, the way
     CLAUDE.md's closed loop wants it (math over live state, never frames).
     ============================================================ */
  T.debug = function () {
    return {
      live: live.length,
      cap: Math.max(1, Math.min(2, CBZ.CONFIG.TORNADO_MAX | 0)),
      liftedCap: liftedCap(),
      vortices: live.map(function (t) {
        return {
          id: t.id, ef: t.ef, x: +t.x.toFixed(1), z: +t.z.toFixed(1),
          R: t.R, vmax: t.vmax, dps: +t.dps.toFixed(2),
          age: +t.age.toFixed(1), life: t.life,
          lifted: t.lifted.length, roofs: t.roofs.size,
        };
      }),
      audit: CBZ.tornadoAudit(),
      flags: {
        city: !!CBZ.CONFIG.TORNADO_CITY,
        structural: !!CBZ.CONFIG.TORNADO_STRUCTURAL,
        lift: !!CBZ.CONFIG.TORNADO_LIFT,
      },
    };
  };
})();
