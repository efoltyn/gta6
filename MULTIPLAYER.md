# Cell Block Z — Host Your Own RP Server

GTA-RP-style multiplayer, FiveM-style: anyone can run a server, set its name,
rules and roles, and hand out ONE link. Opening the link loads the game *and*
joins the server — no install, no account, no app. Play with friends among the
full living city (peds, cops, traffic), or run a roleplay server with named
characters, roles, and `/me` `/do` chat.

## Host a server (60 seconds)

```bash
node server/server.js
```

That's it — zero dependencies. First run writes `server/server.json`; edit it
and restart:

```jsonc
{
  "name": "Cell Block Z RP",          // shows on the join screen + server lists
  "motd": "Stay in character. /help", // your rules / welcome line
  "tags": ["rp", "casual"],
  "password": "",                     // set one for a private/whitelist server
  "adminPass": "",                    // lets trusted players /admin <pass>
  "maxPlayers": 16,
  "port": 8000,
  "roles": [                          // RP roles players pick at the door — edit freely
    { "id": "civ",    "label": "Civilian" },
    { "id": "police", "label": "Police" },
    { "id": "ems",    "label": "Paramedic" },
    { "id": "taxi",   "label": "Taxi Driver" },
    { "id": "crook",  "label": "Crook" }
  ],
  "directory": "",                    // optional: a directory server to list on
  "publicUrl": ""                     // your public join link, for the listing
}
```

### Let people join over the internet

```bash
cloudflared tunnel --url http://localhost:8000
```

Share the printed `https://…` link — **that link IS your server**: it serves
the game and connects players back to your world. Post it in your Discord, on
a stream panel, anywhere. (Any other way you can expose port 8000 — a VPS,
port forwarding, ngrok — works the same.)

### The world host

The first player to join becomes the **world host**: their browser simulates
the city (NPCs, cops, traffic, heat) and streams it to everyone else. If they
leave, the next-oldest player is promoted automatically and the city
repopulates. Practical rules:

- The server owner should join first if they want *their* city ledger
  (property, gang state — saved in their browser) to be the world.
- The host shouldn't sit on the pause screen: the world freezes for everyone.

## Playing

- Open the server link → the join card shows the server name, MOTD, player
  count → pick a character name + role → **JOIN SERVER**.
- **Proximity VOICE**: your mic is requested on join (deny = listen-only).
  Talk and players near you hear you — from your direction, fading with
  distance, silent past ~50m. A 🔊 pip shows over whoever is speaking.
  `Y` mutes/unmutes your mic. Voice needs HTTPS or localhost — the
  cloudflared link qualifies. (NAT-strict networks can add a TURN server via
  `iceServers` in server.json; the default public STUN covers most homes.)
- `T` (or Enter) opens chat. RP commands: `/me lights a cigarette`,
  `/do The door is locked`, `/ooc brb`, `/players`, `/help`.
- Everyone shares ONE living city: the same peds with the same names and
  outfits, the same traffic, the same wanted heat. Shoot a ped and it dies on
  everyone's screen; steal a car and others watch you drive past; commit
  crimes and the cops come for *you* — including player-cops' guests.
- Everyone INTERACTS like GTA Online: PvP with guns **and fists** (punches
  land, knock down, can finish); point a gun at a stranger and they put their
  hands up no matter whose screen they live on; run people over — NPCs die
  under any player's car and a player car can run YOU down; players and
  synced cars are **solid** (no phasing through your friend or through
  traffic). Remote players are dead-reckoned through packet gaps so they jog
  on instead of freezing.
- Name + role tags float over every player.

## Admin

The world host is automatically an admin; others can `/admin <adminPass>`.
Commands: `/kick <name>`, `/announce <text>`. Set `password` in the config to
gate the whole server (whitelist-style: share the password with approved
members in your Discord).

## A public server list (optional)

Run `node server/directory.js` anywhere (it's a tiny JSON service), then set
each game server's `directory` to its URL and `publicUrl` to the server's join
link. Servers heartbeat every minute; `GET /servers` returns the live list —
ready to embed in a community page.

## Architecture (for hackers)

```
server/server.js    zero-dep Node: serves game files + WebSocket relay /ws,
                    room state, host election, chat/commands, /api/info
server/wsmini.js    minimal RFC6455 WebSocket server implementation
src/net/net.js      connection, protocol, own-avatar broadcast (12Hz),
                    damage routing (PvP + puppet hits + NPC→remote)
src/net/netactors.js remote player avatars: rig + name tag + interpolation,
                    their car while driving, remote gunfire fx
src/net/networld.js host: world snapshots (10Hz) + entity meta; guest:
                    puppet peds/cops/cars; car OWNERSHIP TRANSFER on enter/exit
src/net/netvoice.js proximity voice: WebRTC P2P mesh signaled over the same
                    relay (ev "rtc"), each remote voice through a PannerNode
                    tracking their avatar/car, [Y] mute, 🔊 speaking pips
src/net/netui.js    join card (auto-appears when served by a game server),
                    chat box, online indicator
```

Model (same shape as FiveM/OneSync, scaled down): each client is authoritative
over its own avatar; the elected host's browser is authoritative over the NPC
world; guests render interpolated puppets that are still real hitscan targets —
a guest's bullet is routed to the host and applied to the authoritative ped.
Entering a car asks the host for ownership; the guest then simulates that one
car locally (full drive feel) and returns it on exit.

Tests: `node tools/test-net.js` (protocol, 26 checks) ·
`node tools/test-net-browser.mjs` (two real headless Chromes joining a live
server, 18 checks) · `node tools/test-voice-browser.mjs` (voice mesh +
interaction hardening with fake mics, 7 checks) · `node tools/harness.js`
(single-player regression).

## Current limits (v2) / roadmap

- Cops shoot and chase remote offenders but only arrest/cuff the local player.
- NPC dialogue/robbery menus ([E]/IJKL interactions) work on your own screen's
  world only — guests can fight, drive, rob-at-gunpoint reactions, but not run
  scripted NPC conversations yet.
- Money/inventory/property are per-player (browser localStorage); the shared
  world state is whatever the current host's browser holds.
- Per-player wanted levels are shared server heat, not individual stars.
- Voice is one proximity profile (no whisper/shout ranges or radio channels yet).
- Player-driven cars push apart visually but don't exchange crash damage.
