/* ba/lib/show.mjs — the receipt, IN the terminal.

   A run of `ba` leaves behind a report directory: two screenshots per subject,
   a metadata.json with the numbers, an HTML contact sheet and a PDF. Every one
   of those is a file you have to LEAVE to look at. That is the whole problem
   this command exists for — the agent that produced the receipt lives in a
   terminal, the person judging it is sitting in that same terminal, and the
   current answer to "did it work?" is "open the PDF in Preview," i.e. go
   somewhere else, look at a thing, come back and describe it. The evidence and
   the judgement end up in two different rooms.

   So: print the pictures HERE. Modern terminals can draw images inline —
   iTerm2 and WezTerm via the OSC 1337 File protocol, kitty and Ghostty via the
   kitty graphics protocol — and both are a handful of escape sequences and
   base64, no dependencies, no viewer, no second window. Under each pair goes
   the measurements table, so the picture and the number that describes it are
   one scroll apart instead of one application apart.

   THE RULES THIS FILE HOLDS ITSELF TO:

   * Only the metrics the preset DECLARED get printed, marked against the
     direction it says is better. A stage function usually returns a full audit
     dump so the metadata can answer later questions; printing all of it would
     reproduce exactly the wall of numbers the report's whitelist exists to
     prevent. Same rule the report and the summary printer already follow.

   * Never emit an escape sequence a terminal did not ask for. An unknown
     terminal gets the table, the paths and an `open` hint — not a screenful of
     base64 that it cannot decode. Degrade politely or don't degrade at all.
     That is also why a non-TTY (a pipe, a log file, an agent reading stdout)
     never gets image bytes.

   * Fit the image to the window. A 1180x700 screenshot dumped at native size
     is a wall you have to scroll to read; both protocols can scale, so we
     compute a cell box from the PNG's own header and the terminal's width.

   Usage:  ba show [dir | preset-name] [--watch] [--frames N]
     (nothing)      newest report anywhere under config.out
     preset-name    newest report whose directory starts with that name
     dir            that report directory (or its metadata.json)
     --frames N     only the first N before/after pairs
     --watch        re-render whenever a new/changed report lands
     --no-images    table and paths only

   BA_IMAGES=none|auto|iterm|kitty overrides terminal detection, for a terminal
   we guess wrong about (and for testing the emitters headlessly). */

import { readFile, readdir, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_OUT = "artifacts/visual-comparisons";
const OPENER = process.platform === "darwin" ? "open"
  : process.platform === "win32" ? "start" : "xdg-open";

/* ─── stdout ─────────────────────────────────────────────────────────────── */

// The callback form, not the drain event: an image is megabytes of base64 and
// will not fit the socket buffer, but a stdout that has already gone away (EPIPE
// on a closed pager) never fires 'drain' and would hang us forever.
function out(s) {
  return new Promise((resolve) => {
    try { process.stdout.write(s, () => resolve()); }
    catch (_) { resolve(); }
  });
}

const COLOR = (() => {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
})();
const paint = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);
const green = (s) => paint("32", s);
const red = (s) => paint("31", s);
const cyan = (s) => paint("36", s);

const cols = () => Math.max(40, process.stdout.columns || 80);
const rowsAvail = () => Math.max(12, process.stdout.rows || 24);

function wrap(text, width, indent = "") {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line.length) line = w;
    else if (line.length + 1 + w.length <= width) line += " " + w;
    else { lines.push(line); line = w; }
  }
  if (line.length) lines.push(line);
  return lines.map((l) => indent + l).join("\n");
}

/* Significant digits, not a fixed two. A flat toFixed(2) prints a turbidity of
   0.012 and one of 0.010 as the same "0.01", which is the one thing a
   before/after column must never do — the whole point is showing that two
   numbers differ. Scale the precision to the magnitude instead. */
function fmt(v) {
  if (v == null) return "—";
  if (typeof v !== "number") return String(v);
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  const m = Math.abs(v);
  if (m >= 100) return v.toFixed(1);
  if (m >= 1) return v.toFixed(2);
  if (m >= 0.001) return v.toFixed(3);
  return v.toExponential(1);
}

