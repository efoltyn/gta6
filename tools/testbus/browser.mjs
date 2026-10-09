/* tools/testbus/browser.mjs — ONE warm headless Chrome, many game pages, and a
   static server whose root can be switched under a live page.

   Why a node server and not tools/devserver.py: a page's origin is its port.
   Keeping the port while switching the ROOT to the next integration tree lets
   a booted world pull the next batch's files (lazy scripts, hot-reloaded ones)
   without navigating away, and keeps its origin (and so nothing else) stable.

   Chrome: random debug port, its own profile under /tmp/cbz-testbus-*, swiftshader,
   background throttling OFF (each world is its own tab; a throttled tab would
   crawl). Every page gets a preload that makes rAF freezable: after a world
   is built the bus freezes it, so an idle warm world costs ~0 CPU and sim time
   advances only through CBZ.stepSim. */
import { spawn } from "node:child_process";
import http from "node:http";
import { createReadStream, statSync, rmSync } from "node:fs";
import path from "node:path";
import { sleep } from "./lib.mjs";

const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".wasm": "application/wasm",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain",
  ".bin": "application/octet-stream", ".ktx2": "image/ktx2", ".hdr": "application/octet-stream",
};

/* serve(root) -> { port, origin, root, setRoot(dir), close() } */
export async function serve(root) {
  const S = { root };
  const srv = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch (_) { res.writeHead(400); return res.end(); }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.join(S.root, rel);
    if (!file.startsWith(S.root)) { res.writeHead(403); return res.end(); }
    let st;
    try { st = statSync(file); if (st.isDirectory()) throw 0; } catch (_) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  });
  srv.keepAliveTimeout = 30000;
  for (let t = 0; t < 30; t++) {
    const port = 22000 + Math.floor(Math.random() * 8000);
    const ok = await new Promise((r) => { srv.once("error", () => r(false)); srv.listen(port, "127.0.0.1", () => r(true)); });
    if (ok) {
      return { port, origin: `http://127.0.0.1:${port}/`, get root() { return S.root; },
        setRoot(d) { S.root = d; }, close() { try { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } catch (_) {} } };
    }
  }
  throw new Error("testbus: no free port for the static server");
}

const PRELOAD = `(() => {
  try { performance.setResourceTimingBufferSize(5000); } catch (e) {}
  const nativeRAF = window.requestAnimationFrame.bind(window);
  let frozen = false, stash = null;
  window.requestAnimationFrame = function (cb) { if (frozen) { stash = cb; return 0; } return nativeRAF(cb); };
  window.__tbFreeze = function () { frozen = true; return true; };
  window.__tbThaw = function () { frozen = false; if (stash) { const s = stash; stash = null; nativeRAF(s); } return true; };
  window.__tbFrozen = function () { return frozen; };
})();`;

/* launchChrome() -> { dbg, pid, newPage(), close() } */
export async function launchChrome() {
  const t0 = Date.now();
  let dbg = 0;
  for (let t = 0; t < 30 && !dbg; t++) {
    const p = 30000 + Math.floor(Math.random() * 9000);
    try { await fetch(`http://127.0.0.1:${p}/json/version`); } catch (_) { dbg = p; }
  }
  const profile = `/tmp/cbz-testbus-${dbg}-${process.pid}`;
  try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--mute-audio", "--window-size=900,600", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore", detached: true });
  let up = false;
  for (let i = 0; i < 300 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${dbg}/json/version`)).ok; } catch (_) {}
    if (!up) await sleep(100);
  }
  if (!up) { try { process.kill(-proc.pid); } catch (_) {} throw new Error("testbus: Chrome never answered on :" + dbg); }
  const B = {
    dbg, pid: proc.pid, profile, startMs: Date.now() - t0,
    alive() { try { process.kill(proc.pid, 0); return true; } catch (_) { return false; } },
    async newPage() {
      const r = await fetch(`http://127.0.0.1:${dbg}/json/new?about:blank`, { method: "PUT" });
      const target = await r.json();
      const pg = await connect(target.webSocketDebuggerUrl);
      pg.targetId = target.id;
      pg.closeTarget = async () => { try { pg.ws.close(); } catch (_) {} try { await fetch(`http://127.0.0.1:${dbg}/json/close/${target.id}`); } catch (_) {} };
      await pg.send("Runtime.enable"); await pg.send("Page.enable"); await pg.send("Log.enable");
      await pg.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELOAD });
      return pg;
    },
    async close() {
      try { process.kill(-proc.pid); } catch (_) { try { proc.kill(); } catch (_) {} }
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    },
  };
  return B;
}

/* connect(wsUrl) -> a page handle: send, evl(expr, ms), errors, closed */
export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pend = new Map();
  const P = { ws, errors: [], closed: false };
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("close", () => { P.closed = true; for (const [, r] of pend) r({ __closed: true }); pend.clear(); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      P.errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${((d.exception && d.exception.description) || d.text || "").split("\n")[0]}`.slice(0, 300));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      P.errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 300));
    }
  });
  P.send = (method, params = {}, ms = 0) => new Promise((r) => {
    if (P.closed) return r({ __closed: true });
    const i = id++; let t = null;
    pend.set(i, (m) => { if (t) clearTimeout(t); r(m); });
    if (ms > 0) t = setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({ __timeout: true }); } }, ms);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  /* evl(expr, ms): evaluate an expression, await a promise if it is one,
     return the JSON value. Throws on a page exception, a timeout or a dead page. */
  P.evl = async (expression, ms = 10 * 60e3) => {
    const r = await P.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, ms);
    if (r.__closed) throw new Error("page went away");
    if (r.__timeout) throw Object.assign(new Error(`evaluate timed out after ${Math.round(ms / 1000)} s`), { timeout: true });
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || "eval threw");
    }
    return r.result && r.result.result && r.result.result.value;
  };
  return P;
}
