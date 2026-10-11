/* ============================================================
   units/kit/canid.js — CBZ.canid: THE WILD DOG FAMILY, one rig, one brain.

   OWNED BY: the canid agent (gray wolf, Arctic wolf, coyote, red fox). The
   four species files in src/units/species/ are DATA (real measurements,
   coats, temperament); this file is the animal they share:

     BODY      one lofted, vertex-coloured, skinned shell on a 31-bone
               skeleton (CBZ.quadRig: 2 neck, 4 tail, ears, hackle ridge,
               3 per leg), built with CBZ.loftKit the way city/dogmodel.js
               builds the dog. A deep narrow keel chest, a tucked waist, long
               legs with real angulation (humerus/radius/metacarpus, femur/
               tibia/metatarsus), a thick ruff over neck and shoulders, cheek
               fur, a wedge skull with a long muzzle, a separate lower jaw,
               ivory canines and incisors, tongue and palate (only seen when
               the mouth opens), black lips and rhinarium, amber eyes with
               pupils, fur-edged ears, toes and claws, and a bushy tail with
               its violet-gland spot. One draw call a body; ONE geometry per
               species x sex x coat, cached; a skeleton per animal.
     COAT      agouti grizzle (banded guard hairs, per vertex), dark saddle and
               cape, pale mask / eyebrows / bib / underside, foreleg stripe,
               fox stockings and ear backs, tail tip — all from the species'
               palette, so one Lambert material serves every canid.
     GAIT      CBZ.quadGait with the CANID footfall table: lateral walk,
               diagonal trot (the endurance gait, with SINGLE-TRACKING: the
               feet converge on the midline as the trot speeds up, the wolf
               signature in snow), the three-beat lope, and the ROTARY gallop
               with double suspension (spine flexion + extension). Every foot
               plants; nothing slides.
     LIFE      alert / stalk / threat (hackles, snarl, ears) / fear (tuck,
               flatten) / idle (sniff, look round, ear flicks, sit, lie down,
               howl), a head that watches its quarry, hit reactions by body
               region (a flinch away from the blow, a yelp, a LIMP on a struck
               leg: head-nod lameness, or three-legged with the leg carried),
               and a death that hands the body to systems/quadruped_ragdoll.js
               through bone proxies (the solver drives the real skeleton).
     FIGHT     the canid close fight (replaces creature_combat's MAUL):
               pack slots on the quarry (the biggest animal leads), circling,
               testing, real attack repertoire chosen by what the quarry IS:
                 small prey      rush, grab, shake (throat / neck)
                 a man           limbs: arm and leg grabs, two dogs on him
                                 drag him down (CBZ.verbs.knockdown), then
                                 the throat
                 big / armed /   the REAR: hamstring and rump slashes, spring
                 dangerous       back out of the kick, circle, again; the
                                 lead takes the nose once the quarry weakens
                 a vehicle       stand off and never bite steel
               stamina (relay: a tired animal drops back, a fresh one goes
               in), courage from pack size and wounds (opportunists - the fox,
               the lone coyote - hold off and dart only at a turned back),
               bite contact measured at the real jaw point, damage from the
               species' bite force x where it landed x the angle.

   API (the maths half loads in node; build/animate need THREE + the kit)
     CBZ.canid.define(id, P)                   a species' data (species files)
     CBZ.canid.def(id) -> P
     CBZ.canid.stats(P) -> the unitKit stats block derived from P
     CBZ.canid.build(id, ctx) -> THREE.Group  (or null without the kit)
     CBZ.canid.animate(m, dt)                  the battle unit's pose
     CBZ.canid.fight(m, tgt, dt, opts) -> { inRange, dealt, missed }
     CBZ.canid.hooks(id) -> { build, animate, fight } for unitKit.register
     CBZ.canid.TABLE                           the CANID footfall table
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function wrapPi(a) { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; }
  function approach(cur, want, rate, dt) { return cur + (want - cur) * Math.min(1, rate * dt); }
  function mkRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function mixHex(a, b, t) {
    t = clamp(t, 0, 1);
    const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
    const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
    const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
  }
  // a stable per-vertex hash: the grizzle of banded guard hairs
  function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }

  const SPECIES = Object.create(null);

  // ==========================================================================
  //  THE CANID FOOTFALL TABLE. Feet FL FR HL HR. Real canid gait research
  //  (Hildebrand; wolf trackways): a lateral-sequence walk, the diagonal trot
  //  a wolf travels in for hours, a three-beat lope (canter), and the ROTARY
  //  gallop (LH, RH, RF, LF) with two flight phases.
  // ==========================================================================
  const TABLE = {
    gaits: [
      { name: "walk", key: "wW", off: [0.25, 0.75, 0.00, 0.50], duty: 0.64, lift: 0.05 },
      { name: "trot", key: "wT", off: [0.25, 0.75, -0.25, 0.25], duty: 0.44, lift: 0.075 },
      { name: "lope", key: "wC", off: [0.22, 0.42, 0.00, 0.22], duty: 0.36, lift: 0.095 },
      { name: "gallop", key: "wG", off: [0.52, 0.42, 0.00, 0.10], duty: 0.21, lift: 0.12 },
    ],
    trans: [[1.0, 1.4], [3.3, 4.0], [5.4, 6.8]],
    fMax: 3.7, f0: 1.0, fV: 0.36, strideMax: 1.3,
    vMove: 0.08, turnMove: 0.35, turnF: 1.7,
    settleRate: 2.8, restLift: 0.045, restStep: 0.065,
  };

  // ==========================================================================
  //  DIMS — the species' measured male, the female scaled, every bind point.
  // ==========================================================================
  const LIN = ["withers", "sh", "hipH", "bodyL", "fa", "fb", "fc", "ha", "hb", "hc", "neckLen", "headL", "muzzleL", "earL", "earW", "tailL", "pawR"];
  const GIRTH = ["chestRt", "chestRb", "chestW", "waistRt", "waistRb", "waistW", "rumpR", "rumpW", "neckR", "skullR", "skullW", "muzzleR", "muzzleW", "tailR", "ruff"];
  function dims(P, sex) {
    const D = Object.assign({}, P.body);
    if (sex === "f") {
      const fl = P.fLin || 0.95, fg = P.fGirth || 0.93;
      for (let i = 0; i < LIN.length; i++) if (D[LIN[i]] != null) D[LIN[i]] *= fl;
      for (let i = 0; i < GIRTH.length; i++) if (D[GIRTH[i]] != null) D[GIRTH[i]] *= fl * fg;
    }
    D.sex = sex;
    const K = D.K = D.withers / 0.62;
    D.ruff = D.ruff || 1;
    D.hipX = -D.bodyL / 2; D.shX = D.bodyL / 2;
    D.neckB = { x: D.shX + 0.05 * K, y: D.sh + 0.05 * K };
    D.headP = { x: D.neckB.x + Math.cos(D.neckAng) * D.neckLen, y: D.neckB.y + Math.sin(D.neckAng) * D.neckLen };
    D.u = { x: Math.cos(D.headAng), y: Math.sin(D.headAng) };
    D.jawP = { x: D.headP.x + D.u.x * D.headL * 0.42, y: D.headP.y + D.u.y * D.headL * 0.42 - D.skullR * 0.78 };
    D.earP = { x: D.headP.x - 0.012 * K, y: D.headP.y + D.skullR * 0.74, z: D.skullW * 0.6 };
    D.tailP = { x: D.hipX - 0.1 * K, y: D.hipH + 0.045 * K };
    D.tailL = D.tailL;
    D.hackleP = { x: D.shX - 0.06 * K, y: D.sh + D.chestRt * 0.92 };
    D.legZf = D.chestW * 0.5; D.legZh = D.rumpW * 0.6;
    D.FJ = { x: D.shX + 0.015 * K, y: D.sh - 0.015 * K };
    D.HJ = { x: D.hipX + 0.02 * K, y: D.hipH - 0.01 * K };
    D.legLen = Math.min(D.fa + D.fb, D.ha + D.hb);
    D.feet = [
      { x: D.FJ.x + 0.02 * K, z: -D.legZf, front: true },
      { x: D.FJ.x + 0.02 * K, z: D.legZf, front: true },
      { x: D.HJ.x - 0.05 * K, z: -D.legZh, front: false },
      { x: D.HJ.x - 0.05 * K, z: D.legZh, front: false },
    ];
    const tip = D.headL + D.muzzleL;
    D.mouth = { x: D.headP.x + D.u.x * tip, y: D.headP.y + D.u.y * tip - D.skullR * 0.45 };
    return D;
  }

  // ==========================================================================
  //  THE CANID CLOSE FIGHT and the STATS live in maths only (node-loadable).
  // ==========================================================================
  function stats(P) {
    const S = P.stats;
    return {
      hp: S.hp, spd: S.spd, danger: S.danger, bite: S.bite, scale: 1,
      chase: S.chase, march: S.march, dmg: S.dmg, rate: S.rate,
      brave: false, prey: false,
      mass: S.mass, topSpeed: S.topSpeed, accel: S.accel, endurance: S.endurance,
      biteN: S.biteN, hide: S.hide,
    };
  }

  // ---- the quarry, read honestly -------------------------------------------
  function massOf(t) {
    if (!t) return 78;
    if (t._cnMass) return t._cnMass;
    let ms = 78;
    if (t.vehicle) ms = 9000;
    else if (CBZ.bodyMass) { try { const v = CBZ.bodyMass(t); if (v > 0 && isFinite(v)) ms = v; } catch (e) {} }
    else if (t.beast && t.species && t.species.mass) ms = t.species.mass;
    t._cnMass = ms;
    return ms;
  }
  // which way the quarry faces: beasts (cos h, sin h); men by yaw (sin, cos)
  const _tf = { x: 1, z: 0 };
  function facing(t) {
    if (t.beast || t.vehicle) { const h = typeof t.heading === "number" ? t.heading : 0; _tf.x = Math.cos(h); _tf.z = Math.sin(h); }
    else { const y = typeof t.yaw === "number" ? t.yaw : 0; _tf.x = Math.sin(y); _tf.z = Math.cos(y); }
    return _tf;
  }
  function downed(t) {
    if (!t || t.beast || t.vehicle) return false;
    if (t.ko > 0) return true;
    const ch = t.char;
    return !!(ch && (ch.koPose || (ch.fall && ch.fall.on)));
  }
  // the height of what is being bitten, metres above the quarry's feet
  function biteHeight(t, loc) {
    if (!t.beast) {
      if (downed(t)) return 0.22;
      return loc === "arm" ? 1.12 : loc === "throat" ? 1.42 : 0.5;
    }
    const H = Math.max(0.3, (t.eyeH || 1) / 0.8);
    return loc === "hock" ? H * 0.28 : loc === "nose" ? H * 0.72 : loc === "throat" ? H * 0.62 : loc === "rump" ? H * 0.6 : H * 0.5;
  }

  // ---- THE PACK ON ONE QUARRY: a short list on the quarry itself -----------
  // Slots are kept in arrival order, except that a bigger animal takes the
  // lead (slot 0): the breeding male of a real pack is the one on the nose.
  function packOn(t, m) {
    let L = t._cnPack;
    if (!L) L = t._cnPack = [];
    // prune the dead, the gone, the ones who changed quarry or drifted off
    for (let i = L.length - 1; i >= 0; i--) {
      const o = L[i];
      if (o === m) continue;
      if (o.dead || o.fled || o.tgt !== t || Math.abs(o.pos.x - t.pos.x) + Math.abs(o.pos.z - t.pos.z) > 14) L.splice(i, 1);
    }
    let me = L.indexOf(m);
    if (me < 0) {
      const mm = m._cn ? m._cn.mass : 40;
      if (L.length && L[0]._cn && mm > L[0]._cn.mass * 1.08) { L.unshift(m); me = 0; }
      else { L.push(m); me = L.length - 1; }
    }
    let holders = 0;
    for (let i = 0; i < L.length; i++) if (L[i]._cf && L[i]._cf.ph === "hold") holders++;
    PK.slot = me; PK.n = L.length; PK.holders = holders;
    return PK;
  }
  const PK = { slot: 0, n: 1, holders: 0 };
  const RES = { inRange: false, dealt: 0, missed: false };

  function newFight(m) {
    const P = m._cn ? m._cn.P : null;
    return { ph: "close", pt: 0, cd: 0.2 + ((m.i || 0) % 5) * 0.12, stam: 1, side: ((m.i || 0) & 1) ? 1 : -1,
      loc: "flank", lungeT: 0.3, holdT: 0, yRaise: 0, biteY: 0.5, snapDone: false, feint: false,
      hitFlash: 0, kdT: 0, lastRel: 0, P: P, dartOk: false };
  }

  // the mover: the host's own seam (walls, ground) without its "stop at the
  // mouth" clamp, which is only right for a straight run-in
  function moveBy(m, o, dx, dz, step) {
    if (!(step > 0)) return;
    if (o && typeof o.move === "function") {
      const t0 = m.tgt; m.tgt = null;
      try { o.move(m, dx, dz, step); } catch (e) {}
      m.tgt = t0;
    } else { m.pos.x += dx * step; m.pos.z += dz * step; }
  }
  function turnTo(m, want, rate, dt) {
    let h = typeof m.heading === "number" ? m.heading : 0;
    const d = wrapPi(want - h), mx = rate * dt;
    h += d > mx ? mx : (d < -mx ? -mx : d);
    m.heading = h;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h);
    else if (m.group) m.group.rotation.y = -h;
    return d;
  }

  // ==========================================================================
  //  THE POSSESSED CANID (src/battle/player.js + src/units/kit/moves.js): a
  //  player has MOVE and ATTACK; the attack is chosen by the moment, the way
  //  a wolf chooses it.
  // ==========================================================================
  const CMOVES = {
    leap:      { id: "leap", style: "maul", pow: 1.2, dur: 0.42, rng: 1.1, leap: 0.9, cd: 0.8 },       // the running lunge
    snap:      { id: "snap", style: "bite", pow: 0.85, dur: 0.26, rng: 1.0, cd: 0.35 },                // a fast slash, in and out
    slash:     { id: "slash", style: "bite", pow: 1.0, dur: 0.34, rng: 1.0, cd: 0.5 },
    hamstring: { id: "hamstring", style: "bite", pow: 1.3, dur: 0.34, rng: 1.05, cd: 0.6 },            // from behind, low
    arm:       { id: "arm", style: "maul", pow: 1.1, dur: 0.46, rng: 1.1, leap: 0.4, cd: 0.7 },        // up at a man's arm
    grab:      { id: "grab", style: "maul", pow: 1.6, dur: 0.95, rng: 1.0, cd: 0.8, hold: true },     // bite and worry
    throat:    { id: "throat", style: "maul", pow: 2.1, dur: 1.1, rng: 1.05, cd: 0.9, hold: true },   // on the fallen
  };
  function moves(m, t, ctx) {
    ctx = ctx || {};
    const cn = m._cn, n = ctx.n || 1;
    const dist = ctx.dist == null ? 99 : ctx.dist, reach = ctx.reach || 2;
    if (!t) return n % 2 ? CMOVES.snap : CMOVES.slash;
    if (ctx.downed) return CMOVES.throat;
    const running = !!ctx.sprint || (ctx.chase > 0 && ctx.speed > ctx.chase * 0.5);
    if (dist > reach * 1.05 && running && dist < reach * 2.8) return CMOVES.leap;
    // where am I on it? a bite from behind goes for the hocks
    const tf = facing(t), dx = m.pos.x - t.pos.x, dz = m.pos.z - t.pos.z, dl = Math.hypot(dx, dz) || 1;
    const behind = (dx * tf.x + dz * tf.z) / dl < -0.3;
    const big = massOf(t) > (cn ? cn.mass : 40) * 2.5;
    if (behind && t.beast) return CMOVES.hamstring;
    if (!t.beast && !t.vehicle && cn && cn.withers > 0.55 && n % 3 === 1) return CMOVES.arm;
    if (!big && n % 3 === 0) return CMOVES.grab;
    return n % 2 ? CMOVES.slash : CMOVES.snap;
  }
  // play ONE chosen move on the latched clock (_atkAnim 0..1), then hand back
  function playerStrike(m, t, dt, o, cn) {
    const P = cn.P, B = P.fight, mv = o.youMove;
    const cf = m._cf || (m._cf = newFight(m));
    const dur = mv.dur > 0 ? mv.dur : B.lungeT * 1.2;
    if (!(m._atkAnim >= 0)) { RES.inRange = true; return RES; }
    if (m._atkAnim === 0) {
      cf.snapDone = false; cf.feint = false; cf.lastTick = -1; cf.gripped = false;
      cf.loc = mv.id === "hamstring" ? "hock" : mv.id === "arm" ? "arm" : mv.id === "throat" ? "throat" : "flank";
      cf.biteY = t && t.pos ? biteHeight(t, cf.loc) : 0.5;
    }
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1e-4;
    turnTo(m, Math.atan2(dz, dx), B.turn * 1.5, dt);
    const k0 = m._atkAnim, k = Math.min(1, k0 + dt / dur);
    m._atkAnim = k;
    // the clock the pose reads: a lunge maps straight on; a hold is a lunge
    // (its first ~0.3 s) and then the worry
    cf.lungeT = mv.hold ? Math.min(0.32, dur * 0.35) : dur;
    cf.pt = k * dur;
    cf.ph = mv.hold && cf.pt > cf.lungeT ? "hold" : "lunge";
    const nose = Math.max((m.rad || 0.5) * 1.05, m.noseR || 0.7);
    const tR = t.rad || 0.45;
    const snapAt = mv.hold ? (cf.lungeT * 0.62) / dur : 0.62;
    if (k0 < snapAt && k >= snapAt) {
      const h = m.heading || 0;
      const jx = m.pos.x + Math.cos(h) * nose, jz = m.pos.z + Math.sin(h) * nose;
      const jd = Math.hypot(t.pos.x - jx, t.pos.z - jz);
      if (jd <= (tR + 0.2 + 0.08 * cn.K) * (mv.rng || 1)) {
        const tf = facing(t), frontK = -(dx * tf.x + dz * tf.z) / d;
        const angMul = frontK < -0.4 ? 1.25 : frontK > 0.5 ? 0.85 : 1;
        const dmg = (o.dmg || P.stats.dmg) * (mv.hold ? 0.6 : (mv.pow || 1)) * angMul;
        if (typeof o.onHit === "function") o.onHit(dmg);
        if (CBZ.creatureBiteBlood && !t.dummy) { try { CBZ.creatureBiteBlood(m, t, "maul"); } catch (e) {} }
        RES.dealt = dmg; cf.gripped = !!mv.hold;
      } else { RES.missed = true; cf.gripped = false; }
    }
    // the worry: ticks of shake damage while the grip holds
    if (mv.hold && cf.gripped && k > snapAt) {
      if (d > (m.rad || 0.5) + tR + 0.15) moveBy(m, o, dx / d, dz / d, Math.min(d - (m.rad || 0.5) - tR, P.stats.chase * dt));
      const tick = Math.floor((k - snapAt) * dur / 0.3);
      if (tick !== cf.lastTick) {
        cf.lastTick = tick;
        if (tick > 0) {
          const dmg = (o.dmg || P.stats.dmg) * (mv.pow || 1) * B.shake;
          if (typeof o.onHit === "function") o.onHit(dmg);
          RES.dealt = dmg;
        }
      }
    }
    RES.inRange = true;
    if (k >= 1) { m._atkAnim = -1; cf.ph = "close"; cf.pt = 0; cf.gripped = false; }
    return RES;
  }

  function fight(m, t, dt, o) {
    RES.inRange = false; RES.dealt = 0; RES.missed = false;
    if (!m || !t || !m.pos || !t.pos || !(dt > 0)) return RES;
    const cn = m._cn;
    if (!cn) return CBZ.creatureFight ? CBZ.creatureFight(m, t, dt, o) : RES;
    const P = cn.P, B = P.fight;
    o = o || {};
    if (o.youMove) return playerStrike(m, t, dt, o, cn);
    const cf = m._cf || (m._cf = newFight(m));
    if (t.dead || t.fled) { cf.ph = "close"; return RES; }
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz) || 1e-4, ux = dx / d, uz = dz / d;
    const myR = m.rad || 0.5, tR = t.rad || 0.45;
    const nose = Math.max(myR * 1.05, m.noseR || myR * 1.4);
    const dC = myR + tR + 0.04;                  // bodies touching
    const rEng = dC + 0.45 + 0.25 * cn.K;         // the testing ring, a lunge out
    const tf = facing(t);
    const rel = Math.atan2(tf.z * ux - tf.x * uz, -(ux * tf.x + uz * tf.z));   // me, seen from the quarry: 0 = in its face, PI = behind
    const frontK = Math.cos(rel);                 // 1 in front .. -1 behind
    const pk = packOn(t, m);
    const tM = massOf(t), ratio = tM / cn.mass;
    const armed = !t.beast && !t.vehicle && !!t.armed && !t.fists;
    const tSp = t.beast && t.species ? t.species : null;
    const tHurt = t.maxHp ? t.hp / t.maxHp : 1;
    const meHurt = m.maxHp ? m.hp / m.maxHp : 1;
    let danger = t.vehicle ? 1 : tSp ? clamp((tSp.danger || 0) * 1.1 + (ratio > 3 ? 0.25 : 0) + (ratio > 8 ? 0.2 : 0), 0, 1) : (armed ? 0.55 : 0.3);
    if (downed(t)) danger *= 0.3;
    // courage: the species' boldness, the pack around it, blood in the water,
    // and its own wounds. An opportunist alone never takes on the big thing.
    let courage = B.bold + 0.16 * Math.min(4, pk.n - 1) - danger * 0.55 * Math.min(1, ratio / 2.5)
      + (tHurt < 0.5 ? 0.25 : 0) - (meHurt < 0.5 ? 0.3 : 0) + (downed(t) ? 0.4 : 0);
    if (B.opportunist && ratio > 2 && pk.n < 3) courage -= 0.35;
    RES.inRange = d < rEng + 0.6;
    cf.pt += dt;
    if (cf.cd > 0) cf.cd -= dt;
    if (cf.hitFlash > 0) cf.hitFlash -= dt;
    if (cf.kdT > 0) cf.kdT -= dt;

    // ---- a VEHICLE: wolves do not bite steel. Hold off, watch it, give way.
    if (t.vehicle) {
      cf.ph = "threat";
      const want = Math.atan2(dz, dx);
      turnTo(m, want, B.turn, dt);
      if (d < 9) moveBy(m, o, -ux, -uz, Math.min(9 - d, P.stats.chase * 0.5 * dt));
      cf.stam = Math.min(1, cf.stam + dt * 0.1);
      return RES;
    }

    // ---- where to bite, decided by what the quarry is -----------------------
    let desRel, loc, hold;
    const small = ratio < 1.25, man = !t.beast;
    if (man) {
      if (downed(t)) { desRel = rel; loc = "throat"; hold = true; }
      else if (armed && pk.n < 3 && frontK > 0.2) { desRel = cf.side * (1.95 + (pk.slot % 3) * 0.35); loc = "leg"; hold = ratio < 2.2; }
      else { desRel = pk.slot === 0 ? rel : cf.side * (1.5 + (pk.slot % 3) * 0.45); loc = pk.slot === 0 && cn.mass > 25 ? "arm" : "leg"; hold = ratio < 2.2; }
    } else if (small) {
      desRel = rel; loc = "throat"; hold = true;
    } else if (pk.slot === 0 && tHurt < 0.45 && pk.n >= 2 && danger < 0.8) {
      desRel = 0.4 * cf.side; loc = "nose"; hold = true;
    } else {
      desRel = cf.side * (2.45 + (pk.slot % 3) * 0.22); loc = (pk.slot % 2) ? "rump" : "hock";
      hold = (danger < 0.5 || pk.n >= 4) && ratio < 14 && tHurt < 0.85;
    }
    if (loc === "arm" && cn.withers < 0.5) loc = "leg";   // a fox does not leap for an arm
    cf.loc = loc;

    const want = Math.atan2(dz, dx);
    // ---- phases -------------------------------------------------------------
    switch (cf.ph) {
      case "lunge": {
        turnTo(m, want, B.turn * 1.4, dt);
        const k = cf.pt / cf.lungeT;
        // the drive: gather (0..0.3), the spring (0.3..0.62) closes the gap,
        // the snap at 0.62, then the body stops where its teeth did
        if (k > 0.25 && k < 0.66 && !cf.feint) {
          const room = d - dC;
          if (room > 0) moveBy(m, o, ux, uz, Math.min(room, P.stats.chase * 1.05 * dt));
        } else if (cf.feint && k > 0.25 && k < 0.45 && d > dC + 0.3) moveBy(m, o, ux, uz, P.stats.chase * 0.6 * dt);
        if (!cf.snapDone && k >= 0.62) {
          cf.snapDone = true;
          if (cf.feint) { RES.missed = true; }
          else {
            // THE TEETH: where the jaw actually is when it closes
            const h = m.heading || 0;
            const jx = m.pos.x + Math.cos(h) * nose * 0.98, jz = m.pos.z + Math.sin(h) * nose * 0.98;
            const jd = Math.hypot(t.pos.x - jx, t.pos.z - jz);
            if (jd <= tR + 0.2 + 0.08 * cn.K) {
              let dmg = (typeof o.dmg === "number" ? o.dmg : P.stats.dmg) * (0.85 + 0.3 * cn.rng());
              const angMul = frontK < -0.4 ? 1.25 : frontK > 0.5 ? 0.8 : 1.0;   // a rear bite is the one that counts
              const locMul = loc === "throat" ? 1.6 : loc === "hock" ? 1.15 : loc === "nose" ? 1.1 : 1.0;
              dmg *= angMul * locMul;
              if (typeof o.onHit === "function") o.onHit(dmg);
              else { t.hp -= dmg; }
              if (CBZ.creatureBiteBlood) { try { CBZ.creatureBiteBlood(m, t, "maul"); } catch (e) {} }
              RES.dealt = dmg;
              cf.hitFlash = 0.3;
              cf.stam = Math.max(0, cf.stam - 0.1 * B.tire);
              if (hold && !t.dead && courage > 0.15) { cf.ph = "hold"; cf.pt = 0; cf.holdT = B.holdT * (0.7 + 0.6 * cn.rng()); }
            } else { RES.missed = true; cf.cd = 0.25; }
          }
        }
        if (cf.ph === "lunge" && k >= 1) {
          cf.ph = (danger > 0.45 && !downed(t)) || cf.feint || courage < 0.3 ? "retreat" : "close";
          cf.pt = 0;
          cf.cd = (typeof o.rate === "number" ? o.rate : P.stats.rate) * (0.75 + 0.5 * cn.rng());
        }
        break;
      }
      case "hold": {
        // HANGING ON: the body follows the quarry, braced back, and worries
        turnTo(m, want, B.turn * 2, dt);
        if (d > dC + 0.05) moveBy(m, o, ux, uz, Math.min(d - dC, P.stats.chase * dt));
        else if (d < dC - 0.15) moveBy(m, o, -ux, -uz, Math.min(dC - d, 2 * dt));
        cf.stam = Math.max(0, cf.stam - dt * 0.16 * B.tire);
        const tick = Math.floor(cf.pt / 0.45);
        if (tick !== cf.lastTick) {
          cf.lastTick = tick;
          if (tick > 0) {
            let dmg = (typeof o.dmg === "number" ? o.dmg : P.stats.dmg) * B.shake * (loc === "throat" ? 1.7 : 1);
            if (typeof o.onHit === "function") o.onHit(dmg); else t.hp -= dmg;
            RES.dealt = dmg;
            // TWO ON A MAN TAKE HIM DOWN; a big wolf alone sometimes does
            if (man && !downed(t) && cf.kdT <= 0 && CBZ.verbs && CBZ.verbs.knockdown) {
              const pull = pk.holders >= 2 ? 0.55 : (cn.mass > 35 && loc === "leg" ? 0.12 : 0);
              if (pull > 0 && cn.rng() < pull) {
                cf.kdT = 4;
                try { CBZ.verbs.knockdown(t, { dir: { x: ux, z: uz }, power: 0.7, dur: 2.4 }); } catch (e) {}
              }
            }
          }
        }
        // let go: time, breath, or the quarry has turned on it with something that kills
        const swatted = !man && danger > 0.55 && frontK > 0.6 && !downed(t);
        if (cf.pt > cf.holdT || cf.stam < 0.15 || swatted || t.dead) {
          cf.ph = "retreat"; cf.pt = 0;
          cf.cd = (typeof o.rate === "number" ? o.rate : P.stats.rate) * 0.8;
        }
        break;
      }
      case "retreat": {
        // spring back out of the kick, still facing it
        turnTo(m, want, B.turn, dt);
        const dur = 0.45 + 0.35 * danger + (cf.stam < 0.3 ? 0.8 : 0);
        const out = rEng + 0.5 + danger * 0.9 + (cf.stam < 0.3 ? 1.5 : 0);
        if (d < out) {
          const lat = cf.side * 0.45;
          const ax = -ux - uz * lat, az = -uz + ux * lat, al = Math.hypot(ax, az) || 1;
          moveBy(m, o, ax / al, az / al, Math.min(out - d, P.stats.chase * 0.55 * dt));
        }
        cf.stam = Math.min(1, cf.stam + dt * 0.06);
        if (cf.pt > dur) { cf.ph = "close"; cf.pt = 0; if (cn.rng() < 0.35) cf.side = -cf.side; }
        break;
      }
      case "threat": {
        // the stand-off: hackles, snarl, feints; dart at a turned back
        turnTo(m, want, B.turn, dt);
        const hold = rEng + 0.9 + danger * 0.8;
        if (d < hold - 0.3) moveBy(m, o, -ux, -uz, Math.min(hold - d, P.stats.march * 0.9 * dt));
        else if (d > hold + 0.6) moveBy(m, o, ux, uz, Math.min(d - hold, P.stats.march * dt));
        cf.stam = Math.min(1, cf.stam + dt * 0.12);
        if (cf.cd <= 0) {
          if ((frontK < -0.2 && courage > 0.05) || courage > 0.45 || (tHurt < 0.35 && courage > 0)) { cf.ph = "close"; cf.pt = 0; }
          else if (cn.rng() < 0.5) { cf.ph = "lunge"; cf.feint = true; cf.snapDone = false; cf.pt = 0; cf.lungeT = B.lungeT * 0.8; cf.cd = 1.2; }
          else cf.cd = 0.6 + cn.rng() * 0.6;
        }
        break;
      }
      default: {   // "close" / "circle": get to the slot on the testing ring
        if (courage < 0.2 && !downed(t)) { cf.ph = "threat"; cf.pt = 0; cf.cd = 0.4; break; }
        if (cf.stam < 0.25) { cf.ph = "retreat"; cf.pt = 0; break; }
        cf.stam = Math.min(1, cf.stam + dt * 0.08);
        const diff = wrapPi(desRel - rel);
        const onSlot = Math.abs(diff) < 0.45 || (pk.slot === 0 && (small || man));
        const turned = frontK < 0.1;               // its head is not on me
        if (d <= rEng + 0.35 && cf.cd <= 0 && (onSlot || turned || downed(t) || (frontK > 0.4 && courage > 0.7))) {
          cf.ph = "lunge"; cf.pt = 0; cf.feint = false; cf.snapDone = false;
          cf.lungeT = B.lungeT * (loc === "arm" ? 1.25 : 1);
          cf.biteY = biteHeight(t, loc);
          break;
        }
        // where on the ring: the quarry's own frame, swung toward the slot
        const step = clamp(diff, -1, 1) * Math.min(1, (P.stats.chase * 0.6 * dt) / Math.max(0.5, d));
        const a = rel + step;
        // the ring point in the world (rel measured from the quarry's facing)
        const ca = Math.cos(a), sa = Math.sin(a);
        const wx = tf.x * ca - tf.z * sa, wz = tf.x * sa + tf.z * ca;
        const r = onSlot ? Math.max(dC, rEng - 0.1) : rEng + 0.25;
        const gx = t.pos.x + wx * r, gz = t.pos.z + wz * r;
        const mx = gx - m.pos.x, mz = gz - m.pos.z, md = Math.hypot(mx, mz);
        const spd = (md > 2 ? P.stats.chase * 0.8 : P.stats.chase * 0.5) * (armed && frontK > 0.3 ? 1.15 : 1);
        if (md > 0.04) {
          // an armed man in front: weave as it closes
          let nx = mx / md, nz = mz / md;
          if (armed && frontK > 0.3) { const wv = Math.sin(cf.pt * 7 + (m.i || 0)) * 0.5; nx += -nz * wv; nz += nx * wv; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; }
          moveBy(m, o, nx, nz, Math.min(md, spd * dt));
          // run the way it moves while far, square up to it once on the ring
          turnTo(m, md > 0.6 && d > rEng ? Math.atan2(nz, nx) : want, B.turn, dt);
        } else turnTo(m, want, B.turn, dt);
        cf.biteY = biteHeight(t, loc);
      }
    }
    cf.lastRel = rel;
    return RES;
  }

  // ==========================================================================
  //  SPECIES REGISTRY + the hooks a species file hands to unitKit.register
  // ==========================================================================
  function define(id, P) { P.id = id; SPECIES[id] = P; return P; }
  function def(id) { return SPECIES[id] || null; }
  function hooks(id) {
    return {
      build: function (ctx) { return build(id, ctx); },
      animate: function (m, dt) { return animate(m, dt); },
      fight: function (m, t, dt, o) { return fight(m, t, dt, o); },
      moves: function (m, t, ctx) { return moves(m, t, ctx); },
    };
  }

  const API = { TABLE: TABLE, define: define, def: def, stats: stats, dims: dims, hooks: hooks, fight: fight, moves: moves, MOVES: CMOVES,
    build: function (id, ctx) { return build(id, ctx); }, animate: function (m, dt) { return animate(m, dt); },
    _mixHex: mixHex };
  CBZ.canid = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;

  // ==========================================================================
  //  BUILD — everything below needs THREE and the kit (loaded on demand)
  // ==========================================================================
  let TB = null;
  function bonesTable() {
    if (!TB) TB = CBZ.quadRig.bones({ neck: 2, tail: 4, ears: true, hackle: true });
    return TB;
  }
  function kitReady() { return !!(W.THREE && CBZ.quadRig && CBZ.quadGait && CBZ.loftKit); }

  // ---- THE COAT: (part, point, ring angle, station) -> hex ------------------
  // palettes are authored as the colour you SEE (sRGB, from photographs);
  // vertex colours are LINEAR (loftKit writes hex/255 straight through and the
  // renderer encodes to sRGB on output), so each one is linearised once here.
  function lin(h) {
    const f = function (v) { return Math.round(Math.pow(v / 255, 2.2) * 255); };
    return (f((h >> 16) & 255) << 16) | (f((h >> 8) & 255) << 8) | f(h & 255);
  }
  function linPal(C0) {
    const C = {};
    for (const k in C0) C[k] = (typeof C0[k] === "number" && C0[k] > 255) ? lin(C0[k]) : C0[k];
    return C;
  }
  function coatFn(D, C0, seed) {
    const K = D.K;
    const C = linPal(C0);
    const r = mkRng((seed | 0) ^ 0xC4D1);
    const off = [r() * 50, r() * 50, r() * 50];
    const NOSE = lin(0x1e1a18), LIP = lin(0x221c19), MOUTH = lin(0x8a4a4a), TONGUE = lin(0xc07078), TOOTH = lin(0xece6d6),
      PAD = lin(0x2e2826), CLAW = lin(0x2e2824), EYEL = lin(0x1a1410), PUPIL = lin(0x080706);
    const grz = C.grizzle == null ? 0.5 : C.grizzle;
    function grizzle(c, x, y, z, amt) {
      if (!(amt > 0)) return c;
      const h = hash3(x * 41 / K + off[0], y * 41 / K + off[1], z * 41 / K + off[2]);
      if (h > 0.72) return mixHex(c, C.tip, amt * (h - 0.72) / 0.28 * 1.4);
      if (h < 0.25) return mixHex(c, C.band, amt * (0.25 - h) / 0.25 * 0.9);
      return c;
    }
    // a soft field so regions blend over a ring or two instead of stepping
    function soft(c1, c2, v, a, b) { return mixHex(c1, c2, sstep(a, b, v)); }
    return function (part, x, y, z, ca, sa, R, t) {
      const tag = R && R.tag;
      if (tag === "nose") return NOSE;
      if (tag === "pad") return PAD;
      if (tag === "claw") return CLAW;
      if (tag === "tooth") return TOOTH;
      if (tag === "tongue") return TONGUE;
      if (tag === "eyelid") return EYEL;
      if (tag === "iris") return C.eye;
      if (tag === "pupil") return PUPIL;
      let c = C.base;
      switch (part) {
        case "torso": {
          // flank -> saddle over the back, pale under; the cape over the shoulders
          const back = sstep(0.15, 0.7, ca);
          const sadX = sstep(D.hipX - 0.16 * K, D.hipX - 0.02 * K, x) * (1 - sstep(D.shX + 0.04 * K, D.shX + 0.12 * K, x));
          c = mixHex(C.base, C.saddle, back * (0.35 + 0.65 * sadX));
          if (C.cape && x > D.shX - 0.14 * K) c = mixHex(c, C.cape, back * sstep(D.shX - 0.14 * K, D.shX - 0.02 * K, x) * 0.8);
          c = soft(c, C.under, -ca, 0.2, 0.62);
          // the bib: throat and chest front
          if (x > D.shX - 0.02 * K) c = mixHex(c, C.bib, sstep(-0.1, -0.55, ca) * sstep(D.shX - 0.02 * K, D.shX + 0.08 * K, x));
          // the inner thigh / groin
          if (x < D.hipX + 0.08 * K && ca < -0.2) c = mixHex(c, C.under, 0.7);
          return grizzle(c, x, y, z, grz * (0.4 + 0.6 * back));
        }
        case "neck": {
          const back = sstep(0.0, 0.65, ca);
          c = mixHex(C.base, C.cape || C.saddle, back * 0.85);
          c = soft(c, C.bib, -ca, 0.05, 0.5);
          return grizzle(c, x, y, z, grz * (0.5 + 0.5 * back));
        }
        case "head": {
          if (R && R.muz) {
            // the muzzle: a darker bridge, pale lips line, black lip edge
            if (ca > 0.45) c = mixHex(C.muzzleTop, C.crown, sstep(0.8, 1, ca) * 0.3);
            else if (ca > -0.38) c = mixHex(C.muzzleTop, C.mask, sstep(0.45, 0.05, ca));
            else if (ca > -0.9) c = LIP;
            else c = MOUTH;
            if (C.muzzleSide && ca < 0.4 && ca > -0.38 && Math.abs(sa) > 0.6) c = mixHex(c, C.muzzleSide, 0.6);
            return c;
          }
          // the cranium: crown, the pale mask round the eyes and cheeks
          c = mixHex(C.cheek, C.crown, sstep(-0.1, 0.55, ca));
          if (R && R.cheek) c = mixHex(c, C.mask, sstep(0.2, -0.4, ca) * 0.9);
          if (ca < -0.35) c = C.mask;
          // the eyebrow spots (the pale "masks" a wolf reads at a distance)
          if (C.brow && R && R.brow && ca > 0.35 && ca < 0.8 && Math.abs(sa) > 0.35) c = mixHex(c, C.brow, 0.75);
          return grizzle(c, x, y, z, grz * 0.5);
        }
        case "jaw": {
          if (tag === "lip") return LIP;
          if (ca > 0.5) return t > 0.75 ? TOOTH : MOUTH;
          if (ca > 0.25) return LIP;
          return C.chin;
        }
        case "ear": {
          // back of the ear (ca > 0), the furred inner front, a dark rim
          if (ca > 0.15) c = mixHex(C.earBack, C.earTip || C.earBack, sstep(0.45, 0.95, (R && R.et) || 0));
          else c = mixHex(C.earIn, C.earBack, sstep(0.75, 0.95, Math.abs(sa)));
          if (C.earRim && Math.abs(sa) > 0.88) c = C.earRim;
          return c;
        }
        case "tail": {
          const top = sstep(-0.3, 0.6, -ca);
          c = mixHex(C.tailUnder, C.tailTop, top);
          if (C.gland && t > 0.18 && t < 0.32 && -ca > 0.5) c = mixHex(c, C.gland, 0.85);
          c = mixHex(c, C.tailTip, sstep(C.tipFrom || 0.8, (C.tipFrom || 0.8) + 0.08, t));
          return grizzle(c, x, y, z, grz * 0.8 * top * (1 - sstep(0.78, 0.86, t)));
        }
        case "thigh": {
          // the outer thigh carries the flank; the "pants" behind it are paler;
          // down the gaskin it turns to the leg colour
          c = mixHex(C.base, C.saddle, sstep(D.hipH - 0.16 * K, D.hipH, y) * 0.45);
          c = mixHex(c, C.pants || C.under, sstep(0.1, -0.7, ca) * 0.85);
          c = mixHex(c, C.leg, sstep(D.hipH - D.ha * 0.45, D.hipH - D.ha * 1.0, y));
          return grizzle(c, x, y, z, grz * 0.4);
        }
        case "upper": {
          c = mixHex(C.base, C.under, sstep(0.1, -0.7, ca) * 0.4);
          c = mixHex(c, C.leg, sstep(D.sh - D.fa * 0.2, D.sh - D.fa * 1.0, y));
          return grizzle(c, x, y, z, grz * 0.3);
        }
        case "leg": case "foot": {
          c = C.leg;
          const front = R && R.front;
          // fox stockings: black from the elbow / hock down
          if (C.stocking) c = mixHex(c, C.stocking, sstep(R.yTop * 0.95, R.yTop * 0.62, y) * (front ? 1 : 0.9));
          // the dark stripe down the FRONT of the foreleg (coyote, wolf)
          if (C.legStripe && front && ca > 0.55 && part === "leg") c = mixHex(c, C.legStripe, 0.7);
          if (part === "foot") c = mixHex(c, C.paw || c, 0.6);
          return c;
        }
        case "eye": return EYEL;
      }
      return c;
    };
  }

  // ---- THE SHELL --------------------------------------------------------------
  function buildGeometry(P, D, C, seed) {
    const LK = CBZ.loftKit, T = bonesTable(), BN = T.BN, LEGB = T.LEGB;
    const G = LK.geo(), K = D.K;
    const col = coatFn(D, C, seed);
    const Cf = function (part) { return function (x, y, z, ca, sa, R, t) { return col(part, x, y, z, ca, sa, R, t); }; };
    function loft(st, S, colour, opts) { LK.loft(G, st, S, colour, Object.assign({ hkBone: BN.hackle }, opts)); }
    const PV = BN.pelvis, CH = BN.chest, N0 = BN.neck, N1 = BN.neck1, HD = BN.head;
    const L = function (t) { return lerp(D.hipX, D.shX, t); };
    const LY = function (t) { return lerp(D.hipH, D.sh, t); };
    const fur = D.ruff;

    // TORSO: buttock -> haunch -> loin (tuck-up) -> keel ribcage -> point of
    // shoulder -> prosternum. y is the WIDEST line; rt above, rb below, so the
    // ribcage reads as a deep narrow keel, not a barrel.
    const torso = [
      { x: D.hipX - 0.13 * K, y: D.hipH + 0.005 * K, rt: D.rumpR * 0.5, rb: D.rumpR * 0.5, w: D.rumpW * 0.45, wts: [PV, 1] },
      { x: D.hipX - 0.1 * K, y: D.hipH + 0.015 * K, rt: D.rumpR * 0.8, rb: D.rumpR * 0.85, w: D.rumpW * 0.8, wts: [PV, 1] },
      { x: D.hipX - 0.05 * K, y: D.hipH + 0.02 * K, rt: D.rumpR * 0.97, rb: D.rumpR * 1.05, w: D.rumpW * 0.97, wts: [PV, 1] },
      { x: D.hipX + 0.02 * K, y: D.hipH + 0.025 * K, rt: D.rumpR, rb: D.rumpR * 1.0, w: D.rumpW, wts: [PV, 1] },
      { x: D.hipX + 0.09 * K, y: D.hipH + 0.035 * K, rt: lerp(D.rumpR, D.waistRt, 0.6), rb: lerp(D.rumpR, D.waistRb, 0.7), w: lerp(D.rumpW, D.waistW, 0.7), wts: [PV, 0.85, CH, 0.15] },
      { x: L(0.3), y: LY(0.3) + 0.045 * K, rt: D.waistRt, rb: D.waistRb, w: D.waistW, wts: [PV, 0.6, CH, 0.4] },
      { x: L(0.44), y: LY(0.44) + 0.04 * K, rt: lerp(D.waistRt, D.chestRt, 0.45), rb: lerp(D.waistRb, D.chestRb, 0.45), w: lerp(D.waistW, D.chestW, 0.55), wts: [PV, 0.3, CH, 0.7], hk: 0.15 },
      { x: L(0.58), y: LY(0.58) + 0.03 * K, rt: D.chestRt * 0.94, rb: D.chestRb * 0.88, w: D.chestW * 0.96, wts: [PV, 0.1, CH, 0.9], hk: 0.35 },
      { x: L(0.72), y: D.sh + 0.02 * K, rt: D.chestRt, rb: D.chestRb, w: D.chestW, wts: [CH, 1], hk: 0.7, sq: 1.08 },
      { x: L(0.86), y: D.sh + 0.025 * K, rt: D.chestRt * 1.02, rb: D.chestRb * 0.98, w: D.chestW * 0.98, wts: [CH, 1], hk: 1, sq: 1.08 },
      { x: D.shX + 0.02 * K, y: D.sh + 0.025 * K, rt: D.chestRt * 0.98 * fur, rb: D.chestRb * 0.88, w: D.chestW * 1.0 * fur, wts: [CH, 1], hk: 1 },
      { x: D.shX + 0.065 * K, y: D.sh + 0.01 * K, rt: D.chestRt * 0.85 * fur, rb: D.chestRb * 0.66, w: D.chestW * 0.86 * fur, wts: [CH, 1], hk: 0.7 },
      { x: D.shX + 0.1 * K, y: D.sh - 0.01 * K, rt: D.chestRt * 0.6, rb: D.chestRb * 0.42, w: D.chestW * 0.62, wts: [CH, 1] },
    ];
    loft(torso, 22, Cf("torso"), { capLen: 0.8 });

    // NECK: a thick furred column (the ruff), chest -> neck0 -> neck1 -> head
    const nb = D.neckB, hp = D.headP;
    const nk = function (t) { return { x: lerp(nb.x, hp.x, t), y: lerp(nb.y, hp.y, t) }; };
    const n0 = nk(0), n1 = nk(0.3), n2 = nk(0.6), n3 = nk(0.86), n4 = nk(1.0);
    const neck = [
      { x: D.shX - 0.05 * K, y: D.sh + 0.03 * K, rt: D.chestRt * 0.92 * fur, rb: D.chestRb * 0.62, w: D.chestW * 0.9 * fur, wts: [CH, 1], hk: 0.9 },
      { x: n0.x, y: n0.y, rt: D.neckR * 1.45 * fur, rb: D.neckR * 1.55, w: D.neckR * 1.3 * fur, wts: [CH, 0.6, N0, 0.4], hk: 0.7 },
      { x: n1.x, y: n1.y, rt: D.neckR * 1.25 * fur, rb: D.neckR * 1.32, w: D.neckR * 1.18 * fur, wts: [CH, 0.1, N0, 0.9], hk: 0.3 },
      { x: n2.x, y: n2.y, rt: D.neckR * 1.08 * fur, rb: D.neckR * 1.15, w: D.neckR * 1.08 * fur, wts: [N0, 0.5, N1, 0.5] },
      { x: n3.x, y: n3.y, rt: D.neckR * 1.0 * fur, rb: D.neckR * 1.05, w: D.neckR * 1.05 * fur, wts: [N1, 0.85, HD, 0.15] },
      { x: n4.x, y: n4.y, rt: D.neckR * 0.9, rb: D.neckR * 0.95, w: D.neckR * 0.95, wts: [N1, 0.4, HD, 0.6] },
    ];
    loft(neck, 18, Cf("neck"), { capLen: 0.6 });

    // HEAD: occiput -> cranium -> cheek fur -> brow -> stop -> muzzle -> nose
    const u = D.u, H = D.headP;
    const hpnt = function (d, dy) { return { x: H.x + u.x * d, y: H.y + u.y * d + (dy || 0) }; };
    const sr = D.skullR, sw = D.skullW;
    const mz = -sr * 0.36;
    const hA = hpnt(-0.03 * K, -0.004 * K), hB = hpnt(0.0), hC = hpnt(D.headL * 0.38, -0.004 * K), hD = hpnt(D.headL * 0.72, sr * 0.02),
      hE = hpnt(D.headL * 0.94, -sr * 0.12);
    const m0 = hpnt(D.headL + 0.008 * K, mz), m1 = hpnt(D.headL + D.muzzleL * 0.4, mz - D.muzzleR * 0.04),
      m2 = hpnt(D.headL + D.muzzleL * 0.78, mz - D.muzzleR * 0.1), m3 = hpnt(D.headL + D.muzzleL, mz - D.muzzleR * 0.12);
    const head = [
      { x: hA.x, y: hA.y, rt: sr * 0.7, rb: sr * 0.85, w: sw * 0.8, wts: [HD, 1] },
      { x: hB.x, y: hB.y, rt: sr * 0.95, rb: sr * 1.1, w: sw * 1.25 * fur, wts: [HD, 1], cheek: true },
      { x: hC.x, y: hC.y, rt: sr, rb: sr * 1.05, w: sw * 1.32 * fur, wts: [HD, 1], cheek: true, sq: 0.92 },
      { x: hD.x, y: hD.y, rt: sr * 0.9, rb: sr * 0.78, w: sw * 0.92, wts: [HD, 1], brow: true, cheek: true, sq: 0.9 },
      { x: hE.x, y: hE.y, rt: sr * 0.62, rb: sr * 0.6, w: sw * 0.66, wts: [HD, 1], brow: true },
      { x: m0.x, y: m0.y, rt: D.muzzleR * 1.05, rb: D.muzzleR * 1.15, w: D.muzzleW * 1.08, wts: [HD, 1], muz: true, sq: 0.85 },
      { x: m1.x, y: m1.y, rt: D.muzzleR * 0.95, rb: D.muzzleR * 1.05, w: D.muzzleW * 0.95, wts: [HD, 1], muz: true, sq: 0.85 },
      { x: m2.x, y: m2.y, rt: D.muzzleR * 0.84, rb: D.muzzleR * 0.9, w: D.muzzleW * 0.82, wts: [HD, 1], muz: true, sq: 0.88 },
      { x: m3.x, y: m3.y + D.muzzleR * 0.05, rt: D.muzzleR * 0.8, rb: D.muzzleR * 0.62, w: D.muzzleW * 0.74, wts: [HD, 1], muz: true, tag: "nose" },
    ];
    loft(head, 16, Cf("head"), { capLen: 0.75 });

    // THE MOUTH: lower jaw on its hinge, tongue, teeth
    const J = D.jawP, jEnd = hpnt(D.headL + D.muzzleL * 0.86, mz - D.muzzleR * 0.78);
    const jaw = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      jaw.push({ x: lerp(J.x, jEnd.x, t), y: lerp(J.y, jEnd.y, t), rt: lerp(0.024, 0.016, t) * K, rb: lerp(0.03, 0.016, t) * K,
        w: lerp(sw * 0.5, D.muzzleW * 0.55, t), wts: [BN.jaw, 1], sq: 0.9 });
    }
    loft(jaw, 12, Cf("jaw"), { capLen: 0.8 });
    // tongue on the floor of the mouth (pink; seen only when it opens)
    const tg = [];
    for (let i = 0; i < 4; i++) {
      const t = 0.15 + i / 3 * 0.75;
      tg.push({ x: lerp(J.x, jEnd.x, t), y: lerp(J.y, jEnd.y, t) + 0.016 * K, rt: 0.006 * K, rb: 0.006 * K, w: lerp(sw * 0.42, D.muzzleW * 0.4, t), wts: [BN.jaw, 1], tag: "tongue" });
    }
    loft(tg, 8, Cf("jaw"), { capLen: 0.9 });
    // canines: upper (head bone) hang down outside the lower ones; lower
    // (jaw bone) rise from the chin. Incisors a short ivory bar between.
    const toothC = function () { return col("x", 0, 0, 0, 0, 0, { tag: "tooth" }); };
    const cl = D.muzzleL * 0.17;
    for (let s = -1; s <= 1; s += 2) {
      const up = hpnt(D.headL + D.muzzleL * 0.84, mz - D.muzzleR * 0.45);
      loft([
        { x: up.x, y: up.y, z: s * D.muzzleW * 0.62, rt: 0.006 * K, rb: 0.006 * K, w: 0.006 * K, wts: [HD, 1], tag: "tooth" },
        { x: up.x + 0.002 * K, y: up.y - cl * 0.5, z: s * D.muzzleW * 0.6, rt: 0.005 * K, rb: 0.005 * K, w: 0.0045 * K, wts: [HD, 1], tag: "tooth" },
        { x: up.x + 0.005 * K, y: up.y - cl, z: s * D.muzzleW * 0.56, rt: 0.0015 * K, rb: 0.0015 * K, w: 0.0015 * K, wts: [HD, 1], tag: "tooth" },
      ], 6, toothC, { capLen: 0.5, side: [1, 0, 0] });
      const lo = { x: lerp(J.x, jEnd.x, 0.86), y: lerp(J.y, jEnd.y, 0.86) + 0.008 * K };
      loft([
        { x: lo.x, y: lo.y, z: s * D.muzzleW * 0.46, rt: 0.005 * K, rb: 0.005 * K, w: 0.005 * K, wts: [BN.jaw, 1], tag: "tooth" },
        { x: lo.x + 0.002 * K, y: lo.y + cl * 0.42, z: s * D.muzzleW * 0.45, rt: 0.004 * K, rb: 0.004 * K, w: 0.004 * K, wts: [BN.jaw, 1], tag: "tooth" },
        { x: lo.x + 0.004 * K, y: lo.y + cl * 0.82, z: s * D.muzzleW * 0.43, rt: 0.0012 * K, rb: 0.0012 * K, w: 0.0012 * K, wts: [BN.jaw, 1], tag: "tooth" },
      ], 6, toothC, { capLen: 0.5, side: [1, 0, 0] });
      // carnassial ridge along each side of the upper jaw
      const c0 = hpnt(D.headL + D.muzzleL * 0.15, mz - D.muzzleR * 0.62), c1 = hpnt(D.headL + D.muzzleL * 0.75, mz - D.muzzleR * 0.62);
      loft([
        { x: c0.x, y: c0.y, z: s * D.muzzleW * 0.66, rt: 0.004 * K, rb: 0.007 * K, w: 0.004 * K, wts: [HD, 1], tag: "tooth" },
        { x: c1.x, y: c1.y, z: s * D.muzzleW * 0.58, rt: 0.004 * K, rb: 0.005 * K, w: 0.004 * K, wts: [HD, 1], tag: "tooth" },
      ], 5, toothC, { capLen: 0.6 });
    }
    const inc = hpnt(D.headL + D.muzzleL * 0.97, mz - D.muzzleR * 0.62);
    LK.ellipsoid(G, inc.x, inc.y, 0, 0.005 * K, 0.008 * K, D.muzzleW * 0.45, 6, toothC, [HD, 1]);

    // EYES: almond, set obliquely; dark lid, amber iris, black pupil
    for (let s = -1; s <= 1; s += 2) {
      const e = hpnt(D.headL * 0.8, sr * 0.3);
      const ez = s * sw * 0.7, er = 0.011 * K * (P.eyeK || 1);
      LK.ellipsoid(G, e.x, e.y, ez, er * 1.3, er * 0.72, er * 0.6, 8, function () { return col("x", 0, 0, 0, 0, 0, { tag: "eyelid" }); }, [HD, 1]);
      LK.ellipsoid(G, e.x + er * 0.1, e.y, ez + s * er * 0.18, er * 0.95, er * 0.58, er * 0.5, 8, function () { return col("x", 0, 0, 0, 0, 0, { tag: "iris" }); }, [HD, 1]);
      // round pupils in the dogs; the fox's are vertical slits
      const px = P.pupilSlit ? er * 0.12 : er * 0.34, py = P.pupilSlit ? er * 0.52 : er * 0.36;
      LK.ellipsoid(G, e.x + er * 0.2, e.y, ez + s * er * 0.36, px, py, er * 0.3, 6, function () { return col("x", 0, 0, 0, 0, 0, { tag: "pupil" }); }, [HD, 1]);
    }

    // EARS: thick furred triangles, cupped forward, rounded (wolf) or
    // pointed (coyote, fox), standing up and a little out
    for (let s = -1; s <= 1; s += 2) {
      const eb = BN[s < 0 ? "earL" : "earR"], E = D.earP, z0 = s * E.z;
      const st = [], n = 6;
      const tipR = P.earTip == null ? 0.12 : P.earTip;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const wq = (1 - t) * (1 - t * 0.15) + tipR * t;
        st.push({ x: E.x - 0.018 * K * t - 0.01 * K * t * t, y: E.y + D.earL * t, z: z0 + s * D.earL * 0.2 * t,
          rt: 0.011 * K * (1 - t * 0.6), rb: 0.004 * K * (1 - t * 0.5), w: D.earW * 0.5 * Math.max(0.04, Math.pow(wq, 0.8)), wts: [eb, 1], et: t });
      }
      loft(st, 10, Cf("ear"), { capLen: 0.4 });
    }

    // TAIL: four bones; a bushy brush (widest around half way), hanging
    const tP = D.tailP, tl = D.tailL, tr = D.tailR, prof = P.tailProf || [0.55, 0.85, 1.1, 1.22, 1.25, 1.18, 1.0, 0.72, 0.36];
    const tst = [];
    for (let i = 0; i < prof.length; i++) {
      const t = i / (prof.length - 1), x = tP.x - tl * t;
      const f = t * 4, k = Math.min(3, Math.floor(f)), fr = f - k;
      let wts;
      if (k >= 3) wts = [BN.tail3, 1];
      else wts = [BN["tail" + k], 1 - fr * 0.5, BN["tail" + (k + 1)], fr * 0.5];
      tst.push({ x: x, y: tP.y, rt: tr * prof[i], rb: tr * prof[i] * 0.92, w: tr * prof[i] * 0.85, wts: wts });
    }
    loft(tst, 12, function (x, y, z, ca, sa, R, t) { return col("tail", x, y, z, ca, sa, R, t); }, { capLen: 0.9 });

    // LEGS: straight down in the bind; the IK bends them every frame.
    const pts = T.bindPoints(D);
    const lr = D.legR || 1;
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = LEGB[Lg], P0 = pts[ids[0]], z = P0[2];
      const a = front ? D.fa : D.ha, b = front ? D.fb : D.hb, c = front ? D.fc : D.hc;
      const x = P0[0], y0 = P0[1];
      const yTop = front ? y0 - a : y0 - a - b * 0.15;
      const RL = { front: front, yTop: yTop };
      const legCol = function (part) { return function (px, py, pz, ca, sa, R, t) { return col(part, px, py, pz, ca, sa, Object.assign(RL, { tag: R.tag }), t); }; };
      if (front) {
        // shoulder + triceps mass blending into the chest, then the slim forearm
        loft([
          { x: x - 0.01 * K, y: y0 + 0.07 * K, z: z, rt: 0.05 * K * lr, rb: 0.06 * K * lr, w: 0.04 * K * lr, wts: [ids[0], 0.6, CH, 0.4] },
          { x: x, y: y0, z: z, rt: 0.05 * K * lr, rb: 0.062 * K * lr, w: 0.04 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.5, z: z, rt: 0.036 * K * lr, rb: 0.05 * K * lr, w: 0.032 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.9, z: z, rt: 0.026 * K * lr, rb: 0.032 * K * lr, w: 0.026 * K * lr, wts: [ids[0], 0.7, ids[1], 0.3] },
          { x: x, y: y0 - a, z: z, rt: 0.024 * K * lr, rb: 0.03 * K * lr, w: 0.025 * K * lr, wts: [ids[0], 0.4, ids[1], 0.6] },
        ], 12, Cf("upper"), { capLen: 0.7 });
        loft([
          { x: x, y: y0 - a + 0.03 * K, z: z, rt: 0.024 * K * lr, rb: 0.03 * K * lr, w: 0.025 * K * lr, wts: [ids[0], 0.5, ids[1], 0.5] },
          { x: x, y: y0 - a, z: z, rt: 0.025 * K * lr, rb: 0.029 * K * lr, w: 0.025 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.3, z: z, rt: 0.024 * K * lr, rb: 0.02 * K * lr, w: 0.021 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.8, z: z, rt: 0.017 * K * lr, rb: 0.016 * K * lr, w: 0.017 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b, z: z, rt: 0.019 * K * lr, rb: 0.02 * K * lr, w: 0.019 * K * lr, wts: [ids[1], 0.5, ids[2], 0.5] },
        ], 10, legCol("leg"), { capLen: 0.7 });
      } else {
        // the haunch: a big hamstring "pants" behind, the slim gaskin, the hock
        loft([
          { x: x + 0.01 * K, y: y0 + 0.05 * K, z: z * 0.85, rt: 0.045 * K * lr, rb: 0.06 * K * lr, w: 0.04 * K * lr, wts: [ids[0], 0.5, PV, 0.5] },
          { x: x, y: y0, z: z, rt: 0.052 * K * lr, rb: 0.075 * K * lr, w: 0.046 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.45, z: z, rt: 0.05 * K * lr, rb: 0.07 * K * lr, w: 0.042 * K * lr, wts: [ids[0], 1] },
          { x: x, y: y0 - a * 0.85, z: z, rt: 0.03 * K * lr, rb: 0.04 * K * lr, w: 0.028 * K * lr, wts: [ids[0], 0.8, ids[1], 0.2] },
          { x: x, y: y0 - a, z: z, rt: 0.025 * K * lr, rb: 0.032 * K * lr, w: 0.025 * K * lr, wts: [ids[0], 0.45, ids[1], 0.55] },
        ], 12, Cf("thigh"), { capLen: 0.7 });
        loft([
          { x: x, y: y0 - a + 0.03 * K, z: z, rt: 0.026 * K * lr, rb: 0.034 * K * lr, w: 0.025 * K * lr, wts: [ids[0], 0.5, ids[1], 0.5] },
          { x: x, y: y0 - a, z: z, rt: 0.025 * K * lr, rb: 0.034 * K * lr, w: 0.024 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.35, z: z, rt: 0.02 * K * lr, rb: 0.03 * K * lr, w: 0.02 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b * 0.82, z: z, rt: 0.014 * K * lr, rb: 0.019 * K * lr, w: 0.015 * K * lr, wts: [ids[1], 1] },
          { x: x, y: y0 - a - b, z: z, rt: 0.016 * K * lr, rb: 0.024 * K * lr, w: 0.017 * K * lr, wts: [ids[1], 0.5, ids[2], 0.5] },
        ], 10, legCol("leg"), { capLen: 0.7 });
      }
      // metacarpus / metatarsus -> the paw
      const fy = y0 - a - b, pr = D.pawR * (front ? 1 : 0.9);
      loft([
        { x: x, y: fy + 0.025 * K, z: z, rt: 0.018 * K * lr, rb: front ? 0.02 * K * lr : 0.024 * K * lr, w: 0.018 * K * lr, wts: [ids[1], 0.5, ids[2], 0.5] },
        { x: x, y: fy, z: z, rt: 0.018 * K * lr, rb: front ? 0.02 * K * lr : 0.022 * K * lr, w: 0.017 * K * lr, wts: [ids[2], 1] },
        { x: x, y: fy - c * 0.5, z: z, rt: 0.014 * K * lr, rb: 0.014 * K * lr, w: 0.015 * K * lr, wts: [ids[2], 1] },
        { x: x + pr * 0.1, y: fy - c * 0.85, z: z, rt: 0.017 * K * lr, rb: 0.016 * K * lr, w: 0.018 * K * lr, wts: [ids[2], 1] },
      ], 8, legCol("foot"), { capLen: 0.7 });
      // the paw: a pad block and four toes with claws (front feet the bigger)
      const py = fy - c;
      LK.ellipsoid(G, x + pr * 0.35, py + pr * 0.05, z, pr * 1.25, pr * 0.72, pr * 1.0, 10, legCol("foot"), [ids[2], 1]);
      for (let k = 0; k < 4; k++) {
        const side = (k - 1.5) / 1.5, fwd = 1 - Math.abs(side) * 0.35;
        const tx = x + pr * (0.95 + 0.45 * fwd), tz = z + side * pr * 0.62;
        LK.ellipsoid(G, tx, py - pr * 0.1, tz, pr * 0.42, pr * 0.42, pr * 0.3, 6, legCol("foot"), [ids[2], 1]);
        LK.ellipsoid(G, tx + pr * 0.38, py - pr * 0.28, tz, pr * 0.2, pr * 0.12, pr * 0.1, 5, function () { return col("x", 0, 0, 0, 0, 0, { tag: "claw" }); }, [ids[2], 1]);
      }
    }
    return LK.toGeometry(G, { boundingSphere: [0, D.withers * 0.6, 0, D.withers * 1.9] });
  }

  // ==========================================================================
  //  BUILD — one geometry per species x sex x coat, a skeleton per animal
  // ==========================================================================
  const _geo = new Map();
  function pickCoat(P, r) {
    const keys = Object.keys(P.coats), w = P.coatW || {};
    let tot = 0; for (let i = 0; i < keys.length; i++) tot += w[keys[i]] != null ? w[keys[i]] : 1;
    let x = r() * tot;
    for (let i = 0; i < keys.length; i++) { x -= w[keys[i]] != null ? w[keys[i]] : 1; if (x <= 0) return keys[i]; }
    return keys[0];
  }
  function build(id, ctx) {
    const P = SPECIES[id];
    const THREE = W.THREE;
    if (!P || !kitReady()) {
      const sp = CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[id];
      return sp && sp.build ? sp.build(ctx) : null;
    }
    const seed = ((ctx && ctx.seed) | 0) || Math.floor(((ctx && ctx.rng) ? ctx.rng() : Math.random()) * 1e6);
    const r = mkRng(seed * 2654435761 + 17);
    const sex = r() < 0.5 ? "m" : "f";
    const coat = pickCoat(P, r);
    const D = dims(P, sex);
    const key = id + "|" + sex + "|" + coat;
    let geo = _geo.get(key);
    if (!geo) { geo = buildGeometry(P, D, P.coats[coat], (id.length * 977) ^ (coat.length * 131)); _geo.set(key, geo); }
    const T = bonesTable();
    const rig = CBZ.quadRig.makeSkeleton(T, D, "canid");
    const mat = CBZ.loftKit.sharedSkinMaterial("canid-coat");
    const mesh = CBZ.quadRig.skinnedMesh(geo, mat, rig);
    mesh.name = id + "-body";
    mesh.frustumCulled = true;
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.dynamic = true;
    // an individual: a touch of size within its sex, and its own clock
    const indiv = 0.96 + r() * 0.08;
    mesh.scale.setScalar(indiv);
    const Dg = Object.create(D);
    Dg.feet = D.feet.map(function (f) { return { x: f.x, z: f.z, front: f.front }; });
    const mass = (sex === "m" ? P.stats.mass * 1.08 : P.stats.mass * 0.92) * indiv * indiv * indiv;
    group.userData.canid = {
      id: id, P: P, D: D, Dg: Dg, rig: rig, mesh: mesh, sex: sex, coat: coat, indiv: indiv,
      G: CBZ.quadGait.create(Dg, TABLE), st: null, rng: r, mass: mass, K: D.K, withers: D.withers * indiv,
    };
    return group;
  }

  // ==========================================================================
  //  ANIMATE — gait + posture + fight + mood -> bones
  // ==========================================================================
  const _ik = [0, 0];
  function newState(m) {
    return { px: null, pz: null, ph: 0, v: 0, turn: 0, alert: 0, aggr: 0, fear: 0, sniff: 0, sit: 0, lie: 0,
      pant: 0, lookY: 0, lookP: 0, wagPh: 0, wasPost: false, t: 0, idleT: 0, idleAct: 0, idleNext: 2 + ((m.i || 0) % 7) * 0.7,
      howl: 0, flick: 0, flickSide: 0, lastHp: m.hp, flinch: 0, flinchS: 1, hitLoc: 0, yelp: 0,
      limp: [0, 0, 0, 0], lunge: 0, hold: 0, threat: 0, rearUp: 0, shakeT: 0, snap: 0 };
  }
  // the ragdoll proxy (see the header): bones answer to the corpse solver
  function deathProxy(m, cn) {
    const D = cn.D, T = bonesTable(), b = cn.rig.bones, bp = cn.rig.bindPos;
    const THREE = W.THREE;
    const DOWN = new THREE.Vector3(0, -1, 0), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    let reset = false;
    function limp() {
      if (reset) return;
      reset = true;
      // the bind torso: the solver's quad is the body now
      b[T.BN.pelvis].position.copy(bp[T.BN.pelvis]); b[T.BN.pelvis].rotation.set(0, 0, 0);
      b[T.BN.chest].position.copy(bp[T.BN.chest]); b[T.BN.chest].rotation.set(0, 0, 0);
      b[T.BN.jaw].rotation.set(0, 0, -0.22);
      b[T.BN.tail0].rotation.set(0, 0.2, 0.25); b[T.BN.tail1].rotation.set(0, 0.15, 0.1);
      b[T.BN.tail2].rotation.set(0, 0.1, 0.05); b[T.BN.tail3].rotation.set(0, 0.05, 0);
      b[T.BN.earL].rotation.set(-0.3, 0, 0.6); b[T.BN.earR].rotation.set(0.3, 0, 0.6);
      b[T.BN.hackle].position.copy(bp[T.BN.hackle]);
      for (let Lg = 0; Lg < 4; Lg++) {
        const ids = T.LEGB[Lg], front = Lg < 2;
        b[ids[0]].rotation.set(0, 0, front ? 0.35 : -0.3);
        b[ids[1]].rotation.set(0, 0, front ? -0.25 : 0.45);
        b[ids[2]].rotation.set(0, 0, front ? 0.5 : -0.3);
      }
      b[T.BN.neck].rotation.set(0, 0, -0.35); b[T.BN.neck1].rotation.set(0, 0, -0.2);
    }
    const bodyY = Math.max(D.sh, D.hipH) * 1.02;
    const cols = [];
    const FX = [], FY = [], FZ = [], KX = [], KY = [], KZ = [];
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, ids = T.LEGB[Lg];
      const J = front ? D.FJ : D.HJ, z = (Lg % 2 === 0 ? -1 : 1) * (front ? D.legZf : D.legZh);
      const footY = D.pawR, kneeY = (footY + bodyY) * 0.5;
      const knee = { position: { x: J.x, y: kneeY, z: z, set: function (x, y, zz) { KX[Lg] = x; KY[Lg] = y; KZ[Lg] = zz; } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
      const foot = { position: { x: J.x, y: footY, z: z, set: function (x, y, zz) {
        if (!m.dead) return;
        limp();
        const A = bp[ids[0]], par = front ? T.BN.chest : T.BN.pelvis, PB = bp[par];
        const ax = PB.x + A.x, ay = PB.y + A.y, az = PB.z + A.z;
        v1.set(KX[Lg] - ax, KY[Lg] - ay, KZ[Lg] - az);
        if (v1.lengthSq() < 1e-8) return;
        v1.normalize(); q1.setFromUnitVectors(DOWN, v1); b[ids[0]].quaternion.copy(q1);
        v2.set(x - KX[Lg], y - KY[Lg], zz - KZ[Lg]);
        if (v2.lengthSq() < 1e-8) return;
        v2.normalize().applyQuaternion(q2.copy(q1).invert());
        b[ids[1]].quaternion.setFromUnitVectors(DOWN, v2);
        b[ids[2]].rotation.set(0, 0, front ? 0.35 : -0.15);
      } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
      cols.push({ x: J.x, z: z, top: bodyY / 1.02, h: bodyY / 1.02, parts: [
        { m: knee, bx: J.x, by: kneeY }, { m: foot, bx: J.x, by: footY }] });
    }
    const hp = D.headP, neckX = (D.FJ.x + D.FJ.x) / 2;
    const d0x = hp.x - neckX, d0y = hp.y - bodyY;
    const head = { position: { x: hp.x, y: hp.y, z: 0, set: function (x, y, zz) {
      if (!m.dead) return;
      limp();
      const dx = x - neckX, dy = y - bodyY;
      const pitch = Math.atan2(dy, Math.hypot(dx, zz)) - Math.atan2(d0y, d0x);
      const yaw = Math.atan2(-zz, dx);
      b[T.BN.neck].rotation.set(0, yaw * 0.6, clamp(pitch * 0.6, -1.3, 1.0));
      b[T.BN.neck1].rotation.set(0, yaw * 0.4, clamp(pitch * 0.4, -1.0, 0.8));
    } }, rotation: { x: 0, y: 0, z: 0, set: function () {} } };
    const gait = { cols: cols, head: [{ m: head, bx: hp.x, by: hp.y }], headMesh: null, amp: 0.1, freq: 2, step: 0, k: 0, grazeK: 0, _canid: true };
    // the getter: the corpse solver (and anything that discovers a gait rig)
    // sees the proxy only once the animal is dead; alive, it has no
    // discovered rig, so no shared writer fights this file for the bones
    try {
      Object.defineProperty(m, "gait", { configurable: true, enumerable: false, get: function () { if (m.dead) limp(); return m.dead ? gait : undefined; }, set: function () {} });
    } catch (e) {}
  }

  function animate(m, dt) {
    const cn = m.group && m.group.userData.canid;
    if (!cn) {
      // the bestiary body (no kit): the shared rig, built on first use
      if (CBZ.wildlifeRig && m.group) {
        if (!m._cnFallback) { m._cnFallback = true; try { CBZ.wildlifeRig.buildGait(m); } catch (e) {} }
        try { CBZ.wildlifeRig.animateGait(m, dt); } catch (e) {}
      }
      return;
    }
    if (!m._cn) { m._cn = cn; deathProxy(m, cn); }
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    const D = cn.D, P = cn.P, K = D.K, T = bonesTable(), BN = T.BN, LEGB = T.LEGB, b = cn.rig.bones, bp = cn.rig.bindPos;
    const st = cn.st || (cn.st = newState(m));
    st.t += dt;
    const gx = m.pos.x, gz = m.pos.z, h = typeof m.heading === "number" ? m.heading : 0;
    const sc = (m.group.scale && m.group.scale.x) || 1;
    // ---- MEASURED motion (in the model's own metres)
    if (st.px == null) { st.px = gx; st.pz = gz; st.ph = h; }
    const mdx = gx - st.px, mdz = gz - st.pz;
    let v = (mdx * Math.cos(h) + mdz * Math.sin(h)) / dt / sc, turn = wrapPi(h - st.ph) / dt;
    // the ground under each paw, in this body's own model metres (the gait
    // works in model space; the group may be scaled by the individual's size)
    cn._sc = sc; cn._by = m.pos.y;
    if (!cn.gfn) cn.gfn = function (x, z) {
      const f = CBZ.floorAt;
      if (!f) return null;
      const y = f(x * cn._sc, z * cn._sc);
      return (y == null || !isFinite(y)) ? null : (y - cn._by) / cn._sc;
    };
    const ground = CBZ.floorAt ? cn.gfn : null;
    if (mdx * mdx + mdz * mdz > 9) { v = 0; turn = 0; CBZ.quadGait.reset(cn.G, gx / sc, gz / sc, h, ground, 0); }
    st.px = gx; st.pz = gz; st.ph = h;
    st.v = approach(st.v, clamp(v, -6, 20), 10, dt);
    st.turn = approach(st.turn, clamp(turn, -9, 9), 10, dt);
    const av = Math.abs(st.v);

    // ---- what the animal is doing and feeling
    const cf = m._cf, t = m.tgt && !m.tgt.dead ? m.tgt : null;
    const dT = t ? Math.hypot(t.pos.x - gx, t.pos.z - gz) : 1e9;
    const fleeing = m.state === "flee" || m.routed || m.slot === "fallback";
    const hpK = m.maxHp ? clamp(m.hp / m.maxHp, 0, 1) : 1;
    // HIT REACTIONS: the hp ledger is the one honest signal every damage
    // source shares; where it landed is drawn by body area
    if (st.lastHp != null && m.hp < st.lastHp - 0.25) {
      const lost = (st.lastHp - m.hp) / (m.maxHp || 50);
      const roll = cn.rng();
      st.hitLoc = roll < 0.12 ? 4 : roll < 0.62 ? 5 : Math.floor((roll - 0.62) / 0.095);   // 0..3 legs, 4 head, 5 body
      st.flinch = Math.min(1, 0.45 + lost * 3);
      let side = cn.rng() < 0.5 ? -1 : 1;
      if (t) { const lx = -Math.sin(h) * (t.pos.x - gx) + Math.cos(h) * (t.pos.z - gz); side = lx > 0 ? -1 : 1; }
      st.flinchS = side;
      st.yelp = 0.32;
      if (st.hitLoc < 4 && lost > 0.08) st.limp[Math.min(3, st.hitLoc)] = Math.min(1, st.limp[Math.min(3, st.hitLoc)] + lost * 2.6);
    }
    st.lastHp = m.hp;
    st.flinch = Math.max(0, st.flinch - dt * 3.2);
    st.yelp = Math.max(0, st.yelp - dt);
    let limpLeg = -1, limpK = 0;
    for (let i = 0; i < 4; i++) if (st.limp[i] > limpK) { limpK = st.limp[i]; limpLeg = i; }

    const engaged = t && dT < 14 && !fleeing;
    const ph = cf && engaged ? cf.ph : "";
    st.alert = approach(st.alert, t ? 1 : 0.25, 4, dt);
    st.aggr = approach(st.aggr, engaged ? (ph === "threat" ? 1 : 0.7) : 0, 5, dt);
    st.fear = approach(st.fear, fleeing ? 1 : (hpK < 0.35 ? 0.5 : 0) + (t && t.vehicle ? 0.6 : 0), 4, dt);
    st.pant = approach(st.pant, clamp(av / 5 + (cf && cf.stam < 0.6 ? 0.6 : 0) + (1 - hpK) * 0.3, 0, 1), 2, dt);
    st.threat = approach(st.threat, ph === "threat" ? 1 : 0, 6, dt);
    st.hold = approach(st.hold, ph === "hold" ? 1 : 0, 12, dt);
    // the lunge envelope from the fight's own clock
    let lungeE = 0, snapOpen = 0;
    if (ph === "lunge" && cf) {
      const k = clamp(cf.pt / cf.lungeT, 0, 1);
      lungeE = k < 0.3 ? -0.35 * (k / 0.3) : k < 0.62 ? -0.35 + 1.35 * ((k - 0.3) / 0.32) : 1 - (k - 0.62) / 0.38;
      snapOpen = k < 0.28 ? 0.2 : k < 0.6 ? 0.2 + 0.8 * ((k - 0.28) / 0.32) : Math.max(0, 1 - (k - 0.6) / 0.06);
    }
    st.lunge = approach(st.lunge, lungeE, 30, dt);
    const wantRise = (ph === "lunge" || ph === "hold") && cf ? clamp((cf.biteY - D.mouth.y * cn.indiv) / (D.withers * 0.9), 0, 1) : 0;
    st.rearUp = approach(st.rearUp, wantRise * (ph === "lunge" ? Math.max(0, st.lunge) : 1), 9, dt);
    const lowBite = (ph === "lunge" || ph === "hold") && cf ? clamp((D.mouth.y * cn.indiv - cf.biteY) / (D.withers * 0.6), 0, 1) : 0;

    // ---- IDLE life: sniff, look round, ear flicks, sit, lie, howl
    const still = av < 0.15 && Math.abs(st.turn) < 0.3 && !t;
    st.idleT = still ? st.idleT + dt : 0;
    if (still) {
      st.idleNext -= dt;
      if (st.idleNext <= 0) {
        const r = cn.rng();
        st.idleAct = r < 0.32 ? 1 : r < 0.62 ? 2 : r < 0.72 && P.howl && st.idleT > 6 ? 3 : 0;   // 1 sniff, 2 look, 3 howl
        st.idleNext = st.idleAct === 3 ? 4.5 : 1.6 + cn.rng() * 3;
        st.lookTo = (cn.rng() - 0.5) * 1.8;
        if (cn.rng() < 0.6) { st.flick = 0.25; st.flickSide = cn.rng() < 0.5 ? 0 : 1; }
      }
    } else { st.idleAct = 0; }
    st.flick = Math.max(0, st.flick - dt);
    st.sniff = approach(st.sniff, st.idleAct === 1 ? 1 : 0, 3, dt);
    st.howl = approach(st.howl, st.idleAct === 3 ? 1 : 0, 2.5, dt);
    const post = still && st.idleT > 30 ? "lie" : still && st.idleT > 14 ? "sit" : "stand";
    st.sit = approach(st.sit, post === "sit" ? 1 : 0, 2.5, dt);
    st.lie = approach(st.lie, post === "lie" ? 1 : 0, 2.2, dt);
    // where it looks: the quarry, else round about
    let lookY = 0, lookP = 0;
    if (t) {
      lookY = wrapPi(Math.atan2(t.pos.z - gz, t.pos.x - gx) - h);
      lookP = clamp(((t.beast ? (t.eyeH || 1) * 0.7 : 1.4) - D.headP.y) / Math.max(1, dT), -0.4, 0.5);
    } else if (st.idleAct === 2) lookY = st.lookTo || 0;
    st.lookY = approach(st.lookY, clamp(lookY, -1.1, 1.1), 6, dt);
    st.lookP = approach(st.lookP, lookP, 5, dt);

    const sitK = st.sit, lieK = Math.min(st.lie, 1 - sitK), postK = Math.max(sitK, lieK);

    // ---- GAIT: single-tracking at the trot, a limp on a struck leg
    const G = cn.G, Dg = cn.Dg;
    const M = G.mix, trotK = (M.wT || 0) + (M.wC || 0) * 0.5;
    for (let i = 0; i < 4; i++) {
      const base = D.feet[i];
      Dg.feet[i].z = base.z * (1 - 0.55 * trotK - 0.3 * (M.wG || 0));
    }
    if (postK < 0.08) {
      if (st.wasPost) { CBZ.quadGait.reset(G, gx / sc, gz / sc, h, ground, 0); st.wasPost = false; }
      CBZ.quadGait.step(G, dt, st.v, st.turn, gx / sc, gz / sc, h, ground, 0);
    } else st.wasPost = true;
    const gph = G.phase * TAU;
    const moveK = clamp(av / 0.5, 0, 1);
    const gal = (M.wG || 0) * moveK, lope = (M.wC || 0) * moveK;

    // ---- BODY
    const cr = Math.max(st.aggr * 0.35, st.fear * 0.8, st.threat * 0.6);
    let pX = D.hipX, pY = D.hipH, pR = 0, cX = D.shX, cY = D.sh, cR = 0;
    const bob = -(0.006 * (M.wW || 0) + 0.014 * (M.wT || 0)) * K * (0.5 - 0.5 * Math.cos(2 * gph)) * moveK;
    pY += bob; cY += bob;
    // gallop: the spine flexes and extends (double suspension), the lope rocks
    const sw = gal + lope * 0.6;
    pY += 0.03 * K * sw * Math.sin(gph - 1.6); cY += 0.035 * K * sw * Math.sin(gph + 0.3);
    const flex = (0.16 * gal + 0.08 * lope) * Math.sin(gph + 0.6);
    pR += flex; cR -= flex * 0.55;
    pX += 0.04 * K * sw * Math.sin(gph + 0.6); cX -= 0.03 * K * sw * Math.sin(gph + 0.6);
    pY -= 0.025 * K * sw; cY -= 0.03 * K * sw;
    // the stalk / threat crouch, fear's tucked rump
    pY -= 0.07 * K * cr * (1 + st.fear * 0.4); cY -= 0.06 * K * cr;
    pR += 0.09 * st.fear;
    cX += 0.025 * K * st.threat;
    // lunge: gather back, then the chest drives forward
    cX += 0.12 * K * st.lunge; pX += 0.05 * K * st.lunge; cY -= 0.03 * K * Math.max(0, -st.lunge) * 2;
    // the hold: braced back on the haunches, pulling
    pX -= 0.05 * K * st.hold; pY -= 0.07 * K * st.hold; cX -= 0.02 * K * st.hold;
    // rearing for a high bite (a man's arm): the forehand comes up
    const rise = st.rearUp * D.withers * 0.45;
    cY += rise; cR += Math.atan2(rise, D.bodyL) * 0.7;
    pY -= 0.03 * K * st.rearUp;
    // hit flinch: the body jerks away from the blow
    const fl = st.flinch;
    cY -= 0.02 * K * fl; pY -= 0.015 * K * fl;
    // head-nod lameness: the head and forehand rise when the sore leg lands
    if (limpLeg >= 0 && limpK > 0.15 && moveK > 0.2) {
      const F = G.feet[limpLeg];
      const load = F.sw ? 0 : 1;
      if (limpLeg < 2) cY += 0.03 * K * limpK * load; else pY += 0.03 * K * limpK * load;
    }
    // sit: the rump down, the forehand up
    const Lb = D.shX - D.hipX;
    const sCX = D.shX - 0.04 * K, sCY = D.sh + 0.03 * K, sPY = D.rumpR * 0.9 + 0.015 * K;
    const sP = Math.asin(clamp((sCY - sPY) / Lb, -0.9, 0.9)), sPX = sCX - Lb * Math.cos(sP);
    // lie (sphinx)
    const lCY = D.chestRb * 0.95, lPY = D.rumpR * 0.9, lCX = D.shX + 0.02 * K;
    const lP = Math.atan2(lCY - lPY, Lb), lPX = lCX - Lb * Math.cos(lP);
    const wS = sitK, wL = lieK, wSt = Math.max(0, 1 - wS - wL);
    pX = pX * wSt + sPX * wS + lPX * wL; pY = pY * wSt + sPY * wS + lPY * wL;
    cX = cX * wSt + sCX * wS + lCX * wL; cY = cY * wSt + sCY * wS + lCY * wL;
    pR = pR * wSt + sP * wS + lP * wL; cR = cR * wSt + sP * wS + lP * wL;
    const shakeYaw = st.hold * 0.32 * Math.sin(st.t * 15);
    b[BN.pelvis].position.set(pX, pY, 0);
    b[BN.pelvis].rotation.set(0.08 * fl * st.flinchS, -shakeYaw * 0.3, pR);
    b[BN.chest].position.set(cX, cY, 0.015 * K * fl * st.flinchS);
    b[BN.chest].rotation.set(0.12 * fl * st.flinchS, shakeYaw * 0.4 + 0.08 * st.lookY * (1 - moveK), cR);

    // ---- LEGS: gait feet (stand) blended with posture feet, 2-bone IK
    for (let Lg = 0; Lg < 4; Lg++) {
      const front = Lg < 2, F = G.feet[Lg], ids = LEGB[Lg];
      const a = front ? D.fa : D.ha, bl = front ? D.fb : D.hb, cl = front ? D.fc : D.hc;
      const bx = front ? cX : pX, by = front ? cY : pY, br = front ? cR : pR;
      const off = bp[ids[0]];
      let fx = F.lx, fy = F.ly + D.pawR;
      // THE SHOULDER BLADE SWINGS: a canid's forelimb has no collarbone, so the
      // scapula slides the shoulder joint fore and aft with the stride
      const sx = front ? clamp((fx - D.feet[Lg].x) * 0.2, -0.05 * K, 0.06 * K) : clamp((fx - D.feet[Lg].x) * 0.08, -0.025 * K, 0.025 * K);
      b[ids[0]].position.set(off.x + sx, off.y, off.z);
      const jx = bx + Math.cos(br) * (off.x + sx) - Math.sin(br) * off.y;
      const jy = by + Math.sin(br) * (off.x + sx) + Math.cos(br) * off.y;
      const su = F.sw ? Math.sin(PI * F.u) : 0;
      let fa = front ? (-HALF + 0.28 - 1.35 * su) : (-HALF + 0.06 - 0.6 * su);
      if (!front && !F.sw) fa += 0.28 * clamp((D.feet[Lg].x - F.lx) / (0.3 * K), -1, 1);
      if (front && !F.sw) fa -= 0.18 * clamp((F.lx - D.feet[Lg].x) / (0.3 * K), -1, 1);
      // a leg carried: three-legged on a badly struck limb
      if (Lg === limpLeg && limpK > 0.65 && postK < 0.5) {
        fx = lerp(fx, jx + (front ? 0.06 : -0.08) * K, 0.85); fy = lerp(fy, jy - (a + bl) * 0.6, 0.85); fa = front ? -0.2 : -HALF - 0.7;
      }
      // rearing: the front paws leave the ground, folded
      if (front && st.rearUp > 0.02) {
        const k = st.rearUp;
        fx = lerp(fx, jx + 0.12 * K, k); fy = lerp(fy, jy - (a + bl) * 0.72, k); fa = lerp(fa, -0.35, k);
      }
      // posture feet
      let sfx, sfy, sfa, lfx, lfy, lfa;
      if (front) { sfx = D.shX + 0.03 * K; sfy = D.pawR; sfa = -HALF + 0.22; lfx = D.shX + a * 0.55 + bl * 0.85; lfy = D.pawR; lfa = 0.05; }
      else { sfx = sPX + 0.22 * K; sfy = D.pawR; sfa = 0; lfx = lPX + 0.22 * K; lfy = D.pawR; lfa = 0; }
      fx = fx * wSt + sfx * wS + lfx * wL; fy = fy * wSt + sfy * wS + lfy * wL; fa = fa * wSt + sfa * wS + lfa * wL;
      // A STRETCHED LEG STRAIGHTENS ITS PASTERN toward the line to the foot
      // (the wrist / hock opens), so the planted paw is reached instead of
      // being dragged: the solver never asks the two long bones for more
      // than they have
      let wx = fx - cl * Math.cos(fa), wy = fy - cl * Math.sin(fa);
      const reach = (a + bl) * 0.985;
      for (let it = 0; it < 6; it++) {
        const dw = Math.hypot(wx - jx, wy - jy);
        if (dw <= reach) break;
        const fS = Math.atan2(fy - jy, fx - jx);
        const k = clamp((dw - reach) / (cl * 0.6) + 0.15, 0, 1);
        fa = fa + wrapPi(fS - fa) * k;
        wx = fx - cl * Math.cos(fa); wy = fy - cl * Math.sin(fa);
      }
      CBZ.quadRig.ik2(jx, jy, wx, wy, a, bl, front ? -1 : 1, _ik);
      const t1 = _ik[0], t2 = _ik[1];
      b[ids[0]].rotation.set(0, 0, t1 + HALF - br);
      b[ids[1]].rotation.set(0, 0, t2 - t1);
      b[ids[2]].rotation.set(0, 0, fa - t2);
    }

    // ---- NECK / HEAD / JAW
    const yelpE = st.yelp > 0 ? Math.sin(PI * st.yelp / 0.32) : 0;
    // a trotting wolf carries its head LOW, level with its back
    let nP = -0.05 + st.alert * 0.12 - 0.3 * (M.wT || 0) * moveK - 0.22 * sw - st.sniff * 0.9 - st.fear * 0.3
      - st.aggr * 0.18 - st.threat * 0.22 + st.lookP * 0.6 - cR * 0.8 + st.howl * 1.05 + 0.25 * st.rearUp
      - lowBite * 0.75 - lieK * 0.05 + 0.25 * fl * (st.hitLoc === 4 ? 1 : 0.3);
    nP += 0.03 * (M.wW || 0) * moveK * Math.sin(2 * gph + 0.5);
    if (limpLeg >= 0 && limpLeg < 2 && limpK > 0.15 && moveK > 0.2) nP += 0.12 * limpK * (G.feet[limpLeg].sw ? -0.3 : 1);
    const lunH = Math.max(0, st.lunge);
    nP -= 0.25 * lunH * (1 - st.rearUp);
    const yawN = st.lookY * 0.5 + shakeYaw;
    b[BN.neck].rotation.set(0.1 * fl * st.flinchS, yawN * 0.55, nP * 0.55);
    b[BN.neck1].rotation.set(0, yawN * 0.45, nP * 0.45);
    const sniffWig = st.sniff * 0.05 * Math.sin(st.t * 26);
    b[BN.head].rotation.set(shakeYaw * 0.6, st.lookY * 0.25,
      st.lookP * 0.3 - st.sniff * 0.3 + sniffWig + st.howl * 0.35 + 0.15 * lunH - 0.08 * st.threat);
    // the mouth: pant, snarl (teeth bared), the gape before the snap, the howl, a yelp
    let jaw = st.pant * 0.2 * (1 - st.aggr) + st.threat * 0.28 + st.aggr * 0.08 + snapOpen * 0.85 + st.howl * 0.32 + yelpE * 0.45 + st.hold * 0.18;
    b[BN.jaw].rotation.set(0, 0, -clamp(jaw, 0, 0.9));

    // ---- EARS: forward and up when alert or confident, pinned when afraid,
    //      flattened in the bite; a flick now and then
    const pin = Math.max(st.fear, lunH * 0.8, st.hold * 0.7, yelpE);
    for (let s = 0; s < 2; s++) {
      const e = b[s === 0 ? BN.earL : BN.earR], sg = s === 0 ? -1 : 1;
      const flick = st.flick > 0 && st.flickSide === s ? Math.sin(st.flick / 0.25 * PI) * 0.6 : 0;
      e.rotation.set(sg * (0.12 + 0.4 * pin - 0.05 * st.alert), sg * 0.1 * st.threat, -0.18 * st.alert + 1.0 * pin + flick + 0.15 * (1 - st.alert) - 0.2 * st.threat);
    }

    // ---- TAIL: carriage IS the mood (hangs relaxed, horizontal when alert or
    //      in the chase, raised stiff in threat, tucked in fear, streamed at speed)
    st.wagPh += dt * TAU * 1.6;
    let carry = P.tailRest - st.alert * 0.45 - st.threat * 0.95 - st.aggr * 0.3 + st.fear * 0.75 - 0.75 * sw - 0.35 * (M.wT || 0) * moveK
      + (1 - hpK) * 0.3;
    carry = clamp(carry * wSt + 0.9 * wS + 1.2 * wL, -0.6, 1.75);
    const sway = 0.05 * Math.sin(st.wagPh) * (1 - st.threat) + 0.08 * moveK * Math.sin(gph);
    b[BN.tail0].rotation.set(0, sway + 0.6 * lieK, carry);
    b[BN.tail1].rotation.set(0, sway * 0.8 + 0.4 * lieK, 0.08 + st.fear * 0.4 - 0.1 * sw);
    b[BN.tail2].rotation.set(0, sway * 0.6 + 0.3 * lieK, 0.06 + st.fear * 0.3 - 0.05 * sw);
    b[BN.tail3].rotation.set(0, sway * 0.4, 0.04 + st.fear * 0.25 - (P.tailHook || 0) * (1 - st.fear));

    // ---- HACKLES: the ridge over the shoulders stands
    const hk = Math.max(st.aggr * 0.7, st.threat, st.fear * 0.5);
    b[BN.hackle].position.set(bp[BN.hackle].x, bp[BN.hackle].y + 0.03 * K * hk, 0);
  }
})();
