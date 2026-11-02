#!/usr/bin/env node
/*
  tools/people/wardrobe-look.mjs — every outfit in the game, worn by the
  Blender people (or the procedural body), photographed one person at a time.
  The lab's "humans" kit builds the cast on the shipped rigs; this films a
  full-length frame and a chest-up frame of each, then lays them out as one
  labelled contact sheet.

    node tools/people/wardrobe-look.mjs --set uniforms --out DIR [--label after]
    node tools/people/wardrobe-look.mjs --cast "m-average-3-driver-44,f-slim-1-police-30" --out DIR
  Options: --skinned 0|1 (default 1)  --shots full,chest  --cols 8
           --atlas  also dump each outfit's painted atlas (city/clothes.js, 4x)
           --params 'k=v&...'  extra kit params (arms=walk ...)
  A cast entry is the humans kit's own: sex-physique-skin-outfit[-age][~hair][^beard]
*/
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launchChrome, serve } from "../testbus/browser.mjs";
import { buildManifest } from "../lab/deps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null && !a[i + 1].startsWith("--") ? a[i + 1] : d; };
const flag = (k) => a.includes(k);

/* THE SETS. "uniforms" is every catalog outfit a painter draws (city/clothes.js
   PAINT) on a body that would wear it: the women's cuts on women, the kids'
   clothes on a nine-year-old, the rest alternating men and women so both cuts
   of every uniform are seen. */
const SETS = {
  uniforms: [
    "m-average-3-driver-44~short", "f-average-1-police-31~bun", "m-muscular-5-police-36~buzz", "m-average-2-security-40~crop",
    "f-slim-4-scrubs-29~pony", "m-average-1-doctor-55~short^moustache", "f-average-6-ems-34~bun", "m-muscular-2-firefighter-38~buzz",
    "m-average-7-soldier-26~buzz", "f-slim-2-soldier-27~bun", "m-heavy-3-construction-45~crop^full", "m-average-0-hivis-33~short",
    "m-heavy-1-chef-50~crop", "f-slim-3-waiter-24~pony", "m-average-5-mailman-47~short", "f-average-0-pilot-39~bun",
    "m-slim-6-janitor-58~crop^goatee", "m-slim-2-valet-23~short", "m-heavy-4-busdriver-52~crop", "m-average-6-coveralls-35~buzz",
    "m-average-0-hunter-48~short^full", "f-average-3-ranger-33~pony", "m-slim-1-hiker-29~short", "m-heavy-0-farmer-61~crop^full",
    "m-average-2-fisherman-57~short^full", "m-muscular-4-mariner-42~buzz", "f-slim-0-lifeguard-22~long", "m-average-3-ski_patrol-30~short",
    "m-average-7-groundcrew-37~buzz", "f-slim-1-cabincrew-28~bun", "m-slim-3-bartender-31~short^goatee", "f-average-5-housekeeping-44~bun",
    "m-muscular-6-athletic-24~buzz", "m-average-1-pitcrew-29~short", "m-slim-2-racer-27~short", "m-average-4-marshal-49~crop",
    "m-average-6-inmate-33~buzz", "m-muscular-1-inmate_tank-28~buzz", "m-average-3-corrections-41~crop", "m-heavy-5-sheriff-53~crop^moustache",
    "m-average-2-detective-46~short", "m-muscular-7-swat-34~buzz", "m-average-1-office-38~short", "f-average-4-office-35~bob",
    "m-average-0-exec_navy-50~crop", "f-slim-6-exec_navy-42~afro", "m-slim-3-tuxedo-36~short", "m-average-5-vendor-44~short^stubble",
    "f-slim-2-dress-26~long", "f-average-7-sundress-31~curly", "f-average-1-blouse-37~bob", "m-average-4-tracksuit-22~buzz",
    "m-slim-5-hoodie-19~short", "m-muscular-3-wifebeater-30~buzz^stubble", "m-average-6-puffer-27~short", "m-average-2-denim_jacket-33~crop",
    "m-slim-0-varsity-20~short", "m-average-1-leather-41~crop^stubble", "f-slim-3-designer-30~long", "m-muscular-2-tactical-35~buzz^full",
    "m-average-5-homeless-60~long^full", "m-average-4-school-11~short", "f-average-2-schoolgirl-10~pony", "m-average-6-kidtee-9~short",
  ],
};
const cast = arg("--cast") ? arg("--cast").split(",") : SETS[arg("--set", "uniforms")];
if (!cast) throw new Error("no cast: --set " + Object.keys(SETS).join("|") + " or --cast ...");
const SK = arg("--skinned", "1"), LABEL = arg("--label", ""), COLS = +arg("--cols", 8);
const SHOTS = arg("--shots", "full,chest").split(",");
const OUT = path.resolve(arg("--out", path.join(os.tmpdir(), "wardrobe-look")));
mkdirSync(OUT, { recursive: true });
const GAP = 1.7;
// full length: 2 m of frame at 3.4 m; chest-up: the torso and the head
const CAM = {
  full: { w: 300, h: 520, cam: (x) => ({ p: [x, 1.0, 3.6], l: [x, 0.93, 0], fov: 33 }) },
  chest: { w: 300, h: 360, cam: (x) => ({ p: [x + 0.05, 1.42, 1.25], l: [x, 1.3, 0], fov: 33 }) },
};

