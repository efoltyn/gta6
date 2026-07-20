/* ============================================================
   city/crown.js — Stage P, step P6b: THE CROWN AS A BLOODLINE.

   MASTER-PLAN Part V / BUILD-PLAN P6b (verbatim): "Monarchy: crown-as-
   bloodline regime — succession via familytree heirOf (spouse regency,
   eldest child, collateral line), legitimacy stat, royal marriages as
   alliances, visible line of succession, dictator self-coronation +
   restoration/pretender triggers."

   WHY THIS IS A SEPARATE FILE, NOT A BRANCH OF regimes.js: regimes.js's
   own header says it verbatim — "monarchy never enters this state machine
   (P6b's own bloodline succession wave owns it entirely — tickCountry()
   early-returns on it)". A monarchy's whole "regime logic" is genealogy,
   not a govType ladder: there is no daily emergencyPowers ladder, no
   police/tax effect table — there is a ROYAL FAMILY, real minted people,
   whose marriages/births/deaths ARE the mechanic. This file owns that
   family tree data (which sids are royal, their ages, the dynasty label)
   and layers three things beside city/familytree.js's generic kinship
   edges: (1) a computed, cached-free lineOf() succession order, (2) a
   legitimacy stat with its own drift/pretender/marriage sub-systems, and
   (3) the two cross-regime transition triggers (dictator self-coronation
   IN, anarchist restoration IN) that hand a country's govType TO monarchy
   from regimes.js's own state machine — the one place the two files touch.

   THE ROYAL FAMILY AS REAL PEOPLE: every royal here is minted through
   the EXACT officials.js mintIdentity() shape (a synthetic, never-spawned
   object stashed via CBZ.cityPedStash with `_parked:true, nameKnown:true`)
   — a real ledger identity, never a throwaway string. The reigning
   monarch is NOT separately minted: city/officials.js already mints a
   holder for every country record (King/Queen title for govType
   "monarchy" — see that file's titleFor()), so this file ADOPTS
   rec.office.holder as house.monarchSid the first time a monarchy
   country's office is filled (idempotent — see seedHouseFor's own guard),
   rather than minting a second, orphaned "king" nobody points to.

   LIVENESS: this file does NOT use familytree.js's private `dead` set
   (not exported — see that file's own header: "the sole liveness
   authority... no external alive oracle") NOR schedule.js's ledger-page-
   presence trick (births.js's existsAlive idiom) — that trick only works
   for identities that die through the REAL cityKillPed→dropSid funnel,
   and most royals here (consort, kids, collateral cousins) are pure
   parked ledger pages with no embodiment mechanism this wave (exactly
   like officials.js's own un-embodied "deputy" — see that file's header),
   so calling familytree.markDeath() directly on a phantom ancestor at
   seed time would mark them dead in familytree's OWN set while leaving
   their ledger page fully intact (dropSid is never called for a page
   that never went through cityKillPed) — the ledger-presence check would
   then wrongly read them as "alive". So this file owns ONE more small,
   parallel liveness set (g.crownWorld.dead, sid -> true) — the identical
   shape/spirit as familytree.js's own private set, just scoped to the
   royal cast this file itself tracks. The one case a royal CAN really
   die in combat is the reigning monarch: officials.js's own PHYSICAL
   PRESENCE tick already spawns a body for ANY country office (the
   KIND_PRESENCE.country table entry, king/queen title and all) tied to
   rec.office.holder — so a player who guns down the king during a public
   appearance hits a REAL live ped, and this file's own cityKillPed wrap
   (below, composed onto the existing officials.js/regimes.js/social.js/
   inheritance.js chain — loaded LAST in the P-wave, so outermost) catches
   that death and calls succeed().

   AGE: royals get a `born` (worldDay) field, NOT stamped onto the ped/
   ledger record (cityPedStash only copies a fixed known-field set — see
   that function's own body — custom fields like `born` would silently
   vanish on the next stash pass). Owned here instead, in
   g.crownWorld.people[sid] = {born, relation, house, gender}. Age is
   simply `worldDay() - born` — the task's own literal unit (no separate
   "days per year" conversion invented): a newly bearChild()'d royal
   starts at 0 and ages exactly one unit per worldDay, matching
   ADULT_AGE=16 as "16 worldDays old", so a harness (or a very patient
   player) can actually walk a royal through the minor->adult threshold.

   LINE OF SUCCESSION (lineOf, below): a fresh depth-first primogeniture
   walk off familytree.kidsOf()/parentsOf() every call — NOT cached. These
   trees are tiny (a house tops out at a dozen minted sids), so "cache-
   bust on any familytree mutation" is satisfied trivially by never
   caching at all; recomputing beats tracking a dirty flag across two
   modules' mutations for a tree this small. Dead sids are walked THROUGH
   (their own descendants still inherit) but never themselves emitted —
   the real-world "per stirpes" succession shape.

   REGENT, NOT HEIR (task's own emphatic parenthetical): a consort is
   never a blood heir in any real monarchy, so lineOf's own array is
   blood-only (children/grandchildren/siblings/cousins) — the consort
   never occupies a line slot. When lineOf()[0] is a minor, this file
   attaches `.regentSid`/`.regentName` onto THAT entry (the minor stays
   the rightful heir at index 0; the consort is annotated as who actually
   governs) rather than inserting the consort as a fake line entry.

   CROSS-FILE HOOKS (guarded everywhere, silent no-op if absent):
     - city/regimes.js: CBZ.regimes.transition(rec, "monarchy"/"emergencyRule",
       day, shock) is REUSED (not reimplemented) for every govType flip this
       file drives (succession-crisis -> emergencyRule, dictator self-
       coronation -> monarchy, anarchist restoration -> monarchy) — its own
       apply/removeEffects branches already no-op cleanly for "monarchy"
       (matches neither isAuthoritarian/communism/anarchism), so calling
       through it costs nothing and keeps headline/GOV_LABEL/approvalShock
       wiring in exactly one place. regimes.js's own tickCountry() already
       early-returns on govType==="monarchy" — nothing more is needed for
       "regimes.js must then leave the country alone" (task item 6).
     - RESTORATION vs STRONGMAN (task item 7): regimes.js's
       strongmanRestore() would fire at STRONGMAN_DAYS=5, strictly before
       this file's RESTORE_ANARCHY_DAYS=7 — so regimes.js asks
       CBZ.crown.hasLivingLine(countryId) first and DEFERS to the pretender
       when a royal house survives with a living claimant: restoration wins
       in a country that remembers its kings, the warlord takes any throne
       nobody living can claim. Ordering safety on the shared onNewDay
       fan-out (regimes.js registers first): if strongman flipped govType
       away from "anarchism" this exact tick, tryRestoration() reads the
       already-mutated govType and no-ops for free (its very first guard
       line); house.restoredDay is a belt-and-braces same-day stamp against
       any future re-ordering.
     - city/officials.js: CBZ.officials.identityOf(sid) is REUSED for
       name/gender lookups (never re-implemented) — the same "arm's
       length, data module owns rendering, name resolution" split every
       X6/P-wave file already follows.
     - city/relations.js: CBZ.relations.event(a, b, kind, mag) drives every
       affinity nudge this file causes (royal marriage +25 trade, dictator
       self-coronation -10 insult from every OTHER live monarchy, pretender
       crisis -5 insult with every other country — a cheap "instability
       spooks the neighbors" flavor, the same shape rippleDictatorship()
       already uses in regimes.js for a not-unlike event).
     - city/demographics.js: CBZ.demographics.CONFIGS[countryId] supplies
       the region-correct first-name pools + the country's OWN surname
       pool (the dynasty name is drawn from THIS, per the task's own
       instruction, not parsed off whatever name officials.js's generic
       mint already gave the adopted monarch) — falls back to peds.js's
       own global CBZ.cityMintName() pool if a country has no config yet.

   PERSISTENCE: own blob (blob.crown, src/net/netpersist.js) carrying
   houses/people/dead-set/dictatorship-watch counters — royal PEOPLE
   themselves ride familytree.js's own edges + schedule.js's ledger riders
   already (this file stores SIDS ONLY, never re-serializing a person).
   Single-player: g.cityWorld.crown, the polity.js/familytree.js exact
   two-rider pattern, WITH the P5 one-shot install-guard fix (a module-
   local boolean checked before ever wrapping cityWorldCommit/Collect).

   LOAD ORDER: index.html — right after city/regimes.js (needs
   CBZ.polity/CBZ.regimes/CBZ.relations/CBZ.demographics/CBZ.officials/
   CBZ.cityFamilyTree, all already live by then), last in the P/X-wave
   block, right before core/quality.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // own seeded LCG (never Math.random — repo convention for world state).
  let _seed = 130700221 & 0x7fffffff;
  function rng() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  const ADULT_AGE = 16;                 // worldDays — task's own literal unit, see header
  const START_LEGIT = 70;
  const LEGIT_DRIFT_RATE = 0.15;        // per-day fraction moved toward target
  const LOW_LEGIT_T = 25, LOW_LEGIT_DAYS = 3, RECOVER_T = 40;
  const MARRIAGE_CHANCE = 0.04;         // per house, per day
  const MARRIAGE_AFFINITY = 25, MARRIAGE_LEGIT_BONUS = 10;
  const LONGEVITY_PER_DAYS = 10, LONGEVITY_CAP = 15;
  const DICT_APPROVAL_T = 55, DICT_HIGH_DAYS = 5, SELF_CROWN_CHANCE = 0.05;
  const SELF_CROWN_LEGIT = 35;
  const RESTORE_ANARCHY_DAYS = 7, RESTORE_LEGIT = 50;
  const PRETENDER_SHOCK = -10, PRETENDER_REL_HIT = 5;

  // ============================================================
  //  STATE — g.crownWorld: {houses, people, dead, dictWatch, allSeeded}
  // ============================================================
  function reset() {
    g.crownWorld = {
      houses: Object.create(null),   // countryId -> house record
      people: Object.create(null),   // sid -> {born, relation, house, gender[, originCountry]}
      dead: Object.create(null),     // sid -> true (see header: OWN liveness set)
      dictWatch: Object.create(null), // countryId -> consecutive high-approval dictatorship days
      allSeeded: false,
    };
  }
  function ensureInit() { if (!g.crownWorld) reset(); }
  function houseOf(countryId) { ensureInit(); return (countryId && g.crownWorld.houses[countryId]) || null; }
  function registerPerson(sid, info) { if (!sid) return; ensureInit(); g.crownWorld.people[sid] = info; }
  function isLiving(sid) { ensureInit(); return !!sid && !g.crownWorld.dead[sid]; }
  function markRoyalDead(sid) { if (!sid) return; ensureInit(); g.crownWorld.dead[sid] = true; }
  function ageOf(sid, day) {
    ensureInit();
    const p = g.crownWorld.people[sid];
    if (!p || !isFinite(p.born)) return 99;   // unknown provenance -> treat as safely adult
    const d = day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0);
    return d - p.born;
  }
  function isMinor(sid, day) { return ageOf(sid, day) < ADULT_AGE; }

  // ============================================================
  //  HELPERS — name/gender resolution (officials.js's own accessor, reused)
  // ============================================================
  function identityOf(sid) {
    if (CBZ.officials && CBZ.officials.identityOf) return CBZ.officials.identityOf(sid);
    return { name: "Someone", gender: "f" };
  }
  function nameOf(sid) { return identityOf(sid).name; }
  // births.js's own surnameOf() shape, verbatim: last whitespace token, guards single-token names.
  function surnameOf(fullName) {
    if (!fullName) return null;
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts[parts.length - 1];
  }
  function regionalFirstName(countryId, gender) {
    const cfg = CBZ.demographics && CBZ.demographics.CONFIGS ? CBZ.demographics.CONFIGS[countryId] : null;
    if (cfg) {
      const pool = gender === "f" ? cfg.firstF : cfg.firstM;
      if (pool && pool.length) return pool[(rng() * pool.length) | 0];
    }
    if (CBZ.cityMintName) return CBZ.cityMintName(rng, gender).split(" ")[0];
    return gender === "f" ? "Adelaide" : "Foster";
  }
  function regionalSurname(countryId) {
    const cfg = CBZ.demographics && CBZ.demographics.CONFIGS ? CBZ.demographics.CONFIGS[countryId] : null;
    if (cfg && cfg.surnames && cfg.surnames.length) return cfg.surnames[(rng() * cfg.surnames.length) | 0];
    return null;
  }
  // mint one royal — officials.js's mintIdentity() shape, verbatim (a
  // synthetic, never-spawned object stashed via cityPedStash).
  function mintRoyal(countryId, gender, dynastyName, job, wealth) {
    if (!CBZ.cityPedStash) return null;
    const first = regionalFirstName(countryId, gender);
    const obj = {
      _parked: true, nameKnown: true, kind: "civilian", archetype: "royal",
      name: first + " " + dynastyName, gender: gender, job: job, wealth: wealth, aggr: 0.1,
      cash: 1500 + Math.round(rng() * 5000),
    };
    CBZ.cityPedStash(obj);
    return obj._sid || null;
  }

  // ============================================================
  //  1. ROYAL HOUSE SEEDING — once per monarchy country, deterministic,
  //     idempotent (guarded by g.crownWorld.houses[id] already existing).
  // ============================================================
  function seedHouseFor(rec) {
    if (!rec || rec.govType !== "monarchy") return;
    ensureInit();
    const cid = rec.id;
    if (g.crownWorld.houses[cid]) return;              // already seeded
    if (!rec.office || !rec.office.holder) return;     // officials.js hasn't minted the crown yet this frame
    const FT = CBZ.cityFamilyTree;
    if (!FT) return;
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const monarchSid = rec.office.holder;
    const monInfo = identityOf(monarchSid);
    const dynastyName = regionalSurname(cid) || "Crown";

    const house = {
      countryId: cid, dynastyName: dynastyName, monarchSid: monarchSid, consortSid: null,
      legitimacy: START_LEGIT, founded: day, monarchSince: day,
      lowLegitDays: 0, pretender: null, allianceMarriages: [],
      restoredDay: null, selfCrowned: false, anarchyDays: 0,
    };
    g.crownWorld.houses[cid] = house;
    registerPerson(monarchSid, { born: day - 45, relation: "monarch", house: cid, gender: monInfo.gender });

    // consort (marry() — familytree.js's own idempotent write API).
    const consortGender = monInfo.gender === "f" ? "m" : "f";
    const consortSid = mintRoyal(cid, consortGender, dynastyName, "consort", 0.75);
    if (consortSid) {
      FT.marry(monarchSid, consortSid);
      registerPerson(consortSid, { born: day - 42, relation: "consort", house: cid, gender: consortGender });
      house.consortSid = consortSid;
    }

    // 3 children (within the task's 2-4 range), mixed genders, staggered
    // ages so at least one is an adult direct heir (22) and at least one is
    // a minor (14, 9) — makes every succession-shock branch reachable.
    const KID_GENDERS = ["f", "m", "m"];
    const KID_AGES = [22, 14, 9];
    for (let i = 0; i < KID_AGES.length; i++) {
      const kidSid = mintRoyal(cid, KID_GENDERS[i], dynastyName, "royal heir", 0.6);
      if (!kidSid) continue;
      FT.bearChild(monarchSid, consortSid, kidSid);
      registerPerson(kidSid, { born: day - KID_AGES[i], relation: "child", house: cid, gender: KID_GENDERS[i] });
    }

    // collateral line: a deceased predecessor (shared parent, so the
    // monarch and their sibling actually share a "pc" edge — familytree.js
    // has no direct "sibling" edge kind, so this is the mechanism), the
    // monarch's own (adult) sibling, and that sibling's (minor) child —
    // exactly the task's "1-2 collateral relatives... testable" ask.
    const predGender = rng() < 0.5 ? "f" : "m";
    const predSid = mintRoyal(cid, predGender, dynastyName, "the elder", 0.5);
    if (predSid) {
      FT.bearChild(predSid, null, monarchSid);
      const siblingGender = rng() < 0.5 ? "f" : "m";
      const siblingSid = mintRoyal(cid, siblingGender, dynastyName, "royal sibling", 0.55);
      if (siblingSid) {
        FT.bearChild(predSid, null, siblingSid);
        registerPerson(siblingSid, { born: day - 40, relation: "sibling", house: cid, gender: siblingGender });
        const collGender = rng() < 0.5 ? "f" : "m";
        const collSid = mintRoyal(cid, collGender, dynastyName, "royal cousin", 0.5);
        if (collSid) {
          FT.bearChild(siblingSid, null, collSid);
          registerPerson(collSid, { born: day - 12, relation: "collateral", house: cid, gender: collGender });
        }
      }
      FT.markDeath(predSid, day - 1);
      markRoyalDead(predSid);   // OWN liveness set — see header (familytree.markDeath alone isn't enough)
      registerPerson(predSid, { born: day - 70, relation: "predecessor", house: cid, gender: predGender });
    }

    if (CBZ.cityFeed) CBZ.cityFeed("The House of " + dynastyName + " is chronicled in " + rec.name + ".", "#ffd76a");
  }
  function seedAllHouses() {
    if (!CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    let all = true;
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      if (rec.govType !== "monarchy") continue;
      seedHouseFor(rec);
      if (!g.crownWorld.houses[rec.id]) all = false;
    }
    if (all) g.crownWorld.allSeeded = true;
  }
  function seedCountry(countryId) {
    if (!CBZ.polity) return null;
    const rec = CBZ.polity.get(countryId);
    if (rec) seedHouseFor(rec);
    return houseOf(countryId);
  }

  // ============================================================
  //  2. LINE OF SUCCESSION — depth-first primogeniture + collateral tail.
  //     Fresh every call (see header: these trees are tiny, no caching).
  // ============================================================
  function lineOf(countryId) {
    const house = houseOf(countryId);
    const FT = CBZ.cityFamilyTree;
    if (!house || !FT) return [];
    const day = CBZ.worldDay ? CBZ.worldDay() : 0;
    const out = [];
    const seen = Object.create(null);
    seen[house.monarchSid] = true;   // the reigning/former monarch never re-appears in their own line

    function pushIfLiving(sid, relation) {
      if (!sid || seen[sid]) return;
      seen[sid] = true;
      if (!isLiving(sid)) return;
      out.push({ sid: sid, name: nameOf(sid), relation: relation, age: ageOf(sid, day), minor: isMinor(sid, day) });
    }
    function descend(sid, label) {
      const kids = FT.kidsOf(sid) || [];
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (seen[k]) continue;
        pushIfLiving(k, label);
        descend(k, label === "child" ? "grandchild" : "descendant");
      }
    }
    descend(house.monarchSid, "child");

    // collateral: siblings via any shared parent (see seedHouseFor's own
    // "predecessor" comment for why familytree has no direct sibling edge),
    // each sibling's own descendant tree walked right after them.
    const parents = FT.parentsOf(house.monarchSid) || [];
    for (let i = 0; i < parents.length; i++) {
      const sibs = FT.kidsOf(parents[i]) || [];
      for (let j = 0; j < sibs.length; j++) {
        const s = sibs[j];
        if (s === house.monarchSid || seen[s]) continue;
        pushIfLiving(s, "sibling");
        descend(s, "collateral");
      }
    }

    // REGENT, NOT HEIR (see header): annotate the top entry only — the
    // consort never occupies a blood-line slot.
    if (out.length && out[0].minor && house.consortSid && isLiving(house.consortSid)) {
      out[0].regentSid = house.consortSid;
      out[0].regentName = nameOf(house.consortSid);
    }
    return out;
  }

  // ============================================================
  //  8. UI SEAM — CBZ.crown.summary(countryId); approval.js's
  //     jurisdictionCard() appends one line for monarchy countries.
  // ============================================================
  function summary(countryId) {
    const house = houseOf(countryId);
    if (!house) return null;
    const line = lineOf(countryId);
    const out = {
      dynasty: house.dynastyName, monarch: nameOf(house.monarchSid),
      legitimacy: Math.round(house.legitimacy),
      line: line.slice(0, 3).map(function (e) { return e.name; }),
    };
    if (line.length && line[0].regentName) out.regent = line[0].regentName;
    return out;
  }

  // ============================================================
  //  3. SUCCESSION ON DEATH
  // ============================================================
  function houseIdForMonarch(sid) {
    ensureInit();
    for (const id in g.crownWorld.houses) if (g.crownWorld.houses[id].monarchSid === sid) return id;
    return null;
  }
  function succeed(countryId, day) {
    const house = houseOf(countryId);
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
    if (!house || !rec) return;
    day = day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0);
    const oldGender = identityOf(house.monarchSid).gender;
    const oldTitle = oldGender === "f" ? "Queen" : "King";
    const deadName = nameOf(house.monarchSid);
    markRoyalDead(house.monarchSid);
    if (rec.office) rec.office.holder = null;

    const line = lineOf(countryId);
    if (!line.length) {
      // SUCCESSION CRISIS — no living heir of any kind.
      house.legitimacy = 20;
      if (CBZ.regimes && CBZ.regimes.transition) CBZ.regimes.transition(rec, "emergencyRule", day, 0);
      else rec.govType = "emergencyRule";
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE LINE ENDS — " + rec.name.toUpperCase() + " IN CRISIS");
      if (CBZ.cityFeed) CBZ.cityFeed("" + oldTitle + " " + deadName + " dies without heir — " + rec.name + " descends into crisis.", "#ff6a5e");
      return;
    }

    const heir = line[0];
    house.monarchSid = heir.sid;
    house.monarchSince = day;
    if (rec.office) rec.office.holder = heir.sid;
    const newGender = identityOf(heir.sid).gender;
    const newTitle = newGender === "f" ? "Queen" : "King";

    let shock, styleLabel;
    if (heir.minor) { shock = -25; styleLabel = "a child ascends the throne — a regency begins"; }
    else if (heir.relation === "sibling" || heir.relation === "collateral") { shock = -15; styleLabel = "the crown passes to a collateral line"; }
    else { shock = 5; styleLabel = "a smooth, undisputed succession"; }
    house.legitimacy = clampNum(0, 100, (house.legitimacy || 0) + shock);

    if (CBZ.city && CBZ.city.big) CBZ.city.big("THE " + oldTitle.toUpperCase() + " IS DEAD — LONG LIVE " + newTitle.toUpperCase() + " " + heir.name.toUpperCase());
    if (CBZ.cityFeed) {
      let line2 = "" + oldTitle + " " + deadName + " has died — " + newTitle + " " + heir.name + " ascends (" + styleLabel + ").";
      if (heir.regentName) line2 += " " + heir.regentName + " governs as regent.";
      CBZ.cityFeed(line2, "#ffd76a");
    }
  }

  if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._crownWrap) {
    const origKillPed = CBZ.cityKillPed;
    const wrapped = function (ped, imp, cause) {
      const sid = ped && ped._sid;
      const wasDead = !ped || ped.dead;
      let houseId = null;
      if (sid && !wasDead) houseId = houseIdForMonarch(sid);
      const ret = origKillPed.apply(this, arguments);
      if (houseId && ped && ped.dead) {
        try { succeed(houseId, CBZ.worldDay ? CBZ.worldDay() : 0); } catch (e) {}
      }
      return ret;
    };
    wrapped._crownWrap = true;
    CBZ.cityKillPed = wrapped;
  }

  // ============================================================
  //  4. LEGITIMACY DRIFT + PRETENDER
  // ============================================================
  function countLivingAllianceMarriages(house) {
    let n = 0;
    for (let i = 0; i < house.allianceMarriages.length; i++) {
      const m = house.allianceMarriages[i];
      if (isLiving(m.royalSid) && isLiving(m.foreignSid)) n++;
    }
    return n;
  }
  function tickLegitimacy(rec, house, day) {
    const approvalV = rec.approval || 0;
    const marriageBonus = MARRIAGE_LEGIT_BONUS * countLivingAllianceMarriages(house);
    const reignDays = Math.max(0, day - (house.monarchSince != null ? house.monarchSince : house.founded));
    const longevityBonus = Math.min(LONGEVITY_CAP, Math.floor(reignDays / LONGEVITY_PER_DAYS));
    const target = clampNum(0, 100, 40 + 0.4 * approvalV + marriageBonus + longevityBonus);
    house.legitimacy = clampNum(0, 100, house.legitimacy + (target - house.legitimacy) * LEGIT_DRIFT_RATE);
  }
  function tickPretender(rec, house, day) {
    if (house.legitimacy < LOW_LEGIT_T) house.lowLegitDays = (house.lowLegitDays || 0) + 1;
    else house.lowLegitDays = 0;

    if (house.pretender && house.pretender.active) {
      if (house.legitimacy > RECOVER_T) {
        house.pretender.active = false;
        if (CBZ.cityFeed) CBZ.cityFeed("" + house.pretender.name + " stands down — the crown holds.", "#8fe08a");
        if (CBZ.city && CBZ.city.big) CBZ.city.big("THE PRETENDER STANDS DOWN");
      }
      return;   // an already-active pretender doesn't re-declare
    }
    if (house.lowLegitDays < LOW_LEGIT_DAYS) return;
    const line = lineOf(rec.id);
    let claimant = null;
    for (let i = 0; i < line.length; i++) {
      if (line[i].relation === "sibling" || line[i].relation === "collateral") { claimant = line[i]; break; }
    }
    if (!claimant) return;   // no collateral to declare — see header, the task's own "testable" ask requires one
    house.pretender = { sid: claimant.sid, name: claimant.name, active: true, declaredDay: day };
    house.lowLegitDays = 0;
    if (CBZ.approvalShock) CBZ.approvalShock(rec.id, PRETENDER_SHOCK);
    if (CBZ.relations && CBZ.polity) {
      const others = CBZ.polity.list("country");
      for (let i = 0; i < others.length; i++) {
        if (others[i].id === rec.id) continue;
        try { CBZ.relations.event(rec.id, others[i].id, "insult", PRETENDER_REL_HIT); } catch (e) {}
      }
    }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + claimant.name.toUpperCase() + " DECLARES FOR THE THRONE");
    if (CBZ.cityFeed) CBZ.cityFeed("" + claimant.name + " declares against the crown of " + rec.name + ".", "#ff9e6b");
  }

  // ============================================================
  //  5. ROYAL MARRIAGES AS ALLIANCES
  // ============================================================
  function tryRoyalMarriage(rec, house, day, force) {
    if (!force && rng() > MARRIAGE_CHANCE) return false;
    const FT = CBZ.cityFamilyTree; if (!FT || !CBZ.polity) return false;
    ensureInit();
    const people = g.crownWorld.people;
    const cands = [];
    for (const sid in people) {
      const p = people[sid];
      if (p.house !== rec.id || p.relation === "foreignSpouse" || p.relation === "predecessor") continue;
      if (!isLiving(sid)) continue;
      if (ageOf(sid, day) < ADULT_AGE) continue;
      if (FT.spouseOf(sid)) continue;
      cands.push(sid);
    }
    if (!cands.length) return false;
    const royalSid = cands[(rng() * cands.length) | 0];
    const others = CBZ.polity.list("country").filter(function (c) { return c.id !== rec.id; });
    if (!others.length) return false;
    const target = others[(rng() * others.length) | 0];
    const nobleGender = rng() < 0.5 ? "f" : "m";
    const nobleFirst = regionalFirstName(target.id, nobleGender);
    const nobleSurname = regionalSurname(target.id) ||
      (CBZ.cityMintName ? CBZ.cityMintName(rng, nobleGender).split(" ").slice(1).join(" ") || "Noble" : "Noble");
    const nobleName = nobleFirst + " " + nobleSurname;
    if (!CBZ.cityPedStash) return false;
    const nobleObj = {
      _parked: true, nameKnown: true, kind: "civilian", archetype: "noble",
      name: nobleName, gender: nobleGender, job: "foreign noble", wealth: 0.65, aggr: 0.1,
      cash: 2000 + Math.round(rng() * 4000),
    };
    CBZ.cityPedStash(nobleObj);
    const nobleSid = nobleObj._sid;
    if (!nobleSid) return false;
    FT.marry(royalSid, nobleSid);
    registerPerson(nobleSid, { born: day - 25, relation: "foreignSpouse", house: rec.id, gender: nobleGender, originCountry: target.id });
    house.allianceMarriages.push({ royalSid: royalSid, foreignSid: nobleSid, foreignCountryId: target.id, since: day });
    if (CBZ.relations) { try { CBZ.relations.event(rec.id, target.id, "trade", MARRIAGE_AFFINITY); } catch (e) {} }
    const royalName = nameOf(royalSid);
    if (CBZ.city && CBZ.city.big) CBZ.city.big("A ROYAL WEDDING SEALS AN ALLIANCE");
    if (CBZ.cityFeed) CBZ.cityFeed("" + royalName + " weds " + nobleName + " of " + target.name + " — an alliance is sealed.", "#ffd1e8");
    return true;
  }

  // ============================================================
  //  6. DICTATOR SELF-CORONATION
  // ============================================================
  function selfCrown(rec, day) {
    if (!rec || !rec.office || !rec.office.holder) return null;
    const dictatorSid = rec.office.holder;
    const info = identityOf(dictatorSid);
    const dynastyName = surnameOf(info.name) || "Crown";
    if (CBZ.regimes && CBZ.regimes.transition) CBZ.regimes.transition(rec, "monarchy", day, 0);
    else rec.govType = "monarchy";
    ensureInit();
    const house = {
      countryId: rec.id, dynastyName: dynastyName, monarchSid: dictatorSid, consortSid: null,
      legitimacy: SELF_CROWN_LEGIT, founded: day, monarchSince: day, lowLegitDays: 0,
      pretender: null, allianceMarriages: [], restoredDay: null, selfCrowned: true, anarchyDays: 0,
    };
    g.crownWorld.houses[rec.id] = house;
    registerPerson(dictatorSid, { born: day - 45, relation: "monarch", house: rec.id, gender: info.gender });
    delete g.crownWorld.dictWatch[rec.id];
    if (CBZ.relations && CBZ.polity) {
      const others = CBZ.polity.list("country");
      for (let i = 0; i < others.length; i++) {
        const o = others[i];
        if (o.id === rec.id || o.govType !== "monarchy") continue;
        try { CBZ.relations.event(rec.id, o.id, "insult", 10); } catch (e) {}
      }
    }
    if (CBZ.city && CBZ.city.big) CBZ.city.big("" + info.name.toUpperCase() + " CROWNS " + (info.gender === "f" ? "HERSELF" : "HIMSELF"));
    if (CBZ.cityFeed) CBZ.cityFeed("" + info.name + " declares the House of " + dynastyName + " — " + rec.name + " is a monarchy now.", "#ffd76a");
    return house;
  }
  function tickDictatorWatch(rec, day, force) {
    ensureInit();
    if (rec.govType !== "dictatorship") { delete g.crownWorld.dictWatch[rec.id]; return; }
    const approvalV = rec.approval || 0;
    const cur = g.crownWorld.dictWatch[rec.id] || 0;
    const next = approvalV > DICT_APPROVAL_T ? cur + 1 : 0;
    g.crownWorld.dictWatch[rec.id] = next;
    if (next < DICT_HIGH_DAYS) return;
    if (!force && rng() > SELF_CROWN_CHANCE) return;
    selfCrown(rec, day);
  }

  // ============================================================
  //  7. ANARCHIST RESTORATION (see header for the strongman-race note)
  // ============================================================
  function tryRestoration(rec, house, day) {
    if (rec.govType !== "anarchism") { house.anarchyDays = 0; return false; }
    house.anarchyDays = (house.anarchyDays || 0) + 1;
    if (house.anarchyDays < RESTORE_ANARCHY_DAYS) return false;
    if (house.restoredDay === day) return false;   // same-day guard (belt-and-braces — see header)
    const line = lineOf(rec.id);
    if (!line.length) return false;                 // no living line survives to restore
    const claimant = line[0];
    if (CBZ.regimes && CBZ.regimes.transition) CBZ.regimes.transition(rec, "monarchy", day, 0);
    else rec.govType = "monarchy";
    house.monarchSid = claimant.sid;
    house.monarchSince = day;
    house.legitimacy = RESTORE_LEGIT;
    house.anarchyDays = 0;
    house.restoredDay = day;
    if (rec.office) rec.office.holder = claimant.sid;
    if (CBZ.city && CBZ.city.big) CBZ.city.big("THE THRONE IS RESTORED");
    if (CBZ.cityFeed) CBZ.cityFeed("" + claimant.name + " restores the House of " + house.dynastyName + " in " + rec.name + ".", "#ffd76a");
    return true;
  }

  // ============================================================
  //  DAILY TICK — CBZ.onNewDay (polity.js's subscriber list). Registered
  //  AFTER regimes.js's own subscriber (load order) — see header for why
  //  that ordering is exactly what makes the restoration/strongman race
  //  self-resolving with no extra plumbing.
  // ============================================================
  function tickCrown(day) {
    ensureInit();
    if (!CBZ.polity) return;
    const countries = CBZ.polity.list("country");
    for (let i = 0; i < countries.length; i++) {
      const rec = countries[i];
      try {
        const house = g.crownWorld.houses[rec.id];
        if (house) {
          tickLegitimacy(rec, house, day);
          tickPretender(rec, house, day);
          tryRoyalMarriage(rec, house, day, false);
          tryRestoration(rec, house, day);
        }
        tickDictatorWatch(rec, day, false);
      } catch (e) { try { console.error("[crown] tick failed", rec.id, e); } catch (e2) {} }
    }
  }
  if (CBZ.onNewDay) CBZ.onNewDay(tickCrown);

  // house-seeding tick — 46.13, after officials.js's own mint tick (46.08)
  // so rec.office.holder already exists to adopt, and after approval.js's
  // 46.09 install-tick; before regimes.js's own 46.12 is fine too since
  // seeding never touches regimes state. Cheap no-op once allSeeded.
  CBZ.onUpdate(46.13, function () {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    ensureInit();
    if (g.crownWorld.allSeeded) return;
    try { seedAllHouses(); } catch (e) {}
  });

  // ============================================================
  //  PUBLIC API
  // ============================================================
  CBZ.crown = {
    lineOf: lineOf, summary: summary, houseOf: houseOf, seedCountry: seedCountry,
    // does a royal house survive here with someone alive to claim it? regimes.js
    // asks this before letting a warlord seize an anarchic country — a living
    // pretender outranks a strongman, so restoration (day 7) wins that race.
    hasLivingLine: function (countryId) {
      const house = houseOf(countryId);
      if (!house) return false;
      try { return lineOf(countryId).length > 0; } catch (e) { return false; }
    },
    serialize: serialize, apply: apply, reset: reset,
    // harness/test hooks only — not part of the public contract.
    _succeed: succeed,
    _selfCrown: function (countryId, day) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      return rec ? selfCrown(rec, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0)) : null;
    },
    _tickDictatorWatch: function (countryId, day, force) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      if (rec) tickDictatorWatch(rec, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0), force);
    },
    _tryRestoration: function (countryId, day) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      const house = houseOf(countryId);
      return (rec && house) ? tryRestoration(rec, house, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0)) : false;
    },
    _tryRoyalMarriage: function (countryId, day, force) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      const house = houseOf(countryId);
      return (rec && house) ? tryRoyalMarriage(rec, house, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0), !!force) : false;
    },
    _tickLegitimacy: function (countryId, day) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      const house = houseOf(countryId);
      if (rec && house) tickLegitimacy(rec, house, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0));
    },
    _tickPretender: function (countryId, day) {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(countryId) : null;
      const house = houseOf(countryId);
      if (rec && house) tickPretender(rec, house, day != null ? day : (CBZ.worldDay ? CBZ.worldDay() : 0));
    },
    _tickCrown: tickCrown,
    _markDead: function (sid) { markRoyalDead(sid); if (CBZ.cityFamilyTree) CBZ.cityFamilyTree.markDeath(sid); },
    _isLiving: isLiving, _ageOf: ageOf,
    _seedHouseFor: seedHouseFor,
  };
  CBZ.crownReset = reset;

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function serialize() {
    ensureInit();
    const W = g.crownWorld;
    const houses = {};
    for (const id in W.houses) {
      const h = W.houses[id];
      houses[id] = {
        countryId: h.countryId, dynastyName: h.dynastyName, monarchSid: h.monarchSid,
        consortSid: h.consortSid, legitimacy: h.legitimacy, founded: h.founded, monarchSince: h.monarchSince,
        lowLegitDays: h.lowLegitDays, pretender: h.pretender ? Object.assign({}, h.pretender) : null,
        allianceMarriages: h.allianceMarriages.slice(), restoredDay: h.restoredDay,
        selfCrowned: !!h.selfCrowned, anarchyDays: h.anarchyDays || 0,
      };
    }
    const people = {};
    for (const sid in W.people) people[sid] = Object.assign({}, W.people[sid]);
    return {
      v: 1, houses: houses, people: people,
      dead: Object.keys(W.dead), dictWatch: Object.assign({}, W.dictWatch),
      allSeeded: !!W.allSeeded,
    };
  }
  function apply(obj) {
    reset();
    if (!obj || obj.v !== 1) return;
    const W = g.crownWorld;
    if (obj.houses) {
      for (const id in obj.houses) {
        const src = obj.houses[id]; if (!src) continue;
        W.houses[id] = {
          countryId: src.countryId || id, dynastyName: src.dynastyName || "Crown",
          monarchSid: src.monarchSid || null, consortSid: src.consortSid || null,
          legitimacy: isFinite(src.legitimacy) ? +src.legitimacy : START_LEGIT,
          founded: src.founded || 0, monarchSince: src.monarchSince != null ? src.monarchSince : (src.founded || 0),
          lowLegitDays: src.lowLegitDays || 0,
          pretender: src.pretender ? Object.assign({}, src.pretender) : null,
          allianceMarriages: Array.isArray(src.allianceMarriages) ? src.allianceMarriages.slice() : [],
          restoredDay: src.restoredDay != null ? src.restoredDay : null,
          selfCrowned: !!src.selfCrowned, anarchyDays: src.anarchyDays || 0,
        };
      }
    }
    if (obj.people) for (const sid in obj.people) W.people[sid] = Object.assign({}, obj.people[sid]);
    if (Array.isArray(obj.dead)) for (let i = 0; i < obj.dead.length; i++) W.dead[obj.dead[i]] = true;
    if (obj.dictWatch) for (const id in obj.dictWatch) W.dictWatch[id] = obj.dictWatch[id];
    W.allSeeded = !!obj.allSeeded;
  }

  // ============================================================
  //  SINGLE-PLAYER PERSIST — polity.js/familytree.js's own g.cityWorld
  //  pattern, verbatim: stamp before the existing commit/collect save hooks
  //  run, hydrate back out whenever that ledger object's REFERENCE changes.
  //  Own guard flags (_crownSaveWrap, distinct from the kill-wrap's
  //  _crownWrap above), WITH the P5 one-shot install-guard fix (a module-
  //  local boolean checked BEFORE ever wrapping, so re-entering this tick
  //  after some later module has wrapped commit/collect above us can never
  //  re-wrap and grow the chain unboundedly).
  // ------------------------------------------------------------
  function stampCrown() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.crown = serialize();
  }
  let _ensureCrownSaveWraps_done = false;
  function ensureCrownSaveWraps() {
    if (_ensureCrownSaveWraps_done) return;
    _ensureCrownSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._crownSaveWrap) {
      const w = function () { stampCrown(); return commit.apply(this, arguments); };
      w._crownSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._crownSaveWrap) {
      const col = CBZ.cityWorldCollect;
      const wc = function () { stampCrown(); return col.apply(this, arguments); };
      wc._crownSaveWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  let _hydratedLedger = null;
  function hydrateFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLedger) return;
    _hydratedLedger = led;
    if (led.crown) apply(led.crown);
  }
  if (CBZ.onUpdate) {
    // 46.16 — next free slot after city/relations.js's own 46.15 install-tick.
    CBZ.onUpdate(46.16, function () {
      if (!g) return;
      ensureCrownSaveWraps();
      hydrateFromLedger();
    });
  }
})();
