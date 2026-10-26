/* ============================================================
   president/game.js — THE PAGE: pick a world and a country, take office,
   run the clock, hand the world's matters to the people in the room.

   One world model (world.js) and one action door (apply). Single player
   applies your taps at once; in a room every tap goes to the host and comes
   back on the next tick, so nobody's world can drift from anybody else's.

   The win is the one the owner set: outlast the other presidents. Every
   leader who falls (an election, a coup, a bullet, a surrender) is replaced
   by a new AI with his own mind; when no original rival is left in office
   and you still are, you have won. Out of office first, and it is over.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  const el = function (id) { return document.getElementById(id); };
  const Q = new URLSearchParams(location.search);

  // ---------------------------------------------------------------- boot
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.RAGDOLL_ANY_MODE == null) CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
  CBZ.ragdollDriven = true;
  CBZ.game = CBZ.game || {};
  CBZ.game.mode = "president";
  const NEED = ["people", "speech", "rooms", "ragdoll"];
  const EXTRA = [
    "weapons/weapon-data.js", "weapons/weapon-scale.js", "weapons/optics.js",
    "weapons/appearances/sidearm.js", "weapons/appearances/carbine.js",
    "systems/actorweapons.js", "systems/gunfx.js",
    "city/campaign_ui.js",
  ];
  const MINE = ["president/office.js"];
  let engine = false;
  function loadBatch(list) {
    return new Promise(function (resolve) {
      let left = list.length; if (!left) return resolve();
      list.forEach(function (rel) {
        const s = document.createElement("script");
        s.src = CBZ.studio.root + rel + (CBZ.studio.bust || "");
        s.async = false;
        const done = function () { if (--left === 0) resolve(); };
        s.onload = done; s.onerror = function () { console.warn("[president] could not load", rel); done(); };
        document.head.appendChild(s);
      });
    });
  }
  const engineReady = CBZ.studio.need(NEED)
    .then(function () { return loadBatch(EXTRA); })
    .then(function () { return loadBatch(MINE); })
    .then(function () { engine = true; el("bootst").textContent = ""; })
    .catch(function (e) { console.error(e); el("bootst").textContent = "The engine did not load."; });

  const PW = CBZ.presWorld;

  // ------------------------------------------------------------ the world
  let seed = +(Q.get("seed") || 0) || ((Date.now() / 1000) | 0) % 100000;
  let nC = Math.max(4, Math.min(16, +(Q.get("countries") || 12)));
  let S0 = null, pickC = -1;
  function newWorld() {
    S0 = PW.create(seed, { countries: nC });
    if (pickC < 0 || pickC >= S0.c.length) pickC = defaultPick(S0);
    el("seed").value = seed;
    drawPreview(); drawList();
  }
  function defaultPick(S) {
    // a middle power: not the giant, not the minnow
    const by = S.c.slice().sort(function (a, b) { return b.gdp - a.gdp; });
    return by[Math.floor(by.length / 3)].id;
  }
  function drawPreview() {
    const cv = el("preview"), x = cv.getContext("2d"), M = PW.geo(S0.seed, S0.nC);
    const id = x.createImageData(M.W, M.H);
    const cols = S0.c.map(function (c) { const n = parseInt(c.color.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let i = 0; i < M.W * M.H; i++) {
      const p = M.cell[i], o = i * 4;
      if (p < 0) { id.data[o] = 24; id.data[o + 1] = 52; id.data[o + 2] = 84; id.data[o + 3] = 255; continue; }
      const c = S0.p[p].owner;
      let k = c === pickC ? 1.12 : 0.92;
      const tx = i % M.W, ty = (i / M.W) | 0;
      const nb = [tx > 0 ? i - 1 : -1, tx < M.W - 1 ? i + 1 : -1, ty > 0 ? i - M.W : -1, ty < M.H - 1 ? i + M.W : -1];
      for (const t of nb) if (t >= 0 && (M.cell[t] < 0 || S0.p[M.cell[t]].owner !== c)) { k *= 0.65; break; }
      const col = cols[c];
      id.data[o] = Math.min(255, col[0] * k); id.data[o + 1] = Math.min(255, col[1] * k); id.data[o + 2] = Math.min(255, col[2] * k); id.data[o + 3] = 255;
    }
    const tmp = document.createElement("canvas"); tmp.width = M.W; tmp.height = M.H; tmp.getContext("2d").putImageData(id, 0, 0);
    x.imageSmoothingEnabled = false;
    x.drawImage(tmp, 0, 0, cv.width, cv.height);
    // names
    const sum = S0.c.map(function () { return { x: 0, y: 0, n: 0 }; });
    for (let i = 0; i < M.W * M.H; i++) { const p = M.cell[i]; if (p < 0) continue; const s = sum[S0.p[p].owner]; s.x += i % M.W; s.y += (i / M.W) | 0; s.n++; }
    const sx = cv.width / M.W;
    S0.c.forEach(function (c, k) {
      const s = sum[k]; if (!s.n) return;
      x.font = "700 " + Math.max(11, Math.min(20, Math.sqrt(s.n) * 1.1)) + "px Fredoka, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 3; x.strokeStyle = "rgba(0,0,0,.7)"; x.strokeText(c.name.toUpperCase(), s.x / s.n * sx, s.y / s.n * sx);
      x.fillStyle = k === pickC ? "#ffe066" : "#fff"; x.fillText(c.name.toUpperCase(), s.x / s.n * sx, s.y / s.n * sx);
    });
  }
  function resOf(S, cid) {
    const t = {};
    for (const p of S.p) if (p.owner === cid) for (const k in p.fac) t[k] = (t[k] || 0) + p.fac[k] * S.yield[PW.GI[k]] * PW.GOODS[PW.GI[k]].P0;
    return Object.keys(t).sort(function (a, b) { return t[b] - t[a]; }).slice(0, 3).map(function (k) { return PW.GOODS[PW.GI[k]].name.toLowerCase(); }).join(", ");
  }
  function drawList() {
    const L = el("clist"); L.innerHTML = "";
    const seats = LOBBY ? LOBBY.seats : {};
    const taken = {};
    for (const k in seats) taken[seats[k].c] = seats[k].name;
    S0.c.slice().sort(function (a, b) { return b.gdp - a.gdp; }).forEach(function (c) {
      const d = document.createElement("button");
      d.className = "crow" + (c.id === pickC ? " on" : "") + (taken[c.id] && c.id !== pickC ? " taken" : "");
      const dr = (c.debt / c.gdp * 100).toFixed(0);
      d.innerHTML = "<i style='background:" + c.color + "'></i><b></b><span></span><em></em>";
      d.querySelector("b").textContent = c.name + (taken[c.id] ? " · " + taken[c.id] : "");
      d.querySelector("span").textContent = c.regime + " · $" + (c.gdp >= 1000 ? (c.gdp / 1000).toFixed(1) + " tn" : Math.round(c.gdp) + " bn") + " · " + c.pop + "M people · debt " + dr + "%";
      d.querySelector("em").textContent = Math.round(c.div) + " divisions" + (c.nukes ? " · " + c.nukes + " warheads" : "") + " · " + resOf(S0, c.id);
      d.onclick = function () { pickC = c.id; drawPreview(); drawList(); if (NET && NET.role === "guest") NET.seat(c.id, myName()); if (NET && NET.role === "host") hostSeat(NET.id, c.id, myName()); };
      L.appendChild(d);
    });
  }
  el("seed").onchange = function () { seed = Math.abs(+this.value | 0) || 1; newWorld(); if (NET && NET.role === "host") pushLobby(); };
  el("reroll").onclick = function () { seed = (Math.random() * 99999 | 0) + 1; newWorld(); if (NET && NET.role === "host") pushLobby(); };
  document.querySelectorAll("[data-n]").forEach(function (b) {
    b.onclick = function () { nC = +b.getAttribute("data-n"); document.querySelectorAll("[data-n]").forEach(function (q) { q.classList.toggle("on", q === b); }); pickC = -1; newWorld(); if (NET && NET.role === "host") pushLobby(); };
    b.classList.toggle("on", +b.getAttribute("data-n") === nC);
  });
  el("preview").onclick = function (e) {
    const r = this.getBoundingClientRect(), M = PW.geo(S0.seed, S0.nC);
    const tx = Math.floor((e.clientX - r.left) / r.width * M.W), ty = Math.floor((e.clientY - r.top) / r.height * M.H);
    const p = M.cell[ty * M.W + tx];
    if (p >= 0) { pickC = S0.p[p].owner; drawPreview(); drawList(); if (NET && NET.role === "guest") NET.seat(pickC, myName()); if (NET && NET.role === "host") hostSeat(NET.id, pickC, myName()); }
  };
  function myName() { const v = (el("pname").value || "").trim(); return v || "President"; }

  // ------------------------------------------------------------ the room
  let NET = null, LOBBY = null;
  function hostSeat(pid, c, name) {
    if (!LOBBY) return;
    for (const k in LOBBY.seats) if (LOBBY.seats[k].c === c && +k !== pid) return;     // taken
    LOBBY.seats[pid] = { c: c, name: name || "President" };
    pushLobby();
  }
  function pushLobby() {
    LOBBY.seed = seed; LOBBY.nC = nC;
    NET.lobby(LOBBY);
    lobbyView();
  }
  function lobbyView() {
    const s = el("lobby"); s.hidden = false;
    el("code").textContent = NET.code || "....";
    const L = el("seats"); L.innerHTML = "";
    const list = NET.players();
    list.forEach(function (p) {
      const st = LOBBY && LOBBY.seats[p.id];
      const d = document.createElement("div");
      d.textContent = p.name + (p.id === NET.hostId ? " (host)" : "") + " — " + (st && S0 && S0.c[st.c] ? S0.c[st.c].name : "choosing");
      L.appendChild(d);
    });
    el("begin").hidden = NET.role !== "host";
    el("lobbywait").hidden = NET.role === "host";
  }
  el("host").onclick = function () {
    if (NET) return;
    el("netmsg").textContent = "Opening a room…";
    NET = CBZ.presNet.host({ name: myName(), relay: Q.get("relay") || null });
    LOBBY = { seats: {}, seed: seed, nC: nC };
    NET.on("code", function () { lobbyView(); });
    NET.on("open", function () { el("netmsg").textContent = ""; hostSeat(NET.id, pickC, myName()); });
    NET.on("roster", function () { lobbyView(); pushLobby(); });
    NET.on("seat", function (d) { hostSeat(d.from, d.c, d.name); });
    NET.on("need", function (d) { pushLobby(); if (S && started) NET.snapshot(S, { seats: LOBBY.seats }); });
    NET.on("act", function (d) { const st = LOBBY.seats[d.from]; if (!st || !d.a) return; d.a.c = st.c; PENDING.push(d.a); });
    NET.on("leave", function (id) { if (LOBBY.seats[id] && started) PENDING.push({ type: "seat", c: LOBBY.seats[id].c, who: null }); delete LOBBY.seats[id]; pushLobby(); });
    NET.on("error", function (m) { el("netmsg").textContent = m; NET = null; });
  };
  function joinRoom(code) {
    if (NET) return;
    el("netmsg").textContent = "Joining " + code + "…";
    NET = CBZ.presNet.join(code, { name: myName(), relay: Q.get("relay") || null });
    NET.on("open", function () { el("netmsg").textContent = ""; lobbyView(); });
    NET.on("roster", function () { lobbyView(); });
    NET.on("lobby", function (d) {
      LOBBY = d;
      if (!S0 || S0.seed !== d.seed || S0.nC !== d.nC) { seed = d.seed; nC = d.nC; newWorld(); }
      const mine = LOBBY.seats[NET.id];
      if (!mine) NET.seat(pickC, myName()); else pickC = mine.c;
      drawPreview(); drawList(); lobbyView();
    });
    NET.on("start", function (d) { LOBBY.seats = d.seats || LOBBY.seats; const st = LOBBY.seats[NET.id]; if (!st) return; begin(d.S, st.c); });
    NET.on("snap", function (d) { if (d.seats) LOBBY.seats = d.seats; if (!started) { const st = LOBBY && LOBBY.seats[NET.id]; if (st) begin(d.S, st.c); return; } S = d.S; ui.dirty = true; if (CBZ.presOffice) CBZ.presOffice.redraw(); });
    NET.on("tick", function (d) {
      if (!started) return;
      if (d.day !== S.day) { if (d.day > S.day) NET.need(); return; }
      if (d.hold) { for (const a of d.acts || []) PW.apply(S, a); afterStep(); return; }
      PW.step(S, d.acts || []); afterStep();
    });
    NET.on("error", function (m) { el("netmsg").textContent = m; NET = null; });
  }
  el("join").onclick = function () { const c = (el("jcode").value || "").trim(); if (c) joinRoom(c); };
  el("begin").onclick = function () {
    if (!NET || NET.role !== "host") return;
    const W0 = PW.create(seed, { countries: nC });
    for (const k in LOBBY.seats) PW.apply(W0, { type: "seat", c: LOBBY.seats[k].c, who: String(k) });
    NET.start(W0, { seats: LOBBY.seats });
    begin(W0, LOBBY.seats[NET.id].c);
  };
  el("solo").onclick = function () {
    const W0 = PW.create(seed, { countries: nC });
    PW.apply(W0, { type: "seat", c: pickC, who: "you" });
    begin(W0, pickC);
  };

  // ------------------------------------------------------------ playing
  let S = null, ME = -1, started = false;
  const PENDING = [];
  const ui = { me: -1, sel: null, selP: null, phoneTab: "holler", call: null };
  const SPEEDS = [0, 1, 3, 8, 20];          // days a second
  let speed = 2, acc = 0, prompting = false, lastN = 0, seenM = {};
  function begin(W0, me) {
    S = W0; ME = me; ui.me = me; ui.sel = me; started = true; CBZ.game.state = "playing";
    lastN = S.evN || 0; seenM = {};
    el("start").hidden = true; el("lobby").hidden = true;
    engineReady.then(function () {
      if (!CBZ.micro || !CBZ.presOffice) { el("bootst").textContent = "The office did not load."; return; }
      CBZ.micro.pauseKey = null;
      CBZ.micro.boot({ sky: false, lights: false, shadows: false, fov: 60, near: 0.05, far: 80, exposure: 1.05, antialias: true });
      CBZ.micro.autoRender = true;
      CBZ.presOffice.init({
        state: function () { return S; }, me: function () { return ME; }, ui: ui,
        submit: submit,
        onPrompt: function (on) { prompting = on; },
        onMode: function (m) { document.body.classList.toggle("focused", m !== "seat"); },
        onDeath: function (why) { setTimeout(function () { gameOver(why); }, 1400); },
      });
      document.body.classList.add("playing");
      CBZ.micro.onFrame(frame, { order: 10, id: "president" });
      setInterval(clock, 100);
      hud();
    });
  }
  // every tap that changes the world
  function submit(a) {
    if (!S) return;
    a.c = ME;
    if (NET) {
      if (NET.role === "host") PENDING.push(a); else NET.send(a);
      return;
    }
    const r = PW.apply(S, a);
    react(a, r);
    afterStep(true);
  }
  // a person answers an order that ran into him
  function react(a, r) {
    if (!r || r.ok) return;
    if (r.why === "refused" && r.role) {
      const line = CBZ.presHoller.said(S, ME, { k: "refused", role: r.role });
      CBZ.presOffice.say(r.role, line);
    }
  }
  /* THE CLOCK IS NOT THE FRAME. The world steps on a timer, so a host whose
     tab is in the background (where requestAnimationFrame stops) still runs
     the day for everybody; the frame only draws. */
  let lastClock = 0;
  function clock() {
    if (!S) return;
    const now = performance.now(), dt = lastClock ? Math.min(1.5, (now - lastClock) / 1000) : 0;
    lastClock = now;
    if (S.over && S.over.final) return;
    if (NET && NET.role !== "host") return;
    const paused = speed === 0 || (!NET && prompting) || (c() && c().out && !watching);
    if (paused) {
      // a paused room still takes decisions: they land now, on every machine
      if (NET && PENDING.length) { const acts = PENDING.splice(0, PENDING.length); NET.tick(S.day, acts, true); for (const a of acts) PW.apply(S, a); afterStep(); }
      return;
    }
    acc += dt * SPEEDS[speed];
    let n = 0;
    while (acc >= 1 && n < 30) {
      acc -= 1; n++;
      const acts = PENDING.splice(0, PENDING.length);
      if (NET) NET.tick(S.day, acts);
      PW.step(S, acts);
      if (NET && S.day % 90 === 0) NET.snapshot(S, { seats: LOBBY.seats });
      afterStep();
    }
    if (acc > 3) acc = 3;
  }
  function frame(dt) {
    if (!S) return;
    CBZ.presOffice.update(Math.min(dt, 0.1));
    hudTick();
  }
  function c() { return S && S.c[ME]; }
  let watching = false;
  // after a day (or an order): new things happened; new things want you
  function afterStep(local) {
    const me = c(); if (!me) return;
    // the log: what the people in the room react to
    for (const e of S.log) {
      if (!(e.n > lastN)) continue;
      lastN = e.n;
      if (e.c === ME && e.k === "refused" && local !== true) CBZ.presOffice.say(e.role, CBZ.presHoller.said(S, ME, e));
      if (e.c === ME && e.k === "strike") CBZ.presOffice.say("general", CBZ.presHoller.said(S, ME, e));
      if (e.c === ME && (e.k === "coupFailed" || e.k === "plotFoiled" || e.k === "fall")) CBZ.presOffice.outcome(e);
      if (e.c === ME && e.k === "reelected") CBZ.presOffice.say("security", Math.round(e.share) + " percent, sir.");
      if (e.c === ME && e.k === "fall") { if (!document.body.classList.contains("over")) setTimeout(function () { gameOver(e.why); }, e.why === "coup" || e.why === "assassinated" ? 2600 : 900); }
    }
    // the matters: who brings each one
    for (const m of me.matters) {
      if (seenM[m.id]) continue;
      seenM[m.id] = 1;
      if (m.kind === "bill") continue;                                  // the folder on the desk
      if (CBZ.presPapers.isCall(m)) CBZ.presOffice.ring(m);
      else CBZ.presOffice.deliver(m);
    }
    if (S.over && S.over.winner === ME && !document.body.classList.contains("over")) gameOver("won");
    CBZ.presOffice.redraw();
  }

  // ------------------------------------------------------------ HUD: the clock
  function hud() {
    const H = el("hud"); H.hidden = false;
    H.querySelectorAll("[data-sp]").forEach(function (b) {
      b.onclick = function () { speed = +b.getAttribute("data-sp"); hudTick(true); };
    });
    el("back").onclick = function () { CBZ.presOffice.back(); };
    window.addEventListener("keydown", function (e) {
      if (!started) return;
      if (e.key === " ") { speed = speed ? 0 : 2; hudTick(true); e.preventDefault(); }
      if (e.key === "]" || e.key === ".") { speed = Math.min(4, speed + 1); hudTick(true); }
      if (e.key === "[" || e.key === ",") { speed = Math.max(0, speed - 1); hudTick(true); }
    });
  }
  let lastHud = "";
  function hudTick(force) {
    const d = PW.date(S.day).text;
    const k = d + speed + (NET ? NET.role : "");
    if (!force && k === lastHud) return;
    lastHud = k;
    el("date").textContent = d;
    el("hud").querySelectorAll("[data-sp]").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-sp") === speed); b.disabled = !!(NET && NET.role !== "host"); });
  }

  // ------------------------------------------------------------ the end
  function gameOver(why) {
    if (document.body.classList.contains("over")) return;
    document.body.classList.add("over");
    const me = c();
    const days = S.day - (me.leader.original ? me.leader.since : 0);
    const yrs = Math.floor(S.day / 365), dd = S.day % 365;
    const t = { won: "The last one standing.", election: "Voted out.", coup: "Overthrown.", assassinated: "Assassinated.", revolution: "Driven out by the street.", capitulated: "Your country surrendered.", resigned: "You signed it.", annexed: "Your country is gone.", shot: "Shot at your desk." }[why] || "Out of office.";
    el("overt").textContent = t;
    el("overs").textContent = yrs + " years, " + dd + " days in office.";
    const L = el("overl"); L.innerHTML = "";
    S.c.forEach(function (o) {
      const f = S.fallen.find(function (x) { return x.c === o.id && x.original; });
      const d = document.createElement("div");
      d.textContent = o.name + ": " + (f ? (f.name + " out (" + f.why + ") " + PW.date(f.day).text) : (o.leader.original ? o.leader.name + " still in office" : "replaced"));
      if (o.id === ME) d.className = "me";
      L.appendChild(d);
    });
    el("over").hidden = false;
  }
  el("again").onclick = function () { location.href = location.pathname + "?seed=" + ((Math.random() * 99999 | 0) + 1); };
  el("watch").onclick = function () { watching = true; el("over").hidden = true; };

  // ------------------------------------------------------------ go
  newWorld();
  if (Q.get("room")) { el("jcode").value = Q.get("room"); joinRoom(Q.get("room")); }
  if (Q.get("auto") === "1") el("solo").onclick();
  // tools: the live state, the office, the actions
  CBZ.presGame = { state: function () { return S; }, me: function () { return ME; }, submit: submit, speed: function (v) { if (v != null) speed = v; return speed; }, ui: ui };
})();
