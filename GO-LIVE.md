# GO-LIVE — text a friend a link and play together (tomorrow)

The dead-simple runbook to host your Cell Block Z world and hand a friend ONE
link they tap to join. Accurate to THIS repo. Verified by reading the code and
booting the server.

> **The one thing to understand:** `server/server.js` is a single Node process
> that serves BOTH the game files AND the multiplayer relay on ONE port. The
> browser connects its WebSocket back to the SAME address it loaded the page
> from (`net.js`: `ws://<that host>/ws`). So **one tunnel to that one port
> carries everything** — game + live world. There is nothing else to expose.
>
> `tools/devserver.py` (the old Python static server) has **no relay**, so the
> multiplayer JOIN card never appears with it. **Do not use it to host friends.**

---

## TL;DR — one command

```bash
bash tools/go-live.sh
```

It starts the server, opens a free Cloudflare tunnel, and prints:

```
   TEXT THIS LINK TO YOUR FRIEND:

       https://something-random.trycloudflare.com
```

Text that link. You open it too. **You are first in, so you host the world.**
Keep the window open and your Mac awake. **Ctrl-C** in that window stops
everything (and saves the world).

The rest of this file is what `go-live.sh` does by hand, plus troubleshooting.

---

## Prerequisites (already installed on this Mac — verified)

- **Node** (`node --version` → v26) — runs the server.
- **cloudflared** (`cloudflared --version` → 2026.x) — the free public tunnel.
  If it ever goes missing: `brew install cloudflared`.

No `npm install`, no build step — the game is plain `<script>` files and the
server is zero-dependency.

---

## The manual steps (two terminals)

### 1) Start the game server (files + relay, one port)

```bash
node server/server.js
```

It prints:

```
  Cell Block Z RP
  ─ play/join link:  http://localhost:8000
  ─ websocket:       ws://localhost:8000/ws
  ─ server info:     http://localhost:8000/api/info
```

- Port is **8000** by default. Change it in `server/server.json` (`"port"`) or
  with `PORT=8123 node server/server.js`.
- First run writes `server/server.json` — edit the server **name / motd /
  password / maxPlayers** there, then restart. (Leave `password` empty for an
  open game; set one to make it private — share it separately from the link.)
- The world is saved to `server/worlds/<name>.json` and autosaves; it survives
  restarts. (That folder is git-ignored.)

### 2) Expose it publicly with a tunnel (second terminal)

```bash
cloudflared tunnel --url http://localhost:8000 --no-autoupdate
```

It prints a line like:

```
+--------------------------------------------------------+
|  https://random-words-here.trycloudflare.com           |
+--------------------------------------------------------+
```

Match the `--url` port to your server's port. Cloudflare quick tunnels carry
WebSockets and need no account — exactly what the relay needs.

### 3) The shareable JOIN LINK

It is **the `https://…trycloudflare.com` URL itself.** Nothing to append. That
link both loads the game and connects the player back to your world.

> ⚠️ A quick-tunnel URL is **new every time** you start the tunnel. Text the
> friend the current one, and don't restart the tunnel mid-session.

### 4) Host the world + have the friend join

1. **You** open the link first (or run on the same Mac:
   `http://localhost:8000`). Being first makes your browser the **sim-host** —
   your machine runs the NPCs / traffic / cops / physics for everyone.
2. On the title screen a **JOIN panel** appears top-right (server name, MOTD,
   online count). Type a character name, pick a role, click **JOIN SERVER**.
3. **Text the friend the link.** They tap it on phone or laptop, fill in the
   same JOIN panel, click **JOIN SERVER**. They spawn into your living city.
4. Press **T** (or Enter) to chat. RP commands: `/me`, `/do`, `/ooc`,
   `/players`, `/help`. Proximity **voice** asks for the mic on join (deny =
   listen-only); **Y** mutes. Voice needs HTTPS — the tunnel link qualifies.

### 5) Stop / revert

- **`Ctrl-C`** in the server terminal — flushes the world save, then exits.
- **`Ctrl-C`** in the tunnel terminal — closes the public URL (game keeps
  running locally).
