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

  const REACH = 3.1;          // arm's length for push / grab / punch
  const CONE = 0.25;          // forward-cone dot threshold for aiming
  const THROW_FWD = 13, THROW_UP = 7.5;
  const PUSH_FORCE = 12, PUNCH_FORCE = 6;
  const BOT_R = 0.5;
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
      down: 0, ddir: 0,       // knockdown timer + facing while down
      heldBy: null,
      flash: 0, flashSaved: -1, flashEi: 1,   // head-impact emissive pop
    });
  }
  function busy(a) { const p = a._phys; return !!(p && (p.air || p.down > 0 || p.heldBy)); }

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
  function hit(a, o) {
    o = o || {};
    const p = phys(a), g = a.isPlayer ? CBZ.player.pos : (a.group ? a.group.position : a.pos);
    let dx, dz;
    if (o.dir) { dx = o.dir.x; dz = o.dir.z; }
    else { dx = g.x - (o.fromX != null ? o.fromX : g.x); dz = g.z - (o.fromZ != null ? o.fromZ : g.z); }
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const f = o.force != null ? o.force : 4;
    p.fl = Math.max(p.fl, 0.32); p.fdx = dx; p.fdz = dz;
    if (o.fling) {
      p.air = true; p.vx = dx * f; p.vz = dz * f; p.vy = o.fling;
      p.spin = (Math.random() * 2 - 1) * 7;
    } else {
      p.kx += dx * f; p.kz += dz * f;
      if (o.knockdown) { p.down = Math.max(p.down, o.knockdown); p.ddir = Math.atan2(dx, dz); }
    }
    flashHead(a);
  }

  // ---- pose a downed / flung / flinching rig ----
  function poseActor(a, p, dt) {
    const ch = a.char, grp = a.group; if (!ch || !grp) return;
    if (a._deathSeed == null) a._deathSeed = Math.random() * 6.28;
    if (p.air) {
      // a flung body windmills — limbs splayed mid-air reads far more violent
      grp.rotation.x += p.spin * dt;
      grp.rotation.z += p.spin * 0.55 * dt;
      if (a.dead && CBZ.deathPose) CBZ.deathPose(ch, a._deathSeed);
      return;
    }
    if (p.down > 0) {
      // dead = crumpled on the ground in a dramatic sprawl; living = on their back
      const topple = a.dead ? (Math.PI / 2) * (1 + 0.18 * Math.sin(a._deathSeed)) : Math.PI / 2;
      grp.rotation.x = damp(grp.rotation.x, -topple, a.dead ? 7 : 11, dt); // fall onto back
      grp.rotation.y = damp(grp.rotation.y, p.ddir, 8, dt);
      grp.rotation.z = damp(grp.rotation.z, a.dead ? 0.22 * Math.sin(a._deathSeed * 1.7) : 0, 9, dt);
      if (a.dead && CBZ.deathPose) CBZ.deathPose(ch, a._deathSeed);
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
      grp.position.x += p.vx * dt; grp.position.y += p.vy * dt; grp.position.z += p.vz * dt;
      if (CBZ.collide) CBZ.collide(grp.position, BOT_R);
      const fl = floorAt(grp.position.x, grp.position.z);
      if (grp.position.y <= fl && p.vy <= 0) {
        grp.position.y = fl; p.air = false; p.vx = p.vz = 0; p.vy = 0;
        p.down = a.dead ? 9999 : Math.max(p.down, 1.4);  // dead stay sprawled; living get up
        if (CBZ.shake && near(grp.position, 16)) CBZ.shake(0.2);
      }
      poseActor(a, p, dt);
      return true;
    }

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

      // CITY: keep a downed/dead body resting ON the ground, not bisected by it
      // — a flat body's centre sits at floor level, so half of it sinks under.
      // Track the floor and lift by the flop amount (full when flat, none when
      // upright, so a getting-up body never floats). Survival is left as-is.
      if (CBZ.game.mode === "city") {
        grp.position.y = floorAt(grp.position.x, grp.position.z) + 0.35 * Math.min(1, Math.abs(grp.rotation.x) / 1.5708);
      }
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
      grp.position.y = floorAt(grp.position.x, grp.position.z);
    } else if (p.down > 0) {
      grp.position.y = floorAt(grp.position.x, grp.position.z);   // keep the corpse grounded
    }
    if (p.fl > 0) p.fl = Math.max(0, p.fl - dt);
    poseActor(a, p, dt);
    return owns;
  }

  function near(pos, r) {
    const c = CBZ.camera.position; const dx = pos.x - c.x, dz = pos.z - c.z;
    return dx * dx + dz * dz < r * r;
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

  // ---- per-frame body integration over bots/peds/cops + the player (order 24).
  //      Runs in any non-escape mode (survival bots, city peds & cops) so every
  //      mode gets the shared knockback / fling / knockdown physics. The grab/
  //      throw verbs above stay survival-only (gated by active()). ----
  CBZ.onUpdate(24, function (dt) {
    if (CBZ.game.mode === "escape") return;

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
})();
