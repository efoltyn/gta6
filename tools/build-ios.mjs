#!/usr/bin/env node
/* tools/build-ios.mjs — THE APP BUNDLE.

   Turns disaster.html and the files it loads into `dist-ios/www/`: the exact
   tree Capacitor copies into the iOS app, with three things done to it that
   the web build deliberately does not do.

   1. ONE FILE INSTEAD OF FOUR HUNDRED. The web deploy's rule is that pushing
      to main IS the deploy, so index.html ships as script tags and no build
      step exists. An app is different: it is compiled, signed and uploaded, so
      the build step is already there and refusing to use it costs the player
      hundreds of round trips through WKWebView's URL loading and hundreds of
      separate V8 compile tasks on a phone CPU. The kept scripts are
      concatenated, in the SAME order the page lists them, into bundle.js.

      THE ONE THING CONCATENATION BREAKS, and how this handles it: several
      files derive a path from `document.currentScript.src` (city/playercars.js
      finds the Draco decoder that way, core/studio.js finds src/, and
      city/worldmap.js keys its boot-progress steps by it). In a bundle they
      would all see bundle.js. So the bundle redefines `document.currentScript`
      on the document object and sets it to a stand-in carrying the real file's
      URL before each file's code runs — the bundle answers that question
      exactly as separate tags did.

   2. MINIFIED, if esbuild is installed (it is a devDependency). Comment-heavy
      source is this repo's whole documentation strategy and 25 MB of it is
      wonderful to read and slow to parse. Nothing is renamed at global scope —
      every module here talks to every other through window.CBZ, so only
      function-local names are touched.

   3. ONLY WHAT IT NEEDS. Assets are copied by SCANNING the kept code for the
      paths it actually asks for, rather than copying 25 MB and hoping.

     node tools/build-ios.mjs                 # build dist-ios/www
     node tools/build-ios.mjs --no-minify     # readable bundle, for debugging
     node tools/build-ios.mjs --serve-check   # ... then boot it and check it

   The result is verified the same way everything else in this wave is:
     node tools/disaster-check.mjs --url dist-ios/www/index.html --fast     */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const OUT = path.join(ROOT, "dist-ios/www");
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

// ---- 0. the page is generated from index.html; make sure it is current -----
execFileSync("node", [path.join(ROOT, "tools/build-disaster-page.mjs")], { cwd: ROOT, stdio: "inherit" });
const page = readFileSync(path.join(ROOT, "disaster.html"), "utf8");

