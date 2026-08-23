# NATURAL DISASTER SURVIVAL — the App Store runbook

> **Two apps live in this repo.** Gang Life (the full game) owns the repo-root
> `capacitor.config.json` and the COMMITTED Xcode project at `ios/App` — its
> runbook is `docs/APP-STORE.md`. THIS app owns `apps/disaster-ios/`, and its
> Xcode project is generated there on the Mac (gitignored). Neither pipeline
> may write into the other's shell.

Everything between this repo and a build sitting in App Store Connect. You have
the developer account and other apps on the store, so this skips what you
already know and states only what is specific to THIS app.

The short version:

```bash
npm run build:disaster     # regenerate disaster.html from index.html
npm run build:ios          # dist-ios/www — the bundle the app ships
npm run check:ios          # boot that bundle and run all eleven disasters

# on the Mac, once (this app's Capacitor root is apps/disaster-ios — the
# repo-root config and ios/ belong to the OTHER app, Gang Life):
(cd apps/disaster-ios && npx cap add ios)
node tools/setup-ios.mjs   # plist keys, privacy manifest, icon, splash

# every time after that:
npm run build:ios && (cd apps/disaster-ios && npx cap sync ios)
open apps/disaster-ios/ios/App/App.xcworkspace
```

---

## What is actually being shipped

`dist-ios/www` — not this repo. The web deploy (pushing to main) stays exactly
as it is: 553 script tags, no build step, `index.html` at the root. The app is a
different artifact built from the same source:

| | web (`index.html`) | app (`dist-ios/www`) |
|---|---|---|
| games on the page | six | **one** |
| script tags | 553 | **1** (`bundle.js`) |
| first world built | the city | **the island** |
| network at runtime | Google Fonts, unpkg (both removed this wave) | **none at all** |

Three tools make it, and each one is reversible:

- `tools/build-disaster-page.mjs` writes `disaster.html` from `index.html` by
  dropping the script tags this game never runs. The list is measured, not
  guessed — see below.
- `tools/build-ios.mjs` concatenates those scripts into one `bundle.js`,
  minifies it with esbuild, rewrites the page to load it, and copies only the
  assets the code actually asks for.
- `tools/setup-ios.mjs` applies everything `npx cap add ios` leaves undone.

## Why the app is allowed to have a build step and the site is not

`scrolls/claude/project.md` is right that pushing to main IS the web deploy, and
a build step there is a way to ship something nobody tested. An app is compiled,
signed and uploaded no matter what — the build step already exists. Refusing to
use it just makes a phone pay for 553 URL loads and 553 separate compile tasks.

The one thing concatenation would break is handled explicitly: several files
resolve a path from `document.currentScript.src`. The bundle redefines
`document.currentScript` and sets it to a stand-in for the real file before each
block runs, so those files resolve exactly what they resolve today.

## The manifest is measured

`tools/disaster-slice.json` says which scripts the app drops. It was produced by
`tools/disaster-minimize.mjs`, which drops a group of files, rebuilds the page,
and asks `tools/disaster-check.mjs` whether the game still:

- boots to a playable match with ground under the spawn and a full bot field,
- runs **all eleven disasters** through warn → active without a throw,
- still has every named system on `CBZ` (wildlife, water, weather, trauma,
  killfeed, touch, gore, facades, the volcano, the quake, the shaft…).

A file only leaves the build when the game passes all three without it. Re-run
the search after any wave that adds a system:

```bash
node tools/disaster-minimize.mjs --jobs 3        # search
node tools/disaster-minimize.mjs --verify        # just re-check the manifest
```

## Xcode, step by step

1. **`npm run build:ios`** on any machine. It prints the bundle and total size.
2. **`npx cap add ios`** on the Mac (needs CocoaPods). This generates
   `ios/App/` — an Xcode project, checked in or not, your call. It is
   regenerable at any time: delete it and run this again.
3. **`node tools/setup-ios.mjs`** — idempotent, run it after every `cap add` and
   any time you regenerate the art:
   - merges `ios/Info.plist.additions` into `App/App/Info.plist` (landscape only
     on iPhone, full screen, no status bar, `ITSAppUsesNonExemptEncryption`,
     Metal required),
   - copies `ios/PrivacyInfo.xcprivacy` into the app folder,
   - writes the AppIcon and Splash image sets from `ios/art/`.
4. **Add `PrivacyInfo.xcprivacy` to the App target** once, by hand, in Xcode
   (drag it into the project navigator, check "App" under Target Membership).
   A file on disk that is not a target member does not ship, and the upload will
   be rejected for a missing privacy manifest with no other explanation.
5. **Signing** — your team, your bundle id. The id in `capacitor.config.json` is
   `com.efoltyn.naturaldisastersurvival`; change it there first if you want
   another, then `npx cap sync ios`, or the two disagree.
6. **Deployment target**: iOS 14 or later is Capacitor 8's floor. WebGL 2,
   WebAudio and `OffscreenCanvas` (the loading meter's worker) are all fine
   there.
7. **Archive → Distribute**. Nothing unusual.

## The App Review answers, written down in advance

**"Is this a repackaged website?"** (Guideline 4.2, the one that rejects
wrappers.) It is not, and the build is what proves it: every asset is in the
bundle, the app never makes a network request, and it runs identically in
aeroplane mode on a device that has never been online. If review asks, that
sentence plus "the app has no server" is the whole answer.

**Age rating.** People die in this game, visibly, and there is blood
(`systems/trauma.js` — the gore is earned by the cause of death, but it is
there). Rate it honestly: **Frequent/Intense Realistic Violence** → 17+. An
under-rated game is a removal; an over-rated one costs nothing.

**Privacy nutrition label.** No data collected. No tracking. No third-party
SDKs. The manifest in step 4 says the same thing in the form Apple parses.

**Account / login.** None. Nothing to demo, no test account needed.

**In-app purchases.** None in this build.

**Multiplayer.** Not in this build either — say nothing about it in the
description until the transport ships, or the first review of the update will
ask where it is.

## What to test on a real device before uploading

The oracle runs headless on SwiftShader, which is not a phone. These are the
things only a device can tell you:

- [ ] Cold launch to the title card, timed. (The card is honest — it is
      `src/systems/bootprogress.js` drawing a real percentage from a worker
      thread, so it keeps counting while the main thread builds the island.)
- [ ] The whole match at 30 fps or better with 99 bots. Drop `CBZ.SURV_BOTS`
      in `src/config.js` if an older device cannot hold it.
- [ ] Every disaster once. The volcano and the tsunami are the expensive two.
- [ ] Audio: it should start on the first touch (WebAudio unlocks there) and
      duck correctly, and the silent switch should silence it.
- [ ] Backgrounding mid-match and coming back — no black screen, no context
      loss. (`src/systems/glcontext.js` handles a lost WebGL context; that is
      the file to look at if the screen comes back black.)
- [ ] The home indicator and the notch: nothing important under either, both
      orientations.
- [ ] Aeroplane mode, first launch after install. It must be identical.

## Where the numbers live

`LOAD-NOTES.md` has the measured load story for the whole release.
`PERF-NOTES.md` has the frame budget. Both were written about `index.html`; the
app's numbers come from `npm run check:ios`, which prints requests, bytes, time
to playable and heap for the built bundle every time it runs.
