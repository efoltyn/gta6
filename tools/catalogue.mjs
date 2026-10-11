#!/usr/bin/env node
/* tools/catalogue.mjs — THE BEFORE/AFTER CATALOGUE of NPC War's units, in ONE
   batched capture run.

     node tools/catalogue.mjs --kind vehicle          every vehicle with its own art on AFTER
     node tools/catalogue.mjs --kind species          every animal (same design, its own shot plan)
     node tools/catalogue.mjs --ids m1_abrams,hmmwv   just these (wave-A stubs included)
     node tools/catalogue.mjs --page-only             rebuild index.html from the frames on disk

   ONE BOOT, MANY UNITS. The tool launches its own headless Chrome
   (tools/testbus/browser.mjs), serves both trees straight out of .git
   (tools/shot/gitserve.mjs: no checkouts, no worktrees) and boots NPC War ONCE
   per tree: BEFORE (--before, default 5864f6a5, the NPC War split, where every
   vehicle was still the generic city model) and AFTER (--after, default
   origin/main). The two pages run in parallel in the same Chrome. In each live
   page (rAF frozen, time moves only through __battle.advance) every unit is
   staged in turn through the shot service's in-page half (tools/shot/page/npcwar.js,
   window.__shot: restage, studio, cameras), shot from every angle, cleared,
   next unit. Nothing goes through the shared shot queue.

   PER UNIT
     turntable, both trees  hero 3/4, front, side, 3/4, rear, top, close-up, on the
                            studio stage (grey cyclorama, grid, 2 m ruler)
     action, AFTER only     vehicles: one sim timeline on the real ground (--map,
                            default dunes), the lens on the unit:
                              move      driving / flying in: dust, rotor wash
                              fire      foes set out ahead, the main weapon fired
                                        (vehFire): flash and the round in flight
                              dismount  (carriers) the benches filled through the
                                        roster grammar; the squad out on the ground
                              wreck     killed through the page's own damage route
                            species: the run (two gait phases), the strike
                            (CBZ.predatorPose phases), the death and the corpse
     facts                  read from the unit's own file at AFTER (node vm with a
                            stub registry): dimensions, mass, speed, armour by
                            facing, crew, passengers, weapons (vehicles) or the
                            stats row (species)

   Output: --out (default ~/harness/out/gta6/catalogue/<kind>/) holds index.html
   and img/*.webp (max 1280 px, cwebp; sips JPEG when cwebp is missing). Raw JPEG
   frames stay in ~/harness/out/gta6/catalogue/_raw/<kind>/<id>/.

   A unit whose AFTER file is still the wave-A stub ("No new art in wave A") is
   listed as pending and not shot, unless named with --ids or --all is given.

   Options: --before REF  --after REF  --map ID  --all  --page-only  --size WxH
            --kind vehicle|species  --ids a,b  --out DIR                         */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launchChrome, CHROME } from "./testbus/browser.mjs";
import { pathToFileURL } from "node:url";
import { bootWorld } from "./testbus/worlds.mjs";
import { serveCommit } from "./shot/gitserve.mjs";
import { NPCWAR_BASE_QUERY } from "./shot/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (has("--help") || has("-h")) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\* ?/, "")); process.exit(0); }
const g = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const secs = () => ((Date.now() - T0) / 1000).toFixed(1) + " s";
const log = (...a) => console.log(`[catalogue ${secs()}]`, ...a);

const KIND = val("--kind", "vehicle") === "species" || val("--kind") === "animal" ? "species" : "vehicle";
const BEFORE = val("--before", "5864f6a5");
const AFTER = val("--after", "origin/main");
const MAP = val("--map", "dunes");
const [W, H] = val("--size", "1280x800").split("x").map(Number);
const ROOT = path.join(os.homedir(), "harness/out/gta6/catalogue");
const OUT = path.resolve(val("--out", path.join(ROOT, KIND === "vehicle" ? "vehicles" : "animals")));
const RAW = path.join(ROOT, "_raw", KIND === "vehicle" ? "vehicles" : "animals");
const IMG = path.join(OUT, "img");
const UNIT_DIR = KIND === "vehicle" ? "src/units/vehicles" : "src/units/species";

if (AFTER === "origin/main") { try { g(["fetch", "-q", "origin", "main"]); } catch (_) {} }
const beforeC = g(["rev-parse", BEFORE + "^{commit}"]);
const afterC = g(["rev-parse", AFTER + "^{commit}"]);

