#!/usr/bin/env node
/*
  tools/strike-look.mjs — storyboards of the strike lab (src/lab/kits/strike.js):
  the B-52 carpet run, the B-2 stick, the cruise-missile salvo, one Mk-84
  into a tower, the nuke. Headless Chrome (SwiftShader), fixed-step sim, so
  every run films the same frames.

    node tools/strike-look.mjs --run carpet  [--beats 2,8,...] [--out DIR]
    node tools/strike-look.mjs --run nuke    [--obs 6000]
    node tools/strike-look.mjs --all         every run, one sheet each
  Common: [--w 960 --h 540] [--params 'k=v&...'] [--label after] [--keep]

  A CAMERA is a function of the kit world (window.__lab's W) and the run's
  live state, evaluated in the page at each beat: it may follow the bomber,
  ride a bomb down, sit on a rooftop across the street. Each run below names
  its beats and its cameras; the sheet is rows = beats, columns = cameras.
  The nuke's flash is a DOM layer over the canvas (city/nukefx.js); a frame
  composites it the way the screen does.
*/
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchChrome, serve } from "./testbus/browser.mjs";
import { buildManifest } from "./lab/deps.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null && !a[i + 1].startsWith("--") ? a[i + 1] : d; };
const flag = (k) => a.includes(k);
const W = +arg("--w", 960), H = +arg("--h", 540);
const LABEL = arg("--label", "");

/* ---- the runs: beats (sim seconds) and cameras ------------------------------
   Camera strings are JS evaluated in the page with W (the kit world), S
   (CBZ.strikeFX.state() or null), N (CBZ.nukeFxDebug().live or null) in
   scope; they return { p:[x,y,z], l:[x,y,z], fov }. */
