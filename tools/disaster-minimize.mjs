#!/usr/bin/env node
/* tools/disaster-minimize.mjs — HOW SMALL CAN THE DISASTER GAME BE?

   index.html loads 553 files because it is six games. This tool finds the
   subset Natural Disaster Survival actually needs, by the only method that
   cannot lie about a codebase this size: DROP FILES AND ASK THE GAME.

   The question is tools/disaster-check.mjs — the island boots, a match stands
   up, every named system is still on CBZ, and (in --fast mode) all eleven
   disasters reach their active phase without a throw. A drop that keeps that
   true is a drop the player cannot feel.

   THE SEARCH is delta debugging by BYTES, because bytes are what a phone pays:
   candidates are grouped so each trial group is a similar weight, a group that
   passes is dropped whole, and a group that fails is split in half and retried.
   One needed file therefore costs log2(group) trials, not one trial per file.
   Trials run in parallel, each in its own browser against its own candidate
   page, and because a parallel trial is judged against a base that may have
   moved underneath it, every accepted round is re-verified as a whole — and
   bisected if the whole fails.

     node tools/disaster-minimize.mjs --jobs 3
     node tools/disaster-minimize.mjs --jobs 3 --resume     # keep going
     node tools/disaster-minimize.mjs --verify              # full check, no search

   It writes tools/disaster-slice.json as it goes, so an interrupted run keeps
   everything it proved. */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPage } from "./build-disaster-page.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };

const JOBS = +arg("--jobs", "3");
const BOTS = arg("--bots", "12");
const MANIFEST = path.join(ROOT, "tools/disaster-slice.json");
const INDEX = readFileSync(path.join(ROOT, "index.html"), "utf8");
const ORDER = [...INDEX.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);

const sizeOf = (p) => { try { return statSync(path.join(ROOT, p)).size; } catch (_) { return 0; } };
const bytes = (list) => list.reduce((a, p) => a + sizeOf(p), 0);
const mb = (n) => (n / 1048576).toFixed(2) + " MB";

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
let drop = new Set(manifest.drop || []);
/* PROVEN NEEDED — files a trial already showed the game cannot lose. Kept in
   the manifest so a --resume run never re-tests them. */
const needed = new Set(manifest.needed || []);

/* PINNED — files the search may NOT drop, whatever the oracle says.

   This list exists because the search worked exactly as asked and the question
   was too small. Left alone it took the build to 51 files, and the reason is
   worth writing down: a test can only defend what it looks at. It asserted the
   island boots, all eleven disasters run and every censused system is on CBZ —
   so it happily dropped systems/physics.js (the census had `stepSim`, which
   core/loop.js publishes), systems/survivalhud.js (the census had the #survBars
   DOM element, which is in the HTML either way), systems/bootprogress.js (the
   loading meter — nothing simulated needs it), core/batch.js (a frame-rate
   system: nothing FAILS without it, the phone just melts), and every
   city/facades/*.js style, leaving the island's town undressed.

   Some of those holes are now real census rows (facadeStyles, CBZ.collide,
   CBZ.survHud, CBZ.bootStep…). But the general case cannot be tested away: a
   headless run has no frame budget, no thumbs and no eyes, so anything whose
   whole job is performance, input or presentation has to be declared. That is
   what this list is. Every entry is here because a player would notice, not
   because a test would.

   Adding to it costs bytes; removing from it means proving the loss another
   way. Say which when you edit it. */
const pin = new Set(manifest.pin || []);
for (const p of pin) { drop.delete(p); needed.delete(p); }

function save() {
  manifest.drop = ORDER.filter((p) => drop.has(p) && !pin.has(p));
  manifest.pin = [...pin].sort();
  manifest.needed = [...needed].sort();
  manifest.keptBytes = bytes(ORDER.filter((p) => !drop.has(p)));
  manifest.droppedBytes = bytes(manifest.drop);
  manifest.updatedAt = new Date().toISOString();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
}

