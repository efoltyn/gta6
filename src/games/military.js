/* ============================================================
   games/military.js — FORT HALSTEAD · RESTRICTED AREA, as a GAME PACKAGE.

   A one-night INFILTRATION game staged on the EXISTING island military base
   (city/island_military.js — "Fort Brandt"). The whole point is that the
   engine ALREADY ships a stealth stack; this package is a ROLE + a GOAL + an
   ARC on top of the real systems, not a fork of them.

   ENGINE STEALTH SYSTEMS REUSED (functions, not re-implementations):
     · entities/guards.js  CBZ.guardSees(g)  — the REAL vision test (cone +
       viewDist + crouch-shrink + LOS raycast). My guards are ctx.npc peds;
       I hand guardSees a live guard-shaped view of each ped and it decides
       whether the player is seen. Player detection is the engine's, verbatim.
     · core/losgrid.js     CBZ.losRaycast(rc, CBZ.losBlockers) — the REAL
       occlusion query. Every arbitrary-point sight test here (api.seen, the
       photograph line-of-sight) casts against the same world LOS mesh set,
       so "behind a wall" means behind the SAME walls the engine uses.
     · entities/searchlight.js  CBZ.litBySearchlight(pos, crouch) — the REAL
       beam sensor. My searchlights are registered into CBZ.searchlights so
       the shipped sensor query catches the player in my pools too; sabotage
       flips their `disabled` exactly like the engine's own.
     · city/militaryvehicles.js  CBZ.cityMilitaryVehicles / cityArmorActive()
       — the REAL drivable hardware. "Steal a vehicle" = board one of those
       LIVE tanks/trucks/aircraft; "crash the gate" = drive it past the gate
       line. No prop copies.
   The ALERT LADDER, the BRIG lockpick and the CONTRACT are this package's own
   scoring/arc laid ON those primitives — reuse the detection, own the game.

   WHY per prop (owner's law — a prop is a mechanic or it's cut):
     · CAUSEWAY GATE + BOOM ...... the only way off the island; extraction is
                                   crashing a stolen vehicle through it. LOCKS
                                   at RED alert (on-foot exit sealed).
     · THE FIXER (ctx.npc) ....... hands you the three-job contract and pays
                                   REAL cash on completion + extraction.
     · PROTOTYPE + REVETMENT ..... photo job; the 3 revetment walls are real
                                   CBZ.losBlockers, so the shot needs the open
                                   side — cover is the puzzle.
     · COMMS MAST ................ tap job: hold-to-install, but only progresses
                                   while UNSEEN (mind the patrol window).
     · GENERATOR SHED ............ sabotage → perimeter lights + searchlights
                                   drop 60s (cover) BUT it's noticed: auto-YELLOW.
     · MESS HALL + LIGHT ......... a timetable: when the mess light comes on,
                                   off-shift guards leave their posts to eat —
                                   THAT is your patrol window.
     · PERIMETER LIGHTS .......... the thing the generator kills (measurable).
     · SEARCHLIGHTS .............. sensors that sweep FASTER as alert climbs.
     · ELECTRIFIED FENCE (signed)  the tell: signed live runs zap + spike alert.
     · THE BRIG (real cell) ...... caught once = thrown in; a lockpick minigame
                                   (cell-block-z homage) is the way out. Caught
                                   twice = court-martial, the run is LOST.
     · GUARDS (ctx.npc peds) ..... real city peds (aggr brain, gunpoint hands-up,
                                   cityKillPed death), patrolled by this file and
                                   read by the engine's guardSees.

   Determinism: build paths use ctx.rand/ctx.stream only (multiplayer law).
   Runtime FX (alarm, patrol reroutes, the lockpick marker) may use Math.random.
   Revert: CBZ.CONFIG.PKG_MILITARY = false (or the master GAME_PACKAGES).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_MILITARY == null) CBZ.CONFIG.PKG_MILITARY = true;

  /* ------------------------------------------------------------ helpers -- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  // distance from point (px,pz) to segment (ax,az)-(bx,bz)
  function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const L2 = vx * vx + vz * vz || 1;
    let t = (wx * vx + wz * vz) / L2; t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  }

  /* ---- REUSED LOS: cast against the engine's real occlusion mesh set ----
     losgrid.js's CBZ.losRaycast + the shared CBZ.losBlockers are the exact
     stack guardSees / los.js / combat.js use. A clear return here means clear
     for the WHOLE engine — no private cover model. */
  const _rc = new THREE.Raycaster();
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function losClear(sx, sy, sz, tx, ty, tz) {
    _o.set(sx, sy, sz);
    _d.set(tx - sx, ty - sy, tz - sz);
    const dist = _d.length();
    if (dist < 0.05) return true;
    _d.multiplyScalar(1 / dist);
    _rc.set(_o, _d);
    _rc.far = Math.max(0.1, dist - 0.4);
    const blk = CBZ.losBlockers || [];
    const hits = CBZ.losRaycast ? CBZ.losRaycast(_rc, blk) : _rc.intersectObjects(blk, false);
    return hits.length === 0;
  }

  /* ---- guardSeesPoint: a point-target GENERALIZATION of CBZ.guardSees ----
     guardSees is hard-wired to the player; api.seen(x,z) and the photo test
     need an arbitrary target. This mirrors guardSees' exact steps (dead gate,
     viewDist w/ crouch shrink, cone via cos(half)) and defers occlusion to
     losClear (== CBZ.losRaycast/CBZ.losBlockers). It is a WRAP of the engine's
     detection math, not a fork: the load-bearing occlusion query is the
     engine's, and the probe asserts it AGREES with CBZ.guardSees for the
     player case. */
  function guardSeesPoint(g, tx, tz, ty, crouch) {
    if (!g || g.dead) return false;
    const gx = g.group.position.x, gz = g.group.position.z;
    const dx = tx - gx, dz = tz - gz;
    const dist = Math.hypot(dx, dz);
    let vd = g.viewDist; if (crouch) vd *= 0.55;
    if (dist > vd || dist < 0.05) return false;
    const yaw = g.group.rotation.y;
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist;
    if (dot < Math.cos(g.half)) return false;
    return losClear(gx, 1.5, gz, tx, ty == null ? 1.0 : ty, tz);
  }

  /* ------------------------------------------------------------ config -- */
  // constants FALLBACK — read from city/island_military.js (its module locals
  // CEN_X/CEN_Z/HX/HZ). resolve() prefers the live "Fort Brandt" region; this
  // is the byte-stable backstop when the region registry is not up yet.
  const _MOFF = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 };
  const BASE = { cx: -620 + _MOFF.dx, cz: -700 + _MOFF.dz, hx: 240, hz: 250 };

  const VIEW_DIST = 22, VIEW_HALF = 0.62;          // guard cone (~35°, 22u)
  const GATE_VIEW_DIST = 26;
  // alert ladder thresholds → tier index 0..3
  const TIERS = ["GREEN", "YELLOW", "ORANGE", "RED"];
  const TIER_AT = [0, 25, 55, 85];                  // alarm floor per tier
  const TIER_SWEEP = [1.0, 1.45, 1.95, 2.7];        // searchlight speed ×
  const PAY = { photo: 2000, tap: 2000, steal: 1500, extract: 15000 };
  const PHOTO_R = 15, PHOTO_HOLD = 2.6;             // photograph: close + LOS + hold
  const TAP_R = 4.6, TAP_HOLD = 6.0;                // comms tap: near + unseen + hold
  const NEAR = 120;                                 // run the sim within this of centre
  const GUARD_CAP = 9;                              // SwiftShader-sane ped budget

  /* ---- materials (cheap shared) ---- */
  const M = {
    olive: 0x5a6042, oliveD: 0x3c412e, steel: 0x8a8f96, steelD: 0x3a3f45,
    warn: 0xd4a017, red: 0xc0392b, dark: 0x202327, wire: 0x20242a,
    beam: 0xfff3c0, lamp: 0xffd878, antenna: 0x9aa0a6, protoBody: 0x2b2f36,
    protoGlass: 0x3fa9c9, bar: 0x1a1d22, sign: 0x111417,
  };

  /* --------------------------------------------------- module singletons -- */
  let C = null;          // ctx once mounted
  let V = null;          // build refs (origin, bounds, gate, jobs, guards, lights, beams…)
  let state = null;      // persisted bag (nights/wins/losses + resumable night)
  let simT = 0;

  // runtime (not all persisted): alarm ladder, brig, generator, mess timetable
  const RT = {
    alarm: 0, tierIdx: 0, seen: false, litT: 0, zapCd: 0,
    photoT: 0, tapT: 0, hintCd: 0,
    genUntil: 0,                 // simT until which generator sabotage darkens
    messOn: false, messT: 18,
    brig: { active: false, pins: [], marker: 50, dir: 1, spd: 46, pin: 0, keyH: null },
    outcome: "none",             // last resolved arc end: none|win|lose
    testGuard: null,             // api.placeTestGuard — an isolated probe cone
  };

  function nightBag() {
    // persisted, resumable night state (contract + job flags + strikes)
    if (!state) return null;
    if (!state.night) state.night = { active: false, photo: false, tap: false, steal: false, caught: 0 };
    return state.night;
  }
  const save = () => { try { C && C.saveState(); } catch (e) {} };
  function hint(msg, col) {
    if (RT.hintCd > 0) return;
    RT.hintCd = 0.5;
    if (CBZ.flashHint) CBZ.flashHint(msg, 1.2);
    else if (C) C.hud.feed(msg, col || "#cfe3ff");
  }
  const player = () => CBZ.player;
  function floorY(x, z) { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; }

  /* ============================================================
     resolve() — site anchor. Prefer the live region named "Fort Brandt"
     (registerCityRegion, city/island_military.js); fall back to CBZ._militaryBase
     (that file's exported constants) and finally to the hard BASE constants.
     Returns null until an arena exists so the engine keeps retrying.
  ============================================================ */
  function resolve(CBZ) {
    try {
      const A = CBZ.city && CBZ.city.arena;
      if (!A) return null;
      let cx = BASE.cx, cz = BASE.cz, minX = BASE.cx - BASE.hx, maxX = BASE.cx + BASE.hx,
        minZ = BASE.cz - BASE.hz, maxZ = BASE.cz + BASE.hz, via = "constants";
      // 1) region by NAME (the archipelago contract)
      const regs = A.regions || [];
      let reg = null;
      for (let i = 0; i < regs.length; i++) {
        if (regs[i] && /fort brandt/i.test(regs[i].name || "")) { reg = regs[i]; break; }
      }
      // 2) exported constants handle from island_military.js
      const mb = CBZ._militaryBase;
      if (reg && isFinite(reg.minX)) {
        minX = reg.minX; maxX = reg.maxX; minZ = reg.minZ; maxZ = reg.maxZ;
        cx = (minX + maxX) / 2; cz = (minZ + maxZ) / 2; via = "region";
      } else if (mb && isFinite(mb.minX)) {
        minX = mb.minX; maxX = mb.maxX; minZ = mb.minZ; maxZ = mb.maxZ;
        cx = mb.center.x; cz = mb.center.z; via = "militaryBase";
      } else if (!regs.length && !mb) {
        // arena present but base not built yet → wait
        return null;
      }
      return { x: cx, z: cz, via, bounds: { minX, maxX, minZ, maxZ } };
    } catch (e) { return null; }
  }

  /* ================================ build ================================ */
  function build(ctx, venue) {
    C = ctx;
    const anchor = venue.anchor || {};
    const origin = venue.origin;
    const b = anchor.bounds || { minX: origin.x - BASE.hx, maxX: origin.x + BASE.hx, minZ: origin.z - BASE.hz, maxZ: origin.z + BASE.hz };
    const g = venue.group;

    V = {
      origin, bounds: b, group: g, via: anchor.via || "?",
      gateX: b.maxX,                                   // world x of the east gate line
      gateZ: origin.z,                                 // causeway centreline
      proto: null, comms: null, gen: null, brigCell: null, barrier: null,
      guards: [], baseGuardCount: 0, lights: [], beams: [], fence: [], messLight: null,
    };
    // ensure a fresh, resumable night bag exists
    nightBag();

    // a counter-offset child so searchlight pools/cones can live in WORLD coords
    // (litBySearchlight compares to player world pos) with no local↔world juggle.
    const worldRoot = new THREE.Group();
    worldRoot.position.set(-origin.x, 0, -origin.z);
    worldRoot.userData.gamePkg = "military";
    g.add(worldRoot);
    V.worldRoot = worldRoot;

    const gy = floorY(origin.x, origin.z);            // base pad height (≈0)

    buildGate(ctx, gy);
    buildFixer(ctx);
    buildPrototype(ctx, gy);
    buildComms(ctx, gy);
    buildGenerator(ctx, gy);
    buildMess(ctx, gy);
    buildBrig(ctx, gy);
    buildPerimeterLights(ctx, gy);
    buildElectricFence(ctx, gy);
    buildSearchlights(ctx, gy);
    spawnBaseGuards(ctx);

    // ---- ZONES: the interface surface (interactions #14) ----
    ctx.zone({ id: "fixer", label: "[E] The fixer — RESTRICTED AREA contract", pos: [V.fixerAt[0], V.fixerAt[1]], r: 3.4, onUse: openBriefing });
    ctx.zone({
      id: "sabotage", label: "[E] Sabotage the generator", pos: [V.gen.lx, V.gen.lz], r: 3.2,
      canShow: () => simT >= RT.genUntil, onUse: () => sabotageGenerator(),
    });
    // (photo + tap are proximity/hold mechanics driven in update(); the brig
    //  lockpick is a live panel. No decorative zones.)
  }

  /* ------------------------------------------------------------- GATE ---- */
  function buildGate(ctx, gy) {
    const o = V.origin;
    const lGateX = V.gateX - o.x;                      // ≈ +240 local
    // a striped boom + posts reading as a checkpoint; the extraction crash point
    ctx.box(V.group, lGateX, gy + 1.1, 0, 0.6, 0.2, 26, ctx.emat(M.warn, 0.35));     // boom bar across the lane
    ctx.box(V.group, lGateX, gy + 1.1, -13.5, 0.7, 2.2, 0.7, ctx.mat(M.red));         // post N
    ctx.box(V.group, lGateX, gy + 1.1, 13.5, 0.7, 2.2, 0.7, ctx.mat(M.red));          // post S
    // RED-lock barrier: a reinforced slab that seals the on-foot causeway mouth
    // when alert hits RED. Off by default (raised); toggled in setTier().
    const bar = ctx.box(V.group, lGateX + 1.4, gy + 1.4, 0, 0.8, 2.8, 26, ctx.mat(M.steelD));
    bar.visible = false;
    V.barrier = { mesh: bar, col: null, y: gy + 1.4, lx: lGateX + 1.4 };
    V.fixerAt = [lGateX - 14, 8];                      // fixer stands just inside
  }
  function gateLock(on) {
    const B = V.barrier; if (!B) return;
    if (on && !B.col) {
      B.mesh.visible = true;
      B.col = C.solid(B.lx - 0.5, -13, B.lx + 0.5, 13, B.y - 1.4, B.y + 1.4);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } else if (!on && B.col) {
      B.mesh.visible = false;
      const arr = CBZ.colliders; const i = arr ? arr.indexOf(B.col) : -1;
      if (i >= 0) arr.splice(i, 1);
      B.col = null;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
  }

  /* ------------------------------------------------------------ FIXER ---- */
  function buildFixer(ctx) {
    // a REAL city ped (brain + gunpoint hands-up + death funnel), pinned at the
    // gate. [E] Talk gives flavour; the contract panel is the fixer zone.
    if (!ctx.npc) return;
    V.fixer = ctx.npc({
      role: "vendor", name: "The Fixer", outfit: 0x2a2f26,
      at: [V.fixerAt[0], V.fixerAt[1]], face: -Math.PI / 2, post: "pinned", pose: "stand",
      sayColor: "#d8e6b0", talkLabel: "Talk to the Fixer",
      dialogue: [
        "Three jobs, one night. Photograph the prototype, tap the comms mast, and drive something loud out the gate.",
        "Green means they're bored. Red means they've made you — and the gate seals.",
        "Kill the generator if the lights get hot. It buys you a dark minute, but they'll notice.",
        "Watch the mess. When the light's on, half the wire empties out to eat.",
        "Get pinched once, it's the brig — pick your way out. Twice and it's a court martial. Don't get pinched twice.",
      ],
    });
  }

  /* -------------------------------------------------------- PROTOTYPE ---- */
  function buildPrototype(ctx, gy) {
    // deep NW corner — the "far hangar" the brief names, hardest to reach.
    const lx = -170, lz = -160;
    const g = V.group;
    // 3-wall revetment (open on the SE side). The walls are REAL LOS blockers,
    // so a clean photo demands the open side — cover IS the puzzle.
    const wallMat = ctx.mat(M.oliveD);
    const w1 = ctx.box(g, lx, gy + 2.2, lz - 6, 18, 4.4, 0.8, wallMat);   // back (N)
    const w2 = ctx.box(g, lx - 8.6, gy + 2.2, lz, 0.8, 4.4, 12, wallMat); // W
    const w3 = ctx.box(g, lx, gy + 2.2, lz + 6, 9, 4.4, 0.8, wallMat);    // partial front (S), leaves SE gap
    [w1, w2, w3].forEach((m) => { if (CBZ.losBlockers) CBZ.losBlockers.push(m); });
    C.solid(lx - 9, lz - 6.4, lx + 9, lz - 5.6);
    C.solid(lx - 9, lz - 6, lx - 8.2, lz + 6);
    C.solid(lx - 4.5, lz + 5.6, lx + 4.5, lz + 6.4);
    // the prototype — a shrouded next-gen airframe on a cradle
    ctx.box(g, lx, gy + 0.9, lz, 3.4, 0.5, 9.5, ctx.pmat(M.protoBody, 20));           // fuselage
    ctx.box(g, lx, gy + 1.5, lz - 1.5, 8.5, 0.35, 3.2, ctx.pmat(M.protoBody, 20));     // blended wing
    ctx.box(g, lx, gy + 1.35, lz + 3.4, 1.1, 0.6, 1.6, ctx.emat(M.protoGlass, 0.4));   // canopy glow
    ctx.box(g, lx, gy + 2.0, lz - 3.6, 0.3, 1.4, 1.4, ctx.pmat(M.protoBody, 20));      // tail fin
    ctx.box(g, lx, gy + 0.25, lz, 2.0, 0.5, 8.0, ctx.mat(M.steelD));                   // cradle
    C.solid(lx - 4.4, lz - 4.9, lx + 4.4, lz + 4.9, 0, 1.4);
    ctx.light(lx, gy + 3.4, lz + 3, M.protoGlass, 0.5, 12);
    // a warning placard
    signPlate(ctx, lx, gy + 2.2, lz + 6.05, "PROTOTYPE — NO PHOTOGRAPHY", 0);
    V.proto = { lx, lz, wx: V.origin.x + lx, wz: V.origin.z + lz, y: gy + 1.2 };
    // a known LOS wall for the vision probe (the revetment back wall centre)
    V.probeWall = { wx: V.origin.x + lx, wz: V.origin.z + lz - 6 };
  }

  /* ------------------------------------------------------------ COMMS ---- */
  function buildComms(ctx, gy) {
    const lx = 80, lz = -175;
    const g = V.group;
    // a lattice mast: 4 legs + cross-braces + a stack of antennas (chunky ≥0.3u)
    const legMat = ctx.mat(M.antenna);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const leg = ctx.box(g, lx + sx * 1.3, gy + 6, lz + sz * 1.3, 0.35, 12, 0.35, legMat);
      leg.rotation.set(sz * 0.05, 0, -sx * 0.05);
    });
    for (let h = 2; h <= 10; h += 2) {
      ctx.box(g, lx, gy + h, lz, 3.0, 0.3, 0.3, legMat);
      ctx.box(g, lx, gy + h, lz, 0.3, 0.3, 3.0, legMat);
    }
    ctx.cyl(g, lx, gy + 13, lz, 0.12, 0.18, 4, legMat, 8);                  // whip
    ctx.box(g, lx + 1.2, gy + 11.5, lz, 2.2, 0.2, 0.6, ctx.mat(M.steel));   // dish arm
    ctx.box(g, lx, gy + 1.0, lz, 1.4, 2.0, 1.0, ctx.mat(M.steelD));         // junction box (the tap point)
    ctx.emat && ctx.box(g, lx + 0.75, gy + 1.0, lz, 0.06, 0.5, 0.5, ctx.emat(0x35d07a, 0.6)); // status LED
    C.solid(lx - 1.8, lz - 1.8, lx + 1.8, lz + 1.8, 0, 12);
    ctx.light(lx, gy + 12, lz, 0xff5a4a, 0.5, 14);                          // red aviation lamp
    V.comms = { lx, lz, wx: V.origin.x + lx, wz: V.origin.z + lz, y: gy + 1.2 };
  }

  /* -------------------------------------------------------- GENERATOR ---- */
  function buildGenerator(ctx, gy) {
    const lx = -30, lz = 44;
    const g = V.group;
    ctx.box(g, lx, gy + 1.6, lz, 6, 3.2, 4, ctx.mat(M.olive));              // shed
    ctx.box(g, lx, gy + 3.3, lz, 6.4, 0.3, 4.4, ctx.mat(M.oliveD));         // roof
    ctx.box(g, lx + 2.2, gy + 1.4, lz + 2.05, 1.4, 1.6, 0.2, ctx.emat(M.warn, 0.5)); // breaker panel
    ctx.cyl(g, lx - 2.6, gy + 1.2, lz - 1.4, 0.5, 0.5, 2.4, ctx.mat(M.dark), 10);     // exhaust stack
    C.solid(lx - 3, lz - 2, lx + 3, lz + 2, 0, 3.2);
    signPlate(ctx, lx + 2.2, gy + 2.6, lz + 2.2, "MAIN POWER — DANGER", 0);
    V.gen = { lx, lz };
  }
  function sabotageGenerator() {
    const nb = nightBag();
    RT.genUntil = simT + 60;                           // 60s of darkness
    // drop perimeter light intensities
    for (const L of V.lights) { if (L && L.userData) { L.userData._base = L.userData._base != null ? L.userData._base : L.intensity; L.intensity = 0.05; } }
    // kill the searchlight sensors (same `disabled` field the engine flips)
    for (const s of V.beams) s.disabled = 999;
    // it's LOUD: auto-escalate to at least YELLOW
    setAlarm(Math.max(RT.alarm, TIER_AT[1] + 2));
    if (C) { C.hud.toast("GENERATOR DOWN — 60s of dark"); C.hud.feed("Perimeter lights cut. They'll be scrambling.", "#ffd166"); }
    if (CBZ.shake) CBZ.shake(0.35);
    return { until: RT.genUntil, tier: TIERS[RT.tierIdx] };
  }
  function restoreLights() {
    for (const L of V.lights) { if (L && L.userData && L.userData._base != null) L.intensity = L.userData._base; }
    for (const s of V.beams) s.disabled = 0;
  }

  /* ------------------------------------------------------------- MESS ---- */
  function buildMess(ctx, gy) {
    const lx = 150, lz = -70;
    const g = V.group;
    ctx.box(g, lx, gy + 2, lz, 16, 4, 10, ctx.mat(0x6f7560));               // mess hall
    ctx.box(g, lx, gy + 4.1, lz, 16.6, 0.3, 10.6, ctx.mat(M.oliveD));       // roof
    C.solid(lx - 8, lz - 5, lx + 8, lz + 5, 0, 4);
    // the timetable light: ON = off-shift guards route here to eat (patrol window)
    V.messLight = ctx.light(lx, gy + 3.4, lz + 5.6, M.lamp, 0.0, 16);
    V.mess = { lx, lz, wx: V.origin.x + lx, wz: V.origin.z + lz };
    signPlate(ctx, lx, gy + 3.0, lz + 5.05, "MESS HALL", 0);
  }

  /* ------------------------------------------------------------- BRIG ---- */
  function buildBrig(ctx, gy) {
    const lx = 70, lz = 120;
    const g = V.group;
    const wm = ctx.mat(0x4a4e44);
    // 3 solid walls + a barred front; a real cell you get thrown into
    ctx.box(g, lx, gy + 1.8, lz - 2.6, 6, 3.6, 0.4, wm);                    // back
    ctx.box(g, lx - 2.8, gy + 1.8, lz, 0.4, 3.6, 5.2, wm);                  // W
    ctx.box(g, lx + 2.8, gy + 1.8, lz, 0.4, 3.6, 5.2, wm);                  // E
    ctx.box(g, lx, gy + 3.6, lz, 6, 0.3, 5.6, ctx.mat(M.oliveD));          // roof
    for (let i = -2; i <= 2; i++) ctx.cyl(g, lx + i * 0.9, gy + 1.8, lz + 2.5, 0.08, 0.08, 3.4, ctx.mat(M.steel), 6); // bars
    C.solid(lx - 3, lz - 2.8, lx + 3, lz - 2.2, 0, 3.6);
    C.solid(lx - 3, lz - 2.8, lx - 2.4, lz + 2.8, 0, 3.6);
    C.solid(lx + 2.4, lz - 2.8, lx + 3, lz + 2.8, 0, 3.6);
    ctx.box(g, lx - 1.6, gy + 0.4, lz - 1.6, 2.4, 0.5, 1.0, ctx.mat(0x33372e)); // bunk
    ctx.light(lx, gy + 3.2, lz, M.lamp, 0.5, 8);
    signPlate(ctx, lx, gy + 2.9, lz - 2.35, "BRIG", 0);
    V.brigCell = { lx, lz, wx: V.origin.x + lx, wz: V.origin.z + lz, y: gy };
    V.brigDoor = null;                                 // toggled collider on capture
  }

  /* -------------------------------------------------- PERIMETER LIGHTS ---- */
  function buildPerimeterLights(ctx, gy) {
    // the measurable "lights" the generator kills — a handful of warm posts
    const spots = [[-150, 150], [150, 150], [0, 6], [-110, -110], [120, -120]];
    for (let i = 0; i < spots.length; i++) {
      const [lx, lz] = spots[i];
      ctx.cyl(V.group, lx, gy + 2.4, lz, 0.14, 0.18, 4.8, ctx.mat(M.steelD), 8);   // pole
      ctx.box(V.group, lx, gy + 4.7, lz, 0.6, 0.3, 0.6, ctx.emat(M.lamp, 0.6));    // lamp head
      const L = ctx.light(lx, gy + 4.6, lz, M.lamp, 0.85, 18);
      if (L) { L.userData._base = 0.85; V.lights.push(L); }
    }
  }

  /* ------------------------------------------------- ELECTRIFIED FENCE ---- */
  function buildElectricFence(ctx, gy) {
    // signed LIVE runs — the tell. Touch a live run: zap (damage) + alarm spike.
    // Placed to pinch the routes into the prototype revetment and the comms mast.
    const runs = [
      { ax: -140, az: -120, bx: -140, bz: -200 },      // guards the prototype approach
      { ax: 30, az: -140, bx: 130, bz: -140 },         // screens the comms mast row
    ];
    for (const r of runs) {
      const midx = (r.ax + r.bx) / 2, midz = (r.az + r.bz) / 2;
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      const ang = Math.atan2(r.bx - r.ax, r.bz - r.az);
      // posts + a couple of live wires
      const n = Math.max(2, Math.round(len / 4));
      for (let i = 0; i <= n; i++) {
        const t = i / n, px = r.ax + (r.bx - r.ax) * t, pz = r.az + (r.bz - r.az) * t;
        ctx.cyl(V.group, px, gy + 1.3, pz, 0.1, 0.12, 2.6, ctx.mat(M.oliveD), 6);
      }
      const w1 = ctx.box(V.group, midx, gy + 1.9, midz, 0.06, 0.06, len, ctx.emat(0x66ffff, 0.4)); w1.rotation.y = ang;
      const w2 = ctx.box(V.group, midx, gy + 1.2, midz, 0.06, 0.06, len, ctx.emat(0x66ffff, 0.4)); w2.rotation.y = ang;
      signPlate(ctx, midx, gy + 1.7, midz, "ELECTRIFIED FENCE", ang);
      V.fence.push(r);
    }
  }

  /* ------------------------------------------------------ SEARCHLIGHTS ---- */
  function buildSearchlights(ctx, gy) {
    // remove any beams a previous mount of THIS package left in the shared array
    if (CBZ.searchlights) for (let i = CBZ.searchlights.length - 1; i >= 0; i--) if (CBZ.searchlights[i] && CBZ.searchlights[i]._pkgMil) CBZ.searchlights.splice(i, 1);
    const towers = [[-215, 225, 0], [215, 225, Math.PI], [0, -232, Math.PI / 2]];
    for (let i = 0; i < towers.length; i++) {
      const [lx, lz, phase] = towers[i];
      // tower head (visual, in venue-local)
      ctx.cyl(V.group, lx, gy + 6, lz, 0.4, 0.6, 0.9, ctx.emat(M.beam, 0.7), 10);
      // cone + ground pool live in WORLD coords under worldRoot
      const wx = V.origin.x + lx, wz = V.origin.z + lz;
      const cone = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 6, 13, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: M.beam, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
      );
      V.worldRoot.add(cone);
      const pool = new THREE.Mesh(
        new THREE.CircleGeometry(6, 20),
        new THREE.MeshBasicMaterial({ color: M.beam, transparent: true, opacity: 0.2, depthWrite: false })
      );
      pool.rotation.x = -Math.PI / 2; pool.position.set(wx, 0.06, wz);
      V.worldRoot.add(pool);
      const sl = {
        _pkgMil: true, cone, pool, poolRadius: 6, disabled: 0,
        headX: wx, headY: gy + 6, headZ: wz,
        cx: V.origin.x, cz: V.origin.z, sweepR: 80, phase, t: phase,
      };
      if (CBZ.searchlights) CBZ.searchlights.push(sl);   // REUSE the shipped sensor
      V.beams.push(sl);
    }
  }
  function updateBeams(dt) {
    const dark = simT < RT.genUntil;
    const spd = TIER_SWEEP[RT.tierIdx];                 // faster sweep with alert
    for (const s of V.beams) {
      if (dark) s.disabled = 999; else if (s.disabled > 900) s.disabled = 0;
      const off = s.disabled > 0;
      s.t += dt * 0.6 * spd;
      const tx = s.cx + Math.sin(s.t) * s.sweepR;
      const tz = s.cz + Math.cos(s.t * 0.7) * s.sweepR * 0.7;
      s.pool.position.x = tx; s.pool.position.z = tz;
      s.pool.material.opacity = off ? 0.04 : 0.2;
      // aim the visible cone from head → pool
      const dx = tx - s.headX, dy = 0 - s.headY, dz = tz - s.headZ;
      const len = Math.hypot(dx, dy, dz) || 1;
      s.cone.position.set((s.headX + tx) / 2, s.headY / 2, (s.headZ + tz) / 2);
      s.cone.scale.y = len / 13;
      s.cone.lookAt(tx, 0, tz); s.cone.rotateX(Math.PI / 2);
      s.cone.material.opacity = off ? 0.02 : 0.1;
    }
  }

  /* ------------------------------------------------------------ GUARDS ---- */
  // routes are LOCAL polylines; a guard walks its loop, and its cone faces the
  // direction of travel (honest vision). Stationed guards scan in place.
  function makeGuard(ctx, route, opts) {
    opts = opts || {};
    if (V.guards.length >= GUARD_CAP) return null;
    const start = route[0];
    const face = opts.face != null ? opts.face : 0;
    const h = ctx.npc({
      role: "guard", name: opts.name || "Sentry", post: "pinned", pose: "stand",
      at: [start[0], start[1]], face,
    });
    const grp = h.ped ? h.ped.group : (h.rig && h.rig.g);
    const gd = {
      handle: h, ped: h.ped || null, group: grp,
      route, seg: 0, lx: start[0], lz: start[1], face,
      speed: opts.speed || 2.6, viewDist: opts.viewDist || VIEW_DIST, half: opts.half || VIEW_HALF,
      mode: opts.mode || "patrol", station: opts.station || null, baseFace: face,
      extra: !!opts.extra,
      adapter: { group: grp, viewDist: opts.viewDist || VIEW_DIST, half: opts.half || VIEW_HALF, dead: false, ko: 0, bribed: 0, corrupt: false },
    };
    V.guards.push(gd);
    return gd;
  }
  function spawnBaseGuards(ctx) {
    // motor pool ring — makes the vehicle theft hot
    makeGuard(ctx, [[-150, -90], [-70, -90], [-70, -40], [-150, -40]], { name: "Motor Pool Sentry", speed: 2.7 });
    // prototype approach — makes the photo hard
    makeGuard(ctx, [[-120, -160], [-120, -100], [-200, -100], [-200, -160]], { name: "Hangar Sentry", speed: 2.6 });
    // comms/central
    makeGuard(ctx, [[40, -150], [120, -150], [120, -60], [40, -60]], { name: "Signals Sentry", speed: 2.8 });
    // central yard rover
    makeGuard(ctx, [[0, 60], [80, 60], [80, -10], [0, -10]], { name: "Yard Sentry", speed: 2.9 });
    // GATE post — stationed, scanning into the base
    makeGuard(ctx, [[210, -8]], { name: "Gate Sentry", mode: "post", station: [210, -8], face: -Math.PI / 2, viewDist: GATE_VIEW_DIST });
    V.baseGuardCount = V.guards.length;
  }
  function stepGuard(gd, dt) {
    // HUNT: at ORANGE+ a guard that has eyes on you closes in for the grab
    if (gd.mode === "hunt") {
      const P = player(); if (!P) return;
      const tlx = P.pos.x - V.origin.x, tlz = P.pos.z - V.origin.z;
      const dx = tlx - gd.lx, dz = tlz - gd.lz, d = Math.hypot(dx, dz);
      const step = gd.speed * 1.7 * dt;
      if (d > 0.01) { gd.lx += dx / d * Math.min(step, d); gd.lz += dz / d * Math.min(step, d); gd.face = Math.atan2(dx, dz); }
      gd.handle.at(gd.lx, gd.lz, gd.face);
      return;
    }
    if (gd.mode === "post") {
      const s = gd.station;
      gd.face = gd.baseFace + Math.sin(simT * 0.5 + gd.lz) * 0.7;   // sweep the cone
      gd.handle.at(s[0], s[1], gd.face);
      return;
    }
    const pts = gd.mode === "mess" ? gd.messRoute : gd.route;
    if (!pts || pts.length < 2) { gd.handle.at(gd.lx, gd.lz, gd.face); return; }
    const tgt = pts[(gd.seg + 1) % pts.length];
    const dx = tgt[0] - gd.lx, dz = tgt[1] - gd.lz, d = Math.hypot(dx, dz);
    const step = gd.speed * dt;
    if (d <= step) { gd.lx = tgt[0]; gd.lz = tgt[1]; gd.seg = (gd.seg + 1) % pts.length; }
    else { gd.lx += dx / d * step; gd.lz += dz / d * step; }
    if (d > 0.01) gd.face = Math.atan2(tgt[0] - gd.lx, tgt[1] - gd.lz);
    gd.handle.at(gd.lx, gd.lz, gd.face);
  }
  // player detection = the ENGINE's CBZ.guardSees, verbatim, on a live ped view
  function guardSeesPlayer(gd) {
    if (!gd.group || (gd.ped && gd.ped.dead)) return false;
    gd.adapter.group = gd.group;
    gd.adapter.dead = gd.ped ? gd.ped.dead : false;
    if (CBZ.guardSees) return CBZ.guardSees(gd.adapter);
    const P = player();
    return guardSeesPoint(gd.adapter, P.pos.x, P.pos.z, P.pos.y + 1.0, P.crouch);
  }
  function anyGuardSeesPlayer() {
    for (const gd of V.guards) if (guardSeesPlayer(gd)) return gd;
    return false;
  }
  function spawnExtras(n) {
    // reinforcements at higher alert — real ctx.npc peds converging on the gate
    const posts = [[190, 20], [150, -30], [30, 30], [-40, -60]];
    for (let i = 0; i < n && V.guards.length < GUARD_CAP; i++) {
      const p = posts[i % posts.length];
      makeGuard(C, [[p[0], p[1]], [p[0] - 40, p[1] + 20], [p[0] - 20, p[1] - 30]], { name: "Reinforcement", speed: 3.1, extra: true });
    }
  }
  function despawnExtras() {
    for (let i = V.guards.length - 1; i >= 0; i--) {
      if (V.guards[i].extra) { try { V.guards[i].handle.remove(); } catch (e) {} V.guards.splice(i, 1); }
    }
  }

  /* --------------------------------------------------- ALERT LADDER ------ */
  function tierOf(a) { let t = 0; for (let i = 0; i < TIER_AT.length; i++) if (a >= TIER_AT[i]) t = i; return t; }
  function setAlarm(a) {
    RT.alarm = clamp(a, 0, 100);
    const nt = tierOf(RT.alarm);
    if (nt !== RT.tierIdx) onTierChange(RT.tierIdx, nt);
    RT.tierIdx = nt;
  }
  function onTierChange(oldIdx, nt) {
    // apply consequences by ABSOLUTE tier (idempotent — safe up or down)
    gateLock(nt >= 3);
    const wantExtras = nt >= 3 ? 4 : nt >= 2 ? 2 : 0;
    const haveExtras = V.guards.filter((g) => g.extra).length;
    if (wantExtras > haveExtras) spawnExtras(wantExtras - haveExtras);
    else if (wantExtras < haveExtras) { despawnExtras(); if (wantExtras) spawnExtras(wantExtras); }
    if (!C) return;
    if (nt > oldIdx) {
      const msg = nt === 1 ? "ALERT: YELLOW — they're suspicious"
        : nt === 2 ? "ALERT: ORANGE — patrols doubling, lights sweeping"
          : "ALERT: RED — gate sealed, they're hunting";
      C.hud.toast(msg);
      if (nt >= 2 && CBZ.shake) CBZ.shake(nt === 3 ? 0.5 : 0.3);
    } else if (nt < oldIdx && nt === 0) {
      C.hud.feed("Alert cooling — you're a ghost again.", "#8fe39a");
    }
  }

  /* --------------------------------------------------- MESS TIMETABLE ---- */
  function updateMess(dt) {
    RT.messT -= dt;
    if (RT.messT <= 0) { RT.messOn = !RT.messOn; RT.messT = RT.messOn ? 22 : 40; onMessChange(); }
    if (V.messLight) V.messLight.intensity = RT.messOn ? (simT < RT.genUntil ? 0.15 : 1.1) : 0.0;
  }
  function onMessChange() {
    // off-shift: send ~half the PATROL guards (not the gate/hunt) to the mess
    const mx = V.mess.lx, mz = V.mess.lz;
    let sent = 0;
    for (const gd of V.guards) {
      if (gd.mode === "post" || gd.mode === "hunt" || gd.extra) continue;
      if (RT.messOn && sent < 2) {
        gd.messRoute = [[mx - 6, mz + 7], [mx + 6, mz + 7], [gd.route[0][0], gd.route[0][1]]];
        gd.mode = "mess"; gd.seg = 0; sent++;
      } else if (!RT.messOn && gd.mode === "mess") {
        gd.mode = "patrol"; gd.seg = 0;
      }
    }
    if (C && RT.messOn) C.hud.feed("Mess call — some sentries break for chow.", "#cfe3ff");
  }

  /* --------------------------------------------------- ELECTRIC FENCE ---- */
  function checkFence(dt) {
    RT.zapCd = Math.max(0, RT.zapCd - dt);
    if (RT.zapCd > 0 || simT < RT.genUntil) return;    // (dark = fence off too? no — keep it live; only cd gates)
    const P = player(); if (!P) return;
    const plx = P.pos.x - V.origin.x, plz = P.pos.z - V.origin.z;
    for (const r of V.fence) {
      if (segDist(plx, plz, r.ax, r.az, r.bx, r.bz) < 1.3) {
        RT.zapCd = 1.4;
        setAlarm(RT.alarm + 18);
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(8, null, null, "electrified fence", false, null, true);
        if (CBZ.shake) CBZ.shake(0.4);
        hint("ELECTRIFIED FENCE — bad idea", "#ff5a4a");
        return;
      }
    }
  }

  /* ------------------------------------------------------------- JOBS ---- */
  function completeJob(name) {
    const nb = nightBag();
    if (!nb || nb[name]) return false;
    nb[name] = true; save();
    if (C) {
      C.wallet.give(PAY[name] || 0, name === "photo" ? "Prototype photographed"
        : name === "tap" ? "Comms mast tapped" : "Military vehicle stolen");
      C.hud.toast((name === "photo" ? "PHOTO SECURED" : name === "tap" ? "COMMS TAPPED" : "HARDWARE STOLEN") + " — job done");
    }
    if (nb.photo && nb.tap && nb.steal && C) C.hud.feed("All three jobs done. CRASH THE GATE in a stolen vehicle.", "#ffd166");
    return true;
  }
  function isPilotingMilitary() {
    const P = player(); if (!P) return false;
    if (CBZ.cityArmorActive && CBZ.cityArmorActive()) return true;        // tank / armored truck
    if (P._aircraft) { for (const v of (CBZ.cityMilitaryVehicles || [])) if (v && v.taken) return true; }  // mil airframe
    return false;
  }
  function updateJobs(dt) {
    const nb = nightBag(); if (!nb || !nb.active) return;
    const P = player(); if (!P) return;
    // PHOTOGRAPH: close + unobstructed LOS to the prototype, hold to frame
    if (!nb.photo && V.proto) {
      const near = d2(P.pos.x, P.pos.z, V.proto.wx, V.proto.wz) < PHOTO_R;
      const clear = near && losClear(P.pos.x, P.pos.y + 1.4, P.pos.z, V.proto.wx, V.proto.y, V.proto.wz);
      if (clear) {
        RT.photoT += dt;
        hint("Framing the prototype… " + Math.min(100, Math.round(RT.photoT / PHOTO_HOLD * 100)) + "%");
        if (RT.photoT >= PHOTO_HOLD) { RT.photoT = 0; completeJob("photo"); }
      } else { if (near && !clear) hint("No clean shot — get past the revetment wall"); RT.photoT = Math.max(0, RT.photoT - dt * 1.5); }
    }
    // COMMS TAP: at the junction box, hold-to-install, but only while UNSEEN
    if (!nb.tap && V.comms) {
      const near = d2(P.pos.x, P.pos.z, V.comms.wx, V.comms.wz) < TAP_R;
      if (near) {
        if (RT.seen) { hint("Spotted — can't work the mast now"); RT.tapT = Math.max(0, RT.tapT - dt * 0.8); }
        else {
          RT.tapT += dt;
          hint("Installing tap… " + Math.min(100, Math.round(RT.tapT / TAP_HOLD * 100)) + "%");
          if (RT.tapT >= TAP_HOLD) { RT.tapT = 0; completeJob("tap"); }
        }
      } else RT.tapT = Math.max(0, RT.tapT - dt);
    }
    // STEAL: board a REAL military vehicle (militaryvehicles.js)
    if (!nb.steal && isPilotingMilitary()) completeJob("steal");
    // EXTRACTION: all three done + piloting + across the gate line = WIN
    if (nb.photo && nb.tap && nb.steal && isPilotingMilitary() && P.pos.x > V.gateX) winExtract(false);
  }

  /* ------------------------------------------------------ WIN / LOSE ---- */
  function winExtract(force) {
    const nb = nightBag(); if (!nb || !nb.active) return null;
    if (force) { nb.photo = nb.tap = nb.steal = true; }
    // crash the gate: break the boom/barrier
    gateLock(false);
    if (V.barrier && V.barrier.mesh) V.barrier.mesh.visible = false;
    const cashBefore = C ? C.wallet.cash() : 0;
    const payout = PAY.extract;
    if (C) C.wallet.give(payout, "Fort Halstead — extraction bonus");
    const cashAfter = C ? C.wallet.cash() : payout;
    nb.active = false; RT.outcome = "win";
    if (state) { state.wins = (state.wins || 0) + 1; state.best = Math.max(state.best || 0, payout); }
    save();
    if (C) { C.hud.toast("EXTRACTED — CONTRACT PAID"); openWinPanel(payout); if (CBZ.shake) CBZ.shake(0.8); }
    return { won: true, payout, cashBefore, cashAfter, jobs: { photo: nb.photo, tap: nb.tap, steal: nb.steal } };
  }

  /* ------------------------------------------------------------- BRIG ---- */
  function triggerCaught(reason) {
    if (RT.brig.active) return { caught: nightBag().caught };
    const nb = nightBag();
    nb.caught = (nb.caught || 0) + 1; save();
    if (nb.caught >= 2) { courtMartial(); return { caught: nb.caught, lost: true }; }
    enterBrig(reason);
    return { caught: nb.caught, brig: true };
  }
  function enterBrig(reason) {
    RT.brig.active = true;
    RT.alarm = 0; RT.tierIdx = 0; gateLock(false); despawnExtras();
    // reset any hunters
    for (const gd of V.guards) if (gd.mode === "hunt") { gd.mode = "patrol"; gd.seg = 0; }
    const P = player(), cell = V.brigCell;
    if (P && cell) { P.pos.set(cell.wx, floorY(cell.wx, cell.wz) + 0.1, cell.wz); P.vy = 0; if (P.driving && CBZ.cityExitArmor) try { CBZ.cityExitArmor(); } catch (e) {} }
    // slam the cell door (a real collider) until the lock is picked
    if (!V.brigDoor) V.brigDoor = C.solid(cell.lx - 2.4, cell.lz + 2.2, cell.lx + 2.4, cell.lz + 2.8, 0, 3.6);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (C) { C.hud.toast("CAUGHT — THE BRIG"); C.hud.feed(reason || "Hands where I can see them.", "#ff5a4a"); }
    if (CBZ.shake) CBZ.shake(0.7);
    startLockpick();
  }
  function escapeBrig() {
    if (!RT.brig.active) return;
    RT.brig.active = false;
    if (V.brigDoor) { const i = CBZ.colliders ? CBZ.colliders.indexOf(V.brigDoor) : -1; if (i >= 0) CBZ.colliders.splice(i, 1); V.brigDoor = null; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
    const P = player(), cell = V.brigCell;
    if (P && cell) { P.pos.set(cell.wx, floorY(cell.wx, cell.wz) + 0.1, cell.wz + 4); P.vy = 0; }
    setAlarm(TIER_AT[1] + 2);                          // back out at YELLOW, they're looking
    if (RT.brig.keyH) { window.removeEventListener("keydown", RT.brig.keyH); RT.brig.keyH = null; }
    if (C) { C.hud.closePanel(); C.hud.toast("LOCK PICKED — you slip out"); }
  }
  function courtMartial() {
    RT.brig.active = false; RT.outcome = "lose";
    gateLock(false); despawnExtras();
    if (state) state.losses = (state.losses || 0) + 1;
    const nb = nightBag(); nb.active = false;
    save();
    if (C) openCourtPanel();
  }
  function resetArc() {
    // court-martial dismissed → wipe the night, drop the player back at the gate
    state.night = { active: false, photo: false, tap: false, steal: false, caught: 0 };
    RT.alarm = 0; RT.tierIdx = 0; RT.photoT = RT.tapT = 0; gateLock(false); despawnExtras();
    restoreLights(); RT.genUntil = 0;
    const P = player();
    if (P && V) { const wx = V.origin.x + V.fixerAt[0], wz = V.origin.z + V.fixerAt[1] + 4; P.pos.set(wx, floorY(wx, wz) + 0.1, wz); P.vy = 0; }
    save();
    if (C) C.hud.closePanel();
  }

  /* ---- LOCKPICK minigame (cell-block-z homage) — a 3-pin timing lock ----
     A marker sweeps a bar (driven by ctx.anim); SET (button or Space) when it's
     in the green zone to seat a pin. Seat all 3 to pop the lock. Miss = the
     marker jitters faster (never a hard fail — the brig is escapable). */
  function startLockpick() {
    const bk = RT.brig;
    bk.pins = [0, 1, 2].map(() => { const c = 30 + Math.random() * 40; return { lo: c - 9, hi: c + 9, set: false }; });
    bk.pin = 0; bk.marker = 5; bk.dir = 1; bk.spd = 46;
    renderLockpick();
    if (!bk.keyH) { bk.keyH = (e) => { if (e.code === "Space" && RT.brig.active) { e.preventDefault(); tryPin(); } }; window.addEventListener("keydown", bk.keyH); }
    // animate the marker; ctx.anim returns false to end when the brig closes
    C.anim(function (dt) {
      if (!RT.brig.active) return false;
      const bk = RT.brig;
      bk.marker += bk.dir * bk.spd * dt;
      if (bk.marker >= 100) { bk.marker = 100; bk.dir = -1; }
      else if (bk.marker <= 0) { bk.marker = 0; bk.dir = 1; }
      const el = document.getElementById("milPickMarker");
      if (el) el.style.left = bk.marker.toFixed(1) + "%";
      return true;
    });
  }
  function tryPin() {
    const bk = RT.brig; const p = bk.pins[bk.pin]; if (!p) return;
    if (bk.marker >= p.lo && bk.marker <= p.hi) {
      p.set = true; bk.pin++;
      if (CBZ.sfx) CBZ.sfx("coin");
      if (bk.pin >= bk.pins.length) { escapeBrig(); return; }
      bk.marker = 5; bk.dir = 1; renderLockpick();
    } else {
      bk.spd = Math.min(80, bk.spd + 8);               // slipped — it gets twitchier
      if (CBZ.sfx) CBZ.sfx("hit");
      hint("Pin slipped");
    }
  }
  function renderLockpick() {
    const bk = RT.brig;
    const p = bk.pins[bk.pin] || { lo: 45, hi: 55 };
    const pins = bk.pins.map((x, i) => "<span style='display:inline-block;width:22px;height:22px;border-radius:5px;margin-right:5px;background:" + (x.set ? "#35d07a" : i === bk.pin ? "#e8b64c" : "#26343c") + "'></span>").join("");
    const html =
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b64c;font-size:17px'>THE BRIG — PICK THE LOCK</b>" +
      "<span style='font-size:12px'>pin " + (bk.pin + 1) + " / " + bk.pins.length + "</span></div>" +
      "<div style='font-size:12px;opacity:.85;margin-bottom:8px'>Seat each pin: hit <b>SET</b> (or Space) when the pick is in the green.</div>" +
      "<div>" + pins + "</div>" +
      "<div style='position:relative;height:26px;margin:10px 0;background:#12181c;border-radius:8px;overflow:hidden'>" +
      "<div style='position:absolute;top:0;bottom:0;left:" + p.lo + "%;width:" + (p.hi - p.lo) + "%;background:rgba(53,208,122,.55)'></div>" +
      "<div id='milPickMarker' style='position:absolute;top:0;bottom:0;left:" + bk.marker + "%;width:3px;background:#fff6e2'></div>" +
      "</div>" +
      "<span data-act='set' style='display:inline-block;padding:9px 18px;border-radius:11px;background:#1c6b40;font-weight:800;cursor:pointer'>SET</span>";
    C.hud.panel(html, { set: () => tryPin() });
  }

  /* ------------------------------------------------------- PANELS -------- */
  const BTN = "display:inline-block;margin:4px 8px 4px 0;padding:9px 15px;border-radius:11px;cursor:pointer;font-weight:800;font-size:14px;";
  function openBriefing() {
    const nb = nightBag();
    const jrow = (done, label) => "<div style='margin:2px 0'>" + (done ? "" : "▫") + " " + label + "</div>";
    const html =
      "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#d8e6b0;font-size:17px'>FORT HALSTEAD — RESTRICTED AREA</b>" +
      "<span style='font-size:13px'>cash <b style='color:#ffd451'>$" + C.wallet.cash().toLocaleString() + "</b></span></div>" +
      "<div style='font-size:12px;opacity:.9;margin-bottom:6px'>One night. Three jobs, any order, then crash the gate in something with tracks.</div>" +
      jrow(nb.photo, "Photograph the prototype (far hangar) — $" + PAY.photo.toLocaleString()) +
      jrow(nb.tap, "Tap the comms mast (hold, stay unseen) — $" + PAY.tap.toLocaleString()) +
      jrow(nb.steal, "Steal a military vehicle — $" + PAY.steal.toLocaleString()) +
      "<div style='margin:4px 0;font-size:12px;opacity:.85'>Extraction: crash the gate in a stolen vehicle — $" + PAY.extract.toLocaleString() + "</div>" +
      "<div style='margin-top:8px'>" +
      (nb.active
        ? "<span style='" + BTN + "background:#26343c;color:#8fe39a'>CONTRACT ACTIVE · alert " + TIERS[RT.tierIdx] + "</span>"
        : "<span data-act='accept' style='" + BTN + "background:#1c6b40;color:#eafff0'>Take the contract</span>") +
      "<span data-act='close' style='" + BTN + "background:#26343c;color:#dfe7ff'>Leave</span></div>" +
      "<div style='font-size:11px;opacity:.6;margin-top:6px'>Nights won: " + ((state && state.wins) || 0) + " · lost: " + ((state && state.losses) || 0) + "</div>";
    C.hud.panel(html, {
      accept: () => { startNight(); openBriefing(); },
      close: () => C.hud.closePanel(),
    });
  }
  function startNight() {
    const nb = nightBag();
    nb.active = true; nb.photo = nb.tap = nb.steal = false; nb.caught = 0;
    RT.alarm = 0; RT.tierIdx = 0; RT.outcome = "none"; RT.photoT = RT.tapT = 0;
    save();
    C.hud.toast("CONTRACT ACTIVE — go dark");
  }
  function openWinPanel(payout) {
    C.hud.panel(
      "<b style='letter-spacing:2px;color:#35d07a;font-size:18px'>EXTRACTED</b>" +
      "<div style='margin:8px 0'>Prototype shot, comms tapped, hardware gone, gate in pieces.</div>" +
      "<div style='font-size:15px'>Contract paid: <b style='color:#ffd451'>$" + payout.toLocaleString() + "</b></div>" +
      "<div style='margin-top:10px'><span data-act='close' style='" + BTN + "background:#1c6b40;color:#eafff0'>Nice</span></div>",
      { close: () => C.hud.closePanel() }
    );
  }
  function openCourtPanel() {
    C.hud.panel(
      "<b style='letter-spacing:2px;color:#ff5a4a;font-size:18px'>COURT MARTIAL</b>" +
      "<div style='margin:8px 0'>Caught twice in one night. The contract's blown and the base is locked down tight.</div>" +
      "<div style='font-size:12px;opacity:.8'>The fixer will take you back at the gate. Try again.</div>" +
      "<div style='margin-top:10px'><span data-act='reset' style='" + BTN + "background:#7a2b2b;color:#ffe0e0'>Reset the night</span></div>",
      { reset: () => resetArc() }
    );
  }

  /* ============================================================ update === */
  function update(ctx, dt) {
    if (!V) return;
    C = C || ctx;
    // stealth stack is a city-mode game; nothing to do in jail/disaster/menu
    if (!CBZ.game || CBZ.game.mode !== "city" || CBZ.game.state !== "playing") return;
    dt = Math.min(0.05, dt || 0);
    simT += dt;
    RT.hintCd = Math.max(0, RT.hintCd - dt);

    const P = player();
    const near = P && d2(P.pos.x, P.pos.z, V.origin.x, V.origin.z) < (BASE.hx + NEAR);
    // restore generator power when the window elapses (runs even if player left)
    if (RT.genUntil && simT >= RT.genUntil) { restoreLights(); RT.genUntil = 0; }
    if (!near) return;                                  // idle when the player's away

    updateBeams(dt);
    updateMess(dt);

    // drive guards + read the ENGINE detection
    let seen = false, seeGuard = null, huntTouch = false;
    for (const gd of V.guards) {
      stepGuard(gd, dt);
      if (guardSeesPlayer(gd)) {
        seen = true; seeGuard = gd;
        // at ORANGE+ a seer becomes a hunter; contact = grab
        if (RT.tierIdx >= 2) gd.mode = "hunt";
        if (gd.mode === "hunt" && d2(P.pos.x, P.pos.z, V.origin.x + gd.lx, V.origin.z + gd.lz) < 1.8) huntTouch = true;
      } else if (gd.mode === "hunt" && RT.tierIdx < 2) { gd.mode = "patrol"; gd.seg = 0; }
    }
    // test-cone contribution (api.placeTestGuard) — kept isolated for probes
    if (RT.testGuard && guardSeesPoint(RT.testGuard, P.pos.x, P.pos.z, P.pos.y + 1.0, P.crouch)) seen = true;

    // searchlight sensor — the SHIPPED CBZ.litBySearchlight over my pools
    const lit = CBZ.litBySearchlight ? CBZ.litBySearchlight(P.pos, P.crouch) : false;
    RT.seen = seen;

    // ---- ALERT LADDER dynamics ----
    if (!RT.brig.active && RT.outcome !== "lose") {
      if (seen) {
        const dd = seeGuard ? d2(P.pos.x, P.pos.z, V.origin.x + seeGuard.lx, V.origin.z + seeGuard.lz) : 20;
        setAlarm(RT.alarm + (14 + Math.max(0, 20 - dd) * 1.2) * dt);      // closer = hotter
      }
      if (lit) setAlarm(RT.alarm + (P.crouch ? 16 : 28) * dt);
      if (!seen && !lit) setAlarm(RT.alarm - 7 * dt);                      // cool when clean
      checkFence(dt);
    }

    // capture: a hunter with hands on you, OR any seer at RED point-blank
    if (!RT.brig.active && RT.outcome !== "lose") {
      const pointBlank = seen && seeGuard && d2(P.pos.x, P.pos.z, V.origin.x + seeGuard.lx, V.origin.z + seeGuard.lz) < 1.8 && RT.tierIdx >= 3;
      if (huntTouch || pointBlank) triggerCaught("Grabbed by a sentry.");
    }

    updateJobs(dt);
  }

  /* ============================================================ api ====== */
  // world-space guard-shaped object for point tests (probe helper)
  function mkTestGuard(wx, wz, yaw, vd, half) {
    return { group: { position: { x: wx, y: 0, z: wz }, rotation: { y: yaw } }, viewDist: vd || VIEW_DIST, half: half == null ? VIEW_HALF : half, dead: false, ko: 0, bribed: 0, corrupt: false };
  }
  const api = {
    mounted: () => !!V,
    anchor: () => (V ? { x: V.origin.x, z: V.origin.z, via: V.via, gateX: V.gateX, gateZ: V.gateZ } : null),
    bounds: () => (V ? Object.assign({}, V.bounds) : null),
    state: () => (state ? JSON.parse(JSON.stringify(state)) : null),
    night: () => { const nb = nightBag(); return nb ? Object.assign({ alarm: RT.alarm, tier: TIERS[RT.tierIdx], outcome: RT.outcome, brig: RT.brig.active }, JSON.parse(JSON.stringify(nb))) : null; },
    guards: () => V ? V.guards.map((g) => ({ viewDist: g.viewDist, lx: g.lx, lz: g.lz, mode: g.mode, extra: g.extra })) : [],
    guardCount: () => (V ? V.guards.length : 0),

    // ---- DETECTION (reuses CBZ.losRaycast/losBlockers + the guardSees cone) ----
    // does ANY live guard (or the placed test cone) see world point (x,z)?
    seen: (x, z, ty) => {
      if (!V) return false;
      for (const gd of V.guards) { gd.adapter.group = gd.group; gd.adapter.dead = gd.ped ? gd.ped.dead : false; if (guardSeesPoint(gd.adapter, x, z, ty, false)) return true; }
      if (RT.testGuard && guardSeesPoint(RT.testGuard, x, z, ty, false)) return true;
      return false;
    },
    losClear: (sx, sy, sz, tx, ty, tz) => losClear(sx, sy, sz, tx, ty, tz),
    placeTestGuard: (wx, wz, yaw, vd, half) => { RT.testGuard = mkTestGuard(wx, wz, yaw, vd, half); return true; },
    clearTestGuard: () => { RT.testGuard = null; return true; },
    // self-contained agreement proof for the gate: places a sole test cone next
    // to a KNOWN revetment wall and returns the three canonical outcomes, each
    // resolved by the SAME engine LOS stack the player detection uses.
    probeVision: () => {
      if (!V || !V.probeWall) return null;
      const w = V.probeWall;
      const g = mkTestGuard(w.wx - 6, w.wz, Math.PI / 2, 24, VIEW_HALF);     // face +X toward the wall
      const ahead = guardSeesPoint(g, w.wx - 1, w.wz, 1.0);                  // in-cone, before the wall → clear
      const behindWall = guardSeesPoint(g, w.wx + 4, w.wz, 1.0);            // in-cone, past the wall → blocked
      const openOpen = mkTestGuard(V.origin.x, V.origin.z, Math.PI / 2, 24, VIEW_HALF);
      const side = guardSeesPoint(openOpen, V.origin.x, V.origin.z + 10, 1.0); // 90° off the cone axis → out of cone
      // parity with the shipped function for a real guard, if one is up
      let parity = null;
      const gd = V.guards[0];
      if (gd && gd.group && CBZ.guardSees && CBZ.player) {
        gd.adapter.group = gd.group; gd.adapter.dead = gd.ped ? gd.ped.dead : false;
        const engine = CBZ.guardSees(gd.adapter);
        const mine = guardSeesPoint(gd.adapter, CBZ.player.pos.x, CBZ.player.pos.z, CBZ.player.pos.y + 1.0, CBZ.player.crouch);
        parity = engine === mine;
      }
      return { ahead, behindWall, side, parity };
    },

    // ---- ALERT LADDER ----
    tier: () => TIERS[RT.tierIdx],
    tierIndex: () => RT.tierIdx,
    alarm: () => RT.alarm,
    setAlarm: (n) => { setAlarm(n); return { alarm: RT.alarm, tier: TIERS[RT.tierIdx] }; },
    bumpAlarm: (n) => { setAlarm(RT.alarm + (n || 0)); return { alarm: RT.alarm, tier: TIERS[RT.tierIdx] }; },
    gateLocked: () => !!(V && V.barrier && V.barrier.col),

    // ---- GENERATOR ----
    lightIntensities: () => (V ? V.lights.map((L) => (L ? +L.intensity.toFixed(3) : 0)) : []),
    sabotageGenerator: () => {
      const before = V ? V.lights.map((L) => +L.intensity.toFixed(3)) : [];
      const r = sabotageGenerator();
      const after = V ? V.lights.map((L) => +L.intensity.toFixed(3)) : [];
      return { before, after, until: r.until, tier: TIERS[RT.tierIdx], beamsDisabled: V.beams.every((s) => s.disabled > 0) };
    },
    restoreLights: () => { restoreLights(); RT.genUntil = 0; return api.lightIntensities(); },

    // ---- BRIG / arc (rig via api) ----
    caught: () => { const nb = nightBag(); return nb ? nb.caught : 0; },
    brigActive: () => RT.brig.active,
    forceCatch: (reason) => triggerCaught(reason || "test"),
    brigPick: (ok) => { if (!RT.brig.active) return { active: false }; if (ok === false) { tryPin(); return { active: RT.brig.active }; } escapeBrig(); return { escaped: true, active: RT.brig.active }; },
    outcome: () => RT.outcome,

    // ---- JOBS / WIN math (rig via api) ----
    jobs: () => { const nb = nightBag(); return nb ? { photo: nb.photo, tap: nb.tap, steal: nb.steal, active: nb.active } : null; },
    startNight: () => { if (C) startNight(); return api.jobs(); },
    completeJob: (name) => completeJob(name),
    winExtract: (force) => winExtract(force !== false),
    isPiloting: () => isPilotingMilitary(),
    pay: () => Object.assign({}, PAY),
  };

  /* ============================================================ register = */
  CBZ.games.register({
    id: "military",
    title: "FORT HALSTEAD",
    venue: { site: "military", resolve },
    build,
    update,
    api,
  });

  /* --- small shared prop: an emissive placard (canvasTex) ----------------- */
  function signPlate(ctx, lx, y, lz, text, ry) {
    const tex = ctx.canvasTex(256, 64, (c2) => {
      c2.fillStyle = "#0d1013"; c2.fillRect(0, 0, 256, 64);
      c2.strokeStyle = "#d4a017"; c2.lineWidth = 3; c2.strokeRect(3, 3, 250, 58);
      c2.fillStyle = "#e8c020"; c2.font = "bold 20px Trebuchet MS"; c2.textAlign = "center";
      c2.fillText(text, 128, 40);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(lx, y, lz); m.rotation.y = ry || 0;
    m.userData.gamePkg = "military";
    V.group.add(m);
    return m;
  }
})();
