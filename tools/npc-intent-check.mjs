#!/usr/bin/env node
/* ============================================================
   tools/npc-intent-check.mjs — DO ARMED PEOPLE DRAW FOR A REASON, AND DO
   PEOPLE TURN LIKE PEOPLE?

   OWNER (2026-10-08): "Security guards and everyone with guns pulls guns out
   randomly, especially. And they move glitchy right to left, like looking
   right and left. Make AI move more intentionally."

   Boots Gang City headless (the same boot as city-nav-check), freezes rAF and
   drives CBZ.stepSim, sampling every body within the 90 m visible band on
   every frame, through three phases:
     calm       nothing happens (the player stands at spawn, hands empty)
     armed      the player's pistol is OUT, he stands there (no aim, no shot)
     farshot    a gunshot is heard 70 m away every 4 s (cityPanic + postAlert)

   Per body, per phase:
     yaw flips/s      the body's yaw RATE changed sign (both sides > 0.8 rad/s)
                      within 0.5 s: a twitch left-right, never a real turn
     jitter rad/s     per 1 s window, sum|dyaw| - |net dyaw|: back-and-forth
     look flips/s     the same test on the neck's yaw (head look)
     draws            hand-held gun prop hidden -> shown; "flicker" = a draw
                      within 2 s of the last holster (or the reverse)
     calm-drawn %     share of armed-body time the gun is in the hand in the
                      CALM phase (a patrol carries it holstered)
   And from CBZ.gunDiscipline (systems/actorweapons.js) when it exists: every
   draw's logged REASON, asserted to be one of the real triggers.

     node tools/npc-intent-check.mjs [--seconds 20] [--diag]
   Exit 0 = pass.  --diag prints the worst bodies with their state.
============================================================ */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SECONDS = parseFloat(arg("--seconds", "20"));
const DIAG = argv.includes("--diag");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8920 + Math.floor(Math.random() * 40);
const dbg = port + 1000;
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const profile = `/tmp/cbz-npcintent-${dbg}`;
await rm(profile, { recursive: true, force: true });
for (let i = 0; i < 60; i++) { try { const r = await fetch(base); if (r.ok) break; } catch (_) {} await sleep(250); }
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

let booted = false;
for (let i = 0; i < 120 && !booted; i++) {
  booted = (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) === true;
  if (booted) break;
  if (i % 12 === 11) await send("Page.navigate", { url: base });
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('city'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(900);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='city');");
}
console.log(`playing(city): ${playing}  ${SECONDS}s per phase`);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

// freeze the real loop: only stepSim advances time from here
await evl(`CBZ.__rafHold = true; window.requestAnimationFrame = function(){ return 0; }; return true;`);
// settle the city (spawns, first thinks)
await evl(`for (var k=0;k<240;k++){ CBZ.hitstop=0; CBZ.slowmo=1; CBZ.stepSim(1/60);} return true;`);

