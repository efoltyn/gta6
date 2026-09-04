# APP-STORE-PLAN — seven games, one engine, one account, no spam flag

> **Wave 2.** Owner's call 2026-09-04: these are browser games, so the web
> portals go first — see `GO-TO-MARKET.md` (ship order NPC War → Natural
> Disaster → Cell Block Z, `full`/`portal` build profiles, the web build tool).
> This doc is the native wrapper for the games the portal numbers pick. The
> dossier in §1 and the plumbing in §3 are reused by the web builds; the
> cross-cutting blockers now live in `GO-TO-MARKET.md` §2.

Rewritten 2026-09-04 from a code-level dossier of every game in the repo. The
August plan (four apps, NPC War first) is superseded: two games landed since
(Shark Sim, Desert Warlord), a seventh turned out to be a full game
(Bomb Survivor), and the App Store Connect account has **zero** records for any
of them yet (it holds three unrelated apps: Flatliner!, Take Fleet Rider, Take
Fleet Driver). Nothing from this repo has ever been archived or uploaded from
this Mac: `dist-ios/`, `apps/disaster-ios/ios/` and `ios/App/App/public` do not
exist, and `@capacitor/*` is not installed in `node_modules`.

## 0. The one decision: separate apps, and why it is not spam

Apple's 4.3 has two halves (fetched 2026-09-04):

- **4.3(a)** forbids *multiple Bundle IDs of the same app* — one map app per
  city, one flashlight per colour. The test is "would a user be confused which
  to install". Six different genres (BR survival, spectator battle, campaign
  strategy, stealth-sim, predator sim, open-world crime) fail that test in the
  right direction. Every Unity studio ships its whole catalogue on one engine.
- **4.3(b)** rejects apps *indistinguishable from what's already widely
  available*. This is the half that actually bites here, and it bites two
  specific apps: **Shark Sim** (Hungry Shark, dozens of "shark simulator"
  clones) and **NPC War** (TABS, "battle simulator" clones). Those two have to
  lead with what no clone has — an orca pod that hunts *you* and a growth
  ladder to megalodon; uncapped armies with a nuke run and "8 orcas v 1
  megalodon" matchups — in name, subtitle, first screenshot and first sentence.

What makes a reviewer *feel* spam is cosmetic and sequential, not the shared
engine: the same title-card template with a MORE GAMES strip advertising the
other six; the same icon style; descriptions that read like a mail-merge;
five uploads from a fresh-looking account in one week. So the rules are:

1. **Each app boots straight into its own game.** No mode chooser, no MORE
   GAMES strip, no `data-href` buttons to sibling games, no "from the maker
   of" *inside the binary* (fine in the store description).
2. **Own name, own icon language, own palette, own screenshot style.** The
   dossiers show the studio-page games (NPC War, Warlord, Bomb Survivor) already
   have distinct chrome; the `index.html` games share the Fredoka pill HUD and
   must be told apart by *subject* in screenshots (underwater vs. volcano vs.
   prison yard at night).
3. **One submission at a time, at least 7 days apart; the island pair
   (Disaster ↔ Shark) at least 14 days apart** — they share the same beach,
   sky and crowd rig and will look like reskins side by side.
4. **Descriptions written by hand per app**, no shared boilerplate sentence.

A single "arcade" app was considered and rejected: it forfeits per-game
discovery (the whole point of "any of them could be 100k"), inherits the max
rating of everything in it, and its payload is Gang Life's — the one build
that does not run on a phone yet.

## 1. The seven, as they actually are (dossier, 2026-09-04)

