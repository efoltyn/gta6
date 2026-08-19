# APP-STORE-PLAN — Prison Escape, NPC War, Gun Game, Natural Disaster → iOS App Store

The full, actionable plan to ship four games from THIS repo as four native iOS apps,
alongside the three apps already on your account. Researched August 2026 against
Apple's current rules (every load-bearing fact sourced at the bottom).

## What the four games actually are in this repo

All four live in this one codebase. That's the plan's biggest advantage: one build
pipeline, four thin per-app configurations.

| App | What it is here | Boot path today |
|---|---|---|
| **Prison Game** | Cell Block Z "Prison Escape" mode | `index.html` → title screen → `data-mode="escape"` card |
| **NPC War** | Standalone battle sim | `games/battle.html` (loads `../src/...` files) |
| **Gun Game** | Weapon-ladder deathmatch (jail + disaster-island maps) | `index.html` → `data-mode="gungame"` card (`src/modes/gungame.js`) |
| **Natural Disaster** | Disaster Survival battle royale | `index.html` → `data-mode="survival"` card (`src/modes/survival.js`) |

Already working in your favor:
- **Fully static and offline-capable.** three.js is vendored (`src/vendor/three.r128.min.js`),
  no CDN scripts, whole tree ~64MB — far under any App Store size concern. The ONE
  external dependency is the Fredoka font from Google Fonts (`index.html:8-10`) —
  fix in Phase 1.
- **Touch controls exist** for the main game (`css/mobile.css` TOUCH_V2: fixed joystick,
  verb buttons, pinch); `battle.html` already has pointer-drag orbit + pinch zoom.
- **Multiplayer is optional.** The relay (`server/server.js`) only matters for the
  city co-op JOIN card; all four games play fully offline.

---

## Strategy decision: four separate apps, submitted spaced apart

Two ways to ship: four apps, or one "arcade" app with four modes. Go with **four
separate apps** — it matches your existing three, each game gets its own store
page/icon/search terms, and Apple's guideline 4.7 (HTML5 game *portals*) never
comes into play as long as each app bundles its own game files in the binary.

The one real review risk is **Guideline 4.3 (spam)**: same developer, four apps
sharing one engine. This is survivable — studios ship dozens of games — but it's
triggered by *reskins*: near-identical binaries + similar names/metadata submitted
in rapid succession. Mitigations (bake these into Phases 3–4):

1. Each app boots **directly into its own game** — no shared title screen showing
   the other modes. A reviewer opening "Natural Disaster" and seeing the same
   4-mode chooser as "Gun Game" is exactly what 4.3(a) describes.
2. Distinct names, icons, screenshots, descriptions, keywords — write each from
   scratch, no shared phrasing template.
3. **Space submissions ~1–2 weeks apart**, not all four in one week.
4. If one is rejected under 4.3 anyway: appeal to the App Review Board with the
   concrete gameplay differences (they are genuinely different games), or fall
   back to consolidating into one app — Apple's own suggested remedy.

---

## Phase 0 — Prerequisites (before any code)

- [ ] **Mac + Xcode 26.** Since **April 28, 2026 Apple rejects any upload not built
      with the iOS 26 SDK (Xcode 26+)**. If your existing 3 apps were last built
      earlier, their next updates need this too.
- [ ] Apple Developer membership active ($99/yr — you have this already).
- [ ] Node ≥ 22 (repo already requires it), plus `npm i -D @capacitor/core @capacitor/cli @capacitor/ios` when you get to Phase 2. **Capacitor 8** is current and requires exactly the Xcode 26 / iOS 15+ target Apple now mandates — aligned by design.
- [ ] A public **privacy policy URL**. One page covering all your apps is fine
      (GitHub Pages works: e.g. `efoltyn.github.io/privacy`). Required even for
      "collects nothing" apps. If the games collect literally nothing (saves are
      localStorage-on-device), the policy is three sentences.

## Phase 1 — Repo work: make each game boot as its own app

This is the only real engineering. Everything is small.

### 1.1 Boot-mode flag (Prison / Gun Game / Natural Disaster)
Add a `BOOT_MODE` config (the `?cfg_*` URL-override plumbing already exists at
`src/config.js:564`) that:
- skips the mode chooser and auto-selects one mode card (`src/systems/state.js:19`
  owns the buttons — programmatically click the matching `data-mode` and hide the
  other cards), and
- hides city/multiplayer UI that doesn't belong to that game (the JOIN card in
  `src/net/netui.js` targets the city card only — verify it stays hidden).

