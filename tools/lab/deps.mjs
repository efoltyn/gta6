#!/usr/bin/env node
/* tools/lab/deps.mjs — THE DEPENDENCY TRACER for the lab.

   index.html loads ~729 classic scripts that talk only through CBZ.* globals,
   so nothing in src/ says what it needs. This file reads every script and
   writes down, per file:
     DEFINES   CBZ.x = ...  /  CBZ.x ||= ...  /  CBZ.x = CBZ.x || {}  /
               Object.assign(CBZ, {x})  /  window.CBZ.x = ...   (a definition
               behind `if (!CBZ.x)` or `CBZ.x || ...` is a SOFT def: a fallback)
     MEMBERS   what it hangs on a namespace: CBZ.verbs.grab = / V.grab = (V an
               alias of CBZ.verbs) / Object.assign(CBZ.moves, {sit}) /
               CBZ.x = { a, b: ... }
     READS     CBZ.x and CBZ.x.member, through aliases too (const V = CBZ.verbs).
               A symbol the file FEATURE-DETECTS anywhere (`if (CBZ.x)`,
               `CBZ.x && ...`, `typeof CBZ.x`, `!CBZ.x`, `CBZ.x?.`, `CBZ.x ||`,
               or an alias tested the same way) is an OPTIONAL edge and is not
               followed: the file runs without it.
     LOAD      the subset of reads made at LOAD time (outside every function,
               or inside an IIFE): those throw if missing, so they are always
               followed, whatever --depth says.
   and keeps index.html's order. src/lab/closure.js turns that graph into the
   minimal ordered script list for a set of entry files or CBZ symbols.

   CACHE. The manifest is src/lab/deps.json (committed, so the lab page and a
   cloud box need no build step). Rebuilds are incremental: a file whose
   size+mtime are unchanged keeps its record; one whose bytes changed is
   re-scanned (a sha1 decides, so a touch costs nothing). `node deps.mjs`
   with no args refreshes it in ~1-3 s cold, ~0.2 s warm.

   USAGE
     node tools/lab/deps.mjs                         refresh src/lab/deps.json
     node tools/lab/deps.mjs --kits                  script count per kit
     node tools/lab/deps.mjs --sym furnish,brain     closure for symbols
     node tools/lab/deps.mjs --file src/systems/brain.js --depth 1
     node tools/lab/deps.mjs --kit person-chair      closure for a lab kit
     node tools/lab/deps.mjs --who furnish           who defines / reads CBZ.furnish
     node tools/lab/deps.mjs --why src/city/peds.js --kit person-chair
     --json prints the result as JSON; --check exits 1 if deps.json was stale.

   OVERRIDES (what static analysis misses) live in OVERRIDES below, one line
   each with the reason. Keep it short: a long list means the scanner should
   learn the pattern instead. */
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const MANIFEST = path.join(ROOT, "src/lab/deps.json");
const closure = require(path.join(ROOT, "src/lab/closure.js"));
const SCANNER_VERSION = 8;

/* ---- HAND OVERRIDES ------------------------------------------------------
   needs: files that must come with this file although no CBZ symbol says so
   drop:  symbols this file reads that must NOT be followed (they drag a world
          in and the file guards them in ways the scanner cannot see)
   Every entry carries its reason. */
export const OVERRIDES = {
};

/* ---- index.html order ---------------------------------------------------- */
export function indexOrder() {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = [];
  const re = /<script[^>]*\bsrc\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const f = m[1].split("?")[0];
    if (f.startsWith("src/") && f.endsWith(".js") && !out.includes(f)) out.push(f);
  }
  return out;
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // src/vendor/*.js are indexed (an ingredient may name BufferGeometryUtils.js),
    // their subfolders (draco, sqlite-wasm) and the workers are not page scripts
    if (e.isDirectory()) { if (e.name !== "workers" && !(path.basename(dir) === "vendor")) walk(p, out); }
    else if (e.name.endsWith(".js")) out.push(path.relative(ROOT, p));
  }
  return out;
}