| App | Door | Engine files at boot | Touch today | Loop / ending | Rating (new tiers) | Pipeline state |
|---|---|---|---|---|---|---|
| **Natural Disaster Survival** | `disaster.html` (generated) | 98 of 575 tags, 3.6 MB JS + 25 MB assets | complete, no keyboard-only verb | 100-player BR vs 11 hazards; last alive; runs/wins/best persisted | **18+** (trauma gore; GO-IOS already commits to it) | Furthest: own Capacitor root, icon/splash, privacy manifest, measured slice, `check:ios` oracle. **Never executed on this Mac; `disaster.html` is STALE (drops `water_stability.js`, `sea_craft.js`).** |
| **NPC War** (battle sim) | `games/battle.html` | studio packs + 15-file armoury; local three.js; system fonts | orbit/pinch + on-screen PAUSE/¼-8×/AUTO CAM (shipped 2026-08-09, plan said it was missing); no touch camera *pan* | spectator: setup → battle → ledger; 10 maps, presets, FIND MY MAX | **13+** (blood pack off for man-vs-man; nuke) | Nothing built. `test:battle` oracle exists. |
| **Desert Warlord** | `games/warlord.html` | ~57 files (studio + armoury + 20 `src/warlord/*`), 42.5k own LOC, no fonts, no fetch | full FPS thumb cluster + map pinch + verb rail; keyboard-only: battle orders 1–5, M/Q/E on campaign, speed nudge | hours-long campaign, hold 80% of provinces; single-slot save | **18+** (prisoner executions) | Nothing built. 10 `warlord-*` oracles. MULTIPLAYER button reaches `0.peerjs.com` + Google STUN; headless `battle.resolve()` kills nobody. |
| **Bomb Survivor** | `games/bomb-survivor.html` | studio, 14 packs | (unverified) | 6v6 asymmetric: fly the B-2 over downtown; two 3-min halves | 13+/16+ (bombing runners; civilians −250) | Nothing built. Ship **inside NPC War** as its second mode, not as an eighth submission. |
| **Cell Block Z** (prison + Gun Game) | none — `index.html` mode `escape`; prison is built at *parse time* so every index boot builds it | needs its own slice (no `prison-check` minimizer oracle yet); ~15k mode LOC | complete (door taps, verb pills, touch title grid); no pause button; rob pill sometimes suppressed | escape any tier = win; 3 captures = tier up; Gun Game 9-rung ladder | **18+** (shanks, gore, drugs as items) | Nothing built. `build-disaster-page.mjs` hardcodes `survival`. 9 `prison-*` oracles. |
| **Shark Sim** | none — `index.html` mode `sharksim`, delegates build to survival's island | survival's slice + ~12k marine LOC | complete: stick + DIVE/RISE; bite automatic; zero keyboard-only verbs | grow bull shark → hammerhead → great white → **megalodon**; orca pod is the only ending; nothing persists but the camera choice | **18+** (limb severing is the designed fantasy, `creature_combat.js:1209-1240`) | Nothing built. `check:sharksim` + 4 shark tests boot `index.html` only. |
| **Gang Life** | `index.html` mode `city` | all 569 tags, 58 MB copy-through | full ledger, but phone/inventory/map/City Power/Zillow/switch-character are keyboard-only on the title legend; pointer-lock-gated paths are false forever on iOS | open world, permadeath ON, 12 origins, heists to BANK JOB | **18+** and gambling is *frequent* (every casino lot, sportsbook, races) | Committed Xcode shell, never built. **Blocked on memory**: 456 MB heap + 563 MB geometry vs ~1–1.4 GB iOS budget; owner's phone already jetsammed at 99%; 12–30 s synchronous `startRun` freeze; the three perf levers sit on an unmerged branch, default OFF. |

Old "17+" language in `apps/disaster-ios/GO-IOS.md` is the pre-2026 scale;
Apple's tiers since 2026-01-31 are 4+/9+/13+/16+/18+. Frequent realistic
violence lands on **18+**. That costs nothing for these games; misrating
costs a removal.

## 2. Blockers that apply to every submission (do once, first)

1. **The slur dictionary.** `src/systems/custom_dialogue.js:17` defaults
   `BADWORDS_UNCENSORED = true` and its RAW map (`:36-43`) plus `custom.env`
   carry racial and homophobic slurs that render in on-screen dialogue via
   `src/city/street_talk.js`. That is a 1.1 rejection and a reputational
   event, not a rating question. The store build must pin
   `CBZ.CONFIG.BADWORDS_UNCENSORED = false` in the generated page and never
   copy `custom.env`. (The disaster slice already drops both files; the
   prison and city builds do not.) Web deploy stays the owner's call.
2. **`"Grand Theft Auto"` is a rendered HUD string** — `src/city/wanted.js:92`
   and `:112` label two crimes with it. Rename to "Auto Theft" / "Carjacking".
   ~60 code comments say "GTA" and ship byte-for-byte in copy-through builds;
   harmless to review but strip from any minified bundle anyway.
3. **`childsafe.js` was dropped from the disaster slice** by the minimizer
   (the game "still runs" without it). Either prove no child actor can spawn
   in survival/sharksim, or `pin` it in `tools/disaster-slice.json`. Harm to
   children on screen is an instant rejection regardless of rating.
