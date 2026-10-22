/* tools/probes/protest-props.mjs — A PROTEST'S SIGNS ARE IN HANDS THAT ARE DRAWN.

   Forces the Mansion protest, steps the sim, then for the sign / flag rows
   reads what the GPU drew (crowdgpu layer + crowdstore S.drawn / S.clip),
   where the body stands against the ground under it, and the parents of the
   body layer and the prop layer.

     testbus:  node tools/testbus/submit.mjs --world city --probe tools/probes/protest-props.mjs */
export const meta = { world: "city", fresh: true, dirties: true, timeoutMs: 4 * 60e3 };

export default async function (t) {
  await t.step(60);
  await t.fn(`
    window.__hides = [];
    var O = THREE.Object3D.prototype;
    CBZ.scene.traverse(function (o) { if (o.name && o.name.indexOf("crowdgpu:") === 0) { var v = o.visible; delete o.visible; o.__vis = v; } });
    Object.defineProperty(O, "visible", { configurable: true, get: function () { return this.__vis !== false; }, set: function (x) {
      if (!x && this.__vis !== false && this.name && this.name.indexOf("crowdgpu:") === 0 && window.__hides.length < 8) window.__hides.push(this.name + " " + String(new Error().stack).split("\n").slice(1, 7).join(" | "));
      this.__vis = !!x; } });
    return true;
  `);
  const a0 = await t.fn(`
    var PP = CBZ.presidentPublic; if (!PP || !PP._protestNow) return { err: "no _protestNow" };
    PP._protestNow(14);
    var pen = CBZ.perimeter && CBZ.perimeter.pen("execmansion");
    if (pen && CBZ.player) { CBZ.player.pos.set(pen.at.x + pen.out.x * 7, CBZ.player.pos.y, pen.at.z + pen.out.z * 7); }
    return { ok: true, pen: pen ? [pen.at.x, pen.at.z] : null };
  `);
  if (!a0 || a0.err || a0.__err) return { ok: false, summary: "setup: " + JSON.stringify(a0) };
  await t.step(240);
  const a = await t.fn(`
    var ST = CBZ.crowds, S = ST.S, M = CBZ.mob, G = CBZ.crowdGPU;
    var list = M.list(); if (!list.length) return { err: "no mob" };
    var id = list[0].id, grp = M.group(id), A = M._agents();
    var CL = ST.CLIP, signs = 0, signsDrawn = 0, bodiesDrawn = 0, rows = 0, dy = [], hidden = 0, look = 0;
    for (var k = 0; k < grp.rows.length; k++) {
      var r = grp.rows[k]; rows++;
      if (S.drawn[r]) bodiesDrawn++;
      if (S.hide[r]) hidden++;
      if (S.look[r] < 0) look++;
      if (A.arole[r] === 3 || A.arole[r] === 2) { signs++; if (S.drawn[r]) signsDrawn++; }
      if (dy.length < 12 && k % 97 === 0) {
        var gy = CBZ.groundAt ? CBZ.groundAt(S.x[r], S.z[r], S.y[r] + 3) : null;
        var th = CBZ.terrainHeight ? CBZ.terrainHeight(S.x[r], S.z[r]) : null;
        dy.push([+S.y[r].toFixed(2), gy == null ? null : +gy.toFixed(2), th == null ? null : +th.toFixed(2), S.drawn[r], S.clip[r]]);
      }
    }
    function chain(o) { var c = []; for (var p = o; p; p = p.parent) c.push((p.name || p.type) + (p.visible === false ? "(HIDDEN)" : "") + (p.position && (p.position.x || p.position.y || p.position.z) ? "@" + [p.position.x.toFixed(1), p.position.y.toFixed(1), p.position.z.toFixed(1)].join(",") : "")); return c.join(" < "); }
    var bodyG = null, propG = null, meshes = [];
    CBZ.scene.traverse(function (o) {
      if (o.name === "crowdgpu:" + id) bodyG = o;
      if (o.name === "mob-props") propG = o;
    });
    if (bodyG) bodyG.children.forEach(function (m) { meshes.push([m.name, m.visible, m.geometry && m.geometry.instanceCount, m.material && m.material.type]); });
    var cam = CBZ.camera && CBZ.camera.position;
    return { rows: rows, bodiesDrawn: bodiesDrawn, signs: signs, signsDrawn: signsDrawn, hidden: hidden, noLook: look, dy: dy,
      gpu: G.audit(), layer: grp.layer ? grp.layer.drawn : null, bodyChain: bodyG ? chain(bodyG) : null, propChain: propG ? chain(propG) : null,
      meshes: meshes, hides: window.__hides, groups: (function () { var L = []; CBZ.scene.traverse(function (o) { if (o.name && o.name.indexOf("crowdgpu:") === 0) L.push(o.name + ":" + o.visible); }); return L; })(), audit: M.audit(), cam: cam ? [cam.x, cam.y, cam.z] : null, mode: CBZ.game.mode };
  `);
  if (!a || a.err || a.__err) return { ok: false, summary: "read: " + JSON.stringify(a) };
  t.log("protest", JSON.stringify(a));
  const ok = a.signsDrawn <= a.bodiesDrawn;
  return { ok: ok, summary: JSON.stringify({ rows: a.rows, bodiesDrawn: a.bodiesDrawn, signs: a.signs, signsDrawn: a.signsDrawn, dy: a.dy, layer: a.layer, gpuOk: a.gpu.ok, atlas: a.gpu.atlas, bodyChain: a.bodyChain, propChain: a.propChain, meshes: a.meshes, hides: a.hides, groups: a.groups }) };
}
