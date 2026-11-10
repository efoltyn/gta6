#!/usr/bin/env node
/* tools/npcwar-ground-shots.mjs — THE BATTLEFIELD, PHOTOGRAPHED. One headless
   Chrome, one map at a time: boots games/battle.html on a map, runs the war a
   few seconds, and shoots the GROUND from the same four lenses on every map,
   so two runs (a before tree and an after tree) can be laid side by side.

     node tools/npcwar-ground-shots.mjs --side before --root /path/to/HEAD-worktree
     node tools/npcwar-ground-shots.mjs --side after                  (this checkout)
     node tools/npcwar-ground-shots.mjs --pairs                       (stitch before|after)

   --maps dunes,snow,...     which grounds (default: every land map)
   --out DIR                 default ~/harness/out/gta6/npcwar-ground
   --n 40                    men a side (default 40)
   --t 12                    sim seconds fought before the shots (default 12)
   --size 1280x800

   Lenses (all through the page's own __battle seam, nothing on the page is
   changed): `field` a low wide look down the axis of the war; `ground` the
   ground at the centre from 14 m; `high` the whole venue from above;
   `feet` the study desk on one red soldier (his feet against the ground). */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchChrome, serve } from "./testbus/browser.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OUT = path.resolve(val("--out", path.join(os.homedir(), "harness/out/gta6/npcwar-ground")));
const SIDE = val("--side", "after");
const ROOT = path.resolve(val("--root", REPO));
const MAPS = val("--maps", "dunes,snow,grass,forest,island,field,city,arena").split(",").filter(Boolean);
const N = +val("--n", 40);
const T = +val("--t", 12);
const [W, H] = val("--size", "1280x800").split("x").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LENSES = [
  { id: "field", js: (c) => `(function(){var B=__battle,c=${JSON.stringify(c)};var g=CBZ.groundAt?CBZ.groundAt(c.x,c.z):0;B.lookAt({x:c.x,y:g,z:c.z,h:1.2,yaw:1.25},62,0.11);return 1})()` },
  { id: "ground", js: (c) => `(function(){var B=__battle,c=${JSON.stringify(c)};var g=CBZ.groundAt?CBZ.groundAt(c.x,c.z):0;B.lookAt({x:c.x,y:g,z:c.z,h:0.6,yaw:0.7},14,0.14);return 1})()` },
  { id: "high", js: (c) => `(function(){var B=__battle,c=${JSON.stringify(c)};var g=CBZ.groundAt?CBZ.groundAt(c.x,c.z):0;B.lookAt({x:c.x,y:g,z:c.z,h:0,yaw:0.5},300,0.72);return 1})()` },
  { id: "feet", js: () => `(function(){var B=__battle;var r=B.camFollow('a:3')||B.camFollow('a');return r?1:0})()` },
];

