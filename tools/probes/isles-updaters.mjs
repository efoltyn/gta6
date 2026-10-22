/* tools/probes/isles-updaters.mjs — what the frame spends on the Isles, by file.

   Every CBZ.updaters / CBZ.always entry is wrapped with a timer for N sim
   ticks on the archipelago world. (?profile=1 would name each entry's file,
   but it also starts core/profile.js's city benchmark: entries are named by
   their order and the head of their source instead; grep onUpdate(<order>.)
   Reports the total and the top sources, and the Gang City / prison state
   that should not be alive on the islands (city arena, city sea life,
   cars, peds far from every island).

     node tools/testbus/standalone.mjs tools/probes/isles-updaters.mjs [--ticks 300] [--top 40]

   Identification only: it always passes unless the page throws. */
export const meta = { world: "isles", query: "", fresh: true, dirties: true, timeoutMs: 20 * 60e3 };

export default async function (t) {
  const ticks = +t.arg("--ticks", 300) || 300, top = +t.arg("--top", 40) || 40;
  await t.step(120);                         // let the boot chores settle
  const r = await t.fn(`
    var lists = [["u", CBZ.updaters], ["a", CBZ.always]], wraps = [];
    lists.forEach(function (L) {
      L[1].forEach(function (u, i) {
        var f = u.fn, key = L[0] + ":" + u.order + " " + String(f).replace(/\\s+/g, " ").slice(0, 70);
        var rec = { key: key, ms: 0, order: u.order };
        u.fn = function (dt) { var t0 = performance.now(); try { return f(dt); } finally { rec.ms += performance.now() - t0; } };
        u._probeOrig = f; wraps.push(rec);
      });
    });
    window.__isleWraps = wraps;
    return wraps.length;
  `);
  t.log("wrapped", r);
  const T0 = Date.now();
  await t.step(ticks);
  const wall = Date.now() - T0;
  const out = await t.fn(`
    var W = window.__isleWraps, N = ${ticks};
    [CBZ.updaters, CBZ.always].forEach(function (L) { L.forEach(function (u) { if (u._probeOrig) { u.fn = u._probeOrig; delete u._probeOrig; } }); });
    var byFile = {};
    W.forEach(function (w) { var f = w.key.split(" ")[0]; byFile[f] = (byFile[f] || 0) + w.ms; });
    var total = W.reduce(function (s, w) { return s + w.ms; }, 0);
    var files = Object.keys(byFile).map(function (k) { return [k, +(byFile[k] / N).toFixed(3)]; }).sort(function (a, b) { return b[1] - a[1]; });
    var entries = W.slice().sort(function (a, b) { return b.ms - a.ms; }).map(function (w) { return [w.key, w.order, +(w.ms / N).toFixed(3)]; });
    var isl = CBZ.archipelago.isles().filter(function (I) { return !!I.arena; });
    var near = function (p) { return p && isl.some(function (I) { return Math.hypot(p.x - I.x, p.z - I.z) < I.R + 3000; }); };
    var cnt = function (L, f) { var n = 0, far = 0; (L || []).forEach(function (a) { if (!a || (f && !f(a))) return; n++; var p = a.pos || (a.group && a.group.position) || a.mesh && a.mesh.position; if (p && !near(p)) far++; }); return [n, far]; };
    return {
      totalMsPerTick: +(total / N).toFixed(3),
      files: files.slice(0, ${top}),
      entries: entries.slice(0, ${top}),
      cityArena: !!(CBZ.city && CBZ.city.arena), cityArenaVisible: !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root.visible),
      wildlife: cnt(CBZ.cityWildlife), peds: cnt(CBZ.cityPeds), cars: cnt(CBZ.cityCars), cops: cnt(CBZ.cityCops),
      aircraft: cnt(CBZ.cityAircraft), bots: cnt(CBZ.bots), npcs: cnt(CBZ.npcs),
      surv: !!(CBZ.surv && CBZ.surv.arena), active: CBZ.archipelago.state().active,
      street: CBZ.streetLife && CBZ.streetLife.sites ? CBZ.streetLife.sites() : null,
      prisonBuilt: !!(CBZ.prisonBuilt && CBZ.prisonBuilt()), prisonShown: !!(CBZ.prisonRoot && CBZ.prisonRoot.visible), guards: (CBZ.guards || []).length,
    };
  `);
  if (out && out.__err) return { ok: false, summary: "probe error: " + out.__err };
  t.log("ticks", ticks, "wall", wall, "ms");
  t.log("TOTAL updater+always ms/tick", out.totalMsPerTick);
  for (const f of out.files) t.log("file", f[1].toFixed(3).padStart(8), f[0]);
  for (const e of out.entries) t.log("entry", e[2].toFixed(3).padStart(8), "order", e[1], e[0]);
  t.log("state", JSON.stringify({ cityArena: out.cityArena, cityArenaVisible: out.cityArenaVisible, wildlife: out.wildlife, peds: out.peds, cars: out.cars, cops: out.cops, aircraft: out.aircraft, bots: out.bots, npcs: out.npcs, active: out.active, prisonBuilt: out.prisonBuilt, prisonShown: out.prisonShown, guards: out.guards, street: out.street }));
  const errs = t.errors();
  return { ok: true, summary: `isles ${out.totalMsPerTick} ms/tick over ${ticks} ticks; ${errs.length} page errors`, data: out };
}