/* ==========================================================================
   THE SCANNER. A tokenizer that knows comments, strings, template literals
   (with nested ${}) and regex literals, tracks brace kinds so it knows which
   tokens sit inside a function, and marks the functions that are IIFEs (a
   body `})` followed by `(` / `.call(`): code in those runs at load.
   ========================================================================== */
const KW_BLOCK = new Set(["if", "for", "while", "switch", "catch", "with"]);
const REGEX_AFTER = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^", "&&", "||", "??", "=>", "==", "===", "!=", "!==", "+=", "-=", "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
const PUNCT3 = ["===", "!==", "...", "**=", "<<=", ">>=", "&&=", "||=", "??=", ">>>"];
const PUNCT2 = ["=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "++", "--", "<<", ">>", "**"];

export function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const tmplStack = [];          // brace depth at which a ${ opened
  let braceDepth = 0;
  function prevSig() { return toks.length ? toks[toks.length - 1] : null; }
  function regexOK() {
    const p = prevSig();
    if (!p) return true;
    if (p.t === "id") return REGEX_AFTER.has(p.v);
    if (p.t === "p") return REGEX_AFTER.has(p.v) || (p.v !== ")" && p.v !== "]" && p.v !== "}");
    return false;
  }
  function readTemplate() {      // at a ` or after a }, read the template chunk
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { i++; toks.push({ t: "s", v: "" }); return; }
      if (c === "$" && src[i + 1] === "{") { i += 2; tmplStack.push(braceDepth); braceDepth++; toks.push({ t: "p", v: "(" }); return; }
      i++;
    }
  }
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      const q = c; i++;
      let s = "";
      while (i < n && src[i] !== q) { if (src[i] === "\\") { s += src[i + 1]; i += 2; continue; } if (src[i] === "\n") break; s += src[i++]; }
      i++;
      toks.push({ t: "s", v: s });
      continue;
    }
    if (c === "`") { i++; readTemplate(); continue; }
    if (c === "/" && regexOK()) {
      i++;
      let cls = false;
      while (i < n) {
        const d = src[i];
        if (d === "\\") { i += 2; continue; }
        if (d === "\n") break;
        if (cls) { if (d === "]") cls = false; }
        else if (d === "[") cls = true;
        else if (d === "/") { i++; break; }
        i++;
      }
      while (i < n && /[a-z]/i.test(src[i])) i++;
      toks.push({ t: "r", v: "" });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      toks.push({ t: "n", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "{") { braceDepth++; toks.push({ t: "p", v: "{" }); i++; continue; }
    if (c === "}") {
      if (tmplStack.length && tmplStack[tmplStack.length - 1] === braceDepth - 1) {
        tmplStack.pop(); braceDepth--; toks.push({ t: "p", v: ")" }); i++; readTemplate(); continue;
      }
      braceDepth--; toks.push({ t: "p", v: "}" }); i++; continue;
    }
    const s3 = src.substr(i, 3), s4 = src.substr(i, 4);
    if (s4 === ">>>=") { toks.push({ t: "p", v: s4 }); i += 4; continue; }
    if (PUNCT3.includes(s3)) { toks.push({ t: "p", v: s3 }); i += 3; continue; }
    const s2 = src.substr(i, 2);
    if (PUNCT2.includes(s2) && !(s2 === "?." && /[0-9]/.test(src[i + 2] || ""))) { toks.push({ t: "p", v: s2 }); i += 2; continue; }
    toks.push({ t: "p", v: c });
    i++;
  }
  return toks;
}

/* Mark every token with whether it runs at LOAD (fnDepth counting only
   non-IIFE functions == 0). */
