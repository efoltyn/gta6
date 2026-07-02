/* ============================================================
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
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle } = CBZ;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};
  const tmp = new THREE.Vector3();
  // CONTEXT-STEERING scratch (Builder B side of the citynav contract). Reused
  // every frame so the near-crowd steer is alloc-free at ~100 rigs: a flat
  // neighbour buffer [x0,z0,x1,z1,...] filled by the bounded near-ped scan, and
  // one `out` object cityNav.contextSteer writes the chosen unit dir into. The
  // 8 cap mirrors the old separation cap (n>=4 pairs ≈ what crowding warrants);
  // the buffer is oversized so we never realloc.
  const _nbrBuf = new Float32Array(32);   // up to 16 neighbour pairs
  const _ctxOut = { x: 0, z: 0 };
  // One spatial index for the rich city-ped rigs. Context steering used to
  // rescan the full ped list for every active mover; that becomes quadratic as
  // the city cast grows. Rebuild once per frame, then inspect only local cells.
  // The nearest-N insertion below is also smarter than the old first-N-in-array
  // cap: steering always reacts to the closest bodies, independent of spawn
  // order.
  let _pedGrid = null;
  const _pedGridList = [];
  const _nbrD2 = new Float32Array(8);
  const _nbrX = new Float32Array(8), _nbrZ = new Float32Array(8);
  function _pedVec(p) { return p.pos; }
  function rebuildPedGrid() {
    if (!_pedGrid && CBZ.makeGrid) _pedGrid = CBZ.makeGrid(4);
    if (!_pedGrid) return;
    _pedGridList.length = 0;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p.dead && !p.inCar && !p._parked && p.enterT <= 0) _pedGridList.push(p);
    }
    _pedGrid.rebuild(_pedGridList, _pedVec);
  }
  // fleeFrom runs on a STATE TRANSITION (not the per-frame hot loop), so it may
  // build its short ped.path array there — cityNav.routeTo writes into the caller
  // array we hand it (ped owns ped.path; move() shifts it as the ped advances).

  const PED_R = 0.5, ANIM_D2 = 58 * 58, TAG_D2 = 26 * 26, FAR_D2 = 110 * 110;
  // Full-rig render distance. The instanced ambient crowd covers everything past
  // this, so drawing 16-mesh rigs out to 150u was pure waste — tightened to 95u.
  // Adaptive quality (core/quality.js -> CBZ.pedLOD) scales it down further on
  // weak GPUs. SHADOW_D2: rigs past ~42u stop casting shadows (a rig 50u away is
  // a few px tall — its shadow is invisible, but it doubled its cost in the
  // shadow pass). Toggled only on threshold crossings, so it's ~free per frame.
  let VIS_D2 = 95 * 95, SHADOW_D2 = 42 * 42;
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
    const outfit = opts.outfit || pick(SHIRT, r());
    const skin = pick(SKIN, r());
    const wealth = opts.wealth != null ? opts.wealth : richWealth(r);
    const econ = CBZ.cityEcon;
    // ~45% of plain civvies wear the tee SHORT-SLEEVED. A bare-skin WHOLE arm
    // (the old way) read as sleeveless and the skin shoulder blended into the
    // shirt torso (user-filmed). A real short sleeve = shirt-colored
    // shoulder/upper-arm + bare forearm: arms stay the shirt color, and we
    // add a skin forearm box below mid-arm (see makeCharacter call's aftermath).
    const shortSleeve = !opts.outfit && r() < 0.45;
    // headgear where the JOB wears one — a rig only grows a cap slot at build
    // time (that's how cops get theirs), so it's decided here, off the cast job:
    // construction = the yellow hardhat, deputy = the khaki campaign hat read,
    // soldier = the olive patrol cap.
    const capCol = /construction/i.test(opts.job || "") ? 0xe8c020
      : /sheriff|deputy/i.test(opts.job || "") ? 0x8a7752
        : /soldier/i.test(opts.job || "") ? 0x44503a : null;
    // stashed on the ped below (_longHair) so schedule.js's ledger can persist
    // this roll — otherwise a woman who despawns and re-deals comes back bald.
    const longHair = gender === "f" && r() < 0.6;
    const ch = makeCharacter({
      legs: pick(PANTS, r()), torso: outfit, collar: outfit, arms: outfit, skin, hair: pick(HAIR, r()),
      shoes: r() < 0.3 ? 0xd8d8d8 : 0x2b2b2b, cap: capCol,
      build: gender === "f" ? "f" : "m", longHair,
    });
    // SHORT SLEEVE: bare the forearm (lower ~45% of the arm) with a skin box on
    // each arm pivot — reads as a tee sleeve ending mid-bicep, no sleeveless
    // skin shoulder blending into the shirt. Rides the arm swing; shared geo.
    if (shortSleeve && ch.parts && CBZ.cmat && window.THREE) {
      [ch.parts.la, ch.parts.ra].forEach(function (arm) {
        if (!arm) return;
        const fa = new window.THREE.Mesh(CBZ.boxGeom(0.31, 0.42, 0.31), CBZ.cmat(skin));
        fa.position.y = -0.72;                 // below mid-arm, above the hand cap (-0.93)
        fa.castShadow = true;
        arm.add(fa);
      });
    }
    ch.group.position.set(x, 0, z);
    ch.group.rotation.y = r() * 6.28;
    const nm = opts.name || name(r, gender);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(nm) : null;
    if (tag) { tag.position.y = 3.0; tag.scale.set(3, 0.75, 1); tag.visible = false; ch.group.add(tag); }
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
    // tracksuits, dock workers hi-vis. Caster-chosen outfits still win.
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
    if (!opts.outfit && CBZ.cityOutfitFor && CBZ.cityRecolorRig) {
      const fit = CBZ.cityOutfitFor({ archetype, job: opts.job, gang: opts.gang, vendor: opts.vendor, rng: r, seed: (skin ^ outfit) | 0, sex: gender });
      if (fit && fit.colors) {
        CBZ.cityRecolorRig(ch, fit.colors, fit);
        _castFit = fit.id;                          // stamped on the ped below (redress revert read)
      }
      // NOT a role/gang/business identity → ordinary civilian. Painted basics
      // ONLY when the plain switch is off (the old "nobody is a flat slab" look);
      // the painted pass repaints ARMS, so skip it on short-sleeve bodies so the
      // bare forearm survives.
      else if (!_plain && CBZ.cityApplyClothes && !shortSleeve) CBZ.cityApplyClothes(ch, { id: "basics", colors: { torso: outfit } });
    }
    // cash: econ.rollCashFor(archetype, wealth, r) when present, else a who-aware
    // fallback (boss/tycoon fat, dealer big, ordinary modest). Guarded per contract.
    let cash = opts.cash != null ? opts.cash
      : (econ && econ.rollCashFor ? econ.rollCashFor(archetype, mWealth, r) : fallbackCashFor(archetype, mWealth, r));
    // E4 CIRCULATION (sim/npcecon.js): an ordinary resident's spawn cash is
    // drawn from their district cohort's wallet mean instead of pure RNG —
    // this closes the robbery money-printer (strip-mine a district and its
    // FUTURE spawns carry less, not just its current pedestrians).
    if (opts.cash == null && archetype === "resident" && CBZ.npcEcon && CBZ.npcEcon.drawCash && econ && econ.districtAt) {
      const drawn = CBZ.npcEcon.drawCash(econ.districtAt(x, z), mWealth, r);
      if (drawn != null) cash = drawn;
    }
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
    // gets a real rank so level.js reads "Lv.36 Lieutenant", not "Civilian". A
    // unit is a PYRAMID, so this roll is weighted hard to privates with a thin
    // officer corps and a rare general — a base reads like a real chain of
    // command. Keyed off opts.job (the same signal that chose the costume) so the
    // stripes always match the uniform. Deterministic from the spawn stream.
    let milRank = null;
    if (/soldier|military|marine/i.test(opts.job || "")) {
      const mr = r();
      milRank = mr < 0.52 ? "private" : mr < 0.72 ? "corporal" : mr < 0.85 ? "sergeant"
        : mr < 0.92 ? "lieutenant" : mr < 0.96 ? "captain" : mr < 0.985 ? "major"
          : mr < 0.997 ? "colonel" : "general";
    }
    const ped = {
      char: ch, group: ch.group, pos: ch.group.position, name: nm, gender,
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
      baseSpeed: 1.5 + r() * 1.0, speed: 0,
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
    };
    if (ped.vendor) ped.kind = "vendor";
    // FUGITIVE flavor: re-label a wanted ped so the tag reads as a recognizable
    // mark ("☠ WANTED · Marcus V." / "☠ WANTED TERRORIST · …"). Cheap: rebuild the
    // one sprite once at spawn. Pure cosmetic — the bounty itself is the payoff.
    if (ped.bounty > 0 && ped.tag && CBZ.makeLabelSprite) {
      const label = "☠ " + (ped.bountyTag || "WANTED") + " · " + nm;
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
    if (!opts.archetype) {
      const x = r();
      if (x < 0.02) { opts.archetype = "laborer"; opts.job = "construction worker"; }
      else if (x < 0.03) { opts.archetype = "professional"; opts.job = "sheriff's deputy"; }
      else if (x < 0.038) { opts.archetype = "professional"; opts.job = "soldier on leave"; }
      else if (x < 0.044) { opts.archetype = "professional"; opts.job = "firefighter"; }
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
  let _scareT = 0;             // citywide cooldown (s); next scare can't fire until this hits 0
  let _scareScan = 0;          // round-robin cursor so we don't always probe the same peds
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_HOBO_SCARE === false) return;
    if (_scareT > 0) { _scareT -= dt; return; }
    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    if (night < 0.55) return;                                  // daylight: no jumpscares
    const P = CBZ.player; if (!P || P.dead || P.driving) return;
    const peds = CBZ.cityPeds; if (!peds || !peds.length) return;
    const PA = CBZ.city && CBZ.city.playerActor;
    const px = P.pos.x, pz = P.pos.z;
    let scanned = 0;
    while (scanned < 18) {
      const p = peds[_scareScan]; _scareScan = (_scareScan + 1) % peds.length; scanned++;
      if (!p || p.dead || p._parked || p.inCar || p.ko > 0 || p.enterT > 0) continue;
      if (p.isPlayer || p.controlled || p.companion || p.recruited || p.gang) continue;
      // a HOBO, or a creepy lone ped: the lurker in the dark. Skip anyone already
      // mid-scene (raging/fleeing/surrendering) and the recently-scared (per-ped CD).
      const creepy = p.vagrant || p._role === "panhandler";
      if (!creepy) continue;
      if (p.rage || p.surrender || p.state === "flee" || p.state === "fight") continue;
      if ((p._scareCD || 0) > 0) { p._scareCD -= dt; continue; }
      const dx = px - p.pos.x, dz = pz - p.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.7 * 1.7 || d2 > 3.0 * 3.0) continue;          // the 2-3m "right next to you" band
      // SNAP: whip around to face you, freeze the shuffle, recoil pose.
      p.group.rotation.y = Math.atan2(dx, dz);
      p.speed = 0; p.pause = Math.max(p.pause, 0.8);
      p.poseCower = Math.max(p.poseCower || 0, 0.7);            // reactions.js animates the hunch/recoil
      p._scareT = 0.9;                                          // transient marker (rig may read it)
      p._scareCD = 22 + rng() * 10;                             // this hobo won't scare you again for ~25s
      if (CBZ.citySay) CBZ.citySay(p, pick(["“GET BACK!”", "“YOU SEE EM TOO?!”", "“DON'T TOUCH ME!”", "“THEY'RE WATCHING!”"], rng()), "#ff7b6b", 1.6);
      if (CBZ.sfx) CBZ.sfx("punch");                           // a sharp startle stinger
      if (CBZ.shake) CBZ.shake(0.5);                            // the camera flinch
      // VOLATILE vagrant (≥ violent band): the scare has TEETH — it lunges.
      if (PA && p.aggr >= ((A0().violent) || 0.88)) {
        p.rage = PA; p.state = "fight"; p.reactCD = 8;
      }
      _scareT = 6 + rng() * 4;                                  // citywide gap before the next fright
      return;                                                   // one scare per pass, max
    }
  });

  // SPAWN-SLICE flag (default ON; honour an owner-set value so a toggle sticks).
  // OFF → spawnCityPeds runs the exact old synchronous burst. The whole feature
  // is in one place (spawnCityPeds below) and degrades to today when this is
  // false, the scheduler is missing, or under the profiler.
  if (CBZ.spawnSlice === undefined) CBZ.spawnSlice = true;

  CBZ.spawnCityPeds = function (n) {
    CBZ.clearCityPeds();
    CBZ.cityPopulationReset();          // fresh city → reset the finite headcount
    _fugitives = 0; _megaFugitiveSpawned = false;   // fresh fugitive roster (bounties re-roll)
    const A = CBZ.buildCity();
    _s = 555 + n;
    if (CBZ.cityEcon && CBZ.cityEcon.initMarket) CBZ.cityEcon.initMarket();
    if (CBZ.market && CBZ.market.reset) CBZ.market.reset();   // E1: fresh city → levels back to 1.0
    if (CBZ.econState && CBZ.econState.reset) CBZ.econState.reset();   // E2: fresh city → EconState back to equilibrium
    if (CBZ.npcEcon && CBZ.npcEcon.reset) CBZ.npcEcon.reset();   // E4: fresh city → cohort wallets re-seeded off the fresh population
    if (CBZ.corps && CBZ.corps.reset) CBZ.corps.reset();   // E5: fresh city → the roster resets (re-claims outlets on the next build tick)
    if (CBZ.stocks && CBZ.stocks.reset) CBZ.stocks.reset();   // E7: fresh city → exchange/portfolio/index reset (no stale prior-run IPO tickers)
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
      if (A.shopLots) for (const lot of A.shopLots) {
        const vs = lot.building.vendorSpot;
        // the Ammu-Nation gunsmith (and the security firm) keep a gun behind the
        // counter — of course. Robbing/downing them drops it for the taking. A
        // higher nerve makes them stand their ground rather than flee.
        const packsHeat = lot.kind === "guns" || lot.kind === "security";
        const ped = makePed(vs.x, vs.z, rng, {
          vendor: lot, kind: "vendor", wealth: 0.7, cash: 80 + ((rng() * 200) | 0),
          name: vendorName(lot), aggr: packsHeat ? 0.55 : 0.3,
          archetype: "merchant", job: vendorName(lot).toLowerCase(),
          armed: packsHeat, weapon: packsHeat ? (lot.kind === "guns" ? "Carbine" : "Pistol") : null,
        });
        if (packsHeat) { ped.nerve = 0.85; ped.ammo = 40; }
        ped.group.rotation.y = vs.face;
        A.root.add(ped.group);
        CBZ.cityPeds.push(ped);
        lot.building.vendor = ped;
      }
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
  if (CBZ.onUpdate) CBZ.onUpdate(0.5, function () {
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
        if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
      });
    }
    CBZ.cityPeds.length = 0;
    CBZ.cityDrops.length = 0;
    if (CBZ.citySecurity) CBZ.citySecurity.length = 0;
  };

  // ---- alarm everyone near (x,z); offender lets witnesses remember who ----
  CBZ.cityAlarm = function (x, z, radius, intensity, offender) {
    radius = radius || 18; intensity = intensity || 1;
    const r2 = radius * radius;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) {
        p.alarmed = Math.max(p.alarmed, 4 + intensity * 3);
        p.fear = Math.min(10, p.fear + intensity);
        if (offender && offender !== p && offender.pos) p.mem = offender;     // witness memory
      }
    }
  };

  // ---- CROWD PANIC: a loud, scary event (gunfire, explosion, a body dropping)
  //      sends a shockwave of fear through the nearby crowd — people scatter,
  //      scream, and the panic ripples outward as fleeing peds alarm the next
  //      ring out. Cheaper + punchier than cityAlarm: it forces a FLEE state and
  //      a clear escape heading away from the blast so the street empties fast,
  //      GTA-style. `power` scales radius + how hard they bolt. ----
  let _lastPanicFrame = -1;
  // `blast` (4th arg) marks an actual EXPLOSION (vs a body-drop). On a blast even
  // the violent/raging back off the blast SEAT for a beat — nobody, however
  // fearless, walks INTO a fresh fireball — so a bazooka never gets a suicidal
  // charge. Without it the old behaviour stands (bold peds just get jumpy).
  CBZ.cityPanic = function (x, z, power, offender, blast) {
    power = power || 1;
    const radius = 16 + power * 10, r2 = radius * radius;
    // close-in "blast danger" ring: inside this even the fearless retreat
    const dangerR = blast ? (8 + power * 4) : 0, dangerR2 = dangerR * dangerR;
    let scattered = 0;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.companion || p.controlled || p._parked || p.recruited) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z, dd = dx * dx + dz * dz;
      if (dd >= r2) continue;
      const close = 1 - Math.sqrt(dd) / radius;            // 0 at edge, 1 at centre
      p.alarmed = Math.max(p.alarmed, 5 + power * 3 * close);
      p.fear = Math.min(10, p.fear + (4 + power * 4) * close);
      if (offender && offender !== p && offender.pos) p.mem = p.mem || offender;
      // a brief CRINGE: throw arms up / hunch away from the blast for a beat, like
      // the jail crowd flinching at gunfire. reactions.js reads poseCower to drive
      // it; even peds too bold to bolt visibly recoil. Scaled by proximity.
      p.poseCower = Math.max(p.poseCower || 0, 0.5 + 0.8 * close);
      // BLAST SEAT: anyone (even a violent ped or one raging at the player) bolts
      // away from a fresh fireball they're standing on top of — never charge it.
      if (blast && dd < dangerR2) {
        p.rage = null;
        fleeFrom(p, x, z);            // vetted away-heading (won't bolt through a wall)
        p.fear = 10; scattered++;
        continue;
      }
      // the meek & wary in range bolt right now; the bold just get jumpy
      if (p.aggr < (A0().crook || 0.72) && !p.rage && p.state !== "fight") {
        fleeFrom(p, x, z);            // vetted away-heading
        scattered++;
      }
    }
    // a SINGLE punctuating scream on a genuinely scary event (gunfire / explosion
    // / a body dropping caused this panic). Small chance even then, and the
    // scream() helper enforces the hard city-wide cooldown — so a big panic is one
    // scream, not a wall of noise. Only worth it when real fear actually landed.
    if (scattered >= 2 && _lastPanicFrame !== frame) { _lastPanicFrame = frame; if (rng() < 0.18) scream(); }
    return scattered;
  };

  // tag everyone in sight of a crime as a witness who can phone it in (the
  // ONLY way the player gets stars — RDR2 style). `sev` = crime weight.
  CBZ.cityTagWitnesses = function (x, z, sev, type) {
    const r2 = 30 * 30;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) {
        p.mem = CBZ.city.playerActor;
        if ((sev || 0) >= (p.witnessSev || 0)) p.witnessType = type;   // remember the WORST thing they saw, by name
        p.witnessSev = Math.max(p.witnessSev || 0, sev);
        p.alarmed = Math.max(p.alarmed, 5);
        p.fear = Math.min(10, p.fear + 1.5);
      }
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
      CBZ.city.big(lethal ? "☠ You killed the boss's family — the crew is coming"
                          : "⚠ You crossed the boss's family");
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

  CBZ.cityKOPed = function (ped, fromX, fromZ) {
    if (!ped || ped.dead) return;
    if (ped.reportState) cancelReport(ped);    // knocked out mid-call → no report lands
    leaveSit(ped);                             // a felled desk worker leaves the seat (C3)
    ped.ko = 8; ped.alarmed = 6;
    if (CBZ.body) CBZ.body.hit(ped, { fromX, fromZ, force: 7, knockdown: true });
    if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
    // laying hands on a boss's wife/kin brings the crew (non-lethal harm).
    if (ped.protectGang) CBZ.cityFamilyHarmed(ped, true, false);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 0.8, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(45, { x: ped.pos.x, z: ped.pos.z, type: "assault" });
  };

  // SIT-INTERRUPT helper (C3): a seated desk worker that just got KO'd / killed /
  // hit must LEAVE the seat — clear the seated pose flag, free its claimed desk
  // (officejobs.js, optional-chained) and forget the anchor. move() also clears
  // char.sitting whenever the state drifts off "sit", but the KO/kill paths skip
  // move() entirely (the main loop `continue`s on dead/ko bodies), so an explicit
  // clear here is what keeps a felled worker from carrying a stale sit pose.
  function leaveSit(ped) {
    if (!ped) return;
    if (ped.char && ped.char.sitting) ped.char.sitting = false;
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
    // FINITE POPULATION: a named rig just died → tick the city headcount DOWN.
    // Promoted crowd rigs (ped._crowd) die through HERE (they're real peds);
    // un-promoted ambient agents die through cityCrowdKill (crowd.js) — the two
    // paths are mutually exclusive per individual, so every distinct death
    // decrements the roster EXACTLY once. Cops aren't part of the civilian
    // populace and never route through cityKillPed, so the headcount stays clean.
    if (CBZ.cityPopulationDie) CBZ.cityPopulationDie(1);
    // an armed ped drops their gun where they fall (anyone can grab it)
    if (ped.armed && ped.weapon) dropWeapon(ped.pos.x, ped.pos.z, ped.weapon, ped.ammo);
    ped.armed = false; ped.weapon = null; ped.ammo = 0;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    // bodies carry WAY more than you'd lift off the living — loot the corpse
    rollDeadLoot(ped);
    if (CBZ.gore && ped.pos) {
      let dir = null;
      if (imp && imp.fromX != null) dir = { x: ped.pos.x - imp.fromX, z: ped.pos.z - imp.fromZ };
      // an explosion tears a body apart — heavier mist/spray/gibs than a clean shot.
      const goreAmt = cause === "explosion" ? 1.9 : 1.0;
      CBZ.gore(ped.pos.x, ped.pos.y + 1.0, ped.pos.z, { dir, amount: goreAmt, cloth: ped.outfit, skin: ped.skin });
      // ---- EXPLOSION DISMEMBERMENT: a blast can tear a limb clean off. Hide it on
      // the corpse + spray a second gore burst at the stump (a torn limb flung from
      // the wound). LEAK-SAFE: a dead rig is never revived — pooled corpses are
      // replaced by a fresh makeCharacter (crowd.js:313) and standalone corpses are
      // disposed, so no living ped ever inherits a missing limb. Real, gruesome,
      // INTENTIONAL — the limb-loss you saw is now a designed effect, not a glitch.
      if (cause === "explosion" && ped.char && ped.char.parts && Math.random() < 0.5) {
        const LIMBS = ["ll", "rl", "la", "ra"];                 // legs read most dramatic
        const key = LIMBS[(Math.random() * LIMBS.length) | 0];
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
    let ragged = false;
    if (CBZ.cityRagdoll && ped.char && ped.char.parts && !ped.inCar) {
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
      if (imp && imp.fromX != null) {
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
    if (CBZ.body && !ragged) {
      if (imp && imp.fromX != null) CBZ.body.hit(ped, { fromX: imp.fromX, fromZ: imp.fromZ, force: imp.force || 7, fling: imp.fling || 4 });
      else { const a = rng() * 6.28; CBZ.body.hit(ped, { dir: { x: Math.cos(a), z: Math.sin(a) }, force: 3, fling: 5 }); }
      // belt-and-braces: force a hard knockdown too. hit(knockdown) sets _phys.down,
      // so even if the fling lands the same frame the body is already flagged DOWN
      // and grapple owns it — a dead ped can never be left upright or half-sunk.
      if (CBZ.body.knockdown) CBZ.body.knockdown(ped, { dir: { x: 0, z: 1 }, force: 1, t: 9999 });
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
          CBZ.city.big("🎯 BOUNTY CLAIMED: $" + amt.toLocaleString() + " — " + (ped.bountyTag || "WANTED") + " " + (ped.name || ""));
          CBZ.city.addRespect(amt >= 1000000 ? 25 : 5);
        }
        if (CBZ.sfx) CBZ.sfx("coin");
      }
    }
    if (ped.gang && CBZ.cityGangMemberDown) CBZ.cityGangMemberDown(ped, imp);
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
  }

  // loot a corpse (interact.js [I] near a body): take the whole haul
  CBZ.cityLootCorpse = function (ped) {
    if (!ped || !ped.dead || !ped.deadLoot || ped.deadLoot.looted) return null;
    const dl = ped.deadLoot; dl.looted = true;
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
  CBZ.cityNearestCorpse = function (x, z, maxd) {
    let best = null, bd = (maxd || 3) * (maxd || 3);
    for (const p of CBZ.cityPeds) { if (!p.dead || !p.deadLoot || p.deadLoot.looted || p.culled) continue; const dd = (p.pos.x - x) * (p.pos.x - x) + (p.pos.z - z) * (p.pos.z - z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  };

  // ---- dropped weapons ----
  function dropWeapon(x, z, weapon, ammo) {
    let mesh = null;
    if (CBZ.city && CBZ.city.arena) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.22), CBZ.mat(0x1c1f24, { emissive: 0x39ff66, ei: 0.25 }));
      mesh.position.set(x, 0.25, z); mesh.userData.transient = true;
      CBZ.city.arena.root.add(mesh);
    }
    CBZ.cityDrops.push({ x, z, weapon: weapon || "Pistol", ammo: ammo || 24, t: 0, mesh });
  }
  CBZ.cityDropWeapon = dropWeapon;

  function removeDrop(i) {
    const d = CBZ.cityDrops[i];
    if (d && d.mesh && d.mesh.parent) { d.mesh.parent.remove(d.mesh); if (d.mesh.geometry) d.mesh.geometry.dispose(); if (d.mesh.material) d.mesh.material.dispose(); }
    CBZ.cityDrops.splice(i, 1);
  }

  // ---- damage helpers used by the NPC brain (NPC vs NPC / NPC vs cop / NPC vs player) ----
  function lawfulSecurityAct(att, tgt) {
    if (!att || att.kind !== "security" || !tgt) return false;
    if (att.mem === tgt && att.alarmed > 0) return true;
    return tgt.isPlayer ? (g.wanted | 0) >= 1 : (tgt.npcWanted | 0) >= 1;
  }

  function hurtActor(att, tgt, dmg, melee) {
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
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, fx, fz, att.kind === "cop" ? "gunned down" : "killed in the street", false, att);
      // a melee beatdown can knock you off your feet (physics.js owns the get-up)
      if (melee && CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor &&
          !((CBZ.game.invuln || 0) > 0) && !CBZ.body.busy(CBZ.city.playerActor) && Math.random() < 0.33) {
        CBZ.body.knockdown(CBZ.city.playerActor, { fromX: fx, fromZ: fz, force: 7, t: 1.0 });
      }
      if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 22 : 40, melee ? "assault" : "shots-fired");
      return;
    }
    if (tgt.kind === "cop") {
      if (CBZ.cityHurtCop) CBZ.cityHurtCop(tgt, dmg, { fromX: fx, fromZ: fz });
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 60 : 110, "attacked-officer");
      return;
    }
    // ped vs ped
    tgt.hp -= dmg;
    // the body CARRIES the hit (wounds.js): entry wound + blood soak on the clothing
    if (CBZ.bodyWound) CBZ.bodyWound(tgt, { x: tgt.pos.x, y: (tgt.pos.y || 0) + 1.05 + Math.random() * 0.55, z: tgt.pos.z }, melee ? { melee: "blunt", fromX: fx, fromZ: fz } : { fromX: fx, fromZ: fz });
    tgt.alarmed = Math.max(tgt.alarmed, 6); tgt.fear = Math.min(10, tgt.fear + 2);
    if (tgt.char && tgt.char.sitting) leaveSit(tgt);   // a struck desk worker is off the seat NOW (C3 interrupt)
    // SIZE-UP (sizeup.js): rallies a gang victim's set, folds the outclassed
    // (hands up / run), and returns whether this person DARES to fight back.
    const dare = CBZ.citySizeUpHit ? CBZ.citySizeUpHit(tgt, att) : true;
    if (!tgt.rage && dare && tgt.aggr >= (A0().bold || 0.5)) { tgt.rage = att; tgt.state = "fight"; }   // fight back
    if (tgt.hp <= 0) CBZ.cityKillPed(tgt, { fromX: fx, fromZ: fz, attacker: att, byPlayer: false, force: melee ? 6 : 5, fling: melee ? 3 : 4 });
    else if (CBZ.body) CBZ.body.hit(tgt, { fromX: fx, fromZ: fz, force: melee ? 5 : 3, knockdown: melee && rng() < 0.3 ? 1 : 0 });
    if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 18 : 36, "assault");
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

  function npcAttack(att, tgt) {
    if (att.attackCD > 0 || !tgt || tgt.dead) return;
    const dx = att.pos.x - tgt.pos.x, dz = att.pos.z - tgt.pos.z;
    const dh = Math.hypot(dx, dz);                        // horizontal gap
    if (att.armed && att.ammo > 0 && dh < 26) {
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
      att.attackCD = prof.cd + rng() * prof.cspr; att.ammo--;
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
      const hit = rng() < Math.max(0.15, 0.8 - d3 * 0.03);
      if (hit) hurtActor(att, tgt, prof.dmg + rng() * prof.dspr, false);
      // a round only catches a bystander when it actually traveled the lane (it had
      // LOS); a blocked shot never fires, so there's no phantom crossfire behind cover.
      crossfire(att, tgt, !hit);
      if (att.ammo <= 0) { att.armed = false; att.weapon = null; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(att); }
    } else if (dh < 2.4) {
      // melee — needs a real reach: no clubbing a rooftop target from the street below.
      if (Math.abs((tgt.pos.y || 0) - (att.pos.y || 0)) > 2.2) return;
      att.attackCD = 0.5 + rng() * 0.4;
      if (CBZ.sfx) CBZ.sfx("punch");
      hurtActor(att, tgt, 16 + rng() * 8, true);
    }
  }

  // grab the nearest dropped gun (for an unarmed aggressive ped)
  function nearestDrop(x, z, maxd) {
    let best = -1, bd = maxd * maxd;
    for (let i = 0; i < CBZ.cityDrops.length; i++) { const d = CBZ.cityDrops[i]; const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }

  // nearest other actor matching a test (peds + cops)
  function nearestActor(self, maxd, test) {
    let best = null, bd = maxd * maxd;
    const scan = (p) => { if (p === self || p.dead) return; if (!test(p)) return; const dd = (p.pos.x - self.pos.x) * (p.pos.x - self.pos.x) + (p.pos.z - self.pos.z) * (p.pos.z - self.pos.z); if (dd < bd) { bd = dd; best = p; } };
    for (const p of CBZ.cityPeds) scan(p);
    for (const c of CBZ.cityCops) scan(c);
    return best;
  }

  function band(a) { const B = A0(); return a < (B.flee || 0.3) ? "meek" : a < (B.bold || 0.5) ? "wary" : a < (B.crook || 0.72) ? "bold" : a < (B.violent || 0.88) ? "crook" : "violent"; }

  // who is attacking `who`? returns the attacker actor (a ped raging at them, or
  // the player if the player is mid-fight near them). Cheap bounded scan.
  function attackerOf(who) {
    if (!who || who.dead) return null;
    const peds = CBZ.cityPeds;
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
      const peds = CBZ.cityPeds, R2 = 14 * 14;
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

  // ---- a cheap internal day clock so the crowd has a believable RHYTHM.
  //      No real sun system exists, so peds run their own loose 24h loop
  //      (~6 real-min day). It only nudges WHICH routine destinations they
  //      favour — work in the day, home/leisure at night — it never forces a
  //      ped anywhere, so it coexists with aigoals.js' EARN/DRUGS/etc. layer.
  let _dayClock = 9.5;                 // start mid-morning
  const DAY_LEN = 360;                 // seconds per in-city day
  CBZ.cityHour = function () { return _dayClock; };           // 0..24, for other modules
  function dayPhase() {                                       // coarse phase of life
    const h = _dayClock;
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
      if (h) {
        const door = h.building && h.building.door;
        if (door) return { x: door.x, z: door.z, enter: true };
        return { x: h.cx + (rng() - 0.5) * (h.w || 6), z: h.cz + (rng() - 0.5) * (h.d || 6) };
      }
    }
    // work hours: commute to YOUR fixed workplace (not a fresh random door)
    if (phase === "morning" || phase === "work") {
      if (ped.archetype === "merchant") return null;   // vendors are posted; don't pull them
      const w = workLot(ped, A);
      if (w && w.building && w.building.door) return { x: w.building.door.x, z: w.building.door.z, enter: true };
    }
    // by day, gravitate to the kind of place that fits the hour / archetype
    let prefer = null;
    if (phase === "lunch") prefer = rng() < 0.6 ? "food" : "bar";
    else if (phase === "evening") prefer = ["bar", "casino", "food", "gym"][(rng() * 4) | 0];
    if (prefer) {
      const matches = A.shopLots.filter((l) => l.kind === prefer);
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
          o.group.rotation.y = Math.atan2(ped.pos.x - o.pos.x, ped.pos.z - o.pos.z);
          o.pause = Math.max(o.pause || 0, 1.2 + rng() * 1.4); o.speed = 0; drawn++;
        }
        return true;
      }
    }
    if (role === "tourist" && ped._snapAt) {
      // stop to "photograph" the landmark: face it, hold a beat (phone-up vibe).
      const d = Math.hypot(ped.pos.x - ped._snapAt.x, ped.pos.z - ped._snapAt.z);
      if (d < 16 && rng() < 0.7) {
        ped.group.rotation.y = Math.atan2(ped._snapAt.x - ped.pos.x, ped._snapAt.z - ped.pos.z);
        ped.state = "film"; ped.pause = Math.max(ped.pause, 1.4 + rng() * 1.6); ped.speed = 0;
        return true;
      }
    }
    if (role === "panhandler" && ped._beg) {
      // linger and beg: barely moves, faces passers-by, occasional bark via social.
      ped.pause = Math.max(ped.pause, 2.5 + rng() * 2.5); ped.speed = 0;
      const mate = nearestActor(ped, 6, (p) => p.kind === "civilian" && !p.vendor && p.state !== "flee");
      if (mate) ped.group.rotation.y = Math.atan2(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z);
      return true;
    }
    if (role === "watcher") {
      // cop-watcher: keep eyes on the nearest cop, hold a beat (observing).
      const cop = nearestCop(ped.pos.x, ped.pos.z, 30);
      if (cop && rng() < 0.5) {
        ped.group.rotation.y = Math.atan2(cop.pos.x - ped.pos.x, cop.pos.z - ped.pos.z);
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
        const d = l.building && l.building.door; if (!d) continue;
        const dd = (d.x - ped.pos.x) * (d.x - ped.pos.x) + (d.z - ped.pos.z) * (d.z - ped.pos.z);
        if (dd < bd) { bd = dd; foodDoor = d; }
      }
    }
    // peckish residents / students linger and face a food spot (smell the grill)
    if (foodDoor && (a === "resident" || a === "student" || a === "laborer") && rng() < 0.5) {
      ped.group.rotation.y = Math.atan2(foodDoor.x - ped.pos.x, foodDoor.z - ped.pos.z);
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
      if (parkC) ped.group.rotation.y = Math.atan2(parkC.cx - ped.pos.x, parkC.cz - ped.pos.z);
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
      if (r < 0.25 && A.shopLots && A.shopLots.length) { const l = A.shopLots[(rng() * A.shopLots.length) | 0]; goal = { x: l.building.door.x, z: l.building.door.z, enter: true }; }
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
    ped.fear = 0; ped.alarmed = 0; ped.surrender = false; ped.rage = null;   // never panic/flee
    if (!ped.armed) { ped.armed = true; ped.weapon = ped.weapon || "Pistol"; ped.ammo = ped.ammo || 999; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); }
    if (ped.ammo < 6) ped.ammo = 999;                          // crew never runs dry (they're on payroll)
    if (!P || P.dead) { ped.state = "walk"; ped.target.set(ped.pos.x, 0, ped.pos.z); ped.path = null; return; }
    const threat = companionThreat(ped);
    if (threat && !threat.dead) {
      ped.state = "walk";
      ped.group.rotation.y = Math.atan2(threat.pos.x - ped.pos.x, threat.pos.z - ped.pos.z);
      const d = Math.hypot(threat.pos.x - ped.pos.x, threat.pos.z - ped.pos.z);
      ped.target.set(d > 13 ? threat.pos.x : ped.pos.x, 0, d > 13 ? threat.pos.z : ped.pos.z);   // close to ~13m, then hold + fire
      npcAttack(ped, threat);
    } else {
      ped.state = "walk";
      const d = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
      if (d > 60) ped.pos.set(P.pos.x + 3, 0, P.pos.z);        // teleport if hopelessly lost
      if (d > 4.5) { const fp = companionFollowPoint(ped, P); ped.target.set(fp.x, 0, fp.z); }
      else { ped.target.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z); }
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

  // nearest live cop to a point (for run-to-report)
  function nearestCop(x, z, maxd) {
    let best = null, bd = (maxd || 200) * (maxd || 200);
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (c.dead) continue; const dd = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  // how willing is THIS witness to call it in, given WHERE the crime happened?
  // 0..~1.2 propensity. Driven by: neighborhood (gang turf / "the hood" → omerta,
  // people hate the cops), the ped's hardwired snitch trait, and personality.
  function snitchPropensity(ped, x, z) {
    let p = 0.45;
    // base personality: the meek call cops (it's their only defence); brave/violent
    // people handle it themselves or don't care. Snitch trait shifts hard.
    p += (0.55 - ped.aggr) * 0.5;          // meek → more likely to phone it in
    p += (ped.snitch - 0.3) * 0.9;         // dedicated snitch rats anywhere
    p += Math.min(ped.fear, 8) * 0.04;     // scared people want the law NOW
    // NEIGHBORHOOD: on gang turf almost nobody calls — no-snitch code, and they
    // hate the police as much as the robber. A gang member NEVER rats their own.
    const hoodGang = CBZ.cityGangOf ? CBZ.cityGangOf(x, z) : null;
    if (hoodGang) {
      p -= 0.55;                            // the hood doesn't call 911
      if (ped.gang && ped.gang === hoodGang.id) p -= 1;   // omerta on home turf
    }
    // a gang member rats only a RIVAL, never the player/their own unless a true snitch
    if (ped.gang && !(ped.snitch > 0.85)) p -= 0.35;
    // wealthy / clean-area residents call fast (no hood gang nearby + money around)
    if (!hoodGang && ped.wealth > 0.65) p += 0.2;
    return p;
  }

  // BEGIN a report: the ped commits to phoning OR running to a cop. Sets the
  // state-machine fields; the actual landing happens in tickReport().
  function beginReport(ped, x, z) {
    // SNITCH MOMENT (the street remembers): a witness nursing a real grudge
    // against the player doesn't hide behind a phone — if a cop is on the block
    // (~40u) they MARCH straight to them and point you out in person. Revenge
    // beats the no-snitch code. (relPlayer is written by city/social.js.)
    const rel = ped.relPlayer;
    const vendetta = !!(rel && rel.grudge > 40 && ped.mem === CBZ.city.playerActor);
    const cop = nearestCop(ped.pos.x, ped.pos.z, 90);
    const dCop = cop ? Math.hypot(cop.pos.x - ped.pos.x, cop.pos.z - ped.pos.z) : 1e9;
    // a cop close by → run and tell them in person (faster, dramatic); otherwise
    // pull out a phone and dial 911 (a few seconds, interruptible).
    if (cop && (vendetta ? dCop < 40 : (dCop < 45 && rng() < 0.7))) {
      ped.reportState = "run"; ped.reportTarget = cop; ped.reportT = 16;   // hard cap
      ped._vendetta = vendetta;                                            // lands as a point-out
      showTell(ped, "🏃");
      if (vendetta && CBZ.citySay) CBZ.citySay(ped, "“Officer! OFFICER!”", "#ffd27b", 2.2);
    } else {
      ped.reportState = "phone"; ped.reportTarget = null;
      ped.reportT = 2.6 + rng() * 2.2;                                     // dialing time
      showTell(ped, "📱");
      ped.speed = 0;   // stand and dial
    }
    // (no "👀 … saw that" narration toast — an ambient caption over the world
    //  broke the fourth wall; the ped visibly bolting for a cop / dialing tells it)
  }

  // land the report: convert the witness's tag into actual stars (or punish an
  // NPC offender). Clears the witness so they don't double-report.
  function landReport(ped) {
    const off = ped.mem;
    const sev = ped.witnessSev || 8, type = ped.witnessType;
    if (off === CBZ.city.playerActor) {
      if (CBZ.cityReport) CBZ.cityReport(sev, { x: ped.pos.x, z: ped.pos.z, type: type });
      if (ped._vendetta) {
        // a grudge witness reached the officer: they stop, turn, and POINT you
        // out in person. (posePoint is set for reactions.js to raise the arm —
        // a no-op until that hook lands; the turn + line carry it meanwhile.)
        ped.posePoint = 1.4;
        const P = CBZ.player;
        if (P && !P.dead) ped.group.rotation.y = Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
        if (CBZ.citySay) CBZ.citySay(ped, "“Right there. That's the one.”", "#ffd27b", 2.4);
        CBZ.city && CBZ.city.note("🗣️ " + ped.name + " pointed you out to the law!", 1.8);
      } else {
        CBZ.city && CBZ.city.note("🗣️ " + ped.name + " reported you!", 1.5);
      }
    } else if (off && CBZ.cityNpcOffense) {
      CBZ.cityNpcOffense(off, 14, "reported");
    }
    ped._vendetta = false;
    ped.witnessSev = 0; ped.witnessType = null;
    ped.reportState = null; ped.reportTarget = null; ped.reportT = 0;
    ped.callT = 8;            // won't immediately re-report
    clearTell(ped);
  }

  // abort an in-progress report (scared off, hurt, lost the cop, fled too far)
  function cancelReport(ped) {
    ped.reportState = null; ped.reportTarget = null; ped.reportT = 0; ped._vendetta = false;
    clearTell(ped);
  }
  CBZ.cityCancelReport = cancelReport;   // combat.js can stop a snitch by force

  // advance an in-progress report each frame. Returns true if the ped is BUSY
  // reporting (think() should let move() carry the run/dial out).
  function tickReport(ped, dt) {
    if (!ped.reportState) return false;
    // if the witness no longer remembers a crime (scared into forgetting), drop it
    if (!ped.mem || !(ped.witnessSev > 0)) { cancelReport(ped); return false; }
    ped.reportT -= dt;
    if (ped.reportState === "phone") {
      ped.state = "film"; ped.speed = 0;               // frozen, phone up (reuse film pose)
      // face roughly where the crime was (the player) for the tell to read
      const P = CBZ.player;
      if (P) ped.group.rotation.y = Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
      if (ped.reportT <= 0) { landReport(ped); return false; }
      return true;
    }
    if (ped.reportState === "run") {
      const cop = ped.reportTarget;
      if (!cop || cop.dead) {                           // cop gone — find another or give up
        const nc = nearestCop(ped.pos.x, ped.pos.z, 70);
        if (nc) { ped.reportTarget = nc; } else { cancelReport(ped); return false; }
      }
      const c = ped.reportTarget;
      ped.state = "walk";
      ped.target.set(c.pos.x, 0, c.pos.z);
      ped.speed = ped.baseSpeed * 2.0;
      const d = Math.hypot(c.pos.x - ped.pos.x, c.pos.z - ped.pos.z);
      if (d < 3.2 || ped.reportT <= 0) { landReport(ped); return false; }
      return true;
    }
    return false;
  }

  // ============================================================
  //  UNIVERSAL REACTIVITY — a believable, emergent reaction to the PLAYER, so the
  //  city isn't a ghost world of dumb walkers. Only fires for a calm-ish nearby
  //  ped that ISN'T already fleeing/fighting/guarding/reporting. Picks ONE intent
  //  from a personality+context spectrum and drives it into existing states:
  //    KILL (rage) · BEAT-DOWN (fists rage) · STEAL/pickpocket (sneak→lift cash) ·
  //    WORK-for-you (walk up + offer) · DEAL/trade · TALK/favor · FLEE · IGNORE.
  //  Behaviour-first + throttled (reactCD) so it's varied, never spam.
  // ============================================================
  function citySayBark(ped, txt, secs) {
    // a brief player-facing line; cheap, throttled by the caller via reactCD.
    if (CBZ.city && CBZ.city.note) CBZ.city.note("💬 " + ped.name + ": " + txt, secs || 1.6);
  }
  // a ped that reached the player lifts some cash (the NPC-initiated mirror of the
  // player's own pickpocket verb in interact.js). Light touch; turns you hot-ish.
  function pedSteal(ped) {
    const P = CBZ.player;
    const have = g.cash | 0;
    const take = Math.max(5, Math.min(have, 15 + ((rng() * 60) | 0)));
    if (take > 0 && CBZ.city) { CBZ.city.addCash(-take); ped.cash = (ped.cash || 0) + take; }
    ped.stoleT = 0;
    CBZ.city && CBZ.city.note("💸 " + ped.name + " lifted $" + take + " off you!", 1.8);
    if (CBZ.sfx) CBZ.sfx("coin");
    // now they BOLT with your money; chase them down to get it back
    ped.state = "flee"; fleeFrom(ped, P.pos.x, P.pos.z); ped.reactCD = 8;
    ped.snitch = Math.min(ped.snitch, 0.1);   // a thief won't also call the cops on you
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
      if (playerArmed && ped.approach !== "beat" && ped.aggr < (B.crook || 0.72)) {
        ped.approach = null; ped.reactCD = 6; ped.state = "flee"; fleeFrom(ped, P.pos.x, P.pos.z); return true;
      }
      ped.path = null; ped.pause = 0;
      ped.target.set(P.pos.x, 0, P.pos.z); ped.state = "walk";
      ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z), 0.4);
      ped._approachT -= 0.12;
      if (dpl < 2.2 || ped._approachT <= 0) {
        const intent = ped.approach; ped.approach = null; ped.speed = 0;
        ped.reactCD = 6 + rng() * 6;
        if (dpl >= 2.6) return true;          // never reached you — give up quietly
        if (intent === "steal") { pedSteal(ped); return true; }
        if (intent === "beat") { ped.rage = CBZ.city.playerActor; ped.state = "fight"; if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "assault"); return true; }
        if (intent === "work") {
          ped.wantsWork = 12;                 // interact.js can read this; bark either way
          citySayBark(ped, pick(["You hiring? I'll run with you.", "Put me on. I need the work.", "Let me earn with your crew."], rng()), 2.2);
          return true;
        }
        if (intent === "deal") {
          citySayBark(ped, pick(["Got that good-good if you're buying.", "You need anything? I got product.", "Best prices in the city, my friend."], rng()), 2.2);
          ped.offersDeal = 10; return true;
        }
        // talk / favor
        citySayBark(ped, pick(["You see what happened over there?", "Spare a few bucks?", "Watch yourself out here.", "You that one from the news?", "Crazy day, right?"], rng()), 2.0);
        return true;
      }
      return true;
    }

    // ---- pick a fresh intent (one shot, then a long cooldown) ----
    if (dpl > 13 || ped.reactCD > 0) return false;
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
      if (CBZ.citySay) CBZ.citySay(ped, pick(["“Not again—”", "“Keep walking. Keep walking.”", "“Not today. Not me.”"], rng()), "#cfd6e6", 2);
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
      ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z), 0.5);
      const title = CBZ.cityPlayerTitle ? CBZ.cityPlayerTitle() : "big man";
      const line = pick(["“Yo, " + title + "!”", "“Ayy — " + title + "! Good to see you.”", "“" + title + "! You good out here?”"], rng());
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
        citySayBark(ped, host === 2 ? pick(["Wrong block, opp!", "You're a dead man here.", "Light him up!"], rng())
                                    : pick(["You don't belong here.", "Off our turf.", "Bold move, comin' round here."], rng()), 1.6);
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
        ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z), 0.5);
        ped.pause = Math.max(ped.pause, 0.7 + rng() * 0.8); ped.speed = 0;
        citySayBark(ped, fam ? pick(["We move when you say, boss.", "Respect. You run this.", "Need anything, I'm on it."], rng())
                              : pick(["That's the one from the news right there.", "Big respect — heard about you.", "We good, we good. No problems here."], rng()), 1.8);
        return true;
      }
    }

    // KILL: an armed/violent ped that has a reason — provoked gang, you're a hot
    // armed threat in their space, or pure aggression — opens fire / charges.
    if (ped.aggr >= (B.violent || 0.88) && r < 0.5 && (prov > 0.3 || (hot && playerArmed) || ped.armed) && dpl < 11) {
      ped.rage = CBZ.city.playerActor; ped.state = "fight"; ped.reactCD = 10;
      if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.2);
      return true;
    }
    // BEAT-DOWN: a crook with no gun fancies their chances against an UNARMED player
    // (won't melee-charge a drawn gun). Walks up, then throws hands.
    if (ped.aggr >= (B.crook || 0.72) && !ped.armed && !playerArmed && r < 0.28 && dpl < 9 &&
        (!CBZ.citySizeUp || CBZ.citySizeUp(ped, CBZ.city.playerActor))) {
      ped.approach = "beat"; ped._approachT = 3.5; ped.reactCD = 8;
      citySayBark(ped, pick(["The hell you looking at?", "Wrong block, pal.", "You want some?"], rng()), 1.6);
      return true;
    }
    // STEAL / pickpocket: an opportunist (light-fingered, not a fighter) sneaks up to
    // a DISTRACTED player and lifts cash — more tempting if you're visibly loaded.
    const opportunist = ped.snitch < 0.35 && ped.aggr < (B.crook || 0.72) && ped.aggr >= (B.flee || 0.3);
    if (opportunist && !ped.armed && !hot && (g.cash | 0) > 40 && r < 0.10 + (g.cash > 1000 ? 0.08 : 0) && dpl < 8) {
      ped.approach = "steal"; ped._approachT = 4; ped.reactCD = 14;
      return true;
    }
    // WORK FOR YOU: a have-respect-for-you, broke, willing soul offers to run with
    // you (you've made a name / have a gang). Walks up and pitches.
    if (!ped.gang && !ped.recruited && respect >= 4 && ped.wealth < 0.45 && !hot && r < 0.06 && dpl < 9) {
      ped.approach = "work"; ped._approachT = 4; ped.reactCD = 25;
      return true;
    }
    // DEAL / trade: a dealer-ish ped sidles up to sell when you're not a threat.
    if ((ped.archetype === "dealer" || ped.drugUser) && !hot && r < 0.08 && dpl < 8) {
      ped.approach = "deal"; ped._approachT = 4; ped.reactCD = 18;
      return true;
    }
    // TALK / ask a favor: a friendly local just wants a word (most common, cheap).
    if (bnd !== "violent" && !playerArmed && r < 0.05 && dpl < 7) {
      ped.approach = "talk"; ped._approachT = 4; ped.reactCD = 16;
      return true;
    }
    return false;
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
    if (!ped.armed) {
      const di = nearestDrop(ped.pos.x, ped.pos.z, 22);
      if (di >= 0) {
        const d = CBZ.cityDrops[di];
        // close enough to scoop it up; else walk onto it (loot state carries the walk)
        if (Math.hypot(d.x - ped.pos.x, d.z - ped.pos.z) < 1.6) {
          ped.armed = true; ped.weapon = d.weapon; ped.ammo = d.ammo;
          if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); removeDrop(di);
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
      let tgt = nearestActor(ped, 60, (p) => !p.dead && !p.rampage && (p.kind === "cop" || (p.kind === "civilian" && !p.companion && !p.controlled)));
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
        if (CBZ.cityTagWitnesses) CBZ.cityTagWitnesses(ped.pos.x, ped.pos.z, 80, "active-shooter");
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
    att.group.rotation.y = Math.atan2(dx, dz);
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 12, "mugging");   // one offense (the caller no longer logs its own)
    if (CBZ.cityNpcGrudge) CBZ.cityNpcGrudge(victim, att);            // the mark may come back for the thief
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.citySay && rng() < 0.5) CBZ.citySay(att, "“Gimme that!”", "#ffce6b", 1.4);
    // the thief flees AWAY from the victim for a few seconds, then re-checks the
    // street — fleeFrom routes a clear path; a short timer keeps the run committed.
    att.state = "flee"; att._mugFleeT = 3 + rng() * 2;
    fleeFrom(att, victim.pos.x, victim.pos.z);
    return true;
  }

  // ---- the brain (time-sliced) ----
  function think(ped, dt, active) {
    if (ped.companion) { companionThink(ped, dt, active); return; }
    if (ped.dead || ped.vendor || ped.ko > 0) return;
    if (ped.controlled) return;     // city/social.js drives companions/hostages/kidnap victims
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

    // ---- IN-PROGRESS WITNESS REPORT: a committed snitch is busy dialing / running
    //      to a cop. The player can STOP it: get close with a gun out and a timid
    //      witness panics, drops the phone and bolts (report dies). Otherwise the
    //      report ticks toward landing. (tickReport returns true while still busy.)
    if (ped.reportState) {
      if (ped.reportState === "phone" && playerArmed && dpl < 6 && rng() < 0.5) {
        cancelReport(ped); ped.fear = 10; ped.alarmed = Math.max(ped.alarmed, 5);
        ped.state = "flee"; fleeFrom(ped, px, pz); return;       // scared off the call
      }
      if (tickReport(ped, dt)) return;
    }

    // ---- if currently raging at someone, keep engaging until they're gone ----
    if (ped.rage) {
      if (ped.rage.dead || (ped.rage.isPlayer && P.dead)) { ped.rage = null; }
      else {
        ped.state = "fight";
        ped.target.set(ped.rage.pos.x, 0, ped.rage.pos.z);
        // disengage if badly hurt and not truly violent
        if (ped.hp < ped.maxHp * 0.3 && ped.aggr < (B.violent || 0.88)) { ped.rage = null; ped.state = "flee"; fleeFrom(ped, ped.pos.x + ddx, ped.pos.z + ddz); }
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
      const crowd = CBZ.cityPeds;
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
        if (ped.fear >= 4) { ped.state = "flee"; fleeFrom(ped, gx, gz); return; }
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

    // ---- being threatened (player aiming / hot / a witnessed crime nearby) ----
    const threatened = ped.alarmed > 0 || (playerThreat && dpl < 14);
    if (threatened) {
      if (bnd === "meek" || bnd === "wary") {
        // origin of the threat: a remembered offender if we have one, else the player
        const thx = (ped.mem && ped.mem.pos) ? ped.mem.pos.x : px;
        const thz = (ped.mem && ped.mem.pos) ? ped.mem.pos.z : pz;
        const dThreat = Math.hypot(ped.pos.x - thx, ped.pos.z - thz);
        // a wary bystander films from a safe-ish distance; high fear always bolts.
        const wantFilm = bnd === "wary" && ped.fear < 7 && dThreat > 7 && rng() < 0.4;
        if (wantFilm) {
          ped.state = "film"; ped.speed = 0;
          ped.group.rotation.y = Math.atan2(thx - ped.pos.x, thz - ped.pos.z);   // hold the phone up at it
        } else {
          // FLEE — and if a wall/cover is right beside the threat, duck behind it
          ped.state = "flee";
          fleeFrom(ped, thx, thz);
        }
        // DECIDE whether to snitch — only if this ped actually WITNESSED a crime
        // (carries a witnessSev). They report once they've put some DISTANCE between
        // them and the danger (nobody calls 911 point-blank) OR while filming from
        // afar. The decision is scaled by neighborhood + snitch trait + nerve; a
        // ped that commits then PHONES or RUNS to a cop (see beginReport), and only
        // THEN does it land — the player can still stop it before it does.
        // …UNLESS this witness carries a real grudge against the player (the
        // street remembers): a vendetta witness needs no distance and no nerve
        // roll — seeing you commit a NEW crime IS their moment (beginReport then
        // marches them to a cop in person when one's within ~40u).
        const relW = ped.relPlayer;
        const vendetta = !!(relW && relW.grudge > 40 && ped.mem === CBZ.city.playerActor);
        if (!ped.reportState && ped.callT <= 0 && (ped.witnessSev || 0) > 0 &&
            ped.alarmed > 1.5 && (dThreat > 11 || ped.state === "film" || vendetta)) {
          const prop = snitchPropensity(ped, thx, thz);
          // a dedicated snitch reports fast even close; everyone else needs distance + nerve
          if (vendetta || rng() < Math.max(0, Math.min(0.95, prop))) {
            beginReport(ped, thx, thz);
          } else {
            ped.callT = 4 + rng() * 4;     // decided NOT to call (omerta / minding own business) — don't re-roll constantly
            // on gang turf, a hostile local might instead just flip you off and leave; nothing happens
          }
        }
        return;
      }
      // bold+ : confront / fight the threat (the player, or a remembered offender)
      const foe = (ped.mem && !ped.mem.dead && ped.mem.pos) ? ped.mem : (dpl < 14 ? CBZ.city.playerActor : null);
      if (foe && ped.aggr >= (B.bold || 0.5)) {
        if (ped.kind === "security") { ped.rage = foe; ped.state = "fight"; return; }
        if (ped.aggr >= (B.crook || 0.72)) { ped.rage = foe; ped.state = "fight"; return; }
        ped.state = "confront"; ped.target.set(foe.pos.x, 0, foe.pos.z); return;   // close in, threaten
      }
    }

    // ---- posted guards: gangs hold turf; private security protects businesses ----
    if (active && ped.guard) {
      const intruder = ped.gang ? turfIntruder(ped, px, pz, playerArmed)
        : ped.kind === "security" && CBZ.citySecurityIntruder ? CBZ.citySecurityIntruder(ped) : null;
      if (intruder) { ped.rage = intruder; ped.state = "fight"; return; }
      // Hold the turf/post: loiter near the guard point.
      const dg = Math.hypot(ped.pos.x - ped.guard.x, ped.pos.z - ped.guard.z);
      if (dg > 9 || ped.pause <= 0) {
        ped.target.set(ped.guard.x + (rng() - 0.5) * 7, 0, ped.guard.z + (rng() - 0.5) * 7);
        ped.pause = 1.5 + rng() * 3; ped.state = "walk"; ped.path = null;
      }
      // A violent gangster can still freelance crime when no intruder.
    }

    // ---- tweakers: cheap but visible behavioral variety ----
    // They keep the same combat and inventory rules as everyone else; this only
    // changes routine choices and movement rhythm.
    if (active && ped.drugUser && ped.erratic > 0 && ped.tweakT <= 0 && !ped.rage) {
      ped.tweakT = 3 + rng() * 7;
      const A = CBZ.city.arena;
      const trap = A && A.shopLots && A.shopLots.find((l) => l.kind === "drugs");
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
        if (roll < 0.10) { const cop = nearestActor(ped, 22, (p) => p.kind === "cop"); if (cop) { ped.rage = cop; ped.state = "fight"; return; } }
        if (roll < 0.16 && CBZ.cityNpcCarjack && !ped.inCar) { if (CBZ.cityNpcCarjack(ped)) return; }
      }
      // 3) crooks mug / brawl a nearby weaker civilian. A SNATCH-AND-RUN now moves
      //    real money: if already in arm's reach, npcMug() transfers the wallet and
      //    bolts the thief (a fleeing crook + a robbed, grudge-holding mark — the
      //    seed of a feud). Otherwise CLOSE on the mark (walk up to them); the next
      //    autonomy beat lands the grab once in range. The offense is logged ONCE,
      //    inside npcMug on success (no double-count from the old fight branch).
      if (roll < 0.14) {
        const victim = nearestActor(ped, 12, (p) => !p.vendor && p.kind === "civilian" && p.aggr < ped.aggr - 0.15);
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
      const cop = nearestActor(ped, 30, (p) => p.kind === "cop" && p.npcTarget === ped);
      if (cop) {
        if (ped.aggr >= (B.violent || 0.88)) { ped.rage = cop; ped.state = "fight"; return; }
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
        ped.group.rotation.y = Math.atan2(px - ped.pos.x, pz - ped.pos.z);
        return;
      }
      if (rng() < 0.35) {
        // just clock you and stare for a beat as you pass
        ped._notedT = 4 + rng() * 4;
        ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(px - ped.pos.x, pz - ped.pos.z), 0.5);
        ped.pause = Math.max(ped.pause, 0.6 + rng() * 0.8); ped.speed = 0;
      }
    }
    if (ped._notedT > 0) ped._notedT -= dt;

    // social: idle peds near each other pause to chat
    if (ped.chatT <= 0 && rng() < 0.04) {
      const mate = nearestActor(ped, 3.2, (p) => p.kind === "civilian" && !p.vendor && (p.state === "walk" || p.state === "idle"));
      if (mate) { ped.state = "chat"; ped.chatT = 2 + rng() * 3; ped.speed = 0; ped.group.rotation.y = Math.atan2(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z); return; }
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
  // 2 collide() calls, and only the near/active crowd runs it (see steering()).
  function probeBlocked(x, z, y) {
    tmp.set(x, y, z);
    if (CBZ.collide) { const bx = tmp.x, bz = tmp.z; CBZ.collide(tmp, PED_R, y, y + 1.7); if (Math.abs(tmp.x - bx) > 0.05 || Math.abs(tmp.z - bz) > 0.05) return true; }
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
      const door = lot && lot.building && lot.building.door;
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
    const offs = [0, 0.5, -0.5, 1.0, -1.0, 1.7, -1.7, 2.6];
    let bx = ped.pos.x + Math.sin(baseAng) * 22, bz = ped.pos.z + Math.cos(baseAng) * 22, found = false;
    for (let k = 0; k < offs.length; k++) {
      const a = baseAng + offs[k];
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

  // NEIGHBOUR GATHER for context steering (alloc-free): fill the shared flat
  // buffer [x0,z0,x1,z1,...] with nearby rigs' positions EXCLUDING self, return
  // the PAIR count. Same bounded near-scan the old separation used (skip dead /
  // in-car / parked / entering bodies), capped at NBR_CAP pairs so cost stays in
  // the same class — a slightly wider radius than pure separation since context
  // steering reasons about bodies a step or two ahead, not just touching. The
  // single shared buffer is safe because steering() is called once per ped
  // synchronously and cityNav.contextSteer consumes it within the same call.
  const NBR_CAP = 8, NBR_R2 = 3.5 * 3.5;
  function gatherNbrs(ped) {
    if (!_pedGrid) return 0;
    let n = 0;
    const gx = _pedGrid.cellIndex(ped.pos.x), gz = _pedGrid.cellIndex(ped.pos.z);
    for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
      const cell = _pedGrid.bucket(cx, cz); if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const o = cell[i];
        if (o === ped) continue;
        const ox = o.pos.x - ped.pos.x, oz = o.pos.z - ped.pos.z, od2 = ox * ox + oz * oz;
        if (od2 > NBR_R2 || od2 < 0.0004) continue;
        // Keep the closest N neighbours. This bounded insertion is allocation
        // free and avoids spawn order deciding who an agent can perceive.
        let at;
        if (n < NBR_CAP) { at = n; n++; }
        else {
          if (od2 >= _nbrD2[NBR_CAP - 1]) continue;
          at = NBR_CAP - 1;
        }
        while (at > 0 && _nbrD2[at - 1] > od2) {
          _nbrD2[at] = _nbrD2[at - 1]; _nbrX[at] = _nbrX[at - 1]; _nbrZ[at] = _nbrZ[at - 1];
          at--;
        }
        _nbrD2[at] = od2; _nbrX[at] = o.pos.x; _nbrZ[at] = o.pos.z;
      }
    }
    for (let i = 0; i < n; i++) { _nbrBuf[i * 2] = _nbrX[i]; _nbrBuf[i * 2 + 1] = _nbrZ[i]; }
    return n;
  }

  // ---- LOCAL STEERING: a short look-ahead probe + separation from neighbours,
  //      blended into the move vector so the crowd flows AROUND walls and each
  //      other instead of clumping/clipping (Reynolds steering, cheap version).
  //      Returns a small {x,z} steering offset to add to the desired heading. ----
  const _steer = { x: 0, z: 0, blocked: 0 };
  function steering(ped, dx, dz, dist, active) {
    _steer.x = 0; _steer.z = 0; _steer.blocked = 0;
    if (dist < 0.001) return _steer;
    const hx = dx / dist, hz = dz / dist;       // desired heading (unit)
    // CONTEXT STEERING (Builder B side of the citynav contract) — the NEAR/ACTIVE
    // tier only. cityNav.contextSteer reads CBZ.colliders for wall danger AND the
    // neighbour buffer we gather for crowd danger, fuses them with the interest in
    // our desired heading, and returns ONE chosen unit travel dir — replacing the
    // old look-ahead probe + Reynolds separation for these rigs. We express it back
    // as the SAME {x,z} offset move() already adds to the heading: move() computes
    //   mx = hx + s.x ; mz = hz + s.z ; then re-normalises
    // so setting s = (chosenDir - heading) makes the re-normalised vector point
    // EXACTLY at the chosen dir — move()'s path-follow + 3-pass collide stay
    // untouched. We still flag `blocked` (→ move() cuts the forward step) when the
    // chosen dir veers hard off the heading, i.e. it's threading past a wall, so
    // the existing anti-tunnel step-cut keeps working.
    if (active && CBZ.cityNav && CBZ.cityNav.contextSteer) {
      const nbrCount = gatherNbrs(ped);
      const out = CBZ.cityNav.contextSteer(
        ped.pos.x, ped.pos.z, hx, hz,
        _nbrBuf, nbrCount,
        ped._prevSteerX, ped._prevSteerZ, _ctxOut);
      if (out && (out.x || out.z)) {
        ped._prevSteerX = out.x; ped._prevSteerZ = out.z;   // hysteresis for next frame
        const dot = out.x * hx + out.z * hz;                // how far the dir was bent
        if (dot < 0.35) _steer.blocked = 1;                 // threading past an obstacle
        _steer.x = out.x - hx; _steer.z = out.z - hz;       // offset → move() lands on out
      }
      return _steer;
    }
    // 1) OBSTACLE LOOK-AHEAD: probe a point ahead; if blocked, veer to whichever
    //    side is open. The ACTIVE/near crowd probes every steering tick. EVERY OTHER
    //    MOVING ped that's heading toward a FAR goal also probes — but only on a
    //    cheap per-ped rate timer (_probeT) so a distant walker still steers around
    //    a building BEFORE grinding into it, without paying a couple of collide()
    //    probes every frame for all ~90 rigs. (Near a goal, dist is small and the
    //    body-collision pass alone is enough, so we skip the probe there.)
    let doProbe = active;
    if (!doProbe && dist > 3) {
      if ((ped._probeT || 0) <= 0) { ped._probeT = 0.25 + (ped.slice & 3) * 0.05; doProbe = true; }
    }
    if (doProbe) {
      const ahead = Math.min(2.6, 1.2 + (ped.speed || ped.baseSpeed) * 0.4);
      if (!dirClear(ped, hx, hz, ahead)) {
        _steer.blocked = 1;                              // straight ahead is a wall
        // pick the clearer side to slip past — probe a forward-diagonal each way,
        // normalized so the look-ahead distance stays consistent.
        const lx = hz, lz = -hx, rx = -hz, rz = hx;     // left / right perpendiculars
        let dlx = hx * 0.5 + lx, dlz = hz * 0.5 + lz; let n = Math.hypot(dlx, dlz) || 1; dlx /= n; dlz /= n;
        let drx = hx * 0.5 + rx, drz = hz * 0.5 + rz; n = Math.hypot(drx, drz) || 1; drx /= n; drz /= n;
        const leftOpen = dirClear(ped, dlx, dlz, ahead);
        const rightOpen = dirClear(ped, drx, drz, ahead);
        if (leftOpen && !rightOpen) { _steer.x += lx * 1.4; _steer.z += lz * 1.4; }
        else if (rightOpen && !leftOpen) { _steer.x += rx * 1.4; _steer.z += rz * 1.4; }
        else {
          // both (or neither) open — deterministic tie-break by id so it commits
          const sgn = ((ped.slice || 0) & 1) ? 1 : -1;
          _steer.x += hz * 1.0 * sgn; _steer.z += -hx * 1.0 * sgn;
        }
      }
    }
    // 2) SEPARATION: push away from nearby peds so they don't stack into one body.
    //    Cheap bounded scan, only run for the active crowd, time-thinned by frame.
    if (active && (ped._sepT || 0) <= 0) {
      ped._sepT = 0.12;
      const peds = CBZ.cityPeds, SEP = 1.5, SEP2 = SEP * SEP;
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < peds.length; i++) {
        const o = peds[i];
        if (o === ped || o.dead || o.inCar || o._parked || o.enterT > 0) continue;
        const ox = ped.pos.x - o.pos.x, oz = ped.pos.z - o.pos.z, od2 = ox * ox + oz * oz;
        if (od2 > SEP2 || od2 < 0.0004) continue;
        const od = Math.sqrt(od2), w = (SEP - od) / SEP;      // closer = stronger
        sx += (ox / od) * w; sz += (oz / od) * w; n++;
        if (n >= 4) break;                                    // bounded cost
      }
      if (n) { ped._sepX = sx; ped._sepZ = sz; } else { ped._sepX = 0; ped._sepZ = 0; }
    }
    if (ped._sepX || ped._sepZ) {
      // separation matters less when fighting (you want to close in) than fleeing
      const w = ped.state === "fight" ? 0.35 : ped.state === "flee" ? 1.1 : 0.8;
      _steer.x += ped._sepX * w; _steer.z += ped._sepZ * w;
    }
    return _steer;
  }

  // RALLY: a gangster who spots an intruder calls in nearby SAME-GANG members so
  // the whole block converges on the threat (GTA-style turf swarm). Bounded scan
  // (~25m, n-capped); only flips calm members so we never stomp a busy brain. The
  // response is louder when the gangs are at open war (more bodies, even the wary).
  function rallyGang(ped, intruder) {
    if (!intruder || intruder.dead) return;
    const peds = CBZ.cityPeds, R2 = 25 * 25;
    // is the intruder's gang at war with ours? → a bigger, angrier turnout
    const iGang = intruder.gang || (intruder.isPlayer ? playerGangId() : null);
    const war = !!(iGang && CBZ.cityAtWar && CBZ.cityAtWar(ped.gang, iGang));
    const cap = war ? 6 : 4;
    let called = 0;
    for (let i = 0; i < peds.length && called < cap; i++) {
      const o = peds[i];
      if (o === ped || o.dead || o.vendor || o.ko > 0 || o.controlled || o.companion) continue;
      if (o.gang !== ped.gang) continue;                          // only our own crew
      if (o.rage || o.state === "fight" || o.surrender) continue; // already busy
      // war pulls the wary too; a normal incursion only rouses the bold+
      if (o.aggr < (war ? (A0().bold || 0.5) : (A0().crook || 0.72))) continue;
      const dx = o.pos.x - ped.pos.x, dz = o.pos.z - ped.pos.z;
      if (dx * dx + dz * dz >= R2) continue;
      o.rage = intruder; o.state = "fight";
      o.alarmed = Math.max(o.alarmed, 6);
      o.target.set(intruder.pos.x, 0, intruder.pos.z);
      called++;
    }
  }

  // is there an intruder in this gangster's turf they should attack?
  function turfIntruder(ped, px, pz, playerArmed) {
    const G = ped.guard, R2 = 13 * 13;
    // the player, if hot/armed/provoked the gang, standing in turf
    const dP = (px - G.x) * (px - G.x) + (pz - G.z) * (pz - G.z);
    const prov = CBZ.cityGangProvoked ? CBZ.cityGangProvoked(ped.gang) : 0;
    if (!CBZ.player.dead && dP < R2 && (prov > 0.4 || (playerArmed && (CBZ.game.wanted | 0) >= 1))) {
      if ((ped._rallyT || 0) <= 0) { rallyGang(ped, CBZ.city.playerActor); ped._rallyT = 6; }
      return CBZ.city.playerActor;
    }
    // a rival gangster in turf
    const rival = nearestActor(ped, 12, (p) => p.gang && p.gang !== ped.gang);
    if (rival) {
      const dr = (rival.pos.x - G.x) * (rival.pos.x - G.x) + (rival.pos.z - G.z) * (rival.pos.z - G.z);
      if (dr < R2 * 1.6) {
        if ((ped._rallyT || 0) <= 0) { rallyGang(ped, rival); ped._rallyT = 6; }
        return rival;
      }
    }
    return null;
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
      if (dx * dx + dz * dz > 0.04) ped.group.rotation.y = Math.atan2(dx, dz);
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
  function gunpointSweep(dt) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving) { _clearGunpointPoses(); return; }
    const playerArmed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
    if (!playerArmed) { _clearGunpointPoses(); return; }
    const B = A0();
    const cy = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(cy), fz = -Math.cos(cy);
    const px = P.pos.x, pz = P.pos.z;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      if (!ped || ped.dead || ped.vendor || ped.ko > 0 || ped.controlled || ped.companion || ped._parked || ped.recruited) continue;
      const dx = ped.pos.x - px, dz = ped.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > 121) {                                  // out of 11m gunpoint range → relax
        if (ped._covered) { _relaxGunpoint(ped, dt); }
        continue;
      }
      const d = Math.sqrt(d2) || 1;
      const aimedAtMe = (dx / d) * fx + (dz / d) * fz > 0.66;   // ped inside the aim cone
      if (aimedAtMe) {
        ped._coverGrace = 0.6;                          // hold the pose for a beat after look-away
        ped._covered = true;
        // ANYONE holding a gun squares up and levels it BACK — a guy with a gun
        // never throws his hands up. A fearless unarmed bruiser also stands his
        // ground. Everyone else (unarmed, not fearless) throws their hands up.
        const drawsBack = ped.armed || ped.aggr >= (B.violent || 0.88);
        if (drawsBack) {
          if (ped.state !== "fight") { ped.poseAimBack = true; ped.poseHandsUp = false; }
        } else {
          // meek/scared: throw hands up + freeze. markGunpoint owns the full state.
          markGunpoint(ped, 0.4);
        }
      } else if (ped._covered) {
        _relaxGunpoint(ped, dt);
      }
    }
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
  function _clearGunpointPoses() {
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      if (ped && ped._covered) { ped._coverGrace = 0; _relaxGunpoint(ped, 999); }
    }
  }

  // ---- movement / engagement ----
  function move(ped, dt, animate) {
    // walked up to interact? they at least turn and LOOK at you (flag refreshed
    // by city/interact.js each frame the panel targets them). Calm people stop
    // and face you; someone fleeing / fighting / surrendering is too busy.
    if (ped._faceT > 0) {
      ped._faceT -= dt;
      const busy = ped.controlled || ped.state === "flee" || ped.state === "fight" || ped.state === "confront" || ped.state === "surrender";
      if (!busy) {
        const dx = CBZ.player.pos.x - ped.pos.x, dz = CBZ.player.pos.z - ped.pos.z;
        if (dx * dx + dz * dz > 0.05) ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0004, dt));
        ped.speed = 0; ped.pause = Math.max(ped.pause, 0.3);
        if (animate) animChar(ped.char, 0, dt);
        if (!ped.vendor) { if (CBZ.collide) CBZ.collide(ped.pos, PED_R, ped.pos.y, ped.pos.y + 1.7); ped.pos.y = 0; }
        return;
      }
    }
    if (ped.vendor) { if (animate) animChar(ped.char, 0, dt); return; }
    if (ped.inCar) { ped.speed = 0; return; }   // out on the road; vehicles.js drives it
    if (ped.callT > 0) ped.callT -= dt;
    if (ped.chatT > 0) { ped.chatT -= dt; ped.speed = 0; if (animate) animChar(ped.char, 0, dt); if (ped.chatT <= 0) ped.state = "walk"; return; }
    if (ped.attackCD > 0) ped.attackCD -= dt;
    if (ped.shootCD > 0) ped.shootCD -= dt;
    if (ped.surrenderT > 0) {
      ped.surrenderT = Math.max(0, ped.surrenderT - dt);
      ped.surrender = true;
    }

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

    // engagement: attack when in range
    if (st === "fight" && ped.rage && !ped.rage.dead) {
      const d = Math.hypot(ped.rage.pos.x - ped.pos.x, ped.rage.pos.z - ped.pos.z);
      const want = ped.armed ? 9 : 1.7;
      if (d <= want + 0.4) { spd = 0; npcAttack(ped, ped.rage); }
    }

    // loot pickup
    if (st === "loot") {
      const di = nearestDrop(ped.pos.x, ped.pos.z, 1.6);
      if (di >= 0) { const d = CBZ.cityDrops[di]; ped.armed = true; ped.weapon = d.weapon; ped.ammo = d.ammo; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); removeDrop(di); ped.state = "walk"; }
    }

    if (ped._sepT > 0) ped._sepT -= dt;
    if (ped._screamT > 0) ped._screamT -= dt;
    if (ped.posePoint > 0) ped.posePoint -= dt;   // the snitch point-out gesture window
    if (ped._probeT > 0) ped._probeT -= dt;   // far-walker wall-probe rate gate
    if (ped._rampT > 0) ped._rampT -= dt;      // rampager re-target / re-arm cadence
    const dx = ped.target.x - ped.pos.x, dz = ped.target.z - ped.pos.z, dist = Math.hypot(dx, dz);
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
        ped.pos.x = anc.x; ped.pos.z = anc.z; ped.pos.y = 0;          // snap onto the seat
        ped.group.position.set(anc.x, 0, anc.z);
        if (anc.face != null) ped.group.rotation.y = anc.face;         // face the desk
        ped._deskAnchor = { x: anc.x, y: anc.y || 0, z: anc.z, face: anc.face, lot: anc.lot };
        ped.path = null; ped.speed = 0; ped.pause = 0;
        ped.state = "sit";
        if (ped.char) ped.char.sitting = true;
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
      if (a) { ped.pos.x = a.x; ped.pos.z = a.z; ped.group.position.set(a.x, 0, a.z); if (a.face != null) ped.group.rotation.y = a.face; }
      ped.pos.y = 0; ped.speed = 0;
      if (ped.char) ped.char.sitting = true;
      if (animate) animChar(ped.char, 0, dt);
      return;
    }
    const _px0 = ped.pos.x, _pz0 = ped.pos.z, _trying = spd > 0 && dist > 0.5;
    if (spd > 0 && dist > 0.5) {
      // blend the desired heading with local steering (look-ahead + separation)
      // so the crowd flows around walls and each other (no clumping/clipping).
      let mx = dx / dist, mz = dz / dist;
      const s = steering(ped, dx, dz, dist, animate || dist > 3);
      if (s.x || s.z) { mx += s.x; mz += s.z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml; }
      // ANTI-TUNNEL: when the path straight ahead is a wall, the steer above turns
      // us toward the open side — but a fast step can still carry the body INTO the
      // corner before the turn finishes. Cut the forward step hard this frame so we
      // ease around the obstacle instead of punching through it (the multi-pass
      // collide below catches whatever overlap remains). Only bites when blocked.
      const stepMul = s.blocked ? 0.25 : 1;
      // a wounded/limping leg actually slows the body (animChar publishes the
      // multiplier off the leg-injury state; a severed leg → 0 = can't walk)
      const limpMul = ped.char && ped.char.limpSpeedMul != null ? ped.char.limpSpeedMul : 1;
      ped.pos.x += mx * spd * dt * stepMul * limpMul;
      ped.pos.z += mz * spd * dt * stepMul * limpMul;
      ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(mx, mz), 1 - Math.pow(0.0009, dt));
      ped.speed = spd;
    } else {
      ped.speed = 0;
      // advance along a routine path / arrive
      if (dist <= 0.6 && ped.path && ped.path.length) {
        ped.path.shift();
        if (ped.path.length) ped.target.set(ped.path[0].x, 0, ped.path[0].z);
        else {
          ped.path = null;
          if (ped.finalGoal && ped.finalGoal.enter && rng() < 0.5) { ped.enterT = 3 + rng() * 5; }
          ped.pause = Math.max(ped.pause, 0.4 + rng() * 1.5);
        }
      } else if (st === "wander" || st === "walk") ped.pause = Math.max(ped.pause, 0.4);
    }

    // "entered" a building: hide briefly then re-emerge (cheap life)
    if (ped.enterT > 0) { ped.enterT -= dt; ped.group.visible = false; ped.speed = 0; if (ped.enterT <= 0) ped.group.visible = true; return; }

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
        CBZ.collide(ped.pos, PED_R, ped.pos.y, ped.pos.y + 1.7);
        if (CBZ.city && CBZ.city.arena) CBZ.city.arena.clampToCity(ped.pos, PED_R);
        // converged: the last pass didn't push us anywhere → no overlap left
        if (Math.abs(ped.pos.x - bx) < 0.002 && Math.abs(ped.pos.z - bz) < 0.002) break;
      }
    } else if (CBZ.city && CBZ.city.arena) {
      CBZ.city.arena.clampToCity(ped.pos, PED_R);
    }
    ped.pos.y = 0;
    // STUCK DETECTION: a ped that tried to move but got shoved back by a wall is
    // grinding into it — reroute instead of standing there forever (smarter AI).
    if (_trying) {
      const moved = Math.hypot(ped.pos.x - _px0, ped.pos.z - _pz0);
      if (moved < spd * dt * 0.4) {
        ped._stuck = (ped._stuck || 0) + dt;
        if (ped._stuck > 0.45) {
          ped._stuck = 0;
          if (ped.state === "fight" || ped.state === "flee") {
            // wall in the way of a chase/flee — sidestep to slip around it
            const a = ped.group.rotation.y + (rng() < 0.5 ? 1.5 : -1.5);
            ped.target.set(ped.pos.x + Math.sin(a) * 6, 0, ped.pos.z + Math.cos(a) * 6);
          } else { ped.path = null; pickRoutineGoal(ped); }   // abandon the blocked goal, pick a reachable one
        }
      } else if (ped._stuck) ped._stuck = 0;
    }
    if (animate) animChar(ped.char, ped.speed, dt);
  }

  // ---- per-frame update ----
  CBZ.onUpdate(34, function (dt) {
    if (g.mode !== "city") return;
    frame++;
    // advance the cheap internal day clock (loops 0..24); drives loose schedules
    _dayClock = (_dayClock + (dt * 24 / DAY_LEN)) % 24;
    // GUNPOINT: raise hands across the near crowd the moment you aim a gun at them
    // (every frame, so it's instant + covers everyone, not just one per think pass).
    gunpointSweep(dt);
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    const peds = CBZ.cityPeds;
    rebuildPedGrid();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p._parked) continue;     // pooled crowd-promotion ped waiting off-map; not in play
      if (p.alarmed > 0) p.alarmed -= dt;
      if (p._rallyT > 0) p._rallyT -= dt;       // turf-rally re-call cooldown
      if (p._refugeT > 0) p._refugeT -= dt;     // flee-toward-refuge recompute gate
      if (p._microT > 0) p._microT -= dt;       // archetype micro-behaviour gate
      if (p._groupT > 0) p._groupT -= dt;       // group/mob reaction recheck gate
      if (p._gangFearT > 0) p._gangFearT -= dt; // civilian gang-fear scan rate gate
      if (p.poseCower > 0) p.poseCower -= dt;   // brief flinch/cringe at gunfire+blasts
      if (p._scareT > 0) p._scareT -= dt;       // hobo-jumpscare lunge marker (transient)
      if (p.tweakT > 0) p.tweakT -= dt;
      if (p.npcHeat > 0) { p.npcHeat = Math.max(0, p.npcHeat - dt * 4); }
      if (p.offenseT > 0) p.offenseT -= dt;
      if (p.ko > 0 && !p.dead) p.ko -= dt;
      if (p.dead) {
        if (p.tag) p.tag.visible = false;
        p.deadT += dt;
        // bodies STAY on the ground (loot them as long as they're there). After a
        // short response delay they flag for pickup; city/medics.js dispatches a
        // paramedic who walks over and carries them off (sets p.collected). A long
        // fallback prevents a leak if no medic ever reaches it.
        if (p.deadT > 4) p.needsPickup = true;
        if ((p.collected || p.deadT > 75) && !p.culled) { p.culled = true; if (p.group.parent) p.group.parent.remove(p.group); }
        continue;
      }
      if (p.inCar) continue;     // vehicles.js owns it while it drives
      const dx = p.pos.x - camx, dz = p.pos.z - camz, d2 = dx * dx + dz * dz;
      if (p.tag) p.tag.visible = d2 < TAG_D2;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(p)) continue;
      if (p.ko > 0) { p.speed = 0; if (d2 < ANIM_D2) animChar(p.char, 0, dt); continue; }
      const near = d2 < ANIM_D2;
      const important = p.rage || p.guard || p.controlled || (p.npcWanted | 0) >= 1 || p.armed || p.reportState || p.approach;
      const active = near || important;
      // render LOD: peds far from the camera stop drawing entirely (the single
      // biggest GPU saving with ~90 rigs). enterT owns visibility while inside.
      const vis = active || d2 < VIS_D2;
      if (p.enterT <= 0) p.group.visible = vis;
      // far rigs stop casting shadows (their shadow is sub-pixel anyway); flip
      // only on a threshold crossing so the per-frame cost is a single compare.
      // blob shadows (city/blobshadows.js) ground rigs now — rigs never enter
      // the sun shadow pass at all (the pass was the draw-call bottleneck).
      const wantShadow = false;
      if (p._shadowOn !== wantShadow) { setRigShadow(p.char, wantShadow); p._shadowOn = wantShadow; }
      const far = d2 > FAR_D2;
      const stride = active ? 4 : (far ? 20 : 10);
      if ((frame + p.slice) % stride === 0) {
        think(p, dt * stride, active);
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
      move(p, dt, near || important || visAnim);
    }

    // age out / pick up dropped weapons (player auto-grabs by walking over)
    for (let i = CBZ.cityDrops.length - 1; i >= 0; i--) {
      const d = CBZ.cityDrops[i]; d.t += dt;
      const P = CBZ.player;
      if (!P.dead && !P.driving && Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(d.weapon);
        if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(d.ammo);
        CBZ.city && CBZ.city.note("Picked up " + d.weapon, 1.4);
        removeDrop(i); continue;
      }
      if (d.t > 30) removeDrop(i);
    }
  });
})();
