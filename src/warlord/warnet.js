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

       match.js   the MATCH. lobby, N players, spawn placement, the
                  real-time tick, diplomacy state, victory condition.
       warnet.js  THIS FILE. getting bytes between machines, and knowing
                  who is on the other end. No rules live here.

   Everything below the API is transport. The one piece of gameplay left is
   a FALLBACK encounter (fight / ally / trade when two warlords meet) that
   runs ONLY when match.js is absent, so that multiplayer is not dead on the
   page while match.js is being written. `W.match` existing switches it off
   in one branch — see FALLBACK, at the bottom.

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
   THE SHARED CLOCK NEVER STOPS FOR ANYBODY. Not for a battle, not for a
   trade screen, not for a player who alt-tabbed. That is the openfront
   property the owner asked for and it is the constraint everything else
   here bends around: seven people are riding this island in real time and
   none of them may be made to wait on an eighth.

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
       CHOSEN. Two packets settle it: a challenge carrying a shared seed and
       the challenger's power, an answer carrying the defender's. Both sides
       then run ONE pure function over those three numbers and get the same
       result with zero further traffic. Each client applies the casualties
       to ITS OWN men — the one thing it is unambiguously authoritative
       over. Only then, and only if they want to, may the two fighters watch
       it played out in battle.js on their own machines, at their own frame
       rate, as a dramatisation whose totals are pinned to the numbers
       already agreed. Either can skip it at any moment and nothing changes;
       nobody else on the island waits a single tick either way.
       That is what makes the abstract resolution the PRIMARY path and the
       3D battle the optional one, rather than the other way round.

   ── EVENTS ─────────────────────────────────────────────────────────────
   warnet:on warnet:off warnet:peer warnet:join warnet:leave warnet:host
   warnet:world warnet:meet warnet:duel warnet:trade

   ── FLAGS ──────────────────────────────────────────────────────────────
   ?peers=old   peers are a text list only, not parties on the map
   ?netlobby=1  open the connect card straight away
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
  function hasMatch() { return !!(W.match && W.match.lobby); }

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
    /* ONE TAB IS ONE WARLORD — sessionStorage, NOT localStorage, and this is
       a fix, not a preference. localStorage is shared by every tab of a
       browser profile, so two tabs of this game on one machine send the relay
       the SAME pid, and server.js's reconnect dedupe does exactly what it was
       written to do: it decides the second one is the first one coming back
       and kills the first session. Measured on the two-client rig, verbatim:

           [server] join #1 ALFA (1 online)
           [server] reconnect: dropping stale session #1 ALFA (pid match)
           [server] leave #1 ALFA (reconnect) (0 online)
           [server] join #2 BRAVO (1 online)

       ALFA's socket was dead before BRAVO finished joining, so ALFA pressed
       START and began a one-warlord match on an island BRAVO could not see —
       and nothing on either screen said a word about it. Two people on one
       machine (the way anybody first tries this) could not be in the same
       match at all, and neither could any headless test of it.

       sessionStorage has precisely the semantics the dedupe wants: unique per
       tab, and it SURVIVES A RELOAD of that tab, so refreshing still reclaims
       your own session and still cleans up your ghost. The city's own
       netpersist.js keeps the localStorage key because a city character is
       meant to follow you across tabs; a warlord in a match is not. */
    if (!CBZ.netPid) {
      CBZ.netPid = function () {
        const fresh = function () { return "w" + Math.random().toString(36).slice(2) + now().toString(36); };
        try {
          let p = sessionStorage.getItem("cbz-wl-pid");
          if (!p) { p = fresh(); sessionStorage.setItem("cbz-wl-pid", p); }
          return p;
        } catch (e) { return (CBZ._wlPid = CBZ._wlPid || fresh()); }
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

  /* ============================================================ CONNECT */
  function defaultUrl() {
    try {
      if (G.location && /^https?:$/.test(G.location.protocol) && G.location.host) {
        return (G.location.protocol === "https:" ? "wss://" : "ws://") + G.location.host + "/ws";
      }
    } catch (e) {}
    return "ws://localhost:8000/ws";
  }

  function connect(opts) {
    opts = opts || {};
    LOBBYERR = "";
    MYNAME = opts.name || MYNAME || "WARLORD";
    SEEDVOTE = (opts.seed | 0) || ((Math.random() * 0x7fffffff) | 0);
    return loadNet().then(function (N) {
      wireNet(N);
      N.connect({
        url: opts.url || defaultUrl(), name: MYNAME, role: "civ",
        onError: function (msg) {
          LOBBYERR = msg + "  Nothing is answering at " + (opts.url || defaultUrl()) +
            ". Start the relay with `node server/server.js` and open the game from that server.";
          if (opts.onError) opts.onError(LOBBYERR);
          else if (!hasMatch()) connectCard();
        },
      });
      if (opts.onReady) sub("world", opts.onReady);
      return N;
    }).catch(function () {
      LOBBYERR = "src/net/net.js did not load — multiplayer is unavailable. Single player is unaffected.";
      if (opts.onError) opts.onError(LOBBYERR);
      else if (!hasMatch()) connectCard();
    });
  }

  function disconnect() {
    const N = net();
    if (N && N.disconnect) try { N.disconnect(); } catch (e) {}
    goOffline();
  }

  function goOffline() {
    ONLINE = false; ACTIVE = false; WORLD = null;
    W.state.peers = {};
    if (stateTimer) { clearInterval(stateTimer); stateTimer = 0; }
    closeFallback();
    ping("offline");
    W.emit("warnet:off");
  }

  let wired = false;
  function wireNet(N) {
    if (wired) return;
    wired = true;

    N.on("welcome", function () {
      ONLINE = true;
      startPump();
      identify(null);
      /* FIRST IN OWNS THE WORLD. The relay already elects a sim host — the
         same election the city runs — so "host a game" and "join a game" are
         not two buttons here: whoever arrives first is the host and their
         seed is the island. Everybody else waits to be told rather than
         guessing, because two clients guessing produces two islands. */
      if (N.isHost()) setWorld({ seed: SEEDVOTE, day: W.state.day, hour: W.state.hour });
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
    });

    N.on("leave", function (m) {
      const p = W.state.peers[m.id];
      delete W.state.peers[m.id];
      ping("leave", m.id, p ? p.name : m.name);
      W.emit("warnet:leave", m);
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
      if (!hasMatch()) maybeMeet(p);
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

    if (!hasMatch()) wireFallback();
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
  function applyWorld(w, mine) {
    ACTIVE = true;
    /* THE DEFAULT IS ONLY A DEFAULT. match.js owns spawn placement and the
       shape of a session, so if it is on the page it decides what "start on
       this island" means and this file does nothing but hand it the seed. */
    if (!hasMatch()) {
      W.newGame({ seed: w.seed, mode: "net", name: MYNAME });
      W.state.day = w.day; W.state.hour = w.hour;
    }
    ping("world", w, mine);
    W.emit("warnet:on", { seed: w.seed, host: mine });
    W.log("riding a shared island. seed " + w.seed + ".");
    if (!hasMatch()) warRoom();
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

  /* ============================================================ THE CONNECT CARD
     NOT A LOBBY. match.js owns the lobby — who is in the session, what the
     rules are, when it starts. This is the three fields it takes to open a
     socket, shown only when match.js is not on the page, so that the shell's
     MULTIPLAYER button is never a dead end. */
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
  .wl-net-code{display:block;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);
    border-radius:10px;padding:10px 12px;margin:8px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:12.5px;letter-spacing:0;color:#ffd7bd;overflow-x:auto;white-space:pre}
  .wl-net-p{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;
    padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-net-p:last-child{border-bottom:0}
  .wl-net-dot{width:12px;height:12px;border-radius:3px}
  .wl-net-nm{font-size:14px;letter-spacing:.03em}
  .wl-net-sub{font-size:10.5px;letter-spacing:.06em;opacity:.5}
  .wl-net-tag{font-size:10px;letter-spacing:.16em;opacity:.7}
  .wl-net-tag.ally{color:#8fe0a2}
  .wl-net-err{color:#ffc9c4;font-size:12px;letter-spacing:.05em;line-height:1.5}
  .wl-net-note{font-size:11.5px;letter-spacing:.06em;opacity:.62;line-height:1.6}
  .wl-net-note b{color:var(--hot);font-weight:600}`;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-net-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-net-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  /* match.js OWNS THE LOBBY the moment it exists; this file never competes
     with it for the screen. Two routes get us there and both have to work:
     match.js may let this delegate, or it may replace W.warnet.lobby with its
     own and keep this one as W.warnet.peerLobby (which is what it actually
     does, because it owns one file and may not edit this one). The identity
     check is what keeps the second route from being an infinite loop — when
     match.js has already taken the entry point, the function it would
     delegate to IS this one, so it falls through to the connect card
     instead. */
  function lobby() {
    const installed = W.warnet && W.warnet.lobby;
    if (hasMatch() && W.match.lobby !== installed && W.match.lobby !== lobby) return W.match.lobby();
    connectCard();
  }

  function connectCard() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    if (ACTIVE) { warRoom(); return; }
    const url = (function () { try { return localStorage.getItem("cbz-warlord-url") || defaultUrl(); } catch (e) { return defaultUrl(); } })();
    let nm = "";
    try { nm = localStorage.getItem("cbz-warlord-name") || ""; } catch (e) {}
    nm = nm || "WARLORD " + (1 + Math.floor(Math.random() * 89));
    const seed = Q.get("seed") || String(1000 + Math.floor(Math.random() * 8999));
    ctx.screen(
      '<h1 class="wl-h">ONE ISLAND, <em>MANY WARLORDS</em></h1>' +
      '<p class="wl-sub">SHARED CAMPAIGN · THE CLOCK NEVER STOPS</p>' +
      (LOBBYERR ? '<div class="wl-card"><div class="wl-net-err">' + esc(LOBBYERR) + '</div></div>' : "") +
      '<div class="wl-card">' +
        '<div class="wl-net-f"><label>YOUR NAME</label><input id="nName" maxlength="18" value="' + esc(nm) + '"></div>' +
        '<div class="wl-net-f"><label>SERVER</label><input id="nUrl" value="' + esc(url) + '"></div>' +
        '<div class="wl-net-f"><label>SEED</label><input id="nSeed" value="' + esc(seed) + '"></div>' +
      '</div>' +
      '<div class="wl-card"><div class="wl-net-note">' +
        'The first warlord into an empty server sets the island; everybody else rides the one ' +
        'that is already there. <b>The map is never sent</b> — the whole world is that one number, ' +
        'and every machine builds the same 14 km of sand from it.' +
      '</div></div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="nGo">RIDE OUT TOGETHER</button>' +
        '<button class="wl-btn" id="nBack">BACK</button>' +
      '</div>' +
      '<div class="wl-lbl">NO SERVER?</div>' +
      '<div class="wl-card"><div class="wl-net-note">' +
        'The server is in this repo and needs nothing installed:' +
        '<code class="wl-net-code">node server/server.js</code>' +
        'It serves the game <i>and</i> the socket on port 8000, so open ' +
        '<b>http://localhost:8000/games/warlord.html</b> and the SERVER box above already points at it. ' +
        'To play with people who are not on your wifi, put a tunnel in front of it:' +
        '<code class="wl-net-code">cloudflared tunnel --url http://localhost:8000</code>' +
        'and hand out the https link it prints — that link IS your island.' +
      '</div></div>'
    );
    const go = ctx.el("nGo");
    if (go) go.onclick = function () {
      const name = (ctx.el("nName").value || "WARLORD").slice(0, 18);
      const u = ctx.el("nUrl").value || defaultUrl();
      const sd = parseInt(ctx.el("nSeed").value, 10) || 1337;
      try { localStorage.setItem("cbz-warlord-name", name); localStorage.setItem("cbz-warlord-url", u); } catch (e) {}
      waiting("OPENING THE LINE");
      connect({ name: name, url: u, seed: sd });
    };
    const bk = ctx.el("nBack");
    if (bk) bk.onclick = function () { LOBBYERR = ""; W.emit("mainmenu"); };
  }

  function waiting(msg) {
    if (!ctx || !ctx.screen) return;
    ctx.screen('<h1 class="wl-h">' + esc(msg) + '</h1><p class="wl-sub">WAITING FOR THE ISLAND</p>' +
      '<div class="wl-btns"><button class="wl-btn" id="nCancel">CANCEL</button></div>');
    const c = ctx.el("nCancel");
    if (c) c.onclick = function () { disconnect(); connectCard(); };
  }

  function warRoom() {
    if (!ctx || !ctx.screen || hasMatch()) return;
    styleOnce();
    const S = W.state;
    const list = peerList();
    let h = '<h1 class="wl-h">THE <em>ISLAND</em></h1>' +
      '<p class="wl-sub">SEED ' + S.seed + '  ·  ' + (isHost() ? "YOU ARE SIMULATING IT" : "SOMEBODY ELSE IS SIMULATING IT") + '</p>';
    h += '<div class="wl-lbl">WARLORDS · ' + (list.length + 1) + '</div><div class="wl-card">';
    h += '<div class="wl-net-p"><span class="wl-net-dot" style="background:' + hex(colourFor(net() ? net().id : 0)) + '"></span>' +
      '<span><span class="wl-net-nm">' + esc(MYNAME) + '</span><br><span class="wl-net-sub">' +
      (S.army.length + 1) + ' men  ·  power ' + Math.round(W.yourPower()) + '</span></span>' +
      '<span class="wl-net-tag">YOU</span></div>';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      h += '<div class="wl-net-p"><span class="wl-net-dot" style="background:' + hex(p.colour) + '"></span>' +
        '<span><span class="wl-net-nm">' + esc(p.name) + '</span><br><span class="wl-net-sub">' +
        p.size + ' men  ·  power ' + Math.round(p.pw || 0) + '</span></span>' +
        '<span class="wl-net-tag' + (p.ally ? " ally" : "") + '">' + (p.ally ? "ALLY" : "RIVAL") + '</span></div>';
    }
    if (!list.length) h += '<div class="wl-net-note" style="padding-top:8px">nobody else yet. ride out — they appear on the map the moment they join.</div>';
    h += '</div>';
    h += '<div class="wl-btns">' +
      '<button class="wl-btn hot" id="nRide">RIDE OUT</button>' +
      '<button class="wl-btn bad" id="nQuit">LEAVE THE ISLAND</button></div>';
    const node = ctx.screen(h);
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "nRide") {
        if (W.campaign && W.campaign.enter) W.campaign.enter();
        else W.toast("campaign.js did not load — no island to ride", "bad");
      } else if (t.id === "nQuit") { disconnect(); connectCard(); }
    };
  }

  /* ============================================================================
     ============================  F A L L B A C K  ============================
     EVERYTHING BELOW HERE IS GAMEPLAY AND DOES NOT BELONG IN A TRANSPORT FILE.
     It exists so that multiplayer is playable before match.js lands, and it is
     switched off entirely — not merely hidden — the moment W.match exists.
     When match.js owns the encounter, delete this block.
     ========================================================================= */
  let MEET = null, DUEL = null, TRADE = null, OFFER = null;
  const ALLIES = {}, COOL = {};
  const MEET_RANGE = 150;

  function closeFallback() { MEET = null; DUEL = null; TRADE = null; OFFER = null; }

  function wireFallback() {
    on("duel", function (d, from) { onChallenge(d, from); });
    on("duelno", function (d, from) {
      if (!DUEL || DUEL.peer.id !== from) return;
      const nm = DUEL.peer.name; DUEL = null;
      W.toast(nm + " broke away", "bad"); backToRide();
    });
    on("duelok", function (d, from) {
      if (!DUEL || DUEL.peer.id !== from || DUEL.role !== "a") return;
      runDuel(DUEL.seed, DUEL.mine, { pw: d.pw, size: d.n }, true, DUEL.peer);
    });
    on("spoils", function (d, from) { takeSpoils(d, from); });
    on("ally", function (d, from) { onAllyOffer(from); });
    on("allyok", function (d, from) {
      ALLIES[from] = true;
      const p = W.state.peers[from]; if (p) p.ally = true;
      W.toast((p ? p.name : "they") + " accepted your alliance", "good");
      if (MEET && MEET.id === from) drawMeet();
    });
    on("allyno", function (d, from) {
      const p = W.state.peers[from];
      W.toast((p ? p.name : "they") + " refused", "bad");
      if (MEET && MEET.id === from) drawMeet();
    });
    /* TRADE: OFFER → ACCEPT → DONE. The proposer gives up his guns when the
       accept arrives and only then tells the other side to pay, so if the link
       dies mid-exchange the ACCEPTER has lost nothing — the failure mode to
       prefer when one of the two people is the one who opened the trade. */
    on("trade", function (d, from) { onTradeOffer(d, from); });
    on("tradeok", function (d, from) {
      if (!TRADE || TRADE.peer.id !== from || TRADE.role !== "a") return;
      const t = TRADE;
      for (const wid in t.guns) W.unstash(wid, t.guns[wid]);
      W.earn(t.gold);
      send("tradedone", { guns: t.guns, gold: t.gold }, from);
      W.log("traded " + gunsLabel(t.guns) + " to " + t.peer.name + " for $" + t.gold + ".", "good");
      W.toast("deal done", "good");
      TRADE = null; backToRide();
    });
    on("tradeno", function () {
      if (!TRADE) return;
      W.toast(TRADE.peer.name + " refused the deal", "bad");
      TRADE = null; drawMeet();
    });
    on("tradedone", function (d) {
      if (!W.pay(d.gold)) { W.toast("you could not cover the deal", "bad"); return; }
      for (const wid in d.guns || {}) W.stash(wid, d.guns[wid]);
      W.log("bought " + gunsLabel(d.guns) + " for $" + d.gold + ".", "good");
      W.toast("crates loaded", "good");
      TRADE = null; backToRide();
    });
    sub("leave", function (id, name) {
      /* A PLAYER WHO VANISHES MID-ENCOUNTER must not leave a card up with a
         button nobody will ever answer. Nothing has been applied at this point
         in any of the three exchanges, so cancelling costs neither side. */
      if (MEET && MEET.id === id) { closeFallback(); backToRide(); W.toast((name || "they") + " rode out of the world", "bad"); }
    });
  }

  function maybeMeet(p) {
    if (!ACTIVE || MEET || OLD_PEERS) return;
    if (W.phase() !== "campaign") return;
    if ((COOL[p.id] || 0) > now()) return;
    const S = W.state;
    const dx = p.x - S.you.x, dz = p.z - S.you.z;
    if (dx * dx + dz * dz > MEET_RANGE * MEET_RANGE) return;
    // army.js owns the `encounter` phase; if it has a card up we wait for the
    // next update rather than fight it for the screen.
    if (W.army && W.army.busy && W.army.busy()) return;
    MEET = p;
    W.setPhase("encounter", { kind: "pvp", peer: p });
    drawMeet();
    W.emit("warnet:meet", p);
  }

  function drawMeet() {
    if (!MEET || !ctx || !ctx.screen) return;
    styleOnce();
    const p = MEET;
    const mine = W.yourPower();
    const odds = W.odds(mine, p.pw || 1);
    let h = '<h1 class="wl-h">' + esc(p.name) + '</h1>' +
      '<p class="wl-sub">ANOTHER WARLORD · ' + (p.ally ? "YOUR ALLY" : "NO TREATY") + '</p>' +
      '<div class="wl-card">' +
        '<div class="wl-row"><span>THEIRS</span><span>' + p.size + ' MEN  ·  POWER ' + Math.round(p.pw || 0) + '</span></div>' +
        '<div class="wl-row"><span>YOURS</span><span>' + W.armySize() + ' MEN  ·  POWER ' + Math.round(mine) + '</span></div>' +
        '<div class="wl-row"><span>IF YOU CHARGE</span><span class="' + (odds > 0.5 ? "wl-gold" : "") + '">' + Math.round(odds * 100) + '% TO WIN</span></div>' +
      '</div>';
    if (DUEL) {
      h += '<div class="wl-card"><div class="wl-net-note">' +
        (DUEL.role === "a" ? "You have called them out. Waiting for an answer…" : "They are charging you.") +
        '</div></div>';
      h += DUEL.role === "b"
        ? '<div class="wl-btns"><button class="wl-btn bad" id="mAccept">MEET THEM</button>' +
          '<button class="wl-btn" id="mFlee">BREAK AWAY</button></div>'
        : '<div class="wl-btns"><button class="wl-btn" id="mCancel">CALL IT OFF</button></div>';
    } else if (TRADE && TRADE.role === "b") {
      h += '<div class="wl-card"><div class="wl-lbl" style="margin-top:0">THEY OFFER</div>' +
        '<div class="wl-row"><span>' + esc(gunsLabel(TRADE.guns)) + '</span><span class="wl-gold">FOR $' + TRADE.gold + '</span></div>' +
        '</div><div class="wl-btns">' +
        '<button class="wl-btn hot" id="mTakeDeal"' + (W.state.gold < TRADE.gold ? " disabled" : "") + '>PAY $' + TRADE.gold + '</button>' +
        '<button class="wl-btn" id="mNoDeal">NO DEAL</button></div>';
    } else if (TRADE && TRADE.role === "a") {
      h += '<div class="wl-card"><div class="wl-net-note">Offer sent. Waiting…</div></div>';
    } else {
      h += '<div class="wl-btns">' +
        (p.ally ? "" : '<button class="wl-btn bad" id="mAttack">ATTACK</button>') +
        (p.ally ? "" : '<button class="wl-btn" id="mAlly">ALLY</button>') +
        '<button class="wl-btn" id="mTrade">TRADE</button>' +
        '<button class="wl-btn hot" id="mLeave">RIDE ON</button></div>';
    }
    const node = ctx.screen(h);
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      switch (t.id) {
        case "mAttack": challenge(p); break;
        case "mAlly": send("ally", null, p.id); W.toast("offer sent", ""); break;
        case "mTrade": OFFER = OFFER || { guns: {}, gold: 0 }; drawTrade(p); break;
        case "mLeave": leaveMeet(); break;
        case "mAccept": acceptChallenge(); break;
        case "mFlee": send("duelno", null, p.id); DUEL = null; leaveMeet(); break;
        case "mCancel": send("duelno", null, p.id); DUEL = null; drawMeet(); break;
        case "mTakeDeal": send("tradeok", null, p.id); TRADE = null; W.toast("waiting on the crates…", ""); drawMeet(); break;
        case "mNoDeal": send("tradeno", null, p.id); TRADE = null; drawMeet(); break;
      }
    };
  }

  function leaveMeet() {
    if (MEET) COOL[MEET.id] = now() + 30000;
    closeFallback();
    backToRide();
  }
  function backToRide() {
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else if (W.phase() !== "menu") W.setPhase("campaign");
  }

  function myCard() { return { pw: Math.round(W.yourPower() * 100) / 100, size: W.armySize() }; }

  function challenge(p) {
    const mine = myCard();
    /* THE SEED IS THE CONTRACT. Both machines resolve the same battle from
       this one integer plus the two power numbers, and nothing else crosses
       the wire — no per-tick state, nothing to desync, and no reason for the
       other five players on the island to wait for any of it. */
    const seed = (Math.random() * 0x7fffffff) | 0;
    DUEL = { peer: p, seed: seed, mine: mine, role: "a", t: now() };
    send("duel", { seed: seed, pw: mine.pw, n: mine.size, nm: MYNAME }, p.id);
    drawMeet();
    /* A CHALLENGE NOBODY ANSWERS must not lock the screen — the clock does not
       stop for a player who closed his tab. Seven seconds and it is a refusal. */
    setTimeout(function () {
      if (DUEL && DUEL.role === "a" && DUEL.seed === seed) {
        DUEL = null; MEET = null;
        W.toast("no answer — they rode off", "bad"); backToRide();
      }
    }, 7000);
  }

  function onChallenge(d, from) {
    const p = W.state.peers[from] || (W.state.peers[from] = { id: from, name: d.nm, colour: colourFor(from) });
    p.pw = d.pw; p.size = d.n; p.name = p.name || d.nm; p.t = now();
    MEET = p;
    DUEL = { peer: p, seed: d.seed | 0, theirs: { pw: d.pw, size: d.n }, mine: myCard(), role: "b" };
    if (W.phase() !== "encounter") W.setPhase("encounter", { kind: "pvp", peer: p });
    drawMeet();
  }

  function acceptChallenge() {
    if (!DUEL || DUEL.role !== "b") return;
    const mine = DUEL.mine;
    send("duelok", { pw: mine.pw, n: mine.size }, DUEL.peer.id);
    runDuel(DUEL.seed, DUEL.theirs, mine, false, DUEL.peer);
  }

  /* ONE PURE FUNCTION, RUN TWICE. Same seed, same two numbers, same draws in
     the same order — so both screens print the same battle without a single
     further packet. `a` is always the challenger on both machines, which is
     why the caller passes them in that order rather than "me and them". */
  function resolve(seed, a, b) {
    const rnd = W.rngFrom(seed | 0);
    const p = W.odds(a.pw, b.pw);
    const aWins = rnd() < p;
    const win = aWins ? a : b, lose = aWins ? b : a;
    const edge = clamp(win.pw / Math.max(0.001, lose.pw), 1, 6);
    /* CASUALTIES COME OFF THE EDGE, not off the roll. A warlord who wins at
       1.05:1 walks away with almost nothing left, and that is the only thing
       stopping "attack everyone, always" from being the correct play — the
       same brake wages are on the campaign. */
    const loserLoss = clamp(0.36 + 0.09 * edge + rnd() * 0.18, 0.3, 0.95);
    const winnerLoss = clamp(0.34 / edge + rnd() * 0.09, 0.03, 0.5);
    return { aWins: aWins, aLoss: aWins ? winnerLoss : loserLoss, bLoss: aWins ? loserLoss : winnerLoss };
  }

  function runDuel(seed, a, b, iAmA, peer) {
    const res = resolve(seed, a, b);
    const iWon = (iAmA === res.aWins);
    const myLoss = iAmA ? res.aLoss : res.bLoss;
    const S = W.state;

    /* EACH CLIENT KILLS ITS OWN MEN. The shared model says WHAT FRACTION
       died; which men those are is a question only the machine holding the
       roster can answer, and it is the one thing it is unambiguously
       authoritative over. The weakest fall first — they are standing in front. */
    const order = S.army.slice().sort(function (x, y) { return W.soldierPower(x) - W.soldierPower(y); });
    const kill = Math.min(order.length, Math.round(myLoss * order.length));
    const dropped = {};
    for (let i = 0; i < kill; i++) {
      const s = order[i];
      if (s.wid && s.wid !== "fists") dropped[s.wid] = (dropped[s.wid] || 0) + 1;
      W.removeSoldier(s.id, false);        // his gun is on the field, not in your cart
    }
    const left = S.army.slice();
    for (let i = 0; i < left.length; i++) if (W.chance(0.3)) left[i].wounded = true;
    W.promoteSurvivors(left);
    S.stats.battles++;
    if (iWon) S.stats.won++;
    S.stats.lost += kill;
    S.fame += iWon ? Math.round((iAmA ? b.size : a.size) * 0.8) : 0;

    if (!iWon) {
      /* THE LOSER HANDS OVER THE SPOILS, because the loser is the only one who
         knows what he had. A quarter of the purse, the guns off his dead, and
         the men who threw theirs down. */
      const gold = Math.round(S.gold * 0.25);
      W.pay(gold);
      const men = [];
      const weak = S.army.slice().sort(function (x, y) { return W.soldierPower(x) - W.soldierPower(y); });
      for (let i = 0; i < Math.min(3, weak.length); i++) men.push(W.removeSoldier(weak[i].id, false));
      const guns = {};
      let n = 0;
      for (const wid in dropped) { guns[wid] = Math.ceil(dropped[wid] * 0.5); n += guns[wid]; if (n > 12) break; }
      send("spoils", { gold: gold, guns: guns, men: men.filter(Boolean) }, peer.id);
    }

    W.log((iWon ? "beat " : "lost to ") + peer.name + " — " + kill + " of your men died.", iWon ? "good" : "bad");
    showResult(iWon, kill, peer, myLoss);
    W.emit("warnet:duel", { won: iWon, peer: peer, killed: kill });
    DUEL = null;
    if (MEET) COOL[MEET.id] = now() + 45000;
  }

  function takeSpoils(d, from) {
    const p = W.state.peers[from];
    let men = 0;
    for (const wid in d.guns || {}) W.stash(wid, d.guns[wid]);
    if (d.men && d.men.length) {
      for (let i = 0; i < d.men.length; i++) {
        const s = d.men[i];
        if (!s || !s.tier) continue;
        /* Rebuilt through core's constructor rather than trusted as-is: a
           roster arriving off the wire is the one place a malformed soldier
           could get into your army, and makeSoldier is the only shape the
           battle knows how to read. */
        W.state.prisoners.push(W.makeSoldier(s.tier, s.wid, { name: s.name, armour: s.armour, kills: s.kills, battles: s.battles, wounded: true }));
        men++;
      }
    }
    if (d.gold) W.earn(d.gold);
    W.log("took $" + (d.gold || 0) + ", " + men + " prisoners and their guns from " + (p ? p.name : "a beaten warlord") + ".", "good");
    W.toast("spoils taken", "good");
  }

  function showResult(won, killed, peer, loss) {
    if (!ctx || !ctx.screen) return;
    const S = W.state;
    ctx.screen(
      '<h1 class="wl-h">' + (won ? "THEY <em>BROKE</em>" : "YOU ARE <em>BEATEN</em>") + '</h1>' +
      '<p class="wl-sub">AGAINST ' + esc(peer.name) + '</p>' +
      '<div class="wl-card">' +
        '<div class="wl-row"><span>YOUR DEAD</span><span>' + killed + ' MEN  ·  ' + Math.round(loss * 100) + '%</span></div>' +
        '<div class="wl-row"><span>STILL STANDING</span><span>' + W.armySize() + ' MEN</span></div>' +
        '<div class="wl-row"><span>PURSE</span><span class="wl-gold">$' + S.gold + '</span></div>' +
        (S.prisoners.length ? '<div class="wl-row"><span>PRISONERS</span><span>' + S.prisoners.length + '</span></div>' : '') +
      '</div>' +
      '<div class="wl-card"><div class="wl-net-note">Both of you watched the same battle — one seed, one model, ' +
        'no argument about who died, and nobody else on the island waited for it.</div></div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="rGo">RIDE ON</button>' +
        '<button class="wl-btn" id="rArm">ARMOURY</button></div>'
    );
    const g = ctx.el("rGo"), a = ctx.el("rArm");
    if (g) g.onclick = function () { MEET = null; backToRide(); };
    if (a) a.onclick = function () { MEET = null; if (W.loadout) W.loadout.open(); };
  }

  function onAllyOffer(from) {
    const p = W.state.peers[from];
    if (!p || !ctx || !ctx.screen) return;
    if (!MEET) { MEET = p; W.setPhase("encounter", { kind: "pvp", peer: p }); }
    styleOnce();
    ctx.screen(
      '<h1 class="wl-h">' + esc(p.name) + ' <em>OFFERS PEACE</em></h1>' +
      '<p class="wl-sub">' + p.size + ' MEN · POWER ' + Math.round(p.pw || 0) + '</p>' +
      '<div class="wl-card"><div class="wl-net-note">An alliance is a promise not to charge each other. ' +
        'It holds exactly as long as both of you want it to.</div></div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="aYes">TAKE HIS HAND</button>' +
        '<button class="wl-btn bad" id="aNo">REFUSE</button></div>'
    );
    ctx.el("aYes").onclick = function () {
      ALLIES[p.id] = true; p.ally = true;
      send("allyok", null, p.id);
      W.toast("allied with " + p.name, "good");
      drawMeet();
    };
    ctx.el("aNo").onclick = function () { send("allyno", null, p.id); drawMeet(); };
  }

  function drawTrade(p) {
    if (!ctx || !ctx.screen) return;
    const S = W.state;
    const ids = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    let worth = 0;
    for (const k in OFFER.guns) worth += W.gunPrice(k) * OFFER.guns[k];
    let h = '<h1 class="wl-h">DEAL WITH <em>' + esc(p.name) + '</em></h1>' +
      '<p class="wl-sub">OUT OF YOUR BAGGAGE TRAIN</p><div class="wl-card">';
    if (!ids.length) h += '<div class="wl-net-note">you have nothing loose to sell.</div>';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], sel = OFFER.guns[id] || 0;
      h += '<div class="wl-row"><span>' + W.gunLabel(id) + ' <span class="wl-dim wl-small">×' + S.baggage[id] + '  ·  LIST $' + W.gunPrice(id) + '</span></span>' +
        '<span><button class="wl-btn" data-less="' + id + '">−</button> ' + sel +
        ' <button class="wl-btn" data-more="' + id + '">+</button></span></div>';
    }
    h += '</div><div class="wl-lbl">YOUR PRICE</div><div class="wl-card">' +
      '<div class="wl-row"><span class="wl-gold" style="font-size:22px">$' + OFFER.gold + '</span>' +
      '<span><button class="wl-btn" data-gold="-100">−100</button> <button class="wl-btn" data-gold="-25">−25</button> ' +
      '<button class="wl-btn" data-gold="25">+25</button> <button class="wl-btn" data-gold="100">+100</button></span></div>' +
      '<div class="wl-row"><span class="wl-small wl-dim">LIST VALUE OF WHAT YOU OFFER</span><span class="wl-small wl-dim">$' + worth + '</span></div>' +
      '</div><div class="wl-btns">' +
        '<button class="wl-btn hot" id="tSend"' + (worth ? "" : " disabled") + '>SEND THE OFFER</button>' +
        '<button class="wl-btn" id="tBack">BACK</button></div>';
    const node = ctx.screen(h);
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.hasAttribute("data-more")) {
        const id = t.getAttribute("data-more");
        if ((OFFER.guns[id] || 0) < S.baggage[id]) OFFER.guns[id] = (OFFER.guns[id] || 0) + 1;
        drawTrade(p); return;
      }
      if (t.hasAttribute("data-less")) {
        const id = t.getAttribute("data-less");
        OFFER.guns[id] = Math.max(0, (OFFER.guns[id] || 0) - 1);
        if (!OFFER.guns[id]) delete OFFER.guns[id];
        drawTrade(p); return;
      }
      if (t.hasAttribute("data-gold")) {
        OFFER.gold = Math.max(0, OFFER.gold + parseInt(t.getAttribute("data-gold"), 10));
        drawTrade(p); return;
      }
      if (t.id === "tSend") {
        TRADE = { peer: p, guns: OFFER.guns, gold: OFFER.gold, role: "a" };
        send("trade", { guns: OFFER.guns, gold: OFFER.gold }, p.id);
        OFFER = null; drawMeet(); return;
      }
      if (t.id === "tBack") { OFFER = null; drawMeet(); return; }
    };
  }
  function onTradeOffer(d, from) {
    const p = W.state.peers[from];
    if (!p) return;
    if (!MEET) { MEET = p; W.setPhase("encounter", { kind: "pvp", peer: p }); }
    TRADE = { peer: p, guns: d.guns || {}, gold: d.gold | 0, role: "b" };
    drawMeet();
    W.emit("warnet:trade", TRADE);
  }
  function gunsLabel(guns) {
    const out = [];
    for (const k in guns || {}) out.push(W.gunLabel(k) + " ×" + guns[k]);
    return out.join(", ") || "nothing";
  }

  /* ============================================================ MODULE
     THE TRANSPORT API. match.js sits on exactly this and nothing else.
     Every subscription returns its own unsubscribe. */
  W.module("warnet", {
    boot: function (c) {
      ctx = c;
      styleOnce();
      if (Q.get("netlobby")) setTimeout(function () { W.setPhase("menu"); lobby(); }, 0);
    },

    // ---- connection ----
    lobby: lobby,                 // shell button; hands straight to match.js if present
    connectCard: connectCard,     // the three-field card, for a match.js that wants it
    connect: connect,             // ({name,url,seed,onReady,onError}) -> Promise
    disconnect: disconnect,
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

    // ---- the shared battle model. match.js may own the RULES; this is the
    //      pure function both clients must agree on, exported so it can.
    resolve: resolve,

    // ---- fallback only; false the moment match.js exists ----
    fallback: function () { return !hasMatch(); },
    encounterOpen: function () { return !!MEET; },
  });
})();
