/* ============================================================
   vite.config.js — O1 (BUILD-PLAN.md Stage O; MASTER-PLAN.md Part II.2).

   GOAL: `npm run dev` serves the SAME game as static hosting (module world
   layered on top), while `index.html` on disk stays byte-identical so a
   dumb static server (`python3 -m http.server`) keeps working exactly as
   before Vite existed — "legacy files untouched" per BUILD-PLAN.md's O1.

   THE CRUX (why this file looks the way it does): the legacy game is ~241
   classic (non-`type=module`) `<script src="...">` tags, script-tag-ordered,
   reading/writing globals (`window.CBZ`, `window.THREE`). Two things follow:

   1. DEV: Vite's dev server serves any file under the project root as a
      plain static file unless it's pulled into the ES module graph via an
      `import`/`type=module` reference. Since none of the 241 legacy tags
      are `type=module`, Vite never transforms them — they load and run
      exactly as they do today, in the same document order, completely
      unaffected by Vite being in front of them. Verified empirically (see
      this wave's report) by diffing served bytes / behavior against a
      plain static server. The ONLY thing Vite dev adds is our injected
      `<script type="module" src="/src/bootstrap.js">` tag (below), which
      loads src/bootstrap.js as a real ES module — the O2+ bridge.

   2. BUILD: Vite's DEFAULT `vite build` treats `index.html` itself as the
      Rollup entry and fingerprints/rewrites EVERY local asset reference it
      finds in it (`<script src>`, `<link href>`, ...) into hashed
      `assets/*-HASH.js` files. That is correct for a normal Vite app, but
      it would silently break this game: several legacy files reference
      their OWN sibling files by relative STRING PATH at runtime, not via
      an import Vite can see or rewrite — e.g. src/net/sqlitedb.js's
      `WORKER_URL = "src/workers/sqlitedb-worker.js?v=sql1"` fed straight
      into `new Worker(...)`, and that worker's own
      `importScripts("../vendor/sqlite-wasm/jswasm/sqlite3.js")`. Rollup's
      HTML asset pipeline has no way to know about those string literals,
      so if it renamed/hashed the files, both would 404 the moment the game
      tried to open its sqlite-wasm backend from a built bundle.

      So this build DOES NOT feed index.html to Vite's asset pipeline at
      all: `build.rollupOptions.input` points ONLY at src/bootstrap.js (the
      one real ES module this wave owns), emitted at a FIXED, unhashed path
      (`assets/bootstrap.js`) specifically so it can be referenced
      deterministically. The `cbzLegacyBridge` plugin's `closeBundle` hook
      then copies the legacy tree (css/, src/, assets/) into dist/ BYTE FOR
      BYTE (no rewriting) and writes a dist/index.html that is the on-disk
      index.html PLUS one injected module-script line — an ARTIFACT of the
      build, not an edit to the tracked source file. This is the
      "documented outcome" BUILD-PLAN.md's O1 explicitly allows: dev-server
      parity is real Vite dev-server behavior; `build`/`preview` produce a
      copied-through static bundle rather than a tree-shaken one. Tightening
      this (actually running legacy scripts through Rollup) is out of scope
      for O1 and not attempted here — see the report for what was verified.

   `three` stays exactly as it is today (CDN <script> tag, r128) — O1 does
   NOT touch it; that is O3's job (BUILD-PLAN.md). `vite` is the only new
   dependency this wave adds.
============================================================ */
import { defineConfig } from "vite";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// The exact tag we inject — identical text in dev (transformIndexHtml) and
// build (closeBundle), modulo the src path (raw source vs. built chunk).
function bootScriptTag(src) {
  return `<script type="module" src="${src}"></script>`;
}

function injectBeforeBodyClose(html, tag) {
  if (html.includes(tag)) return html; // idempotent
  if (html.includes("</body>")) return html.replace("</body>", `  ${tag}\n</body>`);
  return html + tag; // defensive fallback; index.html always has </body> today
}

// Directories copied through untouched for `vite build` (see header). Not
// server/ (a separate Node process, untouched by this wave) and not
// node_modules (ignored/managed by npm).
const LEGACY_COPY_DIRS = ["css", "assets", "src"];
// Files under those dirs that are intentionally NOT copied raw because
// they're already emitted by Rollup at a fixed path (see build.rollupOptions
// below) — copying both would leave two divergent copies on disk.
const SKIP_RAW_COPY = new Set(["src/bootstrap.js"]);

function copyRecursive(srcDir, destDir, relBase) {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const s = join(srcDir, entry);
    const d = join(destDir, entry);
    const rel = relBase ? `${relBase}/${entry}` : entry;
    if (SKIP_RAW_COPY.has(rel)) continue;
    const st = statSync(s);
    if (st.isDirectory()) copyRecursive(s, d, rel);
    else copyFileSync(s, d);
  }
}

function cbzLegacyBridge() {
  return {
    name: "cbz-legacy-bridge",
    // DEV: inject the module tag into the HTML Vite serves in memory. The
    // index.html FILE ON DISK is never written to.
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return injectBeforeBodyClose(html, bootScriptTag("/src/bootstrap.js"));
      },
    },
    // BUILD: after Rollup has emitted assets/bootstrap.js, copy the legacy
    // tree through untouched and write dist/index.html = source index.html
    // + the same injected tag (pointing at the built, fixed-path chunk).
    // (closeBundle is a Rollup/build-only hook — it never fires for `vite
    // serve`, so no `apply: "build"` gate is needed here; note that gating
    // the WHOLE plugin object with `apply` would also disable
    // transformIndexHtml above during dev, which is the opposite of what
    // we want.)
    closeBundle() {
      const outDir = join(root, "dist");
      mkdirSync(outDir, { recursive: true });
      for (const dir of LEGACY_COPY_DIRS) {
        copyRecursive(join(root, dir), join(outDir, dir), dir);
      }
      const sourceHtml = readFileSync(join(root, "index.html"), "utf8");
      const builtHtml = injectBeforeBodyClose(sourceHtml, bootScriptTag("/assets/bootstrap.js"));
      writeFileSync(join(outDir, "index.html"), builtHtml);
    },
  };
}

export default defineConfig({
  plugins: [cbzLegacyBridge()],
  build: {
    rollupOptions: {
      input: { bootstrap: "src/bootstrap.js" },
      // Vite's default build assumes an HTML "app" (nothing imports the
      // entry chunk's own exports, so Rollup would tree-shake them away —
      // verified empirically: without this, dist/assets/bootstrap.js loses
      // every `export` statement, silently breaking `import {registerModule}
      // from "/assets/bootstrap.js"` for O2+). "strict" forces Rollup to
      // keep this chunk's exports exactly as declared, same as dev/source.
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    // this wave's one real module is tiny; no need for minified es-module
    // preload polyfills etc. for a single-file, no-dependency entry.
    modulePreload: false,
  },
});
