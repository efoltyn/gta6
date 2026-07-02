/* ============================================================
   core/interfaces.js — THE CONTRACTS INDEX.

   This engine has no type system and no module boundaries beyond
   "everything hangs off window.CBZ" — so the load-bearing agreements
   between files live only in scattered comments (a `grep -rn contract
   src/` turns up ~200 hits). Fine for the ONE file that owns a
   contract, useless for the NEXT file that wants to consume it.

   This file implements nothing. It is a discoverable TABLE OF
   CONTENTS: one entry per cross-file contract —

     OWNER  — file:line where the real doc-comment + code live (this
              index is a POINTER, not a copy; the owner wins on drift)
     SHAPE  — the record/signature, verified against the code
     RULE   — what must not change / how to extend it
     RIDERS — who currently depends on it (grepped, not guessed)

   RULE FOR NEW CODE: any record shape, event, or function signature
   read/called by MORE THAN TWO files without a shared owner gets one
   entry here at PR time. Keep entries short — this indexes, it does
   not replace the doc-comment at OWNER.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  // 1. CBZ.collide / CBZ.collideSlide — THE WALL RESOLVER
  //    OWNER: systems/physics.js:120-174
  //    SIG: CBZ.collide(pos, radius, feetY, headY) mutates pos.{x,z} in
  //      place (pos.y untouched). CBZ.collideSlide(pos, radius, feetY,
  //      headY, passes=3) loops it to convergence.
  //    RULE: shared verbatim by the PLAYER and every NPC mover (per
  //      physics.js:116-119 "cross-agent contract... do NOT change its
  //      math/signature; add new helpers instead"). Grid-accelerated,
  //      zero per-call allocation.
  //    RIDERS: physics.js (player), peds.js, crowd.js, gangs.js,
  //      vehicles.js — anything moving a body through world geometry.

  // 2. CBZ.feelDt — THE FEEL-DT CONSUMER CONTRACT
  //    OWNER: core/loop.js:39-51
  //    CONTRACT: read `const fdt = (CBZ.feelDt != null ? CBZ.feelDt :
  //      dt);` — never assume it exists or differs from dt.
  //    RULE: a real-wall-clock delta clamped to ~0.10-0.12s, separate
  //      from the spiral-guarded world `dt` (clamped 0.05s) — exists
  //      ONLY so the player's own integration doesn't slow-mo under
  //      load. Never feed it to anything but local player/camera/owned
  //      projectiles — per-client wall-clock value, not networked.
  //    RIDERS: physics.js (player integration), camera.js, projectiles.

  // 3. CBZ.colliders + CBZ.markCollidersDirty — STATIC WORLD COLLISION
  //    OWNER: array in config.js:12-14; broadphase grid in
  //      systems/physics.js:40-66 (rebuildColliderGrid, colDirty)
  //    SHAPE: { minX, maxX, minZ, maxZ, ref, [y0, y1] } — y0/y1 only on
  //      a height-gated collider (window/doorway); absent = full-height.
  //    RULE: anything that push/splices CBZ.colliders MUST call
  //      CBZ.markCollidersDirty() right after, or the broadphase grid
  //      goes stale. world/door.js is the canonical mutator (push+dirty
  //      on open, splice+dirty on close) — copy that shape.
  //    RIDERS: world/door.js, city/worldmap.js (registerCityRegion also
  //      dirties it), city/buildings.js, city/fracture.js, placement.js.

  // 4. CBZ.platforms + CBZ.groundAt() — WALKABLE HORIZONTAL SURFACES
  //    OWNER: array in config.js:15-17; groundAt() in
  //      systems/physics.js:230-247
  //    SHAPE: { minX, maxX, minZ, maxZ, top, [ramp] } — ramp is a
  //      continuous sloped stair, not tread-steps: { z0, z1, y0, y1 }
  //      (default, interpolates along z) or, since B3, the additive
  //      sibling { axis:"x", x0, x1, y0, y1 } (interpolates along x).
  //      No axis field = the original z form, byte-identical math — this
  //      is a DATA-SHAPE extension only, NOT a change to CBZ.collide's
  //      frozen signature (#1).
  //    RULE: groundAt(x, z, fromY) only counts a top within STEP_UP of
  //      fromY (stops "climb a sheer wall"). Off in `escape` mode. Only
  //      the player's vertical physics reads this — NOT the NPC
  //      collide() path.
  //    RIDERS: physics.js player resolve; city/buildings.js (floors/
  //      stairs/roofs push here, always the z form); systems/building.js
  //      (B3: player stairs, z form for rot0/2, x form for rot1/3).

  // 5. worldBlob serialize()/apply() — THE WORLD-SAVE OPT-IN
  //    OWNER: net/netpersist.js:113-137 (worldBlob), :218-226 (applyWorld)
  //    CONTRACT: a subsystem exposes CBZ.<thing>.serialize() -> plain
  //      object and CBZ.<thing>.apply(obj) -> void; netpersist.js picks
  //      it up by name, both calls wrapped in try/catch (one throwing
  //      rider never breaks the save for the rest).
  //    RULE: keep the blob small (relay hard-drops sockets past ~1.5MB;
  //      sendWorld() itself refuses past 1400KB) and version it (`v`
  //      field) so a shape change can no-op an old blob.
  //    CURRENT RIDERS (netpersist.js:130-135): gangs (inlined), fracture
  //      (CBZ.cityFracture.serialize), npc (cityNpcLedger.serialize),
  //      fam (cityFamilyTree.serialize), day (CBZ.dayPhase()), propMkt
  //      (g.cityPropMkt raw copy).

  // 6. cityWorldCommit / cityWorldCollect — SINGLE-PLAYER LEDGER WRAP
  //    OWNER: city/worldstate.js:101-170 — commit() builds the one
  //      localStorage ledger; CBZ.cityWorldCommit = commit,
  //      CBZ.cityWorldCollect = () => commit(). VERIFIED: the true
  //      origin is worldstate.js, NOT bank.js — bank.js is a rider that
  //      wraps this same origin, like the others below.
  //    PATTERN (the "_xWrap" idiom — copy verbatim for a new field): a
  //      rider caches CBZ.cityWorldCommit, guards its own `!fn._xWrap`,
  //      wraps as `function(){ stamp(); return inner.apply(this,
  //      arguments); }`, flags itself, re-points cityWorldCommit AND
  //      cityWorldCollect to the SAME wrap (else the MP blob misses the
  //      field). Restore side hydrates from g.cityWorld on a REFERENCE
  //      change (fresh load / respawn / MP adopt), not once at boot.
  //    RIDERS: bank.js (cityLoans), pawnshop.js (cityPawnTickets),
  //      outfits.js (cityFit), familytree.js (familyTree, guard
  //      `_ftWrap`), marriage.js, sim/currency.js (currencyWallet/
  //      currencyBank, guard `_curWrap`).

  // 6b. g.cash / g.cityBank — THE MULTI-CURRENCY WALLET COMPAT ACCESSORS
  //    OWNER: sim/currency.js (whole file; M1)
  //    CONTRACT: both are Object.defineProperty accessors on CBZ.game
  //      proxying g.cityWallet.LBD / g.cityBankWallet.LBD — a PLAIN
  //      get/set passthrough (no clamping at the property level; a raw
  //      `g.cash -= n` behaves exactly like the old number field always
  //      did). CBZ.currency.walletAdd/walletTake/bankAdd/bankTake are a
  //      SEPARATE, parallel API (M2+ forex/central-bank use) — never
  //      called by the accessors themselves.
  //    RULE: read/write `g.cash`/`g.cityBank` exactly as before — every
  //      one of the ~60 existing call sites needs zero edits. A NEW
  //      foreign-currency balance goes through CBZ.currency.walletAdd/
  //      Take(currencyId, amt) / CBZ.currency.wallet()[currencyId],
  //      never through g.cash (that's the republic-only compat lane).
  //    RIDERS: every city/* module that touches g.cash/g.cityBank
  //      (city/mode.js's addCash/spend/canAfford is the canonical
  //      faucet/sink; city/bank.js/pawnshop.js/zillow.js/realestate.js/
  //      worldstate.js and ~30 others read/write directly).

  // 7. cityKillPed — THE ONE DEATH FUNNEL, AND ITS WRAP CHAIN
  //    OWNER: city/peds.js:1432 — every ped death routes through here.
  //    VERIFIED WRAP CHAIN (corrects "index.html load order" — half of
  //      these wrap LAZILY, not at module-load time):
  //        - killfeed.js:90-105, systems/gore.js:81-95, city/
  //          inheritance.js:275-310 wrap UNCONDITIONALLY at their own
  //          module-load time (typeof check only) — safe since all
  //          three load AFTER peds.js, so load order IS wrap order
  //          there: inheritance(outermost) wraps gore wraps killfeed
  //          wraps the peds.js original.
  //        - city/social.js:1154-1191 (called from the population-spawn
  //          reset), city/loyalty.js:238-254 (retried from an
  //          onUpdate(34.58) probe), city/schedule.js:386-393 (retried
  //          from onUpdate(35.8)) wrap LAZILY on first successful tick —
  //          each self-guarded, so their place in the chain is "whoever
  //          ticks first," NOT script position.
  //        - city/familytree.js does NOT wrap cityKillPed at all (only
  //          wraps cityWorldCommit/cityWorldCollect, #6) — the
  //          "familytree?" lead was wrong; kill-time family bookkeeping
  //          lives in inheritance.js.
  //    RULE: every wrap must call `orig.apply(this, arguments)`, return
  //      its result, guard its own idempotence flag, and never assume
  //      it's innermost or outermost.

  // 8. City regions — addLandmass / registerCityRegion / registerWorkAnchor
  //    OWNER: city/worldmap.js:40-60, :167 (registerWorkAnchor)
  //    CONTRACT: `CBZ.addLandmass(function (city) { ...; CBZ.
  //      registerCityRegion(city, {name, biome, kind:'circle', cx, cz,
  //      r}); }, order)`. registerCityRegion normalizes 'circle' into
  //      the same minX/maxX/minZ/maxZ a 'rect' region has, pushes onto
  //      city.regions, and dirties the collider grid (#3).
  //    SHAPE: { name, biome, kind, minX, maxX, minZ, maxZ, pad=2, ... }
  //    RULE: world.js/swim.js/fullmap all consult city.regions instead
  //      of hardcoded bounds — a new landmass touches zero shared files.
  //    RIDERS: city/world.js (clampToCity), swim.js, fullmap rendering,
  //      every biome_*.js island module.

  // 9. CBZ.dayPhase() / CBZ.citySunHour() — THE TIME API
  //    OWNER: core/daynight.js:26 (dayPhase, 0..1 fraction of day; a
  //      finite arg sets it e.g. on MP world-load); city/schedule.js:
  //      52-61 (citySunHour, 0..24 derived from CBZ.sunAngle, 8Hz cache)
  //    RULE: dayPhase is the only thing riding the world-save (#5); no
  //      monotonic world-day counter exists yet — ordering across runs
  //      uses CBZ.game.elapsed as a placeholder, not these. citySunHour
  //      is read-only derived state — set dayPhase(), never write hour
  //      directly.
  //    RIDERS: schedule.js (vendor tills/timetables), netpersist.js
  //      (day field).

  // 10. NPC ledger — cityPedStash / cityPedDeal / cityLedgerEntry / cityLedgerLive
  //    OWNER: city/schedule.js:228 (cityPedStash banks a live ped),
  //      :310 (cityPedDeal deals a page back), :222-223 (cityLedgerEntry
  //      /cityLedgerLive — W9 read-only accessors onto private maps)
  //    SHAPE (led[sid]): { sid, k(cast key), salt, name, arch, job,
  //      wealth, aggr, drug, cash, known, sex, lh(longHair), hh
  //      (household id, W8), rel:{r,f,l,a,g,s}|null } — compact ints.
  //    RULE: the two accessors return null, NEVER undefined. This
  //      module is the SOLE authority on offline identity — don't grow
  //      a parallel copy of its maps elsewhere, widen these instead.
  //    RIDERS: city/inheritance.js (offline heir lookups), familytree.js
  //      (mints a sid via cityPedStash at pairing time).

  // 11. CBZ.cityFamilyTree — EDGE SHAPE + heirOf SEMANTICS
  //    OWNER: city/familytree.js (edges array + accessors, :261-266)
  //    SHAPE (edge): { k:"sp"|"pc", a:sid, b:sid, since, end:null|t,
  //      why:null|"death"|"divorce" }. sp=spouse (a<->b, symmetric);
  //      pc=parent->child (a=parent) and NEVER ends — only marriages do.
  //    RULE: heirOf(sid) (:218-228) returns the living spouse first,
  //      else the eldest LIVING child, else null. "Living" = not in this
  //      module's own `dead` set — schedule.js's ledger has no alive
  //      flag (a killed sid's page is deleted outright), so there is no
  //      other oracle. serialize()/apply() (v:1) are #5's riders; the
  //      single-player wrap follows #6's idiom (guard `_ftWrap`).
  //    RIDERS: city/inheritance.js (heirOf/spouseOf/kidsOf/parentsOf).

  // 12. CBZ.assets.define / CBZ.assets.pool — THE PREFAB CATALOG
  //    OWNER: city/assets.js:56-163
  //    SHAPE (def): { footprint:{hx,hz}, clearance=0.5, stackable=false,
  //      y0=0, y1=30, noCollide=false, zone, instanceable=false, geom(),
  //      material(), build(ctx) } — ctx = { group, x, z, rot, rng, scale }.
  //    RULE: build(ctx) must be DETERMINISTIC (only ctx.rng, never
  //      Math.random). instanceable defs SHOULD supply geom()+material()
  //      so pool() takes the fast path (one shared InstancedMesh, ~1
  //      draw call); multi-mesh defs fall back to per-instance groups.
  //      F6 (pool free-list/recycle) will extend this shape.
  //    RIDERS: city/placement.js (placeAsset/scatter), town-generator
  //      modules that call A.define per prop kind.

  // 13. CBZ.placement.isFree / .reserve — THE OCCUPANCY RECT
  //    OWNER: city/placement.js:36-138 (overlaps()/isFree()/reserve())
  //    SHAPE: { minX, maxX, minZ, maxZ, minY, maxY, stackable, zone } —
  //      minY/maxY are OPTIONAL (F5). A rect that omits them is
  //      full-height: overlaps() defaults minY to -Infinity and maxY to
  //      +Infinity, so every pre-F5 (XZ-only) rect keeps blocking the
  //      whole vertical column, unchanged.
  //    RULE: isFree() runs on plain rects (test-then-build); reserve()
  //      stores the INFLATED rect (footprint+clearance), but the
  //      collider pushed to CBZ.colliders (#3) is un-inflated true size
  //      — don't conflate the two.
  //    RIDERS: town-generator/placeAsset call sites; the four building
  //      systems F5 lists as needing the Y test.

  // 14. CBZ.interactions.register / .registerFor / .registerZone
  //    OWNER: city/interactions.js:65-93 (the keystone: ONE context-
  //      sensitive interaction system, no dedicated special keys)
  //    SHAPE (option): { id, label|fn(t,ctx), slot:"e|i|j|k|l", prio,
  //      bad, hold, distance, needsGunDrawn, needsItem, role,
  //      canShow(t,ctx), onSelect(t,ctx) }. register(layer,opt) = a
  //      layer-wide option; registerFor(entity,opt) rides the entity's
  //      own _iopts[]; registerZone(z) adds a point+radius spot with its
  //      own find(px,pz,ctx)->target.
  //    RULE: per key SLOT, highest-prio PASSING option wins; canShow is
  //      re-evaluated every panel refresh against LIVE state — never
  //      cache a gate result. Tap and hold are independent verbs on one
  //      key.
  //    RIDERS: city/interact.js (every street verb), vehicles.js.

  // 15. CBZ.PRIO — THE FRAME-ORDER BAND NAMES
  //    OWNER: core/prio.js (whole file; F1)
  //    CONTRACT: CBZ.PRIO.<NAME> is a grepped, VERIFIED order number
  //      from a real onUpdate/onAlways call site (cited per entry) — it
  //      NAMES existing order, does not redefine it. CBZ.PRIO.after
  //      (base, n) = base + (n||1)*0.01; a wider gap is added by hand
  //      (+0.1 / +0.5) per the existing decimal-slotting convention.
  //    RULE: never hardcode a bare order number — use CBZ.PRIO.X or
  //      CBZ.PRIO.after(CBZ.PRIO.X, n) with a one-line why. Renumbering
  //      an existing band is OUT OF SCOPE (changes execution order).
  //    RIDERS: every new onUpdate/onAlways call site going forward.

  // 16. Housing units — cityHouseholdJoin / cityHouseholdPromote
  //    OWNER: city/housing.js:31-42 (unit shape), :514-519 (the two
  //      functions); W8
  //    SHAPE (unit): { id, lot, building, floorY, door, tier, capacity,
  //      rent, occupants:[] } — occupants[0] is always the PRIMARY
  //      leaseholder (billed rent in economy.js); capacityFor(tier)
  //      caps sharing (plain flat=1, mid=3, top/mansion=4).
  //    RULE: every mutation of unit.occupants goes through
  //      cityHouseholdJoin/cityHouseholdPromote — don't splice/unshift
  //      occupants[] directly, or the ledger's `hh` field (#10) and rent
  //      billing desync from who actually lives there. Callers guard
  //      with `CBZ.cityHouseholdJoin &&` since this module can be absent.
  //    RIDERS: city/family.js (mansion households), schedule.js (stamps
  //      ped._household), inheritance.js (reads occupants[0]).

  CBZ.INTERFACES = {
    version: 1,
    list: [
      "CBZ.collide / CBZ.collideSlide",
      "CBZ.feelDt",
      "CBZ.colliders + CBZ.markCollidersDirty",
      "CBZ.platforms + CBZ.groundAt",
      "worldBlob serialize()/apply()",
      "cityWorldCommit / cityWorldCollect _xWrap chain",
      "cityKillPed wrap chain",
      "City regions: addLandmass / registerCityRegion / registerWorkAnchor",
      "CBZ.dayPhase() / CBZ.citySunHour()",
      "NPC ledger: cityPedStash / cityPedDeal / cityLedgerEntry / cityLedgerLive",
      "CBZ.cityFamilyTree edges + heirOf",
      "CBZ.assets.define / CBZ.assets.pool",
      "CBZ.placement.isFree / .reserve rect shape",
      "CBZ.interactions.register / .registerFor / .registerZone",
      "CBZ.PRIO bands",
      "Housing units: cityHouseholdJoin / cityHouseholdPromote",
    ],
  };
})();
