# PILLAR: THE WITNESS BLOCK

OWNER (verbatim): "the beauty is animals and npcs and vehicles everything can spawn at
horizon so user never sees it spawn but nothing not seen needs to really exist physically
but once seen it can't just disappear — it stays in existence, especially if they see a
rare animal or high level person."

That is TWO laws and they pull in opposite directions. Law A ("nothing unseen must exist")
is what makes 10x affordable. Law B ("once seen it stays") is what makes the world feel
permanent. The repo has A solved centrally (`CBZ.npcTransitionSafe`, config.js:914-952,
consumed by 9 files) and B essentially absent — the recon grep for `_witnessed` /
`seenByPlayer` / `_everSeen` returned ZERO hits. Every continuity path today is gated on
`worth()` (schedule.js:188-205) or on a curated roster (`cityIdentities`), and **being
looked at is not on either list.**

The block is small because both halves ride primitives that already exist and already
round-trip through save. What is genuinely new is one write, one read, and one eviction
clause.

---

## 1. THE API

New file `src/city/witness.js` (~220 lines), loaded after `identity.js` and `schedule.js`.
It reads nothing at load; it allocates nothing, ever.

```js
CBZ.witness(actor, dt, opts)   // THE WRITE. call it while the thing is drawn. returns true once tagged
CBZ.witnessed(actor)           // THE READ. "has the player really seen this individual"
CBZ.witnessTier(actor)         // 0 virtual / 1 ledgered / 2 identity-registered
CBZ.witnessHold(actor, site)   // demotion guard: true => YOU MAY NOT TAKE THIS BODY
CBZ.witnessBank(actor)         // demotion guard: bank before you anonymize
CBZ.witnessHorizon(kind)       // the class's OWN draw radius, live off the quality tier
CBZ.witnessAudit()             // the ratchet
```

**One-line adoption, and it is degrade-safe by construction** (Block Law 1+2). Every
adoption site is a place that already computed distance and visibility this frame:

```js
// peds.js:5152 — `vis` is already computed on the line above
if (vis && CBZ.witness) CBZ.witness(p, dt);
```

**WHAT A `_witnessed` WRITE COSTS — concretely.** There is no Map, no Set, no array, no
registry keyed on the actor. That is deliberate: a Map keyed on actors leaks refs to dead
bodies and is precisely the parallel-bookkeeping trap CLAUDE.md records as having killed
`proptypes.js`. State lives ON the actor (3 numbers) and the ledger page is the only
durable copy.

- before tag: `_wDwell` and `_wLast` float writes + one multiply for the legibility rate — ~5 ns.
- at tag: one int write (`_witnessed = CBZ.dayCount()`) + one `witnessRare()` test (5 property reads).
- after tag: one property read, early return. Free.
- memory: 3 numbers on actors that have been near you. Zero allocation on any path.

Builder must ASSERT (not assume): < 0.02 ms/frame at 90 live rigs + 48 crowd agents.

**THE DWELL RULE — a one-frame blur must not tag.** Three conditions, all from numbers the
caller already holds:

1. **DWELL.** `_wDwell += dt * rate` while drawn; tag at `WITNESS_DWELL = 0.45 s`. A human
   saccade is 20-200 ms and a fixation 200-350 ms, so 0.45 s is comfortably past a glance.
2. **DECAY.** `_wDwell -= dt * 0.5` while not drawn, floored at 0. So three separate 0.2 s
   glimpses a minute apart do NOT accumulate into a tag, but a 0.3 s look followed 0.2 s
   later by another 0.3 s look does. That is the honest model of "I saw that."
3. **LEGIBILITY (the anti-inflation rule, and the one that matters most).** Dwell accrues at
   `rate = clamp01((VIS_D - d) / (VIS_D - TAG_D))` — full rate inside `TAG_D` (26 m,
   peds.js:71), zero at `VIS_D` (95 m, peds.js:78, live via `CBZ.pedLOD`). **A body 90 m
   away drawn eight pixels tall was not seen as an individual.** Without this clause a walk
   down one boulevard tags 400 people and the ledger churns (see §7).

`opts.aimed` triples the rate. `aim_dossier.js`'s existing 12.5 Hz `aimedActor(360)` sweep
(aim_dossier.js:203-241) already names exactly the actor you are looking AT and today
writes nothing — one line there makes scoping somebody a near-instant tag, which is the
truest witness signal in the game and costs nothing new.

