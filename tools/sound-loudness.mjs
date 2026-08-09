#!/usr/bin/env node
/* tools/sound-loudness.mjs — WHAT EACH CUE ACTUALLY MEASURES, AGAINST WHAT IT
   IS IN REAL LIFE.

   The bank's gains were authored by ear, one cue at a time, over months. Nobody
   ever put them side by side, so nothing enforced a hierarchy: a fist landing
   sat at 0.62 and breaking glass at 0.66 — 0.5 dB apart — while in the real
   world those two events are tens of decibels apart. This tool is the
   side-by-side. It

     1. decodes every file in the BANK in a real browser (the .ogg twins, since
        headless Chromium has no AAC decoder — same recordings, same levels),
     2. measures peak and the loudest 400 ms RMS window of each,
     3. combines a cue's layers the way playback does, applying the authored
        gain, to get the level the player actually gets, in dBFS,
     4. prints that beside the REAL-WORLD dB SPL of the thing the cue depicts
        and the level the mix scheme says it should have,
     5. prints the trim, in dB, that would put it there.

   The real-world column comes from measured databases, not vibes — see
   docs/claude/sound.md for every value's source (3M Noise Navigator, 1700+
   measurements; sengpielaudio's SPL table). Values marked `est` there have no
   published measurement and are anchored between two that do.

   Usage: node tools/sound-loudness.mjs [--json out.json] */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const JSON_OUT = (() => { const i = argv.indexOf("--json"); return i >= 0 ? argv[i + 1] : ""; })();

const port = 8770 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9770 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-loudness-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });
function done(code) {
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}
let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).split("\n")[0] };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.audioManifest)")) break; await sleep(500); }
if (!(await evl("return !!(window.CBZ && CBZ.audioManifest)"))) { console.error("FAIL: CBZ.audioManifest never appeared"); done(2); }

// Decode every bank file and measure it. .ogg twin first: headless Chromium is
// the OSS build with no AAC decoder, and the .ogg is the same recording at the
// same level. Whole-file peak plus the loudest 400 ms RMS window — a one-shot's
// perceived loudness is its impact, not its average over a long tail.
const measured = await evl(`
  const man = CBZ.audioManifest;
  const files = {};
  Object.keys(man.effects).forEach(function (cue) {
    man.effects[cue].parts.forEach(function (p) { p.files.forEach(function (f) { files[f] = 1; }); });
  });
  const octx = new OfflineAudioContext(1, 128, 44100);
  const out = {};
  const names = Object.keys(files);
  for (let i = 0; i < names.length; i++) {
    const f = names[i];
    const tries = [f.replace(/\\.m4a$/, ".ogg"), f.replace(/\\.m4a$/, ".wav"), f];
    let buf = null, used = "";
    for (const t of tries) {
      try {
        const res = await fetch(t);
        if (!res.ok) continue;
        buf = await octx.decodeAudioData(await res.arrayBuffer());
        used = t; break;
      } catch (e) {}
    }
    if (!buf) { out[f] = { err: "undecodable" }; continue; }
    const d = buf.getChannelData(0);
    let peak = 0, sum = 0;
    for (let j = 0; j < d.length; j++) { const a = Math.abs(d[j]); if (a > peak) peak = a; sum += d[j] * d[j]; }
    // loudest 400 ms window, 20 ms hops, via a running sum
    const win = Math.min(d.length, Math.round(buf.sampleRate * 0.4));
    const hop = Math.max(1, Math.round(buf.sampleRate * 0.02));
    let run = 0;
    for (let j = 0; j < win; j++) run += d[j] * d[j];
    let best = run;
    for (let s = hop; s + win <= d.length; s += hop) {
      for (let j = s - hop; j < s; j++) run -= d[j] * d[j];
      for (let j = s + win - hop; j < s + win; j++) run += d[j] * d[j];
      if (run > best) best = run;
    }
    out[f] = { used: used, seconds: buf.duration, peak: peak,
      rms: Math.sqrt(sum / Math.max(1, d.length)), rms400: Math.sqrt(best / win) };
  }
  return JSON.stringify({ files: out, bank: man.effects });
`);
if (!measured || measured.__err) { console.error("FAIL: measurement threw — " + (measured && measured.__err)); done(3); }
const { files, bank } = JSON.parse(measured);

