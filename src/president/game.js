/* ============================================================
   president/game.js — THE DOOR: pick a real country, take office.

   This page is only the choice. The game is the real Executive Mansion in
   the real engine: TAKE OFFICE opens index.html on Gang City's estate slice
   with ?president=<country> (city/president_game.js), where you are a body
   in the chair behind the Resolute desk and the world's business comes to
   you through the phone, the folders, the briefing book and the people who
   walk in.

   A room of presidents is set up here (host, codes, who takes which
   country), then every president's page opens the game with the room's code
   and the host's page runs the one clock (president/net.js, lockstep).

   The countries, their leaders and their numbers are president/nations.js;
   the map is president/earth.js. Nothing on this page is invented.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const el = function (id) { return document.getElementById(id); };
  const Q = new URLSearchParams(location.search);
  const PW = CBZ.presWorld, NA = CBZ.presNations;

  const S0 = PW.create(1);
  let pick = Math.max(0, NA.list.findIndex(function (n) { return n.id === (Q.get("c") || "usa"); }));
  const pseed = +(Q.get("pseed") || 0) || ((Date.now() / 1000) | 0) % 99991 + 1;

  // ------------------------------------------------------------ the map
  function drawMap() {
    const cv = el("preview"), x = cv.getContext("2d"), M = PW.geo();
    const id = x.createImageData(M.W, M.H);
    const cols = S0.c.map(function (c) { const n = parseInt(c.color.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let i = 0; i < M.W * M.H; i++) {
      const o = i * 4, e = M.land[i], pv = M.cell[i];
      if (e < 0) { id.data[o] = 22; id.data[o + 1] = 46; id.data[o + 2] = 74; id.data[o + 3] = 255; continue; }
      let col = pv >= 0 ? cols[S0.p[pv].owner] : [70, 74, 80];
      let k = pv >= 0 && S0.p[pv].owner === pick ? 1.18 : pv >= 0 ? 0.82 : 1;
      const xx = i % M.W;
      const nb = [xx < M.W - 1 ? i + 1 : i, i + M.W < M.W * M.H ? i + M.W : i];
      for (const t of nb) { if (M.land[t] !== e) { k *= 0.6; break; } }
      id.data[o] = Math.min(255, col[0] * k); id.data[o + 1] = Math.min(255, col[1] * k); id.data[o + 2] = Math.min(255, col[2] * k); id.data[o + 3] = 255;
    }
    const tmp = document.createElement("canvas"); tmp.width = M.W; tmp.height = M.H; tmp.getContext("2d").putImageData(id, 0, 0);
    cv.width = M.W * 2; cv.height = M.H * 2;
    x.imageSmoothingEnabled = false;
    x.drawImage(tmp, 0, 0, cv.width, cv.height);
    // the chosen country's name over its capital
    const c = S0.c[pick], g = M.provs[c.cap];
    x.font = "700 22px Fredoka, sans-serif"; x.textAlign = "center"; x.textBaseline = "bottom";
    x.lineWidth = 4; x.strokeStyle = "rgba(0,0,0,.75)"; x.strokeText(c.name.toUpperCase(), g.lx * 2, g.ly * 2 - 6);
    x.fillStyle = "#ffe066"; x.fillText(c.name.toUpperCase(), g.lx * 2, g.ly * 2 - 6);
  }
  el("preview").onclick = function (e) {
    const r = this.getBoundingClientRect(), M = PW.geo();
    const tx = Math.floor((e.clientX - r.left) / r.width * M.W), ty = Math.floor((e.clientY - r.top) / r.height * M.H);
    for (let rr = 0; rr <= 3; rr++) for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const pv = M.cell[(ty + dy) * M.W + tx + dx];
      if (pv >= 0) { choose(S0.p[pv].owner); return; }
    }
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
  function choose(id) {
    pick = id;
    drawMap(); drawList();
    if (NET && NET.role === "guest") NET.seat(pick, myName());
    if (NET && NET.role === "host") hostSeat(NET.id, pick, myName());
  }
  function myName() { return (el("pname").value || "").trim() || "President"; }

  // ------------------------------------------------------------ into office
  function gameUrl(c, extra) {
    const q = new URLSearchParams({ slice: "estate", president: NA.list[c].id, pseed: String(pseed) });
    for (const k in extra || {}) q.set(k, extra[k]);
    if (Q.get("relay") && extra && extra.room) q.set("relay", Q.get("relay"));
    // the engine page: index.html here, gang-city.html in the portal build (tools/build-web-release.mjs)
    return (CBZ.ENGINE_PAGE || "../index.html") + "?" + q.toString();
  }
  // the one way out of this page (a test stubs it to read where it would go)
  CBZ.presGo = CBZ.presGo || function (u) { location.href = u; };
  el("solo").onclick = function () { CBZ.presGo(gameUrl(pick, { pname: myName() })); };

  // ------------------------------------------------------------ a room
  let NET = null, LOBBY = { seats: {} };
  // the code the game pages meet on (a node relay has one room and no code of its own)
  function roomCode() { return (NET && NET.code) || (Q.get("relay") ? "RELAY" : ""); }
  function hostSeat(pid, c, name) {
    for (const k in LOBBY.seats) if (LOBBY.seats[k].c === c && String(k) !== String(pid)) return;
    LOBBY.seats[pid] = { c: c, name: name || "President" };
    pushLobby();
  }
  function pushLobby() { LOBBY.pseed = pseed; if (NET) NET.lobby(LOBBY); lobbyView(); }
  function lobbyView() {
    el("lobby").hidden = false;
    el("code").textContent = (NET && NET.code) || "....";
    const L = el("seats"); L.innerHTML = "";
    for (const k in taken) delete taken[k];
    (NET ? NET.players() : []).forEach(function (p) {
      const st = LOBBY.seats[p.id];
      if (st) taken[st.c] = p.name;
      const d = document.createElement("div");
      d.textContent = p.name + (NET && p.id === NET.hostId ? " (host)" : "") + ": " + (st ? S0.c[st.c].name : "choosing");
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
    NET.on("lobby", function (d) { LOBBY = d; const mine = LOBBY.seats[NET.id]; if (mine) pick = mine.c; drawMap(); lobbyView(); });
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
    NET.start(null, { seats: LOBBY.seats, pseed: pseed });
    const code = roomCode();
    setTimeout(function () { CBZ.presGo(gameUrl(LOBBY.seats[NET.id].c, { room: code, host: "1", pname: myName() })); }, 400);
  };

  // ------------------------------------------------------------ go
  el("asof").textContent = "Leaders as of " + NA.AS_OF + ".";
  drawMap(); drawList();
  if (Q.get("room")) { el("jcode").value = Q.get("room"); joinRoom(Q.get("room")); }
  if (Q.get("auto") === "1") el("solo").onclick();
})();
