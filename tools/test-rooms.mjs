#!/usr/bin/env node
/* ============================================================
   tools/test-rooms.mjs — THE ROOM PROTOCOL, WITHOUT A BROWSER.

   src/net/rooms.js moves server/server.js's room into a browser tab. The
   claim that makes that safe is a strong one — "same verbs, same fields,
   same host election, same `to` guard, same backpressure semantics" — and
   src/net/net.js's handle() is written against it. So it gets tested where
   testing is cheap: makeRelay() is pure (connection objects with send/close/
   buffered, no DOM, no WebRTC, no timers), so the whole protocol runs in
   plain node against fake connections, with no internet and no Chrome.

   That matters for a second reason: tools/warlord-net-check.mjs drives two
   real headless browsers through the PUBLIC PeerJS broker, and a broker
   outage or a firewalled machine makes it fail for a reason that is not this
   repo's fault. When that happens THIS file is still the check that the room
   logic is right, and the browser check is only measuring reachability.

       node tools/test-rooms.mjs
============================================================ */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const rooms = require(path.join(ROOT, "src/net/rooms.js"));

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? "  — " + detail : ""));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

/* A FAKE CONNECTION. Everything the relay is allowed to know about a peer:
   it can push a string at it, hang it up, and ask how deep its send queue
   is. `buf` is settable so a backpressure case is a one-line setup rather
   than a real slow network. */
function fakeConn(label) {
  const c = {
    label, got: [], closed: false, buf: 0,
    send(str) { c.got.push(JSON.parse(str)); },
    close() { c.closed = true; },
    buffered() { return c.buf; },
  };
  c.last = (t) => { for (let i = c.got.length - 1; i >= 0; i--) if (!t || c.got[i].t === t) return c.got[i]; return null; };
  c.all = (t) => c.got.filter((m) => m.t === t);
  c.clear = () => { c.got.length = 0; };
  return c;
}
function joinRoom(relay, conn, name, extra) {
  const h = relay.join(conn);
  h.message(JSON.stringify(Object.assign({ t: "hello", name, role: "civ", v: 1 }, extra || {})));
  return h;
}

// ------------------------------------------------------- codes
{
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const c = rooms.newCode();
    ok("code is 4 chars", c.length === 4, c);
    ok("code has no ambiguous glyph", !/[IO01]/.test(c), c);
    ok("code is in the alphabet", [...c].every((ch) => rooms.ALPHABET.includes(ch)), c);
    seen.add(c);
  }
  ok("codes vary", seen.size > 300, `${seen.size} distinct in 400`);
  eq("cleanCode lowercases", rooms.cleanCode("qk4t"), "QK4T");
  eq("cleanCode strips punctuation", rooms.cleanCode(" q-k 4t "), "QK4T");
  eq("cleanCode drops the look-alikes rather than guessing", rooms.cleanCode("QIOK4T0"), "QK4T");
  eq("cleanCode caps at four", rooms.cleanCode("ABCDEFGH"), "ABCD");
  eq("isRoomUrl", [rooms.isRoomUrl("room:QK4T"), rooms.isRoomUrl("wss://x/ws")], [true, false]);
}

// ------------------------------------------------------- welcome + roster
{
  const relay = rooms.makeRelay({ name: "A ROOM" });
  const a = fakeConn("a"), b = fakeConn("b");
  joinRoom(relay, a, "Dex");
  const wa = a.last("welcome");
  eq("first in is id 1", wa.id, 1);
  eq("first in is the sim host", wa.hostId, 1);
  eq("feat is to, and never persist (a tab has no disk)", wa.feat, ["to"]);
  eq("first in sees an empty roster", wa.players, []);
  ok("welcome carries a server block", !!wa.server && wa.server.maxPlayers > 0);

  joinRoom(relay, b, "Rook");
  const wb = b.last("welcome");
  eq("second in is id 2", wb.id, 2);
  eq("second in inherits the same host", wb.hostId, 1);
  eq("second in is told who is already here", wb.players, [{ id: 1, name: "Dex", role: "civ" }]);
  const ja = a.last("join");
  eq("the room announces the arrival to the people in it", [ja.id, ja.name], [2, "Rook"]);
  ok("an arrival is not announced to itself", b.all("join").length === 0);

  const c = fakeConn("c");
  joinRoom(relay, c, "Dex");
  eq("a duplicate name is suffixed, not refused", c.last("welcome").id, 3);
  eq("...and the suffix is server.js's underscore", relay.roster()[2].name, "Dex_");
}

