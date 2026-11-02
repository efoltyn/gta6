#!/usr/bin/env node
/* tools/three/bump-v.mjs — re-key the ?v= of every changed script on every page.

     node tools/three/bump-v.mjs <key> <file...>     # e.g. r187b src/core/renderer.js ...
     node tools/three/bump-v.mjs <key> --since <ref> # every .js changed since <ref>

   For each page (index.html, disaster.html, lab.html, games/*.html, tools/*.html)
   every <script src> naming one of the files gets ?v=<key> (added if it had
   none). Files that ride a studio pack (src/core/studio.js PACKS) are loaded
   with studio.js's own ?v=, so studio.js is re-keyed on the pages that load
   it whenever one of them changed. Prints what it touched. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [key, ...rest] = process.argv.slice(2);
if (!key || !rest.length) { console.error("usage: bump-v.mjs <key> <file...> | --since <ref>"); process.exit(2); }
let files = rest;
if (rest[0] === "--since") {
  files = execFileSync("git", ["diff", "--name-only", rest[1], "--", "src", "games"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => /\.js$/.test(f) && existsSync(path.join(ROOT, f)));
}
const want = new Set(files.map((f) => f.replace(/^\.\//, "")));
const studioSrc = readFileSync(path.join(ROOT, "src/core/studio.js"), "utf8");
const packed = [...want].some((f) => f.startsWith("src/") && studioSrc.includes(JSON.stringify(f.slice(4))));
if (packed) want.add("src/core/studio.js");

const pages = ["index.html", "disaster.html", "lab.html"]
  .concat(readdirSync(path.join(ROOT, "games")).filter((f) => f.endsWith(".html")).map((f) => "games/" + f))
  .concat(readdirSync(path.join(ROOT, "tools")).filter((f) => f.endsWith(".html")).map((f) => "tools/" + f));
let total = 0;
for (const page of pages) {
  const p = path.join(ROOT, page);
  if (!existsSync(p)) continue;
  const dir = path.dirname(page);
  let s = readFileSync(p, "utf8"), n = 0;
  s = s.replace(/(<script\b[^>]*\bsrc=")([^"?]+)(\?v=[^"]*)?(")/g, (m, a, src, q, z) => {
    const abs = path.normalize(path.join(dir, src)).split(path.sep).join("/");
    if (!want.has(abs)) return m;
    n++;
    return a + src + "?v=" + key + z;
  });
  if (n) { writeFileSync(p, s); total += n; console.log(`${page}: ${n}`); }
}
console.log(`${total} script tags re-keyed to ?v=${key}${packed ? " (studio.js too: a pack file changed)" : ""}`);
