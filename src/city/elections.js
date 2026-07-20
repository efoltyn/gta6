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
  // name lookup — officials.js already exposes the exact right accessor
  // (reads the live body first, falls back to the ledger page); no second
  // copy of that logic belongs here.
  function nameOf(sid) {
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
  function scoreCandidate(cand, bloc, rec) {
    const approvalTerm = cand.type === "incumbent" ? 0.5 * (rec.approval || 0) : 0;
    const platformDot = (-cand.platform.tax * bloc.taxPref) + (cand.platform.police * bloc.policePref);
    const fraud = 0; // wired, zero this wave — regimes.js/P6 (fascism +25) and ballot heists (+10) land later
    return 40 + approvalTerm + 12 * cand.charisma + platformDot * 15 + cand.momentum + fraud;
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
    return { sid: rec.office.holder, type: "incumbent", platform: { tax: rng() * 2 - 1, police: rng() * 2 - 1 }, charisma: rng(), momentum: 0 };
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
    if (!isSnap && rec.office.holder) candidates.push(incumbentCandidate(rec));
    const gid = machineGangId();
    if (isSnap) {
      // no sitting officeholder to run against — two open challengers, one
      // machine-typed only if a qualifying gang actually exists this cycle.
      const c1 = mintCandidate(gid ? "machine" : "reformer");
      const c2 = mintCandidate("reformer");
      if (c1) candidates.push(c1);
      if (c2) candidates.push(c2);
    } else {
      const c1 = mintCandidate(gid ? "machine" : "reformer");
      if (c1) candidates.push(c1);
    }
    race.candidates = candidates;
    race.phase = "campaign";
    race.calledDay = day;
    race.electionDay = isSnap ? day + CAMPAIGN_DAYS : (rec.office.termDay != null ? rec.office.termDay : day + CAMPAIGN_DAYS);
    race.lastPoll = null;
    const names = race.candidates.map(function (c) {
      return (c.type === "incumbent" ? nameOf(c.sid) + " (incumbent)" : nameOf(c.sid) + " (" + c.type + ")");
    }).join(" vs ");
    if (CBZ.cityFeed) CBZ.cityFeed("Election called for " + title + " of " + rec.name + ": " + names, "#8fc1ff");
  }

  function campaignDay(id, rec, race, day) {
    if (!race.candidates.length) return;
    // a random small rally — flavored with a real bloc name so campaign
    // chatter reads like it's actually happening somewhere on the map.
    const cand = race.candidates[(rng() * race.candidates.length) | 0];
    const blocs = buildBlocs(rec);
    const place = blocs.length ? blocs[(rng() * blocs.length) | 0].name : rec.name;
    cand.momentum += 0.3 + rng() * 0.9;
    if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(cand.sid) + " rallies supporters in " + place + ".", "#e8c84a");

    // the player's OWN Campaign Event activity credits the INCUMBENT (a
    // snap election has none — player-as-candidate is V.2's own future
    // endgame lever, see header).
    const incumbent = race.candidates.find(function (c) { return c.type === "incumbent"; });
    if (incumbent) {
      const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
      const support = (w && w.politics && w.politics.support) || 0;
      incumbent.momentum += support * 0.2;
    }

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
      if (r.phase !== "campaign") continue; // idle races carry nothing worth a save slot
      out[id] = {
        phase: r.phase, calledDay: r.calledDay, electionDay: r.electionDay,
        candidates: r.candidates.map(function (c) {
          return { sid: c.sid, type: c.type, platform: { tax: c.platform.tax, police: c.platform.police }, charisma: c.charisma, momentum: c.momentum };
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
        candidates: Array.isArray(src.candidates) ? src.candidates.map(function (c) {
          return {
            sid: c.sid, type: c.type,
            platform: {
              tax: isFinite(c.platform && c.platform.tax) ? +c.platform.tax : 0,
              police: isFinite(c.platform && c.platform.police) ? +c.platform.police : 0,
            },
            charisma: isFinite(c.charisma) ? +c.charisma : 0.5,
            momentum: isFinite(c.momentum) ? +c.momentum : 0,
          };
        }) : [],
        lastPoll: (src.lastPoll && isFinite(src.lastPoll.aPct)) ? { aPct: src.lastPoll.aPct, bPct: src.lastPoll.bPct } : null,
      };
    }
  }

  CBZ.elections = {
    status: status,
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
