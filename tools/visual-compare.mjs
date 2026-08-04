#!/usr/bin/env node
/*
  Deterministic visual comparison runner.

  A preset describes what to wait for and how to stage one subject. This core
  owns the repeatable browser, matching before/after viewport, screenshots,
  HTML contact sheet, PDF printing, and optional Finder/Preview handoff.

  Examples:
    node tools/visual-compare.mjs --preset wildlife-attachments \
      --before https://efoltyn.github.io/gta6/
    node tools/visual-compare.mjs --preset tools/visual-presets/my-change.mjs \
      --before https://example.test/old/ --after http://127.0.0.1:4173/
*/

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      result[token.slice(2, eq)] = token.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      result[token.slice(2)] = argv[++i];
    } else {
      result[token.slice(2)] = true;
    }
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`Visual before/after report\n\n` +
    `  --preset NAME|FILE   visual recipe (default: wildlife-attachments)\n` +
    `  --before URL         baseline build URL (required)\n` +
    `  --after URL          changed build URL (default: temporary local server)\n` +
    `  --out DIR            report directory (default: artifacts/visual-comparisons/...)\n` +
    `  --subjects a,b,c     capture only these subject ids\n` +
    `  --limit N            capture only the first N subjects\n` +
    `  --no-open            do not open the generated PDF\n` +
    `  --keep-going         a failed subject becomes an error page instead of aborting the run\n` +
    `  --width N --height N capture viewport (defaults: preset or 960x600)\n` +
    `  --only before|after  capture one side only, skip the report (fast look iteration)\n` +
    `  --before-label S     override the BEFORE banner/caption (for flag-A/B runs\n` +
    `                       where --before is the same local build with ?cfg_X=0)\n` +
    `  --after-label S      override the AFTER banner/caption\n`);
  process.exit(0);
}

const presetName = String(args.preset || "wildlife-attachments");
const presetPath = presetName.includes("/") || presetName.endsWith(".mjs")
  ? path.resolve(ROOT, presetName)
  : path.join(ROOT, "tools", "visual-presets", `${presetName}.mjs`);
const presetModule = await import(`${pathToFileURL(presetPath).href}?visualCompare=${Date.now()}`);
const preset = presetModule.default;
if (!preset || !Array.isArray(preset.subjects) || typeof preset.stage !== "function" || !preset.readyExpression) {
  throw new Error(`Invalid visual preset: ${presetPath}`);
}

const beforeUrl = String(args.before || process.env.CBZ_VISUAL_BEFORE || "");
if (!beforeUrl) throw new Error("--before URL is required");
const width = Number(args.width || preset.viewport?.width || 960);
const height = Number(args.height || preset.viewport?.height || 600);
if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240) {
  throw new Error("viewport must be at least 320x240");
}

let subjects = preset.subjects.slice();
if (args.subjects) {
  const requested = new Set(String(args.subjects).split(",").map((id) => id.trim()).filter(Boolean));
  subjects = subjects.filter((subject) => requested.has(subject.id));
  const missing = [...requested].filter((id) => !subjects.some((subject) => subject.id === id));
  if (missing.length) throw new Error(`Unknown preset subject(s): ${missing.join(", ")}`);
}
if (args.limit) subjects = subjects.slice(0, Number(args.limit));
if (!subjects.length) throw new Error("No visual subjects selected");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve(ROOT, String(args.out || path.join("artifacts", "visual-comparisons", `${preset.id || presetName}-${stamp}`)));
const shotDir = path.join(outputDir, "shots");
await mkdir(path.join(shotDir, "before"), { recursive: true });
await mkdir(path.join(shotDir, "after"), { recursive: true });

const webPort = 8700 + Math.floor(Math.random() * 500);
const debugPort = 10400 + Math.floor(Math.random() * 500);
const localUrl = `http://127.0.0.1:${webPort}/`;
const afterUrl = String(args.after || process.env.CBZ_VISUAL_AFTER || localUrl);
const startsLocalServer = !args.after && !process.env.CBZ_VISUAL_AFTER;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-visual-compare-"));
const children = [];

if (startsLocalServer) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(webPort) },
    stdio: "ignore",
  }));
}

