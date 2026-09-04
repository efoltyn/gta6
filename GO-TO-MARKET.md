# GO-TO-MARKET — browser games go where browser games are played

Owner's call, 2026-09-04: **web first, App Store second. Ship order: NPC War →
Natural Disaster Survival → Cell Block Z.** Then Warlord, Shark, Gang Life on
the same rails. `APP-STORE-PLAN.md` is now wave 2 (the native wrapper for
whichever games the portals prove), and the per-game dossier in its §1 is
still the code-level truth; this doc does not repeat it.

## 0. Why this beats the App Store as the first move

- The games already deploy: push to `main` **is** the web release
  (`https://efoltyn.github.io/gta6/`). There is no build, no review, no
  signing, no 4.3.
- The portals pay for traffic you don't have to buy. Poki has ~90 M monthly
  players; CrazyGames runs a two-stage launch (Basic without SDK, Full with)
  and pays monthly over €100.
- Your own domain is the best-paying channel by their own rules: Poki pays
  **100 %** of revenue for players who arrive via your links and **50 %** for
  players Poki sends. The portals are the funnel; the site is the till.
- **Roblox is not on the list.** It only runs Luau written in Roblox Studio;
  putting any of these there is a rewrite, not an upload.
- The App Store stays valuable for the winners: it is the one channel with
  no ads and no portal cut, and the wrapper work in `APP-STORE-PLAN.md` §3
  reuses every web build below byte-for-byte.

## 1. The channels and what each one demands

| Channel | Pays | Takes | The rule that bites here |
|---|---|---|---|
| **Own site** (GitHub Pages, later a domain) | 100 % of whatever you put on it; 100 % of Poki revenue for own-link players | anything | none; it is the 18+ / full-gore home |
| **itch.io** | you set the cut (default 10 %); can sell | anything, any rating | zip with `index.html` at root; day-one home for every game |
| **Newgrounds** | ad share, $50 minimum payout | adult content with a rating | almost nothing |
| **CrazyGames** | ~60 % of ad revenue, 70 % of purchases (2026 jam terms), monthly via Tipalti over €100 | **PEGI 12**, initial download ≤ 50 MB, total ≤ 250 MB, ≤ 1500 files, "land directly in gameplay" | Basic Launch needs no SDK; Full Launch (earning) needs the SDK + `gameplayStart` |
| **Poki** | 50/50 on Poki traffic, 100/0 on yours | playable in **< 10 s**, desktop + mobile + tablet, scales to 16:9 (640×360 / 836×470 / 1031×580), **all external requests blocked**, localStorage in try/catch, SDK required, no outgoing links, no ad timers, no IAP | curated and invite-heavy; the 10-second bar decides who gets in |
| GameDistribution / GamePix / GameMonetize | aggregator ad share to 2000+ small portals | PEGI 12-ish, small builds | long tail; submit the CrazyGames build unchanged |
| Steam (Electron shell, $100 fee) | premium sale, 70 % | anything | later, for Warlord / Gang Life if they earn it |

Two facts fall out of that table and drive everything below:

1. **Ads are the paycheck on a portal.** "No ads" holds on your own site and
   in the App Store; on Poki/CrazyGames the ads are theirs, served by their
   SDK at pause/end-of-round plus optional rewarded videos. Accept it there.
2. **PEGI 12 is a build switch, not a design change.** Dismemberment,
   executions, drug items and the slur dictionary are out on Poki/CrazyGames
   and fine on Newgrounds/itch/own site. So every game gets **two builds from
   one source**: `full` and `portal`, differing only in pinned flags.

## 2. Before anything ships (once, this week)

These four are rejections on every portal and in every store; they are the
first engineering task and they are small.

1. **Slur dictionary off in every build.** `src/systems/custom_dialogue.js:17`
   defaults `BADWORDS_UNCENSORED = true`; RAW (`:36-43`) and `custom.env`
   carry racial/homophobic slurs rendered by `src/city/street_talk.js`. Every
   generated page pins it `false` and never copies `custom.env`. The raw
   `index.html` on the site is the owner's call; the shipped games are not.
2. **`"Grand Theft Auto"` rendered on the HUD** — `src/city/wanted.js:92,112`.
   Rename ("Auto Theft" / "Carjacking"). Trademark bots crawl portals too.
3. **No page inside a portal iframe may link to the hub.** `index.html`'s
   MORE GAMES strip and `data-href` doors (`src/systems/state.js:402`), the
   prison's "BACK TO THE STREETS" (`state.js:352-388`). Poki: "remove
   outgoing links"; CrazyGames: "land directly in gameplay".
4. **`childsafe.js` was dropped from the disaster slice** by the minimizer
   (`tools/disaster-slice.json`). Pin it or prove no child actor spawns in
   survival/sharksim. Harm to children on screen is a rejection everywhere.

