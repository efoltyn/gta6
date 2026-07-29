/* ===========================================================================
   city/piracy.js — A PERSON IS WORTH SOMETHING TO SOMEBODY.

   OWNER'S ASK (2026-07-29, verbatim): "add to the yacht one — Somalian
   pirate[s] and simple boats they get, and AK-47s, and they try to kill staff
   on [the] boat or take hostage and ransom. An opus subagent should see how
   that connects to gangs, terrorists, money, rich people and families. Wow wow
   wow — what a connected feature." And, mid-build: "the big thing for ransoms
   is it connects to rich people and gangs and kidnapping actual zip tying
   physically all these things and it doesn't have to be just for yachts but
   it's a cool feature."

   So the skiff is the CHEAP HALF. The feature is the CHAIN, and the chain is
   not about boats at all:

       take a person -> WHO PAYS FOR THEM? -> what does the money cost you?

   ---------------------------------------------------------------------------
   WHAT WAS ALREADY HERE, AND WHAT WAS A LIE
   ---------------------------------------------------------------------------
   This game has had hostage-taking since social.js shipped. `cityTakeHostage`
   grabs anyone at gunpoint. restrain.js zip-ties them for real — polymer wrist
   loops, a bridge between the hands, two-bone wrists-behind-the-back IK, a
   dropped weapon, a filed kidnapping charge. captives.js draws a panel for it.
   family.js runs a whole kidnap director against YOUR household.

   And the ransom was this, in full (social.js:717-721):

       const pay = 200 + ((ped.wealth || 0.3) * 800) | 0;
       CBZ.city.addCash(pay); CBZ.city.big("RANSOM PAID + $" + pay);

   Up to a thousand dollars, out of thin air, the instant you let go. No payer.
   No family. No delay. No number that anyone agreed to. It does not matter
   WHO you took — a dock worker and a shipping heiress pay within $600 of each
   other, both from nobody. That is a stat fiction with a zip tie on it, and it
   is the exact thing this file exists to replace.

   ---------------------------------------------------------------------------
   §THE RANSOM BLOCK — CBZ.cityRansomFor / cityHostageTake / ...Demand / ...List
   ---------------------------------------------------------------------------
   ONE question, asked of the world and never invented:

       CBZ.cityRansomFor(ped) -> { kind, name, who, org, amount, pays, why }

   The payer ladder. Every rung is a real object the simulation was already
   running before the grab, in priority order:

     1. THE STATE REFUSES.   An officeholder (officialdom.seatOf), a cop, a
        soldier. There is no number. The answer is a manhunt, and it is the
        force's own escalation, not a new one. Grabbing the Mayor is a
        political act, not a payday — which is what makes it worth doing for
        a reason OTHER than money.
     2. FAMILY PAYS.         cityFamilyTree (spouseOf/kidsOf/parentsOf off the
        persistent _sid ledger), the live object graph (ped.partner /
        ped.family), and cityFamilies' modelled households. THE RICHER THE
        PERSON THE BIGGER THE NUMBER, because family capacity is their own
        `wealth`. This is the owner's "connects to rich people".
     3. THE SET PAYS, AND REMEMBERS.  A gang member's crew ransoms its own —
        through cityGangProvoke and standing, so you have just bought a
        vendetta with a face on it. This is "connects to gangs".
     4. THE FIRM PAYS, SLOWLY.  cityCompanies: the employer/underwriter. Less
        money, a longer verify clock, and no grudge. That is the insurer.
     5. NOBODY.              No family, no set, no firm -> THERE IS NO RANSOM.
        The demand cannot be made and the take is worthless. That rule is the
        whole reason WHO you grab matters, and it is the anti-fiction law
        applied to money.

   THE MONEY IS NOT CLEAN. A paid ransom is traceable cash:
     · With a crew that can FENCE it (your gang, or the pirate Broker rung),
       the fence takes its cut through factions.charge() — real money leaves
       your wallet and real standing arrives on a real ladder.
     · With nobody to move it, you keep the whole number and the PAYMENT
       ITSELF files a crime (wanted.js's own "extortion"). Whole-and-hunted,
       or smaller-and-quiet. That is a decision, not a dice roll.

   NOTHING HERE OWNS A TRANSACTION, A CLOCK UI, A WAYPOINT OR A PANEL:
     · the physical restraint is restrain.js (CBZ.cityRestrain.cuff) — the
       real zip ties, on the real rig, with the real dropped weapon;
     · the tracked objective, the map waypoint, the HUD distance line, the
       phone card and THE PAYOUT are core/mission.js;
     · the death of a hostage is killfeed.js's bus;
     · the panic of everyone watching is peds.js's cityScare + the panic field;
     · and the CAPTIVES PANEL LIGHTS UP WITH NO EDIT AT ALL. captives.js:168
       already reads `CBZ.cityKidnap || CBZ.activeKidnap`, and in the whole
       repo NOTHING has ever defined `CBZ.activeKidnap`. This file defines it,
       in the exact record shape captives.js's own add() consumes. A hook that
       was written and never plugged in is now plugged in.

   ---------------------------------------------------------------------------
   §THE PIRATES — the loyalty+weapons atom, afloat
   ---------------------------------------------------------------------------
   CLAUDE.md LAW 2: "anytime you have a ton of people loyal to you with weapons
   could be a gang." A pirate crew IS that atom, and the ROME TEST is why it is
   built out of world capabilities instead of outboard motors: strip the engine
   and the AK and this is a boarding party in any century. What is modern here
   is a hull spec row and a weapon name.

   The org is one factions.declare(), and EVERY RUNG IS AN ORDER SOMEBODY GIVES:
       Deckhand   board      — may go over the rail
       Coxswain   skiff      — may take a boat out
       Enforcer   boarding   — may ORDER a take (and vouch: sees his own)
       Broker     ransom     — may SET A NUMBER, and fence the cash
       Captain    execute /  — may kill a hostage; may call the crew off
                  standdown
   Three different people decide the three things that matter, which is what
   gives an outfit a SHAPE. The rank lives in `pirateRank` on the body
   (rankField) — factions.js stores nothing, exactly as police.js and militia.js
   do it. And THE BRASS ARE PEOPLE YOU CAN FIND: rank is a ROSTER SLOT, never a
   3%-per-body roll, so every crew that exists has exactly one Captain, one
   Enforcer and one Broker, aboard boats you can see. Kill the Broker and the
   crew can no longer name a price — they take what they can carry and go. Kill
   the Captain and nobody can call them off, and nobody can execute the hostage.

   They pose as FISHERMEN until they commit (citySetCover, org "pirates",
   `_burnable`) — so roleAudit().unseeable stays 0 both ways: the cover has an
   org to see through it AND it burns the instant the first gun comes up.

   ---------------------------------------------------------------------------
   §THE HELMSMAN — CBZ.marineAutopilot(car, dt, cmd)
   ---------------------------------------------------------------------------
   water_helm.js is a complete boat model and it drives exactly one hull: the
   one the PLAYER is standing in (it reads CBZ.keys). Nothing in this repo has
   ever driven an AI boat, so the honest gap is not a physics model, it is a
   HAND ON THE WHEEL. marineAutopilot steers a registered marine hull toward a
   point using THAT HULL'S OWN marineHulls spec — its thrust, its drag law, its
   yaw rate, its yaw-acceleration cap — and publishes exactly the fields
   water_buoyancy.js and waterWakeFor already read. It authors no new hull
   numbers, and it refuses any hull the player is driving.

   ---------------------------------------------------------------------------
   FLAGS (all one-line reverts, all declared here, never in config.js)
     PIRACY                master. false -> no crews, no skiffs, no raids.
     RANSOM_V1             the hostage/ransom block (independent of the sea).
     RANSOM_REPLACE_LEGACY wrap social.js's $1,000 fiction. false -> old payout.
     PIRACY_RAIDS          crews actually go hunting.
     PIRACY_SKIFF_HULL     register the skiff hull row.
     PIRACY_JOIN           the player may sign on with a crew.
     MARINE_AUTOPILOT      the AI helmsman.

   RATCHET: CBZ.piracyAudit(). `legacyRansom` is the count of magic-number
   ransom payouts still live in the build and is pinned at 0.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  const g = CBZ.game || (CBZ.game = {});

  if (C.PIRACY == null) C.PIRACY = true;
  if (C.RANSOM_V1 == null) C.RANSOM_V1 = true;
  if (C.RANSOM_REPLACE_LEGACY == null) C.RANSOM_REPLACE_LEGACY = true;
  if (C.PIRACY_RAIDS == null) C.PIRACY_RAIDS = true;
  if (C.PIRACY_SKIFF_HULL == null) C.PIRACY_SKIFF_HULL = true;
  if (C.PIRACY_JOIN == null) C.PIRACY_JOIN = true;
  if (C.MARINE_AUTOPILOT == null) C.MARINE_AUTOPILOT = true;
  // how many crews the sea carries at once. A pirate you meet every trip is a
  // tax, not a threat (the predator.js menace law, applied to a whole faction).
  if (C.PIRACY_CREWS == null) C.PIRACY_CREWS = 1;

  const ORG = "pirates";

  // ADOPTION IS DECLARED, NOT SNIFFED (predator.js's own rule). The boarding
  // grab runs the shared wind->strike->hold->resolve seize with `nonLethal`,
  // never a hand-rolled grapple, and this is the one guarded line that says so.
  // The id is NOT in predator.js's LEGACY_SITES yet, so this cannot move
  // predatorAudit() on its own — see the seam patch in the report, which is
  // what turns adopted 9 into 10.
  if (CBZ.predatorAdopt) CBZ.predatorAdopt("piracy:boarding-seize");
  else (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("piracy:boarding-seize");

  function on() { return C.PIRACY !== false; }
  function ransomOn() { return C.RANSOM_V1 !== false; }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function player() { return CBZ.player || null; }
  function inCity() { return (CBZ.game && CBZ.game.mode) === "city"; }
  function peds() { return CBZ.cityPeds || []; }
  function cars() { return CBZ.cityCars || []; }
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function dist(ax, az, bx, bz) { return Math.sqrt(d2(ax, az, bx, bz)); }
  function nameOf(p, fb) { return (p && (p.name || p.desc)) || fb || "someone"; }
  function money(n) { n = Math.round(num(n, 0)); try { return "$" + n.toLocaleString(); } catch (e) { return "$" + n; } }
  function waterAt(x, z) { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); }
  function seaY(x, z) {
    if (CBZ.citySeaHeightAt) return CBZ.citySeaHeightAt(x, z);
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
  }
  // Phone, never a popup (CLAUDE.md HUD doctrine — the killfeed is the only
  // sanctioned floating card and this file never writes one).
  function phone(text, from, secs) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, secs || 4.5, { from: from || "UNKNOWN NUMBER", app: "phone" });
  }
  function feed(text, color) { if (CBZ.cityFeed) CBZ.cityFeed(text, color || "#c8d4e6"); }
  function say(ped, text) { if (CBZ.citySay) { try { CBZ.citySay(ped, text); } catch (e) {} } }
  function protectedActor(a) { return !!(CBZ.isProtectedActor && CBZ.isProtectedActor(a)); }

  // A PRIVATE deterministic stream. CLAUDE.md forbids adding draws to a SHARED
  // rng (order-fragile) — this is our own, seeded off the world seed, so two
  // clients on the same seed roll the same raids.
  let _rs = 0;
  (function seedMe() {
    let s = 0x5f31;
    if (CBZ.seedStream) { try { const st = CBZ.seedStream("piracy"); if (typeof st === "function") s = Math.floor(st() * 0x7fffffff) || s; } catch (e) {} }
    else if (CBZ.hash01) { try { s = Math.floor(CBZ.hash01(1301, 907, 0x9174) * 0x7fffffff) || s; } catch (e) {} }
    _rs = s & 0x7fffffff;
  })();
  function rnd() { _rs = (_rs * 1103515245 + 12345) & 0x7fffffff; return _rs / 0x7fffffff; }
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : ((Math.sin(x * 12.9898 + z * 78.233 + (salt || 0)) * 43758.5453) % 1 + 1) % 1; }

  /* =========================================================================
     §1  THE ORG — one declaration, and every rung is an ORDER.
     ========================================================================= */
  const LADDER = [
    // needs are deliberately gentle: a pirate crew is not a career ladder, it
    // is four jobs on one boat, and the top two are LOCKED (you become Broker
    // or Captain by the man in front of you dying, never by grinding).
    { key: "deckhand", pip: "Deckhand", lvl: 11, grants: ["board"], hp: 100,
      needBody: 0, needOrders: 0, unlock: "You go over the rail." },
    { key: "coxswain", pip: "Coxswain", lvl: 16, grants: ["skiff", "helm"], hp: 110,
      needBody: 2, needOrders: 1, weapon: "Pistol", unlock: "You take a boat out yourself." },
    { key: "enforcer", pip: "Enforcer", lvl: 24, grants: ["boarding", "vouch"], hp: 130,
      needBody: 6, needOrders: 3, weapon: "AK-47", unlock: "You say when a vessel gets taken." },
    // THE NUMBER IS A JOB. Nobody else on the boat may name a price — and the
    // last two rungs are LOCKED, which in factions.js means merit never grants
    // them. You get them the way a boat crew has always handed them over: the
    // man holding it dies and you are the one standing there (see succession()).
    { key: "broker", pip: "Broker", lvl: 31, grants: ["ransom", "fence"], hp: 130,
      needBody: 10, needOrders: 6, locked: true,
      unlock: "You name the number, and you can move the money." },
    { key: "captain", pip: "Captain", lvl: 46, grants: ["execute", "standdown"], hp: 170,
      locked: true, weapon: "AK-47",
      unlock: "Yours to end, either way." },
  ];

  if (CBZ.factions && CBZ.factions.declare && !CBZ.factions.exists(ORG)) {
    CBZ.factions.declare({
      id: ORG, name: "The Boat Crews", short: "CREW",
      kind: "gang", color: 0x2fae8a,
      ranks: LADDER,
      // NO PARALLEL BOOKKEEPING: the rank stays on the body, in a field this
      // file writes and factions.js only ever reads.
      rankField: "pirateRank",
      npcTag: { field: "pirateCrew", value: true },
      wage: 0,
      heat: 1.35,
      hostileTo: ["law", "police", "army", "agency"],
      friendlyTo: ["gang"],
      // You sign on the way anybody signs on to a boat crew: you turn up where
      // they are, with a gun, and you are not carrying a badge. Every clause is
      // a live world query, and canJoin() prints the refusal.
      admission: {
        cleanRecord: false,
        test: function () {
          if (C.PIRACY_JOIN === false) return "They don't take strangers.";
          const cr = nearestCrew(200);
          if (!cr) return "You'd have to find them first — they're not in the phone book.";
          if (!(CBZ.cityOwnsGun && CBZ.cityOwnsGun())) return "Turn up with a gun or don't turn up.";
          if (CBZ.factions && CBZ.factions.tier && CBZ.factions.tier("police") >= 0) return "They know what you are.";
          return true;
        },
      },
      lore: "Five rungs on an open boat. One man says go, one man says the number, one man says stop.",
    });
  }

  // THE DEGRADE-SAFE GUARD IS rankKnows, NEVER a bare rankCan (rankCan answers
  // FALSE for an undeclared org, so `if (!rankCan(...)) return` would slam every
  // gate shut the moment FACTION_V1 was flipped off).
  function orgKnows(verb) { return !!(CBZ.rankKnows && CBZ.rankKnows(ORG, verb)); }
  function crewCan(a, verb) {
    if (!a || a.dead) return false;
    if (!orgKnows(verb) || !CBZ.rankCan) return true;      // ladder absent -> old ungated yes
    return !!CBZ.rankCan(a, ORG, verb);
  }
  // MAY THE PLAYER? Deliberately NOT crewCan(playerActor, ...): factions.js's
  // isPlayer() recognises CBZ.player / CBZ.game / the string "player" and NOT
  // CBZ.city.playerActor, so handing it the actor record would send the player
  // down the NPC branch and answer a confident, wrong "no". The player's rung is
  // a membership question and this asks it the one sanctioned way.
  function playerCan(verb) {
    const F = CBZ.factions;
    if (!F || !F.tier) return false;
    let t = -1;
    try { t = F.tier(ORG); } catch (e) { t = -1; }
    if (t < 0) return false;
    const need = F.verbTier ? F.verbTier(ORG, verb) : -1;
    return need < 0 ? true : t >= need;
  }

  // THE CHAIR IS EMPTY AND YOU ARE STANDING IN IT. The two top rungs are locked
  // against merit, so this is the ONLY way a player reaches them — the same rule
  // gangs.js's Boss uses. NPCs are deliberately NOT back-filled: police.js's
  // command-watch doctrine says a killed commander leaves the chair empty, and
  // "kill the Broker and nobody can name a price" is the whole mechanic.
  function succession(cr) {
    const F = CBZ.factions;
    if (!F || !F.promote || !F.tier) return;
    let t = -1;
    try { t = F.tier(ORG); } catch (e) { t = -1; }
    if (t < 0) return;
    if (t === 2 && !crewHolder(cr, "ransom")) F.promote(ORG, "broker");
    else if (t === 3 && !crewHolder(cr, "standdown")) F.promote(ORG, "captain");
  }

  // Is there anybody ALIVE ON THIS BOAT who may give this order? That is what
  // turns a rung into a consequence rather than a pip.
  function crewHolder(crew, verb) {
    if (!crew) return null;
    if (!orgKnows(verb)) return crew.members.find(function (m) { return m && !m.dead; }) || null;
    for (let i = 0; i < crew.members.length; i++) {
      const m = crew.members[i];
      if (m && !m.dead && crewCan(m, verb)) return m;
    }
    return null;
  }

  /* =========================================================================
     §2  THE RANSOM BLOCK.  "Who pays for this person, and what does it cost?"
     ========================================================================= */

  // ---- 2a. WHO ARE THEIR PEOPLE ------------------------------------------
  // Every source here is a system that was modelling this person's kin BEFORE
  // the grab. Nothing is minted, and a person with nobody genuinely has nobody.
  function livingRelatives(ped) {
    const out = [];
    if (!ped) return out;
    function add(p) { if (p && p !== ped && !p.dead && out.indexOf(p) < 0) out.push(p); }
    add(ped.partner);
    if (Array.isArray(ped.family)) for (let i = 0; i < ped.family.length; i++) add(ped.family[i]);
    // the modelled households (family.js's read-only source of truth)
    const fams = CBZ.cityFamilies;
    if (fams && fams.length) {
      for (let i = 0; i < fams.length; i++) {
        const f = fams[i];
        if (!f || !f.members || f.members.indexOf(ped) < 0) continue;
        for (let j = 0; j < f.members.length; j++) add(f.members[j]);
      }
    }
    return out;
  }
  // The persistent tree answers with SIDs, not bodies. A relative who is only a
  // NAME is still a real relative — familytree.js has been keeping them across
  // saves — and a family that is a phone call is exactly what a ransom is.
  //
  // IT RETURNS THE WHOLE HOUSEHOLD NOW, not the first name it finds. That was
  // never cosmetic: the payer's WEALTH is what a ransom costs, and the one kin
  // this used to return was whoever `spouseOf` happened to answer with. Kidnap
  // a founder's daughter and the person who pays is her FATHER — the identity
  // holding 55% of a listed corporation — and he sat one branch further down.
  function treeKinAll(ped) {
    const T = CBZ.cityFamilyTree, sid = ped && ped._sid;
    const out = [];
    if (!T || !sid) return out;
    function add(s) {
      if (!s || s === sid) return;
      for (let i = 0; i < out.length; i++) if (out[i].sid === s) return;
      const led = CBZ.cityLedgerEntry ? CBZ.cityLedgerEntry(s) : null;
      if (led && led.alive === false) return;              // the dead pay nobody
      out.push({ sid: s, name: (led && (led.name || led.who)) || "next of kin" });
    }
    try { add(T.spouseOf(sid)); } catch (e) {}
    try { const k = T.kidsOf(sid); if (k) for (let i = 0; i < k.length; i++) add(k[i]); } catch (e) {}
    try { const p = T.parentsOf(sid); if (p) for (let i = 0; i < p.length; i++) add(p[i]); } catch (e) {}
    return out;
  }
  // (the old single-kin `treeKin` is DELETED — ransomFor takes the whole
  // household as the payer and uses kin[0] only for the NAME on the card, so a
  // one-relative accessor no longer has a caller and dead code is the thing
  // this repo keeps catching itself in.)
  function gangOf(ped) {
    if (!ped || ped.gang == null) return null;
    return CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
  }
  function firmOf(ped) {
    const CO = CBZ.cityCompanies;
    if (!CO || !ped) return null;
    try {
      // the person's own firm first (a founder is bought back by his own board)
      if (CO.coByOwnerPed) { const own = CO.coByOwnerPed(ped); if (own) return own; }
      const lot = ped._work || ped._workLot || null;
      if (lot && CO.objOfLot) return CO.objOfLot(lot);
    } catch (e) {}
    return null;
  }
  function holdsOffice(ped) {
    if (!ped) return false;
    if (ped.kind === "cop" || ped.copRank || ped.milRank || ped.kind === "soldier") return true;
    if (CBZ.officialdom && CBZ.officialdom.seatOf) {
      try { if (CBZ.officialdom.seatOf(ped)) return true; } catch (e) {}
    }
    return false;
  }

  // ---- 2b. THE NUMBER -----------------------------------------------------
  /* A RANSOM IS WHAT THE PAYER HAS, AND IT LEAVES THEM.

     OWNER (2026-07-29, verbatim): "i hate ransoms and robberies with dumb
     hardcoded limit — imagine what a dumb thing that is to reality".

     He was describing this function. It used to read

         n = 220 + 2400*w + 55*lvl*(0.4 + w);   n *= (1 + 1.6*w*w*w);

     and with w <= 1 and lvl <= 100 that is 220 + 2400 + 7700 = 10320, times
     2.6 = $26,832. THE RICHEST, MOST POWERFUL HUMAN BEING IN THIS WORLD WAS
     WORTH AT MOST $26,800 TO KIDNAP. Worse, the payout went through
     mission.start({reward}) and NOBODY'S BALANCE MOVED — the family that
     "paid" was exactly as rich the second afterwards.

     Now the number is a QUESTION asked of city/take.js: what does the payer
     actually hold, right now, across every balance the simulation already
     keeps for them — pocket, ledger page, household savings in the cohort
     wallets, a gang's war chest, a firm's till, and 55% of a listed
     corporation marked to the live tape. There is no ceiling because reality
     has no ceiling: a shipping heiress's family raises what a shipping
     heiress's family can raise, a dock hand's raises three figures, and the
     phone says which one you are holding.

     AND THEY ARE POORER AFTERWARDS. settle() moves the money out of those same
     balances, so the rich list, the phone, the leaderboards, the vacancy rate
     of the district you drained and the NEXT ransom you try to run on the same
     family all read the hole you left. */

  // WILLINGNESS — what share of everything they have this payer will part
  // with. A RATE, not a lid: multiply it by a bigger balance and you get a
  // bigger number, forever.
  //   wait = the FLOOR on "we are raising it" — a frightened husband is faster
  //          than an underwriter. The illiquid part of the bag adds to it (see
  //          shapeDemand), and that delay is the whole reason holding somebody
  //          for real money is dangerous.
  const PAYER_KIND = {
    family: { frac: 0.45, wait: 55, label: "family" },
    gang: { frac: 0.35, wait: 40, label: "their people" },
    firm: { frac: 0.26, wait: 120, label: "their employer" },
  };

  function takeOn() { return !!(CBZ.cityHolds && CBZ.cityTake && C.TAKE_IS_TRANSFER !== false); }
  function round100(n) { return Math.max(0, Math.round(num(n, 0) / 100) * 100); }
  // what you would get by simply going through their pockets — the DERIVED
  // floor under "is this worth doing at all". Never a constant.
  function pocketWorth(ped) { return Math.max(0, num(ped && ped.cash, 0)); }

  /* THE DEGRADE PATH, kept byte-for-byte as the curve above. It runs when
     city/take.js is absent or TAKE_IS_TRANSFER is off, and every call counts
     against takeAudit().cappedTakes — which is the migration ratchet, pinned
     at 0 and allowed only to fall. */
  function legacyAmount(ped) {
    if (CBZ.cityTakeLegacy) { try { CBZ.cityTakeLegacy("piracy:ransom"); } catch (e) {} }
    const w = clamp(num(ped && ped.wealth, 0.35), 0, 1);
    let lvl = 6;
    if (CBZ.cityTrueLevel) { try { lvl = clamp(CBZ.cityTrueLevel(ped), 1, 100); } catch (e) { lvl = 6; } }
    else if (CBZ.cityLevel) { try { lvl = clamp(CBZ.cityLevel(ped), 1, 100); } catch (e) { lvl = 6; } }
    let n = 220 + 2400 * w + 55 * lvl * (0.4 + w);
    n *= (1 + 1.6 * w * w * w);
    return Math.max(1000, Math.round(n / 100) * 100);
  }

  // Everybody who would raid a savings account for this person: the victim
  // themselves (a household's money is shared, and whatever is in their own
  // pockets goes in the bag), every living relative the sim is running, and
  // every kin the persistent tree remembers by name.
  function familySources(ped) {
    const out = [ped];
    const rel = livingRelatives(ped);
    for (let i = 0; i < rel.length; i++) out.push(rel[i]);
    const kin = treeKinAll(ped);
    for (let i = 0; i < kin.length; i++) out.push({ sid: kin[i].sid });
    return out;
  }

  /* ONE demand, shaped from one source. `frac` of what they hold, rounded to
     the hundred the whole ransom vocabulary already speaks in, plus the wait
     the ILLIQUID half of that bag costs — cityHolds already answered how much
     of it has to be sold rather than counted. */
  function shapeDemand(ped, source, k, legacyMul) {
    if (!takeOn()) {
      const amt = legacyAmount(ped) * (legacyMul == null ? 1 : legacyMul);
      return { amount: round100(amt), wait: k.wait, source: source, purse: null, legacy: true };
    }
    let purse = null;
    try { purse = CBZ.cityHolds(source, { site: "piracy:ransom" }); } catch (e) { purse = null; }
    if (!purse || !purse.depletes) return { amount: 0, wait: k.wait, source: source, purse: purse, legacy: false };
    const secs = CBZ.cityTakeLiquidateSecs ? CBZ.cityTakeLiquidateSecs() : 240;
    return {
      amount: round100(purse.amount * k.frac),
      wait: Math.round(k.wait + (purse.slowShare || 0) * secs),
      source: source, purse: purse, legacy: false,
    };
  }
  // Is this number worth anybody's time? Not a constant — it is measured
  // against what the captor could get by robbing the body in front of them.
  function tooSmall(ped, d) { return !(d.amount > 0) || d.amount < pocketWorth(ped); }

  // THE ONE ANSWER. Never invents a payer; returns kind "state" (refuses),
  // "broke" (they exist and cannot pay) or "none" (nobody is looking) rather
  // than making a number up.
  function ransomFor(ped) {
    if (!ped) return null;
    if (holdsOffice(ped)) {
      return {
        kind: "state", pays: false, amount: 0, name: "the state", who: null, org: null,
        wait: 0, why: "The state does not negotiate. Nobody is coming with a bag.",
      };
    }
    const rel = livingRelatives(ped);
    const kin = treeKinAll(ped);
    if (rel.length || kin.length) {
      const k = PAYER_KIND.family;
      const d = shapeDemand(ped, familySources(ped), k, rel.length ? 1 : 0.85);
      const who = rel.length ? rel[0] : null;
      const name = who ? nameOf(who, "their family") : (kin.length ? kin[0].name : "their family");
      if (tooSmall(ped, d)) {
        return {
          kind: "broke", pays: false, amount: 0, who: who, org: null, name: name,
          source: d.source, wait: 0,
          why: name + " would pay. " + (rel.length || kin.length ? "They have nothing to pay with." : ""),
        };
      }
      return {
        kind: "family", pays: true, who: who, org: null, sid: kin.length ? kin[0].sid : null,
        name: name, amount: d.amount, wait: d.wait, source: d.source, purse: d.purse,
        why: rel.length ? "Their people will find it." : "Somebody out there still answers for them.",
      };
    }
    const gang = gangOf(ped);
    if (gang) {
      const k = PAYER_KIND.gang;
      const d = shapeDemand(ped, gang, k);
      if (tooSmall(ped, d)) {
        return {
          kind: "broke", pays: false, amount: 0, who: null, org: gang.id, name: (gang.name || "the set"),
          source: gang, wait: 0, why: (gang.name || "The set") + " has nothing in the box.",
        };
      }
      return {
        kind: "gang", pays: true, who: null, org: gang.id, name: (gang.name || "the set"),
        amount: d.amount, wait: d.wait, source: d.source, purse: d.purse,
        why: "The set buys its own back. And it remembers who asked.",
      };
    }
    const firm = firmOf(ped);
    if (firm) {
      const k = PAYER_KIND.firm;
      const d = shapeDemand(ped, firm, k);
      if (tooSmall(ped, d)) {
        return {
          kind: "broke", pays: false, amount: 0, who: firm.owner || null, org: null,
          name: (firm.name || "their employer"), source: firm, wait: 0,
          why: (firm.name || "The firm") + " is not going to spend what it does not have.",
        };
      }
      return {
        kind: "firm", pays: true, who: firm.owner || null, org: null, name: (firm.name || "their employer"),
        amount: d.amount, wait: d.wait, source: d.source, purse: d.purse,
        why: "An underwriter will pay. An underwriter will also take its time.",
      };
    }
    return {
      kind: "none", pays: false, amount: 0, who: null, org: null, name: "nobody",
      wait: 0, why: "Nobody is looking for them. There is no number.",
    };
  }

  // ---- 2c. THE LEDGER -----------------------------------------------------
  // ONE list of everybody being held anywhere in the world, in the field names
  // family.js established (ped.kidnapped / captiveOf / ransom / captiveX /
  // captiveZ / captiveT) so every existing reader sees it.
  const holds = [];
  function holdOf(ped) { for (let i = 0; i < holds.length; i++) if (holds[i].ped === ped) return holds[i]; return null; }

  function publish(h) {
    const p = h.ped;
    if (!p) return;
    p.kidnapped = true;
    p.captiveOf = h.orgId || 0;
    p.ransom = h.amount | 0;
    p.captiveX = h.x; p.captiveZ = h.z;
    p.captiveT = Math.max(0, h.t | 0);
  }
  function unpublish(p) {
    if (!p) return;
    p.kidnapped = false; p.captiveOf = 0; p.ransom = 0; p.captiveT = 0;
  }

  /* THE CAPTIVES PANEL, FOR FREE — AND THE ONE SHARP EDGE IN DOING IT.
     captives.js:168 reads `CBZ.cityKidnap || CBZ.activeKidnap`, calls whichever
     it got, and consumes {ped, ransom, t, x, z, gangName}. `activeKidnap` has
     never been defined by anything in this repo — a hook written and never
     plugged in — so we define it, in exactly that shape.

     BUT THE `||` CANNOT REACH IT: family.js exports cityKidnap as a FUNCTION,
     which is always truthy, so the left branch always wins and captives.js gets
     null whenever family.js has no kidnap of its own. So the plug that actually
     works is a WRAP of cityKidnap — this repo's documented pattern (the
     explosion wrappers, killfeed's kill-bus hooks), and it keeps captives.js and
     campaign.js byte-identical.

     TWO GUARDS, both of them the semantics those readers already assume:
       · we surface ONLY a hostage who is genuinely one of yours (the player's
         own household, or your partner). cityKidnap has always meant "one of
         YOURS is taken"; a crew holding a stranger's steward must never appear
         under that name.
       · we stand down entirely while the campaign owns a mission — family.js's
         own kidnap director takes exactly that precaution at the same seam,
         for exactly the reason (campaign.js:980 adopts whatever this returns
         into its BLOOD RELATIVE beat and would drag the body to a lot anchor).
     The record handed back is a fresh snapshot, so a caller that writes x/z/t
     onto it (campaign.js does) cannot reach into our ledger. */
  function ownHostageRecord() {
    if (CBZ.cityCampaignOwnsMission) { try { if (CBZ.cityCampaignOwnsMission()) return null; } catch (e) {} }
    for (let i = 0; i < holds.length; i++) {
      const h = holds[i];
      if (!h.againstPlayer || !h.ped || h.ped.dead || h.byPlayer) continue;
      if (!isPlayerFamily(h.ped) && h.ped !== g.cityPartner) continue;
      return { ped: h.ped, ransom: h.amount, t: h.t, x: h.x, z: h.z, gangName: h.byName, gangId: h.orgId };
    }
    return null;
  }
  CBZ.activeKidnap = ownHostageRecord;
  (function plugCaptivesPanel() {
    const orig = CBZ.cityKidnap;
    if (typeof orig !== "function" || orig._piracyWrapped) return;
    const wrapped = function () {
      let r = null;
      try { r = orig.apply(this, arguments); } catch (e) { r = null; }
      if (r && r.ped) return r;                  // family.js's own is always first
      return ransomOn() ? ownHostageRecord() : null;
    };
    wrapped._piracyWrapped = true;
    for (const k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k]; }
    wrapped._piracyOrig = orig;
    CBZ.cityKidnap = wrapped;
  })();

  // ---- 2d. THE TAKE -------------------------------------------------------
  // THE ZIP TIES ARE RESTRAIN.JS'S. Both directions run the same physical
  // restraint — the polymer wrist loops, the bridge between the hands, the
  // two-bone wrists-behind-the-back solve, the weapon that hits the deck.
  //
  // THE ONE THING THAT DIFFERS is whose crime it is. restrain.js's cuff() used
  // to file cityCrime(50, "kidnapping") against THE PLAYER unconditionally,
  // because until now the player was the only thing in the game that could cuff
  // anybody — so a pirate tying up a steward 400 m offshore put stars on your
  // head. That was fixed AT THE SOURCE at merge (cuff(ped, opts) honours
  // opts.by, and the charge is filed only when by === "player"), so this is now
  // one argument instead of a bounty-suppression workaround. The old
  // three-line hack is deleted; the degrade below is unchanged.
  function bindHands(ped, byPlayer) {
    const R = CBZ.cityRestrain;
    if (!R || !R.cuff) {
      // degrade: no restraint module, the hold is still real, just not tied.
      ped.controlled = true; ped.speed = 0; ped.rage = null;
      if (ped.char) ped.char.handsUp = true;
      return false;
    }
    return !!R.cuff(ped, { by: byPlayer ? "player" : "pirates" });
  }

  function take(ped, opts) {
    opts = opts || {};
    if (!ransomOn() || !ped || ped.dead) return null;
    // CHILDREN ARE NOT TARGETS. childsafe.js seals them against every bus and
    // this never routes around it — a child is not a hostage in this game.
    if (ped.child || protectedActor(ped)) return null;
    if (ped.kind === "cop" || ped.vendor) return null;   // restrain.js refuses these anyway
    const exist = holdOf(ped);
    if (exist) return exist;
    // Somebody else already has them tied up. One person, one hold — a second
    // ledger row over the same restraint is the parallel-bookkeeping trap.
    if (ped.restraint) return null;

    const taker = opts.by || "player";
    const byPlayer = taker === "player";
    const crew = opts.crew || null;
    const pay = ransomFor(ped);
    // DOES THE PLAYER HAVE A STAKE IN THIS ONE? A crew taking a steward off a
    // stranger's trawler five kilometres away is world state, not an event, and
    // HUD doctrine says it gets no phone call, no waypoint and no mission —
    // it is still in the ledger, still on the panel's list, still rescuable if
    // you happen to sail past. A stake is one of three concrete facts:
    // your own household, your partner, or a hull you own or were driving.
    const stake = byPlayer ? false
      : (opts.stake != null ? !!opts.stake
        : (isPlayerFamily(ped) || ped === g.cityPartner || !!(opts.vessel && (opts.vessel.player || opts.vessel.owned))));

    bindHands(ped, byPlayer);
    if (ped.restraint) ped.restraint.by = byPlayer ? "player" : (crew ? crew.id : "crew");

    const px = num(ped.pos && ped.pos.x, 0), pz = num(ped.pos && ped.pos.z, 0);
    const h = {
      ped: ped,
      by: taker, byPlayer: byPlayer, crew: crew,
      byName: crew ? crew.name : (byPlayer ? "you" : "somebody"),
      orgId: crew ? crew.id : 0,
      againstPlayer: stake,
      payer: pay,
      amount: pay && pay.pays ? pay.amount : 0,
      state: pay && pay.pays ? "raising" : (pay && pay.kind === "state" ? "refused" : "worthless"),
      t: opts.limit != null ? +opts.limit : 300,
      wait: pay && pay.pays ? pay.wait : 0,
      x: px, z: pz,
      mission: null, drop: null, paid: 0, closed: false, raised: null,
    };
    // THE CLOCK IS THE RAISE. A bag that has to come out of a share portfolio
    // takes minutes to assemble, and a 300 s deadline would expire before the
    // payer could ever meet it — a big number that is structurally
    // uncollectable is just the old ceiling wearing a hat. Deriving the limit
    // from the wait is also the honest anti-printer: seven figures means
    // MINUTES standing over a body while the whole city looks for you.
    if (pay && pay.pays && opts.limit == null) h.t = Math.max(h.t, Math.round(h.wait * 1.5 + 90));
    holds.push(h);
    publish(h);
    _taken++;

    // EVERYBODY WATCHING DECIDES. Not a private branch — peds.js's one
    // freeze-or-bolt call, feeding the contagious panic field, which is what
    // empties a deck as a WAVE instead of as N independent dice.
    scareAround(px, pz, 24, opts.threat || (crew ? crewFrontman(crew) : player()));

    if (byPlayer) openPlayerDemand(h);
    else openIncomingDemand(h);
    return h;
  }

  function isPlayerFamily(ped) {
    const fams = CBZ.cityFamilies;
    if (!fams || !fams.length || !ped) return false;
    for (let i = 0; i < fams.length; i++) {
      const f = fams[i];
      if (!f || f.gangId || !f.members) continue;      // gangId 0/falsy = the player's
      if (f.members.indexOf(ped) >= 0) return true;
    }
    return false;
  }

  function scareAround(x, z, r, threat) {
    if (!CBZ.cityScare) return;
    const P = peds(), r2 = r * r;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a || a.dead || a.restraint || a.isPlayer || !a.pos) continue;
      if (d2(a.pos.x, a.pos.z, x, z) > r2) continue;
      try { CBZ.cityScare(a, threat || null, { seat: !!a._npcAttached }); } catch (e) {}
    }
    if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(x, z, 1); } catch (e) {} }
  }

  // ---- 2e. THE DEMAND, PLAYER SIDE ---------------------------------------
  // The player has somebody tied up. core/mission.js owns EVERYTHING that
  // follows: the tracked legs, the map waypoint, the world beacon, the phone
  // card, the HUD distance line and the actual money.
  function dropPoint(x, z) {
    // A real place the world built, never a spawned marker: a registered berth
    // (marina.js's own registry) or a lot with a real door. WHICHEVER IS NEARER
    // — a street kidnap must not send you 2 km to a pontoon because the berth
    // registry happened to answer first.
    let best = null, bd = Infinity;
    if (CBZ.cityBerth && CBZ.cityBerth.nearestBerth) {
      const b = CBZ.cityBerth.nearestBerth(x, z, 3000);
      if (b) { bd = d2(b.x, b.z, x, z); best = { x: b.x, z: b.z, name: b.label || "the water's edge" }; }
    }
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.lots && A.lots.length) {
      for (let i = 0; i < A.lots.length; i++) {
        const L = A.lots[i];
        const dr = L && L.building && L.building.door;
        if (!dr) continue;
        const d = d2(dr.x, dr.z, x, z);
        if (d < bd) { bd = d; best = { x: dr.x, z: dr.z, name: (L.name || "the drop") }; }
      }
    }
    return best;
  }

  function openPlayerDemand(h) {
    const p = h.payer;
    const who = nameOf(h.ped, "them");
    if (!p || !p.pays) {
      // NO FICTION, AND THE REFUSAL NAMES ITSELF. There are three different
      // ways to be worth nothing and the player is owed the difference: the
      // state will not deal, or somebody would pay and cannot, or nobody is
      // looking. A silent clamp to a floor said none of them.
      phone(p && p.kind === "state"
        ? who + " is on the state's books. Nobody is coming with a bag — but somebody is coming."
        : (p && p.kind === "broke"
          ? (p.why || (p.name + " has nothing.")) + " There is no number to ask for."
          : "Nobody's asking after " + who + ". There's no number here."),
        "THE WIRE", 5.5);
      if (p && p.kind === "state") heatUpFor(h);
      return;
    }
    const drop = dropPoint(h.x, h.z);
    if (!drop) {
      phone("No place to make a handover. Get them somewhere a car can reach.", "THE WIRE", 4.5);
      return;
    }
    h.drop = drop;
    const M = CBZ.mission;
    if (!M || !M.start) return;
    // WHERE THE MONEY IS COMING FROM is worth one clause, because it is the
    // whole reason a big number takes long enough to get you caught: cash in a
    // safe is a phone call, a block of stock is a fire sale.
    const slowNote = (p.purse && p.purse.slow > p.purse.liquid)
      ? " Most of it isn't cash — they're selling to raise it, and that takes time."
      : "";
    h.mission = M.start({
      id: "ransom:" + (h.ped._sid || Math.round(h.x) + ":" + Math.round(h.z)),
      title: "Ransom " + who,
      brief: "You have " + who + " tied up. " + p.name + " is raising " + money(h.amount) +
        "." + slowNote + " Keep them alive and breathing while it's counted, then take the handover at " + drop.name + ".",
      color: 0x2fae8a,
      reward: { cash: h.amount, respect: 2 },
      stages: [
        { id: "hold", goal: "timer", seconds: p.wait,
          text: "Keep " + who + " alive while " + p.name + " raises " + money(h.amount),
          label: "HOLD" },
        { id: "drop", goal: "reach", at: [drop.x, drop.z], radius: 8,
          text: "Take the handover at " + drop.name, label: "HANDOVER" },
      ],
      onComplete: function (m, paid) { settle(h, paid); },
    });
    phone(p.name + " will pay " + money(h.amount) + " for " + who + ". Don't get greedy and don't get clever.",
      "THE WIRE", 6);
  }

  // ---- 2f. THE DEMAND, VICTIM SIDE ---------------------------------------
  // A crew has taken somebody who is YOURS (your own family, or anybody aboard
  // a hull you own or are driving). This is the seat that makes owning a boat
  // — or a household — mean something.
  function openIncomingDemand(h) {
    const who = nameOf(h.ped, "one of your people");
    const crew = h.crew;
    const broker = crew ? crewHolder(crew, "ransom") : null;
    // No stake -> no call, no waypoint, no card. The hold is real and it is on
    // the ledger; it simply is not addressed to you.
    if (!h.againstPlayer) { h.state = (h.payer && h.payer.pays && broker) ? "demanded" : "nonumber"; return; }
    if (!h.payer || !h.payer.pays || !broker) {
      // NOBODY ON THE BOAT MAY NAME A PRICE. Kill the Broker and this is what
      // you get: they take what they can carry and go. It is not a softer
      // outcome, it is a different one.
      h.state = "nonumber";
      h.t = Math.min(h.t, 90);
      phone("They're not asking for money. They're just going.", crew ? crew.name.toUpperCase() : "UNKNOWN", 5);
      return;
    }
    h.state = "demanded";
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) {
      try { CBZ.fullMap.setWaypoint(h.x, h.z, "THEY HAVE " + String(who).toUpperCase()); } catch (e) {}
    }
    phone("We have " + who + ". " + money(h.amount) + ". Come alone, come by water, and come before the clock.",
      crew ? crew.name.toUpperCase() : "UNKNOWN NUMBER", 7);
    feed(crew ? (crew.name + " took " + who + ". They want " + money(h.amount) + ".") : (who + " has been taken."), "#ff9d6b");
    say(broker, money(h.amount) + ". That's the number.");
  }

  // ---- 2g. WHAT THE MONEY COSTS ------------------------------------------
  // The mission block has already put the cash in your hand. This is the part
  // that decides whether you keep it — and it is the CHAIN the owner asked for.
  /* THE MONEY LEAVES SOMEBODY. Called the instant the payer finishes raising
     (tickHolds flips "raising" -> "counted"), which is the moment a real bag
     physically exists: from here on the handover just delivers it.

     THE ORDER MATTERS AND IT IS THE WHOLE ANTI-MINT. core/mission.js pays
     def.reward.cash through walletGive BEFORE onComplete runs, so if we took
     the money afterwards and the payer came up short, the difference would
     have been created out of nothing. Instead we take FIRST and then RE-PIN
     def.reward.cash to exactly what moved — the mission block still owns the
     card, the HUD line, the waypoint and the payout; it just pays a number
     that a real balance is now missing. */
  function collectRansom(h) {
    if (h.raised != null) return h.raised;
    const p = h.payer;
    if (!p || !p.pays) { h.raised = 0; return 0; }
    if (!(CBZ.cityTake && C.TAKE_IS_TRANSFER !== false) || !p.source) {
      // DEGRADE: no take block. The old fiction runs (the mission mints it) and
      // says so through the ratchet, which may only ever fall.
      if (CBZ.cityTakeLegacy) { try { CBZ.cityTakeLegacy("piracy:settle"); } catch (e) {} }
      h.raised = h.amount;
      return h.raised;
    }
    let res = null;
    try { res = CBZ.cityTake(p.source, { max: h.amount, by: "player", site: "piracy:ransom" }); } catch (e) { res = null; }
    const got = res ? Math.max(0, Math.round(res.taken)) : 0;
    h.raised = got;
    h.emptied = !!(res && res.emptied);
    // HOLD THE HANDLE. The bag exists but it is not yours yet; if you never
    // turn up for the handover, release() puts every dollar back into the exact
    // balances it came out of. Money you did not collect must not vanish from
    // the world — that would make abandoning hostages a way to grind a
    // district's wallets to zero.
    h.takeRes = res;
    // RE-PIN THE REWARD to what actually left them. The def object is what
    // mission.js reads at completion, so this is the payout.
    if (h.mission && h.mission.def && h.mission.def.reward && typeof h.mission.def.reward === "object") {
      h.mission.def.reward.cash = got;
    }
    if (got <= 0) {
      phone(p.name + " couldn't raise a cent. There is no bag.", "THE WIRE", 5);
    } else if (got < h.amount * 0.995) {
      // 0.5% — a bag can land a few dollars short because the last thing sold
      // was an indivisible whole share, and that is not a story beat.
      phone("The bag is light — " + money(got) + ". That is everything " + p.name + " had.", "THE WIRE", 5);
    }
    h.amount = got;
    return got;
  }

  function settle(h, paid) {
    if (h.closed) return;
    h.closed = true;
    h.takeRes = null;             // collected for real — nothing to hand back
    // The money already left a real balance in collectRansom(); the mission
    // block then paid exactly that figure. Use ITS report, never our own copy,
    // or the cut below could be taken against a number nobody got.
    const got = Math.max(0, Math.round(num(paid && paid.cash, h.raised != null ? h.raised : h.amount)));
    h.paid = got;
    _paid++;
    _paidCash += got;

    const F = CBZ.factions;
    let fenced = false;

    // (1) YOUR OWN CREW MOVES IT. A ransom is a bag of marked notes; somebody
    //     with a channel takes a cut for making it spendable. The cut leaves
    //     your wallet through factions.js's own charge() and lands as real
    //     contribution credit on a real ladder — no second economy.
    if (F && F.orgIn) {
      // "may the PLAYER fence" is a rung question and it is asked the one
      // sanctioned way: the lowest rung that grants the verb, against the
      // player's own tier. rankCan takes an ACTOR and there is no actor here.
      const myTier = (F.tier ? F.tier(ORG) : -1);
      const need = (F.verbTier ? F.verbTier(ORG, "fence") : -1);
      const crewFence = myTier >= 0 && (need < 0 || myTier >= need);
      const set = F.orgIn("gang");
      if (crewFence) {
        const cut = Math.round(got * 0.30);
        if (F.charge && F.charge(ORG, cut, "Crew's share")) { fenced = true; _cuts++; }
      } else if (set != null) {
        const cut = Math.round(got * 0.22);
        if (F.charge && F.charge("gang", cut, "The set moves the money")) { fenced = true; _cuts++; }
      }
    }

    // (2) NOBODY MOVED IT -> the money is hot, and the payment itself is the
    //     evidence. wanted.js already models extortion; this is that crime,
    //     fired by the thing that actually caused it.
    //
    //     AND THE HEAT NOW SCALES WITH THE NUMBER, which is the fourth honest
    //     limiter on an uncapped ransom (the others are that the balance is
    //     finite, that a big raise takes minutes, and that liquidation is loud):
    //     a $2,000 bag is a police report and a seven-figure one is a manhunt.
    //     Logarithmic, so it grows forever without ever being a step function —
    //     and wanted.js, not this file, decides what a star costs.
    if (!fenced) {
      const heat = Math.round(55 * (1 + Math.log10(1 + Math.max(0, got) / 5000)));
      if (CBZ.cityCrime) { try { CBZ.cityCrime(heat, { type: "extortion", x: h.x, z: h.z }); } catch (e) {} }
      phone("That money's got a serial on it. Somebody's going to come asking.", "THE WIRE", 4.5);
      _hot++;
    }

    // (3) THE PAYER REMEMBERS. A set that bought its own man back knows your
    //     face — that is the vendetta this file buys instead of inventing one.
    const p = h.payer;
    if (p && p.kind === "gang" && p.org != null && CBZ.cityGangProvoke) {
      try { CBZ.cityGangProvoke(p.org, 45); } catch (e) {}
      feed((p.name || "They") + " paid. They also wrote your name down.", "#ff9d6b");
    }
    if (p && p.kind === "family" && p.who && CBZ.cityRelShift) {
      try { CBZ.cityRelShift(p.who, "extorted", 2); } catch (e) {}
    }

    release(h.ped, "paid");
  }

  // A hostage nobody will pay for and who is worth taking anyway: the state's
  // answer is a manhunt, through the systems that already own one.
  function heatUpFor(h) {
    if (CBZ.cityCrime) { try { CBZ.cityCrime(140, { type: "kidnapping", x: h.x, z: h.z, instant: true }); } catch (e) {} }
  }

  // ---- 2h. RELEASE / DEATH ------------------------------------------------
  function release(ped, why) {
    const h = holdOf(ped);
    if (!h) return false;
    const i = holds.indexOf(h); if (i >= 0) holds.splice(i, 1);
    // THE BAG GOES BACK unless you actually took it. A payer who raised the
    // money and then watched nobody arrive keeps it — the alternative is that
    // every abandoned hold silently deletes real money from the city.
    if (why !== "paid" && h.takeRes && h.takeRes.refund) {
      try { h.takeRes.refund(); } catch (e) {}
      h.takeRes = null; h.raised = null;
    }
    unpublish(ped);
    if (CBZ.cityRestrain && CBZ.cityRestrain.release) { try { CBZ.cityRestrain.release(ped); } catch (e) {} }
    if (ped && !ped.dead) {
      ped.controlled = false;
      ped.fear = Math.max(ped.fear || 0, 9);
      ped.alarmed = Math.max(ped.alarmed || 0, 6);
      ped.state = "flee";
      if (CBZ.cityPanicRaise && ped.pos) { try { CBZ.cityPanicRaise(ped.pos.x, ped.pos.z, 0.7); } catch (e) {} }
    }
    if (h.mission && h.mission.alive && h.mission.alive() && why !== "paid") { try { h.mission.fail(why || "lost"); } catch (e) {} }
    // The RESCUE job is only "done" if you actually took them back. Paying the
    // number, or losing them, retires the handle — it never pays twice and it
    // never files a false FAILED card for a hostage who walked home.
    if (h.rescue && h.rescue.alive && h.rescue.alive()) {
      try {
        if (why === "rescued") h.rescue.complete();
        else if (why === "executed" || why === "dead") h.rescue.fail(why);
        else if (h.rescue.retire) h.rescue.retire(why || "closed");
        else h.rescue.cancel(why || "closed");
      } catch (e) {}
    }
    if (h.againstPlayer && CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
    if (why === "paid") feed(nameOf(ped, "They") + " walks. The number is a memory now.", "#7fe0a0");
    else if (why === "rescued") feed("You took " + nameOf(ped, "them") + " back the hard way.", "#7fe0a0");
    return true;
  }

  // The clock ran out, or somebody with the rank made the call. A hostage
  // death is a DEATH — it goes through the one bus like every other one.
  function executeHostage(h, byWhom) {
    const ped = h.ped;
    if (!ped || ped.dead) { release(ped, "dead"); return; }
    const from = byWhom && byWhom.pos ? byWhom.pos : { x: h.x + 1, z: h.z };
    if (CBZ.cityKillPed) {
      try { CBZ.cityKillPed(ped, { fromX: from.x, fromZ: from.z, force: 4, fling: 1, byPlayer: false }, "executed"); } catch (e) {}
    } else if (CBZ.cityLogDeath) {
      try { CBZ.cityLogDeath(nameOf(ped, "A hostage"), "executed", { by: byWhom ? nameOf(byWhom, "a pirate") : null }); } catch (e) {}
      ped.dead = true;
    }
    _executed++;
    release(ped, "executed");
  }

  // ---- 2i. THE TICK -------------------------------------------------------
  function tickHolds(dt) {
    for (let i = holds.length - 1; i >= 0; i--) {
      const h = holds[i];
      const ped = h.ped;
      if (!ped || ped.dead) { release(ped, "dead"); continue; }
      if (ped.pos) { h.x = ped.pos.x; h.z = ped.pos.z; }
      h.t -= dt;
      publish(h);

      // A held body that somebody CUT LOOSE (restrain.js's own release verb,
      // or a rescuer who walked up and freed them) leaves the ledger — the
      // restraint record is the source of truth, never a private copy.
      if (!ped.restraint && !h.byPlayer && h.state !== "worthless") { release(ped, "rescued"); continue; }

      if (h.againstPlayer) {
        // EVERY CAPTOR DEAD IS A RESCUE. The crew IS the hold.
        const crew = h.crew;
        if (crew && !crewAlive(crew)) { release(ped, "rescued"); continue; }
        // THE PLAYER PAYS AT THE BOAT. No modal, no menu: stand where they are
        // with the money, and press the key the whole game already uses.
        const P = player();
        if (P && !P.dead && h.state === "demanded" && dist(P.pos.x, P.pos.z, h.x, h.z) < 9) {
          if ((g.cash || 0) >= h.amount) {
            if (CBZ.city && CBZ.city.note) CBZ.city.note("[E] Pay " + money(h.amount) + " for " + nameOf(ped, "them"), 1.3);
            if (CBZ.keys && (CBZ.keys.e || CBZ.keys.E)) {
              // THE SAME LAW POINTED AT YOU. Paying is a take out of the
              // player's own balance and it goes through the one block, so the
              // ratchet sees both directions of every ransom in the game.
              let paidOut = false;
              if (CBZ.cityTake && C.TAKE_IS_TRANSFER !== false) {
                let r = null;
                try { r = CBZ.cityTake("player", { max: h.amount, site: "piracy:pay", by: "player" }); } catch (e) { r = null; }
                paidOut = !!(r && r.taken >= h.amount);
              } else if (CBZ.city && CBZ.city.spend) {
                if (CBZ.cityTakeLegacy) { try { CBZ.cityTakeLegacy("piracy:pay"); } catch (e) {} }
                paidOut = !!CBZ.city.spend(h.amount);
              }
              if (paidOut) {
                _paidByPlayer++;
                if (crew) standDown(crew, "paid");
                release(ped, "paid");
                continue;
              }
            }
          } else if (CBZ.city && CBZ.city.note) {
            CBZ.city.note("No " + money(h.amount) + ", no deal.", 1.3, { from: h.byName ? h.byName.toUpperCase() : "UNKNOWN NUMBER" });
          }
        }
        if (h.t <= 0) {
          // THE ORDER NEEDS SOMEBODY ALIVE TO GIVE IT. No Captain aboard, no
          // execution — the crew simply cuts them loose and runs. That is what
          // killing the brass actually buys you.
          const cap = h.crew ? crewHolder(h.crew, "execute") : null;
          if (cap) executeHostage(h, cap);
          else { phone("Nobody aboard would give the order. They put " + nameOf(ped, "them") + " over the side alive.", h.byName ? h.byName.toUpperCase() : "UNKNOWN", 5); release(ped, "released"); }
        }
        continue;
      }

      // The player is holding them. The clock is the payer's patience.
      if (h.state === "raising") {
        h.wait -= dt;
        if (h.wait <= 0) {
          h.state = "counted";
          // THE BAG EXISTS NOW, and somebody is poorer for it.
          const got = collectRansom(h);
          if (got <= 0) {
            // A payer who genuinely cannot pay is not a softer outcome, it is a
            // different one: the job dies here and you are still holding a
            // person nobody is coming for.
            if (h.mission && h.mission.alive && h.mission.alive()) { try { h.mission.fail("nobody could pay"); } catch (e) {} }
            h.state = "worthless";
            release(ped, "unpaid");
            continue;
          }
        }
      }
      if (h.t <= 0) {
        phone("You held too long. They stopped answering.", "THE WIRE", 4.5);
        release(ped, "expired");
      }
    }
  }

  /* THE LEGACY PAYOUT DIES HERE.
     social.js:717 is fenced (another agent owns that file this wave), and it
     does not need to change: the entire fiction is inside cityReleaseHostage,
     which is a global. Wrapping it is this repo's documented pattern (the
     explosion wrappers, killfeed's kill-bus hooks) and it is a genuine
     MIGRATION rather than a parallel path — the old function is still what
     runs when the flag is off, and the "let them walk" branch is untouched
     because letting somebody go was never the lie. */
  (function replaceLegacyRansom() {
    const orig = CBZ.cityReleaseHostage;
    if (typeof orig !== "function" || orig._ransomWrapped) return;
    const wrapped = function (ransom) {
      if (!ransom || C.RANSOM_REPLACE_LEGACY === false || !ransomOn()) return orig.apply(this, arguments);
      const ped = g.cityHostage;
      if (!ped) return orig.apply(this, arguments);
      const pay = ransomFor(ped);
      if (!pay || !pay.pays) {
        // WORTH NOTHING IS A REAL ANSWER. The old code paid $200-$1,000 for a
        // person nobody in the world was looking for; this says so instead.
        g.cityHostage = null; ped.hostage = false; ped.controlled = false;
        ped.alarmed = 8; ped.fear = 10;
        phone(pay && pay.kind === "state"
          ? "You're holding somebody the state won't buy. Put them down and run."
          : (pay && pay.kind === "broke"
            ? (pay.why || (pay.name + " has nothing.")) + " There is no number."
            : "Nobody's asking after " + nameOf(ped, "them") + ". There's no number."), "THE WIRE", 4.5);
        if (pay && pay.kind === "state") { if (CBZ.cityCrime) { try { CBZ.cityCrime(140, { type: "kidnapping", instant: true }); } catch (e) {} } }
        return;
      }
      // A real demand, on the real ladder, with the real chain behind it.
      g.cityHostage = null; ped.hostage = false;
      const h = take(ped, { by: "player" });
      if (!h) return orig.apply(this, arguments);
      return;
    };
    wrapped._ransomWrapped = true;
    // carry every marker forward (CLAUDE.md's wrapper law)
    for (const k in orig) { if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k]; }
    wrapped._ransomOrig = orig;
    CBZ.cityReleaseHostage = wrapped;
  })();

  /* =========================================================================
     §3  THE SKIFF — a ROW in the marine fleet, not a second boat file.
     ========================================================================= */
  // Research numbers for a Somali attack skiff, which is the whole design:
  // a 7-8 m open fibreglass/timber hull, twin outboards, no cabin, no radar,
  // no armour, a plastic drum of fuel and a boarding pole. It is fast and it is
  // nothing else. The yacht it chases is 34 m and does 16 kn, and THAT is the
  // encounter: something small and quick that you cannot outrun in a big boat.
  const SKIFF_KEY = "skiff";
  function registerSkiff() {
    if (C.PIRACY_SKIFF_HULL === false) return false;
    const MH = CBZ.marineHulls;
    if (!MH || !MH.register || MH.get(SKIFF_KEY)) return false;
    MH.register(SKIFF_KEY, {
      label: "Open Skiff", marque: "—", model: "Open Skiff",
      price: 3200,
      build: buildSkiff,
      hull: {
        loa: 7.6, beam: 2.2, draft: 0.45, massT: 1.3,
        topKts: 26, cruiseKts: 18, planeKts: 9, canPlane: true,
        accel0: 3.9, humpFrac: 0.50,
        steerKind: "thrust", steerLock: 0.60, steerRate: 7.0,
        yawRate: 1.95, yawAccel: 5.6, yawDamp: 2.8, pivotAft: 1.9,
        swayL: 2.4, swayQ: 0.38,
        trimRestDeg: 2.2, trimHumpDeg: 7.6, trimPlaneDeg: 3.2,
        heelSign: -1, heelGain: 0.026, maxHeel: 0.24,
        rideAbove: 0.06, waveGain: 1.0, slamV: 3.0,
        deckY: 0.30, boardY: 0.42, sternOffset: 3.6,
        wakeScale: 0.75, audio: "bike",
      },
      feel: { accel: 1.15, top: 0.7, turn: 1.35, drift: 1.45, roll: 0.85 },
    });
    if (MH.pushEconomy) { try { MH.pushEconomy(); } catch (e) {} }
    return true;
  }

  // Drawn through the FLEET'S OWN KIT (water_hulls.js published it precisely so
  // a new hull is a row and not file #567 of raw material construction). The
  // dinghy is the base — it IS an open tender — and the pirate kit is four
  // boxes on top: a second outboard, a lashed fuel drum, a boarding pole and a
  // strake of bare timber where the gelcoat has gone.
  function buildSkiff() {
    const MH = CBZ.marineHulls;
    const K = MH && MH.kit;
    if (!MH || !K) return null;
    let root = null;
    try { root = MH.build("dinghy"); } catch (e) { root = null; }
    if (!root) return null;
    const T = K.THREE;
    // Stretch the tender into a 7.6 m open boat rather than draw a second hull:
    // one scale on the merged group, so the draw-call budget is the dinghy's.
    root.scale.set(1.08, 1.02, 1.69);
    const kit = new T.Group();
    kit.name = "skiff_kit";
    const grimy = K.roleMat("pir-timber", "plastic", 0x6b5334);
    const drum = K.roleMat("pir-drum", "plastic", 0x2f6f45);
    const steel = K.roleMat("pir-steel", "metal", 0x59616b);
    // second outboard, outboard of the first, canted the way a lashed-on
    // spare always is
    K.addBox(kit, 0.34, 0.62, 0.44, 0.42, 0.34, -3.45, steel);
    K.addBox(kit, 0.16, 0.5, 0.16, 0.42, -0.05, -3.6, steel);
    // fuel drums amidships — the whole reason the boat has any range at all
    // (addCyl's signature is (root, r, h, x, y, z, mat) — one radius, not two)
    K.addCyl(kit, 0.28, 0.86, -0.5, 0.42, -0.4, drum);
    K.addCyl(kit, 0.28, 0.86, -0.5, 0.42, 0.55, drum);
    // the boarding pole, lying along the port gunwale
    K.addBox(kit, 0.07, 0.07, 4.6, 0.78, 0.5, 0.6, grimy);
    // bare timber patch where the paint has gone
    K.addBox(kit, 0.06, 0.28, 2.1, -0.88, 0.24, 0.2, grimy);
    try { K.mergeByMaterial(kit); } catch (e) {}
    // A WRAPPER, AND IT IS NOT COSMETIC. marineHulls.build() clones with
    // clone(true), which copies userData BY REFERENCE (its own comment says so)
    // — so writing vehicleDims onto the dinghy clone would silently retag every
    // Calanque Tender in the world as 7.6 m. The skiff gets its own root.
    const hull = new T.Group();
    hull.add(root);
    hull.add(kit);
    hull.userData.vehicleDims = { width: 2.2, length: 7.6, height: 1.5, wheelbase: 4.0 };
    return hull;
  }

  // A REAL VEHICLE OR IT IS SCENERY. Registered through cityRegisterVehicle so
  // it is enterable, drivable, damageable, shootable and STEALABLE — taking a
  // pirate's boat off him is one of the better things in this feature.
  function spawnSkiff(x, z, heading, crew) {
    if (!CBZ.cityRegisterVehicle || !CBZ.marineHulls) return null;
    let grp = null;
    try { grp = CBZ.marineHulls.build(SKIFF_KEY); } catch (e) { grp = null; }
    if (!grp) return null;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root) return null;
    grp.position.set(x, seaY(x, z), z);
    grp.rotation.y = heading || 0;
    grp.userData.dynamic = true;
    A.root.add(grp);
    let car = null;
    try {
      car = CBZ.cityRegisterVehicle(grp, {
        body: "boat", style: SKIFF_KEY, persist: true, heading: heading || 0,
        color: 0x8a9aa6,
        model: { name: "Open Skiff", value: 3200, rarity: 0.02, body: "boat", detailStyle: SKIFF_KEY },
        dims: { width: 2.2, length: 7.6, height: 1.5, wheelbase: 4.0 },
      });
    } catch (e) { car = null; }
    if (!car) { if (grp.parent) grp.parent.remove(grp); return null; }
    // Make isMarineHull / specFor resolve to OUR row rather than a name regex.
    car.detailStyle = SKIFF_KEY;
    const feel = CBZ.marineHulls.feel ? CBZ.marineHulls.feel(SKIFF_KEY) : null;
    if (feel) car._playerCarFeel = feel;
    if (CBZ.marineHulls.specFor) { try { CBZ.marineHulls.specFor(car); } catch (e) {} }
    car._pirateBoat = crew ? crew.id : true;
    car._pirArena = A.root;
    car.ai = false; car.v = 0;
    return car;
  }

  /* =========================================================================
     §4  THE HELMSMAN — CBZ.marineAutopilot(car, dt, cmd)
     -------------------------------------------------------------------------
     A HAND ON THE WHEEL, NOT A SECOND PHYSICS MODEL. Every number it uses is
     read out of the hull's own marineHulls spec, and every field it writes is
     one water_buoyancy.js (order 38.5) and waterWakeFor already consume, so a
     boat under autopilot rides the same swell and throws the same wake as one
     under your hands.

       cmd = { x, z, speed, arrive, stop }   ->  distance to the mark, or -1

     Degrade-safe by construction: no spec, no water, or the player at the helm
     and it returns -1 having touched nothing.
     ========================================================================= */
  CBZ.marineAutopilot = function (car, dt, cmd) {
    if (C.MARINE_AUTOPILOT === false) return -1;
    if (!car || !car.pos || !car.group || car.dead || car.player) return -1;
    if (!CBZ.isMarineHull || !CBZ.isMarineHull(car)) return -1;
    const S = (CBZ.marineHulls && CBZ.marineHulls.specFor) ? CBZ.marineHulls.specFor(car) : car._hullSpec;
    if (!S) return -1;
    if (!waterAt(car.pos.x, car.pos.z)) return -1;
    dt = Math.min(num(dt, 0.016), 0.05);
    cmd = cmd || {};

    const tx = num(cmd.x, car.pos.x), tz = num(cmd.z, car.pos.z);
    const dx = tx - car.pos.x, dz = tz - car.pos.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    const arrive = num(cmd.arrive, 6);

    // ---- heading, through the hull's own inertia -------------------------
    let h = num(car.heading, 0);
    const want = Math.atan2(dx, dz);
    let err = want - h;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    // ---- surge: the spec's thrust against the spec's drag ----------------
    let u = num(car.v, 0);
    const spd = Math.abs(u);
    let vTarget = num(cmd.speed, S.cruiseMs);
    if (cmd.stop || d < arrive) vTarget = 0;
    // A boat cannot turn hard and go fast; ease off in a real turn the way a
    // coxswain does, which is also what keeps the intercept curve believable.
    vTarget *= (1 - 0.45 * Math.min(1, Math.abs(err) / 1.2));
    vTarget = clamp(vTarget, 0, S.topMs);

    // Steering authority is the SPEC'S OWN LAW (thrust-vectored outboards have
    // almost none at zero throttle; rudders build it with v^2) — copied in
    // behaviour, never re-tuned.
    const plane = num(car._planing, 0);
    const throttle = (vTarget > spd + 0.15) ? 1 : (vTarget < spd - 0.6 ? -0.4 : 0.25);
    let authority;
    if (S.steerKind === "thrust") authority = Math.min(1, Math.abs(throttle) + 0.10 * Math.min(1, spd / 6));
    else { const sn = spd / Math.max(0.5, S.topMs * 0.55); authority = Math.min(1, sn * sn + (throttle > 0 ? 0.12 : 0)); }

    const yawWant = clamp(err * 1.6, -1, 1) * S.yawRate * authority;
    let yawRate = num(car._yawRate, 0);
    const step = S.yawAccel * dt;
    yawRate += clamp(yawWant - yawRate, -step, step);
    if (Math.abs(err) < 0.03) yawRate *= Math.max(0, 1 - S.yawDamp * dt);
    car._yawRate = yawRate;
    const dTheta = yawRate * dt;
    h += dTheta;
    car.heading = h;

    // drag law, verbatim in shape from water_helm.js's dragAt()
    const G = 9.81;
    const a0 = Math.abs(u);
    let drag = 0;
    if (a0 > 1e-4) {
      const fn = a0 / Math.sqrt(G * S.Lwl);
      const t = (fn - 0.5) / 0.15;
      const wf = (t > 5 || t < -5) ? 0 : Math.exp(-t * t);
      drag = S.dragL * a0 + S.dragQ * a0 * a0 * (1 - 0.55 * plane) + S.waveK * a0 * a0 * wf;
    }
    const acc = (throttle > 0 ? S.thrust : (throttle < 0 ? -S.thrust * 0.42 : 0));
    const opp = u > 0.02 ? -1 : (u < -0.02 ? 1 : 0);
    const uPrev = u;
    u += (acc + opp * drag) * dt;
    if (acc === 0 && opp !== 0 && u * uPrev < 0) u = 0;
    u = clamp(u, -S.reverseMs, S.topMs);

    // planing + trim, so the bow rises and drops exactly as the helm does it
    let planeTarget = 0;
    if (S.canPlane && S.planeMs > 0.1) planeTarget = clamp((Math.abs(u) - S.planeMs * 0.75) / (S.planeMs * 0.85), 0, 1);
    car._planing = plane + (planeTarget - plane) * Math.min(1, dt * 2.2);
    const fnNow = Math.abs(u) / Math.sqrt(G * S.Lwl);
    let trim = S.trimRest;
    if (fnNow > 0.18 && fnNow < 0.5) trim = S.trimRest + (S.trimHump - S.trimRest) * ((fnNow - 0.18) / 0.32);
    else if (fnNow >= 0.5 && fnNow < 1.05) trim = S.trimHump + (S.trimPlane - S.trimHump) * ((fnNow - 0.5) / 0.55);
    else if (fnNow >= 1.05) trim = S.trimPlane;
    car._trim = num(car._trim, S.trimRest) + (trim - num(car._trim, S.trimRest)) * Math.min(1, dt * 2.6);
    car._pitch = -car._trim;
    const heelWant = clamp(S.heelSign * yawRate * Math.abs(u) * S.heelGain, -S.maxHeel, S.maxHeel);
    car._roll = num(car._roll, 0) + (heelWant - num(car._roll, 0)) * Math.min(1, dt * 3.0);

    const fx = Math.sin(h), fz = Math.cos(h);
    car.v = u;
    car.vx = fx * u; car.vz = fz * u;
    car.pos.x += car.vx * dt;
    car.pos.z += car.vz * dt;
    car._steerInput = clamp(err, -1, 1);

    // A hull that has been steered onto rock or sand hands itself back rather
    // than grinding across a beach.
    if (!waterAt(car.pos.x, car.pos.z)) {
      car.pos.x -= car.vx * dt; car.pos.z -= car.vz * dt;
      car.v = u * 0.2; car.vx = fx * car.v; car.vz = fz * car.v;
    }

    const rideY = seaY(car.pos.x, car.pos.z) + S.rideAbove * (1 - 0.55 * car._planing);
    car.group.position.set(car.pos.x, rideY, car.pos.z);
    car.group.rotation.set(car._pitch || 0, h, car._roll || 0);
    if (CBZ.waterWakeFor) { try { CBZ.waterWakeFor(car, dt); } catch (e) {} }
    return d;
  };

  /* =========================================================================
     §5  THE CREW — a pyramid on an open boat.
     ========================================================================= */
  const crews = [];
  let anchorage = null;
  let arenaRef = null;

  function crewAlive(cr) {
    for (let i = 0; i < cr.members.length; i++) { const m = cr.members[i]; if (m && !m.dead) return true; }
    return false;
  }
  function crewFrontman(cr) {
    return crewHolder(cr, "boarding") || crewHolder(cr, "board") ||
      cr.members.find(function (m) { return m && !m.dead; }) || null;
  }
  function nearestCrew(r) {
    const P = player();
    if (!P) return null;
    let best = null, bd = (r || 1e9) * (r || 1e9);
    for (let i = 0; i < crews.length; i++) {
      const cr = crews[i];
      if (!crewAlive(cr)) continue;
      const b = cr.boats[0];
      const x = b ? b.pos.x : cr.home.x, z = b ? b.pos.z : cr.home.z;
      const d = d2(x, z, P.pos.x, P.pos.z);
      if (d < bd) { bd = d; best = cr; }
    }
    return best;
  }

  // WHERE THEY COME FROM. A deterministic sweep for the piece of open water
  // furthest from anything the world calls a place — pirates do not berth at
  // the marina. Runs once per arena; no rng, so every client agrees.
  function findAnchorage() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return null;
    const R = 3200, STEP = Math.PI / 12;
    let best = null, bestScore = -1;
    for (let ring = 1; ring <= 3; ring++) {
      const rad = R * (0.55 + ring * 0.22);
      for (let a = 0; a < Math.PI * 2 - 1e-6; a += STEP) {
        const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
        if (!waterAt(x, z)) continue;
        // score: far from the city centre, and hash-jittered so two worlds with
        // the same coastline still put the camp somewhere different.
        const s = rad * (0.85 + h01(Math.round(x), Math.round(z), 0x9A17) * 0.3);
        if (s > bestScore) { bestScore = s; best = { x: x, z: z }; }
      }
      if (best) break;
    }
    return best;
  }

  const CREW_NAMES = ["The Shoal Boys", "Deep Reach", "The Long Night Crew", "Cutter's Own", "The Grey Water Set"];
  const SKIFF_SEATS = [
    { x: 0.0, y: 0.42, z: -2.2, state: "sit" },
    { x: -0.55, y: 0.42, z: -0.7, state: "sit" },
    { x: 0.55, y: 0.42, z: -0.7, state: "sit" },
    { x: 0.0, y: 0.42, z: 0.9, state: "sit" },
    { x: 0.0, y: 0.46, z: 2.3, state: "sit" },
  ];
  // ROSTER SLOT, NEVER A ROLL. Every crew that exists has exactly one of each
  // of the three people who matter, and you can go and find them.
  const ROSTER = ["captain", "enforcer", "broker", "coxswain", "deckhand", "deckhand", "deckhand", "deckhand"];

  function musterCrew() {
    if (!on() || !anchorage) return null;
    if (!CBZ.cityPostNpc || !CBZ.cityPeds) return null;
    const P = player();
    if (!P) return null;

    // OVER THE HORIZON, NEVER OUT OF THIN AIR. The boat is placed on real
    // water at least 620 m out and off the padded screen (npcTransitionSafe is
    // strictly stronger than a yaw cone), and the crew goes STRAIGHT INTO ITS
    // SEATS — the drive-by grammar — so nothing is ever watched to appear.
    const target = pickPrize();
    if (!target) return null;
    const bearing = rnd() * Math.PI * 2;
    let sx = 0, sz = 0, ok = false;
    for (let i = 0; i < 10; i++) {
      const a = bearing + i * 0.63;
      const rad = 620 + rnd() * 260;
      sx = target.pos.x + Math.cos(a) * rad;
      sz = target.pos.z + Math.sin(a) * rad;
      if (!waterAt(sx, sz)) continue;
      if (dist(sx, sz, P.pos.x, P.pos.z) < 520) continue;
      if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(sx, sz, { maxDistance: 900 })) continue;
      ok = true; break;
    }
    if (!ok) return null;

    const cr = {
      id: "pirates:" + (crews.length + 1) + ":" + Math.round(sx),
      name: CREW_NAMES[(Math.abs(Math.round(sx + sz)) % CREW_NAMES.length)],
      home: { x: anchorage.x, z: anchorage.z },
      boats: [], members: [],
      state: "approach", target: target, hold: null,
      t: 0, hailT: 0, boardT: 0, life: 900,
    };

    const nBoats = 1 + (rnd() < 0.45 ? 1 : 0);
    const crewSize = nBoats === 2 ? 7 : 4;
    let slot = 0;
    for (let b = 0; b < nBoats; b++) {
      const bx = sx + b * 14, bz = sz + b * 9;
      const heading = Math.atan2(target.pos.x - bx, target.pos.z - bz);
      const boat = spawnSkiff(bx, bz, heading, cr);
      if (!boat) continue;
      cr.boats.push(boat);
      const aboard = Math.min(SKIFF_SEATS.length, Math.ceil(crewSize / nBoats));
      for (let s = 0; s < aboard && slot < crewSize; s++, slot++) {
        const m = mintPirate(bx, bz, ROSTER[Math.min(slot, ROSTER.length - 1)], cr);
        if (!m) continue;
        m._pirBoat = boat;
        if (CBZ.npcLife && CBZ.npcLife.attach) {
          try { CBZ.npcLife.attach(m, boat.group, SKIFF_SEATS[s]); } catch (e) {}
        }
        cr.members.push(m);
      }
    }
    if (!cr.boats.length || !cr.members.length) { disband(cr, "no boat"); return null; }
    crews.push(cr);
    _mustered++;
    return cr;
  }

  const PIRATE_JOBS = {
    captain: "boat captain", enforcer: "boat crew", broker: "shore broker",
    coxswain: "boat crew", deckhand: "boat crew",
  };
  function mintPirate(x, z, rankKey, cr) {
    const rung = LADDER.find(function (r) { return r.key === rankKey; }) || LADDER[0];
    const weapon = rung.weapon || (rnd() < 0.62 ? "AK-47" : "Pistol");
    const ped = CBZ.cityPostNpc(x, z, {
      src: "piracy:crew", parent: (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || null,
      kind: "gang",
      archetype: "gangster",
      job: PIRATE_JOBS[rankKey] || "boat crew",
      armed: true, weapon: weapon, controlled: true,
      aggr: clamp(0.62 + LADDER.indexOf(rung) * 0.07, 0, 0.95),
      hp: rung.hp || 110,
      wealth: 0.18,
      // The bodies go into a seat on a boat 600 m away; letting peds.js hide
      // them independently would produce the worse lie (an empty skiff).
      allowVisibleSpawn: true,
    });
    if (!ped) return null;
    ped.maxHp = rung.hp || 110;
    ped.ammo = weapon === "AK-47" ? 90 : 34;
    // THE RANK LIVES ON THE BODY, in the field factions.js was told to read.
    ped.pirateRank = rankKey;
    ped.pirateCrew = true;
    ped._pirCrew = cr;
    // A DISPLAYED ROLE IS A CLAIM. Until they commit they are fishermen — the
    // cover has an ORG (so an insider at Enforcer+ sees straight through it)
    // AND it burns (so roleAudit().unseeable stays 0 by both tests).
    if (CBZ.citySetCover) {
      try {
        CBZ.citySetCover(ped, {
          role: "Fisherman", lvl: 4 + ((Math.abs(Math.round(x)) % 5) | 0),
          org: ORG, seeTier: 2,
        });
      } catch (e) {}
    }
    ped._burnable = true;
    return ped;
  }

  function burnCovers(cr) {
    if (!CBZ.cityBurnCover) return;
    for (let i = 0; i < cr.members.length; i++) {
      const m = cr.members[i];
      if (m && !m.dead && m._cover) { try { CBZ.cityBurnCover(m, 0); } catch (e) {} }
    }
  }

  function disband(cr, why) {
    const i = crews.indexOf(cr); if (i >= 0) crews.splice(i, 1);
    for (let j = 0; j < cr.members.length; j++) {
      const m = cr.members[j];
      if (!m) continue;
      // Killed crew stay dead and stay where they fell (morgue.js owns bodies).
      // Live crew are given back the way citystaff gives a worker back.
      if (m.dead) continue;
      try { if (m._npcAttached && CBZ.cityUnseat) CBZ.cityUnseat(m, { state: "walk" }); } catch (e) {}
      if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(m); } catch (e) {} }
    }
    cr.members.length = 0;
    // A SKIFF LEFT ON THE WATER IS A BOAT YOU CAN STEAL — so it stays, and it
    // stays a full cityCars record. What must not happen is an unbounded pile
    // of abandoned hulls: one you cannot see is reaped (the citystaff/airside
    // give-back rule, at the same "nobody is watching" distance), one you can
    // is left exactly where it is, because a vehicle deleted under the player
    // is the thing this repo keeps banning.
    for (let j = 0; j < cr.boats.length; j++) {
      const b = cr.boats[j];
      if (!b) continue;
      b._pirateBoat = false;
      if (why !== "reset" && !reapBoat(b, 320)) continue;
    }
    cr.boats.length = 0;
    if (why === "standdown") _stoodDown++;
  }

  function reapBoat(b, minDist) {
    if (!b || b.player) return false;
    const P = player();
    if (P && !P.dead && b.pos && dist(b.pos.x, b.pos.z, P.pos.x, P.pos.z) < (minDist || 320)) return false;
    if (b.stolen || b.owned) return false;             // it is somebody's now
    const L = cars();
    const i = L.indexOf(b); if (i >= 0) L.splice(i, 1);
    if (b.group && b.group.parent) b.group.parent.remove(b.group);
    b.dead = true;
    return true;
  }

  // A CAPTAIN CAN CALL IT OFF — and only a Captain, which is the whole point of
  // having one. Used by the pay-at-the-boat branch and by the player's own
  // standdown once he holds the rung.
  function standDown(cr, why, byPlayerRank) {
    if (!cr) return false;
    const cap = crewHolder(cr, "standdown");
    // ...or YOU hold the rung. Once succession has made the player Captain
    // there may be no NPC left who can give the order, and refusing it then
    // would make the rung a pip again.
    if (!cap && !(byPlayerRank && playerCan("standdown"))) return false;
    cr.state = "leave";
    cr.life = Math.min(cr.life, 45);
    for (let i = 0; i < cr.members.length; i++) {
      const m = cr.members[i];
      if (m && !m.dead) { m.rage = null; m.huntPlayer = 0; }
    }
    if (cap) say(cap, why === "paid" ? "Money's here. We're going." : "Off. Now.");
    return true;
  }

  /* =========================================================================
     §6  THE HUNT — the world supplies the prize, never a spawn.
     ========================================================================= */
  // contracts.js's binding law, applied at sea: NEVER spawn a target. A raid
  // exists only if the simulation was already running a vessel worth taking.
  function aboardCount(car) {
    let n = 0;
    const P = peds();
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a && !a.dead && a._npcAttached && a._npcAttached.parent === car.group) n++;
    }
    return n;
  }
  function prizeValue(car) {
    if (!car || car.dead || !car.pos || !car.group) return 0;
    if (car._pirateBoat) return 0;
    if (!CBZ.isMarineHull || !CBZ.isMarineHull(car)) return 0;
    if (!waterAt(car.pos.x, car.pos.z)) return 0;
    const S = (CBZ.marineHulls && CBZ.marineHulls.specFor) ? CBZ.marineHulls.specFor(car) : car._hullSpec;
    const loa = S ? S.loa : 6;
    const val = num(car.model && car.model.value, 15000);
    const bodies = aboardCount(car) + (car.player ? 1 : 0);
    // WHAT MAKES A HULL WORTH TAKING: people aboard first (there is nothing to
    // ransom on an empty boat), then size, then price.
    if (bodies <= 0 && !car.player) return 0;
    return bodies * 40 + loa * 12 + Math.min(400, val / 250);
  }
  function pickPrize() {
    const L = cars();
    let best = null, bv = 0;
    for (let i = 0; i < L.length; i++) {
      const v = prizeValue(L[i]);
      if (v > bv) { bv = v; best = L[i]; }
    }
    return best;
  }

  function defendersOf(car) {
    const out = [];
    if (!car || !car.group) return out;
    const P = peds();
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (!a || a.dead || a.restraint) continue;
      if (a.pirateCrew) continue;
      if (a._npcAttached && a._npcAttached.parent === car.group) { out.push(a); continue; }
      if (a.pos && car.pos && d2(a.pos.x, a.pos.z, car.pos.x, car.pos.z) < 26 * 26 && (a.armed || a.guard)) out.push(a);
    }
    return out;
  }

  // WHO IS WORTH TAKING OFF THIS DECK. The person the world already made
  // important: a principal, the richest guest, the highest level aboard. Never
  // a child, never a cop, never anybody the seal protects.
  function pickHostage(car) {
    if (!car || !car.group) return null;
    const cand = defendersOf(car).concat([]);
    const P = peds();
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a && !a.dead && a._npcAttached && a._npcAttached.parent === car.group && cand.indexOf(a) < 0) cand.push(a);
    }
    let best = null, bv = -1;
    for (let i = 0; i < cand.length; i++) {
      const a = cand[i];
      if (!a || a.dead || a.child || protectedActor(a) || a.kind === "cop" || a.restraint) continue;
      const pay = ransomFor(a);
      const v = (pay && pay.pays ? pay.amount : 0) + num(a.wealth, 0.3) * 400;
      if (v > bv) { bv = v; best = a; }
    }
    // Nobody aboard is worth a number -> the crew does not take a hostage. No
    // fiction: they rob the boat and go.
    return (bv > 0) ? best : null;
  }

  /* =========================================================================
     §7  THE TAKE — approach, hail, board, fight, grab.
     ========================================================================= */
  function crewTick(cr, dt) {
    cr.t += dt; cr.life -= dt;
    const tgt = cr.target;
    const lead = crewFrontman(cr);

    // The prize is gone (sunk, ashore, despawned) or the crew is dead.
    if (!crewAlive(cr)) { disband(cr, "wiped"); return; }
    if (cr.life <= 0) { disband(cr, "gone"); return; }
    succession(cr);
    const prizeGone = !tgt || tgt.dead || !tgt.pos || !tgt.group || cars().indexOf(tgt) < 0
      || !waterAt(tgt.pos.x, tgt.pos.z);
    // Once the boarding party is off the boat they are people in a fight, and a
    // fight does not end because the hull sank — but the FSM's target-reading
    // states must not run against a dead reference.
    if (prizeGone && cr.state !== "withdraw" && cr.state !== "leave") cr.state = "leave";

    // Boats first — the crew rides them, so the hulls move whether or not
    // anybody aboard is doing anything.
    for (let i = 0; i < cr.boats.length; i++) {
      const b = cr.boats[i];
      if (!b || b.dead || b.player) continue;
      let cmd;
      if (cr.state === "leave") cmd = { x: cr.home.x, z: cr.home.z, speed: b._hullSpec ? b._hullSpec.topMs : 8, arrive: 40 };
      else if (cr.state === "board") cmd = interceptCmd(b, tgt, 8, 6);
      else cmd = interceptCmd(b, tgt, 14, 12);
      try { CBZ.marineAutopilot(b, dt, cmd); } catch (e) {}
    }

    const b0 = cr.boats[0];
    const d = (b0 && tgt && tgt.pos) ? dist(b0.pos.x, b0.pos.z, tgt.pos.x, tgt.pos.z) : Infinity;
    rideDeck(cr, prizeGone ? null : tgt);

    if (cr.state === "approach") {
      // THE HAIL. This is where the fisherman stops being a fisherman, and it
      // is a spoken line (lower-centre subtitle), never a panel.
      if (d < 90 && cr.hailT <= 0) {
        cr.hailT = 6;
        burnCovers(cr);
        if (lead) say(lead, "Cut your engines. Stand off the rail.");
        if (tgt && tgt.player) phone("Two boats off your quarter and they are not fishing.", "COASTAL WATCH", 4.5);
        scareAround(tgt.pos.x, tgt.pos.z, 30, lead);
      }
      cr.hailT -= dt;
      // AN ORDER NEEDS SOMEBODY TO GIVE IT. No Enforcer alive, no boarding —
      // the crew shadows the vessel and eventually gives up.
      if (d < 26) {
        if (crewHolder(cr, "boarding")) { cr.state = "board"; cr.boardT = 0; }
        else if (cr.t > 90) { cr.state = "leave"; if (lead) say(lead, "Nobody's giving that order. Let it go."); }
      }
      return;
    }

    if (cr.state === "board") {
      cr.boardT += dt;
      // BOARDING IS A DOOR YOU PASS THROUGH — the walk/climb/handover beats
      // aircraft_doors.js established, run over a gunwale instead of an
      // airstair. Bodies leave a seat the ONE sanctioned way (cityUnseat).
      if (d < 12) {
        for (let i = 0; i < cr.members.length; i++) {
          const m = cr.members[i];
          if (!m || m.dead || m._pirAboard) continue;
          if (!crewCan(m, "board")) continue;
          if (m._npcAttached) { try { if (CBZ.cityUnseat) CBZ.cityUnseat(m, { state: "walk" }); } catch (e) {} }
          m._pirAboard = true;
          m.controlled = false;
          m.huntPlayer = tgt && tgt.player ? 12 : 0;
          if (m.pos && tgt && tgt.pos) {
            const a = (i / Math.max(1, cr.members.length)) * Math.PI * 2;
            m.pos.set(tgt.pos.x + Math.cos(a) * 2.2, num(tgt.group && tgt.group.position.y, 0) + 1.0, tgt.pos.z + Math.sin(a) * 2.2);
            if (m.target && m.target.set) m.target.set(m.pos.x, 0, m.pos.z);
          }
          _boarded++;
        }
        cr.state = "fight";
      }
      return;
    }

    if (cr.state === "fight") {
      const def = defendersOf(tgt);
      let resistance = 0;
      for (let i = 0; i < def.length; i++) if (def[i].armed && !def[i].surrender) resistance++;
      if (tgt && tgt.player && CBZ.cityHasGun && CBZ.cityHasGun()) resistance++;

      // THE ONE CALL AN ARMED BRAIN MAKES. Cover, turn-taking, the DPS ladder
      // with its cap on the RESULT — this file adds no damage model at all.
      for (let i = 0; i < cr.members.length; i++) {
        const m = cr.members[i];
        if (!m || m.dead || !m._pirAboard) continue;
        const mark = pickMark(m, def, tgt);
        if (!mark) continue;
        m.rage = mark;
        // markers.js's cityTargetsPlayer() lights EVERY threat surface off this
        // one field — never add a parallel threat marker.
        if (mark.isPlayer || (tgt && tgt.player)) m.huntPlayer = Math.max(m.huntPlayer || 0, 6);
        if (CBZ.combatIQ && CBZ.combatIQ.posture && m.target) {
          try { CBZ.combatIQ.posture(m, mark, dt); } catch (e) {}
        }
      }
      // Everybody else on that deck decides for themselves — one call, and it
      // is the same one an arena crowd and a held-up bank use.
      if (cr.boardT < 3.5) scareAround(tgt.pos.x, tgt.pos.z, 22, lead);
      cr.boardT += dt;

      if (resistance <= 0) { cr.state = "grab"; cr.boardT = 0; }
      return;
    }

    if (cr.state === "grab") {
      const grabber = crewHolder(cr, "board") || lead;
      if (!grabber) { cr.state = "leave"; return; }
      /* CACHED, and that is not a micro-optimisation. This state persists for
         the whole ~2.6 s seize, so pickHostage() ran EVERY FRAME — which was
         free when a ransom was a wealth curve and is not free now that it asks
         city/take.js what four people's families actually hold. Re-picked only
         if the boat changed or the chosen body died in the meantime. */
      if (cr._pickFor !== tgt || (cr._pick && (cr._pick.dead || cr._pick.restraint))) {
        cr._pickFor = tgt;
        cr._pick = tgt.player ? null : pickHostage(tgt);
      }
      const victim = tgt.player ? null : cr._pick;
      if (!victim && !tgt.player) {
        // Nothing aboard is worth a number. They take the boat's value and go —
        // which is a real outcome, not a failure state.
        cr.state = "leave";
        say(grabber, "Nothing here worth a call. Strip it.");
        return;
      }
      // THE GRAB IS THE SHARED SEIZE, non-lethal — the same wind/strike/hold/
      // resolve FSM the arrest tackle runs, whose worst outcome is "taken".
      if (CBZ.predatorSeize && !cr.hold) {
        const mark = victim || player();
        const h = CBZ.predatorSeize(grabber, mark, {
          nonLethal: true, style: "drag", hold: 2.6, escape: 0.5, thrash: 0.5,
          cause: "taken off the deck",
          onEnd: function (result) {
            cr.hold = null;
            if (result === "taken" || result === "killed") {
              if (victim) {
                const rec = take(victim, { by: cr.id, crew: cr, threat: grabber, limit: 300, vessel: tgt });
                if (rec) { rec._onDeck = true; cr.hold = rec; cr.state = "withdraw"; return; }
              } else {
                // The PLAYER was taken. There is no ransom for you — there is a
                // hold, and the game already owns "you are in somebody's hands"
                // through the arrest arc's own capture pipeline.
                phone("You woke up on the floor of a boat.", "—", 4);
                cr.state = "withdraw";
                return;
              }
            }
            cr.state = "leave";
          },
        });
        cr.hold = h || null;
        if (!h) cr.state = "leave";
      } else if (!CBZ.predatorSeize) {
        // Degrade path: no seize FSM, the take still happens.
        if (victim) { const rec = take(victim, { by: cr.id, crew: cr, threat: grabber, limit: 300, vessel: tgt }); if (rec) { cr.hold = rec; cr.state = "withdraw"; return; } }
        cr.state = "leave";
      }
      if (cr.boardT > 12) cr.state = "leave";
      cr.boardT += dt;
      return;
    }

    if (cr.state === "withdraw") {
      // Back to the boats with the hostage, and away to the anchorage. The
      // hold's coordinates follow the body, so the waypoint the player is
      // chasing is where the person actually IS.
      for (let i = 0; i < cr.members.length; i++) {
        const m = cr.members[i];
        if (!m || m.dead) continue;
        const b = m._pirBoat && !m._pirBoat.dead ? m._pirBoat : cr.boats[0];
        if (!b) continue;
        if (m.target && m.target.set) m.target.set(b.pos.x, 0, b.pos.z);
        m.rage = null;
        // BACK IN THE BOAT, NOT SWIMMING BESIDE IT. Reaching the rail hands the
        // body to npcLife's seat — the same call that put him there at muster.
        if (m.pos && d2(m.pos.x, m.pos.z, b.pos.x, b.pos.z) < 9) {
          m._pirAboard = false;
          if (!m._npcAttached && CBZ.npcLife && CBZ.npcLife.attach) {
            const seat = SKIFF_SEATS[(i % SKIFF_SEATS.length)];
            try { CBZ.npcLife.attach(m, b.group, seat); } catch (e) {}
          }
        }
      }
      const held = holds.filter(function (x) { return x.crew === cr; });
      for (let i = 0; i < held.length; i++) {
        const hp = held[i].ped;
        const b = cr.boats[0];
        if (hp && !hp.dead && b && hp.pos) {
          // Carried aboard, then held on the skiff — never teleported home, so
          // the waypoint the player is chasing is where the body actually is.
          held[i]._onDeck = false;
          hp.pos.set(b.pos.x + 0.6, num(b.group && b.group.position.y, 0) + 0.9, b.pos.z - 1.1);
          if (hp.target && hp.target.set) hp.target.set(hp.pos.x, 0, hp.pos.z);
          hp.speed = 0;
        }
      }
      if (!held.length) { cr.state = "leave"; return; }
      // steer home
      for (let i = 0; i < cr.boats.length; i++) {
        const b = cr.boats[i];
        if (!b || b.dead || b.player) continue;
        try { CBZ.marineAutopilot(b, dt, { x: cr.home.x, z: cr.home.z, speed: b._hullSpec ? b._hullSpec.cruiseMs : 7, arrive: 30 }); } catch (e) {}
      }
      return;
    }

    if (cr.state === "leave") {
      if (b0 && dist(b0.pos.x, b0.pos.z, cr.home.x, cr.home.z) < 60) disband(cr, "home");
    }
  }

  /* A VESSEL UNDER WAY IS A MOVING BATTLEFIELD.
     The airliner cabin's answer (npcLife.attach + syncAttached) is exactly
     right for a PASSENGER and exactly wrong for a boarding party: attach forces
     state "sit", speed 0, and re-asserts the seat transform every frame, so an
     attached man cannot fight. What a deck actually does is CARRY you while you
     move on it — so every boarded body is translated by the hull's own
     per-frame delta and its Y is pinned to the deck. combatIQ still owns where
     they walk; the deck owns where the deck goes. Ten lines instead of a second
     attachment system, and the moment the hull is gone they are simply people
     standing in the sea, which is what they would be. */
  function rideDeck(cr, tgt) {
    if (!tgt || !tgt.group || !tgt.pos) { cr._deckPrevX = null; return; }
    const px = cr._deckPrevX, pz = cr._deckPrevZ;
    cr._deckPrevX = tgt.pos.x; cr._deckPrevZ = tgt.pos.z;
    if (px == null) return;
    const dx = tgt.pos.x - px, dz = tgt.pos.z - pz;
    const S = tgt._hullSpec;
    const deckY = num(tgt.group.position.y, 0) + (S && S.deckY != null ? S.deckY : 0.8);
    const moved = (dx * dx + dz * dz) > 1e-8;
    for (let i = 0; i < cr.members.length; i++) {
      const m = cr.members[i];
      if (!m || m.dead || !m._pirAboard || !m.pos) continue;
      if (moved) {
        m.pos.x += dx; m.pos.z += dz;
        if (m.target && m.target.set) m.target.set(m.target.x + dx, m.target.y || 0, m.target.z + dz);
      }
      m.pos.y = deckY;
    }
    // the hostage rides it too, until the crew carries them off
    for (let i = 0; i < holds.length; i++) {
      const hh = holds[i];
      if (hh.crew !== cr || !hh.ped || hh.ped.dead || !hh.ped.pos || !hh._onDeck) continue;
      if (moved) { hh.ped.pos.x += dx; hh.ped.pos.z += dz; }
      hh.ped.pos.y = deckY;
    }
  }

  // A lead-pursuit intercept: aim where the prize WILL BE, offset to its
  // quarter so two skiffs pincer instead of queueing astern.
  function interceptCmd(boat, tgt, offset, arrive) {
    if (!tgt || !tgt.pos) return { x: boat.pos.x, z: boat.pos.z, stop: true };
    const S = boat._hullSpec;
    const myV = S ? S.topMs : 10;
    const tvx = num(tgt.vx, 0), tvz = num(tgt.vz, 0);
    const d = dist(boat.pos.x, boat.pos.z, tgt.pos.x, tgt.pos.z);
    const lead = clamp(d / Math.max(3, myV), 0, 8);
    const side = (boat._pirSide != null) ? boat._pirSide : (boat._pirSide = (h01(Math.round(boat.pos.x), Math.round(boat.pos.z), 0x51) < 0.5 ? -1 : 1));
    const th = num(tgt.heading, 0);
    return {
      x: tgt.pos.x + tvx * lead + Math.cos(th) * offset * side,
      z: tgt.pos.z + tvz * lead - Math.sin(th) * offset * side,
      speed: myV, arrive: arrive || 10,
    };
  }

  function pickMark(m, def, tgt) {
    const P = player();
    if (tgt && tgt.player && P && !P.dead) {
      const pa = CBZ.city && CBZ.city.playerActor;
      if (pa) return pa;
    }
    let best = null, bd = Infinity;
    for (let i = 0; i < def.length; i++) {
      const a = def[i];
      if (!a || a.dead || !a.armed) continue;
      const d = d2(a.pos.x, a.pos.z, m.pos.x, m.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /* =========================================================================
     §8  THE PLAYER'S THREE SEATS
     -------------------------------------------------------------------------
       VICTIM   — your hull is a prize like any other (prizeValue counts you),
                  and anybody you are carrying is a person they can take. That
                  is what makes owning a boat with people on it mean something.
       PIRATE   — sign on at the boat (factions admission, above); rank buys
                  the three orders; standdown is a Captain's word.
       RESCUER  — a contract from the party that actually loses money: the
                  vessel's owner, or the payer of a live demand.
     ========================================================================= */
  function registerVerbs() {
    const I = CBZ.interactions;
    if (!I || !I.register) return 0;
    let n = 0;

    // SIGN ON. The join itself is factions.js's — this is only the door.
    I.register("ped:civ", {
      id: "pir-signon", slot: "e", prio: 71,
      canShow: function (p) {
        if (!on() || C.PIRACY_JOIN === false || !p || p.dead || !p.pirateCrew) return false;
        if (!CBZ.factions || !CBZ.factions.canJoin) return false;
        if (CBZ.factions.tier && CBZ.factions.tier(ORG) >= 0) return false;
        return !!crewCan(p, "boarding");        // you talk to the man who says go
      },
      label: function () { return "Ask to sign on"; },
      onSelect: function (p) {
        const can = CBZ.factions.canJoin(ORG);
        if (!can.ok) { phone(can.why, (p._pirCrew ? p._pirCrew.name : "THE CREW").toUpperCase(), 4); return; }
        CBZ.factions.join(ORG, "signed on");
        say(p, "Then you pull your weight.");
      },
    }); n++;

    // ORDER A BOARDING — and only if you hold the rung that gives that order.
    I.register("ped:civ", {
      id: "pir-order-board", slot: "i", prio: 72,
      canShow: function (p) {
        if (!on() || !p || p.dead || !p.pirateCrew || !p._pirCrew) return false;
        const cr = p._pirCrew;
        if (cr.state !== "approach") return false;
        return playerCan("boarding");
      },
      label: function () { return "Give the order: take her"; },
      onSelect: function (p) {
        const cr = p._pirCrew;
        cr.state = "board"; cr.boardT = 0;
        burnCovers(cr);
        _ordered++;
        say(p, "Aye.");
      },
    }); n++;

    // CALL IT OFF — the Captain's word, from either side of it.
    I.register("ped:civ", {
      id: "pir-standdown", slot: "i", prio: 73,
      canShow: function (p) {
        if (!on() || !p || p.dead || !p.pirateCrew || !p._pirCrew) return false;
        if (p._pirCrew.state === "leave") return false;
        return playerCan("standdown");
      },
      label: function () { return "Call them off"; },
      onSelect: function (p) { standDown(p._pirCrew, "captain", true); },
    }); n++;

    // CUT SOMEBODY LOOSE. Any hostage, held by anyone, if you can reach them.
    I.register("ped:civ", {
      id: "pir-cut-loose", slot: "e", prio: 78,
      canShow: function (p) { return !!(ransomOn() && p && !p.dead && holdOf(p) && !holdOf(p).byPlayer); },
      label: function (p) { return "Cut " + nameOf(p, "them") + " loose"; },
      onSelect: function (p) { release(p, "rescued"); _rescued++; },
    }); n++;

    // WHAT ARE THEY WORTH? The dossier question, asked of somebody you are
    // holding. It reads the SAME derivation the demand uses, so a number shown
    // is a number that will actually arrive.
    I.register("ped:civ", {
      id: "pir-worth", slot: "i", prio: 60,
      canShow: function (p) { return !!(ransomOn() && p && !p.dead && p.restraint && holdOf(p) && holdOf(p).byPlayer); },
      label: function (p) {
        const h = holdOf(p);
        const pay = h && h.payer;
        if (!pay || !pay.pays) return "Nobody's paying for them";
        return pay.name + " will pay " + money(pay.amount);
      },
      onSelect: function (p) {
        const h = holdOf(p);
        if (h && h.payer) phone(h.payer.why, "THE WIRE", 4);
      },
    }); n++;

    return n;
  }

  // THE RESCUE CONTRACT. The giver is the party that is actually out of pocket,
  // and it is only offered when the world contains a live hold — never a
  // fabricated one. core/mission.js does the rest.
  let offeredFor = null;
  function offerRescue() {
    const M = CBZ.mission;
    if (!M || !M.start) return;
    const live = holds.find(function (h) { return h.againstPlayer && h.ped && !h.ped.dead && h.payer && h.payer.pays; });
    if (!live) { offeredFor = null; return; }
    if (offeredFor === live) return;
    // one job at a time — the block's own busy question, never a private one
    if (M.busy && M.busy()) return;
    offeredFor = live;
    const who = nameOf(live.ped, "them");
    live.rescue = M.start({
      id: "rescue:" + who + ":" + Math.round(live.x) + ":" + Math.round(live.z),
      title: "Get " + who + " back",
      brief: (live.payer.name) + " is short " + money(live.amount) + " and running out of clock. Go and take them back.",
      color: 0xffb45a,
      reward: { cash: Math.round(live.amount * 0.35), respect: 4 },
      // "custom" so nothing completes it but release(..,"rescued") calling
      // complete() by hand — a goal that watched the ledger would also fire the
      // moment you PAID, which is not a rescue and would pay you for it.
      goal: "custom",
      at: [live.x, live.z],
    });
  }

  /* =========================================================================
     §9  THE DIRECTOR, THE AUDIT, THE RESET
     ========================================================================= */
  let _mustered = 0, _boarded = 0, _taken = 0, _paid = 0, _paidCash = 0, _paidByPlayer = 0,
    _executed = 0, _rescued = 0, _cuts = 0, _hot = 0, _ordered = 0, _stoodDown = 0;
  let raidCD = 150, verbsRegistered = 0, skiffRegistered = false;

  /* THE ONE SWEEPER. core/mission.js's onInterrupt is the shared death /
     arrest / mode-exit edge — never grow a local one (CLAUDE.md). A player who
     dies or is arrested while holding somebody must not leave a person tied up
     in an empty world with a clock still running on them. */
  if (CBZ.mission && CBZ.mission.onInterrupt) {
    CBZ.mission.onInterrupt(function () {
      for (let i = holds.length - 1; i >= 0; i--) {
        const h = holds[i];
        if (h.byPlayer) release(h.ped, "lost");
      }
      offeredFor = null;
    });
  }

  function resetIfNewArena() {
    const A = CBZ.city && CBZ.city.arena;
    const root = A && A.root;
    if (root === arenaRef) return;
    arenaRef = root;
    for (let i = crews.length - 1; i >= 0; i--) disband(crews[i], "reset");
    crews.length = 0;
    // A skiff whose arena is gone is a ghost with a persist flag on it — the
    // exact fixture-purge cityAddParkedCar already runs against _arenaRoot.
    const L = cars();
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (c && c._pirArena && c._pirArena !== root) { reapBoat(c, -1); }
    }
    for (let i = holds.length - 1; i >= 0; i--) { unpublish(holds[i].ped); holds.splice(i, 1); }
    anchorage = null;
    raidCD = 150;
    offeredFor = null;
  }

  if (typeof CBZ.onUpdate === "function") {
    // 34.62 — just after gangs.js's own band (34.6), which is the right
    // neighbourhood: this is an organisation's brain, and it reads the same
    // ped/panic state gangs.js does.
    CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.GANGS, 2) : 34.62, function (dt) {
      if (!inCity()) return;
      dt = Math.min(num(dt, 0.016), 0.1);
      resetIfNewArena();
      if (!skiffRegistered) {
        // latch on the flag-off case too, or this retries every frame forever
        skiffRegistered = (C.PIRACY_SKIFF_HULL === false)
          || registerSkiff()
          || !!(CBZ.marineHulls && CBZ.marineHulls.get && CBZ.marineHulls.get(SKIFF_KEY));
      }
      if (!verbsRegistered) verbsRegistered = registerVerbs();

      if (ransomOn()) { tickHolds(dt); offerRescue(); }
      if (!on() || C.PIRACY_RAIDS === false) return;

      if (!anchorage) anchorage = findAnchorage();
      for (let i = crews.length - 1; i >= 0; i--) {
        const cr = crews[i];
        if (!cr) { crews.splice(i, 1); continue; }
        // A crew that throws is torn down rather than left half-ticking — and
        // the reference is captured FIRST, because crewTick may have already
        // spliced this slot on its way out.
        try { crewTick(cr, dt); } catch (e) { disband(cr, "error"); }
      }

      // THE MENACE LAW, applied to a faction. A raid you meet every trip is a
      // tax; the gap is what keeps the next one frightening.
      raidCD -= dt;
      if (raidCD <= 0) {
        raidCD = 220 + rnd() * 260;
        if (crews.length < (C.PIRACY_CREWS | 0)) {
          const P = player();
          if (P && !P.dead && waterNear(P.pos.x, P.pos.z, 140)) musterCrew();
        }
      }
    });
  }

  function waterNear(x, z, r) {
    // Cheap 8-point ring: is there open water within r of here at all? A crew
    // must never muster against a player standing in the middle of a city.
    for (let a = 0; a < Math.PI * 2 - 1e-6; a += Math.PI / 4) {
      if (waterAt(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true;
    }
    return waterAt(x, z);
  }

  /* ---- THE RATCHET (BLOCK LAW #5) ----------------------------------------
     `legacyRansom` is the count of magic-number ransom payouts still live in
     this build — a ransom that arrives with no payer, no delay and no chain.
     There was exactly one (social.js's cityReleaseHostage) and this file wraps
     it, so the number is 0 and MAY ONLY EVER GO DOWN. Everything else is
     printed beside it so a "fix" that simply stops taking hostages cannot pass.
     `unseeableCovers` is the same stat-fiction test roleAudit() applies, asked
     of THIS file's covers only, and is structurally 0. */
  CBZ.piracyAudit = function () {
    let live = 0, covers = 0, unseeable = 0, crewBodies = 0, brass = 0, boats = 0;
    for (let i = 0; i < crews.length; i++) {
      const cr = crews[i];
      boats += cr.boats.length;
      for (let j = 0; j < cr.members.length; j++) {
        const m = cr.members[j];
        if (!m || m.dead) continue;
        crewBodies++;
        if (m.pirateRank === "captain" || m.pirateRank === "enforcer" || m.pirateRank === "broker") brass++;
        if (m._cover && m._cover.role) { covers++; if (!m._cover.org && !m._burnable) unseeable++; }
      }
    }
    for (let i = 0; i < holds.length; i++) if (holds[i].ped && !holds[i].ped.dead) live++;
    let legacy = (CBZ.cityReleaseHostage && CBZ.cityReleaseHostage._ransomWrapped) ? 0 : 1;
    // A RANSOM THAT COMES OUT OF NOBODY IS STILL A MAGIC NUMBER. The wrap above
    // only proved the OLD payout was replaced; until city/take.js shipped, the
    // replacement was itself a curve with a $26,832 ceiling that minted its own
    // money. `legacyRansom` now counts that too, so the pin at 0 means both.
    if (!(CBZ.cityHolds && CBZ.cityTake && C.TAKE_IS_TRANSFER !== false)) legacy++;
    // every rung must open a verb — asked of OUR ladder, not of a promise
    let verblessRungs = 0;
    for (let i = 0; i < LADDER.length; i++) if (!LADDER[i].grants || !LADDER[i].grants.length) verblessRungs++;
    return {
      legacyRansom: legacy,        // PIN 0
      unseeableCovers: unseeable,  // PIN 0
      verblessRungs: verblessRungs,// PIN 0
      rungs: LADDER.length,
      orgDeclared: !!(CBZ.factions && CBZ.factions.exists && CBZ.factions.exists(ORG)),
      skiffHull: !!(CBZ.marineHulls && CBZ.marineHulls.get && CBZ.marineHulls.get(SKIFF_KEY)),
      autopilot: typeof CBZ.marineAutopilot === "function",
      captivesHook: typeof CBZ.activeKidnap === "function",
      verbs: verbsRegistered,
      crews: crews.length, crewBodies: crewBodies, brass: brass, boats: boats, covers: covers,
      mustered: _mustered, boarded: _boarded, ordered: _ordered, stoodDown: _stoodDown,
      holdsLive: live, taken: _taken, ransomsPaid: _paid, ransomCash: _paidCash,
      paidByPlayer: _paidByPlayer, executed: _executed, rescued: _rescued,
      fenced: _cuts, hotMoney: _hot,
      // A RANSOM IS A TRANSFER NOW. `ransomTransfer` false means every number
      // this file quotes is a curve again; `ransomCeiling` is null on purpose —
      // the old one was $26,832 and there isn't one any more.
      ransomTransfer: !!(CBZ.cityHolds && CBZ.cityTake && C.TAKE_IS_TRANSFER !== false),
      ransomCeiling: null,
    };
  };
  CBZ.piracyAudit.detail = function () {
    return holds.map(function (h) {
      return {
        who: nameOf(h.ped, "?"), by: h.byName, state: h.state,
        payer: h.payer ? h.payer.kind : "?", amount: h.amount, t: Math.round(h.t),
      };
    });
  };
  // alias, because the ransom half is the general capability and the sea half
  // is only its first consumer.
  CBZ.ransomAudit = CBZ.piracyAudit;

  // ---- PUBLIC SURFACE ------------------------------------------------------
  CBZ.cityRansomFor = ransomFor;
  CBZ.cityHostageTake = take;
  CBZ.cityHostageRelease = release;
  CBZ.cityHostageOf = holdOf;
  CBZ.cityHostageList = function () {
    return holds.map(function (h) {
      return {
        ped: h.ped, name: nameOf(h.ped, "Captive"), crew: h.byName,
        ransom: h.amount, timeLeft: h.t, x: h.x, z: h.z,
        byPlayer: h.byPlayer, payer: h.payer ? h.payer.kind : "none", state: h.state,
      };
    });
  };
  CBZ.pirateCrews = function () { return crews.slice(); };
  CBZ.pirateStandDown = standDown;
  CBZ.cityPiracyReset = function () { arenaRef = null; resetIfNewArena(); };
})();
