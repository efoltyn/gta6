#!/usr/bin/env node
/* systems/digsite.js — ground you can take away a bucket at a time.
 *
 * Every other hole in this game is authored: something decides a shaft, a
 * crater, a room or a tunnel belongs somewhere. Mining has no author, so the
 * ground itself has to be editable. The claims:
 *
 *   1. DIGGING LOWERS THE GROUND. floorAt drops where the bucket went and is
 *      untouched a few metres away.
 *   2. WHAT YOU SEE IS WHAT YOU STAND ON. A ray straight down onto the dug
 *      surface lands where floorAt says the floor is. This is the invariant the
 *      whole session has been about — the picture and the physics agreeing.
 *   3. IT IS A CUT, NOT A DENT. Vertical side faces exist at the hole's edge. A
 *      heightfield without skirts ramps to its neighbour, and the reference is
 *      a hole with walls.
 *   4. IT HAS A FLOOR. Digging cannot pass DIG_MAX_DEPTH.
 *   5. RE-MESHING IS BOUNDED. Only touched chunks rebuild, and within budget.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DUMP = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 10280 + Math.floor(Math.random() * 120);
const debugPort = 12000 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-dig-${debugPort}`;
function findChrome() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                   "/opt/pw-browsers/chromium/chrome-linux/chrome",
                   "/usr/bin/chromium", "/usr/bin/google-chrome"]) if (existsSync(c)) return c;
  const pw = "/opt/pw-browsers";
  if (existsSync(pw)) for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium")).sort().reverse()) {
    for (const leaf of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const c = path.join(pw, d, leaf); if (existsSync(c)) return c;
    }
  }
  return "chromium";
}
const base = `http://127.0.0.1:${serverPort}/?seed=90210`;
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore" });
const chrome = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=900,600", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 300000);
    pending.set(id, { resolve, reject, timer: t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = m && m.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval failed");
  return r && r.result && r.result.value;
}
const json = async (e) => JSON.parse(await evaluate(`JSON.stringify((function(){${e}})())`));

try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = list.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${serverPort}/`));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      const t = m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "";
      if (!/ProgressEvent/.test(t)) browserErrors.push(t.slice(0, 200));
      return;
    }
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
  });
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 220; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.buildDigSite)")) break;
    await sleep(250);
  }

  const failures = [];
  const r = await json(`
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    var step = function (s) { var n = Math.round(s * 60); for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); } };
    step(3);
    /* Find flat ground the way every other hole in this game finds it, rather
       than typing a coordinate and hoping: a dig site is refused on a slope. */
    var A = CBZ.surv.arena, cx = null, cz = null, s = null;
    for (var t = 0; t < 400 && !s; t++) {
      var ang = t * 2.399, rad = 8 + (t % 40) * 2.4;
      var tx = A.center.x + Math.cos(ang) * rad, tz = A.center.z + Math.sin(ang) * rad;
      if (!CBZ.groundShaftCanOpen(tx, tz, 26).ok) continue;
      s = CBZ.buildDigSite(tx, tz, { span: 48, cell: 1.0, maxDepth: 12 });
      if (s) { cx = tx; cz = tz; }
    }
    if (!s) return { err: "no flat site found for a dig grid: " + JSON.stringify(CBZ.digAudit()) };
    var surf = s.surf;
    var before = CBZ.floorAt(cx, cz);

    // 1: dig a pit with repeated bites, as a tool would
    for (var b = 0; b < 22; b++) CBZ.digAt(cx, cz, 4.0, 0.8);
    var after = CBZ.floorAt(cx, cz);
    var away  = CBZ.floorAt(cx + 16, cz + 16);
    var awayGrade = CBZ.groundBaseAt(cx + 16, cz + 16);

    // 4: it has a floor
    for (var b2 = 0; b2 < 60; b2++) CBZ.digAt(cx, cz, 4.0, 1.2);
    var bottomed = CBZ.floorAt(cx, cz);

    // 2: the drawn surface and the floor query must agree
    var rc = new THREE.Raycaster(new THREE.Vector3(cx, surf + 40, cz), new THREE.Vector3(0, -1, 0), 0, 200);
    if (CBZ.camera) rc.camera = CBZ.camera;
    var hits = rc.intersectObject(s.grp, true) || [];
    var drawnY = hits.length ? hits[0].point.y : null;
    var agree = drawnY == null ? null : +Math.abs(drawnY - CBZ.floorAt(cx, cz)).toFixed(3);

    // sample the agreement across the whole pit, not just its centre
    var worstAgree = 0, sampled = 0, missing = 0;
    for (var q = 0; q < 40; q++) {
      var ang = (q / 40) * Math.PI * 2, rad = 1 + (q % 4);
      var sx = cx + Math.cos(ang) * rad, sz = cz + Math.sin(ang) * rad;
      var rc2 = new THREE.Raycaster(new THREE.Vector3(sx, surf + 40, sz), new THREE.Vector3(0, -1, 0), 0, 200);
      if (CBZ.camera) rc2.camera = CBZ.camera;
      var h2 = rc2.intersectObject(s.grp, true) || [];
      if (!h2.length) { missing++; continue; }
      sampled++;
      worstAgree = Math.max(worstAgree, Math.abs(h2[0].point.y - CBZ.floorAt(sx, sz)));
    }

    // 3: vertical faces exist — count near-horizontal normals vs near-vertical
    var vert = 0, horiz = 0;
    s.grp.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.normal) return;
      var N = o.geometry.attributes.normal.array;
      for (var i = 0; i < N.length; i += 3) {
        if (Math.abs(N[i + 1]) > 0.9) horiz++;
        else if (Math.abs(N[i + 1]) < 0.25) vert++;
      }
    });

    var aud = CBZ.digAudit();
    // frame it
    /* The camera is parented to a rig that follows the PLAYER, so a local
       position set while he is across the island lands nowhere near the pit.
       Put him at the rim first; then the rig is here and the framing means
       what it says. */
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.set(cx + 7, CBZ.floorAt(cx + 7, cz + 7) + 1.2, cz + 7);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
      step(0.4);
    }
    var c = CBZ.camera;
    var want = new THREE.Vector3(cx + 7, surf + 5.5, cz + 7);
    if (c.parent) { c.parent.updateMatrixWorld(true); c.position.copy(c.parent.worldToLocal(want.clone())); }
    else c.position.copy(want);
    c.aspect = 900/600; c.fov = 70; c.near = 0.3; c.far = 20000;
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    c.lookAt(new THREE.Vector3(cx, surf - 9, cz));
    if (CBZ.skySync) CBZ.skySync();
    var cv = CBZ.renderer.domElement;
    for (var w = 0, ch = Array.prototype.slice.call(document.body.children); w < ch.length; w++) {
      if (ch[w] === cv || (cv && ch[w].contains && ch[w].contains(cv))) continue;
      ch[w].style.visibility = "hidden";
    }
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}

    return { surf: surf, before: before, after: after, away: away, awayGrade: awayGrade, bottomed: bottomed,
             drawnY: drawnY, agree: agree, worstAgree: +worstAgree.toFixed(3), sampled: sampled, missing: missing,
             vert: vert, horiz: horiz, audit: aud, maxDepth: s.maxDepth };`);

  if (r.err) failures.push(r.err);
  else {
    if (!(Math.abs(r.before - r.surf) < 0.3)) failures.push(`an undug site reads ${r.before} against a grade of ${r.surf} — more than the one-cell quantisation the flat-cell grid allows`);
    if (!(r.after < r.surf - 3)) failures.push(`digging barely moved the ground: ${r.surf} -> ${r.after}`);
    if (!(Math.abs(r.away - r.awayGrade) < 0.3)) failures.push(`ground 16 m from the bite reads ${r.away} but its grade is ${r.awayGrade} — the bite is not local, or the site does not match the terrain it replaced`);
    if (r.drawnY == null) failures.push("a ray straight down hit no dug surface at all — there is nothing drawn to stand on");
    if (r.agree != null && !(r.agree < 0.2)) failures.push(`what is DRAWN and what floorAt answers differ by ${r.agree} m at the centre`);
    if (r.missing > 2) failures.push(`${r.missing}/40 samples over the pit hit no drawn surface`);
    if (!(r.worstAgree < 0.35)) failures.push(`drawn vs floorAt differ by up to ${r.worstAgree} m across the pit — the picture and the physics disagree`);
    if (!(r.vert > 0)) failures.push("no vertical faces in the dug mesh — this is a dent, not a cut");
    /* Not a RATIO against the whole site: 48x48 undug cells are all horizontal
       by design, so a ratio test measures the site's size, not its walls. A pit
       4 m across has a rim of order a hundred vertices; demand a real ring. */
    if (!(r.vert > 40)) failures.push(`only ${r.vert} vertical-face vertices around the pit — the walls are barely there`);
    if (!(r.bottomed > r.surf - r.maxDepth - 0.5)) failures.push(`digging went past the site floor: ${r.bottomed} below a limit of ${r.surf - r.maxDepth}`);
    /* The budget belongs on the DIG flush — one to four chunks, mid-swing —
       not on the initial build, which re-meshes the whole site once at load. */
    if (!(r.audit.worstDigFlushMs < 40)) failures.push(`a dig re-meshed in ${r.audit.worstDigFlushMs} ms — that is a hitch while digging`);
    if (!(r.audit.worstChunkMs < 40)) failures.push(`a single chunk took ${r.audit.worstChunkMs} ms to re-mesh`);
  }
  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 3).join(" | ")}`);

  if (!r.err) {
    const png = await send("Page.captureScreenshot", { format: "png" });
    const { writeFile, mkdir: mk } = await import("node:fs/promises");
    await mk(path.join(ROOT, "tools/shots/dig-qa"), { recursive: true });
    await writeFile(path.join(ROOT, "tools/shots/dig-qa/pit.png"), Buffer.from(png.result.data, "base64"));
  }
  console.log(JSON.stringify({ r, failures }, null, 2));
  if (failures.length) {
    console.error(`\nDIG CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 2;
  } else console.error(`\nDIG CHECK PASSED — dug ${(r.surf - r.after).toFixed(1)} m, drawn and walked agree within ${r.worstAgree} m across the pit, ${r.vert} vertical faces, floor held at ${r.maxDepth} m, worst re-mesh ${r.audit.worstRemeshMs} ms.`);
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
