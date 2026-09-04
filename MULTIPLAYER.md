# Multiplayer — two ways in

There are two transports and they speak the SAME protocol. Which one you want
depends on whether anybody involved is willing to run a program.

| | **ROOMS** (default) | **A RELAY** (`server/server.js`) |
|---|---|---|
| what you run | nothing | one node process |
| what a friend needs | a four-character code | a link |
| where the room lives | the host's browser tab | your machine |
| dies when | the host closes the tab | you stop the process |
| persistence | none (a tab has no disk) | characters + world, on disk |
| needs the internet | yes, to find each other | only if you tunnel it |
| works on the deployed link | **yes** | no |

Rooms are first because the game is deployed as static files
(https://efoltyn.github.io/gta6/) and the relay cannot run there. Until
2026-09-04 rooms did not exist, the deployed MULTIPLAYER button opened a
WebSocket to `wss://efoltyn.github.io/ws` — an address that has never existed
— and the error told the player to run `node server/server.js`. Nobody had
ever played this game's multiplayer from the link it ships behind.

---

## Rooms: a code, and nothing to install

**Desert Warlord** (`games/warlord.html`):

1. MULTIPLAYER → **HOST A ROOM**. A four-character code comes up.
2. Read it out, or **SEND THE LINK** (`navigator.share` on a phone; the
   clipboard on a desktop). The link is `games/warlord.html?room=CODE` and
   opening it joins — no menu, no re-typing the code.
3. People appear in the roster as they arrive. **RIDE OUT** puts you on the
   island; the campaign clock never waits for anybody, so anyone can ride out
   whenever they like and the others catch them up.

**JOIN A ROOM** is the four characters. Codes are drawn from a 32-character
alphabet with `I`, `1`, `O` and `0` left out, because a code exists to be read
aloud.

### What a warlord match is

Every human in the room is a **warlord seat on one island**. There is no lobby
to assemble, no slots to fill and no start button that waits on everybody:

- **One seed.** The host's seed is the island, and the island is 14 km of
  analytic sand generated from that one integer, so the whole shared world
  costs four bytes. The map is never on the wire. The rival-warlord roster,
  the outposts and every neutral warband are derived from it too and are
  byte-identical on both ends (`warlord-net-check` asserts that).
- **Your own beach.** Each player walks in from the sea on his own bearing —
  campaign.js's coast rule, golden-angled by relay id. Before this, a shared
  seed placed every player on the same grain of sand, facing the same way,
  inside each other's encounter radius.
- **The clock never pauses.** Not for a battle, not for an open menu, not for
  somebody who put their phone in a pocket. Ride out when you like.
- **Peers are parties.** Another human is a band on your map in his own
  colour, with his name and his real strength, drawn by the same renderer as
  every AI column.
- **Alliances are a real handshake** (`src/warlord/match.js`) — offer, and it
  can be refused; break it, and it costs. The same four verbs whether the
  other side is an AI or a human.
- **A fight between two humans is decided in one exchange.** The challenger
  runs battle.js's own resolver over both real rosters and sends back who
  died, by id; each side then loses its own men through the same aftermath a
  solo fight ends in. Nobody else on the island waits a tick. (See the known
  issue at the bottom of this section.)

**Known issue, and it is not the wire:** `W.battle.resolve()` — the headless
battle CONTRACT.md has promised since the file was written — had never been
called by anything until the human fight above became its first caller, and it
is broken: it ends every fight on tick 2 with the player's whole line routed
and zero casualties on either side. The same 20-v-20 under `?morale=old`
(morale off) runs 103 ticks for 3 dead against 20, so the bug is in the
headless morale path (`src/warlord/battle.js:1275-1307`). Until that is fixed
a human-vs-human fight is decided correctly and identically on both ends, and
nobody dies. `tools/warlord-net-check.mjs` prints this as a note rather than
passing quietly.

### How it works

The room owner's browser opens a PeerJS peer under the well-known id
`cbz-<CODE>`; every guest opens a WebRTC DataConnection to it. Inside that tab,
`src/net/rooms.js` runs **server/server.js's room logic, verbatim** — the same
hello/welcome handshake, name dedupe, pid reconnect dedupe, join/leave
broadcast, oldest-in host election, `t:"state"` stamping, the `t:"world"`
sim-host authority check, the `ev e:"to"` point-to-point relay behind the same
RESERVED_EV guard, the same backpressure shed, and the same chat commands. The
owner is player #1 through a loopback connection object, so the relay never
learns that one of its players is itself.

`src/net/net.js` gained one seam: a `room:CODE` / `room:CODE:host` url installs
a socket-shaped object from rooms.js in place of a `WebSocket`. Everything
downstream — `handle()`, the player table, host migration, the city's whole
netcode — is untouched and cannot tell the difference, so the city gets rooms
for free the day it wants them.

**What a room cannot do:** persist. There is no disk in a tab, so `feat` is
`["to"]` (no `"persist"`) and the `wsave`/`csave`/`wload`/`cload` verbs are
dropped where server.js would write them to a file. **And the room dies with
the tab** — the relay IS that tab. The lobby says so in one line rather than
letting somebody find out.

### Signalling, and what it costs

PeerJS's public broker (`0.peerjs.com`, no account) is used only to exchange
the two SDP blobs that open the DataChannel. After that the traffic is
peer-to-peer and the broker is out of the path: a live room survives the broker
going down, it just cannot admit new players.

### NAT, and when you need TURN

The default ICE config is PeerJS's, which is Google's public STUN. That covers
the ordinary cases:

| both ends | works on STUN alone |
|---|---|
| home wifi ↔ home wifi | yes |
| home wifi ↔ 4G/5G phone | yes, almost always |
| one end behind a corporate/university firewall | often not |
| **both** ends behind symmetric NAT or CGNAT | **no** |
| either end on a network that blocks UDP outright | no |

Symmetric NAT on both ends is the case that genuinely cannot be punched
through: each side sees a different external port per destination, so neither
can predict the other's. That needs a TURN relay, and TURN costs money to run,
so none is bundled. The seam is there when you have one:

```html
<!-- in the page, before src/net/rooms.js is loaded -->
<meta name="cbz-ice" content='[
  {"urls":"stun:stun.l.google.com:19302"},
  {"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}
]'>
```

or, from any script that runs first:

```js
window.CBZ = window.CBZ || {};
CBZ.iceServers = [{ urls: "turn:turn.example.com:3478", username: "u", credential: "p" }];
```

`rooms.js` reads `CBZ.iceServers` first, then the meta tag, then falls back to
PeerJS's default. Handing it a list REPLACES the default STUN entirely, which
is what you want when you are paying for TURN. `server/server.js` already ships
the same knob for the city's proximity voice (`iceServers` in `server.json`).

### Checks

```
node tools/test-rooms.mjs         # the room protocol in plain node, no browser
node tools/warlord-net-check.mjs  # two headless Chromes, one island, 10 assertions
node tools/warlord-net-check.mjs --relay   # the same 10 over server/server.js
```

`test-rooms.mjs` needs no network at all: `makeRelay()` is pure, so the whole
protocol runs against fake connection objects. That matters, because
`warlord-net-check.mjs` needs the public broker and a machine that cannot reach
it should still be able to tell whether the room logic is right.

---

# A relay: host your own RP server

This is the other transport, and it is the one the CITY (`index.html`) uses.
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

- Whoever joins an empty server is handed the saved world to simulate; a
  hand-off mid-session keeps the live city (it never reloads from disk).
- The host shouldn't sit on the pause screen: the world freezes for everyone.

## Persistent worlds

The world file IS the world: `server/worlds/<name>.json`. Copy it to back it
up, share it to hand a friend your whole city, drop it into another machine's
`server/worlds/` to move house — exactly like a Terraria `.wld`.

**What persists** (saved on the server, survives reboots):

- Characters, keyed to each player's browser identity: name, role, position,
  cash + bank, level, weapons + ammo, wardrobe, owned property + businesses,
  garage, jail time. Rejoin the same server from the same browser and you're
  still you.
- The world itself: turf / gang control, building damage (every blown-out
  wall), the time of day.

**What regenerates** (FiveM model — deliberately never saved): ambient peds
and traffic. The streets re-deal themselves every time the world wakes up.

**Autosave**: characters every 60s and on tab close; the world every
`autosaveSec` (default 120) and on tab close. The server batches disk writes
(at most one per 5s, written atomically) and always flushes when the last
player leaves and on Ctrl-C — pulling the power cord mid-write is about the
only way to lose progress.

Name your world in `server/server.json`:

```jsonc
"world": { "name": "", "autosaveSec": 120 }   // "" = named after the server
```

### Hosting recipe

```bash
node server/server.js                            # the world loads from server/worlds/
cloudflared tunnel --url http://localhost:8000   # share the printed https link
```

cloudflared quick tunnels carry WebSockets and need no account. playit.gg's
free tier may not cover custom WebSocket tunnels — prefer cloudflared.

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
src/net/rooms.js    THE OTHER TRANSPORT: server.js's room logic inside a
                    browser tab, over PeerJS DataConnections. makeRelay() is
                    pure (fake conns in tools/test-rooms.mjs); open() is the
                    socket-shaped object net.js installs for a room: url
src/warlord/warnet.js  warlord's wire + lobby: host/join a room, the share
                    link, the per-seat spawn, and the human-vs-human fight
assets/vendor/peerjs.min.js  PeerJS 1.5.4 UMD (MIT), loaded lazily and only
                    when somebody actually opens or joins a room
server/server.js    zero-dep Node: serves game files + WebSocket relay /ws,
                    room state, host election, chat/commands, /api/info,
                    world persistence (server/worlds/*.json, debounced atomic
                    writes), per-pid character saves, point-to-point ev "to"
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

Tests: `node tools/test-net.js` (protocol + persistence, 41 checks) ·
`node tools/test-net-browser.mjs` (two real headless Chromes joining a live
server, 18 checks) · `node tools/test-voice-browser.mjs` (voice mesh +
interaction hardening with fake mics, 7 checks) · `node tools/harness.js`
(single-player regression).

## Current limits (v2) / roadmap

- Cops shoot and chase remote offenders but only arrest/cuff the local player.
- NPC dialogue/robbery menus ([E]/IJKL interactions) work on your own screen's
  world only — guests can fight, drive, rob-at-gunpoint reactions, but not run
  scripted NPC conversations yet.
- Characters and the world save on the server (see Persistent worlds); your
  character is keyed to your browser — clearing site data mints a stranger.
- Per-player wanted levels are shared server heat, not individual stars.
- Voice is one proximity profile (no whisper/shout ranges or radio channels yet).
- Player-driven cars push apart visually but don't exchange crash damage.

---

## Natural Disaster Survival — what a shared match needs, and where it stands

**2026-08-21.** The city's multiplayer above is a networked RP server. The
disaster island is a different problem: a hundred bodies and eleven hazards on
one map, where every client has to reach the same answer or nobody's death
means anything. That is a DETERMINISM problem before it is a transport problem,
and the transport is not the part that was missing.

`tools/determinism-check.mjs` is the measurement. It boots the game twice in two
separate browsers, drives an identical scripted match in each — same seed, same
forced disaster order, same fixed 1/60 ticks, no input — and compares every
body's position, health and death every sixty ticks.

**It started at zero ticks of agreement.** Four causes, and only one was a
missing seed:

| | |
|---|---|
| `systems/disasters.js` drew from `Math.random` | Where the lightning lands, which way the tsunami comes in, which buildings the quake takes. Now a named stream, reseeded per run from the world seed. Same for `systems/quake.js` (who a quake kills), the crowd's wander and where a body lands. |
| Bot think cadence came off the CAMERA | A bot's decisions depended on where the local player was looking. Measured from the player now; the camera still decides animation, which is a view decision and may differ. |
| The think schedule counted from PAGE LOAD | Which bots thought on tick 1 depended on how long the title screen had been up. |
| The clock moved by the WALL | Every cooldown advanced by however long that machine's last frame took. Under the fixed step `CBZ.now` advances exactly one tick per tick. |

**Where it stands:** `index.html` runs **5,400 ticks — ninety seconds, 32 bots,
several disasters — bit-identical across two browsers**, verified twice.

**The open item, stated plainly:** the sliced page (`disaster.html`, which is
what the app ships) still diverges, within the first second, by millimetres on a
handful of bots. Same code, fewer files — so something in the ~470 files the
slice drops is holding the full page steady, and the slice is where the next
session should look. `node tools/determinism-check.mjs --url disaster.html
--ticks 300 --every 1` names the actor and the axis.

### The seam, when a transport does arrive

`src/net/survnet.js`. Not multiplayer — the three things every multiplayer
design needs identically, so the day someone opens a socket it is plumbing:

- **stable ids** on every actor, surviving a frame, a death and a reset;
- **the match as one struct** — `snapshot()` writes it to an ArrayBuffer,
  `apply()` puts it back, matched by id and never by index. 100 bots is 2.5 KB,
  i.e. 40 kbit/s at 20 Hz. Testable today with no network: snapshot, disturb the
  world, apply, compare fingerprints;
- **one fingerprint** two clients can compare, quantised so the wire format
  cannot manufacture a disagreement.

No socket, no lobby, no prediction, no remote-player actor: each of those
depends on a decision (peer-to-peer or authoritative, lockstep or snapshot)
nobody has made yet, and writing them now would be guessing in public.

`systems/fixedstep.js` is the other half — the sim advances in whole 1/60 ticks
in survival, capped at four per frame so a long frame cannot spiral.
`?cfg_FIXED_STEP_V1=0` puts it back on the variable step, live.
