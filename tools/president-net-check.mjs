#!/usr/bin/env node
/* tools/president-net-check.mjs — two presidents, one world, over a real relay.

   Starts server/server.js on a free port (the same relay protocol a room
   runs in a host's tab), opens games/president.html twice in one headless
   Chrome (two tabs), hosts a room in the first, joins it from the second,
   seats the guest in another country and begins. Then checks:
     both tabs start            the guest is handed the host's world
     the clock runs on both     the guest steps only on the host's ticks
     a guest's order lands      a tariff tapped in the guest tab appears in
                                the host's world, made by the guest's country
     lockstep                   at the same day both worlds hash the same

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
  const q = `relay=ws://127.0.0.1:${PORT}/ws&seed=4242&countries=8`;
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
  await A.evl("document.getElementById('begin').click()");
  check("both tabs take office", await A.wait("document.body.classList.contains('playing')", 60000) && await B.wait("document.body.classList.contains('playing')", 60000));
  const seats = await A.evl("JSON.stringify([CBZ.presGame.me(), CBZ.presGame.state().c.filter(c => c.human != null).map(c => c.id)])");
  const bme = await B.evl("CBZ.presGame.me()");
  check("two different presidents", JSON.parse(seats)[0] !== bme && JSON.parse(seats)[1].length === 2, "host " + JSON.parse(seats)[0] + ", guest " + bme + ", humans " + JSON.parse(seats)[1]);
  // run the clock fast on the host
  await A.send("Target.activateTarget", { targetId: rig.page.id }).catch(() => {});
  await A.evl("CBZ.presGame.speed(4)");
  check("the guest's world moves with the host's clock", await B.wait("CBZ.presGame.state().day > 40", 90000), "guest day " + await B.evl("CBZ.presGame.state().day"));
  // the guest gives an order
  const tgt = await B.evl("CBZ.presGame.state().c.find(c => c.alive && c.id !== CBZ.presGame.me()).id");
  await B.evl(`CBZ.presGame.submit({ type: "tariff", t: ${tgt}, good: "all", v: 0.25 })`);
  check("the guest's tariff lands in the host's world", await A.wait(`CBZ.presGame.state().log.some(e => e.k === "tariff" && e.c === ${bme} && e.t === ${tgt})`, 30000));
  check("...and comes back to the guest", await B.wait(`CBZ.presGame.state().log.some(e => e.k === "tariff" && e.c === ${bme} && e.t === ${tgt})`, 30000));
  // lockstep: pause, let the guest catch up, compare
  await A.evl("CBZ.presGame.speed(0)");
  await sleep(2500);
  const ha = JSON.parse(await A.evl("JSON.stringify([CBZ.presGame.state().day, CBZ.presWorld.checksum(CBZ.presGame.state())])"));
  await B.wait(`CBZ.presGame.state().day === ${ha[0]}`, 20000);
  const hb = JSON.parse(await B.evl("JSON.stringify([CBZ.presGame.state().day, CBZ.presWorld.checksum(CBZ.presGame.state())])"));
  check("same day, same world", ha[0] === hb[0] && ha[1] === hb[1], "day " + ha[0] + " " + ha[1].toString(16) + " vs day " + hb[0] + " " + hb[1].toString(16));
  console.log("errors: host", rig.errors.length ? rig.errors.slice(0, 5).join(" | ") : "none", "· guest", B.errors.length ? B.errors.slice(0, 5).join(" | ") : "none");
  B.close();
} catch (e) { console.error("FAILED:", e.message); fails++; }
finally {
  await rig.close();
  try { process.kill(-relay.pid); } catch (e) { try { relay.kill(); } catch (_) {} }
}
console.log((fails ? "FAIL" : "PASS") + " president-net-check");
process.exit(fails ? 1 : 0);
