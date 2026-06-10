#!/usr/bin/env node
// Two-browser multiplayer integration test.
// Boots server/server.js, launches TWO isolated headless Chromes (CDP), has
// them both join the server, and asserts the host/guest split end to end:
//   host: elected, simulates real peds/cars, sees the guest's avatar
//   guest: zero local sim, receives puppet peds/cars, sees the host's avatar,
//          mirrors the shared wanted level, receives chat + shot events
// Usage: node tools/test-net-browser.mjs
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 18800 + Math.floor(Math.random() * 150);
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log("  ✓ " + label + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  ✗ FAIL " + label + (detail ? " — " + detail : "")); }
};

// ---- tiny CDP client --------------------------------------------------------
class Page {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    };
    this.ready = new Promise((r) => { this.ws.onopen = r; });
  }
  cmd(method, params) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }
  async eval(expr, awaitP = false) {
    const r = await this.cmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: awaitP });
    if (r.result && r.result.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.result.exceptionDetails.exception));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async waitFor(expr, timeout = 30000, label = expr) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v;
      try { v = await this.eval(expr); } catch (e) { /* page still loading */ }
      if (v) return v;
      await sleep(300);
    }
    throw new Error("timeout waiting for: " + label);
  }
}

async function launchChrome(url) {
  const port = 19300 + Math.floor(Math.random() * 600);
  const dir = `/tmp/cbz-net-chrome-${port}`;
  await rm(dir, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--enable-unsafe-swiftshader", "--mute-audio",
    "--disable-background-networking", "--disable-component-update",
    "--disable-default-apps", "--disable-extensions", "--no-default-browser-check",
    "--no-first-run", "--ignore-certificate-errors", "--window-size=1280,800",
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, url,
  ], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page" && t.url.includes("127.0.0.1"));
    } catch (e) {}
  }
  if (!target) throw new Error("chrome did not expose a page");
  const page = new Page(target.webSocketDebuggerUrl);
  await page.ready;
  await page.cmd("Runtime.enable");
  return { proc, page, dir };
}

const JOIN = (name, role) => `
  (function(){
    if (window._joinKicked) return window._joined ? 1 : 0;
    window._joinKicked = 1;
    window._chatLog = []; window._gotShot = 0;
    CBZ.net.on("chat", function(m){ window._chatLog.push(m.kind + "|" + m.name + "|" + m.text); });
    CBZ.net.onEv("shot", function(){ window._gotShot = 1; });
    var btn = document.querySelector('.mode-btn[data-mode="city"]');
    if (btn) btn.click();
    CBZ.net.connect({ name: ${JSON.stringify(name)}, role: ${JSON.stringify(role)},
      onWelcome: function(){ try { CBZ.startRun(); window._joined = 1; } catch(e) { window._joinErr = String(e); } },
      onError: function(r){ window._joinErr = r; } });
    return 0;
  })()`;