/* ---- one trial: write a candidate page, ask the oracle ------------------- */
let trials = 0;
function trial(dropSet, slot, mode) {
  const rel = `disaster.candidate-${slot}.html`;
  const { html } = buildPage(INDEX, dropSet);
  writeFileSync(path.join(ROOT, rel), html);
  return new Promise((resolve) => {
    const args = ["tools/disaster-check.mjs", "--url", rel, "--bots", BOTS, "--json", mode];
    const p = spawn("node", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    /* A trial that hangs is a trial that FAILED — the oracle already gives a
       broken page a short fuse, so anything past this is a wedged browser, and
       waiting on it is how a search loses an hour. */
    const kill = setTimeout(() => { try { p.kill("SIGKILL"); } catch (_) {} }, +arg("--trial-timeout", "420000"));
    p.on("close", () => {
      clearTimeout(kill);
      trials++;
      let ok = false, fails = [];
      try { const r = JSON.parse(out); ok = r.ok; fails = r.fails || []; } catch (_) { fails = ["oracle produced no JSON"]; }
      try { unlinkSync(path.join(ROOT, rel)); } catch (_) {}
      resolve({ ok, fails });
    });
  });
}

/* ---- grouping: equal-weight buckets, biggest files first ----------------- */
function bucket(files, n) {
  const sorted = [...files].sort((a, b) => sizeOf(b) - sizeOf(a));
  const groups = Array.from({ length: n }, () => []);
  const weight = new Array(n).fill(0);
  for (const f of sorted) {                       // greedy longest-processing-time
    let i = 0; for (let k = 1; k < n; k++) if (weight[k] < weight[i]) i = k;
    groups[i].push(f); weight[i] += sizeOf(f);
  }
  return groups.filter((g) => g.length);
}

if (has("--verify")) {
  const { html } = buildPage(INDEX, drop);
  writeFileSync(path.join(ROOT, "disaster.html"), html);
  const r = await trial(drop, "verify", "--fast");
  console.log(r.ok ? "VERIFY ok" : "VERIFY FAILED:\n  " + r.fails.join("\n  "));
  process.exit(r.ok ? 0 : 1);
}

/* REPAIR — put files back until the set passes again.

   Needed when the ORACLE gets stricter between runs (it did: it now fails on a
   file that throws during page load, which it used to throw away), so a
   manifest proved under the old question can be wrong under the new one. A
   broken base is worth finding before the search starts, because every trial
   measured against it fails and the search learns nothing.

   Bisection over the dropped set: put half back, ask again, and keep the half
   that fixes it. log2(n) trials to find the file, not n. */
async function repair(mode) {
  let r = await trial(drop, "base", mode);
  let rounds = 0;
  while (!r.ok && drop.size && rounds++ < 24) {
    console.log(`  base fails: ${r.fails.join("; ")}`);
    const list = [...drop];
    let lo = [], hi = list;
    while (hi.length > 1) {
      const half = Math.ceil(hi.length / 2);
      const a = hi.slice(0, half), b = hi.slice(half);
      const t = await trial(new Set([...lo, ...a]), "r", mode);
      if (t.ok) { lo = lo.concat(a); hi = b; } else hi = a;
    }
    for (const f of hi) { drop.delete(f); needed.add(f); console.log("  restored " + f); }
    save();
    r = await trial(drop, "base", mode);
  }
  return r;
}

// ---- the search ------------------------------------------------------------
const t0 = Date.now();
{
  const r = await repair("--quick");
  console.log(r.ok ? "base ok" : "base STILL failing: " + r.fails.join("; "));
}
let candidates = ORDER.filter((p) => !drop.has(p) && !needed.has(p) && !pin.has(p));
console.log(`start: ${ORDER.length - drop.size} scripts, ${mb(bytes(ORDER.filter((p) => !drop.has(p))))} · ` +
  `${candidates.length} untested candidates · ${JOBS} jobs`);

// The queue holds GROUPS to try. Seed it with equal-weight buckets sized so a
// first pass is cheap: 24 groups over the candidate set.
let queue = bucket(candidates, Math.max(JOBS * 2, Math.ceil(candidates.length / 18)));
let accepted = 0;

while (queue.length) {
  const batch = queue.splice(0, JOBS);
  const base = new Set(drop);
  const results = await Promise.all(batch.map((g, i) => {
    const d = new Set(base); for (const f of g) d.add(f);
    return trial(d, i, "--quick");
  }));

  const won = [];
  for (let i = 0; i < batch.length; i++) {
    const g = batch[i];
    if (results[i].ok) { won.push(g); continue; }
    if (g.length === 1) { needed.add(g[0]); continue; }
    const half = Math.ceil(g.length / 2);
    queue.unshift(g.slice(0, half), g.slice(half));      // depth-first: finish a group before starting new ones
  }

  if (won.length) {
    const merged = new Set(drop);
    for (const g of won) for (const f of g) merged.add(f);
    // Every trial in this batch was judged against the SAME base, so their
    // union is not something any trial actually proved. Verify it as a whole;
    // if it fails, fall back to accepting one group at a time.
    let ok = won.length === 1;
    if (!ok) ok = (await trial(merged, "u", "--quick")).ok;
    if (ok) { drop = merged; accepted += won.length; }
    else {
      for (const g of won) {
        const d = new Set(drop); for (const f of g) d.add(f);
        if ((await trial(d, "s", "--quick")).ok) { drop = d; accepted++; }
        else if (g.length === 1) needed.add(g[0]);
        else { const h = Math.ceil(g.length / 2); queue.unshift(g.slice(0, h), g.slice(h)); }
      }
    }
    save();
  }
  const kept = ORDER.filter((p) => !drop.has(p));
  console.log(`  [${((Date.now() - t0) / 60000).toFixed(1)}m ${trials} trials] ` +
    `kept ${kept.length} / ${mb(bytes(kept))} · queue ${queue.length} · needed ${needed.size}`);
}

save();
const kept = ORDER.filter((p) => !drop.has(p));
console.log(`\nsearch done: ${kept.length} scripts, ${mb(bytes(kept))} ` +
  `(from ${ORDER.length}, ${mb(bytes(ORDER))}) in ${trials} trials`);

// ---- the real gate: every disaster, end to end -----------------------------
// --quick never ran the volcano; anything it let go that the full roster needs
// gets bisected back by the same repair pass the base check uses.
console.log("verifying the full roster…");
const r = await repair("--fast");
const { html } = buildPage(INDEX, drop);
writeFileSync(path.join(ROOT, "disaster.html"), html);
save();
const final = ORDER.filter((p) => !drop.has(p));
console.log(`\nFINAL: ${final.length} scripts, ${mb(bytes(final))} — full roster ${r.ok ? "ok" : "STILL FAILING"}`);
console.log(`wrote disaster.html and tools/disaster-slice.json (${trials} trials, ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