4. **MORE GAMES strip + sibling doors** (`index.html:299-337`,
   `state.js:352-388` "BACK TO THE STREETS", `state.js:402` `data-href`
   navigation) must not exist in any single-game page. `build-disaster-page`
   already replaces the strip; generalise it (§3) so every page gets the same
   treatment.
5. **Privacy policy URL** (one static page, three sentences: no data
   collected, saves on device, no third parties). Mandatory even at zero
   collection. Warlord's MULTIPLAYER changes the answer (see its card) — hide
   it in v1.
6. **iPhone-only for v1** on all apps (`TARGETED_DEVICE_FAMILY = 1`). Gang
   Life's committed plist currently declares iPad orientations; that makes
   13" iPad screenshots mandatory (`ship` will refuse the submit). Add iPad
   in an update.
7. **Toolchain**: `npm install` (Capacitor 8.5 is a devDependency but
   absent), Xcode 26.0.1 is installed and is `DEVELOPER_DIR` in
   `~/harness/env`. Only that Xcode may touch a project's `build/`
   (see `~/harness/ship/RELEASING.md`).
8. **Every app's `PrivacyInfo.xcprivacy` must be a target member** — a file
   on disk that isn't added in Xcode ships nothing and the upload is rejected
   with no useful message. `tools/setup-ios.mjs` copies it; the target
   membership is the one manual click per app.

## 3. The plumbing: one layout, one page generator, six shells

The disaster app already has the right shape. Copy it, don't invent a second.

```
apps/
  disaster-ios/      com.efoltyn.naturaldisastersurvival   (exists)
  npcwar-ios/        com.efoltyn.npcwar        (battle.html + bomb-survivor.html)
  warlord-ios/       com.efoltyn.desertwarlord
  cellblockz-ios/    com.efoltyn.cellblockz    (escape + gungame)
  shark-ios/         com.efoltyn.sharksim      (name TBD, see card)
  ganglife-ios/      com.efoltyn.ganglife      (move the root shell here)
```

Each dir: `capacitor.config.json`, `Info.plist.additions`,
`PrivacyInfo.xcprivacy`, `art/`, `store/en-US.md` + `store/screenshots/`,
`.harness.env` (`APP_BUNDLE_ID`, learned ids). The generated Xcode project
lives in `apps/<x>/ios/` and stays gitignored, like disaster's. **Gang Life's
committed `ios/App` moves under `apps/ganglife-ios/`** so the repo has one
convention, not "one committed shell at root and five generated ones". The
`ship` tool takes `--repo apps/<x>`, finds the `.xcworkspace` under it, and
reads that dir's `.harness.env` — six apps from one repo needs no harness
change.

Tool work, in order (each is a generalisation of something that exists):

1. `tools/build-disaster-page.mjs` → `tools/build-game-page.mjs --mode
   <survival|sharksim|escape> --title "…" --logo "…" --out <page>.html
   --manifest tools/<mode>-slice.json`. Same stripping, same
   `window.CBZ.START_MODE`, plus: pin `BADWORDS_UNCENSORED=false`, drop the
   MORE GAMES strip to zero cards, remove `data-href` buttons and the city
   hand-off. Keep `disaster.html` as its first output so nothing regresses.
2. `tools/disaster-minimize.mjs` → takes `--oracle <check.mjs>` so
   `prison-check` (compose from the nine `prison-*-check.mjs`) and
   `shark-sim-check.mjs` can measure their own slices. Shark's slice ≈
   survival's ∪ marine files; measure it, don't guess. Re-run survival's
   search too — index.html grew 553 → 575 tags since 2026-08-21 and the
   manifest was patched by hand once.
3. `tools/build-ios.mjs` → `--page <html> --out dist-ios/<app>`; for the
   studio pages (`games/*.html`) the manifest is the page's own pack arrays +
   `ARMOURY` + `WARLORD` lists resolved through `src/core/studio.js`, plus the
   lazy loads (`systems/gore.js`, `net/rooms.js`, `assets/vendor/peerjs.min.js`).
   Bundle + minify exactly as disaster does; `document.currentScript` shim
   already handles path-relative files.
4. `tools/setup-ios.mjs` and `tools/make-app-art.mjs` → take `--app
   apps/<x>`; art becomes a per-app painter (one function each — the disaster
   one is 45 lines of palette + shapes).
5. `npm run check:ios` → per app: `check:ios:<x>` boots the built
   `dist-ios/<x>/www/index.html` and runs that game's oracle. **The oracle
   runs against the bundle, never against `index.html`**, or the bundle ships
   untested.