function markLoad(toks) {
  const stack = [];              // { kind: "fn"|"blk", open: tokIndex }
  const parenStack = [];         // index of "(" tokens
  const parenOwner = new Map();  // ")" index -> "(" index
  const fnRanges = [];           // [openIdx, closeIdx]
  const fnStack = [-1], parents = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    t.fn = fnStack[fnStack.length - 1];
    if (t.t !== "p") continue;
    if (t.v === "(" ) parenStack.push(k);
    else if (t.v === ")") { const o = parenStack.pop(); if (o != null) parenOwner.set(k, o); }
    else if (t.v === "{") {
      const p = toks[k - 1];
      let kind = "blk";
      if (p && p.t === "p" && p.v === "=>") kind = "fn";
      else if (p && p.t === "p" && p.v === ")") {
        const o = parenOwner.get(k - 1);
        const before = o != null ? toks[o - 1] : null;
        if (!(before && before.t === "id" && KW_BLOCK.has(before.v))) kind = "fn";
      }
      stack.push({ kind, open: k });
      if (kind === "fn") { parents.push(fnStack[fnStack.length - 1]); fnStack.push(parents.length - 1); }
    } else if (t.v === "}") {
      const s = stack.pop();
      if (s && s.kind === "fn") { fnRanges.push([s.open, k]); fnStack.pop(); }
    }
  }
  // IIFE: the body is followed by `)(`, `)()`, `(`, `).call(` or `)` `.apply`
  const depthDelta = new Int32Array(toks.length + 1);
  for (const [a, b] of fnRanges) {
    const n1 = toks[b + 1], n2 = toks[b + 2];
    let iife = false;
    if (n1 && n1.v === "(") iife = true;
    else if (n1 && n1.v === ")" && n2 && (n2.v === "(" || (n2.v === "." && toks[b + 3] && /^(call|apply)$/.test(toks[b + 3].v)))) iife = true;
    if (!iife) { depthDelta[a] += 1; depthDelta[b + 1] -= 1; }
  }
  let d = 0;
  for (let k = 0; k < toks.length; k++) { d += depthDelta[k]; toks[k].load = d === 0; }
  return parents;
}

const GUARD_PREV = new Set(["typeof", "!", "?", "&&", "||", "??"]);
const GUARD_NEXT = new Set(["&&", "||", "??", "?", "?.", ")"]);
const ASSIGN = new Set(["=", "||=", "??=", "&&="]);

