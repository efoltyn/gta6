/* ============================================================
   systems/grapple.js — PHYSICAL INTERACTION + body physics (SURVIVAL).

   The disaster mode's whole interaction set is physical and real:
     • PUNCH  (LMB)        — a strike that staggers / knocks back; can
                             knock someone off high ground or into a hazard.
     • PUSH   (RMB)        — a hard two-handed shove.
     • GRAB   (hold E)     — grab the nearest person in front and hold them;
                             carry them (drag them out of a flood / off a
                             collapsing spot = SAVE them), then…
     • THROW  (LMB while holding) — launch them (into the lava / off the
                             cliff = KILL them), or
     • RELEASE(let go of E) — set them down safely.

   It also owns the BODY PHYSICS that make every impact look real — for
   bots AND the player: directional knockback that slides + decays, a
   ragdoll TUMBLE when thrown or flung by a blast, and a directional
   KNOCKDOWN (you fall in the direction you were hit, then get back up).
   Disasters call CBZ.body.fling() so the dead go flying believably.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const damp = CBZ.damp || function (c, t, r, dt) { return c + (t - c) * (1 - Math.exp(-r * dt)); };
  // "Exploding ragdoll" fix: the limb springs are integrated with explicit
  // Euler, which DIVERGES on clamped heavy frames (dt→0.10s under disaster
  // load) — angles blow past ±π and the body reads as limbs detaching. The
  // flag enables substepped integration + hard joint stops + impulse caps.
  // false restores the raw integrator byte-for-byte.
  if (CBZ.CONFIG.SURV_RAGDOLL_STABLE == null) CBZ.CONFIG.SURV_RAGDOLL_STABLE = true;
  // THROWN BODIES STAY IN ONE PIECE (owner report, round 2 — the substep/
  // joint-stop pass above was the wrong lever for the THROW path). Root
  // cause: while a body is grapple-OWNED (thrown/airborne, carried, downed)
  // animChar is SKIPPED for it — but writeRag layers the limb springs
  // ADDITIVELY (`rotation.x += ...`), a design that assumes animChar just
  // rewrote an absolute base pose this frame. With no base rewrite the
  // additions ACCUMULATE frame over frame: limbs wind up like propellers
  // ("mangled while flying"), then snap back the instant the get-up hands
  // the rig back to animChar ("just come back together"). Clamping the
  // spring STATE (the stable-ragdoll pass) never bounded the accumulated
  // WRITE. The fix is constructive, not tuned: a LIVE body in ballistic
  // flight gets a rigid seeded BRACE pose written ABSOLUTELY every frame —
  // one articulated piece, tumbling only via the whole-group spin (hard
  // attachment beats spring tuning); a carried body gets a HANG pose; and
  // only LANDING unlocks the loose limb ragdoll (kicked by the impact,
  // written absolutely so it can never wind up either). Death paths
  // (deathPose + gore/dismemberment) are untouched. false = old behaviour.
  if (CBZ.CONFIG.SURV_THROW_INTACT == null) CBZ.CONFIG.SURV_THROW_INTACT = true;
  const intactOn = () => CBZ.CONFIG.SURV_THROW_INTACT !== false;

  const REACH = 3.1;          // arm's length for push / grab / punch
  const CONE = 0.25;          // forward-cone dot threshold for aiming
  const THROW_FWD = 13, THROW_UP = 7.5;
  const PUSH_FORCE = 12, PUNCH_FORCE = 6;
  const BOT_R = 0.5;
  const _corpseC = { x: 0, z: 0 };   // scratch for the corpse-extent wall push
  function G() { return (CBZ.TUNE && CBZ.TUNE.gravity) || 22; }
  function floorAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }

  // ---- per-actor physical state (lazily attached). For the player adapter
  //      (a.isPlayer) the state lives on CBZ.player so physics.js can read it.
  function owner(a) { return a && a.isPlayer ? CBZ.player : a; }
  function phys(a) {
    const o = owner(a);
    return o._phys || (o._phys = {
      kx: 0, kz: 0,           // knockback velocity (decays)
      fl: 0, fdx: 0, fdz: 0,  // flinch timer + world hit direction
      air: false, vx: 0, vy: 0, vz: 0, spin: 0,  // thrown/flung tumble
      spinZ: 0,               // secondary tumble axis (euphoria windmill)
      down: 0, ddir: 0,       // knockdown timer + facing while down
      settle: 0,              // 0..1 how "asleep"/settled a downed body is
      shock: 0,               // 0..1 euphoria reaction energy (limb chaos), decays
      bounce: 0,              // remembers a landing impact for the next bounce
      rag: null,              // lazily-built per-limb ragdoll (angle + ang.vel)
      heldBy: null,
      flash: 0, flashSaved: -1, flashEi: 1,   // head-impact emissive pop
    });
  }
  function busy(a) {
    const p = a._phys; if (!p) return false;
    if (p.air || p.down > 0 || p.heldBy) return true;
    // CITY get-up window: a knocked-down body whose timer just expired is still
    // pitched toward flat for a few frames while it stands. Keep it "busy" so
    // city/peds.js move() doesn't reclaim it and pin pos.y to the bare floor
    // (which sinks the half-flat rig). Dead bodies are skipped by move() upstream,
    // so this only matters for the living get-up. Survival/escape: no a.group flat
    // pitch is left on standing bots, so this never trips outside city.
    if (CBZ.game && CBZ.game.mode === "city" && a.group && Math.abs(a.group.rotation.x) > 0.04) return true;
    return false;
  }

  // ---- EUPHORIA-LITE LIMB RAGDOLL ---------------------------------------
  //   Real euphoria runs an active rig: limbs have their own momentum, flail
  //   when launched, windmill mid-air, then go slack and settle. We can't
  //   afford rigid-body joints on a phone, so each limb is a single damped
  //   spring-point: an angle driven by an angular velocity, kicked by the
  //   body's linear/spin velocity (Verlet-ish, believability over accuracy —
  //   Jakobsen). Light hits barely stir it; a shotgun/blast slams every limb.
  //   `rest` is the limp pose the limb wants when energy bleeds off.
  const LIMB_DEFS = [
    // key   restX  restZ  driveZ (how the limb couples to sideways body vel)
    ["la", -0.55, 1.25, 1.0],   // left arm flung out/overhead
    ["ra", -0.45, -1.30, -1.0], // right arm
    ["ll", 0.30, 0.42, 0.6],    // left leg splayed
    ["rl", -0.10, -0.46, -0.6], // right leg
  ];
  function ensureRag(p) {
    if (p.rag) return p.rag;
    const r = { body: { rx: 0, rz: 0, vx: 0, vz: 0 }, neck: { rx: 0, rz: 0, vx: 0, vz: 0 } };
    for (const d of LIMB_DEFS) r[d[0]] = { rx: 0, rz: 0, vx: 0, vz: 0 };
    return (p.rag = r);
  }
  // kick the limb rig with a burst of energy (force-scaled). `lift` adds the
  // overhead windmill for a launch; `seed` desyncs each limb per corpse.
  function kickRag(a, p, energy, lift, seed) {
    const r = ensureRag(p); const s = seed || a._deathSeed || 0;
    const jit = (k) => Math.sin(s * k + energy * 1.7);
    r.body.vx += (-0.6 - 0.7 * lift) * energy + 0.3 * jit(1.3) * energy;
    r.body.vz += 0.5 * jit(2.1) * energy;
    r.neck.vx += (0.8 + 0.6 * lift) * energy + 0.4 * jit(1.9) * energy;  // head snaps back
    r.neck.vz += 0.6 * jit(2.7) * energy;
    let i = 3;
    for (const d of LIMB_DEFS) {
      const L = r[d[0]];
      L.vx += (-1.3 * lift - 0.4 + 0.9 * jit(i + 0.5)) * energy;   // fling up on launch
      L.vz += (d[2] * (0.8 + 0.9 * lift) + 0.7 * jit(i)) * energy; // splay sideways
      i += 1.3;
    }
    // several same-frame kicks (wave + blast + debris) used to stack unbounded
    // spring energy — the first beat of the limbs-detach blowup. Cap it.
    if (CBZ.CONFIG.SURV_RAGDOLL_STABLE !== false) {
      for (const k in r) {
        const L = r[k];
        if (L.vx > 16) L.vx = 16; else if (L.vx < -16) L.vx = -16;
        if (L.vz > 16) L.vz = 16; else if (L.vz < -16) L.vz = -16;
      }
    }
  }
  // integrate the limb rig (advance the spring state only — no rig writes).
  // Each limb is a damped spring toward `rest` plus its own velocity; when the
  // body is moving/spinning the limbs lag and trail (the flail). Called at the
  // integration pass (order 24). `slack` 0..1 scales how far it can swing.
  function integRag(a, p, dt) {
    const r = p.rag; if (!r) return;
    const s = a._deathSeed || 0;
    const settle = p.air ? 0 : (p.settle || 0);            // settled bodies stop flailing
    const slack = Math.max(0, 1 - settle * 0.85);
    // A ragdolling body (air / down / dead) springs toward the SPLAYED rest
    // pose (the limp sprawl). An UPRIGHT living ped that just took a hit must
    // spring back toward NEUTRAL (0) and recover its stance — same limb rig,
    // different attractor, so one hit ped flails then stands while a corpse
    // settles into the heap. `rdoll` 0..1 blends between the two.
    const rdoll = (p.air || p.down > 0 || a.dead) ? 1 : 0;
    // spring rates: loose & wobbly while energetic, firm as it settles; an
    // upright recovering ped springs back briskly so it doesn't look broken.
    const kSpring = 14 + settle * 24 + (1 - rdoll) * 6;
    const kDamp = p.air ? 2.2 : (4 + settle * 10);
    // STABILITY (the exploding-ragdoll fix): explicit Euler on this spring is
    // only conditionally stable — on a clamped heavy frame (dt = 0.10s: a
    // disaster + 100 actors, or a throttled tab) kSpring·dt and kDamp·dt
    // overshoot, the update flips sign each step and DIVERGES: limb angles
    // scream past ±π within frames and the rig looks dismembered. Substep to
    // ≤1/30s (unconditionally stable at these gains), then hard-stop every
    // joint at a physical range (±2.8 rad — a full dramatic sprawl still fits,
    // a propeller doesn't) and kill velocity into the stop so the bound never
    // adds energy. At 60fps nSub=1 and the flail is unchanged — the comedy
    // stays, the dismemberment goes. SURV_RAGDOLL_STABLE=false → old math.
    const stable = CBZ.CONFIG.SURV_RAGDOLL_STABLE !== false;
    const nSub = stable ? Math.max(1, Math.ceil(dt / 0.033)) : 1;
    const h = dt / nSub;
    function integ(node, restX, restZ) {
      const tx = restX * rdoll, tz = restZ * rdoll;        // neutral when upright
      for (let k = 0; k < nSub; k++) {
        node.vx += (tx * slack - node.rx) * kSpring * h - node.vx * kDamp * h;
        node.vz += (tz * slack - node.rz) * kSpring * h - node.vz * kDamp * h;
        node.rx += node.vx * h; node.rz += node.vz * h;
      }
      if (!stable) return;
      if (node.vx > 24) node.vx = 24; else if (node.vx < -24) node.vx = -24;
      if (node.vz > 24) node.vz = 24; else if (node.vz < -24) node.vz = -24;
      if (node.rx > 2.8) { node.rx = 2.8; if (node.vx > 0) node.vx = 0; }
      else if (node.rx < -2.8) { node.rx = -2.8; if (node.vx < 0) node.vx = 0; }
      if (node.rz > 2.8) { node.rz = 2.8; if (node.vz > 0) node.vz = 0; }
      else if (node.rz < -2.8) { node.rz = -2.8; if (node.vz < 0) node.vz = 0; }
    }
    integ(r.body, 0.10 * Math.sin(s * 1.9), 0.08 * Math.sin(s * 2.5));
    integ(r.neck, -0.4 - 0.2 * Math.sin(s), 0.28 * Math.sin(s * 2.2));
    for (const d of LIMB_DEFS) integ(r[d[0]], d[1], d[2]);
    if (p.shock > 0) p.shock = Math.max(0, p.shock - dt * 1.6);
  }
  // write the integrated rig onto the character. Two modes:
  //   additive (default) — ADD to whatever animChar/deathPose already set
  //     this frame (the upright late pass + dead bodies, whose deathPose
  //     rewrites an absolute base each frame, so the layering is bounded).
  //   abs — ASSIGN the spring state as the whole pose. For LIVE owned
  //     bodies (downed/landed) animChar is skipped, so an additive write
  //     would accumulate frame over frame with no base to layer on (the
  //     propeller-limbs bug, see SURV_THROW_INTACT above); assignment keeps
  //     the pose exactly the bounded spring state.
  // Split from integRag so it can run in a LATE pass for upright bodies —
  // animChar (orders 30-46) writes the limbs after our order-24 step, so a
  // fresh-hit walking ped must have its flail re-applied afterwards (same
  // trick reactions.js uses).
  function writeRag(a, p, abs) {
    const ch = a.char; if (!ch || !ch.parts) return;
    const r = p.rag; if (!r) return;
    const s = a._deathSeed || 0;
    const lin = p.air ? Math.hypot(p.vx, p.vz, p.vy) : Math.hypot(p.kx, p.kz);
    const energy = Math.min(2.4, p.shock + lin * 0.06 + (Math.abs(p.spin) + Math.abs(p.spinZ)) * 0.05);
    const tr = energy * 0.12;                               // fresh flails tremble
    if (ch.body) {
      if (abs) { ch.body.rotation.x = r.body.rx; ch.body.rotation.y = 0; ch.body.rotation.z = r.body.rz; }
      else { ch.body.rotation.x += r.body.rx; ch.body.rotation.z += r.body.rz; }
    }
    if (ch.neck) {
      if (abs) { ch.neck.rotation.x = r.neck.rx; ch.neck.rotation.y = 0; ch.neck.rotation.z = r.neck.rz; }
      else { ch.neck.rotation.x += r.neck.rx; ch.neck.rotation.z += r.neck.rz; }
    }
    let i = 0;
    for (const d of LIMB_DEFS) {
      const part = ch.parts[d[0]]; if (!part) continue;
      const node = r[d[0]];
      if (abs) { part.rotation.x = node.rx + tr * Math.sin(s * 3 + i); part.rotation.y = 0; part.rotation.z = node.rz; }
      else { part.rotation.x += node.rx + tr * Math.sin(s * 3 + i); part.rotation.z += node.rz; }
      i++;
    }
  }
  // ---- POSE-LOCK poses (SURV_THROW_INTACT): rigid, seeded, written as
  //      ABSOLUTE assignments every owned frame so nothing can accumulate.
  //      The body reads as one held-together piece; all the drama comes from
  //      the whole-group tumble (air) or the carry (held). ----
  function bracePose(a) {
    const ch = a.char; if (!ch || !ch.parts) return;
    const s = a._deathSeed || 0, j = (k) => Math.sin(s * k);
    if (ch.body) ch.body.rotation.set(0.16 + 0.06 * j(1.3), 0, 0.05 * j(2.1));   // slight curl
    if (ch.neck) ch.neck.rotation.set(-0.18 + 0.05 * j(1.9), 0, 0.06 * j(2.7));  // chin tucked
    const P = ch.parts;
    if (P.la) P.la.rotation.set(-0.55 + 0.1 * j(3.1), 0, 0.42 + 0.08 * j(1.7));  // arms braced out
    if (P.ra) P.ra.rotation.set(-0.40 + 0.1 * j(2.3), 0, -0.45 - 0.08 * j(1.2));
    if (P.ll) P.ll.rotation.set(0.32 + 0.08 * j(2.9), 0, 0.12);                  // legs a light scissor
    if (P.rl) P.rl.rotation.set(-0.12 + 0.08 * j(3.7), 0, -0.12);
  }
  function hangPose(a) {
    const ch = a.char; if (!ch || !ch.parts) return;
    const s = a._deathSeed || 0, j = (k) => Math.sin(s * k);
    if (ch.body) ch.body.rotation.set(0.08, 0, 0.03 * j(2.1));
    if (ch.neck) ch.neck.rotation.set(-0.1, 0, 0.04 * j(2.7));
    const P = ch.parts;
    if (P.la) P.la.rotation.set(-0.2, 0, 0.3);       // arms dangling slightly out
    if (P.ra) P.ra.rotation.set(-0.16, 0, -0.3);
    if (P.ll) P.ll.rotation.set(0.14 + 0.05 * j(2.9), 0, 0.08);  // legs hanging
    if (P.rl) P.rl.rotation.set(-0.06, 0, -0.08);
  }
  // convenience for the owned (air/down) path: integrate AND write in one go,
  // since no animChar competes for the rig on a frame we own the actor.
  function applyRag(a, p, dt) { integRag(a, p, dt); writeRag(a, p); }

  // ---- HIT FLASH: pop the head material emissive on every body hit so a
  //      punch / shot / car / blast reads as a real impact (the same juice the
  //      prison gets from reactions.js, here for survival bots + city peds/cops).
  //      Per-rig material (character.js builds its own), so it never bleeds. ----
  const FLASH_DUR = 0.22, FLASH_EI = 1.7, FLASH_HEX = 0xff6644;
  function flashHead(a) {
    const o = owner(a), p = phys(o);
    p.flash = FLASH_DUR;
    const m = o.char && o.char.head && o.char.head.material;
    if (m && m.emissive) {
      if (p.flashSaved < 0) { p.flashSaved = m.emissive.getHex(); p.flashEi = m.emissiveIntensity; }
      m.emissive.setHex(FLASH_HEX); m.emissiveIntensity = FLASH_EI;
    }
  }
  function fadeFlash(a, p) {
    const o = owner(a);
    const m = o.char && o.char.head && o.char.head.material;
    if (!m || !m.emissive) { p.flash = 0; p.flashSaved = -1; return; }
    const t = p.flash / FLASH_DUR;                 // 1 → 0
    if (t <= 0) {
      if (p.flashSaved >= 0) { m.emissive.setHex(p.flashSaved); m.emissiveIntensity = p.flashEi; }
      p.flashSaved = -1;
    } else {
      const baseEi = p.flashSaved >= 0 ? p.flashEi : 1;
      m.emissiveIntensity = baseEi + (FLASH_EI - baseEi) * t;
      if (p.flashSaved >= 0) {
        const rest = p.flashSaved;
        const fr = (FLASH_HEX >> 16) & 255, fg = (FLASH_HEX >> 8) & 255, fb = FLASH_HEX & 255;
        const rr = (rest >> 16) & 255, rg = (rest >> 8) & 255, rb = rest & 255;
        m.emissive.setRGB((rr + (fr - rr) * t) / 255, (rg + (fg - rg) * t) / 255, (rb + (fb - rb) * t) / 255);
      }
    }
  }

  // universal hit: knockback + flinch, optionally a knockdown or an
  // airborne fling (a blast). dir is world (toward where they get pushed).
  // Reactions SCALE with force (euphoria: snipers/shotguns/blasts make
  // exaggerated high-shock reactions; small arms just stumble/spin little):
  //   light   (f<6)   → flinch + a little knockback slide
  //   medium  (6..12) → stagger, chance to stumble down (limbs flail)
  //   heavy   (>12)   → full launch / hard knockdown with violent ragdoll
  function hit(a, o) {
    o = o || {};
    const p = phys(a), g = a.isPlayer ? CBZ.player.pos : (a.group ? a.group.position : a.pos);
    if (a && a._deathSeed == null) a._deathSeed = Math.random() * 6.28;
    let dx, dz;
    if (o.dir) { dx = o.dir.x; dz = o.dir.z; }
    else { dx = g.x - (o.fromX != null ? o.fromX : g.x); dz = g.z - (o.fromZ != null ? o.fromZ : g.z); }
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const f = o.force != null ? o.force : 4;
    p.fl = Math.max(p.fl, 0.32); p.fdx = dx; p.fdz = dz;
    p.settle = 0;                                  // any hit wakes a settled body
    // shock = reaction energy that drives the limb flail; bigger hits ring more
    const sk = Math.min(2.2, 0.18 + f * 0.085 + (o.fling ? 0.6 : 0));
    if (o.fling) {
      // LAUNCH: a blast/throw — full airborne tumble, both spin axes, every
      // limb thrown wide. vy is the launch height; horizontal carries the body.
      p.air = true;
      p.vx += dx * f; p.vz += dz * f;
      p.vy = Math.max(p.vy, 0) + o.fling;
      const heavy = f * 0.45 + 2;
      p.spin = (Math.random() * 2 - 1) * heavy;     // pitch tumble
      p.spinZ = (Math.random() * 2 - 1) * heavy * 0.6; // roll/windmill
      p.shock = Math.max(p.shock, sk + 0.6);
      if (!a.dead && intactOn()) {
        // POSE-LOCK (SURV_THROW_INTACT): a LIVE thrown/flung body flies as
        // ONE piece — no spring kick; zero the limb springs so the landing
        // ragdoll unlocks from a clean state instead of stored flail energy.
        const r = ensureRag(p);
        for (const k in r) { const L = r[k]; L.rx = L.rz = L.vx = L.vz = 0; }
      } else {
        kickRag(a, p, sk + 0.5, 1, a._deathSeed);   // lift=1 → limbs fly overhead
      }
      // stacked-launch cap: disasters can land several flings on one body in a
      // single frame — unbounded p.v* rocketed bodies to orbit with the limb
      // rig streaming behind (the other half of the exploding-ragdoll bug).
      if (CBZ.CONFIG.SURV_RAGDOLL_STABLE !== false) {
        const hv = Math.hypot(p.vx, p.vz);
        if (hv > 30) { p.vx *= 30 / hv; p.vz *= 30 / hv; }
        if (p.vy > 18) p.vy = 18;
        if (p.spin > 12) p.spin = 12; else if (p.spin < -12) p.spin = -12;
        if (p.spinZ > 12) p.spinZ = 12; else if (p.spinZ < -12) p.spinZ = -12;
      }
    } else {
      p.kx += dx * f; p.kz += dz * f;
      if (CBZ.CONFIG.SURV_RAGDOLL_STABLE !== false) {
        const hk = Math.hypot(p.kx, p.kz);
        if (hk > 24) { p.kx *= 24 / hk; p.kz *= 24 / hk; }
      }
      p.shock = Math.max(p.shock, sk);
      kickRag(a, p, sk, 0, a._deathSeed);
      if (o.knockdown) {
        // a caller may pass a duration (1.2) or just `true` to mean "knock them
        // down". Coerce `true` to a full topple+lie+getup beat (1.3s) so a KO from
        // a punch / car bump reads as a real fall, not a 1-frame stumble. Numbers
        // pass through unchanged, so survival/jail callers are unaffected.
        const kd = o.knockdown === true ? 1.3 : o.knockdown;
        p.down = Math.max(p.down, kd);
        p.ddir = Math.atan2(dx, dz);
        p.shock = Math.max(p.shock, sk + 0.25);     // crumpling stirs the limbs
      } else if (f >= 10 && !a.isPlayer && Math.random() < (f - 10) * 0.05) {
        // a hard non-knockdown shove can still buckle a ped (euphoria stumble)
        p.down = Math.max(p.down, 0.8 + Math.random() * 0.5);
        p.ddir = Math.atan2(dx, dz);
      }
    }
    flashHead(a);
  }

  // ---- pose a downed / flung / carried / flinching rig ----
  function poseActor(a, p, dt) {
    const ch = a.char, grp = a.group; if (!ch || !grp) return;
    if (a._deathSeed == null) a._deathSeed = Math.random() * 6.28;
    const intact = !a.dead && intactOn();
    if (p.heldBy && intact) {
      // CARRIED (live): a rigid hang pose, written absolutely — the old path
      // fell through to the upright flail below, whose additive late-write
      // had no animChar base while held and wound the limbs up over time.
      if (Math.abs(grp.rotation.x) > 0.01) grp.rotation.x = damp(grp.rotation.x, 0, 9, dt);
      if (Math.abs(grp.rotation.z) > 0.01) grp.rotation.z = damp(grp.rotation.z, 0, 9, dt);
      hangPose(a);
      return;
    }
    if (p.air) {
      // a flung body tumbles as a whole on BOTH axes; the group spin carries
      // all the violence. LIVE + intact: the limbs are POSE-LOCKED to the
      // pelvis (bracePose, absolute) — one rigid articulated piece in flight,
      // exactly the owner's spec; it unlocks into the loose ragdoll only on
      // landing (see step()). Dead bodies keep the legacy deathPose + flail.
      grp.rotation.x += p.spin * dt;
      grp.rotation.z += p.spinZ * dt;
      if (intact) { bracePose(a); return; }
      if (a.dead && CBZ.deathPose) CBZ.deathPose(ch, a._deathSeed);
      applyRag(a, p, dt);
      return;
    }
    if (p.down > 0) {
      // dead = crumpled on the ground in a dramatic sprawl; living = on their back.
      // topple is CAPPED at exactly 90° (flat on the back) — it must NEVER exceed
      // vertical, or the rig (pivoting at its FEET) folds PAST flat: the head/torso
      // swing down-and-behind, sinking under the street — the "backwards body" look.
      // Variety comes from the side-ROLL below (a corpse rolls onto a shoulder),
      // which reads as a natural crumple, not a broken backward fold.
      const topple = Math.PI / 2;
      grp.rotation.x = damp(grp.rotation.x, -topple, a.dead ? 7 : 11, dt); // fall onto back (never past flat)
      grp.rotation.y = damp(grp.rotation.y, p.ddir, 8, dt);
      const roll = a.dead ? 0.6 * Math.sin(a._deathSeed * 1.7) : 0;   // ~±35° onto a shoulder
      grp.rotation.z = damp(grp.rotation.z, roll, 9, dt);
      if (a.dead && CBZ.deathPose) CBZ.deathPose(ch, a._deathSeed);
      if (intact) {
        // LIVE downed body: same loose spring ragdoll, but written ABSOLUTELY
        // (animChar is skipped while owned, so the additive write had no base
        // and accumulated — the wind-up half of the mangled-bodies bug).
        integRag(a, p, dt); writeRag(a, p, true);
        return;
      }
      applyRag(a, p, dt);     // limbs jiggle as the body lands & settles, then still
      return;
    }
    // getting up: ease back upright
    if (Math.abs(grp.rotation.x) > 0.01) grp.rotation.x = damp(grp.rotation.x, 0, 9, dt);
    if (Math.abs(grp.rotation.z) > 0.01) grp.rotation.z = damp(grp.rotation.z, 0, 9, dt);
    // flinch jolt on the upper body
    if (p.fl > 0 && ch.body) {
      const k = p.fl / 0.32;
      ch.body.rotation.x += -0.5 * k;          // recoil back
      ch.body.rotation.z += p.fdx * 0.3 * k;
    }
    // upright but still ringing from a hit → integrate the limb flail now, but
    // DEFER the rig write to the late pass: animChar runs after us (orders
    // 30-46) and would otherwise stomp the limbs. Flag it for writeRag().
    if (p.rag && (p.shock > 0.02 || Math.abs(p.rag.body.rx) > 0.01 ||
                  Math.abs(p.rag.la.rx) > 0.01 || Math.abs(p.rag.la.rz) > 0.01)) {
      integRag(a, p, dt);
      p._lateWrite = 1;       // upright body still settling its limbs → write late
      p._lateStamp = physFrame;   // refreshed every step() — a stale stamp means "left the world"
      lateSet.add(a);
    } else if (p._lateWrite) { p._lateWrite = 0; lateSet.delete(a); }
  }

  // integrate one actor's body state; returns true if it OWNS the actor
  // this frame (thrown / down / held → its brain + locomotion are skipped)
  function step(a, dt) {
    const p = a._phys; if (!p) return false;
    const grp = a.group; if (!grp) return false;
    if (p.flash > 0) { p.flash = Math.max(0, p.flash - dt); fadeFlash(a, p); }
    if (p.heldBy) { poseActor(a, p, dt); return true; } // position set by the holder

    if (p.air) {
      p.vy -= G() * dt;
      // ANTI-TUNNEL SUBSTEP: a blast/throw can launch a body fast enough that one
      // position step skips clean THROUGH a wall before collide() ever tests it. Cut
      // the advance into sub-steps no longer than ~0.3m each and collide on every one,
      // so an explosion can't punt a body out the far side of a building.
      const n = Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 0.3));
      const sdt = dt / n;
      for (let sub = 0; sub < n; sub++) {
        grp.position.x += p.vx * sdt; grp.position.y += p.vy * sdt; grp.position.z += p.vz * sdt;
        if (CBZ.collide) CBZ.collide(grp.position, BOT_R);
      }
      const fl = floorAt(grp.position.x, grp.position.z);
      if (grp.position.y <= fl && p.vy <= 0) {
        // rest ON the surface. In city, a flat (toppled/dead) body would have its
        // mid-height at floor level and sink the lower half through the street, so
        // lift it by flatness right on the landing frame too — no one-frame sink.
        grp.position.y = (CBZ.game.mode === "city") ? cityRestY(grp) : fl;
        const impact = -p.vy;                       // how hard it hit
        const speed = Math.hypot(p.vx, p.vz);
        // BOUNCE: a hard landing kicks the body back up once or twice (it
        // doesn't stick instantly — euphoria bodies skip and tumble). Bleed a
        // lot of energy each bounce so it converges quickly and never loops.
        if (impact > 7 && p.bounce < 2) {
          p.vy = impact * 0.34; p.bounce++;
          p.vx *= 0.55; p.vz *= 0.55;
          p.spin *= 0.6; p.spinZ *= 0.6;
          p.shock = Math.max(p.shock, 0.4);
          if (CBZ.shake && near(grp.position, 16)) CBZ.shake(0.18);
          poseActor(a, p, dt);
          return true;
        }
        // SETTLED ONTO THE GROUND: convert remaining horizontal speed into a
        // ground SLIDE (kx/kz, decays via friction below) so a launched body
        // skids to a stop instead of snapping in place; spin carries into a
        // brief tumble that the topple-damp resolves.
        p.air = false; p.vy = 0; p.bounce = 0;
        p.kx += p.vx * 0.7; p.kz += p.vz * 0.7; p.vx = p.vz = 0;
        p.down = a.dead ? 9999 : Math.max(p.down, 1.4);  // dead stay sprawled; living get up
        p.ddir = speed > 0.5 ? Math.atan2(p.kx, p.kz) : p.ddir; // sprawl along travel
        p.shock = Math.max(p.shock, Math.min(0.8, impact * 0.04 + speed * 0.03));
        // UNLOCK on landing (SURV_THROW_INTACT): the pose-locked flight ends
        // here — kick the limb springs with the impact so the body flops
        // loose into the sprawl the moment it actually hits something.
        if (!a.dead && intactOn()) kickRag(a, p, Math.min(1.6, 0.5 + impact * 0.05), 0, a._deathSeed);
        if (CBZ.shake && near(grp.position, 16)) CBZ.shake(Math.min(0.4, 0.12 + impact * 0.012));
        if (CBZ.sfx && impact > 9 && near(grp.position, 12)) CBZ.sfx("hit");
      }
      poseActor(a, p, dt);
      return true;
    }

    // CITY GROUND OWNERSHIP: in city mode, grapple must keep grounding a body for
    // as long as it is laid out — while knocked DOWN, while KO'd (the whole ko
    // window, not just the brief knockdown beat), while DEAD (forever), and through
    // the get-up window where the rig is still pitched toward flat — otherwise
    // peds.js move() (which slams pos.y to the floor with NO flatness lift) takes
    // over the instant p.down hits 0 and the half-flat body sinks through the
    // street. We own the body (return true) and clamp Y to cityRestY on EVERY such
    // frame. Gated to city; survival/escape are byte-identical.
    const inCity = CBZ.game.mode === "city";
    // CITY KO: a knocked-out ped (a.ko>0, set by city/peds.js cityKOPed) must stay
    // SPRAWLED + grounded for the full KO, not just the 1.3s knockdown timer. We
    // keep p.down topped up to the remaining ko so the body lies the whole time and
    // then gets up cleanly — same weighty topple as a kill, just temporary. Only in
    // city; survival/jail never set a.ko on a grapple-owned body, so untouched.
    const cityKO = inCity && (a.ko || 0) > 0 && !a.dead;
    if (cityKO && p.down < a.ko) p.down = a.ko;                  // lie for as long as KO'd
    const cityFlat = Math.abs(grp.rotation.x) > 0.04;            // still laid/laying flat
    const cityGround = inCity && (p.down > 0 || a.dead || cityKO || cityFlat);

    let owns = false;
    if (p.down > 0) {
      p.down = Math.max(0, p.down - dt); owns = true;

      // REALISTIC SLOPE ROLL: a downed body on sloped TERRAIN slides downhill
      // under gravity and settles via friction on flatter ground. Bots only
      // ever stand on the terrain height-field (never on building roofs), so a
      // shove on the mountain should make them tumble down the slope and come
      // to rest — NOT trip the building-style "fell off a ledge" air-fall that
      // used to fling them off the cone to their death. We sample the terrain
      // gradient and push them down it; friction (below) always wins on flat
      // ground, so the slide is bounded and they stop at the base.
      const x = grp.position.x, z = grp.position.z;
      const gx = floorAt(x - 0.8, z) - floorAt(x + 0.8, z);   // downhill in +x
      const gz = floorAt(x, z - 0.8) - floorAt(x, z + 0.8);   // downhill in +z
      const grad = Math.hypot(gx, gz) / 1.6;                  // rise / run
      if (grad > 0.12) { p.kx += (gx / 1.6) * 16 * dt; p.kz += (gz / 1.6) * 16 * dt; }

      // SETTLE / SLEEP: once a grounded body has bled its velocity below a
      // threshold it goes "asleep" (Jakobsen) — settle ramps toward 1 so the
      // limb rig firms up and stops flailing, giving a stable final pose. Any
      // residual motion (a fresh slide, a slope) re-wakes it (settle drops).
      const moving2 = p.kx * p.kx + p.kz * p.kz;
      if (moving2 < 0.04 && p.shock < 0.05) p.settle = Math.min(1, p.settle + dt * 1.4);
      else p.settle = Math.max(0, p.settle - dt * 4);

    }

    // knockback / slope slide — decays fast, and ALWAYS follows the terrain
    // (no airborne fall off smooth ground). Genuine building falls are the
    // player's department (physics.js, which tracks platforms); bots ride the
    // ground field, so a slide just rides the slope down and settles.
    if (Math.abs(p.kx) > 0.02 || Math.abs(p.kz) > 0.02) {
      grp.position.x += p.kx * dt; grp.position.z += p.kz * dt;
      const dec = Math.pow(0.0009, dt);
      p.kx *= dec; p.kz *= dec;
      if (CBZ.collide) CBZ.collide(grp.position, BOT_R);
      // city downed/dead/flat bodies rest ON the surface (lifted by flatness);
      // other sliding bodies hug the floor exactly. Applied LAST so nothing sinks.
      grp.position.y = cityGround ? cityRestY(grp) : floorAt(grp.position.x, grp.position.z);
    } else if (cityGround) {
      // not sliding, but a city body that is down/dead/still-flat must STILL be
      // ground-clamped every frame (peds.js would otherwise pin pos.y to the bare
      // floor and sink the half-flat rig). cityRestY lifts by flatness so a body
      // that has finished standing up (rotation.x≈0) just sits exactly on the floor.
      grp.position.y = cityRestY(grp);
    } else if (p.down > 0) {
      grp.position.y = floorAt(grp.position.x, grp.position.z);
    }
    // CORPSE EXTENT vs WALLS: a flat body extends ~1.7m from its feet (grp.position,
    // the only point collide() above tested) toward where the HEAD fell, so the
    // head/torso end can clip into a wall the feet are clear of (dead people "fall
    // through walls"). Collide the head end too and shove the WHOLE body out by the
    // same delta. City + actually-flat only; cheap (one extra collide on a corpse).
    if (cityGround && CBZ.collide) {
      const flat = Math.min(1, Math.abs(grp.rotation.x) / 1.5708);
      if (flat > 0.4) {
        const ry = grp.rotation.y || 0, ext = 1.7 * flat;
        const hx = -Math.sin(ry) * ext, hz = -Math.cos(ry) * ext;   // toward the head
        _corpseC.x = grp.position.x + hx; _corpseC.z = grp.position.z + hz;
        CBZ.collide(_corpseC, BOT_R);
        grp.position.x += _corpseC.x - (grp.position.x + hx);        // shift body by the head's push
        grp.position.z += _corpseC.z - (grp.position.z + hz);
      }
    }
    // OWN a city body that is dead or still laid flat even after the knockdown
    // timer expired, so peds.js skips it (CBZ.body.busy reports it too) and never
    // re-grounds it to the bare floor. Without this a settled corpse (down==0) or
    // a KO'd ped mid-getup would be handed back to move() and sink.
    if (cityGround) owns = true;
    if (p.fl > 0) p.fl = Math.max(0, p.fl - dt);
    poseActor(a, p, dt);
    return owns;
  }

  function near(pos, r) {
    const c = CBZ.camera.position; const dx = pos.x - c.x, dz = pos.z - c.z;
    return dx * dx + dz * dz < r * r;
  }

  // CITY: a downed/dead rig laid flat (rotation.x ≈ ±90°) has its mid-height at
  // floor level, so the lower half of the body sinks UNDER the street. Lift the
  // group by the body half-thickness, scaled by how flat it is (full lift when
  // flat, none when upright so a getting-up body never floats). Matches the
  // ambient-crowd corpse lift in city/crowd.js so promoted + instanced bodies
  // rest at the SAME height. Returns the resting Y. Survival is left untouched.
  const FLAT_LIFT = 0.42;
  function cityRestY(grp) {
    const flat = Math.min(1, Math.abs(grp.rotation.x) / 1.5708);
    return floorAt(grp.position.x, grp.position.z) + FLAT_LIFT * flat;
  }

  // ---- aiming: nearest living bot in front of the player ----
  function lookDir() {
    const y = CBZ.cam ? CBZ.cam.yaw : 0;
    return { x: -Math.sin(y), z: -Math.cos(y) };
  }
  function aimTarget() {
    const P = CBZ.player.pos, L = lookDir();
    let best = null, bestD = REACH;
    for (const b of CBZ.bots) {
      if (b.dead || busy(b)) continue;
      const dx = b.pos.x - P.x, dz = b.pos.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.1) continue;
      const dot = (dx / d) * L.x + (dz / d) * L.z;
      if (dot < CONE) continue;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  // ---- the verbs ----
  let held = null;
  function grab() {
    if (held) return;
    const t = aimTarget(); if (!t) return;
    held = t; phys(t).heldBy = CBZ.player;
    phys(t).down = 0; phys(t).air = false;
    CBZ.sfx && CBZ.sfx("whoosh");
    CBZ.flashHint && CBZ.flashHint("Holding " + (t.name || "survivor") + " — release or throw", 1.2);
  }
  function release(thrown) {
    if (!held) return;
    const p = phys(held);
    p.heldBy = null;
    if (thrown) {
      const L = lookDir();
      hit(held, { dir: L, force: THROW_FWD, fling: THROW_UP });
      CBZ.sfx && CBZ.sfx("ko");
      CBZ.shake && CBZ.shake(0.3);
    }
    held = null;
  }
  function punch() {
    if (held) { release(true); return; }   // LMB while holding = throw
    CBZ.fpsPunchAnim && CBZ.fpsPunchAnim();  // swing the first-person hand
    const t = aimTarget();
    CBZ.sfx && CBZ.sfx("whoosh");
    if (!t) return;
    const knockdown = Math.random() < 0.4 ? 1.2 : 0;
    hit(t, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: PUNCH_FORCE, knockdown });
    if (CBZ.surv) CBZ.surv.hurt(t, 18, { cause: "beaten to death", fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
    CBZ.sfx && CBZ.sfx("punch");
    CBZ.shake && CBZ.shake(0.18);
    CBZ.doHitstop && CBZ.doHitstop(0.04);
  }
  function push() {
    const t = aimTarget();
    if (!t) return;
    hit(t, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: PUSH_FORCE, knockdown: Math.random() < 0.5 ? 1.0 : 0 });
    CBZ.sfx && CBZ.sfx("punch");
    CBZ.shake && CBZ.shake(0.12);
  }

  // ---- public body API used by disasters / movement modules ----
  CBZ.body = {
    hit,
    fling(a, o) { hit(a, { fromX: o.fromX, fromZ: o.fromZ, dir: o.dir, force: o.force || 6, fling: o.up || 6 }); },
    knockdown(a, o) { hit(a, { fromX: o.fromX, fromZ: o.fromZ, dir: o.dir, force: o.force || 4, knockdown: o.t || 1.3 }); },
    busy, step, phys, flash: flashHead,
  };
  CBZ.grapple = { grab, release, punch, push, holding() { return !!held; } };

  // ---- input (survival only; jail keeps its own combat) ----
  function active() { return CBZ.game.mode === "survival" && CBZ.game.state === "playing" && document.pointerLockElement; }
  document.addEventListener("mousedown", function (e) {
    if (!active()) return;
    if (e.button === 0) { e.preventDefault(); punch(); }
    else if (e.button === 2) { e.preventDefault(); push(); }
  });
  addEventListener("keydown", function (e) {
    if (!active() || e.repeat) return;
    if (e.key.toLowerCase() === "e") grab();
  });
  addEventListener("keyup", function (e) {
    if (CBZ.game.mode !== "survival") return;
    if (e.key.toLowerCase() === "e") release(false);   // let go = set down safely
  });

  // ---- LATE-WRITE REGISTRY: only a handful of freshly-hit upright bodies ever
  //      need the order-90 rig re-write, yet the old pass walked EVERY bot/ped/
  //      cop each frame just to early-out on each. poseActor (the ONLY place
  //      _lateWrite is armed/cleared) registers actors here; order 90 walks just
  //      this set. _lateStamp is refreshed by every order-24 step — an entry
  //      whose stamp is stale wasn't stepped this frame (the actor left the
  //      world / its arrays), so it's dropped instead of written forever. ----
  const lateSet = new Set();
  let physFrame = 0;          // bumped once per order-24 pass (the stamp epoch)

  // ---- per-frame body integration over bots/peds/cops + the player (order 24).
  //      Runs in any non-escape mode (survival bots, city peds & cops) so every
  //      mode gets the shared knockback / fling / knockdown physics. The grab/
  //      throw verbs above stay survival-only (gated by active()). ----
  CBZ.onUpdate(24, function (dt) {
    if (CBZ.game.mode === "escape") return;
    physFrame++;

    // carry a held bot in front of the player (this is how you SAVE someone)
    if (held && !held.dead) {
      const L = lookDir(), P = CBZ.player.pos;
      const hx = P.x + L.x * 1.5, hz = P.z + L.z * 1.5;
      held.pos.x = hx; held.pos.z = hz;
      held.pos.y = floorAt(hx, hz) + 0.4;
      held.group.rotation.y = Math.atan2(L.x, L.z);
    } else if (held && held.dead) { release(false); }

    for (const b of CBZ.bots) step(b, dt);
    if (CBZ.cityPeds) for (let i = 0; i < CBZ.cityPeds.length; i++) step(CBZ.cityPeds[i], dt);
    if (CBZ.cityCops) for (let i = 0; i < CBZ.cityCops.length; i++) step(CBZ.cityCops[i], dt);

    // the player's own knockback slide (knockdown/thrown handled in physics.js)
    const P = CBZ.player;
    if (P._phys && !P.dead) {
      const p = P._phys;
      if ((Math.abs(p.kx) > 0.02 || Math.abs(p.kz) > 0.02) && !(p.down > 0)) {
        P.pos.x += p.kx * dt; P.pos.z += p.kz * dt;
        const dec = Math.pow(0.0009, dt); p.kx *= dec; p.kz *= dec;
        if (CBZ.collide) CBZ.collide(P.pos, P.radius || 0.55);
      }
      if (p.fl > 0) p.fl = Math.max(0, p.fl - dt);
    }
  });

  // ---- LATE rig write (order 90): re-apply the limb flail for UPRIGHT bodies
  //      that are still ringing from a hit. animChar (orders 30-46) and
  //      facial/reactions (88/89) all write the rig after our order-24 step, so
  //      an upright walking ped's shock flail must be layered on AFTER them or
  //      it gets stomped. Owned (air/down) bodies already wrote at 24 (animChar
  //      is skipped for them), so we only touch flagged upright actors here. ----
  function lateWrite(a) {
    const p = a && a._phys; if (!p || !p._lateWrite) return;
    if (p.air || p.down > 0 || p.heldBy) return;   // owned bodies wrote at step()
    writeRag(a, p);
    if (CBZ.lockCharacterHips) CBZ.lockCharacterHips(a.char || (a.isPlayer ? CBZ.playerChar : null));
  }
  //      Registry-driven: iterate only the actors poseActor armed this frame
  //      (lateSet, usually empty or a handful) instead of every bot/ped/cop.
  //      lateWrite keeps its own air/down/held early-outs, so behaviour for a
  //      registered actor is byte-identical to the old full scan.
  CBZ.onUpdate(90, function () {
    if (CBZ.game.mode === "escape") return;
    if (!lateSet.size) return;
    for (const a of lateSet) {
      const p = a._phys;
      // stale: flag cleared, or the actor wasn't stepped at order 24 this frame
      // (removed from the world arrays) — drop it rather than write forever.
      if (!p || !p._lateWrite || p._lateStamp !== physFrame) { lateSet.delete(a); continue; }
      lateWrite(a);
    }
  });
})();
