/* ============================================================
   systems/prison_react.js — WHAT A PERSON SAYS AFTER YOU DO SOMETHING TO THEM.

   OWNER (2026-08-06), on the subtitle band the prison speaks through:
   "the whole point of that pop up was for it to be dialogue from actual
   people that you walk up to, and then you do something, and then they say
   something different after what you do to them. That's the whole idea of
   interacting with the world. And what they say isn't just automatic based
   off what you do. It's based off the statistics of what it was before and
   what it is now after what you did, whether it was an interaction or
   running into them physically or pulling a gun out — and it's used for
   narration and dumb dialogue slop now."

   THE STATE THIS ANSWERS. The band works: prisonSay is ranged, ranked and
   names its speaker. What was going INTO it was narration wearing a
   speaker's name — the screen read

       Officer #1
       Caught red-handed! They're onto you!

   because systems/economy.js returns one canned string per verb and
   systems/interact.js printed it under the actor's name. Same verb, same
   sentence, every time, whoever you said it to and whatever they thought of
   you before you did. That is a caption with a nametag on it, not dialogue.

   THE MODEL, and it is the owner's sentence turned into code. A prison actor
   already carries a real relationship with the player — playerTrust,
   playerFear, playerGrudge, rep, love, bribed — which every system in the
   block already MOVES (economy's verbs, humancontact's shoves, intimidate's
   gun, guards' alert). Those numbers used to be printed at the player as the
   yellow "clean guard | flashlight up" read line; deleting that line is what
   freed them to do the job they should always have had.

     1. SNAPSHOT the actor's relationship BEFORE the thing happens.
     2. Let the thing happen. Any thing — a menu verb, a shoulder charge, a
        muzzle in the face. This file does not care which.
     3. DIFF. The axis that moved furthest (normalised per axis, because 3
        points of grudge and 3 points of love are not the same size) is the
        SUBJECT of the line.
     4. BAND the RESULT, not the delta. A man you just made afraid at fear 3
        and a man you just made afraid at fear 11 are not saying the same
        sentence, even though you did the identical thing to both.
     5. SPEAK it as that person, through CBZ.prisonSay.

   So the verb is not the input; the RELATIONSHIP is. Rob a stranger and rob
   somebody who trusted you and the two lines differ because the two men
   differ. Bump the same man three times and he escalates, because his grudge
   did. `cause` exists only as a REGISTER — a gun in the face and a shoulder
   in the ribs both raise fear, and the line has to be legible about which —
   never as the thing that picks the sentiment.

   DETERMINISM. Line choice is a stable hash of (speaker, axis, band, how
   many times this speaker has reacted), never Math.random: the same person
   in the same situation says the same thing, a different person says a
   different one, and repetition escalates instead of re-rolling. That is
   systems/quests.js's chainLine idiom ("a character trait, not a re-rolled
   die"), and doctrine.md's determinism rule keeps Math.random out of it.

   Flag: PRISON_REACT (default on). Off → callers fall back to whatever they
   printed before, so the revert is one line.
   Ratchet: CBZ.prisonReactAudit() → { reacted, silent, byAxis }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_REACT == null) CBZ.CONFIG.PRISON_REACT = true;
  function on() { return CBZ.CONFIG.PRISON_REACT !== false; }

  // ---------------------------------------------------------------------------
  //  THE AXES. `scale` is what "a full move" means on that axis, so a delta of
  //  3 on grudge (range 14) outranks a delta of 3 on love (range 100) — which
  //  is correct: three points of hatred is a lot, three points of infatuation
  //  is nothing. `band` is read off the RESULT.
  // ---------------------------------------------------------------------------
  const AXES = [
    { key: "playerGrudge", name: "grudge", scale: 14,  hi: 7 },
    { key: "playerFear",   name: "fear",   scale: 14,  hi: 7 },
    { key: "playerTrust",  name: "trust",  scale: 14,  hi: 6 },
    { key: "love",         name: "love",   scale: 100, hi: 55 },
    { key: "rep",          name: "rep",    scale: 100, hi: 45 },
    { key: "bribed",       name: "bought", scale: 25,  hi: 15 },
  ];
  const MOVED = 0.045;          // below this nothing meaningful happened

  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function snap(a) {
    if (!a) return null;
    const s = {};
    for (let i = 0; i < AXES.length; i++) s[AXES[i].key] = num(a[AXES[i].key]);
    s._cigs = num(CBZ.game && CBZ.game.cigs);
    return s;
  }

  function whoKind(a) {
    if (!a) return "inmate";
    if (a.kind === "warden") return "warden";
    if (a.kind === "guard") return a.corrupt ? "bent" : "guard";
    return "inmate";
  }
  // guard-ish speakers share a register; the warden and the bent cop each get
  // their own only where the difference is the whole point of the line.
  function register(a) {
    const k = whoKind(a);
    return k === "inmate" ? "inmate" : "guard";
  }
  function cleanName(a) {
    return a && a.data && a.data.name ? a.data.name.replace(/^the |^a |^an /, "") : "someone";
  }

  /* ---------------------------------------------------------------------------
     THE LINES. Keyed `axis:direction:band`, then split by register only where
     a screw and a con would not say the same thing. Every pool is a real
     sentence a person in a cell block says out loud — never a stat readout,
     never a summary of the event (you were there; you did it).
     --------------------------------------------------------------------------- */
  const LINES = {
    "grudge:up:lo": {
      inmate: ["Watch yourself.", "Do that again and we have a problem.", "You're pushing it, friend."],
      guard:  ["Careful, inmate.", "Try that again. See what happens.", "I've got my eye on you now."],
    },
    "grudge:up:hi": {
      inmate: ["I'm done with you.", "Not today. But you'll pay for that.", "Every man on this block is going to hear about this."],
      guard:  ["You just made this personal.", "That's it. You're on my list.", "I'll remember you at lights out."],
    },
    "grudge:down:lo": {
      inmate: ["…Alright. We're square.", "Forget it. It's forgotten."],
      guard:  ["Don't make me regret this.", "Clean slate. Keep it that way."],
    },
    "grudge:down:hi": {
      inmate: ["Doesn't fix it. But it's a start.", "I'm still angry. I'm just not stupid."],
      guard:  ["You're still on thin ice.", "One thing. That buys you one thing."],
    },
    "fear:up:lo": {
      inmate: ["Easy. Easy.", "I don't want trouble.", "Alright, you've made your point."],
      guard:  ["Back off, inmate.", "Don't crowd me."],
    },
    "fear:up:hi": {
      inmate: ["Don't— don't do it. Please.", "Take it. Take it, just take it!", "I've got a kid. I've got a kid."],
      guard:  ["Stay back! I'm calling this in!", "Don't. Whatever this is, don't."],
    },
    "fear:down:lo": {
      inmate: ["You don't scare me.", "That all you've got?"],
      guard:  ["You're nothing in here.", "Save it."],
    },
    "fear:down:hi": {
      inmate: ["I've seen worse than you in this place.", "You had me. You don't now."],
      guard:  ["I've broken up worse than you before breakfast.", "You're not the first."],
    },
    "trust:up:lo": {
      inmate: ["…Yeah. Alright.", "You're not so bad.", "Huh. Didn't expect that from you."],
      guard:  ["Hm. Keep your nose clean.", "Noted."],
    },
    "trust:up:hi": {
      inmate: ["Anything you need, you come to me first.", "I'd take the hole for you. You know that?", "You're solid. That's rare in here."],
      guard:  ["You didn't hear this from me.", "I've got a blind spot. Sometimes."],
    },
    "trust:down:lo": {
      inmate: ["Hm.", "…Right.", "Sure."],
      guard:  ["Move along.", "We're done."],
    },
    "trust:down:hi": {
      inmate: ["I don't know you any more.", "Don't come to me again."],
      guard:  ["I trusted you with something. That was my mistake.", "Don't speak to me."],
    },
    "love:up:lo": {
      inmate: ["…You always this smooth?", "Careful. I might start liking you.", "Don't make me laugh in here. People notice."],
      guard:  ["That's enough of that.", "Don't."],
    },
    "love:up:hi": {
      inmate: ["I think about you in here. That's dangerous.", "When you get out. Take me with you.", "Don't say things like that unless you mean them."],
      guard:  ["You're going to get me fired.", "…Not here. Not where they can see."],
    },
    "love:down:lo": {
      inmate: ["Don't.", "You had a moment there. It's gone."],
      guard:  ["Move.", "No."],
    },
    "love:down:hi": {
      inmate: ["Whatever that was, it's finished.", "I meant it. That's what makes this worse."],
      guard:  ["Forget it happened.", "We never spoke."],
    },
    "rep:up:lo": {
      inmate: ["Alright. You did good.", "Not bad, for a new fish."],
      guard:  ["Hm. That was useful.", "Don't let it go to your head."],
    },
    "rep:up:hi": {
      inmate: ["The block knows your name now.", "You're one of us. Act like it.", "People ask me about you. I tell them good things."],
      guard:  ["You're the only one in here worth talking to.", "Half this block would take a beating for you. That's power."],
    },
    "rep:down:lo": {
      inmate: ["That's not how it works in here.", "You're slipping."],
      guard:  ["Disappointing.", "Hm."],
    },
    "rep:down:hi": {
      inmate: ["Nobody's going to vouch for you now.", "You had something here. You burned it."],
      guard:  ["You were doing so well.", "And there it goes."],
    },
    "bought:up:lo": {
      inmate: ["…Fine. I never saw you.", "This buys a minute. Not a night."],
      guard:  ["…I didn't see anything.", "Walk. Fast. Before I change my mind."],
      warden: ["This block is blind for a moment. Use it well."],
      bent:   ["Cheap at the price. Go on.", "Pleasure doing business. Same time tomorrow?"],
    },
    "bought:up:hi": {
      inmate: ["For that? I'll swear you were in the chapel all night.", "You've bought yourself a friend, not a favour."],
      guard:  ["For this much I'll look at a wall for an hour.", "My report is going to be very boring tonight."],
      warden: ["My key. My rules. And today, my blind eye."],
      bent:   ["Now THAT is how it's done.", "You and me, we understand each other."],
    },
  };

  /* CAUSE OVERRIDES — a gun in the face and a shoulder in the ribs both raise
     fear, and the line must be legible about which. The BAND still comes from
     the stats (that is the owner's rule); only the wording is chosen by cause,
     and only for the physical causes where "why are you afraid" is otherwise
     unreadable. A menu verb never overrides — the relationship speaks. */
  const CAUSE_LINES = {
    "gun:lo": {
      inmate: ["Whoa— whoa. Point that somewhere else.", "Put it down. Put it DOWN."],
      guard:  ["Put it away. Now.", "You do NOT want to do that in here."],
    },
    "gun:hi": {
      inmate: ["Okay! Okay! It's yours, all of it!", "Don't shoot. Please don't shoot."],
      guard:  ["GUN! He's got a gun!", "Drop it! DROP IT!"],
    },
    "bump:lo": {
      inmate: ["Watch where you're walking.", "Hey. Eyes up.", "Mind yourself."],
      guard:  ["Hands to yourself, inmate.", "Do not touch me."],
    },
    "bump:hi": {
      inmate: ["Put your hands on me again. I dare you.", "That's twice. There won't be a third."],
      guard:  ["That's assault on an officer.", "Touch me one more time. Please."],
    },
    "robbed:lo": {
      inmate: ["Hey! That's mine!", "Get your hands out of my pocket!"],
      guard:  ["Hands! Get your hands where I can see them!", "You just tried to rob an officer."],
    },
    "robbed:hi": {
      inmate: ["You robbed ME? In here? You're finished.", "I'll get that back off your body."],
      guard:  ["You put your hand in MY pocket. You're going to the hole.", "That's a charge. A real one."],
    },
    // THE OTHER SIDE OF A THEFT. `robbed` is the victim; `lifted` is the man
    // whose hand was in YOUR pocket, talking on his way past. Same event, two
    // speakers — and the band is the grudge HE has built, because a thief who
    // already hates you is not making a joke of it.
    "lifted:lo": {
      inmate: ["Thanks for the smokes.", "You should keep those closer.", "Nothing personal. Everyone eats."],
      guard:  ["Consider that a fine.", "Contraband. Confiscated."],
    },
    "lifted:hi": {
      inmate: ["That's what you get. That's exactly what you get.", "Take it up with me. I dare you."],
      guard:  ["I'll take what I like off you. Who are you going to tell?"],
    },
  };

  /* NOTHING MOVED. The interaction bounced — they refused, they had nothing,
     the price was too high. They still speak, and what they say is WHERE THE
     RELATIONSHIP ALREADY STANDS, which is the same rule one step weaker. */
  function standingLine(a) {
    const grudge = num(a.playerGrudge), fear = num(a.playerFear), trust = num(a.playerTrust);
    const reg = register(a);
    if (grudge >= 7) return reg === "guard" ? "Nothing to say to you." : "Get away from me.";
    if (fear >= 7) return reg === "guard" ? "Just keep your distance." : "I don't want any part of this.";
    if (trust >= 6) return reg === "guard" ? "Not now. Ears everywhere." : "Not right now. Later, yeah?";
    if (grudge >= 4) return reg === "guard" ? "Keep walking." : "We're not friends.";
    const pool = a.data && a.data.talk;
    if (pool && pool.length) return pool[stableIdx(a, "idle", pool.length)];
    return reg === "guard" ? "Move along, inmate." : "What do you want?";
  }

  // stable per-speaker choice: same person + same situation → same line, and a
  // REPEAT of the same situation walks the pool instead of re-rolling it.
  function stableIdx(a, key, len) {
    if (len <= 1) return 0;
    const s = cleanName(a) + "|" + key;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
    return (h + (a._reactN || 0)) % len;
  }

  function poolFor(table, key, a) {
    const row = table[key];
    if (!row) return null;
    const k = whoKind(a);
    return row[k] || row[register(a)] || row.inmate || null;
  }

  let reacted = 0, silent = 0;
  const byAxis = Object.create(null);

  /* ---------------------------------------------------------------------------
     CBZ.prisonReact(actor, before, opts) — the whole contract.
       before : the object CBZ.prisonReactSnap(actor) returned before the event
       opts   : { cause, rank, secs, force }
     Returns TRUE if the actor spoke. Returns FALSE — and says nothing — when
     the flag is off, the actor cannot speak (prisonSay's own dead/KO/range
     rules), or nothing about the relationship changed and the caller did not
     ask for a standing line.
     --------------------------------------------------------------------------- */
  function react(a, before, opts) {
    opts = opts || {};
    if (!on() || !a || !CBZ.prisonSay) { silent++; return false; }

    let axis = null, dir = "", best = 0;
    if (before) {
      for (let i = 0; i < AXES.length; i++) {
        const ax = AXES[i];
        const d = num(a[ax.key]) - num(before[ax.key]);
        const mag = Math.abs(d) / ax.scale;
        if (mag > best) { best = mag; axis = ax; dir = d > 0 ? "up" : "down"; }
      }
    }
    // the player's own purse moving is how "they robbed me" and "I paid them"
    // are told apart from a bare grudge tick — a cause, not an axis.
    const cause = opts.cause || "";
    let line = null, tag = "";

    if (cause && CAUSE_LINES[cause + ":lo"]) {
      // band from the RESULT of the axis this cause drives (fear for a gun,
      // grudge for a shove/theft) — the stats decide the intensity, always.
      const drive = cause === "gun" ? "playerFear" : "playerGrudge";
      const dAx = AXES.find((x) => x.key === drive);
      const band = num(a[drive]) >= dAx.hi ? "hi" : "lo";
      const pool = poolFor(CAUSE_LINES, cause + ":" + band, a);
      if (pool && pool.length) { line = pool[stableIdx(a, cause + band, pool.length)]; tag = cause + ":" + band; }
    }
    if (!line && axis && best >= MOVED) {
      const band = Math.abs(num(a[axis.key])) >= axis.hi ? "hi" : "lo";
      const key = axis.name + ":" + dir + ":" + band;
      const pool = poolFor(LINES, key, a);
      if (pool && pool.length) { line = pool[stableIdx(a, key, pool.length)]; tag = key; }
    }
    if (!line && opts.force) { line = standingLine(a); tag = "standing"; }
    if (!line) { silent++; return false; }

    const spoke = CBZ.prisonSay(a, line, {
      rank: opts.rank != null ? opts.rank : (CBZ.PRISON_SAY ? CBZ.PRISON_SAY.answer : 2),
      secs: opts.secs || 2.6,
    });
    if (!spoke) { silent++; return false; }
    a._reactN = (a._reactN || 0) + 1;      // next time in this situation, next line
    reacted++;
    byAxis[tag] = (byAxis[tag] || 0) + 1;
    return true;
  }

  // one-call convenience for the common shape: snapshot, do the thing, react.
  // Returns whatever `fn` returned, so it drops straight over an existing call.
  function around(a, cause, fn, opts) {
    const before = snap(a);
    const out = fn();
    react(a, before, Object.assign({ cause: cause, force: true }, opts || {}));
    return out;
  }

  CBZ.prisonReactSnap = snap;
  CBZ.prisonReact = react;
  CBZ.prisonReactAround = around;
  // `silent` is a diagnostic (out of range, downed, nothing moved), not a
  // ratchet. The ratchet is `reacted` against CBZ.aiNarrationAudit().mute:
  // every event this file gives a voice to is one the block used to swallow.
  CBZ.prisonReactAudit = function () {
    return { on: on(), reacted: reacted, silent: silent, axes: AXES.length,
      pools: Object.keys(LINES).length + Object.keys(CAUSE_LINES).length,
      byAxis: Object.assign({}, byAxis) };
  };
})();