Each iOS app then ships the same tree plus a one-line `boot.js` (or an edited
`index.html`) setting `CBZ.CONFIG.BOOT_MODE = "escape" | "gungame" | "survival"`.
Test in a desktop browser first: `?cfg_BOOT_MODE=escape` etc.

### 1.2 NPC War entry point
`games/battle.html` already boots straight into its own menu — it just references
`../src/...`, so the app bundle includes the same tree with `battle.html` as the
start page. Add touch controls for its few keyboard-only verbs (`3818`: SPACE
pause, 1–5 speed, F front cam) — on-screen buttons; the orbit/pinch camera already
works on touch.

### 1.3 Kill the last network dependency
Download Fredoka (woff2) into `assets/fonts/`, replace the Google Fonts `<link>`s
(`index.html:8-10`) with a local `@font-face`. Without this the apps still work
offline (system-ui fallback) but the UI font silently changes — bundle it.

### 1.4 Per-game trims (review-risk + polish, not size)
- **Prison app**: escape mode only; city casino/gambling content shouldn't be
  reachable (matters for the age-rating questionnaire — see Phase 3).
- **Gun Game app**: ships its two maps (jail arena + disaster island) — that's the
  game, fine as-is.
- Verify **saves** (localStorage / sqlite-wasm worker) work under the Capacitor
  scheme (`capacitor://localhost`) — localStorage persists per app; test that the
  sqlite worker's relative-path `importScripts` (`src/net/sqlitedb.js`) resolves,
  since Vite was already configured around exactly this fragility.

### 1.5 iOS device pass (the real unknown)
WKWebView runs the same WebKit as Safari and WebGL is Metal-backed, but there is
**no published memory ceiling before WebKit kills the content process** — a 120k-LOC
three.js world on an older iPhone is the one thing research can't settle. So:
- Test on the oldest iPhone you care about, not just a new one.
- The perf levers already exist (`?cfg_CITY_SHADOW_MODE=off`, quality tiers in
  `core/quality.js`) — default mobile apps to a conservative tier.
- Audio: WebAudio needs a user gesture — every game has a title/menu tap first,
  so this should already be satisfied; verify sound actually starts on device.

### 1.6 Build
Use the existing `npm run build` (Vite) output — it was specifically engineered to
keep string-path workers/assets intact — as the `webDir` for Capacitor. If the
built bundle fights the wrapper, plan B is to skip Vite and copy the raw tree
(it runs from a dumb static server by design).

## Phase 2 — Wrap: one Capacitor project per app

Per app (~an hour each once the first one works):

```bash
mkdir prison-escape-ios && cd prison-escape-ios
npm init -y && npm i @capacitor/core && npm i -D @capacitor/cli && npm i @capacitor/ios
npx cap init "Prison Escape" com.efoltyn.prisonescape --web-dir=www
# copy the built game tree into www/ with the right start page + BOOT_MODE
npx cap add ios && npx cap sync && npx cap open ios
```

In each Xcode project:
- [ ] Bundle ID `com.efoltyn.<game>` (4 new explicit bundle IDs in the developer portal).
- [ ] `ITSAppUsesNonExemptEncryption = NO` in Info.plist (plain HTTPS/WSS is exempt;
      skips the export-compliance questionnaire on every build).
- [ ] Landscape orientation lock if the game wants it; status bar hidden; viewport
      already handled by the game's CSS (`touch-action: none` etc. in `css/base.css`/`mobile.css`).
- [ ] **iPhone-only** unless you want to make iPad layouts + the required iPad
      screenshots (recommendation: iPhone-only for v1; iPad later).
- [ ] No ATS exceptions. If you ever wire multiplayer into an app build, the relay
      must be `wss://` behind a real cert — a trycloudflare tunnel is NOT a
      production backend and must not ship (guideline 2.1 requires the backend
      live during review). Recommendation: ship all four v1s offline-only.

App icons: 1024×1024 master per game, genuinely distinct art (4.3 mitigation).

## Phase 3 — App Store Connect: four app records

Per app: create the record (name, bundle ID, SKU), then:

**Metadata** — unique per app (4.3 mitigation): description, keywords, support
URL, privacy policy URL, screenshots. Screenshot spec (2026): **iPhone 6.9" —
1320×2868** portrait (or 2868×1320 landscape), 1–10 images; smaller iPhones are
auto-derived from 6.9". iPad 13" (2064×2752) only if you ship iPad. Capture real
gameplay on device/simulator — the repo's `tools/visual-compare.mjs` screenshot
rig can stage good moments.

