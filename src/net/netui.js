/* ============================================================
   net/netui.js — the multiplayer face: a JOIN panel that appears
   on the title screen whenever the page is served by a CBZ game
   server (the link IS the server), and the RP chat box
   (T to talk, /me /do /ooc, server messages, join/leave).
   Pure DOM, builds itself, zero impact when offline/solo.
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ || !window.CBZ.net) return;
  if (typeof document === "undefined" || !document.body || !document.getElementById) return;
  const CBZ = window.CBZ;
  const net = CBZ.net;
  const g = CBZ.game;

  // ---- styles ---------------------------------------------------------------
  const css = document.createElement("style");
  css.textContent = [
    "#netJoin{position:absolute;right:18px;top:18px;z-index:60;width:300px;background:rgba(10,14,24,.92);border:1px solid #2c3a5c;border-radius:14px;padding:14px 16px;color:#dfe7f5;font-family:Fredoka,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}",
    "#netJoin h3{margin:0 0 2px;font-size:18px;color:#8fd0ff;letter-spacing:.5px}",
    "#netJoin .motd{font-size:12.5px;color:#aab6cf;margin:0 0 8px;line-height:1.35}",
    "#netJoin .cnt{font-size:12px;color:#7fe0a0;margin-bottom:8px}",
    "#netJoin input,#netJoin select{width:100%;box-sizing:border-box;background:#101627;border:1px solid #31405f;border-radius:8px;color:#eef;padding:7px 9px;margin:3px 0 8px;font-family:inherit;font-size:14px}",
    "#netJoin label{font-size:11px;color:#8a96b0;text-transform:uppercase;letter-spacing:.8px}",
    "#netJoinBtn{width:100%;background:#2563eb;border:0;border-radius:9px;color:#fff;font-family:inherit;font-weight:600;font-size:16px;padding:9px 0;cursor:pointer}",
    "#netJoinBtn:hover{background:#3b76f0}",
    "#netJoinErr{color:#ff9b9b;font-size:12.5px;min-height:16px;margin-top:6px}",
    "#netChat{position:absolute;left:14px;bottom:118px;z-index:55;width:380px;max-width:44vw;font-family:Fredoka,sans-serif;pointer-events:none}",
    "#netChatLog{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:hidden;justify-content:flex-end}",
    "#netChatLog div{font-size:13.5px;line-height:1.3;color:#e8eefb;text-shadow:0 1px 2px #000,0 0 6px rgba(0,0,0,.6);opacity:.96;word-wrap:break-word}",
    "#netChatLog .k-me{color:#d6a6ff}#netChatLog .k-do{color:#ffce7a}#netChatLog .k-ooc{color:#9aa6bd}#netChatLog .k-sys{color:#ffe87a}#netChatLog .nm{color:#8fd0ff;font-weight:600}",
    "#netChatIn{display:none;margin-top:6px;pointer-events:auto;background:rgba(8,12,22,.9);border:1px solid #31405f;border-radius:8px;color:#eef;padding:7px 10px;width:100%;box-sizing:border-box;font-family:inherit;font-size:14px;outline:none}",
    "#netOnline{position:absolute;right:14px;top:12px;z-index:54;color:#9fd0ff;font-family:Fredoka,sans-serif;font-size:13px;text-shadow:0 1px 2px #000;display:none}",
  ].join("\n");
  document.head.appendChild(css);

  // ---- join panel -----------------------------------------------------------
  let info = null;
  const panel = document.createElement("div");
  panel.id = "netJoin";
  panel.style.display = "none";
  document.body.appendChild(panel);

  function namePref(v) {
    try { if (v != null) localStorage.setItem("CBZ_NET_NAME", v); return localStorage.getItem("CBZ_NET_NAME") || ""; } catch (e) { return ""; }
  }

  function renderPanel() {
    if (!info) return;
    const roles = info.roles && info.roles.length ? info.roles : [{ id: "civ", label: "Civilian" }];
    panel.innerHTML =
      '<h3>🌆 ' + esc(info.name) + "</h3>" +
      '<div class="motd">' + esc(info.motd || "") + "</div>" +
      '<div class="cnt">● ' + info.players + "/" + info.maxPlayers + " online · live RP server</div>" +
      "<label>Character name</label>" +
      '<input id="netName" maxlength="20" placeholder="Eli Cross" value="' + esc(namePref(null)) + '">' +
      "<label>Role</label>" +
      '<select id="netRole">' + roles.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.label || r.id) + "</option>"; }).join("") + "</select>" +
      (info.passworded ? "<label>Password</label><input id=\"netPass\" type=\"password\">" : "") +
      '<button id="netJoinBtn">JOIN SERVER</button>' +
      '<div id="netJoinErr"></div>';
    panel.querySelector("#netJoinBtn").addEventListener("click", join);
    panel.querySelector("#netName").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") join(); });
    if (panel.querySelector("#netPass")) panel.querySelector("#netPass").addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter") join(); });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function join() {
    const err = panel.querySelector("#netJoinErr");
    const name = (panel.querySelector("#netName").value || "").trim();
    if (!name) { err.textContent = "Pick a character name first."; return; }
    namePref(name);
    err.textContent = "Connecting…";
    net.connect({
      name,
      role: panel.querySelector("#netRole").value,
      pass: panel.querySelector("#netPass") ? panel.querySelector("#netPass").value : "",
      onWelcome: function (m) {
        err.textContent = "";
        panel.style.display = "none";
        // make sure CITY is the selected mode, then launch
        const btn = document.querySelector('.mode-btn[data-mode="city"]');
        if (btn) btn.click();
        if (CBZ.startRun) CBZ.startRun();
        addLine("k-sys", "Connected to " + esc(m.server.name) + " — T to talk · /help for commands");
        if (m.server.motd) addLine("k-sys", esc(m.server.motd));
        online.style.display = "block";
        refreshOnline();
      },
      onError: function (reason) { err.textContent = reason || "Couldn't join."; },
    });
  }

  function poll() {
    fetch("/api/info").then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.game !== "cell-block-z") return;
      info = j;
      if (g.state === "title" && !net.active) { renderPanel(); panel.style.display = "block"; }
    }).catch(function () {});
  }
  poll();
  setInterval(function () {
    if (net.active) { panel.style.display = "none"; return; }
    if (g.state === "title") poll(); else panel.style.display = "none";
  }, 4000);

  // ---- chat -----------------------------------------------------------------
  const chat = document.createElement("div");
  chat.id = "netChat";
  chat.innerHTML = '<div id="netChatLog"></div><input id="netChatIn" maxlength="300" placeholder="say…  (/me /do /ooc /players /help)">';
  document.body.appendChild(chat);
  const log = chat.querySelector("#netChatLog");
  const inp = chat.querySelector("#netChatIn");

  const online = document.createElement("div");
  online.id = "netOnline";
  document.body.appendChild(online);
  function refreshOnline() {
    if (!net.active) { online.style.display = "none"; return; }
    online.textContent = "🌐 " + (net.server ? net.server.name : "server") + " · " + (net.players.size + 1) + " online";
  }

  function addLine(kind, html) {
    const d = document.createElement("div");
    if (kind) d.className = kind;
    d.innerHTML = html;
    log.appendChild(d);
    while (log.children.length > 9) log.removeChild(log.firstChild);
    d.style.transition = "opacity 1.2s";
    setTimeout(function () { if (!chatOpen) d.style.opacity = "0.25"; }, 14000);
  }

  net.on("chat", function (m) {
    const nm = esc(m.name);
    if (m.kind === "me") addLine("k-me", "* <span class='nm'>" + nm + "</span> " + esc(m.text));
    else if (m.kind === "do") addLine("k-do", "** " + esc(m.text) + " <span class='nm'>(" + nm + ")</span>");
    else if (m.kind === "ooc") addLine("k-ooc", "(( <span class='nm'>" + nm + ":</span> " + esc(m.text) + " ))");
    else addLine("", "<span class='nm'>" + nm + ":</span> " + esc(m.text));
  });
  net.on("sys", function (m) { addLine("k-sys", esc(m.text)); });
  net.on("join", function (m) {
    addLine("k-sys", esc(m.name) + " arrived in the city");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("👤 " + m.name + " joined", 2.2);
    refreshOnline();
  });
  net.on("leave", function (m) {
    const p = net.players.get(m.id);
    addLine("k-sys", (p ? esc(p.name) : "a player") + " left");
    refreshOnline();
  });
  net.on("host", function (m) { refreshOnline(); });
  net.on("deny", function (m) { addLine("k-sys", "⚠ " + esc(m.reason || "Removed from server")); });
  net.on("_offline", function () { refreshOnline(); addLine("k-sys", "⚠ Connection lost"); });

  let chatOpen = false;
  function openChat() {
    chatOpen = true;
    inp.style.display = "block";
    for (const d of log.children) d.style.opacity = "1";
    if (document.exitPointerLock) document.exitPointerLock();
    setTimeout(function () { inp.focus(); }, 0);
  }
  function closeChat(refocus) {
    chatOpen = false;
    inp.style.display = "none";
    inp.value = "";
    inp.blur();
    if (refocus && CBZ.requestLock) CBZ.requestLock();
  }

  addEventListener("keydown", function (e) {
    if (!net.active || g.mode !== "city" || g.state !== "playing" || chatOpen) return;
    if (e.key.toLowerCase() === "t" || (e.key === "Enter" && !e.repeat)) {
      e.preventDefault();
      openChat();
    }
  });
  inp.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      const text = inp.value.trim();
      if (text) net.chat(text);
      closeChat(true);
    } else if (e.key === "Escape") closeChat(true);
  });
  // the game's key state must never see chat keystrokes as held keys
  inp.addEventListener("keyup", function (e) { e.stopPropagation(); });
})();