**THE POOL TRAP — call this out in the file header.** A pooled rig reused for a new person
must have `_witnessed/_wDwell/_wLast` CLEARED or the pool poisons: `crowd.js` `assign()`
(crowd.js:1484) and `CBZ.cityScheduleRecycled` (schedule.js:406). Conversely
`CBZ.cityPedDeal` (schedule.js:346-401) must RESTORE `_witnessed` from the page (`best.w`),
because a remembered identity walking back in was, in fact, seen. That is the round trip.

---

## 2. THE THREE-TIER EXISTENCE LADDER

| tier | what exists | rides | persistence |
|---|---|---|---|
| **0 VIRTUAL** | nothing — identity is a pure function of (x, z, seed) | `CBZ.hash01/hashN/hashPick` (core/seed.js:85-92) | **free and total** — recomputed byte-identical forever, in every client |
| **1 LEDGERED** | a ~280 B JSON page, no body | `CBZ.cityPedStash`/`cityPedDeal` (schedule.js:255-401), LRU 900 (schedule.js:181) | `CBZ.cityNpcLedger.serialize/apply` (schedule.js:518) — MP only today (netpersist.js:138,265); **SP gap is bug fix #2** |
| **2 IDENTITY** | a permanent record that outlives the body | `CBZ.cityIdentities.register/markDead` (identity.js:54-85) | **both paths already** — worldstate.js:220,286 AND netpersist.js:139,266 |

Tier 0 is the whole reason 10x is affordable: **10x of nothing is nothing.** Determinism is
not a constraint here, it is the feature — an unmutated thing needs no storage because the
hash regenerates it exactly. The law bites only where runtime state accumulates (a wallet,
a grudge, a dent, a death), and that is exactly what tiers 1 and 2 are for.

Tier 1's witness hook is **one clause at schedule.js:189**, inside the existing `worth()`:

```js
if (ped._witnessed) return true;   // WITNESS: you looked at them. that is worth a page.
```

Tier 2's promotion rule is one derived function — **no species list, no role list, adding a
rare thing must never mean adding a row** (the `predatorKit` / `powerKit` / `mapIcon` law):

```js
witnessRare(a) =  a.legendary                       // wildlife.js:885
              ||  CBZ.cityTrueLevel(a) >= 40        // level.js — the TRUE level, never the claim
              ||  a.nameKnown || a.bounty
              ||  (CBZ.factions && CBZ.factions.tier(...) >= 2)
              ||  (a._powerTier | 0) > 0            // power.js principals
```

`witnessTier(a)` = 2 if `witnessRare(a)` else 1 if `witnessed(a)` else 0. That single
function is where the owner's "especially if they see a rare animal or high level person"
lives, and it is the tier boundary the whole budget rests on.

---

## 3. THE DEMOTION-GUARD CONTRACT

**THE LAW: a demotion path may not ANONYMIZE a witnessed thing. It banks it first, and
refuses outright if the bank would lose the individual.** Two lines at any choke point:

```js
if (CBZ.witnessHold && CBZ.witnessHold(a, "crowd:park")) return;  // tier 2 — never recycled
if (CBZ.witnessBank) CBZ.witnessBank(a);                          // tier 1 — bank, then proceed
```

`witnessHold` returns true only for tier 2. `witnessBank` runs the tier-1 stash and
increments `banked`; a witnessed actor demoted without a bank increments **`orphaned`, the
pinned-at-0 ratchet**.

1. **`crowd.js park(e)` (crowd.js:1297-1304).** Already calls `cityPedStash` first — but
   `worth()` refuses non-worth peds, so today that stash is usually a no-op. The §2 clause
   makes it real. ADD the `witnessHold` refusal: a tier-2 body stays promoted and keeps one
   of the 48 slots (crowd.js:62). That is the honest price of having stared at somebody.
   Cap safety: past `WITNESS_HOLD_MAX = 8` of 48, release the oldest-witnessed non-tier-2.
   Suppression at crowd.js:2258-2283 routes through `park`, so it is covered by the same edit.
