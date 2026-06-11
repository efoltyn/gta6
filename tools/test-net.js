#!/usr/bin/env node
// Protocol test for the multiplayer server (server/server.js).
// Boots the real server on a scratch port with a scratch config, connects
// real WebSocket clients (Node's built-in client), and walks the whole
// protocol: join/welcome, host election, state/world relay + gating,
// targeted events, chat + RP commands, admin kick, password, host migration.
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 18000 + Math.floor(Math.random() * 1000);
const ROOT = path.dirname(__dirname);

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log("  ✓ " + label + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  ✗ FAIL " + label + (detail ? " — " + detail : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mkConfig(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbz-net-"));
  const cfg = Object.assign({
    name: "Test RP City", motd: "test motd", tags: ["test"],
    password: "", adminPass: "letmein", maxPlayers: 8, port: PORT,
    roles: [{ id: "civ", label: "Civilian" }, { id: "police", label: "Police" }],
    world: { name: "Test World", dir: path.join(dir, "worlds"), autosaveSec: 60 },
  }, extra || {});
  const p = path.join(dir, "server.json");
  fs.writeFileSync(p, JSON.stringify(cfg));
  return p;
}

function startServer(cfgPath) {
  const proc = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    env: { ...process.env, CBZ_CONFIG: cfgPath, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => process.stderr.write("[server-err] " + d));
  return new Promise((resolve) => {
    proc.stdout.on("data", (d) => { if (String(d).includes("join link")) resolve(proc); });
    setTimeout(() => resolve(proc), 1500);
  });
}

