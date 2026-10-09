/* tools/probes/streetlife.mjs — THE STREET IS FULL, IN GROUPS, IN THE REAL GAME.

   city/streetlife.js on a booted city: a few seconds of sim after the boot,
   then the street must have people (rows on the crowd store, drawn by
   crowdgpu), most of them in groups, the GPU crowd baked with the street's
   clips (talk / phone / smoke), at least one city site built, and no page
   errors from the street.

     testbus:  node tools/testbus/submit.mjs --world city --probe tools/probes/streetlife.mjs */
export const meta = { world: "city", fresh: false, dirties: false, timeoutMs: 4 * 60e3 };

export default async function (t) {
  await t.step(360);
  const a = await t.fn(`
    var SL = CBZ.streetLife, G = CBZ.crowdGPU;
    if (!SL) return { err: "no CBZ.streetLife" };
    var au = SL.audit(), ga = G && G.audit ? G.audit() : null;
    return { audit: au, sites: SL.sites(), gpu: ga ? { ok: ga.ok, why: ga.why, lod1: ga.lod1, lod2: ga.lod2, lod3: ga.lod3 } : null,
      clips: G && G.clips ? G.clips() : null, hour: CBZ.cityHour ? CBZ.cityHour() : null,
      player: CBZ.player && CBZ.player.pos ? [Math.round(CBZ.player.pos.x), Math.round(CBZ.player.pos.z)] : null };
  `);
  if (!a || a.err || a.__err) return { ok: false, summary: "streetlife: " + JSON.stringify(a) };
  const au = a.audit;
  t.log("street", JSON.stringify({ hour: a.hour, player: a.player, target: au.target, rows: au.rows, grouped: au.grouped, kinds: au.kinds, rigs: au.rigs, drawn: au.drawn, stepMs: au.stepMs }));
  t.log("sites", JSON.stringify(a.sites), "gpu", JSON.stringify(a.gpu));
  const errs = (t.errors ? await t.errors() : []) || [];
  const mine = errs.filter((e) => /streetlife|crowdstore|crowdgpu/.test(String(e)));
  const fails = [];
  if (!(a.sites && a.sites.length)) fails.push("no city site built");
  if (!(au.rows > 0) && au.target > 0) fails.push(`street empty (target ${au.target})`);
  if (au.rows > 20 && au.grouped < 0.55) fails.push(`only ${au.grouped} in groups`);
  if (a.clips && a.clips.indexOf("talkWalk") < 0) fails.push("crowdgpu has no street clips");
  if (mine.length) fails.push("errors: " + mine.slice(0, 3).join(" | "));
  return { ok: !fails.length, summary: fails.length ? fails.join("; ") : `${au.rows} people on the street (target ${au.target}), ${Math.round(au.grouped * 100)}% in groups, ${au.rigs} real rigs, ${au.stepMs} ms` };
}
