# APP STORE — shipping Gang Life on iPhone and iPad

The runbook. Everything in here is accurate to THIS repo as of 2026-08-23 and
was set up by reading the code, not from a template.

> **Two apps live in this repo**, built the same day in different sessions and
> reconciled on merge:
>
> | | Gang Life (this file) | Natural Disaster Survival |
> |---|---|---|
> | what ships | the whole game (`index.html`) | the disaster mini-game (`disaster.html`) |
> | Capacitor root | repo root | `apps/disaster-ios/` |
> | Xcode project | **committed** at `ios/App` | **generated** on the Mac, gitignored |
> | web payload | `dist/` (copy-through) | `dist-ios/www` (bundled + minified) |
> | runbook | this file | `apps/disaster-ios/GO-IOS.md` |
>
> Neither pipeline may write into the other's shell: `tools/setup-ios.mjs`,
> `tools/make-app-art.mjs` and `tools/build-ios.mjs` belong to the disaster
> app; `npm run ios:*` belongs to this one.

> **The one thing to understand:** the game is unchanged. There is no port and
> no rewrite. `ios/` is a thin native shell — a WKWebView that loads the exact
> same `index.html` and `src/` tree that `npm run dev` serves, off the device's
> own disk. Everything you fix in the game is a `npm run ios:build` away from
> being in the app.

---

## TL;DR — three commands, on a Mac

```bash
npm install          # once
npm run ios:build    # vite build -> dist/, then copy dist/ into the shell
npm run ios:open     # opens ios/App/App.xcodeproj in Xcode
```

Then in Xcode: pick your team under **Signing & Capabilities**, choose **Any
iOS Device (arm64)**, and **Product → Archive**.

Everything below is what those three commands are doing, what was changed to
make them enough, and what App Store Connect will ask you.

---

## What is actually in the repo now

```
capacitor.config.json          bundle id, app name, WKWebView behaviour
ios/App/App.xcodeproj          the Xcode project — open this
ios/App/App/Info.plist         orientation, status bar, controllers, export compliance
ios/App/App/PrivacyInfo.xcprivacy   the privacy manifest (required since 2024)
ios/App/App/Assets.xcassets    app icon (1024) + launch image, baked from the game's own mark
ios/App/App/public/            THE GAME. Generated, gitignored, replaced by ios:build
tools/ios-art.mjs              regenerates the icon + launch image
assets/fonts/fredoka-latin-var.woff2   the bundled UI typeface (SIL OFL)
```

`ios/App/App/public` is a copy of `dist/`, which is a copy of the tracked tree
(see `vite.config.js` — this build does not bundle, it copies). It is 54 MB and
gitignored. `npm run ios:build` is what puts it there; **an Xcode build does
not run it for you**, so if the app looks stale, that is why.

---

## The gaps that were closed to make this shippable

These were real, and each one is either a rejection or a bad first launch.

**1. The game phoned home for a font.** `index.html` pulled Fredoka from
`fonts.googleapis.com` on every boot. In a native shell the game runs from
`capacitor://` with no network guarantee — a plane, a dead hotel wifi, or a
review device behind a slow proxy — and every pill and button in this HUD is
sized against Fredoka's metrics, so a missing webfont reflows the whole
screen. Fredoka now ships in the repo — both App Store sessions fixed this
independently the same day, and the merge kept the better half: one variable
`assets/fonts/fredoka-latin-var.woff2` (29 KB, weights 300-700, SIL OFL —
see `assets/LICENSES.md`) declared in `css/fonts.css`. **The app now makes no
outbound request at all**, which is also what lets the privacy manifest and the
App Store Connect answers say "Data Not Collected" and be true.

**2. iPad with a keyboard had no touch controls.** `systems/touch.js` gated the
entire touch layer on `matchMedia("(pointer: coarse)")`. That asks about the
*primary* pointer — attach a Magic Keyboard or any trackpad and an iPad
answers "fine", so the joystick and every button silently never appeared.
WKWebView on iPad also defaults to *desktop* content mode, where the media
queries claim to be a Mac. There is now one shared `CBZ.isTouchDevice()`
(`src/config.js`) that asks `any-pointer: coarse` and `maxTouchPoints` too, and
`capacitor.config.json` pins `preferredContentMode: "mobile"`.

**3. Template art.** `npx cap add ios` ships Capacitor's own logo as the icon
and the splash. Review reads a template icon as an unfinished app. Both are now
drawn from the favicon's skyline mark, with bars through the tall block —
`node tools/ios-art.mjs` to regenerate.

**4. `UIRequiredDeviceCapabilities = armv7`.** The Capacitor template's value.
armv7 is 32-bit; no device that can run this deployment target is 32-bit, so
the key described hardware the build could never install on. Now `arm64`.

