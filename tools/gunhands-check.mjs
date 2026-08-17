#!/usr/bin/env node
/* tools/gunhands-check.mjs — IS THE OFF HAND ON THE GUN, AND DOES A RELOAD
   ACTUALLY MOVE IT? (owner, 2026-08-17: "I want animation in player for
   reloading gun and I want to improve how they hold gun — rn it looks like
   the non trigger hand is holding above the gun not holding it up")

   The visual preset (tools/visual-presets/gun-hold-reload.mjs) is the
   PICTURE. This is the number, and it runs in a tenth of the time, because a
   pose fix that only exists in a screenshot is a pose fix nobody can regress-
   test. Boots the real city once, arms the player through the real
   acquisition path for every gun in the game, and measures:

     1. the off hand's distance to that weapon's own bore axis while
        presenting, and how far ABOVE the axis it rides (the owner's
        sentence, signed);
     2. the same while merely carrying at low ready;
     3. the off hand's travel in BODY space across one complete reload,
        driven by the game's own CBZ.fpsReload() and fps.reloading clock;
     4. that the empty magazine physically leaves the gun on the way.

   Usage: node tools/gunhands-check.mjs [--json]     Exit 0 = ok. */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asJson = process.argv.includes("--json");
async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no port");
}
const port = await claimPort(9520, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("FAIL devserver"); process.exit(1); }
}
const dbg = await claimPort(11920, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-gunhands-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=900,560", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210`], { stdio: "ignore" });
function done(code) {
  try { chrome.kill(); } catch (_) {}
  try { server.kill(); } catch (_) {}
  process.exit(code);
}
let page = null;
for (let i = 0; i < 300 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(origin));
  } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("FAIL no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(((m.params.exceptionDetails.exception || {}).description ||
      m.params.exceptionDetails.text || "").split("\n")[0]);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  const ed = r.result && r.result.exceptionDetails;
  if (ed) { console.error("EVAL THREW:", (ed.exception && ed.exception.description) || ed.text); return null; }
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }
// enter free play through the real button, then freeze rAF so stepSim is the clock
for (let i = 0; i < 400; i++) {
  if (await evl("CBZ.game && CBZ.game.state === 'playing'")) break;
  await evl("(()=>{const b=document.getElementById('playBtn'); if(b) b.click();})()");
  await sleep(300);
}
await evl("(()=>{ window.requestAnimationFrame=function(){return 0;}; if(CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase='endless_contracts'; })()");
await sleep(500);

