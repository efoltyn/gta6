#!/usr/bin/env node
/* tools/memscope-check.mjs — node-only check of memscope's heap-snapshot parser and
   dominator/retained-size math: 60 random graphs, streamed in 7-char chunks,
   retained sizes compared with brute force (remove node, count what becomes
   unreachable). No browser, ~1 s.   node tools/memscope-check.mjs */
process.env.MEMSCOPE_LIB = "1";
const { analyze, SnapParser } = await import("./memscope.mjs");
function rnd(seed){ return () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296; }
let fails = 0;
for (let trial = 0; trial < 60; trial++) {
  const r = rnd(trial + 1), N = 5 + Math.floor(r() * 60);
  // node 0 synthetic root; node 1 Window; node 2 holder (__msRoots); names
  const strings = ["", "(root)", "Window", "Object", "__msRoots", "a", "b", "own:x#0", "CBZ.k", "Foo"];
  const adj = [...Array(N)].map(() => []);
  adj[0].push([2, 5, 1]); // root -> Window
  adj[1].push([2, 4, 2]); // Window.__msRoots -> holder
  for (let i = 3; i < N; i++) { const p = Math.floor(r() * i); adj[p === 2 ? 1 : p].push([2, 5, i]); }
  for (let k = 0; k < N; k++) { const a = Math.floor(r() * N), b = 1 + Math.floor(r() * (N - 1)); if (a !== 2 && b !== 2) adj[a].push([r() < 0.2 ? 6 : 2, 6, b]); }
  adj[2].push([2, 7, 3 + Math.floor(r() * (N - 3))]); adj[2].push([2, 8, 3 + Math.floor(r() * (N - 3))]);
  const sizes = [...Array(N)].map((_, i) => i < 3 ? 0 : 1 + Math.floor(r() * 100));
  const nodes = [], edges = [];
  for (let i = 0; i < N; i++) { nodes.push(i === 0 ? 9 : 3, i === 0 ? 1 : i === 1 ? 2 : i === 2 ? 3 : 9, i * 2 + 1, sizes[i], adj[i].length, 0, 0);
    for (const [t, n, to] of adj[i]) edges.push(t, n, to * 7); }
  const meta = { node_fields: ["type","name","id","self_size","edge_count","trace_node_id","detachedness"],
    node_types: [["hidden","array","string","object","code","closure","regexp","number","native","synthetic"]],
    edge_fields: ["type","name_or_index","to_node"], edge_types: [["context","element","property","internal","hidden","shortcut","weak"]] };
  const json = JSON.stringify({ snapshot: { meta, node_count: N, edge_count: edges.length / 3 }, nodes, edges, trace_function_infos: [], trace_tree: [], samples: [], locations: [], strings });
  const p = new SnapParser(); for (let i = 0; i < json.length; i += 7) p.push(json.slice(i, i + 7)); p.jsonMB = 0;
  const a = analyze(p, {});
  // brute force retained of holder targets
  const reach = (skip) => { const s = new Set([0]), q = [0]; while (q.length) { const n = q.pop(); for (const [t, , to] of adj[n]) { if (t === 6 || to === skip || s.has(to)) continue; s.add(to); q.push(to); } } return s; };
  const all = reach(-1);
  const ret = (v) => { if (!all.has(v)) return 0; const s = reach(v); let x = 0; for (const n of all) if (!s.has(n)) x += sizes[n]; return x; };
  const exp = {}; for (const [, n, to] of adj[2]) { const k = strings[n]; const g = k.replace(/#\d+$/, ""); exp[g] = (exp[g] || 0) + ret(to); }
  const got = {}; for (const o of a.owners) got["own:" + o.owner] = o.bytes; for (const h of a.holders) got[h.holder] = h.bytes;
  for (const k in exp) { const g = got[k] ?? 0; if (Math.abs(g - exp[k]) > 1) { fails++; console.log("trial", trial, k, "exp", exp[k], "got", g); } }
}
console.log(fails ? "FAIL " + fails : "dominators OK on 60 random graphs"); process.exit(fails ? 1 : 0);
