#!/usr/bin/env node
/* tools/casino-check.mjs — closed-loop gate for games/casino.html (THE GOLDEN ACE).
   1. boot headless, ?boot=1&nolock=1 — ZERO console errors tolerated (fresh page, no baseline)
   2. pure math: wheel constants, roulette payouts, slot RTP by full enumeration,
      blackjack hand values + settle table
   3. floating-geometry: every non-dynamic mesh AABB must chain to the ground
   4. rigged full rounds THROUGH THE REAL UI ENGINES: natural 3:2, double, split,
      straight-up roulette hit, outside-bet spin, slot jackpot + two-cherry
   5. economy + arc: cage round-trip, shark marker, LOSE / LEAVE / WIN endings
   6. screenshots of every authored pose + live action shots -> tools/shots/casino-*.png */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTDIR = ROOT + "/tools/shots";
await mkdir(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8990 + Math.floor(Math.random() * 9);
const dbg = 9990 + Math.floor(Math.random() * 9);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/games/casino.html?boot=1&nolock=1`;
const profile = `/tmp/cbz-casino-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chromePath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium";
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

const failures = [];
let ws = null;
try {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.includes("casino.html")); } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) { console.error("no page"); process.exit(1); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener("open", res, { once: true }));
  let id = 1; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(m.params.entry.text.split("\n")[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.result && r.result.exceptionDetails) failures.push("evl-throw: " + (r.result.exceptionDetails.text || e.slice(0, 60))); return r.result && r.result.result && r.result.result.value; };
  const shot = async (f) => { const s = await send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(OUTDIR, f), Buffer.from(s.result.data, "base64")); console.log("shot:", f); };
  const check = (name, cond, detail) => { const ok = !!cond; console.log((ok ? "ok" : "FAIL") + ": " + name + (detail != null ? " — " + detail : "")); if (!ok) failures.push(name + (detail != null ? " (" + detail + ")" : "")); };
  await send("Runtime.enable"); await send("Page.enable"); await send("Log.enable");

  const bootWait = async () => {
    for (let i = 0; i < 60; i++) { if (await evl("!!(window.__casino && __casino.state().mode === 'walk')")) return true; await sleep(400); }
    return false;
  };
  check("boot", await bootWait());
  await sleep(1200); // let a second of frames render

  /* ---- 2. PURE MATH ---- */
  const wheel = await evl("JSON.stringify(__casino.rl.wheel)");
  const W = JSON.parse(wheel || "[]");
  check("wheel-37", W.length === 37);
  check("wheel-sum-666", W.reduce((a, b) => a + b, 0) === 666);
  check("wheel-unique", new Set(W).size === 37);
  const redCount = await evl("Object.keys(__casino.rl.red).length");
  check("red-18", redCount === 18);
  const pay = await evl(`JSON.stringify([
    __casino.rl.payout({n17:25}, 17), __casino.rl.payout({n17:25}, 18),
    __casino.rl.payout({red:10}, 32), __casino.rl.payout({red:10}, 33),
    __casino.rl.payout({black:10}, 33), __casino.rl.payout({even:10}, 8), __casino.rl.payout({odd:10}, 9),
    __casino.rl.payout({low:10}, 18), __casino.rl.payout({high:10}, 19),
    __casino.rl.payout({dz1:10}, 12), __casino.rl.payout({dz2:10}, 13), __casino.rl.payout({dz3:10}, 25),
    __casino.rl.payout({col1:10}, 34), __casino.rl.payout({col2:10}, 35), __casino.rl.payout({col3:10}, 36),
    __casino.rl.payout({red:10,odd:10,n0:10}, 0),
    __casino.rl.payout({red:25,odd:25,n17:25}, 17)])`);
  const P = JSON.parse(pay || "[]");
  const expect = [900, 0, 20, 0, 20, 20, 20, 20, 20, 30, 30, 30, 30, 30, 30, 360, 25 * 36 + 50]; // 17 is BLACK: red loses, odd pays
  check("rl-payout-table", JSON.stringify(P) === JSON.stringify(expect), JSON.stringify(P));
  const rtp = await evl("__casino.sl.rtp()");
  check("slot-rtp", rtp > 0.87 && rtp < 0.94, (rtp * 100).toFixed(2) + "%");
  const bj = await evl(`JSON.stringify([
    __casino.bj.value([{r:'A',s:0},{r:'6',s:0}]).v, __casino.bj.value([{r:'A',s:0},{r:'6',s:0}]).soft?1:0,
    __casino.bj.value([{r:'A',s:0},{r:'6',s:0},{r:'10',s:0}]).v,
    __casino.bj.value([{r:'A',s:0},{r:'A',s:1}]).v,
    __casino.bj.value([{r:'K',s:0},{r:'Q',s:1},{r:'2',s:2}]).v,
    __casino.bj.settle([{r:'A',s:0},{r:'K',s:0}], [{r:'9',s:0},{r:'8',s:0}], 100, true),
    __casino.bj.settle([{r:'A',s:0},{r:'K',s:0}], [{r:'A',s:1},{r:'Q',s:1}], 100, true),
    __casino.bj.settle([{r:'7',s:0},{r:'7',s:1},{r:'7',s:2}], [{r:'A',s:1},{r:'Q',s:1}], 100, false),
    __casino.bj.settle([{r:'K',s:0},{r:'9',s:0}], [{r:'10',s:0},{r:'6',s:0},{r:'K',s:1}], 100, true),
    __casino.bj.settle([{r:'K',s:0},{r:'9',s:0}], [{r:'10',s:0},{r:'9',s:1}], 100, true),
    __casino.bj.settle([{r:'K',s:0},{r:'5',s:0},{r:'9',s:1}], [{r:'10',s:0},{r:'8',s:1}], 100, true)])`);
  const B = JSON.parse(bj || "[]");
  check("bj-values+settle", JSON.stringify(B) === JSON.stringify([17, 1, 17, 12, 22, 250, 100, 0, 200, 100, 0]), JSON.stringify(B));

  /* ---- 3. FLOATING GEOMETRY (union-find on AABB contact, flood from ground) ---- */
  const floatRes = await evl(`(() => {
    const boxes = __casino.props();
    const EPS = 0.09, n = boxes.length;
    const touch = (a, b) =>
      a[0] - EPS < b[3] && a[3] + EPS > b[0] &&
      a[1] - EPS < b[4] && a[4] + EPS > b[1] &&
      a[2] - EPS < b[5] && a[5] + EPS > b[2];
    const grounded = boxes.map((b) => b[1] <= 0.5);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (grounded[i]) continue;
        for (let j = 0; j < n; j++) {
          if (i === j || !grounded[j]) continue;
          if (touch(boxes[i], boxes[j])) { grounded[i] = true; changed = true; break; }
        }
      }
    }
    const floating = [];
    for (let i = 0; i < n; i++) if (!grounded[i]) floating.push(boxes[i].map((v) => +v.toFixed(2)));
    return JSON.stringify({ total: n, floating: floating.length, sample: floating.slice(0, 6) });
  })()`);
  const F = JSON.parse(floatRes || "{}");
  check("float-check", F.floating === 0, F.total + " boxes, " + F.floating + " floating " + JSON.stringify(F.sample || []));

  /* ---- 6a. STATIC POSE SCREENSHOTS ---- */
  for (const pose of ["marquee", "floor", "blackjack", "roulette", "slots", "bar", "cage", "booth"]) {
    check("aim-" + pose, await evl(`__casino.aim('${pose}')`));
    await sleep(420);
    await shot(`casino-${pose}.png`);
  }
  await evl("__casino.aim(null)");

  /* ---- 4. RIGGED ROUNDS THROUGH THE REAL ENGINES ---- */
  await evl("__casino.give({cash: 500, chips: 1000, debt: 0})");
  // natural 3:2 — stacked deal order: P1 A♠, D1 Q♦, P2 K♥, D2 7♣
  check("sit-bj0", await evl("__casino.sit('bj0')"));
  await evl("__casino.bj.stack([{r:'A',s:0},{r:'Q',s:2},{r:'K',s:1},{r:'7',s:3}]); __casino.bj.setStake(100); __casino.bj.deal(); true");
  await sleep(3600);
  let chips = await evl("__casino.state().chips");
  check("bj-natural-3:2", chips === 1150, "chips=" + chips);
  await sleep(300); await shot("casino-action-blackjack.png");
  // double 11 vs 19: P 6♠ D 10♦ P 5♥ D 9♣, double card K♠ -> 21 beats 19 (+200)
  await evl("__casino.bj.stack([{r:'6',s:0},{r:'10',s:2},{r:'5',s:1},{r:'9',s:3},{r:'K',s:0}]); __casino.bj.setStake(100); __casino.bj.deal(); true");
  await sleep(1500);
  await evl("__casino.bj.dbl(); true");
  await sleep(3400);
  chips = await evl("__casino.state().chips");
  check("bj-double", chips === 1350, "chips=" + chips);
  // split 8s vs 17: P 8♠ D 10♦ P 8♥ D 7♣, splits draw 3♦ and 4♣, stand both -> both lose (-200)
  await evl("__casino.bj.stack([{r:'8',s:0},{r:'10',s:2},{r:'8',s:1},{r:'7',s:3},{r:'3',s:2},{r:'4',s:3}]); __casino.bj.setStake(100); __casino.bj.deal(); true");
  await sleep(1500);
  await evl("__casino.bj.split(); true");
  await sleep(1400);
  await evl("__casino.bj.stand(); true");
  await sleep(300);
  await evl("__casino.bj.stand(); true");
  await sleep(3600);
  chips = await evl("__casino.state().chips");
  check("bj-split-flow", chips === 1150, "chips=" + chips);
  await evl("__casino.stand()");

  // roulette: straight-up 17 hit (+875), then outside spread on 0 (all lose).
  // sim time crawls headless -> advance the animation pipeline with __casino.ff().
  check("sit-rl", await evl("__casino.sit('roulette')"));
  await evl(`__casino.rig([${17.5 / 37}]); __casino.rl.setUnit(25); __casino.rl.place('n17'); __casino.rl.spin(); __casino.ff(2.2)`);
  await shot("casino-action-roulette.png");
  await evl("__casino.ff(5.5)"); await sleep(300);
  chips = await evl("__casino.state().chips");
  check("rl-straight-hit", chips === 1150 + 875, "chips=" + chips);
  const hist0 = await evl("__casino.rl.hist()[0]");
  check("rl-hist-17", hist0 === 17);
  check("rl-not-spinning", (await evl("__casino.state().rlSpinning")) === false);
  await evl(`__casino.rig([${0.5 / 37}]); __casino.rl.place('red'); __casino.rl.place('odd'); __casino.rl.place('dz3'); __casino.rl.spin(); __casino.ff(8)`);
  await sleep(300);
  chips = await evl("__casino.state().chips");
  check("rl-zero-kills-outside", chips === 2025 - 75, "chips=" + chips);
  await evl("__casino.stand()");

  // slots: jackpot (3x DIA at strip index 20), then two-cherry (idx 0, 4 -> CHR CHR + LEM idx 1)
  check("sit-slot0", await evl("__casino.sit('slot0')"));
  await evl(`__casino.sl.setBet(5); __casino.rig([${20.5 / 22}, ${20.5 / 22}, ${20.5 / 22}]); __casino.sl.pull(); __casino.ff(1.4)`);
  await shot("casino-action-slots.png");
  await evl("__casino.ff(2.5)"); await sleep(200);
  let last = await evl("JSON.stringify(__casino.sl.last())");
  check("slot-jackpot-500x", last === JSON.stringify({ syms: ["DIA", "DIA", "DIA"], win: 2500 }), last);
  await evl(`__casino.rig([${0.5 / 22}, ${4.5 / 22}, ${1.5 / 22}]); __casino.sl.pull(); __casino.ff(4)`);
  await sleep(200);
  last = await evl("JSON.stringify(__casino.sl.last())");
  check("slot-two-cherry-2x", last === JSON.stringify({ syms: ["CHR", "CHR", "LEM"], win: 10 }), last);
  await evl("__casino.stand()");

  /* ---- 5. ECONOMY + ARC ---- */
  await evl("__casino.give({cash: 500, chips: 0, debt: 0})");
  await evl("__casino.cage.buy(250)");
  let st = JSON.parse(await evl("JSON.stringify(__casino.state())"));
  check("cage-buy", st.cash === 250 && st.chips === 250, st.cash + "/" + st.chips);
  await evl("__casino.give({chips: 500}); __casino.cage.out()");
  st = JSON.parse(await evl("JSON.stringify(__casino.state())"));
  check("cage-out", st.cash === 750 && st.chips === 0, st.cash + "/" + st.chips);
  await evl("__casino.give({cash: 100, chips: 500, debt: 450}); __casino.cage.out()");
  st = JSON.parse(await evl("JSON.stringify(__casino.state())"));
  check("cage-pays-shark-first", st.debt === 0 && st.cash === 150, "debt=" + st.debt + " cash=" + st.cash);

  // LOSE: at the door owing the shark with nothing
  await evl("__casino.give({cash: 0, chips: 0, debt: 450}); __casino.warp(0,-11.6,0); __casino.leave()");
  await sleep(1800);
  let endT = await evl("document.getElementById('endTitle').textContent");
  check("arc-lose", (await evl("__casino.state().mode")) === "end" && endT === "BUSTED OUT", endT);
  await shot("casino-end-lose.png");

  // LEAVE: fresh page, modest cash
  const renav = async () => {
    await send("Page.navigate", { url: base });
    await sleep(1000);
    check("reboot", await bootWait());
    await sleep(600);
  };
  await renav();
  await evl("__casino.give({cash: 800, chips: 0, debt: 0}); __casino.leave()");
  await sleep(400);
  endT = await evl("document.getElementById('endTitle').textContent");
  check("arc-leave", endT === "CALLED IT A NIGHT", endT);

  // WIN: fresh page, goal met
  await renav();
  await evl("__casino.give({cash: 5200, chips: 0, debt: 0}); __casino.leave()");
  await sleep(2300);
  endT = await evl("document.getElementById('endTitle').textContent");
  check("arc-win", endT === "HOUSE MONEY", endT);
  await shot("casino-end-win.png");

  /* ---- console errors: ZERO tolerated on this page ---- */
  check("console-errors", errors.length === 0, errors.slice(0, 4).join(" | ") || "none");
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  try { server.kill(); } catch (_) {}
}
if (failures.length) { console.error("\nCASINO CHECK FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
console.log("\ncasino-check: ALL GREEN");
