/* ============================================================
   warlord/warnet.js — THE SAME ISLAND, WITH OTHER WARLORDS ON IT.

   "modes for single player and a multiplayer option like open front.io"

   OpenFront is one shared map, several players expanding on it in real
   time, simple diplomacy, and you can watch everybody's territory grow.
   Strip that to what this game already is and you get: one island, several
   warbands riding it, you can see the others moving, and when you meet one
   you decide whether to fight it, ally with it, or sell it a rifle.

   ── WHAT IS REUSED, AND WHY ────────────────────────────────────────────
   Everything. src/net/net.js is this repo's multiplayer client — connect,
   the hello/welcome handshake, the player table, join/leave, SIM-HOST
   ELECTION with automatic migration when the host quits, the point-to-point
   `to` relay, and a backpressure gate that sheds stale snapshots instead of
   drowning the socket. server/server.js is a zero-dependency relay that
   already carries exactly the two shapes this game needs: `state` (high
   frequency, broadcast, shedable) and `ev` (reliable, broadcast OR directed
   by `to`). NOT ONE LINE OF server/ WAS CHANGED and no new protocol was
   invented: warlord traffic is ordinary `ev` verbs prefixed `wl`.

   net.js is not on this page's script list, so it is injected on demand the
   first time somebody opens the lobby. It captures CBZ.game at load, so an
   inert one is installed first — every engine file on this page tests for
   `mode === "city"`, so "warlord" is the OFF position everywhere.

   ── THE TRICK: NO MAP ON THE WIRE ──────────────────────────────────────
   The island is 14 km of analytic sand generated from ONE INTEGER. The host
   sends that integer and every client builds a byte-identical world from it.
   No heightfield, no oasis list, no outpost list, no chunk streaming — the
   entire shared world costs 4 bytes, once. The same is true of the neutral
   warbands: W.makeBand is driven by core's seeded stream, so every client
   generates the same parties with the same men in them, and the host only
   has to broadcast where they have WALKED to.

   ── PvP: WHY IT IS RESOLVED, NOT FOUGHT ────────────────────────────────
   Two options, and this file picks (b) deliberately.

   (a) Both players drop into battle.js and fight it in 3D with one side
       authoritative. REJECTED. A warlord battle is 200 men running
       combat_iq; making that agree on two machines needs lockstep or
       rollback, and the transport here is a JSON relay with a backpressure
       gate that is ALLOWED to drop snapshots. The failure mode is not
       "slightly out of sync", it is one player watching men die who are
       still alive on the other screen, and then arguing about the loot.

   (b) Both players watch the SAME resolution of the same power model the AI
       fights get. CHOSEN. Both sides run one pure function over one shared
       seed and two exchanged power numbers, so the outcome is identical on
       both machines with zero further traffic; each client then applies the
       casualties to ITS OWN men — which is the one thing it is genuinely
       authoritative over — and hands the winner the spoils. It survives
       packet loss, it survives a phone, and it is much closer to what
       openfront actually does with its armies.

   ── EVENTS ─────────────────────────────────────────────────────────────
   warnet:on warnet:off warnet:peer warnet:meet warnet:duel warnet:trade

   ── FLAGS ──────────────────────────────────────────────────────────────
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
  let ACTIVE = false;            // connected AND we have the island seed
  let MYNAME = "";
  let SEEDVOTE = 0;              // the seed we push if we turn out to be first in
  let MEET = null;               // the peer encounter currently on screen
  let DUEL = null;               // an offer in flight {peer, seed, mine, theirs, role}
  let TRADE = null;              // a trade in flight
  let ALLIES = {};               // peer id -> true
  let COOL = {};                 // peer id -> time we may meet them again
  let stateTimer = 0, bandTimer = 0;
  let LOBBYERR = "";

  /* THE PALETTE is indexed by the server's player id, so every client paints
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
  function connected() { return !!(CBZ.net && CBZ.net.active); }

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

  /* ============================================================ THE LOBBY */
  const CSS = `
  .wl-net-f{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-net-f:last-child{border-bottom:0}
  .wl-net-f label{font-size:10.5px;letter-spacing:.2em;opacity:.55;min-width:88px}
  .wl-net-f input{flex:1;min-width:0;background:rgba(255,255,255,.06);color:var(--ink);
    border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px 12px;
    font:inherit;font-size:14px;letter-spacing:.04em}
  .wl-net-f input:focus{outline:none;border-color:var(--hot)}
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

  function defaultUrl() {
    try {
      if (G.location && /^https?:$/.test(G.location.protocol) && G.location.host) {
        return (G.location.protocol === "https:" ? "wss://" : "ws://") + G.location.host + "/ws";
      }
    } catch (e) {}
    return "ws://localhost:8000/ws";
  }
  function savedName() {
    try { return localStorage.getItem("cbz-warlord-name") || ""; } catch (e) { return ""; }
  }

  function lobby() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    if (connected() && ACTIVE) { warRoom(); return; }
    const url = (function () { try { return localStorage.getItem("cbz-warlord-url") || defaultUrl(); } catch (e) { return defaultUrl(); } })();
    const nm = savedName() || "WARLORD " + (1 + Math.floor(Math.random() * 89));
    const seed = Q.get("seed") || String(1000 + Math.floor(Math.random() * 8999));
    ctx.screen(
      '<h1 class="wl-h">ONE ISLAND, <em>MANY WARLORDS</em></h1>' +
      '<p class="wl-sub">SHARED CAMPAIGN · RIDE · MEET · FIGHT OR DEAL</p>' +
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
      connect({ name: name, url: u, seed: sd });
    };
    const bk = ctx.el("nBack");
    if (bk) bk.onclick = function () { LOBBYERR = ""; W.emit("mainmenu"); };
  }

  function connecting(msg) {
    if (!ctx || !ctx.screen) return;
    ctx.screen('<h1 class="wl-h">' + esc(msg) + '</h1><p class="wl-sub">' + esc(defaultUrl()) + '</p>' +
      '<div class="wl-btns"><button class="wl-btn" id="nCancel">CANCEL</button></div>');
    const c = ctx.el("nCancel");
    if (c) c.onclick = function () { disconnect(); lobby(); };
  }

  /* ---- the war room: who is on the island, before you ride ---- */
  function warRoom() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    const S = W.state;
    const list = peerList();
    let h = '<h1 class="wl-h">THE <em>ISLAND</em></h1>' +
      '<p class="wl-sub">SEED ' + S.seed + '  ·  ' + (isHost() ? "YOU ARE SIMULATING THE ISLAND" : "RIDING SOMEBODY ELSE\'S ISLAND") + '</p>';
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
    if (!list.length) h += '<div class="wl-net-note" style="padding-top:8px">nobody else yet. ride out — they will show up on the map when they join.</div>';
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
      } else if (t.id === "nQuit") { disconnect(); lobby(); }
    };
  }

  /* ============================================================ CONNECT */
  function connect(opts) {
    connecting("OPENING THE LINE");
    LOBBYERR = "";
    MYNAME = opts.name;
    SEEDVOTE = opts.seed | 0;
    loadNet().then(function (N) {
      wireNet(N);
      N.connect({
        url: opts.url, name: opts.name, role: "civ",
        onError: function (msg) {
          LOBBYERR = msg + "  The server is not answering at " + opts.url +
            ". Start it with `node server/server.js` and open the game from that server.";
          lobby();
        },
      });
      connecting("WAITING FOR THE ISLAND");
    }).catch(function () {
      LOBBYERR = "src/net/net.js did not load — multiplayer is unavailable, single player is unaffected.";
      lobby();
    });
  }

  function disconnect() {
    const N = net();
    if (N && N.disconnect) try { N.disconnect(); } catch (e) {}
    goOffline();
  }

  function goOffline() {
    ACTIVE = false;
    MEET = null; DUEL = null; TRADE = null;
    W.state.peers = {};
    if (stateTimer) { clearInterval(stateTimer); stateTimer = 0; }
    if (bandTimer) { clearInterval(bandTimer); bandTimer = 0; }
    W.emit("warnet:off");
  }

  function isHost() { const N = net(); return !!(N && N.isHost && N.isHost()); }

  let wired = false;
  function wireNet(N) {
    if (wired) return;
    wired = true;

    N.on("welcome", function (m) {
      /* FIRST IN SETS THE ISLAND. The relay already elects a sim host (it is
         the same election the city uses), so "host" and "join" are not two
         buttons here — whoever arrives first is the host and their seed wins.
         Everybody else waits for wlseed rather than guessing. */
      if (N.isHost()) {
        startCampaign(SEEDVOTE, true);
        announce();
      } else {
        // the host answers our wlhi with wlseed; if it never comes, say so
        announce();
        setTimeout(function () {
          if (!ACTIVE && connected()) {
            LOBBYERR = "Connected, but the warlord simulating the island never sent it. They may still be in the menu.";
            lobby();
          }
        }, 6000);
      }
    });

    N.on("join", function (m) {
      /* A LATE JOINER GETS THE WORLD, NOT THE MAP: the seed, the clock, and
         then the next band snapshot. Four bytes and a day number rebuild an
         island somebody has been riding for an hour. */
      if (isHost() && ACTIVE) {
        N.sendEv({ e: "wlseed", to: m.id, seed: W.state.seed, day: W.state.day, hour: W.state.hour });
        pushBands(m.id);
      }
      sendIdentity(m.id);
      if (W.phase() === "menu") warRoom();
    });

    N.on("leave", function (m) {
      const p = W.state.peers[m.id];
      delete W.state.peers[m.id];
      delete ALLIES[m.id];
      /* A PLAYER WHO VANISHES MID-ENCOUNTER must not leave a card up with a
         button that will never be answered. Nothing has been applied at this
         point in any of the three exchanges, so cancelling costs nobody. */
      if (MEET && MEET.id === m.id) { MEET = null; DUEL = null; TRADE = null; backToRide(); W.toast((p ? p.name : "they") + " rode out of the world", "bad"); }
      if (W.phase() === "menu") warRoom();
    });

    N.on("host", function () {
      if (isHost()) W.toast("you are simulating the island now", "good");
    });

    N.on("_offline", function () {
      if (ACTIVE) W.toast("the line went dead — the island is yours alone now", "bad");
      goOffline();
    });

    /* ---- another warlord's warband ---- */
    N.on("state", function (m) {
      if (!m || m.id == null || m.id === N.id) return;
      const p = W.state.peers[m.id] || (W.state.peers[m.id] = { id: m.id });
      p.name = m.nm || p.name || ("WARLORD " + m.id);
      p.x = m.x; p.z = m.z;
      p.size = m.n | 0; p.pw = m.pw || 0;
      p.colour = colourFor(m.id);
      p.ally = !!ALLIES[m.id];
      p.t = now();
      W.emit("warnet:peer", p);
      maybeMeet(p);
    });

    N.onEv("wlhi", function (m) {
      const p = W.state.peers[m.id] || (W.state.peers[m.id] = { id: m.id });
      p.name = m.nm; p.colour = colourFor(m.id); p.size = m.n | 0; p.pw = m.pw || 0; p.t = now();
      if (isHost() && ACTIVE) {
        N.sendEv({ e: "wlseed", to: m.id, seed: W.state.seed, day: W.state.day, hour: W.state.hour });
      }
    });

    N.onEv("wlseed", function (m) {
      if (ACTIVE) return;                     // already riding — a re-send is noise
      startCampaign(m.seed | 0, false, m);
    });

    /* ---- neutral bands: only the host simulates them ---- */
    N.onEv("wlbands", function (m) {
      if (isHost() || !m || !m.b) return;
      applyBands(m.b);
    });

    /* ---- the duel ---- */
    N.onEv("wlduel", function (m) { onChallenge(m); });
    N.onEv("wlduelno", function (m) {
      if (!DUEL || DUEL.peer.id !== m.id) return;
      const nm = DUEL.peer.name; DUEL = null;
      W.toast(nm + " broke away", "bad");
      backToRide();
    });
    N.onEv("wlduelok", function (m) {
      if (!DUEL || DUEL.peer.id !== m.id || DUEL.role !== "a") return;
      runDuel(DUEL.seed, DUEL.mine, { pw: m.pw, size: m.n }, true, DUEL.peer);
    });
    N.onEv("wlspoils", function (m) { takeSpoils(m); });

    /* ---- diplomacy ---- */
    N.onEv("wlally", function (m) { onAllyOffer(m); });
    N.onEv("wlallyok", function (m) {
      ALLIES[m.id] = true;
      const p = W.state.peers[m.id]; if (p) p.ally = true;
      W.toast((p ? p.name : "they") + " accepted your alliance", "good");
      if (MEET && MEET.id === m.id) drawMeet();
    });
    N.onEv("wlallyno", function (m) {
      const p = W.state.peers[m.id];
      W.toast((p ? p.name : "they") + " refused", "bad");
      if (MEET && MEET.id === m.id) drawMeet();
    });

    /* ---- trade: three messages, and the risk sits with the proposer ----
       OFFER → ACCEPT → DONE. The proposer gives up his guns when the accept
       arrives and only then tells the other side to pay; so if the link dies
       mid-exchange the ACCEPTER has lost nothing, which is the failure mode
       to prefer when one of the two people chose to open the trade. */
    N.onEv("wltrade", function (m) { onTradeOffer(m); });
    N.onEv("wltradeok", function (m) {
      if (!TRADE || TRADE.peer.id !== m.id || TRADE.role !== "a") return;
      const t = TRADE;
      for (const wid in t.guns) W.unstash(wid, t.guns[wid]);
      W.earn(t.gold);
      net().sendEv({ e: "wltradedone", to: m.id, guns: t.guns, gold: t.gold });
      W.log("traded " + gunsLabel(t.guns) + " to " + t.peer.name + " for $" + t.gold + ".", "good");
      W.toast("deal done", "good");
      TRADE = null; backToRide();
    });
    N.onEv("wltradeno", function () {
      if (!TRADE) return;
      W.toast(TRADE.peer.name + " refused the deal", "bad");
      TRADE = null; drawMeet();
    });
    N.onEv("wltradedone", function (m) {
      if (!W.pay(m.gold)) { W.toast("you could not cover the deal", "bad"); return; }
      for (const wid in m.guns || {}) W.stash(wid, m.guns[wid]);
      W.log("bought " + gunsLabel(m.guns) + " for $" + m.gold + ".", "good");
      W.toast("crates loaded", "good");
      TRADE = null; backToRide();
    });
  }

  function announce() { sendIdentity(null); }
  function sendIdentity(to) {
    const N = net();
    if (!N || !N.active) return;
    const m = { e: "wlhi", nm: MYNAME, n: W.armySize(), pw: Math.round(W.yourPower() * 100) / 100 };
    if (to != null) m.to = to;
    N.sendEv(m);
  }

  /* ============================================================ THE ISLAND */
  function startCampaign(seed, iAmHost, m) {
    W.newGame({ seed: seed, mode: "net", name: MYNAME });
    if (m && m.day) { W.state.day = m.day | 0; W.state.hour = m.hour || 7; }
    ACTIVE = true;
    W.emit("warnet:on", { seed: seed, host: iAmHost });
    W.log("riding a shared island. seed " + seed + ".");
    startPumps();
    warRoom();
  }

  /* THE PUMPS. Two intervals, started on connect and cleared on disconnect —
     deliberately NOT a per-frame hook, so that single player pays literally
     nothing for this file being on the page. 4 Hz is enough for a party on a
     14 km island: at a rider's pace that is under three metres between
     updates, and campaign.js interpolates anyway. */
  function startPumps() {
    if (stateTimer) return;
    stateTimer = setInterval(pushState, 250);
    bandTimer = setInterval(function () { if (isHost()) pushBands(null); }, 2000);
  }

  function pushState() {
    const N = net();
    if (!N || !N.active) return;
    const S = W.state;
    N.send({
      t: "state",
      nm: MYNAME,
      x: Math.round(S.you.x * 10) / 10,
      z: Math.round(S.you.z * 10) / 10,
      n: W.armySize(),
      pw: Math.round(W.yourPower() * 100) / 100,
      d: S.day,
    });
    prunePeers();
  }

  /* A PEER WHOSE PACKETS STOPPED is not on the map. The relay tells us about
     a clean leave; this covers the other kind — a tab that froze, a phone
     that went in a pocket. Eight seconds is 32 missed updates. */
  function prunePeers() {
    const t = now();
    for (const id in W.state.peers) {
      if (t - (W.state.peers[id].t || 0) > 8000) {
        if (MEET && String(MEET.id) === String(id)) { MEET = null; DUEL = null; TRADE = null; backToRide(); }
        delete W.state.peers[id];
      }
    }
  }

  /* NEUTRAL BANDS. Only the host runs their AI (campaign.js asks simHost()),
     and only their POSITIONS travel — every client already generated the same
     bands with the same men from the shared seed, so a roster on the wire
     would be a hundred kilobytes of something both machines already know. */
  function pushBands(to) {
    const N = net();
    if (!N || !N.active || !ACTIVE) return;
    const S = W.state;
    const rows = [];
    for (let i = 0; i < S.bands.length && i < 120; i++) {
      const b = S.bands[i];
      rows.push([b.id, Math.round(b.x), Math.round(b.z), b.men ? b.men.length : 0]);
    }
    const m = { e: "wlbands", b: rows };
    if (to != null) m.to = to;
    N.sendEv(m);
  }
  function applyBands(rows) {
    const S = W.state;
    const seen = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      seen[r[0]] = true;
      for (let k = 0; k < S.bands.length; k++) {
        if (S.bands[k].id !== r[0]) continue;
        S.bands[k].x = r[1]; S.bands[k].z = r[2];
        break;
      }
    }
    /* A band the host no longer lists is dead or absorbed. Guests drop it
       rather than keep drawing a party nobody can meet. Guarded on the host
       having sent a plausible list at all — one empty snapshot must not wipe
       the island. */
    if (rows.length) {
      for (let k = S.bands.length - 1; k >= 0; k--) if (!seen[S.bands[k].id]) S.bands.splice(k, 1);
    }
  }

  /* ============================================================ MEETING
     150 m, because that is roughly the distance at which campaign.js's own
     encounters trigger and two different meeting ranges on one map is how a
     player learns to distrust the map. */
  const MEET_RANGE = 150;
  function maybeMeet(p) {
    if (!ACTIVE || MEET || OLD_PEERS) return;
    if (W.phase() !== "campaign") return;
    if ((COOL[p.id] || 0) > now()) return;
    const S = W.state;
    const dx = p.x - S.you.x, dz = p.z - S.you.z;
    if (dx * dx + dz * dz > MEET_RANGE * MEET_RANGE) return;
    /* army.js owns the `encounter` phase. If it has a card up we do not fight
       it for the screen — we wait for the next update and try again. */
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
        '<div class="wl-row"><span>THEIR WARBAND</span><span>' + p.size + ' MEN  ·  POWER ' + Math.round(p.pw || 0) + '</span></div>' +
        '<div class="wl-row"><span>YOURS</span><span>' + W.armySize() + ' MEN  ·  POWER ' + Math.round(mine) + '</span></div>' +
        '<div class="wl-row"><span>IF YOU CHARGE</span><span class="' + (odds > 0.5 ? "wl-gold" : "") + '">' + Math.round(odds * 100) + '% TO WIN</span></div>' +
      '</div>';
    if (DUEL) {
      h += '<div class="wl-card"><div class="wl-net-note">' +
        (DUEL.role === "a" ? "You have called them out. Waiting for an answer…" : "They are charging you.") +
        '</div></div>';
      if (DUEL.role === "b") {
        h += '<div class="wl-btns">' +
          '<button class="wl-btn bad" id="mAccept">MEET THEM</button>' +
          '<button class="wl-btn" id="mFlee">BREAK AWAY</button></div>';
      } else {
        h += '<div class="wl-btns"><button class="wl-btn" id="mCancel">CALL IT OFF</button></div>';
      }
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
        (p.ally ? "" : '<button class="wl-btn" id="mAlly">OFFER ALLIANCE</button>') +
        '<button class="wl-btn" id="mTrade">TRADE</button>' +
        '<button class="wl-btn hot" id="mLeave">RIDE ON</button>' +
        '</div>';
    }
    const node = ctx.screen(h);
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      switch (t.id) {
        case "mAttack": challenge(p); break;
        case "mAlly": net().sendEv({ e: "wlally", to: p.id }); W.toast("offer sent", ""); break;
        case "mTrade": tradeScreen(p); break;
        case "mLeave": leaveMeet(); break;
        case "mAccept": acceptChallenge(); break;
        case "mFlee": net().sendEv({ e: "wlduelno", to: p.id }); DUEL = null; leaveMeet(); break;
        case "mCancel": net().sendEv({ e: "wlduelno", to: p.id }); DUEL = null; drawMeet(); break;
        case "mTakeDeal": net().sendEv({ e: "wltradeok", to: p.id }); TRADE = null; W.toast("waiting on the crates…", ""); drawMeet(); break;
        case "mNoDeal": net().sendEv({ e: "wltradeno", to: p.id }); TRADE = null; drawMeet(); break;
      }
    };
  }

  function leaveMeet() {
    if (MEET) COOL[MEET.id] = now() + 30000;   // do not re-open the card instantly
    MEET = null; DUEL = null; TRADE = null;
    backToRide();
  }
  function backToRide() {
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else if (W.phase() !== "menu") W.setPhase("campaign");
  }

  /* ============================================================ THE DUEL */
  function myCard() { return { pw: Math.round(W.yourPower() * 100) / 100, size: W.armySize() }; }

  function challenge(p) {
    const mine = myCard();
    /* THE SEED IS THE CONTRACT. Both machines resolve the same battle from
       this one integer plus the two power numbers below, and nothing else
       crosses the wire — no per-tick state, nothing to desync. */
    const seed = (Math.random() * 0x7fffffff) | 0;
    DUEL = { peer: p, seed: seed, mine: mine, role: "a", t: now() };
    net().sendEv({ e: "wlduel", to: p.id, seed: seed, pw: mine.pw, n: mine.size, nm: MYNAME });
    drawMeet();
    /* A CHALLENGE NOBODY ANSWERS must not lock the screen. Seven seconds and
       we call it a refusal — the other player may have closed the tab
       between our last packet and this one. */
    setTimeout(function () {
      if (DUEL && DUEL.role === "a" && DUEL.seed === seed) {
        DUEL = null; W.toast("no answer — they rode off", "bad"); backToRide(); MEET = null;
      }
    }, 7000);
  }

  function onChallenge(m) {
    const p = W.state.peers[m.id] || (W.state.peers[m.id] = { id: m.id, name: m.nm, colour: colourFor(m.id) });
    p.pw = m.pw; p.size = m.n; p.name = p.name || m.nm; p.t = now();
    MEET = p;
    DUEL = { peer: p, seed: m.seed | 0, theirs: { pw: m.pw, size: m.n }, mine: myCard(), role: "b" };
    if (W.phase() !== "encounter") W.setPhase("encounter", { kind: "pvp", peer: p });
    drawMeet();
  }

  function acceptChallenge() {
    if (!DUEL || DUEL.role !== "b") return;
    const mine = DUEL.mine;
    net().sendEv({ e: "wlduelok", to: DUEL.peer.id, pw: mine.pw, n: mine.size });
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
    return {
      aWins: aWins,
      aLoss: aWins ? winnerLoss : loserLoss,
      bLoss: aWins ? loserLoss : winnerLoss,
    };
  }

  function runDuel(seed, a, b, iAmA, peer) {
    const res = resolve(seed, a, b);
    const iWon = (iAmA === res.aWins);
    const myLoss = iAmA ? res.aLoss : res.bLoss;
    const S = W.state;

    /* EACH CLIENT KILLS ITS OWN MEN. The shared model says WHAT FRACTION
       died; which men those are is a question only the machine holding the
       roster can answer, and it is the one thing it is unambiguously
       authoritative over. The weakest fall first because they are the ones
       standing in front. */
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

    let spoils = null;
    if (!iWon) {
      /* THE LOSER HANDS OVER THE SPOILS, because the loser is the only one
         who knows what he had. A quarter of the purse, the guns off his dead,
         and the men who threw theirs down. */
      const gold = Math.round(S.gold * 0.25);
      W.pay(gold);
      const men = [];
      const give = Math.min(3, S.army.length);
      const weak = S.army.slice().sort(function (x, y) { return W.soldierPower(x) - W.soldierPower(y); });
      for (let i = 0; i < give; i++) men.push(W.removeSoldier(weak[i].id, false));
      const guns = {};
      let n = 0;
      for (const wid in dropped) { guns[wid] = Math.ceil(dropped[wid] * 0.5); n += guns[wid]; if (n > 12) break; }
      spoils = { e: "wlspoils", to: peer.id, gold: gold, guns: guns, men: men.filter(Boolean) };
      try { net().sendEv(spoils); } catch (e) {}
    }

    W.log((iWon ? "beat " : "lost to ") + peer.name + " — " + kill + " of your men died.", iWon ? "good" : "bad");
    showResult(iWon, kill, peer, myLoss);
    W.emit("warnet:duel", { won: iWon, peer: peer, killed: kill });
    DUEL = null;
    if (MEET) COOL[MEET.id] = now() + 45000;
  }

  function takeSpoils(m) {
    const p = W.state.peers[m.id];
    let men = 0;
    for (const wid in m.guns || {}) W.stash(wid, m.guns[wid]);
    if (m.men && m.men.length) {
      for (let i = 0; i < m.men.length; i++) {
        const s = m.men[i];
        if (!s || !s.tier) continue;
        /* Rebuilt through core's constructor rather than trusted as-is: a
           roster arriving off the wire is the one place a malformed soldier
           could get into your army, and makeSoldier is the only shape the
           battle knows how to read. */
        W.state.prisoners.push(W.makeSoldier(s.tier, s.wid, { name: s.name, armour: s.armour, kills: s.kills, battles: s.battles, wounded: true }));
        men++;
      }
    }
    if (m.gold) W.earn(m.gold);
    W.log("took $" + (m.gold || 0) + ", " + men + " prisoners and their guns from " + (p ? p.name : "a beaten warlord") + ".", "good");
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
        'no argument about who died.</div></div>' +
      '<div class="wl-btns">' +
        '<button class="wl-btn hot" id="rGo">RIDE ON</button>' +
        '<button class="wl-btn" id="rArm">ARMOURY</button></div>'
    );
    const g = ctx.el("rGo"), a = ctx.el("rArm");
    if (g) g.onclick = function () { MEET = null; backToRide(); };
    if (a) a.onclick = function () { MEET = null; if (W.loadout) W.loadout.open(); };
  }

  /* ============================================================ DIPLOMACY */
  function onAllyOffer(m) {
    const p = W.state.peers[m.id];
    if (!p) return;
    if (!MEET) { MEET = p; W.setPhase("encounter", { kind: "pvp", peer: p }); }
    if (!ctx || !ctx.screen) return;
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
      net().sendEv({ e: "wlallyok", to: p.id });
      W.toast("allied with " + p.name, "good");
      drawMeet();
    };
    ctx.el("aNo").onclick = function () { net().sendEv({ e: "wlallyno", to: p.id }); drawMeet(); };
  }

  /* ============================================================ TRADE */
  let OFFER = null;
  function tradeScreen(p) {
    OFFER = OFFER || { guns: {}, gold: 0 };
    drawTrade(p);
  }
  function drawTrade(p) {
    if (!ctx || !ctx.screen) return;
    const S = W.state;
    const ids = Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    let worth = 0;
    for (const k in OFFER.guns) worth += W.gunPrice(k) * OFFER.guns[k];
    let h = '<h1 class="wl-h">DEAL WITH <em>' + esc(p.name) + '</em></h1>' +
      '<p class="wl-sub">OUT OF YOUR BAGGAGE TRAIN</p>' +
      '<div class="wl-card">';
    if (!ids.length) h += '<div class="wl-net-note">you have nothing loose to sell.</div>';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], sel = OFFER.guns[id] || 0;
      h += '<div class="wl-row"><span>' + W.gunLabel(id) + ' <span class="wl-dim wl-small">×' + S.baggage[id] + '  ·  LIST $' + W.gunPrice(id) + '</span></span>' +
        '<span><button class="wl-btn" data-less="' + id + '">−</button> ' + sel +
        ' <button class="wl-btn" data-more="' + id + '">+</button></span></div>';
    }
    h += '</div>' +
      '<div class="wl-lbl">YOUR PRICE</div><div class="wl-card">' +
      '<div class="wl-row"><span class="wl-gold" style="font-size:22px">$' + OFFER.gold + '</span>' +
      '<span><button class="wl-btn" data-gold="-100">−100</button> <button class="wl-btn" data-gold="-25">−25</button> ' +
      '<button class="wl-btn" data-gold="25">+25</button> <button class="wl-btn" data-gold="100">+100</button></span></div>' +
      '<div class="wl-row"><span class="wl-small wl-dim">LIST VALUE OF WHAT YOU ARE OFFERING</span><span class="wl-small wl-dim">$' + worth + '</span></div>' +
      '</div>' +
      '<div class="wl-btns">' +
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
        net().sendEv({ e: "wltrade", to: p.id, guns: OFFER.guns, gold: OFFER.gold });
        OFFER = null;
        drawMeet(); return;
      }
      if (t.id === "tBack") { OFFER = null; drawMeet(); return; }
    };
  }
  function onTradeOffer(m) {
    const p = W.state.peers[m.id];
    if (!p) return;
    if (!MEET) { MEET = p; W.setPhase("encounter", { kind: "pvp", peer: p }); }
    TRADE = { peer: p, guns: m.guns || {}, gold: m.gold | 0, role: "b" };
    drawMeet();
    W.emit("warnet:trade", TRADE);
  }
  function gunsLabel(guns) {
    const out = [];
    for (const k in guns || {}) out.push(W.gunLabel(k) + " ×" + guns[k]);
    return out.join(", ") || "nothing";
  }

  /* ============================================================ FOR campaign.js
     Peers published in the shape campaign.js already draws bands in, so
     "another warlord" needs no second renderer — same fields, plus `peer` so
     it can be drawn in that player's colour and made un-attackable by the
     normal band code. */
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
    const out = [];
    const list = peerList();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      out.push({
        id: "p" + p.id, peer: true, peerId: p.id,
        faction: "warlord", name: p.name, colour: p.colour || colourFor(p.id),
        x: p.x, z: p.z, men: [], size: p.size || 1, ally: !!ALLIES[p.id],
        mood: "roam", cooldown: 0, gold: 0, wealth: 0.5,
      });
    }
    return out;
  }

  /* ============================================================ MODULE */
  W.module("warnet", {
    boot: function (c) {
      ctx = c;
      styleOnce();
      if (Q.get("netlobby")) setTimeout(function () { W.setPhase("menu"); lobby(); }, 0);
    },
    lobby: lobby,
    connect: connect,
    disconnect: disconnect,
    connected: function () { return ACTIVE && connected(); },
    /* campaign.js asks this before running band AI. TRUE IN SINGLE PLAYER —
       an offline game is trivially its own host, so the caller needs no
       "am I connected" branch of its own. */
    simHost: function () { return !ACTIVE || isHost(); },
    peers: function () { return W.state.peers; },
    peerBands: peerBands,
    allies: function () { return ALLIES; },
    encounterOpen: function () { return !!MEET; },
    // exposed for the determinism test: two clients must agree on this
    resolve: resolve,
  });
})();
