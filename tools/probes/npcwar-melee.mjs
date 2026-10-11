/* tools/probes/npcwar-melee.mjs — DO NPC WAR'S BARE-HANDED ARMIES REALLY FIGHT?

   Two armies with fists on the dunes. games/battle.html never loads the
   "verbs" studio pack itself: combat_iq's IQ.melee asks for it the first
   time a man squares up (systems/combat_iq.js meleeLayer), and from then on
   every exchange is systems/melee.js's fighter throwing real blows on the
   rig (systems/verbs_strike.js). This reads the answer off the page: the
   pack arrived, the fighters threw and landed real strikes, and men went
   down because of them.

   testbus: node tools/testbus/submit.mjs --world battle --query "rw=fists&bw=fists&red=12&blue=12" --probe tools/probes/npcwar-melee.mjs */
export const meta = { world: "battle", fresh: true, dirties: true, timeoutMs: 12 * 60e3 };

export default async function (t) {
  await t.evl("__battle.freeze()");
  // the armies close; the first man to square up asks for the verbs pack,
  // which arrives over the network in wall time, so step and wait in turns
  let loaded = false;
  for (let i = 0; i < 60 && !loaded; i++) {
    await t.evl("__battle.advance(0.5)");
    loaded = !!(await t.evl("!!(window.CBZ && CBZ.melee && CBZ.melee.bout && CBZ.verbs && CBZ.verbs.strike)"));
    if (!loaded) await t.sleep(250);
  }
  if (!loaded) return { ok: false, summary: "the verbs pack never arrived (IQ.melee's lazy need)" };
  const r = await t.fn(`
    var a0 = CBZ.melee.audit(), b0 = __battle.audit();
    for (var i = 0; i < 80; i++) __battle.advance(0.5);
    var a1 = CBZ.melee.audit(), b1 = __battle.audit();
    return { a0: a0, a1: a1, alive0: b0.alive, alive1: b1.alive, over: b1.over, winner: b1.winner };`, 600000);
  t.log(JSON.stringify(r));
  if (!r || r.__err) return { ok: false, summary: "probe threw: " + (r && r.__err) };
  const thrown = r.a1.thrown - r.a0.thrown, landed = r.a1.landed - r.a0.landed;
  const errs = t.errors().filter((e) => /melee|verbs_strike|meleeposes|combat_iq/.test(String(e)));
  const ok = r.a1.fighters > 4 && thrown > 30 && landed > 10 && errs.length === 0;
  return { ok, summary: `${r.a1.fighters} fighters, ${thrown} blows thrown, ${landed} landed (${r.a1.blocked} on the guard, ${r.a1.kos} KOs, ${r.a1.quits} gave up), alive ${JSON.stringify(r.alive0)} -> ${JSON.stringify(r.alive1)}${errs.length ? ", ERRORS " + errs.slice(0, 2).join(" | ") : ""}`, data: r };
}
