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
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const MAX_ACTIVE = 14;      // bodies actually solving (LRU early-freeze past this) —
                              // sized for a sprint/burst through the 1000-strong street
  const POOL = 36;            // total slots incl. frozen corpses still holding pose
  const RANGE2 = 60 * 60;     // only kills this close to the camera get the flop
  const SLEEP_V = 0.22;       // u/s — under this the body counts as still
  const SLEEP_T = 0.6;        // s of stillness before the pose freezes
  const MAX_LIFE = 7;         // hard cap on solve time (safety)
  const ITER = 3;             // constraint relaxation passes per substep
  const KICK_DT = 1 / 120, VK = 0.52;   // velocities live per-SUBSTEP (two substeps/frame)
  function GRAV() { return (CBZ.TUNE && CBZ.TUNE.gravity) || 22; }

  // 13 points, rig-local rest offsets (character.js joint positions)
  const OFF = [
    0, 2.18, 0,                          // 0 head
    -0.62, 1.84, 0, 0.62, 1.84, 0,       // 1,2 shoulders
    -0.23, 0.95, 0, 0.23, 0.95, 0,       // 3,4 hips
    -0.62, 1.375, 0, 0.62, 1.375, 0,     // 5,6 elbows
    -0.62, 0.91, 0, 0.62, 0.91, 0,       // 7,8 hands
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
  stick(1, 2); stick(3, 4); stick(1, 3); stick(2, 4); stick(1, 4); stick(2, 3); // rigid torso quad + braces
  stick(0, 1); stick(0, 2); stick(0, 3, 1); stick(0, 4, 1);                     // head hung off both shoulders
  stick(1, 5); stick(5, 7); stick(2, 6); stick(6, 8);                           // arms
  stick(3, 9); stick(9, 11); stick(4, 10); stick(10, 12);                       // legs
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
    };
  }
  const slots = [];
  for (let i = 0; i < POOL; i++) slots.push(makeSlot(i));
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

  // distribute the impulse over the points with falloff from the hit, a topple
  // bias toward the high points, headshot head-kick, explosive lift past imp 20.
  //
  // REALISM (research: GTA Euphoria, procedural hit-reaction systems): a body
  // doesn't slide as a rigid plank along the bullet — it TOPPLES. So the high
  // mass (head/shoulders) gets far more horizontal push than the planted feet,
  // and the feet get a small COUNTER push back toward the shooter: the pair is
  // a couple that pitches the body over AWAY from the gun (forward if shot in
  // the back, backward if shot in the chest, sideways for a flank). A headshot
  // takes the legs out from under and the body drops nearly straight down. A
  // shotgun/blast (imp >= ~14) overpowers the topple and HURLS the whole body.
  function kick(s, point, dir, imp) {
    const p = s.p, q = s.kv; s.kicked = true; // velocities park in kv; solve() converts at its real substep
    let dx = dir ? (dir.x || 0) : 0, dy = dir ? (dir.y || 0) : 0, dz = dir ? (dir.z || 0) : 0;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 0.001) { const a = Math.random() * 6.28; dx = Math.cos(a); dz = Math.sin(a); dy = 0; }
    else { dx /= dl; dy /= dl; dz /= dl; }
    const m = Math.max(1, Math.min(34, imp || 6));
    const boom = m >= 20;          // explosion / RPG: lift the whole body
    const heavy = m >= 14;         // point-blank shotgun / car: a real launch, topple gives way to fling
    const px = point ? point.x : null, py = point ? point.y : 0, pz = point ? point.z : 0;
    const hs = px != null &&
      ((px - p[0]) * (px - p[0]) + (py - p[1]) * (py - p[1]) + (pz - p[2]) * (pz - p[2])) < 0.36;
    // arm the DYING BEAT (solve() reads it): the heavier the hit the shorter
    // the on-his-feet stumble before he's fully limp — a blast gives no stumble
    // at all (the body is already airborne), a pistol gives the full lurch.
    if (s.dyt <= 0 && !boom) {
      s.dyMax = s.dyt = Math.max(0.12, Math.min(0.34, 0.34 - (m - 1) * 0.012));
      s.dyx = dx; s.dyz = dz; s.dyForce = m / 6; s.dyHead = hs;
    }
    for (let i = 0; i < 13; i++) {
      const ix = i * 3, iy = ix + 1, iz = ix + 2;
      // distance falloff from the wound (close points take the round hardest)
      let w = 0.75;
      if (px != null) {
        const d = Math.sqrt((p[ix] - px) * (p[ix] - px) + (p[iy] - py) * (p[iy] - py) + (p[iz] - pz) * (p[iz] - pz));
        w = Math.max(0.3, 1 - d / 2.4);
      }
      // height factor 0 (feet) .. 1 (head). TOPPLE COUPLE: high points pushed
      // hard along the round, low points get a small kick BACK toward the gun.
      const hf = OFF[ix + 1] / 2.18;
      // a headshot buckles the legs — almost no horizontal couple, the body
      // folds and drops; a body shot topples about the feet.
      const toppleHi = hs ? (0.35 + 0.25 * hf) : (0.45 + 1.15 * hf);
      const toppleLo = hs ? 0 : (1 - hf) * 0.45;          // counter-kick at the legs
      const along = m * VK * w * (toppleHi - toppleLo);
      let vx = dx * along, vz = dz * along;
      // vertical: a tiny upward toss off a body shot (rounds carry up the torso),
      // legs sag for a headshot collapse. dy from the caller adds an aimed lift.
      let vy = (dy * m * VK + m * 0.04 * hf) * w;
      if (hs) vy -= m * 0.10 * (1 - hf) * w;              // legs give → hips drop
      if (boom) vy += (m * 0.3 + Math.random() * 2) * w;  // a blast LIFTS the whole body
      else if (heavy) vy += m * 0.10 * hf * w;            // a shotgun lofts the upper body as it hurls it
      vx += (Math.random() - 0.5) * m * 0.06;
      vz += (Math.random() - 0.5) * m * 0.06;
      q[ix] -= vx * KICK_DT; q[iy] -= vy * KICK_DT; q[iz] -= vz * KICK_DT;
    }
    if (hs) {  // headshot: the skull whips with the round, snaps back, head dumps down
      q[0] -= dx * m * 0.34 * KICK_DT; q[2] -= dz * m * 0.34 * KICK_DT;
      q[1] += m * 0.10 * KICK_DT;       // (kv is subtracted in solve → +q here = the head DROPS)
    }
  }

  function start(target, point, dir, imp, fromNet) {
    if (!CBZ.game || CBZ.game.mode !== "city") return false;
    if (!target) return false;
    if (fromNet) target.dead = true;          // the host's word is law — the rag ev beats the snapshot row
    else if (!target.dead) return false;
    const ch = charOf(target);
    if (!ch || !ch.parts || !target.group || target.inCar) return false;
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && !target.isPlayer && !fromNet) { // host gated by ITS camera already; guests trust the ev
      const gdx = target.pos.x - cam.x, gdz = target.pos.z - cam.z;
      if (gdx * gdx + gdz * gdz > RANGE2) return false;   // far kills keep the cheap path
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
    for (let i = 0; i < POOL; i++) {
      const t = slots[i];
      if (t.used && !t.asleep) { active++; if (t.life > 0.5 && (!oldest || t.age < oldest.age)) oldest = t; }
    }
    if (active >= MAX_ACTIVE) {
      if (oldest) oldest.asleep = true;
      else return false;                 // everyone's still flying: this kill keeps the legacy fling
    }
    // a free slot, else retire the stalest frozen corpse back to the stock sprawl
    s = null; let stale = null;
    for (let i = 0; i < POOL; i++) {
      const t = slots[i];
      if (!t.used) { s = t; break; }
      if (t.asleep && (!stale || t.age < stale.age)) stale = t;
    }
    if (!s && stale) { releaseSlot(stale); s = stale; }
    if (!s) return false;

    // seed the points from the rig's CURRENT root transform — canonical joint
    // offsets through the group quaternion, so an already-toppled body works too.
    const grp = target.group;
    _qt.copy(grp.quaternion);
    for (let i = 0; i < 13; i++) {
      _a.set(OFF[i * 3], OFF[i * 3 + 1], OFF[i * 3 + 2]).applyQuaternion(_qt);
      const ix = i * 3;
      s.p[ix] = s.q[ix] = grp.position.x + _a.x;
      s.p[ix + 1] = s.q[ix + 1] = grp.position.y + _a.y;
      s.p[ix + 2] = s.q[ix + 2] = grp.position.z + _a.z;
    }
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
    if (!fromNet && CBZ.netRagEmit) CBZ.netRagEmit(target, point, dir, imp);
    return true;
  }

  function solve(s, dt) {
    if (dt <= 0) return;
    const p = s.p, q = s.q;
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
    // ---- DYING BEAT: a brief active stumble before full limp. While dyt runs
    //      the body still "fights" gravity a little — the knees BUCKLE (feet
    //      drift in under the hips, the hip line sags) and the whole frame
    //      lurches a step in the bullet's travel direction — so the death reads
    //      as absorbing the round and stumbling, not snapping flat. It eases out
    //      to nothing, handing off seamlessly to the limp verlet fall below.
    if (s.dyt > 0) {
      s.dyt = Math.max(0, s.dyt - dt);
      const k = s.dyMax > 0 ? s.dyt / s.dyMax : 0;   // 1 at impact → 0
      const step = h * s.dyForce;
      // lurch the upper body a stagger-step along the force (sets velocity by
      // moving p ahead of q): strongest at impact, fades as he goes limp.
      const drive = (s.dyHead ? 0.45 : 1.0) * k * step * 1.4;
      // shoulders + head carry the stumble; hips follow a touch
      const PUSH = [0, 1, 2, 3, 4];                   // head, shoulders, hips
      for (let n = 0; n < PUSH.length; n++) {
        const ix = PUSH[n] * 3;
        const wgt = ix < 9 ? 1 : 0.5;                 // head/shoulders > hips
        p[ix] += s.dyx * drive * wgt;
        p[ix + 2] += s.dyz * drive * wgt;
      }
      // KNEES BUCKLE: collapse the legs so the body sinks instead of staying
      // planted — feet ease in toward under the hips, knees fold, hip line dips.
      const buckle = (s.dyHead ? 1.3 : 0.8) * k;
      for (let n = 0; n < 2; n++) {
        const hip = (3 + n) * 3, knee = (9 + n) * 3, foot = (11 + n) * 3;
        // drag the feet horizontally toward the hips (knees give out)
        p[foot] += (p[hip] - p[foot]) * 0.10 * buckle;
        p[foot + 2] += (p[hip + 2] - p[foot + 2]) * 0.10 * buckle;
        // sag the knee + hip down a hair so the stance collapses
        p[knee + 1] -= 0.012 * buckle;
        p[hip + 1] -= 0.010 * buckle;
      }
    }
    const gh2 = GRAV() * h * h;
    let maxd2 = 0;
    for (let sub = 0; sub < 2; sub++) {
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        let vx = (p[ix] - q[ix]) * 0.992, vy = (p[iy] - q[iy]) * 0.992, vz = (p[iz] - q[iz]) * 0.992;
        const sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > 0.2025) { const k = 0.45 / Math.sqrt(sp2); vx *= k; vy *= k; vz *= k; } // anti-tunnel step cap
        if (sp2 > maxd2) maxd2 = sp2;
        q[ix] = p[ix]; q[iy] = p[iy]; q[iz] = p[iz];
        p[ix] += vx; p[iy] += vy - gh2; p[iz] += vz;
      }
      for (let it = 0; it < ITER; it++) {
        for (let c = 0; c < NS; c++) {
          const b = c * 4, i = STICKS[b] * 3, j = STICKS[b + 1] * 3;
          const rest = STICKS[b + 3] ? STICKS[b + 2] * 0.8 : STICKS[b + 2];
          let dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
          if (STICKS[b + 3] && d > rest) continue;   // minOnly: spacer, not a rod
          const k = (rest - d) / d * 0.5;
          dx *= k; dy *= k; dz *= k;
          p[i] -= dx; p[i + 1] -= dy; p[i + 2] -= dz;
          p[j] += dx; p[j + 1] += dy; p[j + 2] += dz;
        }
      }
      // ground: clamp + friction + a whisper of bounce
      for (let i = 0; i < 13; i++) {
        const ix = i * 3, iy = ix + 1, iz = ix + 2;
        const dh = (p[ix] - hx) * (p[ix] - hx) + (p[iz] - hz) * (p[iz] - hz);
        const df = (p[ix] - fx) * (p[ix] - fx) + (p[iz] - fz) * (p[iz] - fz);
        const fl = (dh < df ? g0 : g1) + RAD[i];
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
    }
    // walls: extremities get the shared circle-vs-box push (height-gated)
    if (CBZ.collide) {
      for (let k = 0; k < WALLPTS.length; k++) {
        const i = WALLPTS[k] * 3;
        _c.x = p[i]; _c.y = p[i + 1]; _c.z = p[i + 2];
        CBZ.collide(_c, 0.16, p[i + 1] - 0.1, p[i + 1] + 0.1);
        p[i] = _c.x; p[i + 2] = _c.z;
      }
    }
    // sleep: kinetic energy stayed low → freeze the pose where it lies. Never
    // let the body sleep mid dying-beat (a near-vertical headshot collapse moves
    // slowly but must NOT freeze upright before it folds to the ground).
    if (s.dyt <= 0 && Math.sqrt(maxd2) / h < SLEEP_V) s.still += dt; else s.still = 0;
    s.life += dt;
    if (s.still > SLEEP_T || s.life > MAX_LIFE) s.asleep = true;
  }

  // re-orient the EXISTING rig from the points (assign, never add — we run after
  // grapple's corpse pose at 24 and own every channel a dead rig shows).
  function writePose(s) {
    const ch = s.ch, grp = s.ped.group;
    if (!ch || !grp) return;
    const p = s.p;
    const msx = (p[3] + p[6]) * 0.5, msy = (p[4] + p[7]) * 0.5, msz = (p[5] + p[8]) * 0.5;
    const mhx = (p[9] + p[12]) * 0.5, mhy = (p[10] + p[13]) * 0.5, mhz = (p[11] + p[14]) * 0.5;
    _r.set(p[6] - p[3], p[7] - p[4], p[8] - p[5]);
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
    grp.position.set(mhx - _u.x * 0.95, mhy - _u.y * 0.95, mhz - _u.z * 0.95);
    s.cx = mhx; s.cy = mhy; s.cz = mhz;
    _qi.copy(_qt).invert();
    if (ch.body) { ch.body.rotation.set(0, 0, 0); ch.body.position.y = 0; }
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

  CBZ.onUpdate(25, function (dt) {
    const city = CBZ.game && CBZ.game.mode === "city";
    for (let i = 0; i < POOL; i++) {
      const s = slots[i];
      if (!s.used) continue;
      if (!city) { releaseSlot(s); continue; }
      const t = s.ped;
      if (!t) { releaseSlot(s); continue; }
      if (s.isPlayer) {
        if (!CBZ.player || !CBZ.player.dead) { releaseSlot(s); continue; }  // respawned
      } else if (!t.dead || t.culled || (t.group && !t.group.parent)) {
        releaseSlot(s); continue;                   // culled/picked-up → timeline owns it
      }
      if (!s.asleep) solve(s, dt);
      writePose(s);
      // the death cam orbits player.pos — follow the pelvis down the stairs
      if (s.isPlayer && CBZ.player && CBZ.player.pos) CBZ.player.pos.set(s.cx, s.cy, s.cz);
    }
  });

  CBZ.cityRagdoll = function (target, point, dir, imp) { return start(target, point, dir, imp, false); };

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