// A delta that rounds to zero is worse than no delta: it says "nothing moved"
// about the exact case where something did. Widen until it shows.
function fmtDelta(d) {
  const sign = d > 0 ? "+" : "-";
  const m = Math.abs(d);
  const body = fmt(m);
  return sign + (/^0\.?0*$/.test(body) ? m.toExponential(1) : body);
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ─── terminal / image protocol detection ────────────────────────────────── */

/* Which escape dialect, if any, this terminal speaks. Detection is by
   environment because there is no reliable synchronous query: a real
   capability probe means writing a request and waiting for a reply on stdin,
   which corrupts input if the terminal stays silent. Guessing wrong toward
   "none" costs a picture; guessing wrong toward "yes" spews base64 into
   somebody's session, so every unrecognised terminal falls through to none. */
function detectProtocol() {
  const forced = String(process.env.BA_IMAGES || "").toLowerCase();
  if (forced === "none" || forced === "off" || forced === "0") return "none";
  if (forced === "iterm" || forced === "iterm2") return "iterm";
  if (forced === "kitty") return "kitty";

  // A pipe is not a terminal. Anything reading this as text (an agent, a log,
  // `ba show | less`) gets the words and none of the bytes.
  if (!process.stdout.isTTY && forced !== "auto") return "none";

  const env = process.env;
  const tp = String(env.TERM_PROGRAM || "").toLowerCase();
  const term = String(env.TERM || "").toLowerCase();

  // kitty's own protocol: kitty, and Ghostty which implements it.
  if (term.includes("kitty") || env.KITTY_WINDOW_ID ||
      tp === "ghostty" || term.includes("ghostty") || env.GHOSTTY_RESOURCES_DIR) return "kitty";

  // OSC 1337: iTerm2, WezTerm (which also speaks kitty, but this one is older
  // and better tested there), mintty. LC_TERMINAL is what iTerm2 forwards over
  // ssh, where TERM_PROGRAM does not survive.
  if (tp === "iterm.app" || tp === "wezterm" || tp === "mintty") return "iterm";
  if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) return "iterm";
  if (String(env.LC_TERMINAL || "").toLowerCase().includes("iterm")) return "iterm";

  // Everything else — including VS Code, Terminal.app and whatever tmux is
  // reporting when it has lost the outer terminal's identity — gets no images.
  return "none";
}

/* tmux does not understand an image escape and will not pass one through by
   default, so anything aimed at the terminal UNDERNEATH it has to be smuggled
   inside a DCS wrapper. Every ESC in the payload is doubled because tmux's
   parser eats one level of escaping on the way out; without that the first ESC
   inside would terminate the wrapper early and the rest would land on screen as
   literal junk. tmux only forwards this at all when `allow-passthrough` is on,
   which it has not been by default since 3.3a — hence tmuxPassthroughOn(). */
function tmuxWrap(seq) {
  return "\x1bPtmux;" + seq.replace(/\x1b/g, "\x1b\x1b") + "\x1b\\";
}