2. **`citystaff.js dropPost(p, reason)` (citystaff.js:303-319).** "SHOT stays vacant. SWEPT
   comes back" (citystaff.js:475-477) protects the *slot*; the witness block protects the
   *person*. On `reason === "far"` with a witnessed worker, `witnessBank` before
   `cityUnpostNpc`. The barman you talked to is the same barman when you come back.
3. **`traffic.js recycleOne(A)` (traffic.js:312-337).** One clause in the pick filter:
   `if (CBZ.witnessed && CBZ.witnessed(c)) continue;` — a car you looked at is not
   teleported across town. Pairs with §5.

`witnessAudit().orphaned` is measured AFTER a `CBZ.stepSim` burst, copying
`roadTrafficAudit`'s pattern, so a thing recycled during PLAY fails too — not just one at
build time.

---

## 4. THE TWO BUG FIXES THAT SHIP FIRST (the proof)

They ship first because they prove each tier is real before anything is allowed to depend
on it.

**FIX 1 — LEGENDARY PERMADEATH IS NOT SAVE-DURABLE.** wildlife.js:878-886 mints exactly one
legendary per species (`a.legendary = true`); wildlife.js:895 promises "a species hunted to
ZERO is EXTINCT — forever"; wildlife.js:923 never breeds one; wildlife.js:1247 fires the
"★ LEGENDARY … DOWN" note. **There is no wildlife serialize hook anywhere in the repo — a
reload resurrects the White Stag.** The game's loudest permanence promise is false. Two
call sites, ~6 lines:
- at mint (wildlife.js:885): skip the species if a *dead* `cityIdentities` record exists for
  it; else `a._identityId = CBZ.cityIdentities.register("wildlife", sp.name, {sp: sp.id}).id`.
- at death (wildlife.js:1247): `CBZ.cityIdentities.markDead(a._identityId, {killedBy:"player"})`.

Persistence is then FREE — identities already round-trip through both paths. This is tier
2's first non-curated consumer and it costs no new machinery at all.

**FIX 2 — THE SP/MP LEDGER ASYMMETRY.** `netpersist.js:138,265` persists
`CBZ.cityNpcLedger`; `worldstate.js:220,286` persists `identities` and NOT the ledger.
**Every worth-civilian — dealers, vendors, marks carrying cash, anyone holding a grudge —
is lost on a singleplayer reload and survives in multiplayer.** Two lines, mirroring the
`identities` lines that already sit beside them:
- commit: `if (CBZ.cityNpcLedger && CBZ.cityNpcLedger.serialize) try { w.npc = CBZ.cityNpcLedger.serialize(); } catch(e){}`
- apply: `if (w.npc && CBZ.cityNpcLedger && CBZ.cityNpcLedger.apply) try { CBZ.cityNpcLedger.apply(w.npc); } catch(e){}`

Budget: 900 × ~280 B ≈ 250 KB against a save cap raised to 15 MB (schedule.js:169-172).
**Without this fix the entire witness block would be a multiplayer-only feature** — which
is why it is not optional and not deferred.

---

## 5. HOW VEHICLES JOIN

A car has no identity today: `traffic.js`'s pool is anonymous and only garage cars persist
`{name, color, mods}`. But the fields are already there — `c.color` (vehicles.js:1051),
`c.crumple` (vehicles.js:1307-1311), `c.model`, `c.engineHp`, `c.road`. What is missing is
a plate, **and a plate is free**: mint it at `CBZ.cityRegisterVehicle` (vehicles.js:1186) as
`CBZ.hash01(spawnX, spawnZ, PLATE_SALT)` → a deterministic string. **Tier 0 identity, zero
storage, byte-identical per seed.** Every car in the world gets a plate for the price of one
hash call at register.

- **witnessed car → tier 1.** `CBZ.witnessBank` on a car banks
  `{plate, color, model, crumple, engineHp, x, z}` into a small parallel LRU (cap 64 — cars
  are far rarer in the witnessed set than people), and `recycleOne` refuses it (§3.3). The
  car you shot up and abandoned is the same car, with the same dents, when you walk back.
- **hero-witnessed car → tier 2.** You drove it, you killed its driver, it carries a bounty
  or an owner: `cityIdentities.register("vehicle", plate, {...})` and it survives a reload.

Wave-2 three-consumer proof: `traffic.js` (recycle refusal), `vehicles.js` (the plate at
register), `airside.js` (a stolen baggage tug keeps its dents and its plate).

