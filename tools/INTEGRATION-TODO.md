# Wave-3 integration checklist (do when wave w6y2xqm95 lands)

## Verify / revert
- node --check EVERY changed file; revert any broken domain to its 9eb3feb (or pre-wave) state via `git checkout`.
- Run tools/test-city-promotion.js (crowd promotion 8/8).
- Confirm the witness seam compiles: wanted.js cityCrime->cityTagWitnesses; peds.js witness decision -> cityReport. No file should raise g.wanted directly off a raw action.
- Confirm audio agent actually wired a real "scream" sample (file exists on disk) and peds.js calls sfx("scream") guarded + low-frequency.
- Confirm aircraft.js feature-detects cityAirstrikeExplosion / cityDamageBuilding / cityHelipad.

## USER-REPORTED BELL/XYLOPHONE (gun sound) — HIGH PRIORITY
Cops/NPC police fire `CBZ.sfx("report")` (police.js ~227, ~625).
`report` = fx([kenney/switch_003.m4a, rse/click7.mp3]) — a UI CLICK, NOT a gunshot.
=> "almost a bell every time im in a firefight."
FIX: make cop gunfire a REAL gunshot. Either:
  (a) in police.js, change cop-fire sfx("report") -> sfx("shoot_pistol") (cops w/ pistol) or "shoot_carbine" (rifle units), OR
  (b) remap "report" in audio.js to a real firearm sample — BUT first grep all sfx("report") callers; if anything uses it as a non-gun confirm click, do NOT remap globally, fix at the police call site instead.
User feedback: SMG sound = amazing (keep), pistol = decent (keep). Only the cop "report" gun is the bell.

## Then
- git commit the integrated wave.
- Fresh tunnel link + report.
