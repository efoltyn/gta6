/* tools/probes/corpse-float.mjs — NOTHING FLOATS OVER A BODY.

   OWNER (2026-10-22, The Isles): "When you kill people there's a floating
   puckered mark above them, probably left over from the shark game, like a
   bite mark."

   On the isles, eight people are killed one after another, the way the
   game kills them (CBZ.bodyWound + the spray + CBZ.cityKillPed): a rifle at
   6 / 20 / 35 / 70 m, a knife, fists, and a muzzle-close shotgun (the head
   comes off and flies). ~8 s later every visible mesh and every instanced
   decal (gore.js pools, gunfx.js holes) within 2.5 m is listed with its
   height over his ground and over the solid under it. A mark standing
   clear of whatever is under it is floating; the body's own parts must lie
   on the ground with him.

     testbus:  node tools/testbus/submit.mjs --world isles --probe tools/probes/corpse-float.mjs */
export const meta = { world: "isles", fresh: true, dirties: true, timeoutMs: 20 * 60e3 };

const CENSUS = `
  function census(ped, gy) {
    var out = [], P = ped.pos, v = new THREE.Vector3();
    CBZ.scene.updateMatrixWorld(true);
    CBZ.scene.traverseVisible(function (o) {
      if (!o.isMesh && !o.isSprite && !o.isPoints) return;
      if (o.isInstancedMesh) {
        // decal pools (gore.js splats, gunfx.js holes) draw as one instanced
        // mesh: each instance is its own mark
        var M4 = new THREE.Matrix4(), n = Math.min(o.count, 4096);
        for (var k = 0; k < n; k++) {
          o.getMatrixAt(k, M4); M4.premultiply(o.matrixWorld); v.setFromMatrixPosition(M4);
          if (Math.hypot(v.x - P.x, v.z - P.z) > 2.5) continue;
          out.push({ id: o.id + "#" + k + "@" + v.x.toFixed(2) + "," + v.y.toFixed(2) + "," + v.z.toFixed(2), mine: false, h: +(v.y - gy).toFixed(2), chain: "inst:" + (o.name || "") + "<" + (o.parent ? (o.parent.name || o.parent.type) : ""), geo: o.geometry ? o.geometry.type : "", mat: "", mau: true, sc: 0 });
        }
        return;
      }
      o.getWorldPosition(v);
      if (Math.hypot(v.x - P.x, v.z - P.z) > 2.5) return;
      var mine = false; for (var q = o; q; q = q.parent) if (q === ped.group) { mine = true; break; }
      var chain = []; for (var q2 = o; q2 && chain.length < 5; q2 = q2.parent) chain.push((q2.name || q2.type) + (q2.userData && q2.userData.cbzSkinMark ? "[skin:" + q2.userData.cbzSkinMark + "]" : "") + (q2._tornCap ? "[torn]" : ""));
      var mt = Array.isArray(o.material) ? o.material[0] : o.material;
      out.push({ id: o.id, mine: mine, h: +(v.y - gy).toFixed(2), chain: chain.join("<"),
        geo: o.geometry ? (o.geometry.type + (o.geometry._shared ? "*" : "") + (o.geometry._maxR ? "R" : "")) : "",
        mat: mt ? mt.type + ":" + (mt.color ? mt.color.getHexString() : "") + (mt.map ? "+map" : "") : "",
        mau: o.matrixAutoUpdate, sc: +o.scale.x.toFixed(3) });
    });
    return out;
  }
`;

