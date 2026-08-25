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

   Any of those, plus no bad blood, and he offers. The offer is RECOMPUTED
   (offered(a)) rather than latched, so a count or a swing at you silently
   withdraws it instead of leaving a stale button up. It shows as ONE extra
   button on his card and as one spoken line the first time you're near him
   after he decides — and it is gated hard enough that most inmates in most
   runs will never make it.

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

   ---------------------------------------------------------------------------
   THE POSSE, 2026-08-25. The army above had no ceiling and no bills. Every man
   who ever owed you could be collected, and once collected he cost nothing and
   ate nothing forever. So the second half of the same design (CBZ.CONFIG
   .PRISON_POSSE, on by default; ?cfg_PRISON_POSSE=0 is the prison exactly as
   the paragraphs above describe it) adds the two facts that make a crew a
   thing you can lose:

     RESPECT GATES IT.  How many men will stand with you at once is your NAME,
        not your generosity — the best standing you hold anywhere in this
        prison (a gang's books, or the highest opinion any man outside your
        own crew has of you). 1 → 2 → 3 → 5, on economy.js's own standing
        thresholds so the ladder is legible in the words the cards already use.
        Nothing is ever SPENT: you do not buy a slot, you outgrow one. A man
        over the line still walks up and still says why — he just names the men
        already on you and refuses to be number four. His offer is not thrown
        away; it arms the moment a slot opens.

     CIGS FEED IT.  A crew eats. At chow, with you there and cigs in your
        pocket, it is one cig a man and he says thanks the first time that day.
        Broke, or off in a tunnel while the trays go out, and it is a missed
        meal — three of those and he goes to eat with somebody else, and the
        ledgers that earned him (pfSaved / pfTrades) go back to zero, so he is
        re-earned or he is gone.

   Two things it hands to systems that are not allowed to know about it:
   CBZ.posseShelterCut() — what fraction of your cigs the men standing next to
   you can palm when the wing gets shaken down — and CBZ.posseFlanked(), which
   is the answer to "is this man alone" that anybody deciding whether to try
   him should be asking.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_FRIENDS == null) CBZ.CONFIG.PRISON_FRIENDS = true;
  if (CBZ.CONFIG.PRISON_POSSE == null) CBZ.CONFIG.PRISON_POSSE = true;
  function on() { return CBZ.CONFIG.PRISON_FRIENDS !== false; }
  // The cap, the upkeep, the shelter and the flank read are ONE switch, and it
  // sits under the switch above: no friends, no posse to run.
  function posse() { return on() && CBZ.CONFIG.PRISON_POSSE !== false; }

  // ---- the thresholds, in one place ----------------------------------------
  const REGULARS_NEEDED = 5;    // sales to the same man before he counts you a regular
  const GRUDGE_BLOCK    = 4;    // any real bad blood and he is not offering anything
  const RESCUE_RADIUS   = 14;   // how close a fight has to be for you to be IN it
  const RESCUE_HP_FRAC  = 0.72; // he has to have been LOSING for it to be a rescue
  const SHADOW_TOP_UP   = 30;   // seconds of shadowPlayer we keep re-arming
  const FRIEND_RANGE    = 26;   // beyond this he goes about his day
  const CALL_RANGE      = 46;   // ...unless you are being jumped: then he RUNS
  const OFFER_LINE_GAP  = 25;   // don't re-pitch the same offer inside this many seconds

  // ---- the posse's own numbers ---------------------------------------------
  const FEED_COST    = 1;    // cigs, per man, per sitting
  const FEED_RANGE   = 30;   // he eats off your tray if he is at chow WITH you
  const MISSED_QUIT  = 3;    // missed sittings in a row before he walks
  const SHELTER_EACH = 0.25; // of a shakedown, per man standing on you
  const SHELTER_MAX  = 0.75; // they are inmates, not a bank
  const SHELTER_RANGE= 8;    // close enough to hand him something
  const FLANK_RANGE  = 8;    // ...and close enough to be counted as with you
  const FLANK_NEED   = 2;    // two men is an argument; one man is a witness
  /* THE LADDER. economy.js's socialRead() already turns a respect number into
     one of four words the cards print; these are its own thresholds, so "you
     run three men because you are SOLID with somebody" is a sentence the
     player can already read off a chip. */
  const CAP_TIERS = [
    { at: 100, cap: 5, word: "friend" },
    { at: 62,  cap: 3, word: "solid" },
    { at: 28,  cap: 2, word: "known" },
    { at: -1e9, cap: 1, word: "nobody" },
  ];
  const CHOW = { mess: 1, supper: 1 };   // both trays; "chow" is not one block
  const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
  const NUMWORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];
  function ordinal(n) { return ORDINALS[n] || ("number " + n); }
  function numword(n) { return NUMWORDS[n] || String(n); }

  function friendRep() { return CBZ.quests && CBZ.quests.FRIEND != null ? CBZ.quests.FRIEND : 100; }
  function inPrison() { return !!(CBZ.game && CBZ.game.mode === "escape"); }
  function alive(a) { return !!(a && a.group && !a.dead && !a.escaped); }
  function nameOf(a) {
    const n = a && a.data && a.data.name ? a.data.name : "They";
    return String(n).replace(/^the |^a |^an /, "");
  }
  /* HALF THIS WING IS NOT A PERSON. entities/npc.js names the cast in two
     ways: real men (Vince, Lou, the Professor) and fillers ("a thief", "an
     inmate"), and nameOf() strips the article because it was written for the
     front of a sentence. In the middle of one it produces "you already run with
     thief", so the posse's lines use the name the way it was written. */
  function manName(a) {
    return a && a.data && a.data.name ? String(a.data.name) : "him";
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
  // One mouth for everything this file says, with the same fallback the pitch
  // has always used. Returns false when nobody could have heard it, which the
  // callers deliberately ignore: a man who walks off because you never fed him
  // walks off whether or not you were standing close enough to hear him say so.
  function say(a, line, secs) {
    if (CBZ.prisonSay) return CBZ.prisonSay(a, line, { secs: secs || 2.6 });
    if (CBZ.citySay) return CBZ.citySay(a, line, null, secs || 2.6);
    return false;
  }

  // ===========================================================================
  //  YOUR NAME IS THE CEILING
  //
  //  Respect in this prison GATES; it is never spent. There is no menu where
  //  you trade standing for a man. What standing does is decide how many men
  //  will be seen with you at once — which is why the number below is read off
  //  the things the yard can actually SEE (a gang's books, and what the men who
  //  are not already yours think of you) and never off your own crew's opinion
  //  of you. Three friends telling each other you are solid is not a name.
  // ===========================================================================
  function renown() {
    let best = 0;
    const gs = CBZ.game && CBZ.game.gangStanding;
    if (gs) for (let i = 0; i < gs.length; i++) if ((gs[i] || 0) > best) best = gs[i] || 0;
    for (const a of actors()) {
      if (!alive(a) || a.pfFriend) continue;
      const r = Math.max(-50, Math.min(100, a.rep || 0));
      if (r > best) best = r;
    }
    return best;
  }
  function tierFor(r) {
    for (const t of CAP_TIERS) if (r >= t.at) return t;
    return CAP_TIERS[CAP_TIERS.length - 1];
  }
  function capNow() { return tierFor(renown()).cap; }

  /* The cap is asked about far more often than it changes — every card render
     runs offered() through it — so the loop that walks the whole yard runs on
     the slow tick and everything else reads the number it left. accept() and a
     man walking out re-take it on the spot, because the very next thing that
     happens after either is a card being drawn. */
  let crewN = 0, crewCap = 1;
  function syncCrew() { crewN = count(); crewCap = capNow(); }
  function full() { return posse() && crewN >= crewCap; }

  /* Who you already run with, in his mouth. He names them — up to three, which
     is as many as anybody says out loud before they start counting instead. */
  function crewNames() {
    const men = list().map(manName);
    if (!men.length) return "nobody";
    if (men.length === 1) return men[0];
    if (men.length <= 3) return men.slice(0, -1).join(", ") + " and " + men[men.length - 1];
    return men.slice(0, 3).join(", ") + " and " + numword(men.length - 3) + " more";
  }

  /* He has done the deed and you have no room. Not a lapsed offer and not a
     refusal — a man standing in front of you doing the arithmetic out loud.
     The walk-out at the top of a favour ladder (reasonFor "owes you") is NEVER
     in here: that offer is an ending, not a slot in a line, and capping it
     would quietly gate systems/quests.js's alternate victory behind a crew
     size, which is a different game. */
  function heldBack(a) {
    if (!posse() || !full()) return false;
    if (!a || a.pfFriend) return false;
    if (!eligible(a)) return false;
    const why = reasonFor(a);
    return !!why && why !== "owes you";
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
    if (heldBack(a)) return false;                // he decided; you have no room (see below)
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
      if (n.foe === downed) saved.push(n);
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
    // Pressed on a man the cap is holding back — the card and the crew moved
    // between render and click. He says the number, not the rule.
    if (heldBack(a)) {
      return { ok: false, msg: `You've got ${crewNames()}. Come back one short.` };
    }
    if (!offered(a)) {
      // The offer lapsed between render and press (a count started, he took a
      // swing at you). Say so rather than silently doing nothing.
      return { ok: false, msg: `${nameOf(a)} isn't in the mood.` };
    }
    a.pfFriend = true;
    a.pfPitchT = 0;
    if (CBZ.econ && CBZ.econ.addRespect) CBZ.econ.addRespect(a, 20);
    if (CBZ.econ && CBZ.econ.addLoyalty) CBZ.econ.addLoyalty(a, 8);
    a.playerTrust = Math.min(14, (a.playerTrust || 0) + 6);
    a.playerGrudge = 0;
    // He starts square on meals: a man who joins between chows is not already
    // one tray down on a ledger he could not have eaten off.
    a.pfMissed = 0; a.pfFedSit = -1; a.pfFedDay = -1; a.pfHeldSaid = false;
    shadow(a, true);
    syncCrew();
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

  /* Take him back off your shoulder. Only the posse's own break-ups call this
     — the grudge break-up above is left exactly as it shipped, so the file
     with PRISON_POSSE off is byte-for-byte the old behaviour. */
  function unshadow(a) {
    if (!a) return;
    if (a.aiState === "shadowPlayer") { a.aiState = "wander"; a.shadowT = 0; a.foe = null; }
  }

  // ===========================================================================
  //  NOBODY EATS FREE
  //
  //  A crew is a standing bill, and the prison already has the only clock that
  //  can send it: systems/prisonschedule.js knows when the trays go out. Both
  //  sittings count — "mess" is dinner, "supper" is the evening tray, and a man
  //  who watched two of them go past does not care which one had a nicer name.
  //
  //  The sitting is edge-detected off the block id rather than read off a
  //  wall-clock hour, because that is the only version that survives the things
  //  this game does to time: a regime in systems/prisontiers.js rewriting the
  //  hours under the table, a save restored mid-block, a storyboard driving
  //  CBZ.dayPhase() by hand. You get fed the first moment during the block that
  //  you are actually standing there with a cig; the bill lands when the block
  //  ends, on whoever wasn't.
  // ===========================================================================
  let chowId = "", sitting = 0, dayNo = 0;

  function chowClock() {
    const S = CBZ.prisonSchedule;
    if (!S || !S.enabled || !S.enabled()) return;
    const id = (S.id ? S.id() : "") || "";
    if (id !== chowId) {
      const left = chowId;
      chowId = id;
      if (id === "wake") dayNo++;              // a new day: he can thank you again
      if (CHOW[id]) sitting++;
      else if (CHOW[left]) closeChow();        // trays are away; count who missed
    }
    if (CHOW[id]) serveChow();
  }

  function serveChow() {
    const g = CBZ.game;
    if (!g) return;
    for (const a of actors()) {
      if (!a.pfFriend || !alive(a)) continue;
      if (a.pfFedSit === sitting) continue;
      if ((g.cigs || 0) < FEED_COST) continue;                       // you're broke; he waits
      if (dist2ToPlayer(a) > FEED_RANGE * FEED_RANGE) continue;      // you weren't at chow
      try { CBZ.econ.addCigs(-FEED_COST); }
      catch (e) { g.cigs = Math.max(0, (g.cigs || 0) - FEED_COST); }
      a.pfFedSit = sitting;
      a.pfMissed = 0;                          // a full tray squares the run of misses
      if (a.pfFedDay !== dayNo) { a.pfFedDay = dayNo; say(a, "Appreciate the tray.", 2.0); }
    }
  }

  function closeChow() {
    for (const a of actors()) {
      if (!a.pfFriend || !alive(a)) continue;
      if (a.pfFedSit === sitting) continue;
      a.pfMissed = (a.pfMissed || 0) + 1;
      if (a.pfMissed >= MISSED_QUIT) starve(a);
    }
  }

  /* He goes to eat somewhere else. The count is in the line because the count
     is the whole argument — and pfSaved/pfTrades go with him, so the man who
     let you run him hungry is not one BEFRIEND press away from being crew
     again. He is re-earned the same way he was earned. */
  function starve(a) {
    a.pfFriend = false;
    a.pfSaved = false;
    a.pfTrades = 0;
    a.pfPitchT = OFFER_LINE_GAP;
    const table = a.gang >= 0 && CBZ.GANG_NAMES && CBZ.GANG_NAMES[a.gang]
      ? CBZ.GANG_NAMES[a.gang]
      : ((CBZ.GANG_NAMES || ["the Reds", "the Blues"])[CBZ.player && CBZ.player.gang === 0 ? 1 : 0]);
    const n = numword(a.pfMissed || MISSED_QUIT);
    say(a, `${n.charAt(0).toUpperCase()}${n.slice(1)} chows and nothing. I eat with ${table} now.`, 3.4);
    a.pfMissed = 0;
    unshadow(a);
    syncCrew();
  }

  // ===========================================================================
  //  SHELTER — what the men standing on you can hold
  //
  //  systems/capture.js takes half your cigs every time the wing takes you.
  //  With men around you, half of what they find is not half of what you have:
  //  a quarter of the take per man at your elbow, three quarters at the most,
  //  because they are inmates with socks and not a bank.
  //
  //  Called by capture.js WITH the number it was about to take, which is the
  //  only reason this file can name the amount out loud a moment later. Called
  //  with nothing it is still a straight read of the fraction, so a second
  //  caller costs nothing.
  // ===========================================================================
  let held = null;
  function shelterCut(taken) {
    if (!posse() || !inPrison()) return 0;
    let n = 0;
    for (const a of list()) if (dist2ToPlayer(a) <= SHELTER_RANGE * SHELTER_RANGE) n++;
    if (!n) return 0;
    const cut = Math.min(SHELTER_MAX, n * SHELTER_EACH);
    const kept = Math.round((+taken || 0) * cut);
    // Held for the tick rather than said here: the shakedown fires under a fade
    // with a strike toast on top of it, and a line into that is a line nobody
    // reads. He tells you once you are back on your feet — and he keeps the
    // handover on his tongue for half a minute, because a capture ends with you
    // dumped somewhere and the man who palmed your cigs walking over to you.
    if (kept > 0) held = { cigs: kept, t: 2.2, life: 30 };
    return cut;
  }
  function flanked() {
    if (!posse() || !inPrison()) return false;
    let n = 0;
    for (const a of list()) {
      if (dist2ToPlayer(a) > FLANK_RANGE * FLANK_RANGE) continue;
      if (++n >= FLANK_NEED) return true;
    }
    return false;
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

    /* "BACKS YOU UP AND RUNS TO YOU" — the owner's exact words, and the half
       of it shadowPlayer's 8-unit brawl reflex doesn't cover on its own: a
       friend across the yard when you get jumped. So the tick asks the world
       one question first — is anyone actively ON the player right now? — and
       while the answer is yes, every friend inside CALL_RANGE is forced into
       shadowPlayer even out of a passive state (force=true; only a KO, his own
       live fight, or death still excuse him). shadowPlayer runs at 1.25x base
       speed toward your shoulder and starts a fight with any hunter it closes
       with, so "run to you and pile in" is the state machine ai.js already
       has, pointed at the moment it was built for. */
    const P = CBZ.player;
    let threat = false;
    for (const a of actors()) {
      if (!alive(a) || a.ko > 0) continue;
      if ((a.huntPlayer || 0) > 0 || (a.aiState === "fight" && a.foe === P)) { threat = true; break; }
    }

    // The crew and the ceiling, taken once for the whole slice — every card
    // rendered before the next one reads these two numbers.
    syncCrew();
    if (posse()) {
      chowClock();
      if (held) {
        held.t -= step; held.life -= step;
        if (held.life <= 0) held = null;
        else if (held.t <= 0) {
          const near = list().sort((x, y) => dist2ToPlayer(x) - dist2ToPlayer(y))[0];
          const c = held.cigs;
          // Only a line somebody actually heard counts as handed over; out of
          // earshot he tries again next slice until the half minute is up.
          if (near && say(near, `They didn't check my sock. ${c} of yours ${c === 1 ? "is" : "are"} still in it.`, 3.2)) held = null;
        }
      }
    }

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
          syncCrew();                 // the slot he just vacated is open now
          continue;
        }
        // Close enough to be with you → be with you. Far away → he has a day —
        // unless you are being jumped, in which case CALL_RANGE is the yard
        // and "passive states only" stops applying (see the threat sweep).
        if (threat && a.aiState !== "fight" && dist2ToPlayer(a) < CALL_RANGE * CALL_RANGE) shadow(a, true);
        else if (dist2ToPlayer(a) < FRIEND_RANGE * FRIEND_RANGE) shadow(a, false);
        continue;
      }

      /* A SLOT OPENED. He said his piece about your line being full; the line
         is not full any more, so the offer he never withdrew is back on the
         table and he re-pitches it properly the next time you are near him. */
      if (a.pfHeldSaid && !heldBack(a)) { a.pfHeldSaid = false; a.pfPitchT = 0; }

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

      /* THE OFFER YOU HAVEN'T GOT ROOM FOR. He walks up on the same deed and
         says the same thing he was going to say — and then counts the men
         already on your shoulder and declines to be one more. ONCE, per time
         you are full: he is not going to nag you about it every time you cross
         the yard. No button appears, because there is nothing to press yet. */
      if (!(a.pfPitchT > 0) && !a.pfHeldSaid && heldBack(a) && dist2ToPlayer(a) < 64) {
        a.pfHeldSaid = true;
        a.pfPitchT = OFFER_LINE_GAP;
        say(a, `You already run with ${crewNames()}. I'm not standing ${ordinal(crewN + 1)} in nobody's line.`, 3.6);
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
  // A fresh run is a fresh yard: nobody in it has met you, nobody in it is owed
  // a tray, and the chow clock has never seen a block go by.
  function reset() {
    for (const a of actors()) {
      if (!a) continue;
      a.pfFriend = false; a.pfSaved = false; a.pfTrades = 0; a.pfPitchT = 0;
      a.pfMissed = 0; a.pfFedSit = -1; a.pfFedDay = -1; a.pfHeldSaid = false;
    }
    chowId = ""; sitting = 0; dayNo = 0; held = null;
    crewN = 0; crewCap = 1;
  }

  // ---- the surface systems/interact.js reads -------------------------------
  CBZ.prisonFriendOffered = offered;
  CBZ.prisonFriendReason = reasonFor;
  CBZ.prisonFriendAccept = accept;
  CBZ.prisonFriends = list;
  CBZ.prisonFriendCount = count;
  CBZ.prisonFriendsReset = reset;
  /* ---- the surface the rest of the game reads ------------------------------
     Three questions this file is the only honest answer to, published for
     systems that must not know how a friendship works:

       posseShelterCut(taken) — systems/capture.js, at the shakedown. What
         fraction of `taken` the men standing on you can hold. Pass the number
         and one of them says it out loud a couple of seconds later.
       posseFlanked()         — entities/ai.js, before opening a shakedown of
         its own. Two men at your shoulder, alive, right now.
       posseSize()/posseCap() — a HUD chip, or anything that wants to say how
         big this thing is allowed to get. With PRISON_POSSE off there IS no
         ceiling and posseCap() says so with Infinity — check isFinite before
         printing it. */
  CBZ.posseShelterCut = shelterCut;
  CBZ.posseFlanked = flanked;
  CBZ.posseSize = count;
  CBZ.posseCap = function () { return posse() ? capNow() : Infinity; };

  // One line for a console, the way every other subsystem here publishes one.
  CBZ.prisonFriendAudit = function () {
    const rows = [];
    for (const a of actors()) {
      if (!alive(a)) continue;
      if (!a.pfFriend && !a.pfSaved && !(a.pfTrades > 0) && !offered(a) && !heldBack(a)) continue;
      rows.push({
        who: nameOf(a), friend: !!a.pfFriend, offering: offered(a), why: reasonFor(a),
        held: heldBack(a), missed: a.pfMissed || 0,
        saved: !!a.pfSaved, trades: a.pfTrades || 0, rep: Math.round(a.rep || 0),
        state: a.aiState || "",
      });
    }
    const r = renown();
    return {
      crew: count(), cap: posse() ? capNow() : null, renown: Math.round(r),
      standing: tierFor(r).word, flanked: flanked(), shelter: shelterCut(0),
      chow: { block: chowId, sitting: sitting, day: dayNo },
      regularsNeeded: REGULARS_NEEDED, rows: rows,
    };
  };

  // 93 sits with the other slow social ticks (hud's feed ager is 94/95), after
  // ai.js has run its states for the frame so a shadow we re-arm is not stomped
  // by the same frame's wander roll.
  if (CBZ.onAlways) CBZ.onAlways(93, tick);
})();