---

## 6. THE HORIZON-SPAWN HALF

**THE HORIZON IS PER-CLASS AND IT IS ALREADY DECLARED — it is the class's own draw
distance. No new constant is introduced.** `CBZ.witnessHorizon(kind)` reads live:

- `ped` → `VIS_D` — 45/70/85/95/110 m across quality tiers (peds.js:78, `CBZ.pedLOD`)
- `vehicle` → `cull` — 230/300/390/500/700 m (core/quality.js:65-73)
- `aircraft`, big silhouettes → `fog.far` — 380/560/760/1000/1400 m (core/quality.js; scene.js:12)

A thing placed beyond its own horizon **cannot be watched to spawn by construction** — that
is strictly stronger than `npcTransitionSafe`, which tests a padded screen box and
auto-ALLOWS everything past 150 m (config.js:925). The two COMPOSE and nothing is deleted:
**horizon is the PREFERENCE that runs first; transitionSafe stays the GUARD that vetoes the
residue.**

For peds this is nearly free (95 → 126 m is nothing). **The one real cost is traffic, and
the numbers make it concrete:** `recycleOne` places a car at `minDist 50, maxDist 120` with
`camMin: 62` (traffic.js:332-336) — **2 to 6× INSIDE the 230-500 m vehicle cull radius.** A
car materialises well within its own draw distance and relies purely on the camera not
looking at that instant. Turn your head and it is there. *That* is the owner's "pops at
150 m", and it is arithmetic, not a rendering bug.

The fix is a constant change plus one accounting change:
- `minDist: horizon("vehicle") * 0.9, maxDist: horizon("vehicle") * 1.35` (≈ 350 / 675 at tier 3).
- **IN-TRANSIT ACCOUNTING (mandatory, or this regresses density).** `computeTarget`
  (traffic.js:285-297) counts cars inside `NEAR2` = 80 m (traffic.js:300-311). A car placed
  at 350 m takes 25-40 s to arrive, so the near-count stays low and upkeep recycles again
  and again — a runaway that empties the far world to feed a bubble that never fills.
  `countNear` becomes `countNearOrInbound`: inbound = beyond `NEAR2`, inside `horizon*1.4`,
  and heading·(toward player) > 0.3. One dot product on a list already being walked, no new
  state.
- **Degrade:** if `roadPick` returns null at the far band `tries` times (likelier in a small
  town whose road network does not reach 350 m), fall back to today's 50/120 band and
  increment `witnessAudit().horizonFallbacks`. **That counter is the measurement of whether
  the world is big enough for the law** — it is the number the scale pillar should read.

---

## 7. BUDGET MATH, AND WHY WITNESSED ≠ IMMORTAL

**Tag rate, grounded.** Live rigs near the player are bounded by crowd `CAP = 48`
(crowd.js:62), `VENUE_STAFF_MAX = 40`, `INTERIOR_STAFF_MAX = 48` (config.js:969). Bodies
inside the 26 m full-rate legibility bubble at any moment: 4-10. A 26 m bubble moving at
2.5 m/s sweeps a fresh set roughly every 10 s; assume ~70% of bodies inside it clear the
0.45 s dwell. That is **~6 tags / 10 s ≈ 2,100 per hour** of walking a dense boulevard.

**2,100/hour against an LRU of 900 (schedule.js:181): the witnessed set overflows the
ledger in about 26 minutes.** That single number is why the eviction policy is mandatory
and why "witnessed = immortal" is a lie the design must refuse out loud. The owner's own
sentence tiers it for us — *"especially if they see a rare animal or high level person"*.

**THE HONEST TIERS:**
- **Tier 2 — rare / high-level / named / legendary / principal / bounty.** Permanent
  identity, save-durable, never evicted, never recycled. Expected population: legendaries
  (~8-14, one per legendary species), plus already-registered bosses/VIPs/racers/owners
  (vips.js:310, gangs.js:607-629, racing.js:269-559, companies.js:140-323 — ~40-80), plus
  witnessed-rare civilians. **Cap `WITNESS_IDENTITY_MAX = 250`**; past it promotion is
  refused and counted (`identityRefused`). At ~400 B/record that is ~100 KB — trivial
  against the 15 MB save.