/* ---- the real world, and the scheme ------------------------------------- */
// dB SPL at 1 m for the event each cue depicts. Sourced in docs/claude/sound.md.
const SPL = {
  coin: 50, key: 55, loot: 45, pickup: 40, equip: 45,
  door_open: 70, door_close: 85, glass: 95, siren: 120, lockdown: 125,
  step: 60, jump: 40, punch: 80, hit: 75, ko: 85, whoosh: 35, headshot: 90,
  shoot_taser: 90, tase: 90, empty: 70, reload: 75, rack: 80, shell: 60,
  switch: 50, win: 55, thunder: 120, rumble: 100, collapse: 110,
  explosion: 170, nuclear_shock: 180, water: 60, wind: 50, fire: 70,
};
/* THE SCHEME, and why it is anchored where it is.

   The real world spans 145 dB from a sleeve brushing a jacket to a nuke; 16-bit
   playback has ~96 dB and a living room has maybe 40 dB above its own noise
   floor. Every game therefore COMPRESSES the world into a window — Wwise's HDR
   system and DICE's Frostbite both work exactly this way, and both treat the
   authored loudness of a sound as its PRIORITY, not just its volume. This bank
   has no such window: measured, it puts a dropped coin 11 dB ABOVE a punch,
   and 26 of its 33 cues land above the master compressor's -12 dBFS threshold,
   where a 5:1 ratio squashes them all into each other. That is why everything
   in this game sounds equally important — because at the output, it is.

   Anchor at the LOUD end, not the quiet one: an explosion keeps the level it
   has today (-0.2 dBFS), so the game's perceived loudness does not move and no
   makeup gain is needed. Everything else falls into place BELOW it at a fifth
   of its real-world distance in dB. A punch lands within half a dB of where it
   already was — it was never peak-loud, it was just endlessly repeated and had
   no distance (see CBZ.worldSfx). The coin drops 17 dB, which is the fix. */
const TOP = 170;         // dB SPL @1m of a grenade — the loudest voice in the bank
const CEIL = -0.2;       // ...which keeps the dBFS it has today
const COMPRESS = 0.2;    // real dB -> mixed dB: 145 dB of world into a 29 dB window
const targetDbfs = (spl) => Math.min(CEIL, CEIL + (spl - TOP) * COMPRESS);
const dbfs = (lin) => 20 * Math.log10(Math.max(1e-6, lin));

const rows = [];
for (const cue of Object.keys(bank)) {
  const parts = bank[cue].parts;
  let peak = 0, energy = 0, missing = 0;
  for (const p of parts) {
    // a cue's variants are alternatives; take the loudest, since any play may pick it
    let vPeak = 0, vRms = 0;
    for (const f of p.files) {
      const m = files[f];
      if (!m || m.err) { missing++; continue; }
      vPeak = Math.max(vPeak, m.peak);
      vRms = Math.max(vRms, m.rms400);
    }
    peak = Math.max(peak, p.volume * vPeak);       // layers rarely peak together
    energy += (p.volume * vRms) * (p.volume * vRms); // but their energy does sum
  }
  const spl = SPL[cue];
  const nowPeak = dbfs(peak), nowRms = dbfs(Math.sqrt(energy));
  const want = spl == null ? null : targetDbfs(spl);
  rows.push({ cue, spl, nowPeak, nowRms, want, trim: want == null ? null : want - nowPeak, missing, gain: parts.map((p) => p.volume) });
}
rows.sort((a, b) => (b.spl == null ? -1 : b.spl) - (a.spl == null ? -1 : a.spl));

console.log(`\nSCHEME: ${TOP} dB SPL -> ${CEIL} dBFS, ${COMPRESS} mixed dB per real dB` +
  `  (a ${((TOP - 35) * COMPRESS).toFixed(0)} dB mix window for a ${TOP - 35} dB world)\n`);