// the in-page sampler
const SAMPLER = `
window.__NI = (function(){
  var TAU = Math.PI*2;
  function wrap(a){ a=(a+Math.PI)%TAU; if(a<0)a+=TAU; return a-Math.PI; }
  var GUARD = /security|guard|protection|agent|sentry|soldier|bodyguard|bouncer|sniper|warden|marshal|bureau/i;
  function cat(a, cop){
    if (a.__fighter) return "fighter"; if (cop) return "cop";
    if (GUARD.test(a.job||"") || GUARD.test(a.role||"") || a._post || a.guard || a.homeGuard || a._detail || a.kind==="security") return "guard";
    if (a.gang) return "gang";
    if (a.armed || a._holster || a._beltGun) return "armedCiv";
    return "ped";
  }
  function sock(a){ var ch=a.char; return ch && ch.sockets && (ch.sockets.thirdPersonWeapon||ch.sockets.weapon||ch.sockets.rightHand); }
  function drawn(a){ var p=a._weaponProp; return !!(p && p.visible && p.parent && p.parent===sock(a) && !a.dead); }
  var rec = new Map(), phase = "", frame = 0, DT = 1/60, draws = [];
  function R(a, cop){
    var r = rec.get(a);
    if (!r) { r = { a:a, cat:cat(a,cop), ph:{} }; rec.set(a, r); }
    var p = r.ph[phase];
    if (!p) { p = r.ph[phase] = { cat:cat(a,cop), f:0, yaw:null, lsS:0, lsT:-9, flips:0, nyaw:null, nlsS:0, nlsT:-9, nflips:0,
      wSum:0, wNet:0, jit:0, win:0, dr:null, draws:0, hols:0, flick:0, lastTog:-99, armedF:0, drawnF:0, ctx:[] }; }
    return p;
  }
  function sample(){
    frame++;
    var P = CBZ.player && CBZ.player.pos; if (!P) return;
    var pools = [[CBZ.cityPeds||[], false], [CBZ.cityCops||[], true]];
    var t = frame*DT;
    for (var q=0;q<pools.length;q++){ var L=pools[q][0];
      for (var i=0;i<L.length;i++){ var a=L[i];
        if (!a || !a.pos || !a.group || a.dead || a.inCar || a.culled || a._parked || (a.ko|0)>0) continue;
        var dx=a.pos.x-P.x, dz=a.pos.z-P.z; if (dx*dx+dz*dz > 90*90) { var rr=rec.get(a); if (rr&&rr.ph[phase]) rr.ph[phase].yaw=null; continue; }
        var ph=a._phys; if (ph && (ph.down>0 || ph.air || ph.heldBy)) continue;
        var r = R(a, pools[q][1]); r.f++;
        var y = a.group.rotation.y;
        if (r.yaw != null) {
          var d = wrap(y - r.yaw), w = d/DT;
          r.wSum += Math.abs(d); r.wNet += d;
          if (Math.abs(w) > 0.8) { var s = w>0?1:-1; if (r.lsS && s!==r.lsS && t-r.lsT < 0.5) r.flips++; r.lsS=s; r.lsT=t; }
          if (++r.win >= 60) { r.jit += Math.max(0, r.wSum - Math.abs(r.wNet)); r.wSum=0; r.wNet=0; r.win=0; }
        }
        r.yaw = y;
        var nk = a.char && a.char.neck;
        if (nk) { var ny = nk.rotation.y;
          if (r.nyaw != null) { var nw = (ny - r.nyaw)/DT; if (Math.abs(nw) > 0.8) { var ns = nw>0?1:-1; if (r.nlsS && ns!==r.nlsS && t-r.nlsT<0.5) r.nflips++; r.nlsS=ns; r.nlsT=t; } }
          r.nyaw = ny; }
        var hasGun = !!(a.armed || a._holster || a._beltGun || a._weaponProp);
        if (hasGun) r.armedF++;
        var dn = drawn(a);
        if (dn) r.drawnF++;
        if (r.dr != null && dn !== r.dr) {
          if (t - r.lastTog < 2) r.flick++;
          r.lastTog = t;
          if (dn) { r.draws++; if (r.ctx.length < 4) r.ctx.push({ st:a.state||"", rage:!!a.rage, sees:!!a.sees, al:+(a.alarmed||0).toFixed(1),
             gd:(a._gd && a._gd.why)||"", stars:(CBZ.game&&CBZ.game.wanted)|0 }); }
          else r.hols++;
        }
        r.dr = dn;
      }
    }
  }
  function report(ph){
    var C = {};
    var worst = [];
    rec.forEach(function(rr){ var r = rr.ph[ph]; if (!r || r.f < 60) return;
      var c = C[r.cat] || (C[r.cat] = { n:0, secs:0, flips:0, nflips:0, jit:0, draws:0, flick:0, armedF:0, drawnF:0, twitchy:0 });
      var s = r.f/60; c.n++; c.secs += s; c.flips += r.flips; c.nflips += r.nflips; c.jit += r.jit; c.draws += r.draws; c.flick += r.flick;
      c.armedF += r.armedF; c.drawnF += r.drawnF; if (r.flips/s > 0.5) c.twitchy++;
      worst.push({ cat: r.cat, job: rr.a.job||rr.a.role||"", st: rr.a.state||"", fps: +(r.flips/s).toFixed(2), jit: +(r.jit/s).toFixed(2), nfps:+(r.nflips/s).toFixed(2), draws: r.draws, flick: r.flick, ctx: r.ctx });
    });
    var out = {};
    for (var k in C) { var c = C[k];
      out[k] = { n:c.n, flipsPerS: +(c.flips/Math.max(1,c.secs)).toFixed(3), lookFlipsPerS: +(c.nflips/Math.max(1,c.secs)).toFixed(3),
        jitter: +(c.jit/Math.max(1,c.secs)).toFixed(3), twitchy: c.twitchy, drawsPerMin: +(c.draws/Math.max(1,c.secs)*60).toFixed(2),
        flickers: c.flick, armedSecs: Math.round(c.armedF/60), drawnPct: c.armedF ? Math.round(100*c.drawnF/c.armedF) : 0 }; }
    worst.sort(function(a,b){ return (b.fps+b.jit*0.2+b.flick) - (a.fps+a.jit*0.2+a.flick); });
    return { cats: out, worst: worst.slice(0, 8) };
  }
  return { setPhase:function(p){ phase=p; }, sample:sample, report:report };
})(); return true;`;
await evl(SAMPLER);

