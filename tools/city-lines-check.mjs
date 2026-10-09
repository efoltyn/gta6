#!/usr/bin/env node
/* tools/city-lines-check.mjs — WHAT GANG CITY SAYS, READ BY A MACHINE.

   Plain node, no browser. Scans every Gang City source file for the two kinds
   of words a player reads:

     SPEECH  every line a person says over their head: string literals passed
             to a mouth (CBZ.citySay, citySayBark, CBZ.speech.say, bark, ...),
             the pools those calls pick from (named arrays / tables), and the
             line tables in city/read.js (CBZ.cityLine) and city/lines.js.
     LABELS  every verb a person or thing offers: `label:` on an option record
             handed to the interaction registry (register / registerFor /
             registerZone / zone options), and the verb words the renderer
             prints (CBZ.cityVerbWord).

   Banned (owner doctrine: gta6-no-slop-text, gta6-signage-reality,
   gta6-prompt-on-the-thing-wave):
     - em dash, en dash, middle dot, bullet, emoji, anywhere
     - a spoken line over 70 characters
     - UI words in speech: press, click, tap, button, menu, select, hold X
     - a label that carries a noun ("Talk to the clerk", "Rob store"): labels
       are a verb, a phrasal verb, or verb + a price.

   Usage: node tools/city-lines-check.mjs [--dump] [--speech] [--labels]
   Exit 1 on any violation. --dump prints every string it found.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const DUMP = argv.includes("--dump");
const ONLY_SPEECH = argv.includes("--speech");
const ONLY_LABELS = argv.includes("--labels");
const FILE_FILTER = (() => { const i = argv.indexOf("--file"); return i >= 0 ? argv[i + 1] : null; })();

// ---- which files are Gang City ---------------------------------------------
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith(".js")) out.push(p);
  }
  return out;
}
const cityFiles = walk(path.join(ROOT, "src/city"), []);
// systems files that speak IN the city (they call the city mouth)
const sysFiles = walk(path.join(ROOT, "src/systems"), []).filter((p) => {
  const s = fs.readFileSync(p, "utf8");
  return /CBZ\.citySay|CBZ\.cityLine/.test(s);
});
// KEY-BINDING / PRESIDENT-HIRING files belong to the input agent (branch
// e-key-interactions); their labels are theirs to word. Speech in them is
// still scanned.
const LABEL_EXEMPT = /(^|\/)(presidency|president_[a-z_]+|protection|origins)\.js$/;
const FILES = cityFiles.concat(sysFiles);

// ---- a small JS tokenizer ----------------------------------------------------
// Good enough for this repo's ES2019 IIFEs: strings, templates (with ${}),
// comments, regex literals (by the previous-token rule), identifiers, numbers,
// punctuation. Every token carries its line.
const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^",
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "=>", "&&", "||", "??", "==", "===", "!=", "!==", "+=", "-=", "<=", ">="]);
function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const push = (type, value, l) => toks.push({ type, value, line: l });
  const prevSig = () => { for (let k = toks.length - 1; k >= 0; k--) return toks[k]; return null; };
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2; continue;
    }
    if (c === "\"" || c === "'") {
      const l0 = line; let s = ""; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") {
          const e = src[i + 1];
          if (e === "n") s += "\n"; else if (e === "u") { s += String.fromCharCode(parseInt(src.substr(i + 2, 4), 16)); i += 4; }
          else s += e;
          i += 2; continue;
        }
        if (src[i] === "\n") line++;
        s += src[i++];
      }
      i++;
      push("str", s, l0); continue;
    }
    if (c === "`") {
      // template: the literal parts joined with a placeholder; nested ${} is
      // tokenized recursively so strings inside it are still seen.
      const l0 = line; let s = ""; i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1, j = i + 2;
          while (j < n && depth) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            else if (src[j] === "\"" || src[j] === "'") { const q = src[j]; j++; while (j < n && src[j] !== q) { if (src[j] === "\\") j++; j++; } }
            if (depth) j++;
          }
          s += "{x}";
          i = j + 1; continue;
        }
        if (src[i] === "\n") line++;
        s += src[i++];
      }
      i++;
      push("tpl", s, l0); continue;
    }
    if (c === "/") {
      const p = prevSig();
      const isRe = !p || (p.type === "punc" && REGEX_PREV.has(p.value)) || (p.type === "id" && REGEX_PREV.has(p.value));
      if (isRe) {
        i++; let inCls = false;
        while (i < n) {
          const d = src[i];
          if (d === "\\") { i += 2; continue; }
          if (d === "[") inCls = true; else if (d === "]") inCls = false;
          else if (d === "/" && !inCls) break;
          else if (d === "\n") break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        push("re", "", line); continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      push("id", src.slice(i, j), line); i = j; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < n && /[\w.]/.test(src[j])) j++;
      push("num", src.slice(i, j), line); i = j; continue;
    }
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (["===", "!==", "...", "&&=", "||=", "??="].includes(three)) { push("punc", three, line); i += 3; continue; }
    if (["=>", "&&", "||", "??", "==", "!=", "+=", "-=", "<=", ">=", "++", "--", "?.", "*=", "/="].includes(two)) { push("punc", two, line); i += 2; continue; }
    push("punc", c, line); i++;
  }
  return toks;
}

// ---- classification ------------------------------------------------------------
// A MOUTH: a call whose callee's last name is one of these; its SECOND
// argument onward is words (the first is the speaker).
const MOUTHS = new Set(["citySay", "citySayBark", "sayBark", "bark", "sayLine", "cityBark", "speakLine", "sayP", "say", "prisonSay"]);
// `X.say(` counts when X is speech / S / CBZ.speech
const SAY_OWNERS = new Set(["speech", "S", "SP"]);
// named pools: a declaration whose name looks like a line pool
const POOL_NAME = /^(?:[A-Z][A-Z0-9_]*)$/;
const POOL_HINT = /(LINES?|BARKS?|TALK|GREET|CONTACT|TRADE|WARN|EASE|SAYS?|QUIPS?|TAUNTS?|THREATS?|PLEAS?|REPL(Y|IES)|RETORTS?|CHATTER|SHOUTS?|CALLS|MUTTER|CURSES?|THANKS|ASKS?|ANSWERS?|OPENERS?|PITCH(ES)?)/;
// colour / id / key strings are never words
const NOT_WORDS = (s) => !s || /^#[0-9a-f]{3,8}$/i.test(s) || /^[a-z0-9_:.\-]+$/.test(s) && !/\s/.test(s) && s.length < 3;

function findCallArgs(toks, openIdx) {
  // openIdx is the "(" token; returns [start, end) ranges per argument
  const args = []; let depth = 0, start = openIdx + 1;
  for (let k = openIdx; k < toks.length; k++) {
    const t = toks[k];
    if (t.type !== "punc") continue;
    if (t.value === "(" || t.value === "[" || t.value === "{") { depth++; continue; }
    if (t.value === ")" || t.value === "]" || t.value === "}") {
      depth--;
      if (depth === 0) { args.push([start, k]); return { args, close: k }; }
      continue;
    }
    if (t.value === "," && depth === 1) { args.push([start, k]); start = k + 1; }
  }
  return { args, close: toks.length };
}
// strings inside [a,b) that are VALUES (an object key "x": is skipped)
function valueStrings(toks, a, b) {
  const out = [];
  for (let k = a; k < b; k++) {
    const t = toks[k];
    if (t.type !== "str" && t.type !== "tpl") continue;
    const nx = toks[k + 1];
    if (nx && nx.type === "punc" && nx.value === ":") {
      // key, unless it's the else-branch of a ternary (a ? "x" : "y")
      let q = 0, isTern = false;
      for (let j = k - 1; j >= a && j > k - 12; j--) { const pj = toks[j]; if (pj.type === "punc" && pj.value === "?") { isTern = true; break; } if (pj.type === "punc" && (pj.value === "," || pj.value === "{" || pj.value === ";")) break; }
      if (!isTern) continue;
    }
    // a string that is an argument to a lookup (t.includes("x"), rel("snub"))
    const pv = toks[k - 1], pv2 = toks[k - 2];
    if (pv && pv.type === "punc" && pv.value === "(" && pv2 && pv2.type === "id" && /^(includes|indexOf|test|startsWith|endsWith|getElementById|querySelector|cityRelShift|addEventListener|has|get|split|join|replace|match|classList|setAttribute|toggle|add|remove|cityScare|hasItem|role)$/.test(pv2.value)) continue;
    if (pv && pv.type === "punc" && (pv.value === "===" || pv.value === "!==" || pv.value === "==" || pv.value === "!=" || pv.value === "in")) continue;
    const nx1 = toks[k + 1];
    if (nx1 && nx1.type === "punc" && (nx1.value === "===" || nx1.value === "!==" || nx1.value === "==" || nx1.value === "!=")) continue;
    if (nx1 && nx1.type === "id" && nx1.value === "in") continue;
    if (NOT_WORDS(t.value)) continue;
    out.push(t);
  }
  return out;
}
// is the `label` key at k inside an object literal that also has onSelect?
function isOptionRecord(toks, k) {
  let depth = 0, open = -1;
  for (let j = k - 1; j >= 0; j--) {
    const u = toks[j];
    if (u.type !== "punc") continue;
    if (u.value === "}" || u.value === ")" || u.value === "]") depth++;
    else if (u.value === "{" || u.value === "(" || u.value === "[") { if (!depth) { open = j; break; } depth--; }
  }
  if (open < 0 || toks[open].value !== "{") return false;
  depth = 0;
  for (let j = open + 1; j < toks.length; j++) {
    const u = toks[j];
    if (u.type === "punc") {
      if (u.value === "{" || u.value === "(" || u.value === "[") depth++;
      else if (u.value === "}" || u.value === ")" || u.value === "]") { if (!depth) return false; depth--; }
    } else if (!depth && u.type === "id" && (u.value === "onSelect" || u.value === "run") && toks[j + 1] && (toks[j + 1].value === ":" || toks[j + 1].value === "(")) return true;
  }
  return false;
}
function idsIn(toks, a, b) {
  const out = new Set();
  for (let k = a; k < b; k++) if (toks[k].type === "id" && POOL_NAME.test(toks[k].value)) out.add(toks[k].value);
  return out;
}
// find `NAME = <literal>` and return the literal range
function declRange(toks, name) {
  const ranges = [];
  for (let k = 0; k < toks.length - 2; k++) {
    if (toks[k].type === "id" && toks[k].value === name && toks[k + 1].type === "punc" && toks[k + 1].value === "=" &&
        toks[k + 2].type === "punc" && (toks[k + 2].value === "[" || toks[k + 2].value === "{")) {
      let depth = 0;
      for (let j = k + 2; j < toks.length; j++) {
        const t = toks[j];
        if (t.type !== "punc") continue;
        if (t.value === "[" || t.value === "{" || t.value === "(") depth++;
        else if (t.value === "]" || t.value === "}" || t.value === ")") { depth--; if (!depth) { ranges.push([k + 2, j + 1]); break; } }
      }
    }
  }
  return ranges;
}

const speech = [];   // {file, line, s}
const labels = [];   // {file, line, s}
const seen = new Set();
function addSpeech(file, t) { const key = file + ":" + t.line + ":" + t.value; if (seen.has(key)) return; seen.add(key); speech.push({ file, line: t.line, s: t.value }); }
function addLabel(file, t) { const key = "L" + file + ":" + t.line + ":" + t.value; if (seen.has(key)) return; seen.add(key); labels.push({ file, line: t.line, s: t.value }); }

// the files whose WHOLE purpose is line tables
const LINE_TABLE_FILES = new Set(["src/city/read.js", "src/city/dialogue.js"]);

for (const abs of FILES) {
  const rel = path.relative(ROOT, abs);
  const src = fs.readFileSync(abs, "utf8");
  const toks = tokenize(src);
  const poolNames = new Set();
  const registers = /\b(register|registerFor|registerZone)\s*\(/.test(src) && !LABEL_EXEMPT.test(rel);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // ---- mouths
    if (t.type === "id" && toks[k + 1] && toks[k + 1].value === "(") {
      let mouth = MOUTHS.has(t.value);
      if (mouth && t.value === "say") {
        // a bare say(...) is a file's local mouth helper; X.say(...) only counts
        // for the speech owners
        const dot = toks[k - 1], own = toks[k - 2];
        if (dot && dot.value === ".") mouth = !!(own && SAY_OWNERS.has(own.value));
      }
      if (!mouth && t.value === "say") {
        const dot = toks[k - 1], own = toks[k - 2];
        mouth = !!(dot && dot.value === "." && own && SAY_OWNERS.has(own.value));
      }
      if (!mouth && t.value === "phone") {
        const dot = toks[k - 1], own = toks[k - 2];
        mouth = !!(dot && dot.value === "." && own && own.value === "speech");
      }
      if (mouth) {
        // skip the definition `function citySayBark(ped, txt)`
        const pv = toks[k - 1];
        if (pv && pv.type === "id" && pv.value === "function") continue;
        const { args } = findCallArgs(toks, k + 1);
        for (let ai = 1; ai < Math.min(args.length, 2); ai++) {
          const [a, b] = args[ai];
          for (const s of valueStrings(toks, a, b)) addSpeech(rel, s);
          for (const id of idsIn(toks, a, b)) poolNames.add(id);
        }
      }
    }
    // ---- labels on option records (an object that also carries onSelect;
    // a zone's own `label` is its name plate, not a button)
    if (registers && t.type === "id" && (t.value === "label") && toks[k + 1] && toks[k + 1].value === ":" && isOptionRecord(toks, k)) {
      // read the expression to the next comma / closing brace at depth 0
      let depth = 0, j = k + 2;
      for (; j < toks.length; j++) {
        const u = toks[j];
        if (u.type === "punc") {
          if (u.value === "(" || u.value === "[" || u.value === "{") depth++;
          else if (u.value === ")" || u.value === "]" || u.value === "}") { if (!depth) break; depth--; }
          else if (u.value === "," && !depth) break;
        }
      }
      for (const s of valueStrings(toks, k + 2, j)) addLabel(rel, s);
    }
  }
  // named pools referenced by a mouth, plus hinted pool names, plus the
  // table files' every value string
  for (let k = 0; k < toks.length - 2; k++) {
    const t = toks[k];
    if (t.type === "id" && POOL_NAME.test(t.value) && POOL_HINT.test(t.value) && toks[k + 1].value === "=" && (toks[k + 2].value === "[" || toks[k + 2].value === "{")) poolNames.add(t.value);
  }
  for (const name of poolNames) for (const [a, b] of declRange(toks, name)) for (const s of valueStrings(toks, a, b)) if (/\s|[.!?]$|^[A-Z]/.test(s.value)) addSpeech(rel, s);
  if (LINE_TABLE_FILES.has(rel)) {
    for (let k = 0; k < toks.length; k++) if (toks[k].type === "str") {
      const nx = toks[k + 1];
      if (nx && nx.value === ":") continue;
      // only strings that live inside array literals
      let depth = 0, inArr = false;
      for (let j = k - 1; j >= 0 && j > k - 400; j--) {
        const u = toks[j];
        if (u.type !== "punc") continue;
        if (u.value === "]" || u.value === ")" || u.value === "}") depth++;
        else if (u.value === "[" || u.value === "(" || u.value === "{") { if (!depth) { inArr = u.value === "["; break; } depth--; }
      }
      if (inArr && /\s|[.!?]$/.test(toks[k].value)) addSpeech(rel, toks[k]);
    }
  }
}

// ---- the rules ------------------------------------------------------------------
const EMOJI = /\p{Extended_Pictographic}/u;
const DASHES = /[—–·•]/;
const UI_WORDS = /\b(press|click|tap|button|menu|select|hold (?:[a-z]|shift|e))\b/i;
// speech.js (CHARS = 56) keeps whole sentences that fit 56 characters and
// drops the rest, so a longer line is a line the player never reads whole.
const MAX_LINE = 56;
// verb words a label may be built from (the verb, its particle, a price)
const PARTICLES = new Set(["up", "in", "out", "off", "on", "down", "away", "over", "back", "along", "around", "through", "to", "with", "for", "at", "by", "it", "one"]);
const DETERMINERS = /\b(the|a|an|his|her|their|your|my|this|that|these|those|some)\b/i;

const bad = [];
function flag(kind, r, why) { bad.push({ kind, ...r, why }); }

for (const r of speech) {
  const s = r.s.replace(/\{x\}/g, "X");
  if (DASHES.test(s)) flag("speech", r, "dash or dot");
  if (EMOJI.test(s)) flag("speech", r, "emoji");
  if (s.length > MAX_LINE) flag("speech", r, "over " + MAX_LINE + " chars");
  if (UI_WORDS.test(s)) flag("speech", r, "UI word");
  if (/^[“"‘…]|[”"’…]$/.test(s.trim()) && s.trim().length > 1) flag("speech", r, "quotes or trailing dots (narration shape)");
}
function labelVerdict(s) {
  const clean = s.replace(/\{x\}/g, "").replace(/\s*\$[\d,.]*[kKmM]?\s*/g, " ").replace(/\s+\d[\d,.]*\s*$/, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (DASHES.test(s)) return "dash or dot";
  if (EMOJI.test(s)) return "emoji";
  if (UI_WORDS.test(clean)) return "UI word";
  if (DETERMINERS.test(clean)) return "carries a noun (determiner)";
  const w = clean.split(/\s+/);
  if (w.length > 3) return "more than a verb (" + w.length + " words)";
  if (w.length >= 2) {
    // verb + particle(s) is a verb; verb + noun is a noun on the button
    const tail = w.slice(1);
    if (!tail.every((x) => PARTICLES.has(x.toLowerCase()) || /^(follow|wait|go|run|home|here|guard|me|quiet|loose|free|down|still|cover|open|shut|rob|scare|tail|guard|hide)$/i.test(x))) return "carries a noun";
  }
  return null;
}
// THE RENDERER'S OWN RULE: a whole, static label must come out of
// city/verbword.js unchanged (what is authored is what is printed). Fragments
// of a concatenation ("Rob $" + n) are judged by the verdict above only.
const require = createRequire(import.meta.url);
const verbWord = require(path.join(ROOT, "src/city/verbword.js"));
for (const r of labels) {
  if (verbWord.WHOLE.includes(r.s.trim())) continue;   // a verb that needs its object, printed as authored
  const why = labelVerdict(r.s);
  if (why) { flag("label", r, why); continue; }
  const whole = r.s.trim();
  if (!whole || /\{x\}|\$$|^\s|\s$/.test(r.s) || /^[a-z]/.test(whole)) continue;
  const out = verbWord(whole);
  if (out !== whole) flag("label", r, "renders as " + JSON.stringify(out));
}