## 3. The web build tool (one, measured, reused by all seven)

Two shapes of game, one output shape: a self-contained folder that runs from
`file://`, from an iframe, and from a zip, with zero external requests.

- **Studio pages** (`games/battle.html`, `bomb-survivor.html`,
  `warlord.html`): they load files at runtime through `src/core/studio.js`
  pack arrays, so a static manifest lies. Build it **by recording**: boot the
  page headless (the `tools/battle-check.mjs` rig already drives every map),
  run every map/preset/species/air-support combination, log every request,
  copy exactly that set. `tools/build-web-game.mjs --page games/battle.html
  --record tools/battle-check.mjs --out dist-web/npcwar --profile portal|full`.
- **index.html modes** (`survival`, `escape`, `sharksim`): the
  `build-disaster-page.mjs` → `disaster-minimize.mjs` → `build-ios.mjs`
  chain already produces exactly this folder (`dist-ios/www` is a web build
  with an iOS name). Generalise it per `APP-STORE-PLAN.md` §3.1-3 (`--mode`,
  `--oracle`, `--page`) and point `--out` at `dist-web/<game>/`.
- `--profile portal` pins the PEGI 12 flags (per game, §4); `--profile full`
  pins nothing but §2. Both pin `BADWORDS_UNCENSORED=false`.
