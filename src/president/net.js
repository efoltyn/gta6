/* ============================================================
   president/net.js — SEVERAL PRESIDENTS, ONE WORLD. THE WIRE ONLY.

   The world is a deterministic model (world.js): the same state plus the
   same actions gives the same next day on every machine. So multiplayer is
   lockstep, and the host's whole job is to say what happened today:

     host   runs the clock. Every day it broadcasts { k:"tick", day, acts }
            (the actions every president sent since the last tick, in the
            order the host received them) and steps its own world with them.
            It sends the whole state on join and every 90 days anyway, so a
            browser whose floating point disagrees is pulled back into line.
     guest  never steps on its own. It sends its actions to the host and
            applies each tick when it arrives. A gap (a tick for a day it is
            not on) asks the host for the state.

   The transport is src/net/rooms.js (a room is the host's browser tab, a
   four-character code, WebRTC through PeerJS) speaking server/server.js's
   protocol, so ?relay=ws://... reaches a node relay with no change here.
   Every President message rides the relay's own verbs: t:"world" from the
   host (the relay refuses it from anyone else), t:"ev" e:"pres" from a guest
   to the host.

   PUBLIC  CBZ.presNet = { host(opts), join(code, opts) } -> session {
     role, code, id, hostId, players(), seats, send(action), tick(day, acts),
     snapshot(S), lobby(info), seat(country), close(), on(event, fn) }
   events: open, code, roster, lobby, start, tick, snap, act (host: a guest's
     action), seat (host: a seat request), error, close
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  function pid() {
    try {
      // one per TAB (a reload is the same president; a second tab is another one)
      let v = sessionStorage.getItem("pres_pid");
      if (!v) { v = "p" + Math.random().toString(36).slice(2, 10); sessionStorage.setItem("pres_pid", v); }
      return v;
    } catch (e) { return "p" + Math.random().toString(36).slice(2, 10); }
  }
  function session(url, opts) {
    opts = opts || {};
    const ev = {};
    const on = function (k, fn) { (ev[k] || (ev[k] = [])).push(fn); };
    const emit = function (k, d) { (ev[k] || []).forEach(function (fn) { try { fn(d); } catch (e) { console.error("[presNet]", k, e); } }); };
    const ses = { role: opts.host ? "host" : "guest", code: "", id: null, hostId: null, list: [], on: on, open: false };
    let sock = null;
    const relay = opts.relay;
    if (relay) sock = new WebSocket(relay);
    else if (CBZ.rooms) sock = CBZ.rooms.open(url, { onCode: function (c) { ses.code = c; emit("code", c); }, roomName: "President", maxPlayers: 16 });
    else { setTimeout(function () { emit("error", "The room service did not load."); }, 0); return ses; }
    const send = function (m) { try { sock.send(JSON.stringify(m)); } catch (e) {} };
    sock.onopen = function () { send({ t: "hello", name: opts.name || "President", role: "pres", pid: pid() }); };
    sock.onerror = function (e) { emit("error", (sock && sock.reason) || (e && e.message) || "The room could not be reached."); };
    sock.onclose = function () { ses.open = false; emit("close", sock && sock.reason); };
    sock.onmessage = function (e) {
      let m; try { m = JSON.parse(e.data); } catch (er) { return; }
      if (!m) return;
      if (m.t === "welcome") {
        ses.id = m.id; ses.hostId = m.hostId; ses.open = true;
        ses.list = (m.players || []).concat([{ id: m.id, name: opts.name || "President" }]);
        if (sock.code) ses.code = sock.code;
        emit("open", ses); emit("roster", ses.list);
        // the host election belongs to the relay: the oldest seat is host
        ses.role = ses.id === ses.hostId ? "host" : "guest";
        if (ses.role === "guest") send({ t: "ev", e: "pres", to: ses.hostId, d: { k: "hi" } });
        return;
      }
      if (m.t === "join") { ses.list.push({ id: m.id, name: m.name }); emit("roster", ses.list); return; }
      if (m.t === "leave") { ses.list = ses.list.filter(function (p) { return p.id !== m.id; }); emit("roster", ses.list); emit("leave", m.id); return; }
      if (m.t === "host") { ses.hostId = m.id; ses.role = ses.id === m.id ? "host" : "guest"; emit("host", m.id); return; }
      if (m.t === "deny") { emit("error", m.reason || "The room refused us."); return; }
      if (m.t === "world") {
        const d = m.d || {};
        if (d.k === "tick") emit("tick", d);
        else if (d.k === "snap") emit("snap", d);
        else if (d.k === "lobby") emit("lobby", d);
        else if (d.k === "start") emit("start", d);
        return;
      }
      if (m.t === "ev" && m.e === "pres") {
        const d = m.d || {};
        if (d.k === "act") emit("act", { from: m.id, a: d.a });
        else if (d.k === "seat") emit("seat", { from: m.id, c: d.c, name: d.name });
        else if (d.k === "hi" || d.k === "need") emit("need", { from: m.id });
        return;
      }
    };
    // ---- host verbs
    // hold: apply these actions without advancing the day (a paused room)
    ses.tick = function (day, acts, hold) { send({ t: "world", d: { k: "tick", day: day, acts: acts, hold: hold ? 1 : 0 } }); };
    ses.snapshot = function (S, extra) { send({ t: "world", d: Object.assign({ k: "snap", S: S }, extra || {}) }); };
    ses.lobby = function (info) { send({ t: "world", d: Object.assign({ k: "lobby" }, info) }); };
    ses.start = function (S, info) { send({ t: "world", d: Object.assign({ k: "start", S: S }, info || {}) }); };
    // ---- guest verbs
    ses.send = function (a) { send({ t: "ev", e: "pres", to: ses.hostId, d: { k: "act", a: a } }); };
    ses.seat = function (c, name) { send({ t: "ev", e: "pres", to: ses.hostId, d: { k: "seat", c: c, name: name } }); };
    ses.need = function () { send({ t: "ev", e: "pres", to: ses.hostId, d: { k: "need" } }); };
    ses.close = function () { try { sock.close(); } catch (e) {} };
    ses.players = function () { return ses.list.slice(); };
    return ses;
  }

  CBZ.presNet = {
    host: function (opts) { opts = Object.assign({}, opts, { host: true }); return session("room:host", opts); },
    join: function (code, opts) { const c = CBZ.rooms ? CBZ.rooms.cleanCode(code) : String(code || "").toUpperCase(); return session("room:" + c, opts); },
  };
})();
