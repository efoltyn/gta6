/* tools/probes/lab.mjs — run a LAB kit as a testbus probe and return its
   numbers (no pictures). The kit and its params are the probe's args:

     node tools/testbus/submit.mjs --probe "tools/probes/lab.mjs --kit person-chair"
     node tools/testbus/submit.mjs --probe "tools/probes/lab.mjs --kit standoff --params role=cop&dist=4"
     node tools/testbus/standalone.mjs tools/probes/lab.mjs --kit car-chair       (its own Chrome)

   --seconds S runs S sim seconds instead of the kit's duration. The verdict
   is the kit's own probe() ({ ok, summary, data }); the event timeline goes
   to the log. A boot failure (a script that threw at load, a missing
   ingredient) is an ERROR with the lab's own message. */
const kitOf = (args) => { const i = args.indexOf("--kit"); return i >= 0 ? args[i + 1] : "empty"; };
const paramsOf = (args) => { const i = args.indexOf("--params"); return i >= 0 ? args[i + 1] : ""; };
export const meta = {
  world: "lab", fresh: true, dirties: true, timeoutMs: 120000,
  // the page the bus boots: ?kit=<kit>&<params>
  query: (args) => ["kit=" + encodeURIComponent(kitOf(args)), paramsOf(args)].filter(Boolean).join("&"),
};
export default async function (t) {
  const boot = await t.evl("__lab.boot");
  if (!boot || boot.error) throw new Error("lab kit " + kitOf(t.args) + " did not boot: " + (boot ? boot.error : "no __lab.boot"));
  t.log(`boot ${boot.ms} ms, ${boot.scripts} scripts (${boot.traced} traced) of ${boot.indexCount}` + (boot.loadErrors.length ? `, load errors: ${boot.loadErrors.slice(0, 3).join(" | ")}` : ""));
  const secs = t.arg("--seconds", null);
  await t.evl(`__lab.runTo(${secs != null ? +secs : "(__lab.kit && __lab.kit.duration) || 5"})`);
  const r = await t.evl("__lab.probe()");
  for (const e of (r.events || []).slice(0, 80)) t.log(`${e.t.toFixed(2).padStart(6)} s  ${e.who}: ${e.what}`);
  if (r.errors && r.errors.length) t.log("runtime errors: " + r.errors.slice(0, 4).join(" | "));
  return { ok: !!r.ok, summary: `${kitOf(t.args)}: ${r.summary}`, data: { probe: r.data, boot: { ms: boot.ms, scripts: boot.scripts } } };
}
