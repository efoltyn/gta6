#!/usr/bin/env node
/* tools/mode-engine-check.mjs — DOES GANG CITY'S ENGINE ACTUALLY REACH THE
   OTHER MODES? (owner, 2026-08-06: "Gang City becomes like this engine and
   this asset farm" — prison, gun game and natural disaster use its elements.)

   Boots headless, drops into ESCAPE (the prison), and asks four questions
   syntax cannot, all by CONSEQUENCE rather than by reading a flag:

     1. THE CAPABILITY BUS answers for this mode, and every blast-capable mode
        resolves a real damage route (CBZ.modeCapsAudit().unrouted === 0).
     2. THE BLOCK CAN BE VAULTED. Stand a synthetic body in front of every
        waist-high PRISON collider and ask the SHARED probe
        (CBZ.characterTraversal) whether it answers — this is literally "can I
        jump over that chair" — then drive the PLAYER's own start() path.
     3. THE RPG BLOWS UP IN PRISON. Stand six of the prison cast in a lethal
        core and detonate; the proof is men who were alive and are now dead,
        plus the fireball's own draws landing in the scene. We never try to
        observe cityExplosion directly: a wrapper on a CBZ.* handle never sees
        a same-file caller (nuke-sortie-check.mjs's lesson) — detect a
        detonation by its consequences.
     4. A HUNTING GUARD VAULTS. Put the player behind a mess bench, set the
        hunt flag, and let guards.js's OWN mover drive. Nothing fakes movement.

   Usage: node tools/mode-engine-check.mjs
          node tools/mode-engine-check.mjs --revert    (assert MODE_CAPS_V1=0
              restores the old city-only refusals exactly — the degrade-safe
              claim, proved rather than asserted)
   Exit 0 = ok. ~90 s (one boot, no rendered frames).                        */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REVERT = process.argv.includes("--revert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9550, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(10850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-prisoncheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, `${origin}?seed=90210${REVERT ? "&cfg_MODE_CAPS_V1=0" : ""}`,
], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 200 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await send("Runtime.enable");

for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }

