/* tools/testbus/worlds.mjs — what a world is, how to boot one into a page, and
   how a probe runs against it.

   A WORLD is a page + a door + a "built" predicate. Add one here and every
   probe can ask for it by name.

   A PROBE is a self-contained module (no imports; it gets everything from `t`):

     export const meta = {
       world: "president",   // which world (default: the request's --world)
       seed: 260811,         // optional; part of the world key
       fresh: true,          // needs a world no earlier probe has dirtied (default true)
       dirties: true,        // leaves the world changed for later probes (default true)
       timeoutMs: 900000,
     };
     export default async function (t) {
       await t.step(240);                        // CBZ.stepSim x N, camera matrices kept fresh
       const n = await t.evl("CBZ.cityPeds.length");
       t.log("peds", n);
       return { ok: n > 0, summary: n + " peds", data: { n } };
     }

   `t`: evl(expr, ms) / fn(body, ms) (a function body, returns {__err} on throw,
   the president-check idiom) / step(n) / wait(expr, ms, every) / sleep(ms) /
   log(...) / errors() (the boot's page errors + this probe's) / allErrors() /
   args (string[]) / flag(name) / arg(name, dflt) / seed / world / send (raw CDP).
   A probe that throws is an ERROR; { ok:false } is a FAIL.

   A plain `.js` probe is evaluated IN the page: its source must be a function
   expression `async function (tb) { ... return { ok, summary } }` (tb = window.__tb,
   with tb.step(n)). Meta goes in a first-line comment: // testbus {"world":"city"}

   Isolation: before each probe the bus snapshots the player (pos, vel, hp,
   camera yaw) and restores it after. That is a SOFT reset. A probe that
   changes the world itself (kills people, starts protests, wraps CBZ
   functions) must say dirties:true; a probe that needs an untouched world
   says fresh:true and the bus reboots the page (or uses another page) for it. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { sleep } from "./lib.mjs";

const PRES_READY = "CBZ.game.state==='playing' && CBZ.game.mode==='city' && (CBZ.govComplexes||[]).some(function(s){return s&&s.id==='execmansion'&&s.rect}) && !!CBZ.presidency && !!(CBZ.interactions&&CBZ.interactions.wheelOf)";
export const WORLDS = {
  city: {
    page: "index.html", seed: 90210, query: "",
    enter: "(function(){var b=document.getElementById('playBtn'); if (b && CBZ.game.state!=='playing') b.click();})()",
    ready: "CBZ.game.state==='playing' && CBZ.game.mode==='city' && !!(CBZ.city&&CBZ.city.arena&&CBZ.city.arena.roads&&CBZ.city.arena.roads.length)",
  },
  president: {
    page: "index.html", seed: 260811, query: "cfg_RENDER_FRAMES=0",
    enter: "(function(){ if (CBZ.game.state==='playing') return; var o=document.querySelector('[data-origin=\"president\"]'); if (o && !o.classList.contains('active')) o.click(); var b=document.getElementById('playBtn'); if (b) b.click(); })()",
    ready: PRES_READY,
  },
  escape: {
    page: "index.html", seed: 90210, query: "mode=escape",
    enter: "(function(){ if (CBZ.game.state==='playing') return; if (CBZ.game.mode!=='escape' && CBZ.setMode) CBZ.setMode('escape'); var m=document.querySelector('[data-mode=\"escape\"]'); if (m) m.click(); var b=document.getElementById('playBtn'); if (b) b.click(); })()",
    ready: "CBZ.game.state==='playing' && CBZ.game.mode==='escape' && (CBZ.npcs||[]).length>0",
  },
  survival: {
    page: "disaster.html", seed: 1, query: "",
    enter: "(function(){ if (CBZ.game.state==='playing') return; var m=document.querySelector('.mode-btn[data-mode=\"survival\"]'); if (m) m.click(); var b=document.getElementById('playBtn'); if (b) b.click(); })()",
    ready: "CBZ.game.state==='playing' && CBZ.game.mode==='survival' && !!(CBZ.surv&&CBZ.surv.arena)",
  },
  battle: {
    page: "games/battle.html", seed: 1, query: "auto=1&map=dunes&red=40&blue=40",
    engine: "!!window.__battle", enter: "0", noFreeze: true,   // the battle runs on rAF: drive it with __battle.speed()
    ready: "!!(window.__battle && __battle.audit().started)",
  },
};
WORLDS.disaster = WORLDS.survival;
WORLDS.prison = WORLDS.escape;

export function worldKey(name, seed, query) {
  const W = WORLDS[name];
  if (!W) throw new Error(`unknown world "${name}" (know: ${Object.keys(WORLDS).join(", ")})`);
  return `${name}|${seed != null && seed !== "" ? seed : W.seed}|${query || ""}`;
}
export function parseKey(key) { const [name, seed, query] = key.split("|"); return { name, seed, query }; }

/* bootWorld(pg, origin, key) — navigate the page, walk through the door, wait
   until the world is built, freeze rAF, install window.__tb. Returns timings. */
