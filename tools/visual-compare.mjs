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

import { execFile, spawn } from "node:child_process";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome's CDP Page.printToPDF can stall after a long WebGL capture session,
// and on some Chrome builds it can even stall again in a fresh CDP session.
// The standalone headless print path uses a clean renderer and has proved much
// faster for these image-heavy, already-written reports.
async function printReportFresh(htmlPath, pdfPath) {
  const printerDir = await mkdtemp(path.join(tmpdir(), "cbz-visual-print-"));
  const freshPdf = path.join(printerDir, "report.pdf");
  try {
    await new Promise((resolve, reject) => {
      execFile(chromeBin, [
        "--headless=new", "--no-sandbox", "--disable-gpu",
        "--no-pdf-header-footer", `--print-to-pdf=${freshPdf}`,
        pathToFileURL(htmlPath).href,
      ], { cwd: ROOT, timeout: 120000, maxBuffer: 1024 * 1024 }, (err) => err ? reject(err) : resolve());
    });
    await copyFile(freshPdf, pdfPath);
  }
  finally { await rm(printerDir, { recursive: true, force: true }).catch(() => {}); }
}

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

/* DEVICE FRAMES ------------------------------------------------------------
   A layout regression is a shape, not a pixel: the same screen is right at
   393pt and wrong at 852pt. One viewport per run could only ever photograph
   one shape, so a responsive change had to be argued rather than shown.
   A frame is a viewport WITH its device identity — pixel ratio, mobile flag,
   touch, user agent, screen orientation — because the build branches on all
   of them (`body.touch` alone decides whether the phone controls exist).
   Known limit: Chrome cannot emulate safe-area insets, so a notch/home-bar
   overlap is invisible here and still needs the simulator. */
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const DEVICE_FRAMES = {
  "iphone-se": { label: "iPhone SE", width: 375, height: 667, dsf: 2, mobile: true, ua: IOS_UA },
  "iphone-16": { label: "iPhone 16", width: 393, height: 852, dsf: 3, mobile: true, ua: IOS_UA },
  "iphone-16-max": { label: "iPhone 16 Pro Max", width: 440, height: 956, dsf: 3, mobile: true, ua: IOS_UA },
  "pixel-8": { label: "Pixel 8", width: 412, height: 915, dsf: 2.625, mobile: true, ua: ANDROID_UA },
  "ipad-mini": { label: "iPad mini", width: 744, height: 1133, dsf: 2, mobile: true, ua: IPAD_UA },
  "ipad-pro-11": { label: "iPad Pro 11\"", width: 834, height: 1194, dsf: 2, mobile: true, ua: IPAD_UA },
  "laptop": { label: "Laptop", width: 1440, height: 900, dsf: 2, mobile: false, ua: null, rotates: false },
  "desktop": { label: "Desktop", width: 1920, height: 1080, dsf: 1, mobile: false, ua: null, rotates: false },
};
const DEVICE_FAMILY_ALL = ["iphone-se", "iphone-16", "ipad-mini", "laptop"];

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`Visual before/after report\n\n` +
    `  --preset NAME|FILE   visual recipe (default: wildlife-attachments)\n` +
    `  --before URL         baseline build URL (required), or the word "local":\n` +
    `                       both sides then serve from THIS checkout and only the\n` +
    `                       per-side params differ — the honest A/B for a\n` +
    `                       behavior flag (presets can set defaultBefore/beforeParams)\n` +
    `  --before-params S    extra query params for the before side ("cfg_X=0&k=v")\n` +
    `  --after-params S     extra query params for the after side\n` +
    `  --after URL          changed build URL (default: temporary local server)\n` +
    `  --out DIR            report directory (default: artifacts/visual-comparisons/...)\n` +
    `  --reuse-before DIR   reuse a completed run's before shots + stage metadata\n` +
    `                       (fast visual iteration without reopening deployed)\n` +
    `  --subjects a,b,c     capture only these subject ids\n` +
    `  --limit N            capture only the first N subjects\n` +
    `  --no-open            do not open the generated PDF\n` +
    `  --keep-going         a failed subject becomes an error page instead of aborting the run\n` +
    `  --width N --height N capture viewport (defaults: preset or 960x600)\n` +
    `  --devices a,b,c      capture every subject once per DEVICE FRAME instead of one\n` +
    `                       viewport. "all" = the standard family. Known ids:\n` +
    `                       ${Object.keys(DEVICE_FRAMES).join(", ")}\n` +
    `  --orientations p,l   portrait|landscape (default: portrait). Applies to every\n` +
    `                       rotatable frame; laptop/desktop ignore it.\n` +
    `  --frames a:landscape,b:portrait  explicit frame list, overrides the two above\n` +
    `  --dsf N              force a device pixel ratio for every frame\n` +
    `  --only before|after  capture one side only, skip the report (fast look iteration)\n` +
    `  --no-pdf            write screenshots/HTML/metadata but skip Chrome PDF printing\n` +
    `  --cdp-timeout MS     ceiling on every CDP call (default 60000). Raise it for a\n` +
    `                       preset that simulates real world-seconds, or a slow box:\n` +
    `                       a frozen main thread cannot answer a poll, and the\n` +
    `                       timeout looks exactly like a hang. CBZ_CDP_TIMEOUT too.\n` +
    `  --print-only        reprint an existing report.html in --out without recapturing\n` +
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

const reuseBeforeDir = args["reuse-before"]
  ? path.resolve(ROOT, String(args["reuse-before"]))
  : null;
