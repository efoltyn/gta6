/* ============================================================
   city/ragdoll.js — verlet point-and-stick corpse physics.

   Kills near the camera stop playing the canned grapple fling and become
   REAL bodies: 13 mass points (head, shoulders, hips, elbows, hands,
   knees, feet) joined by distance sticks (rigid torso quad + cross
   bracing, lolling head, 2-bone limbs), integrated Jakobsen-style with
   gravity, ground friction + a whisper of bounce, and the shared wall
   pusher. Bodies fold over ledges, slump down stairwells, skid off a
   shotgun blast — then sleep, freeze their pose, and ride the EXISTING
   corpse timeline (deadT → medic pickup → cull) untouched.

   The render rig is never cloned or replaced: we re-orient the SAME part
   meshes (group/neck/la/ra/ll/rl) from point pairs every frame, so
   wounds.js discs, blood soak, loot prompts and dismembered limbs all
   ride along for free. Runs at order 25 — right after grapple's body
   step (24) so we overwrite its corpse pose, and before medics (34.7)
   so the paramedic lift still wins the frame.

   Contract kept: starting a ragdoll pins _phys.down=9999 (CBZ.body.busy
   stays true forever → peds.js never re-grounds the corpse) and zeroes
   the grapple fling so only ONE simulation moves the body.

   PINNING (CBZ.ragdollPin/ragdollUnpin/ragdollPinned): one point of the
   skeleton is held at a world position that something else owns — a jaw,
   a hand, a hook — and the other twelve whip off it. In verlet this is
   nearly free (write p=q at the held point after the constraint pass, so
   the accumulated velocity can't fight the hold), and it is the whole
   difference between a corpse being carried and a corpse being SHAKEN.

   BUOYANCY (CBZ.CONFIG.RAGDOLL_BUOYANCY): a body in the sea used to keep
   the full 22 u/s² and sink straight through the seabed clamp into the
   dark, which is exactly the wrong read — a corpse in water rises and
   floats splayed. Per point, the gravity term ramps toward net-upward and
   the velocity damps hard once it is under the live surface. It is a
   strict no-op on land: the water test is one query per body per frame and
   answers "dry" for every land kill, so every existing land behaviour is
   byte-identical.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // bodies actually solving (LRU early-freeze past this) — rides the LIVE
  // quality tier (pause-menu slider): ~7 at tier 0 up to ~28 at tier 4
  // (mid-tier ≈ the old 14, sized for a sprint/burst through the
  // 1000-strong street). Read at use time — never snapshot the tier.
  function MAX_ACTIVE() {
    // A SPECTATOR PAGE IS NOT THE CITY. games/battle.html watches two armies
    // from a flying camera: whole ranks go down in the same second and every
    // body this refuses falls back to a canned plank topple. Callers raise the
    // CEILING; the number stays derived from the live quality tier otherwise.
    const c = CBZ.CONFIG.RAGDOLL_ACTIVE;
    if (c > 0) return c | 0;
    return CBZ.qScale ? CBZ.qScale(7, 28) : 14;
  }
  // total slots incl. frozen corpses still holding pose. Grown lazily (see
  // pool()) so raising the ceiling costs nothing until the bodies arrive.
  function POOL_N() {
    const p = CBZ.CONFIG.RAGDOLL_POOL;
    return (p > 0) ? Math.min(320, p | 0) : 36;
  }
  // only kills this close to the camera get the flop. A page that flies its
  // camera OVER the fight rather than standing in it legitimately wants this
  // wider — CBZ.CONFIG.RAGDOLL_RANGE is that dial, in metres.
  function RANGE2() {
    const r = CBZ.CONFIG.RAGDOLL_RANGE;
    return ((r > 0) ? +r : 60) ** 2;
  }
  const SLEEP_V = 0.22;       // u/s — under this the body counts as still
  const SLEEP_T = 0.6;        // s of stillness before the pose freezes
  const MAX_LIFE = 7;         // hard cap on solve time (safety)
  const ITER = 3;             // constraint relaxation passes per substep
  const KICK_DT = 1 / 120, VK = 0.52;   // velocities live per-SUBSTEP (two substeps/frame)
  function GRAV() { return (CBZ.TUNE && CBZ.TUNE.gravity) || 22; }

  // ---- WATER (flag declared here; we do not edit src/config.js) -------------
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.RAGDOLL_BUOYANCY == null) CFG.RAGDOLL_BUOYANCY = true;

  /* ---- WHO IS ALLOWED A REAL BODY (CBZ.CONFIG.RAGDOLL_ANY_MODE) -----------
     This file tested `CBZ.game.mode === "city"` in two places and refused
     everything else. That gate was never about the SOLVER — 13 points, sticks,
     joint limits and a ground clamp have no opinion about which mode is
     running — it was about scope on the day it shipped, when the city was the
     only thing with peds to kill. The cost of leaving it in is that every
     other page with human bodies keeps a canned topple forever:
     games/battle.html watches up to a thousand men die and every one of them
     fell like a plank, rotating rigidly about one axis, while the animals
     standing next to them (systems/quadruped_ragdoll.js, which copied THIS
     file's method) folded properly.

     So the gate becomes a capability the page opts into rather than a name it
     has to be called. Default OFF: every existing mode reads exactly as it
     did, and nothing starts solving bodies because a mode string happened to
     change. A page that wants real corpses says so in one line. */
  if (CFG.RAGDOLL_ANY_MODE == null) CFG.RAGDOLL_ANY_MODE = false;
  function allowed() {
    if (CBZ.CONFIG.RAGDOLL_ANY_MODE === true) return true;
    return !!(CBZ.game && CBZ.game.mode === "city");
  }
  function buoyOn() { return CBZ.CONFIG.RAGDOLL_BUOYANCY !== false; }
  const BUOY_G = -0.35;      // gravity multiplier at full submersion → net UP
  const BUOY_DRAG = 0.86;    // per-substep velocity retention in water (viscous)
  const FLOAT_BAND = 1.6;    // pelvis this close to the surface = floating, not sunk

  // ---- PIN: which mass points a named grab holds ----------------------------
  // "torso"/"hips" hold BOTH points of the pair and are moved together, so the
  // pair keeps its own rest separation and the sticks never fight the hold.
  const PIN_PTS = {
    head: [0], torso: [1, 2], hips: [3, 4],
    la: [7], ra: [8], ll: [11], rl: [12],       // hands and feet — what a jaw actually closes on
  };
  const PIN_MAX = 8;         // seconds, hard safety cap: a pin can never own a body forever

  // 13 points, rig-local rest offsets (character.js joint positions)
  const OFF = [
    0, 2.18, 0,                          // 0 head
    0.62, 1.84, 0, -0.62, 1.84, 0,       // 1,2 shoulders (1 = la, which the rig builds on +x)
    -0.23, 0.95, 0, 0.23, 0.95, 0,       // 3,4 hips
    0.62, 1.375, 0, -0.62, 1.375, 0,     // 5,6 elbows
    0.62, 0.91, 0, -0.62, 0.91, 0,       // 7,8 hands
    -0.23, 0.475, 0, 0.23, 0.475, 0,     // 9,10 knees
    -0.23, 0.02, 0, 0.23, 0.02, 0,       // 11,12 feet
  ];
  // per-point ground radius (half-thickness of the box that point carries)
  const RAD = [0.30, 0.24, 0.24, 0.26, 0.26, 0.15, 0.15, 0.12, 0.12, 0.16, 0.16, 0.14, 0.14];
  // points that get the wall push (extremities + a hip — limbs out of walls)
  const WALLPTS = [0, 3, 7, 8, 11, 12];

  // sticks: flat [i, j, rest, minOnly] — minOnly lets the head loll freely but
  // never fold down into the gut (a one-sided spacer, not a rigid spine).
  const STICKS = [];
  function stick(i, j, minOnly) {
    const dx = OFF[i * 3] - OFF[j * 3], dy = OFF[i * 3 + 1] - OFF[j * 3 + 1], dz = OFF[i * 3 + 2] - OFF[j * 3 + 2];
    STICKS.push(i, j, Math.sqrt(dx * dx + dy * dy + dz * dz), minOnly ? 1 : 0);
  }
  // same one-sided (minOnly) mechanic as stick()'s head spacer, but with an
  // EXPLICIT separation distance instead of the rest-pose gap — these are
  // SELF-COLLISION guards (Jakobsen §"Self collision"), not anatomical spacers,
  // so the minimum is sized off the point's own ground-contact radius (RAD),
  // not off where the limb happens to sit standing at T-pose. (The relaxation
  // loop below shaves every minOnly rest by *0.8 same as the head spacer, so
  // the effective floor lands a hair under the raw radius sum — still plenty
  // to stop a full pass-through, never tight enough to fight a normal stance.)
  function stickMin(i, j, minDist) { STICKS.push(i, j, minDist, 1); }
  stick(1, 2); stick(3, 4); stick(1, 3); stick(2, 4); stick(1, 4); stick(2, 3); // rigid torso quad + braces
  stick(0, 1); stick(0, 2); stick(0, 3, 1); stick(0, 4, 1);                     // head hung off both shoulders
  stick(1, 5); stick(5, 7); stick(2, 6); stick(6, 8);                           // arms
  stick(3, 9); stick(9, 11); stick(4, 10); stick(10, 12);                       // legs
  // SELF-COLLISION: knees/elbows can swing to either side of the sagittal
  // midline as a body ragdolls (falls sideways, tumbles down stairs) — plain
  // distance sticks never stop the left limb passing straight through the
  // right one. A one-sided min-separation stick between the pair (same
  // mechanic as the head spacer above) shoves them apart the instant they'd
  // overlap, and does nothing otherwise, so it never fights the normal spread
  // stance or a crossed-legs sit/slump.
  stickMin(9, 10, RAD[9] + RAD[10]);   // knee vs knee
  stickMin(5, 6, RAD[5] + RAD[6]);     // elbow vs elbow
  // LIMB FOLD: a limp knee or elbow folds a long way but not flat on itself
  // (heel to buttock, fist to shoulder). A floor on the hip-ankle and
  // shoulder-hand distance caps the fold at roughly 125 degrees; spacers are
  // distances, so the relaxation stays stable. (The solver shaves minOnly
  // rests by 0.8, so these are authored at 1/0.8 of the wanted floor.)
  stickMin(3, 11, 0.93 * 0.45 / 0.8); stickMin(4, 12, 0.93 * 0.45 / 0.8);
  stickMin(1, 7, 0.93 * 0.42 / 0.8); stickMin(2, 8, 0.93 * 0.42 / 0.8);
  const NS = STICKS.length / 4;

  function makeSlot(idx) {
    return {
      idx, used: false, ped: null, ch: null, isPlayer: false,
      age: 0, still: 0, asleep: false, life: 0, thud: false,
      cx: 0, cy: 0, cz: 0,                  // pelvis (death cam follows this)
      p: new Float32Array(39), q: new Float32Array(39),
      kv: new Float32Array(39), kicked: false, // pending impulse velocities — applied at the solver's real substep
      // ---- DYING BEAT: a brief active stumble BEFORE the body goes fully
      //      limp, so a shot ped lurches a step in the bullet's travel
      //      direction + buckles at the knees instead of teleporting flat.
      //      dyt counts down; while >0 the solver bends the legs to a brace
      //      then a collapse and shoves the hips along dyx/dyz.
      dyt: 0, dyMax: 0, dyx: 0, dyz: 0, dyForce: 0, dyHead: false,
      // the skeleton is authored for the 2.60 u rig; k scales it to THIS body
      // (humanScale x its own hip height), and fwx/fwz is the way he faced
      k: 1, fwx: 0, fwz: 1, hk: 0.95, noBeat: false,
      rest: new Float32Array(64),            // this body's bone lengths (per stick)
      // ---- held by something (see applyPin) and the water column this body
      //      is in (see waterProbe). wet=false is the land path, byte-identical.
      pin: null, wet: false, seaY: 0, seaDy: 0,
    };
  }
  const slots = [];
  /* THE POOL IS GROWN, NEVER PRE-PAID. Every slot carries several Float32
     arrays, so a page that raises the ceiling for the deaths it MIGHT see
     would otherwise pay for all of them the moment this file parses. The list
     starts at the seed and only reaches for the ceiling when a body actually
     arrives and no free slot is left (see start()). */
  const POOL_SEED = 10;
  function grow(n) {
    const want = Math.min(POOL_N(), n);
    while (slots.length < want) slots.push(makeSlot(slots.length));
    return slots;
  }
  grow(POOL_SEED);
  let seq = 0;

  // scratch — zero per-frame allocation
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const _q2 = new THREE.Quaternion();
  const _m = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _qi = new THREE.Quaternion();
  const _c = { x: 0, y: 0, z: 0 };
  const _np = { x: 0, y: 0, z: 0 }, _nd = { x: 0, y: 0, z: 0 };

  function charOf(t) { return t.char || (t.isPlayer ? CBZ.playerChar : null); }
  // platform-aware support under a point (stairs are ramps, roofs count) —
  // this is what lets a body drape over a ledge and slide down a stairwell.
  function groundUnder(x, z, y) {
    if (CBZ.groundAt) return CBZ.groundAt(x, z, y);
    return CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
  }
  function cl1(v) { return v > 1 ? 1 : (v < -1 ? -1 : v); }

  function releaseSlot(s) {
    if (s.ped) {
      if (s.ped._ragSlot === s.idx) s.ped._ragSlot = null;
      // facial.js owns neck yaw additively on the player — don't leave our twist
      if (s.isPlayer && s.ch && s.ch.neck) s.ch.neck.rotation.y = 0;
    }
    s.used = false; s.ped = null; s.ch = null; s.isPlayer = false;
    s.asleep = false; s.still = 0; s.life = 0; s.thud = false;
    s.kicked = false; s.kv.fill(0);
    s.dyt = 0; s.dyMax = 0; s.dyx = 0; s.dyz = 0; s.dyForce = 0; s.dyHead = false;
    s.pin = null; s.wet = false; s.seaY = 0; s.seaDy = 0;
  }

  // grounded-corpse contract: down=9999 keeps CBZ.body.busy true forever (peds.js
  // skips the body), and the fling is zeroed so grapple never moves it under us.
  function bumpPhys(t) {
    if (t.isPlayer) return;                      // physics.js owns the player body
    const ph = CBZ.body && CBZ.body.phys ? CBZ.body.phys(t) : t._phys;
    if (!ph) return;
    ph.air = false; ph.vx = ph.vy = ph.vz = 0; ph.kx = ph.kz = 0;
    ph.spin = ph.spinZ = 0; ph.shock = 0; ph.settle = 1;
    ph.down = Math.max(ph.down, 9999);
    if (t._deathSeed == null) t._deathSeed = Math.random() * 6.28;
  }

  /* THE ROUND'S IMPULSE, and nothing that spins him.
     What was here was a TOPPLE COUPLE: the head and shoulders pushed along
     the round at up to 1.6x, the feet kicked BACK toward the gun, a random
     sideways jitter on every point, and a falloff measured in 3D from the
     wound, so a hit on one shoulder pushed that side harder than the other.
     With ground friction holding the planted feet, that is a plank levered
     over its own soles while it twists about them: the "weird pivot, almost
     like one part of their foot is stuck to the ground and they're spinning
     around it" the owner saw.
     A bullet moves a body very little; the fall is the legs giving out. So:
       · the whole body shares the round's momentum along its line (its
         centre of mass moves with the round), the upper body a little more
         because it is struck above the hips, and NOTHING goes back toward the
         gun;
       · the falloff is by HEIGHT only: left and right get the same push, so
         no yaw torque, so no spin;
       · the collapse (the DYING BEAT in solve) takes the knees forward and
         the hips down, with the feet loose on the floor, so the body folds
         and drops along the round instead of hinging on its feet;
       · a headshot drops him almost straight down; a point-blank shotgun or
         a blast still HURLS the whole body (that one is real). */
  function kick(s, point, dir, imp) {
    const p = s.p, q = s.kv; s.kicked = true; // velocities park in kv; solve() converts at its real substep
    let dx = dir ? (dir.x || 0) : 0, dy = dir ? (dir.y || 0) : 0, dz = dir ? (dir.z || 0) : 0;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 0.001) { dx = -s.fwx; dz = -s.fwz; dy = 0; }   // no line at all: he folds back where he stands
    else { dx /= dl; dy /= dl; dz /= dl; }
    const m = Math.max(1, Math.min(34, imp || 6));
    const boom = m >= 20;          // explosion / RPG: lift the whole body
    const heavy = m >= 14;         // point-blank shotgun / car: a real launch
    const k = s.k || 1;
    const px = point ? point.x : null, py = point ? point.y : 0, pz = point ? point.z : 0;
    const hr = 0.6 * k;
    const hs = px != null &&
      ((px - p[0]) * (px - p[0]) + (py - p[1]) * (py - p[1]) + (pz - p[2]) * (pz - p[2])) < hr * hr;
    // arm the DYING BEAT (solve() reads it): the heavier the hit the shorter
    // the on-his-feet collapse before he's fully limp — a blast gives none at
    // all (the body is already airborne), a pistol gives the full buckle.
    if (s.dyt <= 0 && !heavy && !s.noBeat) {
      s.dyMax = s.dyt = Math.max(0.16, Math.min(0.36, 0.36 - (m - 1) * 0.012));
      s.dyx = dx; s.dyz = dz; s.dyForce = m / 6; s.dyHead = hs;
    }
    // the share of the round the body keeps: a pistol ~0.5 m/s, a rifle ~0.9,
    // a close shotgun ~1.6 (theatrical, but a body not a crate)
    const base = heavy ? m * 0.12 : Math.min(1.0, 0.08 * m + 0.05);
    for (let i = 0; i < 13; i++) {
      const ix = i * 3, iy = ix + 1, iz = ix + 2;
      const hf = OFF[ix + 1] / 2.18;                     // 0 feet .. 1 head
      let w = 1;
      if (px != null) w = Math.max(0.55, 1 - Math.abs(p[iy] - py) / (2.2 * k));
      const along = base * w * (hs ? 0.55 : (0.75 + 0.5 * hf));
      const vx = dx * along, vz = dz * along;
      let vy = dy * base * w * 0.5;
      if (hs) vy -= m * 0.05 * (1 - hf);                 // legs give → hips drop
      if (boom) vy += (m * 0.3 + Math.random() * 2) * w;  // a blast LIFTS the whole body
      else if (heavy) vy += m * 0.06 * hf * w;            // a shotgun lofts the upper body as it hurls it
      q[ix] -= vx * KICK_DT; q[iy] -= vy * KICK_DT; q[iz] -= vz * KICK_DT;
    }
    if (hs) {  // headshot: the skull whips with the round, then the head drops
      q[0] -= dx * m * 0.12 * KICK_DT; q[2] -= dz * m * 0.12 * KICK_DT;
      q[1] += m * 0.05 * KICK_DT;       // (kv is subtracted in solve → +q here = the head DROPS)
    }
  }
  // HE WAS MOVING: every point keeps the run he died in, so a man shot while
  // running carries it into the fall (the ground friction takes it off).
  function carry(s, vx, vz) {
    if (!(vx || vz)) return;
    const q = s.kv; s.kicked = true;
    for (let i = 0; i < 13; i++) { q[i * 3] -= vx * KICK_DT; q[i * 3 + 2] -= vz * KICK_DT; }
  }

  // the 13 points as the rig's own joints (see OFF for the order): head,
  // shoulders (la = point 1, on the rig's +x), hips (ll = point 3, on -x),
  // elbows, hands, knees, ankles
  const _sj = new THREE.Vector3();
  function jointAt(o, out, dy) {
    if (!o || !o.matrixWorld) return false;
    out.setFromMatrixPosition(o.matrixWorld);
    if (dy) out.y += dy;
    return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
  }
  function seedFromRig(s, ch, grp) {
    const P = ch.parts, L = ch.low || {}, S = ch.sockets || {};
    if (!P || !P.la || !P.ra || !P.ll || !P.rl) return false;
    grp.updateMatrixWorld(true);
    const ank = 0.07 * s.k / 0.7;                  // shoe origin is the sole; the point is the ankle
    const src = [ch.head, P.la, P.ra, P.ll, P.rl, L.la, L.ra, S.leftHand, S.rightHand, L.ll, L.rl,
      P.ll.userData && P.ll.userData.cap, P.rl.userData && P.rl.userData.cap];
    for (let i = 0; i < 13; i++) {
      if (!jointAt(src[i], _sj, i >= 11 ? ank : 0)) return false;
      const ix = i * 3;
      s.p[ix] = s.q[ix] = _sj.x; s.p[ix + 1] = s.q[ix + 1] = _sj.y; s.p[ix + 2] = s.q[ix + 2] = _sj.z;
    }
    return true;
  }

  function start(target, point, dir, imp, fromNet) {
    if (!allowed()) return false;
    if (!target) return false;
    if (fromNet) target.dead = true;          // the host's word is law — the rag ev beats the snapshot row
    else if (!target.dead) return false;
    const ch = charOf(target);
    if (!ch || !ch.parts || !target.group || target.inCar) return false;
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && !target.isPlayer && !fromNet) { // host gated by ITS camera already; guests trust the ev
      const gdx = target.pos.x - cam.x, gdz = target.pos.z - cam.z;
      if (gdx * gdx + gdz * gdz > RANGE2()) return false;   // far kills keep the cheap path
    }
    // already ours → re-kick and wake (shooting a settled corpse stirs it)
    let s = target._ragSlot != null ? slots[target._ragSlot] : null;
    if (s && s.ped === target) {
      kick(s, point, dir, imp);
      s.asleep = false; s.still = 0; s.life = 0;
      bumpPhys(target);
      return true;
    }
    // LRU: over the solve budget → freeze the oldest SETTLING body. Never a
    // just-seeded one: an RPG into a crowd kills 9+ in a single call stack
    // before any solve runs, and freezing those locks corpses bolt upright.
    let active = 0, oldest = null;
    const N = slots.length;
    for (let i = 0; i < N; i++) {
      const t = slots[i];
      if (t.used && !t.asleep) { active++; if (t.life > 0.5 && (!oldest || t.age < oldest.age)) oldest = t; }
    }
    if (active >= MAX_ACTIVE()) {
      if (oldest) oldest.asleep = true;
      else return false;                 // everyone's still flying: this kill keeps the legacy fling
    }
    // a free slot, else retire the stalest frozen corpse back to the stock sprawl
    s = null; let stale = null;
    for (let i = 0; i < N; i++) {
      const t = slots[i];
      if (!t.used) { s = t; break; }
      if (t.asleep && (!stale || t.age < stale.age)) stale = t;
    }
    // every slot is spoken for: reach for the ceiling ONE step at a time, and
    // only now, with a real body waiting. Recycling a frozen corpse stays the
    // fallback once the ceiling is genuinely reached.
    if (!s && slots.length < POOL_N()) { grow(slots.length + 6); s = slots[N] || null; }
    if (!s && stale) { releaseSlot(stale); s = stale; }
    if (!s) return false;

    // seed the points from the rig's CURRENT root transform — canonical joint
    // offsets through the group quaternion, so an already-toppled body works too.
    const grp = target.group;
    /* THE SKELETON IS THIS BODY'S SIZE. OFF is authored for the legacy 2.60 u
       rig, but every rig renders at humanScale (0.70): the solver was
       simulating a man 1.43x taller than the one on screen, so the drawn
       pelvis sat 0.3 m off the physical hips and the body lay on joints that
       were not its own (floating, and resolving walls it never touched). */
    const sm = CBZ.charSeatMetrics ? CBZ.charSeatMetrics(ch) : null;
    s.k = sm && sm.hipY > 0 ? sm.hipY / 0.95
      : ((grp.userData && grp.userData.humanScale) || 1);
    { const ry = grp.rotation.y || 0; s.fwx = Math.sin(ry); s.fwz = Math.cos(ry); }
    s.hk = sm && sm.hipY > 0 ? sm.hipY : 0.95 * s.k;
    /* SEED FROM THE BODY AS IT IS. The points are the rig's own joints, read
       in world space off the pose it has THIS frame (standing, mid-stride,
       or already lying in its collapse), and every bone's rest length is
       measured off them, so the skeleton has this man's proportions and
       starts exactly where the drawn body is. The canonical OFF pose is
       only the fallback for a rig missing a joint. */
    const seeded = seedFromRig(s, ch, grp);
    if (!seeded) {
      _qt.copy(grp.quaternion);
      for (let i = 0; i < 13; i++) {
        _a.set(OFF[i * 3] * s.k, OFF[i * 3 + 1] * s.k, OFF[i * 3 + 2] * s.k).applyQuaternion(_qt);
        const ix = i * 3;
        s.p[ix] = s.q[ix] = grp.position.x + _a.x;
        s.p[ix + 1] = s.q[ix + 1] = grp.position.y + _a.y;
        s.p[ix + 2] = s.q[ix + 2] = grp.position.z + _a.z;
      }
    }
    for (let c = 0; c < NS; c++) {
      const i = STICKS[c * 4] * 3, j = STICKS[c * 4 + 1] * 3;
      s.rest[c] = seeded
        ? Math.hypot(s.p[j] - s.p[i], s.p[j + 1] - s.p[i + 1], s.p[j + 2] - s.p[i + 2])
        : STICKS[c * 4 + 2] * s.k;
    }
    // a body already down in its collapse (systems/bodyfall.js) hands over
    // here: the rig's keyed lie is replaced by the points, so its model drop
    // goes, and it does not get a second dying beat on the floor
    const wasDown = !!(target._bf && target._bf.on);
    if (wasDown && CBZ.bodyFall) CBZ.bodyFall.clear(target);
    s.noBeat = wasDown;
    s.used = true; s.ped = target; s.ch = ch; s.isPlayer = !!target.isPlayer;
    s.age = ++seq; s.still = 0; s.asleep = false; s.life = 0; s.thud = false;
    s.dyt = 0;                                       // cleared so kick() arms a fresh beat
    s.cx = grp.position.x; s.cy = grp.position.y; s.cz = grp.position.z;
    target._ragSlot = s.idx;
    // strip pose extras once so our absolute writes sit on a clean rig
    const P = ch.parts;
    if (P.la) P.la.position.z = 0;
    if (P.ra) P.ra.position.z = 0;
    if (P.ll) P.ll.scale.y = 1;
    if (P.rl) P.rl.scale.y = 1;
    if (ch.low) { for (const k in ch.low) { const j = ch.low[k]; if (j) j.rotation.set(0, 0, 0); } }
    if (ch.body) { ch.body.rotation.set(0, 0, 0); ch.body.position.y = 0; }
    bumpPhys(target);
    kick(s, point, dir, imp);
    { const mv = target._mv, vel = target.vel;
      if (mv && (mv.vx || mv.vz)) carry(s, mv.vx || 0, mv.vz || 0);
      else if (vel && (vel.x || vel.z)) carry(s, vel.x || 0, vel.z || 0); }
    if (!fromNet && CBZ.netRagEmit) CBZ.netRagEmit(target, point, dir, imp);
    return true;
  }

  // ============================================================
  //  PIN — one point of the skeleton is owned by something else.
  //
  //  Run AFTER the stick relaxation and the ground clamp, so nothing gets a
  //  later say than the hold: the sticks then relax the other twelve points
  //  around a fixed anchor on the next iteration, which is exactly the whip we
  //  want. Setting q alongside p is the whole trick — leave q behind and the
  //  verlet integrator reads a huge implicit velocity at the held point and
  //  spends the next frames trying to fling the body away from the thing
  //  holding it, which looks like a physics bug rather than a grip.
  // ============================================================
  const _pinAt = { x: 0, y: 0, z: 0 };
  function applyPin(s) {
    const pin = s.pin;
    if (!pin) return;
    _pinAt.x = pin.x; _pinAt.y = pin.y; _pinAt.z = pin.z;
    if (pin.at) {
      // the anchor is another system's callback (a jaw socket that moves every
      // substep). It is not allowed to allocate and it is not allowed to take
      // the frame down with it if it throws.
      try { pin.at(_pinAt); } catch (e) { return; }
    }
    if (!(isFinite(_pinAt.x) && isFinite(_pinAt.y) && isFinite(_pinAt.z))) return;
    pin.x = _pinAt.x; pin.y = _pinAt.y; pin.z = _pinAt.z;
    const p = s.p, q = s.q, pts = pin.pts, n = pts.length;
    let mx = 0, my = 0, mz = 0;
    for (let k = 0; k < n; k++) { const i = pts[k] * 3; mx += p[i]; my += p[i + 1]; mz += p[i + 2]; }
    const inv = 1 / n;
    // translate the held point(s) as a unit: a pair keeps its own separation,
    // so pinning a torso never squeezes the shoulders together.
    const st = pin.stiff;
    const ox = (_pinAt.x - mx * inv) * st, oy = (_pinAt.y - my * inv) * st, oz = (_pinAt.z - mz * inv) * st;
    const keep = 1 - st;                       // stiff 1 = the hold is absolute
    for (let k = 0; k < n; k++) {
      const i = pts[k] * 3;
      const vx = p[i] - q[i], vy = p[i + 1] - q[i + 1], vz = p[i + 2] - q[i + 2];
      p[i] += ox; p[i + 1] += oy; p[i + 2] += oz;
      q[i] = p[i] - vx * keep; q[i + 1] = p[i + 1] - vy * keep; q[i + 2] = p[i + 2] - vz * keep;
    }
  }

  // ONE water query per body per frame — never per point, never per substep.
  // Taken 3m BELOW the pelvis on purpose: a probe at the pelvis reads "dry"
  // the moment a floating body's hips clear the surface, the body sinks, the
  // probe reads "wet" again, and the corpse oscillates at the waterline. From
  // under the surface the query always finds the column, and every per-point
  // test is a comparison against the ONE surface height it returns (exact to
  // well under a centimetre across a 2m body).
  //
  // CBZ.waterSubmergence (systems/gore.js) is the single shared water query —
  // guarded, coerced, and 0 rather than NaN when the water system is absent or
  // mid-rebuild, so a bad read degrades to the dry land path instead of
  // poisoning p[] with NaN and taking out computeBoundingSphere downstream.
  function waterProbe(s) {
    s.seaDy = 0;
    if (!buoyOn() || !CBZ.waterSubmergence) { s.wet = false; return; }
    const py = s.cy - 3;
    const d = CBZ.waterSubmergence(s.cx, py, s.cz);
    if (!(d > 0)) { s.wet = false; return; }
    const ny = py + d;
    if (s.wet) { const dy = ny - s.seaY; if (dy > -1 && dy < 1) s.seaDy = dy; }
    s.wet = true; s.seaY = ny;
  }
  // a FROZEN body still has to ride the swell. Its pose is locked, but the sea
  // it settled on keeps rolling, and a corpse pinned at a fixed Y while the
  // surface moves under it is the same tell world/water_buoyancy.js fixed for
  // boat hulls. Only a body actually at the waterline moves; one resting on
  // the seabed stays exactly where it fell.
  function bobAsleep(s) {
    const dy = s.seaDy;
    if (!dy || Math.abs(s.cy - s.seaY) > FLOAT_BAND) return;
    const p = s.p, q = s.q;
    for (let i = 1; i < 39; i += 3) { p[i] += dy; q[i] += dy; }
  }

  /* THE BODY AS IT FROZE, fitted to the world once. The points rest on
     their own radii, but the drawn body is boxes of its own thickness, and
     the extremity wall push above only knows six points: measured, a frozen
     corpse still had a shoulder box or a shoe 6-19 cm under the street and
     a hand in a wall. At the moment it sleeps (once per body, never per
     frame) we read the real posed meshes: lift it by however far its lowest
     vertex is under the floor, and slide it out of any wall by its own
     extremities (systems/bodyfall.js's resolver), by moving the POINTS, so
     the frozen pose keeps the fix. */
  const _fv = new THREE.Vector3(), _fp = { x: 0, y: 0, z: 0 };
  function restFit(s) {
    const ch = s.ch, g = s.ped && s.ped.group;
    if (!ch || !g) return;
    writePose(s);
    g.updateMatrixWorld(true);
    let low = Infinity;
    g.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      for (let q = o; q && q !== g; q = q.parent) if (q.visible === false) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { _fv.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); if (_fv.y < low) low = _fv.y; }
    });
    const floor = groundUnder(s.cx, s.cz, s.cy + 0.5);
    let dy = Number.isFinite(low) ? floor - low : 0;
    dy = dy > 0 ? Math.min(0.35, dy) : 0;
    _fp.x = g.position.x; _fp.y = g.position.y; _fp.z = g.position.z;
    if (CBZ.bodyFall && CBZ.bodyFall.unwall && CBZ.collide) {
      // twice: the first slide can bring another extremity to the wall
      CBZ.bodyFall.unwall(ch, g, _fp);
      const ox = g.position.x, oz = g.position.z;
      g.position.x = _fp.x; g.position.z = _fp.z;
      CBZ.bodyFall.unwall(ch, g, _fp);
      g.position.x = ox; g.position.z = oz;
    }
    const dx = _fp.x - g.position.x, dz = _fp.z - g.position.z;
    if (!dy && !dx && !dz) return;
    const p = s.p, q = s.q;
    for (let i = 0; i < 39; i += 3) {
      p[i] += dx; q[i] += dx; p[i + 1] += dy; q[i + 1] += dy; p[i + 2] += dz; q[i + 2] += dz;
    }
    writePose(s);
  }

  // move one point's velocity (per substep, verlet p - q) toward a target
  // in m/s on the axes given (NaN = leave that axis alone)
  function steer(p, q, i, vx, vy, vz, h, gain) {
    if (vx === vx) { const c = p[i] - q[i]; p[i] += (vx * h - c) * gain; }
    if (vy === vy) { const c = p[i + 1] - q[i + 1]; p[i + 1] += (vy * h - c) * gain; }
    if (vz === vz) { const c = p[i + 2] - q[i + 2]; p[i + 2] += (vz * h - c) * gain; }
  }

  function solve(s, dt) {
    if (dt <= 0) return;
    const p = s.p, q = s.q, sk = s.k;
    // support columns at the two body ends — points use the nearer column, so a
    // body straddling a roof edge folds over it and a stair run reads per-tread.
    const hx = p[0], hz = p[2];
    const fx = (p[33] + p[36]) * 0.5, fz = (p[35] + p[38]) * 0.5;
    const g0 = groundUnder(hx, hz, p[1] + 0.3);
    const g1 = groundUnder(fx, fz, Math.min(p[34], p[37]) + 0.3);
    const h = Math.min(dt, 0.04) * 0.5;             // two fixed substeps, dt clamped
    if (s.kicked) {                                 // bank the pending kick at the REAL substep —
      const ks = h / KICK_DT, kv = s.kv;            // same launch speed at 30fps as at 120
      for (let j = 0; j < 39; j++) { q[j] += kv[j] * ks; kv[j] = 0; }
      s.kicked = false;
    }
    // ---- DYING BEAT: the legs give out first. While dyt runs the muscles
    //      quit from the ground up: the knees drive forward over the toes and
    //      down, the hips drop under them, and the feet stay where they stood
    //      (ground friction), so the body FOLDS and its centre of mass falls
    //      nearly straight down, carried along the round by the kick, rather
    //      than a straight body hinging over its soles. A headshot folds
    //      hardest (everything stops at once). Written as velocity TARGETS,
    //      not per-frame nudges, so the frame rate cannot change how hard he
    //      goes down. It hands off to the limp fall below as it ends.
    if (s.dyt > 0) {
      s.dyt = Math.max(0, s.dyt - dt);
      const k = s.dyMax > 0 ? s.dyt / s.dyMax : 0;   // 1 at impact → 0
      const give = (s.dyHead ? 1.35 : 1.0) * (0.35 + 0.65 * k);
      const kneeF = 1.25 * sk * give, kneeD = 1.1 * sk * give, hipD = 1.9 * sk * give;
      for (let n = 0; n < 2; n++) {
        const hip = (3 + n) * 3, knee = (9 + n) * 3;
        steer(p, q, knee, s.fwx * kneeF, -kneeD, s.fwz * kneeF, h, 0.55);
        steer(p, q, hip, NaN, -hipD, NaN, h, 0.55);
      }
    }
    const gh2 = GRAV() * h * h;
    const wet = s.wet, seaTop = s.seaY;
    let maxd2 = 0;
    for (let sub = 0; sub < 2; sub++) {
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        let vx = (p[ix] - q[ix]) * 0.992, vy = (p[iy] - q[iy]) * 0.992, vz = (p[iz] - q[iz]) * 0.992;
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > 0.2025) { const k = 0.45 / Math.sqrt(sp2); vx *= k; vy *= k; vz *= k; } // anti-tunnel step cap
        if (sp2 > maxd2) maxd2 = sp2;
        q[ix] = p[ix]; q[iy] = p[iy]; q[iz] = p[iz];
        // BUOYANCY — RAMPED over the point's own thickness, never stepped. A
        // hard "below the surface → push up" test makes every point flip state
        // as it crosses the waterline and the whole corpse jitters like a cork;
        // ramping means a shoulder half out of the water gets half the lift, so
        // the body settles LOW and splayed, which is what a body in water does.
        // `wet` is false for every land kill, so this costs one branch there
        // and the land path is byte-identical.
        let g = gh2;
        if (wet) {
          const dep = seaTop - p[iy];
          if (dep > 0) {
            const k = dep < RAD[i] * s.k ? dep / (RAD[i] * s.k) : 1;
            g = gh2 * (1 + (BUOY_G - 1) * k);          // k=1 → net upward
            const dr = 1 - (1 - BUOY_DRAG) * k;        // water drag, same ramp
            vx *= dr; vy *= dr; vz *= dr;
          }
        }
        p[ix] += vx; p[iy] += vy - g; p[iz] += vz;
      }
      for (let it = 0; it < ITER; it++) {
        for (let c = 0; c < NS; c++) {
          const b = c * 4, i = STICKS[b] * 3, j = STICKS[b + 1] * 3;
          const rest = STICKS[b + 3] ? STICKS[b + 2] * 0.8 * sk : s.rest[c];
          let dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
          if (STICKS[b + 3] && d > rest) continue;   // minOnly: spacer, not a rod
          const k = (rest - d) / d * 0.5;
          dx *= k; dy *= k; dz *= k;
          p[i] -= dx; p[i + 1] -= dy; p[i + 2] -= dz;
          p[j] += dx; p[j + 1] += dy; p[j + 2] += dz;
        }
        // (The per-iteration knee/elbow ANGLE clamp that ran here is gone. It
        // had the knee's sign inverted, so it forbade a knee's natural fold
        // and allowed it to bend backward, and even with the sign right it
        // injected energy: measured in tools/bodyfall-check.mjs, one body in
        // three flipped over, its centre of mass jumping up to 1.4 m, and
        // spun past 90 degrees. The fold limits are one-sided DISTANCE
        // spacers now (hip-ankle, shoulder-hand; see LIMB FOLD below), which
        // a verlet relaxation can never pump energy into.)
      }
      // ground: clamp + friction + a whisper of bounce
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        const dh = (p[ix] - hx) * (p[ix] - hx) + (p[iz] - hz) * (p[iz] - hz);
        const df = (p[ix] - fx) * (p[ix] - fx) + (p[iz] - fz) * (p[iz] - fz);
        const fl = (dh < df ? g0 : g1) + RAD[i] * sk;
        if (p[iy] < fl) {
          const vy = p[iy] - q[iy];
          p[iy] = fl;
          q[iy] = fl + vy * 0.22;                                // restitution
          q[ix] = p[ix] - (p[ix] - q[ix]) * 0.42;                // friction
          q[iz] = p[iz] - (p[iz] - q[iz]) * 0.42;
          if (!s.thud && vy < -0.07) {                           // first hard landing smacks
            s.thud = true;
            const cm = CBZ.camera && CBZ.camera.position;
            if (cm && CBZ.sfx) {
              const tx = p[ix] - cm.x, tz = p[iz] - cm.z;
              if (tx * tx + tz * tz < 900) CBZ.sfx("hit");
            }
          }
        }
      }
      // the hold gets the LAST word of the substep — after the sticks and
      // after the ground, so nothing can drag the held point off the jaw.
      if (s.pin) applyPin(s);
    }
    // walls: extremities get the shared circle-vs-box push (height-gated)
    if (CBZ.collide) {
      for (let k = 0; k < WALLPTS.length; k++) {
        const i = WALLPTS[k] * 3;
        _c.x = p[i]; _c.y = p[i + 1]; _c.z = p[i + 2];
        CBZ.collide(_c, 0.16 * sk, p[i + 1] - 0.1, p[i + 1] + 0.1);
        p[i] = _c.x; p[i + 2] = _c.z;
      }
    }
    if (s.pin) applyPin(s);          // the wall pusher doesn't get to move the grip either
    // sleep: kinetic energy stayed low → freeze the pose where it lies. Never
    // let the body sleep mid dying-beat (a near-vertical headshot collapse moves
    // slowly but must NOT freeze upright before it folds to the ground).
    if (s.dyt <= 0 && Math.sqrt(maxd2) / h < SLEEP_V) s.still += dt; else s.still = 0;
    s.life += dt;
    // a held body never freezes — but the pin's own `until` (hard-capped at
    // PIN_MAX) is what bounds that, so a pin can never keep a body awake
    // forever. The frame the pin expires, MAX_LIFE takes it straight to sleep.
    if (!s.pin && (s.still > SLEEP_T || s.life > MAX_LIFE)) { s.asleep = true; restFit(s); }
  }

  // re-orient the EXISTING rig from the points (assign, never add — we run after
  // grapple's corpse pose at 24 and own every channel a dead rig shows).
  function writePose(s) {
    const ch = s.ch, grp = s.ped.group;
    if (!ch || !grp) return;
    const p = s.p;
    const msx = (p[3] + p[6]) * 0.5, msy = (p[4] + p[7]) * 0.5, msz = (p[5] + p[8]) * 0.5;
    const mhx = (p[9] + p[12]) * 0.5, mhy = (p[10] + p[13]) * 0.5, mhz = (p[11] + p[14]) * 0.5;
    _r.set(p[3] - p[6], p[4] - p[7], p[5] - p[8]);   // the rig's +x: la (point 1) minus ra (point 2)
    _u.set(msx - mhx, msy - mhy, msz - mhz);
    if (_u.lengthSq() < 1e-6 || _r.lengthSq() < 1e-6) return;
    _u.normalize();
    _f.crossVectors(_r, _u);
    if (_f.lengthSq() < 1e-6) return;
    _f.normalize();
    _r.crossVectors(_u, _f).normalize();
    _m.makeBasis(_r, _u, _f);
    _qt.setFromRotationMatrix(_m);
    grp.quaternion.copy(_qt);                       // syncs .rotation — grapple/busy read it fine
    const hk = s.hk;
    grp.position.set(mhx - _u.x * hk, mhy - _u.y * hk, mhz - _u.z * hk);
    s.cx = mhx; s.cy = mhy; s.cz = mhz;
    _qi.copy(_qt).invert();
    if (ch.body) { ch.body.rotation.set(0, 0, 0); ch.body.position.y = 0; }
    // the torso sits on the hips at rest: re-solve the hip socket for the
    // zeroed torso, or whatever lean translation it last carried stays in
    // (measured: the drawn shoulders sat 9 cm off the points)
    if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(ch);
    if (ch.neck) {  // neck local +y points at the head mass
      _a.set(p[0] - msx, p[1] - msy, p[2] - msz).applyQuaternion(_qi);
      const l = _a.length();
      if (l > 0.001) {
        _a.multiplyScalar(1 / l);
        ch.neck.rotation.set(Math.atan2(_a.z, _a.y), 0, Math.asin(cl1(-_a.x)));
      }
    }
    const P = ch.parts;
    // two-segment limbs: the solver already carries REAL elbow (5,6) and knee
    // (9,10) mass points — orient the upper segment shoulder→elbow / hip→knee
    // and the joint group elbow→hand / knee→foot, so a ragdolled body finally
    // shows bent joints instead of plank limbs.
    limb(P.la, p, 3, 15, 21); limb(P.ra, p, 6, 18, 24);   // shoulder → elbow → hand
    limb(P.ll, p, 9, 27, 33); limb(P.rl, p, 12, 30, 36);  // hip → knee → foot
  }
  function limb(part, p, si, mi, ei) {
    if (!part) return;
    _a.set(p[mi] - p[si], p[mi + 1] - p[si + 1], p[mi + 2] - p[si + 2]).applyQuaternion(_qi);
    let l = _a.length();
    if (l < 0.001) return;
    _a.multiplyScalar(1 / l);
    part.rotation.set(Math.atan2(-_a.z, -_a.y), 0, Math.asin(cl1(_a.x)));
    const low = part.userData && part.userData.low;
    if (!low) return;
    _b.set(p[ei] - p[mi], p[ei + 1] - p[mi + 1], p[ei + 2] - p[mi + 2]).applyQuaternion(_qi);
    l = _b.length();
    if (l < 0.001) return;
    _b.multiplyScalar(1 / l);
    _q2.setFromEuler(part.rotation).invert();     // into the upper segment's frame
    _b.applyQuaternion(_q2);
    low.rotation.set(Math.atan2(-_b.z, -_b.y), 0, Math.asin(cl1(_b.x)));
  }

  /* ---- THE STEP, public because the frame this advances by is not always
     the frame the browser drew. games/battle.html runs a sim clock the viewer
     controls (pause, quarter speed, up to eight times) and the corpses on that
     field belong to that clock — a paused battle with bodies still folding is
     a page arguing with itself. A page that owns a clock sets
     CBZ.ragdollDriven = true and calls this with its own dt; the city keeps
     the updater below and never knows this exists. */
  CBZ.ragdollStep = function (dt) {
    const live = allowed();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.used) continue;
      if (!live) { releaseSlot(s); continue; }
      const t = s.ped;
      if (!t) { releaseSlot(s); continue; }
      if (s.isPlayer) {
        if (!CBZ.player || !CBZ.player.dead) { releaseSlot(s); continue; }  // respawned
      } else if (!t.dead || t.culled || (t.group && !t.group.parent)) {
        releaseSlot(s); continue;                   // culled/picked-up → timeline owns it
      }
      // the pin's clock runs on frame time, not substep time, and a held body
      // is never allowed to be asleep (the thing holding it is still moving).
      if (s.pin) {
        s.pin.t -= dt;
        if (s.pin.t <= 0) s.pin = null;
        else { s.asleep = false; s.still = 0; }
      }
      waterProbe(s);
      if (!s.asleep) solve(s, dt);
      else if (s.wet) bobAsleep(s);
      writePose(s);
      // the death cam orbits player.pos — follow the pelvis down the stairs
      if (s.isPlayer && CBZ.player && CBZ.player.pos) CBZ.player.pos.set(s.cx, s.cy, s.cz);
    }
  };

  CBZ.onUpdate(25, function (dt) {
    if (CBZ.ragdollDriven) return;      // the page owns the clock (see above)
    CBZ.ragdollStep(dt);
  });

  /* HAND A SLOT BACK EARLY. The step releases a slot when the body leaves the
     world, which is the right default and one frame too late for a caller that
     RETIRES a corpse deliberately (battle.html sinks its oldest bodies out of
     shot, and for those seconds a frozen pose held a slot a fresh death could
     have used — and the solver would go on writing that rig's transform
     against the sink). Idempotent, and safe on a body this file never saw. */
  CBZ.ragdollDrop = function (target) {
    if (!target || target._ragSlot == null) return false;
    const s = slots[target._ragSlot];
    if (!s || !s.used || s.ped !== target) return false;
    releaseSlot(s);
    return true;
  };

  /* WHAT THE SOLVER IS ACTUALLY DOING — the same shape quadRagdollAudit
     returns, so a probe can read both skeletons the same way. */
  CBZ.ragdollAudit = function () {
    let act = 0, sleep = 0, pinned = 0;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]; if (!s.used) continue;
      if (s.asleep) sleep++; else act++;
      if (s.pin) pinned++;
    }
    return { solving: act, frozen: sleep, pinned, pool: slots.length, cap: MAX_ACTIVE(), anyMode: CBZ.CONFIG.RAGDOLL_ANY_MODE === true };
  };

  CBZ.cityRagdoll = function (target, point, dir, imp) { return start(target, point, dir, imp, false); };

  // ============================================================
  //  PUBLIC PIN API — "something else owns this point of the body now".
  //
  //  CBZ.ragdollPin(target, {point, at, until, stiff}) -> bool
  //     point : "head"|"torso"|"hips"|"la"|"ra"|"ll"|"rl"   (default "torso")
  //     at    : function(out){ out.x=..; out.y=..; out.z=..; } — called every
  //             substep, MUST NOT allocate. Omitted → the body is held exactly
  //             where it is right now (a snag, not a carry).
  //     until : seconds (default 3, hard max PIN_MAX)
  //     stiff : 0..1, 1 = the hold always wins (default 1)
  //  A target with no live slot gets one spun up through the SAME start()
  //  path as any other kill, so RANGE2 / MAX_ACTIVE / LRU still bound the
  //  solve budget — a hundred things grabbing corpses can't blow it open.
  //  Returns false rather than throwing when no body can be given.
  // ============================================================
  CBZ.ragdollPin = function (target, opts) {
    if (!target) return false;
    opts = opts || {};
    let s = target._ragSlot != null ? slots[target._ragSlot] : null;
    if (!s || !s.used || s.ped !== target) {
      // imp 1 = the smallest legal kick: spinning the body up must not add an
      // impulse the caller never asked for.
      if (!start(target, null, null, 1, false)) return false;
      s = target._ragSlot != null ? slots[target._ragSlot] : null;
      if (!s || !s.used || s.ped !== target) return false;
    }
    const pts = PIN_PTS[opts.point] || PIN_PTS.torso;
    const p = s.p;
    let mx = 0, my = 0, mz = 0;
    for (let k = 0; k < pts.length; k++) { const i = pts[k] * 3; mx += p[i]; my += p[i + 1]; mz += p[i + 2]; }
    const inv = 1 / pts.length;
    s.pin = {
      pts,
      at: typeof opts.at === "function" ? opts.at : null,
      t: Math.max(0.05, Math.min(PIN_MAX, opts.until == null ? 3 : opts.until)),
      stiff: Math.max(0, Math.min(1, opts.stiff == null ? 1 : opts.stiff)),
      x: mx * inv, y: my * inv, z: mz * inv,       // where it is held if there's no at()
    };
    s.asleep = false; s.still = 0; s.age = ++seq;  // freshen LRU: a held body is the interesting one
    return true;
  };
  CBZ.ragdollUnpin = function (target) {
    if (!target) return;
    const s = target._ragSlot != null ? slots[target._ragSlot] : null;
    if (s && s.used && s.ped === target) s.pin = null;
  };
  CBZ.ragdollPinned = function (target) {
    if (!target) return false;
    const s = target._ragSlot != null ? slots[target._ragSlot] : null;
    return !!(s && s.used && s.ped === target && s.pin);
  };

  // ============================================================
  //  WAKE-ON-HIT: a DOWNED body shouldn't lose physics. When the hitscan
  //  (or a blast / a car) strikes an already-settled corpse, this un-sleeps
  //  its verlet slot, banks the impulse so it JERKS + reacts, stamps a wound
  //  where the round landed, then lets the EXISTING solver re-sleep after the
  //  jolt (SLEEP_T) — so only the struck body wakes, briefly, never all
  //  corpses always-on. A corpse with no slot yet (died on the cheap far path)
  //  gets one spun up via start() so it becomes reactive too (start() honours
  //  RANGE2 / MAX_ACTIVE / LRU). Player corpse included: NPCs can keep
  //  shooting your body in the WASTED / spectate window and it keeps reacting.
  //
  //  Signature the HITSCAN agent calls:
  //      CBZ.cityCorpseHit(actorOrChar, point, dir, force) -> bool
  //  point/dir are {x,y,z} (world hit point + travel direction), force is the
  //  impulse magnitude (same scale as cityRagdoll's imp: ~6 pistol, ~14 shotgun,
  //  ~20+ blast). Returns true if a reactive body took the hit.
  // ============================================================
  CBZ.cityCorpseHit = function (target, point, dir, force) {
    if (!CBZ.game || CBZ.game.mode !== "city") return false;
    if (!target) return false;
    // accept an actor (has .group) or a bare char → climb back to its actor
    if (!target.group && target.actor) target = target.actor;
    if (!target.group) return false;
    if (!target.isPlayer && !target.dead) return false;   // only DOWNED bodies wake this way
    const imp = Math.max(1, force || 6);
    // a body still solving (or asleep) and already ours → re-kick + un-sleep in place
    let s = target._ragSlot != null ? slots[target._ragSlot] : null;
    if (s && s.used && s.ped === target) {
      kick(s, point, dir, imp);
      s.asleep = false; s.still = 0; s.life = 0; s.age = ++seq;   // freshen LRU so the jolt isn't instantly re-frozen
      bumpPhys(target);
      stampWound(target, point, dir);
      return true;
    }
    // a body lying in its collapse (systems/bodyfall.js) takes the round as a
    // nudge where it lies; it does not get stood back up into a new skeleton
    if (target._bf && target._bf.on && CBZ.bodyFall && imp < 14) {
      CBZ.bodyFall.poke(target, dir ? dir.x : 0, dir ? dir.z : 0, imp);
      stampWound(target, point, dir);
      return true;
    }
    // no live slot (cheap far-kill, picked-up-then-reshot, or never ragdolled) →
    // spin a reactive body up. start() re-uses an existing slot if present and
    // honours range / MAX_ACTIVE / LRU, so this stays perf-bounded.
    const ok = start(target, point, dir, imp, false);
    if (ok) stampWound(target, point, dir);
    return ok;
  };
  // accumulate a wound disc on the downed body where the round struck (wounds.js
  // is universal but gated city-only here; it self-caps the same-frame burst and
  // only draws within camera range, so this is cheap).
  const _wp = { x: 0, y: 0, z: 0 };
  function stampWound(target, point, dir) {
    if (!CBZ.bodyWound) return;
    const grp = target.group; if (!grp) return;
    if (point && point.x != null) { _wp.x = point.x; _wp.y = point.y != null ? point.y : grp.position.y + 1.0; _wp.z = point.z; }
    else { _wp.x = grp.position.x; _wp.y = grp.position.y + 1.0; _wp.z = grp.position.z; }
    let fromX = null, fromZ = null;
    if (dir && (dir.x || dir.z)) { fromX = _wp.x - dir.x; fromZ = _wp.z - dir.z; }   // shooter is back up the travel line
    try { CBZ.bodyWound(target, _wp, { fromX, fromZ }); } catch (e) {}
  }
  // guest-side entry: the net layer maps the id (accepts a resolved actor too)
  CBZ.cityRagdollNet = function (id, p, d, imp) {
    const look = CBZ.netPuppetByNid || CBZ.netPedById;
    const t = (id && typeof id === "object") ? id : (look ? look(id) : null);
    if (!t) return false;
    let pt = null, dr = null;
    if (p) { _np.x = p[0] != null ? p[0] : (p.x || 0); _np.y = p[1] != null ? p[1] : (p.y || 0); _np.z = p[2] != null ? p[2] : (p.z || 0); pt = _np; }
    if (d) { _nd.x = d[0] != null ? d[0] : (d.x || 0); _nd.y = d[1] != null ? d[1] : (d.y || 0); _nd.z = d[2] != null ? d[2] : (d.z || 0); dr = _nd; }
    return start(t, pt, dr, imp || 6, true);
  };
})();
