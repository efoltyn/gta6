/* ============================================================
   city/roles.js — WHO A PERSON IS, AND WHAT YOU CAN DO TO HIM.

   OWNER (2026-10-09, on an iPad): "In Gang City there are way too many
   interaction options. There's asking for a smoke. There's just ask. It's so
   dumb. No slop interaction options. Not even flirt." / "Store owners and some
   security guards don't have real interactions." / "It doesn't say people's
   names when you click on them."

   So a person's verbs come from WHAT HE IS, and that is one table here, not
   a gate in every registration:

     roleOf(p)       crew | gang | cop | security | vendor | official | civ
     VERB_OF[id]     what kind of act a registered option is (fight, rob,
                     pickpocket, threaten, buy, bribe, keycard, ...)
     ROLE_VERBS      role -> the kinds of act that person answers to

   city/interactions.js asks allows(role, option) for every street-layer
   option on a person (his own per-entity options and `anyone` orders skip
   it). An option this file does not classify is allowed: a new system's verb
   is never silently dead; CBZ.cityRoles.audit() lists them.

   Every verb a person shows changes state through a general system: the
   relationship sim, wanted/crime, the inventory and keys, the crew, the
   access passes, CBZ.politics.act. The flavour verbs (Flirt, Compliment,
   Insult, Ask for a smoke, Ask the way, Ask around, Photo, Give, Tip, Size
   up, Talk-for-a-line) are deleted with their code. There is no Talk verb:
   a person with something real to say says it as you come up (an option
   with `speak: true`, see city/interactions.js approach()).

   THE NAME OVER HIM. titleOf(p) is the one short line the card and the tap
   wheel print: "General Brandt", "Press Secretary Hale", "Officer Ruiz",
   "Pawnbroker", "Security", his gang, or his name once you know it. A
   stranger you have never met shows his role or nothing, never an invented
   name.

   The verbs this file owns (they exist because a role needs them):
     Threaten   a civilian you plainly outrank backs off (or squares up)
     Bribe      a cop takes a star off; a guard lets you through (an access
                pass on the building he guards) or looks away from a wanted man
     Take card  a guard's keycard off his belt: clean if he is down or has
                his hands up, a snatch and a fight if he is not
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.interactions) return;
  const g = CBZ.game;
  const I = CBZ.interactions;

  function nowS() { return (typeof CBZ.now === "number" ? CBZ.now : Date.now()) / 1000; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "$" + n; }
  function say(p, line, secs) { if (CBZ.citySay && p && line) { try { CBZ.citySay(p, line, "#dfe7ff", secs || 2.4); } catch (e) {} } }
  function sayT(p, topic, fb) { const s = (CBZ.cityLine && CBZ.cityLine(p, topic)) || fb; say(p, s); }
  function pa() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || ""; }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function act(kind, p) {
    // the one political act API (no-op without a presidency seat)
    if (CBZ.politics && CBZ.politics.act) { try { CBZ.politics.act(kind, { target: p, by: "self" }); } catch (e) {} }
  }
  function jobOf(p) { return (CBZ.cityPedJob ? CBZ.cityPedJob(p) : (p && p.job)) || ""; }
  function jobClass(p) {
    if (CBZ.cityPedJobClass) return CBZ.cityPedJobClass(p) || "";
    const J = CBZ.cityJobs && CBZ.cityJobs[jobOf(p)];
    return (J && J.class) || "";
  }

  /* ======================================================================
     ROLE OF A PERSON
     ====================================================================== */
  function yours(p) {
    if (CBZ.cityOrders2 && CBZ.cityOrders2.worksForYou) { try { if (CBZ.cityOrders2.worksForYou(p)) return true; } catch (e) {} }
    return !!(p.recruited || p.companion || (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)));
  }
  function seatOf(p) {
    if (!p || !p._sid || !CBZ.officialdom || !CBZ.officialdom.seatOf) return null;
    try { return CBZ.officialdom.seatOf(p); } catch (e) { return null; }
  }
  const LAWFUL_VIP = { Senator: 1, Judge: 1 };
  function roleOf(p) {
    if (!p) return "civ";
    if (p.kind === "cop") return "cop";
    if (p.vendor) return "vendor";
    if (yours(p)) return "crew";
    if (p._presOfficer || p._presStaff || p._congress || seatOf(p) || LAWFUL_VIP[p.vipTitle]) return "official";
    if (p.kind === "security" || p.archetype === "security" || p._vaultStaff && /guard/.test(jobOf(p)) || jobClass(p) === "law") return "security";
    if (p.gang) return "gang";
    return "civ";
  }

  /* ======================================================================
     WHAT KIND OF ACT AN OPTION IS
     ====================================================================== */
  const VERB_OF = {
    "ped-swing": "fight", "cop-punch": "fight",
    "ped-mug": "rob", "ped-shakedown": "rob", "vendor-rob": "rob",
    "gp-rob": "gunpoint", "gp-hostage": "gunpoint", "gp-ransom": "gunpoint", "gp-execute": "gunpoint",
    "milli-shakedown": "gunpoint",
    "ped-pickpocket": "pickpocket",
    "ped-threaten": "threaten", "official-lean": "threaten", "vip-bench-lean": "threaten",
    "dlg-talk": "talk",
    "rv-role": "service", "rv-score": "service", "ped-mechanic-fix": "service", "ped-cab-ride": "service",
    "ped-cart-bite": "service", "ped-sell": "service",
    "ped-recruit": "recruit", "loyal-prisoner-join": "recruit",
    "ped-prospect": "gang", "ped-claim-crew": "gang", "ped-put-in-work": "gang", "ped-crew-favor": "gang", "ped-leave-crew": "gang",
    "ped-promote": "crew", "ped-hold-corner": "crew", "ped-roll": "crew",
    "vendor-shop": "buy", "vendor-fence": "sell", "vendor-retainer": "job", "rk-collect": "racket",
    "guard-bribe": "bribe", "official-grease": "bribe", "vip-bench-pay": "bribe",
    "guard-card": "keycard",
    "power-detail-stop": "pass", "power-pay-respects": "pass", "power-detail-word": "pass",
    "cop-surrender": "law", "cop-alibi": "law",
    "official-petition": "politics", "official-endorse": "politics", "vip-endorse": "politics", "run-sign": "politics",
  };
  const PREFIX = [["rs-", "restrain"], ["fol-", "crew"], ["gp-", "gunpoint"]];
  function kindOf(o) {
    const id = String((o && o.id) || "");
    if (VERB_OF[id]) return VERB_OF[id];
    for (let i = 0; i < PREFIX.length; i++) if (id.indexOf(PREFIX[i][0]) === 0) return PREFIX[i][1];
    return null;
  }

  /* ======================================================================
     THE TABLE: role -> the acts that person answers to
     ====================================================================== */
  const ROLE_VERBS = {
    // a stranger: your fist, your hand in his pocket, a gun in his face, a
    // threat if you outrank him, his trade if he has one, a place in your crew
    civ:      ["fight", "rob", "gunpoint", "pickpocket", "threaten", "talk", "service", "recruit", "gang", "restrain", "politics", "pass"],
    // a set's soldier: the same, plus the road into his crew (and his corner's product)
    gang:     ["fight", "rob", "gunpoint", "pickpocket", "threaten", "talk", "service", "gang", "recruit", "restrain", "pass"],
    // your own people take orders; nobody mugs his own man from a menu
    crew:     ["crew", "talk", "restrain"],
    // the law: give up, bluff, pay, or swing on him
    cop:      ["law", "bribe", "fight", "restrain"],
    // a guard guards something: he lets you through for money, he looks away,
    // you take his card, or you go through him
    security: ["bribe", "keycard", "pass", "fight", "gunpoint", "restrain", "talk"],
    // a keeper: buy his stock, sell to the pawnbroker, rob the register
    vendor:   ["buy", "sell", "rob", "racket", "job", "fight", "restrain"],
    // a man with a seat: politics, money, pressure
    official: ["politics", "bribe", "threaten", "pass", "fight", "gunpoint", "restrain"],
  };
  const SETS = {};
  for (const r in ROLE_VERBS) { SETS[r] = Object.create(null); ROLE_VERBS[r].forEach(function (k) { SETS[r][k] = 1; }); }
  const unclassified = Object.create(null);
  function allows(role, o) {
    if (!o || o.anyone) return true;            // an order about anyone (the President's force)
    const k = kindOf(o);
    if (!k) { unclassified[o.id || "?"] = 1; return true; }
    const S = SETS[role] || SETS.civ;
    return !!S[k];
  }

  /* ======================================================================
     THE NAME OVER HIM
     ====================================================================== */
  // the muted role under a name on the desktop card (and the whole line for a
  // stranger): your crew, his gang, Security
  function pedRole(p) {
    if (p.recruited || p.companion || p.gang === "player") return "Your crew";
    if (p.kind === "security" || p.archetype === "security") return "Security";
    if (p.gang) {
      const r = (CBZ.cityGangs || []).find(function (x) { return x.id === p.gang; });
      return r && r.name ? String(r.name).replace(/^the /i, "") : "";
    }
    return "";
  }
  // a cop's name tag: the rank police.js gave him, and a surname that stays his
  const COP_NAMES = ["Ruiz", "Doyle", "Okafor", "Brennan", "Castillo", "Haines", "Novak", "Pryor", "Delgado", "Walsh", "Kimura", "Ferreira", "Lund", "Abara", "Mercer", "Szabo"];
  let copSeq = 0;
  function copTitle(c) {
    const rank = String(c.name || "Officer");
    if (rank !== "Officer") return rank;          // SWAT, a sergeant's pip
    if (!c._tagName) c._tagName = COP_NAMES[(copSeq++ * 7) % COP_NAMES.length];
    return "Officer " + c._tagName;
  }
  const KEEPER = {
    bank: "Teller", pawn: "Pawnbroker", guns: "Gun dealer", jewelry: "Jeweler", bar: "Bartender",
    barber: "Barber", hospital: "Nurse", food: "Cook", gas: "Clerk", drugs: "Dealer", hardware: "Clerk",
    electronics: "Clerk", clothing: "Clerk", carlot: "Car dealer", chop: "Chop shop", gym: "Trainer",
    casino: "Cashier", realtor: "Realtor", security: "Security desk",
  };
  const GUARD = { "vault guard": "Vault guard", "sheriff's deputy": "Deputy", "soldier": "Soldier", "ranger": "Ranger", "park ranger": "Ranger" };
  function titleOf(p) {
    if (!p) return "";
    if (p._presStaff === "chief") return "Chief of Staff " + surname(p.name);
    if (p._presStaff === "press") return "Press Secretary " + surname(p.name);
    if (p._presOfficer || p._presStaff || p._congress || p._presOffice) return String(p.name || "");
    if (p.kind === "cop") return copTitle(p);
    if (p.vendor) return KEEPER[(p.vendor && p.vendor.kind) || ""] || "Store owner";
    const seat = seatOf(p);
    if (seat && CBZ.officialdom.titleOf) {
      let t = ""; try { t = CBZ.officialdom.titleOf(seat.rec, seat.deputy); } catch (e) { t = ""; }
      if (t) return t + " " + surname(p.name);
    }
    if (LAWFUL_VIP[p.vipTitle]) return p.vipTitle + " " + surname(p.name);
    if (p.nameKnown && p.name) return String(p.name);      // you know him
    const role = roleOf(p);
    if (role === "security") return GUARD[jobOf(p)] || "Security";
    const r = pedRole(p);
    if (r) return r;
    if (p.vipTitle) return String(p.vipTitle);
    if (p._milliTitle) return String(p._milliTitle);
    // a working man with something to sell you wears his trade
    if (CBZ.cityRoleVerbs && CBZ.cityRoleVerbs[jobOf(p)]) return cap(jobOf(p));
    return "";
  }
  // the card header for every kind of person (one line; the desktop card,
  // the tap wheel and the gunpoint card all print it)
  function header(p) { return { label: titleOf(p), note: "" }; }
  I.describe("ped", header);
  I.describe("ped:gunpoint", header);
  I.describe("cop", header);
  I.describe("vendor", header);
  CBZ.cityPedRole = pedRole;
  CBZ.cityPersonTitle = titleOf;

  /* ======================================================================
     THREATEN — a civilian you plainly outrank (12+ levels on the street
     read) backs off; one who dares squares up. Fear is leverage that lasts:
     a feared mark folds to a shakedown later (interact.js ped-shakedown).
     ====================================================================== */
  function lvl(a) { return CBZ.cityLevel ? CBZ.cityLevel(a) : 10; }
  function myLvl() { return CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : lvl(CBZ.player); }
  function threatenable(p, ctx) {
    if (!p || p.dead || p.vendor || p.surrender || p.rage || p.restraint || p.hostage) return false;
    if (p.state === "fight" || p.state === "flee" || (ctx && (ctx.driving || ctx.gunDrawn))) return false;
    return myLvl() >= lvl(p) + 12;
  }
  function threaten(p) {
    if (CBZ.cityMeet) { try { CBZ.cityMeet(p); } catch (e) {} }
    const P = pa();
    act("threaten", p);
    const dares = P && CBZ.citySizeUp && CBZ.citySizeUp(p, P) && ((p.aggr || 0.3) >= 0.6 || p.armed);
    if (dares) {
      if (CBZ.cityRelShift) CBZ.cityRelShift(p, "snubbed", 0.6);
      p.rage = P; p.state = "confront"; p.fear = 0;
      sayT(p, "scoffFight", "You threatening me?");
      return;
    }
    if (CBZ.cityRelShift) CBZ.cityRelShift(p, "intimidated", 1.3);
    p.alarmed = Math.max(p.alarmed || 0, 4);
    p.fear = Math.min(10, (p.fear || 0) + 3);
    sayT(p, "cower", "Okay, okay.");
    if (P && CBZ.cityScare) { try { CBZ.cityScare(p, P, { bias: 0.25 }); } catch (e) {} }
  }
  I.register("ped:civ", {
    id: "ped-threaten", prio: 12, bad: true,
    canShow: function (p, ctx) { return threatenable(p, ctx); },
    label: "Threaten",
    onSelect: function (p) { threaten(p); },
  });

  /* ======================================================================
     BRIBE — what the money buys depends on what he guards:
       a cop        one star off your file (wanted.js), 1-3 stars only
       a guard on an occupied building (occupy.js)
                    a pass to it: its floors stop reading you as an intruder
       a guard at a shop door, while you are wanted
                    he looks the other way for two minutes (security.js)
     ====================================================================== */
  const PASS_PRICE = { staff: 150, faction: 450, vip: 1500 };
  function passHeld(lot) {
    const occ = lot && lot._occupancy, P = pa();
    return !!(occ && P && P._occupyPass && P._occupyPass[occ.id]);
  }
  function bribeDeal(p, ctx) {
    if (!p || p.dead || p.restraint || p.hostage || p._bribeBurned) return null;
    const stars = (ctx ? ctx.wanted : g.wanted) | 0;
    const role = roleOf(p);
    if (role === "cop") {
      if (stars < 1 || stars > 3) return null;
      return { kind: "heat", price: 250 * stars };
    }
    if (role !== "security") return null;
    if (p.rage && p.rage === pa()) return null;   // mid-fight is not a negotiation
    const lot = p.protectLot;
    if (lot && lot._occupancy && !passHeld(lot)) {
      const lvlNeed = p._occupyAccess || "staff";
      return { kind: "pass", price: Math.round((PASS_PRICE[lvlNeed] || 150) * (1 + 0.5 * stars)), lot: lot, level: lvlNeed };
    }
    if (stars >= 1 && (p._lookAwayUntil || 0) < nowS()) return { kind: "look", price: 60 * stars };
    return null;
  }
  function bribe(p, ctx) {
    const d = bribeDeal(p, ctx);
    if (!d) return;
    if (!(CBZ.city && CBZ.city.canAfford && CBZ.city.canAfford(d.price))) { say(p, "That's not a serious number."); return; }
    // a manhunt makes an honest man of anybody: past two stars a cop may refuse,
    // and then you have offered a bribe to a policeman
    if (d.kind === "heat" && ((g.wanted | 0) >= 3 ? 0.5 : 0.85) < Math.random()) {
      p._bribeBurned = true;
      say(p, "You're trying to buy me? Hands where I can see them.");
      if (CBZ.cityCrime) CBZ.cityCrime(40, { instant: true, x: p.pos.x, z: p.pos.z, type: "lying-to-police" });
      p.curTarget = pa(); p.retarget = 0;
      return;
    }
    CBZ.city.spend(d.price);
    p.cash = (p.cash | 0) + d.price;
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    act("bribe", p);
    if (d.kind === "heat") {
      if (CBZ.cityReduceWanted) CBZ.cityReduceWanted(1);
      p.curTarget = null; p.sees = false; p.retarget = 2.5; p.arrestT = 0;
      say(p, "Get out of here. Now.");
    } else if (d.kind === "pass") {
      if (CBZ.cityOccupyGrant) CBZ.cityOccupyGrant(d.lot, d.level, pa());
      p.alarmed = 0; p.mem = null;
      say(p, "Go on. I never saw you.");
    } else {
      p._lookAwayUntil = nowS() + 120;
      p.snitch = 0; p.reactCD = Math.max(p.reactCD || 0, 90); p.alarmed = 0;
      if (p.mem === pa()) p.mem = null;
      say(p, "Didn't see a thing.");
    }
  }
  I.register("ped", {
    id: "guard-bribe", prio: 30, bad: true,
    canShow: function (p, ctx) { return !(ctx && ctx.driving) && !!bribeDeal(p, ctx); },
    label: function (p, ctx) { const d = bribeDeal(p, ctx); return "Bribe " + money(d ? d.price : 0); },
    onSelect: function (p, ctx) { bribe(p, ctx); },
  });

  /* ======================================================================
     TAKE CARD — the keycard on a guard's belt (city/keys.js: bank.js gives
     the vault guard the vault's key). Clean off a man who is down, cuffed, a
     hostage or has his hands up; off a man on his feet it is a snatch that
     works two times in five, and either way he knows: it is a theft, and a
     guard who still can fights you for it.
     ====================================================================== */
  function hasCard(p) { return !!(CBZ.cityKeys && CBZ.cityKeys.pedKeys && CBZ.cityKeys.pedKeys(p).length); }
  function subdued(p) { return !!(p.ko > 0 || p.surrender || p.restraint || p.hostage || p.state === "surrender" || (p._phys && p._phys.down > 0)); }
  function takeCard(p) {
    const P = pa();
    const down = subdued(p);
    const done = function () {
      if (p.dead && !down) return;
      const ok = down || Math.random() < 0.4;
      if (ok) CBZ.cityKeys.lift(p, down ? "gunpoint" : "pickpocket");
      if (down) return;
      // he felt the hand on his belt
      if (CBZ.cityCrime) CBZ.cityCrime(35, { x: p.pos.x, z: p.pos.z, type: "theft" });
      p.alarmed = Math.max(p.alarmed || 0, 6); p.mem = P;
      if (P) { p.rage = P; p.state = "fight"; p.fear = 0; }
      say(p, ok ? "Hey! Give that back!" : "Hands off!");
      if (CBZ.cityAlarm && P) CBZ.cityAlarm(p.pos.x, p.pos.z, 14, 0.8, P);
    };
    const V = CBZ.verbs;
    let S = null;
    if (V && V.takeFrom) { try { S = V.takeFrom(CBZ.player, p, { at: "pocketR", kind: "key", pose: "card", dur: 0.45, onTaken: done }); } catch (e) { S = null; } }
    if (!S) done();
  }
  I.register("ped:civ", {
    id: "guard-card", prio: 28, bad: true,
    canShow: function (p, ctx) { return !(ctx && ctx.driving) && !p.dead && roleOf(p) === "security" && hasCard(p); },
    label: "Take card",
    onSelect: function (p) { takeCard(p); },
  });

  /* ---- probe ---------------------------------------------------------- */
  CBZ.cityRoles = {
    roleOf: roleOf, titleOf: titleOf, pedRole: pedRole, allows: allows, kindOf: kindOf,
    ROLE_VERBS: ROLE_VERBS, VERB_OF: VERB_OF,
    audit: function () { return { roles: Object.keys(ROLE_VERBS), unclassified: Object.keys(unclassified) }; },
  };
})();