let reuseMetadata = null;
if (reuseBeforeDir) {
  try {
    reuseMetadata = JSON.parse(await readFile(path.join(reuseBeforeDir, "metadata.json"), "utf8"));
  } catch (err) {
    throw new Error(`--reuse-before needs a completed visual run with metadata.json: ${reuseBeforeDir}`);
  }
}
const beforeUrlRaw = String(args.before || process.env.CBZ_VISUAL_BEFORE || reuseMetadata?.before?.final || preset.defaultBefore || "");
// --print-only reprints a report that already exists on disk: it opens no
// browser, serves nothing and navigates nowhere, so demanding a baseline URL
// from it is a guard firing at the wrong caller. (It rejected the one command
// you reach for when a run finished with --no-pdf and you now want the PDF.)
if (!beforeUrlRaw && !args["print-only"]) throw new Error("--before URL is required (or preset.defaultBefore; the value \"local\" runs a same-checkout flag-A/B — see --before-params)");
function makeFrame(deviceId, orientation) {
  const device = DEVICE_FRAMES[deviceId];
  if (!device) throw new Error(`Unknown device "${deviceId}". Known: ${Object.keys(DEVICE_FRAMES).join(", ")}`);
  // A laptop has no portrait. Rotating it would photograph a shape no user
  // ever sees, so fixed frames collapse both orientations into one capture.
  const rotatable = device.rotates !== false;
  const landscape = rotatable && orientation === "landscape";
  return {
    id: rotatable ? `${deviceId}-${landscape ? "landscape" : "portrait"}` : deviceId,
    device: deviceId,
    label: device.label,
    orientation: rotatable ? (landscape ? "landscape" : "portrait") : "fixed",
    width: landscape ? device.height : device.width,
    height: landscape ? device.width : device.height,
    dsf: Number(args.dsf || device.dsf || 1),
    mobile: device.mobile === true,
    ua: device.ua || null,
    landscape,
  };
}
const readOrientations = (value) => String(value).split(",")
  .map((token) => token.trim().toLowerCase()).filter(Boolean)
  .map((token) => (token.startsWith("l") ? "landscape" : "portrait"));

let frames;
// A UI preset knows which shapes it is a claim about, so it can ship its own
// frame list and be rerun identically months later without CLI archaeology.
const frameSpec = args.frames || (Array.isArray(preset.frameList) ? preset.frameList.join(",") : "");
if (frameSpec) {
  frames = String(frameSpec).split(",").map((token) => token.trim()).filter(Boolean).map((token) => {
    const [deviceId, orientation] = token.split(":");
    return makeFrame(deviceId, readOrientations(orientation || "portrait")[0]);
  });
} else if (args.devices || args.device || preset.devices) {
  const requested = String(args.devices || args.device || (preset.devices || []).join(","));
  const deviceIds = requested === "all"
    ? DEVICE_FAMILY_ALL.slice()
    : requested.split(",").map((token) => token.trim()).filter(Boolean);
  const orientations = readOrientations(args.orientations || args.orientation || preset.orientations || "portrait");
  frames = [];
  const seen = new Set();
  for (const deviceId of deviceIds) {
    for (const orientation of orientations) {
      const frame = makeFrame(deviceId, orientation);
      if (seen.has(frame.id)) continue;
      seen.add(frame.id);
      frames.push(frame);
    }
  }
} else {
  // No device asked for: the historic single-viewport run, unchanged.
  const customWidth = Number(args.width || preset.viewport?.width || 960);
  const customHeight = Number(args.height || preset.viewport?.height || 600);
  frames = [{
    id: "custom", device: "custom", label: `${customWidth}x${customHeight}`, orientation: "fixed",
    width: customWidth, height: customHeight, dsf: Number(args.dsf || 1),
    mobile: false, ua: null, landscape: customWidth >= customHeight,
  }];
}
if (!frames.length) throw new Error("No device frames selected");
for (const frame of frames) {
  if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width < 320 || frame.height < 240) {
    throw new Error(`frame ${frame.id} must be at least 320x240`);
  }
}
// The browser window only has to be big enough for the largest frame; every
// capture size comes from that frame's own emulation override.
const width = Math.max(...frames.map((frame) => frame.width));
const height = Math.max(...frames.map((frame) => frame.height));
const frameSignature = frames.map((frame) => `${frame.id}@${frame.width}x${frame.height}`).join(",");

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
if (reuseBeforeDir && path.resolve(reuseBeforeDir) === path.resolve(outputDir)) {
  throw new Error("--reuse-before and --out must be different directories");
}
await mkdir(path.join(shotDir, "before"), { recursive: true });
await mkdir(path.join(shotDir, "after"), { recursive: true });

/* PORTS ARE RESERVED, NOT GUESSED. This tool is run by several agents AT ONCE
   on the same checkout (that is the point of the --before local flag A/B: each
   agent's change rides its own cfg_* flag, so one working tree carries N
   parallel before/afters). A random port with no free-check made collisions a
   1-in-a-few-hundred silent disaster in exactly that setting: a colliding
   debugPort attaches this run to a SIBLING AGENT'S Chrome and navigates their
   capture out from under them; a colliding webPort rides a sibling's devserver
   that dies when they finish. So: bind-test each candidate and keep rolling
   until the OS actually grants it. The bind is released just before the real
   process spawns — a race window of milliseconds against another picker that
   also just verified a DIFFERENT random candidate, versus the old scheme's
   permanent blind spot. */
async function pickFreePort(base, span) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = base + Math.floor(Math.random() * span);
    const free = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error(`no free port found in ${base}..${base + span}`);
}
const webPort = await pickFreePort(8700, 500);
const debugPort = await pickFreePort(10400, 500);
const localUrl = `http://127.0.0.1:${webPort}/`;
const afterUrl = String(args.after || process.env.CBZ_VISUAL_AFTER || localUrl);
/* "--before local" (or preset.defaultBefore = "local"): the SAME checkout
   serves both sides and the per-side params (preset.beforeParams, usually one
   cfg_* flag flipped OFF) are the only difference. That is the honest A/B for
   a BEHAVIOR change — the deployed build differs by every commit since deploy,
   a flag flip differs by exactly the change under test. The tool used to make
   this impossible: the local port is random and chosen here, after --before
   had to already be a concrete URL. */
