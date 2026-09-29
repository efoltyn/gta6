/* ============================================================
   systems/vitals.js — CBZ.vitals: ONE BODY THAT CAN BE HURT, IN EVERY GAME.

   Owner (2026-09-28): "I punch a guy and I'm just punching him and then
   eventually he knocks over and he's just dead and there's a hole in his back
   as if he got shot. ... fighting is dumb. There's no knocking out. There's no
   bleeding versus bleeding out. There's no bandaging."

   Every game used to keep one number, hp, and a fist, a knife and a rifle all
   subtracted from it, so the only thing a beating could end in was a death.
   A body is not one number. This file keeps three, per person:

     · DAZE (blunt trauma to the head). Fists, kicks, a baton, a headbutt.
       A clean shot to the jaw is worth far more than one to the arms or the
       gut; it decays slowly, so a man already rocked goes out on the next
       good one. Past the line he is KNOCKED OUT: he collapses in his own rig
       (bodyfall / the keyed fall), lies there breathing for a real 12-30 s,
       and comes to GROGGY (he stumbles for a while). A punch opens no wound
       and leaves no hole. Fists kill only one way: keep beating a man who is
       already out, for a long time (BRAIN).

     · BLOOD (0..1 of his volume). A bullet or a blade opens a BLEED whose rate
       depends on where it went in (a thigh artery empties a man in under a
       minute, a graze on the arm clots on its own). Blood drains; below 85%
       he is weak and slow (the player's sight greys), below ~62% he collapses
       unconscious, below ~48% he is dead of it. Only a truly lethal hit kills
       at once: the head, the heart, a body riddled with rounds.

     · BANDAGES. A bleed can be wrapped (self, or someone kneeling over you):
       a few seconds of hands on the wound, interrupted if you are hit, and a
       real gauze wrap appears on that limb and the bleed all but stops. The
       player needs a roll (a real item found in the world); an NPC who is
       safe tears his shirt and does it himself, slower and worse.

   Corpses keep taking it: every round or stab into a dead man is another
   hole (wounds.js) and another ooze that grows the pool under him (to a cap).

   API (CBZ.vitals):
     state(a)        -> "ok" | "down" | "ko" | "tased" | "dead"
                        down = conscious but on the floor (critically hurt)
     cuffable(a)     -> true when he cannot fight you off (down / ko / tased)
     incapacitated(a)-> same test, named for the AI
     blood(a) 0..1 · bleedRate(a) (fraction/s) · daze(a) · weak(a) 0..1
     speedMul(a)     -> movement multiplier (groggy, blood loss, a shot leg,
                        legs hurt in a fall)
     fall(a, h)      -> a landing from h metres: the leg multiplier it left
     lame(a)         -> that multiplier now (1 = sound)
     busy(a)         -> true while he is bandaging (movers hold him still)
     blunt(a, o)     -> "none" | "stagger" | "knockdown" | "ko" | "dead"
                        o = { zone: jaw|head|liver|body|legs, power 0..1,
                              weapon: fist|kick|knee|elbow|headbutt|blunt|baton,
                              heavy, by, dirX, dirZ, fall:false (caller plays
                              the fall itself), mul }
     wound(a, o)     -> { outcome: "ok"|"down"|"dead", rate }
                        o = { kind: bullet|stab|slash|blast|bite, zone, point,
                              head, cal, by, dirX, dirZ, critical (the game's hp
                              ran out: he goes down bleeding instead of dying) }
     tase(a, secs, o)· ko(a, secs, o)
     bandage(medic, patient?, o) -> bool (starts it) · cancelBandage(a)
     bandaging(a)    -> progress 0..1 or -1
     giveBandage(n)  / bandages() — the player's rolls
     kill(a, cause, o) — the one death this file hands out (routes per game)
     on(mode, hooks) — a game plugs in: { kill(a,cause,o), playerKill(cause,o),
                        playerDown(on, o), safe(a), hold(a, secs, o), rise(a),
                        rolls() -> n, useRoll(n) }
     reset(a) · peek(a) · of(a) · list
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const VT = CBZ.vitals = CBZ.vitals || {};

  /* ---- the body's numbers ---- */
  const K = {
    BLOOD_WEAK: 0.85,        // below this: weak, slow, the player's sight greys
    BLOOD_COLLAPSE: 0.62,    // below this: unconscious (hemorrhagic)
    BLOOD_WAKE: 0.68,        // above this again (and not pouring): comes round
    BLOOD_DEAD: 0.48,        // below this: dead of it
    REGEN: 0.0007,           // /s once nothing is open (the body makes it back slowly)
    DAZE_DECAY: 0.03,        // /s
    DAZE_KO: 1.0,
    DAZE_SCALE: 0.26,        // power x zone x weapon x this = one blow's daze
    BRAIN_DEAD: 7.0,         // blunt damage to a man who is already out, to kill him
    KO_MIN: 12, KO_MAX: 28,  // s unconscious from a blunt KO
    GROGGY: 9,               // s stumbling after he comes to
    RIDDLED: 4.6,            // cal-weighted torso rounds inside RIDDLE_T that kill outright
    RIDDLE_T: 4,
    CRIT_BOOST: 2.2,         // a man whose hp ran out bleeds this much faster
    BAND_SELF: 4.2, BAND_OTHER: 3.4, BAND_CLOTH: 6.0,
    SAFE_T: 7,               // s since his last hit before an NPC bandages himself
    POOL_CAP: 22,            // pool decals one body may lay
    POOL_MAX: 2.4,           // the biggest a pool decal grows (gore grow units)
  };
  VT.K = K;

  const ZONE_BLUNT = { jaw: 1.6, head: 1.0, neck: 1.1, liver: 0.45, body: 0.35, chest: 0.35, abdomen: 0.4, torso: 0.35, legs: 0.12, legL: 0.12, legR: 0.12, armL: 0.1, armR: 0.1 };
  const WEAPON_BLUNT = { fist: 1, jab: 1, kick: 1.3, knee: 1.25, elbow: 1.2, headbutt: 1.15, blunt: 1.8, baton: 1.7, bat: 2.0, pipe: 2.0, stomp: 1.6 };

  let clock = 0;
  VT.rng = null;           // a check may seed this; else the game's own rng
  function rng() {
    if (VT.rng) return VT.rng();
    if (CBZ.econ && CBZ.econ.rng) return CBZ.econ.rng();
    return Math.random();
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /* ---- the actor adapter ---- */
  function isPlayer(a) { return !!a && (a === CBZ.player || a.isPlayer === true); }
  function real(a) {
    if (!a) return null;
    if (a.isPlayer === true && CBZ.player) return CBZ.player;
    return a;
  }
  function rigOf(a) {
    if (!a) return null;
    if (isPlayer(a)) return CBZ.playerChar || null;
    return (a.char && a.char.parts) ? a.char : (a.ch && a.ch.parts) ? a.ch : null;
  }
  function posOf(a) {
    if (!a) return null;
    if (isPlayer(a)) return CBZ.player && CBZ.player.pos;
    return a.pos || (a.group && a.group.position) || null;
  }
  function deadOf(a) { return isPlayer(a) ? !!(CBZ.player && CBZ.player.dead) : !!(a && a.dead); }
  function mode() { return (CBZ.game && CBZ.game.mode) || ""; }

  const LIST = [];         // records with something going on (the tick walks these)
  VT.list = LIST;
  function peek(a) { a = real(a); return a ? a._vt || null : null; }
  function of(a) {
    a = real(a);
    if (!a) return null;
    let R = a._vt;
    // a respawned / reused man still carrying his corpse record (it went quiet
    // and left the tick before he came back): a fresh body, not a dead one
    if (R && R.dead && !deadOf(a)) { reset(a); R = null; }
    if (!R) {
      R = a._vt = {
        a, blood: 1, bleeds: [], daze: 0, brain: 0, koT: 0, koN: 0, groggyT: 0, stumbleT: 0,
        tasedT: 0, collapsed: false, critical: false, riseT: 0, dead: false, lastHitT: -1e9,
        riddle: 0, riddleT: 0, band: null, wraps: [], pour: 0, poured: 0, poolN: 0, poolAt: 0,
        dripT: 0, cause: "", by: null, live: false, holdKo: false,
      };
    }
    return R;
  }
  function wake(R) { if (!R.live) { R.live = true; LIST.push(R); } }
  VT.peek = peek; VT.of = of;

  /* ---- a game plugs in ---- */
  const HOOKS = {};
  VT.on = function (m, hooks) { HOOKS[m] = Object.assign(HOOKS[m] || {}, hooks || {}); return HOOKS[m]; };
  function hook(name) {
    const h = HOOKS[mode()];
    if (h && typeof h[name] === "function") return h[name];
    const s = HOOKS["*"];
    return s && typeof s[name] === "function" ? s[name] : null;
  }

  /* ============================================================
     STATE
     ============================================================ */
  function state(a) {
    a = real(a);
    if (!a) return "ok";
    if (deadOf(a)) return "dead";
    const R = a._vt;
    if (R && !R.dead) {
      if (R.koT > 0 || R.collapsed) return "ko";
      if (R.tasedT > 0) return "tased";
      if (R.critical) return "down";
    }
    // what the games already say, for a man this file never touched
    if (isPlayer(a)) {
      if (CBZ.playerDowned && CBZ.playerDowned()) return "down";
      const cs = CBZ.player && CBZ.player.captureState;
      if (cs === "tased") return "tased";
      if (cs === "downed") return "down";
      return "ok";
    }
    if (a.tasedT > 0) return "tased";
    if (a.ko > 0) return "down";
    const ch = rigOf(a);
    if (ch && ch.fall && ch.fall.on && ch.fall.phase !== "getup") return "down";
    return "ok";
  }
  VT.state = state;
  VT.cuffable = function (a) { const s = state(a); return s === "down" || s === "ko" || s === "tased"; };
  VT.incapacitated = VT.cuffable;
  VT.conscious = function (a) { const s = state(a); return s !== "ko" && s !== "dead"; };
  VT.blood = function (a) { const R = peek(a); return R ? R.blood : 1; };
  VT.daze = function (a) { const R = peek(a); return R ? R.daze : 0; };
  function rateOf(R) {
    let r = 0;
    for (let i = 0; i < R.bleeds.length; i++) { const b = R.bleeds[i]; r += b.rate * (1 - b.band); }
    return r;
  }
  VT.bleedRate = function (a) { const R = peek(a); return R ? rateOf(R) : 0; };
  VT.bleeding = function (a) { const R = peek(a); return !!R && rateOf(R) > 0.0003; };
  VT.unbandaged = function (a) {
    const R = peek(a); if (!R) return 0;
    let n = 0; for (let i = 0; i < R.bleeds.length; i++) if (R.bleeds[i].band < 0.5 && R.bleeds[i].rate > 0.0006) n++;
    return n;
  };
  // 0 fine .. 1 at the edge of collapse
  function weak(R) {
    if (!R) return 0;
    let w = clamp01((K.BLOOD_WEAK - R.blood) / (K.BLOOD_WEAK - K.BLOOD_COLLAPSE));
    if (R.groggyT > 0) w = Math.max(w, 0.55 * clamp01(R.groggyT / K.GROGGY) + 0.25);
    return w;
  }
  VT.weak = function (a) { return weak(peek(a)); };
  /* ---- THE LEGS after a fall (systems/capture.js CBZ.prisonFallLand): a
     turned ankle for a minute, a broken one or broken legs for the run.
     Nothing to tick: the record carries its own end on this file's clock.
     A splint (VT.dress: Doc Mercer, the infirmary) takes the worst of it. */
  function legMul(R) {
    if (!R || !R.leg) return 1;
    if (clock > R.leg.until) { R.leg = null; return 1; }
    return R.leg.mul;
  }
  VT.fall = function (a, h) {
    a = real(a); if (!a || deadOf(a) || !(h > 2.8)) return 1;
    const R = of(a);
    const mul = h < 4.5 ? 0.8 : h < 8 ? 0.6 : 0.45;
    const until = h < 4.5 ? clock + 60 : Infinity;
    if (!R.leg || mul < R.leg.mul) R.leg = { mul: mul, until: until, splint: false };
    else R.leg.until = Math.max(R.leg.until, until);
    R.lastHitT = clock;
    wake(R);
    return R.leg.mul;
  };
  VT.lame = function (a) { return legMul(peek(a)); };
  VT.speedMul = function (a) {
    const R = peek(a); if (!R) return 1;
    if (R.band && R.band.medic === R.a) return 0.25;
    let m = (1 - 0.45 * weak(R)) * legMul(R);
    for (let i = 0; i < R.bleeds.length; i++) {
      const b = R.bleeds[i];
      if ((b.zone === "legL" || b.zone === "legR") && b.band < 0.5) { m *= 0.78; break; }
    }
    return m;
  };
  VT.busy = function (a) { const R = peek(a); return !!(R && R.band && R.band.medic === R.a); };

  /* ============================================================
     PUTTING HIM DOWN / GETTING HIM UP (per game through the hooks, a
     generic rig fall otherwise)
     ============================================================ */
  function koMode() { const m = mode(); return m === "city" || m === "escape"; }
  function fallDown(a, secs, o, conscious) {
    o = o || {};
    if (isPlayer(a)) {
      const h = hook("playerDown");
      if (h) { try { h(true, { secs, cause: o.cause || "", conscious: !!conscious, by: o.by || null }); } catch (e) { /* game hook */ } }
      else if (CBZ.player) CBZ.player.stun = Math.max(CBZ.player.stun || 0, Math.min(secs, 3));
      return;
    }
    const hh = hook("hold");
    if (hh) { try { if (hh(a, secs, o) !== false) return; } catch (e) { /* game hook */ } }
    if (o.fall === false) { if (koMode()) a.ko = Math.max(a.ko || 0, secs); return; }
    const V = CBZ.verbs;
    let dir = null;
    if (o.dirX != null || o.dirZ != null) {
      const l = Math.hypot(o.dirX || 0, o.dirZ || 0);
      if (l > 1e-6) dir = { x: o.dirX / l, z: o.dirZ / l };
    }
    const ch = rigOf(a);
    const already = ch && ch.fall && ch.fall.on && ch.fall.phase !== "getup";
    if (already) {
      // already on the floor: keep him there this long
      if (ch.fall) { ch.fall.dur = Math.max(ch.fall.dur || 0, secs); }
      if (koMode()) a.ko = Math.max(a.ko || 0, secs + 1.2);
      return;
    }
    let ok = false;
    if (V && V.knockdown) {
      try { ok = !!V.knockdown(a, { dir, ko: !conscious, dur: secs, power: o.power != null ? o.power : 0.7, noKo: !koMode() }); } catch (e) { ok = false; }
    }
    if (!ok && koMode()) a.ko = Math.max(a.ko || 0, secs);
  }
  function getUp(a) {
    // the player comes round through the tick's one playerDown(false) call
    if (isPlayer(a)) return;
    // the game that laid him down through hold() lets him up the same way
    const hr = hook("rise");
    if (hr) { try { if (hr(a) !== false) return; } catch (e) { /* game hook */ } }
    const V = CBZ.verbs;
    if (V && V.getUp) { try { V.getUp(a); } catch (e) { /* no rig */ } }
  }

  /* ============================================================
     DEATH — the one route out
     ============================================================ */
  function kill(a, cause, o) {
    a = real(a);
    if (!a || deadOf(a)) return false;
    o = o || {};
    const R = of(a);
    R.cause = cause || R.cause || "";
    if (isPlayer(a)) {
      const h = hook("playerKill");
      if (h) { try { h(R.cause, o); } catch (e) { /* game hook */ } }
      else if (mode() === "city" && CBZ.cityKillPlayer) CBZ.cityKillPlayer(R.cause || "bled out", { fromX: o.fromX, fromZ: o.fromZ });
      else if (CBZ.player) { CBZ.player.hp = 0; CBZ.player.dead = true; }
    } else {
      const h = hook("kill");
      let done = false;
      if (h) { try { done = h(a, R.cause, o) !== false; } catch (e) { done = false; } }
      if (!done) {
        const melee = o.melee || (R.cause === "beaten" || R.cause === "beaten to death" ? "blunt" : R.cause === "stabbed" ? "blade" : null);
        if (mode() === "city" && CBZ.cityKillPed && !a.isCop) CBZ.cityKillPed(a, { fromX: o.fromX, fromZ: o.fromZ, force: o.force != null ? o.force : 2 }, R.cause || "bled out");
        else if (CBZ.aiKill) CBZ.aiKill(a, o.by || null, { noKnock: true, cause: R.cause, melee, quiet: !!o.quiet });
        else { a.dead = true; a.hp = 0; a.ko = 0; }
      }
    }
    if (deadOf(a)) { R.dead = true; R.koT = 0; R.collapsed = false; R.critical = false; R.band = null; wake(R); }
    return deadOf(a);
  }
  VT.kill = kill;

  /* ============================================================
     BLUNT — the fist, the boot, the baton
     ============================================================ */
  const _bo = {};
  VT.blunt = function (a, o) {
    a = real(a);
    o = o || _bo;
    if (!a) return "none";
    const R = of(a);
    if (deadOf(a)) return "dead";
    const zone = o.zone || "head";
    const zm = ZONE_BLUNT[zone] != null ? ZONE_BLUNT[zone] : 0.5;
    const wm = WEAPON_BLUNT[o.weapon || "fist"] || 1;
    const tough = a.ratings && a.ratings.toughness > 0 ? 0.8 + a.ratings.toughness / 250 : 1;
    const power = o.power != null ? o.power : 0.6;
    const hit = power * zm * wm * K.DAZE_SCALE * (o.heavy ? 1.25 : 1) * (o.mul != null ? o.mul : 1) / tough;
    R.lastHitT = clock;
    if (o.by) R.by = o.by;
    if (R.band) cancel(R);
    wake(R);
    // HE IS ALREADY OUT: every blow now is damage to a man who cannot defend
    // himself. That is the only way fists kill, and it takes a long time.
    if (R.koT > 0 || R.collapsed || R.critical) {
      R.brain += hit * 1.6 + (zone === "head" || zone === "jaw" ? 0.08 : 0.02);
      if (R.koT > 0) R.koT = Math.max(R.koT, 8);
      if (R.brain >= K.BRAIN_DEAD) { kill(a, "beaten to death", { by: o.by, melee: "blunt", fromX: o.fromX, fromZ: o.fromZ }); return "dead"; }
      return "ko";
    }
    R.brain += hit * 0.06;
    R.daze += hit;
    if (R.groggyT > 0) R.daze += hit * 0.3;                 // a man still groggy goes back out easily
    const head = zone === "jaw" || zone === "head" || zone === "neck";
    let out = false;
    if (R.daze >= K.DAZE_KO) out = true;
    else if (head && hit >= 0.25) {
      const p = clamp01((R.daze - 0.5) * 1.5) * (zone === "jaw" ? 1 : 0.6);
      if (rng() < p) out = true;
    }
    if (out) {
      const secs = (K.KO_MIN + rng() * (K.KO_MAX - K.KO_MIN)) * (1 + 0.35 * Math.min(3, R.koN));
      goKo(a, R, secs, o);
      return "ko";
    }
    // a heavy one on a man already rocked puts him on the floor for a count
    if (hit >= 0.28 && R.daze >= 0.62 && (o.heavy || zone === "jaw")) return "knockdown";
    if (hit >= 0.22) return "stagger";
    return "none";
  };
  function goKo(a, R, secs, o) {
    R.koT = secs; R.koN++;
    R.daze = 0.55;
    R.groggyT = 0;
    if (R.band) cancel(R);
    wake(R);
    fallDown(a, secs, o, false);
  }
  VT.ko = function (a, secs, o) {
    a = real(a); if (!a || deadOf(a)) return false;
    const R = of(a);
    goKo(a, R, secs > 0 ? secs : K.KO_MIN + rng() * (K.KO_MAX - K.KO_MIN), o || _bo);
    return true;
  };
  // the taser: the legs go and the muscles lock; he is conscious, and cuffable
  VT.tase = function (a, secs, o) {
    a = real(a); if (!a || deadOf(a)) return false;
    const R = of(a);
    secs = secs > 0 ? secs : 5;
    R.tasedT = Math.max(R.tasedT, secs);
    R.lastHitT = clock;
    if (R.band) cancel(R);
    wake(R);
    if (!isPlayer(a) && !(o && o.fall === false)) fallDown(a, secs, o || _bo, true);
    return true;
  };

  /* ============================================================
     PENETRATING — the round, the blade
     ============================================================ */
  // one blow's zone in this file's terms, from any caller's vocabulary
  function zoneOf(a, o) {
    if (o.head) return "head";
    let z = o.zone || "";
    if (z === "jaw" || z === "head") return "head";
    if (z === "neck") return "neck";
    if (z === "liver") return "abdomen";
    if (z === "legs") return rng() < 0.5 ? "legL" : "legR";
    if (z === "arms") return rng() < 0.5 ? "armL" : "armR";
    if (z === "armL" || z === "armR" || z === "legL" || z === "legR" || z === "chest" || z === "abdomen") return z;
    // "torso", "body" or nothing: the height of the hole above his feet decides
    const p = posOf(a);
    if (o.point && p && o.point.y != null) {
      const s = (rigOf(a) && rigOf(a).group && rigOf(a).group.userData && rigOf(a).group.userData.humanScale) || 0.7;
      const h = (o.point.y - (p.y || 0)) / (s / 0.7);
      if (h > 1.62) return "head";
      if (h > 1.45) return "neck";
      if (h > 1.12) return "chest";
      if (h > 0.9) return "abdomen";
      return rng() < 0.5 ? "legL" : "legR";
    }
    return rng() < 0.55 ? "chest" : "abdomen";
  }
  // bleed rate (fraction of his blood per second) and what the hole hit
  function holeOf(kind, zone, cal) {
    const c = Math.max(0.5, Math.min(2.2, cal || 1));
    const blade = kind === "stab" || kind === "slash";
    const cut = kind === "slash" ? 0.7 : 1;
    let rate = 0.004, lethal = false, artery = false;
    switch (zone) {
      case "head":
        if (kind === "bullet" || kind === "blast") { lethal = rng() > 0.1; rate = 0.004; }
        else { lethal = kind === "stab" && rng() < 0.12; rate = 0.0035; }
        break;
      case "neck":
        artery = rng() < (blade ? 0.55 : 0.6);
        rate = artery ? 0.028 : 0.008;
        lethal = kind === "bullet" && c >= 1.2 && rng() < 0.3;       // the spine
        break;
      case "chest":
        if (kind === "bullet" || kind === "blast") lethal = rng() < 0.09 * Math.min(1.6, c);   // the heart
        else if (kind === "stab") lethal = rng() < 0.05;
        rate = (blade ? 0.0065 : 0.0055 * c) * cut;
        break;
      case "abdomen":
        artery = rng() < 0.2;                                          // the liver, the aorta's branches
        rate = (artery ? 0.011 : (blade ? 0.005 : 0.0045 * c)) * cut;
        break;
      case "armL": case "armR":
        artery = rng() < (blade ? 0.16 : 0.1);
        rate = artery ? 0.009 : (blade ? 0.0026 : 0.0018 * c) * cut;
        break;
      case "legL": case "legR":
        artery = rng() < (blade ? 0.14 : 0.12);                       // the femoral
        rate = artery ? 0.012 : (blade ? 0.003 : 0.0022 * c) * cut;
        break;
      default: rate = 0.004;
    }
    if (kind === "bite") rate *= 1.4;
    return { rate, lethal, artery };
  }
  // the part of his rig nearest the hole (the wrap and the pool follow it)
  let _v3 = null;
  function partNear(ch, point, zone) {
    if (!ch || !ch.parts) return null;
    const P = ch.parts, L = ch.low || {};
    if (zone === "head" || zone === "neck") return ch.head || ch.neck || null;
    if (zone === "chest" || zone === "abdomen") return ch.body || null;
    const pick = { armL: [P.la, L.la], armR: [P.ra, L.ra], legL: [P.ll, L.ll], legR: [P.rl, L.rl] }[zone];
    if (!pick) return ch.body || null;
    const up = pick[0], lo = pick[1];
    if (!point || !lo || !up || !lo.getWorldPosition || !window.THREE) return up || lo || null;
    const V3 = _v3 || (_v3 = new window.THREE.Vector3());
    lo.getWorldPosition(V3);
    const dl = (V3.x - point.x) ** 2 + (V3.y - point.y) ** 2 + (V3.z - point.z) ** 2;
    up.getWorldPosition(V3);
    const du = (V3.x - point.x) ** 2 + (V3.y - point.y) ** 2 + (V3.z - point.z) ** 2;
    return dl < du ? lo : up;
  }
  VT.wound = function (a, o) {
    a = real(a);
    o = o || _bo;
    const res = { outcome: "ok", rate: 0, zone: "" };
    if (!a) return res;
    const R = of(a);
    const kind = o.kind || "bullet";
    const zone = zoneOf(a, o);
    res.zone = zone;
    const H = holeOf(kind, zone, o.cal);
    const ch = rigOf(a);
    const b = {
      zone, kind, rate: H.rate, rate0: H.rate, band: 0, t: 0, artery: H.artery,
      tau: H.artery ? 900 : H.rate < 0.003 ? 110 : H.rate < 0.008 ? 240 : 500,
      obj: partNear(ch, o.point, zone), lp: null,
    };
    // remember WHERE on that part, so the wrap sits over the hole
    if (b.obj && o.point && b.obj.worldToLocal && window.THREE) {
      b.lp = b.obj.worldToLocal(new window.THREE.Vector3(o.point.x, o.point.y, o.point.z));
    }
    R.lastHitT = clock;
    if (o.by) R.by = o.by;
    if (R.band && R.band.medic === a) cancel(R);
    wake(R);
    // A DEAD MAN: the heart has stopped, but a new hole still lets out what is
    // in him, so the pool under him grows with every one (to a cap)
    if (deadOf(a) || R.dead) {
      b.rate *= 0.6; b.tau = 22; b.dead = true;
      R.bleeds.push(b);
      R.pour += 0.02;
      trimBleeds(R);
      res.outcome = "dead"; res.rate = b.rate;
      return res;
    }
    if (o.critical) b.rate *= K.CRIT_BOOST;
    R.bleeds.push(b);
    trimBleeds(R);
    res.rate = b.rate;
    // TRULY LETHAL: the head, the heart, a body riddled with rounds
    const torso = zone === "chest" || zone === "abdomen";
    if (torso && (kind === "bullet" || kind === "blast")) {
      R.riddle = Math.max(0, R.riddle - (clock - R.riddleT) * (K.RIDDLED / 20)) + Math.max(0.6, o.cal || 1);
      R.riddleT = clock;
    }
    const cause = kind === "stab" || kind === "slash" ? "stabbed" : (zone === "head" ? "headshot" : "shot");
    if (H.lethal || R.riddle >= K.RIDDLED) {
      res.outcome = "dead";
      if (o.noKill !== true) kill(a, cause, { by: o.by, fromX: o.fromX, fromZ: o.fromZ, melee: kind === "stab" || kind === "slash" ? "blade" : null });
      return res;
    }
    // THE GAME'S HP RAN OUT but nothing vital was hit: he goes down, awake,
    // bleeding hard. Someone gets to him in time, or he bleeds out there.
    if (o.critical && !R.critical) {
      R.critical = true;
      fallDown(a, 9999, o, true);
      res.outcome = "down";
    } else if (R.critical) res.outcome = "down";
    return res;
  };
  function trimBleeds(R) {
    // merge the smallest when a body is riddled: no list grows without bound
    if (R.bleeds.length <= 24) return;
    R.bleeds.sort((x, y) => (y.rate * (1 - y.band)) - (x.rate * (1 - x.band)));
    const gone = R.bleeds.splice(20);
    for (let i = 0; i < gone.length; i++) R.bleeds[19].rate += gone[i].rate * (1 - gone[i].band);
  }

  /* ============================================================
     BANDAGING
     ============================================================ */
  function worstBleed(R) {
    let best = null, br = 0.0004;
    for (let i = 0; i < R.bleeds.length; i++) {
      const b = R.bleeds[i];
      const r = b.rate * (1 - b.band);
      if (b.band < 0.5 && r > br) { br = r; best = b; }
    }
    return best;
  }
  /* THE PLAYER'S ROLLS live in the game's own pockets when it has them (the
     prison's g.inventory, the city's bag): hooks.rolls() -> count and
     hooks.useRoll(n) (n < 0 spends, n > 0 adds). No hook: CBZ.player._bandages. */
  function playerRolls() {
    const h = hook("rolls");
    if (h) { try { return h() | 0; } catch (e) { return 0; } }
    const P = CBZ.player; return P ? (P._bandages | 0) : 0;
  }
  function addRolls(n) {
    const h = hook("useRoll");
    if (h) { try { h(n); } catch (e) { /* game pockets */ } return playerRolls(); }
    const P = CBZ.player; if (!P) return 0;
    P._bandages = Math.max(0, (P._bandages | 0) + n);
    return P._bandages;
  }
  VT.bandages = playerRolls;
  VT.giveBandage = function (n) { return addRolls(n == null ? 1 : n | 0); };
  // medic wraps patient's worst open bleed. Self when patient is omitted.
  VT.bandage = function (medic, patient, o) {
    medic = real(medic); patient = real(patient || medic);
    o = o || _bo;
    if (!medic || !patient || deadOf(medic) || deadOf(patient)) return false;
    const ms = state(medic);
    if (ms === "ko" || ms === "tased") return false;
    if (medic !== patient && ms !== "ok") return false;
    const R = peek(patient);
    if (!R || R.band) return false;
    const b = worstBleed(R);
    if (!b) return false;
    if (medic !== patient) {
      const p = posOf(medic), q = posOf(patient);
      if (p && q && Math.hypot(p.x - q.x, p.z - q.z) > 1.8) return false;
    }
    // the player needs a real roll; anybody else tears his shirt
    const roll = isPlayer(medic) ? playerRolls() > 0 : !!o.roll;
    if (isPlayer(medic) && !roll && !o.cloth) return false;
    const dur = (roll ? (medic === patient ? K.BAND_SELF : K.BAND_OTHER) : K.BAND_CLOTH) * (o.durMul || 1);
    R.band = { medic, bleed: b, t: 0, dur, roll, x0: 0, z0: 0 };
    const mp = posOf(medic);
    if (mp) { R.band.x0 = mp.x; R.band.z0 = mp.z; }
    wake(R);
    const MR = of(medic); MR.medicOf = R; wake(MR);
    return true;
  };
  function cancel(R) {
    if (!R.band) return;
    const M = peek(R.band.medic);
    if (M && M.medicOf === R) M.medicOf = null;
    R.band = null;
  }
  VT.cancelBandage = function (a) {
    const R = peek(a); if (R && R.band) { cancel(R); return true; }
    const M = peek(a); if (M && M.medicOf) { cancel(M.medicOf); return true; }
    return false;
  };
  VT.bandaging = function (a) {
    const R = peek(a);
    const B = R && (R.band || (R.medicOf && R.medicOf.band));
    return B ? clamp01(B.t / B.dur) : -1;
  };
  function finishBandage(R) {
    const B = R.band, b = B.bleed;
    cancel(R);
    if (R.bleeds.indexOf(b) < 0) return;
    const limb = b.zone === "armL" || b.zone === "armR" || b.zone === "legL" || b.zone === "legR";
    const k = limb ? 0.95 : b.zone === "head" ? 0.85 : b.zone === "neck" ? 0.55 : 0.7;
    b.band = B.roll ? k : k * 0.8;
    b.tau = Math.min(b.tau, 70);
    if (isPlayer(B.medic) && B.roll) addRolls(-1);
    addWrap(R, b, !B.roll);
    // a man who was down and is no longer pouring gets up in a while
    if (R.critical && rateOf(R) < 0.004) { R.critical = false; R.riseT = 6; }
  }

  /* A FULL DRESSING (a medkit, a hospital, a night in bed): every open hole
     wrapped at once, and some of the blood made back. No hands-on time: the
     caller already spent it (the kit is used, the night slept). */
  VT.dress = function (a, o) {
    a = real(a);
    const R = peek(a);
    if (!R || R.dead || deadOf(a)) return 0;
    o = o || _bo;
    if (R.band) cancel(R);
    let n = 0;
    for (let i = 0; i < R.bleeds.length; i++) {
      const b = R.bleeds[i];
      if (b.band >= 0.9 || b.rate < 0.0004) continue;
      const limb = b.zone === "armL" || b.zone === "armR" || b.zone === "legL" || b.zone === "legR";
      b.band = limb ? 0.97 : b.zone === "neck" ? 0.8 : 0.9;
      b.tau = Math.min(b.tau, 60);
      addWrap(R, b, false);
      n++;
    }
    if (R.leg && !R.leg.splint && legMul(R) < 1) { R.leg.mul = Math.max(R.leg.mul, 0.78); R.leg.splint = true; n++; }
    if (o.blood) R.blood = Math.min(1, R.blood + o.blood);
    if (R.critical && rateOf(R) < 0.004) { R.critical = false; R.riseT = isPlayer(a) ? 1.5 : 6; }
    wake(R);
    return n;
  };

  /* ---- the wrap: a gauze band around the limb, over the hole ---- */
  let WRAP_G = null, WRAP_M = null, WRAP_MS = null, WRAP_MC = null;
  function wrapAssets() {
    const THREE = window.THREE;
    if (!THREE) return false;
    if (!WRAP_G) {
      WRAP_G = new THREE.CylinderGeometry(1, 1, 1, 14, 2, true);
      // the layers: a slightly wavy edge so it reads as wound cloth, not a pipe
      const p = WRAP_G.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i), x = p.getX(i), z = p.getZ(i);
        const ang = Math.atan2(z, x);
        const f = 1 + 0.035 * Math.sin(ang * 3 + y * 6) + (Math.abs(y) > 0.4 ? -0.02 : 0.015);
        p.setXYZ(i, x * f, y + 0.06 * Math.sin(ang), z * f);
      }
      WRAP_G.computeVertexNormals();
      WRAP_G._shared = true;
      WRAP_M = new THREE.MeshLambertMaterial({ color: 0xe6e0d2, side: THREE.DoubleSide });
      WRAP_MS = new THREE.MeshLambertMaterial({ color: 0xc9a79c, side: THREE.DoubleSide });   // soaked through
      WRAP_MC = new THREE.MeshLambertMaterial({ color: 0x8f8a7c, side: THREE.DoubleSide });   // torn shirt
      WRAP_M._shared = WRAP_MS._shared = WRAP_MC._shared = true;
    }
    return true;
  }
  function addWrap(R, b, cloth) {
    const obj = b.obj;
    if (!obj || !wrapAssets()) return null;
    const THREE = window.THREE;
    const m = new THREE.Mesh(WRAP_G, cloth ? WRAP_MC : (b.rate0 > 0.008 ? WRAP_MS : WRAP_M));
    m.userData._vtWrap = true;
    m.castShadow = false; m.receiveShadow = false;
    // every part's local frame has its long axis on y (limbs hang down from
    // the pivot; the torso and head stand up): wrap around that axis, at the
    // height of the hole, as wide as the hole is far from the axis
    let y = 0, r = 0.09, h = 0.09;
    const lp = b.lp;
    if (lp) { y = lp.y; r = Math.hypot(lp.x, lp.z); }
    const zone = b.zone;
    const trunk = zone === "chest" || zone === "abdomen";
    if (zone === "head") { r = Math.max(0.085, Math.min(0.16, r || 0.12)); h = 0.05; }
    else if (trunk) { r = Math.max(0.13, Math.min(0.28, r || 0.2)); h = 0.12; }
    else if (zone === "neck") { r = Math.max(0.05, Math.min(0.1, r || 0.07)); h = 0.05; }
    else { r = Math.max(0.035, Math.min(0.11, r || 0.06)); h = 0.085; }
    // lp and r were measured in the part's own frame, so they already carry
    // its scale; the band's height is a real width of gauze
    m.position.set(0, y, 0);
    m.scale.set(r * 1.08, h, r * 1.08);
    obj.add(m);
    R.wraps.push(m);
    if (R.wraps.length > 8) { const old = R.wraps.shift(); if (old.parent) old.parent.remove(old); }
    return m;
  }
  function clearWraps(R) {
    for (let i = 0; i < R.wraps.length; i++) { const m = R.wraps[i]; if (m.parent) m.parent.remove(m); }
    R.wraps.length = 0;
  }

  /* ---- the bandaging hands: arms in, one hand circling the hole ---- */
  function poseBandage(R, dt) {
    const B = R.band; if (!B) return;
    const ch = rigOf(B.medic);
    if (!ch || !ch.parts || !ch.parts.la) return;
    if (isPlayer(B.medic) && CBZ.fps && CBZ.fps.active) return;   // first person: the FP hands own it
    const P = ch.parts, L = ch.low || {};
    const t = B.t, k = Math.min(1, t / 0.35) * Math.min(1, (B.dur - t) / 0.3 + 0.2);
    const zone = B.bleed.zone;
    const self = B.medic === R.a;
    const w = Math.sin(t * 7.5);
    // which hand works and which holds: a wound on his left arm is worked by the right
    const worker = zone === "armR" ? "la" : "ra", holder = worker === "ra" ? "la" : "ra";
    const low = self && (zone === "legL" || zone === "legR") ? 0.55 : 0;
    const pw = P[worker], ph = P[holder], lw = L[worker], lh = L[holder];
    if (pw) { pw.rotation.x += (-1.05 - low - pw.rotation.x) * k; pw.rotation.z += ((worker === "ra" ? 0.35 : -0.35) + 0.22 * w - pw.rotation.z) * k; }
    if (lw) lw.rotation.x += (-1.25 + 0.3 * w - lw.rotation.x) * k;
    if (self && (zone === "armL" || zone === "armR")) {
      // the hurt arm held out across the body
      if (ph) { ph.rotation.x += (-0.9 - ph.rotation.x) * k; ph.rotation.z += ((holder === "ra" ? 0.55 : -0.55) - ph.rotation.z) * k; }
      if (lh) lh.rotation.x += (-0.5 - lh.rotation.x) * k;
    } else {
      if (ph) { ph.rotation.x += (-0.85 - low - ph.rotation.x) * k; ph.rotation.z += ((holder === "ra" ? 0.3 : -0.3) - 0.12 * w - ph.rotation.z) * k; }
      if (lh) lh.rotation.x += (-1.1 - lh.rotation.x) * k;
    }
    if (ch.neck) ch.neck.rotation.x += (0.42 - ch.neck.rotation.x) * k;
  }

  /* ============================================================
     THE PLAYER'S SIGHT: grey and closing in as the blood goes
     ============================================================ */
  let veil = null, veilK = -1;
  function sight(dt) {
    const P = CBZ.player;
    const R = P && P._vt;
    let k = 0;
    if (R && !P.dead) {
      k = weak(R);
      if (R.koT > 0 || R.collapsed) k = 1;
    }
    if (k < 0.01 && veilK <= 0.01) return;
    if (typeof document === "undefined" || !document.createElement) return;
    if (!veil) {
      veil = document.createElement("div");
      veil.id = "vitalsVeil";
      veil.setAttribute("aria-hidden", "true");
      const s = veil.style;
      s.position = "fixed"; s.left = "0"; s.top = "0"; s.right = "0"; s.bottom = "0";
      s.pointerEvents = "none"; s.zIndex = "6";
      s.background = "radial-gradient(ellipse at center, rgba(128,128,128,0) 35%, rgba(90,90,90,.55) 75%, rgba(20,20,20,.9) 100%)";
      s.mixBlendMode = "saturation";
      s.opacity = "0";
      const inner = document.createElement("div");
      const si = inner.style;
      si.position = "absolute"; si.left = "0"; si.top = "0"; si.right = "0"; si.bottom = "0";
      si.background = "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,.75) 100%)";
      si.mixBlendMode = "normal";
      veil.appendChild(inner);
      veil._inner = inner;
      if (document.body && document.body.appendChild) document.body.appendChild(veil);
    }
    const q = Math.round(k * 40) / 40;
    if (q === veilK) return;
    veilK = q;
    // a heartbeat in the dark edge once it is bad
    veil.style.opacity = String(Math.min(1, q * 1.1));
    if (veil._inner) veil._inner.style.opacity = String(Math.max(0, (q - 0.3) / 0.7));
  }

  /* ============================================================
     THE TICK
     ============================================================ */
  const _wp = { x: 0, y: 0, z: 0 };
  let _v3b = null;
  function bleedPoint(R, b) {
    const obj = b && b.obj;
    if (obj && obj.getWorldPosition && window.THREE) {
      const V3 = _v3b || (_v3b = new window.THREE.Vector3());
      obj.getWorldPosition(V3);
      _wp.x = V3.x; _wp.y = V3.y; _wp.z = V3.z;
      return _wp;
    }
    const p = posOf(R.a);
    if (!p) return null;
    _wp.x = p.x; _wp.y = p.y || 0; _wp.z = p.z;
    return _wp;
  }
  function lying(R) {
    const a = R.a;
    if (R.dead || R.koT > 0 || R.collapsed || R.critical) return true;
    if (deadOf(a)) return true;
    const ch = rigOf(a);
    return !!(ch && ch.fall && ch.fall.on && ch.fall.phase === "down");
  }
  function blood(R, dt) {
    const a = R.a;
    let r = 0;
    for (let i = R.bleeds.length - 1; i >= 0; i--) {
      const b = R.bleeds[i];
      b.t += dt;
      // clotting: slow for an artery, fast for a graze, fast once wrapped;
      // a dead heart stops pushing and the ooze runs down in seconds
      const tau = b.dead || R.dead ? Math.min(b.tau, 22) : b.band > 0 ? Math.min(b.tau, 70) : b.tau;
      b.rate *= Math.exp(-dt / tau);
      if (b.rate < 0.00012) {
        R.bleeds.splice(i, 1);
        continue;
      }
      r += b.rate * (1 - b.band);
    }
    // the ground: drips while he moves, a pool once he lies in it
    const lie = lying(R);
    if (r > 0.0002) {
      if (lie) {
        R.pour += r * dt;
      } else {
        R.dripT -= dt;
        if (R.dripT <= 0) {
          R.dripT = Math.max(0.12, Math.min(2.5, 0.003 / r)) * (0.7 + rng() * 0.6);
          const b = R.bleeds.length ? R.bleeds[(rng() * R.bleeds.length) | 0] : null;
          const p = bleedPoint(R, b);
          if (p && CBZ.goreDrip) { try { CBZ.goreDrip(p.x + (rng() - 0.5) * 0.12, p.z + (rng() - 0.5) * 0.12, 0.15 + Math.min(0.35, r * 25)); } catch (e) { /* gore off */ } }
        }
      }
    }
    if (lie && R.pour > 0 && R.poolN < K.POOL_CAP) {
      R.poolAt -= dt;
      // a new, bigger layer of the pool each time enough has come out of him
      const need = R.poolN === 0 ? 0.004 : 0.012 + R.poolN * 0.002;
      if (R.poolAt <= 0 && R.pour >= need) {
        R.poured += R.pour; R.pour = 0;
        R.poolAt = 1.4;
        const worst = worstAny(R);
        const p = bleedPoint(R, worst);
        const size = Math.min(K.POOL_MAX, 0.45 + Math.sqrt(R.poured) * 3.2);
        if (p && CBZ.gorePool) {
          try { CBZ.gorePool(p.x + (rng() - 0.5) * 0.15, p.z + (rng() - 0.5) * 0.15, size); R.poolN++; } catch (e) { /* gore off */ }
        } else R.poolN++;
      }
    }
    if (R.dead || deadOf(a)) return r;
    R.blood -= r * dt;
    if (r < 0.0004 && R.blood < 1) R.blood = Math.min(1, R.blood + K.REGEN * dt);
    return r;
  }
  function worstAny(R) {
    let best = null, br = -1;
    for (let i = 0; i < R.bleeds.length; i++) { const b = R.bleeds[i]; const v = b.rate * (1 - b.band); if (v > br) { br = v; best = b; } }
    return best;
  }
  function safe(R) {
    const a = R.a;
    if (clock - R.lastHitT < K.SAFE_T) return false;
    const h = hook("safe");
    if (h) { try { return h(a) !== false; } catch (e) { return false; } }
    if (a.foe || a.huntPlayer > 0 || a.hunt > 0 || (a.alarmed > 0 && a.alarmed > 3) || a.fleeing) return false;
    return true;
  }
  function tickOne(R, dt) {
    const a = R.a;
    // came back (a respawn, a pooled rig reused for a living man): fresh body
    if (R.dead && !deadOf(a)) { reset(a); return false; }
    if (!R.dead && deadOf(a)) { R.dead = true; R.koT = 0; R.collapsed = false; R.critical = false; if (R.band) cancel(R); }
    const r = blood(R, dt);
    if (R.dead) return R.bleeds.length > 0 || R.pour > 0.002;

    R.daze = Math.max(0, R.daze - K.DAZE_DECAY * dt);
    if (R.tasedT > 0) R.tasedT = Math.max(0, R.tasedT - dt);

    // bled out
    if (R.blood < K.BLOOD_DEAD) { kill(a, R.cause === "stabbed" ? "stabbed" : "bled out", { by: R.by }); return true; }
    // blood collapse: unconscious, and held there until the blood comes back
    if (!R.collapsed && R.blood < K.BLOOD_COLLAPSE) {
      R.collapsed = true;
      if (R.band) cancel(R);
      fallDown(a, 9999, _bo, false);
    } else if (R.collapsed && R.blood > K.BLOOD_WAKE && r < 0.001) {
      R.collapsed = false;
      if (!(R.koT > 0) && !R.critical) { getUp(a); R.groggyT = K.GROGGY * 1.5; }
    }
    // the blunt KO runs out: he comes to, groggy
    if (R.koT > 0) {
      R.koT -= dt;
      if (R.koT <= 0) {
        R.koT = 0;
        if (!R.collapsed && !R.critical) {
          R.groggyT = K.GROGGY;
          // the fall's own clock was given the same duration; make sure he rises
          getUp(a);
        }
      }
    }
    // critical but the bleeding has stopped on its own (clotted, or every hole
    // too small to wrap): nothing left to bandage, so nothing would ever lift
    // the flag. He gets himself up in a while, the same as a wrapped man.
    if (R.critical && !R.band && r < 0.0012 && !R.collapsed && !(R.koT > 0)) { R.critical = false; R.riseT = 6; }
    // critical and wrapped: he gets himself up after a while
    if (R.riseT > 0) { R.riseT -= dt; if (R.riseT <= 0 && !R.collapsed && !(R.koT > 0) && !R.critical) { getUp(a); R.groggyT = K.GROGGY; } }
    // groggy: a stumble now and then
    if (R.groggyT > 0) {
      R.groggyT = Math.max(0, R.groggyT - dt);
      R.stumbleT -= dt;
      if (R.stumbleT <= 0) {
        R.stumbleT = 1.3 + rng() * 2.2;
        const V = CBZ.verbs, ch = rigOf(a);
        if (V && V.react && ch && !(ch.fall && ch.fall.on) && !isPlayer(a)) {
          const ang = rng() * Math.PI * 2;
          try { V.react(a, { zone: "body", reaction: "stagger", stagger: true, power: 0.25 + 0.3 * (R.groggyT / K.GROGGY), dir: { x: Math.sin(ang), z: Math.cos(ang) } }); } catch (e) { /* no rig */ }
        }
      }
    }
    // hold a man on the floor for as long as this file says he is there (the
    // koMode brains read a.ko; the rig's fall is held by its long dur)
    if (!isPlayer(a) && (R.collapsed || R.critical || R.koT > 0) && koMode()) a.ko = Math.max(a.ko || 0, R.koT > 0 ? R.koT + 0.5 : 1.5);

    // bandaging in progress (R is the patient)
    if (R.band) {
      const B = R.band, m = B.medic;
      const ms = state(m);
      let stop = deadOf(m) || ms === "ko" || ms === "tased";
      const MR = peek(m);
      if (MR && MR.lastHitT > clock - dt * 1.5 && B.t > 0.05) stop = true;
      const mp = posOf(m), pp = posOf(a);
      if (m !== a && mp && pp && Math.hypot(mp.x - pp.x, mp.z - pp.z) > 2.2) stop = true;
      if (isPlayer(m) && mp && Math.hypot(mp.x - B.x0, mp.z - B.z0) > 0.9) stop = true;   // walked off
      if (stop) cancel(R);
      else { B.t += dt; if (B.t >= B.dur) finishBandage(R); }
    } else if (!isPlayer(a) && r > 0.0006 && (state(a) === "ok" || R.critical) && safe(R)) {
      // an NPC who is safe wraps himself
      if (VT.unbandaged(a) > 0) VT.bandage(a, a, { roll: !!a.medic || !!a._bandages });
    }

    // the player: go down / come round through the game's own seam
    if (isPlayer(a)) {
      const down = R.collapsed || R.koT > 0 || R.critical;
      if (down !== !!R.pDown) {
        R.pDown = down;
        const h = hook("playerDown");
        if (h && !down) { try { h(false, {}); } catch (e) { /* game hook */ } }
      }
      if (down && CBZ.player && !hook("playerDown")) CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.3);
    }
    return r > 0.0002 || R.koT > 0 || R.collapsed || R.critical || R.groggyT > 0 || R.tasedT > 0 || !!R.band || !!R.medicOf ||
      R.blood < 1 || R.daze > 0.01 || R.riseT > 0 || R.pour > 0.002;
  }
  function reset(a) {
    a = real(a);
    const R = a && a._vt;
    if (!R) return;
    if (R.band) cancel(R);
    clearWraps(R);
    const i = LIST.indexOf(R);
    if (i >= 0) LIST.splice(i, 1);
    a._vt = null;
  }
  VT.reset = reset;

  function tick(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    clock += dt;
    for (let i = LIST.length - 1; i >= 0; i--) {
      const R = LIST[i];
      if (!R.a || R.a._vt !== R) { LIST.splice(i, 1); R.live = false; continue; }
      let keep = true;
      try { keep = tickOne(R, dt); } catch (e) { keep = false; }
      if (!keep && LIST[i] === R && !R.band && !R.medicOf) {
        // quiet: stop walking him (his record stays for state())
        LIST.splice(i, 1); R.live = false;
        if (R.dead && R.bleeds.length === 0) { /* corpse done pouring */ }
      }
    }
  }
  VT.tick = tick;
  VT.now = function () { return clock; };

  function poses(dt) {
    for (let i = 0; i < LIST.length; i++) { const R = LIST[i]; if (R.band) { try { poseBandage(R, dt); } catch (e) { /* no rig */ } } }
    try { sight(dt); } catch (e) { /* no DOM */ }
  }
  VT.poses = poses;

  if (CBZ.onUpdate) {
    CBZ.onUpdate(57, function (dt) { if (!CBZ.game || CBZ.game.state === "playing") tick(dt); });
    // after every animChar and the strike pass (86): the bandaging hands
    CBZ.onUpdate(88, function (dt) { if (!CBZ.game || CBZ.game.state === "playing") poses(dt); });
  }
})();