// ------------------------------------------------------- lanes
{
  const relay = rooms.makeRelay({});
  const a = fakeConn("a"), b = fakeConn("b");
  const ha = joinRoom(relay, a, "Host");
  const hb = joinRoom(relay, b, "Guest");
  a.clear(); b.clear();

  hb.message(JSON.stringify({ t: "state", x: 5 }));
  eq("state is stamped with the sender and relayed", [a.last("state").id, a.last("state").x], [2, 5]);
  ok("state never comes back to its sender", b.all("state").length === 0);

  hb.message(JSON.stringify({ t: "world", d: { tick: 1 } }));
  ok("a guest cannot forge a world tick", a.all("world").length === 0);
  ha.message(JSON.stringify({ t: "world", d: { tick: 2 } }));
  eq("the sim host's world tick reaches the guests", b.last("world").d, { tick: 2 });

  a.clear(); b.clear();
  hb.message(JSON.stringify({ t: "ev", e: "wl", v: "hi", d: { nm: "Guest" } }));
  eq("an ev broadcasts, stamped with the sender", [a.last("ev").e, a.last("ev").id], ["wl", 2]);

  a.clear();
  hb.message(JSON.stringify({ t: "ev", e: "wl", v: "wla", to: 1 }));
  eq("a `to`-addressed ev goes to that one player", a.last("ev").v, "wla");
  ok("...and to nobody else", b.all("ev").length === 0);

  // the point-to-point wrapper + its guard
  a.clear(); b.clear();
  ha.message(JSON.stringify({ t: "ev", e: "to", id: 2, d: { t: "ev", e: "wl", v: "snap", d: 7 } }));
  eq("ev to: the payload is delivered, stamped with the sender", [b.last("ev").v, b.last("ev").id], ["snap", 1]);
  b.clear();
  ha.message(JSON.stringify({ t: "ev", e: "to", id: 2, d: { t: "ev", e: "wsave", world: {} } }));
  ok("ev to: RESERVED_EV cannot be smuggled through the wrapper", b.got.length === 0);
  ha.message(JSON.stringify({ t: "ev", e: "to", id: 2, d: { t: "welcome", id: 99 } }));
  ok("ev to: a core protocol frame cannot be smuggled either", b.got.length === 0);
  ha.message(JSON.stringify({ t: "ev", e: "to", id: 2, d: { t: "world", d: 1 } }));
  eq("ev to: a world row from the sim host does pass", b.last("world").d, 1);
  b.clear();
  hb.message(JSON.stringify({ t: "ev", e: "to", id: 1, d: { t: "world", d: 1 } }));
  ok("ev to: a world row from a guest does not", a.all("world").length === 0);

  a.clear(); b.clear();
  hb.message(JSON.stringify({ t: "ev", e: "wsave", world: { big: 1 } }));
  hb.message(JSON.stringify({ t: "ev", e: "cload" }));
  ok("the persistence verbs are dropped, not relayed into somebody's world", a.got.length === 0);
}