console.log("  realdB   want    now(pk)  now(rms)   trim   cue");
for (const r of rows) {
  console.log(
    `  ${String(r.spl == null ? "?" : r.spl).padStart(6)}  ${(r.want == null ? "" : r.want.toFixed(1)).padStart(6)}  ` +
    `${r.nowPeak.toFixed(1).padStart(7)}  ${r.nowRms.toFixed(1).padStart(8)}  ` +
    `${(r.trim == null ? "" : (r.trim > 0 ? "+" : "") + r.trim.toFixed(1)).padStart(6)}   ${r.cue}` +
    (r.missing ? `   (${r.missing} file(s) unmeasured)` : ""));
}
const flat = rows.filter((r) => r.trim != null);
if (flat.length) {
  const spread = Math.max(...flat.map((r) => r.nowPeak)) - Math.min(...flat.map((r) => r.nowPeak));
  const realSpread = Math.max(...flat.map((r) => r.spl)) - Math.min(...flat.map((r) => r.spl));
  console.log(`\n  the world spans ${realSpread} dB; this bank spans ${spread.toFixed(1)} dB of it.`);
  console.log(`  master compressor: threshold -12 dBFS, ratio 5 — everything above that is squashed together.`);
  const over = flat.filter((r) => r.nowPeak > -12);
  console.log(`  cues currently landing ABOVE the threshold: ${over.length}/${flat.length}` +
    (over.length ? ` (${over.slice(0, 12).map((r) => r.cue).join(", ")}${over.length > 12 ? ", …" : ""})` : ""));
}
if (JSON_OUT) {
  await writeFile(path.resolve(ROOT, JSON_OUT), JSON.stringify({ scheme: { TOP, CEIL, COMPRESS }, SPL, rows, files }, null, 2));
  console.log(`\nwrote ${JSON_OUT}`);
}
if (!argv.includes("--gate")) done(0);

/* ---- the gate ------------------------------------------------------------
   Every measured cue must land within TOL dB of its scheme target. This is the
   ratchet: the numbers in the bank cannot drift back to being tuned by ear one
   at a time, because the next person to nudge one has to answer to the table.

   EXCEPTIONS are named here, in code, each with the reason it outranks the
   table — audio.js carries the same reason at the cue. An exception must be a
   decision someone made, never a cue nobody got round to. */
const EXCEPT = {
  siren: "owner: the siren must not dominate; the table would raise it 6 dB",
  nuclear_shock: "scale comes from the pressure duck, not from playback level",
  lockdown: "no .ogg/.wav twin — unmeasurable without an AAC codec",
};
const TOL = 2.0;
const bad = [];
for (const r of rows) {
  if (r.trim == null) continue;
  if (EXCEPT[r.cue]) { console.log(`  --  ${r.cue}: exception — ${EXCEPT[r.cue]}`); continue; }
  if (r.missing) { bad.push(`${r.cue}: ${r.missing} file(s) could not be measured and it is not a documented exception`); continue; }
  if (Math.abs(r.trim) > TOL) {
    bad.push(`${r.cue}: ${r.nowPeak.toFixed(1)} dBFS, scheme wants ${r.want.toFixed(1)} for ${r.spl} dB SPL (${r.trim > 0 ? "+" : ""}${r.trim.toFixed(1)} dB out)`);
  }
}
const unpriced = Object.keys(bank).filter((c) => SPL[c] == null);
for (const c of unpriced) bad.push(`${c}: in the bank with no real-world dB SPL — price it in docs/claude/sound.md`);
console.log("");
if (bad.length) {
  for (const b of bad) console.log("FAIL  " + b);
  console.log(`\nloudness gate: ${bad.length} cue(s) off the scheme`);
  done(1);
}
console.log(`  ok  every measured cue is within ${TOL} dB of its real-world target`);
console.log(`  ok  every cue in the bank is priced`);
console.log("\nloudness gate: PASS");
done(0);