- **Tier 1 — generic witnessed.** Ledgered *with an expiry*. Stamp `e.w = CBZ.dayCount()`
  at bank time; `trim()` (schedule.js:206-218) gains ONE new preference order:
  (a) never a live sid — already true, schedule.js:211;
  (b) non-witnessed, oldest `seen`;
  (c) witnessed but `dayCount() - e.w > WITNESS_DAYS` (default **3**; a game day is 150 real
      seconds — schedule.js:55, core/daynight.js:60 — so ~7.5 real minutes), oldest `seen`;
  (d) witnessed and fresh, oldest `seen` — the last resort, counted as `evictedFresh`.
  **A face you glanced at three days ago and never met again is allowed to be forgotten. A
  face you met yesterday is not.**
- **Tier 0 — nothing to evict.**

`evictedFresh > 0` is a MEASUREMENT, not a failure: it says the cap is too low for the
observed play pattern, and it is the honest input to any future decision to raise CAP.

---

## 8. THE RATCHET AND THE FLAGS

`CBZ.witnessAudit()` → `{ tagged, tier1, tier2, banked, orphaned, evictedFresh,
identityRefused, horizonFallbacks, holdSlots, ledgerDurableSP, legendaryDead,
legendaryResurrected }`

PINNED:
- **`orphaned` = 0.** A witnessed actor demoted through any of the three choke points
  without a bank. This is the whole block in one number. Measured after a `CBZ.stepSim`
  burst so a body recycled during PLAY fails too.
- **`ledgerDurableSP` = 1.** Proves fix 2 survives — a boolean-as-number, so a regression
  that silently drops the worldstate rider fails loudly.
- **`legendaryResurrected` = 0.** `spawnAll` must skip a species whose identity record is
  dead. Assert by: `markDead` a record, rebuild the world, count.
- `tagged` / `tier1` / `tier2` / `banked` printed BESIDE them, so a "fix" that simply stops
  tagging anything cannot pass — the `cityCrowdSpawnAudit` and `mapAudit` precedent.

PRINTED, NOT PINNED (calibration): `evictedFresh`, `identityRefused`, `horizonFallbacks`,
`holdSlots`. **NOT YET MEASURED — the gate reports them and does not fail. Whoever runs it
first writes the numbers in.** Do not repeat the `propUseAudit` mistake of pinning a guess
into CLAUDE.md; that audit sat for weeks telling the next person to pin `blocked` at 0 and
the first run that ever executed it read 487.

FLAGS (config.js, `if (CBZ.CONFIG.X == null) CBZ.CONFIG.X = …`, one-line revert each):
- `WITNESS_V1` — master. Off → `witness()` no-ops, `witnessed()` returns false, every guard
  degrades to today's behaviour exactly.
- `WITNESS_DWELL` 0.45 · `WITNESS_DAYS` 3 · `WITNESS_HOLD_MAX` 8 · `WITNESS_IDENTITY_MAX` 250.
- `WITNESS_HORIZON_SPAWN` — the far-band preference. **Separately revertible** because it is
  the only part that moves where things appear, and therefore the only part that can hurt
  density.
- `WITNESS_VEHICLES` — the plate + car ledger.
- `WILDLIFE_PERMADEATH` — fix 1 (a genuine behaviour change: a reload stops giving the stag back).

**NO NEW HUD.** Nothing here draws. A witnessed individual is felt by still being there; the
killfeed remains the only sanctioned popup, and `aim_dossier`'s existing pill already reads
the truthful name with zero edits.

---

## 9. WAVE SEQUENCING

**WAVE 1 — THE LAW AND THE PROOF.** Territory: `city/witness.js` (new), `city/wildlife.js`
(2 sites), `city/worldstate.js` (2 lines), `city/schedule.js` (worth clause + trim clause +
`e.w`), `city/peds.js` (1 line at peds.js:5152), `city/crowd.js` (park + assign-clear),
`city/citystaff.js` (dropPost), `city/aim_dossier.js` (1 line at the sweep).
Ships: both bug fixes, the API, tiers 1+2, the three demotion guards, `witnessAudit`.
**Block Law: FIVE consumers migrated in the same change** (peds, crowd, citystaff, wildlife,
aim_dossier) — over the required three.
Independently valuable even if 2 and 3 never ship: legendary permadeath becomes true,
singleplayer stops forgetting everyone it meets, and the person you stared at is still there
when you turn around.

