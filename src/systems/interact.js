/* ============================================================
   systems/interact.js — THE VERBS ARE ON THE PERSON.

   OWNER (2026-09-30): "Put the interaction options ONTO the thing being
   interacted with ... On touch, interaction options should only show when
   you touch the character or thing."

   There used to be two fixed surfaces for people in the prison: a key-row
   card at the right edge on a keyboard (#interact, J K L) and a rail of
   buttons by the thumb on touch (#pinteract). Both are gone. A person's verbs
   are now pills pinned BESIDE HIM, his name on top, through the one
   prompt-on-the-thing system the doors and vents already use
   (CBZ.prisonPrompt, systems/interactions.js): a `group` of pills that shows
   together, stacked down from his shoulder, the first one the obvious verb.

     KEYBOARD  the man you FACE (in reach, nothing solid between you) wears
               his verbs. E is the first one, then J, K, L. A pill's key fires
               only while that pill is the one shown (prisonPrompt's bound
               keys), so a door beside him never takes the same press.
     TOUCH     nothing on anybody until you tap him (systems/touch.js raycasts
               the tap against the prison's people and calls select()). His
               verbs appear in THE DOCK, left of the right-thumb cluster
               (owner, on the first pass: "put those buttons back where they
               were so that they don't overlap with other buttons"); tap one.
               Tap anywhere else, or walk off, and they go away.

   NEVER ON HIM (owner: "it can't be overlapping them. It can't block them at
   all"): on a keyboard the cluster is laid out beside his PROJECTED BODY
   (bodyBoxFn below, laid out by interactions.js layoutBeside), right side
   first, left when the right is off the glass, never across him. Measured
   live by tools/prison-onthing-check.mjs.

   GRAB is the disaster game's grab (systems/handverbs.js + grapple.js +
   CBZ.verbs): pressing it swaps in the hold set (Throw / Carry / Drop)
   on the man in your hands, the same buttons the disaster dock shows, plus
   the prison's one extra (Pickpocket, his pockets while you hold him). Hands on a
   man is a blow in the prison's eyes (systems/prisonlaw.js): on an officer
   or the warden it is an assault.

   TRADE opens systems/prisontrade.js: your pockets and his on one table.

   The verb ids, CBZ.doInteract(i), CBZ.prisonVerbsFor(a) and
   CBZ.prisonInteractTarget() keep their contracts (tools/prison-cop-check,
   prison-tell-check and the presets drive them headless).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const el = CBZ.el;
  const RANGE = 3.2;          // m: a man you can put a hand on in a step
  const HOLD_T = 0.9;         // s: the man you were facing keeps his verbs this long after a glance away
  const KEYS = ["E", "J", "K", "L"];
  const MAX_VERBS = 4;

  function PD() { return CBZ.prisonDemand || null; }
  function demandOn(a) { const D = PD(); return D ? D.of(a) : null; }
  function warnActor(a) {
    a.aiState = "flee";
    a.fleeT = 1.8;
    return { ok: true, msg: "Go on. Move." };
  }
  function staff(a) { return !!a && (a.kind === "guard" || a.kind === "warden"); }

  /* HANDS ON A MAN. The grab is a blow as far as the yard and the badge are
     concerned: the same ledger a punch writes (combat.js theLaw), minus the
     damage. On an officer or the warden it is an assault (prisonlaw.js), which
     is a lockdown when the warden hears of it. A grabbed inmate remembers it. */
  function handsOn(a) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape" || g.role === "cop") return;
    if (staff(a)) {
      if (CBZ.prisonOffense) CBZ.prisonOffense("assault", { seenBy: a.kind === "warden" ? null : a, severity: a.kind === "warden" ? 4 : 3 });
      a.hunt = 3;
      return;
    }
    a.playerGrudge = Math.min(14, (a.playerGrudge || 0) + 2);
    a.playerFear = Math.min(14, (a.playerFear || 0) + 1);
    if (CBZ.prisonLawNoteBlow) CBZ.prisonLawNoteBlow("player", a);
    if (CBZ.provokeGang) CBZ.provokeGang(a, 8);
    if (CBZ.guardWatching && CBZ.prisonOffense) {
      let w = null;
      try { w = CBZ.guardWatching(CBZ.player.pos.x, CBZ.player.pos.y || 0, CBZ.player.pos.z); } catch (e) { w = null; }
      if (w) CBZ.prisonOffense("fight", { seenBy: w, severity: 2 });
    }
  }
  function handVerb(id) { return CBZ.handVerbs ? CBZ.handVerbs.verb(id) : null; }

  const VERB = {
    // NO TALK VERB (owner 2026-10-09: "You shouldn't have to press Talk").
    // What a man has to say he SAYS as you come up to him (speakOnApproach
    // below, systems/quests.js onTalk with auto), when he has something real.
    // Nobody walks up to you with a pitch (owner 2026-10-22); what you can do
    // with him is here, and every one of these is a decision.
    // offered, never browsed (systems/prisonfriends.js decides when he owes you)
    befriend: { label: "Befriend",  fn: (a) => (CBZ.prisonFriendAccept ? CBZ.prisonFriendAccept(a) : { ok: false, msg: "" }) },
    // the way out of a grudge: cigs scaled to how sore he is (entities/ai.js)
    squash:   { label: "Squash",    fn: (a) => (CBZ.squashGrudge ? CBZ.squashGrudge(a) : { ok: false, msg: "" }) },
    // somebody else's debt (PRISON_CONTRACTS): take the claim, then bring proof
    collect:  { label: "Collect",   fn: (a) => {
      if (!CBZ.prisonContract || !CBZ.prisonContract.offer) return { ok: false, msg: "" };
      return { ok: !!CBZ.prisonContract.offer(a), msg: "" };
    } },
    settle:   { label: "Settle",    fn: (a) => (CBZ.prisonContract ? CBZ.prisonContract.settle(a) : { ok: false, msg: "" }) },
    // the cornered debtor's few smokes, taken (ai.js takeDodge)
    take:     { label: "Take",      fn: (a) => (CBZ.prisonContract && CBZ.prisonContract.takeDodge ? CBZ.prisonContract.takeDodge(a) : { ok: false, msg: "" }) },
    // a job for his crew (ai.js crewWork): yours, or one that trusts you
    work:     { label: "Work",      fn: (a) => (CBZ.prisonCrewWork ? CBZ.prisonCrewWork.take(a) : { ok: false, msg: "" }) },
    // THE TABLE (systems/prisontrade.js)
    trade:    { label: "Trade",     fn: (a) => (CBZ.prisonTrade ? CBZ.prisonTrade.open(a) : CBZ.econ.trade(a)) },
    bribe:    { label: "Bribe",     fn: (a) => CBZ.econ.bribe(a) },
    payoff:   { label: "Payoff",    fn: (a) => CBZ.econ.payoff(a) },
    // PICKPOCKET (owner 2026-10-19: "I want the pickpocket button back"). The
    // jail's lift was always this verb; it said "Steal". His word now.
    steal:    { label: "Pickpocket", fn: (a) => CBZ.econ.steal(a) },
    // PUNCH on the man whose verbs you tapped (the fire button swings at
    // whoever is in front). combat.js punch writes the blow into the jail's law.
    punch:    { label: "Punch",     fn: (a) => (CBZ.punch ? CBZ.punch(a) : { ok: false, msg: "" }) },
    // HANDS BEHIND YOUR BACK the blow is the forehead (combat.js punch in
    // cuffs; walked by the man you hit, the back of the head: melee.js butt)
    headbutt: { label: "Headbutt",  fn: (a) => {
      if (CBZ.melee && CBZ.melee.butt && CBZ.melee.butt()) return { ok: true, msg: "" };
      return CBZ.punch ? CBZ.punch(a, { butt: true }) : { ok: false, msg: "" };
    } },
    // ---- A MAN ON THE FLOOR (knocked down, knocked out): the disaster game's
    // DOWN set (systems/handverbs.js) plus his pockets and your boot
    // over the shoulder: grapple.grab on a man who is down is CBZ.verbs.carry
    pickUp:   { label: "Pick up",   fn: (a) => {
      const G = CBZ.grapple;
      const S = G && G.grab ? G.grab(a) : null;
      if (!S) return { ok: false, msg: "" };
      handsOn(a);
      return { ok: true, msg: "" };
    } },
    // by the collar, heels on the ground; you walk slow (handverbs loadScale)
    drag:     { label: "Drag",      fn: (a) => {
      const V = CBZ.verbs, pa = V && V.playerActor ? V.playerActor() : null;
      const S = V && pa && V.drag ? V.drag(pa, a) : null;
      if (!S) return { ok: false, msg: "" };
      handsOn(a);
      return { ok: true, msg: "" };
    } },
    // SEARCH: every pocket, what he REALLY carries (economy.js rollLoadout:
    // cigs, his keycard, a shiv). It empties him, so it is offered only while
    // he still has something. A screw who sees it sees a theft.
    frisk:    { label: "Search",    fn: (a) => {
      const E = CBZ.econ;
      if (!E || !E.lootActor) return { ok: false, msg: "" };
      const got = E.lootActor(a, {});
      if (!got || (!got.cigs && !got.items.length)) { if (CBZ.sfx) CBZ.sfx("whoosh"); }
      if (CBZ.reportCrime) CBZ.reportCrime(staff(a) ? 40 : 14, { type: "steal", actorRole: CBZ.game.role });
      if (!staff(a)) {
        a.playerGrudge = Math.min(14, (a.playerGrudge || 0) + 2);
        a.grudgeWhy = "you going through my pockets";
      }
      return { ok: true, msg: "" };
    } },
    // a boot in him (combat.js punch on a floored man is the ground blow)
    kick:     { label: "Kick",      fn: (a) => (CBZ.punch ? CBZ.punch(a) : { ok: false, msg: "" }) },
    // SHOVE him off you: CBZ.verbs' palms, and hands on a man is a blow
    shove:    { label: "Shove",     fn: (a) => {
      const V = CBZ.verbs, pa = V && V.playerActor ? V.playerActor() : null;
      if (!V || !pa || !V.shove) return { ok: false, msg: "" };
      if (CBZ.fpsPunchAnim) CBZ.fpsPunchAnim(true);
      if (!V.shove(pa, a, { force: true })) return { ok: false, msg: "" };
      handsOn(a);
      return { ok: true, msg: "" };
    } },
    // GRAB: the disaster game's grab, on this man
    grab:     { label: "Grab",      fn: (a) => {
      const G = CBZ.grapple;
      const S = G && G.grab ? G.grab(a) : null;
      if (!S) return { ok: false, msg: "" };
      handsOn(a);
      return { ok: true, msg: "" };
    } },
    // SNITCH (systems/prisonsnitch.js): the card turns into what you know
    tell:     { label: "Snitch",    fn: (a) => (CBZ.prisonSnitch ? CBZ.prisonSnitch.open(a) : { ok: false, msg: "" }) },
    tellA:    { label: "",          fn: (a) => (CBZ.prisonSnitch ? CBZ.prisonSnitch.pick(a, "tellA") : { ok: false, msg: "" }) },
    tellB:    { label: "",          fn: (a) => (CBZ.prisonSnitch ? CBZ.prisonSnitch.pick(a, "tellB") : { ok: false, msg: "" }) },
    tellC:    { label: "",          fn: (a) => (CBZ.prisonSnitch ? CBZ.prisonSnitch.pick(a, "tellC") : { ok: false, msg: "" }) },
    tellNo:   { label: "Nothing",   fn: () => (CBZ.prisonSnitch ? CBZ.prisonSnitch.close() : { ok: true, msg: "" }) },
    // ---- THE WARDEN (systems/prisonwarden.js owns both). Only decisions:
    // the transfer he owes you, the blade he ordered you to bring him. His
    // own word is an ORDER (systems/command.js), never a button of yours.
    wtransfer:{ label: "Transfer",  fn: (a) => wardenAct("wtransfer", a) },
    whand:    { label: "Give",      fn: (a) => wardenAct("whand", a) },
    // ---- AN OFFICER'S ORDERS to an inmate (the cop role): he decides
    // (systems/command.js: the uniform, what he thinks of you, his nerve)
    oback:    { label: "Back off",  fn: (a) => orderCon(a, "back") },
    odrop:    { label: "Drop it",   fn: (a) => orderCon(a, "drop") },
    join:     { label: "Join",      fn: (a) => CBZ.joinGang(a) },
    // ---- a crew collecting a debt you really owe (ai.js CBZ.prisonDemand):
    // pay it, or take the work that clears it. Walking off, running, swinging
    // and drawing are your body, not buttons.
    pay:      { label: "Pay",       fn: (a) => (PD() ? PD().pay(a) : { ok: false, msg: "" }) },
    workOff:  { label: "Work",      fn: (a) => (PD() ? PD().workOff(a) : { ok: false, msg: "" }) },
    // ---- the man who reported you, once you know it (entities/ai.js)
    confrontReport: { label: "Confront", fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "confront") : { ok: false, msg: "" } },
    paySilence: { label: "Pay",     fn: (a) => CBZ.resolveKnownSnitch ? CBZ.resolveKnownSnitch(a, "paySilence") : { ok: false, msg: "" } },
    // ---- the officer's own (cop role)
    warn:     { label: "Warn",      fn: (a) => warnActor(a) },
    detain:   { label: "Cuff",      fn: (a) => {
      if (!cuffOk(a)) return { ok: false, msg: "" };
      if (PD()) PD().cancel(a);
      const surrendered = a.intimidMode === "scared";
      if (a.intimidMode && CBZ.intimidateRelease) CBZ.intimidateRelease(a);   // the hold ends in the cuffs
      const justified = CBZ.game.role === "cop" && (surrendered || a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight");
      a.hp = Math.max(a.hp || 0, 45); a.aiState = "flee"; a.foe = null;
      if (a.copMarked > 0) a.copMarked = 0;
      // YOUR HANDS DO IT (CBZ.verbs.cuff): turned round, wrists behind his
      // back, the cuffs ON them; then he goes down for a beat, cuffed
      const V = CBZ.verbs;
      const land = function () {
        a.ko = Math.max(a.ko || 0, 5.5);
        if (V && V.setCuffs) V.setCuffs(a, true, { whileKo: true });   // off again when he is let up
      };
      // a man already on the floor is cuffed where he lies (knee on his back)
      const S = V && V.cuff && (!(a.ko > 0) || V.cuffDown) ? V.cuff(V.playerActor(), a, { far: true, onEnd: land }) : null;
      if (!S) { land(); CBZ.sfx("punch"); CBZ.shake && CBZ.shake(0.45); }
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.game.role === "cop" && CBZ.addComplaint) CBZ.addComplaint(justified ? -2 : 5);
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(a, "detain");
      return { ok: true, msg: "" };   // he goes down; that is the receipt
    } },
    search:   { label: "Search",    fn: (a) => {
      if (PD()) PD().cancel(a);
      a._copSearched = (a._copSearched | 0) + 1;      // the warden's "toss that man", done
      const justified = a.intimidMode === "scared" || a.copMarked > 0 || a.huntPlayer > 0 || a.aiState === "fight";
      if (a.intimidMode && CBZ.intimidateRelease) CBZ.intimidateRelease(a);
      const found = (justified ? 2 : 1) + Math.floor(CBZ.econ.rng() * (justified ? 6 : 4));
      if (a.copMarked > 0) a.copMarked = 0;
      // THE PAT-DOWN (CBZ.verbs.frisk): hands up, turned to the wall
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
    // ---- held at gunpoint (systems/intimidate.js owns the state)
    rob:      { label: "Rob",       fn: (a) => { if (CBZ.prisonRobTarget) CBZ.prisonRobTarget(a); return { ok: true, msg: "" }; } },
    restrain: { label: "Tie",       fn: (a) => { if (CBZ.prisonRestrainTarget) CBZ.prisonRestrainTarget(a); return { ok: true, msg: "" }; } },
    release:  { label: "Release",   fn: (a) => { if (CBZ.intimidateRelease) CBZ.intimidateRelease(a); return { ok: true, msg: "" }; } },
  };
  // the order is said over YOUR head (you are the officer giving it); his
  // answer is his (command.js speaks it), and his body carries it out
  function orderCon(a, order) {
    const C = CBZ.command;
    if (!C || !C.issue) return order === "back" ? warnActor(a) : { ok: false, msg: "" };
    const V = CBZ.voice;
    const line = V && V.line ? V.line(CBZ.player, "order", { order: order }) : "";
    if (line && CBZ.prisonSay) { try { CBZ.prisonSay(CBZ.player, line, { force: true, secs: 1.6 }); } catch (e) {} }
    const r = C.issue(CBZ.player, a, order, null, { game: "prison" });
    if (r.answer === "refuse" || r.answer === "turn") { a.playerGrudge = Math.min(14, (a.playerGrudge || 0) + 1); }
    return { ok: r.answer === "obey", msg: "" };
  }
  function wardenAct(v, a) {
    const W = CBZ.warden;
    const r = W && W.act ? W.act(v, a) : null;
    return r && r.handled ? { ok: r.ok, msg: r.msg } : { ok: false, msg: "" };
  }
  // a verb id the hands own (systems/handverbs.js): "h:throw", "h:setDown"...
  function isHand(v) { return typeof v === "string" && v.indexOf("h:") === 0; }
  function verbFn(v) {
    if (isHand(v)) { const h = handVerb(v.slice(2)); return h ? function () { h.fn(); return { ok: true, msg: "" }; } : null; }
    return VERB[v] ? VERB[v].fn : null;
  }

  function cleanName(a) {
    return a && a.data && a.data.name ? a.data.name.replace(/^the |^a |^an /, "") : "";
  }
  function shortText(s, max) {
    s = String(s || "");
    max = max || 28;
    return s.length > max ? s.slice(0, Math.max(0, max - 1)) + "…" : s;
  }
  // who he runs with: his gang's name (systems/prisoncars.js), or Independent
  function gangShort(a) {
    if (!a) return "";
    if (!(a.gang >= 0)) return "Independent";
    const P = CBZ.prisonCars;
    const car = a.yardCar != null && a.yardCar >= 0 ? a.yardCar : a.gang;
    return P ? P.label(car) : "";
  }
  /* WHO HE IS rides on top of his verbs (owner, 2026-09-28: "I don't see the
     name of the person above it. That's dumb."): his name, then what he is. */
  function whoFor(a) {
    let name = cleanName(a);
    name = name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
    let role = "";
    if (a && a.kind === "warden") role = "Warden";
    else if (a && a.kind === "guard") role = "Guard";
    else role = gangShort(a);
    if (role && role.toLowerCase() === name.toLowerCase()) role = "";
    return { name: shortText(name, 22), role: role };
  }
  CBZ.prisonWhoFor = whoFor;

  // THE RULE (systems/arrest.js): hands up / on his knees / down / out
  function cuffOk(a) {
    const AR = CBZ.arrest;
    return !(AR && AR.cuffable) || !!AR.cuffable(a);
  }

  /* ==========================================================================
     WHAT YOU CAN DO TO THIS MAN, RIGHT NOW. Every verb below changes the sim;
     none is here to fill a row. At most four, the obvious one first.
     ========================================================================== */
  function verbsFor(a) {
    // authored campaign beats replace the lot
    if (CBZ.cityCampaignPrisonVerbs) {
      const authored = CBZ.cityCampaignPrisonVerbs(a);
      if (authored && authored.length) return authored;
    }
    // HE IS IN YOUR HANDS: the disaster game's hold set, plus his pockets
    const H = CBZ.handVerbs ? CBZ.handVerbs.held() : null;
    if (H && H.t === a) {
      const out = H.set.map(function (x) { return "h:" + x.id; });
      if (H.kind === "hold" && !staff(a) && CBZ.game.role !== "cop") out.push("steal");
      return out;
    }
    // HE IS ON THE FLOOR (inmate, guard or warden): Search while he has
    // anything, Pick up, Drag, Kick. Pickpocket is not offered: on a man who
    // cannot feel your hand, Search IS the pickpocket, all of it.
    if (a.ko > 0 && CBZ.game.role !== "cop") {
      const E = CBZ.econ;
      const left = E && E.rollDrops ? E.rollDrops(a, { peek: true }) : null;
      const out = [];
      if (!a.looted && (!left || left.cigs > 0 || left.items.length)) out.push("frisk");
      out.push("pickUp", "drag", "kick");
      return out;
    }
    // HELD AT GUNPOINT: a drawn gun outranks a conversation
    if (a.intimidMode === "scared") return CBZ.game.role === "cop" ? ["detain", "search", "release"] : ["rob", "restrain", "release"];
    // YOU ARE SNITCHING TO HIM: the card is what you know
    const telling = CBZ.prisonSnitch && CBZ.prisonSnitch.menu ? CBZ.prisonSnitch.menu(a) : null;
    if (telling) return telling;
    /* HE IS COLLECTING WHAT YOU OWE HIS CREW (ai.js CBZ.prisonDemand): pay
       it, or take the work that clears it, or answer with your hands. */
    const dem = CBZ.game.role !== "cop" ? demandOn(a) : null;
    if (dem && dem.kind === "debt") {
      const out = [];
      if ((CBZ.game.cigs || 0) > 0) out.push("pay");
      if (PD().canWorkOff(a)) out.push("workOff");
      if (out.length) { out.push("grab", "punch"); return out; }
    }
    // A COP: toss him, cuff him (only a man who gave up or is down), and the
    // orders a uniform gives: steel out is "Drop it", trouble is "Back off"
    if (CBZ.game.role === "cop" && !staff(a)) {
      const out = cuffOk(a) ? ["search", "detain"] : ["search"];
      if (a._shankOut) out.unshift("odrop");
      else if (a.aiState === "fight" || (a.huntPlayer || 0) > 0 || (a.playerGrudge || 0) >= 6) out.push("oback");
      return out;
    }
    // THE MAN WHO REPORTED YOU, once you know it: lean on him, pay him, or take hold of him
    const knowsRat = CBZ.playerKnowsSnitch ? CBZ.playerKnowsSnitch(a) : (a.reportedPlayerT || 0) > 0;
    if (CBZ.game.role !== "cop" && knowsRat) return ["confrontReport", "paySilence", "grab"];
    const canTell = !!(CBZ.prisonSnitch && CBZ.prisonSnitch.canTell && CBZ.prisonSnitch.canTell(a));
    /* THE WARDEN. In his office: Snitch, Transfer (once he owes you), Give
       (the blade he sent you for). On the floor: Snitch gets you his office,
       his pockets, and your hands, which is an assault. Everything he says
       to you is an order you answer by doing it (systems/prisonwarden.js). */
    if (a.kind === "warden") {
      const W = CBZ.warden;
      const meet = W && W.verbs ? W.verbs(a) : null;
      if (meet) return meet;
      const out = (W && W.floor ? W.floor(a) : null) || (canTell ? ["tell"] : []);
      // his pockets are always worth a try (owner 2026-10-22); economy.js
      // makes it a long shot with an officer at his shoulder
      out.push("steal");
      out.push("grab");
      return out;
    }
    /* AN OFFICER. What you know outranks small talk; BRIBE buys this moment,
       PAYOFF the heat off your file (whichever you need); a bent one sells
       (Trade takes Talk's place when you have nothing to tell him). */
    if (a.kind === "guard") {
      const money = (a.corrupt && guardPayoffWorthIt()) ? "payoff" : "bribe";
      const deals = !!(CBZ.prisonTradeDeals && CBZ.prisonTradeDeals(a));
      const lead = canTell ? "tell" : (deals ? "trade" : null);
      return lead ? [lead, money, "steal", "grab"] : [money, "steal", "grab", "shove"];
    }
    /* AN INMATE: one headline (what this man is to you right now), then the
       three things you can do with anybody: deal, lift, take hold. */
    const offering = !!(CBZ.prisonFriendOffered && CBZ.prisonFriendOffered(a));
    const sore = !!CBZ.squashGrudge && (a.playerGrudge || 0) >= 4;
    const PCs = CBZ.prisonCars;
    // JOIN is yours to ask, of a man of your own car (systems/prisoncars.js:
    // the car your heritage puts you in; nobody's once it cast you out)
    const recruiting = a.gang >= 0 && CBZ.player.gang == null &&
      (!PCs || (PCs.playerCar() >= 0 && a.yardCar === PCs.playerCar() && !(PCs.isOut && PCs.isOut())));
    const C = CBZ.prisonContract;
    const settling = !!(C && C.forCreditor(a) && (C.satisfied(C.live()) || (C.live() && C.live().dead)));
    const claiming = !!(C && C.canOffer(a));
    const cornered = !!(C && C.dodgeOffer && C.dodgeOffer(a) > 0);
    const crewWork = !!(CBZ.prisonCrewWork && CBZ.prisonCrewWork.can(a));
    const head = settling ? "settle"
      : cornered ? "take"
      : offering ? "befriend"
      : sore ? "squash"
      : claiming ? "collect"
      : recruiting ? "join"
      : crewWork ? "work"
      : null;
    // FOUR SEATS, ALWAYS FILLED (owner on iPad: "there's not enough"): with no
    // headline the fourth is your fist on him. Trade stays first because it is
    // the E key, and E on a man you happen to face must never be an assault.
    return head ? [head, "trade", "steal", "grab"] : ["trade", "steal", "grab", "punch"];
  }

  // a payoff cleans heat; with nothing on your file it would buy nothing
  function guardPayoffWorthIt() {
    const g = CBZ.game || {};
    const heat = g.detection != null ? g.detection : (g.heat || 0);
    return heat > 0 || (g.complaints || 0) > 0 || (g.racketDebt || 0) > 0 || (g.wanted || 0) > 0;
  }
  /* THE CHIP IS A NUMBER OR A NOUN, NEVER A MOOD: what it costs, or the thing
     it is about ("14", "Shiv"). */
  function subFor(a, v) {
    if (CBZ.cityCampaignPrisonSub) {
      const authored = CBZ.cityCampaignPrisonSub(a, v);
      if (authored != null) return authored;
    }
    switch (v) {
      case "payoff": return (CBZ.econ.payoffCost ? CBZ.econ.payoffCost(a) : 6) + "";
      case "pay": {
        const c = PD() ? PD().cost(a) : 0;
        return c > 0 ? Math.min(c, CBZ.game.cigs || 0) + "" : "";
      }
      case "take": {
        const t = CBZ.prisonContract && CBZ.prisonContract.dodgeOffer ? CBZ.prisonContract.dodgeOffer(a) : 0;
        return t > 0 ? t + "" : "";
      }
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

      case "steal": {
        const want = CBZ.prisonContract && CBZ.prisonContract.wantedItem(a);
        return want ? shortText(want, 12) : "";
      }
      case "join": return gangShort(a);
      default: return "";
    }
  }
  // the word on the pill: VERB[]'s, a hand verb's (its world word: "Slam",
  // "Throw in"), a snitch line, or an authored campaign verb cut to its head
  function shortLabel(a, v) {
    if (v === "campaign-spy") return "Accept";
    if (v === "campaign-escape") return "Refuse";
    if ((v === "tellA" || v === "tellB" || v === "tellC") && CBZ.prisonSnitch) return shortText(CBZ.prisonSnitch.label(v), 24);
    if (isHand(v)) { const h = handVerb(v.slice(2)); return h ? h.label : ""; }
    if (VERB[v] && VERB[v].label) return VERB[v].label;
    const raw = String((CBZ.cityCampaignPrisonLabel && CBZ.cityCampaignPrisonLabel(a, v)) || v);
    // the head of the line, whole: a button word is never ellipsised
    return raw.split(/\s+[—–-]\s+/)[0];
  }
  // TIE needs a rope in the bag. Owner (2026-10-22): the rope is the
  // CONDITION for the button, not a word printed on it, so without one there
  // is no Tie at all.
  function hasRope() { return !!(CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Bedsheet Rope")); }
  function capVerbs(v) {
    if (v.indexOf("restrain") >= 0 && !hasRope()) v = v.filter(function (x) { return x !== "restrain"; });
    // CUFFED (CBZ.arrest.playerCuffed): only what a mouth can do
    const C = CBZ.cuffedPlayer;
    if (C && C.on()) {
      // the blow survives the cuffs as a headbutt, in the punch's place
      const hit = v.indexOf("punch") >= 0 ? v.indexOf("punch") : v.indexOf("kick");
      if (hit >= 0 && v.indexOf("headbutt") < 0) { v = v.slice(); v[hit] = "headbutt"; }
      v = v.filter(function (x) { return !isHand(x) && x !== "grab" && C.verbAllowed(x); });
    }
    return v.length > MAX_VERBS ? v.slice(0, MAX_VERBS) : v;
  }

  // ===========================================================================
  //  SPEECH IS OVER THE SPEAKER'S HEAD — CBZ.prisonSay(actor, line, opts)
  //  (systems/speech.js, the mouth every game uses; the prison's own earshot)
  // ===========================================================================
  const EAR = 12, EAR_ENGAGED = 18;
  function speak(actor, msg, secs, force) {
    if (!actor || !msg || !CBZ.speech || !CBZ.game || CBZ.game.mode !== "escape") return false;
    const eng = force || !!demandOn(actor);
    return CBZ.speech.say(actor, msg, { secs: secs, force: !!force, ear: eng ? EAR_ENGAGED : EAR, headY: 1.85 });
  }
  function sayResult(actor, msg, secs) {
    if (!msg || !actor) return;
    speak(actor, msg, secs || 2.8, true);
  }
  /* THE CROWD IS NOT A CHORUS. Two mouths saying the same words inside a few
     seconds (three screws all yelling "Break it up!", two inmates both going
     "Damn." at one knockout) read as one script running on everybody, so the
     second is dropped. Unprompted chatter (not forced, not a man mid-
     conversation with you) also keeps a block-wide gap: one aside at a time. */
  const SAME_GAP = 6, AMBIENT_GAP = 3.5;
  let lastLine = "", lastLineBy = null, lastLineAt = -1e9, lastAmbientAt = -1e9;
  function sayClock() { return (CBZ.now || Date.now()) / 1000; }
  function prisonSay(actor, line, opts) {
    opts = opts || {};
    const t = sayClock();
    if (line === lastLine && actor !== lastLineBy && t - lastLineAt < SAME_GAP) return false;
    const engaged = !!opts.force || !!(actor && demandOn(actor));
    if (!engaged && t - lastAmbientAt < AMBIENT_GAP) return false;
    const ok = speak(actor, line, opts.secs || 2.2, !!opts.force);
    if (ok) {
      lastLine = line; lastLineBy = actor; lastLineAt = t;
      if (!engaged) lastAmbientAt = t;
    }
    return ok;
  }
  CBZ.prisonSay = prisonSay;
  CBZ.prisonSayAudit = function () { return CBZ.speech ? CBZ.speech.audit() : null; };

  /* ==========================================================================
     WHO WEARS THE VERBS
     ========================================================================== */
  let current = null, cooldown = 0, selected = null, faceT = 0;
  let shownVerbs = [], shownFor = null;

  function touchUI() { return !!CBZ.touchMode; }
  function up(a) {
    return !!(a && a.group && !a.dead && !a.escaped && a.data && (!(a.ko > 0) || CBZ.game.role === "cop"));
  }
  /* A MAN YOUR HANDS CAN GET TO: on his feet OR on the floor (up() is only the
     standing man, for who may walk up and speak). A man you dropped used to
     lose every verb the moment he went down, and so did a man knocked out in
     your arms: his Throw / Drop vanished mid-carry. */
  function reach(a) {
    return !!(a && a.group && !a.dead && !a.escaped && a.data);
  }
  function d2Of(a) {
    const P = CBZ.player.pos, q = a.group.position;
    const dx = P.x - q.x, dz = P.z - q.z;
    return dx * dx + dz * dz;
  }
  // nothing solid between you (a wall, the bars, a floor slab)
  function clearTo(a) {
    const V = CBZ.verbs, P = CBZ.player.pos, q = a.group.position;
    if (Math.abs((q.y || 0) - (P.y || 0)) > 1.3) return false;
    return !(V && V.lineBlocked && V.lineBlocked(P.x, P.y || 0, P.z, q.x, q.z));
  }
  function candidates(out) {
    out.length = 0;
    const n = CBZ.npcs || [], gd = CBZ.guards || [];
    for (let i = 0; i < n.length; i++) out.push(n[i]);
    for (let i = 0; i < gd.length; i++) if (gd[i].data) out.push(gd[i]);
    return out;
  }
  const _cand = [];
  /* THE MAN YOU FACE. In reach, nothing between you; the one most in front
     of you wins (distance weighted by how far off your look he is), so the
     verbs land on who you are looking at, not on whoever is at your elbow. */
  function faced() {
    const P = CBZ.player.pos;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bw = Infinity;
    candidates(_cand);
    for (let i = 0; i < _cand.length; i++) {
      const a = _cand[i];
      if (!reach(a)) continue;
      const d2 = d2Of(a);
      if (d2 > RANGE * RANGE) continue;
      const d = Math.sqrt(d2) || 0.001;
      const q = a.group.position;
      const face = ((q.x - P.x) / d) * fx + ((q.z - P.z) / d) * fz;
      const w = d * (1.7 - Math.max(-0.5, face));
      if (w < bw && clearTo(a)) { bw = w; best = a; }
    }
    // the man you are holding at gunpoint wins inside reach
    if (CBZ.intimidate && CBZ.intimidate.target) {
      const held = CBZ.intimidate.target();
      if (held && held !== best && up(held) && held.intimidMode === "scared" && d2Of(held) < RANGE * RANGE) best = held;
    }
    return best;
  }
  /* HE SPEAKS WHEN YOU COME UP TO HIM (the Talk verb is gone). Once: the man
     you turn to (or tap) says the one real thing he has for you, a job you
     took from him, what is in front of him, over his head. A man with
     nothing real to say says nothing. The same man does not repeat himself
     on every glance: a 40 s hold per man, and again only after you looked away. */

  let spokeTo = null;
  function speakOnApproach(a) {
    if (a === spokeTo) return;
    spokeTo = a;
    if (!a || !CBZ.quests || !CBZ.quests.onTalk) return;
    const now = CBZ.now || 0;
    if ((a._spokeAt || -1e9) > now - 40000) return;
    let r = null;
    try { r = CBZ.quests.onTalk(a, { auto: true }); } catch (e) { r = null; }
    if (r && r.msg) { a._spokeAt = now; sayResult(a, r.msg, 3.0); }
  }
  function heldTarget() {
    const H = CBZ.handVerbs ? CBZ.handVerbs.held() : null;
    return H && H.t && reach(H.t) ? H.t : null;
  }
  function pickCurrent(dt) {
    const held = heldTarget();
    if (held) return held;
    if (touchUI()) {
      if (selected && (!reach(selected) || d2Of(selected) > (RANGE * 1.6) * (RANGE * 1.6))) selected = null;
      return selected;
    }
    // KEYBOARD: the faced man, held a beat through a glance away (so a
    // press never lands on a man who just stepped in front of the one you meant)
    const f = faced();
    if (f) { faceT = HOLD_T; return f; }
    faceT -= dt;
    if (current && faceT > 0 && reach(current) && d2Of(current) < RANGE * RANGE * 1.4 && !heldTargetStale(current)) return current;
    return null;
  }
  function heldTargetStale(a) { return !clearTo(a); }

  /* ==========================================================================
     THE CLUSTER ON HIM (CBZ.prisonPrompt groups). His name on top, then his
     verbs down from his shoulder, beside his body (never over his head: that
     is where his words go).
     ========================================================================== */
  const ROWS = 5;   // name + MAX_VERBS
  function anchorOf(a) {
    const q = a.group.position;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);     // the camera's right
    return { x: q.x + rx * 0.42, y: (q.y || 0) + 1.62, z: q.z + rz * 0.42 };
  }
  function clearCluster() {
    if (!CBZ.prisonPromptClear) return;
    CBZ.prisonPromptClear("person-who");
    for (let i = 0; i < ROWS; i++) CBZ.prisonPromptClear("person" + i);
  }
  CBZ.prisonNoop = function () {};
  for (let i = 0; i < MAX_VERBS; i++) {
    (function (i) {
      CBZ["prisonPersonAct" + i] = function () { doAction(i); };
    })(i);
  }
  /* HIS BODY ON THE GLASS (systems/interactions.js lays the cluster just
     outside it, never over him): an upright capsule, feet to crown, shoulder
     wide, unioned with his rig's own mesh bounds when the rig has any (a man
     lifted in a grab, a man on the floor). One function per man, so the
     layout remembers which side of HIM it chose. */
  // the rig's bounds count only while they look like a body (a lying, reaching
  // or lifted man); a rig whose bounds span a bunk or a prop is the capsule
  const BODY_R = 0.34, BODY_H = 1.92, BODY_SPAN = 1.1;
  const _abox = new THREE.Box3();
  function bodyBoxFn(a) {
    if (a._promptBox) return a._promptBox;
    const out = [{ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }];
    a._promptBox = function () {
      const q = a.group.position, B = out[0];
      B.minX = q.x - BODY_R; B.maxX = q.x + BODY_R;
      B.minZ = q.z - BODY_R; B.maxZ = q.z + BODY_R;
      B.minY = q.y || 0; B.maxY = (q.y || 0) + BODY_H;
      out.length = 1;
      _abox.makeEmpty();
      try { _abox.setFromObject(a.group); } catch (e) { _abox.makeEmpty(); }
      if (!_abox.isEmpty() && _abox.max.x - _abox.min.x < BODY_SPAN && _abox.max.z - _abox.min.z < BODY_SPAN && _abox.max.y - _abox.min.y < 2.3) {
        out.push({ minX: _abox.min.x, maxX: _abox.max.x, minY: _abox.min.y, maxY: _abox.max.y, minZ: _abox.min.z, maxZ: _abox.max.z });
      }
      return out;
    };
    return a._promptBox;
  }
  CBZ.prisonBodyBoxes = function (a) { return a && a.group ? bodyBoxFn(a)() : null; };
  function render(a, verbs) {
    if (!CBZ.prisonPrompt) return;
    const at = anchorOf(a);
    const box = bodyBoxFn(a);
    const d2 = touchUI() ? 0 : d2Of(a);
    const who = whoFor(a);
    const name = who.name + (who.role ? "  " + who.role : "");
    let row = 0;
    if (who.name) {
      CBZ.prisonPrompt("person-who", "@prisonNoop", name,
        { at: at, group: "person", row: row++, side: true, label: true, quote: true, d2: d2, noReach: true, box: box, dock: true });
    } else CBZ.prisonPromptClear("person-who");
    for (let i = 0; i < verbs.length; i++) {
      const v = verbs[i];
      const sub = subFor(a, v);
      CBZ.prisonPrompt("person" + i, "@prisonPersonAct" + i, shortLabel(a, v), {
        at: at, key: KEYS[i], bind: true, group: "person", row: row++, side: true, lead: i === 0,
        sub: sub || undefined, d2: d2, noReach: true, box: box, dock: true,
        quote: v === "tellA" || v === "tellB" || v === "tellC",
      });
    }
    for (let i = verbs.length; i < ROWS; i++) CBZ.prisonPromptClear("person" + i);
  }

  function update(dt) {
    if (cooldown > 0) cooldown -= dt;
    const g = CBZ.game;
    if (g.mode !== "escape" || g.state !== "playing") {
      if (current || shownVerbs.length) { current = null; shownVerbs = []; shownFor = null; clearCluster(); }
      selected = null;
      return;
    }
    const a = pickCurrent(dt);

    current = a;
    speakOnApproach(a);
    const trading = !!(CBZ.prisonTrade && CBZ.prisonTrade.isOpen());
    if (!a || trading || CBZ.invOpen) {
      if (shownVerbs.length) { shownVerbs = []; shownFor = null; clearCluster(); }
      return;
    }
    const verbs = capVerbs(verbsFor(a));
    a._verbs = verbs;
    shownVerbs = verbs; shownFor = a;
    render(a, verbs);
  }

  /* THE PRESS IS BOUND TO WHAT WAS SHOWN: the man the pills are on and the
     verb printed on that pill, never "whatever index i means this frame". */
  function doAction(idx, fresh) {
    if (cooldown > 0 || CBZ.game.state !== "playing") return;
    const who = fresh ? (current || shownFor) : (shownFor || current);
    if (!who || !reach(who)) return;
    const verbs = (!fresh && who === shownFor && shownVerbs.length) ? shownVerbs : capVerbs(verbsFor(who));
    if (!(idx >= 0) || idx >= verbs.length) return;
    cooldown = 0.35;
    const v = verbs[idx];
    const res = CBZ.cityCampaignPrisonAct && CBZ.cityCampaignPrisonAct(v, who);
    if (res && res.handled) {
      if (res.msg) sayResult(who, res.msg, 2.8);
      return;
    }
    const fn = verbFn(v);
    if (!fn) return;
    const out = fn(who);
    if (out && out.msg) sayResult(who, out.msg, 2.8);
  }

  CBZ.interactionMenuOpen = function () {
    if (CBZ.game.mode === "escape") return !!(shownFor && shownVerbs.length && CBZ.game.state === "playing");
    return !!(el.interact.classList.contains("show") && CBZ.game.state === "playing");
  };
  // the headless/external press (tools/prison-cop-check, prison-tell-check):
  // indexes into the list CBZ.prisonVerbsFor(current) returns right now
  CBZ.doInteract = function (idx) { doAction(idx, true); };
  CBZ.prisonInteractTarget = function () { return current; };
  CBZ.prisonVerbsFor = function (a) { return a ? capVerbs(verbsFor(a)) : []; };
  // systems/touch.js: a tap on a person selects him (null: tap elsewhere)
  CBZ.prisonPeople = {
    select: function (a) {
      if (a && !reach(a)) a = null;
      selected = a || null;
      return !!selected;
    },
    selected: function () { return selected; },
    shown: function () { return shownFor ? { who: shownFor, verbs: shownVerbs.slice() } : null; },
  };

  CBZ.onUpdate(45, update);
  CBZ.onAlways(97, function () {
    if (CBZ.game.state !== "playing" || CBZ.game.mode !== "escape") {
      if (shownVerbs.length || current) { current = null; shownVerbs = []; shownFor = null; clearCluster(); }
      if (CBZ.game.mode !== "escape") selected = null;
    }
  });
})();