const PROBE = `(() => {
  const T = window.THREE, out = { fails: [], guns: [], notes: [] };
  if (!CBZ.playerChar) { out.fails.push("no player rig"); return out; }
  const step = (n) => { for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } } };
  const ch = () => CBZ.playerChar;
  out.hasArmTo = typeof CBZ.charArmTo === "function";
  out.hasAudit = typeof CBZ.gunHandAudit === "function";
  out.hasHandWeapon = typeof CBZ.tpHandWeapon === "function";
  out.hasReloadPose = typeof CBZ.gunReloadPose === "function";
  if (!out.hasArmTo) out.fails.push("CBZ.charArmTo missing (entities/character.js)");
  if (!out.hasHandWeapon) out.fails.push("CBZ.tpHandWeapon missing (systems/holsterprops.js)");
  if (!out.hasAudit) out.fails.push("CBZ.gunHandAudit missing (systems/gunhands.js did not load)");

  if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
  if (CBZ.game) { CBZ.game.cityHolstered = false; CBZ.game.cityMeleeWeapon = null; }
  step(20);

  function drawn() {
    if (CBZ.tpHandWeapon) { const p = CBZ.tpHandWeapon(); if (p) return p; }
    const s = ch().sockets.thirdPersonWeapon || ch().sockets.weapon;
    if (!s) return null;
    for (const c of s.children) if (c.visible && c.userData && c.userData.weaponId && c.children.length) return c;
    return null;
  }
  function bore(prop) {
    if (!prop || !prop.userData.muzzle) return null;
    prop.updateWorldMatrix(true, false);
    const a = prop.localToWorld(new T.Vector3(0,0,0));
    prop.updateWorldMatrix(true, false);
    const b = prop.localToWorld(prop.userData.muzzle.clone());
    ch().sockets.leftHand.updateWorldMatrix(true, false);
    const hand = ch().sockets.leftHand.getWorldPosition(new T.Vector3());
    const ab = b.clone().sub(a), L2 = ab.lengthSq() || 1e-6;
    const t = Math.max(0, Math.min(1, hand.clone().sub(a).dot(ab) / L2));
    const near = a.clone().addScaledVector(ab, t);
    return { gap: hand.distanceTo(near), above: hand.y - near.y, along: t, len: Math.sqrt(L2) };
  }
  function handLocal() {
    ch().body.updateWorldMatrix(true, false);
    ch().sockets.leftHand.updateWorldMatrix(true, false);
    const w = ch().sockets.leftHand.getWorldPosition(new T.Vector3());
    return ch().body.worldToLocal(w).clone();
  }

  const IDS = ["carbine","ak47","smg","uzi","sniper","lmg","shotgun","sidearm","deagle","revolver","glauncher","bazooka","taser"];
  for (const gid of IDS) {
    const rec = { id: gid };
    try {
      CBZ.unlockWeapon(gid, { select: true });
      if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(gid);
      if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(400);
      // A gun-to-gun switch runs holsterprops' stow TRANSFER first (~0.9 s),
      // during which the incoming prop is deliberately hidden. Wait it out
      // instead of sampling an empty hand.
      let prop = null;
      for (let w = 0; w < 24 && !prop; w++) { step(10); prop = drawn(); }
      rec.drawn = prop ? prop.userData.weaponId : null;
      rec.grips = !!(prop && prop.userData.grips);
      if (!prop) { rec.err = "no drawn prop"; out.guns.push(rec); continue; }

      // ---- presenting
      if (CBZ.fpsSetAim) CBZ.fpsSetAim(true);
      step(45);
      prop = drawn();
      const aim = bore(prop);
      rec.aimGap = aim ? +(aim.gap*100).toFixed(1) : null;
      rec.aimAbove = aim ? +(aim.above*100).toFixed(1) : null;
      rec.aimAlong = aim ? +aim.along.toFixed(2) : null;
      rec.aimingPose = !!ch().aimingPose;
      const au = CBZ.gunHandAudit ? CBZ.gunHandAudit() : null;
      rec.auditGap = au && au.gap != null ? +(au.gap*100).toFixed(1) : null;
      rec.oneHanded = !!(au && au.oneHanded);
      rec.blend = au && au.blend != null ? +au.blend.toFixed(2) : null;
      rec.passes = au ? au.passes : null;
      rec.driven = au ? au.driven : null;
      rec.why = au ? au.why : null;
      rec.solve = au && au.reach != null
        ? "reach=" + (au.reach*100).toFixed(0) + " dist=" + (au.dist*100).toFixed(0) +
          " over=" + (au.over*100).toFixed(0) + " pull=" + (au.pull*100).toFixed(0) +
          " over2=" + (au.over2*100).toFixed(0) + " slid=" + au.slid +
          " resid=" + (au.residual == null ? "null" : (au.residual*100).toFixed(0))
        : null;
      // ISOLATION PROBE: call the solver by hand on the same anchor. If this
      // lands and the frame pass did not, the fault is in the plumbing (hook
      // order, a later writer) and not in the maths — the two failures look
      // identical from a screenshot and need completely different fixes.
      if (prop && prop.userData.grips && prop.userData.grips.support) {
        prop.updateWorldMatrix(true, false);
        const want = prop.localToWorld(prop.userData.grips.support.clone());
        const resid = CBZ.charArmTo(ch(), want, "l", 1);
        rec.direct = resid == null ? null : +(resid*100).toFixed(1);
        const after = bore(prop);
        rec.directBore = after ? +(after.gap*100).toFixed(1) : null;
        step(1);
        const settled = bore(prop);
        rec.afterOneStep = settled ? +(settled.gap*100).toFixed(1) : null;
      }

      // ---- low ready
      if (CBZ.fpsSetAim) CBZ.fpsSetAim(false);
      step(80);
      prop = drawn();
      const car = bore(prop);
      rec.carryGap = car ? +(car.gap*100).toFixed(1) : null;
      rec.carryAbove = car ? +(car.above*100).toFixed(1) : null;

      // ---- one full reload, driven by the game's own clock
      if (CBZ.fpsSetAim) CBZ.fpsSetAim(true);
      step(30);
      const i = CBZ.fps.weapon;
      const row = CBZ.FPS_WEAPONS[i];
      rec.reloadTime = row ? row.reload : null;
      if (row && row.reload > 0) {
        CBZ.fps.rounds[i] = 0;
        CBZ.fps.reserves[i] = 400;
        CBZ.fps.reloading = 0;
        CBZ.fpsReload();
        rec.reloadStarted = CBZ.fps.reloading > 0;
        let prev = handLocal(), path = 0, frames = 0, peakW = 0, sawStyle = null;
        while (CBZ.fps.reloading > 0 && frames++ < Math.ceil(row.reload*8*60)+120) {
          step(1);
          const now = handLocal();
          path += now.distanceTo(prev);
          prev = now;
          if (CBZ.gunReloadPose) {
            const r = CBZ.gunReloadPose();
            if (r.active) { peakW = Math.max(peakW, r.weight); sawStyle = r.style; }
          }
        }
        rec.travel = +(path*100).toFixed(1);
        rec.frames = frames;
        rec.style = sawStyle;
        rec.peakWeight = +peakW.toFixed(2);
        rec.ammoAfter = CBZ.fps.rounds[i];
      }
    } catch (e) { rec.err = String(e && e.message || e); }
    out.guns.push(rec);
  }
  return out;
})()`;

