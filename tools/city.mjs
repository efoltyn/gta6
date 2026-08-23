#!/usr/bin/env node
/* ============================================================
   tools/city.mjs — the client for tools/cityhost.mjs.

   The host holds ONE built Gang City; this is how you ask it things. Every
   command here costs what the question costs — the 40-50 s world build was
   paid once, by the host.

     node tools/city.mjs status
     node tools/city.mjs eval "CBZ.cityCars.length"
     node tools/city.mjs eval "return CBZ.raceAudit()"        # `return` allowed
     node tools/city.mjs step 30                              # +30 sim-seconds
     node tools/city.mjs hold on|off                          # own the clock
     node tools/city.mjs shot out.png --t 0 --s -60 --u 8 --h 6 \
                         --look-t 0 --look-h 2 --fov 50       # speedway coords
     node tools/city.mjs shot out.png --x 100 --y 40 --z -200 # world coords
     node tools/city.mjs rerun --origin racer   # fresh RUN, same code   ~2 s
     node tools/city.mjs reload --origin racer  # fresh CODE (after an edit
                                                # to src/) — page reload ~60 s
     node tools/city.mjs quit

   Exit codes: 0 ok, 1 the host answered with an error, 2 no host running
   (start one: node tools/cityhost.mjs).
============================================================ */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : undefined; };
const num = (n) => { const v = opt(n); return v == null ? undefined : +v; };

let port;
try { port = JSON.parse(await readFile(path.join(ROOT, "tools/.cityhost.json"), "utf8")).port; }
catch (_) { console.error("no host portfile — start one:  node tools/cityhost.mjs"); process.exit(2); }
const call = async (method, pathName, bodyObj) => {
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${port}${pathName}`, {
      method, headers: { "content-type": "application/json" },
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
  } catch (_) { console.error("host not answering — is cityhost still running?"); process.exit(2); }
  const out = await r.json();
  console.log(JSON.stringify(out, null, 1));
  if (out && out.err) process.exit(1);
  return out;
};

const camFromFlags = (prefix) => {
  const p = (k) => num(`--${prefix}${k}`);
  const world = { x: p("x"), y: p("y"), z: p("z") };
  const track = { t: p("t"), s: p("s"), u: p("u"), h: p("h") };
  if (world.x != null && world.z != null) return world;
  if (track.t != null || track.s != null || track.u != null || track.h != null) return track;
  return undefined;
};

if (cmd === "status") await call("GET", "/status");
else if (cmd === "eval") await call("POST", "/eval", { expr: argv[1] || "" });
else if (cmd === "step") await call("POST", "/step", { seconds: +argv[1] || 1, dt: num("--dt") });
else if (cmd === "hold") await call("POST", "/hold", { on: argv[1] !== "off" });
else if (cmd === "shot") await call("POST", "/shot", { file: argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined, cam: camFromFlags(""), look: camFromFlags("look-"), fov: num("--fov") });
else if (cmd === "rerun") await call("POST", "/rerun", { origin: opt("--origin") });
else if (cmd === "reload") await call("POST", "/reload", { origin: opt("--origin") });
else if (cmd === "quit") await call("POST", "/quit");
else { console.error("usage: status | eval <expr> | step <sec> | hold on|off | shot [file] [--t/--s/--u/--h | --x/--y/--z] [--look-*] [--fov] | rerun [--origin id] | reload [--origin id] | quit"); process.exit(2); }
