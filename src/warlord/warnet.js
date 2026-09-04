/* ============================================================
   warlord/warnet.js — THE WIRE. Nothing else.

   "modes for single player and a multiplayer option like open front.io"
   ...and then, from the owner: "ultra simple mechanics, made for
   multiplayer — it's almost like openfront.io met Bannerlord once it's
   multiplayer."

   That second line changed what this file is. Multiplayer is not a mode
   bolted onto a single-player game here, it is the shape the game is FOR,
   and a file that owned both the transport AND the rules would be the one
   place every future rule change had to go through. So the split is:

       match.js   THE OTHER WARLORDS. who is on the island, their columns,
                  and the alliance handshake. (Module name: `warlords`.)
       warnet.js  THIS FILE. getting bytes between machines, and knowing
                  who is on the other end. No rules live here.

   AND NOW THERE IS NOTHING ELSE. This file used to carry a 390-line FALLBACK
   block — a peer meet card, a duel, a trade and a second alliance system —
   "so multiplayer is not dead on the page while match.js is being written".
   It was gated on match.js being absent and had therefore not run in months.
   It is deleted; the tombstone at the bottom says why, and why leaving it
   would have been worse than deleting it.

   ── WHAT IS REUSED, AND WHY ────────────────────────────────────────────
   Everything. src/net/net.js is this repo's multiplayer client — connect,
   the hello/welcome handshake, the player table, join/leave, SIM-HOST
   ELECTION with automatic migration when the host quits, the point-to-point
   `to` relay, and a backpressure gate that sheds stale snapshots instead of
   drowning the socket. server/server.js is a zero-dependency relay that
   already carries the three shapes a real-time match needs:

       t:"state"   high frequency, broadcast, DROPPED under backpressure
       t:"world"   broadcast, and the relay itself refuses it from anyone
                   who is not the elected sim host — the authority check for
                   a match tick is already written, on the server
       t:"ev"      reliable, broadcast or directed by `to`

   NOT ONE LINE OF server/ WAS CHANGED and no new protocol was invented. All
   warlord traffic rides ONE relay verb, `wl`, sub-verbed by `v`, so nothing
   this game ever adds can collide with a city verb.

   net.js is not on this page's script list, so it is injected on demand the
   first time somebody connects. It captures CBZ.game at load, so an inert
   one is installed first — every engine file on this page tests for
   `mode === "city"`, so "warlord" is the OFF position everywhere.

   ── THE TRICK: NO MAP ON THE WIRE ──────────────────────────────────────
   The island is 14 km of analytic sand generated from ONE INTEGER. The host
   sends that integer and every client builds a byte-identical world from it.
   No heightfield, no oasis list, no outpost list, no chunk streaming — the
   entire shared world costs 4 bytes, once. The same is true of the neutral
   warbands: W.makeBand is driven by core's seeded stream, so every client
   generates the same parties with the same men in them, and the host only
   ever has to say where they have WALKED to.

   ── THE NO-PAUSE RULE, and the battle decision it forces ───────────────
   THE SHARED WORLD NEVER STOPS FOR ANYBODY. Not for a battle, not for a
   trade screen, not for a player who alt-tabbed. (The twenty-minute MATCH
   CLOCK this used to be written against is gone — see match.js's tombstone.
   The rule survives it: the day still turns, columns still walk, and nobody
   on the island waits on anybody else's screen.)

   A Bannerlord battle takes minutes, so the two are in direct conflict, and
   there were two ways out:

   (a) A SYNCHRONISED 3D BATTLE, one side authoritative, both players in it.
       REJECTED. Two hundred men running combat_iq agreeing across two
       machines needs lockstep or rollback, and this transport is a JSON
       relay whose backpressure gate is ALLOWED to drop snapshots. The
       failure is not "slightly out of sync", it is one player watching men
       die who are still alive on the other screen. It also drags the other
       five players into somebody else's frame rate.

   (b) THE OUTCOME IS DECIDED IN ONE EXCHANGE; THE FIGHT IS A LOCAL SHOW.
       CHOSEN, and as of this pass actually BUILT — see A HUMAN FIGHT below.
       Three packets: a challenge carrying a shared salt and the challenger's
       real roster, an answer carrying the defender's, and a result. The
       CHALLENGER runs battle.js's own resolve() over both real rosters and
       sends back who died, by id; each side then loses ITS OWN men through
       army.js's aftermath — the same call a solo fight ends in.

       The design this header described for months was "both sides run one
       pure function and agree". They do not: resolve() is deliberately
       asymmetric (your warlord stands in your own line and can go down), so
       two clients each running it as mine-vs-them can BOTH come away having
       won. Making it symmetric would have meant a second battle model living
       in the wire, next to the one in battle.js — the exact drift both of
       match.js's tombstones are about. One machine computes; both apply.

   ── THERE IS NO SERVER, AND THERE NEVER WAS ────────────────────────────
   This file used to build `wss://<host>/ws` out of location and open it. The
   game is deployed on GitHub Pages, which is a static file host: nothing has
   ever answered there, and the failure text told a person holding a phone to
   run `node server/server.js`. MULTIPLAYER on the deployed link had never
   worked for anybody, ever.

   The default transport is now a ROOM: `room:host` / `room:CODE`, which
   src/net/rooms.js turns into another player's browser tab running
   server.js's room protocol over WebRTC. Two phones and a four-character
   code, no server, no account. server/server.js still works and is still
   better when you have one — it is the ADVANCED line in the lobby now
   instead of the only path.

   ── EVENTS ─────────────────────────────────────────────────────────────
   warnet:on warnet:off warnet:peer warnet:join warnet:leave warnet:host
   warnet:world warnet:fight

   ── FLAGS ──────────────────────────────────────────────────────────────
   ?room=CODE   join that room on load, skipping the menu (the share link)
   ?net=host    open a room on load; the code lands on window.__room
   ?relay=URL   use a server/server.js relay instead of a room
   ?name=X      your warlord's name, for tools and for a pre-filled link
   ?ride=1      enter the campaign as soon as the island is agreed
   ?peers=old   peers are a text list only, not parties on the map
   ?netlobby=1  open the lobby straight away
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] warnet.js loaded without core.js"); return; }

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const OLD_PEERS = Q.get("peers") === "old";
  const clamp = W.clamp;

  let ctx = null;
  let ONLINE = false;            // the socket is up and welcomed
  let ACTIVE = false;            // ...and we know which island we are on
  let MYNAME = "";
  let SEEDVOTE = 0;              // the seed we push if we turn out to be first in
  let WORLD = null;              // {seed, day, hour} — the agreed world identity
  let stateTimer = 0;
  let LOBBYERR = "";
  const EXTRA = [];              // providers that add fields to our own packet

  /* THE PALETTE is indexed by the relay's player id, so every client paints
     every warlord the same colour without anybody sending one. */
  const COLS = [0xff8a3d, 0x4fc7ff, 0x8fe06a, 0xff5fa8, 0xffd166, 0xb987ff, 0x5ae0c8, 0xff6b5a];
  function colourFor(id) { return COLS[(id | 0) % COLS.length]; }
  function hex(c) { return "#" + ("000000" + (c >>> 0).toString(16)).slice(-6); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function now() { return Date.now(); }
  function net() { return CBZ.net; }
  function isHost() { const N = net(); return !!(N && N.isHost && N.isHost()); }

  /* ============================================================ THE BUS
     ONE relay verb for the whole game. A sub-verb inside it costs four bytes
     and means match.js can invent as many message types as it likes without
     ever having to know what the city already sends down this socket. */
  const SUBS = {};
  function on(verb, fn) {
    (SUBS[verb] = SUBS[verb] || []).push(fn);
    return function () {
      const L = SUBS[verb]; if (!L) return;
      const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1);
    };
  }
  function fire(verb, data, from) {
    const L = SUBS[verb];
    if (!L) return;
    for (let i = 0; i < L.length; i++) {
      try { L[i](data, from); } catch (e) { console.error("[warnet]", verb, e); }
    }
  }
  function send(verb, data, to) {
    const N = net();
    if (!N || !N.active) return false;
    const m = { e: "wl", v: verb, d: data == null ? null : data };
    if (to != null) m.to = to;      // server.js relays a `to`-stamped ev to that one client
    N.sendEv(m);
    return true;
  }

  // simple lifecycle subscriptions, each returning its own unsubscribe
  const LIFE = { join: [], leave: [], host: [], offline: [], peer: [], world: [], snapshot: [] };
  function sub(kind, fn) {
    LIFE[kind].push(fn);
    return function () { const i = LIFE[kind].indexOf(fn); if (i >= 0) LIFE[kind].splice(i, 1); };
  }
  function ping(kind, a, b) {
    const L = LIFE[kind];
    for (let i = 0; i < L.length; i++) { try { L[i](a, b); } catch (e) { console.error("[warnet]", kind, e); } }
  }

  /* ============================================================ LOADING net.js */
  let loading = null;
  function loadNet() {
    if (CBZ.net) return Promise.resolve(CBZ.net);
    if (loading) return loading;
    /* net.js does `const g = CBZ.game` at load and dereferences it inside its
       host-migration path. There is no city on this page, so hand it an inert
       one BEFORE the script runs: combat_iq.js, wounds.js, actorweapons.js
       and gunfx.js all gate on `mode === "city"`, so any other string is the
       off switch for every one of them. */
    if (!CBZ.game) CBZ.game = { mode: "warlord", state: "playing" };
    /* A STABLE IDENTITY across reloads is what lets the relay clean up your
       ghost when your tunnel blips (server.js's reconnect dedupe keys on it).
       netpersist.js owns this in the city; that file is 456 lines of city
       character persistence, so this page provides the one function it
       exports that matters here rather than loading it. */
    if (!CBZ.netPid) {
      CBZ.netPid = function () {
        try {
          let p = localStorage.getItem("cbz-pid");
          if (!p) { p = "w" + Math.random().toString(36).slice(2) + now().toString(36); localStorage.setItem("cbz-pid", p); }
          return p;
        } catch (e) { return "w" + Math.random().toString(36).slice(2); }
      };
    }
    const root = (CBZ.studio && CBZ.studio.root) || "../src/";
    loading = new Promise(function (res, rej) {
      const s = G.document.createElement("script");
      s.src = root + "net/net.js";
      s.async = false;
      s.onload = function () { res(CBZ.net); };
      s.onerror = function () { loading = null; rej(new Error("net/net.js did not load")); };
      G.document.head.appendChild(s);
    });
    return loading;
  }

  /* ============================================================ CONNECT
     A ROOM IS THE DEFAULT AND A SERVER IS THE ADVANCED CASE, which is the
     exact opposite of what this file used to assume.

     What it used to do: build `wss://<host>/ws` out of location and open it.
     On the deployed build that host is efoltyn.github.io — a static file
     host that has never had a WebSocket endpoint and never will — so the
     socket failed every single time, and the error told the person holding
     the phone to run `node server/server.js`. MULTIPLAYER on the deployed
     link was a button that could not work, and nobody had ever played it.

     Now the default url is `room:host` / `room:CODE` and src/net/rooms.js
     turns that into another player's browser. defaultUrl() survives for the
     ADVANCED line only: if you are actually served BY server/server.js — a
     LAN box, a cloudflared tunnel — that relay is better than a room (real
     persistence, no broker) and the field is pre-filled with it. */
  function defaultUrl() {
    try {
      if (G.location && /^https?:$/.test(G.location.protocol) && G.location.host) {
        return (G.location.protocol === "https:" ? "wss://" : "ws://") + G.location.host + "/ws";
      }
    } catch (e) {}
    return "ws://localhost:8000/ws";
  }
  /* IS A RELAY EVEN PLAUSIBLE HERE? A page served off localhost or a LAN
     address is very likely served by server/server.js; a page served off
     github.io certainly is not. This only decides whether the advanced line
     is pre-filled or blank — it never blocks anything. */
  function relayPlausible() {
    try {
      const h = G.location && G.location.hostname || "";
      return /^(localhost|127\.|0\.0\.0\.0|\[?::1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
    } catch (e) { return false; }
  }

  let ROOMCODE = "";                 // the code of the room we are in, if any
  function roomCode() { return ROOMCODE; }

  function connect(opts) {
    opts = opts || {};
    LOBBYERR = "";
    MYNAME = opts.name || MYNAME || "WARLORD";
    SEEDVOTE = (opts.seed | 0) || ((Math.random() * 0x7fffffff) | 0);
    const url = opts.url || "room:host";
    ROOMCODE = "";
    return loadNet().then(function (N) {
      wireNet(N);
      N.connect({
        url: url, name: MYNAME, role: "civ",
        roomName: MYNAME + "'S ISLAND",
        /* THE CODE IS NOT KNOWN WHEN YOU PRESS THE BUTTON. rooms.js rolls
           one, and rolls again if the broker says it is taken, so the code
           arrives on a callback and the card repaints around it. */
        onCode: function (code) {
          ROOMCODE = code;
          try { G.__room = code; } catch (e) {}
          if (opts.onCode) try { opts.onCode(code); } catch (e) {}
          if (!ACTIVE) hostCard();
        },
        onError: function (msg) {
          /* THE ERROR IS THE MESSAGE AND NOTHING IS APPENDED TO IT.
             rooms.js knows why it failed and says so in a sentence a person
             on a phone can act on. The old code pasted a shell command onto
             the end of every failure; on the deployed build that was the
             first and only thing a player ever saw. */
          LOBBYERR = msg;
          if (opts.onError) opts.onError(LOBBYERR);
          else menuCard();
        },
      });
      if (opts.onReady) sub("world", opts.onReady);
      return N;
    }).catch(function () {
      LOBBYERR = "src/net/net.js did not load — multiplayer is unavailable. Single player is unaffected.";
      if (opts.onError) opts.onError(LOBBYERR);
      else menuCard();
    });
  }

  function disconnect() {
    const N = net();
    if (N && N.disconnect) try { N.disconnect(); } catch (e) {}
    goOffline();
  }

  function goOffline() {
    ONLINE = false; ACTIVE = false; WORLD = null; ROOMCODE = "";
    W.state.peers = {};
    if (stateTimer) { clearInterval(stateTimer); stateTimer = 0; }
    ping("offline");
    W.emit("warnet:off");
  }

  let wired = false;
  function wireNet(N) {
    if (wired) return;
    wired = true;

    N.on("welcome", function (m) {
      ONLINE = true;
      startPump();
      identify(null);
      /* EVERYONE ALREADY IN THE ROOM IS A JOIN THAT ALREADY HAPPENED, and
         until now nobody told anybody. The relay sends t:"join" for arrivals
         AFTER you and lists the people already there inside the welcome —
         which means a guest fired join hooks for nobody, and match.js, whose
         only peer-adoption hook is onJoin, never adopted the host. The host
         saw the guest as a warlord; the guest saw an empty island with one
         extra dot on it. The roster in the welcome is replayed as joins so
         both ends build the same table from the same hook. */
      const already = (m && m.players) || [];
      for (let i = 0; i < already.length; i++) {
        const q = already[i];
        if (!q || q.id === N.id) continue;
        ping("join", q.id, q.name);
        W.emit("warnet:join", { id: q.id, name: q.name });
      }
      /* FIRST IN OWNS THE WORLD. The relay already elects a sim host — the
         same election the city runs — so "host a game" and "join a game" are
         not two buttons here: whoever arrives first is the host and their
         seed is the island. Everybody else waits to be told rather than
         guessing, because two clients guessing produces two islands. */
      if (N.isHost()) setWorld({ seed: SEEDVOTE, day: W.state.day, hour: W.state.hour });
      else if (!ACTIVE) waiting("JOINED — WAITING FOR THE ISLAND");
    });

    N.on("join", function (m) {
      /* A LATE JOINER GETS THE WORLD, NOT THE MAP: the seed and the clock.
         Four bytes and a day number rebuild an island somebody has been
         riding for an hour. match.js hangs its own catch-up snapshot off
         onJoin and sends it with snapshotTo(). */
      if (isHost() && WORLD) send("world", WORLD, m.id);
      identify(m.id);
      ping("join", m.id, m.name);
      W.emit("warnet:join", m);
      repaintRoom();
    });

    N.on("leave", function (m) {
      const p = W.state.peers[m.id];
      delete W.state.peers[m.id];
      ping("leave", m.id, p ? p.name : m.name);
      W.emit("warnet:leave", m);
      repaintRoom();
    });

    N.on("host", function (m) {
      ping("host", m.id, isHost());
      W.emit("warnet:host", { id: m.id, mine: isHost() });
      if (isHost()) W.toast("you are simulating the island now", "good");
    });

    N.on("_offline", function () {
      if (ACTIVE) W.toast("the line went dead — the island is yours alone now", "bad");
      goOffline();
    });

    /* PER-PLAYER STATE. t:"state" is the relay's high-frequency lane and the
       one net.js is allowed to DROP when the socket is backed up. That is
       exactly right for a position: the next one supersedes it. Nothing that
       must arrive may ever be sent down here. */
    N.on("state", function (m) {
      if (!m || m.id == null || m.id === N.id) return;
      const p = W.state.peers[m.id] || (W.state.peers[m.id] = { id: m.id });
      p.name = m.nm || p.name || ("WARLORD " + m.id);
      p.x = m.x; p.z = m.z;
      p.size = m.n | 0; p.pw = m.pw || 0;
      p.colour = colourFor(m.id);
      p.t = now();
      if (m.x2) for (const k in m.x2) p[k] = m.x2[k];      // match.js's own fields
      ping("peer", p);
      W.emit("warnet:peer", p);
    });

    /* THE MATCH TICK. t:"world" is the lane server.js refuses from anybody
       who is not the elected sim host — the authority check match.js needs is
       already written, on the server, and reusing it means no new server
       code and no way for a guest to forge a world tick. */
    N.on("world", function (m) {
      /* NO SENDER STAMP ON THIS LANE. server.js stamps `m.id = p.id` on a
         t:"state" frame but NOT on a t:"world" one — it just checks the
         sender is the sim host and rebroadcasts verbatim. The first draft
         guarded on `m.id != null` and therefore threw away every world tick
         it was ever sent. The check is unnecessary anyway: the relay only
         forwards this frame from the host, and never back to the sender, so
         anything arriving here is by construction the host's and not ours. */
      if (m) ping("snapshot", m.d, m.id != null ? m.id : N.hostId);
    });

    N.onEv("wl", function (m) {
      if (!m || !m.v) return;
      if (m.v === "world") { onWorldMsg(m.d); return; }
      if (m.v === "hi") { onHi(m); return; }
      if (m.v === "snap") { ping("snapshot", m.d, m.id); return; }
      fire(m.v, m.d, m.id);
    });

  }

  function identify(to) {
    send("hi", { nm: MYNAME, n: W.armySize(), pw: Math.round(W.yourPower() * 100) / 100 }, to);
  }
  function onHi(m) {
    const d = m.d || {};
    const p = W.state.peers[m.id] || (W.state.peers[m.id] = { id: m.id });
    p.name = d.nm; p.colour = colourFor(m.id); p.size = d.n | 0; p.pw = d.pw || 0; p.t = now();
    if (isHost() && WORLD) send("world", WORLD, m.id);
  }

  /* ============================================================ WORLD IDENTITY */
  function setWorld(obj) {
    WORLD = { seed: obj.seed | 0, day: obj.day || 1, hour: obj.hour || 7 };
    send("world", WORLD);
    applyWorld(WORLD, true);
  }
  function onWorldMsg(d) {
    if (!d || ACTIVE) return;                 // a re-send after we are riding is noise
    WORLD = { seed: d.seed | 0, day: d.day || 1, hour: d.hour || 7 };
    applyWorld(WORLD, false);
  }
  /* TWO WARLORDS CANNOT START IN THE SAME FOOTPRINT.
     campaign.js places you by drawing ONE angle off the campaign's seeded
     stream and walking in from the sea until the ground is 4 m up. Every
     client rebuilds that stream from the same four bytes, so on a shared
     island every player was placed on the same grain of sand, facing the
     same way, inside each other's encounter radius. "Multiplayer" opened
     with two men standing in each other.

     A seat is a bearing. The golden angle spreads N seats around the coast
     as far apart as N seats can be for every N (that is the property it has
     and an even division does not: with 4 seats an even division and a
     golden one look alike, but the 5th player then lands on the 1st). The
     walk inland is campaign.js's own coastPoint rule, kept identical so a
     net spawn is the same KIND of place as a solo spawn — a landing, with
     the sea behind you, which is the thing the beach start exists to teach.

     It does NOT touch W.rnd. Drawing the bearing from the shared stream
     would consume it a different number of times per client, which desyncs
     every band on the island — the exact class of bug the seed handshake is
     there to avoid. */
  function seatSpawn(seat) {
    const D = W.desert;
    if (!D || !D.heightAt) return null;
    const TAU = Math.PI * 2;
    const R = (D.RADIUS != null ? D.RADIUS : 7000);
    const a = ((seat | 0) * 2.399963229728653) % TAU;   // golden angle
    for (let r = R + 1100; r > 800; r -= 40) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      let y;
      try { y = D.heightAt(x, z); } catch (e) { return null; }
      if (!(y > 4)) continue;
      try { if (D.slopeAt && D.slopeAt(x, z) >= 0.22) continue; } catch (e) {}
      return { x: x, z: z, y: y };
    }
    return null;
  }
  function takeSeat() {
    const N = net();
    const seat = N && N.id ? N.id : 1;
    const p = seatSpawn(seat);
    if (!p) return false;
    const S = W.state;
    S.you.x = p.x; S.you.z = p.z;
    S.you.yaw = Math.atan2(-p.x, -p.z);
    S.you.placed = true;              // campaign.enter() leaves a placed man alone
    return true;
  }

  function applyWorld(w, mine) {
    ACTIVE = true;
    /* THE DEFAULT IS ONLY A DEFAULT. match.js owns spawn placement and the
       shape of a session, so if it is on the page it decides what "start on
       this island" means and this file does nothing but hand it the seed. */
    W.newGame({ seed: w.seed, mode: "net", name: MYNAME });
    W.state.day = w.day; W.state.hour = w.hour;
    takeSeat();
    ping("world", w, mine);
    W.emit("warnet:on", { seed: w.seed, host: mine });
    W.log("riding a shared island. seed " + w.seed + ".");
    warRoom();
    if (Q.get("ride") === "1") setTimeout(ride, 0);
  }
  function ride() {
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else W.toast("campaign.js did not load — no island to ride", "bad");
  }

  /* ============================================================ THE PUMP
     ONE interval, started on connect and cleared on disconnect — deliberately
     NOT a per-frame hook, so single player pays literally nothing for this
     file being on the page. 4 Hz is enough for a party on a 14 km island: at
     a rider's pace that is under three metres between updates. */
  function startPump() {
    if (stateTimer) return;
    stateTimer = setInterval(pushSelf, 250);
  }
  function pushSelf() {
    const N = net();
    if (!N || !N.active) return;
    const S = W.state;
    const m = {
      t: "state", nm: MYNAME,
      x: Math.round(S.you.x * 10) / 10,
      z: Math.round(S.you.z * 10) / 10,
      n: W.armySize(),
      pw: Math.round(W.yourPower() * 100) / 100,
      d: S.day,
    };
    if (EXTRA.length) {
      const x2 = {};
      for (let i = 0; i < EXTRA.length; i++) {
        try { const o = EXTRA[i](); for (const k in o) x2[k] = o[k]; } catch (e) {}
      }
      m.x2 = x2;
    }
    N.send(m);
    prunePeers();
  }

  /* A PEER WHOSE PACKETS STOPPED is not on the map. The relay tells us about
     a clean leave; this covers the other kind — a tab that froze, a phone
     that went in a pocket. Eight seconds is 32 missed updates. */
  function prunePeers() {
    const t = now();
    for (const id in W.state.peers) {
      if (t - (W.state.peers[id].t || 0) > 8000) {
        const p = W.state.peers[id];
        delete W.state.peers[id];
        ping("leave", p.id, p.name);
      }
    }
  }

  /* ============================================================ PEERS
     Published in the shape campaign.js already draws bands in, so "another
     warlord" needs no second renderer — same fields, plus `peer` so it can be
     drawn in that player's colour and skipped by the normal band code. */
  function peerList() {
    const out = [];
    for (const id in W.state.peers) {
      const p = W.state.peers[id];
      if (p.x == null) continue;
      out.push(p);
    }
    return out;
  }
  function peerBands() {
    if (OLD_PEERS) return [];
    return peerList().map(function (p) {
      return {
        id: "p" + p.id, peer: true, peerId: p.id,
        faction: "warlord", name: p.name, colour: p.colour || colourFor(p.id),
        x: p.x, z: p.z, men: [], size: p.size || 1, ally: !!p.ally,
        mood: "roam", cooldown: 0, gold: 0, wealth: 0.5,
      };
    });
  }

  /* ============================================================ THE LOBBY
     A REAL ONE, FOR THE FIRST TIME.

     What was here: three text fields — name, a ws:// url, a seed — and one
     button. On the deployed build the url field was pre-filled with
     `wss://efoltyn.github.io/ws`, which is not a thing; RIDE OUT failed; the
     error told you to run a node server. Three fields, and two of them were
     wrong on the only build anybody plays.

     What is here now is the two verbs a person actually has:

       HOST A ROOM   your browser becomes the room. A four-character code
                     comes up, big, with a share link next to it, and the
                     people who arrive appear under it while you wait.
       JOIN A ROOM   type the four characters.

     and an ADVANCED line for the one case rooms are the wrong answer: you
     are already served by server/server.js and would rather use it.

     THE ROOM LIVES IN A TAB, and the card says so in one line rather than
     letting somebody discover it when the host locks their phone. */
  const CSS = `
  .wl-net-f{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-net-f:last-child{border-bottom:0}
  .wl-net-f label{font-size:10.5px;letter-spacing:.2em;opacity:.55;min-width:88px}
  .wl-net-f input{flex:1;min-width:0;background:rgba(255,255,255,.06);color:var(--ink);
    border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px 12px;
    font:inherit;font-size:14px;letter-spacing:.04em}
  .wl-net-f input:focus{outline:none;border-color:var(--hot)}
  /* AT 320pt the 88px label column left the SERVER field too narrow to read
     a ws:// url in. Under 380 the label goes above the field instead. */
  @media (max-width:380px){
    .wl-net-f{display:block;padding:10px 0}
    .wl-net-f label{display:block;margin:0 0 6px}
    .wl-net-f input{width:100%}
  }
  /* THE CODE IS THE INTERFACE. It is read off one screen and typed into
     another, across a room, so it is set as large as a phone will hold four
     characters and tracked wide enough that nobody transposes two. */
  .wl-code{font-size:clamp(46px,17vw,78px);line-height:1;letter-spacing:.16em;
    text-align:center;padding:14px 0 8px;color:var(--hot);font-weight:700;
    text-shadow:0 0 26px rgba(255,138,61,.35)}
  .wl-code-l{text-align:center;font-size:10.5px;letter-spacing:.24em;opacity:.5;padding-bottom:10px}
  .wl-code-in{font-size:34px !important;letter-spacing:.34em !important;text-align:center;
    text-transform:uppercase}
  .wl-share{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:2px 0 10px}
  .wl-net-p{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;
    padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-net-p:last-child{border-bottom:0}
  .wl-net-dot{width:12px;height:12px;border-radius:3px}
  .wl-net-nm{font-size:14px;letter-spacing:.03em}
  .wl-net-sub{font-size:10.5px;letter-spacing:.06em;opacity:.5}
  .wl-net-tag{font-size:10px;letter-spacing:.16em;opacity:.7}
  .wl-net-tag.ally{color:#8fe0a2}
  .wl-net-err{color:#ffc9c4;font-size:12px;letter-spacing:.05em;line-height:1.5}
  /* ONE LINE OF TRUTH, not a paragraph of explanation: where the room lives,
     because that is a fact about the world (it can die) and not a note about
     the interface. */
  .wl-net-note{font-size:11px;letter-spacing:.05em;opacity:.45;line-height:1.6;padding-top:6px}
  .wl-adv{background:none;border:0;color:inherit;font:inherit;font-size:10.5px;
    letter-spacing:.2em;opacity:.45;padding:12px 0 0;cursor:pointer;text-decoration:underline}`;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-net-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-net-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  let CARD = "";                   // which card is up, so a join can repaint it
  let ADVANCED = false;

  function savedName() {
    let nm = "";
    try { nm = localStorage.getItem("cbz-warlord-name") || ""; } catch (e) {}
    return nm || "WARLORD " + (1 + Math.floor(Math.random() * 89));
  }
  function keepName(n) { try { localStorage.setItem("cbz-warlord-name", n); } catch (e) {} }
  function readName(fallback) {
    const el = ctx && ctx.el && ctx.el("nName");
    const n = ((el && el.value) || fallback || "WARLORD").slice(0, 18).trim() || "WARLORD";
    keepName(n);
    return n;
  }
  function shareLink(code) {
    try {
      const L = G.location;
      return L.origin + L.pathname + "?room=" + code;
    } catch (e) { return "?room=" + code; }
  }
  function errBlock() {
    return LOBBYERR ? '<div class="wl-card"><div class="wl-net-err">' + esc(LOBBYERR) + '</div></div>' : "";
  }

  function lobby() { menuCard(); }

  /* ---- 1. WHO ARE YOU, AND WHICH OF THE TWO VERBS ---- */
  function menuCard() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    if (ACTIVE) { warRoom(); return; }
    CARD = "menu";
    const nm = MYNAME || savedName();
    let url = "";
    try { url = localStorage.getItem("cbz-warlord-url") || ""; } catch (e) {}
    if (!url && relayPlausible()) url = defaultUrl();
    const node = ctx.screen(
      '<h1 class="wl-h">ONE ISLAND, <em>MANY WARLORDS</em></h1>' +
      errBlock() +
      '<div class="wl-card">' +
        '<div class="wl-net-f"><label>YOUR NAME</label><input id="nName" maxlength="18" value="' + esc(nm) + '"></div>' +
      '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="nHost">HOST A ROOM</button>' +
        '<button class="wl-btn" id="nJoin">JOIN A ROOM</button>' +
      '</div>' +
      (ADVANCED
        ? '<div class="wl-card">' +
            '<div class="wl-net-f"><label>RELAY URL</label><input id="nUrl" placeholder="ws://localhost:8000/ws" value="' + esc(url) + '"></div>' +
          '</div>' +
          '<div class="wl-btns"><button class="wl-btn" id="nRelay">USE THAT RELAY</button></div>'
        : '<button class="wl-adv" id="nAdv">I RUN MY OWN RELAY</button>') +
      '<div class="wl-btns"><button class="wl-btn" id="nBack">BACK</button></div>'
    );
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "nHost") {
        const name = readName(nm);
        waiting("OPENING A ROOM");
        connect({ name: name, url: "room:host", seed: seedFromQuery() });
      } else if (t.id === "nJoin") {
        MYNAME = readName(nm); joinCard();
      } else if (t.id === "nAdv") {
        MYNAME = readName(nm); ADVANCED = true; menuCard();
      } else if (t.id === "nRelay") {
        const name = readName(nm);
        const u = (ctx.el("nUrl") && ctx.el("nUrl").value) || defaultUrl();
        try { localStorage.setItem("cbz-warlord-url", u); } catch (e2) {}
        waiting("OPENING THE LINE");
        connect({ name: name, url: u, seed: seedFromQuery() });
      } else if (t.id === "nBack") {
        LOBBYERR = ""; W.emit("mainmenu");
      }
    };
  }
  function seedFromQuery() {
    return parseInt(Q.get("seed") || "", 10) || ((Math.random() * 0x7fffffff) | 0);
  }

  /* ---- 2. FOUR CHARACTERS ---- */
  function joinCard(prefill) {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    CARD = "join";
    const node = ctx.screen(
      '<h1 class="wl-h">JOIN A <em>ROOM</em></h1>' +
      errBlock() +
      '<div class="wl-card">' +
        '<div class="wl-code-l">THE FOUR CHARACTERS ON THEIR SCREEN</div>' +
        '<div class="wl-net-f"><input id="nCode" class="wl-code-in" maxlength="4" autocomplete="off" ' +
          'autocapitalize="characters" spellcheck="false" value="' + esc(prefill || "") + '"></div>' +
      '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="nGo">JOIN</button>' +
        '<button class="wl-btn" id="nBack">BACK</button>' +
      '</div>'
    );
    const inp = ctx.el("nCode");
    if (inp) { try { inp.focus(); } catch (e) {} }
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "nBack") { LOBBYERR = ""; menuCard(); return; }
      if (t.id !== "nGo") return;
      go();
    };
    if (inp) inp.onkeydown = function (e) { if (e.key === "Enter") go(); };
    function go() {
      const raw = (inp && inp.value) || "";
      const code = (CBZ.rooms && CBZ.rooms.cleanCode) ? CBZ.rooms.cleanCode(raw)
        : String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      if (code.length < 4) {
        LOBBYERR = "A room code is four letters and numbers. " +
          (raw ? '"' + esc(raw) + '" is not one.' : "");
        joinCard(raw);
        return;
      }
      waiting("KNOCKING ON " + code);
      connect({ name: MYNAME || savedName(), url: "room:" + code });
    }
  }

  /* ---- 3. THE ROOM. ONE SCREEN, WHETHER OR NOT THE ISLAND IS AGREED YET.
     It was two — a host card with the code, and a war room with the seed —
     and the host never saw the first one for more than a frame: the welcome
     that hands you your room id also makes you the sim host, which sets the
     world, which painted the war room straight over the top. The code was on
     screen for about 40 ms and then gone, which on a phone is "it did not
     work". Anything a room card has to say (the code, the link, the roster,
     where the room lives, the seed once there is one) belongs on one screen
     with the rows that do not apply yet simply absent. */
  function roomScreen() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    CARD = "room";
    const S = W.state;
    const link = ROOMCODE ? shareLink(ROOMCODE) : "";
    let h = '<h1 class="wl-h">' + (ACTIVE ? 'THE <em>ISLAND</em>' : 'YOUR <em>ROOM</em>') + '</h1>';
    if (ACTIVE) {
      h += '<p class="wl-sub">SEED ' + S.seed + '  ·  ' +
        (isHost() ? "YOU ARE SIMULATING IT" : "SOMEBODY ELSE IS SIMULATING IT") + '</p>';
    }
    if (ROOMCODE) {
      h += '<div class="wl-card"><div class="wl-code">' + esc(ROOMCODE) + '</div>' +
        '<div class="wl-code-l">READ IT OUT, OR SEND THE LINK</div></div>' +
        '<div class="wl-share"><button class="wl-btn" id="nShare">SEND THE LINK</button></div>';
    }
    h += rosterCard(ACTIVE);
    h += '<div class="wl-btns">' +
      '<button class="wl-btn hot" id="nRide">RIDE OUT</button>' +
      '<button class="wl-btn bad" id="nQuit">' + (isHost() && ROOMCODE ? "CLOSE THE ROOM" : "LEAVE THE ISLAND") + '</button></div>';
    if (link) {
      h += '<div class="wl-net-note">' + esc(link) +
        (isHost() ? "<br>The room lives in " + esc(MYNAME || "your") + "'s tab — close it and the room is gone." : "") +
        '</div>';
    }
    const node = ctx.screen(h);
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      const fid = t.getAttribute && t.getAttribute("data-fight");
      if (fid) { fight(parseInt(fid, 10)); return; }
      if (t.id === "nRide") ride();
      else if (t.id === "nShare") shareIt(link, t);
      else if (t.id === "nQuit") { disconnect(); menuCard(); }
    };
  }
  /* Two names for one screen, kept because callers elsewhere in this file
     read better for saying which one they mean. Declarations, not consts, so
     a call from anywhere in this closure cannot land in a temporal dead
     zone. */
  function hostCard() { roomScreen(); }
  function warRoom() { roomScreen(); }

  /* NAVIGATOR.SHARE IS THE ONE THAT WORKS ON A PHONE — it opens the same
     sheet every other app shares through, so the link goes into whatever
     they already talk in. Desktop has no sheet, so it falls back to the
     clipboard, and a browser with neither leaves the link on screen, which
     the card prints underneath either way. */
  function shareIt(link, btn) {
    const done = function (word) { if (btn) btn.textContent = word; };
    try {
      if (G.navigator && G.navigator.share) {
        G.navigator.share({ title: "DESERT WARLORD", text: "ride with me — room " + ROOMCODE, url: link })
          .then(function () { done("SENT"); }).catch(function () {});
        return;
      }
    } catch (e) {}
    try {
      if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
        G.navigator.clipboard.writeText(link).then(function () { done("COPIED"); }).catch(function () { done("COPY IT BELOW"); });
        return;
      }
    } catch (e) {}
    done("COPY IT BELOW");
  }

  function waiting(msg) {
    if (!ctx || !ctx.screen) return;
    CARD = "wait";
    ctx.screen('<h1 class="wl-h">' + esc(msg) + '</h1>' +
      '<div class="wl-btns"><button class="wl-btn" id="nCancel">CANCEL</button></div>');
    const c = ctx.el("nCancel");
    if (c) c.onclick = function () { disconnect(); menuCard(); };
  }

  /* ---- THE ROSTER, one renderer for both cards ---- */
  function rosterCard(withFight) {
    const S = W.state;
    const list = peerList();
    const N = net();
    /* THE PEOPLE IN THE ROOM ARE NOT THE SAME SET AS THE PEOPLE ON THE MAP.
       peerList() is who has sent a position; the relay's player table is who
       is in the room, which includes somebody who has joined this second and
       has not pushed a state frame yet. In a lobby the second set is the one
       that matters — otherwise a person who just arrived is invisible for a
       quarter of a second and reads as a failed join. */
    const seen = {};
    for (let i = 0; i < list.length; i++) seen[list[i].id] = 1;
    const extra = [];
    if (N && N.players) N.players.forEach(function (p) {
      if (p.id !== (N.id | 0) && !seen[p.id]) extra.push({ id: p.id, name: p.name, size: 0, pw: 0, colour: colourFor(p.id) });
    });
    const all = list.concat(extra);
    let h = '<div class="wl-lbl">WARLORDS · ' + (all.length + 1) + '</div><div class="wl-card">';
    h += '<div class="wl-net-p"><span class="wl-net-dot" style="background:' + hex(colourFor(N ? N.id : 0)) + '"></span>' +
      '<span><span class="wl-net-nm">' + esc(MYNAME) + '</span><br><span class="wl-net-sub">' +
      (S.army.length + 1) + ' men  ·  power ' + Math.round(W.yourPower()) + '</span></span>' +
      '<span class="wl-net-tag">YOU</span></div>';
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      h += '<div class="wl-net-p"><span class="wl-net-dot" style="background:' + hex(p.colour || colourFor(p.id)) + '"></span>' +
        '<span><span class="wl-net-nm">' + esc(p.name || ("WARLORD " + p.id)) + '</span><br><span class="wl-net-sub">' +
        (p.size || 1) + ' men  ·  power ' + Math.round(p.pw || 0) + '</span></span>' +
        (withFight && !p.ally && p.x != null
          /* THE ONE PLACE YOU CAN CURRENTLY PICK A FIGHT WITH A HUMAN.
             It belongs on the map — campaign.js detects an encounter and
             army.js draws the rail — and neither of those files was mine
             this session, so the verb is real and reachable here while the
             on-map route is one line in each of them (see the report). */
          ? '<button class="wl-btn bad" data-fight="' + (p.id | 0) + '">RIDE AT HIM</button>'
          : '<span class="wl-net-tag' + (p.ally ? " ally" : "") + '">' + (p.ally ? "ALLY" : "RIVAL") + '</span>') +
        '</div>';
    }
    h += '</div>';
    return h;
  }
  /* A JOIN REPAINTS WHATEVER IS UP. The host is looking at the room card
     waiting for people; the roster underneath is the whole point of that
     screen and a static one is a screen that lies. */
  function repaintRoom() { if (CARD === "room") roomScreen(); }

  /* ============================================================ A HUMAN FIGHT
     TWO PACKETS SETTLE IT, and this file's own header (── THE NO-PAUSE RULE)
     has described that design since the day it was written without anything
     implementing it: the peer duel was in the fallback block, gated off, and
     was deleted with it. So a peer on the map has been a coloured dot you
     could ally with and nothing else — you could not fight the other player
     in a game whose whole loop is fighting.

     WHY ONE SIDE COMPUTES. Both sides running the resolver over mirrored
     inputs does NOT produce one answer: battle.js's resolve() is asymmetric
     on purpose (your warlord stands in your own line, +14 power, and takes
     the "you went down" exit), so two clients each running it as "mine"
     against "them" can both come away having won. The alternative — a
     symmetric abstract formula living here — would be a SECOND battle model
     next to the one in battle.js, and this repo has been burned by exactly
     that twice (see match.js's two tombstones).

     So: the challenger runs battle.js's own resolve() over BOTH REAL
     ROSTERS (an army is a few KB of JSON; it rides the reliable lane once
     per fight, not per frame) and sends back who died. Each side then loses
     ITS OWN men, by id, through army.js's own aftermath — the same call a
     solo fight ends in. One model, one result, and each machine remains the
     only thing that touches its own soldiers. */
  let FIGHT = null;                 // {id, salt, t} — one fight at a time
  function wireSoldier(s) {
    return { id: s.id, name: s.name, tier: s.tier, wid: s.wid, armour: s.armour,
      hp: s.hp, maxHp: s.maxHp, kills: s.kills, battles: s.battles, wounded: !!s.wounded };
  }
  function myRoster() { return W.state.army.map(wireSoldier); }
  function peerBand(id, men) {
    const p = W.state.peers[id] || {};
    return {
      id: "p" + id, peer: true, peerId: id, faction: "warlord",
      name: p.name || ("WARLORD " + id), colour: p.colour || colourFor(id),
      x: p.x || 0, z: p.z || 0, men: men || [], size: (men || []).length,
      gold: 0, wealth: 0.5, mood: "roam", cooldown: 0, hostile: true,
    };
  }
  function fight(id) {
    if (!ONLINE || !ACTIVE) return false;
    if (FIGHT && now() - FIGHT.t < 20000) return false;
    if (!W.state.peers[id]) return false;
    FIGHT = { id: id, salt: (Math.random() * 0x7fffffff) | 0, t: now(), role: "challenger" };
    send("wlfc", { s: FIGHT.salt, army: myRoster() }, id);
    W.toast("YOU RIDE AT " + ((W.state.peers[id] || {}).name || ("WARLORD " + id)), "bad");
    return true;
  }
  on("wlfc", function (d, from) {
    if (!d || from == null) return;
    /* HE CAME TO YOU. There is no accept: the campaign clock does not stop
       for a prompt, and a fight you can decline by not answering is a fight
       the other player never gets. You answer with your roster; the outcome
       comes back. */
    FIGHT = { id: from, salt: d.s | 0, t: now(), role: "defender" };
    send("wlfa", { s: d.s | 0, army: myRoster() }, from);
    W.toast(((W.state.peers[from] || {}).name || ("WARLORD " + from)) + " RIDES AT YOU", "bad");
  });
  on("wlfa", function (d, from) {
    if (!d || !FIGHT || FIGHT.role !== "challenger" || from !== FIGHT.id) return;
    if ((d.s | 0) !== FIGHT.salt) return;
    const B = W.battle;
    if (!B || !B.resolve) { FIGHT = null; return; }
    const band = peerBand(from, (d.army || []).slice());
    const r = B.resolve({ band: band, salt: FIGHT.salt, apply: false });
    /* BATTLE.JS BUG, FOUND BY BEING ITS FIRST CALLER. resolve() has been in
       CONTRACT.md since the file was written and NOTHING in the repo has ever
       called it — army.js's encounter goes through start(). Called, it ends
       every fight on tick 2 with the player's entire line routed and zero
       casualties on either side; `?morale=old` (the morale system off) turns
       the same 20-v-20 into a real 103-tick fight, 3 dead against 20. So the
       bug is in the headless morale path, battle.js:1275-1307. It is not
       fixed here: battle.js belongs to somebody else this session, and a
       second copy of the resolver living in the wire is the exact drift both
       of match.js's tombstones are about. The exchange below is correct and
       will produce real casualties the day that is fixed; until then a human
       fight is decided but nobody dies, and tools/warlord-net-check.mjs says
       so out loud rather than passing quietly. */
    /* THE ANSWER IS AN ID LIST, NOT A NUMBER. "You lost nine men" leaves the
       other client choosing WHICH nine, and two clients choosing differently
       is two different armies wearing the same name. */
    send("wlfr", {
      s: FIGHT.salt,
      outcome: r.outcome === "won" ? "lost" : (r.outcome === "lost" ? "won" : "retreat"),
      theirDead: (r.theirDead || []).map(function (s) { return s.id; }),   // HIS dead, for him
      myDead: (r.yourDead || []).map(wireSoldier),                          // MY dead, for his loot
    }, from);
    applyFight(r, band);
    FIGHT = null;
  });
  on("wlfr", function (d, from) {
    if (!d || !FIGHT || FIGHT.role !== "defender" || from !== FIGHT.id) return;
    if ((d.s | 0) !== FIGHT.salt) return;
    const dead = {};
    (d.theirDead || []).forEach(function (id) { dead[id] = 1; });
    const mine = W.state.army.filter(function (s) { return dead[s.id]; });
    const band = peerBand(from, (d.myDead || []).slice());
    applyFight({
      band: band, outcome: d.outcome || "retreat", duration: 0, youKills: 0, ratio: 1,
      yourDead: mine, yourFled: [],
      theirDead: (d.myDead || []).slice(),
      yourSurvivors: W.state.army.filter(function (s) { return !dead[s.id]; }),
      theirSurvivors: [], loot: {}, armourLoot: {}, gold: 0, resolved: true,
    }, band);
    FIGHT = null;
  });
  function applyFight(r, band) {
    /* THE LOOT IS COUNTED HERE for the defender's mirrored report, because
       buildReport counted it for the challenger's real one and a report that
       reaches aftermath with an empty loot table quietly halves the reward
       for winning. Same rule as battle.js: every body on the field, yours
       included. */
    if (!Object.keys(r.loot || {}).length && (r.outcome === "won" || r.outcome === "retreat")) {
      r.loot = r.loot || {}; r.armourLoot = r.armourLoot || {};
      const bodies = (r.yourDead || []).concat(r.outcome === "won" ? (r.theirDead || []) : []);
      for (let i = 0; i < bodies.length; i++) {
        const s = bodies[i];
        if (s.wid && s.wid !== "fists") r.loot[s.wid] = (r.loot[s.wid] || 0) + 1;
        if (s.armour && s.armour !== "none") r.armourLoot[s.armour] = (r.armourLoot[s.armour] || 0) + 1;
      }
    }
    const mine = (r.yourDead || []).length, theirs = (r.theirDead || []).length;
    W.emit("battle:end", r);
    if (W.army && W.army.aftermath) { try { W.army.aftermath(r); } catch (e) { console.error("[warnet] aftermath", e); } }
    W.emit("warnet:fight", { band: band, outcome: r.outcome, myDead: mine, hisDead: theirs });
  }


  /* ============================================================================
     TOMBSTONE — THE FALLBACK BLOCK, deleted 2026-09-01. ~390 lines.

     What was here: a whole second game. A proximity MEET card when two peers
     rode within 150 m, a peer-vs-peer DUEL (challenge / accept / a pure
     two-packet resolve() both sides ran), a TRADE screen that moved guns and
     gold between baggage trains, and a peer ALLY offer with its own
     accept/refuse pair and its own ALLIES table.

     Its own header said why it was here and when it should go: "It exists so
     that multiplayer is playable before match.js lands, and it is switched
     off entirely — not merely hidden — the moment W.match exists. When
     match.js owns the encounter, delete this block."

     Two facts made deleting it correct rather than merely allowed:

       1. IT HAD ALREADY BEEN DEAD FOR MONTHS. Every entry point was gated on
          `!hasMatch()`, and hasMatch() tested for `W.match.lobby`, which
          match.js has exported the whole time. Not one line of it could run.

       2. IT WAS ABOUT TO WAKE UP. This pass deletes match.js's lobby. That
          flips hasMatch() to false and would have brought 390 lines of
          never-run code online at once — including a SECOND alliance system
          with its own accept/deny, next to the one the owner actually asked
          for. Two alliance tables, two ALLY buttons, one island.

     Alliances now live in exactly one place: src/warlord/match.js, module
     `warlords`, verbs wla / wlay / wlan / wlab, and they are the same four
     verbs whether the other side is an AI or a human. If peer duelling and
     peer trading come back they come back there, on that transport, not as a
     private copy inside the wire.
     ========================================================================= */

  /* ============================================================ MODULE
     THE TRANSPORT API. match.js sits on exactly this and nothing else.
     Every subscription returns its own unsubscribe. */
  W.module("warnet", {
    boot: function (c) {
      ctx = c;
      styleOnce();
      /* A SHARE LINK IS A JOIN. `?room=CODE` is what navigator.share sends
         and what somebody pastes into a chat, so opening it must BE joining
         that room — a link that drops you on a title card and makes you find
         the multiplayer button and re-type the code you already had is a
         link that failed. The menu still draws first (the shell calls it
         after bootModules); this runs on the next tick and takes the screen.

         ?net=host does the mirror for tools and for "make me a room now":
         it opens one and publishes the code on window.__room. */
      const q = Q.get("room"), host = Q.get("net") === "host", relay = Q.get("relay");
      if (q || host || relay || Q.get("netlobby")) setTimeout(function () {
        W.setPhase("menu");
        if (Q.get("name")) { MYNAME = Q.get("name").slice(0, 18); keepName(MYNAME); }
        if (relay) {
          /* ?relay=ws://…  the ADVANCED line as a link. A LAN box or a
             cloudflared tunnel running server/server.js is a better host
             than a room when you have one, and this is how you hand it to
             somebody (and how tools/warlord-net-check.mjs proves the seam
             end to end on a machine the PeerJS broker cannot reach). */
          MYNAME = MYNAME || savedName();
          waiting("OPENING THE LINE");
          connect({ name: MYNAME, url: relay, seed: seedFromQuery() });
        } else if (host) {
          MYNAME = MYNAME || savedName();
          waiting("OPENING A ROOM");
          connect({ name: MYNAME, url: "room:host", seed: seedFromQuery() });
        } else if (q) {
          const code = (CBZ.rooms && CBZ.rooms.cleanCode) ? CBZ.rooms.cleanCode(q)
            : String(q).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
          MYNAME = MYNAME || savedName();
          if (code.length === 4) { waiting("KNOCKING ON " + code); connect({ name: MYNAME, url: "room:" + code }); }
          else joinCard(q);
        } else lobby();
      }, 0);
    },

    // ---- connection ----
    lobby: lobby,                 // the shell's MULTIPLAYER button
    menuCard: menuCard,           // host / join / advanced
    joinCard: joinCard,           // the four-character card
    hostCard: hostCard,           // your room, its code, and who has arrived
    connect: connect,             // ({name,url,seed,onCode,onReady,onError}) -> Promise
    disconnect: disconnect,
    room: roomCode,               // the four characters, or "" on a relay/offline
    fight: fight,                 // ride at another human: fight(peerId)
    online: function () { return ONLINE; },              // socket up
    connected: function () { return ACTIVE && ONLINE; }, // ...and we know the world
    me: function () { const N = net(); return { id: N ? N.id : 0, name: MYNAME, colour: colourFor(N ? N.id : 0) }; },
    players: function () {
      const N = net(), out = [];
      if (N && N.players) N.players.forEach(function (p) { out.push({ id: p.id, name: p.name, colour: colourFor(p.id) }); });
      return out;
    },
    isHost: isHost,
    /* TRUE IN SINGLE PLAYER. An offline game is trivially its own host, so a
       caller gating band AI on this needs no "am I connected" branch. */
    simHost: function () { return !ACTIVE || isHost(); },
    colourFor: colourFor,

    // ---- reliable messages: send(verb, data[, toId]) / on(verb, fn) ----
    send: send,
    on: on,

    // ---- lifecycle ----
    onJoin: function (fn) { return sub("join", fn); },       // (id, name)
    onLeave: function (fn) { return sub("leave", fn); },     // (id, name)
    onHost: function (fn) { return sub("host", fn); },       // (hostId, iAmHost)
    onOffline: function (fn) { return sub("offline", fn); },

    // ---- per-player state, 4 Hz, DROPPABLE. never send anything that must
    //      arrive down this lane; use send() for that.
    selfExtra: function (fn) {                                // provider -> {k:v} merged into your packet
      EXTRA.push(fn);
      return function () { const i = EXTRA.indexOf(fn); if (i >= 0) EXTRA.splice(i, 1); };
    },
    onPeer: function (fn) { return sub("peer", fn); },
    peers: function () { return W.state.peers; },
    peerBands: peerBands,

    // ---- world snapshot: host-only, and the RELAY enforces that ----
    snapshot: function (obj) { const N = net(); if (N && N.active && isHost()) N.send({ t: "world", d: obj }); },
    snapshotTo: function (id, obj) { send("snap", obj, id); },
    onSnapshot: function (fn) { return sub("snapshot", fn); },  // (obj, fromId)

    // ---- world identity: the seed handshake, four bytes instead of a map ----
    world: function () { return WORLD; },
    setWorld: setWorld,
    onWorld: function (fn) { return sub("world", fn); },        // (world, iDeclaredIt)

  });
})();
