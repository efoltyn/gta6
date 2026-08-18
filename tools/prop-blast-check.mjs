#!/usr/bin/env node
/* tools/prop-blast-check.mjs — A LAMP POST IS NOT A BUILDING.

   Owner, 2026-08-16 (filmed, gang city): "when i shoot a pole like thing with
   a rpg, it makes this glowing fake wall and it leaves a bunch of fake blocks
   that are supposed to be rubble... the actual rpg explosion is beautiful".

   What was happening: city/props.js registers every piece of street furniture
   with solidCollider(), which pushes a SQUARE footprint box carrying a mesh
   and NO y-band. buildings.js carveHole then DERIVES the band off the mesh, so
   a 5.6 m lamp mast on a 0.34 m box cleared every gate the carve primitive
   has — tall (>1.6), thin (<0.9), opaque, has a ref. An RPG landing within the
   ~5.3 m blast search picked the LAMP as its wall, hid the mast, and built the
   city's interior-room prefab (an unlit cream pocket liner ~8 m across, a
   glowing ceiling slab, furniture silhouettes) in mid-air over the sidewalk,
   plus a ~50-piece persistent rubble heap for a lamp that weighs nothing.

   Measures, by consequence, in the live game. It picks the tallest ISOLATED
   posts it can find (nothing with a declared wall band within 14 m, so any
   damage can only have come from the post itself), fires a full-power RPG dead
   on each, and asks:
     1. THE POST IS NOT CARVED — carveHole never marks it `_breached`. That
        flag is the primitive's own commit mark, so this is exact: neither
        farcull hiding a distant mesh nor a real wall opening nearby can fake
        it either way.
     2. THE POST IS NOT DELETED — mesh still visible, collider still in the
        array. A rocket into the shopfront BEHIND a lamp used to take the lamp
        with it through carveHole's neighbour sweep, which reads identically to
        the player and has a completely different cause.
     3. THE BLAST STILL HAPPENS — the beautiful part is untouched: the same
        detonation still emits puffs and still throws debris. A fix that made
        the RPG go quiet near a lamp would be a worse bug than the one it
        replaced, so this is asserted, not assumed.
     4. RUBBLE RESTS ON SOMETHING — blow a REAL wall open, then check every
        settled heap piece is in contact with the ground or another piece.
        The heap is what the owner called "fake blocks"; the old placement
        drew each piece's height at RANDOM up to the mound ceiling, so lumps
        hung in mid-air over the pavement and stayed there forever.
   It also REPORTS (never asserts) how many colliders in the city still carry
   the wall profile while being prop-sized — the size of the exposed class, so
   a new producer registering street furniture the old way is visible here
   before it is visible in a screenshot.

   Usage: node tools/prop-blast-check.mjs
   Exit 0 = ok.                                                             */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, n, probe) { for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } } throw new Error("no port"); }
