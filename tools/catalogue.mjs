#!/usr/bin/env node
/* tools/catalogue.mjs — THE BEFORE/AFTER CATALOGUE of NPC War's units.

     node tools/catalogue.mjs --kind vehicle                 every vehicle that has its own art on AFTER
     node tools/catalogue.mjs --ids m1_abrams,hmmwv          just these
     node tools/catalogue.mjs --kind vehicle --page-only     rebuild index.html from the shots already taken

   For every unit it asks the shot service (tools/shot, the warm Chrome pool:
   this tool never launches a browser) for:

     BEFORE vs AFTER turntable  one two-sided request: front, side, 3/4, rear,
                                top, close-up, plus a hero 3/4, on the studio
                                stage. BEFORE = --before (default 5864f6a5, the
                                NPC War split, where every vehicle was still the
                                generic city model), AFTER = --after (origin/main).
     AFTER in action            ONE request on one sim timeline (a JS request
                                costs its page and a reboot is held while the Mac
                                is loaded, so one boot buys the whole story), on
                                the real ground (--map, default dunes), the lens
                                on the unit (cam=<id>):
                                  move      driving / flying in, dust or rotor wash
                                  fire      foes set out ahead, the main weapon fired
                                            (vehFire), flash + round in flight
                                  dismount  (if it carries men) the benches filled
                                            through the roster grammar, the squad
                                            out once foes are inside dismountAt
                                  wreck     killed through the page's own damage route
     facts                      read from the unit's own file at AFTER (node vm,
                                a stub registry): dimensions, mass, speed, armour
                                by facing, crew seats, passengers, weapons

   Output: --out (default ~/harness/out/gta6/catalogue/<kind>s/) holds index.html
   and img/*.webp (max 1280 px, cwebp; sips JPEG when cwebp is missing). Raw
   frames are cached under ~/harness/out/gta6/catalogue/_raw/<kind>s/<id>/<req>/,
   keyed by the unit file's blob at AFTER + the before ref + the request: a rerun
   only shoots what changed. --fresh reshoots everything.

   A unit whose AFTER file is still the wave-A stub (it says "No new art in wave
   A") is listed as pending and not shot; --all shoots it anyway.

   Options: --before REF  --after REF  --map ID  --fresh  --all  --page-only
            --only turntable,action   --ids a,b (stubs included)   --wait-min N (default 40)
            --agent NAME (shot fairness queue name, default "catalogue")       */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readJson, resultPath } from "./shot/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
if (has("--help") || has("-h")) { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\* ?/, "")); process.exit(0); }
const g = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[catalogue]", ...a);

const KIND = val("--kind", "vehicle");
const BEFORE = val("--before", "5864f6a5");
const AFTER = val("--after", "origin/main");
const MAP = val("--map", "dunes");
const AGENT = val("--agent", "catalogue");
const ONLY = val("--only") ? new Set(val("--only").split(",")) : null;
const RETRIES = +val("--retries", 6);
const WAIT_MS =(+val("--wait-min", 40) || 40) * 60e3;
const ROOT = path.join(os.homedir(), "harness/out/gta6/catalogue");
const OUT = path.resolve(val("--out", path.join(ROOT, KIND + "s")));
const RAW = path.join(ROOT, "_raw", KIND + "s");
const IMG = path.join(OUT, "img");
if (KIND !== "vehicle") { console.error("catalogue: only --kind vehicle is wired so far (animals next: add their request set + facts reader)"); process.exit(2); }

const beforeC = g(["rev-parse", BEFORE + "^{commit}"]);
const afterC = g(["rev-parse", AFTER + "^{commit}"]);

