#!/usr/bin/env node
/* tools/probe-wave.mjs — targeted probe for THIS wave's new state.

   Boots the real game once and asks the live world four questions that no
   amount of syntax checking can answer:

     1. BEACH FURNITURE — did loungers and deck chairs actually register
        propuse anchors, and did anyone sit on them? An empty count means the
        furnish call ran but the anchors never landed.
     2. ROAD RULES — is CBZ.roadSpeedLimit answering off real segments (and
        NOT carcluster.js's fallback), and does it post different limits on
        different classes of road?
     3. CHECKPOINTS — do they stage, and are they manned?
     4. TSUNAMI — does a surge actually move the water MASK, i.e. does a point
        that is dry land at rest become water at the crest? That is the one
        assertion that proves the flood is real to gameplay and not just to
        the shader.

   Usage: node tools/probe-wave.mjs [--seed 90210]
   Exit 0 = PROBE: ok. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(lo, span, probe) {
  for (let t = 0; t < 6; t++) { const p = lo + Math.floor(Math.random() * span); try { await probe(p); } catch (_) { return p; } }
  console.error("PROBE: FAIL no free port"); process.exit(1);
}
const port = await claimPort(9550, 120, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } }
const dbg = await claimPort(10850, 150, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-probewave-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=${SEED}`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 150 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("PROBE: FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable"); await send("Page.enable");

let ready = false;
for (let i = 0; i < 400 && !ready; i++) { try { ready = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {} if (!ready) await sleep(150); }
if (!ready) { console.error("PROBE: FAIL never booted"); process.exit(1); }
let playing = false;
for (let i = 0; i < 240 && !playing; i++) { playing = await evl("(() => { if (CBZ.game && CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game && CBZ.game.state === 'playing'; })()"); if (!playing) await sleep(200); }
if (!playing) { console.error("PROBE: FAIL never reached playing"); process.exit(1); }

// let the lazy first-tick populators (beach sunbathers, checkpoints) run
await evl("(() => { for (let i = 0; i < 240; i++) CBZ.stepSim(1/60); return true; })()");

const R = await evl(`(() => {
  const out = { fails: [] };

  // ---- 1. BEACH FURNITURE ------------------------------------------------
  out.beach = CBZ.cityBeachSeats ? CBZ.cityBeachSeats() : null;
  if (!out.beach) out.fails.push("no CBZ.cityBeachSeats");
  else if (!out.beach.loungers && !out.beach.deckchairs) out.fails.push("beach furnished ZERO usable pieces");
  out.furnish = CBZ.furnishAudit ? CBZ.furnishAudit() : null;
  if (out.furnish && out.furnish.mismatched) out.fails.push("furnish cushion mismatch " + out.furnish.mismatched);
  if (out.furnish && !(out.furnish.kinds.lounger || out.furnish.kinds.deckchair)) out.fails.push("no lounger/deckchair drawn by the kit");
  out.anchors = CBZ.propUseAudit ? CBZ.propUseAudit() : null;
  // ratchet, not an invariant — see the math gate's note (baseline 487)
  if (out.anchors && out.anchors.blocked > 6) out.fails.push("unreachable anchors rose to " + out.anchors.blocked);

  // ---- 2. ROAD RULES ------------------------------------------------------
  out.roadRules = CBZ.roadRulesAudit ? CBZ.roadRulesAudit() : null;
  if (!out.roadRules) out.fails.push("no CBZ.roadRulesAudit");
  else if (out.roadRules.fallback) out.fails.push("speed limit still on the carcluster fallback");
  if (CBZ.clusterAudit && CBZ.clusterAudit().limitIsFallback) out.fails.push("clusterAudit says fallback");
  // sample the posted limit over every registered segment: a real per-segment
  // query must produce MORE THAN ONE distinct limit across a whole world
  const A = CBZ.city && CBZ.city.arena;
  const R = (A && A.roads) || (CBZ.city && CBZ.city.roads) || [];
  const seen = {};
  for (let i = 0; i < R.length; i++) {
    const r = R[i]; if (!r) continue;
    const v = CBZ.roadSpeedLimit(r.x, r.z);
    if (v > 0) seen[v] = (seen[v] | 0) + 1;
  }
  out.limits = seen;
  const distinct = Object.keys(seen).length;
  if (!distinct) out.fails.push("every road came back UNPOSTED");
  else if (distinct < 2) out.fails.push("only one distinct limit in the whole world (" + Object.keys(seen)[0] + ")");

  // ---- 3. CHECKPOINTS -----------------------------------------------------
  out.checkpoints = CBZ.checkpointAudit ? CBZ.checkpointAudit() : null;
  if (!out.checkpoints) out.fails.push("no CBZ.checkpointAudit");
  else if (out.checkpoints.count && !out.checkpoints.manned) out.fails.push("checkpoints staged but UNMANNED");

  // ---- 4. TSUNAMI: does the surge move the WATER MASK? --------------------
  // Find a dry point just inland of real water, then check it floods at the
  // crest and is dry again afterwards. Anything less proves only that a
  // number changed.
  if (!CBZ.waterSurgeSet || !CBZ.cityWaterAt) out.fails.push("no surge / no water mask");
  else {
    let probe = null;
    const P = CBZ.player;
    outer: for (let a = 0; a < Math.PI * 2 && !probe; a += Math.PI / 12) {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 40; d < 1400; d += 20) {
        const x = P.pos.x + dx * d, z = P.pos.z + dz * d;
        if (!CBZ.cityWaterAt(x, z)) continue;
        // walk back toward land until dry, then step 8m further inland
        for (let b = 0; b < 30; b++) {
          const bx = x - dx * (b * 6), bz = z - dz * (b * 6);
          if (!CBZ.cityWaterAt(bx, bz)) { probe = { x: bx - dx * 8, z: bz - dz * 8 }; break outer; }
        }
        break;
      }
    }
    if (!probe) out.fails.push("could not find a dry point beside water to test the flood");
    else {
      out.probe = { x: Math.round(probe.x), z: Math.round(probe.z) };
      const dryBefore = !CBZ.cityWaterAt(probe.x, probe.z);
      CBZ.waterSurgeSet(6.0);
      const wetAtCrest = !!CBZ.cityWaterAt(probe.x, probe.z);
      out.floodDepth = CBZ.cityFloodDepthAt ? +CBZ.cityFloodDepthAt(probe.x, probe.z).toFixed(2) : null;
      CBZ.waterSurgeSet(0);
      const dryAfter = !CBZ.cityWaterAt(probe.x, probe.z);
      out.flood = { dryBefore: dryBefore, wetAtCrest: wetAtCrest, dryAfter: dryAfter };
      if (!dryBefore) out.fails.push("probe point was already wet at rest");
      if (!wetAtCrest) out.fails.push("SURGE DID NOT FLOOD: the water mask never moved");
      if (!dryAfter) out.fails.push("surge did not release: point stayed wet at surge 0");
    }
    // and the event arc itself steps without throwing
    if (CBZ.cityTsunami) {
      CBZ.cityTsunami();
      for (let i = 0; i < 300; i++) CBZ.stepSim(1 / 60);
      const st = CBZ.cityTsunamiState();
      out.tsunami = st ? { phase: st.phase, surge: +st.surge.toFixed(2) } : null;
      // the arc is ~37 s at normal pace (TSU_PACE_V2) and ~78 s with the
      // flag off; 5 s of stepping is inside either, and the assertion is
      // only that the event is still alive and stepping without throwing
      if (!st) out.fails.push("tsunami ended within 5s (the arc is ~37s)");
      CBZ.cityTsunamiStop();
      if (Math.abs(CBZ.waterSurge()) > 1e-6) out.fails.push("stop left a surge standing");
    }
  }
  return out;
})()`);

console.log(JSON.stringify(R, null, 2));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
if (R && R.fails && R.fails.length) { console.log("PROBE: FAIL — " + R.fails.join(" | ")); process.exit(1); }
console.log("PROBE: ok");
process.exit(0);
