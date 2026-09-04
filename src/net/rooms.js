/* ============================================================
   net/rooms.js — A ROOM IS SOMEBODY'S BROWSER TAB.

   THE BUG THIS FILE FIXES. games/warlord.html is deployed on GitHub Pages
   and its MULTIPLAYER button opened a WebSocket to `wss://<host>/ws`. Pages
   is a static file host: nothing has ever answered on that path, the error
   text told a phone user to run `node server/server.js`, and so nobody has
   ever played this game's multiplayer from the link it ships behind. The
   transport was not slow or flaky. It was absent.

   WHAT IS TRUE NOW. One of the players IS the server. The room owner's
   browser opens a PeerJS peer under a well-known id (`cbz-<CODE>`), every
   guest opens a WebRTC DataConnection to it, and this file runs — inside
   that tab — the exact room logic server/server.js runs in node:

       hello -> welcome (id, hostId, feat, server, players)
       name dedupe, pid reconnect dedupe, deny (full)
       join / leave broadcast
       host election = oldest joinedAt, re-elected on leave
       t:"state"  stamped with the sender id, broadcast, SHEDABLE
       t:"world"  refused from anyone who is not the elected sim host
       t:"ev"     reliable; `to`-wrapped point-to-point behind RESERVED_EV
       chat + /me /do /ooc /players /help /kick /announce

   Same verbs, same fields, same semantics — because src/net/net.js's
   handle() is not allowed to know which one it is talking to. The only
   thing a room cannot do is PERSIST (there is no disk in a tab), so `feat`
   is ["to"] and the wsave/csave/wload/cload verbs are dropped exactly where
   server.js writes them to disk.

   SIGNALLING, AND WHAT IT COSTS. PeerJS's public cloud broker (0.peerjs.com,
   no account) is used ONLY to exchange the two SDP blobs that open the
   DataChannel. After that the game traffic is peer-to-peer and the broker is
   out of the path — a room survives the broker going down; it just cannot
   admit new players. That is the whole reason this is not "a free server":
   there is no free server, there is a phone with a code on it.

   THE ROOM DIES WITH THE TAB. Not a bug and not fixable without a server:
   the relay IS that tab. Say it in the UI, do not pretend otherwise.

   ICE. PeerJS defaults to Google's public STUN, which is enough for the
   ordinary home/mobile NAT pair. Symmetric NAT on BOTH ends (some corporate
   and carrier-grade networks) needs a TURN relay, which nobody can give away
   for free — so the seam is `CBZ.iceServers` (set it in a page, or drop a
   `<meta name="cbz-ice" content='[...]'>` in the HTML) and MULTIPLAYER.md
   names the cases that fail without one.

   PLAIN NODE. Everything above the transport — makeRelay() — is pure: it
   takes connection objects with {send, close, buffered} and never touches
   the DOM, WebRTC or a timer. tools/test-rooms.mjs runs it against fake
   connections, so the room protocol is tested without a browser or an
   internet connection.
============================================================ */
(function (G) {
  "use strict";

  /* ------------------------------------------------------------------ CODES
     Four characters, and NOT base36: I/1 and O/0 are the two pairs a person
     reads aloud wrong, and a room code exists to be read aloud. 32^4 is a
     million rooms, which is far past what one signalling broker will ever
     hold at once, and a collision is not silent — PeerJS refuses a taken id
     and open() rolls again. */
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function newCode() {
    let s = "";
    const buf = (G.crypto && G.crypto.getRandomValues)
      ? G.crypto.getRandomValues(new Uint8Array(4)) : null;
    for (let i = 0; i < 4; i++) {
      const n = buf ? buf[i] : Math.floor(Math.random() * 256);
      s += ALPHABET[n % ALPHABET.length];
    }
    return s;
  }
  /* A TYPED CODE IS A HUMAN'S CODE. Lowercase, spaces and dashes are
     corrected rather than refused — refusing "ab cd" because it is not
     "ABCD" is an interface being right at somebody. The four glyphs the
     alphabet leaves out (I 1 O 0) are dropped rather than substituted:
     neither member of either pair is ever in a real code, so there is no
     "did you mean" to make, and a silent substitution would turn a typo into
     a different valid code — which is how you join a stranger's room. */
  const OK = {};
  for (let i = 0; i < ALPHABET.length; i++) OK[ALPHABET[i]] = 1;
  function cleanCode(s) {
    const up = String(s == null ? "" : s).toUpperCase();
    let out = "";
    for (let i = 0; i < up.length && out.length < 4; i++) if (OK[up[i]]) out += up[i];
    return out;
  }

  /* ====================================================== THE ROOM PROTOCOL
     server/server.js:676-935, moved into a tab. Deliberately a near-literal
     port: this is the one file in the repo where "consistency with the
     existing code" IS the requirement, because net.js's handle() dispatches
     on these exact verbs and fields and cannot be allowed to notice which
     end it is attached to. Where a line differs from server.js it says so. */
  const FEAT = ["to"];                            // no "persist": a tab has no disk
  const RESERVED_EV = { to: 1, wsave: 1, csave: 1, wload: 1, cload: 1 };
  /* 256 KB, half server.js's 512 KB. A node socket buffers into process
     memory; an RTCDataChannel buffers into the browser's own send queue and
     starts dropping the whole channel far sooner, so the shed threshold has
     to sit lower than the one that kills the connection. */
  const BP_LIMIT = 256 * 1024;

  const sanitizeName = function (n) {
    return String(n || "").replace(/[^\w \-'.]/g, "").trim().slice(0, 20) || "Stranger";
  };

  function makeRelay(opts) {
    opts = opts || {};
    const maxPlayers = opts.maxPlayers || 8;
    const info = {
      name: opts.name || "A ROOM", motd: opts.motd || "", tags: opts.tags || ["room"],
      maxPlayers: maxPlayers, iceServers: opts.iceServers || [],
    };
    const players = new Map();      // id -> {id, name, role, pid, conn, admin, joinedAt}
    let nextId = 1;
    let hostId = null;
    let bpDropped = 0;

    function bpShedable(msg) {
      if (msg.t === "world" || msg.t === "state") return true;
      return msg.t === "ev" && msg.e === "to" && msg.d &&
        (msg.d.t === "world" || msg.d.t === "state");
    }
    function buffered(p) {
      try { return (p.conn.buffered && p.conn.buffered()) || 0; } catch (e) { return 0; }
    }
    function send(p, msg) {
      if (bpShedable(msg) && buffered(p) > BP_LIMIT) { bpDropped++; return; }
      try { p.conn.send(JSON.stringify(msg)); } catch (e) {}
    }
    function broadcast(msg, exceptId) {
      const str = JSON.stringify(msg);
      const shed = bpShedable(msg);
      players.forEach(function (p) {
        if (p.id === exceptId) return;
        if (shed && buffered(p) > BP_LIMIT) { bpDropped++; return; }
        try { p.conn.send(str); } catch (e) {}
      });
    }
    function pickHost() {
      let oldest = null;
      players.forEach(function (p) { if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p; });
      return oldest ? oldest.id : null;
    }
    function setHost(id) {
      if (hostId === id) return;
      hostId = id;
      if (id != null) broadcast({ t: "host", id: id });
    }
    function onLeave(p) {
      if (!players.has(p.id)) return;
      players.delete(p.id);
      broadcast({ t: "leave", id: p.id });
      if (hostId === p.id) setHost(pickHost());
      if (opts.onRoster) try { opts.onRoster(roster()); } catch (e) {}
    }
    function roster() {
      const out = [];
      players.forEach(function (p) {
        out.push({ id: p.id, name: p.name, role: p.role, host: p.id === hostId });
      });
      out.sort(function (a, b) { return a.id - b.id; });
      return out;
    }

    function handleCommand(p, text) {
      const parts = text.slice(1).split(" ");
      const cmd = (parts.shift() || "").toLowerCase();
      const arg = parts.join(" ").trim();
      switch (cmd) {
        case "me": case "do": case "ooc":
          if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: cmd, text: arg });
          break;
        case "help":
          send(p, { t: "sys", text: "/me <action>, /do <scene>, /ooc <text>, /players" + (p.admin ? ", /kick <name>, /announce <text>" : "") });
          break;
        case "players": {
          const list = roster().map(function (q) { return q.name + (q.host ? " (host)" : ""); }).join(", ");
          send(p, { t: "sys", text: players.size + "/" + maxPlayers + ": " + list });
          break;
        }
        case "kick": {
          if (!p.admin) { send(p, { t: "sys", text: "The room owner only." }); break; }
          let target = null;
          players.forEach(function (q) { if (q.name.toLowerCase() === arg.toLowerCase()) target = q; });
          if (!target) { send(p, { t: "sys", text: 'No player named "' + arg + '".' }); break; }
          if (target.id === p.id) { send(p, { t: "sys", text: "That's you." }); break; }
          send(target, { t: "deny", reason: "Removed by the room owner." });
          try { target.conn.close(); } catch (e) {}
          onLeave(target);
          break;
        }
        case "announce":
          if (!p.admin) { send(p, { t: "sys", text: "The room owner only." }); break; }
          if (arg) broadcast({ t: "sys", text: "[ROOM] " + arg });
          break;
        default:
          send(p, { t: "sys", text: "Unknown command /" + cmd + ". Try /help." });
      }
    }

    /* join(conn) -> {message(str), gone()}. conn is {send(str), close(),
       buffered()}; it may be a DataConnection wrapper or a loopback into the
       owner's own client. The relay never learns which. */
    function join(conn) {
      let p = null;
      let saidHello = false;
      let dead = false;

      function message(str) {
        if (dead) return;
        let m;
        try { m = JSON.parse(str); } catch (e) { return; }
        if (!m || typeof m.t !== "string") return;

        if (!saidHello) {
          if (m.t !== "hello") { try { conn.close(); } catch (e) {} return; }
          saidHello = true;
          if (players.size >= maxPlayers) {
            try { conn.send(JSON.stringify({ t: "deny", reason: "This room is full." })); } catch (e) {}
            try { conn.close(); } catch (e) {}
            return;
          }
          const role = typeof m.role === "string" ? m.role.slice(0, 16) : "civ";
          const pid = (typeof m.pid === "string" && m.pid) ? m.pid.slice(0, 64) : null;
          /* RECONNECT DEDUPE, same reason as server.js: a phone whose radio
             blipped comes back with the same stable pid before WebRTC has
             finished noticing the old DataChannel is gone. Without this the
             ghost keeps its seat, keeps its name, and — if it was the sim
             host — the island stays frozen behind a dead tab. */
          if (pid) {
            const stale = [];
            players.forEach(function (q) { if (q.pid === pid && q.conn !== conn) stale.push(q); });
            for (const q of stale) { try { q.conn.close(); } catch (e) {} onLeave(q); }
          }
          let name = sanitizeName(m.name);
          let taken = true;
          while (taken) {
            taken = false;
            players.forEach(function (q) { if (q.name === name) taken = true; });
            if (taken) name += "_";
          }
          p = { id: nextId++, name: name, role: role, pid: pid, conn: conn, admin: false, joinedAt: Date.now() };
          players.set(p.id, p);
          if (hostId == null) hostId = p.id;
          if (p.id === hostId) p.admin = true;
          const others = [];
          players.forEach(function (q) { if (q.id !== p.id) others.push({ id: q.id, name: q.name, role: q.role }); });
          send(p, {
            t: "welcome", id: p.id, hostId: hostId, feat: FEAT,
            server: {
              name: info.name, motd: info.motd, tags: info.tags,
              maxPlayers: maxPlayers, iceServers: info.iceServers, feat: FEAT,
            },
            players: others,
          });
          broadcast({ t: "join", id: p.id, name: p.name, role: p.role }, p.id);
          if (opts.onRoster) try { opts.onRoster(roster()); } catch (e) {}
          return;
        }
        if (!p) return;

        switch (m.t) {
          case "state":
            m.id = p.id;
            broadcast(m, p.id);
            break;
          case "world":
            if (p.id === hostId) broadcast(m, p.id);
            break;
          case "ev":
            if (m.e === "to") {
              const tgt = players.get(m.id), d = m.d;
              const okT = d && typeof d === "object" &&
                (d.t === "ev" ? !RESERVED_EV[d.e] : (d.t === "world" && p.id === hostId));
              if (tgt && okT) { d.id = p.id; send(tgt, d); }
              break;
            }
            /* THE PERSISTENCE VERBS HAVE NOWHERE TO GO. server.js writes
               wsave/csave to server/worlds/*.json and answers wload/cload off
               it. A tab has no disk, so they are dropped here rather than
               relayed — relaying them would put one player's save in another
               player's world, which is worse than not saving. */
            if (m.e === "wsave" || m.e === "csave" || m.e === "wload" || m.e === "cload") break;
            m.id = p.id;
            if (m.to != null) {
              const target = players.get(m.to);
              if (target) send(target, m);
            } else broadcast(m, p.id);
            break;
          case "chat": {
            const text = String(m.text || "").slice(0, 300).trim();
            if (!text) break;
            if (text[0] === "/") { handleCommand(p, text); break; }
            broadcast({ t: "chat", id: p.id, name: p.name, kind: m.kind || "say", text: text });
            break;
          }
          default: break;
        }
      }

      function gone() {
        if (dead) return;
        dead = true;
        if (p) onLeave(p);
      }

      return { message: message, gone: gone };
    }

    return {
      join: join,
      roster: roster,
      count: function () { return players.size; },
      hostId: function () { return hostId; },
      dropped: function () { return bpDropped; },
      closeAll: function (reason) {
        players.forEach(function (p) {
          try { p.conn.send(JSON.stringify({ t: "deny", reason: reason || "The room closed." })); } catch (e) {}
          try { p.conn.close(); } catch (e) {}
        });
        players.clear();
        hostId = null;
      },
    };
  }

  /* ================================================================ ICE
     One place, three sources, in the order a page can override them. */
  function iceServers() {
    try { if (G.CBZ && Array.isArray(G.CBZ.iceServers) && G.CBZ.iceServers.length) return G.CBZ.iceServers; } catch (e) {}
    try {
      const meta = G.document && G.document.querySelector('meta[name="cbz-ice"]');
      if (meta && meta.content) {
        const a = JSON.parse(meta.content);
        if (Array.isArray(a) && a.length) return a;
      }
    } catch (e) {}
    return null;                                  // PeerJS's own default STUN
  }
  function peerOpts() {
    const ice = iceServers();
    /* PeerJS merges `config` shallowly over its default, so handing it an
       iceServers array replaces the default STUN list entirely — which is
       what you want when you are paying for TURN and do not want a race
       against a public STUN server that may be down. */
    return ice ? { config: { iceServers: ice, sdpSemantics: "unified-plan" } } : {};
  }

  /* ============================================================ LOADING PEERJS
     Resolved off THIS file's own URL, because the two pages that use it sit
     at different depths (/games/warlord.html and /index.html) and a root-
     relative path would be wrong for one of them and for every checkout
     served from a subdirectory — which is exactly what GitHub Pages is. */
  const SELF = (function () {
    try {
      if (G.document && G.document.currentScript && G.document.currentScript.src) return G.document.currentScript.src;
    } catch (e) {}
    return "";
  })();
  const VENDOR = SELF ? new URL("../../assets/vendor/peerjs.min.js", SELF).href : "assets/vendor/peerjs.min.js";
  let peerLoading = null;
  function loadPeerJS() {
    if (G.Peer) return Promise.resolve(G.Peer);
    if (peerLoading) return peerLoading;
    peerLoading = new Promise(function (res, rej) {
      if (!G.document) return rej(new Error("no document"));
      const s = G.document.createElement("script");
      s.src = VENDOR;
      s.async = false;
      s.onload = function () { G.Peer ? res(G.Peer) : rej(new Error("peerjs loaded but defined no Peer")); };
      s.onerror = function () { peerLoading = null; rej(new Error("could not load " + VENDOR)); };
      G.document.head.appendChild(s);
    });
    return peerLoading;
  }

  /* ====================================================== THE SOCKET SHAPE
     net.js drives a WebSocket through exactly seven members. This is those
     seven and nothing else, so net.js's handle() and every caller downstream
     of it cannot tell a room from a relay. */
  function makeSocket() {
    const sock = {
      readyState: 0,                 // 0 CONNECTING, 1 OPEN, 3 CLOSED
      bufferedAmount: 0,
      reason: "",                    // the TRUE sentence, for net.js's onError
      code: "",                      // the room code, once it is known
      room: true,
      onopen: null, onmessage: null, onclose: null, onerror: null,
      send: function () {},
      close: function () {},
    };
    sock._up = function () {
      if (sock.readyState !== 0) return;
      sock.readyState = 1;
      if (sock.onopen) try { sock.onopen(); } catch (e) { console.error("[rooms]", e); }
    };
    sock._in = function (data) {
      if (sock.readyState === 3) return;
      const str = typeof data === "string" ? data : (function () {
        try { return JSON.stringify(data); } catch (e) { return null; } })();
      if (str == null) return;
      if (sock.onmessage) try { sock.onmessage({ data: str }); } catch (e) { console.error("[rooms]", e); }
    };
    sock._fail = function (why) {
      sock.reason = why || sock.reason || "The room could not be reached.";
      if (sock.onerror) try { sock.onerror({ message: sock.reason }); } catch (e) {}
      sock._down();
    };
    sock._down = function () {
      if (sock.readyState === 3) return;
      sock.readyState = 3;
      if (sock.onclose) try { sock.onclose(); } catch (e) {}
    };
    return sock;
  }

  /* A PeerJS DataConnection, in the shape makeRelay() takes.
     bufferedAmount: the RTCDataChannel's own byte count is the real number
     and it is what the shed threshold is written against. PeerJS's
     `bufferSize` is a COUNT OF QUEUED MESSAGES in its own pre-channel queue,
     so when the channel is not up yet it is scaled by a nominal frame size
     rather than compared to a byte limit — a count of 3 is not 3 bytes. */
  function connBytes(c) {
    try {
      if (c.dataChannel && typeof c.dataChannel.bufferedAmount === "number") return c.dataChannel.bufferedAmount;
    } catch (e) {}
    return (c.bufferSize || 0) * 600;
  }
  function wrapConn(c) {
    return {
      send: function (str) { try { c.send(str); } catch (e) {} },
      close: function () { try { c.close(); } catch (e) {} },
      buffered: function () { return connBytes(c); },
    };
  }

  /* ============================================================ OPEN
     url forms:
       room:CODE          join that room
       room:CODE:host     create that room (a fresh code is rolled if taken)
       room:host          create a room, roll the code
     Returns the socket shape SYNCHRONOUSLY so net.js can attach its handlers
     before anything arrives — every real event is deferred past that. */
  function open(url, opts) {
    opts = opts || {};
    const sock = makeSocket();
    const parts = String(url || "").split(":");
    parts.shift();                                     // "room"
    let code = cleanCode(parts[0] === "host" ? "" : parts[0] || "");
    const asHost = parts.indexOf("host") > 0 || parts[0] === "host";
    let peer = null, relay = null, myConn = null, handle = null;
    let opened = false;
    const timeout = setTimeout(function () {
      if (!opened) sock._fail(asHost
        ? "Could not reach the room service to open a room. Check the connection and try again."
        : "No room answered on code " + (code || "????") + ". Check the code, and check the owner still has the game open.");
    }, opts.timeoutMs || 25000);

    function done() { opened = true; clearTimeout(timeout); }

    loadPeerJS().then(function (Peer) {
      if (sock.readyState === 3) return;
      if (asHost) startHost(Peer, 0);
      else startGuest(Peer);
    }).catch(function (e) {
      sock._fail("The peer-to-peer library did not load (" + e.message + "). Multiplayer needs it; single player is unaffected.");
    });

    /* ---- THE OWNER: a peer under a known id, the relay, and a loopback ---- */
    function startHost(Peer, tries) {
      if (!code || tries) code = newCode();
      sock.code = code;
      peer = new Peer("cbz-" + code, peerOpts());
      peer.on("open", function () {
        done();
        sock.code = code;
        if (opts.onCode) try { opts.onCode(code); } catch (e) {}
        relay = makeRelay({ name: opts.roomName || ("ROOM " + code), onRoster: opts.onRoster, maxPlayers: opts.maxPlayers });
        sock._relay = relay;
        /* THE OWNER IS PLAYER #1 THROUGH A LOOPBACK. Not a special case in
           the relay — a connection object whose send() lands in this same
           tab. It is deferred by a microtask so a welcome can never arrive
           inside the caller's own send() frame, which is the one difference
           between a loopback and a wire that a protocol can notice. */
        myConn = {
          send: function (str) { Promise.resolve().then(function () { sock._in(str); }); },
          close: function () { sock._down(); },
          buffered: function () { return 0; },
        };
        handle = relay.join(myConn);
        sock.send = function (str) { if (handle) handle.message(str); };
        sock._up();
      });
      peer.on("connection", function (c) {
        const w = wrapConn(c);
        let h = null;
        c.on("open", function () { if (relay) h = relay.join(w); });
        c.on("data", function (d) {
          if (!h) return;
          h.message(typeof d === "string" ? d : JSON.stringify(d));
        });
        c.on("close", function () { if (h) h.gone(); h = null; });
        c.on("error", function () { if (h) h.gone(); h = null; });
      });
      peer.on("error", function (err) {
        const t = err && err.type;
        if (t === "unavailable-id" && tries < 5) {
          try { peer.destroy(); } catch (e) {}
          startHost(Peer, tries + 1);                  // that code is taken; roll another
          return;
        }
        if (t === "peer-unavailable") return;          // a guest that gave up: not our problem
        if (!opened) sock._fail(brokerText(t, err));
      });
      peer.on("disconnected", function () {
        /* THE BROKER DROPPED US, NOT THE PLAYERS. Existing DataChannels are
           peer-to-peer and keep running; only NEW joins need the broker, so
           reconnect quietly instead of tearing the room down. */
        try { peer.reconnect(); } catch (e) {}
      });
    }

    /* ---- A GUEST: one DataConnection to the owner ---- */
    function startGuest(Peer) {
      if (!code) { sock._fail("That is not a room code — four letters and numbers."); return; }
      sock.code = code;
      peer = new Peer(undefined, peerOpts());
      peer.on("open", function () {
        const c = peer.connect("cbz-" + code, { reliable: true, metadata: { code: code } });
        c.on("open", function () {
          done();
          sock.send = function (str) { try { c.send(str); } catch (e) {} };
          Object.defineProperty(sock, "bufferedAmount", { get: function () { return connBytes(c); }, configurable: true });
          sock.close = function () { try { c.close(); } catch (e) {} sock._down(); };
          sock._up();
        });
        c.on("data", function (d) { sock._in(d); });
        c.on("close", function () { sock._down(); });
        c.on("error", function () { if (!opened) sock._fail("The room refused the connection."); });
      });
      peer.on("error", function (err) {
        const t = err && err.type;
        if (t === "peer-unavailable") {
          sock._fail("Nobody is holding room " + code + ". The room lives in the owner's tab — if they closed it, the room is gone.");
          return;
        }
        if (!opened) sock._fail(brokerText(t, err));
      });
    }

    function brokerText(t, err) {
      if (t === "browser-incompatible") return "This browser cannot do peer-to-peer (no WebRTC).";
      if (t === "network" || t === "server-error" || t === "socket-error" || t === "socket-closed") {
        return "Could not reach the room service. It needs an internet connection — a room is two browsers finding each other, not a server you run.";
      }
      if (t === "unavailable-id") return "That room code is already in use.";
      return "Peer-to-peer failed" + (t ? " (" + t + ")" : "") + (err && err.message ? ": " + err.message : ".");
    }

    sock.close = function () {
      clearTimeout(timeout);
      if (handle) { try { handle.gone(); } catch (e) {} handle = null; }
      if (relay) { try { relay.closeAll("The room owner left."); } catch (e) {} relay = null; }
      if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
      sock._down();
    };
    return sock;
  }

  const API = {
    open: open,
    isRoomUrl: function (u) { return /^room:/i.test(String(u || "")); },
    newCode: newCode,
    cleanCode: cleanCode,
    makeRelay: makeRelay,               // pure, for tools/test-rooms.mjs
    iceServers: iceServers,
    FEAT: FEAT,
    BP_LIMIT: BP_LIMIT,
    ALPHABET: ALPHABET,
  };

  if (typeof module === "object" && module && module.exports) module.exports = API;
  G.CBZ = G.CBZ || {};
  G.CBZ.rooms = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
