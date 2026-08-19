# APP-STORE-PLAN — the staged roadmap to the App Store

Owner's call (2026-08-19): **four games ship — NPC War, Prison Escape, Natural
Disaster now, and Gang City (full open world) as the eventual flagship.** Gun
Game does NOT ship as its own app; it stays a mode inside Gang City. Researched
August 2026 against Apple's current rules (sources at the bottom).

## The waves

| Wave | App | What it is in this repo | Why this order |
|---|---|---|---|
| 0 (first) | **NPC War** | `games/battle.html`, standalone | Real release AND the lowest-stakes pipeline guinea pig |
| 1 | **Prison Escape** | `index.html` forced into `escape` mode | Complete game with an arc; the original |
| 1 | **Natural Disaster** | `index.html` forced into `survival` mode | Distinct genre (BR survival), tamest rating |
| 2 (later) | **Gang City** | `index.html` city mode — the whole world, gun game + co-op inside | Ships when the open world is ready; biggest app, worst perf case, needs the most polish |

### Why NPC War goes first
It's a full release in its own right, and putting it first derisks everything
after it for almost no effort:
- It exercises the **entire pipeline** — Capacitor wrapper, Xcode 26 build,
  App Store Connect record, privacy label, new age questionnaire, review — on the
  app you care least about. A rejection or a WKWebView surprise costs nothing here.
- It's a **different genre** (spectator battle sim) with its own name and look, so
  it establishes your account shipping *varied* games before the two same-engine
  games arrive — the opposite of a 4.3 spam pattern.
- It already boots straight into its own menu and has touch orbit/pinch; the only
  work is on-screen buttons for its keyboard verbs (pause, 1–5 speed, front cam)
  and bundling.