**WAVE 2 — VEHICLES AND THE HORIZON.** Territory: `city/traffic.js`, `city/vehicles.js`,
`city/airside.js`, `city/roadrules.js`.
Ships: the deterministic plate, the car ledger + recycle refusal, `witnessHorizon(kind)`,
the far-band spawn preference with in-transit accounting, `horizonFallbacks`.
Independently valuable: cars stop materialising in your peripheral vision at 60 m and stop
being interchangeable.
**Risk owned here:** this is the wave that can visibly thin traffic if the in-transit
accounting is wrong. That is exactly why it is separate and separately flagged.

**WAVE 3 — TIER 0 AT SCALE.** Territory: `city/wildlife.js`, `city/crowd.js`, new
`city/virtualpop.js`.
Ships: the hash-derived virtual population — fauna and outlying-region peds exist as a FIELD
QUERY (`CBZ.virtualAt(x, z, kind)` → a hash-derived individual) rather than objects,
materialised only when the horizon ring crosses them, with witnessed individuals lifted out
of the field into tier 1/2 so they can never be re-rolled.
**This is what actually buys 10x, and it is last on purpose**: it needs wave 1's ratchet to
prove it is not quietly losing people. Honest note — wildlife today spawns its entire
population as real objects at build (wildlife.js:868-887) and freezes far/calm ones
(wildlife.js:2674-2712). That is a working answer at today's scale and a wall at 10x. Wave 3
replaces the SEEDING, not the ecology: `CAPS`, breeding and extinction keep running on the
materialised set plus a virtual census.

---

## 10. THE CONTRACT LINES THE OTHER PILLARS CITE

Quote these verbatim; they are the interface.

1. **FAUNA / 10x.** "10x fauna spawns VIRTUAL (tier 0, `CBZ.hash01`-derived — zero objects,
   zero memory, byte-identical per seed), materialises as a real actor only when the horizon
   ring `CBZ.witnessHorizon('animal')` crosses it, and any individual the player actually
   looked at (`CBZ.witnessed(a)`) is lifted out of the field into the ledger and never
   re-rolled. A legendary is tier 2 the moment it is minted and its death is permanent
   through `cityIdentities` — which is a promise wildlife.js:895 has been making and not
   keeping."
2. **AVIATION.** "An aircraft's horizon is `fog.far` (380-1400 m), not the ped's 95 m — so
   airframes may be created at range with no visibility guard beyond
   `witnessHorizon('aircraft')`. A witnessed airframe (you watched it land, you shot at it,
   you rode it) is tier 1 and keeps its livery, registration and damage; its
   `AIR_HELI_CREW` / `citystaff` bodies bank with it rather than evaporating."
3. **SCALE / 10x WORLD.** "Population caps stop being TOTALS and become DENSITIES, because
   tier 0 costs nothing: `CBZ.CITY.crowd`, wildlife `DENSITY` and traffic's `computeTarget`
   all scale with area while the MATERIALISED set stays bounded by the same 48 / 40 / 40 rig
   budgets that exist today. **The number that must not grow is rigs-inside-the-horizon, and
   a 10x map does not change it.**"
4. **ANY SPAWNER.** "`CBZ.npcTransitionSafe` stays the guard and is never removed.
   `CBZ.witnessHorizon(kind)` is the PREFERENCE that runs first — place past the class's own
   draw radius so the placement is safe from ANY camera angle, then let transitionSafe veto
   the residue. A spawner that adopts both cannot be watched to spawn."
5. **ANY DEMOTER** (recycle / park / despawn / reap / suppress). "Call
   `CBZ.witnessHold(a, site)` first; true means you may not take this body. Otherwise call
   `CBZ.witnessBank(a)` before you anonymise it. `witnessAudit().orphaned` is pinned at 0
   and it names your site."
6. **ANY RARITY AUTHOR** (predators, bosses, officeholders, rare vehicles). "You never
   register an identity yourself. Stamp the rarity the world already reads — `a.legendary`,
   a `cityTrueLevel` ≥ 40, a declared faction rung, a `bounty`, a `powerKit` tier > 0 — and
   the witness block promotes to tier 2 on first sight. **Adding a rare thing must never
   mean adding a row.**"
