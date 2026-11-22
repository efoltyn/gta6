/* tools/citymap/dump.mjs: boot Gang City headless and write its real geometry
   (regions, roads, highways, water, a terrain grid, wall outlines) to map.json.
   Then: python3 tools/citymap/render.py [metres per pixel]  ->  map-full.png, map-small.jpg
   The map is drawn from what the game BUILT, not from what a plan says, so a
   building in the water or a house on a highway shows as exactly that. */
import { launch } from "../lib/cdp.mjs";
import fs from "fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)) + "/";
const out = (process.env.CITYMAP_OUT || "/Users/elifoltyn/harness/out/gta6/citymap/");
fs.mkdirSync(out, { recursive: true });
const rig = await launch({ rafBudget: 1600 });
try {
  await rig.open("index.html", "seed=90210");
  await rig.wait("window.CBZ && CBZ.game", 150000);
  await rig.wait("(() => { if (CBZ.game.state === 'playing' && CBZ.game.mode === 'city') return true; const mb = document.querySelector('.mode-btn[data-mode=\"city\"]'); if (mb) mb.click(); const pb = document.getElementById('playBtn'); if (pb) pb.click(); return false; })()", 600000, 400);
  const s = await rig.evl(fs.readFileSync(HERE + "dumpexpr.js", "utf8"));
  fs.writeFileSync(out + "map.json", s);
  const o = JSON.parse(s);
  console.log("regions", o.regions.length, "roads", o.roads.length, "hw", o.highways.length, o.hwKeys.join("|"), "net", o.net.length, o.netKeys.join("|"), "foot", o.foot.length, "of", o.nColliders, "grid", o.grid.nx, o.grid.nz, "waterFns", o.grid.waterFns.join(","));
  console.log("errors", JSON.stringify(rig.errors.slice(0, 2)).slice(0, 300));
} finally { await rig.close(); }
