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
          else connectCard();
        },
      });
      if (opts.onReady) sub("world", opts.onReady);
      return N;
    }).catch(function () {
      LOBBYERR = "src/net/net.js did not load — multiplayer is unavailable. Single player is unaffected.";
      if (opts.onError) opts.onError(LOBBYERR);
      else connectCard();
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
  function applyWorld(w, mine) {
    ACTIVE = true;
    /* THE DEFAULT IS ONLY A DEFAULT. match.js owns spawn placement and the
       shape of a session, so if it is on the page it decides what "start on
       this island" means and this file does nothing but hand it the seed. */
    W.newGame({ seed: w.seed, mode: "net", name: MYNAME });
    W.state.day = w.day; W.state.hour = w.hour;
    ping("world", w, mine);
    W.emit("warnet:on", { seed: w.seed, host: mine });
    W.log("riding a shared island. seed " + w.seed + ".");
    warRoom();
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
  /* .wl-net-code went with the shell commands it styled. */
  .wl-net-p{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;
    padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-net-p:last-child{border-bottom:0}
  .wl-net-dot{width:12px;height:12px;border-radius:3px}
  .wl-net-nm{font-size:14px;letter-spacing:.03em}
  .wl-net-sub{font-size:10.5px;letter-spacing:.06em;opacity:.5}
  .wl-net-tag{font-size:10px;letter-spacing:.16em;opacity:.7}
  .wl-net-tag.ally{color:#8fe0a2}
  .wl-net-err{color:#ffc9c4;font-size:12px;letter-spacing:.05em;line-height:1.5}
  /* .wl-net-note styled the two explanatory paragraphs this file used to
     print at the person opening a socket. Both are deleted (SHOW DONT TELL);
     the rule goes with them rather than sitting here waiting to be filled. */`;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-net-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-net-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  /* THERE IS NO LOBBY ANY MORE. match.js used to own one — eight slots, a
     colour picker, an AI count, a START button — and this function existed
     only to hand the shell's MULTIPLAYER button over to it, with a
     three-branch identity check to keep the handoff from becoming an
     infinite loop. The lobby went with the match layer (see match.js's
     tombstone): warlord mode is a campaign you can share, not a session you
     assemble, so the button opens the one thing that is actually needed,
     which is the address of the island. */
  function lobby() { connectCard(); }

  function connectCard() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    if (ACTIVE) { warRoom(); return; }
    const url = (function () { try { return localStorage.getItem("cbz-warlord-url") || defaultUrl(); } catch (e) { return defaultUrl(); } })();
    let nm = "";
    try { nm = localStorage.getItem("cbz-warlord-name") || ""; } catch (e) {}
    nm = nm || "WARLORD " + (1 + Math.floor(Math.random() * 89));
    const seed = Q.get("seed") || String(1000 + Math.floor(Math.random() * 8999));
    /* THREE FIELDS AND A VERB. What used to be here was 690 characters of
       the interface explaining itself: a paragraph on how seeds work ("the
       map is never sent — the whole world is that one number"), a "NO
       SERVER?" section with two shell commands and a sentence about
       cloudflared tunnels, and a subtitle about a clock that no longer
       exists. The owner: "SHOW DONT TELL for warlord … just too much talking
       of the ui."

       None of it was information the person at this screen could act on: if
       they have a server they paste it, and if they do not, a paragraph in a
       game about running `node server/server.js` is documentation printed in
       the wrong place. It is in server/README and in this repo's own docs.
       An error, on the other hand, IS actionable and stays. */
    ctx.screen(
      '<h1 class="wl-h">ONE ISLAND, <em>MANY WARLORDS</em></h1>' +
      (LOBBYERR ? '<div class="wl-card"><div class="wl-net-err">' + esc(LOBBYERR) + '</div></div>' : "") +
      '<div class="wl-card">' +
        '<div class="wl-net-f"><label>YOUR NAME</label><input id="nName" maxlength="18" value="' + esc(nm) + '"></div>' +
        '<div class="wl-net-f"><label>SERVER</label><input id="nUrl" value="' + esc(url) + '"></div>' +
        '<div class="wl-net-f"><label>SEED</label><input id="nSeed" value="' + esc(seed) + '"></div>' +
      '</div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="nGo">RIDE OUT</button>' +
        '<button class="wl-btn" id="nBack">BACK</button>' +
      '</div>'
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
    ctx.screen('<h1 class="wl-h">' + esc(msg) + '</h1>' +
      '<div class="wl-btns"><button class="wl-btn" id="nCancel">CANCEL</button></div>');
    const c = ctx.el("nCancel");
    if (c) c.onclick = function () { disconnect(); connectCard(); };
  }

  function warRoom() {
    if (!ctx || !ctx.screen) return;
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
    /* An empty peer list used to carry a sentence explaining that peers
       appear on the map when they join. The list being empty already says
       it. */
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

  });
})();
