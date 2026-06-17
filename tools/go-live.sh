#!/usr/bin/env bash
# ============================================================================
# tools/go-live.sh — ONE command to host Cell Block Z + get a link to text.
#
#   Starts the game server (server/server.js — serves the game files AND the
#   multiplayer relay on ONE port) and opens a free Cloudflare quick tunnel so
#   a friend on the internet can join. Prints the JOIN LINK to text.
#
#   Usage:
#       bash tools/go-live.sh            # port 8000 (default)
#       PORT=8123 bash tools/go-live.sh  # pick another local port
#
#   Stop everything: press Ctrl-C in this window (it kills both the server
#   and the tunnel and flushes the world save).
#
# WHY one process for the game files + relay: the browser connects to the
# WebSocket back at the SAME origin it loaded from (net.js: ws://<host>/ws).
# So a single tunnel to this one port carries BOTH the game and the live
# world — there is nothing else to expose. (tools/devserver.py is the OLD
# solo-only static server; it has no /ws relay, so the multiplayer JOIN card
# never appears with it. Do NOT use devserver.py to host friends.)
# ============================================================================
set -euo pipefail

PORT="${PORT:-8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # repo root (this script lives in tools/)

# --- preflight: the two things this needs --------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed. Install Node (https://nodejs.org) then re-run." >&2
  exit 1
fi
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared is not installed." >&2
  echo "       Install it once with:  brew install cloudflared" >&2
  echo "       (Or run WITHOUT a tunnel for same-Wi-Fi-only play — see GO-LIVE.md.)" >&2
  exit 1
fi

# --- clean shutdown: kill both children on Ctrl-C ------------------------
SRV_PID=""
TUN_PID=""
cleanup() {
  echo ""
  echo "[go-live] shutting down…"
  [ -n "$TUN_PID" ] && kill "$TUN_PID" 2>/dev/null || true
  # SIGINT lets server.js flush the world save before it exits (see server.js).
  [ -n "$SRV_PID" ] && kill -INT "$SRV_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "[go-live] stopped. World saved to server/worlds/."
}
trap cleanup INT TERM

# --- 1) start the game server (files + relay, one port) ------------------
echo "[go-live] starting game server on http://localhost:${PORT} …"
( cd "$ROOT" && PORT="$PORT" node server/server.js ) &
SRV_PID=$!
sleep 2
if ! kill -0 "$SRV_PID" 2>/dev/null; then
  echo "ERROR: the game server failed to start (is port ${PORT} already in use?)." >&2
  echo "       Try a different port:  PORT=8123 bash tools/go-live.sh" >&2
  exit 1
fi

# --- 2) open the public tunnel to that one port --------------------------
TUN_LOG="$(mktemp -t cbz-tunnel.XXXXXX)"
echo "[go-live] opening Cloudflare quick tunnel (free, no account) …"
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >"$TUN_LOG" 2>&1 &
TUN_PID=$!

# --- 3) wait for + print the shareable link ------------------------------
LINK=""
for _ in $(seq 1 40); do          # up to ~20s for the URL to appear
  LINK="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUN_LOG" | head -n1 || true)"
  [ -n "$LINK" ] && break
  if ! kill -0 "$TUN_PID" 2>/dev/null; then
    echo "ERROR: the tunnel exited early. Its log:" >&2
    cat "$TUN_LOG" >&2
    cleanup; exit 1
  fi
  sleep 0.5
done

echo ""
echo "  ========================================================"
if [ -n "$LINK" ]; then
  echo "   TEXT THIS LINK TO YOUR FRIEND:"
  echo ""
  echo "       $LINK"
  echo ""
  echo "   You open it too — you are the FIRST in, so you host the"
  echo "   world. Keep this window open and your Mac awake."
else
  echo "   Tunnel started but no link was captured yet. Watch the"
  echo "   live output below for a https://…trycloudflare.com URL."
fi
echo "  ========================================================"
echo ""
echo "  [Ctrl-C here stops the server AND the tunnel.]"
echo ""

# stream the tunnel log so the link/errors stay visible; block until Ctrl-C
tail -f "$TUN_LOG" &
wait "$SRV_PID"
