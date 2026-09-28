/* ============================================================
   entities/moves_posture.js — CBZ.moves POSTURE: the one way a person in
   any game sits down, lies down, gets up, kneels, crouches or climbs into a
   top bunk.

   Owner, 2026-09-27: "sitting down on the bed in the jail is glitchy." It
   was, for a structural reason: the game had TWO posture systems.
     · city/propuse.js's body arcs (walk → turn → lower …) for registered
       seats and beds, used by the city and the prison's bed sweeps, and
     · world/cellblock.js's "lounge", the cell resident's own bunk sit,
       which put the root ON the seat and set the sit pose IN ONE FRAME
       (`p.x = s.x; p.z = s.z; setCharPose("sit")`, a 0.6 m jump plus a
       pose pop), and got up by writing `p.x += 0.5` — a teleport out of
       the frame.
   And the arcs themselves were a state flip wearing a costume: the seated
   pose was switched on at 35 % of the "lower" beat and the rig then DAMPED
   its hips down toward the cushion on its own clock, so the hips a frame
   after the flip were wherever the damp had got to, not where the arc said.
   A top bunk was worse: the lie arc's perch beat placed the root at the
   bed's anchor y — 1.66 m up — on its first frame. A man levitated into
   the upper rack.

   ONE SEQUENCER NOW. Every transition is a short authored timeline that
   owns the body while it runs (CBZ.moves.busy(actor) is true; movers,
   leashes and colliders skip it), writes an ABSOLUTE transform every frame
   from its own state (so nothing another system did this frame can move
   it), and drives the rig through explicit numbers the rig does not damp:
     ch.seatBlend   0..1  how far the legs have folded into the seat solve
     ch.postureSink       the model's hip drop (m) — the hip height is
                          therefore a curve this file chose, not a damp
     ch.seatLean          extra forward lean (the push of getting up)
     ch.kneelB      0..1  one-knee kneel blend
   entities/character.js's sit / lie / kneel branches read those, and the
   leg geometry both sides use is ONE function here (seatLegs / kneelLegs),
   so the hip the sequencer tracks is the hip the rig draws.

   THE BEATS
     SIT    walk to the approach spot (CBZ.moves.step, arrival latch) → turn
            to the seat's facing at a man's rate (CBZ.moves.face) → a short
            walked back-step until the calves touch → LOWER: the legs fold
            as the hips travel from standing to the cushion over 0.65 s, the
            root travelling back exactly as far as the feet reach forward,
            so the soles stay where they were planted.
     STAND  lean forward (the push) → rise (the lower, reversed, feet
            planted) → WALK OUT to the exit spot (a real step, clear of the
            frame, never a teleport).
     LIE    the SIT onto the mattress edge (the perch), then the SWING: the
            hips stay on the mattress while the legs come up and the body
            rolls onto the pillow — the transform pivots about the HIP, so
            nothing sinks into the bed or floats above it on the way.
     RISE   the swing reversed back to the perch, then STAND.
     CLIMB  a raised bed (a top bunk): walk to the ladder, face it, climb
            rung by rung until the hips are at the mattress, roll on to the
            pillow. Down: roll off to the ladder, climb down, step back.
     KNEEL  one knee down (tending a body), 0.6 s; up again 0.5 s.
     CROUCH a posture flag with the rig's own blend.

   API
     CBZ.moves.sit(actor, spot, opts)    spot {x,y,z,face, cushionH|cushion,
                                         floorBelow, kind, ceiling, entry, exit,
                                         scoot:{x,z,face,kind}}
     CBZ.moves.lie(actor, bed, opts)     bed = a propuse bed record (x,y,z,
                                         hx,hz,len,top,face, entry?, ladder?,
                                         floorY?). A raised bed climbs.
     CBZ.moves.climb(actor, bed, opts)   explicit top-bunk entry
     CBZ.moves.stand(actor, opts)        from whatever posture (sit, lie, kneel)
     CBZ.moves.kneel(actor, opts|false)  opts {face, at:{x,z}}
     CBZ.moves.crouch(actor, on)
     CBZ.moves.posture(actor)            "stand"|"sit"|"lie"|"kneel"|"crouch"|"transition"
     CBZ.moves.busy(actor)               true while a transition owns the body
     opts: instant (commit now, no sequence), onDone(actor, spot),
           onAbort(actor, spot), exit {x,z} (stand).
   A body further than WALK_MAX from its approach spot is refused (false):
   the caller decides whether an instant commit is honest (a spawn) or not.

   Pure math on {x,y,z} + the actor's group: no THREE, so
   tools/moves-sim-posture.mjs runs every timeline in plain node.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;
  const MV = (CBZ.moves = CBZ.moves || {});
  CBZ.CONFIG = CBZ.CONFIG || {};

  const PI = Math.PI, HALF = PI / 2, TAU = PI * 2;
  function wrap(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }   // peak slope 1.5
  const TURN = 5.2;          // rad/s a standing body turns to a seat/ladder (under the 5.6 motor cap)

  /* ==========================================================
     1. RIG GEOMETRY — the numbers the sequencer and the rig share
     ========================================================== */
  const HIP_Y_DEFAULT = 0.95;             // entities/character.js CHARACTER_HIP_Y
  function hsOf(ch) { return (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 1; }
  function hipStandOf(ch) { return (ch && ch.hipY > 0 ? ch.hipY : HIP_Y_DEFAULT) * hsOf(ch); }
  function postOf(ref) {
    if (!ref || CBZ.CONFIG.CHAR_SEAT_POSTURE === false || !CBZ.charSeatPosture) return null;
    return CBZ.charSeatPosture(ref.kind);
  }

  /* THE SEAT SOLVE (moved here out of character.js's sitting branch so the
     sequencer can ask it where the hips and feet END before the rig has ever
     posed the body). Closed forms, unchanged:
       hipF   hip pivot above the floor: cushion + a whisker less than the
              thigh's half-thickness, so the thigh presses into the cushion
       sink   the model's drop to put that hip on it
       th     thigh angle from vertical (forward), fold = knee bend,
       shin   shin scale that lands the sole on the floor / the stool rail
     plus what only a TRANSITION needs:
       reach  horizontal hip → sole distance in the final pose: how far in
              front of the seat the feet are planted before the hips go down
       footY  sole height over the floor in the final pose (> 0: dangling) */
  function seatLegs(ch, ref, post, out) {
    out = out || {};
    const hs = hsOf(ch), pf = ch && ch.profile;
    const THIGH = (pf ? pf.legUp : 0.46) * hs;
    const SHIN = (pf ? pf.legLo + 0.03 : 0.50) * hs;
    const cush = ref && ref.cushion != null ? ref.cushion : 0.45;
    const hipF = Math.max(cush + 0.10 * hs, SHIN * 0.55);
    const hipStand = hipStandOf(ch);
    const railF = post === "stool" ? 0.42 : 0;
    const railY = railF > 0 ? cush * railF : 0;
    const drop = Math.max(0.05, hipF - 0.03 * hs - railY);
    const chairTh = 1.38;
    const chairShin = (drop - THIGH * Math.cos(chairTh)) / SHIN;
    let th, fold, sl = 1;
    if (post === "bunkback") { th = 1.58; fold = 0.12; }
    else if (post === "drive") { th = 1.46; fold = 0.62; }
    else if (chairShin >= 0.82) { th = chairTh; fold = th; sl = clamp(chairShin, 0.88, 1.38); }
    else {
      const a2 = 0.55;
      th = Math.acos(clamp((drop - SHIN * Math.cos(a2)) / THIGH, -0.45, 1));
      fold = Math.max(0.3, th - a2);
    }
    out.thigh = THIGH; out.shin = SHIN; out.hs = hs;
    out.hipF = hipF; out.hipStand = hipStand;
    out.sink = hipF - hipStand - ((ref && ref.floorBelow) || 0);
    out.th = th; out.fold = fold; out.shinScale = sl; out.drop = drop; out.post = post || null;
    out.reach = footFwd(out, 1);
    out.footY = hipF - (THIGH * Math.cos(th) + SHIN * sl * Math.cos(th - fold));
    return out;
  }
  /* THE FOLD, PART WAY. The thigh comes forward linearly in b; the shin's
     length correction (a tall seat's dangle, a chair's reach) grows with how
     far the thigh has actually come forward, 1 - cos, so a body starting to
     sit never pushes its soles through the floor while the knee is still
     straight. character.js poses a transitioning seat with exactly these. */
  function shinAt(L, b) {
    const c = 1 - Math.cos(L.th);
    const k = c > 1e-4 ? (1 - Math.cos(L.th * b)) / c : b;
    return 1 + (L.shinScale - 1) * k;
  }
  // horizontal hip → sole distance with the legs folded a fraction b
  function footFwd(L, b) {
    return L.thigh * Math.sin(L.th * b) + L.shin * shinAt(L, b) * Math.sin((L.th - L.fold) * b);
  }
  // sole depth below the hip pivot with the legs folded a fraction b
  function footDrop(L, b) {
    return L.thigh * Math.cos(L.th * b) + L.shin * shinAt(L, b) * Math.cos((L.th - L.fold) * b);
  }

  /* ONE KNEE DOWN. The left knee on the floor with the shin laid back along
     it; the right foot planted ahead with the thigh near level. Solved from
     THIS rig's own segments so the knee lands on the floor and the forward
     sole on the floor, not a pose typed for one body. */
  function kneelLegs(ch, out) {
    out = out || {};
    const hs = hsOf(ch), pf = ch && ch.profile;
    const THIGH = (pf ? pf.legUp : 0.46) * hs;
    const SHIN = (pf ? pf.legLo + 0.03 : 0.50) * hs;
    const ak = 0.10;                                   // kneeling thigh, a hair forward of vertical
    const kk = ak + 1.48;                              // shin laid back along the floor
    const hip = THIGH * Math.cos(ak) + 0.045 * hs;     // knee cap + thigh
    const af = 1.40;                                   // the planted leg's thigh, near level
    const s = Math.acos(clamp((hip - 0.03 * hs - THIGH * Math.cos(af)) / SHIN, -1, 1));
    out.hip = hip; out.hipStand = hipStandOf(ch); out.sink = hip - out.hipStand;
    out.ak = ak; out.kk = kk; out.af = af; out.kf = af + s;
    return out;
  }

  /* ---- WHERE A BODY LIES (moved from city/propuse.js, unchanged) ------------
     The rig's ORIGIN is its FEET; lying is the standing rig rolled 90° about
     Z. The feet go one body-length short of the head end (crown a pad off the
     head of the mattress), never past the foot end, and the mattress
     clearance is half the body's width under the roll it actually lies at. */
  const LIE_HEAD_PAD = 0.06, LIE_SINK = 0.04;
  const lieTmp = { x: 0, y: 0, z: 0 };
  const lieM = { len: 1.80, rise: 0.30 };
  const SLEEP_SALT_A = 0x51EE9, SLEEP_SALT_B = 0x1EEB;
  function charOf(a) { return a === CBZ.player ? CBZ.playerChar : (a && a.char); }
  function groupOf(a) { const ch = charOf(a); return ch && ch.group ? ch.group : (a && a.group); }
  function sleepStyle(actor) {
    if (actor._propSleepS) return actor._propSleepS;
    const ch = charOf(actor), pf = ch && ch.profile;
    const k = (((ch && ch.skinTone) | 0) >>> 0)
      + Math.round(((ch && ch.hipY) || 0.95) * 1000) * 7
      + Math.round(((pf && pf.torsoW) || 0.90) * 1000) * 31
      + Math.round(((pf && pf.armUp) || 0.46) * 1000) * 131;
    const h1 = CBZ.hash01 ? CBZ.hash01(k * 0.1, (k >>> 7) * 0.1, SLEEP_SALT_A) : 0.5;
    const h2 = CBZ.hash01 ? CBZ.hash01((k >>> 3) * 0.1, k * 0.1, SLEEP_SALT_B) : 0.5;
    const s = { back: h1 < 0.38, fold: h2 < 0.55, vary: h2, phase: h1 * 6.283 };
    actor._propSleepS = s;
    return s;
  }
  function setLying(actor) {
    const ch = charOf(actor);
    if (!ch) return;
    const s = sleepStyle(actor);
    if (ch.lying) { ch.lying.back = s.back; ch.lying.fold = s.fold; ch.lying.vary = s.vary; }
    else ch.lying = { back: s.back, phase: s.phase, fold: s.fold, vary: s.vary };
    ch.sitting = false;
  }
  function lieMetrics(actor) {
    const ch = charOf(actor);
    const m = ch && ch.metric, pf = ch && ch.profile;
    const hs = hsOf(ch);
    lieM.len = (m && m.height > 0.6) ? m.height : 1.80;
    const R = CBZ.charLieRoll;
    const posed = !!(R && actor && CBZ.CONFIG.CHAR_SLEEP_POSE !== false);
    if (pf && pf.torsoW > 0) {
      const th = posed ? (sleepStyle(actor).back ? R.back : R.side) : 0;
      const halfW = (pf.torsoW * Math.cos(th) + (pf.torsoD || pf.torsoW) * Math.sin(th)) * 0.5 * hs;
      lieM.rise = Math.max(0.14, halfW - LIE_SINK);
    } else lieM.rise = 0.30;
    return lieM;
  }
  function liePlace(actor, bed, out) {
    out = out || lieTmp;
    if (!bed) {
      const g0 = actor && groupOf(actor);
      out.x = g0 ? g0.position.x : 0; out.y = g0 ? g0.position.y : 0; out.z = g0 ? g0.position.z : 0;
      return out;
    }
    const M = lieMetrics(actor);
    const half = (bed.len || 2.0) * 0.5;
    const s = Math.max(half - LIE_HEAD_PAD - M.len, -M.len * 0.5);
    out.x = bed.x + bed.hx * s;
    out.z = bed.z + bed.hz * s;
    out.y = (bed.top != null ? bed.top : (bed.lieY != null ? bed.lieY - 0.3 : (bed.y || 0))) + M.rise;
    return out;
  }
  // "sitting on this bed" — the perch before the swing and after the unroll
  function bedSeatRef(bed) {
    return {
      cushion: Math.max(0.30, bed.top - (bed.y || 0)), floorBelow: 0, kind: bed.kind || null,
      ceiling: bed.ceiling != null ? bed.ceiling - (bed.y || 0) : null,
    };
  }
  // the seat a spot describes, in the rig's terms (null = undeclared → legacy pose)
  function refOf(spot) {
    if (!spot) return null;
    if (spot.ref) return spot.ref;
    let r = null;
    if (spot.cushionH != null || spot.cushion != null) {
      r = CBZ.propSeatRef && spot.cushionH != null ? CBZ.propSeatRef(spot) : null;
      if (!r && CBZ.CONFIG.PROPS_SEAT_GEOM !== false) {
        r = { cushion: spot.cushionH != null ? spot.cushionH : spot.cushion, floorBelow: spot.floorBelow || 0,
          kind: spot.kind || null, vary: 0.5 };
      }
    }
    if (r && spot.ceiling != null) r.ceiling = spot.ceiling - (spot.y || 0);
    return r;
  }

  /* ==========================================================
     2. THE SEQUENCER
     ========================================================== */
  const WALK_MAX = 6.5;       // metres of approach a sequence will walk (interaction reach is 3.8)
  const live = [];            // records with a running sequence or a held posture
  function recOf(a) {
    let R = a._pz;
    if (!R) {
      R = a._pz = {
        actor: a, state: "stand", seq: null, x: 0, y: 0, z: 0, yaw: 0, roll: 0,
        b: null, kb: 0, sink: null, lean: 0, spd: 0, ph: null,
        sd: null, ld: null, kd: null, hip: { x: 0, y: 0, z: 0 }, mode: null,
        onDone: null, onAbort: null, spot: null,
      };
    }
    return R;
  }
  function track(R) { if (live.indexOf(R) < 0) live.push(R); }
  function untrack(R) { const i = live.indexOf(R); if (i >= 0) live.splice(i, 1); }
  function readPose(R) {
    const g = groupOf(R.actor);
    if (!g) return false;
    R.x = g.position.x; R.y = g.position.y; R.z = g.position.z;
    R.yaw = g.rotation.y || 0; R.roll = g.rotation.z || 0;
    return true;
  }

  // player body ownership: systems/physics.js early-returns on `_doorArc`
  function ownPlayer(a) {
    if (a !== CBZ.player) return;
    a._doorArc = true; a._propOwnsBody = true; a._doorArcOwner = "prop";
  }
  function freePlayer(a) {
    if (a !== CBZ.player || !a._propOwnsBody) return;
    a._propOwnsBody = false;
    const other = CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active;
    if (a._doorArcOwner === "prop" && !other) a._doorArc = false;
    if (a._doorArcOwner === "prop") a._doorArcOwner = null;
  }

  // a fresh private motor for a sequence's walked beats, carrying the body's
  // current velocity (a man stepping off a walk does not stop dead first)
  function seqMotor(R) {
    const m = MV.motor({});
    MV.reset(m, R);
    m.yaw = R.yaw;
    const am = R.actor._mv;
    if (am && Math.hypot(am.vx, am.vz) < 3) { m.vx = am.vx; m.vz = am.vz; }
    return m;
  }

  function begin(R, kind, names, data) {
    const Q = { kind: kind, names: names, i: 0, t: 0, m: null, abandon: false, snap: null };
    Object.assign(Q, data || {});
    R.seq = Q;
    R.mode = (CBZ.game && CBZ.game.mode) || null;
    R.ph = null;
    Q.m = seqMotor(R);
    enter(R, Q);
    track(R);
    ownPlayer(R.actor);
    return Q;
  }
  // phase start: snapshot where the body is so every beat eases from REALITY
  function enter(R, Q) {
    Q.t = 0;
    Q.sx = R.x; Q.sy = R.y; Q.sz = R.z; Q.syaw = R.yaw; Q.sroll = R.roll;
    Q.sb = R.b == null ? 0 : R.b; Q.skb = R.kb || 0;
    const f = ENTER[Q.names[Q.i]];
    if (f) f(R, Q);
  }

  // ---- rig flag writers (absolute, every frame) ----
  function rigSit(R, ch, ref, blend) {
    ch.lying = null;
    ch.sitting = true; ch.seatRef = ref; ch.seatBlend = blend; ch.kneelB = 0;
  }
  function rigStand(ch) {
    ch.sitting = false; ch.seatRef = null; ch.seatBlend = null; ch.postureSink = null;
    ch.seatLean = 0; ch.lying = null; ch.kneelB = 0;
  }

  const _p = { x: 0, z: 0 };
  const WALK_O = { speed: 1.3, stop: 0.10, accel: 3.6, decel: 3.2 };
  const OUT_O = { speed: 1.1, stop: 0.03, accel: 2.8, decel: 2.6 };
  const BACK_O = { speed: 0.55, stop: 0.02, accel: 2.0, decel: 2.4, face: 0, strafe: true };
  function walkTo(R, Q, tx, tz, dt, o) {
    _p.x = R.x; _p.z = R.z;
    MV.step(Q.m, _p, R.yaw, tx, tz, o, dt);
    if (CBZ.collideSlide && !o.strafe) {
      const s = { x: _p.x, y: R.y, z: _p.z };
      try { CBZ.collideSlide(s, 0.30, R.y, R.y + 1.7, 3); } catch (e) {}
      _p.x = s.x; _p.z = s.z;
    }
    R.x = _p.x; R.z = _p.z; R.yaw = Q.m.yaw; R.spd = Q.m.gs;
    return Math.hypot(tx - R.x, tz - R.z);
  }
  // world offset of a point `h` up the body's own axis under (yaw, roll):
  // three.js 'XYZ' euler, Ry·Rz applied to (0,h,0) = (-h·sinr·cosy, h·cosr, h·sinr·siny)
  function axis(yaw, roll, h, out) {
    const sr = Math.sin(roll);
    out.x = -h * sr * Math.cos(yaw); out.y = h * Math.cos(roll); out.z = h * sr * Math.sin(yaw);
    return out;
  }
  const _ax = { x: 0, y: 0, z: 0 };

  /* ---- PHASES. Each returns true when its beat is over. ------------------ */
  const ENTER = {
    walk(R, Q) {
      MV.reset(Q.m, R); Q.m.yaw = R.yaw;
      // the first beat keeps the pace the body arrived with (no dead stop to start a walk)
      const am = R.actor._mv;
      if (Q.i === 0 && am && Math.hypot(am.vx || 0, am.vz || 0) < 3) { Q.m.vx = am.vx || 0; Q.m.vz = am.vz || 0; }
    },
    back(R, Q) { MV.reset(Q.m, R); Q.m.yaw = R.yaw; },
    out(R, Q) { MV.reset(Q.m, R); Q.m.yaw = R.yaw; },
  };
  const PH = {
    // walk to the approach spot: the ordinary locomotion layer, arrival latch included
    walk(R, Q, dt) {
      const d = walkTo(R, Q, Q.wx, Q.wz, dt, WALK_O);
      if (Q.m.arrived || d < 0.12) { R.spd = 0; return true; }
      // out of time: close enough and the next beat eases the rest; too far and it is refused
      if (Q.t > Q.wcap) { if (d > 1.2) Q.abandon = true; R.spd = 0; return true; }
      return false;
    },
    // turn on the spot to the facing the next beat needs (bounded rate)
    turn(R, Q, dt) {
      const want = Q.faceTo;
      R.yaw = MV.turnToward(R.yaw, want, TURN * dt);
      R.spd = 0;
      if (Math.abs(wrap(R.yaw - want)) < 1e-3 || Q.t > 1.5) { R.yaw = want; return true; }
      return false;
    },
    // a walked back-step until the calves meet the seat (face held, legs go backwards)
    back(R, Q, dt) {
      BACK_O.face = Q.faceTo;
      const d = walkTo(R, Q, Q.bx, Q.bz, dt, BACK_O);
      R.yaw = Q.faceTo;
      if (Q.m.arrived || d < 0.03 || Q.t > 2.5) { R.spd = 0; return true; }
      return false;
    },
    // LOWER: legs fold, hips travel down/back onto the cushion, soles stay planted
    lower(R, Q, dt) {
      const sd = R.seat, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 0.65), b = smooth(u);
      R.yaw = sd.face; R.spd = 0;
      if (sd.legs) {
        const k = sd.reach > 1e-3 ? footFwd(sd.legs, b) / sd.reach : b;
        R.x = Q.sx + (sd.S.x - Q.sx) * k; R.z = Q.sz + (sd.S.z - Q.sz) * k;
        R.y = sd.S.y;
        R.b = b; R.sink = sd.legs.sink * b;
        rigSit(R, ch, sd.ref, b);
      } else {
        // an undeclared seat: the rig's legacy pose, switched in as the hips land
        R.x = Q.sx + (sd.S.x - Q.sx) * b; R.z = Q.sz + (sd.S.z - Q.sz) * b; R.y = sd.S.y;
        R.b = null; R.sink = null;
        ch.crouch = u > 0.08 && u < 0.55;
        if (u >= 0.35) rigSit(R, ch, null, null); else { ch.sitting = false; }
      }
      return u >= 1;
    },
    // slide down the mattress into the relaxed "back" perch (a bunk)
    scoot(R, Q, dt) {
      const sd = R.seat, sc = sd.scoot, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 0.8), e = smooth(u);
      R.x = sd.S.x + (sc.x - sd.S.x) * e; R.z = sd.S.z + (sc.z - sd.S.z) * e;
      R.yaw = sd.face + wrap(sc.face - sd.face) * e;
      rigSit(R, ch, u >= 0.5 ? sd.ref2 : sd.ref, 1);
      R.b = 1; R.sink = sd.legs ? sd.legs.sink : null;
      if (u >= 1) sd.scooted = true;
      return u >= 1;
    },
    unscoot(R, Q, dt) {
      const sd = R.seat, sc = sd.scoot, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 0.7), e = smooth(u);
      R.x = sc.x + (sd.S.x - sc.x) * e; R.z = sc.z + (sd.S.z - sc.z) * e;
      R.yaw = sc.face + wrap(sd.face - sc.face) * e;
      rigSit(R, ch, u >= 0.5 ? sd.ref : sd.ref2, 1);
      R.b = 1; R.sink = sd.legs ? sd.legs.sink : null;
      if (u >= 1) sd.scooted = false;
      return u >= 1;
    },
    // the push: weight forward over the knees before the legs extend
    push(R, Q, dt) {
      const sd = R.seat, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 0.25);
      R.lean = 0.34 * smooth(u);
      R.yaw = sd.face;
      rigSit(R, ch, sd.ref, sd.legs ? Q.sb || 1 : null);
      return u >= 1;
    },
    // rise: the lower reversed, feet planted, lean easing off
    rise(R, Q, dt) {
      const sd = R.seat, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 0.7), e = smooth(u);
      R.yaw = sd.face; R.spd = 0;
      R.lean = 0.34 * (1 - e);
      if (sd.legs) {
        const b = Q.sb * (1 - e);
        const k = sd.reach > 1e-3 ? footFwd(sd.legs, b) / sd.reach : b;
        R.x = sd.B.x + (sd.S.x - sd.B.x) * k; R.z = sd.B.z + (sd.S.z - sd.B.z) * k;
        R.b = b; R.sink = sd.legs.sink * b;
        rigSit(R, ch, sd.ref, b);
      } else {
        R.x = sd.S.x + (sd.B.x - sd.S.x) * e; R.z = sd.S.z + (sd.B.z - sd.S.z) * e;
        ch.crouch = u < 0.75;
        if (u > 0.05) { ch.sitting = false; ch.seatRef = null; }
      }
      R.y = sd.S.y;
      if (u >= 1) { rigStand(ch); ch.crouch = false; R.b = null; R.sink = null; R.lean = 0; }
      return u >= 1;
    },
    // walk out, clear of the furniture
    out(R, Q, dt) {
      const d = walkTo(R, Q, Q.ox, Q.oz, dt, OUT_O);
      return Q.m.arrived || d < 0.04 || Q.t > 4;
    },
    // LIE: from the perch, pivot about the hip onto the pillow
    swing(R, Q, dt) {
      const ld = R.lie, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / ld.swDur), e = smooth(u);
      const hx = ld.H0.x + (ld.H1.x - ld.H0.x) * e, hy = ld.H0.y + (ld.H1.y - ld.H0.y) * e, hz = ld.H0.z + (ld.H1.z - ld.H0.z) * e;
      R.yaw = ld.Y0 + ld.dy * e; R.roll = HALF * e;
      const sink = ld.sinkP * (1 - e);
      axis(R.yaw, R.roll, ld.hipStand + sink, _ax);
      R.x = hx - _ax.x; R.y = hy - _ax.y; R.z = hz - _ax.z;
      R.hip.x = hx; R.hip.y = hy; R.hip.z = hz; R.hipOwn = true;
      R.sink = sink; R.b = 1; R.spd = 0;
      if (u < 0.15) rigSit(R, ch, ld.ref, 1);
      else { ch.sitting = false; ch.seatRef = null; ch.seatBlend = null; if (!ch.lying) setLying(R.actor); }
      return u >= 1;
    },
    unroll(R, Q, dt) {
      const ld = R.lie, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / ld.swDur), e = smooth(u);
      const hx = ld.H1.x + (ld.H0.x - ld.H1.x) * e, hy = ld.H1.y + (ld.H0.y - ld.H1.y) * e, hz = ld.H1.z + (ld.H0.z - ld.H1.z) * e;
      R.yaw = ld.Y0 + ld.dy * (1 - e); R.roll = HALF * (1 - e);
      const sink = ld.sinkP * e;
      axis(R.yaw, R.roll, ld.hipStand + sink, _ax);
      R.x = hx - _ax.x; R.y = hy - _ax.y; R.z = hz - _ax.z;
      R.hip.x = hx; R.hip.y = hy; R.hip.z = hz; R.hipOwn = true;
      R.sink = sink; R.spd = 0;
      if (u < 0.8) { if (!ch.lying) setLying(R.actor); ch.sitting = false; }
      else { R.b = 1; rigSit(R, ch, ld.ref, 1); }
      if (u >= 1) { R.roll = 0; R.b = 1; rigSit(R, ch, ld.ref, 1); }
      return u >= 1;
    },
    // CLIMB: onto the bottom rung
    toRung(R, Q, dt) {
      const ld = R.lie;
      const u = Math.min(1, Q.t / 0.45), e = smooth(u);
      R.x = Q.sx + (ld.Q.x - Q.sx) * e; R.z = Q.sz + (ld.Q.z - Q.sz) * e; R.y = ld.floorY;
      R.yaw = ld.yawL; R.spd = 0.7 * (1 - Math.abs(2 * u - 1));
      return u >= 1;
    },
    // rung by rung (each rung its own eased step — never a lift)
    climb(R, Q, dt) {
      const ld = R.lie;
      const dur = Math.max(0.8, (ld.yTop - ld.floorY) / 0.75);
      const u = Math.min(1, Q.t / dur);
      const n = ld.rungs, f = u * n, k = Math.min(n - 1, Math.floor(f));
      const s = (k + smooth(f - k)) / n;
      R.x = ld.Q.x; R.z = ld.Q.z; R.yaw = ld.yawL;
      R.y = ld.floorY + (ld.yTop - ld.floorY) * s;
      R.spd = 0.9;
      return u >= 1;
    },
    descend(R, Q, dt) {
      const ld = R.lie;
      const dur = Math.max(0.8, (ld.yTop - ld.floorY) / 0.85);
      const u = Math.min(1, Q.t / dur);
      const n = ld.rungs, f = u * n, k = Math.min(n - 1, Math.floor(f));
      const s = (k + smooth(f - k)) / n;
      R.x = ld.Q.x; R.z = ld.Q.z; R.yaw = ld.yawL; R.roll = 0;
      R.y = ld.yTop + (ld.floorY - ld.yTop) * s;
      R.spd = 0.9;
      return u >= 1;
    },
    offRung(R, Q, dt) {
      const ld = R.lie;
      const u = Math.min(1, Q.t / 0.5), e = smooth(u);
      R.x = ld.Q.x + (ld.F.x - ld.Q.x) * e; R.z = ld.Q.z + (ld.F.z - ld.Q.z) * e; R.y = ld.floorY;
      R.yaw = ld.yawL; R.spd = 0.6 * (1 - Math.abs(2 * u - 1));
      return u >= 1;
    },
    // top of the ladder → onto the pillow, pivoting about the hips at the mattress
    rollOn(R, Q, dt) {
      const ld = R.lie, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 1.2), e = smooth(u);
      const hx = ld.H0.x + (ld.H1.x - ld.H0.x) * e, hy = ld.H0.y + (ld.H1.y - ld.H0.y) * e, hz = ld.H0.z + (ld.H1.z - ld.H0.z) * e;
      R.yaw = ld.Y0 + ld.dy * e; R.roll = HALF * e;
      axis(R.yaw, R.roll, ld.hipStand, _ax);
      R.x = hx - _ax.x; R.y = hy - _ax.y; R.z = hz - _ax.z;
      R.hip.x = hx; R.hip.y = hy; R.hip.z = hz; R.hipOwn = true;
      R.spd = 0; ch.crouch = u < 0.4;
      if (u > 0.25 && !ch.lying) setLying(R.actor);
      return u >= 1;
    },
    rollOff(R, Q, dt) {
      const ld = R.lie, ch = charOf(R.actor);
      const u = Math.min(1, Q.t / 1.1), e = smooth(u);
      const hx = ld.H1.x + (ld.H0.x - ld.H1.x) * e, hy = ld.H1.y + (ld.H0.y - ld.H1.y) * e, hz = ld.H1.z + (ld.H0.z - ld.H1.z) * e;
      R.yaw = ld.Y0 + ld.dy * (1 - e); R.roll = HALF * (1 - e);
      axis(R.yaw, R.roll, ld.hipStand, _ax);
      R.x = hx - _ax.x; R.y = hy - _ax.y; R.z = hz - _ax.z;
      R.hip.x = hx; R.hip.y = hy; R.hip.z = hz; R.hipOwn = true;
      R.spd = 0; ch.crouch = u > 0.6;
      if (u > 0.75) { ch.lying = null; }
      if (u >= 1) { R.roll = 0; ch.crouch = false; }
      return u >= 1;
    },
    // one knee down / up
    kneelDown(R, Q, dt) {
      const ch = charOf(R.actor), kd = R.kneel;
      const u = Math.min(1, Q.t / 0.6), e = smooth(u);
      R.kb = e; R.sink = kd.sink * e; ch.kneelB = e; ch.sitting = false; ch.lying = null;
      R.spd = 0;
      return u >= 1;
    },
    kneelUp(R, Q, dt) {
      const ch = charOf(R.actor), kd = R.kneel;
      const u = Math.min(1, Q.t / 0.5), e = smooth(u);
      const k = Q.skb * (1 - e);
      R.kb = k; R.sink = kd.sink * k; ch.kneelB = k;
      R.spd = 0;
      if (u >= 1) { ch.kneelB = 0; R.kb = 0; R.sink = null; }
      return u >= 1;
    },
  };

  /* ---- write the sequencer's state to the body (absolute, every frame) ---- */
  function apply(R) {
    const a = R.actor, g = groupOf(a), ch = charOf(a);
    if (!g) return;
    g.position.x = R.x; g.position.y = R.y; g.position.z = R.z;
    g.rotation.y = R.yaw; g.rotation.z = R.roll; g.rotation.x = 0;
    if (a.pos && a.pos !== g.position) { if (a.pos.set) a.pos.set(R.x, R.y, R.z); else { a.pos.x = R.x; a.pos.y = R.y; a.pos.z = R.z; } }
    if (a === CBZ.player) { a.vy = 0; a.grounded = true; a.stun = Math.max(a.stun || 0, 0.15); }
    if (ch) {
      ch.postureSink = R.sink;
      ch.seatLean = R.lean || 0;
    }
    // hip diagnostic (the sim reads it; cheap): standing hip + the sink, up the body axis
    if (R.seq && !R.hipOwn) {
      const hs = R.legsHip != null ? R.legsHip : hipStandOf(ch);
      axis(R.yaw, R.roll, hs + (R.sink || 0), _ax);
      R.hip.x = R.x + _ax.x; R.hip.y = R.y + _ax.y; R.hip.z = R.z + _ax.z;
    }
  }

  function animate(R, dt) {
    const ch = charOf(R.actor);
    if (!ch || !CBZ.animChar) return;
    // a mover that ALSO animated this rig this frame advanced its gait phase;
    // put it back so the stride is ours alone (no double-speed feet)
    if (R.ph != null && ch.phase !== R.ph) ch.phase = R.ph;
    try { CBZ.animChar(ch, R.spd || 0, dt); } catch (e) {}
    R.ph = ch.phase;
  }

  function finish(R) {
    const Q = R.seq, a = R.actor, ch = charOf(a);
    R.seq = null;
    freePlayer(a);
    const cbDone = R.onDone, spot = R.spot;
    R.onDone = null;
    if (Q.abandon) { abort(R, true); return; }
    if (Q.kind === "sit") {
      R.state = "sit"; R.b = null; R.lean = 0;
      if (ch) { ch.seatBlend = null; ch.seatLean = 0; ch.crouch = false; }
    } else if (Q.kind === "lie" || Q.kind === "climb") {
      R.state = "lie"; R.b = null; R.sink = null; R.roll = HALF;
      if (ch) { ch.seatBlend = null; ch.postureSink = null; ch.crouch = false; if (!ch.lying) setLying(a); }
    } else if (Q.kind === "kneel") {
      R.state = "kneel";
    } else {
      R.state = "stand"; R.b = null; R.sink = null; R.lean = 0; R.kb = 0; R.roll = 0;
      if (ch) { rigStand(ch); ch.crouch = false; }
      handBack(R);
      untrack(R);
      R.sd = R.ld = R.kd = null; R.seat = R.lie = R.kneel = null; R.spot = null;
    }
    if (cbDone) { try { cbDone(a, spot); } catch (e) {} }
  }
  // the body's own mover takes over from rest, where it now stands
  function handBack(R) {
    const a = R.actor, g = groupOf(a);
    if (!g) return;
    if (a._mv) MV.reset(a._mv, g.position);
    if (a._mv) a._mv.yaw = g.rotation.y;
    if (a._vx != null) { a._vx = 0; a._vz = 0; }
    if (a.target && a.target.set && a !== CBZ.player) a.target.set(g.position.x, a.target.y || 0, g.position.z);
    if (a === CBZ.player) { a.stun = 0; }
  }
  // something bigger took the body (death, KO, a car, a mode change, a stall)
  function abort(R, stall) {
    const a = R.actor, ch = charOf(a), g = groupOf(a);
    const cb = R.onAbort, spot = R.spot;
    R.seq = null; R.onDone = null; R.onAbort = null;
    freePlayer(a);
    R.state = "stand"; R.b = null; R.sink = null; R.lean = 0; R.kb = 0;
    if (ch) { rigStand(ch); ch.crouch = false; }
    if (g) { g.rotation.z = 0; g.rotation.x = 0; }
    if (a === CBZ.player) a.stun = 0;
    if (stall) handBack(R);
    untrack(R);
    R.sd = R.ld = R.kd = null; R.seat = R.lie = R.kneel = null; R.spot = null;
    if (cb) { try { cb(a, spot); } catch (e) {} }
  }
  function stale(a) {
    if (!a) return true;
    if (a.dead || a._death || a._recycled || a._despawned) return true;
    if (a !== CBZ.player && !groupOf(a)) return true;
    return false;
  }
  function claimedAway(R) {
    const a = R.actor;
    if (stale(a) || (a.ko | 0) > 0 || a.driving) return true;
    const g = CBZ.game;
    if (g && R.mode != null && g.mode !== R.mode) return true;
    if (a === CBZ.player) {
      if (a._aircraft || a._swim) return true;
      if (a._phys && (a._phys.air || (a._phys.down | 0) > 0)) return true;
      if (CBZ.cineActive && CBZ.cineActive()) return true;
      if (R.seq && a._doorArcOwner && a._doorArcOwner !== "prop") return true;
      if (R.seq && CBZ.aircraftDoorArc && CBZ.aircraftDoorArc.active) return true;
    }
    return false;
  }

  // one frame for every sequence and every held posture
  function tick(dt) {
    if (!live.length) return;
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    for (let i = live.length - 1; i >= 0; i--) {
      const R = live[i];
      if (!R) { live.splice(i, 1); continue; }
      const a = R.actor;
      if (a._npcAttached) continue;                     // npclife's seat owns the transform
      if (claimedAway(R)) { abort(R); continue; }
      const Q = R.seq;
      if (Q) {
        const f = PH[Q.names[Q.i]];
        let done = !f;
        R.hipOwn = false;
        if (f) {
          const fin = f(R, Q, dt);
          Q.t += dt;
          if (Q.abandon) done = true;
          else if (fin) {
            Q.i++;
            if (Q.i >= Q.names.length) done = true;
            else enter(R, Q);                           // the next beat starts from exactly here
          }
        }
        apply(R);
        animate(R, dt);
        if (done) finish(R);
      } else hold(R);
    }
  }
  // a held posture: the body stays exactly where its sequence put it
  function hold(R) {
    const a = R.actor, ch = charOf(a);
    if (!ch) return;
    if (R.state === "sit") {
      /* SOMEBODY ELSE STOOD HIM UP. A seated NPC's flag is the contract every
         system already honours: city/peds.js clears it on an interrupt (a
         threat, a hit, a gun), a verb clears it to grab him. The hold yields
         the moment it is gone (the claim goes with it) instead of sitting
         him back down against his own brain. The player's seat is exited
         through the Stand up verb or propuse's force-exit, never a flag. */
      if (!ch.sitting && a !== CBZ.player) { abort(R); return; }
      const sd = R.seat;
      const sp = sd && sd.scooted ? sd.scoot : sd && sd.S;
      if (sp) { R.x = sp.x; R.z = sp.z; R.y = sd.S.y; R.yaw = sd.scooted ? sd.scoot.face : sd.face; }
      R.roll = 0; R.sink = null;
      ch.sitting = true; ch.lying = null; ch.seatBlend = null; ch.seatLean = 0;
      if (sd) ch.seatRef = sd.scooted ? sd.ref2 : sd.ref;
    } else if (R.state === "lie") {
      const ld = R.lie;
      if (ld) { R.x = ld.Lp.x; R.y = ld.Lp.y; R.z = ld.Lp.z; R.yaw = ld.f; }
      R.roll = HALF; R.sink = null;
      ch.sitting = false; ch.seatBlend = null;
      if (!ch.lying) setLying(a);
    } else if (R.state === "kneel") {
      ch.kneelB = 1; R.kb = 1;
      if (R.kneel) R.sink = R.kneel.sink;
    } else { untrack(R); return; }
    apply(R);
  }

  /* ==========================================================
     3. THE VERBS
     ========================================================== */
  function ready(a) {
    const ch = charOf(a);
    return !!(a && ch && groupOf(a) && !stale(a) && !((a.ko | 0) > 0) && !a.driving);
  }
  // a player body someone else is already moving (aircraft boarding, a cutscene) is not ours
  function playerTaken(a) { return a === CBZ.player && a._doorArc && !a._propOwnsBody; }

  function seatData(ch, spot) {
    const ref = refOf(spot);
    const legs = ref ? seatLegs(ch, ref, postOf(ref), {}) : null;
    const face = spot.face || 0;
    const fx = Math.sin(face), fz = Math.cos(face);
    const reach = legs ? clamp(legs.reach, 0.05, 0.7) : 0.30;
    const S = { x: spot.x, y: spot.y || 0, z: spot.z };
    const B = { x: S.x + fx * reach, z: S.z + fz * reach };
    // where a body stands to get on: the spot's own, else propuse's collider-
    // probed entry (front, sides, behind: a desk chair is approached from the
    // side, never through the desk), else straight out front
    let E = spot.entry;
    if (!E && CBZ.propEntryPoint) { const e = CBZ.propEntryPoint(spot); if (e && e.ok) E = e; }
    if (!E) E = { x: S.x + fx * Math.max(0.62, reach + 0.3), z: S.z + fz * Math.max(0.62, reach + 0.3) };
    const sd = {
      spot: spot, ref: ref, legs: legs, face: face, reach: legs ? footFwd(legs, 1) : reach,
      S: S, B: B, E: { x: E.x, z: E.z }, exit: spot.exit ? { x: spot.exit.x, z: spot.exit.z } : { x: E.x, z: E.z },
      scoot: null, ref2: null, scooted: false,
    };
    if (spot.scoot) {
      sd.scoot = spot.scoot;
      sd.ref2 = Object.assign({}, ref || {}, { kind: spot.scoot.kind || (ref && ref.kind) });
    }
    return sd;
  }

  // the approach: walk (if needed) → turn → back-step. Returns the beat list.
  function approach(R, sd, Q) {
    const names = [];
    const dE = Math.hypot(R.x - sd.E.x, R.z - sd.E.z);
    // already in front of the seat, within a stride of the calves-touch spot:
    // no need to walk round to the approach spot first
    const fx = Math.sin(sd.face), fz = Math.cos(sd.face);
    const inFront = (R.x - sd.S.x) * fx + (R.z - sd.S.z) * fz > sd.reach * 0.6;
    const dB = Math.hypot(R.x - sd.B.x, R.z - sd.B.z);
    if (dE > 0.15 && !(inFront && dB < 0.7)) { names.push("walk"); Q.wx = sd.E.x; Q.wz = sd.E.z; Q.wcap = 2.2 + dE / 0.9; }
    names.push("turn"); Q.faceTo = sd.face;
    names.push("back"); Q.bx = sd.B.x; Q.bz = sd.B.z;
    return names;
  }

  MV.sit = function (a, spot, opts) {
    opts = opts || {};
    if (!a || !spot || !ready(a)) return false;
    const R = recOf(a), ch = charOf(a);
    if (R.seq) return false;
    if (R.state === "sit" && R.spot === spot) return true;
    if (R.state !== "stand" && R.state !== "crouch") return false;
    readPose(R);
    const sd = seatData(ch, spot);
    R.seat = sd; R.sd = sd; R.spot = spot;
    R.legsHip = sd.legs ? sd.legs.hipStand : null;
    R.onDone = opts.onDone || null; R.onAbort = opts.onAbort || null;
    ch.crouch = false;
    const far = Math.hypot(R.x - sd.E.x, R.z - sd.E.z) > WALK_MAX || Math.abs(R.y - sd.S.y) > 0.6;
    if (opts.instant || playerTaken(a)) {
      R.x = sd.scoot ? sd.scoot.x : sd.S.x; R.z = sd.scoot ? sd.scoot.z : sd.S.z; R.y = sd.S.y;
      R.yaw = sd.scoot ? sd.scoot.face : sd.face; R.roll = 0;
      sd.scooted = !!sd.scoot;
      R.state = "sit"; R.mode = (CBZ.game && CBZ.game.mode) || null;
      rigSit(R, ch, sd.scooted ? sd.ref2 : sd.ref, null);
      track(R); apply(R);
      const cb = R.onDone; R.onDone = null;
      if (cb) { try { cb(a, spot); } catch (e) {} }
      return true;
    }
    if (far) { R.seat = R.sd = null; R.spot = null; R.onDone = R.onAbort = null; return false; }
    const Q = { };
    const names = approach(R, sd, Q);
    names.push("lower");
    if (sd.scoot) names.push("scoot");
    begin(R, "sit", names, Q);
    return true;
  };

  /* LIE: a bed record. A raised bed (a top bunk) is climbed into. */
  function raised(bed) {
    if (bed.ladder) return true;
    return bed.floorY != null && (bed.y || 0) - bed.floorY > 0.5;
  }
  function lieData(a, bed, sideHint) {
    const ch = charOf(a);
    const f = bed.face != null ? bed.face : Math.atan2(bed.hz || 0, -(bed.hx || 0));
    const Lp = liePlace(a, bed, {});
    const hipStand = hipStandOf(ch);
    const ux = -Math.cos(f), uz = Math.sin(f);       // toward the head end under the lie roll
    const ld = { bed: bed, f: f, Lp: Lp, hipStand: hipStand, raised: false };
    ld.H1 = { x: Lp.x + ux * hipStand, y: Lp.y, z: Lp.z + uz * hipStand };
    // which long side: the entry point's, else the side the body is on
    const lx = bed.hz || 0, lz = -(bed.hx || 0);    // lateral (across the mattress)
    let E = bed.entry;
    if (!E && bed._reg && CBZ.propEntryPoint) { const e = CBZ.propEntryPoint(bed); if (e) E = e; }
    let side;
    if (E) side = ((E.x - bed.x) * lx + (E.z - bed.z) * lz) >= 0 ? 1 : -1;
    else side = sideHint || 1;
    if (!E) E = { x: bed.x + lx * side * 0.95, z: bed.z + lz * side * 0.95 };
    ld.side = side;
    const P = { x: bed.x + lx * side * 0.34, z: bed.z + lz * side * 0.34 };
    const outFace = Math.atan2(lx * side, lz * side);
    const spot = { x: P.x, y: bed.y || 0, z: P.z, face: outFace, ref: bedSeatRef(bed), entry: { x: E.x, z: E.z } };
    ld.seat = seatData(ch, spot);
    ld.ref = ld.seat.ref;
    ld.Y0 = outFace;
    ld.dy = wrap(f - outFace);
    ld.swDur = Math.abs(ld.dy) > 2 ? 1.15 : 0.9;
    const legs = ld.seat.legs;
    ld.sinkP = legs ? legs.sink : 0;
    ld.H0 = { x: P.x, y: (bed.y || 0) + (legs ? legs.hipF - (ld.ref.floorBelow || 0) : hipStand), z: P.z };
    return ld;
  }
  function climbData(a, bed) {
    const ch = charOf(a);
    const f = bed.face != null ? bed.face : Math.atan2(bed.hz || 0, -(bed.hx || 0));
    const Lp = liePlace(a, bed, {});
    const hipStand = hipStandOf(ch);
    const hx = bed.hx || 0, hz = bed.hz || 0;      // toward the pillow
    const floorY = bed.floorY != null ? bed.floorY : 0;
    const top = bed.top != null ? bed.top : (bed.y || 0) + 0.6;
    const half = (bed.len || 2.0) * 0.5;
    const lad = bed.ladder && bed.ladder.x != null ? bed.ladder
      : { x: bed.x - hx * (half + 0.12), z: bed.z - hz * (half + 0.12) };
    const ld = { bed: bed, f: f, Lp: Lp, hipStand: hipStand, raised: true, floorY: floorY };
    ld.yawL = Math.atan2(hx, hz);                   // facing the ladder = facing the pillow
    ld.Q = { x: lad.x - hx * 0.22, z: lad.z - hz * 0.22 };           // body on the rungs
    ld.F = { x: lad.x - hx * 0.62, z: lad.z - hz * 0.62 };           // standing spot behind it
    ld.yTop = top - hipStand + 0.04;                // hips just over the mattress
    ld.rungs = Math.max(2, Math.round((ld.yTop - floorY) / 0.38));
    const ux = -Math.cos(f), uz = Math.sin(f);
    ld.H1 = { x: Lp.x + ux * hipStand, y: Lp.y, z: Lp.z + uz * hipStand };
    ld.H0 = { x: ld.Q.x, y: ld.yTop + hipStand, z: ld.Q.z };
    ld.Y0 = ld.yawL; ld.dy = wrap(f - ld.yawL);
    return ld;
  }

  MV.lie = function (a, bed, opts) {
    opts = opts || {};
    if (!a || !bed || !ready(a)) return false;
    if (raised(bed)) return MV.climb(a, bed, opts);
    const R = recOf(a), ch = charOf(a);
    if (R.seq) return false;
    if (R.state === "lie" && R.spot === bed) return true;
    if (R.state !== "stand" && R.state !== "crouch") return false;
    readPose(R);
    const lx = bed.hz || 0, lz = -(bed.hx || 0);
    const ld = lieData(a, bed, ((R.x - bed.x) * lx + (R.z - bed.z) * lz) >= 0 ? 1 : -1);
    R.lie = ld; R.ld = ld; R.seat = ld.seat; R.sd = ld.seat; R.spot = bed;
    R.legsHip = ld.hipStand;
    R.onDone = opts.onDone || null; R.onAbort = opts.onAbort || null;
    ch.crouch = false;
    if (opts.instant || playerTaken(a)) {
      R.x = ld.Lp.x; R.y = ld.Lp.y; R.z = ld.Lp.z; R.yaw = ld.f; R.roll = HALF;
      R.state = "lie"; R.mode = (CBZ.game && CBZ.game.mode) || null;
      ch.sitting = false; ch.seatRef = null; ch.seatBlend = null; setLying(a);
      track(R); apply(R);
      const cb = R.onDone; R.onDone = null;
      if (cb) { try { cb(a, bed); } catch (e) {} }
      return true;
    }
    if (Math.hypot(R.x - ld.seat.E.x, R.z - ld.seat.E.z) > WALK_MAX) {
      R.lie = R.ld = R.seat = R.sd = null; R.spot = null; R.onDone = R.onAbort = null; return false;
    }
    const Q = {};
    const names = approach(R, ld.seat, Q);
    names.push("lower", "swing");
    begin(R, "lie", names, Q);
    return true;
  };

  MV.climb = function (a, bed, opts) {
    opts = opts || {};
    if (!a || !bed || !ready(a)) return false;
    const R = recOf(a), ch = charOf(a);
    if (R.seq) return false;
    if (R.state === "lie" && R.spot === bed) return true;
    if (R.state !== "stand" && R.state !== "crouch") return false;
    readPose(R);
    const ld = climbData(a, bed);
    R.lie = ld; R.ld = ld; R.seat = null; R.sd = null; R.spot = bed;
    R.legsHip = ld.hipStand;
    R.onDone = opts.onDone || null; R.onAbort = opts.onAbort || null;
    ch.crouch = false;
    if (opts.instant || playerTaken(a)) {
      R.x = ld.Lp.x; R.y = ld.Lp.y; R.z = ld.Lp.z; R.yaw = ld.f; R.roll = HALF;
      R.state = "lie"; R.mode = (CBZ.game && CBZ.game.mode) || null;
      ch.sitting = false; setLying(a);
      track(R); apply(R);
      const cb = R.onDone; R.onDone = null;
      if (cb) { try { cb(a, bed); } catch (e) {} }
      return true;
    }
    if (Math.hypot(R.x - ld.F.x, R.z - ld.F.z) > WALK_MAX || Math.abs(R.y - ld.floorY) > 0.6) {
      R.lie = R.ld = null; R.spot = null; R.onDone = R.onAbort = null; return false;
    }
    const Q = { faceTo: ld.yawL };
    const names = [];
    const dF = Math.hypot(R.x - ld.F.x, R.z - ld.F.z);
    if (dF > 0.15) { names.push("walk"); Q.wx = ld.F.x; Q.wz = ld.F.z; Q.wcap = 2.2 + dF / 0.9; }
    R.y = ld.floorY;
    names.push("turn", "toRung", "climb", "rollOn");
    begin(R, "climb", names, Q);
    return true;
  };

  MV.kneel = function (a, opts) {
    if (opts === false) return MV.stand(a);
    opts = opts || {};
    if (!a || !ready(a)) return false;
    const R = recOf(a), ch = charOf(a);
    if (R.seq) return false;
    if (R.state === "kneel") return true;
    if (R.state !== "stand" && R.state !== "crouch") return false;
    readPose(R);
    R.kneel = kneelLegs(ch, {}); R.kd = R.kneel; R.spot = opts.at || null;
    R.legsHip = R.kneel.hipStand;
    R.onDone = opts.onDone || null; R.onAbort = opts.onAbort || null;
    ch.crouch = false;
    if (opts.instant) {
      R.state = "kneel"; R.kb = 1; R.sink = R.kneel.sink; ch.kneelB = 1;
      R.mode = (CBZ.game && CBZ.game.mode) || null;
      track(R); apply(R); return true;
    }
    const Q = {};
    const names = [];
    if (opts.at) {
      const d = Math.hypot(R.x - opts.at.x, R.z - opts.at.z);
      if (d > WALK_MAX) return false;
      if (d > 0.15) { names.push("walk"); Q.wx = opts.at.x; Q.wz = opts.at.z; Q.wcap = 2.2 + d / 0.9; }
    }
    let face = opts.face;
    if (face == null && opts.look) face = Math.atan2(opts.look.x - (opts.at ? opts.at.x : R.x), opts.look.z - (opts.at ? opts.at.z : R.z));
    if (face != null) { names.push("turn"); Q.faceTo = face; }
    names.push("kneelDown");
    begin(R, "kneel", names, Q);
    return true;
  };

  MV.crouch = function (a, on) {
    const ch = a && charOf(a);
    if (!ch) return false;
    const R = recOf(a);
    if (R.seq || (R.state !== "stand" && R.state !== "crouch")) return false;
    ch.crouch = !!on;
    R.state = on ? "crouch" : "stand";
    return true;
  };

  /* STAND — out of whatever posture, the way in reversed, and a walk clear. */
  MV.stand = function (a, opts) {
    opts = opts || {};
    if (!a) return false;
    const R = a._pz, ch = charOf(a);
    if (!R || (R.state === "stand" && !R.seq) || R.state === "crouch") {
      if (R && R.state === "crouch" && ch) { ch.crouch = false; R.state = "stand"; }
      if (ch && opts.instant) { rigStand(ch); const g = groupOf(a); if (g) { g.rotation.z = 0; g.rotation.x = 0; } }
      return true;
    }
    const Q0 = R.seq;
    // mid-transition: a sequence still WALKING in has not sat anything yet — just stop
    if (Q0) {
      const nm = Q0.names[Q0.i];
      if (Q0.kind === "stand") return true;                   // already getting up
      if (nm === "walk" || nm === "turn" || nm === "back" || nm === "toRung") {
        R.seq = null; freePlayer(a);
        R.state = "stand"; if (ch) rigStand(ch);
        handBack(R); untrack(R);
        R.spot = null; R.onDone = null; R.onAbort = null;
        return true;
      }
    }
    if (opts.instant || !ready(a) || playerTaken(a)) { instantStand(R); return true; }
    R.onDone = opts.onDone || null; R.onAbort = null;
    const Q = {};
    let names;
    if (Q0) {                                                  // mid-sit or mid-lie: reverse from here
      const nm = Q0.names[Q0.i];
      if (Q0.kind === "sit") names = (nm === "scoot" ? ["unscoot"] : []).concat(["push", "rise", "out"]);
      else if (Q0.kind === "lie") names = nm === "swing" ? ["unroll", "push", "rise", "out"] : ["push", "rise", "out"];
      else if (Q0.kind === "climb") names = nm === "rollOn" ? ["rollOff", "descend", "offRung"] : ["descend", "offRung"];
      else names = ["kneelUp"];
      R.seq = null;
    } else if (R.state === "sit") {
      names = (R.seat && R.seat.scooted ? ["unscoot"] : []).concat(["push", "rise", "out"]);
    } else if (R.state === "lie") {
      if (!R.ld) { return MV.stand(a, { instant: true }); }
      names = R.ld.raised ? ["rollOff", "descend", "offRung"] : ["unroll", "push", "rise", "out"];
    } else if (R.state === "kneel") names = ["kneelUp"];
    else return true;
    const sd = R.seat;
    const ex = opts.exit || (sd && sd.exit) || null;
    if (ex) { Q.ox = ex.x; Q.oz = ex.z; }
    else if (names.indexOf("out") >= 0) names.splice(names.indexOf("out"), 1);
    R.state = "stand";
    // `rise` reverses from wherever the fold actually is (a held seat is fully folded)
    if (R.b == null && R.seat && R.seat.legs) R.b = 1;
    begin(R, "stand", names, Q);
    return true;
  };

  // get up NOW (a reset, a death, a force-exit): flags off, roll off, feet on the floor
  function instantStand(R) {
    const a = R.actor, ch = charOf(a), g = groupOf(a);
    const floorY = R.ld && R.ld.raised ? R.ld.floorY : (R.sd ? R.sd.S.y : null);
    R.seq = null; freePlayer(a);
    R.state = "stand"; R.b = null; R.sink = null; R.lean = 0; R.kb = 0; R.roll = 0;
    if (ch) { rigStand(ch); ch.crouch = false; }
    if (g) {
      g.rotation.z = 0; g.rotation.x = 0;
      if (R.ld && floorY != null) { g.position.y = floorY; if (a.pos && a.pos !== g.position) a.pos.y = floorY; }
    }
    handBack(R);
    untrack(R);
    R.sd = R.ld = R.kd = null; R.seat = R.lie = R.kneel = null; R.spot = null; R.onDone = null; R.onAbort = null;
  }

  MV.posture = function (a) {
    if (!a) return "stand";
    const R = a._pz;
    if (R && R.seq) return "transition";
    if (R && R.state !== "stand") return R.state;
    const ch = charOf(a);
    if (ch && ch.lying) return "lie";
    if (ch && ch.sitting) return "sit";
    if (ch && ch.kneelB > 0.5) return "kneel";
    if (ch && ch.crouch) return "crouch";
    return "stand";
  };
  MV.busy = function (a) { const R = a && a._pz; return !!(R && R.seq); };
  // the seat/bed a held posture is on (null standing)
  MV.spotOf = function (a) { const R = a && a._pz; return R && (R.seq || R.state !== "stand") ? R.spot : null; };
  // world rebuild: every sequence and hold ends, every body handed back
  MV.postureReset = function () {
    for (let i = live.length - 1; i >= 0; i--) {
      const R = live[i];
      R.seq = null; freePlayer(R.actor);
      const ch = charOf(R.actor);
      if (ch) { rigStand(ch); ch.crouch = false; }
      const g = groupOf(R.actor);
      if (g) { g.rotation.z = 0; g.rotation.x = 0; }
      R.state = "stand"; R.spot = null; R.sd = R.ld = R.kd = null; R.seat = R.lie = R.kneel = null;
      R.onDone = R.onAbort = null;
    }
    live.length = 0;
  };

  MV.seatLegs = seatLegs;
  MV.footFwd = footFwd;
  MV.footDrop = footDrop;
  MV.shinAt = shinAt;
  MV.kneelLegs = kneelLegs;
  MV.liePlace = liePlace;
  MV.postureTick = tick;          // exposed for the node sim
  MV._postureLive = live;
  MV.hipOf = function (a) { const R = a && a._pz; return R ? R.hip : null; };
  // the propuse seams that used to live in its arc engine
  CBZ.propLiePlace = liePlace;
  CBZ.propLieStyle = sleepStyle;

  /* After every mover (entities/npc.js 22, city/peds.js 34), before the
     furniture holds and the camera. */
  if (CBZ.onUpdate) CBZ.onUpdate(41.5, tick);
  /* DEAD-MAN SWITCH for the player: the updater only runs while playing, and
     a player sequence owns physics through `_doorArc`. Leaving "playing"
     mid-transition commits the transition's end state and hands the body
     back, so a menu can never strand him un-simulated. NPC sequences simply
     wait for the game to resume. */
  if (CBZ.onAlways) CBZ.onAlways(52, function () {
    const P = CBZ.player;
    const R = P && P._pz;
    if (!R || !R.seq) return;
    const g = CBZ.game;
    if (g && g.state === "playing") return;
    const kind = R.seq.kind, spot = R.spot;
    if (kind === "sit" && R.seat) {
      R.seq = null; freePlayer(P);
      const sd = R.seat;
      R.x = sd.S.x; R.y = sd.S.y; R.z = sd.S.z; R.yaw = sd.face; R.roll = 0; R.state = "sit"; sd.scooted = false;
      const ch = charOf(P); if (ch) rigSit(R, ch, sd.ref, null);
      R.sink = null; R.b = null; apply(R);
      const cb = R.onDone; R.onDone = null; if (cb) { try { cb(P, spot); } catch (e) {} }
    } else if ((kind === "lie" || kind === "climb") && R.lie) {
      R.seq = null; freePlayer(P);
      const ld = R.lie;
      R.x = ld.Lp.x; R.y = ld.Lp.y; R.z = ld.Lp.z; R.yaw = ld.f; R.roll = HALF; R.state = "lie";
      const ch = charOf(P); if (ch) { ch.sitting = false; ch.seatBlend = null; setLying(P); }
      R.sink = null; apply(R);
      const cb = R.onDone; R.onDone = null; if (cb) { try { cb(P, spot); } catch (e) {} }
    } else instantStand(R);
  });
})();