export function scanSource(src) {
  if (src.indexOf("CBZ") < 0) return { d: [], s: [], m: {}, h: {}, l: [] };   // a vendor file: no edges
  const toks = tokenize(src);
  const parents = markLoad(toks);
  const defs = new Set(), soft = new Set();
  const members = new Map();            // sym -> Set(member) defined
  const reads = new Map();              // sym -> { members:Set, load:bool, guarded:bool, hard:bool }
  /* ALIASES ARE SCOPED to the function that declares them (and the ones
     inside it): `const t = CBZ.gfxTier` in one helper must not turn every
     other `t.x` in the file into a read of CBZ.gfxTier. */
  const alias = new Map();              // local name -> [{fn, sym}]
  const ancestorOf = (anc, fn) => { for (let f = fn; ; f = parents[f]) { if (f === anc) return true; if (f < 0 || f == null) return false; } };
  function setAlias(name, sym, fn) { (alias.get(name) || alias.set(name, []).get(name)).push({ fn: fn == null ? -1 : fn, sym }); }
  function aliasOf(name, fn) {
    const L = alias.get(name);
    if (!L) return null;
    for (let i = L.length - 1; i >= 0; i--) if (ancestorOf(L[i].fn, fn)) return L[i].sym;
    return null;
  }
  const isCBZ = (k) => {
    const t = toks[k];
    if (!t || t.t !== "id" || t.v !== "CBZ") return false;
    const p = toks[k - 1];
    if (p && p.v === ".") { const pp = toks[k - 2]; return !!(pp && /^(window|W|globalThis|root|self)$/.test(pp.v)); }
    return true;
  };
  function R(sym) {
    let r = reads.get(sym);
    if (!r) { r = { members: new Set(), guardFns: new Set(), occ: [] }; reads.set(sym, r); }
    return r;
  }
  function addMember(sym, m) { (members.get(sym) || members.set(sym, new Set()).get(sym)).add(m); }
  // object literal keys at the top of { ... } starting at token k ("{")
  function objKeys(k) {
    const out = [];
    let depth = 0;
    for (let j = k; j < toks.length; j++) {
      const t = toks[j];
      if (t.v === "{" || t.v === "(" || t.v === "[") { depth++; continue; }
      if (t.v === "}" || t.v === ")" || t.v === "]") { depth--; if (depth === 0) break; continue; }
      if (depth !== 1) continue;
      const p = toks[j - 1];
      if ((t.t === "id" || t.t === "s") && p && (p.v === "{" || p.v === ",")) {
        const nx = toks[j + 1];
        if (nx && (nx.v === ":" || nx.v === "," || nx.v === "}" || nx.v === "(")) out.push(t.v);
        else if (t.v === "get" || t.v === "set" || t.v === "async") { if (toks[j + 1] && toks[j + 1].t === "id") out.push(toks[j + 1].v); }
      }
    }
    return out;
  }
  // is token k's expression (CBZ.x[.y]) in a guard position?
  function guardedAt(start, end) {
    const p = toks[start - 1], n1 = toks[end + 1];
    if (p && (GUARD_PREV.has(p.v))) return true;
    // CBZ.x == null / != undefined / === void 0: a presence test
    if (n1 && (n1.v === "==" || n1.v === "!=" || n1.v === "===" || n1.v === "!==")) {
      const n2 = toks[end + 2];
      if (n2 && (n2.v === "null" || n2.v === "undefined" || n2.v === "void")) return true;
    }
    // a === CBZ.x / CBZ.x !== b: an identity test needs nothing to exist
    if (p && (p.v === "==" || p.v === "!=" || p.v === "===" || p.v === "!==")) return true;
    if (n1 && (n1.v === "===" || n1.v === "!==" || n1.v === "==" || n1.v === "!=")) return true;
    if (n1 && GUARD_NEXT.has(n1.v)) {
      if (n1.v === ")") { // if (CBZ.x) / while (CBZ.x)
        const pp = toks[start - 1], ppp = toks[start - 2];
        return !!(pp && pp.v === "(" && ppp && (ppp.v === "if" || ppp.v === "while"));
      }
      return true;
    }
    return false;
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    // destructuring:  { a, b: c } = CBZ
    if (t.t === "id" && t.v === "CBZ" && isCBZ(k) && toks[k - 1] && toks[k - 1].v === "=" && toks[k - 2] && toks[k - 2].v === "}") {
      let depth = 0, j = k - 2;
      for (; j >= 0; j--) { if (toks[j].v === "}") depth++; else if (toks[j].v === "{") { depth--; if (depth === 0) break; } }
      for (const key of objKeys(j)) R(key).occ.push(t);
      continue;
    }
    // Object.defineProperty(CBZ, "x", ...)  (a lazy getter is a definition)
    if (t.t === "id" && t.v === "defineProperty" && toks[k - 1] && toks[k - 1].v === "." && toks[k - 2] && toks[k - 2].v === "Object" &&
        toks[k + 2] && toks[k + 2].v === "CBZ" && toks[k + 3] && toks[k + 3].v === "," && toks[k + 4] && toks[k + 4].t === "s") {
      defs.add(toks[k + 4].v);
      continue;
    }
    // Object.assign(CBZ, { ... })  /  Object.assign(CBZ.x, {...})  /  Object.assign(ALIAS, {...})
    if (t.t === "id" && t.v === "assign" && toks[k - 1] && toks[k - 1].v === "." && toks[k - 2] && toks[k - 2].v === "Object" && toks[k + 1] && toks[k + 1].v === "(") {
      const a = toks[k + 2];
      if (a && a.v === "CBZ" && toks[k + 3] && toks[k + 3].v === ",") {
        if (toks[k + 4] && toks[k + 4].v === "{") for (const key of objKeys(k + 4)) defs.add(key);
      } else if (a && a.v === "CBZ" && toks[k + 3] && toks[k + 3].v === "." && toks[k + 4]) {
        const sym = toks[k + 4].v;
        // skip `CBZ.x || {}` to the object literal
        let j = k + 5, depth = 0;
        for (; j < toks.length; j++) { const v = toks[j].v; if (v === "(" ) depth++; else if (v === ")") { if (depth === 0) break; depth--; } else if (v === "," && depth === 0) break; }
        if (toks[j] && toks[j].v === "," && toks[j + 1] && toks[j + 1].v === "{") for (const key of objKeys(j + 1)) addMember(sym, key);
      } else if (a && a.t === "id" && aliasOf(a.v, a.fn) && toks[k + 3] && toks[k + 3].v === "," && toks[k + 4] && toks[k + 4].v === "{") {
        for (const key of objKeys(k + 4)) addMember(aliasOf(a.v, a.fn), key);
      }
      continue;
    }
    // alias member writes / reads:  V.grab = ...   V.grab(...)   if (V) ...
    if (t.t === "id" && aliasOf(t.v, t.fn) && !(toks[k - 1] && (toks[k - 1].v === "." || toks[k - 1].v === "?."))) {
      const sym = aliasOf(t.v, t.fn);
      const n1 = toks[k + 1], n2 = toks[k + 2], n3 = toks[k + 3];
      if (n1 && (n1.v === "." || n1.v === "?.") && n2 && n2.t === "id") {
        if (n3 && ASSIGN.has(n3.v)) addMember(sym, n2.v);
        else { const r = R(sym); r.members.add(n2.v); if (!guardedAt(k, k + 2)) r.occ.push(t); }
      }
      if (guardedAt(k, k)) R(sym).guardFns.add(t.fn);
      continue;
    }
    if (!(t.t === "id" && t.v === "CBZ" && isCBZ(k))) continue;
    // CBZ.x  or CBZ["x"]
    let sym = null, end = k;
    const n1 = toks[k + 1], n2 = toks[k + 2];
    if (n1 && (n1.v === "." || n1.v === "?.") && n2 && n2.t === "id") { sym = n2.v; end = k + 2; }
    else if (n1 && n1.v === "[" && n2 && n2.t === "s" && toks[k + 3] && toks[k + 3].v === "]") { sym = n2.v; end = k + 3; }
    if (!sym) continue;
    const start = toks[k - 1] && toks[k - 1].v === "." ? k - 2 : k;
    const nx = toks[end + 1];
    // definition?
    if (nx && ASSIGN.has(nx.v)) {
      const prev = toks[start - 1];
      const isSoft = nx.v !== "=" ||
        (toks[end + 2] && toks[end + 2].v === "CBZ" && toks[end + 3] && toks[end + 3].v === "." && toks[end + 4] && toks[end + 4].v === sym) ||
        (prev && prev.v === ")" && softIf(toks, start - 1, sym)) ||
        (prev && prev.v === "{" && toks[start - 2] && toks[start - 2].v === ")" && softIf(toks, start - 2, sym));
      (isSoft ? soft : defs).add(sym);
      // alias: const V = CBZ.x = ...   /   NAME = CBZ.x = ...
      const pa = toks[start - 1], pb = toks[start - 2];
      if (pa && pa.v === "=" && pb && pb.t === "id") setAlias(pb.v, sym, pb.fn);
      // CBZ.x = { a, b }  -> members
      if (toks[end + 2] && toks[end + 2].v === "{") for (const key of objKeys(end + 2)) addMember(sym, key);
      continue;
    }
    // member definition CBZ.x.y = ...
    const m1 = toks[end + 1], m2 = toks[end + 2], m3 = toks[end + 3];
    const r = R(sym);
    if (m1 && (m1.v === "." || m1.v === "?.") && m2 && m2.t === "id") {
      if (m3 && ASSIGN.has(m3.v)) { addMember(sym, m2.v); }
      else r.members.add(m2.v);
      if (m1.v === "?.") r.guardFns.add(t.fn);
    }
    // alias:  const V = CBZ.x;  /  const V = CBZ.x || {}
    const pa = toks[start - 1], pb = toks[start - 2];
    if (pa && pa.v === "=" && pb && pb.t === "id" && (!m1 || m1.v === ";" || m1.v === "," || m1.v === "||" || m1.v === "??" || m1.v === ")")) setAlias(pb.v, sym, pb.fn);
    if (guardedAt(start, end)) r.guardFns.add(t.fn);
    else if (!(m1 && m1.v === "?.")) r.occ.push(t);
  }
  const h = {}, l = [];
  /* A read is OPTIONAL when a feature test of the same symbol sits in its own
     function or one enclosing it (`if (!CBZ.x) return;` at the top of the
     IIFE covers the file; `if (CBZ.x) {...}` in one helper covers only that
     helper). One uncovered read anywhere makes the symbol a hard edge. */
  const covered = (fn, set) => { for (let f = fn; ; f = parents[f]) { if (set.has(f)) return true; if (f < 0 || f == null) return false; } };
  for (const [sym, r] of reads) {
    const hardOcc = r.occ.filter((t) => !covered(t.fn, r.guardFns));
    if (!hardOcc.length) continue;
    r.load = hardOcc.some((t) => t.load);
    if (defs.has(sym) || soft.has(sym)) continue;
    h[sym] = Array.from(r.members).sort();
    if (r.load) l.push(sym);
  }
  const m = {};
  for (const [sym, set] of members) m[sym] = Array.from(set).sort();
  return { d: Array.from(defs).sort(), s: Array.from(soft).filter((x) => !defs.has(x)).sort(), m, h, l: l.sort() };
}
// `if (!CBZ.x) CBZ.x = ...`: the ")" at index p closes a test on !CBZ.x
function softIf(toks, p, sym) {
  for (let j = p - 1; j >= Math.max(0, p - 12); j--) {
    if (toks[j].v === sym && toks[j - 1] && toks[j - 1].v === "." && toks[j - 2] && toks[j - 2].v === "CBZ") return true;
    if (toks[j].v === "if") return false;
  }
  return false;
}