- `tools/go-live.sh` does both on a single Ctrl-C.

Nothing here is permanent: no account, no deploy, no DNS. Close the terminals
and you're fully offline again. Single-player is untouched — open
`http://localhost:8000` with no one else and it's the normal solo game.

---

## Your Mac runs the world — so the FEEL/PERF flags matter

You are first in, so **your browser is the sim-host**: it simulates every NPC,
car, and cop and streams ~10 Hz snapshots to your friend. On this 2019 Air the
city is render-bound, so keep the host machine as light as possible:

- **Don't sit on the pause screen while hosting** — the world freezes for
  everyone (the host's loop drives the sim).
- The **feel** improvements (`CBZ.feelMotion`, default ON — restores real-time
  player/camera motion under load) and the **draw-call batching**
  (`CBZ.wallBatch`) are what make the same low FPS feel paced instead of
  slow-motion. Leave them ON for the demo. They're per-client and local, so
  they don't change what your friend's avatar does on the wire — the network
  syncs positions, not timesteps.
- If your friend's machine is stronger, **let them join first** so THEY host
  the heavy sim and you play as a guest. Whoever is first (or oldest remaining)
  is the host; if the host leaves, the next-oldest is promoted automatically.

---

## Troubleshooting — friend can't connect

**No JOIN panel on the title screen.**
The page wasn't served by the relay. The panel only appears when `/api/info`
responds — i.e. you must be on `node server/server.js`, NOT `devserver.py` and
NOT a `file://` path. Check `http://localhost:8000/api/info` returns JSON.

**Friend's link shows "404" / a Cloudflare error page.**
The tunnel is up but the server behind it is down or on a different port. Make
sure `node server/server.js` is running and the tunnel's `--url` port matches
the server port. Restart the tunnel and re-send the (new) link.

**Friend joins but everyone is frozen / no NPCs move.**
The host (you, if first in) is paused, on the title screen, or the host's tab
was backgrounded/asleep. Bring the game to the foreground and leave it running.
Host migration only fires if the host actually disconnects.

**"Connection failed." / it loads but never connects.**
WebSocket isn't reaching `/ws`. With a cloudflared quick tunnel this should
just work (they carry WS). If you exposed the port another way (router port-
forward, a different tunnel), confirm that path forwards **WebSocket upgrades**
to port 8000, and that the page is served **https** (so the client uses `wss`).
A corporate/school network may block the tunnel host — try phone tethering.

**Voice doesn't work.**
Voice needs HTTPS or localhost. The `trycloudflare.com` link is HTTPS, so it
qualifies; a plain `http://<LAN-ip>:8000` link does NOT (mic blocked). On
strict NATs add a TURN server to `iceServers` in `server/server.json` (the
default public STUN covers most homes). `Y` toggles mute.

**"Server is full" / "Wrong password."**
Raise `maxPlayers` or clear/sync `password` in `server/server.json`, then
restart the server.

**Tunnel URL keeps changing / want a stable link.**
That's the trade for the no-account quick tunnel. For a permanent URL later,
use a named Cloudflare tunnel (requires a Cloudflare account + a domain) or any
host that can forward port 8000 incl. WebSockets. Not needed for tomorrow.

**Same Wi-Fi only, no tunnel?**
You can skip cloudflared and give a friend on your LAN `http://<your-Mac-IP>:8000`
(find it: `ipconfig getifaddr en0`). Works for game + relay, but **voice will
be blocked** (not HTTPS) and it won't reach the internet.

---

## Quick reference

| Goal | Command |
|---|---|
| Host + tunnel + link (one shot) | `bash tools/go-live.sh` |
| Server only (files + relay) | `node server/server.js` |
| Server on another port | `PORT=8123 node server/server.js` |
| Public tunnel (manual) | `cloudflared tunnel --url http://localhost:8000 --no-autoupdate` |
| Server health check | open `http://localhost:8000/api/info` |
| Edit name/password/roles | `server/server.json` (restart after) |
| Your world file | `server/worlds/<name>.json` (back up / share) |
| Stop | `Ctrl-C` in each terminal |

Deeper architecture and limits: see **MULTIPLAYER.md**.
