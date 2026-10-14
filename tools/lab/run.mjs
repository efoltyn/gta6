#!/usr/bin/env node
/* tools/lab/run.mjs — run one lab kit in headless Chrome (SwiftShader, no GPU)
   and print numbers. The standalone door: no shot service, no testbus, one
   Chrome (borrowed from the shot pool when it is up, else launched).

     node tools/lab/run.mjs --kit person-chair                 boot + run the kit's script + probe
     node tools/lab/run.mjs --kit building --params 'style=brick&lot=corner'
     node tools/lab/run.mjs --kit car-chair --frames 0,1,2,3 --cam side   + a contact sheet
     node tools/lab/run.mjs --all                              every kit: boot ms, scripts, verdict
     node tools/lab/run.mjs --kit standoff --json              the whole probe as JSON
     node tools/lab/run.mjs --kit person-chair --boot-only     just the boot (ms, scripts, errors)

   --keep leaves the Chrome up and reuses it next time (state in os.tmpdir()),
   which is how a builder iterates: ~0.3-1 s a run after the first.
   --seconds N runs N sim seconds instead of the kit's duration.
   Exit 0 when the probe says ok, 1 when it says not, 2 on a boot failure. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchChrome, attachChrome, serve } from "../testbus/browser.mjs";
import { buildManifest, listKits } from "./deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null ? a[i + 1] : d; };
const flag = (k) => a.includes(k);
const KEEP = path.join(os.tmpdir(), "cbz-lab-chrome.json");

async function chrome() {
  if (flag("--keep") && existsSync(KEEP)) {
    try { const s = JSON.parse(readFileSync(KEEP, "utf8")); process.kill(s.pid, 0); return { B: await attachChrome(s.dbg, s.pid), borrowed: true }; } catch (_) { try { unlinkSync(KEEP); } catch (_) {} }
  }
  // the shot service's pool, when it is up: one browser pool per machine
  try {
    const st = JSON.parse(readFileSync(path.join(os.homedir(), "harness/out/gta6/testbus/shot/status.json"), "utf8"));
    const c = (st.chromes || []).find((x) => x && x.dbg && !x.busy);
    if (c && st.pid) { process.kill(st.pid, 0); return { B: await attachChrome(c.dbg, c.pid), borrowed: true }; }
  } catch (_) {}
  const B = await launchChrome();
  if (flag("--keep")) writeFileSync(KEEP, JSON.stringify({ dbg: B.dbg, pid: B.pid }));
  return { B, borrowed: false, launchMs: B.startMs };
}

export async function runKit(B, origin, kit, opts = {}) {
  const pg = await B.newPage();
  const t0 = Date.now();
  try {
    const u = new URL("lab.html", origin);
    u.searchParams.set("kit", kit);
    for (const [k, v] of new URLSearchParams(opts.params || "")) u.searchParams.set(k, v);
    await pg.send("Page.navigate", { url: u.href });
    let ready = null;
    for (let i = 0; i < 600; i++) {
      ready = await pg.evl("window.__lab && __lab.boot ? {ready: __lab.ready, error: __lab.error} : null", 30e3).catch(() => null);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const wallBootMs = Date.now() - t0;
    const boot = await pg.evl("__lab.boot", 30e3).catch(() => null);
    const out = { kit, params: opts.params || "", wallBootMs, boot, ready: !!(ready && ready.ready), error: ready ? ready.error : "no __lab after 30 s", pageErrors: pg.errors.slice(0, 12) };
    if (!out.ready || opts.bootOnly) return out;
    const tr = Date.now();
    const secs = opts.seconds != null ? +opts.seconds : await pg.evl("(__lab.kit && __lab.kit.duration) || 5");
    const frames = [];
    const want = (opts.frames || []).map(Number).sort((x, y) => x - y);
    const cams = opts.cams || ["3q"];
    for (const ft of want) {
      if (ft > secs) break;
      await pg.evl(`__lab.runTo(${ft})`, 120e3);
      for (const cam of cams) {
        const r = await pg.evl(`__lab.capture(${JSON.stringify(cam)}, ${opts.W || 640}, ${opts.H || 400}, ${JSON.stringify(opts.mime || "image/jpeg")})`, 120e3);
        frames.push({ t: ft, cam, url: r && r.url, error: r && r.error });
      }
    }
    await pg.evl(`__lab.runTo(${secs})`, 300e3);
    out.simSeconds = secs;
    out.simWallMs = Date.now() - tr;
    out.probe = await pg.evl("__lab.probe()", 60e3);
    out.frames = frames;
    out.pageErrors = pg.errors.slice(0, 12);
    return out;
  } finally { await pg.closeTarget(); }
}

function fmtEvents(ev, max = 40) {
  return (ev || []).slice(0, max).map((e) => `  ${String(e.t.toFixed(2)).padStart(6)} s  ${e.who}: ${e.what}`).join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildManifest();                          // a stale manifest would load the wrong scripts
  const kits = flag("--all") ? listKits() : [arg("--kit", "person-chair")];
  const srv = await serve(ROOT);
  const { B, borrowed, launchMs } = await chrome();
  const results = [];
  let code = 0;
  try {
    for (const kit of kits) {
      const frames = arg("--frames") ? arg("--frames").split(",") : [];
      const r = await runKit(B, srv.origin, kit, {
        params: arg("--params", ""), seconds: arg("--seconds"), bootOnly: flag("--boot-only"),
        frames, cams: (arg("--cam", "3q")).split(","), W: 640, H: 400,
      });
      results.push(r);
      if (r.frames && r.frames.length) {
        const dir = arg("--out", path.join(os.homedir(), "harness/out/gta6/lab", kit + "-" + Date.now().toString(36)));
        mkdirSync(dir, { recursive: true });
        r.files = r.frames.filter((f) => f.url).map((f) => { const p = path.join(dir, `t${String(f.t).replace(".", "_")}-${f.cam.replace(/[^\w]+/g, "_")}.jpg`); writeFileSync(p, Buffer.from(f.url.split(",")[1], "base64")); return p; });
        r.frames = r.frames.map((f) => ({ t: f.t, cam: f.cam, error: f.error }));
        r.dir = dir;
      }
      if (!r.ready) code = Math.max(code, 2);
      else if (r.probe && !r.probe.ok && !flag("--boot-only")) code = Math.max(code, 1);
    }
  } finally {
    srv.close();
    // a borrowed Chrome: close only our pages; a launched one: close it unless --keep
    if (borrowed || !flag("--keep")) await B.close().catch(() => {});
  }
  if (flag("--json")) { console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 1)); process.exit(code); }
  if (launchMs) console.log(`chrome launched in ${launchMs} ms (SwiftShader)`);
  for (const r of results) {
    const b = r.boot || {};
    console.log(`\n== ${r.kit}${r.params ? " [" + r.params + "]" : ""}: ${r.ready ? "READY" : "FAILED"}  boot ${b.ms} ms in page (${r.wallBootMs} ms wall, nav->ready ${b.sincePageStart} ms)  ${b.scripts} scripts (${b.traced} traced) of ${b.indexCount}`);
    if (b.phases) console.log(`   phases ${JSON.stringify(b.phases)}  mode ${b.mode}`);
    if (r.error) console.log("   ERROR " + r.error);
    if (b.loadErrors && b.loadErrors.length) console.log("   load errors:\n     " + b.loadErrors.slice(0, 12).join("\n     "));
    if (b.missing && b.missing.length) console.log("   unresolved symbols: " + b.missing.join(", "));
    if (r.pageErrors && r.pageErrors.length) console.log("   page errors:\n     " + r.pageErrors.slice(0, 8).join("\n     "));
    if (r.probe) {
      console.log(`   ran ${r.simSeconds} sim s in ${r.simWallMs} ms  ->  ${r.probe.ok ? "OK" : "NOT OK"}: ${r.probe.summary}`);
      if (flag("-v") || !r.probe.ok) console.log(fmtEvents(r.probe.events, flag("-v") ? 200 : 40));
      if (r.probe.errors && r.probe.errors.length) console.log("   runtime errors:\n     " + r.probe.errors.slice(0, 8).join("\n     "));
    }
    if (r.files) console.log("   frames: " + r.dir);
  }
  process.exit(code);
}