rmSync(path.join(ROOT, "dist-ios"), { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---- 1. the bundle ---------------------------------------------------------
const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const parts = [];
parts.push(`/* Natural Disaster Survival — bundled by tools/build-ios.mjs.
   ${scripts.length} files, concatenated in the page's own order. Each block is
   preceded by the currentScript stand-in for the file it came from, so code
   that derives a path from document.currentScript.src behaves exactly as it
   does when these are separate <script src> tags. */
(function () {
  var _cur = null;
  try {
    Object.defineProperty(document, "currentScript", {
      configurable: true, get: function () { return _cur; },
    });
  } catch (e) {}
  window.__cbzBundleAt = function (src) { _cur = src ? { src: new URL(src, location.href).href } : null; };
})();
`);
let rawBytes = 0;
for (const s of scripts) {
  const rel = s.split("?")[0];
  const file = path.join(ROOT, rel);
  if (!existsSync(file)) { console.error("  missing: " + rel); continue; }
  const code = readFileSync(file, "utf8");
  rawBytes += code.length;
  parts.push(`\n;window.__cbzBundleAt(${JSON.stringify(s)});\n/* ==== ${rel} ==== */\n`);
  parts.push(code);
  parts.push("\n");
}
parts.push(`\n;window.__cbzBundleAt(null);\n`);
const bundlePath = path.join(OUT, "bundle.js");
writeFileSync(bundlePath, parts.join(""));
console.log(`bundle: ${scripts.length} files, ${mb(rawBytes)} raw`);

// ---- 2. minify, if esbuild is here ----------------------------------------
let minified = false;
if (!has("--no-minify")) {
  const esbuild = path.join(ROOT, "node_modules/.bin/esbuild");
  if (existsSync(esbuild)) {
    /* --keep-names because several systems here identify a function by
       fn.name (the updater sort prints them, and tools/ read them back);
       nothing is renamed at global scope regardless — these files are IIFEs
       talking through window.CBZ. */
    execFileSync(esbuild, [bundlePath, "--minify", "--keep-names", "--charset=utf8",
      "--target=safari15", "--outfile=" + bundlePath + ".min"], { stdio: "inherit" });
    const min = readFileSync(bundlePath + ".min");
    writeFileSync(bundlePath, min);
    rmSync(bundlePath + ".min");
    minified = true;
    console.log(`minified: ${mb(rawBytes)} → ${mb(min.length)}`);
  } else {
    console.log("esbuild not installed — shipping the readable bundle (npm i -D esbuild)");
  }
}

// ---- 3. the page, with one script tag --------------------------------------
let html = page;
const first = html.indexOf(`<script src="${scripts[0]}"></script>`);
html = html.split("\n").filter((l) => !/<script src="[^"]+"><\/script>/.test(l)).join("\n");
const marker = `<!-- 0. namespace + constants -->`;
const tag = `<!-- THE WHOLE GAME, IN ONE FILE. tools/build-ios.mjs concatenated the
     ${scripts.length} script tags disaster.html lists, in that order, into bundle.js.
     A phone pays for one fetch and one compile instead of ${scripts.length} of each. -->
<script src="bundle.js"></script>`;
html = html.includes(marker) ? html.replace(marker, tag) : html.replace("</body>", tag + "\n</body>");
void first;

/* THE APP IS NOT A BROWSER TAB. Three lines a web page does not need and an
   app cannot ship without: no rubber-band scroll under the canvas, no
   long-press callout on the HUD, and no text selection when a thumb drags
   across a button. The viewport tag already carries viewport-fit=cover, and
   css/hud.css already pads to env(safe-area-inset-*). */
html = html.replace("</head>", `<style>
  /* iOS shell: the page is a game surface, not a document */
  html, body { position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent; touch-action: none; }
</style>
</head>`);
writeFileSync(path.join(OUT, "index.html"), html);

// ---- 4. what the code actually asks for ------------------------------------
const bundleSrc = readFileSync(bundlePath, "utf8");
const cssFiles = [...page.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((m) => m[1]);
const cssSrc = cssFiles.map((f) => { try { return readFileSync(path.join(ROOT, f), "utf8"); } catch (_) { return ""; } }).join("\n");
const hay = bundleSrc + "\n" + cssSrc + "\n" + html;

/* Every "assets/..." and "src/..." string literal in the shipped code. A path
   built by concatenation at runtime (assets/audio/ + name + .m4a) shows up as
   its literal prefix, so directories are copied whole when their prefix is
   referenced. */
const wanted = new Set();
for (const m of hay.matchAll(/["'`](?:\.\.\/)?((?:assets|src|css)\/[A-Za-z0-9_./-]*)/g)) wanted.add(m[1]);

function copyTree(rel) {
  const from = path.join(ROOT, rel), to = path.join(OUT, rel);
  if (!existsSync(from)) return 0;
  const st = statSync(from);
  if (st.isFile()) { mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); return st.size; }
  let n = 0;
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) n += copyTree(path.join(rel, e));
  return n;
}

// css always; the rest is what the scan found, collapsed to its shallowest dirs
const copy = new Set(cssFiles);
for (const w of wanted) {
  const parts2 = w.split("/");
  if (parts2[0] === "assets") copy.add(parts2.slice(0, Math.min(2, parts2.length)).join("/"));
  else if (parts2[0] === "src" && /\.(js|wasm|json|bin|glb|png|jpg|m4a|mp3|ogg)$/.test(w)) copy.add(w);
  else if (parts2[0] === "src" && parts2[1] === "workers") copy.add("src/workers");
  else if (parts2[0] === "src" && parts2[1] === "vendor") copy.add(w);
}
let assetBytes = 0;
for (const c of [...copy].sort()) assetBytes += copyTree(c);

// ---- 5. the report ---------------------------------------------------------
function treeSize(dir) {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e), st = statSync(p);
    n += st.isDirectory() ? treeSize(p) : st.size;
  }
  return n;
}
const total = treeSize(OUT);
console.log(`\ndist-ios/www`);
console.log(`  bundle.js   ${mb(statSync(bundlePath).size)}${minified ? " (minified)" : ""}`);
console.log(`  assets      ${mb(assetBytes)} in ${copy.size} paths`);
console.log(`  TOTAL       ${mb(total)}`);
console.log(`\nverify:  node tools/disaster-check.mjs --url dist-ios/www/index.html --fast`);
console.log(`ship:    npx cap sync ios && open ios/App/App.xcworkspace`);