const phaseLog = {};
async function runPhase(name, setup, tick) {
  if (setup) { const r = await evl(setup); if (r && r.__err) console.log("setup err", r.__err); }
  const t0 = await evl(`return CBZ.gunDiscipline ? CBZ.gunDiscipline.now() : 0;`);
  const frames = Math.round(SECONDS * 60);
  const chunk = 300;
  for (let f = 0; f < frames; f += chunk) {
    const r = await evl(`__NI.setPhase(${JSON.stringify(name)});
      for (var k=0;k<${chunk};k++){ var fr=${f}+k; ${tick || ""}
        CBZ.hitstop=0; CBZ.slowmo=1; CBZ.stepSim(1/60); __NI.sample(); }
      return true;`);
    if (r && r.__err) { console.log("step err", r.__err); break; }
  }
  phaseLog[name] = await evl(`var D = CBZ.gunDiscipline; if (!D) return null;
    return D.log().filter(function (e) { return e.t >= ${Number(t0) || 0} - 1e-6; });`);
  return evl(`return __NI.report(${JSON.stringify(name)});`);
}

const res = {};
res.calm = await runPhase("calm", `CBZ.game.cityHolstered = true; return true;`);
res.armed = await runPhase("armed", `
  try { CBZ.unlockWeapon && CBZ.unlockWeapon("pistol", { select: true }); } catch (e) {}
  if (!(CBZ.equippedWeapon && CBZ.equippedWeapon())) { var inv=CBZ.weaponInventory||[]; if (inv.length) CBZ.setCurrentWeapon(inv[0].id||inv[0]); }
  CBZ.game.cityHolstered = false; return !!(CBZ.cityHasGun && CBZ.cityHasGun());`);
res.farshot = await runPhase("farshot", `CBZ.game.cityHolstered = true; return true;`,
  `if (fr % 240 === 0) { var P=CBZ.player.pos, x=P.x+70, z=P.z; try{ CBZ.cityPanic && CBZ.cityPanic(x, z, 1, null); }catch(e){} try{ CBZ.cityPostAlert && CBZ.cityPostAlert(x, z, 92, null); }catch(e){} }`);
// a real fight: armed bodies near the player set on each other in pairs
// (re-asserted every half second so the fight lasts the phase), then called
// off and watched cooling down. They are the "fighter" category.
const FIGHT_SETUP = `
  var P = CBZ.player.pos, L = CBZ.cityPeds || [], pick = [];
  for (var i = 0; i < L.length && pick.length < 6; i++) { var a = L[i];
    if (!a || a.dead || !a.armed || a.culled || a.inCar || a.controlled || a.kind === "cop") continue;
    var dx = a.pos.x - P.x, dz = a.pos.z - P.z; if (dx*dx + dz*dz > 55*55) continue; pick.push(a); }
  if (pick.length % 2) pick.pop();
  window.__FIGHT = pick; for (var j = 0; j < pick.length; j++) pick[j].__fighter = 1;
  return pick.length;`;