Estimated: the generator/minimizer/bundler generalisation is 1–2 sessions;
each additional shell after the first is ~an hour plus its oracle run.

## 4. Launch order and why

> Superseded for the web by `GO-TO-MARKET.md` §4 (NPC War → Disaster → Cell
> Block Z). The table below is the App Store order once those builds exist;
> the spacing rules still stand.

| Wk | Ship | Why this slot |
|---|---|---|
| **1** | **Natural Disaster Survival** | The owner's favourite *and* the most finished pipeline. Running it end-to-end (build → device → TestFlight → review) is less work than building NPC War's from scratch, and every later app inherits what the review teaches. Its 18+ rating is the same answer five of the seven will give, so learn it here. |
| **2** | **NPC War** (with Bomb Survivor as mode 2) | Different genre, different chrome, 13+/16+: the account now shows range, the opposite of a 4.3 pattern. First studio-page bundle proves that path for Warlord. |
| **3** | **Desert Warlord** | Second studio page (an hour once NPC War's bundler works), own palette and title, campaign genre nothing else on the account has. |
| **4** | **Cell Block Z** | The strongest `index.html` game with the oldest test suite; needs the prison slice oracle (§3.2), which is the biggest piece of new tooling. |
| **5** | **Shark Sim** | ≥14 days after Disaster because it is Disaster's island from underwater. Screenshots: underwater and the megalodon only, never the beach from above. |
| later | **Gang Life** | Blocked on device memory, not on store work. Ship when a 30-minute session on the oldest target iPhone survives with the perf branch merged and touch defaulting to quality tier 0–1. Months, on its own clock; the five earlier apps are how you learn the real device budget for free. |

Submitting one per week is the *minimum* spacing, not a target; if a review
comes back with questions, the next submission waits until it is resolved.
Never blind-resubmit a 4.3: appeal with the concrete gameplay differences in
§1 (they are real).

## 5. Per-app cards

### Natural Disaster Survival — `apps/disaster-ios/` (exists)
- Do: `npm install` → `npm run build:disaster` (STALE now) → `node
  tools/disaster-minimize.mjs --verify` (post-Aug-21 waves) → decide
  `childsafe.js` (§2.3) → `npm run build:ios && npm run check:ios` and
  **write the measured bytes/ms/heap into `LOAD-NOTES.md`** (none exist for
  this app; the 24.9 MB figure is a projection) → `(cd apps/disaster-ios &&
  npx cap add ios) && node tools/setup-ios.mjs` → Xcode: PrivacyInfo target
  membership, signing → the 8-box device checklist in GO-IOS.md, especially
  30 fps with 99 bots, the volcano and tsunami, and backgrounding (GL
  context loss).
- Cosmetic: the survival controls card still prints Tab "Rankings" and F/R
  "Fire · reload" — neither exists in this build.
- Store: name as-is; subtitle "100 players. 11 disasters. Last one alive.";
  screenshots = volcano, tsunami bore, tornado, sinkhole, the ELIMINATED
  placement card. Rating 18+ (Frequent/Intense Realistic Violence). Data Not
  Collected.

### NPC War — `apps/npcwar-ios/` (new)
- Do: studio-page bundler (§3.3); a two-button landing page inside `www/`
  (NPC WAR / BOMB SURVIVOR) — both pages are in the binary, so 4.7 does not
  apply; add a **two-finger camera pan** (the only verb still mouse/WASD
  only); `npm run test:battle` against the bundle; device memory at 200 v 200
  (no unit cap by design — corpse retirement at 420, shadows off above 170
  bodies, render-scale floor 0.6 already exist).
- 4.3(b) defence in metadata: "no army cap", FIND MY MAX, "8 orcas v 1
  megalodon", "100 men v a gorilla", NUKE RUN, ten real maps. Name it for
  that, not "Battle Simulator".
- Rating: 13+ if the `blood` pack stays off for man-vs-man (it is, unless
  `?blood=1` or a beast army); 16+ if beasts count. Answer the questionnaire
  from `games/battle.html:863-867`.

### Desert Warlord — `apps/warlord-ios/` (new)
- Do: bundle (~57 files + lazy gore); **hide MULTIPLAYER in v1** (button is
  unconditional at `warlord.html:1224`; PvP resolves with zero casualties
  anyway — `battle.js:1275-1307`) so the privacy label stays "no data" and
  no `0.peerjs.com`/STUN call exists; touch equivalents for battle orders
  1–5 and campaign M/Q/E; guard the 5 MB localStorage save ceiling
  (`campaign.js:511-557`); verify first-gesture audio unlock under WKWebView.
- Rating 18+ (staged execution of surrendered prisoners drives it). Name
  and subtitle already exist on the title: "ONE MAN · ONE PISTOL · FOURTEEN
  KILOMETRES OF SAND".

### Cell Block Z — `apps/cellblockz-ios/` (new)
- Do: prison slice oracle + page (§3.1–2), start mode `escape` with the
  `gungame` card kept as the only other tile (two-mode app); cut BACK TO THE
  STREETS and the city hand-off; pin profanity off; a touch pause button;
  fix the suppressed ROB pill (`intimidate.js:492`); run the nine
  `prison-*` oracles + `gungame-quiet-check` + `touch-hud-check` on the
  bundle. Prison is parse-time built, so the slice is mostly "drop the city".
- Rating 18+. Drugs are inventory items (Pills, Powder, Pruno) — answer
  "references" honestly. Name is the game's own logo; keep it.

### Shark Sim — `apps/shark-ios/` (new)
- Do: `--mode sharksim` page; slice = survival ∪ marine (measure); its own
  view-chooser card already exists and is the first screen (fix the
  webdriver/`?seed` heuristic at `shark_sim.js:1528-1535` so a deep-linked
  player still gets it); device pass at `SEA_CAP 170` plus surface slicks
  (flagged as unbounded per-frame cost in `gore.js:772`).
- Rating decision: 18+ as designed (limb severing lingers 9–20 s), or pin
  the sever gate off for 16+. Recommendation: keep the design, ship 18+ —
  it is the mode's entire fantasy per the code comment.
- **Name it for the differentiator** ("Shark Sim" is the most crowded label
  on the store): the orca pod hunting you and the megalodon ladder go in the
  name/subtitle. Owner picks the name; bundle id can stay `sharksim`.

### Gang Life — `apps/ganglife-ios/` (move from root)
- Not a store task yet. Gate: merge the PERF-NOTES branch (`LOCAL_INSTANCING`,
  shadow mode, ped LOD), default `CBZ.touchMode` to quality tier 0–1
  (`quality.js:83` locks Medium today), then a real-device session on the
  oldest target iPhone that survives 30 minutes and a background/foreground.
  Only then: slur pin, wanted-label rename, MORE GAMES strip, touch for
  phone/inventory/map/City Power/Zillow/switch-character, a Gang Life icon
  (the committed one is the prison "cell window" mark), casino decision
  (keeping it = Frequent Simulated Gambling, 18+), iPhone-only plist.
- Multiplayer stays out of v1 (needs a live `wss://` host during review).

## 6. Store presence (per app, written separately)

- **Screenshots**: 6.9" 1320×2868, 1–10. Stage with the existing
  `tools/visual-compare.mjs` rig (device frames + `--devices/--orientations`),
  one subject per app: volcano · 500-man line · dune firefight · yard
  searchlights at night · megalodon from below.
- **Icon**: one painter function per app in `make-app-art.mjs`; five
  different silhouettes (island+wave, two army lines, a dune with a rider,
  barred window, a fin from below). Never the same mark twice.
- **Metadata**: hand-written description per app, ≤30-char name, no "GTA",
  no sibling app links inside the binary. "From the maker of Natural Disaster
  Survival" in a description is fine from wave 2 on.
- **Privacy label**: Data Not Collected on all six (verified per dossier:
  no outbound host in any build once Warlord's MULTIPLAYER is hidden).
- **EU trader status**: non-trader (free, no IAP) — declare it or the apps
  are pulled from EU storefronts.
- **Age questionnaire**: answered per §1 table; keep the answers in each
  app's `store/en-US.md` so updates don't drift.

## 7. What "done" looks like per app

`ship --repo apps/<x> go --yes` exits 0 and a receipt lands in
`~/harness/out/gta6/`. Before that command is allowed: the app's oracle passed
against the *bundle*, the device checklist is ticked in its GO-IOS, and the
previous app's review is closed.

## Sources
- App Review Guidelines 4.2 / 4.3 / 4.7, fetched 2026-09-04:
  developer.apple.com/app-store/review/guidelines
- Age tiers since 2026-01-31: developer.apple.com/news/?id=ks775ehf
- iOS 26 SDK mandate since 2026-04-28: developer.apple.com/news/?id=ueeok6yw
- Harness release traps: `~/harness/ship/RELEASING.md`
- Per-game facts: dossiers 2026-09-04 (file:line cited inline above)
