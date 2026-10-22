/* ============================================================
   city/clothingstore.js — THE WALK-IN CLOTHING STORE: the rack IS
   the wardrobe.

   Civilians spawn plain (white tee, blue jeans), so a LOOK is something you
   go and get, and this is where. Everything on the floor is stock: walk up
   to a garment or a dressed form and TAKE it (it is in your hands), try it
   on at the full-length mirror or in the fitting room, and PAY at the
   counter. Walk out with it unpaid and it is a theft, through the one shop
   ledger every store keeps (city/shopfloor.js CBZ.shopFloor.till). The mirror also opens your wardrobe (mix what
   you own; the tuxedo is taken off its form there).

   ONE FILE, EVERY STORE: Gang City's outfitter is one instance; every island
   outfitter and tailor (world/island_shops.js, CBZ.clothingStoreMount) is
   another. A tailor hangs suits, shirts, ties and trousers, fewer of them,
   on darker wood, at a tailor's prices.

   THE ROOM, built like a real menswear floor (2026-09-27 de-slop):
     • side walls: slatwall panels with face-out arms, one garment per arm,
       every garment a real cut silhouette on a real hanger (shirt with
       collar and placket, blazer with lapels over a shirt V, trousers on a
       clamp hanger, dresses on strap hangers, ties over a tie bar);
     • a double-sided slatwall spine down the middle when the room is deep;
     • three dressed display forms by the door, two more in the window under
       a ceiling track with spot heads (the only things that glow are the
       lamp lenses and the till screen);
     • a nesting table of folded stacks, the cash wrap dressed with the store
       fixture kit (cladding, worktop, till, card reader, bags);
     • a fitting room with solid partition walls, a curtain on a ceiling
       track, a bench and a hook, and the full-length mirror beside it.
   Every fixture merges through CBZ.storeFixtureKit (gunstore.js) into a
   handful of meshes per finish; the floor group only draws while you are in
   the shell, the window group only from the pavement in front of it.

   Stock + prices come from cityEcon.itemsByTag("clothing"); garment cut and
   colour come from CBZ.cityComposableSpec(visualId) so the rack shows the
   same colour the rig will wear. Buying routes through CBZ.city.spend →
   CBZ.cityGrantItem → CBZ.cityWear.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const VIS_R = 24;          // racks only draw when you're basically at the door
  const RACK_REACH = 3.0;    // walk right up to a garment / form / mirror
  const RACK_DOT = 0.62;     // you act on the fixture you're LOOKING at
  const HERO_FORMS = 3;      // dressed forms that greet you at the door (the rest hang)
  const ARM_Y = 1.72;        // face-out arm height above the finished floor
  const WIN_R = 26;          // how far down the pavement the window display reads

  // Per-store variation comes off the LOT's own coordinates, never Math.random
  // in a build path: the world must be identical per seed on every client.
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }

  function econ() { return CBZ.cityEcon || null; }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function e_buy(name) { const e = econ(); return (e && e.buyPrice) ? e.buyPrice(name) : 0; }

  // ============================================================
  //  CATALOG → which visualIds hang on the runs vs ride a display form.
  //  The forms show the "complete fit" anchors (the priciest jackets); the
  //  runs carry everything else, grouped by slot and sorted by colour so a
  //  run reads as a buyer's edit instead of a bin.
  // ============================================================
  const SLOT_ORDER = ["shirt", "neck", "legs", "jacket", "dress", "outfit"];
  function hueOf(hex) {
    const r = ((hex >> 16) & 255) / 255, gr = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), d = mx - mn;
    if (d < 0.06) return -1 + (1 - mx);
    let h;
    if (mx === r) h = ((gr - b) / d + 6) % 6;
    else if (mx === gr) h = (b - r) / d + 2;
    else h = (r - gr) / d + 4;
    return h / 6;
  }
  // what a TAILOR stocks: the cut pieces (lookOf's types), not the streetwear
  const TAILORED = { suit: 1, blazer: 1, tie: 1, bowtie: 1, collar: 1, trousers: 1 };
  function partitionStock(tailor) {
    const e = econ();
    const list = (e && e.itemsByTag) ? e.itemsByTag("clothing") : [];
    const wall = [], jackets = [], tux = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.visualId || !CBZ.cityComposableSpec) continue;
      const sp = CBZ.cityComposableSpec(it.visualId);
      if (!sp) continue;
      if (tailor && !sp.painted && !TAILORED[lookOf(it.visualId).type]) continue;
      if (tailor && sp.painted && sp.painted !== "tuxedo" && sp.painted !== "suit") continue;
      if (sp.painted === "tuxedo") { tux.push(it); continue; }   // the apex, sold at the mirror
      it._slot = sp.slot || "shirt";
      it._hue = hueOf(sp.color != null ? sp.color : 0x8a8f97);
      if (sp.slot === "jacket") jackets.push(it); else wall.push(it);
    }
    // three heroes greet you (the priciest looks); every other jacket hangs
    jackets.sort(function (a, b) { return (e_buy(b.name) - e_buy(a.name)) || (a.name < b.name ? -1 : 1); });
    const forms = jackets.slice(0, HERO_FORMS);
    for (let i = HERO_FORMS; i < jackets.length; i++) wall.push(jackets[i]);
    wall.sort(function (a, b) {
      const ia = SLOT_ORDER.indexOf(a._slot), ib = SLOT_ORDER.indexOf(b._slot);
      const ra = ia < 0 ? 99 : ia, rb = ib < 0 ? 99 : ib;
      if (ra !== rb) return ra - rb;
      return (a._hue - b._hue) || (a.name < b.name ? -1 : 1);
    });
    return { wall, forms, tux: tux[0] || null };
  }

  // ============================================================
  //  WHAT A GARMENT IS. The composable spec's own draw() is a rig overlay
  //  (a 0.9 m torso block for every painted look), which is exactly the
  //  "coloured slab on a rail" read. The rack draws the CUT instead, from
  //  the same spec: its slot, its painted id and its colours.
  // ============================================================
  function lookOf(visualId) {
    const sp = CBZ.cityComposableSpec ? CBZ.cityComposableSpec(visualId) : null;
    const pr = (sp && sp.paintRec) || null, pc = (pr && pr.colors) || {};
    const c = pc.torso != null ? pc.torso : (sp && sp.color != null ? sp.color : 0x8a8f97);
    const L = { type: "tee", c: c, c2: pc.collar != null ? pc.collar : null,
                legs: pc.legs != null ? pc.legs : (sp && sp.legsHex != null ? sp.legsHex : null),
                shirt: 0xf1f2ec, neck: null, bow: false };
    const id = String(visualId || ""), paint = sp && sp.painted, slot = sp && sp.slot;
    if (paint) {
      if (paint === "tuxedo" || /tux/i.test((sp && sp.label) || "")) { L.type = "suit"; L.bow = true; L.legs = L.legs != null ? L.legs : c; }
      else if (paint === "suit") { L.type = "suit"; L.neck = tone(c, -0.35); L.legs = L.legs != null ? L.legs : c; }
      else if (paint === "waiter") { L.type = "suit"; L.bow = true; L.legs = c; }
      else if (paint === "pilot") { L.type = "pilot"; L.neck = 0x1a1c24; }
      else if (paint === "hoodie") L.type = "hoodie";
      else if (paint === "puffer") L.type = "puffer";
      else if (paint === "denim_jacket") L.type = "denim";
      else if (paint === "varsity") L.type = "varsity";
      else if (/^tracksuit/.test(paint)) { L.type = "track"; L.legs = c; }
      else if (paint === "coveralls") { L.type = "coveralls"; L.legs = c; }
      else if (paint === "chef") L.type = "chef";
      else if (paint === "dress" || paint === "sundress") L.type = "dress";
      else if (paint === "blouse") L.type = "blouse";
      else if (paint === "graphic_tee") L.type = "tee";
      else L.type = "jacket";
    } else if (slot === "legs") L.type = "trousers";
    else if (slot === "neck") L.type = id.indexOf("bow") >= 0 ? "bowtie" : "tie";
    else if (slot === "jacket") L.type = id.indexOf("bomber") >= 0 ? "bomber" : "blazer";
    else if (slot === "shirt") L.type = id.indexOf("collar") >= 0 ? "collar" : "tee";
    return L;
  }
  function tone(n, amt) {
    let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
    if (amt > 0) { r += (255 - r) * amt; gg += (255 - gg) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; gg *= 1 + amt; b *= 1 + amt; }
    return ((r | 0) << 16) | ((gg | 0) << 8) | (b | 0);
  }

  // ---- geometry cache: unit primitives + cut silhouettes (never disposed) ---
  const GEO = {};
  function unitBox() { return GEO.box || (GEO.box = new THREE.BoxGeometry(1, 1, 1)); }
  function unitCyl(ratio, seg) {
    const k = "cyl" + (ratio == null ? 1 : ratio).toFixed(3) + "_" + (seg || 10);
    return GEO[k] || (GEO[k] = new THREE.CylinderGeometry(ratio == null ? 1 : ratio, 1, 1, seg || 10));
  }
  function unitSph() { return GEO.sph || (GEO.sph = new THREE.SphereGeometry(1, 12, 8)); }
  function mirrorPts(p) { const o = []; for (let i = p.length - 1; i >= 0; i--) o.push([-p[i][0], p[i][1]]); return o; }
  function prismGeo(key, pts, depth, bevel) {
    if (GEO[key]) return GEO[key];
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    const gg = new THREE.ExtrudeGeometry(s, bevel
      ? { depth: depth, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: bevel, bevelThickness: bevel }
      : { depth: depth, steps: 1, bevelEnabled: false });
    gg.translate(0, 0, -depth / 2);
    gg.computeVertexNormals();
    return (GEO[key] = gg);
  }

  // ---- placing parts into a kit through an optional parent transform --------
  const _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function put(k, P, geo, col, kind, x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    _p.set(x || 0, y || 0, z || 0);
    _s.set(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz);
    _l.compose(_p, _q, _s);
    if (P) _l.premultiply(P);
    _l.premultiply(k.F);
    k.put(geo, _l, col, kind || "solid", false);
  }
  function bx(k, P, x, y, z, w, h, d, col, kind, rx, ry, rz) { put(k, P, unitBox(), col, kind, x, y, z, rx, ry, rz, w, h, d); }
  function cy(k, P, x, y, z, r, h, col, kind, rx, ry, rz, rTop, seg, sz) {
    put(k, P, unitCyl(rTop == null ? 1 : rTop / r, seg), col, kind, x, y, z, rx, ry, rz, r, h, sz == null ? r : r * sz);
  }
  function sph(k, P, x, y, z, rx_, ry_, rz_, col, kind) { put(k, P, unitSph(), col, kind, x, y, z, 0, 0, 0, rx_, ry_, rz_); }
  function xf(x, y, z, ry, parent) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0)), new THREE.Vector3(1, 1, 1));
    if (parent) m.premultiply(parent);
    return m;
  }

  // ---- the cut silhouettes (x across, y down from the arm centreline) -------
  const CUT = {
    shirt: [[-0.07, -0.075], [-0.2, -0.12], [-0.212, -0.28], [-0.222, -0.8], [0.222, -0.8], [0.212, -0.28], [0.2, -0.12], [0.07, -0.075], [0, -0.115]],
    blouse: [[-0.065, -0.08], [-0.19, -0.12], [-0.2, -0.28], [-0.205, -0.7], [0.205, -0.7], [0.2, -0.28], [0.19, -0.12], [0.065, -0.08], [0, -0.2]],
    slvLong: [[-0.2, -0.12], [-0.245, -0.15], [-0.262, -0.62], [-0.212, -0.63], [-0.205, -0.3]],
    slvShort: [[-0.2, -0.12], [-0.262, -0.17], [-0.248, -0.31], [-0.205, -0.29]],
    collar: [[-0.07, -0.075], [-0.004, -0.115], [-0.03, -0.17], [-0.092, -0.118]],
    jkSlv: [[-0.225, -0.115], [-0.272, -0.15], [-0.288, -0.66], [-0.232, -0.672], [-0.228, -0.32]],
    lapel: [[-0.075, -0.07], [0, -0.44], [-0.034, -0.44], [-0.135, -0.18], [-0.112, -0.122]],
    shirtV: [[-0.068, -0.078], [0.068, -0.078], [0, -0.44]],
    trouser: [[-0.19, -0.085], [0.19, -0.085], [0.205, -0.33], [0.17, -1.1], [0.03, -1.1], [0, -0.42], [-0.03, -1.1], [-0.17, -1.1], [-0.205, -0.33]],
    dress: [[-0.12, -0.16], [-0.06, -0.215], [0.06, -0.215], [0.12, -0.16], [0.13, -0.37], [0.3, -1.05], [-0.3, -1.05], [-0.13, -0.37]],
    tieF: [[-0.03, -0.07], [0.03, -0.07], [0.045, -0.53], [0, -0.58], [-0.045, -0.53]],
    tieB: [[-0.02, -0.07], [0.02, -0.07], [0.028, -0.45], [0, -0.48], [-0.028, -0.45]],
    bow: [[0, -0.105], [-0.05, -0.08], [-0.1, -0.09], [-0.105, -0.155], [-0.05, -0.165], [0, -0.135], [0.05, -0.165], [0.105, -0.155], [0.1, -0.09], [0.05, -0.08]],
  };
  function jacketCut(len) {
    return [[-0.075, -0.07], [-0.225, -0.115], [-0.235, -0.3], [-0.24, -len], [0.24, -len], [0.235, -0.3], [0.225, -0.115], [0.075, -0.07], [0, -0.12]];
  }
  function cut(key, pts, depth, bevel) { return prismGeo(key, pts, depth, bevel); }
  function cutPair(k, P, key, pts, depth, bevel, col, kind, z) {
    put(k, P, cut(key + "L", pts, depth, bevel), col, kind, 0, 0, z || 0);
    put(k, P, cut(key + "R", mirrorPts(pts), depth, bevel), col, kind, 0, 0, z || 0);
  }

  // ---- hangers -----------------------------------------------------------
  const WOOD_H = 0x6b4a2e, CHROME = 0xc9ced4, BLACK_H = 0x1d1f23;
  function hookOn(k, P) {
    put(k, P, GEO.hook || (GEO.hook = new THREE.TorusGeometry(0.02, 0.0025, 4, 10, Math.PI * 1.3)),
        CHROME, "metal", 0, 0, 0, 0, 0, -0.15 * Math.PI);
    bx(k, P, 0, -0.045, 0, 0.005, 0.05, 0.005, CHROME, "metal");
  }
  function hangerWood(k, P, half) {
    hookOn(k, P);
    const hw = half || 0.21;
    for (const s of [-1, 1]) bx(k, P, s * hw / 2, -0.084, 0, hw + 0.01, 0.016, 0.03, WOOD_H, "gloss", 0, 0, -s * 0.3);
  }
  function hangerClamp(k, P) {
    hookOn(k, P);
    bx(k, P, 0, -0.07, 0, 0.36, 0.014, 0.022, BLACK_H, "gloss");
    for (const s of [-1, 1]) bx(k, P, s * 0.15, -0.087, 0, 0.032, 0.035, 0.03, CHROME, "metal");
  }
  function swingTag(k, P, x, y, z) {
    bx(k, P, x, y + 0.03, z, 0.002, 0.06, 0.002, 0xcbb68a);
    bx(k, P, x, y - 0.005, z, 0.036, 0.055, 0.003, 0xf3f0e6);
  }

  // ---- one garment on its hanger. P's origin = the arm centreline, +Z = front
  function garment(k, P, L) {
    const c = L.c, dk = tone(c, -0.22), lt = tone(c, 0.14);
    const t = L.type;
    if (t === "trousers") {
      hangerClamp(k, P);
      put(k, P, cut("trouser", CUT.trouser, 0.03, 0.007), c, "solid");
      bx(k, P, 0, -0.105, 0.023, 0.39, 0.04, 0.004, dk);                       // waistband
      for (const s of [-1, 1]) bx(k, P, s * 0.1, -0.7, 0.023, 0.004, 0.72, 0.003, lt);   // pressed creases
      bx(k, P, 0.025, -0.22, 0.023, 0.004, 0.18, 0.003, dk);                   // fly seam
      swingTag(k, P, 0.17, -0.2, 0.026);
      return;
    }
    if (t === "tie" || t === "bowtie") {
      hookOn(k, P);
      bx(k, P, 0, -0.07, 0, 0.14, 0.012, 0.012, CHROME, "metal");              // tie bar
      if (t === "tie") {
        put(k, P, cut("tieF", CUT.tieF, 0.008, 0.003), c, "solid", 0, 0, 0.012);
        put(k, P, cut("tieB", CUT.tieB, 0.006, 0.002), dk, "solid", 0.012, 0, -0.006);
      } else {
        bx(k, P, 0, -0.13, 0, 0.16, 0.1, 0.004, 0xf3f0e6);                    // display card
        put(k, P, cut("bow", CUT.bow, 0.03, 0.004), c, "solid", 0, 0, 0.02);
        bx(k, P, 0, -0.123, 0.036, 0.03, 0.04, 0.02, lt);
      }
      return;
    }
    if (t === "dress") {
      hangerWood(k, P, 0.18);
      put(k, P, cut("dress", CUT.dress, 0.035, 0.007), c, "solid");
      for (const s of [-1, 1]) bx(k, P, s * 0.09, -0.13, 0.004, 0.018, 0.1, 0.01, c);   // straps
      bx(k, P, 0, -0.38, 0.025, 0.27, 0.035, 0.004, L.c2 != null ? L.c2 : dk);           // waist sash
      if (L.c2 != null) bx(k, P, 0, -1.02, 0.025, 0.58, 0.03, 0.004, L.c2);             // hem trim
      swingTag(k, P, 0.14, -0.4, 0.028);
      return;
    }
    const isShirt = (t === "collar" || t === "tee" || t === "blouse");
    if (isShirt) {
      hangerWood(k, P, 0.2);
      const body = t === "blouse" ? cut("blouse", CUT.blouse, 0.03, 0.007) : cut("shirt", CUT.shirt, 0.03, 0.007);
      put(k, P, body, c, "solid");
      const slv = t === "tee" ? CUT.slvShort : CUT.slvLong;
      cutPair(k, P, t === "tee" ? "slvS" : "slvL", slv, 0.026, 0.006, c, "solid", 0.004);
      const zf = 0.023;
      if (t === "collar") {
        cutPair(k, P, "collar", CUT.collar, 0.01, 0.003, lt, "solid", zf + 0.004);
        bx(k, P, 0, -0.45, zf, 0.026, 0.68, 0.004, lt);                        // placket
        for (let i = 0; i < 5; i++) bx(k, P, 0, -0.17 - i * 0.13, zf + 0.003, 0.011, 0.011, 0.004, 0xeeeeea);
        for (const s of [-1, 1]) bx(k, P, s * 0.237, -0.6, 0.02, 0.05, 0.06, 0.004, lt);   // cuffs
      } else if (t === "tee") {
        put(k, P, GEO.neckRib || (GEO.neckRib = new THREE.TorusGeometry(0.068, 0.007, 4, 12, Math.PI)),
            dk, "solid", 0, -0.078, zf - 0.004, 0, 0, Math.PI);
        if (L.c2 != null) bx(k, P, 0, -0.33, zf, 0.2, 0.16, 0.004, L.c2);       // chest print
      } else {
        bx(k, P, 0, -0.14, zf, 0.012, 0.12, 0.004, dk);                       // blouse keyhole
      }
      swingTag(k, P, -0.245, -0.55, 0.02);
      return;
    }
    // ---- tailoring + outerwear -----------------------------------------------
    const len = { blazer: 0.82, suit: 0.82, pilot: 0.72, bomber: 0.64, puffer: 0.68, hoodie: 0.7, denim: 0.62,
                  varsity: 0.64, track: 0.66, chef: 0.78, coveralls: 0.7, jacket: 0.74 }[t] || 0.74;
    const deep = (t === "puffer") ? 0.1 : (t === "hoodie" || t === "bomber" || t === "varsity") ? 0.06 : 0.045;
    hangerWood(k, P, 0.23);
    // a suit hangs its trousers folded over the hanger's lower bar, below the jacket
    if (t === "suit" || t === "track" || t === "coveralls" || t === "pilot") {
      const lc = L.legs != null ? L.legs : 0x2a2d34;
      bx(k, P, 0, -0.34, -0.03, 0.3, 0.012, 0.012, WOOD_H, "gloss");          // trouser bar
      bx(k, P, 0, -len - 0.12, -0.03, 0.34, len * 0.2 + 0.44, 0.022, lc);      // folded legs below the hem
      bx(k, P, 0, -len - 0.34, -0.018, 0.004, 0.36, 0.003, tone(lc, 0.14));    // fold crease
    }
    const sleeveCol = t === "varsity" ? (L.c2 != null ? L.c2 : 0xeae6dc) : c;
    const bodyCol = t === "pilot" ? 0xeef0f2 : c;
    put(k, P, cut("jk" + len + "_" + deep, jacketCut(len), deep, 0.008), bodyCol, "solid");
    cutPair(k, P, "jkSlv" + deep, CUT.jkSlv, deep * 0.8, 0.007, t === "pilot" ? 0xeef0f2 : sleeveCol, "solid", 0.003);
    const zf = deep / 2 + 0.009;
    if (t === "blazer" || t === "suit" || t === "chef") {
      if (t !== "chef") {
        put(k, P, cut("shirtV", CUT.shirtV, 0.006, 0), L.shirt, "solid", 0, 0, zf);
        cutPair(k, P, "lapel", CUT.lapel, 0.008, 0.002, L.bow ? tone(c, 0.1) : lt, L.bow ? "gloss" : "solid", zf + 0.004);
        if (L.bow) put(k, P, cut("bowS", CUT.bow.map(function (p) { return [p[0] * 0.55, p[1] * 0.55 - 0.05]; }), 0.02, 0.003), 0x0b0c10, "solid", 0, 0, zf + 0.008);
        else if (L.neck != null) put(k, P, cut("tieS", CUT.tieF.map(function (p) { return [p[0] * 0.7, p[1] * 0.7 - 0.03]; }), 0.006, 0.002), L.neck, "solid", 0, 0, zf + 0.003);
        for (let i = 0; i < 2; i++) bx(k, P, 0.012, -0.5 - i * 0.1, zf + 0.004, 0.016, 0.016, 0.006, tone(c, -0.45));
        for (const s of [-1, 1]) bx(k, P, s * 0.12, -0.62, zf + 0.001, 0.12, 0.02, 0.006, dk);   // pocket flaps
        bx(k, P, 0.13, -0.3, zf + 0.001, 0.08, 0.012, 0.005, dk);                             // breast welt
      } else {
        bx(k, P, 0, -0.085, zf, 0.16, 0.04, 0.006, L.c2 != null ? L.c2 : dk);                // collar band
        for (const s of [-1, 1]) for (let i = 0; i < 4; i++) bx(k, P, s * 0.07, -0.2 - i * 0.12, zf + 0.002, 0.018, 0.018, 0.006, 0xd8d6cc);
      }
    } else if (t === "pilot") {
      put(k, P, cut("tieS", CUT.tieF.map(function (p) { return [p[0] * 0.7, p[1] * 0.7 - 0.03]; }), 0.006, 0.002), L.neck || 0x1a1c24, "solid", 0, 0, zf + 0.003);
      for (const s of [-1, 1]) bx(k, P, s * 0.16, -0.1, zf - 0.01, 0.1, 0.02, 0.05, 0x1a1c24, "solid", 0, 0, -s * 0.3);   // epaulettes
      for (const s of [-1, 1]) bx(k, P, s * 0.12, -0.28, zf, 0.1, 0.1, 0.004, tone(0xeef0f2, -0.08));                 // chest pockets
    } else {
      // zip / button line down the front
      bx(k, P, 0, -len / 2 - 0.05, zf, t === "denim" ? 0.01 : 0.008, len - 0.12, 0.004, t === "denim" ? 0xb08a4a : tone(c, -0.45));
      if (t === "bomber" || t === "varsity" || t === "track") {
        bx(k, P, 0, -len + 0.03, zf - 0.002, 0.49, 0.06, 0.006, t === "varsity" ? 0x1c1d22 : dk);   // ribbed hem
        bx(k, P, 0, -0.09, zf - 0.004, 0.17, 0.05, 0.008, t === "varsity" ? 0x1c1d22 : dk);       // rib collar
        for (const s of [-1, 1]) bx(k, P, s * 0.26, -0.64, zf - 0.006, 0.058, 0.05, 0.006, dk);   // rib cuffs
      }
      if (t === "track") for (const s of [-1, 1]) bx(k, P, s * 0.278, -0.4, zf - 0.004, 0.012, 0.5, 0.004, 0xf2f2f0, "solid", 0, 0, s * 0.03);
      if (t === "puffer") for (let i = 1; i < 6; i++) bx(k, P, 0, -0.07 - i * 0.11, zf, 0.47, 0.012, 0.006, dk);
      if (t === "hoodie") {
        sph(k, P, 0, -0.11, -deep / 2 - 0.03, 0.15, 0.1, 0.05, dk);                 // hood lying down the back
        bx(k, P, 0, -0.5, zf, 0.28, 0.14, 0.006, dk);                               // kangaroo pocket
        for (const s of [-1, 1]) bx(k, P, s * 0.03, -0.18, zf + 0.004, 0.006, 0.16, 0.004, 0xeeeeea);   // drawcords
        bx(k, P, 0, -len + 0.03, zf - 0.002, 0.49, 0.05, 0.006, dk);
      }
      if (t === "denim") {
        for (const s of [-1, 1]) {
          bx(k, P, s * 0.11, -0.24, zf, 0.1, 0.03, 0.006, dk);                      // chest flap
          bx(k, P, s * 0.11, -0.3, zf - 0.002, 0.004, 0.14, 0.004, 0xb08a4a);        // contrast seam
        }
        bx(k, P, 0, -len + 0.04, zf, 0.49, 0.05, 0.006, dk);                        // waistband
      }
    }
    swingTag(k, P, -0.27, -0.6, zf - 0.005);
  }

  // ============================================================
  //  A DISPLAY FORM THAT WEARS THE LOOK. Fibreglass form: egg head, neck,
  //  shaped torso, jointed arms, legs on a floor plate with a calf rod. The
  //  garment IS the form's surface: torso and sleeves in the jacket's cloth,
  //  a jacket skirt over the hips, lapels over a shirt V, trousers on the
  //  legs. P's origin = floor under the form, +Z = the way it faces.
  // ============================================================
  function mannequin(k, P, L, dark, seed) {
    const skin = dark ? 0x34373e : 0xe4ddd0, skinK = "gloss";
    const jacket = L && (L.type === "blazer" || L.type === "suit" || L.type === "bomber" || L.type === "jacket" ||
                         L.type === "denim" || L.type === "varsity" || L.type === "puffer" || L.type === "hoodie" ||
                         L.type === "track" || L.type === "chef" || L.type === "coveralls" || L.type === "pilot");
    const dress = L && L.type === "dress";
    const top = L ? (L.type === "pilot" ? 0xeef0f2 : L.c) : skin, topK = L ? "solid" : skinK;
    const sleeve = L ? (L.type === "varsity" ? (L.c2 != null ? L.c2 : 0xeae6dc) : top) : skin;
    const legs = L && !dress ? (L.legs != null ? L.legs : 0x2a2d34) : skin, legK = (L && !dress) ? "solid" : skinK;
    // base: a round steel plate and a calf rod
    cy(k, P, 0, 0.008, -0.02, 0.2, 0.016, 0x2a2c30, "metal", 0, 0, 0, null, 24);
    cy(k, P, 0.09, 0.2, -0.04, 0.008, 0.36, CHROME, "metal");
    const lean = (seed - 0.5) * 0.06;
    for (const s of [-1, 1]) {
      const x = s * 0.09;
      bx(k, P, x, 0.045, 0.03, 0.085, 0.06, 0.24, dress ? 0x1c1d22 : 0x2a211c, "gloss");        // shoe
      cy(k, P, x, 0.3, 0, 0.042, 0.46, legs, legK, s * lean, 0, 0, 0.056);                        // shin
      cy(k, P, x, 0.75, 0, 0.058, 0.46, legs, legK, 0, 0, 0, 0.082);                              // thigh
    }
    sph(k, P, 0, 0.99, 0, 0.17, 0.11, 0.11, jacket ? top : legs, jacket ? topK : legK);          // hips
    cy(k, P, 0, 1.08, 0, 0.14, 0.18, top, topK, 0, 0, 0, 0.13, 16, 0.66);                        // waist
    cy(k, P, 0, 1.3, 0, 0.14, 0.28, top, topK, 0, 0, 0, 0.19, 16, 0.62);                         // chest
    sph(k, P, 0, 1.42, 0, 0.19, 0.06, 0.115, top, topK);                                         // shoulder line
    if (jacket) cy(k, P, 0, 0.98, 0, 0.19, 0.24, top, topK, 0, 0, 0, 0.16, 16, 0.72);           // jacket skirt over the hips
    if (dress) cy(k, P, 0, 0.72, 0, 0.3, 0.62, top, topK, 0, 0, 0, 0.15, 18, 0.8);              // skirt
    // arms: one hangs, the other bends at the elbow (the stance comes off the seed)
    const bent = seed < 0.5 ? -1 : 1;
    for (const s of [-1, 1]) {
      const sx = s * 0.215;
      sph(k, P, sx, 1.405, 0, 0.058, 0.058, 0.058, sleeve, topK);
      cy(k, P, sx + s * 0.025, 1.24, 0, 0.042, 0.3, sleeve, topK, 0, 0, s * 0.12, 0.05);         // upper arm
      if (s === bent) {
        cy(k, P, sx + s * 0.05, 1.06, 0.1, 0.034, 0.26, sleeve, topK, -1.2, 0, 0, 0.04);          // forearm forward
        sph(k, P, sx + s * 0.05, 1.02, 0.23, 0.035, 0.05, 0.03, skin, skinK);
      } else {
        cy(k, P, sx + s * 0.06, 0.96, 0.01, 0.034, 0.27, sleeve, topK, 0, 0, s * 0.06, 0.04);
        sph(k, P, sx + s * 0.07, 0.8, 0.01, 0.035, 0.055, 0.028, skin, skinK);
      }
    }
    // front details
    const zc = 0.19 * 0.62 + 0.002;
    if (L && (L.type === "blazer" || L.type === "suit")) {
      put(k, P, cut("mV", [[-0.065, 0], [0.065, 0], [0, -0.22]], 0.006, 0), L.shirt, "solid", 0, 1.44, zc - 0.006, 0.12);
      for (const s of [-1, 1]) bx(k, P, s * 0.05, 1.33, zc - 0.002, 0.035, 0.24, 0.006, tone(L.c, L.bow ? 0.1 : 0.14), L.bow ? "gloss" : "solid", 0.12, 0, s * 0.32);
      if (L.bow) bx(k, P, 0, 1.425, zc + 0.004, 0.08, 0.03, 0.02, 0x0b0c10);
      else if (L.neck != null) bx(k, P, 0, 1.32, zc - 0.002, 0.035, 0.2, 0.008, L.neck, "solid", 0.12);
      bx(k, P, 0, 1.12, 0.14 * 0.66 + 0.004, 0.018, 0.018, 0.006, tone(L.c, -0.45));
    } else if (L && L.type !== "dress") {
      bx(k, P, 0, 1.2, zc - 0.008, 0.008, 0.46, 0.004, tone(L.c, -0.4));                         // zip / button line
    }
    cy(k, P, 0, 1.51, 0, 0.042, 0.12, skin, skinK);                                              // neck
    sph(k, P, 0, 1.65, 0.005, 0.088, 0.115, 0.1, skin, skinK);                                  // head
  }

  // ============================================================
  //  FIXTURES
  // ============================================================
  // the finishes: a bright outfitter's white slatwall and oak, a tailor's
  // dark-stained panelling (FIN is set per store as its displays are built)
  const FIN_SHOP = { mdf: 0xe9e5dc, slat: 0xd9d4ca, groove: 0xb9b3a8, oak: 0x8a6a4a, clad: 0x4a3a2c, trim: 0xb9a27a };
  const FIN_TAILOR = { mdf: 0x3b2a1f, slat: 0x4a3326, groove: 0x2a1b12, oak: 0x5e3b22, clad: 0x2a1b12, trim: 0xb08a4a };
  let FIN = FIN_SHOP;
  // a slatwall panel on a wall face (local frame: centred at x=0, the panel's
  // face toward +Z), with its horizontal grooves
  function slatwall(k, P, len, y0, y1) {
    const h = y1 - y0;
    bx(k, P, 0, y0 + h / 2, -0.01, len, h, 0.02, FIN.slat);
    for (let y = y0 + 0.15; y < y1 - 0.05; y += 0.15) bx(k, P, 0, y, 0.0015, len, 0.012, 0.004, FIN.groove);
    bx(k, P, 0, y1 + 0.02, -0.005, len + 0.04, 0.04, 0.03, FIN.mdf);             // cap
    bx(k, P, 0, y0 / 2, -0.005, len + 0.04, y0, 0.03, 0x3a3630);                // kick down to the floor
  }
  // a face-out waterfall arm leaving the panel at local z=0 toward +Z
  function arm(k, P, y, reach) {
    bx(k, P, 0, y - 0.01, 0.015, 0.02, 0.06, 0.02, CHROME, "metal");            // bracket in the slat
    cy(k, P, 0, y, reach / 2 + 0.02, 0.008, reach, CHROME, "metal", Math.PI / 2);
    sph(k, P, 0, y, reach + 0.02, 0.013, 0.013, 0.013, CHROME, "metal");        // ball end
  }
  // the nesting table of folded stacks
  function foldTable(k, P, w, d, cols) {
    const top = 0.78;
    bx(k, P, 0, top - 0.02, 0, w, 0.04, d, FIN.oak, "gloss");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(k, P, sx * (w / 2 - 0.05), (top - 0.04) / 2, sz * (d / 2 - 0.05), 0.05, top - 0.04, 0.05, 0x2a2622);
    bx(k, P, 0, 0.22, 0, w - 0.1, 0.03, d - 0.1, FIN.oak, "gloss");              // lower shelf
    const n = Math.max(2, Math.floor(w / 0.36));
    const rr = CBZ.storeFixtureKit.rng(Math.round(w * 100 + d * 7));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n), col = cols[i % cols.length];
      const pile = 4 + Math.floor(rr() * 4);
      for (let j = 0; j < pile; j++) {
        const jx = (rr() - 0.5) * 0.02, jz = (rr() - 0.5) * 0.02, yy = top + 0.017 + j * 0.034;
        bx(k, P, x + jx, yy, jz, 0.28, 0.03, 0.22, col, "solid", 0, (rr() - 0.5) * 0.04, 0);
        bx(k, P, x + jx, yy + 0.004, jz + 0.111, 0.28, 0.012, 0.004, tone(col, -0.2));   // the fold line
      }
    }
    // a lower shelf of spare stacks, two piles
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++)
      bx(k, P, (i - 0.5) * 0.4, 0.252 + j * 0.034, 0, 0.28, 0.03, 0.22, cols[(i + 2) % cols.length]);
  }

  // ============================================================
  //  ONE STORE = ONE INSTANCE. Gang City's outfitter is one of them (found on
  //  the city's lots); every island outfitter and tailor is another, mounted
  //  by world/island_shops.js through CBZ.clothingStoreMount and taken down
  //  with its island. Same racks, same forms, same mirror, same counter.
  // ============================================================
  const STORES = [];
  function newStore(o) {
    return Object.assign({ lot: null, cs: null, group: null, winGroup: null, root: null, slots: [], built: false,
      dressed: false, near: false, cx: 0, cz: 0, cols: [], tux: null, tailor: false, mult: 1,
      island: false, arena: null, clerk: null, till: null, ledger: null, clerkOpts: null }, o || {});
  }

  // ---- build the displays (lazily, when you come down the street) ----------
  function buildDisplays(S) {
    const cs = S.cs, KIT = CBZ.storeFixtureKit;
    if (!KIT) return;
    FIN = S.tailor ? FIN_TAILOR : FIN_SHOP;
    const group = new THREE.Group();
    S.group = group;
    const root = S.root || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = cs.cx; S.cz = cs.cz;
    const b = S.lot.building;
    const tx = cs.tx, tz = cs.tz, inx = cs.inx, inz = cs.inz;
    const halfTan = cs.halfTan, halfIn = cs.halfIn, wt = cs.wt;
    const FF = cs.ff, CEIL = cs.ceil;
    const walk = cs.walk || 0;                  // depth the walk along the front wall keeps (islands)
    const yaw = KIT.yawOf(tx, tz);
    // kit-local: x = lateral (tangent), z = halfIn - depth (so +Z faces the door)
    const kit = KIT.create().frame(cs.cx, 0, cs.cz, yaw);
    const L2 = function (lat, depth) { return { x: lat, z: halfIn - depth }; };
    const faceYaw = function (dLat, dDepth) { return Math.atan2(dLat, -dDepth); };
    const at = function (lat, depth) {
      return { x: cs.cx + tx * lat + inx * (depth - halfIn), z: cs.cz + tz * lat + inz * (depth - halfIn) };
    };
    const col = function (lat0, lat1, d0, d1, y1) {
      const a = at(lat0, d0), c2 = at(lat1, d1);
      const r = { minX: Math.min(a.x, c2.x), maxX: Math.max(a.x, c2.x), minZ: Math.min(a.z, c2.z), maxZ: Math.max(a.z, c2.z), y0: FF - 0.2, y1: FF + y1 };
      if (CBZ.colliders) { CBZ.colliders.push(r); S.cols.push(r); }
    };

    const { wall, forms, tux } = partitionStock(S.tailor);
    const darkForms = S.tailor || h01(cs.cx, cs.cz, "formtone") > 0.5;
    const looks = {};
    const lookFor = function (vid) { return looks[vid] || (looks[vid] = lookOf(vid)); };
    const itemSlot = function (it, x, y, z, extra) {
      const sp = CBZ.cityComposableSpec(it.visualId);
      return Object.assign({ kind: "item", store: S, name: it.name, visualId: it.visualId, label: it.label,
        drip: (sp && sp.drip) || it.drip || 0, x: x, y: y, z: z, reach: RACK_REACH, dot: RACK_DOT }, extra || null);
    };

    // ---- THE RUNS -----------------------------------------------------------
    // Both side walls get slatwall + a face-out arm per garment; a deep room
    // also gets a double-sided spine down the middle. The runs stop short of
    // the back wall so the fitting corner and the cash wrap have their room.
    // A tailor hangs fewer pieces further apart.
    const railLen = Math.max(2.4, 2 * halfIn - 3.2);
    const wallFace = halfTan - wt;
    const REACH = 0.34;
    const d00 = Math.max(0.9, walk + 0.45);
    const runs = [];
    [-1, 1].forEach(function (sgn) {
      runs.push({ lat: sgn * (wallFace - REACH + 0.05), face: -sgn, panel: sgn * wallFace, d0: d00, d1: d00 + Math.max(0.2, railLen - 0.6 - (d00 - 0.9)) });
    });
    const gd0 = Math.max(3.4, walk + 1.2), gd1 = 2 * halfIn - 4.3;
    const spine = !S.tailor && (gd1 - gd0) >= 2.4 && halfTan >= 3.4;
    if (spine) [-1, 1].forEach(function (sgn) {
      runs.push({ lat: sgn * (0.07 + REACH - 0.05), face: sgn, panel: sgn * 0.07, d0: gd0, d1: gd1, spine: true });
    });
    // panels + spine carcass
    runs.forEach(function (run) {
      // the panel runs 0.45 m past the first arm and 0.25 m past the last
      const mid = (run.d0 + run.d1) / 2 - 0.1, len = (run.d1 - run.d0) + 0.7;
      const p = L2(run.panel, mid);
      slatwall(kit, xf(p.x, FF, p.z, faceYaw(run.face, 0)), len, 0.3, 2.25);
    });
    if (spine) {
      const mid = (gd0 + gd1) / 2, len = (gd1 - gd0) + 0.9, p = L2(0, mid);
      const P = xf(p.x, FF, p.z, 0);                                               // local z runs down the room
      bx(kit, P, 0, 1.16, 0, 0.1, 2.2, len, FIN.mdf);                              // carcass between the faces
      bx(kit, P, 0, 0.03, 0, 0.34, 0.06, len + 0.1, 0x2a2622);                     // plinth
      col(-0.2, 0.2, gd0 - 0.45, gd1 + 0.45, 2.3);
    }
    S._runs = runs.length; S._gondola = spine;

    // hand each garment a run and a place in it, sized by run LENGTH
    const lens = runs.map(function (r) { return Math.max(0.5, r.d1 - r.d0); });
    let totalLen = 0; lens.forEach(function (l) { totalLen += l; });
    const runCount = []; let assigned = 0;
    for (let r = 0; r < runs.length; r++) {
      const q = (r === runs.length - 1) ? (wall.length - assigned)
        : Math.min(wall.length - assigned, Math.round(wall.length * lens[r] / totalLen));
      runCount[r] = Math.max(0, q); assigned += runCount[r];
    }
    const runOf = [], posOf = [];
    let curRun = 0, inRun = 0;
    for (let i = 0; i < wall.length; i++) {
      while (curRun < runs.length - 1 && inRun >= (runCount[curRun] || 0)) { curRun++; inRun = 0; }
      runOf[i] = curRun; posOf[i] = inRun++;
    }
    wall.forEach(function (it, i) {
      const run = runs[runOf[i]], n = runCount[runOf[i]] || 1;
      const t = n > 1 ? (posOf[i] / (n - 1)) : 0.5;
      const depth = run.d0 + t * (run.d1 - run.d0);
      const L = lookFor(it.visualId);
      const y = FF + ARM_Y;
      const pp = L2(run.panel, depth);
      arm(kit, xf(pp.x, FF, pp.z, faceYaw(run.face, 0)), ARM_Y, REACH);
      const gp = L2(run.lat, depth);
      garment(kit, xf(gp.x, y, gp.z, faceYaw(run.face, 0)), L);
      const w = at(run.lat, depth);
      S.slots.push(itemSlot(it, w.x, y, w.z));
    });

    // ---- THE ENTRANCE HEROES ----------------------------------------------
    // Clustered to one side of the door (the lot's own coin) so no form ever
    // stands in the lane you walk in by.
    const heroSide = cs.heroSide || (h01(cs.cx, cs.cz, "heroes") < 0.5 ? -1 : 1);
    forms.forEach(function (it, i) {
      const lat = heroSide * Math.min(halfTan - 0.9, 1.4 + i * 1.1);
      const depth = Math.max(2.15, walk + 0.5) + (i % 2) * 0.35;
      const p = L2(lat, depth), seed = h01(cs.cx + i, cs.cz, "form");
      mannequin(kit, xf(p.x, FF, p.z, (seed - 0.5) * 0.6), lookFor(it.visualId), darkForms, seed);
      const w = at(lat, depth);
      col(lat - 0.2, lat + 0.2, depth - 0.2, depth + 0.2, 1.8);
      S.slots.push(itemSlot(it, w.x, FF + 1.2, w.z, { mannequin: true }));
    });
    S._forms = forms.length;

    // ---- THE FOLDED TABLE (the other side of the door lane) -----------------
    const tLat = -heroSide * 1.9, tDepth = Math.max(2.7, walk + 0.9), TW = 1.4, TD = 0.8;
    if (!S.tailor && wallFace - REACH - 0.3 - (Math.abs(tLat) + TW / 2) >= 0.8 && 2 * halfIn > 7) {
      const p = L2(tLat, tDepth);
      const cols = [];
      for (let i = 0; i < wall.length && cols.length < 6; i += Math.max(1, Math.floor(wall.length / 6))) cols.push(lookFor(wall[i].visualId).c);
      if (!cols.length) cols.push(0xd8d4ca, 0x2b3a5a, 0x6e1f2b);
      foldTable(kit, xf(p.x, FF, p.z, 0), TW, TD, cols);
      col(tLat - TW / 2, tLat + TW / 2, tDepth - TD / 2, tDepth + TD / 2, 0.8);
    }

    // ---- THE CASH WRAP ------------------------------------------------------
    // Where you PAY: the till slot stands on the customer side of it.
    const C = b.counter || KIT.counterOf(S.lot);
    if (C) {
      const CL = Math.max(C.w, C.d), CD = Math.min(C.w, C.d);
      const ck = KIT.create().frame(C.x, 0, C.z, KIT.yawOf(C.tx, C.tz));
      const top = KIT.dressCounter(ck, CL, CD, C.top, FF, { clad: FIN.clad, trim: FIN.trim, work: S.tailor ? 0x1a1410 : 0xe8e4da, kick: 0x1a1612 });
      KIT.till(ck, -CL / 2 + 0.55, top, CD);
      // paper carrier bags standing at the other end, a tissue stack, a hanger bin
      const ex = CL / 2 - 0.3;
      for (let i = 0; i < 3; i++) {
        ck.box(ex - i * 0.02, top + 0.16, -CD / 2 + 0.2 + i * 0.03, 0.3, 0.32, 0.11, S.tailor ? 0x1c1a18 : 0xb58a5a);
        ck.torus(ex - i * 0.02, top + 0.33, -CD / 2 + 0.2 + i * 0.03, 0.06, 0.004, 0x3a2a1c, "solid", 0, 0, 0, Math.PI, 8);
      }
      ck.box(ex - 0.45, top + 0.02, -CD / 2 + 0.22, 0.4, 0.04, 0.3, 0xf6f4ee);
      ck.box(ex - 0.2, FF + 0.22, -CD / 2 - 0.35, 0.4, 0.44, 0.3, 0x2a2c30);        // hanger bin behind the counter
      for (let i = 0; i < 6; i++) ck.box(ex - 0.34 + i * 0.05, FF + 0.47, -CD / 2 - 0.35, 0.01, 0.1, 0.24, BLACK_H, "gloss", 0, 0, 0.3);
      if (S.tailor) {
        // the tailor's things on the worktop: a tape measure, a chalk, a pad of swatches
        ck.torus(ex - 0.95, top + 0.012, 0, 0.05, 0.012, 0xe8d24a, "solid", Math.PI / 2, 0, 0);
        ck.box(ex - 0.7, top + 0.01, 0.08, 0.05, 0.012, 0.03, 0xf2f0ea);
        for (let i = 0; i < 4; i++) ck.box(ex - 1.25 + i * 0.012, top + 0.006 + i * 0.004, -0.05, 0.12, 0.004, 0.08, [0x1c2433, 0x3a3a40, 0x5a4632, 0x22303a][i]);
      }
      ck.build(group);
      const tw = { x: C.x - C.inx * (CD / 2 + 0.5), z: C.z - C.inz * (CD / 2 + 0.5) };
      S.till = { kind: "till", store: S, x: tw.x, y: top, z: tw.z, reach: RACK_REACH, dot: 0.4 };
      S.slots.push(S.till);
    }

    // ---- THE FITTING ROOM + MIRROR ------------------------------------------
    // A real cubicle in a back corner: a solid partition wall, a curtain on a
    // ceiling track, a bench, a hook with the piece you carried in. The
    // full-length mirror (the wardrobe) hangs on the side wall just in front
    // of it, where the floor is open (not the clerk's side of the counter).
    const back = 2 * halfIn - wt;                           // back wall inner face (depth)
    const bx0 = num(b.ox, cs.cx), bz0 = num(b.oz, cs.cz);
    const clearAt = function (lat, depth, pad) {
      if (typeof b.clearFloorPoint !== "function") return true;
      const w = at(lat, depth);
      return !!b.clearFloorPoint(w.x - bx0, w.z - bz0, pad);
    };
    const BW = 1.3, BD = 1.4, WH = 2.3;                     // booth width (lateral), depth, wall height
    let sgn = cs.fitSide || (h01(cs.cx, cs.cz, "fitroom") < 0.5 ? -1 : 1);
    const boothFits = function (s2) {
      const mid = s2 * (wallFace - BW / 2);
      return clearAt(mid, back - BD / 2, 0.5) && clearAt(mid, back - BD - 0.6, 0.5);
    };
    let fr = (halfTan - 1.5) >= 2.9;
    if (fr && !boothFits(sgn)) { if (!cs.fitSide && boothFits(-sgn)) sgn = -sgn; else fr = false; }
    if (fr) {
      const inner = sgn * wallFace, part = sgn * (wallFace - BW);
      const front = back - BD;
      // the partition wall between the booth and the shop floor
      const pw = L2(part, back - BD / 2);
      const PW = xf(pw.x, FF, pw.z, 0);
      bx(kit, PW, 0, WH / 2, 0, 0.08, WH, BD, FIN.mdf);
      bx(kit, PW, 0, 0.05, 0, 0.1, 0.1, BD + 0.01, 0x3a3630);
      bx(kit, PW, 0, WH + 0.02, 0, 0.1, 0.04, BD + 0.02, FIN.oak, "gloss");
      col(part - 0.05, part + 0.05, front, back, WH);
      // curtain track hung off the ceiling on two drop rods, curtain mostly drawn
      const tr = L2((inner + part) / 2, front);
      const PT = xf(tr.x, FF, tr.z, 0);
      const ceilH = CEIL - FF;
      const trackY = Math.min(ceilH - 0.02, 2.45);
      bx(kit, PT, 0, trackY, 0, BW, 0.03, 0.03, CHROME, "metal");
      if (ceilH - trackY > 0.05) for (const e of [-0.5, 0.5]) cy(kit, PT, e * (BW - 0.1), (trackY + ceilH) / 2, 0, 0.008, ceilH - trackY, CHROME, "metal");
      const folds = 9, fw = (BW * 0.72) / folds, ch = trackY - 0.2;
      const toWall = inner > part ? 1 : -1;                  // the curtain bunches toward the side wall
      for (let i = 0; i < folds; i++) {
        const x = toWall * (BW / 2 - 0.02 - (i + 0.5) * fw);
        bx(kit, PT, x, trackY - 0.03 - ch / 2, (i % 2) * 0.035, fw * 1.25, ch, 0.012, S.tailor ? 0x2a2230 : 0x5a4a3c, "solid", 0, (i % 2 ? 0.45 : -0.45), 0);
      }
      // inside: a bench against the back wall and a hook on the side wall
      const bn = L2((inner + part) / 2, back - 0.22);
      const PB = xf(bn.x, FF, bn.z, 0);
      bx(kit, PB, 0, 0.44, 0, BW - 0.2, 0.04, 0.36, FIN.oak, "gloss");
      for (const e of [-1, 1]) bx(kit, PB, e * (BW / 2 - 0.2), 0.21, 0, 0.04, 0.42, 0.3, 0x2a2622);
      const hk = L2(inner, back - BD * 0.55);
      const PH = xf(hk.x, FF + 1.75, hk.z, faceYaw(-sgn, 0));
      bx(kit, PH, 0, 0, 0.025, 0.03, 0.03, 0.05, CHROME, "metal");
      if (wall.length) garment(kit, xf(0, 0, 0.06, 0, PH), lookFor(wall[wall.length - 1].visualId));
      // stepping into the booth is trying on too
      const bw = at((inner + part) / 2, back - BD / 2);
      S.slots.push({ kind: "booth", store: S, x: bw.x, y: FF + 1.2, z: bw.z, reach: 1.6, dot: 0.2 });
    }
    const mlat = sgn * wallFace, mdepth = back - BD - 0.42;
    const mp = L2(mlat, mdepth);
    const PM = xf(mp.x, FF, mp.z, faceYaw(-sgn, 0));
    bx(kit, PM, 0, 1.05, 0.03, 0.78, 1.96, 0.05, S.tailor ? 0x3a2414 : 0x1d1f23, "gloss");   // frame
    bx(kit, PM, 0, 1.05, 0.058, 0.68, 1.84, 0.006, 0xbccbd2, "metal");             // silvered glass
    bx(kit, PM, 0, 0.05, 0.045, 0.8, 0.1, 0.08, 0x1d1f23, "gloss");                // foot rail
    const mw = at(mlat - sgn * 0.1, mdepth);
    S.slots.push({ kind: "mirror", store: S, x: mw.x, y: FF + 1.2, z: mw.z,
                   reach: RACK_REACH + 0.4, dot: 0.45, tux: tux });
    // no counter in the plan: you pay at the mirror
    if (!S.till) S.till = S.slots[S.slots.length - 1];
    S._alcove = !!fr;
    S.tux = tux;
    kit.build(group);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.interiorTrackFixture && !S.island) CBZ.interiorTrackFixture("clothing-store", b, group);

    // ---- THE WINDOW (street-facing, display only) --------------------------
    // Its own group: the floor is hard-gated to "player is inside the shell"
    // (r128 cannot cull a hung garment behind an opaque wall), the window runs
    // the opposite gate and draws from the pavement in front of the glass.
    const wg = new THREE.Group();
    S.winGroup = wg;
    root.add(wg);
    const wk = KIT.create().frame(cs.cx, 0, cs.cz, yaw);
    const wlooks = [];
    if (tux) wlooks.push(tux.visualId);
    for (let i = 0; i < forms.length && wlooks.length < 2; i++) wlooks.push(forms[i].visualId);
    const lat0 = Math.min(halfTan - 1.1, 2.1);
    let nWin = 0;
    // (an island shop's front walk runs along that glass: no window risers there)
    if (wlooks.length && lat0 >= 1.3 && !walk) {
      for (let i = 0; i < wlooks.length; i++) {
        const lat = (i === 0 ? -1 : 1) * lat0, depth = wt + 0.75;
        const p = L2(lat, depth);
        const PR = xf(p.x, FF, p.z, 0);
        bx(wk, PR, 0, 0.14, 0, 1.1, 0.24, 0.9, FIN.mdf);                            // riser
        bx(wk, PR, 0, 0.03, 0, 1.12, 0.06, 0.92, 0x2a2622);                         // riser kick
        mannequin(wk, xf(0, 0.26, 0, (i === 0 ? 0.25 : -0.25), PR), lookFor(wlooks[i]), darkForms, h01(cs.cx, cs.cz, "win" + i));
        // ceiling track + two spot heads aimed at the form (a lamp lens is the
        // one thing here that glows)
        const ty = CEIL - FF - 0.02;
        bx(wk, PR, 0, ty, 0.25, 1.2, 0.035, 0.05, 0x1d1f23, "gloss");
        for (const e of [-0.4, 0.4]) {
          const hx = e, hz = 0.25;
          cy(wk, PR, hx, ty - 0.06, hz, 0.01, 0.1, 0x1d1f23, "gloss");
          const ax = 0.5;                                                           // lens tilted down onto the form
          cy(wk, PR, hx, ty - 0.14, hz, 0.045, 0.14, 0x1d1f23, "gloss", ax);
          cy(wk, PR, hx, ty - 0.203, hz - 0.035, 0.036, 0.006, 0xfff1d6, "glow", ax);
        }
        nWin++;
      }
    }
    wk.build(wg);
    S._window = nWin;
    if (CBZ.interiorTrackFixture && !S.island) CBZ.interiorTrackFixture("clothing-window", b, wg);
  }

  function undress(S) {
    for (const grp of [S.group, S.winGroup]) {
      if (!grp) continue;
      if (grp.parent) grp.parent.remove(grp);
      grp.traverse(function (o) { if (o.isMesh && o.geometry && !o.geometry._shared) { try { o.geometry.dispose(); } catch (e) {} } });
    }
    if (S.cols.length && CBZ.colliders) {
      const set = new Set(S.cols), C = CBZ.colliders;
      let w = 0;
      for (let i = 0; i < C.length; i++) if (!set.has(C[i])) C[w++] = C[i];
      C.length = w;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    S.cols = []; S.group = null; S.winGroup = null; S.slots = []; S.till = null; S.dressed = false; S.near = false;
  }

  // ============================================================
  //  TAKE IT OFF THE RACK, TRY IT ON, PAY AT THE COUNTER.
  //  A garment you pick up is in your hands; the mirror or the fitting room
  //  puts what you hold on your back (the look you came in with is kept, and
  //  comes back if you put the piece down); the till takes the money and it
  //  is yours. What you are holding is the store's LEDGER, the one every
  //  shop keeps (city/shopfloor.js CBZ.shopFloor.till): head for the door
  //  with it and the clerk says so (an island clerk comes out from behind
  //  the cash wrap and stands in the doorway); walk out with it and it is
  //  stolen: yours, the clerk calls it, and it is a theft on your record,
  //  exactly as in the gun store, the pawn shop and the jeweller.
  // ============================================================
  const HAND_MAX = 4;
  const NONE = [];
  // the store whose things are in your hands, and the look you walked in with
  const HELD = { store: null, snap: null, get items() { const S = HELD.store; return S && S.ledger ? S.ledger.held : NONE; } };
  function priceOf(S, name) { return Math.round(e_buy(name) * (S && S.mult || 1)); }
  function heldTotal() { let t = 0; for (const h of HELD.items) t += h.price; return t; }
  function holding(vid) { for (const h of HELD.items) if (h.visualId === vid) return h; return null; }
  const owned = (s) => !!(CBZ.cityOwnsItem && CBZ.cityOwnsItem(s.visualId));
  function clerkOf(S) {
    const v = S && S.lot && S.lot.building && S.lot.building.vendor;
    return v && !v.dead && v.pos ? v : null;
  }
  function clerkSay(S, line) {
    const v = clerkOf(S);
    if (v && line && CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(v, line, { force: true }); } catch (e) {} }
  }
  function SF() { return CBZ.shopFloor || null; }

  // THE LEDGER: one per store, made with the store. Its clerk is the posted
  // vendor (Gang City) or the island's counter clerk (world/island_shops.js
  // hands his post over: he walks out round the cash wrap to the door).
  function ledgerFor(S, o) {
    const F = SF();
    if (!F) return null;
    o = o || {};
    const clerk = o.post && F.postedClerk ? F.postedClerk({ post: o.post, b: o.b, via: o.via, door: o.door, armed: null })
      : F.cityClerk(S.lot);
    const cs = S.cs;
    return F.till({
      clerk: clerk, where: o.where || (S.island ? "isle" : "city"),
      inStore: function (x, z) { return inStore(S, x, z, 0.6); },
      // the last couple of metres to the street door
      nearDoor: function (x, z) {
        const dx = x - cs.dwx, dz = z - cs.dwz;
        const inn = dx * cs.inx + dz * cs.inz, lat = Math.abs(dx * cs.tx + dz * cs.tz);
        return inn < 2.3 && lat < 2.6;
      },
    });
  }
  // a garment off the rack as a ledger item: paid for, it is yours and you
  // wear it; walked out with, it is yours all the same (and a theft); put
  // down, the look you came in with comes back
  function itemOf(S, slot) {
    const h = { name: slot.name, visualId: slot.visualId, label: slot.label, price: priceOf(S, slot.name), tried: false, slot: slot.visualId,
      // worn, not carried: nothing a pawnbroker is ever offered
      hot: false,
      onPay: function () {
        if (CBZ.cityGrantItem) CBZ.cityGrantItem(h.visualId);
        if (CBZ.cityWear) CBZ.cityWear(h.visualId);
      },
      onSteal: function () {
        if (CBZ.cityGrantItem) CBZ.cityGrantItem(h.visualId);
        if (h.tried && CBZ.cityWear) CBZ.cityWear(h.visualId);
        HELD.snap = null;                 // what you walked out in is the look now
      },
    };
    return h;
  }

  function take(slot) {
    const S = slot.store;
    if (!S.ledger) S.ledger = ledgerFor(S, S.clerkOpts);
    if (!S.ledger) return;
    if (HELD.store && HELD.store !== S) dropAll(false);
    if (holding(slot.visualId)) return;
    if (HELD.items.length >= HAND_MAX) { note("Your hands are full.", 1.4); return; }
    HELD.store = S;
    S.ledger.hold(itemOf(S, slot));
    if (CBZ.sfx) CBZ.sfx("pickup");
  }
  function putBack(slot) {
    const h = holding(slot.visualId);
    if (!h || !HELD.store) return;
    HELD.store.ledger.release(h);
    if (h.tried) {
      const still = HELD.items.filter(function (o) { return o.tried; });
      restoreLook();
      for (const o of still) wearTrial(o);
    }
    if (!HELD.items.length) clearHeld();
  }

  /* the look you walked in with, kept while you try things on: the owned
     sets, the composite, the worn record */
  function snapLook() {
    if (HELD.snap) return;
    HELD.snap = {
      items: Object.assign({}, g.cityItemsOwned || {}),
      outfits: Object.assign({}, g.cityOutfitsOwned || {}),
      fit: g.cityFit ? { shirt: g.cityFit.shirt, legs: g.cityFit.legs, items: (g.cityFit.items || []).slice() } : null,
      id: g.cityOutfitId || null, rec: g.cityWornOutfit || null,
    };
  }
  function restoreLook() {
    const s = HELD.snap;
    if (!s) return;
    g.cityItemsOwned = Object.assign({}, s.items);
    g.cityOutfitsOwned = Object.assign({}, s.outfits);
    if (s.fit) g.cityFit = { shirt: s.fit.shirt, legs: s.fit.legs, items: s.fit.items.slice() };
    const plain = !s.rec || s.rec.id === "civvies" || s.id === "street" || s.id === "civvies" || s.id === "basics" || s.id === "hoodie";
    if (plain || !CBZ.cityWearOutfit || !CBZ.cityWearOutfit(s.id)) {
      if (s.fit && CBZ.citySetFitShirt) CBZ.citySetFitShirt(s.fit.shirt);
    }
    for (const h of HELD.items) h.tried = false;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function wearTrial(h) {
    if (CBZ.cityGrantItem) CBZ.cityGrantItem(h.visualId);
    if (CBZ.cityWear) CBZ.cityWear(h.visualId);
    h.tried = true;
  }
  function tryOn() {
    if (!HELD.items.length) return;
    snapLook();
    for (const h of HELD.items) if (!h.tried) wearTrial(h);
    if (CBZ.sfx) CBZ.sfx("cloth");
  }
  function clearHeld() { HELD.store = null; HELD.snap = null; }
  // down they go, back on the rack (the store went away, you died with them)
  function dropAll(keepTried) {
    const S = HELD.store;
    if (!keepTried) restoreLook();
    if (S && S.ledger) S.ledger.dropAll();
    clearHeld();
  }

  function pay(S) {
    if (!HELD.items.length || HELD.store !== S || !CBZ.city || !S.ledger) return;
    const items = HELD.items.slice(), total = heldTotal();
    // nobody behind the counter at all: the money is left by the till
    const nobody = !S.ledger.clerk || !S.ledger.clerk.body();
    if (!S.ledger.pay(nobody)) return;      // (short of it: the till says the price)
    let respect = 0, big = null;
    for (const h of items) { if (h.price >= 600) { respect += 3; big = h.label || h.name; } else respect += 1; }
    if (CBZ.city.addRespect) CBZ.city.addRespect(respect);
    clerkSay(S, S.tailor ? "It suits you." : "Thank you.");
    if (big && CBZ.city.big) CBZ.city.big(big + ", paid for.");
    else note("Paid " + fmt$(total) + ".", 1.6);
    clearHeld();                            // the new look is the look now
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
  }
  // the ledger's turn each frame, for the store in your hands; its theft
  // leaves the ledger empty, and the store lets go of you
  function ledgerTick(dt) {
    const S = HELD.store;
    if (!S || !S.ledger) return;
    const had = S.ledger.held.length;
    S.ledger.tick(dt);
    if (had && !S.ledger.held.length) {
      clearHeld();
      if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    }
  }

  // ---- THE RACKS ARE CANDIDATES (city/interactions.js registerFixtures) -----
  // Every garment, form, the mirror, the booth and the till is a thing in the
  // registry: E does the best verb on the one you look at, Q / a tap on it
  // shows its verbs. No private prompt and no private E listener.
  function inStore(S, px, pz, lip) {
    const B = S && S.cs && S.cs.bounds;
    const m = lip == null ? 1.5 : lip;
    return !!B && px >= B.minX - m && px <= B.maxX + m && pz >= B.minZ - m && pz <= B.maxZ + m;
  }
  const _list = [];
  let fixturesWired = false;
  function wireFixtures() {
    if (fixturesWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    fixturesWired = true;
    const isItem = (s) => s.kind === "item";
    const mirrorish = (s) => s.kind === "mirror" || s.kind === "booth";
    CBZ.interactions.registerFixtures({
      id: "clothes-rack", kind: "clothes-rack", prio: 9, islands: true,
      list: function (ctx, px, pz) {
        if (UI.open) return null;
        _list.length = 0;
        for (const S of STORES) if (S.dressed && S.near && inStore(S, px, pz)) for (const s of S.slots) _list.push(s);
        return _list.length ? _list : null;
      },
      reach: function (s) { return s.reach || RACK_REACH; },
      dot: function (s) { return s.dot || RACK_DOT; },
      name: function (s) {
        if (s.kind === "till") return HELD.items.length ? "Counter" : "";
        if (mirrorish(s)) return "";
        return (s.label || s.name) + (owned(s) ? "" : "  " + fmt$(priceOf(s.store, s.name)));
      },
      verbs: [
        { id: "clothes-wear", slot: "e", prio: 5, label: "Wear", canShow: (s) => isItem(s) && owned(s) && !holding(s.visualId), onSelect: function (s) { if (CBZ.cityWear) CBZ.cityWear(s.visualId); } },
        { id: "clothes-take", slot: "e", prio: 5, label: "Take", canShow: (s) => isItem(s) && !owned(s) && !holding(s.visualId), onSelect: take },
        { id: "clothes-putback", slot: "e", prio: 5, label: "Put back", canShow: (s) => isItem(s) && !!holding(s.visualId), onSelect: putBack },
        { id: "clothes-tryon", slot: "e", prio: 6, label: "Try on",
          canShow: (s) => mirrorish(s) && HELD.store === s.store && HELD.items.some(function (h) { return !h.tried; }), onSelect: tryOn },
        { id: "clothes-wardrobe", slot: "e", prio: 4, label: "Wardrobe", canShow: (s) => s.kind === "mirror", onSelect: (s) => openPanel(s.store) },
        { id: "clothes-pay", slot: "e", prio: 7, label: () => "Pay " + fmt$(heldTotal()),
          canShow: (s) => s === (s.store && s.store.till) && HELD.store === s.store && HELD.items.length > 0, onSelect: (s) => pay(s.store) },
      ],
    });
  }

  // ============================================================
  //  THE WARDROBE PANEL (at the mirror): list OWNED composables grouped by
  //  slot — number keys wear, the slot letter strips it — plus the store's
  //  apex piece (the tuxedo) to take to the counter. A fixed centre card,
  //  Esc/E closes, number keys act. Built lazily, repopulated each open.
  // ============================================================
  const UI = { open: false, panel: null, rows: null, prevMenu: undefined, store: null };
  function panelEl() {
    if (UI.panel) return UI.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "clothingPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "background:rgba(13,16,21,.96);border:1px solid #6a4f7a;border-radius:16px;padding:18px 22px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;min-width:320px;max-width:86vw;box-shadow:0 18px 60px rgba(0,0,0,.6)";
    document.body.appendChild(d);
    UI.panel = d;
    return d;
  }
  // the owned composables grouped by their composable slot (shirt/jacket/neck/
  // legs), each row a number key to wear; the worn ones marked.
  function ownedRows() {
    const e = econ();
    const list = (e && e.itemsByTag) ? e.itemsByTag("clothing") : [];
    const fit = (CBZ.cityFitGet && CBZ.cityFitGet()) || { items: [] };
    const wornSet = {}; (fit.items || []).forEach((id) => { wornSet[id] = true; });
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (!it || !it.visualId) continue;
      const sp = CBZ.cityComposableSpec && CBZ.cityComposableSpec(it.visualId);
      if (!sp || sp.painted) continue;                 // the tuxedo has its own row
      if (!(CBZ.cityOwnsItem && CBZ.cityOwnsItem(it.visualId))) continue;
      if (holding(it.visualId)) continue;              // on trial, not yours yet
      rows.push({ visualId: it.visualId, label: it.label, slot: sp.slot || "item", worn: !!wornSet[it.visualId] });
    }
    return rows;
  }
  function tuxLabel(t) { return String(t.label || t.name).replace(" (Composable)", ""); }
  function renderPanel() {
    const d = panelEl(); if (!d) return;
    const S = UI.store, rows = ownedRows();
    let html = "<div style='font-weight:700;font-size:18px;margin-bottom:12px;color:#e2c2f4'>Wardrobe</div>";
    UI.rows = rows;
    rows.forEach((r, i) => {
      const mark = r.worn ? "<span style='color:#7ed957'> ✓</span>" : "";
      html += "<div style='display:flex;justify-content:space-between;gap:14px;padding:3px 0'>" +
        "<span><b style='color:#e2c2f4'>" + (i + 1) + "</b> &nbsp;" + r.label + mark + "</span>" +
        "<span style='color:#7f8794'>" + r.slot + "</span></div>";
    });
    // the apex piece: the tuxedo, taken off its form here and paid for at the counter
    const tux = S && S.tux;
    if (tux) {
      const own = CBZ.cityOwnsItem && CBZ.cityOwnsItem(tux.visualId) && !holding(tux.visualId);
      const held = !!holding(tux.visualId);
      html += "<div style='border-top:1px solid #3a3140;margin:12px 0 8px'></div>";
      html += "<div style='display:flex;justify-content:space-between;gap:14px;padding:3px 0'>" +
        "<span><b style='color:#ffd166'>T</b> &nbsp;" + tuxLabel(tux) + (own ? "<span style='color:#7ed957'> ✓</span>" : "") + "</span>" +
        "<span style='color:#d9a8ee'>" + (own ? "Wear" : held ? "Put back" : "Take " + fmt$(priceOf(S, tux.name))) + "</span></div>";
    }
    html += "<div style='border-top:1px solid #3a3140;margin:12px 0 4px'></div>";
    if (!CBZ.touchMode) html += "<div style='color:#8a93a3;font-size:12px'>[Esc] / [E] close</div>";
    d.innerHTML = html;
  }
  function openPanel(S) {
    const d = panelEl(); if (!d) return;
    UI.open = true; UI.store = S || null;
    // remember the engine's prior fire-block state, then hold it true while
    // styling (CBZ.cityMenuOpen is the engine's existing fire chokepoint).
    UI.prevMenu = CBZ.cityMenuOpen;
    CBZ.cityMenuOpen = true;
    renderPanel();
    d.style.display = "block";
  }
  function closePanel() {
    if (UI.panel) UI.panel.style.display = "none";
    UI.open = false; UI.store = null;
    CBZ.cityMenuOpen = UI.prevMenu;                     // restore EXACTLY what it was
    UI.prevMenu = undefined;
  }
  function panelKey(k) {
    if (k === "escape" || k === "e") { closePanel(); return; }
    const S = UI.store;
    if (k === "t" && S && S.tux) {
      const t = S.tux, slot = { store: S, name: t.name, visualId: t.visualId, label: tuxLabel(t) };
      if (holding(t.visualId)) putBack(slot);
      else if (CBZ.cityOwnsItem && CBZ.cityOwnsItem(t.visualId)) { if (CBZ.cityWear) CBZ.cityWear(t.visualId); }
      else take(slot);
      renderPanel();
      return;
    }
    const n = parseInt(k, 10);
    if (!isNaN(n) && n >= 1 && UI.rows && n <= UI.rows.length) {
      const r = UI.rows[n - 1];
      if (r.worn) { if (CBZ.cityUnwear) CBZ.cityUnwear(r.visualId); }
      else { if (CBZ.cityWear) CBZ.cityWear(r.visualId); }
      renderPanel();
    }
  }

  // ---- Gang City's store: find the lot + frame it (self-healing) -------------
  const CITY = newStore();
  function ensureCity() {
    const S = CITY;
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      undress(S);
      if (HELD.store === S) dropAll(false);
      S.built = false; S.lot = null; S.cs = null; S.tux = null; S.ledger = null;
      const i = STORES.indexOf(S); if (i >= 0) STORES.splice(i, 1);
    }
    if (!arena || !econ() || !CBZ.cityComposableSpec) return false;
    if (S.noLotArena === arena) return false;
    let lot = arena.clothingLot || null;
    if (!(lot && lot.building && lot.building.shop && lot.building.shop.kind === "clothing")) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (L && L.building && L.building.shop && L.building.shop.kind === "clothing") { lot = L; break; }
      }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    // derive the walkable bounds + door frame (no buildings.js anchor for
    // clothing — compute the gunstore-style inward/tangent units ourselves).
    const b = lot.building;
    const w = num(b.w, lot.w - 2 || 10), d = num(b.d, lot.d - 2 || 10);
    const door = b.door || { nx: 1, nz: 0 };
    const inx = door.nx || 0, inz = door.nz || 0;        // inward normal
    const tgx = -inz, tgz = inx;                         // wall tangent
    const halfIn = (inx !== 0 ? w : d) / 2;              // door wall → far wall
    const halfTan = (inx !== 0 ? d : w) / 2;             // half the door wall (lateral)
    const WT = num(b.wt, 0.4);
    // the VISIBLE floor is the fit-out's finish laid over the slab top; the
    // ceiling is the fit-out's plane under the slab above
    const slab = (Array.isArray(b.floorTops) && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const next = (Array.isArray(b.floorTops) && b.floorTops[1] != null) ? b.floorTops[1] : slab + num(b.FH, 3.2);
    const cx = num(b.ox, lot.cx), cz = num(b.oz, lot.cz);
    S.lot = lot;
    S.cs = {
      name: b.name || "Threads & Drip",
      cx: cx, cz: cz, inx, inz, tx: tgx, tz: tgz, halfIn, halfTan, wt: WT,
      ff: slab + 0.06, ceil: next - 0.212,
      // the centre of the DOOR WALL, in world — the window gate measures how far
      // out on the pavement you are from this point.
      dwx: cx - inx * halfIn, dwz: cz - inz * halfIn,
      bounds: { minX: cx - w / 2 + WT, maxX: cx + w / 2 - WT, minZ: cz - d / 2 + WT, maxZ: cz + d / 2 - WT },
    };
    S.arena = arena;
    // THE FLOOR IS DRESSED WHEN YOU COME DOWN THE STREET, not at the city
    // boot: the racks, forms and window (6.4 MB of merged geometry, drawn only
    // from the door) were built at the boot for a shop that is usually a
    // district away, and held, hidden, never uploaded (dress() below)
    S.cx = S.cs.cx; S.cz = S.cs.cz; S.dressed = false;
    S.built = true;
    STORES.push(S);
    return true;
  }
  const DRESS_R = 80;         // past the window's 26 m read, with room to build it unseen
  function dress(S) {
    if (!S.built || S.dressed) return;
    S.dressed = true;
    buildDisplays(S);
  }

  /* ---- AN ISLAND OUTFITTER OR TAILOR ------------------------------------------
     CBZ.clothingStoreMount(lot, opts) -> { store, dispose }
       lot.building: { counter (WORLD {x, z, w, d, top, tx, tz, inx, inz}),
         vendor (the clerk, a getter), clearFloorPoint(dx, dz, pad) (world
         offsets from ox/oz), ox, oz }
       opts.cs: the room's frame, the same record ensureCity derives ({cx, cz,
         inx, inz, tx, tz, halfIn, halfTan, wt, ff, ceil, dwx, dwz, bounds,
         walk, fitSide, heroSide}); opts.tailor; opts.root (the island's);
       opts.post / b / via / door / where: the clerk at the cash wrap (CBZ.
         islandVenue.staff's post), the building, his way round the wrap to
         the street door (CBZ.shopFloor.clerkRoute), the island's key. */
  CBZ.clothingStoreMount = function (lot, opts) {
    opts = opts || {};
    if (!lot || !lot.building || !opts.cs) return null;
    const S = newStore({ lot: lot, cs: opts.cs, root: opts.root || null, island: true,
      tailor: !!opts.tailor, mult: opts.tailor ? 1.4 : 1,
      clerkOpts: opts.post ? { post: opts.post, b: opts.b, via: opts.via, door: opts.door, where: opts.where } : null });
    S.cx = S.cs.cx; S.cz = S.cs.cz; S.built = true;
    STORES.push(S);
    return {
      store: S,
      dispose: function () {
        if (HELD.store === S) dropAll(false);
        if (S.ledger && S.ledger.clerk && S.ledger.clerk.standDown) S.ledger.clerk.standDown();
        if (UI.open && UI.store === S) closePanel();
        undress(S);
        S.built = false;
        const i = STORES.indexOf(S); if (i >= 0) STORES.splice(i, 1);
      },
    };
  };

  // ---- per-frame --------------------------------------------------------------
  CBZ.onUpdate(38.6, function (dt) {
    const econOn = !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city");
    const cityOn = econOn && (CBZ.cityArenaLive ? CBZ.cityArenaLive() : (g.mode === "city"));
    if (cityOn) ensureCity();
    if (!econOn) {
      for (const S of STORES) { if (S.group) S.group.visible = false; if (S.winGroup) S.winGroup.visible = false; S.near = false; }
      if (UI.open) closePanel();
      if (HELD.items.length) dropAll(false);
      return;
    }
    if (!STORES.length) return;
    wireFixtures();
    const P = CBZ.player;
    for (const S of STORES) {
      const live = S.island || cityOn;
      if (!live) { if (S.group) S.group.visible = false; if (S.winGroup) S.winGroup.visible = false; S.near = false; continue; }
      const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
      if (!S.dressed && dx * dx + dz * dz < DRESS_R * DRESS_R && (CBZ.storeFixtureKit && CBZ.cityComposableSpec && econ())) dress(S);
      // The racks may ONLY render when the player is actually INSIDE the store
      // shell (plus a small doorway lip). r128's raycaster can't cull a hung
      // garment behind opaque walls, so the merch was reading through the glass
      // from the street ("White Trousers $80" floating outside). Gating on the
      // walkable bounds — not a 55m radius — keeps every sample sealed in the room.
      const inside = inStore(S, P.pos.x, P.pos.z, 1.2);
      const near = inside && (dx * dx + dz * dz) < VIS_R * VIS_R;
      if (S.group && S.group.visible !== near) S.group.visible = near;
      // THE WINDOW runs the opposite gate to the sales floor: it is meant to be
      // seen THROUGH the storefront glass, so it draws when you are out on the
      // pavement in front of this shop (or inside). Standing behind or beside the
      // building shows you nothing — that is the wall-see-through bug this file
      // already paid for once.
      if (S.winGroup) {
        const ox = P.pos.x - S.cs.dwx, oz = P.pos.z - S.cs.dwz;
        const out = ox * -S.cs.inx + oz * -S.cs.inz;                 // metres out from the shopfront
        const side = Math.abs(ox * S.cs.tx + oz * S.cs.tz);          // metres along it
        const winVis = near || (out > 0.2 && out < WIN_R && side < S.cs.halfTan + 4);
        if (S.winGroup.visible !== winVis) S.winGroup.visible = winVis;
      }
      S.near = near;
      if (UI.open && UI.store === S && (!near || g.state !== "playing" || P.dead || P.driving)) closePanel();
    }
    // what is in your hands: out of the door with it is the clerk's business;
    // dead, or the store gone, it simply drops
    const H = HELD.store;
    if (H) {
      if (P.dead || STORES.indexOf(H) < 0) dropAll(false);
      else ledgerTick(dt);
    }
    // the island clerks keep their own time (out in the doorway, back again)
    for (const S of STORES) if (S.ledger && S.ledger.clerk && S.near) S.ledger.clerk.tick(dt);
  });

  // the wardrobe panel is modal: it owns every key while it is up
  addEventListener("keydown", function (e) {
    if (!UI.open) return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    panelKey((e.key || "").toLowerCase());
  }, true);

  // ---- public hooks (interact/shops feature-detect; harness drives) ----------
  // is the store live (for this lot)? interact.js hides the clerk's "Browse the
  // racks" verb when it is, so the in-world racks are the ONE way to shop here.
  function storeOfLot(lot) { for (const S of STORES) if (S.built && S.lot && (!lot || S.lot === lot)) return S; return null; }
  CBZ.cityClothingLive = function (lot) { return !!storeOfLot(lot); };
  CBZ.cityClothingLot = function () { return (CITY.built && CITY.lot) || null; };
  // what you are holding and haven't paid for (the HUD, a probe)
  CBZ.clothingHeld = function () {
    return { items: HELD.items.map(function (h) { return { name: h.name, label: h.label, price: h.price, tried: h.tried }; }),
             total: heldTotal(), theft: !!(HELD.store && HELD.store.ledger && HELD.store.ledger.warned),
             store: HELD.store ? (HELD.store.island ? "island" : "city") : null };
  };
  // headless/harness handle: take a named piece off the nearest dressed store's
  // floor and pay for it at its counter (the same two verbs a player uses).
  CBZ.cityClothingBuy = function (labelOrName) {
    const P = CBZ.player;
    let best = null, bd = 1e18;
    if (CITY.built || ensureCity()) { /* the city store counts too */ }
    for (const S of STORES) { const d = P ? Math.hypot(P.pos.x - S.cx, P.pos.z - S.cz) : 0; if (d < bd) { bd = d; best = S; } }
    if (!best) return false;
    dress(best);
    let slot = best.slots.find((x) => x.kind === "item" && (x.name === labelOrName || x.label === labelOrName));
    if (!slot && best.tux && (best.tux.name === labelOrName || best.tux.label === labelOrName || labelOrName === "Tuxedo"))
      slot = { store: best, name: best.tux.name, visualId: best.tux.visualId, label: "Tuxedo" };
    if (!slot) return false;
    if (owned(slot)) { if (CBZ.cityWear) CBZ.cityWear(slot.visualId); return true; }
    take(slot);
    pay(best);
    return true;
  };
  CBZ.cityClothingState = function () {
    if (!CITY.built) return null;
    dress(CITY);
    return {
      lot: !!CITY.lot,
      items: CITY.slots.filter((s) => s.kind === "item").map((s) => ({
        name: s.name, visualId: s.visualId, price: priceOf(CITY, s.name), drip: s.drip,
        owned: owned(s), mannequin: !!s.mannequin })),
      tux: CITY.tux ? { name: CITY.tux.name, visualId: CITY.tux.visualId, price: priceOf(CITY, CITY.tux.name) } : null,
      panelOpen: !!UI.open, held: CBZ.clothingHeld(),
    };
  };
  // EXPORT ONLY (a gate/probe calls this; nothing in the game does). What the
  // store actually STANDS, so a dressing regression is a number and not a
  // screenshot: display forms, the street window, how many hanging runs the
  // catalog got spread over, and the whole group's real mesh count — the last
  // one is the perf ceiling this file has to live under.
  CBZ.cityClothingDressAudit = function (which) {
    const S = which === "island" ? STORES.find(function (x) { return x.island; }) : CITY;
    if (!S || !S.built) return null;
    dress(S);
    let meshes = 0, sprites = 0, winMeshes = 0;
    const count = function (o) { if (o.isMesh) meshes++; else if (o.isSprite) sprites++; };
    if (S.group) S.group.traverse(count);
    if (S.winGroup) { S.winGroup.traverse(count); S.winGroup.traverse(function (o) { if (o.isMesh) winMeshes++; }); }
    const items = S.slots.filter((s) => s.kind === "item");
    return {
      heroForms: S._forms | 0,               // styled display forms at the entrance
      windowForms: S._window | 0,            // street-facing forms behind the glass
      mannequins: (S._forms | 0) + (S._window | 0),
      runs: S._runs | 0, gondola: !!S._gondola, alcove: !!S._alcove,
      hangers: items.length - (S._forms | 0), // garments on a rail (vs on a form)
      slots: S.slots.length, items: items.length, till: !!S.till, tailor: !!S.tailor,
      meshes: meshes, winMeshes: winMeshes, sprites: sprites,
      winVisible: !!(S.winGroup && S.winGroup.visible), stores: STORES.length,
    };
  };
})();