const beforeIsLocal = beforeUrlRaw === "local";
const beforeUrl = beforeIsLocal ? localUrl : beforeUrlRaw;
const startsLocalServer = (!args.after && !process.env.CBZ_VISUAL_AFTER) || beforeIsLocal;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");

// Printing an existing report needs no server, DevTools connection, or WebGL
// capture browser. Exit before allocating any of those resources so the fresh
// standalone renderer is genuinely fresh.
if (args["print-only"]) {
  const htmlPath = path.join(outputDir, "report.html");
  const pdfPath = path.join(outputDir, "before-after.pdf");
  await printReportFresh(htmlPath, pdfPath);
  process.stdout.write(`\nPDF reprinted: ${pdfPath}\n`);
  if (!args["no-open"] && process.platform === "darwin") {
    const opener = spawn("open", [pdfPath], { detached: true, stdio: "ignore" });
    opener.unref();
  }
  process.exit(0);
}

const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-visual-compare-"));
const children = [];
let captureResourcesClosed = false;

async function closeCaptureResources() {
  if (captureResourcesClosed) return;
  captureResourcesClosed = true;
  if (ws && ws.readyState <= 1) ws.close();
  for (const child of children.reverse()) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

if (startsLocalServer) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(webPort) },
    stdio: "ignore",
  }));
}

/* THE BEFORE-SIDE IS ON THE INTERNET, and some environments only reach it
   through an HTTP proxy — a CI runner, a corporate network, an agent sandbox.
   curl and node read HTTPS_PROXY from the environment; Chrome does not, it
   needs --proxy-server on the command line, and then the local dev server
   (which is the AFTER side) has to be excluded or it gets tunnelled too.
   Auto-wired from the standard variables, so the common case needs no flag,
   and CBZ_CHROME_ARGS is there for anything else the host needs to pass.

   FIELD NOTES from a TLS-intercepting sandbox (2026-08-15), because the
   failure is silent and the diagnosis took a netlog: a MITM proxy re-signs
   every site, and Chromium trusts only its NSS store — the CA env vars that
   satisfy curl/node do nothing for it. Import the proxy bundle first:
     certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n proxy -i <ca.crt>
   (one call per cert in the bundle). And if the tunnel then RESETS on every
   ClientHello while curl works, the interceptor cannot parse Chrome's
   TLS 1.3 hello — CBZ_CHROME_ARGS="--ssl-version-max=tls1.2" negotiates
   around it with certificate verification fully intact. Never
   --ignore-certificate-errors: a comparison photographed over broken TLS
   proves nothing about either side. */
const envProxy = process.env.CBZ_CHROME_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyArgs = envProxy ? [
  `--proxy-server=${envProxy}`,
  `--proxy-bypass-list=${process.env.CBZ_CHROME_PROXY_BYPASS || "127.0.0.1;localhost;[::1]"}`,
] : [];
const extraChromeArgs = String(process.env.CBZ_CHROME_ARGS || "").split(/\s+/).filter(Boolean);

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
  ...proxyArgs,
  ...extraChromeArgs,
  "about:blank",
], { cwd: ROOT, stdio: "ignore" });
children.push(chrome);

let ws;
let sequence = 1;
const pending = new Map();
const browserMessages = [];
const browserMessageIndex = new Map();
let activeSide = null;

function recordBrowserMessage(type, value) {
  const text = String(value || "");
  const side = activeSide || "setup";
  const key = `${side}\u0000${type}\u0000${text}`;
  const prior = browserMessageIndex.get(key);
  if (prior) { prior.count++; return; }
  const rec = { side, type, text, count: 1 };
  browserMessageIndex.set(key, rec);
  browserMessages.push(rec);
}

/* HOW LONG TO WAIT ON A FROZEN MAIN THREAD.

   Every CDP call here had a hard-wired 60 s ceiling, and for years that was
   plenty. It stopped being plenty the day a preset started simulating real
   world-seconds: the world build is ONE synchronous task and a stage that
   steps sixteen seconds of a 25 km sea is another, and while either is running
   the page cannot answer a readiness poll — so the transport gives up on a
   page that is working perfectly. The failure surfaces as
   "Runtime.evaluate timed out", which reads like a hang and sent several
   people hunting a boot regression that did not exist.

   `preset.stageTimeoutMs` already covered the stage call. This covers
   everything else — navigation, readiness, screenshots — and is one knob:
   --cdp-timeout <ms>, or CBZ_CDP_TIMEOUT. It is not a fix for slowness; it is
   the difference between "this machine needs longer" and "this is broken",
   which are the two diagnoses that keep being confused. */
const CDP_TIMEOUT = Math.max(15000,
  Number(args["cdp-timeout"] || process.env.CBZ_CDP_TIMEOUT) || 60000);

