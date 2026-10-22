/* ============================================================
   systems/melee.js — CBZ.melee: HOW PEOPLE FIGHT, the deciding half.

   Owner: "When you take over as a person you can actually punch and fight.
   The human build of the game can't fight well. The way humans fight needs
   to be much, much improved." — every game, because the city, the jail and
   NPC War share one human.

   What was there: systems/verbs_strike.js already landed a blow on the real
   rig (the fist meets the jaw on the frame it gets there) and posed it from
   the feet up (entities/meleeposes.js). What DECIDED the blows was thin and
   split three ways:
     · two NPC brains: combat_iq's IQ.melee (city peds, NPC War) was a
       five-state timer — close, circle, windup, swing — whose "swing" was a
       number subtracted from hp (NPC War never threw a punch on a rig at
       all), and verbs_strike's Fighter (jail, cage) threw jab-cross combos
       at one man and nothing else: no kicks, no feints, no clinch, no
       tackle, no reading what is open, no tiring to speak of, nobody ever
       gave up, and five men on one stood in a queue in front of him;
     · three player front-ends with three control schemes: the jail's click
       cycled jab-cross-hook, the city had LMB combo / RMB heavy / hold-RMB
       guard, and NPC War's possessed man subtracted 8 hp from whoever stood
       nearest every half second with no swing at all.

   This file is the one place those decisions live now:

     THE FIGHTER (V.fighter(a, o) -> F; F.tick(dt, target, o)) — every AI
       fist fight in every game. Measures range in three bands (kick, punch,
       clinch) and keeps the one it wants; reads the other man's wind-up and
       covers, slips, pulls or steps out after a human reaction time that
       gets slower when he is rocked; throws combinations that go where it is
       OPEN (a high guard gets the body and the legs, a rocked man gets the
       head, a dead leg gets kicked again), feints to draw the guard, counters
       off a slip, punishes a parried arm, kicks from outside, knees and
       elbows inside, shoots a tackle if he is that kind of fighter, and gets
       on a man who is down. Tires (every blow costs, a whiff costs more, a
       body shot takes it away), guards up and backs off when hurt, and with
       o.quit he gives up (yields) or runs (flees) when he is beaten.
     THE RING (M.ring(target)) — everybody fighting one man. Each attacker
       takes a slot round him (front, the two flanks, the back corners), at
       most two of them have a blow in the air at once, and the rest work
       their angle and feint instead of standing in a queue.
     THE BOUT (M.bout) — the fighter as combat_iq's IQ.melee: city peds and
       NPC War fight with it, and the page keeps its own damage.
     THE PLAYER (M.trigger(down) / M.pick) — the one control grammar: one
       attack button and the movement you are already doing.
         tap                 a quick strike (jab, cross, hook, body — the
                             combination rolls on while you keep tapping)
         tap + forward       the step-in power cross
         tap + sprint fwd    a tackle (on a man 1.4-3.4 m in front)
         tap + sideways      the hook from that side
         tap + back          the push kick (teep) that makes room
         chest to chest      uppercut, hook, knee, elbow
         HOLD                the guard (raised in the last beat before his
                             blow it is a PARRY: his arm is thrown wide)
         release a hold      the power shot: overhand (fwd), liver hook
                             (side), roundhouse (back), uppercut (close),
                             power cross (still)
         a man on the floor  ground and pound
         a weapon in hand    bat swings, knife slashes and stabs, rifle butt
       Touch: the attack button and the stick, nothing else.
     M.drive(actor, input, o) — the same grammar for a page that owns its own
       actors and input (NPC War's possessed man).

   Loads after systems/verbs_strike.js (the "verbs" studio pack carries it).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const V = CBZ.verbs = CBZ.verbs || {};
  const M = CBZ.melee = CBZ.melee || {};
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const TAU = Math.PI * 2;
  const MPf = () => CBZ.meleePoses || null;

  function isPlayer(a) { return !!a && (a.isPlayer === true || a === CBZ.player); }
  // the actor adapter: verbs.js's when it is loaded, a small one otherwise
  function bod(a) {
    if (!a) return null;
    if (typeof V.body === "function") { const B = V.body(a); if (B) return B; }
    let B = a._mlB;
    if (B) return B;
    B = a._mlB = {
      a,
      get isPlayer() { return isPlayer(a); },
      get ch() { return isPlayer(a) ? (CBZ.playerChar || null) : ((a.char && a.char.parts) ? a.char : null); },
      get pos() { return isPlayer(a) ? CBZ.player.pos : (a.pos || (a.group && a.group.position) || null); },
      yaw() { const ch = this.ch; return ch && ch.group ? ch.group.rotation.y : (a.yaw || 0); },
      face(y, k) { const ch = this.ch; if (!ch || !ch.group) return; let d = (y - ch.group.rotation.y) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; ch.group.rotation.y += d * (k >= 1 ? 1 : k); },
      dead() { return isPlayer(a) ? !!(CBZ.player && CBZ.player.dead) : !!a.dead; },
      down() { const ch = this.ch; return (!isPlayer(a) && a.ko > 0) || !!(ch && (ch.koPose || (ch.fall && ch.fall.on))); },
      hpRatio() { const hp = a.hp, mx = a.maxHp || a.hpMax || 100; return hp == null ? 1 : clamp01(hp / mx); },
    };
    return B;
  }
  function hpRatio(B) { return B && typeof B.hpRatio === "function" ? B.hpRatio() : 1; }
  function condOf(a) { return typeof V.condition === "function" ? V.condition(a) : null; }
  function reach(kind, a) { return typeof V.reachOf === "function" ? V.reachOf(kind, a) : 1.25; }
  function nowS() { return typeof V.strikeClock === "function" ? V.strikeClock() : (CBZ.now || 0) / 1000; }

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  V.fighterRng = mulberry;

  /* ============================================================
     THE RING — everybody fighting one man
     ============================================================ */
  const RINGS = new Map();          // target -> { m: [F...] }
  // slot bearings round the man, relative to the first attacker's line:
  // straight on, the two flanks, the back corners, behind
  const SLOT = [0, 1.25, -1.25, 2.35, -2.35, Math.PI, 0.65, -0.65];
  const MAX_SWINGERS = 2;
  function ringOf(t) { return RINGS.get(t) || null; }
  M.ring = function (t) { const r = ringOf(t); return r ? r.m.map((F) => F.a) : []; };
  function prune(r, t, now) {
    for (let i = r.m.length - 1; i >= 0; i--) {
      const F = r.m[i];
      const B = bod(F.a);
      if (F.target !== t || now - F.ringT > 0.6 || F.quit || !B || B.dead() || B.down()) { r.m.splice(i, 1); F.inRing = null; }
    }
    if (!r.m.length) RINGS.delete(t);
  }
  function joinRing(F, t, now) {
    let r = RINGS.get(t);
    if (!r) { r = { m: [], t: now }; RINGS.set(t, r); }
    F.ringT = now;
    if (F.inRing !== r) { if (F.inRing) leaveRing(F); r.m.push(F); F.inRing = r; }
    if (now - r.t > 0.25) { r.t = now; prune(r, t, now); }
    return r;
  }
  function leaveRing(F) {
    const r = F.inRing;
    if (!r) return;
    const i = r.m.indexOf(F);
    if (i >= 0) r.m.splice(i, 1);
    F.inRing = null;
    if (!r.m.length) RINGS.forEach((v, k) => { if (v === r) RINGS.delete(k); });
  }
  // how many of the ring have a blow in the air right now
  function swingers(r, self) {
    let n = 0;
    for (let i = 0; i < r.m.length; i++) {
      const F = r.m[i];
      if (F === self) continue;
      const S = typeof V.strikeOf === "function" ? V.strikeOf(F.a) : null;
      if (S && S.p < 0.62) n++;
    }
    return n;
  }
  // how many men are on THIS man (his own ring as a target)
  M.attackersOn = function (a) { const r = ringOf(a); return r ? r.m.length : 0; };

  /* ============================================================
     THE FIGHTER
     ============================================================ */
  // combinations: k = the blows, w = weight, r = the range they are thrown
  // from ("mid" punching range, "close" inside it, "kick" outside it),
  // open = what they go after (guard: a high guard is up, head: he is
  // rocked, legs: his leg is going, any)
  const COMBOS = [
    { k: ["jab"], w: 1.0, r: "mid", open: "any" },
    { k: ["jab", "cross"], w: 1.6, r: "mid", open: "any" },
    { k: ["jab", "jab", "cross"], w: 0.8, r: "mid", open: "any" },
    { k: ["cross", "hook"], w: 0.9, r: "mid", open: "head" },
    { k: ["jab", "cross", "hook"], w: 0.8, r: "mid", open: "head" },
    { k: ["hook", "cross"], w: 0.5, r: "mid", open: "head" },
    { k: ["overhand"], w: 0.35, r: "mid", open: "head" },
    { k: ["jab", "body"], w: 0.8, r: "mid", open: "guard" },
    { k: ["body", "hook"], w: 0.9, r: "mid", open: "guard" },
    { k: ["bodyStraight", "hook"], w: 0.6, r: "mid", open: "guard" },
    { k: ["jab", "cross", "lowKick"], w: 0.5, r: "mid", open: "legs", kick: true },
    { k: ["upper", "hook"], w: 0.9, r: "close", open: "any" },
    { k: ["body", "upper"], w: 0.7, r: "close", open: "guard" },
    { k: ["elbow"], w: 0.35, r: "close", open: "head" },
    { k: ["knee", "knee"], w: 0.45, r: "close", open: "guard", kick: true },
    { k: ["elbow", "knee"], w: 0.3, r: "close", open: "any", kick: true },
    { k: ["kick"], w: 0.8, r: "kick", open: "any", kick: true },
    { k: ["lowKick"], w: 1.0, r: "kick", open: "legs", kick: true },
    { k: ["roundKick"], w: 0.5, r: "kick", open: "guard", kick: true },
    { k: ["jab", "cross"], w: 0.6, r: "kick", open: "any" },
  ];
  const WEAPON_COMBOS = {
    bat: [{ k: ["bat"], w: 1 }, { k: ["bat", "kick"], w: 0.3 }],
    knife: [{ k: ["slash"], w: 1 }, { k: ["stab"], w: 0.8 }, { k: ["slash", "stab"], w: 0.6 }],
    rifle: [{ k: ["butt"], w: 1 }, { k: ["butt", "kick"], w: 0.4 }],
  };
  function weaponClass(w) {
    if (!w) return null;
    const k = w.kind || "";
    if (w.blade || k === "knife" || k === "shank") return "knife";
    if (k === "rifle" || k === "carbine" || k === "ak47" || k === "gun") return "rifle";
    return "bat";
  }
  const COST = { jab: 0.05, cross: 0.08, body: 0.08, bodyStraight: 0.07, hook: 0.09, upper: 0.09, overhand: 0.12,
    elbow: 0.07, knee: 0.09, kick: 0.11, lowKick: 0.10, roundKick: 0.15, headbutt: 0.08, bat: 0.13, slash: 0.06, stab: 0.07, butt: 0.10 };
  const WINDOW = 2.0, MAXN = 4;

  function Fighter(a, o) {
    o = o || {};
    this.a = a;
    STATS.fighters++;
    this.skill = clamp01(o.skill != null ? o.skill : (a.skill != null ? a.skill : 0.5));
    this.aggr = clamp01(o.aggression != null ? o.aggression : 0.55);
    this.rng = o.rng || mulberry(o.seed != null ? o.seed : ((Math.random() * 1e9) | 0));
    this.nerve = clamp01(o.nerve != null ? o.nerve : 0.35 + 0.3 * this.aggr + 0.25 * this.skill + (this.rng() - 0.5) * 0.2);
    // HOW he fights: a boxer stays on the punches, a kicker kicks from
    // outside, a brawler swings wide and shoots tackles
    const r = this.rng();
    this.style = o.style || (this.skill > 0.6 ? (r < 0.55 ? "boxer" : "kicker") : this.aggr > 0.6 && r < 0.45 ? "brawler" : r < 0.3 ? "kicker" : "boxer");
    // his chin (how much it takes to switch him off) is his, off the same seed
    if (a._chinRoll == null && !(a.chin > 0)) { try { a._chinRoll = this.rng(); } catch (e) { /* frozen */ } }
    this.state = "guard";
    this.combo = null; this.ci = 0;
    this.restT = 0.4 + this.rng() * 0.5;
    this.stam = 1;
    this.clock = 0;
    this.log = new Float64Array(8); this.logN = 0;
    this.readN = -1; this.defT = -1; this.defKind = null; this.defDir = 1; this.defAt = -9;
    this.stepCD = 0;
    this.act = { type: null, kind: null, arm: null, dir: 0, x: 0, z: 0 };
    this.tel = { kind: null, prog: 0, dur: 0, impactIn: 0, n: 0 };
    this.thrown = 0; this.landed = 0; this.blocked = 0; this.whiffs = 0;
    this.feintT = 0; this.counterT = 0; this.coverT = 0;
    this.quit = null; this.judgeT = 0;
    this.target = null; this.inRing = null; this.ringT = -9;
    this.goal = { x: 0, z: 0, on: false };
    this.tpx = null; this.tpz = 0; this.tvx = 0; this.tvz = 0;
    this.weapon = o.weapon || null;
    this.gnpLeft = null;
    this._o = null; this._land = null; this._whiff = null; this._block = null;
  }
  M.Fighter = Fighter;
  // what every fighter on the page has done (a probe reads it; cheap counters)
  const STATS = { fighters: 0, thrown: 0, landed: 0, blocked: 0, kos: 0, quits: 0 };
  M.audit = function () { return { fighters: STATS.fighters, thrown: STATS.thrown, landed: STATS.landed, blocked: STATS.blocked, kos: STATS.kos, quits: STATS.quits, rings: RINGS.size }; };
  Fighter.prototype.recent = function () {
    let n = 0;
    for (let i = 0; i < this.log.length; i++) if (this.log[i] > 0 && this.clock - this.log[i] < WINDOW) n++;
    return n;
  };
  Fighter.prototype.telegraph = function () { return typeof V.telegraphOf === "function" ? V.telegraphOf(this.a, this.tel) : null; };
  Fighter.prototype.leave = function () { leaveRing(this); this.target = null; };

  // HAS HE HAD ENOUGH? Checked about once a second; once he has decided he
  // stays decided. Hurt, outnumbered, been on the floor — against his nerve.
  Fighter.prototype.judge = function (B, c) {
    if (this.clock - this.judgeT < 1.0) return null;
    this.judgeT = this.clock;
    const hp = hpRatio(B);
    // gassed alone is not beaten (a tired man covers and holds on); hurt is
    const hurt = Math.max(c ? c.daze * 1.1 : 0, c ? c.wind * 0.6 : 0, 1 - hp) + 0.15 * (1 - this.stam);
    const on = M.attackersOn(this.a);
    let p = 0;
    if (hurt > 0.85) p += 0.3;
    else if (hurt > 0.65) p += 0.08;
    if (c && c.downs >= 2) p += 0.15 * (c.downs - 1);
    if (on >= 3) p += 0.12 * (on - 2);
    p *= 1.4 - this.nerve;
    if (p <= 0 || this.rng() >= p) return null;
    return this.rng() < 0.35 + 0.4 * (1 - this.aggr) ? "yield" : "flee";
  };

  Fighter.prototype.tick = function (dt, target, o) {
    o = o || {};
    const a = this.a, B = bod(a), ch = B && B.ch;
    this.clock += dt;
    const A = this.act;
    A.type = null;
    if (!B || B.dead() || !target) { this.leave(); return null; }
    if (B.down()) { this.state = "guard"; this.combo = null; this.feintT = 0; return null; }
    const Bt = bod(target);
    if (!Bt || !Bt.pos || Bt.dead()) { this.leave(); return null; }
    if (this.target !== target) { leaveRing(this); this.target = target; this.tpx = null; }
    this._o = o;
    if (o.weapon !== undefined) this.weapon = o.weapon;
    const mine = typeof V.strikeOf === "function" ? V.strikeOf(a) : null;
    const c = condOf(a);
    const now = nowS();

    // ---- STAMINA: every blow costs it, the guard and a breath give it back
    const regen = (mine ? 0.015 : this.state === "rest" ? 0.11 : 0.075) * (1 - 0.5 * clamp01(c ? c.wind : 0));
    this.stam = Math.min(1, this.stam + dt * regen);
    if (ch) ch.winded = clamp01(1 - this.stam * 1.25);
    const ap = B.pos, tp = Bt.pos;
    const dx = tp.x - ap.x, dz = tp.z - ap.z, dist = Math.hypot(dx, dz) || 1e-4;
    const ux = dx / dist, uz = dz / dist;
    // his drift: is he backing off (cut him off) or coming on
    if (this.tpx != null && dt > 0) {
      const k = Math.min(1, dt * 6);
      this.tvx += ((tp.x - this.tpx) / dt - this.tvx) * k; this.tvz += ((tp.z - this.tpz) / dt - this.tvz) * k;
    }
    this.tpx = tp.x; this.tpz = tp.z;

    // ---- HAS HE HAD ENOUGH?
    if (!this.quit && o.quit) { this.quit = this.judge(B, c); if (this.quit) { STATS.quits++; this.quitT = 0; } }
    if (this.quit) {
      leaveRing(this);
      this.quitT = (this.quitT || 0) + dt;
      // it wears off: a man who gave up a fight is not a man who never fights
      // again (his own brain still decides whether he comes back)
      if (this.quitT > 10) {
        if (ch && this.quit === "yield") ch.handsUp = false;
        this.quit = null; this.stam = Math.max(this.stam, 0.5);
      } else {
        if (ch) { ch.fightStance = false; if (this.quit === "yield") ch.handsUp = true; }
        A.type = this.quit;
        this.goal.on = true;
        if (this.quit === "flee") { this.goal.x = ap.x - ux * 8; this.goal.z = ap.z - uz * 8; }
        else { this.goal.x = ap.x; this.goal.z = ap.z; }
        return A;
      }
    }
    if (ch) ch.fightStance = true;
    // HE GAVE UP: hands up or running, you do not keep hitting him
    const hisF = target._vfS;
    if (hisF && hisF.quit) {
      leaveRing(this);
      this.combo = null; this.state = "guard";
      this.goal.on = true; this.goal.x = ap.x; this.goal.z = ap.z;
      return null;
    }
    const ring = joinRing(this, target, now);
    const slot = ring.m.indexOf(this);

    // ---- HE IS DOWN: get on him and pound him out (one man mounts; the
    // rest of the ring stands over him at its slots)
    if (Bt.down()) {
      this.combo = null; this.state = "guard";
      if (mine || !o.perform || o.groundAndPound === false) return this.footwork(dt, dist, ux, uz, 1.3, o, target, ring, slot);
      if (this.gnpLeft == null) this.gnpLeft = 3 + ((this.rng() * (3 + 4 * this.aggr)) | 0);
      if (this.gnpLeft <= 0 || typeof V.groundStrike !== "function") return this.footwork(dt, dist, ux, uz, 1.3, o, target, ring, slot);
      if (dist > 2.0) { this.goal.on = true; this.goal.x = tp.x; this.goal.z = tp.z; return this.footwork(dt, dist, ux, uz, 1.2, o, target, ring, slot); }
      if (this.rng() > (1.6 + 2.4 * this.aggr) * dt) return null;
      if (!V.groundStrike(a, target, { onLand: this.landFn(o), rng: this.rng, weapon: this.weapon })) return this.footwork(dt, dist, ux, uz, 1.3, o, target, ring, slot);
      this.gnpLeft--; this.thrown++;
      this.stam = Math.max(0, this.stam - 0.06);
      A.type = "ground"; A.kind = "gnp";
      return A;
    }
    this.gnpLeft = null;
    if (!mine) B.face(Math.atan2(dx, dz), Math.min(1, dt * 8));

    // ---- a feint is a blow pulled back before it is thrown
    if (this.feintT > 0) {
      this.feintT -= dt;
      if (this.feintT <= 0 && typeof V.cancelStrike === "function") V.cancelStrike(a);
      return null;
    }
    if (this.counterT > 0) this.counterT -= dt;
    if (this.coverT > 0) {
      this.coverT -= dt;
      if (typeof V.block === "function") V.block(a, 0.12);
    }

    // ---- DEFENCE: read the wind-up, answer after a human reaction time
    const daze = c ? c.daze : 0;
    const tel = this.threat(target, ring);
    if (tel && tel.n !== this.readN && tel.prog < 0.45) {
      this.readN = tel.n;
      // rocked men react late; a tired one too
      this.defT = (0.30 - 0.12 * this.skill) * (1 + 0.7 * daze + 0.3 * (1 - this.stam)) + (this.rng() - 0.5) * 0.06;
      this.defAt = this.clock;
      this.defDir = this.rng() < 0.5 ? -1 : 1;
      const MP = MPf();
      const lvl = MP && tel.kind ? MP.levelOf(tel.kind) : "head";
      const r = this.rng();
      const hurt = daze > 0.45 || hpRatio(B) < 0.35;
      if (hurt && r < 0.7) this.defKind = "cover";
      else if (lvl === "legs") this.defKind = r < 0.5 ? "back" : "block";
      else if (lvl === "body") this.defKind = r < 0.55 ? "back" : "pull";
      else {
        const pBlock = 0.55 - 0.25 * this.skill, pSlip = 0.25 + 0.25 * this.skill;
        this.defKind = r < pBlock ? "block" : r < pBlock + pSlip ? "slip" : r < pBlock + pSlip + 0.12 ? "duck" : "pull";
      }
    }
    if (this.defT >= 0) {
      this.defT -= dt;
      if (this.defT < 0) {
        this.defT = -1;
        // A punch lands 0.1-0.15 s after it starts: nobody reacts to the
        // FIRST one. What a fighter reacts to is the exchange: he saw it start,
        // and after his reaction time he covers or moves for the shots behind it.
        if (this.clock - this.defAt < 0.65 && !mine && dist < reach("overhand", target) + 0.4 &&
            this.rng() < (0.35 + 0.6 * this.skill) * (1 - 0.5 * daze)) {
          A.type = this.defKind === "block" || this.defKind === "cover" ? "block" : this.defKind === "back" ? "step" : "slip";
          A.kind = this.defKind; A.dir = this.defDir;
          if (A.type === "step") { A.x = -ux; A.z = -uz; A.dir = -1; }
          this.state = "guard"; this.combo = null;
          // a man who made it miss throws back into the hole
          if ((A.type === "slip" || A.kind === "back") && this.rng() < 0.25 + 0.55 * this.skill) this.counterT = 0.35;
          return this.perform(o, target);
        }
      }
    }

    // ---- OFFENCE
    const rJab = reach("jab", a), rClose = reach("upper", a) + 0.15, rKick = reach("kick", a) + 0.55;
    const wcls = weaponClass(this.weapon);
    const rWeap = wcls === "bat" ? reach("bat", a) : wcls === "rifle" ? reach("butt", a) : wcls === "knife" ? reach("slash", a) : rJab;
    const rWant = wcls ? rWeap - 0.1 : this.style === "kicker" ? rJab + 0.4 : this.style === "brawler" ? rJab - 0.15 : rJab;
    if (this.state === "combo") {
      if (mine && mine.p < 0.62) return null;                   // let this one finish its beat
      if (this.ci >= this.combo.length) {
        this.state = "rest";
        this.restT = (0.45 + this.rng() * 0.8) * (1 + (1 - this.stam) * 1.4) * (1.2 - 0.4 * this.aggr);
        return null;
      }
      if (this.recent() >= MAXN) return null;
      return this.strikeAct(this.combo[this.ci++], o, target);
    }
    if (this.state === "rest") {
      this.restT -= dt;
      if (this.restT > 0 && !(this.counterT > 0)) return this.footwork(dt, dist, ux, uz, rWant, o, target, ring, slot);
      this.state = "guard";
    }
    if (mine) return null;
    // FLANK FIRST: a man whose slot is round the side goes there before he
    // swings (a ring is pointless if everybody throws from where he arrived)
    if (slot > 0 && ring.m.length > 1 && !(this.counterT > 0)) {
      const Bl = bod(ring.m[0].a);
      if (Bl && Bl.pos) {
        const base = Math.atan2(Bl.pos.x - tp.x, Bl.pos.z - tp.z);
        const at = Math.atan2(ap.x - tp.x, ap.z - tp.z);
        let e = (base + SLOT[slot % SLOT.length] - at) % TAU;
        if (e > Math.PI) e -= TAU; else if (e < -Math.PI) e += TAU;
        if (Math.abs(e) > 0.7) return this.footwork(dt, dist, ux, uz, rWant, o, target, ring, slot);
      }
    }
    // the gap is open NOW: his arm thrown wide off a parry, or my counter
    const tc = condOf(target);
    const open = !!(tc && tc.openT > 0);
    if ((open || this.counterT > 0) && dist < rJab + 0.45 && this.recent() < MAXN && this.stam > 0.1) {
      this.counterT = 0;
      this.combo = wcls ? WEAPON_COMBOS[wcls][0].k : this.rng() < 0.5 ? ["cross", "hook"] : this.rng() < 0.5 ? ["hook"] : ["body", "hook"];
      this.ci = 0; this.state = "combo";
      return this.strikeAct(this.combo[this.ci++], o, target);
    }
    const far = wcls ? rWeap + 0.6 : this.style === "kicker" ? rKick : rJab + 0.55;
    // a brawler shoots the takedown from outside
    if (!wcls && this.style === "brawler" && dist > 1.5 && dist < 3.2 && this.stam > 0.4 &&
        typeof V.tackle === "function" && this.rng() < 0.18 * dt * (0.5 + this.aggr)) {
      if (V.tackle(a, target, {})) { this.stam -= 0.2; this.thrown++; A.type = "tackle"; return A; }
    }
    if (dist > far) return this.footwork(dt, dist, ux, uz, rWant, o, target, ring, slot);
    if (this.stam < 0.18 || this.recent() >= MAXN) return this.footwork(dt, dist, ux, uz, rWant + 0.4, o, target, ring, slot);
    // THE RING: two men swinging at him at once is a gang; the third waits
    // for an opening on his angle instead of queueing behind them
    if (ring.m.length > 2 && swingers(ring, this) >= MAX_SWINGERS) {
      if (this.rng() < 0.6 * dt) return this.feint(o, target);
      return this.footwork(dt, dist, ux, uz, rWant, o, target, ring, slot);
    }
    const want = (0.8 + 1.8 * this.aggr) * dt * (0.4 + 0.6 * this.stam) * (1 - 0.5 * daze);
    if (this.rng() > want) return this.footwork(dt, dist, ux, uz, rWant, o, target, ring, slot);
    // ---- what is OPEN on him
    const tch = Bt.ch;
    const guardUp = !!(tch && ((tch.blockK || 0) > 0.5 || tch.blockT > 0));
    const tf = target._vfS;
    const rocked = !!(tc && tc.daze > 0.4) || (tf && tf.stam < 0.3);
    const legs = !!(tc && tc.legs > 0.45);
    let combo;
    if (wcls) combo = pickW(WEAPON_COMBOS[wcls], this.rng);
    else {
      const band = dist < rClose ? "close" : dist > rJab + 0.25 ? "kick" : "mid";
      const kickW = this.style === "kicker" ? 1.8 : this.style === "brawler" ? 0.6 : 0.8;
      let tot = 0;
      for (let i = 0; i < COMBOS.length; i++) tot += comboW(COMBOS[i], band, guardUp, rocked, legs, kickW);
      let pick = this.rng() * tot;
      combo = COMBOS[0].k;
      for (let i = 0; i < COMBOS.length; i++) {
        const w = comboW(COMBOS[i], band, guardUp, rocked, legs, kickW);
        if (w <= 0) continue;
        pick -= w;
        if (pick <= 0) { combo = COMBOS[i].k; break; }
      }
      // a brawler throws it wide: the straights become hooks and overhands
      if (this.style === "brawler" && this.rng() < 0.5) combo = combo.map((k) => (k === "cross" ? "overhand" : k === "jab" ? "hook" : k));
    }
    // FEINT first: show the jab, pull it, and throw into whatever he did about it
    if (!wcls && this.rng() < 0.06 + 0.22 * this.skill && this.recent() < MAXN - 1) {
      this.combo = combo; this.ci = 0; this.state = "combo";
      return this.feint(o, target);
    }
    this.combo = combo; this.ci = 0; this.state = "combo";
    return this.strikeAct(this.combo[this.ci++], o, target);
  };
  function comboW(C, band, guardUp, rocked, legs, kickW) {
    if (C.r !== band) return 0;
    let w = C.w;
    if (C.kick) w *= kickW;
    if (C.open === "guard") w *= guardUp ? 2.6 : 0.8;
    else if (C.open === "head") w *= rocked ? 2.4 : guardUp ? 0.45 : 1;
    else if (C.open === "legs") w *= legs ? 2.6 : 1;
    return w;
  }
  function pickW(list, rng) {
    let tot = 0;
    for (let i = 0; i < list.length; i++) tot += list[i].w;
    let p = rng() * tot;
    for (let i = 0; i < list.length; i++) { p -= list[i].w; if (p <= 0) return list[i].k; }
    return list[0].k;
  }
  // the most imminent blow coming at me: from my man, or anybody else in
  // the ring round me
  const _tel2 = { kind: null, prog: 0, dur: 0, impactIn: 0, n: 0 };
  Fighter.prototype.threat = function (target, ring) {
    if (typeof V.telegraphOf !== "function") return null;
    let best = V.telegraphOf(target, this.tel);
    const mine = ringOf(this.a);
    if (mine && mine.m.length > 1) {
      const ap = bod(this.a).pos;
      for (let i = 0; i < mine.m.length; i++) {
        const F = mine.m[i];
        if (F.a === target) continue;
        const Bq = bod(F.a);
        if (!Bq || !Bq.pos || Math.hypot(Bq.pos.x - ap.x, Bq.pos.z - ap.z) > 1.8) continue;
        const t = V.telegraphOf(F.a, _tel2);
        if (t && (!best || t.impactIn < best.impactIn)) {
          this.tel.kind = t.kind; this.tel.prog = t.prog; this.tel.dur = t.dur; this.tel.impactIn = t.impactIn; this.tel.n = t.n + 100000 * (i + 1);
          best = this.tel;
        }
      }
    }
    void ring;
    return best;
  };
  Fighter.prototype.feint = function (o, target) {
    if (typeof V.strike !== "function") return null;
    const S = V.strike(this.a, target, { kind: "jab", lunge: false, rng: this.rng });
    if (!S) return null;
    this.feintT = 0.06 + this.rng() * 0.05;
    this.stam = Math.max(0, this.stam - 0.02);
    const A = this.act; A.type = "feint"; A.kind = "jab";
    return A;
  };
  Fighter.prototype.landFn = function (o) {
    const self = this;
    if (!this._land || this._landO !== o) {
      this._landO = o;
      this._land = function (res) { self.landed++; STATS.landed++; if (res.blocked) STATS.blocked++; if (res.ko) STATS.kos++; if (o && o.onLand) o.onLand(res); };
      this._whiff = function (res) { self.whiffs++; self.stam = Math.max(0, self.stam - 0.03); if (o && o.onWhiff) o.onWhiff(res); };
      this._block = function (res) { self.blocked++; STATS.blocked++; if (o && o.onBlocked) o.onBlocked(res); else if (o && o.onLand) o.onLand(res); };
    }
    return this._land;
  };
  Fighter.prototype.strikeAct = function (kind, o, target) {
    const A = this.act;
    A.type = "strike"; A.kind = kind; A.arm = null;
    this.log[this.logN++ % this.log.length] = this.clock;
    this.stam = Math.max(0, this.stam - (COST[kind] || 0.09));
    this.thrown++; STATS.thrown++;
    return this.perform(o, target);
  };
  Fighter.prototype.footwork = function (dt, dist, ux, uz, want, o, target, ring, slot) {
    const a = this.a, B = bod(a), Bt = bod(target);
    // where I want to stand: my slot round him at the range I want
    const r = ring || this.inRing;
    let gx, gz;
    const tp = Bt.pos, ap = B.pos;
    if (r && r.m.length > 1 && slot > 0) {
      const lead = r.m[0], Bl = bod(lead.a);
      const base = Bl && Bl.pos ? Math.atan2(Bl.pos.x - tp.x, Bl.pos.z - tp.z) : Math.atan2(-ux, -uz);
      const b = base + SLOT[slot % SLOT.length];
      gx = tp.x + Math.sin(b) * want; gz = tp.z + Math.cos(b) * want;
    } else {
      // CUT HIM OFF: a man backing away is met where he is going
      const tv = Math.hypot(this.tvx, this.tvz);
      const away = tv > 0.6 && (this.tvx * ux + this.tvz * uz) > 0.4 * tv;
      const lead = away ? 0.6 : 0;
      gx = tp.x + this.tvx * lead - ux * want; gz = tp.z + this.tvz * lead - uz * want;
    }
    this.goal.on = true; this.goal.x = gx; this.goal.z = gz;
    this.stepCD -= dt;
    if (this.stepCD > 0) return null;
    const A = this.act;
    const c = condOf(a);
    const hurt = (c && c.daze > 0.45) || this.stam < 0.25;
    const ex = gx - ap.x, ez = gz - ap.z, el = Math.hypot(ex, ez);
    if (hurt && dist < want + 0.3) {
      // hurt: out of his range, and off his line
      const s = this.rng() < 0.5 ? 1 : -1;
      A.type = "step"; A.x = -ux * 0.8 + uz * s * 0.6; A.z = -uz * 0.8 - ux * s * 0.6; A.dir = -1;
      if (this.rng() < 0.5) this.coverT = 0.5;
    } else if (dist < want - 0.45) { A.type = "step"; A.x = -ux; A.z = -uz; A.dir = -1; }
    else if (el > 0.25 && el < 3.5) { A.type = "step"; A.x = ex / el; A.z = ez / el; A.dir = (ex * ux + ez * uz) / el > 0.3 ? 1 : 0; A.d = Math.min(0.5, Math.max(0.28, el * 0.6)); }
    else if (el >= 3.5) { A.type = "walk"; A.x = ex / el; A.z = ez / el; A.dir = 1; this.stepCD = 0.2; return A; }
    else if (this.rng() < 0.3) { const s = this.rng() < 0.5 ? 1 : -1; A.type = "step"; A.x = uz * s; A.z = -ux * s; A.dir = 0; }   // circle
    else return null;
    this.stepCD = (0.40 + this.rng() * 0.35) * (1.25 - 0.4 * this.skill);
    return this.perform(o, target);
  };
  Fighter.prototype.perform = function (o, target) {
    const A = this.act;
    if (!o.perform || !A.type) return A.type ? A : null;
    if (A.type === "strike") {
      // SKILL IS IN THE BLOW: a trained man's hand goes where he sends it,
      // turns the hips over (more of him arrives) and is quicker there and
      // back; a rocked or gassed one sprays and pushes
      const c = condOf(this.a), daze = c ? c.daze : 0;
      const so = this._so || (this._so = { kind: null, arm: undefined, weapon: null, onLand: null, onWhiff: null, onBlocked: null, rng: null, maxLunge: 0.35, aimErr: 0, power: undefined, speed: 1 });
      so.kind = A.kind; so.arm = A.arm || undefined; so.weapon = this.weapon || null;
      so.onLand = this.landFn(o); so.onWhiff = this._whiff; so.onBlocked = this._block; so.rng = this.rng;
      so.aimErr = (0.16 - 0.13 * this.skill) * (1 + 1.2 * daze + 0.5 * (1 - this.stam));
      so.power = clamp01((typeof V.powerOf === "function" ? V.powerOf(A.kind) : 0.7) * (0.70 + 0.45 * this.skill));
      so.speed = (0.88 + 0.2 * this.skill) * (1 - 0.12 * daze);
      const S = V.strike(this.a, target, so);
      if (!S) { this.ci = Math.max(0, this.ci - 1); return null; }
    } else if (A.type === "block") V.block(this.a, A.kind === "cover" ? 0.75 : 0.45);
    else if (A.type === "slip") V.slip(this.a, A.dir, A.kind === "pull" ? "pull" : A.kind === "duck" ? "duck" : "slip");
    else if (A.type === "step") { V.step(this.a, A.x, A.z, A.d > 0 ? A.d : A.dir < 0 ? 0.32 : 0.28); A.d = 0; }
    return A;
  };
  V.fighter = M.fighter = function (a, o) {
    if (!a) return null;
    return a._vfS || (a._vfS = new Fighter(a, o));
  };

  /* ============================================================
     THE BOUT — the fighter as combat_iq's IQ.melee
     IQ.melee(a, tgt, dt, opts) hands the exchange here when both bodies
     have a rig. The fighter throws real strikes. Two contracts:
       opts.onLand given: the caller's damage runs in it (city peds), the
         return is the fighter's action ("strike", "step", "guard"...).
       no onLand (NPC War): the return is "swing" on the call after a blow
         LANDED, and IQ.lastBlow(a) is what it did ({zone, dmgMul, force,
         power, kind, ko}), so the page's own hurt runs once per real hit.
     Movement: a.target gets the fighter's goal (his slot, his range, or
     the way out when he runs), the way every page already steers.
     ============================================================ */
  M.can = function (a, t) {
    if (typeof V.strike !== "function" || !MPf() || !a || !t) return false;
    const Ba = bod(a), Bt = bod(t);
    return !!(Ba && Ba.ch && Ba.ch.parts && Bt && (Bt.ch || Bt.pos));
  };
  M.bout = function (a, tgt, dt, o) {
    o = o || {};
    const F = V.fighter(a, { skill: o.skill, aggression: o.aggression != null ? o.aggression : a.aggr, seed: o.seed });
    let bo = a._mBoutO;
    if (!bo) {
      bo = a._mBoutO = { perform: true, quit: true, onLand: null, user: null, last: { zone: null, dmgMul: 1, force: 0, power: 0, kind: null, ko: false, blocked: false, n: 0 } };
      bo.onLand = function (res) {
        const L = bo.last;
        L.zone = res.zone; L.dmgMul = res.dmgMul; L.force = res.force; L.power = res.power; L.kind = res.kind; L.ko = !!res.ko; L.blocked = !!res.blocked; L.n++;
        // "swing" is a blow that LANDED: one taken on the forearms is not a hit
        if (bo.user) bo.user(res); else if (!res.blocked) a._mHit = true;
      };
    }
    bo.user = o.onLand || null;
    // giving up is opt-in: a page with its own morale (NPC War routs whole
    // armies through CBZ.brain) keeps that decision; the street opts in
    bo.quit = !!o.quit;
    bo.weapon = o.weapon !== undefined ? o.weapon : null;
    const act = F.tick(dt, tgt, bo);
    const B = bod(a);
    if (a.target && B && B.pos) {
      if (B.down()) a.target.set(B.pos.x, a.target.y || 0, B.pos.z);
      else if (F.goal.on) a.target.set(F.goal.x, a.target.y || 0, F.goal.z);
      else a.target.set(B.pos.x, a.target.y || 0, B.pos.z);
    }
    if (a._mHit) { a._mHit = false; return "swing"; }
    if (F.quit) return F.quit;
    return act ? act.type : (F.state === "combo" ? "windup" : "guard");
  };
  M.lastBlow = function (a) { return a && a._mBoutO ? a._mBoutO.last : null; };

  /* ============================================================
     THE PLAYER — one button and the stick
     ============================================================ */
  const TAP_SEQ = ["jab", "cross", "hook", "body"];
  const CLOSE_SEQ = ["upper", "hook", "knee", "elbow"];
  const HOLD_GUARD = 0.16;     // s held before the hands come up
  const HOLD_POWER = 0.30;     // s held for the release to be a power shot
  const POWER_MAX = 2.2;       // s: a guard held longer is just a guard (release drops it)
  /* M.pick(c) -> { verb: "strike"|"tackle"|"ground", kind, heavy, arm, lunge }
     c = { mode: "tap"|"power", fwd, side, back (0..1 each, side -1..1),
           sprint, dist (centre to centre to the man in front, 99 = none),
           down (the man in front is on the floor), weapon {kind, blade},
           cuffed, n (how many quick strikes in this run) } */
  const _pk = { verb: "strike", kind: "jab", heavy: false, arm: null, lunge: null };
  const BUTT_D = 1.0;          // m centre to centre: inside this a cuffed man headbutts
  M.BUTT_D = BUTT_D;
  M.pick = function (c) {
    const P = _pk;
    P.verb = "strike"; P.heavy = false; P.arm = null; P.lunge = null;
    const power = c.mode === "power";
    // hands behind the back: a man chest to chest gets the forehead, further
    // out the foot is all there is
    if (c.cuffed) { P.kind = (c.dist != null ? c.dist : 99) < BUTT_D ? "headbutt" : "kick"; P.heavy = P.kind === "headbutt"; return P; }
    if (c.down) { P.verb = "ground"; P.kind = power ? "gnpElbow" : "gnp"; P.heavy = power; return P; }
    const fwd = c.fwd > 0.5, back = c.back > 0.5, side = Math.abs(c.side || 0) > 0.5 ? (c.side > 0 ? 1 : -1) : 0;
    const dist = c.dist != null ? c.dist : 99;
    const wc = weaponClass(c.weapon);
    if (wc === "bat") { P.kind = back ? "kick" : "bat"; P.heavy = power || fwd; return P; }
    if (wc === "knife") { P.kind = fwd || power ? "stab" : back ? "kick" : "slash"; P.heavy = power; return P; }
    if (wc === "rifle") { P.kind = back ? "kick" : "butt"; P.heavy = power; return P; }
    const close = dist < 0.85;
    if (!power) {
      if (c.sprint && fwd && dist > 1.4 && dist < 3.4) { P.verb = "tackle"; P.kind = "tackle"; return P; }
      if (fwd && !close) { P.kind = "cross"; P.lunge = 1.0; return P; }
      if (side) { P.kind = "hook"; P.arm = side > 0 ? "l" : "r"; return P; }
      if (back) { P.kind = "kick"; return P; }
      const n = Math.max(0, (c.n || 1) - 1);
      P.kind = close ? CLOSE_SEQ[n % CLOSE_SEQ.length] : TAP_SEQ[n % TAP_SEQ.length];
      return P;
    }
    P.heavy = true;
    if (close) P.kind = "upper";
    else if (fwd) { P.kind = "overhand"; P.lunge = 1.0; }
    else if (side) { P.kind = "body"; P.arm = side > 0 ? "l" : "r"; }
    else if (back) P.kind = "roundKick";
    else P.kind = "cross";
    return P;
  };

  // what the player's stick says, in HIS frame (forward = where he faces)
  const _mv = { fwd: 0, side: 0, back: 0, sprint: false };
  M.playerMove = function () {
    const k = CBZ.keys || {};
    _mv.fwd = k["w"] ? 1 : 0; _mv.back = k["s"] ? 1 : 0;
    _mv.side = (k["d"] ? 1 : 0) - (k["a"] ? 1 : 0);
    _mv.sprint = !!k["shift"] || !!(CBZ.player && CBZ.player.sprint);
    return _mv;
  };

  /* M.trigger(down) — the attack button, from the mouse or the touch FIRE
     button. The game plugs in once with M.adapt(mode, adapter):
       adapter.ready()          -> can the player fight right now (no gun out,
                                   not in a car, not held...)
       adapter.context(c)       -> fills c.dist / c.down / c.weapon / c.cuffed
       adapter.strike(spec, c)  -> throws it through the game's own damage;
                                   true if it went
       adapter.guard(on)        -> (optional) the game's own guard bookkeeping
     The press throws at once (no waiting to see if it is a tap); holding it
     past HOLD_GUARD raises the guard; letting go of a hold throws the power
     shot. The guard is the rig's (V.block), so every blow that meets it from
     the front is blocked on the forearms, and one raised just before a blow
     is a parry. */
  const PC = { down: false, at: 0, guard: false, n: 0, lastT: -9, mode: null, ad: null };
  const ADAPT = {};
  M.adapt = function (mode, ad) { ADAPT[mode] = ad; };
  function adapterNow() {
    const m = CBZ.game && CBZ.game.mode;
    return ADAPT[m] || ADAPT["*"] || null;
  }
  const _ctx = { mode: "tap", fwd: 0, side: 0, back: 0, sprint: false, dist: 99, down: false, weapon: null, cuffed: false, n: 1 };
  function ctxNow(ad, mode) {
    const mv = M.playerMove();
    const c = _ctx;
    c.mode = mode; c.fwd = mv.fwd; c.side = mv.side; c.back = mv.back; c.sprint = mv.sprint;
    c.dist = 99; c.down = false; c.weapon = null; c.cuffed = false;
    c.n = PC.n;
    if (ad && ad.context) { try { ad.context(c); } catch (e) { /* the game's own */ } }
    return c;
  }
  function wallS() { return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000; }
  /* WALKED IN CUFFS, THE BUTTON IS THE BACK OF YOUR HEAD. The man holding
     you is right behind you (CBZ.verbs.headbuttHold); the game's adapter
     lands it as it lands any blow on an officer (adapter.landButt(res)).
     Called from the trigger here (touch FIRE, the pad) and from verbs.js's
     click while held (the mouse). true = thrown (the press is spent). */
  let buttAt = -9;
  M.butt = function () {
    const V = CBZ.verbs, C = CBZ.cuffedPlayer;
    if (!V || !V.headbuttHold || !V.playerActor || !(C && C.on())) return false;
    const g = CBZ.game;
    if (!g || g.state !== "playing" || (CBZ.player && CBZ.player.dead)) return false;
    const ad = adapterNow();
    if (!ad || !ad.landButt) return false;
    const t = wallS();
    if (t - buttAt < 0.9) return !!(V.playerHeld && V.playerHeld());   // one at a time: the last is still coming back
    const S = V.headbuttHold(V.playerActor(), { onLand: function (res) { ad.landButt(res); } });
    if (!S) return false;
    buttAt = t;
    return true;
  };
  M.trigger = function (down) {
    if (down && M.butt()) return true;
    const ad = adapterNow();
    if (!ad || (ad.ready && !ad.ready())) { PC.down = false; if (PC.guard) setGuard(ad, false); return false; }
    const t = wallS();
    if (down) {
      if (PC.down) return true;
      PC.down = true; PC.at = t; PC.ad = ad;
      PC.n = t - PC.lastT < 1.0 ? PC.n + 1 : 1;
      PC.lastT = t;
      const c = ctxNow(ad, "tap");
      const spec = M.pick(c);
      let ok = false;
      try { ok = !!ad.strike(spec, c); } catch (e) { ok = false; }
      if (!ok) PC.n = Math.max(0, PC.n - 1);
      return ok;
    }
    if (!PC.down) return false;
    PC.down = false;
    const held = t - PC.at;
    if (PC.guard) setGuard(ad, false);
    if (held >= HOLD_POWER && held <= POWER_MAX) {
      PC.n = 0;
      const c = ctxNow(ad, "power");
      const spec = M.pick(c);
      try { return !!ad.strike(spec, c); } catch (e) { return false; }
    }
    return false;
  };
  function setGuard(ad, on) {
    PC.guard = on;
    if (ad && ad.guard) { try { ad.guard(on); } catch (e) { /* the game's own */ } }
  }
  M.holding = function () { return PC.down; };
  M.guarding = function () { return PC.guard; };
  // the held button raises the guard and keeps it up
  function playerTick() {
    if (!PC.down) return;
    const ad = PC.ad;
    if (!ad || (ad.ready && !ad.ready())) { PC.down = false; if (PC.guard) setGuard(ad, false); return; }
    const held = wallS() - PC.at;
    if (held < HOLD_GUARD) return;
    // the strike thrown on the press runs out first; then the hands come up
    const pa = typeof V.playerActor === "function" ? V.playerActor() : null;
    if (pa && typeof V.strikeOf === "function" && V.strikeOf(pa)) return;
    if (!PC.guard) setGuard(ad, true);
    if (pa && typeof V.block === "function") V.block(pa, 0.14);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(11.5, playerTick);

  /* ============================================================
     M.drive(actor, input, o) — the same grammar for a page that owns its
     own actors and its own input (NPC War's possessed man):
       input = { attack: bool (held this frame), fwd, side, back, sprint }
       o = { candidates(out), onLand(res), onBlocked(res), weapon, dt }
     Call it every frame for the possessed fists man. Returns the spec it
     threw (or null). The strikes are the AI's strikes (V.strike), aimed at
     whoever is in front of him, landing where the fist meets them.
     ============================================================ */
  M.drive = function (actor, input, o) {
    o = o || {};
    const B = bod(actor);
    if (!B || !B.pos || B.dead() || B.down() || typeof V.strike !== "function") return null;
    let st = actor._mDrv;
    if (!st) st = actor._mDrv = { down: false, at: 0, n: 0, lastT: -9, guard: false, t: 0, c: { mode: "tap", fwd: 0, side: 0, back: 0, sprint: false, dist: 99, down: false, weapon: null, cuffed: false, n: 1 } };
    st.t += o.dt != null ? o.dt : 1 / 60;
    const press = !!input.attack;
    let threw = null;
    const fill = function (mode) {
      const c = st.c;
      c.mode = mode; c.fwd = input.fwd || 0; c.side = input.side || 0; c.back = input.back || 0; c.sprint = !!input.sprint;
      c.weapon = o.weapon || null; c.cuffed = false; c.n = st.n;
      const f = frontOf(actor, B, o.candidates);
      c.dist = f ? f.d : 99; c.down = !!(f && f.down); c.who = f ? f.a : null;
      return c;
    };
    const go = function (spec, c) {
      if (spec.verb === "ground") {
        if (!c.who || typeof V.groundStrike !== "function") return null;
        return V.groundStrike(actor, c.who, { onLand: o.onLand, heavy: spec.heavy, weapon: o.weapon || null }) ? spec : null;
      }
      if (spec.verb === "tackle") return c.who && typeof V.tackle === "function" && V.tackle(actor, c.who, {}) ? spec : null;
      const S = V.strike(actor, null, { kind: spec.kind, heavy: spec.heavy, arm: spec.arm || undefined, weapon: o.weapon || null,
        candidates: o.candidates, maxLunge: spec.lunge != null ? 0.45 + 0.3 * spec.lunge : 0.45,
        onLand: driveLand(o), onBlocked: o.onBlocked || null });
      return S ? spec : null;
    };
    if (press && !st.down) {
      st.down = true; st.at = st.t;
      st.n = st.t - st.lastT < 1.0 ? st.n + 1 : 1; st.lastT = st.t;
      const c = fill("tap");
      threw = go(M.pick(c), c);
    } else if (press && st.down) {
      if (st.t - st.at >= HOLD_GUARD && !V.strikeOf(actor)) { st.guard = true; V.block(actor, 0.14); }
    } else if (!press && st.down) {
      st.down = false; st.guard = false;
      const held = st.t - st.at;
      if (held >= HOLD_POWER && held <= POWER_MAX) { st.n = 0; const c = fill("power"); threw = go(M.pick(c), c); }
    }
    const ch = B.ch;
    if (ch) ch.fightStance = true;
    return threw;
  };
  M.driveGuarding = function (actor) { return !!(actor && actor._mDrv && actor._mDrv.guard); };
  function driveLand(o) {
    if (o._mDL) return o._mDL;
    o._mDL = function (res) {
      // the hit is FELT: the thud and the lens kick, every landed blow
      if (CBZ.sfx) { try { CBZ.sfx(res.weapon && res.weapon.blade ? "hit" : "punch"); } catch (e) { /* no audio */ } }
      if (CBZ.shake) CBZ.shake(res.blocked ? 0.12 : 0.16 + 0.42 * Math.min(1, res.force || res.power || 0.5));
      if (typeof V.hitstop === "function") V.hitstop(res.attacker, res.target, res.blocked ? 0.035 : 0.05 + 0.06 * Math.min(1, res.force || 0.5), true);
      if (o.onLand) o.onLand(res);
    };
    return o._mDL;
  }
  const _cand = [];
  const _front = { a: null, d: 99, down: false };
  function frontOf(actor, B, candidates) {
    _front.a = null; _front.d = 99; _front.down = false;
    if (!candidates) return null;
    _cand.length = 0;
    try { candidates(_cand); } catch (e) { _cand.length = 0; }
    const yaw = B.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw), p = B.pos;
    let bs = 1e9;
    for (let i = 0; i < _cand.length; i++) {
      const q = _cand[i];
      if (!q || q === actor) continue;
      const Bq = bod(q);
      if (!Bq || !Bq.pos || Bq.dead()) continue;
      const dx = Bq.pos.x - p.x, dz = Bq.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > 3.6 || d < 0.05) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.5) continue;
      const s = d - dot;
      if (s < bs) { bs = s; _front.a = q; _front.d = d; _front.down = Bq.down(); }
    }
    _cand.length = 0;
    return _front.a ? _front : null;
  }
  M.frontOf = function (actor, candidates) { const B = bod(actor); return B && B.pos ? frontOf(actor, B, candidates) : null; };
})();
