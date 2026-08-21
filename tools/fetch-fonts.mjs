#!/usr/bin/env node
/* ============================================================
   tools/fetch-fonts.mjs — re-bake assets/fonts/ from Google Fonts.

   The game self-hosts Fredoka (see css/fonts.css for why). This is the one
   script that put those .woff2 files there. Run it if Google ships a new
   version of the face, or if you add a weight:

       node tools/fetch-fonts.mjs

   It asks googleapis for each weight with a MODERN browser UA (the UA is what
   decides whether you get .woff2 or ancient .ttf), pulls the LATIN block out
   of the returned @font-face CSS, and writes assets/fonts/fredoka-<w>.woff2.
   It does NOT rewrite css/fonts.css — the unicode-range there is stable.
============================================================ */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets", "fonts");
const WEIGHTS = [400, 500, 600, 700];
// woff2 is only served to UAs known to support it; a bare fetch() UA gets ttf.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function latinUrlFor(weight) {
  const api = `https://fonts.googleapis.com/css2?family=Fredoka:wght@${weight}&display=swap`;
  const css = await (await fetch(api, { headers: { "User-Agent": UA } })).text();
  // Google emits "/* latin */" immediately before the block we want.
  const block = css.split("/* latin */")[1];
  if (!block) throw new Error(`no latin subset in response for weight ${weight}`);
  const m = block.match(/url\((https:[^)]+\.woff2)\)/);
  if (!m) throw new Error(`no woff2 url for weight ${weight} (got ttf? check UA)`);
  return m[1];
}

await mkdir(OUT, { recursive: true });
for (const w of WEIGHTS) {
  const url = await latinUrlFor(w);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  // woff2 files start with the ASCII signature "wOF2".
  if (buf.subarray(0, 4).toString("latin1") !== "wOF2") {
    throw new Error(`weight ${w}: downloaded file is not woff2`);
  }
  await writeFile(join(OUT, `fredoka-${w}.woff2`), buf);
  console.log(`fredoka-${w}.woff2  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log("\nfonts baked into assets/fonts/ — css/fonts.css already points at them.");
