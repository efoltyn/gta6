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

   MELEE. What is thrown and what it costs lives here; HOW a blow lands is
   systems/verbs_strike.js (the swing is a real rig strike that lands on the
   frame the fist meets his jaw, head, liver, ribs or legs):
     • LMB  = LIGHT attack → a 3-hit COMBO (jab → cross → hook) with a
              timing window; the 3rd hit is the FINISHER.
     • RMB  = HEAVY attack (unarmed/melee only) → a looping overhand, costs
              stamina, stagger/knockdown.
     • Hold RMB (no swing) raises a GUARD (the rig's forearms come up); a
              freshly-raised guard is a PARRY window — eat an incoming melee
              blow there and you negate it AND throw a counter hook.
     • Tough NPCs (gang/guard/cop/armed) get their hands up against light
              shots: a head shot lands on the forearms and you eat the
              rebound; a body shot goes under. Punish the cover with a heavy.
     • POSTURE on both sides; a guard-broken or downed foe is finished off.
   Public APIs (cityGiveWeapon/cityAddAmmo/cityCurrentWeapon/cityHasGun) are
   unchanged.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const P = CBZ.player;

  // city weapon name → engine (fpsmode) weapon id
  const GUN_MAP = { Pistol: "sidearm", SMG: "smg", Shotgun: "shotgun", Carbine: "carbine", Rifle: "carbine", Revolver: "revolver", "Desert Eagle": "deagle", "AK-47": "ak47", Uzi: "uzi", Sniper: "sniper", LMG: "lmg", Bazooka: "bazooka", "Rocket Launcher": "bazooka", "Grenade Launcher": "glauncher" };
  const CITY_NAME = {};
  Object.keys(GUN_MAP).forEach((name) => { CITY_NAME[GUN_MAP[name]] = name; });
  CITY_NAME.carbine = "Rifle";
  CITY_NAME.taser = "Taser";
  CITY_NAME.bazooka = "Rocket Launcher";   // the launcher reads as a Rocket Launcher in the city HUD

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

  // ---- POSTURE / POISE (Sekiro-style stagger) -----------------------------
  // Every blow you land builds a target's POSTURE. A blocked/deflected blow
  // builds it less; a perfect PARRY pumps it hard. When posture caps, the foe
  // is GUARD-BROKEN: dropped guard, frozen, wide open — and a close FINISHER
  // becomes a one-shot DEATHBLOW. Max posture is EMERGENT, not hardcoded: it
  // scales off the foe's toughness (rank, armed, aggression, max-hp), so a
  // street nobody crumples in two hits while a boss takes a real beating.
  // YOU have posture too — eating blocks/counters/heavies builds it, and a
  // full bar staggers YOU (guard drops, brief exposed window). This turns
  // melee from HP-attrition into a back-and-forth fight to break the guard.
  const POSTURE_REGEN = 14;        // posture/sec recovered when not being hit
  const POSTURE_REGEN_DELAY = 1.1; // sec after last posture hit before regen
  const BROKEN_TIME = 2.6;         // how long a guard-break stun lasts
  let pPosture = 0;                // player posture (0..pPostureMax)
  let pPostNoHit = 0;             // sec since player last took posture dmg
  let pBrokenT = 0;               // player guard-broken stun timer
  function pPostureMax() {
    // tougher when fresh / well-fed; shrinks as you take HP damage (emergent)
    const hp = P.hp == null ? 100 : P.hp, mhp = P.maxHp || 100;
    return 80 + 40 * (hp / mhp);
  }

  // a foe's MAX posture, derived from what they are (no magic table)
  function postureMax(a) {
    if (!a) return 60;
    let m = 50 + (a.maxHp || 100) * 0.35;       // bigger/tougher = sturdier guard
    if (a.kind === "cop") m += 50;
    if (a.kind === "guard" || a.kind === "security" || a.kind === "warden") m += 40;
    if (a.armed) m += 25;
    if (a.gang) m += 18 * (1 + (a.rank || 0));   // rank-and-file < lieutenants < bosses
    m += (a.aggr || 0) * 30;
    return m;
  }
  // posture a foe currently carries (lazy field, regens in the tick)
  function posture(a) { return a._posture || 0; }
  // add posture damage; returns true if it just BROKE their guard this hit
  function addPosture(a, amt) {
    if (!a || a.dead) return false;
    if (a._broken > 0) return false;            // already broken
    const max = a._postMax || (a._postMax = postureMax(a));
    a._posture = Math.min(max, (a._posture || 0) + amt);
    a._postNoHit = 0;
    if (a._posture >= max) { breakGuard(a); return true; }
    return false;
  }
  // GUARD BREAK: a foe's posture capped → they reel, drop their guard, and are
  // wide open. peds.js already animates a hands-down/stunned look via .stun +
  // we flag .ko-light so the brain pauses; the FINISHER prompt lights up.
  const _brk = { x: 0, z: 1 };
  function breakGuard(a) {
    if (!a || a.dead) return;
    a._broken = BROKEN_TIME;
    a._posture = a._postMax || postureMax(a);
    a.stun = Math.max(a.stun || 0, BROKEN_TIME); // generic stun flag (any reader)
    // freeze their offense for the whole break: peds.js gates every swing/shot on
    // attackCD, so holding it high keeps a guard-broken foe from retaliating while
    // you line up the finisher (a no-touch "stunned & open" state).
    a.attackCD = Math.max(a.attackCD || 0, BROKEN_TIME);
    a.pause = Math.max(a.pause || 0, BROKEN_TIME);
    a.alarmed = Math.max(a.alarmed || 0, 6);
    if (a.char) { a.char.guardBroke = 1; a.char.handsUp = false; a.char.blockT = 0; }
    // he reels: a real step back off his heels (the guard-broken daze pose
    // takes it from there — systems/reactions.js)
    if (CBZ.verbs && CBZ.verbs.react && a.pos) {
      const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
      _brk.x = dx / d; _brk.z = dz / d;
      CBZ.verbs.react(a, { zone: "body", reaction: "stagger", dir: _brk, power: 0.6, stagger: true });
    } else if (CBZ.body && CBZ.body.hit) CBZ.body.hit(a, { fromX: P.pos.x, fromZ: P.pos.z, force: 2.2, knockdown: 0 });
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doHitstop) CBZ.doHitstop(0.11);
    if (CBZ.shake) CBZ.shake(0.45);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.22);
  }

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

  // melee weapon "feel" profile — emergent from the equipped item, not a swing
  // constant. Heavy blunt (Bat) → huge posture damage + knockback; a blade
  // (Knife) → fast, deep HP/bleed, light posture; fists → balanced.
  function weaponFeel() {
    const w = it();
    if (!w || !w.melee) return { post: 1.0, kb: 1.0, bleed: 0, reach: 0, name: "fists" };
    const n = (g.cityMeleeWeapon || "").toLowerCase();
    if (n.indexOf("bat") >= 0 || n.indexOf("pipe") >= 0 || n.indexOf("club") >= 0 || n.indexOf("crowbar") >= 0)
      return { post: 1.9, kb: 1.7, bleed: 0, reach: 0.6, name: "blunt" };
    if (n.indexOf("knife") >= 0 || n.indexOf("machete") >= 0 || n.indexOf("blade") >= 0 || n.indexOf("sword") >= 0)
      return { post: 0.7, kb: 0.8, bleed: 0.5, reach: 0.3, name: "blade" };
    return { post: 1.3, kb: 1.2, bleed: 0.1, reach: 0.4, name: "melee" };
  }

  /* ---- ONE BLOW INTO ONE BODY (systems/vitals.js owns what it does).
     hp stays the brain's "how hurt is he" number, but a melee blow never
     takes it to zero here: a fist or a bat is a daze (a knockout past the
     line), a blade is a bleed (a hole that was going to kill him puts him on
     the floor bleeding hard instead, `critical`). Death comes out of vitals
     alone: a blade in the neck or heart, a man bled out, or a long beating
     of a man already out cold.
     -> "dead" | "ko" | "down" | "knockdown" | "stagger" | "none" | "cut" */
  function bluntName(feel, kind) {
    if (feel.name === "blunt") return "bat";
    if (feel.name === "melee") return "blunt";
    return kind === "low" || kind === "front" || kind === "round" ? "kick" : "fist";
  }
  function meleeHurt(t, dmg, res, heavy, feel, o) {
    const V = CBZ.vitals;
    const fx = P.pos.x, fz = P.pos.z;
    const blade = feel.name === "blade";
    const lethal = (t.hp || 0) - dmg <= 0;
    const clip = Math.max(0, Math.min(dmg, (t.hp || 0) - 1));
    if (t.kind === "cop") CBZ.cityHurtCop(t, clip, { fromX: fx, fromZ: fz, melee: blade ? "blade" : "blunt" });   // armour, heat, "fired upon"
    else t.hp -= clip;
    if (!V) {
      // no vitals in this build: the old sum (a blade kills, a fist knocks out)
      if (lethal && blade) { if (t.kind === "cop") CBZ.cityHurtCop(t, 9999, { fromX: fx, fromZ: fz }); else CBZ.cityKillPed(t, { fromX: fx, fromZ: fz, force: 6 }, "stabbed"); return "dead"; }
      if (lethal && t.kind !== "cop") { CBZ.cityKOPed(t, fx, fz, { rigFall: true }); return "knockdown"; }
      return "none";
    }
    const dir = res && res.dir ? res.dir : null;
    if (blade) {
      const w = V.wound(t, { kind: heavy || (o && o.stab) ? "stab" : "slash", zone: (o && o.zone) || (res && res.zone) || "",
        point: res && res.landed !== false && res.point ? res.point : null, by: CBZ.player, critical: lethal || !!(o && o.critical), fromX: fx, fromZ: fz });
      if (t.dead) return "dead";
      return w.outcome === "down" ? "down" : "cut";
    }
    const r = V.blunt(t, { zone: (o && o.zone) || (res && res.zone) || "head", power: res && res.power != null ? res.power : 0.7,
      weapon: bluntName(feel, res && res.kind), heavy, by: CBZ.player, dirX: dir ? dir.x : fx - t.pos.x, dirZ: dir ? dir.z : fz - t.pos.z,
      mul: o && o.mul, fromX: fx, fromZ: fz });
    return t.dead ? "dead" : r;
  }
  // he went out cold: the street's side of it (the report dies, the desk is
  // left, the block is alarmed) without a second fall on top of vitals' one
  function knockedOut(t) { if (CBZ.cityKOPed) CBZ.cityKOPed(t, P.pos.x, P.pos.z, { rigFall: true }); }

  // ---- weapon-acquisition bridge to the engine gun system ----
  function currentGunName() {
    if (g.cityMeleeWeapon) return null;
    const gun = CBZ.equippedWeapon && CBZ.equippedWeapon();
    return gun ? (CITY_NAME[gun.id || gun.key] || gun.label || gun.id || gun.key) : null;
  }
  function currentWeaponName() { return g.cityMeleeWeapon || currentGunName() || null; }
  function currentWeaponItem() {
    const name = currentWeaponName();
    return name && CBZ.cityEcon ? CBZ.cityEcon.ITEMS[name] || null : null;
  }
  function giveWeapon(name) {
    const item = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    const id = GUN_MAP[name];
    if (!item && !id) return;
    if (id && CBZ.unlockWeapon) {
      // the bat goes on the belt (a cell on the bar), not in the bin
      if (g.cityMeleeWeapon) g.cityMeleeStowed = g.cityMeleeWeapon;
      g.cityMeleeWeapon = null;
      CBZ.unlockWeapon(id, { select: true });   // the EXACT jail gun, now yours
    } else if (item.melee) {
      g.cityMeleeWeapon = name;
      g.cityMeleeStowed = null;
    }
    if (CBZ.city) CBZ.city.note("Equipped " + name, 1.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityGiveWeapon = giveWeapon;
  CBZ.cityAddAmmo = function (n) {
    if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(n);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  CBZ.cityCurrentWeaponName = currentWeaponName;
  CBZ.cityCurrentWeapon = currentWeaponItem;
  // HOLSTERED counts as NO gun drawn (the FIST/holster slot lowers the weapon):
  // gunpointSweep / witness / aim systems read this, so peds no longer throw
  // their hands up at an unarmed/holstered/fists player. Selecting a gun un-holsters.
  // (cuffed: nothing is in your hands, whatever you own — systems/cuffedplayer.js)
  CBZ.cityHasGun = function () { return !g.cityMeleeWeapon && !g.cityHolstered && !(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()) && !!(CBZ.equippedWeapon && CBZ.equippedWeapon()); };
  CBZ.cityOwnsGun = function () {
    return !!((CBZ.weaponInventory && CBZ.weaponInventory.length) || (g._copStow && g._copStow.inv && g._copStow.inv.length));
  };
  CBZ.cityDrawGun = function () {
    if (!g.cityMeleeWeapon || !(CBZ.equippedWeapon && CBZ.equippedWeapon())) return false;
    g.cityMeleeStowed = g.cityMeleeWeapon;
    g.cityMeleeWeapon = null;
    if (CBZ.onWeaponInventoryChanged && CBZ.currentWeaponId) CBZ.onWeaponInventoryChanged(CBZ.currentWeaponId, false);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  function markFighting() { P._fighting = 1.5; }

  /* ---- THE SWING. Every city blow is a real strike (CBZ.verbs.strike,
     systems/verbs_strike.js): the rig throws it, and it lands on the frame the
     fist reaches a body — the jaw, the head, the liver, the ribs, the legs —
     or it does not. The old click-time target cone, the fixed 0.1 s delay and
     the "(reach + 0.7) m grace" are gone; a man who steps back is a whiff, a
     man who puts his hands up takes it on the forearms. Animals and remote
     players (no human rig to meet) are aimed by the cone and resolved on the
     blow's impact beat. */
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || (CBZ.verbs && CBZ.verbs.playerActor && CBZ.verbs.playerActor()); }
  function cityCandidates(out) {
    const cops = CBZ.cityCops, peds = CBZ.cityPeds;
    if (cops) for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (c && !c.dead) out.push(c); }
    if (peds) for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p && !p.dead && !p.vendor && !p.inCar) out.push(p); }
    // bodies another system scores itself (the arena cage opponent): a landed
    // blow is handed to its meleeHit(res, dmg) instead of the street's paths
    const ex = CBZ.cityMeleeTargets;
    if (ex) for (let i = 0; i < ex.length; i++) { const a = ex[i]; if (a && !a.dead) out.push(a); }
    return out;
  }
  // square up to where you are looking (the rig faces +Z at yaw 0; the camera
  // looks down -Z at cam.yaw 0)
  function faceLook() {
    const ch = CBZ.playerChar;
    if (!ch || !CBZ.cam) return;
    const L = lookDir(), yaw = Math.atan2(L.x, L.z);
    ch.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(ch.group.rotation.y, yaw, 0.7) : yaw;
  }
  const BLADE_W = { kind: "knife", blade: true, mass: 0.3 };
  function swing(kind, tier, dmg) {
    const V = CBZ.verbs, pa = playerActor();
    if (!V || !V.strike || !pa) return null;
    const feel = weaponFeel();
    const heavy = tier !== "light";
    // rig-less targets (wildlife, remote players) are picked by the look cone
    const special = aimSpecial(heavy ? 2.1 : 1.95, 0.3);
    faceLook();
    const S = V.strike(pa, special, {
      kind, heavy,
      weapon: feel.name === "blade" ? BLADE_W : null,
      candidates: special ? null : cityCandidates,
      onLand: function (res) { landCity(res, dmg, tier, kind); },
      onBlocked: function (res) { blockedCity(res, dmg, kind); },
      onBeat: special ? function () { landSpecial(special, dmg, tier); } : null,
    });
    if (!S) return null;
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();   // the first-person fist runs the same beat off the rig's clock
    // TOUGH NPCs GET THEIR HANDS UP. What was a hidden block roll on the
    // damage is now a guard in front of his face: a head shot lands on his
    // forearms (and you eat the rebound), a body shot goes under it, and a
    // heavy is thrown before he can cover.
    const T = S.aimT;
    if (T && !heavy && isTough(T) && !(T._broken > 0) && !(T.ko > 0) && !(T.hp <= (T.maxHp || 100) * 0.3) &&
        !(CBZ.body && CBZ.body.busy && CBZ.body.busy(T))) {
      const pf = posture(T) / (T._postMax || postureMax(T));
      const blockChance = (T.kind === "cop" ? 0.34 : (T.gang ? 0.30 : 0.22)) * (1 - pf * 0.4);
      if (Math.random() < blockChance) V.block(T, 0.5);
    }
    return S;
  }
  function aimSpecial(range, cone) {
    const Pp = P.pos, L = lookDir();
    let best = null, bd = range;
    const consider = (a) => {
      if (!a || a.dead) return;
      const dx = a.pos.x - Pp.x, dz = a.pos.z - Pp.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.2) return;
      if ((dx / d) * L.x + (dz / d) * L.z < cone) return;
      if (d < bd) { bd = d; best = a; }
    };
    if (CBZ.cityWildlife) for (const w of CBZ.cityWildlife) consider(w);
    if (CBZ.net && CBZ.net.active && CBZ.net.targetList) for (const a of CBZ.net.targetList()) consider(a);
    return best;
  }
  // a guard-broken OR downed foe in finisher range, in front of you
  function aimTarget(range, cone) {
    const Pp = P.pos, L = lookDir();
    let best = null, bd = range;
    const consider = (a) => {
      if (!a || a.dead) return;
      const dx = a.pos.x - Pp.x, dz = a.pos.z - Pp.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.2) return;
      const dot = (dx / d) * L.x + (dz / d) * L.z;
      if (dot < cone) return;
      let score = d - dot * 6;
      if (a === lastTarget) score -= 3;
      if (score < bd) { bd = score; best = a; }
    };
    for (const c of CBZ.cityCops) consider(c);
    for (const p of CBZ.cityPeds) if (!p.vendor) consider(p);
    return best;
  }

  // a clean, GTA-style stagger pop on the player when you eat a block/counter
  function selfStagger(t) {
    staggerT = Math.max(staggerT, t);
    P.stun = Math.max(P.stun || 0, t * 0.8);
    if (CBZ.shake) CBZ.shake(0.28);
    if (CBZ.sfx) CBZ.sfx("step");
  }

  // build the PLAYER's posture (eating blocks, counters, heavy blows). Cap it
  // and YOUR guard shatters: you drop, exposed, for BROKEN_TIME — the same
  // win-condition your foes face, applied to you. Stamina cushions it: a fresh
  // fighter resets posture faster (handled in the regen tick).
  function addSelfPosture(amt) {
    if (pBrokenT > 0) return;
    pPosture = Math.min(pPostureMax(), pPosture + amt);
    pPostNoHit = 0;
    if (pPosture >= pPostureMax()) {
      pBrokenT = BROKEN_TIME * 0.7;             // a touch shorter than NPC stun
      pPosture = pPostureMax();
      staggerT = Math.max(staggerT, pBrokenT);
      guardT = 0; parryT = 0; P._blocking = 0;  // guard's gone
      P.stun = Math.max(P.stun || 0, pBrokenT * 0.6);
      if (CBZ.sfx) CBZ.sfx("ko");
      if (CBZ.shake) CBZ.shake(0.5);
      if (CBZ.doHitstop) CBZ.doHitstop(0.1);
    }
  }
  // expose posture state for the HUD (read-only snapshot, no allocations/frame)
  CBZ.cityPosture = function () { return { p: pPosture, max: pPostureMax(), broken: pBrokenT > 0 }; };

  // his forearms took it: the guard still wears (posture chip), and the
  // rebound comes back up your arm
  function blockedCity(res, dmg, kind) {
    const t = res.target;
    if (!t || t.dead || g.mode !== "city") return;
    if (t.meleeHit) t.meleeHit(res, dmg * res.dmgMul, "blocked");
    else {
      if (CBZ.verbs && CBZ.verbs.block) CBZ.verbs.block(t, 0.7);   // he is covering → punish it with a heavy
      addPosture(t, dmg * 0.22 * weaponFeel().post);
    }
    if (CBZ.sfx) CBZ.sfx("hit");
    addSelfPosture(10);
    if (Math.random() < 0.5) selfStagger(0.30);
    combo = 0; comboT = 0;
    lastTarget = t;
    void kind;
  }
  // animals and remote players: resolved on the blow's beat, by reach
  function landSpecial(t, dmg, tier) {
    if (!t || t.dead || P.dead || g.mode !== "city") return;
    const dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z;
    if (dx * dx + dz * dz > 2.3 * 2.3) return;          // he moved out of it
    if (CBZ.meleeScale) dmg *= CBZ.meleeScale(P, t);
    if (t.netKind && CBZ.net && CBZ.net.localMeleeHit) { CBZ.net.localMeleeHit(t, dmg, tier); return; }
    if (t.animal) {
      const heavyA = tier !== "light";
      if (CBZ.doHitstop) CBZ.doHitstop(heavyA ? 0.08 : 0.05);
      if (CBZ.shake) CBZ.shake(heavyA ? 0.4 : 0.22);
      const r = CBZ.cityWildlifeHit ? CBZ.cityWildlifeHit(t, { head: false, point: null }, { damage: dmg }) : null;
      if (CBZ.sfx) { CBZ.sfx("punch"); CBZ.sfx(r && r.down ? "ko" : "hit"); }
      if (CBZ.fpsPunchLanded) CBZ.fpsPunchLanded("cross", heavyA);
      lastTarget = t.dead ? null : t;
    }
  }

  // ---- the connect: damage and consequences for a blow that met a body ----
  // tier: "light" | "heavy" | "finisher".
  function landCity(res, dmg, tier, kind) {
    const t = res.target;
    if (!t || t.dead || P.dead || g.mode !== "city") { res.reaction = "none"; return; }
    if (t.meleeHit) {
      t.meleeHit(res, dmg * res.dmgMul, tier);
      if (CBZ.sfx) CBZ.sfx("punch");
      if (CBZ.fpsHitMarker) CBZ.fpsHitMarker(false, false);
      return;
    }
    /* THE SAME BLOW IS NOT THE SAME BLOW. `dmg` describes the swing; WHERE it
       landed (res.dmgMul: jaw 1.3, liver 1.25, head 1, body 0.8, legs 0.6)
       and WHO it landed on (systems/bodymass.js — adult on adult is 1.0)
       finish the sum. */
    dmg *= res.dmgMul;
    if (CBZ.meleeScale) dmg *= CBZ.meleeScale(P, t);
    const fx = P.pos.x, fz = P.pos.z;
    const heavy = tier !== "light";
    const finisher = tier === "finisher";
    const feel = weaponFeel();
    const broken = (t._broken || 0) > 0;        // foe is guard-broken & wide open
    // punishing a covering enemy with a heavy = COUNTER (bonus dmg + a knockdown)
    // (his guard is his rig's: ch.blockT, raised by CBZ.verbs.block)
    const counter = heavy && !!(t.char && t.char.blockT > 0) && !broken;
    if (counter) { dmg = Math.round(dmg * 1.6); t.char.blockT = 0; }
    // a broken foe eats EVERYTHING amplified — this is the payoff window
    if (broken) dmg = Math.round(dmg * 1.55);
    // --- POSTURE damage: how much this blow batters their guard. Capping it =
    // GUARD BREAK (addPosture → breakGuard), the real win condition.
    if (!broken && !(t.hp - dmg <= 0)) {
      const postDmg = (finisher ? 34 : (counter ? 40 : (heavy ? 26 : 11 + combo * 3))) * feel.post;
      addPosture(t, postDmg);
    }
    if (finisher && CBZ.doHitstop) CBZ.doHitstop(0.14);
    if (CBZ.shake) CBZ.shake(finisher ? 0.7 : (heavy ? 0.5 : 0.22 + combo * 0.04));
    // --- what the blow did to his BODY (systems/vitals.js): a fist or a bat
    //     dazes and knocks out, a blade opens a bleed. No fist kills a man on
    //     his feet; beating a man who is already out is the only way it does.
    const out = meleeHurt(t, dmg, res, heavy, feel);
    if (out === "dead") res.reaction = "dead";
    else if (out === "ko" || out === "down") res.reaction = "none";          // vitals put him down in his own rig
    else {
      if (out === "knockdown" || finisher || counter || broken) {
        if (t.kind === "cop" && CBZ.body) {
          // a cop has no count of his own: the body layer owns his fall
          CBZ.body.hit(t, { fromX: fx, fromZ: fz, force: (finisher ? 9 : 6.5) * feel.kb, knockdown: 1.1 });
          res.reaction = "none";
        } else {
          t.ko = Math.max(t.ko || 0, 5); t.alarmed = 6;
          res.reaction = "knockdown";
        }
      }
      if (t.kind !== "cop") {
        // provoke / alarm so the world reacts to a non-lethal beating
        if (t.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(t.gang, 0.4);
        CBZ.cityCrime && CBZ.cityCrime(heavy ? 60 : 40, { x: t.pos.x, z: t.pos.z, type: "assault" });
        if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "fight", pos: t.pos, radius: 10, intensity: 0.6 });
        // SIZE-UP (sizeup.js): a survivor reads who just hit them
        if (CBZ.citySizeUpHit && CBZ.city && CBZ.city.playerActor) CBZ.citySizeUpHit(t, CBZ.city.playerActor);
      }
    }
    if (out === "ko" && t.kind !== "cop" && !t.dead) knockedOut(t);
    if (CBZ.sfx) CBZ.sfx("punch");
    const downed = (t.dead || t.ko > 0);
    // THE SAME CONFIRMATION A BULLET GETS: the hit marker (red on a kill);
    // verbs_strike jolts the first-person fist on the same frame.
    if (CBZ.fpsHitMarker) CBZ.fpsHitMarker(!!t.dead, false);
    if (downed && (finisher || heavy)) {
      if (CBZ.sfx) CBZ.sfx("ko");
      if (CBZ.doSlowmo) CBZ.doSlowmo(finisher ? 0.5 : 0.28);   // brief bullet-time on a knockout
    } else if (CBZ.sfx) {
      CBZ.sfx("hit");
    }
    if (tier === "finisher") { combo = 0; comboT = 0; }
    lastTarget = t.dead ? null : t;
  }

  // find a guard-broken OR downed foe in finisher range (close, in front)
  function finisherTarget() {
    const t = aimTarget(1.82, 0.1);
    if (!t) return null;
    const open = (t._broken || 0) > 0 || (t.ko > 0 && !t.dead) || (CBZ.vitals && CBZ.vitals.cuffable(t)) ||
                 (CBZ.body && CBZ.body.busy && CBZ.body.busy(t) && t.hp <= (t.maxHp || 100) * 0.45);
    return open ? t : null;
  }

  // ---- DEATHBLOW / FINISHER: a single brutal execution on an open foe ------
  // A guard-broken man on his feet takes it where the fist meets him; a man on
  // the ground takes it on the blow's beat (the fist comes down on him).
  function doFinisher(t) {
    if (!t || t.dead) return;
    const V = CBZ.verbs, pa = playerActor();
    markFighting();
    combo = 0; comboT = 0;
    spend(7);
    const feel = weaponFeel();
    const down = t.ko > 0 || (CBZ.body && CBZ.body.busy && CBZ.body.busy(t)) || (CBZ.vitals && CBZ.vitals.cuffable(t));
    faceLook();
    const S = V && V.strike && pa ? V.strike(pa, down ? null : t, {
      kind: feel.name === "blade" ? "stab" : (down ? "overhand" : "upper"), heavy: true,
      lunge: !down, weapon: feel.name === "blade" ? BLADE_W : null,
      onLand: function (res) { if (res.target === t) { finishOff(t, feel, res); res.reaction = t.dead ? "dead" : "none"; } },
      onBeat: down ? function () { finishOff(t, feel, null); } : null,
    }) : null;
    if (!S) finishOff(t, feel, null);            // no rig to swing: resolve it now
    else if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
    fireCD = 0.55; heavyCD = 0.3;
  }
  /* THE FINISHER IS A BLOW, NOT A DEATH SENTENCE. With fists (or a bat) it is
     the biggest blunt blow you can throw: a man on his feet with his guard
     broken goes out cold; a man already out takes it as one more blow to a
     head that cannot defend itself (vitals counts those, and enough of them
     kill). With a blade it is a real stab, down into the neck or the chest:
     it opens a bad bleed and may find the artery or the heart. */
  const _finRes = { zone: "head", point: null, power: 1, kind: "overhand", dir: { x: 0, z: 0 }, landed: false };
  function finishOff(t, feel, res) {
    if (!t || t.dead || g.mode !== "city") return;
    const dx = t.pos.x - P.pos.x, dz = t.pos.z - P.pos.z;
    if (dx * dx + dz * dz > 2.4 * 2.4) return;
    const blade = feel.name === "blade";
    const d = Math.hypot(dx, dz) || 1;
    const r = res || _finRes;
    if (!res) { _finRes.dir.x = dx / d; _finRes.dir.z = dz / d; _finRes.landed = false; }
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.4);
    if (CBZ.doHitstop) CBZ.doHitstop(0.16);
    if (CBZ.shake) CBZ.shake(0.8);
    const base = (it() && it().dmg) || 16;
    const wasDown = CBZ.vitals ? CBZ.vitals.cuffable(t) : t.ko > 0;
    const out = blade
      ? meleeHurt(t, base * 2.6, r, true, feel, { stab: true, zone: Math.random() < 0.4 ? "neck" : "chest", critical: wasDown })
      : meleeHurt(t, base * 1.9, r, true, feel, { zone: wasDown ? "head" : (r.zone === "jaw" ? "jaw" : "head"), mul: wasDown ? 1.6 : 1.5 });
    if (out === "ko" && !wasDown && t.kind !== "cop") knockedOut(t);
    if (!t.dead && !wasDown && out !== "ko" && out !== "down" && CBZ.body) {
      CBZ.body.hit(t, { fromX: P.pos.x, fromZ: P.pos.z, force: 9 * feel.kb, knockdown: 1.3 });
    }
    if (CBZ.sfx) CBZ.sfx("ko");
    if (t.dead && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);   // a brutal finish earns respect
    lastTarget = t.dead ? null : t;
  }

  /* ---- A BODY ON THE GROUND STILL TAKES IT. The street's melee only ever
     looked at the living, so a knife into a corpse was a whiff. Now a swing
     with nobody standing in front of you finds the dead man at your feet:
     a blade puts another hole in him (CBZ.corpseStab: the cut, a spatter,
     another ooze into his pool), a fist or a boot just shoves him where he
     lies, with no mark. */
  function corpseTarget(range) {
    const Pp = P.pos, L = lookDir();
    let best = null, bd = range * range;
    const consider = (a) => {
      if (!a || !a.dead || !a.pos || !a.group || a.inCar || a._parked) return;
      if (Math.abs((a.pos.y || 0) - (Pp.y || 0)) > 1.6) return;
      const dx = a.pos.x - Pp.x, dz = a.pos.z - Pp.z, dd = dx * dx + dz * dz;
      if (dd > bd || dd < 0.0001) return;
      const dl = Math.sqrt(dd);
      if ((dx / dl) * L.x + (dz / dl) * L.z < 0.35) return;
      bd = dd; best = a;
    };
    const peds = CBZ.cityPeds, cops = CBZ.cityCops;
    if (peds) for (let i = 0; i < peds.length; i++) consider(peds[i]);
    if (cops) for (let i = 0; i < cops.length; i++) consider(cops[i]);
    return best;
  }
  const _cpP = { x: 0, y: 0, z: 0 }, _cpD = { x: 0, y: 0, z: 0 };
  function hitCorpse(c, blade) {
    if (!c || !c.dead || !c.group) return;
    const dx = c.pos.x - P.pos.x, dz = c.pos.z - P.pos.z;
    if (dx * dx + dz * dz > 2.4 * 2.4) return;          // it is not where you swung
    const d = Math.hypot(dx, dz) || 1;
    _cpD.x = dx / d; _cpD.y = -0.4; _cpD.z = dz / d;
    // where the blow goes in: the part of him nearest the swing, on the ground
    const gp = c.group.position;
    _cpP.x = gp.x - _cpD.x * 0.12 + (Math.random() - 0.5) * 0.3;
    _cpP.y = (gp.y || 0) + 0.2 + Math.random() * 0.12;
    _cpP.z = gp.z - _cpD.z * 0.12 + (Math.random() - 0.5) * 0.3;
    if (blade) {
      let took = false;
      if (CBZ.corpseStab) { try { took = !!CBZ.corpseStab(c, _cpP, _cpD, { by: CBZ.player }); } catch (e) { took = false; } }
      if (!took) {
        if (CBZ.cityCorpseHit) { try { CBZ.cityCorpseHit(c, _cpP, _cpD, 2, { wound: false }); } catch (e) { /* ragdoll off */ } }
        if (CBZ.bodyWound) { try { CBZ.bodyWound(c, _cpP, { melee: "blade", dir: _cpD }); } catch (e) { /* wounds off */ } }
        if (CBZ.vitals) CBZ.vitals.wound(c, { kind: "stab", point: _cpP, by: CBZ.player });
      }
      if (CBZ.sfx) CBZ.sfx("hit");
    } else {
      // a boot into a body: it moves, nothing else
      let moved = false;
      if (c._bf && c._bf.on && CBZ.bodyFall && CBZ.bodyFall.poke) moved = CBZ.bodyFall.poke(c, _cpD.x, _cpD.z, 6, _cpP);
      if (!moved && CBZ.cityCorpseHit) { try { CBZ.cityCorpseHit(c, _cpP, _cpD, 5, { wound: false }); } catch (e) { /* ragdoll off */ } }
      if (CBZ.sfx) CBZ.sfx("punch");
    }
    if (CBZ.shake) CBZ.shake(0.18);
  }
  function corpseSwing(c, heavy) {
    const V = CBZ.verbs, pa = playerActor();
    const blade = weaponFeel().name === "blade";
    markFighting();
    combo = 0; comboT = 0;
    faceLook();
    const S = V && V.strike && pa ? V.strike(pa, null, {
      kind: blade ? "stab" : "low", heavy: !!heavy, weapon: blade ? BLADE_W : null,
      onBeat: function () { hitCorpse(c, blade); },
    }) : null;
    if (!S) return false;
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
    spend(heavy ? 8 : 4);
    fireCD = heavy ? 0.5 : 0.32;
    return true;
  }

  // a swing that finds nobody can still find the world: a harvest node, a window
  function swingAtWorld(heavy) {
    if (CBZ.resourceHarvestSwing && CBZ.resourceHarvestSwing()) return;   // B7: tree/rock/scrap node
    if (CBZ.cityShatterRay) {
      // first punch spider-cracks a window, the next blows it out; a heavy goes straight through
      const L2 = lookDir();
      CBZ.cityShatterRay(P.pos.x, (P.pos.y || 0) + 1.5, P.pos.z, L2.x, 0, L2.z, heavy ? 3.0 : 2.7, !!heavy, { directPlayer: true });
    }
  }

  // ---- LIGHT attack: chains jab → cross → hook (3rd = finisher) -----------
  function lightAttack() {
    if (pBrokenT > 0) return;                    // you're guard-broken, can't swing
    if (staggerT > 0 || tired()) return;         // gassed: the guard sags (ch.winded), the fists stay home
    // an open foe in front → DEATHBLOW instead of a jab
    const fin = finisherTarget();
    if (fin) { doFinisher(fin); return; }
    if (!aimTarget(2.1, 0.3)) { const c = corpseTarget(1.9); if (c) { corpseSwing(c, false); return; } }
    markFighting();
    const next = (comboT > 0 && combo < 3) ? combo + 1 : 1;
    const finisher = next >= 3;
    const kind = finisher ? "hook" : KINDS[(next - 1) % 3];
    const base = it() ? it().dmg : 16;
    // jab/cross scale up through the chain; the hook (3rd) is the big one
    const dmg = finisher ? Math.round(base * 1.9) : Math.round(base * (1 + (next - 1) * 0.18));
    const S = swing(kind, finisher ? "finisher" : "light", dmg);
    if (!S) return;                              // the last swing still owns the fists
    combo = next; comboT = COMBO_WINDOW;
    spend(finisher ? 9 : 5);
    if (!S.aimT) swingAtWorld(false);
    fireCD = finisher ? 0.34 : 0.22;
  }

  // ---- HEAVY attack: slow, costly, staggers/knocks down -------------------
  function heavyAttack() {
    if (pBrokenT > 0) return;                    // guard-broken — can't swing
    if (heavyCD > 0 || staggerT > 0) return;
    if (tired()) return;
    const fin = finisherTarget();
    if (fin) { doFinisher(fin); return; }
    if (!aimTarget(2.1, 0.3)) { const c = corpseTarget(1.9); if (c) { corpseSwing(c, true); heavyCD = 0.5; return; } }
    markFighting();
    combo = 0; comboT = 0;
    const base = it() ? it().dmg : 16;
    const S = swing("overhand", "heavy", Math.round(base * 2.4));   // a big looping overhand
    if (!S) return;
    spend(16);
    if (!S.aimT) swingAtWorld(true);
    heavyCD = 0.6;
    fireCD = 0.5;
  }

  function it() { return currentWeaponItem(); }

  // SWING ON HIM (city/interact.js "Swing on", the cop-assault verb): a
  // committed sucker punch — a full cross with the hips in it, thrown at the
  // man you named, resolved exactly like a left-click.
  CBZ.citySwingOn = function (t) {
    if (!t || t.dead || P.dead || pBrokenT > 0 || CBZ.cityHasGun()) return false;
    markFighting();
    const V = CBZ.verbs, pa = playerActor();
    if (!V || !V.strike || !pa) return false;
    const base = it() ? it().dmg : 16, dmg = Math.round(base * 2.0);
    const feel = weaponFeel();
    const S = V.strike(pa, t, { kind: "cross", heavy: true, weapon: feel.name === "blade" ? BLADE_W : null,
      onLand: function (res) { landCity(res, dmg, "heavy", "cross"); },
      onBlocked: function (res) { blockedCity(res, dmg, "cross"); } });
    if (!S) return false;
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
    combo = 0; comboT = 0; spend(8);
    fireCD = 0.4;
    return true;
  };

  // ============================================================
  //  GUARD / PARRY: holding RMB (with no gun) raises a block.
  //  We intercept incoming melee damage so a guard chips, and a
  //  fresh guard (parry window) negates the blow AND counters.
  //  cityHurtPlayer is wrapped (call-through preserved).
  // ============================================================
  const _origHurt = CBZ.cityHurtPlayer;
  if (typeof _origHurt === "function") {
    CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal, hit) {
      // NPC-fire LOS gate: an armed NPC whose muzzle was walled off this shot
      // can't land a round on you through the building. Their gun got lowered in
      // the actorMuzzle wrap; here we make the damage agree with the visual.
      if (attacker && attacker._losBlocked && fromX != null && !attacker.isPlayer) return;
      // only melee-range threats are parryable/blockable (guns/cars unaffected)
      const meleeRange = (fromX != null) && (Math.hypot((fromX) - P.pos.x, (fromZ) - P.pos.z) < 2.25);
      if (guardT > 0 && !headshot && meleeRange && !P.dead && pBrokenT <= 0) {
        if (parryT > 0) {
          // PERFECT PARRY / DEFLECT → negate, slam the attacker's POSTURE (Sekiro:
          // a deflect barely dents you but wrecks them), riposte, bullet-time.
          parryT = 0; guardT = Math.max(guardT, 0.25);
          pPosture = Math.max(0, pPosture - 20);     // a clean deflect steadies you
          // (no toast — the hitstop + slowmo + riposte SELL the parry)
          if (CBZ.sfx) { CBZ.sfx("hit"); }
          if (CBZ.shake) CBZ.shake(0.4);
          if (CBZ.doHitstop) CBZ.doHitstop(0.08);
          if (CBZ.doSlowmo) CBZ.doSlowmo(0.22);
          if (CBZ.playerChar) CBZ.playerChar.blockHitT = 0.2;   // it came off your forearms
          if (attacker && attacker.pos && !attacker.dead) {
            attacker._windup = 0;                     // their swing is spent
            // a deflect alone deals heavy posture damage — repeated parries break them
            addPosture(attacker, 38 + weaponFeel().post * 18);
            // THE RIPOSTE IS A REAL HOOK, thrown into the opening: it lands where
            // the fist meets him (it is a blow, not a number applied on the parry)
            const base = (it() && it().dmg) || 16, rdmg = Math.round(base * 1.8);
            const V = CBZ.verbs, pa = playerActor();
            if (V && V.strike && pa) {
              V.strike(pa, attacker, { kind: "hook", heavy: true,
                onLand: function (res) { landCity(res, rdmg, "heavy", "hook"); },
                onBlocked: function (res) { blockedCity(res, rdmg, "hook"); } });
              if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
            }
          }
          return;   // blow fully negated
        }
        // normal BLOCK → big chip reduction + no knockdown, costs stamina, and
        // it builds YOUR posture (a held guard erodes — you must parry, not turtle).
        if (CBZ.playerChar) CBZ.playerChar.blockHitT = 0.2;     // the forearms give with it
        dmg *= 0.3; spend(10);
        if (hit) hit.power = (hit.power != null ? hit.power : 0.6) * 0.3;   // the forearms took the daze too
        addSelfPosture(16 + dmg * 0.25);
        if (CBZ.shake) CBZ.shake(0.2);
        if (CBZ.sfx) CBZ.sfx("hit");
        // (reduced dmg falls through to the original handler below)
      } else if (meleeRange && !headshot && attacker && attacker.pos && !attacker.isCar && pBrokenT <= 0 && dmg < 40) {
        // an unguarded ped/cop melee hit (not a car/heavy source) nudges your
        // posture, so a sustained flurry can break your guard even if you don't block.
        addSelfPosture(8);
      }
      // taking damage while guard-broken stings extra (you're reeling, exposed)
      if (pBrokenT > 0 && meleeRange && !headshot) dmg *= 1.35;
      return _origHurt.call(this, dmg, fromX, fromZ, reason, headshot, attacker, nonlethal, hit);
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

  // ============================================================
  //  NPC AIM V2 — make NPCs visibly POINT the gun at what they shoot.
  //
  //  THE BUG: actorweapons.js's poseList (onUpdate 36) hard-sets every armed
  //  NPC's gun arm to a FIXED horizontal pose (-1.45/-1.50 rad) every frame —
  //  no pitch toward the target, ever. The ballistics (clearLineOfFire, hit
  //  rolls, tracers) are fully 3D, so a cop firing at a rooftop target shot
  //  correctly while his gun pointed at the horizon. reactions.js (order 89)
  //  half-fixes this but ONLY for actors with `.rage` — cops (curTarget) and
  //  empire crew never get elevation.
  //
  //  THE FIX, two places sharing one solver:
  //    • inside the actorAimAt wrap (fire paths call aimAt → actorMuzzle →
  //      tracer back-to-back): re-pitch the arm IMMEDIATELY after the orig
  //      set the flat ready pose, so the muzzle world-matrix the shot reads
  //      agrees with the aimed pose;
  //    • an onUpdate(90.5) pass (after poseList@36, reactions@89, grapple@90
  //      — the LAST arm writer before render): smooth + re-assert the pitch
  //      every frame so the aim persists between cooldown-gated shots. It
  //      hard-SETS rotation.x = flatBase + elev, so reactions' additive term
  //      is absorbed (no double-pitch on rage gang peds) and when the target
  //      ages out the value decays exactly back to poseList's flat base
  //      (pop-free hand-off). Only rotation.x of ra (+ la for slot "long")
  //      is owned here — head/neck/body channels stay with their owners.
  //
  //  Tracer realism rides the same pass (see the tracer wrap): per-weapon
  //  angular jitter around the true muzzle→target line, clipped against the
  //  LOS grid so a spread round never pokes through a wall.
  // ============================================================
  if (CBZ.CONFIG.NPC_AIM_V2 == null) CBZ.CONFIG.NPC_AIM_V2 = true;             // gun-arm elevation toward target
  if (CBZ.CONFIG.NPC_TRACER_SPREAD == null) CBZ.CONFIG.NPC_TRACER_SPREAD = true; // per-shot bullet spread on NPC tracers
  // ============================================================
  //  NPC_COMBAT_IQ — the master switch for HOW WELL A PERSON FIGHTS
  //  (systems/combat_iq.js: the role x weapon competence table, real
  //  collider-derived cover, the shooter token that stops a crew firing all at
  //  once, unprovoked openings, and the punch exchange). Declared HERE as well
  //  as in the module itself so the flag exists whichever of the two a stripped
  //  build happens to load — the null-check makes both writes idempotent, and
  //  every consumer reads it at CALL time, never caching it at load.
  //  ?cfg_NPC_COMBAT_IQ=0 restores the pre-wave brains exactly.
  // ============================================================
  if (CBZ.CONFIG.NPC_COMBAT_IQ == null) CBZ.CONFIG.NPC_COMBAT_IQ = true;

  const AIM_ELEV_MAX = 0.70;   // rad (~40°) arm pitch clamp (reactions used 0.55; raised for rooftops)
  const AIM_DAMP = 0.0008;     // damp base → ~130ms acquire/release blend (k = 1 - AIM_DAMP^dt)
  const AIM_HOLD = 1.2;        // s the arm holds its aim after the last shot (> max NPC fire cadence)
  const AIM_SHOULDER_Y = 1.25; // shoulder height above actor.pos.y — character.js arm pivot (1.78 local since the TORSO block; was 1.84) × HUMAN_SCALE 0.70 for the shrunk ~1.82m rig (was 1.84, aimed the gun-arm ~0.55m high)
  const RA_BASE = -1.45, RA_BASE_LONG = -1.50, LA_BASE_LONG = -1.20; // MUST match actorweapons setReadyPose
  // per-slot tracer spread half-angle (rad); table lives with the weapon data
  const SPREAD_DEF = { pistol: 0.065, rifle: 0.040, auto: 0.090, long: 0.075, utility: 0.055, _def: 0.055 };
  const SPREAD_CENTER_FRAC = 0.55; // fraction of shots drawn tight (statistical "hit" look)
  const SPREAD_CENTER_MUL = 0.30;  // spread multiplier for a centered shot

  function slotOf(a) {
    const ud = a && a._weaponProp && a._weaponProp.userData;
    return (ud && ud.weaponSlot) || "pistol";
  }
  // mirror poseList's (actorweapons.js, order 36) exact "gun is out & posed"
  // gate — we may only own the arm on frames poseList just hard-set it.
  function poseEligible(a) {
    if (!a || a.dead || a._parked || (a.ko > 0) || !a.armed) return false;
    if (!a.char || !a.char.parts) return false;
    if (!a._weaponProp || !a._weaponProp.visible) return false;
    if (a._holstered || a._gunLowered || a._gunHidden) return false;
    if (a.surrender || (a.surrenderT || 0) > 0 || a.char.surrender || a.char.handsUp) return false;
    if (a.restraint) return false;   // wrists zip-tied behind the back (restrain.js) — never lift the gun arm
    const ph = a._phys;
    if (ph && (ph.down > 0 || ph.air || ph.heldBy)) return false;   // ragdolling — body.js owns the limbs
    return true;
  }
  // desired arm-pitch delta (rad, negative = barrel up) toward the aim target —
  // the SAME chest point the ballistics use (1.5 player / 1.3 NPC), solved from
  // the actual shoulder world height so slopes/rooftops elevate correctly.
  function computeArmC(a) {
    const t = a._aimTgt;
    if (!t || !t.pos || t.dead || (a._aimTgtT || 0) <= 0) return 0;
    const hd = Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z) || 0.001;
    const ty = (t.pos.y || 0) + (t.isPlayer ? 1.05 : 0.91);  // target chest height × HUMAN_SCALE (was 1.5 / 1.3)
    let armC = -Math.atan2(ty - ((a.pos.y || 0) + AIM_SHOULDER_Y), hd);
    if (armC > AIM_ELEV_MAX) armC = AIM_ELEV_MAX;
    else if (armC < -AIM_ELEV_MAX) armC = -AIM_ELEV_MAX;
    return armC;
  }
  // hard-SET the gun arm to flatBase + smoothed elevation. dt>0 advances the
  // damp (the 90.5 pass); dt<=0 re-asserts the current value (fire-time call,
  // so the muzzle matrix agrees with the rendered pose). Writes NOTHING unless
  // this actor is actively aiming (or easing back), so rage-only actors keep
  // reactions.js's elevation and idle armed peds keep poseList's flat pose.
  function applyAimPose(a, dt) {
    if (!CBZ.CONFIG.NPC_AIM_V2) return;
    if (!poseEligible(a)) { a._aimElevCur = 0; return; }
    const engaged = a._aimTgt && (a._aimTgtT || 0) > 0;
    if (!engaged && Math.abs(a._aimElevCur || 0) < 0.002) { a._aimElevCur = 0; return; }
    // disengaged but still ENRAGED → reactions.js's own aim-presence term
    // (order 89, rage actors only) is already at full value under our write —
    // hand the arm straight back to it instead of decaying over its head.
    if (!engaged && a.rage && !a.rage.dead && a.rage.pos) { a._aimElevCur = 0; return; }
    if (dt > 0) {
      const want = computeArmC(a);
      const k = 1 - Math.pow(AIM_DAMP, dt);
      a._aimElevCur = (a._aimElevCur || 0) + (want - (a._aimElevCur || 0)) * k;
    }
    const cur = a._aimElevCur || 0;
    // A GUN HELD BY THE HOLD ENGINE (systems/actorweapons.js CBZ.gunHold): the
    // ready pose is a solved 3D pose, not the flat -1.45 these constants
    // assume, so hard-setting rotation.x on it would tear the hands off the
    // gun. The hold re-asserts its pose, pitches the gun arm by the elevation
    // and (a long gun) re-solves the off hand onto the pitched gun.
    if (CBZ.gunHold && a._weaponProp && CBZ.gunHold.pitchNpc(a.char, a._weaponProp, cur)) return;
    const parts = a.char.parts;
    const isLong = slotOf(a) === "long";   // poseList's narrow test — its base is what we offset
    if (parts.ra) parts.ra.rotation.x = (isLong ? RA_BASE_LONG : RA_BASE) + cur;
    if (isLong && parts.la) parts.la.rotation.x = LA_BASE_LONG + cur;
  }

  // --- tracer spread: identify the shooter from inside the tracer wrap. The
  // fire paths call actorMuzzle then tracer back-to-back with the same point,
  // so the muzzle wrap stashes {shooter, muzzle} and the tracer wrap matches
  // its `from` against it (consumed either way — never goes stale/misfires).
  const _pendingShot = { a: null, x: 0, y: 0, z: 0 };
  const _jitTo = { x: 0, y: 0, z: 0 };
  let _spreadRC = null;   // lazy THREE.Raycaster (reused, no per-shot alloc)

  // jitter the endpoint around the true muzzle→target direction by a per-slot
  // angle, then clip the JITTERED ray against the LOS grid so a spread round
  // that now grazes a corner ends at the wall instead of poking through it.
  function jitterEndpoint(from, to, slot, shooter) {
    let dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz) || 0.001;
    dx /= dist; dy /= dist; dz /= dist;
    // perpendicular basis u,v around the fire direction
    let ux = -dz, uz = dx;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-4) { ux = 1; uz = 0; } else { ux /= ul; uz /= ul; }
    const vx = dy * uz, vy = dz * ux - dx * uz, vz = -dy * ux;   // dir × u
    const tbl = CBZ.NPC_SPREAD || SPREAD_DEF;
    let s = tbl[slot] != null ? tbl[slot] : (tbl._def != null ? tbl._def : SPREAD_DEF._def);
    // THE STREAK SHOULD LOOK LIKE THE SHOOTER. The spread was per-WEAPON only,
    // so a terrified clerk's looted pistol and a SWAT officer's sidearm drew
    // identical cones — the visual disagreed with the hit rate the competence
    // table had just computed. Widening it by (1 - accuracy) makes the tracer
    // the honest readout of the man behind it, and costs one multiply.
    // Degrade-safe: no combat_iq, no scaling, exactly the old cone.
    if (CBZ.CONFIG.NPC_COMBAT_IQ !== false && CBZ.combatIQ && CBZ.combatIQ.profile && shooter) {
      const pr = CBZ.combatIQ.profile(shooter);
      if (pr) s *= 0.55 + (1 - Math.min(0.95, pr.hit10)) * 1.5;
    }
    // runtime-only FX randomness (NEVER the shared seeded rng streams — the
    // fire paths draw from those and extra draws would shift world state)
    if (Math.random() < SPREAD_CENTER_FRAC) s *= SPREAD_CENTER_MUL;
    const au = s * (Math.random() * 2 - 1), av = s * (Math.random() * 2 - 1);
    let nx = dx + ux * au + vx * av, ny = dy + vy * av, nz = dz + uz * au + vz * av;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    let end = dist;
    if (CBZ.losRaycast && CBZ.losBlockers && CBZ.losBlockers.length) {
      if (!_spreadRC) _spreadRC = new THREE.Raycaster();
      _spreadRC.ray.origin.set(from.x, from.y, from.z);
      _spreadRC.ray.direction.set(nx, ny, nz);
      _spreadRC.near = 0; _spreadRC.far = dist;
      const hits = CBZ.losRaycast(_spreadRC, CBZ.losBlockers);
      // first SOLID hit clips the streak — a shattered-pane hole passes the
      // round through, exactly like los.js's blockedBy (breach/shoot-through).
      if (hits) for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.distance >= dist) break;
        const n = h.face && h.face.normal;
        if (CBZ.cityShotHole && CBZ.cityShotHole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) continue;
        end = h.distance * 0.98;
        break;
      }
    }
    _jitTo.x = from.x + nx * end; _jitTo.y = from.y + ny * end; _jitTo.z = from.z + nz * end;
    return _jitTo;
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

  // ============================================================
  //  BREACH GLASS — the "teach them about doors, or shooting glass" fix.
  //
  //  An armed NPC (cop / SWAT / gang / any city shooter) that can SEE a target
  //  through a window but whose line of fire is WALLED OFF used to just mill
  //  outside the glass forever (no door use, no breach). Real breaching AI: if
  //  the obstacle between you and your quarry is DESTRUCTIBLE, destroy it and a
  //  new route/sightline opens (the navigation re-evaluates against the hole).
  //
  //  Here the destructible is the storefront glass. We exploit one fact: glass
  //  panes are NOT losBlockers (the solid wall behind them is), and a SHATTERED
  //  pane registers as open air via CBZ.cityShotHole — so once we punch out the
  //  pane on the NPC's firing lane, clearLineOfFire starts returning CLEAR
  //  through that hole and the existing chase code advances + shoots through it.
  //
  //  The gate that stops NPCs randomly shooting windows: cityShatterRay ALONG
  //  THE FIRING LANE only returns a pane when there is genuinely breakable glass
  //  on the line to the target, and we ONLY call it when the shot is currently
  //  BLOCKED and the target is within breaching reach. No glass on the lane →
  //  the ray returns null → nothing breaks and nothing is spent. So a window
  //  only ever shatters when it is the literal thing between the gun and the
  //  quarry. After it breaks, c.sees / clearLineOfFire flips clear next frame.
  //
  //  Returns true if it broke a pane (the caller should then keep advancing /
  //  re-test its line of fire). City-gated; no-op everywhere else.
  // ============================================================
  const _bz = new THREE.Vector3();
  const BREACH_REACH = 16;          // a shooter only breaches glass it could plausibly reach
  function breachGlass(att, tgt, reach) {
    if (g.mode !== "city") return false;
    if (!att || !att.pos || !tgt || !tgt.pos || tgt.dead) return false;
    if (!CBZ.cityShatterRay || !CBZ.clearLineOfFire) return false;
    // per-NPC cooldown so a single stuck shooter doesn't machine-gun the pane
    if ((att._breachCD || 0) > 0) return false;
    reach = reach || BREACH_REACH;
    const ax = att.pos.x, ay = (att.pos.y || 0) + 1.4, az = att.pos.z;
    const ty = tgt.isPlayer ? 1.55 : 1.3;
    const tx = tgt.pos.x, tyy = (tgt.pos.y || 0) + ty, tz = tgt.pos.z;
    const dx = tx - ax, dy = tyy - ay, dz = tz - az;
    const dh = Math.hypot(dx, dz);
    if (dh > reach || dh < 0.6) return false;                       // out of breach range
    // only breach when the lane is ACTUALLY blocked right now (else there's a
    // clean shot already — no reason to be shooting the glass).
    if (CBZ.clearLineOfFire(ax, ay, az, tx, tyy, tz)) return false;
    // is there breakable glass on the lane? cityShatterRay bursts the nearest
    // intact pane the ray crosses within reach and returns it (or null when the
    // lane has no glass — then we've broken nothing). force=true = one shot out,
    // exactly like the NPC's normal aimed fire.
    const seg = Math.min(reach, dh + 0.8);
    const pane = CBZ.cityShatterRay(ax, ay, az, dx, dy, dz, seg, true);
    if (!pane) return false;                                        // no glass on the lane → nothing to breach
    // arm the cooldown BEFORE anything that might re-enter the muzzle wrap, so a
    // recursive call can't trigger a second breach this frame.
    att._breachCD = 0.5 + Math.random() * 0.35;                    // a beat before the next breach attempt
    att._breachedT = 0.8;                                          // "just made a hole — push through it" window
    // a real round went through the glass — sell it like any NPC shot, and let
    // the world treat it as gunfire (witnessed crime / alarm) for the player.
    // _muzGate suppresses the muzzle wrap's own LOS/breach side-effects here.
    _muzGate = true;
    const m = (CBZ.actorMuzzle ? CBZ.actorMuzzle(att, _bz) : null) || { x: ax, y: ay, z: az };
    _muzGate = false;
    if (CBZ.tracer) CBZ.tracer(m, { x: tx, y: tyy, z: tz }, { muzzleScale: att.swat ? 1.15 : 1.0 });
    if (CBZ.gunVoice) CBZ.gunVoice(att.weapon || (att.swat ? "smg" : "sidearm"), CBZ.player ? Math.hypot(att.pos.x - CBZ.player.pos.x, att.pos.z - CBZ.player.pos.z) : 0);
    else if (CBZ.sfx) CBZ.sfx("report");
    raiseGun(att);                                                  // gun's up and firing — never leave it lowered
    return true;
  }
  CBZ.cityNpcBreachGlass = breachGlass;

  // tick down the per-NPC breach cooldowns (cheap, sliced over the crowd at the
  // existing aim-memory pass below).
  function tickBreach(a, dt) {
    if (!a) return;
    if (a._breachCD > 0) a._breachCD -= dt;
    if (a._breachedT > 0) a._breachedT -= dt;
  }

  // --- wrap actorAimAt: stash the aim target so the muzzle/tracer wraps know
  //     who this actor is firing at (the firing paths aim immediately before
  //     they grab the muzzle + draw the tracer). -----------------------------
  const _origAim = CBZ.actorAimAt;
  if (typeof _origAim === "function") {
    CBZ.actorAimAt = function (actor, target, dt) {
      const cityShooter = g.mode === "city" && actor && !actor.isPlayer && actor.char &&
                          target && target.pos;
      if (cityShooter && isCityNpc(actor)) { actor._fireTgt = target; actor._fireTgtT = 0.5; }   // LOS gate memory (cops self-gate)
      if (cityShooter) { actor._aimTgt = target; actor._aimTgtT = AIM_HOLD; }                    // visual-aim memory (INCLUDES cops)
      const res = _origAim.call(this, actor, target, dt);   // orig sets the flat ready pose
      // re-pitch NOW (last frame's smoothed elevation) so the muzzle matrix the
      // imminent actorMuzzle/tracer read matches the pose the player sees.
      if (cityShooter) applyAimPose(actor, 0);
      return res;
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
      // remember this muzzle read as the origin of an imminent shot so the
      // tracer wrap can identify the shooter + weapon (fire paths call
      // actorMuzzle → tracer back-to-back with this exact point). Gate/breach
      // probes run under _muzGate and never mark a pending shot.
      if (!_muzGate && g.mode === "city" && res && actor && !actor.isPlayer && actor._weaponProp) {
        _pendingShot.a = actor; _pendingShot.x = res.x; _pendingShot.y = res.y; _pendingShot.z = res.z;
      }
      if (!_muzGate && g.mode === "city" && isCityNpc(actor) && actor && actor._fireTgt && (actor._fireTgtT || 0) > 0) {
        const t = actor._fireTgt;
        if (t && t.pos && !t.dead && CBZ.clearLineOfFire && res) {
          const ty = t.isPlayer ? 1.55 : 1.3;
          if (CBZ.clearLineOfFire(res.x, res.y != null ? res.y : 1.42, res.z, t.pos.x, ty, t.pos.z)) raiseGun(actor);
          else {
            lowerGun(actor);
            // no shot follows a blocked muzzle read (the caller's own LOS gate
            // holds fire) — drop the pending-shot stash so breachGlass's own
            // straight glass-breaking tracer can't inherit it and get jittered.
            _pendingShot.a = null;
            // BREACH: an armed ped (gang / rampager / empire crew) aiming at a
            // quarry it can't hit because a STOREFRONT WINDOW is in the way shoots
            // the glass OUT — same generic behavior the cops get. breachGlass is a
            // no-op unless there's genuinely breakable glass on this firing lane
            // within reach, so a ped behind a SOLID corner never plinks windows.
            // Once the pane bursts, cityShotHole opens the lane and the ped's own
            // npcAttack LOS gate (which uses clearLineOfFire) passes next beat, so
            // it fires through — and a burst pooled/showroom pane drops its
            // collider too, so it can step in after it.
            breachGlass(actor, t, BREACH_REACH);
          }
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
      if (g.mode === "city" && from && to) {
        if (CBZ.clearLineOfFire &&
            !CBZ.clearLineOfFire(from.x, from.y, from.z, to.x, to.y, to.z)) {
          _pendingShot.a = null;
          return null;   // walled-off shot → no streak, no muzzle flash poking through
        }
        // NPC shot (stashed by the muzzle wrap, matched by exact origin) →
        // spread the streak. The caller's own hit roll stays authoritative —
        // the jitter is small enough (~0.5-1m at 20m, most shots drawn tight)
        // to read as real gunfire rather than laser-straight chest beams.
        const shooter = (_pendingShot.a &&
                         from.x === _pendingShot.x && from.y === _pendingShot.y && from.z === _pendingShot.z)
                         ? _pendingShot.a : null;
        _pendingShot.a = null;   // consume regardless
        if (shooter && CBZ.CONFIG.NPC_TRACER_SPREAD) {
          to = jitterEndpoint(from, to, slotOf(shooter), shooter);
        }
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
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        if (a && a._fireTgtT > 0) a._fireTgtT -= dt;
        if (a && (a._breachCD > 0 || a._breachedT > 0)) tickBreach(a, dt);
      }
    }
  });

  // ---- NPC AIM V2: the per-frame arm-pitch pass. Order 90.5 = strictly after
  // animChar (34/35), poseList's flat hard-set (36), reactions' additive rage
  // elevation (89) and grapple (90) — the LAST gun-arm writer before render,
  // so the aimed pose is what actually draws. Cheap: early-outs on !armed and
  // on actors that aren't engaging (see applyAimPose's `engaged` gate).
  CBZ.onUpdate(90.5, function (dt) {
    if (g.mode !== "city" || !CBZ.CONFIG.NPC_AIM_V2) return;
    const lists = [CBZ.cityPeds, CBZ.cityCops];
    for (let li = 0; li < lists.length; li++) {
      const L = lists[li]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        if (!a || !a.armed) continue;
        if (a._aimTgtT > 0) { a._aimTgtT -= dt; if (a._aimTgtT <= 0) a._aimTgt = null; }
        applyAimPose(a, dt);
      }
    }
  });

  // ---- NPC posture/break maintenance (time-sliced across the crowd) --------
  // Only actors that have actually been hit carry these fields, so the common
  // case is a couple of cheap field checks. (Bleeding is systems/vitals.js's:
  // the blade's private hp drain that used to live here is gone.)
  CBZ.onUpdate(14, function (dt) {
    if (g.mode !== "city") return;
    const peds = CBZ.cityPeds, cops = CBZ.cityCops;
    const tickActor = function (a) {
      if (!a || a.dead) return;
      // guard-break stun winds down → posture resets, brain resumes
      if (a._broken > 0) {
        a._broken -= dt;
        if (a._broken <= 0) { a._posture = 0; a._postNoHit = 0; if (a.char) a.char.guardBroke = 0; }
      } else if (a._posture > 0) {
        a._postNoHit = (a._postNoHit || 0) + dt;
        if (a._postNoHit >= POSTURE_REGEN_DELAY) {
          a._posture = Math.max(0, a._posture - POSTURE_REGEN * 0.9 * dt);
        }
      }
    };
    if (cops) for (let i = 0; i < cops.length; i++) tickActor(cops[i]);
    if (peds) for (let i = 0; i < peds.length; i++) { const a = peds[i]; if (a && (a._broken > 0 || a._posture > 0)) tickActor(a); }
  });

  // ---- INCOMING-MELEE TELEGRAPH (so the parry is a SKILL, not a guess) -----
  // peds.js USED to land its melee instantly with no wind-up, which made the
  // parry window pure luck — so this pass faked a tell from the OUTSIDE, by
  // reading attackCD and stamping `_windup` on whoever looked about to swing.
  // That is a shim around a missing beat, and the beat now exists: peds.js's
  // melee branch runs systems/combat_iq.js's exchange (approach, circle at the
  // edge of reach, guard, TELEGRAPH, commit, recover) and authors a real
  // `_windup` whose length is the fighter's own competence — a brawler tells
  // for 0.42 s, a SWAT officer for 0.20. So this pass now DEFERS: it skips any
  // foe already running the real beat and remains the fallback for anything
  // that isn't (flag off, or a melee path outside peds.js). The decay loop at
  // the bottom is untouched and still owns both.
  let _telegraphT = 0;
  CBZ.onUpdate(15, function (dt) {
    if (g.mode !== "city" || g.state !== "playing" || P.dead) return;
    if (_telegraphT > 0) _telegraphT -= dt;
    let threat = null, bd = 2.9 * 2.9;
    const scan = function (a) {
      if (!a || a.dead || a.ko > 0 || a.surrender || a.armed && a.ammo > 0) return;
      if (a._broken > 0 || a.stun > 0) return;
      if (a._iqM) return;                            // running the real exchange — it owns its own tell
      const aggressive = (a.rage === CBZ.city.playerActor) || (a.finalGoal && a.finalGoal._chase) || (a.aggr || 0) >= 0.7;
      if (!aggressive) return;
      const dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z, dd = dx * dx + dz * dz;
      if (dd > bd) return;
      // only a foe whose swing is imminent (cooldown almost elapsed) tells
      if ((a.attackCD || 0) > 0.28) return;
      bd = dd; threat = a;
    };
    const peds = CBZ.cityPeds;
    if (peds) for (let i = 0; i < peds.length; i++) scan(peds[i]);
    if (threat) {
      threat._windup = 0.25;                        // rig can read this to cock back
      if (threat.char) threat.char.windup = 0.25;
      if (_telegraphT <= 0 && !CBZ.cityHasGun() && CBZ.city) {
        // (no toast — the wind-up animation IS the telegraph; mid-fight key
        // lectures broke the street voice. Timer kept to pace the windup flags.)
        _telegraphT = 0.9;
      }
    }
    // decay windup flags we set last frame
    if (peds) for (let i = 0; i < peds.length; i++) { const a = peds[i]; if (a && a._windup > 0) { a._windup -= dt; if (a.char && a.char.windup > 0) a.char.windup -= dt; } }
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

    // PLAYER posture: recovers after a grace period; recovers faster with
    // stamina to spare. Guard-break stun winds down and resets your posture.
    if (pBrokenT > 0) {
      pBrokenT -= dt;
      if (pBrokenT <= 0) { pPosture = 0; pPostNoHit = 0; }
    } else if (pPosture > 0) {
      pPostNoHit += dt;
      if (pPostNoHit >= POSTURE_REGEN_DELAY) {
        const sf = 0.7 + (stam() / 100) * 0.8;     // fresh = faster recovery
        pPosture = Math.max(0, pPosture - POSTURE_REGEN * sf * dt);
      }
    }

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
    // YOUR BODY SHOWS IT. The held guard is the rig's high block (forearms up,
    // chin down — entities/meleeposes.js); a fight puts you in your stance, and
    // a spent stamina bar drops the hands (ch.winded) — what the "Winded" and
    // "GUARD BROKEN!" captions used to say in words.
    const pch = CBZ.playerChar;
    if (pch) {
      if (P._blocking && pBrokenT <= 0) pch.blockT = Math.max(pch.blockT || 0, 0.1);
      pch.fightStance = !CBZ.cityHasGun() && ((P._fighting || 0) > 0 || !!P._blocking) && !P.driving;
      pch.winded = pBrokenT > 0 ? 1 : Math.max(0, Math.min(1, 1 - stam() / 45));
    }

  });

  // ---- input: LMB = light combo, RMB = heavy / hold-guard --------------
  //      Only when unarmed / holding a melee weapon. With a firearm out,
  //      fpsmode.js owns LMB (fire) and RMB (aim). ----
  // held: the click is a wrench against his grip (verbs.js), not a swing
  function handsFree() { return !(CBZ.verbs && CBZ.verbs.playerHeld && CBZ.verbs.playerHeld()); }
  function active() { return g.mode === "city" && g.state === "playing" && document.pointerLockElement && !P.driving && handsFree(); }
  // CUFFED (CBZ.arrest.playerCuffed): no fists, no guard, no finisher, no
  // weapon. What is left is a foot: one front kick, slow to throw, with a
  // real gap before the next, off-balance so it lands soft and costs wind.
  function cuffedNow() { return !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()); }
  function cuffKick() {
    if (pBrokenT > 0 || staggerT > 0 || tired()) return;
    const V = CBZ.verbs, pa = playerActor();
    if (!V || !V.strike || !pa) return;
    markFighting();
    combo = 0; comboT = 0;
    const special = aimSpecial(2.1, 0.3);
    faceLook();
    const dmg = 13;
    const S = V.strike(pa, special, {
      kind: "kick", heavy: false, speed: 0.8,
      candidates: special ? null : cityCandidates,
      onLand: function (res) { landCity(res, dmg, "light", "kick"); },
      onBlocked: function (res) { blockedCity(res, dmg, "kick"); },
      onBeat: special ? function () { landSpecial(special, dmg, "light"); } : null,
    });
    if (!S) return;
    spend(10);
    fireCD = 0.95;
  }

  document.addEventListener("mousedown", function (e) {
    if (!active()) return;
    if (CBZ.cityMenuOpen) return;
    if (e.button === 0 && CBZ.cityMountedAnimalAttack && CBZ.cityMountedAnimalAttack(true)) {
      e.preventDefault();
      return;
    }
    if (cuffedNow()) {
      if (e.button === 0 && fireCD <= 0) { e.preventDefault(); cuffKick(); }
      return;                                // no guard, no heavy: the hands are behind you
    }
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
    if (rmbT < 0.22 && active() && !cuffedNow() && !CBZ.cityHasGun() && !CBZ.cityMenuOpen) heavyAttack();
    guardT = Math.min(guardT, 0.06);
  });

  // ============================================================
  //  THROWABLE GRENADES — an arcing, fused area weapon ([T] to throw)
  // ------------------------------------------------------------
  //  fpsmode.js is pure hitscan with no projectile loop, so the lobbed
  //  grenade lives here. You carry a COUNT (g.cityInv["Grenade"], populated by
  //  the gun shop's normal buy path + mirrored to g.cityGrenades for HUD
  //  readers). [T], in city mode + not driving + count>0, spawns a small mesh
  //  at your hand, gives it an ARC velocity along the aim (cam yaw/pitch) +
  //  gravity, integrates it each frame (CBZ.onAlways), bounces/settles on the
  //  floor (CBZ.floorAt), and after a ~1.5s FUSE detonates through the EXACT
  //  same city blast chain as the RPG — cityExplosion + cityShatter — plus the
  //  city's witnessed-crime + alarm. Power/radius sit a touch under the RPG.
  //
  //  CITY-GATED everywhere (the explosion calls are city-only), so escape/
  //  survival are byte-identical to before. Live grenades are capped + cleared
  //  on a new run. Lazily allocates THREE temporaries (none on load).
  //  (THREE is the same global already used above at the LOS-gate wraps.)
  // ============================================================
  const GREN = {
    fuse: 1.5,          // seconds from throw to boom
    maxLive: 6,         // hard cap on simultaneous live grenades
    gravity: 18,        // m/s^2 downward on the arc
    speed: 15,          // launch speed along the aim
    up: 3.2,            // extra upward toss so it arcs even on a flat aim
    bounce: 0.42,       // floor restitution
    friction: 0.7,      // horizontal damping per bounce
    power: 1.0, radius: 5.5,   // a bit smaller than the RPG (1.4 / 7)
    throwCD: 0.35,      // debounce the throw key
  };
  const live = [];      // active grenades: { mesh, vx, vy, vz, x, y, z, t, spin }
  let throwCD = 0;

  function grenCount() { return (CBZ.cityEcon && CBZ.cityEcon.count) ? CBZ.cityEcon.count("Grenade") : (g.cityInv && g.cityInv.Grenade) || 0; }
  function syncGrenadeHud() { g.cityGrenades = grenCount(); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }

  function clearGrenades() {
    for (let i = 0; i < live.length; i++) {
      const gr = live[i];
      if (gr && gr.mesh && gr.mesh.parent) gr.mesh.parent.remove(gr.mesh);
    }
    live.length = 0;
  }
  CBZ.cityClearGrenades = clearGrenades;

  // a fresh run resets the carried count + clears any live grenades
  let _lastGrenElapsed = 0;
  function grenadeCheckReset() {
    const el = (g.elapsed || 0);
    if (el + 0.001 < _lastGrenElapsed) { clearGrenades(); g.cityGrenades = grenCount(); }
    _lastGrenElapsed = el;
  }

  // aim direction from the look (works in BOTH first-person and third-person):
  // yaw is the shared cam yaw; pitch is fps.fp while in FPS, else cam.pitch.
  // SIGN: `pitch` below is UP-positive (it is spent as `y: sin(pitch)`), which
  // fps.fp already is — but cam.pitch is DOWN-positive (convention note in
  // systems/camera.js beside `const cam = {...}`), so the third-person branch
  // has to flip. Without this, everything aimed through here (thrown ordnance,
  // the melee/aim reach) went UP when you looked DOWN in third person.
  function aimVec() {
    const yaw = (CBZ.cam && CBZ.cam.yaw) || 0;
    const pitch = (CBZ.fps && CBZ.fps.active) ? (CBZ.fps.fp || 0) : -((CBZ.cam && CBZ.cam.pitch) || 0);
    const cp = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  }

  // Detonate one grenade at (x,z): the SAME city blast chain the RPG fires, so
  // it kills, shatters glass, and is a witnessed crime. CITY-ONLY.
  function detonate(x, z) {
    if (g.mode !== "city") return;
    // THE FRAG NAMES ITS ORDNANCE (systems/impactbus.js). The "grenade" row is
    // 1.0 power / 6 radius against GREN's 1.0 / 5.5, so the fireball grows
    // very slightly and never shrinks — and the row brings the structural
    // ledger, a fire term and the ordnance identity the vehicle coupling reads
    // to tell a frag from a car fire. Degrade: flag off => the exact old line.
    // CBZ.blastSeatY: the ground seat, clamped strictly under crashfx's
    // airburst line — see the block above it for why a frag on a hill would
    // otherwise be a silent dud.
    if (CBZ.detonate && CBZ.CONFIG && CBZ.CONFIG.ORDNANCE_BUS_ALL !== false) {
      CBZ.detonate(x, CBZ.blastSeatY ? CBZ.blastSeatY(x, z) : 1.0, z, "grenade", { byPlayer: true });
    } else if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: GREN.power, radius: GREN.radius, byPlayer: true, kind: "grenade" });
    if (CBZ.cityShatter) CBZ.cityShatter(x, z, GREN.radius + 2);
    if (CBZ.shake) CBZ.shake(1.2);
    if (CBZ.doHitstop) CBZ.doHitstop(0.05);
    // throwing a frag is at least as loud as discharging a firearm
    if (CBZ.cityCrime) CBZ.cityCrime(120, { x, z, type: "shots-fired" });
    if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(x, z, 40, 1.6, CBZ.city.playerActor);
    if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: { x: x, z: z }, radius: 80, intensity: 2.0 });   // crowd panic bus (cityevents.js): frag blast
    if (CBZ.cityEvent) CBZ.cityEvent("bullet-impact", { weapon: "grenade", panic: 4, damage: 0.3 }, { silent: true, noWanted: true });
  }

  // Spawn + lob a grenade from (x,y,z) along unit dir (dirx,diry,dirz). Public
  // so the rampager AI (another cluster) can hurl explosives too. Guard-safe:
  // no-ops outside city / when capped / when THREE is missing.
  function lobExplosive(x, y, z, dirx, diry, dirz, opts) {
    if (g.mode !== "city" || !THREE) return false;
    if (live.length >= GREN.maxLive) return false;
    opts = opts || {};
    const dl = Math.hypot(dirx, diry, dirz) || 1;
    const ux = dirx / dl, uy = diry / dl, uz = dirz / dl;
    const sp = opts.speed || GREN.speed;
    const gr = {
      x, y, z,
      vx: ux * sp,
      vy: uy * sp + (opts.up != null ? opts.up : GREN.up),
      vz: uz * sp,
      t: 0,
      spin: (Math.random() - 0.5) * 8,
      mesh: null,
    };
    if (CBZ.grenadeMesh) {
      const m = CBZ.grenadeMesh(THREE);
      if (m) { m.position.set(x, y, z); if (CBZ.scene) CBZ.scene.add(m); gr.mesh = m; }
    }
    live.push(gr);
    return true;
  }
  // expose under both names other clusters might look for
  CBZ.cityLobExplosive = lobExplosive;
  CBZ.cityThrowGrenade = function (x, z, dirx, dirz, opts) {
    const fy = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
    return lobExplosive(x, (fy || 0) + 1.2, z, dirx || 0, 0.25, dirz || 0, opts);
  };

  // PLAYER throw: consume one carried grenade, lob it from the hand along the aim.
  // opts.power (0.45..1, systems/helditems.js: how long the throw was wound
  // up) scales the launch; no opts = the full-strength [G] quick throw.
  function throwGrenade(opts) {
    const pw = (opts && opts.power > 0) ? Math.min(1, opts.power) : 1;
    if (g.mode !== "city" || g.state !== "playing" || !P || P.dead || P.driving) return;
    if ((P.stun || 0) > 0 || cuffedNow()) return;   // cuffed: nothing leaves a hand behind your back
    if (grenCount() <= 0) { if (CBZ.city) CBZ.city.note("No grenades", 1.4); return; }
    if (live.length >= GREN.maxLive) return;
    if (!(CBZ.cityEcon && CBZ.cityEcon.take && CBZ.cityEcon.take("Grenade"))) return;
    const dir = aimVec();
    // launch from the player's hand: a bit forward + up from the chest
    const ox = P.pos.x + dir.x * 0.6;
    const oz = P.pos.z + dir.z * 0.6;
    const oy = P.pos.y + 1.55;
    lobExplosive(ox, oy, oz, dir.x, dir.y, dir.z, { speed: GREN.speed * pw, up: GREN.up * (0.6 + 0.4 * pw) });
    syncGrenadeHud();
    if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();   // a quick throwing arm swing
    throwCD = GREN.throwCD;
  }
  CBZ.cityThrowFromInventory = throwGrenade;
  CBZ.cityGrenadeCount = grenCount;

  // [G] = throw a grenade. (T was taken by the mask/disguise toggle in wanted.js,
  // so grenades live on G.) Never fires while a menu is open, while driving, or
  // out of city mode.
  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if ((e.key || "").toLowerCase() !== "g") return;
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && CBZ.player.driving)) return;
    if (throwCD > 0) return;
    throwGrenade();
  });

  // integrate live grenades every frame (CBZ.onAlways so it runs regardless of
  // pause-state gating; itself city-gated). Arc → bounce/settle → fuse → boom.
  CBZ.onAlways(53.5, function (dt) {
    if (throwCD > 0) throwCD = Math.max(0, throwCD - dt);
    grenadeCheckReset();
    if (g.mode !== "city" || !live.length) return;
    for (let i = live.length - 1; i >= 0; i--) {
      const gr = live[i];
      gr.t += dt;
      // ballistic step
      gr.vy -= GREN.gravity * dt;
      gr.x += gr.vx * dt;
      gr.y += gr.vy * dt;
      gr.z += gr.vz * dt;
      // CBZ.floorAt returns 0 over open sea (it is the LAND height query), so a
      // grenade thrown into the water used to come to rest 0.6m above the waves
      // on an invisible shelf. Over water, rest on the live swell instead.
      let floor = (CBZ.floorAt ? CBZ.floorAt(gr.x, gr.z) : 0) || 0;
      if (CBZ.citySeaHeightAt && CBZ.cityWaterAt && CBZ.cityWaterAt(gr.x, gr.z)) {
        const sea = CBZ.citySeaHeightAt(gr.x, gr.z);
        if (typeof sea === "number" && isFinite(sea) && sea > floor) floor = sea;
      }
      const rest = floor + 0.12;
      if (gr.y <= rest) {
        gr.y = rest;
        if (gr.vy < 0) {
          gr.vy = -gr.vy * GREN.bounce;
          gr.vx *= GREN.friction; gr.vz *= GREN.friction;
          if (gr.vy < 0.6) gr.vy = 0;   // settle once it stops bouncing
        }
      }
      if (gr.mesh) {
        gr.mesh.position.set(gr.x, gr.y, gr.z);
        gr.mesh.rotation.x += gr.spin * dt;
        gr.mesh.rotation.z += gr.spin * 0.6 * dt;
      }
      if (gr.t >= GREN.fuse) {
        detonate(gr.x, gr.z);
        if (gr.mesh && gr.mesh.parent) gr.mesh.parent.remove(gr.mesh);
        live.splice(i, 1);
      }
    }
  });

  // ordnance-bus adoption, declared at LOAD (CBZ.blastAudit()).
  (CBZ.ordnanceBusSites = CBZ.ordnanceBusSites || []).push("combat:grenade");
})();
