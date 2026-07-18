#!/usr/bin/env node
/* tools/ocean-check.mjs — end-to-end gate for games/ocean.html (DEAD WATER).
   Gates, in order:
     0. boot: page loads with ?boot=1, sim frames advance, world generated
     1. rig funnel: rigged values come out of the one nextRand() funnel
     2. oxygen math: drain scales with depth, surface refills, tank upgrade
        raises the cap (measurable)
     3. chain logic (all via __ocean.simChain — the headless ecology tick):
        - shark aggression escalates with blood, escalation reaches strikes
        - dolphins measurably REDUCE shark strikes (A/B compare) and repel
        - orcas kill great whites on-screen (orcaKills > 0, shark count drops)
     4. economy: crate payout math (night ×2 at grab time), sell at dock,
        engine/hull upgrades measurably change maxSpeed/hullMax
     5. float check: every static prop supported (dock posts to seafloor,
        kiosk on dock), floats (boat, buoys) sit IN the waterline, not above
     6. seven aim() poses — each self-verifies its subject is in frame
        (NDC projection) before the screenshot; shots → tools/shots/ocean-*.png
   ANY page console error fails. Non-zero exit on any failure. */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTDIR = ROOT + "/tools/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8960 + Math.floor(Math.random() * 10);
const dbg = 9960 + Math.floor(Math.random() * 10);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const pageURL = base + "games/ocean.html?boot=1";
const profile = `/tmp/cbz-ocean-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chromePath = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium";
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, pageURL,
], { stdio: "ignore" });

const failures = [];
const errors = [];
let ws = null;
try {
  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no page attached");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res) => ws.addEventListener("open", res, { once: true }));
  let id = 1; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]);
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evl = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      const d = (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text;
      failures.push("evl threw: " + String(d).split("\n")[0]);
      return null;
    }
    return r.result && r.result.result && r.result.result.value;
  };
  const shot = async (f) => { const s = await send("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(OUTDIR, f), Buffer.from(s.result.data, "base64")); console.log("shot:", f); };
  const check = (name, cond, detail) => {
    console.log((cond ? "ok   " : "FAIL ") + name + (detail ? "  — " + detail : ""));
    if (!cond) failures.push(name + (detail ? ": " + detail : ""));
  };
  await send("Runtime.enable"); await send("Page.enable");

  // ---- gate 0: boot ---------------------------------------------------------
  let booted = false;
  for (let i = 0; i < 90 && !booted; i++) { booted = await evl("!!(window.__ocean && __ocean.ready)"); if (!booted) await sleep(500); }
  check("boot: __ocean.ready", booted);
  if (!booted) throw new Error("game never became ready");
  const st0 = await evl("__ocean.state()");
  check("boot: mode is boat (boot=1 skipped title)", st0 && st0.mode === "boat", st0 && st0.mode);
  check("boot: world has 5 wrecks", st0 && st0.wrecks.length === 5);
  check("boot: gold wreck exists over trench", st0 && st0.wrecks.some((w) => w.gold));
  check("boot: playBtn exists in DOM", await evl("!!document.getElementById('playBtn')"));
  const f0 = st0.frame; await sleep(1500);
  const f1 = (await evl("__ocean.state()")).frame;
  check("boot: render frames advance", f1 > f0, `${f0} -> ${f1}`);
  console.log(`boot: drawCalls=${st0.calls} tris=${st0.tris}`);
  check("perf: draw calls sane (<400)", st0.calls > 10 && st0.calls < 400, String(st0.calls));

  // pause the background rAF sim: from here every scenario drives time itself
  await evl("__ocean.pause(true)");

  // ---- gate 1: the nextRand funnel + rig ------------------------------------
  const rigR = await evl("(() => { __ocean.rig([0.111, 0.222]); return [__ocean.drawRand(), __ocean.drawRand()]; })()");
  check("rig: queued values come out of the funnel", rigR && rigR[0] === 0.111 && rigR[1] === 0.222, JSON.stringify(rigR));

  // ---- gate 2: oxygen math --------------------------------------------------
  const o2r = await evl("[__ocean.o2Rate(0), __ocean.o2Rate(20), __ocean.o2Rate(60)]");
  check("o2: drain rate rises with depth", o2r && o2r[0] < o2r[1] && o2r[1] < o2r[2], JSON.stringify(o2r));
  const oxy = await evl(`(() => {
    __ocean.clearCreatures(); __ocean.setTod(0.5); __ocean.heal();
    __ocean.warp(300, 300, 0); __ocean.anchor(true); __ocean.dive();
    __ocean.diveTo(300, -20, 300);
    const before = __ocean.state().diver.o2;
    const r = __ocean.simChain(10);
    const after = __ocean.state().diver.o2;
    __ocean.diveTo(300, -0.2, 300);
    const r2 = __ocean.simChain(8);
    const refilled = __ocean.state().diver.o2;
    __ocean.board();
    return { before, after, refilled, cap: __ocean.state().o2cap, rate: __ocean.o2Rate(20) };
  })()`);
  if (oxy) {
    const expected = 10 * oxy.rate;
    const drained = oxy.before - oxy.after;
    check("o2: 10s at 20m drains ~10*rate", Math.abs(drained - expected) < expected * 0.35, `drained=${drained.toFixed(1)} expected~${expected.toFixed(1)}`);
    check("o2: surfacing refills toward cap", oxy.refilled > oxy.after && oxy.refilled >= oxy.cap * 0.9, `after=${oxy.after} refilled=${oxy.refilled} cap=${oxy.cap}`);
  } else check("o2: scenario ran", false);
  const tank = await evl(`(() => {
    const cap0 = __ocean.state().o2cap;
    __ocean.grant(5000);
    const ok = __ocean.buyUpgrade('tank');
    return { ok, cap0, cap1: __ocean.state().o2cap };
  })()`);
  check("o2: tank upgrade raises cap (measurable)", tank && tank.ok && tank.cap1 > tank.cap0, tank && `${tank.cap0} -> ${tank.cap1}`);

  // ---- gate 3a: blood escalates shark aggression ----------------------------
  const aggr = await evl(`(() => {
    __ocean.clearCreatures(); __ocean.setTod(0.5); __ocean.heal();
    __ocean.warp(500, 500, 0); __ocean.anchor(true); __ocean.dive();
    __ocean.diveTo(500, -0.4, 500);
    __ocean.spawnShark(545, 500);
    __ocean.simChain(6);
    const a1 = __ocean.state().creatures.find(c => c.kind === 'shark').aggr;
    __ocean.setBlood(500, 500, 4);
    __ocean.simChain(6);
    const a2 = __ocean.state().creatures.find(c => c.kind === 'shark').aggr;
    const r = __ocean.simChain(50);
    const st = __ocean.state().creatures.find(c => c.kind === 'shark');
    __ocean.heal();
    return { a1, a2, strikes: r.events.sharkStrikes, endState: st ? st.state : 'gone', aggrMax: r.aggrMax };
  })()`);
  if (aggr) {
    check("chain: blood raises shark aggression", aggr.a2 > aggr.a1 + 0.1, `a1=${aggr.a1} a2=${aggr.a2}`);
    check("chain: escalation reaches STRIKES (bloody water)", aggr.strikes >= 1, `strikes=${aggr.strikes} endState=${aggr.endState} aggrMax=${aggr.aggrMax}`);
  } else check("chain: aggression scenario ran", false);

  // ---- gate 3b: dolphins measurably suppress shark attacks ------------------
  const scenA = await evl(`(() => {
    __ocean.clearCreatures(); __ocean.setTod(0.5); __ocean.heal();
    __ocean.warp(600, -400, 0); __ocean.anchor(true); __ocean.dive();
    __ocean.diveTo(600, -0.4, -400);
    __ocean.setBlood(600, -400, 4);
    __ocean.spawnShark(640, -400); __ocean.spawnShark(560, -410);
    const r = __ocean.simChain(50);
    __ocean.heal();
    return { strikes: r.events.sharkStrikes, repels: r.events.dolphinRepels };
  })()`);
  const scenB = await evl(`(() => {
    __ocean.clearCreatures(); __ocean.setTod(0.5); __ocean.heal();
    __ocean.warp(600, -400, 0); __ocean.anchor(true); __ocean.dive();
    __ocean.diveTo(600, -0.4, -400);
    __ocean.setBlood(600, -400, 4);
    __ocean.spawnShark(640, -400); __ocean.spawnShark(560, -410);
    __ocean.spawnDolphins(610, -395);
    const r = __ocean.simChain(50);
    __ocean.heal(); __ocean.board();
    return { strikes: r.events.sharkStrikes, repels: r.events.dolphinRepels };
  })()`);
  if (scenA && scenB) {
    check("chain: sharks strike a bleeding diver (baseline)", scenA.strikes >= 1, `strikesA=${scenA.strikes}`);
    check("chain: dolphins REPEL sharks (repels>0)", scenB.repels >= 1, `repels=${scenB.repels}`);
    check("chain: dolphin escort REDUCES strikes", scenB.strikes < scenA.strikes, `A=${scenA.strikes} B=${scenB.strikes}`);
  } else check("chain: dolphin A/B ran", false);

  // ---- gate 3c: orcas hunt and kill great whites ----------------------------
  const orca = await evl(`(() => {
    __ocean.clearCreatures(); __ocean.setTod(0.5); __ocean.heal();
    __ocean.warp(-500, 500, 0);
    __ocean.spawnShark(-470, 500); __ocean.spawnShark(-530, 520);
    __ocean.spawnOrcas(-420, 480);
    const r = __ocean.simChain(70);
    return { kills: r.events.orcaKills, sharksAlive: r.sharksAlive, spouts: r.events.orcaSpouts };
  })()`);
  if (orca) {
    check("chain: orcas KILL great whites in simChain", orca.kills >= 1, `kills=${orca.kills}`);
    check("chain: shark population actually drops", orca.sharksAlive <= 1, `alive=${orca.sharksAlive}`);
  } else check("chain: orca scenario ran", false);

  // ---- gate 4: economy ------------------------------------------------------
  const econ = await evl(`(() => {
    __ocean.clearCreatures();
    const s0 = __ocean.state();
    __ocean.setTod(0.5);                       // DAY
    const g1 = __ocean.testGrab(0, 0);         // day crate: value ×1
    const heldDay = __ocean.state().cargoValue;
    __ocean.setTod(0.05);                      // NIGHT
    const g2 = __ocean.testGrab(0, 1);         // night crate: value ×2
    const heldBoth = __ocean.state().cargoValue;
    __ocean.setTod(0.5);
    const st = __ocean.state();
    __ocean.warp(0, 40, 0);                    // dock end
    const cashBefore = __ocean.state().cash;
    const sold = __ocean.sellAll();
    const cashAfter = __ocean.state().cash;
    return { g1, g2, heldDay, heldBoth, cashBefore, sold, cashAfter,
             cargoAfter: __ocean.state().cargoValue, atDock: st.atDock };
  })()`);
  if (econ && econ.g1 && econ.g2) {
    check("econ: day grab pays face value", econ.heldDay === econ.g1.value, `held=${econ.heldDay} value=${econ.g1.value}`);
    check("econ: night grab pays DOUBLE", econ.heldBoth === econ.g1.value + econ.g2.value * 2, `held=${econ.heldBoth} expect=${econ.g1.value + econ.g2.value * 2}`);
    check("econ: sell at dock credits exactly the hold", econ.cashAfter === econ.cashBefore + econ.heldBoth && econ.cargoAfter === 0, `cash ${econ.cashBefore} -> ${econ.cashAfter} (sold=${econ.sold})`);
  } else check("econ: payout scenario ran", false);
  const ups = await evl(`(() => {
    __ocean.grant(10000);
    const s0 = __ocean.state();
    const okE = __ocean.buyUpgrade('engine');
    const okH = __ocean.buyUpgrade('hull');
    const s1 = __ocean.state();
    return { okE, okH, ms0: s0.maxSpeed, ms1: s1.maxSpeed, h0: s0.hullMax, h1: s1.hullMax };
  })()`);
  check("econ: engine upgrade raises maxSpeed", ups && ups.okE && ups.ms1 > ups.ms0, ups && `${ups.ms0} -> ${ups.ms1}`);
  check("econ: hull upgrade raises hullMax", ups && ups.okH && ups.h1 > ups.h0, ups && `${ups.h0} -> ${ups.h1}`);

  // ---- gate 5: float check on props -----------------------------------------
  const props = await evl("__ocean.props()");
  if (Array.isArray(props) && props.length) {
    const stat = props.filter((p) => p.kind === "static");
    const floats = props.filter((p) => p.kind === "float");
    // support chain, demolition-check style: grounded OR resting on another box
    const supported = stat.map((p) => p.min[1] <= p.ground + 0.7);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < stat.length; i++) {
        if (supported[i]) continue;
        const a = stat[i];
        for (let j = 0; j < stat.length; j++) {
          if (i === j || !supported[j]) continue;
          const b = stat[j];
          const xz = a.min[0] < b.max[0] - 0.02 && a.max[0] > b.min[0] + 0.02 && a.min[2] < b.max[2] - 0.02 && a.max[2] > b.min[2] + 0.02;
          if (xz && b.max[1] >= a.min[1] - 0.15 && b.min[1] <= a.min[1] + 0.5) { supported[i] = true; changed = true; break; }
        }
      }
    }
    const floating = stat.filter((_, i) => !supported[i]).map((p) => p.name);
    check("float: no static prop floats (support chain)", floating.length === 0, floating.join(",") || `${stat.length} statics ok`);
    for (const f of floats) {
      const inWater = f.min[1] <= f.water + 0.25 && f.max[1] > f.water - 4;
      check(`float: ${f.name} sits IN the waterline`, inWater, `min.y=${f.min[1].toFixed(2)} water=${f.water}`);
    }
  } else check("float: props() returned data", false);

  // ---- gate 6: the seven staged shots (self-verifying) ----------------------
  const poses = ["boat-dusk", "shark-circling", "dolphin-jump", "orca-hunt", "meg-reveal", "dock", "baitball"];
  for (let i = 0; i < poses.length; i++) {
    const r = await evl(`__ocean.aim(${JSON.stringify(poses[i])})`);
    const ok = r && r.ok;
    check(`aim: ${poses[i]} subject provably in frame`, ok, r ? JSON.stringify(r.ndc) : "no result");
    if (ok) { await sleep(400); await shot(`ocean-${i + 1}-${poses[i]}.png`); }
  }

  // ---- gate 7: console errors -----------------------------------------------
  const uniq = [...new Set(errors)];
  check("console: zero page errors", uniq.length === 0, uniq.slice(0, 5).join(" | "));
} catch (e) {
  failures.push("harness: " + (e && e.message ? e.message : String(e)));
  console.error("HARNESS ERROR:", e);
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill("SIGTERM"); server.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
if (failures.length) {
  console.log("\nGATE FAILURES (" + failures.length + "):\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nALL GATES PASS — DEAD WATER is seaworthy.");
process.exit(0);