buildManifest();
const srv = await serve(ROOT);
const B = await launchChrome();
const files = [];
try {
  const pg = await B.newPage();
  const u = new URL("lab.html", srv.origin);
  u.searchParams.set("kit", "humans");
  u.searchParams.set("cast", cast.join(","));
  u.searchParams.set("gap", String(GAP));
  u.searchParams.set("skinned", SK);
  for (const [k, v] of new URLSearchParams(arg("--params", ""))) if (k) u.searchParams.set(k, v);
  await pg.send("Emulation.setDeviceMetricsOverride", { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
  await pg.send("Page.navigate", { url: u.href });
  let ready = null;
  for (let i = 0; i < 1200 && !ready; i++) {
    ready = await pg.evl("window.__lab && __lab.boot ? { ready: __lab.ready, error: __lab.error } : null", 30e3).catch(() => null);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready || !ready.ready) throw new Error("lab did not boot: " + JSON.stringify(ready) + " " + pg.errors.slice(0, 5).join(" | "));
  for (let i = 0; i < 1800; i++) {
    const busy = await pg.evl("(() => { const W = __lab.W || __lab.world; return !!(W && W.busy && W.busy()); })()", 30e3).catch(() => false);
    if (!busy) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await pg.evl("__lab.runTo(1.0)", 300e3);
  const probe = await pg.evl("__lab.probe()", 60e3).catch((e) => ({ summary: String(e) }));
  console.error("probe:", probe && probe.summary);
  const n = cast.length;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * GAP;
    const row = { id: cast[i], shots: {} };
    for (const s of SHOTS) {
      const C = CAM[s], c = C.cam(x);
      const at = "at:" + c.p.map((v) => v.toFixed(3)).join(",") + ":" + c.l.map((v) => v.toFixed(3)).join(",");
      const r = await pg.evl(`(() => { CBZ.camera.fov = ${c.fov}; return __lab.capture(${JSON.stringify(at)}, ${C.w}, ${C.h}, "image/png"); })()`, 120e3);
      if (!r || !r.url) { console.error("  no frame", cast[i], s, JSON.stringify(r).slice(0, 160)); continue; }
      const f = path.join(OUT, `${String(i).padStart(2, "0")}-${cast[i].replace(/[^\w]+/g, "_")}-${s}.png`);
      writeFileSync(f, Buffer.from(r.url.split(",")[1], "base64"));
      row.shots[s] = f;
    }
    if (flag("--atlas")) {
      const r = await pg.evl(`(() => {
        const W = __lab.W || __lab.world, ch = W.rigs[${i}].ch, w = CBZ.cityClothesWorn && CBZ.cityClothesWorn(ch);
        if (!w) return null;
        const h = CBZ.cityClothesHiRes(w.key, 4, true);
        return { key: w.key, parts: w.set.parts, c: w.set.c, bodyHex: w.set.bodyHex, url: h && h.canvas ? h.canvas.toDataURL("image/png") : null };
      })()`, 60e3).catch((e) => ({ err: String(e) }));
      if (r && r.url) {
        const f = path.join(OUT, `${String(i).padStart(2, "0")}-${cast[i].replace(/[^\w]+/g, "_")}-atlas.png`);
        writeFileSync(f, Buffer.from(r.url.split(",")[1], "base64"));
        row.atlas = f; row.key = r.key; row.parts = r.parts; row.c = r.c;
      }
    }
    files.push(row);
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  writeFileSync(path.join(OUT, "cast.json"), JSON.stringify({ label: LABEL, skinned: SK, probe: probe && probe.summary, errors: pg.errors.slice(0, 10), rows: files }, null, 1));
  // the sheet: one column per person, the shots stacked, a label under each
  const py = `
import json, sys
from PIL import Image, ImageDraw
J = json.load(open(sys.argv[1])); rows = J["rows"]; cols = int(sys.argv[3]); shots = sys.argv[4].split(",")
dims = {"full": (300, 520), "chest": (300, 360)}
cw = 300; ch = sum(dims[s][1] for s in shots) + 34
n = len(rows); R = (n + cols - 1) // cols
head = 44 if J.get("label") else 0
sheet = Image.new("RGB", (cols * cw, R * ch + head), (22, 22, 26))
d = ImageDraw.Draw(sheet)
if head: d.text((10, 12), J["label"], fill=(240, 240, 240))
for i, r in enumerate(rows):
    x, y = (i % cols) * cw, head + (i // cols) * ch
    for s in shots:
        f = r["shots"].get(s)
        if f: sheet.paste(Image.open(f).convert("RGB"), (x, y))
        y += dims[s][1]
    d.text((x + 6, y + 4), r["id"][:44], fill=(235, 235, 235))
    if r.get("key"): d.text((x + 6, y + 18), "atlas " + str(r["key"])[:40], fill=(150, 150, 150))
sheet.save(sys.argv[2]); print(sys.argv[2], sheet.size)
`;
  const r = spawnSync("python3", ["-c", py, path.join(OUT, "cast.json"), path.join(OUT, "sheet.png"), String(COLS), SHOTS.join(",")], { encoding: "utf8" });
  console.log(r.stdout.trim() || r.stderr);
  if (pg.errors.length) console.error("page errors:", pg.errors.slice(0, 5).join(" | "));
} finally {
  await B.close().catch(() => {});
  srv.close && srv.close();
}
