#!/usr/bin/env node
/* ============================================================
   tools/city-story.mjs — STORYBOARDS FOR GANG CITY, tsunami-style.

   OWNER: "how in natural disaster you can see the time of a tsunami and get
   screenshots of different time stamps — I would want the same for Gang City,
   but we can't, because it's so heavy."

   Now we can, because the heaviness was the BOOT and the host already paid
   it. A storyboard here is: hold the live loop (the host owns the clock),
   run a beat's setup through /eval, advance EXACTLY the beat's sim-seconds
   with /step, photograph with /shot, repeat — then stitch the frames into
   one labelled strip. Same world, same run, real timestamps.

   Needs a running host:   node tools/cityhost.mjs &
   Then:                   node tools/city-story.mjs bullring
                           node tools/city-story.mjs <file.json>

   A story file is JSON: { "id": "...", "cam": {...}, "look": {...},
     "beats": [ { "label": "...", "at": <sim-sec>, "setup": "<js>",
                  "cam": {...}, "look": {...}, "fov": n,
                  "probe": "<js returning an object printed under the shot>" } ] }
   `at` is ABSOLUTE story time in sim-seconds; the runner steps the gap from
   the previous beat, so the labels on the strip are true timestamps. Cameras
   use the same vocabulary as /shot: world {x,y,z} or speedway {t,s,u,h} —
   or `camExpr`/`lookExpr`, JS evaluated in-page at shot time returning
   {x,y,z}, for subjects that MOVE. A race storyboard aims at where the pack
   IS, not where it was when the beats were typed.

   The built-in "bullring" story frames the stadium from its gate plaza. (The
   race is run in the world: city/speedway_race.js.)
============================================================ */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripPNGs } from "./lib/pngjoin.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const which = argv[0] || "bullring";
const t0 = Date.now();
const log = (s) => process.stdout.write(`[story ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`);

/* ---- the built-in stories -------------------------------------------------
   Each one is exactly the JSON a story FILE would hold — the built-ins are
   examples of the format, not a second code path. */
const BUILTINS = {
  // the Bullring from its own plaza
  bullring: {
    id: "bullring",
    fov: 58,
    beats: [
      {
        label: "the Bullring from the gate plaza", at: 0,
        camExpr: `var G = CBZ.speedwayGate && CBZ.speedwayGate(); if (!G) return { x: 0, y: 40, z: 0 };
          return { x: G.x - Math.sin(G.heading) * 40, y: 9, z: G.z - Math.cos(G.heading) * 40 };`,
        lookExpr: `var G = CBZ.speedwayGate && CBZ.speedwayGate(); if (!G) return { x: 0, y: 0, z: 0 };
          return { x: G.x + Math.sin(G.heading) * 30, y: 14, z: G.z + Math.cos(G.heading) * 30 };`,
        probe: `return { gate: CBZ.speedwayGate ? CBZ.speedwayGate() : null, race: CBZ.speedwayRaceAudit ? CBZ.speedwayRaceAudit() : null };`,
      },
    ],
  },
};
/* ---- host ------------------------------------------------------------------ */
let port;
try { port = JSON.parse(await readFile(path.join(ROOT, "tools/.cityhost.json"), "utf8")).port; }
catch (_) { console.error("no host — start one first:  node tools/cityhost.mjs"); process.exit(2); }
const call = async (pathName, bodyObj) => {
  const r = await fetch(`http://127.0.0.1:${port}${pathName}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(bodyObj || {}),
  });
  const out = await r.json();
  if (out && out.err) throw new Error(pathName + ": " + out.err);
  return out;
};

const story = BUILTINS[which] || JSON.parse(await readFile(which, "utf8"));
const OUT = path.join(ROOT, "artifacts/storyboards", `${story.id}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
await mkdir(OUT, { recursive: true });

await call("/hold", { on: true });               // the story owns the clock now
let clock = 0;
const frames = [];
for (let i = 0; i < story.beats.length; i++) {
  const b = story.beats[i];
  if (b.setup) await call("/eval", { expr: b.setup });
  const gap = Math.max(0, (b.at || 0) - clock);
  if (gap > 0) await call("/step", { seconds: gap, dt: 1 / 30 });
  clock = Math.max(clock, b.at || 0);
  const file = path.join(OUT, `${String(i + 1).padStart(2, "0")}-t${String(clock).padStart(3, "0")}s.png`);
  let cam = b.cam || story.cam, look = b.look || story.look;
  if (b.camExpr) { try { cam = (await call("/eval", { expr: b.camExpr })).v || cam; } catch (_) {} }
  if (b.lookExpr) { try { look = (await call("/eval", { expr: b.lookExpr })).v || look; } catch (_) {} }
  await call("/shot", { file, cam, look, fov: b.fov || story.fov });
  let probe = null;
  if (b.probe) { try { probe = (await call("/eval", { expr: b.probe })).v; } catch (e) { probe = { err: String(e.message).slice(0, 120) }; } }
  frames.push({ file, label: b.label, at: clock, probe });
  log(`t+${String(clock).padStart(3)}s  ${b.label}` + (probe ? `  ·  ${JSON.stringify(probe)}` : ""));
}
await call("/hold", { on: false });              // hand the world back live

/* ---- the strip: every beat side by side, like the tsunami pages ---------- */
const strip = path.join(OUT, "storyboard.png");
try {
  const bufs = await Promise.all(frames.map(async (f) => ({ buf: await readFile(f.file), label: `t+${f.at}s  ${f.label}` })));
  await writeFile(strip, stripPNGs(bufs, { title: story.id.toUpperCase() }));
  log("strip: " + strip);
} catch (e) {
  // the individual frames are the deliverable either way — a stitch failure
  // must never fail the story.
  log("stitch skipped (" + String(e.message).slice(0, 80) + ") — frames are in " + OUT);
}
await writeFile(path.join(OUT, "story.json"), JSON.stringify({ story: story.id, frames }, null, 2));
log(`done — ${frames.length} beats in ${((Date.now() - t0) / 1000).toFixed(0)}s, out: ${OUT}`);
