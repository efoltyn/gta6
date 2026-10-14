/* lab kit "window-break": one real city building, one of its windows shot or
   punched out through the game's own entry (CBZ.cityShatterRay, the call
   fpsmode makes for a round and a fist), and a report of WHAT IS IN THE HOLE.

   OWNER: "Sometimes when I break a window, there's just this gray slab that
   replaces the window." So the probe looks through the broken window the way
   the owner does: rays from 5 m out in the street through a 3x3 grid across
   the pane, the first visible surface each one meets, and what it is.

   lab.html?kit=window-break&style=brick&floor=1&how=shoot
     style   a facade id (default brick); none = bare shell
     floor   storey index of the window (0 = ground; default 1)
     how     shoot (one round) | punch (two swings from arm's length)
     side    which face: 0 -z | 1 +z (default, the front) | 2 -x | 3 +x
     retail  1 = a storefront ground storey
     storeys default 4

   probe(): before (behind the intact glass) and after (in the broken hole):
     hit     the surface most rays met: object, material type, colour,
             opacity, how far behind the glass plane it stands
     slab    true when that surface is a flat thing standing in the opening
             (under 0.6 m behind the glass): the owner's "gray slab"
     room    true when the rays reach ≥ 1.5 m into the building (a room)
     shards  glass teeth left in the frame, glass pieces in flight
     ok      the pane is gone, nothing slab-like stands in the hole, and a
             room (or a dark room box) is what you see. */