/* ------------------------------------------------------------ the facts */
function sandboxRun(src, CBZ) {
  const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, CBZ };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.runInNewContext(src, ctx, { timeout: 2000 });
  return ctx;
}
function manifest() {
  const C = {};
  try { sandboxRun(g(["show", `${afterC}:src/units/manifest.js`]), C); } catch (e) { log("manifest threw:", e.message); }
  return C.UNIT_MANIFEST || {};
}
function unitDef(id) {
  const file = `${UNIT_DIR}/${id}.js`;
  let src; try { src = g(["show", `${afterC}:${file}`]); } catch (_) { return null; }
  const got = {};
  const reg = (k, d) => { got[k] = d; };
  try { sandboxRun(src, { unitKit: { register: reg }, defineSpecies: reg }); } catch (e) { log(id, "facts: file threw in the sandbox:", e.message); }
  const head = (/^\/\*[\s\S]*?\*\//.exec(src) || [""])[0];
  const title = ((/units\/(?:vehicles|species)\/[\w.]+\s+[—-]+\s+([^\n]+)/.exec(head) || [])[1] || "").replace(/\s+$/, "");
  return { id, def: got[id] || null, title, stub: /No new art in wave A/.test(head), lines: src.split("\n").length };
}

/* ---------------------------------------------------------- the shot plans */
const fnameCam = (c) => c.replace(/[^\w]+/g, "_");
const TT = KIND === "vehicle"
  ? [["hero", "orbit:38:12:0.62"], ["front", "front"], ["side", "side"], ["3q", "3q"], ["rear", "back"], ["top", "top"], ["close", "orbit:28:14:0.42"]]
  : [["hero", "orbit:38:12:0.8"], ["front", "front"], ["side", "side"], ["3q", "3q"], ["rear", "back"], ["top", "top"], ["close", "head"]];
const TT_LABEL = { hero: "3/4 hero", front: "Front", side: "Side", "3q": "3/4", rear: "Rear", top: "Top", close: "Close-up" };
const WIDE = "orbit:125:10:2.4";

/* THE VEHICLE ACTION TIMELINE, run once after spawning with S, B, CBZ, THREE in
   scope (MAP and vehFire are globals of the battle's classic scripts). Events
   ride B.advance, which __shot.at(t) calls once per frame time. Everything it
   swaps is put back by window.__catRestore() before the next unit. */
function vehicleJs(id, P) {
  return `(function () {
  var ID = ${JSON.stringify(id)}, P = ${JSON.stringify(P)};
  var R = B.roster(), u = R.filter(function (m) { return m.vehicle && m.team === "red" && m.unitId === ID; })[0];
  if (!u) throw new Error("no " + ID + " on the field");
  var adv = B.advance, roster = B.roster, T = 0;
  window.__catRestore = function () { B.advance = adv; B.roster = roster; window.__catRestore = null; };
  function foes() { return roster.call(B).filter(function (m) { return m.team === "blue" && !m.inVeh && !m.vehicle && !m.dead; }); }
  function place(D) {
    var fx = Math.sin(u.h), fz = Math.cos(u.h);
    foes().forEach(function (m, k) {
      var d = D + (k % 4) * 7, s = ((k % 5) - 2) * 6;
      var x = u.pos.x + fx * d - fz * s, z = u.pos.z + fz * d + fx * s;
      m.pos.set(x, MAP.groundAt(x, z), z);
      if (m.target) m.target.set(x, 0, z);
      m.home = { x: x, z: z };
    });
  }
  if (P.moveD > 0) place(P.moveD);
  var ev = [
    { at: P.fire, fn: function () {
      place(P.fireD);
      var f = foes(); if (!f.length || !u.wpn || !u.wpn.length) return;
      var t = f[0]; u.tgt = t; u.sees = true;
      if (!u.air && u.rig && u.rig.aimTurret) for (var i = 0; i < 80; i++) u.rig.aimTurret(0, 0.01, 0.1);
      vehFire(u, u.wpn[0], t, Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z));
    } },
    { at: P.kill, fn: function () {
      var hurt = CBZ.modes && CBZ.modes.npcwar && CBZ.modes.npcwar.hurt;
      /* the armour is asked first (units/kit/vehicle.js threatOf/resolve): a bare
         "shot" is a 6 mm round and bounces off any hull whatever its damage. The
         kill comes from behind as a heavy round, through the channel a vehicle's
         own gun uses (by._shot), until the hull is really dead */
      var by = { vehicle: true, team: "blue", pos: { x: u.pos.x - Math.sin(u.h) * 60, y: u.pos.y, z: u.pos.z - Math.cos(u.h) * 60 },
        _shot: { pen: 3000, beh: 5000, he: true, cls: "atgm" } };
      for (var i = 0; i < 8 && hurt && !u.dead; i++) hurt(u, 1e9, { byTeam: "blue", by: by, cause: "shot" });
      // the shot's lens skips the dead: from here the field it frames is the wreck
      B.roster = function () { return [u]; };
    } },
  ];
  B.advance = function (sec, step) {
    var end = T + sec;
    while (ev.length && ev[0].at <= end + 1e-6) {
      var e = ev.shift();
      if (e.at > T) { adv.call(B, e.at - T, step); T = e.at; }
      try { e.fn(); } catch (er) { console.warn("[catalogue] event threw", er); }
    }
    if (end > T) adv.call(B, end - T, step);
    T = end;
  };
})();`;
}
const r2 = (x) => Math.round(x * 100) / 100;
/* a plan: [{ stage: <__shot.stage spec>, shots: [[t, cam, label]] }] */
function actionPlan(U) {
  const d = U.def || {}, S = d.stats || {}, id = U.id;
  if (KIND === "species") {
    return [
      { stage: { species: id, pose: "run" }, shots: [["0", "side", "At the run"], ["half", "side", "Mid-stride"], ["0", "3q", "Running, 3/4"]] },
      { stage: { species: id, pose: "attack" }, shots: [["0.25", "3q", "The strike: wind-up"], ["0.5", "3q", "The strike"], ["0.75", "side", "Follow-through"]] },
      { stage: { species: id, pose: "fight", vs: "men", vn: 6, stage: "map", map: MAP, cam: id }, shots: [["3", "hot", "Into the men"], ["8", "orbit:125:12:2.2", "The fight, wide"]] },
      { stage: { species: id, pose: "death", stage: "map" }, shots: [["0.5", "side", "Killed"], ["4", "3q", "The body, 4 s on"]] },
    ];
  }
  const air = d.domain === "air", carrier = (d.passengers || 0) > 0;
  const crewN = (d.crew || []).length, pass = d.passengers || 0;
  const mv = air ? [1.5, 4] : [4, 7];
  const fire = mv[1] + 0.2;
  const fr = [fire + 0.04, fire + 0.25, fire + 0.7];
  const dm = carrier ? (air ? [fire + 5, fire + 9] : [fire + 2.3, fire + 4.3]) : [];
  const kill = (dm.length ? dm[dm.length - 1] : fr[2]) + 0.6;
  const wr = [kill + 0.3, kill + 2.5, kill + 6];
  const P = { moveD: air ? 0 : (S.standoff || 200) + 320, fire: r2(fire), fireD: air ? 220 : 170, kill: r2(kill) };
  const shots = [
    [mv[0], "hot", "On the move"], [mv[1], WIDE, air ? "Inbound, rotor wash" : "Dust off the running gear"],
    [fr[0], "hot", "Main weapon fires"], [fr[0], WIDE, "Muzzle flash, wide"], [fr[1], WIDE, "Round downrange"], [fr[2], "hot", "Fight on"],
    ...dm.map((t, i) => [t, WIDE, i ? "Squad on the ground" : "Squad dismounts"]),
    [wr[0], "hot", "Knocked out"], [wr[1], WIDE, "Burning wreck"], [wr[2], "hot", "Wreck, 6 s on"],
  ].map(([t, c, l]) => [String(r2(t)), c, l]);
  const roster = pass > 0 ? `${id}*1,men*${crewN + pass}` : id;
  return [{ stage: { species: roster, n: pass > 0 ? crewN + pass + 1 : 1, pose: "fight", vs: "men", vn: 8, stage: "map", cam: id, js: vehicleJs(id, P) }, shots }];
}

/* ------------------------------------------------------------ the capture */
const pageLib = () => {
  const src = readFileSync(path.join(HERE, "shot/page/npcwar.js"), "utf8");
  return src.replace('var V = "dev";', `var V = "${createHash("sha1").update(src).digest("hex").slice(0, 12)}";`);
};
const QUERY = (map) => { const q = new URLSearchParams(NPCWAR_BASE_QUERY); q.set("map", map); q.sort(); return q.toString(); };
/* BEFORE only shoots studio turntables (the ground is hidden), so it boots the light
   arena: the old tree never came up on the dunes in 240 s (measured on 5864f6a5) */
const BEFORE_MAP = val("--before-map", "arena");
async function bootTree(B, label, commit, map) {
  const t0 = Date.now();
  const srv = await serveCommit(REPO, commit);
  const pg = await B.newPage();
  await bootWorld(pg, srv.origin, `npcwar|1|${QUERY(map)}`, 300e3);
  const ok = await pg.evl(pageLib(), 30e3);
  if (ok !== true) throw new Error(`${label}: tools/shot/page/npcwar.js did not install (${ok})`);
  log(`${label} @${commit.slice(0, 8)} booted in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { label, commit, srv, pg, bootMs: Date.now() - t0 };
}
const decode = (url) => Buffer.from(String(url).split(",")[1] || "", "base64");
async function shoot(T, cam, file) {
  const r = await T.pg.evl(`__shot.shot(${JSON.stringify(cam)}, ${W}, ${H}, "image/jpeg")`, 90e3);
  if (!r || r.error || !r.url) throw new Error((r && r.error) || "no frame");
  writeFileSync(file, decode(r.url));
}
async function stage(T, spec) {
  const st = await T.pg.evl(`__shot.stage(${JSON.stringify(spec)})`, 120e3);
  if (!st || !st.ok) throw new Error((st && st.error) || "stage failed");
  return st;
}
async function unstage(T) {
  await T.pg.evl("(window.__catRestore && window.__catRestore(), __shot.clear())", 60e3).catch(() => {});
}
/* one tree's whole run: every unit's turntable (+ action on AFTER) in its one page */
async function runTree(T, units, withAction, failed) {
  let n = 0;
  for (const U of units) {
    const dir = path.join(RAW, U.id); mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    try {
      await stage(T, { species: U.id, pose: "idle" });
      for (const [name, cam] of TT) {
        try { await shoot(T, cam, path.join(dir, `${T.label}-tt-${name}.jpg`)); n++; }
        catch (e) { failed.push(`${U.id} ${T.label} turntable ${name}: ${e.message}`); }
      }
    } catch (e) { failed.push(`${U.id} ${T.label} turntable: ${e.message}`); }
    await unstage(T);
    if (withAction) {
      for (const [k, A] of actionPlan(U).entries()) {
        try {
          const st = await stage(T, A.stage);
          for (const w of st.warn || []) log(`  ${U.id} warn: ${w}`);
          let last = -1;
          for (const [t0s, cam] of A.shots) {
            const t = t0s === "half" ? (st.period || 1) / 2 : +t0s;
            if (t !== last) { await T.pg.evl(`__shot.at(${t})`, 120e3); last = t; }
            try { await shoot(T, cam, path.join(dir, `act${k}-t${String(t0s).replace(".", "_")}-${fnameCam(cam)}.jpg`)); n++; }
            catch (e) { failed.push(`${U.id} action t=${t0s} ${cam}: ${e.message}`); }
          }
        } catch (e) { failed.push(`${U.id} action ${k}: ${e.message}`); }
        await unstage(T);
      }
    }
    log(`${T.label}: ${U.id} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  return n;
}

/* ------------------------------------------------------------ the images */
const CWEBP = (() => { for (const p of ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp", "/usr/bin/cwebp"]) if (existsSync(p)) return p; return null; })();
const RAWOF = new Map();       // published image -> its raw JPEG (the PDF prints from these)
function squeeze(src, base) {
  if (!existsSync(src) || statSync(src).size < 2000) return null;     // a blank / failed frame
  RAWOF.set("img/" + base + (CWEBP ? ".webp" : ".jpg"), src);
  if (CWEBP) {
    const dst = path.join(IMG, base + ".webp");
    if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs)
      execFileSync(CWEBP, ["-quiet", "-q", "70", "-m", "4", "-resize", "1280", "0", src, "-o", dst]);
    return "img/" + base + ".webp";
  }
  const dst = path.join(IMG, base + ".jpg");
  if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs)
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", "1280", src, "--out", dst], { stdio: "ignore" });
  return "img/" + base + ".jpg";
}
function collect(U, failed) {
  const out = { before: {}, after: {}, action: [] }, dir = path.join(RAW, U.id);
  for (const side of ["before", "after"]) for (const [name] of TT) {
    const p = squeeze(path.join(dir, `${side}-tt-${name}.jpg`), `${U.id}-${side}-${name}`);
    if (p) out[side][name] = p; else if (!failed.some((f) => f.startsWith(`${U.id} ${side}`))) failed.push(`${U.id} ${side} ${name}: no frame`);
  }
  for (const [k, A] of actionPlan(U).entries()) for (const [t, cam, label] of A.shots) {
    const base = `act${k}-t${String(t).replace(".", "_")}-${fnameCam(cam)}`;
    const p = squeeze(path.join(dir, base + ".jpg"), `${U.id}-${base}`);
    if (p) out.action.push({ src: p, label });
  }
  return out;
}

/* THE PRINT COPY. Chrome stores a WebP in a PDF losslessly (a 60 KB frame
   becomes MBs), but passes a JPEG through as is: the PDF prints from small
   JPEGs made off the raw frames (sips), in a temp folder, not the catalogue. */
const PRINT_DIR = path.join(RAW, "_print");
function printSrc(rel, w) {
  const src = RAWOF.get(rel);
  if (!src) return rel;
  const dst = path.join(PRINT_DIR, path.basename(rel).replace(/\.\w+$/, `-${w}.jpg`));
  if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs)
    execFileSync("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "58", "-Z", String(w), src, "--out", dst], { stdio: "ignore" });
  return pathToFileURL(dst).href;
}
let SRC = (rel) => rel;          // the screen page: the webp as published; the print copy swaps this
let PRINT = false;
/* the phone PDF: a fresh headless Chrome prints the print copy (CDP printToPDF
   can stall after a long WebGL session: tools/visual-compare.mjs found it) */
async function printPdf(units, M, all, pending, failed, timing) {
  mkdirSync(PRINT_DIR, { recursive: true });
  PRINT = true; SRC = printSrc;
  const html = path.join(PRINT_DIR, "print.html");
  writeFileSync(html, page(units, M, all, pending, failed, timing));
  PRINT = false; SRC = (rel) => rel;
  const pdf = path.join(OUT, "catalogue.pdf"), tmp = path.join(PRINT_DIR, "catalogue.pdf");
  rmSync(tmp, { force: true });
  /* HARNESS TRAP: this headless print writes the PDF and then does not always
     exit (measured: PDF done in seconds, process alive 10+ min later). Wait for
     the file to land and stop growing, then end the process group ourselves. */
  const ch = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=15000",
    `--user-data-dir=${path.join(PRINT_DIR, "profile")}`, `--print-to-pdf=${tmp}`, pathToFileURL(html).href],
  { stdio: "ignore", detached: true });
  let exited = false; ch.on("exit", () => { exited = true; });
  const t0 = Date.now();
  let last = -1, same = 0;
  while (Date.now() - t0 < 300e3) {
    await sleep(500);
    const sz = existsSync(tmp) ? statSync(tmp).size : -1;
    if (sz > 0 && sz === last) { if (++same >= 4) break; } else same = 0;
    last = sz;
    if (exited && sz <= 0) break;
  }
  try { process.kill(-ch.pid, "SIGKILL"); } catch (_) {}
  if (!existsSync(tmp) || statSync(tmp).size === 0) throw new Error("Chrome wrote no PDF");
  writeFileSync(pdf, readFileSync(tmp));
  return pdf;
}

/* -------------------------------------------------------------- the page */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? "–" : (+n).toLocaleString("en-US", { maximumFractionDigits: d }));
function wname(id) {
  return String(id).replace(/_/g, " ").replace(/\b(\d+)mm\b/i, "$1 mm").replace(/\b([a-z]{1,4}\d[\w-]*|m\d+\w*)\b/gi, (m) => m.toUpperCase())
    .replace(/\b50cal\b/i, ".50 cal").replace(/\b(rws|coax|tow|agm|hydra|stbd)\b/gi, (m) => m.toUpperCase());
}
const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
function vehicleCard(U) {
  const d = U.def || {}, S = d.stats || {}, A = S.armour || {}, CE = S.armourCE || null;
  const arm = ["front", "side", "rear", "top"].map((f) => `<div class="arm"><span>${f}</span><b>${fmt(A[f], 0)}</b>${CE ? `<i>${fmt(CE[f], 0)} CE</i>` : ""}<div class="bar"><div style="width:${Math.min(100, Math.sqrt((A[f] || 0) / 820) * 100).toFixed(1)}%"></div></div></div>`).join("");
  const weapons = (d.weapons || []).map((w) => `<li><b>${esc(wname(w.id))}</b><span>${esc(w.kind)}${w.range ? ` · ${fmt(w.range, 0)} m` : ""}${w.pen ? ` · ${fmt(w.pen, 0)} mm pen` : ""}${w.ammo ? ` · ${fmt(w.ammo, 0)} rds` : ""}${w.rof ? ` · ${fmt(w.rof, 2)}/s` : ""}</span></li>`).join("");
  const crew = (d.crew || []).map((c) => c.seat).join(", ") || (S.remote ? "flown remotely" : "–");
  return `${row("Role", esc((d.tactics && d.tactics.role) || d.drive || d.domain || "–"))}
    ${row("Domain / drive", esc(`${d.domain || "–"} / ${d.drive || "–"}`))}
    ${row("Length × width × height", `${fmt(S.length, 2)} × ${fmt(S.width, 2)} × ${fmt(S.height, 2)} m`)}
    ${row("Mass", S.mass ? `${fmt(S.mass / 1000, 1)} t` : "–")}
    ${row("Top speed", S.speed ? `${fmt(S.speed * 3.6, 0)} km/h` : "–")}
    ${S.alt ? row("Fighting altitude", `${fmt(S.alt, 0)} m`) : ""}
    ${row("Hit points", fmt(S.hp, 0))}
    ${row("Crew", `${(d.crew || []).length} · ${esc(crew)}`)}
    ${row("Carries", d.passengers ? `${d.passengers} troops${S.dismountAt ? `, out at ${fmt(S.dismountAt, 0)} m` : ""}` : "none")}
    <h5>Armour, mm RHA${CE ? " (kinetic / vs shaped charge)" : ""}</h5>
    <div class="arms">${arm}</div>
    <h5>Weapons</h5>
    <ul class="wpn">${weapons || "<li>unarmed</li>"}</ul>`;
}
function speciesCard(U) {
  const S = (U.def && U.def.stats) || {};
  const flat = [];
  (function walk(o, pre) {
    for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === "number" || typeof v === "string") flat.push([pre + k, v]);
      else if (v && typeof v === "object" && !Array.isArray(v) && pre.split(".").length < 2) walk(v, pre + k + ".");
    }
  })(S, "");
  return flat.slice(0, 24).map(([k, v]) => row(k, esc(typeof v === "number" ? fmt(v, 2) : v))).join("") || "<p>no stats row</p>";
}
function specCard(U) {
  return `<aside class="spec"><h4>Specification</h4>${KIND === "vehicle" ? vehicleCard(U) : speciesCard(U)}
    <p class="src">From <code>${UNIT_DIR}/${esc(U.id)}.js</code> @ ${afterC.slice(0, 8)}</p></aside>`;
}
function section(U, M, shots, n) {
  const name = (M[U.id] && M[U.id].name) || U.id;
  const lazy = PRINT ? "" : ` loading="lazy"`;
  const hb = shots.before.hero, ha = shots.after.hero;
  const ba = PRINT
    ? `<div class="pair">${[["Before", hb], ["After", ha]].filter(([, s]) => s).map(([l, s]) => `<figure><img src="${SRC(s, 1000)}" alt=""><figcaption><b>${l}</b></figcaption></figure>`).join("")}</div>`
    : hb && ha
    ? `<div class="ba" style="--p:50%"><img src="${SRC(ha)}" alt="${esc(name)} after"><div class="ba-b"><img src="${SRC(hb)}" alt="${esc(name)} before"></div><div class="ba-line"></div><span class="tag l">Before</span><span class="tag r">After</span><input type="range" min="0" max="100" value="50" aria-label="before/after"></div>`
    : `<div class="ba missing">${ha ? `<img src="${SRC(ha)}" alt="">` : "no hero frame"}</div>`;
  const tt = (side) => TT.filter(([k]) => k !== "hero").map(([k]) => shots[side][k]
    ? `<figure><img src="${SRC(shots[side][k], 480)}"${lazy} alt=""><figcaption>${TT_LABEL[k]}</figcaption></figure>` : `<figure class="miss"><figcaption>${TT_LABEL[k]}: no frame</figcaption></figure>`).join("");
  const act = shots.action.map((a) => `<figure><img src="${SRC(a.src, 640)}"${lazy} alt=""><figcaption>${esc(a.label)}</figcaption></figure>`).join("");
  return `<section class="unit" id="${U.id}">
  <header><div class="num">${String(n).padStart(2, "0")}</div><div><h2>${esc(name)}</h2><p class="sub">${esc(U.title)}</p></div></header>
  ${ba}
  <div class="grid2">
    <div>
      <h3>Turntable <small>after</small></h3><div class="strip">${tt("after")}</div>
      ${Object.keys(shots.before).length ? `<h3>Turntable <small>before</small></h3><div class="strip before">${tt("before")}</div>` : `<p class="pend">BEFORE frames missing from this run.</p>`}
      <h3>In action <small>after, ${esc(MAP)}</small></h3><div class="strip act">${act || "<p class='miss'>no action frames</p>"}</div>
    </div>
    ${specCard(U)}
  </div>
</section>`;
}
function page(units, M, all, pending, failed, timing) {
  const toc = units.map((U, i) => `<a href="#${U.id}"><span>${String(i + 1).padStart(2, "0")}</span>${esc((M[U.id] || {}).name || U.id)}${all[U.id].after.hero ? `<img src="${SRC(all[U.id].after.hero, 360)}" alt="">` : ""}</a>`).join("");
  const kindT = KIND === "vehicle" ? "Vehicles" : "Animals", kindW = KIND === "vehicle" ? "vehicle" : "animal";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPC War ${kindT}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0e10;--panel:#15171a;--line:#262a2f;--ink:#e9e6df;--mute:#8d9096;--acc:#d9a441}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,system-ui,sans-serif}
a{color:inherit}
.wrap{max-width:1360px;margin:0 auto;padding:0 16px}
.mast{padding:72px 0 36px;border-bottom:1px solid var(--line)}
.mast .kick{color:var(--acc);letter-spacing:.2em;text-transform:uppercase;font-size:12px;font-weight:600}
.mast h1{font:700 clamp(40px,7vw,96px)/.95 Fraunces,Georgia,serif;margin:12px 0 16px;letter-spacing:-.02em}
.mast p{color:var(--mute);max-width:760px;margin:0}
.toc{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;padding:28px 0 8px}
.toc a{display:flex;flex-direction:column;gap:6px;text-decoration:none;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-weight:600}
.toc a span{color:var(--acc);font:700 13px Fraunces,serif}
.toc a img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:6px;margin-top:4px}
.toc a:hover{border-color:var(--acc)}
.pend{color:var(--mute);font-size:13px;margin:8px 0 0}
.unit{padding:64px 0 24px;border-bottom:1px solid var(--line)}
.unit header{display:flex;gap:20px;align-items:flex-end;margin-bottom:20px}
.num{font:700 64px/1 Fraunces,serif;color:var(--acc)}
.unit h2{font:700 clamp(30px,4.4vw,54px)/1 Fraunces,Georgia,serif;margin:0}
.sub{color:var(--mute);margin:6px 0 0}
.ba{position:relative;overflow:hidden;border-radius:12px;border:1px solid var(--line);aspect-ratio:16/10;background:#222;user-select:none}
.ba img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.ba-b{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--p)) 0 0)}
.ba-line{position:absolute;top:0;bottom:0;left:var(--p);width:2px;background:var(--acc);box-shadow:0 0 12px #000a}
.ba input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.tag{position:absolute;top:14px;font:600 12px Inter;letter-spacing:.14em;text-transform:uppercase;background:#000a;padding:5px 10px;border-radius:4px}
.tag.l{left:14px}.tag.r{right:14px;color:var(--acc)}
.ba.missing{display:grid;place-items:center;color:var(--mute)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;margin-top:28px}
h3{font:700 22px Fraunces,serif;margin:22px 0 10px}h3 small{font:600 11px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-left:8px}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.strip.act{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;cursor:zoom-in}
figcaption{font-size:12px;color:var(--mute);padding:6px 9px}
figure.miss{display:grid;place-items:center;min-height:110px}
.spec{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 18px 12px;align-self:start;position:sticky;top:16px}
.spec h4{font:700 20px Fraunces,serif;margin:0 0 10px}
.spec h5{font:600 11px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);margin:16px 0 8px}
.kv{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:6px 0;font-size:13px}
.kv span{color:var(--mute)}.kv b{text-align:right;font-weight:600}
.arms{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.arm{background:#0f1113;border:1px solid var(--line);border-radius:6px;padding:7px 9px;font-size:12px}
.arm span{color:var(--mute);text-transform:capitalize;display:block}.arm b{font:700 20px Fraunces,serif}.arm i{color:var(--mute);font-style:normal;margin-left:6px}
.bar{height:3px;background:#24272b;border-radius:2px;margin-top:5px}.bar div{height:100%;background:var(--acc);border-radius:2px}
.wpn{list-style:none;margin:0;padding:0}.wpn li{border-bottom:1px solid var(--line);padding:7px 0;font-size:13px}.wpn b{display:block}.wpn span{color:var(--mute);font-size:12px}
.src{color:var(--mute);font-size:11px;margin:12px 0 0}code{font-size:11px}
.fail{color:var(--mute);font-size:12px;padding:32px 0 64px}.fail li{margin:2px 0}
.foot{color:var(--mute);font-size:12px;padding:24px 0 48px}
#lb{position:fixed;inset:0;background:#000e;display:none;place-items:center;z-index:9;cursor:zoom-out}#lb img{max-width:96vw;max-height:92vh;border-radius:6px}#lb.on{display:grid}
.pair{display:none}
@page{size:150mm 266mm;margin:0}
@media print{
 html,body{background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
 body{font-size:11px}.wrap{padding:0 7mm}
 .mast{padding:12mm 0 6mm}.mast h1{font-size:44px}.mast p{font-size:11px}
 .toc{grid-template-columns:repeat(3,1fr);gap:6px;padding:10px 0 0}.toc a{padding:6px;font-size:10px;break-inside:avoid}
 .unit{break-before:page;padding:8mm 0 4mm;border:0}
 .unit header{margin-bottom:8px}.num{font-size:34px}.unit h2{font-size:30px}.sub{font-size:10px}
 .ba,#lb,input{display:none!important}
 .pair{display:grid;grid-template-columns:1fr;gap:6px}
 .pair figcaption b{color:var(--acc);letter-spacing:.14em;text-transform:uppercase}
 body .grid2{grid-template-columns:1fr;gap:6px;margin-top:6px}
 h3{font-size:15px;margin:10px 0 5px;break-after:avoid}
 body .strip{grid-template-columns:repeat(3,1fr);gap:5px}body .strip.act{grid-template-columns:repeat(2,1fr)}figure.miss{display:none}
 figure{break-inside:avoid}figcaption{font-size:9px;padding:3px 6px}
 .spec{position:static;break-inside:avoid;padding:10px 12px;margin-top:8px}
 .kv{font-size:10px;padding:3px 0}.arm b{font-size:15px}.wpn li{font-size:10px;padding:4px 0}
 .fail{break-before:page}
}
@media (max-width:900px){.grid2{grid-template-columns:1fr}.spec{position:static}.num{font-size:44px}.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.strip.act{grid-template-columns:1fr}}
</style></head><body>
<div class="wrap">
<div class="mast"><div class="kick">NPC War · before / after catalogue</div><h1>${kindT}</h1>
<p>Every ${kindW} as it looked before the campaign (${beforeC.slice(0, 8)}, when the vehicles were still the generic city models) and as it is now on main (${afterC.slice(0, 8)}). Drag the line across each hero image. Turntables are on the studio stage; action frames come from the live battle sim on the ${esc(MAP)} ground. Specs are read straight from each unit's file.</p>
<nav class="toc">${toc}</nav>
${pending.length ? `<p class="pend">Not redrawn yet, so not in this issue: ${pending.map(esc).join(", ")}.</p>` : ""}
</div>
${units.map((U, i) => section(U, M, all[U.id], i + 1)).join("\n")}
${failed.length ? `<div class="fail"><h3>Frames that failed</h3><ul>${failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
<p class="foot">${esc(timing)}</p>
</div>
<div id="lb"><img alt=""></div>
<script>
document.querySelectorAll('.ba input').forEach(function(r){r.addEventListener('input',function(){r.parentNode.style.setProperty('--p',r.value+'%')})});
var lb=document.getElementById('lb');
document.querySelectorAll('figure img').forEach(function(i){i.addEventListener('click',function(){lb.firstChild.src=i.src;lb.classList.add('on')})});
lb.addEventListener('click',function(){lb.classList.remove('on')});
document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('on')});
</script>
</body></html>`;
}

/* -------------------------------------------------------------- the run */
const M = manifest();
const ids = val("--ids") ? val("--ids").split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(M).filter((k) => M[k].kind === KIND);
if (!ids.length) { console.error("catalogue: no unit ids (manifest unreadable?)"); process.exit(2); }
const pending = [], units = [];
for (const id of ids) {
  const U = unitDef(id);
  if (!U) { pending.push(((M[id] && M[id].name) || id) + " (no file)"); continue; }
  if (U.stub && !has("--all") && !val("--ids")) { pending.push((M[id] && M[id].name) || id); continue; }
  units.push(U);
}
log(`${units.length} ${KIND}: ${units.map((u) => u.id).join(", ")}${pending.length ? `; pending: ${pending.join(", ")}` : ""}`);
log(`before ${BEFORE}@${beforeC.slice(0, 8)}  after ${AFTER}@${afterC.slice(0, 8)}  ground ${MAP}  ${W}x${H}`);

const failed = [];
let timing = `Built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${afterC.slice(0, 8)}.`;
if (!has("--page-only")) {
  for (const U of units) rmSync(path.join(RAW, U.id), { recursive: true, force: true });
  const B = await launchChrome();
  log(`chrome up in ${B.startMs} ms (pid ${B.pid})`);
  const trees = [];
  try {
    const [TB, TA] = await Promise.all([bootTree(B, "before", beforeC, BEFORE_MAP), bootTree(B, "after", afterC, MAP)]);
    trees.push(TB, TA);
    const t1 = Date.now();
    const [nb, na] = await Promise.all([runTree(TB, units, false, failed), runTree(TA, units, true, failed)]);
    const capS = (Date.now() - t1) / 1000;
    timing = `One run: ${units.length} ${KIND === "vehicle" ? "vehicles" : "animals"}, ${nb + na} frames; boots ${(TB.bootMs / 1000).toFixed(0)} s / ${(TA.bootMs / 1000).toFixed(0)} s (parallel), capture ${capS.toFixed(0)} s, ${secs()} end to end. ` + timing;
    log(`captured ${nb} before + ${na} after frames in ${capS.toFixed(1)} s`);
  } finally {
    for (const T of trees) { try { await T.pg.closeTarget(); } catch (_) {} try { T.srv.close(); } catch (_) {} }
    await B.close();
  }
}
mkdirSync(IMG, { recursive: true });
const all = {};
for (const U of units) all[U.id] = collect(U, failed);
writeFileSync(path.join(OUT, "index.html"), page(units, M, all, pending, failed, timing));
const bytes = readdirSync(IMG).reduce((s, f) => s + statSync(path.join(IMG, f)).size, 0);
log(`${failed.length} failed frame(s)${failed.length ? ":\n  " + failed.join("\n  ") : ""}`);
log(`images ${(bytes / 1048576).toFixed(1)} MB in ${readdirSync(IMG).length} files; ${timing}`);
if (!has("--no-pdf")) {
  const t = Date.now();
  try { const pdf = await printPdf(units, M, all, pending, failed, timing); log(`pdf ${(statSync(pdf).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s: ${pdf}`); }
  catch (e) { log("pdf failed: " + e.message); }
}
console.log(path.join(OUT, "index.html"));
