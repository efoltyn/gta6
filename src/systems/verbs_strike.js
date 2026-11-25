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
       overrule the reaction (res.reaction = "dead" | "knockdown" | "none" | ...;
       whether the skin split is vitals.js's call). Then the reaction plays, both rigs
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
     condition(a) -> { daze, wind, legs, gst, openT, downs, chin } (see CONDITION)
     telegraphOf(t) -> what his rig is throwing now, or null
     strikeOf(a) · cancelStrike(a) · reachOf(kind, a) · powerOf(kind)
     res also carries: force (how much arrived), counter (he walked into it),
       blind (he never saw it), parried, guardBroken, ko (a knockout)
     opts.aimErr (m): how far off the line an untrained hand throws
     opts.weapon {kind: bat|pipe|club|baton|knife|shank|rifle, len, force,
       blade}: the striking point rides out along the forearm by len
     THE FIGHTER (V.fighter) and the one control grammar live in
     systems/melee.js (CBZ.melee): who throws what. This file is how it lands.
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
    // THE ONE MOVER (systems/bodymove.js): the stagger step is swept, so a
    // blow never knocks a man through the wall or the shut door behind him
    const bx = p.x, bz = p.z;
    if (CBZ.bodyMove) {
      _sO.clearRadius = B.isPlayer ? ((CBZ.player && CBZ.player.radius) || 0.45) : 0.42;
      _sO.posture = B.down() ? "down" : "stand";
      CBZ.bodyMove(p, dx, 0, dz, _sO);
    } else { p.x += dx; p.z += dz; }
    const mx = p.x - bx, mz = p.z - bz;
    const ch = B.ch;
    if (ch && ch.group && ch.group.position !== p) { ch.group.position.x += mx; ch.group.position.z += mz; }
    const g = B.a && B.a.group;
    if (g && g.position !== p && (!ch || g !== ch.group)) { g.position.x += mx; g.position.z += mz; }
  }
  const _sO = { posture: "stand", radius: 0.3, clearRadius: 0.42, out: { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: 0 } };

  /* ---- the blow table: natural reach (m, centre to centre, two adults with
     no step), power, and the stagger step a clean one forces ---- */
  /* (2026-11-23) THE HOOKS CAME IN, THE KICKS WENT OUT. A hook keeps its
     elbow near a right angle now (meleeposes KIND ext), so the fist is 0.55 m
     from the shoulder, not 0.65: thrown from the old 1.30 it would stop short
     of him. The kicks were the other way: a leg is 0.87 m and the hips come
     over the standing foot, but the table had a man step in to 0.83-0.87 m to
     kick, closer than he punches, so every kick landed half folded with the
     knee still bent 90 degrees. They are thrown from where a leg reaches:
     front 1.15 (the foot can meet his belly out to 1.32, or 1.16 from a
     square stand with no stance under it), round 1.02, low 1.08.
     (Same day, after the first capture: still folded. At 1.06 m the foot is
     sent to a belly 0.99 rig units from the hip of a 1.25 leg, a knee bent
     62 degrees; main's kicks read as kicks because they met him near 1.2 m.
     Now front 1.28, round 1.15, low 1.15: the leg is all but straight when
     it lands. And a strike has a NEAR limit as well as a far one: see RANGE
     in V.strike.)
     (11-24: the front kick still met him with the knee bent ~50 degrees.
     The foot stops when it touches (contact: the ball of the foot against
     the belly zone, a 16 cm sphere whose front is 17 cm ahead of his
     centre), and from 1.18 m that happens 13 cm before the leg is out. From
     1.24 m (1.35 x 0.92) it happens with the knee at ~30 degrees and 2.5 cm
     of leg still in hand; any further and a man leaning back is missed.)
     (11-25: contact is his real surface now, CBZ.bodyParts, not the zone
     sphere. The front of his shirt is 7 cm behind where the belly and liver
     spheres stood, so every blow to the trunk has 7 cm further to go: the
     trunk blows are thrown from 7 cm (x 1/0.92) nearer. The front kick is
     back at 1.28: the same ~25-30 degree knee at contact, on the shirt.) */
  const REACH = {
    jab: 1.28, cross: 1.30, hook: 1.00, upper: 0.80, body: 1.05, bodyStraight: 1.05, overhand: 1.42,
    elbow: 0.92, headbutt: 0.74, stab: 0.90, shove: 1.10, front: 1.28, round: 1.09, low: 1.15, knee: 0.57,
    gnp: 1.0, gnpElbow: 0.9, hammer: 1.0,
    // a man on the floor (V.groundKick): measured to the spot on him the foot
    // goes to, not to his root. The stomp comes down just in front of the
    // standing foot; the soccer kick meets him with the leg nearly out.
    stomp: 0.52, soccer: 0.74,
    // with a weapon in the hand the reach is the weapon's (the contact point
    // is carried out along the forearm by weapon.len, see WEAPON below)
    bat: 1.80, slash: 1.30, butt: 1.40,
  };
  const POWER = {
    jab: 0.35, cross: 0.75, hook: 0.82, upper: 0.82, body: 0.70, bodyStraight: 0.62, overhand: 0.92,
    elbow: 0.80, headbutt: 0.85, stab: 0.55, shove: 0.55, front: 0.72, round: 0.95, low: 0.62, knee: 0.88,
    gnp: 0.62, gnpElbow: 0.86, hammer: 0.72, stomp: 0.95, soccer: 0.85,
    bat: 1.0, slash: 0.42, butt: 0.85,
  };
  // the nearest a straight is thrown from (m, two adults): inside it he gives ground first
  const NEAR = { jab: 0.80, cross: 0.82, bodyStraight: 0.72, overhand: 0.88, butt: 0.85 };
  const _pk0 = { Ba: null, kind: null, att: null };
  const ZONE_MUL = { jaw: 1.3, head: 1.0, liver: 1.25, body: 0.8, legs: 0.6 };
  const FIST_R = 0.05;                      // m: the striking surface (knuckles, elbow point, shin)
  /* WEAPONS: what a held thing adds to a blow. len = how far past the hand
     the striking part sits (the contact point is carried out along the
     forearm by it), force = how much more of the swing arrives (a bat's head
     is moving and heavy; a knife adds nothing to the push, it cuts). The
     caller's opts.weapon may carry its own len/force; kind picks the row. */
  const WEAPON = {
    bat:   { len: 0.55, force: 1.6, r: 0.06 },
    pipe:  { len: 0.45, force: 1.5, r: 0.05 },
    club:  { len: 0.45, force: 1.5, r: 0.05 },
    baton: { len: 0.42, force: 1.35, r: 0.04 },
    knife: { len: 0.14, force: 1.0, r: 0.02, blade: true },
    shank: { len: 0.10, force: 1.0, r: 0.02, blade: true },
    rifle: { len: 0.30, force: 1.4, r: 0.06 },
  };
  function weaponRow(w) {
    if (!w) return null;
    const row = WEAPON[w.kind] || null;
    return {
      len: w.len != null ? w.len : row ? row.len : (w.blade ? 0.12 : 0.3),
      force: w.force != null ? w.force : row ? row.force : (w.blade ? 1 : 1.3),
      r: row ? row.r : 0.04,
    };
  }
  function kindOf(kind) {
    if (kind === "kick" || kind === "teep" || kind === "pushKick") return "front";
    if (kind === "roundKick" || kind === "roundhouse") return "round";
    if (kind === "lowKick") return "low";
    if (kind === "uppercut") return "upper";
    if (kind === "batSwing") return "bat";
    if (kind === "knifeSlash") return "slash";
    if (kind === "rifleButt") return "butt";
    if (!kind || kind === "straight") return "cross";
    return kind;
  }
  function isKick(k) { return k === "front" || k === "round" || k === "low" || k === "knee" || k === "stomp" || k === "soccer"; }
  function isFloorKick(k) { return k === "stomp" || k === "soccer"; }
  V.powerOf = function (kind) { return POWER[kindOf(kind)] || 0.6; };
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
      heavy: false, weapon: null, stagger: false, strike: null,
      parried: false, guardBroken: false, ko: false, force: 0, counter: false, blind: false };
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
      // (ON the skull, and a fist's length off it: the WRIST is what is sent
      // to the aim, and the fist is 11 cm of hand past it. Sent to a point
      // inside the head, as it was, every mounted punch ended 7 cm in his face.)
      out.copy(Z.head.c); out.y += Z.head.r * 0.9 + 0.11 * (Z.scale / 0.7);
      const dx = from.x - out.x, dz = from.z - out.z, d = Math.hypot(dx, dz) || 1;
      out.x += (dx / d) * Z.head.r * 0.45; out.z += (dz / d) * Z.head.r * 0.45;
      return out;
    }
    if (level === "floor") {
      // the middle of his trunk where it lies, whichever way up: a stomp
      // comes down on its upper surface, a soccer kick goes into the side
      // of it that faces the kicker
      out.copy(Z.cA).add(Z.dA).add(Z.cB).add(Z.dB).multiplyScalar(0.25);
      // (ON the trunk, not in it: the sole on its top, the instep on its side)
      if (kind === "stomp") { out.y += Z.chestR * 0.95; return out; }
      const dx = from.x - out.x, dz = from.z - out.z, d = Math.hypot(dx, dz) || 1;
      out.x += (dx / d) * Z.chestR * 1.3; out.z += (dz / d) * Z.chestR * 1.3;
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
    /* RANGE, BOTH WAYS. A blow used to step IN to its range and never out:
       after a hook or a knee had closed the two men up, the next kick was
       thrown chest to chest, the leg folded between them. A long kick is
       thrown from its own distance: closer than that the striker takes the
       ground back first (a step back on his feet, the same root-and-feet
       step as the lunge, reversed), and with a wall behind him or too much
       to make up he throws the knee, which is the kick that belongs there.
       A straight punch has a near limit too (NEAR): inside it he gives a
       short step back so the arm has room to go out. */
    let aim0 = tgt || null;
    if (!aim0 && opts.candidates) { _pk0.Ba = Ba; _pk0.kind = kind; _pk0.att = att; aim0 = pickAim(_pk0, opts); _pk0.Ba = _pk0.att = null; }
    let backD = 0;
    if (aim0 && opts.lunge !== false && Ba.pos) {
      const Bt0 = bod(aim0), tp0 = opts.aimAt || (Bt0 && Bt0.pos), ap0 = Ba.pos;
      const floorK = isFloorKick(kind);
      const long = kind === "front" || kind === "round" || kind === "low" || floorK;
      const sc0 = ch ? scaleOf(ch) / 0.7 : 1;
      const want0 = long ? V.reachOf(kind, att) * 0.92 : (NEAR[kind] || 0) * sc0;
      if (tp0 && want0 > 0) {
        const dx0 = tp0.x - ap0.x, dz0 = tp0.z - ap0.z, d0 = Math.hypot(dx0, dz0) || 1e-4;
        const back = want0 - d0;
        if (back > (long ? 0.08 : 0)) {
          const cap = long ? 0.55 : 0.30, y0 = (ap0.y || 0) + 0.6, far = Math.min(back, cap) + 0.4;
          const shut = walled(ap0.x, y0, ap0.z, ap0.x - dx0 / d0 * far, y0, ap0.z - dz0 / d0 * far);
          if (long && !floorK && (shut || back > cap) && d0 < 0.95 * sc0) kind = "knee";
          else if (!shut) backD = Math.min(back + (long ? 0 : 0.08), cap);
        }
      }
    }
    const kick = isKick(kind);
    const S = getSt();
    S.on = true; S.id = ++serial;
    S.att = att; S.tgt = tgt || null; S.Ba = Ba; S.kind = kind; S.kick = kick;
    S.heavy = !!opts.heavy; S.weapon = opts.weapon || null; S.opts = opts;
    S.wrow = weaponRow(S.weapon);
    S.level = MP.levelOf(kind);
    S.arm = opts.arm || (ch ? (kick ? MP.legFor(ch, kind) : MP.armFor(ch, kind)) : "r");
    const gas = ch ? clamp01(ch.winded || 0) : 0;
    S.dur = MP.durOf(kind, S.heavy) * (1 + 0.25 * gas) * (opts.speed ? 1 / opts.speed : 1);
    S.power = clamp01((opts.power != null ? opts.power : (POWER[kind] || 0.6) + (S.heavy ? 0.18 : 0)) * (1 - 0.35 * gas));
    S.t = 0; S.p = 0; S.landed = false; S.whiffed = false; S.aimLocked = false; S.hasAim = false; S.beat = false;
    S.lastPT = -1; S.stall = 0; S.walled = false; S.turn = 0; S.faceYaw = null; S.pvOk = false; S._hd = 0; S._hOn = false;
    S.rng = opts.rng || Math.random;
    // opts.aimErr (m): how far off the line this hand throws (a novice ~0.1,
    // a pro ~0.02); lateral and vertical, fixed for the blow
    S.ex = 0; S.ey = 0;
    if (opts.aimErr > 0) {
      const u = S.rng() * TAU, rr = opts.aimErr * Math.sqrt(S.rng()) * 1.4;
      S.ex = Math.cos(u) * rr; S.ey = Math.sin(u) * rr * 0.8;
    }
    S.lunge.D = 0; S.lunge.last = 0;
    S.rng = opts.rng || Math.random;
    const res = S.res;
    res.landed = false; res.blocked = false; res.slipped = false; res.zone = null; res.dmgMul = 1;
    res.parried = false; res.guardBroken = false; res.ko = false; res.force = 0; res.counter = false; res.blind = false;
    res.reaction = "none"; res.stagger = false; res.kind = kind; res.heavy = S.heavy;
    res.weapon = S.weapon; res.attacker = att; res.target = null; res.power = S.power; res.strike = S;
    // the player swings at whoever is in front: pick the aim among the candidates
    S.aimT = aim0;
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
      const Bt = bod(T), tp = opts.aimAt || (Bt && Bt.pos), ap = Ba.pos;
      if (tp && ap) {
        const dx = tp.x - ap.x, dz = tp.z - ap.z, d = Math.hypot(dx, dz) || 1e-4;
        /* HE TURNS TO FACE HIM, HE IS NOT TURNED. The root used to be put
           85% of the way round on the frame the blow began: up to 60
           degrees in one frame, the whole body spun like a figure on a
           pole. He turns at the rate a man pivots (stepStrike, TURN_RATE)
           while the blow winds up; the fist or foot is aimed at a point in
           the world, so it goes to the man whether or not the chest has
           finished coming round, and the feet are planted feet that step
           round after him. snap >= 1 still faces at once (a caller that
           has already placed him), snap 0 does not turn him at all. */
        const snap = opts.snap != null ? opts.snap : 0.85;
        if (snap >= 1) Ba.face(Math.atan2(dx, dz), 1);
        else if (snap > 0) S.turn = 1;
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
          if (tch0 && tch0.parts && S.level !== "legs" && !kick) {   // (a kick goes to the body: his chin is not its range)
            const Z = zonesOf(tch0);
            const fwd = -((Z.jaw.c.x - tp.x) * dx + (Z.jaw.c.z - tp.z) * dz) / d;
            chin = Math.max(0, 0.20 * (scaleOf(tch0) / 0.7) - fwd);
          }
          /* A KICK IS THROWN OFF A FOOT THAT IS ON THE FLOOR. The step and
             the kick used to start on the same frame: the standing foot was
             in the air making the step while the kicking foot was already
             coming up to the chamber, and the root slid the whole distance
             (up to 0.75 m in a quarter of a second) with nothing under it.
             The step is taken first, at a step's pace for its length; the
             kick's own clock starts as the standing foot comes down
             (ch.kickT above its duration is the wait: meleeposes and the
             contact pass both read that as "not begun"), and the hips are
             still arriving over that foot when the leg goes out. */
          const kickWait = function (stepT, share) {
            if (!kick) return;
            ch.kickT = S.dur + stepT * share;
          };
          if (backD > 0.03) {
            // too close for this blow: the rear foot goes back first and the root follows
            S.lunge.D = backD; S.lunge.dx = -dx / d; S.lunge.dz = -dz / d; S.lunge.last = 0;
            const stepT = kick ? 0.20 + 0.30 * backD : S.dur * 0.5;
            const fs0 = MP.startStep(ch, 0, -backD / scaleOf(ch), stepT, MP.leadSide(ch) === "l" ? "R" : "L");
            fs0.world = true; fs0.wx = -dx / d * backD / scaleOf(ch); fs0.wz = -dz / d * backD / scaleOf(ch);
            kickWait(stepT, 0.9);                                 // both feet are back and down
          }
          const need = backD > 0.03 ? 0 : d + Math.max(0, pend) + chin - V.reachOf(kind, att) * 0.92;
          const maxL = opts.maxLunge != null ? opts.maxLunge : (Ba.isPlayer ? 0.75 : 0.45);
          const D = Math.max(0, Math.min(maxL, need));
          if (D > 0.03 && !walled(ap.x, (ap.y || 0) + 1.2, ap.z, tp.x, (tp.y || 0) + 1.2, tp.z)) {
            S.lunge.D = D; S.lunge.dx = dx / d; S.lunge.dz = dz / d; S.lunge.last = 0;
            const lead = MP.leadSide(ch) === "l" ? "L" : "R";
            // the lead foot goes first; the root arrives by the impact beat
            const stepT = kick ? 0.22 + 0.30 * D : S.dur * 0.62;
            const fs1 = MP.startStep(ch, 0, D / scaleOf(ch), stepT, lead);
            // (the step is a line on the floor: the root is still turning to face him as it is taken)
            fs1.world = true; fs1.wx = dx / d * D / scaleOf(ch); fs1.wz = dz / d * D / scaleOf(ch);
            kickWait(stepT, 0.5);                                 // the lead foot has landed (meleeposes: s1 is down by 0.55)
          }
        }
      }
    }
    if (!T && opts.faceYaw != null) { S.turn = 1; S.faceYaw = opts.faceYaw; }
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
    // (opts.faceYaw: where he is LOOKING, when the body has not turned there yet)
    const Ba = S.Ba, ap = Ba.pos, yaw = opts.faceYaw != null ? opts.faceYaw : Ba.yaw();
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
    res.zone = zone; res.target = c;
    res.point.copy(P); res.dir.x = dx; res.dir.z = dz;
    // HOW MUCH ARRIVES (see CONDITION): the swing, the bodies, the moment
    const F = forceOf(S, c, Bt, dx, dz);
    res.force = F;
    const tc = condOf(c);
    if (blocked) {
      // THE GUARD: raised in the last beat before the blow it is a PARRY (the
      // blow is turned aside and the thrower is left open); held, it takes it
      // on the forearms and pays for it; a guard with nothing left in it caves
      const tch = Bt.ch;
      if (!S.kick && tch && tch.blockAt != null && clock - tch.blockAt <= PARRY_T) {
        res.parried = true;
        const oc = condOf(S.att);
        oc.openT = Math.max(oc.openT, 0.55);
      } else {
        tc.gst -= F * GUARD_COST;
        if (tc.gst < 0) {
          tc.gst = 0.15; blocked = false; res.guardBroken = true;
          if (tch) { tch.blockT = 0; tch.blockK = Math.min(tch.blockK || 0, 0.3); }
        }
      }
    }
    res.landed = !blocked; res.blocked = !!blocked;
    res.dmgMul = (ZONE_MUL[zone] || 1) * (res.parried ? 0 : blocked ? 0.2 : res.guardBroken ? 0.6 : 1);
    res.stagger = !blocked && (F >= 0.72 || S.power >= 0.72) && zone !== "legs";
    if (blocked) res.reaction = "block";
    else if (S.kind === "shove") res.reaction = "stagger";
    else res.reaction = bodyAnswer(S, c, tc, zone, F, res);
    S.landed = true;
    // the attacker's rig stops ON him (or bounces off the guard)
    const ch = Ba.ch;
    if (ch) {
      if (S.kick) { ch.kickLandP = S.p; ch._mKLandE = MP.kickDrive ? MP.kickDrive(S.p) : Math.sin(clamp01((S.p - 0.22) / 0.5) * Math.PI); }
      else {
        ch.punchLandP = S.p; ch._mLandD = MP.drive(S.p);
        if (blocked) ch.punchT = Math.min(ch.punchT, ch.punchDur * (1 - (MP.BEAT.bounce || MP.BEAT.recover)));
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
    // no human rig (an animal): no human fall to play, and a `ko` stamped on
    // it would never wear off (nothing tracks a rigless fall) and blind it
    // for good. The caller's damage is the whole answer.
    else if (!tch) { /* the caller owns it */ }
    else if (r === "block") {
      if (tch) { tch.blockT = Math.max(tch.blockT || 0, 0.3); tch.blockHitT = 0.2; }
      if (res.parried) {
        // turned aside: HIS arm is thrown wide and his weight goes past you —
        // a half step and an open beat (condition.openT) the other man can use
        V.react(S.att, { zone: "body", reaction: "stagger", stagger: true, power: 0.35, dir: { x: res.dir.x, z: res.dir.z }, mass: 0.6 });
      } else if (Bt.pos && !Bt.isPlayer) {
        // the forearms took it, the feet pay for it: a short step back along the blow
        stepAlong(c, Bt, tch, res.dir.x, res.dir.z, (0.05 + 0.13 * res.power) * mass, 0.26);
      }
    } else if (r === "knockdown") {
      condOf(c).downs++;
      V.knockdown(c, { dir: res.dir, ko: !!res.ko, power: res.power,
        dur: res.ko ? KO_MIN + (KO_MAX - KO_MIN) * S.rng() : 0.9 + 0.8 * S.rng() });
    } else if (r === "kneel") {
      // the leg is gone under him: down onto that knee for a count
      condOf(c).downs++;
      V.knockdown(c, { variant: "kneel", side: _legSide === "R" ? 1 : -1, dir: res.dir, ko: false, dur: 1.0 + 0.6 * S.rng() });
    } else {
      // a liver shot he takes standing folds him like any body shot; only
      // the one that drops him is the liver reaction
      V.react(c, { zone: res.zone === "liver" && r !== "liver" ? "body" : res.zone, kind: S.kind, arm: S.arm, dir: res.dir, power: res.power, stagger: res.stagger || r === "stagger", reaction: r, legSide: _legSide, mass: mass, heavy: S.heavy });
    }
    if (!res.blocked) {
      // the ledger (island modes) and the blade
      if (CBZ.trauma && CBZ.trauma.strike) {
        try {
          CBZ.trauma.strike(c, 3 + 7 * res.power, { dir: { x: res.dir.x, y: 0.3, z: res.dir.z }, fromX: S.Ba.pos.x, fromZ: S.Ba.pos.z,
            y: res.point.y - ((Bt.pos && Bt.pos.y) || 0), zone: res.zone, flesh: S.kind === "shove" ? 0.2 : 1 });
        } catch (e) { /* trauma off in this mode */ }
      }
      if (S.weapon && S.weapon.blade && CBZ.bodyWound) {
        // at the point the blade went in (no fromX: that bias drags a real
        // contact point 45 cm toward the attacker and scatters it)
        try { CBZ.bodyWound(c, res.point, { melee: "blade", cal: 0.7, dir: { x: res.dir.x, y: 0, z: res.dir.z } }); } catch (e) { /* wounds off */ }
      }
      // the blood a landed blow throws (gore.js goreBlow: what was already
      // wet on him there, and off the fist or blade that swung)
      if (CBZ.goreBlow) CBZ.goreBlow(c, S.att, res.point, { dir: res.dir, dy: 0.35, force: res.force, zone: res.zone, blade: !!(S.weapon && S.weapon.blade) });
      // you beat him to the punch: whatever he was throwing is gone
      const his = strikeOf(c);
      if (his) finish(his, true);
      if (tch && (r !== "block")) { tch.punchT = 0; tch.kickT = 0; }
    }
  }
  /* ============================================================
     CONDITION — what the fight has done to a body so far, and what a blow
     does to it. Before this a blow's outcome was its zone and a dice roll
     (22% of clean power shots to the jaw were a knockdown, whoever threw
     them and whoever took them): a gassed welterweight's arm punch dropped
     a fresh heavyweight as often as the reverse, nobody was ever "rocked",
     and a man could take forty body shots without his hands coming down.

     FORCE (res.force, ~0..2): the swing's power x how much body is behind
     it (sqrt of the mass ratio) x how fresh the arm is x the moment it met
     him — walking INTO a shot while throwing your own (COUNTER x1.35) or
     never seeing it come (BLIND, from the side or behind, x1.25: nothing
     braced, the head is loose on the neck) — x what is in the hand.

     THE BODY KEEPS THREE SHORT-TERM NUMBERS (a._mcond, V.condition(a)):
       daze  the head's: rocked. A clean one to the CHIN over his chin's
             tolerance switches him off (KO); a man already rocked goes down
             for a count off a good one (flash knockdown) and covers up.
             Wears off ~0.05/s. Where systems/vitals.js is loaded it is the
             authority on knockouts (the game's caller asks it); here the
             default never knocks a man OUT, only down.
       wind  the body's: every body shot takes breath and stamina; a liver
             shot that lands hard, or one more on a man with none left,
             drops him to a knee (the delayed fold every fighter knows).
       legs  the thighs': low kicks stack; past the line the leg goes and he
             drops onto that knee.
     plus gst, the GUARD's own stamina: every blow taken on the forearms
     costs it, and a guard with nothing left caves (res.guardBroken: the blow
     lands at 60%), and openT, the beat after a PARRY when he is wide open.
     ============================================================ */
  const PARRY_T = 0.2;          // s: a guard raised this close before the blow turns it aside
  const GUARD_COST = 0.32;      // guard stamina per unit of force taken on the forearms
  const KO_MIN = 6, KO_MAX = 14;
  function chinOf(a) {
    if (a && a.chin > 0) return a.chin;
    let c = 0.85 + 0.3 * (a && a._chinRoll != null ? a._chinRoll : Math.random());
    const r = a && a.ratings;
    if (r && r.toughness > 0) c *= 0.8 + r.toughness / 250;
    const m = massOf(a) / 80;
    c *= Math.pow(m < 0.4 ? 0.4 : m > 2.5 ? 2.5 : m, 0.25);
    try { a.chin = c; } catch (e) { /* frozen adapter */ }
    return c;
  }
  function condOf(a) {
    const o = isPlayer(a) ? (CBZ.player || a) : a;
    // `_mcond`, not `_mc`: NPC War's morale stamps `_mc = 1` ("counted") on
    // every man, and writing `.live` onto that number threw inside stepMan,
    // which aborted the whole sim sub-step: every fist fight froze solid.
    let c = o._mcond;
    if (!c) c = o._mcond = { daze: 0, wind: 0, legs: 0, gst: 1, openT: 0, downs: 0, chin: chinOf(o), live: false };
    if (!c.live) { c.live = true; conds.push(c); }
    return c;
  }
  // the records that are still wearing off, decayed by the pass's own dt
  // (never by differences of an absolute clock: those round differently
  // depending on how long the page has been up, and a seeded fight replays)
  const conds = [];
  function decayConds(dt) {
    for (let i = conds.length - 1; i >= 0; i--) {
      const c = conds[i];
      c.daze = Math.max(0, c.daze - 0.05 * dt);
      c.wind = Math.max(0, c.wind - 0.10 * dt);
      c.legs = Math.max(0, c.legs - 0.04 * dt);
      c.gst = Math.min(1, c.gst + 0.22 * dt);
      c.openT = Math.max(0, c.openT - dt);
      if (!c.daze && !c.wind && !c.legs && c.gst >= 1 && !c.openT) { c.live = false; conds.splice(i, 1); }
    }
  }
  V.condition = function (a) {
    if (!a) return null;
    const c = condOf(a);
    // the head's truth lives in vitals where a game keeps it
    const VT = CBZ.vitals;
    if (VT && VT.daze) { try { const d = VT.daze(isPlayer(a) ? CBZ.player : a); if (d > c.daze) c.daze = d; } catch (e) { /* no record */ } }
    return c;
  };
  function staminaOf(a) {
    const F = a && a._vfS;
    if (F && F.stam != null) return F.stam;
    const B = bod(a), ch = B && B.ch;
    return 1 - clamp01((ch && ch.winded) || 0);
  }
  function forceOf(S, c, Bt, dx, dz) {
    const res = S.res;
    let F = S.power * Math.sqrt(massRatio(S.att, c)) * (0.7 + 0.3 * staminaOf(S.att));
    // he was throwing: his weight was coming forward into it
    const his = strikeOf(c);
    res.counter = !!(his && his.p > 0.08 && his.p < 0.62 && !his.landed);
    if (res.counter) F *= 1.35;
    // he never saw it: a blow from his side or back finds a loose neck
    const yaw = Bt.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw);
    res.blind = (-dx * fx - dz * fz) < 0.25;
    if (res.blind) F *= 1.25;
    if (S.wrow) F *= S.wrow.force;
    return F * (0.88 + 0.24 * S.rng());
  }
  // the default answer of the body to an unblocked blow (the caller's onLand
  // may overrule it). Writes res.ko for a knockout.
  function bodyAnswer(S, c, tc, zone, F, res) {
    const chin = tc.chin || 1;
    const vitals = !!(CBZ.vitals && CBZ.vitals.blunt);
    if (zone === "jaw" || zone === "head") {
      const jaw = zone === "jaw";
      tc.daze += F * (jaw ? 0.55 : 0.34) / chin;
      if (!vitals) {
        // THE BUTTON: a clean shot on the point of the chin past what this
        // chin can take, or one more on a man who is already out on his feet
        if ((jaw && F / chin >= 0.92) || tc.daze >= 1.0) { res.ko = true; tc.daze = 0.6; return "knockdown"; }
        // ROCKED: a good one on a man already rocked puts him down for a count
        if (tc.daze >= 0.55 && F >= 0.45 && S.rng() < 0.5 + 0.5 * (tc.daze - 0.55) / 0.45) return "knockdown";
      }
      return "snap";
    }
    if (zone === "liver" || zone === "body") {
      tc.wind += F * (zone === "liver" ? 0.55 : 0.32);
      // a body shot takes the breath: the stamina goes with it
      const tf = c && c._vfS;
      if (tf && tf.stam != null) tf.stam = Math.max(0, tf.stam - F * 0.12);
      if (tc.wind >= 1 || (zone === "liver" && F >= 0.85)) { tc.wind = 0.45; return "liver"; }
      return "fold";
    }
    if (zone === "legs") {
      tc.legs += F * 0.40;
      if (tc.legs >= 1) { tc.legs = 0.5; return "kneel"; }
      return "buckle";
    }
    return "stagger";
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
  const TURN_RATE = 7.5;   // rad/s: a man pivoting to face someone (60 degrees in 0.14 s)
  const moves = [];     // root motion riding a rig's footStep: { a, B, ch, D, dx, dz, last, on }
  let clock = 0;        // this pass's own seconds (the shot load bleeds on it)
  const falls = [];     // fallen actors whose ko timer the rig's get-up follows
  function update(dt) {
    frameN++;
    decayConds(dt);
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
      if (!fs || m.fs !== fs.gen || gone(m.ch)) { moves.splice(i, 1); continue; }
      const sr = MP.stepRoot(m.ch), dd = sr - m.last;
      m.last = sr;
      if (dd > 0) moveBy(m.B, m.dx * m.D * dd, m.dz * m.D * dd);
      if (!fs.on) moves.splice(i, 1);
    }
    for (let i = falls.length - 1; i >= 0; i--) {
      const F = falls[i], ch = F.B.ch, f = ch && ch.fall;
      if (!f || !f.on || F.a.dead || gone(ch)) {
        // he is back on his feet: a ko timer only this pass was counting ends
        // with the get-up (left over, it kept him "down" for good: B.down()
        // true, never hit again, his fighter never ticking)
        if (F.counted && !F.a.dead && F.a.ko > 0 && F.a.ko === F.lastKo) F.a.ko = 0;
        falls.splice(i, 1); continue;
      }
      if (F.B.isPlayer) continue;
      /* A BODY ON THE FLOOR STAYS WHERE IT FELL. A host whose own steering
         does not know about knockdowns (games/battle.html walks every man at
         his m.target each frame) slid a knocked-out man along the sand. The
         fall's own root motion (moves) and a verb that is moving him (a
         drag, a carry) are the only things allowed to move him now. */
      const fp = F.B.pos;
      if (fp) {
        let rooted = false;
        for (let k = 0; k < moves.length; k++) if (moves[k].a === F.a) { rooted = true; break; }
        // (a man dragging himself along the floor, systems/bodyfall.js drag, is moving himself)
        if (rooted || F.px == null || F.a._dragT > 0 || (typeof V.held === "function" && V.held(F.a))) { F.px = fp.x; F.pz = fp.z; }
        else {
          const ex = F.px - fp.x, ez = F.pz - fp.z;
          if (ex * ex + ez * ez > 4) { F.px = fp.x; F.pz = fp.z; }          // moved on purpose (a respawn, a teleport)
          else if (ex || ez) { fp.x = F.px; fp.z = F.pz; const g = F.B.ch && F.B.ch.group; if (g && g.position !== fp) { g.position.x = F.px; g.position.z = F.pz; } }
        }
      }
      if (F.noKo) continue;
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
    // ---- the turn to face him (see V.strike): a pivot's rate, until the blow has gone ----
    if (S.turn && ch && ch.group) {
      let want = S.faceYaw;
      const Tt = S.aimT, Btt = Tt ? bod(Tt) : null;
      const tq = S.level === "floor" && S.hasAim ? S.aim : (S.opts.aimAt || (Btt && Btt.pos));
      if (tq && Ba.pos) {
        const tdx = tq.x - Ba.pos.x, tdz = tq.z - Ba.pos.z;
        if (tdx * tdx + tdz * tdz > 0.01) want = Math.atan2(tdx, tdz);
      }
      if (want == null || p >= (S.kick ? MP.kickImpactP : MP.BEAT.impact) || S.landed) S.turn = 0;
      else {
        const cur = ch.group.rotation.y;
        let dy = (want - cur) % TAU;
        if (dy > Math.PI) dy -= TAU; else if (dy < -Math.PI) dy += TAU;
        const stp = TURN_RATE * dt;
        if (Math.abs(dy) <= stp) { Ba.face(want, 1); if (!tq) S.turn = 0; }
        else Ba.face(cur + (dy > 0 ? stp : -stp), 1);
      }
    }
    // ---- the aim: tracked through the wind-up, committed on the drive ----
    const T = S.aimT;
    if (T && ch && !S.landed) {
      const Bt = bod(T), tch = Bt && Bt.ch;
      if (tch && (!Bt.dead() || S.level === "floor")) {
        if (!S.aimLocked) {
          const Z = zonesOf(tch);
          aimPoint(Z, S.level, S.kind, S.arm, Ba.pos, S.aim);
          // an untrained hand does not go exactly where it was sent
          if (S.ex || S.ey) {
            const lx = S.aim.x - Ba.pos.x, lz = S.aim.z - Ba.pos.z, ll = Math.hypot(lx, lz) || 1;
            S.aim.x += (-lz / ll) * S.ex; S.aim.z += (lx / ll) * S.ex; S.aim.y += S.ey;
          }
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
      // a mark with no human rig (a gorilla, a bear) has no zones for the
      // fist to find: contact() would whiff every blow, so 100 men punching a
      // silverback never landed one. It is met on the beat, by distance.
      if (ch && !riglessMark(S)) contact(S, ch, MP);
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
    S._hd = 0; S._hOn = false;
    const Z = zonesOf(B.ch);
    // a raised guard takes it on the forearms
    const tch = B.ch;
    const guarding = (tch.blockK || 0) > 0.55;
    /* THE STANCE IS A GUARD TOO. A man squared up carries his fists at his
       eyes and his jaw with the elbows in: a blow that runs into those
       forearms is taken on them whether or not he "blocked". Only the real
       arms decide (forearmTouch on the live rig) — a hand that is out
       throwing, a guard sagging off a gassed man (the pose drops it), a
       head still snapping from the last one, are all open. */
    const stance = !guarding && tch.fightStance && (tch._mK || 0) > 0.6 && !(tch.punchT > 0) && !(tch.kickT > 0) && !(tch.dodgeT > 0) &&
      !(tch.hitReact && tch.hitReact.on && tch.hitReact.t < 0.35) && !((tch.winded || 0) > 0.7);
    /* THE BLOW MEETS THE PART IT TOUCHES (systems/humancontact.js
       CBZ.bodyParts: his drawn limbs, trunk and head as posed this frame).
       It used to be tested against zone spheres that are not his surface
       (the belly's stood 7 cm proud of his shirt, nothing at all covered an
       arm that was not "guarding") once a frame, so a fist moving 12 cm a
       frame was found up to 12 cm inside him and stopped THERE. The part
       says what was touched, how deep, and the surface point; contact()
       backs the limb out to that surface. The zones only NAME the result
       now (chin or skull, liver or ribs). An arm in the way is met first:
       it is a block if he is guarding, and a blow on the arm if he is not. */
    const BP = CBZ.bodyParts;
    let zone;
    if (BP && BP.strikeHit) {
      // (the whole striking segment, not only its point: a round kick's foot
      // wrapping round his guard, a forearm crossing a forearm, are contacts)
      const h = BP.strikeHit(tch, S.Ba && S.Ba.ch, strikeSegs(S), P.x, P.y, P.z, r, HIT_SKIN);
      if (!h) return null;
      const pi = h.part;
      _w.set(h.sx, h.sy, h.sz);
      if (pi === 2) { const jr = Z.jaw.r + r; zone = _w.distanceToSquared(Z.jaw.c) <= 2.1 * jr * jr ? "jaw" : "head"; }
      else if (pi <= 1) { const lr = Z.liver.r + r; zone = _w.distanceToSquared(Z.liver.c) <= lr * lr ? "liver" : "body"; }
      else if (pi <= 6) {
        if (S.level === "legs") { _legSide = pi <= 4 ? "L" : "R"; zone = "legs"; }       // a hand hanging by the thigh: the kick goes on into the leg
        else zone = guarding || (stance && S.level === "head") ? "block" : "body";
      }
      else { _legSide = (pi === 7 || pi === 8 || pi === 11) ? "L" : "R"; zone = "legs"; }
      S._hOn = true; S._hd = Math.max(0, h.depth); S._hnx = h.nx; S._hny = h.ny; S._hnz = h.nz; S._hsx = h.sx; S._hsy = h.sy; S._hsz = h.sz;
      if (zone === "block") return zone;
    } else {
      // (a page without the part solver: the old spheres)
      if ((guarding || (stance && S.level === "head")) && S.level !== "legs" && forearmTouch(Z, P, r)) return "block";
      zone = hitZone(Z, P, r, S.level === "legs");
    }
    // a head moving off the line that the fist only finds at the rim of the
    // skull: it slides off — that is what a slip is
    if (zone === "head" && tch.dodgeT > 0) {
      const lim = 0.78 * (Z.head.r + r);
      if (P.distanceToSquared(Z.head.c) > lim * lim) return null;
    }
    return zone;
  }
  const _el = new THREE.Vector3();
  // the attacker's own parts that carry this blow (systems/humancontact.js
  // PART order: 3/5 upper arms, 4/6 forearm + fist, 7/9 thighs, 8/10 shins,
  // 11/12 feet, 2 head; the first of each pair is his left)
  function strikeSegs(S) {
    const L = S.arm === "l";
    switch (S.kind) {
      case "front": case "stomp": return 1 << (L ? 11 : 12);
      case "round": case "low": case "soccer": return (1 << (L ? 8 : 10)) | (1 << (L ? 11 : 12));
      case "knee": return 1 << (L ? 7 : 9);
      case "headbutt": return 4;
      case "elbow": case "gnpElbow": return (1 << (L ? 3 : 5)) | (1 << (L ? 4 : 6));
      case "shove": return (1 << 4) | (1 << 6);
      default: return 1 << (L ? 4 : 6);
    }
  }
  const HIT_SKIN = 0.015;   // m: how near a surface counts as touching it (the limb is backed out by the same)
  function contact(S, ch, MP) {
    MP.strikePoint(ch, S.kind, S.arm, _v);
    const drv = S.kick ? (MP.kickDrive ? MP.kickDrive(S.p) : 1) : MP.drive(S.p);
    S._hd = 0; S._hOn = false;
    let r = FIST_R * (scaleOf(ch) / 0.7) * (S.kick ? 1.3 : 1);
    if (S.wrow && !S.kick && S.wrow.len > 0) {
      // the weapon meets him, not the hand: carry the point out along the
      // forearm (elbow -> wrist) by the weapon's length
      const low = S.arm === "l" ? ch.low && ch.low.la : ch.low && ch.low.ra;
      if (low) {
        low.getWorldPosition(_el);
        _w.subVectors(_v, _el);
        const l = _w.length();
        if (l > 1e-4) _v.addScaledVector(_w, S.wrow.len * (scaleOf(ch) / 0.7) / l);
      }
      r = Math.max(r, S.wrow.r);
    }
    let hit = null, zone = null;
    if (S.tgt) { zone = testTarget(S, S.tgt, _v, r); if (zone) hit = S.tgt; }
    else if (S.opts.candidates) {
      if (!CAND.length) { try { S.opts.candidates(CAND); } catch (e) { CAND.length = 0; } }
      // the aimed man first, then anybody else the swing passes through
      if (S.aimT) { zone = testTarget(S, S.aimT, _v, r); if (zone) hit = S.aimT; }
      for (let i = 0; !hit && i < CAND.length; i++) { zone = testTarget(S, CAND[i], _v, r); if (zone) hit = CAND[i]; }
      CAND.length = 0;
    }
    if (!hit) { S.pvx = _v.x; S.pvy = _v.y; S.pvz = _v.z; S.pd = drv; S.pvOk = true; return; }
    /* IT STOPS AT HIS SURFACE. The limb is found S._hd inside the part on
       this frame; last frame it was outside, at drive S.pd. How far the
       striking point moves per unit of drive is known from those two
       frames, so the drive at which it first touched is solved, and that is
       where the limb is held (meleeposes: _mLandD / _mKLandE). The point
       the blow is resolved at is the point on his surface. (This frame's
       pose is put right by the part pass, which pushes the hand or foot
       out and re-solves the limb.) */
    let landD = -1;
    if (S._hOn) {
      if (S._hd > 0 && S.pvOk && drv > S.pd + 1e-4) {
        const sp = Math.hypot(_v.x - S.pvx, _v.y - S.pvy, _v.z - S.pvz) / (drv - S.pd);
        if (sp > 1e-3) landD = Math.max(S.pd, drv - S._hd / sp);
      }
      _v.set(S._hsx, S._hsy, S._hsz);
    }
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
    if (S._hOn && S.landed && CBZ.bodyParts) {
      if (landD >= 0) { if (S.kick) ch._mKLandE = landD; else ch._mLandD = landD; }
      CBZ.bodyParts.count("strike");
    }
  }
  function riglessMark(S) {
    const T = S.aimT;
    if (!T) return false;
    const B = bod(T);
    return !!(B && B.pos && !B.ch);
  }
  // no rig posed (far, culled), or a mark with none: the beat decides by distance
  function virtualContact(S) {
    const T = S.aimT;
    if (!T) { whiff(S); return; }
    const Bt = bod(T);
    if (!Bt || !Bt.pos || Bt.dead() || Bt.down()) { whiff(S); return; }
    const ap = S.Ba.pos;
    const d = Math.hypot(Bt.pos.x - ap.x, Bt.pos.z - ap.z);
    // a body wider than a man is reached at its hide, not its middle
    const extra = Bt.ch ? 0 : Math.max(0, (T.rad || 0.45) - 0.45);
    if (d > V.reachOf(S.kind, S.att) + 0.1 + extra) { whiff(S); return; }
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
  V.block = function (a, dur, held) {
    const B = bod(a), ch = B && B.ch;
    if (!ch || B.down()) return false;
    // the moment the hands come UP is what a parry is timed off (a guard
    // already held is not raised again by holding it). held: the hands were
    // up already (a cover rolled by a game, not a read): never a parry.
    if (held) ch.blockAt = -9;
    else if (!(ch.blockT > 0) && !((ch.blockK || 0) > 0.3)) ch.blockAt = clock;
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
  /* A MAN WHO IS KNOCKED BACK STEPS WHERE THERE IS FLOOR. A stagger, a reel,
     a shove all take their step straight along the blow, and the root goes
     with it: into whoever stands or lies there. The part pass put him back
     out, the next frame of the step put him back in, for the length of the
     step (two or three root pushes a frame, ~280 limb re-solves, 2-7 cm
     left). The step is chosen ONCE, before it is taken: along the blow if
     the place it ends is clear; else turned 30 or 60 degrees to either
     side, the first that is; else a quarter of the length. Clear = not
     nearer than 62 cm to another man than he already is, and nobody lying
     under it. (Feet and root still move on the one curve: nothing is
     corrected mid-step.) */
  const _cs = { dx: 0, dz: 0, D: 0 };
  function clearStep(ch, p, dx, dz, D) {
    _cs.dx = dx; _cs.dz = dz; _cs.D = D;
    const BP = CBZ.bodyParts;
    if (!ch || !p || !BP || !BP.near || !BP.near(ch) || !ch._bpN || !BP.topAt) return _cs;
    const fy = p.y || 0;
    for (let k = 0; k < 6; k++) {
      let ex = dx, ez = dz, dd = D;
      if (k === 5) dd = D * 0.25;
      else if (k > 0) {
        const a = (k & 1 ? 1 : -1) * 0.55 * ((k + 1) >> 1), ca = Math.cos(a), sa = Math.sin(a);
        ex = dx * ca + dz * sa; ez = -dx * sa + dz * ca;
      }
      const qx = p.x + ex * dd, qz = p.z + ez * dd;
      let ok = true;
      for (let n = 0; n < (ch._bpNn || 0) && ok; n++) {
        const o = ch._bpN[n];
        if (!o || !o.group || o.group.visible === false) continue;
        const g = o.group.position;
        const d1 = Math.hypot(qx - g.x, qz - g.z), d0 = Math.hypot(p.x - g.x, p.z - g.z);
        if (d1 < 0.62 && d1 < d0 - 0.01) ok = false;
      }
      if (ok && BP.topAt(ch, qx, qz) > fy + 0.06) ok = false;
      if (ok || k === 5) { _cs.dx = ex; _cs.dz = ez; _cs.D = dd; return _cs; }
    }
    return _cs;
  }
  function stepAlong(a, B, ch, dx, dz, D, dur) {
    const MP = MPf();
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    if (ch && B.pos) { clearStep(ch, B.pos, dx, dz, D); dx = _cs.dx; dz = _cs.dz; D = _cs.D; }
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
  /* A BODY THAT LEFT THE WORLD LEAVES THESE LISTS. A rig whose group is no
     longer attached to anything (the disaster island's crowd is dropped whole
     at every new match; a pooled actor is parked) never finishes its fall or
     its step: its footStep / fall stay "on" forever, so falls[], moves[] and
     reels[] kept every bot knocked down at a match's end, its rig and brain
     with it, match after match (tools/probes/disaster-leak.mjs: falls[49],
     moves[95] by the seventh match). */
  function gone(ch) { const g = ch && ch.group; return !g || !g.parent; }
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
      if (r.B.dead() || r.B.down() || r.n <= 0 || gone(r.ch)) { reels.splice(i, 1); continue; }
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
    hr.shot = false; hr.tw = 0;
    // a real step to catch the weight: the foot on the side it is thrown to.
    // The heavier the man behind the blow, the further it carries; a heavy
    // shot that staggers him keeps him going for a second step.
    const mass = o.mass > 0 ? o.mass : 1;
    if (o.stagger && B.pos) {
      // (the step goes where there is floor: clearStep; the reaction's own lean stays along the blow)
      clearStep(ch, B.pos, dx, dz, (0.16 + 0.34 * power) * mass);
      const D = _cs.D, sdx = _cs.dx, sdz = _cs.dz;
      const slx = sdx * c - sdz * s, slz = sdx * s + sdz * c;
      const sc = scaleOf(ch);
      const lead = Math.abs(slx) > Math.abs(slz) ? (slx > 0 ? "L" : "R") : (MP.leadSide(ch) === "l" ? "R" : "L");
      const fs = MP.startStep(ch, slx * D / sc, slz * D / sc, 0.38 + 0.12 * power, lead);
      fs.gen = (fs.gen || 0) + 1;
      pushMove(t, B, ch, D, sdx, sdz, fs.gen);
      if ((o.heavy || power >= 0.9) && !B.isPlayer) reel(t, B, ch, sdx, sdz, 1, D * 0.55, 0.32);
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
      // o.travel (m): the ground his momentum carries him over as he goes down
      // (a man run into at a sprint is driven back, he does not drop on the spot)
      const D = o.travel > 0 ? o.travel : 0.15 + 0.25 * (o.power == null ? 0.7 : o.power);
      const fs = MP.startStep(ch, 0, 0, o.travel > 0.6 ? 0.6 : 0.45, "L");
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
         the root only ever travels along the round (plus his run). The
         SHOULDERS do turn: a round's line across the trunk (the hit point
         off his centre, crossed with the push) twists the trunk over the
         hips the way it went, and the reaction lasts as long as the hit was
         big (a 9 mm a beat, a rifle round longer).
       · ON THE FLOOR or GOING DOWN already: never a new reaction and never a
         restarted fall; the part it hit moves (the limp springs of a body
         out cold, MP.limpKick; a conscious man turns off it, MP.groundHit).
       · YOU: the same reaction on your own rig (no steps: your feet are
         yours), and a leg hit heavy enough takes you to that knee for as
         long as the knee is down (physics.js holds the stick only while the
         rig's fall is on). systems/capture.js hurtPlayer calls this.
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
      head: 0, torso: 0, armL: 0, armR: 0, legL: 0, legR: 0, load: 0, loadT: 0, tq: 0 });
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
    if (!t) return false;
    const B = bod(t), ch = B && B.ch, MP = MPf();
    if (!ch || !MP || !B.pos || B.dead() || !ch.parts || !ch.parts.la) return false;
    // a seated / carried / held body is somebody else's to move
    if (t._npcAttached || ch.sitting || (typeof V.held === "function" && V.held(t))) return false;
    if (B.isPlayer && CBZ.fps && CBZ.fps.active) return false;    // first person: the lens takes it (shake), not a pose
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
    // the twist it puts in the trunk: (r x F).y in his frame, r = the hit
    // point off his centre line, F = the round's push
    if (o.point && o.point.x != null && zone !== "legL" && zone !== "legR") {
      const yaw = B.yaw(), c = Math.cos(yaw), sn = Math.sin(yaw);
      const rx = (o.point.x - B.pos.x) * c - (o.point.z - B.pos.z) * sn;
      const rz = (o.point.x - B.pos.x) * sn + (o.point.z - B.pos.z) * c;
      const fx = dx * c - dz * sn, fz = dx * sn + dz * c;
      R.tq += (rz * fx - rx * fz) * e;
    }
    if (!R.queued) { R.queued = true; R.a = t; R.B = B; shotQ.push(R); }
    return true;
  };
  // the reaction on the rig: a bigger hit takes it over, a smaller one feeds
  // it, the same kind again holds it at its peak and grows it
  function shotReact(ch, B, kind, px, pz, amt, dur, side, tw) {
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
    hr.tw = Math.max(-0.45, Math.min(0.45, tw || 0));
  }
  function resolveShot(R, MP) {
    const t = R.a, B = R.B, ch = B && B.ch;
    const E = R.e;
    let dx = R.dx, dz = R.dz;
    let zone = "torso", ze = -1;
    for (let i = 0; i < ZN.length; i++) if (R[ZN[i]] > ze) { ze = R[ZN[i]]; zone = ZN[i]; }
    const body = R.torso + R.legL + R.legR + 0.5 * (R.armL + R.armR);
    const tq = R.tq;
    R.queued = false; R.a = null; R.B = null; R.e = 0; R.dx = 0; R.dz = 0; R.tq = 0;
    for (let i = 0; i < ZN.length; i++) R[ZN[i]] = 0;
    if (!ch || !(E > 0) || B.dead()) return;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    R.load = Math.max(0, R.load - (clock - R.loadT) * SHOT_DECAY) + body;
    R.loadT = clock;
    const noKo = !koMode();
    const f = ch.fall;
    const kk = E > 1.6 ? 1.6 : E;
    if (f && f.on) {
      // already on the knee: enough more and he goes all the way down
      if (f.variant === "kneel" && R.load >= SHOT_KD && !B.isPlayer) {
        R.load = 0;
        V.knockdown(t, { dir: { x: dx, z: dz }, power: Math.min(1, 0.45 + 0.3 * E), ko: false, dur: 1.2, noKo });
        return;
      }
      // going down or down: the part it hit moves, nothing restarts
      const yaw = B.yaw(), lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), fz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (f.ko && MP.limpKick) {
        const part = zone === "armL" ? "la" : zone === "armR" ? "ra" : zone === "legL" ? "rl" : zone === "legR" ? "ll" : zone === "head" ? "head" : "core";
        MP.limpKick(ch, part, lx >= 0 ? 1 : -1, 0.3 + 0.4 * kk, fz, tq * 8);
      } else if (MP.groundHit && f.phase === "down") MP.groundHit(ch, lx, 0.4 + 0.4 * kk);
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
    const k = kk;
    // the trunk's turn off the round's line (rad), bigger for a bigger round
    const tw = Math.max(-0.45, Math.min(0.45, tq * 1.6));
    if (B.isPlayer) {
      // YOU: the reaction on your rig, no steps (your feet are yours); a leg
      // hit heavy enough takes that knee for as long as it is down. Whether
      // you go to the floor is CBZ.vitals' call (capture.js floors you).
      if (legHit && E >= 1.15) { V.knockdown(t, { variant: "kneel", side: zone === "legR" ? 1 : -1, dir: { x: dx, z: dz }, ko: false, dur: 0.35 + 0.25 * Math.min(1, E - 1) }); return; }
      if (zone === "head") shotReact(ch, B, "snap", dx, dz, 0.6 + 0.5 * k, 0.5 + 0.2 * Math.min(1, k), null, 0);
      else if (zone === "armL" || zone === "armR") shotReact(ch, B, "arm", dx, dz, 0.6 + 0.4 * k, 0.9 + 0.3 * k, zone === "armL" ? "L" : "R", tw);
      else if (legHit) shotReact(ch, B, "buckle", dx, dz, 0.6 + 0.4 * k, 0.5 + 0.25 * k, zone === "legL" ? "L" : "R", 0);
      else shotReact(ch, B, "fold", dx, dz, 0.35 + 0.4 * k, 0.5 + 0.3 * k, null, tw);
      return;
    }
    if (R.load >= SHOT_KD || (legHit && (E >= SHOT_LEG_DOWN || mv > 0.5))) {
      R.load = 0;
      V.knockdown(t, { dir: { x: px, z: pz }, power: Math.min(1, 0.45 + 0.3 * E), ko: false, dur: 1.2, noKo });
      return;
    }
    if (legHit) {
      // that knee gives: down onto it, held about a second, then up
      V.knockdown(t, { variant: "kneel", side: zone === "legR" ? 1 : -1, dir: { x: dx, z: dz }, ko: false, dur: 0.8 + 0.3 * Math.min(1, E), noKo });
      return;
    }
    if (zone === "head") {
      shotReact(ch, B, "snap", dx, dz, 0.6 + 0.5 * k, 0.55 + 0.2 * Math.min(1, k), null, 0);
      if (E > 1) reel(t, B, ch, px, pz, 1, 0.12 + 0.08 * k, 0.28);
    } else if (zone === "armL" || zone === "armR") {
      shotReact(ch, B, "arm", dx, dz, 0.6 + 0.4 * k, 0.9 + 0.35 * k, zone === "armL" ? "L" : "R", tw);
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
      shotReact(ch, B, "stagger", px, pz, 0.6 + 0.4 * k, 0.45 + 0.2 * k, null, tw);
      reel(t, B, ch, px, pz, 1, 0.22 + 0.12 * k, 0.26);
    } else {
      // the torso: folds over it and reels back along the line, 1-3 steps;
      // the fold lasts as long as the round was big
      shotReact(ch, B, "fold", dx, dz, 0.35 + 0.4 * k, 0.55 + 0.35 * Math.min(1.2, k), null, tw);
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
    if (ch && ch._mStep) ch._mStep.on = false;
    if (ch) { ch.mount = false; ch._mountGo = false; ch._mountTop = null; ch._mountHalfW = 0; ch._mountR = 0; ch._mountOn = null; }
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
      /* HE GETS ON HIM, HE IS NOT SLID THROUGH HIM. The kneel used to begin
         the frame the button went down, while the root was still sliding
         across the floor to the seat. He walks to the seat, kneels when
         he is over it, and the first blow waits for that (stepMounts). */
      if (Ba.ch) { Ba.ch.mount = false; Ba.ch._mountGo = true; }
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
  /* ============================================================
     THE BOOT — a standing man's kicks at a man on the floor.
     There was no kick for him: a standing kick's contact test skips a
     downed body, so the only thing a man on his feet could do to one on
     the floor was get down on him. V.groundKick(att, tgt, opts) throws
       "stomp"   the knee comes up over him and the heel is driven down
                 onto his trunk with the weight behind it
       "soccer"  the leg swings back and through, low, into his side
     from where the kicker stands (he steps in or back to the range the
     leg needs, the same step a standing kick takes, measured to the SPOT
     on the body, not to its root). It resolves on its beat like the
     mounted blows, but only if the foot is actually at the spot then:
     kicked from too far, or at a man who has been dragged off, it is a
     miss. Not from the mount (you are kneeling on him). opts: kind,
     heavy, power, onLand(res), onWhiff(res), maxLunge, rng.
     ============================================================ */
  const _gk = new THREE.Vector3(), _gkp = new THREE.Vector3();
  V.groundKick = function (att, tgt, opts) {
    opts = opts || EMPTY;
    const MP = MPf(), Ba = bod(att), Bt = bod(tgt);
    if (!MP || !Ba || !Bt || !Bt.ch || !Ba.ch || !Bt.pos || !Ba.pos || Ba.dead() || Ba.down() || !Bt.down()) return null;
    if (!Bt.ch.body || !MP.KICKS || !MP.KICKS.stomp) return null;
    if (mountOf(att)) return null;
    const kind = opts.kind === "stomp" ? "stomp" : "soccer";
    aimPoint(zonesOf(Bt.ch), "floor", kind, null, Ba.pos, _gk);
    const d = Math.hypot(_gk.x - Ba.pos.x, _gk.z - Ba.pos.z);
    const maxL = opts.maxLunge != null ? opts.maxLunge : (Ba.isPlayer ? 0.75 : 0.45);
    if (d - V.reachOf(kind, att) * 0.92 > maxL + 0.12) return null;          // too far to step to: walk up first
    return V.strike(att, tgt, { kind, heavy: !!opts.heavy, power: opts.power, rng: opts.rng, maxLunge: maxL,
      aimAt: { x: _gk.x, y: _gk.y, z: _gk.z }, onWhiff: opts.onWhiff || null,
      onBeat: function (St) { floorKickLand(St, tgt, opts); } });
  };
  const _fkM = { t: null };
  const _mfs = { x: 0, z: 0 };
  function floorKickLand(S, tgt, opts) {
    const MP = MPf(), Ba = S.Ba, ch = Ba && Ba.ch, Bt = bod(tgt);
    if (!MP || !ch || !Bt || !Bt.pos) return;
    // is the foot there? (the leg is at full reach on this beat)
    MP.strikePoint(ch, S.kind, S.arm, _gkp);
    const tol = 0.26 * (scaleOf(ch) / 0.7);
    if (!S.hasAim || !Bt.down() || _gkp.distanceToSquared(S.aim) > tol * tol) { S.landed = false; whiff(S); return; }
    // it stops on him
    ch.kickLandP = S.p; ch._mKLandE = MP.kickDrive ? MP.kickDrive(S.p) : 1;
    if (CBZ.bodyParts) CBZ.bodyParts.count("strike");
    _fkM.t = tgt;
    groundLand(S, _fkM, opts);
    _fkM.t = null;
    // a body with nothing holding it up is moved by it
    const tch = Bt.ch, f = tch && tch.fall;
    if (f && f.on && f.ko && MP.limpKick && S.res) {
      const yaw = Bt.yaw(), lx = S.res.dir.x * Math.cos(yaw) - S.res.dir.z * Math.sin(yaw);
      MP.limpKick(tch, "core", lx >= 0 ? 1 : -1, 0.5 + 0.6 * S.res.power, S.kind === "stomp" ? 0 : 0.6, 0);
    }
  }
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
    res.reaction = "none"; res.stagger = false;
    if (opts.onLand) opts.onLand(res);
    if (!S.Ba) return;
    const bothP = Ba.isPlayer || Bt.isPlayer;
    V.hitstop(S.att, M.t, 0.035 + 0.05 * res.power, bothP);
    if (bothP && CBZ.shake) CBZ.shake(0.12 + 0.32 * res.power);
    if (Ba.isPlayer && CBZ.fpsPunchLanded) CBZ.fpsPunchLanded(S.kind, S.heavy || res.power > 0.8);
    const MP = MPf();
    if (tch && MP && MP.groundHit && !Bt.dead()) MP.groundHit(tch, S.arm === "l" ? 1 : -1, 0.55 + 0.6 * res.power, S.level === "floor");
    if (CBZ.trauma && CBZ.trauma.strike) {
      try {
        CBZ.trauma.strike(M.t, 3 + 7 * res.power, { dir: { x: res.dir.x, y: -0.6, z: res.dir.z }, fromX: Ba.pos.x, fromZ: Ba.pos.z,
          y: res.point.y - ((Bt.pos && Bt.pos.y) || 0), zone: res.zone, flesh: 1 });
      } catch (e) { /* trauma off in this mode */ }
    }
    if (CBZ.goreBlow) CBZ.goreBlow(M.t, S.att, res.point, { dir: res.dir, dy: -0.5, force: res.power, zone: res.zone, blade: !!(S.weapon && S.weapon.blade) });
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
      /* ON HIS TRUNK AS IT LIES. The seat was measured 0.38 m from the
         origin of his body group toward his head, and that origin is at
         his hip joints: the rider knelt across his pelvis with his knees
         in the man's thighs. It is taken off his drawn trunk instead
         (CBZ.bodyParts: pelvis end to shoulder end): the rider's hips are
         45% of the way up it, over the low ribs, his knees on the floor
         outside the trunk above the hips and below the arms' roots. */
      let bx0 = _mb.x, bz0 = _mb.z, along = 0.38 * s, seatW = 0, bodyOK = false, aMin = 0, aMax = 0;
      const BPm = CBZ.bodyParts, PT = BPm && BPm.partsOf ? BPm.partsOf(tch, 0) : null;
      if (PT && PT.ok) {
        const f = PT.f, px = (f[0] + f[7]) * 0.5, pz = (f[2] + f[9]) * 0.5;
        const dx = (f[3] + f[10]) * 0.5 - px, dz = (f[5] + f[12]) * 0.5 - pz, l = Math.hypot(dx, dz);
        if (l > 0.2) {
          ux = dx / l; uz = dz / l; bx0 = px; bz0 = pz;
          const rs = Ba.ch ? scaleOf(Ba.ch) : 0.7;
          // his trunk across the floor, and where the rider's knees come down beside it
          const halfW = Math.hypot(f[0] - f[7], f[2] - f[9]) * 0.5 + f[6];
          const kneeX = Math.max(0.39 * rs, halfW + 0.094 * rs / 0.7 + 0.015), kneeZ = 0.085 * rs / 0.7;
          /* ...CLEAR OF HIS ARMS. The seat starts 45% of the way up his
             trunk and comes down toward his hips until neither knee is on
             one of his arms as they lie (chosen while getting on, then
             kept: a seat that followed his arms would crawl). If no seat
             is clear the knee comes down on the arm: a limp one is moved
             aside and stays there (humancontact limpYield). */
          if (M.frac == null || M.slide < 1) {
            const fy = (Bt.pos.y || 0) + 0.09 * rs / 0.7;
            // (no lower than 0.38: sat nearer his hips, as it was allowed to be
            // when his arms lay along his ribs, the rider's shins lay across his thighs)
            let pick = 0.45;
            for (let q = 0; q < 2; q++) {
              const fr = 0.45 - 0.07 * q, cx = px + ux * (fr * l + kneeZ), cz = pz + uz * (fr * l + kneeZ);
              let ok = true;
              for (let sd = -1; sd <= 1 && ok; sd += 2) {
                const kx0 = cx + uz * kneeX * sd, kz0 = cz - ux * kneeX * sd;
                for (let a = 3; a <= 6 && ok; a++) {
                  const o = a * 7, ex = f[o + 3] - f[o], ey = f[o + 4] - f[o + 1], ez = f[o + 5] - f[o + 2], l2 = ex * ex + ey * ey + ez * ez;
                  let t = l2 > 1e-10 ? ((kx0 - f[o]) * ex + (fy - f[o + 1]) * ey + (kz0 - f[o + 2]) * ez) / l2 : 0;
                  t = t < 0 ? 0 : t > 1 ? 1 : t;
                  const qx = kx0 - f[o] - ex * t, qy = fy - f[o + 1] - ey * t, qz = kz0 - f[o + 2] - ez * t, rr = f[o + 6] + 0.10 * rs / 0.7;
                  if (qx * qx + qy * qy + qz * qz < rr * rr) ok = false;
                }
              }
              if (ok) { pick = fr; break; }
            }
            M.frac = pick;
          }
          along = M.frac * l;
          // the top of his trunk under the seat (meleeposes: the rider's pelvis rests over it)
          if (Ba.ch) {
            const yl = f[1] + (f[4] - f[1]) * M.frac, yr = f[8] + (f[11] - f[8]) * M.frac;
            Ba.ch._mountTop = Math.max(yl, yr) + f[6];
            Ba.ch._mountHalfW = halfW; Ba.ch._mountR = f[6];
          }
          seatW = halfW;
          // how far he reaches along his own line, heels to crown (from the pelvis end of the trunk)
          aMin = 1e9; aMax = -1e9;
          for (let o = 0; o < 13 * 7; o += 7) {
            for (let e = 0; e < 6; e += 3) {
              const a = (f[o + e] - px) * ux + (f[o + e + 2] - pz) * uz;
              if (a - f[o + 6] < aMin) aMin = a - f[o + 6];
              if (a + f[o + 6] > aMax) aMax = a + f[o + 6];
            }
          }
          bodyOK = true;
        }
      }
      const tx = bx0 + ux * along, tz = bz0 + uz * along;
      /* THE CLIMB ON (seen from the side and from above: he ran in from the
         man's feet straight up the length of him, standing on his shins,
         his thighs, his belly; stood there turned sideways with a leg held
         out across his arm; then snapped round and was kneeling).
         Nothing took him ROUND the man: the walk went to the seat, which
         is on the man. It goes in three parts, and at no time is a foot
         put on him or his root over him while he stands on both feet.
           1. THE WALK, round him. To a STAND POINT on the floor beside his
              trunk at the seat's station, on the nearer side (the other
              one if something of his lies on that spot and not on the
              other). If the rider is not already out on that side he
              first goes out to a lane beside the body: sideways, when he
              is past the man's feet or head (or is standing on him); round
              the nearer end when he is alongside on the far side. Then
              down the lane. An ordinary walk (1.7 m/s, the legs told so):
              each footfall is tested against the man's parts and a
              swinging foot is lifted over a limb it crosses (the gait).
           2. He turns to face ACROSS the man.
           3. ONE STEP OVER. The far leg is carried over the trunk at the
              height of the highest thing under its path and 9 cm, to the
              kneel's foot spot on the far side (tested, moved to free
              floor); the near foot stays where it stands; over that same
              step his root comes across to the seat and he turns to face
              the head. When the foot is down he lowers onto his knees.
         If the stand point is not reached in time (2 s and the walk's own
         length) he does not kneel through him: the mount is off and the
         blow that was waiting on it is dropped. NPC riders take the same
         path. A man with no parts to read (no rig): straight to the seat,
         as before. */
      const rc = Ba.ch;
      const ddx = tx - p.x, ddz = tz - p.z, dd = Math.hypot(ddx, ddz);
      const yawAlong = Math.atan2(ux, uz);
      if (M.slide < 1 && bodyOK && rc && rc.group) {
        const perpX = uz, perpZ = -ux;                               // to the rider's LEFT of the trunk's line, once he faces the head
        const ra = (p.x - bx0) * ux + (p.z - bz0) * uz, rl = (p.x - bx0) * perpX + (p.z - bz0) * perpZ;
        const rs = scaleOf(rc), fy = p.y || 0;
        const off = seatW + 0.17 * rs / 0.7, lane = off + 0.12;
        if (M.flank == null) {
          let sd = rl >= 0 ? 1 : -1;
          if (BPm && BPm.topAt) {
            const b1 = BPm.topAt(rc, tx + perpX * off * sd, tz + perpZ * off * sd) > fy + 0.06;
            const b2 = BPm.topAt(rc, tx - perpX * off * sd, tz - perpZ * off * sd) > fy + 0.06;
            if (b1 && !b2) sd = -sd;
          }
          M.flank = sd; M.stage = 0; M.walkT = 0;      // (M.side is the punching hand: this is which side of him)
          M.budget = 2.0 + (Math.abs(rl - sd * off) + Math.abs(ra - along) + (rl * sd < 0 ? 2 * off : 0)) / 1.4;
        }
        const sd = M.flank;
        const yawAcross = Math.atan2(-perpX * sd, -perpZ * sd);
        if (M.stage === 0) {
          M.walkT += dt;
          // where to next: the stand point, or the way round to it
          let ga = along, gl = sd * off, last = true;
          if (rl * sd < off - 0.04) {
            last = false;
            if (ra < aMin - 0.15 || ra > aMax + 0.15 || Math.abs(rl) < off) { ga = ra; gl = sd * lane; }   // clear of his ends, or on him: straight out to the lane
            else { ga = ra - aMin < aMax - ra ? aMin - 0.35 : aMax + 0.35; gl = rl; }                    // alongside on the far side: round the nearer end
          }
          const gx = bx0 + ux * ga + perpX * gl - p.x, gz = bz0 + uz * ga + perpZ * gl - p.z, gd = Math.hypot(gx, gz);
          const stp = Math.min(gd, 1.7 * dt);
          if (gd > 1e-4) moveBy(Ba, gx / gd * stp, gz / gd * stp);
          rc._verbWalk = CBZ.now || 0;
          if (gd > 0.15) Ba.face(Math.atan2(gx, gz), Math.min(1, dt * 8));
          if (last && gd - stp < 0.06) M.stage = 1;
          else if (M.walkT > M.budget) { V.cancelStrike(M.a); dismount(M); continue; }
        } else if (M.stage === 1) {
          // across him, both feet down, then the step
          M.walkT += dt;
          Ba.face(yawAcross, Math.min(1, dt * 9));
          let dyw = (yawAcross - rc.group.rotation.y) % TAU;
          if (dyw > Math.PI) dyw -= TAU; else if (dyw < -Math.PI) dyw += TAU;
          const G = rc._gv, useG = !!(G && G.init && G.w > 0.5 && G.feet && !G.adopt), FTm = rc._mFt;
          const gi = sd > 0 ? 0 : 1;                                // the leg that crosses: his right (gait foot 0) from the left side, his left from the right
          const swing = useG && (G.feet[0].sw || G.feet[1].sw);
          if (Math.abs(dyw) < 0.2 && !swing && (useG || FTm)) {
            const g = rc.group, yaw = g.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
            let fx, fz;
            if (useG) { fx = G.feet[gi].x; fz = G.feet[gi].z; }
            else { const o = gi ? 0 : 2; fx = g.position.x + (FTm[o] * cy + FTm[o + 1] * sy) * rs; fz = g.position.z + (-FTm[o] * sy + FTm[o + 1] * cy) * rs; }
            const wFoot = Math.max(seatW + 0.16, 0.33 * rs / 0.7);
            let lx2 = tx - perpX * wFoot * sd, lz2 = tz - perpZ * wFoot * sd;
            if (BPm && BPm.footSpot && BPm.footSpot(rc, lx2, fy, lz2, yawAlong, _mfs)) { lx2 = _mfs.x; lz2 = _mfs.z; }
            let top = 0;
            if (BPm && BPm.topAt) for (let k = 1; k <= 5; k++) { const tq = BPm.topAt(rc, fx + (lx2 - fx) * k / 6, fz + (lz2 - fz) * k / 6) - fy; if (tq > top) top = tq; }
            const st = rc._mStep || (rc._mStep = { on: false, init: false, t: 0, dur: 0.5, leg: 0, sx: 0, sz: 0, tx: 0, tz: 0, h: 0, ox: 0, oz: 0 });
            st.on = true; st.init = false; st.t = 0; st.leg = gi ? 0 : 1; st.sx = fx; st.sz = fz; st.tx = lx2; st.tz = lz2;
            st.h = Math.min(0.62 * rs / 0.7, Math.max(0.12, top + 0.09));
            st.dur = 0.55;
            M.stage = 2; M.rx0 = p.x; M.rz0 = p.z; M.yaw0 = yaw;
          } else if (M.walkT > M.budget + 1.2) { V.cancelStrike(M.a); dismount(M); continue; }
        } else {
          // the step over: the root comes across to the seat and he turns to the head as the foot travels
          const st = rc._mStep, u = st && st.on ? clamp01(st.t / st.dur) : 1, e = clamp01((u - 0.15) / 0.85), e2 = e * e * (3 - 2 * e);
          moveBy(Ba, M.rx0 + (tx - M.rx0) * e2 - p.x, M.rz0 + (tz - M.rz0) * e2 - p.z);
          Ba.face(lerpAngle(M.yaw0, yawAlong, e2), 1);
          if (!st || !st.on) M.slide = 1;
        }
      } else if (M.slide < 1) {
        // (no parts to plan round: to the seat)
        const stp = Math.min(dd, 1.7 * dt);
        if (dd > 1e-4) moveBy(Ba, ddx / dd * stp, ddz / dd * stp);
        if (rc) rc._verbWalk = CBZ.now || 0;
        M.walkT = (M.walkT || 0) + dt;
        Ba.face(yawAlong, Math.min(1, dt * 7));
        if (dd - stp < 0.05 || M.walkT > 1.8) M.slide = 1;
      } else {
        const k = 1 - Math.exp(-dt * 30);
        moveBy(Ba, ddx * k, ddz * k);
        Ba.face(yawAlong, Math.min(1, dt * 12));
      }
      M.lastX = p.x; M.lastZ = p.z;
      if (Ba.ch) {
        Ba.ch._mountGo = true; Ba.ch.mount = M.slide >= 1; Ba.ch._mountOn = tch;
        if (M.slide < 1 || (Ba.ch._mountK || 0) < 0.85) {
          const st = strikeOf(M.a);
          if (st && !st.kick && Ba.ch.punchT > 0) Ba.ch.punchT = Math.max(Ba.ch.punchT, st.dur + 0.001);
        }
      }
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
  /* THE FIGHTER (the AI brain that decides the next beat of an exchange) and
     the group around a man moved to systems/melee.js (CBZ.melee), which
     publishes V.fighter. This file is HOW a blow lands, not who throws it. */
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
  // what the man in front of you is throwing (null = nothing): read off his rig
  V.telegraphOf = function (t, out) { const B = bod(t); return telegraphOfRig(B && B.ch, out || { kind: null, prog: 0, dur: 0, impactIn: 0, n: 0 }); };
  V.strikeClock = function () { return clock; };

  if (CBZ.onUpdate) CBZ.onUpdate(86, update);
})();