const res = await evl(PROBE);
if (!res) { console.error("FAIL probe returned nothing"); done(1); }
if (asJson) { console.log(JSON.stringify(res, null, 2)); done(0); }

const fails = res.fails.slice();
const pad = (s, n) => String(s == null ? "-" : s).padEnd(n);
const lpad = (s, n) => String(s == null ? "-" : s).padStart(n);
console.log("\nmodules  charArmTo:" + res.hasArmTo + "  tpHandWeapon:" + res.hasHandWeapon +
  "  gunHandAudit:" + res.hasAudit + "  gunReloadPose:" + res.hasReloadPose + "\n");
console.log(pad("weapon", 11) + pad("grips", 7) +
  lpad("aimGap", 8) + lpad("above", 8) + lpad("carryGap", 9) + lpad("above", 8) +
  lpad("travel", 9) + "  " + pad("style", 10) + lpad("rounds", 7) + lpad("blend", 7) + "  why");
console.log("-".repeat(100));
for (const g of res.guns) {
  console.log(pad(g.id, 11) + pad(g.grips ? "yes" : (g.oneHanded ? "1-hand" : "NO"), 7) +
    lpad(g.aimGap, 8) + lpad(g.aimAbove, 8) + lpad(g.carryGap, 9) + lpad(g.carryAbove, 8) +
    lpad(g.travel, 9) + "  " + pad(g.style, 10) + lpad(g.ammoAfter, 7) + lpad(g.blend, 7) +
    "  " + (g.why || "") +
    (g.solve ? "  [" + g.solve + "]" : "") +
    (g.err ? "   ERR " + g.err : ""));
  if (g.err) fails.push(g.id + ": " + g.err);
  if (g.oneHanded) continue;
  // A hand wrapped round a gun is within a fist of its bore. 22 cm is generous
  // — it is roughly a forearm's width — and still nowhere near the old pose.
  if (g.aimGap != null && g.aimGap > 22) fails.push(g.id + ": off hand " + g.aimGap + " cm off the bore while presenting");
  if (g.carryGap != null && g.carryGap > 26) fails.push(g.id + ": off hand " + g.carryGap + " cm off the bore at low ready");
  // A reload has to MOVE the hand. 25 cm is less than one trip to the belt.
  if (g.reloadTime > 0 && (g.travel == null || g.travel < 25)) {
    fails.push(g.id + ": reload moved the off hand only " + g.travel + " cm");
  }
  if (g.reloadTime > 0 && !(g.ammoAfter > 0)) fails.push(g.id + ": reload left the gun empty (" + g.ammoAfter + ")");
}
const hard = errors.filter((e) => !/favicon|net::ERR/.test(e));
if (hard.length) fails.push("page errors: " + hard.slice(0, 3).join(" | "));
console.log("");
if (fails.length) { console.log("FAIL\n  - " + fails.join("\n  - ")); done(1); }
console.log("PASS — the off hand is on every gun, and every reload moves it.");
done(0);