(async function main() {
  console.log("== two-browser multiplayer integration test (server :" + PORT + ") ==");
  // scratch config so the user's real server.json is untouched
  const cfgDir = mkdtempSync(join(tmpdir(), "cbz-mpb-"));
  const cfgPath = join(cfgDir, "server.json");
  writeFileSync(cfgPath, JSON.stringify({ name: "Browser Test City", motd: "hi", password: "", adminPass: "", maxPlayers: 8, port: PORT, roles: [{ id: "civ", label: "Civilian" }, { id: "police", label: "Police" }] }));
  const server = spawn(process.execPath, [join(ROOT, "server", "server.js")], { env: { ...process.env, CBZ_CONFIG: cfgPath, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  await sleep(800);

  let A, B;
  try {
    A = await launchChrome(`http://127.0.0.1:${PORT}/`);
    await A.page.waitFor("!!(window.CBZ && CBZ.net && CBZ.startRun)", 40000, "game A loaded");
    await A.page.eval(JOIN("HostAnna", "civ"));
    await A.page.waitFor("window._joined === 1 || window._joinErr", 20000, "A joined");
    const aErr = await A.page.eval("window._joinErr || ''");
    ok(!aErr, "browser A joins the server", aErr || "welcome + startRun");
    await A.page.waitFor("CBZ.game.state === 'playing'", 20000, "A playing");
    ok(await A.page.eval("CBZ.net.isHost()"), "A elected sim host");
    const aPeds = await A.page.waitFor("CBZ.cityPeds.length", 20000, "A peds spawned");
    ok(aPeds > 10, "host simulates the real population", aPeds + " peds");

    B = await launchChrome(`http://127.0.0.1:${PORT}/`);
    await B.page.waitFor("!!(window.CBZ && CBZ.net && CBZ.startRun)", 40000, "game B loaded");
    await B.page.eval(JOIN("GuestBen", "police"));
    await B.page.waitFor("window._joined === 1 || window._joinErr", 20000, "B joined");
    const bErr = await B.page.eval("window._joinErr || ''");
    ok(!bErr, "browser B joins the server", bErr || "welcome + startRun");
    await B.page.waitFor("CBZ.game.state === 'playing'", 20000, "B playing");
    ok(await B.page.eval("CBZ.net.guest()"), "B is a guest (host stays A)");

    // guest never simulates: no local peds/cops/cars
    const bLocal = await B.page.eval("JSON.stringify([CBZ.cityPeds.length, CBZ.cityCops.length, CBZ.cityCars.length])");
    ok(bLocal === "[0,0,0]", "guest spawns ZERO local sim entities", bLocal);

    // ...but receives the host's world as puppets
    const bPuppets = await B.page.waitFor("CBZ.netPuppetTargets([]).length", 25000, "puppets on B");
    ok(bPuppets > 10, "guest renders host-synced puppet NPCs", bPuppets + " puppets");

    // both see each other's avatar rigs
    const aSeesB = await A.page.waitFor("(function(){var r=CBZ.netRemoteActor(2);return r&&r.group?1:0})()", 45000, "A sees B");
    ok(!!aSeesB, "host renders the guest's avatar");
    const bSeesA = await B.page.waitFor("(function(){var r=CBZ.netRemoteActor(1);return r&&r.group?1:0})()", 45000, "B sees A");
    ok(!!bSeesA, "guest renders the host's avatar");
    const tag = await A.page.eval("(function(){var r=CBZ.netRemoteActor(2);return r&&r.tag?1:0})()");
    ok(!!tag, "remote avatar carries a name·role tag");

    // chat flows end to end (server stamps names)
    await B.page.eval("CBZ.net.chat('radio check')");
    await A.page.waitFor("window._chatLog.some(function(l){return l.indexOf('say|GuestBen|radio check')>=0})", 15000, "chat A<-B");
    ok(true, "chat: guest -> host");
    await A.page.eval("CBZ.net.chat('/me waves')");
    await B.page.waitFor("window._chatLog.some(function(l){return l.indexOf('me|HostAnna|waves')>=0})", 15000, "/me B<-A");
    ok(true, "chat: /me emote host -> guest");

    // gunshot event fans out
    await A.page.eval("CBZ.net.onShot({x:0,y:2,z:0},{x:1,y:0,z:0},{key:'ak47',range:40})");
    await B.page.waitFor("window._gotShot === 1", 15000, "shot ev on B");
    ok(true, "shot events reach other players");

    // shared heat: host wanted level mirrors onto the guest HUD
    await A.page.eval("CBZ.game.wanted = 3");
    const bw = await B.page.waitFor("CBZ.game.wanted >= 3 ? CBZ.game.wanted : 0", 15000, "wanted sync");
    ok(bw >= 3, "guest mirrors the host's wanted level", "wanted=" + bw);

    // guest hit routing: shoot a puppet -> host ped loses hp
    const hit = await B.page.eval(`(function(){
      var t = CBZ.netPuppetTargets([]).filter(function(p){return p.netKind==='ped' && !p.dead})[0];
      if (!t) return 'no-target';
      CBZ.net.localGunHit(t, {dist: 5, head: false}, {damage: 30, headMult: 2, dropStart: 10, minDamage: .4, range: 40, key: 'pistol'});
      return t.nid;
    })()`);
    if (hit === "no-target") ok(false, "guest shot routes to host ped");
    else {
      const hurt = await A.page.waitFor(`(function(){
        var p = CBZ.cityPeds.find(function(q){return q.nid===${JSON.stringify(hit)}});
        return p && (p.hp < (p.maxHp || 100) || p.dead) ? 1 : 0;
      })()`, 15000, "host ped hurt");
      ok(!!hurt, "guest's bullet damages the HOST-authoritative ped", "nid " + hit);
    }

    // car ownership transfer: guest requests a synced car and ends up DRIVING it
    const carReq = await B.page.eval(`(function(){
      var best=null, bd=1e9, P=CBZ.player.pos;
      // ask for the nearest puppet car regardless of distance (test shortcut)
      for (var i=0;i<1;i++){}
      var cars=[]; // collect from networld via a probe: any car visual under arena with nid
      return 'use-direct';
    })()`);
    // direct protocol path: find a car nid from the world stream on B
    const carNid = await B.page.eval(`(function(){
      var got = 0;
      // puppet cars aren't exposed; sample from the last world message instead
      return new Promise(function(res){
        CBZ.net.on('world', function once(m){ if (m.cr && m.cr.length) res(m.cr[0][0]); });
        setTimeout(function(){ res(0); }, 6000);
      });
    })()`, true);
    if (carNid) {
      await B.page.eval(`CBZ.net.sendEv({ e: 'carReq', to: CBZ.net.hostId, nid: ${carNid} })`);
      const driving = await B.page.waitFor("CBZ.player.driving ? 1 : 0", 10000, "guest driving granted car").catch(() => 0);
      ok(!!driving, "car ownership transfer: guest now DRIVES a host car", "nid " + carNid);
      if (driving) {
        await B.page.eval("CBZ.cityExitVehicle()");
        await sleep(800);
        const back = await A.page.eval(`CBZ.cityCars.some(function(c){ return c.stolen && !c.player && !c.npcDriver; }) ? 1 : 0`);
        ok(!!back, "released car returns to the host sim");
      }
    } else ok(false, "car ownership transfer (no car nid seen on guest)");

    // and through all of that, no page errors took the loop down
    const aState = await A.page.eval("CBZ.game.state");
    const bState = await B.page.eval("CBZ.game.state");
    ok(aState === "playing" && bState === "playing", "both clients still running", aState + "/" + bState);
  } catch (e) {
    fail++;
    console.log("  ✗ FAIL (exception): " + (e && e.message ? e.message : e));
  } finally {
    if (A) { A.proc.kill(); rm(A.dir, { recursive: true, force: true }).catch(() => {}); }
    if (B) { B.proc.kill(); rm(B.dir, { recursive: true, force: true }).catch(() => {}); }
    server.kill();
  }
  console.log(fail === 0 ? `RESULT: OK (${pass} checks)` : `RESULT: ${fail} FAILED / ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
