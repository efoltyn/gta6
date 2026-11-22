/* tools/citymap/dump.mjs: boot Gang City headless and write what it really built
   (regions, road records, highways, water, a terrain + water + biome grid, every
   planned metro building and street, standing colliders) to map.json.
   Then: python3 tools/citymap/render.py [metres per pixel]
         ->  map-full.png, map-small.jpg, map-problems.jpg, problems.txt
   The map is drawn from what the game BUILT, not from what a plan says, so a
   building in the water or a house on a highway shows as exactly that.

   The WHOLE continent is built (?stream=0): a streamed boot replays far places
   from src/city/slice_manifest.js, which is a record of an older layout the
   moment anything moves. CITYMAP_STREAM=1 dumps the streamed boot instead (to
   see what a player's boot holds). CITYMAP_OUT=/dir/ picks the output folder. */
import { launch } from "../lib/cdp.mjs";
import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)) + "/";
const out = (process.env.CITYMAP_OUT || "/Users/elifoltyn/harness/out/gta6/citymap/");
fs.mkdirSync(out, { recursive: true });
const stream = process.env.CITYMAP_STREAM === "1";
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open("index.html", "seed=90210" + (stream ? "" : "&stream=0"));
  await rig.wait("window.CBZ && CBZ.game", 300000);
  await rig.wait("(() => { if (CBZ.game.state === 'playing' && CBZ.game.mode === 'city') return true; const mb = document.querySelector('.mode-btn[data-mode=\"city\"]'); if (mb) mb.click(); const pb = document.getElementById('playBtn'); if (pb) pb.click(); return false; })()", 1500000, 400);
  const s = await rig.evl(fs.readFileSync(HERE + "dumpexpr.js", "utf8"));
  if (typeof s !== "string") throw new Error("dump expression returned " + JSON.stringify(s).slice(0, 400));
  fs.writeFileSync(out + "map.json", s);
  const o = JSON.parse(s);
  const nb = o.metros.reduce((a, m) => a + m.b.length, 0);
  console.log("regions", o.regions.length, "roads", o.roads.length, "highways", o.highways.length, "routes", o.net.length,
    "metros", o.metros.length, "planned buildings", nb, "standing", o.foot.length, "of", o.nColliders, "colliders",
    "grid", o.grid.nx, o.grid.nz, "biomes", o.grid.biomes.join(","), "spawn", JSON.stringify(o.spawn), "spawnWet", o.spawnWet,
    o.streamed ? "STREAMED (" + o.skipped.length + " builders skipped)" : "whole world");
  console.log("errors", rig.errors.length, JSON.stringify(rig.errors.slice(0, 6)).slice(0, 900));
} finally { await rig.close(); }
