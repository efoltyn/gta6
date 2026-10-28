#!/usr/bin/env node
/* tools/president-net-check.mjs — two presidents, one world, over a real relay.

   Starts server/server.js on a free port (the same relay protocol a room
   runs in a host's tab), opens games/president.html (the lobby) twice in
   one headless Chrome (two tabs), hosts a room in the first, joins it from
   the second, seats the guest in another country and begins. Then checks
   that both pages head into the real Mansion (index.html?slice=estate) in
   the same room, two different countries, one seed, the host marked as the
   one who runs the clock. (The world's lockstep itself is
   tools/president-sim-check.mjs LOCKSTEP; the game page's side of the room
   is city/president_game.js joinRoom.)

   node tools/president-net-check.mjs
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { spawn } from "node:child_process";
import path from "node:path";

const PORT = 18000 + Math.floor(Math.random() * 1500);
const relay = spawn("node", [path.join(ROOT, "server/server.js")], { env: { ...process.env, PORT: String(PORT), CBZ_NO_HEARTBEAT: "1" }, stdio: "ignore", detached: true });
let fails = 0;
const check = (name, ok, d) => { console.log((ok ? "  PASS " : "  FAIL ") + name + (d ? "  (" + d + ")" : "")); if (!ok) fails++; };

const rig = await launch({ rafBudget: 0 });
// a second tab, with its own CDP socket
async function tab() {
  const r = await rig.send("Target.createTarget", { url: "about:blank" });
  const id = r.result.targetId;
  let ws = null;
  for (let i = 0; i < 50 && !ws; i++) {
    const ps = await (await fetch(`http://127.0.0.1:${rig.dbg}/json/list`)).json();
    const p = ps.find((q) => q.id === id);
    if (p) ws = p.webSocketDebuggerUrl; else await sleep(100);
  }
  const sock = new WebSocket(ws);
  await new Promise((res) => sock.addEventListener("open", res, { once: true }));
  let n = 1; const pend = new Map(); const errors = [];
  sock.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((res) => { const i = n++; pend.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const evl = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
  const wait = async (expr, ms = 60000) => { const until = Date.now() + ms; while (Date.now() < until) { try { if (await evl(`(()=>{try{return !!(${expr})}catch(e){return false}})()`)) return true; } catch (e) {} await sleep(200); } return false; };
  return { send, evl, wait, errors, close: () => sock.close() };
}
try {
  await sleep(600);
  const q = `relay=ws://127.0.0.1:${PORT}/ws`;
  const A = { evl: rig.evl, wait: rig.wait, send: rig.send };
  await rig.open("games/president.html", q);
  await A.wait("window.CBZ && CBZ.presWorld && document.getElementById('clist').children.length > 0", 30000);
  const B = await tab();
  await B.send("Page.navigate", { url: rig.origin + "games/president.html?" + q });
  await B.wait("window.CBZ && CBZ.presWorld && document.getElementById('clist').children.length > 0", 30000);
  // host a room; the guest joins it
  await A.evl("document.getElementById('host').click()");
  check("the host opens a room", await A.wait("document.getElementById('lobby').hidden === false", 20000));
  await B.evl("document.getElementById('jcode').value = 'ABCD'; document.getElementById('join').click()");
  check("the guest joins", await B.wait("document.getElementById('lobby').hidden === false && document.getElementById('seats').children.length >= 2", 20000));
  // the guest takes a different country
  await B.evl(`(() => { const rows = document.querySelectorAll('.crow'); for (const r of rows) if (!r.classList.contains('on') && !r.classList.contains('taken')) { r.click(); return; } })()`);
  await sleep(1500);
  // BEGIN: every president's page opens the real game, in the same room, on the host's clock
  for (const T of [A, B]) await T.evl("CBZ.presGo = function (u) { window.__went = u; }; true");
  await A.evl("document.getElementById('begin').click()");
  const ok = await A.wait("!!window.__went", 20000) && await B.wait("!!window.__went", 20000);
  check("both pages head into office", ok);
  const ua = new URL(await A.evl("window.__went"), rig.origin + "games/"), ub = new URL(await B.evl("window.__went"), rig.origin + "games/");
  check("into the real Mansion", /index\.html$/.test(ua.pathname) && ua.searchParams.get("slice") === "estate" && ub.searchParams.get("slice") === "estate", ua.pathname + "?" + ua.searchParams);
  check("the same room, the host runs the clock", ua.searchParams.get("room") && ua.searchParams.get("room") === ub.searchParams.get("room") && ua.searchParams.get("host") === "1" && !ub.searchParams.get("host"));
  check("two different countries", ua.searchParams.get("president") && ua.searchParams.get("president") !== ub.searchParams.get("president"), ua.searchParams.get("president") + " / " + ub.searchParams.get("president"));
  check("one world (same seed)", ua.searchParams.get("pseed") === ub.searchParams.get("pseed"));
  console.log("errors: host", rig.errors.length ? rig.errors.slice(0, 5).join(" | ") : "none", "· guest", B.errors.length ? B.errors.slice(0, 5).join(" | ") : "none");
  B.close();
} catch (e) { console.error("FAILED:", e.message); fails++; }
finally {
  await rig.close();
  try { process.kill(-relay.pid); } catch (e) { try { relay.kill(); } catch (_) {} }
}
console.log((fails ? "FAIL" : "PASS") + " president-net-check");
process.exit(fails ? 1 : 0);