// ------------------------------------------------------- chat
{
  const relay = rooms.makeRelay({});
  const a = fakeConn("a"), b = fakeConn("b");
  const ha = joinRoom(relay, a, "Host");
  joinRoom(relay, b, "Guest");
  a.clear(); b.clear();
  ha.message(JSON.stringify({ t: "chat", text: "hello" }));
  eq("a line of chat reaches the room", [b.last("chat").name, b.last("chat").text], ["Host", "hello"]);
  ha.message(JSON.stringify({ t: "chat", text: "/me lights a cigarette" }));
  eq("/me is an emote", [b.last("chat").kind, b.last("chat").text], ["me", "lights a cigarette"]);
  a.clear();
  ha.message(JSON.stringify({ t: "chat", text: "/players" }));
  ok("/players is answered locally to the asker", /Host \(host\), Guest/.test(a.last("sys").text), a.last("sys").text);
}

// ------------------------------------------------------- backpressure
{
  const relay = rooms.makeRelay({});
  const a = fakeConn("a"), b = fakeConn("b");
  const ha = joinRoom(relay, a, "Host");
  joinRoom(relay, b, "Guest");
  b.clear();
  b.buf = rooms.BP_LIMIT + 1;
  ha.message(JSON.stringify({ t: "world", d: 1 }));
  ok("a backed-up guest is shed a world snapshot", b.all("world").length === 0);
  ha.message(JSON.stringify({ t: "ev", e: "wl", v: "wla" }));
  ok("...but never a reliable event", b.all("ev").length === 1);
  ok("the shed is counted", relay.dropped() === 1, String(relay.dropped()));
  b.buf = 0;
  ha.message(JSON.stringify({ t: "world", d: 2 }));
  eq("and it resumes the moment the queue drains", b.last("world").d, 2);
}

// ------------------------------------------------------- leaving, election, capacity
{
  const relay = rooms.makeRelay({ maxPlayers: 3 });
  const a = fakeConn("a"), b = fakeConn("b"), c = fakeConn("c"), d = fakeConn("d");
  const ha = joinRoom(relay, a, "One");
  const hb = joinRoom(relay, b, "Two");
  // joinedAt is a millisecond clock and three joins land inside one tick, so
  // the election is decided by insertion order — which is what "oldest in"
  // means when the clock cannot resolve it, and it is stable either way.
  joinRoom(relay, c, "Three");
  eq("the room is full at maxPlayers", relay.count(), 3);
  joinRoom(relay, d, "Four");
  eq("a fourth is denied, not silently dropped", d.last("deny").reason, "This room is full.");
  ok("...and hung up", d.closed);

  b.clear(); c.clear();
  ha.gone();
  eq("a departure is announced", b.last("leave").id, 1);
  eq("the sim host is re-elected to the oldest remaining", b.last("host").id, 2);
  eq("...and the room agrees", relay.hostId(), 2);
  hb.gone();
  eq("and again", c.last("host").id, 3);
}

// ------------------------------------------------------- reconnect dedupe
{
  const relay = rooms.makeRelay({});
  const a = fakeConn("a"), b = fakeConn("b"), a2 = fakeConn("a2");
  joinRoom(relay, a, "Dex", { pid: "p-dex" });
  joinRoom(relay, b, "Rook", { pid: "p-rook" });
  b.clear();
  joinRoom(relay, a2, "Dex", { pid: "p-dex" });
  ok("a reconnect with the same pid drops the ghost", a.closed);
  eq("...so the name is not suffixed by the corpse", relay.roster().map((p) => p.name).sort(), ["Dex", "Rook"]);
  eq("...and the room is not two of him", relay.count(), 2);
  eq("...and the dead host's seat is re-elected", relay.hostId(), 2);
}

// ------------------------------------------------------- the door
{
  const relay = rooms.makeRelay({});
  const a = fakeConn("a");
  const h = relay.join(a);
  h.message(JSON.stringify({ t: "state", x: 1 }));
  ok("anything before hello hangs the connection up", a.closed && relay.count() === 0);
}

if (fails.length) {
  console.log(`\nROOMS: ${pass} passed, ${fails.length} FAILED\n`);
  for (const f of fails) console.log("  ✗ " + f);
  process.exit(1);
}
console.log(`\nROOMS OK — ${pass} checks. The room protocol matches server/server.js's, in a tab.`);
