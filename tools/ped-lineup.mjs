#!/usr/bin/env node
/* tools/ped-lineup.mjs — PHOTOGRAPH THE PEOPLE. Boot the real city, grab live
   rigs out of CBZ.cityPeds/cityCops, stand them in a lit row in front of a
   fixed camera and shoot them, front and back.

   WHY IT EXISTS. Every instrument on the shelf that can see a BODY photographs
   ONE body (studio.mjs `rig`) or the player's own wardrobe (the outfit-gallery
   preset). Neither can answer the question the owner actually asks — "there are
   guys walking around with an invisible chest" — because that is a question
   about a POPULATION: which of the people the city cast today render wrong.
   A street shot cannot answer it either; the peds are 40 m away, three pixels
   wide, and mostly behind cars.

   So: line them up. One row, waist-to-head framing, deterministic camera, and
   a `--filter` that picks WHICH kind of person stands in it — the plain
   civilians (`--filter plain`) being exactly the class the invisible-chest
   reports have always named.

   USAGE
     node tools/ped-lineup.mjs out.png                     # 8 peds, front
     node tools/ped-lineup.mjs out.png --n 12 --filter plain
     node tools/ped-lineup.mjs out.png --back              # shoot the backs
     node tools/ped-lineup.mjs out.png --cfg PED_INSTANCED=0   # A/B a flag
     node tools/ped-lineup.mjs out.png --seed 1337 --settle 8

   THE A/B THIS WAS BUILT FOR: shoot the same seed twice, once with
   `--cfg PED_INSTANCED=0`, once without. Any body part that is present in one
   frame and missing in the other is entities/pedinstance.js dropping a part,
   and no numeric audit in the repo can see that — `cityClothesBare` tests
   `visible`/`parent`/material and is blind to the LAYER mask that file hides
   parts with.

   Filters: `plain` (no painted garment — ch._clothesKey == null), `painted`,
   `cop`, `any` (default). */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OUT = (argv[0] && !argv[0].startsWith("--")) ? argv[0] : path.join(ROOT, "tools/shots/ped-lineup.png");
const N = +arg("--n", 8);
const FILTER = arg("--filter", "any");
const SEED = arg("--seed", "90210");
const BACK = has("--back");
const SETTLE = +arg("--settle", 6);
const VIEWPORT = arg("--viewport", "1200,900");
// repeatable: --cfg NAME=VALUE (URL cfg_ overrides are applied BEFORE boot,
// which is the only way to A/B a build-time flag headless — CLAUDE.md).
const CFG = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--cfg" && argv[i + 1]) CFG.push(argv[i + 1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8990 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
let url = `http://127.0.0.1:${port}/?seed=${SEED}`;
for (const c of CFG) { const [k, v] = c.split("="); url += `&cfg_${k}=${v == null ? 1 : v}`; }
const dbg = 9990 + Math.floor(Math.random() * 40);
await rm(`/tmp/cbz-lineup-${dbg}`, { recursive: true, force: true });
await sleep(700);
const chrome = spawn(
  process.env.CBZ_CHROME || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium"),
  ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader",
   "--enable-unsafe-swiftshader", "--enable-webgl", "--mute-audio", `--window-size=${VIEWPORT}`,
   `--remote-debugging-port=${dbg}`, `--user-data-dir=/tmp/cbz-lineup-${dbg}`, url],
  { stdio: "ignore" });