- Output contract, asserted by the game's oracle **against the built folder**,
  never against the source page: boots, plays, zero requests off-origin,
  ≤ 50 MB initial / ≤ 1500 files for `portal`, measured **ms-to-playable**
  printed (Poki's 10 s bar).
- `dist-web/<game>/` also zips straight to itch.io and Newgrounds, and is the
  `www/` the App Store wrapper copies later.

## 4. Ship order and per-game cards

### 1 — NPC War (`games/battle.html` + Bomb Survivor as mode 2)

Why first: 13+ by default, a genre the portals already sell (battle
simulators are a top web category), own chrome, own menu, **no links out,
localStorage already try/catch-wrapped** (`:253, :821, :4474`; wrap the one
bare `setItem` at `:832`), on-screen PAUSE/speed/AUTO CAM shipped 2026-08-09,
touch orbit/pinch present. The only verb gap is a two-finger camera pan.

Portal profile: force the `blood` pack off (it already is for man-vs-man;
beast armies and `?blood=1` turn it on — `games/battle.html:863-867`), keep
the nuke (stylised), keep every matchup. That is PEGI 12.

"Land directly in gameplay": the setup screen *is* the game, but give the
first visit a default matchup already loaded and one big FIGHT button above
the fold; SETUP stays a tap away. Then a two-button landing (`NPC WAR` /
`BOMB SURVIVOR`) is the folder's `index.html`.

Steps: build tool (§3) → `dist-web/npcwar/` passes `test:battle` from the
folder → measure ms-to-playable → own site (clean URL, one landing page) →
itch.io + Newgrounds the same day (`full`) → CrazyGames **Basic Launch**
(`portal`, no SDK) → Poki submission (`portal` + Poki SDK stub:
`gameplayStart` on first input, `gameplayStop` on pause/menu/end,
`commercialBreak` on resume) → when CrazyGames invites, add their SDK for
Full Launch (`gameplayStart` on FIGHT, midgame ad at the result ledger,
optional rewarded video for FIND MY MAX or an extra matchup pack).

Metadata leads with what no clone has: no army cap, FIND MY MAX, NUKE RUN,
"8 orcas v 1 megalodon", ten real maps. Name it for that, not "Battle
Simulator".

### 2 — Natural Disaster Survival (`disaster.html`)

Why second: the most finished build chain in the repo and the owner's
favourite. `dist-ios/www` from `npm run build:ios` **is** the web folder.

Facts to act on: `disaster.html` is STALE (missing `water_stability.js`,
`sea_craft.js`); the slice was measured 2026-08-21 at 553 tags and index has
575 — re-run `disaster-minimize.mjs`; 29 MB on disk (3.6 MB JS + 25 MB
assets, asset-dominated) fits CrazyGames' 50 MB; **no measured
ms-to-playable exists** — `check:ios` prints it, so the Poki question is
answered by running it once.

Portal profile: `SURV_TRAUMA=false` (`src/systems/disasters.js`), gore
renderer off, `childsafe.js` pinned. Deaths still happen (people are swept
away, buried, frozen); they are not dismembered. `full` keeps trauma on for
Newgrounds/itch/own site. Cosmetic: the controls card still prints Tab
"Rankings" and F/R "Fire · reload" which don't exist in this build.

Steps: `npm run build:disaster` → minimizer re-run → `npm run build:ios`
with `--out dist-web/disaster --profile …` → `check:ios` numbers into
`LOAD-NOTES.md` → own site + itch + Newgrounds (`full`) → CrazyGames Basic
(`portal`) → Poki only if ms-to-playable < 10 s on a mid laptop, else
progressive loading first (the boot meter already runs on a worker; the win
is splitting the 25 MB of assets so the island is playable before the
audio banks and far facades arrive).

### 3 — Cell Block Z (`index.html` mode `escape` + Gun Game)

Why third: the strongest index.html game with the oldest test suite (nine
`prison-*-check.mjs`), and it needs the one real piece of new tooling — a
prison slice oracle for the minimizer (§3). Prison is built at parse time,
so its slice is mostly "drop the city".

Rating reality: shanks, blood, drug items (Pills, Powder, Pruno Hooch —
`src/systems/economy.js:69-73`). `full` is 18+ → Newgrounds, itch, own
site. A `portal` profile is possible (gore off, drug items renamed to
contraband, shank stays as a non-graphic weapon) but is a design call, not a
flag; **ship `full` on the three open channels first** and decide the PEGI 12
cut from the numbers.

Steps: prison oracle + `--mode escape --keep-mode gungame` page → slice →
`dist-web/cellblockz/` passes the nine prison checks + `gungame-quiet` +
`touch-hud` from the folder → cut BACK TO THE STREETS + city hand-off → touch
pause button, fix the suppressed ROB pill (`intimidate.js:492`) → own site
+ itch + Newgrounds.

### Then, on the same rails

- **Desert Warlord**: studio page, ~57 files, no fonts, no fetch. `full` =
  18+ (staged prisoner executions); `portal` = executions become "the
  unwilling are sent away", gore off. Hide MULTIPLAYER in every build until
  `battle.resolve()` kills anyone (`src/warlord/battle.js:1275-1307`) — it
  also reaches `0.peerjs.com` + Google STUN, which Poki blocks outright.
  Touch: battle orders 1–5 and campaign M/Q/E still keyboard-only.
- **Shark Sim**: `--mode sharksim`, slice = survival ∪ marine (measure).
  `full` keeps the limb-severing fantasy (18+); `portal` pins the sever gate
  off (`creature_combat.js:1209-1240`). Name it for the orca pod and the
  megalodon ladder — "shark sim" is the most cloned label on every portal.
- **Gang Life**: own site only. 58 MB, 16.8 s to the title at phone-class
  CPU, ~450 MB heap. No portal will list it and Poki's 10 s bar is 7 s away
  even on desktop. It waits on the `LOAD-NOTES.md` work, not on marketing.

## 5. The site is the till

Because own-link players pay 100 % on Poki and the portals send people to
*your* game page, the site stops being a repo mirror and becomes the hub:

- One landing page per game at a stable URL (`/npcwar/`, `/disaster/`,
  `/cellblockz/`), each serving the `full` build. The hub (`index.html`) can
  keep its MORE GAMES strip — it is the one page allowed to link.
- A real domain before the first portal listing goes live (links in portal
  metadata are the ones that earn the 100 %).
- No analytics SDK, no cookies, no consent banner needed: nothing is
  collected. A three-sentence privacy page anyway; Poki asks for one the
  moment a game links out.

## 6. Cadence

| Week | Do |
|---|---|
| 1 | §2 blockers · web build tool · NPC War `full` + `portal` folders · own site landing · itch + Newgrounds · CrazyGames Basic |
| 2 | Poki submission for NPC War · Disaster: regen page, re-measure slice, build, record ms-to-playable · itch + Newgrounds + CrazyGames Basic |
| 3 | Disaster Poki (if < 10 s) or progressive loading · Cell Block Z prison oracle + slice |
| 4 | Cell Block Z `full` on own site + itch + Newgrounds · CrazyGames Full Launch SDK for whichever of the first two got invited |
| 5+ | Warlord and Shark on the same rails · App Store wave (`APP-STORE-PLAN.md`) for the games the portal numbers pick |

Done, per game: `dist-web/<game>/` exists, its oracle passed from that
folder, it is live at its own URL on the site, and it is uploaded to itch and
Newgrounds. Portal listings follow their own review clocks.

## Sources (2026-09-04)
- CrazyGames requirements: docs.crazygames.com/requirements/intro (≤ 50 MB initial, ≤ 250 MB, ≤ 1500 files, PEGI 12, two-stage launch)
- CrazyGames terms datapoint (60 % ads / 70 % purchases, Tipalti, €100): app.cinevva.com/guides/publish-game-crazygames
- Poki requirements: developers.poki.com/guide/requirements-quality (10 s, 16:9, external requests blocked, SDK events)
- Poki revenue rule (100 % own traffic / 50 % Poki traffic): sdk.poki.com
- Web game monetization data 2026: app.cinevva.com/guides/web-game-monetization
- Roblox runs Luau only: en.wikipedia.org/wiki/Roblox
