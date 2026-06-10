#!/usr/bin/env node
// Cell Block Z — multiplayer game server. Zero dependencies.
//
//   node server/server.js            -> hosts the game + relay on :8000
//
// One process does everything a small RP server needs:
//   - serves the game files (so your server URL IS the join link)
//   - WebSocket relay at /ws (player state, world snapshots, events, chat)
//   - sim-host election: first player in becomes the world simulator;
//     if they leave, the next-oldest player is promoted automatically
//   - server identity from server/server.json (name, motd, password, rules)
//   - /api/info for server browsers / directory listings
//
// Share it beyond your LAN with a quick tunnel (one command, free):
//   cloudflared tunnel --url http://localhost:8000
// then send the printed https link to your players.
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const wsmini = require("./wsmini");

const ROOT = path.dirname(__dirname); // repo root
const CFG_PATH = process.env.CBZ_CONFIG || path.join(__dirname, "server.json");

const DEFAULT_CFG = {
  name: "Cell Block Z RP",
  motd: "Welcome. Stay in character. /help for commands.",
  tags: ["rp", "casual"],
  password: "",
  adminPass: "",
  maxPlayers: 16,
  port: 8000,
  // RP roles players pick at the door — edit freely (DarkRP-style data, not code)
  roles: [
    { id: "civ", label: "Civilian" },
    { id: "police", label: "Police" },
    { id: "ems", label: "Paramedic" },
    { id: "taxi", label: "Taxi Driver" },
    { id: "crook", label: "Crook" },
  ],
  // Optional: URL of a directory server to announce to (see server/directory.js)
  directory: "",
  // Optional: the public URL players use to reach this server (for directory listings)
  publicUrl: "",
};

function loadConfig() {
  let cfg = { ...DEFAULT_CFG };
  try {
    cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CFG_PATH, "utf8")) };
  } catch (e) {
    fs.writeFileSync(CFG_PATH, JSON.stringify(DEFAULT_CFG, null, 2) + "\n");
    console.log(`[server] wrote default config -> ${CFG_PATH} (edit it, then restart)`);
  }
  const envPort = Number(process.env.PORT);
  if (envPort) cfg.port = envPort;
  return cfg;
}

const cfg = loadConfig();

// ---------------------------------------------------------------- static ---
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
  ".wav": "audio/wav", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (e) {
    res.writeHead(400); res.end("bad url"); return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  // never serve server config (it holds passwords)
  if (file.startsWith(path.join(ROOT, "server") + path.sep) && file.endsWith(".json")) {
    res.writeHead(403); res.end(); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-store, must-revalidate",
    });
    res.end(data);
  });
}

// ------------------------------------------------------------------ room ---
let nextId = 1;
const players = new Map(); // id -> {id, name, conn, admin, joinedAt}
let hostId = null;

const sanitizeName = (n) =>
  String(n || "").replace(/[^\w \-'.]/g, "").trim().slice(0, 20) || "Stranger";

function info() {
  return {
    game: "cell-block-z",
    name: cfg.name,
    motd: cfg.motd,
    tags: cfg.tags,
    roles: cfg.roles,
    players: players.size,
    maxPlayers: cfg.maxPlayers,
    passworded: !!cfg.password,
    version: 1,
  };
}

function send(p, msg) { p.conn.send(JSON.stringify(msg)); }

function broadcast(msg, exceptId) {
  const str = JSON.stringify(msg);
  for (const p of players.values()) if (p.id !== exceptId) p.conn.send(str);
}

function pickHost() {
  let oldest = null;
  for (const p of players.values()) if (!oldest || p.joinedAt < oldest.joinedAt) oldest = p;
  return oldest ? oldest.id : null;
}

function setHost(id) {
  if (hostId === id) return;
  hostId = id;
  if (id != null) {
    const h = players.get(id);
    console.log(`[server] sim host -> #${id} ${h ? h.name : "?"}`);
    broadcast({ t: "host", id });
  }
}

function onLeave(p, reason) {
  if (!players.has(p.id)) return;
  players.delete(p.id);
  console.log(`[server] leave #${p.id} ${p.name}${reason ? " (" + reason + ")" : ""} (${players.size} online)`);
  broadcast({ t: "leave", id: p.id });
  if (hostId === p.id) setHost(pickHost());
}

// --------------------------------------------------------------- commands ---
function handleChat(p, text) {
  text = String(text || "").slice(0, 300).trim();
  if (!text) return;
  if (text[0] === "/") return handleCommand(p, text);
  broadcast({ t: "chat", id: p.id, name: p.name, kind: "say", text });
}

function handleCommand(p, text) {
  const [cmd, ...rest] = text.slice(1).split(" ");
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "me": // emote: "* Dex lights a cigarette"
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "me", text: arg });
      break;
    case "do": // scene description: "** The door is locked (Dex)"
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "do", text: arg });
      break;
    case "ooc": // out of character
      if (arg) broadcast({ t: "chat", id: p.id, name: p.name, kind: "ooc", text: arg });
      break;
    case "help":
      send(p, { t: "sys", text: "/me <action>, /do <scene>, /ooc <text>, /players" + (p.admin ? ", /kick <name>, /announce <text>" : cfg.adminPass ? ", /admin <pass>" : "") });
      break;
    case "players": {
      const list = [...players.values()].map((q) => q.name + (q.id === hostId ? " (host)" : "")).join(", ");
      send(p, { t: "sys", text: `${players.size}/${cfg.maxPlayers}: ${list}` });
      break;
    }
    case "admin":
      if (cfg.adminPass && arg === cfg.adminPass) {
        p.admin = true;
        send(p, { t: "sys", text: "You are now an admin." });
      } else send(p, { t: "sys", text: "Nope." });
      break;
    case "kick": {
      if (!p.admin) return send(p, { t: "sys", text: "Admins only." });
      const target = [...players.values()].find((q) => q.name.toLowerCase() === arg.toLowerCase());
      if (!target) return send(p, { t: "sys", text: `No player named "${arg}".` });
      if (target.id === p.id) return send(p, { t: "sys", text: "That's you." });
      send(target, { t: "deny", reason: "Kicked by admin." });
      target.conn.close();
      onLeave(target, "kicked");
      break;
    }
    case "announce":
      if (!p.admin) return send(p, { t: "sys", text: "Admins only." });
      if (arg) broadcast({ t: "sys", text: `[SERVER] ${arg}` });
      break;
    default:
      send(p, { t: "sys", text: `Unknown command /${cmd}. Try /help.` });
  }
}

