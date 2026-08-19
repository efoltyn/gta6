/* ============================================================
   city/statecraft.js — HOLDING OFFICE: the powers of the seat, and the
   two-way wire to the army.

   WHY THIS FILE EXISTS: city/candidacy.js can put `rec.office.holder =
   "player"` on a real CBZ.polity record. Nothing in the tree made that
   worth winning, and nothing made it dangerous. This file is both halves.

   THE ONE LAW IT OBEYS (CLAUDE.md, "ALSO BANNED: stat fictions"): every
   number this file writes is a number some OTHER system already reads.
   Nothing here governs itself. The full ledger, power by power:

     salary        rec.treasury (polwar.js pays war upkeep out of it,
                   procurement drains it, civilwar.js splits it on a
                   fracture) -> g.cash (CBZ.city.addCash). If the treasury
                   is empty you are not paid, because the number is real.
     skim          g.cityPolitics.corruption (worldstate.js's reserved
                   block) -> a daily DISCOVERY roll writes .scandal, which
                   approval.js reads as `events -= scandal*0.1`. Corruption
                   is not a private score: it converts into the same
                   approval number elections.js and regimes.js read.
     police        CBZ.cityPoliceForceAdd(n) (police.js's live forcePool ->
                   real cop bodies) + CBZ.CITY.policeForce (the force
                   multiplier), captured/restored exactly like regimes.js
                   does it (_origPoliceForce), + rec.treasury drain +
                   CBZ.approvalShock. Its approval sign is READ OFF THE
                   WORLD: a city bleeding bodies (approvalState.murders7d)
                   wants police; a calm one resents them.
     taxUp/Down    rec.taxRate — approval.js's `services` term is literally
                   0.5*(0.10 - taxRate)/0.10, and sim/econstate.js runs
                   `treasury += taxRate*(activity*1000)`. Raising it fills
                   a real purse and costs real approval. This is the honest
                   core of governing and it is deliberately the cheapest
                   decree to reach.
     curfew        g.heat on the player standing outdoors in his OWN
                   jurisdiction between 23:00 and 05:00 (the law binds its
                   author) + CBZ.cityNpcOffense() on a strictly capped
                   handful of NPCs caught out, which is what makes the
                   police hunt them. regimes.js already owns the FASCIST
                   curfew (23:00-05:00 heat drip, one warning a night);
                   this is the LAWFUL version an elected officeholder can
                   call without being a dictator — same hours, real
                   approval cost, and it EXPIRES on a real day count. The
                   concept is extended, the code is not duplicated: this
                   drip only runs while OUR decree is live, and it stands
                   down on its own.
     amnesty       ped.npcHeat / ped.npcWanted / ped.bounty cleared on every
                   live ped inside the jurisdiction rect. peds.js's own
                   "is this target wanted" test (peds.js:1903) reads
                   npcWanted, so the cops visibly stop hunting them.
                   Popular in the street (CBZ.city.addRespect -> level.js's
                   infamy), unpopular at the ballot (approvalShock).
     emergency     g.cityPolitics.emergencyPowers. regimes.js ALREADY
                   escalates on this field: democracy -> emergencyRule at
                   >50 (with approval<35), and -> DICTATORSHIP at 100. This
                   is the rope. Each rung costs approval and tyranny, and
                   the last rung makes you the dictator of a country whose
                   regimeHeatMul() then hunts you harder.
     pardon        CBZ.cityWantedReset() / CBZ.cityReduceWanted(n) — the
                   sanctioned-pardon seam wanted.js already uses when a
                   bounty completion earns one ("The law looks the other
                   way this time"; wanted.js:591-604). Same voice here.
     guard         CBZ.protection's REAL detail "off_<officeId>" — the one
                   officials.js already creates for every officeholder,
                   principal.kind "sid", fundingSource "treasury". Funding
                   it grows real bodies from a real purse, and militia.js's
                   own daily tryEscalate() converts any detail past
                   MILITIA_HEADCOUNT(6) into a real gang-machinery faction.
                   We never spawn a guard: we grow the force the world has.
     surge         CBZ.cityPoliceForceAdd + CBZ.CITY.policeForce, temporary,
                   treasury-funded, and it DECAYS on the daily tick with a
                   tracked restore path.
     martial       Real troopers off CBZ.cityMilitaryPersonnel (every one
                   carries organization === "military", so CBZ.factions.of()
                   answers "army" for free) walked out of Fort Brandt and
                   posted at a real point with ped.guard. World.js's own
                   clampToCity treats mainland+regions as ONE walkable
                   union, so a soldier ordered into the city stays there.
                   The order also DEBITS real matériel:
                   CBZ.polwar.militaryOf(country).soldiers/.readiness, which
                   feed polwar's combatPower(), its aggressor test, AND
                   civilwar.js's coupEligible() (readiness < 0.35).

   THE ORDER MUST BE REFUSABLE — this is the design, not a flourish.
   legitimacy() = approvalBand x (1 - tyranny/100). Below MARTIAL_LEGIT the
   garrison DECLINES, with a line, on the phone, from the officeholder of
   the federal territory Fort Brandt sits in (a real sid, never a minted
   fake). A refusal is not flavour: it drops mil.readiness, and low
   readiness under a low-approval authoritarian regime is EXACTLY
   civilwar.js's coup precondition. We do not write a coup. We raise the
   real pressure the existing systems already read and let them come.

   TYRANNY (Victoria 3's running cost, not a morality meter): one number,
   one writer (addTyranny — CBZ.gov.forceUsed is that same writer, exported
   so games/government.js can price a gavelled bill through the same door).
   It decays daily and does exactly two real things: it lowers legitimacy()
   (so the army stops obeying) and it drags approval every day it sits
   above TYRANNY_DRAG_FLOOR (so elections.js and regimes.js come for you).

   YOU ARE A TARGET: contracts.js's assassination board binds to the
   sitting officeholder, which once candidacy.js lands is the player. When
   holds() goes null — death, succession, a lost election, a coup — EVERY
   number this file raised has a restore path and standDownAll() walks it:
   CBZ.CITY.policeForce back to _origPoliceForce, every forcePool body added
   subtracted again, every deployed trooper walked home to its stored
   origin, mil.readiness/mil.soldiers refunded, the curfew repealed. Spent
   treasury, spent approval and accrued tyranny are NOT refunded (they were
   really spent) and rec.taxRate is NOT reverted (a tax rate is a policy the
   successor inherits — regimes.js writes that same field the same way).
   Wired twice: CBZ.mission.onInterrupt (the one sanctioned death/arrest/
   mode-exit sweeper) and a holds()-went-null check on the daily tick.

   HUD DOCTRINE: the killfeed is the only popup. World events go out as
   CBZ.phoneNotify({app:"news", from:"City Desk"}), orders directed at you
   as {app:"system"}, and CBZ.city.big() is spent only on a deployment or a
   country changing hands. There is NO dashboard and no slider panel here
   on purpose (Democracy 4's stat screen does not survive translation into
   a 3D city): powers are exercised at a desk (CBZ.civic, feature-detected)
   or in the world (our own interactions zone at Fort Brandt's HQ).

   PERSISTENCE: the g.cityWorld dual-rider pattern every P-wave file uses,
   with the P5 chain-growth fix's one-shot install guard (a module-local
   boolean checked BEFORE ever wrapping, so re-entering this tick after a
   later module wrapped above us can never grow the commit chain). Ledger
   key `gov`, own flag _govWrap. Deployed BODIES are runtime-only (the
   repo-wide "physical presence re-materializes" convention); the DEBITS
   they hold against polwar are persisted so a restored save still refunds
   the right amount at stand-down.

   LOAD ORDER: a <script> tag AFTER city/militia.js and city/polwar.js and
   after city/civilwar.js (we read all three), i.e. anywhere in the tail of
   the P/X-wave block. Everything outside this file is feature-detected and
   lazily retried, so a wrong-but-late position degrades to no-op, never a
   throw.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  if (!CBZ.CONFIG) return;

  // ---- FLAGS (self-defaulted here; src/config.js is not ours to edit) ----
  if (CBZ.CONFIG.GOV_OFFICE == null) CBZ.CONFIG.GOV_OFFICE = true;      // the seat: salary, decrees, pardon
  if (CBZ.CONFIG.GOV_MILITARY == null) CBZ.CONFIG.GOV_MILITARY = true;  // deploy(): guard / surge / martial

  // own seeded LCG — repo convention for world state (never Math.random).
  let _seed = 774113329 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function money(n) { return "$" + Math.round(n).toLocaleString(); }

  // ============================================================
  //  TUNING
  // ============================================================
  const SALARY = { city: 420, state: 900, federal: 900, country: 1800 };
  const SKIM_FRAC = 0.06;            // of the live treasury, per skim
  const SKIM_CAP = 25000;
  const SKIM_COOLDOWN = 2;           // world days
  const SKIM_CORRUPTION = 9;         // -> g.cityPolitics.corruption
  const DISCOVERY_DIVISOR = 220;     // P(discovered today) = corruption / this
  const DISCOVERY_SCANDAL = 8;

  const POLICE_COST = 6000, POLICE_BODIES = 6, POLICE_MUL = 1.15;
  const TAX_STEP = 0.02, TAX_MIN = 0, TAX_MAX = 0.30;
  const CURFEW_COST = 2500, CURFEW_DAYS = 2;
  const CURFEW_LO = 23, CURFEW_HI = 5, CURFEW_DRIP = 5;
  const CURFEW_NPC_MAX = 3, CURFEW_NPC_GAP = 18;   // per night / seconds between
  const AMNESTY_COOLDOWN = 3, AMNESTY_RESPECT = 12;
  const EMERGENCY_STEP = 20;

  const PARDON_COOLDOWN = 3;
  const SURGE_COST = 4000, SURGE_BODIES = 8, SURGE_DAYS = 2;
  const GUARD_COST = 3500;
  const MARTIAL_COST = 25000, MARTIAL_DAYS = 3, MARTIAL_BODIES = 6;
  const MARTIAL_LEGIT = 0.45;        // the band the garrison obeys inside
  const MARTIAL_UNREST_T = 0.5;
  const MARTIAL_READINESS = 0.08;    // held back while deployed, refunded on stand-down
  const REFUSAL_READINESS = 0.05;    // an army that refuses is an army that decays
  const READINESS_FLOOR = 0.1;

  const TYRANNY_MAX = 100, TYRANNY_DECAY = 2.5, TYRANNY_DRAG_FLOOR = 20, TYRANNY_DRAG_DIV = 12;

  // ============================================================
  //  STATE
  // ============================================================
  function fresh() {
    return {
      seatId: null, sinceDay: 0,
      tyranny: 0, refusals: 0, skimmed: 0,
      curfewUntil: 0, curfewNight: null, curfewFlagged: 0, curfewWarned: null,
      lastPardonDay: -999, lastSkimDay: -999, lastAmnestyDay: -999,
      forceAdded: 0, origPoliceForce: null, policeBumped: false,
      readinessHeld: 0, soldiersOut: 0,
      deployments: [],
      paidDay: -1,
    };
  }
  function reset() {
    // revert any LIVE config bump before wiping our own bookkeeping — the
    // regimes.js discipline: never leave CBZ.CITY.policeForce stuck.
    const S = g.govWorld;
    if (S) { try { restorePolice(S); } catch (e) {} }
    g.govWorld = fresh();
  }
  function st() { if (!g.govWorld) g.govWorld = fresh(); return g.govWorld; }

  function politics() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (w && w.politics) return w.politics;
    return g.cityPolitics || null;
  }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }

  // ============================================================
  //  THE SEAT
  // ============================================================
  function playerSid() { return (CBZ.officials && CBZ.officials.PLAYER_SID) || "player"; }
  function allRecs() {
    if (!CBZ.polity || !CBZ.polity.list) return [];
    return [].concat(CBZ.polity.list("city"), CBZ.polity.list("state"),
      CBZ.polity.list("federal"), CBZ.polity.list("country"));
  }
  // THE LADDER LIVES IN ONE FILE. officials.js exports titleFor() and that
  // is the one declaration; the hand-typed kind->title branches this file
  // kept "as the degrade fallback" WERE the copy doctrine counts (one of
  // eight). Deleted — the degrade is neutral "Official" prose, cosmetic
  // only, and a fallback ladder that can drift from its owner is worse.
  function titleOf(rec) {
    if (CBZ.officials && CBZ.officials.titleFor) { try { const t = CBZ.officials.titleFor(rec); if (t) return t; } catch (e) {} }
    return "Official";
  }
  function holds() {
    if (!CBZ.CONFIG.GOV_OFFICE) return null;
    const sid = playerSid();
    const recs = allRecs();
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!rec || !rec.office || rec.office.holder !== sid) continue;
      const S = st();
      // `id` IS the polity record id — games/government.js compares it
      // against CBZ.polity.of(x,z).id to decide who chairs a chamber.
      return { id: rec.id, rec: rec, title: titleOf(rec), kind: rec.kind, sinceDay: S.sinceDay || 0 };
    }
    return null;
  }
  function seatCountry(h) {
    if (!h || !CBZ.polity || !CBZ.polity.countryOf) return null;
    return CBZ.polity.countryOf(h.id) || null;
  }
  function inJurisdiction(h, x, z) {
    if (!h || !CBZ.polity || !CBZ.polity.of) return false;
    const rec = h.rec;
    if (rec.kind === "country" || rec.kind === "state") {
      const loc = CBZ.polity.of(x, z);
      if (!loc) return false;
      const up = rec.kind === "country" ? CBZ.polity.countryOf(loc.id) : CBZ.polity.stateOf(loc.id);
      return !!(up && up.id === rec.id);
    }
    const r = rec.rect;
    if (!r) return false;
    return Math.abs(x - r.cx) <= r.hx && Math.abs(z - r.cz) <= r.hz;
  }

  // ============================================================
  //  MESSAGING — HUD doctrine: news to the phone, orders to the phone, and
  //  big() spent only on a deployment or a country changing hands.
  // ============================================================
  function news(text) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: text, priority: 1 }); return; } catch (e) {} }
    if (CBZ.cityFeed) CBZ.cityFeed(text, "#ffd76a");
  }
  function orders(from, text, prio) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "system", from: from, text: text, priority: prio == null ? 1 : prio }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 3.0);
  }
  function shock(id, n) { if (CBZ.approvalShock && isFinite(n)) try { CBZ.approvalShock(id, n); } catch (e) {} }

  // ============================================================
  //  TYRANNY — one number, ONE writer. CBZ.gov.forceUsed is this door,
  //  exported so any other system ("the player just ruled by force") prices
  //  its act through the same place instead of growing a second meter.
  // ============================================================
  function addTyranny(n, why) {
    if (!isFinite(n) || n <= 0) return;
    const S = st();
    S.tyranny = clamp((S.tyranny || 0) + n, 0, TYRANNY_MAX);
    S.lastForce = why || null;
  }
  function tyranny() { return st().tyranny || 0; }
  function approvalOf() { const h = holds(); return h ? (h.rec.approval || 0) : null; }
  function treasuryOf() { const h = holds(); return h ? (h.rec.treasury || 0) : null; }
  function legitimacy() {
    const h = holds();
    if (!h) return 0;
    const band = clamp01(((h.rec.approval || 0) - 20) / 60);
    return clamp01(band * (1 - tyranny() / 100));
  }

  // ============================================================
  //  THE PURSE — every payment is a real transfer out of a real treasury.
  // ============================================================
  function payFromTreasury(rec, amount) {
    const have = rec.treasury || 0;
    if (have < amount) return false;
    rec.treasury = have - amount;
    return true;
  }

  // ============================================================
  //  POLICE FORCE — bumped with a restore path, always (regimes.js's own
  //  _origPoliceForce discipline; a bump with no restore is a leak).
  // ============================================================
  function bumpPolice(S, bodies, mul) {
    if (CBZ.cityPoliceForceAdd && bodies) {
      try { CBZ.cityPoliceForceAdd(bodies); S.forceAdded = (S.forceAdded || 0) + bodies; } catch (e) {}
    }
    if (mul && CBZ.CITY && !S.policeBumped) {
      S.origPoliceForce = CBZ.CITY.policeForce != null ? CBZ.CITY.policeForce : 40;
      CBZ.CITY.policeForce = Math.round(S.origPoliceForce * mul);
      S.policeBumped = true;
    }
  }
  function restorePolice(S) {
    if (!S) return;
    if (S.forceAdded && CBZ.cityPoliceForceAdd) {
      try { CBZ.cityPoliceForceAdd(-S.forceAdded); } catch (e) {}
    }
    S.forceAdded = 0;
    if (S.policeBumped && CBZ.CITY && S.origPoliceForce != null) CBZ.CITY.policeForce = S.origPoliceForce;
    S.policeBumped = false; S.origPoliceForce = null;
  }

  // ============================================================
  //  DECREES — the desk, not the dashboard. Each entry declares the REAL
  //  number it moves in `moves`; audit() counts the ones that declare none,
  //  which is the ratchet: a power that governs only itself fails the gate.
  // ============================================================
  const DECREES = {
    police: {
      name: "Fund the force",
      cost: POLICE_COST,
      note: "Six more bodies on the street, paid out of the treasury.",
      moves: ["police.js forcePool via cityPoliceForceAdd", "CBZ.CITY.policeForce", "rec.treasury", "approvalShock"],
      live: function () { return !!st().policeBumped; },
      gate: function (h) {
        if ((h.rec.treasury || 0) < POLICE_COST) return { ok: false, why: "The treasury is short " + money(POLICE_COST - (h.rec.treasury || 0)) + "." };
        if (st().policeBumped) return { ok: false, why: "The force is already funded up." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        payFromTreasury(h.rec, POLICE_COST);
        bumpPolice(S, POLICE_BODIES, POLICE_MUL);
        // THE SIGN IS READ OFF THE WORLD, not off a bloc table: a city that
        // is burying people this week wants police; a calm one resents them.
        const murders = (CBZ.approvalState && CBZ.approvalState.murders7d) ? CBZ.approvalState.murders7d(h.id) : 0;
        const delta = murders >= 5 ? 4 : -4;
        shock(h.id, delta);
        addTyranny(2, "funded the police");
        news(h.title + " " + (delta > 0 ? "answers a bloody week with badges" : "puts six more badges on quiet streets")
          + " — " + money(POLICE_COST) + " out of the " + h.rec.name + " treasury.");
        return { ok: true, why: "" };
      },
    },
    taxUp: {
      name: "Raise the tax rate",
      cost: 0,
      note: "+2 points. Fills the treasury; the services line in every voter's head gets shorter.",
      moves: ["rec.taxRate -> approval.js services term", "rec.taxRate -> sim/econstate.js treasury flow"],
      live: function () { return false; },
      gate: function (h) {
        const r = h.rec.taxRate != null ? h.rec.taxRate : 0.10;
        if (r >= TAX_MAX - 1e-9) return { ok: false, why: "The rate is already at the ceiling." };
        return { ok: true };
      },
      run: function (h) {
        const before = h.rec.taxRate != null ? h.rec.taxRate : 0.10;
        h.rec.taxRate = clamp(before + TAX_STEP, TAX_MIN, TAX_MAX);
        shock(h.id, -5);
        news(h.rec.name + " raises the rate to " + Math.round(h.rec.taxRate * 100) + "%.");
        return { ok: true, why: "" };
      },
    },
    taxDown: {
      name: "Cut the tax rate",
      cost: 0,
      note: "-2 points. Popular, and the treasury stops filling.",
      moves: ["rec.taxRate -> approval.js services term", "rec.taxRate -> sim/econstate.js treasury flow"],
      live: function () { return false; },
      gate: function (h) {
        const r = h.rec.taxRate != null ? h.rec.taxRate : 0.10;
        if (r <= TAX_MIN + 1e-9) return { ok: false, why: "There is nothing left to cut." };
        return { ok: true };
      },
      run: function (h) {
        const before = h.rec.taxRate != null ? h.rec.taxRate : 0.10;
        h.rec.taxRate = clamp(before - TAX_STEP, TAX_MIN, TAX_MAX);
        shock(h.id, 5);
        news(h.rec.name + " cuts the rate to " + Math.round(h.rec.taxRate * 100) + "%.");
        return { ok: true, why: "" };
      },
    },
    curfew: {
      name: "Declare a curfew",
      cost: CURFEW_COST,
      note: "23:00 to 05:00 for two days. It binds you too.",
      moves: ["g.heat on the player outdoors at night", "ped.npcHeat/npcWanted via cityNpcOffense", "rec.treasury", "approvalShock", "tyranny"],
      live: function () { return day() < (st().curfewUntil || 0); },
      gate: function (h) {
        if (day() < (st().curfewUntil || 0)) return { ok: false, why: "A curfew is already in force." };
        if ((h.rec.treasury || 0) < CURFEW_COST) return { ok: false, why: "Overtime for a curfew costs " + money(CURFEW_COST) + "." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        payFromTreasury(h.rec, CURFEW_COST);
        S.curfewUntil = day() + CURFEW_DAYS;
        S.curfewNight = null; S.curfewFlagged = 0; S.curfewWarned = null;
        shock(h.id, -7);
        addTyranny(8, "declared a curfew");
        if (CBZ.city && CBZ.city.big) CBZ.city.big("CURFEW · " + String(h.rec.name).toUpperCase());
        news(h.title + " signs a curfew over " + h.rec.name
          + ": nobody on the street between 23:00 and 05:00 for " + CURFEW_DAYS + " days.");
        orders("Your office", "The curfew you signed does not exempt you. Be indoors by 23:00.", 1);
        return { ok: true, why: "" };
      },
    },
    amnesty: {
      name: "Declare an amnesty",
      cost: 0,
      note: "Outstanding charges dropped across the jurisdiction. The street remembers it; the ballot does too.",
      moves: ["ped.npcHeat/npcWanted/bounty on every ped in the rect", "g.respect via CBZ.city.addRespect", "approvalShock"],
      live: function () { return false; },
      gate: function (h) {
        const S = st();
        const since = day() - (S.lastAmnestyDay || -999);
        if (since < AMNESTY_COOLDOWN) return { ok: false, why: "Another amnesty this soon is worth nothing · " + (AMNESTY_COOLDOWN - since) + " day(s)." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        S.lastAmnestyDay = day();
        const peds = CBZ.cityPeds || [];
        let n = 0;
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || p.isPlayer) continue;
          if (!((p.npcWanted | 0) > 0 || (p.npcHeat || 0) > 0 || (p.bounty || 0) > 0)) continue;
          if (!inJurisdiction(h, p.pos.x, p.pos.z)) continue;
          p.npcHeat = 0; p.npcWanted = 0; p.bounty = 0;
          n++;
        }
        shock(h.id, -6);
        if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(AMNESTY_RESPECT);
        news(h.title + " signs an amnesty over " + h.rec.name + " — " + n + " outstanding case(s) dropped. "
          + "The law looks the other way this time.");
        return { ok: true, why: n ? "" : "nobody was being hunted" };
      },
    },
    emergency: {
      name: "Assume emergency powers",
      cost: 0,
      note: "+20 points. At 100 the country is a dictatorship and you are its dictator.",
      moves: ["g.cityPolitics.emergencyPowers -> regimes.js emergencyRule/dictatorship ladder", "approvalShock", "tyranny"],
      live: function () { const p = politics(); return !!(p && (p.emergencyPowers || 0) > 0); },
      gate: function (h) {
        if (h.kind === "city") return { ok: false, why: "Emergency powers are a national instrument. A mayor cannot reach them." };
        const p = politics();
        if (!p) return { ok: false, why: "No political record to write to." };
        if ((p.emergencyPowers || 0) >= 100) return { ok: false, why: "There is nothing left to assume. You already have it all." };
        return { ok: true };
      },
      run: function (h) {
        const p = politics();
        const before = p.emergencyPowers || 0;
        p.emergencyPowers = clamp(before + EMERGENCY_STEP, 0, 100);
        shock(h.id, -9);
        addTyranny(15, "assumed emergency powers");
        news("Emergency powers in " + h.rec.name + " stand at " + Math.round(p.emergencyPowers) + "%.");
        if (p.emergencyPowers >= 100) {
          orders("Your office", "There is no higher authority left to ask. Whatever happens next is yours.", 2);
        } else {
          orders("Your office", "Emergency powers at " + Math.round(p.emergencyPowers) + "%. At 100 the republic stops being one.", 1);
        }
        return { ok: true, why: "" };
      },
    },
    skim: {
      name: "Skim the treasury",
      cost: 0,
      note: "Six percent, into your own pocket. Auditors are slow, not blind.",
      moves: ["rec.treasury -> g.cash", "g.cityPolitics.corruption -> scandal -> approval.js events term", "tyranny"],
      live: function () { const p = politics(); return !!(p && (p.corruption || 0) > 0); },
      gate: function (h) {
        const S = st();
        const since = day() - (S.lastSkimDay || -999);
        if (since < SKIM_COOLDOWN) return { ok: false, why: "The books were touched too recently · " + (SKIM_COOLDOWN - since) + " day(s)." };
        const take = Math.min(SKIM_CAP, Math.round((h.rec.treasury || 0) * SKIM_FRAC));
        if (take < 100) return { ok: false, why: "There is nothing in the " + h.rec.name + " treasury worth taking." };
        return { ok: true };
      },
      run: function (h) {
        const S = st();
        const take = Math.min(SKIM_CAP, Math.round((h.rec.treasury || 0) * SKIM_FRAC));
        payFromTreasury(h.rec, take);
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(take);
        S.lastSkimDay = day();
        S.skimmed = (S.skimmed || 0) + take;
        const p = politics();
        if (p) p.corruption = clamp((p.corruption || 0) + SKIM_CORRUPTION, 0, 100);
        addTyranny(4, "skimmed the treasury");
        orders("Your office", money(take) + " moved. It will not stay invisible forever.", 0);
        return { ok: true, why: "" };
      },
    },
  };
  const DECREE_ORDER = ["taxDown", "taxUp", "police", "amnesty", "curfew", "skim", "emergency"];

  function decrees() {
    const h = holds();
    const out = [];
    for (let i = 0; i < DECREE_ORDER.length; i++) {
      const key = DECREE_ORDER[i], d = DECREES[key];
      let ok = !!h, why = h ? "" : "You hold no office.";
      if (h) { const gt = d.gate(h); ok = gt.ok; why = gt.why || ""; }
      out.push({ key: key, name: d.name, cost: d.cost, note: d.note, live: !!d.live(), ok: ok, why: why });
    }
    return out;
  }
  function decree(key) {
    if (!CBZ.CONFIG.GOV_OFFICE) return { ok: false, why: "Office powers are disabled." };
    const d = DECREES[key];
    if (!d) return { ok: false, why: "No such decree." };
    const h = holds();
    if (!h) return { ok: false, why: "You hold no office." };
    const gt = d.gate(h);
    if (!gt.ok) return { ok: false, why: gt.why };
    let r;
    try { r = d.run(h); } catch (e) { return { ok: false, why: "The order did not go through." }; }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return r || { ok: true, why: "" };
  }

  // ============================================================
  //  THE PARDON — Skyrim's Thane precedent: civic status gates a legal
  //  outcome. Inside your own jurisdiction only, with a HARD CEILING that
  //  is an exclusion and not a price, on a cooldown, at an approval cost
  //  that scales with what you erased.
  // ============================================================
  function pardon(opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.GOV_OFFICE) return { ok: false, why: "Office powers are disabled." };
    const h = holds();
    if (!h) return { ok: false, why: "You hold no office." };
    const S = st();
    const stars = CBZ.cityStars ? CBZ.cityStars() : (g.wanted | 0);
    if (stars <= 0) return { ok: false, why: "There is nothing on you to pardon." };

    const P = CBZ.player;
    const at = opts.at || (P && P.pos) || null;
    if (!at) return { ok: false, why: "No fixed position to judge jurisdiction by." };
    if (!inJurisdiction(h, at.x, at.z)) {
      return { ok: false, why: "This is not " + h.rec.name + ". Your writ does not run here." };
    }

    // THE CEILING — exclusions, not prices. A mayor cannot pardon a cop-
    // killing spree, a 5-star manhunt, or an armed incursion onto a
    // military base. Those are federal, and the pen does not reach them.
    if ((g.cityCopKills | 0) > 0) return { ok: false, why: "You killed police. No signature on earth covers that." };
    if (stars >= 5) return { ok: false, why: "A five-star manhunt is federal. The pen does not reach it." };
    if (g.cityCrimeLabel === "Military Incursion") return { ok: false, why: "That happened inside the wire. It is the army's file, not yours." };

    const since = day() - (S.lastPardonDay || -999);
    if (since < PARDON_COOLDOWN) return { ok: false, why: "You signed one " + since + " day(s) ago. Wait " + (PARDON_COOLDOWN - since) + "." };

    S.lastPardonDay = day();
    let erased = stars;
    if (stars <= 2) {
      if (CBZ.cityWantedReset) CBZ.cityWantedReset();
      else if (CBZ.cityReduceWanted) CBZ.cityReduceWanted(stars);
    } else {
      erased = 2;
      if (CBZ.cityReduceWanted) CBZ.cityReduceWanted(2);
    }
    const cost = 3 + 4 * erased;
    shock(h.id, -cost);
    addTyranny(5 + 4 * erased, "pardoned themselves");
    const selfName = (CBZ.officials && CBZ.officials.identityOf) ? CBZ.officials.identityOf(playerSid()).name : null;
    news((selfName && selfName !== "Someone" ? selfName : h.title) + " signs a pardon covering "
      + erased + " count(s) in " + h.rec.name + ". The law looks the other way this time.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return { ok: true, why: "", erased: erased, approvalCost: cost };
  }

  // ============================================================
  //  THE MILITARY
  // ============================================================
  // The general is a REAL person: the officeholder of the federal territory
  // Fort Brandt sits in. contracts.js's binding rule — never mint a fake
  // official when the world already runs one.
  function generalName() {
    if (!CBZ.polity || !CBZ.polity.list) return "Fort Brandt Command";
    const fed = CBZ.polity.list("federal") || [];
    for (let i = 0; i < fed.length; i++) {
      const r = fed[i];
      if (!r || !r.office || !r.office.holder) continue;
      const nm = (CBZ.officials && CBZ.officials.identityOf) ? CBZ.officials.identityOf(r.office.holder).name : null;
      if (nm && nm !== "Someone") return "Gen. " + nm;
    }
    return "Fort Brandt Command";
  }
  function militaryOf(h) {
    const c = seatCountry(h);
    if (!c || !CBZ.polwar || !CBZ.polwar.militaryOf) return null;
    try { return CBZ.polwar.militaryOf(c.id); } catch (e) { return null; }
  }
  // the WORLD's own reason to send soldiers into a street. If it cannot
  // supply one, the order is not offered at all (contracts.js's rule).
  function martialReason(h) {
    const c = seatCountry(h);
    if (!c) return null;
    if (CBZ.polwar && CBZ.polwar.activeWarFor) {
      try { if (CBZ.polwar.activeWarFor(c.id)) return "a shooting war"; } catch (e) {}
    }
    if (CBZ.civilwar && CBZ.civilwar.fractureOf) {
      try { if (CBZ.civilwar.fractureOf(c.id)) return "an armed secession"; } catch (e) {}
    }
    if (CBZ.civilwar && CBZ.civilwar.unrest) {
      try { if (CBZ.civilwar.unrest(c.id) > MARTIAL_UNREST_T) return "unrest past breaking point"; } catch (e) {}
    }
    return null;
  }
  function garrison() {
    const out = [];
    const T = CBZ.cityMilitaryPersonnel;
    if (!Array.isArray(T)) return out;
    for (let i = 0; i < T.length; i++) {
      const p = T[i];
      if (!p || p.dead || p._govDeployed || !p.pos) continue;
      if (p.organization !== "military") continue;
      if (CBZ.factions && CBZ.factions.of) {
        const ids = CBZ.factions.of(p);
        if (ids && ids.length && ids.indexOf("army") < 0) continue;
      }
      out.push(p);
    }
    return out;
  }
  // A REFUSED ORDER IS THE POINT. It does not just print a line: the
  // garrison decays (mil.readiness), and readiness under READINESS_T with a
  // low-approval authoritarian regime is exactly civilwar.js's coupEligible
  // precondition. We raise the pressure the existing systems read; we never
  // write our own coup.
  function refuse(h, why) {
    const S = st();
    S.refusals = (S.refusals || 0) + 1;
    const mil = militaryOf(h);
    if (mil && isFinite(mil.readiness)) {
      mil.readiness = Math.max(READINESS_FLOOR, mil.readiness - REFUSAL_READINESS);
    }
    shock(h.id, -3);
    addTyranny(5, "tried to order the army out");
    const gen = generalName();
    const line = S.refusals >= 3
      ? "That is the third time. The staff have stopped pretending it is a scheduling problem."
      : (S.refusals === 2
        ? "Again, no. Ask me when the country still recognises your signature."
        : "The garrison will not deploy on that order. " + why);
    orders(gen, line, 2);
    return { ok: false, why: why, refused: true, refusals: S.refusals };
  }

  function deployGuard(h, at) {
    if (!CBZ.protection || !CBZ.protection.create) return { ok: false, why: "No protection system loaded." };
    if ((h.rec.treasury || 0) < GUARD_COST) return { ok: false, why: "The detail costs " + money(GUARD_COST) + " and the treasury is short." };
    if (legitimacy() < 0.15) return refuse(h, "You are not legitimate enough to be worth guarding.");
    // THE DETAIL ALREADY EXISTS — officials.js creates "off_<recId>" for
    // every officeholder, treasury-funded, principal.kind "sid". create()
    // is idempotent on a caller-supplied id, so this hands back the real
    // record (escalated headcount and all) rather than shadowing it.
    let det = CBZ.protection.get ? CBZ.protection.get("off_" + h.id) : null;
    if (!det) {
      det = CBZ.protection.create({
        id: "off_" + h.id, principal: { kind: "sid", ref: playerSid() },
        gearTier: h.kind === "country" ? 2 : 1, formation: "escort",
        fundingSource: "treasury", legalStatus: "state", memberCount: 0,
      });
    }
    if (!det) return { ok: false, why: "The detail could not be raised." };
    const cap = (CBZ.protection.HIRE_CAP || 8);
    if ((det.memberCount || 0) >= cap) return { ok: false, why: "The detail is already at full strength." };
    payFromTreasury(h.rec, GUARD_COST);
    det.principal.ref = playerSid();
    det.memberCount = Math.min(cap, (det.memberCount || 0) + 1);
    // Grow the force the world already has — militia.js's own daily
    // tryEscalate() turns any detail past MILITIA_HEADCOUNT into a real
    // gang-machinery faction. We never spawn a guard ourselves.
    const threshold = (CBZ.militia && CBZ.militia.MILITIA_HEADCOUNT) || 6;
    if (det.memberCount >= threshold) addTyranny(6, "built a private army out of the public purse");
    const A = CBZ.city && CBZ.city.arena;
    const P = CBZ.player;
    if (A && CBZ.protection.spawnMembers) {
      const px = at && at.x != null ? at.x : (P ? P.pos.x : 0);
      const pz = at && at.z != null ? at.z : (P ? P.pos.z : 0);
      try { CBZ.protection.spawnMembers(det, A, px, pz, rng); } catch (e) {}
    }
    shock(h.id, -1);
    orders("Your office", "One more body on your detail · " + det.memberCount + " now, " + money(GUARD_COST) + " out of the treasury.", 0);
    return { ok: true, why: "", detail: det.id, memberCount: det.memberCount };
  }

  function deploySurge(h, at) {
    const S = st();
    if ((h.rec.treasury || 0) < SURGE_COST) return { ok: false, why: "A surge costs " + money(SURGE_COST) + " and the treasury is short." };
    for (let i = 0; i < S.deployments.length; i++) if (S.deployments[i].kind === "surge") return { ok: false, why: "A surge is already running." };
    if (legitimacy() < 0.2) return refuse(h, "The commissioner will not move officers on your word.");
    const P = CBZ.player;
    const pt = { x: at && at.x != null ? at.x : (P ? P.pos.x : 0), z: at && at.z != null ? at.z : (P ? P.pos.z : 0) };
    if (!inJurisdiction(h, pt.x, pt.z)) return { ok: false, why: "That point is outside " + h.rec.name + "." };
    payFromTreasury(h.rec, SURGE_COST);
    bumpPolice(S, SURGE_BODIES, 0);
    S.deployments.push({ kind: "surge", at: pt, day: day(), until: day() + SURGE_DAYS, bodies: SURGE_BODIES });
    shock(h.id, -2);
    addTyranny(4, "surged police into a neighbourhood");
    news(h.title + " surges " + SURGE_BODIES + " officers into " + h.rec.name + " for " + SURGE_DAYS + " days.");
    return { ok: true, why: "" };
  }

  function deployMartial(h, at) {
    const S = st();
    if (h.kind === "city") return { ok: false, why: "A mayor does not command soldiers. Win a state or the country first." };
    const reason = martialReason(h);
    // NOT OFFERED without a reason the simulation can name.
    if (!reason) return { ok: false, why: "No war, no fracture, no unrest. The garrison has no reason to leave the wire." };
    if (!CBZ._militaryBase) return { ok: false, why: "Fort Brandt is not on the map." };
    const troops = garrison();
    if (troops.length < MARTIAL_BODIES) return { ok: false, why: "Fort Brandt cannot field " + MARTIAL_BODIES + " right now." };
    if ((h.rec.treasury || 0) < MARTIAL_COST) return { ok: false, why: "Moving the garrison costs " + money(MARTIAL_COST) + "." };
    for (let i = 0; i < S.deployments.length; i++) if (S.deployments[i].kind === "martial") return { ok: false, why: "The garrison is already deployed." };

    // THE BAND. Below it the order is REFUSED, and the refusal has teeth.
    const leg = legitimacy();
    if (leg < MARTIAL_LEGIT) {
      return refuse(h, "Approval " + Math.round(h.rec.approval || 0) + ", and the file on how you govern is thick.");
    }

    const P = CBZ.player;
    const pt = { x: at && at.x != null ? at.x : (P ? P.pos.x : 0), z: at && at.z != null ? at.z : (P ? P.pos.z : 0) };
    if (!inJurisdiction(h, pt.x, pt.z)) return { ok: false, why: "That point is outside " + h.rec.name + "." };

    payFromTreasury(h.rec, MARTIAL_COST);
    const bodies = [];
    for (let i = 0; i < MARTIAL_BODIES && i < troops.length; i++) {
      const p = troops[i];
      const ang = (i / MARTIAL_BODIES) * Math.PI * 2;
      p._govHome = { x: p.pos.x, z: p.pos.z, guard: p.guard || null };
      p._govDeployed = true;
      p.pos.x = pt.x + Math.cos(ang) * 4.5;
      p.pos.z = pt.z + Math.sin(ang) * 4.5;
      p.guard = { x: pt.x, z: pt.z };
      p.path = null; p.state = "idle"; p.speed = 0;
      if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
      bodies.push(p);
    }
    // REAL MATERIEL, DEBITED. polwar's combatPower() and aggressor test and
    // civilwar's coupEligible() all read these; both are refunded on
    // stand-down, and the held amounts ride the save so a reload refunds
    // the right number.
    const mil = militaryOf(h);
    let heldR = 0, heldS = 0;
    if (mil) {
      if (isFinite(mil.readiness)) {
        heldR = Math.min(MARTIAL_READINESS, Math.max(0, mil.readiness - READINESS_FLOOR));
        mil.readiness -= heldR;
      }
      if (isFinite(mil.soldiers)) {
        heldS = Math.min(bodies.length, Math.max(0, mil.soldiers));
        mil.soldiers -= heldS;
      }
    }
    S.readinessHeld = (S.readinessHeld || 0) + heldR;
    S.soldiersOut = (S.soldiersOut || 0) + heldS;
    S.deployments.push({ kind: "martial", at: pt, day: day(), until: day() + MARTIAL_DAYS, bodies: bodies, n: bodies.length });

    shock(h.id, -11);
    addTyranny(18, "put soldiers on the street");
    if (CBZ.city && CBZ.city.big) CBZ.city.big("TROOPS DEPLOYED · " + String(h.rec.name).toUpperCase());
    news(h.title + " orders the Fort Brandt garrison into " + h.rec.name + " over " + reason + ". "
      + bodies.length + " soldiers on the street for " + MARTIAL_DAYS + " days.");
    orders(generalName(), "Column moving. " + bodies.length + " under arms, " + MARTIAL_DAYS + " days, and then they come home whatever you say.", 2);
    return { ok: true, why: "", bodies: bodies.length, reason: reason };
  }

  function deploy(kind, at) {
    if (!CBZ.CONFIG.GOV_MILITARY) return { ok: false, why: "Deployments are disabled." };
    const h = holds();
    if (!h) return { ok: false, why: "You hold no office." };
    if (kind === "guard") return deployGuard(h, at);
    if (kind === "surge") return deploySurge(h, at);
    if (kind === "martial") return deployMartial(h, at);
    return { ok: false, why: "No such order." };
  }
  function deployments() {
    const S = st();
    const out = [];
    for (let i = 0; i < S.deployments.length; i++) {
      const d = S.deployments[i];
      out.push({ kind: d.kind, at: { x: d.at.x, z: d.at.z }, day: d.day, until: d.until });
    }
    return out;
  }

  // ============================================================
  //  STAND-DOWN — every number this file raised has a restore path and
  //  this is where each one is walked. Traced by hand, one at a time:
  //    CBZ.CITY.policeForce  -> S.origPoliceForce            (restorePolice)
  //    police.js forcePool   -> S.forceAdded, subtracted     (restorePolice)
  //    trooper pos/guard     -> ped._govHome                 (sendHome)
  //    mil.readiness         -> S.readinessHeld, added back  (refundMil)
  //    mil.soldiers          -> S.soldiersOut, added back    (refundMil)
  //    curfew                -> S.curfewUntil = 0
  //  NOT restored, deliberately: spent treasury, spent approval, accrued
  //  tyranny (all really spent) and rec.taxRate (a policy the successor
  //  inherits — regimes.js writes that same field the same way).
  // ============================================================
  function sendHome(d) {
    const bodies = d.bodies || [];
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i];
      if (!p) continue;
      const home = p._govHome;
      p._govDeployed = false;
      if (!p.dead && home && p.pos) {
        p.pos.x = home.x; p.pos.z = home.z;
        p.guard = home.guard || null;
        p.path = null; p.state = "idle"; p.speed = 0;
        if (p.target && p.target.set) p.target.set(home.x, 0, home.z);
      }
      p._govHome = null;
    }
    d.bodies = [];
  }
  function refundMil() {
    const S = st();
    if (!(S.readinessHeld || S.soldiersOut)) return;
    // the seat may already be gone; refund to the country we debited, which
    // is the country of the seat if we still hold one, else the republic.
    const h = holds();
    let mil = h ? militaryOf(h) : null;
    if (!mil && CBZ.polwar && CBZ.polwar.militaryOf) {
      try { mil = CBZ.polwar.militaryOf(S.seatCountryId || "republic"); } catch (e) { mil = null; }
    }
    if (mil) {
      if (isFinite(mil.readiness) && S.readinessHeld) mil.readiness = clamp(mil.readiness + S.readinessHeld, 0, 1);
      if (isFinite(mil.soldiers) && S.soldiersOut) mil.soldiers = mil.soldiers + S.soldiersOut;
    }
    S.readinessHeld = 0; S.soldiersOut = 0;
  }
  function endDeployment(d) {
    if (d.kind === "martial") { sendHome(d); refundMil(); }
    else if (d.kind === "surge") {
      const S = st();
      if (CBZ.cityPoliceForceAdd && d.bodies) {
        try { CBZ.cityPoliceForceAdd(-(d.bodies | 0)); S.forceAdded = Math.max(0, (S.forceAdded || 0) - (d.bodies | 0)); } catch (e) {}
      }
    }
  }
  function standDownAll(quiet) {
    const S = st();
    let had = false;
    for (let i = S.deployments.length - 1; i >= 0; i--) {
      had = true;
      try { endDeployment(S.deployments[i]); } catch (e) {}
      S.deployments.splice(i, 1);
    }
    if (S.curfewUntil) { had = true; S.curfewUntil = 0; S.curfewNight = null; S.curfewFlagged = 0; }
    if (S.policeBumped || S.forceAdded) { had = true; restorePolice(S); }
    refundMil();
    if (had && !quiet) news("The orders stand down, the office changes hands.");
    return had;
  }

  // ============================================================
  //  DAILY TICK — salary, discovery, tyranny decay + drag, expiries, and
  //  the holds()-went-null sweeper.
  // ============================================================
  function dailyTick(d) {
    const S = st();
    const h = holds();

    // tyranny decays whether or not you still hold the seat.
    if (S.tyranny > 0) S.tyranny = Math.max(0, S.tyranny - TYRANNY_DECAY);

    if (!h) {
      if (S.seatId) { S.seatId = null; standDownAll(false); }
      else if (S.deployments.length || S.curfewUntil || S.policeBumped || S.forceAdded) standDownAll(true);
      return;
    }
    if (S.seatId !== h.id) { S.seatId = h.id; S.sinceDay = d; S.paidDay = -1; }
    const c = seatCountry(h);
    S.seatCountryId = c ? c.id : null;

    // ---- expiries (a real day count, honoured even across a reload) ----
    for (let i = S.deployments.length - 1; i >= 0; i--) {
      const dep = S.deployments[i];
      if (d < dep.until) continue;
      try { endDeployment(dep); } catch (e) {}
      S.deployments.splice(i, 1);
      if (dep.kind === "martial") news("The garrison returns to Fort Brandt.");
    }
    if (S.curfewUntil && d >= S.curfewUntil) {
      S.curfewUntil = 0; S.curfewNight = null; S.curfewFlagged = 0;
      news("The curfew over " + h.rec.name + " lapses.");
    }

    // ---- THE PAYCHEQUE — out of a real purse, or not at all ----
    if (S.paidDay !== d) {
      S.paidDay = d;
      const wage = SALARY[h.kind] || SALARY.city;
      const have = h.rec.treasury || 0;
      if (have >= wage) {
        h.rec.treasury = have - wage;
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(wage);
      } else if (have > 1) {
        h.rec.treasury = 0;
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(Math.round(have));
        orders("Treasury", "Payroll ran dry · " + money(have) + " is all there was.", 1);
      } else {
        orders("Treasury", "There is no money in " + h.rec.name + ". You were not paid.", 1);
      }
    }

    // ---- CORRUPTION IS DISCOVERABLE — it converts into scandal, and
    // approval.js reads scandal directly (events -= scandal*0.1).
    const p = politics();
    if (p && (p.corruption || 0) > 0) {
      if (rng() < (p.corruption || 0) / DISCOVERY_DIVISOR) {
        p.scandal = clamp((p.scandal || 0) + DISCOVERY_SCANDAL, 0, 100);
        p.corruption = clamp((p.corruption || 0) - 12, 0, 100);
        shock(h.id, -6);
        news("Auditors publish a line item nobody can explain. " + h.title + "'s office declines to comment.");
      }
    }

    // ---- TYRANNY'S RUNNING COST — a real daily drag on the real number
    // elections.js and regimes.js already read.
    if (S.tyranny > TYRANNY_DRAG_FLOOR) shock(h.id, -(S.tyranny - TYRANNY_DRAG_FLOOR) / TYRANNY_DRAG_DIV);
  }
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (d) {
      if (!CBZ.CONFIG.GOV_OFFICE) return;
      try { dailyTick(d); } catch (e) { try { console.error("[statecraft] daily tick failed", e); } catch (e2) {} }
    });
  }

  // ============================================================
  //  THE CURFEW TICK — regimes.js owns the FASCIST curfew at 33.3; this is
  //  the LAWFUL one, and it only runs while our own decree is live. The law
  //  binds its author: the player standing outside in his own jurisdiction
  //  after 23:00 takes the same heat drip anyone else does.
  // ============================================================
  let curfewT = 0, npcT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(33.35, function (dt) {
    if (!CBZ.CONFIG.GOV_OFFICE || g.mode !== "city") return;
    curfewT -= dt; if (curfewT > 0) return;
    curfewT = 1.0;
    const S = st();
    if (!S.curfewUntil || day() >= S.curfewUntil) return;
    const h = holds(); if (!h) return;
    const P = CBZ.player; if (!P || P.dead || !P.pos) return;
    const hr = CBZ.citySunHour ? CBZ.citySunHour() : 12;
    if (!(hr >= CURFEW_LO || hr < CURFEW_HI)) { S.curfewNight = null; return; }
    const d = day();
    if (S.curfewNight !== d) { S.curfewNight = d; S.curfewFlagged = 0; }

    const inside = inJurisdiction(h, P.pos.x, P.pos.z);
    const indoor = !!(CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(P.pos.x, P.pos.z));
    if (inside && !indoor) {
      g.heat = (g.heat || 0) + CURFEW_DRIP;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      if (S.curfewWarned !== d) {
        S.curfewWarned = d;
        orders("Dispatch", "Curfew. Your own curfew. Get inside.", 1);
      }
    }

    // A capped handful of people caught out — cityNpcOffense is what makes
    // the police actually hunt them (ped.npcWanted, peds.js:1903). Capped
    // hard on purpose: a curfew should bite, not flood the street with
    // manhunts.
    npcT -= 1.0;
    if (npcT > 0 || S.curfewFlagged >= CURFEW_NPC_MAX || !CBZ.cityNpcOffense) return;
    npcT = CURFEW_NPC_GAP;
    const peds = CBZ.cityPeds || [];
    let best = null, bestD = 45 * 45;
    for (let i = 0; i < peds.length; i++) {
      const q = peds[i];
      if (!q || q.dead || q.isPlayer || !q.pos) continue;
      if ((q.npcWanted | 0) > 0 || q.organization === "military" || q.kind === "cop") continue;
      if (!inJurisdiction(h, q.pos.x, q.pos.z)) continue;
      if (CBZ.cityNav && CBZ.cityNav.indoorLotAt && CBZ.cityNav.indoorLotAt(q.pos.x, q.pos.z)) continue;
      const dx = q.pos.x - P.pos.x, dz = q.pos.z - P.pos.z, dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = q; }
    }
    if (best) {
      try { CBZ.cityNpcOffense(best, 30, "curfew violation"); } catch (e) {}
      S.curfewFlagged = (S.curfewFlagged || 0) + 1;
    }
  });

  // ============================================================
  //  THE SWEEPER — mission.js's onInterrupt is the ONE sanctioned death/
  //  arrest/mode-exit hook. Wired lazily (mission.js may parse after us) and
  //  paired with the daily holds()-went-null check above, because an
  //  assassination that runs officials.js's succession does not necessarily
  //  route through a mission interrupt.
  // ============================================================
  let _sweeperWired = false;
  function wireSweeper() {
    if (_sweeperWired) return true;
    if (!CBZ.mission || typeof CBZ.mission.onInterrupt !== "function") return false;
    _sweeperWired = true;
    CBZ.mission.onInterrupt(function () {
      try { if (!holds()) standDownAll(true); } catch (e) {}
    });
    return true;
  }

  // ============================================================
  //  THE WORLD-SIDE DOOR — one interactions zone at Fort Brandt's HQ. The
  //  military connection has a place you stand. Everything richer belongs
  //  to CBZ.civic's desks (feature-detected, never required) or the phone;
  //  there is deliberately no dashboard here.
  // ============================================================
  let _zoneWired = false;
  function wireZone() {
    if (_zoneWired) return true;
    if (!CBZ.interactions || !CBZ.interactions.registerZone || !CBZ._militaryBase) return false;
    _zoneWired = true;
    const B = CBZ._militaryBase;
    const tok = { x: B.center.x, z: B.center.z, kind: "govcommand" };
    const R = 8;
    try {
      CBZ.interactions.registerZone({
        id: "gov-command", kind: "govcommand", radius: R,
        find: function (px, pz) {
          if (!CBZ.CONFIG.GOV_MILITARY || !holds()) return null;
          const dx = tok.x - px, dz = tok.z - pz;
          return (dx * dx + dz * dz) < R * R ? tok : null;
        },
        options: [{
          id: "gov-order-garrison", slot: "e",
          label: function () {
            const h = holds();
            if (!h) return "Command";
            const reason = martialReason(h);
            return reason ? "Order the garrison out (" + reason + ")" : "Ask the garrison for a briefing";
          },
          onSelect: function () {
            const h = holds();
            if (!h) return;
            const reason = martialReason(h);
            if (!reason) {
              orders(generalName(), "Nothing is burning, " + h.title + ". The wire holds. Go home.", 0);
              return;
            }
            const P = CBZ.player;
            const r = deploy("martial", P ? { x: P.pos.x, z: P.pos.z } : null);
            if (!r.ok && !r.refused) orders(generalName(), r.why, 1);
          },
        }],
      });
      if (CBZ.interactions.describe) {
        CBZ.interactions.describe("govcommand", function () {
          return { label: "Command HQ", note: "Fort Brandt garrison" };
        });
      }
    } catch (e) {}
    return true;
  }

  // ============================================================
  //  AUDIT — the CLAUDE.md ratchet. It counts POWERS THAT MOVE NO REAL
  //  NUMBER IN ANOTHER SYSTEM. Every entry below declares its seams in
  //  `moves`; a future power added without one makes this number go UP,
  //  which is the whole point. Must read 0.
  // ============================================================
  const POWER_MOVES = {
    salary: ["rec.treasury", "g.cash via CBZ.city.addCash"],
    pardon: ["CBZ.cityWantedReset / CBZ.cityReduceWanted -> g.wanted/g.heat", "approvalShock", "tyranny"],
    guard: ["CBZ.protection detail off_<id>.memberCount -> real spawned bodies", "rec.treasury", "militia.js escalation threshold"],
    surge: ["police.js forcePool via cityPoliceForceAdd", "rec.treasury", "approvalShock"],
    martial: ["CBZ.cityMilitaryPersonnel ped.pos/ped.guard", "CBZ.polwar militaryOf().soldiers", "CBZ.polwar militaryOf().readiness -> combatPower + civilwar coupEligible", "rec.treasury", "approvalShock"],
    refusal: ["CBZ.polwar militaryOf().readiness -> civilwar.js coupEligible", "approvalShock", "tyranny"],
    tyranny: ["legitimacy() gate on every deploy order", "daily approvalShock drag"],
  };
  function audit() {
    let n = 0;
    for (const k in DECREES) if (!(DECREES[k].moves || []).length) n++;
    for (const k in POWER_MOVES) if (!POWER_MOVES[k].length) n++;
    return n;
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.gov = {
    holds: holds,
    approval: approvalOf,
    legitimacy: legitimacy,
    tyranny: tyranny,
    treasury: treasuryOf,
    decrees: decrees,
    decree: decree,
    pardon: pardon,
    deploy: deploy,
    deployments: deployments,
    audit: audit,
    // THE ONE PLACE TYRANNY IS WRITTEN. games/government.js calls this when
    // the player gavels a bill past a council that voted it down; every
    // decree above routes through the same internal function. Announces
    // nothing — the caller already announced.
    forceUsed: function (amount, why) { addTyranny(+amount || 0, why); },
    // read-only extras the desks want
    title: function () { const h = holds(); return h ? h.title : null; },
    refusals: function () { return st().refusals || 0; },
    curfewUntil: function () { return st().curfewUntil || 0; },
    standDown: function () { return standDownAll(false); },
    reset: reset,
    serialize: serialize,
    apply: apply,
    // harness/test-only hooks — not part of the public contract (regimes.js's
    // own _forceGov / polwar.js's _forceDesperate precedent).
    _state: st, _martialReason: martialReason, _garrison: garrison,
    _refuse: refuse, _dailyTick: dailyTick,
  };
  CBZ.govAudit = audit;
  CBZ.govReset = reset;

  // ============================================================
  //  PERSISTENCE — deployed BODIES are runtime-only (the repo-wide
  //  "physical presence re-materializes" convention); the DEBITS they hold
  //  against polwar ARE carried, so a restored save refunds the right
  //  amount at stand-down instead of silently minting or eating soldiers.
  // ============================================================
  function serialize() {
    const S = st();
    const deps = [];
    for (let i = 0; i < S.deployments.length; i++) {
      const d = S.deployments[i];
      deps.push({ kind: d.kind, at: { x: d.at.x, z: d.at.z }, day: d.day, until: d.until, bodies: d.kind === "surge" ? (d.bodies | 0) : (d.n | 0) });
    }
    return {
      v: 1,
      seatId: S.seatId || null, seatCountryId: S.seatCountryId || null, sinceDay: S.sinceDay || 0,
      tyranny: S.tyranny || 0, refusals: S.refusals || 0, skimmed: S.skimmed || 0,
      curfewUntil: S.curfewUntil || 0,
      lastPardonDay: S.lastPardonDay, lastSkimDay: S.lastSkimDay, lastAmnestyDay: S.lastAmnestyDay,
      forceAdded: S.forceAdded || 0, origPoliceForce: S.origPoliceForce != null ? S.origPoliceForce : null,
      policeBumped: !!S.policeBumped,
      readinessHeld: S.readinessHeld || 0, soldiersOut: S.soldiersOut || 0,
      paidDay: S.paidDay,
      deployments: deps,
    };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const S = st();
    S.seatId = obj.seatId || null; S.seatCountryId = obj.seatCountryId || null;
    S.sinceDay = obj.sinceDay || 0;
    S.tyranny = clamp(+obj.tyranny || 0, 0, TYRANNY_MAX);
    S.refusals = obj.refusals | 0; S.skimmed = +obj.skimmed || 0;
    S.curfewUntil = obj.curfewUntil || 0;
    S.lastPardonDay = isFinite(obj.lastPardonDay) ? obj.lastPardonDay : -999;
    S.lastSkimDay = isFinite(obj.lastSkimDay) ? obj.lastSkimDay : -999;
    S.lastAmnestyDay = isFinite(obj.lastAmnestyDay) ? obj.lastAmnestyDay : -999;
    S.readinessHeld = +obj.readinessHeld || 0; S.soldiersOut = obj.soldiersOut | 0;
    S.paidDay = isFinite(obj.paidDay) ? obj.paidDay : -1;
    for (let i = 0; i < (obj.deployments || []).length; i++) {
      const d = obj.deployments[i];
      // martial bodies are runtime-only and do NOT re-materialize: the
      // record survives so the day-count expiry and the matériel refund
      // still run, but nobody is re-posted into the street on load.
      S.deployments.push({ kind: d.kind, at: { x: d.at.x, z: d.at.z }, day: d.day, until: d.until, bodies: d.kind === "surge" ? (d.bodies | 0) : [], n: d.bodies | 0 });
    }
    // re-assert only the cheap, idempotent CONFIG-level effect (regimes.js's
    // own reapplyStaticEffects discipline). forceAdded is NOT re-added:
    // police.js's forcePool is not persisted, so re-adding would inflate it.
    S.forceAdded = 0;
    S.origPoliceForce = isFinite(obj.origPoliceForce) ? +obj.origPoliceForce : null;
    S.policeBumped = !!obj.policeBumped;
    if (S.policeBumped && CBZ.CITY) {
      const base = S.origPoliceForce != null ? S.origPoliceForce : (CBZ.CITY.policeForce || 40);
      S.origPoliceForce = base;
      CBZ.CITY.policeForce = Math.round(base * POLICE_MUL);
    }
  }

  // ---- SINGLE-PLAYER PERSIST (the P-wave dual-rider pattern, with the P5
  // chain-growth fix's one-shot install guard — a module-local boolean
  // checked BEFORE ever wrapping, so a later module wrapping above us can
  // never make us re-wrap and grow the commit chain unboundedly).
  function stampGov() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.gov = serialize();
  }
  let _wrapsDone = false;
  function ensureSaveWraps() {
    if (_wrapsDone) return;
    _wrapsDone = true;
    const c = CBZ.cityWorldCommit;
    if (typeof c === "function" && !c._govWrap) {
      const w = function () { stampGov(); return c.apply(this, arguments); };
      w._govWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._govWrap) {
      const w2 = function () { stampGov(); return cc.apply(this, arguments); };
      w2._govWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  let _hydrated = null;
  function hydrate() {
    const led = g.cityWorld;
    if (!led || led === _hydrated) return;
    _hydrated = led;
    if (led.gov) apply(led.gov);
  }
  if (CBZ.onUpdate) {
    // 46.14 — a genuinely free slot (the brief's suggested 46.24 is taken by
    // sim/inflation.js; a repo-wide onUpdate(46.x) sweep says 46.04/.05/.10/
    // .14 are the free ones). Sits after polity 46.03, officials 46.06/.08,
    // protection 46.07 and approval 46.09, so every record and detail we
    // read is already hydrated when ours lands.
    CBZ.onUpdate(46.14, function () {
      if (!g) return;
      ensureSaveWraps();
      hydrate();
      wireSweeper();
      wireZone();
    });
  }
})();