const FIGHT_TICK = `if (fr % 30 === 0) { var F = window.__FIGHT || []; for (var q = 0; q + 1 < F.length; q += 2) { var a = F[q], b = F[q+1];
  if (a.dead || b.dead) continue; a.rage = b; b.rage = a; a.state = b.state = "fight"; a.alarmed = b.alarmed = 8; } }`;
const nFight = await evl(FIGHT_SETUP);
console.log(`fight pairs: ${(nFight | 0) / 2}`);
res.fight = await runPhase("fight", null, FIGHT_TICK);
res.cool = await runPhase("cool", `var F = window.__FIGHT || []; for (var q = 0; q < F.length; q++) { var a = F[q]; a.rage = null; if (a.state === "fight") a.state = "walk"; a.alarmed = 0; a.fear = 0; } return F.length;`,
  `if (fr % 30 === 0) { var F = window.__FIGHT || []; for (var q = 0; q < F.length; q++) { F[q].rage = null; if (F[q].state === "fight") F[q].state = "walk"; } }`);
const coolEnd = await evl(`var F = window.__FIGHT || [], out = 0, n = 0; for (var q = 0; q < F.length; q++) { var a = F[q]; if (a.dead) continue; n++;
  var p = a._weaponProp; if (p && p.visible) out++; } return { n: n, out: out };`);
const disc = await evl(`var D = CBZ.gunDiscipline; if (!D) return null; return { log: D.log().slice(-200), audit: D.audit ? D.audit() : null };`);

const PHASES = ["calm", "armed", "farshot", "fight", "cool"];
const CATS = ["cop", "guard", "gang", "armedCiv", "ped", "fighter"];
for (const ph of PHASES) {
  const R = res[ph];
  if (!R || R.__err) { console.log(ph, "ERR", R && R.__err); continue; }
  console.log(`\n== ${ph}`);
  console.log("  cat        n   yawFlips/s  lookFlips/s  jitter rad/s  twitchy  draws/min  flickers  armed-s  drawn%");
  for (const c of CATS) { const s = R.cats[c]; if (!s) continue;
    console.log(`  ${c.padEnd(9)} ${String(s.n).padStart(3)}   ${String(s.flipsPerS).padStart(9)}  ${String(s.lookFlipsPerS).padStart(10)}  ${String(s.jitter).padStart(12)}  ${String(s.twitchy).padStart(7)}  ${String(s.drawsPerMin).padStart(9)}  ${String(s.flickers).padStart(8)}  ${String(s.armedSecs).padStart(7)}  ${String(s.drawnPct).padStart(6)}`);
  }
  if (DIAG) for (const w of R.worst) console.log("   worst", JSON.stringify(w));
  const PL = phaseLog[ph];
  if (PL) {
    const by = {};
    for (const e of PL) { const k = `${e.kind}:${e.why}`; by[k] = (by[k] || 0) + 1; }
    console.log(`  discipline: ${Object.entries(by).map(([k, v]) => `${k} x${v}`).join("  ") || "nothing"}`);
  }
}

