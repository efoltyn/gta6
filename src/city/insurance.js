/* ===========================================================================
   city/insurance.js — INSURANCE. A real trade, a real ladder, a real office
   whose desks have people at them in the day and nobody in them at night, and
   a payer of last resort standing behind every building this game lets you
   knock down.

   OWNER (2026-07-29, verbatim): "with all this take shit you have to add
   insurance — which adds a role, many levels of the company roles at the
   insurance companies, and a reason for the desks to be full of workers at the
   insurance company even if they are just sitting at the desks. It's a type of
   building there isn't much to go in for but it should work like every other
   business. This works for when the user blows up a building — if you made
   businesses real, in real life businesses don't go away."

   ---------------------------------------------------------------------------
   WHAT THIS FILE AUTHORS, AND WHAT IT REFUSES TO AUTHOR.

   It authors: a five-rung ladder, five trades, a book of covered addresses, a
   premium, a claim, and the ONE decision that makes any of it a game (below).

   It authors NO building, NO desk, NO chair, NO body, NO seated animation, NO
   commute, NO wallet, NO map marker, NO objective UI, NO rebuild timer and NO
   money. Every one of those already exists and is CALLED:

     the building     city/buildings.js already flips a stable subset of downtown
                      towers to lot.kind "office" and furnishes every storey with
                      rows of desks.
     the desks        officejobs.js's CBZ.cityOfficeDesks is the world-coord
                      registry those desks were already filed in. We pick a
                      branch out of it; we never place a desk.
     the bodies       citystaff.js's CBZ.cityStaffVenue / cityStaffPost — a job
                      is DATA at build time and a BODY only inside 120 m, given
                      back past 210 m, and a SHOT worker stays dead.
     sitting          entities/npclife.js's attach() — the same seat grammar the
                      airliner cabin and the taxi rank use, so the pose solves
                      feet-on-the-deck off the cushion the desk already declared.
     the ladder       city/factions.js — declare(), rankField, grants. This file
                      stores no rank; the rung lives in the field the world
                      writes (`insRank`), exactly like police.js's `copRank`.
     the money        city/take.js — cityHolds/cityTake. A premium is a transfer
                      OUT of your pocket INTO the firm's till, and a settlement
                      is a transfer out of THAT till. Nothing is minted, and the
                      insurer is measurably poorer after it pays you.
     the loss         city/structural.js's onCollapse seam (chained, never
                      clobbered) — it already knows which lot fell and whether
                      the player did it.
     the rebuild      city/demolition.js already heals a lot on the in-game
                      calendar. BUSINESSES DON'T GO AWAY was already true; what
                      was missing was somebody PAYING for it.
     the objective    core/mission.js — one start() buys the waypoint, the
                      beacon, the HUD distance line and the phone card.
     the counter verb city/roleverbs.js — five rows pointing at CBZ.insuranceVerb.

   ---------------------------------------------------------------------------
   THE ONE DECISION (why this is a game and not a spreadsheet).

   Every rung grants a VERB and every verb is a person who can be found, talked
   to and killed — CLAUDE.md's law, and police.js's Chief is the precedent:

     Clerk             quote   — sells cover at the counter.
     Adjuster          assess  — a loss is not a claim until somebody inspects it.
     Underwriter       bind    — cover above the small-policy ceiling.
     Claims Manager    settle  — authorises the money to actually move.
     Regional Director deny    — the fraud posture.

   So: insure your building, blow it up yourself, and the Regional Director
   refuses you. He is not a config flag. He is a man at a desk on the top floor
   of a building you can walk into. Kill him and the denial LAPSES for a minute
   or two — but if you also kill the Claims Manager nobody can sign the cheque,
   and you get nothing. A fraudulent claim is therefore a PRECISION job inside a
   working office, which is the "gun room" gradient THE WHY CONSTITUTION asks
   for: a locked thing, a visible route in, and a categorical reward at the end.

   It cannot become a money printer, and not one of the limiters is a constant:
   the payout comes out of a FINITE reserve that is poorer afterwards (take.js
   caps you at what the firm actually has), the building has to actually be
   destroyed, the Director has to actually be killed (in a room full of
   witnesses, for real stars), and the policy closes when it pays.

   Flags: INSURANCE (master) · INSURANCE_DESKS · INSURANCE_CLAIMS ·
          INSURANCE_RANKS.  Ratchet: CBZ.insuranceAudit().
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  const g = CBZ.game || (CBZ.game = {});

  // one-line reverts, declared HERE (CLAUDE.md: never race config.js)
  if (C.INSURANCE == null) C.INSURANCE = true;            // the whole file
  if (C.INSURANCE_DESKS == null) C.INSURANCE_DESKS = true; // the staffed branch
  if (C.INSURANCE_CLAIMS == null) C.INSURANCE_CLAIMS = true;// losses become claims
  if (C.INSURANCE_RANKS == null) C.INSURANCE_RANKS = true; // the org + its verbs
  // How much of the city an insurer actually writes. NOT a magic gameplay dial:
  // it is the share of buildings that carry cover, and it is what makes the
  // ticker occasionally show a settlement you had nothing to do with — the way
  // a player DISCOVERS this system exists at all.
  if (C.INSURANCE_BOOK_SHARE == null) C.INSURANCE_BOOK_SHARE = 0.55;
  // desks the branch actually mans. The office has more desks than this; the
  // rest stay in officejobs.js's walk-in registry for ordinary commuters, which
  // is the same STAFFED-vs-WALK-IN split buildings.js already draws.
  if (C.INSURANCE_STAFF == null) C.INSURANCE_STAFF = 10;

  function on() { return C.INSURANCE !== false; }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function now() { return (typeof CBZ.now === "number") ? CBZ.now : 0; }
  function hash01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }
  function money(n) { n = Math.round(n || 0); return n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + n; }
  function note(s, t) { if (CBZ.city && CBZ.city.note && s) { try { CBZ.city.note(s, t || 2.2); } catch (e) {} } }
  function flavor(s, col) { if (CBZ.cityFlavor && s) { try { CBZ.cityFlavor(s, col || "#bcd0ff"); } catch (e) {} } }
  function say(p, line) { if (CBZ.citySay && p && !p.dead && line) { try { CBZ.citySay(p, line, "#cfe6ff", 2.6); } catch (e) {} } }

  /* =========================================================================
     §1  THE LADDER — one declare(), five rungs, five verbs.

     `rankField: "insRank"` is the whole adoption cost and it is what keeps this
     a migration instead of parallel bookkeeping: factions.js never stores an
     NPC's rank, it reads the field §4 stamps on the body it posts.
     ========================================================================= */
  const ORG = "insurance";
  const RUNGS = [
    // pip                 job string             grants          lvl  wage
    ["Clerk",              "insurance clerk",     ["quote"],       9,  15],
    ["Adjuster",           "insurance adjuster",  ["assess"],     16,  22],
    ["Underwriter",        "underwriter",         ["bind"],       24,  30],
    ["Claims Manager",     "claims manager",      ["settle"],     33,  38],
    ["Regional Director",  "insurance director",  ["deny"],       44,  52],
  ];
  function rankKey(pip) {
    return String(pip).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  let orgDeclared = false;
  function declareOrg() {
    if (orgDeclared || C.INSURANCE_RANKS === false) return orgDeclared;
    if (!CBZ.factions || !CBZ.factions.declare) return false;
    const ranks = RUNGS.map(function (r) {
      return { pip: r[0], grants: r[2], lvl: r[3], pay: r[4], locked: true };
    });
    const d = CBZ.factions.declare({
      id: ORG,
      name: (branch && branch.name) || "City Mutual Assurance",
      short: "Assurance",
      kind: "firm",
      color: 0x3f7d9c,
      ranks: ranks,
      wage: 18,
      heat: 1,
      // WHERE AN NPC'S RANK ALREADY LIVES (§4 writes it, we never store one).
      rankField: "insRank",
      npcTag: { field: "organization", value: ORG },
      lore: "Writes the cover the city forgets it has until something falls over.",
    });
    orgDeclared = !!d;
    return orgDeclared;
  }

  /* THE CHAIR, NOT THE BODY.

     `CBZ.rankHolder(org, verb)` answers "is there a living body in the world
     that may do this", and that is the WRONG question for an office 3 km away
     with nobody minted in it — every claim in the city would settle itself the
     moment you drove out of town. police.js already solved this exact problem:
     the chair is OCCUPIED unless somebody KILLED the officeholder, and then it
     stands empty for a minute or two while the seat is filled again.

     So `chair[verb]` is a lapse-until stamp. Zero means held. It only ever
     moves when a posted holder of that verb actually dies, which is a thing you
     can do with your hands. rankKnows() is the degrade-safe guard (CLAUDE.md:
     a bare rankCan null-check would slam every gate shut with FACTION_V1 off). */
  const chair = { quote: 0, assess: 0, bind: 0, settle: 0, deny: 0 };
  // How long a killed officeholder's desk stands empty — the same 60-150 s
  // police.js leaves a killed commander's chair vacant for. It is stamped on the
  // POST, not just on the chair, because citystaff's own law is that a shot
  // worker is never quietly re-minted: the desk must genuinely be empty, the
  // order must genuinely lapse, and only then does head office send somebody
  // new. A vacancy with an end date is a consequence; an instant replacement is
  // a no-op and a permanent hole is a branch that bleeds out over one session.
  function vacancy(ped) {
    const h = ped && ped.pos ? hash01(ped.pos.x, ped.pos.z, 0x15c0) : 0.5;
    return (60 + h * 90) * 1000;
  }
  function verbKnown(verb) {
    if (C.INSURANCE_RANKS === false) return false;
    return CBZ.rankKnows ? !!CBZ.rankKnows(ORG, verb) : false;
  }
  // Is the office able to do this right now? Unknown verb (flag off, factions
  // absent) => TRUE, because the pre-ladder behaviour was "the office just
  // works" and a one-line revert must never make the feature worse.
  function officeCan(verb) {
    if (!verbKnown(verb)) return true;
    return now() >= (chair[verb] || 0);
  }
  // THE ORDER ONLY LAPSES IF NOBODY IS LEFT WHO CAN GIVE IT. Six clerks share
  // `quote`, so shooting one does not shut the counter; there is exactly one
  // Regional Director, so shooting him does stop the refusals. Killing everybody
  // who can sell you a policy shuts the counter, which is correct and is the
  // player's own doing. Position-hashed so two clients agree with no messaging.
  function vacate(verb, ped) {
    if (!verbKnown(verb)) return;
    if (branch) {
      for (let i = 0; i < branch.posts.length; i++) {
        const q = branch.posts[i];
        if (q._insGrant !== verb) continue;
        if (q.ped && q.ped !== ped && !q.ped.dead) return;   // somebody else still holds it
      }
    }
    chair[verb] = now() + vacancy(ped);
  }

  /* =========================================================================
     §2  THE TRADES — five rows, additively merged into aigoals.js's CITY_JOBS.

     This is citystaff.js's TRADES pattern verbatim (its own comment explains
     why: a job the world casts that the ONE job table has never heard of has no
     workplace, no shift and no wage, and CLAUDE.md counts ~120 of those).

     `office: true` is the load-bearing word. It is the flag aigoals.js's
     isOfficeJob() reads, and it buys the ENTIRE commute: goEarn claims a desk
     through officejobs.js, routes the walk with sitDesk:true, peds.js seats the
     body on arrival, payday fires at the chair and dusk's goHome releases it.
     Not one line of that is written here.
     ========================================================================= */
  const TRADES = {
    "insurance clerk":    { class: "service", office: true, lots: ["office", "bank", "cityhall"], hours: [9, 17], pay: 15 },
    "insurance adjuster": { class: "service", office: true, lots: ["office", "bank", "cityhall"], hours: [8, 18], pay: 22 },
    "underwriter":        { class: "service", office: true, lots: ["office", "bank"], hours: [9, 17], pay: 30 },
    "claims manager":     { class: "service", office: true, lots: ["office", "bank"], hours: [9, 18], pay: 38 },
    "insurance director": { class: "service", office: true, lots: ["office", "bank"], hours: [8, 20], pay: 52 },
  };
  let tradesWired = false;
  function wireTrades() {
    const J = CBZ.cityJobs, K = CBZ.cityJobKinds;
    if (!J || !K) return false;
    for (const k in TRADES) {
      if (J[k]) continue;                    // aigoals owns it — never overwrite
      J[k] = TRADES[k];
      K[k] = TRADES[k].lots || [];
    }
    return true;
  }
  CBZ.cityInsuranceTrades = TRADES;

  /* =========================================================================
     §3  THE BRANCH — chosen, never built.

     contracts.js's binding law applied to a building: the generator picks the
     verb, the WORLD supplies the specifics. We do not place an office. We ask
     officejobs.js which lots already have desks filed in them and take one,
     deterministically (lowest position hash — a MIN over a set, so it does not
     depend on iteration order and two clients agree with no messaging).
     ========================================================================= */
  let branch = null;              // { lot, b, firm, name, desks[], posts[] }
  let arenaRef = null, buildCool = 0;

  function firmOfLot(lot) {
    if (CBZ.cityCompanies && CBZ.cityCompanies.objOfLot) {
      try { return CBZ.cityCompanies.objOfLot(lot) || null; } catch (e) { return null; }
    }
    return (lot && lot._company) || null;
  }
  function addrOf(lot) {
    if (!lot) return "the property";
    if (lot._insAddr) return lot._insAddr;
    let a = null;
    try {
      const L = CBZ.cityZillow && CBZ.cityZillow.listings && CBZ.cityZillow.listings();
      if (L) for (let i = 0; i < L.length; i++) if (L[i].lot === lot) { a = L[i].address; break; }
    } catch (e) { a = null; }
    lot._insAddr = a || ((lot.building && lot.building.name) || "the property");
    return lot._insAddr;
  }
  // WHAT IT IS WORTH is the market's answer, not ours — zillow.js already
  // prices every lot in the city and the whole game reads that number.
  // Memoised on the lot: buyPriceForLot walks the listing table, and this is
  // asked from an interaction LABEL, which the registry re-renders often.
  function marketValue(lot) {
    if (!lot) return 0;
    if (lot._insValue > 0) return lot._insValue;
    let v = 0;
    try {
      if (CBZ.cityZillow && CBZ.cityZillow.buyPriceForLot) v = CBZ.cityZillow.buyPriceForLot(lot) || 0;
    } catch (e) { v = 0; }
    if (!(v > 0)) v = 9000 * ((lot.building && lot.building.storeys) || 2);   // degrade: zillow absent
    lot._insValue = Math.round(v);
    return lot._insValue;
  }

  function pickBranch(arena) {
    const desks = CBZ.cityOfficeDesks;
    if (!desks || !desks.length) return null;
    const lots = [], per = [];
    for (let i = 0; i < desks.length; i++) {
      const l = desks[i].lot;
      if (!l || l.demolished || !l.building || !l.building.door) continue;
      if (arena && arena.lots && arena.lots.indexOf(l) < 0) continue;
      if (desks[i].occupant) continue;
      const k = lots.indexOf(l);
      if (k < 0) { lots.push(l); per.push(1); } else per[k]++;
    }
    let best = null, bestH = 2;
    for (let i = 0; i < lots.length; i++) {
      // A BRANCH WITH FEWER DESKS THAN RUNGS IS A LADDER WITH NOBODY ON IT.
      // Refusing here is what makes insuranceAudit().unstationedRungs a
      // STRUCTURAL zero rather than a lucky one — the stat-fiction ban applied
      // to this ladder before it is ever declared.
      if (per[i] < RUNGS.length) continue;
      const h = hash01(lots[i].cx, lots[i].cz, 0x1a5f);
      if (h < bestH) { bestH = h; best = lots[i]; }
    }
    return best;
  }

  // "Meridian Assurance" — the firm that already owns the tower keeps its own
  // name. A branch with no managing company falls back to the street it is on,
  // so the name is always something the player can actually read on the map.
  function brandFor(lot, firm) {
    if (firm && firm.name) {
      const base = String(firm.name).replace(/\s+(Holdings|Group|Capital|Properties|Realty|Ventures|Partners|Industries|Trust|Development|Estates|& Co\.|Equity|Asset Mgmt|Acquisitions)$/i, "");
      return base + " Assurance";
    }
    const a = addrOf(lot);
    const st = String(a).replace(/^\d+\s+/, "").split(",")[0];
    return (st || "City") + " Mutual";
  }

  /* =========================================================================
     §4  THE DESKS ARE FULL — one cityStaffPost per desk, one npcLife seat each.

     OWNER: "a reason for the desks to be full of workers ... even if they are
     just sitting at the desks."

     Everything expensive about that sentence is already solved:
       · a job is DATA until you are within 120 m (citystaff), so ten desks cost
         nothing until you walk in;
       · the body is an ordinary CBZ.cityPeds member — it dies through the kill
         bus, it is robbable, interactions.js offers the normal verbs on it, and
         gunpointSweep throws its hands up;
       · a SHOT worker stays dead and the desk stays empty, which is the whole
         difference between a consequence and a bug;
       · `alive` is the CLOCK, so the branch is full at 10 a.m. and dark at
         midnight — the workers are somewhere else at night because their post
         simply does not exist then.

     THE ONLY THING THIS FILE DECIDES is WHICH desk holds WHICH rung: highest
     floor first, because a Regional Director is not on the ground floor. A
     DECLARED DESK *IS* ITS RANK — garrison.js's law for a command post, applied
     to an office. It is never a roster draw, so every rung has a holder the
     moment the branch is manned.
     ========================================================================= */
  function officeHours() {
    if (!CBZ.cityHour) return true;
    const h = CBZ.cityHour();
    return h >= 8 && h < 19;
  }

  function seatOn(ped, lot, a) {
    const b = lot && lot.building;
    if (!b || !b.group || !CBZ.npcLife || !CBZ.npcLife.attach) return false;
    // buildings.js's own lift: a ground seat rides the 0.14-top foundation slab,
    // an upper floor its 0.04-top covering. Copied, not re-derived, so a desk
    // worker sits at exactly the height interior_programs.js's own clerks do.
    const sy = a.y || 0;
    const lift = sy < 0.1 ? 0.15 : 0.05;
    ped._seatHold = true;
    return !!CBZ.npcLife.attach(ped, b.group, {
      x: a.x - (b.ox || 0), y: sy + lift, z: a.z - (b.oz || 0),
      yaw: a.face || 0, pose: "sit", state: "sit",
      cushionH: a.cushionH != null ? a.cushionH : 0.48,
      floorBelow: (a.floorBelow || 0) + lift,
    });
  }

  function buildBranch(arena) {
    if (!CBZ.cityStaffVenue || !CBZ.cityStaffPost) return false;
    const lot = pickBranch(arena);
    if (!lot) return false;

    // every desk this lot filed, top floor first (a director is upstairs)
    const desks = [];
    const reg = CBZ.cityOfficeDesks || [];
    for (let i = 0; i < reg.length; i++) if (reg[i].lot === lot && !reg[i].occupant) desks.push(reg[i]);
    if (!desks.length) return false;
    desks.sort(function (p, q) { return (q.y || 0) - (p.y || 0) || p.x - q.x || p.z - q.z; });

    const firm = firmOfLot(lot);
    branch = { lot: lot, b: lot.building, firm: firm, name: brandFor(lot, firm), desks: [], posts: [] };
    // the sign over the door. lot.building is buildings.js's own SPREAD copy, so
    // this names the branch without touching the shared building record.
    try { lot.building.name = branch.name; } catch (e) {}
    declareOrg();

    // Declare the venue with ZERO stations first and set the real count after —
    // venueStaffAudit().unstaffed is PINNED AT 0 and it subtracts declared posts
    // from claimed stations, so promising N and creating N-2 would break
    // somebody else's gate with a number that is not about this file.
    CBZ.cityStaffVenue("insurance", { stations: 0, note: branch.name });

    // pickBranch has already refused any lot with fewer desks than rungs, so
    // every rung is guaranteed a desk and the clamp is only about the ceiling.
    const want = Math.min(Math.max(RUNGS.length, C.INSURANCE_STAFF | 0), desks.length);
    for (let i = 0; i < want; i++) {
      const a = desks[i];
      // rung by desk: the top five desks are the five rungs (director highest),
      // everything below is a clerk.
      const ri = i < RUNGS.length ? (RUNGS.length - 1 - i) : 0;
      const R = RUNGS[ri];
      const key = rankKey(R[0]);
      const grant = R[2][0];
      let post = null;                       // assigned below; release() closes over it
      post = CBZ.cityStaffPost({
        venue: "insurance", id: "insurance:desk:" + i,
        x: a.x, z: a.z, face: a.face || 0,
        job: R[1], archetype: "professional",
        opts: {
          kind: "civilian", armed: false, aggr: 0.1,
          wealth: 0.42 + ri * 0.11, floorY: a.y || 0,
        },
        // A DESK IS A POST THAT DOES NOT FIGHT. The seat owns the transform, so
        // citystaff must NOT pin the body (its own comment: a pin would fight
        // the seat and win). Declaring `attach` is how you say so.
        attach: function (ped) { return seatOn(ped, lot, a); },
        // THE CLOCK IS THE SHIFT. No body exists here at 3 a.m., so nobody has
        // to be walked home and nobody is watched leaving.
        alive: function () {
          return !lot.demolished && officeHours() && C.INSURANCE_DESKS !== false && on();
        },
        after: function (ped) {
          if (!ped) return;
          ped.organization = ORG;
          ped.insRank = key;                 // the ONE place a rung is stored
          ped._insDesk = a;
          ped._insVerb = grant;
          a.occupant = ped;                  // officejobs.js's own "taken" field
          if (ped.char) ped.char.typing = true;   // the idle-work loop
        },
        release: function (ped, why) {
          if (a.occupant === ped) a.occupant = null;
          // SHIFT END / SWEEP / OUT OF RANGE: hand the body straight back.
          // Returning true here would tell citystaff "I have taken this one
          // over" and leave an orphaned worker seated in the tower every dusk,
          // while next morning's post minted a fresh one on top of him.
          if (why !== "dead") return false;
          // KILLING THE OFFICEHOLDER IS THE MECHANIC. The desk stands empty for
          // a minute or two, and if he was the last person who could give that
          // order, the order lapses with him.
          if (post) post._insVacantUntil = now() + vacancy(ped);
          vacate(grant, ped);
          // Out of the chair so the body is an ordinary corpse — morgue.js's EMS
          // can reach it and shoulder-carry it; a rig still parented to the
          // building could never be moved.
          if (CBZ.cityUnseat) { try { CBZ.cityUnseat(ped, { state: "dead", keepPose: true }); } catch (e) {} }
          return true;                        // the corpse stays in the world
        },
        // indoors: a short leash keeps the shared live-body budget for the
        // venue you are actually standing in (interior_programs.js's numbers).
        near: 120, far: 210,
      });
      if (post) {
        post._insGrant = grant; post._insRank = key; post._insVacantUntil = 0;
        branch.posts.push(post); branch.desks.push(a);
      }
    }
    if (CBZ.cityStaffStations) CBZ.cityStaffStations("insurance", branch.posts.length);
    return branch.posts.length > 0;
  }

  /* =========================================================================
     §5  THE BOOK — who is covered, and what it cost them.

     An NPC-owned building's cover is a POSITION HASH, not a stored roster: the
     world is already deterministic per seed, so "is 420 Larkin insured" is a
     question with an answer before anybody asks it, on every client, with no
     bookkeeping. A player policy is the only one that has to be written down,
     because it is the only one somebody paid for.
     ========================================================================= */
  const policies = new Map();     // lot -> { lot, holder, value, at }

  function onBook(lot) {
    if (!lot || !lot.building || lot.kind === "park") return false;
    if (branch && lot === branch.lot) return false;      // nobody insures their own branch
    // NO PAYEE, NO POLICY. A settlement has to land in a balance somebody keeps,
    // and companies.js's firm record is the only one an ordinary city building
    // has. An owner-occupied shack with no company behind it is simply not on
    // this insurer's book — which is also why the payout below can never credit
    // `null` and quietly delete money from the world.
    // AND NOT ITS OWN PORTFOLIO. companies.js hands a firm many lots; writing
    // cover on one of them would make a settlement a transfer from a balance to
    // ITSELF — a real number in takeAudit that moved nothing, which is exactly
    // the kind of fiction take.js exists to stop.
    const own = firmOfLot(lot);
    if (!own || (branch && own === (firmOfLot(branch.lot) || branch.firm))) return false;
    return hash01(lot.cx, lot.cz, 0x8007) < (+C.INSURANCE_BOOK_SHARE || 0);
  }
  function policyOf(lot) {
    const p = policies.get(lot);
    if (p) return p;
    if (!onBook(lot)) return null;
    // an NPC policy is DERIVED, so it needs no record until it is claimed on
    return { lot: lot, holder: firmOfLot(lot), value: marketValue(lot), at: 0, derived: true };
  }
  CBZ.cityPolicyOf = policyOf;

  // A real property premium is a fraction of a percent of value per YEAR. This
  // game's day is 150 s and a policy here is a ONE-OFF that runs until it pays,
  // so the rate is set where the trade is honest and not free: 4% of what the
  // market says the building is worth, floored so a shack still costs something.
  function premiumFor(lot) {
    const v = marketValue(lot);
    return Math.max(250, Math.round(v * 0.04));
  }
  CBZ.cityInsurePremium = premiumFor;
  // The UNDERWRITER's ceiling. Below it a clerk can bind cover on his own;
  // above it somebody senior has to sign, which is the whole verb.
  const SMALL_POLICY = 120000;

  // Player buys cover. ONE transfer, through take.js — the dollars leave your
  // pocket and land in the firm's till, which is the same balance the payout
  // later comes out of. No 53rd transaction.
  CBZ.cityInsure = function (lot, opts) {
    opts = opts || {};
    if (!on() || !lot || !branch) return { ok: false, why: "No insurer is writing here." };
    if (lot.demolished) return { ok: false, why: "There is nothing standing to cover." };
    if (policies.has(lot)) return { ok: false, why: "That address is already covered." };
    if (!officeCan("quote")) return { ok: false, why: "There is nobody at the counter to write it." };
    const value = marketValue(lot);
    if (value >= SMALL_POLICY && !officeCan("bind")) {
      return { ok: false, why: "Nobody here can bind a policy that size — the underwriter's desk is empty." };
    }
    const price = premiumFor(lot);
    // THE PREMIUM HAS TO LAND SOMEWHERE. With no firm behind the branch there is
    // no till to credit, and take.js would happily debit you into a hole in the
    // world — so the counter simply does not trade.
    const till = firmOfLot(branch.lot) || branch.firm || null;
    if (!till) return { ok: false, why: "The branch has no underwriter behind it." };
    if (!opts.dryRun) {
      if (!CBZ.cityTake || !CBZ.cityHolds) return { ok: false, why: "The till is closed." };
      const have = CBZ.cityHolds("player", { bank: true });
      if (!have || have.amount < price) return { ok: false, why: "The premium is " + money(price) + " — you are short." };
      const res = CBZ.cityTake("player", {
        max: price, bank: true, to: till,
        site: "insurance:premium", reason: "premium",
      });
      // A PARTIAL PAYMENT IS NOT A POLICY. take.js hands back an exact inverse
      // for exactly this: if the pocket could not cover it, put it back.
      if (res.taken < price) { try { res.refund && res.refund(); } catch (e) {} return { ok: false, why: "The premium is " + money(price) + " — you are short." }; }
    }
    if (opts.dryRun) return { ok: true, price: price, value: value };
    policies.set(lot, { lot: lot, holder: "player", value: value, at: now() });
    return { ok: true, price: price, value: value };
  };

  /* =========================================================================
     §6  THE LOSS — a building comes down, and somebody has to answer for it.

     structural.js already fires onCollapse({lot, by, byPlayer, storeys}) and
     already hands the lot to demolition.js, which already rebuilds it on the
     in-game calendar. So "businesses don't go away" was TRUE before this file
     and nothing here re-implements it. What was missing is the counterparty.
     ========================================================================= */
  const claims = [];              // { lot, addr, holder, amount, byPlayer, state, mission }
  let tapped = false;

  function wireCollapseTap() {
    if (tapped) return;
    const S = CBZ.structure;
    if (!S) return;
    tapped = true;
    // CHAIN, never clobber — strategic.js owns this slot too and its bomb-run
    // scorer would silently stop counting.
    const prev = typeof S.onCollapse === "function" ? S.onCollapse : null;
    const tap = function (ev) {
      try { onLoss(ev); } catch (e) {}
      if (prev) { try { prev(ev); } catch (e) {} }
    };
    tap._insTap = true;
    S.onCollapse = tap;
  }

  function reserve() {
    const co = (branch && (firmOfLot(branch.lot) || branch.firm)) || null;
    return co ? Math.max(0, Math.round(co.cash || 0)) : 0;
  }

  function onLoss(ev) {
    if (!on() || C.INSURANCE_CLAIMS === false) return;
    const lot = ev && ev.lot;
    if (!lot || !branch) return;
    const pol = policyOf(lot);
    if (!pol) return;
    // A LOSS IS NOT A CLAIM UNTIL SOMEBODY INSPECTS IT. That is the Adjuster's
    // whole rung, and with his desk empty the file simply never opens.
    if (!officeCan("assess")) {
      if (pol.holder === "player") note("No adjuster available — your claim on " + addrOf(lot) + " cannot be opened.", 3);
      return;
    }
    const cl = {
      lot: lot, addr: addrOf(lot), holder: pol.holder,
      amount: Math.max(0, Math.round(pol.value || marketValue(lot))),
      byPlayer: !!ev.byPlayer, state: "open", at: now(), mission: null,
    };
    claims.push(cl);
    policies.delete(lot);
    stepClaim(cl);
  }

  // Advance one claim as far as the office currently allows. Re-run on a slow
  // tick, so killing the Director genuinely re-opens a denied file.
  function stepClaim(cl) {
    if (!branch || cl.state === "paid" || cl.state === "void") return;
    // THE FRAUD POSTURE. Somebody holds the pen that refuses you, and while he
    // is at his desk he refuses you. cityLock's doctrine: a refusal must NAME
    // THE CHEAPEST ROUTE IN, so the line says where the pen is.
    //
    // ONCE SIGNED OFF, IT STAYS SIGNED OFF. The refusal lapses while the chair
    // is empty; if you got it approved in that window, the next director does
    // not get to tear the cheque up — you already paid for the window.
    if (cl.state !== "approved" && cl.byPlayer && cl.holder === "player" && officeCan("deny")) {
      if (cl.state !== "denied") {
        cl.state = "denied";
        note(branch.name + " is disputing " + cl.addr + ". The regional director signed the refusal.", 3.6);
      }
      return;
    }
    if (!officeCan("settle")) {
      if (cl.state !== "held") {
        cl.state = "held";
        if (cl.holder === "player") note("Nobody at " + branch.name + " can authorise the cheque right now.", 3);
      }
      return;
    }
    if (cl.holder === "player") {
      // COLLECT IT IN PERSON. One mission.start buys the waypoint, the world
      // beacon, the HUD distance line and the phone card. The money is NOT the
      // mission reward — a minted reward would break take.js's law — it moves
      // out of the firm's till in onComplete.
      if (cl.state === "approved" && cl.mission && cl.mission.alive && cl.mission.alive()) return;
      cl.state = "approved";
      const d = branch.lot.building && branch.lot.building.door;
      if (!d) { payClaim(cl); return; }
      // SAY WHAT THEY CAN ACTUALLY PAY. The claim is for what the building was
      // worth; the cheque is for what is left in the reserve, and a player who
      // has been draining this insurer (or watching somebody else level half the
      // district) should be able to SEE that gap rather than discover it at the
      // counter. A gradient you cannot read is not a gradient.
      const able = reserve();
      note(branch.name + " approved " + cl.addr + " — " + money(cl.amount) + " waiting at the branch."
        + (able < cl.amount ? " Their reserve only covers " + money(able) + "." : ""), 3.8);
      if (CBZ.mission && CBZ.mission.start && CBZ.CONFIG.MISSION_BLOCK !== false) {
        cl.mission = CBZ.mission.start({
          id: "insurance-claim-" + Math.round(cl.lot.cx) + "-" + Math.round(cl.lot.cz),
          title: "Collect on " + cl.addr,
          brief: branch.name + " has approved the claim. Sign for it at the branch counter.",
          goal: "reach", at: { x: d.x, z: d.z }, radius: 6,
          reward: 0, color: 0x3f9c8a,
          onComplete: function () { payClaim(cl); },
        });
      } else payClaim(cl);
      return;
    }
    payClaim(cl);
  }

  /* THE SETTLEMENT IS A TRANSFER, NOT A ROLL.

     cityTake debits the firm's own till and credits the claimant. `max` is a
     fact about the claim, never a lid on the world, so it does not count
     against takeAudit().cappedTakes; and the insurer is measurably poorer
     afterwards — drain it and it cannot pay ANYBODY, including you. That is the
     only ceiling this feature has and it is not a constant. */
  function payClaim(cl) {
    if (cl.state === "paid") return;
    const co = (branch && (firmOfLot(branch.lot) || branch.firm)) || null;
    if (!co || !CBZ.cityTake) { cl.state = "void"; return; }
    const dest = (cl.holder === "player") ? "player" : (cl.holder || null);
    // NO PAYEE (the firm went bankrupt under us) and NO SELF-DEALING (the
    // insurer bought the address after writing it) — either way there is no
    // transfer to make, and debiting a till into `null` would delete money from
    // the world, which is the exact failure take.js exists to prevent.
    if (!dest || dest === co) { cl.state = "void"; return; }
    const res = CBZ.cityTake(co, {
      max: cl.amount, to: dest, site: "insurance:claim", reason: "settlement",
    });
    cl.paid = res.taken | 0;
    cl.state = "paid";
    paidTotal += cl.paid;
    if (cl.mission && cl.mission.alive && cl.mission.alive()) { try { cl.mission.retire("settled"); } catch (e) {} }
    if (cl.holder === "player") {
      if (cl.paid <= 0) note(branch.name + " has nothing left in the reserve. The claim is worthless.", 3.4);
      else note("Settled — " + money(cl.paid) + " on " + cl.addr + ".", 3);
    } else if (cl.paid > 0) {
      // the ONE line that makes a player DISCOVER this system exists.
      flavor(branch.name + " settles " + money(cl.paid) + " on " + cl.addr, "#8fd0c2");
    }
  }
  let paidTotal = 0;

  /* =========================================================================
     §7  THE COUNTER — one hook, consumed by five rows in roleverbs.js.

     No card, no key, no popup, no touch control. roleverbs.js already turns a
     row into a keyboard line AND a tappable pill on both inputs.
     ========================================================================= */
  // WHAT THE PLAYER OWNS, cached. cityOwnsLot is a linear find over the listing
  // table, so asking it once per arena lot is quadratic — and this is reached
  // from an interaction canShow/label, which run at scan rate. The deed list
  // changes when you buy a building, which is not a per-frame event.
  let deeds = [], deedT = 0;
  function ownedLots() {
    const t = now();
    if (t - deedT < 5000 && deeds.length) return deeds;
    deedT = t;
    deeds = [];
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !CBZ.cityOwnsLot) return deeds;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l.building) continue;
      if (CBZ.cityOwnsLot(l)) deeds.push(l);
    }
    return deeds;
  }
  function playerLotNear() {
    // the address the player would actually be thinking about: one he owns,
    // nearest to him, still standing, not already covered.
    const list = ownedLots();
    if (!list.length) return null;
    const P = CBZ.player && CBZ.player.pos;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      if (l.demolished || policies.has(l)) continue;
      const d = P ? (l.cx - P.x) * (l.cx - P.x) + (l.cz - P.z) * (l.cz - P.z) : 0;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  function myClaim(state) {
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i];
      if (c.holder === "player" && c.state === state) return c;
    }
    return null;
  }
  function isInsuranceWorker(p) {
    return !!(p && !p.dead && (p.organization === ORG || (p.insRank && TRADES[p.job])));
  }

  // Returns {label, run} or null. roleverbs.js's ROW_INSURANCE delegates here,
  // so adding an insurance trade stays a ROW in that file and the behaviour
  // stays in the file that owns it.
  CBZ.insuranceVerb = function (p) {
    if (!on() || !branch || !isInsuranceWorker(p)) return null;
    // 1. money you are owed beats everything else this person could say.
    const approved = myClaim("approved");
    if (approved && CBZ.rankCan && CBZ.rankCan(p, ORG, "settle")) {
      return {
        label: "Sign for " + money(approved.amount),
        run: function () { say(p, "“Sign here. Sorry for the trouble.”"); payClaim(approved); },
      };
    }
    const denied = myClaim("denied");
    if (denied) {
      return {
        label: "Ask about the disputed claim",
        run: function () {
          say(p, officeCan("deny")
            ? "“The regional director signed that refusal himself. Top floor. Nothing I can do.”"
            : "“That desk is empty. Come back — it may go through.”");
          note(denied.addr + " — " + money(denied.amount) + " disputed by " + branch.name + ".", 3.2);
        },
      };
    }
    // 2. the counter sale, and it is gated on the rung that sells.
    if (CBZ.rankCan && CBZ.rankCan(p, ORG, "quote")) {
      const lot = playerLotNear();
      if (lot) {
        const q = CBZ.cityInsure(lot, { dryRun: true });
        if (q.ok) {
          return {
            label: "Insure " + addrOf(lot) + " " + money(q.price),
            run: function () {
              const r = CBZ.cityInsure(lot);
              if (!r.ok) { note(r.why, 3); say(p, "“" + r.why + "”"); return; }
              if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
              say(p, "“Covered to " + money(r.value) + ". Try not to need it.”");
              note("Cover written on " + addrOf(lot) + " — " + money(r.value) + " for " + money(r.price) + ".", 3.4);
            },
          };
        }
        return { label: "Ask about cover on " + addrOf(lot), run: function () { say(p, "“" + q.why + "”"); note(q.why, 3); } };
      }
    }
    // 3. the floor. A working person always has something honest to say, and
    //    what this one knows is what the branch is holding.
    return {
      label: "Ask about the book",
      run: function () {
        if (CBZ.cityMeet) { try { CBZ.cityMeet(p); } catch (e) {} }
        const r = reserve();
        say(p, r > 0 ? "“We are good for about " + money(r) + " if the roof comes in.”"
                     : "“Reserve is empty. We could not pay out a window right now.”");
      },
    };
  };

  /* =========================================================================
     §8  THE TICK — build the branch lazily, then keep the claims honest.
     41.95: after citystaff (41.86) and officejobs (41.9), so a desk we hand to
     a seat this frame is already being held by the time we look again.
     ========================================================================= */
  let acc = 0;
  CBZ.onUpdate(41.95, function (dt) {
    if (!inCity() || !on()) return;
    if (!tradesWired) tradesWired = wireTrades();
    wireCollapseTap();
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !arena.lots) return;
    if (arena !== arenaRef) {
      buildCool -= dt || 0;
      if (buildCool > 0) return;
      buildCool = 1.0;
      // a new city: drop the old book, keep nothing that points at a dead lot.
      // The org is re-declared so its NAME follows the new branch (declare()
      // replaces the definition in place — it never stacks a second one).
      branch = null; policies.clear(); claims.length = 0; orgDeclared = false;
      deeds = []; deedT = 0;
      chair.quote = chair.assess = chair.bind = chair.settle = chair.deny = 0;
      let ok = false;
      try { ok = buildBranch(arena); } catch (e) { ok = false; }
      if (ok) arenaRef = arena;
      return;
    }
    acc += dt || 0;
    if (acc < 1.1) return;                    // claims move at a paperwork pace
    acc = 0;
    if (branch && branch.lot && branch.lot.demolished) return;   // the branch itself is a hole
    const t = now();
    // HEAD OFFICE SENDS SOMEBODY NEW. citystaff marks a post whose holder was
    // KILLED as permanently lost — right for a croupier at one felt table, wrong
    // for a company with a payroll, and it would bleed this branch empty over a
    // long session while the chair model still claimed the orders were being
    // given. The desk stays genuinely vacant for the whole 60-150 s window (so
    // the murder is never a no-op and the lapsed order is real), then re-arms.
    if (branch) for (let i = 0; i < branch.posts.length; i++) {
      const p = branch.posts[i];
      if (p.lost && t >= (p._insVacantUntil || 0)) { p.lost = false; p.fails = 0; }
    }
    for (let i = claims.length - 1; i >= 0; i--) {
      const c = claims[i];
      // a settled file is archived, not held forever — the list is what
      // insuranceVerb scans every time you walk up to a clerk.
      if (c.state === "paid" || c.state === "void") {
        if (t - (c.at || 0) > 300000) claims.splice(i, 1);
        continue;
      }
      stepClaim(c);
    }
    // hygiene: a policy whose lot lost its building record entirely (a mode
    // change tore the arena down under us) can never be claimed on. A policy
    // that PAID is already gone — onLoss deletes it the moment the file opens,
    // which is what makes a rebuilt address re-insurable at full price.
    policies.forEach(function (pol, lot) { if (!lot || !lot.building) policies.delete(lot); });
  });

  /* =========================================================================
     §9  CBZ.insuranceAudit() — THE RATCHET (CLAUDE.md BLOCK LAW #5).

       verblessRungs   a declared rung that opens nothing. PIN 0 — it is the
                       vanity-XP-bar ban applied to this ladder, and it is a
                       property of the code, not of play.
       mintedPayouts   a settlement that did not come out of a balance. PIN 0.
                       Counted by comparing what we asked take.js to move
                       against what the firm's till actually lost.
       unstationedRungs a rung with no DESK to hold it — the stat-fiction ban:
                       a rank nobody can ever be found holding. PIN 0, and it is
                       structural: pickBranch refuses any office with fewer free
                       desks than the ladder has rungs. Counted only when a
                       branch exists, because with no branch there is no claim
                       being made; `branch`/`desks`/`posts` are printed beside it
                       so "there is no office" can never hide behind a zero.
       untradedJobs    a rung whose job string is not in the ONE job table
                       (no workplace, no shift, no wage). PIN 0.
       Everything else is printed BESIDE them so a "fix" that simply stops
       writing cover cannot pass.
     ========================================================================= */
  CBZ.insuranceAudit = function () {
    const out = {
      enabled: on(), branch: branch ? branch.name : null,
      desks: branch ? branch.desks.length : 0,
      posts: branch ? branch.posts.length : 0,
      manned: 0, rungs: RUNGS.length, trades: 0,
      verblessRungs: 0, unstationedRungs: 0, untradedJobs: 0, mintedPayouts: 0,
      onBook: 0, playerPolicies: policies.size,
      claims: claims.length, paid: 0, denied: 0, held: 0, open: 0,
      settled: paidTotal, reserve: reserve(),
      chairsEmpty: [], orgDeclared: orgDeclared, tapped: tapped,
      openHours: officeHours(),
    };
    for (let i = 0; i < RUNGS.length; i++) {
      if (!RUNGS[i][2] || !RUNGS[i][2].length) out.verblessRungs++;
      if (!(CBZ.cityJobs && CBZ.cityJobs[RUNGS[i][1]])) out.untradedJobs++;
      else out.trades++;
      // is there a DESK declared that stamps this rung? (not "is a body live" —
      // that is rankAudit's question and it moves when you walk away)
      let stationed = !branch;                 // no branch => no claim to check
      const key = rankKey(RUNGS[i][0]);
      if (branch) for (let q = 0; q < branch.posts.length; q++) {
        const p = branch.posts[q];
        if (p && p.job === RUNGS[i][1]) { stationed = true; break; }
      }
      if (!stationed) out.unstationedRungs++;
      if (key && chair[RUNGS[i][2][0]] > now()) out.chairsEmpty.push(key);
    }
    if (branch) for (let i = 0; i < branch.posts.length; i++) {
      const p = branch.posts[i];
      if (p && p.ped && !p.ped.dead) out.manned++;
    }
    for (let i = 0; i < claims.length; i++) {
      const c = claims[i];
      if (c.state === "paid") { out.paid++; if (c.paid > 0 && c.paid > c.amount) out.mintedPayouts++; }
      else if (c.state === "denied") out.denied++;
      else if (c.state === "held") out.held++;
      else out.open++;
    }
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.lots) for (let i = 0; i < A.lots.length; i++) if (onBook(A.lots[i])) out.onBook++;
    return out;
  };

  // read-only surfaces for anything that wants to show the state of the office
  CBZ.cityInsurer = function () {
    if (!branch) return null;
    return { name: branch.name, lot: branch.lot, door: branch.lot.building && branch.lot.building.door,
             reserve: reserve(), open: officeHours(),
             can: { quote: officeCan("quote"), assess: officeCan("assess"), bind: officeCan("bind"),
                    settle: officeCan("settle"), deny: officeCan("deny") } };
  };
  CBZ.cityInsuranceClaims = function () {
    return claims.map(function (c) { return { addr: c.addr, amount: c.amount, state: c.state, holder: c.holder === "player" ? "player" : (c.holder && c.holder.name) || "firm" }; });
  };
})();
