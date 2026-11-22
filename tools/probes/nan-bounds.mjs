/* tools/probes/nan-bounds.mjs — WHICH MESH has a NaN bounding sphere while the
   island tsunami's bore crosses.

   three logs "computeBoundingSphere(): Computed radius is NaN" and
   core/drawcheck.js adds the vertex count and the calling stack, but neither
   names the mesh. This probe runs the tsunami through its sweep, draws a frame
   every few ticks, then walks the scene for every drawable whose geometry has
   a non-finite bounding sphere and reports its name, material, parent chain
   and which attribute values are not finite.

     node tools/testbus/standalone.mjs tools/probes/nan-bounds.mjs --world survival */
export const meta = { world: "survival", fresh: true, dirties: true, timeoutMs: 900000 };

export default async function (t) {
  await t.step(90);
  const r = await t.fn(`
    if (!CBZ.disasters || !CBZ.disasters.force) return { err: 'no director' };
    CBZ.disasters.force('flood');
    function scan(found) {
      CBZ.scene.traverse(function (o) {
        var g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
        var bs = g.boundingSphere;
        if (!bs) return;
        if (isFinite(bs.radius) && isFinite(bs.center.x) && isFinite(bs.center.y) && isFinite(bs.center.z)) return;
        if (found.some(function (f) { return f.g === g; })) return;
        var p = g.attributes.position, a = p.array, nan = 0, inf = 0, first = -1;
        for (var i = 0; i < a.length; i++) {
          var v = a[i];
          if (v !== v) { nan++; if (first < 0) first = i; }
          else if (v === Infinity || v === -Infinity) { inf++; if (first < 0) first = i; }
        }
        var chain = [], q = o;
        while (q && chain.length < 6) { chain.push((q.name || q.type) + (q.visible ? '' : '(hidden)')); q = q.parent; }
        var m = o.material; if (Array.isArray(m)) m = m[0];
        found.push({ g: g, verts: p.count, nan: nan, inf: inf, first: first, itemSize: p.itemSize,
          draw: g.drawRange ? [g.drawRange.start, g.drawRange.count] : null,
          type: o.type, culled: o.frustumCulled, chain: chain.join(' < '),
          mat: m ? (m.name || m.type) : null, phase: (CBZ.disasters.tsunamiAudit() || {}).phase,
          morph: Object.keys(g.morphAttributes || {}).join(',') });
      });
    }
    var found = [], n = 0;
    while (n++ < 5400) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      if (CBZ.game.state !== 'playing') CBZ.game.state = 'playing';
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; var c = CBZ.surv.arena.center; CBZ.player.pos.x = c.x; CBZ.player.pos.z = c.z; CBZ.player.pos.y = 140; }
      CBZ.stepSim(1 / 60);
      if (n % 20 === 0) { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} scan(found); }
      var au = CBZ.disasters.tsunamiAudit() || {};
      if (au.phase === 'flooded' && au.floodT > 3) break;
    }
    return { ticks: n, found: found.map(function (f) { delete f.g; return f; }),
             logged: CBZ.nanGeometryAudit ? CBZ.nanGeometryAudit().map(function (x) { return x.verts; }) : null };
  `);
  if (!r || r.__err || r.err) return { ok: false, summary: "probe error: " + JSON.stringify(r) };
  t.log(JSON.stringify(r, null, 1));
  return {
    ok: r.found.length === 0,
    summary: r.found.length + " meshes with a non-finite bounding sphere after " + r.ticks + " ticks" +
      (r.found.length ? ": " + r.found.map((f) => f.verts + "v " + f.chain + " [" + f.mat + "] nan " + f.nan + " inf " + f.inf).join(" | ") : ""),
    data: r,
  };
}
