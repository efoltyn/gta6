/* tools/probes/speedway.mjs — the Bullring on foot, in the real city.
   The banking and the stands are the floor under the player's feet, nobody
   the street deals stands on the racing surface, the catch fence offers a
   climb where you stand at it.
   testbus: node tools/testbus/submit.mjs --world city --probe tools/probes/speedway.mjs */
export const meta = { world: "city", fresh: true, dirties: true, timeoutMs: 15 * 60e3 };

export default async function (t) {
  const r = await t.fn(`
    var sw = CBZ.speedway, RC = CBZ.race && CBZ.race.core, P = CBZ.player, D = RC && RC.DIMS;
    if (!sw || !RC) return { err: "no speedway" };
    var gp = sw.gridPose(5);
    P.pos.set(gp.x, gp.y + 0.1, gp.z);
    for (var k = 0; k < 300; k++) CBZ.stepSim(1 / 60);
    var out = { ready: sw.ready(), py: +P.pos.y.toFixed(3), gpy: +gp.y.toFixed(3), worst: 0, onTrack: 0, peds: 0 };
    var ss = [0, 60, 200, 300, 420, 600], us = [-12, -5, 0, 5, 9.5];
    for (var i = 0; i < ss.length; i++) for (var j = 0; j < us.length; j++) {
      var f = RC.frame(ss[i]), c = sw.toCity(f.x + f.nx * us[j], f.z + f.nz * us[j]);
      out.worst = Math.max(out.worst, Math.abs(CBZ.floorAt(c.x, c.z) - RC.surfaceY(ss[i], us[j])));
    }
    var peds = CBZ.cityPeds || [], fr = {};
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i]; if (!p || !p.pos || sw.distance(p.pos.x, p.pos.z) > 260) continue;
      out.peds++;
      if (CBZ.speedwayFrame(p.pos.x, p.pos.z, fr) && fr.u > D.APRON_IN && fr.u < D.WALL_U) out.onTrack++;
    }
    // walk up to the fence on the front straight: the climb is offered
    var f2 = RC.frame(60), c2 = sw.toCity(f2.x + f2.nx * 9.3, f2.z + f2.nz * 9.3);
    P.pos.set(c2.x, RC.surfaceY(60, 9.3), c2.z);
    for (var k = 0; k < 30; k++) CBZ.stepSim(1 / 60);
    out.people = CBZ.speedwayPeopleAudit ? CBZ.speedwayPeopleAudit() : null;
    out.race = CBZ.speedwayRaceAudit ? CBZ.speedwayRaceAudit() : null;
    out.worst = +out.worst.toFixed(3);
    return out;`, 300000);
  t.log(JSON.stringify(r));
  const ok = r && !r.err && Math.abs(r.py - r.gpy) < 0.12 && r.worst < 0.05 && r.onTrack === 0 && r.people && r.people.fence > 0;
  return { ok, summary: r && !r.err ? `feet ${r.py} vs grid ${r.gpy}, floor err ${r.worst}, ${r.onTrack}/${r.peds} peds on track, fence climbs ${r.people && r.people.fence}` : String(r && r.err) };
}