export async function bootWorld(pg, origin, key, timeoutMs = 15 * 60e3) {
  const { name, seed, query } = parseKey(key);
  const W = WORLDS[name];
  const t0 = Date.now();
  const u = new URL(W.page, origin);
  for (const [k, v] of new URLSearchParams(W.query)) u.searchParams.set(k, v);
  for (const [k, v] of new URLSearchParams(query || "")) u.searchParams.set(k, v);
  u.searchParams.set("seed", String(seed));
  // a reload must be a NEW game: no save from the last run on this origin
  try { await pg.send("Storage.clearDataForOrigin", { origin: origin.replace(/\/$/, ""), storageTypes: "local_storage,indexeddb,cache_storage,service_workers" }); } catch (_) {}
  pg.errors.length = 0;
  await pg.send("Page.navigate", { url: u.href });
  const until = t0 + timeoutMs;
  const engine = W.engine || "window.CBZ && CBZ.game && CBZ.stepSim";
  const q = (e) => pg.evl(`(function(){try{return !!(${e})}catch(e){return false}})()`, 60000).catch(() => false);
  while (Date.now() < until && !(await q(engine))) await sleep(300);
  let ok = false;
  while (Date.now() < until && !ok) {
    try { await pg.evl(`(function(){try{${W.enter}}catch(e){}return 1})()`, 60000); } catch (_) {}
    ok = await q(W.ready);
    if (!ok) await sleep(500);
  }
  if (!ok) throw new Error(`world ${key} never became ready in ${Math.round(timeoutMs / 1000)} s; page errors: ${pg.errors.slice(0, 3).join(" | ")}`);
  const builtMs = Date.now() - t0;
  pg.bootErrors = pg.errors.length;
  if (!W.noFreeze) await pg.evl("window.__tbFreeze && __tbFreeze()");
  await pg.evl(TB_INSTALL);
  const files = await pg.evl("performance.getEntriesByType('resource').map(function(e){try{return new URL(e.name).pathname.replace(/^\\//,'')}catch(_){return ''}}).filter(Boolean)");
  return { bootMs: builtMs, url: u.href, loaded: [...new Set([W.page, ...(files || [])])] };
}

/* window.__tb: the in-page half — sim stepping that keeps the camera's matrices
   fresh (renderer.render would, and with frames off nobody else does), and the
   soft snapshot. */
const TB_INSTALL = `(function(){
  var T = window.__tb = window.__tb || {};
  T.step = function (n, dt) {
    dt = dt || 1 / 60;
    for (var k = 0; k < n; k++) {
      if (CBZ.hitstop) CBZ.hitstop = 0;
      CBZ.stepSim(dt);
      var c = CBZ.camera;
      if (c) { c.updateMatrixWorld(true); if (c.matrixWorldInverse) c.matrixWorldInverse.copy(c.matrixWorld).invert(); }
    }
    return true;
  };
  T.snap = function () {
    var P = CBZ.player; if (!P || !P.pos) return null;
    return { pos: [P.pos.x, P.pos.y, P.pos.z], vel: P.vel ? [P.vel.x, P.vel.y, P.vel.z] : null, hp: P.hp, dead: !!P.dead,
      yaw: CBZ.cam ? CBZ.cam.yaw : null, pitch: CBZ.cam ? CBZ.cam.pitch : null, state: CBZ.game.state, mode: CBZ.game.mode };
  };
  T.restore = function (s) {
    if (!s) return false;
    var P = CBZ.player; if (!P || !P.pos) return false;
    try { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) CBZ.campaignUI.clearDialogue(); } catch (e) {}
    P.pos.set(s.pos[0], s.pos[1], s.pos[2]);
    if (P.vel && s.vel) P.vel.set(s.vel[0], s.vel[1], s.vel[2]);
    if (s.hp != null) P.hp = s.hp;
    if (CBZ.cam && s.yaw != null) CBZ.cam.yaw = s.yaw;
    if (CBZ.cam && s.pitch != null) CBZ.cam.pitch = s.pitch;
    return true;
  };
  return true;
})()`;

