/* ============================================================
   systems/tunnels.js — A TUNNEL IS A HOLE LYING DOWN.

   The prison already had "alternate routes": maintenance crawls, ceiling
   hatches, drainage and a culvert. What it did not have was a route that goes
   UNDER anything — those records are trigger pairs and dressed corridors,
   because until the ground had an inside there was nowhere under the yard to
   put a tunnel. world/escape_routes.js is honest about that; it calls them
   vents and zones, not tunnels.

   With the ground a solid, a tunnel is the third carving shape and needs no new
   machinery: a swept polyline of removed material. Its middle keeps its lid —
   that is what makes it a tunnel rather than a trench, and it is the same
   subtraction that puts a street over a bunker. Its ends are open, which is what
   makes it a way in.

   THE FLOOR IS FLAT, THE ROOF IS ROUND. A swept circle gives a pipe, and a pipe
   is miserable to walk: you slide to the middle and your head clips the crown.
   So the carving's floorFn answers a LEVEL floor a little below the axis while
   the removed volume stays the full circle — you walk on a flat invert with a
   curved roof over you, which is what a culvert actually is, and the ceiling
   clamp physics.js gained in M4 keeps your head out of the crown for free.

   Flags:
     GROUND_TUNNELS     master
     TUNNEL_MIN_COVER   least earth left over the crown (m). Below this a tunnel
                        is a trench with a lie over it, and it is refused.
   Ratchet: CBZ.tunnelAudit(), tools/tunnel-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GROUND_TUNNELS == null) CBZ.CONFIG.GROUND_TUNNELS = true;
  if (CBZ.CONFIG.TUNNEL_MIN_COVER == null) CBZ.CONFIG.TUNNEL_MIN_COVER = 1.2;

  const tunnels = [];
  const stats = { built: 0, refused: 0, why: {} };
  let liningMat = null, invertMat = null;
  function mats() {
    if (liningMat) return;
    // BackSide: you are inside the pipe, so the inside is the only face that matters
    liningMat = new THREE.MeshLambertMaterial({ color: 0x5b5750, side: THREE.BackSide });
    invertMat = new THREE.MeshLambertMaterial({ color: 0x46433d });
    if (CBZ.groundMaskExempt) { CBZ.groundMaskExempt(liningMat); CBZ.groundMaskExempt(invertMat); }
  }
  function refuse(w) { stats.refused++; stats.why[w] = (stats.why[w] || 0) + 1; return null; }

  /* Points are (x, z) on the surface plus a DEPTH — the axis is solved from the
     ground at each point so a tunnel follows the terrain instead of stabbing
     out of a hillside, which is the same reason the shaft has a slope law. */
  CBZ.buildTunnel = function (pts, o) {
    o = o || {};
    if (CBZ.CONFIG.GROUND_TUNNELS === false || !CBZ.addCarving) return refuse("disabled");
    if (!pts || pts.length < 2) return refuse("needsTwoPoints");
    mats();
    const r = Math.max(1.1, o.r != null ? o.r : 1.6);
    const depth = Math.max(r + CBZ.CONFIG.TUNNEL_MIN_COVER, o.depth != null ? o.depth : r + 2.2);
    const axis = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const surf = CBZ.groundBaseAt ? CBZ.groundBaseAt(p.x, p.z) : 0;
      if (!Number.isFinite(surf)) return refuse("badPoint");
      const y = p.y != null ? p.y : surf - depth;
      if (surf - (y + r) < CBZ.CONFIG.TUNNEL_MIN_COVER && !o.force) return refuse("tooShallow");
      axis.push({ x: p.x, y: y, z: p.z, surf: surf });
    }
    const t = {
      pts: axis, r: r, mode: CBZ.game ? CBZ.game.mode : null,
      name: o.name || "tunnel", openEnds: o.openEnds !== false,
    };
    let lo = Infinity;
    for (let i = 0; i < axis.length; i++) lo = Math.min(lo, axis[i].y - r);
    /* THE INVERT. A flat walking surface a little under the axis, so the tube is
       a culvert and not a slide. Everything else about the volume stays round. */
    t.carve = CBZ.addCarving({
      kind: "tube", pts: axis, r: r, y0: lo, y1: -Infinity,
      open: false, dry: true, owner: "tunnel", mode: t.mode,
      floorFn: function (x, z) {
        let best = null, bd = Infinity;
        for (let i = 0; i < axis.length - 1; i++) {
          const a = axis[i], b = axis[i + 1];
          const ex = b.x - a.x, ez = b.z - a.z;
          const L2 = ex * ex + ez * ez;
          let s = L2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / L2 : 0;
          if (s < 0) s = 0; else if (s > 1) s = 1;
          const px = a.x + ex * s - x, pz = a.z + ez * s - z;
          const d = px * px + pz * pz;
          if (d < bd) { bd = d; best = a.y + (b.y - a.y) * s; }
        }
        return best == null ? lo : best - r * 0.55;
      },
    });
    t.grp = buildLining(t);
    tunnels.push(t);
    stats.built++;
    if (t.openEnds) {
      t.mouths = [];
      for (const k of [0, axis.length - 1]) {
        const a = axis[k];
        const sh = CBZ.groundShaft ? CBZ.groundShaft(a.x, a.z, {
          r: Math.max(2.2, r * 1.5), depth: a.surf - (a.y - r * 0.55), gy: a.surf, surface: "soil",
        }) : null;
        if (sh) { sh.tunnelMouth = true; t.mouths.push(sh); }
      }
    }
    return t;
  };

  function buildLining(t) {
    const g = new THREE.Group();
    g.userData.tunnel = true;
    const curve = new THREE.CatmullRomCurve3(t.pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    const segs = Math.max(12, Math.round(curve.getLength() / 2));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, t.r, 12, false), liningMat);
    g.add(tube);
    // the flat invert you actually walk on
    const N = segs;
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = curve.getPointAt(i / N);
      const tg = curve.getTangentAt(i / N);
      const nx = -tg.z, nz = tg.x;
      const L = Math.hypot(nx, nz) || 1;
      const w = t.r * 0.72;
      pos.push(p.x + (nx / L) * w, p.y - t.r * 0.55, p.z + (nz / L) * w);
      pos.push(p.x - (nx / L) * w, p.y - t.r * 0.55, p.z - (nz / L) * w);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, invertMat));
    (CBZ.prisonRoot && CBZ.game && CBZ.game.mode === "prison" ? CBZ.prisonRoot : CBZ.scene).add(g);
    return g;
  }

  CBZ.tunnelAudit = function () {
    let len = 0;
    for (let i = 0; i < tunnels.length; i++) {
      const P = tunnels[i].pts;
      for (let k = 0; k < P.length - 1; k++) len += Math.hypot(P[k + 1].x - P[k].x, P[k + 1].z - P[k].z);
    }
    return {
      tunnels: tunnels.length, metres: +len.toFixed(1),
      built: stats.built, refused: stats.refused, why: stats.why,
      minCover: CBZ.CONFIG.TUNNEL_MIN_COVER, enabled: CBZ.CONFIG.GROUND_TUNNELS !== false,
    };
  };
  CBZ.tunnelsClear = function () {
    for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i];
      if (t.carve) CBZ.removeCarving(t.carve);
      if (t.mouths) t.mouths.forEach((m) => { if (m && !m._closed) m.dispose(); });
      if (t.grp) { t.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); if (t.grp.parent) t.grp.parent.remove(t.grp); }
    }
    tunnels.length = 0;
  };
  CBZ.tunnels = tunnels;
})();
