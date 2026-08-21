/* tools/lib/cdp.mjs — the boot boilerplate, once.

   Every browser tool in tools/ re-typed the same sixty lines: claim a port,
   spawn the devserver, spawn headless Chromium, poll /json/list, open the CDP
   socket, wrap Runtime.evaluate. tools/probe.mjs did it best and kept it
   private. This is that code, exported, so a new tool is its ORACLE and
   nothing else.

     const rig = await launch();                  // server + chromium + socket
     await rig.open("games/disaster.html");       // navigate, wait for load
     const v = await rig.evl("CBZ.game.mode");    // evaluate in the page
     rig.errors                                   // every uncaught throw so far
     await rig.close();

   Nothing here knows what a disaster is. Keep it that way. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

async function claimPort(lo, span, probeFn) {
  for (let t = 0; t < 24; t++) {
    const p = lo + Math.floor(Math.random() * span);
    try { await probeFn(p); } catch (_) { return p; }
  }
  throw new Error("no free port near " + lo);
}

function socket(wsUrl, sink) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pend = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      sink.errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ` +
        `${((d.exception && d.exception.description) || d.text || "").split("\n")[0]}`.slice(0, 300));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      sink.errors.push("console.error: " + m.params.args
        .map((a) => a.value || a.description || "").join(" ").slice(0, 300));
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      const e = m.params.entry;
      // A 404 for a script we deliberately dropped is the single most useful
      // signal the minimizer has; keep the URL, drop the rest of the noise.
      sink.netErrors.push(`${e.source} ${(e.url || "").split("/").pop()} ${e.text}`.slice(0, 200));
    }
  });
  const send = (method, params = {}) => new Promise((r) => {
    const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, ready, send };
}

/* launch({ rafBudget, preload, quiet }) — a served repo and a live page.
   rafBudget caps requestAnimationFrame so SwiftShader cannot spend minutes
   redrawing while a test waits; pass 0 for uncapped (visual work). */
export async function launch(opts = {}) {
  const port = await claimPort(9200, 400, (p) => fetch(`http://127.0.0.1:${p}/`));
  const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
    { env: { ...process.env, PORT: String(port) }, stdio: "ignore", detached: true });
  const origin = `http://127.0.0.1:${port}/`;
  for (let i = 0, up = false; i < 100 && !up; i++) {
    try { await fetch(origin); up = true; } catch (_) { await sleep(100); }
  }
  const dbg = await claimPort(12000, 400, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
  const profile = `/tmp/cbz-cdp-${dbg}-${process.pid}`;
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--mute-audio", "--window-size=900,600", `--remote-debugging-port=${dbg}`,
    `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });

  let page = null;
  for (let i = 0; i < 400 && !page; i++) {
    try {
      const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      page = ps.find((p) => p.type === "page");
    } catch (_) {}
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("chromium never opened a page");

  const sink = { errors: [], netErrors: [] };
  const s = socket(page.webSocketDebuggerUrl, sink);
  await s.ready;
  await s.send("Runtime.enable");
  await s.send("Page.enable");
  await s.send("Log.enable");

  // The resource-timing buffer defaults to 250 entries, and this game makes
  // 550+ requests — every payload number a tool read off it was silently
  // truncated at 250. Raise it before one byte of page script runs.
  await s.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try{performance.setResourceTimingBufferSize(5000)}catch(e){}",
  });

  const budget = opts.rafBudget == null ? 900 : opts.rafBudget;
  if (budget > 0) {
    await s.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { const n = window.requestAnimationFrame.bind(window); let left = ${budget};
        window.requestAnimationFrame = (cb) => (left-- > 0 ? n(cb) : 0);
        window.__stopRaf = () => { left = 0; }; })();`,
    });
  }
  if (opts.preload) {
    const p = path.isAbsolute(opts.preload) ? opts.preload : path.join(ROOT, opts.preload);
    await s.send("Page.addScriptToEvaluateOnNewDocument", {
      source: existsSync(p) ? readFileSync(p, "utf8") : opts.preload,
    });
  }

  const rig = {
    origin, port, dbg, page,
    get errors() { return sink.errors; },
    get netErrors() { return sink.netErrors; },
    clearErrors() { sink.errors.length = 0; sink.netErrors.length = 0; },
    send: s.send,
    async evl(expression, awaitPromise) {
      const r = await s.send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: !!awaitPromise,
      });
      if (r.result && r.result.exceptionDetails) {
        const d = r.result.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text || "eval threw");
      }
      return r.result && r.result.result && r.result.result.value;
    },
    /* wait(expr, ms) — poll a boolean expression; returns whether it went true.
       Never throws on a page that is mid-load and has no CBZ yet. */
    async wait(expr, ms = 60000, every = 150) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        try { if (await rig.evl(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; }
        catch (_) {}
        await sleep(every);
      }
      return false;
    },
    async open(rel, query) {
      const url = origin + rel.replace(/^\//, "") + (query ? (rel.includes("?") ? "&" : "?") + query : "");
      await s.send("Page.navigate", { url });
      return url;
    },
    async close() {
      try { s.ws.close(); } catch (_) {}
      try { process.kill(-chrome.pid); } catch (_) { try { chrome.kill(); } catch (_) {} }
      try { process.kill(-server.pid); } catch (_) { try { server.kill(); } catch (_) {} }
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
  return rig;
}
