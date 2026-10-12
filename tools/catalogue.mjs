#!/usr/bin/env node
/* tools/catalogue.mjs — THE BEFORE/AFTER CATALOGUE of NPC War's units, in ONE
   batched capture run.

     node tools/catalogue.mjs --kind vehicle          every vehicle with its own art on AFTER
     node tools/catalogue.mjs --kind species          every animal (same design, its own shot plan)
     node tools/catalogue.mjs --ids m1_abrams,hmmwv   just these (wave-A stubs included)
     node tools/catalogue.mjs --page-only             rebuild index.html from the frames on disk
     node tools/catalogue.mjs --kind impacts          munitions x targets: ~30 real shots, AFTER only
                                                      (see IMPACTS below; --ids picks pairings)

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
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launchChrome } from "./testbus/browser.mjs";
import { printHtmlToPdf } from "./printpdf.mjs";
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
const T0 = Date.now();
const secs = () => ((Date.now() - T0) / 1000).toFixed(1) + " s";
const log = (...a) => console.log(`[catalogue ${secs()}]`, ...a);

const KARG = val("--kind", "vehicle");
const KIND = /^impacts?$/.test(KARG) ? "impacts" : KARG === "species" || KARG === "animal" ? "species" : "vehicle";
const SUB = { vehicle: "vehicles", species: "animals", impacts: "impacts" }[KIND];
const BEFORE = val("--before", "5864f6a5");
const AFTER = val("--after", "origin/main");
const MAP = val("--map", "dunes");
const [W, H] = val("--size", "1280x800").split("x").map(Number);
const ROOT = path.join(os.homedir(), "harness/out/gta6/catalogue");
const OUT = path.resolve(val("--out", path.join(ROOT, SUB)));
const RAW = path.join(ROOT, "_raw", SUB);
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
function manifest(commit = afterC) {
  const C = {};
  try { sandboxRun(g(["show", `${commit}:src/units/manifest.js`]), C); } catch (e) { log("manifest threw:", e.message); }
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
      /* the shot's lens skips the dead, and the wreck's group bounds can hold
         thrown parts far off the hull: from here the lens is an invisible hull-
         sized box that follows the hull's CURRENT position every step */
      var L = Math.max(2, (u.vlen || 3) * 2), Hh = Math.max(1, u.vheight || 2.5), Wd = Math.max(1.5, (u.vwid || 1.5) * 2);
      var box = new THREE.Mesh(new THREE.BoxGeometry(Wd, Hh, L), new THREE.MeshBasicMaterial());
      box.visible = false; box.frustumCulled = false; CBZ.scene.add(box);
      proxy = { group: box, pos: box.position, unitId: ID, vehicle: true, team: "red", dead: false, i: 0 };
      follow();
      B.roster = function () { return [proxy]; };
    } },
  ];
  var proxy = null;
  function follow() {
    if (!proxy) return;
    proxy.group.position.set(u.pos.x, u.pos.y + proxy.group.geometry.parameters.height / 2, u.pos.z);
    proxy.group.rotation.set(0, u.group ? u.group.rotation.y : -u.h, 0);
    proxy.group.updateMatrixWorld(true);
  }
  var restore0 = window.__catRestore;
  window.__catRestore = function () { if (proxy && proxy.group.parent) proxy.group.parent.remove(proxy.group); restore0(); };
  B.advance = function (sec, step) {
    var end = T + sec;
    while (ev.length && ev[0].at <= end + 1e-6) {
      var e = ev.shift();
      if (e.at > T) { adv.call(B, e.at - T, step); T = e.at; }
      try { e.fn(); } catch (er) { console.warn("[catalogue] event threw", er); }
    }
    if (end > T) adv.call(B, end - T, step);
    T = end;
    follow();
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
  const r = await T.pg.evl(`__shot.shot(${JSON.stringify(cam)}, ${W}, ${H}, "image/jpeg")`, 180e3);
  if (!r || r.error || !r.url) throw new Error((r && r.error) || "no frame");
  writeFileSync(file, decode(r.url));
}
async function stage(T, spec) {
  const st = await T.pg.evl(`__shot.stage(${JSON.stringify(spec)})`, 240e3);
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
    if (!withAction && U.isNew) continue;          // a new unit has nothing to show on BEFORE
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
  for (const side of U.isNew ? ["after"] : ["before", "after"]) for (const [name] of TT) {
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
async function printPdf(build) {
  mkdirSync(PRINT_DIR, { recursive: true });
  PRINT = true; SRC = printSrc;
  const html = path.join(PRINT_DIR, "print.html");
  try { writeFileSync(html, build()); } finally { PRINT = false; SRC = (rel) => rel; }
  return printHtmlToPdf(html, path.join(OUT, "catalogue.pdf"), { workDir: PRINT_DIR });
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
  <header><div class="num">${String(n).padStart(2, "0")}</div><div><h2>${esc(name)}${U.isNew ? ` <span class="new">New unit</span>` : ""}</h2><p class="sub">${esc(U.title)}</p></div></header>
  ${ba}
  <div class="grid2">
    <div>
      <h3>Turntable <small>after</small></h3><div class="strip">${tt("after")}</div>
      ${U.isNew ? `<p class="pend">New unit: NPC War had no model for it before this campaign.</p>` : Object.keys(shots.before).length ? `<h3>Turntable <small>before</small></h3><div class="strip before">${tt("before")}</div>` : `<p class="pend">BEFORE frames missing from this run.</p>`}
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
.new{font:600 12px Inter;letter-spacing:.14em;text-transform:uppercase;color:var(--bg);background:var(--acc);padding:4px 9px;border-radius:4px;vertical-align:middle;margin-left:10px}
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

/* ============================================================ IMPACTS
   --kind impacts: what each munition does to each kind of thing it hits, AFTER
   only (--after, default origin/main), one Chrome, two live pages: the dunes
   (sand, cover, vehicles) and the island (Fort Brandt's buildings, its parked
   aircraft). Every pairing fires the REAL weapon path through the in-page half
   tools/shot/page/impacts.js (window.__imp): the round flies, lands, resolves
   against the armour, and the blast, fx and debris are the game's own. The
   lens is fixed on the mark (the shot service's at: cam). Frames: one step
   before the impact, the impact, +0.3 s, +1.5 s, settled at +6 s, and a
   close-up of what lies there at +6 s.
   A pairing that fails is listed and skipped: the run ships anyway. */
const IMP_MAPS = { dunes: "dunes", island: "island" };
// the shot cams per subject size: d metres off, p pitch, yaw relative to the
// bearing the round came in on (ay: absolute compass yaw), cp close-up pitch
const CAM = {
  veh: { d: 24, p: 13, yaw: 60 }, cover: { d: 17, p: 16, yaw: 55 }, bigcover: { d: 30, p: 18, yaw: 70 },
  bomb: { d: 75, p: 16, yaw: 120 }, bombveh: { d: 45, p: 16, yaw: 110 }, air: { d: 45, p: 4, yaw: 80, cp: 6 },
};
let _site = 0;
// the dunes: every pairing on its own patch of sand, 170 m apart
const site = () => { const k = _site++; return [1400 + (k % 6) * 170, -260 + Math.floor(k / 6) * 170]; };
const ABRAMS_GUN = { shooter: "m1_abrams", wid: "m256_120mm" };
const M242 = { shooter: "bradley_ifv", wid: "m242_25mm" };
const APACHE = (wid, alt, range, from) => ({ shooter: "ah64_apache", wid, alt, range, from });
const RPG = { shooter: "men", rw: "bazooka", how: "rpg" };
/* mun: the round's name; tgt: the target's; by: who fires it; kg: the warhead as
   the weapon's own file states it (its comment), never invented */
const PAIRS = [
  { id: "sabot-abrams-front", mun: "120 mm M829A3 APFSDS", by: "M1 Abrams, M256", tgt: "M1 Abrams, front", cam: CAM.veh, instant: true,
    P: { ...ABRAMS_GUN, target: { unit: "m1_abrams", h: 0 }, from: 0, range: 800, force: true, noLine: true } },
  { id: "sabot-abrams-side", mun: "120 mm M829A3 APFSDS", by: "M1 Abrams, M256", tgt: "M1 Abrams, side", cam: CAM.veh, instant: true,
    P: { ...ABRAMS_GUN, target: { unit: "m1_abrams", h: 0 }, from: 90, range: 800, force: true, noLine: true } },
  { id: "sabot-bradley", mun: "120 mm M829A3 APFSDS", by: "M1 Abrams, M256", tgt: "M2 Bradley, side", cam: CAM.veh, instant: true,
    P: { ...ABRAMS_GUN, target: { unit: "bradley_ifv", h: 0 }, from: 90, range: 800, force: true, noLine: true } },
  { id: "mpat-bradley", mun: "120 mm M830A1 MPAT (HEAT-MP)", by: "M1 Abrams, M256", tgt: "M2 Bradley", cam: CAM.veh,
    P: { ...ABRAMS_GUN, how: "he", target: { unit: "bradley_ifv", h: 0 }, from: 30, range: 300 } },
  { id: "mpat-jersey", mun: "120 mm M830A1 MPAT (HEAT-MP)", by: "M1 Abrams, M256", tgt: "Concrete jersey barrier", cam: CAM.cover,
    P: { ...ABRAMS_GUN, how: "he", target: { cover: "jersey", h: 0 }, from: 0, range: 250 } },
  { id: "25mm-apds-humvee", mun: "25 mm M791 APDS-T x4", by: "M2 Bradley, M242", tgt: "HMMWV, side", cam: CAM.veh, instant: true,
    P: { ...M242, target: { unit: "hmmwv", h: 90 }, from: 0, range: 500, force: true, noLine: true, burst: 4, burstDt: 0.3 } },
  { id: "25mm-he-sand", mun: "25 mm HEI-T x4", by: "M2 Bradley, M242", tgt: "Open sand", cam: { d: 18, p: 18, yaw: 70 },
    P: { ...M242, how: "he", target: { ground: true }, from: 0, range: 300, burst: 4, burstDt: 0.3 } },
  { id: "50cal-fmtv", mun: ".50 BMG M2HB, 10-round burst", by: "HMMWV ring mount", tgt: "FMTV truck, cab", cam: CAM.veh, instant: true,
    P: { shooter: "hmmwv", wid: "m2_50cal_ring", target: { unit: "fmtv", h: 0 }, from: 15, range: 150, burst: 10, burstDt: 0.125 } },
  { id: "50cal-technical", mun: ".50 BMG M2HB, 10-round burst", by: "Stryker RWS", tgt: "Technical (pickup)", cam: CAM.veh, instant: true,
    P: { shooter: "stryker_apc", wid: "m2_50cal_rws", target: { unit: "technical", h: 90 }, from: 0, range: 200, burst: 10, burstDt: 0.11 } },
  { id: "rpg-humvee", mun: "RPG-7, PG-7V", by: "rifleman", tgt: "HMMWV, side", cam: CAM.veh,
    P: { ...RPG, target: { unit: "hmmwv", h: 90 }, from: 0, range: 90 } },
  { id: "rpg-bradley", mun: "RPG-7, PG-7V", by: "rifleman", tgt: "M2 Bradley, front", cam: CAM.veh,
    P: { ...RPG, target: { unit: "bradley_ifv", h: 0 }, from: 0, range: 120 } },
  { id: "rpg-mrap", mun: "RPG-7, PG-7V", by: "rifleman", tgt: "MaxxPro MRAP, side", cam: CAM.veh,
    P: { ...RPG, target: { unit: "maxxpro_mrap", h: 90 }, from: 0, range: 100 } },
  { id: "tow-abrams", mun: "BGM-71 TOW-2B", by: "M2 Bradley", tgt: "M1 Abrams, side", cam: CAM.veh,
    P: { shooter: "bradley_ifv", wid: "tow_2b", target: { unit: "m1_abrams", h: 0 }, from: 80, range: 600, force: true } },
  { id: "hellfire-abrams-top", mun: "AGM-114 Hellfire, top attack", by: "AH-64 Apache", tgt: "M1 Abrams", cam: CAM.veh,
    P: { ...APACHE("agm114_hellfire", 400, 500, 200), target: { unit: "m1_abrams", h: 0 }, force: true } },
  { id: "hellfire-fmtv", mun: "AGM-114 Hellfire", by: "AH-64 Apache", tgt: "FMTV truck", cam: CAM.veh,
    P: { ...APACHE("agm114_hellfire", 250, 2000, 200), target: { unit: "fmtv", h: 30 }, force: true } },
  { id: "hellfire-r-jltv", mun: "AGM-114R Hellfire Romeo", by: "MQ-9 Reaper", tgt: "JLTV", cam: CAM.veh,
    P: { shooter: "mq9_reaper", wid: "agm114_hellfire", alt: 900, range: 2500, from: 140, target: { unit: "jltv", h: 0 }, force: true } },
  { id: "30mm-m35", mun: "30 mm M789 HEDP, 8-round burst", by: "AH-64 Apache, M230", tgt: "M35 cargo truck", cam: CAM.veh, instant: true,
    P: { ...APACHE("m230_30mm", 150, 800, 220), target: { unit: "m35_truck", h: 90 }, force: true, burst: 8, burstDt: 0.1 } },
  { id: "hydra-hesco", mun: "Hydra 70, M151 HE x4", by: "AH-64 Apache", tgt: "HESCO bastion", cam: CAM.bigcover, kg: "M151: 10 lb HE warhead (ah64_apache.js)",
    P: { ...APACHE("hydra70", 150, 1200, 180), how: "he", target: { cover: "hesco", h: 0 }, burst: 4, burstDt: 0.17 } },
  { id: "gmlrs-hesco", mun: "M31A1 GMLRS", by: "M270 MLRS", tgt: "HESCO bastion", cam: CAM.bigcover,
    P: { shooter: "m270_mlrs", wid: "m31a1_gmlrs", how: "he", target: { cover: "hesco", h: 0 }, from: 150, range: 2500 } },
  { id: "gbu12-sandbags", mun: "GBU-12 Paveway II", by: "MQ-9 Reaper", tgt: "Sandbag wall", cam: CAM.bigcover, kg: "Mk 82, 89 kg tritonal (mq9_reaper.js)",
    P: { shooter: "mq9_reaper", wid: "gbu12", how: "bomb", alt: 700, range: 250, speed: 80, from: 270, target: { cover: "sandbags", h: 0 } } },
  { id: "mk82-sand", mun: "Mk 82 500 lb (one of the stick)", by: "B-52H", tgt: "Open sand", cam: CAM.bomb,
    P: { shooter: "b52", wid: "mk82_stick", how: "bomb", alt: 700, range: 300, speed: 220, from: 270, target: { ground: true } } },
  { id: "jdam-sand", mun: "GBU-31(V)1 JDAM, Mk 84", by: "F-35A", tgt: "Open sand", cam: CAM.bomb, kg: "Mk 84, 429 kg tritonal (f35.js)",
    P: { shooter: "f35", wid: "gbu31_jdam", how: "bomb", alt: 600, range: 300, speed: 220, from: 270, target: { ground: true } } },
  { id: "blu109-abrams", mun: "GBU-31(V)3 JDAM, BLU-109", by: "B-2A", tgt: "M1 Abrams", cam: CAM.bombveh,
    P: { shooter: "b2_spirit", wid: "gbu31_blu109", how: "bomb", alt: 700, range: 300, speed: 220, from: 270, target: { unit: "m1_abrams", h: 0 } } },
  { id: "sdb-bradley", mun: "GBU-39 SDB", by: "F-35A", tgt: "M2 Bradley", cam: CAM.bombveh, kg: "17 kg AFX-757 penetrating warhead (f35.js)",
    P: { shooter: "f35", wid: "gbu39_sdb", how: "bomb", alt: 600, range: 300, speed: 220, from: 270, target: { unit: "bradley_ifv", h: 0 } } },
  { id: "pac3-apache", mun: "PAC-3 MSE, hit-to-kill", by: "Patriot launcher", tgt: "AH-64 Apache in flight", cam: CAM.air,
    P: { shooter: "patriot_launcher", wid: "pac3_mse", target: { unit: "ah64_apache", h: 0, alt: 150 }, from: 120, range: 3000, force: true } },
  // ---- Fort Brandt (map=island): the base's own buildings and parked aircraft
  { id: "jdam-barracks", map: "island", mun: "GBU-31(V)1 JDAM, Mk 84", by: "F-35A", tgt: "Barracks, 2 storeys (Fort Brandt)", kg: "Mk 84, 429 kg tritonal (f35.js)",
    cam: { d: 85, p: 22, ay: 200, cp: 14 },
    P: { shooter: "f35", wid: "gbu31_jdam", how: "bomb", alt: 600, range: 300, speed: 220, from: 270, site: [-620, -914], skipR: 25, target: { ground: true, aimY: 4 } } },
  { id: "mk84-hq", map: "island", mun: "GBU-31 JDAM, Mk 84", by: "B-2A", tgt: "HQ, 3 storeys (Fort Brandt)",
    cam: { d: 90, p: 22, ay: 20, cp: 14 },
    P: { shooter: "b2_spirit", wid: "gbu31_mk84", how: "bomb", alt: 700, range: 300, speed: 220, from: 270, site: [-730, -808], skipR: 25, target: { ground: true, aimY: 5 } } },
  { id: "hellfire-hq", map: "island", mun: "AGM-114 Hellfire", by: "AH-64 Apache", tgt: "HQ wall (Fort Brandt)",
    cam: { d: 42, p: 12, ay: 12, cp: 10 },
    P: { ...APACHE("agm114_hellfire", 200, 2000, 20), site: [-730, -797.5], skipR: 25, target: { ground: true, aimY: 4 } } },
  { id: "mpat-ops", map: "island", mun: "120 mm M830A1 MPAT (HEAT-MP)", by: "M1 Abrams, M256", tgt: "Ops building wall (Fort Brandt)",
    cam: { d: 42, p: 12, yaw: 25, cp: 10 },
    P: { ...ABRAMS_GUN, how: "he", site: [-556, -664], target: { ground: true, aimY: 3, past: 40 }, from: 180, range: 250, skipR: 16 } },
  { id: "sdb-parked-f35", map: "island", mun: "GBU-39 SDB", by: "F-35A", tgt: "Parked F-35 on the apron", kg: "17 kg AFX-757 penetrating warhead (f35.js)",
    cam: { d: 45, p: 18, ay: 150 },
    P: { shooter: "f35", wid: "gbu39_sdb", how: "bomb", alt: 600, range: 300, speed: 220, from: 270, site: [-654, -588], skipR: 9, target: { ground: true, aimY: 1.5 } } },
  { id: "gmlrs-parked-apache", map: "island", mun: "M31A1 GMLRS", by: "M270 MLRS", tgt: "Parked AH-64 on its pad",
    cam: { d: 45, p: 18, ay: 160 },
    P: { shooter: "m270_mlrs", wid: "m31a1_gmlrs", how: "he", site: [-406, -604], skipR: 9, target: { ground: true, aimY: 1.5 }, from: 300, range: 2500 } },
];
for (const X of PAIRS) { X.map = X.map || "dunes"; if (!X.P.site) X.P.site = site(); }

const impLib = () => readFileSync(path.join(HERE, "shot/page/impacts.js"), "utf8");
const IMP_FRAMES = [["pre", "Just before"], ["hit", "Impact"], ["t03", "+0.3 s"], ["t15", "+1.5 s"], ["t6", "Settled, +6 s"], ["close", "Close-up, +6 s"]];
async function shootPair(T, X, failed) {
  const dir = path.join(RAW, X.id); mkdirSync(dir, { recursive: true });
  const C = X.cam;
  const st = await T.pg.evl(`__imp.setup(${JSON.stringify(X.P)})`, 240e3);
  if (!st || !st.ok) throw new Error((st && st.error) || "setup failed");
  const aim = st.aim;
  const yaw = C.ay != null && !st.turned ? C.ay : (st.from || 0) + (C.yaw != null ? C.yaw : 60);
  if (st.blocked) log(`  ${X.id}: no clear line of fire found near the site; fired anyway`);
  // the lens on a point, swung (in page: __imp.cam) until no dune or wall stands in the way
  const lens = {};
  const snap = async (name, d, p, at) => {
    at = at || aim;
    const key = `${at.map((v) => v.toFixed(1)).join(",")}|${d}|${p}`;
    const c = lens[key] || (lens[key] = await T.pg.evl(`__imp.cam(${at.join(",")}, ${yaw}, ${p}, ${d})`, 30e3));
    return shoot(T, `at:${at.map((v) => (+v).toFixed(2)).join(":")}:${c.yaw}:${c.pitch}:${d}`, path.join(dir, name + ".jpg"));
  };
  const focus = () => T.pg.evl("__imp.focus()", 30e3);
  let flight = null;
  if (X.instant) { await snap("pre", C.d, C.p); flight = await T.pg.evl("__imp.fire()", 60e3); }
  else {
    flight = await T.pg.evl("__imp.fire()", 60e3);
    flight.to = await T.pg.evl("__imp.toImpact(90)", 300e3);
    // the round struck before it was one step out (it met something early): no "before" frame
    if (flight.to && flight.to.near) await snap("pre", C.d, C.p);
    else failed.push(`${X.id}: no "just before" frame (the round landed ${flight.to && flight.to.hit ? "early" : "late"})`);
  }
  const h = await T.pg.evl("__imp.stepHit(12)", 120e3);
  if (!h || !h.hit) throw new Error("no impact within 12 s of the round's last step");
  await snap("hit", C.d, C.p);
  // after the impact the lens stays on the target where it now is (a unit), else the mark
  await T.pg.evl("__imp.after(0.3)", 60e3); await snap("t03", C.d, C.p, await focus());
  await T.pg.evl("__imp.after(1.5)", 60e3); await snap("t15", C.d, C.p, await focus());
  await T.pg.evl("__imp.after(6)", 120e3);
  const f6 = await focus();
  await snap("t6", C.d, C.p, f6);
  // the close-up: on the hit point when it landed near the mark, else the mark
  const unitT = !!X.P.target.unit;
  const at = unitT ? f6 : h.at && Math.hypot(h.at.x - aim[0], h.at.z - aim[2]) < 12
    ? [h.at.x, Math.max(st.ground + 0.8, Math.min(h.at.y, aim[1])), h.at.z] : aim;
  await snap("close", Math.max(7, C.d * 0.4), C.cp != null ? C.cp : 30, at);
  const res = await T.pg.evl("__imp.result()", 30e3), facts = await T.pg.evl("__imp.facts()", 30e3);
  const rec = { id: X.id, commit: afterC, setup: st, flight, hit: h, res, facts };
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(rec, null, 1));
  return rec;
}
async function runImpactTree(T, list, failed, done) {
  for (const X of list) {
    const t0 = Date.now();
    try { done[X.id] = await shootPair(T, X, failed); log(`${T.label}: ${X.id} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${done[X.id].res.how})`); }
    catch (e) { failed.push(`${X.mun} → ${X.tgt} (${X.id}): ${e.message}`); log(`${T.label}: ${X.id} FAILED: ${e.message}`); }
    await T.pg.evl("__shot.clear()", 60e3).catch(() => {});
  }
}
const ZN = { front: "front", side: "side", rear: "rear", top: "roof", belly: "belly" };
function impactFacts(X, R) {
  const f = (R && R.facts) || {}, w = f.weapon || {}, he = w.he || {}, out = [];
  // the round actually fired: a gun's HE path (how "he") is its HE/HEAT round, its
  // kinetic path (a vehicle target, how "fire") the dart; blast is shown for the rounds that burst
  const heRound = ["he", "bomb", "rpg"].includes(X.P.how) || ["missile", "sam", "rockets"].includes(w.kind);
  const pen = X.P.how === "he" || X.P.how === "bomb" ? (he.pen || w.pen) : w.pen;
  if (pen) out.push(`${fmt(pen, 0)} mm RHA pen`);
  if (heRound && he.blast) out.push(`blast radius ${fmt(he.blast, 0)} m, power ${fmt(he.power, 1)}`);
  if (X.kg) out.push(X.kg);
  const spd = X.P.how === "he" ? (w.heSpeed || w.speed) : w.speed;
  if (spd && X.P.how !== "bomb") out.push(`${fmt(spd, 0)} m/s`);
  if (w.v0) out.push(`${w.v0} → ${w.vMax} m/s`);
  const z = R && R.res && R.res.zone;
  if (f.armour && z && f.armour[z] != null) out.push(`target ${ZN[z] || z} armour ${fmt(f.armour[z], 0)} mm${f.armourCE && f.armourCE[z] != null ? ` (${fmt(f.armourCE[z], 0)} vs HEAT)` : ""}`);
  if (f.cover && f.cover.hp) out.push(`${f.cover.kind} ${fmt(f.cover.hp, 0)} hp`);
  return out.join(" · ");
}
function impactResult(X, R) {
  const r = (R && R.res) || {}, d = r.debris || {};
  let s;
  if (r.maxHp != null || r.dead != null) {
    if (r.dead) s = `Knocked out${r.burning ? ", burning" : ""}${r.crewLost ? `, ${r.crewLost} crew lost` : ""}`;
    else if (r.pen) s = `Penetrated${r.zone ? ` (${ZN[r.zone] || r.zone})` : ""}${r.firepower ? ", firepower kill" : ""}${r.mobility ? ", mobility kill" : ""}${r.burning ? ", on fire" : ""}; ${fmt(r.hp, 0)}/${fmt(r.maxHp, 0)} hp left`;
    else if (r.zone) s = `No penetration (${ZN[r.zone] || r.zone}${r.armour ? `, ${fmt(r.armour, 0)} mm` : ""}); ${fmt(r.hp, 0)}/${fmt(r.maxHp, 0)} hp`;
    else s = `No damage to the hull (${r.how === "hull" ? "hit" : "the round landed beside it"})`;
  } else if (r.cover) s = r.cover.alive ? `${r.cover.kind} still standing (${fmt(Math.max(0, r.cover.hp), 0)}/${fmt(r.cover.hp0, 0)} hp)` : `${r.cover.kind} destroyed`;
  else {
    // how far from the mark it went off: a round that tunnelled through a wall or overflew lands far off
    const a = R && R.setup && R.setup.aim, at = r.at;
    const off = a && at ? Math.hypot(at.x - a[0], at.z - a[2]) : null;
    s = (r.how === "blast" ? "Detonated" : "Struck") + (off == null ? "" : off < 3 ? " on the mark" : ` ${fmt(off, 0)} m from the mark`);
  }
  return `${s} · debris on the ground: ${fmt(d.pieces || 0, 0)} fractured pieces, ${fmt(d.grit || 0, 0)} grit`;
}
function impactSection(X, R, n) {
  const dir = path.join(RAW, X.id), img = {};
  for (const [k] of IMP_FRAMES) { const p = squeeze(path.join(dir, k + ".jpg"), `${X.id}-${k}`); if (p) img[k] = p; }
  const lazy = PRINT ? "" : ` loading="lazy"`;
  const strip = IMP_FRAMES.filter(([k]) => k !== "t6").map(([k, l]) => img[k]
    ? `<figure><img src="${SRC(img[k], 520)}"${lazy} alt=""><figcaption>${l}</figcaption></figure>` : `<figure class="miss"><figcaption>${l}: no frame</figcaption></figure>`).join("");
  return `<section class="pair" id="${X.id}">
  <header><div class="num">${String(n).padStart(2, "0")}</div><div><h2>${esc(X.mun)} <span class="arr">→</span> ${esc(X.tgt)}</h2><p class="sub">Fired by ${esc(X.by)} · ${esc(X.map === "island" ? "Fort Brandt (map island)" : "open dunes")}</p></div></header>
  <div class="hero">${img.t6 ? `<img src="${SRC(img.t6, 1100)}" alt="">` : "no settled frame"}<span class="tag">Settled, +6 s</span></div>
  <p class="facts">${esc(impactFacts(X, R))}</p>
  <p class="res">${esc(impactResult(X, R))}</p>
  <div class="strip">${strip}</div>
</section>`;
}
function impactPage(list, results, failed, timing) {
  const ok = list.filter((X) => results[X.id]);
  const toc = ok.map((X, i) => `<a href="#${X.id}"><span>${String(i + 1).padStart(2, "0")}</span>${esc(X.mun)} → ${esc(X.tgt)}</a>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPC War Impacts</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0e10;--panel:#15171a;--line:#262a2f;--ink:#e9e6df;--mute:#8d9096;--acc:#d9a441}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Inter,system-ui,sans-serif}
a{color:inherit}.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.mast{padding:64px 0 28px;border-bottom:1px solid var(--line)}
.kick{color:var(--acc);letter-spacing:.2em;text-transform:uppercase;font-size:12px;font-weight:600}
.mast h1{font:700 clamp(40px,7vw,88px)/.95 Fraunces,Georgia,serif;margin:12px 0 16px;letter-spacing:-.02em}
.mast p{color:var(--mute);max-width:760px;margin:0}
.toc{columns:2 320px;gap:24px;padding:22px 0 4px;font-size:13px}.toc a{display:block;text-decoration:none;padding:3px 0;break-inside:avoid}.toc a span{color:var(--acc);font:700 12px Fraunces,serif;margin-right:8px}
.pair{padding:56px 0 20px;border-bottom:1px solid var(--line)}
.pair header{display:flex;gap:18px;align-items:flex-end;margin-bottom:16px}
.num{font:700 56px/1 Fraunces,serif;color:var(--acc)}
.pair h2{font:700 clamp(24px,3.6vw,40px)/1.05 Fraunces,Georgia,serif;margin:0}.arr{color:var(--acc)}
.sub{color:var(--mute);margin:6px 0 0;font-size:13px}
.hero{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:#222;aspect-ratio:16/10}
.hero img{width:100%;height:100%;object-fit:cover;display:block}
.tag{position:absolute;top:12px;left:12px;font:600 11px Inter;letter-spacing:.14em;text-transform:uppercase;background:#000a;padding:4px 9px;border-radius:4px;color:var(--acc)}
.facts{color:var(--mute);font-size:13px;margin:12px 0 2px}.res{font-weight:600;margin:0 0 12px}
.strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;cursor:zoom-in}
figcaption{font-size:12px;color:var(--mute);padding:5px 8px}figure.miss{display:grid;place-items:center;min-height:90px}
.fail{color:var(--mute);font-size:13px;padding:28px 0 8px}.foot{color:var(--mute);font-size:12px;padding:20px 0 48px}
#lb{position:fixed;inset:0;background:#000e;display:none;place-items:center;z-index:9;cursor:zoom-out}#lb img{max-width:96vw;max-height:92vh;border-radius:6px}#lb.on{display:grid}
@media (max-width:760px){.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.num{font-size:40px}}
@page{size:150mm 266mm;margin:0}
@media print{
 html,body{background:var(--bg);-webkit-print-color-adjust:exact;print-color-adjust:exact}
 body{font-size:11px}.wrap{padding:0 7mm}#lb{display:none!important}
 .mast{padding:12mm 0 6mm}.mast h1{font-size:44px}.mast p{font-size:11px}.toc{columns:1;font-size:10px;padding-top:8px}
 .pair{break-before:page;padding:8mm 0 0;border:0}.pair header{margin-bottom:8px}.num{font-size:32px}.pair h2{font-size:22px}.sub{font-size:10px}
 .facts{font-size:10px;margin:8px 0 2px}.res{font-size:11.5px;margin:0 0 8px}
 .strip{grid-template-columns:repeat(3,1fr);gap:5px}figure{break-inside:avoid}figcaption{font-size:9px;padding:3px 6px}figure.miss{display:none}
 .fail{break-before:page}
}
</style></head><body><div class="wrap">
<div class="mast"><div class="kick">NPC War · impact catalogue</div><h1>What hits do</h1>
<p>Each page is one round fired through the game's own weapon path at ${afterC.slice(0, 8)}: the shooter's real weapon, its real flight, the armour roll, blast, fire and debris as the battle makes them. The lens is fixed on the mark. Frames run from the step before impact to six seconds after, when the debris has come to rest. Numbers are read from each weapon's own file; "debris" counts are CBZ.debris's own (fractured pieces on the ground, small grit).</p>
<nav class="toc">${toc}</nav></div>
${ok.map((X, i) => impactSection(X, results[X.id], i + 1)).join("\n")}
${failed.length ? `<div class="fail"><h3>Failed pairings (skipped) and missing frames</h3><ul>${failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
<p class="foot">${esc(timing)}</p>
</div><div id="lb"><img alt=""></div>
<script>
var lb=document.getElementById('lb');
document.querySelectorAll('figure img,.hero img').forEach(function(i){i.addEventListener('click',function(){lb.firstChild.src=i.src;lb.classList.add('on')})});
lb.addEventListener('click',function(){lb.classList.remove('on')});
document.addEventListener('keydown',function(e){if(e.key==='Escape')lb.classList.remove('on')});
</script></body></html>`;
}
async function impactsMain() {
  const ids = val("--ids") ? val("--ids").split(",").map((s) => s.trim()) : null;
  const list = ids ? PAIRS.filter((X) => ids.includes(X.id)) : PAIRS;
  log(`impacts: ${list.length} pairings at ${AFTER}@${afterC.slice(0, 8)}, ${W}x${H}`);
  const failed = [], results = {};
  let timing = `Built ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC from ${afterC.slice(0, 8)}.`;
  if (!has("--page-only")) {
    for (const X of list) rmSync(path.join(RAW, X.id), { recursive: true, force: true });
    const B = await launchChrome();
    log(`chrome up in ${B.startMs} ms (pid ${B.pid})`);
    const trees = [];
    try {
      const maps = [...new Set(list.map((X) => X.map))];
      const booted = await Promise.all(maps.map(async (m) => {
        try {
          const T = await bootTree(B, m, afterC, IMP_MAPS[m] || m);
          const ok = await T.pg.evl(impLib(), 30e3);
          if (ok !== true) throw new Error(`tools/shot/page/impacts.js did not install (${ok})`);
          trees.push(T);
          return T;
        } catch (e) {
          for (const X of list) if (X.map === m) failed.push(`${X.mun} → ${X.tgt} (${X.id}): the ${m} page did not boot: ${e.message}`);
          return null;
        }
      }));
      const t1 = Date.now();
      await Promise.all(booted.filter(Boolean).map((T) => runImpactTree(T, list.filter((X) => X.map === T.label), failed, results)));
      timing = `One run: ${Object.keys(results).length}/${list.length} pairings, ${booted.filter(Boolean).map((T) => `${T.label} boot ${(T.bootMs / 1000).toFixed(0)} s`).join(", ")}, capture ${((Date.now() - t1) / 1000).toFixed(0)} s, ${secs()} end to end. ` + timing;
    } finally {
      for (const T of trees) { try { await T.pg.closeTarget(); } catch (_) {} try { T.srv.close(); } catch (_) {} }
      await B.close();
    }
  } else {
    for (const X of list) { const f = path.join(RAW, X.id, "result.json"); if (existsSync(f)) results[X.id] = JSON.parse(readFileSync(f, "utf8")); }
  }
  mkdirSync(IMG, { recursive: true });
  const commits = [...new Set(Object.values(results).map((R) => R.commit).filter(Boolean))];
  if (commits.length > 1) timing += ` Frames from ${commits.map((c) => c.slice(0, 8)).join(" and ")} (pairings reshot after main moved).`;
  writeFileSync(path.join(OUT, "index.html"), impactPage(list, results, failed, timing));
  const bytes = readdirSync(IMG).reduce((s, f) => s + statSync(path.join(IMG, f)).size, 0);
  log(`${failed.length} failed pairing(s)${failed.length ? ":\n  " + failed.join("\n  ") : ""}`);
  log(`images ${(bytes / 1048576).toFixed(1)} MB in ${readdirSync(IMG).length} files; ${timing}`);
  if (!has("--no-pdf")) {
    const t = Date.now();
    try { const pdf = await printPdf(() => impactPage(list, results, failed, timing)); log(`pdf ${(statSync(pdf).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s: ${pdf}`); }
    catch (e) { log("pdf failed: " + e.message); }
  }
  console.log(path.join(OUT, "index.html"));
}

/* -------------------------------------------------------------- the run */
if (KIND === "impacts") { await impactsMain(); process.exit(0); }
const M = manifest();
const M0 = manifest(beforeC);
const ids = val("--ids") ? val("--ids").split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(M).filter((k) => M[k].kind === KIND);
if (!ids.length) { console.error("catalogue: no unit ids (manifest unreadable?)"); process.exit(2); }
const pending = [], units = [];
for (const id of ids) {
  const U = unitDef(id);
  if (!U) { pending.push(((M[id] && M[id].name) || id) + " (no file)"); continue; }
  if (U.stub && !has("--all") && !val("--ids")) { pending.push((M[id] && M[id].name) || id); continue; }
  U.isNew = !M0[id];          // no row on the BEFORE tree: an AFTER-only "new unit" page
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
  try { const pdf = await printPdf(() => page(units, M, all, pending, failed, timing)); log(`pdf ${(statSync(pdf).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(1)} s: ${pdf}`); }
  catch (e) { log("pdf failed: " + e.message); }
}
console.log(path.join(OUT, "index.html"));
