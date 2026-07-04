/* ============================================================
   city/housing.js — THE HOUSING MARKET (the WHY behind every job).

   The whole living-city loop hangs off one fact: RENT IS DUE. A ped
   holds a corner, drives a cab, mans a counter or deals on the stoop
   because at the end of the day a landlord wants paid. This module is
   that landlord side: it leases EVERY resident a real address — a unit
   on a real floor of a real building — so "going home" routes to one
   stable door (aigoals.js / schedule.js read ped._digs) and "owing
   rent" is a number economy.js can actually drain (H4).

   The trick that keeps a thousand-person city cheap: cheap, shitty
   MICRO-flats. buildings.js already BUILT every storey (the apartment
   dresser ran on each floor; the interiormap backdrop quads already
   sell "someone lives here" from the street). We add NO geometry — we
   only mint DATA records that MAP a tenant onto a floor that already
   exists, so a colossal city costs a flat array, not a mesh per soul.

   CONTRACT (consumers in peds.js + aigoals.js already call these):
     • CBZ.cityAssignHome(ped) -> home LOT (leases a unit, stamps
       ped._unit + ped._digs). Stable for the ped's life.
     • CBZ.cityHomeOf(ped)     -> the same (read-or-assign).
     • CBZ.cityHomeRelease(ped)-> frees the lease on recycle/despawn.
     • CBZ.cityFloorUnits(lot) -> the rentable units on one lot (a
       buildings.js-side name in the global contract; we PROVIDE it here
       if buildings.js didn't, deriving from lot.building.floorTops).
     • CBZ.cityHousing.units() -> the flat unit array (economy.js sums
       rent off it); cityHousing.markOccupancy() (H6, night light read);
       CBZ.cityHousingReset() (drop the cache on a fresh run).

   Each unit: { id, lot, building, floorY, door, tier, capacity, rent,
   occupants }. floorY is the unit's real slab height (ped._unit.floorY
   feeds sleep / elevator arrival in peds.js + aigoals.js). The TOP floor
   (home.floorY, the player-buyable penthouse tier) is NEVER rented out.

   W8 — HOUSEHOLDS: occupants[] replaces the old single `occupant` (kept as
   the noun everyone still says — occupants[0] is the PRIMARY, the one who
   actually holds the lease and pays the rent; economy.js's rent tick reads
   only occupants[0], so a spouse/kid moving in never doubles the bill).
   Per-tier capacity (capacityFor) caps how many can share one unit — a
   MICRO floor stays single, but a unit derived off a real tier-2+ home
   (family.js's mansion lots) can hold a whole household. CBZ.cityHouseholdJoin
   is the move-in primitive: it seats `ped` alongside `partnerPed`'s own
   lease when there's room, and stamps `ped._household`/`partnerPed._household`
   with the shared unit id so consumers (schedule.js's ledger) can tell
   they're the same address without walking the unit graph.

   COST/LOD: lazy single build, re-derived only when buildCity() swaps in
   a fresh homeLots array (cache keyed to that array's identity, so no
   reset call is required — but cityHousingReset() exists for mode.js).
   Headless-safe: every THREE/rig touch is guarded; the data layer runs
   with no renderer at all.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE || CBZ.THREE;   // optional — only the light toggle uses it

  // ---- self-defaulted flag (do NOT edit config.js; default at the top of
  // our own module per ownership rules). HOUSING on by default — it's the
  // backbone of the rent-due economy; flip false to fall back to aigoals'
  // own digsLot picker (which self-heals when this layer is absent).
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_HOUSING == null) CBZ.CONFIG.CITY_HOUSING = true;
  const ENABLED = function () { return !(CBZ.CONFIG && CBZ.CONFIG.CITY_HOUSING === false); };

  // ---- seeded RNG (schedule.js idiom: a tiny mulberry32 so unit pricing /
  // assignment jitter is deterministic per run, never Math.random in a hot
  // path). Re-seeded each rebuild off the lot count so a fresh city reshuffles.
  function makeRng(seed) {
    let a = (seed | 0) || 0x9e3779b9;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = makeRng(1);

  // ---- the cheap MICRO base rent. CITY.homes[0] is the "room" tier
  // (≈$30) — a bed and a door that locks — exactly the floor everyone can
  // afford. We read it live so a config tweak flows through; fall back to 30.
  function baseMicroRent() {
    const homes = CBZ.CITY && CBZ.CITY.homes;
    const room = homes && homes[0];
    return (room && room.rent) ? room.rent : 30;
  }

  // ---- district wealth → rent multiplier. Projects rent dirt-cheap so the
  // broke crowd has a roof; the core/luxury costs more (still cheap in
  // absolute terms — these are MICRO units, not the listed tiers). Reads the
  // lot's stamped district object (world.js puts {kind, wealth} on every lot).
  function districtMult(lot) {
    const d = lot && lot.district;
    const kind = d && d.kind;
    // explicit kind bands (matches the spec: projects×0.6, core×1.6) …
    if (kind === "projects") return 0.6;
    if (kind === "industrial") return 0.75;
    if (kind === "core") return 1.6;
    if (kind === "commercial") return 1.15;
    if (kind === "residential") return 1.0;
    // … else lean on the wealth scalar (0 poor .. 1 rich) so any custom
    // district still prices sanely without a hand-coded band.
    const w = (d && typeof d.wealth === "number") ? d.wealth : 0.45;
    return 0.55 + w * 1.1;          // wealth 0→0.55× , 1→1.65×
  }

  // ---- the cache. units[] is the flat array economy.js sums; byDistrict
  // buckets by district kind for a cheap affordability lookup; _src is the
  // homeLots array identity we built from (rebuild when it changes); freeBuckets
  // are sorted-cheapest pools we draw leases from.
  let cache = null;          // { units, byDistrict, byLot, _src, free }
  let _occClock = 0;         // night-light throttle accumulator

  // PER-FLOOR UNIT COUNT: a fat plate splits into two micro-flats, a skinny
  // one stays single — the spec's UNITS_PER_FLOOR. Footprint from the building.
  function unitsPerFloor(b) {
    const area = (b && b.w && b.d) ? (b.w * b.d) : 0;
    return area >= 380 ? 2 : 1;
  }

  // W8: PER-TIER CAPACITY — how many occupants ONE unit can seat. A plain
  // MICRO flat (tier 0/1) is one body, full stop; a unit derived off a real
  // tier-2 home fits a small family (3); tier-3+ (mansions) fit a whole
  // household (4). This is what lets cityHouseholdJoin actually seat a
  // spouse + kids together instead of everyone holding a separate lease.
  function capacityFor(tier) { return tier >= 3 ? 4 : tier === 2 ? 3 : 1; }

  // Build the rentable units for ONE lot from its real per-floor heights,
  // SKIPPING the top home floor (player-buyable). Returns [] for anything
  // without a home record (offices have none → naturally excluded).
  // Prefers a buildings.js-provided CBZ.cityFloorUnits if THAT module shipped
  // one richer than ours; otherwise derives here (and we publish the name).
  function deriveUnitsForLot(lot) {
    const b = lot && lot.building;
    const home = b && b.home;
    if (!b || !home) return [];                 // no residence → no units
    // floorTops: per-storey arrival Y, [0]=ground .. [storeys]=roof (real slab
    // math from makeBuilding). Fall back to a synthetic ladder if absent.
    let tops = b.floorTops;
    const storeys = b.storeys || (tops ? tops.length - 1 : 1);
    const FH = b.FH || 3.4;
    if (!tops || !tops.length) {
      tops = [0.14];
      for (let L = 1; L <= storeys; L++) tops.push(L * FH);
    }
    const door = home.door || b.door || null;
    const topFloorY = home.floorY;              // the penthouse tier — never rented
    const base = baseMicroRent();
    const dm = districtMult(lot);
    const per = unitsPerFloor(b);
    // W8: the non-top floors of a WEALTHY address (home.tier 2+, family.js's
    // mansion candidates) still rent MICRO-cheap, but they're sized like the
    // rest of the building — capped at 3 so we never mint a tier the capacity
    // table doesn't define. Ordinary tier 0/1 addresses stay single-occupant
    // MICRO flats exactly as before.
    const unitTier = Math.min(3, (home.tier | 0) || 0);
    const cap = capacityFor(unitTier);
    const out = [];
    // every storey index k in [0, storeys-1] EXCEPT the one matching the top
    // home floor. We compare against the actual floorTops Y so we skip exactly
    // the player-buyable slab even when floorTops indexing differs.
    for (let k = 0; k < storeys; k++) {
      const fy = tops[k];
      if (fy == null) continue;
      // skip the top home floor (the listed tier lives there); compare by Y so
      // a flagship penthouse on the very top slab is excluded precisely.
      if (topFloorY != null && Math.abs(fy - topFloorY) < 0.05) continue;
      // higher floors read as marginally nicer → a small upward bonus. Ground
      // (k=0) is cheapest; each storey adds a few percent. Keeps it MICRO.
      const floorBonus = 1 + Math.min(0.5, k * 0.04);
      for (let u = 0; u < per; u++) {
        const rent = Math.max(8, Math.round(base * dm * floorBonus + u * 4));
        out.push({
          id: lot.i + "_" + lot.j + "_f" + k + "_u" + u,
          lot, building: b,
          floorY: fy,
          door,
          tier: unitTier,           // MICRO by default; a wealthy lot's floors size up
          capacity: cap,
          rent,
          occupants: [],            // [0] = primary leaseholder (the one who pays rent)
        });
      }
    }
    return out;
  }

  // BUILD (lazy): scan CBZ.city.homeLots, mint units, bucket by district +
  // by lot, and pre-sort a cheap-first free pool. Defensively capped so a giant
  // city can't mint tens of thousands of records (cap = ped budget × 1.5).
  function build() {
    const city = CBZ.city;
    // W8 FIX: the lot list actually lives on CBZ.city.arena.homeLots (buildings.js
    // stamps it there — see realestate.js's CBZ.city.arena.homeLots read, and the
    // same city.homeLots-then-arena-fallback idiom gigs.js already uses). Reading
    // only city.homeLots (as before) meant this cache NEVER found any lots — the
    // whole leasing engine (leaseFor/homeOf/the rent tick) was silently a no-op.
    // Keep the direct field as the first choice (forward-compatible if it's ever
    // mirrored there) and fall back to the real arena-held array.
    const homeLots = city && (city.homeLots || (city.arena && city.arena.homeLots));
    const units = [];
    const byDistrict = Object.create(null);
    const byLot = new Map();
    if (homeLots && homeLots.length) {
      // ped budget → unit cap. Read the live cap if peds.js exposed one; else a
      // generous default. ×1.5 headroom so leasing never starves.
      const pedBudget =
        (CBZ.cityPeds && CBZ.cityPeds.length ? Math.max(CBZ.cityPeds.length, 200) : 0) ||
        (CBZ.CITY && (CBZ.CITY.maxPeds || CBZ.CITY.peds)) || 1200;
      const cap = Math.max(600, (pedBudget * 1.5) | 0);
      rng = makeRng((homeLots.length * 2654435761) >>> 0);
      for (let i = 0; i < homeLots.length; i++) {
        const lot = homeLots[i];
        if (!lot || !lot.building || !lot.building.home) continue;
        if (lot.kind === "office") continue;     // belt-and-braces (offices carry no home)
        const lus = deriveUnitsForLot(lot);
        if (!lus.length) continue;
        byLot.set(lot, lus);
        for (let u = 0; u < lus.length; u++) {
          const unit = lus[u];
          units.push(unit);
          const dk = (lot.district && lot.district.kind) || "residential";
          (byDistrict[dk] || (byDistrict[dk] = [])).push(unit);
        }
        if (units.length > cap) break;            // defensive cap — stop minting
      }
    }
    // a single cheap-first free pool (ascending rent) for fast affordability
    // leasing. We splice from the front as units fill; cheapest roof goes first.
    const free = units.slice().sort(function (a, b) { return a.rent - b.rent; });
    cache = { units, byDistrict, byLot, free, _src: homeLots };
    return cache;
  }

  // ensure the cache is live + matches the CURRENT city. Rebuilds when the
  // homeLots array identity changes (a fresh buildCity() swaps it), so NO
  // reset call is strictly required — the cache self-heals on a new run.
  function ensure() {
    const city = CBZ.city;
    // same arena-fallback as build() (see the W8 FIX note there) — must match
    // exactly so the _src identity check below actually catches a fresh city.
    const homeLots = city && (city.homeLots || (city.arena && city.arena.homeLots));
    if (!cache || cache._src !== homeLots) build();
    return cache;
  }

  // ---- AFFORDABILITY: a ped's rent budget (mirrors aigoals' rentBudget so
  // the two layers agree on who can afford what). Wealth 0→$8, 1→$52.
  function rentBudget(ped) { return 8 + ((ped && ped.wealth) || 0.4) * 44; }

  // LEASE the best-fit FREE unit for a ped: the cheapest unit within budget
  // (so the poor get the dirt-cheap projects micro-flats), biased toward the
  // ped's current position so "home" is a believable commute, with a tiny
  // jitter so the crowd spreads across doors instead of stacking one address.
  // Falls back to the cheapest free unit anywhere (everyone gets a roof), then
  // to ANY unit (re-leasing an occupied one as a last resort so it never fails).
  function leaseFor(ped) {
    const c = ensure();
    if (!c || !c.units.length) return null;
    const budget = rentBudget(ped);
    const px = (ped && ped.pos && ped.pos.x) || (ped && ped._jobLot && ped._jobLot.cx) || 0;
    const pz = (ped && ped.pos && ped.pos.z) || (ped && ped._jobLot && ped._jobLot.cz) || 0;
    const free = c.free;
    // scan the cheapest slice of the free pool (it's rent-sorted) and pick the
    // best score = affordability fit + proximity. Bounded scan keeps it cheap.
    let best = null, bestI = -1, bestScore = -Infinity;
    let cheapest = null, cheapestI = -1;
    const SCAN = Math.min(free.length, 64);     // only the cheapest 64 vacancies
    for (let i = 0; i < SCAN; i++) {
      const u = free[i];
      if (!u || u.occupants.length) continue;     // (compacted lazily below)
      if (cheapest == null) { cheapest = u; cheapestI = i; }
      const within = u.rent <= budget;
      const afford = within ? (1 - (u.rent / Math.max(1, budget)) * 0.35) : Math.max(0, 0.5 - (u.rent - budget) / Math.max(1, budget));
      const lx = (u.lot && u.lot.cx) || 0, lz = (u.lot && u.lot.cz) || 0;
      const dx = lx - px, dz = lz - pz, dd = dx * dx + dz * dz;
      const commute = 1 / (1 + dd / (260 * 260));
      const s = afford * 1.6 + commute + rng() * 0.15;
      if (s > bestScore) { bestScore = s; best = u; bestI = i; }
    }
    let pick = best || cheapest;
    let pickI = best ? bestI : cheapestI;
    if (!pick) {
      // free pool exhausted in the scan window → take any still-free unit, then
      // (true worst case) re-lease the least-occupied; never returns null so a
      // ped always has an address.
      for (let i = 0; i < c.units.length; i++) { if (!c.units[i].occupants.length) { pick = c.units[i]; break; } }
      pick = pick || c.units[(rng() * c.units.length) | 0];
      pickI = -1;
    }
    // remove from the free pool so the next lease doesn't re-pick it.
    if (pickI >= 0) free.splice(pickI, 1);
    else { const fi = free.indexOf(pick); if (fi >= 0) free.splice(fi, 1); }
    return pick;
  }

  // stamp a lease onto a ped: claim the unit, set the persistent anchors the
  // consumers read (ped._unit + ped._digs), and bump the building's _tenants
  // tally (additive — never touches home.owned/listed). Returns the home LOT.
  function claim(ped, unit) {
    if (!ped || !unit) return null;
    // release any prior lease first (re-home cleanly) — just pull THIS ped out
    // of the old unit's occupants[]; any household-mates left behind keep
    // their own lease going.
    if (ped._unit && ped._unit !== unit) {
      const oi = ped._unit.occupants ? ped._unit.occupants.indexOf(ped) : -1;
      if (oi >= 0) ped._unit.occupants.splice(oi, 1);
    }
    if (!unit.occupants) unit.occupants = [];
    // claim() is the SOLO-lease path (leaseFor / homeOf) — the claimant leads
    // this unit's household (occupants[0], the rent payer). cityHouseholdJoin
    // is the one that seats someone ALONGSIDE an existing leaseholder.
    if (unit.occupants.indexOf(ped) < 0) unit.occupants.unshift(ped);
    ped._unit = unit;
    ped._digs = unit.lot;
    if (unit.floorY != null) ped._homeFloorY = unit.floorY;
    const hm = unit.lot && unit.lot.building && unit.lot.building.home;
    if (hm) hm._tenants = (hm._tenants | 0) + 1;
    return unit.lot;
  }

  // ---- THE PUBLIC HOME API (the names peds.js + aigoals.js already call) ----

  // read-or-assign: the ped's stable home LOT. If a live lease exists, return
  // its lot; else lease one. Never throws, never returns null when ANY home
  // lot exists (the affordability fallback guarantees a roof).
  function homeOf(ped) {
    if (!ENABLED()) return null;
    const c = ensure();
    if (!c) return null;
    // still-live lease wins (the persistent bond — same door every day). Any
    // seat in the unit counts (primary lessee OR a household-mate seated via
    // cityHouseholdJoin) — both read the same door/floor.
    if (ped && ped._unit && ped._unit.occupants && ped._unit.occupants.indexOf(ped) >= 0 &&
        ped._unit.lot && c.byLot.has(ped._unit.lot)) {
      ped._digs = ped._unit.lot;
      if (ped._unit.floorY != null) ped._homeFloorY = ped._unit.floorY;
      return ped._unit.lot;
    }
    // a cached _digs that's still a real home lot (e.g. set by aigoals' own
    // fallback before we loaded, or a household-bridge hint — see family.js)
    // → adopt it, leasing a unit on it if we can so floorY/occupancy line up.
    if (ped && ped._digs && c.byLot.has(ped._digs)) {
      const lus = c.byLot.get(ped._digs);
      let u = null;
      for (let i = 0; i < lus.length; i++) { if (!lus[i].occupants.length) { u = lus[i]; break; } }
      if (u) { claim(ped, u); return ped._digs; }
      return ped._digs;                          // lot full but still theirs
    }
    const unit = leaseFor(ped);
    return claim(ped, unit);
  }

  // explicit assign (same engine; the name the global contract advertises).
  function assignHome(ped) { return homeOf(ped); }

  // release a lease on recycle/despawn so the unit frees up + the tenant tally
  // drops. peds.js calls this on rig recycle; aigoals.js clears _unit/_digs on
  // despawn (we tolerate both). Returns the freed unit (or null).
  function release(ped) {
    if (!ped) return null;
    const u = ped._unit;
    if (u) {
      const oi = u.occupants ? u.occupants.indexOf(ped) : -1;
      if (oi >= 0) u.occupants.splice(oi, 1);
      const hm = u.lot && u.lot.building && u.lot.building.home;
      if (hm && hm._tenants) hm._tenants = Math.max(0, hm._tenants - 1);
      // W8: only return the unit to the free pool once EVERY seat is empty —
      // a household-mate moving out (or dying) must not evict the family
      // still living there.
      if (!u.occupants.length && cache && cache.free && cache.free.indexOf(u) < 0) {
        // insert keeping the ascending-rent order cheap (binary-ish: just push;
        // the next big rebuild re-sorts, and a single push is O(1) — leasing
        // scans the cheapest window which a fresh vacancy may legitimately miss
        // for one cycle, acceptable for a recycle event).
        cache.free.push(u);
      }
    }
    ped._unit = null;
    ped._household = null;
    return u || null;
  }

  // ---- W8: HOUSEHOLD JOIN (families actually live together) -----------------
  // Seat `ped` alongside `partnerPed`'s own lease, sharing ONE unit instead of
  // two separate addresses. Ensures the partner actually holds a lease first
  // (read-or-assign, the same homeOf() everyone else goes through — so a
  // couple always shares a REAL unit, not a null), then adds `ped` if there's
  // free capacity (capacityFor — a plain MICRO flat has none to spare, a
  // wealthier unit does). `ped` keeps NO separate lease of its own once
  // seated (rent is billed once, to occupants[0], in economy.js — see H4).
  // Both sides get ped._household = unit.id stamped so schedule.js's ledger
  // (and anything else) can recognise "same address" cheaply, without
  // walking the unit graph. Returns true on a successful move-in.
  function householdJoin(ped, partnerPed) {
    if (!ENABLED() || !ped || !partnerPed || ped === partnerPed || ped.dead || partnerPed.dead) return false;
    if (!ensure()) return false;
    homeOf(partnerPed);                          // the partner MUST hold a real lease first
    const unit = partnerPed._unit;
    if (!unit) return false;
    if (!unit.occupants) unit.occupants = [];
    if (unit.occupants.indexOf(ped) < 0) {
      const cap = unit.capacity != null ? unit.capacity : capacityFor(unit.tier || 0);
      if (unit.occupants.length >= cap) return false;   // unit's full — they keep their own lease
      if (ped._unit && ped._unit !== unit) release(ped); // give up any lease of their own first
      unit.occupants.push(ped);                          // joins the household, NOT the primary
    }
    ped._unit = unit;
    ped._digs = unit.lot;
    if (unit.floorY != null) ped._homeFloorY = unit.floorY;
    // NOTE: no _tenants bump here — that tally counts LEASES (claim() events),
    // and a household join isn't a new lease, just another body under the one
    // already-counted roof. Keeps the "one rent bill per unit" model honest.
    ped._household = unit.id;
    partnerPed._household = unit.id;
    return true;
  }

  // ---- W9: HOUSEHOLD PROMOTE (the primary leaseholder died) -----------------
  // occupants[0] is the one who actually holds the lease (rent payer, the name
  // economy.js's rent tick bills). When that primary dies, inheritance.js hands
  // the household to the heir if the heir is ALREADY a co-occupant of the SAME
  // unit (a live spouse/kid who lived there) — just reorder occupants so the
  // heir leads it; nobody moves, nothing re-leases, the address survives the
  // death exactly like a real household would. Returns true on a promotion (or
  // if the heir was already primary); false if the heir isn't seated in this
  // unit at all (inheritance.js leaves release()'s normal vacancy path alone).
  function householdPromote(unit, ped) {
    if (!unit || !unit.occupants || !ped) return false;
    const i = unit.occupants.indexOf(ped);
    if (i < 0) return false;
    if (i > 0) { unit.occupants.splice(i, 1); unit.occupants.unshift(ped); }
    return true;
  }

  // CBZ.cityFloorUnits(lot): the rentable units on one lot. The global contract
  // lists this as a buildings.js name — but buildings.js is a parallel file and
  // may not ship it. We PROVIDE it here (deriving from the lot) UNLESS buildings
  // already defined a richer one (we never clobber an existing export).
  function floorUnits(lot) {
    const c = ensure();
    if (c && c.byLot.has(lot)) return c.byLot.get(lot);
    return deriveUnitsForLot(lot);               // lot not in cache (annex/late) → derive live
  }

  // ---- H6: NIGHT OCCUPANCY READ (data-first, light-optional) ---------------
  // The unit→floor mapping IS the "micro-apartment interior": the floor was
  // already dressed by buildings.js (furnishApartmentFloor) and the interiormap
  // backdrop quads already sell "someone lives here" from outside (BACKDROP_CAP
  // 480 — we add ZERO quads). So no per-unit geometry is needed for the read.
  //
  // The OPTIONAL extra: at night, flip a unit's EXISTING ceiling-lamp emissive
  // (lit when the resident is home + sleeping, dark when out) by toggling a
  // material param on an ALREADY-instanced mesh — never adding one. This only
  // fires if buildings.js stashed a per-unit lamp handle (unit._lamp); if it
  // didn't (the spec's RISK: wiring a specific lamp would mean editing the
  // shared buildings.js file), we SKIP the toggle and keep the data mapping.
  // We never touch buildings.js, so in practice this stays data-only unless a
  // future buildings.js change opts in by stamping unit._lamp.
  function markOccupancy() {
    if (!ENABLED()) return;
    const c = ensure();
    if (!c || !c.units.length) return;
    const night = (CBZ.nightAmount != null) ? CBZ.nightAmount
                : (CBZ.isNight ? (CBZ.isNight() ? 1 : 0) : 0);
    const isNight = night > 0.5;
    for (let i = 0; i < c.units.length; i++) {
      const u = c.units[i];
      const lamp = u._lamp;                       // OPT-IN handle; absent → data-only
      if (!lamp || !lamp.material) continue;       // (no mesh wired → skip, per H6 RISK)
      // "home at night" ≈ ANY occupant present this run (household, not just
      // the primary) + it's dark. We only flip a pre-existing emissive scalar;
      // never create/dispose anything.
      let occ = false;
      const ocs = u.occupants;
      if (ocs) { for (let j = 0; j < ocs.length; j++) { if (ocs[j] && !ocs[j].dead) { occ = true; break; } } }
      const lit = isNight && occ;
      const want = lit ? (u._lampLit != null ? u._lampLit : 0.9) : 0.0;
      if (lamp.material.emissiveIntensity !== want) {
        lamp.material.emissiveIntensity = want;
        if (lamp.material.emissive && lamp.material.emissive.setScalar && !lit) {
          // dark: leave the colour, just kill intensity (cheapest path).
        }
      }
    }
  }

  // a CHEAP throttle wrapper so a caller can drive markOccupancy on a slow tick
  // without us minting a separate onUpdate (housing stays lean; economy.js owns
  // the rent tick, and whoever wants the light read can call this).
  function occupancyTick(dt) {
    if (!ENABLED()) return;
    _occClock += (dt || 0);
    if (_occClock < 4) return;                    // ~4s cadence — a light is not urgent
    _occClock = 0;
    markOccupancy();
  }

  // drop the cache so a fresh run re-derives (mode.js may call this; not
  // required thanks to the array-identity self-heal in ensure()).
  function reset() { cache = null; _occClock = 0; }

  // ---- EXPORTS (exact names the contract + the consumers use) --------------
  CBZ.cityAssignHome = assignHome;
  CBZ.cityHomeOf = homeOf;
  CBZ.cityHomeRelease = release;
  // only publish cityFloorUnits if buildings.js hasn't already (never clobber a
  // sibling's richer export; ours is the fallback the contract guarantees).
  if (typeof CBZ.cityFloorUnits !== "function") CBZ.cityFloorUnits = floorUnits;
  CBZ.cityHousingReset = reset;
  // W8: the household move-in primitive (social.js couples/kids, family.js's
  // lot bridge). Every caller guards with `CBZ.cityHouseholdJoin &&` since this
  // module can be disabled/absent like the rest of the housing layer.
  CBZ.cityHouseholdJoin = householdJoin;
  // W9: the death-side counterpart — promote a surviving co-occupant to
  // occupants[0] when the primary leaseholder dies (inheritance.js).
  CBZ.cityHouseholdPromote = householdPromote;

  CBZ.cityHousing = {
    units: function () { return ensure().units; },
    unitsForLot: floorUnits,
    assign: assignHome,
    homeOf: homeOf,
    release: release,
    householdJoin: householdJoin,
    householdPromote: householdPromote,
    rentBudget: rentBudget,
    markOccupancy: markOccupancy,
    occupancyTick: occupancyTick,
    reset: reset,
    // diagnostics (no UI — read-only counts for the rent tick / a debug probe).
    occupied: function () {
      const u = ensure().units; let n = 0;
      for (let i = 0; i < u.length; i++) {
        const oc = u[i].occupants;
        if (oc) for (let j = 0; j < oc.length; j++) { if (oc[j] && !oc[j].dead) { n++; break; } }
      }
      return n;
    },
    vacant: function () { const u = ensure().units; let n = 0; for (let i = 0; i < u.length; i++) if (!u[i].occupants.length) n++; return n; },
  };
})();