/* ---- the manifest --------------------------------------------------------
   Committed content is a pure function of the sources (no mtimes in it), so a
   fresh checkout and a rebuild agree byte for byte. The size+mtime stamps that
   make a warm rebuild ~20 ms live in a per-checkout sidecar under os.tmpdir(). */
const STAMPS = path.join(os.tmpdir(), "cbz-lab-deps-" + createHash("sha1").update(ROOT).digest("hex").slice(0, 10) + ".json");
export function buildManifest({ quiet = true, write = true } = {}) {
  const order = indexOrder();
  const all = walk(path.join(ROOT, "src"), []);
  const set = new Set(order);
  const extra = all.filter((f) => !set.has(f)).sort();
  let old = null, stamps = {};
  try { old = JSON.parse(readFileSync(MANIFEST, "utf8")); } catch (e) { old = null; }
  try { stamps = JSON.parse(readFileSync(STAMPS, "utf8")); } catch (e) { stamps = {}; }
  const oldBy = new Map();
  if (old && old.v === SCANNER_VERSION) for (const r of old.files) oldBy.set(r.f, r);
  const files = [], newStamps = {};
  let rescanned = 0, changed = !old || old.v !== SCANNER_VERSION;
  const list = order.concat(extra);
  list.forEach((f, i) => {
    const abs = path.join(ROOT, f);
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    const o = oldBy.get(f);
    const stamp = st.size + ":" + Math.floor(st.mtimeMs);
    let rec;
    if (o && stamps[f] && stamps[f].t === stamp && stamps[f].k === o.k) rec = o;
    else {
      const src = readFileSync(abs, "utf8");
      const sha = createHash("sha1").update(src).digest("hex").slice(0, 12);
      if (o && o.k === sha) rec = o;
      else { rescanned++; changed = true; rec = Object.assign({ f, k: sha }, scanSource(src)); }
    }
    newStamps[f] = { t: stamp, k: rec.k };
    const inIndex = i < order.length;
    rec = Object.assign({}, rec, { o: inIndex ? i : 100000 + i, x: inIndex ? 0 : 1 });
    const ov = OVERRIDES[f];
    if (ov && ov.needs) rec.n = ov.needs.slice(); else delete rec.n;
    if (ov && ov.drop) { rec.h = Object.assign({}, rec.h); for (const s of ov.drop) delete rec.h[s]; rec.l = (rec.l || []).filter((s) => !ov.drop.includes(s)); }
    if (!o || o.o !== rec.o || JSON.stringify(o.n || null) !== JSON.stringify(rec.n || null)) changed = true;
    files.push(rec);
  });
  if (old && old.files && old.files.length !== files.length) changed = true;
  const man = { v: SCANNER_VERSION, note: "generated by tools/lab/deps.mjs; do not edit (overrides live there)", indexCount: order.length, files };
  if (changed && write) writeFileSync(MANIFEST, JSON.stringify(man).replace(/\},\{"f"/g, '},\n{"f"') + "\n");
  try { writeFileSync(STAMPS, JSON.stringify(newStamps)); } catch (e) {}
  if (!quiet) console.error(`[deps] ${files.length} files (${order.length} in index.html), rescanned ${rescanned}${changed ? ", manifest written" : ", unchanged"}`);
  return { man, rescanned, changed };
}

