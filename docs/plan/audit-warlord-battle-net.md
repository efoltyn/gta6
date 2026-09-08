# Audit — Desert Warlord: the BATTLE layer and the MULTIPLAYER

Read-only audit, 2026-09-08. No game code was edited in this pass.

**Read:** `src/warlord/battle.js` (4858), `warnet.js` (1168), `match.js` (1271), `src/net/rooms.js`
(587), `net.js` (407), the network-facing parts of `campaign.js` (3820), `army.js` (2259),
`territory.js` (3082), `core.js`, `mounts.js`, `gunplay.js`, `games/warlord.html`, `games/battle.html`,
`server/server.js`, `tools/{test-rooms,warlord-net-check,warlord-cover-check}.mjs`,
`src/warlord/CONTRACT.md`, `MULTIPLAYER.md`, `docs/plan/pillar-npc-war-sandbox.md`.

**Measured:** `uptime` was 13.89 → 9.05 → **6.58**. `node tools/test-rooms.mjs` was run at 6.58 (Part B
§4). `warlord-net-check.mjs` was **not** run — two cold headless Chromes + two devservers, and load
never fell under 4.

---

## THE HEADLINE

Five load-bearing seams are **exported, documented, and have zero callers**. Each leaves the surrounding
prose true and the behaviour absent.

| seam | declared | callers |
|---|---|---|
| `C.setSimHost(on)` — "warnet.js flips it false on a guest" | `campaign.js:3713`, promised `campaign.js:146-150` | **0** |
| `W.warnet.snapshot / snapshotTo / onSnapshot` — the world tick | `warnet.js:1158-1160` | **0** |
| `T.setOwners(map)` — "for match.js and warnet.js" | `territory.js:1040-1046` | **0** |
| `W.mounts.battle.*` — "what battle.js should call" | `mounts.js:113,655,802,885` | **0** |
| `W.warnet.engage(peer)` — **called, never defined** | called `campaign.js:1895`; absent from `warnet.js:1074-1167` | n/a |

Consequence for multiplayer: **there is no shared simulation** (Part B §1). Consequence for the battle:
**there is no cavalry in any battle in this game**.

---

# PART A — THE BATTLE

## A1. Start, men, report, campaign

