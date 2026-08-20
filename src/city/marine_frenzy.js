/* ============================================================
   city/marine_frenzy.js — WHAT A KILL LOOKS LIKE FROM A MILE AWAY.

   city/marine_predation.js answers WHO EATS WHOM. This file answers the
   question the owner actually has to be able to answer from the deck of a
   boat with no UI on the screen: SOMETHING IS HAPPENING OVER THERE.

   A marine fight is the least legible event in the game. It is small, it is
   under the surface, it is grey on grey, and by the time you are close enough
   to read two animals fighting it is over. Real sailors do not spot the
   predator — they spot the BIRDS, and the white water under them, and they
   steer for it. That is the entire design of this file:

     1. BAIT BALL. A school of small fish under attack does not scatter, it
        BALLS — a tight sphere that gets tighter and gets driven UP against the
        surface as more predators arrive, and then collapses as it is eaten
        down. It is one InstancedMesh for every fish in the sea, so a couple of
        hundred silver bodies cost one draw call, and it is the single most
        legible marine event there is.

     2. THE BIRDS. Gulls wheel over anything at the surface that is bleeding or
        being eaten, and they dive. Birds are visible from further away than
        anything else in this game because they are ABOVE the water, against
        the sky, and they move. They are the long-range read, and they are what
        makes the player turn the boat.

     3. THE BOIL. White water and blood at the surface, on a cadence scaled by
        how many animals are feeding. Reuses waterSplashAt and goreBloom — no
        new particle system.

     4. SCAVENGERS. A carcass in the water draws a crowd. This is not a fourth
        AI loop: a scavenger is ticked by CBZ.predatorHunt with the carcass as
        its quarry (which is why they CIRCLE it, exactly like the real thing)
        and strikes through creature_combat, the same two drivers every other
        hunter in this repo spends. The only thing this file supplies is
        "the quarry is already dead, so a hit eats it instead of hurting it".

   HOW IT COMPOSES WITH THE REST, which is the whole point of building it on
   top rather than beside: marine_predation's §7 makes a dead or wounded thing
   in the water CHUM; the chum draws sharks; the sharks feeding make a boil;
   the boil draws birds; the birds are what the player sees at 600 m. Every
   arrow in that chain already existed except the last two.

   NO HUD. Same contract as marine_predation.js, for the same reason: the
   owner said it twice. There is not a toast, a marker, an icon or a feed line
   anywhere in this file. Every signal it produces is a thing in the world.

   ALLOCATION-FREE PER FRAME. Two InstancedMeshes for the whole game, both
   built lazily on the first event and never rebuilt; per-instance parameters
   are a fixed table hashed once at load; the matrix compose uses module-scope
   temps; sites live in a fixed pool.

   DISTANCE-GATED HARD. The poll is 2 Hz, every site does one hypot against the
   camera before it decides to draw anything, and a frenzy 8 km away costs the
   pool scan and nothing else.

   DETERMINISM. Nothing here runs at world build. Sites are opened by gameplay
   events, and the per-fish parameters come from an integer hash rather than
   Math.random, so the same ball looks the same in both columns of a preset.
   Per-frame liveliness (a gull deciding to dive) may use Math.random — the
   same split creature_combat.js and arena_fights.js document.

   FLAGS (one-line reverts):
     CBZ.CONFIG.MARINE_FRENZY     the whole file
     CBZ.CONFIG.MARINE_BAITBALL   the bait ball
     CBZ.CONFIG.MARINE_BIRDS      the gulls
     CBZ.CONFIG.MARINE_SCAVENGE   a carcass drawing a crowd

   PUBLIC API
     CBZ.marineFrenzyAt(x, z, opts)   open a site by hand:
                                        {boil:true, seconds, press} white water
                                        and birds over an event; {carcass:actor}
                                        a body; otherwise a bait ball
     CBZ.marineFrenzySites(out)       the live sites
     CBZ.marineScavengeStep(a, dt)    ONE seam, called by marine_predation's
                                      drive: true when scavenging owns the frame
     CBZ.marineFrenzyAudit()          the probe (no gameplay reads it)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || null;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- FLAGS ---------------------------------------------------------------
  if (CFG.MARINE_FRENZY == null) CFG.MARINE_FRENZY = true;
  if (CFG.MARINE_BAITBALL == null) CFG.MARINE_BAITBALL = true;
  if (CFG.MARINE_BIRDS == null) CFG.MARINE_BIRDS = true;
  if (CFG.MARINE_SCAVENGE == null) CFG.MARINE_SCAVENGE = true;
  function ON() { return CFG.MARINE_FRENZY !== false && CFG.MARINE_PREDATION !== false; }
  function BALLS() { return ON() && CFG.MARINE_BAITBALL !== false; }
  function BIRDS() { return ON() && CFG.MARINE_BIRDS !== false; }
  function SCAV() { return ON() && CFG.MARINE_SCAVENGE !== false; }

  // ---- tuning --------------------------------------------------------------
  const SITE_MAX = 3;          // concurrent frenzies. Three is already a lot of sea.
  const FISH_CAP = 260;        // instances in the ONE bait-ball mesh
  const GULL_CAP = 22;         // instances in the ONE gull mesh
  const DRAW_R = 700;          // u — beyond this a site draws nothing
  const BIRD_R = 900;          // u — birds are the LONG read, so they draw further
  const POLL_HZ = 0.5;         // s between site scans (2 Hz)
  const SCHOOL_MIN = 10;       // herd[1] this big and no teeth = a bait species
  const BALL_R0 = 4.2;         // u — a calm ball's radius at species scale 1
  const BALL_TIGHT = 0.42;     // how far in it squeezes at full pressure
  const PRESS_FULL = 3;        // feeders that count as "full pressure"
  const BITE_EVERY = 2.2;      // s between one feeder's mouthfuls
  const FISH_PER_BITE = 6;     // bodies a mouthful takes out of a school
  const COLLAPSE_AT = 0.3;     // fraction of the school left when it breaks up
  const COLLAPSE_S = 3.4;      // s the break-up takes (long enough to SEE)
  const CARCASS_FOOD = 26;     // mouthfuls a whole carcass is worth at scale 1
  const SCAV_R = 260;          // u — how far a scavenger smells a carcass
  const BOIL_EVERY = 0.22;     // s between surface splashes at a busy site

  // ---- module-scope temps (never allocated per frame) ----------------------
  let _t0 = 0, _t1 = 0;
  const _m4 = THREE ? new THREE.Matrix4() : null;
  const _q = THREE ? new THREE.Quaternion() : null;
  const _e = THREE ? new THREE.Euler() : null;
  const _p = THREE ? new THREE.Vector3() : null;
  const _s = THREE ? new THREE.Vector3(1, 1, 1) : null;
  const AUDIT = { sites: 0, baitOpened: 0, baitEaten: 0, carcassOpened: 0, scavengers: 0, birds: 0, hudWrites: 0 };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function actorPos(a) { return a && (a.pos || (a.group && a.group.position)) || null; }
  function camPos() {
    return (CBZ.camera && CBZ.camera.position) || (CBZ.player && CBZ.player.pos) || null;
  }
  function seaY(x, z) {
    if (typeof CBZ.citySeaHeightAt === "function") {
      try { const y = CBZ.citySeaHeightAt(x, z); if (isFinite(y)) return y; } catch (e) {}
    }
    return 0;
  }
  function inWater(x, z) {
    if (typeof CBZ.cityWaterAt === "function") {
      try { return !!CBZ.cityWaterAt(x, z); } catch (e) {}
    }
    return true;
  }

  /* THE HASH. Every per-instance constant in this file comes from here rather
     than from Math.random, so a bait ball is the SAME ball on both sides of a
     before/after pair and in a replay. Integer in, 0..1 out, no state. */
  function h01(i, salt) {
    let n = (i * 374761393 + (salt | 0) * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177 | 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  // ============================================================
  //  §1. THE SITES. A fixed pool. A site is "a place in the sea where
  //  something is being eaten", and it does not care what opened it.
  // ============================================================
  const SITES = [];
  function newSite() {
    return {
      live: false, kind: "bait", ref: null,
      x: 0, y: 0, z: 0, r: BALL_R0, r0: BALL_R0,
      food: 1, food0: 1, fish0: 0, feeders: 0, press: 0, t: 0, eatT: 0,
      collapse: -1, boilT: 0, seedOff: 0, depth: 2.5, birds: 0, ttl: -1,
    };
  }
  for (let i = 0; i < SITE_MAX; i++) SITES.push(newSite());

  function siteFor(ref) {
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live && SITES[i].ref === ref) return SITES[i];
    return null;
  }
  /* A FULL POOL SAYS NO. The first cut recycled the site with the least food
     left whenever it was asked, which meant a busy stretch of sea evicted a
     bait ball every single poll and nothing ever got to finish — the pool
     thrashed and the player saw three half-formed events instead of one good
     one. So a slot is only taken from a site that is genuinely SPENT. */
  const SPENT = 0.34;
  function freeSite() {
    for (let i = 0; i < SITES.length; i++) if (!SITES[i].live) return SITES[i];
    let worst = null;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (s.food / s.food0 > SPENT) continue;
      if (!worst || s.food / s.food0 < worst.food / worst.food0) worst = s;
    }
    if (worst) closeSite(worst);
    return worst;
  }
  function poolFull() {
    for (let i = 0; i < SITES.length; i++) {
      if (!SITES[i].live || SITES[i].food / SITES[i].food0 <= SPENT) return false;
    }
    return true;
  }
  function closeSite(s) {
    s.live = false; s.ref = null; s.feeders = 0; s.press = 0; s.collapse = -1;
  }

  /* A SCHOOL IS TWO NUMBERS, NOT ONE. `fish0` is how many bodies are drawn;
     `food0` is how many MOUTHFULS it takes to eat it. They were the same
     number in the first cut and the ball died in four seconds, because one
     shark bite does not remove one sardine — it removes a handful. */
  function openBait(ref, x, z, r, fish) {
    if (!BALLS()) return null;
    let s = siteFor(ref);
    if (s) return s;
    s = freeSite();
    if (!s) return null;
    s.live = true; s.kind = "bait"; s.ref = ref || null;
    s.x = x; s.z = z; s.y = seaY(x, z) - (ref && ref.swimDepth > 0 ? ref.swimDepth : 2.4);
    s.depth = seaY(x, z) - s.y;
    s.r = s.r0 = r > 0 ? r : BALL_R0;
    s.fish0 = clamp(fish > 0 ? fish : 90, SCHOOL_MIN, 130);
    s.food = s.food0 = Math.max(8, Math.round(s.fish0 / FISH_PER_BITE));
    s.feeders = 0; s.press = 0; s.t = 0; s.collapse = -1; s.boilT = 0; s.eatT = 0; s.ttl = -1;
    s.seedOff = (AUDIT.baitOpened * 37) % FISH_CAP;
    AUDIT.baitOpened++;
    return s;
  }

  function openCarcass(ref) {
    if (!SCAV() || !ref) return null;
    let s = siteFor(ref);
    if (s) return s;
    const p = actorPos(ref);
    if (!p) return null;
    s = freeSite();
    if (!s) return null;
    const scale = (ref.species && ref.species.scale) || 1;
    s.live = true; s.kind = "carcass"; s.ref = ref;
    s.x = p.x; s.z = p.z; s.y = p.y || 0;
    s.depth = Math.max(0, seaY(p.x, p.z) - s.y);
    s.r = s.r0 = Math.max(2.5, scale * 3.4);
    s.fish0 = 0;
    s.food = s.food0 = Math.max(6, Math.round(CARCASS_FOOD * scale));
    s.feeders = 0; s.press = 0; s.t = 0; s.collapse = -1; s.boilT = 0; s.eatT = 0; s.ttl = -1;
    AUDIT.carcassOpened++;
    return s;
  }

  /* A BOIL WITH NOTHING IN IT YET. The third kind of site, and the one an
     outside caller actually wants: "something big just happened at this point
     in the water". No school, no body — just white water and the birds it
     raises, for as long as it is worth looking at. city/marine_predation.js
     spends it the moment a megalodon opens a hull, because a sinking boat with
     men in the water IS a frenzy site and the gulls over it are how you find
     the wreck from the far side of the bay. */
  function openBoil(x, z, secs, press) {
    if (!ON()) return null;
    const s = freeSite();
    if (!s) return null;
    s.live = true; s.kind = "boil"; s.ref = null;
    s.x = x; s.z = z; s.y = seaY(x, z) - 0.5; s.depth = 0.5;
    s.r = s.r0 = 7; s.fish0 = 0;
    s.food = s.food0 = 1;
    s.feeders = 0; s.t = 0; s.collapse = -1; s.boilT = 0; s.eatT = 0;
    s.press = clamp(press == null ? 0.8 : press, 0, 1);
    s.ttl = secs > 0 ? secs : 25;
    return s;
  }

  /* WHAT COUNTS AS A BAIT SPECIES, and it is not a list of fish names. It is
     "no teeth, and the bestiary says it appears in big numbers" — the same
     discipline marine_predation's predation graph uses, read off rows that
     already exist. Sardine (herd up to 60) and mackerel (up to 20) qualify;
     a tuna (up to 9) does not, and neither does anything that bites back. */
  function isBaitSpecies(sp) {
    if (!sp || !sp.aquatic) return false;
    if ((sp.bite || 0) > 0) return false;
    if ((sp.danger || 0) > 0) return false;
    const h = sp.herd;
    return Array.isArray(h) && (+h[1] || 0) >= SCHOOL_MIN;
  }
  function hasTeeth(a) {
    return !!(a && a.species && a.species.aquatic && (a.species.bite || 0) > 0);
  }

  // ============================================================
  //  §2. THE POLL. 2 Hz, one pass over the wildlife list, and it decides
  //  three things: which schools are under attack, which carcasses are in the
  //  water, and how many mouths are at each site.
  // ============================================================
  let pollT = 0;
  function poll(dt) {
    pollT -= dt;
    if (pollT > 0) return;
    pollT = POLL_HZ;
    const list = CBZ.cityWildlife;
    const C = camPos();
    if (!list || !C) return;

    // 1. count the mouths at every live site, and expire the finished ones.
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      if (s.ref) {
        const p = actorPos(s.ref);
        if (!p || s.ref._despawned) { closeSite(s); continue; }
        // a bait ball follows its school; a carcass drifts with the body.
        s.x = p.x; s.z = p.z;
        if (s.kind === "carcass") s.y = p.y || 0;
        if (s.kind === "bait" && s.ref.dead) { s.collapse = s.collapse < 0 ? 0 : s.collapse; }
      }
      _t0 = s.x - C.x; _t1 = s.z - C.z;
      if (_t0 * _t0 + _t1 * _t1 > (BIRD_R * 1.6) * (BIRD_R * 1.6)) { closeSite(s); continue; }
      s.feeders = 0;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !hasTeeth(a)) continue;
      const p = actorPos(a);
      if (!p) continue;
      for (let j = 0; j < SITES.length; j++) {
        const s = SITES[j];
        if (!s.live) continue;
        _t0 = p.x - s.x; _t1 = p.z - s.z;
        const R = s.r * 3 + 8;
        if (_t0 * _t0 + _t1 * _t1 <= R * R) { s.feeders++; break; }
      }
    }

    // 2. open new sites — but not if there is nowhere to put one. This is the
    //    gate that keeps the O(n) scan (and the O(n) hunter check under it)
    //    off the frame budget entirely once the sea is already busy.
    if (poolFull()) { countLive(); return; }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || !a.species || !a.species.aquatic || a.external) continue;
      const p = actorPos(a);
      if (!p) continue;
      _t0 = p.x - C.x; _t1 = p.z - C.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 > DRAW_R * DRAW_R) continue;
      if (a.dead) {
        if (a.skinned || a._mpEaten) continue;
        if (!inWater(p.x, p.z)) continue;
        openCarcass(a);
        continue;
      }
      if (!isBaitSpecies(a.species)) continue;
      if (siteFor(a)) continue;
      // a school only BALLS when something is coming for it.
      let hunters = 0;
      for (let j = 0; j < list.length; j++) {
        const h = list[j];
        if (!h || h.dead || !hasTeeth(h)) continue;
        const q = actorPos(h);
        if (!q) continue;
        _t0 = q.x - p.x; _t1 = q.z - p.z;
        if (_t0 * _t0 + _t1 * _t1 < 130 * 130) { hunters++; if (hunters >= 1) break; }
      }
      if (!hunters) continue;
      const sp = a.species;
      const n = (+(sp.herd && sp.herd[1]) || 30) * 2;
      openBait(a, p.x, p.z, BALL_R0 * (0.7 + (sp.scale || 0.4) * 1.6), n);
    }
    countLive();
  }
  function countLive() {
    AUDIT.sites = 0;
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live) AUDIT.sites++;
  }

  // ============================================================
  //  §3. THE BAIT BALL — ONE InstancedMesh for every fish in the sea.
  //
  //  A ball is a spherical shell of bodies, each on its own slow orbit, and
  //  the two things it does are the two things a real one does: it TIGHTENS
  //  under pressure (radius down, so the silhouette gets denser and harder,
  //  which is exactly the defence — a predator cannot pick one fish out of a
  //  solid wall of them) and it is driven UP against the surface, because
  //  every predator attacks from below and the school's only escape is up.
  //  Then it is eaten down and it COLLAPSES: the shell blows apart and the
  //  survivors scatter. That last second is the money shot.
  // ============================================================
  let fishMesh = null;
  const FISH = [];
  for (let i = 0; i < FISH_CAP; i++) {
    FISH.push({
      th: h01(i, 1) * 6.283185307,
      ph: 0.35 + h01(i, 2) * 2.44,
      rad: 0.55 + h01(i, 3) * 0.45,
      spin: 0.5 + h01(i, 4) * 1.5,
      wob: 1.3 + h01(i, 5) * 2.2,
      sc: 0.72 + h01(i, 6) * 0.5,
    });
  }

  function ensureFishMesh() {
    if (fishMesh || !THREE || !CBZ.scene) return fishMesh;
    // A SLIVER, NOT A FISH. At the range a bait ball is read from, a body is
    // three pixels; what carries is the flash of a pale flank turning. So the
    // geometry is the cheapest thing that can flash, and there are 260 of them
    // for one draw call.
    const geo = new THREE.BoxGeometry(0.4, 0.1, 0.15);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb9c9d2, emissive: 0x1b2b33 });
    fishMesh = new THREE.InstancedMesh(geo, mat, FISH_CAP);
    fishMesh.frustumCulled = false;      // the ball moves; one draw call either way
    fishMesh.castShadow = false;
    fishMesh.count = 0;
    fishMesh.name = "marineBaitBall";
    try { CBZ.scene.add(fishMesh); } catch (e) { fishMesh = null; }
    return fishMesh;
  }

  function drawBalls(dt) {
    const mesh = BALLS() ? ensureFishMesh() : fishMesh;
    if (!mesh) return;
    const C = camPos();
    let w = 0;
    if (BALLS() && C) {
      for (let i = 0; i < SITES.length && w < FISH_CAP; i++) {
        const s = SITES[i];
        if (!s.live || s.kind !== "bait") continue;
        _t0 = s.x - C.x; _t1 = s.z - C.z;
        const d2 = _t0 * _t0 + _t1 * _t1;
        if (d2 > DRAW_R * DRAW_R) continue;
        // LOD: half the bodies past a third of the draw radius. The shape is
        // what reads at range, not the count.
        const lod = d2 > (DRAW_R * 0.34) * (DRAW_R * 0.34) ? 2 : 1;
        w = writeBall(mesh, s, w, lod);
      }
    }
    // only re-upload the buffer when there is (or was) something in it: an
    // empty ocean must not cost a matrix upload every frame.
    if (w > 0 || mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
    mesh.count = w;
  }

  function writeBall(mesh, s, w, lod) {
    const frac = clamp(s.food / s.food0, 0, 1);
    const alive = Math.min(FISH_CAP - w, Math.round(s.fish0 * frac / lod));
    if (alive <= 0) return w;
    // COLLAPSE: the shell blows outward and thins as it goes.
    let R = s.r, spinK = 1;
    if (s.collapse >= 0) {
      const c = clamp(s.collapse / COLLAPSE_S, 0, 1);
      R = s.r * (1 + c * 5.5);
      spinK = 1 + c * 2.5;
    }
    const t = s.t;
    for (let k = 0; k < alive; k++) {
      const f = FISH[(k * lod + s.seedOff) % FISH_CAP];
      const th = f.th + t * f.spin * spinK;
      const ph = f.ph + Math.sin(t * f.wob + f.th) * 0.22;
      const sp = Math.sin(ph), cp = Math.cos(ph);
      const rr = R * f.rad;
      _p.set(s.x + Math.cos(th) * sp * rr, s.y + cp * rr * 0.78, s.z + Math.sin(th) * sp * rr);
      // a fish on an orbit faces along it; +X is forward on every body this
      // repo builds, and the repo's own convention is rotation.y = -heading.
      const head = th + 1.5707963;
      _e.set(Math.sin(t * f.wob) * 0.5, -head, 0);
      _q.setFromEuler(_e);
      const sc = f.sc;
      _s.set(sc, sc, sc);
      _m4.compose(_p, _q, _s);
      mesh.setMatrixAt(w++, _m4);
      if (w >= FISH_CAP) break;
    }
    return w;
  }

  // ============================================================
  //  §4. THE BIRDS. The long-range read, and the only part of a marine kill
  //  that is visible ABOVE the water. One InstancedMesh, one glyph: a shallow
  //  V with a nose and a tail, which is what a gull is at 400 m. The flap is
  //  a roll oscillation rather than a hinged wing — at the range this exists
  //  to be seen from, a rocking V reads as flapping and a hinged wing costs a
  //  second mesh and a second matrix write for a difference nobody can see.
  // ============================================================
  let gullMesh = null;
  const GULLS = [];
  function ensureGullMesh() {
    if (gullMesh || !THREE || !CBZ.scene) return gullMesh;
    const geo = new THREE.BufferGeometry();
    // nose, right tip, left tip, tail — two triangles, +X forward.
    const v = new Float32Array([
      0.34, 0, 0, -0.14, 0.10, 0.62, -0.40, 0, 0,
      0.34, 0, 0, -0.40, 0, 0, -0.14, 0.10, -0.62,
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xf2f4f2, emissive: 0x4a5560, side: THREE.DoubleSide,
    });
    gullMesh = new THREE.InstancedMesh(geo, mat, GULL_CAP);
    gullMesh.frustumCulled = false;
    gullMesh.castShadow = false;
    gullMesh.count = 0;
    gullMesh.name = "marineGulls";
    try { CBZ.scene.add(gullMesh); } catch (e) { gullMesh = null; }
    for (let i = 0; i < GULL_CAP; i++) {
      GULLS.push({
        site: null, ang: h01(i, 11) * 6.283185307, r: 5 + h01(i, 12) * 11,
        h: 5 + h01(i, 13) * 10, spd: 0.5 + h01(i, 14) * 0.5,
        flap: 5 + h01(i, 15) * 5, dive: -1, sc: 0.9 + h01(i, 16) * 0.5,
      });
    }
    return gullMesh;
  }

  /* HOW MANY BIRDS A SITE HAS EARNED. Birds are the amplifier, so they scale
     with how much is actually going on: a lone shark nosing a carcass gets a
     couple, a full frenzy gets the flock. They also work BLOOD with nothing
     else attached to it — gore.js's chum list is polled straight, so the
     player's own bleeding in the water raises birds, which is the cheapest
     possible "you are being hunted and the whole sea knows" cue. */
  function birdDemand(s) {
    let n = 1 + Math.round(clamp(s.press, 0, 1) * 5);
    if (s.kind === "carcass") n += 2;
    // it has to be near enough to the surface for a bird to work it
    const d = seaY(s.x, s.z) - s.y;
    if (d > 9) n = Math.min(n, 1);
    return clamp(n, 0, 8);
  }

  let chumSite = null;
  function chumBirds() {
    // a blood trail with nothing feeding on it yet still gets gulls: they are
    // the first thing to arrive at anything on the surface.
    if (typeof CBZ.goreChumList !== "function") return;
    let list = null;
    try { list = CBZ.goreChumList(); } catch (e) { return; }
    if (!list || !list.length) { chumSite = null; return; }
    const C = camPos();
    if (!C) return;
    let best = null, bd = BIRD_R * BIRD_R;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      _t0 = c.x - C.x; _t1 = c.z - C.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 < bd) { bd = d2; best = c; }
    }
    if (!best) { chumSite = null; return; }
    chumSite = chumSite || { live: true, kind: "chum", x: 0, y: 0, z: 0, r: 5, press: 0.25, ref: null };
    chumSite.x = best.x; chumSite.z = best.z; chumSite.y = seaY(best.x, best.z) - 0.4;
  }

  function drawBirds(dt) {
    const mesh = BIRDS() ? ensureGullMesh() : gullMesh;
    if (!mesh) return;
    const C = camPos();
    let w = 0;
    if (BIRDS() && C) {
      // assign birds to sites: the hot ones first, then the chum slick.
      let want = 0;
      for (let i = 0; i < SITES.length; i++) {
        const s = SITES[i];
        if (!s.live) continue;
        _t0 = s.x - C.x; _t1 = s.z - C.z;
        if (_t0 * _t0 + _t1 * _t1 > BIRD_R * BIRD_R) continue;
        const n = birdDemand(s);
        for (let k = 0; k < n && want < GULL_CAP; k++) GULLS[want++].site = s;
      }
      if (chumSite && want < GULL_CAP) {
        _t0 = chumSite.x - C.x; _t1 = chumSite.z - C.z;
        if (_t0 * _t0 + _t1 * _t1 <= BIRD_R * BIRD_R) {
          for (let k = 0; k < 3 && want < GULL_CAP; k++) GULLS[want++].site = chumSite;
        }
      }
      for (let i = want; i < GULLS.length; i++) GULLS[i].site = null;

      for (let i = 0; i < GULLS.length; i++) {
        const g = GULLS[i];
        const s = g.site;
        if (!s) continue;
        g.ang += dt * g.spd * (0.55 + clamp(s.press, 0, 1) * 0.9);
        // THE DIVE. Liveliness, so Math.random is allowed here (and only here).
        if (g.dive < 0) {
          if (Math.random() < dt * (0.06 + clamp(s.press, 0, 1) * 0.5)) g.dive = 0;
        } else {
          g.dive += dt;
          if (g.dive > 1.5) {
            g.dive = -1;
            splash(s.x + Math.cos(g.ang) * g.r * 0.4, s.z + Math.sin(g.ang) * g.r * 0.4, 0.55);
          }
        }
        const sy = seaY(s.x, s.z);
        let hgt = g.h;
        let rr = g.r;
        if (g.dive >= 0) {
          // down and back up: a parabola through the surface
          const u = clamp(g.dive / 1.5, 0, 1);
          const k = 1 - Math.abs(u * 2 - 1);
          hgt = g.h * (1 - k) + 0.6 * k;
          rr = g.r * (1 - k * 0.6);
        }
        _p.set(s.x + Math.cos(g.ang) * rr, sy + hgt, s.z + Math.sin(g.ang) * rr);
        const head = g.ang + 1.5707963;
        _e.set(Math.sin(g.ang * g.flap) * 0.55, -head, g.dive >= 0 ? -0.5 : -0.08);
        _q.setFromEuler(_e);
        _s.set(g.sc, g.sc, g.sc);
        _m4.compose(_p, _q, _s);
        mesh.setMatrixAt(w++, _m4);
        if (w >= GULL_CAP) break;
      }
    }
    if (w > 0 || mesh.count > 0) mesh.instanceMatrix.needsUpdate = true;
    mesh.count = w;
    AUDIT.birds = w;
  }

  // ============================================================
  //  §5. THE BOIL, and the eating.
  // ============================================================
  function splash(x, z, power) {
    if (typeof CBZ.waterSplashAt !== "function") return;
    try { CBZ.waterSplashAt(x, seaY(x, z), z, clamp(power, 0.4, 4)); } catch (e) {}
  }

  function stepSites(dt) {
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      s.t += dt;
      if (s.ttl > 0) {
        // a BOIL has no mouths to count: it is a fading event, so its pressure
        // is its own remaining life and it closes itself.
        s.ttl -= dt;
        if (s.ttl <= 0) { closeSite(s); continue; }
        s.press = clamp(s.press * (0.55 + 0.45 * clamp(s.ttl / 8, 0, 1)), 0.12, 1);
      } else {
        s.press += (clamp(s.feeders / PRESS_FULL, 0, 1) - s.press) * Math.min(1, dt * 1.6);
      }

      if (s.kind === "bait") {
        /* TIGHTEN AND RISE. Both are the same fact — the predators are under
           it — and both are what makes a ball readable: it gets small and hard
           and it gets pinned against the surface, which is the only reason a
           thing 3 m across is visible from a boat at all. */
        const want = s.r0 * (1 - BALL_TIGHT * s.press);
        s.r += (want - s.r) * Math.min(1, dt * 1.2);
        const sy = seaY(s.x, s.z);
        const wantY = sy - s.depth * (1 - s.press * 0.82) - 0.5;
        s.y += (wantY - s.y) * Math.min(1, dt * 0.8);
      }

      if (s.collapse >= 0) {
        s.collapse += dt;
        if (s.collapse > COLLAPSE_S) closeSite(s);
        continue;
      }

      // THE BOIL. White water where mouths are working, scaled by how many.
      if (s.feeders > 0 || s.kind === "boil") {
        s.boilT -= dt;
        if (s.boilT <= 0) {
          s.boilT = BOIL_EVERY / (0.5 + s.press);
          const a = Math.random() * 6.283185307, rr = Math.random() * s.r * 1.3;
          splash(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, 0.7 + s.press * 1.9);
          if (s.kind === "carcass" && CBZ.goreBloom && Math.random() < 0.5) {
            try { CBZ.goreBloom(s.x, s.y + 0.4, s.z, { amount: 0.5 + s.press }); } catch (e) {}
          }
        }
      }
    }
  }

  /* A MOUTHFUL. Called by whatever is feeding — the bait-ball branch below and
     the scavenger seam in §6 both come through here, so "being eaten" has one
     implementation and one place that can decide the site is finished. */
  function takeBite(s, by) {
    if (!s || !s.live || s.collapse >= 0) return false;
    s.food -= 1;
    AUDIT.baitEaten += (s.kind === "bait") ? 1 : 0;
    splash(s.x + (Math.random() - 0.5) * s.r, s.z + (Math.random() - 0.5) * s.r, 1.1 + s.press);
    if (CBZ.goreBloom) {
      try { CBZ.goreBloom(s.x, s.y + 0.3, s.z, { amount: s.kind === "carcass" ? 1.1 : 0.5 }); } catch (e) {}
    }
    // BLOOD IS THE POINT. Every mouthful chums the water through
    // marine_predation's ONE producer, which is what turns a kill into a
    // crowd — and it is why this file never opens a gore handle itself.
    if (s.ref && typeof CBZ.marineBleed === "function") {
      try { CBZ.marineBleed(s.ref, s.kind === "carcass" ? 0.9 : 0.5); } catch (e) {}
    }
    if (s.kind === "carcass") {
      // eaten away: the body visibly shrinks as the crowd works it.
      const g = s.ref && s.ref.group;
      if (g && g.scale) {
        const k = clamp(0.55 + 0.45 * (s.food / s.food0), 0.5, 1);
        try { g.scale.setScalar(((s.ref.species && s.ref.species.scale) || 1) * (s.ref._sizeMul || 1) * k); } catch (e) {}
      }
    }
    if (s.food <= s.food0 * COLLAPSE_AT) {
      if (s.kind === "bait") {
        s.collapse = 0;
        // the school's anchor is what was actually being eaten: hand its death
        // to the ONE animal damage bus rather than writing hp here.
        if (s.ref && !s.ref.dead && by && typeof CBZ.marineHurt === "function") {
          try { CBZ.marineHurt(s.ref, (s.ref.maxHp || 5) * 2, by, "eaten"); } catch (e) {}
        }
      } else if (s.food <= 0) {
        if (s.ref) s.ref._mpEaten = true;
        closeSite(s);
      }
    }
    return true;
  }

  // ============================================================
  //  §6. SCAVENGERS — THE ONE SEAM. marine_predation's drive calls this when
  //  an animal has nothing living to hunt; true means scavenging owns the
  //  frame. It is CBZ.predatorHunt with a corpse as the quarry, which is why
  //  they circle it, and creature_combat lands the bites — no new AI loop, no
  //  private mover, no second combat path.
  // ============================================================
  const _scratch = [];
  function scavOpts(a) {
    let o = a._mfOpts;
    if (o) return o;
    o = a._mfOpts = {};
    if (typeof CBZ.predatorKit === "function") {
      try { const k = CBZ.predatorKit(a); if (k) for (const key in k) o[key] = k[key]; } catch (e) {}
    }
    const sh = a._shark;
    if (sh && sh.opts && typeof sh.opts.move === "function") o.move = sh.opts.move;
    o.seize = false;
    o.canReach = function () { return true; };
    /* A HIT ON A CORPSE FEEDS, IT DOES NOT DAMAGE. The whole difference
       between scavenging and predation is one function, and this is it. */
    o.onHit = function () {
      const s = a._mfSite;
      if (!s || !s.live) return;
      const now = (a._mfBiteT || 0);
      if (now > 0) return;
      a._mfBiteT = BITE_EVERY;
      takeBite(s, a);
    };
    return o;
  }

  function nearestSite(a, p) {
    let best = null, bd = SCAV_R * SCAV_R;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live || s.collapse >= 0) continue;
      if (s.kind !== "carcass") continue;
      if (s.ref === a) continue;
      _t0 = s.x - p.x; _t1 = s.z - p.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }

  function scavengeStep(a, dt) {
    if (!SCAV() || !a || !(dt > 0) || a.dead || a.tamed || a.ridden || a.external) return false;
    if (!hasTeeth(a)) return false;
    if (a._mfBiteT > 0) a._mfBiteT -= dt;
    const p = actorPos(a);
    if (!p) return false;
    const s = nearestSite(a, p);
    a._mfSite = s;
    if (!s || !s.ref || !s.ref.group) return false;
    let st = "cruise";
    if (typeof CBZ.predatorHunt === "function") {
      try { st = CBZ.predatorHunt(a, s.ref, dt, scavOpts(a)) || "cruise"; } catch (e) { st = "cruise"; }
    }
    // NEVER the player's threat chevron: markers.js reads a.state, and an
    // animal eating a dead fish is not hunting you.
    a.state = "wander";
    if (st === "cruise") return false;
    AUDIT.scavengers++;
    return true;
  }
  CBZ.marineScavengeStep = scavengeStep;

  /* THE BAIT BALL'S OWN FEEDERS. A shark inside a ball is already being driven
     at the school's anchor fish by marine_predation, so nothing has to steer
     it — all this does is turn "a mouth is inside the ball" into mouthfuls,
     which is what actually eats the school down and collapses it. */
  function feedBalls(dt) {
    const list = CBZ.cityWildlife;
    if (!list) return;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live || s.kind !== "bait" || s.collapse >= 0 || !s.feeders) continue;
      s.eatT -= dt;
      if (s.eatT > 0) continue;
      s.eatT = BITE_EVERY / Math.max(1, s.feeders);
      takeBite(s, nearestMouth(s));
    }
  }
  function nearestMouth(s) {
    const list = CBZ.cityWildlife;
    if (!list) return null;
    let best = null, bd = (s.r * 3 + 8) * (s.r * 3 + 8);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !hasTeeth(a)) continue;
      const p = actorPos(a);
      if (!p) continue;
      _t0 = p.x - s.x; _t1 = p.z - s.z;
      const d2 = _t0 * _t0 + _t1 * _t1;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  // ============================================================
  //  PUBLIC — open a site by hand. For a stager, a mission, or a preset that
  //  wants the event without waiting for the sea to produce one.
  // ============================================================
  CBZ.marineFrenzyAt = function (x, z, opts) {
    opts = opts || {};
    if (opts.carcass) return openCarcass(opts.carcass);
    if (opts.boil) return openBoil(x, z, +opts.seconds || 0, opts.press);
    const s = openBait(opts.ref || null, x, z, +opts.r || 0, +opts.count || 100);
    if (s && opts.depth != null) { s.depth = +opts.depth; s.y = seaY(x, z) - s.depth; }
    return s;
  };
  CBZ.marineFrenzySites = function (out) {
    out = out || _scratch;
    out.length = 0;
    for (let i = 0; i < SITES.length; i++) if (SITES[i].live) out.push(SITES[i]);
    return out;
  };
  CBZ.marineFrenzyAudit = function () {
    let bait = 0, carc = 0, food = 0;
    for (let i = 0; i < SITES.length; i++) {
      const s = SITES[i];
      if (!s.live) continue;
      if (s.kind === "bait") bait++; else carc++;
      food += s.food;
    }
    return {
      sites: bait + carc, baitBalls: bait, carcasses: carc, foodLeft: food,
      baitOpened: AUDIT.baitOpened, baitEaten: AUDIT.baitEaten,
      carcassOpened: AUDIT.carcassOpened, scavengerFrames: AUDIT.scavengers,
      birds: AUDIT.birds, fishDrawn: fishMesh ? fishMesh.count : 0,
      hudWrites: AUDIT.hudWrites,
    };
  };
  CBZ.marineFrenzyReset = function () {
    for (let i = 0; i < SITES.length; i++) closeSite(SITES[i]);
    AUDIT.baitOpened = AUDIT.baitEaten = AUDIT.carcassOpened = AUDIT.scavengers = 0;
  };

  // ============================================================
  //  THE UPDATER. onUpdate(47.2): after wildlife.js (47.1) and after
  //  marine_predation's own pass (47.15), because a site's position is read
  //  off bodies those two have already moved this frame. Presentation only —
  //  nothing in here decides who wins a fight.
  // ============================================================
  if (CBZ.onUpdate) {
    CBZ.onUpdate(47.2, function (dt) {
      if (!(dt > 0)) return;
      if (!ON()) {
        if (fishMesh) fishMesh.count = 0;
        if (gullMesh) gullMesh.count = 0;
        return;
      }
      poll(dt);
      stepSites(dt);
      feedBalls(dt);
      chumBirds();
      drawBalls(dt);
      drawBirds(dt);
    });
  }
})();
