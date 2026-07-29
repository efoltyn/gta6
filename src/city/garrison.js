/* ===========================================================================
   city/garrison.js — A STATIONED JOB IS A JOB THAT REQUIRES YOU TO BE SOMEWHERE.

   OWNER (2026-07-29, verbatim): "I want soldiers more present and stationed.
   NPCs should be stationed — some jobs require that. Yes, they can run away and
   put hands up like current NPCs."

   ---------------------------------------------------------------------------
   THE FAULT: ONE IDEA, FOUR RECORD SHAPES, AND NOBODY OWNED IT.

   "This person's job requires them to be here" was written four separate times
   in this repo, by four files that never met:

     police.js      c._post      = {x, z, fx, fz, mount, mountT, relaxed}
     peds.js        ped.staffPost= {x, z, face}          (rooted, cannot fight)
     security.js    ped.guard / ped.homeGuard = {x, z}   (a wander leash)
     island_mil.js  t._stationed = {x, z, yaw}           (its own return loop)

   `_post` is the only one of the four with a real brain — walk back to the
   slot, hold it, throttled LOS probe, aim, arrest-first, holstered-until-wrong
   — and that brain is trapped inside a `for (const c of CBZ.cityCops)` loop, so
   only a POLICE OFFICER could ever have it. power.js's header has carried the
   note "§THE ONE EDIT OWED" about this for weeks. This file is that edit.

   Two things had to be true and neither was:

     (1) THE RECORD IS SHARED. `CBZ.cityPostStand(actor, spec)` writes the SAME
         `actor._post` field in the SAME shape police.js has always read, so the
         three existing consumers migrate by swapping one object literal for one
         call and police.js's cop branch is byte-identical afterwards. Every new
         field is additive and police.js ignores all of them.

     (2) A NON-COP CAN HOLD ONE. `CBZ.cityPostTick(actor, dt)` is the generic
         stationed brain for the other ~everybody: sentries, gate guards, shop
         security, receptionists, soldiers. It steers an ORDINARY ped through
         the fields peds.js already reads (`state` / `target` / `pause` /
         `rage`) — which is the pattern island_military.js's `_stationed` loop
         proved works — so a stationed body stays a full member of the crowd:
         it dies through the kill bus, it is robbable, interactions.js offers
         the normal verbs on it, and gunpointSweep throws its hands up.

   ---------------------------------------------------------------------------
   THE THREE BEATS THAT DID NOT EXIST, AND ARE THE WHOLE POINT.

   • RELIEVE / RETURN. Every one of the four legacy shapes could walk a body
     back if it was SHOVED. None of them could let a body LEAVE under threat and
     come back when the threat cleared, which is the difference between a post
     and a pin. `cityScare` (peds.js) already answers bolt/freeze/hold from the
     person's own stable roleHash, distance and the contagious panic field —
     this file consults it and NEVER bypasses it, then remembers where the
     person is supposed to be and walks them back when it is quiet. A soldier
     who runs from a grenade and then returns to the wire reads as somebody with
     a duty. A soldier who cannot run reads as a prop.

   • THE LEASH. Stationed combat is not ordinary combat. `combatIQ.posture`
     owns HOW an armed body fights (cover, turn-taking, the DPS ladder) — this
     file adds the one thing a sentry needs on top: he does not chase. Past
     `leash` metres the post pulls him home mid-fight, which is what makes a
     perimeter a perimeter instead of a mob that empties itself at the first
     shot.

   • A POST IS AN ORDER, AND AN ORDER NEEDS SOMEBODY ALIVE TO GIVE IT.
     police.js already proved this shape: kill the Chief and arrest-first lapses
     for 60-150 s because it is a standing order somebody HOLDS. A garrison post
     declares `{org, verb}` and asks `CBZ.rankHolder(org, verb)`. No living
     holder → the post is ORPHANED, goes relaxed, and is struck after a grace
     window; the body walks home instead of standing on a slot nobody ordered.
     The guard is `rankKnows`, never a bare `rankCan` null check — rankCan
     answers FALSE for an undeclared org, so `if (!rankCan(...)) strike()` would
     tear down every post in the world the moment FACTION_V1 was flipped off.

   ---------------------------------------------------------------------------
   THE JOIN: `cityStaffVenue` + `_post` ARE THE TWO HALVES OF A STATIONED JOB.

   citystaff.js already solved "declare a job at build time, mint the body only
   inside 170 m, give it back past 320 m, never re-man somebody who was SHOT".
   `_post` already solved "hold the slot". In fourteen hundred lines neither had
   ever been handed the other. `CBZ.cityGarrison(id, spec)` is that handshake:
   every garrison post is a `cityStaffPost` whose `after` hook calls
   `cityPostStand`, so a garrison inherits the whole no-spawn-in-view contract,
   the citywide body budget and the killed-stays-dead rule for free, and adds
   only the standing.

   BUDGET, stated plainly. Bodies are bounded by citystaff's own
   VENUE_STAFF_MAX (40) and by the 170 m mint radius, so the live cost is "how
   many declared stations are within 170 m of you" — which is one venue. The two
   military garrisons declare 11 (Fort Brandt: 9 posts + a 2-man watch) and 9
   (Defence HQ: 6 posts + a 3-man watch), and both sit on their own claimed
   land hundreds of metres from any civil venue, so the shared cap is never
   approached and is deliberately NOT raised — raising a shared budget to pay
   for a feature that does not need it is how a cap stops meaning anything. The
   worst frame cost is ~11 extra rigs while you are inside a garrison, all of
   them inside peds.js's own 95 m render cutoff anyway.

   ONE DELIBERATE TRESPASS. The Defence HQ carries govcomplex.js's `hard`
   keep-out, which exists so ambient crowd and traffic never wander into a
   secure compound. A GUARD is the one body that belongs inside it, and
   citystaff mints through cityPostNpc, which places directly rather than
   through the ambient spawner — so these posts stand where the keep-out is,
   on purpose. Nothing else about the keep-out changes.

   FLAGS: GARRISON (master) · GARRISON_POSTS (the shared record + brain) ·
          GARRISON_MIL (the military garrisons) · GARRISON_COMMAND (the watch
          and the order-degrades-when-its-author-dies rule).
   RATCHETS: CBZ.cityPostAudit() · CBZ.garrisonAudit().
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- flags (declared in the OWNING file, never config.js) ---------------
  if (C.GARRISON == null) C.GARRISON = true;
  if (C.GARRISON_POSTS == null) C.GARRISON_POSTS = true;
  if (C.GARRISON_MIL == null) C.GARRISON_MIL = true;
  if (C.GARRISON_COMMAND == null) C.GARRISON_COMMAND = true;
  // a ceiling on DECLARED stations across every garrison in the world. Data is
  // free; this exists so a future garrison cannot declare two hundred slots and
  // starve citystaff's shared body budget by sheer count.
  if (C.GARRISON_MAX_POSTS == null) C.GARRISON_MAX_POSTS = 48;

  function on() { return C.GARRISON !== false; }
  function postsOn() { return on() && C.GARRISON_POSTS !== false; }
  function milOn() { return on() && C.GARRISON_MIL !== false; }
  function cmdOn() { return on() && C.GARRISON_COMMAND !== false; }
  function now() {
    return CBZ.now != null ? CBZ.now
      : (typeof performance !== "undefined" ? performance.now() : Date.now());
  }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function playing() { return CBZ.game && CBZ.game.mode === "city"; }

  // ADOPTION IS DECLARED, NOT SNIFFED (the predatorAudit lesson, combat_iq.js's
  // own vocabulary). A stationed body's fighting is combat_iq's — cover,
  // turn-taking, the reaction beat, the DPS ladder — and this file adds only
  // the leash. The buffer makes it script-order-proof: combat_iq.js may not
  // have parsed yet, and its own drain() picks this up when it does.
  (function () {
    const id = "garrison:post-stand";
    if (CBZ.combatIQ && CBZ.combatIQ.adopt) { CBZ.combatIQ.adopt(id); return; }
    (CBZ._combatIQAdopted = CBZ._combatIQAdopted || []).push(id);
  })();

  // deterministic 0..1 from a world position — never Math.random in a build path
  function h01(x, z, salt) {
    if (CBZ.hash01) { try { return CBZ.hash01(x, z, salt); } catch (e) {} }
    const s = Math.sin(x * 12.9898 + z * 78.233 + (salt | 0) * 0.113) * 43758.5453;
    return s - Math.floor(s);
  }

  /* =========================================================================
     §1  THE POST RECORD — CBZ.cityPostStand(actor, spec).

     ADOPTION IS ONE LINE AND IT REPLACES THE LINE THE CALLER ALREADY WROTE:

         c._post = { x, z, fx, fz, mount: null, mountT: 0, relaxed: true };
     becomes
         CBZ.cityPostStand(c, { x, z, fx, fz, relaxed: true });

     and every field police.js reads is still there, in the same place, with the
     same meaning. Degrade-safe by construction — a caller writes
     `CBZ.cityPostStand ? CBZ.cityPostStand(c, s) : (c._post = {…})` and the
     flag-off path is the exact object it used to build.

     THE REGISTRY IS SELF-HEALING. police.js's roadblock teardown nulls
     `c._post` directly (`for (const c of RB.cops) c._post = null`) and always
     will — it is allowed to, because the field is the contract, not this file.
     So the sweep drops any record whose actor no longer points at it rather
     than trusting a release call it cannot make anyone perform.
     ========================================================================= */
  const POSTS = [];
  let _postSeq = 0;

  // how far off the slot before a body walks back. A SENTRY is exact; a floor
  // guard is allowed to drift, because a man rooted to a millimetre reads as a
  // statue and this game's own vendor pin already covers "does not move".
  const KIND_DEF = {
    sentry:     { radius: 0.8,  leash: 16, senses: 34, returnT: 8 },
    checkpoint: { radius: 0.8,  leash: 22, senses: 40, returnT: 10 },
    watch:      { radius: 1.0,  leash: 12, senses: 30, returnT: 12 },
    detail:     { radius: 0.8,  leash: 14, senses: 28, returnT: 6 },
    roadblock:  { radius: 0.8,  leash: 26, senses: 42, returnT: 0 },
    guard:      { radius: 2.4,  leash: 20, senses: 26, returnT: 9 },
    desk:       { radius: 1.2,  leash: 6,  senses: 16, returnT: 14 },
    drill:      { radius: 0.4,  leash: 8,  senses: 22, returnT: 16 },
  };

  CBZ.cityPostStand = function (actor, spec) {
    if (!actor || !spec) return null;
    // RE-POSTING IS ALLOWED (a detail's slot moves with its principal, a
    // checkpoint restages), so drop the old record first — otherwise the
    // registry keeps a orphan nobody points at and every audit over-counts.
    if (actor._post) CBZ.cityPostRelease(actor, "restand");
    const d = KIND_DEF[spec.kind] || KIND_DEF.sentry;
    // BEARING: a caller may hand a unit vector (police.js does) or a yaw
    // (island_military.js does). One record, both vocabularies, no caller
    // rewritten to learn the other.
    let fx = spec.fx, fz = spec.fz;
    if (fx == null && fz == null && spec.face != null) { fx = Math.sin(spec.face); fz = Math.cos(spec.face); }
    if (fx == null && fz == null) {
      const y = (actor.group && actor.group.rotation) ? actor.group.rotation.y : 0;
      fx = Math.sin(y); fz = Math.cos(y);
    }
    const rec = {
      // ---- the shape police.js has always read. Do not reorder, do not rename.
      x: +spec.x, z: +spec.z, fx: fx, fz: fz,
      mount: spec.mount || null, mountT: spec.mountT || 0,
      relaxed: !!spec.relaxed,
      // ---- additive: police.js's branch never looks at any of these ---------
      id: spec.id || ("post:" + (++_postSeq)),
      kind: spec.kind || "sentry",
      tag: spec.tag || null,
      job: spec.job || null,
      org: spec.org || null,             // WHO ordered this post…
      verb: spec.verb || null,           // …and what rung of theirs can order it
      alertVerb: spec.alertVerb || null, // the rung that can call stand-to
      radius: spec.radius != null ? +spec.radius : d.radius,
      leash: spec.leash != null ? +spec.leash : d.leash,
      senses: spec.senses != null ? +spec.senses : d.senses,
      returnT: spec.returnT != null ? +spec.returnT : d.returnT,
      minStars: spec.minStars != null ? (spec.minStars | 0) : 1,
      home: spec.home || null,           // where he goes when the post is struck
      owner: spec.owner || null,         // the garrison record, if any
      // SHARING A RECORD IS NOT SURRENDERING A BRAIN. A caller that already
      // steps this body every frame (police.js's cop loop, protection.js's
      // detail follow) declares `driven` and keeps its own tick — it still gets
      // the shared shape, the order gate and the audit. That distinction is the
      // only reason five call sites could migrate in one change.
      driven: !!spec.driven,
      drive: typeof spec.drive === "function" ? spec.drive : null,
      hold: typeof spec.hold === "function" ? spec.hold : null,
      threat: typeof spec.threat === "function" ? spec.threat : null,
      onAbandon: typeof spec.onAbandon === "function" ? spec.onAbandon : null,
      onReturn: typeof spec.onReturn === "function" ? spec.onReturn : null,
      // ---- live state -------------------------------------------------------
      left: false, leftAt: 0, back: 0,
      orphan: false, orphanAt: 0, struck: false,
      alertT: 0, seen: null, ticks: 0, held: 0, returns: 0, abandons: 0,
      baseRelaxed: !!spec.relaxed,
      standAt: now(),
    };
    // IS THIS A POLICE OFFICER? Decided ONCE, here, because the answer needs an
    // indexOf into CBZ.cityCops and the sweep below asks it of every post every
    // frame. A body never changes force mid-post.
    rec._cop = !!(actor.kind === "cop" || actor.copRank || actor.swat ||
      (CBZ.cityCops && CBZ.cityCops.indexOf(actor) >= 0));
    actor._post = rec;
    rec.actor = actor;
    POSTS.push(rec);
    // ADOPTION EVIDENCE, keyed on the tag's FAMILY (the text before the first
    // colon), so the audit can say WHICH files have migrated without a second
    // declaration to keep in sync. It is a permanent record: a producer that
    // has stood one post has adopted the block, whether or not that post is
    // still standing while you happen to run the audit.
    if (rec.tag) ADOPTED[String(rec.tag).split(":")[0]] = true;
    // A TRUTHFUL JOB, because level.js's overhead pill reads exactly this field
    // and a stationed body with no trade is the "Lv.N <shrug>" casting bug.
    if (rec.job && !actor.job) actor.job = rec.job;
    return rec;
  };

  CBZ.cityPostOf = function (actor) {
    const r = actor && actor._post;
    return (r && r.actor === actor) ? r : (r || null);
  };

  CBZ.cityPostRelease = function (actor, why) {
    if (!actor || !actor._post) return false;
    const rec = actor._post;
    rec.struck = true; rec.why = why || "released";
    actor._post = null;
    const i = POSTS.indexOf(rec);
    if (i >= 0) POSTS.splice(i, 1);
    return true;
  };

  CBZ.cityPosts = function () { return POSTS; };

  // Tell every post within `r` that something happened here. This is the bus a
  // gunshot / a body dropping / an alarm rings, and it is what makes a
  // perimeter react as a perimeter instead of as N independent eyes.
  CBZ.cityPostAlert = function (x, z, r, threat) {
    if (!postsOn()) return 0;
    const R2 = (r || 60) * (r || 60);
    let n = 0;
    for (let i = 0; i < POSTS.length; i++) {
      const p = POSTS[i];
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > R2) continue;
      // AN ALERT IS A NOTICE, NOT A VERDICT. It deliberately does NOT hand the
      // post a target: cityAlarm fires on a fistfight and a dropped bottle as
      // well as on gunfire, and a sentry who took every one of those as an
      // enemy would spend the day walking to the end of his leash and back at
      // whatever was happening across the street. What it does is wake him —
      // he looks FURTHER for a while and he looks NOW — and security.js's own
      // intruder filter (wanted NPCs and a wanted player, nothing else) still
      // decides whether there is anybody to fight.
      p.alertT = Math.max(p.alertT, 14);
      p._scanT = 0;
      n++;
    }
    return n;
  };

  /* =========================================================================
     §2  THE ORDER — a post nobody outranks is a post nobody gave.

     police.js's command watch is the proof this reads: kill the Chief and the
     department's arrest-first posture LAPSES, because it was a standing order
     somebody held, not a config flag with no author. Same law here, and the
     degrade is graded rather than binary, because "the sergeant is dead so
     every sentry vanishes" is a bug and "the sergeant is dead and nothing
     changes" is a stat fiction:

       no holder of `verb`      -> the post is ORPHANED. It goes relaxed at
                                   once, and is STRUCK after the grace window;
                                   the body walks home and stops being a sentry.
       no holder of `alertVerb`  -> the post can never STAND TO. Sentries stay
                                   holstered through a manhunt, because nobody
                                   is left who can order the wire hot.

     GRACE is deterministic off the slot, not rolled: 55-100 s, the same order
     of magnitude as police.js's 60-150 s command vacancy, so an authority gap
     is a window you can act in rather than an instant collapse.
     ========================================================================= */
  function orderKnown(org, verb) {
    return !!(org && verb && CBZ.rankKnows && CBZ.rankKnows(org, verb));
  }
  function orderHolder(org, verb) {
    if (!orderKnown(org, verb)) return true;            // ladder does not know it -> ungated
    if (!CBZ.rankHolder) return true;
    let h = null;
    try { h = CBZ.rankHolder(org, verb); } catch (e) { h = null; }
    return !!h;
  }
  function graceFor(rec) { return 55 + h01(rec.x, rec.z, 0x6A11) * 45; }

  function tickOrder(rec, dt) {
    // IDEMPOTENT PER FRAME. A `driven` record is order-ticked by garrison's own
    // sweep AND, when its owner delegates, by cityPostTick in the owner's loop.
    // CBZ.now is stamped once per frame by core/loop.js, so this is exactly the
    // guard combat_iq.js uses to stop its reaction beat ticking twice and
    // halving itself — without it the orphan grace would elapse at double rate.
    const fr = now();
    if (rec._orderF === fr) return rec._orderOk !== false;
    rec._orderF = fr;
    rec._orderOk = tickOrderReal(rec, dt);
    return rec._orderOk;
  }
  function tickOrderReal(rec, dt) {
    if (!cmdOn() || !rec.org || !rec.verb) { rec.orphan = false; return true; }
    const held = orderHolder(rec.org, rec.verb);
    if (held) {
      if (rec.orphan) { rec.orphan = false; rec.orphanAt = 0; rec.relaxed = rec.baseRelaxed; }
      return true;
    }
    if (!rec.orphan) { rec.orphan = true; rec.orphanAt = 0; rec.relaxed = true; }
    rec.orphanAt += dt;
    return rec.orphanAt < graceFor(rec);
  }

  // may this post go weapons-up at all? The alert rung has to be held by
  // somebody alive, and rankKnows keeps a flag-off world exactly as it was.
  function mayStandTo(rec) {
    if (!cmdOn() || !rec.alertVerb) return true;
    return orderHolder(rec.org, rec.alertVerb);
  }

  /* =========================================================================
     §3  THE STATIONED BRAIN — CBZ.cityPostTick(actor, dt, opts).

     For every body police.js does NOT drive. It writes only fields peds.js
     already reads, so nothing here is a second locomotion system:

       state / target / pause  -> peds.js move() walks him
       rage + state "fight"    -> peds.js npcAttack fights for him
       group.rotation.y        -> the bearing he holds (written after move())

     Returns one of "gone" | "flee" | "engage" | "return" | "home" | "hold".
     ========================================================================= */
  function distXZ(a, x, z) { const dx = a.pos.x - x, dz = a.pos.z - z; return Math.sqrt(dx * dx + dz * dz); }

  function walkTo(actor, rec, x, z) {
    if (rec.drive) { try { rec.drive(actor, x - actor.pos.x, z - actor.pos.z); return; } catch (e) {} }
    actor.path = null; actor.finalGoal = null;
    if (actor.target && actor.target.set) actor.target.set(x, 0, z);
    actor.state = "walk"; actor.pause = 0;
  }

  function standIdle(actor, rec, dt) {
    if (rec.hold) { try { rec.hold(actor, Math.atan2(rec.fx, rec.fz), dt); return; } catch (e) {} }
    actor.path = null; actor.finalGoal = null;
    actor.state = "idle"; actor.speed = 0;
    // `pause` is what stops peds.js's wander from re-issuing a stroll on the
    // next think() slice — island_military.js's stationed loop uses exactly
    // this, and it is the only reason a plain ped can hold a spot at all.
    actor.pause = Math.max(actor.pause || 0, 2);
    if (actor.group) {
      const want = Math.atan2(rec.fx, rec.fz);
      actor.group.rotation.y = CBZ.lerpAngle
        ? CBZ.lerpAngle(actor.group.rotation.y, want, 1 - Math.pow(0.02, dt || 0.016))
        : want;
    }
  }

  // WHO IS THE PROBLEM. Never a new threat model: security.js already answers
  // "an intruder near this guard" (wanted NPCs + the wanted player) and it is
  // the exact question a sentry asks. A post may override with `spec.threat`.
  function threatFor(actor, rec, dt) {
    if (rec.threat) { try { const t = rec.threat(actor, rec); if (t && !t.dead) return t; } catch (e) {} }
    if (actor.rage && !actor.rage.dead) {
      // HE GIVES UP THE CHASE. Without this the first person who ever angered a
      // sentry is his threat FOREVER: he would walk to the end of his leash,
      // get pulled back, walk out again, and oscillate on the wire for the rest
      // of the session. Twice the post's own senses is the give-up range —
      // beyond it the problem has left the perimeter, which is the only thing a
      // man on a post was ever asked to care about.
      if (actor.rage.pos && distXZ(actor.rage, rec.x, rec.z) > rec.senses * 2) { actor.rage = null; }
      else return actor.rage;
    }
    if (rec.seen && !rec.seen.dead) {
      const d = distXZ(rec.seen, rec.x, rec.z);
      if (d < rec.senses * 1.6) return rec.seen;
      rec.seen = null;
    }
    // THROTTLED. citySecurityIntruder walks the whole ped roster, so running it
    // per post per frame would be O(posts x peds) forever. A sentry noticing you
    // a third of a second late is invisible; the scan cost is not. (police.js
    // throttles its own LOS probe to 0.22-0.34 s for exactly this reason.)
    rec._scanT = (rec._scanT || 0) - (dt || 0.016);
    if (rec._scanT > 0) return null;
    rec._scanT = 0.3 + h01(rec.x, rec.z, 0x6A33) * 0.18;
    if (CBZ.citySecurityIntruder) {
      let t = null;
      try { t = CBZ.citySecurityIntruder(actor); } catch (e) { t = null; }
      // AN ALERTED MAN LOOKS FURTHER. That is the whole of what cityPostAlert
      // buys — 35% more reach for 14 s after anything loud happened nearby —
      // and it is why a shot fired at one end of a perimeter gets noticed at
      // the other before you have finished walking there.
      const reach = rec.senses * (rec.alertT > 0 ? 1.35 : 1);
      // A SOLDIER DOES NOT OPEN UP ON A SHOPLIFTER. citySecurityIntruder's bar
      // is one star, which is right for the jeweller's own doorman and far too
      // low for a rifleman on a national defence compound. `minStars` is the
      // one dial, it applies to the PLAYER only (a wanted NPC is somebody the
      // city is already hunting), and anybody who has actually shot at him is
      // in `actor.rage` well before this line.
      if (t && t === (CBZ.city && CBZ.city.playerActor) && (CBZ.game && (CBZ.game.wanted | 0)) < rec.minStars) return null;
      if (t && !t.dead && distXZ(t, actor.pos.x, actor.pos.z) < reach) { rec.seen = t; return t; }
    }
    return null;
  }

  // is this body one the world expects to STAND AND FIGHT? cityScare answers
  // "hold" for exactly these already; we ask first so an unarmed receptionist
  // gets the bolt/freeze branch and a rifleman does not.
  function trained(actor) {
    return !!(actor.kind === "cop" || actor.kind === "security" || actor.milRank ||
      actor.copRank || actor.swat || (actor.armed && actor.aggr >= 0.34));
  }

  CBZ.cityPostTick = function (actor, dt, opts) {
    if (!postsOn() || !actor) return "gone";
    const rec = actor._post;
    if (!rec || rec.actor !== actor) return "gone";
    if (actor.dead || (actor.ko || 0) > 0 || actor.inCar || actor._npcAttached) return "gone";
    if (CBZ.body && CBZ.body.busy && CBZ.body.busy(actor)) return "gone";
    dt = dt || 0.016;
    rec.ticks++;
    if (rec.alertT > 0) rec.alertT -= dt;

    // ---- (a) IS THIS POST STILL ORDERED? --------------------------------
    if (!tickOrder(rec, dt)) {
      // struck: the order outlived its author. Walk home and stop being a
      // sentry — never freeze in place on a slot nobody is responsible for.
      const home = rec.home || rec.owner && rec.owner.home;
      if (home && distXZ(actor, home.x, home.z) > 4) { walkTo(actor, rec, home.x, home.z); }
      else { actor.state = "walk"; actor.pause = 0; }
      CBZ.cityPostRelease(actor, "orphaned");
      return "home";
    }

    // ---- (b) THEY ARE STILL PEOPLE -------------------------------------
    // Held at gunpoint / hands up: peds.js's gunpointSweep and markGunpoint own
    // the body completely while covered. A post that fought that would be the
    // "seated body could only freeze" bug in a new costume.
    if (actor.surrender || actor.state === "surrender" || (actor.surrenderT || 0) > 0 || actor._covered) {
      rec.left = true; rec.leftAt = 0;
      return "flee";
    }
    if (actor.state === "flee") {
      // fled under fire (cityScare's bolt, or peds.js's own panic). Remember it
      // and start the clock — THIS is the beat that did not exist.
      if (!rec.left) { rec.left = true; rec.abandons++; if (rec.onAbandon) { try { rec.onAbandon(actor, rec); } catch (e) {} } }
      rec.leftAt = 0;
      return "flee";
    }

    const threat = threatFor(actor, rec, dt);

    // ---- (c) SOMEBODY IS THERE -----------------------------------------
    if (threat) {
      rec.seen = threat;
      const hot = mayStandTo(rec) && !rec.orphan;
      // DOES HE DARE? sizeup.js already owns this exact question (the level gap
      // against the person's own nerve, with trained bodies answering yes by
      // construction) and cityScare consults it too — so asking it HERE means a
      // sentry who is hopelessly outmatched drops into the same bolt-or-freeze
      // branch as a receptionist, which is the owner's "yes, they can run away
      // and put hands up like current NPCs" applied to a man in uniform. A post
      // is a duty, not a suicide pact.
      let dares = true;
      if (CBZ.citySizeUp) { try { dares = !!CBZ.citySizeUp(actor, threat); } catch (e) { dares = true; } }
      if (!trained(actor) || !dares) {
        // NOT A COIN FLIP AND NOT OURS TO DECIDE. cityScare weighs the person's
        // own stable roleHash, the distance (nobody outruns a gun at four
        // metres) and the contagious panic field, and it is the ONE place a
        // body gets out of a seat. We only record what it chose.
        let choice = "hold";
        if (CBZ.cityScare) { try { choice = CBZ.cityScare(actor, threat, { bias: rec.kind === "desk" ? 0.08 : 0 }); } catch (e) { choice = "hold"; } }
        if (choice === "bolt") {
          if (!rec.left) { rec.left = true; rec.abandons++; if (rec.onAbandon) { try { rec.onAbandon(actor, rec); } catch (e) {} } }
          rec.leftAt = 0;
          return "flee";
        }
        // freeze / hold: he stays on the slot and faces the problem.
        standIdle(actor, rec, dt);
        if (actor.group) actor.group.rotation.y = Math.atan2(threat.pos.x - actor.pos.x, threat.pos.z - actor.pos.z);
        return "hold";
      }
      if (hot) {
        // ARMED AND ON DUTY. combat_iq owns HOW he fights — cover, turn-taking,
        // the DPS ladder, the reaction beat. We add the one thing a post adds:
        // HE DOES NOT CHASE.
        actor.rage = threat; actor.state = "fight"; actor.pause = 0;
        actor.alarmed = Math.max(actor.alarmed || 0, 8);
        const IQ = CBZ.combatIQ;
        if (IQ && IQ.posture) { try { IQ.posture(actor, threat, dt); } catch (e) {} }
        const off = distXZ(actor, rec.x, rec.z);
        if (off > rec.leash) {
          // THE LEASH. Past it the post wins over the fight: he breaks contact
          // toward his slot. A perimeter that empties itself down the first
          // alley is not a perimeter.
          walkTo(actor, rec, rec.x, rec.z);
          return "return";
        }
        rec.left = false; rec.leftAt = 0;
        return "engage";
      }
      // A post that may not stand to WATCHES. He is alert, he faces the
      // problem, and he does not draw — the difference between a checkpoint and
      // martial law, and the visible consequence of a dead command element.
      standIdle(actor, rec, dt);
      if (actor.group) actor.group.rotation.y = Math.atan2(threat.pos.x - actor.pos.x, threat.pos.z - actor.pos.z);
      return "hold";
    }

    // ---- (d) THE COAST IS CLEAR ----------------------------------------
    if (actor.rage) { actor.rage = null; if (actor.state === "fight") actor.state = "walk"; }

    if (rec.left) {
      // RETURN TO POST. Not instant: he has to believe it is over, and the
      // panic field is the honest measure of that — the same decaying spatial
      // field cityScare feeds every time anybody bolts.
      rec.leftAt += dt;
      const panic = CBZ.cityPanicAt ? CBZ.cityPanicAt(actor.pos.x, actor.pos.z) : 0;
      if (rec.leftAt < rec.returnT || panic > 0.35 || (actor.fear || 0) > 3) return "flee";
      rec.left = false; rec.leftAt = 0; rec.returns++;
      actor.fear = 0; actor.alarmed = 0;
      if (rec.onReturn) { try { rec.onReturn(actor, rec); } catch (e) {} }
      walkTo(actor, rec, rec.x, rec.z);
      return "return";
    }

    const off = distXZ(actor, rec.x, rec.z);
    if (off > rec.radius) { walkTo(actor, rec, rec.x, rec.z); return "return"; }
    rec.held += dt;
    standIdle(actor, rec, dt);
    return "hold";
  };

  /* =========================================================================
     §4  A GARRISON — a PLACE with posts and a chain of command.

     `CBZ.cityGarrison(id, spec)` is the handshake described in the header: it
     declares a citystaff VENUE (so the bodies obey the 170 m mint / 320 m
     release / never-seen-spawning / killed-stays-dead contract that block
     already owns) and stamps a shared post on every body it hands back.

     THE GENERATOR PICKS THE VERB, THE WORLD SUPPLIES THE SPECIFICS —
     contracts.js's binding law, applied here. Nothing below invents a place: a
     garrison is declared only where the world already built a gate, a wall, a
     tower corner or a parade ground, and if the world did not build one there
     is simply no garrison.
     ========================================================================= */
  const GARRISONS = [];
  let declaredStations = 0;

  CBZ.cityGarrison = function (id, spec) {
    if (!on() || !id || !spec) return null;
    if (!CBZ.cityStaffPost || !CBZ.cityStaffVenue) return null;   // degrade-safe: no venue block, no garrison
    const list = spec.posts || [];
    if (!list.length) return null;
    const venue = "garrison:" + id;
    const rec = {
      id: id, venue: venue, name: spec.name || id,
      org: spec.org || null, x: +spec.x || 0, z: +spec.z || 0,
      home: spec.home || null,
      stations: 0, posted: [], alert: 0,
    };
    // Declare the venue with ZERO stations, then set the real count once we
    // know how many posts actually got declared. `stations` is what
    // venueStaffAudit().unstaffed subtracts the posts from, and that ratchet is
    // PINNED AT 0 — so claiming N jobs up front and then creating N-2 of them
    // (because the global cap cut in, or a post had no coordinates) would break
    // somebody else's gate with a number that is not even about this file.
    // cityStaffStations exists for exactly this: a venue that only learns its
    // own headcount while it walks its own ground.
    CBZ.cityStaffVenue(venue, { stations: 0, note: rec.name });
    for (let i = 0; i < list.length; i++) {
      if (declaredStations >= (C.GARRISON_MAX_POSTS | 0)) break;
      const s = list[i];
      const p = declarePost(rec, s, i, spec);
      if (p) { rec.posted.push(p); rec.stations++; declaredStations++; }
    }
    if (CBZ.cityStaffStations) CBZ.cityStaffStations(venue, rec.stations);
    GARRISONS.push(rec);
    return rec;
  };

  function declarePost(gar, s, i, spec) {
    const job = s.job || spec.job || "soldier";
    const face = s.face != null ? s.face : Math.atan2((gar.x - s.x), (gar.z - s.z)) + Math.PI;
    const kind = s.kind || "sentry";
    // BODY OPTIONS. `pin:false` is load-bearing and deliberate: citystaff's
    // default pins a worker with peds.js's `staffPost`, which roots the body so
    // hard it cannot walk, fight or come back — correct for a croupier at a
    // felt table, fatal for a sentry. A garrison body is an ORDINARY ped and
    // this file's tick is what keeps it on its feet.
    const opts = {
      pin: false,
      // `kind:"civilian"` is island_military.js's own choice for a trooper and
      // it is deliberate: `kind:"security"` would make cityScare answer "hold"
      // unconditionally, and a soldier who can never break is the statue this
      // whole file exists to stop shipping. The uniform comes from the JOB
      // string ("soldier" paints the camo + olive patrol cap in peds.js), the
      // allegiance from `organization`, and the rank from the roster.
      kind: "civilian",
      archetype: s.archetype || (spec.archetype || "security"),
      armed: s.armed !== false,
      weapon: s.weapon || spec.weapon || "AK-47",
      aggr: s.aggr != null ? s.aggr : 0.5,
      hp: s.hp != null ? s.hp : (spec.hp != null ? spec.hp : 140),
      faction: spec.faction || null,
      behavior: "defensive",
    };
    if (spec.pedOpts) for (const k in spec.pedOpts) opts[k] = spec.pedOpts[k];
    if (s.opts) for (const k in s.opts) opts[k] = s.opts[k];
    const post = CBZ.cityStaffPost({
      venue: gar.venue,
      id: gar.venue + ":" + (s.id || i),
      x: s.x, z: s.z, face: face,
      job: job,
      opts: opts,
      near: s.near != null ? s.near : 170,
      far: s.far != null ? s.far : 320,
      after: function (ped) {
        if (!ped) return;
        // the ORGANISATION stamp is what makes factions.of()/reactionTo()
        // answer for this body — militia.js declares the army with
        // `npcTag:{field:"organization", value:"military"}`, so one field is
        // the whole membership and no parallel roster exists.
        if (spec.organization) { ped.organization = spec.organization; ped.organizationLoyalty = 100; }
        // A DECLARED COMMAND POST *IS* ITS RANK — it is not a roster draw.
        // peds.js assigns milRank by roster slot for any body cast with the
        // soldier job, which is the right answer for a rifleman and the wrong
        // one for the Sergeant of the Guard: the slot ordinal is global and by
        // the time a city garrison mints, the fort has already consumed dozens
        // of it, so the man at the gate would be whatever the counter happened
        // to land on. This is the same law level.js applies to the Defence HQ
        // officeholder — the Chief of the General Staff IS the General because
        // he was declared at that tier, not because a die agreed. Overwrites on
        // purpose; `!ped.milRank` would never be true here.
        if (s.rank) ped[spec.rankField || "milRank"] = s.rank;
        if (s.name) ped.name = s.name;
        CBZ.cityPostStand(ped, {
          x: s.x, z: s.z, face: face, kind: kind,
          relaxed: s.relaxed !== false,
          job: job, tag: "garrison:" + gar.id + ":" + (s.id || i),
          org: spec.org || null,
          verb: s.verb || spec.verb || null,
          alertVerb: s.alertVerb || spec.alertVerb || null,
          home: gar.home || null,
          owner: gar,
          leash: s.leash, radius: s.radius, senses: s.senses, returnT: s.returnT,
          minStars: s.minStars != null ? s.minStars : spec.minStars,
        });
      },
      release: function (ped) {
        // the body is going back to the pool: drop the post first so the
        // registry never holds a reference to a rig somebody else disposes.
        if (ped && ped._post) CBZ.cityPostRelease(ped, "released");
        return false;                                  // citystaff owns the teardown
      },
    });
    if (post) post._garrison = gar;
    return post;
  }

  CBZ.cityGarrisons = function () { return GARRISONS; };

  /* =========================================================================
     §5  THE TICK — 41.92.

     After citystaff's manning pass (41.86) so a body minted this frame is
     already standing by the time we look, and after peds.js's own think/move
     (34) so the bearing we write is the one that survives the frame.
     ========================================================================= */
  let sweepT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.92, function (dt) {
    if (!postsOn() || !playing()) return;
    dt = dt || 0;
    // SELF-HEALING SWEEP. Any consumer is allowed to null `_post` (police.js's
    // roadblock teardown does, and must) — so membership is re-derived from the
    // field rather than trusted from a release call.
    sweepT += dt;
    if (sweepT > 0.5) {
      sweepT = 0;
      // A BODY THE WORLD HAS REAPED MUST NOT BE HELD BY US. clearCityPeds /
      // clearCityCops empty their arrays and dispose the rigs WITHOUT touching
      // `_post` — they were never told this registry exists and should not have
      // to be — so membership is re-derived from the live rosters. One Set per
      // half-second over ~300 actors; the alternative is an indexOf per post per
      // sweep, which is the same work squared.
      let live = null;
      if (POSTS.length && typeof Set === "function") {
        live = new Set();
        const L = [CBZ.cityPeds, CBZ.cityCops];
        for (let q = 0; q < L.length; q++) { const arr = L[q]; if (!arr) continue; for (let i = 0; i < arr.length; i++) live.add(arr[i]); }
      }
      for (let i = POSTS.length - 1; i >= 0; i--) {
        const r = POSTS[i], a = r.actor;
        if (!a || a._post !== r || a.culled) { POSTS.splice(i, 1); continue; }
        if (a.dead) { a._post = null; POSTS.splice(i, 1); continue; }
        if (live && !live.has(a)) { a._post = null; POSTS.splice(i, 1); continue; }
      }
    }
    // BACKWARDS, because cityPostTick's orphan-strike arm calls
    // cityPostRelease, which splices this very array — a forward loop would
    // skip the next post every time a post was struck.
    for (let i = POSTS.length - 1; i >= 0; i--) {
      const r = POSTS[i], a = r.actor;
      // POLICE OFFICERS ARE DRIVEN BY POLICE.JS. Its cop loop owns the aim
      // pose, the arrest-first gate, the LOS probe and the roadblock mount-up,
      // and running a second brain over the same body would fight it every
      // frame. They share the RECORD; they do not share the tick. That is the
      // whole reason `_post` is the field and not a private map.
      if (!a) continue;
      if (r.driven || r._cop) {
        tickOrder(r, dt);                              // the ORDER still applies to them
        if (r.orphan) r.relaxed = true;
        continue;
      }
      CBZ.cityPostTick(a, dt);
    }
  });

  /* =========================================================================
     §6  THE WORLD'S GARRISONS — soldiers, present and stationed.

     Deferred to the first city tick, exactly like citystaff's own trade wiring:
     island_military.js publishes `CBZ._militaryBase` and govcomplex.js
     publishes `CBZ.govComplexes` during worldgen, and this file parses before
     either has run.

     WHY THESE TWO PLACES AND NOT A SCATTER. The owner's complaint is that
     soldiers are not PRESENT. The answer is not more wandering bodies — it is
     bodies standing where a soldier would actually stand, at the two military
     places the world already builds: the reservation's wire, and the Defence
     Headquarters, which sits on its own claimed land inside the playable city
     and until now had a manned gatehouse with nobody in it.
     ========================================================================= */
  const ARMY = "army";

  function ringPosts(cx, cz, r, n, salt, kind, verb) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + h01(cx, cz, salt) * 0.7;
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      out.push({ id: kind + i, x: x, z: z, face: a, kind: kind, verb: verb });
    }
    return out;
  }

  function standFortBrandt() {
    const B = CBZ._militaryBase;
    if (!B || !B.center || B.minX == null) return false;
    // EVERY COORDINATE BELOW IS ISLAND_MILITARY.JS'S OWN. It publishes the gate
    // it fenced, the flagpole it raised, the armoury door, the motor pool and
    // the parade ground; nothing here re-types a literal, so moving the base
    // moves the guard.
    const cx = B.center.x, cz = B.center.z;
    const minX = B.minX, maxX = B.maxX, minZ = B.minZ, maxZ = B.maxZ;
    const gate = B.gate || { x: minX, z: cz };
    const posts = [];
    // THE WIRE. Four corners of the reservation, each facing OUT — a sentry
    // looks away from the thing he is guarding, which is the single detail
    // that makes a perimeter read as one and not as four men loitering.
    const corners = [
      { x: minX + 16, z: minZ + 16 }, { x: maxX - 16, z: minZ + 16 },
      { x: minX + 16, z: maxZ - 16 }, { x: maxX - 16, z: maxZ - 16 },
    ];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      posts.push({
        id: "wire" + i, x: c.x, z: c.z, kind: "sentry",
        face: Math.atan2(c.x - cx, c.z - cz),
        verb: "post", alertVerb: "standto",
      });
    }
    // THE GATE. Two on the causeway head, facing the road IN — the pair you
    // actually drive up to. island_military.js's own two `_stationed` guards
    // stand on the causeway kerbs either side of them.
    posts.push({ id: "gate", x: gate.x + 6, z: gate.z, kind: "checkpoint",
      face: Math.atan2(gate.x - cx, gate.z - cz), verb: "post", alertVerb: "standto" });
    // THE MOTOR POOL and THE ARMOURY — the two things on a base worth taking,
    // and therefore the two things a base actually guards.
    if (B.motorPool) posts.push({ id: "motorpool", x: B.motorPool.x, z: B.motorPool.z, kind: "sentry", verb: "post", alertVerb: "standto" });
    if (B.armory) posts.push({ id: "armoury", x: B.armory.x + 5, z: B.armory.z - 5, kind: "sentry", verb: "post", alertVerb: "standto" });
    // THE FLAGLINE — the ceremonial pair under arms at the HQ flagpole,
    // relaxed, facing the mast. `drill` gives them the tight 0.4 m tolerance
    // that reads as attention rather than as standing about.
    if (B.flag) {
      posts.push({ id: "flag0", x: B.flag.x - 3, z: B.flag.z - 3, kind: "drill", face: Math.atan2(3, 3), verb: "post" });
      posts.push({ id: "flag1", x: B.flag.x + 3, z: B.flag.z - 3, kind: "drill", face: Math.atan2(-3, 3), verb: "post" });
    }
    const gar = CBZ.cityGarrison("fort-brandt", {
      name: "Fort Brandt Garrison",
      org: ARMY, organization: "military", rankField: "milRank",
      x: cx, z: cz,
      home: B.barracks || { x: maxX - 60, z: minZ + 60 },   // the barracks row
      job: "soldier", weapon: "AK-47", hp: 150,
      verb: "post", alertVerb: "standto",
      // TWO STARS. A rifleman on a defence compound is not the jeweller's
      // doorman; see threatFor for why the shared one-star bar is wrong here.
      minStars: 2,
      posts: posts,
    });
    // THE WATCH stands in FRONT of the parade ground facing the formation —
    // where the inspecting officer of any army that has ever existed stands,
    // and 14 m clear of island_military.js's own first rank.
    const par = B.parade || { x: cx, z: cz };
    if (gar && cmdOn()) standWatch(gar, par.x, par.z - 14, 0, COMMAND_MIL);
    return !!gar;
  }

  function standDefenceHQ() {
    const sites = CBZ.govComplexes;
    if (!sites || !sites.length) return false;
    let site = null;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (s && s.def && s.def.id === "defence" && s.rect) { site = s; break; }
    }
    if (!site) return false;
    const cx = site.cx, cz = site.cz, R = site.rect;
    const gate = site.gate || { x: cx, z: R.minZ };
    // OUT of the compound is the direction from the centre to the gate: the
    // pair on the gatehouse face the approach, not the courtyard.
    let ox = gate.x - cx, oz = gate.z - cz;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    const lx = -oz, lz = ox;
    const posts = [
      // THE GATEHOUSE PAIR. govcomplex.js builds a gatehouse at this exact
      // coordinate and has never once put anybody in it.
      { id: "gate0", x: gate.x + lx * 4.2 + ox * 1.5, z: gate.z + lz * 4.2 + oz * 1.5, face: Math.atan2(ox, oz), kind: "checkpoint", verb: "post", alertVerb: "standto" },
      { id: "gate1", x: gate.x - lx * 4.2 + ox * 1.5, z: gate.z - lz * 4.2 + oz * 1.5, face: Math.atan2(ox, oz), kind: "checkpoint", verb: "post", alertVerb: "standto" },
      // THE APPROACH. One man forward of the gate on the parade slab, which is
      // the body you meet FIRST and the reason the compound reads as manned
      // from a car.
      { id: "approach", x: gate.x + ox * 22, z: gate.z + oz * 22, face: Math.atan2(-ox, -oz), kind: "checkpoint", verb: "post", alertVerb: "standto" },
    ];
    // THE PERIMETER — three on the wire, evenly spread, facing out.
    const rr = Math.min((R.maxX - R.minX), (R.maxZ - R.minZ)) * 0.5 - 14;
    if (rr > 20) {
      const ring = ringPosts(cx, cz, rr, 3, 0x6A21, "sentry", "post");
      for (let i = 0; i < ring.length; i++) { ring[i].alertVerb = "standto"; posts.push(ring[i]); }
    }
    const gar = CBZ.cityGarrison("defence-hq", {
      name: "Defence Headquarters Guard",
      org: ARMY, organization: "military", rankField: "milRank",
      x: cx, z: cz,
      home: { x: cx, z: cz },
      job: "soldier", weapon: "AK-47", hp: 150,
      verb: "post", alertVerb: "standto",
      // TWO STARS. A rifleman on a defence compound is not the jeweller's
      // doorman; see threatFor for why the shared one-star bar is wrong here.
      minStars: 2,
      posts: posts,
    });
    if (gar && cmdOn()) standWatch(gar, gate.x + ox * 8, gate.z + oz * 8, Math.atan2(ox, oz), COMMAND_HQ);
    return !!gar;
  }

  /* =========================================================================
     §7  THE COMMAND WATCH — the brass are people you can find.

     Copied in shape from police.js's precinct watch, and for the same reason:
     a rank drawn as a percentage roll on a street body is a stat fiction — you
     could play for hours with nobody alive who can order a sentry mounted. So
     the officer who authorises these posts STANDS AT THE GATE, on his own
     relaxed post, and when he dies the wire goes soft in a way you can see.
     ========================================================================= */
  const COMMAND_MIL = [
    { key: "sergeant", pip: "Sergeant of the Guard", off: -2.6 },
    { key: "lieutenant", pip: "Duty Officer", off: 2.6 },
  ];
  const COMMAND_HQ = [
    { key: "sergeant", pip: "Sergeant of the Guard", off: -2.6 },
    { key: "lieutenant", pip: "Duty Officer", off: 2.6 },
    { key: "general", pip: "Officer of the Watch", off: 6.4 },
  ];

  function standWatch(gar, x, z, face, ladder) {
    const lx = -Math.cos(face), lz = Math.sin(face);
    const posts = [];
    for (let i = 0; i < ladder.length; i++) {
      const spec = ladder[i];
      posts.push({
        id: "watch:" + spec.key,
        x: x + lx * spec.off, z: z + lz * spec.off, face: face,
        kind: "watch", rank: spec.key, name: spec.pip,
        job: "soldier", relaxed: true,
        // THE WATCH ITSELF IS NOT ORDERED BY ANYBODY. Gating the commander's
        // own post on a rung he IS would orphan the whole chain the moment the
        // first one died — the vacancy is the consequence, not a cascade.
        verb: null, alertVerb: null,
        opts: { aggr: 0.42, hp: 160 },
      });
    }
    const w = CBZ.cityGarrison(gar.id + "-watch", {
      name: gar.name + " — Command Watch",
      org: ARMY, organization: "military", rankField: "milRank",
      x: x, z: z, home: gar.home,
      job: "soldier", weapon: "Pistol", hp: 160,
      minStars: 2,
      posts: posts,
    });
    if (w) { w.isWatch = true; gar.watch = w; }
    return w;
  }

  /* =========================================================================
     §8  BOOT — one deferred pass, retried until the world exists.
     ========================================================================= */
  let stood = { fort: false, hq: false }, bootT = 0, bootTries = 0, bootArena = null;
  if (CBZ.onUpdate) CBZ.onUpdate(41.93, function (dt) {
    if (!milOn() || !playing()) return;
    const A = arena();
    // A NEW WORLD IS A NEW GARRISON. citystaff.js's own venue declaration
    // clears on rebuild and clearCityPeds drops every body; without this the
    // `stood` latch would hold across a city rebuild and the second world you
    // ever load would have no soldiers standing anywhere at all. Same arena-
    // identity test citystaff.js's instanced layer already uses.
    if (A && A !== bootArena) { CBZ.cityGarrisonReset(); bootArena = A; }
    if (stood.fort && stood.hq) return;
    if (bootTries > 900) return;                        // the world simply has no base
    bootT += dt || 0;
    if (bootT < 1.5) return;
    bootT = 0; bootTries++;
    if (!A || !CBZ.cityStaffPost) return;
    try { if (!stood.fort) stood.fort = standFortBrandt(); } catch (e) { stood.fort = false; }
    try { if (!stood.hq) stood.hq = standDefenceHQ(); } catch (e) { stood.hq = false; }
  });

  // A CITY REBUILD DROPS EVERY BODY. citystaff.js already re-declares its own
  // venues on reset; ours must forget that it stood the garrisons so the next
  // world stands them again.
  CBZ.cityGarrisonReset = function () {
    // Hand our venues back to citystaff FIRST. cityStaffVenue's own contract is
    // that re-declaring an id clears its previous posts, so this is the
    // sanctioned teardown — and without it a world with no military base would
    // leave last world's stations sitting in the shared post list, trying to
    // mint sentries at coordinates that no longer mean anything.
    if (CBZ.cityStaffVenue) {
      for (let i = 0; i < GARRISONS.length; i++) {
        try { CBZ.cityStaffVenue(GARRISONS[i].venue, { stations: 0 }); } catch (e) {}
      }
    }
    for (let i = POSTS.length - 1; i >= 0; i--) { const a = POSTS[i].actor; if (a) a._post = null; }
    POSTS.length = 0;
    GARRISONS.length = 0;
    declaredStations = 0;
    stood = { fort: false, hq: false }; bootTries = 0; bootT = 0;
  };

  /* =========================================================================
     §9  THE RATCHETS (CLAUDE.md BLOCK LAW #5).

     CBZ.cityPostAudit() — the DUPLICATION count this block exists to drive
     down. `legacyShapes` is the number of distinct "a body is stationed here"
     record shapes still being authored anywhere in the game; it may only go
     DOWN. Everything beside it is live evidence, so a "fix" that simply stops
     standing anybody cannot pass:

       legacyShapes — declared list, decremented only by a real migration.
       posts        — live shared records right now.
       byKind       — the census by post kind.
       adopters     — call sites that declare through cityPostStand.
       held/left/orphaned/struck — what the live posts are actually doing.
       ordered      — posts that name an {org, verb}; unordered posts are the
                      legacy shape wearing the new record and are worth seeing.

     CBZ.garrisonAudit() — the OWNER'S ask, measured.

       garrisons/stations — declared places and slots (a property of the code).
       manned             — bodies standing in them right now (proximity-gated:
                            0 when you are nowhere near a garrison is CORRECT).
       soldiers           — every live body in the world carrying a military
                            rank or organisation, which is the number the owner
                            actually asked to move.
       stationed          — of those, how many hold a post.
       commandHeld        — can anybody alive order a sentry mounted / the wire
                            hot. Both FALSE with a garrison standing means the
                            chain of command has been killed, which is a real
                            world state and not a bug.
     ========================================================================= */
  // EVERY PLACE IN THE GAME THAT STILL AUTHORS A STANDING ANCHOR OF ITS OWN.
  // Counted file by file, not guessed (CLAUDE.md's own instruction after the
  // propUseAudit lesson). A row leaves this list ONLY when its file declares
  // through cityPostStand. Five producers migrated in the change that shipped
  // this block — police.js (roadblock + command watch), checkpoints.js,
  // power.js (both detail kinds), security.js and island_military.js's gate —
  // and these nine are what is left. Six of them are in files that wave did
  // not own, which is exactly why they are written down instead of quietly
  // fixed: the next wave that touches gangs.js or bunkers.js owes one line.
  const LEGACY_SHAPES = [
    "islandmil:parade",          // island_military.js:1423 — `_stationed` alone.
    //   DELIBERATE, and the only row here that is not simply outstanding work:
    //   the drill rank owns a salute beat and a 0.4 m parade tolerance that a
    //   generic sentry brain would delete. Migrating it means MOVING that
    //   choreography, not dropping it.
    "bunkers:posted",            // bunkers.js:1016 — `_stationed`, fenced this wave
    "gangs:hq-guard",            // gangs.js:377     — guard/homeGuard leash
    "gangs:business-guard",      // gangs.js:514
    "playergang:hq-guard",       // playergang.js:282
    "companies:hq-guard",        // companies.js:166
    "vips:cast-guard",           // vips.js:180
    "buildings:door-guard",      // buildings.js:5453
    "interior:lobby-guard",      // interior_programs.js:1550
    // "peds:staffPost" — DELIBERATELY NOT LISTED. ped.staffPost is a genuinely
    //   different contract (a rooted vendor-class pin that must never walk or
    //   fight — a croupier at a felt table), not another copy of this one.
    //   Folding it in would delete a behaviour, and that is not a migration.
  ];
  const ADOPTED = Object.create(null);
  CBZ.cityPostAdopt = function (id) { if (id) ADOPTED[String(id)] = true; };
  (function drain() {
    const pre = CBZ._cityPostAdopted;
    if (!pre) return;
    try { for (let i = 0; i < pre.length; i++) CBZ.cityPostAdopt(pre[i]); } catch (e) {}
  })();

  CBZ.cityPostAudit = function () {
    const byKind = Object.create(null);
    let held = 0, left = 0, orphaned = 0, ordered = 0, cops = 0, engaged = 0;
    for (let i = 0; i < POSTS.length; i++) {
      const r = POSTS[i];
      byKind[r.kind] = (byKind[r.kind] | 0) + 1;
      if (r.left) left++; else held++;
      if (r.orphan) orphaned++;
      if (r.org && r.verb) ordered++;
      const a = r.actor;
      if (a && (a.kind === "cop" || a.copRank || a.swat)) cops++;
      if (a && a.rage) engaged++;
    }
    return {
      legacyShapes: LEGACY_SHAPES.length,
      remaining: LEGACY_SHAPES.slice(),
      adopters: Object.keys(ADOPTED).length,
      adopted: Object.keys(ADOPTED),
      posts: POSTS.length, byKind: byKind,
      held: held, left: left, orphaned: orphaned, ordered: ordered,
      cops: cops, engaged: engaged,
      enabled: postsOn(),
      flags: { master: on(), posts: postsOn(), mil: milOn(), command: cmdOn() },
    };
  };

  CBZ.garrisonAudit = function () {
    const out = {
      garrisons: GARRISONS.length, stations: 0, manned: 0, lost: 0,
      places: [], soldiers: 0, stationed: 0, ranked: 0,
      commandHeld: { post: null, standto: null },
      declaredStations: declaredStations, cap: C.GARRISON_MAX_POSTS | 0,
      stood: { fort: stood.fort, hq: stood.hq },
      enabled: milOn(),
    };
    for (let i = 0; i < GARRISONS.length; i++) {
      const g2 = GARRISONS[i];
      let manned = 0, lost = 0;
      for (let k = 0; k < g2.posted.length; k++) {
        const p = g2.posted[k];
        if (!p) continue;
        if (p.ped && !p.ped.dead) manned++;
        if (p.lost) lost++;
      }
      out.stations += g2.stations; out.manned += manned; out.lost += lost;
      out.places.push({ id: g2.id, name: g2.name, stations: g2.stations, manned: manned, lost: lost, watch: !!g2.isWatch });
    }
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead) continue;
      const mil = p.organization === "military" || !!p.milRank;
      if (!mil) continue;
      out.soldiers++;
      if (p.milRank) out.ranked++;
      if (p._post) out.stationed++;
    }
    // WHO CAN GIVE THE ORDER. rankKnows first: with the army undeclared these
    // read null and every gate in this file is open, which is the flag-off
    // world exactly as it was.
    if (orderKnown(ARMY, "post")) out.commandHeld.post = orderHolder(ARMY, "post");
    if (orderKnown(ARMY, "standto")) out.commandHeld.standto = orderHolder(ARMY, "standto");
    return out;
  };
})();
