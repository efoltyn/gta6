#!/usr/bin/env node
/* ============================================================
   tools/ipad-boot-check.mjs — does the game come up clean ON AN IPAD?

   tools/boot-health.mjs answers "does the script chain load" on a desktop
   viewport. This asks the three things that are only true on the device the
   owner actually plays on, and that were all broken or unverified before the
   App Store pass:

     1. THE SCRIPT CHAIN loads with no exception (same as boot-health, but with
        touch emulation on, because several files branch on it at load time).
     2. THE TOUCH LAYER TURNS ITSELF ON. systems/touch.js used to gate on
        `(pointer: coarse)` alone, which an iPad with a trackpad — and a
        WKWebView in desktop content mode — both answer "fine" to. So this
        emulates the HARD case: touch points present, primary pointer FINE.
        body.touch must still appear.
     3. NO SECOND MOUTH. systems/subtitlebus.js must be live and must actually
        refuse a duplicate line, which is the iPad "two layers of text" bug.

   It does NOT wait for the world build (a 25 km world does not finish inside a
   CDP window on a contended box — see boot-health.mjs's header for that whole
   story). Everything asked here is answerable at DOMContentLoaded + a beat.

       node tools/ipad-boot-check.mjs
============================================================ */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 9791, DBG = PORT + 1;
const CHROME = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium";

const log = (s) => { process.stdout.write(s + "\n"); };

const server = spawn("python3", [join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DBG}`, "--no-sandbox",
  "--disable-dev-shm-usage", "--enable-webgl", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--mute-audio", "--no-first-run",
  "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=1024,768", `--user-data-dir=/tmp/cbz-ipad-check-${PORT}`, "about:blank",
], { stdio: "ignore" });

let failed = 0;
function done(code, msg) {
  log(msg);
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}
process.on("exit", () => { try { chrome.kill("SIGKILL"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} });

async function waitPort(port, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await new Promise((res) => {
      const s = net.connect(port, "127.0.0.1");
      s.on("connect", () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

if (!await waitPort(PORT, 15000)) done(2, "FATAL: static server never came up");
if (!await waitPort(DBG, 20000)) done(2, "FATAL: chromium devtools never came up");

const targets = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) done(2, "FATAL: no page target");

// Minimal CDP over node's built-in WebSocket, so this tool has no npm
// dependency of its own — the same choice boot-health.mjs makes.
const ws = new (globalThis.WebSocket)(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
function send(method, params) {
  const id = ++msgId;
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { err: r.result.exceptionDetails.text };
  return { value: r.result && r.result.result ? r.result.result.value : undefined };
}

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");

/* THE HARD IPAD: touch points present, PRIMARY POINTER FINE.
   That is an iPad with a Magic Keyboard, and it is the configuration the old
   `(pointer: coarse)` gate got wrong. Emulation.setEmitTouchEventsForMouse +
   setTouchEmulationEnabled give maxTouchPoints without claiming a coarse
   primary pointer, which is exactly the trap. */
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setDeviceMetricsOverride", {
  width: 1024, height: 768, deviceScaleFactor: 2, mobile: true,
});

const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(d.text + " " + (d.exception && d.exception.description ? d.exception.description.split("\n")[0] : ""));
  }
});

log(`ipad-boot-check → http://127.0.0.1:${PORT}/index.html  (1024x768, 5 touch points)`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
await new Promise((r) => setTimeout(r, 12000));

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; log(`  FAIL ${name}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else log(`  ok   ${name}`);
}

// ---- 1. script chain -------------------------------------------------------
const chain = errors.filter((e) => /is not defined|is not a function|Cannot read|SyntaxError|Unexpected/.test(e));
check("script chain loads with no exception", chain.length ? chain.slice(0, 3) : 0, 0);

// ---- 2. the subsystems this pass added or fixed -----------------------------
check("CBZ.isTouchDevice exists", (await evaluate("typeof CBZ.isTouchDevice")).value, "function");
check("...and says yes on a 5-touch-point iPad", (await evaluate("CBZ.isTouchDevice()")).value, true);
check("subtitle desk is live", (await evaluate("typeof CBZ.subtitles && typeof CBZ.subtitles.claim")).value, "function");
check("prison friendship system is live", (await evaluate("typeof CBZ.prisonFriendOffered")).value, "function");

// ---- 3. the touch layer actually turned itself on ---------------------------
check("body.touch is stamped", (await evaluate("document.body.classList.contains('touch')")).value, true);
check("the joystick/button root was built", (await evaluate("!!document.getElementById('touch')")).value, true);

// ---- 4. no second mouth -----------------------------------------------------
{
  const r = await evaluate(`(function(){
    CBZ.subtitles.reset();
    var a = CBZ.subtitles.claim("citySpeech","speech","Yard is open now",3,"Marcus",function(){});
    var b = CBZ.subtitles.claim("hint","hint",'Marcus: "Yard is open now."',3,"",function(){});
    return [a,b];
  })()`);
  check("a duplicate line is refused the second surface", r.value, [true, false]);
}

// ---- 5. the font is local, not a CDN ---------------------------------------
check("no Google Fonts request in the document",
  (await evaluate("[].slice.call(document.querySelectorAll('link')).some(function(l){return /fonts\\.googleapis|fonts\\.gstatic/.test(l.href)})")).value, false);

done(failed ? 1 : 0, failed ? `\nIPAD-BOOT: ${failed} FAILED` : "\nIPAD-BOOT: ok");
