# CLAUDE.md

Browser GTA-style game. Three.js r128 (vendored), plain script tags in
`index.html`, one global `CBZ`, ~264k LOC. No build step — GitHub Pages serves
the repo root of `main`, so **pushing to main IS the deploy** and anything in
`src/`/`assets/` ships.

**Read `docs/claude/` before working — all of it is binding:**

- `doctrine.md` — WHY constitution, hard rules (determinism, flags), Block Law + ratchets
- `verification.md` — math gate, probes, builders-vs-orchestrator, headless facts
- `engine-systems.md` — shared systems: REUSE, never re-invent
- `sessions.md` — dated wave reports and measured ratchets
- `gpt-handoffs.md` — GPT diagnostics, open issues 28–121
- `project.md` — deploy details, doc map

Also `GAMEPLAN.md`, `docs/plan/`, `PROCGEN.md`.

## THE MODE ENUM IS NOT A CAPABILITY CONTRACT — `CBZ.modeHas()`

**GANG CITY IS THE ENGINE AND THE ASSET FARM** (owner, 2026-08-06). Prison
(`escape`), Gun Game and Natural Disaster (`survival`) are SCENARIOS wearing it,
per the Rome Test. A shared engine verb must therefore never ask *which
scenario is running* — it asks for the capability:

```js
CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city"   // adopt like this
```

`src/systems/modecaps.js` owns the table (`traverse` · `stepLedge` · `blast` ·
`blastActors` · `breach`), the mode's live actor roster (`CBZ.worldActors`), the
damage switchboard (`CBZ.hurtWorldActor` → `aiKill` / `gungame.hurt` /
`surv.hurt` / `cityKillPed`) and the shared blast coupling
(`CBZ.blastWorldActors`). Flag `MODE_CAPS_V1=false` restores the old city-only
answer at every site at once.

**WALLS BREAK EVERYWHERE; THE PERIMETER DOESN'T.** `city/buildings.js`
`carveHole` opens real walk-through holes with sill/header/flank remnants and a
lit room behind; `city/fracture.js` owns the ledger (24 holes, plywood
eviction, coordinate-stable persistence, net broadcast) and `chewWall` (25
rifle rounds in a 1.2 m cell = a murder hole). None of it reads a city record.
A wall opts OUT with **`noBreach` on its collider** — that one flag on
`world/yard.js`'s `wall()` helper is the entire policy keeping the prison an
escape game rather than a jailbreak sandbox. A collider with no `y0`/`y1`
derives its band from `c.ref`'s bounds, so pre-contract walls are carvable
without editing the world files.

**The rule this file exists to enforce:** `mode === "city"` is legitimate when
it guards a CITY RECORD (`cityCars`, `city.arena`, the wanted ladder, the
world-state ledger, the fracture/structural chain) and is a BUG when it guards a
shared verb. Two shipped examples of the bug, both fixed 2026-08-06: an RPG
outside the city produced a camera shake and nothing else, and nobody outside
the city could vault a chair — while the prison's own mess tables already
registered exactly the `y0/y1` + `ref` colliders the vault probe wants.

**`CBZ.cityExplosion` is a WRAPPER CHAIN, not a function.** Six files hang city
couplings on it and they stay installed for the session. Detonate through
`CBZ.cityBlastCore` outside the city — same fireball, damage, sound and shake,
none of the city bookkeeping. Wrap `cityExplosion`; never wrap `cityBlastCore`.

Ratchet: `CBZ.modeCapsAudit().unrouted` — modes declared blast-capable whose
people a blast cannot reach. **Pinned at 0** in `tools/math-gate.mjs`.