function send(method, params = {}, timeoutMs = CDP_TIMEOUT) {
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

async function evaluate(expression, timeoutMs = CDP_TIMEOUT) {
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

function parseParamString(value) {
  const out = {};
  for (const pair of String(value || "").split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) out[pair] = "1";
    else out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/* WHICH PAGE OF THE BUILD. Every preset until now photographed index.html,
   because --before/--after name a BUILD ROOT and the runner navigated straight
   to it. games/ is a dozen standalone games served out of that same root, and
   not one of them could be compared at all — a preset for the NPC War had no
   way to say "the same two builds, but the battle page". `preset.page` is that
   one word, resolved against whichever root each side was given, so a deployed
   baseline and a local checkout stay directly comparable. Absolute values are
   honoured for the rare preset that needs a different origin. */
function withPresetPage(url) {
  const page = preset && preset.page;
  if (!page) return url;
  const base = url.endsWith("/") ? url : `${url}/`;
  return new URL(String(page), base).href;
}

function cacheBusted(url, side) {
  const parsed = new URL(withPresetPage(url));
  // Presets may pin URL params (seed, cfg_* flags) so both sides boot the
  // exact same deterministic world.
  for (const [key, value] of Object.entries(preset.urlParams || {})) {
    parsed.searchParams.set(key, String(value));
  }
  // PER-SIDE params — the flag-A/B mechanism. preset.beforeParams usually
  // flips one cfg_* flag OFF so the before side runs the pre-wave code path
  // from the same checkout; afterParams exists for symmetry. The CLI
  // (--before-params/--after-params, "k=v&k2=v2") composes on top for
  // one-off experiments without editing the preset.
  const sidePreset = side === "before" ? preset.beforeParams : preset.afterParams;
  for (const [key, value] of Object.entries(sidePreset || {})) {
    parsed.searchParams.set(key, String(value));
  }
  const sideCli = side === "before" ? args["before-params"] : args["after-params"];
  for (const [key, value] of Object.entries(parseParamString(sideCli))) {
    parsed.searchParams.set(key, String(value));
  }
  parsed.searchParams.set("visualCompare", `${side}-${Date.now()}`);
  return parsed.href;
}

async function navigate(url, side) {
  activeSide = side;
  const requested = cacheBusted(url, side);
  const navBudget = Math.max(90000, CDP_TIMEOUT * 1.5);
  await send("Page.navigate", { url: requested }, navBudget);
  const deadline = Date.now() + navBudget;
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
  /* Say WHY. This used to throw with no evidence, and diagnosing "readiness
     never came true" meant re-driving the browser by hand over CDP. The
     console/exception feed was already being recorded — surface its tail. */
  const notes = browserMessages
    .filter((m) => m.side === side || m.side === "setup")
    .slice(-4).map((m) => `${m.type}: ${m.text.slice(0, 140)}`).join(" | ");
  throw new Error(`${side} build never satisfied preset readiness at ${url} (document: ${lastState})` +
    (notes ? ` — browser said: ${notes}` : " — no console errors recorded (page likely never loaded: check proxy/TLS, see header notes)"));
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

// A single-viewport run keeps its historic filenames so older --reuse-before
// directories still match; only a real frame matrix takes the prefixed form.
function shotName(frameIndex, frame, subjectIndex, subject) {
  const base = `${String(subjectIndex + 1).padStart(2, "0")}-${safeName(subject.id)}`;
  if (frames.length === 1 && frames[0].id === "custom") return `${base}.png`;
  return `f${String(frameIndex + 1).padStart(2, "0")}-${safeName(frame.id)}__${base}.png`;
}

function captureAt(result, frameIndex, subjectIndex) {
  if (!result || !Array.isArray(result.captures)) return null;
  return result.captures.find((candidate) =>
    candidate.frameIndex === frameIndex && candidate.subjectIndex === subjectIndex) || null;
}

let defaultUserAgent = "";
// Device identity has to be in place BEFORE the navigation that boots the
// build: `body.touch`, the quality tier and the control layout are all decided
// once at startup, so flipping touch on an already-loaded page would photograph
// a phone-sized window still wearing its desktop controls.
async function applyFrame(frame) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: frame.width,
    height: frame.height,
    deviceScaleFactor: frame.dsf,
    mobile: frame.mobile,
    screenWidth: frame.width,
    screenHeight: frame.height,
    screenOrientation: frame.landscape
      ? { type: "landscapePrimary", angle: 90 }
      : { type: "portraitPrimary", angle: 0 },
  });
  await send("Emulation.setTouchEmulationEnabled", {
    enabled: frame.mobile,
    maxTouchPoints: frame.mobile ? 5 : 1,
  });
  await send("Emulation.setUserAgentOverride", { userAgent: frame.ua || defaultUserAgent });
}

async function reuseBeforeResult() {
  if (!reuseBeforeDir || !reuseMetadata) return null;
  if (reuseMetadata.preset?.id && preset.id && reuseMetadata.preset.id !== preset.id) {
    throw new Error(`--reuse-before preset mismatch: ${reuseMetadata.preset.id} != ${preset.id}`);
  }
  const priorSignature = reuseMetadata.frameSignature || (reuseMetadata.viewport
    ? `custom@${reuseMetadata.viewport.width}x${reuseMetadata.viewport.height}` : "");
  if (priorSignature !== frameSignature) {
    throw new Error(`--reuse-before frame mismatch: recorded "${priorSignature}", now "${frameSignature}"`);
  }
  const priorCaptures = Array.isArray(reuseMetadata.captures) ? reuseMetadata.captures : [];
  const captures = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex];
    for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex++) {
      const subject = subjects[subjectIndex];
      const priorCapture = priorCaptures.find((candidate) => candidate
        && candidate.id === subject.id && (candidate.frame || "custom") === frame.id);
      if (!priorCapture || !priorCapture.before) {
        throw new Error(`--reuse-before is missing ${frame.id}/${subject.id}`);
      }
      const filename = shotName(frameIndex, frame, subjectIndex, subject);
      const sourceName = priorCapture.beforeFile || filename;
      try {
        await copyFile(path.join(reuseBeforeDir, "shots", "before", sourceName), path.join(shotDir, "before", filename));
      } catch (err) {
        throw new Error(`--reuse-before is missing shots/before/${sourceName}`);
      }
      // Keep the recorded baseline stage as baseline truth. Any deliberate
      // before→after coordinate-frame change is applied only when the after side
      // consumes this reference (captureSide's transformReferenceStage hook),
      // so metadata never lies about where the copied before pixels came from.
      captures.push({ frame, frameIndex, subject, subjectIndex, filename, stage: priorCapture.before });
    }
  }
  process.stdout.write(`[before] reused ${captures.length} matched shots from ${reuseBeforeDir}\n`);
  return {
    navigation: reuseMetadata.before || { requested: beforeUrl, final: beforeUrl },
    captures,
    reusedFrom: reuseBeforeDir,
  };
}