const RUNS = {
  carpet: {
    beats: [3, 9, 14, 17, 19, 21, 24, 28, 34, 44],
    seconds: 46,
    cams: {
      "street, under the run": `({ p: [-W.half - 8, 1.7, -80], l: [0, 220, -26], fov: 62 })`,
      "rooftop, across the river": `({ p: [W.half + 260, 46, 300], l: [0, 30, -26], fov: 42 })`,
      "chase, beside the bomber": `S && S.bomber ? { p: [S.bomber.x - 120, S.bomber.y - 22, S.bomber.z + 160], l: [S.bomber.x + 60, S.bomber.y - 260, S.bomber.z], fov: 50 } : { p: [-W.half - 600, 800, 200], l: [0, 0, 0], fov: 50 }`,
      "bomb cam, following the stick": `S && S.lead ? { p: [S.lead.x - 40, S.lead.y + 30, S.lead.z + 60], l: [S.lead.x + 10, Math.max(0, S.lead.y - 120), S.lead.z], fov: 55 } : { p: [0, 600, 500], l: [0, 0, -26], fov: 55 }`,
    },
    params: "run=carpet",
  },
  b2: {
    beats: [3, 9, 14, 17, 19, 21, 24, 28, 34, 44],
    seconds: 46,
    cams: {
      "street, under the run": `({ p: [-W.half - 8, 1.7, -80], l: [0, 220, -26], fov: 62 })`,
      "rooftop, across the river": `({ p: [W.half + 260, 46, 300], l: [0, 30, -26], fov: 42 })`,
      "chase, beside the bomber": `S && S.bomber ? { p: [S.bomber.x - 90, S.bomber.y - 18, S.bomber.z + 120], l: [S.bomber.x + 60, S.bomber.y - 220, S.bomber.z], fov: 50 } : { p: [-W.half - 600, 800, 200], l: [0, 0, 0], fov: 50 }`,
      "bomb cam, following the stick": `S && S.lead ? { p: [S.lead.x - 40, S.lead.y + 30, S.lead.z + 60], l: [S.lead.x + 10, Math.max(0, S.lead.y - 120), S.lead.z], fov: 55 } : { p: [0, 600, 500], l: [0, 0, -26], fov: 55 }`,
    },
    params: "run=b2",
  },
  missile: {
    beats: [2, 6, 10, 13, 14.2, 15, 16.2, 18, 22, 30],
    seconds: 32,
    cams: {
      "street corner": `({ p: [W.half + 12, 1.7, W.half + 12], l: [-10, 40, -10], fov: 64 })`,
      "rooftop, 600 m": `({ p: [W.half + 500, 80, -300], l: [0, 20, 0], fov: 40 })`,
      "chase, behind the lead missile": `S && S.missiles && S.missiles[0] && S.missiles[0].alive ? (function(){const m=S.missiles[0];return { p: [m.x - m.dx * 30, m.y + 6 - m.dy * 30, m.z - m.dz * 30], l: [m.x + m.dx * 60, m.y + m.dy * 60, m.z + m.dz * 60], fov: 55 };})() : { p: [W.half + 160, 60, W.half + 160], l: [0, 25, 0], fov: 50 }`,
      "overhead, 1.5 km": `({ p: [300, 1500, 900], l: [0, 0, 0], fov: 38 })`,
    },
    params: "run=missile",
  },
  hit: {
    beats: [12, 13.2, 13.6, 14.3, 15.5, 17, 20, 25, 32, 40],
    seconds: 42,
    cams: {
      "street, 120 m": `({ p: [W.blds[2].cx - 20, 1.7, W.blds[2].cz + 120], l: [W.blds[2].cx, W.blds[2].b.h * 0.6, W.blds[2].cz], fov: 62 })`,
      "rooftop, 500 m": `({ p: [W.blds[2].cx + 420, 70, W.blds[2].cz + 300], l: [W.blds[2].cx, W.blds[2].b.h * 0.5, W.blds[2].cz], fov: 36 })`,
      "aerial, 3/4": `({ p: [W.blds[2].cx - 260, 230, W.blds[2].cz + 220], l: [W.blds[2].cx, W.blds[2].b.h * 0.4, W.blds[2].cz], fov: 45 })`,
    },
    params: "run=hit",
  },
  det: {
    beats: [0.52, 0.6, 0.8, 1.2, 2, 3.5, 4.05, 4.3, 5, 7, 10, 16],
    seconds: 16,
    cams: {
      "street, 90 m": `({ p: [W.blds[2].cx + 90, 1.7, W.blds[2].cz + 40], l: [W.blds[2].cx + 10, 16, W.blds[2].cz], fov: 62 })`,
      "rooftop, 300 m": `({ p: [W.blds[2].cx + 260, 60, W.blds[2].cz - 160], l: [W.blds[2].cx, 18, W.blds[2].cz], fov: 40 })`,
      "street blast, 60 m": `({ p: [-W.half * 0.0 + 30, 1.7, -26 + 50], l: [-26, 8, -24], fov: 62 })`,
    },
    params: "run=det",
  },
  nuke: {
    beats: [0.55, 0.7, 1.5, 3, 6, 12, 25, 45, 90, 180],
    seconds: 181,
    cams: {
      "ground, 6 km": `({ p: [6000 * 0.6, 1.7, 6000 * 0.8], l: [0, (N ? Math.max(500, N.cloudTop * 0.42) : 500), 0], fov: 60 })`,
      "ground, 15 km": `({ p: [-15000 * 0.7, 2, 15000 * 0.71], l: [0, (N ? Math.max(900, N.cloudTop * 0.48) : 900), 0], fov: 42 })`,
      "aerial, 12 km / 2 km up": `({ p: [12000 * 0.9, 2000, -12000 * 0.43], l: [0, (N ? Math.max(500, N.cloudTop * 0.4) : 400), 0], fov: 50 })`,
      "the street, 2 km": `({ p: [1400, 1.7, -1430], l: [0, (N ? Math.max(300, N.cloudTop * 0.35) : 300), 0], fov: 75 })`,
    },
    params: "run=nuke",
  },
};