async function pairs() {
  const bdir = path.join(OUT, "before"), adir = path.join(OUT, "after"), pdir = path.join(OUT, "pairs");
  mkdirSync(pdir, { recursive: true });
  const names = existsSync(adir) ? readdirSync(adir).filter((f) => f.endsWith(".png")) : [];
  const rows = names.map((f) => `<div class="row"><img src="../before/${f}"><img src="../after/${f}"><div class="cap">${f.replace(".png", "")}</div></div>`).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><title>NPC War ground: before | after</title>
<style>body{margin:0;background:#111;color:#ddd;font:14px/1.3 -apple-system,Helvetica,sans-serif}.row{position:relative;display:flex;gap:4px;padding:4px}.row img{width:50%;display:block}.cap{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.6);padding:2px 8px;border-radius:4px}h1{margin:12px;font-size:16px}</style>
<h1>NPC War — the battlefield, before (left) and after (right). ${names.length} frames.</h1>${rows}`;
  writeFileSync(path.join(pdir, "index.html"), html);
  // stitch each pair into one PNG through Chrome, so the owner can open a file
  const srv = await serve(OUT);
  const browser = await launchChrome();
  try {
    const pg = await browser.newPage();
    await pg.send("Emulation.setDeviceMetricsOverride", { width: W * 2 + 12, height: H + 8, deviceScaleFactor: 1, mobile: false });
    for (const f of names) {
      const page = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000}img{width:${W}px;height:${H}px;display:inline-block;vertical-align:top}.b{position:absolute;top:6px;color:#fff;font:bold 20px Helvetica;background:rgba(0,0,0,.55);padding:4px 10px}</style>
<img src="before/${f}"><img src="after/${f}" style="margin-left:12px"><div class="b" style="left:10px">BEFORE ${f}</div><div class="b" style="left:${W + 22}px">AFTER</div>`;
      writeFileSync(path.join(OUT, "_pair.html"), page);
      await pg.send("Page.navigate", { url: srv.origin + "_pair.html" });
      await sleep(600);
      const shot = await pg.send("Page.captureScreenshot", { format: "png" }, 60000);
      if (shot.result && shot.result.data) writeFileSync(path.join(pdir, f), Buffer.from(shot.result.data, "base64"));
      console.log("pair " + f);
    }
  } finally { await browser.close(); srv.close(); }
  console.log(path.join(pdir, "index.html"));
}

async function shoot() {
  const dir = path.join(OUT, SIDE);
  mkdirSync(dir, { recursive: true });
  const srv = await serve(ROOT);
  const browser = await launchChrome();
  console.log(`chrome pid ${browser.pid} on :${browser.dbg}; serving ${ROOT}`);
  const log = [];
  try {
    for (const map of MAPS) {
      const t0 = Date.now();
      const pg = await browser.newPage();
      await pg.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
      const url = `${srv.origin}games/battle.html?auto=1&arena=${map}&a=men&b=men&n=${N}v${N}&killcam=0&red=1&blue=1&seed=7`;
      await pg.send("Page.navigate", { url });
      const q = (e) => pg.evl(`(function(){try{return !!(${e})}catch(e){return false}})()`, 60000).catch(() => false);
      const until = Date.now() + 12 * 60e3;
      let ok = false;
      while (Date.now() < until && !ok) { ok = await q("window.__battle && __battle.audit().started"); if (!ok) await sleep(500); }
      if (!ok) { console.log(`${map}: never started; errors: ${pg.errors.slice(0, 4).join(" | ")}`); await pg.closeTarget(); continue; }
      await pg.evl("__battle.freeze()", 60000);
      await pg.evl(`__battle.advance(${T}, 1/60)`, 9 * 60e3);
      const c = await pg.evl("__battle.mapCentre()", 60000);
      const audit = await pg.evl("(function(){var a=__battle.audit();return {relief:a.relief,cover:a.cover,dress:a.dress,ground:a.ground,calls:a.calls,tris:a.tris}})()", 60000).catch(() => null);
      for (const L of LENSES) {
        try {
          await pg.evl(L.js(c), 60000);
          await pg.evl("__battle.advance(1/60, 1/60); __battle.render(); 1", 120000);
          await pg.evl("__battle.render(); 1", 120000);
          const shot = await pg.send("Page.captureScreenshot", { format: "png" }, 180000);
          if (shot.result && shot.result.data) writeFileSync(path.join(dir, `${map}-${L.id}.png`), Buffer.from(shot.result.data, "base64"));
        } catch (e) { console.log(`${map}/${L.id}: ${e.message}`); }
      }
      const line = `${map}: ${((Date.now() - t0) / 1000).toFixed(0)} s, errors ${pg.errors.length}${pg.errors.length ? " [" + pg.errors.slice(0, 3).join(" | ") + "]" : ""} ${audit ? JSON.stringify(audit) : ""}`;
      console.log(line); log.push(line);
      await pg.closeTarget();
    }
  } finally {
    await browser.close(); srv.close();
  }
  writeFileSync(path.join(dir, "log.txt"), log.join("\n") + "\n");
  console.log(dir);
}

if (has("--pairs")) await pairs(); else await shoot();
