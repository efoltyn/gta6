/* ============================================================
   systems/combat_iq.js — HOW WELL A PERSON FIGHTS.

   OWNER (2026-07-27, verbatim): "make npcs better at fighting — both
   throwing punches and shooting — and make some of them shoot first
   sometimes. rn they are really bad at shooting and when shot at, a group
   of them all with guns its just chaos, they dont make a good effort at
   staying alive and attacking me. This is IMPROVING THEIR LOGIC — not
   nerfing the player, not better hp, not more damage. maybe you make it so
   much better it has to do LESS damage lol. npcs with guns better at
   fighting the user; and better guns better fighting — an npc with a pistol
   is not gonna be that powerful, but a soldier with an AK or a terrorist
   with an AK or SWAT can be more powerful."

   THE BEFORE-STATE, NAMED HONESTLY (all four are arithmetic, not taste):

   (1) AN ARMED PED NEVER FIRED PAST 9.4 METRES. peds.js move() gates the
       trigger on `d <= want + 0.4` with `want = ped.armed ? 9 : 1.7`
       (peds.js ~4889), while npcAttack itself allows 26. So every rifleman
       in this game WALKED INTO PISTOL RANGE before taking a shot. That is
       most of what "they are really bad at shooting" actually was.

   (2) NOBODY TOOK TURNS. Every shooter who reached the band fired on its
       own cooldown, immediately, forever. N gunmen = N x the DPS and N
       bodies standing in the open. That is the chaos: four gangers put out
       ~51 HP/s and killed a full-health player in 2.0 s, and not one of
       them was doing anything a person would do.

   (3) THE COVER CODE WAS DEAD. squadai.js's coverBias scanned
       `cols[0 .. 64]` — the FIRST 64 entries of the GLOBAL collider array,
       i.e. whatever the world builder happened to push first, essentially
       never within 9 m of the shooter. CBZ.queryCollidersNear (a real
       grid-accelerated broadphase) has existed in physics.js the whole
       time and no combat code called it. So "they dont make a good effort
       at staying alive" was literally true: the wall the man was standing
       next to was invisible to him.

   (4) A GUN WAS A DAMAGE NUMBER, NOT A SKILL. peds.js's NPC_GUN table has
       exactly ONE row (AK-47: 19 dmg vs the 14 default). Reaction time,
       settle, burst length, accuracy and cover discipline were IDENTICAL
       for a terrified shop clerk holding a looted pistol and a soldier
       with a rifle. There was no way for "better guns better fighting" to
       be true, because nothing about the gun touched the fighting.

   WHAT THIS FILE IS. One shared answer to "how competent is this person in
   a fight", consumed by every armed-NPC brain — peds.js, police.js,
   gangs.js — with NO per-file fork. It is a LAYER, never an owner: it
   writes actor.target (the field every brain already steers by) and
   answers questions; it never spawns, never damages, never draws.

     CBZ.combatIQ.profile(a)              -> the competence row for this person
     CBZ.combatIQ.shot(a, tgt, d, dt, dmg)-> { fire, hit, dmg }  THE fire gate
     CBZ.combatIQ.cover(a, tx, tz)        -> { x, z } real cover, or null
     CBZ.combatIQ.slot(a, tgt, dt)        -> "fire" | "flank" | "cover" | "hold"
     CBZ.combatIQ.posture(a, tgt, dt)     -> steers actor.target; returns the slot
     CBZ.combatIQ.moveGate(a,tgt,d,slot)  -> { halt } stop-to-shoot contract (city)
     CBZ.combatIQ.planted(a) / drives(a)  -> is this body holding a picked position
     CBZ.combatIQ.geom                    -> walk/fire segment tests vs the colliders
     CBZ.combatIQ.shootFirst(a, tgt)      -> may this person open unprovoked
     CBZ.combatIQ.melee(a, tgt, dt)       -> "close"|"circle"|"guard"|"windup"|
                                             "swing"|"recover"|"backstep"
     CBZ.combatIQAudit()                  -> the ratchet

   THE TABLE IS A DPS LADDER, AND THAT IS THE POINT. Every cell of TIER_DPS
   is "how much health per second does this person take off a standing
   target at 10 m". It is the ONE number the whole competence model is
   solved against, so a change to a cell is a change to a TIME-TO-KILL you
   can read off the page — never an accuracy tweak whose consequences you
   discover in play. Per-hit damage is DERIVED from it against whatever
   damage the caller was already going to deal:

       secPerRound = the rhythm shot() REALLY produces (see profile(): the
                     discipline-modified burst/recycle and the per-person
                     de-sync phase, not the raw table numbers)
       rawDps      = hit10 * callerDamage / secPerRound
       dmgMul      = clamp(min(cellDps, DPS_CAP) / rawDps, 0.35, 1.6)
       dmg         = min(callerDamage * dmgMul, DPS_CAP * secPerRound / hit10)

   so RAISING a tier's hit rate automatically LOWERS its per-hit damage —
   the owner's sanctioned counterweight, applied by construction instead of
   by hand. DPS_CAP (26) is the hard invariant, and it is enforced on the
   RESULT rather than merely preferred: NO configuration of role x weapon x
   caller damage may out-damage the SWAT officer who already ships (measured
   26.2 HP/s). A soldier with a rifle is more dangerous than he was; he is
   still less dangerous than the SWAT unit the game has shipped for months.

   MEASURED, at 10 m, one shooter, standing target, 100 hp time-to-kill:
     civ + pistol      7.9 s -> 25.0 s     (a scared clerk stops being a turret)
     thug + pistol     7.9 s -> 14.3 s
     thug + AK         7.9 s ->  7.7 s     (UNCHANGED — the street is as it was)
     beat cop         10.5 s -> 10.5 s     (UNCHANGED)
     elite + AK        7.9 s ->  4.5 s     (the owner's soldier/terrorist)
     SWAT + SMG        3.8 s ->  4.0 s     (the ceiling, very slightly softer)
   and the number that actually decides how a firefight FEELS — four armed
   gangers on one target — goes 2.0 s -> 3.8 s, because at most two of them
   hold the fire token at a time. Each man got smarter; the mob got fairer.

   DETERMINISM: per-person traits (who is the eager one, which way he
   circles) come from CBZ.hash01 on the body's stable spawn seed, so the
   same man is always the same man. Moment-to-moment rolls use a local
   seeded LCG — never Math.random, never a shared world stream.

   Flags — every layer is a one-line revert:
     NPC_COMBAT_IQ     master (default ON)
     NPC_IQ_TIERS      the competence/DPS table
     NPC_IQ_COVER      real collider-derived cover
     NPC_IQ_SQUAD      the shooter token + spacing + suppression
     NPC_IQ_SHOOTFIRST unprovoked openings
     NPC_IQ_MELEE      the punch exchange
     NPC_IQ_POSITIONS  firing positions + stop-to-shoot + hide (CITY ONLY —
                       see block 3b; battle.html's posture path is untouched)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (C.NPC_COMBAT_IQ == null) C.NPC_COMBAT_IQ = true;
  if (C.NPC_IQ_TIERS == null) C.NPC_IQ_TIERS = true;
  if (C.NPC_IQ_COVER == null) C.NPC_IQ_COVER = true;
  if (C.NPC_IQ_SQUAD == null) C.NPC_IQ_SQUAD = true;
  if (C.NPC_IQ_SHOOTFIRST == null) C.NPC_IQ_SHOOTFIRST = true;
  if (C.NPC_IQ_MELEE == null) C.NPC_IQ_MELEE = true;
  if (C.NPC_IQ_POSITIONS == null) C.NPC_IQ_POSITIONS = true;

  function on() { return C.NPC_COMBAT_IQ !== false; }
  // the position layer is a CITY brain: battle.html consumes posture() for its
  // beloved chase-and-retreat (BATTLE-GRAND-PLAN: "do not lose it") and runs
  // its own wall projection, so every 3b/3c line below is inert off-city.
  function cityMode() { return !!(CBZ.game && CBZ.game.mode === "city"); }

  // seeded LCG for moment-to-moment rolls (own stream — never a world stream)
  let _s = 1013904;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  // stable per-person trait. Reuses peds.js's OWN _roleSeed fields when they
  // exist (and seeds them the same way when they do not), so "the eager one"
  // and "which way he circles" survive the body walking around, and peds.js's
  // roleHash and ours can never disagree about who a person is.
  function trait(a, salt) {
    if (!a) return 0.5;
    if (a._roleSeedX == null) { a._roleSeedX = a.pos ? a.pos.x : 0; a._roleSeedZ = a.pos ? a.pos.z : 0; }
    return CBZ.hash01 ? CBZ.hash01(a._roleSeedX, a._roleSeedZ, salt) : 0.5;
  }
  function nowMs() { return CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0); }

  // ============================================================
  //  1. THE TABLE.  ROLE rows x WEAPON columns. Adding a trade or a gun is
  //     a ROW — never a branch, never a name test in a consumer.
  // ============================================================

  // ROLE: what the person's training is worth.
  //   react  s   sight -> first trigger pull (a civilian hesitates)
  //   settle s   how long the aim takes to stop wandering after a swing
  //   acc    0-1 settled hit probability at 10 m before the weapon modifies it
  //   disc   0-1 discipline: burst integrity, token compliance, de-sync
  //   cover  0-1 how well they use the wall they are standing next to
  //   nerve  0-1 hp fraction at which they break for cover / fall back
  //   eager  0-1 propensity to open fire unprovoked (see shootFirst)
  //   melee  0-1 guard/circle/backstep quality in a fistfight
  const ROLE = {
    civ:   { react: 0.85, settle: 1.30, acc: 0.34, disc: 0.10, cover: 0.15, nerve: 0.62, eager: 0.00, melee: 0.12 },
    thug:  { react: 0.55, settle: 0.90, acc: 0.46, disc: 0.32, cover: 0.40, nerve: 0.42, eager: 0.16, melee: 0.42 },
    pro:   { react: 0.38, settle: 0.62, acc: 0.58, disc: 0.55, cover: 0.62, nerve: 0.30, eager: 0.22, melee: 0.60 },
    elite: { react: 0.26, settle: 0.42, acc: 0.70, disc: 0.78, cover: 0.80, nerve: 0.20, eager: 0.30, melee: 0.78 },
    swat:  { react: 0.20, settle: 0.34, acc: 0.80, disc: 0.90, cover: 0.88, nerve: 0.16, eager: 0.06, melee: 0.86 },
  };

  // WEAPON: what the tool is worth. burst/rate/recycle ARE the fire rhythm;
  // lo/hi is the distance band the carrier tries to hold (this is what stops
  // a rifleman walking into knife range and what pushes a shotgun IN).
  const WEAP = {
    none:    { burst: 0, rate: 0.30, recycle: 1.00, accMul: 0.00, falloff: 0.000, lo: 0,  hi: 2.2, cls: "none" },
    pistol:  { burst: 2, rate: 0.22, recycle: 1.05, accMul: 0.86, falloff: 0.030, lo: 5,  hi: 14,  cls: "pistol" },
    smg:     { burst: 4, rate: 0.10, recycle: 0.95, accMul: 0.80, falloff: 0.034, lo: 5,  hi: 16,  cls: "smg" },
    shotgun: { burst: 1, rate: 0.55, recycle: 0.75, accMul: 1.05, falloff: 0.075, lo: 3,  hi: 10,  cls: "shotgun" },
    rifle:   { burst: 3, rate: 0.13, recycle: 0.90, accMul: 1.00, falloff: 0.018, lo: 9,  hi: 26,  cls: "rifle" },
    lmg:     { burst: 6, rate: 0.09, recycle: 1.35, accMul: 0.72, falloff: 0.026, lo: 8,  hi: 24,  cls: "lmg" },
    sniper:  { burst: 1, rate: 0.90, recycle: 1.80, accMul: 1.30, falloff: 0.006, lo: 16, hi: 46,  cls: "sniper" },
  };

  // THE DPS LADDER — health per second taken off a standing target at 10 m.
  // This is the one place a fight's lethality is authored. See the header for
  // the time-to-kill table it produces and how per-hit damage is derived.
  const TIER_DPS = {
    civ:   { pistol: 4.0,  smg: 5.5,  shotgun: 5.0,  rifle: 6.5,  lmg: 6.0,  sniper: 3.5,  none: 0 },
    thug:  { pistol: 7.0,  smg: 10.0, shotgun: 8.5,  rifle: 13.0, lmg: 11.0, sniper: 6.0,  none: 0 },
    pro:   { pistol: 9.5,  smg: 14.0, shotgun: 11.5, rifle: 17.0, lmg: 15.0, sniper: 8.0,  none: 0 },
    elite: { pistol: 11.5, smg: 19.0, shotgun: 15.0, rifle: 22.0, lmg: 20.0, sniper: 10.0, none: 0 },
    swat:  { pistol: 13.0, smg: 25.0, shotgun: 18.0, rifle: 25.0, lmg: 23.0, sniper: 12.0, none: 0 },
  };
  // THE FAIRNESS INVARIANT. Nothing this file can be configured to produce may
  // out-damage the SWAT officer the game already shipped (measured 27 HP/s;
  // 26 is that value with the burst structure's own duty cycle applied). A new
  // role row physically cannot create an unkillable soldier.
  const DPS_CAP = 26;

  // weapon name -> column. The strings are whatever the world already writes
  // into actor.weapon (peds.js, police.js, gangs.js, militia bodies).
  function weaponClass(a) {
    if (!a || !a.armed) return "none";
    const w = a.weapon;
    if (!w) return a.swat ? "smg" : "pistol";
    const n = String(w).toLowerCase();
    if (n.indexOf("sniper") >= 0) return "sniper";
    if (n.indexOf("lmg") >= 0 || n.indexOf("machine gun") >= 0) return "lmg";
    if (n.indexOf("shotgun") >= 0) return "shotgun";
    if (n.indexOf("ak") >= 0 || n.indexOf("rifle") >= 0 || n.indexOf("carbine") >= 0 || n.indexOf("m4") >= 0) return "rifle";
    if (n.indexOf("smg") >= 0 || n.indexOf("uzi") >= 0 || n.indexOf("mac") >= 0 || n.indexOf("mp5") >= 0) return "smg";
    if (n.indexOf("pistol") >= 0 || n.indexOf("revolver") >= 0 || n.indexOf("eagle") >= 0 || n.indexOf("glock") >= 0) return "pistol";
    if (n.indexOf("bat") >= 0 || n.indexOf("knife") >= 0 || n.indexOf("machete") >= 0 || n.indexOf("pipe") >= 0) return "none";
    return "pistol";
  }

  // WHO this person is, in the only vocabulary that matters here: training.
  // Reads fields the world ALREADY writes — no new tag, no spawner edit, so a
  // soldier in island_military.js and a SWAT officer in police.js both land in
  // the right row without either file knowing this table exists.
  function roleTier(a) {
    if (!a) return "civ";
    if (a.swat) return "swat";
    // trained forces: army/militia/state security read off the rank field the
    // world already keeps (militia.js declares rankField "milRank").
    if (a.milRank || a.kind === "military" || a.kind === "militia" || a.kind === "soldier") return "elite";
    if (a.kind === "cop") {
      // rank IS a verb (city/factions.js): an officer who may commit the
      // tactical unit trains like one. Degrade-safe — rankKnows answers false
      // for an undeclared org, so a stripped build reads every cop as "pro".
      if (CBZ.rankKnows && CBZ.rankKnows("police", "swat") && CBZ.rankCan && CBZ.rankCan(a, "police", "swat")) return "elite";
      return "pro";
    }
    if (a.contractOn || a.hitman) return "elite";              // paid to do exactly this
    if (a.rampage) return "thug";                              // unhinged, not trained
    // a paid detail on a principal is hired protection, and hired protection
    // that cannot shoot is not protection (city/power.js).
    if (a._vipGuard || a.vipLvl) return "elite";
    // GANG BEFORE GUARD, AND THIS ORDER IS LOAD-BEARING. `a.guard` is a LEASH
    // POINT, not a job — gangs.js's war-shape stamps one on every fighter it
    // positions, so testing it first would silently promote a rank-and-file
    // ganger to the trained tier the moment his crew took formation.
    if (a.gang) {
      const r = a.rank || 0;
      if (r >= 3) return "elite";                              // enforcer / brass
      if (r >= 1) return "pro";                                // made
      return "thug";
    }
    if (a.kind === "security" || a.kind === "guard" || a.kind === "warden" || a.guard) return "pro";
    if (a.archetype === "dealer" || a.archetype === "crook" || (a.aggr || 0) >= 0.88) return "thug";
    if ((a.aggr || 0) >= 0.72) return "thug";
    return "civ";                                              // a person holding a gun, not a gunman
  }

  // the composed row, cached on the actor. profile() is on the hot path (every
  // posture, every shot, every npcAttack), so the CHEAP checks gate it: the
  // weapon string and the armed flag cover every common change, and a slow
  // revalidation catches the rare ones (a promotion mid-fight) without paying
  // a string build and two rank lookups per call.
  function profile(a) {
    if (!a) return null;
    const t = nowMs();
    if (a._iqP && a._iqW === a.weapon && a._iqPA === (a.armed ? 1 : 0) && t < (a._iqPT || 0)) return a._iqP;
    const cls = weaponClass(a);
    const tier = roleTier(a);
    a._iqW = a.weapon; a._iqPA = a.armed ? 1 : 0; a._iqPT = t + 3000;
    const key = tier + "|" + cls;
    if (a._iqKey === key && a._iqP) return a._iqP;
    const R = ROLE[tier] || ROLE.civ, W = WEAP[cls] || WEAP.pistol;
    const dps = (TIER_DPS[tier] || TIER_DPS.civ)[cls] || 0;
    // THE SOLVE MUST USE THE RHYTHM shot() ACTUALLY PRODUCES, not the table's
    // raw burst/recycle. Discipline lengthens the burst and shortens the
    // recycle, and every person carries a stable de-sync PHASE on the recycle —
    // solving against the unmodified numbers put a civilian's real output at
    // 44% of its cell and a SWAT officer's at 105%. These three lines mirror
    // shot() exactly; if you change the rhythm there, change it here.
    const phase = 0.82 + trait(a, 0x5EE7) * 0.36;
    const eBurst = Math.max(1, Math.round(W.burst * (0.65 + R.disc * 0.35)));
    const inCd = W.rate * (1.15 - R.disc * 0.25);
    const reCd = W.recycle * (1.25 - R.disc * 0.45) * phase;
    const spr = ((eBurst - 1) * inCd + reCd) / eBurst;         // mean seconds per round
    const p = {
      tier: tier, cls: cls,
      react: R.react, settle: R.settle, disc: R.disc, cover: R.cover,
      nerve: R.nerve, eager: R.eager, meleeIQ: R.melee,
      burst: W.burst, rate: W.rate, recycle: W.recycle,
      // lo/hi is the band the carrier will FIGHT in; `pref` is where it wants to
      // stand inside it. Without the separate preferred hold a shooter that
      // approaches from outside stops at the far edge of its own band and then
      // trades at the worst accuracy the falloff allows — technically "in band",
      // practically the flat-9 bug wearing a rifle's clothes.
      lo: W.lo, hi: W.hi, pref: W.lo + (W.hi - W.lo) * 0.42, falloff: W.falloff,
      // settled hit probability at 10 m — the anchor the damage solve uses
      hit10: Math.max(0.05, Math.min(0.92, R.acc * W.accMul)),
      acc: R.acc, accMul: W.accMul,
      secPerRound: spr,
      dps: Math.min(dps, DPS_CAP),
    };
    a._iqKey = key; a._iqP = p;
    return p;
  }
  // hit probability for this shooter at this range, right now.
  //   settleFrac: a shooter who just swung onto you is measurably worse than
  //   one who has been holding the line — that beat IS the reaction window.
  function hitChance(a, p, dist, tgt) {
    const held = a._iqAimT || 0;
    const settleFrac = 0.45 + 0.55 * Math.min(1, p.settle > 0 ? held / p.settle : 1);
    let h = p.hit10 * settleFrac - p.falloff * Math.max(0, dist - 10);
    // a sprinting target is a harder target — the ONE bit of the old cop math
    // worth keeping, generalised to every shooter instead of only the police.
    if (tgt && (tgt.isPlayer ? (CBZ.player && CBZ.player.sprint) : (tgt.speed || 0) > 3.4)) h *= 0.72;
    // SHOOTING ON THE RUN IS A SPRAY. The moving penalty is what turns "you
    // would stop to shoot" from advice into the best available play — a
    // planted man simply out-hits a running one, so the position layer's
    // plant is arithmetic self-interest, not choreography. City-only:
    // battle.html balances its armies around trading on the move. Gated on
    // NPC_IQ_POSITIONS with the rest of 3b/3c so ?cfg_NPC_IQ_POSITIONS=0 is
    // a TRUE one-line revert (and the A/B rig's before side is honest).
    if (cityMode() && C.NPC_IQ_POSITIONS !== false) { const ms = a.speed || 0; if (ms > 2.4) h *= 0.55; else if (ms > 1.1) h *= 0.8; }
    // suppressed shooters shoot worse. This is what makes covering fire mean
    // something instead of being a decorative word in a comment.
    if ((a._iqSupp || 0) > 0) h *= 0.62;
    return Math.max(0.04, Math.min(0.92, h));
  }

  // ============================================================
  //  2. THE FIRE GATE — one call replaces every consumer's "roll a dice by
  //     distance" line. Owns the reaction beat, the aim settle, the burst
  //     rhythm and the derived damage. Returns { fire, hit, dmg, cd }.
  // ============================================================
  CBZ.combatIQ = CBZ.combatIQ || {};
  const IQ = CBZ.combatIQ;
  IQ.ROLE = ROLE; IQ.WEAP = WEAP; IQ.TIER_DPS = TIER_DPS; IQ.DPS_CAP = DPS_CAP;
  IQ.profile = function (a) { return C.NPC_IQ_TIERS === false ? null : profile(a); };
  IQ.tierOf = roleTier;
  IQ.weaponClass = weaponClass;

  let _shots = 0, _fires = 0;

  // ONE TIMER, NOT TWO. Every consumer already owns a fire cooldown it ticks
  // itself (peds.js attackCD, police.js shootCD), so this layer must never
  // grow a second one — that is the parallel-bookkeeping trap. aimTick advances
  // the per-frame state (reaction, settle, suppression); shot() reads it and
  // hands back the cooldown the CALLER writes into the field it already has.
  IQ.aimTick = function (a, tgt, dt) {
    if (!a || !on()) return;
    const p = profile(a);
    if (!p) return;
    dt = dt || 0;
    // IDEMPOTENT PER FRAME. posture() and shot() may both run on the same
    // actor in the same frame (a cop does); CBZ.now is stamped once per frame
    // by core/loop.js, so it is exactly the guard that keeps the reaction beat
    // from ticking twice and halving itself.
    const fr = nowMs();
    if (a._iqTickF === fr) dt = 0; else a._iqTickF = fr;
    // AIM SETTLE resets the moment the shooter swings onto a different mark.
    if (a._iqAimOn !== tgt) {
      a._iqAimOn = tgt; a._iqAimT = 0;
      // REACTION: a civilian needs most of a second to decide to pull; a SWAT
      // officer a fifth of one. Nobody fires on the frame they first see you.
      a._iqReact = p.react * (0.8 + trait(a, 0x2EAC) * 0.4);
      a._iqBurst = 0;
      a._iqBear = null;                 // a new mark is a new arc (see posture)
    }
    a._iqAimT = (a._iqAimT || 0) + dt;
    if ((a._iqReact || 0) > 0) a._iqReact -= dt;
    if ((a._iqSupp || 0) > 0) a._iqSupp -= dt;
    if ((a._iqCovering || 0) > 0) a._iqCovering -= dt;
    if ((a._iqFiredT || 0) > 0) a._iqFiredT -= dt;             // the plant window (3c)
    // A RUNNER NEVER SETTLES. Sprinting between positions caps the aim settle
    // at 40% of full — the other half of the stop-to-shoot arithmetic (see
    // hitChance). City-only for the same battle.html reason as there, and
    // flag-gated with it so the revert reverts everything.
    if (cityMode() && C.NPC_IQ_POSITIONS !== false && (a.speed || 0) > 2.4 && (a._iqAimT || 0) > p.settle * 0.4) a._iqAimT = p.settle * 0.4;
  };

  // dmg: whatever the CALLER was already going to deal. We return it scaled so
  // the shooter's output lands on its table cell — never a number of our own.
  // Call ONLY when the caller's own cooldown has elapsed; write `cd` back into
  // that same cooldown field.
  IQ.shot = function (a, tgt, dist, dt, dmg) {
    const p = (on() && C.NPC_IQ_TIERS !== false) ? profile(a) : null;
    if (!p || p.cls === "none") return null;                   // caller keeps its old path
    IQ.aimTick(a, tgt, dt || 0);
    if ((a._iqReact || 0) > 0) return { fire: false, hit: 0, dmg: 0, cd: a._iqReact };

    // BURST RHYTHM. Inside a burst the rounds come at `rate`; between bursts
    // the shooter recycles. Discipline shortens the recycle and lengthens the
    // burst; a panicky civilian dumps single wild rounds on a long pause.
    const bLeft = (a._iqBurst | 0);
    let cd;
    if (bLeft > 0) { a._iqBurst = bLeft - 1; cd = p.rate * (1.15 - p.disc * 0.25); }
    else {
      // DE-SYNC: a stable per-person phase so a crew never reloads in unison.
      const phase = trait(a, 0x5EE7);
      a._iqBurst = Math.max(0, Math.round(p.burst * (0.65 + p.disc * 0.35)) - 1);
      cd = p.recycle * (1.25 - p.disc * 0.45) * (0.82 + phase * 0.36);
      // SUPPRESSION: a token holder covering a moving ally shortens its cycle —
      // that is what "one covers while another moves" costs, and it is the only
      // reason the mover survives the open ground.
      if ((a._iqCovering || 0) > 0) cd *= 0.7;
    }
    _shots++;
    const hit = hitChance(a, p, dist, tgt);
    // DERIVED DAMAGE — the owner's sanctioned counterweight, by construction.
    const base = dmg != null ? dmg : 14;
    const spr = p.secPerRound;
    const rawDps = (p.hit10 * base) / (spr || 1);
    let mul = rawDps > 0 ? (p.dps / rawDps) : 1;
    if (mul < 0.35) mul = 0.35; else if (mul > 1.6) mul = 1.6;
    // THE CAP IS AN INVARIANT, NOT A PREFERENCE. The clamp above bounds how far
    // this layer will rewrite a caller's damage (a shared block that can
    // multiply a number by twenty is a block nobody can reason about), but a
    // caller passing an enormous base could still climb through it. So the
    // ceiling is enforced on the RESULT: nothing may out-damage the SWAT
    // officer this game already shipped, whatever the table or the caller says.
    let out = base * mul;
    const ceil = (DPS_CAP * spr) / (p.hit10 || 1);
    if (out > ceil) { out = ceil; mul = out / (base || 1); }
    _fires++;
    // THE TRIGGER PULL OPENS A PLANT WINDOW: a person stops for the burst.
    // moveGate() (3c) hands this to every consumer's speed gate, which is the
    // literal "in general, you would stop to shoot". Harmless off-city — the
    // field decays in aimTick and nothing outside the city reads it.
    if (C.NPC_IQ_POSITIONS !== false)
      a._iqFiredT = Math.min(0.9, 0.28 + (a._iqBurst | 0) * p.rate * (1.15 - p.disc * 0.25));
    return { fire: true, hit: hit, dmg: out, cd: cd, mul: mul, p: p };
  };

  // the distance band this carrier wants to hold. A rifleman stops walking
  // into your shotgun; a shotgunner closes. peds.js's flat 9 was the bug.
  IQ.band = function (a) {
    const p = profile(a);
    if (!p) return null;
    return { lo: p.lo, hi: p.hi };
  };

  // ============================================================
  //  3. COVER — the wall you are standing next to, found for real.
  //
  //  CBZ.queryCollidersNear (physics.js) is a grid-accelerated broadphase over
  //  the SAME boxes the player collides with, so tonight's solidity wave is
  //  free raw material: anything honest enough to stop a body is honest enough
  //  to stop a bullet. ZERO RAYCASTS — the far-side point is placed along the
  //  threat->box axis and confirmed with one XZ slab test against the box that
  //  is meant to be doing the hiding. ~20-40 boxes of pure arithmetic, once
  //  per fighter per ~1.2 s.
  // ============================================================
  const _cols = [];
  const COVER_R = 12;          // how far a fighter will break for cover
  const COVER_MIN_H = 0.85;    // a kerb is not cover (and NPCs cannot crouch)
  const COVER_MIN_W = 0.7;     // a lamppost is not cover
  const BODY_R = 0.55;
  let _coverQ = 0, _coverHit = 0;

  // does the segment (ax,az)->(bx,bz) cross this box in XZ? (slab test)
  function segBox(ax, az, bx, bz, c) {
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-6) { if (ax < c.minX || ax > c.maxX) return false; }
    else {
      const inv = 1 / dx;
      let a1 = (c.minX - ax) * inv, a2 = (c.maxX - ax) * inv;
      if (a1 > a2) { const t = a1; a1 = a2; a2 = t; }
      if (a1 > t0) t0 = a1; if (a2 < t1) t1 = a2;
      if (t0 > t1) return false;
    }
    if (Math.abs(dz) < 1e-6) { if (az < c.minZ || az > c.maxZ) return false; }
    else {
      const inv = 1 / dz;
      let b1 = (c.minZ - az) * inv, b2 = (c.maxZ - az) * inv;
      if (b1 > b2) { const t = b1; b1 = b2; b2 = t; }
      if (b1 > t0) t0 = b1; if (b2 < t1) t1 = b2;
      if (t0 > t1) return false;
    }
    return true;
  }
  function tallEnough(c) {
    if (c.y1 == null) return true;                              // undeclared span = a wall
    return (c.y1 - (c.y0 || 0)) >= COVER_MIN_H && (c.y0 || 0) <= 1.2;
  }

  // the far side of a solid thing, relative to the threat. Cached per actor.
  IQ.cover = function (a, tx, tz, opts) {
    if (!on() || C.NPC_IQ_COVER === false) return null;
    if (!a || !a.pos || !CBZ.queryCollidersNear) return null;
    opts = opts || {};
    const now = nowMs();
    if (!opts.force && (a._iqCovT || 0) > now) return a._iqCov || null;
    // stable per-person throttle phase so a crew does not all re-probe on the
    // same frame (the classic "everything spikes together" cost pattern).
    a._iqCovT = now + 900 + trait(a, 0x0C07) * 700;
    _coverQ++;
    const R = opts.range || COVER_R;
    const px = a.pos.x, pz = a.pos.z;
    const cols = CBZ.queryCollidersNear(px, pz, R, _cols);
    let best = null, bestScore = 1e9;
    const dThreatNow = Math.hypot(px - tx, pz - tz);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.minX == null) continue;
      if (!tallEnough(c)) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (w < COVER_MIN_W && d < COVER_MIN_W) continue;
      const cx = (c.minX + c.maxX) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
      // axis from the threat through the box: the hide point sits just past
      // the box on that line, so the box is between the body and the gun.
      let ax = cx - tx, az = cz - tz;
      const al = Math.hypot(ax, az);
      if (al < 0.001) continue;
      ax /= al; az /= al;
      // walk from the centre to the box surface along the axis, then stand off
      const ex = Math.abs(ax) > 1e-4 ? (w * 0.5) / Math.abs(ax) : 1e9;
      const ez = Math.abs(az) > 1e-4 ? (d * 0.5) / Math.abs(az) : 1e9;
      const reach = Math.min(ex, ez) + BODY_R + 0.25;
      const hx = cx + ax * reach, hz = cz + az * reach;
      const walk = Math.hypot(hx - px, hz - pz);
      if (walk > R) continue;
      // confirm the box really is in the way from there (a thin fin edge-on is
      // not cover just because the arithmetic put a point behind it)
      if (!segBox(hx, hz, tx, tz, c)) continue;
      // prefer close cover, and cover that does not walk us INTO the gun
      const closing = Math.max(0, dThreatNow - Math.hypot(hx - tx, hz - tz));
      const score = walk + closing * 1.4;
      if (score < bestScore) { bestScore = score; best = { x: hx, z: hz, d: walk, ref: c }; }
    }
    a._iqCov = best;
    if (best) _coverHit++;
    return best;
  };
  // is this fighter currently standing in the cover it chose?
  IQ.inCover = function (a) {
    const c = a && a._iqCov;
    if (!c) return false;
    return Math.hypot(a.pos.x - c.x, a.pos.z - c.z) < 1.6;
  };

  // ============================================================
  //  3b. FIRING POSITIONS — pick a spot, get there, PLANT, shoot.
  //
  //  THE CITY COMPLAINT THIS ANSWERS (owner, 2026-08-15): "NPCs with guns
  //  kind of run around stupidly and glitchy … when they're shooting at you
  //  they should be picking position. In general, you would stop to shoot."
  //
  //  WHAT WAS ACTUALLY WRONG, read off the code:
  //    (1) posture() wrote a NEW goal every frame — bearing + deadband +
  //        separation, with squadai.js strafing ±3 m on top — so the goal
  //        never held still long enough to be REACHED. peds.js only plants a
  //        body within 0.9 m of its goal; a goal that renews itself every
  //        frame is a body that jogs forever, firing on the run while
  //        actorAimAt snaps its spine at the mark and the mover lerps it
  //        back — that tug-of-war IS the "glitchy" the owner is seeing.
  //    (2) Every goal was pure geometry around the mark, blind to walls.
  //        BATTLE-GRAND-PLAN names the identical root cause on the battle
  //        page ("every tactical goal must be projected onto reachable
  //        space") — battle.html got its wall rule; the city never did. A
  //        bearing slot through a facade is a man pressing his face into
  //        masonry until the 0.45 s stuck-timer kicks him sideways.
  //    (3) A hurt man's only retreat was 9 m STRAIGHT BACK, in the open,
  //        usually still straight down the shooter's lane.
  //
  //  THE SHAPE OF THE FIX — a position is a COMMITMENT, not a per-frame
  //  suggestion:
  //    • pickPos(): candidate spots fanned around the anchored bearing at
  //      the weapon's preferred range, each PROJECTED onto reachable space —
  //      a spot only counts if the walk there is unwalled, the spot itself
  //      is outside every collider, and it has a real FIRING LANE to the
  //      mark (chest-height segment vs the same boxes that stop bodies —
  //      which makes a 0.9 m planter true half-cover: it stops legs, not
  //      bullets). Cover-adjacent spots score better; a leashed defender
  //      (a.guard — gangs.js war posts, turf defence) pays to leave his
  //      post, so a crew DEFENDS its ground instead of chasing across town.
  //    • The fighter COMMITS (_iqPos), walks there, and PLANTS: the goal
  //      stops moving, move() zeroes speed, the body stands and delivers.
  //      It repositions for a REASON — mark displaced, firing lane walled,
  //      fresh suppression, the flank timer — never per frame.
  //    • With the fire token and REAL cover, the position is the box's
  //      corner (peekPoint) — step out, shoot, tuck back when the token
  //      passes. A flanker's spots walk wide around the arc through
  //      whatever defilade is on the way: the sneak is the path.
  //    • A hurt man with no cover HIDES for real: hidePos() picks a
  //      reachable spot in the away hemisphere, paying a big bonus for
  //      spots the THREAT has no firing lane to — break contact, get a
  //      wall between, watch the corner.
  //
  //  CITY-GATED and flag-gated (NPC_IQ_POSITIONS; master NPC_COMBAT_IQ):
  //  outside game.mode === "city" — battle.html above all — posture() runs
  //  its exact old math, byte for byte.
  // ============================================================
  let _posPicks = 0, _posDry = 0, _posHides = 0;

  // ---- segment tests against the SAME boxes bodies collide with -----------
  // Two different questions with two different height filters:
  //   walkBlocked — could a body walk this line? (anything shin-high blocks)
  //   fireBlocked — could a round travel this line at chest height? (only
  //                 boxes spanning the chest line block; a low wall doesn't)
  const CHEST_Y = 1.30;            // the lane height the hit rolls contest
  const _segCols = [], _ptCols = [];
  function solidWalk(c) { if (c.y0 == null || c.y1 == null) return true; return c.y0 <= 1.1 && (c.y1 - c.y0) >= 0.4; }
  function solidFire(c) { if (c.y0 == null || c.y1 == null) return true; return c.y0 <= CHEST_Y && c.y1 >= CHEST_Y; }
  function segBlocked(ax, az, bx, bz, fire) {
    if (!CBZ.queryCollidersNear) return false;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return false;
    const cols = CBZ.queryCollidersNear((ax + bx) * 0.5, (az + bz) * 0.5, len * 0.5 + 1.6, _segCols);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.minX == null) continue;
      if (fire ? !solidFire(c) : !solidWalk(c)) continue;
      if (segBox(ax, az, bx, bz, c)) return true;
    }
    return false;
  }
  function walkBlocked(ax, az, bx, bz) { return segBlocked(ax, az, bx, bz, false); }
  function fireBlocked(ax, az, bx, bz) { return segBlocked(ax, az, bx, bz, true); }
  function pointBlocked(x, z) {
    if (!CBZ.queryCollidersNear) return false;
    const cols = CBZ.queryCollidersNear(x, z, 1.2, _ptCols);
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.minX == null || !solidWalk(c)) continue;
      if (x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5) return true;
    }
    return false;
  }
  // public: other systems (and tools/tactics-check.mjs) may ask the same
  // questions without re-deriving the height filters.
  IQ.geom = { walkBlocked: walkBlocked, fireBlocked: fireBlocked, pointBlocked: pointBlocked };

  // ---- the candidate fan ---------------------------------------------------
  // Angles are ordered narrow→wide so a token holder prefers the spot that
  // costs the least walking; a flanker's scoring PAYS him to take the wide
  // ones. Radii bracket the weapon's preferred hold.
  const POS_ANGS = [0, 0.32, -0.32, 0.65, -0.65, 1.0, -1.0, 1.45, -1.45];
  const _radii = [0, 0, 0];
  function pickPos(a, tgt, p, slot, baseAng, want) {
    const tx = tgt.pos.x, tz = tgt.pos.z;
    const pref = Math.max(3, Math.min(want || p.pref, p.hi));
    _radii[0] = pref;
    _radii[1] = Math.max(3, pref * 0.7);
    _radii[2] = Math.min(p.hi, pref * 1.35);
    const guard = a.guard;
    const cv = a._iqCov;                 // cached cover probe — a bonus, not a law
    let best = null, bs = 1e9, tried = 0;
    for (let ai = 0; ai < POS_ANGS.length; ai++) {
      const off = POS_ANGS[ai] * (slot === "flank" ? 1.5 : 1);
      for (let ri = 0; ri < 3; ri++) {
        const r = _radii[ri];
        const x = tx + Math.sin(baseAng + off) * r, z = tz + Math.cos(baseAng + off) * r;
        if (pointBlocked(x, z)) continue;                        // inside a wall is not a spot
        if (fireBlocked(x, z, tx, tz)) continue;                 // no firing lane, no position
        if (walkBlocked(a.pos.x, a.pos.z, x, z)) continue;       // can't get there straight
        const walk = Math.hypot(x - a.pos.x, z - a.pos.z);
        let score = walk + Math.abs(r - pref) * 0.55 + Math.abs(off) * 1.2;
        if (slot === "flank") score -= Math.abs(off) * 3.2;      // a flanker is PAID to go wide
        if (guard) score += Math.max(0, Math.hypot(x - guard.x, z - guard.z) - 14) * 1.4;   // defenders hold the post
        if (cv && Math.hypot(x - cv.x, z - cv.z) < 3.5) score -= 3.2;   // fight from beside the wall
        if (score < bs) { bs = score; if (!best) best = { x: 0, z: 0 }; best.x = x; best.z = z; }
        if (++tried >= 14 && best) return best;                  // bounded: never scan the whole fan
      }
    }
    return best;
  }

  // ---- HIDE: break contact and get out of the threat's firing lanes --------
  // Candidates fan the AWAY hemisphere; a spot the threat has no chest-height
  // lane to earns the big bonus (that is what "hiding from" means), never a
  // spot that closes toward the gun.
  const HIDE_ANGS = [0, 0.4, -0.4, 0.85, -0.85, 1.25, -1.25];
  function hidePos(a, tgt, dist) {
    const tx = tgt.pos.x, tz = tgt.pos.z;
    const away = Math.atan2(a.pos.x - tx, a.pos.z - tz);
    let best = null, bs = 1e9;
    for (let ai = 0; ai < HIDE_ANGS.length; ai++) {
      for (let ri = 0; ri < 2; ri++) {
        const r = ri === 0 ? 8.5 : 13.5;
        const angH = away + HIDE_ANGS[ai];
        const x = a.pos.x + Math.sin(angH) * r, z = a.pos.z + Math.cos(angH) * r;
        if (pointBlocked(x, z)) continue;
        if (walkBlocked(a.pos.x, a.pos.z, x, z)) continue;
        const dT = Math.hypot(x - tx, z - tz);
        if (dT < dist * 0.8) continue;                           // never hide TOWARD the gun
        const hidden = fireBlocked(tx, tz, x, z);
        let score = r * 0.35 + Math.abs(HIDE_ANGS[ai]) * 0.9 - (dT - dist) * 0.45 - (hidden ? 9 : 0);
        if (score < bs) { bs = score; if (!best) best = { x: 0, z: 0, hidden: false }; best.x = x; best.z = z; best.hidden = hidden; }
      }
    }
    return best;
  }

  // ---- PEEK: the corner of the box you are hiding behind -------------------
  // cover() put the body on the far side of a real collider; with the fire
  // token the firing spot is that box's EDGE — step out past it (whichever
  // side this person favours, a stable trait), shoot, tuck back when the
  // token passes. Only a spot with an actual lane counts.
  function peekPoint(a, cv, tx, tz) {
    const c = cv.ref;
    if (!c || c.minX == null) return null;
    let fx = tx - cv.x, fz = tz - cv.z;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const px = -fz, pz = fx;                                     // along the box face
    const half = Math.abs(px) * (c.maxX - c.minX) * 0.5 + Math.abs(pz) * (c.maxZ - c.minZ) * 0.5 + 0.75;
    const s0 = trait(a, 0x51DE) < 0.5 ? 1 : -1;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? s0 : -s0;
      const x = cv.x + px * s * half, z = cv.z + pz * s * half;
      if (pointBlocked(x, z)) continue;
      if (fireBlocked(x, z, tx, tz)) continue;
      return { x: x, z: z };
    }
    return null;
  }

  // ---- commit a position and steer at it ----------------------------------
  // Writes a.target with GOAL-STABILITY: separation applies while walking in
  // (two men are never sent to the same metre) but a PLANTED body's goal is
  // its position, exactly — a goal that keeps wandering is the churn this
  // whole block exists to remove. Plant has hysteresis so it can't flicker.
  function driveToPos(a, x, z, tgt, cls) {
    let P = a._iqPos;
    if (!P || P.cls !== cls || P.x !== x || P.z !== z) {
      P = a._iqPos = { x: x, z: z, tx: tgt.pos.x, tz: tgt.pos.z, cls: cls };
    }
    const d = Math.hypot(a.pos.x - x, a.pos.z - z);
    a._iqPlant = d < (a._iqPlant ? 1.7 : 1.05);
    if (a._iqPlant) a.target.set(x, a.target.y || 0, z);
    else { const s = separate(a, x, z, tgt); a.target.set(s.x, a.target.y || 0, s.z); }
    a._iqPosF = nowMs();
  }

  // ---- the band-position driver (called from posture's main branch) --------
  // Re-picks ONLY for a reason: no position yet / slot class changed / the
  // mark displaced / the firing lane walled itself (throttled re-test) / the
  // scheduled displacement timer (flankers cycle fast — that IS the flank).
  function firePosTick(a, tgt, p, slot, ang, want, tol, dt) {
    const tx = tgt.pos.x, tz = tgt.pos.z;
    const cls = slot === "flank" ? "flank" : "fire";
    let P = a._iqPos && (a._iqPos.cls === "fire" || a._iqPos.cls === "flank") ? a._iqPos : null;
    // DRY BACKOFF, actually honored. A dry pick used to schedule a 1.1 s
    // retry and then re-scan the whole fan NEXT FRAME anyway, because "no
    // position" re-triggered the pick unconditionally — measured as a
    // 2-per-frame pick storm on any fighter in a walled pocket. The dry flag
    // makes the backoff real; a fresh engagement (no flag) still picks
    // immediately.
    if (!P && a._iqPosDry && (a._iqRepoT || 0) > 0) return false;
    let pick = !P || P.cls !== cls;
    if (P && !pick) {
      if (Math.hypot(tx - P.tx, tz - P.tz) > Math.max(4.5, tol * 1.7)) pick = true;      // mark displaced
      else if ((a._iqRepoT || 0) <= 0) pick = true;                                      // scheduled displacement
      else {
        a._iqLaneT = (a._iqLaneT || 0) - dt;
        if (a._iqLaneT <= 0) {
          a._iqLaneT = 0.5 + trait(a, 0x9A17) * 0.4;
          if (fireBlocked(P.x, P.z, tx, tz)) pick = true;                                // the lane walled itself
        }
      }
    }
    if (pick) {
      const cand = pickPos(a, tgt, p, slot, ang, want);
      _posPicks++;
      if (!cand) {
        // fully walled pocket — no honest spot. Fall back to the raw goal
        // this beat (the mover's steering + stuck kick handle it) and retry
        // after the backoff above.
        _posDry++;
        a._iqPos = null; a._iqPlant = false; a._iqRepoT = 1.1; a._iqPosDry = true;
        return false;
      }
      P = a._iqPos = { x: cand.x, z: cand.z, tx: tx, tz: tz, cls: cls };
      a._iqPosDry = false;
      a._iqRepoT = cls === "flank" ? 2.4 + trait(a, 0xF7A1) * 1.8 : 5.5 + trait(a, 0xF7A1) * 4.5;
    }
    driveToPos(a, P.x, P.z, tgt, P.cls);
    return true;
  }

  // hide positions cycle on their own slower clock (a man who broke contact
  // holds his hole; he does not re-roll it forty times a second).
  function hideTick(a, tgt, dist, dt) {
    const H = a._iqPos && a._iqPos.cls === "hide" ? a._iqPos : null;
    a._iqHideT = (a._iqHideT || 0) - dt;
    if (H && a._iqHideT > 0 && Math.hypot(tgt.pos.x - H.tx, tgt.pos.z - H.tz) < 8) return H;
    const hp = hidePos(a, tgt, dist);
    a._iqHideT = 4.5 + trait(a, 0x81DE7) * 2.5;
    if (!hp) return null;
    _posHides++;
    return hp;
  }

  // ============================================================
  //  3c. STOP-TO-SHOOT — the one movement contract every consumer reads.
  //  halt=true → zero your speed this frame and keep the spine on the mark.
  //  Three ways a body earns a halt:
  //    firing  — it just pulled the trigger (_iqFiredT, set in shot());
  //              every consumer that fires through shot() gets this free.
  //    planted — it is standing on the position it picked (city, 3b).
  //    band    — no position system runs for this consumer (police.js keeps
  //              its own cover/flank machinery) but it holds the fire slot,
  //              eyes on, inside its weapon's band: stand and deliver.
  // ============================================================
  const _mgOut = { halt: false, why: "" };
  function _mg(h, w) { _mgOut.halt = h; _mgOut.why = w; return _mgOut; }
  IQ.moveGate = function (a, tgt, dist, slotStr) {
    if (!on() || C.NPC_IQ_POSITIONS === false || !a) return null;
    if ((a._iqFiredT || 0) > 0) return _mg(true, "firing");
    const p = profile(a);
    if (!p || p.cls === "none") return null;
    if (C.NPC_IQ_POSITIONS !== false && a._iqPos && a._iqPlant) return _mg(true, "planted");
    if (slotStr === "fire" && dist != null && !a._iqPos &&
        dist >= Math.min(4, p.lo * 0.7) && dist <= p.hi * 1.02) return _mg(true, "band");
    return _mg(false, "");
  };
  IQ.planted = function (a) { return !!(a && a._iqPlant); };
  // does the position system own this body's steering right now? squadai's
  // strafe/standoff overlay defers while it does — a per-frame jitter on top
  // of a committed position is exactly the goal churn 3b removes.
  IQ.drives = function (a) {
    return !!(C.NPC_IQ_POSITIONS !== false && a && a._iqPosF && (nowMs() - a._iqPosF) < 300);
  };

  // ============================================================
  //  4. GROUP DISCIPLINE — the anti-chaos.
  //
  //  Mirrors systems/predator.js's pack token for humans: at most K attackers
  //  on one mark hold the FIRE token; everyone else takes a bearing slot and
  //  works an angle or holds cover. It is the same idea for the same reason —
  //  a threat that arrives all at once is noise, and a threat that takes turns
  //  is a fight. (predatorPack itself is not reused: it steers by bearing
  //  around a hunted BODY and knows nothing about walls or firing lanes.)
  // ============================================================
  const PACKS = new Map();      // target -> { tok:[], until:[], slots:Map, t, movingT }
  let _sweepT = 0;

  function packOf(tgt) {
    let pk = PACKS.get(tgt);
    if (!pk) { pk = { tok: [], until: [], slots: new Map(), n: 0, t: nowMs(), movingT: 0 }; PACKS.set(tgt, pk); }
    return pk;
  }

  IQ.slot = function (a, tgt, dt) {
    if (!on() || C.NPC_IQ_SQUAD === false) return "fire";
    if (!a || !tgt) return "fire";
    const pk = packOf(tgt);
    const now = nowMs();
    pk.t = now;
    // expire dead/stale tokens
    for (let i = pk.tok.length - 1; i >= 0; i--) {
      const h = pk.tok[i];
      if (!h || h.dead || h.ko > 0 || pk.until[i] < now || h._iqTgt !== tgt) { pk.tok.splice(i, 1); pk.until.splice(i, 1); }
    }
    a._iqTgt = tgt;
    const p = profile(a);
    // POINT BLANK OVERRIDES THE QUEUE. Nobody waits his turn with the target on
    // top of him, and a body standing two metres away holding its fire because
    // somebody else has the token is the exact kind of tell that makes an AI
    // read as a machine. Costs one distance test on a call that already runs.
    if (a.pos && tgt.pos) {
      const dx = a.pos.x - tgt.pos.x, dz = a.pos.z - tgt.pos.z;
      if (dx * dx + dz * dz < 36) return "fire";
    }
    if (pk.tok.indexOf(a) >= 0) {
      // holding the token — keep it for the rest of this burst window. If an
      // ally is crossing open ground right now, this is COVERING FIRE and the
      // recycle shortens for it (see shot()).
      a._iqCovering = pk.movingT > now ? 0.4 : 0;
      return "fire";
    }
    // AN UNDISCIPLINED SHOOTER DOES NOT WAIT HIS TURN. This is the difference
    // between a panicking crowd (which should still read as a mess) and a
    // squad (which should not) — and it is a STABLE trait, so the same man is
    // always the one who will not stop shooting. Roughly: 1 in 3 civilians,
    // 1 in 4 street thugs, 1 in 18 SWAT.
    if (p && trait(a, 0x70CE) > 0.62 + p.disc * 0.36) return "fire";
    // two guns at a time on one man; a genuinely trained stack gets a third,
    // which is what makes SWAT read as heavier than a gang without adding a
    // single point of damage.
    const cap = (p && (p.tier === "swat" || p.tier === "elite")) ? 3 : 2;
    if (pk.tok.length < cap) {
      pk.tok.push(a);
      // hold long enough for one burst plus its recycle, jittered per person
      pk.until.push(now + (900 + trait(a, 0x7071) * 1100));
      a._iqCovering = 0;
      return "fire";
    }
    // no token: hurt or cover-minded fighters tuck; the rest work an angle.
    const hurt = a.hp != null && a.maxHp && a.hp < a.maxHp * (p ? p.nerve : 0.35);
    if (hurt || (p && trait(a, 0x0CFF) < p.cover)) return "cover";
    pk.movingT = now + 700;      // somebody is crossing — the token holders cover him
    return "flank";
  };

  // a deterministic bearing slot around the mark, so flankers SURROUND rather
  // than queue. Same shape as the predator pack's bearing assignment.
  function bearingSlot(a, pk, tgt) {
    let s = pk.slots.get(a);
    if (s == null) {
      s = pk.n++;
      pk.slots.set(a, s);
    }
    // alternate sides outward: 0, +1, -1, +2, -2 ...
    const k = Math.ceil(s / 2) * (s % 2 === 1 ? 1 : -1);
    return k * 0.62 + (trait(a, 0x8EA2) - 0.5) * 0.25;
  }

  // anti-clump: push a goal off any other IQ fighter sharing this mark. Scans
  // BOTH rosters — cops live in cityCops, not cityPeds, and a squad that spaces
  // itself against only half the shooters on the street still bunches.
  const SEP = 2.8;
  const _sepOut = { x: 0, z: 0 };
  function separate(a, gx, gz, tgt) {
    let ox = 0, oz = 0, n = 0;
    const lists = [CBZ.cityPeds, CBZ.cityCops];
    for (let li = 0; li < lists.length && n < 4; li++) {
      const list = lists[li]; if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === a || !o || o.dead || o._iqTgt !== tgt || !o.pos) continue;
        const dx = gx - o.pos.x, dz = gz - o.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > SEP || d < 0.001) continue;
        ox += (dx / d) * (SEP - d); oz += (dz / d) * (SEP - d);
        if (++n >= 4) break;
      }
    }
    _sepOut.x = gx + ox; _sepOut.z = gz + oz;
    return _sepOut;
  }

  // ============================================================
  //  5. POSTURE — the ONE call an armed brain makes. Writes actor.target
  //     (the field every brain in this game already steers by) and returns
  //     the slot so the caller can gate its own trigger.
  //
  //     Composes, never duplicates: LOS memory / search sweep / blind flank
  //     come from systems/aitactics.js, which police.js and squadai.js
  //     already run. What is NEW here is the cover, the token, the band and
  //     the self-preservation break.
  // ============================================================
  let _engaged = 0, _covered = 0, _tokens = 0, _holds = 0;

  IQ.posture = function (a, tgt, dt) {
    if (!on() || !a || !a.pos || !a.target || !tgt || !tgt.pos) return null;
    const p = profile(a);
    if (!p || p.cls === "none") return null;                   // melee brain owns it
    dt = dt || 0.016;
    const tx = tgt.pos.x, tz = tgt.pos.z;
    let dx = tx - a.pos.x, dz = tz - a.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    _engaged++;
    IQ.aimTick(a, tgt, dt);

    // POSITION MODE availability (block 3b) — needed before the LOS block so
    // a committed position can survive a blink (see below).
    const posOn = C.NPC_IQ_POSITIONS !== false && cityMode() && !!CBZ.queryCollidersNear;

    // LOS + memory (shared primitives — never re-implemented here)
    const AT = CBZ.aiTactics;
    let sees = true;
    if (AT) {
      const los = AT.updateLOS(a, tx, tz, dt, { range: Math.max(30, p.hi + 8), giveUpT: 3.5, rng: rng });
      sees = los.sees;
      if (los.justLost && !(a.searchT > 0)) AT.searchStart(a, { x: a.lkx, z: a.lkz }, { dur: 4 + rng() * 3, rng: rng });
      if (sees && a.searchT > 0) { a.searchT = 0; a.searchGoal = null; a._sweepGoal = null; }
      if (a.searchT > 0) {
        const step = AT.searchTick(a, dt, { sweepRadMin: 5, sweepRadMax: 12, reachR: 3, rng: rng });
        if (step) { a._iqPos = null; a._iqPlant = false; a.target.set(a.pos.x + step.x, a.target.y || 0, a.pos.z + step.z); return "search"; }
        a.searchT = 0;
      }
      if (!sees && dist < 42) {
        // A COMMITTED POSITION SURVIVES A BLINK. The instrumented probe
        // caught the old behavior in the act: a man WALKING to his spot loses
        // the mark behind a pole or a parked car for a quarter second, the
        // blind branch dumps his position, sight returns, he picks a fresh
        // one — goal jumps every second or two and he never arrives anywhere
        // (posPicks 5 / plantedEnd 0 / an 11.6 m/s goal churn on a lone
        // shooter). A person does not forget his plan because he blinked.
        // COVER and HIDE positions hold indefinitely while blind — being
        // unseen is what those spots are FOR — and a firing spot holds
        // through 1.2 s of lost sight before the corner-work starts. The
        // search escalation (giveUpT above) still clears everything when the
        // mark is genuinely gone; npcAttack's own muzzle LOS gate keeps a
        // blind man from firing either way.
        if (posOn && a._iqPos && (a._iqPos.cls === "cover" || a._iqPos.cls === "hide" || (a.lostT || 0) < 1.2)) {
          const cls = a._iqPos.cls;
          driveToPos(a, a._iqPos.x, a._iqPos.z, tgt, cls);
          return cls === "hide" ? "hide" : (cls === "cover" ? "cover" : "fire");
        }
        const bf = AT.blindFlank(a, dx, dz, dist, dt, { period: 1.2, periodJitter: 0.8, sideAmt: 4.5, closeBias: 0.35, rng: rng });
        a._iqPos = null; a._iqPlant = false;   // no eyes, no held position — work the corner
        a.target.set(a.pos.x + bf.x, a.target.y || 0, a.pos.z + bf.z);
        return "blind";
      }
    }

    const slot = IQ.slot(a, tgt, dt);
    if (slot === "fire") _tokens++;

    // POSITION MODE timers (block 3b; posOn computed above the LOS block).
    // posDt is frame-gated exactly like aimTick's dt: garrison/piracy call
    // posture() on an actor move() also postures, and without the gate every
    // position timer would tick twice per frame for those bodies.
    let posDt = dt;
    if (posOn) {
      const fr2 = nowMs();
      if (a._iqPosTickF === fr2) posDt = 0; else a._iqPosTickF = fr2;
      a._iqRepoT = (a._iqRepoT || 0) - posDt;
    }

    // SELF-PRESERVATION. Below the person's nerve they stop trading and get
    // the wall between them and the gun — and they STAY there longer than a
    // healthy man would. This is the "make a good effort at staying alive"
    // the owner asked for, and it is a decision, not a health buff.
    const hurt = a.hp != null && a.maxHp && a.hp < a.maxHp * p.nerve;
    const wantCover = slot === "cover" || hurt || (a._iqSupp || 0) > 0;

    if (wantCover) {
      const cv = IQ.cover(a, tx, tz);
      if (cv) {
        _covered++;
        if (posOn) {
          // hold the FAR SIDE of the box; with the fire token step out past
          // its EDGE (peekPoint — a spot with an actual lane), and tuck back
          // the moment the token passes. Both are commitments, so the body
          // PLANTS at them instead of orbiting the hide point.
          let hx = cv.x, hz = cv.z, peeked = false;
          if (slot === "fire") {
            const pk = peekPoint(a, cv, tx, tz);
            if (pk) { hx = pk.x; hz = pk.z; peeked = true; }
          }
          driveToPos(a, hx, hz, tgt, "cover");
          a._iqHold = true;
          // an edge with no lane keeps the man honest: tucked, not shooting.
          return peeked ? "peek" : "cover";
        }
        // hold the far side; peek out toward the mark only while the token is
        // ours (a covered man who never leans out is a man who never shoots).
        const lean = slot === "fire" ? 0.55 : 0;
        const sep = separate(a, cv.x + (tx - cv.x) * 0.02 * lean, cv.z + (tz - cv.z) * 0.02 * lean, tgt);
        a.target.set(sep.x, a.target.y || 0, sep.z);
        a._iqHold = true;
        return slot === "fire" ? "peek" : "cover";
      }
      // no cover anywhere: a hurt fighter breaks contact rather than stand
      // in the open trading — the old code's only answer was to keep walking in.
      if (hurt && p.tier !== "swat") {
        if (posOn) {
          // HIDE for real (block 3b): a reachable spot in the away hemisphere,
          // ideally one the threat has no firing lane to — not 9 m of open
          // street straight down the same lane the rounds are coming up.
          const hp = hideTick(a, tgt, dist, posDt);
          if (hp) { driveToPos(a, hp.x, hp.z, tgt, "hide"); a._iqHold = true; return "hide"; }
        }
        a.target.set(a.pos.x - (dx / dist) * 9, a.target.y || 0, a.pos.z - (dz / dist) * 9);
        return "fallback";
      }
    }
    a._iqHold = false;

    // BAND + BEARING. Hold the weapon's own distance band on a bearing slot so
    // the crew spreads across the mark's front instead of stacking on one line.
    const pk = packOf(tgt);
    const bear = bearingSlot(a, pk, tgt);
    // A DEADBAND AROUND THE PREFERRED HOLD, not the whole band. Gating on
    // "am I anywhere inside lo..hi" is a hysteresis trap: a rifleman walking in
    // from 40 m stops the instant he crosses 26 and trades from the worst
    // accuracy his own falloff allows. He holds near `pref` and only moves when
    // he is meaningfully off it.
    let want = dist;
    const tol = Math.max(2.5, (p.hi - p.lo) * 0.18);
    if (Math.abs(dist - p.pref) > tol) want = p.pref;
    // AT KNIFE RANGE YOU FIGHT WHERE YOU STAND. Without this a shooter whose
    // preferred hold is 16 m reverses away from anyone who closes, forever —
    // which would make an armed NPC impossible to punch.
    if (dist < 4.5) want = dist;
    // THE ARC SLOT MUST BE ANCHORED, NOT RE-DERIVED. Rotating "the bearing I am
    // standing on right now" by a fixed offset every frame is a positive
    // feedback loop: the body walks a little way round, the goal moves the same
    // way again, and the fighter orbits the target forever instead of taking a
    // position. So the bearing is latched when the engagement starts and only
    // re-anchored if the mark has walked far enough round that the slot ended
    // up behind us.
    const cur = Math.atan2(a.pos.x - tx, a.pos.z - tz);
    if (a._iqBear == null) a._iqBear = cur - bear;
    let dAng = cur - (a._iqBear + bear);
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    if (Math.abs(dAng) > 1.9) a._iqBear = cur - bear;
    const ang = a._iqBear + bear;
    // POSITION MODE: commit the band/bearing solve to a PICKED, wall-projected
    // spot and plant on it (block 3b). At knife range want==dist, so the
    // zero-offset candidate is the ground he is standing on — he fights where
    // he stands, exactly as the invariant above demands. A dry pick (fully
    // walled pocket) falls through to the raw goal below for this beat.
    if (posOn && firePosTick(a, tgt, p, slot, ang, want, tol, posDt)) return slot;
    let gx = tx + Math.sin(ang) * want, gz = tz + Math.cos(ang) * want;
    // a flanker actively works its angle wider; a token holder keeps its line
    if (slot === "flank") {
      const wide = 0.35 * (bear >= 0 ? 1 : -1);
      gx = tx + Math.sin(ang + wide) * want; gz = tz + Math.cos(ang + wide) * want;
      // and it should be moving through defilade if any is on the way
      const cv = IQ.cover(a, tx, tz);
      if (cv && cv.d < 8) { gx = (gx + cv.x) * 0.5; gz = (gz + cv.z) * 0.5; }
    } else _holds++;
    const sep = separate(a, gx, gz, tgt);
    a.target.set(sep.x, a.target.y || 0, sep.z);
    return slot;
  };

  // a shooter under incoming fire aims worse and wants the wall. Called by any
  // damage path that knows who shot: ONE line, and it is what makes covering
  // fire an actual mechanic rather than a word in a design document.
  IQ.suppress = function (a, secs) {
    if (!a || !on()) return;
    // FRESH incoming fire displaces a planted man soon — a beaten position is
    // left once, not re-rolled per bullet (the fresh-vs-sustained gate).
    if ((a._iqSupp || 0) <= 0 && (a._iqRepoT || 0) > 0.9) a._iqRepoT = 0.9;
    a._iqSupp = Math.max(a._iqSupp || 0, secs == null ? 1.4 : secs);
    a._iqCovT = 0;                                             // re-probe cover NOW
  };

  // ============================================================
  //  6. SHOOT FIRST — some people open up without being shot at.
  //
  //  THE RULE THAT KEEPS THIS FROM BEING A NUISANCE: it needs a HOSTILE
  //  CONTEXT that already exists in the world (turf, a perimeter, a contract,
  //  a rampage) — this file never invents a reason to hate you. On top of that
  //  the eagerness is a STABLE TRAIT: the same man is always the one who
  //  starts it, which is the difference between a character and a dice roll.
  //  Law-abiding civilians are excluded by the table itself (ROLE.civ.eager
  //  is 0), so a shopkeeper with a pistol under the counter never opens on you.
  // ============================================================
  let _shootFirst = 0;
  let _sfGlobalT = 0;        // city-wide pacing: an ambush is an event, not weather

  IQ.shootFirst = function (a, tgt, opts) {
    if (!on() || C.NPC_IQ_SHOOTFIRST === false) return false;
    if (!a || !tgt || a.dead || !a.armed || a.ko > 0 || a.surrender) return false;
    if (a.child || a.vendor || a.companion || a.recruited || a.controlled) return false;
    if (a.rage) return false;                                  // already committed
    const p = profile(a);
    if (!p || p.cls === "none" || p.eager <= 0) return false;
    opts = opts || {};
    // HOSTILE CONTEXT — supplied by the caller (who knows its own world), or
    // read off state that is unambiguous on its own.
    const ctx = opts.context || (a.rampage ? "rampage" : (a.contractOn === tgt ? "contract" : null));
    if (!ctx) return false;
    const now = nowMs();
    if ((a._iqSfT || 0) > now) return false;                   // one attempt per encounter
    if (_sfGlobalT > now && !opts.ignorePace) return false;    // city-wide pacing
    // eagerness is WHO HE IS, not a die. aggression bends it; the table bounds it.
    const eager = Math.min(0.6, p.eager * (0.6 + (a.aggr || 0.5)) + (opts.bias || 0));
    if (trait(a, 0xF12E) >= eager) { a._iqSfT = now + 30000; return false; }
    a._iqSfT = now + 22000;
    _sfGlobalT = now + (opts.pace != null ? opts.pace : 9000);
    _shootFirst++;
    return true;
  };
  IQ.shootFirstCount = function () { return _shootFirst; };

  // ============================================================
  //  7. MELEE — a punch is an EXCHANGE.
  //
  //  peds.js's melee was one line: cooldown, sound, damage. No wind-up (which
  //  is why city/combat.js had to FAKE a telegraph from the outside — see its
  //  INCOMING-MELEE TELEGRAPH block, whose own comment says "peds.js lands its
  //  melee instantly with no wind-up, which makes the parry window pure luck"),
  //  no guard, no spacing, so two brawlers stood inside each other and traded
  //  invisible hits. This is the beat structure, in the same grammar the
  //  predator seize uses: telegraph, commit, recover, disengage.
  //
  //  It writes _windup / char.windup — the EXISTING fields combat.js's
  //  telegraph and the rig already read — so the parry the player already has
  //  becomes a real read instead of a guess, with no HUD and no new anim seam.
  // ============================================================
  let _bouts = 0;

  IQ.melee = function (a, tgt, dt, opts) {
    if (!on() || C.NPC_IQ_MELEE === false) return null;
    if (!a || !a.pos || !tgt || !tgt.pos || tgt.dead) return null;
    opts = opts || {};
    dt = dt || 0.016;
    const p = profile(a);
    const iq = p ? p.meleeIQ : 0.2;
    const reach = opts.reach != null ? opts.reach : 1.85;
    const dx = tgt.pos.x - a.pos.x, dz = tgt.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if (!a._iqM) { a._iqM = { st: "close", t: 0, side: trait(a, 0x81DE) < 0.5 ? -1 : 1, n: 0 }; _bouts++; }
    const M = a._iqM;
    M.t -= dt;

    // a struck fighter gives ground — the beat that makes a brawl read as two
    // people rather than two colliders overlapping.
    if (a.hp != null && a._iqHpLast != null && a.hp < a._iqHpLast - 0.5 && M.st !== "windup") {
      M.st = "backstep"; M.t = 0.22 + (1 - iq) * 0.25;
    }
    a._iqHpLast = a.hp;

    switch (M.st) {
      case "backstep": {
        if (M.t <= 0) { M.st = "circle"; M.t = 0.5 + rng() * 0.5; }
        const g = { x: a.pos.x - (dx / dist) * 2.6, z: a.pos.z - (dz / dist) * 2.6 };
        if (a.target) a.target.set(g.x, a.target.y || 0, g.z);
        return "backstep";
      }
      case "close": {
        if (dist <= reach * 1.25) { M.st = "circle"; M.t = (0.35 + rng() * 0.5) * (0.5 + iq); }
        else if (a.target) a.target.set(tgt.pos.x, a.target.y || 0, tgt.pos.z);
        return "close";
      }
      case "circle": {
        // GUARD: a trained fighter answers an incoming swing instead of eating
        // it. combat.js's land() already reads _blockT for its counter window,
        // so raising it here makes an NPC block a DECISION the player can read
        // and punish — replacing the 22-34% blind dice roll that lived there.
        const incoming = opts.incoming || (tgt.isPlayer && CBZ.player && (CBZ.player._fighting || 0) > 0);
        if (incoming && dist < reach * 1.5 && trait(a, 0x6A2D + (M.n | 0)) < iq * 0.8) {
          M.st = "guard"; M.t = 0.35 + iq * 0.25;
          a._blockT = Math.max(a._blockT || 0, M.t);
          return "guard";
        }
        // orbit at the edge of reach — brawlers do not stand in each other
        const ang = Math.atan2(-dx, -dz) + M.side * (0.55 + iq * 0.35);
        const r = reach * 0.95;
        if (a.target) a.target.set(tgt.pos.x + Math.sin(ang) * r, a.target.y || 0, tgt.pos.z + Math.cos(ang) * r);
        if (M.t <= 0) {
          M.side = -M.side;
          if (dist <= reach * 1.35) { M.st = "windup"; M.t = 0.42 - iq * 0.22; M.n++; }
          else { M.st = "close"; M.t = 0.4; }
        }
        return "circle";
      }
      case "guard": {
        if (a.target) a.target.set(a.pos.x, a.target.y || 0, a.pos.z);
        if (M.t <= 0) { M.st = "windup"; M.t = 0.30 - iq * 0.16; M.n++; }   // block, then punish
        return "guard";
      }
      case "windup": {
        // the TELL. These are the fields combat.js's telegraph and the rig
        // already consume — we are not adding an animation channel, we are
        // finally giving the existing one an author.
        a._windup = Math.max(a._windup || 0, M.t);
        if (a.char) a.char.windup = a._windup;
        if (a.target) a.target.set(a.pos.x, a.target.y || 0, a.pos.z);
        if (M.t <= 0) {
          if (dist > reach * 1.4) { M.st = "close"; M.t = 0.3; return "close"; }   // they slipped it
          M.st = "swing"; M.t = 0;
          return "swing";                                        // caller lands the blow
        }
        return "windup";
      }
      case "swing": {
        M.st = "recover"; M.t = 0.34 - iq * 0.14;
        return "recover";
      }
      default: {
        if (M.t <= 0) { M.st = dist > reach * 1.3 ? "close" : "circle"; M.t = 0.4 + rng() * 0.4; }
        return "recover";
      }
    }
  };
  IQ.meleeReset = function (a) { if (a) a._iqM = null; };

  // ============================================================
  //  8. HOUSEKEEPING + THE RATCHET
  // ============================================================
  // drop pack entries for marks nobody is fighting any more (bounded, cheap)
  function sweep(dt) {
    _sweepT -= dt;
    if (_sweepT > 0) return;
    _sweepT = 2.0;
    const now = nowMs();
    PACKS.forEach(function (pk, k) {
      if (!k || k.dead || (now - pk.t) > 6000) PACKS.delete(k);
    });
  }
  if (CBZ.onUpdate) {
    CBZ.onUpdate(13.5, function (dt) {
      if (!CBZ.game || CBZ.game.mode !== "city") return;
      sweep(dt);
      // engagement counters are per-second live values, not lifetime totals
      _engaged = 0; _covered = 0; _tokens = 0; _holds = 0;
    });
  }

  // ADOPTION IS DECLARED, NOT SNIFFED (the predatorAudit lesson). A consumer
  // that migrated says so in one guarded line at load; the buffer drain makes
  // it script-order-proof.
  const ADOPTED = {};
  IQ.adopt = function (id) { if (id) ADOPTED[String(id)] = true; };
  (function drain() {
    const pre = CBZ._combatIQAdopted;
    if (!pre) return;
    try { for (let i = 0; i < pre.length; i++) IQ.adopt(pre[i]); } catch (e) {}
  })();
  // Every independent "an armed NPC decides how to fight" path we know of.
  // Anything not in ADOPTED is a fork of the logic this file exists to own.
  const LEGACY_SITES = [
    "peds:npc-attack",          // peds.js npcAttack — the fire roll + melee
    "peds:fight-band",          // peds.js move() — the flat 9 m engagement band
    "peds:rage-engage",         // peds.js think() — the rage branch's steering
    "police:fire-at",           // police.js fireAt — the cop hit roll
    "police:hunt-cover",        // police.js hunting branch cover/approach
    "gangs:war-arc",            // gangs.js shapeSquad arc shooters
    "squadai:standoff",         // squadai.js cityCombatSmarts standoff band
  ];

  CBZ.combatIQAudit = function () {
    let legacy = 0; const left = [];
    for (let i = 0; i < LEGACY_SITES.length; i++) {
      if (!ADOPTED[LEGACY_SITES[i]]) { legacy++; left.push(LEGACY_SITES[i]); }
    }
    // live census of who is currently fighting under this layer
    const tiers = { civ: 0, thug: 0, pro: 0, elite: 0, swat: 0 };
    let armed = 0, engaged = 0, covered = 0, inCover = 0, melee = 0, supp = 0;
    let positioned = 0, planted = 0, hiding = 0;
    const lists = [CBZ.cityPeds, CBZ.cityCops];
    for (let li = 0; li < lists.length; li++) {
      const L = lists[li]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        if (!a || a.dead) continue;
        if (a.armed) {
          armed++;
          const t = roleTier(a);
          if (tiers[t] != null) tiers[t]++;
        }
        if (a._iqTgt) engaged++;
        if (a._iqCov) { covered++; if (IQ.inCover(a)) inCover++; }
        if (a._iqM) melee++;
        if ((a._iqSupp || 0) > 0) supp++;
        if (a._iqPos) { positioned++; if (a._iqPlant) planted++; if (a._iqPos.cls === "hide") hiding++; }
      }
    }
    let tokens = 0;
    PACKS.forEach(function (pk) { tokens += pk.tok.length; });
    return {
      legacy: legacy, remaining: left, adopted: Object.keys(ADOPTED).length,
      armed: armed, engaged: engaged,
      covered: covered, inCover: inCover,
      tokens: tokens, packs: PACKS.size,
      // last frame's live composition counts (reset at onUpdate 13.5)
      postures: _engaged, posturesCovered: _covered, posturesFiring: _tokens, posturesHolding: _holds,
      shootFirst: _shootFirst, meleeBouts: _bouts, suppressed: supp,
      shots: _shots, fires: _fires,
      coverQueries: _coverQ, coverFound: _coverHit,
      // block 3b — the position layer's own ratchet numbers
      positioned: positioned, planted: planted, hiding: hiding,
      posPicks: _posPicks, posDry: _posDry, posHides: _posHides,
      tiers: tiers, dpsCap: DPS_CAP,
      flags: {
        master: C.NPC_COMBAT_IQ !== false, tiers: C.NPC_IQ_TIERS !== false,
        cover: C.NPC_IQ_COVER !== false, squad: C.NPC_IQ_SQUAD !== false,
        shootFirst: C.NPC_IQ_SHOOTFIRST !== false, melee: C.NPC_IQ_MELEE !== false,
        positions: C.NPC_IQ_POSITIONS !== false,
      },
    };
  };
})();
