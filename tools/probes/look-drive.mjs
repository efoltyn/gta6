/* tools/probes/look-drive.mjs — A LONG DRIVE THROUGH GANG CITY: DO THE
   PEOPLE'S LOOKS PILE UP ON THE GPU?

   Every person's outfit atlas (city/clothes.js) and ink chart
   (entities/tattoo.js) is a texture shared by everyone wearing it. A look
   nobody in the scene wears must give its GPU copy back (core/texfree.js
   CBZ.lookTex). This carries the player along the streets at driving speed
   for --mins sim minutes (default 20), draws a frame every sim second (so
   the people met are really uploaded), and samples once a sim minute: GPU
   textures (three's count and the accounted MB of every live texture),
   the looks resident / worn / put away. A plateau passes; a count that is
   still climbing over the last third of the drive is the pile-up.

     node tools/testbus/standalone.mjs tools/probes/look-drive.mjs [--mins 20] [--mps 25]
   Exit 0 = plateau, 1 = still climbing. */
export const meta = { world: "city", fresh: true, dirties: true, timeoutMs: 90 * 60e3 };

const HOOK = `
  if (window.__lt) return 1;
  var G = window.__lt = { live: new Set() };
  var P = THREE.Texture.prototype, add = P.addEventListener, rem = P.removeEventListener;
  P.addEventListener = function (type, fn) { if (type === "dispose") G.live.add(this); return add.call(this, type, fn); };
  P.removeEventListener = function (type, fn) { if (type === "dispose") G.live.delete(this); return rem.call(this, type, fn); };
  return 1;
`;

/* the route: the speed tool's road walk (nearest road, straight on where it
   can, turning at crossings), and back along itself when it runs out */
const ROUTE = `
  var A = CBZ.city && CBZ.city.arena, Pl = CBZ.player;
  var R0 = (A && A.roads || []).filter(function (r) { return r && r.x != null && r.z != null && r.len > 8; });
  var ends = function (r) { var h = r.len / 2; return r.vertical ? [[r.x, r.z - h], [r.x, r.z + h]] : [[r.x - h, r.z], [r.x + h, r.z]]; };
  var cur = null, bd = Infinity;
  for (var i = 0; i < R0.length; i++) { var dd = Math.hypot(R0[i].x - Pl.pos.x, R0[i].z - Pl.pos.z); if (dd < bd) { bd = dd; cur = R0[i]; } }
  if (!cur) return null;
  var E = ends(cur), used = new Set([cur]), route = [[cur.x, cur.z], E[1]], at2 = E[1], dir = cur.vertical ? [0, 1] : [1, 0], len = 0, guard = 0;
  while (len < 40000 && guard++ < 2000) {
    var best = null, bs = -Infinity, bend = null;
    for (var j = 0; j < R0.length; j++) {
      var r2 = R0[j]; if (used.has(r2)) continue;
      var e2 = ends(r2), hl = r2.len / 2;
      var onIt = r2.vertical ? (Math.abs(at2[0] - r2.x) < 14 && at2[1] > r2.z - hl - 14 && at2[1] < r2.z + hl + 14)
                             : (Math.abs(at2[1] - r2.z) < 14 && at2[0] > r2.x - hl - 14 && at2[0] < r2.x + hl + 14);
      if (!onIt) continue;
      for (var k = 0; k < 2; k++) {
        var f = e2[k], vx = f[0] - at2[0], vz = f[1] - at2[1], vl = Math.hypot(vx, vz) || 1;
        if (vl < 30) continue;
        var sc = (vx * dir[0] + vz * dir[1]) / vl * 50 + r2.len * 0.05;
        if (sc > bs && (vx * dir[0] + vz * dir[1]) / vl > -0.2) { bs = sc; best = r2; bend = f; }
      }
    }
    if (!best) break;
    used.add(best);
    var cross = best.vertical ? [best.x, at2[1]] : [at2[0], best.z];
    if (Math.hypot(cross[0] - at2[0], cross[1] - at2[1]) > 0.5) route.push(cross);
    route.push(bend); len += Math.hypot(bend[0] - cross[0], bend[1] - cross[1]);
    var bl = Math.hypot(bend[0] - at2[0], bend[1] - at2[1]) || 1;
    dir = [(bend[0] - at2[0]) / bl, (bend[1] - at2[1]) / bl];
    at2 = bend;
  }
  window.__ltRoute = route;
  return { legs: route.length - 1, km: +(len / 1000).toFixed(1) };
`;