let tmuxState;
function tmuxPassthroughOn() {
  if (tmuxState !== undefined) return tmuxState;
  tmuxState = false;
  try {
    const v = execFileSync("tmux", ["show", "-gv", "allow-passthrough"], {
      encoding: "utf8", timeout: 800, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    tmuxState = v === "on" || v === "all";
  } catch (_) { tmuxState = false; }
  return tmuxState;
}

/* ─── image emission ─────────────────────────────────────────────────────── */

// Width and height live at fixed offsets in the IHDR chunk, which the spec
// requires to be first — 24 bytes in and we know how big the picture is without
// decoding a single pixel.
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* How many character cells wide to draw it. Both protocols scale for us but
   neither knows what "sensible" is: unconstrained, a 1180x700 shot takes the
   full window and the table under it is off-screen. So aim for ~80% of the
   width, then, if that would make the image taller than a chunk of the window,
   shrink until it isn't. Cells are about twice as tall as they are wide; the
   terminal knows the real ratio and we don't, so 2.0 is the estimate and it is
   only ever used to make the image SMALLER than the naive answer. */
const CELL_ASPECT = 2.0;
function fitCells(dims) {
  const width = cols();
  let c = Math.max(16, Math.min(width - 4, Math.round(width * 0.8)));
  if (!dims || !dims.w || !dims.h) return c;
  const maxRows = Math.max(8, Math.min(30, rowsAvail() - 6));
  const impliedRows = (dims.h / dims.w) * c / CELL_ASPECT;
  if (impliedRows > maxRows) c = Math.max(16, Math.floor(maxRows * CELL_ASPECT * (dims.w / dims.h)));
  return c;
}

/* OSC 1337 inline File: one sequence, the whole file base64'd after the colon,
   BEL-terminated. `width` in bare cells + preserveAspectRatio lets the terminal
   pick the height, so the fit math only has to solve for one axis. */
function itermSequence(buf, name, cells) {
  const args = [
    "inline=1",
    `size=${buf.length}`,
    `name=${Buffer.from(name).toString("base64")}`,
    `width=${cells}`,
    "height=auto",
    "preserveAspectRatio=1",
  ].join(";");
  return `\x1b]1337;File=${args}:${buf.toString("base64")}\x07`;
}

/* kitty graphics: APC _G <control keys> ; <base64 chunk> ESC \.
   f=100 says the payload is a PNG (so no width/height/format negotiation),
   t=d sends the bytes inline rather than naming a file the terminal must be
   able to read — which is the only option that survives ssh and containers.
   The payload is split at 4096 base64 bytes because the protocol caps a single
   escape sequence there, so terminals can parse it with a fixed buffer; m=1
   means "more chunks follow", m=0 closes the transmission. q=2 suppresses the
   terminal's OK/error reply, which would otherwise arrive on stdin and be
   printed as garbage by whatever reads it next. c= alone sets the box width and
   lets kitty derive the height from the image's aspect ratio. */
const KITTY_CHUNK = 4096;
function kittySequences(buf, cells) {
  const b64 = buf.toString("base64");
  const controls = `a=T,f=100,t=d,q=2,c=${cells}`;
  const chunks = [];
  for (let i = 0; i < b64.length; i += KITTY_CHUNK) {
    const payload = b64.slice(i, i + KITTY_CHUNK);
    const more = i + KITTY_CHUNK < b64.length ? 1 : 0;
    const head = i === 0 ? `${controls},m=${more}` : `m=${more}`;
    chunks.push(`\x1b_G${head};${payload}\x1b\\`);
  }
  return chunks;
}

// Past a certain size the terminal spends longer decoding than you spend
// looking. Screenshots are ~0.5 MB; anything over this is not a screenshot.
const MAX_INLINE_BYTES = 12 * 1024 * 1024;

/* Draws one image. Both bail-outs come BEFORE the read: in the fallback path
   (no protocol, or piped output) a full report is twenty screenshots, and
   reading ~9 MB off disk to immediately throw it away is the sort of thing that
   makes a "just print the table" command feel slow for no reason. */
async function emitImage(file, size, proto, inTmux) {
  if (proto === "none") return { drawn: false };
  if (size > MAX_INLINE_BYTES) {
    await out(dim(`         (${human(size)} is too large to draw inline)`) + "\n");
    return { drawn: false };
  }

  let buf;
  try { buf = await readFile(file); }
  catch (_) { return { drawn: false, note: "missing" }; }

  const cells = fitCells(pngSize(buf));
  const seqs = proto === "kitty"
    ? kittySequences(buf, cells)
    : [itermSequence(buf, path.basename(file), cells)];

  for (const seq of seqs) await out(inTmux ? tmuxWrap(seq) : seq);
  // Both protocols leave the cursor after the image; this is the blank line
  // between it and whatever comes next, not a fix for the cursor.
  await out("\n");
  return { drawn: true };
}

/* Between --watch renders. Only ever on a real terminal: `ba show --watch | tee
   log` is a reasonable thing to do and a clear-screen escape in the middle of
   that file is the same garbage as an un-decodable image. Stale kitty images
   also survive a screen clear — they are placements, not text — so a=d deletes
   them or the previous run's pictures stack up behind the new ones. */
async function clearScreen(proto, inTmux) {
  if (!process.stdout.isTTY) { await out("\n"); return; }
  if (proto === "kitty") {
    const seq = "\x1b_Ga=d,q=2\x1b\\";
    await out(inTmux ? tmuxWrap(seq) : seq);
  }
  await out("\x1b[H\x1b[2J\x1b[3J");
}

/* ─── finding the receipt ────────────────────────────────────────────────── */

async function isReportDir(dir) {
  try { return (await stat(path.join(dir, "metadata.json"))).isFile(); }
  catch (_) { return false; }
}

/* Every directory under config.out that actually finished — metadata.json is
   the engine's last write, so a directory without one is a run still going (or
   a run that died) and must not be picked as "the newest report". Sorted by
   that file's mtime rather than by the timestamp in the directory name, because
   the name is chosen when the run STARTS and a long run can finish after a
   short one that began later. */
async function listReports(outAbs) {
  let entries;
  try { entries = await readdir(outAbs, { withFileTypes: true }); }
  catch (_) { return []; }
  const reports = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(outAbs, e.name);
    try {
      const st = await stat(path.join(dir, "metadata.json"));
      reports.push({ dir, name: e.name, mtime: st.mtimeMs, size: st.size });
    } catch (_) { /* not a finished report */ }
  }
  reports.sort((a, b) => b.mtime - a.mtime);
  return reports;
}

async function resolveTarget(spec, outAbs, projectRoot) {
  if (spec) {
    const bare = spec.replace(/[/\\]+$/, "");
    const asFile = /metadata\.json$/i.test(bare) ? path.dirname(bare) : bare;
    const candidates = [
      path.resolve(process.cwd(), asFile),
      path.resolve(projectRoot, asFile),
      path.resolve(outAbs, asFile),
    ];
    for (const c of candidates) if (await isReportDir(c)) return { dir: c };

    // Not a path, so it is a preset name: newest report whose directory is
    // named for it. The engine names them "<preset>-<iso timestamp>".
    const reports = await listReports(outAbs);
    if (!reports.length) return { error: `No reports under ${outAbs} to match "${spec}".` };
    const exact = reports.find((r) => r.name === spec || r.name.startsWith(spec + "-"));
    if (exact) return { dir: exact.dir };
    const loose = reports.find((r) => r.name.toLowerCase().includes(spec.toLowerCase()));
    if (loose) return { dir: loose.dir };
    return {
      error: `No report directory or preset matching "${spec}".\n` +
        `Looked in ${outAbs} — newest there: ${reports.slice(0, 5).map((r) => r.name).join(", ")}`,
    };
  }

  const reports = await listReports(outAbs);
  if (!reports.length) {
    return { error: `No reports yet in ${outAbs}. Run a comparison first, then \`ba show\`.` };
  }
  return { dir: reports[0].dir };
}

/* ─── the declared metrics ───────────────────────────────────────────────── */

/* Where the metric whitelist lives, best source first:
   1. inside metadata.json, if the engine that wrote it embedded the specs —
      the only source that keeps a report readable after the preset that
      produced it is edited or deleted, which is why it wins;
   2. the preset module the report names, imported from disk — how it works for
      reports written before the specs were embedded;
   3. nothing, in which case we print no table rather than inventing one. Every
      key in a capture's metrics is NOT a declared metric; presets dump their
      whole audit in there on purpose. */
async function loadMetricSpecs(meta, ctx) {
  const preset = meta.preset || {};
  const embedded = preset.metrics || meta.metrics;
  if (embedded && typeof embedded === "object" && Object.keys(embedded).length) {
    return { specs: embedded, note: preset.metricsNote || meta.metricsNote || null, source: "metadata" };
  }

  const root = ctx.projectRoot || process.cwd();
  const id = preset.id;
  const candidates = [];
  if (preset.path) candidates.push(path.resolve(root, preset.path));
  if (preset.file) candidates.push(path.resolve(root, preset.file));
  if (id) {
    if (ctx.config && ctx.config.presets) candidates.push(path.resolve(root, ctx.config.presets, `${id}.mjs`));
    candidates.push(path.resolve(root, "ba", "presets", `${id}.mjs`));
    candidates.push(path.resolve(root, "tools", "visual-presets", `${id}.mjs`));
  }
  for (const c of candidates) {
    try {
      if (!(await stat(c)).isFile()) continue;
      const mod = await import(pathToFileURL(c).href);
      const def = mod.default || mod;
      if (def && def.metrics && Object.keys(def.metrics).length) {
        return { specs: def.metrics, note: def.metricsNote || null, source: path.relative(root, c) || c };
      }
    } catch (_) { /* a preset that no longer loads is not an error here */ }
  }
  return { specs: null, note: null, source: null };
}

/* ─── rendering ──────────────────────────────────────────────────────────── */

function verdict(spec, before, after) {
  if (typeof before !== "number" || typeof after !== "number" || after === before) return dim("·");
  const up = after > before;
  if (spec.better === "lower") return up ? red("✗") : green("✓");
  if (spec.better === "higher") return up ? green("✓") : red("✗");
  // No declared direction: the preset is saying this number is read per beat,
  // not scored. Show the movement, refuse to call it good or bad.
  return dim("·");
}

const metricLabel = (specs, k) => (specs[k] && specs[k].label) || k;

/* Column widths are measured once over the WHOLE report rather than per table.
   Sized per capture they shift by a few characters between subjects, and the
   thing you are actually doing while scrolling a receipt — running an eye down
   one metric across every beat — stops working the moment the column moves. */
function measurementLayout(specs, captures) {
  const present = new Set();
  for (const cap of captures) {
    for (const side of ["before", "after"]) {
      const m = cap[side] && cap[side].metrics;
      if (m) for (const k of Object.keys(specs)) if (m[k] != null) present.add(k);
    }
  }
  if (!present.size) return null;
  const keys = [...present];
  return {
    wLabel: Math.max(...keys.map((k) => metricLabel(specs, k).length)),
    wUnit: Math.max(0, ...keys.map((k) => ((specs[k] && specs[k].unit) || "").length)),
  };
}

async function renderMeasurements(cap, specs, layout, indent) {
  const b = (cap.before && cap.before.metrics) || null;
  const a = (cap.after && cap.after.metrics) || null;
  if (!specs || !layout || (!b && !a)) return;
  const keys = Object.keys(specs).filter((k) => (b && b[k] != null) || (a && a[k] != null));
  if (!keys.length) return;

  const label = (k) => metricLabel(specs, k);
  const { wLabel, wUnit } = layout;

  let text = "";
  for (const k of keys) {
    const spec = specs[k] || {};
    const bv = b ? b[k] : null, av = a ? a[k] : null;
    const unitStr = spec.unit || "";
    let delta = "";
    if (typeof bv === "number" && typeof av === "number" && av !== bv) delta = "  " + dim(fmtDelta(av - bv));
    // The unit column is only padded out when a delta follows it, so rows
    // without one end at the last visible character instead of trailing spaces
    // (which a colour reset would hide from any trim done afterwards).
    const unitSeg = delta ? "  " + dim(unitStr.padEnd(wUnit)) : (unitStr ? "  " + dim(unitStr) : "");
    text += `${indent}${verdict(spec, bv, av)} ${dim(label(k).padEnd(wLabel))}  ` +
      `${fmt(bv).padStart(9)} → ${bold(fmt(av).padStart(9))}${unitSeg}${delta}\n`;
  }
  await out(text);
}

function consoleLine(meta) {
  const msgs = meta.browserMessages;
  if (!Array.isArray(msgs) || !msgs.length) return null;
  const tally = { before: { err: 0, warn: 0 }, after: { err: 0, warn: 0 } };
  for (const m of msgs) {
    const side = tally[m.side] || null;
    if (!side) continue;
    const n = Number(m.count) || 1;
    if (m.type === "exception" || m.type === "error" || m.type === "pageerror") side.err += n;
    else side.warn += n;
  }
  const say = (s) => `${s.err ? `${s.err} errors` : "clean"}${s.warn ? `, ${s.warn} warnings` : ""}`;
  return `console  before ${say(tally.before)} · after ${say(tally.after)}`;
}

async function renderReport(dir, opts, ctx) {
  let meta;
  try { meta = JSON.parse(await readFile(path.join(dir, "metadata.json"), "utf8")); }
  catch (err) {
    await out(`Cannot read ${path.join(dir, "metadata.json")}: ${err.message}\n`);
    return 1;
  }

  const proto = opts.images === "none" ? "none" : detectProtocol();
  const inTmux = Boolean(process.env.TMUX);
  const width = Math.min(cols(), 110);
  const rule = dim("─".repeat(Math.min(cols(), 78)));
  const { specs, note } = await loadMetricSpecs(meta, ctx);

  const preset = meta.preset || {};
  const captures = Array.isArray(meta.captures) ? meta.captures : [];
  const shown = opts.frames ? captures.slice(0, opts.frames) : captures;
  const subjects = new Map((meta.subjects || []).map((s) => [s.id, s]));
  const layout = specs ? measurementLayout(specs, captures) : null;
  // Captures are frames × subjects, so a multi-device run repeats every subject
  // id once per device. Without the frame in the heading you get the same title
  // three times over three different pictures and no way to tell which is which.
  const frames = new Map((meta.frames || []).map((f) => [f.id, f]));
  const multiFrame = frames.size > 1;

  const when = meta.generatedAt ? new Date(meta.generatedAt) : null;
  const vp = meta.viewport ? `${meta.viewport.width}x${meta.viewport.height}` : null;
  await out(`\n${bold(preset.title || preset.id || path.basename(dir))}\n`);
  await out(dim([
    preset.id || path.basename(dir),
    `${captures.length} capture${captures.length === 1 ? "" : "s"}${shown.length !== captures.length ? ` (showing ${shown.length})` : ""}`,
    vp,
    when && !isNaN(when) ? when.toISOString().replace("T", " ").slice(0, 16) : null,
  ].filter(Boolean).join(" · ")) + "\n");

  const url = (side) => (meta[side] && (meta[side].final || meta[side].requested)) || null;
  if (url("before")) await out(dim(`before   ${url("before")}`) + "\n");
  if (url("after")) await out(dim(`after    ${url("after")}`) + "\n");

  if (!captures.length) await out(`\n${dim("This report has no captures.")}\n`);

  let missing = 0;
  let drewAny = false;
  for (let i = 0; i < shown.length; i++) {
    const cap = shown[i];
    const subj = subjects.get(cap.id) || {};
    await out(`\n${rule}\n`);
    const frame = frames.get(cap.frame);
    const frameTag = multiFrame
      ? ` ${dim("·")} ${cyan((frame && (frame.label || frame.device)) || cap.frame)}`
      : "";
    await out(`${dim(`[${i + 1}/${captures.length}]`)} ${bold(cap.id)}${frameTag}` +
      `${subj.label ? ` ${dim("·")} ${subj.label}` : ""}\n`);
    if (subj.focus) await out(dim(wrap(subj.focus, width - 9, "         ")) + "\n");
    await out("\n");

    let drewHere = false;
    for (const side of ["before", "after"]) {
      const file = cap[`${side}File`];
      const abs = file
        ? (file.includes("/") || file.includes("\\")
          ? path.resolve(dir, file)
          : path.join(dir, "shots", side, file))
        : null;
      const rel = abs ? path.relative(dir, abs) : "(no file)";
      const sideMeta = cap[side] || {};
      const failed = sideMeta.ok === false;

      if (abs) {
        const res = await emitSide(side, rel, abs, proto, inTmux, failed);
        if (res.drawn) { drewAny = true; drewHere = true; }
        if (res.note === "missing") missing++;
      } else {
        await out(`  ${bold(side.toUpperCase().padEnd(6))} ${dim("no screenshot recorded")}\n`);
      }
    }

    // Film strips are a whole extra sequence per side and belong in the HTML,
    // but say they exist — a viewer that silently drops half the evidence is
    // worse than one that never had it.
    const strips = Math.max(
      Array.isArray(cap.beforeStrip) ? cap.beforeStrip.length : 0,
      Array.isArray(cap.afterStrip) ? cap.afterStrip.length : 0);
    if (strips) await out(dim(`         + film strip, ${strips} frames per side — in report.html`) + "\n");

    // With images the emitter already left a blank line under the last one.
    if (!drewHere) await out("\n");
    await renderMeasurements(cap, specs, layout, "    ");
  }

  await out(`\n${rule}\n`);
  if (!specs) {
    await out(dim("No declared metrics for this preset — pictures only. (Add a `metrics` block to the preset to get a table here.)") + "\n");
  } else if (note) {
    await out(dim(wrap(note, width, "")) + "\n\n");
  }

  const cline = consoleLine(meta);
  if (cline) await out(dim(cline) + "\n");

  await out(`${cyan("report")}   ${dir}\n`);
  let htmlPath = null;
  for (const [label, name] of [["html", "report.html"], ["pdf", "before-after.pdf"]]) {
    const p = path.join(dir, name);
    try {
      await stat(p);
      if (name === "report.html") htmlPath = p;
      await out(`${cyan(label.padEnd(6))}   ${p}\n`);
    } catch (_) { /* --no-pdf, or a run that never got that far */ }
  }

  if (proto === "none") {
    await out("\n" + dim(
      opts.images === "none"
        ? "Images off (--no-images)."
        : process.stdout.isTTY
          ? "This terminal has no inline-image protocol I recognise, so the screenshots stayed on disk."
          : "Output is not a terminal, so the screenshots stayed on disk.") + "\n");
    // Only offer the contact sheet if it was actually written, and name the
    // opener this platform has — a suggestion that fails is worse than none.
    if (htmlPath) await out(dim(`Open the contact sheet:  ${OPENER} ${htmlPath}`) + "\n");
    await out(dim("Inline images work in iTerm2, WezTerm, kitty and Ghostty (BA_IMAGES=iterm|kitty to force).") + "\n");
  } else if (inTmux && !tmuxPassthroughOn()) {
    // The escapes went out; tmux is the reason they may have gone nowhere.
    await out("\n" + dim("tmux: images need passthrough — if you saw none, run: tmux set -g allow-passthrough on") + "\n");
  } else if (inTmux && drewAny) {
    await out("\n" + dim("tmux passthrough is on; if images still look wrong, they render best in an unsplit, unscrolled pane.") + "\n");
  }
  if (missing) await out(dim(`${missing} screenshot file${missing === 1 ? "" : "s"} named by metadata.json were not on disk.`) + "\n");

  return 0;
}

/* Label line first, then the picture: on a slow link you want to see WHAT is
   loading rather than a stalled blank, and if the file turns out to be missing
   the label is where that gets said. The stat is cheap; emitImage reads the
   bytes only when something is actually going to draw them. */
async function emitSide(side, rel, abs, proto, inTmux, failed) {
  let size = null;
  try { size = (await stat(abs)).size; } catch (_) { size = null; }

  const bits = [dim(rel)];
  if (size != null) bits.push(dim(human(size)));
  else bits.push(red("file missing"));
  if (failed) bits.push(red("capture reported not ok"));
  await out(`  ${bold(side.toUpperCase().padEnd(6))} ${bits.join(dim(" · "))}\n`);

  if (size == null) return { drawn: false, note: "missing" };
  return emitImage(abs, size, proto, inTmux);
}

/* ─── watch ──────────────────────────────────────────────────────────────── */

/* What "changed" means: the newest finished report under config.out, plus the
   size and mtime of its metadata.json. That covers all three things worth
   re-rendering for — a brand new run appearing, the current run's metadata
   being rewritten, and a re-run into the same directory. */
async function watchSignature(spec, outAbs, projectRoot) {
  if (spec) {
    const t = await resolveTarget(spec, outAbs, projectRoot);
    if (t.error) return "none";
    try {
      const st = await stat(path.join(t.dir, "metadata.json"));
      return `${t.dir}:${st.mtimeMs}:${st.size}`;
    } catch (_) { return "none"; }
  }
  const reports = await listReports(outAbs);
  if (!reports.length) return "none";
  const r = reports[0];
  return `${r.dir}:${r.mtime}:${r.size}`;
}

const DEBOUNCE_MS = 500;
const POLL_MS = 1500;

function startWatch(outAbs, onChange) {
  let timer = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    // A run writes screenshots, then the HTML, then metadata.json; without a
    // debounce every one of those wakes us and we re-render a half-written
    // report several times per second.
    timer = setTimeout(() => { timer = null; onChange(); }, DEBOUNCE_MS);
  };

  let watcher = null;
  try {
    // Non-recursive: recursive watching is not portable (and on Linux costs an
    // inotify watch per subdirectory of every report, which is a lot of PNGs).
    // Watching the parent catches a new report directory appearing; the poller
    // below catches everything that happens inside one.
    watcher = watch(outAbs, { persistent: true }, fire);
    watcher.on("error", () => { /* the poller is the floor */ });
  } catch (_) { watcher = null; }

  const poll = setInterval(fire, POLL_MS);
  return () => {
    if (timer) clearTimeout(timer);
    clearInterval(poll);
    if (watcher) { try { watcher.close(); } catch (_) { /* already gone */ } }
  };
}