async function captureSide(side, sourceUrl, referenceResult = null) {
  const captures = [];
  let nav = null;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
  const frame = frames[frameIndex];
  await applyFrame(frame);
  nav = await navigate(sourceUrl, side);
  for (let index = 0; index < subjects.length; index++) {
    const subject = subjects[index];
    process.stdout.write(`[${side}] ${frame.id} ${index + 1}/${subjects.length} ${subject.label || subject.id}\n`);
    let referenceStage = captureAt(referenceResult, frameIndex, index)?.stage || null;
    // Repairs can move the SUBJECT while preserving the tripod relationship:
    // a room leaves a stairwell, a grounded vehicle returns to its road, etc.
    // This hook runs for both fresh and --reuse-before baselines. Keeping it in
    // the comparator (rather than hidden inside a preset's stage function)
    // makes the changed world camera explicit and prevents double transforms.
    if (side === "after" && referenceStage && typeof preset.transformReferenceStage === "function") {
      const adjusted = preset.transformReferenceStage({
        subject, stage: referenceStage,
        viewport: { width: frame.width, height: frame.height }, frame, referenceResult,
      });
      if (adjusted) referenceStage = adjusted;
    }
    const stageInput = {
      subject,
      side,
      sourceUrl: nav.final,
      width: frame.width,
      height: frame.height,
      // Presets that lay out UI (rather than pose a model) branch on this to
      // scroll to the right band or expand a collapsed section per device.
      frame: {
        id: frame.id, device: frame.device, label: frame.label,
        orientation: frame.orientation, width: frame.width, height: frame.height,
        dsf: frame.dsf, mobile: frame.mobile,
      },
      // CLI overrides so a flag-A/B run (--before "…?cfg_X=0" against the same
      // local build) does not stamp its shots with a lying "DEPLOYED" banner.
      beforeLabel: String(args["before-label"] || preset.beforeLabel || "BEFORE · DEPLOYED"),
      afterLabel: String(args["after-label"] || preset.afterLabel || "AFTER · LOCAL"),
      // The after side can reuse exact staging data (especially the camera)
      // returned by the matching before capture. Presets opt in by reading it.
      referenceStage,
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
    /* THE SHOT ITSELF CAN FAIL, AND IT MUST NOT SINK THE RUN. Learned the
       expensive way (2026-08-23): a 5-frame x 2-subject matrix staged all ten
       BEFORE captures on a loaded box, then ONE Page.captureScreenshot — a
       1440x900@2x software raster under SwiftShader — outran the generic CDP
       timeout, the exception flew past --keep-going (which only guarded
       staging), and twenty-plus minutes of completed captures died with the
       process. Two changes: the screenshot gets a rasterisation-sized timeout
       of its own, and the settle + shot are inside the same keep-going
       contract as staging — a capture whose pixels never arrived is recorded
       as a FAILED capture (stage.ok=false, filename=null; the report prints
       NOT CAPTURED, the summary counts it) while its already-measured metrics
       are kept, and the run carries on. */
    const filename = shotName(frameIndex, frame, index, subject);
    let shotFile = null;
    try {
      await evaluate(`(async () => {
        // A deterministic preset may freeze window.requestAnimationFrame after
        // staging its simulation. Await a preset's explicit compositor render
        // here: otherwise metadata can describe the new camera while Chrome's
        // canvas layer still contains the previous player view.
        if (window.__cbzVisualCompare && window.__cbzVisualCompare.render) await window.__cbzVisualCompare.render();
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
      }, Math.max(CDP_TIMEOUT, 180000));
      await writeFile(path.join(shotDir, side, filename), Buffer.from(screenshot.data, "base64"));
      shotFile = filename;
    } catch (err) {
      if (!args["keep-going"]) throw err;
      process.stdout.write(`[${side}] ${subject.id} SCREENSHOT FAILED (kept going): ${err.message}\n`);
      stageResult = {
        ok: false,
        error: `screenshot failed: ${err.message}`,
        metrics: stageResult && stageResult.metrics ? stageResult.metrics : undefined,
      };
    }
    /* FILM STRIP — motion photographed as stills. A still cannot show "he
       stopped to shoot" or "he pressed his face into the wall"; a row of
       frames can. A subject declares `strip: {frames, stepSec}` and the
       page's __cbzVisualCompare.advance(stepSec) hook steps ITS OWN frozen
       simulation between captures, so both sides photograph the identical
       simulated seconds. After the strip, the optional metrics() hook merges
       numbers the preset sampled over those exact photographed frames —
       the metric and the pictures describe the same moment, by construction. */
    let stripFiles = null;
    const stripSpec = subject.strip;
    if (stripSpec && Number(stripSpec.frames) > 1 && stageResult && stageResult.ok === true && shotFile) {
      stripFiles = [shotFile];
      const stepSec = Number(stripSpec.stepSec) || 0.5;
      for (let stepIndex = 1; stepIndex < Number(stripSpec.frames); stepIndex++) {
        await evaluate(`(async () => {
          const H = window.__cbzVisualCompare;
          if (H && H.advance) await H.advance(${stepSec});
          if (H && H.render) await H.render();
          void document.documentElement.offsetHeight;
          return true;
        })()`, 120000);
        await evaluate(`new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(true); } };
          requestAnimationFrame(() => requestAnimationFrame(finish));
          setTimeout(finish, 180);
        })`);
        const stripShot = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
          fromSurface: true,
        }, Math.max(CDP_TIMEOUT, 180000));
        const stripName = shotFile.replace(/\.png$/, `-t${stepIndex}.png`);
        await writeFile(path.join(shotDir, side, stripName), Buffer.from(stripShot.data, "base64"));
        stripFiles.push(stripName);
      }
      try {
        const sampled = await evaluate(
          "window.__cbzVisualCompare && window.__cbzVisualCompare.metrics ? window.__cbzVisualCompare.metrics() : null");
        if (sampled && typeof sampled === "object") {
          stageResult.metrics = Object.assign({}, stageResult.metrics || {}, sampled);
        }
      } catch (_) {}
    }
    captures.push({ frame, frameIndex, subject, subjectIndex: index, filename: shotFile, stage: stageResult, stripFiles });
  }
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
function frameChip(frame) {
  if (frame.id === "custom") return `${frame.width}x${frame.height}`;
  const orientation = frame.orientation === "fixed" ? "" : ` · ${frame.orientation}`;
  return `${frame.label} · ${frame.width}x${frame.height}${orientation}`;
}

function metricsRows(before, after) {
  const rows = [];
  frames.forEach((frame, frameIndex) => {
    subjects.forEach((subject, subjectIndex) => {
      const beforeMetrics = captureAt(before, frameIndex, subjectIndex)?.stage?.metrics || null;
      const afterMetrics = captureAt(after, frameIndex, subjectIndex)?.stage?.metrics || null;
      if (!beforeMetrics && !afterMetrics) return;
      const keys = [...new Set([
        ...Object.keys(beforeMetrics || {}),
        ...Object.keys(afterMetrics || {}),
      ])];
      for (const key of keys) {
        // metricsWhitelist: a stage function often carries a full audit dump
        // (dozens of vol_*/audit_* numbers) so metadata.json can answer any
        // later question — but printed raw it turns the measurements page
        // into a wall. A preset that sets the flag prints only the rows it
        // names in `metrics`; everything else stays in the metadata.
        if (preset.metricsWhitelist && !(preset.metrics || {})[key]) continue;
        const spec = (preset.metrics || {})[key] || {};
        rows.push({
          subject,
          frame,
          cellLabel: frames.length > 1
            ? `${subject.label || subject.id} · ${frame.label} ${frame.orientation}`
            : (subject.label || subject.id),
          key,
          spec,
          before: beforeMetrics ? beforeMetrics[key] : null,
          after: afterMetrics ? afterMetrics[key] : null,
        });
      }
    });
  });
  // A preset often exposes one global live audit on every camera. Printing
  // that identical snapshot once per subject made a ten-view report grow a
  // forty-row metrics page whose bottom rows were literally off the PDF.
  // Coalesce only byte-identical key/before/after rows; genuinely per-subject
  // measurements remain separate.
  const grouped = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.key, row.before, row.after]);
    const group = grouped.get(key);
    if (group) group.cells.push(row.cellLabel);
    else grouped.set(key, Object.assign({}, row, { cells: [row.cellLabel] }));
  }
  const total = frames.length * subjects.length;
  return [...grouped.values()].map((row) => Object.assign(row, {
    subjectLabel: row.cells.length === total
      ? `All ${total} matched captures`
      : row.cells.join(", "),
  }));
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
    return `<tr><td>${htmlEscape(row.subjectLabel)}</td>` +
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
  const metricPage = metricsPageHtml(before, after);
  const captureCount = subjects.length * frames.length;
  const reportPageCount = captureCount + (frames.length > 1 ? subjects.length : 0) + 1 + (metricPage ? 1 : 0);
  // Captions follow the same precedence as the stage input: CLI override, then
  // the preset's own labels, then the historic deployed-vs-local defaults —
  // so a flag-A/B run never prints a lying "DEPLOYED" banner anywhere.
  const beforeCaption = htmlEscape(String(args["before-label"] || preset.beforeLabel || "DEPLOYED PAGE"));
  const afterCaption = htmlEscape(String(args["after-label"] || preset.afterLabel || "LOCAL REPAIR"));
  const shotOf = (result, cls, frameIndex, subjectIndex) => {
    const capture = captureAt(result, frameIndex, subjectIndex);
    return capture?.filename
      ? `<img src="shots/${cls}/${htmlEscape(capture.filename)}">`
      : `<div class="stageError">NOT CAPTURED</div>`;
  };
  // One page per subject showing the whole device family at once. A responsive
  // change is a claim about every width simultaneously, and only this page can
  // carry that claim; the detail pages that follow prove each width in full.
  const overviewPage = (subject, subjectIndex) => {
    if (frames.length < 2) return "";
    const columns = Math.min(frames.length, 4);
    const cells = frames.map((frame, frameIndex) => `<div class="frameCell">
        <div class="frameName">${htmlEscape(frameChip(frame))}</div>
        <div class="frameShots">
          <figure class="before">${shotOf(before, "before", frameIndex, subjectIndex)}</figure>
          <figure class="after">${shotOf(after, "after", frameIndex, subjectIndex)}</figure>
        </div>
      </div>`).join("\n");
    return `<section class="page overview">
      <header><div><span class="number">▦</span><h2>${htmlEscape(subject.label || subject.id)} · every frame</h2></div><p>Left red = before, right green = after, at ${frames.length} device frames.</p></header>
      <div class="frameGrid" style="grid-template-columns:repeat(${columns},1fr)">${cells}</div>
      <footer><span>${htmlEscape(subject.id)}</span><span>${htmlEscape(frames.map((frame) => frame.id).join(" · "))}</span></footer>
    </section>`;
  };
  /* FILM-STRIP PAGE: both sides' strips as two labeled rows over the same
     simulated seconds, so a motion claim reads left-to-right like a contact
     sheet — the before row melts (bodies in different places every frame),
     the after row holds (a planted body is the same pixels four times). */
  const stripPage = (subject, subjectIndex) => {
    const beforeCapture = captureAt(before, 0, subjectIndex);
    const afterCapture = captureAt(after, 0, subjectIndex);
    const beforeFiles = beforeCapture?.stripFiles || null;
    const afterFiles = afterCapture?.stripFiles || null;
    if (!beforeFiles && !afterFiles) return "";
    const stepSec = Number(subject.strip?.stepSec) || 0.5;
    const columns = Math.max(beforeFiles?.length || 0, afterFiles?.length || 0, 1);
    const row = (files, cls) => (files || []).map((file, i) =>
      `<figure class="${cls}"><figcaption>t+${(i * stepSec).toFixed(1)}s</figcaption><img src="shots/${cls}/${htmlEscape(file)}"></figure>`).join("");
    return `<section class="page filmstrip">
      <header><div><span class="number">▶</span><h2>${htmlEscape(subject.label || subject.id)} · over time</h2></div><p>The same simulated seconds on both builds, photographed every ${stepSec.toFixed(1)}s. Motion is the claim; the strip is the proof.</p></header>
      <div class="stripRow"><span class="stripTag">${beforeCaption}</span><div class="stripShots" style="grid-template-columns:repeat(${columns},1fr)">${row(beforeFiles, "before")}</div></div>
      <div class="stripRow"><span class="stripTag after">${afterCaption}</span><div class="stripShots" style="grid-template-columns:repeat(${columns},1fr)">${row(afterFiles, "after")}</div></div>
      <footer><span>${htmlEscape(subject.id)} · film strip</span><span>${htmlEscape(pairNote)}</span></footer>
    </section>`;
  };
  const pages = subjects.map((subject, subjectIndex) => {
    const focus = subject.focus || preset.defaultFocus || "Compare silhouette, seams, and physical continuity.";
    const details = frames.map((frame, frameIndex) => {
      const side = (result, cls, caption, sub) => {
        const capture = captureAt(result, frameIndex, subjectIndex);
        const stageError = capture?.stage?.ok !== true ? (capture?.stage?.error || "stage failed") : null;
        const note = stageError ? `<div class="stageError">${htmlEscape(stageError)}</div>` : "";
        return `<figure class="${cls}"><figcaption>${caption} <small>${sub}</small></figcaption>` +
          `${shotOf(result, cls, frameIndex, subjectIndex)}${note}</figure>`;
      };
      const number = frames.length > 1
        ? `${String(subjectIndex + 1).padStart(2, "0")}.${String(frameIndex + 1).padStart(2, "0")}`
        : String(subjectIndex + 1).padStart(2, "0");
      const heading = frames.length > 1
        ? `${subject.label || subject.id} · ${frame.label}`
        : (subject.label || subject.id);
      return `<section class="page detail">
      <header><div><span class="number">${number}</span><h2>${htmlEscape(heading)}</h2></div><p>${htmlEscape(focus)}</p></header>
      <div class="pair">
        ${side(before, "before", "BEFORE", beforeCaption)}
        ${side(after, "after", "AFTER", afterCaption)}
      </div>
      <footer><span>${htmlEscape(subject.id)} · ${htmlEscape(frameChip(frame))}</span><span>${htmlEscape(pairNote)}</span></footer>
    </section>`;
    }).join("\n");
    return overviewPage(subject, subjectIndex) + "\n" + details + "\n" + stripPage(subject, subjectIndex);
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
    .pair { height: 148mm; display:grid; grid-template-columns:1fr 1fr; gap:5mm; align-items:stretch; }
    figure { margin:0; background:#111a23; border:1px solid #35485a; border-radius:3mm; overflow:hidden; display:flex; flex-direction:column; }
    figure.before { border-top:2mm solid #f06464; } figure.after { border-top:2mm solid #59d59a; }
    figcaption { height:11mm; padding:2.4mm 4mm; font-weight:850; font-size:13px; letter-spacing:.09em; flex:0 0 auto; }
    figcaption small { float:right; color:#9babb8; font-size:9px; line-height:16px; }
    /* CONTAIN, never cover. A cropped screenshot hides the very edge where a
       responsive layout breaks — the gutter, the clipped button, the overflow. */
    figure img { display:block; margin:auto; max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; min-height:0; }
    .detail .pair figure img { max-height:135mm; }
    .overview .frameGrid { height:150mm; display:grid; gap:4mm; align-items:start; }
    .frameCell { height:100%; display:flex; flex-direction:column; gap:2mm; min-height:0; }
    .frameName { color:#80c9ff; font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; flex:0 0 auto; }
    .frameShots { flex:1 1 auto; display:grid; grid-template-columns:1fr 1fr; gap:2mm; min-height:0; }
    .frameShots figure { border-radius:2mm; border-top-width:1.2mm; }
    .stageError { padding:4mm; color:#ffb3b3; font:11px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere; }
    footer { position:absolute; left:14mm; right:14mm; bottom:6mm; display:flex; justify-content:space-between; color:#6f8496; font:10px ui-monospace, SFMono-Regular, Menlo, monospace; }
    /* Evidence must fit the delivered page, not merely the browser DOM.  A4
       landscape has room for the declared compact audit, but the old 3 mm
       row padding clipped the final rows even after raw metrics were filtered. */
    .metrics table { width:100%; border-collapse:collapse; margin-top:3mm; font-size:10.2px; line-height:1.12; }
    .metrics th { text-align:left; color:#80c9ff; letter-spacing:.08em; font-size:9px; text-transform:uppercase; padding:.9mm 2mm; border-bottom:1px solid #35485a; }
    .metrics td { padding:.85mm 2mm; border-bottom:1px solid #22303f; font-variant-numeric:tabular-nums; }
    .metrics td small { color:#8fa2b2; }
    .metrics td.good { color:#59d59a; font-weight:800; }
    .metrics td.bad { color:#f06464; font-weight:800; }
    .filmstrip .stripRow { display:flex; gap:3mm; align-items:stretch; height:71mm; margin-top:3mm; }
    .stripTag { writing-mode:vertical-rl; transform:rotate(180deg); text-align:center; font-weight:850; font-size:10px; letter-spacing:.12em; color:#f06464; flex:0 0 auto; }
    .stripTag.after { color:#59d59a; }
    .stripShots { flex:1 1 auto; display:grid; gap:2mm; min-width:0; }
    .stripShots figure { border-top-width:1mm; }
    .stripShots figcaption { height:7mm; font-size:9px; padding:1.6mm 2.4mm; }
    .stripShots img { max-height:59mm; }
  </style></head><body>
    <section class="page cover">
      <div><div class="eyebrow">DETERMINISTIC VISUAL COMPARISON</div><h1>${htmlEscape(preset.title)}</h1><p class="dek">${htmlEscape(preset.description || "Before and after captures from two real browser builds.")}</p></div>
      <div class="stats"><div class="stat"><strong>${subjects.length}</strong><span>matched subjects</span></div><div class="stat"><strong>${frames.length}</strong><span>device frames</span></div><div class="stat"><strong>${captureCount * 2}</strong><span>browser screenshots</span></div></div>
      <p class="method">Frames: ${htmlEscape(frames.map((frame) => frameChip(frame)).join("  ·  "))}</p>
      <div class="sources"><div class="source"><b>${beforeCaption}</b><code>${htmlEscape(before.navigation.final)}</code></div><div class="source after"><b>${afterCaption}</b><code>${htmlEscape(after.navigation.final)}</code></div></div>
      <p class="method">Generated ${htmlEscape(generated)}. ${htmlEscape(method)}</p>
    </section>
    ${metricPage}
    ${pages}
  </body></html>`;
}

