#!/usr/bin/env node
/* tools/lab/eval.mjs — boot a kit and evaluate JS in it: the lab's REPL door.

     node tools/lab/eval.mjs --kit standoff --params 'dist=3' --at 1.2 \
          --js 'const t = __lab.W.get("target"); return t.state()'

   --at S runs the sim to S seconds first (default 0). --js is a function
   body (W = __lab.W, CBZ, THREE in scope); its return value prints as JSON.
   Reuses the --keep Chrome like run.mjs does. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import { launchChrome, attachChrome, serve } from "../testbus/browser.mjs";
import { buildManifest } from "./deps.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const a = process.argv.slice(2);
const arg = (k, d) => { const i = a.indexOf(k); return i >= 0 && a[i + 1] != null ? a[i + 1] : d; };
buildManifest();
const KEEP = path.join(os.tmpdir(), "cbz-lab-chrome.json");
let B = null, own = false;
if (existsSync(KEEP)) { try { const s = JSON.parse(readFileSync(KEEP, "utf8")); process.kill(s.pid, 0); B = await attachChrome(s.dbg, s.pid); } catch (_) { B = null; } }
if (!B) { B = await launchChrome(); own = true; }
const srv = await serve(ROOT);
const pg = await B.newPage();
try {
  const u = new URL("lab.html", srv.origin);
  u.searchParams.set("kit", arg("--kit", "empty"));
  for (const [k, v] of new URLSearchParams(arg("--params", ""))) u.searchParams.set(k, v);
  await pg.send("Page.navigate", { url: u.href });
  for (let i = 0; i < 600; i++) { if (await pg.evl("!!(window.__lab && __lab.boot)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 50)); }
  const ok = await pg.evl("__lab.ready");
  if (!ok) { console.log(JSON.stringify(await pg.evl("__lab.boot"), null, 1)); process.exit(2); }
  await pg.evl(`__lab.runTo(${+arg("--at", 0)})`);
  const body = arg("--js", "return __lab.state()");
  const r = await pg.evl(`(function(){ const W = __lab.W; ${body} })()`);
  console.log(JSON.stringify(r, null, 1));
  if (pg.errors.length) console.log("page errors:", pg.errors.slice(0, 6));
} finally { await pg.closeTarget(); srv.close(); if (own) await B.close(); else await B.close().catch(() => {}); }