// ---- the gate
const results = [];
function check(name, ok, detail) { results.push(ok); console.log((ok ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
console.log("");
const allOf = (ph, k) => { let n = 0, s = 0; for (const c of CATS) { const v = res[ph] && res[ph].cats && res[ph].cats[c]; if (v) { n += v.n; s += v[k] * v.n; } } return n ? s / n : 0; };
const sum = (ph, k, cats) => { let s = 0; for (const c of cats || CATS) { const v = res[ph] && res[ph].cats && res[ph].cats[c]; if (v) s += v[k]; } return s; };
const ARMED = ["cop", "guard", "gang", "armedCiv"];
const calmDrawn = (() => { let a = 0, d = 0; for (const c of ARMED) { const v = res.calm.cats[c]; if (v) { a += v.armedSecs; d += v.armedSecs * v.drawnPct / 100; } } return a ? Math.round(100 * d / a) : 0; })();
check("calm: armed people carry the gun holstered", calmDrawn <= 5, `${calmDrawn}% of armed time drawn`);
check("calm: no draws at all", sum("calm", "drawsPerMin", ARMED) === 0, `draws/min by cat ${ARMED.map((c) => (res.calm.cats[c] || {}).drawsPerMin || 0).join("/")}`);
// a gun in view is a reason to WATCH. The one draw it may earn is a police
// officer's open-carry stop ("Is that a gun? Put it away"), which is an
// order and is logged as one.
{
  const civ = sum("armed", "drawsPerMin", ["guard", "gang", "armedCiv"]);
  const L = (phaseLog.armed || []).filter((e) => e.kind === "draw" && e.ak === "cop");
  const badCop = L.filter((e) => !(/order|target|fired/.test(e.why)));
  check("player's gun out (not aimed): nobody draws on sight alone", civ === 0 && badCop.length === 0,
    `non-police draws/min ${civ}, police draws ${L.length} (${L.map((e) => e.why).join(",") || "none"})`);
}
check("no draw/holster flicker in any phase", PHASES.every((p) => sum(p, "flickers") === 0),
  PHASES.map((p) => p + " " + sum(p, "flickers")).join(" / "));
{
  const F = (res.fight && res.fight.cats && res.fight.cats.fighter) || null;
  const why = (phaseLog.fight || []).filter((e) => e.kind === "draw").map((e) => e.why);
  check("fight: the fighters drew, for a reason", !!F && F.drawsPerMin > 0 && why.every((w) => /assault|fired|shot-at|armed-threat/.test(w)),
    F ? `${F.n} fighters, draws/min ${F.drawsPerMin}, reasons ${[...new Set(why)].join(",") || "-"}` : "no fighters");
  check("fight: fighters turn, they do not twitch (yaw flips < 0.3/s)", !!F && F.flipsPerS < 0.3, F ? String(F.flipsPerS) : "-");
  check("cool-down: every gun back on the belt by the end", coolEnd && coolEnd.out === 0, coolEnd ? `${coolEnd.out}/${coolEnd.n} still out` : "-");
  const C = (res.cool && res.cool.cats && res.cool.cats.fighter) || null;
  check("cool-down: they held it a while first (no instant holster)", !!C && C.drawnPct >= 25, C ? `drawn ${C.drawnPct}% of the cool-down` : "-");
}
for (const ph of ["calm", "armed", "farshot"]) {
  const f = allOf(ph, "flipsPerS"), l = allOf(ph, "lookFlipsPerS");
  check(`${ph}: yaw flips under 0.05/s per body`, f < 0.05, f.toFixed(3));
  check(`${ph}: look flips under 0.05/s per body`, l < 0.05, l.toFixed(3));
}
if (disc) {
  const OK = /^(fired|shot-at|shots-near|assault|armed-threat|aimed-at|ward|order|post|target|hunt)/;
  const bad = (disc.log || []).filter((e) => e.kind === "draw" && !OK.test(e.why || ""));
  check("every logged draw carries a real reason", bad.length === 0, `${(disc.log || []).filter((e) => e.kind === "draw").length} draws, ${bad.length} unexplained ${bad.slice(0, 3).map((e) => e.why).join(",")}`);
  if (DIAG) console.log("discipline audit", JSON.stringify(disc.audit));
} else check("CBZ.gunDiscipline exists (draw-reason ring)", false);

const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
if (uniq.length) console.log("page errors:", uniq.slice(0, 8));
const fails = results.filter((r) => !r).length;
console.log(fails ? `NPC-INTENT: FAIL (${fails}/${results.length})` : `NPC-INTENT: ok (${results.length} checks)`);
done(fails ? 1 : 0);
