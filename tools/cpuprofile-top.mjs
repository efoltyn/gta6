#!/usr/bin/env node
/* tools/cpuprofile-top.mjs — read a .cpuprofile (tools/world-hash.mjs --profile,
   DevTools) and print the top functions by SELF and by INCLUSIVE time, keyed
   file:function:line. Recursion is counted once per stack for inclusive.
     node tools/cpuprofile-top.mjs build.cpuprofile [--n 40] [--filter city/]      */
import fs from "node:fs";
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const N = +opt("--n", 40), FILTER = opt("--filter", "");
const P = JSON.parse(fs.readFileSync(a[0], "utf8"));
const byId = new Map(P.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of P.nodes) for (const c of n.children || []) parent.set(c, n.id);
const key = (n) => { const f = n.callFrame; return `${(f.url || "").replace(/^.*?\/src\//, "").replace(/\?.*$/, "") || "(native)"}:${f.functionName || "(anon)"}:${f.lineNumber + 1}`; };
const dt = new Map(); const ts = P.timeDeltas || [];
for (let i = 0; i < P.samples.length; i++) dt.set(P.samples[i], (dt.get(P.samples[i]) || 0) + (ts[i + 1] != null ? ts[i + 1] : 0));
const self = new Map(), incl = new Map(); let total = 0;
for (const [id, us] of dt) {
  total += us; const n = byId.get(id); self.set(key(n), (self.get(key(n)) || 0) + us);
  const seen = new Set(); let cur = id;
  while (cur != null) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + us); } cur = parent.get(cur); }
}
const show = (m, t) => { console.log(`\n== ${t} (total ${(total / 1000).toFixed(0)} ms)`); [...m].filter(([k]) => !FILTER || k.includes(FILTER)).sort((x, y) => y[1] - x[1]).slice(0, N).forEach(([k, v]) => console.log(`${(v / 1000).toFixed(0).padStart(7)} ms  ${k}`)); };
show(self, "SELF"); show(incl, "INCLUSIVE");
