/* ============================================================
   net/net.js — multiplayer core: connection, protocol, own-state
   broadcast, damage routing. The model is FiveM-style:
     - a zero-dep Node relay (server/server.js) owns the room
     - every client is authoritative over its OWN avatar
     - the elected sim-host's browser runs the NPC/traffic world
       and broadcasts snapshots; everyone else renders puppets
   Single-player is untouched: when not connected, every hook in
   here is inert and the city runs exactly as before.
============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined" || !window.CBZ) return;
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const net = {
    active: false,        // connected + welcomed
    id: 0,
    hostId: 0,
    name: "",
    role: "civ",
    server: null,         // {name, motd, tags, maxPlayers}
    feat: [],             // server feature flags from welcome (e.g. "to", "persist")
    serverWorld: null,    // {name, savedAt} when the server holds a saved world
    players: new Map(),   // id -> {id, name, role}
    ws: null,
    _handlers: {},        // msg type -> [fn]
    _evHandlers: {},      // ev subtype -> [fn]
  };
  CBZ.net = net;

  net.isHost = function () { return net.active && net.id === net.hostId; };
  net.guest = function () { return net.active && net.id !== net.hostId; };
  // suppress the local NPC/traffic/cop simulation? (guests render puppets instead)
  net.noSim = function () { return net.guest(); };

  net.on = function (type, fn) { (net._handlers[type] = net._handlers[type] || []).push(fn); };
  net.onEv = function (sub, fn) { (net._evHandlers[sub] = net._evHandlers[sub] || []).push(fn); };
  function emit(map, key, m) {
    const list = map[key];
    if (list) for (const fn of list) { try { fn(m); } catch (e) { console.error("[net]", key, e); } }
  }

  // BACKPRESSURE GATE (CBZ.netBackpressure, default ON; set false to revert).
  // On a reliable WebSocket everything queued WILL arrive — eventually — so when
  // the send buffer is already deep, queuing ANOTHER world/state snapshot just
  // ships stale positions late and drives the relay toward its multi-MB socket
  // kill (= the desync that breaks a shared world under load). We instead DROP
  // high-frequency IDEMPOTENT snapshots while backed up (the next snapshot fully
  // supersedes a dropped one); reliable events (ev/chat/join/death/kick/…) are
  // NEVER dropped. Net effect: a slow link degrades to stutter, not a dropped
  // connection. Inert under normal load (bufferedAmount stays ~0), so OFF==today
  // everywhere except an actual overload.
  const BP_LIMIT = 64 * 1024;        // bytes queued-but-unsent before we shed snapshots
  net._bpDropped = 0;
  function bpShedable(obj) {
    if (obj.t === "world" || obj.t === "state") return true;            // a raw snapshot
    return obj.t === "ev" && obj.e === "to" && obj.d &&                 // a per-guest "to"-wrapped snapshot
      (obj.d.t === "world" || obj.d.t === "state");
  }
  net.send = function (obj) {
    const ws = net.ws;
    if (!ws || ws.readyState !== 1) return;
    if (CBZ.netBackpressure !== false && ws.bufferedAmount > BP_LIMIT && bpShedable(obj)) {
      net._bpDropped++; return;        // shed a stale snapshot rather than deepen the stall
    }
    ws.send(JSON.stringify(obj));
  };
  net.sendEv = function (obj) { obj.t = "ev"; net.send(obj); };
  net.chat = function (text) { net.send({ t: "chat", text }); };

  net.hasFeat = function (f) { return net.feat.indexOf(f) >= 0; };
  // targeted relay (servers advertising feat "to"): the server unwraps d and
  // delivers it to that ONE client — what lets the host send per-guest scoped
  // snapshots instead of broadcasting the whole world to everyone.
  net.sendTo = function (id, d) {
    if (!net.hasFeat("to")) return false;
    net.sendEv({ e: "to", id, d });
    return true;
  };

  // ---- connect / disconnect ----------------------------------------------
  net.connect = function (opts) {
    opts = opts || {};
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = opts.url || proto + "//" + location.host + "/ws";
    try { net.ws = new WebSocket(url); } catch (e) { opts.onError && opts.onError("Could not open a connection."); return; }
    net.name = opts.name || "Stranger";
    net.role = opts.role || "civ";
    net.ws.onopen = function () {
      const m = { t: "hello", name: opts.name, role: opts.role, pass: opts.pass || "", v: 1 };
      // stable identity across sessions (netpersist.js) — keys the saved character
      if (CBZ.netPid) try { m.pid = CBZ.netPid(); } catch (e) {}
      net.send(m);
    };
    net.ws.onmessage = function (e) {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (!m || !m.t) return;
      handle(m, opts);
    };
    net.ws.onclose = function () {
      const was = net.active;
      net.active = false;
      net.feat = [];
      net.serverWorld = null;
      net.players.clear();
      emit(net._handlers, "_offline", {});
      if (was && CBZ.city && CBZ.city.note) CBZ.city.note("⚠ Disconnected from server — world is now local", 4);
    };
    net.ws.onerror = function () { opts.onError && opts.onError("Connection failed."); };
  };

  net.disconnect = function () { if (net.ws) try { net.ws.close(); } catch (e) {} };

  function handle(m, opts) {
    switch (m.t) {
      case "welcome":
        net.id = m.id;
        net.hostId = m.hostId;
        net.server = m.server;
        net.feat = m.feat || (m.server && m.server.feat) || [];
        net.serverWorld = m.world || (m.server && m.server.world) || null;
        net.active = true;
        net.players.clear();
        for (const p of m.players || []) net.players.set(p.id, p);
        emit(net._handlers, "welcome", m);
        if (opts && opts.onWelcome) opts.onWelcome(m);
        break;
      case "deny":
        if (opts && opts.onError) opts.onError(m.reason || "Join refused.");
        emit(net._handlers, "deny", m);
        break;
      case "join":
        net.players.set(m.id, { id: m.id, name: m.name, role: m.role });
        emit(net._handlers, "join", m);
        break;
      case "leave":
        emit(net._handlers, "leave", m);
        net.players.delete(m.id);
        break;
      case "host": {
        const wasHost = net.isHost();
        net.hostId = m.id;
        emit(net._handlers, "host", m);
        if (!wasHost && net.isHost()) becomeHost();
        break;
      }
      case "state": emit(net._handlers, "state", m); break;
      case "world": emit(net._handlers, "world", m); break;
      case "chat": emit(net._handlers, "chat", m); break;
      case "sys": emit(net._handlers, "sys", m); break;
      case "ev": emit(net._evHandlers, m.e, m); break;
      // anything newer (persistence loads etc.) reaches net.on(type, fn) directly
      default: emit(net._handlers, m.t, m); break;
    }
  }

  // Promoted to sim-host mid-session (the old host left): the world reboots
  // around the players — fresh population, everyone keeps their position.
  function becomeHost() {
    if (g.mode !== "city" || g.state === "title") return;
    emit(net._handlers, "_clearPuppets", {});
    if (CBZ.spawnCityPeds) try { CBZ.spawnCityPeds(CBZ.CITY.peds); } catch (e) { console.error(e); }
    if (CBZ.spawnCityTraffic) try { CBZ.spawnCityTraffic(CBZ.CITY.traffic); } catch (e) { console.error(e); }
    if (CBZ.city && CBZ.city.note) CBZ.city.note("⭐ You are now the world host", 3.5);
  }

  // ---- own avatar state broadcast (12 Hz) ---------------------------------
  const SEND_HZ = 12;
  let sendAcc = 0;
  function ownState() {
    const P = CBZ.player;
    const ch = CBZ.playerChar;
    const m = {
      t: "state",
      p: [Math.round(P.pos.x * 20) / 20, Math.round(P.pos.y * 20) / 20, Math.round(P.pos.z * 20) / 20],
      h: Math.round(((ch && ch.group ? ch.group.rotation.y : 0)) * 100) / 100,
      s: Math.round((P.speed || 0) * 10) / 10,
      hp: Math.round(P.hp || 0),
      dead: P.dead ? 1 : 0,
      cr: P.crouch ? 1 : 0,
      w: weaponKey(),
    };
    // proximity-voice speaking flag (netvoice.js) — drives the 🔊 pip over heads
    if (net.voiceSpeaking && net.voiceSpeaking()) m.v = 1;
    // holding a gun (host turns this into NPC gunpoint reactions near you)
    const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon();
    if (it && it.gun && !P.dead && !P.driving) m.aim = 1;
    if (P.driving && P._vehicle) {
      const c = P._vehicle;
      m.car = [
        c.model ? c.model.name : 0,
        Math.round(c.pos.x * 20) / 20, Math.round(c.pos.z * 20) / 20,
        Math.round(c.heading * 100) / 100, Math.round((c.v || 0) * 10) / 10,
      ];
    }
    return m;
  }
  function weaponKey() {
    const f = CBZ.fps;
    if (f && f.active === false && f.weapon == null) return 0;
    return (f && f.weapon) || 0;
  }
  if (CBZ.onAlways) CBZ.onAlways(60, function (dt) {
    if (!net.active || g.mode !== "city") return;
    sendAcc += dt;
    if (sendAcc < 1 / SEND_HZ) return;
    sendAcc = 0;
    if (g.state === "playing" || g.state === "paused") net.send(ownState());
  });

  // ---- damage routing ------------------------------------------------------
  // Shooting a NET target (remote player avatar or a synced puppet NPC).
  // Called from fpsmode's cityGunHit before any local damage is applied.
  net.localGunHit = function (a, hit, w) {
    const fall = hit.dist <= w.dropStart ? 1
      : Math.max(w.minDamage, 1 - ((hit.dist - w.dropStart) / Math.max(1, w.range - w.dropStart)) * (1 - w.minDamage));
    const dmg = Math.max(1, Math.round(w.damage * (hit.head ? w.headMult : 1) * fall));
    if (a.netKind === "player") {
      // PvP: tell the victim's client; their own death system applies it.
      net.sendEv({ e: "pvp", to: a.netId, dmg, head: hit.head ? 1 : 0, nl: w.nonlethal ? 1 : 0 });
    } else {
      // puppet NPC: the sim host owns its HP — route the hit there.
      net.sendEv({ e: "hit", to: net.hostId, k: a.netKind, nid: a.nid, dmg, head: hit.head ? 1 : 0, nl: w.nonlethal ? 1 : 0 });
    }
    // local juice so the shot lands NOW (authority follows ~100ms later)
    if (CBZ.body && CBZ.body.flash) try { CBZ.body.flash(a); } catch (e) {}
    if (CBZ.doHitstop) CBZ.doHitstop(hit.head ? 0.085 : 0.05);
    return { head: hit.head, down: false, dmg };
  };

  // incoming PvP damage (someone shot/struck ME)
  net.onEv("pvp", function (m) {
    const from = net.players.get(m.id);
    const who = from ? from.name : "another player";
    const A = CBZ.netRemoteActor ? CBZ.netRemoteActor(m.id) : null;
    const fx = A ? A.pos.x : CBZ.player.pos.x + 1, fz = A ? A.pos.z : CBZ.player.pos.z;
    if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(m.dmg, fx, fz, (m.melee ? "beaten down by " : "shot by ") + who, !!m.head, A, !!m.nl);
    if (m.melee) {
      // show their swing + a real chance the blow knocks you off your feet
      if (A && A.ch) { A.ch.punchT = 0.001; A.ch.punchDur = 0.22; }
      if (CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor && Math.random() < 0.3 && !CBZ.body.busy(CBZ.city.playerActor)) {
        CBZ.body.knockdown(CBZ.city.playerActor, { fromX: fx, fromZ: fz, force: 7, t: 1.0 });
      }
    }
  });

  // Melee swing landing on a NET target (remote player or synced puppet) —
  // called from city/combat.js land() before any local damage is applied.
  net.localMeleeHit = function (a, dmg, tier) {
    const heavy = tier !== "light";
    if (a.netKind === "player") {
      net.sendEv({ e: "pvp", to: a.netId, dmg: Math.round(dmg), melee: 1, heavy: heavy ? 1 : 0 });
    } else {
      net.sendEv({ e: "hit", to: net.hostId, k: a.netKind, nid: a.nid, dmg: Math.round(dmg), melee: 1 });
    }
    if (CBZ.body) {
      try { CBZ.body.hit(a, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: heavy ? 5 : 3.5 }); } catch (e) {}
      try { CBZ.body.flash(a); } catch (e) {}
    }
    if (CBZ.sfx) CBZ.sfx(heavy ? "punch2" : "punch");
    if (CBZ.doHitstop) CBZ.doHitstop(heavy ? 0.07 : 0.045);
    return true;
  };

  // incoming NPC damage routed from the host (a cop/ped on the host shot ME)
  net.onEv("nhurt", function (m) {
    if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(m.dmg, m.fx, m.fz, m.reason || "gunned down", false, null, !!m.nl);
  });

  // ---- shot broadcast (tracer + bang on everyone else's screen) ------------
  let shotCD = 0;
  if (CBZ.onAlways) CBZ.onAlways(60.1, function (dt) { shotCD -= dt; });
  net.onShot = function (origin, fwd, w) {
    if (!net.active || shotCD > 0) return;
    shotCD = 0.09; // cap the firehose for autos; a 11Hz stream of bangs reads fine
    const L = Math.min(w.range || 40, 70);
    net.sendEv({
      e: "shot",
      o: [Math.round(origin.x * 10) / 10, Math.round(origin.y * 10) / 10, Math.round(origin.z * 10) / 10],
      d: [Math.round((origin.x + fwd.x * L) * 10) / 10, Math.round((origin.y + fwd.y * L) * 10) / 10, Math.round((origin.z + fwd.z * L) * 10) / 10],
      w: w.key || "pistol",
    });
  };

  // ---- hitscan target list (consumed by fpsmode.findActorHit) --------------
  net.targetList = function () {
    const out = [];
    if (CBZ.netRemoteTargets) CBZ.netRemoteTargets(out);
    if (CBZ.netPuppetTargets) CBZ.netPuppetTargets(out);
    return out;
  };

  // host-side: remote players the NPC AI may target/chase/shoot
  net.aiTargets = function () {
    const out = [];
    if (net.isHost() && CBZ.netRemoteTargets) CBZ.netRemoteTargets(out);
    return out;
  };
})();