/* ------------------------------------------------------------ the facts */
// run a file from AFTER in a sandbox whose CBZ only records what it registers
function sandboxRun(src, CBZ) {
  const ctx = { console: { log() {}, warn() {}, error() {} }, Math, JSON, Object, Array, Number, String, CBZ };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.runInNewContext(src, ctx, { timeout: 2000 });
  return ctx;
}
function manifest() {
  const C = {};
  sandboxRun(g(["show", `${afterC}:src/units/manifest.js`]), C);
  return C.UNIT_MANIFEST || (C.unitKit && C.unitKit.manifest) || null;
}
function unitDef(id) {
  const file = `src/units/vehicles/${id}.js`;
  let src; try { src = g(["show", `${afterC}:${file}`]); } catch (_) { return null; }
  const got = {};
  try { sandboxRun(src, { unitKit: { register: (k, d) => { got[k] = d; } } }); } catch (e) { log(id, "facts: file threw in the sandbox:", e.message); }
  const head = (/^\/\*[\s\S]*?\*\//.exec(src) || [""])[0];
  const title = ((/units\/vehicles\/[\w.]+\s+[—-]+\s+([^\n]+)/.exec(head) || [])[1] || "").replace(/\s+$/, "");
  const stub = /No new art in wave A/.test(head);
  let blob = ""; try { blob = g(["rev-parse", `${afterC}:${file}`]); } catch (_) {}
  return { id, def: got[id] || null, title, stub, blob, lines: src.split("\n").length };
}

/* ---------------------------------------------------------- the requests */
const TT = [
  ["hero", "orbit:38:12:0.62"], ["front", "front"], ["side", "side"], ["3q", "3q"],
  ["rear", "back"], ["top", "top"], ["close", "orbit:28:14:0.42"],
];
const fnameCam = (c) => c.replace(/[^\w]+/g, "_");
const fname = (side, pose, t, cam) => `${side ? side + "-" : ""}${pose}-t${String(t).replace(".", "_")}-${fnameCam(cam)}.jpg`;

/* THE ACTION TIMELINE, one request per unit (a request with JS costs its page,
   and a fresh boot is held while the Mac is loaded, so one boot buys it all):
     0 .. FIRE   move: foes far ahead (ground) / the helicopter flying in
     FIRE        foes set out ahead, the main weapon fired (vehFire)
     .. KILL     the fight goes on; a carrier's squad dismounts (foes inside dismountAt)
     KILL        killed through the page's own damage route; the lens stays on the wreck
   Run once after spawning with S, B, CBZ, THREE in scope; MAP and vehFire are
   globals of the battle's classic scripts. The events ride B.advance, which
   __shot.at(t) calls once per frame time. */
function actJs(id, P) {
  return `(function () {
  var ID = ${JSON.stringify(id)}, P = ${JSON.stringify(P)};
  var R = B.roster(), u = R.filter(function (m) { return m.vehicle && m.team === "red" && m.unitId === ID; })[0];
  if (!u) throw new Error("no " + ID + " on the field");
  function foes() { return B.roster().filter(function (m) { return m.team === "blue" && !m.inVeh && !m.vehicle && !m.dead; }); }
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
      if (hurt) hurt(u, 1e9, { byTeam: "blue", dir: { x: -Math.sin(u.h), z: -Math.cos(u.h) }, cause: "shot" });
      // the shot's lens skips the dead: from here the field it frames is the wreck
      B.roster = function () { return [u]; };
    } },
  ];
  var adv = B.advance, T = 0;
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

const WIDE = "orbit:125:10:2.4";
function timeline(U) {
  const d = U.def || {}, S = d.stats || {}, air = d.domain === "air", carrier = (d.passengers || 0) > 0;
  const mv = air ? [1.5, 4] : [4, 7];
  const fire = mv[1] + 0.2;
  const fr = [fire + 0.04, fire + 0.25, fire + 0.7];
  const dm = carrier ? (air ? [fire + 5, fire + 9] : [fire + 2.3, fire + 4.3]) : [];
  const kill = (dm.length ? dm[dm.length - 1] : fr[2]) + 0.6;
  const wr = [kill + 0.3, kill + 2.5, kill + 6];
  const r2 = (x) => Math.round(x * 100) / 100;
  // the frames the page shows: [time, cam, label]
  const show = [
    [mv[0], "hot", "On the move"], [mv[1], WIDE, air ? "Inbound, rotor wash" : "Dust off the tracks"],
    [fr[0], "hot", "Main weapon fires"], [fr[0], WIDE, "Muzzle flash, wide"], [fr[1], WIDE, "Round downrange"], [fr[2], "hot", "Fight on"],
    ...dm.map((t, i) => [t, WIDE, i ? "Squad on the ground" : "Squad dismounts"]),
    [wr[0], "hot", "Knocked out"], [wr[1], WIDE, "Burning wreck"], [wr[2], "hot", "Wreck, 6 s on"],
  ].map(([t, c, l]) => [String(r2(t)), c, l]);
  return {
    P: { moveD: air ? 0 : (S.standoff || 200) + 320, fire: r2(fire), fireD: air ? 220 : 170, kill: r2(kill) },
    times: [...mv, ...fr, ...dm, ...wr].map((t) => String(r2(t))),
    show,
  };
}

function requestsFor(U) {
  const d = U.def || {}, id = U.id;
  const crewN = (d.crew || []).length, pass = d.passengers || 0;
  const roster = pass > 0 ? `${id}*1,men*${crewN + pass}&n=${crewN + pass + 1}` : id;
  const TL = timeline(U);
  const R = [
    { key: "turntable", ba: true, setup: `species=${id}`, cams: TT.map((c) => c[1]), times: ["0"], size: "1280x800" },
    { key: "action", setup: `species=${roster}&pose=fight&vs=men&vn=8&stage=map&map=${MAP}&cam=${id}`, js: actJs(id, TL.P),
      cams: ["hot", WIDE], times: TL.times, size: "1280x800", show: TL.show },
  ];
  return ONLY ? R.filter((r) => ONLY.has(r.key)) : R;
}

function expectedFrames(r) {
  const pose = (/pose=(\w+)/.exec(r.setup) || [0, "idle"])[1], o = [];
  for (const side of r.ba ? ["before", "after"] : [""]) for (const t of r.times) for (const cam of r.cams) o.push(fname(side, pose, t, cam));
  return o;
}
function framesComplete(U, r, dir) {
  return expectedFrames(r).every((f) => existsSync(path.join(dir, f)) && statSync(path.join(dir, f)).size > 2000);
}
function reqKey(U, r) {
  return createHash("sha1").update(JSON.stringify([U.blob, r.ba ? beforeC : "", r, 3])).digest("hex").slice(0, 16);
}

/* ---------------------------------------------------------- the shooting */
function submit(U, r, dir) {
  const a = [path.join(HERE, "shot/req.mjs"), "--agent", AGENT, "--branch", afterC, "--no-merge", "--setup", r.setup,
    "--cams", r.cams.join(","), "--times", r.times.join(","), "--size", r.size, "--jpg", "--out", dir];
  if (r.ba) a.push("--before", beforeC);
  if (r.js) a.push("--js", r.js);
  const out = execFileSync(process.execPath, a, { cwd: REPO, encoding: "utf8" });
  const m = /shot (\S+) queued/.exec(out);
  if (!m) throw new Error("req.mjs said: " + out.trim());
  return m[1];
}
async function shootAll(units) {
  const jobs = [];
  for (const U of units) for (const r of requestsFor(U)) {
    const dir = path.join(RAW, U.id, r.key), key = reqKey(U, r), meta = readJson(path.join(dir, "meta.json"));
    if (!has("--fresh") && meta && meta.key === key && (meta.status === "done" || framesComplete(U, r, dir))) { log(`${U.id}/${r.key}: cached`); continue; }
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    jobs.push({ U, r, dir, key });
  }
  if (!jobs.length) return;
  log(`${jobs.length} request(s) to the shot service`);
  // the service queues fairly (2 in flight per agent): submit everything, then watch
  for (const j of jobs) {
    try { j.id = submit(j.U, j.r, j.dir); log(`${j.U.id}/${j.r.key}: ${j.id}`); }
    catch (e) { j.err = e.message; log(`${j.U.id}/${j.r.key}: submit failed: ${e.message}`); }
  }
  const t0 = Date.now();
  for (;;) {
    let open = 0;
    for (const j of jobs) {
      if (!j.id || j.done) continue;
      const res = readJson(resultPath(j.id));
      if (res && (res.status === "done" || res.status === "error")) {
        /* HARNESS TRAP: on a loaded Mac the service holds world boots (load > 4 x
           cores) and a request dies at SHOT_JOB_MS while it waits. Nothing was
           wrong with it: ask again (a few times) instead of shipping a hole. */
        if (res.status === "error" && !framesComplete(j.U, j.r, j.dir) && (j.tries = (j.tries || 0) + 1) <= RETRIES) {
          log(`${j.U.id}/${j.r.key}: ${res.error}; asking again (${j.tries}/${RETRIES})`);
          try { j.id = submit(j.U, j.r, j.dir); open++; continue; } catch (e) { log(`resubmit failed: ${e.message}`); }
        }
        j.done = true;
        writeJson2(path.join(j.dir, "meta.json"), { key: j.key, id: j.id, status: res.status, error: res.error || null, warn: res.warn || [], sides: res.sides, req: j.r });
        log(`${j.U.id}/${j.r.key}: ${res.status}${res.error ? " " + res.error : ""} (${Math.round((Date.now() - t0) / 1000)} s)`);
      } else open++;
    }
    if (!open) break;
    if (Date.now() - t0 > WAIT_MS) { log(`gave up waiting after ${WAIT_MS / 60e3} min; ${open} still out (rerun to pick them up)`); break; }
    await sleep(2000);
  }
}
function writeJson2(p, o) { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 1)); }

/* ------------------------------------------------------------ the images */
const CWEBP = (() => { for (const p of ["/opt/homebrew/bin/cwebp", "/usr/local/bin/cwebp", "/usr/bin/cwebp"]) if (existsSync(p)) return p; return null; })();
function squeeze(src, base) {
  if (!existsSync(src) || statSync(src).size < 2000) return null;     // a blank / failed frame
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

const TT_LABEL = { hero: "3/4 hero", front: "Front", side: "Side", "3q": "3/4", rear: "Rear", top: "Top", close: "Close-up" };

function collect(U, failed) {
  const out = { before: {}, after: {}, action: [] };
  for (const r of requestsFor(U)) {
    const dir = path.join(RAW, U.id, r.key), meta = readJson(path.join(dir, "meta.json"));
    if (!meta) { failed.push(`${U.id}/${r.key}: not shot`); continue; }
    // HARNESS TRAP: under heavy load a request can time out in its LAST page
    // call (clear / the sheet) after every frame was written: use what is on disk
    if (meta.status !== "done" && !framesComplete(U, r, dir)) failed.push(`${U.id}/${r.key}: ${meta.error || meta.status} (partial)`);
    const pose = /pose=(\w+)/.exec(r.setup) ? /pose=(\w+)/.exec(r.setup)[1] : "idle";
    if (r.key === "turntable") {
      for (const side of ["before", "after"]) TT.forEach(([name, cam]) => {
        const p = squeeze(path.join(dir, fname(side, pose, "0", cam)), `${U.id}-${side}-${name}`);
        if (p) out[side][name] = p; else failed.push(`${U.id}/${side}/${name}: empty frame`);
      });
    } else {
      // the curated frames (every time x cam is on disk in _raw; the page shows the story)
      for (const [t, cam, label] of r.show) {
        const p = squeeze(path.join(dir, fname("", pose, t, cam)), `${U.id}-${r.key}-${String(t).replace(".", "_")}-${fnameCam(cam)}`);
        if (p) out.action.push({ src: p, label, key: r.key });
        else failed.push(`${U.id}/${r.key} "${label}" (t=${t} ${cam}): no frame`);
      }
    }
  }
  return out;
}

/* -------------------------------------------------------------- the page */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? "–" : (+n).toLocaleString("en-US", { maximumFractionDigits: d }));
function wname(id) {
  return String(id).replace(/_/g, " ").replace(/\b(\d+)mm\b/i, "$1 mm").replace(/\b([a-z]{1,4}\d[\w-]*|m\d+\w*)\b/gi, (m) => m.toUpperCase())
    .replace(/\b50cal\b/i, ".50 cal").replace(/\b(rws|coax|tow|agm|hydra|stbd)\b/gi, (m) => m.toUpperCase());
}
function specCard(U, M) {
  const d = U.def || {}, S = d.stats || {}, A = S.armour || {}, CE = S.armourCE || null;
  const row = (k, v) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`;
  const arm = ["front", "side", "rear", "top"].map((f) => `<div class="arm"><span>${f}</span><b>${fmt(A[f], 0)}</b>${CE ? `<i>${fmt(CE[f], 0)} CE</i>` : ""}<div class="bar"><div style="width:${Math.min(100, Math.sqrt((A[f] || 0) / 820) * 100).toFixed(1)}%"></div></div></div>`).join("");
  const weapons = (d.weapons || []).map((w) => `<li><b>${esc(wname(w.id))}</b><span>${esc(w.kind)}${w.range ? ` · ${fmt(w.range, 0)} m` : ""}${w.pen ? ` · ${fmt(w.pen, 0)} mm pen` : ""}${w.ammo ? ` · ${fmt(w.ammo, 0)} rds` : ""}${w.rof ? ` · ${fmt(w.rof, 2)}/s` : ""}</span></li>`).join("");
  const crew = (d.crew || []).map((c) => c.seat).join(", ") || (S.remote ? "flown remotely" : "–");
  return `<aside class="spec">
    <h4>Specification</h4>
    ${row("Role", esc((d.tactics && d.tactics.role) || d.drive || d.domain || "–"))}
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
    <ul class="wpn">${weapons || "<li>unarmed</li>"}</ul>
    <p class="src">From <code>src/units/vehicles/${esc(U.id)}.js</code> @ ${afterC.slice(0, 8)}</p>
  </aside>`;
}
function section(U, M, shots, n) {
  const name = (M && M[U.id] && M[U.id].name) || U.id;
  const ba = shots.before.hero && shots.after.hero
    ? `<div class="ba" style="--p:50%"><img src="${shots.after.hero}" alt="${esc(name)} after" loading="lazy"><div class="ba-b"><img src="${shots.before.hero}" alt="${esc(name)} before" loading="lazy"></div><div class="ba-line"></div><span class="tag l">Before</span><span class="tag r">After</span><input type="range" min="0" max="100" value="50" aria-label="before/after"></div>`
    : `<div class="ba missing">${shots.after.hero ? `<img src="${shots.after.hero}">` : "no hero frame"}</div>`;
  const tt = (side) => TT.filter(([k]) => k !== "hero").map(([k]) => shots[side][k]
    ? `<figure><img src="${shots[side][k]}" loading="lazy" alt=""><figcaption>${TT_LABEL[k]}</figcaption></figure>` : `<figure class="miss"><figcaption>${TT_LABEL[k]}: no frame</figcaption></figure>`).join("");
  const act = shots.action.map((a) => `<figure><img src="${a.src}" loading="lazy" alt=""><figcaption>${esc(a.label)}</figcaption></figure>`).join("");
  return `<section class="unit" id="${U.id}">
  <header><div class="num">${String(n).padStart(2, "0")}</div><div><h2>${esc(name)}</h2><p class="sub">${esc(U.title)}</p></div></header>
  ${ba}
  <div class="grid2">
    <div>
      <h3>Turntable <small>after</small></h3><div class="strip">${tt("after")}</div>
      <h3>Turntable <small>before</small></h3><div class="strip before">${tt("before")}</div>
      <h3>In action <small>after, ${esc(MAP)}</small></h3><div class="strip act">${act || "<p class='miss'>no action frames</p>"}</div>
    </div>
    ${specCard(U, M)}
  </div>
</section>`;
}
function page(units, M, all, pending, failed) {
  const toc = units.map((U, i) => `<a href="#${U.id}"><span>${String(i + 1).padStart(2, "0")}</span>${esc((M[U.id] || {}).name || U.id)}${all[U.id].after.hero ? `<img src="${all[U.id].after.hero}" alt="">` : ""}</a>`).join("");
  const kindT = KIND[0].toUpperCase() + KIND.slice(1) + "s";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NPC War ${kindT}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0d0e10;--panel:#15171a;--line:#262a2f;--ink:#e9e6df;--mute:#8d9096;--acc:#d9a441;--red:#c8463c}
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
.strip.before figure img{filter:saturate(.85)}
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
#lb{position:fixed;inset:0;background:#000e;display:none;place-items:center;z-index:9;cursor:zoom-out}#lb img{max-width:96vw;max-height:92vh;border-radius:6px}#lb.on{display:grid}
@media (max-width:900px){.grid2{grid-template-columns:1fr}.spec{position:static}.num{font-size:44px}.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.strip.act{grid-template-columns:1fr}}
</style></head><body>
<div class="wrap">
<div class="mast"><div class="kick">NPC War · before / after catalogue</div><h1>${kindT}</h1>
<p>Every ${KIND} as it looked before the campaign (the generic city models at ${beforeC.slice(0, 8)}) and as it is now on main (${afterC.slice(0, 8)}). Drag the line across each hero image. Turntables are on the studio stage, action frames are from the live battle sim on the ${esc(MAP)} ground. Specs are read straight from each unit's file.</p>
<nav class="toc">${toc}</nav>
${pending.length ? `<p class="pend">Not redrawn yet, so not in this issue: ${pending.map(esc).join(", ")}.</p>` : ""}
</div>
${units.map((U, i) => section(U, M, all[U.id], i + 1)).join("\n")}
${failed.length ? `<div class="fail"><h3>Frames that failed</h3><ul>${failed.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
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
const M = manifest() || {};
let ids = val("--ids") ? val("--ids").split(",").map((s) => s.trim()).filter(Boolean)
  : Object.keys(M).filter((k) => M[k].kind === KIND);
if (!ids.length) { console.error("catalogue: no unit ids (manifest unreadable?)"); process.exit(2); }
const pending = [], units = [];
for (const id of ids) {
  const U = unitDef(id);
  if (!U) { pending.push(id + " (no file)"); continue; }
  if (U.stub && !has("--all") && !val("--ids")) { pending.push((M[id] && M[id].name) || id); continue; }
  units.push(U);
}
log(`${units.length} ${KIND}(s): ${units.map((u) => u.id).join(", ")}${pending.length ? `; pending: ${pending.join(", ")}` : ""}`);
log(`before ${BEFORE}@${beforeC.slice(0, 8)}  after ${AFTER}@${afterC.slice(0, 8)}  ground ${MAP}`);
if (!has("--page-only")) await shootAll(units);
mkdirSync(IMG, { recursive: true });
const failed = [], all = {};
for (const U of units) all[U.id] = collect(U, failed);
writeFileSync(path.join(OUT, "index.html"), page(units, M, all, pending, failed));
const bytes = readdirSync(IMG).reduce((s, f) => s + statSync(path.join(IMG, f)).size, 0);
log(`${failed.length} failed frame(s)${failed.length ? ":\n  " + failed.join("\n  ") : ""}`);
log(`images ${(bytes / 1048576).toFixed(1)} MB in ${readdirSync(IMG).length} files`);
console.log(path.join(OUT, "index.html"));
