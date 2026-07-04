/* ============================================================
   city/civilwar.js — Stage X, step X6b: CIVIL WAR — the polity literally
   fractures, and fights itself through P8's own war machinery.

   MASTER-PLAN (verbatim, the paragraph this file ships): "Civil war has
   three roads in. (1) The hungry road: a misery index over the cohorts
   (hunger + real-wage collapse + approval floor) crossing threshold in
   multiple districts — unrest stops being riots and becomes an armed
   uprising with territory: rebel-held districts split off as a faction
   using the gang-war machinery at national scale. (2) The broken-coup
   road: a coup that partially fails — the junta takes the capital but not
   the military island, or seizes power while loyalist states refuse to
   recognize it — doesn't resolve; it fractures the country into two
   warring polity records (loyalist vs junta), each with treasuries, armies
   drawn from the real soldier registry, and fronts. (3) The stalled-
   revolution road (already designed): a revolution that can't finish the
   job. In every case the country record splits, both halves fight with
   counted matériel and conscription, civilians flee across the migration
   system as refugees, and the war ends by reconquest, negotiated partition
   (two countries now — the map permanently changes), or collapse into
   warlordism (city-level strongmen, monarchy-foundation opportunities)."

   BUILD-PLAN X6b (verbatim): "a cohort misery index (hunger + real wages +
   approval) past threshold in multiple districts -> armed uprising with
   rebel-held territory; partially-failed coups (capital taken but military
   island or loyalist states hold out) fracture the polity into two warring
   records; endings: reconquest, partition (the map permanently gains a
   country), or warlordism. Builds on P8's war machinery."

   THE THREE FUSES THIS FILE WIRES (systems/hunger.js's miseryIndex() and
   city/migration.js's trappedMisery() were BOTH built and exported,
   unconsumed, specifically for this file — their own headers say so):
     (1) DISTRICT MISERY (republic only): a per-district misery reading,
         mirroring systems/hunger.js's own miseryIndex() FORMULA SHAPE
         (0.6×hunger-deficit + 0.4×wallet-health-deficit) but resolved PER
         DISTRICT instead of city-wide — hunger.js's own summary() rows are
         already per-district/per-class; wallet health has no per-district
         breakdown anywhere in this codebase (npcEcon.walletHealth() is a
         single city-wide aggregate), so the wallet term is shared across
         every district's reading, exactly like hunger.js's own miseryIndex
         does internally (documented, not a silent shortcut). >=2 districts
         over MISERY_DISTRICT_T, AND republic approval<APPROVAL_T, for
         UNREST_DAYS consecutive days -> armed uprising.
     (2) TRAPPED MISERY (every OTHER country — statistical, no per-district
         cohort registry per X3/X4's own mainland-only scoping): migration.js's
         trappedMisery(id) > TRAPPED_T, sustained UNREST_DAYS -> the same
         armed uprising, no districts to carve — a heldFraction stands in.
     (3) COUP (any authoritarian country in crisis): a seeded daily roll,
         gated by approval<COUP_APPROVAL_T and (low readiness OR losing an
         active war) — three outcomes: full success (a new junta figure
         seizes the office outright, the SAME "mintFigure, no live body
         required" idiom regimes.js's own dictatorVacuum junta branch uses),
         full failure (the plotters are purged — no live body exists for a
         shadow plotter this wave, so the purge is a direct ledger stamp,
         not a cityKillPed route), or PARTIAL (~30%) — the SAME fracture()
         this file's misery road uses, with the plotter minted as the
         rebel's own leader and the capital counted as rebel-held.

   FRACTURE MECHANICS (one function, either road):
     - a rebel polity is `CBZ.polity.registerCountry()`-ed with a BRAND NEW,
       sequence-numbered id (`<parent>_rebels_<n>`) — X3's own capital-id
       collision lesson, verbatim: repeated civil wars against the same
       country over a long game must never re-resolve to a stale record.
     - govType "insurgency" (misery road) or "juntaRebel" (coup road) — two
       new entries added to polwar.js's own GOV_MUL table (1.1/1.3) so a
       rebel fragment escalates like any other belligerent; everything else
       in polwar.js already treats ANY unlisted govType as a neutral ×1, so
       this is additive, not a required edit.
     - territory: for the republic, the rebel-held DISTRICT LIST (the
       misery-trigger districts, or the coup's own capital-inclusion flag);
       for a statistical country, a heldFraction (0..1, no district
       registry exists there — X3/X4's own scoping). The rebel record's OWN
       `.rect` is stamped to the held territory's centroid — polwar.js's
       anchorForPolity() checks `rec.rect` FIRST, before its capital-table
       lookup, so this alone gives the fragment a real, resolvable anchor
       with ZERO polwar.js edit.
     - treasury: a fraction of the parent's, TRANSFERRED (debited from the
       parent, credited to the fragment — never conjured).
     - military: soldiers/planes/missiles DEFECT proportional to approval
       collapse + misery, read/written directly through the LIVE mil record
       `CBZ.polwar.militaryOf(id)` already returns (the same reference every
       polwar internal — checkConscription, doProcurement — mutates
       directly; this file is a legitimate peer consumer of that contract).
     - leadership: a REAL person, never conjured. Misery road: the
       strongest live gang boss physically standing in a rebel-held
       district (regimes.js's own strongestGang() scoring, scoped to that
       territory) is minted a ledger identity (schedule.js's real, live-
       body cityPedStash path — NOT the parked mintIdentity shape, because
       this person has a body standing right here right now, the exact
       distinction officials.js's own cop-conversion header draws) and
       becomes rec.office.holder; no live candidate (any statistical
       country) falls back to a parked mintFigure(), the same shape
       regimes.js's dictatorVacuum already uses for a junta general with no
       body. Coup road: the plotter (already parked-minted at the coup
       roll) IS the rebel leader outright.
     - relations: fragment vs parent set to -95 (declareWar's own "-90 war
       floor" would otherwise land it a hair short — reasserted after the
       call); every OTHER country already hostile to the parent (rel<-40)
       gets a +20 sympathy bump toward the fragment.
     - `CBZ.polwar.declareWar(parentId, rebelId, {civil:true})` — `civil` is
       inert data (polwar.js's declareWar is kind-agnostic and ignores
       unknown opts fields by design, per its own header), kept here purely
       so a future reader can tell a civil fracture's war apart from an
       international one. FRONTS: a country splitting its OWN mainland
       territory is exactly the case polwar.js's findCausewayBetween() was
       built for but never got to exercise (its own header says so
       verbatim) — see this file's harness report for what it actually
       finds among city/worldmap.js's registered causeway/bridge regions
       between the republic's capital anchor and a rebel-held district
       centroid.

   ENDINGS (this file owns all three; P8's own endWar() only ever assigns
   ONE winner+loser, which cleanly covers two of the three):
     - RECONQUEST: P8's own dailyTick already ends ANY war (ours included)
       via front collapse or fatigue — when it does and the REBEL is the
       recorded loser, that's reconquest. The fragment's remaining military
       merges back into the parent's counted matériel (soldiers/planes/
       missiles ADDED, never destroyed — "nobody despawns" applies to
       abstract counts too), remaining treasury folds in, approval +8 on
       top of P8's own winner shock, the leader is captured (a live body
       routes through the real cityKillPed path; a parked figure is
       ledger-flagged exiled instead — no live body, no clean capture
       scene), and the fragment record is marked dissolved (kind flips off
       "country" so every list("country") scan — aid diplomacy, tariffs,
       outbreak scans, elections — stops seeing it; polity.js has no
       delete API, so "dissolved" is the documented stand-in for removal).
       A REPRESSION_COOLDOWN_DAYS window then suppresses the trigger — "the
       misery relief needed or it re-ignites" — after which the SAME
       misery/trapped-misery check can re-arm if the underlying grievance
       was never actually fixed.
     - PARTITION: when P8's OWN resolution instead names the PARENT as
       loser (a decisive rebel military win reads the same as a negotiated
       independence here), OR when this file's own STALEMATE_DAYS timeout
       finds the fragment still holding >=PARTITION_HELD_T of the front
       after that long (a war neither side can finish outright) — the
       fragment is promoted PERMANENTLY: its govType/name/rect stand as
       they are, an armistice relation (-60, hostile but no longer at war)
       is set, and the war record (P8's own, or a stalemate this file force-
       ends directly by flipping `w.ended` — the same "mutate the live
       reference" contract militaryOf() already establishes) is closed.
       THE MAP PERMANENTLY GAINS A COUNTRY: nothing about the fragment's
       polity record ever reverts — CBZ.polity.list("country") keeps
       returning it for the rest of the run, and (see PERSISTENCE) forever
       after a reload too.
     - WARLORDISM: an independent daily check, unrelated to front position —
       BOTH sides' military readiness AND treasury collapse under a floor
       for WARLORDISM_MIN_DAYS running days. The war is force-ended; the
       combined remaining soldier count TRANSITIONS (republic parent: a
       civilian-return employedFrac bump via npcEcon.adjustEmployedFrac;
       the strongest live gangs standing in the contested districts get a
       treasury/recruitPool boost — gangs.js's own war director and
       militia.js's own ANARCHY_TRICKLE pick the rest up for free once the
       parent's govType flips); the parent's govType -> "anarchism" through
       `CBZ.regimes.transition()` (its OWN public API, not a duplicate
       state machine) — regimes.js's EXISTING tickCountry() then runs the
       real strongman/restoration race after STRONGMAN_DAYS, exactly the
       "regimes takes over" the task calls for, with zero new code here.
       The fragment dissolves the same way reconquest's does.

   ADAPTATIONS RECORDED (not silently):
     - "capital district loyalist unless the coup took it": this file picks
       one district ("downtown" — nearest to city/economy.js's own centre-
       anchor default branch; there is no dedicated `.capital` district
       field anywhere in this codebase) as the stand-in seat of government.
     - districts remain owned by their existing city polity record the
       whole time (libertyville, never reparented) — "rebel-held" is THIS
       file's own bookkeeping list, not a change to city/state/country
       hierarchy. A deeper per-district polity record is real future depth,
       not required for the war/territory/ending machinery above to work.
     - defection/meddling/atrocity read `CBZ.polwar._combatPower`/
       `_forceDesperate` — both already public (harness-only in NAME, but
       live on the shared CBZ.polwar object, pure/side-effect-free reads or
       the exact same call polwar's own checkDesperate makes) — reused
       rather than re-implemented, the same "read a peer module's exported
       internals" precedent migration.js sets for CBZ.polwar.activeWarFor.
     - a coup's purged plotter has no live body this wave (officials.js's
       own PHYSICAL PRESENCE section only embodies actual sitting office-
       holders in the loaded arena, never a shadow plotter) — the purge is
       a direct ledger `.dead` stamp, the same "no body, no despawn needed"
       shape every parked mintIdentity()-style figure already is.

   PERSISTENCE — TWO-PHASE, because a partition-born (or still-fracturing)
   country id does NOT exist in polity.js's own `records` table on a fresh
   boot (it's runtime-created, not one of CBZ.COUNTRIES's static rows), and
   polity.js's own apply() explicitly skips any id nobody has registered yet
   (its own header says so). So:
     - preRegister(obj): re-registers every persisted fragment/partition id
       via CBZ.polity.registerCountry() + re-stamps its `.rect` — called
       BEFORE CBZ.polity.apply() so THAT call finds the id already present
       and restores govType/treasury/approval/office onto it normally.
     - apply(obj): the full restore (unrest counters, cooldowns, fracture
       bookkeeping, partition ledger) — called LAST, after polity/relations/
       regimes/polwar/migration are all already live.
     MULTIPLAYER: src/net/netpersist.js calls preRegister() right before its
     existing `w.pol` apply, and this file's own apply() at the very end
     (blob.cwar). SINGLE-PLAYER: the identical two-tick split, own guard
     flag `_cwarWrap` — an EARLY hydrate tick (46.02, before polity.js's own
     46.03) calls preRegister(), a LATE one (46.21, after migration.js's
     46.19 and countries.js's 46.2) calls the full apply().
   LOAD ORDER: after city/migration.js (last in the P/X-wave block) — reads
   CBZ.polity/CBZ.relations/CBZ.regimes/CBZ.polwar/CBZ.hunger/CBZ.npcEcon/
   CBZ.migration/CBZ.cityGangs/CBZ.cityEcon/CBZ.officials(cityPedStash/
   cityLedgerEntry/cityLedgerLive)/CBZ.onOfficialDeath, every one already
   live above it in index.html.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clamp01(v) { return clampNum(0, 1, v); }

  // own seeded LCG (never Math.random — repo convention for world state):
  // coup rolls + leader-mint gender/name rolls both consume this stream.
  let _seed = 550119331 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ============================================================
  //  TUNING — every constant in one place (exported as TUNING for the
  //  harness, same precedent as polwar.js/migration.js's own TUNING export).
  // ============================================================
  const DISTRICT_KEYS = ["downtown", "projects", "waterfront", "uptown", "island"];
  const CAPITAL_DISTRICT = "downtown";
  const MISERY_DISTRICT_T = 0.65, TRIGGER_DISTRICTS_MIN = 2;
  const APPROVAL_T = 30, UNREST_DAYS = 3;
  const TRAPPED_T = 0.7;
  const REPRESSION_COOLDOWN_DAYS = 20;

  const COUP_APPROVAL_T = 25, COUP_READINESS_T = 0.35, COUP_LOSING_RATIO = 0.8;
  const COUP_DAILY_CHANCE = 0.05, COUP_COOLDOWN_DAYS = 10;
  const COUP_SUCCESS_P = 0.40, COUP_FAILURE_P = 0.70; // >=0.70 -> partial (~30%)

  const REBEL_TREASURY_FRAC = 0.25;
  const DEFECT_APPROVAL_W = 0.25, DEFECT_MISERY_W = 0.15, DEFECT_FLOOR = 0.15, DEFECT_CEIL = 0.55;

  const STALEMATE_DAYS = 10, PARTITION_HELD_T = 0.4;
  const WARLORDISM_READINESS_T = 0.2, WARLORDISM_TREASURY_T = 400, WARLORDISM_MIN_DAYS = 3;
  const RECONQUEST_APPROVAL_BUMP = 8, WARLORDISM_APPROVAL_SHOCK = -25;

  const DEFECT_RATE = 0.02;
  const MEDDLE_HOSTILE_T = -50, MEDDLE_FRAC = 0.02, MEDDLE_MIN = 50;
  const ATROCITY_DESPERATE_DAYS = 2;
  const LEADER_DEATH_FATIGUE_SPIKE = 30, LEADER_DEATH_READINESS_HIT = 0.15;
  const REBEL_CONSCRIPT_COOLDOWN_DAYS = 3, REBEL_CONSCRIPT_COHORT_HIT = 0.04;

  // ============================================================
  //  STATE — g.civilWarWorld
  // ============================================================
  function freshState() {
    return {
      unrestDays: Object.create(null),      // countryId -> consecutive qualifying days
      cooldownUntil: Object.create(null),   // countryId -> worldDay the uprising trigger re-arms
      coupCooldown: Object.create(null),    // countryId -> worldDay the coup roll re-arms
      fractures: Object.create(null),       // parentId -> {rebelId, cause, warId, districts, heldFraction, startDay, coupTookCapital, _collapseDays}
      partitions: Object.create(null),      // rebelId -> {parentId, day} — permanent, survives the fracture's own removal
      nextRebelSeq: 1,
    };
  }
  function reset() { g.civilWarWorld = freshState(); }
  function ensureInit() { if (!g.civilWarWorld) reset(); }
  function state() { ensureInit(); return g.civilWarWorld; }

  // ============================================================
  //  DISTRICT HELPERS — mirrors sim/npcecon.js's own DISTRICT_KEYS/anchor
  //  precedent (city/economy.js's districtAnchor() is module-private —
  //  duplicated here, same "no hard load-order dependency" convention every
  //  sim/city file already documents for this exact constant).
  // ============================================================
  function districtKeys() { return (CBZ.npcEcon && CBZ.npcEcon.DISTRICT_KEYS) || DISTRICT_KEYS; }
  function districtAnchor(dk) {
    const c = (CBZ.city && CBZ.city.center) || { x: 0, z: 0 };
    const A = CBZ.city && CBZ.city.annex;
    const R = 70;
    switch (dk) {
      case "uptown": return { x: c.x + R, z: c.z - R };
      case "projects": return { x: c.x - R, z: c.z + R };
      case "waterfront": return { x: c.x + R, z: c.z + R };
      case "island": return A ? { x: A.cx, z: A.cz } : { x: c.x, z: c.z };
      default: return { x: c.x - R, z: c.z - R };   // downtown
    }
  }
  // districtMisery(dk) — mirrors systems/hunger.js's own miseryIndex()
  // 0.6/0.4 blend, resolved per-district for the hunger term (see header).
  function districtMisery(dk) {
    const hs = (CBZ.hunger && CBZ.hunger.summary) ? CBZ.hunger.summary() : [];
    const ps = (CBZ.npcEcon && CBZ.npcEcon.summary) ? CBZ.npcEcon.summary() : [];
    let wsum = 0, hmisery = 0;
    for (let i = 0; i < hs.length; i++) {
      const row = hs[i];
      if (row.d !== dk) continue;
      let pop = 1;
      for (let j = 0; j < ps.length; j++) if (ps[j].d === dk && ps[j].c === row.c) { pop = ps[j].pop || 1; break; }
      wsum += pop;
      hmisery += pop * ((100 - row.hungerAvg) / 100);
    }
    const hungerTerm = wsum > 0 ? hmisery / wsum : 0;
    const wh = (CBZ.npcEcon && CBZ.npcEcon.walletHealth) ? CBZ.npcEcon.walletHealth() : 1.0;
    const walletTerm = clamp01(1 - wh);
    return clamp01(hungerTerm * 0.6 + walletTerm * 0.4);
  }
  function computeTriggerDistricts() {
    const out = [];
    const dks = districtKeys();
    for (let i = 0; i < dks.length; i++) if (districtMisery(dks[i]) > MISERY_DISTRICT_T) out.push(dks[i]);
    return out;
  }

  // ============================================================
  //  IDENTITY MINTING — mintFigure() mirrors regimes.js's own dictatorVacuum
  //  mintFigure()/officials.js's mintIdentity() shape verbatim (a parked,
  //  bodiless ledger identity — legitimate for a figure with no live body
  //  this wave).
  // ============================================================
  function mintFigure(job) {
    if (!CBZ.cityPedStash) return null;
    const gender = rng() < 0.5 ? "f" : "m";
    const name = CBZ.cityMintName ? CBZ.cityMintName(rng, gender) : (gender === "f" ? "Adelaide Marsh" : "Foster Marsh");
    const obj = {
      _parked: true, nameKnown: true, kind: "civilian", name: name, gender: gender,
      archetype: "official", job: job, wealth: 0.5, aggr: 0.4, cash: 1000 + Math.round(rng() * 3000),
    };
    CBZ.cityPedStash(obj);
    return obj._sid || null;
  }
  // a REAL live person transitions into the rebel leadership — never
  // conjured (see header). Prefers the strongest gang boss physically
  // standing in a rebel-held district; falls back to any live ped there;
  // falls back further to a parked mintFigure() only when no live body
  // exists at all (any statistical country, or a district with nobody in it).
  function mintUprisingLeader(districts) {
    let candidate = null, bestScore = -1;
    const scoped = !!(districts && districts.length);
    if (CBZ.cityGangs) {
      for (let i = 0; i < CBZ.cityGangs.length; i++) {
        const gang = CBZ.cityGangs[i];
        if (!gang || gang.isPlayer || gang.absorbed || !gang.boss || gang.boss.dead || !gang.boss.pos) continue;
        if (scoped) {
          const dk = CBZ.cityEcon && CBZ.cityEcon.districtAt ? CBZ.cityEcon.districtAt(gang.boss.pos.x, gang.boss.pos.z) : null;
          if (districts.indexOf(dk) < 0) continue;
        }
        const score = (gang.treasury || 0) + (gang.members ? gang.members.length : 0) * 200;
        if (score > bestScore) { bestScore = score; candidate = gang.boss; }
      }
    }
    // no gang boss standing in the held territory specifically (or none held
    // at all — a statistical country) — ANY live gang boss citywide is still
    // a real transitioning person, preferred over a parked mintFigure().
    if (!candidate && scoped && CBZ.cityGangs) {
      for (let i = 0; i < CBZ.cityGangs.length; i++) {
        const gang = CBZ.cityGangs[i];
        if (!gang || gang.isPlayer || gang.absorbed || !gang.boss || gang.boss.dead) continue;
        const score = (gang.treasury || 0) + (gang.members ? gang.members.length : 0) * 200;
        if (score > bestScore) { bestScore = score; candidate = gang.boss; }
      }
    }
    if (!candidate && CBZ.cityPeds) {
      for (let i = 0; i < CBZ.cityPeds.length; i++) {
        const p = CBZ.cityPeds[i];
        if (!p || p.dead || p.isPlayer || p.vendor || p.companion || !p.pos) continue;
        if (scoped) {
          const dk = CBZ.cityEcon && CBZ.cityEcon.districtAt ? CBZ.cityEcon.districtAt(p.pos.x, p.pos.z) : null;
          if (districts.indexOf(dk) < 0) continue;
        }
        candidate = p; break;
      }
    }
    if (!candidate && scoped && CBZ.cityPeds) {
      for (let i = 0; i < CBZ.cityPeds.length; i++) {
        const p = CBZ.cityPeds[i];
        if (!p || p.dead || p.isPlayer || p.vendor || p.companion || !p.pos) continue;
        candidate = p; break;
      }
    }
    if (candidate) {
      if (!candidate._sid) {
        candidate.nameKnown = true;
        if (CBZ.cityPedStash) try { CBZ.cityPedStash(candidate); } catch (e) {}
      }
      if (candidate._sid) {
        const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(candidate._sid);
        if (e) e.job = "rebel leader";
        // NOTE: schedule.js's `liveBy` index (CBZ.cityLedgerLive) only gets
        // populated when a body is later "dealt" an identity or by the
        // vendor sweep — NOT the instant cityPedStash() mints a page for an
        // already-live body. So the ACTUAL ped reference is returned
        // alongside the sid here and carried on the fracture record
        // (rec.leaderRef, runtime-only, never persisted — a save/reload
        // simply falls back to the ledger-only capture path, see
        // resolveLeaderOutcome) instead of re-deriving "is this sid live"
        // through an index that isn't guaranteed to say so yet.
        return { sid: candidate._sid, ped: candidate };
      }
    }
    return { sid: mintFigure("rebel leader"), ped: null };
  }

  // ============================================================
  //  TERRITORY PICK — republic districts (misery road) or coup capital flag.
  // ============================================================
  function pickRebelDistricts(opts) {
    const triggers = computeTriggerDistricts();
    let districts = triggers.slice();
    if (opts.coupTookCapital) {
      if (districts.indexOf(CAPITAL_DISTRICT) < 0) districts.push(CAPITAL_DISTRICT);
    } else {
      districts = districts.filter(function (dk) { return dk !== CAPITAL_DISTRICT; });
    }
    if (!districts.length) districts = [opts.coupTookCapital ? CAPITAL_DISTRICT : districtKeys()[1]];
    return districts;
  }
  function unionAnchor(districts) {
    let sx = 0, sz = 0;
    for (let i = 0; i < districts.length; i++) { const a = districtAnchor(districts[i]); sx += a.x; sz += a.z; }
    return { x: sx / districts.length, z: sz / districts.length };
  }
  function capitalCoordsFor(id) {
    if (id === "republic") {
      const lib = CBZ.polity && CBZ.polity.get ? CBZ.polity.get("libertyville") : null;
      return lib && lib.rect ? { x: lib.rect.cx, z: lib.rect.cz } : { x: 0, z: -700 };
    }
    const cd = (CBZ.COUNTRIES || []).find(function (c) { return c.id === id; });
    const cap = cd && (cd.settlements || []).find(function (s) { return s.capital; });
    return cap ? { x: cap.cx, z: cap.cz } : { x: 0, z: 0 };
  }

  // ============================================================
  //  FRACTURE — the polity splits. One at a time per parent (mirrors
  //  polwar.js's own "single war per polity" scope bound).
  // ============================================================
  function activeFractureFor(parentId) { return state().fractures[parentId] || null; }
  function rebelIdFor(parentId) {
    const S = state();
    return parentId + "_rebels_" + (S.nextRebelSeq++);
  }
  function nameOf(id) { const r = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; return (r && r.name) || id; }

  function fracture(parentId, opts) {
    opts = opts || {};
    if (activeFractureFor(parentId)) return null;
    const parent = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(parentId) : null;
    if (!parent || !CBZ.polwar || !CBZ.polity.registerCountry) return null;
    const S = state();
    const rebelId = rebelIdFor(parentId);
    const cause = opts.cause === "coup" ? "coup" : "uprising";
    const govType = cause === "coup" ? "juntaRebel" : "insurgency";
    const isRepublic = parentId === "republic";

    let districts = null, heldFraction = null, anchor;
    if (isRepublic) {
      districts = pickRebelDistricts(opts);
      anchor = unionAnchor(districts);
      // COUP road only: the BUILD-PLAN's own wording is "the military island
      // ... hold[s] out" — Fort Brandt is a REAL, separately-registered
      // federal-territory polity record (city/polity.js's own FORTBRANDT_RECT,
      // physically distant from the city core), so a coup fracture's anchor
      // is stamped there instead of a district centroid: the actual holdout
      // geography the plan names, not a same-city district. This is exactly
      // the "country splitting across its OWN mainland territory" case
      // polwar.js's findCausewayBetween() was built for but never got to
      // exercise (see that file's header) — anchorForPolity(parentId) reads
      // libertyville's centre, anchorForPolity(rebelId) reads THIS rect, and
      // the search runs between two real, distant mainland points.
      if (cause === "coup") {
        const fb = CBZ.polity.get("fortbrandt");
        if (fb && fb.rect) anchor = { x: fb.rect.cx, z: fb.rect.cz };
      }
    } else {
      heldFraction = clampNum(0.2, 0.6, 0.35);
      const cap = capitalCoordsFor(parentId);
      anchor = { x: cap.x + 45, z: cap.z + 45 };
    }

    const rebelRec = CBZ.polity.registerCountry({
      id: rebelId, name: nameOf(parentId) + " Free Territories", govType: govType,
      wealthLevel: parent.wealthLevel != null ? parent.wealthLevel : 0.5,
    });
    if (!rebelRec) return null;
    rebelRec.rect = { cx: anchor.x, cz: anchor.z, hx: 90, hz: 90 };

    // treasury: TRANSFERRED, never conjured.
    const treasuryCut = Math.max(0, Math.round((parent.treasury || 0) * REBEL_TREASURY_FRAC));
    parent.treasury = Math.max(0, (parent.treasury || 0) - treasuryCut);
    rebelRec.treasury = treasuryCut;

    // military: soldiers/planes/missiles DEFECT, proportional to collapse.
    const parentMil = CBZ.polwar.militaryOf(parentId);
    const rebelMil = CBZ.polwar.militaryOf(rebelId);   // auto-seeded shell — overwritten below with the real transfer
    const approvalCollapse = clamp01((APPROVAL_T - (parent.approval || 0)) / APPROVAL_T);
    const miseryNow = clamp01(isRepublic
      ? ((CBZ.hunger && CBZ.hunger.miseryIndex) ? CBZ.hunger.miseryIndex() : 0)
      : ((CBZ.migration && CBZ.migration.trappedMisery) ? CBZ.migration.trappedMisery(parentId) / TRAPPED_T : 0));
    const defectFrac = clampNum(DEFECT_FLOOR, DEFECT_CEIL, DEFECT_FLOOR + approvalCollapse * DEFECT_APPROVAL_W + miseryNow * DEFECT_MISERY_W);
    const dS = Math.round(parentMil.soldiers * defectFrac), dP = Math.round(parentMil.planes * defectFrac), dM = Math.round(parentMil.missiles * defectFrac);
    parentMil.soldiers = Math.max(0, parentMil.soldiers - dS);
    parentMil.planes = Math.max(0, parentMil.planes - dP);
    parentMil.missiles = Math.max(0, parentMil.missiles - dM);
    rebelMil.soldiers = dS; rebelMil.planes = dP; rebelMil.missiles = dM;
    rebelMil.seedSoldiers = dS || 1;
    rebelMil.readiness = clampNum(0.2, 0.9, parentMil.readiness);

    // leadership: a real person transitions in.
    const leaderPick = cause === "coup"
      ? { sid: opts.plotterSid || mintFigure("junta general"), ped: null }
      : mintUprisingLeader(districts);
    const leaderSid = leaderPick.sid;
    rebelRec.office = rebelRec.office || { holder: null, deputy: null, termDay: null };
    rebelRec.office.holder = leaderSid || null;

    // relations: hostile to parent; sympathetic to parent's enemies.
    if (CBZ.relations) {
      const countries = CBZ.polity.list("country");
      for (let i = 0; i < countries.length; i++) {
        const o = countries[i];
        if (o.id === parentId || o.id === rebelId) continue;
        if (CBZ.relations.get && CBZ.relations.get(parentId, o.id) < -40 && CBZ.relations.event) {
          CBZ.relations.event(rebelId, o.id, "aid", 20);
        }
      }
    }

    const war = CBZ.polwar.declareWar(parentId, rebelId, { civil: true });
    // reassert the exact -95 seed over declareWar's own -90 war floor.
    if (CBZ.relations && CBZ.relations.set) CBZ.relations.set(parentId, rebelId, -95);

    const rec = {
      parentId: parentId, rebelId: rebelId, cause: cause, warId: war ? war.id : null,
      districts: districts, heldFraction: heldFraction, startDay: CBZ.worldDay ? CBZ.worldDay() : 0,
      coupTookCapital: !!opts.coupTookCapital, _collapseDays: 0,
      leaderRef: leaderPick.ped || null,   // runtime-only live-ped reference — see mintUprisingLeader's header
    };
    S.fractures[parentId] = rec;

    if (CBZ.city && CBZ.city.big) CBZ.city.big("🚩 CIVIL WAR: " + rebelRec.name.toUpperCase() + " BREAKS AWAY");
    if (CBZ.cityFeed) CBZ.cityFeed("🚩 " + rebelRec.name + " declares independence from " + nameOf(parentId) + " — the country fractures.", "#ff4d4d");
    return rec;
  }

  // ============================================================
  //  UPRISING TRIGGERS — the "hungry road."
  // ============================================================
  function unrestArmed(id, day, S) {
    return !(S.cooldownUntil[id] && day < S.cooldownUntil[id]);
  }
  function districtDrivenCheck(day) {
    const S = state();
    if (activeFractureFor("republic")) { S.unrestDays.republic = 0; return; }
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get("republic") : null;
    if (!rec || !unrestArmed("republic", day, S)) { S.unrestDays.republic = 0; return; }
    const triggers = computeTriggerDistricts();
    const meets = triggers.length >= TRIGGER_DISTRICTS_MIN && (rec.approval || 0) < APPROVAL_T;
    if (!meets) { S.unrestDays.republic = 0; return; }
    S.unrestDays.republic = (S.unrestDays.republic || 0) + 1;
    const d = S.unrestDays.republic;
    if (d === 1 && CBZ.cityFeed) CBZ.cityFeed("📢 Protests spread across " + triggers.length + " districts.", "#ffb27a");
    else if (d === 2 && CBZ.cityFeed) CBZ.cityFeed("🔥 Unrest hardens — militants are arming in the streets.", "#ff6a5e");
    if (d >= UNREST_DAYS) { S.unrestDays.republic = 0; fracture("republic", { cause: "uprising" }); }
  }
  function statisticalCheck(day) {
    const S = state();
    if (!CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      if (rec.id === "republic") continue;
      if (activeFractureFor(rec.id)) { S.unrestDays[rec.id] = 0; continue; }
      if (!unrestArmed(rec.id, day, S)) { S.unrestDays[rec.id] = 0; continue; }
      const tm = (CBZ.migration && CBZ.migration.trappedMisery) ? CBZ.migration.trappedMisery(rec.id) : 0;
      if (tm > TRAPPED_T) {
        S.unrestDays[rec.id] = (S.unrestDays[rec.id] || 0) + 1;
        if (S.unrestDays[rec.id] >= UNREST_DAYS) { S.unrestDays[rec.id] = 0; fracture(rec.id, { cause: "uprising" }); }
      } else S.unrestDays[rec.id] = 0;
    }
  }
  function unrest(id) {
    const S = state();
    if (id === "republic") {
      const triggers = computeTriggerDistricts().length;
      const distTerm = clamp01(triggers / TRIGGER_DISTRICTS_MIN);
      const dayTerm = clamp01((S.unrestDays.republic || 0) / UNREST_DAYS);
      return clamp01(distTerm * 0.5 + dayTerm * 0.5);
    }
    const tm = (CBZ.migration && CBZ.migration.trappedMisery) ? CBZ.migration.trappedMisery(id) : 0;
    return clamp01(tm / TRAPPED_T);
  }

  // ============================================================
  //  COUP — the "broken-coup road," the second fuse.
  // ============================================================
  function rippleCoupFailure(id) {
    const countries = CBZ.polity ? CBZ.polity.list("country") : [];
    for (let i = 0; i < countries.length; i++) {
      const o = countries[i];
      if (o.id === id || !CBZ.relations || !CBZ.relations.get || !CBZ.relations.event) continue;
      if (CBZ.relations.get(id, o.id) > 20) CBZ.relations.event(id, o.id, "insult", 5);
    }
  }
  function coupEligible(rec) {
    if (!rec || !(rec.govType === "dictatorship" || rec.govType === "fascism")) return false;
    if ((rec.approval || 0) >= COUP_APPROVAL_T) return false;
    if (!CBZ.polwar) return false;
    const mil = CBZ.polwar.militaryOf(rec.id);
    if (mil && mil.readiness < COUP_READINESS_T) return true;
    const w = CBZ.polwar.activeWarFor(rec.id);
    if (w) {
      const oppId = w.sides[0] === rec.id ? w.sides[1] : w.sides[0];
      const oppMil = CBZ.polwar.militaryOf(oppId);
      if (mil && oppMil && CBZ.polwar._combatPower(mil) < CBZ.polwar._combatPower(oppMil) * COUP_LOSING_RATIO) return true;
    }
    return false;
  }
  function applyCoupOutcome(rec, kind) {
    const plotterSid = mintFigure("junta general");
    if (kind === "success") {
      rec.office.holder = plotterSid; rec.office.deputy = null;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("🎖️ COUP: " + rec.name.toUpperCase() + " FALLS TO THE JUNTA");
      if (CBZ.cityFeed) CBZ.cityFeed("🎖️ A military coup succeeds in " + rec.name + " — the junta rules now.", "#ff9e6b");
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, -6);
      return { outcome: "success", plotterSid: plotterSid };
    }
    if (kind === "failure") {
      const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(plotterSid);
      if (e) e.dead = true;   // no live body this wave for a shadow plotter — see header
      if (CBZ.city && CBZ.city.big) CBZ.city.big("⚔️ COUP CRUSHED IN " + rec.name.toUpperCase());
      if (CBZ.cityFeed) CBZ.cityFeed("⚔️ The plot against " + rec.name + " is crushed — the plotters are purged.", "#ff6a5e");
      if (CBZ.approvalShock) CBZ.approvalShock(rec.id, -4);
      rippleCoupFailure(rec.id);
      return { outcome: "failure", plotterSid: plotterSid };
    }
    const fr = fracture(rec.id, { cause: "coup", coupTookCapital: true, plotterSid: plotterSid });
    return { outcome: "partial", fracture: fr, plotterSid: plotterSid };
  }
  function fireCoup(rec) {
    const roll = rng();
    const kind = roll < COUP_SUCCESS_P ? "success" : (roll < COUP_FAILURE_P ? "failure" : "partial");
    return applyCoupOutcome(rec, kind);
  }
  function checkCoups(day) {
    const S = state();
    if (!CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      if (activeFractureFor(rec.id)) continue;
      if (!coupEligible(rec)) continue;
      const cd = S.coupCooldown[rec.id];
      if (cd && day < cd) continue;
      if (rng() >= COUP_DAILY_CHANCE) continue;
      S.coupCooldown[rec.id] = day + COUP_COOLDOWN_DAYS;
      fireCoup(rec);
    }
  }

  // ============================================================
  //  WAR EXTRAS — defection, foreign meddling, atrocity, layered on top of
  //  P8's own tickWar (casualties/fronts/fatigue/conscription/procurement
  //  already run for ANY two-sided war, ours included, for free).
  // ============================================================
  function findWar(rec) {
    if (!rec.warId || !CBZ.polwar) return null;
    const list = CBZ.polwar.warsOf(rec.parentId, { all: true });
    for (let i = 0; i < list.length; i++) if (list[i].id === rec.warId) return list[i];
    return null;
  }
  function forceEndWar(w, reason) {
    if (!w || w.ended) return;
    w.ended = true; w.endedDay = CBZ.worldDay ? CBZ.worldDay() : 0; w.endReason = reason;
  }
  function tickDefection(rec, front) {
    const parentMil = CBZ.polwar.militaryOf(rec.parentId), rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    const momentum = front.position - 0.5;   // >0: parent has the edge, <0: rebel has the edge
    const parentMisery = clamp01(rec.parentId === "republic"
      ? ((CBZ.hunger && CBZ.hunger.miseryIndex) ? CBZ.hunger.miseryIndex() : 0.3)
      : ((CBZ.migration && CBZ.migration.trappedMisery) ? CBZ.migration.trappedMisery(rec.parentId) / TRAPPED_T : 0.3));
    const miseryPull = clampNum(-0.2, 0.2, (parentMisery - 0.3) * 0.4);   // a miserable parent bleeds soldiers TO the rebels
    const net = momentum - miseryPull;
    if (Math.abs(net) <= 0.01) return;
    if (net > 0) {
      const n = Math.max(0, Math.round(rebelMil.soldiers * DEFECT_RATE * Math.min(1, net * 4)));
      if (n > 0) { rebelMil.soldiers -= n; parentMil.soldiers += n; }
    } else {
      const n = Math.max(0, Math.round(parentMil.soldiers * DEFECT_RATE * Math.min(1, -net * 4)));
      if (n > 0) { parentMil.soldiers -= n; rebelMil.soldiers += n; }
    }
  }
  function tickMeddling(rec) {
    if (!CBZ.relations || !CBZ.polity) return;
    const rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    const T = CBZ.polwar.TUNING;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const o = countries[i];
      if (o.id === rec.parentId || o.id === rec.rebelId) continue;
      if (CBZ.relations.get(rec.parentId, o.id) >= MEDDLE_HOSTILE_T) continue;
      const amt = Math.round((o.treasury || 0) * MEDDLE_FRAC);
      if (amt < MEDDLE_MIN) continue;
      o.treasury -= amt;
      const missiles = Math.floor(amt / T.COST_PER_MISSILE);
      if (missiles > 0) {
        rebelMil.missiles += missiles;
        if (CBZ.cityFeed) CBZ.cityFeed("📦 " + o.name + " arms the rebels against " + nameOf(rec.parentId), "#8fc1ff");
      }
    }
  }
  // rebel conscription — P8's own checkConscription() is a no-op for a
  // rebel polity (no CBZ.COUNTRIES capital entry, so capitalOf() resolves
  // null; that gate is generalized off "republic" cohorts only). This file
  // owns the rebel-side lever instead, scoped to the districts it actually
  // holds via the new adjustEmployedFracForDistrict() hook (see header:
  // "rebel conscription pulls from rebel-held districts' cohorts").
  function tickRebelConscription(rec, day) {
    if (!rec.districts || !rec.districts.length || !CBZ.npcEcon || !CBZ.npcEcon.adjustEmployedFracForDistrict) return;
    const mil = CBZ.polwar.militaryOf(rec.rebelId);
    const T = CBZ.polwar.TUNING;
    if ((day - (mil.lastConscriptDay != null ? mil.lastConscriptDay : -999)) < REBEL_CONSCRIPT_COOLDOWN_DAYS) return;
    const floor = (mil.seedSoldiers || 1) * T.CONSCRIPT_FLOOR_FRAC;
    if (mil.soldiers >= floor) return;
    const batch = Math.max(1, Math.round((mil.seedSoldiers || 1) * T.CONSCRIPT_BATCH_FRAC));
    mil.soldiers += batch;
    mil.lastConscriptDay = day;
    mil.conscriptedCohort = (mil.conscriptedCohort || 0) + REBEL_CONSCRIPT_COHORT_HIT;
    const per = REBEL_CONSCRIPT_COHORT_HIT / rec.districts.length;
    for (let i = 0; i < rec.districts.length; i++) CBZ.npcEcon.adjustEmployedFracForDistrict(rec.districts[i], -per);
    if (CBZ.cityFeed) CBZ.cityFeed("📯 " + nameOf(rec.rebelId) + " conscripts " + batch + " more from the rebel-held streets.", "#ffb27a");
  }
  function tickAtrocity(rec) {
    const parentMil = CBZ.polwar.militaryOf(rec.parentId), rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    const cpParent = CBZ.polwar._combatPower(parentMil), cpRebel = CBZ.polwar._combatPower(rebelMil);
    if (cpRebel < cpParent * CBZ.polwar.TUNING.LOSING_RATIO) {
      rebelMil.desperateDays = (rebelMil.desperateDays || 0) + 1;
      if (rebelMil.desperateDays >= ATROCITY_DESPERATE_DAYS) {
        rebelMil.desperateDays = 0;
        try { CBZ.polwar._forceDesperate(rec.rebelId); } catch (e) {}
      }
    } else rebelMil.desperateDays = 0;
  }

  // ============================================================
  //  ENDINGS
  // ============================================================
  function dissolveFragment(rebelRec) {
    if (!rebelRec) return;
    rebelRec.kind = "dissolvedRebellion";   // drops out of every list("country") scan — polity.js has no delete API
    rebelRec.govType = "dissolved";
    rebelRec.office = { holder: null, deputy: null, termDay: null };
  }
  // leaderRef: the runtime-only live-ped reference fracture() stashed on its
  // own record (see mintUprisingLeader's header — schedule.js's liveBy index
  // isn't guaranteed to reflect a body the instant it's minted, so this file
  // tracks the reference itself instead of re-deriving it through that
  // index). Falls back to CBZ.cityLedgerLive() (a save/reload loses the
  // runtime reference) and finally to a direct ledger-page stamp (a parked
  // figure, or a reference that's gone stale) — always resolves to SOME
  // outcome, never a silent no-op.
  function resolveLeaderOutcome(rebelRec, mode, leaderRef) {
    const sid = rebelRec && rebelRec.office && rebelRec.office.holder;
    if (!sid) return;
    const live = (leaderRef && leaderRef._sid === sid && !leaderRef.dead) ? leaderRef : (CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid));
    if (mode === "captured") {
      if (live && CBZ.cityKillPed) { try { CBZ.cityKillPed(live, 9999, "civil-war-capture"); } catch (e) {} }
      else { const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid); if (e) { e.dead = true; e.exiled = true; } }
    } else {
      const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
      if (e) e.exiled = true;   // warlordism: no clean capture — the leader just fades into the chaos
    }
  }
  function endReconquest(rec, day) {
    const parentRec = CBZ.polity.get(rec.parentId), rebelRec = CBZ.polity.get(rec.rebelId);
    const parentMil = CBZ.polwar.militaryOf(rec.parentId), rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    parentMil.soldiers += rebelMil.soldiers; parentMil.planes += rebelMil.planes; parentMil.missiles += rebelMil.missiles;
    rebelMil.soldiers = 0; rebelMil.planes = 0; rebelMil.missiles = 0;
    if (parentRec) {
      parentRec.treasury = (parentRec.treasury || 0) + (rebelRec ? (rebelRec.treasury || 0) : 0);
      parentRec.approval = clampNum(0, 100, (parentRec.approval || 0) + RECONQUEST_APPROVAL_BUMP);
    }
    if (rebelRec) rebelRec.treasury = 0;
    // "districts return" — restore whatever rebel-side conscription pulled
    // out of those districts' cohorts (see tickRebelConscription's header).
    if (rec.districts && rec.districts.length && rebelMil.conscriptedCohort && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFracForDistrict) {
      const per = rebelMil.conscriptedCohort / rec.districts.length;
      for (let i = 0; i < rec.districts.length; i++) CBZ.npcEcon.adjustEmployedFracForDistrict(rec.districts[i], per);
    }
    resolveLeaderOutcome(rebelRec, "captured", rec.leaderRef);
    dissolveFragment(rebelRec);
    const S = state();
    S.cooldownUntil[rec.parentId] = day + REPRESSION_COOLDOWN_DAYS;
    delete S.fractures[rec.parentId];
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🏳 RECONQUEST: " + (parentRec ? parentRec.name : rec.parentId).toUpperCase() + " REUNITES THE COUNTRY");
    if (CBZ.cityFeed) CBZ.cityFeed("🏳 The uprising is crushed — " + (parentRec ? parentRec.name : rec.parentId) + " reconquers the rebel territory.", "#8fe08a");
  }
  function endPartition(rec, day, reason) {
    const rebelRec = CBZ.polity.get(rec.rebelId);
    if (rebelRec) {
      rebelRec.name = (rebelRec.name || rec.rebelId).replace(" Free Territories", " (Independent)");
      // demographics/wealthLevel already inherited (registerCountry seeded
      // them at fracture() time); currencyId is a placeholder for every
      // country this wave (X3's own country-record shape has none yet) —
      // nothing new to stamp here.
    }
    if (CBZ.relations && CBZ.relations.set) CBZ.relations.set(rec.parentId, rec.rebelId, -60);   // armistice, not friendship
    const S = state();
    delete S.fractures[rec.parentId];
    S.partitions[rec.rebelId] = { parentId: rec.parentId, day: day };
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🗺️ PARTITION: " + (rebelRec ? rebelRec.name : rec.rebelId).toUpperCase() + " IS BORN");
    if (CBZ.cityFeed) CBZ.cityFeed("🗺️ The war ends in " + reason + " — " + (rebelRec ? rebelRec.name : rec.rebelId) + " is recognized as a new country. The map has changed forever.", "#ffd76a");
  }
  function strongestGangsIn(districts, n) {
    const live = (CBZ.cityGangs || []).filter(function (gg) { return gg && !gg.isPlayer && !gg.absorbed && gg.boss && !gg.boss.dead; });
    function sorted(list) {
      const out = list.slice();
      out.sort(function (a, b) {
        const sa = (a.treasury || 0) + (a.members ? a.members.length : 0) * 200;
        const sb = (b.treasury || 0) + (b.members ? b.members.length : 0) * 200;
        return sb - sa;
      });
      return out;
    }
    if (!districts || !districts.length) return sorted(live).slice(0, n);
    const inTerritory = live.filter(function (gg) {
      const bp = gg.boss.pos; if (!bp) return false;
      const dk = CBZ.cityEcon && CBZ.cityEcon.districtAt ? CBZ.cityEcon.districtAt(bp.x, bp.z) : null;
      return districts.indexOf(dk) >= 0;
    });
    // no gang currently holds the specific rebel territory (npcecon's income
    // districts and gangs.js's own lot-based turf aren't the same geometry) —
    // the strongest gangs CITYWIDE absorb the fallen state's remains instead,
    // a documented fallback, not a silent empty result.
    return sorted(inTerritory.length ? inTerritory : live).slice(0, n);
  }
  function endWarlordism(rec, day) {
    const parentRec = CBZ.polity.get(rec.parentId), rebelRec = CBZ.polity.get(rec.rebelId);
    const parentMil = CBZ.polwar.militaryOf(rec.parentId), rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    const totalSoldiers = (parentMil.soldiers || 0) + (rebelMil.soldiers || 0);
    const treasuryPool = (parentRec ? (parentRec.treasury || 0) : 0) + (rebelRec ? (rebelRec.treasury || 0) : 0);

    // soldiers TRANSITION — civilian return (republic parent only, matching
    // P8's own conscription-release lever) + gang absorption; nobody despawns.
    if (rec.parentId === "republic" && CBZ.npcEcon && CBZ.npcEcon.adjustEmployedFrac && totalSoldiers > 0) {
      CBZ.npcEcon.adjustEmployedFrac(0.15);
    }
    if (rec.parentId === "republic") {
      const gangs = strongestGangsIn(rec.districts, 2);
      const perGang = gangs.length ? Math.floor(totalSoldiers / gangs.length) : 0;
      const perGangCash = gangs.length ? Math.round(treasuryPool / gangs.length) : 0;
      for (let i = 0; i < gangs.length; i++) {
        gangs[i].recruitPool = (gangs[i].recruitPool || 0) + perGang;
        gangs[i].treasury = (gangs[i].treasury || 0) + perGangCash;
      }
    }
    parentMil.soldiers = 0; rebelMil.soldiers = 0; parentMil.planes = 0; rebelMil.planes = 0; parentMil.missiles = 0; rebelMil.missiles = 0;
    if (parentRec) parentRec.treasury = 0;
    if (rebelRec) rebelRec.treasury = 0;

    resolveLeaderOutcome(rebelRec, "warlord", rec.leaderRef);
    dissolveFragment(rebelRec);
    if (CBZ.regimes && CBZ.regimes.transition && parentRec) {
      CBZ.regimes.transition(parentRec, "anarchism", CBZ.worldDay ? CBZ.worldDay() : day, WARLORDISM_APPROVAL_SHOCK);
    }
    const S = state();
    delete S.fractures[rec.parentId];
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💀 WARLORDISM: " + (parentRec ? parentRec.name : rec.parentId).toUpperCase() + " COLLAPSES");
    if (CBZ.cityFeed) CBZ.cityFeed("💀 Both sides burn out — " + (parentRec ? parentRec.name : rec.parentId) + " dissolves into warlord territory.", "#ff3b3b");
  }
  function resolveEndingIfDue(rec, day) {
    const w = findWar(rec);
    if (!w) return;
    if (w.ended) {
      // P8's own machinery already concluded it (front collapse or war
      // exhaustion) — the rebel losing reads as reconquest; the parent
      // losing (or the rebel outright winning) reads as independence won.
      if (w.loser === rec.rebelId) endReconquest(rec, day);
      else endPartition(rec, day, "military victory");
      return;
    }
    const front = (CBZ.polwar.frontsOf(w.id) || [])[0];
    if (!front) return;

    // WARLORDISM — total mutual collapse, independent of front position.
    const parentMil = CBZ.polwar.militaryOf(rec.parentId), rebelMil = CBZ.polwar.militaryOf(rec.rebelId);
    const parentRec = CBZ.polity.get(rec.parentId), rebelRec = CBZ.polity.get(rec.rebelId);
    const collapsed = parentMil.readiness < WARLORDISM_READINESS_T && rebelMil.readiness < WARLORDISM_READINESS_T &&
      (parentRec && (parentRec.treasury || 0) < WARLORDISM_TREASURY_T) && (rebelRec && (rebelRec.treasury || 0) < WARLORDISM_TREASURY_T);
    if (collapsed) {
      rec._collapseDays = (rec._collapseDays || 0) + 1;
      if (rec._collapseDays >= WARLORDISM_MIN_DAYS) { forceEndWar(w, "warlordism collapse"); endWarlordism(rec, day); return; }
    } else rec._collapseDays = 0;

    // STALEMATE -> PARTITION — a war neither side can finish outright.
    if (day - rec.startDay >= STALEMATE_DAYS) {
      const heldFrac = 1 - front.position;
      if (heldFrac >= PARTITION_HELD_T) { forceEndWar(w, "civil settlement"); endPartition(rec, day, "stalemate"); return; }
    }
  }
  function tickFractureExtras(rec, day) {
    const w = findWar(rec);
    if (w && !w.ended) {
      const front = (CBZ.polwar.frontsOf(w.id) || [])[0];
      if (front) { tickDefection(rec, front); tickMeddling(rec); tickAtrocity(rec); tickRebelConscription(rec, day); }
    }
    resolveEndingIfDue(rec, day);
  }

  // ============================================================
  //  PLAYER COUPLING — assassinating the rebel leader mid-war collapses
  //  rebel fatigue/readiness (relations.js's own onOfficialDeath precedent).
  // ============================================================
  if (CBZ.onOfficialDeath) {
    CBZ.onOfficialDeath(function (rec, sid, ped) {
      try {
        const S = state();
        for (const parentId in S.fractures) {
          const fr = S.fractures[parentId];
          if (!rec || rec.id !== fr.rebelId) continue;
          const w = findWar(fr);
          if (w && !w.ended) w.fatigue[fr.rebelId] = (w.fatigue[fr.rebelId] || 0) + LEADER_DEATH_FATIGUE_SPIKE;
          const rMil = CBZ.polwar.militaryOf(fr.rebelId);
          rMil.readiness = clampNum(0.05, 1, rMil.readiness - LEADER_DEATH_READINESS_HIT);
          if (CBZ.cityFeed) CBZ.cityFeed("💀 Rebel leader " + ((ped && ped.name) || "?") + " is dead — the uprising reels.", "#ff6a5e");
        }
      } catch (e) {}
    });
  }

  // ============================================================
  //  DAILY TICK
  // ============================================================
  function dailyTick(day) {
    ensureInit();
    try { districtDrivenCheck(day); } catch (e) { try { console.error("[civilwar] district check failed", e); } catch (e2) {} }
    try { statisticalCheck(day); } catch (e) { try { console.error("[civilwar] statistical check failed", e); } catch (e2) {} }
    try { checkCoups(day); } catch (e) { try { console.error("[civilwar] coup check failed", e); } catch (e2) {} }
    const S = state();
    for (const parentId in S.fractures) {
      try { tickFractureExtras(S.fractures[parentId], day); }
      catch (e) { try { console.error("[civilwar] fracture tick failed", parentId, e); } catch (e2) {} }
    }
  }
  if (CBZ.onNewDay) CBZ.onNewDay(dailyTick);

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.civilwar = {
    unrest: unrest,
    fractureOf: activeFractureFor,
    activeFractures: function () { const out = []; const S = state(); for (const k in S.fractures) out.push(S.fractures[k]); return out; },
    partitionsOf: function () { return Object.assign({}, state().partitions); },
    reset: reset,
    TUNING: {
      MISERY_DISTRICT_T: MISERY_DISTRICT_T, TRIGGER_DISTRICTS_MIN: TRIGGER_DISTRICTS_MIN, APPROVAL_T: APPROVAL_T, UNREST_DAYS: UNREST_DAYS,
      TRAPPED_T: TRAPPED_T, REPRESSION_COOLDOWN_DAYS: REPRESSION_COOLDOWN_DAYS,
      COUP_APPROVAL_T: COUP_APPROVAL_T, COUP_READINESS_T: COUP_READINESS_T, COUP_DAILY_CHANCE: COUP_DAILY_CHANCE, COUP_COOLDOWN_DAYS: COUP_COOLDOWN_DAYS,
      COUP_SUCCESS_P: COUP_SUCCESS_P, COUP_FAILURE_P: COUP_FAILURE_P,
      REBEL_TREASURY_FRAC: REBEL_TREASURY_FRAC, STALEMATE_DAYS: STALEMATE_DAYS, PARTITION_HELD_T: PARTITION_HELD_T,
      WARLORDISM_READINESS_T: WARLORDISM_READINESS_T, WARLORDISM_TREASURY_T: WARLORDISM_TREASURY_T, WARLORDISM_MIN_DAYS: WARLORDISM_MIN_DAYS,
      LEADER_DEATH_FATIGUE_SPIKE: LEADER_DEATH_FATIGUE_SPIKE,
    },
    // harness/test-only hooks — not part of the public contract (mirrors
    // regimes.js's own _forceGov / polwar.js's own _forceDesperate precedent).
    _state: state, _districtMisery: districtMisery, _computeTriggerDistricts: computeTriggerDistricts,
    _tick: dailyTick, _findWar: findWar, _fracture: fracture,
    _forceUprising: function (id, opts) { return fracture(id, Object.assign({ cause: "uprising" }, opts || {})); },
    _forceCoup: function (id, kind) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null;
      if (!rec) return null;
      return applyCoupOutcome(rec, kind);
    },
    // isolated math hooks — the full daily _tick also runs P8's own
    // casualty/front/fatigue pass, which confounds an isolated arithmetic
    // assertion on defection/meddling/atrocity math alone (matches polwar's
    // own _combatPower/_findCausewayBetween "expose the pure step" precedent).
    _tickDefection: tickDefection, _tickMeddling: tickMeddling, _tickAtrocity: tickAtrocity,
    _tickRebelConscription: tickRebelConscription, _resolveEndingIfDue: resolveEndingIfDue,
  };
  CBZ.civilwarReset = reset;

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const S = state();
    const fractures = {};
    for (const parentId in S.fractures) {
      const rec = S.fractures[parentId];
      const rebelRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(rec.rebelId) : null;
      fractures[parentId] = {
        parentId: rec.parentId, rebelId: rec.rebelId, cause: rec.cause, warId: rec.warId,
        districts: rec.districts ? rec.districts.slice() : null, heldFraction: rec.heldFraction,
        startDay: rec.startDay, coupTookCapital: !!rec.coupTookCapital, collapseDays: rec._collapseDays || 0,
        rebelName: rebelRec ? rebelRec.name : rec.rebelId, rebelGov: rebelRec ? rebelRec.govType : "insurgency",
        rebelWealth: rebelRec && rebelRec.wealthLevel != null ? rebelRec.wealthLevel : 0.5,
        rebelRect: rebelRec && rebelRec.rect ? { cx: rebelRec.rect.cx, cz: rebelRec.rect.cz, hx: rebelRec.rect.hx, hz: rebelRec.rect.hz } : null,
      };
    }
    const partitions = {};
    for (const rebelId in S.partitions) {
      const p = S.partitions[rebelId];
      const rebelRec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(rebelId) : null;
      partitions[rebelId] = {
        parentId: p.parentId, day: p.day,
        name: rebelRec ? rebelRec.name : rebelId, govType: rebelRec ? rebelRec.govType : "insurgency",
        wealthLevel: rebelRec && rebelRec.wealthLevel != null ? rebelRec.wealthLevel : 0.5,
        rect: rebelRec && rebelRec.rect ? { cx: rebelRec.rect.cx, cz: rebelRec.rect.cz, hx: rebelRec.rect.hx, hz: rebelRec.rect.hz } : null,
      };
    }
    return {
      v: 1,
      unrestDays: Object.assign({}, S.unrestDays), cooldownUntil: Object.assign({}, S.cooldownUntil),
      coupCooldown: Object.assign({}, S.coupCooldown), nextRebelSeq: S.nextRebelSeq,
      fractures: fractures, partitions: partitions,
    };
  }
  // preRegister(obj) — MUST run before CBZ.polity.apply() (see header): a
  // fresh boot's polity.records table has never heard of a runtime-created
  // fragment/partition id, and polity.apply() silently skips unknown ids.
  function preRegister(obj) {
    if (!obj || !CBZ.polity || !CBZ.polity.registerCountry) return;
    if (obj.fractures) for (const parentId in obj.fractures) {
      const f = obj.fractures[parentId]; if (!f || !f.rebelId) continue;
      const rr = CBZ.polity.registerCountry({ id: f.rebelId, name: f.rebelName, govType: f.rebelGov, wealthLevel: f.rebelWealth });
      if (rr && f.rebelRect) rr.rect = { cx: f.rebelRect.cx, cz: f.rebelRect.cz, hx: f.rebelRect.hx, hz: f.rebelRect.hz };
    }
    if (obj.partitions) for (const rebelId in obj.partitions) {
      const p = obj.partitions[rebelId]; if (!p) continue;
      const rr = CBZ.polity.registerCountry({ id: rebelId, name: p.name, govType: p.govType, wealthLevel: p.wealthLevel });
      if (rr && p.rect) rr.rect = { cx: p.rect.cx, cz: p.rect.cz, hx: p.rect.hx, hz: p.rect.hz };
    }
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const S = state();
    if (obj.unrestDays) for (const id in obj.unrestDays) S.unrestDays[id] = +obj.unrestDays[id] || 0;
    if (obj.cooldownUntil) for (const id in obj.cooldownUntil) S.cooldownUntil[id] = +obj.cooldownUntil[id] || 0;
    if (obj.coupCooldown) for (const id in obj.coupCooldown) S.coupCooldown[id] = +obj.coupCooldown[id] || 0;
    S.nextRebelSeq = obj.nextRebelSeq || 1;
    if (obj.fractures) for (const parentId in obj.fractures) {
      const f = obj.fractures[parentId]; if (!f) continue;
      S.fractures[parentId] = {
        parentId: f.parentId || parentId, rebelId: f.rebelId, cause: f.cause || "uprising", warId: f.warId || null,
        districts: Array.isArray(f.districts) ? f.districts.slice() : null,
        heldFraction: isFinite(f.heldFraction) ? +f.heldFraction : null,
        startDay: f.startDay || 0, coupTookCapital: !!f.coupTookCapital, _collapseDays: f.collapseDays || 0,
      };
    }
    if (obj.partitions) for (const rebelId in obj.partitions) {
      const p = obj.partitions[rebelId]; if (!p) continue;
      S.partitions[rebelId] = { parentId: p.parentId, day: p.day || 0 };
    }
  }
  CBZ.civilwar.serialize = serialize;
  CBZ.civilwar.apply = apply;
  CBZ.civilwar.preRegister = preRegister;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — TWO ticks (see header): an EARLY one
  //  (preRegister, before polity.js's own 46.03 hydrate) and a LATE one
  //  (the full apply, after every other P/X-wave module's own hydrate).
  //  One-shot install guard (module-local boolean, checked BEFORE ever
  //  wrapping — the P5 chain-growth fix's own convention, copied verbatim).
  // ------------------------------------------------------------
  function stampCwar() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cwar = serialize();
  }
  let _ensureCwarSaveWraps_done = false;
  function ensureCwarSaveWraps() {
    if (_ensureCwarSaveWraps_done) return;
    _ensureCwarSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._cwarWrap) {
      const w = function () { stampCwar(); return commit.apply(this, arguments); };
      w._cwarWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._cwarWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampCwar(); return col.apply(this, arguments); };
      wc._cwarWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedEarly = null;
  let _hydratedLate = null;
  if (CBZ.onUpdate) {
    // 46.02 — one slot before polity.js's own 46.03 hydrate tick.
    CBZ.onUpdate(46.02, function () {
      if (!g) return;
      const led = g.cityWorld;
      if (!led || led === _hydratedEarly) return;
      _hydratedEarly = led;
      if (led.cwar) preRegister(led.cwar);
    });
    // 46.21 — after migration.js's own 46.19 hydrate and countries.js's 46.2.
    CBZ.onUpdate(46.21, function () {
      if (!g) return;
      ensureCwarSaveWraps();
      const led = g.cityWorld;
      if (!led || led === _hydratedLate) return;
      _hydratedLate = led;
      if (led.cwar) apply(led.cwar);
    });
  }
})();
