/* tools/shot/lib.mjs — the shot service's shared ground: where requests live,
   the knobs, the presets, and how a --setup string is read.

   Lives INSIDE the testbus directory (one harness, one place to look):
     $TESTBUS_DIR/shot/queue/<id>.json     submitted, not yet taken
     $TESTBUS_DIR/shot/results/<id>.json   the answer (status, sheet, frames, timings)
     $TESTBUS_DIR/shot/daemon.lock / daemon.log / status.json
   Images land in --out, default ~/harness/out/gta6/shots/<id>/. */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUS, CORES, readJson, writeJson, pidAlive, slug, now, sleep, load1 } from "../testbus/lib.mjs";

export { BUS, CORES, readJson, writeJson, pidAlive, slug, now, sleep, load1 };
export const SHOT = path.join(BUS, "shot");
export const SD = { queue: path.join(SHOT, "queue"), results: path.join(SHOT, "results") };
for (const d of Object.values(SD)) mkdirSync(d, { recursive: true });
export const LOCK = path.join(SHOT, "daemon.lock");
export const LOG = path.join(SHOT, "daemon.log");
export const STATUS = path.join(SHOT, "status.json");
export const OUT_ROOT = path.join(os.homedir(), "harness/out/gta6/shots");
export const resultPath = (id) => path.join(SD.results, id + ".json");

const num = (k, d) => (process.env[k] != null && process.env[k] !== "" ? +process.env[k] : d);
export const CFG = {
  chromes: Math.max(1, Math.min(4, num("SHOT_CHROMES", 3))),       // warm Chrome processes, at most
  pagesPerChrome: num("SHOT_PAGES", 3),                             // warm worlds per Chrome (LRU)
  perAgent: num("SHOT_PER_AGENT", 2),                               // one agent's requests in flight at once
  jobMs: num("SHOT_JOB_MS", 180e3),                                 // a whole request, hard
  evalMs: num("SHOT_EVAL_MS", 45e3),                                // any one page call, hard
  bootMs: num("SHOT_BOOT_MS", 150e3),                               // an npcwar boot (city worlds get 10 min)
  idleMin: num("SHOT_IDLE_MIN", 20),
  maxLoadPerCore: num("SHOT_MAX_LOAD_PER_CORE", 4),                 // hold cold boots above this
  growLoadPerCore: num("SHOT_GROW_LOAD_PER_CORE", 3),               // add a Chrome only below this
};

/* ---- presets: what a builder asks for in one word ------------------------
   poses x times x cams = frames. `cycle:N` = N frames across one gait cycle. */
export const PRESETS = {
  npcwar: {
    glance:    { setup: { pose: "idle" }, cams: ["3q"], times: ["0"] },
    turntable: { setup: { pose: "idle" }, cams: ["front", "side", "back", "3q", "top", "head", "feet"], times: ["0"] },
    gait:      { setup: { pose: "walk,trot,run" }, cams: ["side"], times: ["cycle:8"] },
    walk:      { setup: { pose: "walk" }, cams: ["side"], times: ["cycle:8"] },
    trot:      { setup: { pose: "trot" }, cams: ["side"], times: ["cycle:8"] },
    run:       { setup: { pose: "run" }, cams: ["side"], times: ["cycle:8"] },
    attack:    { setup: { pose: "attack" }, cams: ["side", "3q"], times: ["0", "0.12", "0.25", "0.37", "0.5", "0.62", "0.75", "0.87"] },
    death:     { setup: { pose: "death" }, cams: ["side", "top"], times: ["0", "0.2", "0.5", "1", "1.6", "2.5", "4"] },
    matchup:   { setup: { pose: "fight" }, cams: ["wide", "hot"], times: ["0", "4", "8", "12", "16", "24"] },
  },
  city: {
    glance: { setup: {}, cams: ["chase"], times: ["0"] },
    orbit:  { setup: {}, cams: ["chase", "orbit:90:20", "orbit:180:20", "orbit:270:20", "top", "fp"], times: ["0"] },
    timeline: { setup: {}, cams: ["chase"], times: ["0", "2", "5", "10"] },
  },
};
for (const w of ["president", "escape", "prison", "survival", "disaster"]) PRESETS[w] = PRESETS.city;

/* --setup is URL params ("species=lion&pose=walk") or a JS snippet. A string
   that is not a clean k=v&k=v list is JS. */
export function parseSetup(s) {
  s = String(s || "").trim();
  if (!s) return { params: {}, js: "" };
  if (/^[\w.|-]+=[^&\s;(){}]*(&[\w.|-]+=[^&\s;(){}]*)*$/.test(s)) {
    const params = {};
    for (const [k, v] of new URLSearchParams(s)) params[k] = v;
    return { params, js: "" };
  }
  return { params: {}, js: s.replace(/^js:/, "") };
}

/* NPC War: which params are for the shot stage and which go on the page URL
   (map=water, blood=0, and anything the NPC War architecture defines later:
   an unknown key is a PAGE param, so a new page flag works the day it lands). */
export const NPCWAR_STAGE_KEYS = new Set(["species", "unit", "n", "vs", "vn", "pose", "style", "speed", "heading", "stage", "grid", "ruler", "rw", "bw", "rt", "bt"]);
// the CBZ worlds (page/world.js): look point, bearing, orbit radius; the rest is page URL (cfg_X=1, seed=N)
export const WORLD_STAGE_KEYS = new Set(["at", "heading", "dist", "pose"]);
export const NPCWAR_BASE_QUERY = "auto=1&map=arena&red=1&blue=1&killcam=0";

export function newId(agent) {
  return `${Date.now().toString(36)}-${slug(agent).slice(0, 20)}-${Math.random().toString(36).slice(2, 6)}`;
}
export function daemonInfo() {
  const L = readJson(LOCK);
  return L && pidAlive(L.pid) ? L : null;
}
