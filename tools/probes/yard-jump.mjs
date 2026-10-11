/* tools/probes/yard-jump.mjs — AN INMATE JUMPS YOU: DO HIS BLOWS LAND, AND
   WHAT DO THEY COST?

   The real escape world, the real loop (CBZ.stepSim: aiThink, the strike
   pass, hurtPlayer). One inmate is set on you (huntPlayer, the flag
   provokeGang sets) at arm's length and the world runs 20 s of sim time.
   The player is kept standing (hp topped up, no stun) so the whole sample
   is one beating; nothing about the blows is touched.

   tools/yard-melee-check.mjs asks the same question but calls aiThink in a
   tight loop with NO frames in between and zeroes the punch clock after each
   call, so a strike thrown through systems/verbs_strike.js (which lands in
   its per-frame pass) can never land there: the second V.strike finds the
   first still in flight and refuses. This probe runs frames.

   testbus: node tools/testbus/submit.mjs --world escape --probe tools/probes/yard-jump.mjs */
export const meta = { world: "escape", fresh: true, dirties: true, timeoutMs: 12 * 60e3 };

export default async function (t) {
  const r = await t.fn(`
    // past the intro (3.55 s of sim), then out into the yard (0, 34) with
    // the nearest inmate who is not a merchant, and set him on you the way
    // the game does (CBZ.requestInmateHunt, the one way a man starts on you)
    for (var w = 0; w < 300; w++) CBZ.stepSim(1 / 60);
    var P = CBZ.player, list = CBZ.npcs || [], n = null, bd = 1e9;
    var YX = 0, YZ = 34, gy = CBZ.groundAt ? CBZ.groundAt(YX, YZ, 5) : 0;
    P.pos.set(YX, gy, YZ);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || c.dead || c.ko || !c.group || !c.char || c.kind === "guard" || c.role === "merchant" || c.cuffed) continue;
      var d = Math.hypot(c.group.position.x - YX, c.group.position.z - YZ);
      if (d < bd) { bd = d; n = c; }
    }
    if (!n) return { err: "no live inmate" };
    n.group.position.set(YX + 1.6, gy, YZ);
    if (n.target) n.target.set(YX, 0, YZ);
    n._brokenUpT = 0; n.aiState = "wander";
    var asked = CBZ.requestInmateHunt ? CBZ.requestInmateHunt(n, 30, "wronged") : (n.huntPlayer = 30, true);
    var trace = [];
    var hits = 0, dmg = 0, blocked = 0, kinds = {}, thrown = 0;
    var realHurt = CBZ.hurtPlayer;
    CBZ.hurtPlayer = function (amt, x, z, o) {
      if (o && o.by === n) { hits++; dmg += +amt || 0; if (o.blocked) blocked++; }
      return realHurt.apply(this, arguments);
    };
    var V = CBZ.verbs, realStrike = V.strike;
    V.strike = function (a, tg, op) {
      var S = realStrike.apply(this, arguments);
      if (S && a === n) { thrown++; var k = (op && op.kind) || "?"; kinds[k] = (kinds[k] || 0) + 1; }
      return S;
    };
    var yaw = CBZ.playerChar ? CBZ.playerChar.group.rotation.y : 0;
    n.group.position.set(P.pos.x + Math.sin(yaw) * 1.6, n.group.position.y, P.pos.z + Math.cos(yaw) * 1.6);
    var T = 20, steps = Math.round(T * 60), hpLost = 0;
    try {
      for (var s = 0; s < steps; s++) {
        n.huntPlayer = Math.max(n.huntPlayer || 0, 5);
        n._shankOut = false; n._steelT = 0;          // fists: the blade is its own probe (prison-shank)
        if (s % 120 === 0) trace.push([s / 60, Math.round(Math.hypot(n.group.position.x - P.pos.x, n.group.position.z - P.pos.z) * 100) / 100, n.aiState, Math.round((n.huntPlayer || 0) * 10) / 10]);
        var hp0 = P.hp;
        CBZ.stepSim(1 / 60);
        if (P.hp < hp0) hpLost += hp0 - P.hp;
        P.hp = 100; P.dead = false; P.stun = 0;
        if (CBZ.game) CBZ.game.invuln = 0;
        if (n.dead || n.ko) break;
      }
    } finally { CBZ.hurtPlayer = realHurt; V.strike = realStrike; }
    var dEnd = Math.hypot(n.group.position.x - P.pos.x, n.group.position.z - P.pos.z);
    return { thrown: thrown, hits: hits, blocked: blocked, dmg: Math.round(dmg * 10) / 10, hpLost: Math.round(hpLost * 10) / 10,
      kinds: kinds, secs: s / 60, dEnd: Math.round(dEnd * 100) / 100, asked: asked, trace: trace };`, 600000);
  t.log(JSON.stringify(r));
  if (!r || r.err || r.__err) return { ok: false, summary: String(r && (r.err || r.__err)) };
  const rate = r.dmg / Math.max(1, r.secs);
  const ok = r.hits >= 5 && rate >= 0.5 && rate <= 12 && Object.keys(r.kinds).length >= 3;
  return { ok, summary: `${r.thrown} blows thrown, ${r.hits} reached hurtPlayer (${r.blocked} on the guard), ${r.hpLost} hp in ${r.secs.toFixed(1)} s (hurt ${r.dmg} = ${rate.toFixed(1)} hp/s), kinds ${JSON.stringify(r.kinds)}, end gap ${r.dEnd} m`, data: r };
}
