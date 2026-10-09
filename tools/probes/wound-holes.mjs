/* tools/probes/wound-holes.mjs — A SHOT LEAVES A HOLE, NOT A RED SHIRT.

   OWNER (2026-10-09): "I don't really like clothes changing colours because
   of blood. Instead it should just be the blood holes" + "bullet holes
   disappear after a while, which is dumb".

   In the city: shoot a living ped (CBZ.bodyWound, a rifle round with a
   through-line) and, on the SAME frame, count the marks on his rig. Then let
   ~40 s of sim pass and check:
     - holes appeared on the frame of the hit (no step in between)
     - none oversized (woundDecalAudit), none grew (scale is unchanged)
     - every garment material on the body is the one it was before the hit
     - the holes are all still there after 40 s
     - the player's own rig takes a hole through CBZ.playerWoundActor
     - a world bullet hole survives 40 s and the instanced cap is > 384

     testbus:  node tools/testbus/submit.mjs --world city --probe tools/probes/wound-holes.mjs */
export const meta = { world: "city", fresh: false, dirties: true, timeoutMs: 6 * 60e3 };

export default async function (t) {
  const a = await t.fn(`
    var cam = CBZ.camera, peds = CBZ.cityPeds || [];
    var ped = null, bd = 1e9;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!p || p.dead || p.culled || !p.char || !p.group || !p.group.parent) continue;
      var d = Math.hypot(p.pos.x - cam.position.x, p.pos.z - cam.position.z);
      if (d < bd) { bd = d; ped = p; }
    }
    if (!ped) return { err: "no ped" };
    window.__wh = { ped: ped };
    var S = ped.char.skinSlots, mats = [];
    ["torso","legs","arms","armsLower","collar"].forEach(function (k) { (S[k]||[]).forEach(function (m) { mats.push(m.material); }); });
    __wh.mats = mats;
    var before = CBZ.woundDecalAudit().decals;
    var tp = S.torso[0]; tp.updateWorldMatrix(true, false);
    var wp = new THREE.Vector3(); tp.getWorldPosition(wp);
    CBZ.bodyWound(ped, { x: wp.x, y: wp.y + 0.1, z: wp.z }, { cal: 1.6, dir: { x: 1, y: 0, z: 0 } });
    var after = CBZ.woundDecalAudit();
    var marks = [];
    ped.group.traverse(function (o) { if (o.isMesh && o.parent && o.parent !== ped.group && o.material && (o.material.vertexColors) && o.geometry && o.geometry._shared && o.geometry._maxR) marks.push(o); });
    __wh.marks = marks; __wh.scales = marks.map(function (m) { return m.scale.x; });
    // the player's own body
    var pBefore = CBZ.woundDecalAudit().decals, pOk = false;
    if (CBZ.playerWoundActor && CBZ.playerChar && CBZ.city && CBZ.city.playerActor) {
      var pp = CBZ.player.pos;
      CBZ.bodyWound(CBZ.city.playerActor, { x: pp.x, y: pp.y + 1.2, z: pp.z }, { cal: 1, fromX: pp.x + 5, fromZ: pp.z });
      pOk = CBZ.woundDecalAudit().decals > pBefore;
    }
    // a world hole
    var hb = CBZ.bulletHoleAudit ? CBZ.bulletHoleAudit().world : 0;
    if (CBZ.bulletHole) CBZ.bulletHole({ x: cam.position.x + 3, y: 0.01, z: cam.position.z + 3 }, { x: 0, y: 1, z: 0 }, { surface: "asphalt", noProp: true, dist: 5 });
    var ha = CBZ.bulletHoleAudit ? CBZ.bulletHoleAudit().world : 0;
    return { sameFrame: after.decals - before, oversized: after.oversized, marks: marks.length, playerHole: pOk, worldHole: ha - hb, worldNow: ha };
  `);
  if (!a || a.__err || a.err) return { ok: false, summary: "setup: " + JSON.stringify(a) };
  t.log("hit", JSON.stringify(a));
  await t.step(60 * 40);
  const b = await t.fn(`
    var w = __wh, ped = w.ped, S = ped.char.skinSlots, i = 0, same = true;
    ["torso","legs","arms","armsLower","collar"].forEach(function (k) { (S[k]||[]).forEach(function (m) { if (m.material !== w.mats[i++]) same = false; }); });
    var live = 0, grew = 0;
    for (var j = 0; j < w.marks.length; j++) { if (w.marks[j].parent) live++; if (Math.abs(w.marks[j].scale.x - w.scales[j]) > 1e-6) grew++; }
    return { same: same, live: live, grew: grew, dead: !!ped.dead, world: CBZ.bulletHoleAudit ? CBZ.bulletHoleAudit().world : -1 };
  `);
  t.log("after 40s", JSON.stringify(b));
  const ok = a.sameFrame >= 3 && a.oversized === 0 && a.playerHole && a.worldHole === 1 &&
    b.same && b.grew === 0 && b.live === a.marks && b.world >= a.worldNow;
  return { ok, summary: `same-frame marks ${a.sameFrame}, oversized ${a.oversized}, player hole ${a.playerHole}, clothes unchanged ${b.same}, grew ${b.grew}, live after 40s ${b.live}/${a.marks}, world holes ${a.worldNow}->${b.world}`, data: { a, b } };
}
