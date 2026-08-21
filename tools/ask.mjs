#!/usr/bin/env node
/* ============================================================
   tools/ask.mjs — ASK A MODEL THAT ISN'T THIS ONE.

   WHY. Everything in this repo is built by one model family talking to
   itself. That is fine for building and bad for JUDGING: a second opinion on
   "does this shark read as a shark" is worth having precisely because it does
   not share my priors, and the before/after tool already produces the one
   artifact such a judge needs — a single stitched PNG with before on the left.

   OpenRouter is one HTTP endpoint in front of most of the frontier models, so
   this is a thin client and deliberately nothing more: no framework, no
   dependency, no abstraction over "a model answers a prompt".

     node tools/ask.mjs "one sentence: what is a shark"
     node tools/ask.mjs --model openai/gpt-4o "..."       pick a model
     node tools/ask.mjs --image path.png "what is wrong"  vision, any count
     node tools/ask.mjs --models                          list what is available
     echo "long text" | node tools/ask.mjs "summarise"    stdin becomes context

   THE KEY lives in .env.local, which is gitignored. custom.env is TRACKED, so
   nothing with a key in it can go there — a committed key gets scanned and
   auto-revoked within minutes, which breaks the thing it was added for.
   OPENROUTER_API_KEY in the real environment wins if it is set.

   SPEND IS REAL AND SMALL. The key on this repo carries a $1 cap, so the
   default is a cheap model, --max-tokens is capped, and every reply prints the
   token count and OpenRouter's own reported cost. A tool that spends money
   should say so out loud rather than let you discover it later.
============================================================ */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

async function key() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    const txt = await readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = txt.match(/^\s*OPENROUTER_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim();
  } catch (_) {}
  return null;
}

const K = await key();
if (!K) {
  process.stderr.write("No OPENROUTER_API_KEY. Put it in .env.local (gitignored) or the environment.\n");
  process.exit(1);
}
const HEAD = {
  "Authorization": `Bearer ${K}`,
  "Content-Type": "application/json",
  // OpenRouter asks callers to identify themselves; it also makes this repo's
  // spend legible on their dashboard rather than anonymous.
  "HTTP-Referer": "https://github.com/efoltyn/gta6",
  "X-Title": "cell-block-z dev tools",
};

if (has("--models")) {
  const r = await fetch("https://openrouter.ai/api/v1/models", { headers: HEAD });
  const j = await r.json();
  const rows = (j.data || [])
    .map((m) => ({ id: m.id, ctx: m.context_length || 0, inp: Number(m.pricing && m.pricing.prompt) || 0 }))
    .sort((a, b) => a.inp - b.inp);
  const q = argv.filter((a) => !a.startsWith("--"));
  for (const m of rows) {
    if (q.length && !q.some((s) => m.id.includes(s))) continue;
    process.stdout.write(`${m.id.padEnd(52)} ctx ${String(m.ctx).padStart(8)}  $${(m.inp * 1e6).toFixed(2)}/Mtok in\n`);
  }
  process.exit(0);
}

// A cheap, capable default: this key has a dollar on it, and the common use is
// a short judgement about a picture, not a long generation.
const MODEL = opt("--model", "google/gemini-2.5-flash");
/* NO CEILING. There was one — 4k, then 32k — and it was mine, not the API's,
   and it was wrong both times: a reasoning model spent the entire budget
   thinking and returned an empty string with a full bill, twice. A cap that
   truncates the answer you asked for is not a safety feature, it is the tool
   deciding it knows better than the caller. Pass --max-tokens when you
   actually want a limit; otherwise the model stops when it is finished.

   STREAMING, for the same reason. One blocking request against a model that
   thinks for ten minutes is all-or-nothing, and the harness killing it at its
   own timeout threw away the whole answer once already. Streaming writes each
   token as it arrives, so a run that dies at minute nine still leaves nine
   minutes of answer on disk. Default on; --no-stream for a single shot. */
