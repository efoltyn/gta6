# archive/prison-v1 — the jail game as it stood before the 2026-08-11 improvement wave

Byte-for-byte snapshot of the prison escape mode's files (src/world, src/entities,
src/config.js, and the prison-facing src/systems files) taken on branch
`claude/prison-escape-improvements-qk0e9m` before the aggressive rebuild
(roofs/sky discipline, warden's office, time of day, show-don't-tell HUD purge,
security levels, movable furniture).

Nothing in this directory is loaded by index.html — it is a reference copy so any
regression in the wave can be diffed against the last-known-good game without
digging through git history. Restore a file with:

    cp archive/prison-v1/world/yard.js src/world/yard.js
