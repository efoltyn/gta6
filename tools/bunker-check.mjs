#!/usr/bin/env node
/* systems/bunkerspace.js — a room under an intact street, and the thing that
 * takes its roof off.
 *
 * A bunker is a hole with a LID on it; a bunker buster is what turns the lid
 * back into a hole. Everything below is that one sentence, asserted:
 *
 *   1. THE STREET IS STILL THERE. A 2-arg floorAt over the room — what a car
 *      wheel and a spawn clamp ask — answers the street. If this fails, traffic
 *      drives into the bunker.
 *   2. THE ROOM IS THERE TOO. The same (x,z), asked from inside, answers the
 *      room floor. One column, two surfaces, chosen by where you are.
 *   3. THE ROOF IS SOLID. ceilAt reports the lid's underside, and a player who
 *      jumps inside is CLAMPED — physics.js has never stopped ascent, so
 *      without this the roof is decorative.
 *   4. A WEAK HIT IS HELD. Ordnance under the lid's rating cracks the street
 *      and stops. If everything got through, the hardened roof means nothing.
 *   5. A PENETRATOR GETS THROUGH, and afterwards the room and the sky are ONE
 *      column: floorAt from above now reaches the floor, and the ground over
 *      the hole has stopped being drawn.
 *   6. YOU CAN WALK IN. The entrance shaft reaches the room's floor.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DUMP = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9960 + Math.floor(Math.random() * 120);
const debugPort = 11600 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-bunker-${debugPort}`;
function findChrome() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  for (const c of ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                   "/opt/pw-browsers/chromium/chrome-linux/chrome",
                   "/usr/bin/chromium", "/usr/bin/google-chrome"]) if (existsSync(c)) return c;
  const pw = "/opt/pw-browsers";
  if (existsSync(pw)) for (const d of readdirSync(pw).filter((x) => x.startsWith("chromium")).sort().reverse()) {
    for (const leaf of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const c = path.join(pw, d, leaf); if (existsSync(c)) return c;
    }
  }
  return "chromium";
}
const base = `http://127.0.0.1:${serverPort}/?seed=90210`;
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore" });
const chrome = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=900,600", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 300000);
    pending.set(id, { resolve, reject, timer: t });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const m = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = m && m.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval failed");
  return r && r.result && r.result.value;
}
const json = async (e) => JSON.parse(await evaluate(`JSON.stringify((function(){${e}})())`));

try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = list.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${serverPort}/`));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      const t = m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || "";
      if (!/ProgressEvent/.test(t)) browserErrors.push(t.slice(0, 200));
      return;
    }
    if (!m.id || !pending.has(m.id)) return;
    const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m);
  });
  await send("Runtime.enable"); await send("Page.enable");
  for (let i = 0; i < 220; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.buildBunker)")) break;
    await sleep(250);
  }

  const failures = [];
  const r = await json(`
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    var step = function (s) { var n = Math.round(s * 60); for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } } };
    step(3);
    var J = CBZ.roadJunctions ? (CBZ.roadJunctions() || []) : [];
    var site = null;
    for (var i = 0; i < J.length; i++) { if (CBZ.groundShaftCanOpen(J[i].x, J[i].z, 10).ok) { site = J[i]; break; } }
    if (!site) return { err: "no legal bunker site" };

    var b = CBZ.buildBunker(site.x, site.z, { hw: 8, hd: 8, height: 3.6, lid: 3.0, name: "test" });
    if (!b) return { err: "buildBunker refused: " + JSON.stringify(CBZ.bunkerSpaceAudit().why) };
    var surf = b.surf;

    // 1 + 2: one column, two surfaces
    var street   = CBZ.floorAt(b.cx, b.cz);                  // 2-arg: a wheel
    var fromAbove= CBZ.floorAt(b.cx, b.cz, surf + 1);
    var inRoom   = CBZ.floorAt(b.cx, b.cz, b.y0 + 1);
    // 3: the roof
    var ceil     = CBZ.ceilAt(b.cx, b.cz, b.y0 + 1);

    // 3b: a real jump inside must be CLAMPED, not pass through the street
    var jumpTop = null, clamped = null;
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.set(b.cx, b.y0 + 0.1, b.cz);
      CBZ.player.vy = 0; CBZ.player.grounded = true;
      step(0.2);
      CBZ.player.vy = 14;                                    // far more than a jump
      var top = CBZ.player.pos.y;
      for (var q = 0; q < 60; q++) { step(1/60); if (CBZ.player.pos.y > top) top = CBZ.player.pos.y; }
      jumpTop = top;
      clamped = top < surf;                                  // never reached the street
    }

    // 4: a weak hit is held by the lid
    var beforeWeak = CBZ.bunkerSpaceAudit().breaches;
    CBZ.cityAirstrikeExplosion(b.cx, b.cz, { power: 1.4, radius: 8, y: surf });
    var afterWeak = CBZ.bunkerSpaceAudit().breaches;

    // 5: a penetrator gets through
    CBZ.cityAirstrikeExplosion(b.cx, b.cz, { power: 4.0, radius: 18, y: surf });
    var afterBust = CBZ.bunkerSpaceAudit();
    var skyToFloor = CBZ.floorAt(b.cx, b.cz);                // now reaches the room
    step(6);

    // is the ground over the breach still being drawn?
    var lid = 0, box = new THREE.Box3();
    var rim = b.breachRim;
    if (rim) {
      CBZ.scene.traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
        for (var p = o; p; p = p.parent) { if (p.userData && p.userData.groundShaft) return; }
        var m = o.material;
        if (m.fog !== false && !(m.defines && m.defines.CBZ_NOMASK)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.y - box.min.y > 3) return;
        if (box.max.y < surf - 3 || box.min.y > surf + 0.35) return;
        if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 1.5) return;
        if (box.max.x < rim.x - rim.mouth || box.min.x > rim.x + rim.mouth) return;
        if (box.max.z < rim.z - rim.mouth || box.min.z > rim.z + rim.mouth) return;
        lid++;
      });
    }

    // 6: the way in on foot
    var ent = b.entrance;
    var entFloor = ent ? CBZ.floorAt(ent.x, ent.z, surf - 1) : null;

    // frame it from inside, looking up through the hole in the roof
    var c = CBZ.camera;
    c.aspect = 900/600; c.fov = 62; c.near = 0.3; c.far = 20000;
    /* The money angle: from above the street, looking down into the hole the
       penetrator made, so the frame carries BOTH the intact road and the lit
       room under it. From inside, the breach just fills the lens with sky. */
    /* Frame the BREACH RIM the way tools/crater-check.mjs frames a crater —
       that camera is known to produce a readable picture of a hole in a street. */
    var rr = b.breachRim || { x: b.cx, z: b.cz, gy: b.surf, r: b.hw, depth: b.surf - b.y0 };
    c.fov = 55;
    /* THE CAMERA IS PARENTED TO A RIG THAT FOLLOWS THE PLAYER, and this check
       teleported the player into the room to test the jump clamp — so every
       position.set() here was LOCAL to a rig sitting inside the bunker, and the
       shot came out identical no matter what numbers it was given. Convert to
       the rig's space so the camera goes where it is told. */
    var want = new THREE.Vector3(rr.x + rr.r * 1.1, rr.gy + 30, rr.z + rr.r * 1.6);
    if (c.parent) { c.parent.updateMatrixWorld(true); c.position.copy(c.parent.worldToLocal(want.clone())); }
    else c.position.copy(want);
    c.updateMatrixWorld(true);
    var look = new THREE.Vector3(rr.x, b.y0 + 0.5, rr.z);
    c.lookAt(look);
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    if (CBZ.skySync) CBZ.skySync();
    var cv = CBZ.renderer.domElement;
    for (var w = 0, ch = Array.prototype.slice.call(document.body.children); w < ch.length; w++) {
      if (ch[w] === cv || (cv && ch[w].contains && ch[w].contains(cv))) continue;
      ch[w].style.visibility = "hidden";
    }
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}

    var ceilUnderBreach = CBZ.ceilAt(b.cx, b.cz, b.y0 + 1);
    return { ceilUnderBreach: ceilUnderBreach, surf: surf, y0: b.y0, y1: b.y1, street: street, fromAbove: fromAbove, inRoom: inRoom,
             ceil: ceil, jumpTop: jumpTop, clamped: clamped,
             weakBreaches: afterWeak - beforeWeak, breaches: afterBust.breaches,
             breached: afterBust.breached, skyToFloor: skyToFloor, lid: lid,
             entFloor: entFloor, hasEntrance: !!ent, audit: afterBust };`);

  if (r.err) failures.push(r.err);
  else {
    const near = (a, b2, e) => Math.abs(a - b2) < (e || 1e-6);
    if (!near(r.street, r.surf)) failures.push(`a 2-arg floorAt over the room answered ${r.street}, not the street ${r.surf} — traffic drives into the bunker`);
    if (!near(r.fromAbove, r.surf)) failures.push(`standing on the lid, floorAt answered ${r.fromAbove}, not ${r.surf}`);
    if (!near(r.inRoom, r.y0)) failures.push(`inside the room, floorAt answered ${r.inRoom}, not the room floor ${r.y0}`);
    if (!near(r.ceil, r.y1)) failures.push(`the roof underside read ${r.ceil}, not ${r.y1}`);
    if (r.clamped !== true) failures.push(`a jump inside the bunker reached ${r.jumpTop} with the street at ${r.surf} — the roof is decorative`);
    if (r.weakBreaches !== 0) failures.push("a weak hit breached a hardened roof — the bunker buster is not the only counter");
    if (!(r.breaches >= 1)) failures.push("a penetrator did NOT get through the lid");
    if (!r.breached) failures.push("the room does not report itself breached");
    if (!near(r.skyToFloor, r.y0, 0.75)) failures.push(`after the breach a 2-arg floorAt still answers ${r.skyToFloor}, not the room floor ${r.y0} — the crater and the room are not one column`);
    if (r.ceilUnderBreach !== null) failures.push(`standing under the breach the roof is still overhead at ${r.ceilUnderBreach} — the hole is plugged`);
    if (r.lid !== 0) failures.push(`${r.lid} ground surfaces still draw over the breach — a hole you cannot see into`);
    if (!r.hasEntrance) failures.push("no entrance shaft was cut — there is no way in on foot");
    if (r.hasEntrance && !near(r.entFloor, r.y0, 1.6)) failures.push(`the entrance bottoms out at ${r.entFloor}, not the room floor ${r.y0} — you cannot walk in`);
  }
  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 3).join(" | ")}`);

  if (!r.err) {
    const png = await send("Page.captureScreenshot", { format: "png" });
    const { writeFile, mkdir: mk } = await import("node:fs/promises");
    await mk(path.join(ROOT, "tools/shots/bunker-qa"), { recursive: true });
    await writeFile(path.join(ROOT, "tools/shots/bunker-qa/breached.png"), Buffer.from(png.result.data, "base64"));
  }
  console.log(JSON.stringify({ r, failures }, null, 2));
  if (failures.length) {
    console.error(`\nBUNKER CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 2;
  } else console.error(`\nBUNKER CHECK PASSED — street above and room below at one (x,z), a jump held by the roof, a weak hit held by the lid, and a penetrator that makes the crater and the room one column.`);
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(200);
  await rm(profile, { recursive: true, force: true });
}
