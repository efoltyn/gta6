#!/usr/bin/env node
/* tools/facade-equiv.mjs — is src/city/facade_openings.js still the ORIGINAL
   function, answer for answer, on real buildings?

   Writes an in-page check that builds FO from each source given (a git ref or
   a file), replays every captured call (tools/preload/focapture.js: every
   FO.resolveCoplanar and FO.scan call of the boot, plus any captured after),
   and compares each version's output with the first one's: resolveCoplanar's
   return value and every box's 6 bounds, scan's openings (all fields).

     node tools/facade-equiv.mjs --out /tmp/fe.js 0da9d239 b1b78465 WORKTREE
     node tools/speed.mjs --ask eval --eval-file /tmp/fe.js --preload tools/preload/focapture.js

   WORKTREE = the file on disk. The first source is the reference. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE = "src/city/facade_openings.js";
const argv = process.argv.slice(2);
const oi = argv.indexOf("--out"); const out = oi >= 0 ? argv.splice(oi, 2)[1] : "/tmp/facade-equiv.js";
const refs = argv.length ? argv : ["HEAD", "WORKTREE"];
const srcs = refs.map((r) => ({ name: r, src: r === "WORKTREE" ? fs.readFileSync(path.join(ROOT, FILE), "utf8") : execFileSync("git", ["show", `${r}:${FILE}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 }) }));
const js = `(function () {
  var caps = window.__foCaps; if (!caps) return "no captures: boot with --preload tools/preload/focapture.js";
  function make(src) {
    var stub = { CBZ: { FACADE_F: window.CBZ.FACADE_F, hash01: window.CBZ.hash01 } };
    return new Function("window", "THREE", src + "\\n;return window.CBZ.facadeOpenings || null;")(stub, window.THREE);
  }
  var V = ${JSON.stringify(srcs.map((s) => s.name))}.map(function (n, i) { return { name: n, FO: make([${srcs.map((s) => JSON.stringify(s.src)).join(",")}][i]), ms: 0, msScan: 0, diff: 0, diffScan: 0 }; });
  var boxes = 0, rcalls = caps.resolve.length, scalls = caps.scan.length;
  caps.resolve.forEach(function (K) {
    boxes += K.recs.length;
    var ref = null, refRet = null;
    V.forEach(function (v, vi) {
      var r = K.recs.map(function (x) { return x.slice(); }), w = K.walls ? K.walls.map(function (x) { return x.slice(); }) : null;
      var t = performance.now(), ret = v.FO.resolveCoplanar(r, w, K.tol); v.ms += performance.now() - t;
      // the fixed boxes reused by a second call (a stale per-call mark would show here)
      var r2 = K.recs.map(function (x) { return x.slice(); }), ret2 = v.FO.resolveCoplanar(r2, w, K.tol);
      if (vi === 0) { ref = r; refRet = ret; return; }
      var bad = ret !== refRet || ret2 !== refRet;
      for (var i = 0; i < r.length && !bad; i++) for (var k = 0; k < 6; k++) if (r[i][k] !== ref[i][k] || r2[i][k] !== ref[i][k]) { bad = true; break; }
      if (bad) v.diff++;
    });
  });
  caps.scan.forEach(function (K) {
    var ref = null;
    V.forEach(function (v, vi) {
      var t = performance.now(), o = JSON.stringify(v.FO.scan(K.recs.map(function (x) { return x.slice(); }), K.o)); v.msScan += performance.now() - t;
      if (vi === 0) { ref = o; return; }
      if (o !== ref) v.diffScan++;
    });
  });
  return { resolveCalls: rcalls, boxes: boxes, scanCalls: scalls, versions: V.map(function (v) { return { src: v.name, resolveMs: Math.round(v.ms), scanMs: Math.round(v.msScan), resolveDiffs: v.diff, scanDiffs: v.diffScan }; }) };
})()`;
fs.writeFileSync(out, js);
console.log(`wrote ${out}: ${srcs.map((s) => s.name).join(" vs ")} (reference ${srcs[0].name})`);