/* ─── entry point ────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const opts = { target: null, watch: false, frames: null, images: null, help: false };
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const a = String(list[i]);
    if (a === "--watch" || a === "-w") opts.watch = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--no-images" || a === "--no-image") opts.images = "none";
    else if (a === "--frames" || a.startsWith("--frames=") || a === "-n") {
      const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : list[++i];
      if (raw == null || /^(all|0)$/i.test(String(raw))) opts.frames = null;
      else {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) opts.frames = n;
      }
    } else if (a.startsWith("-")) opts.unknown = a;
    else if (opts.target == null) opts.target = a;
  }
  return opts;
}

const USAGE =
  "ba show [dir | preset-name] [--watch] [--frames N] [--no-images]\n" +
  "\n" +
  "  (nothing)       the newest report\n" +
  "  preset-name     the newest report for that preset\n" +
  "  dir             that report directory\n" +
  "  --frames N      only the first N before/after pairs\n" +
  "  --watch         re-render when a new or changed report lands (Ctrl-C to stop)\n" +
  "  --no-images     table and paths only\n" +
  "\n" +
  "Screenshots draw inline in iTerm2, WezTerm, kitty and Ghostty. Inside tmux\n" +
  "they need `tmux set -g allow-passthrough on`. BA_IMAGES=none|iterm|kitty\n" +
  "overrides the terminal guess.\n";

export default async function show(argv = [], ctx = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { await out(USAGE); return 0; }
  if (opts.unknown) {
    await out(`Unknown option ${opts.unknown}\n\n${USAGE}`);
    return 1;
  }

  const projectRoot = ctx.projectRoot || process.cwd();
  const config = ctx.config || {};
  const outAbs = path.resolve(projectRoot, config.out || config.outDir || DEFAULT_OUT);

  const first = await resolveTarget(opts.target, outAbs, projectRoot);
  if (first.error) {
    await out(first.error + "\n");
    return 1;
  }

  const code = await renderReport(first.dir, opts, ctx);
  if (!opts.watch) return code;

  const proto = opts.images === "none" ? "none" : detectProtocol();
  const inTmux = Boolean(process.env.TMUX);
  await out("\n" + dim(`watching ${outAbs} — Ctrl-C to stop`) + "\n");

  let signature = await watchSignature(opts.target, outAbs, projectRoot);
  let rendering = false;

  return await new Promise((resolve) => {
    const stop = startWatch(outAbs, async () => {
      if (rendering) return;
      const next = await watchSignature(opts.target, outAbs, projectRoot);
      if (next === signature || next === "none") return;
      signature = next;
      rendering = true;
      try {
        const t = await resolveTarget(opts.target, outAbs, projectRoot);
        if (!t.error) {
          await clearScreen(proto, inTmux);
          await renderReport(t.dir, opts, ctx);
          await out("\n" + dim(`watching ${outAbs} — Ctrl-C to stop`) + "\n");
          // The report may still have been mid-write when we read it; re-take
          // the signature so the settling writes do not queue another render.
          signature = await watchSignature(opts.target, outAbs, projectRoot);
        }
      } finally { rendering = false; }
    });

    const quit = () => {
      stop();
      process.removeListener("SIGINT", quit);
      process.removeListener("SIGTERM", quit);
      out("\n").then(() => resolve(0));
    };
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
  });
}