export function loadManifest() { return buildManifest().man; }

/* THE PRELUDE: what lab.html loads before any closure, in this order. The
   symbols the PROVIDERS define are PROVIDED: the closure never pulls the full
   engine's definer for something the lab page already has. Read off the files
   with the same scanner, so the list cannot drift. microboot.js is loaded but
   is NOT a provider: its definitions are fallbacks (cmat, collide, ...) and
   the real engine file wins wherever a kit reaches it. labworld.js publishes
   by name the few things it really stands in for (scene, camera, renderer,
   canvas, the lights). src/lab/labworld.js keeps the same list for the page. */
export const PRELUDE = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/seed.js", "src/core/microboot.js",
  "src/lab/closure.js", "src/lab/registry.js", "src/lab/labworld.js"];
export const PRELUDE_PROVIDERS = ["src/config.js", "src/core/seed.js", "src/lab/labworld.js"];
/* loaded after the closure, last, as index.html does: it sorts the frame registry
   and owns CBZ.stepSim */
export const POSTLUDE = ["src/core/loop.js"];
export function preludeProvides(man) {
  const by = new Map(man.files.map((r) => [r.f, r]));
  const out = new Set();
  for (const f of PRELUDE_PROVIDERS.concat(POSTLUDE)) { const r = by.get(f); if (r) { (r.d || []).forEach((s) => out.add(s)); (r.s || []).forEach((s) => out.add(s)); } }
  for (const s of registryLib().MICRO_PROVIDES || []) out.add(s);
  return Array.from(out).sort();
}
/* src/lab/registry.js under node (no THREE, no DOM): the lists the page reads */
function registryLib() {
  const vm = require("node:vm");
  const g = { CBZ: {} };
  g.window = g;
  vm.runInContext(readFileSync(path.join(ROOT, "src/lab/registry.js"), "utf8"), vm.createContext(g), { filename: "src/lab/registry.js" });
  return g.CBZ.lab;
}

