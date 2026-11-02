/* ============================================================
   entities/jewels.js — THE JEWELLERY LIBRARY (CBZ.jewels), the hats'
   sibling: watches, bracelets, chains with pendants, rings, earrings and
   grills, procedural, one cached geometry per (piece, metal part / enamel
   part), two shared materials (polished metal that takes the environment,
   and a glossy enamel for dials and stones' settings).

   Owner (2026-11-02): "the only other thing allowed on a stickman: watches
   and jewelry — it can nail that."

   FRAMES (each piece is authored in the unit frame of what it is worn on;
   the wearer scales it by that thing's radius):
     wrist   the forearm: axis +Y, radius 1; the watch face on +X (the back
             of a LEFT wrist; a right wrist turns it round Y)
     neck    the top of the spine: radius 1 = the spine's radius, +Z the
             front, the chain loops round behind and hangs in front
     finger  the hand ball's centre: radius 1 = the ball; fingers are -Z
     ear     the head ball (as hats): radius 1, +Z the face, ears at +/-X
     mouth   the head ball: the front of the face low down

   PUBLIC  CBZ.jewels = {
     ids(), info(id) -> {id, name, mount, slot, tags},
     parts(id) -> {metal: geometry|null, enamel: geometry|null},
     materials() -> {metal, enamel}, mesh(id) -> THREE.Group,
     byMount(mount), byTag(tag), audit()
   }
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;
  if (!THREE || CBZ.jewels || !CBZ.hats || !CBZ.hats.kit) return;
  const TAU = Math.PI * 2, V3 = THREE.Vector3;

  const M = {   // colours you SEE (stored linear by the merge)
    gold: 0xf2c14e, rose: 0xe6a58e, silver: 0xdfe3e8, steel: 0xb8bec6, black: 0x2a2c31, iced: 0xf4f8ff,
    ruby: 0xd0203a, emerald: 0x1fa060, sapphire: 0x2050d0, white: 0xf2f2ee, dial: 0x101216, green: 0x6cff9a,
    orange: 0xff7a1a, leather: 0x5a3220, wood: 0x8a5a32, jade: 0x4aa878,
  };
  const CAT = [], BY = Object.create(null);
  function def(id, name, mount, slot, build, tags) { const d = { id: id, name: name, mount: mount, slot: slot, build: build, tags: tags || [] }; CAT.push(d); BY[id] = d; return d; }
  // part colours are literal hex here; `e` marks an enamel part (dial, glass, leather)
  function P(K, g, hex, e, xf) { K.put(g, hex, xf); K.parts[K.parts.length - 1].e = !!e; }

  /* ===== WATCHES (wrist) ===== */
  function watch(K, o) {
    // the band round the wrist, the case on the back of it, the dial, the crown
    P(K, K.torus(1.3, (o.band || 0.3) * 1.25, { n: 30, m: 8 }), o.strap != null ? o.strap : o.metal, !!o.strapE, { r: [Math.PI / 2, 0, 0], s: [1, 1, 0.9] });
    // a stickman's watch reads at street distance: the face is ~3 forearms across
    const caseR = (o.caseR || 0.95) * 1.55;
    if (o.square) P(K, K.box(0.5, caseR * 1.6, caseR * 1.6), o.metal, false, { p: [1.5, 0, 0] });
    else P(K, K.cyl(caseR, caseR, 0.5, { n: 20 }), o.metal, false, { p: [1.62, 0, 0], r: [0, 0, Math.PI / 2] });
    if (o.square) P(K, K.box(0.06, caseR * 1.3, caseR * 1.3), o.dial || M.dial, true, { p: [1.89, 0, 0] });
    else P(K, K.cyl(caseR * 0.82, caseR * 0.82, 0.06, { n: 20 }), o.dial || M.dial, true, { p: [1.89, 0, 0], r: [0, 0, Math.PI / 2] });
    if (!o.square) {
      // the hands of the clock, on the dial
      P(K, K.box(0.03, 0.8, 0.09), o.hands || M.white, true, { p: [1.93, 0.34, 0], r: [0.4, 0, 0] });
      P(K, K.box(0.03, 0.6, 0.09), o.hands || M.white, true, { p: [1.93, 0.0, 0.25], r: [-1.2, 0, 0] });
    } else P(K, K.box(0.03, 0.26, 0.9), o.hands || M.green, true, { p: [1.93, 0, 0] });
    P(K, K.cyl(0.13, 0.13, 0.22, { n: 8 }), o.metal, false, { p: [1.62, 0, caseR + 0.08], r: [Math.PI / 2, 0, 0] });
    if (o.bezel) {
      P(K, K.torus(caseR * 0.9, 0.16, { n: 24, m: 6 }), o.bezel, false, { p: [1.88, 0, 0], r: [0, Math.PI / 2, 0] });
      if (o.stones) for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; P(K, K.ball(0.15, 6), o.stones, false, { p: [1.97, Math.cos(a) * caseR * 0.9, Math.sin(a) * caseR * 0.9] }); }
    }
  }
  def("watch_steel", "Steel Watch", "wrist", "watch", function (K) { watch(K, { metal: M.steel, dial: 0x1a2a44 }); }, ["civ", "law"]);
  def("watch_gold", "Gold Watch", "wrist", "watch", function (K) { watch(K, { metal: M.gold, dial: 0xf2ead2, hands: 0x1a1a1a, bezel: M.gold }); }, ["rich", "boss"]);
  def("watch_diamond", "Diamond Watch", "wrist", "watch", function (K) { watch(K, { metal: M.gold, dial: 0x0a0a0c, bezel: M.iced, stones: M.iced, caseR: 1.05 }); }, ["boss", "rich"]);
  def("watch_iced", "Iced-Out Watch", "wrist", "watch", function (K) { watch(K, { metal: M.iced, dial: 0x8ab8ff, bezel: M.iced, stones: M.iced, caseR: 1.1 }); }, ["boss"]);
  def("watch_digital", "Digital Watch", "wrist", "watch", function (K) { watch(K, { metal: M.black, strap: 0x1c1d22, strapE: true, square: true, caseR: 0.78, dial: 0x0e1a12, hands: M.green }); }, ["civ"]);
  def("watch_sport", "Sport Watch", "wrist", "watch", function (K) { watch(K, { metal: M.black, strap: M.orange, strapE: true, band: 0.36, caseR: 1.05, dial: 0x111111, bezel: M.orange }); }, ["civ", "military"]);
  def("watch_dress", "Dress Watch", "wrist", "watch", function (K) { watch(K, { metal: M.silver, strap: M.leather, strapE: true, band: 0.24, caseR: 0.85, dial: 0xf4f0e6, hands: 0x101010 }); }, ["rich", "civ"]);

  /* ===== BRACELETS (the other wrist) ===== */
  function links(K, R, n, tube, hex, axis) {
    // a ring of small links round the wrist (axis Y)
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      P(K, K.torus(0.22, tube, { n: 8, m: 5 }), hex, false, { p: [Math.cos(a) * R, 0, Math.sin(a) * R], r: [i % 2 ? Math.PI / 2 : 0, -a, 0], o: "YXZ" });
    }
  }
  def("bracelet_gold", "Gold Bracelet", "wrist", "bracelet", function (K) { links(K, 1.18, 16, 0.08, M.gold); }, ["rich", "boss"]);
  def("bracelet_tennis", "Tennis Bracelet", "wrist", "bracelet", function (K) {
    P(K, K.torus(1.16, 0.08, { n: 30, m: 5 }), M.silver, false, { r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; P(K, K.ball(0.14, 6), M.iced, false, { p: [Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2] }); }
  }, ["boss", "rich"]);
  def("bangle_silver", "Silver Bangle", "wrist", "bracelet", function (K) { P(K, K.torus(1.25, 0.14, { n: 30, m: 8 }), M.silver, false, { r: [Math.PI / 2, 0, 0] }); }, ["civ"]);
  def("bracelet_beads", "Bead Bracelet", "wrist", "bracelet", function (K) {
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; P(K, K.ball(0.2, 7), i % 3 ? M.wood : M.jade, true, { p: [Math.cos(a) * 1.22, 0, Math.sin(a) * 1.22] }); }
  }, ["civ"]);

  /* ===== CHAINS (neck) =====
     The loop: round behind the neck at the spine's top, down in front to the
     pendant. Points in spine radii. */
  function chainPath(drop, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, c = Math.cos(a), sn = Math.sin(a);
      const front = Math.max(0, c);
      pts.push([1.75 * sn, -drop * Math.pow(front, 1.7) + 0.15, c > 0 ? 1.55 * c : 1.25 * c]);
    }
    return pts;
  }
  function rope(K, drop, tube, hex) { P(K, K.tube(chainPath(drop, 28), tube, { closed: true, n: 60, m: 6 }), hex, false); }
  function cuban(K, drop, hex) {
    // chunky flat links laid along the loop
    const curve = new THREE.CatmullRomCurve3(chainPath(drop, 28).map(function (p) { return new V3(p[0], p[1], p[2]); }), true);
    const n = 34, q = new THREE.Quaternion(), m = new THREE.Matrix4(), up = new V3(0, 0, 1);
    for (let i = 0; i < n; i++) {
      const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const g = K.torus(0.26, 0.11, { n: 10, m: 5 });
      g.scale(1.25, 0.8, 1);
      // the link's long axis along the chain, lying flat (alternating a quarter turn)
      const side = new V3().crossVectors(tg, new V3(0, 1, 0)).normalize();
      const nrm = new V3().crossVectors(side, tg).normalize();
      m.makeBasis(tg, i % 2 ? nrm : side, i % 2 ? side : nrm);
      g.applyMatrix4(m); g.translate(p.x, p.y, p.z);
      P(K, g, hex, false);
    }
  }
  function bottom(drop) { return [0, -drop + 0.15, 1.55]; }
  function cross(K, at, hex, s) {
    s = s || 1;
    P(K, K.box(0.22 * s, 1.1 * s, 0.14 * s), hex, false, { p: [at[0], at[1] - 0.6 * s, at[2] + 0.05] });
    P(K, K.box(0.7 * s, 0.22 * s, 0.14 * s), hex, false, { p: [at[0], at[1] - 0.38 * s, at[2] + 0.05] });
    P(K, K.torus(0.1, 0.035, { n: 8, m: 4 }), hex, false, { p: [at[0], at[1] - 0.02, at[2]], r: [0, Math.PI / 2, 0] });
  }
  function medallion(K, at, hex, gem) {
    P(K, K.cyl(0.55, 0.55, 0.12, { n: 20 }), hex, false, { p: [at[0], at[1] - 0.62, at[2] + 0.05], r: [Math.PI / 2, 0, 0] });
    P(K, K.torus(0.55, 0.07, { n: 20, m: 5 }), hex, false, { p: [at[0], at[1] - 0.62, at[2] + 0.06] });
    if (gem) P(K, K.ball(0.2, 8), gem, false, { p: [at[0], at[1] - 0.62, at[2] + 0.15], s: [1, 1, 0.6] });
    P(K, K.torus(0.1, 0.035, { n: 8, m: 4 }), hex, false, { p: [at[0], at[1] - 0.02, at[2]], r: [0, Math.PI / 2, 0] });
  }
  def("chain_rope", "Gold Rope Chain", "neck", "chain", function (K) { rope(K, 3.6, 0.16, M.gold); }, ["gang", "rich"]);
  def("chain_silver", "Silver Chain", "neck", "chain", function (K) { rope(K, 3.2, 0.11, M.silver); }, ["civ"]);
  def("chain_cross", "Gold Cross", "neck", "chain", function (K) { rope(K, 3.4, 0.12, M.gold); cross(K, bottom(3.4), M.gold, 1); }, ["gang", "civ"]);
  def("chain_cuban", "Cuban Link", "neck", "chain", function (K) { cuban(K, 3.2, M.gold); }, ["boss", "gang"]);
  def("chain_medallion", "Gold Medallion", "neck", "chain", function (K) { cuban(K, 3.9, M.gold); medallion(K, bottom(3.9), M.gold, M.ruby); }, ["boss"]);
  def("chain_iced", "Iced Chain", "neck", "chain", function (K) { cuban(K, 3.6, M.iced); medallion(K, bottom(3.6), M.iced, M.iced); }, ["boss"]);
  def("chain_dollar", "Dollar Chain", "neck", "chain", function (K) {
    rope(K, 3.8, 0.15, M.gold);
    const at = bottom(3.8);
    P(K, K.tube([[0.28, -0.25, 0], [0, -0.12, 0], [-0.28, -0.32, 0], [0, -0.6, 0], [0.28, -0.88, 0], [0, -1.08, 0], [-0.28, -0.95, 0]].map(function (p) { return [at[0] + p[0], at[1] + p[1] - 0.1, at[2] + 0.08]; }), 0.08, { n: 18, m: 5 }), M.gold, false);
    P(K, K.box(0.08, 1.2, 0.08), M.gold, false, { p: [at[0], at[1] - 0.68, at[2] + 0.12] });
  }, ["gang", "boss"]);
  def("dogtags", "Dog Tags", "neck", "chain", function (K) {
    // a fine ball chain and two stamped steel tags
    P(K, K.tube(chainPath(3.0, 28), 0.06, { closed: true, n: 50, m: 5 }), M.steel, false);
    const at = bottom(3.0);
    P(K, K.box(0.62, 1.0, 0.05), M.steel, false, { p: [at[0] - 0.08, at[1] - 0.55, at[2] + 0.06], r: [0, 0, 0.12] });
    P(K, K.box(0.62, 1.0, 0.05), M.silver, false, { p: [at[0] + 0.1, at[1] - 0.62, at[2] + 0.1], r: [0, 0, -0.18] });
  }, ["military"]);

  /* ===== RINGS (finger, on the hand ball) ===== */
  function ring(K, hex, top, topHex, flat) {
    // seated flush on the ball, on the finger side (-Z), axis along the radius
    const dir = new V3(0.25, -0.35, -1).normalize(), at = dir.clone().multiplyScalar(0.92);
    const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, 1), dir), e = new THREE.Euler().setFromQuaternion(q);
    P(K, K.torus(0.62, 0.2, { n: 16, m: 6 }), hex, false, { p: [at.x, at.y, at.z], r: [e.x, e.y, e.z] });
    if (top) {
      const tp = dir.clone().multiplyScalar(1.12);
      if (flat) P(K, K.cyl(0.42, 0.42, 0.16, { n: 12 }), topHex, false, { p: [tp.x, tp.y, tp.z], r: [e.x + Math.PI / 2, e.y, e.z] });
      else P(K, K.ball(0.34, 8), topHex, false, { p: [tp.x, tp.y, tp.z] });
    }
  }
  def("ring_gold", "Gold Band", "finger", "ring", function (K) { ring(K, M.gold); }, ["civ", "rich"]);
  def("ring_diamond", "Diamond Ring", "finger", "ring", function (K) { ring(K, M.gold, true, M.iced); }, ["rich", "boss"]);
  def("ring_signet", "Signet Ring", "finger", "ring", function (K) { ring(K, M.gold, true, M.ruby, true); }, ["boss", "gang"]);
  def("ring_iced", "Iced Pinky", "finger", "ring", function (K) { ring(K, M.iced, true, M.iced); }, ["boss"]);

  /* ===== EARRINGS (both ears, on the head ball) ===== */
  def("studs_diamond", "Diamond Studs", "ear", "ear", function (K) { for (const s of [-1, 1]) P(K, K.ball(0.13, 8), M.iced, false, { p: [s * 1.0, -0.12, 0.02] }); }, ["gang", "rich"]);
  def("studs_gold", "Gold Studs", "ear", "ear", function (K) { for (const s of [-1, 1]) P(K, K.ball(0.12, 8), M.gold, false, { p: [s * 1.0, -0.12, 0.02] }); }, ["civ"]);
  def("hoops_gold", "Gold Hoops", "ear", "ear", function (K) { for (const s of [-1, 1]) P(K, K.torus(0.22, 0.045, { n: 16, m: 5 }), M.gold, false, { p: [s * 1.02, -0.34, 0.02], r: [0, Math.PI / 2, 0] }); }, ["civ", "gang"]);

  /* ===== GRILLS (the front of the face, low: a stick has no mouth, so the grill is the mouth) ===== */
  def("grill_gold", "Gold Grill", "mouth", "grill", function (K) {
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.11, y = -0.36, rr = Math.sqrt(1 - y * y) + 0.01;
      P(K, K.box(0.1, 0.13, 0.05), M.gold, false, { p: [Math.sin(a) * rr, y, Math.cos(a) * rr], r: [0, a, 0] });
    }
  }, ["boss", "gang"]);
  def("grill_iced", "Iced Grill", "mouth", "grill", function (K) {
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.11, y = -0.36, rr = Math.sqrt(1 - y * y) + 0.01;
      P(K, K.box(0.1, 0.13, 0.05), M.iced, false, { p: [Math.sin(a) * rr, y, Math.cos(a) * rr], r: [0, a, 0] });
    }
  }, ["boss"]);

  /* ---------------------------------------------------------------- the cache */
  let MATS = null;
  function materials() {
    if (MATS) return MATS;
    const env = CBZ.jewel && CBZ.jewel.env ? CBZ.jewel.env() : null;
    const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 1.0, roughness: 0.2, envMap: env, envMapIntensity: 1.35 });
    const enamel = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.0, roughness: 0.28, envMap: env, envMapIntensity: 0.6 });
    metal._shared = enamel._shared = true; metal.name = "jewels-metal"; enamel.name = "jewels-enamel";
    // the shared street environment arrives late on some pages: keep both on it
    if (CBZ.jewel && CBZ.jewel.adopt) { CBZ.jewel.adopt(metal); CBZ.jewel.adopt(enamel); }
    MATS = { metal: metal, enamel: enamel };
    return MATS;
  }
  const GEO = new Map();
  function parts(id) {
    const d = BY[id]; if (!d) return null;
    let r = GEO.get(id);
    if (r) return r;
    const K = CBZ.hats.kit(0);
    d.build(K);
    const met = K.parts.filter(function (p) { return !p.e; }), ena = K.parts.filter(function (p) { return p.e; });
    r = { metal: met.length ? CBZ.hats.merge(met, {}, true) : null, enamel: ena.length ? CBZ.hats.merge(ena, {}, true) : null };
    GEO.set(id, r);
    return r;
  }
  function mesh(id) {
    const pr = parts(id); if (!pr) return null;
    const m = materials(), g = new THREE.Group();
    g.name = "jewel:" + id; g.userData.jewelId = id;
    if (pr.metal) { const a = new THREE.Mesh(pr.metal, m.metal); a.castShadow = false; g.add(a); }
    if (pr.enamel) { const b = new THREE.Mesh(pr.enamel, m.enamel); b.castShadow = false; g.add(b); }
    return g;
  }
  CBZ.jewels = {
    ids: function () { return CAT.map(function (d) { return d.id; }); },
    info: function (id) { const d = BY[id]; return d ? { id: d.id, name: d.name, mount: d.mount, slot: d.slot, tags: d.tags.slice() } : null; },
    has: function (id) { return !!BY[id]; },
    byMount: function (mount) { return CAT.filter(function (d) { return d.mount === mount; }).map(function (d) { return d.id; }); },
    byTag: function (tag) { return CAT.filter(function (d) { return d.tags.indexOf(tag) >= 0; }).map(function (d) { return d.id; }); },
    parts: parts, materials: materials, mesh: mesh, METAL: M,
    audit: function () { let v = 0; GEO.forEach(function (r) { if (r.metal) v += r.metal.attributes.position.count; if (r.enamel) v += r.enamel.attributes.position.count; }); return { kinds: CAT.length, built: GEO.size, verts: v }; },
  };
})();