class Client {
  constructor(name, opts) {
    this.name = name;
    this.msgs = [];
    this.closed = false;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(e.data));
    this.ws.onclose = () => { this.closed = true; };
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ t: "hello", name, role: (opts && opts.role) || "civ", pass: (opts && opts.pass) || "", v: 1, pid: (opts && opts.pid) || undefined }));
        res();
      };
      this.ws.onerror = (e) => rej(e);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async expect(fn, label, timeout = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const m = this.msgs.find(fn);
      if (m) return m;
      await sleep(25);
    }
    return null;
  }
  count(fn) { return this.msgs.filter(fn).length; }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async function main() {
  console.log("== multiplayer server protocol test (port " + PORT + ") ==");
  const cfgPath = mkConfig();
  const worldFile = path.join(path.dirname(cfgPath), "worlds", "Test-World.json");
  const server = await startServer(cfgPath);

  // /api/info
  const info = await fetch(`http://127.0.0.1:${PORT}/api/info`).then((r) => r.json());
  ok(info.game === "cell-block-z" && info.name === "Test RP City", "/api/info identity", JSON.stringify({ name: info.name, players: info.players }));
  ok(Array.isArray(info.roles) && info.roles.length === 2, "/api/info exposes RP roles", info.roles.map((r) => r.id).join(","));
  ok(Array.isArray(info.feat) && info.feat.includes("to") && info.feat.includes("persist") && info.world && info.world.name === "Test World" && info.world.autosaveSec === 60, "/api/info advertises feat + world", JSON.stringify(info.world));
  // static serving (the join link IS the game)
  const html = await fetch(`http://127.0.0.1:${PORT}/index.html`).then((r) => r.text());
  ok(html.includes("src/net/net.js"), "serves the game w/ net scripts");
  const blocked = await fetch(`http://127.0.0.1:${PORT}/server/server.json`).then((r) => r.status);
  ok(blocked === 403, "server config is NOT downloadable", "status " + blocked);

  // A joins -> becomes host
  const A = new Client("Alice", { role: "police", pid: "pid-A" });
  await A.ready;
  const wA = await A.expect((m) => m.t === "welcome");
  ok(wA && wA.id === 1 && wA.hostId === 1, "first joiner is elected sim host", JSON.stringify({ id: wA && wA.id, hostId: wA && wA.hostId }));
  ok(wA && wA.server && wA.server.motd === "test motd", "welcome carries server identity");
  ok(wA && Array.isArray(wA.feat) && wA.feat.includes("to") && wA.feat.includes("persist"), "welcome advertises feat flags", JSON.stringify(wA && wA.feat));
  ok(wA && wA.world && wA.world.name === "Test World" && wA.world.savedAt === null && wA.world.autosaveSec === 60, "welcome carries world identity (unsaved)", JSON.stringify(wA && wA.world));

  // B joins
  const B = new Client("Bob");
  await B.ready;
  const wB = await B.expect((m) => m.t === "welcome");
  ok(wB && wB.hostId === 1 && wB.players.length === 1 && wB.players[0].name === "Alice" && wB.players[0].role === "police", "welcome lists existing players w/ roles", JSON.stringify(wB && wB.players));
  const joinA = await A.expect((m) => m.t === "join" && m.name === "Bob");
  ok(!!joinA, "host notified of new player");

  // state relay
  A.send({ t: "state", p: [1, 0, 2], h: 0.5, hp: 200 });
  const stB = await B.expect((m) => m.t === "state" && m.id === 1);
  ok(stB && stB.p[0] === 1, "avatar state relays host->guest");
  B.send({ t: "state", p: [9, 0, 9], h: 1, hp: 180 });
  const stA = await A.expect((m) => m.t === "state" && m.id === 2);
  ok(stA && stA.p[0] === 9, "avatar state relays guest->host");

  // world gating: only the host's snapshots pass
  B.send({ t: "world", pd: [[1, 0, 0, 0, 0, 0, 1]] });
  await sleep(250);
  ok(A.count((m) => m.t === "world") === 0, "guest world snapshots are DROPPED");
  A.send({ t: "world", pd: [[5, 1, 2, 0, 0, 0, 100]], w: 2 });
  const wld = await B.expect((m) => m.t === "world");
  ok(wld && wld.pd[0][0] === 5 && wld.w === 2, "host world snapshot reaches guests");

  // targeted events
  const C = new Client("Cara");
  await C.ready;
  await C.expect((m) => m.t === "welcome");
  B.send({ t: "ev", e: "hit", to: 1, nid: 7, dmg: 25 });
  const evA = await A.expect((m) => m.t === "ev" && m.e === "hit");
  ok(evA && evA.id === 2 && evA.nid === 7, "targeted ev reaches only its target", JSON.stringify(evA));
  await sleep(200);
  ok(C.count((m) => m.t === "ev" && m.e === "hit") === 0, "targeted ev NOT broadcast to others");
  A.send({ t: "ev", e: "shot", o: [0, 1, 0], d: [1, 1, 1], w: "ak47" });
  const shotB = await B.expect((m) => m.t === "ev" && m.e === "shot");
  const shotC = await C.expect((m) => m.t === "ev" && m.e === "shot");
  ok(!!shotB && !!shotC, "broadcast ev reaches everyone else");

  // "to" relay: payload delivered to one client only, stamped as the sender
  B.send({ t: "ev", e: "to", id: 1, d: { t: "ev", e: "rag", p: [1, 2, 3], d: [0, 0, 1], imp: 9 } });
  const ragA = await A.expect((m) => m.t === "ev" && m.e === "rag" && m.imp === 9);
  ok(ragA && ragA.id === 2 && ragA.p[2] === 3, '"to" relay delivers payload to its target w/ sender id', JSON.stringify(ragA));
  await sleep(200);
  ok(C.count((m) => m.t === "ev" && m.e === "rag") === 0, '"to" relay NOT delivered to others');
  B.send({ t: "ev", e: "to", id: 99, d: { t: "ev", e: "rag", imp: 1 } });
  await sleep(150);
  ok(!B.closed, 'unknown "to" target dropped silently');

  // world persistence: wsave is host-only, lands on disk atomically
  B.send({ t: "ev", e: "wsave", world: { turf: { docks: "bogus" } } });
  await sleep(300);
  ok(!fs.existsSync(worldFile), "guest wsave ignored (no world file)");
  A.send({ t: "ev", e: "wsave", world: { turf: { docks: "kings" }, day: 0.4 } });
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) { await sleep(100); try { saved = JSON.parse(fs.readFileSync(worldFile, "utf8")); } catch (e) {} }
  ok(saved && saved.v === 1 && saved.name === "Test World" && saved.world && saved.world.turf.docks === "kings", "host wsave lands on disk", worldFile);
  ok(saved && typeof saved.savedAt === "number", "world file stamps savedAt");

  // character save/load keyed by pid (cload arrives right after join)
  A.send({ t: "ev", e: "csave", char: { name: "Alice", money: 1234, level: 7 } });
  B.send({ t: "ev", e: "csave", char: { money: 9 } }); // no pid in B's hello -> skipped
  await sleep(150);
  const A2 = new Client("Alice", { pid: "pid-A" });
  await A2.ready;
  const cl = await A2.expect((m) => m.t === "ev" && m.e === "cload");
  ok(cl && cl.char && cl.char.money === 1234 && cl.char.level === 7, "csave/cload roundtrip keyed by pid", JSON.stringify(cl && cl.char));
  A2.close();
  await A.expect((m) => m.t === "leave" && m.id === 4);

  // chat + RP commands
  B.send({ t: "chat", text: "hello city" });
  const sayA = await A.expect((m) => m.t === "chat" && m.kind === "say" && m.text === "hello city");
  ok(sayA && sayA.name === "Bob", "plain chat broadcasts with name");
  B.send({ t: "chat", text: "/me lights a cigarette" });
  const meA = await A.expect((m) => m.t === "chat" && m.kind === "me");
  ok(meA && meA.text === "lights a cigarette", "/me emote");
  B.send({ t: "chat", text: "/do The door is locked" });
  const doC = await C.expect((m) => m.t === "chat" && m.kind === "do");
  ok(!!doC, "/do scene description");
  B.send({ t: "chat", text: "/players" });
  const pl = await B.expect((m) => m.t === "sys" && /3\/8/.test(m.text));
  ok(!!pl, "/players lists the room", pl && pl.text);

  // admin: host can kick; non-admin cannot
  C.send({ t: "chat", text: "/kick Bob" });
  const noAuth = await C.expect((m) => m.t === "sys" && /Admins only/.test(m.text));
  ok(!!noAuth, "non-admin /kick refused");
  C.send({ t: "chat", text: "/admin letmein" });
  const adm = await C.expect((m) => m.t === "sys" && /now an admin/.test(m.text));
  ok(!!adm, "/admin password grants admin");
  A.send({ t: "chat", text: "/kick Bob" });
  const denyB = await B.expect((m) => m.t === "deny");
  ok(denyB && /Kicked/.test(denyB.reason), "host kicks a player (deny+close)");
  const leaveB = await A.expect((m) => m.t === "leave" && m.id === 2);
  ok(!!leaveB, "kick broadcasts leave");

  // host migration: host leaves -> oldest remaining promoted
  A.close();
  const hostMsg = await C.expect((m) => m.t === "host" && m.id === 3);
  ok(!!hostMsg, "host migration elects next player", JSON.stringify(hostMsg));

  C.close();
  server.kill();
  await sleep(300);

  // shutdown flushed the debounced char save to disk
  let saved2 = null;
  try { saved2 = JSON.parse(fs.readFileSync(worldFile, "utf8")); } catch (e) {}
  ok(saved2 && saved2.chars && saved2.chars["pid-A"] && saved2.chars["pid-A"].money === 1234 && Object.keys(saved2.chars).length === 1, "shutdown flush writes chars keyed by pid (pid-less csave skipped)", saved2 && JSON.stringify(Object.keys(saved2.chars)));

  // reboot the SAME world: first host gets wload, chars follow their pid
  const server3 = await startServer(cfgPath);
  const G = new Client("Gwen", { pid: "pid-A" });
  await G.ready;
  const wG = await G.expect((m) => m.t === "welcome");
  ok(wG && wG.world && typeof wG.world.savedAt === "number", "welcome shows the saved world", JSON.stringify(wG && wG.world));
  const wl = await G.expect((m) => m.t === "ev" && m.e === "wload");
  ok(wl && wl.world && wl.world.turf.docks === "kings" && wl.world.day === 0.4, "first host after boot gets wload");
  const cl2 = await G.expect((m) => m.t === "ev" && m.e === "cload");
  ok(cl2 && cl2.char && cl2.char.money === 1234, "character follows its pid across reboots");
  const H = new Client("Hank");
  await H.ready;
  await H.expect((m) => m.t === "welcome");
  G.close();
  await H.expect((m) => m.t === "host" && m.id === 2);
  await sleep(200);
  ok(H.count((m) => m.t === "ev" && m.e === "wload") === 0, "host migration does NOT replay wload");
  H.close();
  server3.kill();
  await sleep(200);

  // password gate (fresh server, passworded)
  const cfg2 = mkConfig({ password: "secret" });
  const server2 = await startServer(cfg2);
  const D = new Client("Dana", { pass: "wrong" });
  await D.ready;
  const denyD = await D.expect((m) => m.t === "deny");
  ok(denyD && /password/i.test(denyD.reason), "wrong password denied");
  const E = new Client("Evan", { pass: "secret" });
  await E.ready;
  const wE = await E.expect((m) => m.t === "welcome");
  ok(!!wE, "correct password admitted");
  E.close();
  server2.kill();

  console.log(fail === 0 ? `RESULT: OK (${pass} checks)` : `RESULT: ${fail} FAILED / ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
