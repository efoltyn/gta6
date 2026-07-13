#!/usr/bin/env node
/* tools/map-shot.mjs — MAP SCREENSHOT LOOP: "see the map you built."

   Boots the game headless at a seed, presses PLAY, then captures the in-game
   navigation UI to PNGs so map/minimap work can be judged by LOOKING:

     tools/shots/map-hud.png    the live play HUD (bottom-left minimap in situ)
     tools/shots/map-full.png   the full [M] map overlay (real roads/POIs/water)
     tools/shots/map-<stars>star.png  (when --stars N>0) full map + minimap with
                                the wanted level lit, so the stars/heat layers show

   Usage: node tools/map-shot.mjs [seed] [--stars N] [--out DIR] [--hold MS]
          seed     world seed (default 8826-friendly 90210)
          --stars  set wanted level 0..5 via CBZ.cityCrime before the shot
          --fit    open the full map fitted to the whole archipelago (F view)
          --out    output dir (default tools/shots)
          --keep   leave the server/chrome error log verbose

   Zero npm deps: CDP over the system browser (same harness as world-audit.mjs).
   Serve is python3 tools/devserver.py; CDN is blocked so three.js stays vendored. */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const seed = Number(args.find((a) => /^\d+$/.test(a))) || 90210;
const starsArg = (() => { const i = args.indexOf("--stars"); return i >= 0 ? Math.max(0, Math.min(5, Number(args[i + 1]) || 0)) : 0; })();
const outDir = (() => { const i = args.indexOf("--out"); return i >= 0 ? args[i + 1] : path.join(ROOT, "tools", "shots"); })();
const holdMs = (() => { const i = args.indexOf("--hold"); return i >= 0 ? Number(args[i + 1]) || 900 : 900; })();
const fitAll = args.includes("--fit");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 8826;
const dbg = 9860 + Math.floor(Math.random() * 80);
const profile = `/tmp/cbz-mapshot-${process.pid}-${dbg}`;
const base = `http://127.0.0.1:${port}/?seed=${seed}`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const W = 1280, H = 800;

async function main() {
  await mkdir(outDir, { recursive: true });
  await rm(profile, { recursive: true, force: true });

  const server = spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch (_) {} await sleep(400); }

  const chrome = spawn(chromeBin, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
    `--window-size=${W},${H}`, `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
  ], { cwd: ROOT, stdio: "ignore" });

  const errors = [];
  let ws = null;
  try {
    let page = null;
    for (let i = 0; i < 120 && !page; i++) {
      try {
        const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
        page = ps.find((p) => p.type === "page" && p.url.includes(`seed=${seed}`));
      } catch (_) {}
      if (!page) await sleep(250);
    }
    if (!page) throw new Error("no chrome page target");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
    let id = 1; const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
      }
    });
    const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evl = async (expression, awaitPromise = false) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
      const res = r.result;
      if (res && res.exceptionDetails) throw new Error("in-page: " + ((res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text || "eval failed").split("\n")[0]);
      return res && res.result && res.result.value;
    };
    const shoot = async (name, clip) => {
      const shot = await send("Page.captureScreenshot", clip ? { format: "png", clip } : { format: "png" });
      const file = path.join(outDir, name);
      await writeFile(file, Buffer.from(shot.result.data, "base64"));
      console.log("  wrote " + path.relative(ROOT, file));
    };
    // the #cRadar minimap's on-screen rect, scaled up so it reads in review
    const radarClip = async () => {
      const r = await evl(`(() => { const c = document.getElementById('cRadar'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`).catch(() => null);
      return r ? { ...r, scale: Math.max(1, Math.min(4, 360 / (r.width || 190))) } : null;
    };

    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    for (let i = 0; i < 120; i++) {
      if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))").catch(() => false)) break;
      await sleep(500);
    }
    // full sandbox (skip the campaign prologue's cold-street observation gate)
    await evl("(() => { if (window.CBZ && CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()").catch(() => {});
    console.log(`[map-shot seed ${seed}] pressing PLAY (headless world build is slow)...`);
    let playing = false;
    for (let i = 0; i < 320 && !playing; i++) {
      await evl("(() => { const b = document.getElementById('playBtn'); if (b) { b.click(); b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); } return true; })()").catch(() => {});
      await sleep(1500);
      playing = await evl("!!(window.CBZ && CBZ.game && CBZ.game.state === 'playing' && CBZ.city && CBZ.city.arena)").catch(() => false);
    }
    if (!playing) throw new Error("game never reached playing state with a built arena");
    await sleep(2500);   // let peds/cars/props settle so the map has live actors

    if (starsArg > 0) {
      // light the wanted level so the star / heat / chopper layers render
      await evl(`(() => {
        const P = CBZ.player, g = CBZ.game;
        if (CBZ.cityWantedReset) CBZ.cityWantedReset();
        // one crime whose tier maps to the target star count (see world-audit's
        // GAMEPLAY_PROBE): boosting=1, carjacking=2, grand-theft-police=3,
        // aircraft-hijacking=4, grand-theft-military=5.
        const typeFor = { 1: "boosting", 2: "carjacking", 3: "grand-theft-police", 4: "aircraft-hijacking", 5: "grand-theft-military" };
        const sevFor = { 1: 60, 2: 120, 3: 130, 4: 180, 5: 220 };
        const t = ${starsArg};
        if (CBZ.cityCrime && P && P.pos) CBZ.cityCrime(sevFor[t], { type: typeFor[t], instant: true, x: P.pos.x, z: P.pos.z });
        return (CBZ.cityStars ? CBZ.cityStars() : g.wanted) | 0;
      })()`).catch(() => {});
      await sleep(400);
    }

    const wantedNow = await evl("(CBZ.cityStars ? CBZ.cityStars() : (CBZ.game && CBZ.game.wanted)) | 0").catch(() => 0);
    console.log("  wanted stars = " + wantedNow);

    // 1) live HUD (minimap in situ) + a scaled clip of just the minimap
    await sleep(holdMs);
    await shoot(starsArg > 0 ? `map-hud-${wantedNow}star.png` : "map-hud.png");
    const rc = await radarClip();
    if (rc) await shoot(starsArg > 0 ? `map-radar-${wantedNow}star.png` : "map-radar.png", rc);

    // 2) full [M] map
    await evl(`(() => { if (CBZ.fullMap && CBZ.fullMap.open) CBZ.fullMap.open(); return CBZ.fullMap && CBZ.fullMap.active; })()`).catch(() => {});
    if (fitAll) {
      // 'F' fits the whole archipelago (settlements + biomes + water + causeways)
      await evl(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true })); return CBZ.fullMap && CBZ.fullMap.view && CBZ.fullMap.view.z; })()`).catch(() => {});
    }
    await sleep(holdMs);
    await shoot(starsArg > 0 ? `map-full-${wantedNow}star.png` : "map-full.png");

    const uniq = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e));
    if (uniq.length) console.log(`[map-shot] browser errors (${uniq.length}): ` + uniq.slice(0, 6).join(" | "));
    else console.log("[map-shot] no unexpected console errors");
  } finally {
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } catch (_) {}
    try { chrome.kill("SIGTERM"); } catch (_) {}
    try { server.kill("SIGTERM"); } catch (_) {}
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => { console.error("[map-shot] FAIL: " + (e.message || e)); process.exitCode = 1; });
