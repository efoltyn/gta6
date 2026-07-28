/* ============================================================
   city/kinship.js — THE PEOPLE YOU CAN SEE BELONG TO EACH OTHER.

   OWNER (2026-07-28, verbatim): "There's all these very undone things like
   family — whole family and friends. There's no family and friends in this
   game. It's coded, but it's, like, coded mathematically and not in reality
   and not artistically."

   He is exactly right, and the census proves it line by line. The MATH is all
   here already and none of it has a BODY:

     · social.js's citySocialInit weaves ~45% of the civilian population into
       couples — by walking the ped array two at a time. Nothing checks that
       the two people are anywhere NEAR each other, so half the city's
       "couples" are two strangers four hundred metres apart who will never
       once be in the same shot. A marriage you can never see is a number.
     · The same function deals every civilian a `cliqueId`. Grep the whole
       repo: it is written in ONE place and READ IN NONE. So is `opinion`.
       So is `knowsHero`. So is `_widowed` — social.js stamps it on the
       survivor of a killed couple and no line of code has ever asked.
     · familytree.js keeps a real, persisted, save-riding genealogy — spouses,
       parents, children, birthdays — and the ONLY thing in the game that ever
       renders any of it is a panel behind the [L] key.
     · The city's ONE piece of visible companionship is childhood.js's toddler
       leash. Everybody else walks alone, forever, past their own wife.

   So this file authors NO new relationship data. Not one field, not one
   roster, not one ladder. It is the BODY for the arithmetic that was already
   running, and it is four things you can see from the pavement:

     1. BONDED WALKERS. A couple strolls side by side at ONE pace. A parent
        walks a real (childhood.js-aged) child HAND IN HAND. Two friends walk
        and talk, glancing at each other. Every one of those people was
        already in the crowd — nothing is spawned, nothing is teleported.
     2. GREETINGS. Two people who actually know each other — married, kin on
        the family tree, same clique, same trade — pass within arm's reach and
        STOP: they turn, one waves, they trade a line, they part. Hard rate
        limits, because life that repeats every eight seconds is a glitch.
     3. GRIEF. Kill somebody in front of the person who loves them and that
        person breaks formation, RUNS to the body and kneels beside it before
        the panic takes them. Killing a parent in front of their kid should
        cost you something, and the cost is that you have to watch.
     4. THE PLAYER'S OWN PEOPLE, WARMER — exported as beats family.js calls,
        so the house is a home and not a set of waypoints.

   HOW IT STEERS WITHOUT OWNING ANYBODY (the whole safety story). We are
   companions.js's pattern: a separate updater that sets FLAGS AND GOALS on
   actors other brains already run, and hands them back the instant anything
   more important wants them.
     · Ordinary walking is a TARGET NUDGE. We write `follower.target` and let
       peds.js's own move() do the walking — which means collision, the
       anti-tunnel depenetration, the ground clamp and the LEG ANIMATION are
       all the real ones. We never integrate a body along a vector while its
       legs are being animated at speed 0; that is the foot-slide, and it is
       the reason childhood.js's driven kids skate.
     · PACE IS SOLVED, NOT FAKED. peds.js draws baseSpeed in 1.5-2.5 m/s, so
       a random pair differs by up to 1.7x — and move()'s arrival deadzone is
       a hard 0.5 m with no ease, so a faster follower would stop-start every
       third frame and shuffle. THE LEADER IS THE SLOWER PERSON, always, and
       the follower's baseSpeed is held at the leader's while bonded (saved in
       `_kinBase`, restored by a self-healing sweep that can never leak). A
       couple walking at the slower one's pace is also just true.
     · STOPPING is peds.js's OWN `chatT` — the stand-still its brain already
       owns (aigoals.js's startChat uses the identical two lines). move() ticks
       it down and releases the body to "walk" on its own. We never invent a
       freeze.
     · GESTURES are entities/poses.js. `CBZ.charPoses` is a registry and this
       file adds rows to it; animChar runs a pose only when the body is NOT
       moving, which is exactly a person who has stopped to say hello.
       Hand-holding is the one exception (you do it WHILE walking), so it is a
       post-anim arm write — the same shape peds.js's own witness tells use
       twenty lines below its animChar call.

   YIELD IS ABSOLUTE. Every member of every unit is re-tested every tick
   against `claimed()`: dead, KO, seized, fleeing, fighting, surrendering,
   alarmed, arrested, hostage, kidnapped, seated, attached, in a car, held by
   childhood.js's curfew, hunting as a predator, posted as staff. One failure
   drops the WHOLE unit and restores every field we touched. There is no
   cleanup debt anywhere in this file: `CBZ.kinshipAudit().strandedSpeed` is
   the invariant that proves it and it must read 0.

   DETERMINISM. WHO is bonded is position-hashed (`CBZ.hash01`), never
   Math.random, and never a draw on anybody else's seeded stream — a pair key
   is symmetric so (a,b) and (b,a) agree. WHEN a beat plays is runtime jitter
   and may use Math.random (CLAUDE.md's split).

   Flags: KINSHIP_LIFE (master) · KINSHIP_WALK · KINSHIP_GREET · KINSHIP_GRIEF.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onUpdate) return;
  const g = CBZ.game;
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  // declared defensively here (this file may load before/without a config.js
  // entry); a config.js value always wins, and each one is a one-line revert.
  if (C.KINSHIP_LIFE == null) C.KINSHIP_LIFE = true;    // master
  if (C.KINSHIP_WALK == null) C.KINSHIP_WALK = true;    // bonded walkers
  if (C.KINSHIP_GREET == null) C.KINSHIP_GREET = true;  // street greetings
  if (C.KINSHIP_GRIEF == null) C.KINSHIP_GRIEF = true;  // the mourning beat
  const on = () => C.KINSHIP_LIFE !== false;

  // ---- budget ---------------------------------------------------------------
  const UNIT_CAP = 16;        // active steered units (a unit is 2-3 bodies)
  const NEAR_R = 140;         // we only ever look at people near the camera
  const SCAN_CELL = 12;       // neighbour grid cell, metres
  const PAIR_R = 26;          // how far apart two bonded people may start out
  const LEASH = 24;           // separated further than this: the unit dissolves
  const GREET_R = 3.4;        // "passing within arm's reach"
  const GREET_CD = 110;       // seconds before the same person greets again
  const GREET_NEAR = 46;      // a greeting only plays where you could see it
  const GRIEF_R = 30;         // how far grief reaches from a body
  const GRIEF_MAX = 7.0;      // hard ceiling on a grief beat, seconds
  const REBUILD = 0.9;        // unit re-scan cadence
  const GREET_SCAN = 0.55;

  // ---- counters (the ratchet reads these) ------------------------------------
  let _greetings = 0, _griefs = 0, _yields = 0, _dealt = 0;
  let _clock = 0, _rebuildT = 0, _greetT = 0;
  const units = [];           // {kind, leader, members[], turnT, holdHands}
  const grieving = [];        // {ped, victim, phase, t, hp0}

  function qs(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  function hourNow() { return CBZ.cityHour ? CBZ.cityHour() : 12; }
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  // ============================================================
  //  POSES — rows added to entities/poses.js's SHARED registry. We add to the
  //  registry rather than write arms ourselves so animChar's own precedence
  //  (aiming > cuffed > hands-up > carry > POSE > gait) keeps holding: a person
  //  at gunpoint mid-hello puts their hands up, and a person who starts WALKING
  //  falls straight through to the gait. That is not a nicety — it is what
  //  makes a greeting impossible to get stuck in.
  //  Poses are damped rotation-only writes (poses.js's contract), and these
  //  three are ALIVE: they read ch.breath, which animChar advances every frame,
  //  so a wave actually waves instead of being a raised arm.
  // ============================================================
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  function elbow(J, x, dt, rate) { if (J) J.rotation.x = damp(J.rotation.x, Math.min(0, x), rate || 14, dt); }
  if (CBZ.charPoses) {
    // a hand up beside the head, swinging — the universal "hey!"
    CBZ.charPoses.kinWave = function (ch, dt) {
      const J = ch.low || {}, r = 15, t = ch.breath || 0;
      const ra = ch.parts && ch.parts.ra, la = ch.parts && ch.parts.la;
      const sw = Math.sin(t * 8.5) * 0.30;
      if (ra) {
        ra.rotation.x = damp(ra.rotation.x, -1.62, r, dt);
        ra.rotation.z = damp(ra.rotation.z, -0.34 + sw, r + 6, dt);
      }
      if (la) { la.rotation.x = damp(la.rotation.x, -0.06, r, dt); la.rotation.z = damp(la.rotation.z, -0.05, r, dt); }
      elbow(J.ra, -0.80 + sw * 0.35, dt, r + 6); elbow(J.la, -0.20, dt, r);
    };
    // hands working low in front — someone in the middle of saying something
    CBZ.charPoses.kinTalk = function (ch, dt) {
      const J = ch.low || {}, r = 13, t = ch.breath || 0;
      const ra = ch.parts && ch.parts.ra, la = ch.parts && ch.parts.la;
      const beat = Math.sin(t * 3.1), off = Math.sin(t * 1.7 + 1.1);
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.52 + beat * 0.16, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.18, r, dt); }
      if (la) { la.rotation.x = damp(la.rotation.x, -0.30 + off * 0.08, r, dt); la.rotation.z = damp(la.rotation.z, 0.14, r, dt); }
      elbow(J.ra, -1.05 - beat * 0.22, dt, r); elbow(J.la, -0.62, dt, r);
    };
    // arms folded loose, weight settled — the other half of a conversation
    CBZ.charPoses.kinListen = function (ch, dt) {
      const J = ch.low || {}, r = 12, t = ch.breath || 0;
      const ra = ch.parts && ch.parts.ra, la = ch.parts && ch.parts.la;
      const br = Math.sin(t * 1.3) * 0.03;
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.78 + br, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.30, r, dt); }
      if (la) { la.rotation.x = damp(la.rotation.x, -0.72 + br, r, dt); la.rotation.z = damp(la.rotation.z, 0.34, r, dt); }
      elbow(J.ra, -1.32, dt, r); elbow(J.la, -1.26, dt, r);
    };
    // down over the body: shoulders in, both arms hanging forward and low.
    // Read with ch.crouch (animChar folds the hips) this is a kneel, and the
    // stillness is the whole point — there is no motion term on purpose.
    CBZ.charPoses.kinGrieve = function (ch, dt) {
      const J = ch.low || {}, r = 10;
      const ra = ch.parts && ch.parts.ra, la = ch.parts && ch.parts.la;
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -0.62, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.10, r, dt); }
      if (la) { la.rotation.x = damp(la.rotation.x, -0.62, r, dt); la.rotation.z = damp(la.rotation.z, 0.10, r, dt); }
      elbow(J.ra, -0.42, dt, r); elbow(J.la, -0.42, dt, r);
      if (ch.neck) ch.neck.rotation.x = damp(ch.neck.rotation.x, 0.34, r, dt);   // head down
    };
  }
  function setPose(p, name) {
    const ch = p && p.char; if (!ch) return;
    if (ch.pose && String(ch.pose).indexOf("kin") !== 0) return;   // somebody else's held pose wins
    ch.pose = name || null;
  }
  function clearPose(p) {
    const ch = p && p.char; if (!ch) return;
    if (ch.pose && String(ch.pose).indexOf("kin") === 0) ch.pose = null;
    if (p._kinCrouch) { ch.crouch = false; p._kinCrouch = false; }
  }

  // ============================================================
  //  WHO IS FREE — the yield test, run on every member every tick.
  //  This is the ENTIRE safety contract of the file. If any of these is true
  //  the actor belongs to somebody else and we drop it mid-beat, restoring
  //  everything we touched. There is no state we cannot abandon on this frame.
  // ============================================================
  function claimed(p) {
    if (!p || p.dead || !p.pos || !p.group || !p.char) return true;
    if ((p.ko || 0) > 0 || p.isPlayer || p._parked || p.vendor) return true;
    if (p.inCar || p.driving || p._npcAttached || p._propSeat || p._deskAnchor) return true;
    if (p.state === "sit" || p.state === "flee" || p.state === "fight" || p.state === "confront") return true;
    if (p.controlled || p.companion || p.recruited || p.hostage || p.kidnapped) return true;
    if (p.rage || p.surrender || p.poseHandsUp || p._covered || p.reportState) return true;
    if ((p.alarmed || 0) > 0 || p.rampage || p._bumHunt || p.staffPost || p.guard) return true;
    if (p.approach) return true;                         // walking up to the player
    if (p.restraint || p.cuffed || p.busted || p.arrestState) return true;
    if (p.kind === "cop" || p.kind === "security") return true;
    if (p._kidHeld || p._kidInside) return true;        // childhood.js owns the legs
    if ((p.enterT || 0) > 0) return true;               // inside a building
    if (p._kinGrief) return true;                        // our own grief beat outranks a stroll
    return false;
  }
  // eligible to be PICKED for a unit (stricter than "free": we also refuse
  // anyone the world has given a job to do right now).
  function eligible(p) {
    if (claimed(p)) return false;
    if (p._kinUnit || p._kinBeat) return false;
    if (p.armed) return false;                           // a person carrying a gun is not out for a walk
    if (p.finalGoal && p.finalGoal.sitDesk) return false;
    // family.js's household ALREADY has a bond and a whole daily routine (the
    // yard, the meals, the curfew) keyed to their address. Steering one of them
    // into a street unit would silently disable that routine, because family.js
    // skips anybody we hold — so they are out of scope for WALKING and get
    // their life through the porch/dinner/homecoming beats instead, which are
    // short and hand the body straight back.
    if (p._fam) return false;
    // aigoals.js is running its own temporary speed override on this body
    // (`_joyT` / `_baseSpeed0`); two save-and-restore disciplines on one field
    // is exactly how a person ends up sprinting forever.
    if (p._joyT) return false;
    return true;
  }

  // ============================================================
  //  PACE — the one place a bonded body's speed is written, and the one place
  //  it is given back. `_kinBase` is a save slot, not a second speed field:
  //  it exists only while we hold the body, and the sweep in tick() restores
  //  any body still carrying one that no unit claims (which is why a despawn,
  //  a mode change or a thrown exception can never leave somebody walking at
  //  the wrong speed forever). kinshipAudit().strandedSpeed pins that at 0.
  // ============================================================
  function pace(p, spd) {
    if (!p) return;
    if (p._kinBase == null) p._kinBase = p.baseSpeed;
    p.baseSpeed = spd;
  }
  function unpace(p) {
    if (!p) return;
    if (p._kinBase != null) { p.baseSpeed = p._kinBase; p._kinBase = null; }
  }
  // EXPORTED (family.js's excited kids use it): a temporary pace multiplier
  // through the SAME save slot, so there is ONE speed discipline and ONE
  // sweep. It carries a TTL rather than trusting the caller to clean up —
  // a caller that stops calling (the player left the house) gets the body's
  // own legs back within a couple of seconds, whatever else happened.
  CBZ.kinshipPace = function (ped, mul, ttl) {
    if (!ped || !on()) return;
    if (ped._kinBase == null) ped._kinBase = ped.baseSpeed;
    ped.baseSpeed = ped._kinBase * (mul || 1);
    ped._kinPaceT = _clock + (ttl > 0 ? ttl : 2.5);
  };
  CBZ.kinshipPaceClear = function (ped) { if (ped) { ped._kinPaceT = 0; unpace(ped); } };
  function paceHeld(p) { return (p._kinPaceT || 0) > _clock; }
  function unitLive(p) { return !!(p._kinUnit && units.indexOf(p._kinUnit) >= 0); }

  // ============================================================
  //  WHO KNOWS WHOM — derived, never stored. Every source below is a field
  //  another module was ALREADY writing; this function is the first thing in
  //  the game that reads several of them.
  // ============================================================
  function kinSeedX(p) { if (p._kinSeedX == null) { p._kinSeedX = p.pos ? p.pos.x : 0; p._kinSeedZ = p.pos ? p.pos.z : 0; } return p._kinSeedX; }
  function kinSeedZ(p) { kinSeedX(p); return p._kinSeedZ; }
  function selfHash(p, salt) { return CBZ.hash01 ? CBZ.hash01(kinSeedX(p), kinSeedZ(p), salt) : 0.5; }
  // symmetric pair hash: (a,b) and (b,a) must agree or a bond would flicker
  // depending on which body the scan reached first. Each side is reduced to
  // ONE scalar off its own spawn point first, then the two are fed in sorted
  // order — that sort is the whole symmetry proof.
  const ID_SALT = 0x4B1D;
  function pairHash(a, b, salt) {
    const ka = selfHash(a, ID_SALT), kb = selfHash(b, ID_SALT);
    const lo = Math.min(ka, kb) * 9973, hi = Math.max(ka, kb) * 9973;
    return CBZ.hash01 ? CBZ.hash01(lo, hi, salt) : 0.5;
  }
  function sidOf(p) { return p && p._sid ? p._sid : null; }
  function liveOf(sid) { return (sid && CBZ.cityLedgerLive) ? CBZ.cityLedgerLive(sid) : null; }
  function isKid(p) { return !!(p && (p.child || (CBZ.cityIsChild && CBZ.cityIsChild(p)))); }

  // THE ONE ANSWER: what are these two to each other?
  //   "spouse" | "parent" | "child" | "sibling" | "kin" | "friend" | "work" | null
  // (`a`'s side of it — parent means A is B's parent.)
  function relationOf(a, b) {
    if (!a || !b || a === b) return null;
    if (a.partner === b || b.partner === a) return "spouse";
    const T = CBZ.cityFamilyTree, sa = sidOf(a), sb = sidOf(b);
    if (T && sa && sb) {
      if (T.spouseOf(sa) === sb) return "spouse";
      const kids = T.kidsOf(sa);
      if (kids && kids.indexOf(sb) >= 0) return "parent";
      const par = T.parentsOf(sa);
      if (par && par.indexOf(sb) >= 0) return "child";
      if (par && par.length) {
        const pb = T.parentsOf(sb) || [];
        for (let i = 0; i < par.length; i++) if (pb.indexOf(par[i]) >= 0) return "sibling";
      }
    }
    // family.js's household record (the player's / a boss's people)
    if (a._fam && a._fam === b._fam) return isKid(b) && !isKid(a) ? "parent" : (isKid(a) && !isKid(b) ? "child" : "kin");
    // social.js's live kin array + the protected-kin stamp weaveFamilies writes
    if (a.family && a.family.indexOf(b) >= 0) return isKid(b) && !isKid(a) ? "parent" : (isKid(a) && !isKid(b) ? "child" : "kin");
    if (a.protectedBy === b) return "kin";
    if (b.protectedBy === a) return "kin";
    if (a.friends && a.friends.indexOf(b) >= 0) return "friend";
    // FIRST READER OF cliqueId. social.js has dealt every civilian a clique id
    // since the day it shipped and nothing has ever asked for one.
    if (a.cliqueId && a.cliqueId === b.cliqueId) return "friend";
    // people who do the same work in the same part of town know each other —
    // one in three of them, deterministically, so a trade is not a hive mind.
    if (a.job && b.job && a.job === b.job && pairHash(a, b, 0x77E4) < 0.34) return "work";
    if (a.gang && a.gang === b.gang) return "work";
    return null;
  }
  CBZ.kinshipKnows = relationOf;

  // ============================================================
  //  THE DEALT FRIENDSHIP — the one place this file adds a relationship the
  //  world did not already have, and it is deliberately RARE and deliberately
  //  STABLE. The city casts ~45% of civilians into couples and leaves the rest
  //  alone forever; a street with nobody who is out WITH anybody reads as a
  //  screensaver. So two unattached civilians standing near each other, on a
  //  symmetric position hash, are two people who came out together. It is a
  //  position hash and not a die: the same two people are always the pair, and
  //  a reload deals it identically.
  // ============================================================
  function dealtFriends(a, b) {
    if (a.partner || b.partner) return false;
    if (a.gang || b.gang) return false;
    if (isKid(a) !== isKid(b)) return false;             // an adult and a stranger's child are not "out together"
    return pairHash(a, b, 0x1CE5) < 0.16;
  }

  // ============================================================
  //  UNIT FORMATION
  // ============================================================
  function unitKindFor(a, b, rel) {
    if (rel === "spouse") return "couple";
    if (rel === "parent" || rel === "child") return "family";
    if (rel === "sibling" || rel === "kin") return "family";
    return "friends";
  }
  // A parent-and-child unit is DAYTIME ONLY, by construction. childhood.js owns
  // the evening walk home and the curfew hold, and a stroll that fought it
  // would be the one bug the owner would notice first.
  function unitAllowedNow(kind, a, b) {
    if (kind !== "family") return true;
    if (!isKid(a) && !isKid(b)) return true;
    const h = hourNow();
    return h >= 8 && h < 19;
  }

  function claim(u) {
    for (let i = 0; i < u.members.length; i++) {
      const m = u.members[i];
      m._kinUnit = u;
      pace(m, u.pace);                 // ONE pace for the whole unit, leader included
    }
  }
  function releaseMember(m) {
    if (!m) return;
    m._kinPaceT = 0;
    unpace(m);
    m._kinUnit = null;
    if (m._kinBeat) endBeat(m); else clearPose(m);
    m._kinHold = false;
  }
  function dropUnit(u, why) {
    const i = units.indexOf(u);
    if (i >= 0) units.splice(i, 1);
    for (let k = 0; k < u.members.length; k++) releaseMember(u.members[k]);
    if (why === "yield") _yields++;
  }

  // ---- the neighbour grid (built once per rebuild, thrown away after) -------
  let gridCells = null;
  function gkey(x, z) { return ((x / SCAN_CELL) | 0) + "," + ((z / SCAN_CELL) | 0); }
  function buildGrid(list) {
    gridCells = new Map();
    for (let i = 0; i < list.length; i++) {
      const p = list[i], k = gkey(p.pos.x, p.pos.z);
      let c = gridCells.get(k);
      if (!c) { c = []; gridCells.set(k, c); }
      c.push(p);
    }
  }
  function eachNear(p, r, fn) {
    if (!gridCells) return;
    const gx = (p.pos.x / SCAN_CELL) | 0, gz = (p.pos.z / SCAN_CELL) | 0;
    const span = Math.max(1, Math.ceil(r / SCAN_CELL));
    for (let ax = gx - span; ax <= gx + span; ax++) {
      for (let az = gz - span; az <= gz + span; az++) {
        const c = gridCells.get(ax + "," + az);
        if (!c) continue;
        for (let i = 0; i < c.length; i++) if (c[i] !== p && fn(c[i]) === false) return;
      }
    }
  }

  function formUnits(list) {
    if (C.KINSHIP_WALK === false || !list || !list.length) return;
    for (let i = 0; i < list.length && units.length < UNIT_CAP; i++) {
      const a = list[i];
      if (!eligible(a)) continue;
      let best = null, bestRel = null, bestD = PAIR_R * PAIR_R;
      eachNear(a, PAIR_R, function (b) {
        if (!eligible(b)) return;
        const dd = d2(a.pos.x, a.pos.z, b.pos.x, b.pos.z);
        if (dd >= bestD) return;
        let rel = relationOf(a, b);
        if (!rel && dd < 13 * 13 && dealtFriends(a, b)) rel = "friend";
        if (!rel) return;
        bestD = dd; best = b; bestRel = rel;
      });
      if (!best) continue;
      const kind = unitKindFor(a, best, bestRel);
      if (!unitAllowedNow(kind, a, best)) continue;
      // TWO DIFFERENT QUESTIONS, ANSWERED SEPARATELY — this is the whole reason
      // a bonded pair reads as people rather than as a body and a shadow:
      //   WHO DECIDES WHERE WE ARE GOING is the LEADER; the others hold station
      //     on their shoulder. With a child in the group that is the GROWN-UP,
      //     always — a five-year-old does not pick the route.
      //   HOW FAST WE GO is the SLOWEST person, and it applies to EVERYBODY,
      //     leader included. A parent walking a child walks at the child's
      //     pace; that is just true, and it is also what stops move()'s hard
      //     0.5 m arrival deadzone turning a faster follower into a shuffle.
      const kidHere = isKid(a) !== isKid(best);
      let leader;
      if (kind === "family" && kidHere) leader = isKid(a) ? best : a;
      else leader = (a.baseSpeed <= best.baseSpeed) ? a : best;
      const other = leader === a ? best : a;
      const u = {
        kind: kind, rel: bestRel, leader: leader, members: [leader, other],
        pace: Math.min(a.baseSpeed, best.baseSpeed),
        turnT: 7 + Math.random() * 11,
        // hand-in-hand only where it is true: one grown-up, one real child.
        holdHands: kind === "family" && kidHere,
        side: pairHash(a, best, 0x5D1E) < 0.5 ? 1 : -1,
        t: 0,
      };
      // a third body joins a friend group when one is standing right there —
      // three people out together is a different silhouette from two.
      if (kind === "friends") {
        eachNear(leader, 9, function (c) {
          if (u.members.length >= 3) return false;
          if (!eligible(c) || c === a || c === best) return;
          if (!relationOf(leader, c) && !dealtFriends(leader, c)) return;
          if (c.baseSpeed < u.pace * 0.8) return;          // nobody joins who would drag the group
          u.members.push(c);
          u.pace = Math.min(u.pace, c.baseSpeed);
        });
      }
      if (bestRel === "friend" && !relationOf(a, best)) _dealt++;
      units.push(u);
      claim(u);
    }
  }

  // ============================================================
  //  STEERING — a target nudge, nothing more. peds.js's move() does the walk,
  //  the collision and the legs; we only say where the shoulder is.
  // ============================================================
  // SHOULDER SPACING, and it is arithmetic rather than taste. citynav.js's
  // context steering treats another body as DANGER inside NBR_SENSE = 2.4 m and
  // SATURATES that danger below NBR_HARD = 0.95 m — a saturated slot is masked
  // out of the steering parse entirely, so a formation authored tighter than
  // 0.95 would have the follower actively refusing to stand where we put it.
  // These sit just above that saturation knee, in the falloff band, where the
  // pull of the slot wins cleanly.
  const SPACING = {
    couple:  { lat: 0.98, fwd: -0.10 },
    family:  { lat: 0.86, fwd: -0.04 },   // closer: you are holding a child's hand
    friends: { lat: 1.16, fwd: -0.22 },
  };
  const CORRECT = 0.55;      // m/s of formation correction, capped well under a walk
  const PED_R = 0.5;         // peds.js's own body radius (its collide() call uses it)
  function driveUnit(u, dt) {
    const L = u.leader;
    // any member gone/claimed → the whole unit dissolves, cleanly, this frame.
    for (let i = 0; i < u.members.length; i++) {
      if (claimed(u.members[i])) { dropUnit(u, "yield"); return; }
    }
    // THE CHILD RULE IS RE-CHECKED, NOT JUST CHECKED AT FORMATION. A parent
    // and child unit formed at 18:50 must dissolve at 19:00 so childhood.js's
    // "head home an hour before curfew" nudge is the last word on where that
    // child goes. A rule enforced only at the seam is a rule you can outlive.
    if (!unitAllowedNow(u.kind, u.members[0], u.members[1])) { dropUnit(u, "curfew"); return; }
    u.t += dt;
    pace(L, u.pace);                                        // the leader walks at the group's pace too
    const yaw = L.group.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);          // peds face atan2(dx,dz): right = (cos, -sin)
    const sp = SPACING[u.kind] || SPACING.friends;
    let slot = 0;
    for (let i = 0; i < u.members.length; i++) {
      const m = u.members[i];
      if (m === L) continue;
      slot++;
      // slots alternate sides: 1 -> chosen side, 2 -> the other, 3 -> behind
      const side = (slot === 1) ? u.side : (slot === 2 ? -u.side : 0);
      const back = (slot >= 3) ? -1.15 : 0;
      const tx = L.pos.x + rx * sp.lat * side + fx * (sp.fwd + back);
      const tz = L.pos.z + rz * sp.lat * side + fz * (sp.fwd + back);
      const away = d2(m.pos.x, m.pos.z, L.pos.x, L.pos.z);
      if (away > LEASH * LEASH) { dropUnit(u, "leash"); return; }
      pace(m, u.pace);
      if (m._kinBeat) continue;                              // mid-beat: standing still on purpose
      if (m.target && m.target.set) m.target.set(tx, 0, tz);
      m.path = null; m.pause = 0;
      if (m.state !== "walk" && m.state !== "chat") m.state = "walk";
      // peds.js's OTHER (non-context) steering path keeps a cached Reynolds
      // separation vector on the body and re-applies it every frame between
      // recomputes. For a follower we ARE the separation — we are placing this
      // body deliberately — so the cache is zeroed and its recompute gate held
      // off. Only the follower: the LEADER keeps full crowd avoidance, which is
      // what makes the pair navigate a busy pavement as one person would.
      m._sepX = 0; m._sepZ = 0; m._sepT = Math.max(m._sepT || 0, 0.4);
      // FORMATION CORRECTION. The near/active steering (citynav's 8-slot parse)
      // can mask out the slot that points at a body 1 m away, which would leave
      // a couple drifting a metre and a half apart and swinging. A small capped
      // pull toward the shoulder closes that — capped at CORRECT m/s, which is
      // a fraction of a walk, and only applied while the legs are ALREADY
      // swinging, so no foot ever slides. Collision is re-resolved afterwards
      // through the same shared collide() the ped loop uses, so this can never
      // push anybody into a wall.
      const sdx = tx - m.pos.x, sdz = tz - m.pos.z;
      const sd = Math.sqrt(sdx * sdx + sdz * sdz);
      if (sd > 0.7 && (m.speed || 0) > 0.2) {
        const step = Math.min(CORRECT * dt, sd - 0.7);
        m.pos.x += (sdx / sd) * step;
        m.pos.z += (sdz / sd) * step;
        if (CBZ.collide) CBZ.collide(m.pos, PED_R, m.pos.y, m.pos.y + 1.7);
        m.pos.y = 0;
      }
      // HAND IN HAND. This is the one thing you cannot do with ch.pose, because
      // animChar refuses a held pose while the body is moving — and holding a
      // hand is something you do WHILE walking. So it is a post-anim write, the
      // exact shape peds.js uses for its own witness tells: we run at 36.4,
      // animChar ran at 34, so the inner arm we write is the arm that renders.
      m._kinHold = false;
      if (u.holdHands && away < 2.4 * 2.4) {
        const child = isKid(m) ? m : (isKid(L) ? L : null);
        if (child) { handHold(m, side, isKid(m)); handHold(L, -side, isKid(L)); m._kinHold = true; }
      }
    }
    // THE TURN-TOWARD. Every so often two people out together stop and look at
    // each other. It is short, it is rate-limited, and it is the beat that
    // makes a pair read as a pair rather than as two bodies on rails.
    // A TIGHT COUPLE TURNS TO EACH OTHER MORE OFTEN. social.js has kept
    // `together` (0..1 bond strength) on every couple since it shipped and only
    // its own break-up roll has ever read it; here it is the tempo of the one
    // thing you can actually watch a couple do.
    const bond = (u.kind === "couple") ? Math.max(0, Math.min(1, L.together || 0.5)) : 0.5;
    u.turnT -= dt * (0.6 + bond * 0.9);
    if (u.turnT <= 0 && !L._kinBeat) {
      u.turnT = 9 + Math.random() * 13;
      const other = u.members.find((m) => m !== L && !m._kinBeat);
      const P = CBZ.player;
      if (other && P && d2(L.pos.x, L.pos.z, P.pos.x, P.pos.z) < 70 * 70) {
        const knows = Math.max(L.knowsHero || 0, other.knowsHero || 0);
        const notice = knows > 0.45 && !P.dead &&
          d2(L.pos.x, L.pos.z, P.pos.x, P.pos.z) < 15 * 15;
        startBeat(L, other, notice ? "notice" : (u.kind === "couple" ? "warm" : "chat"),
          1.5 + Math.random() * 1.4);
      }
    }
  }

  // one arm, reached out toward the person beside you. `side` is +1 when they
  // are on this body's right. A child reaches UP; a grown-up reaches DOWN.
  function handHold(p, side, childSide) {
    const ch = p.char; if (!ch || !ch.parts) return;
    if (ch.surrender || ch.handsUp || ch.aimingPose || ch.carryPose || ch.cuffed || ch.sitting) return;
    const arm = side > 0 ? ch.parts.ra : ch.parts.la;
    const J = ch.low || {}, jt = side > 0 ? J.ra : J.la;
    if (!arm) return;
    if (childSide) {
      // reaching up and out: the shoulder rolls out, the elbow stays soft
      arm.rotation.x = -0.34;
      arm.rotation.z = side > 0 ? -0.92 : 0.92;
      if (jt) jt.rotation.x = -0.38;
    } else {
      // hanging down and a touch out, the way you hold a small hand
      arm.rotation.x = -0.10;
      arm.rotation.z = side > 0 ? -0.30 : 0.30;
      if (jt) jt.rotation.x = -0.12;
    }
  }

  // ============================================================
  //  BEATS — a stop-and-talk between two people. peds.js's chatT is the hold
  //  (its own brain ticks it down and releases the body to "walk"), poses.js
  //  supplies the arms, social.js's citySay supplies the ONE subtitle surface.
  //  No HUD is created here and none ever will be — the killfeed is the only
  //  popup this game has.
  // ============================================================
  const HELLO = {
    spouse:  ["“There you are.”", "“Hey, you.”", "“Ready?”", "“Missed you.”"],
    parent:  ["“Come on, sweetheart.”", "“Stay close to me.”", "“You hungry?”", "“Hold my hand.”"],
    child:   ["“Can we get ice cream?”", "“Look! Look!”", "“I'm tired.”", "“Wait for me!”"],
    sibling: ["“Mom's asking about you.”", "“You're late. Again.”", "“Don't start.”"],
    kin:     ["“How's the family?”", "“Been meaning to call.”", "“Say hi to your mother.”"],
    friend:  ["“Ayy! Long time!”", "“Where you been?”", "“Yo!”", "“Look who it is.”"],
    work:    ["“You on tonight?”", "“Rough shift?”", "“They got you working doubles too?”"],
  };
  const REPLY = ["“Always.”", "“Same as ever.”", "“Don't even ask.”", "“Good to see you.”",
    "“Tell me about it.”", "“Yeah, yeah.”", "“I know, I know.”"];
  const WARM = ["“I love you.”", "“You good?”", "“Come here.”", "“Almost home.”"];
  const WIDOW = ["“It's still quiet at the house.”", "“Some days are alright.”", "“I keep setting two plates.”"];
  // THE PAIR NOTICES YOU. social.js has spent this whole game writing
  // `knowsHero` (how much of your name has reached this person) and `opinion`
  // (what they think of it) and — grep the repo — NOTHING has ever read either
  // one. They are the two scalars kinshipAudit() has to keep reporting as
  // orphans, so here is the smallest honest body for them: two people out
  // together, who know who you are, stop looking at each other and look at YOU.
  // The line is `opinion`'s sign. That is a stat fiction retired with a beat
  // that already existed, not a new system.
  const NOTICE_UP = ["“That's them. That's really them.”", "“Told you they were real.”", "“Don't stare — but look.”"];
  const NOTICE_DOWN = ["“Don't. Look. Up.”", "“That's the one from the news.”", "“Keep walking. Keep walking.”"];
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function say(p, line, color, secs) { if (CBZ.citySay && line) CBZ.citySay(p, line, color, secs); }

  // face `p` at (x,z). We run after move(), so this write is the one that
  // renders — no lerp fight, no next-frame snap-back.
  function faceAt(p, x, z) {
    if (!p.group) return;
    const dx = x - p.pos.x, dz = z - p.pos.z;
    if (dx * dx + dz * dz < 0.0004) return;
    const yaw = Math.atan2(dx, dz);
    p.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(p.group.rotation.y, yaw, 0.35) : yaw;
  }

  function startBeat(a, b, kind, secs) {
    if (!a || !b || a === b) return false;
    if (claimed(a) || a._kinBeat) return false;
    const withPlayer = (b === CBZ.player || b.isPlayer);
    if (!withPlayer && (claimed(b) || b._kinBeat)) return false;
    const t = secs || (2.0 + Math.random() * 1.6);
    const rel = withPlayer ? "friend" : (relationOf(a, b) || "friend");
    a._kinBeat = { other: b, t: t, kind: kind, role: "open", rel: rel };
    a.chatT = Math.max(a.chatT || 0, t);
    a.state = "chat"; a.speed = 0;
    a.pause = Math.max(a.pause || 0, t);
    a._kinGreetCD = _clock + GREET_CD + Math.random() * 70;
    if (!withPlayer) {
      b._kinBeat = { other: a, t: t * (0.92 + Math.random() * 0.2), kind: kind, role: "reply", rel: rel };
      b.chatT = Math.max(b.chatT || 0, b._kinBeat.t);
      b.state = "chat"; b.speed = 0;
      b.pause = Math.max(b.pause || 0, b._kinBeat.t);
      b._kinGreetCD = _clock + GREET_CD + Math.random() * 70;
    }
    // THE LINE. A widow does not say "long time!" — social.js has stamped
    // `_widowed` on bereaved partners since the day it shipped and this is the
    // first code in the game that has ever read the flag.
    let openers = HELLO[rel] || HELLO.friend;
    if (kind === "warm") openers = WARM;
    if (kind === "notice") openers = ((a.opinion || 0) + (b.opinion || 0)) < 0 ? NOTICE_DOWN : NOTICE_UP;
    else if (a._widowed && Math.random() < 0.6) openers = WIDOW;
    const col = (kind === "warm") ? "#ff9fd0" : (kind === "notice" ? "#ffd9a8" : "#cfe6ff");
    say(a, pick(openers), col, Math.min(2.6, t));
    if (!withPlayer && Math.random() < 0.75) {
      // the reply lands a beat later — chatter, not a chorus
      b._kinReplyIn = 0.7 + Math.random() * 0.7;
    }
    if (kind === "greet") _greetings++;
    // a real hello is a real (small) social event, so social.js's own `mood`
    // moves with it: the number the sim keeps and the thing you can see are
    // the same thing. We never mint a relPlayer record here — a hello between
    // two strangers-to-you is not about you.
    if (a.mood != null) a.mood = Math.min(1, (a.mood || 0) + 0.25);
    if (!withPlayer && b.mood != null) b.mood = Math.min(1, (b.mood || 0) + 0.25);
    return true;
  }
  CBZ.kinshipGreet = function (a, b, opts) {
    if (!on()) return false;
    opts = opts || {};
    return startBeat(a, b, opts.kind || "greet", opts.secs);
  };

  // THE RELEASE. peds.js's move() only converts "chat" back to "walk" when IT
  // ticks chatT to zero itself; a beat that zeroes chatT from outside and walks
  // away would leave the body in state "chat", whose speed multiplier is a hard
  // 0 — a person frozen mid-street forever. Every exit from a beat goes through
  // this function for exactly that reason.
  function endBeat(p) {
    p._kinBeat = null;
    p._kinReplyIn = null;
    clearPose(p);
    if (p.chatT > 0) p.chatT = 0;
    if (p.state === "chat") p.state = "walk";
  }
  function tickBeat(p, dt) {
    const bt = p._kinBeat;
    if (!bt) return;
    // ANY claim on the body ends the beat instantly. A person being shot at
    // does not finish saying hello.
    if (claimed(p) || !bt.other || bt.other.dead || !bt.other.pos) {
      endBeat(p); _yields++;
      return;
    }
    bt.t -= dt;
    if (bt.t <= 0) { endBeat(p); return; }
    p.chatT = Math.max(p.chatT, Math.min(bt.t, 0.6));   // keep the hold alive, never longer than the beat
    // a "notice" beat looks at the PLAYER, not at each other — that is the
    // entire difference between the two, and it is what makes being famous (or
    // notorious) something you can see happen to two strangers on a pavement.
    const look = (bt.kind === "notice" && CBZ.player && !CBZ.player.dead) ? CBZ.player : bt.other;
    faceAt(p, look.pos.x, look.pos.z);
    // The arms tell the beat's shape: whoever opened it waves first, whoever
    // answers listens first, and they both end up talking. That asymmetry is
    // the whole reason it reads as two people and not two idle animations.
    if (bt.role === "open" && bt.kind === "greet" && bt.t > 1.1) setPose(p, "kinWave");
    else if (bt.role === "reply" && bt.t > 1.0) setPose(p, "kinListen");
    else setPose(p, "kinTalk");
    if (p._kinReplyIn != null) {
      p._kinReplyIn -= dt;
      if (p._kinReplyIn <= 0) {
        p._kinReplyIn = null;
        say(p, pick(REPLY), "#cfe6ff", Math.min(2.2, bt.t + 0.4));
      }
    }
  }

  // ============================================================
  //  GREETINGS BETWEEN PEOPLE WHO KNOW EACH OTHER
  //  Two acquainted people pass within arm's reach and stop. Rate limits are
  //  the whole design: a per-person cooldown of minutes and ONE beat playing
  //  where you can see it, because the difference between "the city is alive"
  //  and "the city is broken" is entirely how often this fires.
  // ============================================================
  function scanGreetings(list) {
    if (C.KINSHIP_GREET === false || !list || !list.length) return;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return;
    // Budget, counted off the near list we already built: at most ONE hello
    // playing where the player could see it, two anywhere. This ceiling is the
    // difference between "the city is alive" and "the city is broken".
    let near = 0, open = 0;
    for (let i = 0; i < list.length; i++) {
      if (!list[i]._kinBeat) continue;
      open++;
      if (d2(list[i].pos.x, list[i].pos.z, cam.x, cam.z) < GREET_NEAR * GREET_NEAR) near++;
    }
    if (open >= 4 || near >= 2) return;                    // (a beat is two bodies)
    for (let i = 0; i < list.length; i++) {
      if (near >= 2) return;
      const a = list[i];
      if (a._kinBeat || (a._kinGreetCD || 0) > _clock) continue;
      if (claimed(a)) continue;
      if (d2(a.pos.x, a.pos.z, cam.x, cam.z) > GREET_NEAR * GREET_NEAR) continue;
      let mate = null;
      eachNear(a, GREET_R, function (b) {
        if (mate) return false;
        if (b._kinBeat || (b._kinGreetCD || 0) > _clock || claimed(b)) return;
        if (a._kinUnit && a._kinUnit === b._kinUnit) return;   // already out together
        if (d2(a.pos.x, a.pos.z, b.pos.x, b.pos.z) > GREET_R * GREET_R) return;
        if (!relationOf(a, b)) return;
        mate = b;
      });
      if (!mate) continue;
      if (startBeat(a, mate, "greet")) near += 2;
    }
  }

  // ============================================================
  //  GRIEF — KIN REACT TO DEATH.
  //  We only ever pose the LIVING. The corpse belongs to ragdoll.js, the death
  //  belongs to killfeed.js, and neither is touched here: this is what the
  //  people who loved them do in the four seconds afterwards, and then the
  //  ordinary panic (peds.js's cityScare) takes over — which is the point.
  //  Grief that REPLACED the flee would be a worse city; grief that DELAYS it
  //  is the one that hurts.
  // ============================================================
  function kinNear(victim, r) {
    const out = [], seen = [];
    const push = (p) => {
      if (!p || p === victim || p.dead || out.length >= 2) return;
      if (seen.indexOf(p) >= 0) return;
      seen.push(p);
      if (!p.pos || d2(p.pos.x, p.pos.z, victim.pos.x, victim.pos.z) > r * r) return;
      out.push(p);
    };
    push(victim.partner);
    if (victim.family) for (let i = 0; i < victim.family.length; i++) push(victim.family[i]);
    if (victim._fam && victim._fam.members) for (let i = 0; i < victim._fam.members.length; i++) push(victim._fam.members[i]);
    if (victim.friends) for (let i = 0; i < victim.friends.length; i++) push(victim.friends[i]);
    const T = CBZ.cityFamilyTree, sv = sidOf(victim);
    if (T && sv) {
      push(liveOf(T.spouseOf(sv)));
      const par = T.parentsOf(sv) || []; for (let i = 0; i < par.length; i++) push(liveOf(par[i]));
      const kid = T.kidsOf(sv) || []; for (let i = 0; i < kid.length; i++) push(liveOf(kid[i]));
    }
    // a unit-mate is by definition somebody who was out WITH them
    const u = victim._kinUnit;
    if (u) for (let i = 0; i < u.members.length; i++) push(u.members[i]);
    return out;
  }

  // PUBLIC — social.js's citySocialWitnessKill calls this (one guarded line
  // there). Idempotent per victim: a death funnels through several wrappers
  // and must only ever start one set of grief beats.
  CBZ.kinshipMourn = function (victim, byPlayer) {
    if (!on() || C.KINSHIP_GRIEF === false) return 0;
    if (!victim || !victim.pos || victim._kinMourned) return 0;
    victim._kinMourned = true;
    if (grieving.length >= 3) return 0;
    const kin = kinNear(victim, GRIEF_R);
    let started = 0;
    for (let i = 0; i < kin.length; i++) {
      const m = kin[i];
      // grief deliberately outranks the fresh alarm (that is the whole beat),
      // but never outranks being dead, held, seated, seized or arrested.
      if (m.dead || (m.ko || 0) > 0 || m._npcAttached || m.inCar || m.kidnapped ||
          m.hostage || m.restraint || m._kinGrief || m.kind === "cop") continue;
      if (m._kinUnit) dropUnit(m._kinUnit, "grief");
      m._kinBeat = null;
      // take the legs the way childhood.js does — peds.js's think() returns
      // immediately on `controlled`, so nothing overrides us for the window,
      // while move() still walks/collides/animates the body normally.
      m.controlled = true; m._kinHeld = true;
      m._kinGrief = { victim: victim, phase: "run", t: 0, hp0: m.hp, by: byPlayer, ped: m };
      m.rage = null; m.path = null; m.pause = 0; m.state = "walk"; m.chatT = 0;
      m.alarmed = 0;                                    // held OFF for the beat; the scare re-raises it
      grieving.push(m._kinGrief);
      started++;
      _griefs++;
    }
    return started;
  };

  function endGrief(m, threat) {
    const gr = m._kinGrief;
    m._kinGrief = null;
    const i = grieving.indexOf(gr);
    if (i >= 0) grieving.splice(i, 1);
    if (m._kinHeld) { m.controlled = false; m._kinHeld = false; }
    clearPose(m);
    m.chatT = 0;
    if (m.state === "chat") m.state = "walk";   // see endBeat: "chat" pins speed at 0
    if (m.dead || (m.ko || 0) > 0) return;
    // AND NOW THE ORDINARY PANIC. cityScare refuses a `controlled` actor, so
    // the hold above had to come off first — that ordering is the bug this
    // comment exists to stop somebody re-introducing.
    if (CBZ.cityScare) {
      try { CBZ.cityScare(m, threat || CBZ.player, { bias: 0.30 }); } catch (e) {}
    } else { m.state = "flee"; m.alarmed = Math.max(m.alarmed || 0, 6); }
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(m.pos.x, m.pos.z, 0.8);
  }

  const GRIEF_CRY = ["“No — NO!”", "“Somebody help!”", "“Please, please…”", "“Oh god…”", "“Wake up. Wake UP.”"];
  const GRIEF_KID = ["“Mom? MOM!”", "“Get up, please…”", "“Daddy?”"];
  function tickGrief(m, dt) {
    const gr = m._kinGrief;
    if (!gr) return;
    gr.t += dt;
    const v = gr.victim;
    if (m.dead || (m.ko || 0) > 0 || m._npcAttached || m.inCar || m.kidnapped || m.restraint ||
        !v || !v.pos || gr.t > GRIEF_MAX || (gr.hp0 != null && m.hp < gr.hp0 - 1)) {
      // shot at, grabbed, or out of time — hand the body straight back.
      endGrief(m, CBZ.player);
      return;
    }
    const dd = d2(m.pos.x, m.pos.z, v.pos.x, v.pos.z);
    if (gr.phase === "run") {
      // RUN to them. `confront` is the state whose speed multiplier peds.js
      // already defines as 1.7x baseSpeed — we borrow the number rather than
      // write a second one, and the body walks/collides/animates normally.
      m.state = "confront";
      if (m.target && m.target.set) m.target.set(v.pos.x, 0, v.pos.z);
      m.path = null;
      if (dd < 1.5 * 1.5 || gr.t > 3.2) {
        gr.phase = "kneel"; gr.t = 0;
        m.state = "chat"; m.speed = 0; m.chatT = 2.6;
        if (m.char) { m.char.crouch = true; m._kinCrouch = true; }
        say(m, pick(isKid(m) ? GRIEF_KID : GRIEF_CRY), "#9bb0ff", 2.6);
      }
      return;
    }
    // KNEEL. The body is still; the stillness is the beat.
    m.chatT = Math.max(m.chatT, 0.5);
    m.state = "chat"; m.speed = 0;
    setPose(m, "kinGrieve");
    faceAt(m, v.pos.x, v.pos.z);
    if (gr.t > 2.4 + Math.random() * 1.2) endGrief(m, CBZ.player);
  }

  // ============================================================
  //  THE TICK — order 36.4: after peds.js (34), after childhood.js (34.9),
  //  after family.js (36.2), so every goal and every arm we write is the one
  //  that renders this frame and nothing quietly undoes it.
  // ============================================================
  // Leaving the city, or flipping KINSHIP_LIFE off, must give every borrowed
  // body back — including the ones a grief beat is holding with `controlled`,
  // which is the only state in this file that another system cannot simply
  // walk out of. That is what makes the flag a true one-line revert.
  function standDown() {
    while (units.length) dropUnit(units[0], "mode");
    for (let i = grieving.length - 1; i >= 0; i--) {
      const gr = grieving[i];
      if (gr && gr.ped) {
        gr.ped._kinGrief = null;
        if (gr.ped._kinHeld) { gr.ped.controlled = false; gr.ped._kinHeld = false; }
        clearPose(gr.ped);
        if (gr.ped.state === "chat") gr.ped.state = "walk";
      }
    }
    grieving.length = 0;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p) continue;
      if (p._kinBase != null) { p._kinPaceT = 0; unpace(p); }
      if (p._kinBeat) endBeat(p);
    }
  }
  CBZ.onUpdate(36.4, function (dt) {
    if (!g || g.mode !== "city" || !on()) {
      if (units.length || grieving.length) standDown();
      return;
    }
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) return;   // host simulates; a guest puppets
    if (!dt || dt <= 0) dt = 0.016; if (dt > 0.1) dt = 0.1;
    _clock += dt;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;

    // ---- live units + beats + grief (bounded: <= UNIT_CAP*3 + 3 bodies) ----
    for (let i = units.length - 1; i >= 0; i--) driveUnit(units[i], dt);
    for (let i = grieving.length - 1; i >= 0; i--) {
      const gr = grieving[i];
      if (!gr || !gr.ped || gr.ped._kinGrief !== gr) { grieving.splice(i, 1); continue; }
      tickGrief(gr.ped, dt);
    }

    // ---- rebuild: one strided walk of the roster, a grid, then formation ----
    _rebuildT -= dt; _greetT -= dt;
    const needScan = _rebuildT <= 0 || _greetT <= 0;
    let list = null;
    if (needScan) {
      const cam = CBZ.camera && CBZ.camera.position;
      list = [];
      if (cam) {
        for (let i = 0; i < peds.length && list.length < 170; i++) {
          const p = peds[i];
          if (!p || p.dead || !p.pos || !p.char || p._parked) continue;
          if (d2(p.pos.x, p.pos.z, cam.x, cam.z) > NEAR_R * NEAR_R) continue;
          list.push(p);
        }
      }
      buildGrid(list);
    }
    // GREETINGS GET FIRST REFUSAL, deliberately. Two acquaintances who meet in
    // the street should say hello — and only THEN, sometimes, fall in and walk
    // on together. Running formation first would quietly absorb every such
    // meeting into a silent side-by-side stroll and the hello would never play.
    if (_greetT <= 0) {
      _greetT = qs(GREET_SCAN * 2.0, GREET_SCAN);
      if (list) scanGreetings(list);
    }
    if (_rebuildT <= 0) {
      _rebuildT = qs(REBUILD * 2.2, REBUILD);
      if (list) formUnits(list);
      // SELF-HEAL: anybody still carrying a pace save-slot that no unit claims
      // gets their own legs back. This is what makes `strandedSpeed` an
      // invariant instead of a hope — a despawn, a mode flip or a thrown
      // exception inside a beat cannot leave a person walking wrong forever.
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p) continue;
        if (p._kinBase != null && !unitLive(p) && !paceHeld(p)) { unpace(p); p._kinUnit = null; p._kinPaceT = 0; }
        if (p._kinHeld && !p._kinGrief) { p.controlled = false; p._kinHeld = false; }
      }
    }
    // beats are cheap and must be smooth: tick every one, every frame.
    for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p && p._kinBeat) tickBeat(p, dt); }
    gridCells = null;
  });

  // ============================================================
  //  READS — what the dossier and the family panel ask for.
  // ============================================================
  const REL_WORD = {
    spouse: "Married to", parent: "Parent of", child: "Child of",
    sibling: "Sibling of", kin: "Family of", friend: "Friend of", work: "Works with",
  };
  // CBZ.kinshipOf(ped) -> {line, withName, kind, out} or null.
  // `line` is ONE row for a dossier — never a popup, never over a head.
  CBZ.kinshipOf = function (p) {
    if (!p) return null;
    const bits = [];
    let out = null, kind = null;
    const T = CBZ.cityFamilyTree, sp = sidOf(p);
    const nameOf = (x) => (x && x.name) ? x.name : null;
    // who they are OUT with, right now — the thing you can actually see
    const u = p._kinUnit;
    if (u) {
      const other = u.members.find((m) => m !== p);
      if (other) {
        out = nameOf(other) || "someone";
        kind = relationOf(p, other) || "friend";
      }
    } else if (p._kinBeat && p._kinBeat.other) {
      out = nameOf(p._kinBeat.other) || "someone";
      kind = p._kinBeat.rel || "friend";
    }
    // who they are TO people, whether or not they are out with them
    const spouse = p.partner && !p.partner.dead ? nameOf(p.partner)
      : (T && sp ? (function () { const s = T.spouseOf(sp); const l = liveOf(s); return l ? nameOf(l) : null; })() : null);
    if (spouse) bits.push("Married to " + spouse);
    else if (p._widowed) bits.push("Widowed");
    if (T && sp) {
      const kids = T.kidsOf(sp) || [];
      const names = [];
      for (let i = 0; i < kids.length && names.length < 2; i++) { const l = liveOf(kids[i]); if (l && l.name) names.push(l.name); }
      if (names.length) bits.push((names.length > 1 ? "children " : "child ") + names.join(", "));
      else if (kids.length) bits.push(kids.length + (kids.length > 1 ? " children" : " child"));
    }
    if (!bits.length && p.family && p.family.length) bits.push("Family of " + (nameOf(p.family[0]) || "someone"));
    if (!bits.length && p.friends && p.friends.length) bits.push(p.friends.length + " close friends");
    if (!bits.length && p.cliqueId) bits.push("Runs with a crowd");
    if (!bits.length) return out ? { line: null, withName: out, kind: kind, out: out } : null;
    return { line: bits.join(" · "), withName: out, kind: kind, out: out };
  };
  // "Out with X" — the second dossier row, and the only one that changes as
  // you watch them.
  CBZ.kinshipWithLine = function (p) {
    const k = CBZ.kinshipOf(p);
    if (!k || !k.out) return null;
    const w = REL_WORD[k.kind] || "Out with";
    if (k.kind === "spouse") return "Out with " + k.out + " (spouse)";
    if (k.kind === "parent") return "Out with their child, " + k.out;
    if (k.kind === "child") return "Out with a parent, " + k.out;
    if (k.kind === "work") return "Out with a workmate, " + k.out;
    return "Out with " + k.out + (k.kind === "friend" ? " (a friend)" : " (" + w.toLowerCase().replace(" of", "") + ")");
  };

  // ============================================================
  //  RATCHET — CBZ.kinshipAudit(), the CBZ.treeAudit() template. Counting
  //  functions in a REAL game file, measured against the LIVE world.
  //
  //  strandedSpeed is the HARD invariant and it must be 0: a body still
  //  carrying our pace save-slot with nobody holding it is cleanup debt, and
  //  cleanup debt in a steering file is how NPCs end up sprinting forever.
  //
  //  orphanScalars is the stat-fiction probe. It counts the social scalars
  //  that were WRITTEN but never READ before this file existed. Every one it
  //  still reports is a number with no body — the exact thing CLAUDE.md bans.
  // ============================================================
  CBZ.kinshipAudit = function () {
    const peds = CBZ.cityPeds || [];
    let stranded = 0, held = 0, walkers = 0, holds = 0, beats = 0, widowed = 0, clique = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p) continue;
      if (p._kinBase != null && !unitLive(p) && !paceHeld(p)) stranded++;
      if (p._kinHeld && !p._kinGrief) held++;
      if (p._kinUnit && p !== p._kinUnit.leader) walkers++;
      if (p._kinHold) holds++;
      if (p._kinBeat) beats++;
      if (p._widowed) widowed++;
      if (p.cliqueId) clique++;
    }
    // THE STAT-FICTION PROBE. Every name below was a scalar social.js WROTE and
    // nothing in the whole repo ever READ — grep them and the only hits were
    // the writes and their own decay. This list is what still has no reader
    // after this file: it is computed from the live flag state, not asserted,
    // so turning KINSHIP_LIFE off honestly re-reports all five.
    //   cliqueId  -> relationOf(): who counts as a friend
    //   together  -> the couple's turn-toward tempo
    //   _widowed  -> the beat's line choice + the dossier's Family row
    //   knowsHero -> whether a passing pair NOTICES the player
    //   opinion   -> which way they talk about you when they do
    const orphans = [];
    if (!on()) orphans.push("cliqueId", "together", "_widowed", "knowsHero", "opinion");
    else {
      if (C.KINSHIP_WALK === false) orphans.push("together", "knowsHero", "opinion");
      if (C.KINSHIP_GREET === false && C.KINSHIP_WALK === false) orphans.push("cliqueId", "_widowed");
    }
    return {
      // the pinned invariants
      strandedSpeed: stranded,      // MUST be 0 — pace save-slots with no owner
      strayHolds: held,             // MUST be 0 — `controlled` left on with no grief beat
      // the life you can see
      bondedUnits: units.length,
      walkers: walkers,
      handHolds: holds,
      activeBeats: beats,
      greetingsSeen: _greetings,
      griefBeats: _griefs,
      dealtBonds: _dealt,
      yields: _yields,
      // supporting reads
      widowedKnown: widowed,
      cliquedPeople: clique,
      grieving: grieving.length,
      orphanScalars: orphans,
      flags: {
        life: C.KINSHIP_LIFE !== false, walk: C.KINSHIP_WALK !== false,
        greet: C.KINSHIP_GREET !== false, grief: C.KINSHIP_GRIEF !== false,
      },
    };
  };

  // mode.js's fresh-run guard-call convention (cityFamilyReset /
  // citySocialReset / cityChildhoodReset sit beside this); social.js's
  // citySocialReset also calls it, guarded, so a reset can never leave a
  // half-driven body behind.
  CBZ.cityKinshipReset = function () {
    standDown();
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p) continue;
      p._kinPaceT = 0; unpace(p); clearPose(p);
      p._kinUnit = null; p._kinBeat = null; p._kinGrief = null; p._kinHold = false;
      p._kinGreetCD = 0; p._kinMourned = false;
      if (p._kinHeld) { p.controlled = false; p._kinHeld = false; }
    }
    _clock = 0; _rebuildT = 0; _greetT = 0;
    _greetings = 0; _griefs = 0; _yields = 0; _dealt = 0;
  };
})();
