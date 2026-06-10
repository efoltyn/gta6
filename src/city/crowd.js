/* ============================================================
   city/crowd.js — instanced BACKGROUND mass crowd for the city.

   Reuses the jail crowd's InstancedMesh body-part technique
   (entities/crowd.js) but is written NATIVELY in city coordinates — no
   prison-zone graph, no z≈-700 offset bookkeeping, no web-worker society
   sim. The near-camera detail and ALL interaction stay with the per-rig
   CBZ.cityPeds; this layer is pure ambient density: hundreds of little
   people walking the sidewalks, filling the streets out to the fog.

   Each agent strolls between sidewalk waypoints (city/world.js
   randomSidewalkPoint, clamped into the city). Six instanced parts per
   body (shirt torso + skin head/arms + pants legs) with per-instance
   tint and a cheap leg/arm stride. The whole thing is ONE Group toggled
   by mode; the simulation is pure math (testable headlessly), and the
   render no-ops where THREE.InstancedMesh is unavailable.

   DISTRICT DENSITY + WARDROBE: this layer IS the visible street
   population, so it must carry the district field (config CITY.districts
   via world.js) or busy-vs-quiet never reads — packed Midtown sidewalks
   are the "loud money" tell (marks, witnesses, cops) and a near-empty
   Dockyard is the "do crime here" tell. Spawn/reseed positions draw from
   world.js weightedSidewalkPoint (pop-weighted, core ~4× the docks) and
   strolls are biased to STAY in the walker's home district, so the
   density gradient holds instead of diffusing flat. Shirt tints cast by
   district kind (bright tourist colour downtown, hi-vis/drab work gear
   on the industrial end) — per-instance colour on the SAME shared
   materials, zero new draw calls, total agent count unchanged.

   THE CITY KEEPS DIFFERENT HOURS: night just got a LOOK (neon, lit
   windows, camp fires) — the street has to TURN OVER with it or the
   fantasy dies. After dusk (peds.js publishes the dusk/dawn flip off the
   canonical CBZ.nightAmount sun clock) the crowd THINS to ~60% and
   REDISTRIBUTES through a night-weighted draw: the core stays packed
   (party-bright wardrobe headed for the neon + the velvet rope),
   residential empties hard, the docks go dead — so the quiet quarters
   become genuinely good places to do crime and bad places to be a
   victim. All of it rides the EXISTING suppress/reseed machinery
   (teleports far from the camera, a few per tick) — no meshes are ever
   created or destroyed, and dawn reverses the whole thing.

   EVERYTHING TOUCHES THE GROUND: the mass crowd never cast real sun
   shadows (castShadow=false — 320 casters would double the shadow
   pass), so the bodies visually FLOATED. One more InstancedMesh of
   ground-flattened radial-gradient blob quads (shared texture/material
   with city/blobshadows.js via CBZ.blobShadowMat) rides the exact same
   per-agent matrix loop: every walker is glued to the pavement, corpses
   get a long smear, and the whole layer is ONE extra draw call.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const CAP = 360;                       // hard ceiling on instanced bodies
  let count = 0, built = false, ready = false;

  // --- agent state (flat arrays; index 0..count-1) ---
  const px = new Float32Array(CAP), pz = new Float32Array(CAP);   // position (world/city coords)
  const tx = new Float32Array(CAP), tz = new Float32Array(CAP);   // current sidewalk target
  const heading = new Float32Array(CAP), spd = new Float32Array(CAP), phase = new Float32Array(CAP);
  const skin = new Int32Array(CAP), shirt = new Int32Array(CAP), hairC = new Int32Array(CAP);

  const SKINS = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3c];
  // 0-9: the everyday base palette. 10-14: BRIGHT tourist/money colours
  // (downtown casting). 15-18: hi-vis + drab canvas work gear (industrial).
  // 19-22: PARTY brights (hot pink/violet/cyan/cream) — the night-core
  // going-out wardrobe, loud under the neon. Plain hex values tinted
  // per-instance — no new materials.
  const SHIRTS = [0x3a6ea5, 0x9c3b3b, 0x4a7a44, 0xb8973f, 0x6a4a8a, 0x444a52, 0xb06a3a, 0x2f8a8a, 0xcfcfcf, 0x356b9a,
                  0xe8e4da, 0xe2574c, 0x4fa3e0, 0xe8c84a, 0xd96bb0,
                  0xe8821a, 0xc6d435, 0x4e453a, 0x5a5e52,
                  0xff2e7a, 0xa44dff, 0x22d4c8, 0xf5e9da];
  const HAIRS = [0x1a1410, 0x2a2018, 0x3b2a1a, 0x6b4a2a, 0x8a6a3a, 0x101010, 0x55524e, 0x4a3520];
  // WHO wears WHAT, by district kind (indexes into SHIRTS): downtown reads
  // moneyed (tourists in colour = walking wallets you can SEE), commercial
  // reads office, industrial reads shift-work, projects read broke/muted.
  // residential (and unknown) falls through to the full base palette.
  const KIND_SHIRTS = {
    core:       [10, 11, 12, 13, 14, 8, 0, 3],
    commercial: [8, 9, 0, 5, 3, 10, 12],
    industrial: [15, 16, 17, 18, 5, 6, 9],
    projects:   [5, 6, 17, 18, 1, 4],
  };
  // after dark the core dresses for the rope: party brights, not daypacks.
  const NIGHT_KIND_SHIRTS = { core: [19, 20, 21, 22, 14, 12] };

  // ---- THE NIGHT FIELD ----
  // Where the street lives by hour. Day density comes from world.js's
  // pop-weighted draw; after dusk we draw from THIS table instead: the lit
  // core packs out, residential empties hard, the docks go dead. The same
  // numbers drive the turnover relocations, so the field self-corrects.
  const NIGHT_KIND_W = { core: 4.6, commercial: 0.9, projects: 1.5, residential: 0.35, industrial: 0.12 };
  const NIGHT_DENSITY = 0.6;              // the street holds ~60% of the day crowd after dark
  const TURNOVER_FRAC = 0.5;              // share of the crowd reconsidered at each dusk/dawn flip
  let nightShift = false;                 // local copy of peds.js's dusk/dawn flip (CBZ.cityNightShift)
  let turnover = 0, _turnScan = 0;        // relocation budget + rolling cursor (spent in thin())
  function nightNow() {
    // peds.js owns the hysteresis flip off the ONE canonical sun clock
    // (CBZ.nightAmount); fall back to the raw dusk threshold if it's absent.
    return CBZ.cityNightShift ? CBZ.cityNightShift() : (CBZ.nightAmount == null ? 0 : CBZ.nightAmount) > 0.6;
  }
  // per-lot cumulative night weights, built once per arena (lots carry their
  // stamped district quadrant; annex/island lots fall to a low filler weight).
  let _ncA = null, _nc = null;
  function nightCum(A) {
    if (_ncA === A && _nc) return _nc;
    _ncA = A;
    const lots = A.lots, cum = new Float64Array(lots.length);
    let t = 0;
    for (let k = 0; k < lots.length; k++) {
      const d = A.districts && typeof lots[k].district === "number" ? A.districts[lots[k].district] : null;
      t += d && NIGHT_KIND_W[d.kind] != null ? NIGHT_KIND_W[d.kind] : 0.4;
      cum[k] = t;
    }
    return (_nc = { cum, total: t });
  }

  let root, wm = null;
  // full body + FACE so the city crowd reads as PEOPLE, not short faceless boxes —
  // same parts + proportions as the jail mass-crowd (entities/crowd.js).
  let torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth, meshes = null;
  // EVERYTHING TOUCHES THE GROUND: one extra InstancedMesh of ground-flattened
  // blob quads — every walker drops a soft contact shadow, ALL ~320 of them in
  // ONE draw call. The crowd never casts real sun shadows (castShadow=false on
  // every part below), so this blob IS what glues the mass to the pavement.
  let shadowQ = null;
  const rootD = new THREE.Object3D(), partD = new THREE.Object3D(), col = new THREE.Color();
  const shadD = new THREE.Object3D();    // shadow-quad matrix compose scratch (zero per-frame alloc)

  // ---- ONE shared blob-shadow texture/material for the whole city ----
  // (city/blobshadows.js draws the full-rig ped/car blobs with the SAME
  // material — defined guarded in both files so script order doesn't matter;
  // first caller builds it, everyone else reuses CBZ._blobShadowMat.)
  CBZ.blobShadowMat = CBZ.blobShadowMat || function () {
    if (CBZ._blobShadowMat !== undefined) return CBZ._blobShadowMat;
    let tex = null;
    if (typeof document !== "undefined" && document.createElement && THREE.CanvasTexture) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const ctx = c.getContext && c.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, "rgba(0,0,0,0.55)");
        grad.addColorStop(0.6, "rgba(0,0,0,0.34)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        tex = new THREE.CanvasTexture(c);
      }
    }
    // headless / no-DOM: no texture → no material (callers guard on null)
    if (!tex || !THREE.MeshBasicMaterial) return (CBZ._blobShadowMat = null);
    CBZ._blobShadowMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,            // never occludes, never z-buffers
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // floats clear of the road plane
    });
    return CBZ._blobShadowMat;
  };

  // ---- ON-DEMAND PROMOTION (same idea as the jail mass-crowd face-rigs) ----
  // The nearest ambient agents become REAL, fully interactive city peds (added
  // to CBZ.cityPeds, so the ped brain @34 AND the city interaction menu just
  // work on them) as you walk up, then get parked back to instanced density
  // when you walk away. Without this the city crowd was render-only and dead to
  // interaction — you could walk into someone and nothing happened.
  const PROMO = 18;                              // pool of interactive peds kept near you
  const PROMO_IN2 = 22 * 22;                     // promote-in radius (any direction)
  // FAR REACH: an agent in your sightline (ahead of the camera) gets promoted to a
  // real, shoot/run-over-able ped from much farther out, so anyone you can SEE down
  // the street is fully real before you reach them — not a phantom that pops in.
  const PROMO_AHEAD2 = 40 * 40;                  // promote-in distance for agents in front of you
  const AHEAD_DOT = 0.35;                        // cone half-width for "ahead of the camera"
  // demote-out must sit BEYOND the farthest promote-in (the ahead range) so a
  // body promoted way down the street doesn't instantly flicker back to density.
  const PROMO_OUT2 = 48 * 48;                    // hysteresis: park only past this
  const PARK = -4000;                            // where parked pool peds wait, off-map
  const promotedBy = new Int32Array(CAP);        // crowd index -> pool slot (or -1)
  const deadAgent = new Uint8Array(CAP);         // agent fully removed (corpse faded)
  const corpseT = new Float32Array(CAP);         // >0 = freshly killed, lying as a body for this many sec
  // THINNING: as the finite city population is killed off, a growing share of the
  // surviving ambient agents go "off-street" (suppressed) so the rendered density
  // tracks the remaining headcount — the streets EMPTY after a massacre instead of
  // staying magically full. Suppressed agents aren't dead (they don't reduce the
  // living total); they're parked off-map and skipped by sim/render/reseed/promote
  // until the target density says the street should hold more people again.
  const suppressed = new Uint8Array(CAP);
  let liveTarget = CAP;                           // how many agents should be ON the street
  let pool = [], poolBuilt = false;               // interactive-promotion pool (declaration was dropped when thinning was added)
  promotedBy.fill(-1);

  // a UNIT (1×1×1) box scaled per-part at render time, jail-crowd style. Tinted
  // parts need a white color attribute (r128 USE_COLOR multiplies by 0 → black);
  // solid parts (legs/eyes/mouth) use a plain unit box.
  function tintUnit() {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const n = g.attributes.position.count, white = new Float32Array(n * 3); white.fill(1);
    g.setAttribute("color", new THREE.BufferAttribute(white, 3));
    return g;
  }

  function buildMeshes() {
    if (built) return;
    if (!THREE.InstancedMesh) return;    // headless / no-instancing → sim only, no render
    built = true;
    wm = new THREE.Matrix4();
    root = new THREE.Group(); root.name = "city-crowd"; root.visible = false;
    CBZ.scene.add(root);
    const unitT = tintUnit();                              // shared geom for all tinted parts
    const unitP = new THREE.BoxGeometry(1, 1, 1);          // shared geom for solid parts
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const pants = CBZ.mat ? CBZ.mat(0x2c3038) : new THREE.MeshLambertMaterial({ color: 0x2c3038 });
    const dark = CBZ.mat ? CBZ.mat(0x141414) : new THREE.MeshLambertMaterial({ color: 0x141414 });
    function part(mat, geo) {
      const m = new THREE.InstancedMesh(geo, mat, CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
      root.add(m); return m;
    }
    torso = part(shirtMat, unitT);
    hd = part(skinMat, unitT);
    hair = part(hairMat, unitT);
    armL = part(skinMat, unitT); armR = part(skinMat, unitT);
    legL = part(pants, unitP); legR = part(pants, unitP);
    eyeL = part(dark, unitP); eyeR = part(dark, unitP); mouth = part(dark, unitP);
    meshes = [torso, hd, hair, armL, armR, legL, legR, eyeL, eyeR, mouth];
    // the ground-contact blob layer: one more instanced draw for the whole mass
    const smat = CBZ.blobShadowMat ? CBZ.blobShadowMat() : null;
    if (smat && THREE.PlaneGeometry) {
      shadowQ = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smat, CAP);
      shadowQ.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      shadowQ.castShadow = false; shadowQ.receiveShadow = false; shadowQ.frustumCulled = false;
      // park ALL slots off-map up front: instances ≥ count would otherwise sit
      // as identity matrices — visible dark quads stacked at the origin.
      wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
      for (let i = 0; i < CAP; i++) shadowQ.setMatrixAt(i, wm);
      shadowQ.instanceMatrix.needsUpdate = true;
      root.add(shadowQ);
    }
    ready = true;
  }

  function arena() { return CBZ.city && CBZ.city.arena; }
  const _tmp = { x: 0, z: 0 };
  const _col = { x: 0, z: 0 };            // scratch for building collision in sim()

  // ---- DISTRICT-AWARE WAYPOINTS ----
  // lots grouped by district quadrant, built lazily per arena (world.js stamps
  // l.district once at build; deterministic — no rng spent here).
  let _dlA = null, _dlMap = null;
  function districtLots(A) {
    if (_dlA === A && _dlMap) return _dlMap;
    _dlA = A; _dlMap = {};
    if (A.lots) for (let k = 0; k < A.lots.length; k++) {
      const l = A.lots[k], q = l.district;
      if (q == null || typeof q !== "number") continue;     // annex/island lots: unstamped
      (_dlMap[q] || (_dlMap[q] = [])).push(l);
    }
    return _dlMap;
  }
  function sidewalkOnLot(l, out) {        // same ring math as world.js sidewalkOf
    const edge = (Math.random() * 4) | 0, t = (Math.random() - 0.5) * l.w;
    const off = l.w / 2 + 1.6;
    if (edge === 0) { out.x = l.cx + t; out.z = l.cz - off; }
    else if (edge === 1) { out.x = l.cx + t; out.z = l.cz + off; }
    else if (edge === 2) { out.x = l.cx - off; out.z = l.cz + t; }
    else { out.x = l.cx + off; out.z = l.cz + t; }
  }
  // a downtown walker strolls DOWNTOWN: most repicks stay in the walker's home
  // district; the rest fall through to the city-wide weighted draw, so a
  // little cross-district flow remains and the global density gradient holds.
  const STAY = 0.8;
  // the city-wide draw for the CURRENT hour: pop-weighted by day, night-field
  // weighted after dusk. ALL spawn/reseed/relocation positions come through
  // here, so flipping ONE flag re-shapes where the whole street lives.
  function drawPoint(out) {
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    if (nightShift && A.lots && A.lots.length && A.districts) {
      const nc = nightCum(A);
      if (nc.total > 0) {
        const x = Math.random() * nc.total;
        let lo = 0, hi = nc.cum.length - 1;                    // binary-search the cum table
        while (lo < hi) { const mid = (lo + hi) >> 1; if (nc.cum[mid] < x) lo = mid + 1; else hi = mid; }
        sidewalkOnLot(A.lots[lo], out);
        if (A.clampToCity) A.clampToCity(out, 0.6);
        return;
      }
    }
    const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(Math.random) : A.randomSidewalkPoint();
    if (A.clampToCity) A.clampToCity(p, 0.6);
    out.x = p.x; out.z = p.z;
  }
  // pickWaypoint(out)         → hour-weighted city-wide point (spawn/reseed)
  // pickWaypoint(out, ax, az) → stroll target biased into (ax,az)'s district
  function pickWaypoint(out, ax, az) {
    const A = arena(); if (!A) { out.x = 0; out.z = 0; return; }
    if (ax !== undefined && A.districtAt && A.lots && Math.random() < STAY) {
      const home = A.districtAt(ax, az);
      // AFTER DARK a dead quarter doesn't hold its walkers: a stroller in a
      // night-dead district (residential/docks) usually heads for the lights
      // instead of pacing an empty block, so the emptying reads as an exodus.
      const deadHere = nightShift && home && (NIGHT_KIND_W[home.kind] == null || NIGHT_KIND_W[home.kind] < 0.5) && Math.random() < 0.65;
      const ls = home && !deadHere ? districtLots(A)[home.q] : null;
      if (ls && ls.length) {
        sidewalkOnLot(ls[(Math.random() * ls.length) | 0], out);
        if (A.clampToCity) A.clampToCity(out, 0.6);
        return;
      }
    }
    drawPoint(out);
  }
  // cast the shirt for wherever this agent stands (district wardrobe above);
  // skin/hair stay city-wide. Used at spawn and when a body is recycled into
  // a NEW district (it walks in as a local, not a teleported stranger).
  function castTint(i, x, z) {
    const A = arena();
    const d = A && A.districtAt ? A.districtAt(x, z) : null;
    // night in the core dresses for the line — party brights under the neon
    const pool = d && ((nightShift && NIGHT_KIND_SHIRTS[d.kind]) || KIND_SHIRTS[d.kind]);
    shirt[i] = pool ? pool[(Math.random() * pool.length) | 0] : ((Math.random() * 10) | 0);
  }
  function repaintShirt(i) {              // recolour one recycled body in-place
    if (!ready) return;
    col.setHex(SHIRTS[shirt[i]]); torso.setColorAt(i, col);
    if (torso.instanceColor) torso.instanceColor.needsUpdate = true;
  }

  CBZ.spawnCityCrowd = function (n) {
    buildMeshes();
    const A = arena(); if (!A) { count = 0; return 0; }
    count = Math.max(0, Math.min(CAP, n | 0));
    if (poolBuilt) releaseAll();                 // un-assign any held peds before re-seeding
    promotedBy.fill(-1); deadAgent.fill(0); corpseT.fill(0); suppressed.fill(0);
    liveTarget = count;                          // full street at the start of a run
    for (let i = 0; i < count; i++) {
      // pop-weighted spawn (Midtown packed, Dockyard thin), then a stroll
      // target inside the home district so the gradient survives the walking.
      pickWaypoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;
      pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z;
      heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
      spd[i] = 1.0 + Math.random() * 1.6;
      phase[i] = Math.random() * 6.2832;
      skin[i] = (Math.random() * SKINS.length) | 0;
      castTint(i, px[i], pz[i]);
      hairC[i] = (Math.random() * HAIRS.length) | 0;
    }
    paintColors();
    if (ready) {
      // park EVERY slot ≥ count across ALL body parts + the blob, so a re-seed
      // to a smaller crowd can never strand stale frozen bodies (or detached
      // face parts) from a previous, larger run — render() only writes 0..count-1.
      wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
      for (let i = count; i < CAP; i++) {
        for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, wm);
        if (shadowQ) shadowQ.setMatrixAt(i, wm);
      }
      render(0);                 // place them so frame 0 isn't a pile at the origin
    }
    return count;
  };
  CBZ.cityCrowdReset = function () { CBZ.spawnCityCrowd(count || ((CBZ.CITY && CBZ.CITY.crowd) || 320)); };
  // tiny debug accessors (used by the headless harness; cheap, read-only)
  CBZ.cityCrowdCount = function () { return count; };
  CBZ.cityCrowdAgent = function (i) { return { x: px[i], z: pz[i], tx: tx[i], tz: tz[i], heading: heading[i] }; };

  function paintColors() {
    if (!ready) return;
    for (let i = 0; i < count; i++) {
      col.setHex(SHIRTS[shirt[i]]); torso.setColorAt(i, col);
      col.setHex(SKINS[skin[i]]); hd.setColorAt(i, col); armL.setColorAt(i, col); armR.setColorAt(i, col);
      col.setHex(HAIRS[hairC[i]]); hair.setColorAt(i, col);
    }
    [torso, hd, hair, armL, armR].forEach(function (m) { if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }

  // pure-math simulation: stroll toward the target, repick on arrival.
  let _simFrame = 0;                       // for the collide stride time-slice
  function sim(dt) {
    const A = arena(); if (!A) return;
    const frame = _simFrame++;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i]) continue;
      if (corpseT[i] > 0) { corpseT[i] -= dt; if (corpseT[i] <= 0) deadAgent[i] = 1; continue; }  // lying dead → fade out
      if (suppressed[i]) continue;                        // off-street (thinned out) → don't walk it
      if (promotedBy[i] >= 0) continue;                   // a real promoted ped owns this one
      let dx = tx[i] - px[i], dz = tz[i] - pz[i], d = Math.hypot(dx, dz);
      if (d < 1.4) { pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z; dx = tx[i] - px[i]; dz = tz[i] - pz[i]; d = Math.hypot(dx, dz); }
      const inv = 1 / (d || 1);
      const want = Math.atan2(dx, dz);
      heading[i] = CBZ.lerpAngle ? CBZ.lerpAngle(heading[i], want, 1 - Math.pow(0.0015, dt)) : want;
      const step = spd[i] * dt;
      px[i] += dx * inv * step; pz[i] += dz * inv * step;
      phase[i] += spd[i] * 2.4 * dt;
      // STOP THE NAMELESS AMBIENT CROWD WALKING THROUGH WALLS: the stroll above is
      // a straight line to a random sidewalk point, which cuts THROUGH the building
      // in the middle of a block. EVERY agent is RENDERED (no far-cull), so EVERY
      // agent must collide — a camera-distance gate let the whole mid/far crowd walk
      // through buildings in plain sight. collide() is grid-accelerated (~O(local
      // walls)), so it's cheap; we still time-slice 1/3 of the crowd per frame (the
      // per-frame step is tiny, so a body can't tunnel a wall in the 2 frames it's
      // skipped) to keep the 360-strong crowd light. feetY/headY 0..1.7 hits full
      // walls but ignores high window panes. 2-PASS DEPENETRATION (mirrors peds.js):
      // one push at a corner can shove a body OUT of one wall and INTO the next, so
      // a second pass resolves that — a straight-line stroll can't squeeze a thin
      // wall in a single push. Stop early once a pass no longer moves the body.
      if (CBZ.collide && ((frame + i) % 3 === 0)) {
        _col.x = px[i]; _col.z = pz[i];
        for (let pass = 0; pass < 2; pass++) {
          const bx = _col.x, bz = _col.z;
          CBZ.collide(_col, 0.5, 0, 1.7);
          if (Math.abs(_col.x - bx) < 0.002 && Math.abs(_col.z - bz) < 0.002) break;
        }
        if (_col.x !== px[i] || _col.z !== pz[i]) {
          px[i] = _col.x; pz[i] = _col.z;            // shoved out of the wall
          pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z;   // repick so it doesn't grind back in
        }
      }
    }
  }

  function put(mesh, i, lx, ly, lz, sx, sy, sz, rx) {
    partD.position.set(lx, ly, lz);
    partD.rotation.set(rx || 0, 0, 0);
    partD.scale.set(sx, sy, sz);
    partD.updateMatrix();
    wm.multiplyMatrices(rootD.matrix, partD.matrix);
    mesh.setMatrixAt(i, wm);
  }
  // the 10 body parts at standard proportions (matches the jail mass-crowd)
  function drawParts(i, sw, bob) {
    put(torso, i, 0, 1.42 + bob, 0, 0.82, 0.88, 0.44, 0);
    put(hd, i, 0, 2.18 + bob, 0, 0.54, 0.54, 0.54, 0);
    put(hair, i, 0, 2.50 + bob, 0, 0.58, 0.14, 0.58, 0);
    put(legL, i, -0.20, 0.52, 0, 0.28, 0.92, 0.28, sw);
    put(legR, i, 0.20, 0.52, 0, 0.28, 0.92, 0.28, -sw);
    put(armL, i, -0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, -sw * 0.82);
    put(armR, i, 0.55, 1.40 + bob, 0, 0.24, 0.78, 0.24, sw * 0.82);
    // FACE — the head box is 0.54 deep (front face at local z 0.27). The old
    // z 0.235 + 0.06-deep eyes put the face's FRONT at 0.265 — fully BURIED
    // inside the head, so the whole instanced crowd read as faceless mannequins.
    // Deep boxes centred at z 0.25 stick ~0.04 proud of the face AND wrap back
    // into the head, so eyes/mouth read from any reasonable angle, not just
    // dead-on. Same instances, zero new draw calls.
    put(eyeL, i, -0.12, 2.235 + bob, 0.25, 0.11, 0.14, 0.12, 0);
    put(eyeR, i, 0.12, 2.235 + bob, 0.25, 0.11, 0.14, 0.12, 0);
    put(mouth, i, 0, 2.045 + bob, 0.255, 0.22, 0.055, 0.10, 0);
  }
  function render() {
    if (!ready || !count) return;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || suppressed[i] || promotedBy[i] >= 0) {  // faded corpse, thinned off-street, or promoted to a real rig → collapse the instanced body
        wm.makeScale(0.0001, 0.0001, 0.0001); wm.setPosition(0, PARK, 0);
        for (let m = 0; m < meshes.length; m++) meshes[m].setMatrixAt(i, wm);
        if (shadowQ) shadowQ.setMatrixAt(i, wm);   // blob collapses with the body
        continue;
      }
      if (corpseT[i] > 0) {                            // freshly killed → lie flat ON the ground
        // Rotating the standing rig 90° about X lays it on its back: each part's
        // local +Z (body depth) becomes the world-vertical extent. The thickest
        // parts (head/torso, ~0.27 half-depth) set how high the whole body must
        // ride so NOTHING sinks below the surface — lift the lying body to ~0.42
        // above the floor so it rests cleanly ON the ground, not bisected by it.
        const fy = (CBZ.floorAt ? CBZ.floorAt(px[i], pz[i]) : 0) + 0.42;
        rootD.position.set(px[i], fy, pz[i]);
        rootD.rotation.set(Math.PI / 2, heading[i], 0);
        rootD.scale.set(1, 1, 1);
        rootD.updateMatrix();
        drawParts(i, 0, 0);
        if (shadowQ) {                               // the dead still touch the ground:
          shadD.position.set(px[i], fy - 0.38, pz[i]);   // floor + 0.04 (fy carries the 0.42 lying lift)
          shadD.rotation.set(-Math.PI / 2, 0, heading[i]);   // long smear aligned under the lying body
          shadD.scale.set(1.5, 2.3, 1);
          shadD.updateMatrix();
          shadowQ.setMatrixAt(i, shadD.matrix);
        }
        continue;
      }
      rootD.position.set(px[i], 0, pz[i]);
      rootD.rotation.set(0, heading[i], 0);
      rootD.scale.set(1, 1, 1);
      rootD.updateMatrix();
      const sn = Math.sin(phase[i]);
      drawParts(i, sn * 0.5, Math.abs(Math.cos(phase[i])) * 0.05);
      if (shadowQ) {
        shadD.position.set(px[i], 0.04, pz[i]);      // a hair above the pavement (+ polygonOffset)
        shadD.rotation.set(-Math.PI / 2, 0, 0);
        const ss = 1.18 + Math.abs(sn) * 0.22;       // stride spreads the contact patch — reads as WALK
        shadD.scale.set(ss, ss * 0.94, 1);
        shadD.updateMatrix();
        shadowQ.setMatrixAt(i, shadD.matrix);
      }
    }
    for (let m = 0; m < meshes.length; m++) meshes[m].instanceMatrix.needsUpdate = true;
    if (shadowQ) shadowQ.instanceMatrix.needsUpdate = true;
  }

  // ---- promotion pool: real makeCharacter peds reused as you move ----
  // isolate a pooled rig's tinted materials once so recolouring it per agent
  // can't bleed onto the shared material cache.
  function cloneLook(ped) {
    const ch = ped.char; if (!ch) return;
    const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
    if (ch.head && ch.head.material) ch.head.material = ch.head.material.clone();
    const ss = ch.skinSlots || {};
    iso(ss.hands); iso(ss.arms); iso(ss.hair); iso(ss.torso); iso(ss.collar);
  }
  function setLook(ped, skinHex, shirtHex, hairHex) {
    const ch = ped.char; if (!ch) return;
    const paint = (arr, hex) => (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(hex); });
    if (ch.head && ch.head.material && ch.head.material.color) ch.head.material.color.setHex(skinHex);
    const ss = ch.skinSlots || {};
    paint(ss.hands, skinHex); paint(ss.arms, skinHex); paint(ss.hair, hairHex);
    paint(ss.torso, shirtHex); paint(ss.collar, shirtHex);
  }
  function makePooled() {
    const A = arena();
    const ped = CBZ.cityMakePed(PARK, PARK, Math.random, { kind: "civilian" });
    ped._crowd = true; ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    cloneLook(ped);
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    return ped;
  }
  function buildPool() {
    if (poolBuilt) return;
    if (!arena() || !CBZ.cityMakePed || !CBZ.cityPeds) return;
    pool = [];
    for (let s = 0; s < PROMO; s++) pool.push({ ped: makePooled(), idx: -1 });
    poolBuilt = true;
  }
  function park(e) {
    const ped = e.ped;
    ped._parked = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); ped.target.set(PARK, 0, PARK);
    ped.rage = null; ped.mem = null; ped.state = "walk"; ped.path = null; ped.finalGoal = null;
    e.idx = -1;
  }
  function assign(e, s, i) {
    const ped = e.ped;
    e.idx = i; promotedBy[i] = s;
    ped._parked = false; ped.dead = false; ped.deadT = 0; ped.ko = 0; ped.culled = false; ped.collected = false; ped.needsPickup = false;
    ped.pos.set(px[i], 0, pz[i]); ped.char.group.rotation.y = heading[i];
    ped.target.set(px[i], 0, pz[i]);
    ped.group.visible = true;
    ped.state = "walk"; ped.path = null; ped.finalGoal = null; ped.pause = 0.2 + Math.random() * 0.6;
    setLook(ped, SKINS[skin[i]], SHIRTS[shirt[i]], HAIRS[hairC[i]]);
    // every promotion is a NEW person stepping out of the mass — recast its
    // dials for the hour + district it lands in (peds.js owns the table), so
    // a body promoted at 3am in the projects walks in as a crook, not a
    // tourist. Reset the phase stamp so the recast applies per-assignment.
    if (CBZ.cityRecastForHour) { ped._castNight = void 0; CBZ.cityRecastForHour(ped, Math.random); }
  }
  function releaseAll() {
    if (!poolBuilt) return;
    for (let s = 0; s < pool.length; s++) { const e = pool[s]; if (e.idx >= 0) { promotedBy[e.idx] = -1; park(e); } }
  }
  function updatePromotion() {
    // multiplayer guest: the crowd is pure local set-dressing — never promote
    // an agent into a real simulated ped (the host owns the real population)
    if (CBZ.net && CBZ.net.noSim()) return;
    if (!poolBuilt) { buildPool(); if (!poolBuilt) return; }
    const P = CBZ.player; if (!P) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    // 1) reconcile currently-promoted slots
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx < 0) continue;
      const i = e.idx, ped = e.ped;
      if (ped.dead) { deadAgent[i] = 1; promotedBy[i] = -1; pool[s] = { ped: makePooled(), idx: -1 }; continue; } // killed → consume agent, fresh pool ped
      px[i] = ped.pos.x; pz[i] = ped.pos.z; heading[i] = ped.char.group.rotation.y;   // mirror live motion back
      const dx = ped.pos.x - ppx, dz = ped.pos.z - ppz;
      // keep YOUR killer promoted + on-map while you spectate it after WASTED
      // (city/death.js sets g._citySpecTarget); otherwise this park-on-death sweep
      // would banish a crowd-pool killer off-map and the kill-cam would orbit empty
      // space. Everyone else parks as usual.
      if (CBZ.game._citySpecTarget && ped === CBZ.game._citySpecTarget) continue;
      // the velvet-rope LINE (club.js) drafts promoted crowd bodies like any
      // other nearby civilian — never park one mid-queue, or the line holds a
      // ghost slot pointing at an off-map body. It re-parks once released.
      if (ped._clubLine || ped._clubGoingIn) continue;
      if (P.dead || P.driving || dx * dx + dz * dz > PROMO_OUT2) { promotedBy[i] = -1; park(e); }   // walked away → back to density
    }
    if (P.dead || P.driving) return;
    // camera facing (city look dir): used to extend promotion reach for agents
    // you're looking AT, so distant NPCs down your sightline are real by the time
    // you draw a bead on them — you can shoot or run anyone you can see.
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // 2) promote agents into any free slots: nearby in any direction, OR farther
    //    out but inside the forward cone. Score = squared distance, but agents in
    //    front get their effective range pushed out to PROMO_AHEAD2.
    for (let s = 0; s < pool.length; s++) {
      const e = pool[s]; if (e.idx >= 0) continue;
      let best = -1, bd = PROMO_AHEAD2;
      for (let i = 0; i < count; i++) {
        if (promotedBy[i] >= 0 || deadAgent[i] || suppressed[i]) continue;
        const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
        if (d2 >= bd) continue;
        // near in any direction, OR ahead of the camera within the far range
        const dn = Math.sqrt(d2) || 1;
        const ahead = (dx / dn) * fx + (dz / dn) * fz >= AHEAD_DOT;
        const range = ahead ? PROMO_AHEAD2 : PROMO_IN2;
        if (d2 < range && d2 < bd) { bd = d2; best = i; }
      }
      if (best < 0) break;
      assign(e, s, best);
      // ONE promotion per frame: filling every free slot in one frame is
      // O(slots×agents) (worst ~18×360 sqrt scans after a mass release);
      // refilling over ~0.3s instead is invisible at promotion distances.
      break;
    }
  }
  // ---- AHEAD RESEED: bias density toward where the player is looking/heading ----
  // Agents wander randomly across the whole city, so the street ahead of you can
  // end up sparse — a ghost world. Each frame we cheaply recycle a FEW distant,
  // non-promoted, living agents to fresh sidewalk points out in front of the
  // camera (just past promotion reach, so they're real-and-ready as you advance).
  // No new bodies are spawned (cap is fixed); we just teleport far ones forward.
  const AHEAD_NEAR = 30, AHEAD_FAR = 64;          // ring out in front to seed into
  const RESEED_BEHIND2 = 70 * 70;                 // only recycle agents this far away
  let reseedScan = 0;
  function aheadReseed() {
    const P = CBZ.player; if (!P || P.dead) return;
    const A = arena(); if (!A || !A.randomSidewalkPoint) return;
    const ppx = P.pos.x, ppz = P.pos.z;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let moved = 0, scanned = 0;
    // walk a rolling window of agents (a few per frame) so the cost is bounded
    for (let n = 0; n < count && scanned < 40 && moved < 2; n++) {
      const i = reseedScan; reseedScan = (reseedScan + 1) % Math.max(1, count); scanned++;
      if (deadAgent[i] || corpseT[i] > 0 || promotedBy[i] >= 0 || suppressed[i]) continue;
      const dx = px[i] - ppx, dz = pz[i] - ppz, d2 = dx * dx + dz * dz;
      if (d2 < RESEED_BEHIND2) continue;          // already close enough to matter
      // is this far agent BEHIND / off to the side? if so, recycle it ahead.
      const dn = Math.sqrt(d2) || 1;
      if ((dx / dn) * fx + (dz / dn) * fz > 0.2) continue;  // already roughly ahead → leave it
      // find a sidewalk point inside the forward ring (a few tries). The draw
      // is HOUR-WEIGHTED (pop field by day, night field after dusk), so what
      // fills in ahead of you follows the live district field: walk Midtown
      // and the street ahead packs out; walk the Dockyard (or anywhere at
      // 3am) and most draws land elsewhere and fail the ring test — quiet
      // STAYS quiet instead of magically filling because you looked at it.
      for (let t = 0; t < 4; t++) {
        drawPoint(_tmp);
        const rx = _tmp.x - ppx, rz = _tmp.z - ppz, rd = Math.hypot(rx, rz) || 1;
        if (rd < AHEAD_NEAR || rd > AHEAD_FAR) continue;
        if ((rx / rd) * fx + (rz / rd) * fz < AHEAD_DOT) continue;
        px[i] = _tmp.x; pz[i] = _tmp.z;
        castTint(i, px[i], pz[i]); repaintShirt(i);   // recycled body dresses like a LOCAL
        pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z;
        heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
        moved++; break;
      }
    }
  }

  // ---- COMBAT: the ambient crowd is now shootable + run-over-able ----
  // (previously only the ~14 promoted peds could be hit; far NPCs were phantoms).
  function shootable(i) { return !deadAgent[i] && !suppressed[i] && corpseT[i] <= 0 && promotedBy[i] < 0; }
  // distance along a (normalised) ray at which it first enters a sphere, or -1.
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
    const mx = ox - cx, my = oy - cy, mz = oz - cz;
    const b = mx * dx + my * dy + mz * dz;
    const c = mx * mx + my * my + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    const disc = b * b - c;
    if (disc < 0) return -1;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = 0;                         // origin inside sphere
    return t <= maxT ? t : -1;
  }
  // nearest ambient agent the ray hits within maxT (head sphere wins). hr/br = assist radii.
  CBZ.cityCrowdRayHit = function (ox, oy, oz, dx, dy, dz, maxT, hr, br) {
    let best = -1, bd = maxT, head = false;
    const HR = (hr || 0.33) + 0.05, BR = (br || 0.48) + 0.08;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const hd = raySphere(ox, oy, oz, dx, dy, dz, px[i], 2.18, pz[i], HR, bd);
      if (hd >= 0 && hd < bd) { bd = hd; best = i; head = true; continue; }
      const td = raySphere(ox, oy, oz, dx, dy, dz, px[i], 1.42, pz[i], BR, bd);
      if (td >= 0 && td < bd) { bd = td; best = i; head = false; }
    }
    return best >= 0 ? { i: best, dist: bd, head: head, x: px[best], z: pz[best] } : null;
  };
  // kill ambient agent i: leave a body, throw gore, and report the crime (wanted).
  CBZ.cityCrowdKill = function (i, opts) {
    opts = opts || {};
    if (i < 0 || i >= count || !shootable(i)) return false;
    const x = px[i], z = pz[i];
    corpseT[i] = 28;                                   // lie on the ground a good long while, then fade
    if (CBZ.gore) try { CBZ.gore(x, 1.4, z, { dir: opts.fromX != null ? { x: x - opts.fromX, z: z - opts.fromZ } : null, amount: opts.head ? 1.4 : 1.0, player: false }); } catch (e) {}
    if (CBZ.sfx && !opts.quiet) CBZ.sfx(opts.byCar ? "ko" : (opts.head ? "headshot" : "hit"));
    // a killed civilian is a witnessed crime → routes through the city wanted system
    // (skip when an NPC/explosion you didn't cause did the killing — opts.noCrime)
    if (CBZ.cityCrime && !opts.noCrime) CBZ.cityCrime(opts.byCar ? 150 : 200, { x: x, z: z, type: opts.byCar ? "vehicular homicide" : "murder" });
    if (CBZ.game) CBZ.game.cityKills = (CBZ.game.cityKills || 0) + 1;
    if (CBZ.city && CBZ.city.addKill) CBZ.city.addKill();   // count crowd kills toward story/leaderboard too
    // FINITE POPULATION: an ambient agent just died → tick the city headcount
    // DOWN (peds.js owns the roster). Un-promoted agents only ever die through
    // here; promoted rigs die via cityKillPed — exactly one decrement each.
    if (CBZ.cityPopulationDie) CBZ.cityPopulationDie(1);
    return true;
  };
  // everyone within r of (x,z) gets run down (car mowing through a crowd).
  CBZ.cityCrowdCircleKill = function (x, z, r, opts) {
    let n = 0; const r2 = r * r;
    for (let i = 0; i < count; i++) {
      if (!shootable(i)) continue;
      const dx = px[i] - x, dz = pz[i] - z;
      if (dx * dx + dz * dz < r2 && CBZ.cityCrowdKill(i, opts)) n++;
    }
    return n;
  };

  // a city teardown (new run / mode reset) nukes CBZ.cityPeds — drop the pool too
  if (CBZ.clearCityPeds) {
    const _clear = CBZ.clearCityPeds;
    CBZ.clearCityPeds = function () { pool = []; poolBuilt = false; promotedBy.fill(-1); deadAgent.fill(0); suppressed.fill(0); liveTarget = count; return _clear.apply(this, arguments); };
  }

  // ---- DENSITY THINNING: keep the on-street agent count in step with the finite
  //      city headcount. liveTarget = full crowd × (alive / total); as people are
  //      killed off, the fraction falls and we PARK surplus living agents off-map
  //      (suppress) so the streets get visibly emptier — and never re-park more
  //      than the math says, so a massacre stays a massacre (no magic refill).
  //      Cheap: a couple of park/un-park flips per call, biased AWAY from the
  //      player so bodies don't pop in/out right in your face. ----
  let _thinT = 0, _thinScan = 0;
  function recountAgents() {                     // living, on-street (not dead/suppressed/corpse)
    let live = 0, sup = 0;
    for (let i = 0; i < count; i++) {
      if (deadAgent[i] || corpseT[i] > 0) continue;
      if (suppressed[i]) sup++; else live++;
    }
    return { live: live, sup: sup };
  }
  function thin(dt) {
    _thinT -= dt; if (_thinT > 0) return;
    _thinT = 0.5;                                // re-evaluate ~twice a second (cheap)
    if (!CBZ.cityPopulation) return;
    // ---- THE DUSK/DAWN FLIP (rides this 0.5s cadence — an hourly dial, never
    //      per-frame). On a flip, arm a turnover budget: about half the crowd
    //      gets reconsidered over the next ~30s so the street changes hands
    //      gradually — the day people go in, the night people come out. ----
    const wantNight = nightNow();
    if (wantNight !== nightShift) { nightShift = wantNight; turnover = (count * TURNOVER_FRAC) | 0; }
    const pop = CBZ.cityPopulation();
    const frac = pop.total > 0 ? pop.alive / pop.total : 1;
    // the night street holds fewer people OVERALL (~60% of day) on top of the
    // finite-headcount fraction; dawn lifts the target back and the existing
    // un-suppress path walks everyone back in.
    liveTarget = Math.round(count * Math.max(0, Math.min(1, frac)) * (nightShift ? NIGHT_DENSITY : 1));
    const c = recountAgents();
    const P = CBZ.player;
    const ppx = P ? P.pos.x : 0, ppz = P ? P.pos.z : 0;
    // FAR bias so density changes happen off-screen, never popping at your feet
    const FAR2 = 60 * 60;
    if (c.live > liveTarget) {
      // too many on the street → suppress a few FAR, non-promoted, living agents
      let need = Math.min(6, c.live - liveTarget), scanned = 0;
      while (need > 0 && scanned < count) {
        const i = _thinScan; _thinScan = (_thinScan + 1) % Math.max(1, count); scanned++;
        if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0) continue;
        const dx = px[i] - ppx, dz = pz[i] - ppz;
        if (dx * dx + dz * dz < FAR2) continue;  // close enough to see → leave it alone
        suppressed[i] = 1; need--;
      }
    } else if (c.live < liveTarget && c.sup > 0) {
      // population didn't drop further (or a fresh run) → let a few back onto the
      // street, re-seeded at a FAR sidewalk point so they walk IN, not blink in.
      const A = arena();
      let add = Math.min(4, liveTarget - c.live), scanned = 0;
      while (add > 0 && scanned < count) {
        const i = _thinScan; _thinScan = (_thinScan + 1) % Math.max(1, count); scanned++;
        if (!suppressed[i] || deadAgent[i]) continue;
        suppressed[i] = 0;
        if (A && A.randomSidewalkPoint) {        // fresh pop-weighted spot, dressed for it
          pickWaypoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;
          castTint(i, px[i], pz[i]); repaintShirt(i);
          pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z;
          heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
        }
        add--;
      }
    }
    // ---- TURNOVER: spend the dusk/dawn relocation budget, a few bodies per
    //      tick. Each far, living, non-promoted agent gets teleport-reseeded
    //      through the CURRENT hour's draw + re-dressed for where it lands —
    //      the destination field is what shapes the street, so the same rule
    //      works in both directions (dusk packs the core, dawn re-spreads).
    //      Far-only, so the change always happens off-screen. ----
    if (turnover > 0) {
      let moved = 0, scanned = 0;
      while (turnover > 0 && moved < 3 && scanned < 48) {
        const i = _turnScan; _turnScan = (_turnScan + 1) % Math.max(1, count); scanned++;
        if (deadAgent[i] || suppressed[i] || corpseT[i] > 0 || promotedBy[i] >= 0) { turnover--; continue; }
        const dx = px[i] - ppx, dz = pz[i] - ppz;
        if (dx * dx + dz * dz < FAR2) { turnover--; continue; }   // in sight → it keeps walking; the draw fields still converge
        drawPoint(_tmp); px[i] = _tmp.x; pz[i] = _tmp.z;
        castTint(i, px[i], pz[i]); repaintShirt(i);               // walks on dressed for the hour
        pickWaypoint(_tmp, px[i], pz[i]); tx[i] = _tmp.x; tz[i] = _tmp.z;
        heading[i] = Math.atan2(tx[i] - px[i], tz[i] - pz[i]);
        moved++; turnover--;
      }
    }
  }

  // ambient layer: runs during city play (own order, independent of peds @34).
  CBZ.onUpdate(23.7, function (dt) {
    if (CBZ.game.mode !== "city") { if (root) { root.visible = false; } if (poolBuilt) releaseAll(); return; }
    if (root) root.visible = true;
    if (!count && arena()) CBZ.spawnCityCrowd((CBZ.CITY && CBZ.CITY.crowd) || 320);
    sim(dt);
    thin(dt);             // keep on-street density in step with the finite headcount
    aheadReseed();        // pull distant bodies into the street ahead of you
    updatePromotion();
    render();
  });
})();
