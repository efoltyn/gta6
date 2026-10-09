      let kdx/* ============================================================
   city/peds.js — the city's people, driven by ONE personality
   spectrum: `aggr` ∈ [0,1], from meek (flees everything) to violent
   (full agency — mugs, brawls, carjacks, fights cops, snatches a downed
   cop's gun, and racks up its OWN wanted level so police hunt it too).

   The same brain runs civilians, shop vendors AND gang members (gangs.js
   spawns them as peds with a high aggr + a turf guard point). Behaviour
   switches at the CITY.aggro band edges:

     aggr < flee   → flees crime, never throws a punch, calls the cops
     < bold        → stands its ground / films, fights only if attacked
     < crook       → starts petty crime (mug, shove), grabs dropped guns
     < violent     → brawler: attacks the weak, joins fights, carjacks
     ≥ violent     → rampage: attacks cops, steals cop guns, self-wanted

   Routines: peds pick destinations (shop doors, benches, corners, home),
   route through intersections to cross, idle/chat in pairs, and duck into
   buildings. LOD + AI time-slicing keep the crowd cheap.

   THE CITY KEEPS DIFFERENT HOURS: the street's CAST turns over with the
   sun (CBZ.nightAmount — the one canonical clock the neon/windows already
   ride). Off-screen civilians get re-dealt at the margins after each
   dusk/dawn flip: tourists go in at night, dealers/crooks come out in the
   projects, the core dresses up for the velvet rope, and the homeless
   gather at their camp fires. Count never changes — only WHO is out.
============================================================ */
(function () {
  "use strict";
  // job -> [colour, headwear.js kind] for peds cast into a hatted job
  const HAT_BY_JOB = [
    [/construction/i, 0xe8c020, "hardhat"],
    [/sheriff|deputy/i, 0x8a7752, "campaign:sheriff"],
    [/soldier/i, 0x44503a, "milcap"],
    [/pilot|first officer|aviator/i, 0x151c2e, "peaked:captain"],
  ];
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar } = CBZ;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};
  const tmp = new THREE.Vector3();
  // WALL-STEER scratch: cityNav.contextSteer writes the chosen unit dir here
  // (move() asks it for the WALL half only; neighbours go through CBZ.moves).
  const _ctxOut = { x: 0, z: 0 };
  // One spatial index for the rich city-ped rigs. Context steering used to
  // rescan the full ped list for every active mover; that becomes quadratic as
  // the city cast grows. Rebuild once per frame, then inspect only local cells.
  // The nearest-N insertion below is also smarter than the old first-N-in-array
  // cap: steering always reacts to the closest bodies, independent of spawn
  // order.
  //
  // PED_SCAN_GRID widens that one index into the crowd's SCAN INDEX, because a
  // dozen other bounded-radius questions ("who is inside the muzzle cone", "who
  // is raging at my brother", "is an armed ganger near me", "which body at my
  // feet still has loot") were each answering themselves by walking all ~560
  // bodies. Two shapes replace those walks:
  //   • THE GRID now holds EVERY body. A corpse, a passenger and a body
  //     mid-doorway are all legitimate answers to "who is within 11m of the
  //     muzzle", and the old membership filter would have silently dropped
  //     them — so membership is unconditional and each CONSUMER re-applies its
  //     own predicate. Steering keeps the old filter locally (see gatherNbrs),
  //     which is why its neighbour set is unchanged.
  //   • CANDIDATE LISTS — tiny supersets refreshed in the SAME pass (peds that
  //     hold a rage, peds wearing a set's colours) or kept by event (corpses
  //     that still carry loot, bodies frozen at gunpoint). A list is only ever
  //     a superset: the caller still runs its full old predicate, so the answer
  //     is the one the whole-crowd scan would have produced.
  // Everything is behind ONE flag; OFF restores the original linear scans.
  let _pedGrid = null;
  const _pedGridList = [];
  const CELL = 4;                  // grid cell size in metres — makeGrid(CELL)
  // Bodies that MOVED between this frame's rebuild and a mid-loop query. A ped
  // walks well under 0.3m per frame (and at most ~3 frames' worth in one
  // compensated PED_BRAIN_STAGGER tick), so 2m is several times the worst case
  // — it is what makes a cell query a guaranteed SUPERSET of the radius query.
  const SCAN_MARGIN = 2;
  // Candidate supersets, refreshed in cityPeds ORDER so a first-match-wins scan
  // over one of them lands on exactly the body the old whole-crowd scan did.
  const _rageList = [];            // .rage truthy as of this frame's rebuild
  const _gangList = [];            // .kind === "gang" as of this frame's rebuild
  const _corpseList = [];          // rolled deadLoot, kept by event (see _corpseAdd)
  const _coverList = [];           // ._covered — bodies held in a gunpoint pose
  const _scanBuf = [];             // nearestActor candidate scratch (reused, never re-alloc'd)
  const _gpBuf = [];               // gunpointSweep candidate scratch (separate: the sweep
                                   // bolts bodies, which re-enters other scans)
  let _scanOn = false;             // PED_SCAN_GRID, latched once per frame
  const _audit = {
    gridRoutedCalls: 0, listRoutedCalls: 0, linearFallbackCalls: 0,
    candidatesVisited: 0, linearVisited: 0,
  };
  const _nbrD2 = new Float32Array(8);
  const _nbrO = new Array(8).fill(null);   // nearest live on-foot bodies, for CBZ.moves avoidance
  function _pedVec(p) { return p.pos; }
  function rebuildPedGrid() {
    if (!_pedGrid && CBZ.makeGrid) _pedGrid = CBZ.makeGrid(CELL);
    // No spatialgrid.js → no index → every consumer must stay on its linear
    // path. Latched once per frame so a mid-frame flag flip can never leave
    // half the crowd reading an index the other half didn't build.
    _scanOn = !!_pedGrid && !!(CBZ.CONFIG && CBZ.CONFIG.PED_SCAN_GRID);
    if (!_pedGrid) return;
    _pedGridList.length = 0;
    if (!_scanOn) {
      const peds = CBZ.cityPeds;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p.dead && !p.inCar && !p._parked && p.enterT <= 0) _pedGridList.push(p);
      }
      _pedGrid.rebuild(_pedGridList, _pedVec);
      return;
    }
    _rageList.length = 0;
    _gangList.length = 0;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      p._gi = i;                     // cityPeds order — the tie-break a linear scan got for free
      _pedGridList.push(p);          // EVERY body: consumers filter, the index does not
      if (p.rage) _rageList.push(p);
      if (p.kind === "gang") _gangList.push(p);
    }
    _pedGrid.rebuild(_pedGridList, _pedVec);
  }
  // How many cells each side cover a radius query. A cell spans [CELL*g,
  // CELL*g+CELL), so visiting g-C..g+C guarantees CELL*C metres of coverage in
  // every direction from ANY point inside the centre cell — hence the ceil.
  function _cellR(radius, margin) { return Math.ceil((radius + margin) / CELL); }
  // Fill `buf` with every body whose cell can hold a hit for a `radius` query at
  // (x,z), IN cityPeds ORDER. The order is not cosmetic: several of these scans
  // are first-match-wins, and the ones that can bolt a body feed the shared
  // PANIC field and the seeded rng inside fleeFrom — visiting bodies in bucket
  // order instead of roster order would change that stream, and determinism is
  // doctrine. Candidate counts are single digits to low tens, so the insertion
  // is cheaper than any allocation-bearing sort. Returns false when there is no
  // index (caller falls back to its linear scan).
  function _collect(buf, x, z, radius, margin) {
    buf.length = 0;
    if (!_pedGrid) return false;
    const C = _cellR(radius, margin);
    const gx = _pedGrid.cellIndex(x), gz = _pedGrid.cellIndex(z);
    for (let cx = gx - C; cx <= gx + C; cx++) for (let cz = gz - C; cz <= gz + C; cz++) {
      const cell = _pedGrid.bucket(cx, cz); if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const p = cell[i];
        let at = buf.length;
        buf.push(p);
        while (at > 0 && buf[at - 1]._gi > p._gi) { buf[at] = buf[at - 1]; at--; }
        buf[at] = p;
      }
    }
    _audit.candidatesVisited += buf.length;
    return true;
  }
  // ---- the lootable-corpse list ----------------------------------------------
  // A body only becomes lootable in rollDeadLoot and only stops being lootable
  // by being looted, culled or recycled — four events, versus the whole crowd
  // being re-walked every frame (and once more per body in a pile, which is why
  // a massacre used to cost peds×corpses). The list is a SUPERSET: the query
  // re-runs the original predicate, so a body culled by another module (gangs.js
  // reaps its own) is still skipped exactly as before.
  function _corpseAdd(ped) {
    if (!ped || ped._inCorpseList) return;
    ped._inCorpseList = true;
    _corpseList.push(ped);
  }
  function _corpseDrop(ped) {
    if (!ped || !ped._inCorpseList) return;
    ped._inCorpseList = false;
    const i = _corpseList.indexOf(ped);
    if (i >= 0) _corpseList.splice(i, 1);
  }
  function _corpseClear() {
    for (let i = 0; i < _corpseList.length; i++) _corpseList[i]._inCorpseList = false;
    _corpseList.length = 0;
  }
  // ---- the gunpoint-pose list ------------------------------------------------
  // Only gunpointSweep raises _covered, and a raised body has to be RELAXED
  // every frame it isn't being aimed at — including the frames it has walked out
  // of the cells the sweep looks at, and every frame the player is holding no
  // gun at all. Both used to be a whole-crowd walk; both are this list.
  function _coverAdd(ped) {
    if (ped._inCoverList) return;
    ped._inCoverList = true;
    _coverList.push(ped);
  }
  function _coverDrop(ped) {
    if (!ped || !ped._inCoverList) return;
    ped._inCoverList = false;
    const i = _coverList.indexOf(ped);
    if (i >= 0) _coverList.splice(i, 1);
  }
  // Live counters for the orchestrator's probe. CUMULATIVE since load; pass
  // true to zero the call counters (the population fields are always current).
  CBZ.pedScanAudit = function (reset) {
    const out = {
      on: !!_scanOn,
      flag: !!(CBZ.CONFIG && CBZ.CONFIG.PED_SCAN_GRID),
      gridRoutedCalls: _audit.gridRoutedCalls,
      listRoutedCalls: _audit.listRoutedCalls,
      linearFallbackCalls: _audit.linearFallbackCalls,
      candidatesVisited: _audit.candidatesVisited,
      linearVisited: _audit.linearVisited,
      lootableCorpses: _corpseList.length,
      coveredPeds: _coverList.length,
      ragingPeds: _rageList.length,
      gangPeds: _gangList.length,
      indexedPeds: _pedGridList.length,
      population: CBZ.cityPeds ? CBZ.cityPeds.length : 0,
    };
    if (reset) {
      _audit.gridRoutedCalls = 0; _audit.listRoutedCalls = 0; _audit.linearFallbackCalls = 0;
      _audit.candidatesVisited = 0; _audit.linearVisited = 0;
    }
    return out;
  };
  // fleeFrom runs on a STATE TRANSITION (not the per-frame hot loop), so it may
  // build its short ped.path array there — cityNav.routeTo writes into the caller
  // array we hand it (ped owns ped.path; move() shifts it as the ped advances).

  const PED_R = 0.5, ANIM_D2 = 58 * 58, TAG_D2 = 26 * 26, FAR_D2 = 110 * 110;
  // collide() feet clearance: the player's (physics.js). A riser or a kerb box
  // under 0.42 m is stood on (walkGroundAt), never pushed back from, and a
  // stair's soffit band under a climber is never a wall across his flight.
  const PED_FOOT = 0.42;
  // Full-rig render distance. The instanced ambient crowd covers everything past
  // this, so drawing 16-mesh rigs out to 150u was pure waste — tightened to 95u.
  // Adaptive quality (core/quality.js -> CBZ.pedLOD) scales it down further on
  // weak GPUs. SHADOW_D2: rigs past ~42u stop casting shadows (a rig 50u away is
  // a few px tall — its shadow is invisible, but it doubled its cost in the
  // shadow pass). Toggled only on threshold crossings, so it's ~free per frame.
  let VIS_D2 = 95 * 95, SHADOW_D2 = 42 * 42;
  const CORPSE_VIS_D2 = 200 * 200;
  // core/quality.js publishes a tier LOD here; re-derive the squared cutoffs.
  CBZ.refreshPedLOD = function () {
    const lod = CBZ.pedLOD;
    if (!lod) return;
    if (lod.vis != null) VIS_D2 = lod.vis * lod.vis;
    if (lod.shadow != null) SHADOW_D2 = lod.shadow * lod.shadow;
  };
  // flip castShadow across a rig's meshes — only called when a ped crosses the
  // shadow distance threshold (a handful per second), never every frame.
  function setRigShadow(ch, on) {
    const g = ch && ch.group; if (!g) return;
    g.traverse(function (o) { if (o.isMesh) o.castShadow = on; });
  }
  let frame = 0;

  // ---- MODULE-OWNED CONFIG DEFAULTS (self-defaulted so a missing flag never
  //      throws; we own peds.js, so we don't touch config.js). ----
  // SPAWN-DISTRIBUTION (spawn-distribution-tuning): a thicker homeless population
  // makes "dangerous nights" land — 8 was thin for a city this size. Still carved
  // OUT of the ped budget (nVagrant is capped at peds/4 and the total stays flat),
  // so this redistributes WHO is out, it does NOT add bodies.
  if (CBZ.CITY) CBZ.CITY.vagrants = Math.max(CBZ.CITY.vagrants || 0, 14);
  // PLACE-SPAWN routing (SPAWN-1): emerge peds from real places (apartment doors,
  // store counters/queues) instead of random sidewalk when spawnplaces.js is loaded.
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_PLACE_SPAWN == null) CBZ.CONFIG.CITY_PLACE_SPAWN = true;
  // SPAWN-FROM-DOORS bias (H5): a fraction of fresh civvies appear just outside
  // their home/work door reading as "just left home / arriving for work".
  if (CBZ.spawnFromDoors == null) CBZ.spawnFromDoors = true;
  // HOBO NIGHT JUMPSCARE (hobo-night-jumpscare): owner-toggleable fright loop.
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_HOBO_SCARE == null) CBZ.CONFIG.CITY_HOBO_SCARE = true;
  // PED_SCAN_GRID: route the crowd's bounded-radius questions through the
  // per-frame ped index + the small candidate lists above instead of walking all
  // ~560 bodies per question (see the SCAN INDEX block at the top of the file).
  // OFF restores every original linear scan verbatim.
  if (CBZ.CONFIG && CBZ.CONFIG.PED_SCAN_GRID == null) CBZ.CONFIG.PED_SCAN_GRID = true;

  // ============================================================
  //  FINITE, NON-REGENERATING POPULATION (the "headcount").
  //  The city starts with a fixed living total and only ever goes DOWN as people
  //  die — there is no respawning. Both death paths (cityKillPed here for named
  //  rigs, cityCrowdKill in crowd.js for the ambient instanced mass) decrement the
  //  same `_alive` counter, and the ambient crowd's target density is derived FROM
  //  the remaining living count (crowd.js reads CBZ.cityPopulation()), so the
  //  streets visibly THIN after a massacre instead of magically refilling.
  //  Total is initialized lazily on first city spawn from the configured ped +
  //  crowd counts (a few hundred), so it tracks however busy the city is built.
  // ============================================================
  let _popTotal = 0, _popDead = 0, _popInit = false;
  function _ensurePop() {
    if (_popInit) return;
    _popInit = true;
    const named = (CBZ.CITY && CBZ.CITY.peds) || 160;
    const crowd = (CBZ.CITY && CBZ.CITY.crowd != null) ? CBZ.CITY.crowd : 700;
    // a believable city headcount: the named rigs + the ambient mass + a little
    // unseen slack (people indoors / off-screen) so it reads as a population, not
    // exactly the number of bodies currently rendered. 100 + 700 + 200 = the
    // four-figure city the HUD counts down from.
    _popTotal = named + crowd + 200;
    _popDead = 0;
  }
  // reset the roster for a fresh run (called from spawnCityPeds, the canonical
  // "new city" entry point). Total may grow if config changed; dead resets to 0.
  CBZ.cityPopulationReset = function () {
    _popInit = false; _popDead = 0; _ensurePop();
  };
  // ONE death recorded against the finite roster (never lets alive go below 0).
  CBZ.cityPopulationDie = function (n) {
    _ensurePop();
    _popDead = Math.min(_popTotal, _popDead + (n || 1));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();   // headcount changed → refresh the HUD
  };
  // W11 — BIRTHS: the one and only way `dead` ever goes back DOWN. This is
  // NOT population growth — total never moves. A birth just PROMOTES a body
  // that was already inside the finite headcount (the "few hundred unseen
  // slack" from _ensurePop's +200, or literally a death's own vacated slot)
  // into a named, living child, and spends exactly one unit of the headroom
  // a death created to pay for it. births.js is the sole caller: it already
  // refuses to attempt a birth unless CBZ.cityPopulation().dead > 0 (see its
  // header for the full "Path A vs Path B" reasoning), so in practice this
  // only ever consumes headroom that was checked a moment earlier in the same
  // synchronous tick — but it re-clamps at 0 here too, defensively, so no
  // caller can ever push `dead` negative (which would let alive > total).
  // Returns how many births this call actually funded (0 or `n`, never a
  // partial credit) so the caller can detect the (should-never-happen) case
  // where headroom evaporated between its own check and this call.
  CBZ.cityPopulationBirth = function (n) {
    _ensurePop();
    const want = n || 1;
    const take = Math.min(_popDead, want);
    if (take <= 0) return 0;
    _popDead -= take;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();   // headcount changed → refresh the HUD
    return take;
  };
  // {alive,total,dead} — the live battle-royale-style headcount for the HUD /
  // kill feed. alive only ever moves via cityPopulationDie/cityPopulationBirth
  // above (never both up AND down without a matching cause — see W11 note).
  CBZ.cityPopulation = function () {
    _ensurePop();
    return { alive: Math.max(0, _popTotal - _popDead), total: _popTotal, dead: _popDead };
  };

  // weapon pickups dropped in the world (cops/gangsters that get downed).
  CBZ.cityDrops = CBZ.cityDrops || [];

  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xfae0c8, 0x5a3c28];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0xdedede];
  // WHAT NORMAL PEOPLE WEAR — two racks, not one. The old single shared
  // palette dealt legs and torso from the SAME bright pool, so the street
  // walked around in purple pants under a neon shirt. Real people pull
  // jeans/khakis off a PANTS rack and a plain tee off a SHIRT rack.
  const PANTS = [0x2e4a6b, 0x27374d, 0x1d2430, 0x39414f, 0xb8a070, 0x4a5568];
  const SHIRT = [0xe8e6e0, 0x8a939c, 0x23262b, 0x2c3e5c, 0x33573b, 0x6e2b33, 0xc9a23a];
  // tourists stay LOUD on purpose (downtown's walking wallets read at a
  // glance) — matched to crowd.js's bright pool so promotion doesn't shift hue
  const BRIGHTS = [0xe2574c, 0x4fa3e0, 0xe8c84a, 0xd96bb0, 0xe8e4da];
  // WOMEN EXIST: the name pool splits by gender so a female ped draws a
  // female first name (see makePed's `gender` roll below). FIRST_F carries
  // the original female half PLUS ~15 new names in the same short-punchy
  // style; FIRST_M is the original male half, untouched. FIRST stays a
  // combined pool (kept for backward compat / the gender-less name(r) call).
  const FIRST_M = ["Marcus", "Vince", "Cam", "Jax", "Trey", "Otis", "Sal", "Boon", "Rex", "Hank", "Marlo", "Pim", "Dro", "Ray"];
  const FIRST_F = ["Tanya", "Lola", "Dee", "Mona", "Rosa", "Bree", "Kira", "Nia", "Gita", "Suze", "Esi", "Val", "Cyd", "Nyla",
    "Nadia", "Trish", "Simone", "Coco", "Reyna", "Zola", "Ivy", "Wren", "Mabel", "Fawn", "Solange", "Priya", "Yara", "Tess", "Bianca"];
  const FIRST = FIRST_M.concat(FIRST_F);
  // W12: real surnames — replaces the old single random LAST initial ("First
  // X."). Audited before widening: city/props.js:24's makeLabelSprite
  // auto-shrinks the font to fit whatever text width it's given (no
  // truncation), and city/level.js overwrites a ped's tag wholesale with
  // "Lv.N Title" rather than ever reading ped.name — so nothing in the
  // codebase depends on the short single-letter form. Mixed origins to match
  // FIRST_M/FIRST_F's own tone.
  const SURNAMES = [
    "Reyes", "Okafor", "Volkov", "Nakamura", "Marino", "Delgado", "Kowalski", "Haddad",
    "Silva", "Petrov", "Nguyen", "Brennan", "Castillo", "Yamamoto", "Adeyemi", "Novak",
    "Torres", "Hassan", "Larsen", "Moreau", "Kim", "Abara", "Rossi", "Fitzgerald",
    "Kaur", "Mensah", "Ibarra", "Chen", "Duarte", "Bianchi", "Salazar", "Okonkwo",
    "Whitfield", "Suzuki", "Park", "Alvi", "Dimitriou", "Wozniak", "Fontaine", "Osei",
  ];
  function pick(a, r) { return a[(r * a.length) | 0]; }

  let _s = 555;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  // gender-aware: pass the ped's rolled gender ("f"/"m") to draw from the
  // matching pool; omit it (existing callers, if any) to keep the old
  // combined-pool behavior byte-identical. W12: mints "First Last" off the
  // real SURNAMES pool; exported below as CBZ.cityMintName so births.js can
  // mint a gendered first name and then graft on a parent's surname (the
  // dynasty rule) instead of a fresh random one.
  function name(r, gender) {
    const pool = gender === "f" ? FIRST_F : gender === "m" ? FIRST_M : FIRST;
    return pick(pool, r()) + " " + pick(SURNAMES, r());
  }

  // Scream audio is intentionally disabled. Panic/fear behavior still runs, but
  // the human scream sample was too intrusive during city chaos.
  function scream() {}

  // a normal-ish draw on the spectrum around a mean, clamped
  function rollAggr(mean, spread) {
    const r = (rng() + rng() + rng()) / 3;     // ~bell
    return Math.max(0, Math.min(1, mean + (r - 0.5) * 2 * (spread || 0.2)));
  }

  // wealth distribution skewed so plenty of WELL-OFF people walk the streets
  // (visible chains/watches, fat wallets) with the odd WHALE — richer marks to
  // rob, and a more alive, varied city. econ.rollCash maps wealth → cash.
  function richWealth(r) {
    const x = r();
    if (x > 0.984) return 0.99;                 // ~1.6% whale ($1.5k–10k on them)
    if (x > 0.88) return 0.82 + r() * 0.14;     // ~10% wealthy (jewellery, big wallet)
    if (x > 0.66) return 0.6 + r() * 0.2;       // ~22% comfortable
    return r() * 0.6;                            // the rest: ordinary
  }

  // ============================================================
  //  WEALTH / BOUNTY ASSIGNMENT (econ helpers from Agent 1, fully guarded)
  // ------------------------------------------------------------
  //  WHO a ped is decides what they carry. Most people stay modest; a small slice
  //  of the well-dressed crowd are secret WHALES (a tycoon with a Patek, a
  //  socialite with a 7-figure ring) so robbing/looting/killing is occasionally a
  //  jackpot — never the norm. A rare ped is a wanted FUGITIVE worth a bounty paid
  //  to YOU on their death (you can get insanely rich killing the right person, even
  //  by accident). All econ calls are guarded (rollCashFor/rollValuables are added
  //  by economy.js; we fall back to the older rollCash + a name list if absent).
  // ============================================================
  // module-level fugitive tally so we can keep the jackpot bounty city-wide-rare
  // (reset each spawnCityPeds). At most ONE mega-bounty ($5M terrorist) per city.
  let _fugitives = 0, _megaFugitiveSpawned = false;

  // luxury-watch jackpot pool used by the FALLBACK rollValuables (econ owns the
  // canonical one). These names must exist in economy.js ITEMS as valuables.
  const LUX_WATCH = ["Audemars Piguet", "Patek Philippe", "Richard Mille"];

  // FALLBACK cash-by-who (used only if econ.rollCashFor is absent). Mirrors the
  // shared contract's tiers: poor → boss/tycoon.
  function fallbackCashFor(archetype, wealth, r) {
    const a = archetype || "resident";
    if (a === "boss" || a === "tycoon" || a === "billionaire") return 10000 + ((r() * 80000) | 0);
    if (a === "mobster" || a === "made") return 5000 + ((r() * 35000) | 0);
    if (a === "dealer") return 1500 + ((r() * 13500) | 0);
    if (a === "socialite") return 800 + ((r() * 4000) | 0);
    const econ = CBZ.cityEcon;
    return econ ? econ.rollCash(wealth) : (5 + ((r() * 45) | 0));
  }

  // FALLBACK valuables-by-who (used only if econ.rollValuables is absent). Keeps
  // the mega-items RARE so "occasionally insanely rich" stays a jackpot.
  function fallbackValuables(archetype, wealth, r) {
    const a = archetype || "resident", out = [];
    if (a === "tycoon" || a === "billionaire") {
      out.push(LUX_WATCH[(r() * LUX_WATCH.length) | 0]);
      if (r() < 0.4) out.push("Briefcase of Cash");
      if (r() < 0.15) out.push("Bearer Bonds");
    } else if (a === "socialite") {
      out.push("Engagement Ring");
      if (r() < 0.6) out.push("Designer Bag");
      if (r() < 0.3) out.push("Tennis Bracelet");
    } else if (a === "boss" || a === "mobster" || a === "made") {
      out.push("Gold Chain");
      if (r() < 0.5) out.push(r() < 0.3 ? "Rolex" : "Omega");
      if (r() < 0.12) out.push("Briefcase of Cash");
    } else if (a === "dealer") {
      out.push("Gold Chain");
      if (r() < 0.3) out.push("Cash Stack");
    } else {
      // ordinary folk: usually nothing of note, sometimes a phone/wallet, and the
      // genuinely well-off occasionally pack a real piece.
      if (r() < 0.35) out.push(r() < 0.6 ? "Phone" : "Wallet");
      if (wealth > 0.85 && r() < 0.25) out.push(r() < 0.5 ? "Omega" : "Designer Bag");
      if (wealth > 0.95 && r() < 0.12) out.push("Rolex");
    }
    return out;
  }

  // roll an upgraded RARE high-wealth archetype off a generic well-dressed ped.
  // Returns a tycoon/billionaire/socialite tag (with matching wealth bump) a small
  // % of the time, else null (keep MOST peds modest). Deterministic stream (r).
  function rollRareArchetype(baseArch, wealth, r) {
    // only the visibly well-off get promoted, and even then rarely.
    if (wealth < 0.8) return null;
    const x = r();
    if (x < 0.06) return { archetype: r() < 0.5 ? "tycoon" : "billionaire", wealth: 0.97 + r() * 0.03 };
    if (x < 0.14) return { archetype: "socialite", wealth: 0.93 + r() * 0.06 };
    return null;
  }

  // roll a bounty for a rare FUGITIVE. Mostly modest $5k–50k; an exceedingly rare
  // jackpot up to $5,000,000 ("a wanted terrorist with a price on their head").
  // Capped to ONE mega-bounty per city. Returns {bounty, tag} or null.
  function rollBounty(r) {
    // ~1.2% of peds are wanted; keep the count city-wide-rare.
    if (r() >= 0.012 || _fugitives >= 14) return null;
    _fugitives++;
    // the once-per-city terrorist: a price on their head that changes your life.
    if (!_megaFugitiveSpawned && r() < 0.06) {
      _megaFugitiveSpawned = true;
      return { bounty: 1500000 + ((r() * 3500000) | 0), tag: "WANTED TERRORIST" };
    }
    const x = r();
    const tag = x < 0.5 ? "WANTED" : (x < 0.85 ? "FUGITIVE" : "ARMED & DANGEROUS");
    // modest tier: $5k–50k, with an uncommon $50k–250k "high-value target".
    const bounty = r() < 0.85 ? (5000 + ((r() * 45000) | 0)) : (50000 + ((r() * 200000) | 0));
    return { bounty, tag };
  }

  // the jobs the jobless mass gets re-dealt into (makePed below). Every one of
  // these maps to a real lot in CBZ.cityJobs (aigoals.js — the one job table),
  // so the recast is a VISIBLE life: a post to stand, a shift to run, a door
  // to commute through. Weighted toward the street-facing trades (cabs, carts,
  // counters) because those are the ones the player can see and use.
  const JOB_RECAST = [
    "cab driver", "cab driver", "street vendor", "street vendor", "courier",
    "line cook", "personal trainer", "security guard", "barber", "mechanic",
    "retail worker", "delivery driver",
  ];

  // ============================================================
  //  A UNIT IS A PYRAMID, AND A PYRAMID IS A ROSTER — NOT A DICE ROLL.
  //
  //  The old military-rank line rolled ONE number per body against a ladder of
  //  thresholds, with General at r() > 0.997. That is 3 bodies in a thousand,
  //  drawn off the SEEDED stream — so a seed whose garrison never happened to
  //  roll it produced no general AT ALL, no matter how long you played. The top
  //  rung of the largest ladder in the repo was unreachable by construction,
  //  which is the stat-fiction ban applied to ranks.
  //
  //  A real unit is not staffed by luck. It is staffed by SLOT: the first
  //  bodies a garrison stands up ARE its command element, and then a line
  //  pattern repeats — one sergeant and two corporals to roughly a dozen
  //  riflemen. So rank comes off the roster ordinal and the pyramid is exact at
  //  any garrison size: a base has a commander the moment it has bodies, and he
  //  is somebody you can walk up to.
  //
  //  DETERMINISM: the ordinal advances only for POSTED military bodies, in
  //  world-build order, and is reset by clearCityPeds — so the same seed builds
  //  the same chain of command. The r() draw below is KEPT (one draw, in the
  //  same position it always occupied) so no downstream draw shifts.
  //
  //  The rank KEYS are militia.js's declared "army" ladder. This table holds no
  //  rank names of its own beyond them, and there is deliberately no Captain,
  //  Major or Colonel here any more — see ARMY_LADDER for why they were cut.
  const MIL_STAFF = ["general", "lieutenant", "sergeant"];
  const MIL_LINE = [
    "corporal", "private", "private", "private", "recruit", "private", "private", "sergeant",
    "private", "private", "corporal", "private", "private", "private", "recruit", "private",
  ];
  let _milSlot = 0;
  function milSlotRank(n) {
    return n < MIL_STAFF.length ? MIL_STAFF[n] : MIL_LINE[(n - MIL_STAFF.length) % MIL_LINE.length];
  }

  // ============================================================
  //  CBZ.cityDealRole(ped) — THE CASTING REPAIR. "CIVILIAN ISN'T A ROLE."
  //
  //  OWNER (2026-07-27): "there's roles 'the kid' 'in between jobs' — deeply
  //  look at roles and npc behavior and what's dumb … civilian isn't a role."
  //
  //  Before this, ~76% of the core district, ~73% of commercial and ~96% of
  //  residential spawns left castForDistrict with NO archetype and NO job at
  //  all — they became `archetype:"resident"` inside makePed and fell all the
  //  way through level.js's title chain to the literal string "Civilian". That
  //  is not a person; it is a body with the label switched off.
  //
  //  The old fix would have been a nicer fallback string. This is the real one:
  //  a person with no role is a CASTING BUG, so we CAST THEM — and we cast them
  //  into a job that already has a workplace, a shift and a wage in aigoals.js's
  //  CITY_JOBS, which is the one job table in the game. So the repair does not
  //  buy a label, it buys a LIFE: a counter to stand behind, a cab to drive, a
  //  door to commute through, a payday.
  //
  //  WHO CALLS IT: level.js's 0.33 s retag sweep, whenever cityTitle() comes
  //  back roleless — so the cast self-heals for everybody the player can
  //  actually see, and CBZ.roleAudit().roleless walks down during play. Also
  //  crowd.js, at the moment an ambient body is promoted to a real rig (that
  //  promotion used to hand out `job:"between jobs"` by hand — the owner's own
  //  example of the problem).
  //
  //  DETERMINISM (law #12): NEVER Math.random and never a draw on a shared
  //  rng() stream — the sweep order depends on where the CAMERA is, so a stream
  //  draw here would desync two multiplayer clients watching the same street.
  //  CBZ.hash01 is position-hashed and order-independent, seeded off the body's
  //  SPAWN point (stamped once, so a walking person keeps the job they were
  //  dealt). Two clients deal the same person the same job with no messaging.
  // ============================================================
  // jobs whose read is a district's own trade, so a repair fits the block it
  // happens on rather than sprinkling baristas through the docks.
  const DISTRICT_JOBS = {
    industrial: ["dock worker", "warehouse worker", "construction worker", "mechanic", "courier"],
    projects:   ["retail worker", "line cook", "courier", "cab driver", "barber"],
    commercial: ["office worker", "accountant", "retail worker", "nurse", "barber", "street vendor"],
    core:       ["office worker", "street vendor", "cab driver", "bartender", "retail worker", "personal trainer"],
  };
  function roleHash(ped, salt) {
    if (ped._roleSeedX == null) { ped._roleSeedX = ped.pos ? ped.pos.x : 0; ped._roleSeedZ = ped.pos ? ped.pos.z : 0; }
    return CBZ.hash01 ? CBZ.hash01(ped._roleSeedX, ped._roleSeedZ, salt) : 0.5;
  }
  // does this person already have a reason to exist? Mirrors level.js's role
  // chain WITHOUT calling it (level.js calls US; a mutual call would recurse).
  function hasRole(ped) {
    if (!ped) return true;
    if (ped.isPlayer || ped.vendor || ped.gang || ped.vipTitle || ped.kind === "cop" ||
        ped.kind === "security" || ped.milRank || ped.bounty > 0 || ped.rampage ||
        ped.vagrant || ped.child || ped.companion || ped.recruited || ped.controlled) return true;
    // a job that survives the vocabulary check IS a role; a gerund is not.
    if (ped.job && CBZ.cityJobTitle && CBZ.cityJobTitle(ped.job)) return true;
    if (!CBZ.cityJobTitle && ped.job) return true;      // degrade: level.js absent
    const a = ped.archetype;
    return !!(a && a !== "resident" && a !== "civilian" && a !== "worker");
  }
  // ============================================================
  //  CBZ.cityEnsureCover(ped) — WHO NEEDS TO NOT BE SEEN.
  //
  //  OWNER (2026-07-27): "nobody would have role agent, they would have
  //  whatever role the agent puts... they would have role agent if you joined
  //  their agency!"
  //
  //  He is describing tradecraft, and he is right that I got it backwards an
  //  hour ago: I cast intelligence officers with a VISIBLE "Agent" pill, which
  //  is the one thing an intelligence officer is definitionally not. The role
  //  stays exactly as cast — the SIMULATION still knows he is an agent, which
  //  is the whole point of level.js's true/presented split — and what changes
  //  is that outsiders read the cover he is running.
  //
  //  The cover job is drawn from the SAME deterministic hash and the SAME
  //  district pool an ordinary repair uses, so an agent's cover is exactly as
  //  plausible as a real person's job — because it is generated by the same
  //  code that generates real people's jobs. You cannot spot him by the cover
  //  looking synthetic.
  //
  //  `org: "agency"` is what makes this not a fiction: join the Bureau and
  //  factions.tier("agency") opens the file. Until then the only other way
  //  through is a burn.
  // ============================================================
  const COVERED_JOBS = {
    "intelligence agent": { org: "agency", seeTier: 2 },
    "serial killer":      { org: null,     seeTier: 9 },   // only a burn — he commits
  };
  CBZ.cityEnsureCover = function (ped) {
    if (!ped || ped._coverDone || !CBZ.citySetCover) return false;
    const spec = COVERED_JOBS[String(ped.job || "").toLowerCase()];
    if (!spec) { ped._coverDone = 1; return false; }
    ped._coverDone = 1;
    const A = CBZ.city && CBZ.city.arena;
    const d = (A && A.districtAt) ? A.districtAt(ped.pos.x, ped.pos.z) : null;
    const pool = (d && DISTRICT_JOBS[d.kind]) || JOB_RECAST;
    const cover = pool[(roleHash(ped, 0xC0FE) * pool.length) | 0] || pool[0];
    const title = CBZ.cityJobTitle ? CBZ.cityJobTitle(cover) : cover;
    CBZ.citySetCover(ped, { role: title, org: spec.org, seeTier: spec.seeTier, lvl: null });
    return true;
  };

  // ============================================================
  //  THUG AND BUM — THE TWO ROLES THAT ARE NOT JOBS.
  //
  //  OWNER (2026-07-29, verbatim): "thugs and bums roles. thug is unemployed
  //  gangster and bum duh."
  //
  //  He is finishing the sentence he started with "civilian isn't a role".
  //  cityDealRole below repairs a roleless person by dealing them a TRADE, and
  //  that repair quietly asserts something false about this city: that everyone
  //  in it works. The man on the corner in his crew's colours with no rank, and
  //  the woman asleep in the doorway, are not cashiers nobody has hired yet.
  //  They are the two roles the street keeps for people with no wage, and
  //  UNEMPLOYMENT MUST BE REPRESENTABLE, NOT REPAIRED AWAY.
  //
  //  NEITHER ROLE AUTHORS ANYTHING — no brain, no bark, no update loop, no new
  //  field. Each is one stamp on a field that already drives shipped systems,
  //  which is the entire reason they are cheap:
  //
  //    BUM  = `vagrant` — read by the night hunt (isHunterBum below), the cop
  //           move-along, the beg/bark microBehaviour (`_role:"panhandler"` +
  //           `_beg`), aigoals' "a vagrant carries no rent" branch and the rag
  //           wardrobe. level.js's CONDITION ladder already titles it "Bum".
  //    THUG = `archetype:"thug"` — already titled "Thug" by level.js's
  //           ARCH_TITLE, and read by combat_iq.js's fighting tier. His
  //           aggression is not a new number either: it is the band this file's
  //           own header names — "< violent → brawler: attacks the weak, joins
  //           fights, carjacks" (CBZ.CITY.aggro.crook 0.72 → violent 0.88) —
  //           and it stops deliberately SHORT of `violent`, because that band
  //           belongs to the one-per-city neighbourhood nightmare and the
  //           volatile camp vagrant. Stacking thugs into it would triple the
  //           psycho population, which is a different change.
  //
  //  WHAT IS DELIBERATELY NOT DONE: a dealt thug does NOT get `ped.gang`.
  //  `gang.members` is gangs.js's roster and it is what commits a body to wars,
  //  promotions, defections and drive-bys — a body carrying a gang id that is
  //  not on that roster is exactly the parallel-bookkeeping trap CLAUDE.md
  //  bans, and roleAudit would additionally bucket him under "prospect", so an
  //  org census would start counting corner toughs as rung-holders (a stat
  //  fiction about the ladder). He is affiliated by DISTRICT instead — see the
  //  share tables below, and the note there on why a live turf read was refused.
  //  The genuinely affiliated case is handled the other way round, as a READ:
  //  level.js's roleOf now titles any rung-less gang body "Thug" instead of
  //  quietly promoting him to Soldier.
  //
  //  DETERMINISM (law #12): every draw below is CBZ.hash01 off the body's spawn
  //  point (roleHash), never Math.random and never a shared rng() stream — this
  //  path runs in an order that depends on where the CAMERA is, so two clients
  //  have to agree with no messaging.
  //
  //  Flag CITY_THUG_BUM_ROLES; off = deal everyone a trade, exactly as before.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_THUG_BUM_ROLES == null) CBZ.CONFIG.CITY_THUG_BUM_ROLES = true;
  function THUG_BUM_ON() { return !CBZ.CONFIG || CBZ.CONFIG.CITY_THUG_BUM_ROLES !== false; }

  // HOW MANY BUMS. spawnVagrants seeds CBZ.CITY.vagrants (14) against
  // CBZ.CITY.peds (100) named rigs and puts ALL of them in the projects pocket,
  // with one in four on the industrial fringe. So `projects` below is set AT
  // that seeded density — it is the read the owner already has for that pocket
  // — and every other district is cut to about a fifth of it, because
  // spawnVagrants puts NOBODY downtown and a 13% homeless read on the strip
  // would be a different city, not a repair. The SHAPE matters more than any
  // single number would: this path fires on a far larger, churning population
  // than the seeded pass (every crowd promotion arrives here, because crowd.js's
  // resetToPlain nulls `job` by design), so one flat share would flood the map.
  const BUM_SHARE = { projects: 0.13, industrial: 0.07, commercial: 0.025, core: 0.02 };
  // HOW MANY THUGS. castForDistrict already casts the street economy at 46% of
  // the projects (dealer .20 / hustler .16 / tweaker .10) and 13% of the
  // industrial fringe. The thug is the fourth member of that family — the one
  // with nothing to sell — so his share is set INSIDE the density those three
  // already establish rather than beside it. Downtown gets almost none: a tough
  // on the strip is a MUGGER, and scenedirector.js already stages those with
  // `archetype:"thug"` and a crime attached.
  const THUG_SHARE = { projects: 0.16, industrial: 0.06, commercial: 0.015, core: 0.015 };
  const STREET_ELSEWHERE = 0.02;    // towns, biome settlements, the wilds
  // REFUSED, and worth writing down so nobody adds it back: weighting the thug
  // share by CBZ.cityGangOf() (whose corner is this?) reads well and is wrong
  // here. Turf CHANGES HANDS during play (turf.js), so a turf-derived share is
  // not a stable answer about a PERSON — two clients that deal the same body on
  // either side of a takeover would disagree, and the whole point of hashing
  // off the spawn point is that they never have to talk. The district read
  // below is fixed for the life of the world, which is what a cast needs.

  // WHO IS NEVER DEALT ONE OF THESE. Two rules; the rest is bookkeeping.
  //  (a) A CHILD IS NEVER A THUG OR A BUM. `band` is the field level.js's own
  //      condition ladder tests, so this asks the ladder's question rather than
  //      inventing a second age test — a kid with no role stays a kid.
  //  (b) A PERSON IN A PAID SEAT IS NOT SLEEPING IN A DOORWAY. arena_fights.js
  //      and island_speedway.js call cityDealRole on spectators; `_attending`
  //      is the field level.js gave them, so it answers this for free.
  function streetCastOk(ped) {
    if (!THUG_BUM_ON() || !ped || ped.dead || ped.isPlayer || ped._parked) return false;
    if (ped.child || ped.band === "child" || ped.band === "infant" || ped.band === "teen") return false;
    if (ped.ageYears != null && ped.ageYears < 18) return false;
    if (ped._attending || ped._npcAttached || ped.inCar) return false;
    if (ped.staffPost || ped._occupyGarrison || ped._regionLife) return false;
    if (ped.controlled || ped.companion || ped.recruited || ped.hostage) return false;
    // anything the world gave a KIND to is somebody else's cast (cop, security,
    // vendor, warband fighter, crew). Only the plain street mass is eligible.
    if (ped.kind && ped.kind !== "civilian" && ped.kind !== "gang") return false;
    return true;
  }
  function streetShare(tbl, d) {
    return (d && tbl[d.kind] != null) ? tbl[d.kind] : STREET_ELSEWHERE;
  }
  // the cached LIFE, wiped so aigoals re-derives a routine for the person they
  // now are — the same fields the trade deal below wipes, MINUS `_castFit`.
  // That omission is deliberate: `_castFit` is outfits.js's record of what this
  // body is VISIBLY wearing, and redressPed's strip-the-uniform branch is gated
  // on it. Nulling it here and then having the off-camera gate refuse the
  // redress would leave a bum standing in hospital scrubs with the game
  // believing he was in plain clothes. Let redressPed own that field: it either
  // repaints (and stamps the new fit) or the record stays TRUE to the rig.
  function clearCastCache(ped) {
    ped._role = null; ped._work = null; ped._snapAt = null; ped._stage = null;
    ped._dripKey = null;
  }
  // NEVER RE-DRESS A BODY IN YOUR FACE — the identical gate the trade deal uses.
  // Rags and streetwear are a real wardrobe change, so it waits for the shared
  // transition gate to say the body is off-camera; the IDENTITY lands instantly
  // either way, because a role is a LIFE first and a costume second.
  function redressWhenUnseen(ped) {
    if (!CBZ.cityRedressPed) return;
    if (CBZ.npcTransitionSafe &&
        !CBZ.npcTransitionSafe(ped.pos.x, ped.pos.z, { minDistance: 18, maxDistance: 400 })) return;
    try { CBZ.cityRedressPed(ped); } catch (e) {}
  }

  // BECOME A BUM. This is aigoals.js's eviction recipe (tryEvict), which is
  // itself spawnVagrants' recipe — ONE homeless identity, three doors, no
  // fourth variant of the same person. The only substitution is the draw:
  // hash01 where eviction uses rng(), for the determinism reason above.
  function dealBum(ped, d) {
    if (!streetCastOk(ped)) return false;
    // A MAN WITH A LEASE IS NOT HOMELESS. `_unit` is housing.js's real leased
    // unit and is cleared on every deal (schedule.js), so it is an honest claim.
    // `_home`/`_digs` deliberately are NOT tested: they are lot pointers aigoals
    // assigns lazily and crowd.js's resetToPlain does not clear, so on a
    // RECYCLED pooled rig they belong to the previous occupant — testing them
    // would bias the cast on stale data rather than on this person.
    if (ped._unit) return false;
    if (roleHash(ped, 0xB0DD) >= streetShare(BUM_SHARE, d)) return false;
    clearCastCache(ped);
    ped.vagrant = true;                          // cops/quests read it (move-along)
    ped.archetype = "vagrant";
    // `job` STAYS NULL, and this is the one place this cast diverges from the
    // two older producers (both write job:"panhandling"). level.js's own law is
    // that a GERUND is not a role — its JOB_TITLE row for "panhandling" is a
    // rescue of those producers, not an endorsement — so a dealt bum resolves
    // through the CONDITION ladder, which is where that file's doctrine puts
    // "Bum". Same word over the head either way; only roleAudit's `kinds` can
    // tell the two apart (condition here, job there).
    ped.job = null;
    ped._role = "panhandler";                    // the existing beg/bark loop
    ped._beg = { x: ped.pos.x, z: ped.pos.z };   // post up where they are
    // MEEK, AND THAT IS A DESIGN CALL RATHER THAN A DEFAULT. isHunterBum() draws
    // the night predator from the volatile band (aggr >= violent) ∩ a 0.55 hash,
    // and the block above it explains that the resulting 2-3 hunters in a whole
    // city is chosen AGAINST the menace gauge — "a predator you meet three times
    // a block is a tax". Dealt bums arrive CONTINUOUSLY, so letting any of them
    // roll volatile would grow the hunter population without limit. The hunt
    // stays pinned to the 14 seeded camp vagrants; these are the harmless
    // majority that camouflage them.
    ped.aggr = 0.08 + roleHash(ped, 0xB0DE) * 0.18;      // spawnVagrants' meek band
    ped.reactivity = ped.aggr;
    ped.armed = false; ped.weapon = null; ped.ammo = 0;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(ped); } catch (e) {} }
    ped.wealth = 0.02 + roleHash(ped, 0xB0DF) * 0.05;    // spawnVagrants' band
    ped.cash = (roleHash(ped, 0xB0E0) * 9) | 0;          // begging money, not robbing money
    ped.valuables = [];                                  // nobody sleeps rough in a watch
    // the shuffle — a PERMANENT slow-down, so end any live joy boost first or it
    // would restore the old speed later (tryEvict's guard, copied verbatim).
    if (ped._joyT > 0 && ped._baseSpeed0 != null) { ped.baseSpeed = ped._baseSpeed0; ped._baseSpeed0 = null; ped._joyT = 0; }
    if (ped.baseSpeed) ped.baseSpeed = Math.max(0.45, ped.baseSpeed * 0.6);
    ped._digs = null; ped._unit = null; ped._jobLot = null; ped._clockedIn = false;
    if (ped._needs) { ped._needs.rent = 1; if (ped._needsK) ped._needsK.rent = 0; }   // a vagrant carries no rent
    redressWhenUnseen(ped);
    return true;
  }

  // BECOME A THUG. No job, no workplace, no shift, no wage — that IS the role.
  function dealThug(ped, d) {
    if (!streetCastOk(ped)) return false;
    if (roleHash(ped, 0x7406) >= streetShare(THUG_SHARE, d)) return false;
    clearCastCache(ped);
    ped.archetype = "thug";
    ped.job = null;                              // CITY_JOBS owns workplace/shift/wage; he has none
    // THE CROOK BAND — this file's own vocabulary, not a fresh number. Short of
    // `violent` on purpose (see the header): that band is the rampager's.
    const B = A0();
    const lo = (B.crook || 0.72) + 0.01, hi = (B.violent || 0.88) - 0.02;
    ped.aggr = Math.max(ped.aggr || 0, lo + roleHash(ped, 0x7407) * Math.max(0, hi - lo));
    ped.reactivity = ped.aggr;
    ped.snitch = Math.min(ped.snitch != null ? ped.snitch : 1, 0.12);   // the street doesn't call the law
    redressWhenUnseen(ped);
    return true;
  }

  // THE REPAIR HALF — a body the WORLD affiliated to a crew and never ranked.
  // Rare by construction today (gangs.js ranks every crew body it posts, and
  // its kin are excluded here because kin are not crew), so the PRIMARY read
  // for this class lives in level.js's roleOf; the stamp is here so combat_iq
  // and the wardrobe agree with the pill instead of only the pill being right.
  // It runs BEFORE hasRole(), because hasRole answers TRUE for anybody carrying
  // `gang` — correct for the 99% who hold a rung, and exactly what hid this
  // class from the casting repair for its whole life.
  function thugRepair(ped) {
    if (!streetCastOk(ped)) return false;
    if (!ped.gang || ped.rank) return false;                          // a rung IS the role
    if (ped.isFamily || ped.famRole || ped.gangFamily) return false;  // kin are not crew
    if (ped.archetype === "thug") return false;                       // already dealt
    if (ped.job && CBZ.cityJobTitle && CBZ.cityJobTitle(ped.job)) return false;   // he works
    const a = ped.archetype;
    if (a && a !== "resident" && a !== "civilian" && a !== "worker" && a !== "gangster") return false;
    clearCastCache(ped);
    ped.archetype = "thug";
    redressWhenUnseen(ped);
    return true;
  }

  CBZ.cityDealRole = function (ped) {
    if (!ped || ped.dead) return false;
    if (thugRepair(ped)) return true;              // affiliated, unranked, unemployed
    if (hasRole(ped)) return false;
    const A = CBZ.city && CBZ.city.arena;
    const d = (A && A.districtAt) ? A.districtAt(ped.pos.x, ped.pos.z) : null;
    // UNEMPLOYMENT BEFORE EMPLOYMENT. Both are checked before the trade pool,
    // because the trade deal is the thing that was erasing them.
    if (dealBum(ped, d)) return true;
    if (dealThug(ped, d)) return true;
    const pool = (d && DISTRICT_JOBS[d.kind]) || JOB_RECAST;
    const job = pool[(roleHash(ped, 0x51D) * pool.length) | 0] || pool[0];
    ped.job = job;
    // the archetype must agree with the trade or outfits.js dresses the wrong
    // person (a "dock worker" cast as a professional gets an office blazer).
    if (!ped.archetype || ped.archetype === "resident" || ped.archetype === "worker") {
      ped.archetype = /dock|warehouse|construction|mechanic|courier/.test(job) ? "laborer"
        : /office|accountant|nurse/.test(job) ? "professional" : "merchant";
    }
    // wipe the cached life so aigoals re-derives a workplace, a shift and a
    // commute for the person they now are (same fields cityRecastForHour clears).
    ped._role = null; ped._work = null; ped._snapAt = null; ped._stage = null;
    ped._dripKey = null; ped._castFit = null;
    // NEVER RE-DRESS A BODY IN YOUR FACE. crowd.js's resetToPlain exists
    // because a promoted crowd body that got repainted on camera was the
    // visible "dumb load-in clothing swap". Only the trades with an actual
    // uniform need a redress at all, and only once the shared transition gate
    // says the body is off-camera — the deal itself is instant either way,
    // because a job is a LIFE first and a costume second.
    if (CBZ.cityRedressPed && /security|guard|vendor|dock|construction|nurse|mechanic/i.test(job) &&
        (!CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(ped.pos.x, ped.pos.z, { minDistance: 18, maxDistance: 400 }))) {
      try { CBZ.cityRedressPed(ped); } catch (e) {}
    }
    return true;
  };

  // DEFINITIONALLY-FEMALE archetypes — the wife/socialite identities family.js
  // and social.js spawn for a boss/tycoon's household (mirrors ARCH_DRIP's
  // wife-tier keys further down this file). A ped cast as one of these is
  // always a woman; every other archetype splits ~48/52 (see makePed's gender
  // roll below).
  const FEMALE_ARCH = {
    socialite: 1, mobwife: 1, "mob-wife": 1, bosswife: 1, kingpinwife: 1,
    tycoonwife: 1, heiress: 1, richwoman: 1, "rich woman": 1,
  };

  function makePed(x, z, r, opts) {
    opts = opts || {};
    const ag = A0();
    // GENDER: who this ped IS — drives makeCharacter's build/hair below, the
    // name pool, and (via cityOutfitFor's sex flag, further down) the
    // nightlife dress branch. Forced female for the wife/socialite archetypes
    // above; everyone else draws off the SAME deterministic stream (r) every
    // other appearance roll here uses — never Math.random.
    const gender = opts.gender || (FEMALE_ARCH[opts.archetype] ? "f" : (r() < 0.48 ? "f" : "m"));
    // X4 DEMOGRAPHICS: the spawn region's population config (skin-tone dist,
    // name pools, dress palette — city/demographics.js; wealth-independent,
    // see that file's header) for skin/name/dress. Guarded + falls back to
    // the global pools above when absent (mainland today) or its mix roll
    // defers to global.
    const demo = (CBZ.demographics && CBZ.demographics.rollFor) ? CBZ.demographics.rollFor(x, z, r, gender) : null;
    const outfit = opts.outfit || (demo && demo.shirt != null ? demo.shirt : pick(SHIRT, r()));
    // P9 MIGRATION: opts.skin is a direct override — a migrant arrival minted
    // at the republic's docks/airport (x,z here) still resolves the MAINLAND's
    // own demo (mix:1.0 -> null, see demographics.js), so migration.js instead
    // rolls the ORIGIN country's config off-site (its own capital coordinates)
    // and passes the result straight through here, the same "opts wins" shape
    // opts.outfit/opts.gender/opts.name already use one line above/below.
    const skin = opts.skin != null ? opts.skin : ((demo && demo.skin != null) ? demo.skin : pick(SKIN, r()));
    const wealth = opts.wealth != null ? opts.wealth : richWealth(r);
    const econ = CBZ.cityEcon;
    // ~45% of plain civvies wear the tee SHORT-SLEEVED. A bare-skin WHOLE arm
    // (the old way) read as sleeveless and the skin shoulder blended into the
    // shirt torso (user-filmed). A real short sleeve = shirt-colored
    // shoulder/upper-arm + bare forearm: arms stay the shirt color, and we
    // add a skin forearm box below mid-arm (see makeCharacter call's aftermath).
    const shortSleeve = !opts.outfit && r() < 0.45;
    // headgear where the JOB wears one, decided off the cast job (colour AND
    // kind, one row each, so the same job always wears the same hat):
    // construction = the yellow hard hat, deputy = the khaki campaign hat with
    // the star, soldier = the olive patrol cap, pilot = the navy captain's cap
    // (pairs with the Captain's Stripes uniform jobFit casts).
    const jobHat = HAT_BY_JOB.find((h) => h[0].test(opts.job || "")) || null;
    const capCol = jobHat ? jobHat[1] : null, capKind = jobHat ? jobHat[2] : undefined;
    // stashed on the ped below (_longHair) so schedule.js's ledger can persist
    // this roll — otherwise a woman who despawns and re-deals comes back bald.
    const longHair = gender === "f" && r() < 0.6;
    /* AGE — the one field that turns this rig into a child ---------------
       DETERMINISM: this deliberately takes NO new draw on `r`. CLAUDE.md
       forbids adding draws to a shared stream (order-fragile: every later
       appearance roll would shift), so age arrives from the CALLER — the
       family/birth sim, which is the only thing that should be deciding a
       person's age anyway. Omit it and you get an adult, exactly as before.

       A child is NOT `scale.setScalar(0.62)` any more. entities/character.js
       builds a real body from the age: big head on a short torso, legs that
       are ~37% of a toddler's height against ~48% of an adult's, a pot belly,
       no neck, a wide-based toddle. See CBZ.childBodyAudit(). */
    const ageYears = (opts.age != null && isFinite(opts.age)) ? Math.max(0, +opts.age) : null;
    const childAge = CBZ.charBands ? CBZ.charBands.CHILD_ADULT_AGE : 18;
    const isChild = ageYears != null && ageYears < childAge;
    /* Grey (HAIR[3]) and white (HAIR[5]) are a THIRD of the flat HAIR pool, so
       a uniform pick put a full head of grey on every third twenty-year-old
       and — now that children exist — on toddlers. Reshaped over the SAME
       single draw: the four natural tones dominate (globally ~75-80% of heads
       are black/dark brown), grey/white are adults-only.
       DRAW ORDER IS UNCHANGED — this is still exactly one r() consumed at the
       exact position `pick(HAIR, r())` used to sit in the literal below.
       Shifting it earlier would re-deal every later appearance roll. */
    const NATURAL_HAIR = [0, 1, 2, 4];      // dark brown, brown, black, auburn
    const hairFor = (roll) => {
      if (!isChild && roll >= 0.88) return HAIR[roll < 0.955 ? 3 : 5];   // grey, then white
      const t = isChild ? roll : roll / 0.88;
      return HAIR[NATURAL_HAIR[Math.min(3, (t * 4) | 0)]];
    };
    // SHORT SLEEVE: the two-segment rig has a real forearm mesh now —
    // makeCharacter paints it skin-colored when shortSleeve is set, which
    // reads as a tee ending mid-bicep and bends correctly at the elbow
    // (the old bolt-on forearm box detached the moment the elbow bent).
    const ch = makeCharacter({
      legs: pick(PANTS, r()), torso: outfit, collar: outfit, arms: outfit, skin, hair: hairFor(r()),
      shoes: r() < 0.3 ? 0xd8d8d8 : 0x2b2b2b, cap: capCol, capKind: capKind, shortSleeve: shortSleeve,
      build: gender === "f" ? "f" : "m", longHair,
      // ONE FIELD is the whole child adoption. character.js reads it and builds
      // the body; null/absent = the adult rig, byte-identical to before.
      age: ageYears,
      /* HAIR STYLE. At 30m the back-of-head hair MASS is the strongest and
         cheapest sex cue there is — it reads from front, side AND behind,
         unlike a hemline. city/outfits.js owns the casting table (it already
         knows sex, band and job, and ties hair back for cooks, medics and
         uniformed services); character.js owns the geometry and deliberately
         holds no RNG. This is the seam between them.
         It must be decided HERE, before the rig is built: a rig only grows the
         hair shell at construction, exactly like its cap. The outfit pass
         further down runs too late to change it.
         Deterministic (seeded, no draw on `r`) and degrade-safe — no outfits.js
         and makeCharacter falls back to the legacy longHair boolean. */
      hairStyle: opts.hairStyle || (CBZ.cityHairStyleFor ? CBZ.cityHairStyleFor({
        seed: (skin ^ outfit) | 0, sex: gender, band: (ageYears == null ? "adult" : null),
        age: ageYears, job: opts.job, archetype: opts.archetype, cop: !!opts.cop,
      }) : null),
    });
    ch.group.position.set(x, 0, z);
    ch.group.rotation.y = r() * 6.28;
    // Leg length relative to the adult rig, floored so a baby that somehow ends
    // up walking still creeps rather than freezing. Derived from the profile the
    // rig was actually built from, so it can never drift out of sync with it.
    const _pf = ch.profile;
    const legSpeedMul = _pf ? Math.max(0.28, (_pf.legUp + _pf.legLo) / 0.95) : 1;
    const nm = opts.name || (demo && demo.name) || name(r, gender);
    // Identity is read through the aim dossier / interaction UI. Never attach
    // a name, job, bounty or level board to a living person's skeleton.
    const tag = null;
    let aggr = opts.aggr != null ? opts.aggr : rollAggr(ag.meanCivilian != null ? ag.meanCivilian : 0.24, ag.spreadCivilian);
    // ---- THE NEIGHBORHOOD NIGHTMARE: ~1 ped per city is a violent, NON-gang
    //      crook packing an AK-47. WHY: the status rifle can't only live on gang
    //      muscle — a lone psycho with a banana mag is the block's boogeyman, a
    //      walking jackpot (drop him, take the rifle where he falls) priced in
    //      real risk (the AK's punchier NPC fire profile). His LEVEL read jumps
    //      via level.js's HEAVY map ("AK-47") + the crazy-eyes aggr bonus, so the
    //      street can SEE this one is different before he proves it. ----
    const nightmare = !opts.gang && !opts.vendor && !opts.isFamily &&
      opts.archetype == null && opts.armed == null && opts.weapon == null && r() < 0.007;
    if (nightmare) aggr = Math.max(aggr, 0.89 + r() * 0.08);   // ≥ violent band — full agency
    // WHO this ped is drives WHAT they carry. A boss/dealer carries mobster-tier
    // cash; a rare well-dressed ped is a secret tycoon/socialite WHALE. Resolve the
    // effective archetype + final wealth FIRST so cash/valuables/bounty all agree.
    let archetype = opts.archetype || "resident";
    let mWealth = wealth;
    // gang members carry crew-tier money + ice: the BOSS reads boss-tier (set via
    // opts.isBoss/rank, or the "gang boss" job gangs.js stamps before flipping the
    // flag post-construct), made men mobster-tier, the rest dealer-tier. Dealers
    // (anywhere) carry dealer-tier. This drives the cash + valuables (chain/watch).
    const _madeJob = /\b(lt|enforcer)\b/i.test(opts.job || "");   // gangs.js stamps "gang lt"/"gang enforcer"
    if (opts.isBoss || opts.rank === "boss" || opts.job === "gang boss") archetype = "boss";
    else if (opts.archetype === "dealer") archetype = "dealer";
    else if (opts.gang) archetype = (opts.rank === "lt" || opts.rank === "enforcer" || _madeJob) ? "mobster" : "dealer";
    if (opts.archetype == null && !opts.gang && !opts.vendor) {
      // a small slice of the visibly well-off become RARE jackpot archetypes.
      const rare = rollRareArchetype(archetype, wealth, r);
      if (rare) { archetype = rare.archetype; mWealth = rare.wealth; }
    }
    // CANONICAL WARDROBE (outfits.js): people whose POSITION dictates their
    // cloth dress the part — a street tycoon wears the actual tux (not a
    // random bright shirt under a bow tie), mobsters wear suits, dealers
    // tracksuits, dock workers hi-vis. A role record wins over a raw spawn tint;
    // the tint still wins when the role caster deliberately has no answer.
    // The RECORD rides along so clothes.js can paint the garment structure
    // (lapels/badge/apron) onto the rig, not just tint it; everybody else
    // gets the painted STREET BASICS pass (collar line/print/waistband) so
    // even a nobody isn't a single flat slab. NOTE: spawn-time dressing only —
    // post-spawn identity rewrites (crowd promotion, schedule deal-ins, the
    // hour recast) re-dress through outfits.js's wraps (the grey-tycoon fix).
    // PLAIN CIVILIANS (CBZ.CONFIG.CITY_PLAIN_CIVVIES, default on): an ordinary
    // person — no role uniform, no gang, no business/tycoon identity — stays
    // PLAIN. The rig is already built with a solid shirt (the SHIRT palette) +
    // trouser legs, so "plain" means we DON'T lay the painted street-basics
    // canvas over it. Role peds get their painted uniform (cityOutfitFor →
    // recolorRig paints it); gang peds get a solid shirt + a bandana MESH;
    // business/tycoon get a composed blazer/shirt/tie (or the apex tux). Flip
    // the flag false to bring the painted basics seams back for nobodies.
    const _plain = !CBZ.CONFIG || CBZ.CONFIG.CITY_PLAIN_CIVVIES == null || !!CBZ.CONFIG.CITY_PLAIN_CIVVIES;
    let _castFit = null;
    if (CBZ.cityOutfitFor && CBZ.cityRecolorRig) {
      // age/band ride along so the wardrobe can refuse to put a four-year-old
      // in a tailored suit or a hi-vis work vest. Absent = adult, as before.
      const fit = CBZ.cityOutfitFor({ archetype, job: opts.job, gang: opts.gang, vendor: opts.vendor, rng: r, seed: (skin ^ outfit) | 0, sex: gender, age: ageYears, band: ch.band || "adult" });
      if (fit && fit.colors) {
        CBZ.cityRecolorRig(ch, fit.colors, fit);
        _castFit = fit.id;                          // stamped on the ped below (redress revert read)
      }
      // NOT a role/gang/business identity → ordinary civilian. Painted basics
      // ONLY when the plain switch is off (the old "nobody is a flat slab" look);
      // the painted pass repaints ARMS, so skip it on short-sleeve bodies so the
      // bare forearm survives.
      else if (!opts.outfit && !_plain && CBZ.cityApplyClothes && !shortSleeve) CBZ.cityApplyClothes(ch, { id: "basics", colors: { torso: outfit } });
    }
    // cash: econ.rollCashFor(archetype, wealth, r) when present, else a who-aware
    // fallback (boss/tycoon fat, dealer big, ordinary modest). Guarded per contract.
    let cash = opts.cash != null ? opts.cash
      : (econ && econ.rollCashFor ? econ.rollCashFor(archetype, mWealth, r) : fallbackCashFor(archetype, mWealth, r));
    /* E4 CIRCULATION (sim/npcecon.js) — THE SPAWN-SIDE MONEY PRINTER.

       The comment here used to claim this "closes the robbery money-printer
       (strip-mine a district and its FUTURE spawns carry less)". It closed it
       for RESIDENTS AND NOBODY ELSE: the gate was `archetype === "resident"`,
       so every tycoon, mobster, dealer, socialite, tourist and panhandler kept
       spawning with cash minted straight out of economy.js's rollCashFor, and
       a district you had stripped to the floor went on producing them at full
       richness forever. Same fault class the ransom had, one layer down.

       THE FIX IS NOT TO WIDEN THE GATE. drawCash hands back the district+class
       cohort MEAN, so giving it to a tycoon would flatten him to cohort-average
       and delete the archetype spread rollCashFor exists to build — the whole
       point that "a rare tycoon is walking around with a Richard Mille".
       Instead: THE ARCHETYPE KEEPS ITS SHAPE, THE COHORT SUPPLIES ITS SCALE.
       Roll exactly as before, then multiply by the district's own depletion
       ratio, so a panhandler stays a panhandler and a tycoon stays a tycoon
       while both get poorer on a block that has been worked over.

       ONE-SIDED ON PURPOSE (min(1, health)): cohort wallets bank ~25% of
       income every hour, so health drifts UP over a long session and a
       two-sided multiplier would quietly become a printer of its own — the
       exact thing being closed. Strip-mining makes people poorer; hoarding
       does not make them richer. Carried cash is a habit, not a savings graph.

       DAY ONE IS BYTE-IDENTICAL: spawnCityPeds() resets npcEcon immediately
       before this runs, so a fresh world has health exactly 1.0 and the
       multiplier is exactly 1. Nothing changes until somebody is robbed.

       DETERMINISM: districtHealth() draws no rng, and the resident branch below
       still consumes exactly the one r() that drawCash always consumed, under
       exactly the same conditions — no draw added, none removed, order
       unchanged. Degrade-safe: no npcEcon -> the roll stands as it was. */
    let _cashScaled = false, _cashDk = null;
    if (opts.cash == null && CBZ.npcEcon && econ && econ.districtAt) {
      _cashDk = econ.districtAt(x, z);
      if (archetype === "resident" && CBZ.npcEcon.drawCash) {
        // A RESIDENT IS THE COHORT. Not a roll to be scaled — the cohort's own
        // live per-head mean IS the honest answer for the majority archetype,
        // and this path is unchanged from the day it shipped.
        const drawn = CBZ.npcEcon.drawCash(_cashDk, mWealth, r);
        if (drawn != null) { cash = drawn; _cashScaled = true; }
      } else if (CBZ.npcEcon.districtHealth) {
        const health = CBZ.npcEcon.districtHealth(_cashDk);
        if (health >= 0) { cash = Math.max(1, Math.round(cash * Math.min(1, health))); _cashScaled = true; }
      }
    }
    // measurable, not asserted: takeAudit().spawnMinted is the count of rolled
    // spawns that had a cohort to answer to and were NOT scaled by it.
    if (opts.cash == null && CBZ.cityTakeSpawn) { try { CBZ.cityTakeSpawn(_cashDk, _cashScaled); } catch (e) {} }
    // valuables: array of item NAMES this ped carries (watch/ring/chain/etc). Most
    // people none/Phone; the whales carry a luxury jackpot. Guarded per contract.
    const valuables = opts.valuables != null ? opts.valuables
      : (econ && econ.rollValuables ? (econ.rollValuables(archetype, mWealth, r) || []) : fallbackValuables(archetype, mWealth, r));
    let loot = opts.loot || null;
    if (!loot && econ && r() < (mWealth > 0.7 ? 0.6 : 0.22)) loot = econ.randomLoot(mWealth > 0.7);
    // BOUNTY: a rare ped is a wanted fugitive worth $ paid to YOU on their death.
    // Skip vendors/gang/explicit spawns (those identities are fixed elsewhere).
    let bounty = opts.bounty || 0, bountyTag = opts.bountyTag || null;
    if (!bounty && !opts.gang && !opts.vendor && opts.archetype == null) {
      const b = rollBounty(r);
      if (b) { bounty = b.bounty; bountyTag = b.tag; }
    }
    // Concealed carry is a possession roll, not a temperament roll. A meek
    // civilian can own a gun and a violent civilian can still be empty-handed. The
    // street is HEAVILY armed now (mass-shooting energy): a real share of people are
    // packing — a fugitive nearly always is, and the rich more often.
    const armed = nightmare || (opts.armed != null ? opts.armed
      : (bounty > 0 ? r() < 0.85 : r() < (0.14 + mWealth * 0.10)));
    // a RARE jackpot archetype (tycoon/socialite/billionaire) isn't part of the
    // castTraits vocabulary — pin it so the trait roll can't wash it back to a plain
    // resident. Otherwise let castTraits derive the social archetype as before.
    const rareArch = (archetype === "tycoon" || archetype === "billionaire" || archetype === "socialite") ? archetype : null;
    const traits = CBZ.castTraits ? CBZ.castTraits.rollCity(r, {
      aggr, archetype: rareArch || opts.archetype, job: opts.job, behavior: opts.behavior,
      reactivity: opts.reactivity, drugUser: opts.drugUser,
    }) : {};
    // ROLES EVERYWHERE: "between jobs" used to be a fat slice of the street — an
    // aimless mass with no commute, no post, no read. Nearly everyone works now:
    // a plain resident who rolled jobless is RE-DEALT into one of the trades the
    // city actually has counters/lots for (CBZ.cityJobs maps every one of these
    // to a workplace, schedule.js runs its shift, outfits.js dresses the ones
    // with a uniform read — all through the existing spawn chokepoints). A thin
    // genuinely-jobless remainder survives so "between jobs" still exists as a
    // life, not a bug. Street archetypes (tweaker/hustler/dealer) keep their
    // hustle — only the resident mass is recast. Deterministic from the stream.
    let job = traits.job || opts.job || "between jobs";
    let jobRecast = false;
    if (job === "between jobs" && !opts.gang && !opts.vendor &&
        (traits.archetype || opts.archetype || "resident") === "resident" && r() < 0.85) {
      job = JOB_RECAST[(r() * JOB_RECAST.length) | 0];
      jobRecast = true;
    }
    // MILITARY RANK: a soldier-costumed ped (island base troops, biome guards —
    // anyone cast with the soldier/military job that paints the camo + olive cap)
    // gets a real rank so level.js reads "Lv.36 Lieutenant", not "Civilian".
    // Keyed off opts.job (the same signal that chose the costume) so the stripes
    // always match the uniform. See §A UNIT IS A PYRAMID above for why this is a
    // roster slot and no longer a probability ladder.
    let milRank = null;
    if (/soldier|military|marine/i.test(opts.job || "")) {
      const mr = r();                 // ONE draw, in the exact place the old one was
      // A SOLDIER ON LEAVE IS NOT IN THIS UNIT'S CHAIN OF COMMAND. He is a
      // professional the city casts at random (see the rare-archetype pass
      // below), so he must never consume a garrison slot — otherwise the first
      // one built anywhere becomes the General of a base he has never seen.
      milRank = /leave|reserv/i.test(opts.job)
        ? (mr < 0.78 ? "private" : "corporal")
        : milSlotRank(_milSlot++);
    }
    // Any body minted after Play is already live must first exist somewhere
    // the player cannot see. The normal city LOD will reveal it on a later
    // frame only after this shared transition gate says the placement is safe.
    const spawnHidden = !opts.allowVisibleSpawn && g.state === "playing" &&
      CBZ.CONFIG && CBZ.CONFIG.NPC_SPAWN_HIDE !== false && CBZ.npcTransitionSafe &&
      !CBZ.npcTransitionSafe(x, z, { minDistance: 18, maxDistance: 150 });
    const ped = {
      char: ch, group: ch.group, pos: ch.group.position, name: nm, gender,
      // AGE is a first-class field on a person now. `child` is the fast read
      // every other system wants (systems/childsafe.js seals a child's hp
      // against all ~32 raw `.hp -=` sites off exactly this). Adults carry
      // ageYears null and child false — nothing downstream changes for them.
      ageYears: ageYears, child: isChild, band: ch.band || "adult",
      _longHair: longHair, // W5: persisted by schedule.js's ledger (deal-in restores it)
      tag, outfit, skin, kind: opts.kind || "civilian", milRank,
      aggr, wealth: mWealth, valuables, bounty, bountyTag,
      archetype: rareArch || traits.archetype || opts.archetype || "resident",
      job,
      behavior: traits.behavior || opts.behavior || null,
      reactivity: traits.reactivity != null ? traits.reactivity : aggr,
      drugUser: !!traits.drugUser, erratic: traits.erratic || 0, tweakT: 1 + r() * 4,
      hp: opts.hp || 100, maxHp: opts.hp || 100, dead: false, deadT: 0, ko: 0,
      cash, loot, looted: false, robbed: false,
      armed, weapon: opts.weapon || (armed ? (nightmare ? "AK-47" : "Pistol") : null),
      ammo: armed ? (nightmare ? 60 + ((r() * 31) | 0) : 30) : 0, shootCD: 0,
      npcHeat: 0, npcWanted: 0, offenseT: 0, witnessSev: 0, deadLoot: null,
      gang: opts.gang || null, guard: opts.guard || null, faction: opts.faction || null,
      partner: null, family: null,
      // FAMILY OF A POWER: when this ped is the spouse/kin of a gang BOSS (or other
      // important head), social.js links them and stamps protectGang = the head's
      // gang id + protectedBy = the head ped. Harming them enrages that whole crew
      // (cityFamilyHarmed below). isFamily marks them as a protected family member.
      protectGang: opts.protectGang || null, protectedBy: opts.protectedBy || null, isFamily: !!opts.isFamily,
      // persistent ROUTINE lots (assigned lazily by scheduledGoal; re-validated
      // against the live arena so a stale ref from a recycled body self-heals).
      _home: null, _work: null,
      // A CHILD MUST NOT WALK AT ADULT SPEED. This is not a nicety: the rig's
      // cadence is speed ÷ stride, and a child's stride is short (a toddler's is
      // ~20% of an adult's), so an adult-speed toddler would blur its legs into
      // a sewing machine. Scaling speed by the body's actual leg length keeps
      // cadence in the real range (~175 steps/min for a new walker vs ~115
      // adult) and, incidentally, makes children easy to outwalk and hard to
      // lose track of. Adults multiply by 1 — unchanged.
      baseSpeed: (1.5 + r() * 1.0) * legSpeedMul, speed: 0,
      // context-steering hysteresis (Builder B): last frame's chosen unit steer
      // dir, fed back into cityNav.contextSteer so the heading doesn't jitter
      // frame-to-frame (the doc's "global hysteresis" — no per-behaviour state).
      _prevSteerX: 0, _prevSteerZ: 0,
      target: new THREE.Vector3(x, 0, z), finalGoal: null, path: null,
      pause: 0, state: "walk", fear: 0, callT: 0, alarmed: 0,
      // SNITCH trait: how readily this person rats. Most people mind their own
      // business; a rare hardwired snitch rats anywhere, fast. Gang members keep
      // omerta (low). Reactions read this in the witness-decision logic below.
      snitch: opts.snitch != null ? opts.snitch : (opts.gang ? r() * 0.18 : (r() < 0.12 ? 0.7 + r() * 0.3 : r() * 0.45)),
      // witness-report state machine (decide → phone/run → land). Owned here.
      reportState: null, reportT: 0, reportTarget: null, phoneSprite: null,
      // social-reaction cadence so a ped reacts to YOU at most every few seconds
      reactCD: 0,
      rage: null, mem: null, attackCD: 0, enterT: 0, chatT: 0,
      vendor: opts.vendor || null, slice: (r() * 8) | 0, isPlayer: false,
      // the cast outfit id this body was dressed in at spawn (a uniform/gang/
      // business fit), so outfits.js redressPed knows to strip cast paint when
      // the body later reverts to an ordinary civilian. null = plain civilian.
      _castFit: _castFit,
      _spawnHidden: !!spawnHidden,
    };
    if (ped._spawnHidden) ped.group.visible = false;
    // CHILDREN ARE NOT TARGETS. systems/childsafe.js seals a protected record's
    // `hp` so the ~32 raw `.hp -=` sites scattered through combat, police,
    // gangs, predators and physics cannot drain it — no per-weapon special
    // case, no parallel health table. Adults are a no-op; if childsafe never
    // loaded, this line vanishes. Called here as well as from childsafe's own
    // cityMakePed wrapper so a ped is protected from the frame it exists,
    // whatever the script load order turns out to be.
    if (isChild && CBZ.childSafeSeal) CBZ.childSafeSeal(ped);
    if (ped.vendor) ped.kind = "vendor";
    // FUGITIVE flavor: re-label a wanted ped so the tag reads as a recognizable
    // mark ("☠ WANTED · Marcus V." / "☠ WANTED TERRORIST · …"). Cheap: rebuild the
    // one sprite once at spawn. Pure cosmetic — the bounty itself is the payoff.
    if (ped.bounty > 0 && ped.tag && CBZ.makeLabelSprite) {
      const label = "" + (ped.bountyTag || "WANTED") + " · " + nm;
      const old = ped.tag;
      const ns = CBZ.makeLabelSprite(label);
      if (ns) {
        ns.position.copy(old.position); ns.scale.copy(old.scale); ns.scale.x *= 1.35; ns.visible = false;
        if (old.parent) old.parent.remove(old);
        ch.group.add(ns); ped.tag = ns;
      }
    }
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    // a recast trade with a UNIFORM read (guard greys, vendor apron) dresses
    // the part through the one chokepoint — the spawn paint above ran off
    // opts.job, which predates the recast. Only the jobs outfits.js actually
    // recognizes repaint; the rest keep their street basics (no double pass).
    if (jobRecast && /security|guard|vendor/i.test(job) && CBZ.cityRedressPed) CBZ.cityRedressPed(ped);
    return ped;
  }
  CBZ.cityMakePed = makePed;        // used by gangs.js / social.js
  CBZ.cityMintName = name;          // W12: exposed so births.js can mint a gendered
                                     // first name, then swap in a parent's surname.

  // ---- NPC DRIP: an NPC's visible STATUS, read by club.js's bouncer ---------
  // The velvet rope only works if MOST people fail it. cityPedDrip(ped) scores a
  // ped from WHO THEY ARE — wealth + archetype + the jewellery/valuables they
  // visibly carry — so an ordinary/poor ped lands well UNDER CBZ.CITY.CLUB_DRIP
  // (turned away) and only the visibly-rich (tycoon/socialite/boss, iced out)
  // clear it. Tuned against the same wearable drip values economy.js uses for the
  // player, so the line reads consistently with the player's own fit.
  //
  // Distribution intent (CLUB_DRIP 30 / VIP_DRIP 70):
  //   • a plain resident (wealth ~0.2-0.5, no ice)  → ~5-13   (REJECTED)
  //   • a well-off generic (wealth ~0.85, a Rolex)  → ~25-35  (borderline)
  //   • a dealer/mobster w/ a gold chain            → ~22-34
  //   • a tycoon/socialite/boss w/ luxe valuables   → ~45-80+ (clears, often VIP)
  //
  // Cheap + deterministic: the result is cached on ped._drip (keyed to the
  // valuables list length so a re-roll / loot change re-computes). Pure read —
  // no allocation on the hot path, safe to call from the club's per-frame line.
  const ARCH_DRIP = {
    // visibly elite — a fit + ice that reads RICH on sight
    tycoon: 22, billionaire: 26, socialite: 20, mobwife: 24, "mob-wife": 24,
    bosswife: 22, kingpinwife: 24, tycoonwife: 22, heiress: 20, richwoman: 18, "rich woman": 18,
    boss: 16, underboss: 14, kingpin: 16, capo: 11, made: 11,
    // street money — some flash, not velvet-rope flash
    mobster: 8, dealer: 7, trapper: 7, merchant: 6, tourist: 4,
  };
  // valuables with no `drip` field still read as status: a luxe watch / necklace
  // on a ped is obviously money. Give the big-ticket non-drip valuables a flat
  // status bump (their pawn `value` is huge; we don't want a linear blowup).
  function valuableDrip(name) {
    const econ = CBZ.cityEcon; if (!econ || !name) return 0;
    const it = econ.ITEMS && econ.ITEMS[name];
    if (!it) return 0;
    if (it.drip) return it.drip;                 // Gold Chain 7, Rolex 14, Diamond Ring 10 …
    if (it.tag === "valuable") {
      if (it.luxe) return 16;                    // AP / Patek / Engagement Ring etc. — obvious wealth
      if (it.value >= 30000) return 10;          // Tennis Bracelet, Designer Bag tier
      if (it.value >= 3000) return 5;            // Omega, Gold Bar tier
      if (it.value >= 300) return 1;             // Phone/Laptop — barely registers
    }
    return 0;
  }
  CBZ.cityPedDrip = function (ped) {
    if (!ped) return 0;
    const vals = ped.valuables;
    const vKey = vals ? vals.length : 0;
    // cache: recompute only if uncached or the valuables count changed (a robbery
    // strips ice → the ped reads poorer next time).
    if (ped._drip != null && ped._dripKey === vKey) return ped._drip;
    const base = (CBZ.CITY && CBZ.CITY.BASE_DRIP) || 4;
    const w = ped.wealth != null ? ped.wealth : 0.4;
    // wealth curve: super-linear so the poor stay LOW and the rich pull ahead.
    // w=0.3 → ~2, w=0.5 → ~5, w=0.85 → ~14, w=1.0 → ~20.
    let d = base + Math.round(w * w * 20);
    d += ARCH_DRIP[ped.archetype] || 0;
    if (vals) for (let i = 0; i < vals.length; i++) d += valuableDrip(vals[i]);
    if (d < 0) d = 0;
    ped._drip = d; ped._dripKey = vKey;
    return d;
  };

  // ============================================================
  //  DISTRICT CASTING — WHO walks WHERE. The district field (config CITY.
  //  districts via world.js) decides both density AND casting so each
  //  neighbourhood has a personality the player can WORK: downtown carries
  //  tourists + secret whales (loud money — marks, witnesses, cops); the
  //  docks carry workers (quiet — gang business); the projects carry
  //  dealers/runners (sparse but volatile — dark money). Pure opts for
  //  makePed; the brain is untouched. Deterministic from the rng stream.
  // ============================================================
  function castForDistrict(d, r) {
    if (!d) return {};
    const opts = {};
    const ag = A0();
    // wealth: blend the global rich-skew with the district's street wealth so
    // downtown reads moneyed and the projects read broke (drives valuables,
    // rollRareArchetype whales, drip — every money system downstream).
    opts.wealth = Math.max(0.02, Math.min(1, richWealth(r) * 0.55 + d.wealth * 0.6 + (r() - 0.5) * 0.12));
    if (d.kind === "core") {
      // the strip: gawking tourists on top of the wealth boost (the boost alone
      // makes rollRareArchetype promote more tycoons/socialites here).
      if (r() < 0.2) { opts.archetype = "tourist"; opts.job = "tourist"; opts._role = "tourist"; opts.outfit = pick(BRIGHTS, r()); }
    } else if (d.kind === "industrial") {
      // docks/works: shift-workers, modest pockets — thin pickings, few eyes.
      // a slice of the shift is CONSTRUCTION (orange vest + hardhat — the works
      // half of industry), the rest dock/warehouse yellow hi-vis. The OTHER half
      // isn't all clean: the works edge backs onto the rough pocket, so a thin
      // share are corner PREDATORS (a dealer/hustler working the loading-dock
      // shadows) — enough that the industrial fringe reads dicey, not deserted.
      // (Draws ONE r() either way so seeded determinism holds; the night-recast
      // amps it further and is left untouched to avoid double-shifting.)
      const x = r();
      if (x < 0.55) {
        if (x < 0.3) { opts.archetype = "laborer"; opts.job = "construction worker"; }
        else { opts.archetype = "laborer"; opts.job = x < 0.42 ? "dock worker" : "warehouse worker"; }
      } else if (x < 0.62) { opts.archetype = "dealer"; }
      else if (x < 0.68) { opts.archetype = "hustler"; }
      opts.wealth = Math.min(opts.wealth, 0.55);
    } else if (d.kind === "projects") {
      // the rough pocket: broke, quicker to violence, the street economy lives
      // here (dealers/hustlers/users) — quiet money, but it bites back. A higher
      // PREDATOR share than the rest of the city so the projects read genuinely
      // risky even by day (the night-recast pushes it further still). Counts stay
      // flat — this only changes WHO this district's spawns are.
      opts.wealth = Math.min(opts.wealth, 0.3);
      opts.aggr = rollAggr((ag.meanCivilian != null ? ag.meanCivilian : 0.24) + 0.12, (ag.spreadCivilian || 0.2) + 0.06);
      const x = r();
      if (x < 0.20) opts.archetype = "dealer";
      else if (x < 0.36) opts.archetype = "hustler";
      else if (x < 0.46) opts.archetype = "tweaker";
    } else if (d.kind === "commercial") {
      // busy daytime mid: white-collar crowds (wallets + witnesses by day),
      // plus the trades that orbit them — the hospital crowd in scrubs/whites
      // (City Hospital sits in the shop mix; aigoals commutes nurses there),
      // a paramedic between calls, a guard heading to a post.
      const x = r();
      if (x < 0.14) { opts.archetype = "professional"; opts.job = r() < 0.4 ? "accountant" : "office worker"; }
      else if (x < 0.19) { opts.archetype = "professional"; opts.job = r() < 0.62 ? "nurse" : "doctor"; }
      else if (x < 0.215) { opts.archetype = "professional"; opts.job = "paramedic"; }
      else if (x < 0.24) { opts.archetype = "professional"; opts.job = "security guard"; }
    }
    // OCCUPATIONS YOU KNOW ON SIGHT — a thin citywide sprinkle over whoever
    // wasn't cast above, so any block can surface a hardhat off shift, a
    // deputy in from the county, a soldier on leave, a firefighter between
    // calls. Rare by design: uniforms read because most people DON'T wear one.
    //
    // EXTENDED (2026-07-27) with the roster the owner named — "jobs like
    // cashier, taxi driver, … boxer, … cia agent" — plus the two his "etc etc"
    // pointed at: a BODYGUARD is not a security guard (one is attached to a
    // PERSON via power.js, the other posted to a PLACE via security.js, and
    // level.js now titles them differently), and a SERVANT is the household
    // staff every estate in this game was missing.
    //
    // DETERMINISM: this whole block still draws EXACTLY ONE r(). The ladder is
    // re-partitioned, never lengthened with new draws — adding or removing a
    // draw on a shared seeded stream re-deals every subsequent ped in the city
    // (law #12, "NEVER add/remove draws on a shared rng() stream").
    if (!opts.archetype) {
      const x = r();
      if (x < 0.020) { opts.archetype = "laborer"; opts.job = "construction worker"; }
      else if (x < 0.030) { opts.archetype = "professional"; opts.job = "sheriff's deputy"; }
      else if (x < 0.038) { opts.archetype = "professional"; opts.job = "soldier on leave"; }
      else if (x < 0.044) { opts.archetype = "professional"; opts.job = "firefighter"; }
      else if (x < 0.058) { opts.archetype = "merchant";     opts.job = "cashier"; }
      else if (x < 0.068) { opts.archetype = "merchant";     opts.job = "cab driver"; }
      else if (x < 0.074) { opts.archetype = "merchant";     opts.job = "bartender"; }
      else if (x < 0.079) { opts.archetype = "laborer";      opts.job = "janitor"; }
      else if (x < 0.084) { opts.archetype = "merchant";     opts.job = "waiter"; }
      else if (x < 0.088) { opts.archetype = "professional"; opts.job = "flight attendant"; }
      // ATTACHED, not posted: a bodyguard off the clock still reads as one.
      else if (x < 0.091) { opts.archetype = "professional"; opts.job = "bodyguard"; }
      // household staff, out on an errand for a house they do not own.
      else if (x < 0.094) { opts.archetype = "merchant";     opts.job = "housekeeper"; }
      else if (x < 0.096) { opts.archetype = "professional"; opts.job = "chauffeur"; }
      // the fighter the arena packages already stage — off-card, on the street.
      else if (x < 0.098) { opts.archetype = "professional"; opts.job = "boxer"; }
      // "cia agent" — this world has no CIA; it has the Bureau (govcomplex.js's
      // "Director of the Bureau", factions.js's `agency`). So the job is
      // generic and the TITLE reads "Agent", which is what he asked to see.
      else if (x < 0.0995) { opts.archetype = "professional"; opts.job = "intelligence agent"; }
    }
    return opts;
  }

  // ============================================================
  //  VAGRANTS — a small homeless population in the projects pocket + the
  //  industrial fringe (alley edges of those lots). WHY: the rough end has to
  //  FEEL rough — shuffling panhandlers begging off passers-by sell "quiet,
  //  desperate streets", and a few volatile ones (aggr ≥ violent band → they
  //  read PSYCHO via the existing title system and can swing first) make the
  //  pocket genuinely dangerous, not just empty. They are NORMAL peds — the
  //  existing approach/bark loop carries the panhandling ("Spare a few
  //  bucks?"), and any cop move-along just sets the usual flee/fear fields.
  //  Carved OUT of the ped budget (count stays flat). ped.vagrant flags them.
  // ============================================================
  function spawnVagrants(A, count) {
    if (!count || !A.lots || !A.lots.length) return;
    const kindOf = (l) => {
      const d = A.districtAt ? A.districtAt(l.cx, l.cz) : null;
      return d ? d.kind : null;
    };
    let anchors = A.lots.filter((l) => kindOf(l) === "projects");
    const fringe = A.lots.filter((l) => kindOf(l) === "industrial");
    // mostly the pocket, a couple under the industrial fringe (alley sleepers)
    if (!anchors.length) anchors = fringe.length ? fringe : A.lots;
    for (let k = 0; k < count; k++) {
      const pool = (k % 4 === 3 && fringe.length) ? fringe : anchors;
      const l = pool[(k + ((rng() * pool.length) | 0)) % pool.length];
      // an ALLEY spot: hug a lot edge just off the sidewalk, not mid-pavement
      const sx = rng() < 0.5 ? -1 : 1, alongX = rng() < 0.5;
      const p = {
        x: alongX ? l.cx + (rng() - 0.5) * (l.w - 4) : l.cx + sx * (l.w / 2 - 1.2),
        z: alongX ? l.cz + sx * (l.d / 2 - 1.2) : l.cz + (rng() - 0.5) * (l.d - 4),
      };
      // a CAMP nearby (props.js tents/barrels — CBZ.cityCamps)? live there: the
      // bedroll, the fire, the shopping cart are THEIR address, not a random alley.
      const camps = CBZ.cityCamps;
      if (camps && camps.length) {
        let best = null, bd = 1e9;
        for (let c = 0; c < camps.length; c++) {
          const dx = camps[c].x - p.x, dz = camps[c].z - p.z, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = camps[c]; }
        }
        if (best && bd < 120 * 120) {
          const a = rng() * 6.28, rr = rng() * (best.r || 4);
          p.x = best.x + Math.cos(a) * rr; p.z = best.z + Math.sin(a) * rr;
        }
      }
      if (A.clampToCity) A.clampToCity(p, 0.6);
      const volatile = k < Math.max(1, (count * 0.3) | 0);   // a FEW are powder kegs
      const ped = makePed(p.x, p.z, rng, {
        wealth: 0.02 + rng() * 0.05,
        cash: (rng() * 9) | 0,                 // begging money, not robbing money
        aggr: volatile ? 0.89 + rng() * 0.09   // ≥ violent band → titles read PSYCHO
                       : 0.08 + rng() * 0.18,  // the rest: meek, just surviving
        archetype: "vagrant", job: "panhandling",
        armed: false, snitch: rng() * 0.08,    // the street doesn't call the law
        outfit: [0x4a4438, 0x5a5244, 0x3e3a33, 0x6b5d4a][(rng() * 4) | 0],
      });
      ped.vagrant = true;                      // cops/quests can read it (move-along)
      ped._role = "panhandler";                // begs via the existing role/bark loop
      ped._beg = { x: p.x, z: p.z };           // post up where they woke up
      ped.baseSpeed = 0.65 + rng() * 0.35;     // the shuffle
      A.root.add(ped.group);
      CBZ.cityPeds.push(ped);
    }
  }

  // ============================================================
  //  THE CITY KEEPS DIFFERENT HOURS — recast at the margins.
  //  WHY: night just got a LOOK (neon, lit windows, camp fires), but if the
  //  same tourists stroll the projects at 3am the fantasy dies. The street
  //  has to TURN OVER: marks and witnesses go in, the predators and the
  //  party crowd come out, and the quiet quarters get genuinely dangerous —
  //  which makes night the time to do crime and the core the place to flex.
  //  Casting dials ONLY (archetype/job/wealth/aggr/_role) — never weapons,
  //  state or count; the brain just reads the new person. Driven by the ONE
  //  canonical sun clock (CBZ.nightAmount) through the same dusk/dawn
  //  hysteresis the neon flips on (view.js: on >0.6, off <0.45).
  // ============================================================
  let _nightShift = false;
  // the published flip: crowd.js (density/redistribution) and anyone else
  // reads THIS instead of re-deriving thresholds — one clock, one flip.
  CBZ.cityNightShift = function () { return _nightShift; };
  // nearest homeless camp anchor (props.js fires/tents publish CBZ.cityCamps)
  function campNear(x, z, maxd) {
    const camps = CBZ.cityCamps; if (!camps || !camps.length) return null;
    let best = null, bd = (maxd || 130) * (maxd || 130);
    for (let c = 0; c < camps.length; c++) {
      const dx = camps[c].x - x, dz = camps[c].z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = camps[c]; }
    }
    return best;
  }
  // the ONE velvet-rope club (buildings.js flags lot.building.club). Cached
  // once found; club.js is never touched — we only read where its line forms.
  let _clubA = null, _clubRope = null;
  function clubRope(A) {
    if (_clubA === A && _clubRope) return _clubRope;
    if (A.shopLots) for (let i = 0; i < A.shopLots.length; i++) {
      const c = A.shopLots[i].building && A.shopLots[i].building.club;
      if (c && c.queue && c.queue.length) {
        const s = c.queue[c.queue.length - 1];           // the back of the line
        _clubA = A; _clubRope = { x: s.x, z: s.z };
        return _clubRope;
      }
    }
    return null;
  }
  // re-deal ONE civilian's casting dials for the current hour at its position.
  // The day person is STASHED on first night-cast and restored exactly at
  // dawn, so repeated flips never drift anyone's identity. Returns true if
  // the cast changed. crowd.js also calls this when it promotes an ambient
  // body to a real rig — every promotion is a new person stepping out of the
  // mass, so the churn itself is what biases the street's mix by hour.
  CBZ.cityRecastForHour = function (ped, r) {
    r = r || rng;
    if (!ped || ped.dead || ped.vendor || ped.gang || ped.companion || ped.controlled ||
        ped.recruited || ped.vagrant || ped.isPlayer || ped.kind !== "civilian") return false;
    if (ped.rage || ped.surrender || ped.state === "fight" || ped.state === "flee" ||
        (ped.npcWanted | 0) || ped.bounty || ped._clubLine || ped._clubGoingIn) return false;
    if (ped._castNight === _nightShift) return false;    // already cast for this phase
    const A = CBZ.city && CBZ.city.arena;
    const d = A && A.districtAt ? A.districtAt(ped.pos.x, ped.pos.z) : null;
    if (_nightShift && !d) return false;                 // night cast needs a district read
    ped._castNight = _nightShift;
    // wipe the cached life so the new cast re-derives fresh (workplace, role,
    // club-drip all key off who this person is NOW)
    ped._role = null; ped._work = null; ped._snapAt = null; ped._stage = null; ped._dripKey = null;
    if (!_nightShift) {
      // DAWN: the night cast washes off — the saved daytime person comes back.
      const dc = ped._dayCast;
      if (dc) { ped.archetype = dc.archetype; ped.job = dc.job; ped.wealth = dc.wealth; ped.aggr = dc.aggr; ped._dayCast = null; }
      return true;
    }
    // DUSK: stash the daytime person once, then deal the night cast by district.
    if (!ped._dayCast) ped._dayCast = { archetype: ped.archetype, job: ped.job, wealth: ped.wealth, aggr: ped.aggr };
    const ag = A0();
    if (d.kind === "projects" || d.kind === "industrial") {
      // the predators' shift: the street economy works nights, tempers run
      // hotter, and pockets stay thin — walking here after dark is a RISK.
      const x = r();
      if (x < 0.20) { ped.archetype = "dealer"; ped.job = "slinging"; }
      else if (x < 0.34) { ped.archetype = "hustler"; ped.job = "working an angle"; }
      else if (x < 0.46) { ped.archetype = "tweaker"; ped.job = "chasing a fix"; }
      ped.aggr = rollAggr((ag.meanCivilian != null ? ag.meanCivilian : 0.24) + 0.2, (ag.spreadCivilian || 0.2) + 0.08);
      ped.wealth = Math.min(ped.wealth, 0.3);
    } else if (d.kind === "core") {
      // the party crowd: dressed-up money out under the neon, drifting toward
      // the rope — fat marks, big drip, plenty of witnesses.
      ped.wealth = Math.max(ped.wealth, 0.5 + r() * 0.35);
      if (r() < 0.08) ped.archetype = "socialite";       // the rare night whale
      ped.job = "out on the town";
      if (r() < 0.4) ped._role = "clubgoer";             // heads for the velvet rope
    } else {
      // residential/commercial after dark: the daytime faces go IN. Tourists
      // and socialites don't wander dark side streets — they become locals
      // hurrying home, which is exactly what thins the herd of easy marks.
      if (ped.archetype === "tourist" || ped.archetype === "socialite") { ped.archetype = "resident"; ped.job = "in for the night"; }
    }
    return true;
  };
  // ---- the MARGINS CHURN: a slow rolling pass that re-deals only OFF-SCREEN,
  //      unengaged civilians (~4/s), so the whole street turns over within a
  //      minute of a flip and nobody ever morphs in front of you. This is the
  //      hourly dial — one hysteresis check per 0.8s tick, never per-frame. ----
  let _hourT = 0, _hourScan = 0;
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city") return;
    _hourT -= dt; if (_hourT > 0) return;
    _hourT = 0.8;
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    _nightShift = _nightShift ? n > 0.45 : n > 0.6;   // the neon's own dusk/dawn hysteresis
    const peds = CBZ.cityPeds; if (!peds || !peds.length || !CBZ.camera) return;
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    let done = 0, scanned = 0;
    while (done < 3 && scanned < 24) {
      const p = peds[_hourScan]; _hourScan = (_hourScan + 1) % peds.length; scanned++;
      if (!p || p._parked || p.dead || p.inCar) continue;
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz < VIS_D2) continue;       // in view → never recast where you can see
      if (CBZ.cityRecastForHour(p, rng)) done++;
    }
  });

  // ============================================================
  //  HOBO NIGHT JUMPSCARE — the dark-alley fright.
  //  WHY: "add JUMPSCARES especially at night and from HOBOS" — the shuffling
  //  figure in the shadows that suddenly SNAPS at you. At night, a vagrant /
  //  panhandler (or a creepy lone ped) standing right next to you whips around,
  //  barks a startle line and the camera flinches. A VOLATILE vagrant (the
  //  powder-keg ones spawnVagrants already makes, aggr ≥ violent) follows the
  //  scare by actually LUNGING into an attack — so the fright has teeth.
  //
  //  Rate-limited HARD so it stays a fright, never a nuisance: a long PER-PED
  //  cooldown (a given hobo scares you at most every ~25s) AND a citywide gap
  //  (~6s minimum between any two scares). Night-gated (CBZ.nightAmount high) and
  //  near-player only; one cheap throttled scan, all hooks feature-detected so it
  //  no-ops headless. ped._scareT is the transient pose marker the rig can read
  //  (we also drive the existing poseCower so reactions.js animates the recoil).
  // ============================================================
  // ============================================================
  //  ...AND THE ONES THAT HUNT. (systems/predator.js — MIGRATED, not rebuilt.)
  //
  //  OWNER (2026-07-27): "homeless people (they attack you at night like jump
  //  scares, like how sharks can gruesomely attack the player — not all but
  //  some of the homeless)."
  //
  //  He named the system himself. The shark's brain is CBZ.predatorHunt, and
  //  the scare loop above was a LEGACY predator-hits-player path: a distance
  //  band, a bark, and `p.rage = player`. No menace gauge (it could re-scare
  //  you the moment its own cooldown lapsed), no fake-outs, no line of sight,
  //  no grab, and — the thing that actually kills a fright — a cue that
  //  RELIABLY predicted the attack, because the bark always came first and the
  //  lunge always followed it.
  //
  //  Now the dangerous ones tick the shared FSM and inherit, for free:
  //    * THE MENACE GAUGE — after every commit the hunter is FORCED to
  //      disengage and may not re-commit for 4-10 s. That is Alien: Isolation's
  //      anti-habituation rule and it is why this stays frightening on the
  //      tenth meeting instead of becoming a tax on walking home.
  //    * MOST STALKS END IN NOTHING — 45% vanish / 30% bump / 25% rush, plus a
  //      20% scent fake-out. You will be circled far more often than you are
  //      taken, and that asymmetry IS the horror.
  //    * predatorDread — the Jaws law: approach-motif tempo is the distance
  //      readout, with predatorDrop's near-silence before the strike.
  //    * predatorSeize — ONE telegraphed timed press to break free, never a
  //      mash meter, and panic feeds the thing holding you.
  //    * markers.js lights every threat surface off `state` with no new marker.
  //
  //  THE THREE DESIGN CALLS THAT ARE OURS (predatorKit writes every number):
  //
  //  (1) HOW MANY. "Not all but some." spawnVagrants already rolls ~30% of the
  //      camp volatile (aggr >= the violent band); we take a deterministic
  //      slice of THOSE, landing on about ONE IN SIX vagrants — 2-3 people in
  //      an entire city. That number is chosen against the menace gauge, not
  //      pulled from the air: a predator you meet three times a block stops
  //      being a predator. Two or three in the world is exactly enough to
  //      learn to fear and not enough to learn to route around.
  //
  //  (2) WHICH GRAB. predatorKit picks a style from MASS, and a scale-1.0
  //      human lands under the 1.15 threshold on "worry" — the terrier's
  //      drive-backward re-bite. Wrong animal. A desperate man who gets hold of
  //      you HAULS YOU OFF THE STREET, so we override to `drag`, which is the
  //      one style in the whole vocabulary nothing else in this game uses
  //      (shark shake · cat pin · bear maul · dog worry · snake constrict).
  //      The bum is therefore identifiable by FEEL alone, in the dark, before
  //      you have seen what has you.
  //
  //  (3) HOW HE READS YOU — and this is the counterplay, expressed as a verb
  //      rather than a stat. A DRAWN GUN stops the commit dead (canReach
  //      false): he still stalks, still circles, still breathes down the dread
  //      bus — you simply cannot be taken while you are holding the thing he is
  //      afraid of. And he prefers weak prey, so your own street read
  //      (CBZ.cityLevel — money, gun, crew, bodies, stars) SHRINKS his senses.
  //      Walk home broke and unarmed at 3 a.m. and the city is hunting you;
  //      walk home as a Lv.70 shot-caller and it is not.
  //
  //  Ambush is ON (a man in a doorway is motionless until you are close — that
  //  is the jump scare, and predatorStill() is why our wander must not move
  //  him). Night-gated on the same 0.55 nightAmount the neon flips on, so there
  //  is still ONE clock. The harmless majority keep the old startle bark below.
  //  Flags: CITY_HOBO_SCARE (all of it) · CITY_BUM_PREDATOR (just the hunt).
  // ============================================================
  // THE RATCHET (BLOCK LAW #5). peds.js loads before predator.js, so the buffer
  // branch is the live one; predator.js drains it at its own load.
  if (typeof CBZ.predatorAdopt === "function") {
    try { CBZ.predatorAdopt("peds:hobo-jumpscare"); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("peds:hobo-jumpscare"); } catch (e) {}
  }
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_BUM_PREDATOR == null) CBZ.CONFIG.CITY_BUM_PREDATOR = true;
  function BUM_HUNT_ON() {
    return CBZ.CONFIG.CITY_BUM_PREDATOR !== false && typeof CBZ.predatorHunt === "function";
  }

  // (1) IS THIS ONE OF THE DANGEROUS ONES? Deterministic and permanent — the
  // same person is a hunter on every client and stays one all night, because a
  // threat that re-rolls is a slot machine, not a predator. hash01 is
  // position-hashed off where they woke up (law #12: never Math.random in a
  // path two clients must agree on).
  function isHunterBum(p) {
    if (!p || !p.vagrant) return false;
    if (p._bumHunter != null) return p._bumHunter;
    const violent = (A0().violent) || 0.88;
    const beg = p._beg || p.pos;
    const roll = CBZ.hash01 ? CBZ.hash01(beg.x, beg.z, 0xB0DE) : 1;
    // volatile band (≈30% of the camp) ∩ the 0.55 slice ≈ one in six.
    p._bumHunter = (p.aggr || 0) >= violent && roll < 0.55;
    return p._bumHunter;
  }

  // (3) THE READ. How far he notices you at all, scaled by how hard a mark you
  // look. cityLevel is the game's own street read, so this needs no new stat.
  function preyScale() {
    const lvl = CBZ.cityPlayerLevel ? CBZ.cityPlayerLevel() : 8;
    // Lv.1-10 nobody → full senses; Lv.60+ → a third of them. Continuous, so
    // there is no threshold to game and no cliff to notice.
    return Math.max(0.32, Math.min(1, 1.12 - lvl * 0.013));
  }
  // combat.js:220 — cityHasGun() is ALREADY "a gun, not melee, not holstered",
  // so it is the whole test. (An earlier draft also probed a `cityWeaponDrawn`
  // that does not exist in this codebase; that would have made the guarded
  // expression permanently false and silently deleted the counterplay.)
  function playerHasGunOut() {
    try {
      if (CBZ.isAimingWeapon && CBZ.isAimingWeapon()) return true;
      return !!(CBZ.cityHasGun && CBZ.cityHasGun());
    } catch (e) { return false; }
  }

  // THE LOCOMOTION SEAM. predatorHunt says WHERE; this says HOW — the shuffle,
  // the same depenetration every other ped walk uses, feet on the ground.
  // predatorKit deliberately never sets `move`, because locomotion is the seam.
  const _bumMo = { speed: 0, leg: true, stop: 0.3, face: null, lod: 1 };
  function bumHuntMove(p, want, speed, dt) {
    if (!(dt > 0) || !p.group) return false;
    const Mv = CBZ.moves, m = Mv.motor(p);
    const s = Math.max(0, speed || 0);
    // `want` is a math-convention heading (cos, sin); the body's yaw is atan2(x, z)
    const hx = want != null ? Math.cos(want) : 0, hz = want != null ? Math.sin(want) : 0;
    _bumMo.speed = want != null ? s : 0;
    _bumMo.accel = s > 3 ? 6 : 3.6;
    _bumMo.face = want != null && s <= 0 ? Math.atan2(hx, hz) : null;
    Mv.step(m, p.pos, p.group.rotation.y, p.pos.x + hx * 4, p.pos.z + hz * 4, _bumMo, dt);
    p.group.rotation.y = m.yaw;
    if (m.speed > 0.01) {
      if (CBZ.collide) CBZ.collide(p.pos, PED_R, p.pos.y + PED_FOOT, p.pos.y + 1.7);
      const A = CBZ.city && CBZ.city.arena;
      if (A && A.clampToCity) A.clampToCity(p.pos, PED_R);
      settleFeet(p, dt);
    }
    p.speed = m.speed;
    return true;
  }

  // the per-bum opts bundle: built ONCE, never per frame. predatorKit derives
  // every radius, speed, hold and escape window from the actor; we author only
  // the seams and the four numbers we genuinely disagree with.
  function bumKit(p) {
    if (p._bumKit) return p._bumKit;
    const over = {
      medium: "air", style: "maul",
      move: bumHuntMove,
      // A MAN IN A DOORWAY DOES NOT CROSS A CAR PARK FOR YOU. Ambush + a much
      // shorter sense radius than the bear's 70 u: he wakes late and close, and
      // every second he waits makes the commit likelier. That is the scare.
      ambush: true,
      senseR: 26,
      circleR: 11, orbitR: 6.5, circleT: 3.2,
      cruiseSpeed: 1.5, rushSpeed: 5.6,        // a shuffle, then a sprint
      reach: 1.5,
      // (3) THE COUNTERPLAY IS A VERB. A drawn gun refuses the commit — the FSM
      // already honours canReach (rush -> disengage, circle -> scent), so this
      // costs the state machine nothing. He keeps stalking; he cannot take you.
      canReach: function () { return !playerHasGunOut(); },
      // damage sink UNCHANGED: still cityHurtPlayer, still never a raw `.hp -=`.
      onHit: function (dm) {
        if (CBZ.cityHurtPlayer) {
          try { CBZ.cityHurtPlayer(dm, p.pos.x, p.pos.z, "jumped in the dark", false, p, false); } catch (e) {}
        }
      },
      // (2) HE DRAGS YOU. See the note above — the one unused style in the
      // vocabulary, and the only correct one for a human grappler.
      seize: { style: "drag", cause: "dragged into the dark" },
    };
    let k = null;
    if (CBZ.predatorKit) { try { k = CBZ.predatorKit(p, over); } catch (e) { k = null; } }
    if (!k) {
      // DEGRADE (predator.js present but PREDATOR_KIT off): the seams plus the
      // few numbers above. Everything unset falls through to predatorHunt's own
      // documented defaults — we do NOT re-invent a radius table here, since
      // deleting exactly that is the point of adopting.
      k = Object.assign({ rate: 1.0, dmg: 14 }, over);
      k.seize = { dps: 15, thrash: 1, style: "drag", hold: 2.2, escape: 0.4, cause: "dragged into the dark" };
    }
    p._bumKit = k;
    return k;
  }

  // the serial killer's bundle — the SAME derivation, four numbers apart. Every
  // radius/hold/escape it does not name is still predatorKit's.
  function killerKit(p) {
    if (p._bumKit) return p._bumKit;
    const over = {
      medium: "air", style: "pounce",          // the big cat's row: sees far, then STOPS
      move: bumHuntMove,
      ambush: true,
      senseR: 44, circleR: 15, orbitR: 9,
      circleT: 7.5,                            // (d) patient. Twice the bum's stalk.
      cruiseSpeed: 1.7, rushSpeed: 5.2,        // barely faster than you. That is the point.
      reach: 1.5,
      // (b) he will not move on you in company, and a drawn gun still refuses
      // the commit — the same verb-shaped counterplay the bum has.
      canReach: function () { return playerAlone() && !playerHasGunOut(); },
      onHit: function (dm) {
        if (CBZ.cityHurtPlayer) {
          try { CBZ.cityHurtPlayer(dm, p.pos.x, p.pos.z, "attacked from behind", false, p, false); } catch (e) {}
        }
      },
      // (c) PIN — the body goes still, and the stillness is the scare.
      seize: { style: "pin", cause: "murdered" },
    };
    let k = null;
    if (CBZ.predatorKit) { try { k = CBZ.predatorKit(p, over); } catch (e) { k = null; } }
    if (!k) {
      k = Object.assign({ rate: 1.0, dmg: 26 }, over);
      k.seize = { dps: 22, thrash: 1, style: "pin", hold: 2.0, escape: 0.3, cause: "murdered" };
    }
    p._bumKit = k;
    return k;
  }

  // THE MASK COMES OFF. Until he commits, his pill reads the job he really
  // holds; the moment he does, the city has a name for him. Routed through the
  // vocabulary in level.js (JOB_TITLE["serial killer"]) rather than writing a
  // title anywhere near the HUD.
  function unmaskKiller(p) {
    if (!p || p._unmasked) return;
    p._unmasked = true;
    p.job = "serial killer";                   // the TRUE role — the sim acts on this
    p.archetype = "hitman";
    // BURN THE COVER, permanently. This is the reveal rule for a cover that no
    // membership can open: you saw him do it. Until this line runs he reads as
    // whatever he really was, and roleAudit() counts him as covered.
    if (CBZ.cityBurnCover) CBZ.cityBurnCover(p, 0);
    p._lvlTitle = null;                        // force level.js's retag next sweep
  }

  // A SHOT MAN DOES NOT SHRUG. Without this the 20% scent fake-out means you
  // can put a bullet into him and be ignored for several seconds, which is the
  // one failure that reads as broken rather than tense. Deliberately does NOT
  // reset menace or commits — those two numbers ARE the anti-habituation rule.
  CBZ.cityBumProvoke = function (p) {
    if (!p || !BUM_HUNT_ON() || !CBZ.predatorProvoke) return false;
    if (!isHunterBum(p) && !p._killer) return false;
    const PA = CBZ.city && CBZ.city.playerActor; if (!PA) return false;
    try { return !!CBZ.predatorProvoke(p, PA); } catch (e) { return false; }
  };

  // ============================================================
  //  THE SERIAL KILLER — one per city, and you will not see him coming.
  //
  //  OWNER'S ROSTER (2026-07-27) lists "serial killer" as a role. It did not
  //  exist anywhere in this codebase. It is built here and not in a file of its
  //  own precisely because it must cost almost nothing: he is the SECOND
  //  consumer of the bum's exact machinery — same predatorKit, same locomotion
  //  seam, same hunt loop — with different numbers and a different mask. If a
  //  new predator needs a new file, the block was not shared.
  //
  //  WHAT MAKES HIM DIFFERENT FROM THE BUM, and it is only these four things:
  //
  //  (a) HE HAS A COVER. He is not cast; he is PROMOTED out of the ordinary
  //      cast, and he keeps the job he was already doing. His pill reads
  //      "Accountant" or "Cashier" — a true statement — right up until he
  //      commits, and only then does it read "Serial Killer". You cannot scan
  //      the street for him. That is the entire fantasy, and it is one line
  //      (`p.job = "serial killer"` at unmask) because level.js's vocabulary
  //      already owns the string.
  //
  //  (b) HE WANTS YOU ALONE. `senseR` collapses to nothing when there are other
  //      people or any police within sight of you. The bum is opportunistic;
  //      this one is patient, and being in a crowd is a real defence.
  //
  //  (c) HE PINS. predatorKit picks `worry` from a human's mass; the bum
  //      overrides to `drag` (hauled away) and he overrides to `pin` — the big
  //      cat's grab, where "the body goes STILL, and the stillness is the
  //      scare". A knife held motionless against you is not a thrash.
  //
  //  (d) HE IS PATIENT. Long circle, slow cruise, a rush that is barely faster
  //      than a jog — because the terror is that he was ALWAYS THERE, not that
  //      he is quick. The menace gauge's forced disengage does the rest.
  //
  //  Selection is a POSITION HASH over the cast, not a stream draw: the winner
  //  is whoever hashes lowest, which is order-independent, byte-identical
  //  across clients, and adds ZERO draws to the seeded spawn stream (law #12).
  //  Re-derived once per arena.
  // ============================================================
  let _killerPed = null, _killerArena = null, _killerRetry = 0;
  function serialKiller(dt) {
    const A = CBZ.city && CBZ.city.arena;
    if (_killerArena === A && _killerPed) return _killerPed.dead ? null : _killerPed;  // caught → there is only one
    // The scan is O(cast) and the early-boot answer is legitimately "nobody
    // yet" (the roster is still filling), so back off instead of re-scanning
    // every frame forever on a city that never qualifies.
    if (_killerRetry > 0) { _killerRetry -= (dt || 0); return null; }
    _killerRetry = 4;
    const peds = CBZ.cityPeds;
    if (!A || !peds || peds.length < 12 || !CBZ.hash01) return null;
    let best = null, bestH = 2;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.isPlayer || p.child || p.vagrant || p.vendor || p.gang) continue;
      if (p.kind !== "civilian" || p.companion || p.recruited || p.controlled) continue;
      // he looks like nobody: no bounty, no uniform, an unremarkable temper.
      if (p.bounty > 0 || p.milRank || (p.aggr || 0) > 0.62) continue;
      const h = CBZ.hash01(p.pos.x, p.pos.z, 0x51CC);
      if (h < bestH) { bestH = h; best = p; }
    }
    if (best) {
      _killerArena = A; _killerPed = best; best._killer = true;
      // HIS COVER IS THE LIFE HE WAS ALREADY LIVING. He is not given a false
      // job — he keeps the true one he had before we picked him, and it becomes
      // the thing outsiders see once his TRUE role turns into "Serial Killer".
      // org null: no membership opens this file. Only the burn does, and the
      // burn is him committing in front of you, which is an observable event
      // and therefore not a stat fiction.
      best._killerCover = best.job || null;
      if (CBZ.citySetCover) {
        const t = (CBZ.cityJobTitle && best.job) ? CBZ.cityJobTitle(best.job) : null;
        CBZ.citySetCover(best, { role: t || "Resident", org: null, seeTier: 9, lvl: null });
        best._coverDone = 1;
      }
    }
    return best;
  }
  CBZ.citySerialKiller = function () { return serialKiller(0); };

  // is the player ISOLATED enough for him to move? (b) above.
  function playerAlone() {
    const P = CBZ.player; if (!P) return false;
    const px = P.pos.x, pz = P.pos.z;
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i]; if (!c || c.dead) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz < 45 * 45) return false;          // the law is nearby
    }
    const peds = CBZ.cityPeds || [];
    let near = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p._parked || p.isPlayer || p._killer || !p.group || !p.group.visible) continue;
      const dx = p.pos.x - px, dz = p.pos.z - pz;
      if (dx * dx + dz * dz < 28 * 28 && ++near >= 2) return false;   // witnesses
    }
    return true;
  }

  let _scareT = 0;             // citywide cooldown (s); next STARTLE can't fire until this hits 0
  let _scareScan = 0;          // round-robin cursor so we don't always probe the same peds
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_HOBO_SCARE === false) return;
    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const P = CBZ.player;
    const peds = CBZ.cityPeds; if (!peds || !peds.length) return;
    const PA = CBZ.city && CBZ.city.playerActor;
    const dark = night >= 0.55 && P && !P.dead && !P.driving;

    // ---- THE HUNT (the dangerous minority) ---------------------------------
    // Every hunter ticks every frame — the FSM is the thing that decides when
    // to do nothing, and starving it of frames would break the menace gauge.
    if (!BUM_HUNT_ON() || !PA) {
      // FLAG OFF MID-SESSION (?cfg_CITY_BUM_PREDATOR=0, or predator.js absent):
      // hand every held body straight back to think()/move(). A one-line revert
      // that leaves people frozen is not a revert.
      for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._bumHunt) peds[i]._bumHunt = false;
    }
    if (BUM_HUNT_ON() && PA) {
      const prey = preyScale();
      serialKiller(dt);                        // resolve/refresh the one, once per arena
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p) continue;
        // RELEASE THE BODY on every path that takes it away from us. The main
        // ped loop SKIPS think()/move() for anything flagged _bumHunt, so a
        // stale flag left on a hunter who died, got cuffed, boarded a car or
        // stepped inside a building would freeze that person in place forever.
        // Clearing it here — not just on the paths that reach the FSM — is what
        // makes the hand-back total.
        if (p.dead || p._parked || p.inCar || p.ko > 0 || p.enterT > 0 || p._npcAttached) { p._bumHunt = false; continue; }
        const killer = !!p._killer;
        if (!killer && (!p.vagrant || !isHunterBum(p))) continue;
        if (p.cuffed || p.surrender || p.rage) { p._bumHunt = false; continue; }
        // DAYLIGHT ENDS IT. He does not stalk you at noon — he goes back to the
        // doorway and becomes a man asking for change, which is what makes the
        // dark mean something.
        if (!dark) { p._bumHunt = false; continue; }
        // A SHOT MAN DOES NOT SHRUG. There is no single ped damage sink in this
        // codebase — ~32 sites write `.hp` directly — so rather than add a
        // 33rd contract we WATCH the number, which catches every one of them
        // including melee, fire and a stray ricochet. predatorProvoke skips
        // straight to `scent` with the fake-out disabled; it deliberately does
        // not touch menace or commits, because those two ARE the
        // anti-habituation rule and a rifle must not reset them.
        if (p._bumHp == null) p._bumHp = p.hp;
        else if (p.hp < p._bumHp) { p._bumHp = p.hp; CBZ.cityBumProvoke(p); }
        else if (p.hp > p._bumHp) p._bumHp = p.hp;
        const k = killer ? killerKit(p) : bumKit(p);
        // (3) a heavy mark is not worth it — to either of them.
        k.senseR = (killer ? 44 : 26) * prey;
        let st = null;
        try { st = CBZ.predatorHunt(p, PA, dt, k); } catch (e) { st = null; }
        if (!st) { p._bumHunt = false; continue; }
        // the mask comes off at the COMMIT, never before it.
        if (killer && (st === "rush" || st === "seize")) unmaskKiller(p);
        // AN AMBUSHER HOLDING STILL MUST NOT WANDER. predatorStill is the ONE
        // answer to that; without it the "motionless figure" strolls off.
        const still = CBZ.predatorStill ? CBZ.predatorStill(p) : false;
        const engaged = st !== "cruise";
        p._bumHunt = engaged || still;
        if (still) { p.speed = 0; p.pause = Math.max(p.pause, 0.4); }
        // markers.js's cityTargetsPlayer() lights every threat surface off the
        // state string alone — never a parallel threat marker.
        if (st === "circle" || st === "scent" || st === "bump") p.state = "stalk";
        else if (st === "rush" || st === "seize") p.state = "charge";
        else if (p.state === "stalk" || p.state === "charge") p.state = "walk";
      }
    }

    // ---- THE STARTLE (the harmless majority) -------------------------------
    // Unchanged in feel and deliberately kept: five in six vagrants are just a
    // fright — a figure that snaps round and shouts. It is ALSO what keeps the
    // hunters camouflaged, because if only dangerous bums ever reacted to you,
    // the bark would be the reliable cue the whole design forbids.
    if (_scareT > 0) { _scareT -= dt; return; }
    if (!dark) return;
    const px = P.pos.x, pz = P.pos.z;
    let scanned = 0;
    while (scanned < 18) {
      const p = peds[_scareScan]; _scareScan = (_scareScan + 1) % peds.length; scanned++;
      if (!p || p.dead || p._parked || p.inCar || p.ko > 0 || p.enterT > 0) continue;
      if (p.isPlayer || p.controlled || p.companion || p.recruited || p.gang) continue;
      if (p._bumHunt) continue;                 // the FSM owns this body right now
      // a HOBO, or a creepy lone ped: the lurker in the dark. Skip anyone already
      // mid-scene (raging/fleeing/surrendering) and the recently-scared (per-ped CD).
      const creepy = p.vagrant || p._role === "panhandler";
      if (!creepy) continue;
      if (p.rage || p.surrender || p.state === "flee" || p.state === "fight") continue;
      if ((p._scareCD || 0) > 0) { p._scareCD -= dt; continue; }
      const dx = px - p.pos.x, dz = pz - p.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.7 * 1.7 || d2 > 3.0 * 3.0) continue;          // the 2-3m "right next to you" band
      // SNAP: whip around to face you, freeze the shuffle, recoil pose.
      faceYaw(p, Math.atan2(dx, dz), 0.9);   // the motor's pivot rate: a whip, not a teleport
      p.speed = 0; p.pause = Math.max(p.pause, 0.8);
      p.poseCower = Math.max(p.poseCower || 0, 0.7);            // reactions.js animates the hunch/recoil
      p._scareT = 0.9;                                          // transient marker (rig may read it)
      p._scareCD = 22 + rng() * 10;                             // this hobo won't scare you again for ~25s
      if (CBZ.citySay) CBZ.citySay(p, pick(["GET BACK!", "YOU SEE EM TOO?!", "DON'T TOUCH ME!", "THEY'RE WATCHING!", "I KNOW WHAT YOU ARE!"], rng()), "#ff7b6b", 1.6);
      if (CBZ.sfx) CBZ.sfx("punch");                           // a sharp startle stinger
      if (CBZ.shake) CBZ.shake(0.5);                            // the camera flinch
      // THE LUNGE IS GONE FROM HERE ON PURPOSE. It used to fire for any
      // violent-band vagrant, which made the bark a reliable predictor of the
      // attack — the exact cue predator.js exists to remove. A dangerous bum
      // now takes you through the FSM above, on its own unreadable schedule,
      // and often after no bark at all.
      _scareT = 6 + rng() * 4;                                  // citywide gap before the next fright
      return;                                                   // one scare per pass, max
    }
  });

  // SPAWN-SLICE flag (default ON; honour an owner-set value so a toggle sticks).
  // OFF → spawnCityPeds runs the exact old synchronous burst. The whole feature
  // is in one place (spawnCityPeds below) and degrades to today when this is
  // false, the scheduler is missing, or under the profiler.
  if (CBZ.spawnSlice === undefined) CBZ.spawnSlice = true;
  let _campaignPopulationDeferred = false;

  CBZ.spawnCityPeds = function (n) {
    _campaignPopulationDeferred = false;
    // PERF: full-rig peds are the single most expensive per-frame system in the
    // city (each one runs think()/move() — steering, collision, state machine —
    // every few frames regardless of visibility). Population size drives that
    // cost directly, so scale it down at low quality tiers the same way
    // traffic.js already scales car count. This is the actual lever for
    // "Fastest" — pixelRatio/shadows never touched population cost at all.
    const _pq = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
    const _popMul = _pq === 0 ? 0.4 : _pq === 1 ? 0.6 : _pq === 2 ? 0.8 : 1;
    n = Math.max(6, Math.round(n * _popMul));
    CBZ.clearCityPeds();
    CBZ.cityPopulationReset();          // fresh city → reset the finite headcount
    _fugitives = 0; _megaFugitiveSpawned = false;   // fresh fugitive roster (bounties re-roll)
    const A = CBZ.buildCity();
    _s = 555 + n;
    if (CBZ.cityEcon && CBZ.cityEcon.initMarket) CBZ.cityEcon.initMarket();
    if (CBZ.market && CBZ.market.reset) CBZ.market.reset();   // E1: fresh city → levels back to 1.0
    if (CBZ.econState && CBZ.econState.reset) CBZ.econState.reset();   // E2: fresh city → EconState back to equilibrium
    if (CBZ.npcEcon && CBZ.npcEcon.reset) CBZ.npcEcon.reset();   // E4: fresh city → cohort wallets re-seeded off the fresh population
    if (CBZ.hunger && CBZ.hunger.reset) CBZ.hunger.reset();   // X2: fresh city → cohort hungerAvg back to its seeded baseline
    if (CBZ.corps && CBZ.corps.reset) CBZ.corps.reset();   // E5: fresh city → the roster resets (re-claims outlets on the next build tick)
    if (CBZ.stocks && CBZ.stocks.reset) CBZ.stocks.reset();   // E7: fresh city → exchange/portfolio/index reset (no stale prior-run IPO tickers)
    if (CBZ.forex && CBZ.forex.reset) CBZ.forex.reset();   // M2: fresh city → FX rates back to their wealth-implied par values
    if (CBZ.billionaires && CBZ.billionaires.reset) CBZ.billionaires.reset();   // E8: fresh city → founders/holdings re-mint on the next tick
    if (CBZ.motorsport && CBZ.motorsport.reset) CBZ.motorsport.reset();   // E10: fresh city → teams/drivers re-mint on the next tick
    CBZ.cityDrops.length = 0;
    // the homeless are carved out of the ped budget so the TOTAL stays flat
    // (perf: redistribute, never add). Deterministic from the seeded stream.
    const nVagrant = Math.min((CBZ.CITY && CBZ.CITY.vagrants) || 0, (n / 4) | 0);

    // ---- ONE civilian: density-weighted point + district cast + full rig.
    //      Factored out so it can run either in the old synchronous burst OR as
    //      one drained work item — IDENTICAL body either way. Each call pulls
    //      the seeded rng stream in the same internal order; the only thing the
    //      slicer changes is WHEN (which frame) a given index is built, never
    //      what rng it consumes once it runs. ----
    function spawnOneCivilian() {
      // ===== SPAWN-1: EMERGE FROM PLACES, not random pavement ==================
      // WHY: a city reads alive when people come OUT of where life happens — a
      // resident off an apartment stoop, a shopper at a store counter, someone in
      // a queue — not teleported onto a sidewalk. spawnplaces.js (CBZ.cityPlaceSpawnPoint)
      // returns a place {x,z,role,opts} ~half the time (it leaves the other half null
      // BY DESIGN so the street keeps its through-traffic). When it gives a place we
      // spawn AT it with the place's pre-baked opts and SKIP castForDistrict (the
      // place already decided who they are). DETERMINISM: we call it FIRST and
      // ALWAYS (even when we won't use it / flag-off) so the seeded rng order — and
      // the MP host snapshot — never drift.
      const place = (CBZ.cityPlaceSpawnPoint) ? CBZ.cityPlaceSpawnPoint(A, rng) : null;
      if (place && CBZ.CONFIG && CBZ.CONFIG.CITY_PLACE_SPAWN !== false) {
        const popts = place.opts || {};
        const ped = makePed(place.x, place.z, rng, popts);
        if (popts._role || place.role) ped._role = popts._role || place.role;
        // an apartment-door place tags the home lot + an EMERGE first-leg so
        // SCHED-1 walks them a few metres off the door before normal commute AI.
        if (place.lot) ped._home = ped._digs = place.lot;
        if (popts._emerge || place.emerge) { ped._emerge = true; ped._goalKind = "emerge"; }
        if (popts._queueAt || place.queueAt) ped._queueAt = popts._queueAt || place.queueAt;
        A.root.add(ped.group);
        CBZ.cityPeds.push(ped);
        return;
      }
      // ===== H5: DOOR-BIASED street spawn ======================================
      // The default ambient civilian: a density-weighted sidewalk point + a
      // district cast. But ~35% of the time (when housing.js is present and the
      // owner toggle is on) we instead place them JUST OUTSIDE their own home or
      // work DOOR — at night/evening outside the home lobby ("just left / heading
      // in"), in work hours at their workplace door ("arriving for work") — the
      // same idiom regionlife.js uses (base = pick.home). The other 65% keep the
      // street's through-traffic so the sidewalks never empty.
      let p = null, opts = null, emerge = false;
      const doorBias = CBZ.spawnFromDoors !== false && CBZ.cityHousing &&
        A.homeLots && A.homeLots.length && rng() < 0.35;
      if (doorBias) {
        // build a provisional ped identity by district at a sidewalk anchor, then
        // resolve its persistent home/work and shift the SPAWN to that door. We
        // cast first (cheap, sets archetype/wealth) so homeLot/workLot bias right.
        const anchor = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : A.randomSidewalkPoint();
        const d0 = A.districtAt ? A.districtAt(anchor.x, anchor.z) : null;
        opts = castForDistrict(d0, rng);
        const tmpPed = { archetype: opts.archetype, wealth: opts.wealth, vendor: null, pos: { x: anchor.x, z: anchor.z }, _digs: null, _unit: null, _home: null, _work: null };
        const phase = dayPhase();
        let lot = null, wantEmerge = false;
        if (phase === "morning" || phase === "work") {
          lot = workLot(tmpPed, A);                 // "arriving for work"
        }
        if (!lot) { lot = homeLot(tmpPed, A); wantEmerge = true; }   // home (night/default)
        const door = lot && lot.building && lot.building.door;
        if (door) {
          // offset OUT along the door's outward normal so we never spawn inside a
          // collider or wedge the doorway (door.nx/nz is the INWARD normal).
          const ox = door.nx != null ? -door.nx : 0, oz = door.nz != null ? -door.nz : 0;
          p = { x: door.x + ox * 1.6 + (rng() - 0.5) * 1.2, z: door.z + oz * 1.6 + (rng() - 0.5) * 1.2 };
          if (A.clampToCity) A.clampToCity(p, PED_R);
          // carry the resolved identity + anchors onto the real ped below.
          opts._home = wantEmerge ? lot : null;
          opts._work = tmpPed._work || null;
          opts._digs = tmpPed._digs || null;
          emerge = wantEmerge;
        } else { p = anchor; }   // no usable door → just spawn at the anchor (already cast)
      }
      if (!p) {
        // ---- the original path (no door bias): density-weighted point + cast ----
        p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : A.randomSidewalkPoint();
        const d = A.districtAt ? A.districtAt(p.x, p.z) : null;
        opts = castForDistrict(d, rng);
      }
      const ped = makePed(p.x, p.z, rng, opts);
      if (opts._role) ped._role = opts._role;   // pinned life (tourist on the strip)
      // carry resolved home/work/digs from the door-bias path (makePed inits these
      // to null; we stamp the persistent anchors so the routine reads consistent).
      if (opts._home) { ped._home = opts._home; ped._digs = opts._home; }
      if (opts._work) ped._work = opts._work;
      if (opts._digs && !ped._digs) ped._digs = opts._digs;
      if (emerge) { ped._emerge = true; ped._goalKind = "emerge"; }
      A.root.add(ped.group);
      CBZ.cityPeds.push(ped);
    }

    // ---- the REST of a fresh city: vagrants, vendors, then the seeders that
    //      iterate the COMPLETE ped list (gangs/security/social/vips weave
    //      couples, cliques, families, protection details). These MUST see every
    //      civilian, so when the build is sliced they run only after the queue
    //      has fully drained — never against a half-filled list. Pulled into a
    //      closure so both the synchronous path and the drained path call the
    //      exact same tail in the exact same order (rng-identical). ----
    function finishSpawn() {
      // the slice drain is complete (or never started) — clear the guard that
      // tells per-frame seeders (vips.js) NOT to self-start against a partial
      // roster mid-drain. finishSpawn weaves the COMPLETE list below.
      CBZ.citySpawnDraining = false;
      spawnVagrants(A, nVagrant);
      // VENDOR STAFFING is now LAZY + proximity-gated — see the cityStaffVendors
      // tick below. The old eager "post a body at all ~180 vendorSpots here"
      // loop (a) built 180 full rigs in one synchronous burst, and (b) RACED the
      // settlement/biome shopLots, which towngen pushes onto A.shopLots AFTER
      // buildCity() returns — so at finishSpawn time most counters were empty and
      // came up 0/180. The tick posts a real, robbable vendor only when the shop
      // is near the player and off-camera, recycles them behind you, and honours
      // citystaff's day-open / night-closed. (citystaff.js still deliberately does
      // NOT double-staff stores — that contract is preserved.)
      if (CBZ.spawnCityGangs) CBZ.spawnCityGangs();
      if (CBZ.spawnCitySecurity) CBZ.spawnCitySecurity();
      if (CBZ.citySocialInit) CBZ.citySocialInit();
      // VIP principals + protection details (city/vips.js): drafts/dresses bodies
      // that already exist, so the citywide rig count stays flat. Guarded —
      // everything still works if the file isn't loaded.
      if (CBZ.spawnCityVips) CBZ.spawnCityVips();
      // fresh city → clear the lone-wolf rampage director + any stale spree flags
      // (aigoals.js owns the director state; guarded in case load order shifts).
      if (CBZ.cityRampageReset) CBZ.cityRampageReset();
    }

    const nCiv = n - nVagrant;

    // ===== SPAWN-SLICE: drain the civilian rig burst over frames ============
    // PROBLEM: makePed() builds ~30 THREE.Mesh via character.js; doing all ~100
    // (260 in the profiler) in ONE synchronous loop is a multi-hundred-ms main-
    // thread block — the "world loads → controls freeze" hitch on city entry.
    //
    // FIX: build a budgeted number of civilians per FRAME within a small wall-
    // clock budget (performance.now), so the full count still lands over ~1-2s
    // but no single frame stalls. The seeders (gangs/social/vips) run in
    // finishSpawn() AFTER the last civilian, so they still weave the COMPLETE
    // list — zero population/logic regression, same final count, same rng order.
    //
    // GUARDED + REVERSIBLE: gated on CBZ.spawnSlice (default true). Off → the
    // exact old synchronous loop. Also forced synchronous when the scheduler
    // isn't available, or under a NET sim-host so a join in progress can't catch
    // a half-built world mid-drain (guests never reach here — mode.js skips
    // spawnCityPeds when net.noSim(); this only guards the host's own snapshots).
    // the headless PROFILER (?profile=1) spawns a city then immediately measures
    // / alarms the WHOLE list in the same tick (profile.js chaos scenario) — it
    // WANTS the full population present synchronously, not streamed in over 2s.
    // Force the old path there so benchmarks stay apples-to-apples.
    const _profiling = (typeof location !== "undefined")
      && /(?:\?|&)profile=1(?:&|$)/.test((location && location.search) || "");
    const sliceOn = (CBZ.spawnSlice !== false) && !_profiling && (typeof performance !== "undefined")
      && CBZ.onUpdate && nCiv > 0;
    if (!sliceOn) {
      // ---- ORIGINAL synchronous path (flag off / no scheduler) -------------
      for (let i = 0; i < nCiv; i++) spawnOneCivilian();
      finishSpawn();
      return;
    }

    // build a small ESSENTIAL slice up front so the street isn't empty on the
    // first rendered frame (the player spawns into bodies, not a ghost town),
    // then hand the remainder to the ONE persistent drainer below. Capped so
    // even the essential slice can't re-introduce a visible stall on the weak Mac.
    const essential = Math.min(nCiv, 12);
    for (let i = 0; i < essential; i++) spawnOneCivilian();

    // publish this run's drain JOB into module state. A NEW spawnCityPeds (mode
    // re-enter / net re-sim / host handoff) simply OVERWRITES this — clearCityPeds
    // already wiped the old roster, so the prior job is moot and is dropped. One
    // shared job object means the per-frame drainer is registered exactly ONCE
    // (below, at load), never accumulating a dead closure per city entry.
    // mark the slice as DRAINING so per-frame seeders that self-start off a
    // truthy cityPeds.length (vips.js) don't fire against the PARTIAL roster and
    // get orphaned when finishSpawn re-seeds the complete one. Cleared in
    // finishSpawn. (undefined == not draining, so this only gates the live window
    // — worst on the slow Mac where the drain outlasts a VIP slot's 2s cooldown.)
    CBZ.citySpawnDraining = true;
    _spawnJob = {
      built: essential, total: nCiv,
      makeOne: spawnOneCivilian, finish: finishSpawn,
    };
  };

  // ---- the ONE persistent spawn drainer: registered a single time, drains the
  //      current _spawnJob a budgeted slice per frame. BUDGET_MS keeps each
  //      frame's spawn work tiny (a couple of rigs) so it folds into the
  //      existing per-frame cost instead of trading one big freeze for several
  //      medium ones; MAX_PER_FRAME caps it independently when performance.now
  //      is coarse/clamped (some browsers round it to 1ms for privacy). Order
  //      0.5 → runs BEFORE the ped think tick so a body built this frame is
  //      already live for AI/render the same frame. No-op (one cheap null check)
  //      whenever there's no pending job, so the steady-state cost is nil. ----
  let _spawnJob = null;
  const _SPAWN_BUDGET_MS = 4;     // ~a few rigs/frame; the full count lands in ~1-2s
  const _SPAWN_MAX_FRAME = 8;     // hard cap regardless of a coarse clock

  // A mode reset normally owns the whole population lifecycle through
  // spawnCityPeds(). The campaign prologue is the one intentional exception:
  // cancel any old sliced job and leave no live street roster until its
  // observation gate opens. This does not touch city geometry.
  CBZ.cityDeferPedPopulation = function () {
    _spawnJob = null;
    CBZ.citySpawnDraining = false;
    _campaignPopulationDeferred = true;
    if (CBZ.clearCityPeds) CBZ.clearCityPeds();
    if (CBZ.cityPopulationReset) CBZ.cityPopulationReset();
  };
  CBZ.cityPedPopulationDeferred = function () { return _campaignPopulationDeferred; };

  if (CBZ.onUpdate) CBZ.onUpdate(0.5, function () {
    if (_campaignPopulationDeferred) {
      if (g.mode !== "city") return;
      let observed = true;
      if (CBZ.cityCampaignObservationGate) {
        try { observed = CBZ.cityCampaignObservationGate("peds") !== false; }
        catch (e) { observed = true; }
      }
      if (!observed) return;
      _campaignPopulationDeferred = false;
      CBZ.spawnCityPeds((CBZ.CITY && CBZ.CITY.peds) || 90);
      return;
    }
    const job = _spawnJob;
    if (!job) return;
    // left the city mid-drain → drop the job. We do NOT force-finish: a re-entry
    // calls spawnCityPeds fresh (clearCityPeds wipes this partial roster), so an
    // abandoned city's queue is moot. Force-building the remainder here would
    // re-introduce a freeze on the exit frame — the exact hitch this removes.
    if (g.mode !== "city") { _spawnJob = null; return; }
    const t0 = performance.now();
    let made = 0;
    while (job.built < job.total && made < _SPAWN_MAX_FRAME) {
      job.makeOne();
      job.built++; made++;
      if (performance.now() - t0 >= _SPAWN_BUDGET_MS) break;
    }
    if (job.built >= job.total) {
      // seeders (gangs/social/vips) weave the now-COMPLETE list, then we're done.
      // Guard against a re-spawn swapping the job mid-loop: only finish if still ours.
      if (_spawnJob === job) { _spawnJob = null; job.finish(); }
    }
  });

  function vendorName(lot) {
    const t = {
      guns: "Gunsmith", jewelry: "Jeweler", pawn: "Pawnbroker", gas: "Clerk", clothing: "Stylist", drugs: "Dealer",
      food: "Cook", bar: "Bartender", bank: "Teller", hardware: "Clerk", gym: "Trainer", security: "Recruiter",
      hospital: "Medic", barber: "Barber", electronics: "Clerk", carlot: "Salesman", realtor: "Realtor", chop: "Mechanic",
      casino: "Pit Boss", raceway: "Race Marshal", arena: "Promoter", paintball: "Referee", transit: "Dispatcher",
      cityhall: "Clerk", airfield: "Handler", racepark: "Bookie",
    };
    return t[lot.kind] || "Owner";
  }

  CBZ.clearCityPeds = function () {
    // Release moving-parent placements (aircraft seats, authored posts) before
    // disposing the roster. The shared NPC-life layer drops its cabin/actor
    // references here so a rebuilt city never points at disposed character rigs.
    if (CBZ.npcLife && CBZ.npcLife.resetCity) CBZ.npcLife.resetCity();
    // the street's brain registrations go with the roster (no dangling actors
    // in the brain's spatial hash / morale groups after a rebuild)
    if (CBZ.cityBrain) CBZ.cityBrain.reset();
    for (const p of CBZ.cityPeds) {
      // HOME-BOND release (H2): a recycled/wiped body must let go of its leased
      // unit so the next city's tenants aren't blocked. Prefer the housing.js
      // contract; else clear the occupancy fields aigoals/housing stamp directly
      // (unit.occupants[] + the home._tenants tally — W8: an array now, since a
      // unit can hold a whole household, not just one ped). All optional-chained
      // — no-op when no housing layer is loaded.
      if (CBZ.cityHomeRelease) { try { CBZ.cityHomeRelease(p); } catch (e) {} }
      else {
        if (p._unit && p._unit.occupants) {
          const oi = p._unit.occupants.indexOf(p);
          if (oi >= 0) p._unit.occupants.splice(oi, 1);
        }
        const hm = p._digs && p._digs.building && p._digs.building.home;
        if (hm && hm._tenants) hm._tenants = Math.max(0, hm._tenants - 1);
      }
      p._unit = null; p._digs = null; p._home = null; p._household = null;
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (p.group) p.group.traverse(function (o) {
        if (o.isSprite) return;     // sprites share an r128 geometry singleton — never dispose
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        // `_cbzClothKey` = city/clothes.js painted cloth. The SHARED atlas is
        // `_shared` and already skipped — but the per-rig ISO CLONE deliberately
        // is not, and a clone is a legal door into the one CanvasTexture EVERY
        // wearer of that outfit key samples. Skip both by name (the clone is
        // per-rig and about to be garbage anyway, so this costs nothing).
        if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && !x._cbzClothKey && x.dispose && x.dispose()); else if (!m._shared && !m._cbzClothKey && m.dispose) m.dispose(); }
      });
    }
    CBZ.cityPeds.length = 0;
    _corpseClear();            // the roster is gone; so is every body on it
    _coverList.length = 0;
    CBZ.cityDrops.length = 0;
    if (CBZ.citySecurity) CBZ.citySecurity.length = 0;
    // the garrison's chain of command rebuilds with the world — badge zero
    // again, so the same seed stands the same unit up (determinism law).
    _milSlot = 0;
  };

  // ===== LAZY VENDOR STAFFING (proximity + NPC_SPAWN_HIDE + day/night) =========
  // A real, killable, robbable vendor ped stands at each shop's vendorSpot — but
  // only the handful of shops NEAR the player at any moment carry a body, built a
  // few per frame (never 180 at once) and recycled once they drift behind you.
  // This replaces finishSpawn's old eager loop (which raced the settlement
  // shopLots build and left every counter empty). Reversible: CBZ.CONFIG.LAZY_VENDORS.
  if (CBZ.CONFIG.LAZY_VENDORS == null) CBZ.CONFIG.LAZY_VENDORS = true;
  const VEND_IN2 = 55 * 55;     // post a vendor when the counter is within 55m
  const VEND_OUT2 = 80 * 80;    // recycle it once beyond 80m (hysteresis vs IN)
  const VEND_POST_BUDGET = 3;   // full rigs built per tick — spreads the cost
  let _vendScan = 0;
  // dedicated rng: the per-frame post cadence is player-relative (already
  // non-deterministic per client), so it must NOT draw on the shared seeded
  // `rng()` stream that world/civilian spawns depend on (order-fragile).
  let _vseed = 0x51ed;
  function vrng() { _vseed = (_vseed * 1103515245 + 12345) & 0x7fffffff; return _vseed / 0x7fffffff; }
  // NPC_SPAWN_HIDE: reject a placement only when it'd land close AND inside the
  // camera's forward cone (mirrors crowd.js placeSafe / citystaff flipSafe).
  function vendorPlaceSafe(x, z) {
    if (!CBZ.CONFIG || !CBZ.CONFIG.NPC_SPAWN_HIDE) return true;
    const P = CBZ.player; if (!P || P.dead) return true;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = x - P.pos.x, rz = z - P.pos.z, d2 = rx * rx + rz * rz;
    if (d2 >= 45 * 45) return true;                    // far enough — always safe
    const rd = Math.sqrt(d2) || 1;
    return ((rx / rd) * fx + (rz / rd) * fz) < 0.35;   // safe only if NOT on camera
  }
  function postVendor(lot) {
    const b = lot.building, vs = b && b.vendorSpot; if (!vs) return null;
    // the Ammu-Nation gunsmith (and the security firm) keep a gun behind the
    // counter — of course. Robbing/downing them drops it for the taking. A
    // higher nerve makes them stand their ground rather than flee.
    const packsHeat = lot.kind === "guns" || lot.kind === "security";
    const ped = makePed(vs.x, vs.z, vrng, {
      vendor: lot, kind: "vendor", wealth: 0.7, cash: 80 + ((vrng() * 200) | 0),
      name: vendorName(lot), aggr: packsHeat ? 0.55 : 0.3,
      archetype: "merchant", job: vendorName(lot).toLowerCase(),
      armed: packsHeat, weapon: packsHeat ? (lot.kind === "guns" ? "Carbine" : "Pistol") : null,
    });
    if (packsHeat) { ped.nerve = 0.85; ped.ammo = 40; }
    ped.group.rotation.y = vs.face;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(ped.group);
    CBZ.cityPeds.push(ped);
    b.vendor = ped;
    return ped;
  }
  function removeVendor(ped) {
    const i = CBZ.cityPeds.indexOf(ped);
    if (i >= 0) CBZ.cityPeds.splice(i, 1);
    _corpseDrop(ped);          // off the roster ⇒ off every index built from it
    _coverDrop(ped);
    if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
    if (ped.group) ped.group.traverse(function (o) {
      if (o.isSprite) return;   // sprites share an r128 geometry singleton — never dispose
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
      // painted cloth (`_cbzClothKey`) is never disposed here — see clearCityPeds
      if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && !x._cbzClothKey && x.dispose && x.dispose()); else if (!m._shared && !m._cbzClothKey && m.dispose) m.dispose(); }
    });
  }
  CBZ.onUpdate(35.4, function () {
    if (!CBZ.CONFIG.LAZY_VENDORS) return;
    if (CBZ.game && CBZ.game.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    const shops = A && A.shopLots;
    if (!shops || !shops.length) return;
    const P = CBZ.player; if (!P || !P.pos || P.dead) return;
    const night = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
    const open = night < 0.5;                            // day-open / night-closed (matches citystaff)
    const n = shops.length;
    let posted = 0;
    // round-robin a slice of shops each tick so the scan cost stays flat
    const SCAN = Math.min(n, 64);
    for (let k = 0; k < SCAN; k++) {
      const lot = shops[(_vendScan + k) % n];
      const b = lot && lot.building; if (!b || !b.vendorSpot || lot.demolished) continue;
      const vs = b.vendorSpot;
      const dx = vs.x - P.pos.x, dz = vs.z - P.pos.z, d2 = dx * dx + dz * dz;
      const want = open && d2 <= VEND_IN2;
      const v = b.vendor;
      if (v) {
        if (v.dead) continue;                            // robbed/downed — leave the body, don't churn it
        // let go of a vendor the shop no longer wants (closed, or you've walked
        // off) — but only once it's far OR safely off-camera, so a counter you're
        // standing at is never emptied in your face.
        // a vendor you shot and put on the floor (alive, bleeding) is still
        // there when the shop shuts: he gets up or he dies, he never vanishes
        if (CBZ.vitals && CBZ.vitals.state && CBZ.vitals.state(v) !== "ok") continue;
        if (!want && (d2 > VEND_OUT2 || vendorPlaceSafe(vs.x, vs.z))) { removeVendor(v); b.vendor = null; }
        continue;
      }
      if (want && posted < VEND_POST_BUDGET && vendorPlaceSafe(vs.x, vs.z)) {
        if (postVendor(lot)) posted++;
      }
    }
    _vendScan = (_vendScan + SCAN) % n;
  });
  // let other systems force a full re-check / initial fill (e.g. after a rebuild).
  CBZ.cityStaffVendors = function () { _vendScan = 0; };

  // ---- alarm everyone near (x,z); offender lets witnesses remember who ----
  CBZ.cityAlarm = function (x, z, radius, intensity, offender) {
    radius = radius || 18; intensity = intensity || 1;
    const r2 = radius * radius;
    // A PERIMETER HEARS AS ONE. Every alarm in the game already funnels through
    // here, so ringing city/garrison.js's post bus from this one place gives
    // every standing sentry, checkpoint and gate guard in earshot the same
    // notice — the alternative is each of them running its own scan and
    // discovering the shot three seconds apart. Deliberately WIDER than the
    // crowd radius (a rifle is heard a long way past the people it scares) and
    // it hands over NO target: it only wakes them — they look further and they
    // look now — and security.js's intruder filter still decides whether there
    // is anybody to fight, then cityScare still decides hold / engage / bolt.
    if (CBZ.cityPostAlert) { try { CBZ.cityPostAlert(x, z, radius * 2.4 + 30, offender || null); } catch (e) {} }
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.staffPost) continue;   // posted staff hold their station
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) {
        p.alarmed = Math.max(p.alarmed, 4 + intensity * 3);
        p.fear = Math.min(10, p.fear + intensity);
        if (offender && offender !== p && offender.pos) p.mem = offender;     // witness memory
      }
    }
  };

  // ---- CROWD PANIC: a loud, scary event (gunfire, explosion, a body dropping).
  //      Everyone in range gets the fear/alarm the rest of the city reads, and
  //      the event becomes a NOISE through CBZ.brain (city/brain_city.js
  //      hearBang): each body that hears it reacts when ITS OWN reaction delay
  //      runs out (distance + nerve + a stable per-person offset), through
  //      threat.respond — bolt, cower, freeze, film from a distance, square up.
  //      That is the difference between a street that ripples outward from a
  //      gunshot and one that flips every body on the same frame (the old loop
  //      here called fleeFrom on the whole radius at once). A blast SEAT is the
  //      one reflex: inside it even the fearless back off, with a 50-200 ms
  //      startle, never a charge into a fresh fireball. `power` scales radius.
  //      O(crowd) once per event, not per frame. ----
  let _lastPanicFrame = -1;
  CBZ.cityPanic = function (x, z, power, offender, blast) {
    power = power || 1;
    _audit.linearFallbackCalls++;
    _audit.linearVisited += CBZ.cityPeds.length;
    const radius = 16 + power * 10, r2 = radius * radius;
    let reached = 0;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.companion || p.controlled || p._parked || p.recruited || p.staffPost) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z, dd = dx * dx + dz * dz;
      if (dd >= r2) continue;
      const close = 1 - Math.sqrt(dd) / radius;            // 0 at edge, 1 at centre
      p.alarmed = Math.max(p.alarmed, 5 + power * 3 * close);
      p.fear = Math.min(10, p.fear + (4 + power * 4) * close);
      if (offender && offender !== p && offender.pos) p.mem = p.mem || offender;
      if (blast && close > 0.55) p.rage = null;             // the blast SEAT: nobody charges a fireball
      reached++;
    }
    // what was it? a blast; a gun going off (the offender holds one); or a body
    // dropping / a scream — which startles, while the WITNESS path (cityCrime →
    // cityTagWitnesses) carries the crowd's real answer to a killing.
    const offArmed = offender && (offender.isPlayer || offender === CBZ.city.playerActor ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!offender.armed);
    const kind = blast ? "explosion" : offArmed ? "gunshot" : "scream";
    const heard = CBZ.cityBrain ? CBZ.cityBrain.hearBang(x, z, radius, kind, offender) : -1;
    if (heard < 0) {
      // no brain loaded (a stripped slice): the meek in range simply run
      for (const p of CBZ.cityPeds) {
        if (p.dead || p.vendor || p.companion || p.controlled || p._parked || p.recruited || p.staffPost) continue;
        const dx = p.pos.x - x, dz = p.pos.z - z;
        if (dx * dx + dz * dz < r2 && p.aggr < (A0().crook || 0.72) && !p.rage) fleeFrom(p, x, z);
      }
    }
    // a SINGLE punctuating scream on a genuinely scary event, small chance, and
    // the scream() helper enforces the hard city-wide cooldown.
    if (reached >= 2 && _lastPanicFrame !== frame) { _lastPanicFrame = frame; if (rng() < 0.18) scream(); }
    return reached;
  };

  // WITNESSES: a crime at (x,z) → CBZ.brain.social.crime (city/brain_city.js).
  // The bodies that could SEE it (cone, range, walls) or HEAR it become
  // witnesses and choose flee / film / report / intervene / cower by who they
  // are; the calls that survive the street's omerta land as reports the CITY
  // LAW router turns into stars (the ONLY way the player gets them). `perp`
  // defaults to the player — an NPC's crime (a rampage, an NPC heist) MUST
  // pass its NPC: the old tagger pinned every crime in earshot on the player.
  CBZ.cityTagWitnesses = function (x, z, sev, type, perp) {
    const who = perp || CBZ.city.playerActor;
    if (CBZ.cityBrain && CBZ.cityBrain.crime(type, x, z, who, sev) >= 0) return;
    // no brain loaded (a stripped slice): remember and fear, nobody calls
    const r2 = 30 * 30;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) { p.mem = who; p.alarmed = Math.max(p.alarmed, 5); p.fear = Math.min(10, p.fear + 1.5); }
    }
  };

  // ---- CONSEQUENCE: harming a POWER's family ----
  // A gang boss's WIFE / kin is PROTECTED. Touch her and the whole crew comes for
  // you: heavy provoke (so the reprisal director sends a hit squad), a hostility
  // bump via cityGangMemberDown's ladder (she counts as one of theirs to them),
  // and on a KILL, a direct war push if the war hook exists. The boss himself, if
  // alive nearby, drops everything and rages. Bounded + city-gated + fully guarded.
  // Called from cityKillPed / cityKOPed / cityRobPed and (for non-lethal harm)
  // social.js. `lethal` makes the crew take it hardest. Returns true if it fired.
  CBZ.cityFamilyHarmed = function (ped, byPlayer, lethal) {
    if (g.mode !== "city" || !ped || byPlayer === false) return false;
    const gid = ped.protectGang; if (!gid) return false;
    // heavy crew rage — a wife/kin hit is near the top of the provoke scale.
    if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(gid, lethal ? 0.95 : 0.7);
    // route through the member-down ladder so hostility climbs + a reprisal squad
    // gets dispatched (the wife "counts" as crew to the grieving gang).
    if (lethal && CBZ.cityGangMemberDown) {
      try { CBZ.cityGangMemberDown({ gang: gid, rank: "kin", dead: true, pos: ped.pos }, { byPlayer: true }); } catch (e) {}
    }
    // the head himself, alive + nearby, turns on you in person.
    const head = ped.protectedBy;
    if (head && !head.dead && head.pos && CBZ.city && CBZ.city.playerActor) {
      head.rage = CBZ.city.playerActor; head.state = "fight";
      head.alarmed = Math.max(head.alarmed || 0, 8); head.fear = 0;
      head.mem = CBZ.city.playerActor;   // he remembers WHO did it
    }
    // a kill is a declaration of war: push the crew onto the player's block if the
    // gang record + war hook exist (guarded; no-op if the war layer is absent).
    if (lethal && CBZ.cityStartGangWar && CBZ.cityGangById && CBZ.player && !CBZ.player.dead) {
      const gang = CBZ.cityGangById(gid);
      const pg = g.playerGang;
      if (gang && pg && pg.founded && pg.turf && pg.turf.length) {
        try { CBZ.cityStartGangWar(gang, pg, { assault: true, free: true }); } catch (e) {}
      }
    }
    if (CBZ.city && CBZ.city.big) {
      CBZ.city.big(lethal ? "You killed the boss's family, the crew is coming"
                          : "You crossed the boss's family");
    }
    return true;
  };

  // ---- rob / KO / kill (player-facing verbs reused by interact + combat) ----
  CBZ.cityRobPed = function (ped) {
    if (!ped || ped.dead || ped.robbed) return null;
    const econ = CBZ.cityEcon;
    let got = ped.cash; ped.cash = 0;
    if (got > 0 && CBZ.city) CBZ.city.addCash(got);
    // E4 CIRCULATION: the cash that just left this ped's pocket also leaves
    // their district+class cohort's aggregate wallet (sim/npcecon.js) — rob
    // enough of a district and its cohort spending (and the market it drives)
    // visibly sags. Guarded no-op if npcecon.js/districtAt aren't loaded.
    if (got > 0 && CBZ.npcEcon && CBZ.npcEcon.debit && econ && econ.districtAt && ped.pos) {
      CBZ.npcEcon.debit(econ.districtAt(ped.pos.x, ped.pos.z), CBZ.npcEcon.classFor(ped.wealth), got);
    }
    let item = "";
    if (ped.loot && econ) { econ.add(ped.loot, 1); item = ped.loot; ped.loot = null; }
    ped.robbed = true; ped.alarmed = 8; ped.fear = 10;
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 16, 1, CBZ.city.playerActor);
    // robbing a boss's wife of her millions is a personal insult to the crew.
    if (ped.protectGang) CBZ.cityFamilyHarmed(ped, true, false);
    CBZ.cityCrime && CBZ.cityCrime(60, { x: ped.pos.x, z: ped.pos.z, type: "robbery" });
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city && CBZ.city.addRespect(1);
    if (CBZ.cityCountMayhem) CBZ.cityCountMayhem();
    return { cash: got, item };
  };

  // opts.rigFall: the blow that did it already put him down in his own rig
  // (systems/verbs_strike.js knockdown) — do not topple the group on top of it
  CBZ.cityKOPed = function (ped, fromX, fromZ, opts) {
    if (!ped || ped.dead) return;
    if (ped.reportState) cancelReport(ped);    // knocked out mid-call → no report lands
    leaveSit(ped);                             // a felled desk worker leaves the seat (C3)
    ped.alarmed = 6;
    const seated = !!(ped._npcAttached && CBZ.CONFIG && CBZ.CONFIG.CHAR_SEATED_HITTABLE !== false);
    if (!(opts && opts.rigFall) && CBZ.vitals && !seated) {
      // THE TASER (every caller without rigFall is a nonlethal round): the
      // legs go and the muscles lock for a few seconds; he is awake, on the
      // floor, and cuffable (systems/vitals.js tase lays him down in his rig)
      CBZ.vitals.tase(ped, 6, { dirX: ped.pos.x - fromX, dirZ: ped.pos.z - fromZ, power: 0.6 });
      ped.ko = Math.max(ped.ko || 0, 6.5);
    } else {
      ped.ko = Math.max(ped.ko || 0, 8);
      // a plane-seated body's group is PARENT-LOCAL — the knockdown lie-flat
      // writes world coords onto it and teleports the rig (see cityKillPed's
      // seated gate); a tased passenger just slumps unconscious where they sit.
      if (CBZ.body && !(opts && opts.rigFall) && !seated) CBZ.body.hit(ped, { fromX, fromZ, force: 7, knockdown: true });
    }
    if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
    // laying hands on a boss's wife/kin brings the crew (non-lethal harm).
    if (ped.protectGang) CBZ.cityFamilyHarmed(ped, true, false);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 0.8, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(45, { x: ped.pos.x, z: ped.pos.z, type: "assault" });
  };

  /* ---- THE CITY PLUGS ITS STREET INTO VITALS (systems/vitals.js) ----
     kill: the one death vitals hands out (bled out, a blade in the heart, a
     beating of a man already out) goes through the street's own death, with
     the man who did it as the offender, and an officer through cityHurtCop.
     safe: a man bandages himself only once nobody is after him. */
  function vitBy(a, o) { return (o && o.by) || (a && a._vt && a._vt.by) || null; }
  function isPlayerish(by) { return !!by && (by === CBZ.player || by.isPlayer === true || by === (CBZ.city && CBZ.city.playerActor)); }
  if (CBZ.vitals && CBZ.vitals.on) {
    CBZ.vitals.on("city", {
      kill: function (a, cause, o) {
        o = o || {};
        const by = vitBy(a, o), byPlayer = isPlayerish(by);
        const att = by && !byPlayer && by.pos ? by : null;
        let fx = o.fromX, fz = o.fromZ;
        if (fx == null && by && by.pos) { fx = by.pos.x; fz = by.pos.z; }
        if (a.kind === "cop") {
          // (no fromX: combat.js's LOS gate drops a cop hit whose shooter is walled off
          // right now, and a man bleeding out is not being shot this frame)
          if (CBZ.cityHurtCop) CBZ.cityHurtCop(a, 1e6, { attacker: att || (byPlayer ? CBZ.city.playerActor : null), byPlayer: byPlayer, force: 2 });
          return !!a.dead;
        }
        if (!CBZ.cityKillPed) return false;
        CBZ.cityKillPed(a, { fromX: fx, fromZ: fz, attacker: att, byPlayer: byPlayer, force: o.force != null ? o.force : 2 }, cause || "bled out");
        return !!a.dead;
      },
      safe: function (p) {
        if (p.alarmed > 3 || p.restraint || p.surrender) return false;
        if (p.kind === "cop") return !(p.curTarget || p.npcTarget || p.rage);   // an officer on a suspect finishes that first
        const V = CBZ.vitals, st = V ? V.state(p) : "ok";
        if (st === "down") return true;              // on the floor: the alarm is the only question
        return !(p.rage || p.fleeing || p.state === "flee" || p.state === "fight" || p.state === "confront");
      },
    });
  }
  // THE AID SCAN (1 Hz): a man down and bleeding, and a gang-mate or his
  // partner close by with nothing better to do, is sent over (think() walks
  // him there and vitals does the wrap). Walks vitals' short live list only.
  let _aidT = 0;
  CBZ.onUpdate(58, function (dt) {
    if (g.mode !== "city" || !CBZ.vitals) return;
    _aidT -= dt; if (_aidT > 0) return; _aidT = 1;
    const V = CBZ.vitals, L = V.list, peds = CBZ.cityPeds;
    if (!L || !L.length || !peds) return;
    for (let i = 0; i < L.length; i++) {
      const R = L[i], pt = R && R.a;
      if (!pt || pt === CBZ.player || R.dead || pt.dead || pt.isPlayer || pt.kind === "cop" || R.band || !pt.pos) continue;
      if (!(R.critical || R.collapsed)) continue;
      if (!(V.bleedRate(pt) > 0.0006)) continue;
      if (pt._aidBy && !pt._aidBy.dead && pt._aidBy._aidTo === pt) continue;
      let best = null, bd = 16 * 16;
      for (let j = 0; j < peds.length; j++) {
        const h = peds[j];
        if (!h || h === pt || h.dead || h._parked || h.inCar || h.vendor || h.staffPost || h.controlled || h.restraint || h._aidTo) continue;
        if (!((pt.gang && h.gang === pt.gang) || h.partner === pt || pt.partner === h)) continue;
        if (h.rage || h.ko > 0 || h.alarmed > 3 || h.state === "flee" || h.state === "fight" || V.state(h) !== "ok") continue;
        const dx = h.pos.x - pt.pos.x, dz = h.pos.z - pt.pos.z, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = h; }
      }
      if (best) { best._aidTo = pt; pt._aidBy = best; }
    }
  });

  // SIT-INTERRUPT helper (C3): a seated desk worker that just got KO'd / killed /
  // hit must LEAVE the seat — clear the seated pose flag, free its claimed desk
  // (officejobs.js, optional-chained) and forget the anchor. move() also clears
  // char.sitting whenever the state drifts off "sit", but the KO/kill paths skip
  // move() entirely (the main loop `continue`s on dead/ko bodies), so an explicit
  // clear here is what keeps a felled worker from carrying a stale sit pose.
  // the desk sit's bookkeeping, once CBZ.moves has the hips on the chair
  function deskSeated(ped, spot) {
    if (!ped || ped.dead) return;
    // his brain turned urgent while he sat down: straight back up
    if (ped.rage || ped.surrender || ped.state === "flee" || ped.state === "fight") {
      if (CBZ.moves && CBZ.moves.stand) CBZ.moves.stand(ped);
      return;
    }
    ped._deskAnchor = { x: spot.x, y: spot.y || 0, z: spot.z, face: spot.face, lot: spot.lot, kind: spot.kind || "office",
      cushionH: spot.cushionH, floorBelow: spot.floorBelow };
    if (ped._mv && CBZ.moves) CBZ.moves.reset(ped._mv, ped.pos);
    ped.path = null; ped.speed = 0; ped.pause = 0;
    ped.state = "sit";
    if (ped.char) {
      ped.char.sitting = true;
      if (CBZ.propSeatRef) ped.char.seatRef = CBZ.propSeatRef(ped._deskAnchor) || ped.char.seatRef;
      ped.char.typing = CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 !== false;
    }
  }
  function leaveSit(ped) {
    if (!ped) return;
    if (ped.char && ped.char.sitting) { ped.char.sitting = false; ped.char.seatRef = null; }
    if (ped.state === "sit") ped.state = "walk";
    if (ped._deskAnchor) { if (CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(ped); ped._deskAnchor = null; }
  }

  const _ragP = { x: 0, y: 0, z: 0 }, _ragD = { x: 0, y: 0, z: 0 };   // ragdoll scratch
  CBZ.cityKillPed = function (ped, imp, cause) {
    if (!ped || ped.dead) return;
    if (ped.reportState) cancelReport(ped);    // killed mid-call → the report dies with them
    leaveSit(ped);                             // a killed desk worker leaves the seat (C3)
    // every body follows its killer around (kill-cam stats + street reads)
    if (imp && imp.attacker && typeof imp.attacker === "object" && !imp.attacker.isPlayer) {
      imp.attacker.bodies = (imp.attacker.bodies | 0) + 1;
    }
    const wasArmed = !!ped.armed;
    ped.dead = true; ped.deadT = 0; ped.hp = 0;
    // ONE BODY OF NERVE: the set / unit / crew / friend clique this person
    // belonged to takes the loss (brain morale: shock, the leader term, the man
    // beside him rattled). gangs.js reads morale.broken for the rout.
    if (CBZ.cityBrain) CBZ.cityBrain.memberDown(ped);
    // FINITE POPULATION: a named rig just died → tick the city headcount DOWN.
    // Promoted crowd rigs (ped._crowd) die through HERE (they're real peds);
    // un-promoted ambient agents die through cityCrowdKill (crowd.js) — the two
    // paths are mutually exclusive per individual, so every distinct death
    // decrements the roster EXACTLY once. Cops aren't part of the civilian
    // populace and never route through cityKillPed, so the headcount stays clean.
    if (CBZ.cityPopulationDie) CBZ.cityPopulationDie(1);
    // AN ARMED PED DROPS THEIR GUN WHERE THEY FALL — and "where they fall" is
    // the whole reason this is no longer four lines of local code. The lines
    // below dropped at ped.pos unconditionally, which is correct for a man
    // shot on the pavement and WRONG for the three cases the crewed-seats
    // waves created: a body in a helicopter seat is at its seat's WORLD
    // position, so his SMG was spawned 150 m over the city and the wreck
    // landed empty. city/morgue.js's cityDeathDrop owns the whole contract now
    // — the gun, the ammo, the held-prop resync AND the armour stamp
    // interact.js's "Take armor" reads — and DEFERS the payout for a body with
    // no resting place yet, paying it at the wreck once the body is down.
    // Degrade-safe: no morgue.js, and this is byte-for-byte what it always was.
    if (CBZ.cityDeathDrop) CBZ.cityDeathDrop(ped);
    else {
      if (ped.armed && ped.weapon) dropWeapon(ped.pos.x, ped.pos.z, ped.weapon, ped.ammo, { y: ped.pos.y, body: ped });
      ped.armed = false; ped.weapon = null; ped.ammo = 0;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    }
    // bodies carry WAY more than you'd lift off the living — loot the corpse
    rollDeadLoot(ped);
    if (CBZ.gore && ped.pos) {
      let dir = imp && imp.dir ? { x: imp.dir.x || 0, z: imp.dir.z || 0 } : null;
      if (!dir && imp && imp.fromX != null) dir = { x: ped.pos.x - imp.fromX, z: ped.pos.z - imp.fromZ };
      // an explosion tears a body apart — heavier mist/spray/gibs than a clean shot.
      const goreAmt = cause === "explosion" ? 1.9 : 1.0;
      CBZ.gore(ped.pos.x, ped.pos.y + 1.0, ped.pos.z, { dir, amount: goreAmt, cloth: ped.outfit, skin: ped.skin });
      // ---- EXPLOSION DISMEMBERMENT: a blast can tear a limb clean off. Hide it on
      // the corpse + spray a second gore burst at the stump (a torn limb flung from
      // the wound). LEAK-SAFE: a dead rig is never revived — pooled corpses are
      // replaced by a fresh makeCharacter (crowd.js:313) and standalone corpses are
      // disposed, so no living ped ever inherits a missing limb. Real, gruesome,
      // INTENTIONAL — the limb-loss you saw is now a designed effect, not a glitch.
      if (cause === "explosion" && ped.char && ped.char.parts && rng() < 0.5) {
        const LIMBS = ["ll", "rl", "la", "ra"];                 // legs read most dramatic
        const key = LIMBS[(rng() * LIMBS.length) | 0];
        const limb = ped.char.parts[key];
        if (limb && limb.visible !== false) {
          limb.visible = false;                                  // blown clean off
          ped._lostLimb = key;
          const stumpY = (key.charAt(1) === "l") ? 0.55 : 1.4;   // leg low, arm high
          CBZ.gore(ped.pos.x, ped.pos.y + stumpY, ped.pos.z, { dir, amount: 1.5, cloth: ped.outfit, skin: ped.skin });
        }
      }
    }
    // VERLET RAGDOLL (city/ragdoll.js): a near, on-screen full-rig kill flops for
    // REAL — point impulse scaled by what actually hit them (a 9mm crumples, an
    // AK shoves, a point-blank 12-gauge hurls, an RPG lifts the whole body). The
    // ragdoll itself pins _phys.down=9999 (same busy-forever contract as below)
    // and zeroes the fling, so exactly one simulation moves the corpse. Far
    // kills — or any kill while ragdoll.js is absent — keep the cheap path.
    // A seated cabin passenger/crew corpse SLUMPS IN THE SEAT instead: the rig
    // is parented PLANE-LOCAL (npclife attach), so the world-space verlet
    // ragdoll / fling below would simulate against a local transform and hurl
    // the body through the hull — the same reason inCar bodies already skip
    // it. npclife.syncAttached keeps the corpse in its chair and applies the
    // one-shot CBZ.charSeatSlump death pose. (CHAR_SEATED_HITTABLE)
    const seatedCorpse = !!(ped._npcAttached && CBZ.CONFIG && CBZ.CONFIG.CHAR_SEATED_HITTABLE !== false);
    let ragged = false;
    /* WHO GETS THE LIMP VERLET BODY: only what really throws a body, a blast
       or a car (city/ragdoll.js flops it through the air and down stairs).
       A man who is SHOT, stabbed or beaten collapses (systems/bodyfall.js
       via the knockdown below): the legs give first and he goes down along
       the round and his own run, no spin. The verlet body used to take every
       near kill, and a limp stick figure hit by a pistol is a plank levered
       over its planted feet. */
    const launches = cause === "explosion" || cause === "run over" || cause === "killed in the crash" ||
      !!(imp && imp.wkey === "shotgun" && (imp.dist || 99) < 7);   // a point-blank 12-gauge really does throw a man
    if (launches && CBZ.cityRagdoll && ped.char && ped.char.parts && !ped.inCar && !seatedCorpse) {
      let mag;
      const f0 = (imp && imp.force) || 0;
      if (cause === "explosion") mag = 20 + Math.min(14, (f0 || 10) * 0.8);
      else if (cause === "run over" || cause === "killed in the crash") mag = Math.min(22, (f0 || 8) * 1.1);
      else if (cause === "headshot" || cause === "shot" || cause === "shot by police") {
        mag = 6 * ((imp && imp.cal) || 1);
        if (imp && imp.wkey === "shotgun" && (imp.dist || 99) < 10) mag = 16;   // point-blank 12-gauge HURLS
      } else if (cause === "stabbed" || cause === "beaten" || cause === "executed" || cause === "finished off") mag = 5 + (f0 || 6) * 0.25;
      else if (cause === "bled out") mag = 2.5;
      else mag = f0 || 6;
      if (imp && imp.dir) {
        _ragD.x = imp.dir.x || 0; _ragD.y = imp.dir.y || 0; _ragD.z = imp.dir.z || 0;
        const rl = Math.hypot(_ragD.x, _ragD.y, _ragD.z) || 1;
        _ragD.x /= rl; _ragD.y /= rl; _ragD.z /= rl;
      } else if (imp && imp.fromX != null) {
        const rl = Math.hypot(ped.pos.x - imp.fromX, ped.pos.z - imp.fromZ) || 1;
        _ragD.x = (ped.pos.x - imp.fromX) / rl; _ragD.y = 0; _ragD.z = (ped.pos.z - imp.fromZ) / rl;
      } else { const ra = rng() * 6.28; _ragD.x = Math.cos(ra); _ragD.y = 0; _ragD.z = Math.sin(ra); }
      if (imp && imp.point) { _ragP.x = imp.point.x; _ragP.y = imp.point.y; _ragP.z = imp.point.z; }
      else {
        _ragP.x = ped.pos.x - _ragD.x * 0.25;
        _ragP.y = (ped.pos.y || 0) + (cause === "headshot" ? 2.05 : 1.25);
        _ragP.z = ped.pos.z - _ragD.z * 0.25;
      }
      ragged = CBZ.cityRagdoll(ped, _ragP, _ragD, mag);
    }
    // GROUNDING HANDOFF: a kill MUST arm the ragdoll so grapple (onUpdate 24) takes
    // ownership and grounds the corpse via cityRestY — otherwise a dead rig would
    // keep standing/sinking (peds.js skips downed bodies; nothing would lay it flat).
    // Both fling paths launch the body → it lands → grapple sets _phys.down=9999
    // (dead stay sprawled), which makes CBZ.body.busy(ped) true forever, so the main
    // loop's `if (CBZ.body.busy(p)) continue;` keeps move() from ever stomping the
    // grounded Y. The knockdown fallback below guarantees a downed state even on the
    // off-chance a fling can't resolve (e.g. body already at floor), so we never
    // depend on the airborne path alone.
    if (CBZ.body && !ragged && !seatedCorpse) {
      /* A MAN WHO IS SHOT FALLS; HE IS NOT LAUNCHED. Every cheap-path death
         used to be an airborne fling (callers pass fling 3-5 for a bullet or a
         fist), so the body left the ground spinning on two random axes, and
         then a SECOND knockdown with a hardcoded +z direction overwrote the
         real one, so every such corpse turned to face the same compass point
         as it fell: the pivot-on-a-foot the owner saw. Only what really lifts
         a body (a blast, a car) flings it now; everything else is the one
         collapse (systems/bodyfall.js through grapple's knockdown): legs
         first, along the round and his own momentum, no spin. */
      let kdx = 0, kdz = 0;
      if (imp && imp.dir) { kdx = imp.dir.x || 0; kdz = imp.dir.z || 0; }
      else if (imp && imp.fromX != null) { kdx = ped.pos.x - imp.fromX; kdz = ped.pos.z - imp.fromZ; }
      const hasDir = kdx * kdx + kdz * kdz > 1e-8;
      // Zero is meaningful for a nuclear pressure impulse: horizontal blast
      // wind may topple/slide a body without the generic explosion's upward
      // launch. `|| 4` converted that explicit zero back into grenade fling.
      const hitForce = imp && imp.force != null ? imp.force : 7;
      if (launches && imp && hasDir && (imp.fling == null || imp.fling > 0)) {
        CBZ.body.hit(ped, { dir: { x: kdx, z: kdz }, force: hitForce, fling: imp.fling != null ? imp.fling : 4 });
      } else if (CBZ.body.knockdown) {
        // no direction at all (a bleed-out, a heart attack): he folds where he stands
        if (!hasDir) { const yw = (ped.group && ped.group.rotation.y) || 0; kdx = -Math.sin(yw); kdz = -Math.cos(yw); }
        CBZ.body.knockdown(ped, { dir: { x: kdx, z: kdz }, force: hasDir ? hitForce : 1, t: 9999 });
      }
    }
    // attribute the kill: a real actor (player or NPC) is the offender; a
    // driverless run-over has none (just a death, nobody to blame/witness).
    const att = (imp && imp.attacker && imp.attacker.pos) ? imp.attacker : null;
    const byPlayer = imp ? imp.byPlayer !== false : true;
    const offender = att && att !== CBZ.city.playerActor ? att : (byPlayer ? CBZ.city.playerActor : null);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 22, 1.4, offender);
    // a body drops → the street scatters. If this death was an EXPLOSION, flag it
    // so cityPanic clears the blast seat (even violent peds won't charge a bazooka).
    if (CBZ.cityPanic) CBZ.cityPanic(ped.pos.x, ped.pos.z, cause === "explosion" ? 1.6 : 1.3, offender, cause === "explosion");
    if (ped.gang && byPlayer && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
    if (att && att !== CBZ.city.playerActor) {
      if (att.kind !== "cop" && !lawfulSecurityAct(att, ped) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 90, "murder");   // lawful responders are not criminals
    } else if (byPlayer) {
      CBZ.cityCrime && CBZ.cityCrime(250, { x: ped.pos.x, z: ped.pos.z, type: "murder" });
      g._cityKillDetail = {
        ped: ped,
        gang: ped.gang || null,
        boss: !!(ped.isBoss || ped.rank === "boss"),
        armed: wasArmed,
        victim: ped.name || "civilian",
      };
      CBZ.city && CBZ.city.addKill(ped);   // pass the victim: respect scales with their LEVEL
      if (CBZ.cityCountMayhem) CBZ.cityCountMayhem();
      // BOUNTY CLAIMED: this ped was a wanted fugitive with a price on their head —
      // killing them (even by accident) pays out. The terrorist jackpot ($5M) can
      // turn one stray bullet into a fortune. Paid ONCE (clear the bounty).
      if (ped.bounty > 0) {
        const amt = ped.bounty | 0; ped.bounty = 0;
        if (CBZ.city) {
          CBZ.city.addCash(amt);
          CBZ.city.big("BOUNTY CLAIMED: $" + amt.toLocaleString() + " — " + (ped.bountyTag || "WANTED") + " " + (ped.name || ""));
          CBZ.city.addRespect(amt >= 1000000 ? 25 : 5);
        }
        if (CBZ.sfx) CBZ.sfx("coin");
      }
    }
    if (ped.gang && CBZ.cityGangMemberDown) CBZ.cityGangMemberDown(ped, imp);
    // PERMANENT-DEATH HOOK (persistent-identity registry, a separate task this same
    // wave): if this ped was ever entered into CBZ.cityIdentities (a named/recurring
    // NPC the player met, recruited, or otherwise grew a real identity record for),
    // mark it permanently dead there too. Feature-detected both ways — a no-op if
    // the registry module hasn't loaded yet (load order across this wave isn't
    // guaranteed) or if this particular ped never got an identity in the first place.
    if (ped._identityId && CBZ.cityIdentities && CBZ.cityIdentities.markDead) {
      try { CBZ.cityIdentities.markDead(ped._identityId, { killedBy: offender, at: (CBZ.now || 0) }); } catch (e) {}
    }
    // KILLED A POWER'S FAMILY (boss's wife/kin): the whole crew now hunts you. The
    // wife herself has no .gang, so this is the path that makes clipping her
    // DANGEROUS — a jackpot in jewellery, paid for with the gang on your back.
    if (ped.protectGang && byPlayer) CBZ.cityFamilyHarmed(ped, true, true);
    if (ped.partner && CBZ.citySocialDeath) CBZ.citySocialDeath(ped);
    // CHAINED FEUD: an NPC killer earns the dead ped's partner/crew as enemies
    // (the player has the wanted/gang-provoke systems already — chain NPC↔NPC only).
    if (att && att !== CBZ.city.playerActor && CBZ.cityNpcFriendDeath) CBZ.cityNpcFriendDeath(ped, att);
    if (CBZ.pushKill) CBZ.pushKill((ped.name || "A civilian") + " was killed", "#ff6b6b");
  };

  // bodies carry a real haul — cash plus whatever they were holding. The big one:
  // a dead ped's CARRIED VALUABLES (their watch/ring/chain — assigned by who they
  // are in makePed) drop to the corpse, so killing the right rich person and looting
  // them is occasionally a life-changing fortune (a Patek / a 7-figure ring).
  function rollDeadLoot(ped) {
    const econ = CBZ.cityEcon;
    let cash = (ped.cash || 0) + (econ ? econ.rollCash(ped.wealth) : 20) + (ped.gang ? 60 + ((rng() * 240) | 0) : 0);
    const items = [];
    if (ped.loot) items.push(ped.loot);
    // fold in everything they were carrying — these are the jackpots.
    if (ped.valuables && ped.valuables.length) for (const v of ped.valuables) if (v) items.push(v);
    if (econ) {
      if (rng() < 0.6) items.push(econ.randomLoot(ped.wealth > 0.6 || ped.gang));
      if (ped.gang) { items.push(rng() < 0.5 ? "Coke" : "Weed"); if (rng() < 0.4) items.push("Ammo Box"); }
      if (rng() < 0.3) items.push(["Phone", "Wallet", "Cash Stack", "Sunglasses"][(rng() * 4) | 0]);
    }
    ped.deadLoot = { cash: Math.round(cash), items, looted: false };
    _corpseAdd(ped);          // the ONE place a body becomes lootable
  }

  // loot a corpse (interact.js [I] near a body): take the whole haul
  CBZ.cityLootCorpse = function (ped) {
    if (!ped || !ped.dead || !ped.deadLoot || ped.deadLoot.looted) return null;
    const dl = ped.deadLoot; dl.looted = true;
    _corpseDrop(ped);         // auto-loot re-asks for the nearest body in the same
                              // frame until it runs dry; drop it here and that loop
                              // shrinks its own search instead of re-walking the crowd
    const econ = CBZ.cityEcon;
    if (dl.cash > 0 && CBZ.city) CBZ.city.addCash(dl.cash);
    // E4 CIRCULATION: same debit as a live robbery (see cityRobPed) — a
    // looted corpse's cash leaves its district+class cohort wallet too.
    if (dl.cash > 0 && CBZ.npcEcon && CBZ.npcEcon.debit && econ && econ.districtAt && ped.pos) {
      CBZ.npcEcon.debit(econ.districtAt(ped.pos.x, ped.pos.z), CBZ.npcEcon.classFor(ped.wealth), dl.cash);
    }
    const got = [];
    for (const it of dl.items) { if (it && econ) { econ.add(it, 1); got.push(it); } }
    if (CBZ.sfx) CBZ.sfx("loot");
    CBZ.city && CBZ.city.note("Looted body: $" + dl.cash + (got.length ? " + " + got.join(", ") : ""), 2);
    return dl;
  };
  // Nearest LOOTABLE body. The auto-loot scanner (interact.js) asks every frame
  // and re-asks once per body in a pile, so this used to be the single most
  // re-walked list in the game. PED_SCAN_GRID answers it from the corpse list —
  // bounded by how many bodies are lying around, not by how many people are
  // alive — with the ORIGINAL predicate re-run per candidate so a looted/culled
  // body is skipped exactly as before. The _gi tie-break reproduces the linear
  // scan's first-in-roster-wins on an exact distance tie (two bodies dropped on
  // the same spot).
  CBZ.cityNearestCorpse = function (x, z, maxd) {
    let best = null, bd = (maxd || 3) * (maxd || 3);
    if (CBZ.CONFIG && CBZ.CONFIG.PED_SCAN_GRID) {
      _audit.listRoutedCalls++;
      for (let i = 0; i < _corpseList.length; i++) {
        const p = _corpseList[i];
        if (!p.dead || !p.deadLoot || p.deadLoot.looted || p.culled) continue;
        const dd = (p.pos.x - x) * (p.pos.x - x) + (p.pos.z - z) * (p.pos.z - z);
        if (dd < bd || (dd === bd && best && (p._gi | 0) < (best._gi | 0))) { bd = dd; best = p; }
      }
      return best;
    }
    _audit.linearFallbackCalls++;
    for (const p of CBZ.cityPeds) { if (!p.dead || !p.deadLoot || p.deadLoot.looted || p.culled) continue; const dd = (p.pos.x - x) * (p.pos.x - x) + (p.pos.z - z) * (p.pos.z - z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  };

  // ---- dropped weapons ----
  function dropWeapon(x, z, weapon, ammo, opts) {
    opts = opts || {};
    const y = (typeof opts.y === "number" && isFinite(opts.y)) ? opts.y
      : (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
    let mesh = null;
    if (CBZ.city && CBZ.city.arena) {
      // Inventory V2 swaps this compatibility proxy for the authored weapon
      // model before presentation. Keep even the fallback neutral: a dropped
      // gun must never become a glowing green pickup marker for one frame.
      // THE REAL WEAPON from the first frame (city/itemassets.js's gun
      // builder, seated on its own lowest point), never a 70 cm black bar
      // floating 25 cm off the floor; the box stays only as the no-registry
      // degrade.
      if (CBZ.itemAssetPickup) {
        try {
          const wid = (CBZ.weaponIdFromName && CBZ.weaponIdFromName(weapon)) || weapon || "Pistol";
          mesh = CBZ.itemAssetPickup(wid, { gun: wid }, { kind: "gun" });
        } catch (e) { mesh = null; }
        if (mesh) mesh.position.set(x, y + 0.004, z);
      }
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.22), CBZ.mat(0x1c1f24));
        mesh.position.set(x, y + 0.08, z);
      }
      mesh.userData.transient = true;
      CBZ.city.arena.root.add(mesh);
    }
    CBZ.cityDrops.push({
      x, y, z, weapon: weapon || "Pistol", ammo: ammo || 24, t: 0, mesh,
      body: opts.body || null,
    });
  }
  CBZ.cityDropWeapon = dropWeapon;

  function removeDrop(i) {
    const d = CBZ.cityDrops[i];
    if (d && d._weaponBody && CBZ.weaponPhysics && CBZ.weaponPhysics.release) {
      CBZ.weaponPhysics.release(d._weaponBody);
    }
    if (d && d.mesh && d.mesh.parent) { d.mesh.parent.remove(d.mesh); if (d.mesh.geometry && !d.mesh.geometry._shared) d.mesh.geometry.dispose(); if (d.mesh.material && !d.mesh.material._shared) d.mesh.material.dispose(); }
    CBZ.cityDrops.splice(i, 1);
  }

  // ---- damage helpers used by the NPC brain (NPC vs NPC / NPC vs cop / NPC vs player) ----
  function lawfulSecurityAct(att, tgt) {
    if (!att || att.kind !== "security" || !tgt) return false;
    if (att.mem === tgt && att.alarmed > 0) return true;
    return tgt.isPlayer ? (g.wanted | 0) >= 1 : (tgt.npcWanted | 0) >= 1;
  }

  const _hurtWP = { x: 0, y: 0, z: 0 }, _hurtWO = { fromX: 0, fromZ: 0, melee: undefined };
  // a man swinging a blade (nobody on the street carries one yet; the field
  // is read so the day one does, his swing cuts instead of punching)
  const _plHit = { kind: "", zone: null, point: null, power: 0.6, blocked: false, heavy: false, cal: 0.9 };
  function npcBlade(a) { return !!(a && (a.blade || (!a.armed && /knife|machete|shiv|blade/i.test(a.weapon || "")))); }
  // `res` is the landed strike when this is a fist (CBZ.verbs.strike): the
  // verbs play the reaction on the body, and this may overrule it
  // (res.reaction = "dead" | "knockdown" | "none")
  /* STRUCK: what a man does the moment a blow lands on him, whoever threw it
     (an NPC here, the player in city/combat.js landCity). ONE answer: he is
     alarmed and afraid, off his seat, his set rallies (sizeup.js), the
     outclassed fold (hands up / run), and a man who dares and has the nerve
     fights back. Everyone else is left to the shared brain's threatened
     branch next think (alarmed > 0: flee / cower / report / intervene).
     A man on the floor is out of the fight. */
  function struck(att, tgt, down) {
    if (!tgt || tgt.dead || !att) return;
    if (tgt.char && tgt.char.sitting) leaveSit(tgt);   // a struck desk worker is off the seat NOW (C3 interrupt)
    if (down) { tgt.rage = null; return; }
    tgt.alarmed = Math.max(tgt.alarmed || 0, 6); tgt.fear = Math.min(10, (tgt.fear || 0) + 2);
    tgt.mem = att;                                     // who did it: the threat the brain reads
    const dare = CBZ.citySizeUpHit ? CBZ.citySizeUpHit(tgt, att) : true;
    if (!tgt.rage && dare && !tgt.restraint && (tgt.aggr || 0) >= (A0().bold || 0.5)) { tgt.rage = att; tgt.state = "fight"; }   // fight back — never with wrists tied (restrain.js owns him)
  }
  CBZ.cityStruck = struck;
  function hurtActor(att, tgt, dmg, melee, res) {
    if (!tgt || tgt.dead) return;
    const fx = att.pos.x, fz = att.pos.z;
    if (tgt.isPlayer) {
      // a REMOTE player (multiplayer): the wound travels over the wire and is
      // applied by the victim's own client; the knockdown below is LOCAL-player only.
      if (tgt.netHurt) {
        tgt.netHurt(dmg, fx, fz, att.kind === "cop" ? "gunned down" : "killed in the street");
        if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 22 : 40, melee ? "assault" : "shots-fired");
        return;
      }
      // pass the ATTACKER ACTOR (not just its name) so city/death.js can SPECTATE
      // your killer after WASTED; cityHurtPlayer derives the display name from it.
      // WHAT hit you rides along (city/death.js hands it to systems/vitals.js):
      // a fist dazes and can knock you out, a blade or a round opens a bleed.
      // Whether the blow put you on the floor is vitals' call, not a dice roll.
      _plHit.kind = melee ? (npcBlade(att) ? "blade" : "fist") : "bullet";
      _plHit.zone = melee && res ? res.zone : null;
      _plHit.point = melee && res && res.point ? res.point : null;
      _plHit.power = melee && res ? res.power : 0.6;
      _plHit.blocked = !!(res && res.blocked);
      _plHit.heavy = !!(res && res.heavy);
      _plHit.cal = att.swat ? 1.1 : 0.9;
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, fx, fz, att.kind === "cop" ? "gunned down" : (melee ? "beaten in the street" : "killed in the street"), false, att, false, _plHit);
      if (melee && res && (CBZ.player.dead || (CBZ.vitals && CBZ.vitals.cuffable(CBZ.player)))) res.reaction = "none";
      if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 22 : 40, melee ? "assault" : "shots-fired");
      return;
    }
    if (tgt.kind === "cop") {
      if (melee && CBZ.vitals) {
        // a fist on an officer is a daze, the same as on anybody (vitals):
        // it can put him out, it never runs his number to zero
        if (CBZ.cityHurtCop) CBZ.cityHurtCop(tgt, Math.max(0, Math.min(dmg, (tgt.hp || 0) - 1)), { fromX: fx, fromZ: fz, attacker: att, byPlayer: false });
        const r = CBZ.vitals.blunt(tgt, { zone: (res && res.zone) || "head", power: res && res.power != null ? res.power : 0.6, weapon: "fist",
          by: att, dirX: tgt.pos.x - fx, dirZ: tgt.pos.z - fz, fromX: fx, fromZ: fz });
        if (res) res.reaction = tgt.dead ? "dead" : r === "ko" ? "none" : r === "knockdown" && !res.blocked ? "knockdown" : res.reaction;
      } else if (CBZ.cityHurtCop) CBZ.cityHurtCop(tgt, dmg, { fromX: fx, fromZ: fz, shot: !melee, point: melee ? null : shotPoint(tgt), cal: att.swat ? 1.1 : 0.9, attacker: att, byPlayer: false });
      if (res && tgt.dead) res.reaction = "dead";
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 60 : 110, "attacked-officer");
      return;
    }
    // ped vs ped. WHAT THE BLOW DID TO HIS BODY is systems/vitals.js's: a
    // fist dazes and knocks out (never kills a man on his feet), a blade or a
    // round opens a bleed, and a hole that runs his hp out puts him on the
    // floor bleeding hard instead of killing him, unless it found the head,
    // the heart or a body already riddled. hp stays the brain's number.
    const V = CBZ.vitals;
    const blade = melee && npcBlade(att);
    const lethal = (tgt.hp || 0) - dmg <= 0;
    tgt.hp = V ? Math.max(1, tgt.hp - dmg) : tgt.hp - dmg;
    // the body CARRIES a ROUND (wounds.js): entry wound + blood soak. A punch
    // leaves no decal (wounds.js stamps nothing for blunt).
    if (!melee || blade) {
      if (blade && res && res.point) { _hurtWP.x = res.point.x; _hurtWP.y = res.point.y; _hurtWP.z = res.point.z; }
      else { _hurtWP.x = tgt.pos.x; _hurtWP.y = (tgt.pos.y || 0) + 1.05 + rng() * 0.55; _hurtWP.z = tgt.pos.z; }
      if (CBZ.bodyWound) { _hurtWO.fromX = fx; _hurtWO.fromZ = fz; _hurtWO.melee = blade ? "blade" : undefined; CBZ.bodyWound(tgt, _hurtWP, _hurtWO); }
    }
    let out = null;
    if (V) {
      if (melee && !blade) {
        out = V.blunt(tgt, { zone: (res && res.zone) || "head", power: res && res.power != null ? res.power : 0.6, weapon: "fist",
          heavy: !!(res && res.heavy), by: att, dirX: tgt.pos.x - fx, dirZ: tgt.pos.z - fz, fromX: fx, fromZ: fz });
      } else {
        out = V.wound(tgt, { kind: blade ? "stab" : "bullet", zone: blade && res ? res.zone : "", point: _hurtWP, by: att,
          critical: lethal, cal: att.swat ? 1.1 : 0.9, fromX: fx, fromZ: fz }).outcome;
      }
    }
    struck(att, tgt, tgt.dead || out === "ko" || out === "down" || (V && V.cuffable(tgt)));
    if (!V && tgt.hp <= 0) {
      CBZ.cityKillPed(tgt, { fromX: fx, fromZ: fz, attacker: att, byPlayer: false, force: melee ? 6 : 5, fling: melee ? 3 : 4 }, melee ? (blade ? "stabbed" : "beaten") : "shot");
    }
    if (tgt.dead) { if (res) res.reaction = "dead"; }
    else if (out === "ko" || out === "down") { if (res) res.reaction = "none"; }            // vitals laid him down in his own rig
    else if (res) {
      if (!res.blocked && (out === "knockdown" || (!V && rng() < 0.3))) res.reaction = "knockdown";
    } else if (melee || !streetShot(tgt, fx, fz, _hurtWP, 0.9)) { if (CBZ.body) CBZ.body.hit(tgt, { fromX: fx, fromZ: fz, force: 3 }); }
    if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 18 : 36, "assault");
  }
  /* A STREET ROUND INTO A LIVING MAN (NPC or cop fire): CBZ.verbs.shot, the
     same answer on his rig as a player's round. False = no rig (a far,
     instanced body): the caller keeps the old impulse. Shared by police.js. */
  const _streetShot = { point: null, dir: null, fromX: 0, fromZ: 0, cal: 0.9, share: 1, head: false };
  function streetShot(tgt, fx, fz, point, cal) {
    const V = CBZ.verbs;
    if (!V || !V.shot || !tgt || tgt.dead) return false;
    _streetShot.point = point || null; _streetShot.fromX = fx; _streetShot.fromZ = fz; _streetShot.cal = cal || 0.9;
    return V.shot(tgt, _streetShot);
  }
  CBZ.cityStreetShot = streetShot;
  // where a street round lands on a man: chest to head height on his centre
  // line (the shooters here roll a hit, they do not trace a ray)
  const _shotPt = { x: 0, y: 0, z: 0 };
  function shotPoint(t) {
    _shotPt.x = t.pos.x; _shotPt.y = (t.pos.y || 0) + 1.0 + rng() * 0.6; _shotPt.z = t.pos.z;
    return _shotPt;
  }

  // ---- CROSSFIRE: a fired round that doesn't cleanly hit its mark can catch an
  //      innocent BYSTANDER near the line of fire. Real GTA chaos: get caught in a
  //      shootout and you bleed. Cheap + bounded: only runs when a shot is actually
  //      fired, scans an n-capped slice of nearby peds, takes the FIRST one close to
  //      the shot path (perp distance small, roughly between shooter + target), and
  //      hits them at a low per-shot chance. A downed bystander → panic + witnesses,
  //      and the shooter racks NPC heat (hurtActor's ped-vs-ped path already does the
  //      offense bookkeeping). The actual target is excluded. ----
  function crossfire(att, tgt, missed) {
    // missed shots are the usual culprit; a hit can still over-penetrate (rare).
    const chance = missed ? 0.16 : 0.05;
    if (rng() >= chance) return;
    const ax = att.pos.x, az = att.pos.z;
    let dx = tgt.pos.x - ax, dz = tgt.pos.z - az;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;                                   // unit shot direction
    const peds = CBZ.cityPeds;
    let scanned = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p === att || p === tgt || p.dead || p._parked || p.isPlayer || p.inCar) continue;
      const rx = p.pos.x - ax, rz = p.pos.z - az;
      const along = rx * dx + rz * dz;                      // distance projected onto the shot line
      if (along < 1.5 || along > len + 3) continue;          // behind shooter / well past target
      // cheap pre-cull by gross distance before the perp math (keeps the scan tight)
      if (Math.abs(rx) > 30 || Math.abs(rz) > 30) continue;
      const perp = Math.abs(rx * dz - rz * dx);              // signed perp distance to the line
      if (perp > 1.6) continue;                              // not in the path of the round
      // n-cap: only consider a handful of candidates near the line, then stop.
      if (++scanned > 6) break;
      // struck a bystander — they take a real round.
      hurtActor(att, p, 12 + rng() * 12, false);
      if (CBZ.tracer) {
        const f = { x: ax, y: 1.4, z: az }, t2 = { x: p.pos.x, y: 1.3, z: p.pos.z };
        CBZ.tracer(f, t2, { muzzleScale: 0.0 });
      }
      // a stray hit on an innocent terrifies the block (panic → witnesses scatter +
      // remember the shooter). hurtActor already racked the shooter's NPC heat via
      // its ped-vs-ped assault/murder offense, so cops respond. One victim per shot.
      if (CBZ.cityPanic) CBZ.cityPanic(p.pos.x, p.pos.z, 1.1, att);
      return;
    }
  }

  // ---- NPC fire profiles: WHAT a shooter holds decides how hard a round lands
  //      and how fast the next one comes. ONE default keeps every existing gun
  //      exactly as it was; the AK-47 alone gets 7.62 physics — a touch more
  //      damage than the SMG-tier default on a slower cycle. WHY: the status
  //      rifle has to BE the threat it looks like, so duelling its carrier for
  //      the drop is a genuine risk for a genuine prize, not a free upgrade. ----
  const NPC_GUN = {
    "AK-47": { dmg: 19, dspr: 10, cd: 0.75, cspr: 0.5 },
  };
  const NPC_GUN_DEF = { dmg: 14, dspr: 10, cd: 0.55, cspr: 0.5 };

  // COMPETENCE, not a constant (systems/combat_iq.js). WHAT this person is and
  // WHAT they hold decides reaction time, aim settle, burst rhythm, accuracy
  // and the per-hit damage that holds their DPS on the table's ladder. Absent
  // the module (or with NPC_COMBAT_IQ off) every line below falls back to the
  // exact old NPC_GUN roll, byte for byte.
  function iq() { return (CBZ.CONFIG.NPC_COMBAT_IQ !== false) ? CBZ.combatIQ : null; }
  // BLOCK LAW #5 — adoption is DECLARED, not sniffed (the predatorAudit lesson).
  // The buffered `else` makes it script-order-proof.
  (function () {
    const ids = ["peds:npc-attack", "peds:fight-band", "peds:rage-engage"];
    if (CBZ.combatIQ && CBZ.combatIQ.adopt) { for (let i = 0; i < ids.length; i++) CBZ.combatIQ.adopt(ids[i]); }
    else { CBZ._combatIQAdopted = (CBZ._combatIQAdopted || []).concat(ids); }
  })();

  /* THE SWING. The beat above says WHEN; the blow is a real strike on his rig
     (CBZ.verbs.strike, systems/verbs_strike.js) that lands on the frame his
     fist reaches the man it was thrown at, or whiffs if that man stepped out
     of it. The damage below is paid only by a blow that landed, scaled by
     where it landed; the reaction (head snap, fold, stagger, a knockdown in
     his own rig) is the verbs'. A body with no human rig here (a remote
     player) is resolved on the blow's beat, by reach. */
  const PED_COMBO = ["jab", "cross", "hook", "jab", "body", "cross", "upper", "cross"];
  function npcSwing(att, tgt, dmg) {
    const V = CBZ.verbs;
    if (!V || !V.strike) return;
    const i = att._pk = ((att._pk | 0) + 1) % PED_COMBO.length;
    const rigless = !!tgt.netHurt || (!tgt.isPlayer && !(tgt.char && tgt.char.parts));
    V.strike(att, tgt, {
      kind: PED_COMBO[i], maxLunge: 0.5,
      onLand: function (res) {
        const t = res.target;
        if (att.dead || !t || t.dead) { res.reaction = "none"; return; }
        punchSfx(att, t);
        // your guard is the city's parry/chip system (city/combat.js wraps
        // cityHurtPlayer): it gets the whole blow and takes its own cut
        hurtActor(att, t, (t.isPlayer && res.blocked) ? dmg : dmg * res.dmgMul, true, res);
      },
      onBeat: rigless ? function () {
        if (att.dead || tgt.dead) return;
        const dx = tgt.pos.x - att.pos.x, dz = tgt.pos.z - att.pos.z;
        if (dx * dx + dz * dz > 2.2 * 2.2) return;         // he moved out of it
        punchSfx(att, tgt);
        hurtActor(att, tgt, dmg, true);
      } : null,
    });
  }
  // Same law as the yard brawl (entities/ai.js): a punch thrown by someone
  // who is not you is world foley, so it goes through CBZ.worldSfx and
  // carries a distance. A street beef three blocks away used to land at
  // full volume in your ear. Player-thrown blows keep CBZ.sfx (city/
  // combat.js) because those genuinely happen where the listener is.
  function punchSfx(att, tgt) {
    if (tgt.isPlayer) { if (CBZ.sfxAt) CBZ.sfxAt("punch", att.pos.x, att.pos.z); }
    else if (CBZ.worldSfx) CBZ.worldSfx("punch", att.pos.x, att.pos.z, { y: att.pos.y });
  }
  function npcAttack(att, tgt, dt) {
    // hands zip-tied behind the back can neither pull a trigger nor throw a
    // punch — restrain.js's enum (ped.restraint) gates EVERY attack, whichever
    // brain (crew, rage, reprisal) routed here. The grappled state already
    // suppressed itself via attackCD; this covers cuffed/escorted/in_vehicle.
    if (att.attackCD > 0 || !tgt || tgt.dead || att.restraint) return;
    const dx = att.pos.x - tgt.pos.x, dz = att.pos.z - tgt.pos.z;
    const dh = Math.hypot(dx, dz);                        // horizontal gap
    // A RIFLE'S RANGE IS THE RIFLE'S. The old flat 26 was the same for a
    // snub-nose and an AK; the profile's own band is what a carrier will
    // actually engage at, and move() holds the matching standoff.
    const IQ = iq();
    const prf = IQ && IQ.profile ? IQ.profile(att) : null;
    const gunReach = prf && prf.cls !== "none" ? prf.hi + 4 : 26;
    if (att.armed && att.ammo > 0 && dh < gunReach) {
      // aim first so the muzzle is oriented, then test a REAL line of fire from the
      // muzzle to the target in 3D (angle + elevation + walls all count).
      if (CBZ.actorAimAt) CBZ.actorAimAt(att, tgt);
      const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(att, tmp) : { x: att.pos.x, y: (att.pos.y || 0) + 1.4, z: att.pos.z };
      const ty = (tgt.pos.y || 0) + (tgt.isPlayer ? 1.5 : 1.3);
      // NO clear line (a wall / roof edge / parapet sits between the muzzle and the
      // target) → the bullet would hit COVER, not the target, so the NPC HOLDS FIRE
      // instead of magically tagging you through geometry. THIS is what makes a
      // rooftop or behind-cover position actually safe from a ground shooter —
      // replacing the old "roll a dice by flat distance" hit that ignored LOS,
      // elevation, and walls entirely.
      // The gate ray starts at the CHEST CENTRE, not the muzzle tip: the
      // movement collider guarantees the chest is outside every wall box,
      // while a muzzle pressed into a facade can start INSIDE (or past) the
      // wall — and a ray born inside a FrontSide box sees only culled back
      // faces, so the wall didn't exist and shots cleared straight through
      // buildings (the filmed shot-through-walls bug). The muzzle stays the
      // tracer/flash origin so the visuals still leave the gun barrel.
      if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(att.pos.x, (att.pos.y || 0) + 1.4, att.pos.z, tgt.pos.x, ty, tgt.pos.z)) {
        att.attackCD = 0.25 + rng() * 0.3;               // brief beat, then re-check for a clean angle
        return;
      }
      // clear line — take the real shot (cadence + damage from the gun's profile).
      const prof = NPC_GUN[att.weapon] || NPC_GUN_DEF;
      const baseDmg = prof.dmg + rng() * prof.dspr;
      // THE FIRE GATE. combat_iq owns the reaction beat, the aim settle and the
      // burst rhythm, and hands back the cooldown THIS field already holds —
      // one timer, not two. It also hands back the per-hit damage scaled so
      // this shooter's DPS lands on its row of the ladder, which is the whole
      // counterweight: a soldier who now hits far more often hits for less.
      const shot = IQ && IQ.shot ? IQ.shot(att, tgt, dh, dt || 0.016, baseDmg) : null;
      if (shot && !shot.fire) { att.attackCD = Math.max(0.05, shot.cd); return; }   // still reacting
      att.attackCD = shot ? shot.cd : (prof.cd + rng() * prof.cspr);
      att.ammo--;
      const to = { x: tgt.pos.x, y: ty, z: tgt.pos.z };
      if (CBZ.tracer) CBZ.tracer(from, to, { muzzleScale: 1.0 });
      else if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
      // the shot SPEAKS its gun (AK bark vs pistol crack) and muffles with distance
      if (CBZ.gunVoice) CBZ.gunVoice(att.weapon, CBZ.player ? Math.hypot(from.x - CBZ.player.pos.x, from.z - CBZ.player.pos.z) : 0);
      else if (CBZ.sfx) CBZ.sfx("report");
      // accuracy falls off with the TRUE 3D distance (a long, steep up-shot is hard;
      // a clean close line lands). LOS is already guaranteed above.
      const d3 = Math.hypot(dh, to.y - from.y);
      // the round is REAL to glass: any intact pane across the lane bursts
      // (force=true, exactly like player fire) — so an NPC's first shot
      // through a showroom front or a half-broken window BREAKS it, and the
      // follow-ups fly through the hole (cityShotHole lets LOS/tracers pass).
      if (CBZ.cityShatterRay) CBZ.cityShatterRay(from.x, from.y, from.z, to.x - from.x, to.y - from.y, to.z - from.z, d3 + 0.6, true);
      const hit = shot ? (rng() < shot.hit) : (rng() < Math.max(0.15, 0.8 - d3 * 0.03));
      if (hit) hurtActor(att, tgt, shot ? shot.dmg : baseDmg, false);
      // INCOMING IS A THING THAT HAPPENS TO YOU. A round that goes past an
      // armed bystander's ear makes THEM shoot worse and want the wall — the
      // one line that turns "covering fire" from a word in a comment into a
      // mechanic. Only ever suppresses the person being shot AT.
      if (IQ && IQ.suppress && tgt.armed && !tgt.isPlayer) IQ.suppress(tgt, 1.4);
      // a round only catches a bystander when it actually traveled the lane (it had
      // LOS); a blocked shot never fires, so there's no phantom crossfire behind cover.
      crossfire(att, tgt, !hit);
      if (att.ammo <= 0) { att.armed = false; att.weapon = null; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(att); }
    } else if (dh < 2.4) {
      // melee — needs a real reach: no clubbing a rooftop target from the street below.
      if (Math.abs((tgt.pos.y || 0) - (att.pos.y || 0)) > 2.2) return;
      // A PUNCH IS AN EXCHANGE (systems/combat_iq.js). This branch used to be
      // three lines — cooldown, sound, damage — with NO wind-up at all, which
      // is exactly why city/combat.js had to fake a telegraph from the outside
      // and why two brawlers stood inside each other trading invisible hits.
      // melee() runs the beat (approach, circle at the edge of reach, guard an
      // incoming swing, telegraph, commit, recover) and returns "swing" on the
      // ONE tick the blow actually lands; everything else is footwork, and the
      // wind-up it raises is the SAME _windup/char.windup the rig and the
      // player's parry window already read.
      // attackCD stays at ZERO between beats on purpose: the FSM advances by the
      // frame dt handed to it, so it must be called every frame or its beats run
      // long by exactly the throttle ratio. (The armed branch above does not need
      // this — posture() ticks that shooter's timers every frame from move().)
      const beat = IQ && IQ.melee ? IQ.melee(att, tgt, dt || 0.016, { reach: 1.85 }) : null;
      if (beat && beat !== "swing") { att.attackCD = 0; return; }
      att.attackCD = 0.5 + rng() * 0.4;
      npcSwing(att, tgt, 16 + rng() * 8);
    } else if (att._iqM && IQ && IQ.meleeReset) {
      IQ.meleeReset(att);                                  // out of the bout — drop the beat state
    }
  }

  // grab the nearest dropped gun (for an unarmed aggressive ped)
  function nearestDrop(x, z, maxd) {
    let best = -1, bd = maxd * maxd;
    for (let i = 0; i < CBZ.cityDrops.length; i++) { const d = CBZ.cityDrops[i]; if (d._taking) continue; const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  // A PED PICKS UP A DROPPED GUN WITH HIS HAND (systems/verbs_pickup.js): he
  // bends to it, the gun leaves the ground in his hand, and he is armed on the
  // grab frame. The drop is claimed at once so nobody else goes for it.
  function pedTakeDrop(ped, di) {
    const d = CBZ.cityDrops[di];
    if (!d || d._taking) return;
    d._taking = true;
    ped._pickingUp = true;
    const took = function () {
      ped._pickingUp = false;
      const j = CBZ.cityDrops.indexOf(d);
      if (j >= 0) removeDrop(j);
      if (ped.dead) return;
      ped.armed = true; ped.weapon = d.weapon; ped.ammo = d.ammo;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(ped, d.mesh || { x: d.x, y: d.y, z: d.z, kind: "gun" }, { pose: "grip", keep: true, onTaken: took });
    else took();
  }

  // ---- nearestActor predicates, at MODULE scope --------------------------
  // These were inline arrows at the call sites, so every rate-gated brain tick
  // in the cast built two fresh closures (the caller's arrow + the scan arrow
  // below) and threw them away. `test(p, self)` hands the predicate the caller
  // it used to capture, which is the only thing any of them closed over.
  function _naChatMate(p) { return p.kind === "civilian" && !p.vendor && p.state !== "flee"; }
  function _naIdleCivilian(p) { return p.kind === "civilian" && !p.vendor && (p.state === "walk" || p.state === "idle"); }
  function _naCop(p) { return p.kind === "cop"; }
  function _naCopHuntingMe(p, self) { return p.kind === "cop" && p.npcTarget === self; }
  function _naWeakerCivilian(p, self) { return !p.vendor && p.kind === "civilian" && p.aggr < self.aggr - 0.15; }
  function _naRivalGang(p, self) { return !!p.gang && p.gang !== self.gang; }
  function _naRampageVictim(p) {
    return !p.dead && !p.rampage && (p.kind === "cop" || (p.kind === "civilian" && !p.companion && !p.controlled));
  }
  // nearest other actor matching a test (peds + cops). Past this radius a cell
  // query touches more cells than the crowd has bodies, so the wide scans
  // (rampage target at 60m, cop calls at 22/30m) stay linear on purpose.
  const NA_GRID_R = 12;
  function nearestActor(self, maxd, test) {
    let best = null, bd = maxd * maxd;
    const sx = self.pos.x, sz = self.pos.z;
    if (_scanOn && maxd <= NA_GRID_R && _collect(_scanBuf, sx, sz, maxd, SCAN_MARGIN)) {
      _audit.gridRoutedCalls++;
      for (let i = 0; i < _scanBuf.length; i++) {
        const p = _scanBuf[i];
        if (p === self || p.dead) continue;
        if (!test(p, self)) continue;
        const dd = (p.pos.x - sx) * (p.pos.x - sx) + (p.pos.z - sz) * (p.pos.z - sz);
        // strict <, plus the roster-order tie-break the linear scan got for free
        if (dd < bd || (dd === bd && best && (p._gi | 0) < (best._gi | 0))) { bd = dd; best = p; }
      }
    } else {
      _audit.linearFallbackCalls++;
      const peds = CBZ.cityPeds;
      _audit.linearVisited += peds.length;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (p === self || p.dead) continue;
        if (!test(p, self)) continue;
        const dd = (p.pos.x - sx) * (p.pos.x - sx) + (p.pos.z - sz) * (p.pos.z - sz);
        if (dd < bd) { bd = dd; best = p; }
      }
    }
    // COPS are their own roster and are not in the ped index — always linear,
    // always AFTER the peds, always strict < : a cop tying a ped still loses.
    const cops = CBZ.cityCops;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (c === self || c.dead) continue;
      if (!test(c, self)) continue;
      const dd = (c.pos.x - sx) * (c.pos.x - sx) + (c.pos.z - sz) * (c.pos.z - sz);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }

  function band(a) { const B = A0(); return a < (B.flee || 0.3) ? "meek" : a < (B.bold || 0.5) ? "wary" : a < (B.crook || 0.72) ? "bold" : a < (B.violent || 0.88) ? "crook" : "violent"; }

  // who is attacking `who`? returns the attacker actor (a ped raging at them, or
  // the player if the player is mid-fight near them). Cheap bounded scan.
  function attackerOf(who) {
    if (!who || who.dead) return null;
    // Only a body that HOLDS a rage can be the answer, so the candidate list is
    // the whole scan: same roster order, same predicate, first match wins.
    const peds = _scanOn ? _rageList : CBZ.cityPeds;
    if (_scanOn) _audit.listRoutedCalls++; else { _audit.linearFallbackCalls++; _audit.linearVisited += peds.length; }
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p === who || p.dead) continue;
      if (p.rage === who) {
        const dx = p.pos.x - who.pos.x, dz = p.pos.z - who.pos.z;
        if (dx * dx + dz * dz < 18 * 18) return p;
      }
    }
    const P = CBZ.player;
    if (P && !P.dead && P._fighting > 0 && CBZ.city && CBZ.city.playerActor) {
      const dx = P.pos.x - who.pos.x, dz = P.pos.z - who.pos.z;
      if (dx * dx + dz * dz < 12 * 12) return CBZ.city.playerActor;
    }
    return null;
  }

  // GROUP REACTION: a ped whose PARTNER/FAMILY is under attack joins in — bold
  // ones rage at the attacker, the meek flee with them. And when several bold
  // peds already share a threat, they mob/flee as a CLUSTER (shared target) so a
  // street fight reads as a crowd, not isolated duels. Bounded + active-gated.
  function groupReact(ped, B) {
    // 1) partner / family in danger
    const kin = ped.partner && !ped.partner.dead ? ped.partner
      : (ped.family && ped.family.length && !ped.family[0].dead ? ped.family[0] : null);
    if (kin) {
      const att = (kin.rage && !kin.rage.dead && kin.rage !== ped) ? kin.rage : attackerOf(kin);
      if (att && att !== ped && !att.dead) {
        const dk = Math.hypot(kin.pos.x - ped.pos.x, kin.pos.z - ped.pos.z);
        if (dk < 26) {
          // the brain answers: a grudge is born (memory, decaying), and fight /
          // flee / freeze is THIS person's own threat response to the attacker
          const CB = CBZ.cityBrain;
          if (CB && CB.adopt(ped)) {
            CB.grudge(ped, att, 0.5);
            const attArmed = att.isPlayer ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!att.armed;
            if (CB.threat(ped, att, att.pos.x, att.pos.z, attArmed, false, "kin")) {
              if (ped.rage === att && att.isPlayer && ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.15);
              return true;
            }
            ped.fear = Math.min(10, ped.fear + 3); ped.alarmed = Math.max(ped.alarmed, 4);
            return false;
          }
          if (ped.aggr >= (B.bold || 0.5)) {
            ped.rage = att; ped.state = "fight"; ped.target.set(att.pos.x, 0, att.pos.z);
            if (att.isPlayer && ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.15);
          } else {
            ped.fear = Math.min(10, ped.fear + 3); ped.alarmed = Math.max(ped.alarmed, 4);
            ped.state = "flee"; fleeFrom(ped, att.pos.x, att.pos.z);
          }
          return true;
        }
      }
    }
    // 2) cluster mob: ≥3 bold peds already raging at the SAME threat near me →
    //    pile on the shared target (only if I'm bold and not already engaged).
    if (ped.aggr >= (B.bold || 0.5) && !ped.rage) {
      // Same superset trade as attackerOf: every body this loop can count is
      // one that holds a rage, and _rageList carries them in roster order — so
      // the `if (!shared)` first-match still picks the same shared threat.
      const peds = _scanOn ? _rageList : CBZ.cityPeds, R2 = 14 * 14;
      if (_scanOn) _audit.listRoutedCalls++; else { _audit.linearFallbackCalls++; _audit.linearVisited += peds.length; }
      let shared = null, n = 0;
      for (let i = 0; i < peds.length; i++) {
        const o = peds[i];
        if (o === ped || o.dead || !o.rage || o.rage.dead || o.state !== "fight") continue;
        if (o.aggr < (B.bold || 0.5)) continue;
        const dx = o.pos.x - ped.pos.x, dz = o.pos.z - ped.pos.z;
        if (dx * dx + dz * dz >= R2) continue;
        if (!shared) shared = o.rage;
        if (o.rage === shared) { n++; if (n >= 3) break; }
      }
      if (shared && n >= 3 && !shared.dead) {
        const ds = Math.hypot(shared.pos.x - ped.pos.x, shared.pos.z - ped.pos.z);
        if (ds < 22) { ped.rage = shared; ped.state = "fight"; ped.target.set(shared.pos.x, 0, shared.pos.z); return true; }
      }
    }
    return false;
  }

  // ---- GANG / REPUTATION awareness (all guarded; null/0 when the gang layer
  //      isn't present). Used by reactToPlayer + turfIntruder to colour how a
  //      ped reads the player: defer to a famous boss, charge a rival, etc. ----
  // the gang id the PLAYER rides with (patched-in membership, founded crew, or
  // a loose affiliation) — null if unaffiliated. All reads guarded.
  function playerGangId() {
    const m = g.cityMembership;
    if (m && m.gangId) return m.gangId;
    if (g.playerGangId) return g.playerGangId;
    if (g.playerGang && g.playerGang.founded) return g.playerGang.id;
    return g.playerGangAffiliation || null;
  }
  // is THIS ped's gang hostile to the player's crew? -1 ally / 0 neutral|none /
  // 1 rival / 2 at open war. Cheap, fully guarded.
  function gangHostility(ped) {
    if (!ped.gang) return 0;
    // FLYING COLORS (outfits.js): cloth reads before allegiance. Wearing a
    // set's colors makes that set read you as kin — and their enemies read
    // you as one of THEM, even if you've never thrown a punch in your life.
    const fly = CBZ.cityOutfitGangId ? CBZ.cityOutfitGangId() : null;
    if (fly) {
      if (ped.gang === fly) return -1;
      if (CBZ.cityAtWar && CBZ.cityAtWar(fly, ped.gang)) return 2;
      if (!playerGangId()) return 1;   // no real crew — the colors ARE your read
    }
    const mine = playerGangId();
    if (!mine) return 0;
    if (ped.gang === mine) return -1;                                  // same crew
    if (CBZ.cityAreAllied && CBZ.cityAreAllied(mine, ped.gang)) return -1;
    if (CBZ.cityAtWar && CBZ.cityAtWar(mine, ped.gang)) return 2;       // open war
    return 1;                                                          // a rival by default
  }
  // did the player recently kill THIS ped's crew? (the gang carries a provoke
  // level the player's violence raises) — combined with witness memory.
  function provokedAtPlayer(ped) {
    return (ped.gang && CBZ.cityGangProvoked) ? CBZ.cityGangProvoked(ped.gang) : 0;
  }
  // standing the player has earned with this ped's gang (-100..100), guarded.
  function playerStandingWith(ped) {
    return (ped.gang && CBZ.cityGangStanding) ? CBZ.cityGangStanding(ped.gang) : 0;
  }

  // ---- the crowd's HOUR is the sky's hour. There is ONE city clock:
  //      core/daynight.js (CBZ.dayPhase 0..1, sunrise at 0, CBZ.dayCount the
  //      sky calendar; a 48-minute city day). This file used to run its own
  //      360 s loop next to the sky's, so the peds' "10am errands", the hitman's watch and the
  //      broker's schedule (all cityHour) drifted off the sun and the morning
  //      paper (dayCount). cityHour is now a VIEW of the sky: hour = phase*24+6.
  //      Passing a number moves the sky itself, so there is nothing to sync.
  function skyHour() {
    const t = CBZ.dayPhase ? CBZ.dayPhase() : 0.14;           // 0.14 ~ 9:22 if the sky is absent
    return ((t * 24 + 6) % 24 + 24) % 24;
  }
  CBZ.cityHour = function (v) {
    if (v != null && isFinite(v) && CBZ.dayPhase) CBZ.dayPhase((((+v - 6) / 24) % 1 + 1) % 1);
    return skyHour();
  };
  function dayPhase() {                                       // coarse phase of life
    const h = skyHour();
    if (h < 6 || h >= 22) return "night";    // sparse, head home
    if (h < 9) return "morning";             // commute to work/shops
    if (h < 12) return "work";
    if (h < 14) return "lunch";              // food/bars/errands
    if (h < 18) return "work";
    return "evening";                        // leisure: bars, parks, home
  }

  // ============================================================
  //  ARCHETYPE ROLES — give every ped a LEGIBLE life. The aggr brain + aigoals
  //  needs-layer already cover the "economic" lives (dealer/addict/worker/gangster
  //  via archetype + needs). This adds the social/flavour roles aigoals doesn't —
  //  jogger, busker, tourist, panhandler, cop-watcher — plus a clean commuter
  //  read, each with a soft purpose LOOP run from think()/microBehaviour. A role
  //  is assigned ONCE (lazily, derived from the existing archetype + personality)
  //  and only SETS goals/pauses/facing — it never hard-forces, defers to the brain,
  //  and never touches handsUp/surrender. Re-derived fresh after a parked recycle
  //  (we clear ped._role there) so a recycled body gets a new life.
  // ------------------------------------------------------------
  //  roles: commuter (the default working life) · vendor (posted) · dealer ·
  //         junkie · jogger · busker · tourist · panhandler · watcher (cop-watcher)
  // ============================================================
  function pedRole(ped) {
    if (ped._role) return ped._role;
    // vendors & gang members keep their hard identity — they're posted / on turf.
    if (ped.vendor) return (ped._role = "vendor");
    if (ped.gang) return (ped._role = ped.archetype === "dealer" ? "dealer" : "gangster");
    const a = ped.archetype;
    // map the existing archetype vocabulary onto a legible street role first
    if (a === "dealer") return (ped._role = "dealer");
    if ((a === "tweaker" || ped.drugUser) && ped.aggr < (A0().crook || 0.72)) return (ped._role = "junkie");
    // otherwise roll a flavour role off personality (deterministic stream). Most
    // people are plain commuters; a sprinkling get a distinctive public life.
    const r = rng();
    if (ped.aggr < (A0().flee || 0.3) && r < 0.10) return (ped._role = "panhandler");   // meek, lingers + begs
    if (r < 0.14) return (ped._role = "jogger");                                          // laps the blocks
    if (r < 0.20 && ped.wealth > 0.5) return (ped._role = "tourist");                     // gawks at landmarks
    if (r < 0.24) return (ped._role = "busker");                                          // posts at a plaza
    if (r < 0.30 && ped.aggr >= (A0().bold || 0.5) && ped.snitch > 0.35) return (ped._role = "watcher"); // cop-watcher
    return (ped._role = "commuter");
  }
  CBZ.cityPedRole = pedRole;     // social.js / hud can read a ped's life

  // nearest lot of a kind (park/plaza/landmark proxy) — cheap bounded scan. Parks
  // double as plazas (buskers draw crowds, tourists photograph, people sit). A
  // "landmark" is just a notable lot: a park, or a tall tower the tourist gawks at.
  function nearestLotKind(A, x, z, kinds, maxd) {
    const lots = A.lots || A.shopLots; if (!lots) return null;
    let best = null, bd = (maxd || 60) * (maxd || 60);
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i]; if (kinds.indexOf(l.kind) < 0) continue;
      const lx = l.cx != null ? l.cx : (l.building && l.building.door ? l.building.door.x : null);
      const lz = l.cz != null ? l.cz : (l.building && l.building.door ? l.building.door.z : null);
      if (lx == null) continue;
      const dd = (lx - x) * (lx - x) + (lz - z) * (lz - z);
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }

  // assign-once a persistent HOME lot a resident drifts back to after dark. Ties
  // to whatever residence is theirs (and, when that building has an owner record,
  // remembers it so the ped reads as a distinct life rather than a random walker).
  function homeLot(ped, A) {
    // HOME BOND (H2): the persistent address a ped drifts back to after dark is
    // OWNED by the housing layer (housing.js stamps ped._digs = their home LOT;
    // aigoals.js's digsLot resolves a leased unit + affordability into it). We
    // only READ it here so the night homeward goal routes to that ONE door every
    // day — no parallel picker (owner rule: extend, don't reinvent). The lease's
    // floor height is stashed on ped._homeFloorY for sleep/arrival logic.
    // Re-validated against the LIVE arena so a stale ref from a recycled rig (or
    // a fresh run) self-heals to a current lot.
    if (A.homeLots && A.homeLots.length) {
      const digs = ped._digs;
      if (digs && digs.building && A.homeLots.indexOf(digs) >= 0) {
        ped._home = digs;
        if (ped._unit && ped._unit.floorY != null) ped._homeFloorY = ped._unit.floorY;
        return digs;
      }
      // housing.js present but no bond yet → let it assign one (stable across the
      // ped's life), then mirror it onto _home. Guarded: absent → old path below.
      if (CBZ.cityHomeOf) {
        const h = CBZ.cityHomeOf(ped);
        if (h && h.building && A.homeLots.indexOf(h) >= 0) {
          ped._digs = h; ped._home = h;
          if (ped._unit && ped._unit.floorY != null) ped._homeFloorY = ped._unit.floorY;
          return h;
        }
      }
    }
    // FALLBACK (no housing layer / no home lots resolved): the original behaviour —
    // re-validate the cached _home, else pick a random home lot once and cache it.
    if (ped._home && ped._home.building && A.homeLots && A.homeLots.indexOf(ped._home) >= 0) return ped._home;
    ped._home = null;
    if (!A.homeLots || !A.homeLots.length) return null;
    ped._home = A.homeLots[(rng() * A.homeLots.length) | 0];
    return ped._home;
  }
  // assign-once a persistent WORK lot. Vendors are posted at their own shop; the
  // rest get a fixed workplace fitting their archetype. When a candidate lot has
  // an owner record (buildings.js stamps lot.building.owner) we keep it tied so
  // the routine reads as "this person works HERE", not a fresh random door daily.
  function workLot(ped, A) {
    if (ped.vendor) { ped._work = ped.vendor; return ped._work; }
    // re-validate the cached workplace still belongs to the live arena (recycled
    // body / new run) before trusting it; otherwise reassign from scratch.
    if (ped._work && ped._work.building && A.shopLots && A.shopLots.indexOf(ped._work) >= 0) return ped._work;
    ped._work = null;
    if (!A.shopLots || !A.shopLots.length) return null;
    // bias the workplace KIND by archetype so lives differ (a trainer works the
    // gym, a hustler the corner, etc). Falls through to any shop if none match.
    const a = ped.archetype;
    const want = a === "merchant" ? null
      : a === "dealer" ? "drugs"
      : a === "addict" ? "drugs"
      : a === "laborer" ? ["hardware", "chop", "carlot"]
      : a === "professional" ? ["bank", "cityhall", "realtor"]
      : a === "student" ? ["electronics", "barber", "clothing"]
      : ["clothing", "food", "gym", "hardware", "electronics"];
    let pool = A.shopLots;
    if (want) {
      const kinds = Array.isArray(want) ? want : [want];
      const m = A.shopLots.filter((l) => kinds.indexOf(l.kind) >= 0 && l.building && l.building.door);
      if (m.length) pool = m;
    }
    pool = pool.filter((l) => l.building && l.building.door);
    if (!pool.length) return null;
    ped._work = pool[(rng() * pool.length) | 0];
    return ped._work;
  }

  // pick a destination weighted by the ped's archetype + the time of day.
  // Returns a goal {x,z,enter?} or null to fall through to the default roll.
  function scheduledGoal(ped, A) {
    if (!A.shopLots || !A.shopLots.length) return null;
    const phase = dayPhase();
    const homeward = phase === "night" || (phase === "evening" && rng() < 0.5);
    // residents have a persistent "home" lot they drift back to after dark
    if (homeward) {
      const h = homeLot(ped, A);
      if (h && !h.demolished) {
        const door = h.building && h.building.door;
        if (door) return { x: door.x, z: door.z, enter: true };
        return { x: h.cx + (rng() - 0.5) * (h.w || 6), z: h.cz + (rng() - 0.5) * (h.d || 6) };
      }
    }
    // work hours: commute to YOUR fixed workplace (not a fresh random door)
    if (phase === "morning" || phase === "work") {
      if (ped.archetype === "merchant") return null;   // vendors are posted; don't pull them
      const w = workLot(ped, A);
      if (w && !w.demolished && w.building && w.building.door) return { x: w.building.door.x, z: w.building.door.z, enter: true };
    }
    // by day, gravitate to the kind of place that fits the hour / archetype
    let prefer = null;
    if (phase === "lunch") prefer = rng() < 0.6 ? "food" : "bar";
    else if (phase === "evening") prefer = ["bar", "casino", "food", "gym"][(rng() * 4) | 0];
    if (prefer) {
      const matches = A.shopLots.filter((l) => l.kind === prefer && !l.demolished);
      if (matches.length) {
        const l = matches[(rng() * matches.length) | 0];
        return { x: l.building.door.x, z: l.building.door.z, enter: true };
      }
    }
    return null;
  }

  // CHEAP MICRO-BEHAVIOURS: tiny soft idle flavour, branched by archetype, so the
  // crowd reads as distinct lives (pause + face a food vendor, sit by a bench,
  // window-shop). Soft only — it sets a short pause / facing, NEVER forces a goal,
  // and bails the instant the ped has anything more important going on. Returns
  // true if it consumed the beat. Runs only for the near/active crowd, rate-gated.
  function microBehaviour(ped, A) {
    if (ped.rage || ped.state === "flee" || ped.state === "fight" || ped.surrender) return false;
    if ((ped._microT || 0) > 0) return false;
    ped._microT = 5 + rng() * 7;                          // long gate: incidental, not constant
    const a = ped.archetype;
    // ---- ROLE FLAVOUR: a legible beat for the distinctive lives. Soft (a pause +
    //      facing, sometimes a queue/chat); always yields, never forces a goal. ----
    const role = pedRole(ped);
    if (role === "busker" && ped._stage) {
      // perform at the stage spot: face the crowd direction + hold; nearby idle
      // peds get nudged to stop and watch (a small gathering, GTA street act).
      const d = Math.hypot(ped.pos.x - ped._stage.x, ped.pos.z - ped._stage.z);
      if (d < 8) {
        ped.pause = Math.max(ped.pause, 2.0 + rng() * 2.0); ped.speed = 0;
        // draw a couple of nearby walkers in to watch (bounded, soft pause only)
        const peds = CBZ.cityPeds; let drawn = 0;
        for (let i = 0; i < peds.length && drawn < 3; i++) {
          const o = peds[i];
          if (o === ped || o.dead || o.vendor || o.rage || o.state === "flee" || o.state === "fight" || o.surrender) continue;
          if (o.guard || o.controlled || o.companion || (o.npcWanted | 0) >= 1) continue;   // don't yank a busy ped off task
          const dx = o.pos.x - ped.pos.x, dz = o.pos.z - ped.pos.z, dd = dx * dx + dz * dz;
          if (dd > 64 || dd < 1) continue;
          faceTo(o, ped.pos.x, ped.pos.z, 1.5);
          o.pause = Math.max(o.pause || 0, 1.2 + rng() * 1.4); o.speed = 0; drawn++;
        }
        return true;
      }
    }
    if (role === "tourist" && ped._snapAt) {
      // stop to "photograph" the landmark: face it, hold a beat (phone-up vibe).
      const d = Math.hypot(ped.pos.x - ped._snapAt.x, ped.pos.z - ped._snapAt.z);
      if (d < 16 && rng() < 0.7) {
        faceTo(ped, ped._snapAt.x, ped._snapAt.z, 1.5);
        ped.state = "film"; ped.pause = Math.max(ped.pause, 1.4 + rng() * 1.6); ped.speed = 0;
        return true;
      }
    }
    if (role === "panhandler" && ped._beg) {
      // linger and beg: barely moves, faces passers-by, occasional bark via social.
      ped.pause = Math.max(ped.pause, 2.5 + rng() * 2.5); ped.speed = 0;
      const mate = nearestActor(ped, 6, _naChatMate);
      if (mate) faceTo(ped, mate.pos.x, mate.pos.z, 1.5);
      return true;
    }
    if (role === "watcher") {
      // cop-watcher: keep eyes on the nearest cop, hold a beat (observing).
      const cop = nearestCop(ped.pos.x, ped.pos.z, 30);
      if (cop && rng() < 0.5) {
        faceTo(ped, cop.pos.x, cop.pos.z, 1.5);
        ped.pause = Math.max(ped.pause, 0.8 + rng() * 1.2); ped.speed = 0;
        return true;
      }
    }
    // who is the nearest food lot / bench-y leisure lot? cheap bounded scan.
    let foodDoor = null, bd = 16 * 16;
    if (A.shopLots) {
      for (let i = 0; i < A.shopLots.length; i++) {
        const l = A.shopLots[i];
        if (l.kind !== "food" && l.kind !== "bar") continue;
        if (l.demolished) continue;
        const d = l.building && l.building.door; if (!d) continue;
        const dd = (d.x - ped.pos.x) * (d.x - ped.pos.x) + (d.z - ped.pos.z) * (d.z - ped.pos.z);
        if (dd < bd) { bd = dd; foodDoor = d; }
      }
    }
    // peckish residents / students linger and face a food spot (smell the grill)
    if (foodDoor && (a === "resident" || a === "student" || a === "laborer") && rng() < 0.5) {
      faceTo(ped, foodDoor.x, foodDoor.z, 1.5);
      ped.pause = Math.max(ped.pause, 1.2 + rng() * 1.5); ped.speed = 0;
      return true;
    }
    // a professional / older soul takes a seat near a park bench (drift to a park
    // edge and rest a beat); others occasionally just stop to people-watch.
    if (rng() < 0.35) {
      // face a nearby park if there is one; else just hold and look around
      let parkC = null, pd = 22 * 22;
      const lots = A.lots || A.shopLots;
      if (lots) for (let i = 0; i < lots.length; i++) {
        const l = lots[i]; if (l.kind !== "park") continue;
        const dd = (l.cx - ped.pos.x) * (l.cx - ped.pos.x) + (l.cz - ped.pos.z) * (l.cz - ped.pos.z);
        if (dd < pd) { pd = dd; parkC = l; }
      }
      if (parkC) faceTo(ped, parkC.cx, parkC.cz, 1.5);
      ped.pause = Math.max(ped.pause, 0.8 + rng() * 1.4); ped.speed = 0;
      return true;
    }
    return false;
  }

  // ROLE PURPOSE LOOP: where does THIS archetype want to be right now? Returns a
  // goal {x,z,enter?} for the flavour roles aigoals doesn't drive, or null to fall
  // through to the schedule / random roll. Pure SET — the brain carries the walk.
  function roleGoal(ped, A) {
    const role = pedRole(ped);
    switch (role) {
      case "jogger": {
        // laps the blocks: hop to a far intersection at a brisk clip (the jog speed
        // boost is applied in move() off the role, so nothing to restore later).
        if (!A.intersections || !A.intersections.length) return null;
        const it = A.intersections[(rng() * A.intersections.length) | 0];
        return { x: it.x + (rng() - 0.5) * 4, z: it.z + (rng() - 0.5) * 4 };
      }
      case "busker": {
        // posts up at the nearest plaza/park and performs (draws a small crowd via
        // the micro-loop). Holds the spot; only re-picks if there's no park at all.
        const park = nearestLotKind(A, ped.pos.x, ped.pos.z, ["park"], 90);
        if (park) { ped._stage = { x: park.cx, z: park.cz }; return { x: park.cx + (rng() - 0.5) * 5, z: park.cz + (rng() - 0.5) * 5 }; }
        return null;
      }
      case "tourist": {
        // ambles between landmarks (parks + towers) to "photograph" them. Picks a
        // notable lot a little away so they actually traverse the city.
        const lm = nearestLotKind(A, ped.pos.x, ped.pos.z, ["park", "tower"], 120);
        if (lm) {
          const lx = lm.cx != null ? lm.cx : lm.building.door.x, lz = lm.cz != null ? lm.cz : lm.building.door.z;
          ped._snapAt = { x: lx, z: lz };
          return { x: lx + (rng() - 0.5) * 8, z: lz + (rng() - 0.5) * 8 };
        }
        return null;
      }
      case "panhandler": {
        // AFTER DARK the homeless head HOME: begging dries up when the marks
        // go in, so the camps (props.js fires/tents — CBZ.cityCamps) gather
        // their people around the flames. Sells the night-time projects as a
        // real place — and puts bodies exactly where the fires now glow.
        if (_nightShift && ped.vagrant) {
          const camp = campNear(ped.pos.x, ped.pos.z, 150);
          if (camp) {
            ped._beg = { x: camp.x, z: camp.z };
            const a = rng() * 6.28, rr = 0.8 + rng() * (camp.r || 4);
            return { x: camp.x + Math.cos(a) * rr, z: camp.z + Math.sin(a) * rr };
          }
        }
        // lingers near a busy spot (a shop door / plaza) and begs — barely moves.
        const spot = nearestLotKind(A, ped.pos.x, ped.pos.z, ["park"], 50)
          || (A.shopLots && A.shopLots.length ? A.shopLots[(rng() * A.shopLots.length) | 0] : null);
        if (spot && spot.demolished) return null;    // don't beg at a rubble pile
        if (spot) {
          const sx = spot.cx != null ? spot.cx : spot.building.door.x, sz = spot.cz != null ? spot.cz : spot.building.door.z;
          ped._beg = { x: sx, z: sz };
          return { x: sx + (rng() - 0.5) * 6, z: sz + (rng() - 0.5) * 6 };
        }
        return null;
      }
      case "watcher": {
        // cop-watcher / vigilante: drifts toward the nearest cop or a recent crime
        // to keep an eye on the street. The reactive crime-response lives in think().
        const cop = nearestCop(ped.pos.x, ped.pos.z, 70);
        if (cop) return { x: cop.pos.x + (rng() - 0.5) * 10, z: cop.pos.z + (rng() - 0.5) * 10 };
        return null;
      }
      case "clubgoer": {
        // a night life (dealt by the hour-cast): drawn to the ONE velvet rope.
        // club.js drafts its line from whoever stands near it, so steering
        // dressed-up bodies to the rope makes the queue a NIGHT thing without
        // club.js ever knowing the hour. Dawn washes the role off.
        if (!_nightShift) { ped._role = null; return null; }
        const rope = clubRope(A);
        if (rope) return { x: rope.x + (rng() - 0.5) * 7, z: rope.z + (rng() - 0.5) * 7 };
        return null;
      }
      default: return null;     // commuter / vendor / dealer / junkie → schedule+brain
    }
  }

  // ---- routine waypoint picking (route through an intersection to cross) ----
  function pickRoutineGoal(ped) {
    const A = CBZ.city.arena;
    // ===== SCHED-1: EMERGE first-leg ========================================
    // A place-spawned resident (SPAWN-1 / H5 set ped._emerge at their home door)
    // first walks a SHORT leg AWAY from that door into the street — so they read
    // as "just left home" before falling into the normal commute. ONE-SHOT and
    // SOFT (owner rule: no force-routing): we clear the flag here, set a brief
    // direct goal a few metres off the door, then release to normal AI next time.
    if (ped._emerge) {
      ped._emerge = false; ped._goalKind = null;
      const home = ped._home || ped._digs;
      const door = home && home.building && home.building.door;
      if (door) {
        // outward from the door (door.nx/nz is the INWARD normal) a few metres.
        const ox = door.nx != null ? -door.nx : (ped.pos.x - door.x);
        const oz = door.nz != null ? -door.nz : (ped.pos.z - door.z);
        const m = Math.hypot(ox, oz) || 1;
        const gx = ped.pos.x + (ox / m) * (4 + rng() * 3), gz = ped.pos.z + (oz / m) * (4 + rng() * 3);
        ped.finalGoal = { x: gx, z: gz };
        ped.path = [ped.finalGoal];
        ped.target.set(gx, 0, gz);
        ped.pause = 0.2 + rng() * 0.5;
        ped.state = "walk";
        return;
      }
      // no door → nothing to emerge from; fall through to a normal goal.
    }
    // OFFICE COMMUTER (SCHED-1): a place-spawned office worker (ped._claimDesk)
    // ends up SEATED at a real desk via the existing officejobs plumbing rather
    // than milling — reuse cityClaimDesk (don't reinvent seating). One-shot: the
    // sit-routing in move() (finalGoal.sitDesk) carries it the rest of the way.
    if (ped._claimDesk && CBZ.cityClaimDesk && (dayPhase() === "morning" || dayPhase() === "work")) {
      const desk = CBZ.cityClaimDesk(ped);
      if (desk) {
        ped._claimDesk = false;
        ped.finalGoal = { x: desk.x, z: desk.z, sitDesk: true, anchor: desk };
        const dGoal = Math.hypot(desk.x - ped.pos.x, desk.z - ped.pos.z);
        if (dGoal > A.step * 0.9) {
          const it = A.nearestIntersection(desk.x, desk.z);
          ped.path = [{ x: it.x + (rng() - 0.5) * 3, z: it.z + (rng() - 0.5) * 3 }, ped.finalGoal];
        } else ped.path = [ped.finalGoal];
        ped.target.set(ped.path[0].x, 0, ped.path[0].z);
        ped.pause = 0.3 + rng() * 0.8;
        ped.state = "walk";
        return;
      }
    }
    const r = rng();
    // a flavour-role destination first (jogger laps / busker stage / tourist
    // landmark / panhandler corner / watcher near a cop); falls through to the
    // day-schedule, then the generic random roll. Roles only win some of the time
    // so they still keep the commute rhythm and don't feel on rails.
    let goal = (rng() < 0.7 ? roleGoal(ped, A) : null);
    if (!goal) goal = scheduledGoal(ped, A);     // try a time-of-day destination
    if (!goal) {
      if (r < 0.25 && A.shopLots && A.shopLots.length) {
        const l = A.shopLots[(rng() * A.shopLots.length) | 0];
        if (l.demolished) { const p = A.randomSidewalkPoint(); goal = { x: p.x, z: p.z }; }
        else goal = { x: l.building.door.x, z: l.building.door.z, enter: true };
      }
      else if (r < 0.4 && A.lots) { const l = A.lots[(rng() * A.lots.length) | 0]; goal = { x: l.cx + (rng() - 0.5) * l.w, z: l.cz + (rng() - 0.5) * l.d }; }
      else { const p = A.randomSidewalkPoint(); goal = { x: p.x, z: p.z }; }
    }
    ped.finalGoal = goal;
    // 2-hop route: cross at the nearest intersection first if the goal is far
    const dGoal = Math.hypot(goal.x - ped.pos.x, goal.z - ped.pos.z);
    if (dGoal > A.step * 0.9) {
      const it = A.nearestIntersection(goal.x, goal.z);
      ped.path = [{ x: it.x + (rng() - 0.5) * 3, z: it.z + (rng() - 0.5) * 3 }, goal];
    } else ped.path = [goal];
    ped.target.set(ped.path[0].x, 0, ped.path[0].z);
    ped.pause = 0.5 + rng() * 2;
  }

  // ---- COMPANION brain: recruited crew that travels with you (Minecraft-dog
  //      style — close by, not glued), and shoots threats to defend you. ----
  function companionFollowPoint(ped, P) {
    const dx = ped.pos.x - P.pos.x, dz = ped.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    return { x: P.pos.x + (dx / d) * 3.4, z: P.pos.z + (dz / d) * 3.4 };   // hold ~3.4m off you
  }
  function companionThreat(ped) {
    const P = CBZ.player, PA = CBZ.city.playerActor;
    // SIC: the man you pointed him at (city/boarding.js orderOn "sic")
    const sic = ped._sicOn;
    if (sic && !sic.dead && !(sic.ko > 0) && !sic.surrender) return sic;
    let best = null, bd = 26 * 26;
    if ((g.wanted | 0) >= 1 && CBZ.cityCops) {                 // cops, while you're wanted
      for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - ped.pos.x, dz = c.pos.z - ped.pos.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = c; } }
    }
    for (const p of CBZ.cityPeds) {                            // anyone attacking YOU
      if (p.dead || p === ped || p.recruited) continue;
      if (p.rage === PA || p.rage === P) { const dx = p.pos.x - ped.pos.x, dz = p.pos.z - ped.pos.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = p; } }
    }
    return best;
  }
  function companionThink(ped, dt, active) {
    const P = CBZ.player;
    // BOARDING / ORDERS OWN THE BODY (city/boarding.js). A companion walking to
    // a car door, sitting in a seat, holding a spot you told him to hold or
    // hauling a duffel is not "following you" — and the old radial hold would
    // fight every one of those for `target` at 15 Hz. One line, feature-
    // detected: with boarding.js absent this reads exactly as it always did.
    if (CBZ.boardingHolds && CBZ.boardingHolds(ped)) return;
    ped.fear = 0; ped.alarmed = 0; ped.surrender = false; ped.rage = null;   // never panic/flee
    if (!ped.armed) { ped.armed = true; ped.weapon = ped.weapon || "Pistol"; ped.ammo = ped.ammo || 999; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); }
    if (ped.ammo < 6) ped.ammo = 999;                          // crew never runs dry (they're on payroll)
    if (!P || P.dead) { ped.state = "walk"; ped.target.set(ped.pos.x, 0, ped.pos.z); ped.path = null; return; }
    const threat = companionThreat(ped);
    // THE CREW HAS NERVE TOO (brain morale, group "crew:player"): lose enough
    // of your people and a shaky one stops trading shots and falls back
    // behind you, out of the line — until the fight turns (the brain's rally
    // band) or it ends. Payroll buys loyalty, not immortality.
    if (threat && !threat.dead && CBZ.cityBrain && CBZ.cityBrain.broken(ped)) {
      const ax = P.pos.x - threat.pos.x, az = P.pos.z - threat.pos.z, al = Math.hypot(ax, az) || 1;
      ped.state = "flee"; ped.path = null;
      ped.target.set(P.pos.x + (ax / al) * 7, 0, P.pos.z + (az / al) * 7);
      if (!ped._routSaid) { ped._routSaid = true; if (CBZ.citySay) CBZ.citySay(ped, "Too many. Back up!", null, 2.2); }
      return;
    }
    ped._routSaid = false;
    if (threat && !threat.dead) {
      ped.state = "walk";
      faceTo(ped, threat.pos.x, threat.pos.z, 1.5);
      const d = Math.hypot(threat.pos.x - ped.pos.x, threat.pos.z - ped.pos.z);
      ped.target.set(d > 13 ? threat.pos.x : ped.pos.x, 0, d > 13 ? threat.pos.z : ped.pos.z);   // close to ~13m, then hold + fire
      // your crew fights with the same competence model everyone else does —
      // posture writes the cover/standoff point over the plain hold above.
      if (CBZ.combatIQ && CBZ.combatIQ.posture && CBZ.CONFIG.NPC_COMBAT_IQ !== false && ped.armed) {
        CBZ.combatIQ.posture(ped, threat, dt);
      }
      npcAttack(ped, threat, dt);
      // STOP TO SHOOT applies to the payroll too (combat_iq 3c): mid-burst, or
      // planted on the position posture just committed, a companion freezes
      // its feet instead of strafing through its own tracer stream. Writing
      // the goal onto the body is the companion-safe way to halt — move()'s
      // fight branch (and its speed gate) never runs for a state-held 'walk'.
      if (CBZ.combatIQ && CBZ.combatIQ.moveGate && ped.armed) {
        const mg = CBZ.combatIQ.moveGate(ped, threat, d, "fire");
        if (mg && mg.halt) ped.target.set(ped.pos.x, 0, ped.pos.z);
      }
    } else {
      ped.state = "walk";
      const d = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
      /* THE CATCH-UP WARP, AND WHY IT IS NO LONGER ALLOWED TO LAND ON YOU.
         This was `ped.pos.set(P.pos.x + 3, 0, P.pos.z)` — three metres from
         the player, unconditionally. While you DRIVE, `P.pos` is the car's
         position, so a crew member who fell behind rematerialised inside the
         car you were sitting in, in full view, every time. That is one of the
         three things the owner filmed as "glitch into car".
         Two rules now: never while the player is in a vehicle at all (get in
         properly, through city/boarding.js, or stay where you are and follow),
         and never inside the padded screen projection — `npcTransitionSafe` is
         the shared contract for "the player could watch this happen" and it is
         strictly stronger than a yaw cone. A refused warp simply retries. */
      if (d > 60 && !P.driving && !P._aircraft) {
        const wx = P.pos.x + 3, wz = P.pos.z;
        const safe = CBZ.npcTransitionSafe ? CBZ.npcTransitionSafe(wx, wz) : true;
        if (safe) ped.pos.set(wx, 0, wz);
      }
      if (d > 4.5) { const fp = companionFollowPoint(ped, P); ped.target.set(fp.x, 0, fp.z); }
      else { ped.target.set(ped.pos.x, 0, ped.pos.z); faceTo(ped, P.pos.x, P.pos.z, 1.5); }
    }
    ped.path = null;
  }
  CBZ.cityCompanionThink = companionThink;

  // ============================================================
  //  WITNESS REPORTING — the ONLY path to a wanted level. wanted.js tags
  //  nearby peds (witnessSev/witnessType/mem=playerActor) when YOU commit a
  //  crime; this code decides whether each tagged ped actually SNITCHES, and if
  //  so makes them physically pull a phone (a timer + a visible tell) OR RUN to
  //  the nearest cop. Only on completion do we call cityReport(). Kill or scare
  //  the reporter before it lands and the report never happens (RDR2-style).
  // ============================================================

  // The floating phone/snitch emoji that used to hover over a reporting ped's
  // head was a fourth-wall break (the only hovering text allowed in-world is the
  // Lv.N level/title head tag). It's gone — the snitch BEHAVIOR (running to a cop
  // or standing to dial) reads on its own. Kept as a no-op so every call site +
  // the clearTell teardown stay valid without touching the report logic.
  function showTell(ped, emoji) { /* no floating emoji over heads — fourth wall */ }
  function clearTell(ped) {
    if (ped.phoneSprite) { if (ped.phoneSprite.parent) ped.phoneSprite.parent.remove(ped.phoneSprite); ped.phoneSprite = null; }
  }

  // ============================================================
  //  GESTURE LEGIBILITY — one raised arm is FOUR different sentences on this
  //  street: dialing 911, filming you, pointing you out to an officer, saying
  //  hello to a friend. From ten metres they were the same silhouette, because
  //  none of them CARRIED its meaning — nothing in the hand, nothing in the
  //  body, nothing aimed at anybody. A gesture whose meaning you have to be
  //  told is a gesture that isn't there.
  //
  //  This flag owns three answers, and they are all physical rather than
  //  cosmetic: a phone that EXISTS in the dialing hand (so the arm is holding
  //  something, not saluting), a snitch who gives you his SHOULDER while he
  //  talks to the operator and checks back over it (which is what a person
  //  reporting you actually does with their body), and a point-out that keeps
  //  its aim on you for as long as the arm is out (a point that drifts off
  //  mid-sentence is a man with a sore shoulder).
  //
  //  OFF = the exact arm rotations that shipped, no prop ever built, no facing
  //  ever written. One-line revert.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_GESTURE_LEGIBILITY == null) CBZ.CONFIG.CITY_GESTURE_LEGIBILITY = true;
  function legible() { return !CBZ.CONFIG || CBZ.CONFIG.CITY_GESTURE_LEGIBILITY !== false; }

  // ---- THE PHONE ITSELF ------------------------------------------------------
  //  ONE geometry pair and ONE material pair for the entire city — a phone is a
  //  phone — tagged `_shared` so the rig-disposal traversals (clearCityPeds,
  //  removeVendor) skip them exactly the way they already skip every other
  //  shared cache entry. CBZ.mat() hands back a FRESH material per call (cmat()
  //  is the cached one), so these two are ours to keep and are never mutated
  //  after they are built: no global cache is touched, and no other prop in the
  //  city can be tinted by an emissive we set here.
  //
  //  The per-ped part is a Group parented under character.js's right-hand
  //  SOCKET (`ch.sockets.rightHand`, a child of the elbow node), so it rides
  //  whatever the arm pose does for free — no per-frame transform, no second
  //  animation path, no chance of the prop and the hand disagreeing. Built once
  //  on demand and then shown/hidden; a witness who dials twice builds once.
  let _phGeo = null, _phScrGeo = null, _phMat = null, _phScrMat = null;
  function phoneAssets() {
    if (_phGeo) return;
    // SIZED TO THE CHARACTER, NOT TO A TAPE MEASURE. A real 142 mm handset is
    // correct and unreadable: these bodies are stylised up — the head alone is
    // most of half a metre — so a life-size phone disappears inside a fist that
    // is itself the size of a real forearm. The storyboard (visual:npc-gestures)
    // caught it as a dark splinter you had to be told was a phone. Scaled to
    // read at conversational distance instead, which is the only distance this
    // gesture is ever seen from.
    _phGeo = new THREE.BoxGeometry(0.150, 0.285, 0.034); _phGeo._shared = true;
    _phScrGeo = new THREE.BoxGeometry(0.115, 0.225, 0.007); _phScrGeo._shared = true;
    _phMat = CBZ.mat(0x15181e); _phMat._shared = true;
    // a screen is a LIT surface, which is the whole reason a phone reads at
    // dusk from across a street. Faint on purpose — this is a handset, not a
    // torch, and the city's night look is not ours to brighten.
    _phScrMat = CBZ.mat(0xbfe2ff, { emissive: 0x3f78a8, ei: 0.85 }); _phScrMat._shared = true;
  }
  function phoneOf(ped) {
    const ch = ped.char;
    const sock = ch && ch.sockets && (ch.sockets.rightHand || ch.sockets.weapon);
    if (!sock) return null;                       // gore took the arm — no hand, no phone
    const cur = ped._phoneProp;
    if (cur && cur.parent === sock) return cur;   // same rig, same socket: reuse
    phoneAssets();
    const grp = new THREE.Group();
    const shell = new THREE.Mesh(_phGeo, _phMat);
    const screen = new THREE.Mesh(_phScrGeo, _phScrMat);
    screen.position.z = 0.021;                    // proud of the shell face — never coplanar
    grp.add(shell, screen);
    // gripped in the fist and STRADDLING it, long axis continuing the forearm —
    // the way a handset actually sits in a hand, earpiece proud of the knuckles
    // and mouthpiece below them. At the ear that lands the phone against the
    // head; in the two-handed film pose the same transform reads as a phone
    // held up at you, which is why there is only one transform.
    // …and carried further PROUD of the knuckles for the same reason: seated
    // deep in the fist, the hand block ate everything but one edge of it.
    grp.position.set(0.024, 0.000, 0.050);
    // …and turned a quarter round in the grip. Growing it did nothing at first
    // and the storyboard said why: with the slab's face along the socket's z,
    // the hand-to-EAR rotation (ra -0.55/-0.55/-0.35, elbow -2.35) carries that
    // face straight down the view axis, so a phone three times bigger was still
    // photographed as a 3 cm dark splinter above a fist. A quarter turn puts
    // the broad face across the head — the plate the whole gesture depends on —
    // and the earpiece/mouthpiece axis is unchanged, so the grip still reads.
    grp.rotation.y = Math.PI / 2;
    grp.visible = false;
    sock.add(grp);
    ped._phoneProp = grp;
    return grp;
  }

  // HEAD YAW IS A SHARED CHANNEL. systems/reactions.js (hyOff) and
  // systems/facial.js (addYaw) both ADD their offset and subtract the same
  // number back; anybody who assigns it absolutely bakes a permanent crick into
  // whoever wrote it last. So the snitch's glance rides its own booked offset
  // under the same contract — add ours, remember ours, back ours out.
  // The booked offset remembers WHICH neck it was added to, so a rig that gets
  // rebuilt under us can never be handed a refund it was never charged — the
  // old head goes to the garbage collector wearing the crick, which is the only
  // place a crick is free. `_glanceNk` is dropped the moment the offset is zero,
  // so we never hold a disposed node alive.
  function glanceAt(ped, want) {
    const nk = ped.char && ped.char.neck;
    if (!nk) { ped._glanceY = 0; ped._glanceNk = null; return; }
    if (ped._glanceY && ped._glanceNk === nk) nk.rotation.y -= ped._glanceY;
    ped._glanceY = want || 0;
    ped._glanceNk = ped._glanceY ? nk : null;
    if (ped._glanceY) nk.rotation.y += ped._glanceY;
  }

  // nearest live cop to a point (for run-to-report)
  function nearestCop(x, z, maxd) {
    let best = null, bd = (maxd || 200) * (maxd || 200);
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (c.dead) continue; const dd = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  // THE WITNESS PIPELINE IS CBZ.brain's (city/brain_city.js). Who saw it, who
  // calls, when the call lands and whether the player can still stop it are
  // decided there: social.crime picks the witnesses by sight and hearing, the
  // city's omerta thins the callers, brain_city shows the call (phone at the
  // ear, shoulder turned / a run to the nearest cop) and the brain's onReport
  // is the landing the CITY LAW router turns into stars. What stays HERE is
  // the body: the gesture teardown every stopped or landed call runs.
  function endReportVisual(ped) {
    ped.reportState = null; ped.reportTarget = null; ped.reportT = 0; ped._vendetta = false;
    clearTell(ped);
    glanceAt(ped, 0);         // give the head back (booked additive channel)
  }
  CBZ.cityEndReportVisual = endReportVisual;
  // stop a call: scared off, knocked out, killed, grabbed. Silences the brain's
  // witness too, so a stopped call can never land later.
  function cancelReport(ped) {
    if (CBZ.cityBrain) CBZ.cityBrain.cancelWitness(ped, "stopped");
    if (ped.reportState) endReportVisual(ped);
  }
  CBZ.cityCancelReport = cancelReport;   // combat.js can stop a snitch by force

  // ============================================================
  //  UNIVERSAL REACTIVITY — a believable, emergent reaction to the PLAYER, so the
  //  city isn't a ghost world of dumb walkers. Only fires for a calm-ish nearby
  //  ped that ISN'T already fleeing/fighting/guarding/reporting. Picks ONE intent
  //  from a personality+context spectrum and drives it into existing states:
  //    KILL (rage) · BEAT-DOWN (fists rage) · STEAL/pickpocket (sneak→lift cash) ·
  //    WORK-for-you (walk up + offer) · TRADE/barter (buy/sell/swap an item) ·
  //    DEAL/drugs (product, not goods) · TALK/favor · FLEE · IGNORE.
  //  UTILITY-SCORED (IAUS-style, matching aigoals.js' need-scoring shape): every
  //  candidate verb gets ONE cheap consideration score from personality (aggr/
  //  archetype/snitch) × gang stance × ped.relPlayer (fear/grudge/loyalty/respect)
  //  × opportunity (distance/cash/hot), then we weighted-pick among the top few —
  //  same DECISION SHAPE as the old if-chain, just scored instead of sequential,
  //  so a strong personality fit can win even if it isn't first in some fixed
  //  order. Cheap: a handful of multiplies per ped per decision tick (reactCD
  //  gates how often this runs at all — never per frame).
  // ============================================================
  function citySayBark(ped, txt, secs) {
    // a brief player-facing line over the ped's own head (CBZ.speech via
    // citySay); throttled by the caller via reactCD. No HUD fallback.
    if (CBZ.citySay && ped && ped.group) CBZ.citySay(ped, txt, null, secs || 2.4);
  }
  // the line comes from the ONE book (city/read.js cityLine): what just
  // happened, who they are, who you are, what you did to them, the hour.
  function sayTopic(ped, topic, secs) {
    const s = CBZ.cityLine ? CBZ.cityLine(ped, topic) : null;
    if (s) citySayBark(ped, s, secs);
  }
  // a ped that reached the player lifts some cash (the NPC-initiated mirror of the
  // player's own pickpocket verb in interact.js). Light touch; turns you hot-ish.
  function pedSteal(ped) {
    const P = CBZ.player;
    const have = g.cash | 0;
    const take = Math.max(5, Math.min(have, 15 + ((rng() * 60) | 0)));
    if (take > 0 && CBZ.city) { CBZ.city.addCash(-take); ped.cash = (ped.cash || 0) + take; }
    ped.stoleT = 0;
    CBZ.city && CBZ.city.note("" + ped.name + " lifted $" + take + " off you!", 1.8);
    if (CBZ.sfx) CBZ.sfx("coin");
    // now they BOLT with your money; chase them down to get it back
    ped.state = "flee"; fleeFrom(ped, P.pos.x, P.pos.z); ped.reactCD = 8;
    ped.snitch = Math.min(ped.snitch, 0.1);   // a thief won't also call the cops on you
  }
  // TRADE / barter — the GENERIC street swap, distinct from DEAL (which is always
  // drugs, see goDeal/pedDealOffer-style flavour below): an ordinary vendor-ish or
  // opportunist civilian offers to buy something off you, sell you something they're
  // carrying, or — if both sides have goods — swap. Hooks the existing economy
  // (CBZ.cityEcon — the same ITEMS/valuables/loot vocabulary cityRobPed/rollDeadLoot
  // already use), so it's real inventory movement, not a flavour-text no-op. Fully
  // guarded: a no-op (graceful bail) if cityEcon isn't loaded.
  function pedTrade(ped) {
    const econ = CBZ.cityEcon;
    if (!econ) { sayTopic(ped, "tapped", 1.4); ped.reactCD = Math.max(ped.reactCD, 6); return; }
    const haveInv = g.cityInv || {};
    const invKeys = []; for (const k in haveInv) if (haveInv[k] > 0) invKeys.push(k);
    // what THEY carry that's tradeable (their rolled loot/valuables — same pool a
    // robbery would take, just offered willingly here instead of lifted by force).
    const theirGoods = [];
    if (ped.loot) theirGoods.push(ped.loot);
    if (ped.valuables && ped.valuables.length) for (const v of ped.valuables) if (v) theirGoods.push(v);
    // SELL TO YOU: they have something, you have room/cash — a street price, a
    // little above pawn value (their cut for carrying the risk).
    const canSell = theirGoods.length > 0 && (g.cash | 0) >= 15;
    // BUY FROM YOU: you're holding something sellable and they want it (a fence-ish
    // opportunist will take valuables/wearables off your hands at a haircut).
    let buyTarget = null;
    if (invKeys.length) {
      for (const k of invKeys) {
        const it = econ.ITEMS && econ.ITEMS[k];
        if (it && (it.tag === "valuable" || it.tag === "wearable" || it.tag === "tool")) { buyTarget = k; break; }
      }
    }
    if (canSell && (!buyTarget || rng() < 0.5)) {
      const item = theirGoods[(rng() * theirGoods.length) | 0];
      const ask = Math.max(10, Math.round((econ.buyPrice ? econ.buyPrice(item) : 40) * (0.55 + rng() * 0.35)));
      const price = Math.min(ask, g.cash | 0);
      if (price >= 10) {
        if (CBZ.city) CBZ.city.addCash(-price);
        econ.add(item, 1);
        // it left their hands — don't let rollDeadLoot/cityRobPed double-grant it later
        if (ped.loot === item) ped.loot = null;
        else if (ped.valuables) { const idx = ped.valuables.indexOf(item); if (idx >= 0) ped.valuables.splice(idx, 1); }
        ped.cash = (ped.cash || 0) + price;
        CBZ.city && CBZ.city.note("Bought " + item + " off " + (ped.name || "a local") + " for $" + price, 2);
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.cityRelShift) CBZ.cityRelShift(ped, "greeted", 1);
      } else { citySayBark(ped, "Can't do it for that.", 1.6); }
    } else if (buyTarget) {
      const it = econ.ITEMS && econ.ITEMS[buyTarget];
      const offer = Math.max(5, Math.round((econ.sellPrice ? econ.sellPrice(buyTarget) : ((it && it.value) || 20) * 0.45) * (0.7 + rng() * 0.3)));
      if (econ.take(buyTarget, 1)) {
        if (CBZ.city) CBZ.city.addCash(offer);
        CBZ.city && CBZ.city.note("Sold " + buyTarget + " to " + (ped.name || "a local") + " for $" + offer, 2);
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.cityRelShift) CBZ.cityRelShift(ped, "greeted", 1);
      }
    } else {
      sayTopic(ped, "tapped", 1.8);
    }
    ped.reactCD = 16 + rng() * 10;
  }

  // ---- VIOLENT TELEGRAPH (the "tell"): KILL/BEAT-DOWN no longer convert
  // straight to ped.state="fight" in one frame — that read as an instant
  // ambush. Instead a short 0.3-0.6s wind-up plays first: the ped squares up
  // (poseAimBack — the same gun-arm-levelled pose the gunpoint sweep already
  // uses), barks a hostile line, and HOLDS at range in "confront" (closes in
  // if still far, but doesn't throw a punch / open fire yet) — readable as a
  // deliberate personality decision instead of a sucker-punch. tickViolentWindup
  // (called every think()) counts it down and commits to the real "fight"
  // state (+ ped.rage) once it elapses. A windup ped that takes damage or
  // loses its target along the way just falls through to the normal hurt/rage
  // handling next frame — nothing here can leave a ped stuck.
  function beginViolentWindup(ped, kind) {
    ped._windup = kind;                          // "kill" | "beat"
    ped._windupT = 0.3 + rng() * 0.3;             // 0.3-0.6s tell
    ped.state = "confront";
    ped.target.set(CBZ.player.pos.x, 0, CBZ.player.pos.z);
    ped.poseAimBack = ped.armed || kind === "kill";   // weapon-draw / squared-up posture
    ped.reactCD = kind === "kill" ? 9 : 7;
    sayTopic(ped, kind === "kill" ? "windupKill" : "windupBeat", 1.6);
  }
  // ticked from think() every frame a windup is live (cheap: a couple of field
  // writes; the actual commit only happens once when the timer crosses zero).
  function tickViolentWindup(ped, dt) {
    if (!ped._windup) return false;
    const P = CBZ.player;
    if (P.dead || !ped.target) { ped._windup = null; ped.poseAimBack = false; return false; }
    // you drew while he was squaring up to beat you: fists do not walk at a gun
    if (ped._windup === "beat" && !(ped.armed || ped._holster) && CBZ.cityHasGun && CBZ.cityHasGun()) {
      ped._windup = null; ped.poseAimBack = false; ped.reactCD = 8;
      ped.state = "flee"; fleeFrom(ped, P.pos.x, P.pos.z);
      return true;
    }
    ped.target.set(P.pos.x, 0, P.pos.z);
    faceTo(ped, P.pos.x, P.pos.z, 1.5);
    const d = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
    // a beat-down windup walks in close; a kill windup squares up where it stands
    // (it likely already has the range — armed peds don't need to close).
    ped.speed = (ped._windup === "beat" && d > 2.2) ? ped.baseSpeed * 1.4 : 0;
    ped._windupT -= dt;
    if (ped._windupT <= 0 || d > 18) {            // timer's up, or they bolted — commit/abort
      const kind = ped._windup; ped._windup = null; ped.poseAimBack = false;
      if (d > 18) { ped.state = "walk"; return true; }   // lost them — stand down quietly
      ped.rage = CBZ.city.playerActor; ped.state = "fight";
      if (kind === "beat" && CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "assault");
      return true;
    }
    return true;
  }

  // returns true if a reaction was chosen (think() should return immediately).
  function reactToPlayer(ped, dpl, playerArmed, bnd) {
    const P = CBZ.player, B = A0();
    if (P.dead) { ped.approach = null; return false; }
    // a reaction "intent" already in flight: an approacher walking up to you.
    // (runs even on cooldown — the cooldown only gates picking a NEW intent.)
    if (ped.approach) {
      if (dpl > 16) { ped.approach = null; return false; }   // you walked off — drop it
      // a timid approacher (not here to BEAT you) bails if you suddenly draw a gun
      // and a man walking up to BEAT you with his fists does not keep walking
      // at a gun (CBZ.brain.threat: against a gun only a gun fights)
      if (playerArmed && (ped.approach === "beat" ? !(ped.armed || ped._holster) : ped.aggr < (B.crook || 0.72))) {
        ped.approach = null; ped.reactCD = 6; ped.state = "flee"; fleeFrom(ped, P.pos.x, P.pos.z); return true;
      }
      ped.path = null; ped.pause = 0;
      ped.target.set(P.pos.x, 0, P.pos.z); ped.state = "walk";
      faceTo(ped, P.pos.x, P.pos.z, 1.5);
      ped._approachT -= 0.12;
      if (dpl < 2.2 || ped._approachT <= 0) {
        const intent = ped.approach; ped.approach = null; ped.speed = 0;
        ped.reactCD = 5 + rng() * 5;
        if (dpl >= 2.6) return true;          // never reached you — give up quietly
        if (intent === "steal") { pedSteal(ped); return true; }
        if (intent === "beat") { beginViolentWindup(ped, "beat"); return true; }
        if (intent === "work") {
          ped.wantsWork = 12;                 // interact.js can read this; bark either way
          sayTopic(ped, "askWork", 2.2);
          return true;
        }
        if (intent === "deal") {
          sayTopic(ped, "pitch", 2.2);
          ped.offersDeal = 10; return true;
        }
        if (intent === "trade") { pedTrade(ped); return true; }
        // talk / favor
        sayTopic(ped, "approach", 2.0);
        return true;
      }
      return true;
    }

    // ---- pick a fresh intent (one shot, then a short-ish cooldown — TUNING PASS:
    //      the old cooldowns (6-25s) + low per-roll odds (5-18%) made the spectrum
    //      "practically invisible" in normal play; shortened + the gate widened a
    //      touch so KILL/STEAL/WORK/DEAL/TRADE/TALK actually surface during a
    //      normal stroll without turning into spam — see the utility floor below). ----
    if (dpl > 15 || ped.reactCD > 0) return false;
    const hot = (g.wanted | 0) >= 1;
    const respect = g.respect || 0;
    const prov = provokedAtPlayer(ped);
    const r = rng();

    // ---- GANG / REPUTATION STANCE (the smarter read): resolve how this ped sees
    //      the player from gang allegiance, who they've killed, and reputation,
    //      and let the strongest stance pre-empt the generic talk/steal/deal. ----
    const host = gangHostility(ped);                 // -1 ally · 0 none · 1 rival · 2 war
    const standing = playerStandingWith(ped);        // earned rep with their crew
    const witnessedKill = ped.witnessType === "murder" && ped.mem === CBZ.city.playerActor;

    // ---- THE STREET REMEMBERS (relationship web, social.js writes ped.relPlayer) ----
    const rel = ped.relPlayer;
    // AVOIDANCE: someone you've robbed/beaten/extorted SPOTS you and crosses the
    // street — a deliberate arc away from your line (not a panic flee), muttering.
    // Their people catch the warning and steer off too (cityStreetParts ripple) —
    // the street visibly parts around a known predator. Civilians only (a gang
    // member with a grudge resolves through the stance/ambush machinery instead);
    // the timid only — a bold grudge-holder would rather settle it (branches below).
    // thresholds sit against social.js's decay curves: fear>25 = the fresh-victim
    // window (fear cools ~1.6/s), grudge>20 reaches into the durable >30 band so a
    // man you robbed YESTERDAY still crosses the street; second-hand "warned" fear
    // (~5) never qualifies, so the ripple can't chain-react the whole block.
    if (rel && rel.seen && !ped.gang && (rel.fear > 25 || rel.grudge > 20) &&
        ped.aggr < (B.crook || 0.72) && r < 0.7) {
      ped.reactCD = 13 + rng() * 8;
      ped.path = null; ped.pause = 3; ped._notedT = 6;     // own the next few steps (no gawk/goal override)
      const im = dpl || 1, ax = (ped.pos.x - P.pos.x) / im, az = (ped.pos.z - P.pos.z) / im;
      const side = rng() < 0.5 ? 1 : -1;                   // pick a kerb to cross to
      ped.target.set(ped.pos.x + ax * 6 - az * side * 9, 0, ped.pos.z + az * 6 + ax * side * 9);
      ped.state = "walk";
      sayTopic(ped, "avoid", 2);
      if (CBZ.cityStreetParts) CBZ.cityStreetParts(ped);   // warn the people around them
      return true;
    }
    // RECOGNITION: someone who genuinely rates you (earned loyalty/respect, no
    // grudge) greets you by the name the street gave you — they know YOU; their
    // name you only learn by talking to them. Never mid-war with their set.
    if (rel && rel.seen && rel.grudge < 30 && (rel.loyalty > 45 || rel.respect > 55) &&
        host < 2 && dpl < 9 && r < 0.45) {
      ped.reactCD = 16 + rng() * 10;
      ped.pause = Math.max(ped.pause, 0.8 + rng() * 0.7); ped.speed = 0;
      faceTo(ped, P.pos.x, P.pos.z, 1.5);
      const title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "big man";
      // The greeting is picked by STANDING, not by a die (city/read.js): the
      // same man says the same thing until how he feels about you changes. The
      // street name still rides on it — that part was already right.
      const gl = CBZ.cityLine && CBZ.cityLine(ped, "greet");
      const line = gl ? gl.replace(/\.$/, "") + ", " + title + "."
                      : pick(["Yo, " + title + "!", "Ayy, " + title + "!", title + "! You good?"], rng());
      if (CBZ.citySay) CBZ.citySay(ped, line, "#7ed957", 2.2); else citySayBark(ped, line, 1.8);
      if (CBZ.cityRelShift) CBZ.cityRelShift(ped, "greeted", 1);
      return true;
    }
    // HOSTILE CHARGE: a gang member whose crew you rival/war with, or whose blood
    // you've spilled (provoke + witnessed your murder), squares up and attacks —
    // a war reads louder (lower aggression needed, won't bail). Charges with fists
    // if unarmed; opens fire if strapped. Won't melee-charge a drawn gun unarmed.
    if (host >= 1 && ped.aggr >= (B.bold || 0.5) && dpl < 12) {
      const grievance = host === 2 || prov > 0.3 || witnessedKill;   // a reason to start it
      const willMelee = ped.armed || (!playerArmed && ped.aggr >= (B.crook || 0.72));
      const odds = host === 2 ? 0.7 : 0.42;
      // at WAR nobody backs down; a mere rival still sizes you up first
      if (grievance && willMelee && r < odds &&
          (host === 2 || !CBZ.citySizeUp || CBZ.citySizeUp(ped, CBZ.city.playerActor))) {
        ped.rage = CBZ.city.playerActor; ped.state = "fight"; ped.reactCD = 10;
        if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, host === 2 ? 0.3 : 0.15);
        sayTopic(ped, host === 2 ? "war" : "rival", 1.6);
        return true;
      }
    }
    // DEFER / RESPECT-BARK: a member of YOUR crew (or an allied one), or anyone
    // when you're a high-standing famous name, gives you props and stands down
    // instead of starting trouble. Never a fight; a quick nod, then a long CD.
    if (!ped.surrender && (host < 0 || standing >= 35 || respect >= 12) && dpl < 11) {
      const fam = host < 0;                          // your own / allied crew
      if (fam || r < 0.5) {                          // ambient peds only sometimes bark
        ped.reactCD = 12 + rng() * 8;
        faceTo(ped, P.pos.x, P.pos.z, 1.5);
        ped.pause = Math.max(ped.pause, 0.7 + rng() * 0.8); ped.speed = 0;
        sayTopic(ped, fam ? "deferCrew" : "deferFame", 1.8);
        return true;
      }
    }

    // ============================================================
    //  UTILITY-SCORED VERB PICK (IAUS-style — mirrors aigoals.js' assign()):
    //  every candidate gets ONE cheap "consideration" score (personality ×
    //  relationship × opportunity); we keep the candidates whose gate actually
    //  passed (e.g. STEAL needs you visibly loaded, DEAL needs a dealer ped),
    //  rank them, and weighted-pick among the top few — so the choice still
    //  FEELS personality-driven (a violent ped's KILL score dominates a meek
    //  ped's TALK score) without forcing a rigid first-match order. Each
    //  consideration's flat base term (the leading constant, e.g. KILL's 0.22)
    //  is the actual fix for the old "spectrum is invisible" tuning bug — these
    //  used to be independent ~5-18% coin-flips per branch (most rolls just
    //  failed silently); now they're SCORES that compete against whatever else
    //  qualified, so something fires far more often per opportunity window
    //  (reactCD still throttles how often we even get a window at all).
    // ------------------------------------------------------------
    const rel2 = ped.relPlayer;
    const fear2 = rel2 ? rel2.fear : 0, grudge2 = rel2 ? rel2.grudge : 0;
    const loyalty2 = rel2 ? rel2.loyalty : 0, respect2 = rel2 ? rel2.respect : 0;
    const cash = g.cash | 0;
    const cand = [];   // [name, score, weight-jitter applied already]

    // KILL: armed/violent ped with a reason — provoked gang, a hot armed threat
    // in their space, pure aggression, or a personal grudge — opens fire/charges.
    if (ped.aggr >= (B.violent || 0.85) && dpl < 12 && (prov > 0.2 || (hot && playerArmed) || ped.armed || grudge2 > 50)) {
      let s = 0.22 + ped.aggr * 0.5 + prov * 0.5 + grudge2 / 140 + (hot && playerArmed ? 0.2 : 0) + (ped.armed ? 0.12 : 0);
      s -= fear2 / 200;                              // even a killer hesitates if truly scared of you
      cand.push(["kill", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // BEAT-DOWN: a crook with no gun fancies their chances against an UNARMED
    // player (won't melee-charge a drawn gun). Walks up, then throws hands.
    if (ped.aggr >= (B.crook || 0.7) && !ped.armed && !playerArmed && dpl < 10 &&
        (!CBZ.citySizeUp || CBZ.citySizeUp(ped, CBZ.city.playerActor))) {
      let s = 0.18 + (ped.aggr - (B.crook || 0.7)) * 1.6 + grudge2 / 160;
      s -= respect2 / 180;
      cand.push(["beat", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // STEAL / pickpocket: an opportunist (light-fingered, not a fighter) sneaks up
    // to a DISTRACTED player and lifts cash — more tempting if you're visibly
    // loaded, less if they already fear/respect you (don't bite the hand).
    const opportunist = ped.snitch < 0.4 && ped.aggr < (B.crook || 0.7) && ped.aggr >= (B.flee || 0.3);
    if (opportunist && !ped.armed && !hot && cash > 25 && dpl < 9) {
      let s = 0.14 + (cash > 1000 ? 0.18 : cash > 200 ? 0.1 : 0.04) + (1 - ped.snitch) * 0.12;
      s -= (fear2 + respect2) / 220;
      cand.push(["steal", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // WORK FOR YOU: a have-respect-for-you, broke, willing soul offers to run
    // with you (you've made a name / have a gang). Walks up and pitches.
    if (!ped.gang && !ped.recruited && respect >= 3 && ped.wealth < 0.5 && !hot && dpl < 10) {
      let s = 0.1 + Math.min(1, respect / 20) * 0.3 + (0.5 - ped.wealth) * 0.3 + loyalty2 / 150;
      cand.push(["work", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // TRADE / barter: the generic street swap — a vendor-flavoured or just
    // ordinary opportunist civilian with goods (or wanting yours) sidles up.
    // Distinct from DEAL below (drugs only). Calmer opportunity gate than
    // STEAL (nobody needs to be "distracted" for an honest trade).
    const traderish = ped.archetype === "merchant" || ped.archetype === "hustler" ||
      (ped.snitch < 0.55 && ped.aggr < (B.crook || 0.7));
    if (traderish && !ped.vendor && !hot && dpl < 10 && (ped.loot || (ped.valuables && ped.valuables.length) || cash > 60)) {
      let s = 0.13 + (ped.archetype === "merchant" || ped.archetype === "hustler" ? 0.18 : 0) + loyalty2 / 200;
      cand.push(["trade", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // DEAL / drugs: a dealer-ish ped sidles up to sell PRODUCT when you're not a threat.
    if ((ped.archetype === "dealer" || ped.drugUser) && !hot && dpl < 9) {
      let s = 0.16 + (ped.archetype === "dealer" ? 0.22 : 0.08);
      cand.push(["deal", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }
    // TALK / ask a favor: a friendly local just wants a word (the common,
    // cheap, low-stakes fallback — always eligible for a non-violent band).
    if (bnd !== "violent" && !playerArmed && dpl < 8) {
      let s = 0.09 + (1 - ped.aggr) * 0.06 + respect2 / 220;
      cand.push(["talk", Math.max(0, s) * (0.85 + rng() * 0.3)]);
    }

    if (!cand.length) return false;
    cand.sort((a, b) => b[1] - a[1]);
    // weighted-random among the top few (unpredictability — the strongest
    // personality fit usually wins, but not deterministically every time).
    const top = cand.slice(0, Math.min(3, cand.length));
    let wsum = 0; for (const c of top) wsum += c[1];
    if (wsum <= 0.04) return false;                  // nothing scored high enough to act on
    let roll = r * wsum, picked = top[0][0];
    for (const c of top) { roll -= c[1]; if (roll <= 0) { picked = c[0]; break; } }

    if (picked === "kill") {
      beginViolentWindup(ped, "kill");
      if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.2);
      return true;
    }
    if (picked === "beat") {
      ped.approach = "beat"; ped._approachT = 3.5; ped.reactCD = 7;
      sayTopic(ped, "startBeat", 1.6);
      return true;
    }
    if (picked === "steal") {
      ped.approach = "steal"; ped._approachT = 4; ped.reactCD = 11;
      return true;
    }
    if (picked === "work") {
      ped.approach = "work"; ped._approachT = 4; ped.reactCD = 20;
      return true;
    }
    if (picked === "trade") {
      ped.approach = "trade"; ped._approachT = 4; ped.reactCD = 15;
      // WHAT THEY PITCH DEPENDS ON WHO YOU ARE (owner: "if I'm a hitman they
      // offer me jobs"). city/read.js sizes the pitch to the level gap and, if
      // the street knows you as somebody who takes work, offers work instead of
      // product. Falls back to the old flat line if read.js is absent.
      const rl = CBZ.cityLine && CBZ.cityLine(ped, "trade");
      citySayBark(ped, rl || "You buying or selling?", 2);
      return true;
    }
    if (picked === "deal") {
      ped.approach = "deal"; ped._approachT = 4; ped.reactCD = 14;
      return true;
    }
    // talk
    ped.approach = "talk"; ped._approachT = 4; ped.reactCD = 13;
    return true;
  }

  // ============================================================
  //  LONE-WOLF RAMPAGE brain — a ped that SNAPPED into an active-shooter spree.
  //  Set ped.rampage = true (the director in aigoals.js does this rarely). From
  //  then on this owns the ped: it arms itself (its own gun, a dropped gun nearby,
  //  or fists/knife), keeps a hard self-wanted level so cops hunt it relentlessly,
  //  and relentlessly attacks the NEAREST living soul (civilian or cop) — killing
  //  as many as it can. It does NOT flee at low HP; it goes until it's put down.
  //  Reuses the existing violent plumbing (npcAttack, cityNpcOffense/npcWanted,
  //  cityPanic, cityTagWitnesses). Cheap: a bounded nearest-target scan on a per-ped
  //  rate timer (_rampT), and it leans on the same per-frame move() to carry it.
  // ============================================================
  function rampageThink(ped, dt, active) {
    if (ped.dead) { ped.rampage = false; return; }
    ped.surrender = false; ped.surrenderT = 0; ped.fear = 0;     // a rampager knows no fear
    ped.poseHandsUp = false; ped.poseAimBack = false;
    // ARM UP: pull its own gun, or grab a dropped one nearby, or commit to fists.
    if (!ped.armed && ped._pickingUp) return;      // his hand is on a gun already
    if (!ped.armed) {
      const di = nearestDrop(ped.pos.x, ped.pos.z, 22);
      if (di >= 0) {
        const d = CBZ.cityDrops[di];
        // close enough to scoop it up; else walk onto it (loot state carries the walk)
        if (Math.hypot(d.x - ped.pos.x, d.z - ped.pos.z) < 1.6) {
          pedTakeDrop(ped, di);
          return;
        } else { ped.state = "loot"; ped.target.set(d.x, 0, d.z); return; }
      } else if (!ped._rampArmed) {
        // no gun to be found → snaps with a blade/fists. Give it a pistol if the
        // roll said this one came strapped (the director biases armed picks); else
        // it brawls. Either way it keeps attacking with whatever it has.
        ped._rampArmed = 1;
        if (rng() < 0.5) { ped.armed = true; ped.weapon = "Pistol"; ped.ammo = 12 + ((rng() * 18) | 0); if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); }
      }
    }
    // keep the cops on it HARD (active-shooter response). cityNpcOffense raises its
    // npcWanted; re-poke it periodically so the heat never fully decays mid-spree.
    if ((ped._rampHeatT || 0) <= 0) {
      ped._rampHeatT = 2.5;
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 60, "active-shooter");
      if ((ped.npcWanted | 0) < 3) ped.npcWanted = 3;
    } else ped._rampHeatT -= dt;

    // TARGET the nearest living soul — civilian or cop — and bear down on them. Only
    // re-scan on the rate timer (cheap); keep charging the current target between.
    if (!ped.rage || ped.rage.dead || (ped._rampT || 0) <= 0) {
      ped._rampT = 0.4 + rng() * 0.4;
      const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
      // prefer the closest of: any nearby civilian/cop, or the player if right here
      let tgt = nearestActor(ped, 60, _naRampageVictim);
      if (P && !P.dead && PA) {
        const dP = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
        if (dP < 20 && (!tgt || dP < Math.hypot(tgt.pos.x - ped.pos.x, tgt.pos.z - ped.pos.z))) tgt = PA;
      }
      if (tgt) { ped.rage = tgt; }
    }
    if (ped.rage && !ped.rage.dead) {
      ped.state = "fight";
      ped.target.set(ped.rage.pos.x, 0, ped.rage.pos.z);
      // keep the street terrified + tagging witnesses around the shooter (active only,
      // bounded). This is what makes it read as a city-wide event the player can stop.
      if (active && (ped._rampPanicT || 0) <= 0) {
        ped._rampPanicT = 1.2;
        if (CBZ.cityPanic) CBZ.cityPanic(ped.pos.x, ped.pos.z, 1.4, ped);
        if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(ped.pos.x, ped.pos.z, 80, "active-shooter", ped);   // HIS crime, not the player's
      } else if (ped._rampPanicT > 0) ped._rampPanicT -= dt;
    } else {
      // nobody in reach — prowl toward the densest part of the map (the centre) to
      // find more victims rather than standing still.
      ped.rage = null; ped.state = "walk";
      const A = CBZ.city && CBZ.city.arena;
      if (A && (!ped.path || !ped.path.length) && ped.pause <= 0) {
        const c = A.center || { x: 0, z: 0 };
        ped.target.set(c.x + (rng() - 0.5) * 40, 0, c.z + (rng() - 0.5) * 40);
        ped.pause = 0.3;
      }
    }
  }
  CBZ.cityRampageThink = rampageThink;   // exposed for the director to validate the hook

  // ---- NPC-on-NPC MUGGING (a real grab-and-go, not just a fistfight) ----------
  // WHY: "random people rob each other" has to MOVE money — a thief who snatches a
  // mark's wallet and BOLTS, leaving a robbed, frightened victim who carries a
  // GRUDGE. That's the seed of an emergent street feud (the victim may hunt the
  // thief back later via cityNpcGrudge), not a throwaway scuffle. Returns true if
  // the mug landed (the caller stops the close-and-brawl), false to keep closing.
  // Rate-limited by the caller's attackCD; gated to the active/near crowd upstream.
  function npcMug(att, victim) {
    if (!att || !victim || att.dead || victim.dead || victim === att) return false;
    if (victim.gang || victim.recruited || victim.controlled || victim.companion) return false; // don't shake down crew/escorts
    if (victim.robbed) return false;                                   // already taken — nothing left to grab
    const dx = victim.pos.x - att.pos.x, dz = victim.pos.z - att.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 1.6 * 1.6) return false;                                  // not in arm's reach yet → keep closing
    // the SNATCH: take what's on them up to a quick-grab cap (a wallet, not the
    // whole bank). Even a broke mark loses face — set robbed so it can't repeat.
    const purse = victim.cash | 0;
    const grab = Math.min(purse, 40 + ((rng() * 120) | 0));
    if (grab > 0) { victim.cash = Math.max(0, purse - grab); att.cash = (att.cash || 0) + grab; }
    victim.robbed = true;
    victim.fear = Math.min(10, (victim.fear || 0) + 6);               // a robbery is terrifying
    victim.alarmed = Math.max(victim.alarmed || 0, 6);
    // face the victim for the grab beat, then BOLT away from them (grab-and-go).
    faceYaw(att, Math.atan2(dx, dz), 0.3);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 12, "mugging");   // one offense (the caller no longer logs its own)
    if (CBZ.cityNpcGrudge) CBZ.cityNpcGrudge(victim, att);            // the mark may come back for the thief
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.citySay && rng() < 0.5) CBZ.citySay(att, "Gimme that!", "#ffce6b", 1.4);
    // the thief flees AWAY from the victim for a few seconds, then re-checks the
    // street — fleeFrom routes a clear path; a short timer keeps the run committed.
    att.state = "flee"; att._mugFleeT = 3 + rng() * 2;
    fleeFrom(att, victim.pos.x, victim.pos.z);
    return true;
  }

  // ============================================================
  //  POSTED STAFF (ped.staffPost = {x,z,face}) — the "pinned" package NPC.
  //  A game package (core/packages.js ctx.npc, post:"pinned") stamps this on a
  //  REAL city ped so it holds its station: a dealer at the felt, a cashier at
  //  the cage, a guard on the door. It mirrors the VENDOR pin (no wander, no
  //  routine, no crowd-churn recast — kind:"staff" already fails the hourly
  //  recast's civilian test, and it's exempted from panic/alarm below) BUT,
  //  unlike ped.vendor, it is NOT skipped by the gunpoint sweep — so posted
  //  staff keep their POISE: they stand their post normally and throw their
  //  hands up the instant a gun is drawn on them (markGunpoint drives it; move()
  //  renders it). They still die through cityKillPed, collide, and rob normally.
  //  Additive + flagless: absent the field, every path below is byte-identical.
  // ============================================================
  function staffThink(ped, dt) {
    // gunpoint owns them while covered/surrendering — the per-frame gunpointSweep
    // + markGunpoint set surrender/hands-up; don't fight it here.
    if (ped.surrender || ped.state === "surrender" || (ped.surrenderT || 0) > 0) return;
    ped.state = "idle"; ped.speed = 0; ped.path = null; ped.rage = null; ped.finalGoal = null;
    const post = ped.staffPost;
    if (post) {
      ped.target.set(post.x, 0, post.z);
      // restore the post facing when calm and not being talked to (interact.js's
      // _faceT turn-to-look and gunpoint's face-the-threat both own rotation then).
      if (post.face != null && !ped._covered && (ped._faceT || 0) <= 0) faceYaw(ped, post.face, 1.2);
    }
  }

  // ---- the brain (time-sliced) ----
  const _thinkCtx = { playerArmed: false, dpl: 0 };
  const _panicAt = { x: 0, z: 0 };
  function think(ped, dt, active) {
    // a zip-tied companion is restrain.js's body, not the crew's: companionThink
    // would re-arm him and wipe the surrender/rage fields every tick, which is
    // how a cuffed crew member kept shooting with his hands behind his back.
    if (ped.companion) { if (!ped.restraint) companionThink(ped, dt, active); return; }
    if (ped.dead || ped.vendor || ped.ko > 0) return;
    if (ped.controlled) return;     // city/social.js drives companions/hostages/kidnap victims
    if (ped.staffPost) { staffThink(ped, dt); return; }   // posted package staff: rooted brain, gunpoint-aware
    const B = A0();
    const P = CBZ.player, px = P.pos.x, pz = P.pos.z;
    const ddx = ped.pos.x - px, ddz = ped.pos.z - pz, dpl = Math.hypot(ddx, ddz);
    const playerArmed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    const playerThreat = !P.dead && (((g.wanted | 0) >= 1 && playerArmed) || P._fighting > 0);
    const bnd = band(ped.aggr);
    if (ped.reactCD > 0) ped.reactCD -= dt;

    // ---- LONE-WOLF RAMPAGE: a ped that SNAPPED. Owns the brain completely — arms
    //      up, hunts the nearest soul, kills as many as it can, and NEVER backs off
    //      (no flee at low HP). It only stops when killed. Handled here, first, so
    //      nothing else (flee/surrender/routine) can override the spree.
    if (ped.rampage) { rampageThink(ped, dt, active); return; }

    // ---- GRAB-AND-GO COMMIT: a thief who just snatched a wallet (npcMug) bolts
    //      AWAY from the mark for a few seconds before re-checking the street, so
    //      the mug READS as a snatch-and-run, not a hover. Hold the flee while the
    //      short timer runs, then release back to normal AI. (A real threat — a hit,
    //      a cop, gunpoint — still overrides below; this only keeps the routine
    //      "calm down" pass from cancelling the run on the very next think.)
    if ((ped._mugFleeT || 0) > 0) {
      ped._mugFleeT -= dt;
      if (ped._mugFleeT > 0 && !ped.rage && !ped.reportState) { ped.state = "flee"; return; }
    }

    // ---- VIOLENT TELEGRAPH: a KILL/BEAT-DOWN verb chosen by reactToPlayer doesn't
    //      commit straight to "fight" — it plays a brief wind-up "tell" first (see
    //      beginViolentWindup). Resolve/advance it here, ahead of rage/report, so it
    //      can't be skipped by time-slicing and reliably converts to a real fight
    //      (or stands down if the target's gone) exactly once.
    if (ped._windup) { if (tickViolentWindup(ped, dt)) return; }

    // ---- THE STREET BRAIN (city/brain_city.js → CBZ.brain): a bang this body
    //      heard, a crime it witnessed, a call it is making, a reaction it is
    //      still playing out. Each lands after THIS body's own reaction delay and
    //      dwells before anything but a more urgent answer may replace it — the
    //      crowd ripples instead of flipping on one frame. Returns true while it
    //      owns the tick; a rage, a gunpoint or a rout below still outranks it.
    if (CBZ.cityBrain) {
      _thinkCtx.playerArmed = playerArmed; _thinkCtx.dpl = dpl;
      if (CBZ.cityBrain.think(ped, dt, _thinkCtx)) return;
    }

    // ---- POINT-OUT HOLD: "Right there. That's the one." A point is a LINE,
    //      and the line only exists while the body agrees with the arm. The
    //      report has just landed, so the routine brain below would hand this
    //      man a new destination on this very tick and walk him off mid-accusation
    //      with his arm still out. Pin the stance for the gesture window: stand
    //      still, target underfoot (so a later branch flipping the state can't
    //      start the legs either), and let the per-frame tell block hold the aim.
    //      Deliberately NOT a `return` — a bullet, a rage or a gunpoint below
    //      still outranks a gesture on the very next tick.
    if (legible() && ped.posePoint > 0 && !ped.rage && !ped.reportState && !ped._windup) {
      ped.state = "idle"; ped.speed = 0; ped.path = null;
      ped.target.set(ped.pos.x, 0, ped.pos.z);
      ped.pause = Math.max(ped.pause, ped.posePoint);
    }

    // ---- ROUTED (gangs.js crewTakesLoss): this man's crew broke and he ran.
    //      He keeps running and stays out of it until the timer lapses; the
    //      threatened branch below would otherwise turn a crook straight back
    //      round at the shooter on the very next think. Shoot him and he
    //      turns (hurtActor/fpsmode give him a rage, and the rage branch takes over).
    if (ped._routT > 0) {
      ped._routT -= dt;
      if (!ped.rage) {
        if (ped.state !== "flee" || !(ped._reactHold > 0)) { ped.state = "flee"; fleeFrom(ped, px, pz); ped._reactHold = 2 + rng() * 1.5; }
        else ped._reactHold -= dt;
        return;
      }
    }

    // ---- if currently raging at someone, keep engaging until they're gone ----
    if (ped.rage) {
      if (ped.rage.dead || (ped.rage.isPlayer && P.dead)) { ped.rage = null; }
      // NOBODY WITHOUT A GUN WALKS AT A GUN (city/brain_city.js gunGate ->
      // CBZ.brain.threat): whatever set him raging, the brain decides whether
      // he may — a blade only close, while the gun reloads or points away.
      else if (CBZ.cityBrain && CBZ.cityBrain.gunGate && CBZ.cityBrain.gunGate(ped)) return;
      else {
        ped.state = "fight";
        ped.target.set(ped.rage.pos.x, 0, ped.rage.pos.z);
        // TACTICAL HANDOFF. This USED to be the whole of the smart-fighting
        // story, and it was gated on being SOMEBODY — named, a boss, a bounty,
        // protected, recruited — so an ordinary armed ganger, terrorist or
        // soldier got NOTHING and simply walked at you in a straight line. That
        // gate is why the owner's complaint was true. Every armed fighter now
        // runs the fuller composition (cover + shooter token + weapon band) in
        // move(), every frame, via systems/combat_iq.js; aitactics' engage stays
        // as the exact fallback for a build with combat_iq off or absent, so
        // nothing regresses to the pre-tactics path.
        const _iqOn = !!(CBZ.combatIQ && CBZ.combatIQ.posture && CBZ.CONFIG.NPC_COMBAT_IQ !== false);
        if (!_iqOn && CBZ.aiTactics && ped.armed &&
            (ped.nameKnown || ped.isBoss || ped.rank === "boss" || ped.bounty > 0 || ped.protectGang || ped.protectedBy || ped.recruited)) {
          const tac = CBZ.aiTactics;
          try {
            if (tac.engage) tac.engage(ped, ped.rage, dt);
            else if (tac.tick) tac.tick(ped, ped.rage, dt);
          } catch (e) {}
        }
        // SELF-PRESERVATION. Breaking contact is the LAST answer, not the first:
        // a hurt fighter with a wall within reach gets behind it (posture's own
        // fallback branch) and keeps fighting; only one with nowhere to go runs.
        // The old line sent every wounded body sprinting into the open street,
        // which is most of "they dont make a good effort at staying alive".
        const _hurtBail = ped.hp < ped.maxHp * 0.3 && ped.aggr < (B.violent || 0.88);
        if (_hurtBail && !(_iqOn && ped.armed && CBZ.combatIQ.cover && CBZ.combatIQ.cover(ped, ped.rage.pos.x, ped.rage.pos.z))) {
          ped.rage = null; ped.state = "flee"; fleeFrom(ped, ped.pos.x + ddx, ped.pos.z + ddz);
        }
        return;
      }
    }

    // ---- GROUP: a ped whose partner/family is attacked rallies with them, and a
    //      knot of bold peds piles onto a shared threat (mob). Active crowd only
    //      (bounded scans), rate-gated so it's cheap; never fires while surrendering.
    if (active && !ped.surrender && (ped._groupT || 0) <= 0) {
      ped._groupT = 0.6 + rng() * 0.6;
      if ((ped.partner || (ped.family && ped.family.length) || ped.aggr >= (B.bold || 0.5)) && groupReact(ped, B)) return;
    }

    // ---- GANG-FEAR (THE WHY of turf): an ordinary, timid civilian gives an armed
    //      gangster a WIDE berth. On a rate-gated sweep (like _groupT — never every
    //      frame), a non-gang low-aggr ped scans the near crowd for an armed, living
    //      gang member within ~16m and lets dread build the closer one is; when fear
    //      crosses a threshold it bolts AWAY from the nearest one. Reuses the shared
    //      fear field + fleeFrom + the "flee" state — so gang turf FEELS owned: people
    //      avoid and clear out around the crew, no popup. Active/near crowd only,
    //      and it never overrides a ped already fighting/surrendering/fleeing a worse
    //      threat (those branches returned above). Cheap: bounded local scan, gated.
    if (active && ped.kind !== "gang" && !ped.rage && ped.state !== "fight" &&
        ped.aggr < (B.bold || 0.5) && (ped._gangFearT || 0) <= 0) {
      ped._gangFearT = 0.4 + rng() * 0.25;
      let gx = 0, gz = 0, gd2 = 16 * 16, sawGang = false;
      // Only a ganger can be the answer. 16m is wide enough that a cell query
      // would touch more cells than the set has members, so this one takes the
      // candidate LIST, not the grid: same roster order, same predicate below.
      const crowd = _scanOn ? _gangList : CBZ.cityPeds;
      if (_scanOn) _audit.listRoutedCalls++; else { _audit.linearFallbackCalls++; _audit.linearVisited += crowd.length; }
      for (let gi = 0; gi < crowd.length; gi++) {
        const p = crowd[gi];
        if (p === ped || p.kind !== "gang" || !p.armed || p.dead) continue;
        const dgx = p.pos.x - ped.pos.x, dgz = p.pos.z - ped.pos.z, dgd = dgx * dgx + dgz * dgz;
        if (dgd < gd2) { gd2 = dgd; gx = p.pos.x; gz = p.pos.z; sawGang = true; }
      }
      if (sawGang) {
        // closer ⇒ more dread (0 at the 16m edge, ~1.6/tick on top of you), bounded.
        const close = 1 - Math.sqrt(gd2) / 16;
        ped.fear = Math.min(10, ped.fear + 0.6 + close * 1.0);
        if (ped.fear >= 4) {
          // committed: one routed escape per ~2 s, not a re-plan every sweep
          if (ped.state !== "flee" || !(ped._reactHold > 0)) { ped.state = "flee"; fleeFrom(ped, gx, gz); ped._reactHold = 1.8 + rng() * 1.2; }
          return;
        }
      } else if (ped.fear > 0 && ped.alarmed <= 0) {
        // no armed gangster in range and nothing else alarming → the turf-dread we
        // raised bleeds back off, so a civilian who passed a crew calms once clear
        // (keeps this purely local; doesn't touch fear other systems are driving).
        ped.fear = Math.max(0, ped.fear - 0.5);
      }
    }

    // ---- GUNPOINT (reuses the jail's intimidate logic): if the player is
    //      pointing a gun at this person, the meek SURRENDER (hands up, frozen,
    //      robbable) and the bold/armed DRAW and fight back — a stand-off. ----
    if ((ped.surrenderT || 0) <= 0) {
      ped.surrender = false;
      if (ped.state === "surrender") ped.state = playerArmed && dpl < 11 ? "flee" : "walk";
    }
    if (playerArmed && dpl < 9) {
      const cy = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(cy), fz = -Math.cos(cy);
      const m = dpl || 1, dot = ((px - ped.pos.x) / m) * -fx + ((pz - ped.pos.z) / m) * -fz; // player→ped vs facing
      const aimedAtMe = (((ped.pos.x - px) / m) * fx + ((ped.pos.z - pz) / m) * fz) > 0.62;
      if (aimedAtMe) {
        if (ped.aggr < (B.crook || 0.72) || (!ped.armed && ped.aggr < (B.violent || 0.88))) {
          markGunpoint(ped, 0.75);
          return;
        }
        // bold + (usually armed): draw and fight back — a Mexican stand-off
        ped.rage = CBZ.city.playerActor; ped.state = "fight";
        if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.4);
        return;
      }
    }

    // ---- SHOOT FIRST -------------------------------------------------------
    // OWNER: "make some of them shoot first sometimes." Every violent path in
    // this file needed to be PROVOKED first — hit, aimed at, rallied — so no
    // armed NPC in the game had ever opened on the player unbidden. The rule
    // that keeps it from being a nuisance: THE WORLD SUPPLIES THE REASON. We
    // never invent hostility; we read a context that already exists (you are
    // standing on a provoked crew's turf, or armed inside a perimeter somebody
    // is paid to hold) and ask systems/combat_iq.js whether THIS person is the
    // one who starts it. That answer is a stable trait off the body's own spawn
    // hash, so the same man is always the eager one — and ROLE.civ's eagerness
    // is zero, so a law-abiding person with a gun never opens fire.
    if (active && ped.armed && ped.ammo > 0 && !ped.rage && !ped.surrender && !P.dead &&
        !g.busted && dpl < 30 && CBZ.combatIQ && CBZ.combatIQ.shootFirst && (ped._sfCD || 0) <= 0) {
      ped._sfCD = 1.4 + rng() * 1.6;
      let ctx = null, bias = 0;
      // (a) TURF. A crew you have already crossed, on ground they own.
      if (ped.gang && CBZ.cityGangOf && CBZ.cityGangOf(px, pz) === ped.gang) {
        const prov = CBZ.cityGangProvoked ? CBZ.cityGangProvoked(ped.gang) : 0;
        const stand = CBZ.cityGangStanding ? CBZ.cityGangStanding(ped.gang) : 0;
        if (prov > 0.35 || stand < -10) { ctx = "turf"; bias = Math.min(0.12, prov * 0.1); }
      }
      // (b) A PERIMETER SOMEBODY IS PAID TO HOLD. An armed stranger walking a
      //     guarded line is the one case where opening fire is the JOB, and it
      //     is what makes a military fence or a compound read as defended.
      if (!ctx && playerArmed && (ped.guard || ped.kind === "security" || ped.milRank || ped.kind === "military")) {
        const leash = ped.guard || null;
        const inside = !leash || Math.hypot(px - (leash.x != null ? leash.x : ped.pos.x), pz - (leash.z != null ? leash.z : ped.pos.z)) < (leash.r || 26);
        if (inside && dpl < 24) { ctx = "perimeter"; bias = 0.08; }
      }
      // (a rampage never reaches here — rampageThink returns at the top of
      //  think() and owns that brain completely. combat_iq's own default
      //  context covers it for any other caller.)
      if (ctx && CBZ.clearLineOfFire &&
          CBZ.clearLineOfFire(ped.pos.x, (ped.pos.y || 0) + 1.4, ped.pos.z, px, (P.pos.y || 0) + 1.55, pz) &&
          CBZ.combatIQ.shootFirst(ped, CBZ.city.playerActor, { context: ctx, bias: bias })) {
        ped.rage = CBZ.city.playerActor; ped.state = "fight";
        ped.target.set(px, 0, pz);
        if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.25);
        // the street hears it start — the same alarm any opened fight raises.
        if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(ped.pos.x, ped.pos.z, 0.6);
        return;
      }
    }

    // ---- being threatened (player aiming / hot / a witnessed crime nearby) ----
    // ONE RUNNER SETS OTHERS RUNNING: a bystander with no threat of his own
    // still reads the street — enough people bolting past him (the decaying
    // panic field every flee raises) IS the threat, from where they came from.
    const panicHere = (!ped.gang && !ped.guard && CBZ.cityPanicAt) ? CBZ.cityPanicAt(ped.pos.x, ped.pos.z) : 0;
    const threatened = ped.alarmed > 0 || (playerThreat && dpl < 14) || panicHere > 0.9;
    if (ped._reactHold > 0) ped._reactHold -= dt;
    if (threatened && CBZ.cityBrain) {
      // origin of the threat: a remembered offender if we have one, else the
      // player if he's the hot one close by, else the panic's own centre.
      const memT = (ped.mem && !ped.mem.dead && ped.mem.pos) ? ped.mem : null;
      let src = memT, thx, thz;
      if (memT) { thx = memT.pos.x; thz = memT.pos.z; }
      else if (ped.alarmed > 0 || (playerThreat && dpl < 14)) { src = CBZ.city.playerActor; thx = px; thz = pz; }
      else if (CBZ.cityPanicFrom && CBZ.cityPanicFrom(ped.pos.x, ped.pos.z, _panicAt)) { thx = _panicAt.x; thz = _panicAt.z; }
      else { thx = px; thz = pz; }
      const foeIsPlayer = !!src && (src === CBZ.city.playerActor || src.isPlayer);
      const foeArmed = src ? (foeIsPlayer ? playerArmed : !!src.armed) : true;
      let aiming = false;
      if (foeIsPlayer && playerArmed && dpl < 12) {
        const cy = CBZ.cam ? CBZ.cam.yaw : 0, m = dpl || 1;
        aiming = (((ped.pos.x - px) / m) * -Math.sin(cy) + ((ped.pos.z - pz) / m) * -Math.cos(cy)) > 0.62;
      }
      if (CBZ.cityBrain.threat(ped, src, thx, thz, foeArmed, aiming, src ? null : "panic")) return;
    }

    // ---- posted guards: gangs hold turf; private security protects businesses ----
    if (active && ped.guard) {
      const intruder = ped.gang ? turfIntruder(ped, px, pz, playerArmed)
        : ped.kind === "security" && CBZ.citySecurityIntruder ? CBZ.citySecurityIntruder(ped) : null;
      if (intruder) { standDown(ped); ped.rage = intruder; ped.state = "fight"; return; }
      if (ped.gang && turfStandoff(ped, px, pz, dpl, playerArmed)) return;
      // Hold the turf/post: loiter near the guard point.
      const dg = Math.hypot(ped.pos.x - ped.guard.x, ped.pos.z - ped.guard.z);
      if (dg > 9 || ped.pause <= 0) {
        ped.target.set(ped.guard.x + (rng() - 0.5) * 7, 0, ped.guard.z + (rng() - 0.5) * 7);
        ped.pause = 1.5 + rng() * 3; ped.state = "walk"; ped.path = null;
      }
      // A violent gangster can still freelance crime when no intruder.
    }

    // ---- A MATE ON THE FLOOR, BLEEDING: walk over and wrap it (systems/vitals.js).
    //      Assigned by the aid scan below; everything urgent above already
    //      returned, so a man only goes to help once his own street is quiet.
    if (ped._aidTo) {
      const pt = ped._aidTo, V = CBZ.vitals;
      if (!V || pt.dead || !pt._vt || !(V.bleedRate(pt) > 0.0006) || ped.rage || ped.restraint || ped.inCar || ped.controlled ||
          ped.state === "flee" || ped.state === "fight" || V.state(ped) !== "ok") {
        if (V && V.bandaging(ped) >= 0) V.cancelBandage(ped);
        if (pt._aidBy === ped) pt._aidBy = null;
        ped._aidTo = null;
      } else {
        const d = Math.hypot(pt.pos.x - ped.pos.x, pt.pos.z - ped.pos.z);
        if (d < 1.4) {
          ped.path = null; ped.finalGoal = null; ped.speed = 0; ped.state = "idle"; ped.pause = Math.max(ped.pause, 0.6);
          faceTo(ped, pt.pos.x, pt.pos.z, 0.6);
          if (V.bandaging(ped) < 0 && !V.bandage(ped, pt, { roll: !!ped.medic })) {
            if (pt._aidBy === ped) pt._aidBy = null;
            ped._aidTo = null;
          }
          return;
        }
        ped.path = null; ped.finalGoal = { x: pt.pos.x, z: pt.pos.z };
        ped.target.set(pt.pos.x, 0, pt.pos.z); ped.state = "walk"; ped.pause = 0;
        return;
      }
    }

    // ---- tweakers: cheap but visible behavioral variety ----
    // They keep the same combat and inventory rules as everyone else; this only
    // changes routine choices and movement rhythm.
    if (active && ped.drugUser && ped.erratic > 0 && ped.tweakT <= 0 && !ped.rage) {
      ped.tweakT = 3 + rng() * 7;
      const A = CBZ.city.arena;
      const trap = A && A.shopLots && A.shopLots.find((l) => l.kind === "drugs" && !l.demolished);
      if (trap && rng() < 0.42) {
        ped.path = null; ped.finalGoal = { x: trap.building.door.x, z: trap.building.door.z, enter: true };
        ped.target.set(ped.finalGoal.x, 0, ped.finalGoal.z); ped.state = "walk"; ped.pause = 0;
        return;
      }
      if (rng() < 0.72) {
        ped.path = null; ped.target.set(ped.pos.x + (rng() - 0.5) * 16, 0, ped.pos.z + (rng() - 0.5) * 16);
        ped.state = "walk"; ped.pause = 0; return;
      }
    }

    // ---- autonomy: aggressive peds start their own trouble ("infinite power") ----
    // (only the active/near crowd does the expensive target scans — LOD)
    if (active && ped.aggr >= (B.crook || 0.72) && ped.attackCD <= 0 && ped.pause <= 0) {
      // 1) grab a dropped gun if unarmed
      if (!ped.armed) {
        const di = nearestDrop(ped.pos.x, ped.pos.z, 18);
        if (di >= 0) { ped.state = "loot"; const d = CBZ.cityDrops[di]; ped.target.set(d.x, 0, d.z); return; }
      }
      const roll = rng();
      // 2) the truly violent take on cops / carjack / rampage
      if (ped.aggr >= (B.violent || 0.88)) {
        if (roll < 0.10) { const cop = nearestActor(ped, 22, _naCop); if (cop) { ped.rage = cop; ped.state = "fight"; return; } }
        if (roll < 0.16 && CBZ.cityNpcCarjack && !ped.inCar) { if (CBZ.cityNpcCarjack(ped)) return; }
      }
      // 3) crooks mug / brawl a nearby weaker civilian. A SNATCH-AND-RUN now moves
      //    real money: if already in arm's reach, npcMug() transfers the wallet and
      //    bolts the thief (a fleeing crook + a robbed, grudge-holding mark — the
      //    seed of a feud). Otherwise CLOSE on the mark (walk up to them); the next
      //    autonomy beat lands the grab once in range. The offense is logged ONCE,
      //    inside npcMug on success (no double-count from the old fight branch).
      if (roll < 0.14) {
        const victim = nearestActor(ped, 12, _naWeakerCivilian);
        if (victim) {
          if (npcMug(ped, victim)) return;                 // snatched + fled
          ped.path = null; ped.finalGoal = { x: victim.pos.x, z: victim.pos.z };
          ped.target.set(victim.pos.x, 0, victim.pos.z); ped.state = "walk"; ped.pause = 0;
          ped.attackCD = 0.4 + rng() * 0.4;                // re-check the grab shortly
          return;
        }
      }
    }

    // ---- being hunted by cops for your OWN crimes: flee or fight ----
    if (active && (ped.npcWanted | 0) >= 1) {
      const cop = nearestActor(ped, 30, _naCopHuntingMe);
      if (cop) {
        if (ped.aggr >= (B.violent || 0.88)) { ped.rage = cop; ped.state = "fight"; return; }
        // RUNNING FROM THE POLICE, A STOPPED CAR IS A WAY OUT: the pull-out
        // verb (city/pullout.js via cityNpcCarjack, its own few-second
        // cooldown) takes the nearest one, the player's included
        if (CBZ.cityNpcCarjack && !ped.inCar && ped.aggr >= (B.crook || 0.72) &&
            Math.hypot(cop.pos.x - ped.pos.x, cop.pos.z - ped.pos.z) > 5 &&
            CBZ.cityNpcCarjack(ped, null, { flee: true })) return;
        ped.state = "flee"; fleeFrom(ped, cop.pos.x, cop.pos.z); return;
      }
    }

    // ---- SEATED AT A DESK (C3): a worker who has reached its claimed desk stays
    //      put for the shift. Every hard threat/interrupt above (rage / group /
    //      gang-fear / gunpoint / threatened / cop-hunt) already RETURNED if it
    //      fired and flipped the state off "sit", so reaching here means nothing
    //      pulled them out this frame — hold the seat (don't gawk, don't re-path).
    //      move() owns entering the pose on arrival and the seated speed-gate; it
    //      also clears char.sitting whenever the state is no longer "sit" (i.e. an
    //      interrupt above changed it), so this is purely the "stay seated" keeper.
    if (ped.state === "sit") { ped.speed = 0; return; }

    // ---- default: routine ----
    if (ped.state === "confront" || ped.state === "fight" || ped.state === "flee" || ped.state === "loot") ped.state = "walk";

    // ---- UNIVERSAL REACTIVITY: any nearby calm ped may pick a believable reaction
    //      to YOU (kill / beat / steal / work / deal / talk / flee) from personality
    //      + context. Only the near/active crowd pays for it. Supersedes the simple
    //      gawk below when it fires.
    if (active && !P.dead && (ped.wantsWork || 0) > 0) ped.wantsWork -= dt;
    if (active && !P.dead && (ped.offersDeal || 0) > 0) ped.offersDeal -= dt;
    if (active && !P.dead && reactToPlayer(ped, dpl, playerArmed, bnd)) return;

    // ---- NOTICE THE PLAYER: a calm bystander reacts to you even when not yet in
    //      danger — a brandished gun makes the meek edge away; otherwise the
    //      curious stop and gawk / film the armed stranger walking past (GTA vibe).
    if (active && !P.dead && dpl < 12 && (ped._notedT || 0) <= 0) {
      if (playerArmed && dpl < 9 && (bnd === "meek" || (bnd === "wary" && rng() < 0.4))) {
        // gun out and pointing-ish your way: the timid back off without a full panic
        ped._notedT = 2.5 + rng() * 2;
        ped.state = "flee"; fleeFrom(ped, px, pz); ped.fear = Math.min(ped.fear + 1.5, 6);
        return;
      }
      if (playerArmed && rng() < 0.5) {
        // film the armed stranger from a distance — phone up, frozen, gawking
        ped._notedT = 3 + rng() * 3;
        ped.state = "film"; ped.speed = 0; ped.pause = 1.2 + rng() * 1.5;
        faceTo(ped, px, pz, 1.5);
        return;
      }
      if (rng() < 0.35) {
        // just clock you and stare for a beat as you pass
        ped._notedT = 4 + rng() * 4;
        faceTo(ped, px, pz, 1.5);
        ped.pause = Math.max(ped.pause, 0.6 + rng() * 0.8); ped.speed = 0;
      }
    }
    if (ped._notedT > 0) ped._notedT -= dt;

    // social: idle peds near each other pause to chat
    if (ped.chatT <= 0 && rng() < 0.04) {
      const mate = nearestActor(ped, 3.2, _naIdleCivilian);
      if (mate) { ped.state = "chat"; ped.chatT = 2 + rng() * 3; ped.speed = 0; faceTo(ped, mate.pos.x, mate.pos.z, 1.5); return; }
    }
    // cheap archetype micro-flavour (linger at a food stall, rest near a bench) so
    // the crowd reads as distinct lives — soft, never forces a goal (active only).
    if (active && !ped.vendor && ped.pause <= 0 && (!ped.path || !ped.path.length) &&
        CBZ.city && CBZ.city.arena && microBehaviour(ped, CBZ.city.arena)) return;
    if (ped.pause <= 0 && (!ped.path || !ped.path.length)) pickRoutineGoal(ped);
  }

  // is the path ahead clear of walls? Probes a short RAY (not just the endpoint):
  // we sample a couple of points along the look-ahead direction and ask the world
  // collider / city-clamp if any is blocked — so a thin wall partway along the ray
  // is caught and the ped steers around it BEFORE it grinds into it. Cheap: at most
  // 2 collide() calls; the goal pickers use it to choose a reachable errand.
  function probeBlocked(x, z, y) {
    tmp.set(x, y, z);
    if (CBZ.collide) { const bx = tmp.x, bz = tmp.z; CBZ.collide(tmp, PED_R, y + PED_FOOT, y + 1.7); if (Math.abs(tmp.x - bx) > 0.05 || Math.abs(tmp.z - bz) > 0.05) return true; }
    if (CBZ.city && CBZ.city.arena && CBZ.city.arena.clampToCity) { const cx = tmp.x, cz = tmp.z; CBZ.city.arena.clampToCity(tmp, PED_R); if (Math.abs(tmp.x - cx) > 0.05 || Math.abs(tmp.z - cz) > 0.05) return true; }
    return false;
  }
  function dirClear(ped, ux, uz, dist) {
    const y = ped.pos.y;
    // sample the far point and a mid point along the ray (catches a wall between)
    if (probeBlocked(ped.pos.x + ux * dist, ped.pos.z + uz * dist, y)) return false;
    if (dist > 1.6 && probeBlocked(ped.pos.x + ux * dist * 0.55, ped.pos.z + uz * dist * 0.55, y)) return false;
    return true;
  }

  // ---- FLEE: NAV-GUIDED escape (Builder B side of the citynav contract) ----
  // The PREFERRED panic path when CBZ.cityNav is present:
  //   • INDOORS (cityNav.indoorLotAt hit) → bolt for the building's OWN door and
  //     2m past it onto the street (a real exit, not a blind away-vector that
  //     would just grind the ped into an interior wall).
  //   • OUTDOORS → cityNav.nearestExit picks the best door / corner to flee
  //     TOWARD (away-dot + nearness + line-of-fire), and cityNav.routeTo lays an
  //     intersection-graph path there — mirroring pickRoutineGoal's path/finalGoal.
  // If cityNav is ABSENT, or it can't produce a usable escape, we fall straight
  // through to _fleeFallback — the ORIGINAL away-vector heuristic, byte-for-byte,
  // so a world without citynav.js behaves exactly as it does today.
  function fleeFrom(ped, x, z) {
    ped.state = "flee";
    let routed = false;
    const NAV = CBZ.cityNav;
    if (NAV) {
      // INDOORS: head for THIS building's door, then 2m out along -inwardNormal.
      const lot = NAV.indoorLotAt ? NAV.indoorLotAt(ped.pos.x, ped.pos.z) : null;
      const door = lot && !lot.demolished && lot.building && lot.building.door;
      if (door && (door.nx || door.nz)) {           // real entrance with an inward normal (parks/stubs lack it → fall through to the exit scorer)
        // door.nx/nz is the INWARD normal → stepping along -(nx,nz) walks OUT.
        const nx = door.nx || 0, nz = door.nz || 0;
        ped.finalGoal = null;
        ped.path = [
          { x: door.x, z: door.z },                       // the doorway threshold
          { x: door.x - nx * 2, z: door.z - nz * 2 },     // 2m onto the street
        ];
        ped.target.set(ped.path[0].x, 0, ped.path[0].z);
        routed = true;
      }
      // OUTDOORS: pick the best EXIT to flee toward, then route to it.
      if (!routed && NAV.nearestExit && NAV.routeTo) {
        const ax = ped.pos.x - x, az = ped.pos.z - z, am = Math.hypot(ax, az) || 1;
        const exit = NAV.nearestExit(ped.pos.x, ped.pos.z, ax / am, az / am);
        if (exit) {
          // reuse ped.path as the caller-owned out array (move() shifts it down).
          const out = (ped.path && ped.path.length !== undefined) ? ped.path : [];
          NAV.routeTo(ped.pos.x, ped.pos.z, exit.x, exit.z, out);
          if (out.length) {
            ped.path = out;
            ped.finalGoal = { x: exit.x, z: exit.z };
            ped.target.set(out[0].x, 0, out[0].z);
            routed = true;
          }
        }
      }
    }
    // NO cityNav (or it produced nothing usable): the original heuristic, intact.
    if (!routed) _fleeFallback(ped, x, z);
    // a RARE scream when genuine terror hits (high fear — gunfire/explosion/a body
    // dropping right by them, which is what drives fear that high). LONG per-ped
    // cooldown AND a small chance, on top of the hard city-wide gap in scream(),
    // so it only PUNCTUATES the worst moments instead of every startled bolt.
    if (ped.fear >= 8 && (ped._screamT || 0) <= 0) { ped._screamT = 18 + rng() * 14; if (rng() < 0.12) scream(); }
  }

  // FLEE along a CLEAR path: sample several headings biased away from the threat
  // and pick the most open one, so a panicked ped doesn't sprint into a wall.
  // Also looks for cover the first time it bolts. This is the LAST-RESORT branch
  // (cityNav absent / no route) AND reproduces TODAY's behaviour exactly when
  // citynav.js isn't loaded. (The scream now lives in fleeFrom so it fires once
  // per panic regardless of which branch ran.)
  const FLEE_OFFS = [0, 0.5, -0.5, 1.0, -1.0, 1.7, -1.7, 2.6];
  function _fleeFallback(ped, x, z) {
    ped.path = null;
    const ax = ped.pos.x - x, az = ped.pos.z - z, m = Math.hypot(ax, az) || 1;
    let baseAng = Math.atan2(ax / m, az / m);      // straight away from the threat
    // BIAS the meek/wary toward HELP rather than a blind away-vector: run to the
    // nearest cop (running TO police is a louder call for help) or duck into the
    // nearest shop door (shelter). Only when that refuge is roughly away from the
    // threat (never run THROUGH the danger), and the clear-path sampling below
    // still vets the actual heading so they don't sprint into a wall.
    if (ped.aggr < (A0().bold || 0.5) && ped.fear > 3 && (ped._refugeT || 0) <= 0) {
      ped._refugeT = 2.5;
      let refuge = null;
      const cop = nearestCop(ped.pos.x, ped.pos.z, 50);
      if (cop) refuge = { x: cop.pos.x, z: cop.pos.z };
      else {
        const A = CBZ.city && CBZ.city.arena;
        if (A && A.shopLots && A.shopLots.length) {
          let bd = 40 * 40, best = null;
          for (let i = 0; i < A.shopLots.length; i++) {
            if (A.shopLots[i].demolished) continue;
            const d = A.shopLots[i].building && A.shopLots[i].building.door; if (!d) continue;
            const dd = (d.x - ped.pos.x) * (d.x - ped.pos.x) + (d.z - ped.pos.z) * (d.z - ped.pos.z);
            if (dd < bd) { bd = dd; best = d; }
          }
          if (best) refuge = { x: best.x, z: best.z };
        }
      }
      if (refuge) {
        const rx = refuge.x - ped.pos.x, rz = refuge.z - ped.pos.z, rm = Math.hypot(rx, rz) || 1;
        // only steer toward the refuge if it isn't back toward the threat
        if ((rx / rm) * (ax / m) + (rz / rm) * (az / m) > -0.2) baseAng = Math.atan2(rx / rm, rz / rm);
      }
    }
    // try the straight-away heading, then progressively wider sidesteps
    // (module-level and READ-ONLY: at panic onset most of the street calls this
    // in the same frame, and a fresh literal each time is pure garbage)
    let bx = ped.pos.x + Math.sin(baseAng) * 22, bz = ped.pos.z + Math.cos(baseAng) * 22, found = false;
    for (let k = 0; k < FLEE_OFFS.length; k++) {
      const a = baseAng + FLEE_OFFS[k];
      const ux = Math.sin(a), uz = Math.cos(a);
      if (dirClear(ped, ux, uz, 7)) { bx = ped.pos.x + ux * 22; bz = ped.pos.z + uz * 22; found = true; break; }
    }
    ped.target.set(bx, 0, bz);
    // EVERY sampled away-heading was blocked: fall back to a sidewalk point, but
    // VET it with dirClear so we don't just pick a fresh target straight through a
    // building. Try a few; if none is reachable, hold position (better to freeze a
    // beat than to bolt into a wall — the next think pass re-picks).
    if (!found && CBZ.city && CBZ.city.arena) {
      const A = CBZ.city.arena;
      let placed = false;
      for (let t = 0; t < 4; t++) {
        const p = A.randomSidewalkPoint();
        const ux = p.x - ped.pos.x, uz = p.z - ped.pos.z, um = Math.hypot(ux, uz) || 1;
        if (dirClear(ped, ux / um, uz / um, Math.min(7, um))) { ped.target.set(p.x, 0, p.z); placed = true; break; }
      }
      if (!placed) ped.target.set(ped.pos.x, 0, ped.pos.z);
    }
  }

  // NEIGHBOUR GATHER for CBZ.moves' predictive avoidance (alloc-free): the
  // nearest NBR_CAP live, on-foot bodies around `ped` from the per-frame ped
  // grid (3x3 cells), nearest first, into the shared _nbrO array. The motor
  // reads each one's pos and its own motor velocity (`_mv`), so two walkers
  // see where the other is GOING, not only where he is. A calm walker also
  // counts the player as a body to pass (he has no motor: a standing man).
  // The shared array is safe: move() consumes it inside the same call.
  const NBR_CAP = 8, NBR_R2 = 3.5 * 3.5;
  function gatherNbrs(ped, withPlayer) {
    let n = 0;
    if (_pedGrid) {
      const gx = _pedGrid.cellIndex(ped.pos.x), gz = _pedGrid.cellIndex(ped.pos.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const cell = _pedGrid.bucket(cx, cz); if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const o = cell[i];
          // (the man he is going FOR is a goal, not an obstacle to pass)
          if (o === ped || o === ped.rage || o.dead || o.inCar || o._parked || o.enterT > 0) continue;
          const ox = o.pos.x - ped.pos.x, oz = o.pos.z - ped.pos.z, od2 = ox * ox + oz * oz;
          if (od2 > NBR_R2 || od2 < 0.0004) continue;
          // keep the closest N (bounded insertion, no allocation, spawn order irrelevant)
          let at;
          if (n < NBR_CAP) { at = n; n++; }
          else {
            if (od2 >= _nbrD2[NBR_CAP - 1]) continue;
            at = NBR_CAP - 1;
          }
          while (at > 0 && _nbrD2[at - 1] > od2) { _nbrD2[at] = _nbrD2[at - 1]; _nbrO[at] = _nbrO[at - 1]; at--; }
          _nbrD2[at] = od2; _nbrO[at] = o;
        }
      }
    }
    const P = withPlayer && CBZ.player;   // (callers pass it only for calm strollers)
    if (P && !P.dead && !P.driving && P.pos && n < NBR_CAP) {
      const ox = P.pos.x - ped.pos.x, oz = P.pos.z - ped.pos.z;
      if (ox * ox + oz * oz < NBR_R2) { _nbrO[n] = P; _nbrD2[n] = ox * ox + oz * oz; n++; }
    }
    return n;
  }

  // RALLY — YOU NEVER JUMP ONE OF THEM, YOU JUMP THE BLOCK (OR THE UNIT).
  // A hit on a ganger, or a soldier in a formation, asks CBZ.brain who of his
  // side is close enough to see it and HOW HARD each one answers
  // (social.retaliate via city/brain_city.js): the harm sets the ceiling — a
  // shove gets glares and shoves, a beating gets fists, a gun gets guns — and
  // each man's grudge, aggression, loyalty and courage climb toward it. The
  // old rally sent every bold member at the intruder at full rage whatever
  // was done; a slap on a corner brought four men and their pistols.
  // `harm` (0..1) is optional; brain_city derives it from the aggressor's gun,
  // the victim's wounds and open war. The side is the gang, or (flag
  // CITY_ORG_RALLY) the organisation — a rifleman whose mate was shot comes.
  function rallySideOf(a) {
    if (!a) return null;
    if (a.gang) return "gang:" + a.gang;
    if (CBZ.CONFIG.CITY_ORG_RALLY === false) return null;
    if (a.organization) return "org:" + a.organization;
    return null;
  }
  if (CBZ.CONFIG.CITY_ORG_RALLY == null) CBZ.CONFIG.CITY_ORG_RALLY = true;

  function rallyGang(ped, intruder, harm) {
    if (!intruder || intruder.dead || !rallySideOf(ped) || !CBZ.cityBrain) return;
    CBZ.cityBrain.retaliate(ped, intruder, harm);
  }

  // is there an intruder in this gangster's turf they should attack?
  function turfIntruder(ped, px, pz, playerArmed) {
    const G = ped.guard, R2 = 13 * 13;
    // the player, if hot/armed/provoked the gang, standing in turf
    const dP = (px - G.x) * (px - G.x) + (pz - G.z) * (pz - G.z);
    const prov = CBZ.cityGangProvoked ? CBZ.cityGangProvoked(ped.gang) : 0;
    if (!CBZ.player.dead && dP < R2 && (prov > 0.4 || (playerArmed && (CBZ.game.wanted | 0) >= 1))) {
      if ((ped._rallyT || 0) <= 0) { rallyGang(ped, CBZ.city.playerActor, 0.35 + prov * 0.5); ped._rallyT = 6; }
      return CBZ.city.playerActor;
    }
    // a rival gangster in turf
    const rival = nearestActor(ped, 12, _naRivalGang);
    if (rival) {
      const dr = (rival.pos.x - G.x) * (rival.pos.x - G.x) + (rival.pos.z - G.z) * (rival.pos.z - G.z);
      if (dr < R2 * 1.6) {
        if ((ped._rallyT || 0) <= 0) { rallyGang(ped, rival); ped._rallyT = 6; }
        return rival;
      }
    }
    return null;
  }

  // ---- TURF STANDOFF: notice, warn, warn again, then fight ----
  // turfIntruder only ever fired once the set was ALREADY provoked (or you were
  // wanted and armed), so a stranger could stroll through a corner crew with a
  // rifle out and nobody looked up, and the first sign of life was a volley.
  // Now the crew reads the gun: whoever sees you first squares up, gun levelled,
  // and says so; the rest of the set on that post turns and holds. A second,
  // harder warning follows if you stay; if you stay after THAT (or walk right
  // up on them) the set is provoked and turfIntruder's rally takes it from
  // there. Put the gun away or leave the block and the clock resets. The state
  // is per GANG (one voice, one ladder), not per member, so a crew of six does
  // not bark six warnings. Cost: a few compares per guard think, no scans.
  const TW_WARN = [
    ["Ay. Put that away.", "You lost?", "Wrong corner to be waving that."],
    ["I'm not saying it again. Walk.", "Last time. Turn around.", "You got about two seconds."],
    ["Light him up!", "He wants it. Get him!", "That's it. Run him off!"],
  ];
  const TW_EASE = ["Yeah. Keep walking.", "Smart.", "That's what I thought."];
  function standDown(ped) { if (ped._twPose) { ped._twPose = false; ped.poseAimBack = false; } }
  function turfStandoff(ped, px, pz, dpl, playerArmed) {
    if (!ped.gang || CBZ.player.dead || ped.surrender || ped.restraint) { standDown(ped); return false; }
    const gang = CBZ.cityGangById ? CBZ.cityGangById(ped.gang) : null;
    const host = gang ? gangHostility(ped) : 0;
    if (!gang || gang.isPlayer || gang.playerFriendly || host < 0) { standDown(ped); return false; }
    const G = ped.guard;
    const now = (CBZ.now || 0) / 1000;
    const W = gang._tw || (gang._tw = { stage: 0, t: 0, seen: -1e9, eased: false });
    const gdx = px - G.x, gdz = pz - G.z;
    const trespass = gdx * gdx + gdz * gdz < 16 * 16 && dpl < 15 && (playerArmed || host >= 1);
    if (W.stage > 0 && W.stage < 3 && now - W.seen > 4) {
      W.stage = 0;                       // nobody on the set has seen the gun for 4 s: the visit is over
    }
    if (W.stage >= 3 && (CBZ.cityGangProvoked ? CBZ.cityGangProvoked(ped.gang) : 0) < 0.2) W.stage = 0;   // the grudge cooled off
    if (!trespass) {
      // you put it away (or backed off) mid-warning: one of them says so, once
      if (ped.state === "confront" && W.stage > 0 && W.stage < 3 && !W.eased && !playerArmed && dpl < 20) { W.eased = true; citySayBark(ped, pick(TW_EASE, rng()), 1.4); }
      standDown(ped); return false;
    }
    W.seen = now;
    // at open WAR there is nothing to warn about: you are the enemy on sight
    if (host === 2 && W.stage < 2) { W.stage = 2; W.t = -1e9; }
    if (W.stage >= 3) { standDown(ped); ped.rage = CBZ.city.playerActor; ped.state = "fight"; return true; }
    // HOLD THE CORNER: square up where you stand, face him, gun levelled if you have one
    ped.state = "confront"; ped.path = null; ped.speed = 0;
    ped.target.set(ped.pos.x, 0, ped.pos.z);
    ped.pause = Math.max(ped.pause, 0.6);
    faceTo(ped, px, pz, 1.5);
    if (ped.armed && !ped._twPose) { ped._twPose = true; ped.poseAimBack = true; }
    if (W.stage === 0) {
      W.stage = 1; W.t = now; W.eased = false;
      citySayBark(ped, pick(TW_WARN[0], rng()), 2.2);
    } else if (W.stage === 1 && (now - W.t > 4.5 || dpl < 4)) {
      W.stage = 2; W.t = now;
      citySayBark(ped, pick(TW_WARN[1], rng()), 2.0);
    } else if (W.stage === 2 && (now - W.t > 3.5 || dpl < 3)) {
      W.stage = 3; W.t = now;
      citySayBark(ped, pick(TW_WARN[2], rng()), 1.6);
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
      standDown(ped);
      ped.rage = CBZ.city.playerActor; ped.state = "fight";
      if ((ped._rallyT || 0) <= 0) { rallyGang(ped, CBZ.city.playerActor, 0.7); ped._rallyT = 6; }   // "Light him up!"
    }
    return true;
  }

  function markGunpoint(ped, hold) {
    if (!ped || ped.dead || ped.ko > 0 || ped.vendor || ped.controlled) return false;
    const B = A0();
    const boldEnough = ped.aggr >= (B.crook || 0.72) && (ped.armed || ped.aggr >= (B.violent || 0.88));
    if (ped.armed || boldEnough) return false;   // armed peds draw + aim back, never surrender
    ped.surrenderT = Math.max(ped.surrenderT || 0, hold || 0.55);
    ped.surrender = true;
    ped.state = "surrender";
    ped.speed = 0;
    ped.pause = Math.max(ped.pause || 0, 0.35);
    ped.fear = Math.max(ped.fear || 0, 10);
    ped.alarmed = Math.max(ped.alarmed || 0, 2.5);
    ped.robbable = true;
    ped.rage = null;
    // reactions.js reads poseHandsUp to drive the rich arm pose + fear face for
    // city peds (mirrors the jail npc flag); char.handsUp keeps the base pose.
    ped.poseHandsUp = true; ped.poseAimBack = false;
    if (ped.reportState) cancelReport(ped);
    if (ped.group && CBZ.player && CBZ.player.pos) {
      const dx = CBZ.player.pos.x - ped.pos.x, dz = CBZ.player.pos.z - ped.pos.z;
      if (dx * dx + dz * dz > 0.04) faceYaw(ped, Math.atan2(dx, dz), 1.0);
    }
    // NB: do NOT set ped.char.surrender/handsUp — that makes character.js ALSO
    // pose the arms (forward + a slight lean), fighting reactions.js and producing
    // the "bowing" look. reactions.js owns the city hands-up pose via poseHandsUp;
    // the ped-level freeze (ped.surrender/state) above is what holds them still.
    return true;
  }
  CBZ.cityMarkGunpoint = markGunpoint;
  CBZ.cityFleeFrom = fleeFrom;     // sizeup.js: outclassed peds break and run
  CBZ.cityRallyGang = rallyGang;   // sizeup.js: hitting one ganger rallies the set

  // ============================================================
  //  CBZ.cityScare(actor, threat, opts) -> "bolt" | "freeze" | "hold"
  //
  //  OWNER (2026-07-27): "right now NPCs can't stand up and run away. Yes,
  //  with a gun pointed some should [put] hands up, but some should stand up
  //  and run away."
  //
  //  ONE answer to "somebody dangerous is right there — what does this person
  //  do", and the whole point is that it is NOT a coin flip. Every input is
  //  something the game already knows:
  //    • sizeup.js's citySizeUp already answers "does this person dare fight";
  //      anybody who dares, and can, is left to the brain they already have.
  //    • DISTANCE decides freeze vs. run. Nobody outruns a gun at four metres
  //      and everybody knows it, so a muzzle in your face FREEZES you and the
  //      same muzzle across the room makes you bolt.
  //    • PANIC IS CONTAGIOUS. Every bolt raises a decaying local panic field
  //      and the field feeds back into the next person's odds — which is what
  //      makes a stand empty as a WAVE instead of as N independent dice. Point
  //      a gun at a full bowl and the ripple outward IS the spectacle.
  //    • The choice is drawn from the person's OWN stable hash, not a die: the
  //      same person is always the one who runs. "A runner" is a character
  //      trait; re-rolling it every 3 seconds is what makes crowds read fake.
  //
  //  AND IT IS THE ONE PLACE A BODY GETS OUT OF A SEAT. npclife's syncAttached
  //  re-asserts an attached body's seat transform every frame, so a seated body
  //  cannot be nudged, shoved or scared out of a chair — DETACHING is the only
  //  exit and CBZ.cityUnseat (island_airport.js) is the shared call that does
  //  it. A propuse-seated body leaves through CBZ.propStand. Neither is
  //  re-implemented here.
  //
  //  Adoption is one line and it REPLACES the hands-up-or-run branch the caller
  //  was writing anyway (sizeup.js's citySizeUpFold is exactly that branch, and
  //  is now this). Degrade-safe: with peds.js absent every caller keeps its own
  //  inline fallback.
  // ============================================================
  const PANIC = [];
  const PANIC_R = 26, PANIC_LIFE = 7;
  CBZ.cityPanicRaise = function (x, z, amt) {
    PANIC.push({ x: x, z: z, a: amt || 1, t: 0 });
    if (PANIC.length > 32) PANIC.shift();
  };
  CBZ.cityPanicAt = function (x, z) {
    let s = 0;
    for (let i = 0; i < PANIC.length; i++) {
      const p = PANIC[i];
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 > PANIC_R * PANIC_R) continue;
      s += p.a * (1 - Math.sqrt(d2) / PANIC_R) * Math.max(0, 1 - p.t / PANIC_LIFE);
    }
    return Math.min(2.5, s);
  };
  // where is it COMING FROM? the panic-weighted centre of the field around
  // (x,z) — a bystander who only saw people running runs the way they ran.
  CBZ.cityPanicFrom = function (x, z, out) {
    let s = 0, sx = 0, sz = 0;
    for (let i = 0; i < PANIC.length; i++) {
      const p = PANIC[i];
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 > PANIC_R * PANIC_R) continue;
      const w = p.a * (1 - Math.sqrt(d2) / PANIC_R) * Math.max(0, 1 - p.t / PANIC_LIFE);
      s += w; sx += p.x * w; sz += p.z * w;
    }
    if (!(s > 0)) return false;
    out.x = sx / s; out.z = sz / s;
    return true;
  };
  function panicDecay(dt) {
    for (let i = PANIC.length - 1; i >= 0; i--) {
      PANIC[i].t += dt;
      if (PANIC[i].t > PANIC_LIFE) PANIC.splice(i, 1);
    }
  }

  CBZ.cityScare = function (a, threat, opts) {
    if (!a || a.dead || a.ko > 0 || a.isPlayer || a.controlled || a.vendor) return "hold";
    opts = opts || {};
    const now = (CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0));
    if ((a._scareUntil || 0) > now) return a._scareChoice || "hold";
    const tp = threat && threat.pos;
    const dist = tp ? Math.hypot(a.pos.x - tp.x, a.pos.z - tp.z) : 99;
    // trained bodies and anyone who dares hold their ground keep the brain they
    // already have — this function never overrides a fight.
    if (a.kind === "cop" || a.kind === "security" || a.rampage) return "hold";
    if (a.armed && (!CBZ.citySizeUp || CBZ.citySizeUp(a, threat))) return "hold";
    a._scareUntil = now + 3400;
    const attArmed = threat && (threat.isPlayer
      ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!threat.armed);
    // THE ANSWER IS THE BRAIN'S (threat.respond): distance, the gun, this
    // person's own nerve, and the panic around them (fed in as morale rattle
    // by brain_city — every bolt raises the field, so a stand empties as a
    // WAVE). A seat is a trap and they know it: sitting is extra rattle.
    let runs;
    const CB = CBZ.cityBrain;
    if (CB && CB.adopt(a)) {
      if (opts.seat && CBZ.brain.morale) CBZ.brain.morale.rattle(a, 0.12);
      if (opts.bias && CBZ.brain.morale) CBZ.brain.morale.rattle(a, Math.max(0, opts.bias));
      const r = CB.respond(a, threat || null, tp ? tp.x : a.pos.x, tp ? tp.z : a.pos.z, attArmed, attArmed && dist < 12, null);
      runs = r === "flee" || r === "cover";
    } else {
      runs = roleHash(a, 0x5CA7) < 0.16 + CBZ.cityPanicAt(a.pos.x, a.pos.z) * 0.34 + Math.min(0.44, dist * 0.028) - (attArmed && dist < 5.5 ? 0.38 : 0);
    }
    if (!runs && attArmed && markGunpoint(a, 2.4)) {
      a._scareChoice = "freeze";
      return "freeze";
    }
    // BOLT. Out of the seat FIRST — a held body cannot flee, and the hold is
    // re-asserted every frame, so anything short of a detach is a body running
    // on the spot in its chair.
    if (a._npcAttached && CBZ.cityUnseat) { try { CBZ.cityUnseat(a, { state: "flee" }); } catch (e) {} }
    else if ((a._propSeat || a._deskAnchor) && CBZ.propStand) { try { CBZ.propStand(a); } catch (e) {} }
    a.surrender = false; a.surrenderT = 0; a.poseHandsUp = false; a.poseAimBack = false;
    a.rage = null; a.pause = 0;
    a.fear = Math.max(a.fear || 0, 10);
    a.alarmed = Math.max(a.alarmed || 0, 6);
    if (tp) fleeFrom(a, tp.x, tp.z); else a.state = "flee";
    CBZ.cityPanicRaise(a.pos.x, a.pos.z, 1);
    a._scareChoice = "bolt";
    return "bolt";
  };

  // ============================================================
  //  GUNPOINT SWEEP (every frame, cheap) — give the WHOLE near crowd the jail's
  //  expressive HANDS-UP the instant the player points a gun at them, instead of
  //  waiting for the time-sliced think() to come around (which lagged + only
  //  surrendered ONE ped per pass). We do a cone test from the camera aim each
  //  frame for peds in range and:
  //    • meek/non-bold  → markGunpoint (hands up, frozen, robbable) — held while
  //                       covered, then RELAXED a moment after you look away.
  //    • bold + armed   → poseAimBack (gun arm levelled at you) for the stand-off,
  //                       handled by reactions.js; their fight logic stays in think.
  //  This sets the pose flags reactions.js consumes; the existing think() gunpoint
  //  branch (surrender/fight decision) is preserved untouched.
  // ============================================================
  // ONE body's answer to the levelled gun. Shared by both routes below so the
  // grid path cannot drift from the linear one.
  function _gunpointOne(ped, dt, px, pz, fx, fz, B, P) {
    if (!ped || ped.dead || ped.vendor || ped.ko > 0 || ped.controlled || ped.companion || ped._parked || ped.recruited) return;
    const dx = ped.pos.x - px, dz = ped.pos.z - pz, d2 = dx * dx + dz * dz;
    if (d2 > 121) {                                  // out of 11m gunpoint range → relax
      if (ped._covered) { _relaxGunpoint(ped, dt); }
      return;
    }
    const d = Math.sqrt(d2) || 1;
    const aimedAtMe = (dx / d) * fx + (dz / d) * fz > 0.66;   // ped inside the aim cone
    if (aimedAtMe) {
      ped._coverGrace = 0.6;                          // hold the pose for a beat after look-away
      ped._covered = true;
      _coverAdd(ped);                                 // so the relax pass can find it anywhere
      // ANYONE holding a gun squares up and levels it BACK — a guy with a gun
      // never throws his hands up. A fearless unarmed bruiser also stands his
      // ground. Everyone else (unarmed, not fearless) throws their hands up.
      // (an unarmed bruiser used to "stand his ground" here, squared up to a
      // muzzle with empty hands; against a gun only a gun fights — the brain
      // reads him through cityScare: bolt, or hands up)
      const drawsBack = ped.armed || !!ped._holster;
      if (drawsBack) {
        if (ped.state !== "fight") { ped.poseAimBack = true; ped.poseHandsUp = false; }
      } else if (ped._npcAttached || ped._propSeat || ped._deskAnchor || ped.state === "sit" || ped.aggr >= (B.violent || 0.88)) {
        // A HELD BODY GETS THE BRANCH, NOT THE FREEZE. Everyone in a seat used
        // to land on markGunpoint alone, which is why a stadium, a gate lounge
        // and an office floor all reacted to a levelled gun by sitting
        // perfectly still: the freeze was the ONLY option a seated body had.
        // cityScare decides freeze-vs-bolt from the read and, when it is bolt,
        // is the one thing that can actually get them out of the chair.
        CBZ.cityScare(ped, CBZ.city && CBZ.city.playerActor ? CBZ.city.playerActor : P, { seat: true });
      } else {
        // meek/scared: throw hands up + freeze. markGunpoint owns the full state.
        markGunpoint(ped, 0.4);
      }
    } else if (ped._covered) {
      _relaxGunpoint(ped, dt);
    }
  }
  function gunpointSweep(dt) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving) { _clearGunpointPoses(); return; }
    const playerArmed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    if (!playerArmed) { _clearGunpointPoses(); return; }
    const B = A0();
    const cy = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(cy), fz = -Math.cos(cy);
    const px = P.pos.x, pz = P.pos.z;
    // GRID ROUTE. This runs immediately after rebuildPedGrid and before a single
    // body has moved this frame, so the index holds the EXACT positions the old
    // whole-crowd walk would have read — margin 0, no staleness, and 11m needs
    // ceil(11/4)=3 cells each side. The index deliberately holds passengers and
    // bodies mid-doorway too: a gun levelled through a windscreen is still a gun.
    if (_scanOn && _collect(_gpBuf, px, pz, 11, 0)) {
      _audit.gridRoutedCalls++;
      for (let i = 0; i < _gpBuf.length; i++) {
        const ped = _gpBuf[i];
        ped._gpSeen = frame;                       // claimed by the in-range pass
        _gunpointOne(ped, dt, px, pz, fx, fz, B, P);
      }
      // RELAX TAIL: the old walk reached every held body wherever it stood. The
      // cells only reach the near ones, so anybody still holding a pose that the
      // cells did NOT reach is by definition out of range and relaxes here —
      // exactly once per frame, which matters because _relaxGunpoint is what
      // ticks _coverGrace down. Compacts the list in place as poses release.
      for (let i = _coverList.length - 1; i >= 0; i--) {
        const ped = _coverList[i];
        if (!ped._covered) { ped._inCoverList = false; _coverList.splice(i, 1); continue; }
        if (ped._gpSeen === frame) continue;
        if (ped.dead || ped.vendor || ped.ko > 0 || ped.controlled || ped.companion || ped._parked || ped.recruited) continue;
        _relaxGunpoint(ped, dt);
      }
      return;
    }
    _audit.linearFallbackCalls++;
    const peds = CBZ.cityPeds;
    _audit.linearVisited += peds.length;
    for (let i = 0; i < peds.length; i++) _gunpointOne(peds[i], dt, px, pz, fx, fz, B, P);
  }
  // ease a ped out of a gunpoint pose once you stop aiming at it (after a grace
  // window), letting it return to whatever it was doing.
  function _relaxGunpoint(ped, dt) {
    if ((ped._coverGrace -= dt) > 0) return;
    ped._covered = false; ped._coverGrace = 0;
    ped.poseAimBack = false;
    // RELEASE: fully tear down the surrender state, NOT gated on surrenderT.
    // markGunpoint re-arms surrenderT every aimed frame, so a ped actually held
    // at gunpoint never reaches here (it stays _covered); only the genuine
    // release path (holster / fists / aim away / out of range, past _coverGrace)
    // runs this. Previously this was gated behind surrenderT<=0 and never cleared
    // ped.surrender/surrenderT, so move()'s surrendering check stayed true forever
    // and the hands re-raised every frame.
    if (ped.poseHandsUp || ped.surrender || ped.state === "surrender") {
      ped.poseHandsUp = false;
      ped.surrender = false;
      ped.surrenderT = 0;
      if (ped.char) { ped.char.handsUp = false; ped.char.surrender = false; }
      if (ped.state === "surrender") ped.state = "walk";
    }
  }
  // Drop every held pose. This is the branch the sweep takes whenever you are
  // NOT holding a gun — i.e. most frames of most sessions — so walking the whole
  // crowd here cost more over a session than the aimed path ever did. The only
  // bodies it can act on are the ones holding a pose, and that is the list.
  function _clearGunpointPoses() {
    if (_scanOn) {
      _audit.listRoutedCalls++;
      for (let i = 0; i < _coverList.length; i++) {
        const ped = _coverList[i];
        ped._inCoverList = false;
        if (ped && ped._covered) { ped._coverGrace = 0; _relaxGunpoint(ped, 999); }
      }
      _coverList.length = 0;      // 999 forces the release, so nothing stays covered
      return;
    }
    _audit.linearFallbackCalls++;
    const peds = CBZ.cityPeds;
    _audit.linearVisited += peds.length;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      if (ped && ped._covered) { ped._coverGrace = 0; _relaxGunpoint(ped, 999); }
    }
    // keep the bookkeeping honest on the legacy path too, so flipping the flag
    // back ON never inherits a list full of bodies that let go long ago.
    for (let i = 0; i < _coverList.length; i++) _coverList[i]._inCoverList = false;
    _coverList.length = 0;
  }

  // ---- movement / engagement ----
  /* THE FEET ARE ON THE GROUND. move() used to end with `pos.y = 0` for every
     living body, so a ped standing on anything the world raised — the
     Executive Mansion's 0.30 m stylobate, a hall slab, motor-court paving, a
     graded relief — stood in it to the shins while the player beside him read
     CBZ.groundAt and stood on top. One law for both now: physics.js's
     groundAt (floorAt + the platform grid + moving decks). One exception the
     world already owns: a body occupy.js lifted to a storey with NO floor
     under him (a deck nobody registered as a platform) is held there by its
     sweep; a lifted body standing on a real floor (`_floorReal`, set by that
     sweep) is an ordinary resident of the floor and his feet are ours, so he
     can take the stairs.
     Sampled every frame on camera (a body on a stair must not step in 4 Hz),
     every FEET_FAR_T beyond FEET_NEAR. The step itself is CBZ.moves.feet —
     the one rule every AI body's height obeys (eased inside a step, a real
     fall off an edge). Flag PED_FEET_V1 (off → y = 0, as shipped). */
  const FEET_NEAR2 = 90 * 90, FEET_FAR_T = 0.4;
  if (CBZ.CONFIG.PED_FEET_V1 == null) CBZ.CONFIG.PED_FEET_V1 = true;
  function settleFeet(ped, dt) {
    const pos = ped.pos;
    if (CBZ.CONFIG.PED_FEET_V1 === false || !CBZ.groundAt) { pos.y = 0; return; }
    if (ped._occupyY > 0.2 && !ped._floorReal) return;
    const P = CBZ.player && CBZ.player.pos;
    const near = !P || ((pos.x - P.x) * (pos.x - P.x) + (pos.z - P.z) * (pos.z - P.z)) < FEET_NEAR2;
    // a body that is far, or standing still, reuses its last sample for a while
    if (!near || !(ped.speed > 0.05)) {
      ped._feetT = (ped._feetT || 0) - (dt || 0);
      if (ped._feetT > 0 && ped._feetY != null) { if (!near) pos.y = ped._feetY; return; }
      ped._feetT = near ? 0.25 : FEET_FAR_T;
    }
    const M = CBZ.moves;
    if (near && M && M.feet) {
      const g = M.feet(ped, pos, dt);
      ped._feetY = g != null ? g : pos.y;
      return;
    }
    // far: a coarse sample, placed (nobody sees a far body ease)
    let g = M && M.ground ? M.ground(pos.x, pos.z, pos.y) : null;
    if (g == null) { try { g = CBZ.groundAt(pos.x, pos.z, pos.y); } catch (e) { g = 0; } }
    if (!Number.isFinite(g)) g = 0;
    ped._feetY = g;
    pos.y = g;
  }
  CBZ.cityPedSettleFeet = settleFeet;

  /* FACING IS A TURN, NOT A WRITE. Deciders (think(), the micro-behaviours,
     the gunpoint/greet/film reactions) run at 4-20 frame strides; a snap to
     atan2(...) there was a one-frame 180 on a standing body. They now say
     WHICH WAY and for how long (faceTo / faceYaw), and move() turns the body
     there every frame through CBZ.moves at the motor's bounded rate. A held
     facing only steers a body that is not travelling: a walker faces where he
     walks, then turns to the thing once he has stopped. */
  function faceYaw(ped, yaw, hold) {
    ped._faceYaw = yaw; ped._faceHold = Math.max(ped._faceHold || 0, hold || 0.6);
  }
  function faceTo(ped, x, z, hold) {
    const dx = x - ped.pos.x, dz = z - ped.pos.z;
    if (dx * dx + dz * dz < 1e-4) return;
    faceYaw(ped, Math.atan2(dx, dz), hold);
  }
  CBZ.cityPedFaceTo = faceTo;
  CBZ.cityPedFaceYaw = faceYaw;   // city/brain_city.js's executor faces through here
  /* A body that stops for something (a chat, a look at you, a stall, a post)
     stops its MOTOR as well: `brake` bleeds the walk off through the motor
     (a few tenths of a second, no pop); without it the motor is simply
     forgotten (a rooted vendor). Any held facing turns at the bounded rate. */
  const _mvStop = { speed: 0, stop: 0.3, face: null, lod: 1 };
  function standStill(ped, dt, brake) {
    const Mv = CBZ.moves; if (!Mv || !ped.group) return;
    const m = Mv.motor(ped);
    if (ped._faceHold > 0) ped._faceHold -= dt;
    const held = ped._faceHold > 0 ? ped._faceYaw : null;
    if (brake && m.speed > 0.05) {
      _mvStop.face = held;
      Mv.step(m, ped.pos, ped.group.rotation.y, ped.pos.x + m.vx, ped.pos.z + m.vz, _mvStop, dt);
      ped.group.rotation.y = m.yaw;
      if (CBZ.collide) CBZ.collide(ped.pos, PED_R, ped.pos.y + PED_FOOT, ped.pos.y + 1.7);
      return;
    }
    if (m.vx || m.vz || m.gs) Mv.reset(m, ped.pos);
    else { m.lx = ped.pos.x; m.lz = ped.pos.z; }
    // A LOOK IS HEAD FIRST (CBZ.moves.look): the head turns to the thing, the
    // feet follow only if the look holds. A fighter squaring up, or a man with
    // his gun out, turns his whole body at the motor's rate as before.
    if (held != null) {
      const combat = ped.state === "fight" || (ped._gd && ped._gd.lv >= 2);
      if (Mv.look && !combat) { ped.group.rotation.y = Mv.look(m, ped.group.rotation.y, held, dt); lookNeck(ped, m.neck); }
      else { ped.group.rotation.y = Mv.face(m, ped.group.rotation.y, held, dt); lookNeck(ped, Mv.lookRelax ? Mv.lookRelax(m, dt) : 0); }
    } else if (m.neck) lookNeck(ped, Mv.lookRelax(m, dt));
  }
  /* The head's share of a look rides the neck as an OFFSET (what we added
     last frame is taken back first), so it composes with the other neck
     writers (the ready pose's baked counter-turn, a stance's look) instead of
     overwriting them. Only a drawn body: off-screen nobody sees a head turn. */
  function lookNeck(ped, v) {
    const ch = ped.char, nk = ch && ch.neck;
    if (!nk) return;
    const was = ch._lookNeck || 0;
    if (Math.abs(v - was) < 1e-4) return;
    nk.rotation.y += v - was;
    ch._lookNeck = v;
  }

  // scratch options for the motor step (one per call, reused: no allocation)
  const _mo = {
    speed: 0, stop: 0.45, leg: false, accel: 3.6, face: null, strafe: false,
    vffX: 0, vffZ: 0, nbrs: null, nbrN: 0, radius: 0.32, lod: 0,
  };

  function move(ped, dt, animate, lod) {
    if (lod == null) lod = animate ? 0 : 2;
    // physics.js owns the short vault/mantle trajectory once this pedestrian
    // commits. Keep it ahead of face/chat/wander steering so those ordinary
    // behaviours cannot pull the body back to the near side halfway through.
    const traversal = CBZ.characterTraversal;
    if (ped._traversal) {
      const ph = ped._phys;
      const interrupted = ped.dead || ped.inCar || ped.controlled || ped.ko > 0 ||
        (ph && (ph.air || ph.down > 0 || ph.heldBy));
      if (!traversal || !ped.char || interrupted) {
        if (traversal) traversal.cancel(ped, ped.char, false);
        else ped._traversal = null;
      } else if (traversal.step(ped, ped.char, dt, animate)) {
        return;
      }
    }

    // walked up to interact? they at least turn and LOOK at you (flag refreshed
    // by city/interact.js each frame the panel targets them). Calm people stop
    // and face you; someone fleeing / fighting / surrendering is too busy.
    if (ped._faceT > 0) {
      ped._faceT -= dt;
      const busy = ped.controlled || ped.state === "flee" || ped.state === "fight" || ped.state === "confront" || ped.state === "surrender";
      if (!busy) {
        // _faceAt: a point they turn to instead of you (a local pointing the
        // way, city/interactions_rich.js); it lives exactly as long as _faceT
        const fa = ped._faceAt;
        if (fa) faceTo(ped, fa.x, fa.z, 0.3);
        else faceTo(ped, CBZ.player.pos.x, CBZ.player.pos.z, 0.3);
        if (ped._faceT <= 0) ped._faceAt = null;
        standStill(ped, dt, !ped.vendor);
        ped.speed = 0; ped.pause = Math.max(ped.pause, 0.3);
        if (animate) animChar(ped.char, ped._mv ? ped._mv.gs : 0, dt);
        if (!ped.vendor) { if (CBZ.collide) CBZ.collide(ped.pos, PED_R, ped.pos.y + PED_FOOT, ped.pos.y + 1.7); settleFeet(ped, dt); }
        return;
      }
    }
    if (ped.vendor) { standStill(ped, dt, false); if (animate) animChar(ped.char, 0, dt); return; }
    if (ped.staffPost) {
      // POSTED STAFF root exactly like a vendor (no movement integration, no
      // wander) BUT — unlike a vendor — they SHOW the gunpoint hands-up. The
      // gunpointSweep/markGunpoint set ped.surrender (they aren't ped.vendor, so
      // the sweep sees them); we return before move()'s own surrender→char.handsUp
      // translation, so mirror it here. The held pose (ped.char.pose, via animChar)
      // shows while calm; hands-up overrides it (animChar's arm precedence).
      if (ped.surrenderT > 0) { ped.surrenderT = Math.max(0, ped.surrenderT - dt); ped.surrender = true; }
      const surr = ped.surrender || ped.surrenderT > 0 || ped.state === "surrender";
      if (ped.char) { ped.char.surrender = false; ped.char.handsUp = !!surr; }
      if (surr) ped.poseHandsUp = true; else if (ped.poseHandsUp && !ped._covered) ped.poseHandsUp = false;
      ped.speed = 0;
      standStill(ped, dt, false);
      if (animate) animChar(ped.char, 0, dt);
      settleFeet(ped, dt);                       // a butler on the stylobate stands ON it
      return;
    }
    if (ped.inCar) { ped.speed = 0; if (ped._mv) CBZ.moves.reset(ped._mv, null); return; }   // out on the road; vehicles.js drives it
    if (ped.callT > 0) ped.callT -= dt;
    if (ped.chatT > 0) {
      ped.chatT -= dt; ped.speed = 0;
      standStill(ped, dt, true);
      if (animate) animChar(ped.char, ped._mv ? ped._mv.gs : 0, dt);
      if (ped.chatT <= 0) ped.state = "walk";
      return;
    }
    if (ped.attackCD > 0) ped.attackCD -= dt;
    if (ped.shootCD > 0) ped.shootCD -= dt;
    if (ped.surrenderT > 0) {
      ped.surrenderT = Math.max(0, ped.surrenderT - dt);
      ped.surrender = true;
    }

    // A POSTURE TRANSITION OWNS THE BODY (CBZ.moves: sitting down, getting up,
    // lying down, climbing into a bunk). The sequencer writes the transform and
    // animates the rig after this mover; stepping, re-posing or "interrupt-
    // clearing" its half-folded sit here would fight it every frame.
    if (CBZ.moves && CBZ.moves.busy && CBZ.moves.busy(ped)) return;
    const st = ped.state;
    // SIT INTERRUPT (C3): a seated desk worker stays in state "sit" only while
    // nothing pulled it out. think() runs before move() and flips the state to
    // flee/fight/confront/surrender on ANY threat/hit/gunpoint; a hit also routes
    // through hurtActor (high fear → flee next think). So if the body still carries
    // char.sitting but is no longer in "sit", an interrupt happened — drop the seat
    // (animChar stops the seated pose) and let the new state (already set) run. We
    // also let go of the claimed desk so it frees up (optional-chain; officejobs.js).
    if (ped.char && ped.char.sitting && st !== "sit") {
      ped.char.sitting = false;
      ped.char.seatRef = null;   // release the chair solve with the chair
      ped.char.typing = false;   // stood up → hands off the keys (character.js tap loop)
      if (CBZ.cityReleaseDesk) CBZ.cityReleaseDesk(ped);
    }
    const surrendering = st === "surrender" || ped.surrender || ped.surrenderT > 0;
    if (ped.char) {
      // HANDS-UP must be HELD by animChar (character.js), exactly like the jail
      // crowd — animChar hard-damps the arms to the overhead surrender pose and
      // KEEPS them there. The old approach (leave char.handsUp OFF and let
      // reactions.js add the pose) decayed: animChar damps the arm channel back
      // toward idle every frame, and reactions' back-out/re-add additive can't
      // win that tug-of-war, so the hands shot up for a frame then sagged back
      // down (the "hands-up glitches back down" bug). Driving char.handsUp lets
      // animChar own the arms; reactions still adds the fear face + a tiny offset
      // on the already-raised base (no double-drive bow, because the poseHandsUp
      // SURRENDER branch adds no forward lean).
      ped.char.surrender = false;
      ped.char.handsUp = !!surrendering;
    }
    // keep the reactions.js pose flag in lock-step with the actual surrender state:
    // a ped that's surrendering has hands up; one whose surrender lapsed AND isn't
    // currently covered at gunpoint drops them (the gunpoint sweep owns the covered
    // case). This is what eases the arms back down when you look away / walk off.
    if (surrendering) ped.poseHandsUp = true;
    else if (ped.poseHandsUp && !ped._covered) ped.poseHandsUp = false;
    let spd = ped.baseSpeed;
    if (st === "flee") spd = ped.baseSpeed * 2.2;
    else if (ped.reportState === "run") spd = ped.baseSpeed * 2.0;   // sprint to the cop to snitch
    else if (st === "fight" || st === "confront") spd = ped.baseSpeed * 1.7;
    else if (st === "chat" || st === "idle" || st === "film" || st === "surrender" || st === "sit") spd = 0;
    if (surrendering) spd = 0;
    if (ped.drugUser && ped.erratic > 0 && spd > 0) spd *= 1 + ped.erratic * 0.16;
    // a jogger keeps a brisk clip on its normal walk (derived from the role, so it
    // costs nothing to clean up — never persisted onto baseSpeed).
    if (spd > 0 && (st === "walk" || st === "wander") && ped._role === "jogger") spd *= 1.5;
    // a shot leg, blood gone, still groggy from a knockout (systems/vitals.js)
    if (spd > 0 && ped._vt && CBZ.vitals) spd *= CBZ.vitals.speedMul(ped);
    // SOMEBODY CALLED YOU AND YOU ARE ACROSS THE STREET. city/boarding.js sets
    // this while a body is walking to a vehicle door (or to a dropped bag) far
    // enough away that a stroll would be absurd. It is a MULTIPLIER on the
    // shared mover, not a second one: the steering, the vault probe, the
    // depenetration and animChar's own run layer all still run, which is the
    // whole reason this is a flag and not a bespoke locomotion path.
    if (ped._boardRun && spd > 0) spd = Math.max(spd, ped.baseSpeed * 1.9);

    // ---- engagement ---------------------------------------------------------
    // WHY THIS LIVES IN move() AND NOT think(): think() is time-sliced (stride 4
    // for an active ped, 20 for a far one) while move() runs every frame for
    // anything visible or important. Tactical steering re-solved at 15 Hz reads
    // as a body twitching between decisions; the LOS/cover probes inside are
    // themselves throttled, so running the composition every frame costs a
    // handful of compares and buys smooth footwork.
    if (st === "fight" && ped.rage && !ped.rage.dead) {
      const d = Math.hypot(ped.rage.pos.x - ped.pos.x, ped.rage.pos.z - ped.pos.z);
      const IQ = iq();
      const prf = IQ && IQ.profile ? IQ.profile(ped) : null;
      // POSTURE (systems/combat_iq.js) — cover, the shooter token, the weapon's
      // own standoff band and the anti-clump spacing, written into ped.target,
      // which is the field this function already steers by. It returns the
      // slot: only a token holder is allowed to be shooting at all, which is
      // the whole answer to "a group of them all with guns is just chaos".
      let slot = "fire";
      if (IQ && IQ.posture && ped.armed && ped.ammo > 0) {
        slot = IQ.posture(ped, ped.rage, dt) || "fire";
        // a fighter is not running errands. A stale routine path left over from
        // before the fight would otherwise get shift()ed one node per frame the
        // moment the body settles onto its tactical point (the arrival branch
        // below consumes a path whenever it is standing on its target).
        if (ped.path) ped.path = null;
      }
      // THE 9 WAS THE BUG. Every armed NPC used to walk to 9.4 m before it was
      // allowed to pull the trigger, whatever it was holding — a rifleman closed
      // into shotgun range to open fire. The engagement distance is the WEAPON'S
      // now (pistol 14, rifle 26, sniper 46, shotgun 10).
      const gunner = !!(prf && prf.cls !== "none");
      // a fistfighter engages at the melee beat's own reach (the FSM needs to be
      // ticking while it circles at the edge of it); npcAttack still gates the
      // blow itself on 2.4 exactly as before.
      const want = gunner ? prf.hi + 0.4 : (ped.armed ? 9 : (ped._iqM ? 2.35 : 1.7));
      const mayFire = !gunner || slot === "fire" || slot === "peek";
      if (d <= want + 0.4 && mayFire) {
        npcAttack(ped, ped.rage, dt);
        // A FIGHTER HOLDING A POSITION IS NOT A STATUE, but one that has reached
        // the spot it chose should plant and shoot. The old code zeroed speed
        // for everybody the instant they were in range, which is why a firefight
        // was a row of parked bodies.
        const goalD = Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z);
        if (goalD < (gunner ? 0.9 : 0.5) || (!prf && !ped._iqM)) spd = 0;
      }
      // STOP TO SHOOT (systems/combat_iq.js 3b/3c). A gunner PLANTED on the
      // position it picked — or mid-burst anywhere — stands still and keeps
      // the spine on the mark. The old glitch lived exactly on this seam:
      // the mover lerped the body toward its goal heading every frame while
      // actorAimAt snapped it back at the target on every shot, and the
      // fighter ran-and-gunned through the tug-of-war. One contract now.
      if (gunner && IQ && IQ.moveGate) {
        const mg = IQ.moveGate(ped, ped.rage, d, slot);
        if (mg && mg.halt) {
          spd = 0;
          // the target can die inside this same frame (the gate firefight showed it): face it only while it exists
          if (ped.rage && ped.rage.pos) faceTo(ped, ped.rage.pos.x, ped.rage.pos.z, 0.25);
        }
      }
      // COMBAT FOOTWORK FACES THE MARK. A short tactical hop — a peek step,
      // a separation shuffle, sliding one position over — is a SIDE-STEP, not
      // a jog: the spine stays on the threat and the legs do the moving. Only
      // short hops in engagement range qualify; a real reposition sprint still
      // faces where it runs. The locomotion block reads _combatFace.
      // HELD, NOT RE-ASKED: footwork that started stays footwork until the hop
      // is clearly a run (6 m out), so a goal sitting near the 4.5 m line can
      // not flip the spine between the mark and the road every frame.
      const wasCf = ped._combatFace === ped.rage;
      ped._combatFace = null;
      if (gunner && spd > 0 && CBZ.CONFIG.NPC_IQ_POSITIONS !== false) {
        const goalD2 = Math.hypot(ped.target.x - ped.pos.x, ped.target.z - ped.pos.z);
        if (goalD2 < (wasCf ? 6 : 4.5) && d < prf.hi * 1.15 + (wasCf ? 7 : 4)) ped._combatFace = ped.rage;
      }
    } else {
      if (ped._iqM && CBZ.combatIQ && CBZ.combatIQ.meleeReset) CBZ.combatIQ.meleeReset(ped);   // fight's over — drop the beat state
      // release a held position ONLY when posture() has genuinely stopped
      // driving this body (drives() = fresh stamp). A COMPANION's posture runs
      // from companionThink while its state is force-held at 'walk' — clearing
      // unconditionally here would wipe its committed spot every frame.
      if (ped._iqPos && !(CBZ.combatIQ && CBZ.combatIQ.drives && CBZ.combatIQ.drives(ped))) {
        ped._iqPos = null; ped._iqPlant = false;
      }
      if (ped._combatFace) ped._combatFace = null;
    }

    // loot pickup (tied hands can't scoop a gun off the pavement)
    if (st === "loot" && !ped.restraint) {
      const di = nearestDrop(ped.pos.x, ped.pos.z, 1.6);
      if (di >= 0) { pedTakeDrop(ped, di); ped.state = "walk"; }
    }

    if (ped._screamT > 0) ped._screamT -= dt;
    if (ped.posePoint > 0) ped.posePoint -= dt;   // the snitch point-out gesture window
    if (ped._probeT > 0) ped._probeT -= dt;   // off-screen wall-steer rate gate
    if (ped._faceHold > 0) ped._faceHold -= dt; // a held facing (faceTo) runs out
    if (ped._traverseProbeT > 0) ped._traverseProbeT -= dt; // running obstacle probe
    if (ped._rampT > 0) ped._rampT -= dt;      // rampager re-target / re-arm cadence
    if (ped._sfCD > 0) ped._sfCD -= dt;        // shoot-first re-check cadence (combat_iq)
    /* HOW TO GET THERE, asked once everybody has finished saying WHERE.
       think(), the routine goal picker, the flee solver and the raid router
       have all written `target` by this line; city/pednav.js turns whatever it
       says into the next step of a walk that exists — round the block, through
       the door — and leaves it alone when the straight line is already clear.
       It has to be HERE, not in an updater ahead of this one: everything above
       writes `target` and this function integrates in the same breath. */
    /* THE MOVE-ORDER SEAM. Another system that wants to place a body — the
       President's detail and escorts (city/protection.js) — sets
       `ped.moveOrder = { x, z, speed, stop, face, vffX, vffZ, strafe, leg }`
       and this mover steps toward it through CBZ.moves instead of reading
       `target` and the state's speed. The owner clears it (null). An order
       stamped with the frame clock (`t`, CBZ.now ms) that its owner stopped
       re-issuing is dropped here after 0.5 s, so a system that forgets a body
       never leaves it walking to a dead order. */
    if (ped.moveOrder && ped.moveOrder.t > 0 && (CBZ.now || 0) - ped.moveOrder.t > 500) ped.moveOrder = null;
    const order = ped.moveOrder || null;
    // the order's owner decides the pace (a hostage marched at gunpoint walks with his hands up)
    if (order) spd = order.speed != null ? order.speed : ped.baseSpeed;
    /* A ROUTINE PATH IS WALKED THROUGH, NOT STOPPED AT. Interior points of
       `ped.path` advance the moment the body is within a stride of them (the
       motor carries its speed round the corner as a `leg`); only the last one
       is arrived at, which is where the errand's pause/enter beat happens. */
    if (!order && ped.path && ped.path.length) {
      const p0 = ped.path[0];
      const pdx = p0.x - ped.pos.x, pdz = p0.z - ped.pos.z;
      const pass = ped.path.length > 1 ? 1.2 : 0.6;
      if (pdx * pdx + pdz * pdz <= pass * pass) {
        ped.path.shift();
        if (ped.path.length) ped.target.set(ped.path[0].x, 0, ped.path[0].z);
        else {
          ped.path = null;
          if (ped.finalGoal && ped.finalGoal.enter && rng() < 0.5) { ped.enterT = 3 + rng() * 5; }
          ped.pause = Math.max(ped.pause, 0.4 + rng() * 1.5);
        }
      }
    }
    if (!order && CBZ.pedNav) CBZ.pedNav.step(ped, dt);
    const gx = order ? order.x : ped.target.x, gz = order ? order.z : ped.target.z;
    const dx = gx - ped.pos.x, dz = gz - ped.pos.z, dist = Math.hypot(dx, dz);
    if (ped.pause > 0) ped.pause -= dt;
    // SIT-DOWN (C3): an office worker routed to a CLAIMED desk (finalGoal.sitDesk,
    // C5) takes the seat the moment it gets within ~1.3m of the desk anchor. SNAP
    // the group exactly onto the anchor, face anchor.face, record the anchor on the
    // ped, raise the char.sitting flag (character.js animChar drops the hips / folds
    // the thighs into a seated pose) and switch to state "sit" so the speed-gate
    // above pins it at 0 for the shift. We return BEFORE the depenetration passes —
    // the anchor is an authored, known-good seat point; a seated body must not be
    // shoved around by the desk colliders. Any interrupt (handled in think()) flips
    // the state off "sit" and the top-of-move clear lets the body go. Only enter
    // sit while genuinely calm (no rage / fear is its own flee path / not fleeing).
    if (st !== "sit" && ped.finalGoal && ped.finalGoal.sitDesk && !ped.rage &&
        ped.state !== "flee" && ped.state !== "fight" && !surrendering) {
      const anc = ped.finalGoal.anchor || ped.finalGoal;     // {x,z,face} (C2 anchor / finalGoal carry it)
      const adx = anc.x - ped.pos.x, adz = anc.z - ped.pos.z;
      if (adx * adx + adz * adz <= 1.3 * 1.3) {
        // THE LAST METRE IS A SIT, NOT A SNAP (CBZ.moves, entities/moves_posture.js):
        // turn to the desk, back onto the chair, hips down with the soles
        // planted. deskSeated() does the bookkeeping below when the hips land;
        // the snap stays only for a body the sequencer refuses.
        if (CBZ.moves && CBZ.moves.sit) {
          const spot = { x: anc.x, y: anc.y || 0, z: anc.z, face: anc.face != null ? anc.face : ped.group.rotation.y,
            lot: anc.lot, kind: anc.kind || "office", cushionH: anc.cushionH, floorBelow: anc.floorBelow };
          if (CBZ.moves.sit(ped, spot, { onDone: deskSeated })) { ped.path = null; ped.speed = 0; ped.pause = 0; return; }
        }
        // SEAT FLOOR FIX: the anchor carries its own floor height (a desk on
        // storey 5 is not at y=0). The old hard-coded 0 sank every upper-floor
        // worker to street level; anchors that don't declare a y still read 0.
        const ancY = anc.y || 0;
        ped.pos.x = anc.x; ped.pos.z = anc.z; ped.pos.y = ancY;        // snap onto the seat
        ped.group.position.set(anc.x, ancY, anc.z);
        if (anc.face != null) ped.group.rotation.y = anc.face;         // face the desk
        ped._deskAnchor = { x: anc.x, y: ancY, z: anc.z, face: anc.face, lot: anc.lot, kind: anc.kind || "office" };
        if (ped._mv) CBZ.moves.reset(ped._mv, ped.pos);
        ped.path = null; ped.speed = 0; ped.pause = 0;
        ped.state = "sit";
        if (ped.char) {
          ped.char.sitting = true;
          // THE REAL CHAIR SOLVE: entities/character.js only runs its
          // feet-on-the-floor seated pose when the rig is handed the seat's
          // cushion geometry. Desks whose builder DECLARED that geometry (the
          // CBZ.furnish kit does, always) now get it; anything undeclared gets
          // null back and keeps the legacy pose exactly as before. One line,
          // degrade-safe, and it upgrades itself as builders migrate.
          if (CBZ.propSeatRef) ped.char.seatRef = CBZ.propSeatRef(ped._deskAnchor);
          // a DESK seat is a WORKING seat: the seated pose runs the typing
          // tap loop (character.js) so an office floor visibly works, not
          // just sits. Flag-gated with the interiors doctrine.
          ped.char.typing = CBZ.CONFIG.INTERIORS_INTENTIONAL_V1 !== false;
        }
        if (animate) animChar(ped.char, 0, dt);
        return;
      }
    }
    // ALREADY SEATED: hold the seat every frame — pinned to the anchor (no drift, no
    // collide-shove from the desk geometry), seated pose, nothing else runs. An
    // interrupt flips the state off "sit" (think()), so we no longer land here and
    // the top-of-move clear releases the body back to normal locomotion.
    if (st === "sit") {
      const a = ped._deskAnchor;
      const ay = (a && a.y) || 0;                                       // SEAT FLOOR FIX (see above)
      if (a) { ped.pos.x = a.x; ped.pos.z = a.z; ped.group.position.set(a.x, ay, a.z); if (a.face != null) ped.group.rotation.y = a.face; }
      ped.pos.y = ay; ped.speed = 0;
      if (ped.char) {
        ped.char.sitting = true;
        if (!ped.char.seatRef && CBZ.propSeatRef) ped.char.seatRef = CBZ.propSeatRef(a);
      }
      if (animate) animChar(ped.char, 0, dt);
      return;
    }
    // A running NPC gets the same character-controller capability as the
    // player. Probe along the UNSTEERED goal heading first: steering sees the
    // obstacle as a wall and would otherwise turn away before the body ever
    // has a chance to vault it. Walkers still route around normally.
    const running = spd > 0 && dist > 0.65 &&
      spd >= Math.max(1.7, ped.baseSpeed * 1.42) && !ped.controlled && !surrendering;
    // Fleeing/reporting bodies are genuinely sprinting; ordinary joggers and
    // combat footwork can still vault, but do not throw gratuitous 360s.
    const sprinting = st === "flee" || ped.reportState === "run" ||
      spd >= ped.baseSpeed * 1.95;
    if (running && traversal && ped.char && (ped._traverseProbeT || 0) <= 0) {
      ped._traverseProbeT = 0.10 + (ped.slice & 3) * 0.015;
      const tx = dx / dist, tz = dz / dist;
      const started = traversal.start(ped, ped.char, tx, tz, {
        speed: spd,
        radius: ped.radius || PED_R,
        height: (ped.char.metric && ped.char.metric.height) || 1.7,
        allowTop: false,              // NPC navigation has no rooftop goal graph
        cars: true,
        npc: true,
        running: true,
        sprinting,
      });
      if (started && traversal.step(ped, ped.char, dt, animate)) return;
    }

    /* ---- LOCOMOTION: CBZ.moves (entities/moves.js) executes the decided move.
       Everything above decided WHERE (target / moveOrder) and HOW FAST (spd);
       the motor gives the body a velocity (a real start, a real stop, a
       braking arrival that latches instead of hunting), a bounded turn rate
       (turn in place before stepping off, never a one-frame 180), predictive
       keep-right avoidance of the neighbours and a committed detour when a
       wall holds it. The rig is fed the MEASURED ground speed, so a body held
       on a wall stands still instead of running on the spot. */
    const Mv = CBZ.moves;
    const m = Mv.motor(ped);
    const _px0 = ped.pos.x, _pz0 = ped.pos.z;
    const limpMul = ped.char && ped.char.limpSpeedMul != null ? ped.char.limpSpeedMul : 1;
    const cmdSpd = spd > 0 ? spd * limpMul : 0;
    const routed = !order && !!(CBZ.pedNav && CBZ.pedNav.owns(ped));
    // a WAYPOINT is passed at speed; only a real destination is braked into
    let leg = false;
    if (order) leg = !!order.leg;
    else {
      if (routed) {
        const S = ped._nav;
        if (S && (S.slide > 0 || (S.pts && (S.i < S.pts.length - 1 || (S.pts.partial && !S.pts.sealed))))) leg = true;
      }
      if (ped.path && ped.path.length > 1) leg = true;
    }
    // WALLS, for a body with no planned route: cityNav's context kernel, wall
    // half only (neighbours are the motor's). Every frame on screen; four times
    // a second off it, or at once if the goal swung away from the held dir.
    let tx = gx, tz = gz;
    if (!order && !routed && cmdSpd > 0 && dist > 1.2 && CBZ.cityNav && CBZ.cityNav.contextSteer) {
      const hx = dx / dist, hz = dz / dist;
      const psx = ped._prevSteerX || 0, psz = ped._prevSteerZ || 0;
      // A STEER IS A COMMITMENT: on screen it is re-asked ~7 times a second,
      // not every frame (a body between two walls had the kernel's winning
      // slot alternate frame to frame: the walker's "left-right" glance,
      // the largest class of yaw flips in the npc-intent trace). The goal
      // swinging away from the held direction still re-asks at once.
      if (!(ped._probeT > 0) || psx * hx + psz * hz < 0.3) {
        ped._probeT = lod === 0 ? 0.14 : 0.25 + (ped.slice & 3) * 0.05;
        const out = CBZ.cityNav.contextSteer(ped.pos.x, ped.pos.z, hx, hz, null, 0, psx, psz, _ctxOut, 1);
        if (out && (out.x || out.z)) { ped._prevSteerX = out.x; ped._prevSteerZ = out.z; }
      }
      if (ped._prevSteerX || ped._prevSteerZ) {
        // the steered heading, at the goal's own distance (the arrival profile stays honest)
        tx = ped.pos.x + ped._prevSteerX * dist; tz = ped.pos.z + ped._prevSteerZ * dist;
      }
    } else { ped._prevSteerX = 0; ped._prevSteerZ = 0; }

    const o = _mo;
    o.speed = cmdSpd;
    o.stop = order ? (order.stop != null ? order.stop : 0.35) : 0.45;
    o.leg = leg;
    o.accel = cmdSpd > 3 ? 5.5 : 3.6;
    o.vffX = order && order.vffX ? order.vffX : 0;
    o.vffZ = order && order.vffZ ? order.vffZ : 0;
    o.face = null; o.strafe = false;
    o.lod = lod;
    o.nbrs = null; o.nbrN = 0;
    const _cf = ped._combatFace;
    if (order && order.face != null) { o.face = order.face; o.strafe = !!order.strafe; }
    else if (_cf && _cf.pos && !_cf.dead && cmdSpd > 0) {
      // combat footwork: legs go sideways, the spine stays on the mark
      o.face = Math.atan2(_cf.pos.x - ped.pos.x, _cf.pos.z - ped.pos.z); o.strafe = true;
    } else if (ped._faceHold > 0 && (cmdSpd <= 0 || m.arrived)) o.face = ped._faceYaw;
    else if (ped._faceHold > 0 && cmdSpd > 0) ped._faceHold = 0;   // a walker faces where he walks: the look is spent
    if (lod === 0 && (cmdSpd > 0 || o.vffX || o.vffZ)) {
      const n = gatherNbrs(ped, !order && (st === "walk" || st === "wander"));
      if (n) { o.nbrs = _nbrO; o.nbrN = n; }
    }
    // A BODY AT REST LOOKS HEAD FIRST (CBZ.moves.look): a detail agent's
    // sector glance, a man turning to see who spoke. The motor holds the feet;
    // the look turns the head now and the body only if it holds. Not for a
    // fighter or a drawn gun (those square the body at the motor's rate).
    let restLook = null;
    if (o.face != null && Mv.look && lod === 0 && (m.arrived || cmdSpd <= 0.05) && !(o.vffX || o.vffZ) &&
        st !== "fight" && !(ped._gd && ped._gd.lv >= 2)) { restLook = o.face; o.face = null; }
    // a compensated off-screen tick (stride/stagger) is sub-stepped, never clipped
    let rem = dt;
    while (rem > 1e-5) {
      const h = rem > 0.1 ? 0.1 : rem;
      Mv.step(m, ped.pos, ped.group.rotation.y, tx, tz, o, h);
      ped.group.rotation.y = m.yaw;
      rem -= h;
    }
    for (let i = 0; i < o.nbrN; i++) _nbrO[i] = null;
    if (restLook != null) { ped.group.rotation.y = Mv.look(m, ped.group.rotation.y, restLook, dt); lookNeck(ped, m.neck); }
    else if (m.neck) lookNeck(ped, Mv.lookRelax(m, dt));     // walking: eyes front again
    ped.speed = m.speed;
    // A DOOR HE MAY NOT OPEN (systems/bodydoors.js refused him: a flat he has
    // no key to, the Situation Room): a free walker gives the errand up and
    // his brain picks another; a scripted one (staff, the detail) keeps his
    // order and the navigator plans round it.
    if (m.doorBlockT > 1.4 && !ped.controlled && !order && (ped.path || ped.finalGoal)) {
      ped.path = null; ped.finalGoal = null; ped.pause = Math.max(ped.pause, 0.8);
      if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
    }
    // a stroller standing on his spot takes his beat before the next errand
    if (!order && m.arrived && !ped.path && (st === "wander" || st === "walk")) ped.pause = Math.max(ped.pause, 0.4);

    // "entered" a building: hide briefly then re-emerge (cheap life)
    if (ped.enterT > 0) { ped.enterT -= dt; ped.group.visible = false; ped.speed = 0; if (ped.enterT <= 0) ped.group.visible = !ped._spawnHidden; return; }

    // ANTI-TUNNEL DEPENETRATION: CBZ.collide is a SINGLE-PASS circle-vs-box push
    // (shared with the player — do not edit it). One pass at a corner can shove the
    // body OUT of one wall and INTO the adjacent one, leaving it half-clipped; a
    // fast or non-active ped can then squeeze straight through. So we run it 2–3
    // times: each pass resolves whatever the previous push created, and we stop
    // early once a pass no longer moves the body (fully resolved). The clamp runs
    // between passes too so a building edge + the city bounds both settle.
    if (CBZ.collide) {
      for (let pass = 0; pass < 3; pass++) {
        const bx = ped.pos.x, bz = ped.pos.z;
        CBZ.collide(ped.pos, PED_R, ped.pos.y + PED_FOOT, ped.pos.y + 1.7);
        if (CBZ.city && CBZ.city.arena) CBZ.city.arena.clampToCity(ped.pos, PED_R);
        // converged: the last pass didn't push us anywhere → no overlap left
        if (Math.abs(ped.pos.x - bx) < 0.002 && Math.abs(ped.pos.z - bz) < 0.002) break;
      }
    } else if (CBZ.city && CBZ.city.arena) {
      CBZ.city.arena.clampToCity(ped.pos, PED_R);
    }
    settleFeet(ped, dt);
    /* STUCK: the motor was carrying real speed and the walls ate most of it.
       An ERRAND gives up and picks a reachable goal; a chase, a flight or an
       order keeps its goal and leaves the way round to the motor's committed
       detour (CBZ.moves) — the old random +/-1.5 rad sidestep re-rolled its
       side every time and see-sawed. A routed body is walking the long way,
       not stuck. A fighter whose picked spot proved unreachable drops it. */
    if (!order && m.speed > 0.3 && !m.arrived && dist > 0.5) {
      const moved = Math.hypot(ped.pos.x - _px0, ped.pos.z - _pz0);
      if (moved < m.speed * dt * 0.4) {
        ped._stuck = (ped._stuck || 0) + dt;
        if (ped._stuck > 0.45 && !(CBZ.pedNav && CBZ.pedNav.owns(ped))) {
          ped._stuck = 0;
          const held = !!(CBZ.boardingHolds && CBZ.boardingHolds(ped));
          if (ped.state === "fight") {
            if (ped._iqPos) { ped._iqPos = null; ped._iqPlant = false; ped._iqRepoT = 0; }
          } else if (ped.state !== "flee" && !held) { ped.path = null; pickRoutineGoal(ped); }
        }
      } else if (ped._stuck) ped._stuck = 0;
    } else if (ped._stuck) ped._stuck = 0;
    if (animate) animChar(ped.char, m.gs, dt);
  }

  // ---- per-frame update ----
  // PED_BRAIN_STAGGER (2026-08-03 slow-frame wave): this tick measured
  // 14.9ms/frame avg at 560 peds (in-game perfReport, top updater in the
  // whole game). Bodies beyond the 95m VIS_D2 draw band aren't rendered, so
  // their think/walk runs every 3rd frame with the skipped frames' dt paid
  // back in one compensated tick — same total simulated time, same walking
  // speed, zero visible change. Alarmed/raging/controlled/reporting actors
  // are exempt (a firefight at range must stay full-rate). `dt` becomes a
  // per-ped local so the compensated value reaches every use below without
  // touching the body of the loop.
  if (CBZ.CONFIG.PED_BRAIN_STAGGER == null) CBZ.CONFIG.PED_BRAIN_STAGGER = true;

  /* ============================================================
     PED_SIM_BUDGET_MS — A DEADLINE ON THE CROWD'S DECISIONS, NOT ON THE CROWD.

     THE MEASUREMENT (tools/probe-nuke-perf.mjs, seed 90210, city nuke at the
     centroid). This updater costs 335 ms per simulated second on a calm street.
     Panic spreads and it climbs through ~700 ms/s by s6-7. At s=28-30 — peak
     simultaneous panic, before the fallout has finished killing everybody — it
     measures 8,007 -> 10,432 ms per simulated second, with a worst SINGLE tick
     of 4,070 ms. Every other updater in the game is sitting near 300 ms/s at
     that exact moment (u:37 ~290, u:42 ~290, u:40.5 ~180, a:52 ~175). By s=33,
     with most of the crowd dead, it falls back to 1,646 ms/s. That shape — a
     hump that tracks the number of simultaneously ALIVE AND PANICKED bodies —
     is the whole diagnosis: it is not the dying that is expensive, it is the
     deciding. A dead ped `continue`s out of this loop in a dozen instructions.

     WHERE THE COST ACTUALLY IS. Ranked, from reading every path this loop can
     take at panic scale:

       1. think() -> the `threatened` branch (:4947) -> fleeFrom (:5159).
          fleeFrom is the single most expensive call in the file and it has NO
          RATE GATE — unlike _groupT / _gangFearT / _microT, which the author
          did gate, the flee recompute runs on EVERY think tick for EVERY
          alarmed meek/wary body. One call is:
            cityNav.indoorLotAt   — linear scan of every enclosing footprint
            cityNav.nearestExit   — linear scan of EVERY door in the city for a
                                    top-5, then up to 5x CBZ.clearLineOfFire,
                                    and clearLineOfFire (los.js:108) is THREE
                                    raycasts each (target probe + forward +
                                    reverse). Up to FIFTEEN LOS raycasts.
            cityNav.routeTo       — two more indoorLotAt scans, a doorFor scan
                                    over every live door record, then the grid
                                    route.
          A panicked active ped thinks at stride 4 = 15 Hz. Hundreds of them
          doing that is thousands of nav+LOS solves per second. This is the
          8 seconds.
       2. PED_BRAIN_STAGGER IS SWITCHED OFF BY THE VERY THING IT EXISTS FOR
          (:6320). The far-band 1-in-3 skip exempts `p.alarmed > 0`, which was
          right when "alarmed" meant one firefight across the street. A nuke
          sets alarmed on the entire population (cityScare -> alarmed = 6), so
          at s=28 the exemption covers everyone and the whole off-screen mass
          reverts to full-rate loop entry and full-rate think cadence. The one
          throttle we already had disables itself at the peak. Left ALONE here
          on purpose (it is a behaviour contract for firefights at range) —
          the budget below is what now holds that mass back.
       3. The 4,070 ms TICK IS A CONVOY. Nothing in this loop is O(n^2) at
          panic (the scan index routes group/mob, gang-fear and nearestActor
          through bounded cell queries), so a 30x tick is not a different KIND
          of work — it is the same work arriving all at once. Four synchronisers
          stack in the blast frame: `_refugeT = 2.5` (:5221) is the ONLY gate in
          this file with no rng jitter, so every body that took the refuge
          branch in the detonation frame re-takes it on the same frame 2.5 s
          later, and re-arms to 2.5 again — a convoy that never disperses;
          `_rallyT = 6` (:5476, :5484) is likewise unjittered; cityScare's
          `_scareUntil = now + 3400` (:5592) re-opens for the whole crowd on one
          frame; and `p.slice` is 0..7 (:1250) against a far-tier `stride` of 20,
          so the far crowd's thinks land on 8 of every 20 frames instead of
          spreading over all 20. The budget below is the answer to all four at
          once, because it does not care WHY the work bunched.

     THE FIX IS THE ONE THIS REPO ALREADY WROTE. impactbus.js's
     NUKE_DRAIN_BUDGET_MS bounds the nuclear drains with a per-frame deadline,
     a rotating order and cursors that RESUME on the next frame. Nothing is
     discarded there and nothing is discarded here: a deferral is arithmetically
     the same event as a slow frame, which this loop already survives.

     WHAT IS BUDGETED AND WHAT IS NOT. Everything a human eye can see stopping
     runs EVERY frame for EVERY body regardless of the deadline: the timer
     decrements that hold state (alarmed, ko, poseCower, npcHeat, deadT...),
     movement integration and animation along the decision the body ALREADY
     made (move()), the render LOD and spawn-hide handling, the phone-prop
     stamp, and the whole of gunpointSweep (still every frame, at :6183 — an
     instant hands-up is the feature). What is budgeted is exactly one thing:
     think(), which IS the decision — flee-target recomputes, refuge picks,
     group/mob rechecks, gang-fear scans, shoot-first rolls, archetype
     micro-behaviour, routine goals. A body whose think is deferred keeps
     running toward the place it was already running to.

     GATES ARE HELD, NOT DRAINED. The _*T decision gates are decremented in the
     same block as everything else, so a body deferred for K frames would arrive
     at its next think with every gate expired and fire all of them at once —
     the budget would have MANUFACTURED the convoy it was written to break. So
     the decision gates only tick on frames the body is allowed to act on them;
     a deferred frame extends them by dt. Cadence degrades, it does not bunch.

     NOTHING IS DROPPED, NOT EVEN A CADENCE. If a body's stride tick lands on a
     frame the deadline defers it, `_thinkDue` latches and it thinks on the
     first frame it is served, off-phase, with the waiting time banked into its
     dt (the same trick PED_BRAIN_STAGGER's `_dtBank` uses ten lines down). That
     also removes the only way the cursor could alias against the stride pattern
     and starve one body forever.

     ON-SCREEN AND CLOSE IS NEVER LATE. Inside ANIM_D2 (58 m — the file's own
     near band, and the distance at which you can read a face) the deadline is
     bypassed entirely, so a body you are standing next to still reacts on the
     frame you give it a reason to.

     DETERMINISM, AND WHY LAW #12 IS NOT TOUCHED. Law #12 governs FACTS ABOUT A
     BODY — its job, its role, its face — and its rule is that they are hashed
     off the spawn point (roleHash / CBZ.hash01), never drawn from the shared
     rng() stream, precisely because the order those paths run in already
     depends on where the camera is. Nothing here draws a fact. What the budget
     moves is the POSITION of the runtime rng() stream, which every gate jitter
     and behaviour roll inside think() advances — and that position is already a
     function of the frame rate (stride and gate boundaries land on different
     frames at 30 fps than at 60) and already skipped wholesale by
     PED_BRAIN_STAGGER. So the budget changes WHEN a decision is recomputed,
     never WHICH decision the same inputs produce, and it is the same class of
     variance the loop has shipped with since the stagger landed. The math
     gate's stepSim(400 ticks) builds the world BEFORE any updater runs, so no
     world-build count can move; and with an empty roster the budget switches
     itself off rather than take a modulo of zero.

     PED_SIM_BUDGET_MS = 0 (or null-ish) restores the pre-budget loop exactly:
     `decide` is a constant true, every gate ticks, every stride tick thinks in
     place, and the added statements collapse to the originals in the original
     order. Read LIVE each frame so ?cfg_ overrides work mid-session.
     ============================================================ */
  // a phone's CPU is ~2-3x slower than the desktop this was tuned on, and the
  // crowd's decisions were ~6 ms of its frame at the spawn: its deadline is 3 ms
  // (on-screen bodies within ANIM_D2 are never deferred, see below)
  if (CBZ.CONFIG.PED_SIM_BUDGET_MS == null) CBZ.CONFIG.PED_SIM_BUDGET_MS = CBZ.deviceClass === "phone" ? 3 : 8;
  // performance.now with a Date.now fallback — the headless harnesses that
  // drive CBZ.stepSim (tools/*-node.mjs) do not always inject `performance`,
  // and a budget that throws is strictly worse than no budget. Same shape as
  // impactbus.js's drainNow(), for the same reason.
  const simNow = (typeof performance !== "undefined" && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };
  // THE CURSOR IS THE WHOLE DIFFERENCE BETWEEN A BUDGET AND A CULL. It is
  // module-level because it must survive the frame: an over-budget frame stops
  // here and the next frame picks the roster up at exactly this index, so every
  // body is served once per sweep and no cohort can starve. At the measured
  // panic peak the full-roster decision cost is ~133 ms/frame, so an 8 ms
  // deadline serves ~6% of the roster per frame — a complete sweep in ~17
  // frames (~0.28 s) for the bodies beyond 58 m, and zero latency inside it.
  let _simCursor = 0;
  // A deferred body banks the wall time it waited so its next think() gets the
  // dt it actually missed. Clamped: the bank exists to preserve CADENCE, not to
  // replay an arbitrary stretch of missed time in one tick if a body spent a
  // minute inside a car with the latch still set. 1 s is already inside the
  // range dt*stride reaches today (stride 20 x a compensated stagger tick).
  const SIM_BANK_MAX = 1.0;
  // A FLOOR UNDER THE ROTATION, because the near-camera bypass is a SECOND
  // cohort competing for the same milliseconds and the deadline alone lets it
  // win every time. A dense 58 m crowd at panic — a couple of dozen bodies, a
  // quarter of them on a stride tick, each one a flee recompute — can spend the
  // whole 8 ms before the rotation window is even reached, and then the window
  // closes on its first body and the sweep crawls forward one index per frame
  // (a modelled 8 s of decision latency for the far crowd on a 500-body
  // roster). This is the same hazard impactbus.js answers by ROTATING its drain
  // order so the shared budget cannot permanently starve the category listed
  // last; the cohorts here are "near" and "the rotation", so the answer is a
  // guaranteed minimum slice instead. Eight is impactbus's own per-frame floor,
  // and it caps a 500-body sweep at ~63 frames (~1 s) in that pathological
  // case while costing nothing at all in the normal one, where the deadline
  // buys far more than eight.
  const SIM_MIN_THINKS = 8;
  CBZ.onUpdate(34, function (dtFrame) {
    let dt = dtFrame;
    if (g.mode !== "city") return;
    // A few specialist modules may cast their own actors after the canonical
    // roster was deferred. They remain parked logically until the street layer
    // is observed, so the prologue never grows a second hidden simulation.
    if (CBZ.cityCampaignObservationGate) {
      try { if (CBZ.cityCampaignObservationGate("peds") === false) return; }
      catch (e) {}
    }
    frame++;
    // SCAN INDEX first (see the block at the top of the file). It has to lead the
    // frame because gunpointSweep is the first thing that asks it a question, and
    // nothing has moved yet at this point — so the index holds the same positions
    // the sweep's old whole-crowd walk read, and its answers are not stale by so
    // much as a millimetre. The later, mid-loop consumers (group/mob, gang-fear,
    // nearestActor) carry SCAN_MARGIN for the bodies that move under them.
    rebuildPedGrid();
    // GUNPOINT: raise hands across the near crowd the moment you aim a gun at them
    // (every frame, so it's instant + covers everyone, not just one per think pass).
    gunpointSweep(dt);
    panicDecay(dt);            // the contagion field forgets (cityScare)
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    const peds = CBZ.cityPeds;
    // ---- THIS FRAME'S DECISION DEADLINE (see the block above the updater) ----
    // Read LIVE, so a ?cfg_ped_sim_budget_ms override flips it mid-session.
    const _budgetMs = Number(CBZ.CONFIG.PED_SIM_BUDGET_MS) || 0;
    // An empty roster disables the budget rather than divide/modulo into it —
    // the math gate's stepSim runs this updater against whatever the world
    // built, and "no peds yet" is a legal state on the first frames.
    const _budgetOn = _budgetMs > 0 && peds.length > 0;
    const _deadline = _budgetOn ? simNow() + _budgetMs : 0;
    // The roster can shrink under a cursor parked past its new end (crowd.js
    // recycles pooled rigs); a stale cursor must wrap, never index nothing.
    if (_simCursor >= peds.length) _simCursor = 0;
    const _budFrom = _budgetOn ? _simCursor : 0;
    let _budOver = false, _budStop = 0, _budDone = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      dt = dtFrame;              // a prior ped's compensated tick must not leak
      // MAY THIS BODY DECIDE THIS FRAME? Settled here, at the top, because the
      // gate block below has to know: a deferred body must HOLD its decision
      // gates, not drain them (draining is how a budget manufactures a convoy).
      // Pure function of the index, this frame's cursor and the deadline flag,
      // so on a frame where nothing is late it is one compare for the whole
      // crowd — and with the flag off it is a constant `true` that the added
      // `decide &&` conjuncts below fold straight back into the original lines.
      // `inWindow` is membership of THIS frame's slice of the rotation; `decide`
      // is that OR the near-camera bypass. They have to be two different words,
      // and the bug that proves it is worth the extra local: a bypassed body
      // sits at an index BEHIND the cursor, so if it were allowed to close the
      // window it would park the cursor at its own index + 1 — backwards —
      // and the same near bodies would re-close it there every frame, pinning
      // the sweep and starving the entire tail of the roster forever. Only a
      // body inside the window may spend the window. A bypassed body still
      // costs real milliseconds, which simply makes the window it did not close
      // a shorter one — self-correcting, and the cursor still advances by at
      // least one per frame because the deadline is charged after the work.
      let inWindow = true, decide = true;
      if (_budgetOn) {
        inWindow = i >= _budFrom && !_budOver;
        decide = inWindow;
        if (!decide) {
          // ON-SCREEN AND CLOSE IS NEVER LATE. ANIM_D2 (58 m) is this file's own
          // near band — the range at which a body's reaction is something you
          // WATCH rather than glimpse. camx/camz are this frame's camera, taken
          // before anything moved.
          const bdx = p.pos.x - camx, bdz = p.pos.z - camz;
          if (bdx * bdx + bdz * bdz < ANIM_D2) decide = true;
        }
      }
      // A PROP MUST NOT OUTLIVE ITS GESTURE. The tell block at the bottom of
      // this loop stamps `_phoneFrame` on every frame it wants the phone drawn;
      // anything that stops the gesture — the call landing, a bullet, a KO, an
      // arm torn off, gunpoint, a cull, walking out of the visible band, or
      // simply being skipped by one of the `continue`s below — stops the stamp,
      // and the handset goes away on the next frame WITHOUT every one of those
      // paths having to know a phone exists. Costs one truthy compare per ped
      // for the whole crowd: a body that has never dialed carries no field.
      // The mesh is never destroyed here — it is the same group we show again
      // next time, and the rig-disposal traversal collects it with the body.
      if (p._phoneProp && p._phoneProp.visible && p._phoneFrame !== frame - 1) p._phoneProp.visible = false;
      if (p._parked) continue;     // pooled crowd-promotion ped waiting off-map; not in play
      // A live-spawned rig stays suppressed until its moving position is safely
      // outside the padded camera view. It may simulate while hidden, so when
      // the player later turns around they find a person already living there,
      // never a frozen body appearing on a frame boundary.
      // The reveal asks only "can the player see that spot now?" (config.js
      // npcRevealSafe: off screen, behind a wall, or held 1.2 s at most when
      // near). It used to ask the SPAWN question (18 m away AND off screen),
      // which indoors is never true: the President's staff were invisible.
      if (p._spawnHidden) {
        if (!CBZ.npcRevealSafe || CBZ.npcRevealSafe(p, dt)) {
          p._spawnHidden = false; p._hidT = 0;
        } else {
          p.group.visible = false;
        }
      }
      if (p.alarmed > 0) p.alarmed -= dt;
      // THE FIVE DECISION GATES TICK ONLY ON FRAMES THIS BODY MAY ACT ON THEM.
      // Every one of them is read in exactly one place — inside think() — and
      // each guards a scan or a recompute, so letting them expire during frames
      // the deadline has deferred would hand the body five simultaneously-open
      // gates the moment it is served. That is the convoy, rebuilt by the fix.
      // Holding them IS "extend the gate by the skipped dt": the cadence
      // stretches, it never bunches. `decide` is constant true with the flag
      // off, so these are the original five lines in the original order.
      if (decide && p._rallyT > 0) p._rallyT -= dt;       // turf-rally re-call cooldown
      if (decide && p._refugeT > 0) p._refugeT -= dt;     // flee-toward-refuge recompute gate
      if (decide && p._microT > 0) p._microT -= dt;       // archetype micro-behaviour gate
      if (decide && p._groupT > 0) p._groupT -= dt;       // group/mob reaction recheck gate
      if (decide && p._gangFearT > 0) p._gangFearT -= dt; // civilian gang-fear scan rate gate
      if (p.poseCower > 0) p.poseCower -= dt;   // brief flinch/cringe at gunfire+blasts
      if (p._scareT > 0) p._scareT -= dt;       // hobo-jumpscare lunge marker (transient)
      if (p.tweakT > 0) p.tweakT -= dt;
      if (p.npcHeat > 0) { p.npcHeat = Math.max(0, p.npcHeat - dt * 4); }
      if (p.offenseT > 0) p.offenseT -= dt;
      if (p.ko > 0 && !p.dead) p.ko -= dt;
      if (p.dead) {
        if (p.tag) p.tag.visible = false;
        p.deadT += dt;
        // SELF-HEALING corpse list. rollDeadLoot is the one place a body becomes
        // lootable, but `.dead` is a plain flag other modules set directly and
        // crowd.js recycles a pooled rig by clearing dead/culled without touching
        // deadLoot. This costs a couple of loads per BODY (not per ped) and makes
        // the list answer for every one of those paths within a frame, so the
        // index can never be a way to lose a haul the linear scan would have found.
        if (p.deadLoot && !p.deadLoot.looted && !p.culled && !p._inCorpseList) _corpseAdd(p);
        // A CORPSE IS DRAWN LIKE ANY OTHER BODY. The dead branch used to skip
        // the render LOD entirely, so a body that died on screen kept drawing
        // at any range forever — harmless when it was deleted after 75 s, and
        // the whole cost of persistence if it is not. Same VIS_D2 every living
        // rig below uses; this is what makes a held corpse past 95 m free.
        {
          const cdx = p.pos.x - camx, cdz = p.pos.z - camz;
          // a body you shot at range stays on screen where it fell: corpses
          // draw out to 200 m (they are frozen, so they cost draw calls only)
          if (p.group) p.group.visible = cdx * cdx + cdz * cdz < Math.max(VIS_D2, CORPSE_VIS_D2);
        }
        // BODIES STAY UNTIL SOMEBODY COMES FOR THEM (city/morgue.js). The old
        // rule was two timers: flag for pickup at 4 s so medics.js could walk a
        // paramedic in out of thin air, then DELETE the body at 75 s whether
        // anyone had collected it or not. Both are gone. `needsPickup` is now
        // set by the ambulance that actually arrived, and the cull is governed
        // by the persistence law — the nearest N bodies never reap, and nothing
        // reaps where you could be looking at it. Degrade-safe both ways: no
        // morgue.js and this is the exact pair of timers it always was.
        if (!CBZ.corpseMayReap && p.deadT > 4) p.needsPickup = true;
        // THE REAP TEST IS A DECISION, AND A CORPSE A KILOMETRE AWAY CAN MAKE IT
        // NEXT FRAME. Everything above this line still runs for every body every
        // frame — deadT, the self-healing loot index, and above all the render
        // LOD, because a corpse you can see must draw or not draw on the frame
        // the camera says so. What the deadline may defer is only the question
        // "may this body go now": corpseMayReap ends in npcTransitionSafe, a
        // padded-screen projection paid PER CORPSE PER FRAME, and after a nuke
        // there are hundreds of them. Deferring it is free of consequence by
        // construction — the answer it defers is always "reap", the body simply
        // persists one more frame, and corpseMayReap already refuses to reap
        // anything the player could be looking at, so nothing can blink out late
        // that would not have blinked out early. Short-circuit: a deferred body
        // does not even pay the call. `decide` is true with the flag off.
        const mayCull = decide && (CBZ.corpseMayReap ? CBZ.corpseMayReap(p) : (p.collected || p.deadT > 75));
        // A culled body was already invisible to cityNearestCorpse (`p.culled`);
        // dropping it here just keeps the corpse list bounded by the bodies that
        // are actually still lootable. crowd.js only ever clears `culled` while
        // it also clears `dead`, and that body re-enters through rollDeadLoot the
        // next time it dies — so this can never hide a lootable corpse.
        if (mayCull && !p.culled) { p.culled = true; if (p.group.parent) p.group.parent.remove(p.group); _corpseDrop(p); }
        continue;
      }
      // A reusable placement owns actors seated on a moving parent (currently
      // commercial-aircraft passengers/pilots). npclife.js already synced their
      // world-space actor.pos before this tick; ordinary routine/path movement
      // must not pull the local rig out of its seat. They remain in cityPeds, so
      // combat, interaction, names, inventory and death all use the real actor.
      if (p._npcAttached) {
        p.speed = 0;
        if (p.tag) p.tag.visible = false;
        // Attached rigs skip the walk/think path below, which also skipped
        // the render-LOD recompute — an actor claimed while distance-hidden
        // stayed invisible in its seat forever. Apply the same LOD here:
        // seated passengers draw when you're at the aircraft (visible
        // through the glass — the payoff of the real windows) and stop
        // drawing across the map. p.pos is world-space (npclife.js syncs
        // it before this tick); enterT is deliberately ignored — a seat is
        // not a shop interior.
        const ax = p.pos.x - camx, az = p.pos.z - camz;
        p.group.visible = !p._spawnHidden && ax * ax + az * az < VIS_D2;
        continue;
      }
      if (p.inCar) continue;     // vehicles.js owns it while it drives
      // A HUNTING BUM IS DRIVEN BY systems/predator.js, not by think()/move().
      // Same contract dogs.js has with the FSM: while it holds the body, the
      // ordinary wander must not fight it for the transform. We still pay for
      // rendering and animation, because a stalker you cannot SEE is not a
      // stalker. (The hunt loop clears _bumHunt the moment it disengages.)
      if (p._bumHunt) {
        const hx = p.pos.x - camx, hz = p.pos.z - camz, hd2 = hx * hx + hz * hz;
        p.group.visible = !p._spawnHidden && hd2 < VIS_D2;
        if (hd2 < ANIM_D2) animChar(p.char, p._mv ? p._mv.gs : (p.speed || 0), dt);
        continue;
      }
      /* A BODY GOING THROUGH A DOOR IS OWNED BY THE DOOR (city/boarding.js).
         Same contract as _bumHunt above and dogs.js's FSM: while another
         system holds the transform, the ordinary wander must not fight it for
         it. That file drives the pose AND calls animChar itself off the
         distance the body actually covered, so we do neither here — only the
         render LOD, because a companion you cannot SEE climbing into your car
         is the whole feature missing.

         WHY THIS EXISTS AND `inCar` DOES NOT DO IT. The first cut of the arc
         set `p.inCar` for these beats, reasoning that it is already the "skip
         this body" latch. It is not: `inCar` means RIDING IN THAT CAR, and
         vehicles.js acts on it — it snapped the walker straight to the car's
         origin, a measured 5.84 m in one tick, which is precisely the glitch
         the boarding arcs were written to delete. A latch that says "somebody
         else is moving this" has to be a different word from one that says
         "this person is in a car". */
      if (p._boardOwn) {
        const bx = p.pos.x - camx, bz = p.pos.z - camz;
        p.group.visible = !p._spawnHidden && bx * bx + bz * bz < VIS_D2;
        continue;
      }
      // A BODY ON A LADDER IS OWNED BY THE LADDER (systems/climb.js): it
      // writes the transform and poses every limb on the rungs. Same contract.
      if (p._climb) {
        // the feet resample the floor the moment he steps off (a cached
        // ground height from before the climb would drop him off the deck)
        p._feetT = 0; p._feetY = null;
        const lx = p.pos.x - camx, lz = p.pos.z - camz;
        p.group.visible = !p._spawnHidden && lx * lx + lz * lz < VIS_D2;
        continue;
      }
      const dx = p.pos.x - camx, dz = p.pos.z - camz, d2 = dx * dx + dz * dz;
      // FAR-BAND STAGGER — see the flag comment above the updater. Runs after
      // the timer decrements (those stay full-rate/cheap) and before all
      // think/walk/animate work. Skipped frames bank their dt; the think frame
      // pays it back so distance never changes anybody's effective speed.
      if (CBZ.CONFIG.PED_BRAIN_STAGGER && d2 > VIS_D2 &&
          !(p.alarmed > 0 || p.npcHeat > 0 || p.rage || p.controlled || p.reportState)) {
        if (((i + frame) % 3) !== 0) { p._dtBank = (p._dtBank || 0) + dt; continue; }
        if (p._dtBank) { dt += p._dtBank; p._dtBank = 0; }
      } else if (p._dtBank) { dt += p._dtBank; p._dtBank = 0; }
      // Names, levels and job titles belong in conversation/phone surfaces,
      // never as billboard prose over a person's head.
      if (p.tag) p.tag.visible = false;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(p)) continue;
      if (p.ko > 0) { p.speed = 0; if (p._mv) CBZ.moves.reset(p._mv, p.pos); if (d2 < ANIM_D2) animChar(p.char, 0, dt); continue; }
      // wrapping his own wound (systems/vitals.js): he stands where he is,
      // hands on it, until it is done or somebody hits him
      if (p._vt && CBZ.vitals && CBZ.vitals.busy(p)) { p.speed = 0; if (p._mv) CBZ.moves.reset(p._mv, p.pos); if (d2 < ANIM_D2) animChar(p.char, 0, dt); continue; }
      const near = d2 < ANIM_D2;
      // `important` is a SIMULATION policy, not permission to draw forever.
      // Passive guards and anybody who happens to own a gun must keep thinking
      // off-screen, but the old shared flag also rendered their 20-ish mesh rig
      // (plus a multi-mesh weapon) at unlimited distance. In a populated city
      // that leaked thousands of draw calls. Preserve global presentation only
      // for actors explicitly owned/scripted by the player; every other actor
      // remains a full, hittable rig throughout the existing 95m q3 contract.
      // `p._post` (city/garrison.js): a body whose JOB is to be somewhere has to
      // keep thinking while you are not looking, or a sentry you walked past
      // stops holding his slot the moment he leaves the 58 m active band and
      // you turn round to find him drifted into the road. This is SIMULATION
      // importance only — `renderImportant` below is untouched, so his rig
      // still stops drawing at the same 95 m as everybody else's.
      const important = p.rage || p.guard || p._post || p.controlled || (p.npcWanted | 0) >= 1 || p.armed || p.reportState || p.approach;
      const renderImportant = p.controlled || p.companion || p.recruited || p.faction === "player" || p === g.cityPartner;
      const active = near || important;
      // render LOD: peds far from the camera stop drawing entirely (the single
      // biggest GPU saving with ~90 rigs). Simulation proximity is deliberately
      // separate: a tier whose VIS_D2 is below ANIM_D2 may keep a nearby ped's
      // brain/movement responsive without forcing its 16-20 mesh rig to draw.
      // Important actors remain visible regardless of distance; enterT owns
      // visibility while inside.
      const vis = !p._spawnHidden && (renderImportant || d2 < VIS_D2);
      if (p.enterT <= 0) p.group.visible = vis;
      // far rigs stop casting shadows (their shadow is sub-pixel anyway); flip
      // only on a threshold crossing so the per-frame cost is a single compare.
      // blob shadows (city/blobshadows.js) ground rigs now — rigs never enter
      // the sun shadow pass at all (the pass was the draw-call bottleneck).
      const wantShadow = false;
      if (p._shadowOn !== wantShadow) { setRigShadow(p.char, wantShadow); p._shadowOn = wantShadow; }
      // HAND LOD (CBZ.human): past ~30 m the hand is a few pixels, so the rig
      // swaps to the 51-triangle far hand; back to the default inside 26 m
      // (hysteresis, so a body on the line never flips geometry each frame).
      if (vis && p.char && p.char.setHandLod) {
        const hl = p._handLod === 2 ? (d2 < 26 * 26 ? 1 : 2) : (d2 > 30 * 30 ? 2 : 1);
        if (hl !== p._handLod) { p.char.setHandLod(hl); p._handLod = hl; }
      }
      const far = d2 > FAR_D2;
      const stride = active ? 4 : (far ? 20 : 10);
      // ---- THE BUDGETED WORK, AND THE ONLY BUDGETED WORK ----------------------
      // think() IS the decision: the flee-target recompute (fleeFrom -> up to
      // fifteen LOS raycasts through cityNav.nearestExit, the measured 8 s/s),
      // the refuge pick, the group/mob and gang-fear scans, the shoot-first
      // roll, the archetype micro-behaviour, the routine goal. move() below is
      // NOT budgeted — a body keeps walking, turning, animating and colliding
      // along the decision it already holds, every frame, at every distance, so
      // a deferral is invisible: nobody freezes, they just keep going the way
      // they were already going for a fraction of a second longer.
      //
      // `_thinkDue` is the no-loss latch. A stride tick that lands on a deferred
      // frame is not thrown away — it is owed, and it is paid on the first frame
      // this body is served, off-phase if need be. Without it the cursor could
      // beat against the stride pattern (slice 0..7 vs stride 20) and keep
      // missing the same body's tick indefinitely; with it, the worst case is
      // one sweep of latency. The banked dt is the same compensation
      // PED_BRAIN_STAGGER's `_dtBank` pays a few lines above, for the same
      // reason: the timers inside think() must see the time that really passed.
      const _due = (frame + p.slice) % stride === 0;
      if (_due || p._thinkDue) {
        if (decide) {
          think(p, dt * stride + (p._thinkBank || 0), active);
          if (p._thinkDue) { p._thinkDue = false; p._thinkBank = 0; }
          // Charged AFTER the work, never before: the deadline may be overrun by
          // at most one think, exactly as impactbus.js's drains may be overrun by
          // at most one item. Checking first would let a frame do nothing at all
          // and the cursor would never advance. The SIM_MIN_THINKS floor short-
          // circuits ahead of the clock read, so the guarantee costs no calls to
          // simNow() — it saves the first seven of them every frame.
          if (_budgetOn && inWindow && !_budOver &&
              ++_budDone >= SIM_MIN_THINKS && simNow() > _deadline) { _budOver = true; _budStop = i + 1; }
        } else {
          p._thinkDue = true;
          p._thinkBank = Math.min(SIM_BANK_MAX, (p._thinkBank || 0) + dt);
        }
      }
      // ANIMATE THE WHOLE VISIBLE BAND, not just the near 58m. A rig drawn out to
      // VIS_D2 (95m) but BEYOND ANIM_D2 used to move with animate=false → the legs
      // froze while the body slid (the filmed 58-95m "foot-slide"). Anything you
      // can SEE walking must swing its legs; animChar is a cheap pose write (no
      // alloc), and we only spend it on rigs already passing the draw test, so the
      // ~1000-NPC budget is untouched (the off-screen mass still gets animate=false
      // and the instanced ambient crowd covers everything past 95m). enterT rigs
      // are hidden inside a building, so skip them.
      const visAnim = vis && p.enterT <= 0;
      // PERF: move() (movement integration + collision resolve) is the single
      // most expensive per-ped call, and it used to run unconditionally every
      // frame for the WHOLE population regardless of quality tier — pixelRatio/
      // shadow knobs never touched this, which is why low tiers didn't actually
      // run faster. A ped nobody can see (not vis, not important) doesn't need
      // per-frame integration; throttle it at low tiers only (same amortized-dt
      // trick as the think() stride above). Visible/important peds are
      // untouched — this only trims the invisible mass.
      const q = CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel;
      // Even Best does not gain visible fidelity from integrating an ordinary
      // off-screen walker at 60 Hz. Tiered 7.5/12/20/30 Hz remote integration
      // keeps visible and important actors untouched while cutting the city's
      // largest recurring CPU loop on every preset.
      const moveStride = (active || vis) ? 1 : (q === 0 ? 8 : q === 1 ? 5 : q === 2 ? 3 : 2);
      if (moveStride === 1 || (frame + p.slice) % moveStride === 0) {
        // motor LOD (CBZ.moves): on screen and near = full (avoidance), drawn
        // or important = no avoidance, the unseen mass = bare integration
        move(p, dt * moveStride, visAnim, (near && vis) ? 0 : (vis || active) ? 1 : 2);
      }
      // ---- diegetic witness tells (post-anim, so animChar's damping can't
      //      pull them back): a dialing witness holds the phone to their EAR,
      //      a gawker films two-handed, a grudge witness POINTS you out to the
      //      officer. These in-world reads replace the old narration toasts
      //      (owner's rule: you SEE someone see you — no popup tells you). ----
      // (guard ra/la individually — gore can strip a whole arm off the rig,
      //  and a one-armed witness must not crash the frame loop)
      if (vis && p.enterT <= 0 && !p.dead && p.ko <= 0 && !p._traversal &&
          p.char && !p.char.traversePose && p.char.parts && p.char.parts.ra) {
        const ch = p.char, J = ch.low || {};
        if (!ch.surrender && !ch.handsUp && !ch.aimingPose && !p.armed) {
          // (armed peds skip these — their weapon-ready pose owns the arms,
          //  and an armed witness draws instead of dialing anyway)
          const LEG = legible();
          if (p.reportState === "phone") {
            ch.parts.ra.rotation.set(-0.55, -0.55, -0.35);   // hand to ear
            if (J.ra) J.ra.rotation.x = -2.35;
            if (ch.neck) ch.neck.rotation.z = 0.10;          // head leans into the call
            if (LEG) {
              // PUT A PHONE IN THE HAND. This arm has been going up empty since
              // the day it shipped, which is why it read as a salute: an ear
              // and an empty fist is not a phone call to anybody watching.
              const ph = phoneOf(p);
              if (ph) { ph.visible = true; p._phoneFrame = frame; }
              // …and the glance back over the turned shoulder. ch.breath is
              // animChar's own per-frame clock (already advanced this frame),
              // and the phase is the body's own hash, so a street of callers
              // never checks over its shoulder in unison. Mostly turned away,
              // with a real look at you every few seconds — the thing you can
              // FEEL when someone is describing you down a phone.
              const t = (ch.breath || 0) + roleHash(p, 0x5119) * 6.28;
              const s = Math.sin(t * 0.85);
              const back = Math.max(0, s - 0.55) * 2.2;       // 0 most of the time, ~1 at the peak
              glanceAt(p, -(p._snitchTurn || 0) * (0.18 + Math.min(1, back) * 0.42));
            }
          } else if (p.posePoint > 0) {
            ch.parts.ra.rotation.set(-1.52, 0, 0);           // arm out: "that's the one"
            if (J.ra) J.ra.rotation.x = -0.04;
            if (LEG) {
              // AIM THE ACCUSATION. landReport turned him toward you ONCE; from
              // that frame on the body drifted wherever the brain sent it while
              // the arm stayed out, so the point landed on empty pavement as
              // often as on you. Hold the line for the window instead, and
              // straighten the elbow the rest of the way — a bent arm out to
              // the side is a slap, a straight one down the sight line is a
              // point. The shoulder rolls a touch inboard so the arm crosses
              // onto the centre line rather than pointing past your ear.
              const P2 = CBZ.player;
              if (P2 && !P2.dead && !p._npcAttached && !p.inCar && !ch.sitting) {
                faceTo(p, P2.pos.x, P2.pos.z, 0.3);
              }
              ch.parts.ra.rotation.set(-1.55, 0, 0.08);
              if (J.ra) J.ra.rotation.x = -0.02;             // arm straight to the fingertip
              if (ch.neck) ch.neck.rotation.z = 0;           // head up, talking to the officer
            }
          } else if (p.state === "film" && ch.parts.la) {
            ch.parts.ra.rotation.set(-1.30, -0.18, -0.10);   // phone held up, two hands
            if (J.ra) J.ra.rotation.x = -0.55;
            ch.parts.la.rotation.set(-1.15, 0.22, 0.15);
            if (J.la) J.la.rotation.x = -0.75;
            if (LEG) {
              // the gawker's hands were cupped around nothing too. Same prop,
              // same socket, same lifecycle — a phone held up at you IS the
              // gesture, and there is no second one to maintain.
              const ph = phoneOf(p);
              if (ph) { ph.visible = true; p._phoneFrame = frame; }
            }
          }
        }
      }
    }
    // WHERE THE NEXT SWEEP RESUMES. Reaching the end of the roster with budget
    // still in hand is a COMPLETED sweep — wrap to 0 so the bodies sitting ahead
    // of this frame's cursor are the first ones served next time, which is what
    // makes "every ped gets decision time within a bounded number of frames"
    // true rather than hopeful. An over-budget frame parks the cursor on the
    // body AFTER the one that spent the last of it, so the roster is walked
    // once per sweep with no body visited twice and none skipped. The cursor
    // always advances by at least one when there was any decision work to do
    // (the deadline is charged after the work), so a frame can never stall on
    // the same body forever. Untouched when the flag is off.
    if (_budgetOn) _simCursor = (_budOver && _budStop < peds.length) ? _budStop : 0;

    // age out / pick up dropped weapons (player auto-grabs by walking over)
    for (let i = CBZ.cityDrops.length - 1; i >= 0; i--) {
      const d = CBZ.cityDrops[i]; d.t += dt;
      if (d._taking) continue;           // a hand is already on it
      const P = CBZ.player;
      if (!P.dead && !P.driving && Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        // TAKEN WITH A HAND (systems/verbs_pickup.js): the gun leaves the
        // ground in the hand; the weapon is yours on the grab frame
        d._taking = true;
        const took = function () {
          if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(d.weapon);
          if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(d.ammo);
          CBZ.city && CBZ.city.note("Picked up " + d.weapon, 1.4);
          const j = CBZ.cityDrops.indexOf(d);
          if (j >= 0) removeDrop(j);
        };
        if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(P, d.mesh || { x: d.x, y: d.y, z: d.z, kind: "gun" }, { pose: "grip", keep: true, onTaken: took });
        else took();
        continue;
      }
      // A DEATH DROP BELONGS TO THE BODY. An ordinary dropped gun ages out in
      // 30 s, which was fine when a corpse was deleted at 75 s and is a lie now
      // that one can lie there for minutes: you would walk back to a body with
      // an empty patch of pavement where his rifle had been. morgue.js's
      // cityDropHeld answers "the owner of this drop is still on the ground";
      // when he is collected (or culled) the drop resumes its normal 30 s life
      // from that moment. Degrade-safe: no morgue.js → the old flat 30 s.
      if (d.t > 30 && !(CBZ.cityDropHeld && CBZ.cityDropHeld(d))) removeDrop(i);
      else if (d.t > 30) d.t = 29;
    }
  });
})();