/* a kit's entries, read the way the page reads them (src/lab/registry.js):
   the kit file first, then the ingredient files it (and they) name */
export function kitEntries(name, params = {}) {
  const vm = require("node:vm");
  const g = { CBZ: {} };
  g.window = g;
  const ctx = vm.createContext(g);
  const run = (f) => vm.runInContext(readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  run("src/lab/registry.js");
  const L = g.CBZ.lab;
  const kf = L.kitFile(name);
  if (!existsSync(path.join(ROOT, kf))) throw new Error(`lab: no kit '${name}' (known: ${listKits().join(", ")})`);
  run(kf);
  for (let pass = 0; pass < 8; pass++) {
    const want = new Set(L.registry.kits[name].uses || []);
    for (const n of Object.keys(L.registry.ingredients)) for (const u of L.registry.ingredients[n].uses || []) want.add(u);
    const todo = [...want].filter((n) => !L.registry.ingredients[n]);
    if (!todo.length) break;
    for (const n of todo) run(L.ingredientFile(n));
  }
  const e = L.entriesFor(name, params);
  e.kitFiles = e.ingredients.map((n) => L.ingredientFile(n)).concat([kf]);
  return e;
}
export function listKits() {
  try { return readdirSync(path.join(ROOT, "src/lab/kits")).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)).sort(); } catch (e) { return []; }
}

