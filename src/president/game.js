/* ============================================================
   president/game.js — THE DOOR: pick a world, pick a real country, take
   office.

   OWNER (2026-10-28): "different versions of game should be regions ... a
   full world game and then regions ... just usa like state vs state".

   This page is only the choice: first the world (the whole earth, a region,
   or the fifty states: president/scenarios.js), then the country (or the
   state). The game is the real Executive Mansion in the real engine: TAKE
   OFFICE opens index.html on Gang City's estate slice with
   ?president=<country>&scen=<world> (city/president_game.js), where you are
   a body in the chair behind the Resolute desk and the world's business
   comes to you through the phone, the folders, the briefing book and the
   people who walk in.

   A room of presidents is set up here (host, codes, who takes which
   country, which world), then every president's page opens the game with
   the room's code and the host's page runs the one clock (president/net.js,
   lockstep).

   The countries, their leaders and their numbers are president/nations.js
   and president/states.js; the map is president/earth.js, painted by
   president/mapdraw.js. Nothing on this page is invented.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const el = function (id) { return document.getElementById(id); };
  const Q = new URLSearchParams(location.search);
  const PW = CBZ.presWorld, NA = CBZ.presNations, SC = CBZ.presScenarios, MAP = CBZ.presMap;

  let scen = SC.byId[Q.get("scen")] ? Q.get("scen") : "world";
  let S0 = null, pick = 0;
  const pseed = +(Q.get("pseed") || 0) || ((Date.now() / 1000) | 0) % 99991 + 1;
  // the world on day one, for the map and the list (a fresh one for every scenario)
  function setScen(id, keep) {
    scen = SC.byId[id] ? id : "world";
    S0 = PW.create(1, { scen: scen });
    const at = function (k) { return S0.c.findIndex(function (c) { return c.key === k; }); };
    // the country you had, or the one the link asked for, or the world's own first pick
    pick = [keep, Q.get("c"), SC.byId[scen].pick].map(at).filter(function (i) { return i >= 0; })[0] || 0;
    for (const k in taken) delete taken[k];
  }

  // ------------------------------------------------------------ the worlds
  function drawScens() {
    const box = el("scens"); box.innerHTML = "";
    SC.list.forEach(function (s) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scen" + (s.id === scen ? " on" : "");
      b.innerHTML = "<b></b><span></span>";
      b.querySelector("b").textContent = s.name;
      b.querySelector("span").textContent = SC.members(s.id).length + (s.kind === "states" ? " states" : " countries");
      b.onclick = function () {
        if (NET && NET.role === "guest") return;           // the host picks the world
        setScen(s.id);
        drawAll();
        if (NET && NET.role === "host") { LOBBY.seats = {}; hostSeat(NET.id, pick, myName()); }
      };
      box.appendChild(b);
    });
    el("scensub").textContent = SC.byId[scen].sub;
  }

  // ------------------------------------------------------------ the map
  function drawMap() {
    const cv = el("preview"), x = cv.getContext("2d");
    const img = MAP.image(S0, pick, { theme: "night" });
    // two canvas pixels a tile at least, sharp, and the frame's own shape
    const k = Math.max(2, Math.ceil(1100 / img.w));
    cv.width = img.w * k; cv.height = img.h * k;
    x.imageSmoothingEnabled = false;
    x.drawImage(img.cv, 0, 0, cv.width, cv.height);
    // the chosen country's name over its capital
    const c = S0.c[pick];
    const L = MAP.labels(S0, pick, img.frame).find(function (l) { return l.cid === c.id; });
    if (L) {
      const fs = Math.round(Math.max(18, cv.width / 50));
      x.font = "700 " + fs + "px Fredoka, sans-serif"; x.textAlign = "center"; x.textBaseline = "bottom";
      x.lineWidth = Math.max(3, fs / 6); x.strokeStyle = "rgba(0,0,0,.8)";
      const X = Math.min(cv.width - 10, Math.max(10, L.x * cv.width)), Y = Math.max(fs + 4, L.y * cv.height - 6);
      x.strokeText(c.name.toUpperCase(), X, Y);
      x.fillStyle = "#ffe066"; x.fillText(c.name.toUpperCase(), X, Y);
    }
  }
  el("preview").onclick = function (e) {
    const r = this.getBoundingClientRect();
    const t = MAP.pick(S0, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, MAP.frame(S0));
    if (t != null) choose(t);
  };

  // ------------------------------------------------------------ the list
  const taken = {};
  function drawList() {
    const L = el("clist"); L.innerHTML = "";
    S0.c.slice().sort(function (a, b) { return b.gdp - a.gdp; }).forEach(function (c) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "crow" + (c.id === pick ? " on" : "") + (taken[c.id] && c.id !== pick ? " taken" : "");
      d.innerHTML = "<i></i><b></b><span></span>";
      d.querySelector("i").style.background = c.color;
      d.querySelector("b").textContent = c.name + (taken[c.id] ? " (" + taken[c.id] + ")" : "");
      d.querySelector("span").textContent = c.leader.name + ", " + c.leader.title.toLowerCase() + (c.war.length ? ". At war." : "");
      d.onclick = function () { choose(c.id); };
      L.appendChild(d);
    });
  }
  function drawAll() { drawScens(); drawMap(); drawList(); }
  function choose(id) {
    pick = id;
    drawMap(); drawList();
    if (NET && NET.role === "guest") NET.seat(pick, myName());
    if (NET && NET.role === "host") hostSeat(NET.id, pick, myName());
  }
  function myName() { return (el("pname").value || "").trim() || "President"; }

  // ------------------------------------------------------------ into office
  function gameUrl(c, extra) {
    const q = new URLSearchParams({ slice: "estate", president: S0.c[c].key, scen: scen, pseed: String(pseed) });
    for (const k in extra || {}) q.set(k, extra[k]);
    if (Q.get("relay") && extra && extra.room) q.set("relay", Q.get("relay"));
    // the engine page: index.html here, gang-city.html in the portal build (tools/build-web-release.mjs)
    return (CBZ.ENGINE_PAGE || "../index.html") + "?" + q.toString();
  }
  // the one way out of this page (a test stubs it to read where it would go)
  CBZ.presGo = CBZ.presGo || function (u) { location.href = u; };
  el("solo").onclick = function () { CBZ.presGo(gameUrl(pick, { pname: myName() })); };

  // ------------------------------------------------------------ a room
  let NET = null, LOBBY = { seats: {}, scen: scen };
  // the code the game pages meet on (a node relay has one room and no code of its own)
  function roomCode() { return (NET && NET.code) || (Q.get("relay") ? "RELAY" : ""); }
  function hostSeat(pid, c, name) {
    for (const k in LOBBY.seats) if (LOBBY.seats[k].c === c && String(k) !== String(pid)) return;
    LOBBY.seats[pid] = { c: c, name: name || "President" };
    pushLobby();
  }
  function pushLobby() { LOBBY.pseed = pseed; LOBBY.scen = scen; if (NET) NET.lobby(LOBBY); lobbyView(); }
  function lobbyView() {
    el("lobby").hidden = false;
    el("code").textContent = (NET && NET.code) || "....";
    const L = el("seats"); L.innerHTML = "";
    for (const k in taken) delete taken[k];
    (NET ? NET.players() : []).forEach(function (p) {
      const st = LOBBY.seats[p.id];
      if (st && S0.c[st.c]) taken[st.c] = p.name;
      const d = document.createElement("div");
      d.textContent = p.name + (NET && p.id === NET.hostId ? " (host)" : "") + ": " + (st && S0.c[st.c] ? S0.c[st.c].name : "choosing");
      L.appendChild(d);
    });
    el("begin").hidden = !(NET && NET.role === "host");
    el("lobbywait").hidden = !!(NET && NET.role === "host");
    drawList();
  }
  el("host").onclick = function () {
    if (NET) return;
    el("netmsg").textContent = "Opening a room…";
    NET = CBZ.presNet.host({ name: myName(), relay: Q.get("relay") || null });
    NET.on("code", lobbyView);
    NET.on("open", function () { el("netmsg").textContent = ""; hostSeat(NET.id, pick, myName()); });
    NET.on("roster", pushLobby);
    NET.on("seat", function (d) { hostSeat(d.from, d.c, d.name); });
    NET.on("need", pushLobby);
    NET.on("leave", function (id) { delete LOBBY.seats[id]; pushLobby(); });
    NET.on("error", function (m) { el("netmsg").textContent = m; NET = null; });
  };
  function joinRoom(code) {
    if (NET) return;
    el("netmsg").textContent = "Joining " + code + "…";
    NET = CBZ.presNet.join(code, { name: myName(), relay: Q.get("relay") || null });
    NET.on("open", function () { el("netmsg").textContent = ""; NET.seat(pick, myName()); lobbyView(); });
    NET.on("roster", lobbyView);
    NET.on("lobby", function (d) {
      LOBBY = d;
      // the host's world is the room's world
      if (d.scen && d.scen !== scen) { const key = S0.c[pick] && S0.c[pick].key; setScen(d.scen, key); drawScens(); NET.seat(pick, myName()); }
      const mine = LOBBY.seats[NET.id]; if (mine && S0.c[mine.c]) pick = mine.c;
      drawMap(); lobbyView();
    });
    // the host began: everybody into the game, the same room, his clock
    NET.on("start", function (d) {
      const st = (d.seats || LOBBY.seats)[NET.id]; if (!st) return;
      CBZ.presGo(gameUrl(st.c, { room: roomCode(), pname: myName(), pseed: String(d.pseed || pseed) }));
    });
    NET.on("error", function (m) { el("netmsg").textContent = m; NET = null; });
  }
  el("join").onclick = function () { const c = (el("jcode").value || "").trim(); if (c) joinRoom(c); };
  el("begin").onclick = function () {
    if (!NET || NET.role !== "host") return;
    NET.start(null, { seats: LOBBY.seats, pseed: pseed, scen: scen });
    const code = roomCode();
    setTimeout(function () { CBZ.presGo(gameUrl(LOBBY.seats[NET.id].c, { room: code, host: "1", pname: myName() })); }, 400);
  };

  // ------------------------------------------------------------ go
  el("asof").textContent = "Leaders as of " + NA.AS_OF + ".";
  setScen(scen);
  drawAll();
  if (Q.get("room")) { el("jcode").value = Q.get("room"); joinRoom(Q.get("room")); }
  if (Q.get("auto") === "1") el("solo").onclick();
})();
