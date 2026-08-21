/* ============================================================
   systems/prisonfriends.js — FRIENDSHIP IS OFFERED, NOT BROWSED.

   THE OWNER'S ASK, 2026-08-21, verbatim:
     "I want BEFRIEND almost entirely taken out of game... if a NPC you did
      something for like helped them in a fight saving their life, or traded
      with them many times, they might offer friendship... then befriend can
      exist and you can have like a person who backs you up and runs to you
      sometimes it's cool to have an NPC army and start your own gang"

   WHAT WAS THERE BEFORE. systems/interact.js carried a permanent BEFRIEND
   button on every inmate and every clean guard in the prison. It didn't make
   friends — it opened systems/quests.js's favour loop (ask for work, run it,
   collect rep) — so it was a chore button wearing a relationship word, and it
   was one of the three or four verbs crowding every card. That button is now
   called TALK, which is what it does, and this file owns the word it gave up.

   THE SHAPE. Friendship is a thing an NPC DECIDES, out of what you have
   actually done to him, and then OFFERS. Three ledgers feed it and all three
   are deeds, not clicks:

     SAVED   you pulled someone off him — you put down a man who was mid-fight
             with him, or hunting him, while he was losing. Hooked off
             CBZ.killstreakOnDown, which every path that drops an NPC already
             calls (combat.js melee, fpsmode shots, econ.beat, cuffs).
     REGULAR you have bought from the same man REGULARS_NEEDED times. econ.trade
             already paid +1 respect a sale; nobody was counting the sales.
     OWED    his favour ladder ran to the end (rep >= quests.FRIEND). This is
             the ORIGINAL alternate victory and it is untouched: taking his
             offer at that rung still walks you out the side gate.

   Any of those, plus no bad blood, and he offers. The offer is a state he
   carries (a.pfOffer), so it shows as ONE extra button on his card and as one
   spoken line the first time you're near him after he decides — and it is
   gated hard enough that most inmates in most runs will never make it.

   WHAT TAKING IT BUYS. Not a counter. He becomes CREW: entities/ai.js already
   has the behaviour — the `shadowPlayer` state, where an NPC walks at your
   shoulder, scares off anyone running to a guard about you, and swings at
   anyone hunting you. It shipped as a rental (a lookout you paid, a crew
   backup with a timer) and it is the exact thing a friend should do for free.
   This file keeps friends in it, permanently, and drops them the moment you
   turn on them. Befriend several and they all walk with you, which is the
   "NPC army" — grown one earned man at a time, out of the fights you turned up
   for and the stalls you kept buying from, rather than a button on a menu.

   CBZ.CONFIG.PRISON_FRIENDS = false disables the lot: nobody ever offers,
   BEFRIEND never appears, and the game is exactly the prison it was minus the
   button — which is also the correct degradation if this file fails to load.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_FRIENDS == null) CBZ.CONFIG.PRISON_FRIENDS = true;
  function on() { return CBZ.CONFIG.PRISON_FRIENDS !== false; }

  // ---- the thresholds, in one place ----------------------------------------
  const REGULARS_NEEDED = 5;    // sales to the same man before he counts you a regular
  const GRUDGE_BLOCK    = 4;    // any real bad blood and he is not offering anything
  const RESCUE_RADIUS   = 14;   // how close a fight has to be for you to be IN it
  const RESCUE_HP_FRAC  = 0.72; // he has to have been LOSING for it to be a rescue
  const SHADOW_TOP_UP   = 30;   // seconds of shadowPlayer we keep re-arming
  const FRIEND_RANGE    = 26;   // beyond this he goes about his day
  const OFFER_LINE_GAP  = 25;   // don't re-pitch the same offer inside this many seconds

  function friendRep() { return CBZ.quests && CBZ.quests.FRIEND != null ? CBZ.quests.FRIEND : 100; }
  function inPrison() { return !!(CBZ.game && CBZ.game.mode === "escape"); }
  function alive(a) { return !!(a && a.group && !a.dead && !a.escaped); }
  function nameOf(a) {
    const n = a && a.data && a.data.name ? a.data.name : "They";
    return String(n).replace(/^the |^a |^an /, "");
  }
  function dist2ToPlayer(a) {
    const P = CBZ.player;
    if (!P || !a || !a.group) return Infinity;
    const dx = P.pos.x - a.group.position.x, dz = P.pos.z - a.group.position.z;
    return dx * dx + dz * dz;
  }
  function actors() {
    const out = [];
    if (CBZ.npcs) for (const n of CBZ.npcs) out.push(n);
    if (CBZ.guards) for (const g of CBZ.guards) if (g.data) out.push(g);
    return out;
  }

  // ===========================================================================
  //  WHO IS ALLOWED TO OFFER
  //
  //  Deliberately narrow. The point of taking BEFRIEND off every card was that
  //  it meant nothing when everyone had it; an offer that fires on half the
  //  yard is the same button with extra steps.
  // ===========================================================================
  function eligible(a) {
    if (!on() || !alive(a) || !inPrison()) return false;
    if (a.kind === "warden") return false;                  // he is not your friend
    if (CBZ.game && CBZ.game.role === "cop") return false;   // wrong side of the badge
    if (a.intimidMode === "scared") return false;            // not at gunpoint, obviously
    if (a.approach && a.approach.t > 0) return false;        // he is mid-pitch about something else
    if ((a.playerGrudge || 0) >= GRUDGE_BLOCK) return false; // bad blood outranks any ledger
    if (a.aiState === "fight" && a.foe === CBZ.player) return false;
    if (CBZ.playerKnowsSnitch && CBZ.playerKnowsSnitch(a)) return false;  // he put your name in
    // A screw standing on a count is not making friends — the same clock
    // systems/quests.js and economy.js both defer to.
    const S = CBZ.prisonSchedule;
    if ((a.kind === "guard") && S && S.enabled() && (S.is("count") || S.is("secure") || S.is("wake"))) return false;
    return true;
  }

  /* Why he is offering — the deed he is answering, in the order that matters.
     Also the BEFRIEND button's chip (interact.js's subFor), which is why these
     are two or three words: it is a status chip, not a sentence. */
  function reasonFor(a) {
    if (!a) return "";
    if ((a.rep || 0) >= friendRep()) return "owes you";
    if (a.pfSaved) return "you saved him";
    if ((a.pfTrades || 0) >= REGULARS_NEEDED) return "a regular";
    return "";
  }

  // Has this man decided? Recomputed rather than latched, so bad blood or a
  // count silently withdraws the offer instead of leaving a stale button up.
  function offered(a) {
    if (!eligible(a)) return false;
    if (a.pfFriend) return false;                 // already crew; nothing left to offer
    return !!reasonFor(a);
  }

  // ===========================================================================
  //  THE LEDGERS
  // ===========================================================================

  /* A REGULAR. econ.trade already paid respect per sale and refreshed his
     stock; nobody was counting the sales themselves, so "traded with them many
     times" had nothing behind it. Wrapping rather than editing economy.js:
     city/social.js wraps the city's action verbs the same way, and it means
     this whole feature is one file that can be deleted. */
  function wrapTrade() {
    const econ = CBZ.econ;
    if (!econ || typeof econ.trade !== "function" || econ.trade._pfWrapped) return;
    const inner = econ.trade;
    function traded(actor) {
      const res = inner.apply(this, arguments);
      // Only a sale that actually happened. A refusal ("that's 14, you have 6")
      // comes back ok:false and must not count toward being a regular.
      if (res && res.ok && actor) {
        actor.pfTrades = (actor.pfTrades || 0) + 1;
        if (actor.pfTrades === REGULARS_NEEDED) actor.pfPitchT = 0;   // pitch it next time you're close
      }
      return res;
    }
    traded._pfWrapped = true;
    econ.trade = traded;
  }

  /* A RESCUE. CBZ.killstreakOnDown(actor, how) is called by every path that
     puts an NPC down — melee, gunfire, econ.beat, a cuffing — so it is the one
     place that knows "the player just dropped somebody". Whoever that somebody
     was fighting, and was LOSING to, was just saved.

     Two ways to have been in it: he is the downed man's foe, or the downed man
     was his. Both are checked, because ai.js's startFight only guarantees the
     link in one direction when the second party flees instead of squaring up. */
  function wrapDown() {
    if (!CBZ.killstreakOnDown || CBZ.killstreakOnDown._pfWrapped) return;
    const inner = CBZ.killstreakOnDown;
    function onDown(actor, how) {
      try { creditRescue(actor); } catch (e) { /* never let a bookkeeping bug eat a takedown */ }
      return inner.apply(this, arguments);
    }
    onDown._pfWrapped = true;
    CBZ.killstreakOnDown = onDown;
  }

  function creditRescue(downed) {
    if (!on() || !inPrison() || !downed) return;
    const P = CBZ.player;
    const saved = [];
    if (downed.foe && downed.foe !== P) saved.push(downed.foe);
    for (const n of actors()) {
      if (n === downed || saved.indexOf(n) >= 0) continue;
      if (n.foe === downed || (n.huntedBy === downed)) saved.push(n);
    }
    for (const n of saved) {
      if (!alive(n) || n === P) continue;
      // In the same fight as you, not across the wing from it.
      const dx = downed.group.position.x - n.group.position.x;
      const dz = downed.group.position.z - n.group.position.z;
      if (dx * dx + dz * dz > RESCUE_RADIUS * RESCUE_RADIUS) continue;
      // And you have to have been THERE. Dropping a man from the far side of
      // the yard with a rifle is a lot of things; it is not stepping in.
      if (dist2ToPlayer(n) > RESCUE_RADIUS * RESCUE_RADIUS) continue;
      // He has to have been losing it. A man who was winning does not owe you.
      const frac = (n.hp || 0) / (n.maxHp || 100);
      if (frac > RESCUE_HP_FRAC && n.aiState !== "flee") continue;
      if (n.pfSaved) continue;
      n.pfSaved = true;
      n.pfPitchT = 0;                                   // he'll say something next time you're close
      // The deed also moves the ledgers this prison already keeps, so a rescue
      // shows up in prices and in what he says even before he offers.
      if (CBZ.econ && CBZ.econ.addRespect) CBZ.econ.addRespect(n, 14);
      n.playerTrust = Math.min(14, (n.playerTrust || 0) + 4);
      n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 3);
    }
  }

  // ===========================================================================
  //  TAKING THE OFFER
  // ===========================================================================
  function accept(a) {
    if (!a) return { ok: false, msg: "" };
    // THE WALK-OUT IS UNCHANGED. At the top of his favour ladder, taking his
    // hand is still systems/quests.js's alternate victory — same function, same
    // ending, just reached through a button that now only exists because he
    // offered it.
    if ((a.rep || 0) >= friendRep() && CBZ.quests) return CBZ.quests.onTalk(a);
    if (!offered(a)) {
      // The offer lapsed between render and press (a count started, he took a
      // swing at you). Say so rather than silently doing nothing.
      return { ok: false, msg: `${nameOf(a)} isn't in the mood.` };
    }
    a.pfFriend = true;
    a.pfSince = CBZ.game ? (CBZ.game.t || 0) : 0;
    a.pfPitchT = 0;
    if (CBZ.econ && CBZ.econ.addRespect) CBZ.econ.addRespect(a, 20);
    if (CBZ.econ && CBZ.econ.addLoyalty) CBZ.econ.addLoyalty(a, 8);
    a.playerTrust = Math.min(14, (a.playerTrust || 0) + 6);
    a.playerGrudge = 0;
    shadow(a, true);
    CBZ.sfx && CBZ.sfx("coin");
    const n = count();
    const msg = n >= 3
      ? `From here I'm with you. That's ${n} of us now.`
      : "From here I'm with you. Anyone comes at you, they come at me.";
    return { ok: true, msg: msg };
  }

  /* Put him at your shoulder. entities/ai.js's shadowPlayer already walks an
     NPC beside the player, runs off anyone sprinting to a guard about you, and
     starts a fight with anyone hunting you — it just shipped on a timer,
     because every previous user of it was renting the man. A friend is not
     renting, so this re-arms the timer instead of setting it once, and only
     ever takes him out of a PASSIVE state: if he is already swinging, fleeing
     or on the floor, that is his business until it resolves. */
  const PASSIVE = { wander: 1, idle: 1, socialize: 1, queue: 1, rest: 1, work: 1, "": 1 };
  function shadow(a, force) {
    if (!alive(a)) return;
    if (a.aiState === "shadowPlayer") {
      a.shadowT = Math.max(a.shadowT || 0, SHADOW_TOP_UP);
      return;
    }
    if (!force && !PASSIVE[a.aiState || ""]) return;
    if (a.ko > 0) return;
    a.aiState = "shadowPlayer";
    a.shadowT = SHADOW_TOP_UP;
    a.foe = null;
  }

  // ===========================================================================
  //  UPKEEP — the one slow tick
  // ===========================================================================
  let acc = 0;
  function tick(dt) {
    if (!on() || !inPrison() || !CBZ.player) return;
    wrapTrade();                    // econ/killstreaks may load after this file
    wrapDown();
    acc += dt;
    if (acc < 0.4) return;
    const step = acc; acc = 0;

    for (const a of actors()) {
      if (a.pfPitchT > 0) a.pfPitchT -= step;

      if (a.pfFriend) {
        if (!alive(a)) { a.pfFriend = false; continue; }
        /* A FRIENDSHIP YOU BROKE IS OVER. Nothing else in this prison walks
           that back for you: swing on your own man, or run his grudge up, and
           he stops being crew — he does not merely sulk. */
        if ((a.playerGrudge || 0) >= 6 || (a.aiState === "fight" && a.foe === CBZ.player)) {
          a.pfFriend = false;
          a.pfSaved = false;
          a.pfTrades = 0;
          if (CBZ.prisonSay) CBZ.prisonSay(a, "We're done. Don't come near me.");
          continue;
        }
        // Close enough to be with you → be with you. Far away → he has a day.
        if (dist2ToPlayer(a) < FRIEND_RANGE * FRIEND_RANGE) shadow(a, false);
        continue;
      }

      /* THE PITCH. He decided; now he says so — once, the first time you're
         standing near him after the deed, in the same subtitle mouth every
         other prison line uses. Without this the only sign a man had made up
         his mind would be a new button appearing, which is a UI event, not a
         person. */
      if (!(a.pfPitchT > 0) && offered(a) && dist2ToPlayer(a) < 64) {
        a.pfPitchT = OFFER_LINE_GAP;
        const why = reasonFor(a);
        const line = why === "you saved him"
          ? "You didn't have to step in back there. I don't forget that."
          : why === "a regular"
            ? "You keep coming back to me. Say the word and I'm yours."
            : "You've run every errand I gave you. Ask me for anything.";
        if (CBZ.prisonSay) CBZ.prisonSay(a, line, { secs: 3.2 });
        else if (CBZ.citySay) CBZ.citySay(a, line, null, 3.2);
      }
    }
  }

  function count() {
    let n = 0;
    for (const a of actors()) if (a.pfFriend && alive(a)) n++;
    return n;
  }
  function list() {
    const out = [];
    for (const a of actors()) if (a.pfFriend && alive(a)) out.push(a);
    return out;
  }
  // A fresh run is a fresh yard: nobody in it has met you.
  function reset() {
    for (const a of actors()) {
      if (!a) continue;
      a.pfFriend = false; a.pfSaved = false; a.pfTrades = 0; a.pfPitchT = 0; a.pfSince = 0;
    }
  }

  // ---- the surface systems/interact.js reads -------------------------------
  CBZ.prisonFriendOffered = offered;
  CBZ.prisonFriendReason = reasonFor;
  CBZ.prisonFriendAccept = accept;
  CBZ.prisonFriends = list;
  CBZ.prisonFriendCount = count;
  CBZ.prisonFriendsReset = reset;
  // One line for a console, the way every other subsystem here publishes one.
  CBZ.prisonFriendAudit = function () {
    const rows = [];
    for (const a of actors()) {
      if (!alive(a)) continue;
      if (!a.pfFriend && !a.pfSaved && !(a.pfTrades > 0) && !offered(a)) continue;
      rows.push({
        who: nameOf(a), friend: !!a.pfFriend, offering: offered(a), why: reasonFor(a),
        saved: !!a.pfSaved, trades: a.pfTrades || 0, rep: Math.round(a.rep || 0),
        state: a.aiState || "",
      });
    }
    return { crew: count(), regularsNeeded: REGULARS_NEEDED, rows: rows };
  };

  // 93 sits with the other slow social ticks (hud's feed ager is 94/95), after
  // ai.js has run its states for the frame so a shadow we re-arm is not stomped
  // by the same frame's wander roll.
  if (CBZ.onAlways) CBZ.onAlways(93, tick);
})();
