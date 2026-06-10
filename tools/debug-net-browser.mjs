#!/usr/bin/env node
// Interactive debug probe for the two-browser setup: captures console errors
// and inspects why remote avatars aren't appearing.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 18960;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Page {
  constructor(wsUrl, tag) {
    this.tag = tag;
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
        const txt = m.params.args.map((a) => a.value || a.description || "").join(" ");
        if (!/favicon|Audio|WebGL|GPU|GroupMarker/i.test(txt)) console.log(`[${tag} console.${m.params.type}]`, txt.slice(0, 300));
      } else if (m.method === "Runtime.exceptionThrown") {
        console.log(`[${tag} EXCEPTION]`, JSON.stringify(m.params.exceptionDetails).slice(0, 400));
      }
    };
    this.ready = new Promise((r) => { this.ws.onopen = r; });
  }
  cmd(method, params) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }
  async eval(expr, awaitP = false) {
    const r = await this.cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: awaitP });
    return r.result && r.result.result ? r.result.result.value : JSON.stringify(r.result).slice(0, 300);
  }
}

async function launchChrome(url, tag) {
  const port = 19300 + Math.floor(Math.random() * 600);
  const dir = `/tmp/cbz-dbg-${port}`;
  await rm(dir, { recursive: true, force: true });
  const proc = spawn(CHROME, ["--headless=new", "--enable-unsafe-swiftshader", "--mute-audio", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, url], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
    } catch (e) {}
  }
  const page = new Page(target.webSocketDebuggerUrl, tag);
  await page.ready;
  await page.cmd("Runtime.enable");
  return { proc, page, dir };
}

const JOIN = (name) => `
  (function(){
    window._stateRecv = 0; window._stateSent = 0;
    var os = CBZ.net.send; CBZ.net.send = function(o){ if (o && o.t === 'state') window._stateSent++; return os.call(CBZ.net, o); };
    CBZ.net.on('state', function(){ window._stateRecv++; });
    document.querySelector('.mode-btn[data-mode="city"]').click();
    CBZ.net.connect({ name: ${JSON.stringify(name)}, role: 'civ',
      onWelcome: function(){ try { CBZ.startRun(); window._joined=1; } catch(e){ window._joinErr=String(e); } },
      onError: function(r){ window._joinErr = r; } });
    return 1;
  })()`;

(async function () {
  const cfgPath = join(mkdtempSync(join(tmpdir(), "cbz-dbg-")), "server.json");
  writeFileSync(cfgPath, JSON.stringify({ name: "dbg", motd: "", password: "", maxPlayers: 8, port: PORT, roles: [{ id: "civ", label: "Civilian" }] }));
  const server = spawn(process.execPath, [join(ROOT, "server", "server.js")], { env: { ...process.env, CBZ_CONFIG: cfgPath, PORT: String(PORT) }, stdio: ["ignore", "inherit", "inherit"] });
  await sleep(800);
  const A = await launchChrome(`http://127.0.0.1:${PORT}/`, "A");
  await waitTrue(A.page, "!!(window.CBZ && CBZ.net && CBZ.startRun)");
  await A.page.eval(JOIN("Anna"));
  await waitTrue(A.page, "window._joined === 1");
  await waitTrue(A.page, "CBZ.game.state === 'playing'");
  const B = await launchChrome(`http://127.0.0.1:${PORT}/`, "B");
  await waitTrue(B.page, "!!(window.CBZ && CBZ.net && CBZ.startRun)");
  await B.page.eval(JOIN("Ben"));
  await waitTrue(B.page, "window._joined === 1");
  await waitTrue(B.page, "CBZ.game.state === 'playing'");
  await sleep(5000);
  console.log("A:", await A.page.eval("JSON.stringify({sent: window._stateSent, recv: window._stateRecv, active: CBZ.net.active, host: CBZ.net.isHost(), mode: CBZ.game.mode, state: CBZ.game.state, players: CBZ.net.players.size, remote2: !!CBZ.netRemoteActor(2), remote2grp: !!(CBZ.netRemoteActor(2)&&CBZ.netRemoteActor(2).group), arena: !!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.root)})"));
  console.log("B:", await B.page.eval("JSON.stringify({sent: window._stateSent, recv: window._stateRecv, active: CBZ.net.active, guest: CBZ.net.guest(), mode: CBZ.game.mode, state: CBZ.game.state, players: CBZ.net.players.size, remote1: !!CBZ.netRemoteActor(1), remote1grp: !!(CBZ.netRemoteActor(1)&&CBZ.netRemoteActor(1).group), pup: CBZ.netPuppetTargets([]).length})"));
  // poke the internals: why no rig?
  console.log("A remote detail:", await A.page.eval("(function(){var r=CBZ.netRemoteActor(2); if(!r) return 'no R'; return JSON.stringify({buf: r.buf.length, driving: r.driving, dead: r.dead});})()"));
  A.proc.kill(); B.proc.kill(); server.kill();
  process.exit(0);
})();

async function waitTrue(page, expr, timeout = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await page.eval(expr)) return; } catch (e) {}
    await sleep(300);
  }
  throw new Error("timeout: " + expr);
}
