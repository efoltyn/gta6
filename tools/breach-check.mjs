#!/usr/bin/env node
/* tools/breach-check.mjs — ENOUGH IS ENOUGH: does explosive ACCUMULATE?

   Owner, 2026-08-06: "the parts of buildings that fake blow up — with enough
   C4 actually blowing up, or enough rockets actually opening a man-sized hole.
   Your research proved it."

   Measures, by consequence, in the live game:
     1. THE TABLE is the real one (2/5/7/10 lb rows, FM 90-10-1 app.M).
     2. ONE 5 lb brick IN CONTACT opens a wall  (the doctrinal one-man row).
     3. ONE brick's worth STANDING OFF does not — and N rockets DO. The count
        is reported, not asserted to a magic number, so a tuning change shows
        up as a number moving rather than as a pass/fail flip.
     4. A THICK wall (over carveHole's 0.9 m single-hit veto) opens once the
        ledger crosses the heavy rows.
     5. A VAULT opens when the running total reaches the pounds it declared.
     6. noBreach is STILL absolute — no amount of anything opens the prison
        perimeter.

   Usage: node tools/breach-check.mjs            (city)
          node tools/breach-check.mjs --escape   (the prison)
          node tools/breach-check.mjs --off      (BREACH_TABLE_V1=0 control)
   Exit 0 = ok.                                                             */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ESCAPE = process.argv.includes("--escape");