(function () {
"use strict";
CBZ.lab.kit("window-break", {
  about: "shoot or punch out one window of a real building; probe reports what replaced the glass (material, colour, depth, room visible)",
  uses: ["street", "building"],
  files: ["src/city/interiorlight.js", "src/systems/debris.js"],
  mode: "city",
  params: { style: "brick", lot: "30x30", floor: 1, how: "shoot", side: 1, n: 3 },
  duration: 2.4,
  setup: function (W, P) {
    const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(String(P.lot || "30x30"));
    const lot = m ? [+m[1], +m[2]] : [30, 30];
    // off the origin, like every city lot: a building group at (0,0) is what
    // carveHole used to read as a free-standing slab
    const at = [+(P.x || 40), +(P.z || 60)];
    const street = W.add("street", { name: "street", lot: lot, at: at });
    W.add("building", {
      name: "building", street: street, style: P.style && P.style !== "none" ? P.style : null,
      storeys: P.storeys, doorSide: 1, retail: P.retail === "1",
    });
    // the panes: on the asked face, on the asked storey, nearest the face's middle first
    const B = W.get("building").b;
    const side = +P.side, k = +P.floor || 0, FH = B.FH > 0 ? B.FH : (B.h / Math.max(1, B.storeys));
    const cx = at[0], cz = at[1];
    const cand = [];
    for (const gp of CBZ.cityGlassRecs || []) {
      if (gp.mesh || gp.shattered) continue;
      const horiz = gp.hd < gp.hw;
      const faceOk = side === 0 ? (horiz && gp.z < cz) : side === 1 ? (horiz && gp.z > cz) : side === 2 ? (!horiz && gp.x < cx) : (!horiz && gp.x > cx);
      if (!faceOk) continue;
      if (Math.floor(gp.y / FH) !== k) continue;
      if (Math.max(gp.hw, gp.hd) * 2 < 0.4 || gp.hh * 2 < 0.4) continue;
      cand.push({ gp: gp, d: horiz ? Math.abs(gp.x - cx) : Math.abs(gp.z - cz) });
    }
    if (!cand.length) throw new Error("no pane on face " + side + " storey " + k);
    cand.sort(function (a, b) { return a.d - b.d; });
    W.panes = cand.slice(0, Math.max(1, +P.n || 1)).map(function (c) {
      const gp = c.gp, horiz = gp.hd < gp.hw;
      const out = horiz ? (gp.z > cz ? 1 : -1) : (gp.x > cx ? 1 : -1);
      const t = { gp: gp, n: horiz ? { x: 0, z: out } : { x: out, z: 0 } };
      t.before = lookThrough(t);
      return t;
    });
  },
  frame: function (W) { return [W.get("building").root]; },
  script: function (W, P) {
    const out = [];
    W.panes.forEach(function (t, i) {
      const gp = t.gp, n = t.n;
      const strike = function (force) {
        // a round from 6 m out, a fist from 0.6 m: straight at the pane's middle
        const back = force ? 6 : 0.6;
        CBZ.cityShatterRay(gp.x + n.x * back, gp.y, gp.z + n.z * back, -n.x, 0, -n.z, force ? 60 : 1.2, force, { directPlayer: true, back: force ? 0 : 0.5 });
        W.event("pane" + i, gp.shattered ? "broken" : gp.cracked ? "cracked" : "untouched");
      };
      const t0 = 0.2 + i * 0.6;
      if (P.how === "punch") {
        out.push([t0, function () { strike(false); }, "punch pane " + i]);
        out.push([t0 + 0.25, function () { strike(false); }, "punch pane " + i + " again"]);
      } else out.push([t0, function () { strike(true); }, "shoot pane " + i]);
    });
    return out;
  },
  probe: function (W, P) {
    const B = W.get("building").b;
    const deb = CBZ.debris && CBZ.debris.stats ? CBZ.debris.stats() : null;
    const carve = CBZ.cityBreachAudit ? CBZ.cityBreachAudit() : null;
    const d = function (r) { return r.hit ? r.hit.what + " " + r.hit.type + " #" + r.hit.color + (r.hit.transparent ? " op " + r.hit.opacity : "") + " " + r.hit.behind + " m in" : "nothing (sky)"; };
    let slabs = 0, rooms = 0, broken = 0, teeth = 0;
    const per = W.panes.map(function (t, i) {
      const gp = t.gp, after = lookThrough(t);
      if (gp.shattered) broken++;
      if (after.slab) slabs++;
      if (after.room) rooms++;
      const th = gp.teeth != null ? gp.teeth : 0;
      teeth += th;
      return { i: i, pane: { x: +gp.x.toFixed(2), y: +gp.y.toFixed(2), z: +gp.z.toFixed(2), w: +(Math.max(gp.hw, gp.hd) * 2).toFixed(2), h: +(gp.hh * 2).toFixed(2) },
        shattered: gp.shattered, before: t.before, after: after, teeth: th,
        line: "pane " + i + (gp.shattered ? "" : " NOT BROKEN") + ": before " + d(t.before) + " | after " + d(after) + (after.slab ? " << SLAB" : "") + (after.room ? "" : " (no room)") };
    });
    // the old carve path left its teeth on the carve record, not the pane
    (CBZ.cityWindowOpenings || []).forEach(function (o) { if (o.rec && o.rec.extras) teeth += o.rec.extras.filter(function (m) { return m.material && m.material.transparent; }).length; });
    const N = W.panes.length;
    return {
      ok: broken === N && slabs === 0 && rooms === N,
      summary: (P.how || "shoot") + " " + N + " panes, " + (B.dressStyle || "bare") + " storey " + (+P.floor || 0) + ": broken " + broken + "/" + N +
        ", SLAB in the hole " + slabs + "/" + N + ", room seen " + rooms + "/" + N + ", teeth " + teeth + ", glass pieces " + (deb ? deb.live : "?") +
        (carve && carve.calls ? ", wall carves " + carve.calls + " (last: " + carve.result + ")" : ", no wall carve") +
        "\n      " + per.map(function (p) { return p.line; }).join("\n      "),
      data: { panes: per, debris: deb, carve: carve },
    };
  },
});

/* Rays from 5 m out through a 3x3 grid across the pane; per ray the first
   visible surface past the glass plane (an intact pane is reported but looked
   past). Returns the majority hit and a slab/room verdict. */
function ob0(h) { return h.object.name || ""; }
function lookThrough(T) {
  const THREE = window.THREE, gp = T.gp, n = T.n;
  const horiz = n.x === 0;
  const plane = horiz ? gp.z : gp.x, sgn = horiz ? n.z : n.x;
  const rc = new THREE.Raycaster();
  const scene = CBZ.scene;
  scene.updateMatrixWorld(true);
  const seen = function (o) { for (let q = o; q; q = q.parent) if (q.visible === false) return false; return true; };
  const tally = {};
  let deep = 0, slab = 0, rays = 0, glassHits = 0, teethHits = 0;
  const _c = new THREE.Color();
  for (const fu of [-0.5, 0, 0.5]) for (const fv of [-0.5, 0, 0.5]) {
    const tx = horiz ? gp.x + fu * gp.hw * 1.6 : gp.x, tz = horiz ? gp.z : gp.z + fu * gp.hd * 1.6, ty = gp.y + fv * gp.hh * 1.6;
    const o = new THREE.Vector3(gp.x + n.x * 5, gp.y, gp.z + n.z * 5);
    const dir = new THREE.Vector3(tx - o.x, ty - o.y, tz - o.z).normalize();
    rc.set(o, dir); rc.far = 40;
    const hits = rc.intersectObject(scene, true);
    rays++;
    let first = null;
    for (const h of hits) {
      if (!seen(h.object)) continue;
      const mat = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      if (!mat || mat.visible === false) continue;
      if (h.object.isPoints || (h.object.userData && (h.object.userData.debrisKind || h.object.userData.debrisDust))) continue;   // flying glass, dust: not what stands in the hole
      const along = ((horiz ? h.point.z : h.point.x) - plane) * sgn;   // + = street side of the glass
      if (along > 0.05) continue;                                      // the frame, the sill, the wall face
      if (along > -0.1 && ob0(h) === "facade-trim") continue;           // the frame members and glazing bars round the glass
      const isGlass = h.object.userData && h.object.userData.glassPool && mat.transparent && mat.opacity < 0.7 && (h.object.renderOrder === 1);
      if (isGlass) { glassHits++; continue; }
      if (h.object.name === "cityGlassTeeth") { teethHits++; continue; }   // the shards left in the frame: look past them
      if (h.object.material && h.object.material.side === THREE.BackSide && h.face && h.face.normal && dir.dot(h.face.normal.clone().transformDirection(h.object.matrixWorld)) < 0) continue;
      first = { h: h, mat: mat, behind: -along };
      break;
    }
    if (!first) { tally["sky"] = (tally["sky"] || { n: 0 }); tally["sky"].n++; deep++; continue; }
    const ob = first.h.object, mat = first.mat;
    _c.copy(mat.color || _c.set(0x000000));
    const vc = mat.vertexColors && ob.geometry && ob.geometry.attributes.color;
    if (vc && first.h.face) {
      // a vertex-coloured surface: the colour where the ray landed (face average), as displayed (sRGB)
      const f = first.h.face; let r = 0, g = 0, b = 0;
      for (const vi of [f.a, f.b, f.c]) { r += vc.getX(vi) / 3; g += vc.getY(vi) / 3; b += vc.getZ(vi) / 3; }
      _c.setRGB(_c.r * r, _c.g * g, _c.b * b);
      if (_c.convertLinearToSRGB) _c.convertLinearToSRGB();
    }
    if (ob.isInstancedMesh && ob.instanceColor && first.h.instanceId != null) {
      const ic = ob.instanceColor.array, i3 = first.h.instanceId * 3;
      _c.r *= ic[i3]; _c.g *= ic[i3 + 1]; _c.b *= ic[i3 + 2];
    }
    let what = ob.name || (ob.isInstancedMesh ? "InstancedMesh" : ob.geometry ? ob.geometry.type : "mesh");
    if (!ob.name) {
      const ud = Object.keys(ob.userData || {}).concat(Object.keys(mat.userData || {}));
      if (ud.length) what += "{" + ud.join(",") + "}";
      if (ob.parent && ob.parent.name) what += "<" + ob.parent.name;
    }
    const key = what + "|" + mat.type + "|" + _c.getHexString();
    const t = tally[key] || (tally[key] = { n: 0, what: what, type: mat.type, color: _c.getHexString(), transparent: !!mat.transparent, opacity: +(mat.opacity || 1).toFixed(2),
      emissive: mat.emissive ? mat.emissive.getHexString() : null, behind: 0, map: !!mat.map });
    t.n++; t.behind = Math.max(t.behind, +first.behind.toFixed(2));
    if (first.behind < 0.6) slab++;
    if (first.behind >= 1.5) deep++;
  }
  let top = null;
  for (const k in tally) if (!top || tally[k].n > top.n) top = tally[k];
  return {
    hit: top && top.what ? top : null, rays: rays, glassInFront: glassHits, teethInFront: teethHits,
    slab: slab * 2 > rays, room: deep * 2 > rays, slabRays: slab, deepRays: deep,
    tally: Object.keys(tally).map(function (k) { return Object.assign({ key: k }, tally[k]); }),
  };
}
})();
