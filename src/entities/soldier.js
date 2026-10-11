/* ============================================================
   entities/soldier.js — CBZ.soldier, HOW A SOLDIER MOVES.

   The human (entities/character.js) already walks, runs, crouches, goes
   prone, vaults and falls; entities/gait.js plants its feet. What it did not
   have is the vocabulary of a man carrying a rifle in a fight: how he holds it
   when nobody is in front of him and when somebody might be, how he hides
   behind a wall and looks over it, how he crosses open ground, reloads on the
   move, throws a grenade, takes a round in the leg and keeps going. This file
   is that vocabulary, on the one shared body, so NPC War's armies, the
   President's soldiers, a survival bot and a gun-game bot all move the same
   way. A soldier is a person with a state record (ch.soldier) and a few verbs.

   STATE (set by whoever runs the soldier; every field optional)
     ch.soldier = {
       carry:  "low" | "high" | "patrol" | null   how the rifle is held when
               he is not aiming it (low ready / high ready / slung patrol)
       stance: "stand" | "crouch" | "prone" | "rush"   (rush = the low, fast
               crouch-run of a bound)
       cover:  null | { low: true (a waist wall: crouch behind it) | false (a
               corner / full wall), side: -1 | 1 (which way he leans out),
               peek: 0..1 (how far he is out looking), blind: bool (gun up
               over / around it, body still behind) }
     }
   VERBS (one-shot, upper body unless said; legs keep walking)
     CBZ.soldier.reload(ch)                 mag out, fresh mag from the pouch,
                                            seat, slap, charge — on the move
     CBZ.soldier.throwGrenade(ch, o)        wind-up, release, follow-through;
                                            o.onRelease() fires at release
     CBZ.soldier.hit(ch, o)                 a round lands: flinch and keep
                                            going / stumble / go down (o.sev
                                            0..1, o.dirX/dirZ world direction
                                            the round TRAVELLED, o.zone)
     CBZ.soldier.wound(ch, zone, sev)       what the hit leaves: a limp, a
                                            dead arm, hunched over a gut wound,
                                            both legs gone = he crawls
     CBZ.soldier.dive(ch)                   the end of a bound: lunge, hands
                                            out, down onto the chest (prone)
     CBZ.soldier.vault(ch, o)               over a low wall: the shared
                                            traversal pose with this body's
                                            hands on the top (o: ledgeX/ledgeZ/
                                            top/dirX/dirZ/dur)
   Hooks (character.js animChar is the only caller): pre(ch, dt) at the top
   (stance flags, clocks), pose(ch, dt, moving, J, speed) late in the
   locomotion branch (arms, torso), crawl(...) inside the prone branch.

   Rig conventions (entities/character.js): model faces +Z; la is the arm on
   +X (physical left), ra on -X (physical right); negative rotation.x swings
   a limb forward; elbows fold negative; for la +z swings the hand out, for ra
   -z does; body.rotation.y > 0 brings the RIGHT shoulder forward.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ) return;
  const THREE = W.THREE;

  const PI = Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
  const bump = (a, b, x) => Math.sin(PI * clamp01((x - a) / (b - a)));   // 0 -> 1 -> 0 over [a, b]

  /* ---- THE CARRIES, as joint targets (no gun in the hand: a baked crowd, a
     body whose gun the hold solver can't take). With a real gun in the right
     fist the hold solver (systems/actorweapons.js CBZ.gunHold.carry) puts
     both hands ON it instead. [shoulder x, y, z, protraction, elbow] */
  const CARRY = {
    low:    { ra: [-0.58, 0.10, 0.16, 0.06, -1.12], la: [-0.92, -0.26, -0.36, 0.14, -0.74] },
    lowc:   { ra: [-0.72, 0.10, 0.16, 0.06, -1.10], la: [-1.02, -0.26, -0.36, 0.15, -0.70] },
    high:   { ra: [-0.86, 0.12, 0.20, 0.06, -1.78], la: [-1.24, -0.30, -0.40, 0.16, -1.22] },
    patrol: { ra: [-0.34, 0.08, 0.16, 0.04, -1.20], la: [-0.62, -0.22, -0.34, 0.10, -0.98] },
  };
  function setArm(part, low, A, k, dt, rate) {
    if (!part) return;
    const r = rate || 14, R = part.rotation;
    // (one Euler write per joint: each channel write re-derives the quaternion)
    R.set(damp(R.x, lerp(R.x, A[0], k), r, dt), damp(R.y, lerp(R.y, A[1], k), r, dt), damp(R.z, lerp(R.z, A[2], k), r, dt));
    part.position.z = damp(part.position.z, lerp(part.position.z, A[3], k), r, dt);
    if (low) {
      const L = low.rotation;
      L.set(damp(L.x, lerp(L.x, A[4], k), r, dt), damp(L.y, 0, 12, dt), damp(L.z, 0, 12, dt));
    }
  }
  // the rifle in the right fist, if there is one (systems/actorweapons.js socket)
  function gunOf(ch) {
    const s = ch.sockets && (ch.sockets.thirdPersonWeapon || ch.sockets.weapon);
    if (!s) return null;
    const kids = s.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (o.visible !== false && o.userData && o.userData.weaponId && !o.userData.weaponMelee) return o;
    }
    return null;
  }

  /* EVERY ADDITIVE TOUCH IS BACKED OUT NEXT FRAME. A delta added onto a
     channel that the next frame damps FROM compounds (the damp only takes a
     share of it back each frame): the crawl's reach wound the shoulder round
     behind the back in a third of a second. So each one is recorded here and
     subtracted at the top of the next animChar (pre), before any writer
     reads the channel — the same bookkeeping as the hip lock's. */
  function add(ch, obj, prop, v) {
    if (!obj || !v) return;
    obj[prop] += v;
    const L = ch._sDL || (ch._sDL = []);
    L.push(obj, prop, v);
  }
  function undo(ch) {
    const L = ch._sDL;
    if (!L || !L.length) return;
    for (let i = L.length - 3; i >= 0; i -= 3) L[i][L[i + 1]] -= L[i + 2];
    L.length = 0;
  }
  function st(ch) { return ch.soldier || null; }
  function act(ch) { return ch._sAct && ch._sAct.on ? ch._sAct : null; }
  function start(ch, kind, dur, extra) {
    const A = ch._sAct || (ch._sAct = {});
    A.on = true; A.kind = kind; A.t = 0; A.dur = dur; A.fired = false;
    A.onRelease = null; A.sev = 0; A.dx = 0; A.dz = 1; A.side = 1;
    if (extra) Object.assign(A, extra);
    return A;
  }

  /* ---- PRE: top of animChar. Stance -> the rig's own flags, clocks. ------ */
  function pre(ch, dt) {
    undo(ch);
    const S = st(ch);
    const A = act(ch);
    if (A) {
      A.t += dt;
      if (A.kind === "throw" && !A.fired && A.t >= A.dur * 0.42) { A.fired = true; if (typeof A.onRelease === "function") { try { A.onRelease(ch); } catch (e) { /* the caller's */ } } }
      if (A.kind === "dive" && A.t >= A.dur * 0.24 && !A.down) {
        A.down = true;
        if (S) S.stance = "prone"; else ch.pronePose = true;
      }
      if (A.kind === "vault" && ch.traversePose && ch.traversePose._soldier) {
        ch.traversePose.t = clamp01(A.t / A.dur);
      }
      if (A.t >= A.dur) {
        A.on = false;
        if (A.kind === "vault" && ch.traversePose && ch.traversePose._soldier) ch.traversePose = null;
      }
    }
    // wounds heal on their clocks
    const ah = ch._sArmHurt; if (ah && (ah.t -= dt) <= 0) ch._sArmHurt = null;
    const th = ch._sTorsoHurt; if (th && (th.t -= dt) <= 0) ch._sTorsoHurt = null;
    if (!S) { ch._proneFast = A && A.kind === "dive" ? 1 : 0; return; }
    const cover = S.cover;
    const stance = S.stance || "stand";
    // a low wall is crouched behind unless he is up over it looking
    const coverLow = cover && cover.low !== false && !(cover.peek > 0.5) && !cover.blind;
    ch.crouch = stance === "crouch" || stance === "rush" || !!coverLow || !!ch._sLegsGone;
    ch.pronePose = stance === "prone" || !!ch._sLegsGone;
    ch._proneFast = A && A.kind === "dive" ? 1 : 0;
  }

  /* ---- POSE: late in the locomotion branch (after the gait's arms and the
     torso's bob/lean/sway, before the falls). Everything is a damp toward
     an absolute target or a delta the next frame's locomotion overwrites. */
  const _p = THREE ? new THREE.Vector3() : null, _q = THREE ? new THREE.Vector3() : null;
  function pose(ch, dt, moving, J, speed) {
    const S = st(ch), A = act(ch);
    const P = ch.parts || {};
    const aimed = ch.aimingPose || ch._aimHold > 0 || ch.surrender || ch.handsUp || ch.cuffed;
    let carryK = 0;
    // ---- THE CARRY ----
    const mode0 = S && S.carry;
    if (mode0 && !aimed && !(A && (A.kind === "throw"))) {
      const mode = mode0 === "low" && ch.crouch ? "lowc" : mode0;
      const prop = gunOf(ch);
      let held = false;
      if (prop && CBZ.gunHold && CBZ.gunHold.carry) { try { held = CBZ.gunHold.carry(ch, prop, mode); } catch (e) { held = false; } }
      if (!held) {
        const C = CARRY[mode] || CARRY.low;
        setArm(P.ra, J.ra, C.ra, 1, dt, 14);
        setArm(P.la, J.la, C.la, 1, dt, 14);
        // the rifle rides the stride: a hair of bounce, never a swing
        if (moving) {
          const b = Math.sin((ch.phase || 0) * 2) * 0.025 * Math.min(1, speed / 3);
          add(ch, P.ra && P.ra.rotation, "x", b); add(ch, P.la && P.la.rotation, "x", b);
        }
      }
      carryK = 1;
      // a man carrying a rifle does not swing his shoulders through the stride
      if (moving && ch.body) add(ch, ch.body.rotation, "y", -0.65 * ch.body.rotation.y);
    }

    // ---- STANCE: the rush (a bound's low run) ----
    if (S && S.stance === "rush" && ch.body) {
      add(ch, ch.body.rotation, "x", 0.18 * Math.min(1, speed / 3));
    }

    // ---- COVER ----
    const cover = S && S.cover;
    if (cover && ch.body) {
      const k = ch._sCovK = damp(ch._sCovK || 0, 1, 8, dt);
      const peek = ch._sPeek = damp(ch._sPeek || 0, clamp01(cover.peek || 0), 7, dt);
      const side = cover.side < 0 ? -1 : 1;
      if (cover.low !== false) {
        // behind a waist wall: shoulders tucked down, the back rounded toward
        // the wall; peeking he comes UP over it (the crouch eases off in pre)
        add(ch, ch.body.rotation, "x", (0.10 - 0.08 * peek) * k);
        if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.10 * (1 - peek), 8, dt);
      } else {
        // a corner: the body stays on its side of the edge and LEANS out from
        // the hips (the feet stay planted: the gait holds them), the head
        // comes upright again so the eyes are level
        add(ch, ch.body.rotation, "z", -side * 0.30 * peek * k);
        add(ch, ch.body.position, "x", side * 0.10 * peek * k);
        if (ch.neck) ch.neck.rotation.z = damp(ch.neck.rotation.z, side * 0.18 * peek, 9, dt);
      }
      if (cover.blind) {
        // BLIND FIRE: the gun goes up over the wall (or out round the corner)
        // at arm's length while the body stays behind it
        const bk = ch._sBlind = damp(ch._sBlind || 0, 1, 10, dt);
        if (cover.low !== false) {
          setArm(P.ra, J.ra, [-2.45, 0.05, 0.10, 0.10, -0.30], bk, dt, 16);
          setArm(P.la, J.la, [-2.35, -0.10, -0.18, 0.10, -0.55], bk, dt, 16);
          add(ch, ch.body.rotation, "x", 0.12 * bk);
        } else {
          setArm(P.ra, J.ra, [-1.45, side < 0 ? 0.10 : -0.10, side < 0 ? -0.75 : 0.35, 0.10, -0.18], bk, dt, 16);
          setArm(P.la, J.la, [-0.55, 0, -0.10, 0, -1.10], bk, dt, 12);
        }
      } else ch._sBlind = 0;
    } else { ch._sCovK = 0; ch._sPeek = 0; }

    // ---- WOUNDS (upper body) ----
    const th = ch._sTorsoHurt;
    if (th && ch.body) {
      // hunched over it, a hand pressed to it
      const sv = clamp01(th.sev);
      add(ch, ch.body.rotation, "x", 0.30 * sv);
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.18 * sv, 8, dt);
      if (!carryK || sv > 0.6) setArm(P.la, J.la, [-0.62, -0.20, -0.62, 0.08, -1.55], sv, dt, 10);
    }
    const ah = ch._sArmHurt;
    if (ah) {
      // the hit arm hangs, held in against the body; a rifle is carried by the other one
      const sv = clamp01(ah.sev);
      const part = ah.side < 0 ? P.ra : P.la, low = ah.side < 0 ? J.ra : J.la;
      setArm(part, low, [-0.10, 0, ah.side < 0 ? 0.06 : -0.06, 0, -0.55], sv, dt, 10);
    }

    // the throw turned the head to the target: it comes back after
    if (ch._sNeckY && !(A && A.kind === "throw") && ch.neck) {
      ch.neck.rotation.y = damp(ch.neck.rotation.y, 0, 8, dt);
      if (Math.abs(ch.neck.rotation.y) < 0.01) { ch.neck.rotation.y = 0; ch._sNeckY = 0; }
    }
    // ---- ONE-SHOT VERBS ----
    if (A) {
      const u = clamp01(A.t / A.dur);
      if (A.kind === "reload") reloadPose(ch, A, u, dt, J);
      else if (A.kind === "throw") throwPose(ch, A, u, dt, J);
      else if (A.kind === "flinch" || A.kind === "stumble") hitPose(ch, A, u, dt, J);
      else if (A.kind === "dive") divePose(ch, A, u, dt, J);
    }
  }

  /* ---- RELOAD: the off hand's path through the gun, the gun stays up ------
     out (the empty mag is stripped at the well) -> down to the pouch on the
     left front of the belt -> back up, the fresh mag seated in the well ->
     the slap -> the charging handle at the top rear -> back on the handguard.
     The right fist and the gun hold their carry, canted up a touch so he can
     see the well. Every point is taken off the right hand, wherever the carry
     has put it, so the path is ON the gun for any hold. */
  const RL_KEYS = [
    // [t, where]  where: 0 handguard (no IK), 1 magwell, 2 pouch, 3 handle
    [0.00, 0], [0.13, 1], [0.24, 1], [0.42, 2], [0.52, 2], [0.66, 1], [0.74, 1], [0.86, 3], [0.92, 3], [1.00, 0],
  ];
  function reloadPose(ch, A, u, dt, J) {
    const P = ch.parts;
    if (!P || !P.la || !P.ra || !ch.body) return;
    const env = sstep(0, 0.10, u) * (1 - sstep(0.90, 1.0, u));
    // the gun cants up and in, the eyes go down to it
    add(ch, P.ra.rotation, "x", -0.22 * env);
    if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.30 * env, 10, dt);
    if (!CBZ.charArmTo || !THREE || !ch.sockets || !ch.sockets.rightHand) {
      // no IK on this page: a keyed approximation of the same path
      const dip = bump(0.24, 0.66, u);
      add(ch, P.la.rotation, "x", (0.70 * dip - 0.30 * bump(0.74, 0.92, u)) * env);
      add(ch, J.la && J.la.rotation, "x", (-0.35 * dip - 0.80 * bump(0.74, 0.92, u)) * env);
      return;
    }
    // where the hand is going this instant
    let k0 = 0;
    while (k0 < RL_KEYS.length - 2 && RL_KEYS[k0 + 1][0] <= u) k0++;
    const a = RL_KEYS[k0], b = RL_KEYS[k0 + 1];
    const f = sstep(0, 1, (u - a[0]) / Math.max(1e-4, b[0] - a[0]));
    const pa = keyPoint(ch, a[1], _p), wa = a[1] ? 1 : 0;
    const ax = pa.x, ay = pa.y, az = pa.z;
    const pb = keyPoint(ch, b[1], _q), wb = b[1] ? 1 : 0;
    const w = lerp(wa, wb, f) * env;
    if (w <= 0.01) return;
    _p.set(lerp(ax, pb.x, f), lerp(ay, pb.y, f), lerp(az, pb.z, f));
    try { CBZ.charArmTo(ch, _p, "l", w); } catch (e) { /* a rig without an arm */ }
    // this writer owns the arm outright for the beat: it stores a shoulder a
    // person has (the draw-time clamp is the net, not the plan)
    if (CBZ.human && CBZ.human.clampArm) CBZ.human.clampArm(ch, "l");
  }
  const _rh = THREE ? new THREE.Vector3() : null, _bf = THREE ? new THREE.Vector3() : null;
  // a reload key in the WORLD: magwell / pouch / handle from the right fist and the body
  function keyPoint(ch, which, out) {
    ch.body.updateWorldMatrix(true, false);
    ch.sockets.rightHand.updateWorldMatrix(true, false);
    _rh.setFromMatrixPosition(ch.sockets.rightHand.matrixWorld);
    const e = ch.body.matrixWorld.elements;
    // body axes in the world
    const fx = e[8], fy = e[9], fz = e[10], ux = e[4], uy = e[5], uz = e[6];
    const fl = Math.hypot(fx, fy, fz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
    const P = ch.profile || {};
    if (which === 1) {           // the magazine well: just ahead of and under the fist
      out.set(_rh.x + fx / fl * 0.11 - ux / ul * 0.06, _rh.y + fy / fl * 0.11 - uy / ul * 0.06, _rh.z + fz / fl * 0.11 - uz / ul * 0.06);
    } else if (which === 3) {    // the charging handle: on top, at the rear
      out.set(_rh.x + ux / ul * 0.12 - fx / fl * 0.06, _rh.y + uy / ul * 0.12 - fy / fl * 0.06, _rh.z + uz / ul * 0.12 - fz / fl * 0.06);
    } else if (which === 2) {    // the pouch: left front of the belt
      const hy = (ch.hipY || 0.95) + 0.10;
      _bf.set((P.pelvisW || 0.84) * 0.30, hy, (P.pelvisD || 0.48) * 0.62);
      out.copy(_bf).applyMatrix4(ch.body.matrixWorld);
    } else out.copy(_rh);
    return out;
  }

  /* ---- THE THROW ------------------------------------------------------------
     0 .. 0.38  wind-up: the right shoulder goes back and the hand cocks
                behind the head, elbow up and out; the left arm points at the
                target; the weight rocks onto the back foot
     0.38..0.52 the release: hips then shoulders turn through, the elbow leads,
                the forearm whips over and extends, the weight goes forward
     0.52..1    follow-through: the arm carries on down and across the body,
                the chest over the front knee, then everything settles */
  function throwPose(ch, A, u, dt, J) {
    const P = ch.parts;
    if (!P || !P.ra || !ch.body) return;
    const wind = sstep(0.0, 0.38, u) * (1 - sstep(0.38, 0.52, u));
    const rel = bump(0.36, 0.62, u);
    const fol = sstep(0.46, 0.62, u) * (1 - sstep(0.80, 1.0, u));
    const all = sstep(0, 0.12, u) * (1 - sstep(0.86, 1.0, u));
    // torso: turn back, then through; lean back, then over
    ch.body.rotation.y = -0.62 * wind + 0.10 * rel + 0.48 * fol;
    add(ch, ch.body.rotation, "x", -0.16 * wind + 0.10 * rel + 0.30 * fol);
    add(ch, ch.body.rotation, "z", 0.10 * wind - 0.06 * fol);
    // the throwing arm (ra): cocked high behind -> over the top -> down across
    const rx = 0.55 * wind - 2.55 * rel - 0.65 * fol;
    const rz = -1.05 * wind - 0.20 * rel + 0.50 * fol;
    const re = -1.75 * wind - 0.45 * rel - 0.35 * fol;
    P.ra.rotation.x = lerp(P.ra.rotation.x, rx, all);
    P.ra.rotation.y = lerp(P.ra.rotation.y, -0.30 * wind, all);
    P.ra.rotation.z = lerp(P.ra.rotation.z, rz, all);
    P.ra.position.z = lerp(P.ra.position.z, -0.04 * wind + 0.10 * fol, all);
    if (J.ra) J.ra.rotation.x = lerp(J.ra.rotation.x, re, all);
    // the guide arm points at where it is going, then tucks as the body turns
    if (P.la) {
      P.la.rotation.x = lerp(P.la.rotation.x, -1.40 * wind - 0.40 * fol, all);
      P.la.rotation.z = lerp(P.la.rotation.z, 0.12 * wind - 0.20 * fol, all);
      P.la.rotation.y = lerp(P.la.rotation.y, 0, all);
      if (J.la) J.la.rotation.x = lerp(J.la.rotation.x, -0.25 * wind - 1.25 * fol, all);
    }
    if (ch.neck) ch.neck.rotation.y = lerp(ch.neck.rotation.y, 0.55 * wind - 0.40 * fol, all);
    if (ch.setHandPose) ch.setHandPose("r", u < 0.47 ? "grip" : "relaxed");
    ch._sNeckY = 1;
  }

  /* ---- A ROUND LANDS ---------------------------------------------------------
     flinch    the torso jolts with the round and the shoulders come up — he
               keeps going (0.4 s)
     stumble   the upper body is thrown over the hips (forward if the round
               came from behind or he was running into it, back otherwise),
               the arms go out for balance, he dips, catches it (0.8 s)
     fall      he goes down: the rig's keyed fall and get-up (meleeposes) */
  function hitPose(ch, A, u, dt, J) {
    const P = ch.parts;
    if (!ch.body) return;
    const big = A.kind === "stumble";
    const e = big ? Math.sin(PI * Math.pow(u, 0.6)) : Math.sin(PI * Math.pow(u, 0.45));
    const amp = (big ? 0.55 : 0.22) * (0.5 + 0.5 * A.sev);
    // the round's direction in the body frame: dz < 0 = from the front
    add(ch, ch.body.rotation, "x", amp * e * (A.dz >= 0 ? 1 : -0.7));
    add(ch, ch.body.rotation, "z", amp * 0.6 * e * clamp(-A.dx, -1, 1));
    add(ch, ch.body.position, "y", -(big ? 0.10 : 0.03) * e);
    if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.25 * e * (A.dz >= 0 ? 1 : -1), 14, dt);
    if (big && P) {
      // arms out for balance
      if (P.la) { P.la.rotation.z = lerp(P.la.rotation.z, 0.95, e); P.la.rotation.x = lerp(P.la.rotation.x, -0.70, e); }
      if (P.ra) { P.ra.rotation.z = lerp(P.ra.rotation.z, -0.95, e); P.ra.rotation.x = lerp(P.ra.rotation.x, -0.55, e); }
      if (J.la) J.la.rotation.x = lerp(J.la.rotation.x, -0.45, e);
      if (J.ra) J.ra.rotation.x = lerp(J.ra.rotation.x, -0.45, e);
    } else if (P) {
      // the shoulders hunch round the hit (rolled forward, not across)
      add(ch, P.la && P.la.position, "z", 0.05 * e);
      add(ch, P.ra && P.ra.position, "z", 0.05 * e);
    }
  }

  /* ---- THE DIVE (end of a bound) ------------------------------------------
     0 .. 0.24  the last stride drops into a lunge: chest forward and down,
                both hands out to take the ground
     0.24 .. 1  down: the prone pose takes the body (fast), the hands land
                first and fold into the firing position */
  function divePose(ch, A, u, dt, J) {
    const P = ch.parts;
    if (!ch.body || u >= 0.24) return;
    const k = sstep(0, 0.24, u);
    add(ch, ch.body.rotation, "x", 0.75 * k);
    add(ch, ch.body.position, "y", -0.14 * k);
    if (P.la) { P.la.rotation.x = lerp(P.la.rotation.x, -1.55, k); P.la.rotation.z = lerp(P.la.rotation.z, 0.20, k); }
    if (P.ra) { P.ra.rotation.x = lerp(P.ra.rotation.x, -1.55, k); P.ra.rotation.z = lerp(P.ra.rotation.z, -0.20, k); }
    if (J.la) J.la.rotation.x = lerp(J.la.rotation.x, -0.30, k);
    if (J.ra) J.ra.rotation.x = lerp(J.ra.rotation.x, -0.30, k);
    if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, -0.35 * k, 12, dt);
  }

  /* ---- PRONE: THE CRAWL ------------------------------------------------------
     A leopard crawl: one knee draws up beside the body (the hip flexes and
     opens), the opposite elbow reaches forward, the body rolls a little onto
     the side the knee came up; then the other pair. Called from the prone
     branch with that branch's own rates; returns nothing (writes deltas onto
     targets the branch has just damped). `crawl` 0..1 = how much he is
     actually moving. */
  const CRAWL_STRIDE = 0.5;
  function crawl(ch, dt, speed, J) {
    const P = ch.parts;
    if (!P || !P.ll || !P.rl) return;
    const k = ch._sCrawlK = damp(ch._sCrawlK || 0, speed > 0.12 ? 1 : 0, 6, dt);
    if (k < 0.01) return;
    // one crawl cycle (both sides) covers CRAWL_STRIDE of ground; it runs on
    // ch.phase like the walk, so a baked crowd clip can measure its period
    if (speed > 0.12) ch.phase = (ch.phase || 0) + (Math.PI * 2) * Math.min(speed, 1.2) / CRAWL_STRIDE * dt;
    const s = Math.sin(ch.phase || 0), dL = Math.max(0, s), dR = Math.max(0, -s);
    // legs: ll is physical right (-X), rl physical left (+X)
    add(ch, P.ll.rotation, "x", -0.95 * dR * k); add(ch, P.ll.rotation, "z", -0.55 * dR * k);
    add(ch, P.rl.rotation, "x", -0.95 * dL * k); add(ch, P.rl.rotation, "z", 0.55 * dL * k);
    add(ch, J.ll && J.ll.rotation, "x", 1.35 * dR * k);
    add(ch, J.rl && J.rl.rotation, "x", 1.35 * dL * k);
    // arms: the opposite elbow reaches (la is physical left)
    add(ch, P.la && P.la.rotation, "x", -0.40 * dR * k);
    add(ch, P.ra && P.ra.rotation, "x", -0.40 * dL * k);
    // the body rolls onto the side the knee comes up, and wriggles
    if (ch.body) { add(ch, ch.body.rotation, "z", 0.10 * s * k); add(ch, ch.body.rotation, "y", 0.06 * s * k); }
  }

  /* ---- VERBS --------------------------------------------------------------- */
  function reload(ch, o) { if (!ch) return null; return start(ch, "reload", (o && o.dur) || 2.3); }
  function throwGrenade(ch, o) {
    if (!ch) return null;
    o = o || {};
    return start(ch, "throw", o.dur || 1.25, { onRelease: o.onRelease || null });
  }
  /* o: { sev 0..1, dirX/dirZ: the WORLD direction the round travelled,
          zone: "head"|"torso"|"gut"|"armL"|"armR"|"legL"|"legR"|"legs",
          running: bool (else read off the rig's own measured speed) } */
  function hit(ch, o) {
    if (!ch) return null;
    o = o || {};
    const sev = clamp01(o.sev == null ? 0.5 : o.sev);
    let dx = 0, dz = 1;
    if (o.dirX != null && ch.group) {
      const yaw = ch.group.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
      dx = o.dirX * c - (o.dirZ || 0) * s; dz = o.dirX * s + (o.dirZ || 0) * c;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    }
    const G = ch._gv;
    const running = o.running != null ? !!o.running : !!(G && G.v > 2.4);
    if (o.zone) wound(ch, o.zone, sev);
    // a hard round on a running man, or a leg taken out from under him: down
    const legShot = o.zone === "legL" || o.zone === "legR" || o.zone === "legs";
    if ((sev > 0.78 || (legShot && running && sev > 0.5)) && CBZ.meleePoses && CBZ.meleePoses.startFall) {
      CBZ.meleePoses.startFall(ch, { variant: dz > 0 || running ? "face" : "back", side: dx < 0 ? -1 : 1, ko: false, dur: 0.9 + 0.8 * sev });
      if (ch._sAct) ch._sAct.on = false;
      return "fall";
    }
    const kind = sev > 0.40 || (running && sev > 0.25) ? "stumble" : "flinch";
    start(ch, kind, kind === "stumble" ? 0.75 : 0.38, { sev, dx, dz: running ? Math.max(dz, 0.3) : dz });
    return kind;
  }
  function wound(ch, zone, sev) {
    if (!ch) return;
    sev = clamp01(sev == null ? 0.5 : sev);
    const t = 40 + 80 * sev;
    if (zone === "legL" || zone === "legR") {
      // character.js's limp: side < 0 is ll (the physical right leg)
      const side = zone === "legR" ? -1 : 1;
      const lh = ch.legHurt;
      if (!lh || lh.sev < sev) ch.legHurt = { side, sev, t };
    } else if (zone === "legs") {
      ch._sLegsGone = sev > 0.5;
      ch.legHurt = { side: -1, sev, t };
    } else if (zone === "armL" || zone === "armR") {
      ch._sArmHurt = { side: zone === "armR" ? -1 : 1, sev, t };
    } else if (zone === "torso" || zone === "gut") {
      if (!ch._sTorsoHurt || ch._sTorsoHurt.sev < sev) ch._sTorsoHurt = { sev, t };
    }
  }
  function dive(ch, o) { if (!ch) return null; return start(ch, "dive", (o && o.dur) || 0.95); }
  /* o: { ledgeX, ledgeZ (the near edge, world), top (its height), dirX, dirZ
         (the way over), span (its depth), dur (s), style "speed"|"kong" }
     The pose and the hands are the shared traversal's (character.js); the
     ROOT's arc over the wall is the caller's — vaultArc(u, h) is the standard
     one (u = the vault's progress, h = the wall's height over his feet). */
  function vault(ch, o) {
    if (!ch) return null;
    o = o || {};
    const dur = o.dur || 0.6;
    ch.traversePose = { kind: "vault", style: o.style || "speed", t: 0, _soldier: true,
      ledgeX: o.ledgeX, ledgeZ: o.ledgeZ, top: o.top, dirX: o.dirX != null ? o.dirX : 0, dirZ: o.dirZ != null ? o.dirZ : 1, span: o.span || 0.3 };
    return start(ch, "vault", dur);
  }
  function vaultArc(u, h) { return (h + 0.12) * Math.sin(PI * clamp01(u)) * (u < 0.5 ? 1 : 1 - 0.35 * sstep(0.5, 1, u)); }
  function busy(ch) { const A = act(ch); return A ? A.kind : null; }

  CBZ.soldier = { pre, pose, crawl, reload, throwGrenade, hit, wound, dive, vault, vaultArc, busy, gunOf, CARRY };
})();
