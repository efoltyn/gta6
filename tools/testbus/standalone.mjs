/* tools/testbus/standalone.mjs — run ONE probe in its own Chrome, the old way.

   The ported checks (tools/president-people-check.mjs etc.) are three-line
   wrappers over this, so `node tools/president-people-check.mjs` still works
   for the owner or a one-off, and the probe body exists exactly once (in
   tools/probes/). Builders should submit to the bus instead: this path pays
   a full Chrome + world boot for one check.

     node tools/testbus/standalone.mjs tools/probes/x.mjs [--seed N] [--world W] [probe args]
   Exit 0 pass, 1 fail, 2 error. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_ROOT } from "./lib.mjs";
import { launchChrome, serve } from "./browser.mjs";
import { worldKey, bootWorld, loadProbe, runProbe } from "./worlds.mjs";

export async function runStandalone(probeFile, args = []) {
  const file = probeFile instanceof URL ? fileURLToPath(probeFile) : path.resolve(probeFile);
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const t0 = Date.now();
  let browser = null, srv = null, code = 2;
  const done = async () => { try { srv && srv.close(); } catch (_) {} if (browser) await browser.close(); };
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await done(); process.exit(130); });
  try {
    const probe = await loadProbe(file);
    const world = arg("--world") || probe.meta.world || "city";
    const key = worldKey(world, arg("--seed") || probe.meta.seed, arg("--query") || "");
    srv = await serve(TOOL_ROOT);
    browser = await launchChrome();
    const pg = await browser.newPage();
    const b = await bootWorld(pg, srv.origin, key);
    console.error(`[standalone] ${key} booted in ${(b.bootMs / 1000).toFixed(1)} s`);
    const r = await runProbe(pg, probe, { args, seed: key.split("|")[1], world });
    for (const l of r.log) console.log(l);
    console.log(r.summary);
    console.error(`[standalone] probe ${r.status} in ${(r.ms / 1000).toFixed(1)} s; total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    code = r.status === "pass" ? 0 : r.status === "fail" ? 1 : 2;
  } catch (e) {
    console.error("ERROR " + (e && e.message || e));
    code = 2;
  }
  await done();
  await new Promise((r) => process.stdout.write("", r));
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [f, ...rest] = process.argv.slice(2);
  if (!f) { console.error("usage: standalone.mjs <probe> [--seed N] [--world W] [args]"); process.exit(2); }
  await runStandalone(f, rest);
}