// --------------------------------------------------------------- protocol ---
function onConnection(conn, req) {
  let p = null; // set after hello
  let saidHello = false;

  conn.onmessage = (str) => {
    let m;
    try { m = JSON.parse(str); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;

    if (!saidHello) {
      if (m.t !== "hello") { conn.close(); return; }
      saidHello = true;
      if (cfg.password && m.pass !== cfg.password) {
        conn.send(JSON.stringify({ t: "deny", reason: "Wrong password." }));
        conn.close();
        return;
      }
      if (players.size >= cfg.maxPlayers) {
        conn.send(JSON.stringify({ t: "deny", reason: "Server is full." }));
        conn.close();
        return;
      }
      let name = sanitizeName(m.name);
      while ([...players.values()].some((q) => q.name === name)) name += "_";
      const role = (cfg.roles || []).some((r) => r.id === m.role) ? m.role : ((cfg.roles && cfg.roles[0] && cfg.roles[0].id) || "civ");
      p = { id: nextId++, name, role, conn, admin: false, joinedAt: Date.now() };
      players.set(p.id, p);
      // first player in becomes the world simulator; tell everyone about them
      if (hostId == null) hostId = p.id;
      send(p, {
        t: "welcome",
        id: p.id,
        hostId,
        server: { name: cfg.name, motd: cfg.motd, tags: cfg.tags, maxPlayers: cfg.maxPlayers },
        players: [...players.values()].filter((q) => q.id !== p.id).map((q) => ({ id: q.id, name: q.name, role: q.role })),
      });
      // the host is an admin on their own server
      if (p.id === hostId) p.admin = true;
      broadcast({ t: "join", id: p.id, name: p.name, role: p.role }, p.id);
      console.log(`[server] join #${p.id} ${p.name} (${players.size} online)`);
      return;
    }
    if (!p) return;

    switch (m.t) {
      case "state": // own avatar state, high-frequency -> relay to everyone else
        m.id = p.id;
        broadcast(m, p.id);
        break;
      case "world": // NPC/world snapshot -> only the sim host may publish
        if (p.id === hostId) broadcast(m, p.id);
        break;
      case "ev": // reliable game events (shots, damage, enter/exit vehicle...)
        m.id = p.id;
        if (m.to != null) {
          const target = players.get(m.to);
          if (target) send(target, m);
        } else broadcast(m, p.id);
        break;
      case "chat":
        handleChat(p, m.text);
        break;
    }
  };

  conn.onclose = () => { if (p) onLeave(p); };
}

// ------------------------------------------------------------------- boot ---
const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  if (urlPath === "/api/info") {
    const body = JSON.stringify(info());
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(body);
    return;
  }
  serveStatic(req, res);
});

wsmini.attach(server, "/ws", onConnection);

// keep connections honest
setInterval(() => { for (const p of players.values()) p.conn.ping(); }, 20000);

// optional directory announce
if (cfg.directory) {
  const announce = () => {
    const body = JSON.stringify({ ...info(), url: cfg.publicUrl || "" });
    try {
      const u = new URL("/announce", cfg.directory);
      const mod = u.protocol === "https:" ? require("https") : require("http");
      const req2 = mod.request(u, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } });
      req2.on("error", () => {});
      req2.end(body);
    } catch (e) { /* bad directory URL; ignore */ }
  };
  setInterval(announce, 60000);
  announce();
}

server.listen(cfg.port, () => {
  console.log("");
  console.log(`  ${cfg.name}`);
  console.log(`  ─ play/join link:  http://localhost:${cfg.port}`);
  console.log(`  ─ websocket:       ws://localhost:${cfg.port}/ws`);
  console.log(`  ─ server info:     http://localhost:${cfg.port}/api/info`);
  console.log(`  ─ config:          server/server.json  (name, motd, password, maxPlayers)`);
  console.log("");
  console.log(`  To let friends join over the internet:`);
  console.log(`    cloudflared tunnel --url http://localhost:${cfg.port}`);
  console.log(`  ...then share the https link it prints. That link is your server.`);
  console.log("");
});
