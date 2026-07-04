/* ============================================================
   city/births.js — W11: BIRTHS, without growing the finite population.

   WHY THIS FILE EXISTS: familytree.js (W6/W7) can already MARRY people and
   record bearChild() edges — but nothing has ever CALLED bearChild() for an
   ordinary living couple over time; the only two callers today (family.js's
   boss households, social.js's rare rich-family kid) mint their kid at CAST
   time, once, as part of building the family. This module is the ongoing
   clock: married couples that are still alive, still housed together, and
   haven't maxed out on kids, occasionally have ANOTHER one while you play.

   THE OWNER DOCTRINE (peds.js ~line 110): the city's headcount is FINITE —
   `_popTotal` is fixed at build time, and `cityPopulationDie` only ever
   subtracts. Nothing in this codebase makes the living total go UP. A birth
   cannot be allowed to break that, so it isn't population growth at all:
   it's a PROMOTION. The crowd already contains this future person — either
   inside the "~200 unseen slack" _ensurePop bakes into the total (people
   presumed indoors/off-screen, never individually modelled), or, more
   concretely, inside the headroom a death just opened up. A birth spends
   that headroom to mint a NAMED child; it never mints a person the total
   didn't already account for.

   PATH A vs PATH B (per the build plan's own framing):
     PATH A would spawn the child by pulling a free body out of crowd.js's
     ambient instanced pool (its `count`/CAP budget) and decrementing that
     pool's own counter to pay for it. Read crowd.js closely: `count` (the
     number of INSTANCED ambient bodies, ≤ CAP=760) is fixed once at
     spawnCityCrowd() and is a SEPARATE, cosmetic budget from peds.js's named
     roster — it doesn't feed `_popTotal`/`_popDead` at all; crowd.js instead
     reads `CBZ.cityPopulation()` every tick to size `liveTarget` (how many of
     its FIXED `count` instanced bodies stay un-suppressed) as a MULTIPLIER,
     never a source of truth. Stealing one of its instances to "fund" a named
     ped would touch a module-local ambient-crowd budget that has nothing to
     do with the living headcount, and would need edits inside crowd.js's own
     CAP-sized typed arrays (promotedBy/deadAgent/etc.) to retire a slot
     permanently — exactly the "module-local CAP constant that can't be
     touched cleanly" the build plan warned about. Skipped.

     PATH B (IMPLEMENTED): only attempt a birth when the city already has
     death headroom — `CBZ.cityPopulation().dead > 0` — and, on a successful
     birth, call the new `CBZ.cityPopulationBirth(1)` (peds.js, added
     alongside cityPopulationDie as its exact mirror) which decrements
     `_popDead` by one. Since `alive = total - dead`, this raises `alive` by
     exactly one and lowers `dead` by exactly one; `total` NEVER changes. The
     birth literally "backfills" a death: someone else's absence is what
     funded this arrival, which is also why crowd.js's own liveTarget (driven
     off cityPopulation()) organically un-suppresses one more ambient body the
     next time it re-derives density — the street reads one person fuller,
     exactly the way it read one person thinner when the death happened.
     This keeps the entire invariant enforceable in ONE place (peds.js owns
     _popTotal/_popDead; we only ever call its accessor, never touch its
     closure), matching every other module's "own your state" convention.

   WHO CAN HAVE A BABY (all must hold for a couple to be even considered):
     - a LIVE spouse ("sp") edge on CBZ.cityFamilyTree (e.end == null) —
       married, not widowed/divorced.
     - both sids resolve to "alive right now": a standing live ped (not
       .dead) OR a still-present offline ledger page (schedule.js's dropSid
       deletes a sid's page outright on death — see schedule.js:391 — so a
       ledger page's mere EXISTENCE already implies "not dead"; there is no
       separate alive:false state to check for).
     - fewer than 3 kids already (familytree.kidsOf(sid).length < 3).
     - they share ONE housing.js unit (ped._household / the ledger's `hh`
       field) that still has a free seat (occupants.length < capacity) — a
       real address for the child to be born INTO, not a random sidewalk.
     - at least one parent is a STANDING live ped right now — needed both to
       give cityHouseholdJoin(kid, parent) a real live `partnerPed` to seat
       against (its signature takes a ped, not a sid) and to anchor the
       spawn point. If neither parent happens to be dealt in this exact
       moment, the couple simply isn't picked this cycle — perfectly fine,
       there's always a next attempt once one of them walks back on-screen.
     - a per-couple cooldown has elapsed since their last birth. Stored
       directly on the sp EDGE OBJECT as `e.lb` (last-birth stamp, seconds).
       familytree.js's serialize() does `edges: edges.slice()` — an array
       copy, NOT a deep clone of the edge records — so the objects handed
       back ARE the live edges; stamping `e.lb` here mutates the real edge
       and rides the tree's own persistence for free (verified against
       familytree.js:239-241, matching the W6 guarantee this step assumed).

   CADENCE: one attempt every ~90-150s (this module's own seeded LCG, cheap
   and deterministic — never Math.random), scanning every live "sp" edge for
   an eligible couple and picking uniformly among the eligible ones (so one
   fertile-looking couple early in the edge array doesn't hog every birth).
   At most ONE birth happens per attempt. Ordered 34.8 — right after
   social.js's 34.5/34.6 relationship/routine ticks and gangops.js's 34.7 op
   director, so a spouse's rel/household state this frame is already settled
   before we go looking for a couple to bless.

   THE CHILD: spawned via CBZ.cityMakePed at the shared home unit's door
   (falling back to the lot centre, then a live parent's own position) with
   {gender: seeded 50/50, archetype:"resident", job:"the kid", aggr:0,
   armed:false} — no opts.name, so makePed's own internal name(r,gender)
   mints a gender-correct first name off the SAME rng we hand it (the exact
   contract family.js's famPed and social.js's spawnFamilyMember both rely
   on). Scaled 0.62 / hp 40 afterward, matching family.js's famPed(kid=true)
   exactly. Added to the live world (arena root + CBZ.cityPeds) so — unlike
   family.js's yard-bound kids — this child is a REAL simulated ped from
   birth: routable by aigoals.js, stash-able by schedule.js, killable,
   robbable, all of it. bearChild() links it into the family tree,
   cityHouseholdJoin seats it in the family's own unit, cityPedStash banks it
   immediately so a page exists before anything can despawn/recycle it away.

   GROWING UP: NOT in scope for W11. The kid spawns at kid scale/hp and stays
   that way — no aging pass exists yet. A later wave owns "kids grow up."

   GOSSIP: reused the existing "proposal" TOPIC (op:0, mood:+0.6 — a happy,
   opinion-neutral ripple) rather than adding a new "birth" key to social.js's
   TOPIC table — this module doesn't own social.js, and a birth's emotional
   beat (a good-news ripple, no opinion shift) is already exactly what
   "proposal" encodes. Skip cleanly if CBZ.cityGossip is absent.

   RESET: mirrors familytree.js's top-level guard-call convention
   (CBZ.cityBirthsReset, wired in mode.js's fresh-run sequence right beside
   cityFamilyTreeReset). Per-run state here is just the cadence timer — the
   cooldown timestamps live ON THE EDGES, which familytree.js's own reset()
   already wipes by dropping the edges array wholesale, so there's nothing
   else to clean up here.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- seeded LCG (own seed — never Math.random in a scheduling decision,
  // matches housing.js's makeRng idiom). Reseeded on cityBirthsReset() so a
  // fresh run gets a fresh cadence, not a stale mid-run phase. ----
  let _s = 0x9e3779b9;
  function rng() {
    _s |= 0; _s = (_s + 0x6d2b79f5) | 0;
    let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const noSim = () => !!(CBZ.net && CBZ.net.noSim && CBZ.net.noSim());
  function now() { return (g && g.elapsed) | 0; }   // same placeholder clock familytree.js uses

  const MAX_KIDS = 3;
  const COOLDOWN = 300;          // seconds a couple must wait between births (per-edge, on e.lb)

  // ---- name lookup (live ped first, else the offline ledger page — same
  // fallback order as inheritance.js's own nameOf) ----
  function nameOf(sid) {
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live.name) return live.name;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.name) || "Someone";
  }

  // W12 DYNASTY NAMING: pull the last whitespace-separated token off a
  // parent's ledger name to use as the kid's surname. Guards single-token
  // names (the "Someone" fallback above, or any legacy short name) by
  // returning null so the caller falls back to a fresh random name instead
  // of grafting a bogus one-word "surname".
  function surnameOf(fullName) {
    if (!fullName) return null;
    const parts = String(fullName).trim().split(/\s+/);
    if (parts.length < 2) return null;
    return parts[parts.length - 1];
  }

  // "does this sid still exist and count as alive?" — a live standing ped
  // that isn't marked dead, OR an offline ledger page (dropSid deletes a
  // dead sid's page outright, so mere presence already means "not dead" —
  // see schedule.js:391 and this file's header).
  function existsAlive(sid) {
    if (!sid) return false;
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live) return !live.dead;
    return !!(CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid));
  }

  // the household id this sid currently claims — a live ped's own
  // `_household` if standing, else the ledger page's stashed `hh` (W8 field,
  // schedule.js cityPedStash line ~247).
  function householdIdOf(sid) {
    const live = CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid);
    if (live && live._household) return live._household;
    const e = CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid);
    return (e && e.hh) || null;
  }

  // resolve a housing.js unit object by its `.id` (the only handle a sid/
  // ledger page can carry across a live<->offline transition — see
  // housing.js's householdJoin, which stamps `unit.id` onto both sides).
  function unitById(id) {
    if (!id || !CBZ.cityHousing || !CBZ.cityHousing.units) return null;
    const units = CBZ.cityHousing.units();
    for (let i = 0; i < units.length; i++) if (units[i].id === id) return units[i];
    return null;
  }

  // ---- scan every live "sp" edge for an eligible couple; return the list
  // (each entry pre-resolved: edge, sids, the shared unit, a standing live
  // parent to anchor/join against). Bounded by the tree's own edge count —
  // a marriage roster, not the whole city; cheap even scanned in full. ----
  function eligibleCouples() {
    const FT = CBZ.cityFamilyTree;
    if (!FT) return [];
    const snap = FT.serialize();               // {edges: array copy of the LIVE edge objects, ...}
    const edges = snap.edges;
    const t = now();
    const out = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (e.k !== "sp" || e.end != null) continue;         // only a current, undissolved marriage
      if (t - (e.lb || -1e9) < COOLDOWN) continue;          // this couple's cooldown hasn't cleared
      const a = e.a, b = e.b;
      if (!existsAlive(a) || !existsAlive(b)) continue;
      if ((FT.kidsOf(a) || []).length >= MAX_KIDS) continue;
      const hhA = householdIdOf(a), hhB = householdIdOf(b);
      if (!hhA || hhA !== hhB) continue;                    // must share ONE housing unit
      const unit = unitById(hhA);
      if (!unit || !unit.occupants || unit.occupants.length >= (unit.capacity != null ? unit.capacity : 1)) continue;
      const liveA = CBZ.cityLedgerLive && CBZ.cityLedgerLive(a);
      const liveB = CBZ.cityLedgerLive && CBZ.cityLedgerLive(b);
      const parent = (liveA && !liveA.dead) ? liveA : ((liveB && !liveB.dead) ? liveB : null);
      if (!parent) continue;                                // need a standing body to anchor/join against
      out.push({ e, a, b, unit, parent });
    }
    return out;
  }

  // ---- execute ONE birth for a resolved candidate. Returns true on success. ----
  function doBirth(c) {
    if (!CBZ.cityMakePed) return false;
    const unit = c.unit;
    const door = unit.door || (unit.lot ? { x: unit.lot.cx, z: unit.lot.cz } : null);
    const x = door ? door.x : c.parent.pos.x;
    const z = door ? door.z : c.parent.pos.z;
    const gender = rng() < 0.5 ? "f" : "m";
    // W12 DYNASTY NAMING: mint a gendered first name off the exact same
    // rng contract makePed's internal name(r,gender) uses (peds.js exports
    // it as CBZ.cityMintName), then graft on a parent's surname instead of
    // the fresh random one it came with — a kid carries the family name.
    // Falls back to the minted name untouched if neither parent's ledger
    // name has a surname token to borrow (surnameOf guards single-token
    // names defensively).
    let kidName = null;
    if (CBZ.cityMintName) {
      const minted = CBZ.cityMintName(rng, gender);
      const surname = surnameOf(nameOf(c.a)) || surnameOf(nameOf(c.b));
      kidName = surname ? (minted.split(" ")[0] + " " + surname) : minted;
    }
    let kid = null;
    try {
      kid = CBZ.cityMakePed(x, z, rng, {
        gender, archetype: "resident", job: "the kid", aggr: 0, armed: false,
        name: kidName || undefined,
      });
    } catch (err) { return false; }
    if (!kid) return false;
    // PATH B: spend exactly one unit of death-headroom to pay for this body —
    // must succeed (we already gated on dead>0 to get here; this is the
    // defensive re-check, see peds.js's cityPopulationBirth doc).
    const funded = CBZ.cityPopulationBirth ? CBZ.cityPopulationBirth(1) : 1;
    if (!funded) return false;
    // kid scale/hp — matches family.js's famPed(kid=true) exactly.
    if (kid.char && kid.char.group) kid.char.group.scale.setScalar(0.62);
    kid.hp = 40; kid.maxHp = 40;
    kid.famRole = "the kid";
    // enter the live world: arena root (rendering) + cityPeds (simulation) —
    // the vips.js/millionaires.js/scenedirector.js "spawn into the running
    // city" idiom, not family.js's yard-only members.
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.root && kid.group) A.root.add(kid.group);
    if (CBZ.cityPeds) CBZ.cityPeds.push(kid);
    // family tree + household + the offline book, in that order.
    if (CBZ.cityFamilyTree) CBZ.cityFamilyTree.bearChild(c.a, c.b, kid);
    if (CBZ.cityHouseholdJoin) CBZ.cityHouseholdJoin(kid, c.parent);
    if (CBZ.cityPedStash) CBZ.cityPedStash(kid);
    c.e.lb = now();   // stamp the cooldown on the LIVE edge object (persists — see header)
    const nameA = nameOf(c.a), nameB = nameOf(c.b);
    if (CBZ.cityFeed) {
      CBZ.cityFeed("👶 " + nameA + " & " + nameB + " welcomed " + (kid.name || "a baby"), "#ffd1e8");
    }
    // a happy, opinion-neutral ripple — reuses "proposal" (see header: we
    // don't own social.js's TOPIC table, and it already encodes this beat).
    if (CBZ.cityGossip && kid.pos) CBZ.cityGossip(kid.pos.x, kid.pos.z, "proposal", 0.5);
    return true;
  }

  function tryBirth() {
    const FT = CBZ.cityFamilyTree;
    if (!FT || !CBZ.cityMakePed || !CBZ.cityPopulation) return;
    // PATH B GATE: no death headroom this instant → no birth this attempt.
    // Re-checked live: don't cache — deaths/heals can change it between ticks.
    if (CBZ.cityPopulation().dead <= 0) return;
    const cands = eligibleCouples();
    if (!cands.length) return;
    const pick = cands[(rng() * cands.length) | 0];
    doBirth(pick);
  }

  // ---- the slow tick: one attempt every ~90-150s. Ordered 34.8 (just after
  // social.js's 34.5/34.6 and gangops.js's 34.7 — see header). ----
  let _t = 90 + rng() * 60;
  CBZ.onUpdate(34.8, function (dt) {
    if (!g || g.mode !== "city") return;
    if (noSim()) return;                     // host simulates; guests puppet, never birth locally
    _t -= dt;
    if (_t > 0) return;
    _t = 90 + rng() * 60;
    try { tryBirth(); } catch (err) {}
  });

  // ---- reset (mode.js guard-call convention, mirrors familytree.js's
  // cityFamilyTreeReset). Per-run state is just the cadence timer — the
  // cooldown stamps live on the tree's OWN edges, which cityFamilyTreeReset
  // already wipes by dropping the edges array. ----
  function reset() { _t = 90 + rng() * 60; }
  CBZ.cityBirthsReset = reset;
})();
