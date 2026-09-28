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
     knockdown(t, {dir, dur, ko, variant, side}) · getUp(t) · hitstop(att, tgt, secs)
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
  };
  const POWER = {
    jab: 0.35, cross: 0.75, hook: 0.82, upper: 0.82, body: 0.70, bodyStraight: 0.62, overhand: 0.92,
    elbow: 0.80, headbutt: 0.85, stab: 0.55, shove: 0.55, front: 0.72, round: 0.95, low: 0.62, knee: 0.88,
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
  let _wy = 0, _wax = 0, _waz = 0, _wbx = 0, _wbz = 0;
  function segBox(c) {
    if (c.maxY != null && c.minY != null && (_wy < c.minY || _wy > c.maxY)) return false;
    // slab test of segment a→b against the box in x/z
    let t0 = 0, t1 = 1;
    const dx = _wbx - _wax, dz = _wbz - _waz;
    if (Math.abs(dx) < 1e-9) { if (_wax < c.minX || _wax > c.maxX) return false; }
    else { let ta = (c.minX - _wax) / dx, tb = (c.maxX - _wax) / dx; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
    if (Math.abs(dz) < 1e-9) { if (_waz < c.minZ || _waz > c.maxZ) return false; }
    else { let ta = (c.minZ - _waz) / dz, tb = (c.maxZ - _waz) / dz; if (ta > tb) { const s = ta; ta = tb; tb = s; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false; }
    return true;
  }
  function walled(ax, ay, az, bx, by, bz) {
    if (CBZ.segmentHitsCollider) {
      _wax = ax; _waz = az; _wbx = bx; _wbz = bz; _wy = (ay + by) * 0.5;
      try { if (CBZ.segmentHitsCollider(ax, az, bx, bz, 0, segBox)) return true; } catch (e) { /* no grid on this page */ }
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
          const need = d + Math.max(0, pend) - V.reachOf(kind, att) * 0.92;
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
    const res = S.res, tch = Bt.ch;
    const bothP = S.Ba.isPlayer || Bt.isPlayer;
    const stop = res.blocked ? 0.035 : 0.045 + 0.065 * res.power;
    V.hitstop(S.att, c, stop, bothP);
    if (bothP && CBZ.shake) CBZ.shake(res.blocked ? 0.15 : 0.16 + 0.42 * res.power);
    if (S.Ba.isPlayer && CBZ.fpsPunchLanded) CBZ.fpsPunchLanded(S.kind, S.heavy || res.power > 0.8);
    const r = res.reaction;
    if (r === "dead" || r === "none") { /* the caller owns it */ }
    else if (r === "block") {
      if (tch) { tch.blockT = Math.max(tch.blockT || 0, 0.3); tch.blockHitT = 0.2; }
    } else if (r === "knockdown") {
      V.knockdown(c, { dir: res.dir, ko: true, power: res.power });
    } else {
      V.react(c, { zone: res.zone, kind: S.kind, arm: S.arm, dir: res.dir, power: res.power, stagger: res.stagger || r === "stagger", reaction: r, legSide: _legSide });
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
        try { CBZ.bodyWound(c, res.point, { melee: "blade", cal: 0.7, fromX: S.Ba.pos.x, fromZ: S.Ba.pos.z }); } catch (e) { /* wounds off */ }
      }
      if (res.blood > 0 && CBZ.goreImpact) {
        CBZ.goreImpact(res.point.x, res.point.y, res.point.z, { amount: res.blood, dir: { x: res.dir.x, y: 0.35, z: res.dir.z } });
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
  const falls = [];     // fallen actors whose ko timer the rig's get-up follows
  function update(dt) {
    frameN++;
    const MP = MPf();
    if (!MP) return;
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
      if (F.B.isPlayer) continue;
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
    const B = bod(a), ch = B && B.ch, MP = MPf();
    if (!B || !B.pos || B.down()) return false;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const D = dist == null ? 0.35 : dist;
    if (!ch || !MP) { moveBy(B, dx * D, dz * D); return true; }
    const yaw = B.yaw(), c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;          // world → his frame
    const sc = scaleOf(ch);
    // the foot on the side of travel moves first
    const lead = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? "L" : "R") : (lz > 0 ? (MP.leadSide(ch) === "l" ? "L" : "R") : (MP.leadSide(ch) === "l" ? "R" : "L"));
    const fs = MP.startStep(ch, lx * D / sc, lz * D / sc, dur || 0.34, lead);
    fs.gen = (fs.gen || 0) + 1;
    pushMove(a, B, ch, D, dx, dz, fs.gen);
    return true;
  };
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
    // a real step to catch the weight: the foot on the side it is thrown to
    if (o.stagger && B.pos) {
      const D = 0.16 + 0.34 * power;
      const sc = scaleOf(ch);
      const lead = Math.abs(hr.lx) > Math.abs(hr.lz) ? (hr.lx > 0 ? "L" : "R") : (MP.leadSide(ch) === "l" ? "R" : "L");
      const fs = MP.startStep(ch, hr.lx * D / sc, hr.lz * D / sc, 0.38 + 0.12 * power, lead);
      fs.gen = (fs.gen || 0) + 1;
      pushMove(t, B, ch, D, dx, dz, fs.gen);
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
    const times = MP.fallTimes(variant);
    if (!B.isPlayer) t.ko = Math.max(t.ko || 0, times.fall + (variant === "liver" ? 0.22 : 0) + dur + times.getup);
    for (let i = falls.length - 1; i >= 0; i--) if (falls[i].a === t) falls.splice(i, 1);
    falls.push({ a: t, B, gt: times.getup });
    // the body goes down along the BLOW (a strike passes its power; a body
    // set down or dropped by another verb falls where it is)
    if (variant !== "liver" && B.pos && o.power != null) {
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
    if (!mine) B.face(Math.atan2(dx, dz), Math.min(1, dt * 8));
    const A = this.act;
    A.type = null;
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