**5. No privacy manifest.** Missing since Apple began requiring one, and the
resulting `ITMS-91053` email arrives minutes after your first upload.
`PrivacyInfo.xcprivacy` is now in the project and in the Resources build phase.

**6. Export compliance on every single upload.** `ITSAppUsesNonExemptEncryption
= false` in the plist answers it once instead of holding each build in "Missing
Compliance".

---

## Info.plist, and why each key is what it is

| Key | Value | Why |
|---|---|---|
| `UISupportedInterfaceOrientations` | portrait + both landscapes | `css/mobile.css` carries a whole `max-height: 560px` regime for the landscape phone (the FIRE/JUMP column wrapping into a second column) *and* portrait rules. Both orientations are genuinely built; locking one would throw away work. Leaving them free is also what keeps the iPad well-behaved in Split View and Stage Manager. |
| `UIStatusBarHidden` + `UIViewControllerBasedStatusBarAppearance: false` | hidden | Full-screen game. Set in the plist rather than per-view-controller so there is no bar for one frame at launch. |
| `UIUserInterfaceStyle` | `Dark` | Stops iOS handing the WKWebView a light appearance, which is what puts a white flash between the launch image and the first rendered frame. |
| `UIApplicationSupportsIndirectInputEvents` | true | Real trackpad events on iPad instead of taps synthesised at the cursor. |
| `GCSupportsControllerUserInteraction` + `GCSupportedGameControllers` | ExtendedGamepad | `src/systems/gamepad.js` already drives the whole game off the web Gamepad API and WKWebView surfaces a paired controller through it. This is also what earns the **Controller Support** badge on the store listing. |
| `IPHONEOS_DEPLOYMENT_TARGET` (build setting) | 16.0 | Raised from the template's 15.0. Two reasons, and the second is the real one: `css/mobile.css` uses `svh` units (Safari 15.4+), and an iOS-15-era device cannot hold a 25 km three.js world in a WKWebView's memory budget — it would be jetsammed mid-play, which is a one-star review and a plausible review rejection. |

---

## App Store Connect — the answers

**Age rating: 17+.** Do not try to argue this one down. The game has gang
violence, a prison, shanks, firearms, drugs in `econ.DRUGS`, and theft as a
core verb. The GTA titles ship on iOS at 17+; this is the same shelf. Declaring
lower and being caught is a rejection *and* a resubmission.

**Privacy: Data Not Collected.** True, and now verifiably so — there is no
analytics SDK, no crash reporter, no ad network, and after the font change no
outbound request whatsoever. `PrivacyInfo.xcprivacy` says the same thing, and
the two have to agree.

**Encryption: already answered** by the plist key. Nothing to click.

**Multiplayer:** `server/server.js` and `src/net/` are a LAN/tunnel relay you
host yourself (see `GO-LIVE.md`). The shipped app has no server to connect to,
so the JOIN card simply never appears. Nothing to declare. If you ever do ship
a hosted relay, that changes the privacy answers and you should revisit this
file.

**Screenshots:** required at 6.9" iPhone and 13" iPad. `tools/visual-compare.mjs`
and the presets in `tools/visual-presets/` already render the game at arbitrary
sizes — that is the cheapest way to shoot them.

---

## Things to check on a real device before you submit

The container this was set up in has no iOS simulator, so these are unverified
by anything but reading:

- [ ] **First launch with the network off.** The whole point of the font
      change; confirm the HUD is Fredoka and not the fallback.
- [ ] **iPad with a Magic Keyboard attached.** The exact case that used to have
      no touch controls at all. The stick should be bottom-left as soon as you
      touch the glass.
- [ ] **Memory on the oldest device you care about.** A 25 km world in a
      WKWebView is the single most likely reason this app dies on a phone. If
      it jetsams, `CBZ.CONFIG` has quality knobs (`src/core/quality.js`) and
      raising the deployment target further is the blunt fix.
- [ ] **Rotate mid-game, both ways, on both devices.** Both orientations are
      supported, so both have to survive a live rotation.
- [ ] **Backgrounding mid-fight.** `systems/touch.js` clears every held key on
      `pagehide`/`visibilitychange`; confirm you do not come back sprinting.

---

## Regenerating things

```bash
npm run ios:build      # game -> dist/ -> ios/App/App/public   (do this before every archive)
npm run ios:sync       # the above, plus re-resolving native deps
node tools/ios-art.mjs # app icon + launch image
# The font is a checked-in file (assets/fonts/fredoka-latin-var.woff2, SIL OFL);
# to refresh it, download Google Fonts' Fredoka variable latin woff2 and replace it.
```

## Bumping a version

`MARKETING_VERSION` (the public 1.0) and `CURRENT_PROJECT_VERSION` (the build
number, must increase on every upload) are build settings in
`ios/App/App.xcodeproj/project.pbxproj`. Edit them in Xcode's target editor;
the plist reads them through `$(...)` and needs no change.
