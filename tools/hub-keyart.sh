#!/bin/bash
# hub-keyart.sh — re-photograph the main menu's key art, in-engine.
#
# One product-preset scene per game, shot with the cover title hidden
# (tools/visual-presets/hub-keyart.mjs), converted to a 1600x900 JPEG in
# assets/keyart/<mode>.jpg — the exact files index.html's title hub loads.
#
#   bash tools/hub-keyart.sh              # every game, serially
#   bash tools/hub-keyart.sh city escape  # just these
#
# Runs are serial on purpose: the city build alone is ~30 s of one core and a
# pile of parallel headless Chromes gets reaped by the memory killer.
set -u
cd "$(dirname "$0")/.."
REPO="$(pwd)"
OUT="${HUB_KEYART_OUT:-$HOME/harness/out/$(basename "$REPO")/hub-keyart}"
mkdir -p "$OUT" assets/keyart

# menu id | product preset | subject
ROSTER="
city|city|cover-chase
escape|prison|cover-fight
survival|disaster|keyart-town
gungame|gungame|cover-firefight
sharksim|shark|cover-white
npcwar|npcwar|cover-nuke
warlord|warlord|cover-dunes
bombsurvivor|bomb|cover-run
"

want="${*:-}"
for row in $ROSTER; do
  id="${row%%|*}"; rest="${row#*|}"; game="${rest%%|*}"; subject="${rest#*|}"
  if [ -n "$want" ] && ! printf ' %s ' $want | grep -q " $id "; then continue; fi
  dir="$OUT/$id"
  echo "== $id ($game-product / $subject)"
  HUB_KEYART_GAME="$game" ba --preset hub-keyart --before local --only after \
    --subjects "$subject" --width 1600 --height 900 --no-open --no-pdf \
    --cdp-timeout 600000 --out "$dir" > "$dir.log" 2>&1
  png="$(ls "$dir"/shots/after/*.png 2>/dev/null | head -1)"
  if [ -z "$png" ]; then echo "   FAILED, see $dir.log"; continue; fi
  sips -s format jpeg -s formatOptions 74 "$png" --out "assets/keyart/$id.jpg" >/dev/null
  echo "   -> assets/keyart/$id.jpg ($(du -k "assets/keyart/$id.jpg" | cut -f1) KB)"
done
