/* ============================================================
   city/tells.js — THE BODY LANGUAGE OF NUMBERS THAT ALREADY EXIST.

   OWNER (2026-08-03, verbatim): NPCs "have tons of logic built like dogs in
   real life — they just need a way to express their statistics and reactions
   and needs and wants physically."

   He is describing a legibility gap, not a missing simulation. The simulation
   is enormous and it is INVISIBLE. Census, line by line:

     · social.js keeps a five-axis relationship record on every person you have
       ever touched — ped.relPlayer = {respect, fear, loyalty, affection,
       grudge} — decayed on its own tick, rippled through friends and gangs,
       coupled axis-to-axis (social.js:53-191). The ENTIRE physical vocabulary
       it drives is binary: ped.snitch goes up, and at the far end of the fear
       axis the person flees. A man who has hated you for ten minutes and a man
       who has never met you stand on the pavement in exactly the same posture.
     · peds.js keeps ped.fear on a 0..10 scale and gives it TWO bodies: a bolt
       at fear >= 4 (peds.js:4420) and a scream at fear >= 8 (peds.js:4752).
       Everything between "calm" and "running" — which is where most of a
       street spends most of a tense minute — looks like calm.
     · ped.aggr is rolled per person at spawn off a district mean (peds.js:860)
       and ped.wealth/ped.cash are dealt beside it. They pick loot tables,
       titles and fight nerve. Nobody's SHOULDERS have ever known.

   So this file authors NO new stat. Not one field, not one axis, not one
   ladder — a number with no reader is the stat fiction CLAUDE.md bans, and
   minting a sixth axis to animate would be committing the same crime twice.
   Everything below is a MAPPING LINE from a scalar somebody else already
   writes onto a body somebody else already animates.

   THE VOCABULARY (five tells, and deliberately only five):

     1. WARY — the graded middle of fear. Between "nothing is wrong" and
        "hands in the air" there is a whole band where a person has noticed
        something and has not decided yet: hands come up guarded near the
        chest, elbows tight, arms drawn in over the ribs, and they keep the
        threat loosely in front of them. Amplitude is CONTINUOUS in the fear
        that produced it (ch._tellK), so you can watch somebody get more
        frightened instead of watching them cross a threshold.
     2. THE MAD-DOG STARE — relPlayer.grudge, near, with line of sight. Arms
        FOLD and the head comes round to you. This is the first physical
        consequence a grudge has ever had that is not an ambush ten minutes
        later. It reuses poses.js's `foldarms` row; a grudge does not need its
        own crossed-arms animation and must never get one.
     3. THE ACKNOWLEDGMENT — a high signed bond (social.js's own cityBond),
        near, seen, and not recently. They turn and throw you a wave. It
        reuses kinship.js's `kinWave` row for the same reason.
     4. POCKETS — low wealth/cash. Hands go in the pockets, elbows back,
        shoulders closed: the default idle of somebody with nothing on them.
     5. SWAGGER — high aggr. Shoulders rolled back a few degrees, arms carried
        out off the ribs, a slow weight-shift. SUBTLE by instruction; the city
        already animates beautifully and a cartoon here would cheapen it.

   WHO GETS 4 AND 5 IS A CHARACTER TRAIT, NOT A DIE. Both ambient tells are
   gated on CBZ.hash01 off the person's own spawn cell — the peds.js roleHash
   idiom, copied field-for-field (combat_iq.js:131 and dialogue.js:102 copy the
   same three lines for the same reason) so every file in the repo that asks
   "who is this person" gets one answer. The same broke man always has his
   hands in his pockets and the same hothead always stands wide, across a
   reload, across a save, forever. cityScare settled this law for runners and
   it settles it here.

   THE ONE-SEAM LAW. A tell is a ROW in CBZ.charPoses plus a mapping line in
   this file. That is the whole extent of the mechanism and it must stay that
   way. There is no tells renderer, no tells rig, no tells animation loop —
   the next tell somebody adds is another row and another line, and if it ever
   needs anything else the answer is that it is not a tell.
   Why that seam and no other: animChar's arm cascade (character.js:2100-2229)
   runs a registry pose ONLY at aiming > cuffed > surrender/hands-up > carry >
   POSE > gait. So a pose can never fight a state that matters. A frightened
   man who gets a gun put on him raises his hands mid-tell because hands-up
   outranks the pose; a man who starts WALKING falls straight through to the
   gait. That precedence is not a nicety, it is the reason a tell cannot get
   stuck on a body, and it is only true because we are a row in that registry
   instead of a parallel system.

   WHAT A POSE MAY WRITE, and why the shrink and the chest-out live in the
   ARMS. poses.js's contract is rotation-only on ch.parts.{la,ra} and
   ch.low.{la,ra}. It is not a style rule — animChar OWNS the torso and the
   head unconditionally, AFTER the pose branch has run: ch.body.rotation.x is
   overwritten from ch.lean at character.js:2272 and ch.neck at
   character.js:2551. A pose that wrote a hunch or a lifted chin would have it
   damped away in the same frame by a line 300 further down. So "shoulders
   shrink" is the arms closing over the ribs and "chest out" is the arms
   carried off them, which is what those postures look like anyway.

   YIELD. free() is the whole safety story and it is re-tested every tick, not
   at claim time: dead, KO, seated, attached to a moving parent, in a car,
   armed, fighting, fleeing, filming, surrendering, cuffed, arrested, hostage,
   reporting, pointing, controlled, staffed, vendor, inside a building, or held
   by kinship.js. One failure and the tell is dropped and the pose slot handed
   straight back on that frame. We only ever CLEAR a pose we ourselves set
   (ped._tellPose is the receipt), so a dealer's hands stay over the felt and a
   paramedic keeps tending.

   DETERMINISM. WHO tells is CBZ.hash01 off the spawn cell, never Math.random.
   WHEN is clock arithmetic. There is no rng in this file at all.

   Flag: CITY_NPC_TELLS (default true). Off = no rows registered, driver
   early-outs, every borrowed pose slot released — today's bytes exactly.
   Evidence: CBZ.cityTellsAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onUpdate) return;
  const g = CBZ.game;
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  // declared here, in our own file, on the null-check pattern: a config.js
  // value always wins and turning it off is a one-line revert.
  if (C.CITY_NPC_TELLS == null) C.CITY_NPC_TELLS = true;
  const on = () => C.CITY_NPC_TELLS !== false;

  // ---- budget --------------------------------------------------------------
  // These caps are the difference between "the street reads" and "the street
  // twitches". A tell is a thing you notice on ONE person; twenty at once is
  // wallpaper, and wallpaper is what makes a good idea look fake.
  const REACT_R = 26;        // reactive tells (wary/stare/greet) need you near
  const AMBIENT_R = 46;      // ambient tells only where a camera could see them
  const REACT_CAP = 8;       // people reacting to you at once
  const AMBIENT_CAP = 14;    // people idling in character at once
  const SCAN = 0.32;         // classify cadence, seconds
  const LOS_PER_SCAN = 6;    // hard ceiling on ray casts per classify pass

  const WARY_LO = 1.0;       // peds.js: gun-out adds 1.5, flee lands at 4
  const WARY_HI = 4.0;       // above this the ped brain is already bolting
  const REL_FEAR_LO = 22;    // social.js axis (0..100) — the remembered kind
  const REL_FEAR_HI = 70;
  const GRUDGE_MIN = 45;     // social.js: "beaten" is +26, "friendKilled" +40
  const STARE_R = 10;
  const BOND_MIN = 0.28;     // cityBond() signed read; ~loyalty+respect earned
  const GREET_R = 14;
  const GREET_HOLD = 1.5;    // the wave lasts about as long as a real one
  const GREET_CD = 95;       // and then that person does not do it again soon
  const GREET_QUIET = 18;    // relPlayer.t — not fresh off an interaction

  // ---- counters (the gate reads these) -------------------------------------
  let _fWary = 0, _fPockets = 0, _fSwagger = 0, _fStare = 0, _fGreet = 0;
  let _clock = 0, _scanT = 0;
  const telling = [];        // peds currently expressing a tell (<= the caps)

  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function qs(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  // THE peds.js roleHash IDIOM, copied verbatim (peds.js:427, and again in
  // combat_iq.js:131 / dialogue.js:102). The seed is the person's SPAWN cell,
  // latched once, so it survives every metre they ever walk: who you are does
  // not change because you crossed the street.
  function pedHash(p, salt) {
    if (p._roleSeedX == null) { p._roleSeedX = p.pos ? p.pos.x : 0; p._roleSeedZ = p.pos ? p.pos.z : 0; }
    return CBZ.hash01 ? CBZ.hash01(p._roleSeedX, p._roleSeedZ, salt) : 0.5;
  }

  // ============================================================
  //  THE ROWS. Three new entries in entities/poses.js's SHARED registry —
  //  kinship.js:140-181's shape exactly, because that is the shape.
  //  Rotation-only, damped both ways (so entering and LEAVING a tell eases;
  //  the idle counter-swing reclaims the arms the frame ch.pose clears), and
  //  ALIVE: each reads ch.breath, which animChar advances every frame, so a
  //  wary man's guard trembles and a swaggering one shifts his weight instead
  //  of being a photograph of a posture.
  // ============================================================
  function damp(cur, target, rate, dt) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
  function elbow(J, x, dt, rate) { if (J) J.rotation.x = damp(J.rotation.x, Math.min(0, x), rate || 14, dt); }
  let _posed = false;
  function registerPoses() {
    if (_posed || !CBZ.charPoses) return;
    _posed = true;

    // WARY — graded. `ch._tellK` (0..1) is written by the driver from the fear
    // that produced this, and EVERY target below scales through it, so the
    // pose is a continuum and not a state: at k=0.2 it is a man who has half
    // noticed something, at k=1.0 it is a man one push from running. It stops
    // well short of the hands-up layer (which drives the upper arms to -2.60,
    // character.js:2523) on purpose — that is the pose this one is BELOW.
    CBZ.charPoses.tellWary = function (ch, dt) {
      const J = ch.low || {}, r = 14, t = ch.breath || 0;
      const k = ch._tellK == null ? 0.6 : clamp01(ch._tellK);
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      // an unsteady guard: a fast shallow tremor that only exists at real fear
      const tr = Math.sin(t * 7.1) * 0.022 * k;
      // shoulders closing over the ribs is the shrink; neutral carry is -0.08
      // on the left and +0.08 on the right (character.js:2210), so these pull
      // IN from there and relax back to it as k falls.
      if (la) {
        la.rotation.x = damp(la.rotation.x, -0.84 * k + tr, r, dt);
        la.rotation.z = damp(la.rotation.z, -0.08 - 0.26 * k, r, dt);
      }
      if (ra) {
        ra.rotation.x = damp(ra.rotation.x, -0.88 * k - tr, r, dt);
        ra.rotation.z = damp(ra.rotation.z, 0.08 + 0.28 * k, r, dt);
      }
      // the elbows do the work: forearms up in front of the CHEST, palms out.
      // Storyboard-tuned (visual:npc-gestures): the first amplitudes put the
      // guard at belly height, where a photograph of it is a man holding an
      // invisible box. The hands have to be up around the sternum before a
      // still frame reads "guarded" rather than "standing". Even at k=1 this
      // lands a shoulder-width below the surrender layer, which is the gap the
      // whole tell exists to occupy.
      elbow(J.la, -0.24 - 1.58 * k, dt, r);
      elbow(J.ra, -0.24 - 1.64 * k, dt, r);
    };

    // POCKETS — hands in, elbows back, shoulders closed. Upper arms swing a
    // few degrees BEHIND the hip line (positive x is back; the carry hangs at
    // -0.18, character.js:2196) and the elbow folds the forearm forward into
    // the front pocket. Almost no motion on purpose: a person standing like
    // this is conserving something.
    CBZ.charPoses.tellPockets = function (ch, dt) {
      const J = ch.low || {}, r = 12, t = ch.breath || 0;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      const br = Math.sin(t * 1.1) * 0.014;          // slow, small — a settled idle
      if (la) { la.rotation.x = damp(la.rotation.x, 0.26 + br, r, dt); la.rotation.z = damp(la.rotation.z, -0.15, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, 0.24 + br, r, dt); ra.rotation.z = damp(ra.rotation.z, 0.15, r, dt); }
      // Storyboard-tuned: at the first amplitudes the hands finished FORWARD of
      // the thighs, floating in space, and a photograph of it read "reaching"
      // rather than "pockets". Swinging the shoulder further back and folding
      // the elbow further lands the hand ON the hip line, which is the only
      // place the gesture is legible from — a pocket is a location, not an angle.
      elbow(J.la, -0.92, dt, r); elbow(J.ra, -0.90, dt, r);
    };

    // SWAGGER — and the whole design of this one is restraint. Shoulders
    // rolled back about four degrees, arms carried a little off the ribs (the
    // lat-spread stance), elbows soft, and a slow antiphase weight shift so it
    // reads as a man standing wide rather than a man posing. Every number here
    // is small deliberately: the owner's instruction was to make it realer,
    // not louder, and the city's existing idle is already good.
    CBZ.charPoses.tellSwagger = function (ch, dt) {
      const J = ch.low || {}, r = 12, t = ch.breath || 0;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      const roll = Math.sin(t * 0.85) * 0.035;       // the weight going hip to hip
      if (la) { la.rotation.x = damp(la.rotation.x, 0.07, r, dt); la.rotation.z = damp(la.rotation.z, 0.215 + roll, r, dt); }
      if (ra) { ra.rotation.x = damp(ra.rotation.x, 0.07, r, dt); ra.rotation.z = damp(ra.rotation.z, -0.215 + roll, r, dt); }
      // Storyboard-tuned, and only barely: the gap between arm and ribs is the
      // entire read, and it wanted about three more degrees before it survived
      // a still frame. Still the smallest change in this file, on purpose.
      elbow(J.la, -0.38 - roll * 0.4, dt, r); elbow(J.ra, -0.38 + roll * 0.4, dt, r);
    };
  }
  if (on()) registerPoses();

  // ============================================================
  //  WHO IS FREE. Re-tested every tick on every teller — this is the entire
  //  safety contract. Anything on this list means the body belongs to somebody
  //  else and we let go of it on THIS frame, not the next one.
  // ============================================================
  function free(p) {
    if (!p || p.dead || !p.pos || !p.group || !p.char || !p.char.parts) return false;
    if (p.isPlayer || p._parked || p.culled || p.vendor) return false;
    if ((p.ko || 0) > 0) return false;
    // a body seated on a moving parent must never have its yaw written — that
    // is the sideways-passenger bug class (peds.js:5623 skips the whole walk
    // path for these), and a tell is exactly the kind of harmless-looking
    // rotation write that reintroduces it.
    if (p._npcAttached || p._propSeat || p._deskAnchor || p.inCar || p.driving) return false;
    if (p.state === "sit" || p.char.sitting) return false;
    if ((p.enterT || 0) > 0 || p._traversal) return false;
    // a person with a gun in their hands is not idling, and their weapon pose
    // owns the arms anyway (peds.js's post-anim tell block skips armed peds
    // for the same reason).
    if (p.armed || p.rage) return false;
    if (p.state === "fight" || p.state === "flee" || p.state === "confront" ||
        p.state === "stalk" || p.state === "charge" || p.state === "film" ||
        p.state === "loot" || p.state === "surrender") return false;
    if (p.surrender || p.poseHandsUp || p.poseAimBack || (p.surrenderT || 0) > 0) return false;
    if (p.cuffed || p.restraint || p.busted || p.arrestState || p.hostage || p.kidnapped) return false;
    // peds.js writes these two witness tells POST-anim (peds.js:5731-5743), so
    // they beat any pose we could set — a dialing witness would keep the phone
    // to their ear and quietly ignore us. Yield rather than fight.
    if (p.reportState || (p.posePoint || 0) > 0) return false;
    if (p.controlled || p.companion || p.recruited || p._covered) return false;
    if (p.staffPost || p.guard || p._bumHunt || p.rampage) return false;
    if (p._kidHeld || p._kidInside) return false;
    // kinship.js is mid-hello, mid-grief or walking them somewhere; its beats
    // own the same pose slot and the same yaw, and it ran 0.2 orders ago.
    if (p._kinBeat || p._kinGrief || p._kinUnit) return false;
    const ch = p.char;
    if (ch.aimingPose || ch.carryPose || ch.handsUp || ch.surrender || ch.cuffed || ch.traversePose) return false;
    // animChar runs a registry pose ONLY while the body is still
    // (character.js:2185 — `ch.pose && !moving`). Posing a walker would be a
    // silent no-op that still parked our name in the pose slot, which is how
    // you block somebody else's greeting for a minute at a time.
    if ((p.speed || 0) > 0.2) return false;
    return true;
  }
  // the pose slot itself: ours, or nobody's. medics' `tend`, dialogue's `dlg*`,
  // citystaff/occupy's post poses and kinship's `kin*` all outrank us, and the
  // receipt (_tellPose) is what stops us ever clearing one of theirs.
  function poseFree(p) {
    const ch = p.char;
    return !ch.pose || ch.pose === p._tellPose;
  }

  function setPose(p, name) {
    const ch = p.char;
    if (name && (!CBZ.charPoses || !CBZ.charPoses[name])) return false;   // degrade: row absent
    if (!poseFree(p)) return false;
    ch.pose = name || null;
    p._tellPose = name || null;
    return true;
  }
  function release(p) {
    if (!p) return;
    const ch = p.char;
    if (ch && p._tellPose && ch.pose === p._tellPose) ch.pose = null;
    if (ch) ch._tellK = 0;
    p._tellPose = null; p._tellKind = null; p._tellT = 0; p._tellFace = null;
  }
  function drop(i) {
    const p = telling[i];
    telling.splice(i, 1);
    release(p);
  }
  function standDown() {
    for (let i = telling.length - 1; i >= 0; i--) drop(i);
    // belt and braces: anything still carrying a receipt gets it torn up, so a
    // despawn or a thrown exception can never leave a pose parked on a body.
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._tellPose) release(peds[i]);
  }

  // ============================================================
  //  LOOKING AT SOMETHING. We run at 36.6, after peds.js's move() (34) and
  //  after kinship.js (36.4), so this yaw write is the one that renders — no
  //  lerp fight, no next-frame snap-back. `rate` is the whole character of the
  //  tell: a wary man keeps the threat loosely in front of him (slow), a man
  //  with a grudge turns and holds it on you (fast).
  // ============================================================
  function faceAt(p, x, z, rate) {
    if (!p.group) return;
    const dx = x - p.pos.x, dz = z - p.pos.z;
    if (dx * dx + dz * dz < 0.0004) return;
    const yaw = Math.atan2(dx, dz);
    p.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(p.group.rotation.y, yaw, rate) : yaw;
  }
  // is the player roughly in front of this person? (cheap: no ray, no alloc)
  function facingish(p, x, z) {
    const dx = x - p.pos.x, dz = z - p.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.001) return true;
    const yaw = p.group ? p.group.rotation.y : 0;
    return (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d > -0.45;   // within ~117 deg
  }
  let _losBudget = 0;
  function sees(p, P) {
    if (!facingish(p, P.pos.x, P.pos.z)) return false;
    if (!CBZ.clearLineOfFire) return true;                          // degrade: distance only
    if (_losBudget <= 0) return false;
    _losBudget--;
    try {
      return CBZ.clearLineOfFire(p.pos.x, (p.pos.y || 0) + 1.45, p.pos.z,
                                 P.pos.x, (P.pos.y || 0) + 1.5, P.pos.z);
    } catch (e) { return false; }
  }

  // ============================================================
  //  THE MAPPING. Every branch below is one existing scalar and one row —
  //  that is the whole file, and adding a sixth tell must look exactly like
  //  this and nothing else.
  // ============================================================
  // 1. FEAR, GRADED. peds.js's ped.fear is the acute kind (a gun just came
  //    out, +1.5 at peds.js:4649) and social.js's relPlayer.fear is the
  //    remembered kind. Take whichever is louder; below WARY_LO nothing is
  //    wrong, above WARY_HI the ped brain is already fleeing and free() has
  //    dropped us anyway.
  function waryK(p, rel) {
    let k = 0;
    const f = p.fear || 0;
    if (f > WARY_LO) k = clamp01((f - WARY_LO) / (WARY_HI - WARY_LO));
    if (rel && rel.seen && rel.fear > REL_FEAR_LO) {
      k = Math.max(k, clamp01((rel.fear - REL_FEAR_LO) / (REL_FEAR_HI - REL_FEAR_LO)));
    }
    // a person with real standing with you does not flinch at you; social.js
    // already couples respect against fear (social.js:136) and this is the
    // same coupling with a body.
    if (rel && rel.seen && rel.respect > 45) k *= 0.5;
    return k;
  }
  // where the fear is coming FROM: peds.js's own remembered offender if there
  // is one, else you. (Same two lines its threat branch uses, peds.js:4500.)
  function threatX(p, P) { return (p.mem && p.mem.pos) ? p.mem.pos.x : (P ? P.pos.x : p.pos.x); }
  function threatZ(p, P) { return (p.mem && p.mem.pos) ? p.mem.pos.z : (P ? P.pos.z : p.pos.z); }

  // 4/5. THE AMBIENT PAIR — a character trait, so a stable hash and never a
  //      die. Not every broke man pockets and not every hothead swaggers;
  //      about three in five do, and it is always the SAME three in five.
  function pocketsMan(p) {
    if ((p.wealth != null ? p.wealth : 0.5) > 0.18 && (p.cash != null ? p.cash : 99) > 14) return false;
    return pedHash(p, 0x7E11) < 0.62;
  }
  function swaggerMan(p) {
    if ((p.aggr || 0) < 0.55) return false;
    return pedHash(p, 0x7E12) < 0.55;
  }

  // classify ONE ped -> "wary" | "stare" | "greet" | "pockets" | "swagger" | null.
  // Priority is emotional truth: a frightened man is not waving, and a man
  // with a grudge is not standing there with his hands in his pockets.
  function classify(p, P, dpl2, reactive) {
    const rel = p.relPlayer || null;
    if (reactive) {
      const k = waryK(p, rel);
      if (k > 0.12) { p._tellW = k; return "wary"; }
      if (rel && rel.seen && rel.grudge >= GRUDGE_MIN && dpl2 < STARE_R * STARE_R &&
          (!CBZ.cityBond || CBZ.cityBond(p) < 0) && sees(p, P)) return "stare";
      if (rel && rel.seen && dpl2 < GREET_R * GREET_R && (rel.t || 0) > GREET_QUIET &&
          (p._tellGreetCD || 0) <= _clock && CBZ.cityBond && CBZ.cityBond(p) > BOND_MIN &&
          sees(p, P)) return "greet";
    }
    if (pocketsMan(p)) return "pockets";
    if (swaggerMan(p)) return "swagger";
    return null;
  }

  const ROW = { wary: "tellWary", pockets: "tellPockets", swagger: "tellSwagger", stare: "foldarms", greet: "kinWave" };
  function begin(p, kind) {
    if (!setPose(p, ROW[kind])) return false;
    p._tellKind = kind;
    p._tellT = 0;
    if (kind === "wary") { p.char._tellK = p._tellW || 0.5; _fWary++; }
    else if (kind === "pockets") _fPockets++;
    else if (kind === "swagger") _fSwagger++;
    else if (kind === "stare") _fStare++;
    else if (kind === "greet") {
      _fGreet++;
      // a stable per-person cooldown: the same man is always the one who is
      // quicker to say hello again, which is a character trait too.
      p._tellGreetCD = _clock + GREET_CD + pedHash(p, 0x7E13) * 70;
    }
    telling.push(p);
    return true;
  }

  // per-frame upkeep for an active tell (small set, capped, cheap)
  function tick(p, dt, P) {
    p._tellT = (p._tellT || 0) + dt;
    const kind = p._tellKind;
    if (kind === "wary") {
      const k = waryK(p, p.relPlayer || null);
      if (k <= 0.06) return false;                          // calmed down
      p.char._tellK = k;
      // LOOSELY — a frightened person keeps checking, they do not lock on.
      faceAt(p, threatX(p, P), threatZ(p, P), 0.05 + k * 0.05);
      return true;
    }
    if (kind === "stare") {
      if (!P || P.dead) return false;
      if (d2(p.pos.x, p.pos.z, P.pos.x, P.pos.z) > (STARE_R + 4) * (STARE_R + 4)) return false;
      faceAt(p, P.pos.x, P.pos.z, 0.16);                    // and they hold it
      return true;
    }
    if (kind === "greet") {
      if (!P || P.dead || p._tellT > GREET_HOLD) return false;
      faceAt(p, P.pos.x, P.pos.z, 0.22);
      return true;
    }
    return true;                                            // ambient: the pose is the whole tell
  }

  // ============================================================
  //  THE TICK — order 36.6. After peds.js (34, which runs move() and animChar
  //  and its own post-anim witness arms), after family.js (36.2), after
  //  kinship.js (36.4). Last writer of a yaw wins and last writer of the pose
  //  slot wins, so being late is what makes yielding to all three of them a
  //  fact rather than a hope.
  // ============================================================
  CBZ.onUpdate(36.6, function (dt) {
    if (!g || g.mode !== "city" || !on()) {
      if (telling.length) standDown();
      return;
    }
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) return;   // host simulates
    registerPoses();                                           // idempotent (runtime flag flip)
    if (!dt || dt <= 0) dt = 0.016; if (dt > 0.1) dt = 0.1;
    _clock += dt;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) { if (telling.length) standDown(); return; }
    const P = CBZ.player;

    // ---- live tells: validate + upkeep, every frame (bounded by the caps) --
    for (let i = telling.length - 1; i >= 0; i--) {
      const p = telling[i];
      if (!free(p) || !poseFree(p) || p._tellPose !== p.char.pose) { drop(i); continue; }
      if (!tick(p, dt, P)) { drop(i); continue; }
    }

    // ---- classify on a cadence, near the camera only -----------------------
    _scanT -= dt;
    if (_scanT > 0) return;
    _scanT = qs(SCAN * 2.2, SCAN);
    _losBudget = LOS_PER_SCAN;
    const cam = (CBZ.camera && CBZ.camera.position) || (P && P.pos) || null;
    if (!cam) return;
    let react = 0, ambient = 0;
    for (let i = 0; i < telling.length; i++) {
      const k = telling[i]._tellKind;
      if (k === "pockets" || k === "swagger") ambient++; else react++;
    }
    if (react >= REACT_CAP && ambient >= AMBIENT_CAP) return;
    const pdx = P && !P.dead ? P.pos.x : cam.x, pdz = P && !P.dead ? P.pos.z : cam.z;
    for (let i = 0; i < peds.length; i++) {
      if (react >= REACT_CAP && ambient >= AMBIENT_CAP) break;
      const p = peds[i];
      if (!p || p._tellKind) continue;                       // already telling
      if (!free(p) || !poseFree(p)) continue;
      const dcam = d2(p.pos.x, p.pos.z, cam.x, cam.z);
      if (dcam > AMBIENT_R * AMBIENT_R) continue;            // nobody could see it
      const dpl2 = (P && !P.dead) ? d2(p.pos.x, p.pos.z, pdx, pdz) : Infinity;
      const reactive = react < REACT_CAP && !!P && !P.dead && dpl2 < REACT_R * REACT_R;
      const kind = classify(p, P, dpl2, reactive);
      if (!kind) continue;
      const isAmbient = (kind === "pockets" || kind === "swagger");
      if (isAmbient && ambient >= AMBIENT_CAP) continue;
      if (!isAmbient && react >= REACT_CAP) continue;
      if (!begin(p, kind)) continue;
      if (isAmbient) ambient++; else react++;
    }
  });

  // ============================================================
  //  RATCHET — CBZ.cityTellsAudit(), the kinshipAudit() template. Counted off
  //  the LIVE world, never asserted.
  //
  //  strayPoses is the HARD invariant and it must read 0: a body still
  //  carrying our receipt that no live tell claims is a pose slot we have
  //  leaked, and a leaked pose slot is a person who can never be greeted,
  //  treated or posted again. Everything else in this file is expression;
  //  that number is the proof it hands the body back.
  // ============================================================
  CBZ.cityTellsAudit = function () {
    const peds = CBZ.cityPeds || [];
    let wary = 0, pockets = 0, swagger = 0, stares = 0, greets = 0, stray = 0;
    for (let i = 0; i < telling.length; i++) {
      const k = telling[i]._tellKind;
      if (k === "wary") wary++;
      else if (k === "pockets") pockets++;
      else if (k === "swagger") swagger++;
      else if (k === "stare") stares++;
      else if (k === "greet") greets++;
    }
    let alive = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i]; if (!p) continue;
      if (!p.dead) alive++;
      if (p._tellPose && telling.indexOf(p) < 0) stray++;
    }
    const fired = { wary: _fWary, pockets: _fPockets, swagger: _fSwagger, grudgeStares: _fStare, greets: _fGreet };
    return {
      peds: alive,                       // live city peds this driver can see
      telling: telling.length,           // bodies expressing a tell right now
      wary: wary,                        // …of which, per row (live)
      pockets: pockets,
      swagger: swagger,
      grudgeStares: stares,
      greets: greets,
      firedTotal: _fWary + _fPockets + _fSwagger + _fStare + _fGreet,   // cumulative
      fired: fired,                      // cumulative, split by tell
      strayPoses: stray,                 // MUST be 0 — leaked pose slots
      rows: !!(CBZ.charPoses && CBZ.charPoses.tellWary),
      flag: on(),
    };
  };

  // mode.js's fresh-run guard-call convention (cityKinshipReset / citySocialReset
  // sit beside this): a reset can never leave a half-expressed body behind.
  CBZ.cityTellsReset = function () {
    standDown();
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p) { p._tellGreetCD = 0; p._tellW = 0; } }
    _clock = 0; _scanT = 0;
    _fWary = _fPockets = _fSwagger = _fStare = _fGreet = 0;
  };
})();