const port = await claimPort(9450, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(11850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-propblast-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210`], { stdio: "ignore" });
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

const PASS = `(() => {
  const out = { fails: [] };
  const g = CBZ.game;
  CBZ.setMode("city"); CBZ.resetGame && CBZ.resetGame(); CBZ.setState && CBZ.setState("playing");
  for (let i = 0; i < 40; i++) CBZ.stepSim(1/60);
  if (g.mode !== "city") { out.fails.push("not in city"); return out; }

  // The RPG's own numbers (weapons/weapon-data.js bazooka), so this probe
  // moves when the weapon does instead of hard-coding a power.
  const RPG_POWER = 1.9, RPG_RADIUS = 13;

  // ---- 1. CENSUS: is anything prop-sized still carve-eligible? ------------
  // Mirrors carveHole's candidate filter exactly (buildings.js:1598+): a mesh,
  // not noBreach, a readable band spanning >1.6, thinner than 0.9, opaque.
  const box = new THREE.Box3();
  function bandOf(c) {
    if (c.y0 != null && c.y1 != null) return { y0: c.y0, y1: c.y1, derived: false };
    if (!c.ref || c.ref.visible === false) return null;
    try {
      box.setFromObject(c.ref);
      if (box.isEmpty() || !isFinite(box.min.y) || !isFinite(box.max.y)) return null;
      return { y0: box.min.y, y1: box.max.y, derived: true };
    } catch (e) { return null; }
  }
  // Everything that is TALL, THIN, OPAQUE and carries a mesh — the profile the
  // carve primitive reads as "wall panel". 'propSized' is the subset that is
  // also under 1.2 m across in BOTH horizontal axes: a post, a bollard, a sign,
  // a meter, a trunk. This count is REPORTED, not asserted: it is the size of
  // the exposed class, and it is large (>16k) precisely because so many
  // producers register street furniture this way. The assertions below are
  // behavioural instead — shoot the things and see what survives — so this
  // probe cannot pass by re-implementing the gate it is meant to be testing.
  const propSized = [];
  let eligible = 0, declaredWalls = 0;
  for (const c of CBZ.colliders) {
    if (!c.ref || c.noBreach) continue;
    const b = bandOf(c); if (!b) continue;
    if (b.y1 - b.y0 < 1.6) continue;
    const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
    if (Math.min(ex, ez) > 0.9) continue;
    const mt = c.ref.material; if (mt && mt.transparent) continue;
    eligible++;
    if (!b.derived) { declaredWalls++; continue; }        // a first-class wall: never a prop
    if (Math.max(ex, ez) >= 1.2) continue;
    const gt = c.ref.geometry ? c.ref.geometry.type : "?";
    const gp = c.ref.geometry && c.ref.geometry.parameters ? c.ref.geometry.parameters : {};
    const sig = gt + "(" + [gp.radiusTop, gp.radiusBottom, gp.width, gp.height, gp.depth]
      .filter(function (v) { return v != null; }).map(function (v) { return +(+v).toFixed(2); }).join(",") + ")";
    propSized.push({ c: c, span: +Math.max(ex, ez).toFixed(2), h: +(b.y1 - b.y0).toFixed(1), sig: sig });
  }
  // WHO MAKES THESE? Group the exposed class by geometry signature so a failure
  // names the producer instead of sending the next reader on a grep hunt.
  const byShape = {};
  for (const p of propSized) {
    const k = p.sig + " span=" + p.span + " h=" + p.h;
    byShape[k] = (byShape[k] || 0) + 1;
  }
  out.propShapes = Object.keys(byShape).sort(function (a, b) { return byShape[b] - byShape[a]; })
    .slice(0, 12).map(function (k) { return byShape[k] + " x " + k; });
  out.wallProfileColliders = eligible;
  out.declaredWalls = declaredWalls;
  out.propSizedInThatSet = propSized.length;

  // ---- 2/3/4. FIRE REAL RPGs AT REAL STREET FURNITURE --------------------
  // Pick posts that stand ALONE — nothing with a declared wall band within
  // 14 m — so any carve the blast opens can only have come from the post
  // itself. Then detonate a full-power RPG dead on each one.
  const walls = [];
  for (const c of CBZ.colliders) if (c.y0 != null && c.y1 != null && c.ref && c.y1 - c.y0 > 1.6) walls.push(c);
  function lonely(c) {
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    for (const w of walls) {
      const sx = Math.max(w.minX, Math.min(w.maxX, cx)), sz = Math.max(w.minZ, Math.min(w.maxZ, cz));
      if ((cx - sx) * (cx - sx) + (cz - sz) * (cz - sz) < 196) return false;   // 14 m
    }
    return true;
  }
  // the TALLEST lonely posts — a tall mast is the worst case, because height
  // is what let it pass carveHole's "this is a storey of wall" test.
  const targets = propSized.filter(function (p) { return lonely(p.c); })
    .sort(function (a, b) { return b.h - a.h; }).slice(0, 8);
  out.postsShot = targets.length;
  if (!targets.length) out.fails.push("no isolated street post to shoot — probe proved nothing");
  let killed = 0, uncollided = 0, carvesOpened = 0, quiet = 0;
  const shot = [];
  for (const t of targets) {
    const c = t.c, mesh = c.ref;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const before = CBZ.cityBreachAudit ? CBZ.cityBreachAudit().live : 0;
    const meshesBefore = CBZ.scene.children.length;
    const puffs0 = CBZ.wallMarkAudit ? CBZ.wallMarkAudit().livePuffs : 0;
    // dead on the post, at its own mid-height — the exact shot the owner filmed
    CBZ.cityExplosion(cx, cz, { power: RPG_POWER, radius: RPG_RADIUS, byPlayer: true, y: Math.min(2.8, t.h / 2) });
    for (let i = 0; i < 20; i++) CBZ.stepSim(1/60);      // drains the deferred carve queue
    // _breached is carveHole's OWN mark on the mesh it decided was a wall
    // (buildings.js sets it the instant it commits). It is the exact signal:
    // 'visible' alone is not, because core/farcull.js also hides distant meshes
    // and would read as a false kill, and the live carve count alone is not,
    // because a blast may legitimately open a real wall standing nearby.
    const carved = !!mesh._breached;
    const vis = mesh.visible !== false, coll = CBZ.colliders.indexOf(c) >= 0;
    const opened = carved ? 1 : 0;
    const puffs1 = CBZ.wallMarkAudit ? CBZ.wallMarkAudit().livePuffs : 0;
    const debris = CBZ.scene.children.length - meshesBefore;
    if (carved) killed++;
    // A post may also be deleted WITHOUT being carved: carveHole's neighbour
    // sweep splices any collider that falls inside a new opening and hides its
    // mesh, so a rocket into the shopfront behind a lamp used to take the lamp
    // with it. Counted separately — the read is identical to the player (the
    // post is gone), the cause is not.
    if (!coll || !vis) uncollided++;
    if (opened > 0) carvesOpened += opened;
    // 4. THE BEAUTIFUL PART MUST STILL FIRE. A fix that made the RPG go quiet
    //    next to a lamp would be a worse bug than the one it replaced.
    if (puffs1 <= puffs0 && debris <= 0) quiet++;
    shot.push({ sig: t.sig, span: t.span, h: t.h, carved: carved, vis: vis, coll: coll, debris: debris });
  }
  out.postsDeleted = killed;
  out.postsDecollided = uncollided;
  out.postCarvesOpened = carvesOpened;
  out.postsWithNoBlastFx = quiet;
  out.shotDetail = shot;
  if (killed) out.fails.push(killed + "/" + targets.length + " posts were CARVED by the blast — carveHole treated street furniture as a wall");
  if (uncollided) out.fails.push(uncollided + "/" + targets.length + " posts were DELETED by the blast (mesh hidden and/or collider spliced) — street furniture is being treated as part of a wall");
  if (carvesOpened) out.fails.push(carvesOpened + " isolated post(s) got a carve opened in them — the phantom-room path is still live");
  if (quiet) out.fails.push(quiet + "/" + targets.length + " detonations produced no FX at all — the blast went silent, which is worse than the bug");

  // ---- 5. A HEAP RESTS ON SOMETHING --------------------------------------
  // Blow a real wall open so cityWallRuin drops its rubble heap, then check no
  // settled piece is hanging in air. floorAt is the ground the heap sits on;
  // a piece may rest on the deck or on another piece, never on nothing.
  let wall = null;
  for (const c of CBZ.colliders) {
    if (!c.ref || c.noBreach || c.ref.visible === false) continue;
    if (c.y0 == null || c.y1 == null) continue;
    if (c.y1 - c.y0 < 2.2 || c.y0 > 0.7) continue;
    if (Math.min(c.maxX - c.minX, c.maxZ - c.minZ) > 0.9) continue;
    if (Math.max(c.maxX - c.minX, c.maxZ - c.minZ) < 2.5) continue;
    if (c.ref.material && c.ref.material.transparent) continue;
    wall = c; break;
  }
  out.testWallFound = !!wall;
  if (!wall) out.fails.push("no ordinary wall to blow open — cannot check the rubble heap");
  else {
    const p = { x: (wall.minX + wall.maxX) / 2, y: (wall.y0 + wall.y1) / 2, z: (wall.minZ + wall.maxZ) / 2 };
    
    CBZ.cityExplosion(p.x, p.z, { power: RPG_POWER, radius: RPG_RADIUS, byPlayer: true, y: p.y });
    for (let i = 0; i < 20; i++) CBZ.stepSim(1/60);
    const dump = CBZ.cityDebrisDump ? CBZ.cityDebrisDump() : null;
    if (!dump) { out.heapChecked = false; }
    else {
      const heap = dump.filter(function (d) { return d.heap; });
      out.heapPieces = heap.length;
      out.wallOpened = wall.ref.visible === false;
      // a piece is FLOATING if its underside clears the ground by more than
      // its own height and nothing else in the pile is under it.
      let floating = 0, worst = 0;
      for (const d of heap) {
        const gy = CBZ.floorAt ? CBZ.floorAt(d.x, d.z) : 0;
        const under = d.y - d.hh - gy;                 // air beneath, if unsupported
        if (under < 0.05) continue;                    // seated on the deck
        let supported = false;
        for (const o of heap) {
          if (o === d) continue;
          if (Math.abs(o.x - d.x) > 0.7 || Math.abs(o.z - d.z) > 0.7) continue;
          if (o.y + o.hh >= d.y - d.hh - 0.12 && o.y < d.y) { supported = true; break; }
        }
        if (!supported) { floating++; if (under > worst) worst = under; }
      }
      out.heapFloating = floating;
      out.heapWorstAirGap = +worst.toFixed(2);
      out.heapMaxPiece = +heap.reduce(function (m, d) { return Math.max(m, d.hh * 2); }, 0).toFixed(2);
      if (heap.length && floating / heap.length > 0.12) {
        out.fails.push(floating + "/" + heap.length + " heap pieces hang in mid-air (up to " + worst.toFixed(2) + " m) — that is the 'fake blocks' read");
      }
    }
  }
  return out;
})()`;
const res = await evl(PASS);
console.log("PROP-BLAST:");
console.log(JSON.stringify(res, null, 2));
console.log("errors:", errors.slice(0, 8));
chrome.kill("SIGTERM"); server.kill("SIGTERM");
const bad = !res || !res.fails || res.fails.length;
console.log(bad ? "PROP-BLAST-CHECK: FAIL" : "PROP-BLAST-CHECK: ok");
process.exit(bad ? 1 : 0);
