#!/usr/bin/env node
/* tools/build-disaster-page.mjs — WRITE disaster.html FROM index.html.

   Natural Disaster Survival is one of six games on index.html, and index.html
   is 553 script tags and 25 MB of JavaScript: the prison, the city, the
   campaign, the casino, the aircraft, the elections. On a desktop that is a
   slow load. On a phone — which is where this game is going — it is the whole
   product being 20 seconds of blank screen for a game that needs a fifth of it.

   So the App Store build gets its own door: `disaster.html`, the SAME page
   minus the scripts this game never runs, opening straight onto the island.

   WHY GENERATED AND NOT HAND-WRITTEN. A hand-written second page is a fork:
   the HUD markup, the CSS links, the screen DOM and the boot order all get
   copied, and then index.html changes and the copy quietly rots — which is
   exactly the duplication this repo's CLAUDE.md forbids. This tool keeps ONE
   source of truth (index.html) and applies four mechanical edits:

     1. drop every <script src> named in the manifest (tools/disaster-slice.json)
     2. declare the start mode, so the page opens on the island and never
        builds the city (src/config.js reads window.CBZ.START_MODE)
     3. retitle the document and the loading card
     4. cut the MORE GAMES strip — the other five games are not in this build

   Everything else — the head, the CSS, the HUD, the screens, the one inline
   pre-config script — is index.html's, byte for byte.

     node tools/build-disaster-page.mjs            # write disaster.html
     node tools/build-disaster-page.mjs --check    # fail if it is stale (CI)
     node tools/build-disaster-page.mjs --list     # what would be dropped

   The manifest is MEASURED, not guessed: tools/disaster-minimize.mjs finds it
   by dropping files and asking tools/disaster-check.mjs whether the game still
   boots, runs all eleven disasters and keeps every named system. */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

const MANIFEST = path.join(ROOT, arg("--manifest", "tools/disaster-slice.json"));
const OUT = path.join(ROOT, arg("--out", "disaster.html"));

export function scriptList(html) {
  return [...html.matchAll(/<script(?: defer)? src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
}

export function buildPage(html, dropSet) {
  const kept = [];
  const dropped = [];

  // 1. drop the script tags this game never runs. A tag is one line in
  //    index.html and always has been; the comment block above it is left in
  //    place deliberately — it explains an ordering constraint that still
  //    applies to the tags that remain.
  let out = html.split("\n").filter((line) => {
    const m = line.match(/<script(?: defer)? src="([^"]+)"/);
    if (!m) return true;
    const p = m[1].split("?")[0];
    if (dropSet.has(p)) { dropped.push(p); return false; }
    kept.push(p);
    return true;
  }).join("\n");

  // 2. the start mode, declared before config.js reads it. Goes into the
  //    existing pre-config inline block rather than adding a second one.
  const POP = `    if (_popOverride > 0) window.CBZ = Object.assign(window.CBZ || {}, { MASS_CROWD: _popOverride });`;
  const DECL = `  /* THIS PAGE IS ONE GAME. src/config.js reads START_MODE and opens there, so
     the island is the only world this build ever stands up — no city, no
     prison, nothing behind the title card that the player did not ask for. */
  window.CBZ = Object.assign(window.CBZ || {}, { START_MODE: "survival" });
  try {`;
  if (!out.includes(POP)) throw new Error("index.html's pre-config inline block moved — update this tool");
  out = out.replace("  try {", DECL);

  // 3. the document is this game, not the release
  out = out.replace("<title>Gang Life</title>", "<title>Natural Disaster Survival</title>");

  // 4. MORE GAMES is not in this build
  const stripStart = out.indexOf(`<div class="origin-label mode-strip-label">`);
  const stripEnd = out.indexOf(`</div>`, out.indexOf(`</button>\n    </div>`, stripStart));
  if (stripStart > 0 && stripEnd > stripStart) {
    out = out.slice(0, stripStart) +
      `<!-- MORE GAMES is cut from this build: disaster.html ships ONE game.\n` +
      `     (tools/build-disaster-page.mjs removes the strip; index.html keeps it.) -->\n` +
      `    <div id="modeSelect" class="mode-select" hidden>\n` +
      `      <button class="mode-btn active" type="button" data-mode="survival"><span>Disaster Survival</span><small>100 players · last alive</small></button>\n` +
      `    </div>\n  ` + out.slice(stripEnd + 6);
  }

  const banner = `<!-- ============================================================
     disaster.html — GENERATED. Do not edit; edit index.html or the manifest.

       node tools/build-disaster-page.mjs

     Natural Disaster Survival, standing alone: index.html minus the ${dropped.length}
     script tags this game never runs, opening straight onto the island. This
     is the page the iOS build ships (tools/build-ios.mjs bundles it).
============================================================ -->
`;
  out = out.replace("<!DOCTYPE html>\n", "<!DOCTYPE html>\n" + banner);
  return { html: out, kept, dropped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { drop: [] };
  const dropSet = new Set(manifest.drop || []);
  const { html: page, kept, dropped } = buildPage(html, dropSet);

  const size = (list) => list.reduce((a, p) => {
    try { return a + statSync(path.join(ROOT, p)).size; } catch (_) { return a; }
  }, 0);
  const mb = (n) => (n / 1048576).toFixed(2) + " MB";

  if (has("--list")) {
    for (const p of dropped) console.log("drop  " + p);
    console.log(`\n${kept.length} kept (${mb(size(kept))}) · ${dropped.length} dropped (${mb(size(dropped))})`);
  } else if (has("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== page) {
      console.error("disaster.html is STALE — run: node tools/build-disaster-page.mjs");
      process.exit(1);
    }
    console.log("disaster.html is up to date (" + kept.length + " scripts, " + mb(size(kept)) + ")");
  } else {
    writeFileSync(OUT, page);
    console.log(`wrote ${path.relative(ROOT, OUT)} — ${kept.length} scripts, ${mb(size(kept))} ` +
      `(index.html: ${kept.length + dropped.length} scripts, ${mb(size(kept) + size(dropped))})`);
  }
}
