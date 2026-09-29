/* tools/lib/city-slice.mjs — boot ONE piece of Gang City from any tool.

   A city slice (src/core/slice.js) is a named place or an x,z,r circle of
   Gang City booted as its own world: only what can be seen from inside it is
   built, so a capture or a probe pays a jail-sized boot instead of the whole
   continent. Three ways in:

     ba presets     urlParams: withSlice({ mode: "city", seed: 90210 })
                    then  CBZ_SLICE=kingsport-downtown ba <preset>
                    (no CBZ_SLICE = the whole city, exactly as before)
     cdp probes     const info = await bootSlice(rig, "estate")
     anything       sliceQuery("redhollow") -> "mode=city&slice=redhollow"

   The names live in ONE place, CBZ.SLICES in src/core/slice.js; SLICES here
   is read from that file, never copied. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* { name: { x, z, r, label } } parsed out of src/core/slice.js */
export const SLICES = (() => {
  const src = readFileSync(path.join(ROOT, "src/core/slice.js"), "utf8");
  const block = src.slice(src.indexOf("const SLICES = {"), src.indexOf("CBZ.SLICES = SLICES"));
  const out = {};
  for (const m of block.matchAll(/"([a-z0-9-]+)":\s*\{\s*x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+),\s*r:\s*([\d.]+),\s*label:\s*"([^"]*)"/g)) {
    out[m[1]] = { x: +m[2], z: +m[3], r: +m[4], label: m[5] };
  }
  return out;
})();

/* a name, or "x,z,r"; throws on anything else so a typo never boots the whole city silently */
export function checkSlice(name) {
  if (!name) return null;
  if (SLICES[name]) return name;
  const p = String(name).split(",").map(Number);
  if (p.length === 3 && p.every(Number.isFinite) && p[2] > 0) return p.join(",");
  throw new Error(`unknown city slice "${name}" — known: ${Object.keys(SLICES).join(", ")} or x,z,r`);
}

/* url params for a preset: adds slice=<CBZ_SLICE or the given name> when set */
export function withSlice(params = {}, name = process.env.CBZ_SLICE) {
  const s = checkSlice(name);
  return s ? { ...params, mode: "city", slice: s } : { ...params };
}

export function sliceQuery(name, extra = "") {
  const s = checkSlice(name);
  return `mode=city&slice=${encodeURIComponent(s)}` + (extra ? "&" + extra.replace(/^[?&]/, "") : "");
}

/* `--slice <v>` off an argv (tools that forward it) */
export function sliceArg(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--slice");
  return i >= 0 && argv[i + 1] ? checkSlice(argv[i + 1]) : null;
}

/* Boot a slice on a tools/lib/cdp.mjs rig and start the run. Resolves with
   what the slice built: { ms, plan: CBZ.slicePlanResult, prune:
   CBZ.slicePruneResult, player: {x,y,z} }. */
export async function bootSlice(rig, name, { seed = 90210, extra = "", timeoutMs = 300000 } = {}) {
  await rig.open("index.html", sliceQuery(name, `seed=${seed}` + (extra ? "&" + extra : "")));
  if (!await rig.wait("window.CBZ && CBZ.bootComplete && CBZ.startRun && document.readyState === 'complete'", timeoutMs)) {
    throw new Error("slice page never booted");
  }
  const r = await rig.evl(`(function(){ var t0 = performance.now(); CBZ.startRun();
    var p = CBZ.player && CBZ.player.pos;
    return { ms: Math.round(performance.now() - t0), plan: CBZ.slicePlanResult || null, prune: CBZ.slicePruneResult || null,
      player: p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) } : null, state: CBZ.game && CBZ.game.state }; })()`);
  return r;
}
