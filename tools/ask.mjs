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
/* The ceiling is 32k, not 4k, and that was learned the hard way: a reasoning
   model on this endpoint spent an entire 4000-token budget thinking and
   returned EMPTY content with a full bill. The cap exists to stop a typo
   costing real money, not to stop a model finishing its answer. */
const MAXTOK = Math.min(32000, Number(opt("--max-tokens", 900)) || 900);

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

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: HEAD,
  body: JSON.stringify({
    model: MODEL,
    max_tokens: MAXTOK,
    messages: [{ role: "user", content }],
  }),
});
const body = await res.json();
if (!res.ok || body.error) {
  process.stderr.write(`OpenRouter ${res.status}: ${JSON.stringify(body.error || body).slice(0, 500)}\n`);
  process.exit(1);
}
const choice = body.choices && body.choices[0];
const msg = (choice && choice.message) || {};
/* REASONING MODELS CAN SPEND THE WHOLE BUDGET AND SAY NOTHING. Some models on
   this endpoint put their chain of thought in `reasoning` and the answer in
   `content`; if max_tokens runs out mid-thought, `content` comes back empty
   while the usage bill is full. Printing "(empty reply)" there is a lie by
   omission — the model DID answer, it just never got to the part it shows you.
   So: print the content when there is content, fall back to the reasoning when
   there is not, and say which one you are looking at and why it was cut. */
let out = typeof msg.content === "string" ? msg.content : "";
if (!out && msg.reasoning) {
  process.stderr.write(`[no content — showing reasoning; finish_reason=${choice.finish_reason || "?"}` +
    (choice.finish_reason === "length" ? ", raise --max-tokens" : "") + "]\n");
  out = msg.reasoning;
} else if (!out) {
  out = `(empty reply; finish_reason=${choice && choice.finish_reason})`;
}
process.stdout.write(out + "\n");

// Say what it cost, every time. A tool that spends money should not make you
// go and look somewhere else to find out how much.
const u = body.usage || {};
process.stderr.write(`\n[${body.model || MODEL}] ${u.prompt_tokens || 0} in / ${u.completion_tokens || 0} out` +
  (u.cost != null ? ` · $${Number(u.cost).toFixed(5)}` : "") + "\n");