const OFF = process.argv.includes("--off");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, n, probe) { for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } } throw new Error("no port"); }
const port = await claimPort(9450, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(11850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-breachchk-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210${OFF ? "&cfg_BREACH_TABLE_V1=0" : ""}`], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 240 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 160));
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true });
  const ed = r.result && r.result.exceptionDetails;
  if (ed) console.error("EVAL THREW:", (ed.exception && ed.exception.description) || ed.text);
  return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }

const MODE = ESCAPE ? "escape" : "city";
const PASS = `(() => {
  const OFF = ${OFF ? 1 : 0}, MODE = ${JSON.stringify(MODE)};
  const out = { fails: [], mode: MODE, off: !!OFF };
  const g = CBZ.game;
  if (g.cityCampaign) g.cityCampaign.phase = "endless_contracts";
  CBZ.setMode(MODE); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  for (let i = 0; i < 40; i++) CBZ.stepSim(1/60);
  if (g.mode !== MODE) { out.fails.push("not in " + MODE); return out; }
  if (!CBZ.breachSpec) { out.fails.push("systems/breach.js not loaded"); return out; }

  // ---- 1. THE TABLE IS THE REAL ONE --------------------------------------
  out.table = CBZ.BREACH_TABLE.map(function (r) { return r.lb + "lb=" + r.opening; }).join(" / ");
  const rows = CBZ.BREACH_TABLE.map(function (r) { return r.lb; }).join(",");
  if (rows !== "2,5,7,10") out.fails.push("charge table is not the doctrinal rows: " + rows);
  if (CBZ.breachSpec(2).walkable) out.fails.push("2 lb should NOT be walkable (it is a mousehole)");
  if (!CBZ.breachSpec(5).walkable) out.fails.push("5 lb SHOULD be walkable (the one-man row)");

  // ---- helpers ------------------------------------------------------------
  // an eligible thin wall and a THICK one that a single hit must refuse
  function walls(thickMin, thickMax) {
    const list = [];
    for (const c of CBZ.colliders) {
      if (!c.ref || c.noBreach || c.ref.visible === false) continue;
      let h = 0, bot = 0;
      try { const b = new THREE.Box3().setFromObject(c.ref); h = b.max.y - b.min.y; bot = b.min.y; } catch (e) {}
      const thin = Math.min(c.maxX - c.minX, c.maxZ - c.minZ);
      const len = Math.max(c.maxX - c.minX, c.maxZ - c.minZ);
      // prefer the DECLARED band when there is one: c.ref may be a group whose
      // bounds cover a whole building, which is how the first run of this probe
      // picked a wall 14 m up and then detonated at ground level.
      if (c.y0 != null && c.y1 != null) { bot = c.y0; h = c.y1 - c.y0; }
      if (!(h >= 2.2 && bot < 0.7 && len >= 2.5)) continue;
      if (c.ref.material && c.ref.material.transparent) continue;
      if (thin < thickMin || thin > thickMax) continue;
      if (MODE === "escape" && c._city) continue;
      if (MODE === "city" && !c._city) continue;
      list.push(c);
    }
    return list;
  }
  function opened(c) { return c.ref.visible === false && CBZ.colliders.indexOf(c) < 0; }
  // detonate at the wall's OWN mid-height: carveHole requires the hit to lie
  // inside the collider's vertical band, so a fixed 1.4 m only ever tests
  // ground-floor walls and silently "fails" every upper storey.
  function ctr(c) {
    const y = (c.y0 != null && c.y1 != null) ? (c.y0 + c.y1) / 2 : 1.4;
    return { x: (c.minX + c.maxX) / 2, y: y, z: (c.minZ + c.maxZ) / 2 };
  }

  const thin = walls(0, 0.9), thick = walls(0.95, 1.5);
  out.thinWalls = thin.length; out.thickWalls = thick.length;

  // ---- 2. ONE 5 lb BRICK IN CONTACT OPENS A WALL --------------------------
  if (thin.length) {
    const c = thin[0], p = ctr(c);
    CBZ.breachLedgerReset && CBZ.breachLedgerReset();
    CBZ.contactBreach(p.x, p.y, p.z, { lb: 5, contact: true, byPlayer: true });
    for (let i = 0; i < 6; i++) CBZ.stepSim(1/60);
    out.oneBrickOpens = opened(c);
    if (!OFF && !out.oneBrickOpens) out.fails.push("one 5 lb CONTACT brick did not open a thin wall");
    // NOTE the revert semantics: BREACH_TABLE_V1=0 reverts to the state
    // BEFORE systems/breach.js, not to "nothing ever carves". The city's own
    // blast->structuralBlast->blastAt chain predates this work and still opens
    // a thin wall, which is correct. What the flag must kill is everything the
    // table owns: mass-sized holes, ACCUMULATION, and priced targets. Those are
    // the assertions below.
  } else out.fails.push("no eligible thin wall to test");

  // ---- 3. HOW MANY ROCKETS? ----------------------------------------------
  // standoff only. Count until it opens, capped so a refusal is reported as a
  // number rather than hanging.
  let rockets = 0;
  if (thin.length > 1) {
    const c = thin[1], p = ctr(c);
    CBZ.breachLedgerReset && CBZ.breachLedgerReset();
    for (rockets = 1; rockets <= 30; rockets++) {
      CBZ.breachDeliver(p.x, p.y, p.z, 2.2, false, { byPlayer: true });
      for (let i = 0; i < 3; i++) CBZ.stepSim(1/60);
      if (opened(c)) break;
    }
    out.rocketsToOpen = opened(c) ? rockets : null;
    if (!OFF && !opened(c)) out.fails.push("30 rockets into one panel opened nothing");
    if (!OFF && rockets <= 1) out.fails.push("a SINGLE standoff rocket opened it — standoff must cost more than contact");
    if (OFF && opened(c)) out.fails.push("REVERT FAILED: rockets still opened it with the table off");
  }

  // ---- 4. A THICK WALL, which a single hit must refuse --------------------
  if (thick.length) {
    const c = thick[0], p = ctr(c);
    CBZ.breachLedgerReset && CBZ.breachLedgerReset();
    const single = CBZ.cityCarveWall(p.x, p.y, p.z, 0.5, { search: 1.2 });
    out.thickRefusesOneHit = !single;
    if (!single) {
      let n = 0;
      out.thickTrace = [];
      out.thickWall = { thin: +Math.min(c.maxX - c.minX, c.maxZ - c.minZ).toFixed(2),
                        y0: c.y0 == null ? null : +c.y0.toFixed(2), y1: c.y1 == null ? null : +c.y1.toFixed(2),
                        breached: !!(c.ref && c.ref._breached), vis: c.ref.visible };
      for (n = 1; n <= 12; n++) {
        const r2 = CBZ.breachDeliver(p.x, p.y, p.z, 5, true, { byPlayer: true });
        for (let i = 0; i < 4; i++) CBZ.stepSim(1/60);
        const d2 = CBZ.cityBreachAudit ? CBZ.cityBreachAudit() : {};
        if (out.thickTrace.length < 6) out.thickTrace.push({ n: n, total: Math.round(r2.total), kind: r2.kind,
          carve: d2.result, maxThick: d2.maxThick, breached: !!(c.ref && c.ref._breached) });
        if (opened(c)) break;
      }
      out.thickBricksToOpen = opened(c) ? n : null;
      if (!OFF && !opened(c)) out.fails.push("a thick wall never opened, even at 60 lb");
    }
  } else out.notes = ["no thick wall in this world to test"];

  // ---- 5. A VAULT OPENS AT ITS DECLARED PRICE -----------------------------
  if (MODE === "city" && CBZ.cityVaults) {
    const vs = CBZ.cityVaults().filter(function (v) { return !v.open; });
    out.vaults = vs.length;
    if (vs.length) {
      const v = vs[0];
      const t = CBZ.breachTargetAt(v.x, (v.y || 0) + 1.2, v.z, 1);
      out.vaultPrice = t ? (t.id + " = " + t.lb + " lb") : "NOT REGISTERED";
      if (!t) out.fails.push("a shut vault declared no breach price");
      else {
        CBZ.breachLedgerReset && CBZ.breachLedgerReset();
        let n = 0;
        for (n = 1; n <= 6; n++) {
          CBZ.breachDeliver(v.x, (v.y || 0) + 1.2, v.z, 5, true, { byPlayer: true });
          for (let i = 0; i < 4; i++) CBZ.stepSim(1/60);
          if (v.open) break;
        }
        out.vaultBricks = v.open ? n : null;
        if (!OFF && !v.open) out.fails.push("a vault never opened, even at 30 lb of contact charge");
        if (OFF && v.open) out.fails.push("REVERT FAILED: the vault opened with the table off");
      }
    }
  }

  // ---- 6. noBreach IS ABSOLUTE -------------------------------------------
  let peri = null;
  for (const c of CBZ.colliders) if (c.noBreach && c.ref && c.ref.visible !== false) { peri = c; break; }
  out.perimeterFound = !!peri;
  if (peri) {
    const p = ctr(peri);
    CBZ.breachLedgerReset && CBZ.breachLedgerReset();
    for (let i = 0; i < 10; i++) { CBZ.breachDeliver(p.x, p.y, p.z, 10, true, { byPlayer: true }); for (let k = 0; k < 3; k++) CBZ.stepSim(1/60); }
    out.perimeterHeldAt100lb = peri.ref.visible !== false && CBZ.colliders.indexOf(peri) >= 0;
    if (!out.perimeterHeldAt100lb) out.fails.push("PERIMETER OPENED at 100 lb — noBreach is meant to be absolute");
  }

  out.audit = CBZ.breachAudit();
  return out;
})()`;
const res = await evl(PASS);
console.log((OFF ? "BREACH (revert path, BREACH_TABLE_V1=0)" : "BREACH") + " [" + MODE + "]:");
console.log(JSON.stringify(res, null, 2));
console.log("errors:", errors.slice(0, 8));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
const bad = !res || !res.fails || res.fails.length;
console.log(bad ? "BREACH-CHECK: FAIL" : "BREACH-CHECK: ok");
process.exit(bad ? 1 : 0);
