/* ============================================================
   city/brain_protection.js — THE DETAIL BRAIN. How a close-protection
   detail DECIDES: who stands where around the man, who looks where, when
   they close in, and what they do in the two seconds after a gunshot.

   Owner (2026-09-27): "The President's security moves glitchily, not
   natural." The cause was all decision-level, in four places:

   1. SLOTS SNAPPED. Every agent's slot was recomputed every frame from the
      principal's RAW heading (power.js/vips.js: group.rotation.y; the
      player's detail: a heading re-read off every 0.6 m/s twitch). A strafe,
      a half-step back or a camera nudge swung a 3 m diamond round in one
      frame, so the point man sprinted across to the other side and back.
   2. INDEX-BOUND SLOTS. Slot i went to member i. A 180-degree turn sent the
      point man THROUGH the principal to the tail and the tail through him to
      the point (they crossed); one agent dying renumbered everybody.
   3. BANG-BANG LOCOMOTION. "walk if d > 0.7 else idle" with no hysteresis,
      a fixed walk speed that is slower or faster than the principal, and a
      second direct position step on top of the mover past 3.5 m. Result:
      stop, lag, run, overshoot, stop, several times a second, and a body
      that skated.
   4. INSTANT YAW. At the slot, `rotation.y = slotFace` in one frame (vips,
      power.js) or a hard lerp: agents snapped round like turrets and then
      stared at one bearing forever.

   What replaces it (one brain, every detail in the game: the President's
   own detail, the NPC President's ring, officeholders' details, the player's
   hired security, VIP suits, the hitman targets' bodyguards). The split with
   CBZ.moves (entities/moves.js) is: THIS FILE DECIDES, MOVES EXECUTES.

   FROM CBZ.moves (execution, never duplicated here)
   · THE FRAME. One CBZ.moves.formation() per detail (D.F): the principal's
     smoothed velocity, a travel heading that turns at a bounded rate and
     eases to his facing at rest, slots predicted a short beat ahead, and his
     velocity handed to every member as FEED-FORWARD (they walk WITH him).
   · STABLE ASSIGNMENT. F.assign: member -> slot solved on a roster change,
     otherwise re-solved only when a swap is a real gain (no reshuffle, no
     two agents trading places). The CP is pinned to his shoulder slot.
   · THE IDLE SCAN. F.scan: a member at rest looks out with slow held
     glances (left / centre / right of his sector every 2.5-4.5 s).
   · THE WALK. Every order is a ped.moveOrder (CBZ.protection.order): the
     motor's velocity, braking arrival, arrival latch, bounded turn,
     turn-in-place and avoidance. Nothing here writes a position.

   HERE (decisions)
   · ROLES. agent_cp (the shift leader, the "body man") at his right rear
     shoulder, always the same person; agent_lead on point choosing the line;
     flanks, tail; with six or more an agent_sweep walks ahead to the next
     door or turn. Counter-snipers are a separate, static brain.
   · WHICH SLOT TABLE. open (3 m), crowd (tight, with hysteresis + dwell),
     door (single file), hold (tight, after trouble), shield. The table is
     laid out in the frame and BLENDED (each slot eases to the new table's
     offset over ~0.6 s, never faster than 5 m/s), so a mode change glides.
   · WHAT IS WORTH LOOKING AT. Every 1.5-4 s an agent checks his sector
     (CBZ.brain.perception when loaded): an armed man, somebody running at
     the principal, somebody close. A target found OVERRIDES the idle scan;
     an armed man he keeps looking at fills his awareness meter.
   · THE PANIC PROTOCOL (the drill, as details train it):
       ALERT  (a weapon seen, nobody firing): the two agents nearest the
              threat step in between; the rest KEEP THEIR SECTORS (a
              diversion is the classic setup). The nearest one challenges
              through CBZ.brain.authority (roe "protect") when it is loaded.
       COVER  (shots, an attacker, a hit): every agent reacts after his own
              reaction time (0.12-0.55 s, never all on one frame). The one
              nearest the threat shouts. The CP grabs the man (act.verb
              "grab"/"escort", feature-detected) and pushes him down and
              away; the others close into a wall between him and the threat,
              facing it, weapons up; one keeps the rear; one or two (the
              nearest, with a live armed attacker) engage.
       EVAC   the knot moves with him, shield arc still on the threat side,
              toward the car / safe room (the caller moves the principal).
       HOLD   the threat is gone: stay tight, guns up, short scans, then
              re-form.
     In a hot phase the brain supplies the target points (the shield arc,
     the screen), still walked by moves with his velocity fed forward.
     Counter-snipers never move: long, slow sector scans (3-6.5 s dwell),
     and they turn onto a target when the caller hands them one.

   Bodies move ONLY through CBZ.brain.act (moveTo/stop/face/posture/say/
   verb). The executor registered here as game "protection" turns a moveTo
   into a ped.moveOrder (CBZ.protection.order; the same record shape when
   protection.js is absent) and a face into the motor's bounded turn;
   police.js's posted officers get their `_post` written instead (his post
   brain walks him). If CBZ.brain is not loaded the executor is called directly.

   PUBLIC: CBZ.detailBrain = { create, step, escort(key, principal, members,
   dt, env), release(ped), sniper(ped, post, dt, target), slotLocal,
   formationSlot (the old protection.js shape), TUNE, EXEC }.
   Plain node: module.exports = CBZ.detailBrain (tools/brain-sim.mjs).
   ============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const PI = Math.PI, TAU = PI * 2;

  // ------------------------------------------------------------
  //  TUNING — one table
  // ------------------------------------------------------------
  const TUNE = {
    R_OPEN: 3.0, R_CROWD: 2.0, R_HOLD: 1.7, R_SHIELD: 1.05,
    CROWD_IN: 4, CROWD_OUT: 1, CROWD_DWELL: 2.0,      // people within 5 m; hysteresis + dwell
    DOOR_DWELL: 0.6, DOOR_GAP: 1.15,                   // single file: a stride and a half apart
    FRAME_LEAD: 0.2,                                   // s: the frame's slot prediction (moves)
    BLEND_RATE: 5, BLEND_CAP: 5,                       // slot-table blend: 1/s, m/s
    WALK: 2.4, RUN: 5.0,                               // m/s ordered paces (the motor ramps)
    RUN_IN: 4, RUN_OUT: 1.5,                           // m behind the slot: catch-up gait hysteresis
    REST_D: 0.6, STOP: 0.25,                           // m: "at the slot" for the rest pose; arrival
    TURN: 2.6, TURN_HOT: 7.0, TURN_SNIPER: 1.1,        // rad/s (face requests on a standing body)
    DWELL_MIN: 1.5, DWELL_MAX: 4.0, DWELL_HOT: 1.1,
    SNIPER_DWELL_MIN: 3.0, SNIPER_DWELL_MAX: 6.5,
    SECTOR: 0.95, SNIPER_SECTOR: 0.7,
    SCAN_R: 26,
    REACT_MIN: 0.12, REACT_MAX: 0.55,
    COVER_T: 1.2, HOLD_T: 5.0,
    ENGAGE_R: 45,
  };

  // ------------------------------------------------------------
  //  small reads
  // ------------------------------------------------------------
  function wrap(a) { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; }
  function hyp(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function P(a) { return a ? (a.pos || (a.group && a.group.position) || (a.x != null ? a : null)) : null; }
  function yawOf(a) { return a.yaw != null && !a.group ? a.yaw : (a.group ? a.group.rotation.y : 0); }
  function setYaw(a, y) { if (a.group) a.group.rotation.y = y; else a.yaw = y; }
  let _ids = 0;
  function idOf(a) { if (a._detId == null) a._detId = ++_ids; return a._detId; }
  function h01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function isPlayer(a) {
    if (!a) return false;
    return !!(a.isPlayer || a === CBZ.player || (CBZ.city && a === CBZ.city.playerActor));
  }
  function alive(a) { return !!(a && !a.dead && P(a)); }

  // ------------------------------------------------------------
  //  THE EXECUTOR ("protection") — decisions in, CBZ.moves out.
  //  moveTo  -> a ped.moveOrder (CBZ.protection.order when it is loaded; the
  //             same record otherwise) that peds.js's move() steps through
  //             CBZ.moves. opts: speed (m/s), arrive (stop radius), face (a
  //             yaw to hold), strafe, vffX/vffZ (feed-forward velocity).
  //  stop    -> the order is dropped; the motor brakes him where he stands.
  //  face    -> the motor's bounded turn (CBZ.moves.face) at a._detTurn.
  //  police.js's posted officers (power.js's ring cops) are walked by their
  //  own post brain: moveTo/face write his `_post` instead.
  // ------------------------------------------------------------
  const EXEC = { dt: 1 / 60 };
  function speedOf(o) {
    const s = o && (o.speedMps != null ? o.speedMps : o.speed);
    if (typeof s === "number") return s;
    return s === "run" ? TUNE.RUN : s === "jog" ? 3.1 : TUNE.WALK;
  }
  function writeOrder(a, x, z, sp, face, strafe, vx, vz, stop) {
    const PR = CBZ.protection;
    if (PR && typeof PR.order === "function") { PR.order(a, x, z, sp, face, strafe, vx, vz, stop); return; }
    let o = a.moveOrder;
    if (!o) o = a.moveOrder = { x: 0, z: 0, speed: 0, stop: 0.25, face: null, strafe: false, vffX: 0, vffZ: 0, leg: false, t: 0 };
    o.x = x; o.z = z; o.speed = sp; o.stop = stop != null ? stop : 0.25;
    o.face = face != null ? face : null; o.strafe = !!strafe;
    o.vffX = vx || 0; o.vffZ = vz || 0; o.leg = false; o.t = CBZ.now || 0;
    if (a.target && a.target.set) a.target.set(x, 0, z);
    a.path = null; a.pause = 0; a.finalGoal = null; a._boardRun = false;
  }
  EXEC.moveTo = function (a, x, z, o) {
    if (!a) return false;
    if (a._powerCop && a._post) {
      a._post.x = x; a._post.z = z; a._post.mountT = 0; a._post.mount = null;
      if (o && o.face != null) { a._post.fx = Math.sin(o.face); a._post.fz = Math.cos(o.face); }
      return true;
    }
    writeOrder(a, x, z, Math.max(0.4, speedOf(o)), o && o.face != null ? o.face : null, !!(o && o.strafe),
      o && o.vffX, o && o.vffZ, o && o.arrive != null ? o.arrive : TUNE.STOP);
    if (a.state !== "fight" && a.state !== "confront") a.state = "walk";
    return true;
  };
  EXEC.stop = function (a) {
    if (!a) return false;
    if (a._powerCop && a._post) return true;            // his post brain holds him on the slot we wrote
    const PR = CBZ.protection;
    if (PR && PR.release) PR.release(a); else a.moveOrder = null;
    const p = P(a);
    a.state = "idle"; a.speed = 0; a._boardRun = false; a.path = null;
    if (a.target && a.target.set && p) a.target.set(p.x, 0, p.z);
    return true;
  };
  EXEC.face = function (a, x, z) {
    if (!a) return false;
    const p = P(a); if (!p) return false;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < 1e-4) return true;
    if (a._powerCop && a._post) { const l = Math.sqrt(dx * dx + dz * dz); a._post.fx = dx / l; a._post.fz = dz / l; return true; }
    const want = Math.atan2(dx, dz), rate = a._detTurn || TUNE.TURN;
    const M = CBZ.moves;
    if (M && M.face && M.motor) setYaw(a, M.face(M.motor(a), yawOf(a), want, EXEC.dt, rate));
    else { const cur = yawOf(a), d = wrap(want - cur), mx = rate * EXEC.dt; setYaw(a, cur + (Math.abs(d) <= mx ? d : (d > 0 ? mx : -mx))); }
    return true;
  };
  EXEC.posture = function (a, p) {
    if (!a) return false;
    if (p === "aim") { a.alarmed = Math.max(a.alarmed || 0, 4); a._gunLowered = false; }
    else if (p === "cower" || p === "crouch" || p === "down") a.poseCower = Math.max(a.poseCower || 0, 1.0);
    return true;
  };
  EXEC.say = function (a, line) {
    if (!a || a.dead || !line) return false;
    if (CBZ.citySay) { try { CBZ.citySay(a, line, "#ffb0a0", 2.4); } catch (e) {} }
    a._detSaid = line;                                   // node scenarios read this
    return true;
  };
  EXEC.verb = function (name, a, b) {
    // grab/escort/cover: the principal is pushed DOWN (hunched, moving). A
    // player principal is never moved by an NPC; the verbs lead may do more.
    if ((name === "grab" || name === "escort" || name === "cover") && b && !isPlayer(b)) {
      b.poseCower = Math.max(b.poseCower || 0, 1.2);
      b._detCovered = a || true;
      return true;
    }
    return false;
  };

  // act: CBZ.brain.act when the core is loaded (it prefers CBZ.moves/verbs
  // and falls back to EXEC via act.use), else EXEC directly.
  const LOCAL = {
    moveTo: EXEC.moveTo, stop: EXEC.stop, face: EXEC.face, posture: EXEC.posture, say: EXEC.say,
    verb: function (n, a, b, o) { return EXEC.verb(n, a, b, o); },
  };
  let _usedOn = null;
  function brain() { return CBZ.brain || null; }
  function act() {
    const B = brain();
    if (B && B.act && typeof B.act.moveTo === "function") {
      if (_usedOn !== B && typeof B.act.use === "function") {
        try { B.act.use("protection", EXEC); } catch (e) {}
        _usedOn = B;
      }
      return B.act;
    }
    return LOCAL;
  }
  // The archetypes (agent_lead / agent_cp / agent_sweep / countersniper /
  // protectee) are the core's (systems/brain.js); a flank or the tail is an
  // agent_cp-class body. Registering with game "protection" is what makes
  // CBZ.brain.act pick EXEC for these bodies.
  const ARCH = { cp: "agent_cp", point: "agent_lead", sweep: "agent_sweep", sniper: "countersniper" };
  function enlist(q, role) {
    const B = brain();
    const arch = ARCH[role] || "agent_cp";
    if (B && typeof B.register === "function" && (!q._brain || !q._brain.registered || q._detArch !== arch || q._brain.game !== "protection")) {
      try { B.register(q, arch, { faction: "detail", game: "protection" }); } catch (e) {}
      q._detArch = arch;
    }
  }

  // ------------------------------------------------------------
  //  THE SLOT GEOMETRY — pure. f = metres ahead of him, r = metres to his
  //  RIGHT, look = the yaw offset (from his heading) the agent's sector
  //  centres on. Kinds: cp, point, left, right, tail, sweep, ring:<k>.
  // ------------------------------------------------------------
  // `si` (door mode only) = the member's place in the file behind the man
  function slotLocal(kind, k, nRing, R, mode, out, si) {
    out = out || { f: 0, r: 0, look: 0 };
    let f = 0, r = 0, look = 0;
    if (mode === "door") {
      if (kind === "cp") { f = -0.9; r = 0.45; look = 0.3; }
      else if (kind === "point") { f = 1.8; r = 0; look = 0; }
      else { f = -1.9 - Math.max(0, (si || 1) - 1) * TUNE.DOOR_GAP; r = 0; look = PI; }
    } else if (kind === "cp") { const s = Math.min(0.85, 0.35 + R * 0.17); f = -s; r = s; look = -0.35; }   // over his right shoulder, at the crowd ahead
    else if (kind === "point") { f = R; look = 0; }
    else if (kind === "left") { f = 0.2 * R; r = -R; look = Math.atan2(R, 0.2 * R); }   // out, to his left
    else if (kind === "right") { f = 0.2 * R; r = R; look = -Math.atan2(R, 0.2 * R); }  // out, to his right
    else if (kind === "tail") { f = -R; look = PI; }
    else if (kind === "sweep") { f = mode === "crowd" ? R * 2.2 : R * 3.3; look = 0; }
    else {                                              // outer ring, evenly spread, looking out
      const a = ((k + 0.5) / Math.max(1, nRing)) * TAU, R2 = R * 1.5;
      f = Math.cos(a) * R2; r = Math.sin(a) * R2; look = Math.atan2(-r, f);
    }
    out.f = f; out.r = r; out.look = look;
    return out;
  }
  // the order slots are handed out for n agents besides the CP
  const ORDER = ["point", "left", "right", "tail", "sweep"];
  function kindsFor(nOthers, out) {
    out.length = 0;
    if (nOthers === 2) { out.push("point", "tail"); return out; }
    for (let i = 0; i < nOthers; i++) out.push(i < ORDER.length ? ORDER[i] : "ring");
    return out;
  }
  // YAW CONVENTION: forward = (sin h, cos h); `look` is a yaw offset from
  // the frame heading. r = metres to his RIGHT; CBZ.moves' F.slot takes
  // s = metres to his LEFT (s = -r).
  // the OLD protection.js shape (s = metres to his LEFT), kept for callers
  function formationSlot(i, n, mode, out) {
    out = out || { f: 0, s: 0, face: 0 };
    const R = mode === "shield" ? TUNE.R_SHIELD : mode === "crowd" ? TUNE.R_CROWD : TUNE.R_OPEN;
    const kinds = kindsFor(Math.max(0, n - 1), []);
    const kind = i === 0 ? "cp" : (kinds[i - 1] || "ring");
    const sl = slotLocal(kind, Math.max(0, i - 6), Math.max(1, n - 6), R, mode === "door" ? "door" : mode, {});
    out.f = sl.f; out.s = -sl.r; out.face = Math.atan2(out.s, out.f);
    return out;
  }

  // ------------------------------------------------------------
  //  THE DETAIL RECORD
  // ------------------------------------------------------------
  function create(key, opts) {
    opts = opts || {};
    return {
      key: key, t: 0, F: null,
      // read-only mirrors of the moves frame (callers and the sims read these)
      px: 0, pz: 0, vx: 0, vz: 0, spd: 0, moving: false, h: 0,
      mode: "open", modeWant: "open", modeT: 0, crowdHigh: false, crowdT: 0,
      R: TUNE.R_OPEN,
      roster: [], active: [], cp: null, rosterDirty: true,
      slots: [], blend: [], world: [], others: [], nRing: 0,
      phase: "normal", phaseT: 0, epoch: 0, threat: null, tx: 0, tz: 0, hasT: false, hostile: false,
      shouted: false, cpSaid: false, engagers: [], screen: [], lastPosture: "normal",
      form: opts.form || null, sweep: opts.sweep !== false, small: !!opts.small,
      spotted: null, authorityOn: null,
    };
  }
  const DETAILS = {};
  function detailFor(key, opts) { return DETAILS[key] || (DETAILS[key] = create(key, opts)); }

  function memberOf(D, q) {
    let m = q._det;
    if (!m || m.D !== D) {
      const id = idOf(q);
      m = q._det = {
        D: D, id: id, kind: null, k: 0, si: -1, j: -1, init: false,
        hold: false, run: false,
        lookYaw: null, lookT: 0, lookAt: null, react: 0, epoch: -1, said: false,
        seed: h01(id * 7.13),
      };
    }
    return m;
  }
  function release(q) {
    if (!q) return;
    const PR = CBZ.protection;
    if (q.moveOrder && !(q._powerCop && q._post)) { if (PR && PR.release) PR.release(q); else q.moveOrder = null; }
    q._det = null; q._detailBrain = null; q._detTurn = null;
  }

  // ---- 1. the principal, through the CBZ.moves formation frame ----------
  function track(D, pp, principal, dt) {
    const F = D.F;
    F.update(pp.x, pp.z, principal.group || principal.yaw != null ? yawOf(principal) : null, dt);
    D.px = pp.x; D.pz = pp.z;
    D.vx = F.vx; D.vz = F.vz; D.spd = F.speed; D.moving = F.moving; D.h = F.h || 0;
  }

  // ---- 2. roster -------------------------------------------------------
  function syncRoster(D, members, env) {
    const R = D.roster;
    // drop the gone
    for (let i = R.length - 1; i >= 0; i--) {
      const q = R[i];
      if (!q || q.dead || members.indexOf(q) < 0) { if (q && !q.dead) release(q); R.splice(i, 1); D.rosterDirty = true; }
    }
    // append the new, in the caller's order (stable after that)
    for (let i = 0; i < members.length; i++) {
      const q = members[i];
      if (!q || q.dead || R.indexOf(q) >= 0) continue;
      R.push(q); D.rosterDirty = true;
    }
    // who is in the formation this frame (not fighting, not held elsewhere)
    const A = D.active; A.length = 0;
    for (let i = 0; i < R.length; i++) {
      const q = R[i];
      if (env.busy && env.busy(q)) { if (q._det && q._det.kind) { q._det.kind = null; D.rosterDirty = true; } continue; }
      A.push(q);
    }
    // the CP: the same man for as long as he is on his feet
    if (!D.cp || D.active.indexOf(D.cp) < 0) {
      let pick = null;
      for (let i = 0; i < A.length; i++) if (A[i]._protRole === "shift-leader") { pick = A[i]; break; }
      if (!pick && A.length) pick = A[0];
      if (pick !== D.cp) { D.cp = pick; D.rosterDirty = true; }
    }
  }

  // ---- 3. mode + radius -----------------------------------------------
  function updateMode(D, env, dt) {
    const crowd = env.crowd | 0;
    if (!D.crowdHigh) { if (crowd >= TUNE.CROWD_IN) { D.crowdT += dt; if (D.crowdT > 0.5) { D.crowdHigh = true; D.crowdT = 0; } } else D.crowdT = 0; }
    else { if (crowd <= TUNE.CROWD_OUT) { D.crowdT += dt; if (D.crowdT > TUNE.CROWD_DWELL) { D.crowdHigh = false; D.crowdT = 0; } } else D.crowdT = 0; }
    let want = "open";
    if (D.phase === "cover" || D.phase === "evac") want = "shield";
    else if (D.phase === "hold" || D.phase === "alert") want = "hold";
    else if (env.mode === "door" || env.mode === "crowd" || env.mode === "open") want = env.mode;   // the caller's table
    else if (env.door) want = "door";
    else if (D.crowdHigh) want = "crowd";
    if (want !== D.modeWant) { D.modeWant = want; D.modeT = 0; }
    D.modeT += dt;
    // entering a door or a shield is immediate; leaving a door waits a beat
    if (D.mode !== D.modeWant && (D.modeWant === "shield" || D.modeWant === "door" || D.modeT > TUNE.DOOR_DWELL)) {
      D.mode = D.modeWant; D.rosterDirty = true;
    }
    // the table's radius; the per-slot blend (layout below) is what glides
    D.R = D.mode === "shield" ? TUNE.R_SHIELD : D.mode === "hold" ? TUNE.R_HOLD : D.mode === "crowd" ? TUNE.R_CROWD : TUNE.R_OPEN;
  }

  // ---- 4. THE SLOT TABLE (a decision) laid out in the moves frame -----------
  //  Slot 0 is the CP's; 1..n the others' kinds (point, flanks, tail, sweep,
  //  ring, or a caller's authored `form`). Each slot's local (f, s, look)
  //  BLENDS toward the table (TUNE.BLEND_RATE, never faster than BLEND_CAP),
  //  then F.slot puts it in the world with the principal's velocity.
  const _kinds = [], _sl = { f: 0, r: 0, look: 0 };
  function localSlot(D, kind, k, nRing, si, out) {
    if (D.form && kind.indexOf("form") === 0 && D.mode !== "door") {
      const f = D.form[k] || { f: -2, s: 0 };
      const sc = D.R / TUNE.R_OPEN;                       // an authored shape tightens in a crowd too
      out.f = f.f * sc; out.s = (f.s || 0) * sc; out.look = Math.atan2(out.s, out.f);
      return out;
    }
    slotLocal(kind, k, nRing, D.R, D.mode, _sl, si);
    out.f = _sl.f; out.s = -_sl.r; out.look = _sl.look;
    return out;
  }
  function slotKinds(D, nOthers) {
    if (D.form && D.form.length) {
      _kinds.length = 0;
      for (let i = 0; i < nOthers; i++) _kinds.push(i < D.form.length ? "form" + i : "ring");
      return _kinds;
    }
    const kinds = kindsFor(nOthers, _kinds);
    if (!D.sweep) for (let i = 0; i < kinds.length; i++) if (kinds[i] === "sweep") kinds[i] = "ring";
    return kinds;
  }
  function kIndex(kinds, i) {
    // ring slots and form slots carry their own index
    const kd = kinds[i];
    if (kd.indexOf("form") === 0) return +kd.slice(4);
    let k = 0; for (let j = 0; j < i; j++) if (kinds[j] === "ring") k++;
    return k;
  }
  const _tgt = { f: 0, s: 0, look: 0 };
  function layout(D, dt) {
    const F = D.F, others = D.others;
    others.length = 0;
    for (let i = 0; i < D.active.length; i++) if (D.active[i] !== D.cp) others.push(D.active[i]);
    const n = others.length;
    const kinds = slotKinds(D, n);
    let nRing = 0; for (let i = 0; i < n; i++) if (kinds[i] === "ring") nRing++;
    D.nRing = nRing;
    const S = D.slots, Bl = D.blend, Wd = D.world;
    const k = 1 - Math.exp(-dt * TUNE.BLEND_RATE), cap = TUNE.BLEND_CAP * dt;
    for (let j = 0; j <= n; j++) {
      const kind = j === 0 ? "cp" : kinds[j - 1];
      if (j === 0) { slotLocal("cp", 0, 1, D.R, D.mode === "door" ? "door" : D.mode, _sl); _tgt.f = _sl.f; _tgt.s = -_sl.r; _tgt.look = _sl.look; }
      else localSlot(D, kind, kIndex(kinds, j - 1), nRing, j - 1, _tgt);
      const sl = S[j] || (S[j] = { kind: "", k: 0, f: 0, s: 0, look: 0 });
      sl.kind = kind; sl.k = j === 0 ? 0 : kIndex(kinds, j - 1); sl.f = _tgt.f; sl.s = _tgt.s; sl.look = _tgt.look;
      let b = Bl[j];
      if (!b) b = Bl[j] = { f: _tgt.f, s: _tgt.s, look: _tgt.look };
      let df = (_tgt.f - b.f) * k, ds = (_tgt.s - b.s) * k;
      const dl = Math.sqrt(df * df + ds * ds);
      if (dl > cap) { df *= cap / dl; ds *= cap / dl; }
      b.f += df; b.s += ds;
      b.look += wrap(_tgt.look - b.look) * k;
      const w = Wd[j] || (Wd[j] = { x: 0, z: 0, vx: 0, vz: 0, face: 0 });
      F.slot(b.f, b.s, w);
      w.face = (F.h || 0) + b.look;
    }
    S.length = n + 1;
    return n;
  }
  // STABLE ASSIGNMENT is CBZ.moves' (F.assign): the CP keeps slot 0, the
  // others are solved on the frame's slots 1..n
  const _asgS = [];
  function assign(D, n) {
    const others = D.others, M = CBZ.moves;
    for (let i = 0; i < n; i++) M.motor(others[i]);       // F.assign keys on the motor id
    _asgS.length = 0;
    for (let j = 1; j <= n; j++) _asgS.push(D.world[j]);
    const asg = D.F.assign(others, _asgS);
    for (let i = 0; i < n; i++) {
      const m = memberOf(D, others[i]), a = asg[i];
      const j = a < 0 ? -1 : a + 1;
      m.j = j;
      if (j < 0) continue;
      const sl = D.slots[j];
      if (m.kind !== sl.kind || m.k !== sl.k) { m.kind = sl.kind; m.k = sl.k; roleNote(others[i], sl.kind); }
      m.si = j - 1;
    }
    if (D.cp) { const m = memberOf(D, D.cp); m.j = 0; m.si = -1; if (m.kind !== "cp") { m.kind = "cp"; m.k = 0; roleNote(D.cp, "cp"); } }
  }
  function roleNote(q, kind) {
    const role = kind === "cp" ? "cp" : kind === "point" ? "point" : kind === "sweep" ? "sweep" : "flank";
    q._detRole = kind;
    enlist(q, role);
  }

  // ---- 5. the panic protocol -------------------------------------------
  function threatPos(D, env) {
    const t = env.threat && !env.threat.dead ? env.threat : null;
    const tp = t ? P(t) : null;
    if (tp) { D.tx = tp.x; D.tz = tp.z; D.hasT = true; return; }
    if (env.threatAt && (env.threatAt.x || env.threatAt.z)) { D.tx = env.threatAt.x; D.tz = env.threatAt.z; D.hasT = true; return; }
    D.hasT = false;
  }
  function updatePhase(D, env, dt) {
    const posture = env.posture || "normal";
    const threat = env.threat && !env.threat.dead ? env.threat : null;
    const prev = D.phase;
    let want = prev;
    if (posture === "evac") want = (prev === "cover" && D.phaseT >= TUNE.COVER_T) || prev === "evac" ? "evac" : "cover";
    else if (posture === "alert") want = (prev === "cover" || prev === "evac") ? prev : (threat || env.hostile ? "alert" : "hold");
    else if (prev === "cover" || prev === "evac" || prev === "alert") want = "hold";
    else if (prev === "hold" && D.phaseT >= TUNE.HOLD_T) want = "normal";
    // a live hostile inside 30 m while only "alert" is a COVER, whatever the posture says
    if ((want === "alert" || want === "hold") && env.hostile && threat) {
      const tp = P(threat);
      if (tp && hyp(tp.x, tp.z, D.px, D.pz) < 30) want = prev === "evac" ? "evac" : "cover";
    }
    if (threat !== D.threat) { D.threat = threat; if (threat) newEpoch(D); }
    D.hostile = !!env.hostile;
    if (want !== prev) {
      D.phase = want; D.phaseT = 0; D.rosterDirty = true;
      if (want === "cover" || want === "alert" || (want === "evac" && prev !== "cover")) newEpoch(D);
      if (want === "normal") { D.engagers.length = 0; D.screen.length = 0; D.shouted = false; D.cpSaid = false; }
    }
    D.phaseT += dt;
    threatPos(D, env);
  }
  function newEpoch(D) {
    D.epoch++; D.shouted = false; D.cpSaid = false;
    for (let i = 0; i < D.roster.length; i++) {
      const q = D.roster[i]; if (!q) continue;
      const m = memberOf(D, q);
      const disc = q === D.cp ? 0.2 : 1;
      m.react = TUNE.REACT_MIN + (TUNE.REACT_MAX - TUNE.REACT_MIN) * disc * h01(m.id * 3.1 + D.epoch * 1.7);
      m.epoch = D.epoch; m.said = false; m.lookT = 0;
    }
  }
  // who does what in a hot phase: screen (alert), engagers + shield (cover/evac)
  const _byD = [], _byDPool = [];
  function hotRoles(D, env) {
    D.screen.length = 0;
    if (!D.hasT) return;
    _byD.length = 0;
    for (let i = 0; i < D.active.length; i++) {
      const q = D.active[i]; if (q === D.cp) continue;
      const p = P(q), k = _byD.length;
      const e = _byDPool[k] || (_byDPool[k] = { q: null, d: 0 });
      e.q = q; e.d = hyp(p.x, p.z, D.tx, D.tz); _byD.push(e);
    }
    _byD.sort(function (a, b) { return a.d - b.d; });
    if (D.phase === "alert") {
      for (let i = 0; i < _byD.length && D.screen.length < 2; i++) D.screen.push(_byD[i].q);
      return;
    }
    // COVER / EVAC: one or two nearest go after a LIVE armed attacker in range
    const t = D.threat;
    if (!env.engage || !t || !D.hostile) return;
    const tp = P(t);
    if (!tp || hyp(tp.x, tp.z, D.px, D.pz) > TUNE.ENGAGE_R) return;
    const want = _byD.length >= 4 ? 2 : _byD.length >= 2 ? 1 : 0;
    for (let i = 0; i < _byD.length && D.engagers.length < want; i++) {
      const q = _byD[i].q, m = memberOf(D, q);
      if (m.epoch === D.epoch && D.phaseT < m.react) continue;        // still reacting
      if (D.engagers.indexOf(q) >= 0) continue;
      D.engagers.push(q);
      try { env.engage(q, t); } catch (e) {}
    }
  }
  // the shield offset for a member in cover/evac (arc on the threat side)
  function shieldOffset(D, q, idx, count, out) {
    const tb = D.hasT ? Math.atan2(D.tx - D.px, D.tz - D.pz) : D.h;
    if (q === D.cp) {
      // hands on him, on the far side from the gun, pushing him away
      const a = tb + PI + 0.5;
      out.x = Math.sin(a) * 0.8; out.z = Math.cos(a) * 0.8; out.look = tb;
      return out;
    }
    if (!D.hasT) {                                          // no bearing: a closed ring
      const a = D.h + (idx / Math.max(1, count)) * TAU;
      out.x = Math.sin(a) * TUNE.R_SHIELD; out.z = Math.cos(a) * TUNE.R_SHIELD; out.look = a;
      return out;
    }
    // with four or more, the last man covers the rear (a second shooter)
    if (count >= 4 && idx === count - 1) {
      const a = tb + PI;
      out.x = Math.sin(a) * 1.25; out.z = Math.cos(a) * 1.25; out.look = a;
      return out;
    }
    const nArc = count >= 4 ? count - 1 : count;
    const a = tb + (idx - (nArc - 1) / 2) * 0.62;
    out.x = Math.sin(a) * TUNE.R_SHIELD; out.z = Math.cos(a) * TUNE.R_SHIELD; out.look = tb;
    return out;
  }

  // ---- 6. scanning: where an agent looks, on a human cadence -------------
  function pickLook(D, q, m, sectorYaw, half, env, hot) {
    const qp = P(q);
    let best = null, bs = 0;
    const peds = env.peds;
    const B = brain();
    const per = B && B.perception;
    const also = env.also && env.also !== env.principal ? env.also : null;   // the player is not in the crowd list
    const np = peds ? peds.length : 0;
    if (np || also) {
      const R2 = TUNE.SCAN_R * TUNE.SCAN_R;
      for (let i = 0; i <= np; i++) {
        const p = i < np ? peds[i] : also;
        if (!p || p.dead || p === q || p._det || (env.friendly && env.friendly(p))) continue;
        // the two in front have the gun; everybody else watches for the SECOND man
        if (p === D.threat && D.phase !== "normal" && D.screen.indexOf(q) < 0) continue;
        const pp = P(p); if (!pp) continue;
        const dx = pp.x - qp.x, dz = pp.z - qp.z, d2 = dx * dx + dz * dz;
        if (d2 > R2 || d2 < 0.25) continue;
        const brg = Math.atan2(dx, dz);
        if (Math.abs(wrap(brg - sectorYaw)) > half + 0.25) continue;
        const d = Math.sqrt(d2);
        // interest: weapons, somebody coming at the man, somebody close
        let s = 1 / (1 + d * 0.15);
        if (p.armed) s += p.state === "fight" || p.state === "confront" || p.rage ? 3 : 1.2;
        const toP = hyp(pp.x, pp.z, D.px, D.pz);
        if ((p.speed || 0) > 2.5 && toP < 20) s += 1.2;
        if (toP < 4) s += 0.8;
        if (h01(m.id * 11.3 + i + D.epoch * 3 + Math.floor(D.t)) < 0.35) s *= 0.5;   // don't lock onto one face forever
        if (s > bs) {
          if (per && typeof per.sees === "function") {
            let ok = true;
            try { ok = per.sees(q, p, { range: TUNE.SCAN_R, fovHalf: half + 0.6 }); } catch (e) { ok = true; }
            if (!ok) continue;
          }
          bs = s; best = p;
        }
      }
    }
    // awareness: an agent actually LOOKING at an armed man fills his meter
    if (best && best.armed && per && typeof per.awareness === "function") {
      let aw = 0;
      try { aw = per.awareness(q, best, Math.max(0.25, m.dwell || 0.5)) || 0; } catch (e) { aw = 0; }
      if (aw >= 1) { D.spotted = best; D.spottedT = D.t; }
    } else if (best && best.armed && (best.state === "fight" || best.rage)) { D.spotted = best; D.spottedT = D.t; }
    // a target worth looking at OVERRIDES the idle scan (CBZ.moves' F.scan)
    m.lookAt = best && bs > 0.9 ? best : null;
    const lo = hot ? TUNE.DWELL_HOT * 0.7 : TUNE.DWELL_MIN, hi = hot ? TUNE.DWELL_HOT * 1.5 : TUNE.DWELL_MAX;
    m.lookT = m.dwell = lo + (hi - lo) * h01(m.id * 2.9 + D.t * 1.13);
  }

  // ---- 7. drive one member: DECIDE the goal, the pace and the look; the
  //         order goes out through act.moveTo (-> ped.moveOrder -> moves) ----
  const _off = { x: 0, z: 0, look: 0 };
  const _mo = { speed: 0, arrive: TUNE.STOP, face: null, strafe: false, vffX: 0, vffZ: 0 };
  function driveMember(D, q, m, idx, count, dt, env) {
    const A = act(), F = D.F;
    const qp = P(q);
    const hot = D.phase === "cover" || D.phase === "evac";
    const reacting = m.epoch === D.epoch && D.phaseT < m.react && (hot || D.phase === "alert");
    // A MAN STILL REACTING has not decided anything yet: whatever he was
    // doing a moment ago simply carries on (the last order stands, re-stamped
    // so peds.js does not drop it as stale).
    if (reacting && m.init) { if (q.moveOrder) q.moveOrder.t = CBZ.now || 0; return; }
    m.init = true;
    const screen = D.phase === "alert" && D.screen.indexOf(q) >= 0 && D.hasT;
    q._detTurn = hot || D.phase === "alert" ? TUNE.TURN_HOT : TUNE.TURN;
    _mo.arrive = TUNE.STOP;
    if (hot || screen) {
      // BRAIN-SUPPLIED TARGET POINTS round the man: the shield arc on the
      // threat side (cover/evac) or the two stepping in between (alert).
      // Squared up to the threat the whole way, side-stepping in.
      let lookYaw;
      if (hot) { shieldOffset(D, q, idx, count, _off); lookYaw = _off.look; }
      else {
        const tb = Math.atan2(D.tx - D.px, D.tz - D.pz);
        const a = tb + (D.screen[0] === q ? -0.35 : 0.35);
        _off.x = Math.sin(a) * 1.2; _off.z = Math.cos(a) * 1.2; lookYaw = tb;
      }
      if (D.hasT) lookYaw = Math.atan2(D.tx - qp.x, D.tz - qp.z);
      const gx = D.px + _off.x, gz = D.pz + _off.z, d = hyp(gx, gz, qp.x, qp.z);
      _mo.speed = hot || d > TUNE.RUN_OUT ? TUNE.RUN : TUNE.WALK;
      _mo.face = lookYaw; _mo.strafe = true;
      _mo.vffX = F.moving ? F.vx : 0; _mo.vffZ = F.moving ? F.vz : 0;
      A.moveTo(q, gx, gz, _mo);
      m.hold = !F.moving && d < TUNE.REST_D;
      m.lookAt = null; m.lookYaw = lookYaw;
    } else {
      // THE FORMATION: his slot in the frame, his pace fed forward
      const j = m.j;
      if (j < 0 || !D.world[j]) return;
      const w = D.world[j], sl = D.slots[j];
      const d = hyp(w.x, w.z, qp.x, qp.z);
      if (d > TUNE.RUN_IN) m.run = true; else if (d < TUNE.RUN_OUT) m.run = false;   // catch-up gait, hysteresis
      const rest = !F.moving && (!!(q._mv && q._mv.arrived) || d < TUNE.REST_D);
      m.hold = rest;
      // WHERE HE LOOKS AT REST: a target worth looking at (perception, on a
      // human cadence) wins; otherwise moves' held outward glances
      m.lookT -= dt;
      if (m.lookT <= 0) pickLook(D, q, m, w.face, q === D.cp ? 1.2 : TUNE.SECTOR, env, D.phase !== "normal");
      let face = null;
      if (rest) {
        if (m.lookAt && !m.lookAt.dead) { const lp = P(m.lookAt); face = Math.atan2(lp.x - qp.x, lp.z - qp.z); }
        else face = F.scan(j, (F.h || 0) + sl.look, dt);
        m.lookYaw = face;
      }
      _mo.speed = m.run ? TUNE.RUN : TUNE.WALK;
      _mo.face = face; _mo.strafe = rest;
      _mo.vffX = w.vx; _mo.vffZ = w.vz;
      A.moveTo(q, w.x, w.z, _mo);
    }
    if ((hot || D.phase === "alert" || D.phase === "hold") && !reacting && (m.postureT = (m.postureT || 0) - dt) <= 0) {
      m.postureT = 0.5; A.posture(q, "aim");
    }
  }

  // ---- 8. the words (one shout per man per event, never in chorus) ------
  function voice(D, env) {
    if (D.phase === "normal") return;
    const A = act();
    const hot = D.phase === "cover" || D.phase === "evac";
    if ((hot || D.phase === "alert") && !D.shouted && D.hasT) {
      // the man nearest the threat sees it first and calls it
      // (the CP's hands are full: he only calls it when he is alone)
      let sp = null, bd = 1e9;
      for (let i = 0; i < D.active.length; i++) {
        const q = D.active[i], p = P(q), m = memberOf(D, q);
        if (q === D.cp && D.active.length > 1) continue;
        if (m.epoch === D.epoch && D.phaseT < m.react) continue;
        const d = hyp(p.x, p.z, D.tx, D.tz);
        if (d < bd) { bd = d; sp = q; }
      }
      if (sp) {
        D.shouted = true;
        const t = D.threat, armed = !!(t && (t.armed || isPlayer(t)));
        let line;
        if (D.phase === "alert") line = armed ? "Gun! Show me your hands!" : "Hands! Let me see your hands!";
        else if (armed || D.hostile) line = "Gun! Gun! Get down!";
        else line = "Shots fired! Cover!";
        A.say(sp, line);
        if (env.onShout) { try { env.onShout(sp, line); } catch (e) {} }
      }
    }
    // THE CP: hands on him in COVER ("down"), then moves him in EVAC ("with
    // me") — one line per phase, from him alone
    if (hot && D.cp && D.cpSaid !== D.phase && D.phaseT > (D.phase === "cover" ? memberOf(D, D.cp).react + 0.35 : 0.2)) {
      const first = !D.cpSaid;
      D.cpSaid = D.phase;
      const principal = env.principal;
      if (first) {
        const from = D.hasT ? { x: D.tx, z: D.tz } : null;
        // NEVER HANDS ON THE PLAYER. With the brain core loaded A.verb is
        // CBZ.verbs, and a real grab on a player principal held the President
        // (playerHeld: no input) with the session parked in "align": his own
        // agent pinned him on the lawn outside the West Wing and yanked him a
        // metre (tools/president-walkout.mjs, all four runs). The player is
        // told (the line below); only an NPC principal is taken down.
        const verb = isPlayer(principal) ? true
          : (A.verb("grab", D.cp, principal, { from: from, push: "down" }) || A.verb("escort", D.cp, principal, { from: from }));
        // no verbs library and no executor for his body: he still ducks
        if (!verb && principal && !isPlayer(principal)) EXEC.posture(principal, "cower");
      } else if (principal && !isPlayer(principal)) A.verb("escort", D.cp, principal, { to: env.safe || null });
      const line = isPlayer(principal)
        ? (D.phase === "evac" ? "Sir, with me. Inside, now." : "Down! Stay down, sir!")
        : (D.phase === "evac" ? "Moving! Moving! Get him out!" : "I've got him! Stay down!");
      A.say(D.cp, line, { force: true });
    }
  }

  // ---- 9. the authority ladder on the man with the gun (alert only) ------
  // The words and the escalation are the core's authority ladder (roe
  // "protect": lethal only for an armed man pointing it). A detail agent
  // CHALLENGES FROM WHERE HE STANDS: the ladder's approach / cuff / chase
  // moves are overridden the same frame by his own slot (a detail never
  // leaves the man to go and make an arrest; the police do that).
  function challenge(D, env, dt) {
    const B = brain();
    if (D.phase !== "alert" || !D.screen.length || !D.threat || !B || !B.authority) { endChallenge(D, B); return; }
    const q = D.screen[0];
    const Au = B.authority;
    if (D.authorityOn !== q) {
      endChallenge(D, B);
      try { Au.begin(q, D.threat, "weapon near the protectee", { roe: "protect", skipWarn: true }); D.authorityOn = q; } catch (e) { return; }
    }
    D.authT = (D.authT || 0) - dt;
    if (D.authT > 0) return;
    D.authT = 0.25;
    const t = D.threat, tp = P(t), pl = isPlayer(t);
    const st = {
      speed: t.speed || (pl && t._protSpeed) || 0, handsUp: !!(t.poseHandsUp || t.surrender), kneeling: false, prone: false,
      armed: pl ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!t.armed,
      aiming: pl ? !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon()) : !!(t.state === "fight" || t.rage),
      attacking: !!(t.rage && (t.rage === env.principal || t.rage._det)), fled: tp ? hyp(tp.x, tp.z, D.px, D.pz) > 40 : true,
    };
    let r = null;
    try { r = Au.step(q, 0.25, st); } catch (e) { r = null; }
    // his own slot wins this frame: driveMember re-issues his order after this
    if (r && r.phase === "lethal" && env.engage && D.engagers.indexOf(q) < 0) {
      D.engagers.push(q);
      try { env.engage(q, t); } catch (e) {}
    }
  }
  function endChallenge(D, B) {
    if (!D.authorityOn) return;
    if (B && B.authority && B.authority.cancel) { try { B.authority.cancel(D.authorityOn); } catch (e) {} }
    D.authorityOn = null;
  }

  // ------------------------------------------------------------
  //  THE STEP — one call per frame per detail
  //    env: { posture, threat, threatAt{x,z}, hostile, crowd, door,
  //           peds (candidates to watch), friendly(p), busy(q),
  //           engage(q, t), onShout(q, line) }
  // ------------------------------------------------------------
  function step(D, principal, members, dt, env) {
    env = env || {};
    dt = Math.min(0.1, Math.max(0, dt || 0));
    EXEC.dt = dt || 1 / 60;
    D.t += dt;
    const pp = P(principal);
    if (!pp) return D;
    const M = CBZ.moves;
    if (!M || !M.formation) return D;                       // no locomotion layer: nothing to walk them with
    if (!D.F) D.F = M.formation({ lead: TUNE.FRAME_LEAD });
    env.principal = principal;
    track(D, pp, principal, dt);
    syncRoster(D, members, env);
    updatePhase(D, env, dt);
    updateMode(D, env, dt);
    // an engager comes back to the knot when the fight is over (or he broke off)
    const calm = !D.threat || D.phase === "normal" || D.phase === "hold";
    for (let i = D.engagers.length - 1; i >= 0; i--) {
      const q = D.engagers[i];
      if (!q || q.dead) { D.engagers.splice(i, 1); continue; }
      if (calm || (env.busy && !env.busy(q))) {
        if (env.disengage) { try { env.disengage(q); } catch (e) {} }
        D.engagers.splice(i, 1); D.rosterDirty = true;
      }
    }
    if (D.phase !== "normal") hotRoles(D, env);
    challenge(D, env, dt);                     // before the bodies: their own slots win
    assign(D, layout(D, dt));
    D.rosterDirty = false;
    // shield indices: non-CP, non-engaging members in a stable order
    let count = 0;
    for (let i = 0; i < D.active.length; i++) { const q = D.active[i]; if (q !== D.cp && D.engagers.indexOf(q) < 0) count++; }
    let idx = 0;
    if (D.spotted && (D.spotted.dead || D.t - (D.spottedT || 0) > 1.5)) D.spotted = null;
    for (let i = 0; i < D.active.length; i++) {
      const q = D.active[i];
      if (D.engagers.indexOf(q) >= 0) continue;
      const m = memberOf(D, q);
      q._detailBrain = D.key;
      driveMember(D, q, m, q === D.cp ? 0 : idx, count, dt, env);
      if (q !== D.cp) idx++;
    }
    voice(D, env);
    D.lastPosture = env.posture || "normal";
    return D;
  }
  function escort(key, principal, members, dt, env, opts) {
    return step(detailFor(key, opts), principal, members, dt, env);
  }
  function drop(key) {
    const D = DETAILS[key]; if (!D) return;
    for (let i = 0; i < D.roster.length; i++) release(D.roster[i]);
    delete DETAILS[key];
  }

  // ------------------------------------------------------------
  //  COUNTER-SNIPERS — static. Slow sector scans; onto a target when given.
  //  post: { face (sector centre yaw), lookYaw, lookT } (the caller's record)
  // ------------------------------------------------------------
  function sniper(q, post, dt, target) {
    if (!q || q.dead || !post) return;
    const A = act();
    EXEC.dt = Math.max(1e-3, dt || 1 / 60);
    const qp = P(q); if (!qp) return;
    if (!post._stopped || q._detArch !== "countersniper") { enlist(q, "sniper"); A.stop(q); post._stopped = true; }
    const id = idOf(q);
    q._detTurn = target ? TUNE.TURN_SNIPER * 2.2 : TUNE.TURN_SNIPER;
    let yaw;
    if (target && !target.dead && P(target)) {
      const tp = P(target); yaw = Math.atan2(tp.x - qp.x, tp.z - qp.z); post.lookT = 0;
    } else {
      post.lookT = (post.lookT || 0) - dt;
      post._t = (post._t || 0) + dt;
      if (post.lookT <= 0 || post.lookYaw == null) {
        const c = post.face || 0, half = post.sector || TUNE.SNIPER_SECTOR;
        post.lookYaw = c + (h01(id * 4.1 + post._t * 0.21) * 2 - 1) * half;
        post.lookT = TUNE.SNIPER_DWELL_MIN + (TUNE.SNIPER_DWELL_MAX - TUNE.SNIPER_DWELL_MIN) * h01(id * 1.7 + post._t * 0.53);
      }
      yaw = post.lookYaw;
    }
    A.face(q, qp.x + Math.sin(yaw) * 20, qp.z + Math.cos(yaw) * 20);
  }

  const API = {
    create: create, step: step, escort: escort, drop: drop, release: release, sniper: sniper,
    detail: function (key) { return DETAILS[key] || null; },
    slotLocal: slotLocal, formationSlot: formationSlot, kindsFor: kindsFor,
    TUNE: TUNE, EXEC: EXEC, _details: DETAILS,
  };
  CBZ.detailBrain = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
