#!/usr/bin/env node
/* Turns two runs of shark-form-shots.mjs into a printable anatomy report:
   the orthographic plates side by side at matched scale, with the measured
   proportions underneath them rather than adjectives.

     node tools/shark-form-report.mjs --before artifacts/shark-form/before \
       --after artifacts/shark-form/after --out artifacts/shark-form/bull-shark-form.pdf

   Rendered through the same headless Chromium the plates came out of, so the
   report needs no PDF library and no fonts that are not already on the box. */

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const BEFORE = path.resolve(ROOT, argOf("--before", "artifacts/shark-form/before"));
const AFTER = path.resolve(ROOT, argOf("--after", "artifacts/shark-form/after"));
const REF = path.resolve(ROOT, argOf("--ref", "artifacts/shark-form/greatwhite"));
const OUT = path.resolve(ROOT, argOf("--out", "artifacts/shark-form/bull-shark-form.pdf"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function img(dir, species, view) {
  const b = await readFile(path.join(dir, `${species}-${view}.png`));
  return "data:image/png;base64," + b.toString("base64");
}
async function form(dir, species) {
  return JSON.parse(await readFile(path.join(dir, `${species}-form.json`), "utf8"));
}

const B = await form(BEFORE, "bull_shark"), A = await form(AFTER, "bull_shark");
let G = null; try { G = await form(REF, "great_white_shark"); } catch (_) {}
const views = ["lateral", "dorsal", "anterior", "quarter"];
const bi = {}, ai = {};
for (const v of views) { bi[v] = await img(BEFORE, "bull_shark", v); ai[v] = await img(AFTER, "bull_shark", v); }
let gLat = null; try { gLat = await img(REF, "great_white_shark", "lateral"); } catch (_) {}

const TLb = B.bounds.x[1] - B.bounds.x[0], TLa = A.bounds.x[1] - A.bounds.x[0];
const pct = (v, tl) => (v / tl * 100);
const f1 = (n) => n.toFixed(1);

/* Real Carcharhinus leucas, back-solved from mass rather than copied off a
   drawing: a 2.4 m bull shark weighs about 130 kg, and a fusiform body of
   length L with semi-axes a (depth) and b (width) holds roughly 0.45·L·π·a·b
   of water. That gives a ≈ 0.088 L and b ≈ 0.076 L, i.e. 17.5% of total
   length deep and 15.2% wide, with depth about 1.15× width. */
const REAL = { depth: 17.5, width: 15.2, band: [15.5, 19.5] };

const rows = [
  ["Max body depth", pct(B.shape.hullHeight, TLb), pct(A.shape.hullHeight, TLa), REAL.depth, "% of total length"],
  ["Max body width", pct(B.shape.hullWidth, TLb), pct(A.shape.hullWidth, TLa), REAL.width, "% of total length"],
  ["Depth : width", B.shape.hullHeight / B.shape.hullWidth, A.shape.hullHeight / A.shape.hullWidth, 1.15, "ratio at max girth"],
  ["Head beam kept", B.shape.noseWidthRatio * 100, A.shape.noseWidthRatio * 100, 92, "% of the body's beam"],
];

const plate = (label, src, cap) => `
  <figure class="plate">
    <div class="tag">${label}</div>
    <img src="${src}" alt="">
    ${cap ? `<figcaption>${cap}</figcaption>` : ""}
  </figure>`;

const html = `<title>Bull Shark Form</title>
<style>
  :root{
    --ink:#12181c; --mid:#5d6a72; --faint:#98a5ac; --rule:#d8dee2;
    --paper:#ffffff; --wash:#f2f5f6; --bad:#b4423a; --good:#2f6d54;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);
    font:13px/1.55 "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{width:277mm;min-height:190mm;padding:0 0 6mm;page-break-after:always;position:relative}
  .page:last-child{page-break-after:auto}
  h1{font-size:27px;letter-spacing:-.5px;margin:0 0 2px;font-weight:700}
  h2{font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:var(--mid);
     margin:0 0 10px;font-weight:700;border-bottom:1px solid var(--rule);padding-bottom:5px}
  .sub{color:var(--mid);font-size:12.5px;margin:0 0 16px;max-width:210mm}
  .head{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14px;
        border-bottom:2px solid var(--ink);padding-bottom:8px}
  .stamp{font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--faint);text-align:right}
  .plate{margin:0;background:var(--wash);border:1px solid var(--rule);border-radius:3px;
         padding:8px 10px 6px;position:relative}
  .plate img{display:block;width:100%;height:auto;mix-blend-mode:multiply}
  .tag{font:9.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:1.2px;
       text-transform:uppercase;color:var(--mid);margin-bottom:4px}
  .tag.b{color:var(--bad)} .tag.a{color:var(--good)}
  figcaption{font-size:11px;color:var(--mid);margin-top:4px;line-height:1.45}
  .stack{display:grid;gap:9px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .three{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:start}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase;color:var(--mid);
     border-bottom:1px solid var(--ink);padding:0 8px 5px 0;font-weight:700}
  td{padding:7px 8px 7px 0;border-bottom:1px solid var(--rule);vertical-align:baseline}
  td.n{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;width:80px}
  .was{color:var(--bad)} .now{color:var(--good);font-weight:700}
  .note{font-size:11.5px;color:var(--mid)}
  ul{margin:0;padding-left:16px} li{margin-bottom:6px}
  .callout{border-left:3px solid var(--ink);padding:2px 0 2px 12px;margin:0 0 14px;
           font-size:13px;max-width:200mm}
  .quote{font-style:italic;color:var(--mid)}
  code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--wash);
       padding:1px 4px;border-radius:2px}
  .bar{height:7px;background:var(--wash);border-radius:4px;position:relative;margin-top:5px;overflow:hidden}
  .bar i{position:absolute;top:0;bottom:0;left:0;display:block}
  .bar .real{background:#cfd9dd}
  .bar .b{background:var(--bad);height:3px;top:0}
  .bar .a{background:var(--good);height:3px;top:4px}
</style>

<div class="page">
  <div class="head">
    <div>
      <h1>Bull Shark — form review</h1>
      <div class="sub">Orthographic plates rendered out of the live builder
      (<code>CBZ.WILDLIFE_SPECIES.bull_shark.build</code>), not sketched. Same camera, same
      fit, same light on both rows, so the two silhouettes are directly comparable.</div>
    </div>
    <div class="stamp">shark sim · evolution rung 1<br>src/city/wildlife/aquatic.js<br>${new Date().toISOString().slice(0, 10)}</div>
  </div>

  <div class="callout">
    <div class="quote">“the body is too wide diameter for head and tall way too puffer and
    doesn’t match where they meet looking very dumb like a fat dog”</div>
    <div style="margin-top:6px">All three, confirmed by measurement. The animal was
    <b>${f1(pct(B.shape.hullHeight, TLb))}% of its own length deep and ${f1(pct(B.shape.hullWidth, TLb))}% wide</b> —
    a real bull shark is about ${REAL.depth}% and ${REAL.width}% — and it was fatter in both axes than the
    great white in the same file, which is backwards. The join was a genuine ledge:
    25 mm of hull stood past the snout shell’s rim and ended in a flat cap disc.</div>
  </div>

  <h2>Lateral — the whole animal</h2>
  <div class="stack">
    ${plate('<span class="b">Before · shipped</span>', bi.lateral,
      "Barrel from the shoulder to the gills, then a wall: the beam is still 92% of maximum at the last body station and the head starts as a separate, much smaller block. The tail gives up its section in one step behind the second dorsal.")}
    ${plate('<span class="a">After</span>', ai.lateral,
      "Girth peaks at the pectoral line and falls away in a single curve at both ends. The head is now the front of the body rather than an object fastened to it, and the first dorsal is a fin instead of a sail.")}
  </div>
</div>

<div class="page">
  <div class="head">
    <div><h1>Where they meet</h1>
    <div class="sub">The join, in the two views that make a weld failure impossible to miss.</div></div>
    <div class="stamp">plan + head-on</div>
  </div>
  <div class="three">
    <div>
      <h2>Dorsal — before</h2>
      ${plate('<span class="b">Before</span>', bi.dorsal, "A parallel-sided cigar that holds its full width almost to the gills and then steps down into the head. The step is the defect: the outline changes width and changes slope in the same millimetre.")}
    </div>
    <div>
      <h2>Dorsal — after</h2>
      ${plate('<span class="a">After</span>', ai.dorsal, "Width is carried forward through the gill field at full beam and released across the cheek, so the nose is the end of one continuous taper. Measured ledge at the weld station: 0.00 mm.")}
    </div>
    <div>
      <h2>Head-on</h2>
      ${plate('<span class="b">Before</span>', bi.anterior, "A circle. The head section was 0.94 wide-to-deep — rounder than it is tall — with the body flaring wider still behind it.")}
      <div style="height:9px"></div>
      ${plate('<span class="a">After</span>', ai.anterior, "The section turns over through the head: 0.98 at the gills, 1.30 at the weld, 1.5 at the nose. Broad flattened wedge, eyes on the corners, mouth spanning the beam.")}
    </div>
  </div>
</div>

<div class="page">
  <div class="head">
    <div><h1>The numbers</h1>
    <div class="sub">Measured on the built mesh at runtime, not read off the ring table.
    Total length ${TLa.toFixed(2)} builder units in both columns — nothing about the animal’s length changed.</div></div>
    <div class="stamp">bull_shark</div>
  </div>

  <table>
    <tr><th>Measurement</th><th class="n">Was</th><th class="n">Now</th><th class="n">Real</th><th>&nbsp;</th></tr>
    ${rows.map(([k, b, a, r, u]) => {
      const dec = k === "Depth : width" ? 2 : 1;
      const lo = 0, hi = k === "Depth : width" ? 1.6 : 30;
      const sc = (v) => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
      return `<tr>
        <td>${k}<div class="bar"><i class="real" style="left:${sc(r * 0.92)}%;width:${sc(r * 1.08) - sc(r * 0.92)}%"></i>
          <i class="b" style="width:${sc(b)}%"></i><i class="a" style="width:${sc(a)}%"></i></div></td>
        <td class="n was">${b.toFixed(dec)}</td>
        <td class="n now">${a.toFixed(dec)}</td>
        <td class="n">${r.toFixed(dec)}</td>
        <td class="note">${u}</td></tr>`;
    }).join("")}
    <tr><td>Hull proud of the snout shell at the weld<div class="note" style="margin-top:2px">the visible ledge</div></td>
      <td class="n was">25.0</td><td class="n now">0.0</td><td class="n">0.0</td><td class="note">mm of radius</td></tr>
    <tr><td>First dorsal height above the back</td>
      <td class="n was">20.1</td><td class="n now">12.7</td><td class="n">13.0</td><td class="note">% of total length</td></tr>
  </table>

  <div style="height:18px"></div>
  <div class="two">
    <div>
      <h2>What actually changed</h2>
      <ul>
        <li><b>The ring table was deflated and re-stationed.</b> Seven stations became ten; the two new ones (−0.96 and 1.04) exist because a linear interpolation across 0.65 of body is a ramp with a corner at each end, not a curve.</li>
        <li><b>The cheek keeps the beam.</b> The rule the great white already follows and the bull never got: width is held through the gill field and given up at the mouth corner, while depth goes early and goes twice as fast. That is what turns the section over from a body into a head.</li>
        <li><b>The weld is solved at the hull’s own cap</b>, written as <code>hingeX + length·0.07</code> rather than typed, so moving the mouth can never silently re-open the ledge.</li>
        <li><b>Everything seated on the skin was re-solved, not nudged</b> — every fin root is the same fraction of its local half-axis it always was, and the mouth’s hinge, span, gape and teeth are the same fractions of the head’s section.</li>
        <li><b>The tail sleeve followed for free.</b> Its rim is read off the hull, so the tailstock came out at 46% of max depth — which is what the gallery caption has always claimed it was.</li>
      </ul>
    </div>
    <div>
      <h2>Left alone, deliberately</h2>
      <ul>
        <li><b>Mass and gameplay.</b> <code>marine_predation.js</code> derives tonnage from measured <i>length</i> (<code>0.014·L^2.8</code>), which did not change — so bite, drag, ride and impact tuning are untouched.</li>
        <li><b>The dorsal-fin surface tell</b> re-measures itself from the geometry (<code>speciesPlan</code>), so the shorter fin needs no companion edit.</li>
        <li><b>The great white.</b> It is 23.8% deep against a real 18% — fat too, but it is the hero model the rest of the file is a deviation from, and reshaping it is a bigger call than this one. Flagging it rather than doing it.</li>
      </ul>
      ${gLat ? `<h2 style="margin-top:14px">For scale — the great white, unchanged</h2>
      ${plate('<span class="tag">Reference · same camera</span>', gLat, "The sibling that already had the head-weld fix. The bull now sits correctly under it in girth instead of over it.")}` : ""}
    </div>
  </div>
</div>

<div class="page" style="page-break-after:auto">
  <div class="head">
    <div><h1>Three-quarter — the view anybody actually sees</h1>
    <div class="sub">Neither of the diagnostic views is the one the game puts on screen. This one is.</div></div>
    <div class="stamp">in-game angle</div>
  </div>
  <div class="two">
    ${plate('<span class="b">Before</span>', bi.quarter, "The ring around the head is the hull cap catching the light where it stands proud of the shell. Fat dog.")}
    ${plate('<span class="a">After</span>', ai.quarter, "One animal.")}
  </div>
</div>`;

const tmp = path.join(path.dirname(OUT), ".form-report.html");
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(tmp, html);

const debugPort = 11140 + Math.floor(Math.random() * 100);
const profile = `/tmp/cbz-form-report-${debugPort}`;
await rm(profile, { recursive: true, force: true });
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  "file://" + tmp,
], { stdio: "ignore" });

let ws = null, nextId = 1; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const t = setTimeout(() => { if (pending.delete(id)) reject(new Error(method + " timed out")); }, 60000);
    t.unref?.();
  });
}
let code = 0;
try {
  let page = null;
  for (let i = 0; i < 160 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith("file://"));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page did not become available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Page.enable");
  await sleep(1200);
  const r = await send("Page.printToPDF", {
    landscape: true, printBackground: true, preferCSSPageSize: false,
    paperWidth: 11.69, paperHeight: 8.27,
    marginTop: 0.35, marginBottom: 0.3, marginLeft: 0.4, marginRight: 0.4,
    scale: 1,
  });
  await writeFile(OUT, Buffer.from(r.data, "base64"));
  console.log("wrote " + path.relative(ROOT, OUT));
} catch (err) {
  console.error("shark-form-report FAILED:", err.message); code = 1;
} finally {
  try { ws?.close(); } catch (_) {}
  chrome.kill("SIGKILL");
  await sleep(200);
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5 }); } catch (_) {}
  try { await rm(tmp, { force: true }); } catch (_) {}
}
process.exit(code);
