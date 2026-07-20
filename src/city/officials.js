/* ============================================================
   city/officials.js — Stage P, step P2: MAYOR ROSA VALE AS A REAL,
   SCHEDULED, GUARDED, ASSASSINABLE NPC + THE SUCCESSION MACHINE.

   MASTER-PLAN V.2 (offices/succession, verbatim): "Officeholders are real
   ledger NPCs (new cast key "official" in schedule.js's castKey/actOf):
   city-hall hours, a 17:00-19:00 public-appearance window (podium + crowd),
   motorcades with bodyguard escorts... Assassination is free — they're
   ordinary peds, so cityKillPed routes it: max heat, panic (cityPostEvent),
   cityEvent("assassination"), and the succession state machine: deputy
   sworn (if stability >= 0.3) -> else snap election in 2 game-days -> else
   power vacuum: the strongest gang's boss becomes de-facto ruler and
   govType -> anarchism until restored. NPC death is already permanent
   (ledger dropSid), so a dead mayor stays dead." It also promotes the
   dormant stub worldstate.js:70 (politics.official = "Mayor Rosa Vale")
   and the existing "assassination" cityEvent (worldstate.js:265-271).

   THIS WAVE'S DELIBERATE NARROWING (P4 shipped elections; P5 below finishes
   the physical-presence half):
   - No stability-gated deputy check, no gang-boss-becomes-ruler branch, no
     govType flip to anarchism — this wave's vacancy resolution is still:
     deputy sworn in if one exists, else a flat POWER VACUUM that P4's
     election machinery resolves (worldDay-flagged for it).
   - castKey/actOf (schedule.js:66-120) is NOT given a new "official" key —
     officials are PARKED ledger identities exactly like billionaires.js's
     founders (never spawned by the normal daily-schedule deal-in machinery;
     schedule.js's own offline sweep just quietly fast-forwards their (empty,
     archetype-unmatched) "drifter" cast bucket, same as any identity with no
     job the ledger recognises — harmless). Physical presence is driven
     entirely by THIS file's own tick, same shape as billionaires.js's
     MAGNATE tie-in: a body is manufactured on demand and its `_sid` is
     hand-assigned to the CURRENT officeholder's sid, read fresh off
     polity.js every time — so a succession (deputy sworn in, or an election)
     is picked up for free the next time a body is needed; this file never
     hard-codes which sid is "the mayor".

   P5 — SECRET SERVICE (MASTER-PLAN V.2b): every office with a findable city
   hall now gets a body, not just the mayor. The PHYSICAL PRESENCE section
   below is generalized from "the mayor, hardcoded" to "every office record
   whose city hall is the one in the CURRENTLY LOADED arena" — since only one
   arena is ever loaded at a time, that is always the LOCAL mayor plus, when
   this happens to be a state or country's CAPITAL city (see capitalCityOf()
   below), that state's governor and/or that country's president too (up to
   all three at once — libertyville is both). Detail sizing/gear/rarity are
   table-driven by office KIND (KIND_PRESENCE below); the guard SPAWN/FOLLOW/
   TEARDOWN lifecycle this file used to hand-roll (moveToward/driveGuards,
   a hardcoded 2-guard SMG detail) now lives in city/protection.js's
   ProtectionDetail record — this file calls THROUGH it (spawnMembers/
   driveEscort/despawnMembers/notePrincipalHp) and keeps only what it alone
   knows: WHEN a body should exist (office hours window, distance-to-player,
   succession swaps, the president/governor's rarer appearance roll). One
   protection.js detail per office record, id "off_"+rec.id, created
   idempotently (protection.js's create() hands back an existing one by id —
   so a save's escalated headcount survives a mourn/redeploy cycle, or a
   reload, without a duplicate detail ever getting minted).

   MINTING (billionaires.js's founder-minting shape, reused verbatim):
   a synthetic, NEVER-SPAWNED "ped" object stashed straight into schedule.js's
   offline ledger via CBZ.cityPedStash with `_parked:true` (skips the
   position-anchor block entirely — schedule.js:267) and `nameKnown:true`
   (schedule.js worth() gate passes regardless of cash). The mayor is minted
   with the EXACT name the dormant stub already promised players
   (worldstate.js:70 "Mayor Rosa Vale") — the one piece of this file that
   is NOT randomly rolled.

   PHYSICAL PRESENCE (own tick, order 35.73 — right after sim/billionaires.js's
   35.72, so both "who's embodied right now" checks run back to back): while
   in city mode, if city hall's door can be found in the live arena, the sun
   hour (schedule.js's CBZ.citySunHour) is 9-17 (city hall) or 17-19 (the
   public appearance, walked to a fixed offset near city hall — a real
   park/plaza lookup is a nice-to-have this wave, not a requirement, so a
   fixed point IS the flavor), and the player is within ~80m of that point,
   a body is manufactured (CBZ.cityMakePed) for the mayor + two armed
   "security" bodyguards. Movement is the SIMPLEST follow mechanism in the
   codebase, generalized: social.js's own companion-follow tick
   (CBZ.onUpdate(34.6), "follow" closure ~1319-1334) drives a controlled ped
   by computing a target point and stepping `pos` toward it directly (no
   pathfinding, no aigoals goal) — this file's moveToward()/driveGuards()
   below are that exact shape, aimed at the mayor instead of the player (the
   full vips.js ProtectionDetail machinery — drafted bodies, threat-scan,
   gang-provoke ties, club ropes — is deliberately NOT reused: it is a
   4-archetype rotation coupled tightly to its own CAST table and slot
   lifecycle, and grafting a 5th "official" archetype into it would mean
   fighting its cast-rotation/threat/gawk logic for a body that must track
   ONE SPECIFIC sid (the current officeholder) rather than "whichever
   principal the rotation drafted this shift" — the plan's own P5 note says
   this convergence is future work, not this wave's).

   ASSASSINATION -> SUCCESSION (own cityKillPed wrap, loaded LAST in the
   P-wave so it wraps outermost — same "capture off the live ped BEFORE
   orig() runs, act after" discipline as inheritance.js/billionaires.js):
     (a) worldstate: CBZ.cityEvent("assassination", …) — the EXISTING path
         (worldstate.js:265-271) already does scandal += 18, emergencyPowers
         += 10; this file does not hand-roll those numbers a second time.
     (b) succession: deputy alive -> office.holder = deputy, office.deputy =
         null, feed "Deputy sworn in"; no deputy -> office vacant + POWER
         VACUUM (approval -15, feed, rec.vacuum = worldDay stamped on the
         LIVE polity record so P4's snap-election machinery can find it by
         grep `office.termDay`/`.vacuum` the same way polity.js's own header
         says to). The dead officeholder's own OTHER slot (deputy killed,
         not the holder) just clears that slot — no vacancy, the holder still
         governs.
     (c) city.big headline.
     (d) CBZ.cityCrime(300, {type:"murder"}) — max heat, same call shape
         worldstate.js's applyCommon already routes crimeHeat through.

   NEW-DAY HOOK (CBZ.onNewDay, polity.js's own worldDay subscriber list):
     - termDay reached, no election system yet (P4) -> silently +TERM_DAYS
       (comment: P4 replaces this with a real election).
     - a jurisdiction flagged .vacuum for >= 2 worldDays with STILL no
       deputy -> auto-appoint a caretaker (mint a fresh holder identity) —
       "the world heals" (comment: P4 replaces this with snap elections).

   PERSISTENCE: two riders, familytree.js/polity.js's own exact pattern.
   Office holder/deputy/termDay already ride polity.js's OWN serialize() (its
   header says so verbatim) — this file's serialize() only carries what IT
   owns: the minted-sid roster (so a reload doesn't re-mint a second mayor
   on top of a restored save) + the vacancy-day map (polity.js's serialize
   does NOT carry `.vacuum` — P1 shipped before P2 existed — so this file
   re-stamps `.vacuum` onto the live records at hydrate time from its own
   copy, same "own state carries what the shared record can't" split
   econstate.js/polity.js already use for the `.econ` cross-reference).
   PHYSICAL presence (the spawned body, guards) is runtime-only and never
   persisted — a reload simply re-materializes on the next qualifying tick,
   exactly like billionaires.js's `_embodied` map.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  const INITIAL_SEED = 240685133 & 0x7fffffff;
  let _seed = INITIAL_SEED;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }

  // ---- office roster: X3 generalized this off the original hardcoded
  // 5-id list (libertyville/liberty/costa/westmark/republic) to EVERY
  // city/state/country/federal polity record, so city/countries.js's new
  // nations mint officials for free with zero edits here the next time one
  // is registered. Term length is by KIND (V.2: "mayor 7d, governor 14d,
  // president 28d" — federal reuses the state-tier 14d, no V.2 number was
  // ever specified for Fort Brandt). Title/job is by KIND + govType + tier,
  // not a per-id map: a "city" record is "Mayor" unless its tier says
  // "village" ("Chief"); a "country" record is "President" unless its
  // govType says "monarchy" (King/Queen, by the CURRENT holder's rolled
  // gender — see titleFor()); "state"/"federal" stay "Governor" (no distinct
  // federal-territory title exists yet).
  const MAYOR_ID = "libertyville";   // still used to seed the founding mayor's identity wealth (see mintHolder) — P5 generalized the PHYSICAL PRESENCE section below off every office, not just this one
  const KIND_TERM_DAYS = { city: 7, state: 14, federal: 14, country: 28 };
  function termDaysFor(rec) { return (rec && KIND_TERM_DAYS[rec.kind]) || 7; }
  function titleFor(rec) {
    if (!rec) return "Official";
    if (rec.kind === "country") {
      if (rec.govType !== "monarchy") return "President";
      const gender = rec.office && rec.office.holder ? identityOf(rec.office.holder).gender : "f";
      return gender === "f" ? "Queen" : "King";
    }
    if (rec.kind === "state" || rec.kind === "federal") return "Governor";
    if (rec.kind === "city") return rec.tier === "village" ? "Chief" : "Mayor";
    return "Official";
  }
  function jobFor(rec) { return titleFor(rec).toLowerCase(); }
  const CARETAKER_DAYS = 2;   // V.2: "power vacuum ... the world heals" — P4 replaces with real elections

  // ---- X6: relations.js listens for officeholder deaths (own subscriber
  // list, polity.js's onNewDay shape) — the ONLY change this file makes for
  // that wave: no other line here knows relations.js exists.
  const officialDeathSubs = [];
  CBZ.onOfficialDeath = function (fn) { if (typeof fn === "function") officialDeathSubs.push(fn); };

  // ---- state: g.officials (own guard for the one-shot mint pass) ----------
  function reset() {
    g.officials = { inited: false, mayorSid: null, deputySid: null, govSids: {}, presidentSid: null, vacantSince: {} };
    for (const id in presences) delete presences[id];   // physical presence is runtime-only (see PHYSICAL PRESENCE header)
  }
  function ensureState() {
    if (!g.officials) g.officials = { inited: false, mayorSid: null, deputySid: null, govSids: {}, presidentSid: null, vacantSince: {} };
    if (!g.officials.govSids) g.officials.govSids = {};
    if (!g.officials.vacantSince) g.officials.vacantSince = {};
    return g.officials;
  }

  // ---- identity minting: billionaires.js's mintIdentity(), verbatim shape -
  function mintIdentity(fields) {
    if (!CBZ.cityPedStash) return null;
    const obj = Object.assign({ _parked: true, nameKnown: true, kind: "civilian" }, fields);
    CBZ.cityPedStash(obj);
    return obj._sid ? obj : null;
  }
  function mintName(gender) {
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender);
    return gender === "f" ? "Adelaide Winthrop" : "Foster Winthrop";   // no-name fallback (should never hit)
  }
  // sid -> a readable name/gender, reading the LIVE body first (billionaires.js's
  // nameOf() pattern) so a name still resolves after this sid's own parked page
  // has been fast-forwarded, or if a later wave ever spawns this identity for
  // real through the normal ledger.
  function identityOf(sid) {
    if (!sid) return { name: "Someone", gender: "f" };
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return { name: live.name, gender: live.gender === "f" ? "f" : "m" };
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    if (e && e.name) return { name: e.name, gender: e.sex === 1 ? "f" : "m" };
    return { name: "Someone", gender: "f" };
  }
  function nameOf(sid) { return identityOf(sid).name; }

  // ============================================================
  //  MINT (one-shot, lazy — guarded per-record so a restored save's
  //  office.holder is never overwritten, same gate as billionaires.js's
  //  mintFounderFor's `if (co.founderSid) return;`)
  // ============================================================
  function mintHolder(rec, founding) {
    if (!rec || rec.office.holder) return;   // already minted or restored from a save
    const id = rec.id;
    const isMayor = id === MAYOR_ID;
    // MASTER-PLAN promotes worldstate.js:70's dormant stub verbatim — but only
    // for the FOUNDING mayor (the one minted at world boot). A caretaker who
    // fills the seat after Rosa Vale's own death (the onNewDay hook, below)
    // is a brand-new person with a rolled name — "Rosa Vale" is a specific
    // dead woman by then, not a job title.
    const useStubName = isMayor && founding;
    const gender = useStubName ? "f" : (rng() < 0.5 ? "f" : "m");
    // X1 (owner call): NO stub names — every official, founding mayors
    // included, gets a minted name like every other person in the world.
    // The old worldstate "Mayor Rosa Vale" flavor string stays retired.
    const name = mintName(gender);
    // job label: titleFor() needs rec.office.holder set to read the JUST-
    // rolled gender for a monarchy's King/Queen pick, so mint the identity
    // with a generic "official" job first, then correct it below once the
    // holder is live (mirrors elections.js's own post-mint job stamp).
    const official = mintIdentity({
      name: name, gender: gender, archetype: "official", job: "official",
      wealth: isMayor ? 0.7 : (rec.wealthLevel != null ? 0.5 + 0.4 * rec.wealthLevel : 0.8),
      aggr: 0.12, cash: 2000 + Math.round(rng() * 6000),
    });
    if (!official) return;
    const sid = official._sid;
    rec.office.holder = sid;
    rec.office.termDay = (CBZ.worldDay ? CBZ.worldDay() : 0) + termDaysFor(rec);
    rec.vacuum = null;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    if (e) e.job = jobFor(rec);   // now that office.holder is live, titleFor() resolves the real (govType/gender-aware) title
    const S = ensureState();
    if (isMayor) {
      S.mayorSid = sid;
      // DEPUTY: every "city"-kind office (mayor AND village chiefs) gets one
      // — X3 generalized this off "only the mayor" so a village chief's
      // death has the same deputy-succession path as libertyville's.
      const depGender = rng() < 0.5 ? "f" : "m";
      const dep = mintIdentity({
        name: mintName(depGender), gender: depGender, archetype: "official", job: "deputy " + jobFor(rec),
        wealth: 0.55, aggr: 0.1, cash: 1000 + Math.round(rng() * 3000),
      });
      if (dep) { rec.office.deputy = dep._sid; S.deputySid = dep._sid; }
    } else if (rec.kind === "city") {
      // every OTHER city (mini-cities, and X3's countries' towns/villages)
      // also gets a deputy, keyed generically alongside governors/presidents.
      const depGender = rng() < 0.5 ? "f" : "m";
      const dep = mintIdentity({
        name: mintName(depGender), gender: depGender, archetype: "official", job: "deputy " + jobFor(rec),
        wealth: 0.5, aggr: 0.1, cash: 800 + Math.round(rng() * 2500),
      });
      if (dep) { rec.office.deputy = dep._sid; S.govSids["deputy:" + id] = dep._sid; }
      S.govSids[id] = sid;
    } else {
      S.govSids[id] = sid;
    }
  }
  function mintAllOfficials() {
    if (!CBZ.polity || typeof CBZ.polity.get !== "function") return false;
    const recs = allOfficeRecords();
    for (let i = 0; i < recs.length; i++) mintHolder(recs[i], true);   // founding mint (rolled name — X1)
    ensureState().inited = true;
    return true;
  }
  // order 46.08 — after this file's OWN hydrate tick (46.06, below) within the
  // same frame (a restored save's office.holder/deputy already sit on the
  // polity records by then — polity.js's own hydrate runs at 46.03, strictly
  // before either of this file's ticks), and after billionaires.js's mint
  // check (46.0) so this file's install order never depends on it.
  CBZ.onUpdate(46.08, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    ensureState();
    if (g.officials.inited) return;
    try { mintAllOfficials(); } catch (e) {}
  });

  // ============================================================
  //  EVERY OFFICE: succession lookup (X3: generic over EVERY city/state/
  //  country/federal record, not just the original five — a governor,
  //  village chief, or king can be killed and succeeded the moment a body
  //  exists for them; P5's PHYSICAL PRESENCE section below now spawns one for
  //  every office whose city hall is reachable — see that section's header).
  // ============================================================
  function allOfficeRecords() {
    if (!CBZ.polity) return [];
    return [].concat(
      CBZ.polity.list("city"), CBZ.polity.list("state"), CBZ.polity.list("country"), CBZ.polity.list("federal"));
  }
  function officeOf(sid) {
    if (!sid) return null;
    const recs = allOfficeRecords();
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r || !r.office) continue;
      if (r.office.holder === sid) return { rec: r, asDeputy: false };
      if (r.office.deputy === sid) return { rec: r, asDeputy: true };
    }
    return null;
  }

  function handleOfficialDeath(ped, sid) {
    const info = officeOf(sid);
    if (!info) return;
    const rec = info.rec;
    const title = titleFor(rec);
    const victimName = (ped && ped.name) || nameOf(sid);

    // (a) worldstate: the EXISTING "assassination" path (scandal/emergencyPowers
    // already applied there — see header, worldstate.js:265-271) + max heat.
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("assassination", { label: title + " " + victimName + " assassinated", heat: 40 }, { silent: true }); }
      catch (e) {}
    }

    // (b) SUCCESSION
    if (info.asDeputy) {
      // the DEPUTY died, not the holder — the office isn't vacant, just the
      // slot is. No vacuum, holder keeps governing.
      rec.office.deputy = null;
    } else if (rec.office.deputy) {
      const depSid = rec.office.deputy;
      const depName = nameOf(depSid);
      rec.office.holder = depSid;
      rec.office.deputy = null;
      if (CBZ.cityFeed) CBZ.cityFeed("Deputy " + depName + " sworn in as " + title + " of " + rec.name, "#8fc1ff");
    } else {
      rec.office.holder = null;
      const day = CBZ.worldDay ? CBZ.worldDay() : 0;
      rec.vacuum = day;
      ensureState().vacantSince[rec.id] = day;
      rec.approval = Math.max(0, (rec.approval || 0) - 15);
      if (CBZ.cityFeed) CBZ.cityFeed("POWER VACUUM in " + rec.name, "#ff6a5e");
    }

    // (c) headline
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + title + " " + victimName + " ASSASSINATED");

    // (d) max heat — same call shape worldstate.js's own crimeHeat routes through.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(300, { type: "murder" }); } catch (e) {} }

    // (e) X6: notify relations.js (and any future subscriber) — the actual
    // country-degradation logic lives entirely over there, not here.
    for (let i = 0; i < officialDeathSubs.length; i++) { try { officialDeathSubs[i](rec, sid, ped); } catch (e) {} }

    // if this was the mayor's own physical body, let the presence tick's
    // "principal.dead" branch handle the mourn/despawn — nothing more to do here.
  }

  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._offWrap) {
    const orig = CBZ.cityKillPed;
    const wrapped = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const wasDead = !ped || ped.dead;
      const ret = orig.apply(this, arguments);
      if (sid && !wasDead && ped && ped.dead) {
        try { handleOfficialDeath(ped, sid); } catch (e) {}
      }
      return ret;
    };
    wrapped._offWrap = true;
    CBZ.cityKillPed = wrapped;
  }

  // ============================================================
  //  NEW-DAY HOOK: term auto-extend (no elections yet) + caretaker healing.
  // ============================================================
  if (CBZ.onNewDay) {
    CBZ.onNewDay(function (day) {
      if (!CBZ.polity) return;
      if (CBZ.elections) return;   // P4: a real election system exists now — this
      // file's own term-extend/caretaker stub defers entirely to it (see this
      // file's header + city/elections.js's own header for the coordination).
      const S = ensureState();
      const recs = allOfficeRecords();   // X3: every office, not the old fixed 5-id list
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        const id = rec.id;
        // term reached, no election system yet (P4) -> silently extend.
        if (rec.office.termDay != null && day >= rec.office.termDay) {
          rec.office.termDay = day + termDaysFor(rec);
        }
        // vacant with no deputy for CARETAKER_DAYS+ -> auto-appoint (P4
        // replaces this with a real snap election).
        const since = S.vacantSince[id];
        if (since == null) continue;
        if (rec.office.holder) { delete S.vacantSince[id]; continue; }   // already resolved elsewhere
        if (day - since >= CARETAKER_DAYS) {
          mintHolder(rec, false);
          delete S.vacantSince[id];
          if (CBZ.cityFeed) CBZ.cityFeed("" + nameOf(rec.office.holder) + " appointed caretaker " + titleFor(rec) + " of " + rec.name, "#ffd76a");
        }
      }
    });
  }

  // ============================================================
  //  PHYSICAL PRESENCE — every office whose city hall is the one in the
  //  CURRENTLY LOADED arena (see header). Runtime-only, never persisted
  //  (billionaires.js's `_embodied` pattern) — the `presences` map below is
  //  keyed by polity record id and rebuilt from scratch on demand; what
  //  SURVIVES a reload is each office's ProtectionDetail (city/protection.js,
  //  keyed "off_"+rec.id, escalated headcount and all).
  // ============================================================
  const PRESENCE_RADIUS = 80;
  const HALL_SPEED = 1.55;
  // per-office-KIND sizing (MASTER-PLAN V.2b: "the president's detail
  // (governors/mayors get smaller ones scaled by office)... elite gear tier
  // through the existing armor system, treasury-funded... grows after failed
  // attempts"). rarity: the fraction of qualifying office-hours checks that
  // actually roll the officeholder OUT today — the mayor runs city hall daily
  // (1.0, unchanged from pre-P5 behaviour); a governor's an occasional
  // visitor to any one city in the state; the head of state rarer still
  // ("10% of office-hours checks" per the plan, verbatim for country).
  const KIND_PRESENCE = {
    city: { count: 2, gearTier: 1, rarity: 1.0, wealth: 0.7 },
    state: { count: 2, gearTier: 1, rarity: 0.3, wealth: 0.78 },
    country: { count: 4, gearTier: 2, rarity: 0.1, wealth: 0.9 },
  };
  const presences = Object.create(null);   // rec.id -> {state, principal, mode, mournT, _rollPhase, _rollShow}

  function arena() { return CBZ.city && CBZ.city.arena; }
  function cityHallDoor(A) {
    const lots = (A && A.shopLots) || [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l.kind === "cityhall" && l.building && l.building.door) return l.building.door;
    }
    return null;
  }
  // nearest park lot to the door, else a fixed offset — "flavor positioning
  // only this wave" per the plan; a real crowd/podium moment is later work.
  function plazaPoint(A, door) {
    const lots = (A && A.lots) || [];
    let best = null, bd = Infinity;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (l.kind !== "park") continue;
      const d = Math.hypot(l.cx - door.x, l.cz - door.z);
      if (d < bd) { bd = d; best = l; }
    }
    if (best) return { x: best.cx, z: best.cz };
    return { x: door.x + 18, z: door.z + 18 };
  }
  function hallPoint(door) { return { x: door.x - door.nx * 2.4, z: door.z - door.nz * 2.4 }; }
  // hours 9-17 city hall, 17-19 the public appearance walk, else no presence
  // — the SAME office-hours window at every level this wave (a president or
  // governor "visiting" a city hall keeps that city's own business hours;
  // a distinct national calendar is future work, not this wave's).
  function phaseFor(h) {
    if (h >= 9 && h < 17) return "hall";
    if (h >= 17 && h < 19) return "plaza";
    return "none";
  }
  function targetPointFor(phase, A, door) {
    if (!door) return null;
    return phase === "plaza" ? plazaPoint(A, door) : hallPoint(door);
  }

  // the FIRST-registered city (insertion order — plain objects preserve it)
  // whose parent chain reaches `rec` is that state/country's CAPITAL for
  // this wave's purposes (polity.js has no dedicated `.capital` field yet —
  // this is a deterministic, zero-storage stand-in: libertyville is liberty's
  // and the republic's, goldspire is costa's, neonreef is westmark's, and
  // every X3 country/state gets its own first-registered settlement for
  // free). A governor/president only ever appears at THIS one city; every
  // other city in their jurisdiction only ever sees its own mayor.
  function capitalCityOf(rec) {
    if (!rec) return null;
    if (rec.kind === "city") return rec;
    if (!CBZ.polity) return null;
    const cities = CBZ.polity.list("city");
    for (let i = 0; i < cities.length; i++) {
      let r = cities[i];
      while (r) { if (r.id === rec.id) return cities[i]; r = r.parent ? CBZ.polity.get(r.parent) : null; }
    }
    return null;
  }
  // which office records could plausibly show up at THIS arena's one city
  // hall this frame: always the local city; plus its state's governor and/or
  // its country's president IFF this city is that jurisdiction's capital
  // (see capitalCityOf) — so at most 3 offices ever share one building,
  // and libertyville (mayor+governor+president all at once) is the richest
  // case, not the only one, the moment X3's other countries grow multi-city
  // states of their own.
  function candidatesForDoor(door) {
    if (!CBZ.polity) return [];
    const cityRec = CBZ.polity.of(door.x, door.z);
    if (!cityRec || cityRec.kind !== "city") return [];
    const out = [{ rec: cityRec, kind: "city" }];
    const stateRec = CBZ.polity.stateOf(cityRec.id);
    if (stateRec && stateRec.kind === "state" && capitalCityOf(stateRec) === cityRec) out.push({ rec: stateRec, kind: "state" });
    const countryRec = CBZ.polity.countryOf(cityRec.id);
    if (countryRec && capitalCityOf(countryRec) === cityRec) out.push({ rec: countryRec, kind: "country" });
    return out;
  }

  function removePed(p) {
    if (!p) return;
    try {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (CBZ.cityPeds) { const i = CBZ.cityPeds.indexOf(p); if (i >= 0) CBZ.cityPeds.splice(i, 1); }
    } catch (e) {}
  }
  function despawnPresence(pr) {
    removePed(pr.principal);
    const det = CBZ.protection && CBZ.protection.get ? CBZ.protection.get("off_" + pr.recId) : null;
    if (det && CBZ.protection.despawnMembers) CBZ.protection.despawnMembers(det);
    pr.state = "none"; pr.principal = null; pr.mode = null; pr.mournT = 0;
  }

  function driveOfficeholder(pr, A, phase, dt) {
    const door = cityHallDoor(A);
    const tp = door ? targetPointFor(phase, A, door) : { x: pr.pos.x, z: pr.pos.z };
    CBZ.protection.moveToward(pr, tp.x, tp.z, HALL_SPEED, dt);
  }

  // this office's ProtectionDetail — idempotent by id (protection.js's
  // create() hands back an existing record for a repeated id), so calling
  // this every frame/spawn is cheap and never mints a duplicate. Re-points
  // principal.ref at the CURRENT holder every call (successions) and never
  // lets memberCount shrink below the office's base size (only attempt
  // escalation, city/protection.js's notePrincipalHp, grows it further).
  function officeDetailFor(rec, kind) {
    if (!CBZ.protection) return null;
    const cfg = KIND_PRESENCE[kind];
    const det = CBZ.protection.create({
      id: "off_" + rec.id, principal: { kind: "sid", ref: rec.office.holder },
      gearTier: cfg.gearTier, formation: "escort", fundingSource: "treasury",
      legalStatus: "state", memberCount: cfg.count,
    });
    det.principal.ref = rec.office.holder;
    if (det.memberCount < cfg.count) det.memberCount = cfg.count;
    return det;
  }

  function spawnPresence(pr, rec, kind, A, holderSid, door, phase) {
    if (!CBZ.cityMakePed || !A || !A.root) return;
    const id = identityOf(holderSid);
    const cfg = KIND_PRESENCE[kind];
    const sp = targetPointFor(phase, A, door) || hallPoint(door);
    let p;
    try {
      p = CBZ.cityMakePed(sp.x, sp.z, rng, {
        name: id.name, gender: id.gender, archetype: "official", job: jobFor(rec), wealth: cfg.wealth, armed: false, aggr: 0.12,
      });
    } catch (e) { p = null; }
    if (!p) return;
    p._sid = holderSid; p.controlled = true; p.nameKnown = true; p.state = "idle"; p.speed = 0;
    A.root.add(p.group); CBZ.cityPeds.push(p);

    const det = officeDetailFor(rec, kind);
    if (det && CBZ.protection.spawnMembers) CBZ.protection.spawnMembers(det, A, sp.x, sp.z, rng);

    pr.state = "live"; pr.principal = p; pr.mode = phase; pr.mournT = 0;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("" + titleFor(rec) + " " + (id.name || "") + " is out, flanked by security.", 2.4);
  }

  function tickOffice(rec, kind, door, A, phase, dt) {
    let pr = presences[rec.id];
    if (!pr) pr = presences[rec.id] = { recId: rec.id, state: "none", principal: null, mode: null, mournT: 0, _rollPhase: null, _rollShow: true };
    const holderSid = rec.office.holder;

    if (pr.state === "mourn") {
      pr.mournT -= dt;
      const det = CBZ.protection && CBZ.protection.get ? CBZ.protection.get("off_" + rec.id) : null;
      if (det) for (let i = 0; i < det.memberPedRefs.length; i++) { const gd = det.memberPedRefs[i]; if (gd && !gd.dead) { gd.state = "idle"; gd.speed = 0; } }
      if (pr.mournT <= 0) despawnPresence(pr);
      return;
    }
    if (pr.state === "live") {
      const p = pr.principal;
      if (!p || (CBZ.cityPeds || []).indexOf(p) < 0) { despawnPresence(pr); return; }
      if (p.dead) { pr.state = "mourn"; pr.mournT = 4; return; }
      // succession swapped the officeholder out from under this body — drop
      // the old body; a fresh one embodies whoever holds office next time.
      if (p._sid !== holderSid) { despawnPresence(pr); return; }
      if (phase === "none") { despawnPresence(pr); return; }
      driveOfficeholder(p, A, phase, dt);
      const det = CBZ.protection && CBZ.protection.get ? CBZ.protection.get("off_" + rec.id) : null;
      if (det) {
        if (CBZ.protection.notePrincipalHp) CBZ.protection.notePrincipalHp(det, p);   // attempt escalation watch
        if (CBZ.protection.driveEscort) CBZ.protection.driveEscort(det, p, dt);
      }
      const tp = targetPointFor(phase, A, door);
      const P = CBZ.player;
      if (P && tp && Math.hypot(P.pos.x - tp.x, P.pos.z - tp.z) > PRESENCE_RADIUS * 1.5) despawnPresence(pr);
      return;
    }

    // state === "none": consider spawning.
    if (!holderSid || phase === "none") return;
    // RARITY: rolled once per (phase) WINDOW, not every frame — a governor/
    // president either is or isn't "in town" for the whole hall/plaza window,
    // never flickering frame to frame. The mayor's rarity is 1.0 so this is a
    // no-op for city-kind offices (unchanged pre-P5 behaviour).
    const cfg = KIND_PRESENCE[kind];
    if (pr._rollPhase !== phase) { pr._rollPhase = phase; pr._rollShow = rng() < cfg.rarity; }
    if (!pr._rollShow) return;
    const P = CBZ.player; if (!P) return;
    const tp = targetPointFor(phase, A, door);
    const d = Math.hypot(P.pos.x - tp.x, P.pos.z - tp.z);
    if (d > PRESENCE_RADIUS) return;
    spawnPresence(pr, rec, kind, A, holderSid, door, phase);
  }

  // order 35.73 — right after sim/billionaires.js's own 35.72 "who's embodied
  // right now" tick (both peek at cast/role state the same frame it changed).
  CBZ.onUpdate(35.73, function (dt) {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const A = arena(); if (!A) return;
    const door = cityHallDoor(A);
    if (!door) {
      // no city hall in this arena at all — mourn/teardown anything still live.
      for (const id in presences) { const pr = presences[id]; if (pr.state !== "none") despawnPresence(pr); }
      return;
    }
    const h = CBZ.citySunHour ? CBZ.citySunHour() : 12;
    const phase = phaseFor(h);
    const cands = candidatesForDoor(door);
    const seen = Object.create(null);
    for (let i = 0; i < cands.length; i++) {
      seen[cands[i].rec.id] = true;
      tickOffice(cands[i].rec, cands[i].kind, door, A, phase, dt);
    }
    // an office that no longer qualifies this frame (player warped arenas
    // between frames — the only way "candidates" changes underneath a live
    // presence) tears down too, same as a phase-out.
    for (const id in presences) { const pr = presences[id]; if (pr.state !== "none" && !seen[id]) despawnPresence(pr); }
  });

  // ============================================================
  //  PUBLIC API + PERSISTENCE
  // ============================================================
  CBZ.officials = {
    mayorSid: function () { ensureState(); return g.officials.mayorSid; },
    officeOf: officeOf,
    identityOf: identityOf,
    reset: reset,
    serialize: function () {
      ensureState();
      return {
        v: 1, inited: !!g.officials.inited,
        mayorSid: g.officials.mayorSid || null, deputySid: g.officials.deputySid || null,
        govSids: Object.assign({}, g.officials.govSids), presidentSid: g.officials.presidentSid || null,
        vacantSince: Object.assign({}, g.officials.vacantSince),
      };
    },
    apply: function (obj) {
      reset();
      if (!obj || obj.v !== 1) return;
      g.officials.inited = !!obj.inited;
      g.officials.mayorSid = obj.mayorSid || null;
      g.officials.deputySid = obj.deputySid || null;
      g.officials.govSids = Object.assign({}, obj.govSids || {});
      g.officials.presidentSid = obj.presidentSid || null;
      g.officials.vacantSince = Object.assign({}, obj.vacantSince || {});
      // polity.js's OWN serialize()/apply() carries office.holder/deputy/termDay
      // already (its header says so) — but NOT `.vacuum` (P1 shipped before
      // this field existed). Re-stamp it here, onto the already-restored
      // (polity hydrates at 46.03, strictly before this file's 46.06 hydrate
      // tick below) live records, from this file's own persisted copy.
      if (CBZ.polity && typeof CBZ.polity.get === "function") {
        for (const id in g.officials.vacantSince) {
          const rec = CBZ.polity.get(id);
          if (rec && !rec.office.holder) rec.vacuum = g.officials.vacantSince[id];
        }
      }
    },
  };
  CBZ.officialsReset = reset;

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polity.js/billionaires.js's own pattern:
  //  stamp the live state onto g.cityWorld right before the existing
  //  commit/collect save hooks run, hydrate back out whenever that ledger
  //  object's REFERENCE changes. Own idempotence flag (_offSaveWrap, distinct
  //  from the kill-wrap's own _offWrap above).
  // ------------------------------------------------------------
  function stampOfficials() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.off = CBZ.officials.serialize();
  }
  let _ensureOfficialsSaveWraps_done = false;
  function ensureOfficialsSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureOfficialsSaveWraps_done) return;
    _ensureOfficialsSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._offSaveWrap) {
      const w = function () { stampOfficials(); return commit.apply(this, arguments); };
      w._offSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._offSaveWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampOfficials(); return col.apply(this, arguments); };
      wc._offSaveWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.off) CBZ.officials.apply(led.off);
  }
  if (CBZ.onUpdate) {
    // order 46.06 — after polity.js's own 46.03 install-tick (its office.holder/
    // deputy/termDay must already be live before this file re-stamps `.vacuum`
    // onto the same records) and before this file's OWN 46.08 mint check above.
    CBZ.onUpdate(46.06, function () {
      if (!g) return;
      ensureOfficialsSaveWraps();
      hydrateFromLedger();
    });
  }
})();
