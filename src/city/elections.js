/* ============================================================
   city/elections.js — Stage P, step P4: THE 7-DAY MAYORAL CYCLE
   (+ governor/president generalizations) — REPLACES officials.js's
   silent term-auto-extend/caretaker-heal stubs with real elections.

   MASTER-PLAN V.2 (verbatim, the parts this file ships):
   "The clock: Mayor elections every 7 days (~17 real minutes), governor 14,
   president 28, staggered." / "Voter blocs computed from real data, per
   district: population share from ledger home anchors; wealth axis from
   Zillow district values; worker axis from the ledger job census; gang
   intimidation — districts inside hostile turf get turnout ×0.6 and shift
   20% of votes to the gang's pick (the player's pick, if it's the player's
   gang). Candidate score = 40 + 0.5·approval(incumbent) + 12·charisma +
   platform·bloc·15 + momentum + fraud." / "Player levers: rally attendance/
   disruption, donations, attack ads, ballot-office heists (fraud +10,
   discovery risk scandal +25), intimidation canvassing, and running for
   office as endgame."

   THIS WAVE'S NARROWING (P5/P6/P8/X-stage own the rest — flagged inline):
   - Exactly ONE challenger per race (2 candidates total, always), typed
     'machine' (gang-backed) if a real gang holds >=2 turf zones, else
     'reformer' — this is what makes the literal "Poll: A 52 - B 48"
     two-name format in the task brief exact, not an approximation for an
     N-candidate field. A snap election (no sitting officeholder) mints TWO
     open challengers instead of incumbent+1 (one machine-typed if a
     qualifying gang exists, else two reformers) — still exactly 2.
   - fraud is a wired-but-zero term this wave (regimes.js/P6 rigs it
     +25 under fascism; ballot-office heists +10 are a documented future
     player lever, V.2 above) — the formula already has the slot, nobody
     writes to it yet.
   - Donations/attack-ads/ballot heists/intimidation canvassing/running for
     office (V.2's player-lever list) are NOT this wave — the equation and
     the clock are real; the player's only live lever into it this wave is
     the EXISTING Campaign Event activity (already wired to
     w.politics.support since P3), which now actually moves a live election
     instead of a smoothed-away approval nudge.

   GOV WAVE — THE SOCKET IS PLUGGED (the bullet above is now historical).
   Everything this file wrote for a player candidate — the {player:true}
   record, the respect-read charisma, the race.pledged branch in
   callElection(), the "YOU ARE ON THE BALLOT" headline — was finished code
   with NO PRODUCER: nothing in the repo ever set race.pledged, and
   playerCandidateRecord() read `g.cityCampaign`, which is the STORY campaign
   (city/campaign.js), not a political run. city/candidacy.js is the producer
   and owns `g.cityRun`. This file gained exactly four public functions
   (playerCandidacy / playerRace / openRaces / pledge), one snapshot refresh
   (refreshPlayerCandidate — a candidate record is frozen at callElection, so
   without it every rally, endorsement and bribe earned DURING the campaign
   window was worth nothing), and one BUG FIX: w.politics.support was handed
   unconditionally to the incumbent, so a player challenger's own paid
   Campaign Events bought momentum for their opponent. It follows the
   player's record now whenever the player is in the field.

   - Governor (14d)/president (28d) races run through the EXACT SAME
     tickOffice/tally/resolve machinery as the mayor — MASTER-PLAN's own
     "the queries ARE the simulation's smart parts" spirit: one generic
     bloc-builder branches on jurisdiction KIND (city vs state/country), not
     one code path per office. State/country blocs are one bloc PER CHILD
     jurisdiction (a governor's electorate is its cities; the president's is
     its states), "approval-weighted" per V.2 — see STATE/COUNTRY BLOCS
     below for exactly what that means this wave (no real per-city
     population/ideology data exists outside libertyville yet — same
     NARROWING approval.js's own STATE/COUNTRY BLEND already accepted).

   ============================================================
   THE DISTRICT-BLOC ↔ TURF JOIN (the task's own flagged gotcha: economy.js's
   DISTRICTS keys and turf.js's ZONE_NAMES are TWO DIFFERENT PARTITIONS of
   the same map — DISTRICTS is a 4-quadrant-plus-island scheme (economy.js's
   own districtAt(): NE=uptown, SW=projects, NW=downtown, SE=waterfront,
   annex=island), ZONES is turf.js's independent 3×3 super-grid over the lot
   i/j indices (9 named neighbourhoods, Northpoint..Dockyard) that the GANG
   TAKEOVER meta actually fights over. Nobody translates one into the other
   anywhere in the codebase today.

   economy.js ALREADY SOLVED THIS EXACT PROBLEM for its own turf-tax/margin
   code (districtAnchor(dk) → a representative (x,z) point per district →
   CBZ.cityZoneOwner(x,z) asks turf.js "whose zone is closest to this
   point") — see economy.js:521-552 (districtAnchor/turfStanding). That
   function is NOT exported on CBZ.cityEcon (only the player-relative
   turfStanding/turfSellMult/turfBuyMult/turfRiskMult built ON TOP of it
   are), so this file keeps its OWN COPY of the anchor formula — the exact
   same "duplicate the small joining fact, note the precedent" move
   sim/npcecon.js already made for economy.js's DISTRICTS tiers
   (TIER_FALLBACK) and city/officials.js made for billionaires.js's
   mintIdentity(). If economy.js's anchor formula (center + ±70 per
   quadrant, annex centre for the island) ever moves, this file's copy goes
   stale the same documented way those two precedents already accepted.

   zoneOwnerFor(dk) = CBZ.cityZoneOwner(districtAnchor(dk)) → the gang id
   (or "player", or null) whose turf.js ZONE is nearest that anchor point —
   turf.js's own recomputeZones()/z.owner (turf.js:92-129) is the ground
   truth this reads, not a second copy of gang turf logic. A bloc counts as
   "gang-intimidated" iff that comes back non-null — deliberately ANY
   owner, not "hostile to the player": these are NPC voters being leaned on
   by whoever runs their block, not a player-relationship check (the
   player's OWN gang holding a district still intimidates that district's
   voters toward "the gang's pick" exactly per V.2's own phrasing — a
   player-run political machine is the V.2 endgame lever, not this wave's).

   THE MACHINE CANDIDATE: machineGangId() reads turf.js's own
   CBZ.cityZoneControl().byGang tally (zone COUNT per gang, the same
   "holds 2+ zones" test the task brief names) and picks whichever non-
   "player" gang holds the most zones, if any hold >= 2 — one machine
   candidate per race backed by whichever crew is winning the OTHER game
   this wave (turf takeover) feeds into this one (elections). A player-run
   machine is explicitly excluded this wave (see NARROWING above).
   ============================================================

   SCORING (verbatim formula, see header quote): per candidate PER BLOC —
     score = 40 + 0.5·approval [incumbent only] + 12·charisma
             + platformDot(candidate, bloc)·15 + momentum + fraud(0)
   platformDot = -platform.tax·bloc.taxPref + platform.police·bloc.policePref
     taxPref ∈ [-1,1]: clamp((wealthShare−0.5)·2, −1, 1), wealthShare = this
       bloc's (comf+rich) population share — sim/npcecon.js's OWN 20-row
       cohort table (CBZ.npcEcon.summary(), the exact "5 districts × 4
       income classes" VI.4 table), read through its PUBLIC summary()
       accessor (never reaches into g.npcEcon.rows directly) — "rich
       districts prefer tax<0" falls out because platform.tax is −1..1
       (−1 = a promised cut) and the sign flip makes a rich bloc (taxPref
       near +1) score a cutting candidate (platform.tax=−1) positively.
     policePref = 1 if the bloc is gang-intimidated (see JOIN above) else 0
       — "high-crime districts... prefer police>0", using turf ownership as
       the (simpler, already-wired) crime proxy the task brief itself
       offers as the fallback over a dedicated per-district murder count.
   Turnout weight = bloc.pop · bloc.turnout, where bloc.turnout is a fixed
   BASE_TURNOUT (0.55, a flavor constant — no real voter-registration model
   exists) HALVED-ISH (×INTIMIDATION_TURNOUT_MULT = 0.6) for intimidated
   blocs — the literal "turnout ×0.6" the task brief names.
   Vote SHARES per bloc are the normalized (score, floored at 1 so a
   catastrophic negative score can't flip a share negative) weights; an
   intimidated bloc with a machine candidate running then reassigns 20% of
   its total share flat to the machine (shareAdj = share·0.8, machine gets
   +0.20 on top) — the literal "+20% of their vote to the machine
   candidate" — before multiplying by the (already-reduced) turnout weight.
   Winner = the candidate with the most SUMMED weighted votes across every
   bloc (MASTER-PLAN's own "SUM(votes) GROUP BY candidate, district" spirit,
   done in JS over ≤5 blocs instead of SQL — same math, no server yet).

   STATE/COUNTRY BLOCS: one bloc PER CHILD jurisdiction (a governor's
   electorate = its cities, the president's = its states) — pop is a flat
   nominal 100 per child (no real cross-city population split exists
   outside libertyville — approval.js's own STATE/COUNTRY BLEND accepted
   the identical gap), taxPref/policePref are neutral 0 (no per-mini-city
   ideological data — same NARROWING), and turnout is
   BASE_TURNOUT·(childApproval/100) — THIS is V.2's "approval-weighted":
   a child jurisdiction riding high approval turns out harder for its own
   governor/president race than one sliding into unrest.

   CAMPAIGN (2 days, both the 7-day mayoral cycle's termDay−2 lead-in AND a
   snap election's own 2-day window use the exact same campaignDay()):
   one random candidate gets a small momentum rally (feed line, flavored
   with a real bloc name so campaign chatter reads like it's happening
   somewhere); the INCUMBENT (if any — a snap election has none, see
   NARROWING) credits momentum at +w.politics.support·0.2 — "the existing
   campaign activity finally matters" a second time (approval.js's own
   header used that exact line for the propaganda term; this is its NEXT
   consumer, a REAL election rather than a smoothed approval nudge); and a
   POLL feed line runs the SAME tally() the real result will eventually use
   (so a poll ACTUALLY tracks the race, not a cosmetic RNG number),
   ±4-point noise added for realism, clamped 1..99 (exactly 2 candidates
   this wave, so "A / 100−A" is always well-formed).

   ELECTION DAY (day >= race.electionDay): tally() runs for real, the
   highest-vote candidate wins. A losing sitting incumbent doesn't vanish —
   NPC death is permanent (schedule.js dropSid), but LOSING an election is
   not death: their ledger entry's `job` field reverts to a generic
   "politician" (an ex-officeholder, not a nobody — CBZ.cityLedgerEntry(sid)
   is schedule.js's own W9-era read/write accessor, no new ledger mutation
   path invented here) and they get a concession feed line. The winner's
   `job` field is stamped to the office's title (officials.js's own JOBS
   map, mirrored locally — see CONSTANTS below) whether they were already
   the incumbent or not. approvalShock(+4) on an incumbent's re-election,
   0 on a change of power (V.2's own ternary, wired even though 0 is a
   no-op — a future war/regime shock stacking on TOP of an election outcome
   reads correctly either way). w.politics.support is halved, not zeroed —
   "spent", the same wording the task brief uses; the NEXT cycle's polling/
   momentum starts from wherever that lands, not from a hard reset.

   SNAP ELECTIONS: officials.js's own assassination-succession path
   (P2, unedited by this file beyond the ONE coordination guard below)
   already stamps `rec.vacuum = worldDay` on a no-deputy vacancy. This
   file's tickOffice() sees that flag BEFORE checking the normal termDay−2
   trigger, clears it immediately (the snap election IS the resolution
   path now — officials.js's own CARETAKER_DAYS auto-appoint never gets a
   chance to fire once this file exists, see COORDINATION below) and calls
   an election with a 2-day campaign window (calledDay + 2, not
   office.termDay — the normal cycle's termDay is irrelevant to an
   assassination-triggered snap race).

   COORDINATION WITH officials.js (the task's own "make officials.js check
   `if (CBZ.elections) return;`" 2-line edit): officials.js's OWN onNewDay
   subscriber (P2, its header literally says "P4 replaces this with a real
   election"/"P4 replaces this with snap elections") still runs every day —
   it just early-returns the instant this file has installed CBZ.elections,
   deferring BOTH its silent termDay auto-extend AND its 2-day caretaker-heal
   entirely to this file's tickOffice(). Load order does not matter: the
   guard is checked INSIDE the onNewDay callback (at CALL time, i.e. the
   next in-game day boundary), never at registration time, so it is correct
   regardless of which of these two files' <script> tags parses first.

   THE POLITICS PANEL TIE (approval.js's Shift+P panel, small edit there):
   CBZ.elections.status(jurisId) returns null when no race is active, else
   {daysLeft, candidates:[{name,type,charisma,momentum,platform}],
   lastPoll}. approval.js's jurisdictionCard() renders one extra mini-card
   when status() is non-null — this file owns the DATA, approval.js owns
   the ONE render call (exactly the split officials.js's identityOf() /
   approval.js's holderNameOf() already established for officeholder
   names — no duplicate UI logic invented here).

   SERIALIZATION: own g.elections.races map, keyed by jurisdiction id, ONLY
   entries with phase === "campaign" persisted (an idle race carries
   nothing worth a save slot — the exact "don't persist ephemeral zero
   state" call polity.js/approval.js's own history rings already make).
   blob.elc beside blob.pol/blob.off/blob.apr, own guard flag _elcWrap
   (approval.js's own save-wrap pattern, verbatim), order 46.11 — the next
   free slot after approval.js's 46.09 (see repo-wide onUpdate(46.x) audit
   in this file's commit).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state);
  // a stream distinct from officials.js's (240685133) and turf.js's (0x51ed7).
  let _seed = 771030517 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  // ---- office roster — X3 generalized this off the original hardcoded 5-id
  // list to EVERY city/state/country/federal polity record (MIRRORS
  // officials.js's own KIND-based helpers exactly — that file does not
  // export termDaysFor/titleFor/jobFor — same duplication call the header's
  // JOIN section documents for economy.js's districtAnchor). Term length by
  // KIND (V.2: mayor 7d / governor 14d / president 28d; federal reuses the
  // state-tier 14d). Title/job by KIND (+ tier for "village" chiefs) — no
  // per-id map, so a new country's mayors/governors/president need zero
  // edits here. ---------------------------------------------------------
  const KIND_TERM_DAYS = { city: 7, state: 14, federal: 14, country: 28 };
  function termDaysFor(rec) { return (rec && KIND_TERM_DAYS[rec.kind]) || 7; }
  function titleFor(rec) {
    if (!rec) return "Official";
    if (rec.kind === "country") return "President";   // monarchy never reaches here — govType guard below skips it
    if (rec.kind === "state" || rec.kind === "federal") return "Governor";
    if (rec.kind === "city") return rec.tier === "village" ? "Chief" : "Mayor";
    return "Official";
  }
  function jobFor(rec) { return titleFor(rec).toLowerCase(); }
  // every office id currently on the polity roster — recomputed per onNewDay
  // tick (cheap, ≤~30 records) rather than cached, so a country registered
  // after boot is picked up the very next day with zero extra wiring.
  function allOfficeIds() {
    if (!CBZ.polity) return [];
    return [].concat(
      CBZ.polity.list("city"), CBZ.polity.list("state"),
      CBZ.polity.list("country"), CBZ.polity.list("federal")
    ).map(function (r) { return r.id; });
  }

  const CAMPAIGN_DAYS = 2;                    // V.2: the lead-in window, both cycle and snap
  const BASE_TURNOUT = 0.55;                  // flavor constant — no voter-registration model exists
  const INTIMIDATION_TURNOUT_MULT = 0.6;      // V.2 verbatim: "turnout ×0.6"
  const INTIMIDATION_MACHINE_SHIFT = 0.20;    // V.2 verbatim: "+20% of their vote to the gang's pick"
  const DISTRICT_KEYS_FALLBACK = ["downtown", "projects", "waterfront", "uptown", "island"]; // if CBZ.npcEcon isn't up yet

  // ============================================================
  //  IDENTITY MINTING — officials.js's own mintIdentity()/mintName() shape,
  //  reused verbatim (that file doesn't export either, same as billionaires.
  //  js's founder-minting precedent officials.js itself copied from).
  // ============================================================
  function mintIdentity(fields) {
    if (!CBZ.cityPedStash) return null;
    const obj = Object.assign({ _parked: true, nameKnown: true, kind: "civilian" }, fields);
    CBZ.cityPedStash(obj);
    return obj._sid ? obj : null;
  }
  function mintName(gender) {
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender);
    return gender === "f" ? "Adelaide Winthrop" : "Foster Winthrop"; // no-name fallback, should never hit
  }
  // ============================================================
  //  THE PLAYER SENTINEL — office.holder / candidate.sid may be the STRING
  //  "player" instead of a ledger sid. That is the whole of the seam
  //  city/factions.js's §OFFICE names: "a candidate record flagged
  //  {player:true} with no sid" + "nameOf()/scoreCandidate()/tally()
  //  branches that read CBZ.player instead of the ledger" + "officials.js
  //  accepting a player holder". officials.js owns the constant (it loads
  //  first and stamps CBZ.officials.PLAYER_SID); the literal fallback keeps
  //  this file correct if that file is ever absent.
  // ============================================================
  const PLAYER = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
  function isPlayerSid(sid) { return sid === PLAYER; }
  function playerName() {
    if (CBZ.cityPlayerName) { try { const n = CBZ.cityPlayerName(); if (n) return n; } catch (e) {} }
    const P = CBZ.player;
    return (P && P.name) || (g && g.playerName) || "You";
  }

  // name lookup — officials.js already exposes the exact right accessor
  // (reads the live body first, falls back to the ledger page); no second
  // copy of that logic belongs here.
  function nameOf(sid) {
    if (isPlayerSid(sid)) return playerName();
    if (CBZ.officials && CBZ.officials.identityOf) {
      const idn = CBZ.officials.identityOf(sid);
      if (idn && idn.name) return idn.name;
    }
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "Someone";
  }

  // ============================================================
  //  THE DISTRICT-BLOC ↔ TURF JOIN — see header. Own copy of economy.js's
  //  districtAnchor() (that file doesn't export it — only the player-
  //  relative turfStanding/turfSellMult/etc. built ON TOP of it are).
  // ============================================================
  function districtAnchor(dk) {
    const c = (CBZ.city && CBZ.city.center) || { x: 0, z: 0 };
    const A = CBZ.city && CBZ.city.annex;
    const R = 70;
    switch (dk) {
      case "uptown": return { x: c.x + R, z: c.z - R };
      case "projects": return { x: c.x - R, z: c.z + R };
      case "waterfront": return { x: c.x + R, z: c.z + R };
      case "island": return A ? { x: A.cx, z: A.cz } : { x: c.x, z: c.z };
      default: return { x: c.x - R, z: c.z - R }; // downtown
    }
  }
  // the gang (or "player") whose turf.js ZONE sits nearest this district's
  // anchor point, or null if that ground is neutral. ANY non-null owner
  // counts as "gang-intimidated" — see header (not player-relationship
  // gated; these are NPC voters, not the player's own turf standing).
  function zoneOwnerFor(dk) {
    if (!CBZ.cityZoneOwner) return null;
    const a = districtAnchor(dk);
    return CBZ.cityZoneOwner(a.x, a.z) || null;
  }
  // which non-player gang (if any) holds >= 2 turf.js zones — the "machine"
  // candidate's backer. Excludes "player": a player-run political machine
  // is V.2's own endgame lever ("running for office"), not this wave's.
  function machineGangId() {
    if (!CBZ.cityZoneControl) return null;
    const ctrl = CBZ.cityZoneControl();
    let bestId = null, bestN = 0;
    for (const gid in (ctrl && ctrl.byGang) || {}) {
      if (gid === "player") continue;
      const n = ctrl.byGang[gid];
      if (n > bestN) { bestN = n; bestId = gid; }
    }
    return bestN >= 2 ? bestId : null;
  }
  // THE PLAYER-RUN MACHINE (V.2's own deferred endgame lever, now live): if
  // the player is ON the ballot and the player's OWN crew holds >= 2 turf.js
  // zones, the player IS the machine candidate — their blocs get the same
  // turnout x0.6 / +20%-of-the-vote treatment any gang-backed candidate gets.
  // Same threshold, same tally() code path, no second formula.
  function playerZoneCount() {
    if (!CBZ.cityZoneControl) return 0;
    const ctrl = CBZ.cityZoneControl();
    return ((ctrl && ctrl.byGang && ctrl.byGang.player) | 0);
  }

  // ============================================================
  //  BLOCS
  // ============================================================
  // CITY blocs — real npcecon.js cohort data + real turf.js zone ownership,
  // read through PUBLIC accessors only. X3 NARROWING (same spirit as the
  // STATE/COUNTRY BLOCS gap below): npcEcon's cohort table is still
  // mainland-only (5 libertyville districts) — every OTHER "city"-kind
  // record (mini-cities, and now city/countries.js's new settlements) reads
  // that SAME global bloc list rather than its own population, so a
  // goldspire or veridia mayoral race tallies against libertyville's
  // district data. Real per-city cohort data is X4's demographics wave;
  // until then this is a shared, documented simplification, not a bug.
  function cityBlocs(rec) {
    const dkeys = (CBZ.npcEcon && CBZ.npcEcon.DISTRICT_KEYS) || DISTRICT_KEYS_FALLBACK;
    const summary = (CBZ.npcEcon && CBZ.npcEcon.summary) ? CBZ.npcEcon.summary() : [];
    const out = [];
    for (let i = 0; i < dkeys.length; i++) {
      const dk = dkeys[i];
      let pop = 0, wealthPop = 0;
      for (let j = 0; j < summary.length; j++) {
        const row = summary[j];
        if (row.d !== dk) continue;
        pop += row.pop;
        if (row.c === "comf" || row.c === "rich") wealthPop += row.pop;
      }
      if (pop <= 0) continue;
      const wealthShare = wealthPop / pop;
      const owner = zoneOwnerFor(dk);
      const intimidated = !!owner;
      const D = CBZ.cityEcon && CBZ.cityEcon.DISTRICTS;
      out.push({
        id: dk, name: (D && D[dk] && D[dk].name) || dk, pop: pop,
        taxPref: clampNum(-1, 1, (wealthShare - 0.5) * 2),
        policePref: intimidated ? 1 : 0,
        intimidated: intimidated, owner: owner,
        turnout: BASE_TURNOUT * (intimidated ? INTIMIDATION_TURNOUT_MULT : 1),
      });
    }
    return out;
  }
  // STATE/COUNTRY blocs — one per child jurisdiction, "approval-weighted"
  // (see header for exactly what that means this wave: nominal equal pop,
  // turnout scaled by the child's own live approval).
  function childBlocs(rec) {
    const kids = rec.kind === "country"
      ? CBZ.polity.list("state").filter(function (s) { return s.parent === rec.id; })
      : CBZ.polity.list("city").filter(function (c) { return c.parent === rec.id; });
    const out = [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      out.push({
        id: k.id, name: k.name, pop: 100, taxPref: 0, policePref: 0,
        intimidated: false, owner: null,
        turnout: BASE_TURNOUT * clampNum(0, 1, (k.approval != null ? k.approval : 50) / 100),
      });
    }
    return out;
  }
  function buildBlocs(rec) {
    if (!rec) return [];
    if (rec.kind === "city") return cityBlocs(rec);
    return childBlocs(rec);
  }

  // ============================================================
  //  SCORING + TALLY (see header for the verbatim formula walk-through)
  // ============================================================
  // CHARISMA, for the player, is not a frozen roll — it is the street cred
  // they actually carry the day the vote is tallied (g.respect, the repo's
  // one global player-standing currency, read through the same 0..1 band an
  // NPC's rolled charisma occupies). A nobody polls like a nobody.
  const PLAYER_CHARISMA_RESPECT = 400;
  function charismaOf(cand) {
    if (!cand.player) return cand.charisma;
    const r = Math.max(0, (g && g.respect) || 0);
    return clampNum(0, 1, 0.12 + 0.88 * (r / PLAYER_CHARISMA_RESPECT));
  }
  function scoreCandidate(cand, bloc, rec) {
    const approvalTerm = cand.type === "incumbent" ? 0.5 * (rec.approval || 0) : 0;
    const platformDot = (-cand.platform.tax * bloc.taxPref) + (cand.platform.police * bloc.policePref);
    // FRAUD — the slot P4 wired and left at zero. It is no longer always zero:
    // a candidate record may carry a `fraud` term written by a REAL rigging
    // act (city/candidacy.js's records-office bribe; regimes.js may add its
    // own under fascism later). Nothing here invents one.
    const fraud = +cand.fraud || 0;
    return 40 + approvalTerm + 12 * charismaOf(cand) + platformDot * 15 + cand.momentum + fraud;
  }
  // tally(rec, candidates) -> {votes:[per-candidate summed weighted votes],
  // totalVotes, blocs} — the shared machinery poll + result both call, so a
  // displayed poll is a REAL snapshot of this race, not a cosmetic number.
  function tally(rec, candidates) {
    const blocs = buildBlocs(rec);
    const machineIdx = candidates.findIndex(function (c) { return c.type === "machine"; });
    const votes = candidates.map(function () { return 0; });
    let totalVotes = 0;
    for (let bi = 0; bi < blocs.length; bi++) {
      const bloc = blocs[bi];
      const scores = candidates.map(function (c) { return Math.max(1, scoreCandidate(c, bloc, rec)); });
      const sum = scores.reduce(function (a, b) { return a + b; }, 0);
      let shares = scores.map(function (s) { return s / sum; });
      if (bloc.intimidated && machineIdx >= 0) {
        shares = shares.map(function (s, i) {
          return i === machineIdx ? s * (1 - INTIMIDATION_MACHINE_SHIFT) + INTIMIDATION_MACHINE_SHIFT : s * (1 - INTIMIDATION_MACHINE_SHIFT);
        });
      }
      const weight = bloc.pop * bloc.turnout;
      for (let i = 0; i < shares.length; i++) { votes[i] += shares[i] * weight; totalVotes += shares[i] * weight; }
    }
    return { votes: votes, totalVotes: totalVotes, blocs: blocs };
  }
  // poll: same tally(), ±4-point noise, clamped — always exactly 2 candidates
  // this wave (see header NARROWING), so "A / 100−A" is always well-formed.
  function pollFor(rec, candidates) {
    const t = tally(rec, candidates);
    const aShare = t.totalVotes > 0 ? t.votes[0] / t.totalVotes : 0.5;
    let aPct = Math.round(aShare * 100 + (rng() - 0.5) * 8);
    aPct = clampNum(1, 99, aPct);
    return { aPct: aPct, bPct: 100 - aPct };
  }

  // ============================================================
  //  CANDIDATE MINTING
  // ============================================================
  function mintCandidate(type) {
    const gender = rng() < 0.5 ? "f" : "m";
    const obj = mintIdentity({
      name: mintName(gender), gender: gender, archetype: "civilian", job: "candidate",
      wealth: 0.5 + rng() * 0.3, cash: 500 + Math.round(rng() * 3000),
    });
    if (!obj) return null;
    return { sid: obj._sid, type: type, platform: { tax: rng() * 2 - 1, police: rng() * 2 - 1 }, charisma: rng(), momentum: 0 };
  }
  function incumbentCandidate(rec) {
    const holder = rec.office.holder;
    if (isPlayerSid(holder)) {
      // the player defending a seat they hold — same record shape, the
      // `player` flag is what makes nameOf/charismaOf/resolve() read
      // CBZ.player instead of the ledger.
      return Object.assign(playerCandidateRecord(), { type: "incumbent" });
    }
    return { sid: holder, type: "incumbent", platform: { tax: rng() * 2 - 1, police: rng() * 2 - 1 }, charisma: rng(), momentum: 0 };
  }
  // THE PLAYER'S CANDIDATE RECORD. No sid is minted — the player is not a
  // ledger identity and pretending otherwise would put a second, fake "you"
  // in the world's population. Platform/momentum/fraud come from what the
  // player actually ran: city/candidacy.js's `g.cityRun`.
  //
  // NAME-COLLISION FIX (the whole reason this file's player socket had never
  // fired): this used to read `g.cityCampaign`, which is the STORY campaign
  // (city/campaign.js's authored hitman spine) — a completely different
  // object that has never carried a platform, a momentum or a fraud term and
  // never will. Every player run therefore polled from three permanent
  // zeroes. The political run has its OWN key, `g.cityRun`, owned by
  // city/candidacy.js. The read stays degrade-safe: with that module absent
  // the platform is dead centre and momentum/fraud are zero, which polls
  // exactly as badly as it should.
  function runState() { return (g && g.cityRun) || null; }
  function playerCandidateRecord() {
    const C = runState();
    const pf = (C && C.platform) || null;
    return {
      sid: PLAYER, player: true, type: "challenger",
      platform: { tax: pf ? clampNum(-1, 1, +pf.tax || 0) : 0, police: pf ? clampNum(-1, 1, +pf.police || 0) : 0 },
      charisma: 0.5,                       // ignored — charismaOf() reads g.respect live
      // clamped on READ as well as on write: a blob saved before the cap
      // existed (or written by a module that reached g.cityRun directly) must
      // not be able to hand the tally an unbounded term.
      momentum: clampNum(-PLAYER_MOMENTUM_CAP, PLAYER_MOMENTUM_CAP, (C && +C.momentum) || 0),
      fraud: (C && +C.fraud) || 0,
    };
  }
  // A CANDIDATE RECORD IS A SNAPSHOT — but the player's campaign keeps
  // running for the whole CAMPAIGN_DAYS window after callElection() froze it.
  // Without this, every rally, endorsement and bribe the player earned during
  // the campaign was worth exactly nothing (the tally read the record minted
  // two days earlier). NPC candidates keep accruing momentum on their own
  // record in campaignDay(); this is the player's equivalent, read straight
  // off the live run. Platform is re-read too — a pledge changed mid-campaign
  // is a real, and realistically punishing, thing to do.
  function refreshPlayerCandidate(race) {
    const pi = playerIndex(race);
    if (pi < 0) return;
    const C = runState(); if (!C) return;
    const cand = race.candidates[pi];
    const fresh = playerCandidateRecord();
    cand.platform = fresh.platform;
    cand.momentum = fresh.momentum;
    cand.fraud = fresh.fraud;
  }
  function playerIndex(race) {
    if (!race || !race.candidates) return -1;
    for (let i = 0; i < race.candidates.length; i++) if (race.candidates[i].player) return i;
    return -1;
  }

  // ============================================================
  //  STATE — g.elections.races[jurisId] = {phase, calledDay, electionDay,
  //  candidates[], lastPoll}
  // ============================================================
  function reset() { g.elections = { races: Object.create(null) }; }
  function ensureInit() { if (!g.elections || !g.elections.races) reset(); }
  function ensureRace(id) {
    ensureInit();
    const R = g.elections.races;
    if (!R[id]) R[id] = { phase: null, calledDay: null, electionDay: null, candidates: [], lastPoll: null };
    return R[id];
  }

  // ============================================================
  //  CALL / CAMPAIGN / RESOLVE
  // ============================================================
  function callElection(id, rec, race, day, isSnap) {
    const title = titleFor(rec);
    const candidates = [];
    // is the player STANDING in this race? Either they already hold the seat
    // (incumbent, handled below) or they filed papers for it (race.pledged,
    // stamped by playerCandidacy() before the race was ever called).
    const playerHolds = isPlayerSid(rec.office.holder);
    const playerFiled = race.pledged === true && !playerHolds;
    if (!isSnap && rec.office.holder) candidates.push(incumbentCandidate(rec));
    if (playerFiled) candidates.push(playerCandidateRecord());
    const gid = machineGangId();
    // the player's own crew backs them if it holds the ground — the machine
    // slot is taken by the player, so no NPC machine candidate is minted.
    const playerIsMachine = (playerFiled || playerHolds) && playerZoneCount() >= 2;
    if (playerIsMachine) {
      const pi = playerIndex({ candidates: candidates });
      if (pi >= 0) candidates[pi].type = "machine";
    }
    const wantMachine = !!gid && !playerIsMachine;
    if (isSnap) {
      // no sitting officeholder to run against — challengers fill the field;
      // exactly one is machine-typed if a qualifying gang actually exists.
      const c1 = mintCandidate(wantMachine ? "machine" : "reformer");
      if (c1) candidates.push(c1);
      // a snap race normally mints TWO open challengers; with the player on
      // the ballot they ARE the second name, so only one NPC is needed.
      if (!playerFiled) { const c2 = mintCandidate("reformer"); if (c2) candidates.push(c2); }
    } else {
      const c1 = mintCandidate(wantMachine ? "machine" : "reformer");
      if (c1) candidates.push(c1);
    }
    race.candidates = candidates;
    race.pledged = false;                  // the pledge has been cashed into a real candidacy
    if (playerFiled || playerHolds) {
      if (CBZ.city && CBZ.city.big) CBZ.city.big("YOU ARE ON THE BALLOT — " + title.toUpperCase() + " OF " + String(rec.name).toUpperCase());
    }
    race.phase = "campaign";
    race.calledDay = day;
    race.electionDay = isSnap ? day + CAMPAIGN_DAYS : (rec.office.termDay != null ? rec.office.termDay : day + CAMPAIGN_DAYS);
    race.lastPoll = null;
    const names = race.candidates.map(function (c) {
      return (c.type === "incumbent" ? nameOf(c.sid) + " (incumbent)" : nameOf(c.sid) + " (" + c.type + ")");
    }).join(" vs ");
    if (CBZ.cityFeed) CBZ.cityFeed("Election called for " + title + " of " + rec.name + ": " + names, "#8fc1ff");
  }

  // momentum accrues on the CANDIDATE RECORD for an NPC, but the player's
  // record is a projection of the live run (see refreshPlayerCandidate) — so
  // anything credited to the player's record would be overwritten seconds
  // later. Route it to the run instead; that is the only copy that survives.
  // PLAYER_MOMENTUM_CAP mirrors city/candidacy.js's own MOMENTUM_CAP. momentum
  // is a RAW ADDITIVE TERM in scoreCandidate(), in the same units as the 40
  // base, the ~25 incumbency approval term and the ±15 platform swing — so an
  // uncapped one makes every other term noise. candidacy.js caps its own public
  // writer (momentumGain); this is the OTHER door into the same number (the
  // rally roll and the w.politics.support credit, both of which land here), and
  // it has to agree or the cap leaks.
  const PLAYER_MOMENTUM_CAP = 40;
  function addMomentum(cand, n) {
    if (!cand || !isFinite(n) || !n) return;
    if (cand.player) {
      const C = runState();
      if (C) {
        C.momentum = clampNum(-PLAYER_MOMENTUM_CAP, PLAYER_MOMENTUM_CAP, (+C.momentum || 0) + n);
        cand.momentum = C.momentum;
        return;
      }
    }
    cand.momentum += n;
  }

  function campaignDay(id, rec, race, day) {
    if (!race.candidates.length) return;
    // a random small rally — flavored with a real bloc name so campaign
    // chatter reads like it's actually happening somewhere on the map.
    const cand = race.candidates[(rng() * race.candidates.length) | 0];
    const blocs = buildBlocs(rec);
    const place = blocs.length ? blocs[(rng() * blocs.length) | 0].name : rec.name;
    addMomentum(cand, 0.3 + rng() * 0.9);
    if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(cand.sid) + " rallies supporters in " + place + ".", "#e8c84a");

    // THE CAMPAIGN-EVENT CREDIT. w.politics.support is moved by the player's
    // own "Campaign Event" activity (activities.js:194) — real money, a real
    // world-state number. It used to be handed unconditionally to the
    // INCUMBENT, which was correct only while the player could not stand for
    // anything: the moment candidacy.js put the player on the ballot as a
    // CHALLENGER, every $100 campaign event they paid for was momentum for
    // the person they were running against. The support goes to the player's
    // own record whenever the player is in the field (incumbent or
    // challenger — playerIndex finds both); an NPC-only race is unchanged.
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    const support = (w && w.politics && w.politics.support) || 0;
    if (support) {
      const pi = playerIndex(race);
      const target = pi >= 0 ? race.candidates[pi]
        : race.candidates.find(function (c) { return c.type === "incumbent"; });
      if (target) addMomentum(target, support * 0.2);
    }

    // the player's live campaign (city/candidacy.js) keeps moving all through
    // the window — pull it onto the frozen record before anyone tallies it.
    refreshPlayerCandidate(race);

    // POLL — the same tally() the real result uses, snapshotted today.
    if (race.candidates.length >= 2) {
      const poll = pollFor(rec, race.candidates);
      race.lastPoll = poll;
      const a = race.candidates[0], b = race.candidates[1];
      if (CBZ.cityFeed) CBZ.cityFeed("Poll: " + nameOf(a.sid) + " " + poll.aPct + " - " + nameOf(b.sid) + " " + poll.bPct, "#9aa6bd");
    }
  }

  function resolve(id, rec, race, day) {
    const title = titleFor(rec);
    // election day does NOT run campaignDay() (tickOffice returns straight
    // here), so this is the last chance to read the player's live run before
    // the votes are counted — the momentum they earned on the final day has
    // to be in the record the tally sees.
    refreshPlayerCandidate(race);
    const t = tally(rec, race.candidates);
    let bestI = 0;
    for (let i = 1; i < t.votes.length; i++) if (t.votes[i] > t.votes[bestI]) bestI = i;
    const winner = race.candidates[bestI];
    const incumbent = race.candidates.find(function (c) { return c.type === "incumbent"; });
    const winnerIsIncumbent = !!winner && winner.type === "incumbent";
    const winnerName = winner ? nameOf(winner.sid) : "Nobody";

    // a losing sitting incumbent steps down — NOT death (schedule.js's
    // dropSid is permanent; defeat isn't), job reverts to a generic
    // "politician" (an ex-officeholder, not erased).
    if (incumbent && !winnerIsIncumbent) {
      const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(incumbent.sid);
      if (e) e.job = "politician";
      if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(incumbent.sid) + " concedes defeat.", "#ff9a6a");
    }

    if (winner) {
      rec.office.holder = winner.sid;
      const holderEntry = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(winner.sid);
      if (holderEntry) holderEntry.job = jobFor(rec);
    }
    rec.office.termDay = day + termDaysFor(rec);

    if (CBZ.approvalShock) CBZ.approvalShock(rec.id, winnerIsIncumbent ? 4 : 0);

    const headline = (winnerIsIncumbent ? "" + winnerName + " RE-ELECTED " : "" + winnerName + " ELECTED ")
      + title.toUpperCase() + " OF " + rec.name.toUpperCase();
    if (CBZ.city && CBZ.city.big) CBZ.city.big(headline);
    if (CBZ.cityFeed) CBZ.cityFeed(headline, "#8fe08a");

    // "spent" — halved, not zeroed (V.2's own wording); the next cycle's
    // polling/momentum starts from wherever that lands.
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (w && w.politics) w.politics.support = (w.politics.support || 0) * 0.5;

    race.phase = null;
    race.candidates = [];
    race.lastPoll = null;
  }

  // ============================================================
  //  THE CLOCK — one CBZ.onNewDay tick per office id, per day.
  // ============================================================
  function tickOffice(id, day) {
    if (!CBZ.polity) return;
    const rec = CBZ.polity.get(id);
    if (!rec) return;
    // X3: MONARCHY GUARD — a monarchy office is never a ballot; the crown is
    // a bloodline (V.4/P6b's heirOf succession lands later — this wave the
    // crown just never calls an election, same "vacuum on assassination, no
    // resolution machine yet" gap officials.js already accepts for it).
    // govType propagates country -> state -> city (polity.js's
    // registerState/registerCity), so this ONE check skips a monarchy's
    // whole tree (king, its governors, its village chiefs) with no
    // per-office special-casing needed.
    if (rec.govType === "monarchy") return;
    const race = ensureRace(id);
    if (race.phase === "campaign") {
      if (day >= race.electionDay) { resolve(id, rec, race, day); return; }
      campaignDay(id, rec, race, day);
      return;
    }
    // SNAP ELECTION: officials.js's own assassination path stamps
    // rec.vacuum — clear it immediately (this IS the resolution path now).
    if (rec.vacuum != null) {
      rec.vacuum = null;
      callElection(id, rec, race, day, true);
      campaignDay(id, rec, race, day);
      return;
    }
    // NORMAL CYCLE: called at termDay-2, resolved at termDay.
    if (rec.office.termDay != null && day === rec.office.termDay - CAMPAIGN_DAYS) {
      callElection(id, rec, race, day, false);
      campaignDay(id, rec, race, day);
    }
  }
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (day) {
      const ids = allOfficeIds();   // X3: every registered office, not a fixed 5-id list
      for (let i = 0; i < ids.length; i++) {
        try { tickOffice(ids[i], day); } catch (e) { try { console.error("[elections] tick failed", ids[i], e); } catch (e2) {} }
      }
    });
  }

  // ============================================================
  //  PUBLIC API + POLITICS-PANEL TIE
  // ============================================================
  function status(id) {
    ensureInit();
    const race = g.elections.races[id];
    if (!race || race.phase !== "campaign") return null;
    return {
      daysLeft: Math.max(0, (race.electionDay || 0) - (CBZ.worldDay ? CBZ.worldDay() : 0)),
      candidates: race.candidates.map(function (c) {
        return { sid: c.sid, name: nameOf(c.sid), type: c.type, charisma: c.charisma, momentum: c.momentum, platform: Object.assign({}, c.platform) };
      }),
      lastPoll: race.lastPoll ? Object.assign({}, race.lastPoll) : null,
    };
  }

  function serialize() {
    ensureInit();
    const out = {};
    const R = g.elections.races;
    for (const id in R) {
      const r = R[id];
      // idle races carry nothing worth a save slot — EXCEPT a filed pledge. A
      // player who paid a filing fee on day 3 for a race called on day 5 had
      // that pledge silently dropped by every save in between, so the papers
      // were pulled and the ballot never showed the name.
      if (r.phase !== "campaign" && r.pledged !== true) continue;
      out[id] = {
        phase: r.phase, calledDay: r.calledDay, electionDay: r.electionDay,
        pledged: r.pledged === true,
        candidates: r.candidates.map(function (c) {
          // `player` and `fraud` are load-bearing: without the flag a restored
          // player candidate reads as a sid-less NPC (nameOf/charismaOf both
          // branch on it) and the rigging term silently zeroes on reload.
          return {
            sid: c.sid, type: c.type, player: !!c.player,
            platform: { tax: c.platform.tax, police: c.platform.police },
            charisma: c.charisma, momentum: c.momentum, fraud: +c.fraud || 0,
          };
        }),
        lastPoll: r.lastPoll ? { aPct: r.lastPoll.aPct, bPct: r.lastPoll.bPct } : null,
      };
    }
    return { v: 1, races: out };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1 || !obj.races) return;
    const R = g.elections.races;
    for (const id in obj.races) {
      const src = obj.races[id];
      if (!src) continue;
      R[id] = {
        phase: src.phase === "campaign" ? "campaign" : null,
        calledDay: src.calledDay != null ? src.calledDay : null,
        electionDay: src.electionDay != null ? src.electionDay : null,
        pledged: src.pledged === true,
        candidates: Array.isArray(src.candidates) ? src.candidates.map(function (c) {
          return {
            sid: c.sid, type: c.type,
            // a candidate whose sid is the player sentinel IS the player, even
            // if an older blob predates the flag — belt and braces.
            player: !!c.player || c.sid === PLAYER,
            platform: {
              tax: isFinite(c.platform && c.platform.tax) ? +c.platform.tax : 0,
              police: isFinite(c.platform && c.platform.police) ? +c.platform.police : 0,
            },
            charisma: isFinite(c.charisma) ? +c.charisma : 0.5,
            momentum: isFinite(c.momentum) ? +c.momentum : 0,
            fraud: isFinite(c.fraud) ? +c.fraud : 0,
          };
        }) : [],
        lastPoll: (src.lastPoll && isFinite(src.lastPoll.aPct)) ? { aPct: src.lastPoll.aPct, bPct: src.lastPoll.bPct } : null,
      };
    }
  }

  // ============================================================
  //  THE PLAYER SOCKET — the three reads and the one write that turn the
  //  finished-but-unreachable player path above into a reachable one.
  //  city/candidacy.js is the PRODUCER (it owns g.cityRun, the filing fee,
  //  the petition and the campaign jobs); this file stays the RETURNING
  //  OFFICER and owns nothing about how a run is earned.
  // ============================================================

  // pledge(officeId, on) — the ONE write. `race.pledged === true` is what
  // callElection() reads to put the player on the ballot; before this
  // function existed nothing in the repo could set it, which is why the
  // player-filed branch had never once executed. Refuses a monarchy (the
  // crown is not a ballot) and refuses once the field has already been set —
  // you cannot file for a race whose candidates are already printed.
  function pledge(officeId, on) {
    if (!officeId) return false;
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(officeId) : null;
    if (!rec || !rec.office) return false;
    if (rec.govType === "monarchy") return false;
    const race = ensureRace(officeId);
    if (race.phase === "campaign") return false;
    race.pledged = (on !== false);
    return true;
  }

  // playerRace() -> the live race the player is standing in, or null.
  function playerRace() {
    ensureInit();
    const R = g.elections.races;
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    for (const id in R) {
      const race = R[id];
      if (!race || race.phase !== "campaign") continue;
      const pi = playerIndex(race);
      if (pi < 0) continue;
      const rec = (CBZ.polity && CBZ.polity.get) ? CBZ.polity.get(id) : null;
      const poll = race.lastPoll ? Object.assign({}, race.lastPoll) : null;
      return {
        id: id, rec: rec, race: race, poll: poll,
        title: titleFor(rec), i: pi,
        daysLeft: Math.max(0, (race.electionDay || 0) - day),
        me: poll ? (pi === 0 ? poll.aPct : poll.bPct) : null,
      };
    }
    return null;
  }

  // openRaces() -> every seat a run could be aimed at, with the ONE number
  // that decides whether papers can still be filed (daysLeft). Monarchies are
  // omitted because tickOffice() never calls an election for one.
  function openRaces() {
    ensureInit();
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const ids = allOfficeIds();
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const rec = CBZ.polity.get(id);
      if (!rec || !rec.office || rec.govType === "monarchy") continue;
      const race = g.elections.races[id] || null;
      const inCampaign = !!(race && race.phase === "campaign");
      const phase = inCampaign ? "campaign" : (rec.vacuum != null ? "snap" : "idle");
      const endDay = inCampaign ? race.electionDay : (rec.office.termDay != null ? rec.office.termDay : null);
      out.push({
        id: id, rec: rec, title: titleFor(rec), termDay: rec.office.termDay,
        daysLeft: endDay != null ? Math.max(0, endDay - day) : null,
        phase: phase, pledged: !!(race && race.pledged === true),
        callDay: rec.office.termDay != null ? rec.office.termDay - CAMPAIGN_DAYS : null,
        campaignDays: CAMPAIGN_DAYS,
      });
    }
    return out;
  }

  // playerCandidacy(opts) — THE NAME factions.js:828-842 already calls
  // ("CBZ.factions.office.stand() will use CBZ.elections.playerCandidacy()
  // the moment it exists"). It does not own filing: it delegates to the
  // producer, and refuses in one plain sentence when the producer is absent.
  function playerCandidacy(opts) {
    opts = opts || {};
    const R = CBZ.cityRun;
    if (!R || typeof R.file !== "function") {
      return { ok: false, why: "There is no campaign office open — city/candidacy.js is not loaded." };
    }
    if (opts.officeId) return R.file(opts.officeId);
    const list = (typeof R.offices === "function") ? R.offices() : [];
    let pick = null;
    for (let i = 0; i < list.length; i++) if (list[i].canFile) { pick = list[i]; break; }
    if (!pick) {
      return { ok: false, why: (list[0] && list[0].why) || "No seat you could contest is up for election here." };
    }
    return R.file(pick.id);
  }

  CBZ.elections = {
    status: status,
    // --- the player socket (see above) ---
    playerCandidacy: playerCandidacy,
    playerRace: playerRace,
    openRaces: openRaces,
    pledge: pledge,
    serialize: serialize,
    apply: apply,
    reset: reset,
    // harness/test hooks only — not part of the public contract.
    _tickOffice: tickOffice,
    _tally: tally,
    _buildBlocs: buildBlocs,
    _pollFor: pollFor,
    _machineGangId: machineGangId,
    _resolve: resolve,
    _callElection: callElection,
    _campaignDay: campaignDay,
  };
  CBZ.electionsReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — approval.js's own g.cityWorld pattern,
  //  verbatim: stamp before the existing commit/collect hooks run, hydrate
  //  back out whenever that ledger object's REFERENCE changes. Own guard
  //  flag (_elcWrap).
  // ------------------------------------------------------------
  function stampElections() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.elc = serialize();
  }
  let _ensureElectionsSaveWraps_done = false;
  function ensureElectionsSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureElectionsSaveWraps_done) return;
    _ensureElectionsSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._elcWrap) {
      const w = function () { stampElections(); return commit.apply(this, arguments); };
      w._elcWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._elcWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampElections(); return col.apply(this, arguments); };
      wc._elcWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.elc) apply(led.elc);
  }
  if (CBZ.onUpdate) {
    // 46.11 — next free slot after approval.js's own 46.09 install-tick.
    CBZ.onUpdate(46.11, function () {
      if (!g) return;
      ensureElectionsSaveWraps();
      hydrateFromLedger();
    });
  }
})();
