# Asset Licenses

All assets listed below were downloaded from [Poly Haven](https://polyhaven.com) and are
licensed **CC0 1.0 Universal (public domain dedication)** — no attribution required, free
for any use including commercial. See https://polyhaven.com/license and
https://creativecommons.org/publicdomain/zero/1.0/.

Files were downscaled locally (sips) from the Poly Haven originals; the license carries over.

| File | Asset | Source URL | License |
|------|-------|------------|---------|
| `assets/sky/day.jpg` | Kloofendal 48d Partly Cloudy (Pure Sky), tonemapped JPG, resized to 2048x1024 | https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/kloofendal_48d_partly_cloudy_puresky.jpg ([asset page](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky)) | CC0 1.0 |
| `assets/textures/asphalt512.jpg` | Asphalt 02, diffuse 1k, resized to 512x512 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_diff_1k.jpg ([asset page](https://polyhaven.com/a/asphalt_02)) | CC0 1.0 |
| `assets/textures/concrete512.jpg` | Concrete Floor Worn 001, diffuse 1k, resized to 512x512 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_worn_001/concrete_floor_worn_001_diff_1k.jpg ([asset page](https://polyhaven.com/a/concrete_floor_worn_001)) | CC0 1.0 |
| `assets/textures/grass512.jpg` | Leafy Grass, diffuse 1k, resized to 512x512 | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/leafy_grass/leafy_grass_diff_1k.jpg ([asset page](https://polyhaven.com/a/leafy_grass)) | CC0 1.0 |

This file covers only the assets listed above plus the audio sections below. Other files
under `assets/` predate this list and are documented elsewhere.

## Gun sounds (`assets/audio/guns/`) — 2026-06-10 redo

All gun samples are trimmed/normalized mono AAC (96 kbps) conversions of real range
recordings from [FreeFirearmsSFXLibrary](https://github.com/buddingmonkey/FreeFirearmsSFXLibrary)
by buddingmonkey, licensed **CC0 1.0 Universal** (repo `LICENSE` file; a copy already lives
at `assets/audio/firearms/LICENSE-CC0.txt`). Each file is a single shot cut from the
library's "Prepared SFX" takes (downloaded via `raw.githubusercontent.com`), processed
locally with ffmpeg/afconvert (trim, fade, peak-normalize; `distant` additionally
low-passed at 420 Hz, `tail` is the post-transient echo decay only).

| File | Source recording (original filename) | Real firearm | License |
|------|--------------------------------------|--------------|---------|
| `guns/pistol.m4a` | `Prepared SFX/Walther PPQ/X_31P.wav` (shot @1.07s) | Walther PPQ 9mm pistol | CC0 1.0 |
| `guns/smg.m4a` | `Prepared SFX/Carl Gustav M45/G_22P.wav` (shot @0.25s) | Carl Gustav M45 "Swedish K" 9mm SMG | CC0 1.0 |
| `guns/rifle.m4a` | `Prepared SFX/AR-15/D_24P.wav` (shot @0.53s) | AR-15 5.56 rifle | CC0 1.0 |
| `guns/ak47.m4a` | `Prepared SFX/AK-47/C_29P.wav` (shot @1.05s) | AK-47 7.62x39 | CC0 1.0 |
| `guns/lmg.m4a` | `Prepared SFX/AK-47/C_36P.wav` (shot @4.47s) | AK-47 (distinct take; stands in for an RPK-style LMG — no true LMG in any CC0 source found) | CC0 1.0 |
| `guns/shotgun.m4a` | `Prepared SFX/Mossberg/N_26P.wav` (shot @0.77s) | Mossberg 12ga pump shotgun | CC0 1.0 |
| `guns/sniper.m4a` | `Prepared SFX/Mosin Nagant/M_21P.wav` (shot @1.01s) | Mosin-Nagant 7.62x54R bolt rifle | CC0 1.0 |
| `guns/deagle.m4a` | `Prepared SFX/1917/B_16P.wav` (shot @0.59s) | M1917 .45 revolver (big-bore stand-in for Desert Eagle) | CC0 1.0 |
| `guns/distant.m4a` | `Prepared SFX/Mosin Nagant/M_21P.wav` (shot @5.02s, low-passed 420 Hz, −6 dB) | Mosin-Nagant report, muffled = far gunfire | CC0 1.0 |
| `guns/tail.m4a` | `Prepared SFX/Mosin Nagant/M_26P.wav` (decay 1.42–4.35s, transient removed, −6 dB) | natural outdoor gunshot echo tail | CC0 1.0 |

## Car sounds (`assets/audio/car/`) — 2026-06-10 redo

Real recordings by Joseph SARDIN from [BigSoundBank](https://bigsoundbank.com), licensed
**CC0 1.0 Universal / public-domain dedication** (see https://bigsoundbank.com/droit.html —
"Use, including for commercial purposes... Without any restrictions. Without asking
permission."). Downloaded as 320 kbps MP3 (`https://bigsoundbank.com/UPLOAD/mp3/<id>.mp3`),
processed locally (trim, fade, peak-normalize; loops built with equal-power crossfades and
mild envelope flattening), encoded to mono AAC 96 kbps.

| File | Source sound (id, original filename) | Notes | License |
|------|--------------------------------------|-------|---------|
| `car/idle.m4a` | "Engine of a Ford Courier" (#0674, `0674.mp3`) | 5.0s seamless idle loop cut from the steady 23.5–29.5s stretch; 1.0s crossfade (loop-point level delta 0.3 dB) | CC0 1.0 |
| `car/start.m4a` | "Engine of a Ford Courier" (#0674, `0674.mp3`) | ignition 0.50–3.65s of the same recording — catch flare settles into the exact engine the idle loop continues | CC0 1.0 |
| `car/rev.m4a` | "Car engine: Accelerations" (#1147, `1147.mp3`) | 1.3s mid-high-RPM loop from the steadiest revving stretch (9.5–11.15s), envelope-flattened, 0.35s crossfade | CC0 1.0 |
| `car/screech.m4a` | "Screeching Tires #1" (#2368, `2368.mp3`) | 1.1s sustained tire-squeal loop from the skid body, envelope-flattened, 0.28s crossfade | CC0 1.0 |
| `car/skid_stop.m4a` | "Screeching Tires #3" (#2370, `2370.mp3`) | full 2.1s skid-to-stop one-shot (natural decay) | CC0 1.0 |
| `car/horn.m4a` | "Recent car horn #1" (#0257, `0257.mp3`) | single 0.55s honk | CC0 1.0 |