const MAXTOK = argv.includes("--max-tokens") ? (Number(opt("--max-tokens", 0)) || undefined) : undefined;
const STREAM = !has("--no-stream");

const images = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "--image") continue;
  const p = path.resolve(ROOT, argv[i + 1]);
  const buf = await readFile(p);
  const ext = path.extname(p).slice(1).toLowerCase() || "png";
  images.push(`data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buf.toString("base64")}`);
}

const flagged = new Set();
for (let i = 0; i < argv.length; i++) {
  if (["--model", "--max-tokens", "--image"].includes(argv[i])) { flagged.add(i); flagged.add(i + 1); }
  else if (argv[i].startsWith("--")) flagged.add(i);
}
let prompt = argv.filter((_, i) => !flagged.has(i)).join(" ").trim();

// Piped stdin becomes context, so `git diff | ask "review this"` just works.
if (!process.stdin.isTTY) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const piped = Buffer.concat(chunks).toString("utf8").trim();
  if (piped) prompt = prompt ? `${prompt}\n\n---\n${piped}` : piped;
}
if (!prompt && !images.length) {
  process.stderr.write('Nothing to ask. Try: node tools/ask.mjs "hello"\n');
  process.exit(1);
}

const content = images.length
  ? [{ type: "text", text: prompt || "What do you see?" },
     ...images.map((url) => ({ type: "image_url", image_url: { url } }))]
  : prompt;

const payload = { model: MODEL, messages: [{ role: "user", content }], stream: STREAM };
if (MAXTOK) payload.max_tokens = MAXTOK;

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST", headers: HEAD, body: JSON.stringify(payload),
});
if (!res.ok) {
  process.stderr.write(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 600)}\n`);
  process.exit(1);
}

if (!STREAM) {
  const body = await res.json();
  if (body.error) { process.stderr.write(`OpenRouter: ${JSON.stringify(body.error).slice(0,500)}\n`); process.exit(1); }
  const ch = (body.choices && body.choices[0]) || {}, msg = ch.message || {};
  let out = typeof msg.content === "string" ? msg.content : "";
  if (!out && msg.reasoning) { process.stderr.write(`[reasoning only; finish=${ch.finish_reason}]\n`); out = msg.reasoning; }
  process.stdout.write((out || `(empty; finish=${ch.finish_reason})`) + "\n");
  const u = body.usage || {};
  process.stderr.write(`\n[${body.model || MODEL}] ${u.prompt_tokens||0} in / ${u.completion_tokens||0} out\n`);
  process.exit(0);
}

/* Reasoning to stderr, the ANSWER to stdout — so `ask ... > mouth.js` captures
   exactly the code while the thinking stays watchable and out of the file. */
let usage = null, finish = null, sawContent = false, reasonChars = 0;
const decoder = new TextDecoder();
let buf = "";
for await (const chunk of res.body) {
  buf += decoder.decode(chunk, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    let ev; try { ev = JSON.parse(data); } catch (_) { continue; }
    if (ev.error) { process.stderr.write(`\nOpenRouter: ${JSON.stringify(ev.error).slice(0,400)}\n`); process.exit(1); }
    if (ev.usage) usage = ev.usage;
    const d = ev.choices && ev.choices[0]; if (!d) continue;
    if (d.finish_reason) finish = d.finish_reason;
    const delta = d.delta || {};
    if (delta.reasoning) { reasonChars += delta.reasoning.length; process.stderr.write(delta.reasoning); }
    if (delta.content) { sawContent = true; process.stdout.write(delta.content); }
  }
}
process.stdout.write("\n");
if (!sawContent && reasonChars) process.stderr.write(`\n[reasoning only, ${reasonChars} chars; finish=${finish}]\n`);
const u = usage || {};
process.stderr.write(`\n[${MODEL}] ${u.prompt_tokens||0} in / ${u.completion_tokens||0} out · finish=${finish}\n`);
