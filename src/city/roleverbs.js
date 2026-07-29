/* ============================================================
   city/roleverbs.js — A ROLE IS A VERB, AND SO IS A THING ON THE STREET.

   OWNER (2026-07-27): "NPCs just feel meaningless" and "interaction popups
   with objects is a huge thing — every single thing in the game, every role
   should matter somehow or why should it exist, and it doesn't have to matter
   a lot."

   The second half of that sentence is the whole design brief. A doctor does
   not need a hospital minigame; a doctor needs to be somebody you can walk up
   to, bleeding, and pay to stop bleeding. Before this file the city cast SIXTY
   declared trades (aigoals.js CITY_JOBS + citystaff.js TRADES) and exactly
   FOUR of them could be addressed at all — shops.js's mechanic, cab driver,
   street vendor and the law-class grease. Everybody else was a pill over a
   head. There was no way to be healed by a medic ANYWHERE in the game.

   THE SEAM, and it is the only interesting decision here: this is not forty
   registrations. It is TWO tables and TWO registrations, copied from the two
   in-repo precedents that already work —
     • interact.js's VERB table (object kind -> verb row, consumed by ONE
       registration for all 26 storefront kinds), and
     • citystaff.js's TRADES (a data block additively merged into a table
       another file owns).
   So ROLE_VERBS below is keyed on the SAME job strings CBZ.cityJobs owns, and
   OBJECT_VERBS on the SAME type strings city.streetProps carries. Adding a
   trade or a prop is a ROW. It is never a registration.

   THE LAW EVERY ROW OBEYS: an effect must MOVE something the world already
   reads — cash, hp, maxHp, hunger, an econ item, a mission, respect, panic,
   heat, nameKnown, a relationship. A verb that writes a field nothing reads is
   a stat fiction and CLAUDE.md bans it. Every number below either comes from
   the primitive it spends through or is derived from a constant somebody else
   already authored (the bar's $12 round, the meter's own coin hash, the HUD's
   heart ceiling); nothing here invents a second economy, a second heal or a
   second objective machine.

   WHAT THIS FILE DELIBERATELY DOES NOT DO: draw a card, own a key, toast a
   popup, or add a touch control. Every row rides city/interactions.js, which
   already turns a registered option into a keyboard row AND a tappable verb
   pill, on both inputs, with no per-verb work. HUD doctrine: the killfeed is
   the only popup; feedback here is notes, barks and the cash/HP ticks.

   ONE THING WORTH KNOWING BEFORE YOU ADD A SLOT: interactions.js's
   resolveRows() renders exactly ONE row (keyed "e") no matter what `slot` an
   option declares — `slot` survives only as a +18 nudge inside choiceScore for
   the authored primary. A second option on slot "j" would therefore be dead
   code. Context branching here is done the way the registry actually wants it:
   canShow + prio, one winner.

   Flags: CBZ.CONFIG.ROLE_VERBS / CBZ.CONFIG.OBJECT_VERBS — both read INSIDE
   the gates, so either is a live one-line revert to the pre-file street.
   Ratchets: CBZ.roleVerbAudit() / CBZ.objectVerbAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;
  const I = CBZ.interactions;
  if (!I) return;                     // registry absent -> this file is inert

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.ROLE_VERBS == null) CBZ.CONFIG.ROLE_VERBS = true;
  if (CBZ.CONFIG.OBJECT_VERBS == null) CBZ.CONFIG.OBJECT_VERBS = true;

  const REACH = I.REACH;              // 3.8 — the shared interaction reach

  /* ---------------------------------------------------------------- basics */
  function econ() { return CBZ.cityEcon || null; }
  function now() { return (typeof CBZ.now === "number") ? CBZ.now : (Date.now ? Date.now() : 0); }
  function dayNow() { return (typeof CBZ.dayCount === "function") ? CBZ.dayCount() : -1; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + n; }
  function note(s, t) { if (CBZ.city && CBZ.city.note && s) CBZ.city.note(s, t || 2); }
  function say(p, line) { if (CBZ.citySay && p && !p.dead && line) CBZ.citySay(p, line, "#cfe6ff", 2.2); }
  function coin() { if (CBZ.sfx) CBZ.sfx("coin"); }
  // THE WORKER IS PAID. Mirrors shops.js's mechanic/cab/cart rows exactly: the
  // money leaves your wallet and lands in THEIR pocket, so mugging the man you
  // just paid gets it back and the street is not a money printer.
  function paid(p, n) { if (p) p.cash = (p.cash | 0) + (n | 0); }

  // WHO IS WORKING — the promoted accessors (city/level.js). Degrade-safe: the
  // pre-promotion read is the fallback, so this file cannot break on an older
  // level.js.
  function jobOf(p) { return CBZ.cityPedJob ? CBZ.cityPedJob(p) : ((p && p.job) || ""); }
  function classOf(p) {
    if (CBZ.cityPedJobClass) return CBZ.cityPedJobClass(p);
    const J = CBZ.cityJobs && CBZ.cityJobs[jobOf(p)];
    return (J && J.class) || "";
  }
  function jobRec(job) { return (CBZ.cityJobs && CBZ.cityJobs[job]) || null; }

  // ON SHIFT? The job table already declares the window (CITY_JOBS .hours, a
  // wrapping [open, close] pair — a bartender is [17, 2]). Only the WORK-FOR-
  // PAY row consults it: a yard that is shut cannot put you on the clock,
  // while a doctor asked for help at 3 a.m. is still a doctor. Degrade-safe —
  // no city clock means always open.
  function onShift(job) {
    const J = jobRec(job); if (!J || !J.hours) return true;
    if (!CBZ.cityHour) return true;
    const h = CBZ.cityHour(), a = J.hours[0], b = J.hours[1];
    return (a <= b) ? (h >= a && h < b) : (h >= a || h < b);
  }

  // the shared "can I even talk to this person" gate every role row starts from
  function addressable(p, ctx) {
    if (CBZ.CONFIG.ROLE_VERBS === false) return false;
    if (!p || p.dead || p.vendor || p.rage || p.controlled) return false;
    if (p.state === "flee" || p.state === "fight") return false;
    if (ctx && ctx.driving) return false;
    return true;
  }

  function P() { return CBZ.player; }
  function maxHp() { return (P() && P().maxHp) || 200; }
  function hpNow() { return (P() && P().hp) || 0; }

  /* ==========================================================================
     THE MEDIC. The headline, because it is the hole the census found: no path
     in this entire game healed the player off another human being. The price
     scales with what is actually restored, so you never overpay for a scratch,
     and the ladder is a real hierarchy of competence — a doctor closes you up,
     a nurse cleans you up, a paramedic is somewhere between. The one number
     that is not a taste is the PARAMEDIC'S EMERGENCY RATE: below 35 hp he
     treats you first and bills you like a public service, because that is what
     the trade IS, and it is the moment the verb matters most.
     ========================================================================== */
  const MEDIC = {
    "doctor":    { rate: 1.40, frac: 1.00, line: "“Hold still. This is going to sting.”" },
    "nurse":     { rate: 1.00, frac: 0.70, line: "“I can close that. See a doctor about the rest.”" },
    "paramedic": { rate: 0.90, frac: 0.85, line: "“Sit down. Let me look at it.”" },
  };
  function medicQuote(p) {
    const mx = maxHp(), missing = Math.max(0, mx - hpNow());
    if (missing < 6) return null;                       // nothing to treat
    const job = jobOf(p);
    const M = MEDIC[job] || MEDIC["nurse"];
    const crit = (job === "paramedic") && hpNow() < 35;
    const heal = Math.max(1, Math.round(missing * (crit ? 1 : M.frac)));
    const price = Math.max(15, Math.round(heal * (crit ? 0.45 : M.rate)));
    return { heal: heal, price: price, crit: crit, line: M.line, mx: mx };
  }
  const ROW_MEDIC = {
    id: "rv-medic",
    can: function (p) { return !!medicQuote(p); },
    label: function (p) {
      const q = medicQuote(p); if (!q) return "Get patched up";
      return (q.crit ? "Emergency treatment — " : "Get patched up — ") + money(q.price);
    },
    run: function (p) {
      const q = medicQuote(p); if (!q) return;
      if (!CBZ.city.spend(q.price)) { note("A patch-up runs " + money(q.price) + " — you're short.", 1.8); return; }
      const pl = P();
      pl.hp = Math.min(q.mx, hpNow() + q.heal);
      if (pl._bleeding) pl._bleeding = 0;                // a dressed wound stops bleeding
      paid(p, q.price);
      coin(); say(p, q.line);
      note("Patched up — " + Math.round(pl.hp) + "/" + Math.round(q.mx) + " for " + money(q.price) + ".", 2);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
  };

  /* ------------------------------------------------------- the bar and pot */
  // A ROUND, priced and pouring EXACTLY like the bar counter's own buyDrink
  // (shops.js: $12, +15 hunger, a 12 s boost, +8 hp, one unit into drinking.js).
  // The bartender off the counter is the same round; re-pricing it would have
  // made the same drink cost two different amounts in one city.
  const ROW_DRINK = {
    id: "rv-drink",
    can: function () { return true; },
    label: function () { return "Order a drink — $12"; },
    run: function (p) {
      if (!CBZ.city.spend(12)) { note("Need $12 for a round.", 1.4); return; }
      coin();
      g.hunger = Math.min(100, (g.hunger || 0) + 15);
      P()._boost = 12;
      P().hp = Math.min(maxHp(), hpNow() + 8);
      if (CBZ.cityDrink) CBZ.cityDrink(1);
      paid(p, 12);
      say(p, "“One more and you're walking home.”");
      note("A round — loosened up.", 1.8);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
  };

  // A PLATE OFF THE LINE. Routed through the ONE hunger primitive (CBZ.cityEat)
  // by handing the item over first — so the cook's plate feeds you through the
  // same call a burger from a counter does, note, sfx, HUD and all.
  const PLATE = "Burger";
  function platePrice() {
    const e = econ(); if (!e || !e.ITEMS || !e.ITEMS[PLATE]) return 0;
    return Math.max(5, Math.round((e.buyPrice ? e.buyPrice(PLATE) : e.ITEMS[PLATE].value) * 0.9));
  }
  const ROW_PLATE = {
    id: "rv-plate",
    can: function () { return platePrice() > 0 && (g.hunger || 0) < 96 && !!CBZ.cityEat; },
    label: function () { return "Grab a plate — " + money(platePrice()); },
    run: function (p) {
      const price = platePrice(); if (!price) return;
      if (!CBZ.city.spend(price)) { note("A plate runs " + money(price) + ".", 1.4); return; }
      econ().add(PLATE, 1);
      CBZ.cityEat(PLATE);                                // the ONE eat path
      paid(p, price);
      say(p, "“Eat it while it's hot.”");
    },
  };

  /* ------------------------------------------------------------ the trainer */
  // THE CEILING IS DERIVED, NOT PICKED. hud.js's heart row is
  // Math.min(12, ceil(maxHp / 20)) — at 240 it saturates at twelve hearts and
  // every point above that is health the player can never SEE. A stat you
  // cannot read is the stat fiction this repo keeps banning, so the trainer
  // stops there. Small steps on purpose: the gym counter sells +10 for $100,
  // so a man on the street selling +2 for $60 is the worse deal, which is the
  // right relationship between a gym and a guy in a park.
  const TRAIN_CEIL = 240;
  const TRAIN_COST = 60;
  const ROW_TRAIN = {
    id: "rv-train",
    can: function () { return maxHp() < TRAIN_CEIL; },
    label: function () { return "Train — " + money(TRAIN_COST) + " (max HP " + Math.round(maxHp()) + ")"; },
    run: function (p) {
      if (maxHp() >= TRAIN_CEIL) { note("You're as conditioned as this body gets.", 1.6); return; }
      if (!CBZ.city.spend(TRAIN_COST)) { note("A session runs " + money(TRAIN_COST) + ".", 1.4); return; }
      const pl = P();
      pl.maxHp = Math.min(TRAIN_CEIL, maxHp() + 2);
      pl.hp = Math.min(pl.maxHp, hpNow() + 2);
      paid(p, TRAIN_COST);
      if (CBZ.city.addRespect) CBZ.city.addRespect(1);
      coin(); say(p, "“Again. Last two are the only ones that count.”");
      note("Trained — max HP " + Math.round(pl.maxHp) + ".", 1.8);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
  };

  /* ---------------------------------------------------------- the kerb chair */
  // A LINEUP OFF THE KERB. The price and the cut are shops.js's own $30
  // "Clean Shave + Lineup" row verbatim — the same cut must not cost two
  // different amounts in one city. The honest payoff is RESPECT (a real,
  // widely-read number: the ladder, the HUD, the club), which is exactly what
  // the barber counter pays for the same chair; `swagger` is set too, but it
  // is NOT what makes this row real — nothing outside shops.js reads it, and
  // a verb that only moved swagger would be the stat fiction this repo bans.
  const ROW_CUT = {
    id: "rv-cut",
    can: function () { return !!CBZ.cityLook; },
    label: function () { return "Get a lineup — $30"; },
    run: function (p) {
      if (!CBZ.city.spend(30)) { note("A lineup runs $30.", 1.4); return; }
      const L = CBZ.cityLook();
      L.hair = "Clean Shave + Lineup";
      L.swagger = Math.max(L.swagger || 0, 2);
      paid(p, 30);
      if (CBZ.city.addRespect) CBZ.city.addRespect(2);
      coin(); say(p, "“Chair's the kerb today. Hold still.”");
      note("Fresh lineup — you look like somebody.", 1.8);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    },
  };

  /* -------------------------------------------------------- honest day work */
  // LEND A HAND. The payout is the job's OWN declared wage (CITY_JOBS .pay,
  // $/sim-hour) times three — a few hours of graft, priced by the table rather
  // than by me, so a dock worker's shift is worth more than a farmhand's for
  // the reason the table already says it is. Bounded HARD: once per worker per
  // city day, and only while that trade's declared shift is actually running.
  function handPay(p) {
    const J = jobRec(jobOf(p));
    return Math.max(15, Math.round(((J && J.pay) || 10) * 3));
  }
  function handSpent(p) {
    const d = dayNow();
    return d >= 0 ? (p._rvHandDay === d) : !!p._rvHandOnce;
  }
  function handStamp(p) {
    const d = dayNow();
    if (d >= 0) p._rvHandDay = d; else p._rvHandOnce = true;
  }
  const ROW_HAND = {
    id: "rv-hand",
    can: function (p) { return !handSpent(p) && onShift(jobOf(p)); },
    label: function (p) { return "Lend a hand — " + money(handPay(p)); },
    run: function (p) {
      if (handSpent(p)) { note("They've nothing left for you today.", 1.6); return; }
      const amt = handPay(p);
      handStamp(p);
      CBZ.city.addCash(amt);
      if (CBZ.city.addRespect) CBZ.city.addRespect(1);
      coin();
      say(p, "“Grab the other end. Cash at the end of it.”");
      note("Worked the shift — " + money(amt) + " in hand.", 2);
    },
  };

  /* ------------------------------------------------------ off the land/water */
  // Two new catalog rows, registered the way wildlife.js already registers a
  // pelt: straight into CBZ.cityEcon.ITEMS, guarded, only if absent. They are
  // real items — edible through cityEat, carried, fenceable — not a receipt.
  const FARM_GOODS = {
    "Fresh Produce": { value: 6,  tag: "food", heal: 34 },
    "Fresh Cut":     { value: 11, tag: "food", heal: 48 },
  };
  function ensureGood(name) {
    const e = econ(); if (!e || !e.ITEMS) return false;
    if (!e.ITEMS[name]) {
      const d = FARM_GOODS[name]; if (!d) return false;
      e.ITEMS[name] = { value: d.value, tag: d.tag, heal: d.heal };
    }
    return true;
  }
  function goodPrice(name) {
    const e = econ(); if (!e || !e.ITEMS || !e.ITEMS[name]) return 0;
    return Math.max(3, Math.round(e.buyPrice ? e.buyPrice(name) : e.ITEMS[name].value));
  }
  function buyGood(p, name, verb) {
    if (!ensureGood(name)) return;
    const price = goodPrice(name); if (!price) return;
    if (!CBZ.city.spend(price)) { note(name + " runs " + money(price) + ".", 1.4); return; }
    econ().add(name, 1);
    paid(p, price);
    coin(); say(p, verb);
    note("Bought " + name + " — " + money(price) + ".", 1.8);
  }
  const ROW_PRODUCE = {
    id: "rv-produce",
    can: function () { return ensureGood("Fresh Produce"); },
    label: function () { return "Buy fresh produce — " + money(goodPrice("Fresh Produce")); },
    run: function (p) { buyGood(p, "Fresh Produce", "“Picked this morning. Straight off the field.”"); },
  };
  const ROW_MEAT = {
    id: "rv-meat",
    can: function () { return ensureGood("Fresh Cut"); },
    label: function () { return "Buy a fresh cut — " + money(goodPrice("Fresh Cut")); },
    run: function (p) { buyGood(p, "Fresh Cut", "“Off the herd this week. You won't do better.”"); },
  };
  // THE CATCH is not a new item at all: wildlife.js already registers
  // "Fresh Fish" into the catalog off aquatic.js's species record, which is why
  // fishing.js owns no fish table either. If nothing has registered it, the
  // fisherman simply has nothing to sell and the verb never surfaces.
  const ROW_CATCH = {
    id: "rv-catch",
    can: function () { const e = econ(); return !!(e && e.ITEMS && e.ITEMS["Fresh Fish"]); },
    label: function () {
      const e = econ(), v = (e && e.ITEMS["Fresh Fish"] && e.ITEMS["Fresh Fish"].value) || 8;
      return "Buy the catch — " + money(Math.round(v * 1.3));
    },
    run: function (p) {
      const e = econ(); if (!e || !e.ITEMS || !e.ITEMS["Fresh Fish"]) return;
      const price = Math.max(5, Math.round(e.ITEMS["Fresh Fish"].value * 1.3));
      if (!CBZ.city.spend(price)) { note("The catch runs " + money(price) + ".", 1.4); return; }
      e.add("Fresh Fish", 1);
      paid(p, price);
      coin(); say(p, "“Still wet. Take it before the gulls do.”");
      note("Bought Fresh Fish — " + money(price) + ".", 1.8);
    },
  };

  /* -------------------------------------------------------------- the run */
  // A DELIVERY RUN. contracts.js's binding rule, verbatim: the generator picks
  // the VERB, the WORLD supplies the specifics. Nothing is spawned — the drop
  // is a lot the city already built, uniformly reservoir-sampled out of the
  // band that makes a run feel like a run, and if the world cannot supply one
  // the courier does not offer the job at all. The objective, the HUD line,
  // the waypoint, the beacon, the phone card and the payout are all
  // core/mission.js's; this authors none of them.
  const RUN_MIN = 140, RUN_MAX = 900, DEST_TTL = 6000;
  function runDest(p) {
    if (p._rvDest && p._rvDestT > now()) return p._rvDest;
    const A = CBZ.city && CBZ.city.arena, lots = A && A.lots;
    p._rvDestT = now() + DEST_TTL;
    p._rvDest = null;
    if (!lots || !lots.length) return null;
    const pl = P();
    let pick = null, n = 0;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished) continue;
      const b = l.building, d = b && b.door;
      if (!d) continue;
      const dist = Math.hypot(d.x - pl.pos.x, d.z - pl.pos.z);
      if (dist < RUN_MIN || dist > RUN_MAX) continue;
      if (Math.random() * (++n) < 1) pick = { x: d.x, z: d.z, dist: dist, name: b.name || null };
    }
    if (pick) pick.reward = Math.max(70, Math.min(400, Math.round(70 + pick.dist * 0.30)));
    p._rvDest = pick;
    return pick;
  }
  const ROW_RUN = {
    id: "rv-run",
    can: function (p) {
      if (!CBZ.mission || CBZ.CONFIG.MISSION_BLOCK === false) return false;
      if (CBZ.mission.busy && CBZ.mission.busy()) return false;
      if (g.cityJob) return false;
      return !!runDest(p);
    },
    label: function (p) { const d = runDest(p); return "Take a delivery run — " + money(d ? d.reward : 0); },
    run: function (p) {
      const d = runDest(p); if (!d) return;
      const where = d.name || "the address";
      const m = CBZ.mission.start({
        id: "roleverb:run",
        title: "Delivery run",
        giver: p.name || "a courier",
        goal: "deliver",
        at: { x: d.x, z: d.z },
        radius: 6,
        label: where,
        text: "Drop the parcel at " + where,
        brief: "A courier handed you a parcel and an address.",
        reward: d.reward,
        onComplete: function () {
          if (CBZ.city.addRespect) CBZ.city.addRespect(1);
          say(p, "“Signed for. There's more where that came from.”");
        },
      });
      if (!m || m.inert) { note("No runs going out right now.", 1.6); return; }
      p._rvDest = null;                                  // consumed; re-roll next time
      say(p, "“Take this to " + where + ". " + money(d.reward) + " on delivery.”");
    },
  };

  /* ---------------------------------------------------------- the casino floor */
  function nearestLotKind(kind) {
    const A = CBZ.city && CBZ.city.arena, lots = A && A.lots;
    if (!lots) return null;
    const pl = P();
    let best = null, bd = Infinity;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished || l.kind !== kind || !l.building) continue;
      if (!isFinite(l.cx) || !isFinite(l.cz)) continue;
      const d = Math.hypot(l.cx - pl.pos.x, l.cz - pl.pos.z);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  // A CROUPIER POINTS AT THE FLOOR. The verb's whole content is routing, so it
  // does the routing for real (the shared map waypoint every objective uses)
  // rather than narrating it — and it does not exist at all in a world with no
  // casino, which is the same law the delivery run runs on.
  const ROW_TABLES = {
    id: "rv-tables",
    can: function () { return !!(CBZ.fullMap && CBZ.fullMap.setWaypoint && nearestLotKind("casino")); },
    label: function () { return "Ask about the tables"; },
    run: function (p) {
      const lot = nearestLotKind("casino"); if (!lot) return;
      const nm = (lot.building && lot.building.name) || "the casino";
      CBZ.fullMap.setWaypoint(lot.cx, lot.cz, nm);
      if (CBZ.cityMeet) CBZ.cityMeet(p);
      say(p, "“Floor's open. Cage is by the door — don't embarrass me.”");
      note("Marked " + nm + " on your map.", 2.2);
    },
  };

  /* -------------------------------------------------------------- the lift */
  // THE CHAUFFEUR REUSES THE FARE. shops.js owns the only "somebody drives you
  // across town" effect in this game (the cab's meter + crosstown drop); it is
  // exported now, so an estate driver hires out on the SAME meter instead of a
  // second teleport-and-charge. Refused at 2 stars for the cab's own reason: a
  // driver with a licence does not carry a manhunt.
  const ROW_LIFT = {
    id: "rv-lift",
    can: function (p, ctx) {
      return !!(CBZ.cityCabRide && CBZ.cityCabFare && CBZ.cityCabFare() > 0 && (ctx.wanted | 0) < 2);
    },
    label: function () { return "Ask for a lift — " + money(CBZ.cityCabFare()); },
    run: function (p) { CBZ.cityCabRide(p); },
  };

  /* ------------------------------------------------------------- the counter */
  // THE DESK JOBS DELEGATE. city/insurance.js owns the branch, the ladder, the
  // book and the money; what it needs from HERE is a row, because this file is
  // the one registration that turns a trade into a keyboard line and a tappable
  // pill on both inputs. One shared row for all five insurance rungs — WHICH
  // verb you get is a rank question and the owning file answers it, so a new
  // rung never touches this file either.
  //
  // Written as a delegate rather than inline for the same reason ROW_LIFT calls
  // shops.js's fare: the effect belongs to whoever owns the balance it moves.
  const ROW_INSURANCE = {
    id: "rv-insurance",
    can: function (p, ctx) { return !!(CBZ.insuranceVerb && CBZ.insuranceVerb(p, ctx)); },
    label: function (p, ctx) { const v = CBZ.insuranceVerb && CBZ.insuranceVerb(p, ctx); return v ? v.label : ""; },
    run: function (p, ctx) { const v = CBZ.insuranceVerb && CBZ.insuranceVerb(p, ctx); if (v && v.run) v.run(p, ctx); },
  };

  /* =================== THE TABLE: job string -> one verb =================== */
  // Keyed on CBZ.cityJobs's own keys (aigoals.js CITY_JOBS + citystaff.js
  // TRADES). A new trade is a ROW. Rows are shared objects on purpose — a
  // farmhand and a dockhand lend the same hand.
  const ROLE_VERBS = {
    // --- medicine: the hole the census found. The last two are not a stretch
    // and they are the point: a lifeguard and a ski patroller ARE the trained
    // first responder standing exactly where this game drowns you and buries
    // you, so the heal lives where the injury lives (they bill at the nurse's
    // rate, which is what MEDIC's default row already is).
    "doctor": ROW_MEDIC, "nurse": ROW_MEDIC, "paramedic": ROW_MEDIC,
    "lifeguard": ROW_MEDIC, "ski patrol": ROW_MEDIC,
    // --- the counters that feed you
    "bartender": ROW_DRINK,
    "line cook": ROW_PLATE, "estate cook": ROW_PLATE, "shopkeeper": ROW_PLATE,
    // --- the body and the chair
    "personal trainer": ROW_TRAIN, "barber": ROW_CUT,
    // --- hands-on work: an hour of graft at the trade's own declared wage
    "construction worker": ROW_HAND, "warehouse worker": ROW_HAND, "dock worker": ROW_HAND,
    "farmhand": ROW_HAND, "yard hand": ROW_HAND, "dockhand": ROW_HAND, "deckhand": ROW_HAND,
    "groundskeeper": ROW_HAND, "baggage handler": ROW_HAND, "ramp agent": ROW_HAND,
    "lift operator": ROW_HAND, "ground crew": ROW_HAND, "boat mechanic": ROW_HAND,
    "refueller": ROW_HAND, "fuel attendant": ROW_HAND, "pushback driver": ROW_HAND,
    "aircraft marshaller": ROW_HAND,
    // --- off the land and the water
    "farmer": ROW_PRODUCE, "rancher": ROW_MEAT, "fisherman": ROW_CATCH,
    // --- somebody's parcel, somebody's address
    "courier": ROW_RUN, "delivery driver": ROW_RUN,
    "catering driver": ROW_RUN, "airfield driver": ROW_RUN,
    // --- the floor
    "croupier": ROW_TABLES, "cage cashier": ROW_TABLES, "pit boss": ROW_TABLES,
    // --- the wheel
    "chauffeur": ROW_LIFT,
    // --- the counter that pays when the roof comes in (city/insurance.js)
    "insurance clerk": ROW_INSURANCE, "insurance adjuster": ROW_INSURANCE,
    "underwriter": ROW_INSURANCE, "claims manager": ROW_INSURANCE,
    "insurance director": ROW_INSURANCE,
  };

  /* ------------------------------------------ the floor: one verb per class */
  // WHAT A PERSON KNOWS IS WHERE THEY WORK, and the world already stored it:
  // aigoals.js stamps ped._jobLot on a commuter, officejobs.js stamps
  // ped._workAnchor on an anchor worker, and CITY_JOBS declares the lot kinds
  // either way. So the floor verb never invents a workplace — it reads the one
  // the simulation routed them to, which is what makes the line TRUE.
  function workLine(p) {
    const l = p._jobLot;
    if (l && l.building) {
      const nm = l.building.name;
      if (nm) return "“I'm over at " + nm + " most days.”";
      if (l.kind) return "“I work the " + l.kind + " counter down the block.”";
    }
    const a = p._workAnchor;
    if (a && a.kind) return "“I work the " + a.kind + ".”";
    const J = jobRec(jobOf(p));
    if (J && J.anchor) return "“I'm out at the " + J.anchor + " most of the week.”";
    if (J && J.lots && J.lots.length) return "“You'll find me at the " + J.lots[0] + ".”";
    return "“Work's work. You get used to it.”";
  }
  // MEETING SOMEBODY IS A REAL CHANGE. cityMeet flips nameKnown — the card
  // stops calling them "A stranger" forever after — and the relationship shift
  // is the same one the registry applies to its own talk verbs. That is the
  // floor: small, honest, permanent.
  function greet(p) {
    if (CBZ.cityMeet) CBZ.cityMeet(p);
    if (CBZ.cityRelShift) CBZ.cityRelShift(p, "greeted", 0.4);
  }
  const ROW_ASK_TRADE = {
    id: "rv-ask-service",
    can: function () { return true; },
    label: function () { return "Ask what's good round here"; },
    run: function (p) { greet(p); say(p, workLine(p)); },
  };
  const ROW_ASK_BEAT = {
    id: "rv-ask-law",
    can: function () { return true; },
    label: function () { return "Ask about the beat"; },
    run: function (p) {
      greet(p);
      const stars = g.wanted | 0;
      say(p, stars >= 1 ? "“You want to be somewhere else. They're asking after you.”" : workLine(p));
    },
  };
  // A trade with no named verb still has hands, and a medic with no named verb
  // is still a medic — the class floor routes to the row that already exists
  // rather than inventing a fifth kind of small talk.
  const CLASS_FALL = {
    "service": ROW_ASK_TRADE,
    "trade":   ROW_HAND,
    "law":     ROW_ASK_BEAT,
    "medic":   ROW_MEDIC,
  };

  function rowFor(p) {
    const job = jobOf(p);
    if (!job) return null;
    return ROLE_VERBS[job] || null;
  }
  // THE FLOOR RESOLVES, IT DOES NOT JUST LOOK UP. A courier whose run is
  // refused because you are already carrying a job must not go silent — the
  // whole point of the floor is that a working person always has SOMETHING —
  // so the class row is skipped when it is the very row that just refused, and
  // the last resort is the one verb that can never refuse: ask them about the
  // work. That is what makes roleVerbAudit().withoutVerb structurally zero and
  // not merely usually zero.
  function fallFor(p, ctx, named) {
    const cls = classOf(p);
    if (!cls) return null;
    const primary = CLASS_FALL[cls] || null;
    if (primary && primary !== named && primary.can(p, ctx)) return primary;
    return (ROW_ASK_TRADE !== named) ? ROW_ASK_TRADE : null;
  }

  /* ------------------------------------------------ ONE registration, two rows */
  // Prios sit deliberately UNDER interact.js's crew/relationship ladder (60 /
  // 50 / 45 / 44 / 43) and under shops.js's mechanic (44) and cab (43): what
  // somebody is to YOU outranks what they do for a living. The named verb sits
  // at 42, the class floor at 8 — just above generic "Talk" (5), so a worker
  // always has something honest to offer and never shadows an authored verb.
  I.register("ped:civ", {
    id: "rv-role", slot: "k", prio: 42,
    canShow: function (p, ctx) {
      if (!addressable(p, ctx)) return false;
      const r = rowFor(p);
      return !!(r && r.can(p, ctx));
    },
    label: function (p, ctx) { const r = rowFor(p); return r ? r.label(p, ctx) : ""; },
    onSelect: function (p, ctx) { const r = rowFor(p); if (r) r.run(p, ctx); },
  });
  I.register("ped:civ", {
    id: "rv-role-floor", slot: "k", prio: 8,
    canShow: function (p, ctx) {
      if (!addressable(p, ctx)) return false;
      const named = rowFor(p);
      if (named && named.can(p, ctx)) return false;      // the named verb owns them
      return !!fallFor(p, ctx, named);
    },
    label: function (p, ctx) { const r = fallFor(p, ctx, rowFor(p)); return r ? r.label(p, ctx) : ""; },
    onSelect: function (p, ctx) { const r = fallFor(p, ctx, rowFor(p)); if (r) r.run(p, ctx); },
  });

  /* ---------------------------------------------------------- the archetype */
  // SCORE. The street had exactly one direction of trade — interact.js's
  // "Sell product" — so the player could deal to a dealer and never buy from
  // one. The ask is RETAIL (the same district street price the player SELLS
  // at, plus a cut), which means flipping what you just bought is a loss BY
  // CONSTRUCTION: no faucet, no cooldown needed, and the drug market's own
  // district engine still moves because the buy is recorded through it.
  const DRUGS = ["Weed", "Coke", "Meth"];
  function dealerDrug(p) {
    if (p._rvDrug) return p._rvDrug;
    const e = econ(); if (!e || !e.ITEMS) return null;
    const pool = [];
    for (let i = 0; i < DRUGS.length; i++) if (e.ITEMS[DRUGS[i]]) pool.push(DRUGS[i]);
    if (!pool.length) return null;
    // stable per dealer: the man on that corner sells what he sells
    const h = CBZ.hash01 ? CBZ.hash01(p.pos.x, p.pos.z, 8821) : Math.random();
    p._rvDrug = pool[Math.min(pool.length - 1, (h * pool.length) | 0)];
    return p._rvDrug;
  }
  function scorePrice(p) {
    const e = econ(), d = dealerDrug(p);
    if (!e || !d) return 0;
    const street = e.streetPrice ? e.streetPrice(d) : (e.ITEMS[d].value * 2);
    return Math.max(10, Math.round(street * 1.15));
  }
  I.register("ped:civ", {
    id: "rv-score", slot: "k", prio: 40, bad: true,
    canShow: function (p, ctx) {
      if (!addressable(p, ctx)) return false;
      if (p.archetype !== "dealer") return false;
      return scorePrice(p) > 0;
    },
    label: function (p) { return "Score " + dealerDrug(p) + " — " + money(scorePrice(p)); },
    onSelect: function (p) {
      const e = econ(), d = dealerDrug(p), price = scorePrice(p);
      if (!e || !d || !price) return;
      if (!CBZ.city.spend(price)) { say(p, "“Come back with the money.”"); return; }
      e.add(d, 1);
      if (e.recordBuy) e.recordBuy(d, 1);
      paid(p, price);
      coin(); say(p, "“Don't stand here with it.”");
      note("Scored " + d + " — " + money(price) + ".", 1.8);
    },
  });

  /* ==========================================================================
     OBJECT_VERBS — the same shape, keyed on city.streetProps types.

     props.js pushes a flat {x, z, type} record for every placed street prop,
     and interact.js's cityNearestStreetProp already filters that list by type
     — so a prop becomes usable by adding a ROW, exactly like a trade. What is
     NOT here is as deliberate as what is:
       • billboard — city/adboard.js already owns the walk-up at every board
         (rent it / pull your ad); a second verb would be a duplicate card.
       • bikerack  — there is no bicycle in this game. A rack you cannot chain
         anything to is scenery, and a verb over it would be a lie.
       • bin / newsbox / mailbox — interact.js already owns these.
       • dumpsters, crates, bollards and the rest of the detail kit are
         DK-instanced with no per-instance record at all, so there is nothing
         for a zone find() to return. They are structurally out of reach until
         somebody gives them records; that is a props.js change, not this one.
     ========================================================================== */
  // IS IT ALREADY BLOWING? props.js keeps the geyser on its SHOOTABLE record,
  // which is a different object from the streetProps record a zone find()
  // returns — same hydrant, two ledgers. cityShootProp hands the shootable
  // back, so the first crack PAIRS them and every gate afterwards reads the
  // real water instead of a timer that only this file knows about (which is
  // what would let a hydrant you shot still advertise a cap to crack).
  function gushing(sp) {
    const s = sp._rvShoot;
    if (s && s.gy && s.gy.t > 0) return true;
    return (sp._rvGushT || 0) > now();
  }

  const OBJECT_VERBS = {
    // ---- THE MAIN. props.js owns the geyser and only opens it through the
    // SHOT path, so the verb hands cityShootProp a one-metre segment laid
    // across the hydrant itself rather than re-authoring twenty seconds of
    // water. What makes this a verb and not a firework: a burst main is a
    // SCENE, and a scene is a real input to the simulation — peds.js decides
    // freeze-or-bolt off cityPanicAt, and cityAlarm is what turns heads. No
    // charge is filed: wanted.js's CRIME table has no vandalism row, and an
    // unknown id there logs a warning and charges nothing, so inventing one
    // would have been a stat fiction with a console warning attached.
    hydrant: {
      name: "Fire hydrant",
      note: function (sp) { return gushing(sp) ? "Blowing a column into the street" : "Cap's only finger-tight"; },
      bad: true,
      can: function (sp) { return !gushing(sp) && !!CBZ.cityShootProp; },
      label: function () { return "Crack the hydrant"; },
      run: function (sp) {
        const pl = P();
        let dx = sp.x - pl.pos.x, dz = sp.z - pl.pos.z;
        const m = Math.hypot(dx, dz) || 1; dx /= m; dz /= m;
        const hit = CBZ.cityShootProp(
          { x: sp.x - dx * 0.7, y: 0.5, z: sp.z - dz * 0.7 },
          { x: sp.x + dx * 0.3, y: 0.5, z: sp.z + dz * 0.3 });
        if (!hit || hit.type !== "hydrant") { note("The cap won't budge.", 1.4); return; }
        sp._rvShoot = hit;                               // pair the two ledgers, once
        sp._rvGushT = now() + 20000;                     // matches props.js's geyser life
        if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(sp.x, sp.z, 0.5);
        if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(sp.x, sp.z, 20, 0.7, CBZ.city.playerActor);
        note("The cap goes — the main comes straight up off the street.", 2);
      },
    },

    // ---- THE COIN BOX. props.js already pays a meter out when a PLAYER car
    // rams it (hash01 salt 4711 -> the coins THAT meter is holding). The same
    // salt is used here on purpose: a meter you jimmy and a meter you ram hold
    // the same money, because it is the same meter. Once each, and it is
    // witnessed petty theft through the one heat API.
    meter: {
      name: "Parking meter",
      note: function (sp) { return sp._rvJimmied ? "Coin box already popped" : "Coin box, one screw, no camera"; },
      bad: true,
      can: function (sp) { return !sp._rvJimmied; },
      label: function () { return "Jimmy the meter"; },
      run: function (sp) {
        if (sp._rvJimmied) { note("Nothing left in it.", 1.4); return; }
        sp._rvJimmied = true;
        const h = CBZ.hash01 ? CBZ.hash01(sp.x, sp.z, 4711) : Math.random();
        const coins = 8 + ((h * 18) | 0);                 // $8-25, fixed per meter
        CBZ.city.addCash(coins);
        coin();
        if (CBZ.cityCrime) CBZ.cityCrime(25, { x: sp.x, z: sp.z, type: "theft" });
        note("Popped the coin box — $" + coins + " in shrapnel.", 1.8);
      },
    },

    // ---- THE ROUTE BOARD. Every name on it is read off city.regions, the
    // registry worldmap.js has kept since it shipped, so the board cannot
    // advertise a place that does not exist. It marks the first stop for real
    // through the shared map waypoint — a route board that only TALKS about
    // where the bus goes is a poster, not a board.
    busstop: {
      name: "Bus stop",
      note: function () { return "Timetable and a route board"; },
      can: function () { return true; },
      label: function () { return "Check the route"; },
      run: function (sp) {
        const legs = routeLegs(sp.x, sp.z);
        if (!legs.length) { note("The board's sun-bleached blank.", 1.8); return; }
        const line = legs.map(function (o) { return o.n + " " + (Math.round(o.d / 100) / 10) + "km"; }).join("  ·  ");
        if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(legs[0].x, legs[0].z, legs[0].n);
        note("Route board — " + line, 3.4);
      },
    },

    // ---- SOMEBODY'S WHOLE LIFE, under a tarp. props.js places these with the
    // street camps, so this is not "a shopping trolley" — it is a rough
    // sleeper's cart, and going through it is theft from the poorest person on
    // the block. It runs interact.js's OWN bounded rummage (same roll, same
    // 90 s cooldown, same city RNG — never a second faucet) and it wakes the
    // street, which matters more than usual now that some of the people living
    // rough hunt after dark.
    cart: {
      name: "Loaded cart",
      note: function () { return "Everything somebody owns, under a tarp"; },
      bad: true,
      can: function () { return !!CBZ.citySearchStreetProp; },
      label: function () { return "Rifle the cart"; },
      run: function (sp) {
        const acted = CBZ.citySearchStreetProp(sp, {
          empty: "Rags, cans, a radio with no back. Nothing.",
          hit: "A roll of notes knotted in a sock — $",
        });
        if (!acted) return;
        if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(sp.x, sp.z, 12, 0.6, CBZ.city.playerActor);
        if (CBZ.cityCrime) CBZ.cityCrime(20, { x: sp.x, z: sp.z, type: "theft" });
      },
    },
  };

  // NAMED PLACES, NEAREST FIRST. city.regions is the registry of PLACES (the
  // same one roadrules.js tests a road against); connector strips and the
  // continent underlay are not destinations and are skipped by the same
  // vocabulary that file uses.
  const NOT_A_PLACE = /bridge|causeway|link|ramp|approach|spur|corridor|terrain:/i;
  function prettyPlace(s) {
    return String(s).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
      .replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }
  function routeLegs(x, z) {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const regs = (A && A.regions) || [];
    const out = [];
    for (let i = 0; i < regs.length; i++) {
      const r = regs[i];
      if (!r || !r.name || r.underlay === true) continue;
      if (NOT_A_PLACE.test(r.name)) continue;
      const cx = (r.cx != null) ? r.cx : ((r.minX + r.maxX) / 2);
      const cz = (r.cz != null) ? r.cz : ((r.minZ + r.maxZ) / 2);
      if (!isFinite(cx) || !isFinite(cz)) continue;
      const d = Math.hypot(cx - x, cz - z);
      if (d < 60) continue;                              // you are standing in it
      out.push({ n: prettyPlace(r.name), d: d, x: cx, z: cz });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, 3);
  }

  const OBJECT_TYPES = Object.keys(OBJECT_VERBS);
  const OBJ_REACH = REACH + 0.6;                          // a hydrant is squat; meet it halfway
  // the row this prop offers RIGHT NOW, or null (a spent meter, a main already
  // blowing) — the one place the live gate is evaluated, so find() and both
  // option gates can never disagree about whether there is a card to show.
  function liveRow(sp) {
    if (CBZ.CONFIG.OBJECT_VERBS === false) return null;
    const row = sp && OBJECT_VERBS[sp.type];
    return (row && row.can(sp)) ? row : null;
  }

  I.registerZone({
    id: "zone-roleprop", kind: "roleprop", prio: 3, driving: false,
    find: function (px, pz) {
      if (CBZ.CONFIG.OBJECT_VERBS === false) return null;
      if (!CBZ.cityNearestStreetProp) return null;
      const sp = CBZ.cityNearestStreetProp(px, pz, OBJ_REACH, OBJECT_TYPES);
      return (sp && liveRow(sp)) ? sp : null;             // no live verb -> no card
    },
    // TWO options, still ONE table. `bad` is read as a static property by the
    // registry (choiceScore's -240 and the standing gate), so a row that is a
    // CRIME cannot declare it through a function — it declares it by which of
    // these two carries it. A prop resolves to exactly one row, so only one of
    // the pair can ever pass and the pair can never fight each other.
    options: [{
      id: "roleprop-do", slot: "e", bad: false,
      canShow: function (sp) { const r = liveRow(sp); return !!(r && !r.bad); },
      label: function (sp) { const r = OBJECT_VERBS[sp.type]; return r ? r.label(sp) : ""; },
      onSelect: function (sp) { const r = OBJECT_VERBS[sp.type]; if (r) r.run(sp); },
    }, {
      id: "roleprop-crime", slot: "e", bad: true,
      canShow: function (sp) { const r = liveRow(sp); return !!(r && r.bad); },
      label: function (sp) { const r = OBJECT_VERBS[sp.type]; return r ? r.label(sp) : ""; },
      onSelect: function (sp) { const r = OBJECT_VERBS[sp.type]; if (r) r.run(sp); },
    }],
  });
  I.describe("roleprop", function (sp) {
    const row = (sp && OBJECT_VERBS[sp.type]) || null;
    return { label: (row && row.name) || "Street fixture", note: (row && row.note(sp)) || "" };
  });

  /* ==========================================================================
     THE RATCHETS (BLOCK LAW #5). Both are computed LIVE against the real
     tables, never against a copy: roleVerbAudit walks CBZ.cityJobs (which
     citystaff.js merges its own 28 trades into on the first tick, so the count
     grows on its own), and objectVerbAudit takes a census of the actual
     streetProps the world built this seed.

       roleVerbAudit().withoutVerb  — declared trades no verb can reach. This is
                                      structurally 0: every CITY_JOBS row
                                      declares a class and every class has a
                                      floor. It may only ever go DOWN, and the
                                      day it is non-zero somebody has added a
                                      class with no floor.
       objectVerbAudit().withoutVerb — prop types nothing can be done to. This
                                      is NOT pinned at 0 and should not be: a
                                      planter is a planter. `bare` names them
                                      so the number can be argued with.

     `viaFallback` and `foreign` are printed beside `withVerb` so a "fix" that
     deletes rows and leans on the floor cannot pass as an improvement.
     ========================================================================== */
  // trades another file already gives a verb to — counted as covered, named so
  // the coverage claim can be checked (shops.js's WORKERS ON THE STREET block).
  const FOREIGN_JOBS = { "mechanic": "shops.js:ped-mechanic-fix", "cab driver": "shops.js:ped-cab-ride", "street vendor": "shops.js:ped-cart-bite" };
  // prop types another file already gives an interaction VERB to. `patio` is
  // in here for a reason worth knowing: its chairs are registered as propuse
  // SEATS (interact.js's SEAT_NAMES carries "patio"), so the sit arc already
  // owns them through a different registry entirely — the streetProps record
  // is only the placement note. A verb here would be a second way to sit down.
  const FOREIGN_PROPS = {
    "bin": "interact.js:zone-streetprop", "newsbox": "interact.js:zone-streetprop",
    "mailbox": "interact.js:zone-mailbox", "billboard": "adboard.js:board walk-up",
    "patio": "propuse.js:seat",
  };

  CBZ.roleVerbAudit = function () {
    const J = CBZ.cityJobs || {};
    const out = {
      jobs: 0, withVerb: 0, named: 0, viaFallback: 0, foreign: 0, withoutVerb: 0,
      missing: [], classes: Object.create(null),
      rows: Object.keys(ROLE_VERBS).length,
      enabled: CBZ.CONFIG.ROLE_VERBS !== false,
    };
    for (const k in J) {
      out.jobs++;
      const cls = (J[k] && J[k].class) || "";
      out.classes[cls || "(none)"] = (out.classes[cls || "(none)"] | 0) + 1;
      if (ROLE_VERBS[k]) { out.withVerb++; out.named++; }
      else if (FOREIGN_JOBS[k]) { out.withVerb++; out.foreign++; }
      else if (CLASS_FALL[cls]) { out.withVerb++; out.viaFallback++; }
      // A trade whose CLASS has no declared floor still gets fallFor's last
      // resort at run time, so the player never meets a silent worker — but it
      // is counted MISSING here ON PURPOSE. An undeclared class is a
      // declaration bug, and a ratchet that hides it behind a safety net is
      // the "audit nobody has executed" mistake wearing a different hat.
      else { out.withoutVerb++; out.missing.push(k); }
    }
    return out;
  };

  CBZ.objectVerbAudit = function () {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const list = (A && A.streetProps) || [];
    const counts = Object.create(null);
    for (let i = 0; i < list.length; i++) {
      const t = list[i] && list[i].type;
      if (t) counts[t] = (counts[t] | 0) + 1;
    }
    const out = {
      props: list.length, propTypes: 0, withVerb: 0, mine: 0, foreign: 0,
      withoutVerb: 0, bare: [], counts: counts,
      rows: OBJECT_TYPES.length,
      enabled: CBZ.CONFIG.OBJECT_VERBS !== false,
    };
    for (const t in counts) {
      out.propTypes++;
      if (OBJECT_VERBS[t]) { out.withVerb++; out.mine++; }
      else if (FOREIGN_PROPS[t]) { out.withVerb++; out.foreign++; }
      else { out.withoutVerb++; out.bare.push(t); }
    }
    return out;
  };

  // the tables themselves, for a probe that wants to assert on a row directly
  CBZ.cityRoleVerbs = ROLE_VERBS;
  CBZ.cityObjectVerbs = OBJECT_VERBS;
})();