**Privacy label**: "Data Not Collected" (assuming no analytics SDKs — Capacitor
adds none by default). Must still be filled in per app.

**Age rating — answer the NEW questionnaire honestly** (the expanded 4+/9+/13+/16+/18+
system is fully in force since Jan 31, 2026). Expected landing zones, given voxel/
stylized art but real shanking/guns/gore:

| App | Sensitive content | Realistic answer | Likely rating |
|---|---|---|---|
| Prison Escape | shanks, guns, blood/gore | violence "frequent"; argue stylized/cartoon if honest | **16+–18+** |
| NPC War | mass battle deaths | stylized army-men violence | **13+–16+** |
| Gun Game | gun combat, ragdolls | frequent weapon violence | **16+** |
| Natural Disaster | deaths by disaster | mild vs. other three | **13+** |

Two hard rules from Apple's definitions: "prolonged graphic or sadistic realistic
violence" is **unrateable** (can't ship at all) — keep gore brief/stylized; and
**frequent simulated gambling → 18+** — another reason the casino stays out of
these four apps (infrequent side-casino would be 13+, absent entirely is cleanest).

**EU trader status**: declare it or the apps are removed from all EU storefronts.
Free hobby apps can plausibly declare **non-trader**; monetizing later flips you
to trader (verified contact info published on EU pages).

No Game Center required. No loot-box odds disclosure (that only applies to
randomized items bought with real money — you have no IAP).

## Phase 4 — TestFlight, then staggered submission

1. **TestFlight internal** (your own devices, no review, minutes after upload):
   shake out WebGL/memory/touch issues per 1.5.
2. Optional external TestFlight (public link, first build per version goes through
   Beta App Review — currently 1–7 days) if you want friends testing.
3. **Submit in sequence, ~1–2 weeks apart.** Suggested order — strongest and most
   distinct first: **NPC War → Natural Disaster → Gun Game → Prison Escape**
   (NPC War is a different genre entirely; Prison Escape last gives you the most
   time on the heaviest world + touchiest age rating).
4. Review turnaround: Apple says 90% within 24h; plan 1–3 days each, more on a
   rejection. First response to any 4.3 flag: App Review Board appeal with the
   gameplay differences, not a resubmit.

## Cost & timeline

- **Cost**: $0 beyond the $99/yr you already pay (free apps, no commission).
- **Effort**: Phase 1 ≈ 2–4 focused sessions (boot flag, font, battle touch verbs,
  device pass); Phase 2 ≈ a day for the first wrapper, then an hour per clone;
  Phases 3–4 ≈ 2–3 hours per app of store setup + the staggered calendar.
  **Realistic wall-clock: 4–8 weeks to all four live**, dominated by the
  deliberate submission spacing.

## Top risks, ranked

1. **4.3 spam flag** (moderate, mitigable): distinct boot/branding/metadata + spacing. Fallback: appeal, then consolidate.
2. **WebGL memory on older iPhones** (unknown until device-tested): quality tiers exist; test early — this is the Phase 1 gate.
3. **Age rating on Prison Escape** (judgment call): stylized-vs-realistic answer changes 13+ vs 18+; misrating risks removal — answer honestly, trim gore duration if it drags the rating.
4. **sqlite-wasm worker paths under the Capacitor scheme** (small): known-fragile string paths; plan-B is raw-tree bundling.

## Sources (verified Aug 2026)

- Xcode 26 / iOS 26 SDK mandate since 2026-04-28: developer.apple.com/news/?id=ueeok6yw · developer.apple.com/news/upcoming-requirements
- App Review Guidelines (2.1 backend live, 2.5.6 WebKit, 3.1.1 loot boxes, 4.2, 4.3, 4.7): developer.apple.com/app-store/review/guidelines
- New age-rating system (13+/16+/18+, in force since 2026-01-31) + definitions: developer.apple.com/news/?id=ks775ehf · developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions
- Privacy labels + policy URL mandatory: developer.apple.com/app-store/app-privacy-details
- Export compliance / ITSAppUsesNonExemptEncryption: developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance
- EU DSA trader status (removal since 2025-02-17): developer.apple.com/news/?id=einwn76m
- Capacitor 8 / 8.5 (Xcode 26 requirement): ionic.io/blog/announcing-capacitor-8 · capacitorjs.com/docs/main/reference/support-policy
- Screenshot sizes 2026 (6.9" 1320×2868; iPad 13" 2064×2752): appscreens.com/app-store-screenshot-sizes
- Review times: developer.apple.com/distribute/app-review (90% < 24h) · runway.team/appreviewtimes (live tracker)