// ---- THE BOOK, RUN: load city/read.js in a bare sandbox and ask it for lines
// the way the game does. Proves: every topic answers, a person asked twice
// does not parrot himself, and what you did to him changes what he says.
import vm from "node:vm";
let BOOK_TOPICS = 0;
{
  const CBZ = { game: { mode: "city", wanted: 0 }, now: 1000, CONFIG: {} };
  let hour = 12, armed = false;
  CBZ.cityHour = () => hour;
  CBZ.cityHasGun = () => armed;
  CBZ.hash01 = (x, z, s) => { const h = Math.sin(x * 12.9898 + z * 78.233 + s * 0.013) * 43758.5453; return h - Math.floor(h); };
  const ctx = vm.createContext({ window: { CBZ }, Math, Date, String, Object, Array, JSON });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/city/read.js"), "utf8"), ctx, { filename: "read.js" });
  const book = CBZ.cityLineBook;
  const fails = [];
  if (!book || !CBZ.cityLine) fails.push("read.js did not export cityLine / cityLineBook");
  else {
    const ped = (x) => ({ pos: { x: x, z: x * 3 }, name: "P" + x });
    for (const topic of Object.keys(book)) {
      const p = ped(7 + topic.length);
      const a = CBZ.cityLine(p, topic, { vars: { place: "City Hospital", dir: "north", item: "hotdog" } });
      if (!a) { fails.push("topic " + topic + " answered nothing"); continue; }
      if (/\{\w+\}/.test(a)) fails.push("topic " + topic + " left a placeholder: " + a);
      const all = [];
      (function walk(v) { if (Array.isArray(v)) all.push(...v); else if (v && typeof v === "object") for (const k in v) walk(v[k]); })(book[topic]);
      for (const line of all) {
        const r = { file: "src/city/read.js", line: 0, s: line };
        if (line.replace(/\{\w+\}/g, "Xxxxxxxx").length > MAX_LINE) fails.push("book " + topic + " over " + MAX_LINE + ": " + line);
        if (DASHES.test(line) || EMOJI.test(line) || UI_WORDS.test(line)) fails.push("book " + topic + " banned text: " + line);
      }
      const b = CBZ.cityLine(p, topic, {});
      if (b && a === b && (book[topic].base || []).length > 1) fails.push("topic " + topic + " repeated itself: " + a);
    }
    // a person you robbed says so
    const v = ped(3);
    v._wronged = { kind: "robbed", t: CBZ.now };
    const rob = CBZ.cityLine(v, "talk");
    if (!book.talk.robbed.includes(rob)) fails.push("robbed man did not mention it: " + rob);
    // your gun changes the sentence
    armed = true;
    const gun = CBZ.cityLine(ped(4), "talk");
    if (!book.talk.armed.includes(gun)) fails.push("gun out, but: " + gun);
    armed = false;
    // five strangers in one scene do not say the same "Hey."
    const seen = new Set();
    for (let i = 0; i < 5; i++) seen.add(CBZ.cityLine(ped(40 + i), "talk"));
    if (seen.size < 5) fails.push("five strangers shared lines: " + [...seen].join(" / "));
  }
  for (const f of fails) console.log("FAIL book " + f);
  BOOK_TOPICS = book ? Object.keys(book).length : 0;
  bad.push(...fails.map((f) => ({ kind: "speech", file: "src/city/read.js", line: 0, s: f, why: "book" })));
}

if (DUMP) {
  if (!ONLY_LABELS) for (const r of speech) console.log("S " + r.file + ":" + r.line + "  " + JSON.stringify(r.s));
  if (!ONLY_SPEECH) for (const r of labels) console.log("L " + r.file + ":" + r.line + "  " + JSON.stringify(r.s));
}
const shown = bad.filter((b) => (!ONLY_SPEECH || b.kind === "speech") && (!ONLY_LABELS || b.kind === "label") && (!FILE_FILTER || b.file.indexOf(FILE_FILTER) >= 0));
for (const b of shown) console.log("FAIL " + b.kind + " " + b.file + ":" + b.line + "  " + b.why + "  " + JSON.stringify(b.s));
console.log(`city-lines-check: ${speech.length} spoken lines, ${labels.length} labels, ${BOOK_TOPICS} book topics run, ${FILES.length} files, ${shown.length} violations`);
process.exit(shown.length ? 1 : 0);