/* one sim minute of driving: 30 steps a sim second, a drawn frame a second */
const MINUTE = (mps, d0) => `
  var C = CBZ, Pl = C.player, A = C.city && C.city.arena, route = window.__ltRoute;
  var legs = [], tot = 0;
  for (var i = 0; i + 1 < route.length; i++) { var L = Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]); legs.push(L); tot += L; }
  var at = function (d) {
    d = d % (2 * tot); if (d > tot) d = 2 * tot - d;          // there and back
    for (var i = 0; i < legs.length; i++) { if (d <= legs[i] || i === legs.length - 1) { var f = Math.min(1, d / legs[i]); return [route[i][0] + (route[i + 1][0] - route[i][0]) * f, route[i][1] + (route[i + 1][1] - route[i][1]) * f, Math.atan2(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])]; } d -= legs[i]; }
  };
  var gh = function (x, z) { try { var y = A && A.groundHeightAt ? A.groundHeightAt(x, z) : 0; return isFinite(y) ? y : 0; } catch (e) { return 0; } };
  var d = ${d0};
  for (var s = 0; s < 60; s++) {
    for (var k = 0; k < 30; k++) {
      d += ${mps} / 30;
      var q = at(d);
      Pl.pos.set(q[0], gh(q[0], q[1]) + 0.05, q[1]); Pl.vy = 0; Pl.grounded = true; Pl.dead = false; Pl.hp = 100;
      if (C.cam) C.cam.yaw = q[2] + Math.PI;
      C.stepSim(1 / 30);
    }
    try { C.renderFrame(); } catch (e) {}
  }
  var G = window.__lt, mb = 0;
  G.live.forEach(function (t) {
    var w = t._cbzLazyW || (t.image && t.image.width) || 0, h = t._cbzLazyH || (t.image && t.image.height) || 0;
    if (t.image && t.image.data && t.image.depth) h *= t.image.depth;
    mb += w * h * 4 * (t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1) / 1048576;
  });
  var info = C.renderer.info.memory;
  return { d: d, tex: info.textures, geo: info.geometries, texMB: +mb.toFixed(1), look: C.lookTex ? C.lookTex.audit() : null,
    peds: (C.cityPeds || []).length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
`;

export default async function (t) {
  const mins = Math.max(3, +t.arg("--mins", 20) || 20), mps = +t.arg("--mps", 25) || 25;
  await t.fn(HOOK);
  await t.step(120);
  const r = await t.fn(ROUTE, 300000);
  if (!r || r.__err) return { ok: false, summary: "no route: " + JSON.stringify(r) };
  t.log("route", JSON.stringify(r));
  const rows = [];
  let d = 0;
  for (let m = 1; m <= mins; m++) {
    const s = await t.fn(MINUTE(mps, d), 1800000);
    if (!s || s.__err) return { ok: false, summary: `minute ${m}: ${JSON.stringify(s)}` };
    d = s.d;
    rows.push(s);
    const L = s.look || {};
    t.log(`min ${m}`, JSON.stringify({ tex: s.tex, texMB: s.texMB, geo: s.geo, heap: s.heap, peds: s.peds, looks: L.looks, resident: L.resident, residentMB: L.residentMB, idleMB: L.idleResidentMB, evicted: L.evicted, revived: L.revived }));
  }
  // the verdict: the last third of the drive must not keep climbing
  const third = Math.max(2, Math.floor(rows.length / 3));
  const tail = rows.slice(-third), head = rows[rows.length - third - 1] || rows[0];
  const maxTail = Math.max(...tail.map((s) => s.tex)), first = tail[0].tex, last = tail[tail.length - 1].tex;
  const climbing = last > head.tex + 12 && last >= maxTail && first < last - 8;
  return { ok: !climbing,
    summary: `${mins} sim min at ${mps} m/s: GPU textures ${rows[0].tex} -> ${rows[Math.floor(rows.length / 2)].tex} -> ${last} (${rows[0].texMB} -> ${rows[rows.length - 1].texMB} MB); ` +
      `looks resident ${rows[rows.length - 1].look ? rows[rows.length - 1].look.resident : "?"}, put away ${rows[rows.length - 1].look ? rows[rows.length - 1].look.evicted : "?"}` + (climbing ? " — STILL CLIMBING" : " — plateau"),
    data: rows.map((s) => [s.tex, s.texMB, s.look && s.look.resident]) };
}
