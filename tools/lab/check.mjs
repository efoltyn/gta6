#!/usr/bin/env node
/* tools/lab/check.mjs — the lab's node-only ratchet (no Chrome):
   1. src/lab/deps.json is fresh (rebuilds it; exit 1 if it was stale)
   2. the page's PRELUDE/POSTLUDE (src/lab/labworld.js) match the tracer's
      (tools/lab/deps.mjs): two copies of one list must never drift
   3. every kit resolves: no unknown ingredient, no unresolved entry file
   Run it before committing a kit or a tracer change. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, PRELUDE, POSTLUDE, buildManifest, listKits, resolveFor } from "./deps.mjs";

let bad = 0;
const { changed } = buildManifest();
if (changed) { console.log("FAIL deps.json was stale (rewritten now: commit it)"); bad++; } else console.log("ok   deps.json fresh");
const src = readFileSync(path.join(ROOT, "src/lab/labworld.js"), "utf8");
const list = (name) => { const m = new RegExp("L\\." + name + " = (\\[[^\\]]*\\])").exec(src); return m ? JSON.parse(m[1].replace(/\s+/g, " ")) : null; };
for (const [n, want] of [["PRELUDE", PRELUDE], ["POSTLUDE", POSTLUDE]]) {
  const got = list(n);
  if (JSON.stringify(got) !== JSON.stringify(want)) { console.log(`FAIL labworld.js L.${n} ${JSON.stringify(got)} != deps.mjs ${JSON.stringify(want)}`); bad++; }
  else console.log(`ok   ${n} in step (${want.length} files)`);
}
for (const k of listKits()) {
  try {
    const r = resolveFor({ kit: k });
    const miss = r.missing.filter((m) => m.startsWith("file:"));
    if (miss.length) { console.log(`FAIL ${k}: entry files not in the manifest: ${miss.join(", ")}`); bad++; }
    else console.log(`ok   ${k.padEnd(14)} ${r.total} scripts of ${r.indexCount}`);
  } catch (e) { console.log(`FAIL ${k}: ${e.message}`); bad++; }
}
process.exit(bad ? 1 : 0);
