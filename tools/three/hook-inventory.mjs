#!/usr/bin/env node
/* tools/three/hook-inventory.mjs — every custom shader in the game, one row each.

     node tools/three/hook-inventory.mjs            # markdown table to stdout
     node tools/three/hook-inventory.mjs --json     # the rows as JSON

   A ROW is one `onBeforeCompile` hook or one `new THREE.ShaderMaterial(` /
   `RawShaderMaterial(` in src/ or games/ (the vendor bundle excluded):
   file:line, kind, the built-in material it patches (nearest `new
   THREE.Mesh*Material` above it, for a hook), the chunks it edits, and flags:

     vUv     reads/writes vUv (r187: an alias of the first map's uv, tools/three/entry.js)
     srgb    calls sRGBTransferEOTF/OETF (check the sampler: an sRGB-tagged texture
             arrives DECODED in r187, in every shader)
     sampler declares its own sampler2D (same check)
     vtx     moves vertices (transformed / gl_Position / <begin_vertex>)
     lights  edits lighting chunks (r187 light code is not r128's)
     fog     touches fog (vFogDepth, fog chunks)

   It is a map for the people porting these to TSL node materials (the WebGPU
   path and the meshlet pipeline accept NO onBeforeCompile and NO
   ShaderMaterial): it says where every one is and what it leans on. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function walk(d, out) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (f === "vendor" || f === "node_modules") continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(f)) out.push(p);
  }
  return out;
}
const files = walk(path.join(ROOT, "src"), []).concat(walk(path.join(ROOT, "games"), []));
const rows = [];
for (const p of files) {
  const src = readFileSync(p, "utf8");
  const lines = src.split("\n");
  const hits = [];
  lines.forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/\bonBeforeCompile\s*[:=](?!=)/.test(l)) hits.push({ i, kind: "hook" });
    else if (/new\s+[\w.]*\bShaderMaterial\s*\(/.test(l)) hits.push({ i, kind: "ShaderMaterial" });
    else if (/new\s+[\w.]*\bRawShaderMaterial\s*\(/.test(l)) hits.push({ i, kind: "RawShaderMaterial" });
  });
  hits.forEach((h, k) => {
    const end = Math.min(lines.length, k + 1 < hits.length ? Math.max(hits[k + 1].i, h.i + 12) : h.i + 120, h.i + 160);
    const body = lines.slice(h.i, end).join("\n");
    let base = "";
    if (h.kind === "hook") {
      for (let j = h.i; j >= Math.max(0, h.i - 60); j--) {
        const m = /new\s+(?:THREE|T)\.(Mesh\w*Material|PointsMaterial|SpriteMaterial|LineBasicMaterial|ShadowMaterial)\b/.exec(lines[j]);
        if (m) { base = m[1].replace(/^Mesh|Material$/g, ""); break; }
      }
    }
    const chunks = [...new Set([...body.matchAll(/#include <(\w+)>/g)].map((m) => m[1]))];
    const flags = [];
    if (/\bvUv\b/.test(body)) flags.push("vUv");
    if (/sRGBTransfer(EOTF|OETF)|LinearTosRGB|sRGBToLinear/.test(body)) flags.push("srgb");
    if (/sampler2D|samplerCube/.test(body)) flags.push("sampler");
    if (/<begin_vertex>|\btransformed\s*[+\-*/]?=|gl_Position\s*=/.test(body)) flags.push("vtx");
    if (/lights_|RE_Direct|directLight|irradiance|reflectedLight/.test(body)) flags.push("lights");
    if (/vFogDepth|fog_/.test(body)) flags.push("fog");
    rows.push({ file: path.relative(ROOT, p), line: h.i + 1, kind: h.kind, base, chunks, flags });
  });
}
if (process.argv.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
const by = (k) => rows.filter((r) => r.kind === k).length;
console.log(`${rows.length} custom shaders: ${by("hook")} onBeforeCompile hooks, ${by("ShaderMaterial")} ShaderMaterial, ${by("RawShaderMaterial")} RawShaderMaterial, in ${new Set(rows.map((r) => r.file)).size} files\n`);
console.log("| file:line | kind | patches | chunks edited / included | flags |");
console.log("|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.file}:${r.line} | ${r.kind === "hook" ? "hook" : r.kind.replace("ShaderMaterial", "SM")} | ${r.base || ""} | ${r.chunks.slice(0, 8).join(" ")}${r.chunks.length > 8 ? " +" + (r.chunks.length - 8) : ""} | ${r.flags.join(" ")} |`);