const chrome = spawn(chromeBin, [
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-default-browser-check",
  "--no-first-run",
  "--allow-file-access-from-files",
  "--enable-webgl",
  "--enable-unsafe-swiftshader",
  `--window-size=${width},${height}`,
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { cwd: ROOT, stdio: "ignore" });
children.push(chrome);

let ws;
let sequence = 1;
const pending = new Map();
const browserMessages = [];

function send(method, params = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const id = sequence++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, timeoutMs = 60000) {
  const message = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, timeoutMs);
  if (message.exceptionDetails) {
    const detail = message.exceptionDetails.exception?.description || message.exceptionDetails.text;
    throw new Error(detail || "browser evaluation failed");
  }
  return message.result?.value;
}

async function waitForDebuggerPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = pages.find((candidate) => candidate.type === "page");
      if (page) return page;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome DevTools page did not become available");
}

async function waitForLocalServer() {
  if (!startsLocalServer) return;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(localUrl, { method: "HEAD" });
      if (response.ok) return;
    } catch (_) {}
    await sleep(150);
  }
  throw new Error(`local visual server did not start at ${localUrl}`);
}

function cacheBusted(url, side) {
  const parsed = new URL(url);
  // Presets may pin URL params (seed, cfg_* flags) so both sides boot the
  // exact same deterministic world.
  for (const [key, value] of Object.entries(preset.urlParams || {})) {
    parsed.searchParams.set(key, String(value));
  }
  parsed.searchParams.set("visualCompare", `${side}-${Date.now()}`);
  return parsed.href;
}

