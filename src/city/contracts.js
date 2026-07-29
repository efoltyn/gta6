/* ============================================================
   city/contracts.js — THE JOB BOARD. What your outfit actually asks you to do.

   OWNER'S ASK (2026-07-26, verbatim): "hijack a plane if you are a terrorist
   or in the CIA, assassinate a real politician if you are a hitman, bomb a
   city if you join the army." And: "the hard part … has been coded, the easy
   part now is the roles … and then get paid to do the stuff."

   This file is the "get paid to do the stuff" half. It owns NO tracking, NO
   payout, NO HUD, NO ladder and NO membership state:

     WHO you are          -> city/factions.js   (CBZ.factions)
     WHAT a job IS        -> core/mission.js    (CBZ.mission)
     WHO gives it and WHY -> here.

   ---------------------------------------------------------------
   THE ONE DESIGN RULE THIS FILE FOLLOWS
   ---------------------------------------------------------------
   Every contract generator that is remembered fondly (Shadow of Mordor's
   Nemesis, Watch Dogs Legion's Census, Bethesda's radiant aliases) works the
   same way, and every one that is mocked (Skyrim's "clear the random cave")
   breaks it:

     >> THE GENERATOR PICKS THE VERB. THE WORLD SUPPLIES THE SPECIFICS. <<

   So NOTHING here invents a target. Every contract binds to something the
   simulation was already running before the job existed:

     · the assassination target is the ACTUAL SITTING MAYOR — city/polity.js's
       office.holder sid, named by officials.js's identity ledger, standing in
       the real city hall on his real 9-17 schedule, guarded by his real
       protection.js detail, whose real approval rating collapses when he dies
       and whose real deputy is really sworn in afterwards (officials.js's
       succession). We did not spawn a "target dummy". We pointed at the man.
     · the plane is a real militaryvehicles.js record on the real Fort Brandt
       apron, boarded through the real aircraft_doors.js arc.
     · the demolition target is a real lot that really collapses through
       demolition.js and really stays a ruin.
     · the rival boss is a real CBZ.cityGangs boss ped with a real name.

   If the world does not contain the thing, the contract is NOT OFFERED —
   never faked (CLAUDE.md: no stat fictions). `available()` on every template
   is a live world query, not a flag.

   ---------------------------------------------------------------
   CONSEQUENCE OF ALLEGIANCE (the thing that stops rank being a vanity bar)
   ---------------------------------------------------------------
   Design critique of hollow faction systems is unanimous: a rank that only
   raises a payout is a vanity XP bar. Every rung here unlocks a VERB —

     Garrison  Recruit(0)      perimeter sweeps — the rung that pays for itself
               Private(1)      the MOTOR POOL: take the armour out yourself
               Corporal(2)     the AIRFRAME: a sanctioned ferry flight
               Sergeant(3)     AIRSTRIKE: real demolition of a real city block
               Lieutenant(4)   the BOMBER: a carpet run off the B-2
     Bureau    Probationary(0) sit on an address
               Officer(1)      airframe recovery
               Handler(2)      SANCTIONED KILL — the sitting mayor, by name
               Station Chief(3) PROTECTIVE DETAIL — the same man, kept alive
     Cause     Sympathiser(0)  couriering
               Courier(1)      make a hole
               Operative(2)    HIJACK the aircraft
               Cadre(3)        the statement (the same mayor, louder)

   TWO RULES, both of them bugs that were caught in review rather than theory:

   (a) EVERY outfit has a rank-0 job. Finishing an outfit's own work is the
       ONLY thing that credits an `order`, so an outfit whose cheapest contract
       needs rank 1 has a ladder nobody can climb.
   (b) EVERY rung, INCLUDING THE LAST, opens a verb. Both the Garrison's
       Lieutenant and the Bureau's Station Chief used to open nothing but a
       bigger payslip — which is the exact vanity XP bar the rule below bans,
       sitting at the top of two of the three ladders.

   Rule (b) is no longer a promise in a comment. `CBZ.contractAudit()` counts
   declared rungs that open nothing, derived from the live ladders and the live
   minRank gates, and the math gate pins it at ZERO — the same shape as the tree
   connection law. Add a rank with no verb and the gate fails.

   Those tiers are not a table of promises: each is the `minRank` on a real
   template below, enforced by core/mission.js's own faction gate. `can()` and
   `unlocks()` READ those numbers rather than restating them, so this file
   cannot claim a capability it does not gate. Wage and cut rise with rank too,
   but that is the boring half — the rungs above are what you could not do
   yesterday.

   And allegiance is a FORK, not a collection: joining one outfit tanks your
   standing with its declared enemies and expels you outright if you were in
   one (factions.js hostileTo, applied by wireFork() below). You cannot be
   Bureau and Cause. You cannot be Garrison and run with a set.

   ---------------------------------------------------------------
   HUD DOCTRINE (CLAUDE.md, binding)
   ---------------------------------------------------------------
   NO POPUP AND NO OBJECTIVE CARD. Offers arrive as a diegetic phone push
   (CBZ.phoneNotify, campaign_ui.js's canonical entry) and the accepted job's
   checklist lives on the phone's mission app, which core/mission.js already
   drives. In world you get exactly what every other objective gets: one HUD
   distance line, one map waypoint, one beacon. Nothing floats over gameplay.

   There IS one modal — the ORDERS BOARD (openBoard, CBZ.cityOrderBoard) — and
   it is the same modal careers.js's own contract board has always been: a
   deliberately opened, pointer-unlocked, CBZ.cityMenuOpen-owning panel you walk
   up to a desk to read, not a card that appears at you. It exists because the
   first cut of this file had NO way to hand the player a job at all: the offers
   were registered with core/mission.js and NOTHING in the build enumerated
   them, the desks took one at random off a per-day hash (so a Sergeant saw the
   same sweep all day and never his airstrike), and the Cause — which has no
   desk by design — could never hand a member a second job in their life. It
   closes on [Esc], on a tap, and on CBZ.mission.onInterrupt (death/arrest/mode
   exit), which is the ONE sweeper in the game and the cure for modal soft-locks.

   Revert: CBZ.CONFIG.CONTRACTS_V1 = false — no offers, no zones, nothing
   registered. factions.js and mission.js are unaffected.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // CONTRACTS_V1 — the whole job board (offers, recruiters, arcs).
  if (CFG.CONTRACTS_V1 == null) CFG.CONTRACTS_V1 = true;
  // CONTRACTS_ASSASSINATION — the politician arc specifically. It kills a
  // simulated officeholder and triggers officials.js's real succession, so it
  // gets its own switch independent of the rest of the board.
  if (CFG.CONTRACTS_ASSASSINATION == null) CFG.CONTRACTS_ASSASSINATION = true;

  const F = function () { return (CFG.CONTRACTS_V1 && CBZ.factions) || null; };
  const M = function () { return (CFG.CONTRACTS_V1 && CBZ.mission) || null; };
  // NAME THE SENDER. mode.js's note() drops any line that neither matches its
  // "a real contact would send this" keyword list nor carries an opts.from /
  // opts.app (phoneWorthy, mode.js:101-115) — so every refusal this file wrote
  // ("Nothing at your level today", "Finish what you're carrying first", the
  // Bureau's admission reasons) was silently deleted and the player pressed a
  // key at a desk and saw nothing at all.
  function note(t, s, from) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2.4, { from: from || "CONTACT", app: "missions" });
  }
  function push(from, text, prio) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "missions", from: from, text: text, priority: prio || 0 }); return; } catch (e) {} }
    note(text, 3, from);
  }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function P() { return CBZ.player || null; }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function day() { return CBZ.dayCount ? CBZ.dayCount() : 0; }
  // stable-per-day pick so the board doesn't reshuffle every time you look at
  // it. Runtime-only (not a generation path) but the world hash is free and
  // makes the board deterministic per seed+day, which multiplayer will want.
  function roll(salt) {
    if (CBZ.hash01) return CBZ.hash01(day() * 7 + 1, salt * 13 + 3, 0x5c0);
    return Math.random();
  }

  /* ==============================================================
     THE TWO NEW OUTFITS.
     The gang ladder is gangs.js's. The garrison is militia.js's. These two
     had no home, so they are declared here — but they are declared, not
     implemented: no ladder array, no membership field, no promotion code.
     ============================================================== */
  const AGENCY = "agency", CELL = "cell", ARMY = "army", GANG = "gang";

  function declareOutfits() {
    const f = F(); if (!f || !f.declare) return;

    if (!f.exists(AGENCY)) {
      f.declare({
        id: AGENCY,
        name: "Bureau of Domestic Security",
        short: "Bureau",
        kind: "agency",
        color: 0x2f4f6f,
        ranks: ["Probationary", "Officer", "Handler", "Station Chief"],
        needScale: { served: 300, orders: 3, bodies: 0, contrib: 0 },
        wage: 340,
        heat: 0.55,                    // a badge makes witnesses quieter
        hostileTo: [CELL],
        friendlyTo: [ARMY],
        admission: {
          cleanRecord: true,
          respect: 40,
          test: function (F2) {
            if (F2.isMember(CELL)) return "Your file is a problem. Try the other side.";
            if (F2.isMember(GANG)) return "Not while you're running with a set.";
            return true;
          },
        },
        lore: "A federal field office inside city hall. Deniable work, real payroll.",
        onJoin: function () { push("BUREAU", "Cleared. Field assignments come through this line only.", 2); },
      });
    }

    if (!f.exists(CELL)) {
      f.declare({
        id: CELL,
        name: "The Cause",
        short: "Cause",
        kind: "cell",
        color: 0x8b2f2f,
        ranks: ["Sympathiser", "Courier", "Operative", "Cadre"],
        // ONLY served + orders: a rung must be reachable by doing the work the
        // outfit actually hands out. A `bodies` threshold here made the whole
        // Cause ladder unclimbable — nothing credits bodies outside gangs.js.
        needScale: { served: 180, orders: 2, bodies: 0, contrib: 0 },
        wage: 0,                       // no payroll. A cell pays per job only.
        heat: 1.6,                     // known associate — witnesses shout
        hostileTo: [ARMY, AGENCY],
        admission: {
          // The Cause does not take walk-ins. They call YOU (see courtCell),
          // and only after a tryout job — the one contract a non-member sees.
          mission: "cell:tryout",
        },
        lore: "No desk, no payroll, no names. They find you.",
        onJoin: function () {
          push("UNKNOWN", "You're in. Burn this thread.", 2);
          // WHERE THE NEXT JOB COMES FROM. Without this line a new member had
          // no idea the Cause had a physical channel at all, and the ladder
          // above Sympathiser was unreachable in practice.
          const where = dropName();
          if (where) push("UNKNOWN", "The drop is " + where + ". Everything comes through it. Nothing else does.", 2);
        },
      });
    }
  }

  /* ==============================================================
     WORLD BINDERS — every one of these returns a LIVE thing or null.
     This is the only place the contract layer touches the simulation.
     ============================================================== */

  // --- the sitting officeholder of the city you are standing in -------------
  // polity.js owns the jurisdiction record; officials.js owns who holds it and
  // (when you get close, on his own 9-17 schedule) puts a real body in the
  // real city hall. We resolve all three and refuse if any is missing.
  function cityHallDoor() {
    const A = arena(); if (!A) return null;
    const lots = A.shopLots || A.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l && l.kind === "cityhall" && l.building && l.building.door) return l.building.door;
    }
    return null;
  }
  function sittingOfficial() {
    if (!CBZ.polity || !CBZ.polity.of || !CBZ.officials) return null;
    const door = cityHallDoor(); if (!door) return null;
    const rec = CBZ.polity.of(door.x, door.z);
    if (!rec || !rec.office || !rec.office.holder) return null;
    const sid = rec.office.holder;
    let id = null;
    try { id = CBZ.officials.identityOf(sid); } catch (e) { id = null; }
    if (!id || !id.name) return null;
    return { sid: sid, rec: rec, name: id.name, title: titleOf(rec, id), door: door };
  }
  // officials.js's officeOf(sid) returns { rec, asDeputy } — it has NO `title`
  // field, so reading o.title always fell through and every officeholder in the
  // game was announced as "Mayor", including a governor and a head of state.
  // officials.js's own titleFor() is module-private, so we derive the same
  // answer from the polity record we already hold (kind/tier/govType are that
  // record's public fields — this is a READ of the live simulation, not a
  // second table).
  function titleOf(rec, ident) {
    if (!rec) return "Official";
    // DELEGATE FIRST (2026-07-29). officials.js's titleFor is no longer
    // module-private; it is THE derivation, and this block was one of nine
    // hand-typed copies whose fallbacks disagreed with it on the monarchy
    // branch. What follows stays as the degrade path only.
    if (CBZ.officials && CBZ.officials.titleFor) {
      try { const t = CBZ.officials.titleFor(rec, ident); if (t) return t; } catch (e) {}
    }
    if (rec.kind === "country") {
      if (rec.govType !== "monarchy") return "President";
      return (ident && ident.gender === "m") ? "King" : "Queen";
    }
    if (rec.kind === "state" || rec.kind === "federal") return "Governor";
    if (rec.kind === "city") return rec.tier === "village" ? "Chief" : "Mayor";
    return "Official";
  }
  // the LIVE body, if officials.js has one spawned right now. Missions target
  // the door until he materialises, then the ped — mission.js re-resolves the
  // stage target every frame, so the mark drags the beacon with him.
  function officialPed(sid) {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._sid === sid) return peds[i];
    return null;
  }

  // --- a real aircraft on the real apron ------------------------------------
  function anyMilitaryAircraft() {
    const list = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      // `taken` is set by the player boarding AND by an NPC crew claiming it
      // (militaryvehicles.js:235-244 cityClaimMilitaryVehicle) AND permanently
      // on a shot-down airframe (:248). Binding a hijack to a hull an AI pilot
      // is about to fly out of the world makes an unwinnable contract, so the
      // ground binder's `!r.taken` filter applies here too.
      if (!r || r.destroyed || r.dead || r.taken) continue;
      const k = String(r.kind || r.type || "").toLowerCase();
      // militaryvehicles.js's own kinds are "heli" and "plane"
      // (playeraircraft.js:949 branches on exactly those). Anything else in
      // the motor pool is a TANK — and an aircraft contract that binds to a
      // tank is a stat fiction. There is deliberately NO fallback: no
      // airframe in the world means no hijack contract on the board.
      if (k === "heli" || k === "plane" || /jet|airlin/.test(k)) return r;
    }
    return null;
  }

  // --- THE bomber, if this world built one -----------------------------------
  // strategic.js parks exactly one B-2 on the Fort Brandt apron and registers
  // it into the SAME motor-pool registry as everything else, flagged `b2:true`
  // (strategic.js:304). It is behind CBZ.CONFIG.STRAT_B2, so this is a live
  // world query, never an assumption: no bomber, no bomber contract.
  function theB2() {
    const list = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.b2 && !r.destroyed && !r.dead && !r.taken) return r;
    }
    return null;
  }

  // --- a real GROUND machine on the real apron -------------------------------
  // The mirror of anyMilitaryAircraft: militaryvehicles.js's own kinds are
  // "heli"/"plane" for airframes and "tank"/"ground" for everything that rolls.
  // A ground contract that binds to a helicopter is the same stat fiction in
  // the other direction, so this filter is just as strict.
  function anyMilitaryGround() {
    const list = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.destroyed || r.dead || r.taken) continue;
      const k = String(r.kind || r.type || "").toLowerCase();
      if (k === "tank" || k === "ground" || /truck|apc/.test(k)) return r;
    }
    return null;
  }

  // --- a real demolishable block --------------------------------------------
  // Deliberately picks a lot AWAY from the player's current position: the job
  // is a journey, not a button. Skips already-ruined lots.
  // Can demolition.js actually bring this one down? `lot.demolished` is set by
  // exactly one line in the game (demolition.js:391) and it is the only thing
  // mission.js's objectGone() reads — so a "destroy" contract bound to a lot
  // demolition.js REFUSES is unwinnable. It used to accept any lot with a
  // building, while demolition.js::eligible() (demolition.js:74-81) also
  // requires colliders, rejects helipads/hangars/parks and caps storeys. That
  // mismatch could hand out an army:strike or cell:burn that timed out at 900s
  // — or, far worse, the Cause's cell:tryout, which has NO limit and would hang
  // forever while courtCell's one-shot flag stayed burnt.
  function demolishable(l) {
    if (CBZ.CONFIG.CITY_DEMOLITION === false) return false;
    const b = l && l.building;
    if (!b || !b.group || !b.colliders || !b.colliders.length) return false;
    const cap = +CBZ.CONFIG.DEMO_MAX_STOREYS || 64;
    if ((b.storeys | 0) > cap) return false;              // landmark tier
    if (b.helipad || b.hangar) return false;
    if (l.kind === "park") return false;
    return true;
  }
  function strikeLot(minAway) {
    const A = arena(); if (!A || !A.lots || !A.lots.length) return null;
    const p = P(); if (!p) return null;
    const away = minAway || 90;
    let best = null, bestScore = -1;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l || l.demolished || !l.building) continue;
      if (l.kind === "cityhall") continue;                // not the seat of state
      if (!demolishable(l)) continue;                     // or the job is unwinnable
      const dd = d2(p.pos.x, p.pos.z, l.cx, l.cz);
      if (dd < away) continue;
      const s = 1 / (1 + Math.abs(dd - away * 1.8));      // prefer "a drive away"
      if (s > bestScore) { bestScore = s; best = l; }
    }
    return best;
  }

  // --- any real addressable building at least `away` metres off ---------------
  // Used by the entry-rung jobs. Same rule as strikeLot: it must be a lot the
  // world actually built (it has a building and a door), and the job must be a
  // journey. Deterministic per day so the board is stable while you look at it.
  function anyAddress(away) {
    const A = arena(); if (!A) return null;
    const lots = (A.lots && A.lots.length) ? A.lots : (A.shopLots || []);
    const p = P(); if (!p || !lots.length) return null;
    const pool = [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished || !l.building || !l.building.door) continue;
      if (d2(p.pos.x, p.pos.z, l.cx, l.cz) < (away || 60)) continue;
      pool.push(l);
    }
    if (!pool.length) return null;
    return pool[Math.min(pool.length - 1, (roll(away | 0) * pool.length) | 0)];
  }

  // --- a real rival boss ------------------------------------------------------
  function rivalBoss() {
    const gangs = CBZ.cityGangs || [];
    const mine = (F() && F().orgIn) ? F().orgIn(GANG) : null;
    for (let i = 0; i < gangs.length; i++) {
      const gg = gangs[i];
      if (!gg || gg.absorbed || gg.id === mine) continue;
      const b = gg.boss;
      if (b && !b.dead) return { gang: gg, ped: b, name: gg.bossName || b.name || "the boss" };
    }
    return null;
  }

  // --- posts inside the base, for the entry-level sweep ----------------------
  function basePosts() {
    const B = CBZ._militaryBase; if (!B || !B.center) return null;
    const cx = B.center.x, cz = B.center.z;
    const rx = Math.max(20, (B.maxX - B.minX) * 0.32), rz = Math.max(20, (B.maxZ - B.minZ) * 0.32);
    return [
      { x: cx - rx, z: cz - rz }, { x: cx + rx, z: cz - rz }, { x: cx + rx, z: cz + rz },
    ];
  }

  /* ==============================================================
     THE TEMPLATES.
     A template is: who offers it, what rank it needs, whether the world can
     supply a target right now, and how to build the mission def. That is all.
     core/mission.js does tracking, payment, surfacing and failure.
     ============================================================== */
  const TEMPLATES = [
    /* ---------------- GARRISON: the entry rung --------------------------- */
    {
      id: "army:sweep", faction: ARMY, minRank: 0,
      title: "Perimeter sweep",
      giver: "GARRISON OPS",
      pay: 260,
      available: function () { return !!basePosts(); },
      build: function () {
        const posts = basePosts();
        return {
          title: "Perimeter sweep",
          brief: "Walk the wire. Three posts, one pass.",
          reward: { cash: 260, respect: 1 },
          color: 0x9bd45a,
          stages: posts.map(function (pt, i) {
            return { id: "post" + i, goal: "reach", at: [pt.x, pt.z], radius: 9,
              text: "Check post " + (i + 1) + " of " + posts.length, label: "POST " + (i + 1) };
          }),
          doneText: "Sweep logged. Nothing on the wire.",
        };
      },
    },

    /* ---------------- GARRISON: armour, Private+ -------------------------
       The rung between "walk the wire" and "flatten a block". It is the FIRST
       job in the game that hands the player the motor pool, and it is a real
       militaryvehicles.js record driven by the real armour sim — which is also
       why core/mission.js had to learn what "driving that" means for a machine
       that never touches P._vehicle. ------------------------------------------ */
    {
      id: "army:armour", faction: ARMY, minRank: 1,           // Private+
      title: "Move the armour",
      giver: "GARRISON OPS",
      pay: 1100,
      available: function () { return !!anyMilitaryGround() && !!basePosts(); },
      build: function () {
        const rig = anyMilitaryGround(); if (!rig) return null;
        const posts = basePosts(); if (!posts) return null;
        const to = posts[posts.length - 1];
        const name = rig.name || (rig.kind === "tank" ? "the tank" : "the truck");
        return {
          title: "Move the armour",
          brief: "Motor pool wants " + name + " repositioned. Take it yourself.",
          locationName: "Motor pool",
          reward: { cash: 1100, respect: 3 },
          color: 0x9bd45a,
          limit: 900,
          stages: [
            { id: "take", goal: "steal", vehicle: rig, at: rig,
              text: "Get behind " + name, label: "MOTOR POOL" },
            { id: "park", goal: "reach", at: [to.x, to.z], radius: 14,
              text: "Park it on the north line", label: "PARK",
              // it must arrive UNDER YOU, not on foot beside it
              needs: function () { return !!(CBZ.cityArmorActive && CBZ.cityArmorActive()); } },
          ],
          doneText: "Logged. Leave the keys in it.",
        };
      },
    },

    /* ---------------- GARRISON: sanctioned airframe ferry, Corporal+ ------ */
    {
      id: "army:ferry", faction: ARMY, minRank: 2,            // Corporal+
      title: "Airframe ferry",
      giver: "GARRISON OPS",
      pay: 3000,
      available: function () { return !!anyMilitaryAircraft(); },
      build: function () { return hijackDef(ARMY, 3000, "It's yours on paper today. Get it up and out."); },
    },

    /* ---------------- GARRISON: "bomb a city" ---------------------------- */
    {
      id: "army:strike", faction: ARMY, minRank: 3,          // Sergeant+
      title: "Sanctioned strike",
      giver: "GARRISON OPS",
      pay: 4200,
      available: function () { return !!strikeLot(90); },
      build: function () {
        const lot = strikeLot(90); if (!lot) return null;
        const where = (lot.building && lot.building.name) || lot.kind || "the structure";
        return {
          title: "Sanctioned strike",
          brief: "Command wants " + where + " flattened. Method is yours.",
          locationName: where,
          reward: { cash: 4200, respect: 6, notoriety: 40 },
          color: 0xff8b3d,
          limit: 900,
          stages: [
            { id: "approach", goal: "reach", at: [lot.cx, lot.cz], radius: 32,
              text: "Get eyes on " + where, label: "TARGET",
              onEnter: function () { push("GARRISON OPS", "Grid is yours. Collateral is command's problem, not yours.", 1); } },
            { id: "flatten", goal: "destroy", object: lot, at: [lot.cx, lot.cz],
              text: "Bring down " + where, label: "STRIKE" },
          ],
          doneText: "Target neutralised. Report back.",
          onComplete: function () {
            // the world reacts through systems that already exist
            if (CBZ.cityEvent) CBZ.cityEvent("disaster", { panic: 3, emergency: 3, political: 2, label: "Sanctioned strike", message: "A block came down." });
          },
        };
      },
    },

    /* ---------------- GARRISON: the top rung, Lieutenant ------------------
       The ladder's last rung used to unlock NOTHING — Sergeant opened the
       airstrike and Lieutenant opened a slightly bigger payslip, which is the
       exact vanity-XP-bar this file's own doctrine bans. A Lieutenant gets the
       BOMBER: strategic.js's B-2 is already a militaryvehicles.js record with
       a real payload cycle, a real carpet run and a real damage ledger
       (CBZ.strategicDevastation), so the whole verb costs a template and
       nothing else. This is "bomb a city" at its full size — not one block.
       ---------------------------------------------------------------------- */
    {
      id: "army:carpet", faction: ARMY, minRank: 4,          // Lieutenant
      title: "Carpet run",
      giver: "GARRISON OPS",
      pay: 9000,
      available: function () { return !!theB2(); },
      build: function () {
        const b2 = theB2(); if (!b2) return null;
        const NEED = 4;                    // structures that must actually come down
        let base = 0;
        function collapsed() {
          try { return (CBZ.strategicDevastation ? CBZ.strategicDevastation().collapsed : 0) | 0; } catch (e) { return base; }
        }
        return {
          title: "Carpet run",
          brief: "The bomber is fuelled. Command wants " + NEED + " structures on the deck. Payload is your call.",
          locationName: "Fort Brandt apron",
          reward: { cash: 9000, respect: 18, notoriety: 120 },
          color: 0xff8b3d,
          limit: 1200,
          stages: [
            { id: "apron", goal: "reach", at: b2, radius: 34,
              text: "Walk out to the bomber", label: "B-2 SPIRIT" },
            { id: "take", goal: "steal", vehicle: b2, at: b2,
              text: "Get the bomber up", label: "B-2 SPIRIT",
              onEnter: function () { push("GARRISON OPS", "She's yours. Cycle the payload before you're over the line.", 1); } },
            {
              id: "run", goal: "custom", label: "THE RUN",
              text: "Put " + NEED + " structures on the deck",
              // The count is READ off strategic.js's own damage ledger, not a
              // private tally — the same number the devastation readout uses.
              onEnter: function (m, st) { base = collapsed(); st._n = 0; },
              done: function (m, st) {
                st._n = Math.max(0, collapsed() - base);
                m.progress(Math.min(1, st._n / NEED));
                return st._n >= NEED;
              },
            },
          ],
          doneText: "Grid is flat. Bring her home.",
          onComplete: function () {
            if (CBZ.cityEvent) CBZ.cityEvent("disaster", { panic: 4, emergency: 4, political: 3, label: "Air raid", message: "The bombers came at first light." });
          },
        };
      },
    },

    /* ---------------- BUREAU: the entry rung -----------------------------
       Every outfit MUST have a minRank-0 job or its ladder is decorative: the
       only thing that credits an `order` is finishing that outfit's own work,
       so a faction whose cheapest contract needs rank 1 can never reach rank 1.
       (This is exactly how the Bureau and Cause ladders were unclimbable in
       the first cut of this file.) ------------------------------------------ */
    {
      id: "agency:watch", faction: AGENCY, minRank: 0,
      title: "Sit on an address",
      giver: "BUREAU",
      pay: 700,
      available: function () { return !!anyAddress(220); },
      build: function () {
        const lot = anyAddress(220); if (!lot) return null;
        const where = (lot.building && lot.building.name) || "the address";
        const HOLD = 45;
        return {
          title: "Sit on an address",
          brief: "Park on " + where + " and stay on it. Forty-five seconds of eyes, that's the job.",
          locationName: where,
          reward: { cash: 700, respect: 2 },
          color: 0x7ec8ff,
          stages: [
            { id: "go", goal: "reach", at: [lot.cx, lot.cz], radius: 24, text: "Get to " + where, label: "ADDRESS" },
            {
              id: "watch", goal: "custom", at: [lot.cx, lot.cz], label: "HOLD",
              text: "Hold the position",
              // real presence, not a timer you can walk away from: the clock
              // only runs while you are actually there.
              onEnter: function (m, st) { st._held = 0; st._lt = 0; },
              // FRAME-RATE INDEPENDENT. done() is called once per tick with no
              // dt, so the old `+= 1/60` made "forty-five seconds" mean 45s at
              // 60fps, 90s at 30fps and 22s on a 120Hz screen. mission.js
              // already accumulates real seconds into st.t — diff that instead.
              done: function (m, st) {
                const p = P(); if (!p) return false;
                const dt = Math.max(0, Math.min(0.25, (st.t || 0) - (st._lt || 0)));
                st._lt = st.t || 0;
                const near = d2(p.pos.x, p.pos.z, lot.cx, lot.cz) < 30;
                st._held = near ? (st._held || 0) + dt : Math.max(0, (st._held || 0) - dt * 2);
                m.progress(Math.min(1, (st._held || 0) / HOLD));
                return (st._held || 0) >= HOLD;
              },
            },
          ],
          doneText: "Logged. Filed. Paid.",
        };
      },
    },

    /* ---------------- CAUSE: the entry rung ------------------------------ */
    {
      id: "cell:courier", faction: CELL, minRank: 0,
      title: "Carry something",
      giver: "UNKNOWN",
      pay: 900,
      available: function () { return !!anyAddress(60) && !!anyAddress(260); },
      build: function () {
        const from = anyAddress(60), to = anyAddress(260);
        if (!from || !to || from === to) return null;
        return {
          title: "Carry something",
          brief: "Collect it. Move it. Don't open it.",
          reward: { cash: 900, respect: 3, notoriety: 25 },
          color: 0x8b2f2f,
          limit: 600,
          stages: [
            { id: "get", goal: "reach", at: [from.cx, from.cz], radius: 8, text: "Collect the package", label: "PICKUP" },
            { id: "drop", goal: "reach", at: [to.cx, to.cz], radius: 8, text: "Drop it and walk", label: "DROP" },
          ],
          doneText: "Gone. You were never there.",
        };
      },
    },

    /* ---------------- CAUSE: the rung above couriering -------------------- */
    {
      id: "cell:burn", faction: CELL, minRank: 1,             // Courier+
      title: "Make a hole",
      giver: "UNKNOWN",
      pay: 2600,
      available: function () { return !!strikeLot(70); },
      build: function () {
        const lot = strikeLot(70); if (!lot) return null;
        const where = (lot.building && lot.building.name) || lot.kind || "the building";
        return {
          title: "Make a hole",
          brief: "Nobody sponsors us. " + where + " comes down and the money follows. Method is yours.",
          locationName: where,
          reward: { cash: 2600, respect: 6, notoriety: 90 },
          color: 0x8b2f2f,
          limit: 900,
          stages: [
            { id: "hit", goal: "destroy", object: lot, at: [lot.cx, lot.cz],
              text: "Bring down " + where, label: "THE HOLE" },
            escapeStage("Be somewhere else"),
          ],
          doneText: "The city heard that.",
          onComplete: function () {
            if (CBZ.cityEvent) CBZ.cityEvent("disaster", { panic: 3, emergency: 3, political: 2, label: "Bombing", message: "A building came down in the night." });
          },
        };
      },
    },

    /* ---------------- BUREAU / CAUSE: the aircraft ------------------------ */
    {
      id: "cell:hijack", faction: CELL, minRank: 2,          // Operative+
      title: "Take the aircraft",
      giver: "UNKNOWN",
      pay: 9000,
      available: function () { return !!anyMilitaryAircraft(); },
      build: function () { return hijackDef(CELL, 9000, "Get it off the ground. That is the whole message."); },
    },
    {
      id: "agency:recover", faction: AGENCY, minRank: 1,     // Officer+
      title: "Airframe recovery",
      giver: "BUREAU",
      pay: 6400,
      available: function () { return !!anyMilitaryAircraft(); },
      build: function () { return hijackDef(AGENCY, 6400, "Quiet recovery. We want the airframe, not a headline."); },
    },

    /* ---------------- BUREAU: the politician ----------------------------- */
    {
      id: "agency:sanction", faction: AGENCY, minRank: 2,    // Handler+
      title: "Sanctioned removal",
      giver: "BUREAU",
      pay: 18000,
      available: function () { return CFG.CONTRACTS_ASSASSINATION && !!sittingOfficial(); },
      build: function () { return sanctionDef(AGENCY, 18000); },
    },
    {
      id: "cell:sanction", faction: CELL, minRank: 3,        // Cadre
      title: "The statement",
      giver: "UNKNOWN",
      pay: 22000,
      available: function () { return CFG.CONTRACTS_ASSASSINATION && !!sittingOfficial(); },
      build: function () { return sanctionDef(CELL, 22000); },
    },

    /* ---------------- BUREAU: the top rung, Station Chief -----------------
       Station Chief used to unlock nothing (the ladder's verbs stopped at
       Handler), and the Bureau's whole vocabulary was one word: remove. So the
       last rung gets the INVERSE VERB on the SAME MAN. The mayor you were
       cleared to kill at Handler is the mayor you now have to keep breathing —
       same officeholder, same real 09:00-17:00 schedule, same real
       protection.js detail standing around him, opposite job. Nothing new is
       spawned and nothing is faked: it fails the moment officials.js reports
       that specific sid dead, which is the same signal the assassination
       contract completes on.
       ---------------------------------------------------------------------- */
    {
      id: "agency:detail", faction: AGENCY, minRank: 3,      // Station Chief
      title: "Protective detail",
      giver: "BUREAU",
      pay: 12000,
      available: function () { return !!sittingOfficial(); },
      build: function () {
        const o = sittingOfficial(); if (!o) return null;
        const targeted = o.sid;
        const HOLD = 150;
        subscribeOfficialDeath();
        const since = Date.now();          // only a death on YOUR watch counts
        function down() {
          if (diedSince(targeted, since)) return true;
          const ped = officialPed(targeted);
          return !!(ped && ped.dead);
        }
        return {
          title: "Protective detail",
          targetName: o.title + " " + o.name,
          locationName: "City Hall",
          brief: "There is a name on him and it is not ours. Stand the detail at City Hall until we stand it down. "
            + "He walks out of this alive or you do not work here.",
          reward: { cash: 12000, respect: 12 },
          color: 0x7ec8ff,
          limit: 900,
          // ONE rule, checked every tick by the block: he dies, you failed.
          failIf: function () { return down() ? "he went down on your watch" : null; },
          stages: [
            { id: "post", goal: "reach", at: o.door, radius: 26,
              text: "Take the post at City Hall", label: "CITY HALL",
              onEnter: function () { push("BUREAU", "Eyes out. If you see it coming, put yourself in front of it.", 1); } },
            {
              id: "stand", goal: "custom", at: o.door, label: "THE DETAIL",
              text: "Stand the detail",
              onEnter: function (m, st) { st._held = 0; st._lt = 0; },
              done: function (m, st) {
                const p = P(); if (!p) return false;
                const dt = Math.max(0, Math.min(0.25, (st.t || 0) - (st._lt || 0)));
                st._lt = st.t || 0;
                // stand NEXT to the man when the world has put a body there,
                // otherwise the building he is inside.
                const ped = officialPed(targeted);
                const tx = ped && ped.pos ? ped.pos.x : o.door.x;
                const tz = ped && ped.pos ? ped.pos.z : o.door.z;
                const onPost = d2(p.pos.x, p.pos.z, tx, tz) < 30;
                st._held = onPost ? (st._held || 0) + dt : Math.max(0, (st._held || 0) - dt * 2);
                m.progress(Math.min(1, (st._held || 0) / HOLD));
                return (st._held || 0) >= HOLD;
              },
            },
          ],
          doneText: "Stood down. He never knew you were there.",
          failText: "Detail blown.",
        };
      },
    },

    /* ---------------- CAUSE: the tryout (the ONE non-member job) ---------- */
    {
      id: "cell:tryout", faction: CELL, tryout: true, minRank: null,
      title: "A favour, unpaid",
      giver: "UNKNOWN",
      pay: 0,
      available: function () {
        const f = F(); if (!f) return false;
        if (f.isMember(CELL) || f.isMember(ARMY) || f.isMember(AGENCY)) return false;
        return !!strikeLot(60);
      },
      build: function () {
        const lot = strikeLot(60); if (!lot) return null;
        return {
          title: "A favour, unpaid",
          brief: "No money. No names. Put a hole in that building and we will know who you are.",
          reward: { cash: 0, respect: 8, notoriety: 60 },
          color: 0x8b2f2f,
          tryout: true, faction: CELL,
          stages: [
            { id: "hit", goal: "destroy", object: lot, at: [lot.cx, lot.cz],
              text: "Destroy the marked building", label: "THE FAVOUR" },
          ],
          doneText: "They saw it.",
          onComplete: function () {
            const f = F(); if (!f) return;
            f.markMissionDone("cell:tryout");
            push("UNKNOWN", "That was enough. You ride with the Cause now.", 2);
            f.join(CELL, "recruited", { force: true });
          },
        };
      },
    },

    /* ---------------- GANG: kill a real rival boss ------------------------ */
    {
      id: "gang:boss", faction: GANG, minRank: 3,            // soldier+
      title: "Take the head",
      giver: "THE SET",
      pay: 3400,
      available: function () { return !!rivalBoss(); },
      build: function () {
        const r = rivalBoss(); if (!r) return null;
        return {
          title: "Take the head",
          targetName: r.name,
          brief: r.name + " runs " + (r.gang.name || "the other set") + ". Not for much longer.",
          reward: { cash: 3400, respect: 14 },
          color: 0xff4d4d,
          stages: [
            { id: "kill", goal: "kill", actor: r.ped, text: "Kill " + r.name, label: r.name.toUpperCase() },
            escapeStage("Get off their block"),
          ],
          onComplete: function () {
            // credit the crew through the ONE writer that already exists
            if (CBZ.cityMemberPutInWork) CBZ.cityMemberPutInWork("body", 1);
          },
        };
      },
    },
  ];

  /* ---- shared stage shapes -------------------------------------------- */
  // The escape leg. Hitman/Assassin's-Creed lesson: the job is not over at the
  // kill. This is one stage object, reused by every wet contract, rather than
  // three copies of a distance check.
  function escapeStage(text) {
    let from = null;
    return {
      id: "escape", goal: "custom", text: text || "Get clear", label: "GET CLEAR",
      color: 0xffd166,
      onEnter: function () {
        const p = P(); from = p ? { x: p.pos.x, z: p.pos.z } : null;
        push("—", "Now leave.", 2);
      },
      done: function () {
        const p = P(); if (!p || !from) return true;
        if ((g.wanted | 0) > 0) return false;              // not clear while hunted
        return d2(p.pos.x, p.pos.z, from.x, from.z) > 170;
      },
    };
  }

  function hijackDef(faction, cash, line) {
    const craft = anyMilitaryAircraft(); if (!craft) return null;
    const B = CBZ._militaryBase;
    const apron = (B && B.center) ? [B.center.x, B.center.z] : null;
    const stages = [];
    if (apron) {
      stages.push({ id: "apron", goal: "reach", at: apron, radius: 60,
        text: "Reach the airfield", label: "AIRFIELD" });
    }
    stages.push({ id: "take", goal: "steal", vehicle: craft, at: craft,
      text: "Take the aircraft", label: "AIRFRAME",
      onEnter: function () { push(faction === CELL ? "UNKNOWN" : "BUREAU", line, 1); } });
    stages.push({
      id: "fly", goal: "custom", text: "Get it off the ground and away", label: "AWAY",
      color: 0x7ec8ff,
      onEnter: function (m, st) { st._from = null; },
      done: function (m, st) {
        const p = P(); if (!p) return false;
        if (!st._from) { st._from = { x: p.pos.x, z: p.pos.z }; return false; }
        const high = (p.pos.y || 0) > 45;
        return high && d2(p.pos.x, p.pos.z, st._from.x, st._from.z) > 420;
      },
    });
    return {
      title: faction === CELL ? "Take the aircraft" : "Airframe recovery",
      brief: line,
      reward: { cash: cash, respect: 10, notoriety: faction === CELL ? 90 : 0 },
      color: 0x7ec8ff,
      stages: stages,
      doneText: "Airframe is yours.",
    };
  }

  // THE ASSASSINATION. Everything specific in it is read off the running
  // political simulation; this function authors only the verb and the prose.
  function sanctionDef(faction, cash) {
    const o = sittingOfficial(); if (!o) return null;
    const approval = Math.round((o.rec && o.rec.approval) || 0);
    const targeted = o.sid;
    let killed = false;
    subscribeOfficialDeath();
    const since = Date.now();              // only a death AFTER the handshake counts

    return {
      title: faction === CELL ? "The statement" : "Sanctioned removal",
      targetName: o.title + " " + o.name,
      locationName: "City Hall",
      // The dossier. Research is unanimous that a named target with a knowable
      // routine is the difference between a hit and a fetch quest — and every
      // number below is READ, not invented: his approval rating is approval.js's
      // live figure and his hours are officials.js's real schedule.
      brief: o.title + " " + o.name + " · approval " + approval + "%. City hall 09:00-17:00, "
        + "public appearance 17:00-19:00 on the plaza. He moves with a security detail.",
      reward: { cash: cash, respect: 30, notoriety: 220 },
      color: 0xff4d4d,
      exclusive: true,
      stages: [
        {
          id: "close", goal: "reach", at: o.door, radius: 26,
          text: "Get to City Hall", label: "CITY HALL",
          onEnter: function () {
            const h = CBZ.citySunHour ? Math.round(CBZ.citySunHour()) : null;
            push(faction === CELL ? "UNKNOWN" : "BUREAU",
              h == null ? "He is in the building." :
              (h >= 9 && h < 17) ? "He is inside now. Hours are good."
                : (h >= 17 && h < 19) ? "He is on the plaza right now — flanked."
                : "Building is dark. He will be in at nine.", 1);
          },
        },
        {
          id: "hit", goal: "custom", text: "Remove " + o.name, label: o.name.toUpperCase(),
          // live re-resolve: the door until he is spawned, then the man himself
          at: function () { return officialPed(targeted) || o.door; },
          done: function () {
            if (killed) return true;
            if (diedSince(targeted, since)) { killed = true; return true; }
            const ped = officialPed(targeted);
            if (ped && ped.dead) { killed = true; return true; }
            return false;
          },
        },
        escapeStage("Leave the district"),
      ],
      doneText: "It is done.",
      failText: "Contract closed — he is still breathing.",
      onComplete: function () {
        // NO new systems: approval.js, elections.js and officials.js's
        // succession already handle everything downstream of a dead mayor.
        if (CBZ.cityLogDeath) { try { CBZ.cityLogDeath(o.name, "sanctioned", { by: "you" }); } catch (e) {} }
        push(faction === CELL ? "UNKNOWN" : "BUREAU",
          faction === CELL ? "The city heard that." : "Never happened. Payment is clean.", 2);
      },
    };
  }
  // officials.js already broadcasts a real death for a real officeholder, with
  // real succession behind it (officials.js:171 CBZ.onOfficialDeath, fired from
  // its own cityKillPed wrap). We subscribe ONCE rather than poll a ped —
  // polling misses a holder who was never physically spawned, and officials.js
  // only manifests a body when the player is inside 80m during his hours.
  // Both the assassination (which completes on it) and the protective detail
  // (which fails on it) read the same signal.
  let lastOfficialDeath = null;
  let _deathSub = false;
  // Did the sid we are watching die SINCE this contract was handed out? The
  // record is never cleared (officials.js fires once per death, forever), and
  // the `t` stamp was dead weight — nothing read it. So a holder who died at
  // any point earlier in the session (a succession, a restored ledger that
  // re-seats the same deterministic sid, an earlier run of this very contract)
  // made sanctionDef's `hit` stage return true on its FIRST TICK: $22,000 and
  // +220 notoriety for walking to City Hall, and an instant auto-FAIL of the
  // protective detail on the same evidence.
  function diedSince(sid, since) {
    return !!(lastOfficialDeath && lastOfficialDeath.sid === sid && lastOfficialDeath.t > since);
  }
  function subscribeOfficialDeath() {
    if (_deathSub || !CBZ.onOfficialDeath) return;
    _deathSub = true;
    CBZ.onOfficialDeath(function (rec, sid) { lastOfficialDeath = { sid: sid, t: Date.now() }; void rec; });
  }

  /* ==============================================================
     THE BOARD — offers are registered with core/mission.js, which already
     owns filtering by faction + rank. We add nothing but the templates.
     ============================================================== */
  let posted = 0;
  function refresh() {
    const m = M(), f = F(); if (!m || !m.offer || !f) return;
    posted = 0;
    for (let i = 0; i < TEMPLATES.length; i++) {
      const T = TEMPLATES[i];
      let ok = false;
      try { ok = !!T.available(); } catch (e) { ok = false; }
      if (!ok) continue;
      posted++;
      m.offer({
        id: T.id, faction: T.faction, minRank: T.minRank, giver: T.giver,
        tryout: !!T.tryout,
        title: T.title, reward: T.pay,
        canOffer: function () { try { return !!T.available(); } catch (e) { return false; } },
        build: T.build,
      });
    }
  }

  // brief(factionId) — "ask for work" without a screen: takes ONE job and goes.
  // Kept because a fallback that needs no DOM is worth having (and because
  // every recruiter verb can still call it directly), but it is no longer the
  // player-facing path — see openBoard() below. A random pick out of a
  // rank-gated list was actively hostile: roll() is stable per day, so a
  // Sergeant asking for work got the SAME sweep all day and never once saw the
  // airstrike his rank had just unlocked. You choose now.
  function brief(factionId) {
    const m = M(), f = F(); if (!m || !f) return null;
    refresh();
    const list = m.offers({ faction: factionId });
    if (!list.length) {
      const rank = f.rank(factionId);
      push(nameOf(factionId), rank ? "Nothing at your level today. Keep serving." : "Nothing for you.", 0);
      return null;
    }
    // stable-per-day choice, so walking away and back does not reroll the job
    const pick = list[(roll(factionId.length + posted) * list.length) | 0] || list[0];
    if (m.busy && m.busy()) { push(nameOf(factionId), "Finish what you're carrying first.", 0); return null; }
    const started = m.take(pick.id);
    if (!started || started.inert) { push(nameOf(factionId), "That one fell through.", 0); return null; }
    return started;
  }
  function nameOf(id) {
    const f = F(); const d = f && f.def ? f.def(id) : null;
    return d ? String(d.short || d.name).toUpperCase() : "CONTACT";
  }

  /* ==============================================================
     THE BOARD, ON SCREEN.

     WHY THIS EXISTS (review finding, 2026-07-26): every piece of this arc
     worked except the one the player touches. mission.js kept a real offer
     list (CBZ.mission.offers()) and NOTHING in the build enumerated it — the
     Cause had no way to hand a member a second job at all, and the desks
     handed out a random one. An outfit you cannot ask for work is not a
     playable role.

     It is not a new UI language: this is careers.js's own contract-board
     idiom (careers.js:577-651) — one lazily-built fixed div, number keys to
     take, [Esc] to close, CBZ.cityMenuOpen + pointer-lock release, and it
     closes any open shop first. No new popup class, no floating card over
     gameplay, nothing added to the HUD (CLAUDE.md HUD doctrine: the killfeed
     stays the only floating card; the accepted job's prose still lives on the
     phone, drawn by core/mission.js).

     LOCKED RUNGS ARE SHOWN ON PURPOSE. "Every rung must unlock a VERB, not a
     bigger number" is only true to the player if he can SEE the verb waiting
     one rank up. The locked rows are derived from the very same `minRank`
     mission.js enforces, so the board cannot promise a capability the gate
     does not actually open.
     ============================================================== */
  let boardEl = null, boardRows = [], boardOpen = false, boardOnly = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return "$" + Math.round(+n || 0).toLocaleString(); }

  // Which outfits does this board speak for? Everything the player rides with
  // that has templates here, plus (for a non-member) any tryout on offer — the
  // Cause's unpaid favour is the one job a stranger can take.
  function boardFactions(only) {
    const f = F(); if (!f) return [];
    const seen = [], out = [];
    for (let i = 0; i < TEMPLATES.length; i++) {
      const id = TEMPLATES[i].faction;
      if (only && id !== only) continue;
      if (seen.indexOf(id) >= 0) continue;
      seen.push(id);
      // A faction earns a section if you ride with it — OR if ANY of its
      // templates is a tryout (the one job a stranger can take). Scanning only
      // the FIRST template of each faction got this wrong: `cell:courier` is
      // declared above `cell:tryout`, so the Cause was skipped for a
      // non-member and its recruiting job could never appear on a board.
      let open = f.isMember(id);
      if (!open) {
        for (let k = 0; k < TEMPLATES.length; k++) {
          if (TEMPLATES[k].faction === id && TEMPLATES[k].tryout) { open = true; break; }
        }
      }
      if (open) out.push(id);
    }
    return out;
  }

  // one row per template, with the LIVE reason it is or is not takeable.
  function rowsFor(factionId) {
    const f = F(); const out = [];
    const tier = f.tier(factionId);
    for (let i = 0; i < TEMPLATES.length; i++) {
      const T = TEMPLATES[i];
      if (T.faction !== factionId) continue;
      let there = false;
      try { there = !!T.available(); } catch (e) { there = false; }
      const need = (T.minRank == null) ? 0 : T.minRank;
      const rankOk = T.tryout ? !f.isMember(factionId) : (tier >= need);
      // QUOTE WHAT IT PAYS, not what it is worth to a Recruit. mission.js pays
      // `reward.cash * factions.payMul(faction)` (mission.js:456) and payMul is
      // the rank's own `cut` — 2.4 at Lieutenant — so the board advertising the
      // base number told a Lieutenant $9,000 and then paid $21,600. A displayed
      // number that is not the paid number is a stat fiction in the cheap
      // direction, which is still a lie.
      let mul = 1;
      try { if (f.payMul) mul = +f.payMul(factionId) || 1; } catch (e) { mul = 1; }
      // rankName() falls back to ranks[0] for an out-of-range key, which would
      // print "needs Recruit" AT a Recruit. Name the tier when we cannot name
      // the rung.
      const keys = f.ladderKeys(factionId) || [];
      const needName = keys[need] ? f.rankName(factionId, keys[need]) : ("tier " + need);
      out.push({
        id: T.id, faction: factionId, title: T.title, giver: T.giver,
        pay: Math.round((T.pay || 0) * mul),
        ok: there && rankOk,
        why: !rankOk ? ("needs " + needName) : (!there ? "nothing to hit today" : ""),
        tier: need,
      });
    }
    return out.sort(function (a, b) { return a.tier - b.tier; });
  }

  function ensureBoard() {
    if (boardEl) return boardEl;
    boardEl = document.createElement("div");
    boardEl.id = "cityOrderBoard";
    boardEl.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:49;" +
      "display:none;min-width:380px;max-width:min(560px,94vw);background:rgba(14,16,22,.96);" +
      "border:2px solid #3a3140;border-radius:16px;padding:16px 18px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto";
    // click-to-take as well as number keys — touch has no number row
    // (CLAUDE.md: never render keyboard key glyphs on touch; the rows carry the
    // job's own words either way, the [n] pip is just a desktop accelerator).
    boardEl.addEventListener("click", function (e) {
      let n = e.target;
      while (n && n !== boardEl && !(n.getAttribute && (n.getAttribute("data-take") || n.getAttribute("data-leave") || n.getAttribute("data-close")))) n = n.parentNode;
      if (!n || n === boardEl) return;
      if (n.getAttribute("data-close")) { closeBoard(); return; }
      const lv = n.getAttribute("data-leave");
      if (lv) { leaveRow(lv); return; }
      takeRow(parseInt(n.getAttribute("data-take"), 10));
    });
    document.body.appendChild(boardEl);
    return boardEl;
  }

  function closeBoard() {
    if (boardEl) boardEl.style.display = "none";
    boardOpen = false;
    pendingLeave = "";                      // a confirm never survives the panel

    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  /* THE WAY OUT.
     Leaving used to be an interactions.js option on `slot:"j"` at each desk —
     and interactions.js only ever emits ONE row and hard-codes its key to "e"
     (interactions.js:300-306). `slot` is not a keybinding, it is a tiebreak
     bonus, and `bad:true` costs -240 score on top. So the discharge / resign /
     burn-the-thread verbs could never render, could never be pressed, and were
     the ONLY callers of CBZ.factions.leave in the repo: membership in the
     Garrison, the Bureau and the Cause was a one-way door, and since the
     Garrison declares hostileTo:["cell","gang"] that door also permanently shut
     you out of every gang. The only remaining exit was failing five contracts.
     It lives on the board now, which owns its own click handler and can
     actually be pressed. Two presses — quitting an outfit you spent an hour
     climbing should not be one stray tap. */
  let pendingLeave = "";
  function leaveRow(id) {
    const f = F(); if (!f || !f.isMember(id)) return;
    const d = f.def(id) || { name: id, short: id };
    if (pendingLeave !== id) {
      pendingLeave = id;
      note("Walk away from the " + d.name + "? Press it again to make it final.", 3.2, nameOf(id));
      openBoard(boardOnly);                 // redraw so the row shows the warning
      return;
    }
    pendingLeave = "";
    f.leave(id, "quit");
    // If that was the last outfit you rode with, openBoard() refuses and would
    // leave a stale panel on screen with CBZ.cityMenuOpen stuck true — a hard
    // lock. Close it ourselves when there is nothing left to draw.
    if (!openBoard(boardOnly)) closeBoard();
  }

  function takeRow(i) {
    const m = M(), r = boardRows[i];
    if (!m || !r) return;
    if (!r.ok) { note(r.why || "Not yet.", 2, nameOf(r.faction)); return; }
    if (m.busy && m.busy()) { note("Finish what you're carrying first.", 2.2, nameOf(r.faction)); return; }
    closeBoard();
    refresh();
    const started = m.take(r.id);
    if (!started || started.inert) push(nameOf(r.faction), "That one fell through.", 0);
  }

  // openBoard(factionId?) — with no argument it speaks for every outfit you
  // ride with, which is the whole point: the Cause has no desk (a terror cell
  // with a walk-in counter would be a stat fiction) and the gang has no desk
  // either, so the ONE board has to be reachable from any of them.
  function openBoard(only) {
    const f = F(), m = M(); if (!f || !m) return false;
    if (CBZ.cityMenuOpen && !boardOpen) return false;
    boardOnly = only || null;               // so leaveRow() can redraw in place
    if (CBZ.cityCloseShop) { try { CBZ.cityCloseShop(); } catch (e) {} }
    refresh();
    const ids = boardFactions(only);
    if (!ids.length) { note("You don't ride with anyone who has work.", 2.4, "CONTACT"); return false; }
    const touch = !!CBZ.touchMode;
    boardRows = [];
    const leaveHtml = {};
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>Contracts</div>";
    for (let a = 0; a < ids.length; a++) {
      const id = ids[a], d = f.def(id) || { name: id };
      const member = f.isMember(id);
      const rk = member ? f.rankName(id, f.rank(id)) : null;
      const nx = member ? f.nextRank(id, f.rank(id)) : null;
      html += "<div style='margin:10px 0 4px;font-size:13px;color:#ffd166;font-weight:700'>" + esc(d.name) +
        (rk ? " <span style='color:#8a93a3;font-weight:400'>· " + esc(rk) +
          (nx ? " → " + esc(nx.pip) : " · top") + "</span>" : "") + "</div>";
      // The Cause's channel is a PLACE, so the board says where it is — this is
      // the only outfit whose "come back for more work" instruction is an
      // address rather than a desk you are already standing at.
      if (id === CELL && member) {
        const w = dropName();
        if (w) html += "<div style='font-size:11px;color:#8a93a3;margin:-2px 0 4px'>Drop: " + esc(w) + "</div>";
      }
      const rows = rowsFor(id);
      if (!rows.length) html += "<div style='font-size:12px;color:#8a93a3'>Nothing posted.</div>";
      leaveHtml[id] = member
        ? ("<div data-leave='" + esc(id) + "' data-act='leave' style='padding:7px 0;min-height:30px;cursor:pointer;font-size:12px;color:"
          + (pendingLeave === id ? "#ff6b6b'>Press again to leave the " : "#6b7382'>Leave the ") + esc(d.short || d.name) + "</div>")
        : "";
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.ok) {
          const n = boardRows.push(r);           // 1-based index IS the hotkey
          // `data-act` is carried purely so css/mobile.css:270-276's coarse-
          // pointer rules (touch-action:manipulation, 44px min tap target) hit
          // these rows for free; the click handler keys off data-take.
          html += "<div data-take='" + (n - 1) + "' data-act='take' style='padding:8px 0;min-height:34px;cursor:pointer'>" +
            (touch ? "" : "<b style='color:#ffd166'>" + n + "</b> ") + esc(r.title) +
            " <span style='color:#7ed957'>" + (r.pay > 0 ? money(r.pay) : "no pay") + "</span>" +
            " <span style='color:#5c6675;font-size:11px'>" + esc(r.giver) + "</span></div>";
        } else {
          html += "<div style='padding:8px 0;color:#5c6675'>" +
            "<b>·</b> " + esc(r.title) + " <span style='font-size:11px'>— " + esc(r.why) + "</span></div>";
        }
      }
      html += leaveHtml[id] || "";
    }
    // HUD DOCTRINE: never render keyboard key glyphs on touch. On a handset the
    // rows ARE the buttons and there is no number row to press.
    // A TAPPABLE way out. On touch there is no Escape key, and a modal that
    // sets CBZ.cityMenuOpen with no exit is a hard lock on the whole game.
    html += "<div data-close='1' data-act='close' style='margin-top:12px;padding:9px 0;min-height:34px;" +
      "text-align:center;cursor:pointer;color:#8a93a3;font-size:13px;border-top:1px solid rgba(255,255,255,.08)'>" +
      (touch ? "Close" : (boardRows.length ? "[1–" + Math.min(9, boardRows.length) + "] take · " : "") + "[Esc] close") + "</div>";
    ensureBoard().innerHTML = html;
    boardEl.style.display = "block";
    boardOpen = true;
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    return true;
  }

  addEventListener("keydown", function (e) {
    if (!boardOpen || !boardEl || boardEl.style.display !== "block") return;
    const k = String(e.key || "").toLowerCase();
    if (k === "escape") { e.preventDefault(); closeBoard(); return; }
    if (k >= "1" && k <= "9") { e.preventDefault(); takeRow(parseInt(k, 10) - 1); }
  });
  // the ONE shared death/arrest/mode-exit sweeper — never a local one
  // (CLAUDE.md: CBZ.mission.onInterrupt is what cures modal soft-locks).
  if (CBZ.mission && CBZ.mission.onInterrupt) CBZ.mission.onInterrupt(function () { if (boardOpen) closeBoard(); });

  /* ==============================================================
     RECRUITERS — real world positions only, via interactions.js.
     ============================================================== */
  let hallZoneUp = false;
  function wireHallZone() {
    if (hallZoneUp) return;
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return;
    const door = cityHallDoor(); if (!door) return;
    const tok = { x: door.x, z: door.z, kind: "bureau" };
    CBZ.interactions.registerZone({
      id: "bureau-desk", kind: "bureau", radius: 5.5,
      // prio feeds the candidate score (interactions.js:454). A city-hall door
      // is thick with civilians and shop zones; without this the field-office
      // card loses to whichever ped happens to be standing there.
      prio: 14,
      find: function (px, pz) {
        // re-read the door each frame: the arena can rebuild under us
        const d = cityHallDoor(); if (!d) return null;
        tok.x = d.x; tok.z = d.z;
        const dx = tok.x - px, dz = tok.z - pz;
        return (dx * dx + dz * dz) < 5.5 * 5.5 ? tok : null;
      },
      options: [
        {
          id: "bureau-join", slot: "i",
          label: function () {
            const f = F(); if (!f) return "Field office";
            if (f.isMember(AGENCY)) return "Field office — " + f.rankName(AGENCY, f.rank(AGENCY));
            return "Field office — apply";
          },
          canShow: function () { return !!F(); },
          onSelect: function () {
            const f = F(); if (!f) return;
            if (f.isMember(AGENCY)) { openBoard(AGENCY); return; }
            const c = f.canJoin(AGENCY);
            if (!c.ok) { note(c.why, 2.8, "BUREAU"); return; }
            f.join(AGENCY, "recruited");
          },
        },
        // (No "hand in the badge" option here. It used to sit on slot:"j" and
        //  could never render — interactions.js emits ONE row keyed "e", so a
        //  non-"e" slot is unreachable and `bad:true` scores -240 on top.
        //  Resigning lives on the orders board, which owns a real click
        //  handler. Keeping a dead verb here would be a lie in the panel.)
      ],
    });
    hallZoneUp = true;
  }

  /* ---- THE CAUSE'S DEAD DROP -------------------------------------------
     The Cause is the one outfit that must never have a desk, so a member had
     literally no way to be handed a second job — the ladder above Sympathiser
     was unreachable in practice. The honest answer is the one real cells use:
     a DEAD DROP. It is a real addressable lot the world already built, stable
     for the whole run (so it can be found again and told to you in words), and
     it only exists at all once you are in. No prop is spawned and nothing is
     claimed that isn't there: if the arena has no addresses, there is no drop.
     ---------------------------------------------------------------------- */
  let dropLot = null, dropZoneUp = false;
  function causeDrop() {
    const A = arena(); if (!A) return null;
    const lots = (A.lots && A.lots.length) ? A.lots : (A.shopLots || []);
    // The cache must be checked AGAINST THE LIVE ARENA, not just for
    // !demolished. A new run / new seed rebuilds every lot object, but the old
    // one is still a live JS object with demolished === false, so the drop kept
    // pointing at a building from a world that no longer existed. (wireHallZone
    // already re-reads its door every frame for exactly this reason.)
    if (dropLot && !dropLot.demolished && lots.indexOf(dropLot) >= 0) return dropLot;
    dropLot = null;
    let best = null, bestH = -1;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished || !l.building || !l.building.door) continue;
      // DETERMINISM LAW: position-hash, not Math.random and not a shared rng
      // stream — the drop must be the same address on every client, forever.
      const h = CBZ.hash01 ? CBZ.hash01(l.cx, l.cz, 0xd709) : 0.5;
      if (h > bestH) { bestH = h; best = l; }
    }
    dropLot = best;
    return dropLot;
  }
  // A dead drop you cannot find is not a channel. The Cause's whole recruiting
  // pipeline is a message with an ADDRESS in it, so the address has to survive
  // being read out loud: the building's own name if the world gave it one, plus
  // the registered region it stands in (worldmap.js's cityAnyRegion — the same
  // named regions the map labels), so "the warehouse, Dockside" is findable and
  // "the address" never has to be said.
  function dropName() {
    const l = causeDrop(); if (!l) return "";
    const what = (l.building && l.building.name) || l.name || (l.kind ? ("the " + l.kind) : "a place");
    let where = "";
    try {
      const A = arena();
      const reg = (A && CBZ.cityAnyRegion) ? CBZ.cityAnyRegion(A, l.cx, l.cz, 0) : null;
      if (reg && reg.name) where = ", " + reg.name;
    } catch (e) { where = ""; }
    return what + where;
  }
  function wireDropZone() {
    if (dropZoneUp) return;
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return;
    const l = causeDrop(); if (!l) return;
    const tok = { x: l.cx, z: l.cz, kind: "deaddrop" };
    CBZ.interactions.registerZone({
      id: "cause-drop", kind: "deaddrop", radius: 6.0,
      prio: 14,
      find: function (px, pz) {
        const f = F(); if (!f || !f.isMember(CELL)) return null;
        const d = causeDrop(); if (!d) return null;
        tok.x = d.cx; tok.z = d.cz;
        const dx = tok.x - px, dz = tok.z - pz;
        return (dx * dx + dz * dz) < 6.0 * 6.0 ? tok : null;
      },
      options: [
        {
          id: "cause-drop-read", slot: "e",
          label: function () { const f = F(); return "The drop — " + (f ? f.rankName(CELL, f.rank(CELL)) : "read it"); },
          onSelect: function () { openBoard(CELL); },
        },
        // (Burning the thread lives on the board — see the note at the Bureau
        //  desk above for why a slot:"j" verb can never be pressed.)
      ],
    });
    dropZoneUp = true;
  }

  /* ---- THE SET'S BOARD ---------------------------------------------------
     `gang:boss` (kill a real rival boss, Soldier+) was UNREACHABLE: the gang
     has no recruiting desk and the Cause's drop is CELL-only, so a crew member
     had no way to open a board at all and the template was a promise the game
     could not keep — a stat fiction by CLAUDE.md's definition. The fix is the
     same shape as the drop: a real world position that already exists.
     gangs.js's own gangHQ(gangId) resolves your crew's HQ (its boss's live
     position, else its claimed HQ lot, else its turf) — that IS where you go
     to get told what to do, and it moves with the boss like it should.
     ---------------------------------------------------------------------- */
  let hqZoneUp = false;
  function myHQ() {
    const f = F(); if (!f || !f.isMember(GANG) || !CBZ.cityGangHQ) return null;
    const org = f.orgIn(GANG); if (!org) return null;
    try { return CBZ.cityGangHQ(org); } catch (e) { return null; }
  }
  function wireHqZone() {
    if (hqZoneUp) return;
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return;
    const tok = { x: 0, z: 0, kind: "setboard" };
    CBZ.interactions.registerZone({
      id: "set-board", kind: "setboard", radius: 6.5, prio: 13,
      find: function (px, pz) {
        const hq = myHQ(); if (!hq) return null;
        tok.x = hq.x; tok.z = hq.z;
        const dx = tok.x - px, dz = tok.z - pz;
        return (dx * dx + dz * dz) < 6.5 * 6.5 ? tok : null;
      },
      options: [
        {
          id: "set-board-read", slot: "i",
          label: function () { const f = F(); return "The set's work — " + (f ? f.rankName(GANG, f.rank(GANG)) : "ask"); },
          onSelect: function () { openBoard(GANG); },
        },
      ],
    });
    hqZoneUp = true;
  }

  /* The Cause has no desk — they approach YOU. This is the one recruiting
     path that is a message rather than a place, which is also the only honest
     one: a terror cell with a walk-in counter would be a stat fiction. The
     trigger is notoriety the game already tracks. */
  let courtT = 0;                          // Date.now() of the last approach, 0 = never
  const COURT_COOLDOWN = 90 * 1000;        // real seconds before they try again
  function courtCell() {
    if (!CFG.CONTRACTS_V1) return;
    const f = F(); if (!f) return;
    if (f.isMember(CELL) || f.isMember(ARMY) || f.isMember(AGENCY)) return;
    // A ONE-SHOT `courted` FLAG WAS A PERMANENT LOCKOUT. It was set when the
    // tryout STARTED, not when it finished — and the tryout is "blow up a
    // building", which pins wanted stars, so dying part-way through is the
    // likely outcome, not the edge case. mission.js's interrupt sweeper then
    // failed the job and the flag stayed burnt for the rest of the run, with no
    // second door: courtCell is the only caller of take("cell:tryout"), and the
    // drop zone refuses non-members. One bad night and the Cause was gone
    // forever. A cooldown lets them come back around.
    if (courtT && (Date.now() - courtT) < COURT_COOLDOWN) return;
    const n = CBZ.cityNotoriety ? (CBZ.cityNotoriety().xp || 0) : (g.cityNotoriety || 0);
    if (n < 900) return;
    const M0 = M();
    // Never stack a job on top of a live one — brief() and takeRow() both guard
    // on this and courtCell did not, so a daily approach could silently steal
    // the HUD line, waypoint and beacon off whatever the player was carrying.
    if (M0 && M0.busy && M0.busy()) return;
    if (M0 && M0.byId && M0.byId("cell:tryout")) return;   // already running it
    courtT = Date.now();
    refresh();
    // Hand over the job, do not advertise a board that does not exist. The
    // tryout is the ONE offer a non-member can take (mission.js `tryout`), so
    // this is the Cause's entire recruiting pipeline: they call, you carry it
    // out, you are in.
    const m = M();
    const started = (m && m.take) ? m.take("cell:tryout") : null;
    if (started && !started.inert) {
      push("UNKNOWN", "We've watched your work. One favour, no money, no names — then we talk.", 2);
    } else {
      courtT = 0;                            // nothing to give yet; try again tomorrow
    }
  }

  /* ==============================================================
     JOINING ONE SIDE COSTS YOU THE OTHER — the fork that makes allegiance
     mean something (New Vegas's lesson; Skyrim's civil war is the warning).

     THE FORK ITSELF NOW LIVES IN factions.js (allegianceScan/applyFork/breaks).
     It used to be a wrapper on CBZ.factions.join right here, and that was
     wrong three ways: playergang.js patches you into a crew by writing
     g.cityMembership directly and never calls join(), so joining a GANG never
     forked at all; factions.js's own found() calls its module-local join, which
     a wrapper on the public method cannot see; and it fired silently, so
     enlisting cost you a crew you were never warned about. It is a membership
     STATE DIFF there now, which every path trips, and it quotes the price
     before charging it. All this file still owns is declaring who hates whom
     (hostileTo, above) and re-posting the board when the sides change. */
  let forkWired = false;
  function wireFork() {
    if (forkWired) return;
    const f = F(); if (!f || !f.allegianceScan) return;
    f.allegianceScan();                  // prime the diff at the world we booted into
    forkWired = true;
  }

  /* ==============================================================
     RANK UNLOCKS A VERB — the anti-vanity rule.

     Design critique of faction systems is unanimous on this: a rung that only
     raises a payout is a vanity XP bar. So there is NO separate unlock table
     here — a second table would be a claim, and an unenforced claim is a stat
     fiction (CLAUDE.md). `can()` is DERIVED from the very same minRank the
     board already enforces in mission.js's factionAllows(), so the answer to
     "what does Sergeant get me" is literally "these jobs, and you can check".
     ============================================================== */
  function can(factionId, verb) {
    const f = F(); if (!f) return false;
    const t = f.tier(factionId);
    if (t < 0) return false;
    for (let i = 0; i < TEMPLATES.length; i++) {
      const T = TEMPLATES[i];
      if (T.faction !== factionId) continue;
      if (T.id !== factionId + ":" + verb && T.id !== verb) continue;
      return t >= (T.minRank || 0);
    }
    return false;
  }
  // every verb this outfit's ranks gate, with the tier that opens it — read
  // off the live templates, so it cannot drift from what is enforced.
  function unlocks(factionId) {
    const out = [];
    for (let i = 0; i < TEMPLATES.length; i++) {
      const T = TEMPLATES[i];
      if (T.faction !== factionId || T.minRank == null) continue;
      out.push({ verb: T.id.split(":")[1], tier: T.minRank, title: T.title });
    }
    return out.sort(function (a, b) { return a.tier - b.tier; });
  }

  /* ==============================================================
     THE RATCHET — CBZ.contractAudit()  (BLOCK LAW #5)

     "Every rung must unlock a VERB, not just a bigger number" is the binding
     law of this whole wave, and until now it was a sentence in a comment. A
     sentence in a comment is exactly what the BLOCK LAW says does not work
     ("In-file 'RULE FOR NEW CODE' comments demonstrably did nothing"). So it
     is a NUMBER now, pinned at zero in the math gate like the tree connection
     law: `hollow` counts declared rungs that open nothing at all.

     A rung counts as covered if EITHER
       · a template on this board gates at that tier (a new job), OR
       · the rank def itself issues something real — a weapon through
         CBZ.cityGiveWeapon, or a named `unlock` string.
     Both are read off live data (TEMPLATES' own minRank; factions.js's own
     ladder), so this can never claim a rung is covered when the gate is not
     actually there.

     SCOPE: only the outfits whose ladders this board is responsible for
     (army / agency / cell). gangs.js's seven rungs each hand out real HP and
     a real weapon per RANKS — they are covered by the second clause, but the
     board does not own that ladder and does not police it.
     ============================================================== */
  const AUDITED = [ARMY, AGENCY, CELL];
  function auditRungs() {
    const f = F();
    const out = { factions: 0, rungs: 0, hollow: 0, detail: [] };
    if (!f || !f.ladder) return out;
    for (let a = 0; a < AUDITED.length; a++) {
      const id = AUDITED[a];
      if (!f.exists || !f.exists(id)) continue;
      const L = f.ladder(id) || [];
      if (!L.length) continue;
      out.factions++;
      for (let i = 0; i < L.length; i++) {
        out.rungs++;
        const r = L[i];
        let covered = !!(r.weapon || r.unlock);
        if (!covered) {
          for (let k = 0; k < TEMPLATES.length; k++) {
            const T = TEMPLATES[k];
            if (T.faction === id && (T.minRank | 0) === r.tier) { covered = true; break; }
          }
        }
        if (!covered) { out.hollow++; out.detail.push(id + ":" + r.key + " (tier " + r.tier + ")"); }
      }
    }
    return out;
  }
  CBZ.contractAudit = auditRungs;

  /* ==============================================================
     WIRING
     ============================================================== */
  declareOutfits();
  wireFork();
  // officials.js (:932) parses before this file (:987), so the one death
  // subscription is live from boot — a holder killed before any contract
  // exists is still recorded, and the detail contract can fail honestly.
  subscribeOfficialDeath();

  if (CBZ.onUpdate) {
    // INTERACT band: zones must exist before the interaction sweep reads them.
    CBZ.onUpdate(CBZ.PRIO ? CBZ.PRIO.after(CBZ.PRIO.INTERACT, 62) : 39.62, function () {
      if (!CFG.CONTRACTS_V1) return;
      if (g.mode !== "city") return;
      declareOutfits();
      wireFork();
      wireHallZone();
      wireDropZone();
      wireHqZone();
    });
  }
  // polity.js (:419) DEFINES CBZ.onNewDay and loads at index.html:925 — before
  // this file (:987) — so the bare guard is safe here. (factions.js at :651 is
  // NOT so lucky; see its wireDayTick retry.)
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function () {
      if (!CFG.CONTRACTS_V1) return;
      refresh();
      courtCell();
      // a member who has not been given work today gets one nudge, with the
      // channel named. The Cause's channel is a place; the others are desks.
      const f = F();
      if (f && f.isMember(CELL) && !(M() && M().busy && M().busy())) {
        const w = dropName();
        if (w) push("UNKNOWN", "There is something at " + w + ".", 0);
      }
    });
  }

  // the mission block adopts THIS file's jobs for free; declare the reverse so
  // the audit sees a board that owns no private mission machinery.
  if (CBZ.mission && CBZ.mission.adopt) CBZ.mission.adopt("city/contracts.js");

  // THE player-facing entry point. Every recruiter verb routes here; it is also
  // safe to call bare (no argument) from anywhere — it speaks for whatever the
  // player rides with and refuses honestly when that is nothing.
  //
  // NAMESPACE: `cityOrders`/`cityOrderBoard`, NOT `cityContracts`. The
  // `CBZ.cityContract*` family is ALREADY OWNED by city/wanted.js — it exports
  // cityContract(), cityContracts(), cityContractPing(), cityContractAbandon()
  // for the BOUNTY board (wanted.js:667-670). wanted.js loads at index.html:645
  // and this file at :987, so publishing `CBZ.cityContracts = {…}` here silently
  // replaced wanted.js's function with an object and would have thrown
  // "cityContracts is not a function" in the first caller that asked the bounty
  // board for its listings. "Orders" is also the right word: an order is what
  // this file's ladders actually credit.
  CBZ.cityOrderBoard = openBoard;
  CBZ.cityOrderBoardClose = closeBoard;

  CBZ.cityOrders = {
    brief: brief,
    board: openBoard,
    refresh: refresh,
    // where the Cause leaves its work (a real lot, stable per world seed)
    drop: function () { const l = causeDrop(); return l ? { x: l.cx, z: l.cz, name: dropName() } : null; },
    // what the board would show right now, as data — a probe can assert the
    // arcs are actually takeable without opening any DOM.
    rows: function (id) {
      const ids = boardFactions(id), out = [];
      for (let i = 0; i < ids.length; i++) out.push.apply(out, rowsFor(ids[i]));
      return out;
    },
    offers: function (id) { const m = M(); return m ? m.offers(id ? { faction: id } : null) : []; },
    can: can,
    unlocks: unlocks,
    // world binders, exposed so probes/gates can assert the world really does
    // supply a target rather than the board pretending it does.
    _official: sittingOfficial,
    _aircraft: anyMilitaryAircraft,
    _ground: anyMilitaryGround,
    _b2: theB2,
    _strikeLot: strikeLot,
    _rivalBoss: rivalBoss,
    // the "no vanity rungs" invariant, as data (pinned at hollow===0 by the gate)
    audit: auditRungs,
    _templates: function () { return TEMPLATES.map(function (t) { return t.id; }); },
    // count of templates whose target the LIVE world can actually supply
    live: function () {
      let n = 0;
      for (let i = 0; i < TEMPLATES.length; i++) { try { if (TEMPLATES[i].available()) n++; } catch (e) {} }
      return n;
    },
  };
})();
