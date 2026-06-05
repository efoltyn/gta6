/* ============================================================
   city/combat.js — the city's MELEE + the weapon-acquisition bridge.

   Guns are NOT a separate system here: buying/looting a firearm unlocks
   it in the engine's ONE gun system (systems/fpsmode.js + weapons/), and
   that exact hitscan — sphere hitboxes, headshots, recoil, tracers,
   reload, weapon models, third-person shoulder-aim — drives city gunplay
   (fpsmode.findActorHit/gunHit are city-aware). This file only:
     • maps city weapon names → engine weapon ids and unlocks them,
     • tops up reserve ammo,
     • handles UNARMED punches + melee weapons (Bat/Knife) on left-click
       (only while you're NOT holding a firearm — fpsmode owns that click).

   MELEE FEEL (GTA-grade), all self-contained here:
     • LMB  = LIGHT attack → a 3-hit COMBO (jab → cross → hook) with a
              timing window; the 3rd hit is a knockdown FINISHER.
     • RMB  = HEAVY attack (unarmed/melee only) → slow, costs stamina,
              guaranteed stagger/knockdown, big hitstop + shake.
     • Hold RMB (no swing) raises a GUARD; a freshly-raised guard is a
              PARRY window — eat an incoming melee blow there and you
              negate it AND auto-counter the attacker.
     • Tough NPCs (gang/guard/cop/armed) can BLOCK a light jab and stagger
              you; punish a blocking enemy with a heavy/combo for a COUNTER.
     • HIT-STOP on every connect, velocity knockback + ragdoll via CBZ.body,
              stamina drain, screen shake, punch/hit/ko sfx, KO slow-mo.
   Public APIs (cityGiveWeapon/cityAddAmmo/cityCurrentWeapon/cityHasGun)
   and the punch/meleeSwing behavior are PRESERVED.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const P = CBZ.player;

  // city weapon name → engine (fpsmode) weapon id
  const GUN_MAP = { Pistol: "sidearm", SMG: "smg", Shotgun: "shotgun", Rifle: "carbine", Revolver: "revolver", "Desert Eagle": "deagle", "AK-47": "ak47", Uzi: "uzi", Sniper: "sniper", LMG: "lmg" };

  let fireCD = 0;

  // ---- combo / stance state (per swing) -----------------------------------
  let combo = 0;          // current chain length (0..3); resets if you stall
  let comboT = 0;         // seconds left in the "chain me!" window
  let heavyCD = 0;        // recovery after a heavy
  let staggerT = 0;       // you got blocked/parried → briefly can't swing
  let guardT = 0;         // > 0 while holding RMB with no gun (block stance)
  let parryT = 0;         // fresh-guard window: an eaten blow counters instead
  let rmbDown = false;    // RMB currently held (for guard)
  let rmbT = 0;           // how long RMB has been held (tap vs hold)
  let lastTarget = null;  // who you're chaining on (for combo focus)

  const COMBO_WINDOW = 0.62;   // chain within this or the combo drops
  const PARRY_WINDOW = 0.30;   // a just-raised guard parries
  const KINDS = ["jab", "cross", "hook"];   // 3-hit cadence

  function lookDir() { const y = CBZ.cam ? CBZ.cam.yaw : 0; return { x: -Math.sin(y), z: -Math.cos(y) }; }

  // ---- stamina (0..100 in city) -------------------------------------------
  function stam() { return P.stamina == null ? 100 : P.stamina; }
  function spend(n) { P.stamina = Math.max(0, stam() - n); }
  function tired() { return stam() < 8; }

  // tough NPCs trade blows — they can block/counter, not just fold
  function isTough(a) {
    if (!a) return false;
    if (a.kind === "cop" || a.kind === "guard" || a.kind === "warden" || a.kind === "security") return true;
    if (a.armed) return true;
    if (a.gang && (a.rank || 0) >= 1) return true;
    return (a.aggr || 0) >= 0.65;
  }

  // best target in a forward cone within range (melee only — guns use fpsmode)
  function aimTarget(range, cone) {
    const Pp = P.pos, L = lookDir();
    let best = null, bd = range;
    const consider = (a) => {
      if (!a || a.dead) return;
      const dx = a.pos.x - Pp.x, dz = a.pos.z - Pp.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.2) return;
      const dot = (dx / d) * L.x + (dz / d) * L.z;
      if (dot < cone) return;
      // keep chaining on the same target if it's still in arc
      let score = d - dot * 6;
      if (a === lastTarget) score -= 3;
      if (score < bd) { bd = score; best = a; }
    };
    for (const c of CBZ.cityCops) consider(c);
    for (const p of CBZ.cityPeds) if (!p.vendor) consider(p);
    return best;
  }

  // ---- weapon-acquisition bridge to the engine gun system ----
  function giveWeapon(name) {
    const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    if (!it) return;
    g.cityWeapon = name;                       // for the city HUD + interact (hostage/aim) display
    const id = GUN_MAP[name];
    if (id && CBZ.unlockWeapon) CBZ.unlockWeapon(id, { select: true });   // the EXACT jail gun, now yours
    if (CBZ.city) CBZ.city.note("Equipped " + name, 1.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityGiveWeapon = giveWeapon;
  CBZ.cityAddAmmo = function (n) {
    if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(n);
    else { g.cityAmmo = (g.cityAmmo || 0) + n; }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  CBZ.cityCurrentWeapon = function () { return g.cityWeapon ? CBZ.cityEcon.ITEMS[g.cityWeapon] : null; };
  CBZ.cityHasGun = function () { return !!(CBZ.hasAnyWeapon && CBZ.hasAnyWeapon()); };

  function markFighting() { P._fighting = 1.5; }

  // drive the third-person punch rig (jab/cross/hook/upper) — character.js reads these
  function animSwing(kind, heavy) {
    const ch = CBZ.playerChar;
    if (!ch) return;
    ch.punchKind = kind;
    ch.punchArm = (combo % 2) ? "l" : "r";
    ch.punchDur = heavy ? 0.44 : (kind === "hook" ? 0.38 : 0.32);
    ch.punchT = ch.punchDur;
    if (CBZ.cam) {
      const yaw = CBZ.cam.yaw;
      // square up toward the look direction on each swing so hits land where you face
      ch.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(ch.group.rotation.y, yaw, 0.7) : yaw;
    }
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();   // first-person hand swings too
  }

  // a clean, GTA-style stagger pop on the player when you eat a block/counter
  function selfStagger(t) {
    staggerT = Math.max(staggerT, t);
    P.stun = Math.max(P.stun || 0, t * 0.8);
    if (CBZ.shake) CBZ.shake(0.28);
    if (CBZ.sfx) CBZ.sfx("step");
  }

  // ---- the connect: shared damage + juice for a single landed blow --------
  // tier: "light" | "heavy" | "finisher".  Returns true if it connected.
  function land(t, dmg, tier, opts) {
    opts = opts || {};
    const fx = P.pos.x, fz = P.pos.z;
    const heavy = tier !== "light";
    const finisher = tier === "finisher";

    // tough NPCs can block a LIGHT jab (not a heavy/finisher) — and counter you
    if (!heavy && isTough(t) && !t.ko && !(t.hp <= (t.maxHp || 100) * 0.3)) {
      const blockChance = t.kind === "cop" ? 0.34 : (t.gang ? 0.30 : 0.22);
      if (Math.random() < blockChance && !(CBZ.body && CBZ.body.busy && CBZ.body.busy(t))) {
        t._blockT = 0.7;                       // they're in a block → punish with heavy
        if (CBZ.city) CBZ.city.note("Blocked!", 0.6);
        if (CBZ.sfx) CBZ.sfx("hit");
        // they jab back — stagger you a touch (no real damage from a block)
        if (Math.random() < 0.5) selfStagger(0.30);
        combo = 0; comboT = 0;
        return false;
      }
    }

    // punishing a blocking/guarding enemy with a heavy = COUNTER (bonus dmg + KD)
    const counter = heavy && t._blockT > 0;
    if (counter) { dmg = Math.round(dmg * 1.6); t._blockT = 0; if (CBZ.city) CBZ.city.note("COUNTER!", 0.7); }

    // --- HIT-STOP: the crunch of contact (light ~0.05, heavy ~0.09, KO 0.14)
    const lethal = (t.kind === "cop") ? null : (t.hp - dmg <= 0);
    if (CBZ.doHitstop) CBZ.doHitstop(finisher ? 0.14 : (heavy ? 0.09 : 0.055));
    if (CBZ.shake) CBZ.shake(finisher ? 0.7 : (heavy ? 0.5 : 0.22 + combo * 0.04));

    // --- apply damage through the existing city damage paths ---------------
    if (t.kind === "cop") {
      CBZ.cityHurtCop(t, dmg, { fromX: fx, fromZ: fz });
      if (!t.dead && CBZ.body) {
        const force = finisher ? 9 : (heavy ? 6.5 : 4);
        if (finisher || counter) CBZ.body.hit(t, { fromX: fx, fromZ: fz, force, knockdown: 1.1 });
        else CBZ.body.hit(t, { fromX: fx, fromZ: fz, force, knockdown: heavy && Math.random() < 0.5 ? 1.0 : 0 });
      }
    } else {
      t.hp -= dmg;
      if (t.hp <= 0) {
        // a heavy/finisher kills outright; a light blow that drops them = a clean KO
        if (heavy || finisher || opts.lethalIntent) {
          CBZ.cityKillPed(t, { fromX: fx, fromZ: fz, force: finisher ? 9 : 6, fling: finisher ? 4 : 3 }, "beaten");
        } else {
          t.hp = 1; CBZ.cityKOPed(t, fx, fz);   // light blows knock out rather than execute
        }
      } else {
        if (CBZ.body) {
          const force = finisher ? 8.5 : (heavy ? 6 : 4);
          const kd = finisher || counter ? 1.0 : (heavy && Math.random() < 0.45 ? 0.9 : 0);
          CBZ.body.hit(t, { fromX: fx, fromZ: fz, force, knockdown: kd });
          if (kd) { t.ko = Math.max(t.ko || 0, 5); t.alarmed = 6; }
        }
        // provoke / alarm so the world reacts to a non-lethal beating
        if (t.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(t.gang, 0.4);
        CBZ.cityCrime && CBZ.cityCrime(heavy ? 60 : 40, { x: t.pos.x, z: t.pos.z, type: "assault" });
      }
    }

    // --- audio + KO flourish ---------------------------------------------
    if (CBZ.sfx) CBZ.sfx("punch");
    const downed = (t.dead || t.ko > 0);
    if (downed && (finisher || heavy)) {
      if (CBZ.sfx) CBZ.sfx("ko");
      if (CBZ.doSlowmo) CBZ.doSlowmo(finisher ? 0.5 : 0.28);   // brief bullet-time on a knockout
    } else if (CBZ.sfx) {
      CBZ.sfx("hit");
    }
    lastTarget = t.dead ? null : t;
    return true;
  }

  // ---- LIGHT attack: chains jab → cross → hook (3rd = finisher) -----------
  function lightAttack() {
    if (staggerT > 0 || tired()) { if (tired() && CBZ.city) CBZ.city.note("Winded", 0.6); return; }
    markFighting();
    // advance the combo if we're inside the window, else start fresh
    if (comboT > 0 && combo < 3) combo++; else combo = 1;
    comboT = COMBO_WINDOW;
    const finisher = combo >= 3;
    const kind = finisher ? "hook" : KINDS[(combo - 1) % 3];
    animSwing(kind, finisher);
    spend(finisher ? 9 : 5);

    const t = aimTarget(finisher ? 3.1 : 2.7, 0.3);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    const base = it() ? it().dmg : 16;
    // jab/cross scale up through the chain; the hook (3rd) is the big one
    const dmg = finisher ? Math.round(base * 1.9) : Math.round(base * (1 + (combo - 1) * 0.18));
    if (t) {
      const ok = land(t, dmg, finisher ? "finisher" : "light");
      if (!ok) { /* blocked → combo already reset in land() */ }
      else if (finisher) { combo = 0; comboT = 0; if (CBZ.city) CBZ.city.note("3-HIT COMBO!", 0.8); }
    }
    fireCD = finisher ? 0.34 : 0.22;
  }

  // ---- HEAVY attack: slow, costly, staggers/knocks down -------------------
  function heavyAttack() {
    if (heavyCD > 0 || staggerT > 0) return;
    if (tired()) { if (CBZ.city) CBZ.city.note("Too winded for a heavy", 0.8); return; }
    markFighting();
    combo = 0; comboT = 0;
    animSwing("upper", true);                 // a big rising/overhand blow
    spend(16);

    const t = aimTarget(3.0, 0.2);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    const base = it() ? it().dmg : 16;
    const dmg = Math.round(base * 2.4);
    if (t) land(t, dmg, "heavy");
    heavyCD = 0.6;
    fireCD = 0.5;
  }

  function it() { return g.cityWeapon ? CBZ.cityEcon.ITEMS[g.cityWeapon] : null; }

  // ---- legacy entry points (PRESERVED public behavior) -------------------
  // old code / other systems may still call these; keep them swinging.
  function punch() {
    if (it() && it().melee) { lightAttack(); return; }
    lightAttack();
  }
  function meleeSwing() {
    lightAttack();
    fireCD = 0.4;
  }

  // ============================================================
  //  GUARD / PARRY: holding RMB (with no gun) raises a block.
  //  We intercept incoming melee damage so a guard chips, and a
  //  fresh guard (parry window) negates the blow AND counters.
  //  cityHurtPlayer is wrapped (call-through preserved).
  // ============================================================
  const _origHurt = CBZ.cityHurtPlayer;
  if (typeof _origHurt === "function") {
    CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal) {
      // NPC-fire LOS gate: an armed NPC whose muzzle was walled off this shot
      // can't land a round on you through the building. Their gun got lowered in
      // the actorMuzzle wrap; here we make the damage agree with the visual.
      if (attacker && attacker._losBlocked && fromX != null && !attacker.isPlayer) return;
      // only melee-range threats are parryable/blockable (guns/cars unaffected)
      const meleeRange = (fromX != null) && (Math.hypot((fromX) - P.pos.x, (fromZ) - P.pos.z) < 3.2);
      if (guardT > 0 && !headshot && meleeRange && !P.dead) {
        if (parryT > 0) {
          // PERFECT PARRY → negate, riposte the attacker, brief bullet-time
          parryT = 0; guardT = Math.max(guardT, 0.25);
          if (CBZ.city) CBZ.city.note("PARRY!", 0.8);
          if (CBZ.sfx) { CBZ.sfx("hit"); }
          if (CBZ.shake) CBZ.shake(0.4);
          if (CBZ.doHitstop) CBZ.doHitstop(0.08);
          if (CBZ.doSlowmo) CBZ.doSlowmo(0.22);
          if (attacker && attacker.pos && !attacker.dead) {
            const base = (it() && it().dmg) || 16;
            land(attacker, Math.round(base * 1.8), "heavy", { lethalIntent: true });
          }
          return;   // blow fully negated
        }
        // normal BLOCK → big chip reduction + no knockdown, costs stamina
        dmg *= 0.3; spend(10);
        if (CBZ.shake) CBZ.shake(0.2);
        if (CBZ.sfx) CBZ.sfx("hit");
      }
      return _origHurt.call(this, dmg, fromX, fromZ, reason, headshot, attacker, nonlethal);
    };
  }

  // ============================================================
  //  NPC-FIRE LINE-OF-SIGHT GATE (city)
  //  Armed peds / gang members fire through CBZ.tracer + CBZ.actorMuzzle
  //  from several call-sites (peds.js npcAttack, empire.js crewDefend,
  //  playergang.js). None of them gate on a wall, so rounds (and the gun
  //  prop itself) used to poke straight THROUGH buildings. Cops already
  //  self-gate via clearLineOfFire; we extend the SAME discipline to every
  //  armed NPC by wrapping the shared firing primitives once, here:
  //    • actorAimAt   → remember WHO an actor is shooting at,
  //    • actorMuzzle  → at the muzzle the shot leaves from, test LOS to that
  //                     target; if a wall is in the way flag _losBlocked and
  //                     LOWER the gun prop (mirrors police.js _gunLowered),
  //    • tracer       → never draw a city NPC tracer that crosses a wall,
  //    • cityHurtCop / cityHurtPlayer → drop damage from a walled-off muzzle.
  //  Player & cop shots already have a clear line by construction, so these
  //  wraps are no-ops for them.
  // ============================================================
  const _mz = new THREE.Vector3();

  // is this actor a city NPC that fires through the shared primitives?
  function isCityNpc(a) {
    return !!(a && !a.isPlayer && a.pos && (a.kind !== "cop"));   // cops self-gate in police.js
  }

  // lower / stow an armed NPC's gun prop so it stops clipping the wall it
  // can't shoot past (re-shown automatically the next clear shot).
  function lowerGun(a) {
    if (!a) return;
    a._losBlocked = true;
    a._gunLowered = true;
    if (a._weaponProp && a._weaponProp.visible) a._weaponProp.visible = false;
  }
  function raiseGun(a) {
    if (!a) return;
    a._losBlocked = false;
    a._gunLowered = false;
  }

  // PUBLIC GATE: true if NPC `att` has a clear muzzle→target line right now.
  // Callers may use it to hold fire / reposition; we also use it internally.
  // Side-effect: lowers/raises the gun prop to match (so it never pokes a wall).
  CBZ.cityNpcCanFire = function (att, tgt) {
    if (!att || !tgt || !tgt.pos) return true;
    if (g.mode !== "city") return true;
    if (!CBZ.clearLineOfFire) return true;
    _muzGate = true;   // suppress the muzzle wrap's own LOS test (we do it here)
    const m = (CBZ.actorMuzzle ? CBZ.actorMuzzle(att, _mz) : null) || { x: att.pos.x, y: 1.42, z: att.pos.z };
    _muzGate = false;
    const ty = tgt.isPlayer ? 1.55 : 1.3;
    const clear = CBZ.clearLineOfFire(m.x, m.y != null ? m.y : 1.42, m.z, tgt.pos.x, ty, tgt.pos.z);
    if (clear) raiseGun(att); else lowerGun(att);
    return clear;
  };

  // --- wrap actorAimAt: stash the aim target so the muzzle/tracer wraps know
  //     who this actor is firing at (the firing paths aim immediately before
  //     they grab the muzzle + draw the tracer). -----------------------------
  const _origAim = CBZ.actorAimAt;
  if (typeof _origAim === "function") {
    CBZ.actorAimAt = function (actor, target, dt) {
      if (actor && target && target.pos && isCityNpc(actor)) { actor._fireTgt = target; actor._fireTgtT = 0.5; }
      return _origAim.call(this, actor, target, dt);
    };
  }

  // --- wrap actorMuzzle: the muzzle is exactly the point a shot leaves from,
  //     so test LOS to the remembered target HERE. This is the cheapest place
  //     (the firing path already calls it once per shot) and lets us lower the
  //     gun before the tracer/damage even run. Re-entrant-safe via _muzGate. --
  let _muzGate = false;
  const _origMuzzle = CBZ.actorMuzzle;
  if (typeof _origMuzzle === "function") {
    CBZ.actorMuzzle = function (actor, out) {
      const res = _origMuzzle.call(this, actor, out);
      if (!_muzGate && g.mode === "city" && isCityNpc(actor) && actor && actor._fireTgt && (actor._fireTgtT || 0) > 0) {
        const t = actor._fireTgt;
        if (t && t.pos && !t.dead && CBZ.clearLineOfFire && res) {
          const ty = t.isPlayer ? 1.55 : 1.3;
          if (CBZ.clearLineOfFire(res.x, res.y != null ? res.y : 1.42, res.z, t.pos.x, ty, t.pos.z)) raiseGun(actor);
          else lowerGun(actor);
        }
      }
      return res;
    };
  }

  // --- wrap tracer: never render a city NPC bullet streak that crosses a wall.
  //     Player/cop tracers are clear by construction; a blocked line only ever
  //     comes from an un-gated NPC shot, and a tracer through a building reads
  //     as a bug, so dropping it is always correct. Cheap LOS test, city-only.
  const _origTracer = CBZ.tracer;
  if (typeof _origTracer === "function") {
    CBZ.tracer = function (from, to, opts) {
      if (g.mode === "city" && from && to && CBZ.clearLineOfFire &&
          !CBZ.clearLineOfFire(from.x, from.y, from.z, to.x, to.y, to.z)) {
        return null;   // walled-off shot → no streak, no muzzle flash poking through
      }
      return _origTracer.call(this, from, to, opts);
    };
  }

  // --- wrap cityHurtCop: an armed NPC that just got walled-off (empire crew,
  //     rival gang) can't put a round into a cop through the building either. -
  const _origHurtCop = CBZ.cityHurtCop;
  if (typeof _origHurtCop === "function") {
    CBZ.cityHurtCop = function (cop, dmg, imp) {
      const att = imp && imp.attacker;
      if (att && att._losBlocked && !att.isPlayer && imp && imp.fromX != null) return;
      return _origHurtCop.call(this, cop, dmg, imp);
    };
  }

  // age out the stale aim-target memory so a wandering ped doesn't keep a
  // long-dead "I was shooting at X" flag (cheap, sliced across the crowd).
  CBZ.onUpdate(13, function (dt) {
    if (g.mode !== "city") return;
    const lists = [CBZ.cityPeds, CBZ.cityCops];
    for (let li = 0; li < lists.length; li++) {
      const L = lists[li]; if (!L) continue;
      for (let i = 0; i < L.length; i++) { const a = L[i]; if (a && a._fireTgtT > 0) a._fireTgtT -= dt; }
    }
  });

  // cooldown + stance + combo-window tick
  CBZ.onUpdate(12, function (dt) {
    if (g.mode !== "city") return;
    if (fireCD > 0) fireCD -= dt;
    if (heavyCD > 0) heavyCD -= dt;
    if (staggerT > 0) staggerT -= dt;
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }
    if (parryT > 0) parryT -= dt;
    if (P._fighting > 0) P._fighting -= dt;

    // GUARD stance: RMB held (no gun, on foot) raises a block; while up you're
    // a touch slower and protected. We keep g.invuln OFF (so the wrapped
    // cityHurtPlayer can apply chip/parry); peds.js sees _blocking for AI.
    const wantGuard = rmbDown && !CBZ.cityHasGun() && active() && !P.driving && staggerT <= 0;
    if (wantGuard) {
      if (guardT <= 0) parryT = PARRY_WINDOW;   // just raised → parry window opens
      guardT = 0.12;                            // refresh while held
      P._blocking = 1;
      P.sprint = false;                         // can't sprint while blocking
    } else {
      if (guardT > 0) guardT -= dt;
      if (guardT <= 0) { P._blocking = 0; }
    }
    if (rmbDown) rmbT += dt;

    // bleed off enemy block flags
    for (const c of CBZ.cityCops) if (c._blockT > 0) c._blockT -= dt;
    for (const p of CBZ.cityPeds) if (p._blockT > 0) p._blockT -= dt;
  });

  // ---- input: LMB = light combo, RMB = heavy / hold-guard --------------
  //      Only when unarmed / holding a melee weapon. With a firearm out,
  //      fpsmode.js owns LMB (fire) and RMB (aim). ----
  function active() { return g.mode === "city" && g.state === "playing" && document.pointerLockElement && !P.driving; }

  document.addEventListener("mousedown", function (e) {
    if (!active()) return;
    if (CBZ.cityMenuOpen) return;
    if (CBZ.cityHasGun()) return;            // a gun is out → the engine gun system owns the mouse
    if (e.button === 0) {
      if (fireCD > 0) return;
      e.preventDefault();
      lightAttack();
    } else if (e.button === 2) {
      // RMB with no gun: raise guard immediately; a tap-release also throws a heavy
      e.preventDefault();
      rmbDown = true; rmbT = 0;
      parryT = PARRY_WINDOW; guardT = 0.12; P._blocking = 1;
    }
  });

  document.addEventListener("mouseup", function (e) {
    if (e.button !== 2) return;
    if (!rmbDown) return;
    rmbDown = false;
    // a quick RMB tap (short hold) = a HEAVY swing; a long hold was just a guard
    if (rmbT < 0.22 && active() && !CBZ.cityHasGun() && !CBZ.cityMenuOpen) heavyAttack();
    guardT = Math.min(guardT, 0.06);
  });
})();