async function navigate(url, side) {
  const requested = cacheBusted(url, side);
  await send("Page.navigate", { url: requested }, 90000);
  const deadline = Date.now() + 90000;
  let lastState = "loading";
  while (Date.now() < deadline) {
    try {
      lastState = await evaluate("document.readyState");
      if (lastState === "complete" && await evaluate(`Boolean(${preset.readyExpression})`)) {
        return { requested, final: await evaluate("location.href") };
      }
    } catch (_) {}
    await sleep(250);
  }
  throw new Error(`${side} build never satisfied preset readiness at ${url} (document: ${lastState})`);
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function captureSide(side, sourceUrl, referenceResult = null) {
  const nav = await navigate(sourceUrl, side);
  const captures = [];
  for (let index = 0; index < subjects.length; index++) {
    const subject = subjects[index];
    process.stdout.write(`[${side}] ${index + 1}/${subjects.length} ${subject.label || subject.id}\n`);
    const stageInput = {
      subject,
      side,
      sourceUrl: nav.final,
      width,
      height,
      // CLI overrides so a flag-A/B run (--before "…?cfg_X=0" against the same
      // local build) does not stamp its shots with a lying "DEPLOYED" banner.
      beforeLabel: String(args["before-label"] || preset.beforeLabel || "BEFORE · DEPLOYED"),
      afterLabel: String(args["after-label"] || preset.afterLabel || "AFTER · LOCAL"),
      // The after side can reuse exact staging data (especially the camera)
      // returned by the matching before capture. Presets opt in by reading it.
      referenceStage: referenceResult?.captures?.[index]?.stage || null,
    };
    let stageResult;
    try {
      stageResult = await evaluate(
        `(${preset.stage.toString()})(${JSON.stringify(stageInput)})`,
        Number(preset.stageTimeoutMs) || 60000
      );
      if (!stageResult || stageResult.ok !== true) {
        throw new Error(`${side}/${subject.id} could not be staged: ${JSON.stringify(stageResult)}`);
      }
    } catch (err) {
      // --keep-going: one broken beat becomes an error page, the rest of the
      // storyboard still ships. The failing state is still photographed —
      // a picture of the wreck beats an empty slot.
      if (!args["keep-going"]) throw err;
      process.stdout.write(`[${side}] ${subject.id} FAILED (kept going): ${err.message}\n`);
      stageResult = { ok: false, error: String(err.message || err) };
    }
    await evaluate(`(() => {
      if (window.__cbzVisualCompare && window.__cbzVisualCompare.render) window.__cbzVisualCompare.render();
      // Force style/layout now; the two-frame barrier below then guarantees
      // both DOM labels and the WebGL surface reached Chrome's compositor.
      void document.documentElement.offsetHeight;
      return true;
    })()`);
    await evaluate(`new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(true); } };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 180);
    })`);
    const screenshot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const filename = `${String(index + 1).padStart(2, "0")}-${safeName(subject.id)}.png`;
    const absolute = path.join(shotDir, side, filename);
    await writeFile(absolute, Buffer.from(screenshot.data, "base64"));
    captures.push({ subject, filename, stage: stageResult });
  }
  return { navigation: nav, captures };
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatMetric(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (Math.abs(number) >= 1000) return String(Math.round(number));
  if (Math.abs(number) >= 10) return String(Math.round(number * 10) / 10);
  return String(Math.round(number * 100) / 100);
}

// Stage results may carry `metrics: {key: number}`. Rows pair each subject's
// before/after numbers; `preset.metrics[key] = {label, unit, better}` names
// them and says which direction is an improvement.
function metricsRows(before, after) {
  const rows = [];
  subjects.forEach((subject, index) => {
    const beforeMetrics = before.captures[index]?.stage?.metrics || null;
    const afterMetrics = after.captures[index]?.stage?.metrics || null;
    if (!beforeMetrics && !afterMetrics) return;
    const keys = [...new Set([
      ...Object.keys(beforeMetrics || {}),
      ...Object.keys(afterMetrics || {}),
    ])];
    for (const key of keys) {
      const spec = (preset.metrics || {})[key] || {};
      rows.push({
        subject,
        key,
        spec,
        before: beforeMetrics ? beforeMetrics[key] : null,
        after: afterMetrics ? afterMetrics[key] : null,
      });
    }
  });
  return rows;
}

function metricsPageHtml(before, after) {
  const rows = metricsRows(before, after);
  if (!rows.length) return "";
  const body = rows.map((row) => {
    const beforeValue = Number(row.before);
    const afterValue = Number(row.after);
    let deltaCell = "<td>—</td>";
    if (Number.isFinite(beforeValue) && Number.isFinite(afterValue)) {
      const diff = afterValue - beforeValue;
      let tone = "";
      if (row.spec.better === "lower") tone = diff < 0 ? "good" : (diff > 0 ? "bad" : "");
      if (row.spec.better === "higher") tone = diff > 0 ? "good" : (diff < 0 ? "bad" : "");
      if (beforeValue !== 0) {
        const pct = (diff / Math.abs(beforeValue)) * 100;
        deltaCell = `<td class="${tone}">${pct > 0 ? "+" : ""}${Math.round(pct)}%</td>`;
      } else {
        // a zero baseline has no percentage; the absolute move still matters
        deltaCell = `<td class="${tone}">${diff > 0 ? "+" : ""}${formatMetric(diff)}</td>`;
      }
    }
    return `<tr><td>${htmlEscape(row.subject.label || row.subject.id)}</td>` +
      `<td>${htmlEscape(row.spec.label || row.key)}${row.spec.unit ? ` <small>${htmlEscape(row.spec.unit)}</small>` : ""}</td>` +
      `<td>${formatMetric(row.before)}</td><td>${formatMetric(row.after)}</td>${deltaCell}</tr>`;
  }).join("\n");
  return `<section class="page metrics">
    <header><div><span class="number">Σ</span><h2>Measurements</h2></div><p>${htmlEscape(preset.metricsNote || "Numbers captured live inside each build during staging. Same seed, same timeline, same machine — the source change is the variable.")}</p></header>
    <table><thead><tr><th>Subject</th><th>Metric</th><th>Before</th><th>After</th><th>Δ</th></tr></thead><tbody>${body}</tbody></table>
  </section>`;
}

function reportHtml(before, after) {
  const generated = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const pairNote = preset.pairNote || "Same model recipe · seed · camera · light · viewport";
  const method = preset.method || "Every pair uses the actual registered model builder from its source URL. The runner holds subject, random seed, viewport, camera framing, backdrop, and lighting constant so the source change is the variable.";
  const pages = subjects.map((subject, index) => {
    const focus = subject.focus || preset.defaultFocus || "Compare silhouette, seams, and physical continuity.";
    const side = (result, cls, caption, sub) => {
      const capture = result.captures[index];
      const stageError = capture?.stage?.ok !== true ? (capture?.stage?.error || "stage failed") : null;
      const body = capture?.filename
        ? `<img src="shots/${cls}/${htmlEscape(capture.filename)}">`
        : `<div class="stageError">NOT CAPTURED</div>`;
      const note = stageError ? `<div class="stageError">${htmlEscape(stageError)}</div>` : "";
      return `<figure class="${cls}"><figcaption>${caption} <small>${sub}</small></figcaption>${body}${note}</figure>`;
    };
    return `<section class="page detail">
      <header><div><span class="number">${String(index + 1).padStart(2, "0")}</span><h2>${htmlEscape(subject.label || subject.id)}</h2></div><p>${htmlEscape(focus)}</p></header>
      <div class="pair">
        ${side(before, "before", "BEFORE", htmlEscape(String(args["before-label"] || "DEPLOYED PAGE")))}
        ${side(after, "after", "AFTER", htmlEscape(String(args["after-label"] || "LOCAL REPAIR")))}
      </div>
      <footer><span>${htmlEscape(subject.id)}</span><span>${htmlEscape(pairNote)}</span></footer>
    </section>`;
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(preset.title)}</title><style>
    @page { size: A4 landscape; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #0b1118; color: #eff5fa; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { width: 297mm; height: 210mm; page-break-after: always; overflow: hidden; background: linear-gradient(145deg,#0c141d,#172536); padding: 13mm 14mm 10mm; position: relative; }
    .cover { display: flex; flex-direction: column; justify-content: space-between; }
    .eyebrow { color: #80c9ff; letter-spacing: .18em; font-weight: 800; font-size: 12px; }
    h1 { font-size: 39px; line-height: 1.03; margin: 8mm 0 4mm; max-width: 230mm; }
    .dek { color: #bdcad5; font-size: 17px; line-height: 1.5; max-width: 225mm; }
    .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 5mm; margin: 7mm 0; }
    .stat { border: 1px solid #314457; border-radius: 4mm; padding: 6mm; background: rgba(255,255,255,.035); }
    .stat strong { display: block; font-size: 30px; } .stat span { color:#9fb1c0; font-size:12px; text-transform:uppercase; letter-spacing:.1em; }
    .sources { display:grid; grid-template-columns:1fr 1fr; gap:5mm; }
    .source { padding:5mm; border-radius:3mm; background:#101b27; border-left: 2mm solid #f06464; }
    .source.after { border-color:#59d59a; } .source b { display:block; margin-bottom:2mm; } .source code { color:#aebdca; font-size:10px; overflow-wrap:anywhere; }
    .method { color:#8fa2b2; font-size:11px; line-height:1.45; }
    .detail header { height: 27mm; display:flex; align-items:flex-end; justify-content:space-between; gap:10mm; }
    .detail header > div { display:flex; align-items:baseline; gap:4mm; }
    .number { color:#547086; font-weight:800; font-size:18px; } h2 { margin:0; font-size:28px; }
    .detail header p { color:#9fb2c2; margin:0 0 1mm; font-size:12px; text-align:right; max-width:120mm; }
    .pair { height: 148mm; display:grid; grid-template-columns:1fr 1fr; gap:5mm; align-items:center; }
    figure { margin:0; background:#111a23; border:1px solid #35485a; border-radius:3mm; overflow:hidden; }
    figure.before { border-top:2mm solid #f06464; } figure.after { border-top:2mm solid #59d59a; }
    figcaption { height:11mm; padding:2.4mm 4mm; font-weight:850; font-size:13px; letter-spacing:.09em; }
    figcaption small { float:right; color:#9babb8; font-size:9px; line-height:16px; }
    figure img { width:100%; display:block; aspect-ratio:${width}/${height}; object-fit:cover; }
    .stageError { padding:4mm; color:#ffb3b3; font:11px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere; }
    footer { position:absolute; left:14mm; right:14mm; bottom:6mm; display:flex; justify-content:space-between; color:#6f8496; font:10px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .metrics table { width:100%; border-collapse:collapse; margin-top:4mm; font-size:11.5px; }
    .metrics th { text-align:left; color:#80c9ff; letter-spacing:.08em; font-size:10px; text-transform:uppercase; padding:1.6mm 3mm; border-bottom:1px solid #35485a; }
    .metrics td { padding:1.5mm 3mm; border-bottom:1px solid #22303f; font-variant-numeric:tabular-nums; }
    .metrics td small { color:#8fa2b2; }
    .metrics td.good { color:#59d59a; font-weight:800; }
    .metrics td.bad { color:#f06464; font-weight:800; }
  </style></head><body>
    <section class="page cover">
      <div><div class="eyebrow">DETERMINISTIC VISUAL COMPARISON</div><h1>${htmlEscape(preset.title)}</h1><p class="dek">${htmlEscape(preset.description || "Before and after captures from two real browser builds.")}</p></div>
      <div class="stats"><div class="stat"><strong>${subjects.length}</strong><span>matched subjects</span></div><div class="stat"><strong>${subjects.length * 2}</strong><span>browser screenshots</span></div><div class="stat"><strong>${subjects.length + 1}</strong><span>report pages</span></div></div>
      <div class="sources"><div class="source"><b>BEFORE · deployed baseline</b><code>${htmlEscape(before.navigation.final)}</code></div><div class="source after"><b>AFTER · current checkout</b><code>${htmlEscape(after.navigation.final)}</code></div></div>
      <p class="method">Generated ${htmlEscape(generated)}. ${htmlEscape(method)}</p>
    </section>
    ${metricsPageHtml(before, after)}
    ${pages}
  </body></html>`;
}

let beforeResult;
let afterResult;
let pdfPath;
try {
  await waitForLocalServer();
  const page = await waitForDebuggerPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      browserMessages.push({ type: "exception", text: message.params?.exceptionDetails?.text || "runtime exception" });
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      browserMessages.push({
        type: message.params.type,
        text: (message.params.args || []).map((item) => item.value || item.description || "").join(" "),
      });
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  // --print-only: re-print an existing run's report.html to PDF without
  // re-shooting anything (Page.printToPDF is the one step that can time out
  // after 20 good captures; the shots are already on disk).
  if (args["print-only"]) {
    const htmlPath = path.join(outputDir, "report.html");
    pdfPath = path.join(outputDir, "before-after.pdf");
    await send("Page.navigate", { url: pathToFileURL(htmlPath).href }, 90000);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (await evaluate("document.readyState === 'complete' && Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0)")) break;
      await sleep(100);
    }
    const pdf = await send("Page.printToPDF", {
      printBackground: true, landscape: true, preferCSSPageSize: true,
      paperWidth: 11.69, paperHeight: 8.27,
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
    }, 600000);
    await writeFile(pdfPath, Buffer.from(pdf.data, "base64"));
    process.stdout.write(`\nPDF reprinted: ${pdfPath}\n`);
    throw { _earlyExit: true };
  }

  const onlySide = args.only ? String(args.only) : null;
  if (onlySide === "after") {
    afterResult = await captureSide("after", afterUrl);
    process.stdout.write(`\nAfter-side shots only (no report): ${path.join(shotDir, "after")}\n`);
    throw { _earlyExit: true };
  }
  if (onlySide === "before") {
    beforeResult = await captureSide("before", beforeUrl);
    process.stdout.write(`\nBefore-side shots only (no report): ${path.join(shotDir, "before")}\n`);
    throw { _earlyExit: true };
  }
  beforeResult = await captureSide("before", beforeUrl);
  afterResult = await captureSide("after", afterUrl, beforeResult);

  const htmlPath = path.join(outputDir, "report.html");
  pdfPath = path.join(outputDir, "before-after.pdf");
  await writeFile(htmlPath, reportHtml(beforeResult, afterResult));
  await writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({
    preset: { id: preset.id, title: preset.title, path: path.relative(ROOT, presetPath) },
    generatedAt: new Date().toISOString(),
    viewport: { width, height },
    before: beforeResult.navigation,
    after: afterResult.navigation,
    subjects,
    captures: subjects.map((subject, index) => ({
      id: subject.id,
      before: beforeResult.captures[index].stage,
      after: afterResult.captures[index].stage,
    })),
    browserMessages,
  }, null, 2));

  await send("Page.navigate", { url: pathToFileURL(htmlPath).href }, 90000);
  const reportDeadline = Date.now() + 30000;
  while (Date.now() < reportDeadline) {
    if (await evaluate("document.readyState === 'complete' && Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0)")) break;
    await sleep(100);
  }
  // 600s: sixteen-plus full-viewport PNGs can outlast the old budgets on a
  // machine that is also simulating two cities (a 300s print once timed out
  // AFTER 20 good captures — hence --print-only above).
  const pdf = await send("Page.printToPDF", {
    printBackground: true,
    landscape: true,
    preferCSSPageSize: true,
    paperWidth: 11.69,
    paperHeight: 8.27,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
  }, 600000);
  await writeFile(pdfPath, Buffer.from(pdf.data, "base64"));

  process.stdout.write(`\nVisual report complete\nPDF: ${pdfPath}\nHTML: ${htmlPath}\nShots: ${shotDir}\n`);
} catch (err) {
  if (!err || err._earlyExit !== true) throw err;
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const child of children.reverse()) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

if (pdfPath && !args["no-open"] && process.platform === "darwin") {
  const opener = spawn("open", [pdfPath], { detached: true, stdio: "ignore" });
  opener.unref();
}