export default async function (t) {
  for (let i = 0; i < 30; i++) {
    await t.step(20);
    const n = await t.evl(`(CBZ.cityPeds||[]).filter(function(p){return p&&!p.dead&&!p.culled&&p.char&&p.group&&p.group.parent;}).length`);
    if (n > 0) break;
  }
  // stand D metres from the nearest person: near (full rig), mid (pooled
  // by pedinstance), far (past the gore band)
  const runs = [];
  for (const [D, CR, HOW] of [[6, 0, "shot"], [6, 0, "stabbed"], [6, 0, "beaten"], [3, 0, "shotgun"], [3, 0, "shotgun"], [20, 0, "shot"], [35, 0, "shot"], [70, 0, "shot"]]) {
  const pick = await t.fn(`
    var __CROWD = ${CR}; var P = CBZ.player, peds = CBZ.cityPeds || [];
    var ped = null, bd = 1e9;
    for (var i = 0; i < peds.length; i++) {
      var p = peds[i];
      if (!p || p.dead || p.culled || !p.char || !p.group || !p.group.parent || p.inCar || p._cbzSeat || p._cfDone || p._parked) continue;
      if (__CROWD && !p._crowd) continue;
      var d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < bd) { bd = d; ped = p; }
    }
    if (!ped) return { err: "no ped" };
    P.pos.x = ped.pos.x + ${D}; P.pos.z = ped.pos.z;
    if (CBZ.bodyTeleported) CBZ.bodyTeleported(P);
    ped._cfDone = true; window.__cf = { ped: ped };
    return { was: +bd.toFixed(1) };
  `);
  if (!pick || pick.__err || pick.err) { runs.push({ D, err: "pick: " + JSON.stringify(pick) }); continue; }
  await t.step(90);
  const a = await t.fn(CENSUS + `
    var ped = __cf.ped, cam = CBZ.camera;
    if (ped.dead) return { err: "died before the shot" };
    var gy = CBZ.floorAt ? CBZ.floorAt(ped.pos.x, ped.pos.z) : (ped.pos.y || 0);
    var before = census(ped, gy).map(function (o) { return o.id; });
    __cf.gy = gy; __cf.before = before;
    var S = ped.char.skinSlots, wp = new THREE.Vector3();
    var fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    var dx = ped.pos.x - fx, dz = ped.pos.z - fz, dl = Math.hypot(dx, dz) || 1;
    var dir = { x: dx / dl, y: 0, z: dz / dl };
    var bd = Math.hypot(ped.pos.x - cam.position.x, ped.pos.z - cam.position.z);
    var HOW = "${HOW}";
    S.torso[0].getWorldPosition(wp);
    var tp = wp.clone();
    if (HOW === "stabbed") {
      CBZ.bodyWound(ped, { x: tp.x, y: tp.y, z: tp.z }, { melee: "blade", dir: dir, fromX: fx, fromZ: fz });
      CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, dir: { x: dir.x, z: dir.z }, point: { x: tp.x, y: tp.y, z: tp.z }, melee: "blade", attacker: CBZ.city && CBZ.city.playerActor }, "stabbed");
    } else if (HOW === "beaten") {
      CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, dir: { x: dir.x, z: dir.z }, melee: true, attacker: CBZ.city && CBZ.city.playerActor }, "beaten");
    } else {
      CBZ.bodyWound(ped, { x: wp.x, y: wp.y + 0.1, z: wp.z }, { cal: 1, dir: dir, fromX: fx, fromZ: fz });
      S.head[0].getWorldPosition(wp);
      CBZ.bodyWound(ped, { x: wp.x, y: wp.y, z: wp.z }, { cal: 1, head: true, dir: dir, fromX: fx, fromZ: fz });
      if (CBZ.gore && CBZ.gore.spray) { CBZ.gore.spray({ x: tp.x, y: tp.y, z: tp.z }, 0.58, dir, {}); CBZ.gore.spray({ x: wp.x, y: wp.y, z: wp.z }, 0.95, dir, {}); }
      var sg = HOW === "shotgun";
      CBZ.cityKillPed(ped, { fromX: fx, fromZ: fz, dir: { x: dir.x, z: dir.z }, shot: true, point: { x: wp.x, y: wp.y, z: wp.z }, headshot: true, wkey: sg ? "shotgun" : "ak47", dist: sg ? 3 : 6, cal: sg ? 1.4 : 1, attacker: CBZ.city && CBZ.city.playerActor }, sg ? "headshot" : "shot");
    }
    var d0 = CBZ.woundDecalAudit ? CBZ.woundDecalAudit().decals : -1;
    return { camDist: +bd.toFixed(1), gy: +gy.toFixed(2), n0: before.length, decals: d0, mode: CBZ.game.mode };
  `);
  if (!a || a.__err || a.err) { runs.push({ D, err: "setup: " + JSON.stringify(a) }); continue; }
  t.log("kill", JSON.stringify(a));
  await t.step(60 * 8);
  const b = await t.fn(CENSUS + `
    var w = __cf, ped = w.ped;
    var gy = CBZ.floorAt ? CBZ.floorAt(ped.pos.x, ped.pos.z) : w.gy;
    var all = census(ped, gy);
    var fresh = all.filter(function (o) { return w.before.indexOf(o.id) < 0 || o.mine; });
    var high = fresh.filter(function (o) { return o.h > 1.1; });
    // an INSTANCED copy that kept its standing pose sits exactly where it was
    // before the kill, so it is not "fresh": list every instance up there
    all.forEach(function (o) { if (String(o.id).indexOf("#") > 0 && /gore|hole|decal|blood/.test(o.chain) && o.h > 0.6 && high.indexOf(o) < 0) high.push(o); });
    high = high.filter(function (o) { return !/tree|Lambert.*3b7a2a/.test(o.chain + o.mat); });
    // what holds a high mark up: the colliders and platforms under it
    var seen = {};
    high.forEach(function (o) {
      var m = String(o.id).match(/@(-?[0-9.]+),(-?[0-9.]+),(-?[0-9.]+)/);
      var x, z;
      if (m) { x = +m[1]; z = +m[3]; } else { var ob = CBZ.scene.getObjectById(o.id); if (!ob) return; var v = new THREE.Vector3(); ob.getWorldPosition(v); x = v.x; z = v.z; o.x = +x.toFixed(2); o.z = +z.toFixed(2); }
      {
        var cols = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 0.4, []) : [];
        o.under = cols.filter(function (c) { return c.y1 != null && c.y1 > gy + 0.3; }).slice(0, 6).map(function (c) {
          var k = {}; for (var key in c) { var val = c[key]; if (typeof val === "number") k[key] = +val.toFixed(2); else if (typeof val === "string" || typeof val === "boolean") k[key] = val; else if (val && val.isObject3D) k[key] = "obj:" + (val.name || val.type); }
          return k;
        });
        o.walk = CBZ.walkGroundAt ? +(CBZ.walkGroundAt(x, z, gy + 3) - gy).toFixed(2) : null;
        o.gnd = CBZ.groundAt ? +(CBZ.groundAt(x, z, gy + 3) - gy).toFixed(2) : null;
      }
    });
    // a mark resting on something real (a fence rail, a car roof, a stair
    // landing) is not floating: only what stands clear of the solid under it
    high = high.filter(function (o) { return (o.walk == null || o.h - o.walk > 0.35) && !(!o.mine && /character-model/.test(o.chain)); });   // (a passer-by's own body is not a mark)
    var lowNew = fresh.filter(function (o) { return !o.mine && o.h <= 1.1; }).slice(0, 12);
    return { dead: !!ped.dead, rag: !!(CBZ.ragdollActive && CBZ.ragdollActive(ped)), gy: +gy.toFixed(2), pedY: +(ped.group.position.y - gy).toFixed(2), high: high, lowNew: lowNew, mineN: all.filter(function (o) { return o.mine; }).length, maxMine: Math.max.apply(null, all.filter(function (o) { return o.mine; }).map(function (o) { return o.h; }).concat([-9])) };
  `);
  t.log("after", D, JSON.stringify(b));
  runs.push({ D: D + " " + HOW, a, b });
  }
  const bad = runs.filter(function (r) { return r.err || !r.b || r.b.__err || (r.b.high && r.b.high.length); });
  const ok = runs.length > 0 && bad.length === 0;
  return { ok, summary: runs.map(function (r) { return r.D + " m: " + (r.err ? r.err : (r.b && r.b.high && r.b.high.length ? "FLOATING " + JSON.stringify(r.b.high).slice(0, 700) : "clean (" + (r.b && r.b.mineN) + " meshes, highest " + (r.b && r.b.maxMine) + ")")); }).join(" | "), data: runs };
}
