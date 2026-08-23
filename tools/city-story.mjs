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

   Needs a running host:   node tools/cityhost.mjs [--origin racer] &
   Then:                   node tools/city-story.mjs race
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

   The built-in "race" story is both the demo and the racer mode's working
   storyboard: the grid, lights out, the field into turn one, mid-race, and
   the closing laps — with the live positions table probed under each frame.
============================================================ */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripPNGs } from "./lib/pngjoin.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const which = argv[0] || "race";
const t0 = Date.now();
const log = (s) => process.stdout.write(`[story ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}\n`);

/* ---- the built-in stories -------------------------------------------------
   Each one is exactly the JSON a story FILE would hold — the built-ins are
   examples of the format, not a second code path. */
const BUILTINS = {
  race: {
    id: "race",
    cam: { t: 0, s: -70, u: 9, h: 6 },
    look: { t: 0, s: 0, u: 0, h: 1.5 },
    fov: 52,
    beats: [
      {
        label: "the grid — a loaner on the back row", at: 0,
        setup: `
          // a fresh racer run if one is not already on the grid
          var R = CBZ.speedwayRaceState ? CBZ.speedwayRaceState() : null;
          if (!R || !R.active) { if (CBZ.cityRaceStart) CBZ.cityRaceStart({ style: "muscle", number: 99 }); }
          return true;`,
        probe: `var R=CBZ.speedwayRaceState(); return { phase:R.phase, field:R.drivers.length, driving:!!CBZ.player.driving };`,
      },
      {
        label: "lights out", at: 5,
        probe: `var R=CBZ.speedwayRaceState(); return { phase:R.phase };`,
      },
      {
        label: "the field into turn one", at: 12,
        cam: { t: 0.10, s: 0, u: 24, h: 5 },
        look: { t: 0.13, s: 0, u: 0, h: 1.2 },
        probe: `var R=CBZ.speedwayRaceState(); return { phase:R.phase };`,
      },
      {
        label: "mid-race — on the pack", at: 40,
        // aim at where the field actually IS: centroid of the running cars,
        // camera pulled outboard of the wall at that same track angle
        /* BEHIND the pack, ON the track, looking along it. Across-track
           framing puts the SAFER wall, the catch fence and sixty metres of
           hoardings between the lens and the cars — the first cut of this
           beat photographed sponsor boards. From the racing line behind the
           field nothing can be in the way, which is also how the
           race-stadium preset frames its running shot. */
        camExpr: `
          var R = CBZ.speedwayRaceState(), sx=0, sz=0, n=0;
          for (var i=0;i<R.drivers.length;i++){ var c=R.drivers[i].car; if (c && !c.dead){ sx+=c.pos.x; sz+=c.pos.z; n++; } }
          if (!n) return { x: 0, y: 40, z: 0 };
          var L = CBZ.speedwayTrackLen();
          var t = CBZ.speedwayCourse.paramAt(sx/n, sz/n);
          var tb = ((t - 38 / L) % 1 + 1) % 1;
          var f = CBZ.speedwayFrame(tb);
          return { x: f.x, y: (CBZ.speedwaySurfaceY(f.x, f.z) || 0) + 7, z: f.z };`,
        lookExpr: `
          var R = CBZ.speedwayRaceState(), sx=0, sz=0, sy=0, n=0;
          for (var i=0;i<R.drivers.length;i++){ var c=R.drivers[i].car; if (c && !c.dead){ sx+=c.pos.x; sz+=c.pos.z; n++; } }
          if (!n) return { x:0, y:0, z:0 };
          return { x:sx/n, y:(CBZ.speedwaySurfaceY(sx/n,sz/n)||0)+1.5, z:sz/n };`,
        probe: `
          var R = CBZ.speedwayRaceState();
          var rows = (R.kit && R.kit.order || []).slice(0,4).map(function(e){ return e.pos + " " + e.name; });
          return { phase: R.phase, top4: rows };`,
      },
      {
        label: "closing laps — the leader", at: 75,
        camExpr: `
          var R = CBZ.speedwayRaceState(), lead = null;
          var ord = R.kit && R.kit.order || [];
          for (var i=0;i<ord.length;i++){ var d=ord[i].driver; if (d && d.car && !d.car.dead){ lead=d.car; break; } }
          if (!lead) return { x:0, y:40, z:0 };
          var L = CBZ.speedwayTrackLen();
          var t = CBZ.speedwayCourse.paramAt(lead.pos.x, lead.pos.z);
          var tb = ((t - 22 / L) % 1 + 1) % 1;
          var f = CBZ.speedwayFrame(tb);
          return { x: f.x, y: (CBZ.speedwaySurfaceY(f.x, f.z) || 0) + 4.5, z: f.z };`,
        lookExpr: `
          var R = CBZ.speedwayRaceState(), lead = null;
          var ord = R.kit && R.kit.order || [];
          for (var i=0;i<ord.length;i++){ var d=ord[i].driver; if (d && d.car && !d.car.dead){ lead=d.car; break; } }
          if (!lead) return { x:0, y:0, z:0 };
          return { x: lead.pos.x, y: (CBZ.speedwaySurfaceY(lead.pos.x,lead.pos.z)||0)+1.2, z: lead.pos.z };`,
        probe: `
          var R = CBZ.speedwayRaceState();
          var rows = (R.kit && R.kit.order || []).slice(0,4).map(function(e){ return e.pos + " " + e.name + " L" + Math.max(0,Math.floor(e.total)+1); });
          return { phase: R.phase, top4: rows };`,
      },
    ],
  },
};
/* ---- host ------------------------------------------------------------------ */
let port;
try { port = JSON.parse(await readFile(path.join(ROOT, "tools/.cityhost.json"), "utf8")).port; }
catch (_) { console.error("no host — start one first:  node tools/cityhost.mjs --origin racer"); process.exit(2); }
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
