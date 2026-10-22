/* ============================================================
   systems/voice.js — CBZ.voice: WHAT A PERSON DOES AND SAYS IS THE
   SITUATION IN FRONT OF HIM.

   OWNER (2026-10-22): "Random dumb dialogue sucks. What is great: 'put me
   down' when being held, 'I'll kill you' when threatened, 'give me your
   money' when robbing, 'someone help me' when being carried, 'don't help
   them, it's not worth it' one person to another... Very simple math: threat
   is what they see." And: "Ignoring and saying nothing IS saying something:
   seeing and walking away, seeing and sprinting away." And: "When people see
   mobs of people running, usually they run too."

   So this file is two things, for every game on the page (city, prison,
   island), with no THREE and no DOM:

     THE READ   threat(observer, source, ctx) -> 0..1, from what the observer
                can SEE: how far, a weapon in the hand, pointed at him, the
                barrel coming up, the man he just watched hit somebody, a car
                coming fast, a crowd running past.
     THE ANSWER react(actor, event, ctx) -> { how, line }. Decided by that
                threat x the man (personality, what he carries, his job, his
                friends beside him) and PERFORMED: the body first, the words
                only when this person would really speak. Silence is the
                default; most answers are a glance, a quicker walk, a cross
                to the other kerb, a sprint.

   THE API (other builders call these, feature-detected)
     voice.threat(observer, source, ctx?)  -> 0..1
     voice.react(actor, event, ctx?)       -> { how, line } (performed)
        event: seeGun aimedAt seeHit hit bumped shoved carCutoff nearMiss
               runOver held carried dropped thrown robbed seeRun helpCall
               seeBody friendHurt (+ repeated, caught, restrained)
        ctx:   { by, x, z, weapon, severity, aimed, victim, ring, why,
                 how (the caller already moved the body: speak only),
                 bodyless (decide the words, the game's brain moves him),
                 silent (move only), speed, threat (skip the read), force }
        how:   ignore glance walkOff hurry sprint freeze cower handsUp
               backOff squareUp draw fight help holdFriend call
     voice.line(actor, topic, ctx?)  -> string | null   (THE one picker)
     voice.say(actor, topic, ctx?)   -> bool            (line + mouth)
        ctx.ladder {kind, step}: a demand ladder's rung; the pool is in
        escalation order and the step walks it
        COMMANDS (systems/command.js): topics order / obey / hesitate /
        refuse / turn, ctx { order, from, to, target }; "order" takes
        ctx.again 0..2 (the order, again, the last word)
     voice.role(actor) -> civilian | gangster | cop | guard | warden |
                          security | soldier | vip | inmate | vagrant | kid |
                          vendor | worker | player
     voice.setPerform(fn(actor, how, ctx) -> bool, game?)
     voice.setNear(fn(x, z, r, out) -> out, game?)   who is around a spot
     voice.runner(actor, fromX, fromZ, why?, ring?)  a body that broke and ran
     voice.witness(x, z, event, ctx, r?)  the people who saw it answer it
     voice.helpCall(victim, by)           "Someone help me!" reaches people
     voice.knows(topic) / voice.pick(actor, key, pool) / voice.audit()

   PANIC IS SIGHT. A runner is registered here (voice.runner); a body that
   sees enough runners in front of it, close, runs the same way after a short
   beat, and becomes a runner itself, one ring further out. Only the first
   ring knows why ("He's got a gun!"); the rest run silent, or ask. A man who
   is armed and ready turns TOWARD where the crowd runs from. The city's
   decaying panic field (peds.js cityPanicRaise / cityPanicAt) still rides
   along as nerve: it rattles; sight decides who goes.

   THE SAME LINE TWICE. A speaker walks his pool (never the same line to you
   twice in a row); a line anybody said in the last minute is skipped, so a
   crowd does not chorus.
============================================================ */
(function (root) {
  "use strict";
  const W = (typeof window !== "undefined" && window) || root.window || (root.window = {});
  const CBZ = W.CBZ = W.CBZ || {};
  if (CBZ.voice && CBZ.voice.__core) return;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  let seedS = 0x9E3779B9 >>> 0;
  function rnd() {
    seedS = (seedS + 0x6D2B79F5) >>> 0;
    let t = seedS;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // a stable 0..1 per person and salt: the same man is always the talker
  function hashA(a, salt) {
    let id = (a && (a._vid || (a._vid = (++_vidN * 2654435761) >>> 0))) || 1;
    let h = (id ^ (salt * 0x45d9f3b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  let _vidN = 0;
  function now() {
    if (typeof performance !== "undefined" && performance.now) return performance.now() / 1000;
    return Date.now() / 1000;
  }

  // ================================================================ BODIES
  function posOf(a) {
    if (!a) return null;
    if (a === CBZ.player || a.isPlayer) {
      const P = CBZ.player;
      if (P && P.pos) return P.pos;
    }
    if (a.pos && typeof a.pos.x === "number") return a.pos;
    if (a.group && a.group.position) return a.group.position;
    if (a.position && typeof a.position.x === "number") return a.position;
    if (typeof a.x === "number" && typeof a.z === "number") return a;
    return null;
  }
  function isPlayer(a) {
    if (!a) return false;
    if (a === CBZ.player || a.isPlayer) return true;
    const C = CBZ.city;
    if (C && a === C.playerActor) return true;
    const S = CBZ.surv;
    if (S && a === S.playerActor) return true;
    return false;
  }
  function out(a) {
    return !a || a.dead || a.escaped || (a.ko || 0) > 0 || a.knockedOut || a.asleep || a.ragdoll === true;
  }
  function yawOf(a) {
    if (a && a.group && a.group.rotation) return a.group.rotation.y || 0;
    if (a && typeof a.yaw === "number") return a.yaw;
    return null;
  }
  function gameOf(a) {
    const b = a && a._brain;
    if (b && b.game) return b.game;
    const m = CBZ.game && CBZ.game.mode;
    if (m === "city") return "city";
    if (m === "escape") return "prison";
    if (CBZ.islandModeOn && CBZ.islandModeOn(m)) return "island";
    return m || "*";
  }

  // ================================================================ WHO
  function role(a) {
    if (!a) return "civilian";
    if (isPlayer(a)) return "player";
    const k = a.kind;
    if (k === "cop" || a.isCop) return "cop";
    if (k === "warden") return "warden";
    if (k === "guard") return "guard";
    if (k === "security" || a.bodyguard || a._detail) return "security";
    if (k === "military" || a.milRank) return "soldier";
    // THE JOB IS THE UNIFORM: a Secret Service agent, a hired guard, a soldier
    // or an officer posted as a street body (kind "civilian") still answers
    // as what he is ("No, sir.", never a passer-by's "Not him.")
    if (a._protUnit || /secret service|security/i.test(a.job || "")) return "security";
    if (a.organization === "military" || a.job === "soldier") return "soldier";
    if (a.job === "police officer") return "cop";
    if (a.vip || a.isPresident || a.official) return "vip";
    if (a.role === "inmate" || k === "inmate" || (CBZ.game && CBZ.game.mode === "escape" && a.data && !a.kind)) return "inmate";
    if ((typeof a.gang === "string" && a.gang) || k === "gang") return "gangster";
    if (a.vagrant || a._role === "panhandler") return "vagrant";
    if (a.vendor || a.archetype === "merchant") return "vendor";
    if (a.kid || a.child || a.ageBand === "child" || a.age === "kid") return "kid";
    if (a.staffPost || a.job) return "worker";
    return "civilian";
  }
  const LAW = { cop: 1, guard: 1, warden: 1, security: 1, soldier: 1 };
  function groupOf(r) {
    if (LAW[r]) return "law";
    if (r === "gangster" || r === "inmate") return "street";
    return "civ";
  }
  // what is in his hands (or on his belt): gun | melee | none
  function capability(a) {
    if (!a) return "none";
    if (isPlayer(a)) return playerWeapon();
    const B = CBZ.brain;
    if (B && B.threat && B.threat.capability) { try { return B.threat.capability(a) || "none"; } catch (e) {} }
    if (a.hasGun || a.armed || (a._holster && a._holster.weapon)) return "gun";
    if (a._shankOut || a.shank || a.knife || a.blade) return "melee";
    return "none";
  }
  function playerWeapon() {
    const m = CBZ.game && CBZ.game.mode;
    if (m === "city") {
      try { if (CBZ.cityHasGun && CBZ.cityHasGun()) return "gun"; } catch (e) {}
      return CBZ.game.cityMeleeWeapon ? "melee" : "none";
    }
    try {
      const w = CBZ.equippedWeapon ? CBZ.equippedWeapon() : null;
      if (!w) return "none";
      if (w.melee) return (w.id === "fists" || w.key === "fists") ? "none" : "melee";
      return "gun";
    } catch (e) { return "none"; }
  }
  // is the weapon OUT (in the hand, raised), not just carried?
  function drawn(a) {
    if (!a) return false;
    if (isPlayer(a)) return playerWeapon() !== "none";
    if (a.poseAimBack || a.intimidMode === "draw" || a.intimidMode === "standoff") return true;
    if ((a.armed || a.hasGun) && (a.state === "fight" || a.aiState === "fight" || a.rage)) return true;
    return !!a._shankOut;
  }
  function persona(a) {
    const b = a && a._brain;
    if (b && b.personality) return b.personality;
    // once per person: the game's fields only move by event, the hash never
    const _P = a._vP || (a._vP = { courage: 0.5, aggression: 0.4, discipline: 0.5, curiosity: 0.5, loyalty: 0.5, at: -1 });
    if (_P.at === a.aggr) return _P;
    _P.at = a.aggr;
    // no brain: the game's own temperament fields, then a stable per-person read
    const ag = typeof a.aggr === "number" ? a.aggr
      : a.personality && typeof a.personality.guts === "number" ? a.personality.guts
      : 0.25 + hashA(a, 0xA661) * 0.5;
    _P.aggression = clamp01(ag);
    _P.courage = clamp01(ag * 0.7 + hashA(a, 0xC0C0) * 0.4);
    _P.discipline = 0.5; _P.curiosity = hashA(a, 0xC1C1);
    _P.loyalty = 0.3 + hashA(a, 0x1011) * 0.6;
    return _P;
  }
  // a gangster is READY on his own block; off it he is a man with a gun
  function onHisBlock(a) {
    if (typeof a.gang !== "string" || !a.gang) return true;
    const p = posOf(a);
    if (!p || !CBZ.cityGangOf) return true;
    try { return CBZ.cityGangOf(p.x, p.z) === a.gang; } catch (e) { return true; }
  }
  // how a man reads trouble given what he carries:
  //   ready     squares up / draws (cop, guard, a gangster on his block, a bruiser with a piece)
  //   careless  armed and doesn't care: a glance, carries on
  //   scared    armed and wants none of it: backs off, hand on it
  //   tough     empty-handed and hard
  //   plain     everyone else
  function stance(a, cap, r, P) {
    if (LAW[r] && r !== "warden") return cap === "none" ? "tough" : "ready";
    if (cap === "gun") {
      if (r === "gangster" && onHisBlock(a)) return "ready";
      if (r === "inmate" && P.aggression > 0.45) return "ready";
      if (P.aggression > 0.62 || (P.courage > 0.72 && P.aggression > 0.42)) return "ready";
      if (P.courage > 0.55) return "careless";
      return "scared";
    }
    if (cap === "melee") return (P.aggression > 0.55 && P.courage > 0.5) ? "ready" : "plain";
    return (P.courage > 0.74 && P.aggression > 0.6) ? "tough" : "plain";
  }

  // ================================================================ THREAT
  // What the observer SEES of the source, as one number.
  const SAW = "_vSaw";        // observer[SAW] = { by, t } — he watched `by` hit somebody
  function sees(obs, src, op, sp, d) {
    if (d < 5) return true;                 // right there: felt, heard, seen
    if (d > 45) return false;
    const yaw = yawOf(obs);
    if (yaw != null) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const dot = ((sp.x - op.x) * fx + (sp.z - op.z) * fz) / (d || 1);
      if (dot < -0.25) return false;        // behind him
    }
    const Pc = CBZ.brain && CBZ.brain.perception;
    if (Pc && Pc.occluded) {
      try { if (Pc.occluded(op.x, (op.y || 0) + 1.6, op.z, sp.x, (sp.y || 0) + 1.4, sp.z)) return false; } catch (e) {}
    }
    return true;
  }
  function aimedAtBy(obs, src, op, sp, d) {
    if (!src || d > 40) return false;
    if (isPlayer(src)) {
      if (playerWeapon() !== "gun") return false;
      const cam = CBZ.cam;
      const P = CBZ.player;
      const yaw = cam && typeof cam.yaw === "number" ? cam.yaw : null;
      let fx, fz;
      if (yaw != null) { fx = -Math.sin(yaw); fz = -Math.cos(yaw); }
      else if (P && typeof P.yaw === "number") { fx = Math.sin(P.yaw); fz = Math.cos(P.yaw); }
      else return false;
      return ((op.x - sp.x) * fx + (op.z - sp.z) * fz) / (d || 1) > 0.66;
    }
    if (src.rage === obs || src.foe === obs) return capability(src) === "gun" && drawn(src);
    return false;
  }
  function threat(obs, src, ctx) {
    if (!obs || !src || obs === src) return 0;
    const op = posOf(obs);
    const sp = ctx && ctx.x != null && !posOf(src) ? ctx : posOf(src);
    if (!op || !sp) return 0;
    // a man in cuffs is not a threat (systems/brain.js has the rule)
    if (src.cuffed || src.tied || (src.char && src.char.cuffed)) return 0;
    if (isPlayer(src)) {
      const A = CBZ.arrest;
      try { if (A && A.playerCuffed && A.playerCuffed()) return 0; } catch (e) {}
    }
    const d = Math.hypot(sp.x - op.x, sp.z - op.z);
    const seen = sees(obs, src, op, sp, d);
    const w = (ctx && ctx.weapon) || capability(src);
    const out = drawn(src);
    const aimed = ctx && ctx.aimed != null ? !!ctx.aimed : (seen && aimedAtBy(obs, src, op, sp, d));
    const reach = w === "gun" ? (out ? 38 : 9) : w === "melee" ? (out ? 12 : 5) : 7;
    let lv = clamp01(1 - d / reach);
    if (w === "gun") lv = lv * (out ? 0.55 : 0.25) + (out && seen ? 0.2 : 0);
    else if (w === "melee") lv = lv * (out ? 0.5 : 0.25) + (out && seen && d < 8 ? 0.1 : 0);
    else lv *= 0.3;
    if (aimed) lv += 0.35 + (ctx && ctx.severity ? ctx.severity * 0.15 : 0);   // the barrel coming up
    // he watched this man hit somebody
    const sw = obs[SAW];
    if (sw && sw.by === src && now() - sw.t < 25) lv += 0.22 * clamp01(1 - d / 25);
    // a car coming fast
    const spd = ctx && ctx.speed != null ? ctx.speed : speedOf(src);
    if (spd > 6) lv += clamp01((spd - 6) / 18) * 0.45 * clamp01(1 - d / 20);
    // a crowd running round him
    if (CBZ.cityPanicAt && CBZ.game && CBZ.game.mode === "city") {
      try { lv += Math.min(0.15, CBZ.cityPanicAt(op.x, op.z) * 0.08); } catch (e) {}
    }
    // what his own brain has already made of this same man
    const b = obs._brain;
    if (b && b.threatR && b.threatR.source === src && b.assessR) lv = Math.max(lv, b.assessR.level * 0.9);
    // a man you work for, or just left, is not a threat unless the gun is on you
    if (!aimed && CBZ.brain && CBZ.brain.familiar) { try { if (CBZ.brain.familiar(obs, src)) lv *= 0.3; } catch (e) {} }
    if (!seen) lv *= 0.45;
    return clamp01(lv);
  }
  function speedOf(a) {
    if (!a) return 0;
    if (isPlayer(a)) {
      const P = CBZ.player;
      if (P && P.driving) { const v = P._vehicle || P.vehicle; if (v && typeof v.v === "number") return Math.abs(v.v); return 10; }
      return 0;
    }
    if (a.inCar && a._vehicle && typeof a._vehicle.v === "number") return Math.abs(a._vehicle.v);
    return 0;
  }

  // ================================================================ WORDS
  // TOPIC -> role / group / "*" -> lines. Lines are a few real words; under
  // 56 characters; no narration, no game words, no em dashes. Order matters
  // for a ladder (ctx.ladder.step walks it), nowhere else.
  const LINES = {
    // a gun drawn in view, not on me
    seeGun: {
      civ: ["Oh no.", "Is that a gun?", "Oh my God."],
      street: ["Put that away.", "You crazy?"],
      law: ["Drop it!", "Drop the weapon!"],
      inmate: ["Where'd you get that?", "Put that away.", "Don't point that at me."],
    },
    hesGotAGun: {
      "*": ["He's got a gun!", "Gun! He's got a gun!", "Run! He's got a gun!"],
      law: ["Gun! Everybody down!"],
    },
    whatsHappening: { "*": ["What's happening?", "What is it?", "Run!", "Go, go!"] },
    standoff: {
      gangster: ["You wanna do this?", "Go ahead. Try it.", "You sure about that?"],
      inmate: ["You wanna do this?", "Do it, then.", "Go on."],
      cop: ["Drop it! Drop the weapon!", "Put it down! Now!"],
      guard: ["Drop it!", "Put it down!"],
      security: ["Put it down.", "Don't do it."],
      soldier: ["Drop it!", "Weapon down!"],
      "*": ["You wanna do this?", "Don't."],
    },
    dontWantTrouble: { "*": ["I don't want no trouble.", "We're good. We're good.", "Easy. I'm walking."] },
    comply: {
      debt: ["Good.", "Smart."],
      "*": ["Okay! Okay!", "Don't shoot!", "Please. Please don't.", "Easy. Easy.", "I'm not doing anything!"],

      inmate: ["Easy. Easy.", "Alright, alright.", "Don't."],
      gangster: ["Easy. Easy.", "Alright. Alright."],
      kid: ["Please! Please!", "Don't hurt me!"],
    },
    leaveMe: {
      "*": ["Leave me alone!", "Get away from me!", "Back off!"],
      vagrant: ["Get back!", "Don't touch me!", "Get away!"],
      kid: ["Leave me alone!", "Stop it!"],
    },
    // he hit me and I hit back
    hitBack: {
      "*": ["You're dead.", "I'll kill you!", "Big mistake.", "Now you done it."],
      gangster: ["You're dead!", "You know whose block this is?", "Big mistake."],
      inmate: ["You're dead.", "That's it.", "You done now."],
      law: ["That's it. You're done.", "Big mistake."],
    },
    // he hit me and I want out
    hit: {
      "*": ["What the hell?!", "Ow! Stop!", "What is wrong with you?!", "Stop it!"],
      kid: ["Ow! Stop!", "Stop it!"],
    },
    seeHit: {
      civ: ["Oh my God.", "Hey! Stop!", "Somebody call the cops!"],
      street: ["Ohhh.", "Damn.", "He's done."],
      law: ["Break it up!", "Hey! Knock it off!"],
    },
    stop: { "*": ["Hey! Stop that!", "Leave him alone!", "Knock it off!"] },
    glare: { "*": ["You got a problem?", "What?", "Keep walking."] },
    bumped: {
      civ: ["Watch where you're going.", "Hey, watch it.", "Excuse you."],
      gangster: ["Watch it.", "You blind?", "Watch where you walking."],
      inmate: ["Watch it.", "Get off me.", "You blind?"],
      law: ["Watch it.", "Hey. Watch it."],
      vip: ["Excuse me."],
      kid: ["Hey!"],
    },
    bumpSorry: { "*": ["Sorry.", "My bad.", "Oh, sorry.", "Sorry, sir."] },
    shoved: {
      civ: ["Hey! Back off!", "What's your problem?", "Fuck off."],
      street: ["Get off me.", "Touch me again.", "Fuck off."],
      law: ["Back off.", "Step back."],
    },
    shoveBack: {
      "*": ["Don't make me beat you up.", "You wanna go?", "Try that again."],
      inmate: ["You wanna go?", "Touch me again.", "Try it."],
    },
    carCutoff: { "*": ["I'm walking here!", "Hey! I'm walking here!", "Watch it!", "Learn to drive!"] },
    nearMiss: { "*": ["Hey! Watch it!", "Are you crazy?!", "Slow down!", "Jesus!"] },
    runOver: { "*": ["My leg!", "What's wrong with you?!", "Ow!"] },
    held: {
      "*": ["Put me down!", "Let go of me!", "Get off me!"],
      inmate: ["Get off me!", "Let go!"],
      law: ["Let go of me!", "You're making it worse."],
    },
    carried: { "*": ["Someone help me!", "Help! Somebody help!", "Put me down!"] },
    dropped: { "*": ["Get away from me!", "Don't touch me!"] },
    robbed: { "*": ["Take it! Just take it!", "Okay! Here!", "It's all I got!", "Please, just take it."] },
    refuse: { "*": ["You're not getting a dime.", "Get out of my face.", "Nah.", "Try it."] },
    caught: {
      "*": ["Hey! Get your hand out!", "Thief!", "That's my wallet!"],
      inmate: ["Get off me.", "Hands out of my pocket.", "Try that again."],
      guard: ["Hand off my belt!", "Hands on the wall!", "That's a shakedown. Wall."],
      warden: ["Hand off me. Now."],
    },
    seeBody: { civ: ["Oh my God.", "Is he dead?", "Somebody call an ambulance!"], street: ["Damn.", "He's gone."], law: ["Man down!"] },
    friendHurt: { "*": ["Hey! That's my friend!", "Get off {him}!", "Leave {him} alone!"] },
    friendKilled: {
      "*": ["What did you do?", "Oh God. Oh God."],
      angry: ["You killed {him}!", "You're dead for that!"],
    },
    restrained: { "*": ["Let me go.", "These are too tight.", "Where are you taking me?"] },
    // kneeling by somebody he loved
    grief: { "*": ["No. No!", "Somebody help!", "Please. Please.", "Wake up. Wake up!"], kid: ["Mom? Mom!", "Get up. Please.", "Daddy?"] },
    // a grudge that waited for you
    payback: { "*": ["Remember me?", "This is for them.", "You're dead."] },
    seeBlood: { inmate: ["Who got you?", "You're bleeding.", "Keep pressure on that."] },
    // stepping in for somebody being carried off
    help: { "*": ["Hey! Put {him} down!", "Let {him} go!", "Hey! Let go!"], law: ["Put {him} down! Now!"] },
    dontHelp: { "*": ["Don't. It's not worth it.", "Leave it. Come on.", "Don't get involved.", "Come on. Walk."] },
    getHim: { "*": ["Get him!", "There he is! Get him!", "Grab him!"] },
    security: { "*": ["Security!", "Security! Over here!", "Get him away from me!"] },
    // the demand ladder (a robber, a heavy, a cop): escalation order
    // (mood "debt": a crew collecting a tab you really owe, prison)
    demand: {
      "*": ["Give me your money.", "Wallet. Now.", "Don't make me ask again.", "Last time. Give it."],
      cop: ["Hands where I can see them.", "Drop it. Now.", "Last warning!"],
      debt: ["You owe us.", "Time to pay.", "Pay what you owe."],
    },
    warn: {
      "*": ["Back off.", "I said back off.", "Last warning."],
      law: ["Step back.", "Back up. Now.", "Last warning!"],
      debt: ["I'm not asking twice.", "Don't make me take it."],
    },
    show: { "*": ["See this?", "You see this?"], debt: ["Alright. Hard way.", "Last chance."] },
    // a street loan collected (city/islandmoney.js): the last word, and the walk-off
    act: { debt: ["Should've paid.", "You were warned."] },
    left: { debt: ["We'll find you.", "Tomorrow, then."] },
    fled: { debt: ["We'll find you.", "Run. We know your face."] },
    // the street book, folded in from city/read.js
    windupKill: { "*": ["You picked the wrong day.", "You shoulda kept walking."], gangster: ["Wrong block.", "You shoulda stayed home."] },
    windupBeat: { "*": ["You wanna do this?", "Square up, then.", "Walk away."] },
    startBeat: { "*": ["The hell you looking at?", "Something funny?", "You want some?"] },
    war: { "*": ["That's him!", "You're dead here.", "Light him up!"] },
    rival: { "*": ["You don't belong here.", "Off our block.", "Wrong block."] },
    scoffFight: { "*": ["You threatening me?", "Big mistake.", "Now we got a problem."] },
    scared: { "*": ["Okay! I'm going!", "I'm leaving!", "Alright, alright!"] },
    witness: { "*": ["Somebody call the cops!", "Did you see that?", "Oh my God."] },
    // ---- COMMANDS (systems/command.js). An order is three rungs: the order,
    // the order again, the last word (ctx.again 0..2). The answers are a word
    // or nothing: routine obedience is silence (command.js decides when).
    order: {
      kill: ["Take him out.", "I said take him out.", "Now."],
      take: ["Get him.", "I said get him.", "Now!"],
      detain: ["Cuff him.", "I said cuff him.", "Now."],
      back: ["Back off.", "I said back off.", "Back off. Now."],
      hold: ["Hold here.", "Hold it here.", "Hold."],
      come: ["With me.", "I said with me.", "Now."],
      go: ["Go.", "Go. Now.", "Move."],
      guard: ["Cover him.", "Cover him.", "Cover him."],
      cell: ["Back to your cell.", "I said back to your cell.", "Last time. Cell."],
      line: ["On your door.", "I said on your door.", "Door. Now."],
      drop: ["Drop it.", "I said drop it.", "Drop it. Last time."],
      search: ["Hands on the wall.", "Hands. Wall. Now.", "Last time. Wall."],
    },
    obey: {
      law: ["Yes, sir.", "On it.", "Copy."],
      soldier: ["Yes, sir.", "Sir."],
      gangster: ["Say less.", "On it.", "Bet."],
      security: ["Yes, sir.", "Copy.", "Understood."],
      inmate: ["Alright.", "Yeah, yeah.", "Okay."],
      "*": ["Okay.", "On it."],
    },
    hesitate: {
      law: ["Sir?", "Sir, are you sure?"],
      soldier: ["Sir?", "Sir, say again?"],
      gangster: ["You sure?", "Him?", "Right here?"],
      inmate: ["For what?", "What'd I do?"],
      "*": ["You sure?", "Him?"],
    },
    refuse: {
      law: ["No, sir.", "Not him, sir.", "I can't do that."],
      soldier: ["No, sir.", "Not this, sir."],
      gangster: ["Nah.", "Not him.", "Do it yourself."],
      security: ["No, sir.", "I can't do that, sir."],
      inmate: ["No.", "Make me.", "Nah."],
      "*": ["No.", "Not him."],
    },
    // leaned on (command.threaten) with nothing pending: he takes it
    cowed: {
      law: ["Sir.", "Understood, sir."],
      soldier: ["Sir."],
      gangster: ["Alright. Alright.", "Easy."],
      inmate: ["Alright.", "Easy."],
      "*": ["Okay.", "Alright."],
    },
    turn: {
      law: ["Not anymore.", "That's enough."],
      soldier: ["No more, sir.", "Not anymore."],
      gangster: ["Nah. You're done.", "Not anymore."],
      inmate: ["Not anymore."],
      "*": ["Not anymore.", "That's enough."],
    },
  };
  // topics with a different name in an older caller
  const ALIAS = { contact: "bumped", mugged: "robbed", refusePay: "refuse", cower: "comply", seeRun: "whatsHappening", aimedAt: "comply", repeated: "shoveBack" };

  function knows(topic) { return !!(LINES[topic] || ALIAS[topic]); }

  // THE PICK. One per speaker and topic walks forward; a line anybody said in
  // the last minute is skipped.
  const RECENT = new Array(40), RECENT_T = new Float64Array(40);
  let recentI = 0;
  const RECENT_S = 60;
  function recently(s, t) {
    for (let i = 0; i < RECENT.length; i++) if (RECENT[i] === s && t - RECENT_T[i] < RECENT_S) return true;
    return false;
  }
  function remember(s, t) { RECENT[recentI] = s; RECENT_T[recentI] = t; recentI = (recentI + 1) % RECENT.length; }
  function pick(a, key, pool, step) {
    if (!pool || !pool.length) return null;
    const t = now();
    if (step != null) {
      // a ladder rung: the pool is escalation; a repeat of the same rung
      // still moves on, never back
      let i = Math.min(pool.length - 1, Math.max(0, step | 0));
      const said = a ? (a._vLad || (a._vLad = {})) : null;
      if (said && said[key] === pool[i] && i < pool.length - 1) i++;
      if (said) said[key] = pool[i];
      remember(pool[i], t);
      return pool[i];
    }
    const said = a ? (a._vSaid || (a._vSaid = {})) : null;
    const n = said ? (said[key] | 0) : 0;
    const start = ((hashA(a, key.length * 131 + 7) * pool.length) | 0) % pool.length;
    for (let k = 0; k < pool.length; k++) {
      const s = pool[(start + n + k) % pool.length];
      if (!recently(s, t)) { if (said) said[key] = n + k + 1; remember(s, t); return s; }
    }
    // everything was said a moment ago: silence beats a chorus
    return null;
  }
  // A NO SAYS WHY, when one thing weighs most (command.js weight's reason):
  // the man he was told to shoot has nothing in his hands, is a kid, is tied,
  // is one of their own, is somebody.
  const WHY = {
    refuse: {
      unarmed: { law: ["Sir, he's unarmed.", "He's unarmed, sir."], "*": ["He's unarmed.", "He's got nothing."] },
      kid: { law: ["Sir, that's a kid.", "Not a kid, sir."], "*": ["That's a kid.", "Not a kid."] },
      cuffed: { law: ["Sir, he's restrained.", "He's cuffed, sir."], "*": ["He's tied up.", "Not like this."] },
      own: { law: ["He's one of ours, sir.", "Not one of ours, sir."], "*": ["He's one of us.", "Not him."] },
      notable: { law: ["Not him, sir.", "Sir, I can't. Not him."], "*": ["Not him.", "You know who that is?"] },
    },
    hesitate: {
      unarmed: { law: ["Sir? He's unarmed."], "*": ["He's unarmed."] },
      kid: { law: ["Sir? That's a kid."], "*": ["That's a kid."] },
      cuffed: { law: ["Sir? He's restrained."], "*": ["He's tied up."] },
      own: { law: ["Sir? He's one of ours."], "*": ["One of us?"] },
      notable: { law: ["Sir? Him?"], "*": ["Him?"] },
    },
  };
  function poolFor(topic, a, ctx) {
    const T = LINES[topic] || LINES[ALIAS[topic]];
    if (!T) return null;
    const r = (ctx && ctx.role) || role(a);
    const Wt = ctx && ctx.why && WHY[topic] && WHY[topic][ctx.why];
    if (Wt) return Wt[r] || Wt[groupOf(r)] || Wt["*"];
    if (ctx && ctx.mood && T[ctx.mood]) return T[ctx.mood];
    return T[r] || T[groupOf(r)] || T["*"] || null;
  }
  function fill(s, a, ctx) {
    if (!s || s.indexOf("{") < 0) return s;
    const v = ctx && ctx.victim;
    const f = v && (v.gender === "f" || v.female);
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      if (k === "him") return f ? "her" : "him";
      const vars = ctx && ctx.vars;
      return vars && vars[k] != null ? String(vars[k]) : "";
    }).replace(/\s{2,}/g, " ").trim();
  }
  let _lines = 0, _said = 0, _silent = 0, _reacts = 0, _spread = 0;
  function line(a, topic, ctx) {
    if (!a || !topic) return null;
    // AN ORDER is said on its rung, every time it is given: no walk, no
    // "somebody said it a minute ago" (the warden repeats himself)
    if (topic === "order") {
      const O = ctx && ctx.order ? LINES.order[ctx.order] : null;
      if (!O || !O.length) return null;
      _lines++;
      return O[Math.min(O.length - 1, Math.max(0, (ctx.again | 0)))];
    }
    const pool = poolFor(topic, a, ctx);
    if (!pool) return null;
    const lad = ctx && ctx.ladder;
    const s = pick(a, ALIAS[topic] && !LINES[topic] ? ALIAS[topic] : topic, pool, lad ? (lad.step | 0) : null);
    if (s) _lines++;
    return fill(s, a, ctx);
  }

  // ---- the mouth ------------------------------------------------------
  // over the head (systems/speech.js). The city's citySay drops anyone not in
  // your car while you drive: an answer TO the driver ("I'm walking here!") is
  // the one thing that must reach him, so the city goes to speech directly.
  function mouth(a, text, ctx) {
    if (!text || !a || out(a)) return false;
    const S = CBZ.speech;
    const g = CBZ.game || {};
    const secs = (ctx && ctx.secs) || 2.0;
    const toYou = !!(ctx && ctx.by && isPlayer(ctx.by));
    if (g.mode === "escape" && CBZ.prisonSay) {
      try { return !!CBZ.prisonSay(a, text, { secs: secs, force: toYou || !!(ctx && ctx.force) }); } catch (e) { return false; }
    }
    if (g.mode === "city") {
      const P = CBZ.player;
      if (P && (P._aircraft || P.dead)) return false;
      if (P && P.driving && !toYou && a._vehicle !== P._vehicle) return false;
    }
    if (S && S.say) {
      try { return !!S.say(a, text, { secs: secs, force: toYou || !!(ctx && ctx.force), ear: ctx && ctx.ear }); } catch (e) { return false; }
    }
    if (CBZ.citySay) { try { return CBZ.citySay(a, text, null, secs) !== false; } catch (e) { return false; } }
    return false;
  }
  const SAY_GAP = 3.2;     // s: one man, one line, then a breath
  function say(a, topic, ctx) {
    if (!a || out(a)) return false;
    const t = now();
    if (!(ctx && ctx.force) && t < (a._vSayT || 0)) return false;
    const s = line(a, topic, ctx);
    if (!s) return false;
    const ok = mouth(a, s, ctx);
    if (ok) { a._vSayT = t + SAY_GAP; _said++; lastText = s; }
    return ok;
  }
  let lastText = null;      // what say() last put out (react returns it)

  // ================================================================ PERFORM
  const PERF = {};      // game -> fn(actor, how, ctx) -> bool
  function setPerform(fn, game) { PERF[game || "*"] = fn || null; }
  const _awayMove = { speed: "walk", arrive: 1, face: true, flee: false };
  // the default body: the brain's act seam (each game registered its
  // executor there), or the bare fields every body has
  function performDefault(a, how, ctx) {
    const B = CBZ.brain, A = B && B.act;
    const p = posOf(a); if (!p) return false;
    const sx = ctx.sx, sz = ctx.sz;
    let ax = p.x - sx, az = p.z - sz;
    const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
    if (!A) return false;
    try {
      switch (how) {
        case "glance": case "squareUp": case "call": return A.face(a, sx, sz);
        case "walkOff": case "hurry": case "sprint": case "backOff": case "holdFriend": {
          const dist = how === "sprint" ? 20 : how === "hurry" ? 12 : how === "backOff" ? 3 : 8;
          _awayMove.speed = how === "sprint" ? "sprint" : how === "hurry" ? "jog" : "walk";
          _awayMove.flee = how === "sprint";
          return A.moveTo(a, p.x + ax * dist, p.z + az * dist, _awayMove);
        }
        case "freeze": return A.stop(a);
        case "cower": return A.posture(a, "cower");
        case "handsUp": return A.posture(a, "handsUp");
        case "draw": return A.posture(a, "aim");
        case "fight": return ctx.by ? A.verb("attack", a, ctx.by) : false;
        case "help": return ctx.by ? A.verb("attack", a, ctx.by) : false;
      }
    } catch (e) {}
    return false;
  }
  function perform(a, how, ctx) {
    if (!how || how === "ignore") return false;
    const f = PERF[gameOf(a)] || PERF["*"];
    if (f) { try { const r = f(a, how, ctx); if (r !== undefined) return !!r; } catch (e) {} }
    return performDefault(a, how, ctx);
  }

  // ================================================================ NEAR
  const NEAR = {};
  function setNear(fn, game) { NEAR[game || "*"] = fn || null; }
  const _nearBuf = [], _brainBuf = [];
  function near(x, z, r) {
    _nearBuf.length = 0;
    const f = NEAR[gameOf(null)] || NEAR["*"];
    if (f) { try { f(x, z, r, _nearBuf); return _nearBuf; } catch (e) { _nearBuf.length = 0; } }
    const B = CBZ.brain;
    if (B && B.near) {
      try {
        const L = B.near(x, z, r, _brainBuf);
        for (let i = 0; i < L.length; i++) if (L[i] && L[i].actor) _nearBuf.push(L[i].actor);
      } catch (e) {}
    }
    return _nearBuf;
  }
  function friends(a, b) {
    if (!a || !b || a === b) return false;
    if (a.partner === b || b.partner === a) return true;
    if (a.friends && a.friends.indexOf && a.friends.indexOf(b) >= 0) return true;
    if (b.friends && b.friends.indexOf && b.friends.indexOf(a) >= 0) return true;
    if (typeof a.gang === "string" && a.gang && a.gang === b.gang) return true;
    if (typeof a.gang === "number" && a.gang >= 0 && a.gang === b.gang) return true;
    const ab = a._brain, bb = b._brain;
    if (ab && bb && ab.clique != null && ab.clique === bb.clique) return true;
    return false;
  }
  function busy(a) {
    return out(a) || a.controlled || a.companion || a.recruited || a.inCar || a.restraint || a.cuffed || a.tied ||
      a.state === "fight" || a.aiState === "fight" || !!a.rage;
  }

  // ================================================================ DECIDE
  // { how, topic, p } — p is the chance he says it. Silence is the default.
  const _D = { how: "ignore", topic: null, p: 0, mood: null };
  function D(how, topic, p, mood) { _D.how = how; _D.topic = topic || null; _D.p = p || 0; _D.mood = mood || null; return _D; }
  function decide(a, ev, T, r, cap, st, P, ctx) {
    const law = !!LAW[r];
    const brave = P.courage, ag = P.aggression;
    switch (ev) {
      case "seeGun": {
        if (st === "ready") return T > 0.3 ? D(law || cap === "gun" ? "draw" : "squareUp", law ? "standoff" : null, law ? 0.6 : 0.1) : D("glance");
        if (st === "careless") return D("glance");
        if (st === "scared") return T > 0.35 ? D("backOff", "dontWantTrouble", 0.3) : D("glance");
        if (st === "tough") return T > 0.6 ? D("backOff") : D("glance");
        if (T > 0.72) return D("sprint", (ctx.ring | 0) === 0 ? "hesGotAGun" : null, 0.3);
        if (T > 0.48) return D("hurry", "seeGun", 0.08);
        if (T > 0.22) return P.curiosity > 0.7 ? D("glance") : D("walkOff");
        return T > 0.05 ? D("glance") : D("ignore");
      }
      case "aimedAt": {
        if (st === "ready" || st === "careless") return D("draw", "standoff", law ? 0.7 : 0.45);
        if (st === "scared") return D("backOff", "dontWantTrouble", 0.5);
        if (r === "vip") return D("call", "security", 0.9);
        const d = ctx.d;
        if (d > 8 && brave < 0.45) return D("sprint", "hesGotAGun", 0.25);
        if (st === "tough" && T < 0.55) return D("backOff", "leaveMe", 0.3);
        return D("handsUp", "comply", 0.45);
      }
      case "seeHit": {
        const v = ctx.victim;
        if (v && friends(a, v)) return decide(a, "friendHurt", T, r, cap, st, P, ctx);
        if (law) return D("squareUp", "seeHit", 0.55);
        if (st === "ready") return D("glance");
        if (st === "tough" && T < 0.5 && ag > 0.65) return D("squareUp", "stop", 0.4);
        if (T > 0.6) return D("hurry", "seeHit", 0.1);
        if (T > 0.35) return D("walkOff", "seeHit", 0.08);
        return D("glance", "seeHit", 0.06);
      }
      case "hit": {
        if (r === "vip") return D("call", "security", 1);
        if (st === "ready" || st === "tough" || (ag > 0.55 && T < 0.75)) return D("fight", "hitBack", 0.5);
        if (T > 0.5) return D("sprint", "leaveMe", 0.35);
        return D("backOff", "hit", 0.5);
      }
      case "bumped": {
        if (T > 0.5) return D("walkOff");
        const gap = CBZ.cityReadGap && CBZ.game && CBZ.game.mode === "city" && ctx.by && isPlayer(ctx.by) ? safe(CBZ.cityReadGap, a) : 0;
        if (gap >= 1 || ag < 0.28) return D("glance", "bumpSorry", gap >= 1 ? 0.45 : 0.2);
        if (ag > 0.66 && (r === "gangster" || r === "inmate")) return D("squareUp", "bumped", 0.6);
        return D("glance", "bumped", 0.3);
      }
      case "shoved": case "repeated": {
        if (T > 0.55) return D("hurry", "dontWantTrouble", 0.3);
        const gap = CBZ.cityReadGap && CBZ.game && CBZ.game.mode === "city" && ctx.by && isPlayer(ctx.by) ? safe(CBZ.cityReadGap, a) : 0;
        if (law) return D("squareUp", "shoved", 0.7);
        if ((ag > 0.6 || st === "ready" || st === "tough") && T < 0.45 && gap < 2) return D(ev === "repeated" ? "fight" : "squareUp", "shoveBack", 0.7);
        if (ag > 0.3 && gap < 1) return D("backOff", "shoved", 0.55);
        return D("walkOff", "leaveMe", 0.35);
      }
      case "carCutoff": {
        if (ag > 0.55 && T < 0.5) return D("squareUp", "carCutoff", 0.75);
        if (ag < 0.25) return D("backOff");
        return D("glance", "carCutoff", 0.5);
      }
      case "nearMiss": {
        if (brave < 0.35 && T > 0.5) return D("hurry", "nearMiss", 0.2);
        return D("backOff", "nearMiss", ag > 0.4 ? 0.5 : 0.3);
      }
      case "runOver": return D("cower", "runOver", 0.5);
      // the grab verb owns the body: these speak only
      case "held": return D(ag > 0.5 ? "fight" : "cower", "held", 0.85);
      case "carried": return D("cower", "carried", 0.95);
      case "thrown": return D("cower", null, 0);
      case "dropped": return D(T > 0.2 ? "sprint" : "walkOff", "dropped", 0.3);
      case "robbed": {
        if ((st === "ready" || st === "tough") && T < 0.4) return D("squareUp", "refuse", 0.7);
        return D("handsUp", "robbed", 0.7);
      }
      case "caught": {
        if (law) return D("squareUp", "caught", 0.9);
        if (ag > 0.5 && T < 0.5) return D("squareUp", "caught", 0.8);
        return D("backOff", "caught", 0.7);
      }
      case "seeRun": {
        if (st === "ready") return D(cap === "gun" ? "draw" : "squareUp", law ? "hesGotAGun" : null, law ? 0.15 : 0);
        if (st === "careless") return D("glance");
        if ((ctx.ring | 0) <= 1 && ctx.why === "gun") return D("sprint", "hesGotAGun", 0.2);
        return D("sprint", "whatsHappening", 0.05);
      }
      case "seeBody": {
        if (law) return D("squareUp", "seeBody", 0.6);
        if (T > 0.4) return D("hurry", "seeBody", 0.15);
        return D("walkOff", "seeBody", 0.15);
      }
      case "friendHurt": {
        const thr = 0.3 + brave * 0.4 + P.loyalty * 0.2 + (cap === "gun" ? 0.25 : cap === "melee" ? 0.1 : 0);
        if (P.loyalty > 0.45 && T < thr) return D(cap === "gun" ? "draw" : "help", "friendHurt", 0.7);
        if (T > 0.55) return D("sprint", "leaveMe", 0.2);
        return D("hurry");
      }
      case "friendKilled": {
        if (ag > 0.55 && T < 0.7) return D("fight", "friendKilled", 0.9, "angry");
        return D(T > 0.4 ? "sprint" : "cower", "friendKilled", 0.8);
      }
      case "restrained": return D("cower", "restrained", 0.6);
      // SOMEBODY THREATENED HIM to his face (the city's Threaten). He answers
      // by who he is: the law squares up or draws, a hard man with a gun
      // draws, a man with a detail calls it, the rest back off or go quiet.
      case "threatened": {
        if (ctx.guarded && st !== "ready") return D("call", "security", 0.9);
        if (law) return cap === "gun" && T > 0.45 ? D("draw", "standoff", 0.6) : D("squareUp", "warn", 0.6);
        if (st === "ready") return T > 0.5 ? D("draw", "standoff", 0.7) : D("squareUp", "scoffFight", 0.6);
        if (st === "tough") return T > 0.6 ? D("backOff", "dontWantTrouble", 0.5) : D("squareUp", "scoffFight", 0.6);
        if (ctx.aimed && T > 0.55) return D("handsUp", "comply", 0.6);
        if (T > 0.7) return D("hurry", "scared", 0.5);
        if (T > 0.38) return D("backOff", "dontWantTrouble", 0.45);
        return D("walkOff", null, 0);
      }
    }
    return D("ignore");
  }
  function safe(fn, a) { try { return fn(a) | 0; } catch (e) { return 0; } }

  // events the grab verbs own the body for: we only speak
  const SPEAK_ONLY = { held: 1, carried: 1, thrown: 1, runOver: 1, restrained: 1 };
  // how often a man may be asked the same question (s)
  const REACT_GAP = { threatened: 2, bumped: 2.5, shoved: 1.5, repeated: 1.5, nearMiss: 3, carCutoff: 3, seeGun: 2.5, aimedAt: 6, seeHit: 3, seeRun: 4, seeBody: 8, held: 2.5, carried: 4 };
  function react(a, ev, ctx) {
    const _res = { how: "ignore", line: null };
    if (!a || !ev || isPlayer(a)) return _res;
    if (out(a) && ev !== "held" && ev !== "carried") return _res;
    ctx = ctx || {};
    const t = now();
    const gap = REACT_GAP[ev] || 1;
    const memo = a._vEv || (a._vEv = {});
    if (t - (memo[ev] || -1e9) < gap && !ctx.force) return _res;
    memo[ev] = t;
    _reacts++;
    const by = ctx.by || null;
    const ap = posOf(a);
    const sp = by ? posOf(by) : null;
    ctx.sx = ctx.x != null ? ctx.x : sp ? sp.x : ap ? ap.x : 0;
    ctx.sz = ctx.z != null ? ctx.z : sp ? sp.z : ap ? ap.z : 0;
    ctx.d = ap ? Math.hypot(ap.x - ctx.sx, ap.z - ctx.sz) : 0;
    const T = ctx.threat != null ? ctx.threat : by ? threat(a, by, ctx) : clamp01(1 - ctx.d / 30) * 0.5;
    const r = role(a), cap = capability(a), P = persona(a), st = stance(a, cap, r, P);
    if (ev === "aimedAt" && ctx.aimed == null) ctx.aimed = true;
    const dd = decide(a, ev, T, r, cap, st, P, ctx);
    let how = ctx.how || dd.how;
    // the caller moved the body (or the grab verb holds it): speak only
    // ctx.bodyless: the game's own brain answers with the body; we only speak
    // a body that runs from the thing is news to the next ring: registered
    // BEFORE the body moves, so the field raise its flee makes merges into
    // this entry (and keeps this ring) instead of starting a fresh one
    if (how === "sprint" && ap) runner(a, ctx.sx, ctx.sz, ctx.why || (ev === "seeGun" || ev === "aimedAt" ? "gun" : null), (ctx.ring | 0));
    if (!ctx.how && !ctx.silent && !ctx.bodyless && !SPEAK_ONLY[ev]) perform(a, how, ctx);
    _res.how = how;
    // the words: only when this person would really say them
    let topic = dd.topic;
    if (ctx.how && ctx.topic !== undefined) topic = ctx.topic;
    else if (ctx.how && ctx.how !== dd.how) topic = TOPIC_FOR_HOW[ev] && TOPIC_FOR_HOW[ev][ctx.how] !== undefined ? TOPIC_FOR_HOW[ev][ctx.how] : topic;
    if (topic && !ctx.silent && !ctx.mute) {
      // a stable talker: the same man is the one who speaks up
      const chance = dd.p * (0.6 + hashA(a, 0x7A1C) * 0.8);
      if (rnd() < chance || ctx.speak) {
        const sayCtx = { by: by, victim: ctx.victim, mood: dd.mood, force: !!ctx.force, secs: ctx.secs };
        if (say(a, topic, sayCtx)) _res.line = lastText;
      } else _silent++;
    }
    // the carried man's cry reaches the people around him
    if (ev === "carried" && by) helpCall(a, by);
    return _res;
  }
  // when the caller already moved the body, the line follows what it did
  const TOPIC_FOR_HOW = {
    aimedAt: { handsUp: "comply", freeze: "comply", draw: "standoff", squareUp: "standoff", fight: "hitBack", sprint: "hesGotAGun", backOff: "dontWantTrouble", cower: "comply" },
    seeGun: { sprint: "hesGotAGun", draw: "standoff", backOff: "dontWantTrouble", handsUp: "comply" },
    shoved: { fight: "shoveBack", squareUp: "shoveBack", backOff: "shoved", sprint: "leaveMe", hurry: "leaveMe" },
    bumped: { fight: "shoveBack", squareUp: "bumped" },
    hit: { fight: "hitBack", sprint: "leaveMe", handsUp: "comply", cower: "hit" },
    seeRun: { sprint: "whatsHappening" },
  };

  // ================================================================ WITNESS
  // the people who saw it answer it (seeGun / seeHit / seeBody / ...)
  const _wit = [];
  function witness(x, z, ev, ctx, r) {
    const L = near(x, z, r || 18);
    const W = _wit.length ? [] : _wit;        // re-entered: a fresh list, never the one being walked
    W.length = 0;
    for (let i = 0; i < L.length; i++) W.push(L[i]);
    let n = 0;
    const by = ctx && ctx.by;
    for (let i = 0; i < W.length && n < 10; i++) {
      const a = W[i];
      if (!a || a === by || (ctx && a === ctx.victim) || isPlayer(a) || busy(a)) continue;
      const ap = posOf(a); if (!ap) continue;
      const src = by ? posOf(by) : null;
      if (src && !sees(a, by, ap, src, Math.hypot(src.x - ap.x, src.z - ap.z))) continue;
      if (ev === "seeHit" && by) a[SAW] = sawRec(a, by);
      // a stagger: the near ones first
      const c = { by: by, victim: ctx && ctx.victim, x: src ? undefined : x, z: src ? undefined : z,
        why: ctx && ctx.why, ring: 0, bodyless: !!(ctx && ctx.bodyless) };
      react(a, ev, c);
      n++;
    }
    W.length = 0;
    return n;
  }
  function sawRec(a, by) { const s = a[SAW] || {}; s.by = by; s.t = now(); return s; }

  // ================================================================ HELP
  // "Someone help me!" — a friend beside him weighs the man doing it. Loyal
  // and the threat is one he can take: he goes in. Loyal and it is too much:
  // the OTHER friend at his side holds his arm — "Don't, it's not worth it" —
  // and they both walk. Strangers mostly look, and walk on quicker.
  function helpCall(victim, by) {
    const vp = posOf(victim); if (!vp || !by) return 0;
    const t = now();
    if (t < (victim._vHelpT || 0)) return 0;
    victim._vHelpT = t + 5;
    const L = near(vp.x, vp.z, 18);
    const H = _help.length ? [] : _help;
    H.length = 0;
    for (let i = 0; i < L.length; i++) H.push(L[i]);
    let helper = null, held = false, n = 0;
    for (let i = 0; i < H.length && n < 8; i++) {
      const c = H[i];
      if (!c || c === victim || c === by || isPlayer(c) || busy(c) || c._vHelpSeen === t) continue;
      c._vHelpSeen = t;
      n++;
      const T = threat(c, by, null);
      const r = role(c), cap = capability(c), P = persona(c);
      const friend = friends(c, victim);
      const law = !!LAW[r];
      const ctx = { by: by, victim: victim, threat: T };
      if (law && !helper) {
        helper = c;
        react(c, "friendHurt", Object.assign(ctx, { how: cap === "gun" ? "draw" : "help", topic: "help", speak: true }));
        perform(c, cap === "gun" ? "draw" : "help", fillXZ(ctx, by));
        continue;
      }
      const thr = 0.3 + P.courage * 0.4 + P.loyalty * 0.2 + (cap === "gun" ? 0.25 : cap === "melee" ? 0.1 : 0);
      if (friend && P.loyalty > 0.4) {
        // the one beside him who is not the victim
        const mate = companionOf(c, victim, by);
        if (T < thr && !helper) {
          helper = c;
          ctx.how = cap === "gun" ? "draw" : "help"; ctx.topic = "help"; ctx.speak = true;
          react(c, "friendHurt", ctx);
          perform(c, ctx.how, fillXZ(ctx, by));
          continue;
        }
        if (mate && !held) {
          held = true; mate._vHelpSeen = t;
          // he wants to go; she sees the man doing it and holds him back
          const mctx = fillXZ({ by: by, victim: victim, friend: c }, by);
          perform(mate, "holdFriend", mctx);
          mctx.how = "holdFriend"; mctx.topic = "dontHelp"; mctx.speak = true; mctx.force = true;
          react(mate, "friendHurt", mctx);
          continue;
        }
        perform(c, T > 0.55 ? "hurry" : "glance", fillXZ({ by: by }, by));
        continue;
      }
      // strangers
      if (P.courage > 0.78 && P.aggression > 0.6 && T < 0.3 && !helper) {
        helper = c;
        const sctx = fillXZ({ by: by, victim: victim, how: "help", topic: "help", speak: rnd() < 0.6 }, by);
        perform(c, "help", sctx);
        react(c, "friendHurt", sctx);
        continue;
      }
      perform(c, T > 0.5 ? "hurry" : T > 0.2 ? "walkOff" : "glance", fillXZ({ by: by }, by));
    }
    return n;
  }
  const _help = [];
  function fillXZ(ctx, by) {
    const p = posOf(by);
    if (p) { ctx.sx = p.x; ctx.sz = p.z; }
    return ctx;
  }
  function companionOf(c, victim, by) {
    const cp = posOf(c); if (!cp) return null;
    const cand = [c.partner].concat(c.friends || []);
    for (let i = 0; i < cand.length; i++) {
      const m = cand[i];
      if (!m || m === victim || m === by || busy(m)) continue;
      const mp = posOf(m); if (!mp) continue;
      if (Math.hypot(mp.x - cp.x, mp.z - cp.z) < 6) return m;
    }
    // a stranger at his elbow counts too (the person he is walking with)
    const L = near(cp.x, cp.z, 3);
    for (let i = 0; i < L.length; i++) {
      const m = L[i];
      if (m && m !== c && m !== victim && m !== by && !isPlayer(m) && !busy(m) && (m.partner === c || friends(m, c))) return m;
    }
    return null;
  }

  // ================================================================ PANIC
  // THE CROWD RUNS BECAUSE IT SEES THE CROWD RUN. A ring buffer of runners
  // (a body that broke and ran) and commotion points (the city's panic raises:
  // a scream, a crash, a bolt nobody here registered by name). Each entry is
  // looked at, once, after a beat, by the people around it.
  const RMAX = 64;
  const R_A = new Array(RMAX), R_X = new Float32Array(RMAX), R_Z = new Float32Array(RMAX),
    R_FX = new Float32Array(RMAX), R_FZ = new Float32Array(RMAX), R_T = new Float64Array(RMAX),
    R_AT = new Float64Array(RMAX), R_RING = new Uint8Array(RMAX), R_WHY = new Array(RMAX),
    R_DONE = new Uint8Array(RMAX), R_W = new Float32Array(RMAX), R_USE = new Uint8Array(RMAX);
  let rHead = 0;
  const RING_MAX = 4, SEE_R = 14, NEED = 2, LIFE = 5;
  // one event, one entry: a body and the field raise its flee made are the same news
  function merge(a, x, z, fx, fz, t, why, ring, w) {
    for (let i = 0; i < RMAX; i++) {
      if (!R_USE[i] || t - R_T[i] > 0.6) continue;
      if (a && R_A[i] && R_A[i] !== a) continue;
      const dx = R_X[i] - x, dz = R_Z[i] - z;
      if (dx * dx + dz * dz > 2.25) continue;
      // a named runner owns what he knows; an anonymous raise only adds weight
      if (a && !R_A[i]) { R_A[i] = a; R_RING[i] = ring; R_FX[i] = fx; R_FZ[i] = fz; }
      else if (a && ring < R_RING[i]) R_RING[i] = ring;
      if (why && !R_WHY[i]) R_WHY[i] = why;
      if (w > R_W[i]) R_W[i] = w;
      return true;
    }
    return false;
  }
  function push(a, x, z, fx, fz, why, ring, w) {
    const t = now();
    ring = Math.min(255, ring | 0);
    if (merge(a, x, z, fx, fz, t, why, ring, w)) return;
    const i = rHead; rHead = (rHead + 1) % RMAX;
    R_USE[i] = 1; R_A[i] = a || null; R_X[i] = x; R_Z[i] = z; R_FX[i] = fx; R_FZ[i] = fz;
    R_T[i] = t; R_AT[i] = t + 0.35 + (a ? hashA(a, 0x5EED) : rnd()) * 0.45;   // the beat before the next ring reads it
    R_RING[i] = ring; R_WHY[i] = why || null; R_DONE[i] = 0; R_W[i] = w;
  }
  function runner(a, fx, fz, why, ring) {
    const p = posOf(a); if (!p || isPlayer(a)) return;
    const t = now();
    if (t < (a._vRunT || 0)) return;            // already news
    a._vRunT = t + 4;
    push(a, p.x, p.z, fx, fz, why, ring, 1);
  }
  // a commotion at a spot (the city's cityPanicRaise): people near it see it
  // and run from the spot itself. Nobody near it knows why: ring 1.
  function runnerAt(x, z, amt) {
    // a big one (a blast, a robbery) is seen alone; a small one needs company
    push(null, x, z, x, z, null, 1, Math.min(3, (amt == null ? 1 : amt) * 1.6));
  }
  // how much fresh running can THIS body see, and where is it running from
  const _seen = { n: 0, x: 0, z: 0, ring: 0, why: null };
  function runnersSeen(a, ap) {
    _seen.n = 0; _seen.x = 0; _seen.z = 0; _seen.ring = 255; _seen.why = null;
    let k = 0;
    const t = now();
    const yaw = yawOf(a);
    const fx = yaw != null ? Math.sin(yaw) : 0, fz = yaw != null ? Math.cos(yaw) : 0;
    for (let i = 0; i < RMAX; i++) {
      if (!R_USE[i] || R_A[i] === a || t - R_T[i] > LIFE) continue;
      const rp = R_A[i] ? (posOf(R_A[i]) || null) : null;
      const rx = rp ? rp.x : R_X[i], rz = rp ? rp.z : R_Z[i];
      const dx = rx - ap.x, dz = rz - ap.z, d = Math.hypot(dx, dz);
      if (d > SEE_R) continue;
      if (yaw != null && d > 4 && (dx * fx + dz * fz) / d < -0.2) continue;   // not behind him
      _seen.n += R_W[i] * (d < 4 ? 2 : 1);      // one man flat out past your elbow is two
      _seen.x += R_FX[i]; _seen.z += R_FZ[i]; k++;
      if (R_RING[i] < _seen.ring) { _seen.ring = R_RING[i]; _seen.why = R_WHY[i]; }
    }
    if (k > 0) { _seen.x /= k; _seen.z /= k; }
    return _seen;
  }
  const _spreadCtx = { by: null, x: 0, z: 0, ring: 0, why: null };
  const _spr = [];
  function spreadTick() {
    const t = now();
    let budget = 3;                             // entries spread per tick
    for (let k = 0; k < RMAX && budget > 0; k++) {
      const i = (rHead + k) % RMAX;
      if (!R_USE[i]) continue;
      if (t - R_T[i] > LIFE) { R_USE[i] = 0; R_A[i] = null; R_WHY[i] = null; continue; }
      if (R_DONE[i] || t < R_AT[i]) continue;
      R_DONE[i] = 1; budget--;
      if (R_RING[i] >= RING_MAX) continue;
      const L = near(R_X[i], R_Z[i], SEE_R);
      _spr.length = 0;
      for (let j = 0; j < L.length; j++) _spr.push(L[j]);
      let woke = 0;
      for (let j = 0; j < _spr.length && woke < 6; j++) {
        const a = _spr[j];
        if (!a || isPlayer(a) || busy(a) || a.state === "flee" || a.aiState === "flee" || t < (a._vRunT || 0)) continue;
        if (a.vendor || a.staffPost || a._parked || a.surrender) continue;
        const ap = posOf(a); if (!ap) continue;
        const s = runnersSeen(a, ap);
        if (s.n < NEED) continue;
        _spreadCtx.by = null; _spreadCtx.x = s.x; _spreadCtx.z = s.z;
        _spreadCtx.ring = (s.ring === 255 ? R_RING[i] : s.ring) + 1; _spreadCtx.why = s.why;
        _spreadCtx.threat = 0.6; _spreadCtx.how = undefined; _spreadCtx.topic = undefined;
        _spreadCtx.speak = false; _spreadCtx.force = false;
        react(a, "seeRun", _spreadCtx);
        woke++; _spread++;
      }
    }
  }
  let tickAcc = 0;
  function tick(dt) {
    tickAcc += dt || 0;
    if (tickAcc < 0.1) return;
    tickAcc = 0;
    spreadTick();
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(34.2, tick);

  CBZ.voice = {
    __core: true,
    threat: threat, react: react, line: line, say: function (a, topic, ctx) { return say(a, topic, ctx); },
    role: role, setPerform: setPerform, setNear: setNear,
    runner: runner, runnerAt: runnerAt, witness: witness, helpCall: helpCall, perform: perform,
    knows: knows, pick: pick, capability: capability, stance: function (a) { const c = capability(a), r = role(a); return stance(a, c, r, persona(a)); },
    friends: friends, tick: tick, LINES: LINES,
    seed: function (n) { seedS = (n >>> 0) || 1; },
    audit: function () { return { lines: _lines, said: _said, silent: _silent, reacts: _reacts, spread: _spread }; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.voice;
})(typeof globalThis !== "undefined" ? globalThis : this);