let page = null;
for (let i = 0; i < 100 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${port}/`)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("[lineup] no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 60; i++) { if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')");
}
// the campaign boots into the motel opening — free play is where the street is
await evl(`(() => { if (CBZ.game && CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; return true; })()`);
await sleep(SETTLE * 1000);

// ---- VENDORS ARE LAZY (peds.js LAZY_VENDORS): a shop only grows a body when
//      the player is inside 55 m, it is daylight, and the spot is off-camera.
//      So `--filter vendor` has to go and stand at some counters first, or the
//      row comes back empty and the tool reports "no peds matched".
if (FILTER === "vendor") {
  console.log("[lineup] posting vendors", JSON.stringify(await evl(`(() => {
    CBZ.CONFIG.NPC_SPAWN_HIDE = false;                  // let a counter fill in view
    if (CBZ.dayPhase) CBZ.dayPhase(0.25);               // shops are day-open (night < 0.5)
    if (CBZ.player) { CBZ.player.dead = false; }        // a dead player posts nobody
    const shops = (CBZ.city.arena.shopLots || []).filter(function (l) { return l.building && l.building.vendorSpot && !l.demolished; });
    const seen = {}, picks = [];
    for (const l of shops) { if (seen[l.kind]) continue; seen[l.kind] = 1; picks.push(l); if (picks.length >= 8) break; }
    for (const l of picks) {
      const vs = l.building.vendorSpot;
      CBZ.player.pos.set(vs.x + 20, 0, vs.z + 20);
      for (let i = 0; i < 90; i++) CBZ.stepSim(1 / 60);
    }
    const live = (CBZ.cityPeds || []).filter(function (p) { return p && p.vendor; });
    return { posted: live.length, kinds: live.slice(0, 10).map(function (p) { return p.vendor.kind + ":" + (p.job || "?"); }) };
  })()`)));
}

// ---- stage: pick the row, stand them on their marks, aim the lens ----------
const info = await evl(`(() => {
  const FILTER = ${JSON.stringify(FILTER)}, N = ${N}, BACK = ${BACK};
  const pool = [];
  const add = (arr, cop) => { for (const p of (arr || [])) if (p && p.char && p.char.skinSlots && !p.dead && !p._parked) pool.push({ p, cop }); };
  add(CBZ.cityPeds, false); add(CBZ.cityCops, true);
  const want = pool.filter(function (e) {
    if (FILTER === "cop") return e.cop;
    if (FILTER === "vendor") return !!e.p.vendor;        // the person behind a counter
    if (FILTER === "plain") return e.p.char._clothesKey == null;
    if (FILTER === "painted") return e.p.char._clothesKey != null;
    return true;
  });
  if (!want.length) return { error: "no peds matched filter " + FILTER, pool: pool.length };
  const P = CBZ.player;
  // A clear mark well away from the player's own street furniture. The row runs
  // along +X; the camera sits on -Z (or +Z for --back) at chest height.
  const ox = P.pos.x, oz = P.pos.z - 14;
  const oy = CBZ.floorAt ? CBZ.floorAt(ox, oz) : 0;
  const GAP = 1.5;
  const picked = want.slice(0, N);
  const marks = [];
  picked.forEach(function (e, i) {
    const x = ox + (i - (picked.length - 1) / 2) * GAP;
    const z = oz;
    const face = BACK ? Math.PI : 0;                 // face the lens, or away from it
    e.p.pos.set(x, oy, z);
    e.p.target && e.p.target.set(x, oy, z);
    e.p.group.position.set(x, oy, z);
    e.p.group.rotation.y = face;
    e.p.speed = 0; e.p.state = "idle"; e.p.path = null; e.p.finalGoal = null;
    e.p.culled = false; e.p.group.visible = true;
    marks.push({ x: x, z: z, name: e.p.name || e.p.job || e.p.kind || "?",
                 key: e.p.char._clothesKey == null ? "plain" : e.p.char._clothesKey });
  });
  // PIN them: peds.js's brain will walk them off the mark otherwise, and the
  // hold has to run every tick (outfit-gallery.mjs's footgun note) — but the
  // POSITION is written once and only re-asserted, never re-teleported in Y.
  if (!window.__lineupPin) {
    window.__lineupPin = picked.map(function (e, i) { return { p: e.p, name: marks[i].name, x: marks[i].x, z: marks[i].z, y: oy, face: BACK ? Math.PI : 0 }; });
    const _wc = new THREE.Vector3(), _acc = new THREE.Vector3();
    CBZ.onAlways(97, function () {
      let lo = Infinity, hi = -Infinity, wy = 0;
      _acc.set(0, 0, 0);
      for (const m of window.__lineupPin) {
        m.p.pos.set(m.x, m.y, m.z);
        m.p.group.position.set(m.x, m.y, m.z);
        m.p.group.rotation.y = m.face;
        m.p.speed = 0; m.p.state = "idle"; m.p.culled = false; m.p.group.visible = true;
        m.p.group.updateWorldMatrix(true, false);
        _wc.setFromMatrixPosition(m.p.group.matrixWorld);
        _acc.add(_wc); wy = _wc.y;
        if (_wc.x < lo) lo = _wc.x;
        if (_wc.x > hi) hi = _wc.x;
      }
      // The marks ARE the frame — a body that some other system has dragged
      // off its mark must not be allowed to drag the LENS with it (one rogue
      // z pulled the whole row 23 m out of shot on the first pass).
      const pin = window.__lineupPin, mid = pin[0];
      let mlo = Infinity, mhi = -Infinity;
      for (const m of pin) { if (m.x < mlo) mlo = m.x; if (m.x > mhi) mhi = m.x; }
      const d = Math.max(3, mhi - mlo) * 0.62 + 3.2;
      const cx = (mlo + mhi) / 2;
      window.__cam = [cx, mid.y + 1.35, mid.z + (BACK ? d : -d), cx, mid.y + 1.05, mid.z];
    });
  }
  // camera override at render time (street-shot.mjs's render-wrap trick).
  // The MARKS are re-asserted here too, not only on the always chain: peds.js
  // recycles a body it considers off-street and writes group.position after
  // every hook we can register, so the last word has to be ours.
  if (!CBZ.renderer.__lineupPatch) {
    const orig = CBZ.renderer.render.bind(CBZ.renderer);
    CBZ.renderer.render = function (s, cam) {
      for (const m of (window.__lineupPin || [])) {
        m.p.pos.set(m.x, m.y, m.z);
        m.p.group.position.set(m.x, m.y, m.z);
        m.p.group.rotation.y = m.face;
        m.p.group.visible = true; m.p.culled = false;
        m.p.group.updateMatrix();
        m.p.group.updateWorldMatrix(true, true);
      }
      const t = window.__cam;
      if (t && cam && cam.position) {
        cam.position.set(t[0], t[1], t[2]);
        cam.lookAt(t[3], t[4], t[5]);
        cam.updateMatrixWorld();
        const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
        if (skyRig && skyRig.position) { skyRig.position.copy(cam.position); skyRig.updateMatrixWorld(); }
      }
      return orig(s, cam);
    };
    CBZ.renderer.__lineupPatch = true;
  }
  // AIM AT WHERE THE BODIES ACTUALLY ARE, never at the coordinates we asked
  // for: a rig group can sit under a parent with its own transform, and a
  // camera built from the request instead of the result photographs an empty
  // street while every number checks out (CLAUDE.md's aimlib note, in small).
  const wc = new THREE.Vector3(), acc = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity, wy = 0;
  picked.forEach(function (e) {
    e.p.group.updateWorldMatrix(true, false);
    wc.setFromMatrixPosition(e.p.group.matrixWorld);
    acc.add(wc); wy = wc.y;
    if (wc.x < lo) lo = wc.x;
    if (wc.x > hi) hi = wc.x;
  });
  acc.multiplyScalar(1 / picked.length);
  const span = Math.max(3, hi - lo);
  const dist = span * 0.62 + 3.2;
  const camZ = acc.z + (BACK ? dist : -dist);
  window.__cam = [acc.x, wy + 1.35, camZ, acc.x, wy + 1.05, acc.z];
  // stand the PLAYER out of frame
  P.pos.set(ox, CBZ.floorAt ? CBZ.floorAt(ox, oz + 40) : 0, oz + 40);
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  // noon, clear: the fault we are hunting is a HOLE, and dusk hides holes
  if (CBZ.dayPhase) CBZ.dayPhase(0.5);
  if (CBZ.setWeather) { try { CBZ.setWeather("clear"); } catch (e) {} }
  return { staged: picked.length, marks: marks, cam: window.__cam,
           pedInstance: CBZ.pedInstanceAudit ? CBZ.pedInstanceAudit() : null,
           outfitIntegrity: CBZ.outfitIntegrityAudit ? CBZ.outfitIntegrityAudit() : null };
})()`);
console.log("[lineup]", JSON.stringify(info, null, 1));

await sleep(2500);   // let the pin settle + a few real frames land

/* ---- IS THIS SHOT A LIE? (aimlib.js's rule, applied to a row of people) ----
   Two ways this tool can hand back a confident picture of nothing:
     • a body that some other system dragged off its mark, so the lens is
       framing an empty pavement while every number checked out. PROVE it by
       PROJECTING each body through the live camera — in-frustum or it is not
       in the picture, whatever its coordinates say;
     • a body whose parts are not drawing, which is the fault this tool exists
       to photograph — so it is reported, never silently shot. `drawn` counts a
       mesh as drawing only if it is either on a normal layer or on
       entities/pedinstance.js's hide layer WITH a live instance behind it. */
const check = await evl(`(() => {
  const v = new THREE.Vector3(), mm = new THREE.Matrix4(), HIDE = 1 << 30;
  const rows = (window.__lineupPin || []).map(function (m) {
    m.p.group.updateWorldMatrix(true, false);
    v.setFromMatrixPosition(m.p.group.matrixWorld);
    const ndc = v.clone().project(CBZ.camera);
    let chain = true; for (let n = m.p.group; n; n = n.parent) if (n.visible === false) { chain = false; break; }
    let meshes = 0, dark = 0;
    m.p.group.traverse(function (o) {
      if (!o.isMesh || o.visible === false) return;
      meshes++;
      if (o.layers.mask !== HIDE) return;
      const rec = o._pinst;
      if (rec && !rec.dead && rec.slot >= 0 && !rec.parked && rec.pool && rec.pool.mesh &&
          rec.slot < rec.pool.mesh.count) {
        rec.pool.mesh.getMatrixAt(rec.slot, mm);
        if (Math.hypot(mm.elements[0], mm.elements[1], mm.elements[2]) > 1e-4) return;
      }
      dark++;                                   // hidden by the instancer, nothing carrying it
    });
    return {
      name: m.name, offMark: +v.distanceTo(new THREE.Vector3(m.x, m.y, m.z)).toFixed(2),
      inFrame: Math.abs(ndc.x) < 1 && ndc.z < 1 && chain,
      meshes: meshes, undrawn: dark,
    };
  });
  return {
    staged: rows.length,
    offMark: rows.filter(function (r) { return r.offMark > 1; }).length,
    outOfFrame: rows.filter(function (r) { return !r.inFrame; }).length,
    bodiesWithUndrawnParts: rows.filter(function (r) { return r.undrawn > 0; }).length,
    rows: rows,
  };
})()`);
console.log("[lineup] frame check", JSON.stringify(check));
if (check && check.outOfFrame) console.log("[lineup] WARNING: " + check.outOfFrame + "/" + check.staged + " staged bodies are NOT in frame — this picture is not evidence about them.");
if (check && check.bodiesWithUndrawnParts) console.log("[lineup] FOUND: " + check.bodiesWithUndrawnParts + " staged bodies have parts the instancer hid and is not drawing.");

// The row is the subject; every overlay in front of it is a place a hole can
// hide. Keep only the element that owns the WebGL canvas.
await evl(`(() => {
  const cv = document.querySelector("canvas");
  const keep = new Set(); for (let n = cv; n; n = n.parentElement) keep.add(n);
  document.querySelectorAll("body > *").forEach(function (e) { if (!keep.has(e)) e.style.display = "none"; });
  return true;
})()`);
await sleep(800);
const shot = await send("Page.captureScreenshot", { format: "png" });
const b64 = shot.result && shot.result.result ? shot.result.result.data : shot.result && shot.result.data;
if (!b64) { console.error("[lineup] no screenshot"); process.exit(1); }
await writeFile(OUT, Buffer.from(b64, "base64"));
console.log("[lineup] wrote", OUT);
try { ws.close(); } catch (_) {}
chrome.kill(); server.kill();
process.exit(0);
