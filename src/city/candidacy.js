/* ============================================================
   city/candidacy.js — RUNNING FOR OFFICE. The producer city/elections.js
   named in its own comments and nobody ever wrote.

   THE FINDING THIS FILE EXISTS TO CASH IN (do not re-derive it):
   city/elections.js is a complete, working election machine — voter blocs
   built from sim/npcecon.js's real cohort table, machine candidates bound to
   whichever gang actually holds turf.js zones, polls that are literal
   snapshots of the same tally() the result uses, succession, snap elections
   on assassination. It was written with a PLAYER-SHAPED SOCKET ALREADY CUT
   INTO IT that nothing had ever plugged:
     · `PLAYER = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player"`
       — and PLAYER_SID was assigned nowhere in the repo.
     · `playerCandidateRecord()` read `g.cityCampaign.platform/.momentum/
       .fraud` — `g.cityCampaign` is the STORY campaign (city/campaign.js).
       A name collision. Those three fields have never existed on it, so
       every player run polled from three permanent zeroes.
     · `callElection()` puts the player on the ballot iff `race.pledged ===
       true`. NOTHING IN THE REPO EVER SET IT.
   So the player-as-candidate path was finished code with no producer. This
   file is the producer. It does not contain a second election — it contains
   the SIX things a run is made of, and every one of them writes into a term
   that elections.js's real scoreCandidate() was already reading:

     score = 40 + 0.5·approval[incumbent] + 12·charisma
             + 15·(−platform.tax·bloc.taxPref + platform.police·bloc.policePref)
             + momentum + fraud

   NO STAT FICTIONS (CLAUDE.md, banned). Every number below names the world
   object it moves, and that object is somebody else's, already running:
     platform  -> the platformDot term, against blocs built from the LIVE
                  npcecon cohort table and LIVE turf ownership.
     momentum  -> a raw additive term in the same formula.
     fraud     -> the other raw additive term, the slot elections.js wired
                  and left at zero with a comment naming this file.
     warChest  -> real cash (CBZ.city.spend). Its ONLY exits are seek() and
                  rig(); money that can never leave is a progress bar.
     spent     -> credited to the campaign faction as `contrib`, which is a
                  REAL rank threshold, and the ranks gate real verbs.
     scandal   -> NOT ours. It is w.politics.scandal (city/worldstate.js's
                  reserved politics block), the same number activities.js's
                  "Corrupt Permit Deal" already moves. We READ it for the
                  fraud-discovery check and WRITE it only through
                  CBZ.cityEvent("politics", …), the existing path. A corrupt
                  permit you pulled last week really does get your ballot
                  fraud found faster. `g.cityRun.scandal` is a refreshed
                  MIRROR of that field for readers, never a second source.
     signatures-> ballot ACCESS. Short of the count on nomination day and
                  elections.js never sees your name at all.
     charisma  -> deliberately NOT ours. elections.js reads g.respect LIVE at
                  tally time. A nobody polls like a nobody, and that is why a
                  run has to be earned rather than bought.

   THE SIX BEATS
   1. FILING (CBZ.cityRun.file). Real money, a real seat off
      CBZ.polity.list(), and only a seat you could plausibly contest: one
      whose jurisdiction chain contains the ground you are standing on, or
      ground your crew actually holds (turf.js zones). Monarchies are never
      on the list — elections.js's tickOffice() refuses to call a ballot for
      a crown, so offering one would be a lie.
   2. SIGNATURES (canSign/sign) — Watch Dogs: Legion's recruit beat, but the
      answer is COMPUTED, never rolled. It comes out of the same platformDot
      the election runs, against the district bloc that person is standing
      in, plus their OWN wealth (a rich man on a poor block is still a rich
      man), your respect, your mood-read, and HARD EXCLUSIONS that no price
      clears: a faction you are hostile to, a witness to your last crime, a
      standing grudge, or sirens behind you. One ask per person, ever, and
      every refusal says why in one line. That line IS the mechanic.
   3. THE COALITION (blocs/seek/hook) — Crusader Kings' hook as a numeric
      DISCOUNT with Victoria 3's hard exclusion. Blocs are things that
      already exist: every CBZ.factions organisation, every live gang, the
      police, the garrison. A hook (rank, standing, contracts, cash, or dirt
      the civic desks hand you) cuts the price; hostility blocks the bloc at
      ANY price, which is the only thing that stops a coalition being a
      shopping list. A gang's endorsement is worth what its ZONE COUNT says
      it is worth.
   4. CAMPAIGN JOBS — through CBZ.mission, never a parallel system. A
      declared faction with a rank ladder where every rung unlocks a VERB
      (Volunteer canvasses · Organizer bargains · Operative rigs · Machine
      Boss may promise the whole thing), and five offers on the EXISTING
      order board. contracts.js's binding rule applies to every one of them:
      the generator picks the verb, the WORLD supplies the specifics —
      nothing is ever spawned for a job, and a job the world cannot supply
      is not offered.
   5. FRAUD (rig) — a crime with real heat through the real crime funnel, a
      real cap, and real discovery. Exposure costs strictly more than the
      fraud bought. Never silent, never free. The discovery roll is
      CBZ.hash01 over (scandal, day) — deterministic, because there is no
      Math.random anywhere near a vote.
   6. ELECTION DAY arrives on elections.js's own clock. Win and
      rec.office.holder becomes "player" (elections.js already writes it) —
      the assassination contract on the board now names YOU. Lose and the run
      is spent, the signatures are gone, `runs` increments and you may file
      again next term. Die in office and city/officials.js runs the same
      succession an assassinated NPC gets: your deputy is sworn in and the
      world carries on. That is the permadeath doctrine, and this file's only
      job in it is to not leave anything stranded behind you.

   FLAG: CBZ.CONFIG.GOV_CANDIDACY (self-defaulted here — this file owns the
   behaviour and may not edit config.js). One-line revert.
   RATCHET: CBZ.candidacyAudit() — the count of campaign levers that move NO
   real number. Must be 0.

   LOAD: a <script> tag in index.html AFTER city/elections.js (:956). Every
   dependency it needs at parse time already sits above that line
   (core/mission.js :348, city/factions.js :651, city/interactions.js :730,
   city/turf.js :768, sim/npcecon.js :940, city/polity.js :947,
   city/officials.js :954); everything else is wired lazily and retried.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  // one-line revert (CLAUDE.md: every risky feature is a flag in its own file)
  if (CFG.GOV_CANDIDACY == null) CFG.GOV_CANDIDACY = true;

  // ============================================================
  //  CONSTANTS — every one of them is a price, a threshold or a term in
  //  somebody else's formula. There are no cosmetic numbers here.
  // ============================================================
  const CAMPAIGN_ID = "campaign";

  // filing fee + petition size by office KIND (elections.js's own kind axis:
  // mayor 7d / governor 14d / president 28d). A mayoral run is affordable
  // mid-game; a presidency is a late-game project.
  const KIND_FEE = { city: 25000, state: 60000, federal: 60000, country: 150000 };
  const KIND_SIGS = { city: 12, state: 24, federal: 24, country: 40 };

  const SIG_LIFE_DAYS = 4;        // a signature is per-RUN, not forever
  const SIG_BASE = 0.45;          // the "an ordinary person will sign for an ordinary candidate" floor
  const SIG_PASS = 0.50;          // the threshold. Above it they sign. No dice.
  const SIG_W_AGREE = 0.28;       // weight on the platform dot (the election's own term)
  const SIG_W_CRED = 0.35;        // weight on g.respect, read through elections.js's own band
  const SIG_W_MOOD = 0.10;        // weight on the ped's own live mood
  const SIG_W_ENDORSE = 0.15;     // their own outfit already backs you
  const RESPECT_FULL = 400;       // elections.js's PLAYER_CHARISMA_RESPECT — one band, not two

  // coalition
  const BLOC_BASE = { faction: 12000, gang: 9000, institution: 20000 };
  const HOOK_DISCOUNT = 0.5;      // dirt HALVES a price. It never buys the endorsement.
  const HOOK_MOMENTUM = 3;        // an oppo file on the man you are running against
  const ENDORSE_FACTION = 1.2, ENDORSE_FACTION_RANK = 0.6;
  const ENDORSE_GANG = 0.8, ENDORSE_GANG_ZONE = 0.5;   // per turf.js zone actually held
  const ENDORSE_POLICE = 2.2, ENDORSE_GARRISON = 2.6;

  // MOMENTUM — a raw additive term in elections.js's scoreCandidate(). Capped
  // for the same reason FRAUD_CAP exists: the base is 40, a sitting incumbent's
  // approval term is ~25 and the whole platform swing is ±15, so an uncapped
  // repeatable +4 job trivialises every other term. 40 makes momentum worth
  // about as much as incumbency itself and no more. Mirrored in elections.js.
  const MOMENTUM_CAP = 40;

  // fraud — every entry is a real bribe at a real counter
  const FRAUD_CAP = 25;
  const EXPOSE_FLOOR = 70;        // above this city-wide scandal it comes out, full stop
  const RIGS = {
    rolls: {
      label: "Pad the voter rolls", fraud: 8, cost: 8000, heat: 90, scandal: 6, corruption: 6,
      // "dmv" is Records & Licensing — city/civic.js's records-office desk
      // sells exactly this bribe and stands at that counter, so the rolls have
      // to be reachable from it or that whole desk row is unreachable.
      at: ["cityannex", "courthouse", "cityhall", "dmv"],
      line: "The clerk counts it twice and the rolls come back ten names longer.",
    },
    machines: {
      label: "Tamper with the count", fraud: 10, cost: 15000, heat: 140, scandal: 9, corruption: 8,
      at: ["courthouse", "cityannex"],
      line: "The tabulator will read a little generously on the night.",
    },
    box: {
      label: "Stuff the boxes", fraud: 12, cost: 22000, heat: 220, scandal: 14, corruption: 10,
      at: ["cityhall", "courthouse"],
      line: "Somebody will be moving boxes at four in the morning. Not you.",
    },
  };
  const RIG_RADIUS = 26;          // you must be AT the counter you are bribing

  // campaign jobs
  const RALLY_MOMENTUM = 4;
  const GOTV_BASE = 2, GOTV_POP = 4;     // scaled by the bloc's real population share
  const LEAN_MOMENTUM = 4;
  const WIN_RESPECT = 60;

  // rank tiers that gate verbs (CLAUDE.md: every rung unlocks a VERB)
  const TIER_SEEK = 1;            // Organizer — you have people to send to a bloc
  const TIER_RIG = 2;             // Operative — you know which counter takes money
  const TIER_FULL_PLATFORM = 3;   // Machine Boss — you may promise the whole thing
  const PLATFORM_LIMIT = 0.5, PLATFORM_LIMIT_BOSS = 1.0;

  // ============================================================
  //  TINY GUARDED HELPERS — every cross-file read is feature-detected. Other
  //  agents are live in this tree; nothing here may throw because a sibling
  //  has not parsed yet.
  // ============================================================
  function clamp(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function worldDay() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function money(n) { return "$" + Math.round(n || 0).toLocaleString(); }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#8fc1ff"); } catch (e) {} } }
  function big(t) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(t); } catch (e) {} } }
  // HUD doctrine: player-directed prose is a PHONE push, never a floating card.
  function note(t, from, app) {
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(t, 3.2, { from: from || "Campaign", app: app || "messages" }); } catch (e) {} }
  }
  function say(p, line) { if (CBZ.citySay && p) { try { CBZ.citySay(p, line, "#dfe7ff", 2.4); } catch (e) {} } }
  function pos() { const P = CBZ.player; return (P && P.pos) || null; }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function polity() { return CBZ.polity && typeof CBZ.polity.get === "function" ? CBZ.polity : null; }
  function elections() { return (CBZ.elections && CBZ.elections.pledge) ? CBZ.elections : null; }
  function isPlayerSid(sid) {
    return (CBZ.officials && CBZ.officials.isPlayer) ? CBZ.officials.isPlayer(sid) : sid === "player";
  }
  function playerName() {
    const P = CBZ.player;
    return (P && P.name) || (g && g.playerName) || "You";
  }
  // THE LADDER LIVES IN ONE FILE. officials.js's exported titleFor() is the
  // one declaration; this file's hand-typed kind->title branches (one of the
  // EIGHT copies doctrine counts) are deleted. Degrade: "Official" — prose
  // only, never a break.
  function titleOf(rec) {
    if (CBZ.officials && CBZ.officials.titleFor) { try { const t = CBZ.officials.titleFor(rec); if (t) return t; } catch (e) {} }
    return "Official";
  }
  // the shared politics block (worldstate.js:105) — corruption/scandal/
  // emergencyPowers live THERE and are written only through cityEvent.
  function politics() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    return (w && w.politics) || (g && g.cityPolitics) || null;
  }
  function scandalNow() { const p = politics(); return p ? (+p.scandal || 0) : 0; }

  // ============================================================
  //  STATE — g.cityRun. Owned here, read by elections.js
  //  (playerCandidateRecord), games/government.js (the clerk's window) and
  //  city/civic.js (the desks that hand out hooks).
  // ============================================================
  function blank() {
    return {
      filed: false, certified: false, onBallot: false, officeId: null, filedDay: 0,
      platform: { tax: 0, police: 0 },
      momentum: 0, fraud: 0, warChest: 0, scandal: 0, exposed: false,
      sigs: Object.create(null), sigCount: 0, sigsNeeded: 0,
      endorse: Object.create(null), hooks: Object.create(null),
      spent: 0, wins: 0, runs: 0,
    };
  }
  function state() {
    if (!g.cityRun || typeof g.cityRun !== "object") g.cityRun = blank();
    const st = g.cityRun;
    // normalise anything a foreign save (or an older shape) left missing —
    // elections.js reads .platform/.momentum/.fraud off this object directly.
    if (!st.platform || typeof st.platform !== "object") st.platform = { tax: 0, police: 0 };
    if (!st.sigs) st.sigs = Object.create(null);
    if (!st.endorse) st.endorse = Object.create(null);
    if (!st.hooks) st.hooks = Object.create(null);
    if (!isFinite(st.momentum)) st.momentum = 0;
    if (!isFinite(st.fraud)) st.fraud = 0;
    if (!isFinite(st.warChest)) st.warChest = 0;
    // NOT A SECOND SOURCE OF TRUTH: scandal lives on worldstate's politics
    // block. This is a refreshed read so a panel can render state().scandal
    // without knowing where it lives. Nothing here ever writes it back.
    st.scandal = scandalNow();
    return st;
  }
  // ---- WHICH SEAT IS THIS RUN ABOUT --------------------------------------
  // Two shapes, one answer: the seat you FILED for, or the seat you already
  // HOLD. The second one matters — elections.js's incumbentCandidate() calls
  // playerCandidateRecord() for a player defending a seat, so a sitting
  // player Mayor campaigns for re-election through this exact same platform,
  // momentum, endorsement and fraud machinery. Without this branch a player
  // who won once would defend the seat from a dead-centre platform with zero
  // momentum, every term, forever.
  let _heldCache = null, _heldT = -1;
  function heldRec() {
    // one scan per frame at most. If CBZ.now is not a real advancing clock the
    // cache is DISABLED rather than frozen — a stale "you are the mayor" is a
    // far worse failure than four extra array walks.
    const t = (typeof CBZ.now === "number" && isFinite(CBZ.now)) ? CBZ.now : null;
    if (t != null && _heldT === t) return _heldCache;
    _heldT = (t != null ? t : -1); _heldCache = null;
    const P = polity(); if (!P || !P.list) return null;
    const kinds = ["city", "state", "federal", "country"];
    for (let k = 0; k < kinds.length; k++) {
      let list = [];
      try { list = P.list(kinds[k]) || []; } catch (e) { list = []; }
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r && r.office && isPlayerSid(r.office.holder)) { _heldCache = r; return r; }
      }
    }
    return null;
  }
  function holdsSeat() { return !!heldRec(); }
  // the polity record every bloc/district/rival read below is relative to.
  function runOffice() {
    const st = state();
    const P = polity(); if (!P) return null;
    if (st.filed && st.officeId) return P.get(st.officeId);
    return heldRec();
  }
  function runOfficeId() { const r = runOffice(); return r ? r.id : null; }
  function live() {
    if (!CFG.GOV_CANDIDACY) return false;
    return !!runOffice();
  }
  // "is your name going to be on the next ballot" — certified by petition, or
  // automatic because you are the sitting officeholder.
  function ballotReady() { return state().certified || holdsSeat(); }

  // spending is never just a subtraction: every dollar the campaign burns is
  // `contrib` credit with the campaign faction, and contrib is a REAL rank
  // threshold that gates seek()/rig()/the platform width. That is what keeps
  // `spent` from being a scoreboard.
  function noteSpend(n, why) {
    const st = state();
    n = Math.max(0, Math.round(n || 0));
    st.spent += n;
    if (CBZ.factions && CBZ.factions.credit && CBZ.factions.isMember && CBZ.factions.isMember(CAMPAIGN_ID)) {
      try { CBZ.factions.credit(CAMPAIGN_ID, "contrib", n); } catch (e) {}
    }
    void why;
  }
  // the war chest pays first, the wallet covers the rest. Both are real money.
  function drawFunds(n) {
    const st = state();
    n = Math.max(0, Math.round(n || 0));
    const fromChest = Math.min(st.warChest, n);
    const rest = n - fromChest;
    if (rest > 0) {
      if (!CBZ.city || !CBZ.city.spend || !CBZ.city.spend(rest)) return false;
    }
    st.warChest -= fromChest;
    noteSpend(n, "campaign");
    return true;
  }
  function myTier() {
    if (!CBZ.factions || !CBZ.factions.tier) return 0;
    const t = CBZ.factions.tier(CAMPAIGN_ID);
    return t < 0 ? 0 : t;
  }
  function platformLimit() { return myTier() >= TIER_FULL_PLATFORM ? PLATFORM_LIMIT_BOSS : PLATFORM_LIMIT; }

  // momentumGain — THE public write. Campaign jobs, the council chamber
  // (games/government.js) and endorsements all land here, and here only.
  function momentumGain(n, why) {
    if (!isFinite(n) || !n) return 0;
    const st = state();
    // THE CAP. momentum is a RAW ADDITIVE TERM in scoreCandidate(), in the same
    // units as the whole rest of the formula (40 base + 0.5·approval ≈ 25 for a
    // sitting incumbent + 12·charisma + 15·platformDot). Uncapped it was
    // farmable: the rally and GOTV offers are repeatable with no cooldown and
    // pay +4 and +2..6 apiece, and a run can be filed several world-days before
    // callDay, so an hour of re-taking one 40-second job put momentum past 150
    // and made every other term — approval, charisma, the platform, the blocs —
    // arithmetic noise. Capped at MOMENTUM_CAP, momentum is a PEER of the
    // incumbency bonus rather than a replacement for the election. `fraud` was
    // already capped (FRAUD_CAP); this is the same discipline for its twin.
    // elections.js clamps the same constant on its own writer (addMomentum) so
    // both doors to this number agree.
    st.momentum = clamp(-MOMENTUM_CAP, MOMENTUM_CAP, Math.round((st.momentum + n) * 100) / 100);
    if (why) note((n > 0 ? "+" : "") + (Math.round(n * 10) / 10) + " momentum — " + why + ".", "Campaign", "news");
    return st.momentum;
  }

  // ============================================================
  //  WHICH SEATS COULD YOU PLAUSIBLY CONTEST
  //  The ground you stand on, and the ground your crew holds. Both are real
  //  reads: polity.js's own point lookup and turf.js's own zone table.
  // ============================================================
  function chainOf(rec) {
    const out = [];
    const P = polity(); if (!P || !rec) return out;
    let r = rec, guard = 0;
    while (r && guard++ < 8) { out.push(r); r = r.parent ? P.get(r.parent) : null; }
    return out;
  }
  function contestableRecords() {
    const P = polity(); if (!P || !P.of) return [];
    const seen = Object.create(null), out = [];
    function add(rec) {
      const ch = chainOf(rec);
      for (let i = 0; i < ch.length; i++) { const r = ch[i]; if (r && !seen[r.id]) { seen[r.id] = 1; out.push(r); } }
    }
    const p = pos();
    if (p) { try { add(P.of(p.x, p.z)); } catch (e) {} }
    // turf you actually hold counts as standing there — a machine boss can
    // run for a seat in a city he owns blocks in without walking back.
    if (CBZ.cityZones) {
      let zones = [];
      try { zones = CBZ.cityZones() || []; } catch (e) { zones = []; }
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        if (!z || z.owner !== "player") continue;
        try { add(P.of(z.cx, z.cz)); } catch (e) {}
      }
    }
    return out;
  }
  function feeFor(rec) { return (rec && KIND_FEE[rec.kind]) || KIND_FEE.city; }
  function sigsFor(rec) { return (rec && KIND_SIGS[rec.kind]) || KIND_SIGS.city; }

  function offices() {
    if (!CFG.GOV_CANDIDACY) return [];
    const E = elections(); if (!E || !E.openRaces) return [];
    const st = state();
    const day = worldDay();
    let open = [];
    try { open = E.openRaces() || []; } catch (e) { open = []; }
    const byId = Object.create(null);
    for (let i = 0; i < open.length; i++) byId[open[i].id] = open[i];

    const recs = contestableRecords();
    const rows = [];
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (!rec || !rec.office) continue;
      const o = byId[rec.id];
      // no entry means elections.js does not run a ballot for this seat (a
      // monarchy, or a record with no office). Do not offer what cannot happen.
      if (!o) continue;
      const fee = feeFor(rec), need = sigsFor(rec);
      const holderName = rec.office.holder
        ? (isPlayerSid(rec.office.holder) ? playerName()
          : (CBZ.officials && CBZ.officials.identityOf ? CBZ.officials.identityOf(rec.office.holder).name : "Someone"))
        : null;
      let canFile = true, why = "";
      if (isPlayerSid(rec.office.holder)) {
        canFile = false; why = "You hold this seat. You stand as the incumbent automatically.";
      } else if (st.filed && st.officeId === rec.id) {
        canFile = false; why = "Your papers are already filed here.";
      } else if (st.filed) {
        const other = polity() ? polity().get(st.officeId) : null;
        canFile = false; why = "You are already running for " + titleOf(other) + " of " + ((other && other.name) || "another seat") + ".";
      } else if (o.phase === "campaign") {
        canFile = false; why = "The ballot is printed — the campaign has already started.";
      } else if (o.phase !== "snap" && !(o.callDay != null && o.callDay > day)) {
        canFile = false; why = "Nomination has closed for this term.";
      } else if (!CBZ.city || !CBZ.city.canAfford || !CBZ.city.canAfford(fee)) {
        canFile = false; why = "The filing fee is " + money(fee) + ".";
      }
      rows.push({
        id: rec.id, rec: rec, title: titleOf(rec), name: rec.name,
        holder: holderName, termDay: rec.office.termDay, daysLeft: o.daysLeft,
        phase: o.phase, fee: fee, sigsNeeded: need, canFile: canFile, why: why,
      });
    }
    return rows;
  }

  // ============================================================
  //  FILING
  // ============================================================
  function file(officeId) {
    if (!CFG.GOV_CANDIDACY) return { ok: false, why: "Candidacy is switched off." };
    if (!elections()) return { ok: false, why: "There is no returning officer — city/elections.js is not loaded." };
    const rows = offices();
    let row = null;
    for (let i = 0; i < rows.length; i++) if (rows[i].id === officeId) { row = rows[i]; break; }
    if (!row) return { ok: false, why: "You cannot contest that seat from here. Stand in the jurisdiction, or hold ground in it." };
    if (!row.canFile) return { ok: false, why: row.why };
    if (!CBZ.city || !CBZ.city.spend || !CBZ.city.spend(row.fee)) {
      return { ok: false, why: "You cannot cover the " + money(row.fee) + " filing fee." };
    }
    // A NEW RUN IS A NEW RUN. Signatures, endorsements, hooks, momentum and
    // fraud from a previous campaign are spent — carrying them forward would
    // make the second run a save-scum of the first. Only the tally survives.
    const st0 = state();
    const wins = st0.wins | 0, runs = st0.runs | 0;
    g.cityRun = blank();
    const st = state();
    st.wins = wins; st.runs = runs;
    st.filed = true; st.officeId = row.id; st.filedDay = worldDay();
    st.sigsNeeded = row.sigsNeeded;
    noteSpend(row.fee, "filing fee");
    joinCampaign();
    note("Papers filed for " + row.title + " of " + row.name + ". " + row.sigsNeeded
      + " signatures before nomination closes, or your name is not on the ballot.", "City Clerk", "messages");
    feed(playerName() + " files for " + row.title + " of " + row.name + ".", "#8fc1ff");
    return { ok: true, why: "", officeId: row.id, fee: row.fee, sigsNeeded: row.sigsNeeded };
  }

  // CERTIFY — the signature count is BALLOT ACCESS, and this is the moment it
  // becomes one. race.pledged is the single write into elections.js; short of
  // the count it is never made and the election is called without you.
  function certify() {
    const st = state();
    if (!st.filed || st.certified) return false;
    if (st.sigCount < st.sigsNeeded) return false;
    const E = elections(); if (!E) return false;
    if (!E.pledge(st.officeId, true)) return false;
    st.certified = true;
    const rec = polity() ? polity().get(st.officeId) : null;
    feed(playerName() + " qualifies for the ballot — " + titleOf(rec) + " of " + ((rec && rec.name) || "the city") + ".", "#8fe08a");
    note("Certified. You are on the ballot.", "City Clerk", "messages");
    return true;
  }
  function unpledge() {
    const st = state();
    const E = elections();
    if (E && st.officeId) { try { E.pledge(st.officeId, false); } catch (e) {} }
  }
  function closeRun() {
    const st = state();
    const wins = st.wins | 0, runs = st.runs | 0;
    g.cityRun = blank();
    const n = state(); n.wins = wins; n.runs = runs;
  }
  function withdraw() {
    const st = state();
    if (!st.filed) return { ok: false, why: "You are not running for anything." };
    if (st.onBallot) return { ok: false, why: "Your name is printed. The only way off that ballot is election day." };
    unpledge();
    st.runs = (st.runs | 0) + 1;
    closeRun();
    note("Papers withdrawn. The filing fee is not coming back.", "City Clerk", "messages");
    return { ok: true, why: "" };
  }

  // PLEDGE — the platform. tax/police in −1..1, the exact axes
  // scoreCandidate()'s platformDot multiplies against every bloc's
  // taxPref/policePref. The width is a rank unlock: a Volunteer hedges, a
  // Machine Boss promises the whole thing.
  function pledgePlatform(tax, police) {
    const st = state();
    if (!live()) return { ok: false, why: "File first. A platform with no ballot line is a conversation." };
    const lim = platformLimit();
    st.platform.tax = clamp(-lim, lim, +tax || 0);
    st.platform.police = clamp(-lim, lim, +police || 0);
    return { ok: true, why: "", platform: { tax: st.platform.tax, police: st.platform.police }, limit: lim };
  }

  // ============================================================
  //  SIGNATURES — the petition. See the header: computed, never rolled.
  // ============================================================
  let _keySerial = 0;
  function pedKey(p) {
    if (!p) return null;
    if (p._sid) return "s" + p._sid;
    if (p._runKey) return p._runKey;
    p._runKey = "r" + (++_keySerial);
    return p._runKey;
  }
  // deliberately NON-mutating: this runs from the interaction registry's
  // canShow over every civilian in reach, and minting a key for a stranger
  // you never spoke to would grow the map for nothing.
  function asked(p) {
    if (!p) return true;
    if (p._runAsked) return true;
    if (p._sid) return state().sigs["s" + p._sid] != null;
    if (p._runKey) return state().sigs[p._runKey] != null;
    return false;
  }
  function markAsked(p, signedDay) {
    if (!p) return;
    p._runAsked = true;
    const k = pedKey(p); if (!k) return;
    // > 0 is a signature (stored as day+1 so day zero is not falsy);
    // −1 is a refusal, which still burns your one ask.
    state().sigs[k] = signedDay != null ? (signedDay + 1) : -1;
  }
  function countSigs() {
    const st = state(); const day = worldDay(); let n = 0;
    for (const k in st.sigs) {
      const v = st.sigs[k];
      if (!(v > 0)) continue;
      if (day - (v - 1) > SIG_LIFE_DAYS) { delete st.sigs[k]; continue; }   // signatures go stale
      n++;
    }
    st.sigCount = n;
    return n;
  }
  // the bloc this person is standing in — elections.js's own bloc list, built
  // from the live npcecon cohort table, joined by economy.js's own districtAt.
  function blocForPed(p) {
    if (!p || !p.pos) return null;
    const E = CBZ.elections;
    const rec = runOffice();
    if (!E || !E._buildBlocs || !rec) return null;
    let dk = null;
    if (CBZ.cityEcon && CBZ.cityEcon.districtAt) { try { dk = CBZ.cityEcon.districtAt(p.pos.x, p.pos.z); } catch (e) { dk = null; } }
    if (!dk) return null;
    let blocs = [];
    try { blocs = E._buildBlocs(rec) || []; } catch (e) { blocs = []; }
    for (let i = 0; i < blocs.length; i++) if (blocs[i].id === dk) return blocs[i];
    return null;
  }
  function endorsedBy(p) {
    const st = state();
    if (p && p.gang && st.endorse["g:" + p.gang]) return true;
    if (CBZ.factions && CBZ.factions.of) {
      let list = [];
      try { list = CBZ.factions.of(p) || []; } catch (e) { list = []; }
      for (let i = 0; i < list.length; i++) if (st.endorse["f:" + list[i]]) return true;
    }
    return false;
  }
  function hostileToMe(p) {
    if (!CBZ.factions || !CBZ.factions.hostile || !CBZ.player) return false;
    try { return !!CBZ.factions.hostile(CBZ.player, p); } catch (e) { return false; }
  }

  function canSign(p) {
    if (!CFG.GOV_CANDIDACY) return { ok: false, why: "" };
    const st = state();
    if (!st.filed) return { ok: false, why: "You are not running for anything." };
    if (st.certified) return { ok: false, why: "You already have the signatures you need." };
    if (!p || p.dead || p.vendor) return { ok: false, why: "" };
    if (asked(p)) return { ok: false, why: "You already asked them." };
    // ---- HARD EXCLUSIONS. No platform, no money and no hook clears these.
    if ((g.wanted | 0) > 0) return { ok: false, why: "Nobody signs a petition with sirens behind you.", hard: true };
    if (hostileToMe(p)) return { ok: false, why: "They wear colours that hate yours.", hard: true };
    if ((p.witnessSev | 0) > 0) return { ok: false, why: "They watched you do it.", hard: true };
    const r = CBZ.cityRel ? CBZ.cityRel(p) : null;
    if (r && r.grudge > 45) return { ok: false, why: "You made an enemy of this one already.", hard: true };
    return { ok: true, why: "" };
  }

  // THE VERDICT — no Math.random. Every input is state that already exists.
  function verdict(p) {
    const st = state();
    const bloc = blocForPed(p);
    const blocTax = bloc ? bloc.taxPref : 0;
    const blocPolice = bloc ? bloc.policePref : 0;
    // their OWN wallet is their own tax politics — the same (wealth−0.5)·2
    // band elections.js derives a whole district's taxPref from, applied to
    // one person. A rich man on a poor block is still a rich man, so two
    // people on the same corner can answer differently for a real reason.
    const ownTax = clamp(-1, 1, ((p.wealth != null ? p.wealth : 0.5) - 0.5) * 2);
    const taxPref = 0.5 * blocTax + 0.5 * ownTax;
    const taxTerm = -st.platform.tax * taxPref;
    const polTerm = st.platform.police * blocPolice;
    const agree = taxTerm + polTerm;
    const cred = clamp(0, 1, (g.respect || 0) / RESPECT_FULL);
    // MOOD IS SIGNED. city/social.js:359 declares the scale verbatim:
    // "ped.mood — -1 angry .. 0 neutral .. +1 happy (decays to 0)", and it is
    // initialised to 0. Read as an unsigned 0..1 band it clamped every neutral
    // AND every angry ped to 0 and then charged them (0−0.5)·2 = −1 × the
    // weight — a flat −0.10 on the entire population, all the time, with the
    // "Bad day" refusal line firing for people in a perfectly ordinary mood.
    // Same weight, same ±0.10 range, correct centre.
    const mood = clamp(-1, 1, +p.mood || 0);
    const backed = endorsedBy(p) ? SIG_W_ENDORSE : 0;
    const dirty = clamp(0, 0.30, scandalNow() / 200);
    const score = SIG_BASE + SIG_W_AGREE * agree + SIG_W_CRED * cred
      + SIG_W_MOOD * mood + backed - dirty;

    if (score >= SIG_PASS) {
      let line = "“Alright. Where do I sign?”";
      if (polTerm > 0.15) line = "“More police on this block? Give me the pen.”";
      else if (taxTerm > 0.15) line = st.platform.tax < 0 ? "“You cut my taxes, you get my name.”" : "“Somebody has to pay for it. Fine.”";
      else if (backed) line = "“My people said you were alright.”";
      else if (cred > 0.5) line = "“I know who you are. Sure.”";
      return { sign: true, line: line, why: "", score: score };
    }
    // the refusal names the DOMINANT negative — that one line is the mechanic.
    let why, line;
    if (st.platform.tax === 0 && st.platform.police === 0) {
      why = "You have not pledged anything."; line = "“What do you even stand for?”";
    } else if (taxTerm < -0.05) {
      if (st.platform.tax < 0) { why = "This block does not want your tax cut."; line = "“Tax cuts for who? Not for anybody on this street.”"; }
      else { why = "This block will not pay your taxes."; line = "“You want my taxes AND my signature?”"; }
    } else if (polTerm < -0.05) {
      why = "This block wants more police, not fewer."; line = "“Fewer police? Come stand out here at night.”";
    } else if (dirty > 0.12) {
      why = "The scandal is on the news."; line = "“Not with what they are saying about you.”";
    } else if (cred < 0.15) {
      why = "Nobody knows who you are."; line = "“Never heard of you.”";
    } else if (mood < -0.3) {          // signed scale: below neutral, not below 0.35
      why = "Bad day."; line = "“Not today. Ask someone else.”";
    } else {
      why = "Not convinced."; line = "“I do not sign things.”";
    }
    return { sign: false, line: line, why: why, score: score };
  }

  function sign(p) {
    const gate = canSign(p);
    if (!gate.ok) { if (gate.hard && gate.why) say(p, "“" + gate.why + "”"); return { ok: false, why: gate.why, note: gate.why }; }
    const st = state();
    const v = verdict(p);
    if (CBZ.cityMeet) { try { CBZ.cityMeet(p); } catch (e) {} }   // you learn a name by asking for it
    markAsked(p, v.sign ? worldDay() : null);
    say(p, v.line);
    if (!v.sign) return { ok: false, why: v.why, note: v.line, refused: true, count: st.sigCount, need: st.sigsNeeded };
    countSigs();
    if (CBZ.cityRelShift) { try { CBZ.cityRelShift(p, "helped", 0.25); } catch (e) {} }
    const done = certify();
    return { ok: true, why: "", note: v.line, count: st.sigCount, need: st.sigsNeeded, certified: done || st.certified };
  }

  // ============================================================
  //  THE COALITION
  // ============================================================
  function myGang() {
    if (CBZ.cityEcon && CBZ.cityEcon.playerGangId) { try { return CBZ.cityEcon.playerGangId() || null; } catch (e) {} }
    if (CBZ.cityMembership) { try { const m = CBZ.cityMembership(); return (m && m.gangId) || null; } catch (e) {} }
    return null;
  }
  function zonesOf(gid) {
    if (!CBZ.cityZoneControl || !gid) return 0;
    try { const c = CBZ.cityZoneControl(); return ((c && c.byGang && c.byGang[gid]) | 0); } catch (e) { return 0; }
  }
  function blocList() {
    const out = [];
    if (CBZ.factions && CBZ.factions.all) {
      let fs = [];
      try { fs = CBZ.factions.all() || []; } catch (e) { fs = []; }
      for (let i = 0; i < fs.length; i++) {
        const f = fs[i];
        if (!f || !f.id || f.id === CAMPAIGN_ID) continue;
        out.push({ id: "f:" + f.id, ref: f.id, kind: "faction", name: f.name || f.id });
      }
    }
    const gangs = CBZ.cityGangs || [];
    for (let i = 0; i < gangs.length; i++) {
      const gg = gangs[i];
      if (!gg || !gg.id || gg.absorbed) continue;
      out.push({ id: "g:" + gg.id, ref: gg.id, kind: "gang", name: gg.name || gg.id });
    }
    // standing institutions — offered ONLY if the world actually runs them.
    if (CBZ.cityCops) out.push({ id: "i:police", ref: "police", kind: "institution", name: "The Police Union" });
    if (CBZ.militia && CBZ.militia.list) out.push({ id: "i:garrison", ref: "garrison", kind: "institution", name: "The Garrison" });
    return out;
  }
  function blocById(id) {
    const list = blocList();
    for (let i = 0; i < list.length; i++) if (list[i].id === id || list[i].ref === id) return list[i];
    return null;
  }
  function hookOn(b) {
    const st = state();
    return !!(st.hooks[b.id] || st.hooks[b.ref]);
  }
  // HARD EXCLUSION (Victoria 3's rule, and the only thing that stops a
  // coalition being a shopping list). Returns a WHY, or "" if reachable.
  function blockedWhy(b) {
    if (b.kind === "faction") {
      if (!CBZ.factions) return "";
      const def = CBZ.factions.def ? CBZ.factions.def(b.ref) : null;
      const hostile = (def && def.hostileTo) || [];
      if (CBZ.factions.all && CBZ.factions.isMember) {
        let fs = [];
        try { fs = CBZ.factions.all() || []; } catch (e) { fs = []; }
        for (let i = 0; i < fs.length; i++) {
          const f = fs[i];
          if (!f || f.id === b.ref || !CBZ.factions.isMember(f.id)) continue;
          if (hostile.indexOf(f.id) >= 0) return "You ride with the " + (f.name || f.id) + ". They will never stand next to you.";
          if ((f.hostileTo || []).indexOf(b.ref) >= 0) return "Your own outfit is at war with them.";
        }
      }
      return "";
    }
    if (b.kind === "gang") {
      const mine = myGang();
      if (mine && mine === b.ref) return "";
      if (mine && CBZ.cityAtWar && CBZ.cityAtWar(mine, b.ref)) return "You are at war with them. There is no price.";
      return "";
    }
    if (b.ref === "police") {
      // deliberately NOT blocked on gang membership: a police union endorsing
      // a machine boss it has an arrangement with is the whole genre. It is
      // blocked on the one thing that would actually stop the photograph.
      if ((g.wanted | 0) > 0) return "You are wanted. They will not be photographed with you.";
      return "";
    }
    if (b.ref === "garrison") {
      if ((g.wanted | 0) > 0) return "You are wanted. The garrison does not endorse fugitives.";
      const rec = runOffice();
      // soldiers back a commander-in-chief, not a councilman.
      if (rec && rec.kind === "city") return "A city seat does not command them.";
      return "";
    }
    return "";
  }
  function priceOf(b) {
    let base = BLOC_BASE[b.kind] || BLOC_BASE.faction;
    let mul = 1;
    if (b.kind === "faction" && CBZ.factions) {
      const t = CBZ.factions.tier ? CBZ.factions.tier(b.ref) : -1;
      const L = (CBZ.factions.ladder ? (CBZ.factions.ladder(b.ref) || []).length : 0) || 1;
      if (t >= 0) mul -= 0.5 * ((t + 1) / L);                       // rank IS the discount
      const s = CBZ.factions.standing ? (+CBZ.factions.standing(b.ref) || 0) : 0;
      mul -= 0.10 * clamp(0, 2, s);                                  // contracts you ran for them
    }
    if (b.kind === "gang") {
      const z = zonesOf(b.ref);
      mul += 0.10 * z;                                               // a crew that holds ground charges for it
      const mine = myGang();
      if (mine && mine === b.ref) mul -= 0.6;                        // your own crew
      else if (mine && CBZ.cityAreAllied && CBZ.cityAreAllied(mine, b.ref)) mul -= 0.35;
    }
    if (b.kind === "institution") base = BLOC_BASE.institution;
    if (hookOn(b)) mul *= HOOK_DISCOUNT;                             // dirt halves it. It never buys it.
    return Math.max(Math.round(base * 0.15), Math.round(base * Math.max(0.1, mul)));
  }
  // WHAT AN ENDORSEMENT IS WORTH — a real number off a real thing. A gang's
  // weight is its live turf.js zone count; a faction's is your rank in it.
  function weightOf(b) {
    if (b.kind === "gang") return ENDORSE_GANG + ENDORSE_GANG_ZONE * zonesOf(b.ref);
    if (b.ref === "police") return ENDORSE_POLICE;
    if (b.ref === "garrison") return ENDORSE_GARRISON;
    let frac = 0;
    if (CBZ.factions && CBZ.factions.tier) {
      const t = CBZ.factions.tier(b.ref);
      const L = (CBZ.factions.ladder ? (CBZ.factions.ladder(b.ref) || []).length : 0) || 1;
      if (t >= 0) frac = (t + 1) / L;
    }
    return ENDORSE_FACTION + ENDORSE_FACTION_RANK * frac;
  }
  function blocs() {
    if (!CFG.GOV_CANDIDACY) return [];
    const st = state();
    const list = blocList();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const blocked = blockedWhy(b);
      const have = !!st.endorse[b.id];
      const price = priceOf(b);
      let why = blocked;
      if (!why && have) why = "They already back you.";
      if (!why && !live()) why = "File for something first.";
      if (!why && myTier() < TIER_SEEK) why = "Organizer and up — you have nobody to send.";
      if (!why && hookOn(b)) why = "You have something on them. Half price.";
      out.push({
        id: b.id, ref: b.ref, kind: b.kind, name: b.name,
        have: have, price: price, weight: Math.round(weightOf(b) * 10) / 10,
        blocked: !!blocked, why: why,
      });
    }
    return out;
  }
  function seek(blocId) {
    if (!live()) return { ok: false, why: "You are not running for anything." };
    if (myTier() < TIER_SEEK) return { ok: false, why: "Organizer and up. You have nobody to send." };
    const b = blocById(blocId);
    if (!b) return { ok: false, why: "No such bloc." };
    const st = state();
    if (st.endorse[b.id]) return { ok: false, why: "They already back you." };
    const blocked = blockedWhy(b);
    if (blocked) return { ok: false, why: blocked };
    const price = priceOf(b);
    if (!drawFunds(price)) return { ok: false, why: "That costs " + money(price) + " and the war chest is short." };
    const w = weightOf(b);
    st.endorse[b.id] = { day: worldDay(), weight: Math.round(w * 100) / 100 };
    momentumGain(w, b.name + " endorses you");
    if (b.kind === "faction" && CBZ.factions && CBZ.factions.credit && CBZ.factions.isMember && CBZ.factions.isMember(b.ref)) {
      try { CBZ.factions.credit(b.ref, "orders", 1); } catch (e) {}
    }
    feed(b.name + " endorses " + playerName() + ".", "#8fc1ff");
    return { ok: true, why: "", price: price, weight: w };
  }

  // HOOK — what the courthouse/library desks (city/civic.js) hand you, and
  // what the oppo-research job yields. Keyed by the BARE subject: a ledger sid
  // for a person, a bloc id ("f:cartel"/"g:kings") for an organisation. The
  // two key spaces cannot collide.
  function isRival(key) {
    const rec = runOffice();
    if (rec && rec.office && rec.office.holder && String(rec.office.holder) === key && !isPlayerSid(rec.office.holder)) return true;
    const E = CBZ.elections;
    const pr = (E && E.playerRace) ? E.playerRace() : null;
    if (pr && pr.race && pr.race.candidates) {
      for (let i = 0; i < pr.race.candidates.length; i++) {
        const c = pr.race.candidates[i];
        if (!c.player && String(c.sid) === key) return true;
      }
    }
    return false;
  }
  function hook(sid, info) {
    if (!sid) return { ok: false, why: "No subject." };
    const st = state();
    info = info || {};
    const key = String(sid);
    if (st.hooks[key]) return { ok: false, why: "You already have that file." };
    st.hooks[key] = { kind: info.kind || "dirt", note: info.note || "", day: worldDay() };
    let gained = 0;
    // dirt on the person you are actually running against is oppo research,
    // and momentum is a real term in the real formula. Dirt on anyone else is
    // a discount at the bargaining table (priceOf) and nothing more.
    if (st.filed && isRival(key)) { gained = HOOK_MOMENTUM; momentumGain(gained, "the file on your opponent"); }
    return { ok: true, why: "", momentum: gained, hooks: Object.keys(st.hooks).length };
  }

  // DONATE — always a real wallet transfer. The donor job pays you in cash
  // through mission.js's own reward, then banks that same cash here, so no
  // money is ever conjured.
  function donate(n, why) {
    const st = state();
    n = Math.round(+n || 0);
    if (n <= 0) return { ok: false, why: "Nothing to bank." };
    if (!live()) return { ok: false, why: "There is no campaign to bank it into." };
    if (!CBZ.city || !CBZ.city.spend || !CBZ.city.spend(n)) return { ok: false, why: "You do not have " + money(n) + "." };
    st.warChest += n;
    note("War chest " + money(st.warChest) + (why ? " · " + why : "") + ".", "Treasurer", "messages");
    return { ok: true, why: "", warChest: st.warChest };
  }

  // ============================================================
  //  FRAUD — a crime, capped, and discoverable.
  // ============================================================
  function civicLotNear(kinds) {
    const A = arena(); const p = pos();
    if (!A || !p) return null;
    const lots = (A.shopLots || []).concat(A.lots || []);
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || kinds.indexOf(l.kind) < 0) continue;
      const d = l.building && l.building.door ? l.building.door : l;
      const x = d.x != null ? d.x : l.cx, z = d.z != null ? d.z : l.cz;
      if (x == null || z == null) continue;
      if (d2(p.x, p.z, x, z) <= RIG_RADIUS) return { lot: l, x: x, z: z };
    }
    return null;
  }
  function rigKinds() {
    const out = [];
    for (const k in RIGS) {
      const R = RIGS[k];
      const at = civicLotNear(R.at);
      out.push({
        kind: k, label: R.label, cost: R.cost, fraud: R.fraud,
        ok: !!at && live() && ballotReady() && myTier() >= TIER_RIG,
        why: !live() ? "You are not running for anything."
          : !ballotReady() ? "You are not on the ballot yet."
            : myTier() < TIER_RIG ? "Operative and up. You do not know which counter takes money."
              : !at ? "You have to be at the counter." : "",
      });
    }
    return out;
  }
  function rig(kind) {
    const R = RIGS[kind];
    if (!R) return { ok: false, why: "That is not a thing you can rig." };
    const st = state();
    if (!live()) return { ok: false, why: "You are not running for anything." };
    if (!ballotReady()) return { ok: false, why: "You are not on the ballot yet." };
    if (myTier() < TIER_RIG) return { ok: false, why: "Operative and up. You do not know which counter takes money." };
    if (st.fraud >= FRAUD_CAP) return { ok: false, why: "There is only so much you can move without it being obvious." };
    const at = civicLotNear(R.at);
    if (!at) return { ok: false, why: "You have to be standing at the counter." };
    if (!drawFunds(R.cost)) return { ok: false, why: R.label + " costs " + money(R.cost) + " and the war chest is short." };
    st.fraud = Math.min(FRAUD_CAP, st.fraud + R.fraud);
    // ONE path for corruption/scandal/heat, and it is the existing one
    // (city/worldstate.js's politics event — the same call activities.js's
    // "Corrupt Permit Deal" makes). We do not own a second scandal number.
    if (CBZ.cityEvent) {
      try {
        CBZ.cityEvent("politics", {
          corruption: R.corruption, scandal: R.scandal, political: -2,
          // "extortion" is wanted.js's nearest LIVE crime key. `corruption` is
          // not in its CRIME table, so crimeInfo() returned {stars:0} and
          // report() bailed before any heat — crimeHeat was a silent no-op and
          // the "real heat" claim above was false. Never invent a type.
          crimeHeat: R.heat, crimeType: "extortion", x: at.x, z: at.z,
          message: "Money moved through the election office.",
        });
      } catch (e) {}
    }
    note(R.line, "Fixer", "messages");
    return { ok: true, why: "", fraud: st.fraud, cost: R.cost };
  }
  // DISCOVERY. Deterministic (CBZ.hash01 over scandal+day — there is no
  // Math.random anywhere near a vote) and it costs strictly more than the
  // fraud bought: −2 momentum per fraud point, plus real approval damage on
  // the seat, plus a fresh scandal and a fresh warrant.
  function fraudCheck(day) {
    const st = state();
    if (st.fraud <= 0 || st.exposed || !live()) return;
    const sc = scandalNow();
    if (sc < EXPOSE_FLOOR) {
      const roll = CBZ.hash01 ? CBZ.hash01(Math.round(sc), day, 7717) : 1;
      if (roll >= sc / 160) return;
    }
    const bought = st.fraud;
    st.fraud = 0;
    st.exposed = true;
    momentumGain(-(2 * bought + 4), "the rigging came out");
    const seat = runOfficeId();
    if (CBZ.approvalShock && seat) { try { CBZ.approvalShock(seat, -10); } catch (e) {} }
    if (CBZ.cityEvent) {
      try {
        CBZ.cityEvent("politics", {
          // see rig(): "corruption" is not a live wanted.js CRIME key.
          scandal: 12, political: -8, crimeHeat: 160, crimeType: "extortion",
          message: "Ballot fraud traced back to a campaign.",
        });
      } catch (e) {}
    }
    big("BALLOT FRAUD EXPOSED");
    feed("Ballot fraud traced to " + playerName() + "'s campaign.", "#ff6a5e");
  }

  // ============================================================
  //  THE CAMPAIGN FACTION — one declaration, and factions.js owns the
  //  membership, the ladder, the promotions and the payroll. Every rung
  //  unlocks a VERB (CLAUDE.md law), never just a bigger number:
  //    Volunteer   canvass  (sign)
  //    Organizer   bargain  (seek — you have people to send to a bloc)
  //    Operative   rig      (you know which counter takes money)
  //    Machine Boss         the platform width opens from ±0.5 to ±1.0 —
  //                         a full-throated promise, and a real doubling of
  //                         the platformDot term in scoreCandidate().
  // ============================================================
  const RANKS = [
    { key: "volunteer", pip: "Volunteer", tier: 0, need: {} },
    { key: "organizer", pip: "Organizer", tier: 1, need: { orders: 1, contrib: 5000 } },
    { key: "operative", pip: "Operative", tier: 2, need: { orders: 3, contrib: 25000 } },
    { key: "boss", pip: "Machine Boss", tier: 3, need: { orders: 6, contrib: 80000 } },
  ];
  let _declared = false;
  function declareCampaign() {
    if (_declared || !CBZ.factions || !CBZ.factions.declare) return _declared;
    if (CBZ.factions.exists && CBZ.factions.exists(CAMPAIGN_ID)) { _declared = true; return true; }
    try {
      CBZ.factions.declare({
        id: CAMPAIGN_ID, name: "The Campaign", short: "CAMPAIGN", kind: "org",
        color: 0x8fc1ff, ranks: RANKS, admission: {}, wage: 0, heat: 1,
        lore: "A storefront, a folding table and a stack of petitions. Every rung buys a verb: "
          + "Volunteers knock doors, Organizers cut deals with blocs, Operatives know which "
          + "counter takes money, and a Machine Boss can promise the whole thing out loud.",
      });
      _declared = true;
    } catch (e) { _declared = false; }
    return _declared;
  }
  function joinCampaign() {
    if (!declareCampaign() || !CBZ.factions || !CBZ.factions.join) return;
    if (CBZ.factions.isMember && CBZ.factions.isMember(CAMPAIGN_ID)) return;
    try { CBZ.factions.join(CAMPAIGN_ID, "filed", { force: true }); } catch (e) {}
  }
  function order() {
    if (CBZ.factions && CBZ.factions.credit && CBZ.factions.isMember && CBZ.factions.isMember(CAMPAIGN_ID)) {
      try { CBZ.factions.credit(CAMPAIGN_ID, "orders", 1); } catch (e) {}
    }
  }

  // ============================================================
  //  WORLD BINDERS for the campaign jobs. contracts.js's rule is binding:
  //  the generator picks the VERB, the WORLD supplies the SPECIFICS. Nothing
  //  below spawns anything, and a job whose binder returns null is not
  //  offered at all.
  // ============================================================
  function cityHallDoor() {
    const A = arena(); if (!A) return null;
    const lots = (A.shopLots || A.lots || []);
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l && l.kind === "cityhall" && l.building && l.building.door) return l.building.door;
    }
    return null;
  }
  function officialPed(sid) {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._sid === sid) return peds[i];
    return null;
  }
  // the real park/plaza the rally happens on — a lot the world already built.
  function plazaSpot() {
    const A = arena(); if (!A) return null;
    const door = cityHallDoor();
    const lots = A.lots || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.kind !== "park" || l.cx == null) continue;
      const d = door ? d2(l.cx, l.cz, door.x, door.z) : 0;
      if (d < bd) { bd = d; best = l; }
    }
    if (best) return { x: best.cx, z: best.cz, name: best.name || "the park" };
    if (door) return { x: door.x + 18, z: door.z + 18, name: "City Hall plaza" };
    return null;
  }
  // A HECKLER IS A REAL PED ALREADY THERE who has reason to hate you. Nothing
  // is spawned for the rally; if nobody in the world resents you, nobody
  // heckles, and the rally is easy. That is correct.
  function heckler(spot) {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos) continue;
      if (d2(p.pos.x, p.pos.z, spot.x, spot.z) > 9) continue;
      const r = CBZ.cityRel ? CBZ.cityRel(p) : null;
      if ((r && r.grudge > 30) || hostileToMe(p)) return p;
    }
    return null;
  }
  // the man you are running against, resolved off the LIVE polity record.
  function rivalOfficial() {
    const rec = runOffice();
    if (!rec || !rec.office || !rec.office.holder) return null;
    const sid = rec.office.holder;
    if (isPlayerSid(sid)) return null;
    const door = cityHallDoor(); if (!door) return null;
    let id = null;
    try { id = CBZ.officials && CBZ.officials.identityOf ? CBZ.officials.identityOf(sid) : null; } catch (e) { id = null; }
    if (!id || !id.name) return null;
    return { sid: sid, rec: rec, name: id.name, title: titleOf(rec), door: door };
  }
  // a real district OTHER than the one you are standing in, with the real
  // population share that decides what the trip is worth.
  function gotvTarget() {
    const E = CBZ.elections; const A = arena(); const p = pos();
    const rec = runOffice();
    if (!E || !E._buildBlocs || !A || !p || !rec) return null;
    let blocs = [];
    try { blocs = E._buildBlocs(rec) || []; } catch (e) { blocs = []; }
    if (!blocs.length) return null;
    let total = 0;
    for (let i = 0; i < blocs.length; i++) total += blocs[i].pop || 0;
    if (total <= 0) return null;
    let here = null;
    if (CBZ.cityEcon && CBZ.cityEcon.districtAt) { try { here = CBZ.cityEcon.districtAt(p.x, p.z); } catch (e) { here = null; } }
    // pick a REAL LOT that sits in that district — never a formula-derived
    // point. If no lot in the arena lands there, the district cannot be
    // canvassed and the job is not offered.
    const lots = A.lots || [];
    for (let bi = 0; bi < blocs.length; bi++) {
      const b = blocs[bi];
      if (!b || b.id === here) continue;
      for (let i = 0; i < lots.length; i++) {
        const l = lots[i];
        if (!l || l.cx == null) continue;
        let dk = null;
        if (CBZ.cityEcon && CBZ.cityEcon.districtAt) { try { dk = CBZ.cityEcon.districtAt(l.cx, l.cz); } catch (e) { dk = null; } }
        if (dk !== b.id) continue;
        if (d2(l.cx, l.cz, p.x, p.z) < 60) continue;   // it has to be a trip
        return { x: l.cx, z: l.cz, id: b.id, name: b.name || b.id, share: (b.pop || 0) / total };
      }
    }
    return null;
  }
  // a wealthy NPC the world already spawned. vips.js stamps vipTitle; every
  // ped carries a real `wealth`. Nothing is minted for a donor.
  function richNpc() {
    const peds = CBZ.cityPeds || [];
    let best = null, bw = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.vendor || !p.pos) continue;
      const w = p.vipTitle ? Math.max(0.9, +p.wealth || 0.9) : (+p.wealth || 0);
      if (w < 0.85 || w <= bw) continue;
      if (hostileToMe(p)) continue;
      bw = w; best = p;
    }
    return best;
  }
  // a live gang member of a crew that is NOT backing you and that holds real
  // ground. If no such person is walking around, there is nobody to lean on
  // and the job is not offered.
  function rivalBacker() {
    const st = state();
    const peds = CBZ.cityPeds || [];
    const mine = myGang();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos || !p.gang) continue;
      if (mine && p.gang === mine) continue;
      if (st.endorse["g:" + p.gang]) continue;
      if (zonesOf(p.gang) < 1) continue;
      return p;
    }
    return null;
  }

  // ============================================================
  //  THE JOBS — CBZ.mission.offer, on the EXISTING order board. One call
  //  each buys completion detection, the HUD distance line, the map
  //  waypoint, the world beacon, the phone card and the payout.
  // ============================================================
  let _offered = false;
  function offerJobs() {
    if (_offered || !CBZ.mission || !CBZ.mission.offer) return;
    if (!declareCampaign()) return;
    _offered = true;
    const M = CBZ.mission;

    /* --- THE RALLY: a real plaza, real hecklers, momentum not cash ------- */
    M.offer({
      id: "run:rally", faction: CAMPAIGN_ID, minRank: 0, title: "Hold a rally",
      giver: "CAMPAIGN", pay: 0,
      canOffer: function () { return live() && !!plazaSpot(); },
      build: function () {
        const spot = plazaSpot(); if (!spot) return null;
        const HOLD = 40;
        return {
          title: "Hold a rally", targetName: spot.name, locationName: spot.name,
          brief: "Get up on the steps at " + spot.name + " and talk for as long as they will listen. "
            + "Anybody in that crowd with a reason to hate you will make it their business.",
          reward: { cash: 0, respect: 8 }, color: 0x8fc1ff, limit: 600,
          stages: [
            { id: "go", goal: "reach", at: { x: spot.x, z: spot.z }, radius: 14, text: "Get to " + spot.name, label: String(spot.name).toUpperCase() },
            {
              id: "speak", goal: "custom", at: { x: spot.x, z: spot.z }, label: "SPEAK", text: "Hold the crowd",
              onEnter: function (m, st) { st._held = 0; st._lt = 0; },
              done: function (m, st) {
                const P = CBZ.player; if (!P) return false;
                const dt = clamp(0, 0.25, (st.t || 0) - (st._lt || 0)); st._lt = st.t || 0;
                const near = d2(P.pos.x, P.pos.z, spot.x, spot.z) < 16;
                const h = heckler(spot);
                st._held = (near && !h) ? (st._held || 0) + dt : Math.max(0, (st._held || 0) - dt * (h ? 2 : 1.5));
                m.progress(Math.min(1, (st._held || 0) / HOLD));
                return (st._held || 0) >= HOLD;
              },
            },
          ],
          doneText: "They stayed to the end of it.",
          failText: "You lost the crowd.",
          onComplete: function () { momentumGain(RALLY_MOMENTUM, "the rally at " + spot.name); order(); },
        };
      },
    });

    /* --- OPPO RESEARCH: the REAL incumbent, at his REAL building --------- */
    M.offer({
      id: "run:oppo", faction: CAMPAIGN_ID, minRank: 1, title: "Oppo research",
      giver: "CAMPAIGN", pay: 0,
      canOffer: function () { return live() && !!rivalOfficial(); },
      build: function () {
        const o = rivalOfficial(); if (!o) return null;
        const HOLD = 22;
        return {
          title: "Oppo research", targetName: o.title + " " + o.name, locationName: "City Hall",
          brief: o.title + " " + o.name + " keeps his own paperwork in that building, and he keeps "
            + "his own hours: 09:00-17:00 inside, 17:00-19:00 on the plaza. Get near enough to read it.",
          reward: { cash: 0, respect: 6 }, color: 0xffd76a, limit: 900,
          stages: [
            { id: "in", goal: "reach", at: o.door, radius: 20, text: "Get to City Hall", label: "CITY HALL" },
            {
              id: "file", goal: "custom", label: "THE FILE", text: "Find something on " + o.name,
              // live re-resolve — the door until officials.js puts him on his
              // feet, then the man, exactly as the assassination contract does.
              at: function () { return officialPed(o.sid) || o.door; },
              onEnter: function (m, st) { st._held = 0; st._lt = 0; },
              done: function (m, st) {
                const P = CBZ.player; if (!P) return false;
                const dt = clamp(0, 0.25, (st.t || 0) - (st._lt || 0)); st._lt = st.t || 0;
                const ped = officialPed(o.sid);
                const tx = ped && ped.pos ? ped.pos.x : o.door.x;
                const tz = ped && ped.pos ? ped.pos.z : o.door.z;
                const close = d2(P.pos.x, P.pos.z, tx, tz) < (ped ? 10 : 9);
                st._held = close ? (st._held || 0) + dt : Math.max(0, (st._held || 0) - dt);
                m.progress(Math.min(1, (st._held || 0) / HOLD));
                return (st._held || 0) >= HOLD;
              },
            },
          ],
          doneText: "You have a file on him now.",
          failText: "Nothing usable.",
          onComplete: function () {
            hook(o.sid, { kind: "oppo", note: "Oppo file on " + o.title + " " + o.name });
            order();
          },
        };
      },
    });

    /* --- GET OUT THE VOTE: a real district, paid by its real population --- */
    M.offer({
      id: "run:gotv", faction: CAMPAIGN_ID, minRank: 0, title: "Get out the vote",
      giver: "CAMPAIGN", pay: 0,
      canOffer: function () { return live() && !!gotvTarget(); },
      build: function () {
        const t = gotvTarget(); if (!t) return null;
        return {
          title: "Get out the vote", targetName: t.name, locationName: t.name,
          brief: "Nobody in " + t.name + " is going to walk to a polling place on their own. "
            + "Go and knock on doors. That district is " + Math.round(t.share * 100) + "% of the electorate.",
          reward: { cash: 0, respect: 4 }, color: 0x8fe08a, limit: 900,
          stages: [
            { id: "walk", goal: "deliver", at: { x: t.x, z: t.z }, radius: 16, text: "Knock doors in " + t.name, label: String(t.name).toUpperCase() },
          ],
          doneText: "That district will show up.",
          onComplete: function () { momentumGain(GOTV_BASE + GOTV_POP * t.share, "turnout in " + t.name); order(); },
        };
      },
    });

    /* --- THE DONOR: a real wealthy NPC, real cash into the war chest ------ */
    M.offer({
      id: "run:donor", faction: CAMPAIGN_ID, minRank: 1, title: "The donor",
      giver: "CAMPAIGN", pay: 0,
      canOffer: function () { return live() && !!richNpc(); },
      build: function () {
        const p = richNpc(); if (!p) return null;
        const amount = Math.max(4000, Math.round((+p.wealth || 0.9) * 20000));
        const who = p.name || p.vipTitle || "the donor";
        return {
          title: "The donor", targetName: who, locationName: "wherever they are standing",
          brief: who + " has money and an opinion. Go and be charming about it. "
            + "The cheque goes straight into the war chest.",
          reward: { cash: amount, respect: 2 }, color: 0xffd166, limit: 600,
          stages: [
            { id: "meet", goal: "reach", radius: 5, text: "Meet " + who, label: String(who).toUpperCase(),
              at: function () { return (p && !p.dead) ? p : null; } },
          ],
          failIf: function () { return (p && p.dead) ? "your donor is dead" : null; },
          doneText: "Banked.",
          // mission.js pays the cash into the wallet; donate() moves that same
          // cash into the chest. No money is conjured at any point.
          onComplete: function () { donate(amount, "a cheque from " + who); order(); },
        };
      },
    });

    /* --- THE DIRTY ONE: every clean verb needs its malicious twin -------- */
    M.offer({
      id: "run:leanon", faction: CAMPAIGN_ID, minRank: 2, title: "Lean on a backer",
      giver: "CAMPAIGN", pay: 0,
      canOffer: function () { return live() && !!rivalBacker(); },
      build: function () {
        const p = rivalBacker(); if (!p) return null;
        const who = p.name || "him";
        return {
          title: "Lean on a backer", targetName: who, locationName: "the street",
          brief: who + " is handing out flyers for the other side. Make him stop. "
            + "Frighten him, do not bury him — a body is not a message, it is a headline.",
          reward: { cash: 0, respect: 10, notoriety: 60 }, color: 0xff6a5e, limit: 600,
          stages: [
            { id: "lean", goal: "custom", label: String(who).toUpperCase(), text: "Make " + who + " fold",
              at: function () { return (p && !p.dead) ? p : null; },
              done: function () {
                if (!p || p.dead) return false;
                if (p.surrender) return true;
                const r = CBZ.cityRel ? CBZ.cityRel(p) : null;
                return !!(r && r.fear >= 40);
              } },
          ],
          failIf: function () { return (p && p.dead) ? "you killed him — that is a body, not a message" : null; },
          doneText: "He will not be handing out flyers again.",
          failText: "Badly done.",
          onComplete: function () {
            momentumGain(LEAN_MOMENTUM, "one fewer voice for the other side");
            if (CBZ.cityEvent) {
              try {
                CBZ.cityEvent("politics", {
                  // "intimidation" is not a live wanted.js CRIME key; "extortion" is.
                  scandal: 10, political: -3, crimeHeat: 70, crimeType: "extortion",
                  x: p.pos ? p.pos.x : undefined, z: p.pos ? p.pos.z : undefined,
                  message: "A campaign volunteer was leaned on in the street.",
                });
              } catch (e) {}
            }
            order();
          },
        };
      },
    });
  }

  // ============================================================
  //  THE PETITION VERB — the one on-screen control this file adds, and it
  //  joins the ONE registry (interactions.js) like everything else.
  //
  //  SLOT J, NOT K, AND THE REASON IS THE WHOLE MECHANIC. K is the busiest
  //  key on a civilian: interact.js holds it at prio 36-60 for Chat up (36,
  //  and `cityIsRomance` is a WIDE net), Recruit, Hire, Sell product, Shake
  //  down, Put in work, Follow me. Slot exclusivity means the highest passing
  //  option OWNS the key — so on K this verb was invisible on every civilian
  //  you could flirt with, hire, recruit or lean on, which is a large slice
  //  of the street. That is fatal to the one step of the arc that is supposed
  //  to be hard-but-doable: twelve signatures from strangers. Raising the
  //  priority is worse, because it would delete Chat up and Recruit from the
  //  whole game for as long as a campaign is open.
  //
  //  On J at prio 30 the only thing it outranks is interact.js's `ped-swing`
  //  ("Swing on", prio 10) — the malicious default, which stays reachable by
  //  simply throwing the punch and is untouched on the gunpoint card. It
  //  still loses to `ped-hold-corner` (60) and `ped-put-in-work` (50), both
  //  of which gate on your own gang, so your lieutenant's J still means what
  //  it meant. And it only exists at all while a petition is genuinely live.
  //
  //  The option shows for ANY plain civilian while a petition is live —
  //  including the ones who will refuse — because the refusal line IS the
  //  mechanic and hiding it would hide the game.
  // ============================================================
  let _wired = false;
  function wireInteractions() {
    if (_wired || !CBZ.interactions || !CBZ.interactions.register) return;
    _wired = true;
    CBZ.interactions.register("ped:civ", {
      id: "run-sign", slot: "j", prio: 30,
      canShow: function (p) {
        if (!CFG.GOV_CANDIDACY) return false;
        const st = state();
        if (!st.filed || st.certified) return false;
        if (!p || p.dead || p.vendor) return false;
        return !asked(p);
      },
      label: function () { const st = state(); return "Ask to sign (" + st.sigCount + "/" + st.sigsNeeded + ")"; },
      onSelect: function (p) { sign(p); },
    });
  }

  // ============================================================
  //  THE CLOCK — one CBZ.onNewDay tick. elections.js registered its own
  //  subscriber at parse time, strictly before ours, so on any given day the
  //  race has ALREADY been called, campaigned or resolved by the time we
  //  look at it. That ordering is what lets us read the outcome off the live
  //  polity record instead of inventing a callback elections.js would have
  //  to fire.
  // ============================================================
  function pollNote(pr) {
    if (pr.me == null) return;
    if (pr.daysLeft <= 1) note("Polls close tomorrow. You are on " + pr.me + "%.", "Campaign", "news");
    else note("Latest poll has you on " + pr.me + "%. " + pr.daysLeft + " days.", "Campaign", "news");
  }
  // closeRun() blanks the whole run, so anything that must SURVIVE the
  // outcome (which seat we are now talking about) is re-stamped after it.
  function endRun(seatId) {
    closeRun();
    if (seatId) state().officeId = seatId;
  }
  function winRun(rec, defended) {
    const st = state();
    st.runs = (st.runs | 0) + 1; st.wins = (st.wins | 0) + 1;
    const runs = st.runs, wins = st.wins;
    // elections.js already fired the ELECTED headline and the feed line —
    // never print a second one (HUD doctrine: one voice per event).
    note(defended
      ? "Re-elected " + titleOf(rec) + " of " + rec.name + ". Another term."
      : "Sworn in as " + titleOf(rec) + " of " + rec.name + ". The office is yours; so is everything that comes for it.",
      "City Clerk", "messages");
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(defended ? Math.round(WIN_RESPECT / 2) : WIN_RESPECT);
    endRun(rec.id);
    const n = state(); n.runs = runs; n.wins = wins;
  }
  function loseRun(rec) {
    const st = state();
    const spent = st.spent, runs = (st.runs | 0) + 1, wins = st.wins | 0;
    note("You lost the race for " + titleOf(rec) + " of " + rec.name + ". " + money(spent)
      + " and every signature, gone. File again next term.", "Campaign", "messages");
    endRun(null);
    const n = state(); n.runs = runs; n.wins = wins;
  }
  function lostSeat(rec) {
    const st = state();
    const runs = (st.runs | 0) + 1, wins = st.wins | 0;
    note("Voted out as " + titleOf(rec) + " of " + rec.name + ". You are a private citizen again.",
      "City Clerk", "messages");
    endRun(null);
    const n = state(); n.runs = runs; n.wins = wins;
  }
  function missRun(rec) {
    const st = state();
    const short = Math.max(0, st.sigsNeeded - st.sigCount);
    const runs = (st.runs | 0) + 1, wins = st.wins | 0;
    note("Nomination closed " + short + " signature" + (short === 1 ? "" : "s") + " short. Your name is not on the ballot.",
      "City Clerk", "messages");
    endRun(null);
    const n = state(); n.runs = runs; n.wins = wins;
  }
  function dayTick(day) {
    if (!CFG.GOV_CANDIDACY) return;
    const st = state();
    const held = heldRec();
    // holding a seat IS a live political position — the sitting player
    // defends it through this same machinery (elections.js's
    // incumbentCandidate() reads playerCandidateRecord() for a player holder).
    if (held && !st.filed) st.officeId = held.id;
    if (!st.filed && !held && !st.onBallot) return;
    // idempotent: a restored save can carry a live run whose membership never
    // landed (factions.js's own store is not on worldstate's whitelist yet).
    joinCampaign();

    if (st.filed) { countSigs(); certify(); }   // stale signatures fall off, a fresh one may qualify you
    fraudCheck(day);

    const E = CBZ.elections;
    const pr = (E && E.playerRace) ? E.playerRace() : null;
    if (pr) { st.onBallot = true; pollNote(pr); return; }

    const P = polity();
    const rec = P && st.officeId ? P.get(st.officeId) : null;
    if (!rec || !rec.office) { if (st.filed) endRun(null); return; }

    if (st.onBallot) {
      // a race we were standing in has resolved (elections.js's onNewDay
      // subscriber was registered before ours, so it has already run today).
      const defended = !st.filed;
      st.onBallot = false;
      if (isPlayerSid(rec.office.holder)) { winRun(rec, defended); return; }
      if (defended) { lostSeat(rec); return; }
      loseRun(rec); return;
    }
    // never made the ballot: nomination closed under us. resolve() only moves
    // termDay AFTER an election, so this window is unambiguous.
    if (st.filed && rec.office.termDay != null && day >= rec.office.termDay - 2 && !st.certified) missRun(rec);
  }

  // ============================================================
  //  PERMADEATH SWEEP — CBZ.mission.onInterrupt is the ONE death/arrest/
  //  mode-exit sweeper in the repo and it already fails the live campaign
  //  jobs. All this adds is: the run itself dies with you. Succession for a
  //  player who was already IN office is city/officials.js's job and runs
  //  independently of this — the deputy is sworn in whether or not this file
  //  is loaded.
  // ============================================================
  let _swept = false;
  function wireSweeper() {
    if (_swept || !CBZ.mission || !CBZ.mission.onInterrupt) return;
    _swept = true;
    CBZ.mission.onInterrupt(function (reason) {
      if (reason !== "death") return;
      const st = state();
      if (!st.filed && !st.officeId) return;
      // a filed candidacy dies with you: pull the pledge so elections.js does
      // not call a race against a name that is not coming, and count the run.
      if (st.filed) { unpledge(); st.runs = (st.runs | 0) + 1; }
      // a seat you HELD is not ours to release — officials.js's own
      // cityKillPlayer wrap has already sworn your deputy in. All we clear is
      // the campaign that was riding on top of it, so nothing strands.
      endRun(null);
    });
  }

  // ============================================================
  //  THE RATCHET (BLOCK LAW #5) — the count of campaign levers that move NO
  //  real number. Pin at 0. A lever that is switched OFF is not a fiction;
  //  a lever that is REACHABLE while the thing it claims to move is absent
  //  is exactly the "stat fiction" CLAUDE.md bans, and that is what this
  //  counts. Adding a lever without naming its sink makes this go up.
  // ============================================================
  function tallyLive() { return !!(CBZ.elections && CBZ.elections._tally); }
  const LEVERS = [
    { id: "file", needsElections: true, writes: "the filing fee out of g.cash, and race.pledged in elections.js",
      real: function () { return !!(CBZ.city && CBZ.city.spend) && !!elections(); } },
    { id: "sign", needsElections: true, writes: "sigCount, which gates certify() -> race.pledged -> your name on the ballot",
      real: function () { return !!elections() && !!CBZ.interactions; } },
    { id: "pledge", needsElections: true, writes: "platform.tax/.police -> the platformDot term in scoreCandidate()",
      real: tallyLive },
    { id: "seek", needsElections: true, writes: "momentum -> scoreCandidate(), paid for with real cash",
      real: function () { return tallyLive() && !!(CBZ.city && CBZ.city.spend); } },
    { id: "hook", needsElections: false, writes: "the bloc price in priceOf(), and momentum on a file about your rival",
      real: function () { return true; } },
    { id: "donate", needsElections: false, writes: "warChest — whose ONLY exits are seek() and rig()",
      real: function () { return !!(CBZ.city && CBZ.city.spend); } },
    { id: "rig", needsElections: true, writes: "fraud -> scoreCandidate(), plus real heat and real scandal via cityEvent",
      real: function () { return tallyLive() && typeof CBZ.cityEvent === "function"; } },
    { id: "momentumGain", needsElections: true, writes: "momentum -> scoreCandidate()", real: tallyLive },
    { id: "spent", needsElections: false, writes: "the campaign faction's contrib credit, which gates the ranks that gate seek/rig/platform width",
      real: function () { return !!(CBZ.factions && CBZ.factions.credit); } },
  ];
  function leverOn(L) {
    if (!CFG.GOV_CANDIDACY) return false;
    if (L.needsElections && !elections()) return false;
    return true;
  }
  function audit() {
    let n = 0;
    for (let i = 0; i < LEVERS.length; i++) { const L = LEVERS[i]; if (leverOn(L) && !L.real()) n++; }
    return n;
  }
  audit.detail = function () {
    const dead = [], ok = [], off = [];
    for (let i = 0; i < LEVERS.length; i++) {
      const L = LEVERS[i];
      if (!leverOn(L)) { off.push(L.id); continue; }
      (L.real() ? ok : dead).push(L.id + " -> " + L.writes);
    }
    return { fictions: dead.length, dead: dead, real: ok, disabled: off };
  };

  // ============================================================
  //  SWEAR-IN — the origin fast-forward. "The President" story starts a run
  //  already holding the country seat, and this is the ONE sanctioned way in:
  //  the exact bookkeeping elections.js's resolve() performs on a won ballot
  //  (holder -> the player sentinel; the outgoing holder's ledger job reverts
  //  to "politician", never dies; termDay restarts on officials.js's own
  //  exported term axis), done by THIS file because player-as-officeholder is
  //  this file's remit. Nothing anywhere writes a parallel holder field — a
  //  presidency reached here and one reached through a real election are the
  //  same state, read by the same statecraft/elections/officials code.
  // ============================================================
  function swearIn(officeId, opts) {
    opts = opts || {};
    if (!CFG.GOV_CANDIDACY) return { ok: false, why: "Candidacy is switched off." };
    const P = polity();
    const rec = P && P.get ? P.get(officeId) : null;
    if (!rec || !rec.office) return { ok: false, why: "No such seat." };
    if (rec.govType === "monarchy") return { ok: false, why: "A crown is not sworn in." };
    if (isPlayerSid(rec.office.holder)) return { ok: false, why: "You already hold it." };
    const d = worldDay();
    const outSid = rec.office.holder;
    if (outSid && CBZ.cityLedgerEntry) {
      const e = CBZ.cityLedgerEntry(outSid);
      if (e) e.job = "politician";
    }
    const sid = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
    rec.office.holder = sid;
    rec.vacuum = null;
    const term = (CBZ.officials && CBZ.officials.termDaysFor) ? CBZ.officials.termDaysFor(rec)
      : (rec.kind === "country" ? 28 : rec.kind === "city" ? 7 : 14);
    rec.office.termDay = d + term;
    const st = state();
    st.officeId = rec.id;
    st.wins = (st.wins | 0) + 1; st.runs = (st.runs | 0) + 1;
    if (!opts.quiet) feed(playerName() + " is sworn in as " + titleOf(rec) + " of " + rec.name + ".", "#8fe08a");
    return { ok: true, why: "", officeId: rec.id, termDay: rec.office.termDay };
  }

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.cityRun = {
    state: state,
    live: live,
    offices: offices,
    file: file,
    swearIn: swearIn,
    withdraw: withdraw,
    pledge: pledgePlatform,
    canSign: canSign,
    sign: sign,
    blocs: blocs,
    seek: seek,
    hook: hook,
    donate: donate,
    rig: rig,
    rigs: rigKinds,                 // what can be rigged HERE, and why not
    poll: function () {
      const E = CBZ.elections;
      const pr = (E && E.playerRace) ? E.playerRace() : null;
      if (!pr || !pr.poll) return null;
      return { aPct: pr.poll.aPct, bPct: pr.poll.bPct, me: pr.me, daysLeft: pr.daysLeft };
    },
    momentumGain: momentumGain,
    // convenience for the civic desk / the council chamber: open THIS
    // campaign's rows on the shared order board rather than making every
    // caller remember the faction id.
    board: function () { return CBZ.cityOrderBoard ? CBZ.cityOrderBoard(CAMPAIGN_ID) : null; },
    ranks: function () { return RANKS.slice(); },
    tier: myTier,
    platformLimit: platformLimit,
    audit: audit,
    reset: function () { g.cityRun = blank(); _keySerial = 0; },
    FACTION: CAMPAIGN_ID,
  };
  CBZ.candidacyAudit = audit;
  CBZ.cityRunReset = CBZ.cityRun.reset;

  // ============================================================
  //  WIRING — deps parse after us in some load orders and other agents are
  //  live in this tree, so everything is registered lazily and RETRIED from
  //  one cheap tick. 38.62 sits in the interactions band, right after
  //  interactions_rich's own registration window.
  // ============================================================
  let _dayWired = false;
  function wireDayTick() {
    if (_dayWired || !CBZ.onNewDay) return;
    _dayWired = true;
    CBZ.onNewDay(function (day) {
      try { dayTick(day); } catch (e) { try { console.error("[candidacy] day tick failed", e); } catch (e2) {} }
    });
  }
  if (CBZ.onUpdate) {
    CBZ.onUpdate(38.62, function () {
      if (!g || g.mode !== "city" || !CFG.GOV_CANDIDACY) return;
      wireInteractions();
      wireDayTick();
      wireSweeper();
      declareCampaign();
      offerJobs();
    });
  }

  // ============================================================
  //  SINGLE-PLAYER PERSIST — elections.js:805's pattern, VERBATIM, including
  //  the one-shot install boolean. (The old guard checked the module flag on
  //  the CURRENT top-of-chain function, so once a later module wrapped above
  //  us the flag vanished from the top and we re-wrapped every tick; ~20
  //  such modules grew the commit chain without bound and overflowed the
  //  stack on save. A module-local boolean wraps exactly once, ever.)
  //  Own guard flag: _runWrap. Ledger slot: blob.run. Tick 46.13 — the next
  //  free slot after elections.js's 46.11.
  // ============================================================
  function serialize() {
    const st = state();
    const sigs = {};
    for (const k in st.sigs) sigs[k] = st.sigs[k];
    const endorse = {};
    for (const k in st.endorse) { const e = st.endorse[k]; endorse[k] = { day: e.day | 0, weight: +e.weight || 0 }; }
    const hooks = {};
    for (const k in st.hooks) { const h = st.hooks[k]; hooks[k] = { kind: String(h.kind || "dirt"), note: String(h.note || ""), day: h.day | 0 }; }
    return {
      v: 1, filed: !!st.filed, certified: !!st.certified, onBallot: !!st.onBallot,
      officeId: st.officeId || null, filedDay: st.filedDay | 0,
      platform: { tax: +st.platform.tax || 0, police: +st.platform.police || 0 },
      momentum: +st.momentum || 0, fraud: +st.fraud || 0, warChest: +st.warChest || 0,
      exposed: !!st.exposed, sigs: sigs, sigCount: st.sigCount | 0, sigsNeeded: st.sigsNeeded | 0,
      endorse: endorse, hooks: hooks, spent: +st.spent || 0, wins: st.wins | 0, runs: st.runs | 0,
    };
  }
  function apply(obj) {
    g.cityRun = blank();
    if (!obj || obj.v !== 1) return;
    const st = state();
    st.filed = !!obj.filed; st.certified = !!obj.certified; st.onBallot = !!obj.onBallot;
    st.officeId = obj.officeId || null; st.filedDay = obj.filedDay | 0;
    st.platform.tax = isFinite(obj.platform && obj.platform.tax) ? +obj.platform.tax : 0;
    st.platform.police = isFinite(obj.platform && obj.platform.police) ? +obj.platform.police : 0;
    st.momentum = isFinite(obj.momentum) ? +obj.momentum : 0;
    st.fraud = isFinite(obj.fraud) ? +obj.fraud : 0;
    st.warChest = isFinite(obj.warChest) ? +obj.warChest : 0;
    st.exposed = !!obj.exposed;
    st.sigsNeeded = obj.sigsNeeded | 0;
    for (const k in (obj.sigs || {})) { const v = +obj.sigs[k]; if (isFinite(v)) st.sigs[k] = v; }
    for (const k in (obj.endorse || {})) { const e = obj.endorse[k]; st.endorse[k] = { day: e.day | 0, weight: +e.weight || 0 }; }
    for (const k in (obj.hooks || {})) { const h = obj.hooks[k]; st.hooks[k] = { kind: h.kind || "dirt", note: h.note || "", day: h.day | 0 }; }
    st.spent = isFinite(obj.spent) ? +obj.spent : 0;
    st.wins = obj.wins | 0; st.runs = obj.runs | 0;
    countSigs();
  }
  function stampRun() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.run = serialize();
  }
  let _ensureRunSaveWraps_done = false;
  function ensureRunSaveWraps() {
    if (_ensureRunSaveWraps_done) return;
    _ensureRunSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._runWrap) {
      const w = function () { stampRun(); return commit.apply(this, arguments); };
      w._runWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._runWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampRun(); return col.apply(this, arguments); };
      wc._runWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.run) apply(led.run);
  }
  if (CBZ.onUpdate) {
    CBZ.onUpdate(46.13, function () {
      if (!g) return;
      ensureRunSaveWraps();
      hydrateFromLedger();
    });
  }
  CBZ.cityRun.serialize = serialize;
  CBZ.cityRun.apply = apply;
})();