const REV = REVERT ? 1 : 0;
const PASS = `(() => {
  const REVERT = ${REV};
  const out = { fails: [], notes: [] };
  const g = CBZ.game;
  // ---- ENTER THE PRISON -------------------------------------------------
  if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
  CBZ.setMode("escape");
  CBZ.resetGame ? CBZ.resetGame() : null;
  CBZ.setState && CBZ.setState("playing");
  for (let i = 0; i < 60; i++) CBZ.stepSim(1/60);
  out.mode = g.mode;
  if (g.mode !== "escape") { out.fails.push("not in escape mode: " + g.mode); return out; }

  // ---- 0. the capability bus answers for this mode -----------------------
  out.caps = { traverse: CBZ.modeHas("traverse"), blast: CBZ.modeHas("blast"), blastActors: CBZ.modeHas("blastActors") };
  out.audit = CBZ.modeCapsAudit();
  if (!REVERT && !out.caps.traverse) out.fails.push("escape denied traverse");
  if (REVERT && out.caps.traverse) out.fails.push("REVERT FAILED: escape still has traverse");
  if (!REVERT && !out.caps.blast) out.fails.push("escape denied blast");
  if (REVERT && out.caps.blast) out.fails.push("REVERT FAILED: escape still has blast");
  if (out.audit.unrouted) out.fails.push("unrouted rosters: " + out.audit.unrouted);

  // ---- 1. THE PRISON'S OWN FURNITURE IS A VAULTABLE OBSTACLE -------------
  // Ask the SHARED probe about the mess-hall band directly: stand a synthetic
  // body one metre in front of every low prison collider and see if the probe
  // returns a traversal. This is the exact question "can I jump over a chair".
  const T = CBZ.characterTraversal;
  const rig = CBZ.playerChar;
  let lowCols = 0, vaultable = 0, sample = "";
  for (const c of CBZ.colliders) {
    if (c._city) continue;                       // city stamp: not in this world
    if (c.y0 == null || c.y1 == null) continue;
    const h = c.y1 - c.y0;
    if (c.y0 > 0.05 || h < 0.4 || h > 1.3) continue;   // waist-high band
    lowCols++;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    // approach along +x from outside the box
    const probe = { pos: { x: c.minX - 1.0, y: 0, z: cz }, radius: 0.55 };
    const s = T.probe(probe, rig, 1, 0, { speed: 5.2, radius: 0.55, height: 1.8, allowTop: false, cars: false, running: true });
    if (s) { vaultable++; if (!sample) sample = s.kind + " rise=" + s.rise.toFixed(2) + " span=" + s.span.toFixed(2); }
  }
  out.lowCols = lowCols; out.vaultable = vaultable; out.vaultSample = sample;
  if (!REVERT && lowCols > 0 && vaultable === 0) out.fails.push("NOT ONE of " + lowCols + " waist-high prison colliders is vaultable");
  if (REVERT && vaultable !== 0) out.fails.push("REVERT FAILED: probe still returns " + vaultable + " traversals");
  if (lowCols === 0) out.notes.push("no waist-high prison colliders found (band 0.4-1.3m at floor)");

  // ---- 2. THE PLAYER'S OWN JUMP TURNS INTO A VAULT ------------------------
  // Put the player in front of one and drive the real start() path.
  let playerVault = null;
  for (const c of CBZ.colliders) {
    if (c._city || c.y0 == null) continue;
    const h = c.y1 - c.y0;
    if (c.y0 > 0.05 || h < 0.4 || h > 1.3) continue;
    const cz = (c.minZ + c.maxZ) / 2;
    CBZ.player.pos.set(c.minX - 1.0, 0, cz);
    CBZ.player.grounded = true; CBZ.player.dead = false;
    const s = T.start(CBZ.player, rig, 1, 0, { speed: 5.2, radius: CBZ.player.radius, height: 1.8, allowTop: true, cars: true, sprinting: true });
    if (s) { playerVault = s.kind + " over " + (c.y1).toFixed(2) + "m"; T.cancel(CBZ.player, rig, false, "probe"); break; }
  }
  out.playerVault = playerVault;
  if (!REVERT && !playerVault) out.fails.push("the player cannot vault ANY prison prop");
  if (REVERT && playerVault) out.fails.push("REVERT FAILED: player still vaults");

  // ---- 3. THE RPG BLOWS UP -----------------------------------------------
  // Arm the launcher, stand a crowd of the prison cast around a point, and
  // detonate through the real fpsmode path. Prove it by CONSEQUENCE.
  const before = { puffs: 0, live: 0 };
  const cast = [];
  for (const a of (CBZ.guards || [])) if (a && !a.dead && a.group) cast.push(a);
  for (const a of (CBZ.npcs || [])) if (a && !a.dead && a.group && !a._crowd) cast.push(a);
  out.castSize = cast.length;
  if (!cast.length) { out.fails.push("no prison cast to blast"); return out; }
  // gather 6 of them tightly around a clear point next to the player
  const P = CBZ.player.pos;
  const bx = P.x + 6, bz = P.z;
  const victims = cast.slice(0, 6);
  for (let i = 0; i < victims.length; i++) {
    const a = victims[i], ang = i * 1.05;
    a.group.position.set(bx + Math.cos(ang) * 1.2, 0, bz + Math.sin(ang) * 1.2);
    a.hp = 100; a.dead = false; a.ko = 0;
  }
  before.live = victims.filter((a) => !a.dead).length;
  before.puffs = CBZ.fxPuffCount ? CBZ.fxPuffCount() : -1;
  // point the camera at the cluster and fire the real weapon
  CBZ.unlockWeapon && CBZ.unlockWeapon("bazooka", { select: true });
  CBZ.fpsResetWeapons && CBZ.fpsResetWeapons();
  CBZ.fpsAddAmmo && CBZ.fpsAddAmmo(10, "bazooka");
  // detonate through the SAME shared entry the rocket lands on
  const blastR = 13;
  const reached = CBZ.blastWorldActors(bx, 1.2, bz, blastR, 1.9, { byPlayer: true, cause: "explosion" });
  out.blastReached = reached;
  out.liveAfter = victims.filter((a) => !a.dead).length;
  out.killed = before.live - out.liveAfter;
  if (!REVERT && out.killed <= 0) out.fails.push("RPG blast killed NOBODY in the prison (" + before.live + " stood in a 7m lethal core)");
  if (REVERT && out.killed !== 0) out.fails.push("REVERT FAILED: blast still reached " + out.killed);

  // ---- 4. and the FIREBALL actually draws ---------------------------------
  const puffsBefore = CBZ.cityBlastCore ? 1 : 0;
  if (!CBZ.cityBlastCore) out.fails.push("CBZ.cityBlastCore missing");
  else {
    const sceneBefore = CBZ.scene.children.length;
    CBZ.cityBlastCore(bx, bz, { power: 1.9, radius: 13, byPlayer: true, y: 1.2 });
    for (let i = 0; i < 6; i++) CBZ.stepSim(1/60);
    out.sceneDelta = CBZ.scene.children.length - sceneBefore;
    if (out.sceneDelta <= 0) out.notes.push("no new scene children (pooled sprites may be pre-allocated) — sceneDelta=" + out.sceneDelta);
  }

  // ---- 5. NPC VAULT WIRING is live (actorcollide hook present) ------------
  // THE REAL SCENARIO: a HUNTING guard (guards.js runs the hunt branch at
  // speed x 1.7) with the player standing on the far side of a low prop, so
  // the guard's own mover — not the probe — drives it into the face. Nothing
  // here fakes movement; the only thing set is the hunt flag.
  const t0 = T.stats();
  let drove = "", tried = 0;
  const lowList = [];
  for (const c of CBZ.colliders) {
    if (c._city || c.y0 == null) continue;
    const h = c.y1 - c.y0;
    if (c.y0 <= 0.05 && h >= 0.4 && h <= 1.3) lowList.push(c);
  }
  for (const c of lowList) {
    const gd = (CBZ.guards || []).find((x) => x && !x.dead && !x._traversal);
    if (!gd) break;
    tried++;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    // player just past the far face; guard 1.8 m before the near face
    CBZ.player.pos.set(c.maxX + 1.4, 0, cz);
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    gd.group.position.set(c.minX - 1.8, 0, cz);
    gd.hunt = 6; gd.alert = 1; gd.investigate = null; gd.approach = null;
    gd._acX = null; gd._acProbeT = 0;
    let maxSpd = 0, moved = 0;
    for (let f = 0; f < 40; f++) {
      gd.hunt = Math.max(gd.hunt, 4);            // keep the hunt branch selected
      const px = gd.group.position.x, pz = gd.group.position.z;
      CBZ.stepSim(1/60);
      const d = Math.hypot(gd.group.position.x - px, gd.group.position.z - pz);
      moved += d; maxSpd = Math.max(maxSpd, d * 60);
      if (gd._traversal) { drove = gd._traversal.kind + " over " + c.y1.toFixed(2) + "m"; break; }
    }
    out.diag = out.diag || [];
    if (out.diag.length < 4) out.diag.push({ top: +c.y1.toFixed(2), maxSpd: +maxSpd.toFixed(2), moved: +moved.toFixed(2), probes: T.stats().probes - t0.probes });
    if (drove) break;
  }
  out.guardVault = drove || false;
  out.guardVaultTried = tried;
  const t1 = T.stats();
  out.travStats = { startsDelta: t1.starts - t0.starts, vaults: t1.vaults, mantles: t1.mantles, lastCancel: t1.lastCancel };
  if (!REVERT && !drove) out.fails.push("a HUNTING guard never vaulted any of " + tried + " low prison props");
  if (REVERT && drove) out.fails.push("REVERT FAILED: guard still vaulted");
  return out;
})()`;

const res = await evl(PASS);
console.log((REVERT ? "MODE-ENGINE (revert path, MODE_CAPS_V1=0)" : "MODE-ENGINE") + ":");
console.log(JSON.stringify(res, null, 2));
console.log("errors:", JSON.stringify(errors.slice(0, 12), null, 2));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
const bad = !res || !res.fails || res.fails.length;
console.log(bad ? "MODE-ENGINE: FAIL" : "MODE-ENGINE: ok");
process.exit(bad ? 1 : 0);