### The doors in
`army.js:658-667` `startBattle()` (the encounter rail's ATTACK — the normal door) · `events.js:1713` ·
`events.js:2714` (champion duel) · `events.js:3207` (`{defending:true, mutiny:true}`) ·
`territory.js:1610-1631` (`{storm:true}`) · `battle.js:4473-4507` (`?battle=1` debug).

### What is passed in (`battle.js:3553-3782`)
- `opts.band` (`:3569`) — **a real band with a real roster**, not a count.
- `opts.solo` (`:3700-3703`) — you walk out alone; your men are untouched reserve.
- `opts.duel` (`:3715`) — `noRout` on **both** sides.
- `opts.surprised` / `chased` (`:518`, `:3738`) — gap 160 m → 95 m, scattered spawn (`:617-620`), morale
  docked 0.2 / 0.1.
- **Terrain is not passed.** `buildGround(cx,cz)` (`:3632`) centres the field on `W.state.you.x/z` and
  asks `W.desert.battlefieldAt()` for the real island. `?bx/?bz` (`:4483`) exist only because there was
  no other way to pick ground.

### makeMan — a man is an individual with persistent identity
`makeMan(sideKey, s, i)` (`battle.js:633-713`). `s` is a soldier object out of `W.state.army` or
`band.men`, stored as `m.s` (`:657`). Header contract at `:21-25`: *"when he dies THAT OBJECT dies… the
same reference the campaign will not see again."* True in code: hp/tier/wid/armour/wounded all come off
`s` (`:666-673`), outfit from his own faction (`:645-649`), and `buildReport` writes surviving hp and a
`wounded` flag back onto `s` (`:4273-4274`).

`makeYou()` (`:719-756`) puts the warlord in the same array (`s:null, isYou:true`) — a body the grid
finds, `combat_iq` targets, morale reads. No `mag`/`reloadT` on purpose (`:738-742`): the magazine lives
in `fpsmode.js`.

Roster cap per side (`:3694-3704`): **750 desktop / 300 touch**, measured (`:139-169` — 13 µs CPU per
body per frame, 1540 bodies in a 30 fps frame). Men over the cap go to `reserveOf` and **survive**.

### What comes back — `buildReport` (`battle.js:4254-4334`)
```
{ band, outcome, duration, youKills, ratio, resolved,
  yourDead[], yourFled[], theirDead[], yourSurvivors[], theirSurvivors[],
  loot{wid:n}, armourLoot{id:n}, gold }
```
Every list is **soldier objects, by identity** — not counts. Rules worth keeping:
- survivors keep finishing hp, flagged `wounded` under a third (`:4273-4274`);
- loot is stripped off **every body, yours included** (`:4282-4295`);
- a retreat zeroes loot and kills 28% of survivors (`:4299-4306`);
- a loss kills **the men who stood** and lets the men who already broke get away wounded (`:4307-4331`)
  — a deliberate inversion of an earlier bug, argued in place.

**No XP field.** Progression is `battles++` per survivor and a tier promotion at `W.PROMOTE_AT*(tier+1)`
— `core.js:184-198`, called once at `army.js:1710`.

**Wounded vs killed: yes, three states** — dead, fled (routed off the field), and wounded-survivor
(`report.fledOf`, `battle.js:706`, `:4274`).

### What the campaign does with it
`endBattle` (`:4336-4356`) fires `battle:end`, then after 1.1–1.4 s hands the report to
`W.army.aftermath(r)` → `bank(r)` (`army.js:1673-1731`):
1. `removeSoldier(id, false)` per dead — `keepKit:false`, the kit is already in `r.loot` (`:1693`);
2. stash loot + armour, `earn(r.gold)` (`:1700-1705`);
3. `promoteSurvivors(survivors ∪ fled)` (`:1709-1710`);
4. prisoners + fame on a win (`:1714-1718`);
5. **prunes the band on the map** by dead/captured id and splices it out of `W.state.bands` if empty
   (`:1720-1729`).

Then a three-verb prisoner screen (`army.js:1733-1782`).

## A2. The player is a combatant AND a commander

Both, in the same body — the game's actual pitch, and it is implemented.

- **Combatant.** `YOU` is a unit in `men[]` (`:3725-3726`). The gun is `systems/fpsmode.js` via
  `warlord/gunplay.js` — not a fork. ADS, recoil, per-weapon sight FOV, sniper scope, breath-hold all
  come from the engine (`gunplay.js:4-51`, `:136-139`, `:808-812`; the deleted fork is eulogised at
  `battle.js:46-57`).
- **Commander.** Six orders (`battle.js:1805-1806`): `charge · hold · flank · fallback · follow · move`.

### How orders are issued — three live routes
1. **Keys** (`battle.js:4433-4443`): `Digit1..5` → charge/hold/flank/fallback/ follow, `KeyC` cycles
   camera. **`move` has no key binding.**
2. **HUD buttons** — `[data-o]` lit by `paintOrders()` (`:3474-3480`).
3. **Tap the ground in the command seat** — `onWorldPointer` (`:3783-3789`) → `groundPick` (`:3807`) →
   `moveTo(x,z)` (`:3834`). Public as `W.battle.moveTo` (`:4536`).

`setOrder` (`:1810-1826`) re-anchors to the line's current centre of mass, so HOLD after a CHARGE holds
*here*, not at the start line.

### Squads and formations (`?squads=old` reverts, `:79-90`)
`joinSquad` (`:2048`) — sections of ten (`m.sq = i/10|0`, `:681`); `formFor(order)` (`:2121`) + `slotOf`
(`:2106`) — the order picks the shape; `stepSquad` (`:2246`) moves a formed section as one body and
`frame()` skips `stepMan` for anyone `formed` (`:689-693`). That is the perf story: 601 formed bodies
cost roughly what 120 individual ones do.

Spawn is real drill: `frontage(n)` (`:606-611`) makes `√(n/6)` ranks; `spawnAt` (`:612-627`) checkers
odd ranks into even ranks' gaps so the second rank shoots *between* the first.

### Do orders matter measurably? Yes, with a probe
`tools/warlord-cover-check.mjs` gate C (`:34-37`): *"A CHARGE ACROSS OPEN DUNES COSTS. With the enemy
pinned on HOLD, the charging army takes more casualties than the holding one over the same window."* It
uses `W.battle.order(o,"them",{lock:true})` (`battle.js:4531-4534`) to stand the enemy commander down so
the test measures one charge, not two. Gate B asserts ≥60% of men holding under fire found a
reverse-slope position and are really crouched.

The enemy has a commander: `enemyCommand()` (`:1831-1839`) — fall back under 0.45 morale, charge at
1.25× power or 1.4× numbers, flank after 24 s.

## A3. Morale, routing, cover, stances, loot

### Morale (`battle.js:1192-1312`) — no typed balance scalars
- **How much an army has lost** is a *power* fraction: `1 - W.power(standing)/W.power(started)`
  (`:1259`) — already weighted by tier, gun, armour and wounds, so four veterans hurt four times what
  four levies do.
- **When a man breaks** is `combat_iq`'s own `ROLE[cq].nerve` (`nerveFor`, `:1706-1709`): civ 0.62, thug
  0.42, guard 0.30, soldier 0.20 (`:1224`).
- **The warlord holds the line together**: +0.16 alive and within 55 m, −0.30 down (`:1216-1218`,
  `:1262-1263`).
- **Rally with hysteresis** at `nerve + 0.14` (`:1306-1310`) so the line does not flicker at the
  threshold.

### What breaks a side — `brokenSide` (`:1713-1719`)
```js
fighting = alive - routing
gone     = deadN + routing + fled
broken   = fighting <= max(1, floor(men0.length*0.1)) && gone >= men0.length*0.3
```
Guarded by `men0.length <= 2` (a two-man escort is not an army that broke) and by `MORALE_OFF()`.
`noRout` (`:1291`, set `:3715`) is the duel exemption.

**One rule, three callers** — the 3D `checkEnd` (`:4229`), the headless `resolve` (`:1681-1684`), and
`deaths.js`'s "is this the deciding death" hook (`:3620-3625`). This is the strongest discipline in the
file.

`checkEnd` also carries a good special case (`:4233-4237`): a lone warlord with no men is not a broken
army — day one is one man and a pistol against six bandits.

### Suppression, cover, stance, optics
- **Suppression** is `combat_iq`'s: `suppress(m,0.9)` at `:2595` and `:2997`,
  `CBZ.suppressionAccuracyMul` folded into every shot at `:2510`.
- **Cover is the ground, not props.** `hullDown()` (`:1023-1075`) marches 13 bearings, finds the first
  radius where a **crouched** man is terrain-blocked, bisects onto the lip to ~8 cm, steps back, and
  requires a **standing** man there is NOT blocked — *"a fold that hides him standing is a hole with no
  shot out of it, and men in holes lose battles"* (`:1062-1064`). Refuses a fold that walks him toward
  the gun (`:1066-1068`). `CONTRACT.md:193-200` records why scattered rocks were deleted: `combat_iq`'s
  cover search only sees boxes, and a dune is not a collider.
- **Stance is a hitbox change, not a pose.** `setStance` (`:1153-1161`) scales `eyeH/losY/aimY/headY` by
  0.645. The comment at `:1136-1148` names the old bug: men in cover *looked* small and were shot at as
  if standing.
- **Optics per weapon** — cover-check gate E (`:42-45`): pistol, carbine and bolt gun give three
  different ADS FOVs and hold wobbles, where all three gave 50°.

### Loot — two kinds, both real
Report loot off every body including your own dead (`:4282-4295`), banked at `army.js:1700-1705`. And
loot **on the field, during the fight**: dropped rifles are physical, `nearestDrop()` (`:3218-3235`)
only offers one that has *settled*, KeyE takes it (`takeDrop`, `:3246`), `?take=off` reverts (`:3207`).

## A4. Determinism, duration, autoresolve

### Seeded — yes, on its own stream
`seedBattle(n)` (`:308-311`) installs a private LCG, seeded from `(seed*7919 + day*131 +
band.men.length)` in `start` (`:3573`) and the same plus `opts.salt` in `resolve` (`:1634-1635`). The
reason is stated at `:304-306`: a battle must replay identically from a save **and must not consume the
campaign's stream**, or every fight would shuffle the island behind it. `deaths.js` is armed with the
same `lcg` (`:3616`).

**Caveat:** the 3D battle is *seeded*, not *deterministic across machines* — it runs on real `dt` from
`micro.onFrame` (`:3769`). `resolve()` is the machine-independent one: a fixed 1-second tick loop
(`:1677-1685`).

### Duration
Ceiling `BATTLE_MAX() = 150 s`, `?limit=N` (`:1732-1735`). At the ceiling the fight does **not** stop:
`finishOnTheClock()` (`:1736-1780`) runs up to 120 `attritionTick`s over **the same live bodies** and
lays the dead down through the same `deaths.js`. The 3D and fast paths meeting in the middle of one
fight is, as `:1725-1728` says, the strongest available statement that they are one model. Measured
targets (`:1359-1366`): a 26 v 26 on real dunes ≈ 40 s rendered / 110 s resolved at `ARMY_MUL = 1.9`,
against the brief's *"60-120 seconds of real decisions"*.

### The autoresolve path
`W.battle.resolve(opts)` (`:1631-1701`, exported `:4517`). Same rosters, guns, armour, soak,
`moraleFrom`, `nerveFor`, `brokenSide`, `buildReport`. `apply:false` returns the report and changes
nothing.

**Same math as on screen?** Yes. `attritionTick` (`:1424-1619`) is the on-screen arithmetic with the
geometry removed, and the geometry is folded into one measured constant `ENGAGE = 0.045` (`:1368`),
derived by comparing a 26 v 26 on real dunes (10 dead in 54 s) against the raw ladder output ~338 HP/s
(`:1340-1348`).

**`W.odds` is not an autoresolver** — `core.js:932-935`, `r^1.6/(r^1.6+(1-r)^1.6)` clamped 1–99%, the
percentage the encounter card prints (`army.js:437-480`) and the shed factor on a loss (`army.js:385`).

The off-screen band-vs-band resolver is `resolveOneBandFight()`, called from `campaign.js:3405-3408` on
a `FIGHT_EVERY = 216 s` per-party budget — **gated on `C.simHost`, the broken flag from the headline.**

**`resolve()` had no caller for months and was broken three ways** — `CONTRACT.md:167-180` names all
three (routed men dropped out of `powerNow`; the warlord's +14 present in `power0` but not `powerNow`;
the warlord firing 23× a rifleman's rate folded into the side's *mean* damage per round). All three are
fixed at `battle.js:1439-1447`, `:1460-1471`, `:1491-1538`, and gate F (`warlord-cover-check.mjs:46-50`,
`:389-394`) keeps them honest.

**Two documents are stale about this.** `MULTIPLAYER.md:69-78` and `warnet.js:975-987` both still say
`resolve()` *"ends every fight on tick 2 with the player's whole line routed and zero casualties"*. `git
log` shows the docs commit `e449d14` landed **before** the fix commit `838eb8f` ("resolve() and start()
are one battle model again — the headless twin had never had a caller and was broken three ways"). A
reader currently believes human-vs-human fights are bloodless when they are not.

## A5. What is genuinely good and should be kept

1. **A man is an object, not a number** (`:657`, `:4258-4261`). Every good thing downstream — name
   chips, promotions, the wounded flag, prisoners — falls out of that one decision.
2. **One battle model, two presentations, with a probe enforcing it.** `brokenSide`, `moraleFrom`,
   `hurtOne`, `profOf`, `buildReport` shared; and `finishOnTheClock` literally runs the headless tick
   over the live bodies. Gate F is the guard. **Do not trade this away.**
3. **Morale derived from tables that already exist** — power fraction from `W.power`, break points from
   `combat_iq`'s `ROLE[].nerve`. This is why "who gets the good rifle" is a decision at all.
4. **Cover is the terrain**, and `hullDown` is publicly callable (`:4524`) so the probe asks the AI's
   own question rather than re-implementing it in node.
5. **Stance changes the hitbox.**
6. **The player is a body in his own line** — targetable, in the grid, his death worth −0.30 morale.
7. **Real engine reuse** — `combat_iq`, `fpsmode`, `gunfx`, `wounds`, `ragdoll`, `gore`, `character.js`.
   The list at `:27-44` is accurate.
8. **Every behaviour change ships with its own revert flag** — `?morale=old`, `?orders=old`,
   `?squads=old`, `?field=old`, `?deaths=old`, `?gunplay=old`, `?take=off`, `?tlos=0`.
9. **Formations as a perf strategy** — moving one section instead of ten men is why 600 bodies fit in a
   frame.

## A6. games/battle.html — the fork, quantified

**The memory note is exact: 29 function names are duplicated.** `games/battle.html` has 144 top-level
function declarations, `battle.js` has 122, and the intersection is **29** — matching
`pillar-npc-war-sandbox.md:158-159`.

The 29 (html:js): `blockedAt 1237:521 · camDist2 2798:3070 · cycleCam 4316:3147 · eyeLos 2745:1163 ·
fineNear 2560:909 · fireShot 2803:2496 · frame 4706:3972 · freeSpot 1275:552 · gridKey 2198:763 ·
hurtMan 1918:2591 · killMan 1926:2623 · makeMan 1593:633 · marchGoal 3194:1842 · mateInLane 2754:1169 ·
missImpact 2883:2548 · pickTarget 2241:806 · push2 2378:855 · rebuildFine 2320:847 · rebuildGrid
2199:795 · retireOldestCorpse 2154:2697 · separatePass 2335:887 · separateSolve 2370:904 · spreadGoal
3254:1861 · stepCamera 4171:3074 · stepMan 3474:2719 · stepSinking 2183:2709 · terrainBlocked 2729:930 ·
think 3360:2328 · updateCOM 2685:3878`.

**Drift, measured by normalized-body diff:**
- **Byte-identical (4):** `gridKey`, `camDist2`, `fineNear`, `mateInLane` (22 lines identical including
  the 0.62 lane half-width and the 12 m reach clamp).
- **Near-identical, 2–13 differing lines (12):** `blockedAt`, `stepSinking`, `missImpact`, `pickTarget`,
  `separatePass`, `eyeLos`, `separateSolve`, `rebuildFine`, `terrainBlocked`, `rebuildGrid`,
  `spreadGoal`, `push2`.
- **Materially diverged (>20):** `updateCOM`(24), `retireOldestCorpse`(24), `hurtMan`(26),
  `fireShot`(30), `freeSpot`(31), `killMan`(72), `stepCamera`(90), `makeMan`(100), `think`(146),
  `stepMan`(224), `frame`(259).

**Two fixes each side got and the other did not:**
- `fireShot` — html:2877 multiplies every landed round by **1.45**; js:2544 does not (warlord applies
  its 1.9 army multiplier elsewhere and exempts rounds aimed at the player, `battle.js:1349-1367`). Same
  call, different game.
- Body separation — html:2312-2319 added `noteBodyRadius()`, sizing the fine grid cell off the widest
  body on the field, *"because a lion pair owes 2.6 m of clearance and the sweep was skipping exactly
  the pairs that mattered"*. `battle.js:843` still has the pre-fix constant `FINE = 2.4`. Latent, not
  live, for men-only armies.
- `hullDown`/`hullFor`/`workHull` (`battle.js:1023/1079/1116`) exist **only** in warlord; `battle.html`
  has zero hits and its only cover expression is `m.char.crouch = m.slot === "cover" || "peek"` at
  html:4886.

**Neither page loads the other.** `games/battle.html` has **0** occurrences of `warlord`.
`games/warlord.html:705` is the only loader of `src/warlord/battle.js` repo-wide. Each page has exactly
one `<script src>` (`battle.html:242`, `warlord.html:598`, both `core/studio.js`) and an inline
manifest.

**What IS shared:** the 19-entry `ARMOURY` is byte-identical between `battle.html:488-501` and
`warlord.html:655-673` — `systems/combat_iq.js` (17 call sites in html, 33 in js), `gunfx.js`,
`actorweapons.js`, `wounds.js`, `weapon-data.js` + 13 appearance files — plus the `ragdoll` studio pack.
`warlord.html:616-621` says so outright. **What is copy-pasted:** everything between `combat_iq` and the
page — all 29 names above. This is exactly `pillar-npc-war-sandbox.md:186-189`.

**The unification proposal exists and is unimplemented.** `pillar-npc-war-sandbox.md:147-164` (§6, "THE
THREE MODES ARE ONE GAME") and `:190-211` propose `src/battle/` + three doors (WATCH / FIGHT / ROOMS),
with a four-step wave at `:224-241` starting with extracting `src/battle/men.js`. **`src/battle/` does
not exist**; the only references to that path in the repo are lines 194, 226 and 231 of the plan doc.
The doc is explicitly ungated — `:145` *"The owner said 'we will consider'"* — and §6's title is "when
the owner says go". (`docs/plan/recon-mode-unification.md` is unrelated: 618 lines about the
jail/gang-city melee resolvers, 0 hits for `battle.html` or `warlord`.)

## A7. Part A defects

- **Cavalry never enters a battle.** `mounts.js` is 2427 lines with a full `M.battle` API — `attach()`
  after `makeMan` (`:885`), `charge()` (`:802`), a damage router (`:755`), `step/stepAll` (`:913`), an
  absolute charge speed (`:682`). `battle.js` mentions "mounts" once, in an unrelated comment (`:2912`).
  Repo-wide `W.mounts.*` has exactly one caller: `sand.js:1329` asking `mountedN()` for dust. The file's
  own header calls cavalry *"the battle's biggest hole"* (`mounts.js:16`) and it is still the hole.
- **`move` has no keyboard binding** while the other five orders do (`:4433-4443`).
- **`MULTIPLAYER.md:69-78` and `warnet.js:975-987` describe a fixed bug as live.**
- **The body-separation grid fix never came back from `battle.html`** (§A6).

---

# PART B — THE MULTIPLAYER

## B1. What multiplayer IS today

### On paper
`CONTRACT.md:255-268`, `warnet.js:1-118`, `MULTIPLAYER.md:41-78`: one seed, one room code, every human a
warlord seat on the same island, spawned on his own golden-angle bearing, the clock never pausing, peers
drawn as bands, alliances a real handshake, a human fight decided in one exchange.

### In the code — a second player sees exactly four things
1. **A dot that is another player.** `peerBands()` (`warnet.js:576-586`) synthesises a band per peer
   from `W.state.peers` with `men: []`; `campaign.js:2545-2547` draws it through the same instanced
   bodies and banner as an AI column.
2. **A roster row** in the room screen (`warnet.js:866-905`) with name, men, power and a RIDE AT HIM
   button.
3. **Alliance offers/accepts/refusals/breaks** — `match.js`'s four verbs `wla/wlay/wlan/wlab`
   (`match.js:1128-1149`).
4. **A human-vs-human fight**, three packets (§B2).

That is all of it.

### Co-op? PvP? Shared state? — **None of the above. Each client runs its own island.**

- **`campaign.js`'s sim-host flag is never set from the network.** `campaign.js:151` `C.simHost =
  !FLAG_GUEST` where `FLAG_GUEST` is `?guest=1` (`:131`). The setter `C.setSimHost` (`:3713`) has **zero
  callers repo-wide**. The header at `:146-150` promises *"warnet.js flips it false on a guest and this
  file becomes a renderer"*. It does not. Every connected client therefore has `C.simHost === true` and
  independently runs band goals (`:3217`), band ground-follow (`:3302`), off-screen band-vs-band fights
  (`:3405-3407`) and band respawn (`:3411`).
- **No world snapshot is ever sent.** `snapshot/snapshotTo/onSnapshot` (`warnet.js:1158-1160`) have zero
  callers. `warnet.js:357-361` claims *"match.js hangs its own catch-up snapshot off onJoin and sends it
  with snapshotTo()"* — `match.js:1184-1188`'s `onJoin` calls `adoptPeer` and `sendRoster`, and
  `sendRoster` sends only `{ally, wait}` (`match.js:1107-1109`).
- **No territory is replicated.** `T.setOwners` (`territory.js:1040-1046`) is captioned *"for match.js
  and warnet.js"* and has zero callers. `territory.js` contains **no `simHost`/`isHost` gate at all**,
  so `warDawn()` (`:1349`) flips provinces on every client independently.
- **`match.js` is the only subsystem that gates correctly.** Its `isHost()` (`match.js:1090-1095`) goes
  through `W.warnet.simHost()`, which *is* wired (`warnet.js:1134`, `!ACTIVE || isHost()`), so column
  raising (`match.js:427`, `:600`) and roster broadcast (`:991`) really are host-only — broadcasting
  alliance standing over a world the two clients no longer agree about.

**So two players share the seed and then diverge, permanently, within seconds.** They see the same
geometry, the same 14 rival warlords, the same outposts and the same *initial* 444 parties. Party
positions, fights, deaths, respawns and province ownership are all locally rolled thereafter.

### Who is authoritative for a battle?
For a human-vs-human fight: **the challenger**, for a stated and correct reason (`warnet.js:919-933`) —
`resolve()` is asymmetric (your warlord stands in your own line, +14 power, takes the "you went down"
exit), so two clients each running it as mine-vs-them can **both** come away having won. One machine
computes; both apply, by soldier id. For everything else: every client is authoritative for its own
copy, which is the same as nobody being.

### Two players in different places
Nothing special — and note there is no interest management, scoping or relevance, because each client
already generated the whole island.

### Does the campaign clock sync? **Once, then never.**
- `setWorld`/`applyWorld` (`warnet.js:440-511`) carries `{seed, day, hour}`; `:504` sets them.
- After that each client runs its own clock: `W.dawn()` (`core.js:410-413`) is *"the only place the day
  advances"*, driven locally; `S.hour` from `campaign.js:2063`.
- `pushSelf` **does** send `d: S.day` at 4 Hz (`warnet.js:536`) — and the receiver (`warnet.js:391-402`)
  reads `m.nm, m.x, m.z, m.n, m.pw, m.x2` and **never reads `m.d`**. The day is sent four times a second
  and thrown away.

Since `territory:dawn` drives alliance answers (`match.js:1165`) and column raising (`:955-995`),
drifted clients run diplomacy on different days.

## B2. The protocol

```
warnet.js  (warlord verbs)     → one relay verb "wl", sub-verbed by `v`
net.js     (client)            → t: hello/welcome/join/leave/host/state/world/ev/chat/sys/deny
rooms.js   (relay, in a tab)   ↕ the SAME verbs over a WebRTC DataConnection
server/server.js (relay, node) ↕ the SAME verbs over a WebSocket
```
`warnet.js:40-42`: *"All warlord traffic rides ONE relay verb… so nothing this game ever adds can
collide with a city verb."* Accurate, and a good decision.

### Transport messages (`rooms.js:264-300`, mirrored `server/server.js:837-935`)

| `t` | direction | reliability | note |
|---|---|---|---|
| `hello` | client→relay | must arrive | first message or the connection closes (`rooms.js:217-218`) |
| `welcome` | relay→client | reliable | `{id, hostId, feat, server, players[]}` (`:250-257`) |
| `join`/`leave` | relay→all | reliable | `:258`, `:154` |
| `host` | relay→all | reliable | election result (`:146-150`) |
| `state` | client→all | **shedable** | relay stamps `m.id = p.id` (`:266`) |
| `world` | host→all | **shedable** | **refused from anyone who is not `hostId`** (`:269-271`) |
| `ev` | client→all or `to` | reliable | `RESERVED_EV` guard on the wrapped form (`:272-291`) |
| `chat` | client→all | reliable | `/me /do /ooc /players /help /kick /announce` (`:167-201`) |
| `sys`/`deny` | relay→client | reliable | |

`wsave/csave/wload/cload` are **dropped** in a room (`:280-285`) — a tab has no disk; `FEAT = ["to"]`
(`:96`) vs server.js's `["to","persist"]`.

### Warlord `wl` sub-verbs

| verb | from → to | payload | rate |
|---|---|---|---|
| `hi` | any → one/all | `{nm, n, pw}` | on welcome + per join (`warnet.js:429-431`) |
| `world` | host → one/all | `{seed, day, hour}` | once + per join (`:361`, `:436`) |
| `snap` | — | — | **never sent** (`:1159`, 0 callers) |
| `wlwl` | host → all | `{ally[], wait[]}` | on join + on standing change (`match.js:1107-1109`) |
| `wla`/`wlay`/`wlan`/`wlab` | peer → peer | `{from, to}` | on a player action (`match.js:809,824,847,869`) |
| `wlfc` | challenger → defender | `{s, army[]}` — **full roster** | once/fight (`warnet.js:954`) |
| `wlfa` | defender → challenger | `{s, army[]}` — **full roster** | once (`:965`) |
| `wlfr` | challenger → defender | `{s, outcome, theirDead[ids], myDead[objs]}` | once (`:991-996`) |

### Rate, payload, backpressure
- **The only periodic traffic is the player's own dot.** `startPump` (`warnet.js:522-525`) is **one
  `setInterval` at 250 ms = 4 Hz**, deliberately not a per-frame hook so single player pays nothing.
  Reasoning at `:520-521`: at a rider's pace, 4 Hz is under three metres between updates on a 14 km
  island.
- **Payload:** `{t:"state", nm, x, z, n, pw, d}` + an `x2` extras bag (`:530-544`); positions rounded to
  0.1 m, power to 0.01 → roughly **80–110 B per player per tick, ~400 B/s per player**. The one
  registered `selfExtra` provider in the repo is the wardrobe fit (`wardrobe.js:1959-1965`).
- **The fight exchange is the only large payload.** `wireSoldier` (`:935-938`) is 10 fields ≈ 110 B; a
  300-man band ≈ 33 KB, a 750-man army ≈ 82 KB, reliable lane, **once per fight**. Fine as a one-shot;
  not fine at any rate.
- **Backpressure:** shed `state`/`world` over 64 KB queued (`net.js:55`), 256 KB in a room
  (`rooms.js:102` — half server.js's 512 KB, because an RTCDataChannel dies sooner than a node socket,
  `:98-101`). Reliable `ev` is never dropped.

### Topology, host, leaving, reconnect, late join, spectate
- **Star, through one player's browser.** `startHost` (`rooms.js:472-523`) opens a PeerJS peer at
  `cbz-<CODE>`, runs `makeRelay()` inside the tab, and joins **itself through a loopback connection
  object** (`:487-492`) deferred by a microtask so a welcome can never arrive inside the caller's own
  `send()` frame. Nice work: the relay never learns one of its players is itself.
- **Two different "hosts", and they are not the same thing.** The **room owner** holds the peer and the
  relay; the **sim host** is `pickHost()` = oldest `joinedAt` (`:141-145`), re-elected on leave
  (`:155`). They coincide at first, so the distinction never shows — until it does.
- **When the host leaves, the room dies.** `sock.close` (`:562-568`) calls `relay.closeAll("The room
  owner left.")` and destroys the peer. There is migration of the *sim host role* and none of the
  *room*, and the sim host role currently drives nothing (§B1). `MULTIPLAYER.md:100-102` says so
  honestly.
- **Reconnection: none.** `net.js:212` closes; `net.js:173-181` `onclose` clears the player table, emits
  `_offline`, and stops. No retry, no backoff, no resume. `warnet.js:382-385` turns that into a toast
  and calls `goOffline()` (`:315-321`). (The historical `goOffline` crash noted in session memory — it
  called a deleted function — is fixed; the current body is clean.) The one piece of resilience: a
  *broker* disconnect is reconnected quietly, because live DataChannels are peer-to-peer and only new
  joins need the broker (`:517-522`).
- **Reconnect dedupe does exist relay-side** — a stable `pid` from `localStorage` (`warnet.js:209-217`)
  lets the relay evict your ghost (`rooms.js:227-236`): *"if it was the sim host — the island stays
  frozen behind a dead tab."*
- **Late join works and is cheap.** Seed and clock are re-sent (`warnet.js:361`, `:436`) and the island
  rebuilds from 4 bytes. `warnet.js:332-346` replays the `welcome` roster as `join` events so both ends
  build the same table from the same hook — a real bug found and fixed (the guest never adopted the
  host).
- **Spectate: does not exist.** No verb, no read-only mode.
- **Interpolation: does not exist.** `warnet.js:391-402` writes `p.x = m.x` directly. `campaign.js:3007`
  damps on the draw side *"because snapshots arrive in lumps"*, but there is no dead-reckoning,
  extrapolation or prediction. At 4 Hz that is a peer dot that steps.
- **NPCs replicated: none.** Not the 444 parties, not the warlords' columns, not battle men (there is
  only ever one player in a `battle.js` instance).

## B3. The lobby

- `menuCard()` (`warnet.js:685-733`): name field, **HOST A ROOM**, **JOIN A ROOM**, and an "I RUN MY OWN
  RELAY" disclosure for `ws://`.
- HOST → `connect({url:"room:host"})`; the code arrives on `onCode` (`:283-288`) because rooms.js rolls
  it and re-rolls on collision.
- JOIN → `joinCard()` (`:739-779`), four characters. `cleanCode()` corrects case/spaces/dashes and
  **drops** `I 1 O 0` rather than substituting them (`rooms.js:74-88` — a silent substitution *"would
  turn a typo into a different valid code, which is how you join a stranger's room"*).
- `?room=CODE` joins on load, skipping the menu (`warnet.js:1087-1109`); `?net=host` opens one and
  publishes the code on `window.__room`; `?relay=URL`, `?name=X`, `?ride=1`, `?netlobby=1`.
- Share: `navigator.share` → clipboard → print-the-link (`:838-854`).
- Code space: 32⁴ ≈ **1.05 M** rooms (`rooms.js:63`).

### Max players: **8**
`rooms.js:110` `opts.maxPlayers || 8`, and nothing passes one — `warnet.js:277-299` sets
url/name/role/roomName/onCode/onError and no `maxPlayers`; `net.js:198-201` forwards an `undefined`.
server.js's default is 16 (`server/server.js:35`). A ninth gets `{t:"deny", reason:"This room is
full."}` and the socket closed (`rooms.js:220-224`).

### Broker dependency and failure modes
PeerJS's public broker (`0.peerjs.com`, no account) is used **only** to exchange the two SDP blobs
(`rooms.js:31-36`); after that traffic is peer-to-peer and the broker is out of the path — a live room
survives the broker going down, it just cannot admit new players. `assets/vendor/peerjs.min.js` is
vendored locally (92,865 bytes, present), so the library is not a CDN dependency.

Every failure has a written, actionable sentence (`brokerText`, `:553-560`): broker unreachable, code
not held (*"Nobody is holding room XXXX. The room lives in the owner's tab"*), no WebRTC, taken code
(auto-rolls 5×, `:509-512`), 25 s connect timeout (`:455-459`). **Symmetric NAT on both ends fails** —
STUN only, PeerJS's Google default; the TURN seam is `CBZ.iceServers` or `<meta name="cbz-ice">`
(`:329-349`), documented `MULTIPLAYER.md:111-120`.

### Matchmaking, lobby list, bots, countdown, win condition, social — **none**
- No public lobby list, no server browser, no matchmaking, no region buckets. The only discovery is a
  human reading four characters aloud.
- No bots-to-fill. The island *does* carry 14 AI warlords (`match.js:206 WARLORD_N_DEFAULT = 14`) and
  ~444 parties, so an empty room is not an empty world — but they do not fill seats.
- No countdown, no auto-start, no ready-up. RIDE OUT is per-player and the clock never waits
  (`MULTIPLAYER.md:43-45`, `warnet.js:58-63`).
- **No shared win condition and no score.** Deliberate and recent: `match.js:8-27` is the tombstone for
  a deleted 2,448-line match layer — an 8-slot lobby, a 20-minute wall clock, a full-screen SCOREBOARD,
  a territory-over-time sparkline, a domination victory check and an endgame screen. Owner's verdict,
  quoted `:17-18`: *"THIS IS WARLORD MODE, board is dumb except ally shit is useful if it's a real
  accept deny."* Nothing replaced it.
- **Social verbs: alliances only.** Offer/accept/refuse/break (`match.js:1145-1148`), carried by a rider
  so an answer takes a day (`ANSWER_DAYS`, `:196-199`), expiring by silence at `OFFER_DAYS`. **Betrayal
  is modelled and it costs**: every column the betrayed warlord owns goes to maximum appetite for good,
  and every *other* warlord reads your betrayal count (`BETRAYAL_MEMORY = 3`, `:99-106`, `:203-205`).
- **Chat exists on the transport and is not surfaced.** The relay handles `t:"chat"` with seven commands
  (`rooms.js:167-201`), `net.chat()` parses them (`net.js:96-110`), `src/net/netui.js` renders them —
  but `netui.js` is **not in `games/warlord.html`'s script list** (`:684-707`) and nothing in
  `warnet.js` calls `net.chat`. **No chat, no ping, no emoji in this game today**, though the whole
  stack under it is written and tested.

### Dead/stale wiring in the multiplayer layer
- `campaign.js:1895` calls `W.warnet.engage(peer)` — no such export (`warnet.js:1074-1167`). Tapping
  another human on the campaign map falls through to `W.toast("riding at " + name)`. The *contact* path
  does work: `campaign.js:3619-3621` calls `W.warnet.fight(b.peerId)`, which exists.
- `feel.js:1475-1476` listens for `warnet:meet` and `warnet:duel` — neither is emitted anywhere; both
  belonged to the 390-line fallback block deleted at `warnet.js:1038-1069`.
- `warnet.js`'s header (line 107) advertises `warnet:world`; the emit is `warnet:on` (`:507`). Nothing
  listens, so nothing breaks — the header is wrong.

## B4. Measured

`uptime` at the start: `load averages: 13.89 12.63 10.00`. Re-checked at 9.05, then **6.58** — under the
8 the brief set.

```
$ node tools/test-rooms.mjs
ROOMS OK — 1250 checks. The room protocol matches server/server.js's, in a tab.
real 0.076s
```

**PASS, 1250 assertions, 76 ms.** `makeRelay()` is genuinely pure — connection objects with `{send,
close, buffered}`, no DOM, no WebRTC, no timers (`rooms.js:48-52`) — which is why the whole room
protocol tests in plain node with no browser and no internet. This is the best-tested piece of the stack
by a wide margin, and it tests the layer least likely to be wrong.

`warlord-net-check.mjs` was **not run** (load never under 4; it spawns two devservers and two Chromes
each cold-booting a 14 km island — `warlord-net-check.mjs:30-33` calls its own budget "generous"). Its
nine assertions (`:20-28`) are a statement of what the authors believe multiplayer is: both reach
`campaign`, equal seeds, one elected host, each sees the other in `W.warnet.peers`, each sees the other
as a band, identical seed-derived warlord rosters, non-identical spawn footprints, an alliance offer
arrives, and a second state frame arrives 250 ms later.

**Note what those nine do NOT assert:** that any *band* is in the same place on both clients, that any
*province* has the same owner, or that the *day* matches. The check is green and the world is not
shared. It cannot catch §B1 because it never asks.

## B5. VERDICT — why this is thin next to a drop-in io game

Against openfront.io / territorial.io (100 players, public lobbies filling in seconds with bots, one
shared deterministic sim, alliances and betrayal, ~20-minute matches, spectate, replays):

1. **There is no shared simulation.** `C.setSimHost` has zero callers (`campaign.js:3713`), no world
   snapshot is ever sent (`warnet.js:1158-1160`), and `territory.js` has no host gate at all. Everything
   below is downstream of that one missing line.
2. **Only the player dot is on the wire** — 4 Hz, ~100 B (`warnet.js:522-547`). Zero NPCs, zero
   provinces, zero events.
3. **The day clock is handshaked once and never resynced**, and the `d` field that *is* sent 4×/s is
   read by nobody (`:536` vs `:391-402`).
4. **8 players, hard** (`rooms.js:110`, unparameterised). io games start at 50.
5. **No discovery whatsoever** — no lobby list, matchmaking, region or quickplay. The entire funnel is
   one human reading four characters to another. For a browser game that is the difference between a
   game and a demo.
6. **No bots-to-fill and no countdown**, so a room of one is a room of one.
7. **No shared win condition, no score, no match end** — deliberately deleted (`match.js:8-27`) and
   never replaced. There is nothing two humans are *competing over* that the game will ever adjudicate.
8. **No spectate, no replay.** Neither has a verb.
9. **No chat, ping or emoji surfaced**, though the full stack exists and is tested (`rooms.js:167-201`,
   `net.js:96-110`, `netui.js` unloaded).
10. **The room dies with the owner's tab** (`rooms.js:562-568`). Sim-host migration exists (`:141-155`)
    and migrates a role that drives nothing.
11. **No reconnection at any layer** (`net.js:173-181`). A phone that locks loses the game.
12. **The public PeerJS broker is a hard single point of failure for joining**, and
    symmetric-NAT-on-both-ends simply does not connect without TURN nobody is paying for
    (`rooms.js:41-46`).
13. **No interpolation on peer positions** (`warnet.js:391-402`) — a stepping dot.
14. **The one real PvP interaction is three packets and no fight.** `wlfc/wlfa/wlfr`
    (`warnet.js:949-1015`) is a correct, well-reasoned exchange — but neither player *plays* it. You
    press RIDE AT HIM and read a result.
15. **Nine green assertions describe a shared world that does not exist**
    (`warlord-net-check.mjs:20-28`).

### What this architecture could become cheaply

The good news is real and it is mostly about what is already true:

- **The world is already 4 bytes.** `warnet.js:49-56`: 14 km of analytic sand from one integer, and
  `W.makeBand` driven off core's seeded stream, so every client generates the same parties with the same
  men — asserted by `warlord-net-check` #6. This is the expensive half of a lockstep design and it is
  **done**.
- **`match.js` already refuses to touch `W.rnd`** for everything derived (`:108-117`) and gates its one
  impure call on the host. The determinism discipline exists and is written down.
- **The relay already enforces host authority on `t:"world"`** (`rooms.js:269-271`, mirrored in
  server.js). A guest cannot forge a world tick. The check is written, on the server, and unused.
- **`W.battle.resolve()` is a pure, seeded, machine-independent function** (`battle.js:1631-1701`, fixed
  and gate-F-guarded) — exactly the primitive a host-authoritative campaign needs to settle a fight in
  one tick.
- **The room protocol is pure and tested in node** (1250 assertions, 76 ms).

**Cheapest real fix, in order:**

1. **Wire the switch that already exists.** One line in `warnet.js`'s `welcome`/`host` handlers:
   `W.campaign.setSimHost(isHost())`. That alone stops guests inventing their own bands and makes
   `campaign.js`'s existing gates mean something. It will immediately expose the second half — guests
   get a *frozen* island rather than a *divergent* one, which is the honest intermediate state.
2. **Send the snapshot the API already declares.** `warnet.snapshot()` exists; `territory.setOwners()`
   exists to apply it in bulk. A full host tick at 2–4 Hz carrying `{bands:[{id,x,z,size,mood}],
   own:{regionId:ownerId}}` for 444 parties is ~15–20 KB/tick uncompressed — too much against the 256 KB
   shed threshold at 4 Hz over WebRTC. So it wants a **delta** (only bands that moved a metre, only
   provinces that flipped) or **scoping by distance**. Both are ordinary, and the `to`-relay for
   per-guest scoped snapshots already exists (`net.js:116-120`, `rooms.js:272-279`).
3. **Read `m.d`** — three lines to keep the day in step, or better, derive the day from a host-stamped
   epoch so it cannot drift at all.
4. **Delete or implement `W.warnet.engage`** (`campaign.js:1895`) and the two dead `feel.js` listeners.
5. **Correct `MULTIPLAYER.md:69-78` and `warnet.js:975-987`** — they describe a bug fixed in `838eb8f`.

**What would break — full lockstep is NOT cheaply available and should not be attempted.** `campaign.js`
steps bands on real `dt` with a distance-stepped far clock, and lockstep needs a fixed tick. The 3D
battle is seeded but frame-rate dependent (`battle.js:3769`) and cannot be made cross-machine
deterministic cheaply — `resolve()` can and already is. `warnet.js:68-75` argues against a synchronised
3D battle at length and the argument is correct: *"the failure is not 'slightly out of sync', it is one
player watching men die who are still alive on the other screen."* And float determinism across browsers
is not free in a codebase using `Math.hypot`, `atan2` and trig everywhere.

**The honest target is host-authoritative with a delta snapshot, not lockstep.** The seed handshake
already gives the free half. What is missing is a ~2 Hz delta and the one line that says who is allowed
to author it — and everything needed to write both is already exported, documented, and uncalled.