/* loadProbe(file) -> { meta, run, kind } */
export async function loadProbe(file) {
  if (/\.mjs$/.test(file)) {
    const mod = await import(pathToFileURL(file).href + "?t=" + Date.now());
    if (typeof mod.default !== "function") throw new Error(`${file}: a probe module must export default async function (t)`);
    return { kind: "module", meta: { fresh: true, dirties: true, ...(mod.meta || {}) }, run: mod.default };
  }
  const src = readFileSync(file, "utf8");
  const m = /^\s*\/\/\s*testbus\s+(\{.*\})/.exec(src);
  const meta = { fresh: true, dirties: true, ...(m ? JSON.parse(m[1]) : {}) };
  const body = src.replace(/^\s*\/\/\s*testbus.*\n/, "");
  return { kind: "page", meta, run: (t) => t.evl(`Promise.resolve((${body})(window.__tb))`, t.timeoutMs) };
}

/* runProbe(pg, probe, opts) -> { status, ms, summary, data, log[] } */
export async function runProbe(pg, probe, { args = [], seed, world, timeoutMs } = {}) {
  const log = [];
  const err0 = pg.errors.length;
  timeoutMs = probe.meta.timeoutMs || timeoutMs || 30 * 60e3;
  const t = {
    args, seed, world, timeoutMs,
    send: pg.send,
    evl: (e, ms) => pg.evl(e, ms || 10 * 60e3),
    async fn(body, ms) {
      try { return await pg.evl(`(function(){${body}})()`, ms || 10 * 60e3); }
      catch (e) { if (e.timeout || /page went away/.test(e.message)) throw e; return { __err: String(e.message) }; }
    },
    step: (n, ms) => pg.evl(`__tb.step(${n | 0})`, ms || 10 * 60e3),
    async wait(expr, ms = 60000, every = 250) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        try { if (await pg.evl(`(function(){try{return !!(${expr})}catch(e){return false}})()`, 60000)) return true; } catch (_) {}
        await sleep(every);
      }
      return false;
    },
    sleep,
    log: (...a) => log.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")),
    errors: () => pg.errors.slice(0, Math.min(pg.bootErrors || 0, err0)).concat(pg.errors.slice(err0)),   // the boot's + this probe's
    allErrors: () => pg.errors.slice(),
    flag: (f) => args.includes(f),
    arg: (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; },
  };
  const t0 = Date.now();
  let snap = null;
  try { snap = await pg.evl("__tb.snap()", 30000); } catch (_) {}
  let res, status;
  try {
    let timer;
    res = await Promise.race([
      Promise.resolve(probe.run(t)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`probe timed out after ${Math.round(timeoutMs / 1000)} s`), { timeout: true })), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    status = res && res.ok ? "pass" : "fail";
  } catch (e) {
    status = "error";
    res = { ok: false, summary: "ERROR " + String(e && e.message || e).split("\n")[0], broken: !!(e && e.timeout) || pg.closed };
  }
  if (!pg.closed && !(res && res.broken)) { try { await pg.evl(`__tb.restore(${JSON.stringify(snap)})`, 30000); } catch (_) {} }
  return { status, ms: Date.now() - t0, summary: (res && res.summary) || "", data: res && res.data, log, broken: !!(res && res.broken) };
}