// Keep one-sided look iterations inspectable. Previously `--only after`
// wrote pixels and threw away the stage result that explains those pixels,
// which made a fast failed-view loop impossible to debug without rerunning a
// full report. The same metadata shape is used everywhere; a skipped side is
// simply null.
async function writeRunMetadata(before, after, only = null) {
  await writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({
    preset: { id: preset.id, title: preset.title, path: path.relative(ROOT, presetPath) },
    generatedAt: new Date().toISOString(),
    only,
    reusedBeforeFrom: before?.reusedFrom || null,
    viewport: { width, height },
    frameSignature,
    frames,
    before: before?.navigation || null,
    after: after?.navigation || null,
    subjects,
    captures: frames.flatMap((frame, frameIndex) => subjects.map((subject, subjectIndex) => ({
      id: subject.id,
      frame: frame.id,
      beforeFile: captureAt(before, frameIndex, subjectIndex)?.filename || null,
      afterFile: captureAt(after, frameIndex, subjectIndex)?.filename || null,
      beforeStrip: captureAt(before, frameIndex, subjectIndex)?.stripFiles || null,
      afterStrip: captureAt(after, frameIndex, subjectIndex)?.stripFiles || null,
      before: captureAt(before, frameIndex, subjectIndex)?.stage || null,
      after: captureAt(after, frameIndex, subjectIndex)?.stage || null,
    }))),
    browserMessages,
  }, null, 2));
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
      recordBrowserMessage("exception", message.params?.exceptionDetails?.text || "runtime exception");
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params?.type)) {
      recordBrowserMessage(message.params.type,
        (message.params.args || []).map((item) => item.value || item.description || "").join(" "));
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
  // Remembered so a desktop frame can hand the UA back after a phone frame
  // borrowed Safari's; captureSide applies a frame before every navigation.
  defaultUserAgent = String(await evaluate("navigator.userAgent") || "");
  process.stdout.write(`Frames: ${frames.map((frame) => `${frame.id} ${frame.width}x${frame.height}@${frame.dsf}x`).join(", ")}\n`);

  const onlySide = args.only ? String(args.only) : null;
  if (onlySide === "after") {
    const reference = reuseBeforeDir ? await reuseBeforeResult() : null;
    afterResult = await captureSide("after", afterUrl, reference);
    await writeRunMetadata(reference, afterResult, "after");
    process.stdout.write(`\nAfter-side shots only (no report): ${path.join(shotDir, "after")}\n`);
    throw { _earlyExit: true };
  }
  if (onlySide === "before") {
    beforeResult = await captureSide("before", beforeUrl);
    await writeRunMetadata(beforeResult, null, "before");
    process.stdout.write(`\nBefore-side shots only (no report): ${path.join(shotDir, "before")}\n`);
    throw { _earlyExit: true };
  }
  beforeResult = reuseBeforeDir ? await reuseBeforeResult() : await captureSide("before", beforeUrl);
  afterResult = await captureSide("after", afterUrl, beforeResult);

  const htmlPath = path.join(outputDir, "report.html");
  pdfPath = path.join(outputDir, "before-after.pdf");
  await writeFile(htmlPath, reportHtml(beforeResult, afterResult));
  await writeRunMetadata(beforeResult, afterResult);

  // Large galleries can exceed Chrome's print compositor budget even though
  // every capture and the HTML report are already complete. Keep that useful
  // state and let callers assemble the PDF with a local image/PDF fallback.
  if (args["no-pdf"]) {
    pdfPath = null;
    process.stdout.write(`\nVisual screenshots and HTML complete (PDF skipped)\nHTML: ${htmlPath}\nShots: ${shotDir}\n`);
    throw { _earlyExit: true };
  }

  // The capture browser is carrying two complete simulated cities and is the
  // worst possible renderer to ask for a 20-image print. Release it first,
  // then use the same clean standalone path as --print-only.
  await closeCaptureResources();
  await printReportFresh(htmlPath, pdfPath);

  process.stdout.write(`\nVisual report complete\nPDF: ${pdfPath}\nHTML: ${htmlPath}\nShots: ${shotDir}\n`);
} catch (err) {
  if (!err || err._earlyExit !== true) throw err;
} finally {
  await closeCaptureResources();
}

if (pdfPath && !args["no-open"] && process.platform === "darwin") {
  const opener = spawn("open", [pdfPath], { detached: true, stdio: "ignore" });
  opener.unref();
}
