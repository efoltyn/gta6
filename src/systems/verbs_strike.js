/* ============================================================
   systems/verbs_strike.js — CBZ.verbs.strike and friends: HOW a blow lands.

   Before this there were eight melee resolvers, each with its own reach and
   cone numbers (3.1/0.25, 2.85/0.34, 1.89/0.3, 1.85, 2.5/0.5...), a hit
   decided at click time or on a timer, no hit location, nothing that knew a
   wall was between two men, and a knockdown that was a group toppled into the
   floor. This is the one place a person hits a person:

     · A blow is a SWING on the attacker's rig (entities/meleeposes.js poses
       it from the ground up). It lands on the frame the attacker's actual fist
       (hand socket), elbow, forehead, foot, shin or knee reaches a ZONE of the
       target's live rig — jaw, head, liver, belly/chest, thighs — measured
       after both rigs are posed (the pass runs at order 86, after every
       animChar caller: player 10, npcs 22, bots 23, peds 34-35.4, police
       35/40, arena 55). A man who stepped out of range is a whiff. Nothing
       lands through a wall (CBZ.segmentHitsCollider / clearLineOfFire).
     · The aim is the target zone's point, tracked through the wind-up and
       COMMITTED at the start of the drive: a slip after that moves the head
       off the line and the fist goes past it.
     · Range is the rig's own: straights and hooks land to ~1.3 m centre to
       centre for two adults, an uppercut only inside ~0.8 m, a knee in the
       clinch. A strike thrown from further out takes a real STEP IN first
       (a lunge; footwork on ch.footStep, the root moves on the same curve).
     · WHERE it lands decides what it does (res below): the jaw is where
       knockouts live, the head snaps along the punch line, a body shot folds
       him, the liver drops him to a knee a beat later, a leg kick buckles.
       A high guard stops head shots from the front (the forearms take it and
       give; the attacker's arm bounces back); body shots go under it.
     · The caller's onLand(res) applies HP and the game's consequences and may
       overrule the reaction (res.reaction = "dead" | "knockdown" | "none" | ...,
       res.blood = amount for a split). Then the reaction plays, both rigs
       freeze together for the hitstop, and the player's lens shakes only if
       the player is in it.

   API (CBZ.verbs.*):
     strike(att, tgt|null, opts) -> St | null
       opts.kind  "jab" "cross" "hook" "upper" "body" "bodyStraight" "overhand"
                  "elbow" "headbutt" "stab" "knee" "kick" "roundKick" "lowKick"
                  "shove" (→ verbs.shove when CORE's session exists)
       opts.arm "l"|"r", opts.power 0..1, opts.heavy, opts.weapon {kind, mass, blade}
       opts.candidates(out) — who the swing may hit when tgt is null
       opts.onLand(res), opts.onWhiff(res), opts.onBlocked(res)
       opts.onBeat(St) — resolve it yourself on the blow's impact beat instead of
                  by contact (an animal, a remote player, a man on the ground)
       opts.lunge (default true), opts.maxLunge (m), opts.snap (face blend),
       opts.rng () => 0..1
       res = { landed, blocked, slipped, zone, dmgMul, reaction, point, dir:{x,z},
               power, kind, target, attacker, heavy, weapon, stagger, blood }
       (res is reused per strike: read it inside the callback)
     kick(att, tgt, opts) — strike with the leg ("kick" | "roundKick" | "lowKick" | "knee")
     guard(a, on) · block(a, dur) · slip(a, dir, kind) · react(t, o)
     knockdown(t, {dir, dur, ko, variant, side, noKo}) · getUp(t) · hitstop(att, tgt, secs)
     shot(t, {point, dir, fromX, fromZ, cal, wkey, dist, share, head, power}) -> bool
                — a round that hit a LIVING man (see SHOT below); false = no
                  rig to react with, the caller falls back to CBZ.body.hit
     step(a, dx, dz, dist) — a footwork step with root motion
     fighter(a, opts) -> F:  F.tick(dt, target, opts) -> action|null, F.telegraph()
     strikeOf(a) · cancelStrike(a) · reachOf(kind, a)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const V = CBZ.verbs = CBZ.verbs || {};
  const MPf = () => CBZ.meleePoses || null;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const TAU = Math.PI * 2;
  function lerpAngle(a, b, t) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return a + d * t; }

  /* ---- the actor adapter: CORE's (systems/verbs.js) when it is loaded, a
     small private one otherwise (studio pages, headless checks). ---- */
  function isPlayer(a) {
    if (typeof V.isPlayer === "function") return V.isPlayer(a);
    return !!a && (a.isPlayer === true || a === CBZ.player);
  }
  function bod(a) {
    if (!a) return null;
    if (typeof V.body === "function") { const B = V.body(a); if (B) return B; }
    let B = a._vbS;
    if (B) return B;
    B = a._vbS = {
      a,
      get isPlayer() { return isPlayer(a); },
      get ch() { return isPlayer(a) ? (CBZ.playerChar || null) : ((a.char && a.char.parts) ? a.char : (a.ch && a.ch.parts) ? a.ch : null); },
      get pos() { return isPlayer(a) ? CBZ.player.pos : (a.pos || (a.group && a.group.position) || null); },
      yaw() { const ch = this.ch; return ch && ch.group ? ch.group.rotation.y : (a.group ? a.group.rotation.y : 0); },
      face(y, k) { const ch = this.ch; if (ch && ch.group) ch.group.rotation.y = k >= 1 ? y : lerpAngle(ch.group.rotation.y, y, k); },
      dead() { return isPlayer(a) ? !!(CBZ.player && CBZ.player.dead) : !!a.dead; },
      down() {
        const o = isPlayer(a) ? CBZ.player : a, p = o && o._phys;
        if (p && (p.down > 0 || p.air)) return true;
        if (!isPlayer(a) && a.ko > 0) return true;
        const ch = this.ch;
        return !!(ch && (ch.koPose || (ch.fall && ch.fall.on && ch.fall.phase !== "getup")));
      },
    };
    return B;
  }
  function scaleOf(ch) { const hs = ch && ch.group && ch.group.userData && ch.group.userData.humanScale; return hs > 0 ? hs : 0.7; }
  function moveBy(B, dx, dz) {
    const p = B.pos;
    if (!p || (!dx && !dz)) return;
    p.x += dx; p.z += dz;
    const ch = B.ch;
    if (ch && ch.group && ch.group.position !== p) { ch.group.position.x += dx; ch.group.position.z += dz; }
    const g = B.a && B.a.group;
    if (g && g.position !== p && (!ch || g !== ch.group)) { g.position.x += dx; g.position.z += dz; }
    if (CBZ.collide) {
      const bx = p.x, bz = p.z;
      CBZ.collide(p, B.isPlayer ? ((CBZ.player && CBZ.player.radius) || 0.45) : 0.42);
      const cx = p.x - bx, cz = p.z - bz;
      if ((cx || cz) && ch && ch.group && ch.group.position !== p) { ch.group.position.x += cx; ch.group.position.z += cz; }
    }
  }

  /* ---- the blow table: natural reach (m, centre to centre, two adults with
     no step), power, and the stagger step a clean one forces ---- */
  const REACH = {
    jab: 1.28, cross: 1.30, hook: 1.30, upper: 0.80, body: 1.32, bodyStraight: 1.12, overhand: 1.42,
    elbow: 0.92, headbutt: 0.74, stab: 0.95, shove: 1.10, front: 0.95, round: 0.90, low: 0.95, knee: 0.62,
    gnp: 1.0, gnpElbow: 0.9, hammer: 1.0,
  };
  const POWER = {
    jab: 0.35, cross: 0.75, hook: 0.82, upper: 0.82, body: 0.70, bodyStraight: 0.62, overhand: 0.92,
    elbow: 0.80, headbutt: 0.85, stab: 0.55, shove: 0.55, front: 0.72, round: 0.95, low: 0.62, knee: 0.88,
    gnp: 0.62, gnpElbow: 0.86, hammer: 0.72,
  };
  const ZONE_MUL = { jaw: 1.3, head: 1.0, liver: 1.25, body: 0.8, legs: 0.6 };
  const FIST_R = 0.05;                      // m: the striking surface (knuckles, elbow point, shin)
  function kindOf(kind) {
    if (kind === "kick") return "front";
    if (kind === "roundKick") return "round";
    if (kind === "lowKick") return "low";
    if (kind === "uppercut") return "upper";
    if (!kind || kind === "straight") return "cross";
    return kind;
  }
  function isKick(k) { return k === "front" || k === "round" || k === "low" || k === "knee"; }
  V.reachOf = function (kind, a) {
    const k = kindOf(kind), B = a ? bod(a) : null;
    const s = B && B.ch ? scaleOf(B.ch) / 0.7 : 1;
    return (REACH[k] || 1.2) * s;
  };

  // ---- the pool ----
  const MAX = 48;
  const pool = [];
  const live = [];
  let serial = 0;
  function newRes() {
    return { landed: false, blocked: false, slipped: false, zone: null, dmgMul: 1, reaction: "none",
      point: new THREE.Vector3(), dir: { x: 0, z: 1 }, power: 0.5, kind: "jab", target: null, attacker: null,
      heavy: false, weapon: null, stagger: false, blood: 0, strike: null };
  }
  function getSt() {
    let S = pool.pop();
    if (!S) S = { on: false, res: newRes(), aim: new THREE.Vector3(), lunge: { D: 0, dx: 0, dz: 0, last: 0 } };
    return S;
  }
  function strikeOf(a) {
    for (let i = 0; i < live.length; i++) if (live[i].att === a && live[i].on) return live[i];
    return null;
  }
  V.strikeOf = strikeOf;

  const CAND = [];
  const EMPTY = {};
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _sh = new THREE.Vector3();

  /* ---- ZONES of a rig, refreshed at most once per frame ---- */
  let frameN = 0;
  function zonesOf(ch) {
    const MP = MPf();
    let Z = ch._vzS;
    if (!Z) Z = ch._vzS = MP.newZones();
    if (Z._f !== frameN) { MP.zones(ch, Z); Z._f = frameN; }
    return Z;
  }
  function segDist2(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz;
    let t = l2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
    return dx * dx + dy * dy + dz * dz;
  }
  // the aim point for a blow at this zone: the zone's surface facing the attacker
  function aimPoint(Z, level, kind, arm, from, out) {
    let c, r;
    if (level === "ground") {
      // his face where it lies: the skull's centre, lifted to its upper surface
      out.copy(Z.head.c); out.y += Z.head.r * 0.55;
      const dx = from.x - out.x, dz = from.z - out.z, d = Math.hypot(dx, dz) || 1;
      out.x += (dx / d) * Z.head.r * 0.25; out.z += (dz / d) * Z.head.r * 0.25;
      return out;
    }
    if (level === "legs") { out.copy(Z.lA).lerp(Z.lB, 0.55); r = Z.legR; c = out; }
    else if (level === "body") {
      if (kind === "body" || kind === "round") { c = Z.liver.c; r = Z.liver.r; }
      else { c = Z.belly.c; r = Z.belly.r; }
    } else { c = Z.jaw.c; r = Z.jaw.r; }
    if (c !== out) out.copy(c);
    const dx = from.x - out.x, dz = from.z - out.z, d = Math.hypot(dx, dz) || 1;
    out.x += (dx / d) * r * 0.55; out.z += (dz / d) * r * 0.55;   // just inside the surface
    return out;
  }
  // which zone does a strike point at P touch? (r = striking-surface radius)
  function hitZone(Z, P, r, lowOnly) {
    const jr = Z.jaw.r + r, hr = Z.head.r + r, lr = Z.liver.r + r, br = Z.belly.r + r, cr = Z.chestR + r, gr = Z.legR + r;
    if (lowOnly) {
      // a low kick is aimed at the thigh: the thighs first
      if (segDist2(P, Z.lA, Z.lB) <= gr * gr) { _legSide = "L"; return "legs"; }
      if (segDist2(P, Z.rA, Z.rB) <= gr * gr) { _legSide = "R"; return "legs"; }
    } else {
      const dj = P.distanceToSquared(Z.jaw.c);
      if (dj <= jr * jr) return "jaw";
      // the chin is the low front of the skull: a fist that meets the head
      // there has found the jaw
      if (P.distanceToSquared(Z.head.c) <= hr * hr) return dj <= 2.1 * jr * jr ? "jaw" : "head";
    }
    if (P.distanceToSquared(Z.liver.c) <= lr * lr) return "liver";
    if (P.distanceToSquared(Z.belly.c) <= br * br) return "body";
    if (segDist2(P, Z.cA, Z.cB) <= cr * cr || segDist2(P, Z.dA, Z.dB) <= cr * cr) return "body";
    if (segDist2(P, Z.lA, Z.lB) <= gr * gr) { _legSide = "L"; return "legs"; }
    if (segDist2(P, Z.rA, Z.rB) <= gr * gr) { _legSide = "R"; return "legs"; }
    return null;
  }
  let _legSide = "L";
  function forearmTouch(Z, P, r) {
    const ar = Z.armR + r;
    return segDist2(P, Z.fL, Z.wL) <= ar * ar || segDist2(P, Z.fR, Z.wR) <= ar * ar;
  }
  // is there a wall between the attacker's chest and the contact point?
  // physics.js's one collider ray, chest -> contact as a 3-D segment: a box's
  // y0/y1 band is honoured (the old XZ slab test read `c.minY/maxY`, fields no
  // collider has, so a knee-high table between two men stopped a punch), and
  // an oriented wall is its real body, not its bounding box. A box the
  // attacker's chest is already inside still counts as in the way.
  const _wHit = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  const _wOpts = { any: true, inside: true };
  function walled(ax, ay, az, bx, by, bz) {
    if (CBZ.rayColliders) {
      try { if (CBZ.rayColliders(ax, ay, az, bx - ax, by - ay, bz - az, 1, _wHit, _wOpts)) return true; } catch (e) { /* no grid on this page */ }
    }
    if (CBZ.clearLineOfFire && CBZ.game && CBZ.game.mode === "city") {
      try { if (!CBZ.clearLineOfFire(ax, ay, az, bx, by, bz)) return true; } catch (e) { /* los not built */ }
    }
    return false;
  }

  /* ============================================================
     STRIKE
     ============================================================ */
  V.strike = function (att, tgt, opts) {
    opts = opts || EMPTY;
    const MP = MPf();
    let kind = kindOf(opts.kind || "jab");
    if (kind === "shove" && typeof V.shove === "function" && tgt) return V.shove(att, tgt, opts);
    const Ba = bod(att);
    if (!Ba || !MP || Ba.dead() || Ba.down()) return null;
    const ch = Ba.ch;
    // one blow at a time: the next in a combination starts once the last is past its impact
    const prev = strikeOf(att);
    if (prev) {
      if (prev.p < 0.46 && !prev.landed) return null;
      finish(prev, true);
    }
    if (live.length >= MAX) return null;
    const kick = isKick(kind);
    const S = getSt();
    S.on = true; S.id = ++serial;
    S.att = att; S.tgt = tgt || null; S.Ba = Ba; S.kind = kind; S.kick = kick;
    S.heavy = !!opts.heavy; S.weapon = opts.weapon || null; S.opts = opts;
    S.level = MP.levelOf(kind);
    S.arm = opts.arm || (ch ? (kick ? MP.legFor(ch, kind) : MP.armFor(ch, kind)) : "r");
    const gas = ch ? clamp01(ch.winded || 0) : 0;
    S.dur = MP.durOf(kind, S.heavy) * (1 + 0.25 * gas) * (opts.speed ? 1 / opts.speed : 1);
    S.power = clamp01((opts.power != null ? opts.power : (POWER[kind] || 0.6) + (S.heavy ? 0.18 : 0)) * (1 - 0.35 * gas));
    S.t = 0; S.p = 0; S.landed = false; S.whiffed = false; S.aimLocked = false; S.hasAim = false; S.beat = false;
    S.lastPT = -1; S.stall = 0; S.walled = false;
    S.lunge.D = 0; S.lunge.last = 0;
    S.rng = opts.rng || Math.random;
    const res = S.res;
    res.landed = false; res.blocked = false; res.slipped = false; res.zone = null; res.dmgMul = 1;
    res.reaction = "none"; res.stagger = false; res.blood = 0; res.kind = kind; res.heavy = S.heavy;
    res.weapon = S.weapon; res.attacker = att; res.target = null; res.power = S.power; res.strike = S;
    // the player swings at whoever is in front: pick the aim among the candidates
    if (!S.tgt && opts.candidates) S.aimT = pickAim(S, opts); else S.aimT = S.tgt;
    // ---- the swing on the rig ----
    if (ch) {
      ch._mSwingN = (ch._mSwingN || 0) + 1;
      if (kick) {
        ch.kickKind = MP.kickKey(kind); ch.kickLeg = S.arm; ch.kickDur = S.dur; ch.kickT = S.dur;
        ch.kickLandP = -1; ch.kickAim = null;
      } else {
        ch.punchKind = kind; ch.punchArm = S.arm; ch.punchDur = S.dur; ch.punchT = S.dur;
        ch.punchLandP = -1; ch.punchAim = null; ch.punchLevel = S.level;
      }
      if (typeof ch.setHandPose === "function" && !kick) ch.setHandPose(kind === "shove" ? "both" : S.arm, kind === "shove" ? "open" : "fist");
    }
    // ---- square up, and step in if he is out of reach ----
    const T = S.aimT;
    if (T) {
      const Bt = bod(T), tp = Bt && Bt.pos, ap = Ba.pos;
      if (tp && ap) {
        const dx = tp.x - ap.x, dz = tp.z - ap.z, d = Math.hypot(dx, dz) || 1e-4;
        Ba.face(Math.atan2(dx, dz), opts.snap != null ? opts.snap : 0.85);
        if (opts.lunge !== false && ch) {
          // follow a man you have backed up: the rest of his stagger step counts
          let pend = 0;
          for (let i = 0; i < moves.length; i++) {
            const m = moves[i];
            if (m.a === T) pend += m.D * (1 - m.last) * ((m.dx * dx + m.dz * dz) / d);
          }
          // the reach table is measured against a man in his stance, chin
          // out over the lead foot; one standing square carries his head a
          // hand further back, and the step has to cover that too
          let chin = 0;
          const tch0 = Bt.ch;
          if (tch0 && tch0.parts && S.level !== "legs") {
            const Z = zonesOf(tch0);
            const fwd = -((Z.jaw.c.x - tp.x) * dx + (Z.jaw.c.z - tp.z) * dz) / d;
            chin = Math.max(0, 0.20 * (scaleOf(tch0) / 0.7) - fwd);
          }
          const need = d + Math.max(0, pend) + chin - V.reachOf(kind, att) * 0.92;
          const maxL = opts.maxLunge != null ? opts.maxLunge : (Ba.isPlayer ? 0.75 : 0.45);
          const D = Math.max(0, Math.min(maxL, need));
          if (D > 0.03 && !walled(ap.x, (ap.y || 0) + 1.2, ap.z, tp.x, (tp.y || 0) + 1.2, tp.z)) {
            S.lunge.D = D; S.lunge.dx = dx / d; S.lunge.dz = dz / d; S.lunge.last = 0;
            const lead = MP.leadSide(ch) === "l" ? "L" : "R";
            // the lead foot goes first; the root arrives by the impact beat
            MP.startStep(ch, 0, D / scaleOf(ch), S.dur * (kick ? 0.5 : 0.62), lead);
          }
        }
      }
    }
    live.push(S);
    return S;
  };
  // a kick is a strike with the leg: opts.kind "kick" (front) | "roundKick" | "lowKick" | "knee"
  V.kick = function (att, tgt, opts) {
    const o = opts || EMPTY;
    const k = o.kind === "roundKick" || o.kind === "round" ? "roundKick" : o.kind === "lowKick" || o.kind === "low" ? "lowKick" : o.kind === "knee" ? "knee" : "kick";
    if (o.kind === k) return V.strike(att, tgt, o);
    const c = Object.assign({}, o); c.kind = k;
    return V.strike(att, tgt, c);
  };
  function pickAim(S, opts) {
    CAND.length = 0;
    try { opts.candidates(CAND); } catch (e) { CAND.length = 0; }
    const Ba = S.Ba, ap = Ba.pos, yaw = Ba.yaw();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const range = V.reachOf(S.kind, S.att) + (opts.maxLunge != null ? opts.maxLunge : 0.75) + 0.15;
    let best = null, bs = 1e9;
    for (let i = 0; i < CAND.length; i++) {
      const c = CAND[i];
      if (!c || c === S.att) continue;
      const B = bod(c);
      if (!B || !B.pos || B.dead() || B.down()) continue;
      const dx = B.pos.x - ap.x, dz = B.pos.z - ap.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.05) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < 0.45) continue;
      const score = d - dot * 0.8;
      if (score < bs) { bs = score; best = c; }
    }
    return best;
  }

  function finish(S, quiet) {
    if (!S.on) return;
    S.on = false;
    const ch = S.Ba && S.Ba.ch;
    if (ch) { if (S.kick) ch.kickAim = null; else ch.punchAim = null; }
    const i = live.indexOf(S);
    if (i >= 0) live.splice(i, 1);
    S.att = S.tgt = S.aimT = S.Ba = S.opts = null;
    S.res.target = S.res.attacker = null;
    if (pool.length < MAX) pool.push(S);
    void quiet;
  }
  V.cancelStrike = function (a) {
    const S = strikeOf(a);
    const B = bod(a), ch = B && B.ch;
    if (ch) { ch.punchT = 0; ch.kickT = 0; }
    if (S) finish(S, true);
  };

  /* ---- the resolution: contact → result → callbacks → reaction ---- */
  function resolveOn(S, c, zone, P, blocked) {
    const res = S.res, Ba = S.Ba, Bt = bod(c), MP = MPf();
    const ap = Ba.pos, tp = Bt.pos;
    let dx = tp.x - ap.x, dz = tp.z - ap.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    res.landed = !blocked; res.blocked = !!blocked; res.zone = zone; res.target = c;
    res.point.copy(P); res.dir.x = dx; res.dir.z = dz;
    res.dmgMul = (ZONE_MUL[zone] || 1) * (blocked ? 0.2 : 1);
    res.stagger = !blocked && S.power >= 0.72 && zone !== "legs";
    if (blocked) res.reaction = "block";
    else if (S.kind === "shove") res.reaction = "stagger";
    else if (zone === "jaw" || zone === "head") res.reaction = "snap";
    else if (zone === "liver") res.reaction = "liver";
    else if (zone === "body") res.reaction = "fold";
    else res.reaction = "buckle";
    // the flash knockdown lives on the jaw: a clean power shot there
    if (!blocked && zone === "jaw" && S.power >= 0.8 && S.rng() < 0.22 * S.power) res.reaction = "knockdown";
    S.landed = true;
    // the attacker's rig stops ON him (or bounces off the guard)
    const ch = Ba.ch;
    if (ch) {
      if (S.kick) { ch.kickLandP = S.p; ch._mKLandE = Math.sin(clamp01((S.p - 0.22) / 0.5) * Math.PI); }
      else {
        ch.punchLandP = S.p; ch._mLandD = MP.drive(S.p);
        if (blocked) ch.punchT = Math.min(ch.punchT, ch.punchDur * (1 - MP.BEAT.recover));
      }
    }
    const o = S.opts;
    if (blocked) { if (o.onBlocked) o.onBlocked(res); else if (o.onLand) o.onLand(res); }
    else if (o.onLand) o.onLand(res);
    applyReaction(S, c, Bt);
  }
  function applyReaction(S, c, Bt) {
    if (!S.Ba || !Bt) return;   // the strike was torn down in onLand (attacker gone mid-swing)
    const res = S.res, tch = Bt.ch;
    const bothP = S.Ba.isPlayer || Bt.isPlayer;
    const stop = res.blocked ? 0.035 : 0.045 + 0.065 * res.power;
    V.hitstop(S.att, c, stop, bothP);
    if (bothP && CBZ.shake) CBZ.shake(res.blocked ? 0.15 : 0.16 + 0.42 * res.power);
    if (S.Ba.isPlayer && CBZ.fpsPunchLanded) CBZ.fpsPunchLanded(S.kind, S.heavy || res.power > 0.8);
    const r = res.reaction;
    // the heavier man puts more of himself through the other
    const mass = massRatio(S.att, c);
    if (r === "dead" || r === "none") { /* the caller owns it */ }
    else if (r === "block") {
      if (tch) { tch.blockT = Math.max(tch.blockT || 0, 0.3); tch.blockHitT = 0.2; }
      // the forearms took it, the feet pay for it: a short step back along the blow
      if (Bt.pos && !Bt.isPlayer) stepAlong(c, Bt, tch, res.dir.x, res.dir.z, (0.05 + 0.13 * res.power) * mass, 0.26);
    } else if (r === "knockdown") {
      V.knockdown(c, { dir: res.dir, ko: true, power: res.power });
    } else {
      V.react(c, { zone: res.zone, kind: S.kind, arm: S.arm, dir: res.dir, power: res.power, stagger: res.stagger || r === "stagger", reaction: r, legSide: _legSide, mass: mass, heavy: S.heavy });
    }
    if (!res.blocked) {
      // the ledger (island modes) and the blade
      if (CBZ.trauma && CBZ.trauma.strike) {
        try {
          CBZ.trauma.strike(c, 3 + 7 * res.power, { dir: { x: res.dir.x, y: 0.3, z: res.dir.z }, fromX: S.Ba.pos.x, fromZ: S.Ba.pos.z,
            y: res.point.y - ((Bt.pos && Bt.pos.y) || 0), flesh: S.kind === "shove" ? 0.2 : 1 });
        } catch (e) { /* trauma off in this mode */ }
      }
      if (S.weapon && S.weapon.blade && CBZ.bodyWound) {
        // at the point the blade went in (no fromX: that bias drags a real
        // contact point 45 cm toward the attacker and scatters it)
        try { CBZ.bodyWound(c, res.point, { melee: "blade", cal: 0.7, dir: { x: res.dir.x, y: 0, z: res.dir.z } }); } catch (e) { /* wounds off */ }
      }
      // a blade that lands CUTS, and a cut bleeds into the air (gore.js: heavy
      // drops + a short stream); a fist bleeds only when combat says it split
      const cut = !!(S.weapon && S.weapon.blade);
      if ((res.blood > 0 || cut) && CBZ.goreImpact) {
        CBZ.goreImpact(res.point.x, res.point.y, res.point.z, { amount: res.blood || 0.8, blade: cut, dir: { x: res.dir.x, y: 0.35, z: res.dir.z } });
      }
      // you beat him to the punch: whatever he was throwing is gone
      const his = strikeOf(c);
      if (his) finish(his, true);
      if (tch && (r !== "block")) { tch.punchT = 0; tch.kickT = 0; }
    }
  }
  function whiff(S) {
    if (S.whiffed || S.landed) return;
    S.whiffed = true;
    const res = S.res;
    res.landed = false; res.blocked = false; res.zone = null; res.reaction = "none";
    const T = S.aimT;
    const Bt = T ? bod(T) : null;
    res.target = T || null;
    res.slipped = !!(Bt && Bt.ch && Bt.ch.dodgeT > 0);
    if (S.opts.onWhiff) S.opts.onWhiff(res);
  }

  /* ============================================================
     THE PASS (order 86): after every rig is posed, before reactions (89),
     grapple's late write (90) and CORE's holds (91).
     ============================================================ */
  const moves = [];     // root motion riding a rig's footStep: { a, B, ch, D, dx, dz, last, on }
  let clock = 0;        // this pass's own seconds (the shot load bleeds on it)
  const falls = [];     // fallen actors whose ko timer the rig's get-up follows
  function update(dt) {
    frameN++;
    clock += dt;
    const MP = MPf();
    if (!MP) return;
    for (let i = 0; i < shotQ.length; i++) resolveShot(shotQ[i], MP);
    shotQ.length = 0;
    stepReels();
    stepMounts(dt);
    for (let i = live.length - 1; i >= 0; i--) {
      const S = live[i];
      if (!S.on) { live.splice(i, 1); continue; }
      stepStrike(S, dt, MP);
    }
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      const fs = m.ch && m.ch.footStep;
      if (!fs || m.fs !== fs.gen) { moves.splice(i, 1); continue; }
      const sr = MP.stepRoot(m.ch), dd = sr - m.last;
      m.last = sr;
      if (dd > 0) moveBy(m.B, m.dx * m.D * dd, m.dz * m.D * dd);
      if (!fs.on) moves.splice(i, 1);
    }
    for (let i = falls.length - 1; i >= 0; i--) {
      const F = falls[i], ch = F.B.ch, f = ch && ch.fall;
      if (!f || !f.on || F.a.dead) {
        // he is back on his feet: a ko timer only this pass was counting ends
        // with the get-up (left over, it kept him "down" for good: B.down()
        // true, never hit again, his fighter never ticking)
        if (F.counted && !F.a.dead && F.a.ko > 0 && F.a.ko === F.lastKo) F.a.ko = 0;
        falls.splice(i, 1); continue;
      }
      if (F.B.isPlayer || F.noKo) continue;
      // the brain is off while he is down (a.ko); the rig stands up in time
      // for it to come back on. A body whose ko nobody counts down (a mode
      // without a ko brain) gets it counted here.
      let ko = F.a.ko || 0;
      if (ko > 0 && ko === F.lastKo) { ko = Math.max(0, ko - dt); F.a.ko = ko; F.counted = true; }
      F.lastKo = ko;
      if (f.phase === "fall" || f.phase === "down") f.hold = ko > F.gt + 0.05;
      if (f.phase === "down" && !f.hold) MP.getUp(ch);
    }
  }
  V.strikeUpdate = update;
  function stepStrike(S, dt, MP) {
    const Ba = S.Ba, ch = Ba && Ba.ch;
    S.t += dt;
    if (!Ba || Ba.dead() || Ba.down()) { finish(S, true); return; }
    // the rig's own clock (hitstop stops it); a rig nobody animates is
    // clocked here and resolved by distance at the beat
    let clockT;
    if (ch) {
      const kindOk = S.kick ? ch.kickT > -1 : ch.punchKind === S.kind;
      clockT = S.kick ? ch.kickT : ch.punchT;
      if (!kindOk) { whiff(S); finish(S); return; }
      if (clockT === S.lastPT && !(ch.freezeT > 0)) {
        S.stall += dt;
        if (S.stall > 0.06) { clockT -= dt; if (S.kick) ch.kickT = clockT; else ch.punchT = clockT; }
      } else S.stall = 0;
      S.lastPT = clockT;
    } else clockT = S.dur - S.t;
    const p = clamp01(1 - Math.max(0, clockT) / S.dur);
    S.p = p;
    // ---- the step in ----
    if (S.lunge.D > 0 && ch && ch.footStep) {
      const sr = MP.stepRoot(ch), dd = sr - S.lunge.last;
      S.lunge.last = sr;
      if (dd > 0) moveBy(Ba, S.lunge.dx * S.lunge.D * dd, S.lunge.dz * S.lunge.D * dd);
    }
    // ---- the aim: tracked through the wind-up, committed on the drive ----
    const T = S.aimT;
    if (T && ch && !S.landed) {
      const Bt = bod(T), tch = Bt && Bt.ch;
      if (tch && !Bt.dead()) {
        if (!S.aimLocked) {
          const Z = zonesOf(tch);
          aimPoint(Z, S.level, S.kind, S.arm, Ba.pos, S.aim);
          S.hasAim = true;
          // a punch commits when it launches: whatever the head does after this, the fist goes where it was
          if (p >= (S.kick ? 0.20 : 0.12)) S.aimLocked = true;
        }
        if (S.kick) ch.kickAim = S.kind === "knee" ? null : S.aim; else ch.punchAim = S.aim;
      }
    }
    // ---- contact ----
    const pLo = S.kick ? 0.24 : 0.18, pHi = S.kick ? 0.74 : 0.66;
    const beatP = S.kick ? MP.kickImpactP : MP.BEAT.impact;
    if (S.opts.onBeat) {
      // the caller resolves this one on the blow's beat (a body with no human
      // rig to meet — an animal, a remote player — or a man on the ground)
      if (!S.beat && p >= beatP) { S.beat = true; S.landed = true; S.opts.onBeat(S); }
    } else if (!S.landed && !S.whiffed && p >= pLo && p <= pHi) {
      if (ch) contact(S, ch, MP);
      else if (p >= beatP) virtualContact(S);
    }
    if (!S.landed && !S.whiffed && p > pHi) whiff(S);
    if (clockT <= 0 || p >= 1) finish(S);
  }
  function testTarget(S, c, P, r) {
    if (!c || c === S.att) return null;
    const B = bod(c);
    if (!B || !B.ch || !B.pos || B.dead() || B.down()) return null;
    const dx = P.x - B.pos.x, dz = P.z - B.pos.z;
    if (dx * dx + dz * dz > 1.44) return null;
    const Z = zonesOf(B.ch);
    // a raised guard takes it on the forearms
    const tch = B.ch;
    const guarding = (tch.blockK || 0) > 0.55;
    if (guarding && forearmTouch(Z, P, r)) return "block";
    const zone = hitZone(Z, P, r, S.level === "legs");
    // a head moving off the line that the fist only finds at the rim of the
    // skull: it slides off — that is what a slip is
    if (zone === "head" && tch.dodgeT > 0) {
      const lim = 0.78 * (Z.head.r + r);
      if (P.distanceToSquared(Z.head.c) > lim * lim) return null;
    }
    return zone;
  }
  function contact(S, ch, MP) {
    MP.strikePoint(ch, S.kind, S.arm, _v);
    const r = FIST_R * (scaleOf(ch) / 0.7) * (S.kick ? 1.3 : 1);
    let hit = null, zone = null;
    if (S.tgt) { zone = testTarget(S, S.tgt, _v, r); if (zone) hit = S.tgt; }
    else if (S.opts.candidates) {
      if (!CAND.length) { try { S.opts.candidates(CAND); } catch (e) { CAND.length = 0; } }
      // the aimed man first, then anybody else the swing passes through
      if (S.aimT) { zone = testTarget(S, S.aimT, _v, r); if (zone) hit = S.aimT; }
      for (let i = 0; !hit && i < CAND.length; i++) { zone = testTarget(S, CAND[i], _v, r); if (zone) hit = CAND[i]; }
      CAND.length = 0;
    }
    if (!hit) return;
    // nothing lands through a wall
    const ap = S.Ba.pos;
    if (!S.walled && walled(ap.x, (ap.y || 0) + 1.15, ap.z, _v.x, _v.y, _v.z)) { S.walled = true; whiff(S); return; }
    let blocked = zone === "block";
    const Bt = bod(hit), tch = Bt.ch;
    if (blocked) zone = S.level === "body" ? "body" : "head";
    else if ((zone === "jaw" || zone === "head") && tch && (tch.blockK || 0) > 0.55) {
      // a high guard covers the head from the front even where the forearm test missed
      const yaw = Bt.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw);
      const ax = ap.x - Bt.pos.x, az = ap.z - Bt.pos.z, al = Math.hypot(ax, az) || 1;
      if ((ax * fx + az * fz) / al > 0.2) blocked = true;
    }
    resolveOn(S, hit, zone, _v, blocked);
  }
  // no rig posed (far, culled): the beat decides by distance, as the old timers did
  function virtualContact(S) {
    const T = S.aimT;
    if (!T) { whiff(S); return; }
    const Bt = bod(T);
    if (!Bt || !Bt.pos || Bt.dead() || Bt.down()) { whiff(S); return; }
    const ap = S.Ba.pos;
    const d = Math.hypot(Bt.pos.x - ap.x, Bt.pos.z - ap.z);
    if (d > V.reachOf(S.kind, S.att) + 0.1) { whiff(S); return; }
    _w.set(Bt.pos.x, (Bt.pos.y || 0) + (S.level === "body" ? 1.0 : S.level === "legs" ? 0.5 : 1.45), Bt.pos.z);
    resolveOn(S, T, S.level === "body" ? "body" : S.level === "legs" ? "legs" : "head", _w, false);
  }

  /* ============================================================
     GUARD / BLOCK / SLIP
     ============================================================ */
  V.guard = function (a, on) {
    const B = bod(a), ch = B && B.ch;
    if (!ch) return false;
    ch.fightStance = !!on;
    if (typeof ch.setHandPose === "function") ch.setHandPose("both", on ? "fist" : "relaxed");
    return true;
  };
  V.block = function (a, dur) {
    const B = bod(a), ch = B && B.ch;
    if (!ch || B.down()) return false;
    ch.blockT = Math.max(ch.blockT || 0, dur == null ? 0.5 : dur);
    return true;
  };
  V.slip = function (a, dir, kind) {
    const B = bod(a), ch = B && B.ch;
    if (!ch || B.down()) return false;
    const k = kind === "duck" || kind === "pull" ? kind : "slip";
    ch.dodgeKind = k;
    ch.dodgeDur = k === "duck" ? 0.42 : k === "pull" ? 0.34 : 0.36;
    ch.dodgeT = ch.dodgeDur;
    ch.dodgeDir = dir < 0 ? -1 : 1;
    return true;
  };
  // a footwork step: the feet move and the root follows on the same curve
  V.step = function (a, dx, dz, dist, dur) {
    const B = bod(a);
    if (!B || !B.pos || B.down()) return false;
    return stepAlong(a, B, B.ch, dx, dz, dist == null ? 0.35 : dist, dur || 0.34);
  };
  function stepAlong(a, B, ch, dx, dz, D, dur) {
    const MP = MPf();
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (!ch || !MP) { moveBy(B, dx * D, dz * D); return true; }
    const yaw = B.yaw(), c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;          // world → his frame
    const sc = scaleOf(ch);
    // the foot on the side of travel moves first
    const lead = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? "L" : "R") : (lz > 0 ? (MP.leadSide(ch) === "l" ? "L" : "R") : (MP.leadSide(ch) === "l" ? "R" : "L"));
    const fs = MP.startStep(ch, lx * D / sc, lz * D / sc, dur, lead);
    fs.gen = (fs.gen || 0) + 1;
    pushMove(a, B, ch, D, dx, dz, fs.gen);
    return true;
  }
  /* MASS: how much of the attacker goes through the target. bodymass.js
     knows what a body weighs; without it the rig scale cubed stands in. */
  function massOf(a) {
    if (CBZ.bodyMass) { try { const m = CBZ.bodyMass(a); if (m > 0) return m; } catch (e) { /* no profile */ } }
    const B = bod(a), s = B && B.ch ? scaleOf(B.ch) / 0.7 : 1;
    return 80 * s * s * s;
  }
  function massRatio(att, tgt) {
    const r = massOf(att) / massOf(tgt);
    return r < 0.5 ? 0.5 : r > 2 ? 2 : r;
  }
  /* REELING: steps still to take after a blow or a round (one footStep per
     step, the root on the same curve). A second hit ADDS steps to the ones
     he has not taken yet; it never cuts the reel short. */
  const reels = [];
  function reel(a, B, ch, dx, dz, n, D, dur) {
    if (!(n > 0) || !B || !B.pos) return;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    for (let i = 0; i < reels.length; i++) {
      const r = reels[i];
      if (r.a !== a) continue;
      r.n = Math.min(4, r.n + n);
      const bx = r.dx + dx, bz = r.dz + dz, bl = Math.hypot(bx, bz);
      if (bl > 1e-3) { r.dx = bx / bl; r.dz = bz / bl; }
      if (D > r.D) r.D = D;
      return;
    }
    reels.push({ a, B, ch, n: Math.min(4, n), dx, dz, D, dur });
  }
  function stepReels() {
    for (let i = reels.length - 1; i >= 0; i--) {
      const r = reels[i];
      if (r.B.dead() || r.B.down() || r.n <= 0) { reels.splice(i, 1); continue; }
      const fs = r.ch && r.ch.footStep;
      if (fs && fs.on) continue;                          // this step is not done
      stepAlong(r.a, r.B, r.ch, r.dx, r.dz, r.D, r.dur);
      r.n--;
    }
  }
  function dropReel(a) { for (let i = reels.length - 1; i >= 0; i--) if (reels[i].a === a) reels.splice(i, 1); }
  function pushMove(a, B, ch, D, dx, dz, gen) {
    for (let i = moves.length - 1; i >= 0; i--) if (moves[i].a === a) moves.splice(i, 1);
    moves.push({ a, B, ch, D, dx, dz, last: 0, fs: gen });
  }

  /* ============================================================
     REACTIONS
     ============================================================ */
  V.react = function (t, o) {
    o = o || EMPTY;
    const B = bod(t), ch = B && B.ch, MP = MPf();
    if (!ch || !MP || B.dead()) return false;
    const zone = o.zone || "head";
    if (zone === "liver" || o.reaction === "liver") return V.knockdown(t, { variant: "liver", dir: o.dir, ko: false, dur: 1.1 });
    const his = strikeOf(t);
    if (his) finish(his, true);
    ch.punchT = 0; ch.kickT = 0;
    const power = o.power == null ? 0.6 : o.power;
    let hr = ch.hitReact;
    if (!hr) hr = ch.hitReact = { on: false, kind: "snap", t: 0, dur: 0.5, lx: 0, lz: -1, side: "L", amt: 1, blow: "straight" };
    const dir = o.dir || null;
    const yaw = B.yaw(), c = Math.cos(yaw), s = Math.sin(yaw);
    const dx = dir ? dir.x : -Math.sin(yaw), dz = dir ? dir.z : -Math.cos(yaw);
    hr.lx = dx * c - dz * s; hr.lz = dx * s + dz * c;
    hr.t = 0; hr.on = true; hr.amt = 0.5 + 0.7 * power;
    const k = kindOf(o.kind);
    if (o.reaction === "stagger" && zone !== "head" && zone !== "jaw") { hr.kind = "stagger"; hr.dur = 0.7; }
    else if (zone === "jaw" || zone === "head") {
      hr.kind = "snap"; hr.dur = 0.55 + 0.25 * power;
      hr.blow = (k === "hook" || k === "elbow" || k === "round" || k === "overhand") ? "hook" : (k === "upper" || k === "knee" || k === "headbutt") ? "upper" : "straight";
      // a hook turns the head AWAY from the fist: a left hook arrives on his
      // right side and throws his head to his left (+x in his frame)
      if (hr.blow === "hook" && Math.abs(hr.lx) < 0.3) hr.lx = (o.arm === "r" || (!o.arm && k === "overhand")) ? -0.8 : 0.8;
    } else if (zone === "body") { hr.kind = "fold"; hr.dur = 0.8; }
    else if (zone === "legs") { hr.kind = "buckle"; hr.dur = 0.7; hr.side = o.legSide === "R" ? "R" : "L"; }
    else { hr.kind = "stagger"; hr.dur = 0.7; }
    hr.shot = false;
    // a real step to catch the weight: the foot on the side it is thrown to.
    // The heavier the man behind the blow, the further it carries; a heavy
    // shot that staggers him keeps him going for a second step.
    const mass = o.mass > 0 ? o.mass : 1;
    if (o.stagger && B.pos) {
      const D = (0.16 + 0.34 * power) * mass;
      const sc = scaleOf(ch);
      const lead = Math.abs(hr.lx) > Math.abs(hr.lz) ? (hr.lx > 0 ? "L" : "R") : (MP.leadSide(ch) === "l" ? "R" : "L");
      const fs = MP.startStep(ch, hr.lx * D / sc, hr.lz * D / sc, 0.38 + 0.12 * power, lead);
      fs.gen = (fs.gen || 0) + 1;
      pushMove(t, B, ch, D, dx, dz, fs.gen);
      if ((o.heavy || power >= 0.9) && !B.isPlayer) reel(t, B, ch, dx, dz, 1, D * 0.55, 0.32);
    } else if (B.pos && !B.isPlayer && power > 0.3 && !(ch.footStep && ch.footStep.on)) {
      // a clean one that does not stagger him still moves his weight: a short
      // give along the blow, the feet going with it
      stepAlong(t, B, ch, dx, dz, (0.03 + 0.10 * power) * mass, 0.24);
    }
    return true;
  };

  V.knockdown = function (t, o) {
    o = o || EMPTY;
    const B = bod(t), ch = B && B.ch, MP = MPf();
    if (!B || B.dead()) return false;
    const his = strikeOf(t);
    if (his) finish(his, true);
    if (!ch || !MP) { if (!B.isPlayer) t.ko = Math.max(t.ko || 0, o.dur || 2.5); return true; }
    const yaw = B.yaw(), c = Math.cos(yaw), s = Math.sin(yaw);
    const dir = o.dir || null;
    const dx = dir ? dir.x : -Math.sin(yaw), dz = dir ? dir.z : -Math.cos(yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    // pushed back → on his back; hit from behind → on his face
    const variant = o.variant || (lz > 0.35 ? "face" : "back");
    const side = o.side || (lx >= 0 ? 1 : -1);
    const dur = o.dur != null ? o.dur : 2.0;
    MP.startFall(ch, { variant, side, ko: o.ko !== false, dur });
    dropReel(t);
    const times = MP.fallTimes(variant);
    // noKo: a mode whose brain reads a.ko as something else (gun game: a KO
    // is a kill; warlord and survival have no ko brain) — the rig's own fall
    // clock holds him down instead
    if (!B.isPlayer && !o.noKo) t.ko = Math.max(t.ko || 0, times.fall + (times.delay || 0) + dur + times.getup);
    for (let i = falls.length - 1; i >= 0; i--) if (falls[i].a === t) falls.splice(i, 1);
    falls.push({ a: t, B, gt: times.getup, noKo: !!o.noKo });
    // the body goes down along the BLOW (a strike passes its power; a body
    // set down or dropped by another verb falls where it is)
    if (variant !== "liver" && variant !== "kneel" && B.pos && o.power != null) {
      const D = 0.15 + 0.25 * (o.power == null ? 0.7 : o.power);
      const fs = MP.startStep(ch, 0, 0, 0.45, "L");
      fs.gen = (fs.gen || 0) + 1;
      fs.x = 0; fs.z = 0;           // the feet go with the body (the fall owns the legs)
      pushMove(t, B, ch, D, dx, dz, fs.gen);
    }
    return true;
  };
  V.getUp = function (t) {
    const B = bod(t), ch = B && B.ch, MP = MPf();
    if (!ch || !MP) return false;
    if (!B.isPlayer) {
      const f = ch.fall;
      if (f && f.on) t.ko = Math.min(t.ko || 0, MP.fallTimes(f.variant).getup);
    }
    return MP.getUp(ch);
  };

  /* ============================================================
     SHOT: what a round does to a man it did not kill.

     Before this a surviving hit was CBZ.body.hit: a knockback SLIDE of the
     root (the feet skated), a random spring kick into every limb (legs
     splayed sideways, the torso rolled), a shoulder twist from reactions.js
     of up to 45 degrees on a torso that pivots at the feet, and in the
     prison a CBZ.knockback that teleported him a metre. Together that was
     the "one foot stuck, spinning round it" the owner filmed. A bullet is
     a push along its line and a hurt body part, and the man keeps his feet
     under him with real steps:

       · WHERE: the zone comes off his live rig at the hit point (head,
         torso, either arm, either leg).
       · HOW HARD: caliber (a 9 mm small, a rifle bigger), a shotgun's
         pellets share one blast that is big up close and falls off with
         range. Every round landed on one frame is summed and resolved once.
       · WHAT: head = the head snaps along the line; torso = he folds over it
         and reels 1-3 steps along the line (more for bigger rounds); leg =
         that knee gives and he drops onto it for about a second, then rises
         (a heavy round, or a leg shot at a run, takes him down); arm = it
         hangs dead and the other hand clamps it (an armed city man shot in
         the gun arm may drop the gun, through the same pickup a cuffed man's
         gun becomes).
       · STACKING: a second round adds to the reaction and the steps still
         to take, never restarts it weaker; about three torso rounds inside a
         second put him down (SHOT_KD).
       · MOMENTUM: a man shot at a run stumbles on along it.
       · Never a turn of the whole body: his group yaw is not touched here;
         the root only ever travels along the round (plus his run).
     ============================================================ */
  const SHOT_KD = 2.0;          // stacked load (torso rounds, caliber-weighted) that puts him down
  const SHOT_DECAY = 0.5;       // load bled per second
  const SHOT_LEG_DOWN = 1.45;   // one round this heavy through a leg drops him outright
  const shotQ = [];
  const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sc = new THREE.Vector3(), _sd = new THREE.Vector3(), _sP = new THREE.Vector3();
  const ZN = ["head", "torso", "armL", "armR", "legL", "legR"];
  function koMode() { const m = CBZ.game && CBZ.game.mode; return m === "city" || m === "escape"; }
  function shotRec(ch) {
    return ch._shotR || (ch._shotR = { a: null, B: null, queued: false, e: 0, dx: 0, dz: 0,
      head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0, load: 0, loadT: 0 });
  }
  // which part of him the round found: nearest capsule surface on the live rig
  function shotZone(ch, P) {
    const Z = zonesOf(ch);
    const dH = Math.sqrt(P.distanceToSquared(Z.head.c)) - Z.head.r;
    const dT = Math.sqrt(Math.min(segDist2(P, Z.cA, Z.cB), segDist2(P, Z.dA, Z.dB))) - Z.chestR - 0.03;
    ch.parts.la.getWorldPosition(_sa); ch.parts.ra.getWorldPosition(_sb);
    const dAL = Math.sqrt(Math.min(segDist2(P, _sa, Z.fL), segDist2(P, Z.fL, Z.wL))) - Z.armR;
    const dAR = Math.sqrt(Math.min(segDist2(P, _sb, Z.fR), segDist2(P, Z.fR, Z.wR))) - Z.armR;
    const gy = ch.group.position.y;
    _sc.set(Z.lB.x, gy, Z.lB.z); _sd.set(Z.rB.x, gy, Z.rB.z);
    let dLL = Math.sqrt(Math.min(segDist2(P, Z.lA, Z.lB), segDist2(P, Z.lB, _sc))) - Z.legR;
    let dLR = Math.sqrt(Math.min(segDist2(P, Z.rA, Z.rB), segDist2(P, Z.rB, _sd))) - Z.legR;
    // below the hip joints nothing but a leg is there
    if (P.y < Math.min(Z.lA.y, Z.rA.y)) { if (dLL < dLR) return "legL"; return "legR"; }
    let z = "torso", d = dT;
    if (dH < d) { z = "head"; d = dH; }
    if (dAL < d) { z = "armL"; d = dAL; }
    if (dAR < d) { z = "armR"; d = dAR; }
    if (dLL < d) { z = "legL"; d = dLL; }
    if (dLR < d) { z = "legR"; d = dLR; }
    return z;
  }
  V.shotZone = function (t, P) { const B = bod(t), ch = B && B.ch; return ch && MPf() && P ? shotZone(ch, P) : null; };
  /* DID THE ROUND GO THROUGH HIM? One rule for every gun path, handed to the
     blood as opts.exit (an exit wound sprays out of the far side; a round that
     stays in bleeds from the entry alone). A full-bore round through a body
     exits from ~0.78 calibre up (gore.js's own through-rule: a service
     pistol and up go through a chest, a pocket SMG round stays in); through
     a skull from ~0.5, a limb from ~0.55; buckshot pellets stay in unless the
     muzzle was touching (under 2 m); a round already spent on cover (spent)
     and a less-lethal never exit. o = { cal, wkey, pellets, head, zone, dist,
     spent, nonlethal } */
  V.roundExits = function (o) {
    if (!o || o.nonlethal || o.spent) return false;
    const cal = o.cal > 0 ? o.cal : 1;
    const pellets = o.pellets > 1 || (o.wkey === "shotgun" && !(o.pellets === 1));
    if (pellets) return (o.dist != null ? o.dist : 6) < 2;
    const limb = o.zone === "armL" || o.zone === "armR" || o.zone === "legL" || o.zone === "legR";
    if (o.head || o.zone === "head") return cal >= 0.5;
    return cal >= (limb ? 0.55 : 0.78);
  };
  V.shot = function (t, o) {
    o = o || EMPTY;
    if (!t || isPlayer(t)) return false;
    const B = bod(t), ch = B && B.ch, MP = MPf();
    if (!ch || !MP || !B.pos || B.dead() || !ch.parts || !ch.parts.la) return false;
    // a seated / carried / held body is somebody else's to move
    if (t._npcAttached || ch.sitting || (typeof V.held === "function" && V.held(t))) return false;
    // knocked flat by something that is not the rig's own fall: grapple's body
    if (!(ch.fall && ch.fall.on) && B.down()) return false;
    let dx = 0, dz = 0;
    if (o.dir) { dx = o.dir.x || 0; dz = o.dir.z || 0; }
    if (dx * dx + dz * dz < 1e-8 && o.fromX != null) { dx = B.pos.x - o.fromX; dz = B.pos.z - o.fromZ; }
    if (dx * dx + dz * dz < 1e-8) { const y = B.yaw(); dx = -Math.sin(y); dz = -Math.cos(y); }
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    let e = (o.cal > 0 ? o.cal : 1) * (o.share > 0 ? o.share : 1) * (o.power != null ? o.power : 1);
    if (o.wkey === "shotgun") { const d = o.dist != null ? o.dist : 6; e *= d < 3 ? 1.4 : d > 16 ? 0.3 : 1.4 - (d - 3) * 0.085; }
    let zone = "torso";
    if (o.head) zone = "head";
    else if (o.point && o.point.x != null) {
      _sP.set(o.point.x, o.point.y, o.point.z);
      zone = shotZone(ch, _sP);
    }
    // the caller's blood reads this back (o is the caller's own record)
    if (o !== EMPTY && typeof o === "object") o.exit = V.roundExits({ cal: o.cal, wkey: o.wkey, pellets: o.share > 0 && o.share < 1 ? 2 : 1, head: o.head, zone, dist: o.dist, spent: o.spent });
    const R = shotRec(ch);
    R.e += e; R.dx += dx * e; R.dz += dz * e; R[zone] += e;
    if (!R.queued) { R.queued = true; R.a = t; R.B = B; shotQ.push(R); }
    return true;
  };
  // the reaction on the rig: a bigger hit takes it over, a smaller one feeds
  // it, the same kind again holds it at its peak and grows it
  function shotReact(ch, B, kind, px, pz, amt, dur, side) {
    let hr = ch.hitReact;
    if (!hr) hr = ch.hitReact = { on: false, kind: "snap", t: 0, dur: 0.5, lx: 0, lz: -1, side: "L", amt: 1, blow: "straight" };
    const yaw = B.yaw(), c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = px * c - pz * s, lz = px * s + pz * c;
    const left = hr.on ? (hr.amt || 1) * Math.max(0, 1 - hr.t / Math.max(0.05, hr.dur)) : 0;
    if (hr.on && hr.kind === kind) {
      hr.amt = Math.min(1.6, Math.max(hr.amt || 0, amt) + amt * 0.35);
      hr.t = Math.min(hr.t, 0.06); hr.dur = Math.max(hr.dur, dur);
      hr.lx = (hr.lx + lx) * 0.5; hr.lz = (hr.lz + lz) * 0.5;
      if (side) hr.side = side;
    } else if (!hr.on || amt >= left) {
      hr.on = true; hr.kind = kind; hr.t = 0; hr.amt = amt; hr.dur = dur; hr.lx = lx; hr.lz = lz;
      hr.blow = "straight"; if (side) hr.side = side;
    } else {
      hr.amt = Math.min(1.6, hr.amt + amt * 0.3);
      hr.t = Math.min(hr.t, 0.06);
    }
    hr.shot = true;
  }
  function resolveShot(R, MP) {
    const t = R.a, B = R.B, ch = B && B.ch;
    const E = R.e;
    let dx = R.dx, dz = R.dz;
    let zone = "torso", ze = -1;
    for (let i = 0; i < ZN.length; i++) if (R[ZN[i]] > ze) { ze = R[ZN[i]]; zone = ZN[i]; }
    const body = R.torso + R.legL + R.legR + 0.5 * (R.armL + R.armR);
    R.queued = false; R.a = null; R.B = null; R.e = 0; R.dx = 0; R.dz = 0;
    for (let i = 0; i < ZN.length; i++) R[ZN[i]] = 0;
    if (!ch || !(E > 0) || B.dead()) return;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    R.load = Math.max(0, R.load - (clock - R.loadT) * SHOT_DECAY) + body;
    R.loadT = clock;
    const noKo = !koMode();
    const f = ch.fall;
    if (f && f.on) {
      // already on the knee: enough more and he goes all the way down
      if (f.variant === "kneel" && R.load >= SHOT_KD) {
        R.load = 0;
        V.knockdown(t, { dir: { x: dx, z: dz }, power: Math.min(1, 0.45 + 0.3 * E), ko: false, dur: 1.2, noKo });
      }
      return;
    }
    // whatever he was throwing is gone
    const his = strikeOf(t);
    if (his) finish(his, true);
    ch.punchT = 0; ch.kickT = 0;
    // MOMENTUM: a man shot at a run carries on along it
    const mv = ch._mMv || 0;
    let px = dx, pz = dz;
    if (mv > 0.5) {
      const yaw = B.yaw();
      px = dx * E + Math.sin(yaw) * 1.2 * mv; pz = dz * E + Math.cos(yaw) * 1.2 * mv;
      const pl = Math.hypot(px, pz) || 1; px /= pl; pz /= pl;
    }
    const legHit = zone === "legL" || zone === "legR";
    if (R.load >= SHOT_KD || (legHit && (E >= SHOT_LEG_DOWN || mv > 0.5))) {
      R.load = 0;
      V.knockdown(t, { dir: { x: px, z: pz }, power: Math.min(1, 0.45 + 0.3 * E), ko: false, dur: 1.2, noKo });
      return;
    }
    const k = E > 1.6 ? 1.6 : E;
    if (legHit) {
      // that knee gives: down onto it, held about a second, then up
      V.knockdown(t, { variant: "kneel", side: zone === "legR" ? 1 : -1, dir: { x: dx, z: dz }, ko: false, dur: 0.8 + 0.3 * Math.min(1, E), noKo });
      return;
    }
    if (zone === "head") {
      shotReact(ch, B, "snap", dx, dz, 0.6 + 0.5 * k, 0.55 + 0.2 * Math.min(1, k), null);
      if (E > 1) reel(t, B, ch, px, pz, 1, 0.12 + 0.08 * k, 0.28);
    } else if (zone === "armL" || zone === "armR") {
      shotReact(ch, B, "arm", dx, dz, 0.6 + 0.4 * k, 1.1, zone === "armL" ? "L" : "R");
      reel(t, B, ch, px, pz, 1, 0.08 + 0.08 * k, 0.26);
      // the gun hand: the city's own drop (the pickup a cuffed man's gun becomes)
      if (zone === "armR" && t.armed && t.weapon && t.kind !== "cop" && CBZ.cityDropWeapon &&
          CBZ.game && CBZ.game.mode === "city" && Math.random() < Math.min(0.85, 0.3 + 0.35 * E)) {
        const hp = ch.sockets && ch.sockets.rightHand ? ch.sockets.rightHand.getWorldPosition(_sa) : B.pos;
        try {
          CBZ.cityDropWeapon(hp.x, hp.z, t.weapon, t.ammo || 12, { y: B.pos.y || 0 });
          t.armed = false; t.weapon = null;
          if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(t);
        } catch (e) { /* city drops not built */ }
      }
    } else if (mv > 0.5) {
      // hit at a run: he pitches forward along it and stumbles on
      shotReact(ch, B, "stagger", px, pz, 0.6 + 0.4 * k, 0.6, null);
      reel(t, B, ch, px, pz, 1, 0.22 + 0.12 * k, 0.26);
    } else {
      // the torso: folds over it and reels back along the line, 1-3 steps
      shotReact(ch, B, "fold", dx, dz, 0.35 + 0.4 * k, 0.75, null);
      const n = E < 0.9 ? 1 : E < 1.45 ? 2 : 3;
      reel(t, B, ch, dx, dz, n, Math.min(0.38, 0.14 + 0.12 * E), 0.28);
    }
  }

  /* HITSTOP: both bodies freeze together on contact (ch.freezeT, wall time);
     the whole world only stops when the player is one of them. */
  V.hitstop = function (att, tgt, secs, playerInvolved) {
    const s = secs == null ? 0.06 : secs;
    const A = bod(att), T = tgt ? bod(tgt) : null;
    if (A && A.ch) A.ch.freezeT = Math.max(A.ch.freezeT || 0, s);
    if (T && T.ch) T.ch.freezeT = Math.max(T.ch.freezeT || 0, s);
    const pl = playerInvolved != null ? playerInvolved : !!((A && A.isPlayer) || (T && T.isPlayer));
    if (pl && CBZ.doHitstop) CBZ.doHitstop(s);
  };

  /* ============================================================
     THE FIGHTER — the timing brain for HOW an exchange looks. The BRAIN
     lead decides a man fights; this decides his next beat:
       · combinations with rhythm (jab-cross, jab-jab-cross, cross-hook,
         body-head, jab-body...), the guard back between them, rest beats;
       · reads the other man's wind-up (his fighter's telegraph, or his rig's
         punch clock) and blocks or slips after a human reaction time
         (0.30 s for a brawler, 0.18 s for a pro) — if he reads it in time;
       · steps in to his range and back out of the other man's;
       · gets tired (ch.winded), and tired men throw less and slower;
       · never spams: at most MAXN blows in any WINDOW seconds.
     F.tick(dt, target, opts) -> { type: "strike"|"block"|"slip"|"step", kind, arm, dir, x, z } | null
     opts.perform: run the action itself (strike/block/slip/step) with
       opts.onLand / onWhiff / onBlocked. opts.rng / opts.seed: deterministic.
     ============================================================ */
  const COMBOS = [
    { k: ["jab"], w: 1.2, r: "mid" },
    { k: ["jab", "cross"], w: 1.6, r: "mid" },
    { k: ["jab", "jab", "cross"], w: 0.9, r: "mid" },
    { k: ["cross", "hook"], w: 0.9, r: "mid" },
    { k: ["jab", "cross", "hook"], w: 0.8, r: "mid" },
    { k: ["body", "hook"], w: 0.8, r: "mid" },
    { k: ["jab", "body"], w: 0.7, r: "mid" },
    { k: ["hook", "cross"], w: 0.5, r: "mid" },
    { k: ["upper", "hook"], w: 0.9, r: "close" },
    { k: ["body", "upper"], w: 0.6, r: "close" },
    { k: ["elbow"], w: 0.35, r: "close" },
  ];
  const WINDOW = 2.0, MAXN = 4;
  /* ============================================================
     GROUND AND POUND — the one hit button on a man who is down.
     (OWNER: "add headbutting and ground and pound, legit UFC level".)
     V.groundStrike(att, tgt, opts) gets you ON him the first time (a quick
     slide to kneel astride his belly, facing his head: THE MOUNT, posed by
     entities/meleeposes.js off ch.mount) and throws the next blow of the
     sequence a cage fighter actually throws from there: punches in twos,
     left-right, then the elbow dropped with the whole torso on its point,
     two more, then the hammerfist. Every blow resolves on its beat (there is
     no contact test against a man lying under you: the fist is going into
     the floor through his face) and his head turns off it, hits the floor
     and comes back; a conscious man covers up. You stay on him while you
     keep hitting; stop for a moment, walk off him, or let him get up and
     the mount is over. opts: onLand(res) as V.strike (res.zone "head"),
     kind (force a blow), heavy, power, weapon (a blade stabs from the
     mount), rng, reach (how far away you may start, default 2.2 m).
     ============================================================ */
  const mounts = [];
  const GNP_SEQ = ["gnp", "gnp", "gnpElbow", "gnp", "gnp", "hammer"];
  function mountOf(a) { for (let i = 0; i < mounts.length; i++) if (mounts[i].a === a) return mounts[i]; return null; }
  V.mountOf = mountOf;
  function dismount(M) {
    const i = mounts.indexOf(M);
    if (i >= 0) mounts.splice(i, 1);
    if (M.a) M.a._gnpOn = null;
    const ch = M.Ba && M.Ba.ch;
    if (ch) ch.mount = false;
    if (M.Ba && M.Ba.isPlayer && CBZ.player) {
      CBZ.player._gnpOn = null;
      if (M.crouchSet) CBZ.player.crouch = false;
    }
  }
  V.dismount = function (a) { const M = mountOf(a); if (M) dismount(M); };
  V.groundStrike = function (att, tgt, opts) {
    opts = opts || EMPTY;
    const Ba = bod(att), Bt = bod(tgt);
    if (!Ba || !Bt || !Bt.ch || !Bt.pos || !Ba.pos || Ba.dead() || Ba.down() || !Bt.down()) return null;
    const tch = Bt.ch;
    if (!tch.head || !tch.body) return null;
    let M = mountOf(att);
    if (M && M.t !== tgt) { dismount(M); M = null; }
    if (!M) {
      const d = Math.hypot(Bt.pos.x - Ba.pos.x, Bt.pos.z - Ba.pos.z);
      if (d > (opts.reach || 2.2)) return null;
      for (let i = 0; i < mounts.length; i++) if (mounts[i].t === tgt) return null;   // somebody is already on him
      M = { a: att, Ba, t: tgt, Bt, n: 0, idle: 0, slide: 0, drift: 0, lastX: Ba.pos.x, lastZ: Ba.pos.z, side: "r", crouchSet: false };
      mounts.push(M);
      att._gnpOn = tgt;
      if (Ba.isPlayer && CBZ.player) {
        CBZ.player._gnpOn = tgt;
        if (!CBZ.player.crouch) { CBZ.player.crouch = true; M.crouchSet = true; }   // the eye comes down with you
      }
      if (Ba.ch) Ba.ch.mount = true;
    }
    M.idle = 0;
    const blade = !!(opts.weapon && opts.weapon.blade);
    const kind = blade ? "stab" : (opts.kind || GNP_SEQ[M.n % GNP_SEQ.length]);
    let arm = opts.arm;
    if (!arm) {
      if (kind === "gnp") { M.side = M.side === "l" ? "r" : "l"; arm = M.side; }
      else arm = M.side === "l" ? "r" : "l";                  // the power shots come off the other hand
    }
    const S = V.strike(att, tgt, { kind, arm, heavy: !!opts.heavy, power: opts.power, lunge: false, snap: 0,
      weapon: opts.weapon || null, rng: opts.rng,
      onBeat: function (St) { groundLand(St, M, opts); } });
    if (!S) return null;
    M.n++;
    return S;
  };
  function groundLand(S, M, opts) {
    const Ba = S.Ba, Bt = bod(M.t);
    if (!Ba || !Bt || !Bt.pos) return;
    const res = S.res, tch = Bt.ch;
    if (S.hasAim) res.point.copy(S.aim);
    else res.point.set(Bt.pos.x, (Bt.pos.y || 0) + 0.2, Bt.pos.z);
    let dx = res.point.x - Ba.pos.x, dz = res.point.z - Ba.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    res.dir.x = dx / d; res.dir.z = dz / d;
    res.landed = true; res.blocked = false; res.target = M.t;
    res.zone = S.level === "ground" ? "head" : "body";
    // a man covering up under you takes some of it on his forearms
    const covering = tch && tch.gHit && tch.gHit.on && tch.fall && !tch.fall.ko && tch.gHit.t < 1.2;
    res.dmgMul = (res.zone === "head" ? 1 : 0.8) * (covering ? 0.7 : 1);
    res.reaction = "none"; res.stagger = false; res.blood = 0;
    if (opts.onLand) opts.onLand(res);
    if (!S.Ba) return;
    const bothP = Ba.isPlayer || Bt.isPlayer;
    V.hitstop(S.att, M.t, 0.035 + 0.05 * res.power, bothP);
    if (bothP && CBZ.shake) CBZ.shake(0.12 + 0.32 * res.power);
    if (Ba.isPlayer && CBZ.fpsPunchLanded) CBZ.fpsPunchLanded(S.kind, S.heavy || res.power > 0.8);
    const MP = MPf();
    if (tch && MP && MP.groundHit && !Bt.dead()) MP.groundHit(tch, S.arm === "l" ? 1 : -1, 0.55 + 0.6 * res.power);
    if (CBZ.trauma && CBZ.trauma.strike) {
      try {
        CBZ.trauma.strike(M.t, 3 + 7 * res.power, { dir: { x: res.dir.x, y: -0.6, z: res.dir.z }, fromX: Ba.pos.x, fromZ: Ba.pos.z,
          y: res.point.y - ((Bt.pos && Bt.pos.y) || 0), flesh: 1 });
      } catch (e) { /* trauma off in this mode */ }
    }
    const cut = !!(S.weapon && S.weapon.blade);
    if ((res.blood > 0 || cut) && CBZ.goreImpact) {
      CBZ.goreImpact(res.point.x, res.point.y, res.point.z, { amount: res.blood || 0.8, blade: cut, dir: { x: res.dir.x, y: -0.5, z: res.dir.z } });
    }
  }
  const _mh = new THREE.Vector3(), _mb = new THREE.Vector3();
  function stepMounts(dt) {
    for (let i = mounts.length - 1; i >= 0; i--) {
      const M = mounts[i], Ba = M.Ba, Bt = M.Bt, tch = Bt && Bt.ch, p = Ba && Ba.pos;
      M.idle += dt;
      const busy = !!strikeOf(M.a);
      // walking off him: your own feet moved you since the mount placed you
      if (p) { const mv = Math.hypot(p.x - M.lastX, p.z - M.lastZ); if (M.slide >= 1 && mv > 0.012) M.drift += mv; }
      if (!p || Ba.dead() || Ba.down() || !Bt.pos || !tch || !tch.head || !Bt.down() ||
          (!busy && M.idle > (Ba.isPlayer ? 1.7 : 1.2)) || M.drift > 0.22) { dismount(M); continue; }
      // astride his belly, facing his head
      tch.head.getWorldPosition(_mh); tch.body.getWorldPosition(_mb);
      let ux = _mh.x - _mb.x, uz = _mh.z - _mb.z;
      const L = Math.hypot(ux, uz);
      if (L < 0.2) { ux = Bt.pos.x - p.x; uz = Bt.pos.z - p.z; }
      const l2 = Math.hypot(ux, uz) || 1; ux /= l2; uz /= l2;
      const s = scaleOf(tch) / 0.7;
      const tx = _mb.x + ux * 0.38 * s, tz = _mb.z + uz * 0.38 * s;
      M.slide = Math.min(1, M.slide + dt / 0.3);
      const k = 1 - Math.exp(-dt * (M.slide >= 1 ? 30 : 12));
      moveBy(Ba, (tx - p.x) * k, (tz - p.z) * k);
      Ba.face(Math.atan2(ux, uz), Math.min(1, dt * 12));
      M.lastX = p.x; M.lastZ = p.z;
      if (Ba.ch) Ba.ch.mount = true;
    }
  }

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
  function Fighter(a, o) {
    o = o || EMPTY;
    this.a = a;
    this.skill = clamp01(o.skill != null ? o.skill : (a.skill != null ? a.skill : 0.5));
    this.aggr = clamp01(o.aggression != null ? o.aggression : 0.55);
    this.rng = o.rng || mulberry(o.seed != null ? o.seed : ((Math.random() * 1e9) | 0));
    this.state = "guard";
    this.combo = null; this.ci = 0;
    this.restT = 0.4 + this.rng() * 0.5;
    this.stam = 1;
    this.clock = 0;
    this.log = new Float64Array(8); this.logN = 0;
    this.readN = -1; this.defT = -1; this.defKind = null; this.defDir = 1;
    this.stepCD = 0;
    this.act = { type: null, kind: null, arm: null, dir: 0, x: 0, z: 0 };
    this.tel = { kind: null, prog: 0, dur: 0, impactIn: 0, n: 0 };
    this.thrown = 0;
  }
  Fighter.prototype.recent = function () {
    let n = 0;
    for (let i = 0; i < this.log.length; i++) if (this.log[i] > 0 && this.clock - this.log[i] < WINDOW) n++;
    return n;
  };
  Fighter.prototype.telegraph = function () {
    const B = bod(this.a), ch = B && B.ch;
    return telegraphOfRig(ch, this.tel);
  };
  function telegraphOfRig(ch, out) {
    if (!ch || !(ch.punchT > 0 || ch.kickT > 0)) return null;
    const MP = MPf();
    const kick = !(ch.punchT > 0);
    const dur = kick ? (ch.kickDur || 0.5) : (ch.punchDur || 0.3);
    const tt = kick ? ch.kickT : ch.punchT;
    const prog = clamp01(1 - tt / dur);
    out.kind = kick ? ch.kickKind : ch.punchKind;
    out.prog = prog; out.dur = dur;
    out.impactIn = ((kick ? MP.kickImpactP : MP.BEAT.impact) - prog) * dur;
    out.n = ch._mSwingN || 0;
    return out;
  }
  const _telO = { kind: null, prog: 0, dur: 0, impactIn: 0, n: 0 };
  function telegraphOf(t) {
    if (t && t._vfS) return t._vfS.telegraph();
    const B = bod(t);
    return telegraphOfRig(B && B.ch, _telO);
  }
  Fighter.prototype.tick = function (dt, target, o) {
    o = o || EMPTY;
    const a = this.a, B = bod(a), ch = B && B.ch;
    this.clock += dt;
    if (!B || B.dead() || B.down() || !target) return null;
    const Bt = bod(target);
    if (!Bt || !Bt.pos || Bt.dead()) return null;
    const mine = strikeOf(a);
    // stamina: every blow costs, the guard breathes it back
    this.stam = Math.min(1, this.stam + dt * (mine ? 0.04 : 0.16));
    if (ch) { ch.winded = clamp01(1 - this.stam * 1.25); ch.fightStance = true; }
    const ap = B.pos, tp = Bt.pos;
    const dx = tp.x - ap.x, dz = tp.z - ap.z, dist = Math.hypot(dx, dz) || 1e-4;
    const ux = dx / dist, uz = dz / dist;
    const A = this.act;
    A.type = null;
    // HE IS DOWN: get on him and pound him out (a burst, then you get off him
    // the way a fighter does when the ref is not stopping it fast enough)
    if (Bt.down()) {
      if (mine || !o.perform || o.groundAndPound === false) return null;
      if (this.gnpLeft == null) this.gnpLeft = 3 + ((this.rng() * (3 + 4 * this.aggr)) | 0);
      if (this.gnpLeft <= 0) return null;
      if (dist > 2.0) return this.footwork(dt, dist, ux, uz, 1.2, o, target);
      if (this.rng() > (1.6 + 2.4 * this.aggr) * dt) return null;
      if (!V.groundStrike(a, target, { onLand: o.onLand, rng: this.rng })) return null;
      this.gnpLeft--; this.thrown++;
      this.stam = Math.max(0, this.stam - 0.08);
      A.type = "ground"; A.kind = "gnp";
      return A;
    }
    this.gnpLeft = null;
    if (!mine) B.face(Math.atan2(dx, dz), Math.min(1, dt * 8));
    // ---- DEFENCE: read his wind-up, answer after a human reaction time ----
    const tel = Bt.down() ? null : telegraphOf(target);
    if (tel && tel.n !== this.readN && tel.prog < 0.4) {
      this.readN = tel.n;
      const rt = 0.30 - 0.12 * this.skill + (this.rng() - 0.5) * 0.06;
      this.defT = rt;
      const r = this.rng();
      const pBlock = 0.62 - 0.30 * this.skill, pSlip = 0.26 + 0.24 * this.skill;
      this.defKind = r < pBlock ? "block" : r < pBlock + pSlip ? "slip" : "pull";
      if (MPf() && MPf().levelOf(tel.kind) === "body") this.defKind = r < 0.5 ? "pull" : "block";
      this.defDir = this.rng() < 0.5 ? -1 : 1;
      this.defAt = this.clock;
    }
    if (this.defT >= 0) {
      this.defT -= dt;
      if (this.defT < 0) {
        this.defT = -1;
        // A punch lands 0.1-0.15 s after it starts: nobody reacts to the
        // FIRST one. What a fighter reacts to is the exchange: he saw it start,
        // and after his reaction time he covers up or moves his head for the
        // shots that come behind it (or the tail of a slow one).
        if (this.clock - this.defAt < 0.65 && !mine && dist < V.reachOf("overhand", target) + 0.2 &&
            this.rng() < 0.35 + 0.6 * this.skill) {
          A.type = this.defKind === "block" ? "block" : "slip";
          A.kind = this.defKind; A.dir = this.defDir;
          this.state = "guard";
          return this.perform(o, target);
        }
      }
    }
    // ---- OFFENCE ----
    const reachMid = V.reachOf("jab", a), reachClose = V.reachOf("upper", a);
    if (this.state === "combo") {
      if (mine && mine.p < 0.62) return null;                   // let this one finish its beat
      if (this.ci >= this.combo.length) {
        this.state = "rest";
        this.restT = (0.55 + this.rng() * 0.9) * (1 + (1 - this.stam) * 1.4) * (1.2 - 0.4 * this.aggr);
        return null;
      }
      if (this.recent() >= MAXN) return null;
      const kind = this.combo[this.ci++];
      return this.strikeAct(kind, o, target);
    }
    if (this.state === "rest") {
      this.restT -= dt;
      if (this.restT > 0) return this.footwork(dt, dist, ux, uz, reachMid, o, target);
      this.state = "guard";
    }
    // guard: pick a moment to open up
    if (mine) return null;
    if (dist > reachMid + 0.55) return this.footwork(dt, dist, ux, uz, reachMid, o, target);
    if (this.stam < 0.22 || this.recent() >= MAXN) return this.footwork(dt, dist, ux, uz, reachMid, o, target);
    const want = (0.8 + 1.6 * this.aggr) * dt;
    if (this.rng() > want) return this.footwork(dt, dist, ux, uz, reachMid, o, target);
    const close = dist < reachClose + 0.15;
    let tot = 0;
    for (let i = 0; i < COMBOS.length; i++) if ((COMBOS[i].r === "close") === close || (!close && COMBOS[i].r === "mid")) tot += COMBOS[i].w;
    let pick = this.rng() * tot, c = COMBOS[0];
    for (let i = 0; i < COMBOS.length; i++) {
      const C = COMBOS[i];
      if ((C.r === "close") !== close) continue;
      pick -= C.w;
      if (pick <= 0) { c = C; break; }
    }
    this.combo = c.k; this.ci = 0; this.state = "combo";
    return this.strikeAct(this.combo[this.ci++], o, target);
  };
  Fighter.prototype.strikeAct = function (kind, o, target) {
    const A = this.act;
    A.type = "strike"; A.kind = kind; A.arm = null;
    this.log[this.logN++ % this.log.length] = this.clock;
    this.stam = Math.max(0, this.stam - (kind === "jab" ? 0.07 : kind === "cross" || kind === "body" ? 0.11 : 0.13));
    this.thrown++;
    return this.perform(o, target);
  };
  Fighter.prototype.footwork = function (dt, dist, ux, uz, reach, o, target) {
    this.stepCD -= dt;
    if (this.stepCD > 0) return null;
    const A = this.act;
    const lo = reach - 0.45, hi = reach + 0.1;
    if (dist > hi) { A.type = "step"; A.x = ux; A.z = uz; A.dir = 1; }
    else if (dist < lo) { A.type = "step"; A.x = -ux; A.z = -uz; A.dir = -1; }
    else if (this.rng() < 0.25) { const s = this.rng() < 0.5 ? 1 : -1; A.type = "step"; A.x = uz * s; A.z = -ux * s; A.dir = 0; }   // circle
    else return null;
    this.stepCD = 0.45 + this.rng() * 0.35;
    return this.perform(o, target);
  };
  Fighter.prototype.perform = function (o, target) {
    const A = this.act;
    if (!o.perform || !A.type) return A.type ? A : null;
    if (A.type === "strike") {
      const S = V.strike(this.a, target, { kind: A.kind, arm: A.arm || undefined, onLand: o.onLand, onWhiff: o.onWhiff, onBlocked: o.onBlocked, rng: this.rng, maxLunge: 0.3 });
      if (!S) { this.ci = Math.max(0, this.ci - 1); return null; }
    } else if (A.type === "block") V.block(this.a, 0.45);
    else if (A.type === "slip") V.slip(this.a, A.dir, A.kind === "pull" ? "pull" : "slip");
    else if (A.type === "step") V.step(this.a, A.x, A.z, 0.3);
    return A;
  };
  V.fighter = function (a, o) {
    if (!a) return null;
    return a._vfS || (a._vfS = new Fighter(a, o));
  };

  if (CBZ.onUpdate) CBZ.onUpdate(86, update);
})();