export function resolveFor({ files = [], symbols = [], depth, kit, params } = {}) {
  const man = loadManifest();
  let skip = [], dep = depth, kitFiles = [];
  if (kit) {
    const e = kitEntries(kit, params || {});
    files = files.concat(e.files); symbols = symbols.concat(e.symbols); skip = e.skip || []; kitFiles = e.kitFiles;
    if (dep == null) dep = e.depth;
  }
  const provided = preludeProvides(man);
  const res = closure.resolve(man, { files, symbols, provided, depth: dep == null ? 1 : dep, skip: skip.concat(PRELUDE, POSTLUDE) });
  const scripts = PRELUDE.concat(res.files, POSTLUDE, kitFiles);
  return Object.assign(res, { provided, indexCount: man.indexCount, kitFiles, scripts, total: scripts.length });
}

/* ---- CLI ----------------------------------------------------------------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const arg = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const list = (k) => (arg(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const t0 = Date.now();
  const { man, rescanned, changed } = buildManifest({ quiet: true });
  if (a.includes("--check")) { console.log(changed ? "deps.json was STALE (rewritten)" : "deps.json fresh"); process.exit(changed ? 1 : 0); }
  if (arg("--who")) {
    const s = arg("--who");
    const defs = man.files.filter((r) => (r.d || []).includes(s)).map((r) => r.f);
    const softs = man.files.filter((r) => (r.s || []).includes(s)).map((r) => r.f);
    const readers = man.files.filter((r) => r.h && r.h[s]).map((r) => r.f + ((r.l || []).includes(s) ? " (load)" : ""));
    console.log(JSON.stringify({ sym: s, defines: defs, softDefines: softs, hardReaders: readers.length, readers: readers.slice(0, 40) }, null, 1));
    process.exit(0);
  }
  if (a.includes("--kits")) {
    for (const k of listKits()) { const r = resolveFor({ kit: k }); console.log(`${k.padEnd(16)} ${String(r.total).padStart(4)} scripts (${r.files.length} traced) of ${r.indexCount}`); }
    process.exit(0);
  }
  const files = list("--file"), symbols = list("--sym"), kit = arg("--kit");
  if (!files.length && !symbols.length && !kit) {
    console.log(`[deps] ${man.files.length} files, ${man.indexCount} in index.html; rescanned ${rescanned}${changed ? ", manifest written" : ""}; ${Date.now() - t0} ms -> ${path.relative(ROOT, MANIFEST)}`);
    process.exit(0);
  }
  const params = {};
  for (const [k, v] of new URLSearchParams(arg("--params") || "")) params[k] = v;
  const res = resolveFor({ files, symbols, kit, params, depth: arg("--depth") != null ? (arg("--depth") === "inf" ? Infinity : +arg("--depth")) : undefined });
  if (a.includes("--json")) { console.log(JSON.stringify(res, null, 1)); process.exit(0); }
  const w = arg("--why");
  if (w) { console.log(w, "<=", res.why[w] || "(not in closure)"); process.exit(0); }
  for (const f of res.files) console.log(f.padEnd(44), res.why[f]);
  console.log(`\n${res.files.length} traced + ${PRELUDE.length} prelude + ${POSTLUDE.length} loop + ${res.kitFiles.length} lab = ${res.total} scripts of ${res.indexCount} in index.html; missing: ${res.missing.join(", ") || "none"}; ${Date.now() - t0} ms`);
}
