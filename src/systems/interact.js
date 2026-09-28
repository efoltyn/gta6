/* ============================================================
   systems/interact.js — Red Dead-style contextual prompt. Walk up to
   anyone and the options fade in beside them. THREE social verbs, never
   more, on the home-row cluster (numbers belong to the inventory hotbar):

       [J] the headline — what this man IS (Trade / Join / Befriend,
           or Insult when he is nobody in particular)
       [K] Talk   [L] Steal
       (fight is left-click / the touch trigger, never a menu row)
       (Romance was a fourth and is DELETED — see economy.js)

   Merchants, the dealer and bent cops swap a row for Trade, guards for
   Bribe or Payoff, a cop player for Question / Search / Cuff, and an
   approaching NPC replaces the lot with its own offer — always the same
   triad: take it, push back, walk away. THE WARDEN trades in names, never
   cigarettes: Snitch / Insult / Steal (economy.js's snitch()).

   TALK routes through systems/quests.js (favors, rep, and the "they let
   you walk out" win). It used to be called BEFRIEND and be on every
   inmate in the prison; friendship is now something an NPC OFFERS you
   after you've earned it, and systems/prisonfriends.js owns that — see
   the VERB table for the whole argument.

   ON TOUCH the card is replaced by a rail of one-word buttons (see
   css/interact_touch.css). Every spoken line, the answer to a verb
   included, floats over the speaker's head (CBZ.prisonSay below).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const el = CBZ.el;
  const RANGE = 3.6;

  // ---------------------------------------------------------------------------
  //  PRISON_INTERACT_TOUCH: on touch the card is a rail of one-word buttons
  //  (iPad: beside Reload; phone: a stack at the thumb). Desktop keeps J/K/L
  //  rows. Either way the card is VERBS; what a man says goes over his head.
  // ---------------------------------------------------------------------------
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_INTERACT_TOUCH == null) CBZ.CONFIG.PRISON_INTERACT_TOUCH = true;
  // systems/touch.js's CBZ.touchMode latch is the ONE touch-mode signal in this
  // codebase (it stamps body.touch at the same moment). Never a second detector.
  function touchUI() {
    return !!(CBZ.touchMode && (!CBZ.CONFIG || CBZ.CONFIG.PRISON_INTERACT_TOUCH !== false));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }

  function approachAction(a, action) {
    if ((a.kind === "guard" || a.kind === "warden") && CBZ.resolveGuardApproach) return CBZ.resolveGuardApproach(a, action);
    return CBZ.resolveNpcApproach ? CBZ.resolveNpcApproach(a, action) : { ok: false, msg: "" };
  }
  function warnActor(a) {
    a.aiState = "flee";
    a.fleeT = 1.8;
    return { ok: true, msg: "Alright. I'm going." };
  }

  const VERB = {
    insult:   { label: "Insult",          fn: (a) => CBZ.econ.insult(a) },
    fight:    { label: "Fight",           fn: (a) => (CBZ.punch ? CBZ.punch(a) : CBZ.econ.beat(a)) },
    /* TALK IS THE FAVOUR LOOP. IT USED TO BE CALLED "BEFRIEND", AND THAT WAS
       THE LIE (owner, 2026-08-21: "BEFRIEND, almost entirely taken out of
       game").

       This button never made a friend. It routes to systems/quests.js's
       onTalk: ask what a man needs, come back when it's done, collect 34 rep.
       Calling that "Befriend" put a relationship word on a chore button and
       stamped it onto EVERY inmate and every clean guard in the prison — the
       single biggest contributor to the verb count the owner is complaining
       about, and a promise the button could not keep. Same function, same rep
       ledger, same "walk you out" ending; it is now named after what it does.
       Friendship is what happens at the END of doing this a few times, and it
       is the verb below. */
    talk:     { label: "Talk",            fn: (a) => (CBZ.quests ? CBZ.quests.onTalk(a) : CBZ.econ.talk(a)) },
    /* BEFRIEND IS NOW OFFERED, NEVER BROWSED. It appears only when the man in
       front of you has decided he owes you one — because you pulled someone
       off him, because you've been buying from him for weeks, or because
       you've run his favours to the end (systems/prisonfriends.js decides,
       and verbsFor gates on it). Taking it makes him CREW: he walks with you,
       runs off snitches and swings at whoever is hunting you. */
    befriend: { label: "Befriend",        fn: (a) => (CBZ.prisonFriendAccept ? CBZ.prisonFriendAccept(a)
                                                : (CBZ.quests ? CBZ.quests.onTalk(a) : CBZ.econ.talk(a))) },
    /* SQUASH IS THE OTHER HALF OF A GRUDGE. The prison remembers every wrong
       you do a man (playerGrudge, and grudgeWhy — the specific thing), and
       until now the only ways out were waiting or violence. This buys peace:
       cigs scaled to how sore he is, and his answer NAMES what he's letting
       go. Appears only while he is actually carrying something — same
       contextual law as Befriend. entities/ai.js owns the transaction. */
    squash:   { label: "Squash",          fn: (a) => (CBZ.squashGrudge ? CBZ.squashGrudge(a) : { ok: false, msg: "" }) },
    /* COLLECT AND SETTLE — the two ends of somebody else's debt
       (PRISON_CONTRACTS, entities/ai.js owns every transaction below).

       The owner's law for this whole layer: BUTTONS ARE FOR DEALS, THE BODY IS
       FOR PRESSURE. So there are exactly two buttons in it, both on the man who
       is TALKING to you — the one who hands you his claim, and the same one
       when you come back holding it. The debtor never grows a "collect from
       him" button, because finding him, cornering him, picking his pocket or
       putting him down are things you do with the verbs this game already has.

       COLLECT asks him for the work (ai.js starts the same standing offer any
       other pitch uses, so it keeps if you walk). SETTLE is the proof: it only
       renders on the man who sent you, only once what he asked for is actually
       in your hands, and pressing it is him counting it in front of you. */
    collect:  { label: "Collect",         fn: (a) => {
      if (!CBZ.prisonContract || !CBZ.prisonContract.offer) return { ok: false, msg: "" };
      // ai.js raises the standing offer AND speaks the pitch (autoListen can't:
      // the card is already open on him, so `current` never changes). The menu
      // becomes TAKE IT / HAGGLE / WALK on the next render.
      return { ok: !!CBZ.prisonContract.offer(a), msg: "" };
    } },
    settle:   { label: "Settle",          fn: (a) => (CBZ.prisonContract ? CBZ.prisonContract.settle(a) : { ok: false, msg: "" }) },
    // The symmetry, on the collector who is leaning on YOU: turn the tab into
    // labour. Same approach dispatch as pay/refuse — ai.js's "work" action.
    work:     { label: "Work",            fn: (a) => approachAction(a, "work") },
    trade:    { label: "Trade",           fn: (a) => {
      const res = CBZ.econ.trade(a);
      if (res && res.ok && a.approach && a.approach.kind === "deal") {
        if (CBZ.resolveNpcApproach) CBZ.resolveNpcApproach(a, "completeDeal");
        else if (CBZ.clearNpcApproach) CBZ.clearNpcApproach(a);
      }
      return res;
    } },
    bribe:    { label: "Bribe",           fn: (a) => CBZ.econ.bribe(a) },
    snitch:   { label: "Snitch",          fn: (a) => (CBZ.econ.snitch ? CBZ.econ.snitch(a) : { ok: false, msg: "" }) },
    steal:    { label: "Steal",           fn: (a) => CBZ.econ.steal(a) },
    // ---- in the warden's office, when he sent for you (systems/prisonwarden.js owns all four)
    wdeal:    { label: "Deal",            fn: (a) => (CBZ.warden ? CBZ.warden.act("wdeal", a) : { ok: false, msg: "" }) },
    wfavor:   { label: "Favor",           fn: (a) => (CBZ.warden ? CBZ.warden.act("wfavor", a) : { ok: false, msg: "" }) },
    wthreat:  { label: "Threaten",        fn: (a) => (CBZ.warden ? CBZ.warden.act("wthreat", a) : { ok: false, msg: "" }) },
    whand:    { label: "Hand over",       fn: (a) => (CBZ.warden ? CBZ.warden.act("whand", a) : { ok: false, msg: "" }) },
    payoff:   { label: "Payoff",          fn: (a) => CBZ.econ.payoff(a) },
    join:     { label: "Join",            fn: (a) => CBZ.joinGang(a) },
    listen:   { label: "Listen",          fn: (a) => a.approach ? approachAction(a, "listen") : CBZ.econ.talk(a) },
    accept:   { label: "Accept",          fn: (a) => approachAction(a, "accept") },
    respect:  { label: "Respect",         fn: (a) => approachAction(a, "respect") },
    pay:      { label: "Pay",             fn: (a) => approachAction(a, "pay") },
    haggle:   { label: "Haggle",          fn: (a) => approachAction(a, "haggle") },
    threaten: { label: "Threaten",        fn: (a) => approachAction(a, "threaten") },
    refuse:   { label: "Refuse",          fn: (a) => approachAction(a, "refuse") },
    confrontReport: { label: "Confront",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "confront") : { ok: false, msg: "" } },
    paySilence: { label: "Silence",       fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "paySilence") : { ok: false, msg: "" } },
    threatenSnitch: { label: "Threaten",  fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "threatenSnitch") : { ok: false, msg: "" } },
    question: { label: "Question",        fn: (a) => CBZ.econ.talk(a) },
    warn:     { label: "Warn",            fn: (a) => a.approach ? approachAction(a, "warn") : warnActor(a) },
    detain:   { label: "Cuff",            fn: (a) => {
      if (a.approach) return approachAction(a, "detain");
      const justified = CBZ.game.role === "cop" && (a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight");
      a.hp = Math.max(a.hp || 0, 45); a.aiState = "flee"; a.foe = null;
      if (a.copMarked > 0) a.copMarked = 0;
      // YOUR HANDS DO IT (CBZ.verbs.cuff): turned round, wrists behind his
      // back, the cuffs ON them; then he goes down for a beat, cuffed
      const V = CBZ.verbs;
      const land = function () {
        a.ko = Math.max(a.ko || 0, 5.5);
        if (V && V.setCuffs) V.setCuffs(a, true, { whileKo: true });   // off again when he is let up
      };
      const S = V && V.cuff && !(a.ko > 0) ? V.cuff(V.playerActor(), a, { far: true, onEnd: land }) : null;
      if (!S) { land(); CBZ.sfx("punch"); CBZ.shake && CBZ.shake(0.45); }
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.game.role === "cop" && CBZ.addComplaint) CBZ.addComplaint(justified ? -2 : 5);
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, "detain");
      return { ok: true, msg: "" };   // he goes down; that is the receipt
    } },
    search:   { label: "Search",          fn: (a) => {
      const justified = a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight";
      const found = (justified ? 2 : 1) + Math.floor(CBZ.econ.rng() * (justified ? 6 : 4));
      if (a.copMarked > 0) a.copMarked = 0;
      // THE PAT-DOWN (CBZ.verbs.frisk): hands up, turned to the wall, your
      // hands down him collar to thighs; what you find you find at the end
      const loot = function () {
        CBZ.econ.addCigs(found);
        if (CBZ.addComplaint) {
          if (justified) CBZ.addComplaint(-3);
          else if (CBZ.econ.rng() < 0.25) CBZ.addComplaint(6);
        }
        CBZ.sfx("coin");
      };
      const V = CBZ.verbs;
      const S = V && V.frisk ? V.frisk(V.playerActor(), a, { far: true, onOutcome: loot }) : null;
      if (!S) loot();
      return { ok: true, msg: justified ? "Alright, it's yours." : "That's mine, man." };
    } },
    // ---- held at gunpoint (systems/intimidate.js owns the state) ----------
    // Both dispatch back into intimidate rather than reimplementing the
    // shakedown here: it re-validates range and mode, routes the transfer
    // through city/take.js, and keeps him terrified afterwards.
    rob:      { label: "Rob",             fn: (a) => {
      if (CBZ.prisonRobTarget) CBZ.prisonRobTarget(a);
      return { ok: true, msg: "" };
    } },
    // Tie a held-up man's wrists (intimidate.js validates range/state and
    // spends the Bedsheet Rope). Silent either way: the sub-chip already
    // says "needs rope" when the bag cannot pay, and a tied man slumping is
    // the receipt when it can.
    restrain: { label: "Tie",             fn: (a) => {
      if (CBZ.prisonRestrainTarget) CBZ.prisonRestrainTarget(a);
      return { ok: true, msg: "" };
    } },
    release:  { label: "Release",         fn: (a) => {
      // Lowering the gun is the other half of holding it up. Ending the hold
      // here (rather than making the player walk away) means the panel can
      // always be closed by a decision instead of by distance.
      if (CBZ.intimidateRelease) CBZ.intimidateRelease(a);
      return { ok: true, msg: "" };
    } },
  };

  function cleanName(a) {
    return a && a.data && a.data.name ? a.data.name.replace(/^the |^a |^an /, "") : "someone";
  }
  function shortText(s, max) {
    s = String(s || "");
    max = max || 28;
    return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;
  }
  function gangShort(a) {
    if (!a || a.gang == null || a.gang < 0) return "";
    const names = CBZ.GANG_NAMES || ["Reds", "Blues"];
    return (names[a.gang] || "Crew").replace(/^the /, "");
  }
  /* THE CARD CARRIES VERBS, NOT A DOSSIER (owner, 2026-09-27: "all the
     text... there's just too much bullshit in the way").

     The card used to print a "read" line assembled from the social ledger
     ("loyal | holds grudge | Reds hostile"), the snitch report as prose,
     "waiting on you: ...", "his offer stands: ..." and his pitch AGAIN under
     the line he had just said out loud. All of it is still true and still
     drives the AI; none of it is on screen. You learn what he thinks of you
     from how he acts and what he says.

     WHO HE IS stays (owner, 2026-09-28: "I just see buttons to interact, but
     I don't see the name of the person above it. That's dumb."). The Sept 27
     purge (b47be119) took the name plate out along with the dossier; it is
     back as ONE line over the buttons: his name, then in muted type what he
     is (Guard, Warden, Trader, or his clique). Identity, not dialogue: no
     quotes, no read, no narration.

     The other thing that stays is the NOUN on a stall: a Trade button with a
     price chip and no item name is a button you cannot decide on. */
  function whoFor(a) {
    let name = cleanName(a);
    name = name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
    let role = "";
    if (a && a.kind === "warden") role = "Warden";
    else if (a && a.kind === "guard") role = "Guard";
    else if (a && a.data && a.data.offer) role = "Trader";
    else role = gangShort(a);
    if (role && role.toLowerCase() === name.toLowerCase()) role = "";
    return { name: shortText(name, 22), role: role };
  }
  // name + muted role, the markup #interactName and the touch plate share
  function whoHTML(a) {
    const w = whoFor(a);
    if (!w.name) return "";
    return esc(w.name) + (w.role ? '<span class="iname-role">' + esc(w.role) + "</span>" : "");
  }
  CBZ.prisonWhoFor = whoFor;
  function panelNote(a) {
    const o = a && a.data && a.data.offer;
    if (!o || !o.item) return "";
    const p = CBZ.econ && CBZ.econ.offerPrice ? CBZ.econ.offerPrice(a) : null;
    return `${shortText(o.item, 22)}, ${p ? p.price : o.price} cigs`;
  }

  function verbsFor(a) {
    // Authored prison beats can temporarily replace the warden's generic
    // bribe/loot menu without teaching this legacy interaction system about
    // campaign state. The provider returns verb ids and owns their dispatch.
    if (CBZ.cityCampaignPrisonVerbs) {
      const authored = CBZ.cityCampaignPrisonVerbs(a);
      if (authored && authored.length) return authored;
    }
    /* HELD AT GUNPOINT. A man with his hands over his head is not available
       for "insult / befriend", and the thing you CAN do to him used
       to arrive as a separate pill that popped into frame to announce he was
       frozen. He is visibly frozen; the popup and the pill both said so twice.
       So this is one more context in the list below rather than a new surface:
       the same panel, the same four keys, different verbs — which is exactly
       what happens when a man walks up with an offer. Outranks every approach
       kind because a drawn gun outranks a conversation. */
    if (a.intimidMode === "scared") return ["rob", "restrain", "release"];
    if (a.approach && a.approach.t > 0) {
      /* THREE BUTTONS, AND "LISTEN" IS NOT ONE OF THEM (owner, 2026-08-21: "I
         like 3 interaction buttons max at a time... more than 3 interaction
         buttons showing at once looks bad").

         Every menu below used to open with LISTEN, and most ran to five. Two
         separate things were wrong with that. LISTEN is a button that asks a
         man who has WALKED UP TO YOU to please start talking — and the pitch
         is already printed on the card (panelNote reads a.approach.msg) while
         the long version was one press away. So it is gone as a verb and the
         long version is now SPOKEN the moment the card opens (autoListen(),
         below): the NPC talks to you, which is what he came over to do.

         That leaves the decision, which was always the same triad wearing
         different words — TAKE IT · PUSH BACK · WALK AWAY. THREATEN and
         HAGGLE are both the middle rung, so a menu never carries both: which
         one you get depends on whether this man is more afraid of you than he
         is attached to his price (pressureVerb). Nothing was deleted — every
         verb below is still reachable, on the read where it makes sense. */
      const k = a.approach.kind;
      const press = pressureVerb(a);                      // "haggle" or "threaten"
      /* THE CONTRACT PAIR (PRISON_CONTRACTS). Both are the same triad every
         other menu here is — TAKE IT · PUSH BACK · WALK AWAY — pointed at
         somebody else's debt.

         On the CREDITOR the middle rung is HAGGLE, because the only thing on
         the table between you and him is your cut. On the cornered DEBTOR it
         is always THREATEN and never haggle: he is not negotiating a price, he
         is deciding whether to hand over what is in his pocket, and leaning on
         him is the physical half of a collection. When his pockets are empty
         there is nothing to accept, so the menu honestly drops to two. */
      if (k === "contract") return ["accept", "haggle", "refuse"];
      if (k === "debtorDodge") return (a.approach.partial > 0)
        ? ["accept", "threaten", "refuse"]
        : ["threaten", "refuse"];
      /* CAN'T PAY, SO WORK IT. The one place the middle rung is neither a
         price nor a threat: the collector holding your tab has a claim of his
         own to send you after, and WORK is the way out that costs a walk
         instead of cigarettes you don't have. ai.js decides when it's live —
         debt bigger than your pocket, crew actually holding a ripe claim. */
      if (k === "debtCollect" && CBZ.prisonContract && CBZ.prisonContract.canWorkOff(a)) {
        return ["pay", "work", "refuse"];
      }
      if (k === "gangInvite" || k === "gangJob" || k === "favor") return ["accept", "refuse"];
      if (k === "copTip" || k === "copPlea") return ["accept", "refuse"];
      if (k === "gangParley") return [a.approach.cost > 0 ? "pay" : "accept", "respect", "refuse"];
      if (k === "crewBackup" || k === "coverStory" || k === "heatWarning") return ["accept", "threaten", "refuse"];
      if (k === "crewDues" || k === "stickUp" || k === "alibiDeal" || k === "witnessFix" || k === "recantOffer") return ["pay", press, "refuse"];
      if (k === "buyItem") return ["accept", "haggle", "refuse"];
      if (k === "copBribe") return ["accept", "detain", "refuse"];
      if (k === "copTaunt") return ["warn", "detain", "refuse"];
      if (k === "turfWarning") return ["respect", "threaten", "refuse"];
      if (a.approach.cost > 0) return ["pay", press, "refuse"];
      if (k === "deal" && a.data && a.data.offer) return ["trade", "refuse"];
      return ["refuse"];
    }
    // A SNITCH YOU HAVE NOT MADE IS JUST ANOTHER INMATE (JAIL_SNITCH_KNOWLEDGE,
    // entities/ai.js). These three verbs used to appear on ANY reporter, which
    // both handed the player the answer for free and made the bent guard's
    // paid name-drop worth nothing. You get them once you actually know — by
    // seeing the report happen, buying the name, or being told by your own
    // crew. Flag off (or no ai.js) → every reporter, exactly as it shipped.
    const knowsRat = CBZ.playerKnowsSnitch ? CBZ.playerKnowsSnitch(a) : (a.reportedPlayerT || 0) > 0;
    if (CBZ.game.role !== "cop" && knowsRat) {
      return ["confrontReport", "paySilence", "threatenSnitch"];   // fight = left-click
    }
    // A COP'S THREE: ask, toss, cuff. WARN was the fourth and it is the one a
    // badge doesn't need — Cuff already ends the conversation, and warnActor's
    // "back off" is what Question gets you anyway on anyone who isn't marked.
    // It stays live on the copTaunt approach, where scattering somebody IS the
    // decision.
    if (CBZ.game.role === "cop" && !(a.kind === "guard" || a.kind === "warden")) {
      return ["question", "search", "detain"];
    }
    /* THE WARDEN DOES NOT CHAT. In his office on his summons the card is
       his three: DEAL, FAVOR, THREATEN (systems/prisonwarden.js). Anywhere
       else he will hear a name (SNITCH), and his pocket is only reachable
       asleep or alone at his desk, never on rounds with his officers.
       Campaign beats still outrank this above. */
    if (a.kind === "warden") {
      const W = CBZ.warden;
      const meet = W && W.verbs ? W.verbs(a) : null;
      if (meet) return meet;
      return (W && W.exposed && !W.exposed()) ? ["snitch"] : ["snitch", "steal"];
    }
    if (a.kind === "guard") {
      /* THE BENT SCREW RAN FIVE (bribe/payoff/trade/insult/steal) — the exact
         menu the owner pointed at ("trading also has like 5"). Two of those
         five were the same gesture: BRIBE buys this moment, PAYOFF buys the
         heat off your file. You are never weighing them at once — which one
         you want is decided by whether you're carrying heat — so the slot
         shows the one that applies. INSULT leaves a uniform's menu entirely:
         it's a rep-losing joke with a man who can put you in the hole, and
         swinging on him is still a left-click away. */
      const money = (a.corrupt && guardPayoffWorthIt(a)) ? "payoff" : "bribe";
      const merch = !!(a.data && a.data.offer);
      if (a.corrupt) return merch ? [money, "trade", "steal"] : [money, "talk", "steal"];
      return merch ? ["bribe", "trade", "steal"] : ["bribe", "talk", "steal"];
    }
    // FLIRT IS GONE (see economy.js). A relationship that was a rising
    // counter with dialogue rungs is not a relationship.
    //
    /* THE STREET MENU: ONE HEADLINE, THEN TALK, THEN STEAL. Exactly three,
       by construction rather than by capping.

       The first draft of this pushed every applicable verb into a list and let
       capVerbs sort it out. tools/interact-verbs-check.mjs immediately caught
       what is wrong with that: a man who sells, recruits AND has offered you
       his hand produces six, and the priority ladder keeps the three RAREST —
       so the cap silently took TALK (the entire favour loop) and STEAL off
       him. A cap is a backstop against arithmetic, not a way to design a menu.

       So the last two slots are fixed — ask him something, take something,
       the two things you can do to anybody — and the first is whatever this
       particular man IS, ordered by how fleeting it is:

         BEFRIEND  he has decided he owes you. One time, and it lapses if you
                   give him a reason (prisonfriends.js re-reads it every frame).
         JOIN      his crew is open to you. Also one time, and it disappears
                   the moment you are in a gang.
         TRADE     he has a stall. Repeatable, so it yields to the two above —
                   and it comes back the moment they resolve, which they do.
         INSULT    he is nobody in particular, and trash talk is exactly the
                   verb for a man you have nothing else to do with.

       Fighting is left-click and never a row. */
    const offering = !!(CBZ.prisonFriendOffered && CBZ.prisonFriendOffered(a));
    // a man carrying real bad blood leads with the way OUT of it — the most
    // fleeting thing about him, and the one the other verbs are useless under
    const sore = !!CBZ.squashGrudge && (a.playerGrudge || 0) >= 4;
    const recruiting = a.gang >= 0 && CBZ.player.gang == null && (a.rep || 0) >= 40;
    /* TWO NEW RUNGS, ON THE SAME LADDER AND FOR THE SAME REASON — how fleeting
       the thing is (PRISON_CONTRACTS).

       SETTLE goes to the TOP, above even an offered hand: you are standing in
       front of the man who sent you, holding his money or his radio or the
       news that the other guy is on the floor. There is nothing else you would
       be doing with him in that second, and it stops being true the moment you
       press it.
       COLLECT sits below the one-time offers and above the repeatable ones. A
       claim is not permanent — it ages out (ai.js's TAB_DEAD) — but it will
       still be there after you buy his soap.

       The two spare slots below are untouched: ask him something, take
       something. The rest of the layer is not a button anywhere — cornering
       the debtor, picking his pocket, putting him down are the verbs the game
       already had, and that is the whole design. */
    const C = CBZ.prisonContract;
    const settling = !!(C && C.forCreditor(a) && (C.satisfied(C.live()) || (C.live() && C.live().dead)));
    const claiming = !!(C && C.canOffer(a));
    const head = settling ? "settle"
      : offering ? "befriend"
      : sore ? "squash"
      : claiming ? "collect"
      : recruiting ? "join"
      : (a.data && a.data.offer) ? "trade"
      : "insult";
    return [head, "talk", "steal"];
  }
  /* Which pressure verb this man responds to. HAGGLE and THREATEN are the same
     rung of the same triad — the middle path between paying and walking — so a
     menu never shows both. If he is already more afraid of you than he is
     attached to his number, leaning on him IS the negotiation; otherwise it is
     a price conversation. econ's fear ledger, not a die. */
  function pressureVerb(a) {
    const fear = a.playerFear || 0, grudge = a.playerGrudge || 0;
    return (fear >= 6 && fear > grudge) ? "threaten" : "haggle";
  }
  // A payoff cleans HEAT; a bribe buys this moment. Offering the first when
  // there is nothing on your file is a button that spends cigs on nothing.
  function guardPayoffWorthIt(a) {
    /* This read city fields (g.heat / g.detect / a.racketDebt / g.wanted) —
       none of which exist in the prison, where heat is g.detection and the
       racket tab lives on the game. So the PAYOFF verb never rendered on a
       bent officer in escape mode: the slot silently fell through to BRIBE
       every time. Found by the phone-bridge audit. */
    const g = CBZ.game || {};
    const heat = g.detection != null ? g.detection : (g.heat || 0);
    return heat > 0 || (g.complaints || 0) > 0 || (g.racketDebt || 0) > 0 || (g.wanted || 0) > 0;
  }
  /* THE CHIP IS A NUMBER OR A NOUN, NEVER A MOOD. The button is one word;
     the chip under it says what it costs or what it is about ("14", "Shiv",
     "needs rope"). The status words it used to carry ("trust helps", "bad
     blood", "counting", "dark", "hot", "scared", "risk") were the social
     ledger printed on a button: the man's face and the hour already say it. */
  function subFor(a, v) {
    if (CBZ.cityCampaignPrisonSub) {
      const authored = CBZ.cityCampaignPrisonSub(a, v);
      if (authored != null) return authored;
    }
    const ap = a.approach || {};
    switch (v) {
      case "trade": {
        const o = a.data && a.data.offer;
        if (!o) return "";
        const p = CBZ.econ.offerPrice ? CBZ.econ.offerPrice(a) : null;
        return String(p ? p.price : o.price);
      }
      case "bribe": {
        const c = CBZ.econ.bribeCost ? CBZ.econ.bribeCost(a) : (a.corrupt ? 5 : 10);
        return c > 0 ? c + "" : "";
      }
      case "payoff": return (CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : 6) + "";
      case "pay": return ap.cost ? ap.cost + "" : "";
      case "squash": return CBZ.squashGrudgeCost ? CBZ.squashGrudgeCost(a) + "" : "";
      case "paySilence": return CBZ.knownSnitchCost ? CBZ.knownSnitchCost(a) + "" : "";
      case "collect": {
        const t = CBZ.prisonContract && CBZ.prisonContract.ripeTab(a);
        return t ? Math.round(t.amt) + "" : "";
      }
      case "settle": {
        const c = CBZ.prisonContract && CBZ.prisonContract.live();
        if (!c || c.dead) return "";
        if (c.kind === "repo") return c.item ? shortText(c.item, 12) : "";
        if (c.kind === "roughUp") return "";
        return (c.got || 0) + "/" + c.amt;
      }
      case "work": {
        const c = CBZ.prisonContract && CBZ.prisonContract.ripeTab(a);
        return c ? Math.round(c.amt) + "" : "";
      }
      case "steal": {
        const want = CBZ.prisonContract && CBZ.prisonContract.wantedItem(a);
        return want ? shortText(want, 12) : "";
      }
      case "restrain":
        return CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Bedsheet Rope") ? "" : "needs rope";
      case "join": return gangShort(a);
      case "accept":
        if (ap.kind === "favor") return "+" + (ap.gift || 3);
        if (ap.kind === "buyItem" || ap.kind === "copBribe") return "+" + (ap.price || 0);
        if (ap.kind === "gangJob") return "+" + ((ap.job && ap.job.reward) || 5);
        if (ap.kind === "gangInvite") return gangShort(a);
        return "";
      default: return "";
    }
  }

  // The SPOKEN form of each option, written as a LINE ("Buy a Shiv. 8").
  // Since 2026-08-19 no button prints this sentence — the button is ONE WORD
  // and this line survives as its aria-label, so a screen reader still hears
  // the whole action. Contextual + deterministic (no flicker).
  function acceptLine(a) {
    const ap = a.approach || {};
    switch (ap.kind) {
      case "favor":      return `Do the favor (+${ap.gift || 3})`;
      case "buyItem":    return `Buy it. ${ap.price || 0}`;
      case "copBribe":   return `Pocket the ${ap.price || 0}`;
      case "copTip":     return "Take the tip";
      case "copPlea":    return "Hear the plea out";
      case "gangJob":    return `Take the job (+${(ap.job && ap.job.reward) || 5})`;
      case "gangParley": return "Agree to their terms";
      case "crewBackup": return "Call in the backup";
      case "coverStory": return "Take the cover story";
      case "heatWarning":return "Duck the heat";
      case "alibiDeal":  return "Take the alibi";
      case "gangInvite": return `Join the ${(CBZ.GANG_NAMES && CBZ.GANG_NAMES[a.gang]) || "crew"}`;
      case "contract":   return ap.contract
        ? (ap.contract.kind === "repo" ? `Go take the ${ap.contract.item}`
          : ap.contract.kind === "roughUp" ? `Go put ${ap.contract.name} down`
          : `Go collect the ${ap.contract.amt}`)
        : "Take the work";
      case "debtorDodge":return `Take the ${ap.partial || 0} he's got`;
      default:           return "Take the offer";
    }
  }
  function labelFor(a, v) {
    if (CBZ.cityCampaignPrisonLabel) {
      const authored = CBZ.cityCampaignPrisonLabel(a, v);
      if (authored != null) return authored;
    }
    const nm = shortText(cleanName(a), 14);
    switch (v) {
      case "insult":   return `Talk trash to ${nm}`;
      case "talk":     return (a.playerGrudge || 0) >= 6 ? `Square things with ${nm}` : ((a.rep || 0) >= 45 ? `Catch up with ${nm}` : `Chat up ${nm}`);
      case "befriend": return `Run with ${nm}`;
      case "collect":  { const t = CBZ.prisonContract && CBZ.prisonContract.ripeTab(a); return t ? `Hear what ${nm} wants collected` : `Ask ${nm} about the money`; }
      case "settle":   { const c = CBZ.prisonContract && CBZ.prisonContract.live(); return c && c.kind === "repo" ? `Hand ${nm} the ${c.item}` : `Settle up with ${nm}`; }
      case "work":     return `Work the tab off instead`;
      case "fight":    return `Throw hands with ${nm}`;
      case "trade":    { const o = a.data && a.data.offer; return o ? `Buy ${shortText(o.item, 16)}. ${o.price}` : "Browse their goods"; }
      case "bribe":    { const c = CBZ.econ.bribeCost ? CBZ.econ.bribeCost(a) : (a.corrupt ? 5 : 10); return c > 0 ? `Slip ${c} to look away` : "Ask him to look away"; }
      case "snitch":   return "Give the warden a name";
      case "payoff":   { const c = CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : 6; return `Pay ${c} to clear your heat`; }
      case "steal":    return (a.kind === "guard" || a.kind === "warden") ? `Lift ${nm}'s keys` : `Pick ${nm}'s pocket`;
      case "join":     return `Run with the ${gangShort(a) || "crew"}`;
      case "listen":   return "Hear them out";
      case "accept":   return acceptLine(a);
      case "respect":  return "Show respect, back off";
      case "pay":      { const c = a.approach && a.approach.cost; return c ? `Pay the ${c}` : "Settle up"; }
      case "haggle":   return "Haggle them down";
      case "threaten": return (CBZ.playerArmed && CBZ.playerArmed()) ? `Pull on ${nm}` : `Threaten ${nm}`;
      case "refuse":   return "Wave them off";
      case "warn":     return `Tell ${nm} to move along`;
      case "detain":   return `Cuff ${nm}`;
      case "search":   return `Shake ${nm} down`;
      case "question": return `Question ${nm}`;
      case "confrontReport": return `Press ${nm} on the snitch`;
      case "paySilence":     { const c = CBZ.knownSnitchCost ? CBZ.knownSnitchCost(a) : 0; return `Pay ${c} to keep ${nm} quiet`; }
      case "threatenSnitch": return `Lean on ${nm} to drop it`;
      default: return (VERB[v] && VERB[v].label) || v;
    }
  }

  // ===========================================================================
  //  SPEECH IS OVER THE SPEAKER'S HEAD — CBZ.prisonSay(actor, line, opts)
  //
  //  The prison's mouth is the shared one now (systems/speech.js, the same
  //  over-head line every game uses). What stays here is the prison's own
  //  earshot: a yard is noisier than a street, so ambient talk carries 12 m and
  //  a man walking up to you (or the answer to a verb you pressed) 18 m.
  // ===========================================================================
  const EAR = 12, EAR_ENGAGED = 18;
  function speak(actor, msg, secs, force) {
    if (!actor || !msg || !CBZ.speech || !CBZ.game || CBZ.game.mode !== "escape") return false;
    const eng = force || (actor.approach && (actor.approach.t || 0) > 0);
    return CBZ.speech.say(actor, msg, { secs: secs, force: !!force, ear: eng ? EAR_ENGAGED : EAR, headY: 1.85 });
  }
  // the answer to a verb you pressed: spoken by the man you pressed it on
  function sayResult(actor, msg, secs) {
    if (!msg || !actor) return;
    speak(actor, msg, secs || 2.8, true);
  }
  function prisonSay(actor, line, opts) {
    opts = opts || {};
    return speak(actor, line, opts.secs || 2.2, !!opts.force);
  }
  CBZ.prisonSay = prisonSay;
  CBZ.prisonSayAudit = function () { return CBZ.speech ? CBZ.speech.audit() : null; };

  // ===========================================================================
  //  THE TOUCH ROW (PRISON_INTERACT_TOUCH)
  //
  //  Anchoring is DERIVED from mobile.css's cluster, never guessed — see the
  //  arithmetic block at the top of css/interact_touch.css. All this file does
  //  is build and fill the DOM; where it lands is one CSS decision. The row is
  //  the verbs; the only line above it is a stall's item and price.
  // ===========================================================================
  let piRoot = null, piName = null, piNote = null;
  let piVerbs = null, piOpts = null, piSig = "", piShown = false, piQuiet = null;

  function buildTouchUI() {
    if (piRoot) return piRoot;
    piRoot = document.createElement("div");
    piRoot.id = "pinteract";
    piRoot.innerHTML =
      '<div id="pinteractWho"><span class="piw-name"></span><span class="piw-note"></span></div>' +
      '<div class="pi-row"><div id="pverbs"></div><div id="poptions"></div></div>';
    document.body.appendChild(piRoot);
    piName = piRoot.querySelector(".piw-name");
    piNote = piRoot.querySelector(".piw-note");
    piVerbs = piRoot.querySelector("#pverbs");
    piOpts = piRoot.querySelector("#poptions");
    // Delegated so it survives every re-render. CLICK (not touchstart): a verb
    // here can be Fight / Steal / Cuff, and a press you can still slide off is
    // the right contract for those — the same call .iopt and .tpill already make.
    piRoot.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest("[data-pi]") : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const i = parseInt(b.getAttribute("data-pi"), 10);
      if (i >= 0) doAction(i);
    });
    return piRoot;
  }

  // The capsule carries a WORD. VERB[] owns it; an AUTHORED campaign verb has
  // none, so its sentence is cut at the first dash and the sentence itself
  // lives on as the aria-label.
  function shortLabel(a, v) {
    if (v === "campaign-spy") return "Accept";
    if (v === "campaign-escape") return "Refuse";
    if (VERB[v] && VERB[v].label) return VERB[v].label;
    const raw = String(labelFor(a, v) || v);
    return shortText(raw.split(/\s+[—–-]\s+/)[0], 18);
  }
  function optButton(cls, idx, a, v, subMax) {
    const sub = subFor(a, v);
    return '<button type="button" class="' + cls + '" data-pi="' + idx + '" aria-label="' +
      esc(labelFor(a, v)) + '"><span class="pi-lab">' + esc(shortLabel(a, v)) + "</span>" +
      (sub ? '<span class="pi-sub">' + esc(shortText(sub, subMax || 12)) + "</span>" : "") + "</button>";
  }
  // Tablet rail: ONE WORD ON THE BUTTON (owner, 2026-08-19), the price or
  // status as the small chip inside it.
  function optChoice(idx, a, v) {
    const sub = subFor(a, v);
    return '<div class="pi-choice">' +
      '<button type="button" class="pi-action" data-pi="' + idx + '" aria-label="' +
      esc(labelFor(a, v)) + '">' + esc(shortLabel(a, v).toUpperCase()) +
      (sub ? '<span class="pi-act-sub">' + esc(shortText(sub, 12)) + "</span>" : "") +
      "</button></div>";
  }

  function renderTouch(a, verbs, rawNote) {
    buildTouchUI();
    const note = shortText(rawNote, 40);
    const docked = !!(CBZ.touchInteractionDocked && CBZ.touchInteractionDocked());
    let btns = "";
    for (let i = 0; i < verbs.length; i++) btns += docked ? optChoice(i, a, verbs[i]) : optButton("svbtn", i, a, verbs[i], 12);
    // renderPanel runs EVERY frame while somebody is in range; only touch the
    // DOM when what it would say actually changed.
    const who = whoHTML(a);
    const sig = who + "\u0001" + note + "\u0001" + btns;
    if (sig === piSig) return;
    piSig = sig;
    piName.innerHTML = who;
    piName.style.display = who ? "" : "none";
    piNote.textContent = note;
    piNote.style.display = note ? "" : "none";
    piVerbs.innerHTML = btns;
    piOpts.innerHTML = "";
    // the phone stack's height, for css/interact_touch.css's layout math
    setDockHeight(docked ? 0 : piRoot.getBoundingClientRect().height);
  }

  function setDockHeight(px) {
    document.documentElement.style.setProperty("--pi-dock-h", Math.round(px) + "px");
  }

  function showTouchUI(on) {
    if (on && !piRoot) return;        // nothing built yet — never latch a lie
    if (on === piShown) return;
    piShown = on;
    if (piRoot) piRoot.classList.toggle("show", on);
    if (!on) setDockHeight(0);
  }
  // On touch the legacy #interact card is replaced, not decorated. #interact
  // is SHARED with city/interactions.js, so the latch is driven from mode
  // every frame rather than from touchMode once. `.show` still tracks context
  // (CBZ.interactionMenuOpen reads it).
  function syncQuiet() {
    const q = touchUI() && !!CBZ.game && CBZ.game.mode === "escape";
    if (q === piQuiet) return;
    piQuiet = q;
    el.interact.classList.toggle("pi-quiet", q);
    if (q) el.interactOpts.innerHTML = "";
  }

  let current = null, cooldown = 0;

  function candidates() {
    const list = [];
    for (const n of CBZ.npcs) list.push(n);
    for (const g of CBZ.guards) if (g.data) list.push(g);
    return list;
  }
  function nearest() {
    let best = null, bd = RANGE * RANGE;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    for (const a of candidates()) {
      if (a.ko > 0 || a.dead || a.escaped) continue;
      const dx = px - a.group.position.x, dz = pz - a.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    // The man you are holding at gunpoint wins the card over whoever is at
    // your elbow, but only inside RANGE (systems/intimidate.js picks by
    // crosshair; this picks by distance; they disagree often enough).
    if (CBZ.intimidate && CBZ.intimidate.target) {
      const held = CBZ.intimidate.target();
      if (held && held !== best && held.group && !held.dead && !held.escaped && !(held.ko > 0) &&
          held.intimidMode === "scared") {
        const hx = px - held.group.position.x, hz = pz - held.group.position.z;
        if (hx * hx + hz * hz < RANGE * RANGE) best = held;
      }
    }
    return best;
  }

  function renderPanel(a) {
    const note = panelNote(a);
    const verbs = capVerbs(verbsFor(a));
    a._verbs = verbs;
    if (touchUI()) { renderTouch(a, verbs, note); return; }
    // DESKTOP: his name over the key rows, then each verb and its chip.
    const who = whoHTML(a);
    if (el.interactName.innerHTML !== who) el.interactName.innerHTML = who;
    if (el.interactNote.textContent !== note) el.interactNote.textContent = note;
    const dockedTouch = !!(CBZ.touchInteractionDocked && CBZ.touchInteractionDocked());
    const html = verbs.map((v, i) => {
      const label = labelFor(a, v);
      const sub = subFor(a, v);
      if (dockedTouch) {
        return `<div class="iopt tverb tyes" data-i="${i}">` +
          `<button type="button" class="itouch-act" aria-label="${esc(label)}">${esc(shortLabel(a, v).toUpperCase())}` +
          (sub ? `<span class="pi-act-sub">${esc(shortText(sub, 12))}</span>` : "") + `</button></div>`;
      }
      return `<div class="iopt" data-i="${i}" aria-label="${esc(label)}"><span class="ikey">${(OPT_KEYS[i] || "").toUpperCase()}</span>` +
        `<span class="ilab">${esc(shortLabel(a, v))}</span>` +
        `<span class="isub">${esc(sub)}</span></div>`;
    }).join("");
    if (el.interactOpts.innerHTML !== html) el.interactOpts.innerHTML = html;
  }

  // Exactly THREE option keys, J K L (numbers belong to the hotbar, I to the
  // stash). Touch buttons call doAction by index.
  const OPT_KEYS = ["j", "k", "l"];
  /* THREE, and a backstop only: verbsFor curates every context to three by
     hand (tools/interact-verbs-check.mjs fails the build if a context arrives
     here needing a cut). Order = what would hurt most to lose. */
  const MAX_VERBS = 3;
  const VERB_PRIORITY = {
    refuse: 100, talk: 90, steal: 87, befriend: 86, join: 85, accept: 92, trade: 88,
    settle: 93, collect: 86, work: 74,
    confrontReport: 84, paySilence: 80, snitch: 80, bribe: 78, threatenSnitch: 78,
    payoff: 76, pay: 74, detain: 72, search: 70, warn: 66, threaten: 64,
    respect: 60, question: 60, haggle: 50, insult: 40,
    rob: 96, restrain: 95, release: 94,
  };
  function capVerbs(v) {
    if (v.length <= MAX_VERBS) return v;
    const score = (x) => (VERB_PRIORITY[x] != null ? VERB_PRIORITY[x] : 55);
    const keep = v.slice().sort((a, b) => score(b) - score(a)).slice(0, MAX_VERBS);
    return v.filter((x) => keep.indexOf(x) >= 0);   // back to original menu order
  }
  // Exposed so touch/controller surfaces can tell when context is live.
  CBZ.interactionMenuOpen = function () { return !!(el.interact.classList.contains("show") && CBZ.game.state === "playing"); };

  /* THE MAN TALKS TO YOU (what used to be the LISTEN button). The first time
     the card opens on a live approach, his pitch is SPOKEN over his head.
     Once per approach: `a.approach.greeted` is resolveNpcApproach's own flag,
     and a listen after greeting is not counted as a player response. */
  function autoListen(a) {
    if (!a || !a.approach || !(a.approach.t > 0) || a.approach.greeted) return;
    if (!CBZ.resolveNpcApproach) return;
    let res = null;
    try { res = approachAction(a, "listen"); } catch (e) { return; }
    if (res && res.ok && res.msg) sayResult(a, res.msg, 3.2);
  }

  function update(dt) {
    syncQuiet();
    if (CBZ.game.mode !== "escape") {
      if (current) { current = null; el.interact.classList.remove("show"); }
      showTouchUI(false);
      return;
    }
    if (cooldown > 0) cooldown -= dt;
    const a = nearest();
    if (a !== current) {
      current = a;
      if (a) { autoListen(a); renderPanel(a); el.interact.classList.add("show"); }
      else el.interact.classList.remove("show");
    } else if (a) renderPanel(a);
    showTouchUI(!!(a && touchUI() && !CBZ.invOpen && CBZ.game.state === "playing"));
    if (piRoot) piRoot.classList.toggle("cool", cooldown > 0);
  }

  function doAction(idx) {
    if (!current || cooldown > 0 || CBZ.game.state !== "playing") return;
    const verbs = current._verbs || capVerbs(verbsFor(current));
    if (!(idx >= 0) || idx >= verbs.length) return;
    cooldown = 0.35;
    const v = verbs[idx];
    const who = current;
    const res = CBZ.cityCampaignPrisonAct && CBZ.cityCampaignPrisonAct(v, who);
    if (res && res.handled) {
      if (res.msg) sayResult(who, res.msg, 2.8);
      return;
    }
    if (!VERB[v]) return;
    const out = VERB[v].fn(who);
    if (out && out.msg) sayResult(who, out.msg, 2.8);
  }

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    // only consume the option keys while a panel is actually up
    if (!CBZ.interactionMenuOpen()) return;
    const i = OPT_KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0) { e.preventDefault(); doAction(i); }
  });

  // tap/click the menu rows (mobile + mouse). delegated so it survives re-render.
  el.interactOpts.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest(".iopt");
    if (row && row.dataset.i != null) doAction(+row.dataset.i);
  });
  CBZ.doInteract = doAction;       // touch buttons call this

  CBZ.onUpdate(45, update);
  CBZ.onAlways(97, function (dt) {
    // onUpdate stops at the pause/title screen, so the quiet latch is
    // re-evaluated here too — a mode change while paused must still hand
    // #interact back to whoever owns it next.
    syncQuiet();
    if (CBZ.game.state !== "playing") {
      if (current) { current = null; el.interact.classList.remove("show"); }
      showTouchUI(false);
    } else if (CBZ.game.mode !== "escape") showTouchUI(false);
  });
})();
