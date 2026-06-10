#!/usr/bin/env node
// Two-browser PROXIMITY VOICE + interaction-hardening test.
// Launches two headless Chromes with FAKE microphones (auto-granted, emits a
// tone), joins both to a live server, and asserts:
//   - WebRTC mesh: peer connection reaches "connected" on both sides
//   - spatial audio graph: panner + gain exist for the remote voice
//   - speaking flag propagates (fake mic tone -> state stream -> 🔊 pip)
//   - melee hit on a puppet routes to the host's authoritative ped
//   - networked bodies are SOLID (player pushed out of a puppet car)
// Usage: node tools/test-voice-browser.mjs
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 18600 + Math.floor(Math.random() * 150);
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, label, detail) => {
  if (c) { pass++; console.log("  ✓ " + label + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  ✗ FAIL " + label + (detail ? " — " + detail : "")); }
};

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
    if (r.result && r.result.exceptionDetails) throw new Error("page eval: " + JSON.stringify(r.result.exceptionDetails.exception).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async waitFor(expr, timeout = 30000, label = "") {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      let v;
      try { v = await this.eval(expr); } catch (e) {}
      if (v) return v;
      await sleep(300);
    }
    throw new Error("timeout waiting for: " + (label || expr));
  }
}

async function launchChrome(url) {
  const port = 19300 + Math.floor(Math.random() * 600);
  const dir = `/tmp/cbz-voice-${port}`;
  await rm(dir, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    "--headless=new", "--enable-unsafe-swiftshader",
    "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-networking", "--no-default-browser-check", "--no-first-run",
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

const JOIN = (name) => `
  (function(){
    document.querySelector('.mode-btn[data-mode="city"]').click();
    CBZ.net.connect({ name: ${JSON.stringify(name)}, role: 'civ',
      onWelcome: function(){ try { CBZ.startRun(); window._joined = 1; } catch(e){ window._joinErr = String(e); } },
      onError: function(r){ window._joinErr = r; } });
    return 1;
  })()`;

(async function main() {
  console.log("== proximity voice + interaction test (server :" + PORT + ") ==");
  const cfgPath = join(mkdtempSync(join(tmpdir(), "cbz-voice-")), "server.json");
  writeFileSync(cfgPath, JSON.stringify({ name: "Voice Test City", motd: "", password: "", adminPass: "", maxPlayers: 8, port: PORT, roles: [{ id: "civ", label: "Civilian" }] }));
  const server = spawn(process.execPath, [join(ROOT, "server", "server.js")], { env: { ...process.env, CBZ_CONFIG: cfgPath, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  await sleep(800);

  let A, B;
  try {
    A = await launchChrome(`http://127.0.0.1:${PORT}/`);
    await A.page.waitFor("!!(window.CBZ && CBZ.net && CBZ.netVoice && CBZ.startRun)", 40000, "A loaded (incl. netvoice)");
    await A.page.eval(JOIN("Anna"));
    await A.page.waitFor("window._joined === 1 || window._joinErr", 25000, "A joined");
    await A.page.waitFor("CBZ.game.state === 'playing'", 25000, "A playing");

    B = await launchChrome(`http://127.0.0.1:${PORT}/`);
    await B.page.waitFor("!!(window.CBZ && CBZ.net && CBZ.netVoice && CBZ.startRun)", 40000, "B loaded");
    await B.page.eval(JOIN("Ben"));
    await B.page.waitFor("window._joined === 1 || window._joinErr", 25000, "B joined");
    await B.page.waitFor("CBZ.game.state === 'playing'", 25000, "B playing");

    // mic granted via fake-ui flag
    const micA = await A.page.waitFor("CBZ.netVoice.enabled ? 1 : 0", 20000, "A mic").catch(() => 0);
    const micB = await B.page.waitFor("CBZ.netVoice.enabled ? 1 : 0", 20000, "B mic").catch(() => 0);
    ok(!!micA && !!micB, "both mics granted (fake device)", `A=${micA} B=${micB}`);

    // P2P mesh connects (loopback ICE, no STUN needed)
    const connA = await A.page.waitFor(`(function(){
      var p = CBZ.netVoice.peers.get(2);
      return p && (p.pc.connectionState === 'connected' || p.pc.iceConnectionState === 'connected') ? 1 : 0;
    })()`, 40000, "A->B rtc connected").catch(() => 0);
    const connB = await B.page.waitFor(`(function(){
      var p = CBZ.netVoice.peers.get(1);
      return p && (p.pc.connectionState === 'connected' || p.pc.iceConnectionState === 'connected') ? 1 : 0;
    })()`, 40000, "B->A rtc connected").catch(() => 0);
    ok(!!connA && !!connB, "WebRTC voice mesh CONNECTED both ways", `A=${connA} B=${connB}`);

    // spatial graph built (panner+gain wired into the voice context)
    const graphA = await A.page.waitFor(`(function(){
      var p = CBZ.netVoice.peers.get(2);
      return p && p.panner && p.gain ? 1 : 0;
    })()`, 25000, "A spatial graph").catch(() => 0);
    ok(!!graphA, "remote voice runs through a positional panner");

    // speaking flag: fake mic emits a tone -> level over threshold -> state v:1 -> pip
    const speakSeen = await B.page.waitFor(`(function(){
      var R = CBZ.netRemoteActor(1);
      return R && R.speakTag && R.speakTag.visible ? 1 : 0;
    })()`, 30000, "speaking pip").catch(() => 0);
    ok(!!speakSeen, "speaking indicator propagates (tone -> v flag -> 🔊 pip)");

    // melee on a puppet routes to the host's authoritative ped
    const meleeNid = await B.page.eval(`(function(){
      var t = CBZ.netPuppetTargets([]).filter(function(p){return p.netKind==='ped' && !p.dead})[0];
      if (!t) return 0;
      CBZ.net.localMeleeHit(t, 25, 'light');
      return t.nid;
    })()`);
    if (meleeNid) {
      const hurt = await A.page.waitFor(`(function(){
        var p = CBZ.cityPeds.find(function(q){return q.nid===${meleeNid}});
        return p && (p.hp < (p.maxHp || 100) || p.dead) ? 1 : 0;
      })()`, 15000, "melee hurt").catch(() => 0);
      ok(!!hurt, "guest PUNCH damages the host-authoritative ped", "nid " + meleeNid);
    } else ok(false, "guest punch routes (no puppet found)");

    // solidity: teleport B into a puppet car -> collision push-out moves him off it
    const pushed = await B.page.eval(`(function(){
      return new Promise(function(res){
        var C = null;
        // sample a car position from the world stream
        CBZ.net.on('world', function once(m){
          if (C || !m.cr || !m.cr.length) return;
          C = m.cr[0];
          CBZ.player.pos.set(C[1], 0, C[2]);
          setTimeout(function(){
            var dx = CBZ.player.pos.x - C[1], dz = CBZ.player.pos.z - C[2];
            res(Math.hypot(dx, dz) > 0.7 ? 1 : 0);
          }, 1200);
        });
        setTimeout(function(){ res(C ? 0 : -1); }, 12000);
      });
    })()`, true);
    ok(pushed === 1, "puppet cars are SOLID (player pushed out)", "result=" + pushed);

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