const want = flag("--all") ? Object.keys(RUNS) : [arg("--run", "carpet")];
const OUT0 = path.resolve(arg("--out", path.join(os.tmpdir(), "strike-look")));
buildManifest();
const srv = await serve(ROOT);
const B = await launchChrome();
const sheets = [];
try {
  for (const run of want) {
    const R = RUNS[run];
    if (!R) throw new Error("no run " + run + " (" + Object.keys(RUNS).join(", ") + ")");
    const beats = arg("--beats") ? arg("--beats").split(",").map(Number) : R.beats;
    const out = path.join(OUT0, run);
    mkdirSync(out, { recursive: true });
    const pg = await B.newPage();
    try {
      const u = new URL("lab.html", srv.origin);
      u.searchParams.set("kit", "strike");
      for (const [k, v] of new URLSearchParams(R.params + "&" + arg("--params", ""))) if (k) u.searchParams.set(k, v);
      await pg.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      await pg.send("Page.navigate", { url: u.href });
      let ready = null;
      for (let i = 0; i < 1200 && !ready; i++) {
        ready = await pg.evl("window.__lab && __lab.boot ? { ready: __lab.ready, error: __lab.error } : null", 30e3).catch(() => null);
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      if (!ready || !ready.ready) throw new Error("lab did not boot: " + JSON.stringify(ready) + " " + pg.errors.slice(0, 5).join(" | "));
      const cells = {};
      const t0 = Date.now();
      for (const bt of beats) {
        await pg.evl(`__lab.runTo(${bt})`, 900e3);
        for (const [cname, expr] of Object.entries(R.cams)) {
          const r = await pg.evl(`(() => {
            const L = __lab, W = L.world || L.W || window.__labW;
            const S = CBZ.strikeFX && CBZ.strikeFX.state ? CBZ.strikeFX.state() : null;
            const N = CBZ.nukeFxDebug ? CBZ.nukeFxDebug().live : null;
            let c; try { c = ${expr}; } catch (e) { return { error: "cam: " + e.message }; }
            const cam = CBZ.camera;
            cam.fov = c.fov || 55;
            const at = "at:" + c.p.map((v) => v.toFixed(2)).join(",") + ":" + c.l.map((v) => v.toFixed(2)).join(",");
            const shot = L.capture(at, ${W}, ${H}, "image/png");
            if (!shot || !shot.url) return shot;
            // the flash layer over the canvas
            const fl = document.getElementById("nukeFlash");
            const op = fl ? +fl.style.opacity || 0 : 0;
            if (op > 0.003) {
              const cv = document.createElement("canvas"); cv.width = ${W}; cv.height = ${H};
              const x = cv.getContext("2d"); x.drawImage(CBZ.renderer.domElement, 0, 0, ${W}, ${H});
              x.globalAlpha = op; x.fillStyle = "#fffaf0"; x.fillRect(0, 0, ${W}, ${H});
              return { url: cv.toDataURL("image/png"), flash: op };
            }
            return { url: shot.url };
          })()`, 300e3);
          if (!r || !r.url) { console.error(`  t=${bt} ${cname}: ${JSON.stringify(r).slice(0, 200)}`); continue; }
          const file = path.join(out, `t${String(bt).replace(".", "_").padStart(5, "0")}-${cname.replace(/[^\w]+/g, "_")}.png`);
          writeFileSync(file, Buffer.from(r.url.split(",")[1], "base64"));
          (cells[bt] = cells[bt] || {})[cname] = file;
        }
        console.error(`${run} t=${bt} (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
      }
      const probe = await pg.evl("__lab.probe()", 60e3).catch((e) => ({ summary: String(e) }));
      const cols = Object.keys(R.cams);
      const man = {
        title: `${run} ${LABEL}`.trim(),
        cols, rows: beats.map((b) => ({ label: `t = ${b} s`, cells: cols.map((c) => (cells[b] || {})[c] || null) })),
        thumb: [480, 270],
        notes: [String(probe && probe.summary || "").slice(0, 220)].concat(pg.errors.slice(0, 3).map((e) => "page: " + String(e).slice(0, 200))),
      };
      const mf = path.join(out, "sheet.json");
      writeFileSync(mf, JSON.stringify(man, null, 1));
      const png = path.join(out, `${run}-sheet.png`);
      const r = spawnSync("python3", [path.join(ROOT, "tools", "contact-sheet.py"), mf, png], { encoding: "utf8" });
      if (r.status !== 0) console.error(r.stderr);
      sheets.push(png);
      console.log(png + "\n  " + (probe && probe.summary));
      if (pg.errors.length) console.log("  page errors: " + pg.errors.slice(0, 6).join("\n    "));
    } finally { await pg.closeTarget(); }
  }
} finally {
  srv.close();
  await B.close().catch(() => {});
}
