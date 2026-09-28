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
   hired security, VIP suits, the hitman targets' bodyguards):

   · THE PRINCIPAL IS FILTERED, NOT READ. Velocity is an exponential
     average; the formation heading follows it only while he is really
     moving (hysteresis on "moving"), slews at a bounded rate, and holds
     when he stops. Looking round does not rotate the detail.
   · ROLES. agent_cp (the shift leader, the "body man") at his right rear
     shoulder, always the same person; agent_lead on point choosing the line;
     flanks, tail; with six or more an agent_sweep walks ahead to the next
     door or turn. Counter-snipers are a separate, static brain.
   · STABLE ASSIGNMENT. Slots are assigned by least total walking distance,
     and re-assigned ONLY when a different assignment is much cheaper AND has
     stayed cheaper for a moment (or the roster changed). A U-turn relabels
     the diamond (the tail becomes the point) instead of making them cross.
   · SMOOTHED OFFSETS. Each agent's offset from the principal is a critically
     damped spring toward its slot offset: rotation, crowd tightening, door
     single-file and re-assignment all glide. Translation is NOT smoothed:
     when he walks the whole knot walks with him, no lag.
   · SPEED MATCHING. Moving agents walk at his speed plus a correction on
     the along-track error (continuous, not walk/run), toward a carrot a
     little ahead so the mover never hits its own arrival stop mid-walk.
   · ARRIVE AND HOLD. When he stands still an agent arrives (0.4 m) and
     HOLDS until the slot is more than 1.1 m away. No re-issue of a moveTo
     for sub-30 cm deltas.
   · TURN, DON'T SNAP. Facing is bounded (about 150 deg/s calm, faster when
     hot) and eases in.
   · SCANNING. Each agent owns a sector facing OUT (point: ahead; flanks:
     their side; tail: behind; CP: the crowd in front of the man). Every
     1.5-4 s he picks a new place to look: someone in his sector whose hands
     he can see and who is armed, running toward the man, or close; else a
     new bearing inside the sector. A human cadence, not a spinning turret.
     Perception runs through CBZ.brain.perception when it is loaded.
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
              re-form (the radius springs back out).
     Counter-snipers never move: long, slow sector scans (3-6.5 s dwell),
     and they turn onto a target when the caller hands them one.

   MOVEMENT goes ONLY through CBZ.brain.act (moveTo/stop/face/posture/say/
   verb), which prefers CBZ.moves / CBZ.verbs when present. The fallback
   executor registered here as game "protection" is a thin adapter over the
   fields the city mover already walks by (peds.js: target/state/baseSpeed;
   police.js: _post for a posted officer). If CBZ.brain is not loaded at all
   the same executor is called directly.

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
    DOOR_DWELL: 0.6,
    MOVE_IN: 0.55, MOVE_OUT: 0.3,                      // m/s: principal "moving" hysteresis
    VEL_TAU: 0.35,                                     // s: principal velocity filter
    HEAD_RATE: 2.4,                                    // rad/s: formation heading slew
    OFFSET_W: 4.2, OFFSET_W_HOT: 9.0,                  // spring stiffness (critically damped)
    RADIUS_W: 2.2,
    LEAD_T: 0.7,                                       // s: carrot ahead of a moving slot
    HOLD_IN: 0.65, HOLD_OUT: 1.2,                      // m: arrive / resume (the city mover stops inside 0.5)
    SPEED_MIN: 0.9, SPEED_MAX: 6.8, SPEED_K: 1.5,
    REISSUE_D: 0.3, REISSUE_T: 0.5,
    TURN: 2.6, TURN_HOT: 7.0, TURN_SNIPER: 1.1,        // rad/s
    DWELL_MIN: 1.5, DWELL_MAX: 4.0, DWELL_HOT: 1.1,
    SNIPER_DWELL_MIN: 3.0, SNIPER_DWELL_MAX: 6.5,
    SECTOR: 0.95, SNIPER_SECTOR: 0.7,
    SCAN_R: 26,
    REASSIGN_EVERY: 0.25, REASSIGN_PERSIST: 0.6, REASSIGN_GAIN: 0.3, REASSIGN_MIN: 1.5,
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
  //  THE FALLBACK EXECUTOR — a thin adapter over the city mover's fields.
  //  peds.js move() walks any `controlled` ped toward `target` at
  //  `baseSpeed` (state "walk") and stands still in "idle"; police.js walks
  //  a posted officer to `_post.x/_post.z` and faces `_post.fx/_post.fz`.
  //  Numeric speed is honoured by writing baseSpeed while the body is in the
  //  detail (restored on stop/release): that is what turns the old walk/run
  //  bang-bang into a continuous speed match.
  // ------------------------------------------------------------
  const EXEC = { dt: 1 / 60 };
  function speedOf(o) {
    const s = o && o.speed;
    if (typeof s === "number") return s;
    return s === "run" ? 4.6 : s === "jog" ? 3.1 : 1.6;
  }
  EXEC.moveTo = function (a, x, z, o) {
    if (!a) return false;
    if (a._powerCop && a._post) { a._post.x = x; a._post.z = z; a._post.mountT = 0; a._post.mount = null; return true; }
    if (a._detBase0 == null) a._detBase0 = a.baseSpeed != null ? a.baseSpeed : 1.6;
    a.baseSpeed = Math.max(0.4, speedOf(o));
    a._boardRun = false;
    a.state = "walk"; a.path = null; a.finalGoal = null; a.pause = 0;
    if (a.target && a.target.set) a.target.set(x, 0, z);
    else a.target = { x: x, y: 0, z: z, set: function (X, Y, Z) { this.x = X; this.y = Y; this.z = Z; } };
    return true;
  };
  EXEC.stop = function (a) {
    if (!a) return false;
    if (a._powerCop && a._post) return true;            // his post brain holds him on the slot we wrote
    const p = P(a);
    a.state = "idle"; a.speed = 0; a._boardRun = false; a.path = null;
    if (a.target && a.target.set && p) a.target.set(p.x, 0, p.z);
    if (a._detBase0 != null) { a.baseSpeed = a._detBase0; a._detBase0 = null; }
    return true;
  };
  EXEC.face = function (a, x, z) {
    if (!a) return false;
    const p = P(a); if (!p) return false;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < 1e-4) return true;
    if (a._powerCop && a._post) { const l = Math.sqrt(dx * dx + dz * dz); a._post.fx = dx / l; a._post.fz = dz / l; return true; }
    const want = Math.atan2(dx, dz), cur = yawOf(a), d = wrap(want - cur);
    const rate = a._detTurn || TUNE.TURN, max = rate * EXEC.dt;
    // bounded turn that eases in over the last ~15 degrees
    const ad = Math.abs(d);
    const step = (d > 0 ? 1 : -1) * Math.min(ad < 0.26 ? ad * Math.min(1, EXEC.dt * 9) : ad, max);
    setYaw(a, cur + step);
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
      else { f = -1.9 - Math.max(0, (si || 1) - 1) * 1.0; r = 0; look = PI; }
    } else if (kind === "cp") { const s = Math.min(0.85, 0.35 + R * 0.17); f = -s; r = s; look = 0.35; }
    else if (kind === "point") { f = R; look = 0; }
    else if (kind === "left") { f = 0.2 * R; r = -R; look = -PI / 2; }
    else if (kind === "right") { f = 0.2 * R; r = R; look = PI / 2; }
    else if (kind === "tail") { f = -R; look = PI; }
    else if (kind === "sweep") { f = mode === "crowd" ? R * 2.2 : R * 3.3; look = 0; }
    else {                                              // outer ring, evenly spread
      const a = ((k + 0.5) / Math.max(1, nRing)) * TAU, R2 = R * 1.5;
      f = Math.cos(a) * R2; r = Math.sin(a) * R2; look = a;
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
  // world offset of a local (f, r) under heading h
  function rot(f, r, h, out) {
    const fx = Math.sin(h), fz = Math.cos(h), rx = -Math.cos(h), rz = Math.sin(h);
    out.x = fx * f + rx * r; out.z = fz * f + rz * r;
    return out;
  }
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
      key: key, t: 0, init: false,
      px: 0, pz: 0, vx: 0, vz: 0, spd: 0, moving: false, h: 0, hWant: 0, hAtAssign: 0,
      mode: "open", modeWant: "open", modeT: 0, crowdHigh: false, crowdT: 0,
      R: TUNE.R_OPEN, Rv: 0,
      roster: [], active: [], cp: null,
      assignT: 0, betterT: 0, rosterDirty: true,
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
        D: D, id: id, kind: null, k: 0, ox: 0, oz: 0, ovx: 0, ovz: 0, init: false,
        hold: false, gx: 1e9, gz: 1e9, gs: -1, issueT: -9,
        lookYaw: null, lookT: 0, lookAt: null, react: 0, epoch: -1, said: false,
        seed: h01(id * 7.13),
      };
    }
    return m;
  }
  function release(q) {
    if (!q) return;
    if (q._detBase0 != null) { q.baseSpeed = q._detBase0; q._detBase0 = null; }
    q._det = null; q._detailBrain = null; q._detTurn = null;
  }

  // ---- 1. the principal, filtered -------------------------------------
  function track(D, pp, principal, dt) {
    if (!D.init) {
      D.px = pp.x; D.pz = pp.z; D.init = true;
      D.h = D.hWant = D.hAtAssign = yawOf(principal);
      return;
    }
    const dx = pp.x - D.px, dz = pp.z - D.pz;
    D.px = pp.x; D.pz = pp.z;
    if (dt <= 0) return;
    const ivx = dx / dt, ivz = dz / dt, inst = Math.sqrt(ivx * ivx + ivz * ivz);
    if (inst > 25) {                                     // a teleport / a car exit: re-seat, don't sprint
      D.vx = D.vz = 0; D.spd = 0; D.moving = false;
      return;
    }
    const k = 1 - Math.exp(-dt / TUNE.VEL_TAU);
    D.vx += (ivx - D.vx) * k; D.vz += (ivz - D.vz) * k;
    D.spd = Math.sqrt(D.vx * D.vx + D.vz * D.vz);
    if (!D.moving && D.spd > TUNE.MOVE_IN) D.moving = true;
    else if (D.moving && D.spd < TUNE.MOVE_OUT) D.moving = false;
    if (D.moving) D.hWant = Math.atan2(D.vx, D.vz);
    const d = wrap(D.hWant - D.h), max = TUNE.HEAD_RATE * dt;
    D.h = wrap(D.h + (Math.abs(d) <= max ? d : (d > 0 ? max : -max)));
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
    else if (env.door) want = "door";
    else if (D.crowdHigh) want = "crowd";
    if (want !== D.modeWant) { D.modeWant = want; D.modeT = 0; }
    D.modeT += dt;
    // entering a door or a shield is immediate; leaving a door waits a beat
    if (D.mode !== D.modeWant && (D.modeWant === "shield" || D.modeWant === "door" || D.modeT > TUNE.DOOR_DWELL)) {
      D.mode = D.modeWant; D.rosterDirty = true;
    }
    const Rw = D.mode === "shield" ? TUNE.R_SHIELD : D.mode === "hold" ? TUNE.R_HOLD : D.mode === "crowd" ? TUNE.R_CROWD : TUNE.R_OPEN;
    // critically damped radius
    const w = TUNE.RADIUS_W, a = w * w * (Rw - D.R) - 2 * w * D.Rv;
    D.Rv += a * dt; D.R += D.Rv * dt;
  }

  // ---- 4. assignment (least walking, with hysteresis) --------------------
  const _kinds = [], _slotX = [], _slotZ = [], _pairs = [], _useQ = [], _useS = [], _best = [];
  const _o = { x: 0, z: 0 }, _sl = { f: 0, r: 0, look: 0 };
  function slotWorldOffset(D, kind, k, nRing, out, si) {
    if (D.form && kind.indexOf("form") === 0 && D.mode !== "door") {
      const f = D.form[k] || { f: -2, s: 0 };
      const sc = D.R / TUNE.R_OPEN;                       // an authored shape tightens in a crowd too
      return rot(f.f * sc, -(f.s || 0) * sc, D.h, out);
    }
    slotLocal(kind, k, nRing, D.R, D.mode, _sl, si);
    return rot(_sl.f, _sl.r, D.h, out);
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
  const _others = [], _pairPool = [];
  function assign(D, dt, force) {
    const others = _others; others.length = 0;
    for (let i = 0; i < D.active.length; i++) if (D.active[i] !== D.cp) others.push(D.active[i]);
    const n = others.length;
    const kinds = slotKinds(D, n);
    let nRing = 0; for (let i = 0; i < n; i++) if (kinds[i] === "ring") nRing++;
    _slotX.length = _slotZ.length = 0;
    for (let i = 0; i < n; i++) {
      slotWorldOffset(D, kinds[i], kIndex(kinds, i), nRing, _o, i);
      _slotX.push(D.px + _o.x); _slotZ.push(D.pz + _o.z);
    }
    // current assignment cost (a member whose kind is gone counts as unassigned)
    let curCost = 0, valid = true;
    for (let i = 0; i < n; i++) {
      const m = memberOf(D, others[i]);
      const si = m.kind != null ? kinds.indexOf(m.kind) : -1;
      if (si < 0 || m.kind === "cp") { valid = false; break; }
      if (m.kind === "ring" || m.kind.indexOf("form") === 0) { if (m.k >= n) { valid = false; break; } }
      const p = P(others[i]);
      const sidx = m.kind === "ring" ? ringSlotIndex(kinds, m.k) : si;
      if (sidx < 0) { valid = false; break; }
      curCost += hyp(p.x, p.z, _slotX[sidx], _slotZ[sidx]);
    }
    // distinct kinds check (two members on one slot = invalid)
    if (valid) {
      for (let i = 0; i < n && valid; i++) for (let j = i + 1; j < n; j++) {
        const a = others[i]._det, b = others[j]._det;
        if (a.kind === b.kind && (a.kind !== "ring" || a.k === b.k)) { valid = false; break; }
      }
    }
    // greedy least-distance assignment
    _pairs.length = 0;
    let pi = 0;
    for (let i = 0; i < n; i++) {
      const p = P(others[i]);
      for (let s = 0; s < n; s++) {
        const pr = _pairPool[pi] || (_pairPool[pi] = { q: 0, s: 0, d: 0 });
        pr.q = i; pr.s = s; pr.d = hyp(p.x, p.z, _slotX[s], _slotZ[s]);
        _pairs.push(pr); pi++;
      }
    }
    _pairs.sort(function (a, b) { return a.d - b.d; });
    _useQ.length = _useS.length = 0; _best.length = n;
    for (let i = 0; i < n; i++) { _useQ.push(false); _useS.push(false); }
    let bestCost = 0;
    for (let i = 0; i < _pairs.length; i++) {
      const pr = _pairs[i];
      if (_useQ[pr.q] || _useS[pr.s]) continue;
      _useQ[pr.q] = _useS[pr.s] = true; _best[pr.q] = pr.s; bestCost += pr.d;
    }
    let take = force || !valid;
    if (!take) {
      const better = curCost - bestCost > Math.max(TUNE.REASSIGN_MIN, curCost * TUNE.REASSIGN_GAIN);
      if (better) {
        D.betterT += dt;
        // a real turn (the heading moved a lot since the last assignment) re-labels at once
        const turned = Math.abs(wrap(D.hWant - D.hAtAssign)) > 0.9;
        if (turned || D.betterT >= TUNE.REASSIGN_PERSIST) take = true;
      } else D.betterT = 0;
    }
    if (take) {
      for (let i = 0; i < n; i++) {
        const m = memberOf(D, others[i]);
        const s = _best[i];
        const kind = kinds[s];
        m.kind = kind; m.k = kIndex(kinds, s); m.si = s;
        roleNote(others[i], kind);
      }
      D.betterT = 0; D.hAtAssign = D.hWant;
    }
    if (D.cp) { const m = memberOf(D, D.cp); if (m.kind !== "cp") { m.kind = "cp"; m.k = 0; roleNote(D.cp, "cp"); } }
    D.nRing = nRing;
  }
  function ringSlotIndex(kinds, k) {
    let c = 0;
    for (let i = 0; i < kinds.length; i++) if (kinds[i] === "ring") { if (c === k) return i; c++; }
    return -1;
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
    m.lookAt = best && bs > 0.9 ? best : null;
    if (!m.lookAt) m.lookYaw = sectorYaw + (h01(m.id * 5.7 + D.t * 0.37) * 2 - 1) * half;
    const lo = hot ? TUNE.DWELL_HOT * 0.7 : TUNE.DWELL_MIN, hi = hot ? TUNE.DWELL_HOT * 1.5 : TUNE.DWELL_MAX;
    m.lookT = m.dwell = lo + (hi - lo) * h01(m.id * 2.9 + D.t * 1.13);
  }

  // ---- 7. drive one member ----------------------------------------------
  const _off = { x: 0, z: 0, look: 0 };
  function driveMember(D, q, m, idx, count, dt, env) {
    const A = act();
    const qp = P(q);
    const hot = D.phase === "cover" || D.phase === "evac";
    const reacting = m.epoch === D.epoch && D.phaseT < m.react && (hot || D.phase === "alert");
    // A MAN STILL REACTING has not decided anything yet: whatever he was
    // doing a moment ago simply carries on (the last order stands).
    if (reacting && m.init) return;
    // --- goal offset ---
    let lookYaw = null;
    if (hot) {
      shieldOffset(D, q, idx, count, _off);
      lookYaw = _off.look;
    } else if (D.phase === "alert" && !reacting && D.screen.indexOf(q) >= 0 && D.hasT) {
      const tb = Math.atan2(D.tx - D.px, D.tz - D.pz);
      const a = tb + (D.screen[0] === q ? -0.35 : 0.35);
      _off.x = Math.sin(a) * 1.2; _off.z = Math.cos(a) * 1.2; lookYaw = tb;
    } else {
      if (m.kind === "cp") { slotLocal("cp", 0, 1, D.R, D.mode === "door" ? "door" : D.mode, _sl); rot(_sl.f, _sl.r, D.h, _off); _off.look = D.h + _sl.look; }
      else {
        slotWorldOffset(D, m.kind || "ring", m.k, D.nRing || 1, _off, m.si);
        if (m.kind && m.kind.indexOf("form") === 0 && D.mode !== "door") _off.look = Math.atan2(_off.x, _off.z);
        else { slotLocal(m.kind || "ring", m.k, D.nRing || 1, D.R, D.mode, _sl, m.si); _off.look = D.h + _sl.look; }
      }
    }
    const sector = _off.look;
    // --- the offset spring (critically damped) ---
    if (!m.init) {
      m.ox = qp.x - D.px; m.oz = qp.z - D.pz; m.ovx = m.ovz = 0; m.init = true;
    }
    const w = hot ? TUNE.OFFSET_W_HOT : TUNE.OFFSET_W;
    const ax = w * w * (_off.x - m.ox) - 2 * w * m.ovx, az = w * w * (_off.z - m.oz) - 2 * w * m.ovz;
    m.ovx += ax * dt; m.ovz += az * dt; m.ox += m.ovx * dt; m.oz += m.ovz * dt;
    // --- where the body should be, and how fast ---
    const sx = D.px + m.ox, sz = D.pz + m.oz;
    const ex = sx - qp.x, ez = sz - qp.z, d = Math.sqrt(ex * ex + ez * ez);
    const moving = D.moving && D.spd > TUNE.MOVE_OUT;
    let gx, gz, sp;
    if (moving) {
      m.hold = false;
      const ux = D.vx / (D.spd || 1), uz = D.vz / (D.spd || 1);
      const along = ex * ux + ez * uz, lat = Math.abs(ex * -uz + ez * ux);
      sp = D.spd + TUNE.SPEED_K * along + 0.8 * lat;
      sp = Math.max(Math.max(0.35 * D.spd, 0.5), Math.min(TUNE.SPEED_MAX, sp));
      gx = sx + D.vx * TUNE.LEAD_T; gz = sz + D.vz * TUNE.LEAD_T;
    } else {
      if (m.hold) { if (d > (hot ? 0.8 : TUNE.HOLD_OUT)) m.hold = false; }
      else if (d < TUNE.HOLD_IN) m.hold = true;
      gx = sx; gz = sz;
      sp = Math.max(TUNE.SPEED_MIN, Math.min(TUNE.SPEED_MAX, 0.8 + TUNE.SPEED_K * d));
    }
    if (hot) sp = Math.max(sp, Math.min(TUNE.SPEED_MAX, 2.2 + 1.5 * d));
    q._detTurn = hot || D.phase === "alert" ? TUNE.TURN_HOT : TUNE.TURN;
    // --- issue (never every frame for tiny deltas) ---
    if (m.hold) {
      if (m.gs !== 0) { A.stop(q); m.gs = 0; m.gx = m.gz = 1e9; }
    } else {
      const moved = hyp(gx, gz, m.gx, m.gz);
      if (moved > TUNE.REISSUE_D || Math.abs(sp - m.gs) > 0.35 || D.t - m.issueT > TUNE.REISSUE_T || m.gs === 0) {
        A.moveTo(q, gx, gz, { speed: sp, arrive: TUNE.HOLD_IN });
        m.gx = gx; m.gz = gz; m.gs = sp; m.issueT = D.t;
      }
    }
    // --- facing: ONLY while standing. A walking body faces where it walks
    //     (the mover's job); turning him toward a threat at the same time is
    //     the tug-of-war that made bodies twitch. ---
    const standing = m.hold || !!(q._powerCop && q._post);
    if (lookYaw == null) {
      m.lookT -= dt;
      if (m.lookT <= 0) pickLook(D, q, m, sector, q === D.cp ? 1.2 : TUNE.SECTOR, env, D.phase !== "normal");
      if (m.lookAt && !m.lookAt.dead) { const lp = P(m.lookAt); lookYaw = Math.atan2(lp.x - qp.x, lp.z - qp.z); }
      else lookYaw = m.lookYaw != null ? m.lookYaw : sector;
    } else if (hot && D.hasT) lookYaw = Math.atan2(D.tx - qp.x, D.tz - qp.z);
    if (standing) A.face(q, qp.x + Math.sin(lookYaw) * 10, qp.z + Math.cos(lookYaw) * 10);
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
        const verb = A.verb("grab", D.cp, principal, { from: from, push: "down" }) || A.verb("escort", D.cp, principal, { from: from });
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
    // his own slot wins this frame (see above)
    const m = q._det; if (m) { m.issueT = -9; if (m.gs === 0) m.gs = -1; }
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
    D.assignT -= dt;
    if (D.rosterDirty || D.assignT <= 0) {
      D.assignT = TUNE.REASSIGN_EVERY;
      assign(D, D.rosterDirty ? 0 : TUNE.REASSIGN_EVERY, D.rosterDirty);
      D.rosterDirty = false;
    }
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