- As a free app it doubles as a demo pointing at the others ("from the maker of…" in the
  description is fine; do NOT build it as a launcher that downloads the other
  games — that's guideline 4.7 territory).

### 4.3 (spam) risk under this staging: low
Only Prison Escape and Natural Disaster share obvious DNA, and they look and play
nothing alike (prison stealth-sim vs. disaster battle royale). Space those two
~1–2 weeks apart, give each its own boot (no shared mode-chooser title screen),
distinct icons/names/screenshots/descriptions, and this is a normal small-studio
catalog. Gang City arriving months later as the big open-world game is the least
suspicious thing on the account.

### Gang City notes for wave 2 (decide nothing now, but know these)
- It inherits the **max rating of everything in it**: casino (simulated gambling —
  frequent → 18+, infrequent side-venue → 13+ answer) + gore/guns ⇒ expect
  **16+–18+**. Fine for a flagship.
- It's the **heaviest mode** — the WKWebView memory unknown bites hardest here.
  The wave-1 apps are the cheap way to learn the real device budget first.
- Multiplayer lives here (city JOIN card). Before it ships with co-op, the relay
  needs a real `wss://` host with a valid cert, live during review (guideline
  2.1) — a trycloudflare tunnel must never ship. Or ship v1 offline-only.
- **Naming: no "GTA" anywhere** — app name, subtitle, keywords, screenshots.
  Take-Two litigates and Apple rejects trademark-adjacent metadata (5.2).
  "Gang City" / "Cell Block Z" are fine.

---

## Phase 0 — Prerequisites (once, covers every wave)

- [ ] **Mac + Xcode 26.** Since **April 28, 2026 Apple rejects any upload not
      built with the iOS 26 SDK (Xcode 26+)**. Also applies to updates of your
      existing 3 apps.
- [ ] Apple Developer membership active ($99/yr — already have).
- [ ] Public **privacy policy URL** (one page for all apps; GitHub Pages is fine).
      Mandatory even for zero-collection apps; saves are on-device localStorage,
      so it's three sentences.
- [ ] Node ≥ 22 (repo already requires it); Capacitor 8 when wrapping starts
      (it requires exactly the Xcode 26 / iOS 15+ Apple now mandates).

## Phase 1 — Repo work

### Shared (do once)
1. **Bundle the Fredoka font.** `index.html:8-10` pulls it from Google Fonts —
   the tree's only network dependency. Download woff2 → `assets/fonts/`, local
   `@font-face`. (Fallback stacks exist, but the UI font silently changes offline.)
2. **Boot-mode flag** for the index.html-based apps: a `BOOT_MODE` config — the
   `?cfg_*` URL-override plumbing already exists (`src/config.js:564`) and
   `src/systems/state.js:19` owns the mode buttons. Auto-select the one mode,
   hide the other cards and the city-only JOIN card (`src/net/netui.js`). Test in
   a desktop browser as `?cfg_BOOT_MODE=escape` / `=survival` before any wrapping.
3. **Verify persistence under the Capacitor scheme** (`capacitor://localhost`):
   localStorage is fine; the sqlite-wasm worker uses fragile relative string paths
   (`src/net/sqlitedb.js` → `importScripts`) that Vite was specifically configured
   around. If the built bundle fights the wrapper, plan B is bundling the raw tree
   (it runs from a dumb static server by design).
4. **Device pass on the oldest iPhone you care about.** WKWebView WebGL is
   Metal-backed and fine, but there's no published memory ceiling before WebKit
   kills the page — this is the one unknown research can't settle. Perf levers
   already exist (`?cfg_CITY_SHADOW_MODE=off`, `core/quality.js` tiers) — default
   mobile to a conservative tier. Verify audio starts after the first menu tap.

### Per app
- **NPC War** (wave 0): touch buttons for pause / speed 1–5 / front cam
  (`games/battle.html:3818`); start page = `battle.html`; done.
- **Prison Escape** (wave 1): `BOOT_MODE=escape`. Keep city casino/gambling
  unreachable — it's not part of escape mode, verify nothing routes there
  (matters for the age questionnaire).
- **Natural Disaster** (wave 1): `BOOT_MODE=survival`. The disaster island builds
  through survival's own build — already self-contained.
- **Gang City** (wave 2): city mode as-is; gun game and every venue stay as modes
  inside it. Separate planning pass when the open world is ready.

## Phase 2 — Wrap: one Capacitor project per app

Per app (~an hour each once the first works — which is why NPC War goes first):

```bash
mkdir npc-war-ios && cd npc-war-ios
npm init -y && npm i @capacitor/core && npm i -D @capacitor/cli && npm i @capacitor/ios
npx cap init "NPC War" com.efoltyn.npcwar --web-dir=www
# copy the game tree into www/ with the right start page + BOOT_MODE
npx cap add ios && npx cap sync && npx cap open ios
```

In each Xcode project:
- [ ] Explicit bundle ID `com.efoltyn.<game>` (registered in the developer portal).
- [ ] `ITSAppUsesNonExemptEncryption = NO` (plain HTTPS/WSS is exempt; skips the
      export-compliance questionnaire every build).
- [ ] Orientation lock as the game wants; status bar hidden.
- [ ] **iPhone-only for v1** (skips mandatory iPad 13" screenshots and layouts).
- [ ] No ATS exceptions; wave-1 apps ship offline-only.
- [ ] 1024×1024 icon per game, genuinely distinct art.

## Phase 3 — App Store Connect per app

Create the app record (name, bundle ID, SKU), then:

- **Metadata** — written from scratch per app: description, keywords, support +
  privacy URLs, screenshots. 2026 spec: **iPhone 6.9" — 1320×2868** portrait
  (2868×1320 landscape), 1–10 images; smaller sizes auto-derive. The repo's
  `tools/visual-compare.mjs` rig can stage gameplay moments.
- **Privacy label**: "Data Not Collected" (Capacitor adds no collectors by
  default) — still must be filled in per app.
- **Age rating** (new 4+/9+/13+/16+/18+ questionnaire, in force since Jan 31 2026
  — answer honestly; misrating risks removal):

  | App | Content | Likely rating |
  |---|---|---|
  | NPC War | stylized army-men battle deaths | **13+** |
  | Natural Disaster | disaster deaths, some combat | **13+** |
  | Prison Escape | shanks, guns, blood/gore | **16+–18+** |
  | Gang City (later) | all of it + casino | **16+–18+** |

  Hard rule: "prolonged graphic or sadistic realistic violence" is **unrateable**
  (cannot ship) — keep gore brief and stylized in Prison Escape.
- **EU trader status**: declare non-trader (free hobby apps) or the apps are
  removed from all EU storefronts; monetizing later flips this to trader.
- No Game Center needed; no loot-box odds disclosure (no IAP).

## Phase 4 — TestFlight & submission calendar

1. **TestFlight internal** per app (no review, minutes after upload) → device pass.
2. **Submit NPC War** → learn from its review while wave-1 repo work finishes.
3. **Submit Prison Escape**; **~1–2 weeks later, Natural Disaster** (the only two
   with shared-engine optics — the spacing plus distinct boot/branding covers 4.3).
4. Review: Apple says 90% within 24h; budget 1–3 days each. Any 4.3 flag →
   App Review Board appeal with concrete gameplay differences, don't blind-resubmit.
5. **Gang City** gets its own submission pass in wave 2 (plus multiplayer
   backend requirements above if co-op ships).

## Cost & timeline

- **Cost**: $0 beyond the existing $99/yr (free apps, no commission).
- **Wave 0+1 realistic wall-clock: ~3–5 weeks** — shared repo work (2–4 sessions),
  first wrapper (~a day, on NPC War), then store setup (~2–3h/app) and the
  Prison↔Disaster spacing. Gang City: months, on its own schedule.

## Top risks, ranked

1. **WebGL memory on older iPhones** — the wave-1 gate; test on device before
   store work. Wave-1 modes are lighter than city, which is exactly why they go first.
2. **Prison Escape age rating** — stylized-vs-realistic violence answer swings
   13+ vs 18+; answer honestly, trim gore duration if it drags the rating.
3. **4.3 spam flag on Prison/Disaster pair** — low with staging + distinct
   branding; appeal path known.
4. **sqlite worker paths under Capacitor** — known-fragile; raw-tree bundling is plan B.
5. **Trademark hygiene for Gang City** — zero "GTA" in any metadata, ever.

## Sources (verified Aug 2026)

- Xcode 26 / iOS 26 SDK mandate since 2026-04-28: developer.apple.com/news/?id=ueeok6yw · developer.apple.com/news/upcoming-requirements
- App Review Guidelines (2.1 backend live, 2.5.6 WebKit, 3.1.1 loot boxes, 4.2, 4.3, 4.7, 5.2): developer.apple.com/app-store/review/guidelines
- New age-rating tiers + definitions (in force since 2026-01-31): developer.apple.com/news/?id=ks775ehf · developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions
- Privacy labels + policy URL mandatory: developer.apple.com/app-store/app-privacy-details
- Export compliance / ITSAppUsesNonExemptEncryption: developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance
- EU DSA trader status (removals since 2025-02-17): developer.apple.com/news/?id=einwn76m
- Capacitor 8 / 8.5 (Xcode 26 requirement): ionic.io/blog/announcing-capacitor-8 · capacitorjs.com/docs/main/reference/support-policy
- Screenshot sizes 2026 (6.9" 1320×2868; iPad 13" 2064×2752 if iPad): appscreens.com/app-store-screenshot-sizes
- Review times: developer.apple.com/distribute/app-review (90% < 24h) · runway.team/appreviewtimes
