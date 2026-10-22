/* ============================================================
   entities/ai.js — the "give NPCs life" brain.

   Every inmate runs a little state machine: WANDER → FIGHT / FLEE /
   ESCAPE. They sort into their race's car (systems/prisoncars.js), brawl
   with rivals, sometimes betray
   and jump their OWN gang leader, occasionally take a swing at a
   guard, and now and then make a break for the exit. Anyone can be
   beaten down or killed — by you, by each other, by the guards.

   npc.js calls CBZ.aiThink(n, dt) each frame; we set n.target / state
   and return the speed to move at. Combat also reaches into guards
   (they have .hp/.ko too), so brawls spill over onto the staff.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const rng = () => CBZ.econ.rng();
  /* THE CARS (systems/prisoncars.js). `n.yardCar` is the car a man belongs to by
     who he is (every inmate has one); `n.gang` is the same index when he is
     ACTIVE in its business (dues, turf, work) and -1 when he just does his
     time under its umbrella. There are no colours: no arm band, no painted
     turf disc, no name-plate colour. You can see who a man runs with. */
  function PCARS() { return CBZ.prisonCars || null; }
  function NCARS() { const P = PCARS(); return P ? P.N : 2; }
  function carOfA(a) { const P = PCARS(); return P ? P.carOf(a) : (a && a.gang >= 0 ? a.gang : -1); }
  function playerCar() { const P = PCARS(); return P ? P.playerCar() : -1; }
  function rivalCar(g) { const P = PCARS(); return P ? P.rivalOf(g) : (g === 0 ? 1 : 0); }
  // the car that backs a man (retaliation is the car's, active or not)
  function carK(n) { return n && typeof n.yardCar === "number" && n.yardCar >= 0 ? n.yardCar : (n && n.gang >= 0 ? n.gang : -1); }

  /* ============================================================
     THE YARD BEATING — the strike table for a man who has decided to jump you.

     `JUMP_GRAB_P` is the chance a blow escalates into the shared seize grammar
     (CBZ.predatorSeize) instead of landing as a punch. It used to be, in
     effect, 1.0 from the third blow onward, which made the ANIMAL takedown —
     camera possessed and orbiting the attacker, predator.js:1350 — the normal
     way a prison fight went, on a man with hands. At 0.12, gated behind five
     landed blows and capped at one per attacker, it is what it should be: the
     thing that happens when somebody is really determined, a couple of fights
     in a run rather than every one. `CBZ.CONFIG.JAIL_GRAB_P` overrides it live
     for anyone measuring the rate.

     MELEE_BLOW is what the count now buys instead. One row per strike the rig
     can throw, and the numbers say what the strike IS:
       dmg/roll  damage floor and spread (scaled by WHERE it lands: res.dmgMul)
       stun      how long you cannot act — bone weapons stun more than they cut
       shake     camera kick
     How far a blow MOVES you is no longer a column here: it is the blow's own
     power through CBZ.verbs (a hard one puts you on a stagger step), and a
     shove is CBZ.verbs.shove, which asks the world where you end up.
     ============================================================ */
  const JUMP_GRAB_P_DEFAULT = 0.12;
  /* 2026-09-27 (owner: "it's way too easy to die"): FISTS HURT, THEY RARELY
     KILL. Every fist row is ~45% lighter than it was (a straight averaged 9.5,
     now 5.5), a man swings every 1.35 s instead of every 1.0 s, and only ONE
     man swings at the player at a time (SWING_SLOTS below). A beating now
     takes you down in roughly half a minute of standing in it, not five
     seconds. The blade row keeps its teeth: 12-18 a stab is why a shank is
     the thing to be afraid of. */
  const MELEE_BLOW = {
    "":         { dmg: 4,  roll: 3, stun: 0.42, shake: 0.42 },  // straight
    hook:       { dmg: 5,  roll: 3, stun: 0.50, shake: 0.52 },
    upper:      { dmg: 6,  roll: 3, stun: 0.55, shake: 0.55 },
    elbow:      { dmg: 4,  roll: 3, stun: 0.62, shake: 0.50 },
    knee:       { dmg: 5,  roll: 3, stun: 0.72, shake: 0.48 },
    headbutt:   { dmg: 7,  roll: 3, stun: 0.66, shake: 0.66 },
    shove:      { dmg: 1,  roll: 2, stun: 0.26, shake: 0.28 },
    stab:       { dmg: 12, roll: 6, stun: 0.34, shake: 0.32 },
  };
  const HUNT_HIT_CD = 1.35;

  /* THE BLOW LANDS WHERE THE FIST LANDS, AND A CROWD TAKES TURNS.

     A man's swing is CBZ.verbs.strike (systems/verbs_strike.js): a real
     strike on his rig that lands on the frame his fist (elbow, forehead,
     knee) actually reaches your jaw, head, ribs or legs, whiffs if you
     stepped out of it, never lands through a wall, and is cut off if your
     fist lands first or a screw breaks it up (both zero his punch clock).
     The reaction (head snap, fold, stagger step) is the verbs' too; this
     file only says what the blow costs you (landBlow → CBZ.hurtPlayer). The
     swing log is the attack token every brawler game ends up with: one man
     is inside a swing beat at once, the rest circle. */
  // one fist at a time on the player: the others circle and wait their turn
  const SWING_WINDOW = 0.6, SWING_SLOTS = 1;
  const _swingLog = [];
  function swingCrowded(n) {
    const now = (CBZ.now || 0) / 1000;
    let k = 0;
    for (let i = _swingLog.length - 1; i >= 0; i--) {
      const e = _swingLog[i];
      if (e.until <= now || !alive(e.n)) { _swingLog.splice(i, 1); continue; }
      if (e.n !== n) k++;
    }
    return k >= SWING_SLOTS;
  }
  function logSwing(n) { _swingLog.push({ n, until: (CBZ.now || 0) / 1000 + SWING_WINDOW }); }
  const PLAYER_A = { isPlayer: true, get pos() { return CBZ.player.pos; } };
  function playerA() { const V = CBZ.verbs; return V && V.playerActor ? V.playerActor() : PLAYER_A; }
  const SHANK_W = { kind: "shank", blade: true, mass: 0.2 };
  function swinging(n) { const V = CBZ.verbs; return !!(V && V.strikeOf && V.strikeOf(n)); }
  function cutSwing(n) { const V = CBZ.verbs; if (V && V.cancelStrike && V.strikeOf && V.strikeOf(n)) V.cancelStrike(n); }
  // throw one blow of the vocabulary at the player through the shared strike
  function throwBlow(n, kind, arm, M, swing, stabbing) {
    const V = CBZ.verbs;
    if (!V || !V.strike) return null;
    const blow = { M, swing, stabbing, kind };
    return V.strike(n, playerA(), {
      kind, arm, weapon: stabbing ? SHANK_W : null, maxLunge: 0.6,
      heavy: kind === "headbutt" || kind === "upper",
      onLand: function (res) { if (!landBlow(n, blow, res)) res.reaction = "none"; },
      // a shove is CBZ.verbs.shove when CORE's sessions exist: the world
      // decides where you go, and it costs what a shove costs
      onOutcome: function () { landBlow(n, blow, null); },
    });
  }
  // the fist found you: what it costs (res.dmgMul is where it landed; the
  // zone and the power go on to CBZ.vitals through capture.js's hurtPlayer)
  const BLOW_WEAPON = { elbow: "elbow", headbutt: "headbutt", knee: "knee", shove: "fist" };
  function landBlow(n, B, res) {
    if (CBZ.player.dead) return false;
    // he stops when you are down, unless he came with a blade and a reason
    if (playerDownedNow() && !lethalGrudge(n)) return false;
    const blocked = !!(res && res.blocked);
    if (CBZ.hurtPlayer) {
      CBZ.hurtPlayer(B.swing * (res ? res.dmgMul : 1), n.group.position.x, n.group.position.z,
        { melee: true, stun: B.M.stun * (blocked ? 0.4 : 1), heat: B.stabbing ? 4 : 2, shake: B.M.shake,
          sfx: B.stabbing ? "hit" : "punch", by: n, weapon: B.stabbing ? "shank" : "fist", reacted: true,
          blunt: BLOW_WEAPON[B.kind] || "fist", blocked,
          zone: res ? (blocked ? "armL" : res.zone) : "body",
          power: res ? res.power * (blocked ? 0.25 : 1) : (B.kind === "shove" ? 0.15 : 0.4),
          point: res ? res.point : null, dirX: res ? res.dir.x : 0, dirZ: res ? res.dir.z : 0 });
    }
    return true;
  }

  /* ============================================================
     THE HUNT GOVERNOR (2026-09-27, owner: "when I get moved to a tough jail,
     it seems like everybody hates me").

     The old spiral: a snubbed demand or one punch called provokeGang, which
     set huntPlayer on EVERY living member of that gang across the compound,
     and every one of them closed and swung. Hostility is per person now:

       requestHunt(n, secs, why)  the ONE way this file starts a man on you.
                                  Refused while he has been broken up by a
                                  guard (n._brokenUpT, set by LAW's
                                  CBZ.breakUpFight) or while you are down.
       huntSlot(n)                at most 2 men actually come at you at once
                                  (3 at ultra-max). Anyone else who wants to
                                  (including men set hunting by other files,
                                  which write huntPlayer directly) stands off
                                  at 4-6 m and watches: the ring, not the pile.
     ============================================================ */
  const _hunters = [];
  let _maxHuntersSeen = 0, _huntStarts = 0, _huntRefused = 0;
  function huntCap() {
    const L = CBZ.prisonTier && CBZ.prisonTier.level ? (CBZ.prisonTier.level() | 0) : 0;
    return L >= 3 ? 3 : 2;
  }
  function playerDownedNow() {
    return !!(CBZ.playerDowned && CBZ.playerDowned());
  }
  // a cuffed man is nobody's fight (systems/cuffedplayer.js): the one blow a
  // rival sneaks in is brain_prison.js's cuffedPoll ("cheap"), and that is all
  function playerCuffedNow() {
    return !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on());
  }
  // THE LETHAL MISTAKE: a man with a blade out and a real grudge, and no screw
  // looking, does not stop because you are on the floor.
  function lethalGrudge(n) {
    return !!(n && n._shankOut && (n.playerGrudge || 0) >= 6 && !watched(n));
  }
  function pruneHunters() {
    for (let i = _hunters.length - 1; i >= 0; i--) {
      const h = _hunters[i];
      if (!alive(h) || !((h.huntPlayer || 0) > 0) || (h._brokenUpT || 0) > 0) _hunters.splice(i, 1);
    }
  }
  function huntSlot(n) {
    pruneHunters();
    if (_hunters.indexOf(n) >= 0) return true;
    if (_hunters.length >= huntCap()) return false;
    _hunters.push(n);
    if (_hunters.length > _maxHuntersSeen) _maxHuntersSeen = _hunters.length;
    return true;
  }
  function requestHunt(n, secs, why) {
    if (!n || !alive(n) || !n.group || n.role === "merchant") return false;
    if ((n._brokenUpT || 0) > 0 || (playerDownedNow() && !lethalGrudge(n))) { _huntRefused++; return false; }
    if (playerCuffedNow() && why !== "cheap" && !lethalGrudge(n)) { _huntRefused++; return false; }
    if (CBZ.player && CBZ.player.gang != null && n.gang === CBZ.player.gang && why !== "wronged") return false;
    // A GUN IS OUT. Nobody walks at a muzzle because his feelings are hurt:
    // CBZ.brain.threat decides (systems/brain_prison.js 5c) — a blade inside
    // its window may rush, everyone else runs, hides, gets down or puts his
    // hands up, and keeps the grudge for later.
    if (CBZ.prisonBrain && CBZ.prisonBrain.gunRefuses && CBZ.prisonBrain.gunRefuses(n)) {
      _huntRefused++;
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1.5);
      return false;
    }
    if (!((n.huntPlayer || 0) > 0)) _huntStarts++;
    n.huntPlayer = Math.max(n.huntPlayer || 0, secs || 6);
    n._huntWhy = why || n._huntWhy || "";
    return true;
  }
  function huntersNow() { pruneHunters(); return _hunters.length; }

  /* ============================================================
     SHOW DON'T TELL — THE ONE NARRATION SINK (JAIL_SHOW_DONT_TELL).

     OWNER, verbatim: "the HUD is cluttered with 4th-wall breakers — summaries
     of events when the events should just HAPPEN ('x is jumping you' etc).
     don't say you're getting beat up — have an NPC punch the player and health
     go down."

     This file held FIFTY-FIVE `CBZ.flashHint` calls, every one of them a
     third-person sentence about something the simulation had already done:
     "the Reds see you ducking work", "X filed a complaint", "Two inmates huddle
     over block gossip". They were not information — the events they described
     are all VISIBLE (a man walks to a guard, a crew closes in, a fist lands) —
     they were a caption track over a world that was already acting.

     So every one of them now goes through `nar`, and `nar` DROPS THEM. That is
     the whole change: one function, fifty-five callers migrated in the same
     edit, and a one-line revert (`CBZ.CONFIG.JAIL_SHOW_DONT_TELL = false`)
     restores the popups byte for byte. Events that genuinely need a surface
     have one already and it is not this: a DEATH goes to city/killfeed.js
     (`CBZ.cityLogDeath` — the only sanctioned popup in the game), and a thing a
     person SAYS goes over that person's head (`CBZ.citySay`), which is diegetic.

     Ratchet: CBZ.jailShowAudit().narrations (systems/capture.js) counts what is
     still routed here, and may only ever go DOWN.
     ============================================================ */
  /* ---- 2026-08-04: A NARRATION NOW NEEDS A MOUTH -------------------------
     OWNER: "Don't clear up the logic behind the HUD space wasters. Improve
     that logic, connect it all, and make it real logic, but remove it from the
     HUD."

     The block above was only half done and the count proves it: 47 nar() sites,
     ONE say() — and that one could not work either, because city/social.js's
     citySay reads `ped.pos.x` and a prison actor keeps its position on
     `.group.position`. Every prison citySay threw straight into the try/catch
     below and returned false. So this file deleted its caption track and put
     nothing in its place: the debt, the dues, the cover, the snitch runs and
     the crew reactions all still RAN, and the only evidence any of it existed
     was the #gangHud chip strip the owner is now (rightly) deleting.

     `nar` therefore takes two more arguments and neither is optional in
     spirit: WHO is doing this, and what that person SAYS. Given both, the line
     goes over their head through systems/interact.js's CBZ.prisonSay — the
     prison's one real, working, ranged, ranked speech surface. Given neither,
     the event is silent exactly as it is today, and CBZ.aiNarrationAudit()
     counts it as MUTE so the number is honest and can only be paid down.

       nar(text, secs)                    -> silent (legacy; counted mute)
       nar(text, secs, actor, "line")     -> that actor says "line"

     `text` survives untouched as the JAIL_SHOW_DONT_TELL=false popup, so the
     flag is still a byte-identical one-line revert to the old caption track.
     ------------------------------------------------------------------------ */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.JAIL_SHOW_DONT_TELL == null) CBZ.CONFIG.JAIL_SHOW_DONT_TELL = true;
  /* PRISON_CONTRACTS — the tab ledger between inmates and the work it buys
     (the "TABS AND CONTRACTS" section below, and the Collect / Settle / Take
     verbs interact.js hangs off it). */
  if (CBZ.CONFIG.PRISON_CONTRACTS == null) CBZ.CONFIG.PRISON_CONTRACTS = true;
  let narDropped = 0, narSpoken = 0, narMute = 0;
  /* 2026-09-27 (owner: "all the text... too much bullshit in the way"): the
     caption track is gone for good. The JAIL_SHOW_DONT_TELL=false popup
     branch is deleted, and most nar() call sites with it; what is left is a
     person saying a few words, or nothing. `say` counts what is actually
     spoken so the ratchet below stays honest. */
  function nar(text, secs, actor, spoken) {
    narDropped++;
    if (actor && spoken && say(actor, spoken, null, secs)) return true;
    narMute++;
    return true;
  }
  // a line somebody SAYS belongs over their head, not on the HUD. Routed to the
  // prison's own surface first (interact.js) and only then to the city's, which
  // is the one that cannot read a prison actor's position.
  function say(actor, text, color, secs) {
    if (!actor || !text) return false;
    let ok = false;
    if (CBZ.prisonSay) ok = !!CBZ.prisonSay(actor, text, { secs: Math.max(1.6, secs || 2.0) });
    else if (CBZ.citySay) { try { CBZ.citySay(actor, text, color || "#cfd6e6", secs || 1.8); ok = true; } catch (e) { ok = false; } }
    if (ok) narSpoken++;
    return ok;
  }
  /* THE RATCHET (BLOCK LAW rule 5). `mute` is the count of world events this
     file resolved with NOBODY saying or showing anything — the honest size of
     the hole the show-don't-tell wave left. It may only ever go DOWN. `spoken`
     may only go UP. Pinned in tools/math-gate.mjs is the wrong home for a
     counter that only moves during play, so tools/prison-polish-check.mjs
     drives real approaches and asserts on it instead. */
  CBZ.aiNarrationAudit = function () {
    return { sink: true, dropped: narDropped, spoken: narSpoken, mute: narMute,
      on: CBZ.CONFIG.JAIL_SHOW_DONT_TELL !== false };
  };
  // GANG_NAMES is indexed by a gang id that is -1 for every unaffiliated body,
  // and eighteen call sites read it straight — which is where the photographed
  // "undefined see you ducking work." came from. A crew with no id is "the
  // block", because that is who actually noticed.
  function gangName(gid) {
    const P = PCARS();
    return P && gid >= 0 && gid < P.N ? P.phrase(gid) : "the block";
  }

  // each car's spot on the yard (systems/prisoncars.js CARS[i].yard)
  function turfOf(g) { const P = PCARS(); return P && g >= 0 && P.CARS[g] ? P.CARS[g].yard : null; }

  /* FLOATING EMOJI OVER HEADS: DELETED. (OWNER: the hearts, the dollar signs
     and the question marks above people's heads.)

     44 call sites painted one character to a 64px canvas and pinned it over
     the head with depthTest:false — so it drew THROUGH WALLS, which the
     prison's other icon system (systems/markers.js) deliberately refuses to
     do: that one gates on 3.8m, a 72-degree facing cone, an LOS raycast and a
     0.22s fade, and its header states the law — "hostility is communicated by
     actor behavior, sound, and the map, never by a floating marker."

     THIRTEEN OF THE 44 ALREADY DREW NOTHING. The emoji were destroyed by a
     lossy edit: commit 801dd96 has emote(ally, mode === "snitch" ? "snake" :
     "fist") where the source now holds two empty strings, and the heart at
     ~4187 is the last survivor on its own line. So a third of this system was
     already building a canvas, drawing nothing on it, and holding an invisible
     sprite over somebody's head for 1.6 seconds.

     Gutted rather than deleted at the 44 call sites for one specific reason:
     several pass an rng() expression as the glyph (`emote(n, rng() < 0.4 ? ...
     : "heart")`). Those draws are evaluated BEFORE the call, so leaving the
     call sites intact keeps the shared rng stream byte-identical — removing
     them would shift every later draw and break determinism (doctrine: never
     add/remove draws on a shared stream). The sprite, the canvas and the
     texture cache are all gone; only the sprite is.

     THE "!" BECAME A STARE. 27 of the call sites (19 here, 8 more through
     CBZ.npcEmote in economy.js and guards.js) passed "!" and every one of them
     means the same thing: this man just CLOCKED you. That is not a symbol, it
     is a head turning — so the glyph is swapped for the gesture at the one
     place the glyph used to be drawn, rather than editing 27 call sites.
     systems/reactions.js already owned a finished damped head-track (aimK /
     aimY / aimP, yaw-clamped, shoulders opening after it) that was gated to
     armed shooters following a rage target; npcStare opens it to anybody.

     The other glyphs stay silent. */
  function emote(actor, ch) {
    if (ch === "!" && CBZ.npcStare) CBZ.npcStare(actor, 1.7);
  }

  /* THE CAR IS WHO YOU ARE (2026-09-28, owner: "instead of a colorful band
     showing what gang you're in, it's the race ... and those are the gangs").

     Before: the Reds (Latino) and the Blues (Black), a red or blue box on the
     left forearm, a red and a blue disc on the yard floor, everybody else in
     neither. Now every inmate is in his race's car (systems/prisoncars.js:
     Southsiders, Black, White, Paisas, Asian, Others), dealt from his
     heritage and nothing else. About four in ten are ACTIVE in the car's
     business (n.gang = the car); the rest ride under it (n.gang = -1, n.yardCar
     still set): they sit at its tables, answer to its shot-caller and are
     backed by it, but do not collect dues or hold ground. Named loners (Tiny,
     the Professor, Iron Mike...) are in their car and inactive. A cell
     resident is active at half the rate. The roll is a hash of the man (no
     draw on the shared rng stream). */
  const ACTIVE_P = 0.4;
  function cliqueHash(n, i) {
    const name = (n.data && n.data.name) || "";
    const p = n.group ? n.group.position : { x: 0, z: 0 };
    let h = 2166136261 ^ (i * 374761393);
    const key = name + "|" + Math.round(p.x * 10) + "|" + Math.round(p.z * 10) + "|" + (n.data && n.data.cell || "");
    for (let k = 0; k < key.length; k++) { h ^= key.charCodeAt(k); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }
  function heritageOf(n) {
    return (n && n.char && n.char.heritage) || (n && n.heritage) || null;
  }
  function assignClique(n, i) {
    if (n._baseGang !== undefined) return n._baseGang;
    const convict = n.kind === "inmate" || n.role === "inmate" || n.role === "thief";
    n.yardCar = convict ? carOfA(n) : -1;
    // a man the roster put in the car's business stays in it; if the roster
    // named a car that is not his own, his own wins (the car is who he is)
    const preset = n.gang != null && n.gang >= 0 ? n.gang : null;
    let gang = -1;
    if (n.yardCar >= 0) {
      if (preset != null) gang = n.yardCar;
      else if (n.role !== "merchant" && n.role !== "dealer") {
        const anon = !!(n.data && (n.data.cell || n.data.name === "an inmate"));
        if (anon || !n.forceNeutral) {
          const p = ACTIVE_P * (n.data && n.data.cell ? 0.5 : 1);
          if (cliqueHash(n, i) < p) gang = n.yardCar;
        }
      }
    } else if (preset != null) gang = preset;
    n._baseGang = gang;
    return gang;
  }

  let inited = false;
  function electLeaders() {
    for (let g = 0; g < NCARS(); g++) {
      const pool = CBZ.npcs.filter((n) => n.yardCar === g && alive(n));
      let m = pool.find((n) => n.gang === g && crewRole(n) === "shotcaller") || null;
      if (!m) {
        // no named key holder: the car's most feared ACTIVE man, else its most feared man
        let bs = -Infinity;
        for (const n of pool) {
          if (n.role === "merchant" || n.role === "dealer") continue;
          const s = (n.gang === g ? 1000 : 0) + ((CBZ.npcPower && CBZ.npcPower(n)) || 0);
          if (s > bs) { bs = s; m = n; }
        }
        if (m && m.gang !== g) setClique(m, g);
      }
      if (m) { m.isLeader = true; leaders[g] = m; }
      else leaders[g] = null;
    }
  }
  function initWorld() {
    inited = true;
    const list = CBZ.npcs;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      n.gang = assignClique(n, i);
    }
    electLeaders();
  }
  const leaders = {};
  CBZ.prisonCarLeader = function (car) { const m = leaders[car]; return m && alive(m) ? m : null; };

  function setClique(n, gang) {
    n.gang = gang;
    if (n._band) { if (n._band.parent) n._band.parent.remove(n._band); n._band = null; }
  }

  // ---- ratings (CAPABILITY) + behaviour (TEMPERAMENT), decoupled -------
  const B = CBZ.BEHAVIORS || {};
  const BK = CBZ.BEHAVIOR_KEYS || ["unpredictable"];
  function behaviorOf(n) {
    return (n && B[n.behavior]) || B.unpredictable || { init: 0.14, retaliate: 0.8, fleeHurt: 0.4, picksWeak: 0.3, guts: 0.5, label: "Wildcard", emoji: "" };
  }
  // pick a temperament with light role bias — but capability is rolled
  // separately, so a brute can still be a pacifist and vice-versa.
  function pickBehaviorFor(n) {
    const role = n.role, crew = crewRole(n);
    let pool;
    if (role === "merchant" || role === "dealer") pool = ["pacifist", "pacifist", "defensive", "opportunist"];
    else if (crew === "enforcer") pool = ["defensive", "protector", "predator", "hothead"];
    else if (crew === "collector") pool = ["bully", "opportunist", "hothead", "defensive"];
    else if (crew === "shotcaller") pool = ["protector", "defensive", "predator", "hothead"];
    else if (role === "thief") pool = ["opportunist", "bully", "unpredictable", "pacifist"];
    else pool = BK; // generic inmates: full spread
    return pool[Math.floor(rng() * pool.length)];
  }
  function roll(lo, span) { return lo + Math.floor(rng() * span); }
  function ensureCombatProfile(n) {
    if (n._profileReady) return;
    n._profileReady = true;
    n.ratings = Object.assign({
      fighting:  roll(28, 56),
      toughness: roll(28, 56),
      speed:     roll(30, 52),
      stealth:   roll(20, 62),
      marksman:  roll(12, 46),
      cunning:   roll(24, 58),
    }, n.ratings || {});
    if (!(n.behavior && B[n.behavior])) n.behavior = pickBehaviorFor(n);
    n.record = n.record || { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
    // durability + foot-speed flow from the capability ratings
    n.maxHp = Math.round(58 + n.ratings.toughness * 1.05);
  }

  // rough 0..1 odds that `a` would win a straight brawl with `b`
  function combatPower(a) {
    if (!a) return 100;
    const r = a.ratings;
    const f = r ? r.fighting : (a.kind ? 72 : 50);
    const t = r ? r.toughness : (a.kind ? 78 : 50);
    const hp = a.hp != null ? a.hp : 100;
    return f + t * 0.6 + hp * 0.22 + (a.kind === "warden" ? 30 : a.kind === "guard" ? 18 : 0);
  }
  function fightOdds(a, b) {
    const pa = combatPower(a), pb = combatPower(b);
    return pa / (pa + pb);
  }

  function initActor(n) {
    ensureCombatProfile(n);
    n.hp = n.maxHp || 100;
    n.baseSpeed = n.speed * (0.82 + (n.ratings.speed / 100) * 0.42);
    n.aiState = "wander";
    n.aiTimer = rng() * 2; n.hitCD = 0; n.foe = null; n.fleeT = 0; n.huntPlayer = 0;
    n.personality = Object.assign({
      greed: rng(),
      nerve: rng(),
      loyalty: rng(),
      snitch: rng(),
    }, n.personality || {});
    n.tailT = 0;
    n.tailKind = null;
    n.tailCommitT = 0;
    n.tailSide = rng() < 0.5 ? -1 : 1;
    n.interceptTarget = null;
    n.interceptMode = null;
    n.interceptT = 0;
    n._demand = null;
    clearRumorHuddle(n);
    n.questionedT = 0;
    n.blockRead = null;
    n.playerTrust = 0;
    n.playerFear = 0;
    n.playerGrudge = 0;
  }

  function dist(a, b) {
    return Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
  }
  function alive(a) { return a && !a.dead && !(a.ko > 0) && !a.escaped; }

  function playerDist(n) {
    return Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z);
  }

  // Hot local decisions should not scan the entire prison population. The
  // spatial index is installed later by systems/npcgrid.js; keep a fallback
  // so this module remains load-order tolerant and easy to test headlessly.
  // One scratch array per QUERY SITE, never per concept: nearbyNpcs refills the
  // array it is handed, so a helper that queries while its caller is iterating
  // the same array eats the caller's list mid-loop. _markNear and _crewNear
  // exist because bandNear() is called from inside findBrawlTarget's own
  // _brawlNear loop, and down() sweeps a crew while the fight tick is live.
  const _palNear = [], _foeNear = [], _brawlNear = [], _defendNear = [], _shadowNear = [];
  const _markNear = [], _crewNear = [];
  function nearbyNpcs(n, radius, out) {
    const p = n.group.position;
    if (CBZ.queryNpcsNear) return CBZ.queryNpcsNear(p.x, p.z, radius, out);
    out.length = 0;
    for (let i = 0; i < CBZ.npcs.length; i++) out.push(CBZ.npcs[i]);
    return out;
  }

  function gangStanding(gang) {
    const gs = CBZ.game.gangStanding || (CBZ.game.gangStanding = [0, 0]);
    return gang >= 0 ? (gs[gang] || 0) : 0;
  }

  function addGangStanding(gang, amount) {
    if (gang < 0) return;
    const gs = CBZ.game.gangStanding || (CBZ.game.gangStanding = [0, 0]);
    gs[gang] = Math.max(-100, Math.min(100, (gs[gang] || 0) + amount));
  }

  function gangDebt(gang) {
    const debt = CBZ.game.gangDebt || (CBZ.game.gangDebt = [0, 0]);
    return gang >= 0 ? (debt[gang] || 0) : 0;
  }

  function addGangDebt(gang, amount) {
    if (gang < 0) return 0;
    const debt = CBZ.game.gangDebt || (CBZ.game.gangDebt = [0, 0]);
    debt[gang] = Math.max(0, Math.min(99, (debt[gang] || 0) + amount));
    return debt[gang];
  }

  function gangProtection(gang) {
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    return gang >= 0 ? (gp[gang] || 0) : 0;
  }

  function addGangProtection(gang, seconds) {
    if (gang < 0) return;
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    gp[gang] = Math.max(gp[gang] || 0, seconds || 30);
  }

  function noteGangIncident(actor, kind, severity, opts) {
    opts = opts || {};
    if (!actor || actor.gang == null || actor.gang < 0 || !actor.group) return null;
    const gang = actor.gang;
    severity = Math.max(1, severity || 1);
    const helpful = kind === "help" || kind === "gift" || kind === "trade" || kind === "cover";
    const sameCrew = CBZ.player && CBZ.player.gang === gang;
    const source = opts.source || actorName(actor);
    const standingDelta = helpful
      ? Math.ceil(severity * (sameCrew ? 0.9 : 0.55))
      : -Math.ceil(severity * (sameCrew ? 1.10 : 0.78));
    const debtDelta = helpful ? -Math.ceil(severity * 0.45) : Math.ceil(severity * 0.32);
    if (!opts.skipStanding) addGangStanding(gang, standingDelta);
    if (!opts.skipDebt && debtDelta) addGangDebt(gang, debtDelta);
    addBuzz(helpful ? "debt" : "fear", helpful ? -Math.min(8, severity * 0.9) : Math.min(16, severity * 1.2), source);

    let witnesses = 0, responders = 0;
    let beefCheer = null, beefCheerW = 0;
    const rivalTouched = [false, false];
    for (const m of CBZ.npcs || []) {
      if (!alive(m) || m === actor || !m.group || m.role === "merchant") continue;
      const nearActor = Math.hypot(m.group.position.x - actor.group.position.x, m.group.position.z - actor.group.position.z);
      const nearPlayer = CBZ.player ? playerDist(m) : 99;
      if (nearActor > 18 && nearPlayer > 18) continue;

      /* THE ENEMY OF MY ENEMY. The yard already keeps per-pair grudges
         (_beef, below) — this is where they become visible. A man watching
         you put hands on somebody HE has real beef with does not close ranks;
         he approves, crew or not. This is the other half of "they always hate
         you for a punch": WHO you punch matters, because they remember him. */
      if (!helpful) {
        const bw = beefWith(m, actor);
        if (bw >= BEEF_SWING) {
          witnesses++;
          bumpSocial(m, "playerTrust", 0.5 + severity * 0.05, -8, 14);
          bumpSocial(m, "playerGrudge", -(0.6 + severity * 0.05), 0, 14);
          if (nearPlayer < 15 && severity >= 3) {
            emote(m, "+");
            if (bw > beefCheerW) { beefCheer = m; beefCheerW = bw; }
          }
          continue;
        }
      }

      if (m.gang === gang) {
        witnesses++;
        rememberBlockRead(m, helpful ? "debt" : "fear", Math.min(48, 12 + severity * 2.6), source);
        if (helpful) {
          bumpSocial(m, "playerTrust", 0.35 + severity * 0.04, -8, 14);
          bumpSocial(m, "playerGrudge", -0.30, 0, 14);
          if ((m.huntPlayer || 0) > 0 && gangStanding(gang) > -18) m.huntPlayer = Math.max(0, (m.huntPlayer || 0) - 4 - severity * 0.35);
          if (severity >= 4 && nearPlayer < 15) emote(m, "+");
        } else {
          const p = m.personality || {};
          bumpSocial(m, "playerGrudge", 0.55 + severity * 0.06, 0, 14);
          if (severity >= 3) m.grudgeWhy = `what you did to ${actorName(actor)}`;
          bumpSocial(m, "playerFear", Math.min(0.8, severity * 0.04), 0, 14);
          // one of his own who was STANDING THERE may step in; the rest of
          // the set hears about it and remembers (the grudge above)
          const responseChance = Math.min(0.6, 0.08 + severity * 0.03 + (p.loyalty || 0.5) * 0.18 + (p.nerve || 0.5) * 0.14 - (sameCrew ? 0.14 : 0));
          if (!opts.noResponders && responders < 1 && severity >= 5 && nearActor < 10 && nearPlayer < 14 &&
              m.aiState !== "snitch" && m.aiState !== "fight" && rng() < responseChance) {
            if (requestHunt(m, 4 + severity * 0.35, "crew")) { responders++; emote(m, "!"); }
          }
        }
      } else if (!helpful && m.gang >= 0 && m.gang !== gang) {
        rememberBlockRead(m, "fear", Math.min(34, 8 + severity * 1.8), source);
        bumpSocial(m, "playerTrust", Math.min(0.42, severity * 0.035), -8, 14);
        if (!rivalTouched[m.gang] && severity >= 5) {
          rivalTouched[m.gang] = true;
          addGangStanding(m.gang, Math.min(3, Math.ceil(severity * 0.18)));
        }
      }
    }
    // one voice, the man with the deepest grudge — he NAMES who you hit,
    // which is his memory talking, not a bark
    if (beefCheer && rng() < 0.6) {
      say(beefCheer, rng() < 0.5 ? "Had that coming." : `About time somebody did ${actorName(actor)}.`, null, 2.0);
    }

    return { gang, standing: gangStanding(gang), debt: gangDebt(gang), witnesses, responders };
  }

  function blockRumor() {
    const g = CBZ.game || {};
    if (!g.blockRumor) g.blockRumor = { fear: 0, wealth: 0, heat: 0, badge: 0, snitch: 0, debt: 0, last: "" };
    return g.blockRumor;
  }

  function topBuzz() {
    const r = blockRumor();
    let best = "quiet", score = 0;
    for (const k of ["fear", "wealth", "heat", "badge", "snitch", "debt"]) {
      if ((r[k] || 0) > score) { best = k; score = r[k] || 0; }
    }
    return { kind: best, score };
  }

  function addBuzz(kind, amount, source) {
    const r = blockRumor();
    r[kind] = Math.max(0, Math.min(100, (r[kind] || 0) + (amount || 0)));
    r.last = source || kind;
  }

  function bumpSocial(n, key, amount, lo, hi) {
    if (!n) return;
    n[key] = Math.max(lo, Math.min(hi, (n[key] || 0) + amount));
  }

  function rememberBlockRead(n, kind, strength, source) {
    if (!n || !alive(n) || n.role === "merchant" || !kind || kind === "quiet") return;
    const old = n.blockRead;
    const oldScore = old && old.kind === kind ? old.score || 0 : 0;
    const score = Math.max(6, Math.min(100, Math.max(strength || 0, oldScore * 0.65 + (strength || 0) * 0.55)));
    n.blockRead = {
      kind,
      score,
      source: source || kind,
      t: Math.max((old && old.kind === kind ? old.t || 0 : 0), 10 + Math.min(18, score * 0.22)),
    };
  }

  function updateBlockRumors(dt) {
    if (!CBZ.game || CBZ.game.state !== "playing") return;
    const g = CBZ.game;
    const r = blockRumor();
    const ease = 1 - Math.exp(-0.45 * dt);
    const debtTotal = (g.gangDebt && ((g.gangDebt[0] || 0) + (g.gangDebt[1] || 0))) || 0;
    g.lowProfileT = Math.max(0, (g.lowProfileT || 0) - dt);
    g.gossipHuddleT = Math.max(0, (g.gossipHuddleT || 0) - dt);
    const cover = (g.lowProfileT || 0) > 0 ? 34 : 0;
    const target = {
      fear: Math.min(100, (g.kos || 0) * 10 + (g.deaths || 0) * 24),
      wealth: Math.max(0, Math.min(100, ((g.cigs || 0) - 8) * 4 - cover)),
      heat: Math.max(0, Math.min(100, (g.detection || 0) + ((g.witnessReportT || 0) > 0 ? 18 : 0) - cover * 0.18)),
      badge: Math.min(100, ((g.racketProtectionT || 0) > 0 ? 42 : 0) + Math.min(38, (g.racketDebt || 0) * 2)),
      snitch: Math.min(100, (g.snitchReports || 0) * 15 + ((g.lastKnown && g.lastKnown.t > 0) ? 12 : 0)),
      debt: Math.min(100, debtTotal * 4),
    };
    for (const k of Object.keys(target)) {
      r[k] = Math.max(0, (r[k] || 0) + (target[k] - (r[k] || 0)) * ease - dt * 0.18);
    }
  }

  function protectionGang() {
    if (CBZ.player && CBZ.player.gang != null) return CBZ.player.gang;
    const gp = CBZ.game.gangProtection || [];
    let best = null, bv = 0;
    for (let g = 0; g < NCARS(); g++) if ((gp[g] || 0) > bv) { bv = gp[g]; best = g; }
    return best;
  }

  const DELIVERY_TARGETS = [
    { name: "cafeteria kitchen", x: -27.0, z: 19.2, r: 4.2 },
    { name: "armory checkpoint", x: 19.2, z: 1.0, r: 4.0 },
    { name: "staff lounge door", x: 19.2, z: 37.0, r: 4.0 },
    { name: "drain service grate", x: -25.5, z: 25.3, r: 4.0 },
  ];

  function makeGangJob(n) {
    const gang = n.gang;
    const rival = rivalCar(gang);
    const debt = gangDebt(gang);
    const role = crewRole(n);
    let roll = rng();
    if (role === "enforcer" || role === "collector") roll = Math.min(roll, 0.30);
    else if (role === "runner") roll = 0.46 + rng() * 0.20;
    else if (role === "lookout") roll = 0.82 + rng() * 0.16;
    if (roll < 0.38) {
      return {
        type: "rivalTurf",
        gang, rival,
        label: "Hold rival turf",
        targetName: `${gangName(rival)} turf`,
        t: 58,
        progress: 0,
        need: 8,
        reward: 7 + Math.floor(rng() * 5),
        standing: 14,
        debtDrop: 7 + Math.min(7, debt),
      };
    }
    if (roll < 0.74) {
      const target = DELIVERY_TARGETS[Math.floor(rng() * DELIVERY_TARGETS.length)];
      return {
        type: "delivery",
        gang, rival,
        label: "Run package",
        targetName: target.name,
        targetX: target.x,
        targetZ: target.z,
        targetR: target.r,
        t: 64,
        progress: 0,
        need: 1,
        reward: 6 + Math.floor(rng() * 6),
        standing: 11,
        debtDrop: 6 + Math.min(6, debt),
      };
    }
    return {
      type: "lookoutShift",
      gang, rival,
      label: "Work lookout",
      targetName: `${gangName(gang)} turf`,
      t: 52,
      progress: 0,
      need: 18,
      reward: 5 + Math.floor(rng() * 5),
      standing: 9,
      debtDrop: 5 + Math.min(5, debt),
    };
  }

  function jobObjective(job) {
    if (!job) return "";
    if (job.type === "rivalTurf") return `Hold ${job.targetName}: ${Math.ceil(job.need - job.progress)}s`;
    if (job.type === "delivery") return `Package to the ${job.targetName}`;
    if (job.type === "lookoutShift") return `Watch ${job.targetName}`;
    return job.label || "Gang job";
  }

  function jobPitch(job) {
    if (!job) return "Got work if you want it.";
    if (job.type === "rivalTurf") return `Stand on ${job.targetName} for us.`;
    if (job.type === "delivery") return `Package for the ${job.targetName}.`;
    if (job.type === "lookoutShift") return `Watch ${job.targetName} for us.`;
    return "Got work if you want it.";
  }

  function startGangJob(job, actor) {
    if (!job || job.gang < 0) return { ok: false, msg: "" };
    job.t = job.t || 45;
    job.progress = 0;
    job.source = actor && actor.data ? actor.data.name.replace(/^the |^a |^an /, "") : gangName(job.gang);
    // WHO GAVE YOU THE JOB IS WHO PAYS YOU FOR IT. Keeping the actor (not just
    // their name) is what lets completeGangJob/failGangJob put the payout and
    // the blame in a real mouth instead of a HUD line.
    job.actor = actor || null;
    CBZ.game.gangJob = job;
    if (actor) {
      actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + 1);
      if (actor.gang >= 0) addGangStanding(actor.gang, 2);
    }
    CBZ.setObjective && CBZ.setObjective(jobObjective(job));
    // The handoff is the giver's words. The objective readout above carries the
    // mechanics; nobody in a prison says "job accepted".
    const sendoff = job.type === "delivery" ? `${job.targetName}. Walk, don't run.`
      : job.type === "rivalTurf" ? `${job.targetName}. Don't move.`
      : job.type === "lookoutShift" ? `${job.targetName}. Whistle if a CO comes.`
      : "Go.";
    return { ok: true, msg: sendoff };
  }

  // THE MOUTH A JOB SPEAKS THROUGH. The man who gave it to you if he is alive
  // and in earshot; otherwise the nearest member of the same crew, because a
  // crew paying you out is the crew's business and any of them can say it. Null
  // when nobody from that crew is anywhere near — and then the payout is silent
  // rather than shouted from across the yard, which is the whole point.
  function jobVoice(job) {
    if (!job) return null;
    const a = job.actor;
    if (a && alive(a) && playerDist(a) < 16) return a;
    let best = null, bd = 16;
    for (const n of CBZ.npcs) {
      if (!alive(n) || n.gang !== job.gang) continue;
      const d = playerDist(n);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  function completeGangJob(job) {
    if (!job) return;
    CBZ.econ.addCigs(job.reward || 4);
    addGangStanding(job.gang, job.standing || 8);
    addGangDebt(job.gang, -Math.max(3, job.debtDrop || 4));
    addGangProtection(job.gang, 22 + Math.max(0, job.standing || 0));
    if (job.rival != null) addGangStanding(job.rival, -3);
    CBZ.sfx && CBZ.sfx("coin");
    // THE PAYER IS A PERSON. `job.actor` is whoever handed the job over
    // (startGangJob records it) — they pay you, out loud, in front of you.
    { const jv = jobVoice(job); if (jv) say(jv, `${job.reward || 4}. Good work.`, null, 2.0); }
    CBZ.setObjective && CBZ.setObjective("");
    CBZ.game.gangJob = null;
  }

  function failGangJob(job, reason) {
    if (!job) return;
    addGangStanding(job.gang, -7);
    addGangDebt(job.gang, 3);
    const jv = jobVoice(job);
    if (jv) say(jv, "You blew it.", null, 2.0);
    CBZ.setObjective && CBZ.setObjective("");
    CBZ.game.gangJob = null;
  }

  /* WORK FOR THE CREW is a verb on one of them (interact.js "work"): your
     own crew, or one that thinks well enough of you to trust you with it.
     Nobody walks up and offers it. */
  function canCrewWork(n) {
    if (!alive(n) || !(n.gang >= 0) || CBZ.game.gangJob || CBZ.game.role === "cop") return false;
    if (n.role === "merchant" || n.role === "dealer" || (n.playerGrudge || 0) >= 5) return false;
    return CBZ.player.gang === n.gang || gangStanding(n.gang) >= 30;
  }
  function crewWork(n) {
    if (!canCrewWork(n)) return { ok: false, msg: "" };
    const job = makeGangJob(n);
    const res = startGangJob(job, n);
    return res && res.ok ? { ok: true, msg: jobPitch(job) } : res;
  }

  function updateGangJob(dt) {

    const job = CBZ.game && CBZ.game.gangJob;
    if (!job) return;
    if (CBZ.player.dead || (CBZ.player.ko || 0) > 0) { failGangJob(job, "downed"); return; }
    job.t -= dt;

    if (job.t <= 0) { failGangJob(job, "time"); return; }
    const heat = CBZ.game.detection || 0;
    pulseGangJobSocial(job, dt);
    if (job.type === "rivalTurf") {
      if (isOnTurf(job.rival, CBZ.player.pos)) {
        job.progress += dt;
        if (!job.rivalWarned && job.progress > 2.0) {
          const rival = CBZ.npcs.find((m) => m.gang === job.rival && alive(m) && playerDist(m) < 18);
          if (rival) {
            job.rivalWarned = true;
            provokeGang(rival, 4.5, { crew: 1, why: "turf" });
            say(rival, "Wrong side of the yard.", null, 1.8);
          }
        }
        // NO COUNTDOWN CAPTION. A repeating "18s left" line is the purest
        // form of the thing being deleted here — it is a timer read aloud, it
        // has no mouth, and systems/markers.js already draws the job marker.
        // The clock lives on the Ranks board's STANDING page now.
        job.ping = 0;
      }
      job.ping = Math.max(0, (job.ping || 0) - dt);
      if (job.progress >= job.need) completeGangJob(job);
      return;
    }
    if (job.type === "delivery") {
      const dx = CBZ.player.pos.x - job.targetX;
      const dz = CBZ.player.pos.z - job.targetZ;
      if (dx * dx + dz * dz < (job.targetR || 4) * (job.targetR || 4)) completeGangJob(job);
      return;
    }
    if (job.type === "lookoutShift") {
      if (heat > 72) { failGangJob(job, "heat"); return; }
      if (isOnTurf(job.gang, CBZ.player.pos) && heat < 58) {
        job.progress += dt;
        if (job.progress >= job.need) completeGangJob(job);
      }
    }
  }

  function pulseGangJobSocial(job, dt) {
    if (!job || CBZ.game.role === "cop") return;
    job.socialPulse = (job.socialPulse || 0) - dt;
    if (job.socialPulse > 0) return;
    job.socialPulse = 4.2 + rng() * 2.4;

    // one of his own walks with you while you do it; the other side answers
    // on its own ground (updateGangJob: a rival on his turf)
    let ally = null, allyScore = Infinity;
    for (const n of CBZ.npcs) {
      if (!alive(n) || n.role === "merchant" || n.aiState === "fight" || n.aiState === "snitch") continue;
      const d = playerDist(n);
      if (n.gang === job.gang && d < 16) {
        const p = n.personality || {};
        const score = d - (p.loyalty || 0.5) * 5 - gangStanding(job.gang) * 0.03;
        if (score < allyScore) { allyScore = score; ally = n; }
      }
    }

    if (ally && rng() < 0.72) {
      ally.aiState = "shadowPlayer";
      ally.shadowT = Math.max(ally.shadowT || 0, 6 + rng() * 4);
      ally.foe = null;
      emote(ally, "+");
      if (!job.allyHinted && playerDist(ally) < 14) {
        job.allyHinted = true;
        say(ally, "Go on. I got you.", null, 1.8);
      }
    }

  }

  /* The one line he gets to say as you walk — about THIS deal, once. A man
     repeats himself to nobody: the second walk-away gets a stare. */

  /* Coming back to a standing offer: the SAME deal at the SAME price, in
     words that show he remembers asking — never a fresh roll of the dice. */

  /* ============================================================
     SQUASHING A GRUDGE. The prison already remembers every wrong
     (playerGrudge, and now grudgeWhy — the specific thing he's sore about);
     what it lacked was any way to BUY peace. You could out-wait a grudge or
     out-punch it, but "give him something and make it right" — the most
     ordinary social move in any yard — did not exist. The verb appears on
     his card only while he is actually carrying something (interact.js gates
     it), the price scales with how much, and his answer names the wrong he's
     letting go — which is his memory talking. */
  function squashGrudgeCost(n) {
    return Math.max(2, Math.ceil(((n && n.playerGrudge) || 0) * 0.8));
  }
  function squashGrudge(n) {
    if (!n || !n.data) return { ok: false, msg: "" };
    const who = n.data.name.replace(/^the |^a |^an /, "");
    if ((n.playerGrudge || 0) < 3) return { ok: false, msg: "We're good." };
    if (n.aiState === "fight" && n.foe === CBZ.player) return { ok: false, msg: "" };
    const cost = squashGrudgeCost(n);
    if ((CBZ.game.cigs || 0) < cost) return { ok: false, msg: `${cost}. You don't have it.` };
    CBZ.econ.addCigs(-cost);
    const why = n.grudgeWhy;
    n.playerGrudge = 0;
    n.grudgeWhy = null;
    n.huntPlayer = 0;
    n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
    if (n.gang >= 0) addGangStanding(n.gang, 2);
    CBZ.sfx && CBZ.sfx("coin");
    say(n, "Alright. We're square.", null, 2.2);
    return { ok: true, msg: "" };   // he said it himself; the card adds nothing
  }

  function isOnTurf(gang, p) {
    const t = turfOf(gang);
    if (!t || !p) return false;
    return Math.hypot(p.x - t.x, p.z - t.z) < t.r + 2;
  }

  function actorName(a) {
    return a && a.data ? a.data.name.replace(/^the |^a |^an /, "") : "Someone";
  }

  function crewRole(n) {
    return (n && (n.crewRole || (n.data && n.data.crewRole))) || "";
  }
  // who of a crew steps up for which job: the enforcer stands beside you, the
  // collector collects, the lookout hears things first
  function crewRoleScore(n, kind) {
    const r = crewRole(n);
    if (!r || !kind) return 0;
    if (kind === "crewBackup") return r === "enforcer" ? 4.7 : r === "shotcaller" ? 2.4 : r === "lookout" ? 1.8 : 0;
    if (kind === "debtCollect" || kind === "debt") return r === "collector" ? 5.6 : r === "enforcer" ? 2.8 : r === "shotcaller" ? 1.4 : 0;
    if (kind === "snitch" || kind === "heat") return r === "lookout" ? 2.4 : 0;
    if (kind === "fear") return r === "enforcer" ? 2.8 : 0;
    return 0;
  }

  function knownSnitchCost(n) {
    const g = CBZ.game || {};
    const p = (n && n.personality) || {};
    const amount = (n && n.reportedPlayerAmount) || 12;
    const cred = (n && n.reportedPlayerCred != null) ? n.reportedPlayerCred : 0.65;
    return Math.max(2, Math.min(18,
      Math.ceil(amount / 7) +
      Math.floor((g.detection || 0) / 28) +
      Math.floor((p.greed || 0.5) * 5) +
      Math.floor(cred * 4)
    ));
  }

  function markPlayerReported(n, amount, meta, guard, lead) {
    if (!n) return;
    meta = meta || {};
    const lastKnown = (lead || meta.lastKnown || {});
    const p = n.personality || {};
    const heard = !!(lastKnown.heardOnly || meta.heardOnly);
    let credibility = meta.credibility != null ? meta.credibility : (heard ? 0.42 : 0.68);
    credibility += (p.snitch || 0.5) * 0.18 + (p.nerve || 0.5) * 0.12;
    credibility += Math.min(0.16, Math.max(0, n.playerGrudge || 0) * 0.018);
    credibility -= Math.min(0.14, Math.max(0, n.playerTrust || 0) * 0.014);
    credibility -= Math.min(0.12, Math.max(0, n.playerFear || 0) * 0.012);
    if (meta.forceSnitch) credibility += 0.08;
    if (meta.copCrime) credibility += 0.05;
    credibility = Math.max(0.18, Math.min(0.98, credibility));
    n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, meta.copCrime ? 36 : 46);
    n.reportedPlayerAmount = amount || 12;
    n.reportedPlayerCop = !!meta.copCrime;
    n.reportedPlayerKind = meta.copCrime ? "complaint" : (meta.heardOnly ? "noise report" : "witness report");
    n.reportedPlayerGuard = guard && guard.data ? actorName(guard) : (guard && guard.corrupt ? "a bent guard" : "a guard");
    n.reportedPlayerCred = Math.max(n.reportedPlayerCred || 0, credibility);
    n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
    n.reportedPlayerLastKnown = {
      x: lastKnown.x != null ? lastKnown.x : CBZ.player.pos.x,
      z: lastKnown.z != null ? lastKnown.z : CBZ.player.pos.z,
      type: lastKnown.type || meta.type || "crime",
      heardOnly: heard,
    };
    n.reportedPlayerCount = (n.reportedPlayerCount || 0) + 1;
    n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
    // KNOWING WHO RATTED IS A FACT YOU HAVE TO ACQUIRE — see learnSnitch.
    if (sawItHappen(n)) learnSnitch(n, "seen");
    spreadReportGossip(n, amount || 12, meta);
  }

  /* ==========================================================================
     WHO RATTED IS A FACT, NOT A HUD CHIP (JAIL_SNITCH_KNOWLEDGE).

     OWNER: "Improve that logic, connect it all, and make it real logic."

     This was the one genuine STAT FICTION behind the deleted #gangHud strip, by
     CLAUDE.md's own definition. A bent guard sells you `snitchIntel` for cigs
     and the entire effect was `g.snitchIntelT = 30` — a number read by NOTHING
     except the chip that printed "Snitch named 30s" and the tick that counted it
     down. Meanwhile systems/interact.js offered Confront / Pay silence /
     Threaten on ANY actor with `reportedPlayerT > 0`, so the player already had
     every snitch verb on every reporter for free. You were paying a corrupt
     screw for information the HUD had given you at no charge.

     Both halves are wrong and they fix each other. The verbs now need
     `n.snitchKnown`, and there are three honest ways to get it:
       SEEN  — you were close enough to watch them walk up to a screw and talk.
               That is how you learn it in a real yard, and it is free.
       PAID  — the bent guard's name-drop (entities/guards.js), which is now
               worth cigs precisely because SEEN is the only alternative.
       TOLD  — an ally who witnessed it passes the name to you.
     A snitch you have not made is just another inmate, which is what makes the
     paranoia real: the block is full of people who might have done it.

     Flag false → knowledge is universal and the verbs behave exactly as they
     shipped, so the whole gate is a one-line revert.
     ========================================================================== */
  if (CBZ.CONFIG.JAIL_SNITCH_KNOWLEDGE == null) CBZ.CONFIG.JAIL_SNITCH_KNOWLEDGE = true;
  let snitchLearned = 0;
  // could the player have WATCHED this happen? Close enough to make out who,
  // and not blind (dead / mid-blackout). Deliberately generous on angle — you
  // do not have to be staring at them, you have to be there.
  function sawItHappen(n) {
    if (!n || !CBZ.player || CBZ.player.dead) return false;
    if (CBZ.player.captureState && CBZ.player.captureState !== "normal") return false;
    return playerDist(n) < 20;
  }
  /* WHERE A RAT SAYS HE SAW YOU. A witness report has always carried a real
     `lastKnown` coordinate — guards investigate it, systems/detection.js's
     Searching state is built on it — and that coordinate has never been spoken
     by anybody. Turning it into a PLACE NAME is what makes an overheard report
     actionable: "try the laundry" tells you which way the sweep is about to
     go, and it is information you could not have had any other way. The list is
     the prison's own named ground (world/yard.js, world/cellblock.js,
     world/gunroom.js, systems/detection.js's restricted zones); anything that
     matches nothing is simply "yard", which is where most of this world is. */
  const LANDMARKS = [
    { name: "armory door", x: 19, z: 1, r: 16 },
    { name: "staff lounge", x: 24, z: 37, r: 14 },
    { name: "exit corridor", x: 0, z: 52, r: 20 },
    { name: "cell block", x: 0, z: -28, r: 22 },
    { name: "yard gate", x: 0, z: -8, r: 10 },
  ];
  // each car's spot is a named place too ("where the Paisas stand")
  function carLandmarks() {
    const P = PCARS();
    if (!P || LANDMARKS._cars) return;
    LANDMARKS._cars = true;
    for (let i = 0; i < P.N; i++) { const Y = P.CARS[i].yard; LANDMARKS.push({ name: "car:" + i, x: Y.x, z: Y.z, r: Y.r + 2 }); }
  }
  function nearestLandmark(x, z) {
    if (!(isFinite(x) && isFinite(z))) return null;
    carLandmarks();
    let best = null, bd = Infinity;
    for (let i = 0; i < LANDMARKS.length; i++) {
      const L = LANDMARKS[i], d = Math.hypot(x - L.x, z - L.z);
      if (d < L.r && d < bd) { bd = d; best = L.name; }
    }
    return best || "yard";
  }
  CBZ.jailLandmark = nearestLandmark;

  function learnSnitch(n, how) {
    if (!n || n.snitchKnown) return false;
    n.snitchKnown = how || "seen";
    snitchLearned++;
    return true;
  }
  // THE ONE ANSWER to "does the player know this person reported him". Every
  // consumer asks here; nobody re-derives it. Degrade-safe and flag-reverted.
  CBZ.playerKnowsSnitch = function (n) {
    if (!n || !((n.reportedPlayerT || 0) > 0)) return false;
    if (CBZ.CONFIG.JAIL_SNITCH_KNOWLEDGE === false) return true;
    return !!n.snitchKnown;
  };
  CBZ.learnSnitch = learnSnitch;
  /* RATCHET: `known` must never exceed `reported` (you cannot know about a
     report that never happened), and `gated` — reporters you have NOT made — is
     the whole point of the mechanic: it may only ever be > 0 in a world where
     the player has not seen everything. */
  CBZ.snitchKnowledgeAudit = function () {
    let reported = 0, known = 0;
    for (const n of CBZ.npcs || []) {
      if (!((n.reportedPlayerT || 0) > 0)) continue;
      reported++;
      if (n.snitchKnown) known++;
    }
    return { on: CBZ.CONFIG.JAIL_SNITCH_KNOWLEDGE !== false, reported: reported,
      known: known, gated: reported - known, learned: snitchLearned };
  };

  function spreadReportGossip(reporter, amount, meta) {
    if (!reporter || !reporter.group || !CBZ.npcs) return 0;
    meta = meta || {};
    const source = actorName(reporter);
    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const reportGang = reporter.gang != null ? reporter.gang : -1;
    const cred = reporter.reportedPlayerCred != null ? reporter.reportedPlayerCred : (meta.heardOnly ? 0.45 : 0.68);
    const kind = meta.copCrime ? "badge" : "snitch";
    const base = Math.max(10, Math.min(62, (amount || 12) * 0.72 + cred * 18 + (meta.heardOnly ? -4 : 5)));
    let listeners = 0;

    addBuzz(kind, Math.min(13, 3 + base * 0.13), source);
    if (!meta.copCrime) addBuzz("heat", Math.min(8, 2 + (amount || 12) * 0.08), source);
    if (playerGang != null && reportGang === playerGang) addGangStanding(reportGang, -3);
    else if (playerGang != null && reportGang >= 0 && reportGang !== playerGang) addGangStanding(reportGang, 1);

    for (const m of CBZ.npcs) {
      if (m === reporter || !alive(m) || !m.group || !m.data || m.role === "merchant") continue;
      const d = Math.hypot(m.group.position.x - reporter.group.position.x, m.group.position.z - reporter.group.position.z);
      if (d > 18) continue;
      const falloff = 1 - d / 24;
      const strength = base * falloff;
      if (strength < 8) continue;
      listeners++;
      rememberBlockRead(m, kind, strength, source);

      const samePlayerCrew = playerGang != null && m.gang === playerGang;
      const sameReporterCrew = reportGang >= 0 && m.gang === reportGang;
      const rivalReporter = reportGang >= 0 && m.gang >= 0 && m.gang !== reportGang;
      if (samePlayerCrew || (m.gang >= 0 && gangProtection(m.gang) > 0) || gangStanding(m.gang) > 24) {
        bumpSocial(m, "playerTrust", 0.18 + strength * 0.006, -8, 14);
      } else if (sameReporterCrew && (playerGang == null || playerGang !== reportGang)) {
        bumpSocial(m, "playerGrudge", 0.22 + strength * 0.005, 0, 14);
      } else if (rivalReporter) {
        bumpSocial(m, "playerTrust", 0.12 + strength * 0.004, -8, 14);
      }
    }

    reporter.reportedPlayerSpread = Math.max(reporter.reportedPlayerSpread || 0, listeners);
    return listeners;
  }

  function clearKnownReport(n) {
    if (!n) return;
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure((n.reportedPlayerAmount || 8) + 4, actorName(n));
    n.reportedPlayerT = 0;
    n.reportedPlayerAmount = 0;
    n.reportedPlayerCop = false;
    n.reportedPlayerKind = null;
    n.reportedPlayerGuard = null;
    n.reportedPlayerCred = 0;
    n.reportedPlayerDoubt = 0;
    n.reportedPlayerLastKnown = null;
    n.reportedPlayerSpread = 0;
  }

  function findKnownReporter(except) {
    let best = null, bs = -Infinity;
    for (const m of CBZ.npcs || []) {
      if (m === except || !alive(m) || !(m.reportedPlayerT > 0) || !m.data) continue;
      const amount = m.reportedPlayerAmount || 12;
      const fresh = m.reportedPlayerT || 0;
      const cred = m.reportedPlayerCred == null ? 0.65 : m.reportedPlayerCred;
      const d = Math.hypot(CBZ.player.pos.x - m.group.position.x, CBZ.player.pos.z - m.group.position.z);
      const score = fresh * 0.45 + amount * 0.8 + cred * 6 - d * 0.08 + (m.reportedPlayerCop ? 4 : 0);
      if (score > bs) { bs = score; best = m; }
    }
    return best;
  }

  function caseLead() {
    const s = CBZ.caseSummary && CBZ.caseSummary();
    return s && s.heat > 8 ? s : null;
  }

  function caseSources(limit) {
    if (CBZ.caseSources) return CBZ.caseSources(limit || 4) || [];
    const c = caseLead();
    return c && c.reports ? c.reports.slice(0, limit || 4) : [];
  }

  function casePressureProfile() {
    const summary = caseLead();
    const reports = caseSources(4);
    const top = reports[0] || summary || null;
    let solid = 0, weak = 0, named = 0, corrupt = 0;
    for (const r of reports) {
      if (!r) continue;
      if (r.weak || (r.credibility || 0) < 0.52 || r.heardOnly) weak++;
      else solid++;
      if (r.source && r.source !== "witness") named++;
      if (r.corrupt) corrupt++;
    }
    const heat = summary ? (summary.heat || 0) : 0;
    const credibility = top && top.credibility != null ? top.credibility : (summary && summary.credibility != null ? summary.credibility : 0);
    return {
      summary,
      reports,
      top,
      heat,
      count: reports.length,
      named,
      solid,
      weak,
      corrupt,
      credibility,
      active: !!summary && (heat > 8 || reports.length > 0),
      score: heat + solid * 9 + named * 4 + Math.max(0, credibility - 0.5) * 12 - weak * 2,
    };
  }

  /* A MAN WHO SAW IT DOES WHAT A WITNESS DOES: he goes to the screws (or his
     crew turns him round, tryGangInterceptSnitch). He does not walk up and
     sell you his silence. */
  function npcWitnessCrime(n, amount, meta) {
    if (!alive(n) || n.role === "merchant" || n.role === "dealer" || n.aiState === "snitch") return false;
    meta = meta || {};
    n.memory = {
      type: meta.copCrime ? "copCrime" : "crime",
      amount: amount || 12,
      t: meta.heardOnly ? 12 : 22,
      kind: (meta.heardOnly ? "heard:" : "") + (meta.type || "trouble"),
      lastKnown: meta.lastKnown || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: meta.type || "crime", heardOnly: !!meta.heardOnly },
    };
    return sendNpcToSnitch(n, amount, { copCrime: meta.copCrime, lastKnown: n.memory.lastKnown, type: meta.type, heardOnly: meta.heardOnly });
  }

  /* ONE LINE FOR A CONSOLE: is the yard a mob or a set of people? */
  CBZ.prisonSocialAudit = function () {
    const cl = { neutral: 0 }, cars = {};
    let wanting = 0;
    for (const n of CBZ.npcs || []) {
      if (!n || n.dead || n.escaped || n.role === "merchant") continue;
      if (n.gang >= 0) cl[n.gang] = (cl[n.gang] || 0) + 1; else cl.neutral++;
      if (n.yardCar >= 0) cars[n.yardCar] = (cars[n.yardCar] || 0) + 1;
      if ((n.huntPlayer || 0) > 0) wanting++;
    }
    const g = CBZ.game || {};
    return {
      cliques: cl, cars, carClaim: g.carClaim || null, playerCar: playerCar(),
      hunters: huntersNow(), wantHunt: wanting, cap: huntCap(),
      maxHuntersSeen: _maxHuntersSeen, huntStarts: _huntStarts, huntRefused: _huntRefused,
      demands: g.demands || 0,
      standing: (g.gangStanding || [0, 0]).slice(), debt: (g.gangDebt || [0, 0]).slice(),
    };
  };
  /* The warden deal's slow leak lived here (rollWardenDeal). Telling, and
     the yard finding out, is systems/prisonsnitch.js now. */
  CBZ.cliqueName = function (id) { const P = PCARS(); return P && id >= 0 && id < P.N ? P.label(id) : "nobody"; };
  CBZ.requestInmateHunt = requestHunt;

  function canTailPlayer(n) {
    if (!alive(n) || n.role === "merchant" || !n.group || !n.data) return false;
    if (n._demand || n.huntPlayer > 0) return false;
    if (n.aiState === "fight" || n.aiState === "snitch" || n.aiState === "tailPlayer" || n.aiState === "demandPlayer" ||
      n.aiState === "interceptThreat" || n.aiState === "rumorHuddle" || n.aiState === "diversion" || n.aiState === "escape") return false;
    const d = playerDist(n);
    return d >= 5.2 && d <= 19.5;
  }

  function startTailPlayer(n, kind, seconds, score) {
    if (!canTailPlayer(n)) return false;
    n.aiState = "tailPlayer";
    n.tailKind = kind || "watch";
    n.tailT = seconds || (8 + rng() * 6);
    n.tailCommitT = n.tailT * (0.38 + rng() * 0.20);
    n.tailSide = rng() < 0.5 ? -1 : 1;
    n.tailScore = score || 0;
    n.foe = null;
    n.social = null;
    n.pause = 0;
    emote(n, kind === "fear" ? "!" : "");
    return true;
  }

  function tailCandidate(n) {
    if (!canTailPlayer(n)) return null;
    /* WHAT HE IS WATCHING YOU FOR, and only what is really going on: the
       screws are looking for you (his crew keeps close; a man with a reason
       to talk follows you to see where you go), or you are carrying a gun. */
    const g = CBZ.game || {};
    if (g.role === "cop") return null;
    const d = playerDist(n);
    const p = n.personality || {};
    const heat = g.detection || 0;
    const cprof = casePressureProfile();
    const caseHeat = cprof.heat;
    const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || heat > 24 || caseHeat > 12;
    const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const buzzState = blockRumor();
    const buzz = topBuzz();
    const nearScore = Math.max(0, 17 - d) * 0.22;
    const repeatCut = g.watcherLast && n.data && g.watcherLast === n.data.name ? -4 : 0;
    const options = [];
    function add(kind, score) {
      options.push({ n, kind, score: score + nearScore + repeatCut });
    }

    {
      const helpful = sameGang || protectedHere || standing > 24 || (n.playerTrust || 0) > 4 || (n.playerFear || 0) > 5;
      const hatesYou = rivalGang || standing < -18 || (n.playerGrudge || 0) > 8;
      if (searchHeat && helpful && !hatesYou && n.role !== "dealer") {
        add("cover", 13 + Math.max(0, standing) * 0.08 + (n.playerTrust || 0) * 0.45 + (n.playerFear || 0) * 0.28 + (p.loyalty || 0.5) * 7 + Math.min(7, cprof.score * 0.07));
      }
      if (searchHeat && !helpful && (p.snitch > 0.44 || rivalGang || (n.playerGrudge || 0) > 4)) {
        add("snitch", 12 + p.snitch * 10 + (rivalGang ? 4 : 0) + Math.max(0, n.playerGrudge || 0) * 0.45 + Math.max(heat, caseHeat) * 0.06 + cprof.solid * 2 + cprof.named * 1.5);
      }

      if (CBZ.playerArmed && CBZ.playerArmed() && d < 12 && p.nerve < 0.62 && buzz.kind === "fear") {
        add("fear", 8 + (1 - (p.nerve || 0.5)) * 8 + Math.min(8, (buzzState.fear || 0) * 0.09));
      }
    }

    options.sort((a, b) => b.score - a.score);
    return options[0] || null;
  }

  function updateWatcherDirector(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    g.watcherDirectorT = Math.max(0, (g.watcherDirectorT || 0) - dt);
    if (g.watcherDirectorT > 0) return;
    g.watcherDirectorT = 5 + rng() * 5;

    let active = 0;
    for (const n of CBZ.npcs || []) if (n.aiState === "tailPlayer" && alive(n)) active++;
    if (active >= 2) return;

    let best = null;
    for (const n of CBZ.npcs || []) {
      const c = tailCandidate(n);
      if (c && (!best || c.score > best.score)) best = c;
    }
    if (!best || best.score < 11.5) return;
    if (startTailPlayer(best.n, best.kind, 8 + Math.min(8, best.score * 0.25), best.score)) {
      g.watcherLast = best.n.data && best.n.data.name;
      if (best.kind === "snitch") addBuzz("snitch", 2, actorName(best.n));

    }
  }

  function nearestGuard(n) {
    let best = null, bd = Infinity;
    for (const g of CBZ.guards) {
      if (!alive(g)) continue;
      const d2 = Math.pow(g.group.position.x - n.group.position.x, 2) + Math.pow(g.group.position.z - n.group.position.z, 2);
      if (d2 < bd) { bd = d2; best = g; }
    }
    return best;
  }

  // everyone who can be a combatant
  function actors() {
    const list = [];
    for (const n of CBZ.npcs) list.push(n);
    for (const g of CBZ.guards) {
      if (g.hp == null) {
        const warden = g.kind === "warden";
        g.hp = warden ? 200 : 150; g.maxHp = g.hp; g.baseSpeed = g.speed;
        g.ratings = g.ratings || {
          fighting: warden ? 88 : roll(58, 26), toughness: warden ? 90 : roll(60, 24),
          speed: roll(40, 28), stealth: roll(20, 26), marksman: warden ? 82 : roll(50, 34), cunning: warden ? 80 : roll(45, 30),
        };
        g.behavior = g.behavior || (warden ? "predator" : "defensive");
        g.record = g.record || { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
      }
      list.push(g);
    }
    return list;
  }

  // nearest non-hostile inmate to chat with
  // "is this man shut in his cell right now" — world/cellblock.js's own answer.
  // A pal, a turf run or a break for the wire are all things a HELD man cannot
  // walk to: aiming him at them put him on the bars for as long as the pal
  // stood near (measured: an upper-tier resident "socialising" for a full
  // minute with a friend four metres below him, sitting down and standing up
  // every frame). He keeps to his room until the leaf opens.
  function heldInCell(n) {
    const cb = CBZ.cellblock;
    return !!(cb && cb.held && cb.held(n));
  }
  function findPal(n) {
    let best = null, bd = 9 * 9;
    for (const a of nearbyNpcs(n, 9, _palNear)) {
      if (a === n || !alive(a)) continue;
      if (a.gang >= 0 && n.gang >= 0 && a.gang !== n.gang) continue; // rivals don't mingle
      if (heldInCell(a)) continue;             // a man behind a shut leaf is nobody's company
      const dx = a.group.position.x - n.group.position.x, dz = a.group.position.z - n.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  function copyMemory(from, to) {
    if (!from.memory || from.memory.t <= 2 || to.memory || !alive(to)) return false;
    const amount = Math.max(6, (from.memory.amount || 12) * 0.65);
    to.memory = {
      type: from.memory.type,
      amount,
      t: Math.min(18, from.memory.t * 0.72),
      kind: "gossip:" + (from.memory.kind || "trouble"),
      lastKnown: from.memory.lastKnown,
    };
    return true;
  }

  function shareBlockBuzz(a, b) {
    const buzz = topBuzz();
    if (buzz.score < 18 || rng() > 0.48) return false;
    const listeners = [a, b].filter((m) => alive(m));
    for (const m of listeners) {
      rememberBlockRead(m, buzz.kind, buzz.score, "gossip");
      if (buzz.kind === "fear") m.playerFear = Math.min(14, (m.playerFear || 0) + 0.35);
      if (buzz.kind === "wealth" && ((m.personality && m.personality.greed) || 0) > 0.45) m.playerGrudge = Math.min(14, (m.playerGrudge || 0) + 0.25);
      if (buzz.kind === "badge" && m.gang >= 0) addGangStanding(m.gang, -0.35);
    }
    if (buzz.score > 32 && rng() < 0.42) startRumorHuddle(a, b, buzz);
    return true;
  }

  function canRumorHuddle(n) {
    return alive(n) && !n._demand && n.aiState !== "fight" && n.aiState !== "snitch" && n.aiState !== "tailPlayer" &&
      n.aiState !== "demandPlayer" && n.aiState !== "interceptThreat"
 && n.aiState !== "diversion" && n.aiState !== "escape" && !(n.huntPlayer > 0);
  }

  function startRumorHuddle(a, b, buzz) {
    const g = CBZ.game || {};
    if (!a || !b || a === b || !buzz || !canRumorHuddle(a) || !canRumorHuddle(b)) return false;
    if (g.gossipHuddleT > 0) return false;
    g.gossipHuddleT = 4.2;
    const lead = (crewRoleScore(a, buzz.kind) + ((a.personality && a.personality.nerve) || 0.5)) >=
      (crewRoleScore(b, buzz.kind) + ((b.personality && b.personality.nerve) || 0.5)) ? a : b;
    const echo = lead === a ? b : a;
    for (const n of [lead, echo]) {
      n.aiState = "rumorHuddle";
      n.huddlePartner = n === lead ? echo : lead;
      n.huddleKind = buzz.kind;
      n.huddleScore = buzz.score || 0;
      n.huddleT = 2.4 + rng() * 1.2;
      n.huddleLead = n === lead;
      n.foe = null;
      n.social = null;
      emote(n, buzz.kind === "wealth" || buzz.kind === "debt" || buzz.kind === "badge" ? "$" : (buzz.kind === "snitch" || buzz.kind === "heat" ? "!" : "?"));
    }
    return true;
  }

  function clearRumorHuddle(n) {
    if (!n) return;
    n.huddlePartner = null;
    n.huddleKind = null;
    n.huddleScore = 0;
    n.huddleT = 0;
    n.huddleLead = false;
  }

  /* WHAT THE TWO OF THEM DO WITH WHAT THEY SAID. Nobody walks over to sell
     you what he just heard: a man with a reason to talk follows you to see
     where you go, a scared one clears out, the rest go back to the yard. */
  function resolveRumorHuddle(n) {
    const kind = n.huddleKind || "quiet";
    const score = n.huddleScore || 0;
    clearRumorHuddle(n);
    n.aiState = "wander";
    if (!alive(n) || n.role === "merchant") return false;
    const g = CBZ.game || {};
    const p = n.personality || {};
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const sameGang = CBZ.player && CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player && CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const helpful = sameGang || protectedHere || standing > 24 || (n.playerTrust || 0) > 5 || (n.playerFear || 0) > 7;
    const hostile = rivalGang || standing < -16 || (n.playerGrudge || 0) > 7;
    const cprof = casePressureProfile();
    const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || (g.detection || 0) > 24 || cprof.heat > 12;

    if ((kind === "snitch" || kind === "heat") && searchHeat && !helpful && ((p.snitch || 0.5) > 0.48 || hostile)) {
      startTailPlayer(n, "snitch", 8 + Math.min(7, score * 0.16), score);
      return true;
    }
    if (kind === "fear" && (p.nerve || 0.5) < 0.42) {
      n.aiState = "flee";
      n.fleeT = 2.0 + rng() * 2;
      emote(n, "!");
      return true;
    }
    return false;
  }

  /* WORDS GO WRONG — where a yard fight actually starts.

     With violence now requiring a reason, the yard needed the place reasons
     really come from, and it was already running: 38 of 124 men are in
     `socialize` at any moment, trading gossip in twos. A prison fight almost
     never begins with two strangers deciding to fight; it begins in a
     conversation that turns — a debt, a name used wrong, a rumour about who
     talked. So an exchange can now sour, and when it does it books beef on
     BOTH men (an argument leaves two angry men, not one).

     Nothing here rolls a fight. It rolls a GRIEVANCE, usually small: most sour
     talk decays to nothing over the next minute and the two of them go back to
     wandering. Occasionally one crosses the swing line, and by then the player
     could have watched it building — two men squared up, an emote, a set that
     is doing badly. That is the difference between drama and noise. */
  function argue(n, p) {
    const fuse = (behaviorOf(n).init + behaviorOf(p).init) * 0.5;   // short tempers
    const nerve = ((n.personality && n.personality.nerve) || 0.5);
    // a set that is losing is a set that turns on itself
    const strain = n.gang >= 0 ? Math.max(0, -gangStanding(n.gang)) * 0.004 : 0;
    // he has heard this one is talking to the screws
    const talked = (p.snitchHeat || 0) > 0 || (n.snitchKnown && n.snitchKnown === p) ? 0.45 : 0;
    // AN ARGUMENT ALREADY UNDER WAY IS NOT A FRESH ROLL. Nobody calms down in
    // the middle of one, and this is what was missing: sour exchanges landed
    // one at a time on different pairs, so a man got halfway to the line and
    // the grudge decayed before he ever saw that face again. Once these two
    // have something, every further exchange between THEM is far more likely
    // to go wrong — so an argument concentrates, escalates, and resolves,
    // instead of spreading a thin film of resentment across the whole yard.
    const already = beefWith(n, p);
    const friction = (fuse + strain + talked + (nerve - 0.5) * 0.2) * (1 + already / 4);
    if (friction <= 0 || rng() > friction * 0.46) return false;     // most talk is still just talk
    const w = 2.4 + rng() * 3.6;
    addBeef(n, p, w);
    addBeef(p, n, w * (0.45 + rng() * 0.75));                       // he takes it differently
    emote(n, "!");
    // The conversation deliberately does NOT end here. An argument that ends
    // the moment it turns can never become anything: the two would part with a
    // grievance neither of them would ever be near enough to act on. They stay
    // in it, and each further exchange adds to what is already there — which is
    // how a yard argument actually escalates, over ten or twenty seconds, in
    // front of anyone who is watching.
    return true;
  }

  function gossip(n, p) {
    let source = null, target = null;
    if (n.memory && n.memory.t > 2 && !p.memory) { source = n; target = p; }
    else if (p.memory && p.memory.t > 2 && !n.memory) { source = p; target = n; }
    if (!source || !target || !copyMemory(source, target)) { shareBlockBuzz(n, p); return; }
    addBuzz(target.memory.type === "copCrime" ? "snitch" : "heat", 4, "gossip");
    rememberBlockRead(target, target.memory.type === "copCrime" ? "snitch" : "heat", target.memory.amount || 10, actorName(source));

    const sameGang = CBZ.player.gang != null && target.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && target.gang >= 0 && target.gang !== CBZ.player.gang;
    const standing = target.gang >= 0 ? gangStanding(target.gang) : 0;
    const tp = target.personality || {};
    emote(target, sameGang && standing > -10 ? "" : "!");

    if (sameGang && standing > -10) {
      addGangStanding(target.gang, 1);
      target.memory.t *= 0.45; // your crew helps bury it
    } else {
      if (rivalGang) addGangStanding(target.gang, -2);
      const heat = Math.max(5, target.memory.amount * (rivalGang ? 0.75 : 0.45));
      if ((tp.snitch || 0) + (tp.nerve || 0) > 1.15 && rng() < (rivalGang ? 0.38 : 0.22)) {
        sendNpcToSnitch(target, heat, { copCrime: target.memory.type === "copCrime", lastKnown: target.memory.lastKnown, type: target.memory.kind });
        addBuzz("snitch", 6, actorName(target));
      }
    }
  }

  /* ============================================================
     BEEF — why two men fight, and why they stopped needing a reason

     MEASURED (tools/sound-census.mjs, mode escape, player idle): 124 inmates
     alive and 7.3 of them in `fight` at any instant. Three and a half brawls
     running CONTINUOUSLY, forever. The punch spam the owner heard was the
     audible half of that; the deafening half is that a yard where three fights
     are always in progress contains no fights at all, because nothing in it is
     an event.

     THE ROOT was that violence needed no cause. findFoe() returned any
     rival-gang inmate within 8 m; findBrawlTarget() returned any man within
     9 m; the wander tick rolled on that every 1.5-4.5 s, per inmate. Standing
     near someone was the entire motive, so the condition for a fight was
     "being in the yard" — and everyone is always in the yard.

     THE FIX IS NOT A CAP. A budget ("at most N brawls") would have produced
     the same arbitrary violence with a quota on it, and the yard would still
     have had no memory of why anyone swung. Instead a fight now needs what a
     fight needs: A REASON AND AN OPENING.

       REASON  — beef, carried per pair and decaying. It is not invented here:
                 it is BOOKED by things that already happen in this sim. He hit
                 me. He put me down. He put my crewmate down. He snitched. He
                 is standing on our turf. The prison already tracked exactly
                 this against the PLAYER (n.playerGrudge, 130 call sites) and
                 tracked nothing at all between two inmates — so this is that
                 same idea, pointed at the yard.
       OPENING — nobody starts something in front of a screw. CBZ.guardWatching
                 is the guards' own cone (entities/guards.js), asked about a
                 patch of yard instead of about the player. `guts` decides how
                 much a given man cares that he is being watched.

     And starting a fight SPENDS the beef, while losing one BOOKS fresh beef on
     the winner. So violence in this yard now has a cause, a place, and a
     consequence that comes back around later — instead of a dice roll every
     three seconds. The rate falls out of that; it is not dialled.
     ============================================================ */
  /* These four numbers set HOW MUCH REASON IS ENOUGH, and how long the yard
     remembers — they do not set how much violence is allowed. The rate falls
     out of them and is measured, never asserted. At the values below,
     tools/sound-census.mjs over a 300 s window reports 121 inmates with 2.3 of
     them swinging at any instant — about one brawl live — and 31 blows a
     minute across the whole compound, against 7.3 men and 90 blows a minute
     when a fight needed no reason at all. Turn the memory up and the yard gets
     meaner because more men are carrying something, which is a different thing
     from rolling more dice. */
  const BEEF_MAX = 24;        // one grievance can only weigh so much
  const BEEF_FADE = 0.023;    // per second — a grudge outlives the argument by minutes, not forever
  const BEEF_SWING = 8;       // below this, a man may glare but he does not swing

  function beefList(n) { return n._beef || (n._beef = []); }
  function beefWith(n, other) {
    if (!n || !other || !n._beef) return 0;
    for (const b of n._beef) if (b.who === other) return b.w;
    return 0;
  }
  function addBeef(n, other, w) {
    if (!n || !other || n === other || !alive(n) || w <= 0) return;
    const list = beefList(n);
    for (const b of list) {
      if (b.who === other) { b.w = Math.min(BEEF_MAX, b.w + w); return; }
    }
    list.push({ who: other, w: Math.min(BEEF_MAX, w) });
  }
  function spendBeef(n, other) {
    if (!n || !n._beef) return;
    for (let i = 0; i < n._beef.length; i++) {
      if (n._beef[i].who === other) { n._beef.splice(i, 1); return; }
    }
  }
  // Grudges cool. A man who has not seen the other guy in a while stops
  // looking for him, which is what keeps the yard from accumulating an
  // ever-growing pile of reasons to fight.
  function fadeBeef(n, dt) {
    const list = n._beef;
    if (!list || !list.length) return;
    const drop = BEEF_FADE * dt;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.w -= drop;
      if (b.w <= 0 || !alive(b.who)) list.splice(i, 1);
    }
  }

  /* ============================================================
     TABS AND CONTRACTS — what the yard owes itself, and the work that
     collecting it becomes (PRISON_CONTRACTS)

     BEEF is the yard's memory of who swung at who. This is the other ledger a
     prison actually runs on and the one that was missing entirely: WHO OWES
     WHO, for WHAT, and since WHEN. Two men played dominoes, one lost, and now
     there is a number between them with a date on it. Nothing in this sim
     tracked that. Every debt in the game ran between the PLAYER and a gang —
     an abstraction with no face and no reason — so the block's economy had no
     interior. Men traded, argued and fought, and none of it left a claim.

     A TAB is `{ who, amt, why, t }` on the CREDITOR: `who` owes `n` `amt` cigs
     for `why`, and `t` is how long it has sat. `why` is load-bearing — it is
     the thing the creditor says out loud when he asks you to go get it, and a
     debt with no story behind it is a number on a HUD, not a grievance.

     A CONTRACT is what a ripe tab becomes when the claim-holder decides he is
     done waiting and hands it to YOU. Three of them, and every one is settled
     with the body rather than a button: COLLECT (go take it off him), REPO
     (lift the named thing he bought with the money), ROUGH UP (put him down).
     The creditor's card grows a row; the debtor's card never grows a "do
     violence" button, because finding him and cornering him IS the mechanic.

     And it runs both ways. When the player is the one who can't pay, the same
     gang collector who has been leaning on him offers him a contract instead
     of a beating — go collect ours, and yours gets lighter. Same three verbs,
     same physical work, the debt moving the other direction.
     ============================================================ */
  function contractsOn() { return CBZ.CONFIG.PRISON_CONTRACTS !== false; }

  /* Small numbers on purpose. A tab is two soups and a phone card, not a
     mortgage: 2-12 cigs is a week of commissary, which is the scale at which
     a man in here will actually send somebody after you. TAB_FADE is a tenth
     of BEEF_FADE — a punch is forgotten in minutes, a debt is not. */
  const TAB_MIN = 2, TAB_MAX = 12;
  const TAB_FADE = 0.0022;      // cigs per second — ~7 minutes to forgive one cig
  const TAB_RIPE = 95;          // seconds a claim sits before he starts asking around
  const TAB_DEAD = 900;         // he eventually writes it off
  /* WHAT THE MONEY WAS FOR. Every one of these is a thing you can point at:
     an item, a game, a service, a day of the week. None of them is a mood. */
  const TAB_WHY = [
    "store day", "the domino game", "phone time", "a pack of ramen",
    "a card game", "two soups", "the TV bet", "a phone card",
    "commissary", "a pair of shoes", "the fight last month", "a carton",
  ];
  /* A CONTRACT MAY ONLY NAME A MAN YOU CAN FIND. Half this yard answers to
     "an inmate" (entities/npc.js's crowd bodies literally share the string),
     and "go collect nine off an inmate" is not an errand, it is a riddle. So
     the moment an anonymous body becomes a target he gets a name — off this
     pool, minimal and one-way. Full naming of the crowd is a later wave; this
     is only the part the contract cannot work without. */
  const STREET_NAMES = [
    "Half-Ear Danny", "Two-Cent", "Preacher's Kid", "Bobo", "Gator",
    "New York", "Rayray", "Slim Pauly", "Cornbread", "Sugar Ray Willis",
  ];
  function isAnonymous(n) {
    const nm = n && n.data && n.data.name;
    return !nm || /^(an inmate|a thief|someone)$/i.test(nm);
  }
  function nameHim(n) {
    if (!n || !n.data || !isAnonymous(n)) return;
    const taken = {};
    for (const m of CBZ.npcs || []) if (m.data && m.data.name) taken[m.data.name] = 1;
    const free = STREET_NAMES.filter((s) => !taken[s]);
    const pool = free.length ? free : STREET_NAMES;
    n.data.name = pool[(rng() * pool.length) | 0];
    n.data.tag = n.data.tag || "Inmate";
    n._namedByContract = true;
  }

  function tabList(n) { return n._tabs || (n._tabs = []); }
  function tabWith(n, other) {
    if (!n || !other || !n._tabs) return 0;
    for (const t of n._tabs) if (t.who === other) return t.amt;
    return 0;
  }
  /* `other` owes `n`. Booking more onto a live tab keeps the ORIGINAL reason
     and the ORIGINAL date, because that is how a man tells it: "he's been into
     me since store day", not "he owes me for four separate things". */
  function addTab(n, other, amt, why) {
    if (!contractsOn()) return null;
    if (!n || !other || n === other || !alive(n) || !alive(other) || !(amt > 0)) return null;
    if (n.role === "merchant" || other.role === "merchant") return null;
    const list = tabList(n);
    for (const t of list) {
      if (t.who === other) { t.amt = Math.min(TAB_MAX, t.amt + amt); return t; }
    }
    const t = { who: other, amt: Math.min(TAB_MAX, Math.max(TAB_MIN, amt)), why: why || TAB_WHY[(rng() * TAB_WHY.length) | 0], t: 0 };
    list.push(t);
    return t;
  }
  function clearTab(n, other) {
    if (!n || !n._tabs) return;
    for (let i = 0; i < n._tabs.length; i++) {
      if (n._tabs[i].who === other) { n._tabs.splice(i, 1); return; }
    }
  }
  function payTab(n, other, amt) {
    if (!n || !n._tabs || !(amt > 0)) return;
    for (let i = 0; i < n._tabs.length; i++) {
      const t = n._tabs[i];
      if (t.who !== other) continue;
      t.amt -= amt;
      if (t.amt <= 0.5) n._tabs.splice(i, 1);
      return;
    }
  }
  /* A MAN WHO IS UNCONSCIOUS STILL OWES YOU MONEY. Deliberately NOT `alive()`:
     that helper reads a knocked-out body as not-alive, which is right for
     "can he swing at me" and catastrophic for a ledger — every brawl in the
     yard would quietly erase the debts of everyone who lost one. Only death
     and escape close a tab. */
  function ledgerGone(a) { return !a || a.dead || a.escaped; }
  // Debts age instead of evaporating: `t` is what makes a claim RIPE, and the
  // slow amt decay is the man quietly deciding it isn't worth the trouble.
  function fadeTabs(n, dt) {
    const list = n._tabs;
    if (!list || !list.length) return;
    const drop = TAB_FADE * dt;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.t += dt;
      t.amt -= drop;
      if (t.amt <= 0.5 || t.t > TAB_DEAD || ledgerGone(t.who)) list.splice(i, 1);
    }
  }

  /* WHERE THE MONEY GOES. Two men stopped to talk; sometimes one of them
     leaves owing the other. Hung off the SAME socialize exchange that already
     books gossip and arguments, so a tab is minted where a debt is actually
     made — in front of anyone standing near enough to watch — instead of on a
     background timer. Chow and yard are when commissary and games happen, so
     that is when this fires; a greedy man is the one who lends and the one who
     keeps count. */
  function mintTab(n, p) {
    if (!contractsOn() || !n || !p) return false;
    const S = CBZ.prisonSchedule;
    const block = S && S.enabled() ? S.id() : "yard";
    const trading = block === "mess" || block === "supper" || block === "yard" || block === "work";
    if (!trading) return false;
    const greed = (n.personality && n.personality.greed) || 0.5;
    const loose = (p.personality && p.personality.greed) || 0.5;
    // the lender is the one who counts; the borrower is the one who doesn't
    if (rng() > (greed * 0.5 + (1 - loose) * 0.12) * 0.10) return false;
    if (tabWith(n, p) > 0) return false;         // one live claim per pair
    const amt = TAB_MIN + Math.floor(rng() * (TAB_MAX - TAB_MIN));
    const why = block === "mess" || block === "supper"
      ? ["two soups", "a pack of ramen", "commissary", "a carton"][(rng() * 4) | 0]
      : TAB_WHY[(rng() * TAB_WHY.length) | 0];
    return !!addTab(n, p, amt, why);
  }

  /* WHERE HE IS, SAID THE WAY A MAN WOULD SAY IT. The place has to be TRUE or
     the contract is a lie the game told you: it comes off his own wander box
     (entities/npc.js's `region`, or `_dayRegion` when a count has temporarily
     shrunk it to a muster spot) through the prison's own landmark list, then
     gets the verb the current block makes true — at chow everybody is at the
     tables, at night everybody is on their tier. */
  function homeSpot(n) {
    const r = (n && (n._dayRegion || n.region)) || null;
    if (r && r.length === 4) return { x: (r[0] + r[1]) / 2, z: (r[2] + r[3]) / 2 };
    if (n && n.group) return { x: n.group.position.x, z: n.group.position.z };
    return null;
  }
  function placeFor(n) {
    const S = CBZ.prisonSchedule;
    const block = S && S.enabled() ? S.id() : "";
    if (block === "mess" || block === "supper") return "He eats at the far tables.";
    if (block === "secure" || block === "night") return "He's locked on his tier.";
    const spot = homeSpot(n);
    const where = spot ? nearestLandmark(spot.x, spot.z) : "yard";
    if (where === "cell block") return "He's on the tier most days.";
    if (where === "staff lounge") return "He works up by the staff lounge.";
    if (where === "exit corridor") return "He hangs down the exit corridor.";
    if (where === "armory door") return "He's always on the staff side.";
    if (where === "yard gate") return "He stands at the yard gate.";
    if (where && where.indexOf("car:") === 0) return "He posts up where " + gangName(+where.slice(4)) + " stand.";
    return "He's out on the yard.";
  }

  // ---- the live contract ---------------------------------------------------
  // One at a time, the same way CBZ.game.gangJob is one at a time: a man who
  // is running three collections for three different people is a quest log.
  function contract() { return (CBZ.game && CBZ.game.contract) || null; }
  function contractFor(n) {
    const c = contract();
    return c && c.creditor === n ? c : null;
  }
  function contractAgainst(n) {
    const c = contract();
    return c && c.debtor === n ? c : null;
  }
  function contractSatisfied(c) {
    if (!c) return false;
    if (c.kind === "roughUp") return !!c.done;
    if (c.kind === "repo") return !!c.done && CBZ.econ.hasItem(c.item);
    return (c.got || 0) > 0;                     // collect: anything you pulled off him
  }
  function contractPaidInFull(c) {
    if (!c) return false;
    if (c.kind === "collect") return (c.got || 0) >= c.amt;
    return contractSatisfied(c);
  }
  function contractCut(amt) { return Math.max(2, Math.min(5, Math.ceil(amt * 0.34))); }

  /* WHICH JOB THE CLAIM BECOMES. Not a die: it is read off the two men. A man
     who bought something with money he owed gets REPO'd for that thing, and
     the item has to actually be in his pockets right now (economy.js's loadout
     is the one truth about what a body is carrying). A shotcaller or an
     enforcer with a live grievance wants him PUT DOWN. Everyone else wants
     their cigarettes, which is the ordinary case. */
  function pickContractKind(creditor, debtor, forceKind) {
    const load = (CBZ.econ && CBZ.econ.rollLoadout) ? CBZ.econ.rollLoadout(debtor) : null;
    const items = (load && load.items) || [];
    const wanted = items.filter((it) => !/key|card/i.test(it) && it !== "Gun");
    const p = creditor.personality || {};
    // A staging/probe caller may name the job (see the `offer` export). A repo
    // still cannot be conjured out of empty pockets — the item has to be real.
    if (forceKind === "repo" && wanted.length) return { kind: "repo", item: wanted[0] };
    if (forceKind === "roughUp" || forceKind === "collect") return { kind: forceKind, item: "" };
    if (wanted.length && rng() < 0.34) {
      return { kind: "repo", item: wanted[(rng() * wanted.length) | 0] };
    }
    const violent = (p.nerve || 0.5) > 0.6 && ((p.greed || 0.5) < 0.55 || beefWith(creditor, debtor) > 4);
    if (violent && rng() < 0.4) return { kind: "roughUp", item: "" };
    return { kind: "collect", item: "" };
  }

  function makeContract(creditor, tab, workOff, holder, forceKind) {
    const debtor = tab.who;
    nameHim(debtor);
    const pick = pickContractKind(creditor, debtor, forceKind);
    const amt = Math.max(TAB_MIN, Math.round(tab.amt));
    return {
      creditor, debtor,
      // usually the same man; on a work-it-off the claim belongs to his crew
      // and he is only the one you hand it back to
      holder: holder || creditor,
      kind: pick.kind,
      item: pick.item,
      amt,
      cut: workOff ? 0 : contractCut(amt),
      why: tab.why,
      place: placeFor(debtor),
      name: debtor.data.name.replace(/^the |^a |^an /, ""),
      // the symmetry: the payout is gang debt coming OFF you, not cigs going on
      workOff: workOff || null,
      got: 0, done: false, told: false,
    };
  }

  /* THE PITCH. Names the man, the amount or the item, the reason, the place,
     and your cut — in that order, in four clipped sentences, the way somebody
     hands off a collection. No sentence explains a system. */
  function contractPitch(c) {
    const who = c.name;
    const owed = `${c.amt}`;
    const cut = c.workOff
      ? `Bring it, we're square.`
      : `Bring it, keep ${c.cut}.`;
    if (c.kind === "repo") {
      return `${who} has my ${c.item}. Get it back` +
        (c.workOff ? `, we're square.` : `, keep ${c.cut}.`);
    }
    if (c.kind === "roughUp") {
      return `${who} owes me ${owed}. Put him down` +
        (c.workOff ? `, we're square.` : `. ${c.cut} for you.`);
    }
    return `${who} owes me ${owed}. ${cut}`;
  }

  /* THE SETTLE ROW, in plain words, for the card. It is the one place the
     player is allowed to read the state of the job, because he is standing in
     front of the man who gave it to him and looking at his face. */
  function contractSummary() {
    const c = contract();
    if (!c) return "";
    if (c.kind === "repo") {
      return c.done ? `holding ${c.name}'s ${c.item}` : `${c.name}'s ${c.item}, ${c.place.replace(/^He /, "he ").replace(/\.$/, "")}`;
    }
    if (c.kind === "roughUp") return c.done ? `${c.name} is down` : `${c.name} still standing`;
    return `${c.got || 0} of ${c.amt} off ${c.name}`;
  }
  function contractNoteFor(n) {
    const c = contract();
    if (!c) return "";
    if (c.creditor === n) return (contractSatisfied(c) ? "settle up: " : "waiting on you: ") + contractSummary();
    if (c.debtor === n) {
      if (c.kind === "repo") return `he's holding the ${c.item}`;
      if (c.kind === "roughUp") return `this is the man`;
      return `owes ${c.creditor.data.name.replace(/^the |^a |^an /, "")} ${c.amt}`;
    }
    return "";
  }

  // ---- offering it ---------------------------------------------------------
  // The claim he is most likely to send somebody after: oldest first, because
  // patience is the thing that ran out.
  function ripeTab(n) {
    if (!contractsOn() || !n || !n._tabs || !n._tabs.length) return null;
    let best = null;
    for (const t of n._tabs) {
      if (t.t < TAB_RIPE || ledgerGone(t.who) || t.who === CBZ.player) continue;
      if (t.who.role === "merchant") continue;
      if (!best || t.t > best.t) best = t;
    }
    return best;
  }
  /* "DICE OWES US TOO." A collector leaning on the player for a gang debt is
     speaking for a CREW, so the claim he sends you after may sit on any of his
     people's ledgers — which is both truer and the only thing that makes the
     work-it-off leg fire often enough to exist. He is still the man you hand
     it back to; the tab's real owner rides along as `holder`. */
  function ripeCrewTab(n) {
    const own = ripeTab(n);
    if (own) return { holder: n, tab: own };
    if (!(n.gang >= 0)) return null;
    let best = null;
    for (const m of CBZ.npcs || []) {
      if (m === n || m.gang !== n.gang || !alive(m)) continue;
      const t = ripeTab(m);
      if (t && t.who !== n && (!best || t.t > best.tab.t)) best = { holder: m, tab: t };
    }
    return best;
  }
  function canOfferContract(n) {
    if (!contractsOn() || contract() || !n || !alive(n)) return false;
    if (CBZ.game.role === "cop" || CBZ.game.mode !== "escape") return false;
    if (n.role === "merchant" || n.kind === "guard" || n.kind === "warden") return false;
    if ((n.playerGrudge || 0) >= 6) return false;      // he isn't handing his money to you
    return !!ripeTab(n);
  }
  /* WORK IT OFF. A collector leaning on you for a crew debt you cannot pay
     (the debt bigger than your pocket) can hand you somebody else's tab
     instead: the same errand, with the payout pointed at your debt. It is a
     decision on HIM while he is in your face (interact.js "workOff"), never a
     pitch. WORKOFF_DEBT is the floor: below it a man just wants his smokes. */
  const WORKOFF_DEBT = 9;
  function canWorkOff(n) {
    const D = n && n._demand;
    if (!contractsOn() || !D || D.kind !== "debt" || contract()) return false;
    if (!(n.gang >= 0)) return false;
    const debt = gangDebt(n.gang);
    if (debt < WORKOFF_DEBT || debt <= ((CBZ.game && CBZ.game.cigs) || 0)) return false;
    // interact.js asks this every render while his verbs are up, and the
    // answer walks the roster. It cannot change inside a second.
    const now = CBZ.now || 0;
    if (D._workAskT && now - D._workAskT < 900) return !!D._workAsk;
    D._workAskT = now;
    D._workAsk = !!ripeCrewTab(n);
    return D._workAsk;
  }
  function workOff(n) {
    if (!canWorkOff(n)) return { ok: false, msg: "" };
    const src = ripeCrewTab(n);
    if (!src) return { ok: false, msg: "" };
    const c = makeContract(n, src.tab, { gang: n.gang }, src.holder);
    endDemand(n, "work");
    takeContract(n, c);
    addGangStanding(n.gang, 3);
    n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
    for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
    say(n, contractPitch(c), null, 3.4);
    return { ok: true, msg: "" };
  }
  /* COLLECT IS THE DECISION. You pressed it on a man who holds a sour tab:
     the job is yours, he names the man and the money, and where to start. */
  function offerContract(n, workOffGang, forceKind) {
    const src = workOffGang ? ripeCrewTab(n) : (ripeTab(n) ? { holder: n, tab: ripeTab(n) } : null);
    if (!src || !alive(src.tab.who)) return null;
    const c = makeContract(n, src.tab, workOffGang, src.holder, forceKind);
    takeContract(n, c);
    say(n, contractPitch(c) + " " + c.place, null, 3.8);
    return c;
  }
  function takeContract(n, c) {
    CBZ.game.contract = c;
    c.t = 0;
    ensureContractWraps();
    return c;
  }

  // ---- the debtor, cornered ------------------------------------------------
  /* HE TALKS BECAUSE YOU WALKED UP. Getting inside three metres of the man
     you were sent after is the situation; he says what is in his pocket
     (economy.js's loadout, not a number invented here) and a day for the
     rest, once per job. Walk off and come back and it is the same excuse.
     Taking what he offered is a decision on him (interact.js "take"); the
     rest is your hands (Pickpocket, Punch, a gun), which the wraps below
     count against the debt. */
  const DODGE_DAYS = ["Thursday", "store day", "Friday", "after count", "next week"];
  function dodgeLine(c, onHand) {
    if (c.kind === "repo") {
      return onHand > 0
        ? `The ${c.item}'s spoken for. Take ${onHand}.`
        : `Don't have it on me.`;
    }
    if (c.kind === "roughUp") {
      return onHand > 0
        ? `Don't. Here's ${onHand}. Take it to him.`
        : `He sent you? I got nothing.`;
    }
    if (onHand <= 0) return `I'm empty. ${DODGE_DAYS[(rng() * DODGE_DAYS.length) | 0]}.`;
    if (onHand >= c.amt) return `Here. Tell him we're done.`;
    return `${onHand} now. Rest ${DODGE_DAYS[(rng() * DODGE_DAYS.length) | 0]}.`;
  }
  function debtorOnHand(n) {
    const load = (CBZ.econ && CBZ.econ.rollLoadout) ? CBZ.econ.rollLoadout(n) : null;
    return load ? Math.max(0, Math.floor(load.cigs || 0)) : 0;
  }
  // what the cornered debtor put on the table, or 0
  function dodgeOffer(n) {
    const c = contractAgainst(n);
    if (!c || !c.dodged || contractSatisfied(c)) return 0;
    return Math.max(0, Math.min(c.partial || 0, debtorOnHand(n), c.amt - (c.got || 0)));
  }
  function takeDodge(n) {
    const c = contractAgainst(n);
    const take = dodgeOffer(n);
    if (!c || take <= 0) return { ok: false, msg: "" };
    const load = CBZ.econ.rollLoadout(n);
    load.cigs = Math.max(0, load.cigs - take);
    c.partial = 0;
    CBZ.econ.addCigs(take);
    if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: take });
    creditCollected(n, take);
    CBZ.sfx && CBZ.sfx("coin");
    n.playerTrust = Math.min(10, (n.playerTrust || 0) + 1);
    bookDebtorGrudge(n, "the collection", 1.5);
    say(n, contractPaidInFull(c) ? "That's all of it. We're done." : "That's what I got. Tell him.", null, 2.6);
    return { ok: true, msg: "" };
  }
  // aiThink, every think: standing close to your mark IS the trigger, once a job
  function considerCornered(n) {
    if (!contractsOn()) return false;
    const c = contractAgainst(n);
    if (!c || c.dodged || contractSatisfied(c) || playerDist(n) > 3.2) return false;
    if (n.intimidMode === "scared") return false;    // a drawn gun owns him already
    if (n.aiState === "fight" || (n.ko || 0) > 0) return false;
    const owe = Math.max(0, c.amt - (c.got || 0));
    const onHand = Math.min(debtorOnHand(n), owe);
    c.dodged = true;
    c.partial = onHand;
    say(n, dodgeLine(c, onHand), null, 3.0);
    if (CBZ.npcStare) CBZ.npcStare(n, 2.0);
    return true;
  }

  // ---- the physical execution ---------------------------------------------
  /* A REPO IS A NAMED LIFT, and economy.js's steal() cannot do one: liftBest
     takes the most VALUABLE thing in his pockets, which on a repo would hand
     you his shiv and leave the radio you were sent for. `econ.steal(actor)`
     also takes no want-parameter and economy.js is another agent's file this
     wave, so the targeted lift lives here — on the same accessors steal uses
     (rollLoadout's live items array, stealOdds, addItem, announceLoot), so a
     repo and a pickpocket are the same hand in the same pocket at the same
     odds. SEAM FOR THE ORCHESTRATOR: this wants to be `steal(actor, {want})`
     in economy.js eventually, with liftBest taking the wanted name. */
  function contractLift(n) {
    const c = contractAgainst(n);
    if (!c || c.kind !== "repo") return { ok: false, msg: "" };
    const who = n.data.name.replace(/^the |^a |^an /, "");
    const load = CBZ.econ.rollLoadout(n);
    const idx = load.items.indexOf(c.item);
    if (idx < 0) {
      // He sold it, spent it or lost it. The job dies where the object died.
      c.dead = true;
      say(n, `The ${c.item}? Gone. Ask around.`, null, 2.2);
      return { ok: false, msg: "" };
    }
    const odds = CBZ.econ.stealOdds ? CBZ.econ.stealOdds(n) : 0.5;
    if (rng() < odds) {
      load.items.splice(idx, 1);
      CBZ.econ.addItem(c.item, 1);
      c.done = true;
      c.got = 1;
      if (CBZ.econ.announceLoot) CBZ.econ.announceLoot(0, [c.item]);
      CBZ.sfx && CBZ.sfx("loot");
      bookDebtorGrudge(n, `you lifting my ${c.item}`, 2.5);
      return { ok: true, msg: "" };
    }
    CBZ.sfx && CBZ.sfx("whoosh");
    bookDebtorGrudge(n, "you going through my pockets", 3);
    say(n, "Hand. Now.", null, 1.8);
    return { ok: false, msg: "" };
  }
  // Does the steal verb on this man mean the repo? interact.js asks.
  function contractWantedItem(n) {
    const c = contractAgainst(n);
    return c && c.kind === "repo" && !c.done && !c.dead ? c.item : "";
  }

  /* THE DEBTOR REMEMBERS WHO CAME. Every completion path routes through here
     so the grudge always has a CAUSE the card can print ("still sore about the
     collection") and his crew always hears about it through the net that
     already exists. Men already carrying beef against him are not touched —
     noteGangIncident and the beef ledger handle that side, and they were built
     for it. */
  function bookDebtorGrudge(n, why, weight) {
    if (!n) return;
    n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + (weight || 2));
    n.grudgeWhy = why;
    if (n.gang >= 0 && CBZ.noteGangIncident) {
      noteGangIncident(n, "disrespect", 4 + Math.min(5, weight || 2), { source: "contract" });
    }
  }

  /* WRAPPING THE WORLD'S OWN VERBS instead of adding new ones. A rough-up
     completes on ANY knockdown of the target, from any weapon, any system —
     because CBZ.killstreakOnDown is the one call every path that drops a body
     already makes (systems/prisonfriends.js wraps it for the same reason). A
     collection banks what you actually pulled OFF HIM: the pickpocket, the
     gunpoint rob, the partial he handed over. It deliberately does NOT bank
     cigarettes you already had — the point of the whole layer is that the
     payment has to come out of THAT man's pocket, which is why the card can
     never be satisfied by walking to a shop.

     Armed lazily: killstreaks.js, intimidate.js and economy.js all load after
     this file. */
  function creditCollected(target, cigs) {
    const c = contractAgainst(target);
    if (!c || !(cigs > 0) || c.kind === "repo") return;
    c.got = Math.min(c.amt, (c.got || 0) + cigs);
  }
  function ensureContractWraps() {
    if (CBZ.killstreakOnDown && !CBZ.killstreakOnDown._contractWrapped) {
      const inner = CBZ.killstreakOnDown;
      const onDown = function (actor, how) {
        try {
          const c = contractAgainst(actor);
          if (c && c.kind === "roughUp" && !c.done) {
            c.done = true;
            bookDebtorGrudge(actor, "the beating you took for somebody else", 4);
          }
        } catch (e) { /* never let bookkeeping eat a takedown */ }
        return inner.apply(this, arguments);
      };
      onDown._contractWrapped = true;
      CBZ.killstreakOnDown = onDown;
    }
    if (CBZ.econ && CBZ.econ.steal && !CBZ.econ.steal._contractWrapped) {
      const innerSteal = CBZ.econ.steal;
      const stealWrapped = function (actor) {
        // a repo IS the steal on that man — same hand, named object
        if (contractWantedItem(actor)) return contractLift(actor);
        const before = (CBZ.game && CBZ.game.cigs) || 0;
        const res = innerSteal.apply(this, arguments);
        try { creditCollected(actor, ((CBZ.game && CBZ.game.cigs) || 0) - before); } catch (e) {}
        return res;
      };
      stealWrapped._contractWrapped = true;
      CBZ.econ.steal = stealWrapped;
    }
    if (CBZ.prisonRobTarget && !CBZ.prisonRobTarget._contractWrapped) {
      const innerRob = CBZ.prisonRobTarget;
      const robWrapped = function (who) {
        const target = who || (CBZ.intimidate && CBZ.intimidate.target && CBZ.intimidate.target());
        const before = (CBZ.game && CBZ.game.cigs) || 0;
        const wanted = target ? contractWantedItem(target) : "";
        const out = innerRob.apply(this, arguments);
        try {
          if (target) {
            // he remembers what you took, and may come back for it (ROBBED below)
            const took = ((CBZ.game && CBZ.game.cigs) || 0) - before;
            if (took > 0 && !target.dead) rememberRobbed(target, took);
            creditCollected(target, ((CBZ.game && CBZ.game.cigs) || 0) - before);
            const c = contractAgainst(target);
            if (c && wanted && CBZ.econ.hasItem(wanted)) { c.done = true; c.got = 1; }
          }
        } catch (e) {}
        return out;
      };
      robWrapped._contractWrapped = true;
      CBZ.prisonRobTarget = robWrapped;
    }
  }

  // ---- proof and payout ----------------------------------------------------
  /* SETTLING. You are standing in front of the man who sent you, holding what
     you took off the other one. What he pays is your cut and his respect; what
     it costs you is handing over the rest, out of the pocket you put it in.
     A short collection is not a failure — he takes what came back, says so,
     and the remainder stays on his ledger, because a tab that survives a bad
     collection is exactly what a tab is. */
  function settleContract(n) {
    const c = contractFor(n);
    const who = n.data.name.replace(/^the |^a |^an /, "");
    if (!c) return { ok: false, msg: "" };
    if (c.dead) {
      CBZ.game.contract = null;
      say(n, `Gone? Then it's gone. Forget it.`, null, 2.4);
      return { ok: true, msg: "" };
    }
    if (!contractSatisfied(c)) {
      say(n, c.kind === "roughUp" ? `He's still walking. Go.` : `Empty hands. Go see him.`, null, 2.2);
      return { ok: false, msg: "" };
    }

    const holder = c.holder || n;
    let line = "";
    if (c.kind === "repo") {
      CBZ.econ.takeItem(c.item);
      clearTab(holder, c.debtor);
      line = `The ${c.item}. Knew he had it.`;
    } else if (c.kind === "roughUp") {
      clearTab(holder, c.debtor);
      line = `Heard him hit the floor.`;
    } else {
      const brought = Math.min(c.got || 0, c.amt);
      const keep = Math.min(c.cut, brought);
      const handOver = Math.max(0, brought - keep);
      if (handOver > 0) CBZ.econ.addCigs(-handOver);
      payTab(holder, c.debtor, brought);
      line = brought >= c.amt
        ? `All of it. He say anything?`
        : `${brought}. He's still into me for ${Math.max(1, c.amt - brought)}.`;
    }

    // the cut, and what it buys you with him
    if (c.workOff) {
      const off = Math.max(3, c.amt + 2);
      addGangDebt(c.workOff.gang, -off);
      addGangStanding(c.workOff.gang, 6);
      addGangProtection(c.workOff.gang, 14 + c.amt);
      for (const m of CBZ.npcs) if (m.gang === c.workOff.gang) m.huntPlayer = 0;
      line += ` That's off your tab.`;
    } else if (c.kind !== "collect" && c.cut > 0) {
      CBZ.econ.addCigs(c.cut);
      if (CBZ.pickupNote) CBZ.pickupNote("Cigarettes", { count: c.cut });
    }
    if (CBZ.econ.addRespect) CBZ.econ.addRespect(n, contractPaidInFull(c) ? 8 : 4);
    n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
    n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
    if (n.gang >= 0) addGangStanding(n.gang, contractPaidInFull(c) ? 5 : 2);
    addBuzz("debt", 3, "collection");

    CBZ.sfx && CBZ.sfx("coin");
    CBZ.game.contract = null;
    say(n, line, null, 2.8);
    return { ok: true, msg: "" };
  }

  /* THE ONE SLOW TICK. Ages the live contract, arms the wraps once the systems
     that own the verbs have loaded, and quietly drops a job whose debtor died
     or walked out — a contract on a corpse is a card the player can never
     clear. Registered at 44.5, beside the other prison social directors. */
  function updateContracts(dt) {
    if (!contractsOn()) return;
    ensureContractWraps();
    const c = contract();
    if (!c) return;
    c.t = (c.t || 0) + dt;
    if (ledgerGone(c.creditor)) { CBZ.game.contract = null; return; }
    if (ledgerGone(c.debtor)) c.dead = true;
    /* HE GIVES UP ON YOU. Without this a player who takes a job and never does
       it is holding the only contract slot forever, and nobody in the prison
       can ever offer him another — the exact bug shape a one-at-a-time design
       invites. Ten minutes of nothing and the man goes and finds somebody
       else, which is also the truth about him. He says so if you are stood
       near enough to hear it. */
    if (!contractSatisfied(c) && c.t > 600) {
      const near = playerDist(c.creditor) < 20;
      CBZ.game.contract = null;
      if (near) say(c.creditor, `Forget it. I sent somebody else.`, null, 2.4);
      return;
    }
    // he keeps the place honest — a man who moved is a man you get re-directed to
    if (!c.done && (c.t % 30) < dt) c.place = placeFor(c.debtor);
  }
  // Somebody in uniform is looking at this patch of ground. `guts` is how
  // little that stops you: a Predator (0.96) barely slows down, an Opportunist
  // (0.40) waits for the screw to turn around.
  function watched(n) {
    if (!CBZ.guardWatching) return 0;
    const p = n.group.position;
    return CBZ.guardWatching(p.x, p.y, p.z) ? 1 : 0;
  }
  // How badly this man wants to swing at that man, 0..1. Beef is the reason;
  // temperament decides what weight of reason is enough.
  function wantsToSwing(n, other) {
    // cuffed and let up, running home, or his clique's nerve has gone
    if ((n._lawHeldT || 0) > 0 || (n._routT || 0) > 0 || n.cuffed) return 0;
    if (CBZ.prisonBrain && CBZ.prisonBrain.broken(n)) return 0;
    const b = behaviorOf(n);
    const odds = fightOdds(n, other);                      // 0..1 he wins this
    const risk = watched(n) * (1 - b.guts) * 1.2;          // a screw is watching
    const beef = beefWith(n, other);
    if (beef < BEEF_SWING) {
      // NO HISTORY. The only violence that needs none is predation, and it
      // needs an opening instead: a mark he is sure of, and nobody looking.
      if (b.picksWeak < 0.85 || odds < 0.72) return 0;
      return Math.max(0, Math.min(1, b.init * (odds - 0.5) * 1.6 - risk));
    }
    const nerve = 0.35 + b.init * 1.6;                     // how readily this one starts things
    const edge = b.picksWeak > 0.8 ? (odds - 0.5) * 1.6 : (odds - 0.5) * 0.5;
    return Math.max(0, Math.min(1, (beef / BEEF_MAX) * nerve + edge - risk));
  }

  function findFoe(n) {
    // rare betrayal: jump your own leader
    if (n.gang >= 0 && !n.isLeader && rng() < 0.012) {
      const ld = leaders[n.gang];
      if (alive(ld) && ld !== n) return ld;
    }
    // very rare: take a swing at a guard (anyone can do anything)
    if (rng() < 0.006) {
      const guards = CBZ.guards.filter((g) => alive(g) && dist(n, g) < 8);
      if (guards.length) return guards[Math.floor(rng() * guards.length)];
    }
    // A RIVAL IS NOT A REASON. This used to return the nearest living rival
    // within 8 m, full stop — so two gangs sharing one yard meant permanent
    // war, since somebody is always within 8 m. Wearing the other colour now
    // BUILDS beef (see turfFriction) rather than being beef; what comes back
    // from here is the man this one actually has something with.
    let best = null, bw = BEEF_SWING;
    for (const a of nearbyNpcs(n, 8, _foeNear)) {
      if (a === n || !alive(a) || a.gang < 0 || a.gang === n.gang) continue;
      const w = beefWith(n, a);
      if (w > bw) { bw = w; best = a; }
    }
    return best;
  }

  /* TURF FRICTION — where a gang feud comes from when nobody has swung yet.
     A rival standing in your set's circle is an insult that accumulates while
     he stands there, and it accumulates FASTER the worse the standing between
     the two sets already is. Stand on the wrong grass long enough and someone
     will eventually have a reason; walk through and nothing happens. That is a
     feud with a cause and a place, and it costs one cheap check per actor on
     the wander tick rather than a roll against every neighbour. */
  function turfFriction(n, dt) {
    if (n.gang < 0) return;
    // Accumulate and query on a slow beat rather than once per inmate per
    // frame — 124 spatial queries every frame to notice a man standing still is
    // the kind of cost that does not show up until the yard is full. The rate
    // maths is unchanged because the whole accumulated dt is applied when it
    // does run.
    n._turfT = (n._turfT || 0) + dt;
    if (n._turfT < 0.75) return;
    dt = n._turfT;
    n._turfT = 0;
    for (const a of nearbyNpcs(n, 9, _foeNear)) {
      if (a === n || !alive(a) || a.gang < 0 || a.gang === n.gang) continue;
      if (!isOnTurf(n.gang, a.group.position)) continue;    // he is on OUR grass
      const P = PCARS();
      const politics = P ? 0.35 + P.tension(n.gang, a.gang) / 30 : 1;
      const heat = (1 + Math.max(0, -gangStanding(n.gang)) * 0.02) * politics;
      addBeef(n, a, 1.7 * dt * heat * (0.5 + behaviorOf(n).init * 2));
      break;                                                // one insult at a time
    }
  }

  function pickTurfTarget(n) {
    const t = turfOf(n.gang);
    if (!t) return false;
    const r = 1 + rng() * (t.r - 1);
    const a = rng() * Math.PI * 2;
    n.target.set(t.x + Math.cos(a) * r, 0, t.z + Math.sin(a) * r);
    return true;
  }

  function startFight(n, foe) {
    n.aiState = "fight"; n.foe = foe; n.hitCD = 0;
    if (PCARS() && foe && foe.kind !== "guard" && foe.kind !== "warden") PCARS().incident(n, foe, 5);
    // WHO THREW FIRST is what a screw acts on (systems/brain_prison.js)
    n._fightStarter = n;
    if (foe && foe.group) foe._fightStarter = n;
    // AND THE YARD SEES IT: everyone who could see or hear it is a witness —
    // a screw in view takes it at once, the rest cheer, look away, clear
    // out, or (rarely, never on their own set) go and tell
    if (CBZ.prisonBrain && foe && foe.group && foe.kind !== "guard" && foe.kind !== "warden") {
      const p = n.group.position;
      CBZ.prisonBrain.crime("fight", p.x, p.z, n, 0.3, { victim: foe });
    }
    // THE REASON IS NOW SPENT. Without this the same grievance re-fires the
    // same fight on every wander tick for as long as it takes to decay, which
    // is the shape the old dice roll had and the whole point of removing it.
    spendBeef(n, foe);
    n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
    // how the target answers depends on its TEMPERAMENT, not its skill:
    // a Defensive bruiser stands and wrecks you; a Pacifist bolts even
    // though they could win; a bad matchup makes anyone more likely to run.
    if (foe.gang != null && foe.aiState && alive(foe) && !foe.foe) {
      const fb = behaviorOf(foe);
      const odds = fightOdds(foe, n);                 // 0..1 the target would win
      // ...and whether he has his OWN reason. A man who has been carrying
      // something against you does not run when you finally swing: he has been
      // waiting for it. Without this, most "fights" were one man chasing one
      // man who bolted, which is why the yard could throw blows and still not
      // look like it had a fight in it.
      const mutual = Math.min(1, beefWith(foe, n) / BEEF_SWING);
      const stand = fb.retaliate * (0.45 + odds * 0.85) + mutual * 0.5;
      if (rng() < Math.min(0.98, stand)) {
        foe.aiState = "fight"; foe.foe = n; foe.hitCD = 0.3;
      } else {
        foe.aiState = "flee"; foe.fleeT = 2.2 + rng() * 2.2; foe.foe = null;
        emote(foe, "");
      }
    } else if (foe.alert != null) {
      foe.alert = 2.5; // a guard turns to face the attacker
    }
  }

  // who this actor would actually pick a fight with, filtered by temperament.
  function findBrawlTarget(n) {
    const b = behaviorOf(n);
    // gang members keep their rival feud (handled by findFoe)
    if (n.gang >= 0) { const f = findFoe(n); if (f) return f; }
    if (b.init < 0.1) return null;                    // peaceful types never go looking
    const reach = b.picksWeak >= 0.9 ? 7 : 9;
    // WHO THIS MAN HAS SOMETHING WITH — not who is closest. Proximity used to
    // BE the motive here, which is why the yard never stopped swinging.
    let best = null, bw = BEEF_SWING;
    for (const a of nearbyNpcs(n, reach, _brawlNear)) {
      if (a === n || !alive(a) || a.role === "merchant") continue;
      // YOU DON'T JUMP YOUR OWN CREW — WITHOUT A REASON. This used to be a
      // flat skip, which made intra-crew grievance unactionable: an argument
      // with your own man could book beef forever and never go anywhere. Crew
      // raises the bar, it does not remove the possibility, because a set that
      // cannot turn on itself is not a set of people.
      const bar = (n.gang >= 0 && a.gang === n.gang) ? BEEF_SWING * 1.6 : BEEF_SWING;
      const w = beefWith(n, a);
      if (w > bar && w > bw) { bw = w; best = a; }
    }
    if (best) return best;
    // PREDATION IS ITS OWN REASON, and it is the one kind of violence that
    // genuinely needs no history — but it needs an opening. A bully wants a
    // mark he beats, alone, with nobody in uniform looking. That is a hunt,
    // not a dice roll, and it is why the fights that do start now start in the
    // corners of the yard instead of under the tower.
    if (b.picksWeak < 0.85 || watched(n)) return null;
    for (const a of nearbyNpcs(n, reach, _brawlNear)) {
      if (a === n || !alive(a) || a.role === "merchant") continue;
      if (n.gang >= 0 && a.gang === n.gang) continue;
      if (fightOdds(n, a) < 0.72) continue;           // he has to be sure he wins
      if (a.gang >= 0 && bandNear(a, 7) > 1) continue; // not while the mark's crew is around
      return a;
    }
    return null;
  }

  // how many of this actor's own set are standing near him — an isolated man
  // is a mark, a man with his crew around him is not.
  function bandNear(a, r) {
    let count = 0;
    for (const o of nearbyNpcs(a, r, _markNear)) {
      if (o !== a && alive(o) && o.gang >= 0 && o.gang === a.gang) count++;
    }
    return count;
  }

  function coolWanted(amount) {
    if (CBZ.addHeat) CBZ.addHeat(-amount);
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(amount * 0.85);
    CBZ.game.witnessReportT = Math.max(0, (CBZ.game.witnessReportT || 0) - amount * 0.45);
    for (const gd of CBZ.guards || []) {
      if (!alive(gd)) continue;
      gd.alert = Math.max(0, (gd.alert || 0) - 0.55);
      if ((CBZ.game.detection || 0) < 42 || gd.corrupt) gd.hunt = Math.max(0, (gd.hunt || 0) - 1.5);
    }
  }

  function clampWorld(x, z) {
    const W = CBZ.WORLD || { minX: -34, maxX: 34, minZ: -43, maxZ: 51 };
    return {
      x: Math.max(W.minX, Math.min(W.maxX, x)),
      z: Math.max(W.minZ, Math.min(W.maxZ, z)),
    };
  }

  function misdirectSearch(n, strength) {
    strength = Math.max(1, strength || 2);
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    const nx = n.group.position.x, nz = n.group.position.z;
    const away = Math.atan2(nz - pz, nx - px) + (rng() - 0.5) * 1.4;
    const range = 8 + Math.min(14, strength * 1.25) + rng() * 5;
    const lead = clampWorld(nx + Math.cos(away) * range, nz + Math.sin(away) * range);
    const who = n.data.name.replace(/^the |^a |^an /, "");
    CBZ.game.lastKnown = {
      x: lead.x,
      z: lead.z,
      t: 8 + Math.min(8, strength * 0.55),
      amount: Math.max(4, ((CBZ.game.lastKnown && CBZ.game.lastKnown.amount) || 12) - strength),
      type: "false lead",
      heardOnly: true,
      source: `${who}'s rumor`,
    };
    let sent = 0;
    for (const gd of CBZ.guards || []) {
      if (!alive(gd) || gd.corrupt || gd.bribed > 0) continue;
      if (sent >= 3) break;
      if ((gd.hunt || 0) <= 0 && !gd.investigate && (CBZ.game.detection || 0) < 18) continue;
      gd.investigate = { x: lead.x, z: lead.z, t: 5.5 + sent * 1.1, scan: 0, type: "false lead" };
      gd.alert = Math.max(gd.alert || 0, 0.55);
      gd.hunt = Math.max(0, (gd.hunt || 0) - 1.0);
      sent++;
    }
    return lead;
  }

  function findProtector(snitch) {
    const gang = protectionGang();
    if (gang == null) return null;
    const standing = gangStanding(gang);
    if (standing < 12 && gangProtection(gang) <= 0) return null;

    let best = null, bs = -Infinity;
    for (const ally of CBZ.npcs) {
      if (ally === snitch || !alive(ally) || ally.gang !== gang || ally.foe || ally.aiState === "snitch") continue;
      const dSnitch = dist(ally, snitch);
      const dPlayer = playerDist(ally);
      if (dSnitch > 14 && dPlayer > 15) continue;
      const p = ally.personality || {};
      const score = standing * 0.03 + (p.loyalty || 0.5) * 1.25 + (p.nerve || 0.5) * 0.85 - dSnitch * 0.055 - dPlayer * 0.025;
      if (score > bs) { bs = score; best = ally; }
    }
    return best;
  }

  function tryGangInterceptSnitch(snitch, amount, meta) {
    const gang = protectionGang();
    if (!snitch || gang == null || (meta && meta.copCrime)) return false;
    if (snitch.gang === gang) return false;
    const ally = findProtector(snitch);
    if (!ally) return false;

    const standing = gangStanding(gang);
    const p = ally.personality || {};
    const paid = gangProtection(gang) > 0 ? 0.16 : 0;
    const chance = Math.min(0.82, 0.18 + paid + standing / 120 + (p.loyalty || 0.5) * 0.24 + (p.nerve || 0.5) * 0.18);
    if (rng() > chance) return false;

    ally.memory = null;
    snitch.memory = null;
    snitch.snitchHeat = 0;
    snitch.snitchT = 0;
    snitch.snitchMeta = null;
    if (CBZ.prisonBrain) CBZ.prisonBrain.dropReport(snitch, "crew");
    addGangStanding(gang, -3);

    if ((p.nerve || 0) > ((snitch.personality && snitch.personality.nerve) || 0.4) + 0.18) {
      snitch.aiState = "flee";
      snitch.fleeT = 2.8 + rng() * 2;
      snitch.foe = null;
      snitch.target.set((rng() - 0.5) * 48, 0, 8 + rng() * 38);
      emote(ally, "");
      emote(snitch, "!");
    } else {
      startFight(ally, snitch);
      emote(ally, "");
    }

    return true;
  }

  function eligibleProtector(ally, gang) {
    if (!ally || !alive(ally) || ally.gang !== gang || ally.role === "merchant" || ally.role === "dealer") return false;
    if (ally._demand || ally.aiState === "fight"
 || ally.aiState === "snitch" || ally.huntPlayer > 0) return false;
    return true;
  }

  function findProtectorForThreat(gang, threat, maxDist) {
    if (gang == null || !alive(threat)) return null;
    const standing = gangStanding(gang);
    const cover = gangProtection(gang);
    const committed = (CBZ.player && CBZ.player.gang === gang) || cover > 0 || standing > 10;
    if (!committed) return null;
    let best = null, bs = -Infinity;
    for (const ally of CBZ.npcs || []) {
      if (ally === threat || !eligibleProtector(ally, gang)) continue;
      const dThreat = dist(ally, threat);
      const dPlayer = playerDist(ally);
      if (dThreat > (maxDist || 16) && dPlayer > 14) continue;
      const p = ally.personality || {};
      const score =
        standing * 0.035 +
        cover * 0.035 +
        (p.loyalty || 0.5) * 1.4 +
        (p.nerve || 0.5) * 0.9 -
        dThreat * 0.060 -
        dPlayer * 0.025 +
        (ally.isLeader ? 0.4 : 0) +
        crewRoleScore(ally, "crewBackup") * 0.16;
      if (score > bs) { bs = score; best = ally; }
    }
    return best;
  }

  function startGangIntercept(ally, threat, mode) {
    if (!ally || !threat) return false;
    ally.aiState = "interceptThreat";
    ally.interceptTarget = threat;
    ally.interceptMode = mode || "pressure";
    ally.interceptT = mode === "snitch" ? 7.5 : 5.5;
    ally.foe = null;
    ally.social = null;
    emote(ally, mode === "snitch" ? "" : "");
    return true;
  }

  /* ==========================================================================
     A DEMAND IS A REAL SITUATION, ON THE DEMAND LADDER (CBZ.brain.demand).

     Owner (2026-10-22): "'Pay and it goes away.' 'No smokes.' That kind of
     thing, what the fuck, just completely dumb random bullshit." Nobody in
     the yard walks up to you on a timer with a pitch any more (the old
     approach system: thirty-odd pitch kinds rolled off dice and cooldowns,
     a card of Pay / Haggle / Threaten / Refuse, is deleted). A man comes to
     you with a demand only when the thing he is demanding is real:

       debt    his crew's tab on you (gangDebt: you hit their people, you
               walked off what you owed) has run past DEBT_DEMAND. One of
               them, the collector first, comes and collects.
       rules   you are sitting in their seat, on their phone, in their
               shower turn (systems/prisoncars.js begins it).

     The ladder decides (demand -> warn -> show -> act, his nerve, his friends
     beside him, your gun); this is the prison's body for it: walk up, hold
     and face you, square up, and on the act a real hunt (requestHunt). The
     lines are CBZ.voice's (mood "debt"), spoken over his head by the brain.
     Your answer is a DECISION on him (interact.js: Pay, Work) or your body
     (walk off, run, swing, draw).

       CBZ.prisonDemand.begin(n, kind, opts) -> bool   kind "debt" | "rules"
         opts: { cost, gang, inside() (rules: still in violation), lines }
       CBZ.prisonDemand.of(n) -> the live demand or null
       CBZ.prisonDemand.pay(n)  CBZ.prisonDemand.workOff(n)
       CBZ.prisonDemand.cancel(n)  CBZ.prisonDemand.busy(except)
     ========================================================================== */
  const DEBT_DEMAND = 10;          // a crew's tab that sends somebody
  const DEMAND_GAP = 90;           // s between one crew's collections
  function DM() { return CBZ.brain && CBZ.brain.demand; }
  function demandOf(n) { return n && n._demand && n._demand.active ? n._demand : null; }
  function demandBusy(except) {
    for (const n of CBZ.npcs || []) if (n !== except && demandOf(n) && alive(n)) return true;
    return false;
  }
  function debtDemandCost(gang) {
    const debt = gangDebt(gang);
    return Math.max(2, Math.ceil(debt * 0.6));
  }
  const DEBT_LINES = {
    left: ["You still owe.", "We'll find you."],
    fled: ["Run, then. You still owe.", "We know where you sleep."],
    gaveup: ["Next time.", "This ain't over."],
    backoff: ["Alright. Alright.", "Easy. We'll talk later."],
  };
  const ROBBED_LINES = {
    demand: ["Give it back.", "That's mine. Give it back."],
    warn: ["I said give it back."],
    show: ["Last chance."],
    comply: ["That's right."],
    left: ["This ain't over."],
    fled: ["Run, then. We know where you sleep."],
    gaveup: ["Next time."],
    backoff: ["Alright. Alright."],
  };
  function beginDemand(n, kind, opts) {
    opts = opts || {};
    const L = DM();
    if (!L || !alive(n) || demandOf(n) || !CBZ.player || CBZ.player.dead) return false;
    if (n.cuffed || n.intimidMode === "scared" || heldInCell(n)) return false;
    let c = null;
    try {
      c = L.begin(n, CBZ.player, kind === "rules" ? "trespass" : "rob", {
        mood: kind === "debt" ? "debt" : null,
        leaveR: kind === "debt" || kind === "robbed" ? 16 : 0,
        lines: opts.lines || (kind === "debt" ? DEBT_LINES : kind === "robbed" ? ROBBED_LINES : null),
        hard: kind === "robbed" ? (opts.friends || []).length >= 2 : undefined,
        friends: kind === "robbed" ? (opts.friends || []).length : undefined,
        armed: false,
      });
    } catch (e) { c = null; }
    if (!c) return false;
    n._demand = {
      active: true, kind, gang: opts.gang != null ? opts.gang : n.gang,
      cost: opts.cost || 0, paid: false, inside: opts.inside || null, t: 0,
      friends: opts.friends || null,
    };
    n.aiState = "demandPlayer";
    n.foe = null; n.pause = 0; n.social = null;
    const g = CBZ.game || {};
    g.demands = (g.demands || 0) + 1;
    return true;
  }
  function endDemand(n, outcome) {
    const D = n && n._demand;
    if (!D) return;
    n._demand = null;
    const L = DM();
    if (L && outcome !== "done") { try { L.cancel(n); } catch (e) {} }
    if (n.aiState === "demandPlayer") { n.aiState = "wander"; n.aiTimer = 0.4 + rng() * 0.6; }
    const g = CBZ.game || {};
    if (D.kind === "debt" && D.gang >= 0) {
      const gap = g.debtDemandT || (g.debtDemandT = []);
      gap[D.gang] = DEMAND_GAP;
    }
  }
  // the player, as the ladder reads him
  const _ds = { dist: 99, speed: 0, armed: false, aiming: false, attacking: false, paid: false, inside: undefined, fled: false, handsUp: false };
  function readPlayer(n, D, d) {
    _ds.dist = d;
    _ds.speed = 0;
    _ds.armed = !!(CBZ.playerArmed && CBZ.playerArmed());
    _ds.aiming = false;          // a gun on HIM is intimidate.js's, which ends this
    _ds.attacking = (n.huntPlayer || 0) > 0;
    _ds.paid = !!D.paid;
    _ds.inside = D.inside ? !!D.inside() : undefined;
    _ds.fled = false;
    _ds.handsUp = false;
    return _ds;
  }
  // the end of it, any way: what it leaves on the books
  function demandOutcome(n, D, r) {
    const out = r.outcome;
    const gang = D.gang;
    if (out === "acted") {
      // he does what he said: a real fight, the one blow at a time aiThink throws
      if (r.act === "throw" || r.act === "shove") n._huntStyle = "shove";
      requestHunt(n, D.kind === "debt" ? 9 : 6, D.kind === "debt" ? "debt" : D.kind === "robbed" ? "wronged" : "rules");
      // the friends he brought: their hands are in it with his
      if (D.friends) for (const f of D.friends) if (alive(f) && f.group) requestHunt(f, 7, "wronged");
      if (D.kind === "debt" && gang >= 0) addGangStanding(gang, -3);
      return;
    }
    if (D.kind !== "debt" || gang < 0) return;
    if (out === "left" || out === "fled") {
      addGangDebt(gang, 2);
      addGangStanding(gang, -3);
      snubbed(n, 6);
    } else if (out === "gaveup" || out === "backed") {
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
    }
  }
  // aiThink's "demandPlayer" state: the ladder's step, carried out on his body
  function demandThink(n, dt) {
    const D = demandOf(n), L = DM();
    if (!D || !L || CBZ.game.state !== "playing") { endDemand(n, null); return null; }
    D.t += dt;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    const d = Math.hypot(px - n.group.position.x, pz - n.group.position.z);
    let r = null;
    try { r = L.step(n, dt, readPlayer(n, D, d)); } catch (e) { r = null; }
    if (!r) { endDemand(n, null); return null; }
    if (r.step === "done" || r.step === "act") {
      endDemand(n, "done");
      demandOutcome(n, D, r);
      return null;
    }
    const face = function () { n._faceYaw = Math.atan2(px - n.group.position.x, pz - n.group.position.z); n._faceTTL = 0.3; };
    if (r.act === "approach" || r.act === "close") {
      const stop = r.act === "close" ? 1.1 : 1.9;
      if (d > stop) { n.target.set(px, 0, pz); return n.baseSpeed * (r.act === "close" ? 1.35 : 1.15); }
    }
    if (r.act === "close" && n.char) n.char.fightStance = true;
    n.target.set(n.group.position.x, 0, n.group.position.z);
    face();
    return 0;
  }
  // PAY: what he asked, or what you have. A short payment still comes off
  // the tab; he takes it and goes.
  function payDemand(n) {
    const D = demandOf(n);
    if (!D || (D.kind !== "debt" && D.kind !== "robbed")) return { ok: false, msg: "" };
    if (D.kind === "robbed") {
      // what you took off him, back in his hand (or what you have of it)
      const have = (CBZ.game && CBZ.game.cigs) || 0;
      if (have <= 0) return { ok: false, msg: "" };
      const back = Math.min(have, D.cost || 1);
      CBZ.econ.addCigs(-back);
      n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 3);
      CBZ.sfx && CBZ.sfx("coin");
      D.paid = true;
      return { ok: true, msg: "" };
    }
    const cigs = (CBZ.game && CBZ.game.cigs) || 0;
    if (cigs <= 0) return { ok: false, msg: "" };
    const amt = Math.min(cigs, D.cost || debtDemandCost(D.gang));
    CBZ.econ.addCigs(-amt);
    if (D.gang >= 0) {
      addGangDebt(D.gang, -Math.max(amt * 2, 4));
      addGangStanding(D.gang, 4);
      addGangProtection(D.gang, 12 + amt * 2);
      for (const m of CBZ.npcs) if (m.gang === D.gang) m.huntPlayer = 0;
    }
    n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
    CBZ.sfx && CBZ.sfx("coin");
    D.paid = true;              // the ladder reads it next step: complied, he goes
    return { ok: true, msg: "" };
  }

  /* WHO OF A CREW COLLECTS: the collector, then the enforcer, a man with
     nerve, close enough to have seen you. */
  function bestCollector(gang, maxDist) {
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.gang !== gang || n.role === "merchant" || n.role === "dealer" || n._demand) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0 || n.aiState === "interceptThreat") continue;
      if (n.cuffed || heldInCell(n) || n._propSeat) continue;
      const d = playerDist(n);
      if (d < 3 || d > (maxDist || 15)) continue;
      const p = n.personality || {};
      const score = (p.nerve || 0.5) * 1.2 + (p.greed || 0.5) * 0.6 + crewRoleScore(n, "debtCollect") * 0.2 - d * 0.06;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }
  // a man of a crew that stands with you keeps close when the screws look
  function bestGangActor(gang, maxDist) {
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.gang !== gang || n.role === "merchant" || n.role === "dealer" || n._demand) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0 || n.aiState === "interceptThreat") continue;
      const d = playerDist(n);
      if (d > (maxDist || 16)) continue;
      const p = n.personality || {};
      const role = crewRole(n);
      const score = (p.loyalty || 0.5) * 1.2 + (p.nerve || 0.5) * 0.9 - d * 0.055 + (n.isLeader ? 0.75 : 0) +
        crewRoleScore(n, "crewBackup") * 0.18 + (role === "lookout" ? 1.0 : 0);
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }

  function updateGangThresholds(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    const gap = g.debtDemandT || (g.debtDemandT = []);
    const timers = g.gangTierT || (g.gangTierT = [0, 0]);
    const heat = g.detection || 0;
    const caseHeat = CBZ.caseSummary ? ((CBZ.caseSummary() || {}).heat || 0) : 0;
    const searchHeat = heat > 22 || caseHeat > 14 || (g.witnessReportT || 0) > 0 || (g.lastKnown && g.lastKnown.t > 0);
    for (let gang = 0; gang < NCARS(); gang++) {
      gap[gang] = Math.max(0, (gap[gang] || 0) - dt);
      timers[gang] = Math.max(0, (timers[gang] || 0) - dt);
      if (timers[gang] > 0) continue;
      timers[gang] = 1.5;

      const standing = gangStanding(gang);
      const debt = gangDebt(gang);
      const sameCrew = CBZ.player && CBZ.player.gang === gang;
      const onTurf = CBZ.player && isOnTurf(gang, CBZ.player.pos);
      const respected = standing >= 48 || (sameCrew && standing >= 14);

      // A CREW THAT STANDS WITH YOU covers you when the screws are looking
      if (respected && (sameCrew || onTurf || searchHeat)) {
        if (gangProtection(gang) < 7 || searchHeat) {
          addGangProtection(gang, 10 + Math.min(18, Math.max(0, standing) * 0.18) + (sameCrew ? 8 : 0));
          addBuzz("heat", -4, "standing-cover");
          if (searchHeat && CBZ.reduceCasePressure) CBZ.reduceCasePressure(2 + Math.max(0, standing) * 0.035);
          const ally = bestGangActor(gang, searchHeat ? 18 : 13);
          if (ally) {
            ally.aiState = "shadowPlayer";
            ally.shadowT = Math.max(ally.shadowT || 0, 9 + rng() * 6 + Math.max(0, standing) * 0.05);
            ally.foe = null;
            emote(ally, "+");
          }
        }
        timers[gang] = 5 + rng() * 3;
        continue;
      }

      // A TAB YOU REALLY OWE: one of them comes to collect it
      if (g.role === "cop" || sameCrew || debt < DEBT_DEMAND || gap[gang] > 0) continue;
      if (gangProtection(gang) > 0 || demandBusy() || huntersNow() > 0 || playerDownedNow() || playerCuffedNow()) continue;
      const collector = bestCollector(gang, onTurf ? 17 : 14);
      if (!collector) continue;
      if (beginDemand(collector, "debt", { gang, cost: debtDemandCost(gang) })) gap[gang] = DEMAND_GAP;
    }
  }

  /* ROBBED: HE COMES BACK FOR IT (owner: "someone you robbed comes back and
     demands it"). A man you robbed (the gunpoint rob, intimidate.js) keeps
     what you took on his mind. A while later, once he has you in sight, a
     man with the nerve for it, or his crew behind him, walks up with them and
     runs the demand ladder on you (CBZ.brain.demand "rob", the take is what
     you took): Pay is the decision on him; walking off, running and swinging
     are your body, and when it comes to hands his friends' are in it too. */
  const ROBBED = [];
  const ROB_BACK_MIN = 70, ROB_BACK_SPREAD = 120, ROB_GIVEUP = 900;
  let robbedT = 0;
  function rememberRobbed(n, took) {
    if (!n || n === CBZ.player || n.kind === "guard" || n.kind === "warden") return;
    const now = (CBZ.game && +CBZ.game.elapsed) || 0;
    for (const r of ROBBED) if (r.n === n) { r.amt += took; return; }
    ROBBED.push({ n: n, amt: took, t0: now, due: now + ROB_BACK_MIN + rng() * ROB_BACK_SPREAD });
    if (ROBBED.length > 10) ROBBED.shift();
  }
  function updateRobbedComeback(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || !ROBBED.length) return;
    robbedT -= dt;
    if (robbedT > 0) return;
    robbedT = 1;
    if (g.role === "cop" || demandBusy() || huntersNow() > 0 || playerDownedNow() || playerCuffedNow()) return;
    const now = +g.elapsed || 0;
    for (let i = ROBBED.length - 1; i >= 0; i--) {
      const r = ROBBED[i], n = r.n;
      if (!alive(n) || n.cuffed || now - r.t0 > ROB_GIVEUP || now < r.t0 - 1) { ROBBED.splice(i, 1); continue; }
      if (now < r.due || n._demand || n.aiState === "fight" || n.aiState === "flee" || (n.fleeT || 0) > 0 || heldInCell(n) || n.intimidMode) continue;
      const d = playerDist(n);
      if (d > 16 || d < 2.5) continue;                 // he has to have found you
      // who he brings: his crew, standing near him
      const friends = [];
      if (n.gang >= 0) for (const m of CBZ.npcs || []) {
        if (friends.length >= 2) break;
        if (m === n || !alive(m) || m.gang !== n.gang || m._demand || m.cuffed || heldInCell(m) || m.aiState === "fight") continue;
        if (dist(m, n) < 12) friends.push(m);
      }
      const p = n.personality || {};
      const nerve = (p.nerve != null ? p.nerve : 0.5) + friends.length * 0.18;
      ROBBED.splice(i, 1);
      if (nerve < 0.55) return;                        // he lets it go
      if (beginDemand(n, "robbed", { cost: r.amt, friends: friends })) {
        // his friends walk up behind him and stand there
        for (const f of friends) { f.aiState = "shadowPlayer"; f.shadowT = Math.max(f.shadowT || 0, 18); f.foe = null; }
      }
      return;
    }
  }
  function updateGangPresence(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    g.gangPresenceT = Math.max(0, (g.gangPresenceT || 0) - dt);
    if (g.gangPresenceT > 0) return;
    g.gangPresenceT = 0.85 + rng() * 0.75;

    const gang = protectionGang();
    if (gang != null) {
      const snitch = (CBZ.npcs || []).find((n) => alive(n) && n.aiState === "snitch" && n.gang !== gang && playerDist(n) < 24);
      if (snitch) {
        const ally = findProtectorForThreat(gang, snitch, 18);
        if (ally && startGangIntercept(ally, snitch, "snitch")) {
          addBuzz("snitch", -5, "crew-intercept");
          return;
        }
      }

      const hunter = (CBZ.npcs || []).find((n) => alive(n) && n.huntPlayer > 0 && n.gang !== gang && playerDist(n) < 18);
      if (hunter) {
        const ally = findProtectorForThreat(gang, hunter, 14);
        if (ally && startGangIntercept(ally, hunter, "rival")) {
          return;
        }
      }
    }

  }

  function kill(victim, killer, opts) {
    opts = opts || {};
    if (!victim || victim.dead) return;
    victim.dead = true;
    victim.ko = 0;
    victim.hp = 0;
    // CINEMATIC death — blood + flying gibs at the body. Player kills get a
    // beefier burst + a hit cue; NPC-vs-NPC brawls just spray (no sound spam).
    if (CBZ.gore && victim.group && !opts.noGore) {
      const vp = victim.group.position;
      const kg = killer && killer.group;
      const playerKill = !!(kg && CBZ.playerChar && kg === CBZ.playerChar.group);
      CBZ.gore(vp.x, vp.y + 1.1, vp.z, {
        dir: kg ? { x: vp.x - kg.position.x, z: vp.z - kg.position.z } : null,
        amount: playerKill ? 1.2 : 0.85, player: false, sfx: playerKill ? "hit" : false,
        // How he was killed, forwarded rather than guessed. gore.js already
        // branches on this ("blade" → arterial arcs, "blunt" → a slow well);
        // this choke point simply never passed it, so every death in the
        // prison — shanking included — sprayed like a gunshot.
        melee: opts.melee || null,
        // WHO: the body the blood belongs to, so a blade kill's arterial
        // pulse rides the falling body instead of the spot he stood on
        actor: victim,
        // a round through him sprays out of the far side (the gun paths say
        // so, V.roundExits); a blade or a fist never exits
        exit: opts.melee ? false : (opts.exit != null ? !!opts.exit : undefined),
      });
    }
    victim.aiState = "dead";
    victim.foe = null;
    victim.social = null;
    if (victim._demand) endDemand(victim, null);

    victim.huntPlayer = 0;
    victim.hunt = 0;
    victim.alert = 0;
    victim.bribed = 0;
    credit(killer, "kills");
    CBZ.game.deaths = (CBZ.game.deaths || 0) + 1;
    if (victim.wedge) victim.wedge.visible = false;
    // THE BODY GOES DOWN (systems/prisoncorpse.js -> systems/bodyfall.js): the
    // killer's shove is real root momentum that slides against the walls, not
    // the 1.1 m position write this line used to teleport him with (which
    // started a corpse killed against a wall INSIDE it).
    if (CBZ.prisonCorpsePlace) CBZ.prisonCorpsePlace(victim, killer, {
      force: opts.force != null ? opts.force : (opts.noKnock ? 5 : 8), dirX: opts.dirX, dirZ: opts.dirZ,
    });
    if (killer === CBZ.player) addBuzz("fear", 25, actorName(victim));
    if (victim.gang >= 0 && killer && CBZ.playerChar && killer.group === CBZ.playerChar.group) {
      noteGangIncident(victim, "kill", victim.isLeader ? 18 : 13, { source: "killing" });
    }
    // THE BODY LEAVES ITS THINGS ON THE FLOOR (systems/prisondrops.js). This
    // is the ONE prison kill choke point — combat.js, fpsmode, capture.js and
    // killstreaks all arrive here through CBZ.aiKill — so it is the only place
    // the drop needs hooking. prisonDrop takes the man's pockets PHYSICALLY
    // (economy.js's rollDrops consumes them), so the frisk below finds an
    // already-looted body and pays nothing twice. Flag it off and the frisk
    // gets its loot back untouched.
    if (CBZ.prisonDrop) CBZ.prisonDrop(victim);
    // loot: a PLAYER kill frisks the body for everything they were carrying;
    // an NPC-vs-NPC death just leaves a small stash pack on the ground.
    const playerKill = killer && CBZ.playerChar && killer.group === CBZ.playerChar.group;
    // (owner: "if I kill someone I shouldn't need to search": the drop above is
    // the loot; the invisible frisk is only the flag-off fallback)
    if (playerKill) { if (CBZ.CONFIG.PRISON_DROPS_V1 === false && CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(victim, {}); }
    else if (!opts.noDrop && CBZ.addPack) CBZ.addPack(victim.group.position.x, victim.group.position.z, 6);
    // THE CLIQUE'S NERVE (CBZ.brain.morale). This used to send EVERY living
    // member of a dead shotcaller's set, anywhere in the compound, into a
    // 3.5 s flee on the same frame — a man across the yard who never saw it
    // bolted with the rest. Now the death is a hit on the clique's morale (the
    // leader's the heaviest), and the men who were IN it and whose own nerve
    // breaks run for their houses; the steady ones hold.
    if (CBZ.prisonBrain) {
      CBZ.prisonBrain.memberDown(victim, killer, true);
      const byInmate = killer && killer.group && !(CBZ.playerChar && killer.group === CBZ.playerChar.group);
      if (byInmate && carK(victim) >= 0 && carK(killer) !== carK(victim) && CBZ.npcs.indexOf(killer) >= 0) answerFor(victim, killer, 1);
    }
    // leadership passes to a surviving gang-mate
    if (victim.isLeader && victim.gang >= 0) {
      victim.isLeader = false;
      const heir = CBZ.npcs.find((m) => m.gang === victim.gang && alive(m) && m !== victim) ||
        CBZ.npcs.find((m) => m.yardCar === victim.gang && alive(m) && m !== victim);
      if (heir) { if (heir.gang !== victim.gang) setClique(heir, victim.gang); heir.isLeader = true; leaders[victim.gang] = heir; }
    }
    // A DEATH HAS A SURFACE ALREADY, AND IT IS NOT A HINT LINE. city/killfeed.js
    // owns the ONE sanctioned popup in this game (engine-systems.md), and every
    // death in the world is supposed to funnel through it. This one never did —
    // it printed its own sentence beside the corner feed instead. One call, and
    // the yard's killings read the same way the city's do.
    if (!opts.quiet && CBZ.player && Math.hypot(CBZ.player.pos.x - victim.group.position.x, CBZ.player.pos.z - victim.group.position.z) < 22) {
      const who = victim.data ? victim.data.name.replace(/^the |^a |^an /, "") : "someone";
      if (CBZ.cityLogDeath) {
        try {
          CBZ.cityLogDeath(who, opts.cause || "beaten",
            { by: playerKill ? "You" : (killer && killer.data && killer.data.name) || "" });
        } catch (e) {}
      }
    }
  }

  // credit a combat event onto whoever caused it (NPC, guard, or player)
  function credit(by, field) {
    if (!by) return;
    if (!by.record) by.record = { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
    by.record[field] = (by.record[field] || 0) + 1;
  }

  /* A MAN PUT ON THE FLOOR BY ANOTHER MAN. There is no death dice here any
     more (it used to be a 3% roll on a fist and 22% on steel): fists knock
     men out and steel opens bleeds, and CBZ.vitals decides who dies of what.
     down(actor, by, dir) plays a short knockdown and books the consequences;
     downed(actor, by) books them for a man vitals already put down. */
  function down(actor, by, dir) {
    // he goes down in his own rig along the blow (entities/meleeposes.js:
    // knees, hips, back; the ko timer holds him there, then the get-up)
    const V = CBZ.verbs;
    let kd = dir;
    if (!kd && by && by.group) {
      const dx = actor.group.position.x - by.group.position.x, dz = actor.group.position.z - by.group.position.z, l = Math.hypot(dx, dz) || 1;
      kd = { x: dx / l, z: dz / l };
    }
    if (!(V && V.knockdown && V.knockdown(actor, { dir: kd, ko: true, dur: 2 + rng() * 2.5, power: 0.8 }))) actor.ko = Math.max(actor.ko || 0, 3 + rng() * 2);
    downed(actor, by);
  }
  function downed(actor, by) {
    credit(by, "knockdowns");
    credit(actor, "downs");
    actor.hp = Math.max(actor.hp || 0, Math.round((actor.maxHp || 100) * 0.5)); actor.aiState = "wander"; actor.foe = null;
    if (actor.char) actor.char.fightStance = false;
    // PUT A MAN DOWN AND YOU HAVE MADE AN ENEMY — his, and his crew's. This is
    // the retaliation loop: today's beating is tomorrow's reason, which is what
    // a yard with a memory feels like from the inside.
    if (by && by !== CBZ.player) {
      addBeef(actor, by, 14);
      // HIS PEOPLE ANSWER, AND HOW HARD IS PROPORTIONAL (CBZ.brain.social.
      // retaliate): a man put down by fists gets his crew squaring up; a man
      // put down by steel can get steel back. It used to book the same +5 beef
      // on the nearest two whatever had happened.
      // (a screw's baton is the law's business, not a crew's: no riot over it)
      if (carK(actor) >= 0 && carK(by) !== carK(actor) && by.kind !== "guard" && by.kind !== "warden") answerFor(actor, by, by._shankOut || (by._steelT || 0) > 0 ? 0.85 : 0.5);
    }
    // his clique's nerve takes it (the shotcaller down is the big one)
    if (CBZ.prisonBrain) CBZ.prisonBrain.memberDown(actor, by, false);
    if (actor.gang >= 0 && by === CBZ.player) addGangStanding(actor.gang, -14);
    if (by === CBZ.player) addBuzz("fear", 12, actorName(actor));
  }
  /* TWO MEN FIGHTING BOX EACH OTHER. This used to be exchangeBlows: every
     0.7 s both men lost stat damage and NEITHER moved — a yard fight was two
     inmates standing chest to chest while their hp ticked down. Now each man
     in a fight is a CBZ.verbs.fighter (systems/verbs_strike.js): combinations
     with rhythm, the guard back between them, a read on the other man's
     wind-up to cover or slip it, footwork in and out of range, never more
     than 4 blows in 2 s. The stat damage lives in boxLanded and is paid only
     by blows that actually land (a blocked one chips through the forearms). */
  const BOX_O = { perform: true, onLand: boxLanded };
  const BOX_SHANK = { kind: "shank", blade: true, mass: 0.2 };
  // his fighter is made once (seeded off the yard's rng) and kept on him
  function boxer(a) {
    if (a._boxF) return a._boxF;
    const guardish = a.kind === "guard" || a.kind === "warden";
    const fr = (a.ratings && a.ratings.fighting) || (guardish ? 72 : 50);
    return (a._boxF = CBZ.verbs.fighter(a, { skill: Math.min(1, fr / 100), aggression: guardish ? 0.6 : 0.4 + fr / 250, seed: (rng() * 1e9) | 0 }));
  }
  function boxTick(n, f, dt) {
    const V = CBZ.verbs;
    if (!V || !V.fighter) return;
    // a man your fist just caught does not throw back on the same beat
    // (a shank out in his hand is what he swings: slashes and the point)
    const bn = boxer(n);
    bn.weapon = n._shankOut ? BOX_SHANK : null;
    if ((n.hitCD || 0) <= 0) bn.tick(dt, f, BOX_O);
    // a screw who was swung on answers from here (his own brain is guards.js);
    // an inmate who stood his ground runs his own fight state and his own fighter
    const answers = (f.kind === "guard" || f.kind === "warden") && alive(f) && !(f.aiState === "fight" && f.foe === n);
    if (answers && (f.hitCD || 0) <= 0) boxer(f).tick(dt, n, BOX_O);
  }
  function boxLanded(res) {
    const n = res.attacker, f = res.target;
    if (!alive(f) || !alive(n) || f === CBZ.player || !f.group) { res.reaction = "none"; return; }
    const guardN = n.kind === "guard" || n.kind === "warden";
    const guardF = f.kind === "guard" || f.kind === "warden";
    const nf = (n.ratings && n.ratings.fighting) || (guardN ? 72 : 50);
    const ft = (f.ratings && f.ratings.toughness) || (guardF ? 78 : 50);
    if (f.hp == null) f.hp = f.maxHp || 100;
    if (n._boxFoe !== f) { n._boxFoe = f; credit(n, "fights"); }
    // hp = how much more he takes on his feet: base swing × attacker's
    // fighting edge × defender's toughness × where it landed. It is a gauge,
    // never a death: what the blow does to his BODY is CBZ.vitals' call.
    // STEEL: a man who came for this answer with a blade in his pocket uses it
    const steel = ((n._steelT || 0) > 0 && carriesShank(n)) || n._shankOut ? 2.4 : 1;
    f.hp -= ((guardN ? 7 : 4) + rng() * (guardN ? 4 : 5)) * (0.55 + nf / 80) * (1 - ft / 320) * (res.dmgMul || 1) * steel;
    // every blow shakes the man who takes it (his nerve, not his hp)
    if (CBZ.brain && CBZ.brain.morale && f._brain) CBZ.brain.morale.rattle(f, steel > 1 ? 0.35 : 0.12);
    // THE FIRST BLOW of a beef is when his people notice: a glare, a shove
    // (proportional: a punch never brings a blade)
    if (!guardF && carK(f) >= 0 && (CBZ.game.elapsed || 0) - (f._retAt || -1e9) > 6) {
      f._retAt = CBZ.game.elapsed || 0;
      answerFor(f, n, steel > 1 ? 0.7 : 0.2);
    }
    if (guardF) f.alert = 2.5;
    // BEING HIT IS A REASON. This is where most of the yard's beef is booked,
    // and it is why violence here comes back around: the man on the receiving
    // end of a beating remembers who gave it to him long after this fight ends.
    if (!res.blocked) addBeef(f, n, 3.2);
    // TWO OTHER MEN FIGHTING IS NOT A SOUND IN YOUR HEAD: CBZ.worldSfx
    // attenuates by range, is silent past 42 m and gives the whole yard one
    // voice that the NEAREST fight owns (tools/sound-census.mjs).
    if (CBZ.worldSfx) CBZ.worldSfx("punch", f.group.position.x, f.group.position.z, { y: f.group.position.y });
    const VT = CBZ.vitals;
    if (!VT) {
      if (f.hp <= 0) { res.reaction = "none"; f.hp = 1; down(f, n, res.dir); }
      return;
    }
    if (res.blocked) { if (f.hp < 1) f.hp = 1; return; }
    if (steel > 1) {
      // THE POINT GOES IN: a bleed where it went in; out of hp he goes down
      // bleeding, and he dies only of what it hit or of the blood
      if (CBZ.bodyWound) { try { CBZ.bodyWound(f, res.point, { melee: "blade", cal: 0.7, fromX: n.group.position.x, fromZ: n.group.position.z }); } catch (e) {} }
      if (CBZ.goreImpact) CBZ.goreImpact(res.point.x, res.point.y, res.point.z, { amount: 0.7, blade: true, dir: { x: res.dir.x, y: 0.35, z: res.dir.z } });
      const W = VT.wound(f, { kind: "stab", zone: res.zone, point: res.point, by: n,
        dirX: res.dir.x, dirZ: res.dir.z, fromX: n.group.position.x, fromZ: n.group.position.z, critical: f.hp <= 0 });
      if (f.hp <= 0) f.hp = 1;
      if (f.dead || W.outcome === "dead") { res.reaction = "dead"; return; }
      if (W.outcome === "down") { res.reaction = "none"; downed(f, n); }
      return;
    }
    if (f.hp < 1) f.hp = 1;
    // A FIST: daze, and the jaw is where knockouts live
    const out = VT.blunt(f, { zone: res.zone || "head", power: res.power, weapon: BOX_WEAPON[res.kind] || "fist",
      heavy: !!res.heavy, by: n, dirX: res.dir.x, dirZ: res.dir.z, mul: (0.55 + nf / 80) / 1.175 * (guardN ? 1.15 : 1),
      fromX: n.group.position.x, fromZ: n.group.position.z });
    if (out === "ko") { res.reaction = "none"; downed(f, n); }
    else if (out === "knockdown") { res.reaction = "none"; down(f, n, res.dir); }
    else if (out === "stagger") res.stagger = true;
    else if (out === "dead") res.reaction = "dead";
  }
  const BOX_WEAPON = { elbow: "elbow", headbutt: "headbutt", knee: "knee", kick: "kick", roundKick: "kick", lowKick: "kick" };

  // ---- the per-NPC think, returns desired move speed ----
  function aiThink(n, dt) {
    if (!inited) initWorld();
    // a man dealt in after the yard was sorted (cellblock.js deals its cast late)
    if (n._baseGang === undefined) setClique(n, assignClique(n, CBZ.npcs.indexOf(n)));
    if (n.hp == null) initActor(n);
    if (n.memory && n.memory.t > 0) {
      n.memory.t -= dt;
      if (n.memory.t <= 0) n.memory = null;
    }
    // grudges between inmates cool, and standing on a rival's grass heats.
    // Both are cheap and both run every frame because a feud is a pressure,
    // not an event: it is what makes the fight that eventually happens land
    // as the consequence of something the player could have watched building.
    fadeBeef(n, dt);
    // and so does what he is owed — slower, because a debt outlives a punch
    if (contractsOn()) fadeTabs(n, dt);
    if (n.aiState !== "fight") turfFriction(n, dt);
    if (n.blockRead && n.blockRead.t > 0) {
      n.blockRead.t -= dt;
      if (n.blockRead.t <= 0) n.blockRead = null;
    }

    if ((n.reportedPlayerT || 0) > 0) {
      n.reportedPlayerT = Math.max(0, n.reportedPlayerT - dt);
      if (n.reportedPlayerT <= 0) clearKnownReport(n);
      else if (n.aiState === "wander" && !n._propSeat && playerDist(n) < 7 &&
          (CBZ.game.elapsed || 0) > (n._nervT || 0) && rng() < 0.012) {
        n.aiState = "flee";
        n.fleeT = 1.6 + rng() * 1.8;
        n._nervT = (CBZ.game.elapsed || 0) + 8;          // one bolt, then he holds his nerve a while
        emote(n, "!");
      }
    }
    if (n.copMarked > 0) {
      n.copMarked = Math.max(0, n.copMarked - dt);
      if (n.copMarked > 0 && n.aiState === "wander" && CBZ.game.role === "cop" && playerDist(n) < 13 && rng() < 0.012) emote(n, "!");
    }
    if (n.dead) return 0;
    // a demand is over the moment something realer has him: a gun on him, a
    // screw's order, the cuffs, a fight
    if (n._demand && (n.aiState !== "demandPlayer" || n.huntPlayer > 0 || n.cuffed || (n.ko || 0) > 0 || n.intimidMode === "scared")) endDemand(n, null);

    // HELD AT GUNPOINT: if the player is pointing a gun at this inmate, the

    // intimidation system owns its behavior (hands up / draw / stand-off).
    // think() returns a move speed (0 = frozen) while reacting, else null.
    if (CBZ.intimidate) {
      const is = CBZ.intimidate.think(n, dt);
      if (is != null) return is;
    }
    // CUFFED, ROUTING, OR ANSWERING A SCREW'S ORDER (systems/brain_prison.js):
    // the brain's answer — comply / flee / keep swinging, held for a dwell —
    // owns him until it is over
    if (CBZ.prisonBrain) {
      const lw = CBZ.prisonBrain.inmateThink(n, dt);
      if (lw != null) return lw;
      // A GUN IS OUT (brain_prison.js 5c): whoever is set on the player —
      // however he got set, including files that write huntPlayer directly —
      // answers the gun through the brain before the hunt below may walk him
      // at it. Only a blade in its window comes through (returns null).
      const gw = CBZ.prisonBrain.gunThink ? CBZ.prisonBrain.gunThink(n, dt) : null;
      if (gw != null) return gw;
    }
    if ((n._steelT || 0) > 0) n._steelT -= dt;

    // GANG RETALIATION: hunting the player down (set by provokeGang).
    //
    // THIS IS THE OWNER'S OWN EXAMPLE, AND IT WAS THE WORST ONE. A man who had
    // decided to jump you closed to 1.9 m and then the game printed the
    // sentence "X jumps you!" — while what actually happened to your BODY was a
    // half-second stun and four points of heat. No swing, no contact, no blood,
    // no health. The caption WAS the assault.
    //
    // What happens now is the assault, and nothing is captioned: he squares up
    // (fightStance), winds and throws a real punch on the rig every other
    // character in this game already owns (character.js's punchT arc), the fist
    // lands as a hit on the player through the ONE escape-mode damage entry
    // (CBZ.hurtPlayer, systems/capture.js — hp, stun, red flash, shake, sfx),
    // and a body that is out of punches GRABS you instead: the shared seize
    // grammar (CBZ.predatorSeize, style "drag") with its one telegraphed
    // break-free press. Nothing here is new machinery; four existing systems
    // are being called by a file that used to write a string instead.
    if ((n._brokenUpT || 0) > 0) {
      // a screw broke it up: he backs off and does not come again for a while
      n._brokenUpT -= dt;
      if (n.huntPlayer > 0) { n.huntPlayer = 0; cutSwing(n); if (n.char) n.char.fightStance = false; }
    }
    if (n.huntPlayer > 0 && playerDownedNow() && !lethalGrudge(n)) {
      // you are down. He made his point; he walks off and leaves it there.
      n.huntPlayer = 0; cutSwing(n);
      n._brokenUpT = Math.max(n._brokenUpT || 0, 25);
      if (n.char) n.char.fightStance = false;
      n.aiState = "wander"; n.aiTimer = 0.5 + rng();
    }
    if (n.huntPlayer > 0 && playerCuffedNow() && !lethalGrudge(n) &&
        (n._huntWhy !== "cheap" || ((n.jumpBlows || 0) > (n._cheapShot || 0) && !swinging(n)))) {
      // you are in cuffs: whatever he came for, it is not a fight any more.
      // The cheap shot gets its one blow, then he walks off smirking.
      n.huntPlayer = 0; cutSwing(n); n._cheapShot = null;
      n._brokenUpT = Math.max(n._brokenUpT || 0, 20);
      if (n.char) n.char.fightStance = false;
      n.aiState = "wander"; n.aiTimer = 0.5 + rng();
    }
    if (n.huntPlayer > 0 && !huntSlot(n)) {
      // two men are already on you: he is the ring around it, not the pile
      n.huntPlayer -= dt;
      cutSwing(n);
      if (n.char) n.char.fightStance = false;
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      const dx = n.group.position.x - px, dz = n.group.position.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      const ang = Math.atan2(dz, dx) + (n.tailSide || 1) * 0.35;
      const r = 4.6 + ((n.slice || 0) % 3) * 0.6;
      const pos = clampWorld(px + Math.cos(ang) * r, pz + Math.sin(ang) * r);
      n.target.set(pos.x, 0, pos.z);
      n._faceYaw = Math.atan2(-dx, -dz); n._faceTTL = 0.3;   // mover turns him (CBZ.moves)
      return d < r - 0.8 ? n.baseSpeed * 0.8 : n.baseSpeed * 1.05;
    }
    if (n.huntPlayer > 0) {
      n.huntPlayer -= dt;
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      n.target.set(px, 0, pz);
      const d = Math.hypot(px - n.group.position.x, pz - n.group.position.z);
      n.hitCD -= dt;
      // he SQUARES UP inside striking range — the wind-up is the telegraph, and
      // it is what the printed line used to stand in for.
      if (n.char) n.char.fightStance = d < 3.4;
      // the blow in flight lands on its own frame (CBZ.verbs.strike; see throwBlow)
      if (d < 1.9 && n.hitCD <= 0 && !swinging(n)) {
        // two men are already swinging: he waits his turn and keeps his feet
        if (swingCrowded(n)) { n.hitCD = 0.22 + rng() * 0.30; return n.baseSpeed * 1.5; }
        n.hitCD = HUNT_HIT_CD;
        n.jumpBlows = (n.jumpBlows || 0) + 1;
        /* THE GRAB IS RARE NOW, AND THAT IS THE POINT (owner, verbatim: "in
           prison game look how when attacked you get spun around. This is very
           unrealistic for a human attacking you").

           He is right, and the reason is structural rather than a tuning
           mistake. `CBZ.predatorSeize` is the ANIMAL grab: systems/predator.js
           possesses the lens and orbits it around the attacker's jaw for the
           whole hold (predator.js:1350 driveCamera, `h.camPh += dt * …`), which
           is a magnificent read on a bear that has you in its mouth and an
           absurd one on a man who has grabbed your shirt in a yard. It was
           firing on EVERY third blow — i.e. on essentially every fight that
           lasted three seconds — so the animal camera was the prison's default
           melee experience.

           It is not deleted, because a man grabbing you and taking you off your
           feet is real and it is the best thing in the fight when it lands. It
           is now what it should always have been: uncommon, late, and once per
           man. Everything the count used to spend on grabs is spent below on
           an actual beating instead — elbows, knees, headbutts, body shots,
           shoves — which is the exchange the owner asked for. */
        const grabP = (CBZ.CONFIG && CBZ.CONFIG.JAIL_GRAB_P != null)
          ? +CBZ.CONFIG.JAIL_GRAB_P : JUMP_GRAB_P_DEFAULT;
        // THE GRAB IS A MAN'S, NOT A BEAR'S (CBZ.verbs.grab): both fists in your
        // collar, your hands on his wrists, a second of it, then he throws you
        // where the yard lets him (a wall, the rail, the floor). No orbiting lens.
        const V = CBZ.verbs;
        const grabs = n.jumpBlows >= 5 && !n._jumpGrabbed && rng() < grabP &&
          V && V.grab && !(CBZ.game && (CBZ.game.invuln || 0) > 0) && !n._seizing;
        if (grabs && V.grab(n, V.playerActor(), {
          holdFor: 1.1, then: "throw",
          onOutcome: function (S, kind) {
            if (S.verb === "throw" && CBZ.hurtPlayer) CBZ.hurtPlayer(kind === "wall" ? 14 : 9, n.group.position.x, n.group.position.z, { melee: true, by: n });
          },
          onEnd: function () { n.jumpBlows = 0; if (n.char) n.char.fightStance = false; },
        })) {
          n._jumpGrabbed = 1;              // his one takedown this fight is spent
          CBZ.addHeat(4);
          return n.baseSpeed * 1.5;
        }
        /* the swing itself, on the shared rig — and if he pulled a shank
           (systems/prisonshanks.js sets `_shankOut` when a carrier commits to
           a fight), it is a THRUST, not a fist. The blade hand is the right
           one because that is the socket his model hangs off; without pinning
           it, every other blow would be an empty left fist thrown while the
           shiv hung at his side. */
        const stabbing = !!n._shankOut;
        /* THE BEATING ITSELF — "more normal shit", which in a prison yard means
           a man throwing every close-quarters strike he has, not one jab on
           loop with an uppercut every third beat (which is literally what this
           was: `punchKind = jumpBlows % 3 === 0 ? "upper" : ""`).

           The vocabulary is chosen by RANGE and by how long he has been on you,
           because that is what decides it in a real fight:
             · first exchange, at arm's length — straights and hooks;
             · once it closes up (under 1.35 m) the long punches stop working
               and the short weapons come out: elbows, knees, the headbutt;
             · a man who has been swinging a while starts throwing to the BODY,
               and a man who wants room throws a shove instead of a punch.
           Every one of these is a real pose on the shared rig — three of them
           (elbow, headbutt, knee) were added to entities/character.js for this,
           because the rig had five strikes and a brawl needs more than that. */
        const closed = d < 1.35;
        const blows = n.jumpBlows;
        const r = rng();
        let kind = "", kick = null;
        if (n._huntStyle === "shove") { kind = "shove"; n.huntPlayer = Math.min(n.huntPlayer, 0.5); n._huntStyle = null; }
        else if (stabbing) kind = "stab";
        else if (closed && r < 0.22) kind = "headbutt";
        else if (closed && r < 0.46) kind = "elbow";
        else if (closed && r < 0.60) kick = "knee";
        else if (r < 0.14 && blows >= 2) kind = "shove";      // make room, then reset
        else if (r < 0.34) kind = "hook";
        else if (r < 0.48) kind = "upper";
        else kind = "";                                        // the straight: still the staple
        /* AND EACH ONE COSTS SOMETHING DIFFERENT, or the vocabulary above is
           choreography over one number. These are the honest relationships:
           an elbow is short and sharp (less damage than a hook, more stun
           because it lands on bone); a knee to the body takes the wind out of
           you (the most stun in the set); a headbutt is the heaviest single
           strike a bare-handed man has and it costs him too; a shove barely
           hurts and is thrown for the ground it buys. */
        const M = MELEE_BLOW[kick ? "knee" : (stabbing ? "stab" : kind)] || MELEE_BLOW[""];
        /* AND THE MAN THROWING IT IS A BODY TOO. The table above says what the
           BLOW is worth; what it costs YOU also depends on who is throwing it,
           and every inmate in this yard used to hit with identical weight
           whatever they were built like. Two adult men come out at 1.0, so the
           prison plays exactly as it did unless the man jumping you is
           genuinely bigger or smaller than you. */
        const swing = (M.dmg + rng() * M.roll) *
          (CBZ.meleeScale ? CBZ.meleeScale(n, CBZ.player) : 1);
        // the swing on his rig (a knee is the leg; the blade is the right hand;
        // the straight alternates lead jab and rear cross); it lands on the
        // frame it reaches you, or it does not
        const side = (blows & 1) ? "r" : "l";
        const vk = kick ? "knee" : stabbing ? "stab" : kind === "" ? (side === "l" ? "jab" : "cross") : kind;
        const arm = kick ? side : stabbing ? "r" : (kind === "" || kind === "shove" || kind === "headbutt") ? undefined : side;
        if (throwBlow(n, vk, arm, M, swing, stabbing)) logSwing(n);
      }
      return n.baseSpeed * 1.5;
    }
    // he broke off (or the hunt timed out): the blow count and his one
    // takedown both reset, so "once" means once per fight and not once ever
    if (n.jumpBlows) { n.jumpBlows = 0; n._jumpGrabbed = 0; cutSwing(n); if (n.char) n.char.fightStance = false; }
    n._huntStyle = null;

    // DEFEND: once you've joined a gang, your crew jumps whoever's hunting you
    if (CBZ.player.gang != null && n.gang === CBZ.player.gang && n.aiState !== "fight") {
      for (const a of nearbyNpcs(n, 12, _defendNear)) {
        if (a.huntPlayer > 0 && alive(a) && dist(n, a) < 12) {
          // two of yours on him is help; the whole set piling in is a riot
          let on = 0;
          for (const m of _defendNear) if (m !== n && m.foe === a && m.aiState === "fight") on++;
          if (on < 2) { startFight(n, a); break; }
        }
      }
      const d = playerDist(n);
      if (n.aiState === "wander" && d > 4 && d < 13 && ((CBZ.game.detection || 0) > 28 || CBZ.econ.rng() < 0.006)) {
        const side = (n.personality && n.personality.loyalty > 0.5) ? -1 : 1;
        n.target.set(CBZ.player.pos.x + side * (1.8 + rng() * 1.5), 0, CBZ.player.pos.z - 1.6 - rng());
        if (rng() < 0.02) emote(n, "");
        return n.baseSpeed * 1.25;
      }
    }

    if (n.aiState === "wander" && n.role !== "merchant" && n.role !== "dealer" && CBZ.playerArmed && CBZ.playerArmed()) {
      // A GUN IN THE YARD. This rolled 2.8% PER THINK for every man within
      // 8 m, so a crowd near an armed player flickered wander/flee/wander and
      // a man on a bench stood, ran, came back and sat, over and over. Each
      // man now reads the threat through the brain (his nerve, his crew, his
      // wounds) and holds what he decided for a couple of seconds; a seated
      // man only gets up for a gun that is close.
      const d = Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z);
      if (d < (n._propSeat ? 4 : 8) && CBZ.prisonBrain) CBZ.prisonBrain.armedNear(n, d);
    }
    considerCornered(n);

    n.aiTimer -= dt;

    switch (n.aiState) {
      case "demandPlayer": {
        const sp = demandThink(n, dt);
        if (sp != null) return sp;
        break;
      }

      case "tailPlayer": {
        n.tailT -= dt;
        const kind = n.tailKind || "watch";
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const dxp = px - n.group.position.x, dzp = pz - n.group.position.z;
        const d = Math.hypot(dxp, dzp);
        if (n.tailT <= 0 || CBZ.game.state !== "playing" || d > 24) {
          n.tailT = 0; n.tailKind = null; n.tailCommitT = 0;
          n.aiState = "wander"; n.aiTimer = 0.2 + rng() * 0.6;
          break;
        }

        if (kind !== "cover" && CBZ.playerArmed && CBZ.playerArmed() && d < 6.2 && ((n.personality && n.personality.nerve) || 0.5) < 0.58) {
          n.tailT = 0; n.tailKind = null; n.tailCommitT = 0;
          n.aiState = "flee"; n.fleeT = 1.8 + rng() * 1.8; emote(n, "!");
          break;
        }

        const g = CBZ.game || {};
        if (n.tailCommitT > 0 && n.tailT <= n.tailCommitT && d < 12.5) {
          n.tailCommitT = 0;
          // his crew keeps close; a man who followed you to see where you
          // went goes and tells (nobody walks up to sell you anything)
          if (kind === "cover") {
            n.aiState = "shadowPlayer";
            n.shadowT = Math.max(n.shadowT || 0, 8 + rng() * 5);
            emote(n, "+");
            return n.baseSpeed * 1.1;
          }
          if (kind === "snitch") {
            const cprof = casePressureProfile();
            const amount = Math.max(10, (g.lastKnown && g.lastKnown.amount) || cprof.heat * 0.35 || (g.detection || 0) * 0.35 || 10);
            const lastKnown = { x: px, z: pz, type: "watched", heardOnly: false };
            n.memory = n.memory || { type: "crime", amount, t: 16, kind: "watched", lastKnown };
            sendNpcToSnitch(n, amount, { lastKnown, type: "watched", heardOnly: false });
            return n.baseSpeed * 1.45;
          }
        }

        if (kind === "cover") {
          const threat = (CBZ.npcs || []).find((m) => alive(m) && m !== n && playerDist(m) < 12 && (m.aiState === "snitch" || m.huntPlayer > 0) && m.gang !== n.gang);
          if (threat) {
            n.aiState = "shadowPlayer";
            n.shadowT = Math.max(n.shadowT || 0, 7 + rng() * 5);
            emote(n, "+");
            return n.baseSpeed * 1.35;
          }
        }

        const radius = kind === "cover" ? 3.5 : (kind === "fear" ? 8.4 : (kind === "snitch" ? 7.3 : 6.5));
        const base = d > 0.01 ? Math.atan2(n.group.position.z - pz, n.group.position.x - px) : rng() * Math.PI * 2;
        const angle = base + (n.tailSide || 1) * (kind === "cover" ? 0.48 : 0.78);
        const desired = d < radius - 0.8 ? radius + 1.2 : radius;
        const pos = clampWorld(px + Math.cos(angle) * desired, pz + Math.sin(angle) * desired);
        n.target.set(pos.x, 0, pos.z);
        n._faceYaw = Math.atan2(dxp, dzp); n._faceTTL = 0.3;
        if (rng() < (kind === "fear" ? 0.012 : 0.006)) emote(n, kind === "cover" ? "+" : "?");
        return n.baseSpeed * (kind === "cover" ? 1.18 : 0.95);
      }
      case "interceptThreat": {
        n.interceptT -= dt;
        const target = n.interceptTarget;
        const mode = n.interceptMode || "pressure";
        const targetActive = alive(target) && (mode !== "snitch" || target.aiState === "snitch") && (mode !== "rival" || target.huntPlayer > 0 || target.aiState === "fight");
        if (!targetActive || n.interceptT <= 0 || CBZ.game.state !== "playing") {
          n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
          n.aiState = "wander"; n.aiTimer = 0.2 + rng() * 0.5;
          break;
        }
        n.target.set(target.group.position.x, 0, target.group.position.z);
        if (dist(n, target) < 2.2) {
          const p = n.personality || {};
          if (mode === "snitch") {
            target.memory = null;
            target.snitchHeat = 0; target.snitchT = 0; target.snitchMeta = null;
            if (CBZ.prisonBrain) CBZ.prisonBrain.dropReport(target, "crew");
            if ((p.nerve || 0.5) + (p.loyalty || 0.5) * 0.35 > ((target.personality && target.personality.nerve) || 0.45) + 0.12 || rng() < 0.45) {
              target.aiState = "flee"; target.fleeT = 2.4 + rng() * 2.2; target.foe = null;
              emote(n, ""); emote(target, "!");
              addBuzz("snitch", -9, "crew-block");
              addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
              n.aiState = "shadowPlayer"; n.shadowT = Math.max(n.shadowT || 0, 5 + rng() * 4);
              n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
            } else {
              startFight(n, target);
            }
          } else {
            startFight(n, target);
            addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
          }
        }
        return n.baseSpeed * 1.65;
      }
      case "rumorHuddle": {
        const p = n.huddlePartner;
        n.huddleT -= dt;
        if (!alive(p) || n.huddleT <= 0 || CBZ.game.state !== "playing") {
          const shouldAct = !!n.huddleLead && alive(n) && CBZ.game.state === "playing";
          if (p && p.huddlePartner === n) clearRumorHuddle(p);
          if (shouldAct && resolveRumorHuddle(n)) return n.baseSpeed;
          clearRumorHuddle(n);
          n.aiState = "wander";
          n.aiTimer = 0.15 + rng() * 0.5;
          break;
        }
        const dx = p.group.position.x - n.group.position.x;
        const dz = p.group.position.z - n.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 2.15) {
          n.target.set(p.group.position.x, 0, p.group.position.z);
          return n.baseSpeed * 0.85;
        }
        n.target.set(n.group.position.x, 0, n.group.position.z);
        n._faceYaw = Math.atan2(dx, dz); n._faceTTL = 0.3;
        if (rng() < 0.018) emote(n, n.huddleKind === "wealth" || n.huddleKind === "debt" || n.huddleKind === "badge" ? "$" : "?");
        return 0;
      }
      case "snitch": {
        n.snitchT -= dt;
        const g = nearestGuard(n);
        if (g) n.target.set(g.group.position.x, 0, g.group.position.z);
        if (!g || dist(n, g) < 2.5 || n.snitchT <= 0) {
          const amount = n.snitchHeat || 12;
          const reportMeta = Object.assign({}, n.snitchMeta || {}, { copCrime: !!n.snitchCop || !!(n.snitchMeta && n.snitchMeta.copCrime) });
          // THE REPORT LANDS THROUGH THE BRAIN (systems/brain_prison.js
          // onReport -> playerReported below): a report the brain was holding
          // for this walk is filed now; any other snitch run lands the same way.
          const PBr = CBZ.prisonBrain;
          if (!(PBr && PBr.fileReport(n, g))) {
            if (PBr) PBr.reportNow(n, g, amount, reportMeta);
            else playerReported(n, amount, reportMeta, g);
          }
          n.aiState = "flee"; n.fleeT = 2.0 + rng() * 2; n.snitchHeat = 0; n.snitchCop = false; n.snitchMeta = null;
        }
        return n.baseSpeed * 1.85;
      }
      case "shadowPlayer": {
        n.shadowT -= dt;
        if (n.shadowT <= 0) { n.aiState = "wander"; n.aiTimer = 0.2; break; }

        for (const other of nearbyNpcs(n, 9, _shadowNear)) {
          if (other === n || !alive(other)) continue;
          if (other.aiState === "snitch" && dist(n, other) < 9 && other.gang !== n.gang) {
            other.aiState = "flee"; other.fleeT = 2.8; other.snitchT = 0; other.snitchHeat = 0;
            if (CBZ.prisonBrain) CBZ.prisonBrain.dropReport(other, "crew");
            other.snitchMeta = null;
            emote(n, ""); emote(other, "!");
            addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
            if (playerDist(n) < 16) {
              // TOLD: your man saw it and hands you the name. That is the third
              // way into snitchKnown, and the only one that costs you nothing
              // but having a friend.
              learnSnitch(other, "told");
              say(n, `${other.data ? other.data.name.replace(/^the |^a |^an /, "") : "He"} was going to the COs. Not anymore.`, null, 2.0);
            }
            break;
          }
          if (other.huntPlayer > 0 && dist(n, other) < 8 && other.gang !== n.gang) {
            startFight(n, other);
            break;
          }
        }
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const side = (n.personality && n.personality.loyalty > 0.5) ? -1 : 1;
        n.target.set(px + side * 2.2, 0, pz + 1.7);
        return n.baseSpeed * 1.25;
      }
      case "diversion": {
        n.diversionT -= dt;
        const gd = nearestGuard(n);
        if (!gd || n.diversionT <= 0) {
          n.aiState = "flee"; n.fleeT = 2.0 + rng() * 1.5; n.aiTimer = 0;
          break;
        }
        n.target.set(gd.group.position.x, 0, gd.group.position.z);
        const d = dist(n, gd);
        if (d < 3.1) {
          const dx = n.group.position.x - gd.group.position.x;
          const dz = n.group.position.z - gd.group.position.z;
          gd.group.rotation.y = CBZ.moves.face(CBZ.moves.motor(gd), gd.group.rotation.y, Math.atan2(dx, dz), dt);
          gd.alert = Math.max(gd.alert || 0, 0.7);
          gd.hunt = Math.max(0, (gd.hunt || 0) - dt * 2.2);
          if (rng() < 0.035) emote(n, "!");
        }
        return n.baseSpeed * 1.55;
      }
      case "socialize": {
        const p = n.social;
        if (!alive(p) || dist(n, p) > 12 || heldInCell(n) || heldInCell(p)) { n.aiState = "wander"; n.social = null; n.aiTimer = 0; break; }
        if (dist(n, p) < 2.2) {
          n.socialT = 0;
          n.target.set(n.group.position.x, 0, n.group.position.z); // stop and chat
          if (n.aiTimer <= 0) {
            n.aiTimer = 1.4 + rng() * 2;
            emote(n, rng() < 0.4 ? "" : rng() < 0.5 ? "" : "♥");
            // MONEY CHANGES HANDS WHERE MEN STOP TO TALK. The same exchange
            // that already books gossip and arguments is where a tab gets
            // opened — so the yard's debts are made in front of you, on the
            // days commissary and the card games happen, instead of on a
            // background timer nobody can see.
            mintTab(n, p);
            gossip(n, p);
            if (n.aiState === "snitch") return n.baseSpeed * 1.85;
            // IT TURNED. A fight that starts out of a conversation is the one
            // the player can see coming, so this is where it is allowed to
            // start — not on some later wander tick in a different corner of
            // the yard. Crew or not: the man is named by the argument, so the
            // "never jump your own crew" default does not apply to him.
            if (argue(n, p)) {
              const want = wantsToSwing(n, p);
              if (want > 0 && rng() < want) { startFight(n, p); break; }
              if (rng() < 0.3) { n.aiState = "wander"; n.social = null; n.aiTimer = 0.4 + rng(); } // walked off
              break;
            }
            // a man riding under his car sometimes gets pulled into its
            // business by one of its active men; another car's man never is
            if (n.gang < 0 && p.gang >= 0 && rng() < 0.3 && n.yardCar === p.gang && rng() < 0.1) setClique(n, p.gang);
            if (rng() < 0.45) { n.aiState = "wander"; n.social = null; }
          }
        } else {
          // A PAL YOU CANNOT GET TO IS NOT A PAL. Ten seconds walking at a man
          // through a wall (a sitter in an alcove, a resident behind his own
          // grille) and he lets it go — measured: 8 s pressed to a cell front
          // with the friend a metre away on the wrong side of it.
          n.socialT = (n.socialT || 0) + dt;
          if (n.socialT > 10) { n.aiState = "wander"; n.social = null; n.socialT = 0; n.aiTimer = 1 + rng() * 2; break; }
          n.target.set(p.group.position.x, 0, p.group.position.z);
        }
        return n.baseSpeed * 0.9;
      }
      case "fight": {
        const f = n.foe;
        // a man dropped to a knee by a body shot who is still in it with you
        // (his foe is still you) is not a finished fight: you stand over him
        const winded = f && !f.dead && !f.escaped && (f.ko || 0) > 0 && f.foe === n && f.aiState === "fight";
        if ((!alive(f) && !winded) || dist(n, f) > 14) { n.aiState = "wander"; n.foe = null; n.aiTimer = 0; if (n.char) n.char.fightStance = false; break; }
        n.target.set(f.group.position.x, 0, f.group.position.z);
        n.hitCD -= dt;
        if (winded) return 0;
        // inside a step of him the fighter owns the feet (it steps in, out and
        // round); the mover only closes the gap
        const fd = dist(n, f);
        if (fd < 2.6) boxTick(n, f, dt);
        // break off when badly hurt — how readily depends on temperament
        if (n.hp < (n.maxHp || 100) * 0.3 && rng() < behaviorOf(n).fleeHurt * 0.06) {
          n.aiState = "flee"; n.fleeT = 2.5; n.foe = null; emote(n, "");
          cutSwing(n); if (n.char) n.char.fightStance = false;
        }
        return fd < 1.6 ? 0 : n.baseSpeed * 1.45;
      }
      case "flee": {
        n.fleeT -= dt;
        // ONE PLACE TO RUN TO, PICKED ONCE. This re-rolled a random far corner
        // every 0.6 s, so a fleeing man zig-zagged across the yard. Whatever
        // aimed him (away from a screw, away from a gun) is kept if it is a
        // real distance off; otherwise one far corner, held until he is there.
        const gp = n.group.position;
        if (n._fleeX == null) {
          const tx = n.target.x, tz = n.target.z;
          if (Math.hypot(tx - gp.x, tz - gp.z) > 4) { n._fleeX = tx; n._fleeZ = tz; }
          else { n._fleeX = (rng() - 0.5) * 84; n._fleeZ = 6 + rng() * 110; }
        } else if (Math.hypot(n._fleeX - gp.x, n._fleeZ - gp.z) < 1.5) {
          n._fleeX = (rng() - 0.5) * 84; n._fleeZ = 6 + rng() * 110;
        }
        n.target.set(n._fleeX, 0, n._fleeZ);
        if (n.fleeT <= 0) { n.aiState = "wander"; n._fleeX = n._fleeZ = null; }
        return n.baseSpeed * 1.7;
      }
      case "shoveAt": {
        // HIS CREW'S HAND IN YOUR CHEST: walk up to the man who put one of
        // ours down, shove him (act.verb "shove"), walk off
        const t = n._shoveAt;
        n._shoveT = (n._shoveT || 0) - dt;
        if (!alive(t) || n._shoveT <= 0) { n.aiState = "wander"; n._shoveAt = null; n.aiTimer = 0.5 + rng(); break; }
        n.target.set(t.group.position.x, 0, t.group.position.z);
        if (dist(n, t) < 1.3) {
          const B = CBZ.brain;
          if (!(B && B.act && B.act.verb("shove", n, t)) && CBZ.prisonBrain) CBZ.prisonBrain.shove(t, n);
          if (CBZ.npcStare) CBZ.npcStare(n, 2.5, t.group.position);
          n.aiState = "wander"; n._shoveAt = null; n.aiTimer = 1.2 + rng();
          return 0;
        }
        return n.baseSpeed * 1.1;
      }
      case "escape": {
        const ez = (CBZ.WORLD && CBZ.WORLD.exit.z) || 52;
        // A RUN NEEDS A WAY OUT. A man inside the cell house with the block
        // gate racked shut has nowhere to run to, and this state used to run
        // him at the leaf anyway — for the rest of the night (measured
        // 2026-09-04, tools/prison-nav-check.mjs: 8 s pressed into the gate at
        // (0,-8) once the wing's residents were let off their leash). He
        // thinks better of it and goes back to his business.
        if (blockGateShut(n)) { n.aiState = "wander"; n.aiTimer = 2 + rng() * 3; break; }
        // ONE GAP IN THE WIRE, PICKED ONCE. This re-rolled the spot every
        // think — up to six metres sideways — so a runner at the fence
        // zigzagged along it and a runner 150 m off threw his route away
        // each tick and re-planned from scratch (measured: 28 s of a count
        // block stalled on one man). He picks his gap and keeps it.
        if (n.aiTimer <= 0 || n._escX == null) { n._escX = (rng() - 0.5) * 6; n.aiTimer = 4 + rng() * 4; }
        n.target.set(n._escX, 0, ez + 2);
        if (n.group.position.z > ez - 2) {
          n.escaped = true; n.group.visible = false;
        }
        return n.baseSpeed * 1.6;
      }
      default: { // wander
        if (n.aiTimer <= 0) {
          n.aiTimer = 1.5 + rng() * 3;
          // shut in: his room is the whole world until the leaf opens (heldInCell)
          if (heldInCell(n)) { CBZ.npcPickTarget(n); return n.baseSpeed * 0.7; }
          // locked in the cell house with a yard patch for a region: the hall
          // is his yard tonight, not the far side of the racked gate
          if (blockGateShut(n)) { n.target.set((rng() - 0.5) * 5, 0, -12 - rng() * 22); return n.baseSpeed * 0.8; }
          // re-evaluate: settle something, make a run for it, or just roam.
          // WHETHER they start a fight is now the answer to "does this man
          // have a reason, and is anyone watching" (wantsToSwing) instead of a
          // roll against temperament and how close somebody was standing.
          const b = behaviorOf(n);
          const foe = findBrawlTarget(n);
          if (foe) {
            const want = wantsToSwing(n, foe);
            if (want > 0 && rng() < want) { startFight(n, foe); break; }
            // A REASON YOU DON'T ACT ON IS STILL A REASON: he holds the look,
            // the beef stays booked, and it fades or it comes due later.
            if (want > 0 && rng() < 0.3) emote(n, "!");
          }
          const pal = findPal(n);
          if (pal && rng() < 0.45) { n.aiState = "socialize"; n.social = pal; break; }
          if (rng() < 0.015 && !blockGateShut(n)) { n.aiState = "escape"; break; }
          // HIS CAR'S ROUTINE: his car's end of the table at chow, its spot on
          // the yard, its phone, its turn in the shower (systems/prisoncars.js)
          if (PCARS() && PCARS().errand(n)) { /* target set */ }
          // an active man with no errand holds his car's ground
          else if (n.gang >= 0 && !(n.data && n.data.cell) && (rng() < 0.4 || !isOnTurf(n.gang, n.group.position))) pickTurfTarget(n);
          else CBZ.npcPickTarget(n);
        }
        return n.baseSpeed;
      }
    }
    return n.baseSpeed;
  }

  // "is this man locked inside the cell house" — in the block, and world/
  // door.js's leaf across the throat is shut. The only exit is that leaf.
  function blockGateShut(n) {
    const S = CBZ.prisonSchedule, d = CBZ.door;
    if (!S || !S.inBlock || !d || d.open || d.blown) return false;
    const p = n.group.position;
    return S.inBlock(p.x, p.z, 0.5);
  }
  CBZ.blockGateShut = blockGateShut;

  // called by systems/state.js on restart: revive everyone, re-elect leaders
  function aiReset() {
    for (const n of CBZ.npcs) {
      n.dead = false; n.escaped = false; n.group.visible = true; n.group.rotation.z = 0;
      n.group.position.y = 0; n._lvy = 0;
      if (CBZ.prisonCorpseClear) CBZ.prisonCorpseClear(n);   // no sprawl in a revived man's shoulders
      n.snitchHeat = 0; n.snitchCop = false; n.snitchT = 0; n.snitchMeta = null;
      clearKnownReport(n);
      n.memory = null;
      n.copMarked = 0;
      // A FRESH RUN IS A FRESH LEDGER. Tabs (and the job one of them became)
      // are per-run memory exactly like beef is; carrying them across a death
      // would have men collecting on debts from a life the player didn't live.
      n._tabs = null;
      // THE YARD'S MEMBERSHIP IS PER RUN. A drifter the Reds picked up last
      // run is back to minding his own business; without this, recruiting in
      // socialize() only ever grew the gangs, run after run.
      if (n._baseGang !== undefined && n.gang !== n._baseGang) setClique(n, n._baseGang);
      n._snubs = 0; n._brokenUpT = 0; n._huntWhy = ""; n._provokeHp = null;
      n.isLeader = false; initActor(n);
    }
    _hunters.length = 0; _maxHuntersSeen = 0; _huntStarts = 0; _huntRefused = 0;
    if (CBZ.prisonBrain) CBZ.prisonBrain.reset();
    CBZ.game.demands = 0;
    CBZ.game.debtDemandT = null;
    CBZ.game.contract = null;
    for (const g of CBZ.guards) { g.hp = null; g.dead = false; if (CBZ.prisonCorpseClear) CBZ.prisonCorpseClear(g); }
    electLeaders();
    if (PCARS()) PCARS().reset();
    CBZ.game.carClaim = null; CBZ.game.carClaimTries = 0;
    if (CBZ.player) { CBZ.player.yardCar = null; }
  }

  /* THE WRONGED MAN COMES FOR YOU, AND WHOEVER OF HIS SAW IT.

     This used to set huntPlayer on every living member of the victim's gang,
     wherever they stood: one punch, or one walked-off demand past a threshold,
     and half the prison crossed the compound to jump you. That was the whole
     "everybody hates me" complaint in one loop.

     Now: the man himself, plus at most two of his own crew who are within
     12 m of him and close enough to the player to have seen it. The clique's
     STANDING still drops (that is reputation, and it travels by word of
     mouth), but the fists are local. Every hunt still goes through the
     governor, so the most that actually swing at once is 2 (3 at ultra).

     opts: { crew: max helpers (default 2, 0 = alone), why, standing: how much
     the clique's standing drops (default 6), started: true when the player
     plainly threw the first blow } */
  function provokeGang(victim, dur, opts) {
    if (!victim) return 0;
    opts = opts || {};
    dur = dur || 12;
    if (victim.gang >= 0) dur += Math.min(4, gangDebt(victim.gang) * 0.12);
    const wasOnYou = (victim.huntPlayer || 0) > 0 || !!demandOf(victim);
    // DID YOU START IT? A hit that took hp off a man who was not coming at you.
    const hpNow = victim.hp != null ? victim.hp : 0;
    const hpWas = victim._provokeHp != null ? victim._provokeHp : (victim.maxHp || 100);
    victim._provokeHp = hpNow;
    const struck = !!opts.started || (opts.why == null && hpNow < hpWas - 0.5);
    if (struck && !wasOnYou && victim.kind !== "guard" && victim.kind !== "warden") reportPlayerFight(victim);

    // HITTING BACK IS NOT A NEW WRONG. combat.js calls this on every landed
    // punch; a man who came for you and is eating your fists does not cost
    // you his clique's standing per punch (that is how debt used to hit 99
    // in one fight). He just keeps coming.
    if (wasOnYou && (victim.huntPlayer || 0) > 0 && opts.why == null) {
      requestHunt(victim, Math.min(dur, 8), "wronged");
      return 0;
    }
    let started = 0;
    if (requestHunt(victim, dur, "wronged")) started++;
    if (victim.gang >= 0) {
      addGangStanding(victim.gang, -(opts.standing != null ? opts.standing : 6));
      noteGangIncident(victim, "attack", Math.max(3, Math.min(8, dur * 0.42)), { skipStanding: true, skipDebt: true, source: "fight", noResponders: true });
    }
    // HIS CAR ANSWERS, active in its business or not: a man is backed by his car
    if (carK(victim) >= 0) {
      if (PCARS() && playerCar() >= 0 && playerCar() !== carK(victim)) PCARS().addTension(playerCar(), carK(victim), struck ? 3 : 1);
      const want = opts.crew != null ? opts.crew : 2;
      if (want > 0 && victim.group) {
        // HOW BAD WAS IT: what came off him (or his life), or the words that
        // started it. The brain turns that into who of his answers and how —
        // a shove gets glares and a shove back, a stabbing gets men coming.
        const drop = Math.max(0, hpWas - hpNow) / (victim.maxHp || 100);
        const harm = victim.dead ? 1 : struck ? Math.min(1, 0.18 + drop * 2.6) : 0.22;
        started += answerFor(victim, CBZ.player, harm, want, dur);
      }
    }
    return started;
  }

  /* HIS CLIQUE ANSWERS — CBZ.brain.social.retaliate picks who and how hard
     (glare | shove | fight | weapon); this plays it in the yard. At most
     `max` men actually come (fight/weapon), the rest look or step in with a
     hand. Returns how many came at the aggressor. */
  function carriesShank(n) {
    const items = n && n.loadout && n.loadout.items;
    return !!(items && (items.indexOf("Shiv") >= 0 || items.indexOf("Shank") >= 0));
  }
  function answerFor(victim, aggressor, harm, max, dur) {
    const PBr = CBZ.prisonBrain;
    if (!PBr || !victim || !aggressor || carK(victim) < 0) return 0;
    const isP = aggressor === CBZ.player;
    const list = PBr.retaliate(victim, aggressor, harm);
    const cap = max != null ? max : 2;
    const ap = isP ? CBZ.player.pos : aggressor.group.position;
    let came = 0, shoved = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i].actor, lvl = list[i].level;
      if (!alive(m) || m.cuffed || (m._routT || 0) > 0 || m._lawBy || m.role === "merchant" || m.role === "dealer") continue;
      if (m.aiState === "fight" || m.aiState === "snitch" || heldInCell(m)) continue;
      const d = Math.hypot(ap.x - m.group.position.x, ap.z - m.group.position.z);
      if (d > 16) continue;
      if (lvl === "avoid") {
        // he would have come — at a GUN he does not (CBZ.brain.social.
        // retaliate): out of its line, the grudge kept for another day
        if (isP) {
          m.playerGrudge = Math.min(14, (m.playerGrudge || 0) + 2);
          if (CBZ.prisonBrain && CBZ.prisonBrain.gunDecide) CBZ.prisonBrain.gunDecide(m, true);
        } else addBeef(m, aggressor, 4);
        continue;
      }
      if (lvl === "glare") {
        if (CBZ.npcStare) CBZ.npcStare(m, 2.2 + rng() * 1.5, isP ? null : ap);
        if (isP) m.playerGrudge = Math.min(14, (m.playerGrudge || 0) + 1); else addBeef(m, aggressor, 2);
      } else if (lvl === "shove" || came >= cap) {
        if (shoved >= 1) { if (CBZ.npcStare) CBZ.npcStare(m, 2.5, isP ? null : ap); continue; }
        shoved++;
        if (isP) { if (requestHunt(m, 2.5, "crew")) m._huntStyle = "shove"; }
        else { m.aiState = "shoveAt"; m._shoveAt = aggressor; m._shoveT = 5; addBeef(m, aggressor, 4); }
      } else {
        came++;
        if (lvl === "weapon") m._steelT = 25;
        if (isP) {
          if (requestHunt(m, (dur || 12) * (lvl === "weapon" ? 1 : 0.75), "crew")) {
            if (lvl === "weapon") m.playerGrudge = Math.max(m.playerGrudge || 0, 6);
          } else came--;
        } else startFight(m, aggressor);
      }
    }
    return came;
  }

  /* A GUARD SAW YOU THROW THE FIRST PUNCH. LAW owns what happens next
     (CBZ.prisonOffense, systems/prisonlaw.js); this file only knows who swung
     first, which is the one fact LAW cannot see from a hurt event. */
  function reportPlayerFight(victim) {
    if (!CBZ.prisonOffense || !victim || !victim.group) return false;
    const p = victim.group.position;
    let seer = null;
    let w = null;
    try { w = CBZ.guardWatching ? CBZ.guardWatching(p.x, p.y || 0, p.z) : null; } catch (e) { w = null; }
    if (w && w.group) seer = w;
    else if (w) {
      let bd = Infinity;
      for (const gd of CBZ.guards || []) {
        if (!alive(gd)) continue;
        const d = Math.hypot(gd.group.position.x - p.x, gd.group.position.z - p.z);
        if (d < bd) { bd = d; seer = gd; }
      }
    }
    if (!seer) return false;
    const g = CBZ.game || {};
    const now = (CBZ.now || 0) / 1000;
    if (g._fightReportAt && now - g._fightReportAt < 4) return false;   // one fight is one report
    g._fightReportAt = now;
    try {
      CBZ.prisonOffense("fight", { victim, at: { x: p.x, z: p.z }, seenBy: seer, started: true });
    } catch (e) { return false; }
    return true;
  }

  /* A SNUB IS BETWEEN YOU AND HIM. Walking off a demand (or refusing it to his
     face) used to escalate the whole gang once standing crossed a threshold.
     Now the man you snubbed remembers it; the second time, he comes himself.
     Nobody else is sent. */
  function snubbed(n, secs) {
    if (!n) return false;
    n._snubs = (n._snubs || 0) + 1;
    n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
    if (n._snubs < 2) return false;
    const b = behaviorOf(n);
    const nerve = (n.personality && n.personality.nerve) || 0.5;
    if (b.guts < 0.25 && nerve < 0.45) return false;   // all talk
    n._snubs = 0;
    return requestHunt(n, secs || 6, "snub");
  }

  /* WHAT A RAT ACTUALLY SAYS TO A SCREW, and what it costs you. This is the
     beat the whole snitch system turns on. Overhearing it IS how you find out
     who did it (markPlayerReported -> sawItHappen -> learnSnitch), so the line
     and the knowledge are the same event. Called from the brain's onReport
     (systems/brain_prison.js), the one place a witness report becomes heat. */
  function playerReported(n, amount, reportMeta, g) {
    reportMeta = reportMeta || {};
    const spot = n.reportedPlayerLastKnown || reportMeta.lastKnown || null;
    const where = spot ? nearestLandmark(spot.x, spot.z) : null;
    if (CBZ.recordWitnessReport) {
      const lead = CBZ.recordWitnessReport(amount, reportMeta, n, g);
      markPlayerReported(n, amount, reportMeta, g, lead);
      say(n, reportMeta.copCrime ? "I want to make a complaint." : (where ? `He was by the ${where}.` : "It was him. I saw it."), null, 1.8);
    } else if (reportMeta.copCrime) {
      CBZ.addComplaint && CBZ.addComplaint(amount * 0.55);
      markPlayerReported(n, amount, reportMeta, g, null);
      say(n, "I want to make a complaint.", null, 1.8);
    } else {
      CBZ.addHeat && CBZ.addHeat(amount * 0.78);
      CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 12);
      CBZ.game.snitchReports = (CBZ.game.snitchReports || 0) + 1;
      markPlayerReported(n, amount, reportMeta, g, null);
      if (g) { g.alert = 1.4; g.hunt = 2.2; }
      say(n, where ? `Try the ${where}.` : "That way. He went that way.", null, 1.8);
    }
  }
  CBZ.prisonPlayerReported = playerReported;   // systems/brain_prison.js's onReport calls it

  function sendNpcToSnitch(n, amount, meta) {
    if (!alive(n) || n.role === "merchant" || n.role === "dealer") return false;
    if (tryGangInterceptSnitch(n, amount, meta || {})) return true;
    meta = meta || {};
    if (n._demand) endDemand(n, null);
    n.aiState = "snitch";
    n.snitchHeat = amount || 12;
    n.snitchCop = !!meta.copCrime;
    n.snitchMeta = Object.assign({}, meta, {
      lastKnown: meta.lastKnown || (n.memory && n.memory.lastKnown) || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: meta.type || "crime", heardOnly: !!meta.heardOnly },
    });
    n.snitchT = 5.5;
    n.foe = null;
    emote(n, "!");
    const g = nearestGuard(n);
    if (g) n.target.set(g.group.position.x, 0, g.group.position.z);
    return true;
  }

  function resolveKnownSnitch(n, action) {
    if (!n || !((n.reportedPlayerT || 0) > 0)) return { ok: false, msg: "" };
    const who = actorName(n);
    const g = CBZ.game || {};
    const p = n.personality || {};
    const amount = n.reportedPlayerAmount || 12;
    const gang = n.gang;
    const sameGang = CBZ.player && CBZ.player.gang != null && gang === CBZ.player.gang;
    const rivalGang = CBZ.player && CBZ.player.gang != null && gang >= 0 && gang !== CBZ.player.gang;
    const armed = (CBZ.playerArmed && CBZ.playerArmed()) || (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Shiv"));
    const credibility = Math.max(0.18, Math.min(0.98,
      n.reportedPlayerCred != null ? n.reportedPlayerCred : (n.reportedPlayerKind === "noise report" ? 0.45 : 0.70)
    ));
    const shaky = credibility < 0.52;

    if (action === "confront") {
      const standing = gang >= 0 ? gangStanding(gang) : 0;
      let chance = 0.34 + (n.playerFear || 0) * 0.035 + (n.playerTrust || 0) * 0.028 + (armed ? 0.08 : 0);
      chance += sameGang ? 0.10 : 0;
      chance += standing > 0 ? standing * 0.002 : standing * 0.004;
      chance -= (p.nerve || 0.5) * 0.16 + (rivalGang ? 0.08 : 0);
      chance += (0.62 - credibility) * 0.34;
      chance -= Math.max(0, credibility - 0.70) * 0.18;
      chance = Math.max(0.12, Math.min(0.78, chance));
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
      if (rng() < chance) {
        const drop = 5 + Math.min(11, amount * 0.36);
        const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, drop * 1.15, { reason: "confront" }) : null;
        coolWanted(drop);
        if (g.lastKnown && g.lastKnown.source === who) g.lastKnown.t = Math.min(g.lastKnown.t || 0, 4);
        n.reportedPlayerT = Math.min(n.reportedPlayerT || 0, 8);
        n.reportedPlayerCred = Math.max(0.12, credibility - 0.18 - (challenged && challenged.ok ? 0.10 : 0));
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        n.playerFear = Math.min(14, (n.playerFear || 0) + 1);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        if (gang >= 0) addGangStanding(gang, sameGang ? 1 : -1);
        emote(n, "...");
        return { ok: true, msg: shaky || (challenged && challenged.ok) ? "Maybe it wasn't you." : "I said a name. That's all." };
      }
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
      n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 18);
      n.reportedPlayerCred = Math.min(1, credibility + 0.08);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.22, { type: "denial", credibility: n.reportedPlayerCred }, n);
      if (g.witnessReportT != null) g.witnessReportT = Math.max(g.witnessReportT || 0, 4);
      if (rivalGang) addGangStanding(gang, -2);
      emote(n, "!");
      return { ok: false, msg: "I didn't say nothing!" };
    }

    if (action === "paySilence") {
      const cost = knownSnitchCost(n);
      if ((g.cigs || 0) < cost) return { ok: false, msg: `${cost}. You don't have it.` };
      CBZ.econ.addCigs(-cost);
      coolWanted(7 + cost + Math.min(7, amount * 0.22));
      const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 8 + cost, { force: true, reason: "paid silence" }) : null;
      if (g.lastKnown && g.lastKnown.source === who) g.lastKnown = null;
      clearKnownReport(n);
      n.memory = null;
      n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
      n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
      if (gang >= 0) {
        addGangStanding(gang, sameGang ? 2 : 1);
        if (!sameGang && CBZ.player.gang != null) addGangStanding(CBZ.player.gang, -1);
      }
      CBZ.sfx && CBZ.sfx("coin");
      emote(n, "$");
      return { ok: true, msg: challenged && challenged.ok ? "I never said nothing." : `${cost}. I'll say I was wrong.` };
    }

    if (action === "threatenSnitch") {
      const standing = gang >= 0 ? gangStanding(gang) : 0;
      let chance = 0.28 + (armed ? 0.18 : 0) + (n.playerFear || 0) * 0.05 - (p.nerve || 0.5) * 0.24;
      chance += sameGang ? 0.08 : 0;
      chance -= rivalGang ? 0.10 : 0;
      chance += standing > 10 ? 0.06 : 0;
      chance += (0.58 - credibility) * 0.22;
      chance -= Math.max(0, credibility - 0.70) * 0.15;
      chance = Math.max(0.08, Math.min(0.82, chance));
      n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
      if (rng() < chance) {
        const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 6 + Math.min(8, amount * 0.25), { reason: "threatened witness" }) : null;
        n.reportedPlayerCred = Math.max(0.12, credibility - 0.16 - (challenged && challenged.ok ? 0.08 : 0));
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        coolWanted(4 + Math.min(8, amount * 0.25));
        if (g.lastKnown && g.lastKnown.source === who) g.lastKnown = null;
        clearKnownReport(n);
        if (gang >= 0) addGangStanding(gang, sameGang ? -1 : -4);
        n.aiState = "flee";
        n.fleeT = 2.3 + rng() * 1.7;
        emote(n, "!");
        return { ok: true, msg: "Okay. I'll leave it." };
      }
      n.reportedPlayerCred = Math.min(1, credibility + 0.12);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.26, { type: "witness threat", forceSnitch: true, credibility: n.reportedPlayerCred }, n);
      if (gang >= 0) {
        addGangStanding(gang, -5);
        addGangDebt(gang, 1);
        provokeGang(n, 5.5, { crew: 1, why: "threat", standing: 0 });
        return { ok: false, msg: "You want to do this here?" };
      }
      const lastKnown = n.reportedPlayerLastKnown || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "threat" };
      clearKnownReport(n);
      sendNpcToSnitch(n, amount + 7, { forceSnitch: true, lastKnown, type: "threat", credibility: Math.min(1, credibility + 0.12) });
      return { ok: false, msg: "" };
    }

    return { ok: false, msg: "" };
  }

  // shove an actor away from a point (impact reaction)
  /* A SHOVE IS A STEP, NOT A TELEPORT. This wrote `force` metres straight
     into the group position on one frame (a player's prison round moved a
     guard 1.35 m between two frames), and every jail shove (brain_prison,
     economy, humancontact, reactions' recoil) popped the same way. A living
     man with a rig now takes it as a real footwork step along the push
     (CBZ.verbs.step: feet and root on one curve, walls respected), about half
     the old distance because it is no longer instant. A round that already
     landed on his rig this frame (CBZ.verbs.shot) owns the motion: the gun's
     shove is not a second push. No rig / knocked out: the old nudge. */
  function knockback(actor, fx, fz, force) {
    const dx = actor.group.position.x - fx, dz = actor.group.position.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    const f = force || 0.8;
    const V = CBZ.verbs, ch = actor.char;
    if (!actor.dead && !(actor.ko > 0) && ch && V && V.step) {
      if (ch._shotR && ch._shotR.queued) return;
      if (V.step(actor, dx / d, dz / d, Math.min(0.7, 0.12 + f * 0.4), 0.3)) return;
    }
    // (the nudge through the one mover, systems/bodymove.js: never through a wall)
    if (CBZ.bodyMove) CBZ.bodyMove(actor, (dx / d) * f, 0, (dz / d) * f, null);
    else { actor.group.position.x += (dx / d) * f; actor.group.position.z += (dz / d) * f; }
  }

  const GANG_NAMES = (function () {
    const P = PCARS();
    return P ? P.CARS.map((c) => c.phrase) : ["the block", "the block"];
  })();
  // the player is taken in by HIS car (called from the interact menu / claim)
  function joinGang(actor) {
    if (!actor || actor.gang == null) return { ok: false, msg: "" };
    // a man his car cast out (systems/prisoncars.js leave) is nobody's: no car takes him back this run
    if (PCARS() && PCARS().isOut && PCARS().isOut()) return { ok: false, msg: "" };
    const car = actor.yardCar != null && actor.yardCar >= 0 ? actor.yardCar : actor.gang;
    if (car < 0) return { ok: false, msg: "" };
    const mine = playerCar();
    if (mine >= 0 && car !== mine) return { ok: false, msg: "You ain't one of us." };
    CBZ.player.gang = car;
    CBZ.player.yardCar = car;
    CBZ.game.carClaim = "in";
    addGangStanding(car, 22);
    addGangDebt(car, -999);
    for (const n of CBZ.npcs) if (n.gang === car || n.yardCar === car) n.huntPlayer = 0; // his own stand down
    if (CBZ.player._bandMesh) CBZ.player._bandMesh.visible = false;
    return { ok: true, msg: "You're with us now." };
  }

  CBZ.aiThink = aiThink;

  CBZ.aiKill = kill;

  /* THE PRISON'S BODY (systems/vitals.js). Every injury in the yard is
     vitals': a fist dazes and knocks out, a blade or a round opens a bleed,
     a man dies of the hit that was truly lethal, of the blood, or of a long
     beating while he was out. Its one death comes back here, to the same
     choke point every other prison death uses, carrying HOW he died so the
     body reads right: a beaten man has no hole in his back. */
  let bledOutByPlayer = 0;
  CBZ.prisonBledOut = function () { return bledOutByPlayer; };
  if (CBZ.vitals && CBZ.vitals.on) {
    CBZ.vitals.on("escape", {
      kill(a, cause, o) {
        if (!a || a.isPlayer || !a.group) return false;
        o = o || {};
        const R = a._vt;
        let by = o.by || (R && R.by) || null;
        const byPlayer = !!by && (by === CBZ.player || by.isPlayer === true);
        if (byPlayer) by = CBZ.playerChar ? { group: CBZ.playerChar.group } : null;
        const bled = cause === "bled out";
        if (bled && byPlayer) bledOutByPlayer++;
        const melee = o.melee || (cause === "beaten to death" || cause === "beaten" ? "blunt" : cause === "stabbed" ? "blade" : null);
        kill(a, by, {
          noKnock: true, cause, melee, quiet: !!o.quiet,
          // he bled out lying in it: no fresh spray, the pool is already there
          noGore: bled,
          dirX: o.dirX, dirZ: o.dirZ,
        });
        return true;
      },
      // an NPC wraps his own wound only once nothing is coming at him
      safe(a) {
        if (!a) return false;
        if (a.aiState === "fight" || a.foe || (a.huntPlayer || 0) > 0 || (a.hunt || 0) > 0) return false;
        if ((a.fleeT || 0) > 0 || a._lawBy || a.cuffed || (a._routT || 0) > 0) return false;
        return true;
      },
    });
  }
  CBZ.aiReset = aiReset;
  CBZ.provokeGang = provokeGang;
  CBZ.noteGangIncident = noteGangIncident;
  CBZ.knockback = knockback;
  CBZ.joinGang = joinGang;
  CBZ.sendNpcToSnitch = sendNpcToSnitch;
  CBZ.npcWitnessCrime = npcWitnessCrime;
  CBZ.npcEmote = emote;
  CBZ.squashGrudge = squashGrudge;
  CBZ.squashGrudgeCost = squashGrudgeCost;
  /* THE CONTRACT SURFACE. systems/interact.js hangs its verbs off this
     (COLLECT on a claim-holder, SETTLE on the man who sent you, TAKE on the
     cornered debtor). Everything a caller
     needs to ask is a question about a PERSON standing in front of the player,
     never a query into a ledger — that is deliberate, and it is why there is no
     "list contracts" here. */
  CBZ.prisonContract = {
    on: contractsOn,
    live: contract,                  // the one live job, or null
    forCreditor: contractFor,        // is this the man who sent you?
    againstDebtor: contractAgainst,  // is this the man you were sent after?
    canOffer: canOfferContract,      // does he hold a claim worth handing you?
    // offer(creditor): COLLECT pressed on him; the job is yours. The two
    // extra args (workOff gang, a named kind) are for a preset or a probe.
    offer: offerContract,
    /* SEED ONE CLAIM, AGED. A tab needs ~95 s of yard time before its holder
       starts asking around, which no capture and no probe can wait for. This
       books the same row mintTab books and hands it the age it would have had,
       so what gets photographed is the real system and not a mock of it. */
    seed: function (creditor, debtor, opts) {
      opts = opts || {};
      const t = addTab(creditor, debtor, opts.amt || 9, opts.why || "store day");
      if (t) t.t = opts.age != null ? opts.age : TAB_RIPE + 20;
      return t;
    },
    take: takeContract,              // book a made contract as the live one
    dodgeOffer: dodgeOffer,          // what the cornered debtor put on the table
    takeDodge: takeDodge,            // ...taken
    settle: settleContract,
    satisfied: contractSatisfied,
    paidInFull: contractPaidInFull,
    summary: contractSummary,
    note: contractNoteFor,
    pitch: contractPitch,
    wantedItem: contractWantedItem,  // "" unless a repo is live on this man
    lift: contractLift,
    canWorkOff: canWorkOff,          // the symmetry: debt turning into labour
    workOff: workOff,
    ripeTab: ripeTab,
    tabWith: tabWith,
    addTab: addTab,                  // for a preset or a probe to seed the yard
    place: placeFor,
    /* One line for a console. Counts the ledger the way the beef audit counts
       its own: how many claims exist, how many have gone sour, and what the
       live job is — so "the yard has an economy" is measurable and not a
       claim in a comment. */
    audit: function () {
      let tabs = 0, ripe = 0, total = 0, holders = 0;
      for (const n of CBZ.npcs || []) {
        if (!n._tabs || !n._tabs.length) continue;
        holders++;
        for (const t of n._tabs) { tabs++; total += t.amt; if (t.t >= TAB_RIPE) ripe++; }
      }
      const c = contract();
      return {
        on: contractsOn(), tabs, ripe, holders,
        avgTab: tabs ? Math.round((total / tabs) * 10) / 10 : 0,
        live: c ? { kind: c.kind, name: c.name, amt: c.amt, item: c.item, got: c.got, done: !!c.done, workOff: !!c.workOff } : null,
      };
    },
  };
  CBZ.prisonCrewWork = { can: canCrewWork, take: crewWork };
  CBZ.resolveKnownSnitch = resolveKnownSnitch;

  CBZ.knownSnitchCost = knownSnitchCost;

  CBZ.addGangStanding = addGangStanding;
  CBZ.addGangDebt = addGangDebt;
  CBZ.gangStanding = gangStanding;
  CBZ.gangDebt = gangDebt;
  CBZ.gangProtection = gangProtection;
  CBZ.prisonDemand = {
    begin: beginDemand,
    of: demandOf,
    pay: payDemand,
    workOff: workOff,
    canWorkOff: canWorkOff,
    cancel: function (n) { endDemand(n, null); },
    busy: demandBusy,
    cost: function (n) { const D = demandOf(n); return D ? (D.cost || 0) : 0; },
  };
  CBZ.isGangTurf = isOnTurf;
  CBZ.GANG_NAMES = GANG_NAMES;
  // ---- exposed for the rankings dashboard ----
  CBZ.behaviorOf = behaviorOf;
  CBZ.fightOdds = fightOdds;
  CBZ.combatPower = combatPower;
  CBZ.actorName = actorName;
  /* WHAT A MAN REALLY WANTS DONE (systems/quests.js reads this). Only state
     the yard already keeps: a beef he holds against a named man, or a named
     man who holds one against him. Nothing is rolled here. `divert` is the
     diversion approach's own effect, given free by a friend. */
  function namedMan(m) {
    return !!(m && m.data && m.data.name && !/^(a|an) /.test(m.data.name) && !m.dead && !m.escaped);
  }
  CBZ.prisonFavor = {
    grudge(n) {
      let best = null, bw = 5;
      for (const b of (n && n._beef) || []) {
        if (b.w > bw && namedMan(b.who) && b.who !== CBZ.player) { best = b.who; bw = b.w; }
      }
      return best;
    },
    threat(n) {
      let best = null, bw = BEEF_SWING - 0.01;
      for (const m of CBZ.npcs || []) {
        if (m === n || !namedMan(m)) continue;
        const w = m.foe === n ? BEEF_MAX : beefWith(m, n);
        if (w > bw) { best = m; bw = w; }
      }
      return best;
    },
    divert(n) {
      if (!alive(n) || !nearestGuard(n)) return false;
      n.aiState = "diversion";
      n.diversionT = 8;
      n.foe = null;
      coolWanted(12);
      return true;
    },
  };
  CBZ.ensureCombatProfile = ensureCombatProfile;
  // a single "notoriety" score used to rank the whole yard
  CBZ.npcPower = function (a) {
    if (!a) return 0;
    const r = a.ratings;
    const cap = r ? (r.fighting + r.toughness + r.speed * 0.6 + r.cunning * 0.5 + r.marksman * 0.4) : 120;
    const rec = a.record ? (a.record.kills * 14 + a.record.knockdowns * 4 + a.record.fights * 0.4) : 0;
    const rank = (a.kind === "warden" ? 60 : a.kind === "guard" ? 24 : 0) + (a.isLeader ? 30 : 0);
    return Math.round(cap + rec + rank);
  };
  CBZ.blockRumor = blockRumor;
  CBZ.topBlockBuzz = topBuzz;
  CBZ.rememberBlockRead = rememberBlockRead;
  CBZ.spreadReportGossip = spreadReportGossip;

  // gate the prison social/gang directors to escape mode (survival has no NPCs)
  const esc = (fn) => (dt) => { if (CBZ.game.mode !== "escape") return; fn(dt); };
  CBZ.onUpdate(18, esc(function (dt) {
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    for (let i = 0; i < gp.length; i++) gp[i] = Math.max(0, (gp[i] || 0) - dt);
    updateGangJob(dt);
  }));
  CBZ.onUpdate(42, esc(updateGangPresence));

  CBZ.onUpdate(42.4, esc(updateGangThresholds));
  CBZ.onUpdate(42.45, esc(updateRobbedComeback));

  CBZ.onUpdate(43.5, esc(updateWatcherDirector));
  CBZ.onUpdate(44, esc(updateBlockRumors));
  CBZ.onUpdate(44.5, esc(updateContracts));
})();
