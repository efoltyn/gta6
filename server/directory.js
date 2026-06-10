#!/usr/bin/env node
// Optional public server directory ("server browser" backend). Zero deps.
//
//   node server/directory.js          -> listens on :8800
//
// Game servers with `directory` set in server/server.json POST here every
// minute; entries expire after 3 missed heartbeats. Browsers/clients GET
// /servers for a JSON list. Point any number of game servers at one of these
// and you have a community server list.
"use strict";

const http = require("http");

const PORT = Number(process.env.PORT) || 8800;
const TTL = 3 * 60 * 1000;
const servers = new Map(); // key -> {info, seen}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "POST" && urlPath === "/announce") {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      try {
        const m = JSON.parse(body);
        if (m.game !== "cell-block-z" || typeof m.name !== "string") throw new Error("bad");
        const key = (m.url || req.socket.remoteAddress) + "|" + m.name.slice(0, 60);
        servers.set(key, {
          seen: Date.now(),
          info: {
            name: String(m.name).slice(0, 60),
            motd: String(m.motd || "").slice(0, 200),
            tags: Array.isArray(m.tags) ? m.tags.slice(0, 6).map((t) => String(t).slice(0, 20)) : [],
            players: Number(m.players) || 0,
            maxPlayers: Number(m.maxPlayers) || 0,
            passworded: !!m.passworded,
            url: String(m.url || "").slice(0, 200),
          },
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end('{"ok":false}');
      }
    });
    return;
  }

  if (urlPath === "/servers" || urlPath === "/") {
    const now = Date.now();
    for (const [k, v] of servers) if (now - v.seen > TTL) servers.delete(k);
    const list = [...servers.values()]
      .map((v) => v.info)
      .sort((a, b) => b.players - a.players);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ servers: list }));
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => console.log(`[directory] listening on :${PORT}  (POST /announce, GET /servers)`));
