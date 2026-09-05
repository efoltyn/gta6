/* ============================================================
   world/prisonkit.js — THE COMPOUND'S OUTSIDE, BUILT OF REAL THINGS.

   OWNER (2026-09-04): "there's a shit ton of jail that's just not real at
   all like the guard towers, and half the jail is empty and dumb waste of
   space … rn it looks like cardboard at high def."

   ---- WHAT WAS MEASURED (tools/visual-presets/prison-exterior, HEAD) -----
   · Every wall, tower and room shell in the compound was ONE flat Lambert
     colour on a BoxGeometry: no joints, no stains, no coping, no bump. At
     1100 px a 250 m wall was a single grey rectangle. That is the cardboard.
   · The eight "guard towers" were a 2.2 m box with a 1.1 m slab on it,
     6.4 m tall, standing INSIDE an 11 m wall — from the exercise yard not
     one of them was visible at all (tower-yard shot: wall, sky, nothing).
     The four corner towers were a 12 m post with a lid.
   · The 2026-08-11 enlargement threw a 248 x 244 m wire around a 92 x 195 m
     prison and poured concrete over the difference. Six rooms sit in it;
     ~30,000 m² of the ring had no programme at all. A real compound's open
     ground is not empty: it is a sterile zone with a patrol road between an
     inner fence and the wall, fenced walkways between buildings, rec yards
     with courts and a track, a service yard with a vehicle sally port, a
     water tower and a transformer yard by the powerhouse.

   ---- WHAT THIS FILE IS ----------------------------------------------------
   The KIT the rest of the compound builds its outside from. Nothing here is
   placed; world/towers.js, world/prisonwings.js, world/yard.js,
   world/razorwire.js and world/prisongrounds.js call it.

     CBZ.prisonKit.skin(kind, tint)      a cached textured MeshStandardMaterial
                                          (wall panels, poured concrete, painted
                                          steel, galvanised, chain-link, glass,
                                          roller door, corrugated sheet)
     CBZ.prisonKit.skinBox(mesh, kind)   re-skin an addBox() mesh in place,
                                          UVs in WORLD metres so joints line up
                                          across segments — the collider, the
                                          LOS blocker and the ref all survive
     CBZ.prisonKit.stat(geo, mat, x,y,z) a static textured piece; merged per
                                          material + 40 m cell at window load
                                          (core/batch.js refuses mapped and
                                          Standard materials, so the kit
                                          merges its own)
     CBZ.guardTower(x, z, opts)          the tower. Concrete shaft, steel deck
                                          with a rail, glazed octagonal cabin,
                                          hipped roof, a caged ladder, the
                                          floodlight under the eave
     CBZ.prisonFence(run)                chain-link on galvanised posts with a
                                          top rail, concertina coil on top,
                                          gates (open or shut+solid), AABB
                                          colliders per run
     CBZ.floodMast(x, z, h)              an 18 m mast with a four-lamp head
                                          on systems/prisonnight's flood
                                          circuit
     CBZ.prisonGround(x,z,w,d,kind)      an asphalt / turf / concrete patch
                                          through CBZ.prisonGroundTex
     CBZ.prisonExteriorAudit()           fenceM, masts, programmedM2,
                                          ringOpenShare, texturedWalls

   TEXTURES ARE AUTHORED, NOT LOADED. Canvas + a seeded LCG, like
   world/textures_surface.js and the cell finishes: a byte-deterministic
   surface with no asset to ship. They are UNTAGGED (no sRGBEncoding) on
   purpose — the compound's palette (CBZ.mat / cmat / checkerTex) is
   untagged, and a tagged map beside an untagged wall reads a stop darker.

   THE HEIGHT LAW. CBZ.DIM.YH (11 m) is the wall. A tower that does not
   clear it by a storey is a tower nobody in the yard can see, which is what
   the old ones were. TOWER_DECK = YH + 1.5.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.addBox) return;
  const { addBox } = CBZ;
  const root = () => CBZ.prisonRoot || CBZ.scene;
  const YH = (CBZ.DIM && CBZ.DIM.YH) || 11;
  const TOWER_DECK = YH + 1.5;

  /* ==========================================================
     1. TEXTURES. A seeded LCG and a tileable value noise; each surface is
        a function of (x, y) in tile space drawn once into a canvas.
     ========================================================== */
  function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ (seed | 0);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // tileable value noise on a `freq` lattice over [0,1)²
  function vnoise(u, v, freq, seed) {
    const x = u * freq, y = v * freq;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0 % freq, y0 % freq, seed), b = hash2((x0 + 1) % freq, y0 % freq, seed);
    const c = hash2(x0 % freq, (y0 + 1) % freq, seed), d = hash2((x0 + 1) % freq, (y0 + 1) % freq, seed);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  function fbm(u, v, freq, oct, seed) {
    let s = 0, amp = 0.5, f = freq, tot = 0;
    for (let i = 0; i < oct; i++) { s += vnoise(u, v, f, seed + i * 7919) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return s / tot;
  }
  function canvasOf(size, paint) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const img = g.createImageData(size, size);
    const d = img.data;
    const px = { r: 0, g: 0, b: 0, a: 255 };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = 1 - y / size;            // v up, like the map
      px.r = px.g = px.b = 200; px.a = 255;
      paint(u, v, px, x, y);
      const i = (y * size + x) * 4;
      d[i] = px.r; d[i + 1] = px.g; d[i + 2] = px.b; d[i + 3] = px.a;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function tex(canvas, aniso) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso || 8;
    return t;
  }
  const grey = (px, l) => { px.r = px.g = px.b = Math.max(0, Math.min(255, l)); };

  const CANVAS = {};
  function surface(kind) {
    if (CANVAS[kind]) return CANVAS[kind];
    let c;
    if (kind === "panel") {
      /* precast concrete panels, 4 x 4 m tile: a vertical and a horizontal
         joint on the tile edge (so the wrap IS the joint), four form-tie
         holes per panel, water streaks off the top edge, a rust drip or two */
      const rnd = lcg(4101);
      const streaks = [];
      for (let i = 0; i < 9; i++) streaks.push({ u: rnd(), w: 0.006 + rnd() * 0.02, len: 0.3 + rnd() * 0.7, a: 0.10 + rnd() * 0.22 });
      const rust = [{ u: rnd(), a: 0.5 }, { u: rnd(), a: 0.35 }];
      c = canvasOf(512, function (u, v, px) {
        let l = 198 + (fbm(u, v, 3, 4, 11) - 0.5) * 34 + (fbm(u, v, 40, 2, 12) - 0.5) * 16;
        const eu = Math.min(u, 1 - u), ev = Math.min(v, 1 - v);
        // tie holes: 4 per panel, 22 mm dark discs
        for (const hx of [0.25, 0.75]) for (const hy of [0.3, 0.7]) {
          const dx = (u - hx) * 4, dy = (v - hy) * 4, r2 = dx * dx + dy * dy;
          if (r2 < 0.0005) l -= 70; else if (r2 < 0.0011) l -= 25;
        }
        for (const s of streaks) {
          const du = Math.abs(u - s.u);
          if (du < s.w && v > 1 - s.len) l -= 255 * s.a * (1 - du / s.w) * ((v - (1 - s.len)) / s.len);
        }
        let rr = 0;
        for (const r of rust) {
          const du = Math.abs(u - r.u);
          if (du < 0.004 && v > 0.35) rr = Math.max(rr, r.a * (1 - du / 0.004) * (v - 0.35) / 0.65);
        }
        // joints: 6 cm dark groove with a lit edge
        if (eu < 0.0075 || ev < 0.0075) l = 118 + fbm(u, v, 60, 1, 13) * 20;
        else if (eu < 0.012 || ev < 0.012) l -= 22;
        grey(px, l);
        if (rr > 0) { px.r = Math.min(255, px.r + 60 * rr); px.g -= 20 * rr; px.b -= 50 * rr; }
      });
    } else if (kind === "concrete") {
      c = canvasOf(256, function (u, v, px) {
        let l = 196 + (fbm(u, v, 4, 4, 21) - 0.5) * 34 + (fbm(u, v, 32, 2, 22) - 0.5) * 18;
        const pore = fbm(u, v, 90, 1, 23);
        if (pore > 0.82) l -= 40;
        grey(px, l);
      });
    } else if (kind === "steel") {
      // painted steel: flat with a faint brush grain and rust specks
      const rnd = lcg(777);
      const specks = [];
      for (let i = 0; i < 26; i++) specks.push({ u: rnd(), v: rnd(), r: 0.004 + rnd() * 0.012 });
      c = canvasOf(256, function (u, v, px) {
        let l = 226 + (fbm(u, v, 24, 2, 31) - 0.5) * 9 + (fbm(u, v, 2, 2, 32) - 0.5) * 8;
        let rr = 0;
        for (const s of specks) {
          const du = u - s.u, dv = v - s.v, d = Math.sqrt(du * du + dv * dv);
          if (d < s.r) rr = Math.max(rr, 1 - d / s.r);
        }
        grey(px, l);
        if (rr > 0) { px.r = Math.min(255, px.r - 40 * rr); px.g -= 100 * rr; px.b -= 140 * rr; }
      });
    } else if (kind === "galv") {
      c = canvasOf(256, function (u, v, px) {
        const cell = vnoise(u, v, 9, 41);
        let l = 218 + (Math.floor(cell * 6) / 6 - 0.5) * 22 + (fbm(u, v, 64, 1, 42) - 0.5) * 6;
        grey(px, l);
      });
    } else if (kind === "chainlink") {
      /* 2 m tile of 50 mm diamond mesh. Drawn as two families of diagonal
         lines; the wire is 2.4 px wide so it still reads at mid distance. */
      const N = 40;
      c = canvasOf(512, function (u, v, px) {
        const a = (u + v) * N, b = (u - v) * N;
        const da = Math.abs(a - Math.round(a)), db = Math.abs(b - Math.round(b));
        const w = 0.09;
        const hit = Math.min(da, db) < w;
        if (hit) { grey(px, 205 + (fbm(u, v, 30, 1, 51) - 0.5) * 30); px.a = 255; }
        else { grey(px, 200); px.a = 0; }
      });
    } else if (kind === "roller") {
      // a roller-shutter door: 0.3 m slats, dark groove between, one tile per leaf
      c = canvasOf(256, function (u, v, px) {
        const slat = (v * 14) % 1;
        let l = 222 + (fbm(u, v, 3, 2, 61) - 0.5) * 10 + Math.sin(slat * Math.PI) * 8;
        if (slat < 0.10 || slat > 0.95) l -= 60;
        grey(px, l);
      });
    } else if (kind === "corrugated") {
      c = canvasOf(128, function (u, v, px) {
        let l = 220 + Math.sin(u * Math.PI * 2 * 8) * 16 + (fbm(u, v, 6, 2, 71) - 0.5) * 8;
        grey(px, l);
      });
    } else if (kind === "grating") {
      // open steel grating for the deck: 30 x 100 mm bars, seen from above
      c = canvasOf(256, function (u, v, px) {
        const gx = (u * 33) % 1, gy = (v * 10) % 1;
        let l = 205 + (fbm(u, v, 20, 1, 81) - 0.5) * 10;
        if (gx < 0.3 || gy < 0.12) l -= 95;
        grey(px, l);
      });
    } else {
      c = canvasOf(64, function (u, v, px) { grey(px, 220); });
    }
    CANVAS[kind] = c;
    return c;
  }

  /* ==========================================================
     2. MATERIALS. One per (kind, tint); Standard, untagged, on the shared
        environment through core/gfx.js when a tier has one.
     ========================================================== */
  const MATS = new Map();
  const TILE = { panel: 4, concrete: 2, steel: 1, galv: 1, chainlink: 2, roller: 1, corrugated: 1, grating: 1 };
  function skin(kind, tint) {
    const key = kind + ":" + (tint == null ? "" : tint);
    if (MATS.has(key)) return MATS.get(key);
    let m;
    if (kind === "glass") {
      m = new THREE.MeshStandardMaterial({
        color: tint != null ? tint : 0x4b6e86, transparent: true, opacity: 0.42,
        roughness: 0.08, metalness: 0.55, side: THREE.DoubleSide, depthWrite: false,
        envMap: CBZ.ENV || null, envMapIntensity: 0.9,
      });
    } else {
      const canvas = surface(kind);
      const map = tex(canvas, kind === "chainlink" ? 16 : 8);
      const metal = kind === "galv" || kind === "chainlink" || kind === "grating";
      m = new THREE.MeshStandardMaterial({
        color: tint != null ? tint : 0xffffff, map: map,
        bumpMap: kind === "chainlink" ? null : map,
        bumpScale: kind === "panel" ? 0.02 : kind === "concrete" ? 0.008 : kind === "roller" ? 0.01 : kind === "corrugated" ? 0.012 : 0.002,
        roughness: metal ? 0.42 : kind === "steel" ? 0.55 : kind === "roller" ? 0.6 : 0.92,
        metalness: metal ? 0.72 : kind === "steel" || kind === "roller" || kind === "corrugated" ? 0.35 : 0.0,
        envMap: CBZ.ENV || null, envMapIntensity: metal ? 0.8 : 0.45,
      });
      if (kind === "chainlink") {
        m.transparent = true; m.alphaTest = 0.08; m.side = THREE.DoubleSide; m.depthWrite = true;
      }
      if (kind === "grating") m.side = THREE.DoubleSide;
    }
    m.name = "prison-" + key;
    m.userData.prisonKit = kind;
    if (typeof CBZ.gfxRegisterPbr === "function") { try { CBZ.gfxRegisterPbr(m); } catch (e) {} }
    MATS.set(key, m);
    return m;
  }

  /* ---- world-metre UVs. Triplanar by the vertex normal, so a box, a
       cylinder or a rotated plane all carry the same 4 m joint grid and two
       wall segments that meet at x=-30 share it. `off` shifts the geometry
       (an addBox mesh's geometry is local; its position is the offset). ---- */
  const _n = new THREE.Vector3(), _p = new THREE.Vector3();
  function worldUV(geo, tile, off) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    if (!pos || !nrm || !uv) return geo;
    const ox = off ? off.x : 0, oy = off ? off.y : 0, oz = off ? off.z : 0;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i); _n.fromBufferAttribute(nrm, i);
      const x = (_p.x + ox) / tile, y = (_p.y + oy) / tile, z = (_p.z + oz) / tile;
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
      if (ay >= ax && ay >= az) uv.setXY(i, x, z);
      else if (ax >= az) uv.setXY(i, _n.x >= 0 ? z : -z, y);
      else uv.setXY(i, _n.z >= 0 ? x : -x, y);
    }
    uv.needsUpdate = true;
    return geo;
  }
  let texturedWalls = 0;
  // the maps average ~0.84 of white, so a flat colour re-skinned as-is
  // reads a stop darker than it did; lift the tint to keep the wall's tone
  function toneUp(tint) {
    if (tint == null) return tint;
    const c = new THREE.Color(tint); c.multiplyScalar(1.04);
    return c.getHex();
  }
  function skinBox(mesh, kind, tint, tile) {
    if (!mesh || !mesh.geometry) return mesh;
    mesh.material = skin(kind, toneUp(tint));
    worldUV(mesh.geometry, tile || TILE[kind] || 2, mesh.position);
    mesh.userData.prisonSkin = kind;          // batch.js leaves userData meshes alone
    texturedWalls++;
    return mesh;
  }

  /* ==========================================================
     3. THE MERGER. Textured static pieces, per material and 40 m cell.
        Flushed at window load, BEFORE core/batch.js's own pass (listeners
        fire in registration order and this file parses first), and on
        demand.
     ========================================================== */
  const buckets = new Map();
  let merged = 0;
  function stat(geo, mat, x, y, z, o) {
    o = o || {};
    if (o.rz) geo.rotateZ(o.rz);
    if (o.rx) geo.rotateX(o.rx);
    if (o.ry) geo.rotateY(o.ry);
    geo.translate(x, y, z);
    if (o.uv) worldUV(geo, o.uv);
    const cast = o.cast !== false;
    const key = mat.uuid + ":" + Math.floor(x / 40) + ":" + Math.floor(z / 40) + ":" + (cast ? 1 : 0);
    let b = buckets.get(key);
    if (!b) { b = { mat: mat, cast: cast, geos: [] }; buckets.set(key, b); }
    b.geos.push(geo);
    return geo;
  }
  function flush() {
    const BGU = THREE.BufferGeometryUtils;
    for (const b of buckets.values()) {
      if (!b.geos.length) continue;
      let geo;
      if (b.geos.length === 1) geo = b.geos[0];
      else {
        // every kit geometry is indexed with position/normal/uv; strip any
        // extra attribute so mergeBufferGeometries sees one layout
        for (const g of b.geos) for (const name of Object.keys(g.attributes)) {
          if (name !== "position" && name !== "normal" && name !== "uv") g.deleteAttribute(name);
        }
        const same = b.geos.every((g) => !!g.index === !!b.geos[0].index);
        const list = same ? b.geos : b.geos.map((g) => g.index ? g.toNonIndexed() : g);
        geo = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(list, false) : null;
        if (!geo) { geo = list[0]; }
        else for (const g of list) if (g !== geo) g.dispose();
      }
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.cast; mesh.receiveShadow = true;
      mesh.userData.prisonKit = true;
      root().add(mesh);
      merged++;
      b.geos = [];
    }
    buckets.clear();
  }
  if (document.readyState === "complete") setTimeout(flush, 0);
  else addEventListener("load", flush);

  /* ==========================================================
     4. SMALL SHAPES the builders share.
     ========================================================== */
  // eight boxes on the edges of an octagon of circumradius R (flats on the axes)
  function octRing(R, y, h, t, mat, x, z, o) {
    const r = R * Math.cos(Math.PI / 8), len = 2 * R * Math.sin(Math.PI / 8) + t;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;                       // flats on the axes
      stat(new THREE.BoxGeometry(len, h, t), mat, x + Math.cos(a) * r, y, z + Math.sin(a) * r, Object.assign({ ry: -a + Math.PI / 2 }, o || {}));
    }
  }
  function post(x, y0, y1, r, mat, o) {
    return stat(new THREE.CylinderGeometry(r, r, y1 - y0, 6), mat, x[0], (y0 + y1) / 2, x[1], o);
  }
  // a helix (concertina coil) along a straight run
  class Helix extends THREE.Curve {
    constructor(len, r, pitch) {
      super();
      this.len = len; this.r = r; this.turns = Math.max(1, Math.round(len / pitch));
    }
    getPoint(t, target) {
      const a = t * this.turns * Math.PI * 2;
      return (target || new THREE.Vector3()).set(t * this.len, Math.cos(a) * this.r, Math.sin(a) * this.r);
    }
  }
  function coilRun(x0, z0, x1, z1, y, r, mat) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.5) return 0;
    const curve = new Helix(len, r || 0.36, 0.42);
    const g = new THREE.TubeGeometry(curve, curve.turns * 7, 0.018, 3, false);
    stat(g, mat, x0, y, z0, { ry: -Math.atan2(dz, dx), cast: false });
    return len;
  }

  /* ==========================================================
     5. THE GUARD TOWER.
        opts: deck (m, default TOWER_DECK), face {x,z} unit dir the ladder
        and the eave floodlight face, register (push CBZ.towers), shaft (m).
     ========================================================== */
  CBZ.towers = CBZ.towers || [];
  const towerRecs = [];
  function guardTower(x, z, opts) {
    opts = opts || {};
    const H = opts.deck != null ? opts.deck : TOWER_DECK;
    const S = opts.shaft || 2.8;
    const face = opts.face || { x: 0, z: -1 };
    const fa = Math.atan2(face.x, face.z);          // rotation.y that points +z at `face`
    const concrete = skin("concrete", 0xa9adb1);
    const steelDark = skin("steel", 0x3a4048), steelMid = skin("steel", 0x6c7580), steelRoof = skin("steel", 0x2c3138);
    const galv = skin("galv", 0xb4bcc4), grating = skin("grating", 0x8d949c), glass = skin("glass");

    if (opts.register !== false) CBZ.towers.push({ x: x, z: z });
    towerRecs.push({ x: x, z: z, deck: H });

    // plinth + shaft: the shaft is the collider and the LOS blocker (addBox
    // keeps it a real mesh with a ref), re-skinned to poured concrete
    const plinth = addBox(x, 0.25, z, S + 0.9, 0.5, S + 0.9, 0x9aa0a8, { solid: true });
    skinBox(plinth, "concrete", 0x9ea3a8);
    const shaft = addBox(x, H / 2, z, S, H, S, 0x9aa0a8, { solid: true, blockLOS: true });
    skinBox(shaft, "concrete", 0xa9adb1);
    // a drip band and the shaft's door at the foot on the ladder face
    stat(new THREE.BoxGeometry(S + 0.3, 0.22, S + 0.3), steelDark, x, H - 0.4, z, { cast: false });
    stat(new THREE.BoxGeometry(0.9, 2.05, 0.08), steelMid, x + face.x * (S / 2 + 0.03), 1.03, z + face.z * (S / 2 + 0.03), { ry: fa });

    // deck: an octagonal steel plate with grating on top, brackets under it
    const R = 3.25;
    stat(new THREE.CylinderGeometry(R, R, 0.22, 8), steelDark, x, H + 0.11, z, { ry: Math.PI / 8 });
    stat(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.03, 8), grating, x, H + 0.235, z, { ry: Math.PI / 8, uv: 1, cast: false });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      stat(new THREE.BoxGeometry(0.16, 1.6, 0.16), steelDark, x + Math.cos(a) * (S / 2 + 0.7), H - 0.75, z + Math.sin(a) * (S / 2 + 0.7), { rz: Math.cos(a) * 0.62, rx: -Math.sin(a) * 0.62, cast: false });
    }
    // rail: eight corner posts, two rails, a toe plate
    const Rr = R - 0.12;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;         // the vertices
      stat(new THREE.BoxGeometry(0.06, 1.1, 0.06), galv, x + Math.cos(a) * Rr, H + 0.8, z + Math.sin(a) * Rr, { cast: false });
    }
    octRing(Rr, H + 1.32, 0.05, 0.05, galv, x, z, { cast: false });
    octRing(Rr, H + 0.82, 0.04, 0.04, galv, x, z, { cast: false });
    octRing(Rr, H + 0.30, 0.12, 0.03, steelDark, x, z, { cast: false });

    // cabin: a solid spandrel to the sill, glazing to the head, mullions on
    // the corners, a sill and a head rail
    const Rc = 2.15, sill = H + 0.25 + 1.0, head = sill + 1.35;
    stat(new THREE.CylinderGeometry(Rc, Rc, 1.0, 8, 1, true), steelMid, x, H + 0.25 + 0.5, z, { ry: Math.PI / 8 });
    stat(new THREE.CylinderGeometry(Rc, Rc, 0.06, 8), steelDark, x, H + 0.25 + 0.03, z, { ry: Math.PI / 8, cast: false });
    stat(new THREE.CylinderGeometry(Rc - 0.02, Rc - 0.02, head - sill, 8, 1, true), glass, x, (sill + head) / 2, z, { ry: Math.PI / 8, cast: false });
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + i * Math.PI / 4;
      stat(new THREE.BoxGeometry(0.09, head - sill + 0.1, 0.09), steelDark, x + Math.cos(a) * Rc, (sill + head) / 2, z + Math.sin(a) * Rc, { ry: -a, cast: false });
    }
    octRing(Rc + 0.05, sill, 0.10, 0.14, steelDark, x, z, { cast: false });
    octRing(Rc + 0.05, head + 0.05, 0.14, 0.14, steelDark, x, z, { cast: false });
    // the desk and the man-height dark inside so the glass has depth
    stat(new THREE.CylinderGeometry(Rc - 0.25, Rc - 0.25, 0.9, 8), steelDark, x, H + 0.25 + 0.45, z, { ry: Math.PI / 8, cast: false });

    // roof: an octagonal hip with an overhang, a fascia, a finial mast
    const Rf = 3.35, eave = head + 0.12;
    stat(new THREE.ConeGeometry(Rf, 1.15, 8), steelRoof, x, eave + 0.575, z, { ry: Math.PI / 8 });
    octRing(Rf, eave - 0.09, 0.2, 0.06, steelDark, x, z, { cast: false });
    stat(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), galv, x, eave + 1.15 + 1.2, z, { cast: false });
    stat(new THREE.BoxGeometry(0.38, 0.5, 0.38), steelDark, x, eave + 1.15 + 0.25, z, { cast: false });
    // an under-eave floodlight aimed at the compound
    stat(new THREE.BoxGeometry(0.62, 0.30, 0.42), steelDark, x + face.x * (Rf - 0.5), eave - 0.35, z + face.z * (Rf - 0.5), { ry: fa, rx: 0.45, cast: false });
    const lamp = addBox(x + face.x * (Rf - 0.5) + 0.0, eave - 0.36, z + face.z * (Rf - 0.5), 0.5, 0.2, 0.36, 0x2b2b2b, { cast: false });
    lamp.userData.mover = true;
    if (CBZ.prisonLights && CBZ.prisonLights.register) {
      try { CBZ.prisonLights.register({ x: x + face.x * 6, z: z + face.z * 6, r: 15, kind: "flood", mesh: lamp, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b }); } catch (e) {}
    } else {
      (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push({ x: x + face.x * 6, z: z + face.z * 6, r: 15, kind: "flood", mesh: lamp, color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b });
    }

    // the way up: a caged rung ladder on the `face` side, ground to deck,
    // with a hatch cut in the deck plate at its head. Registered as the
    // z-axis ramp world/towers.js always used; systems/physics.js skips
    // CBZ.platforms in escape mode, so this is honest geometry and a record
    // that becomes a climb the day that gate lifts.
    const lx = x + face.x * (S / 2 + 0.36), lz = z + face.z * (S / 2 + 0.36);
    const px = -face.z, pz = face.x;                  // across the ladder
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      stat(new THREE.CylinderGeometry(0.03, 0.03, H + 0.9, 6), galv, lx + px * 0.24 * s, (H + 0.9) / 2, lz + pz * 0.24 * s, { cast: false });
    }
    for (let y = 0.35; y < H + 0.6; y += 0.3) {
      stat(new THREE.CylinderGeometry(0.014, 0.014, 0.5, 5), galv, lx, y, lz, { rz: Math.PI / 2, ry: fa, cast: false });
    }
    for (let y = 2.3; y < H - 0.2; y += 1.0) {
      const hoop = new THREE.TorusGeometry(0.4, 0.016, 5, 9, Math.PI);
      stat(hoop, galv, lx + face.x * 0.05, y, lz + face.z * 0.05, { rx: Math.PI / 2, ry: fa, cast: false });
    }
    for (let i = 0; i < 3; i++) {
      const s = i - 1;
      stat(new THREE.BoxGeometry(0.03, H - 2.5, 0.03), galv, lx + face.x * 0.42 * Math.cos(s * 1.2) + px * 0.4 * Math.sin(s * 1.2), (H + 2.3) / 2, lz + face.z * 0.42 * Math.cos(s * 1.2) + pz * 0.4 * Math.sin(s * 1.2), { cast: false });
    }
    if (CBZ.platforms) {
      const l0 = { x: lx, z: lz }, along = Math.abs(face.z) >= Math.abs(face.x);
      CBZ.platforms.push({
        minX: l0.x - 0.45, maxX: l0.x + 0.45, minZ: l0.z - 0.45, maxZ: l0.z + 0.45, top: H + 0.25,
        ramp: along ? { z0: l0.z + face.z * 0.4, z1: l0.z - face.z * 0.4, y0: 0, y1: H + 0.25 }
          : { x0: l0.x + face.x * 0.4, x1: l0.x - face.x * 0.4, y0: 0, y1: H + 0.25 },
      });
      CBZ.platforms.push({ minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R, top: H + 0.25 });
    }
    return { x: x, z: z, deck: H, headY: eave + 1.15 + 0.5 };
  }
  // where entities/searchlight.js mounts its lamp: on the finial, over the roof
  CBZ.towerHeadY = TOWER_DECK + 0.25 + 1.0 + 1.35 + 0.12 + 1.15 + 0.5;
  CBZ.TOWER_DECK = TOWER_DECK;
  CBZ.guardTower = guardTower;

  /* ==========================================================
     6. CHAIN-LINK FENCE.
        run: { x0, z0, x1, z1, h, razor, gates: [{ at, w, open, solid }],
               solid (default true), noCollide }
        `at` is metres along the run from (x0,z0). An open gate is two
        swung leaves and a gap; a shut gate is a leaf and a collider.
     ========================================================== */
  let fenceM = 0;
  const fenceRuns = [];
  function fence(run) {
    const x0 = run.x0, z0 = run.z0, x1 = run.x1, z1 = run.z1;
    const dx = x1 - x0, dz = z1 - z0, len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return null;
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    const h = run.h || 3.6, ang = -Math.atan2(dz, dx);
    const mesh = skin("chainlink", 0xb9c0c7), galv = skin("galv", 0xb4bcc4), steel = skin("steel", 0x4a525c);
    const coil = skin("galv", 0xd8dde3);
    const gates = (run.gates || []).slice().sort((a, b) => a.at - b.at);
    const solid = run.solid !== false;
    fenceRuns.push({ x0, z0, x1, z1, len });

    // the pieces between gates
    const segs = [];
    let cur = 0;
    for (const g of gates) {
      const a = Math.max(0, g.at - g.w / 2), b = Math.min(len, g.at + g.w / 2);
      if (a > cur + 0.05) segs.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < len - 0.05) segs.push([cur, len]);

    for (const s of segs) {
      const a = s[0], b = s[1], L = b - a;
      const cx = x0 + ux * (a + b) / 2, cz = z0 + uz * (a + b) / 2;
      // the mesh panel, world-metre UVs so the diamonds are 50 mm everywhere
      const panel = new THREE.PlaneGeometry(L, h - 0.05);
      panel.rotateY(ang + 0);
      panel.translate(cx, (h - 0.05) / 2 + 0.05, cz);
      // rotate then translate by hand so the UV pass sees world coordinates
      const uv = panel.attributes.uv, pos = panel.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), pz = pos.getZ(i);
        uv.setXY(i, ((px - x0) * ux + (pz - z0) * uz) / 2, pos.getY(i) / 2);
      }
      stat(panel, mesh, 0, 0, 0, { cast: false });
      // posts every 3 m, a top rail, a bottom tension wire
      const n = Math.max(1, Math.round(L / 3));
      for (let i = 0; i <= n; i++) {
        const t = a + (L * i) / n;
        stat(new THREE.CylinderGeometry(0.045, 0.045, h + 0.1, 6), galv, x0 + ux * t, (h + 0.1) / 2, z0 + uz * t, { cast: i % 2 === 0 });
      }
      stat(new THREE.CylinderGeometry(0.025, 0.025, L, 5), galv, cx, h - 0.02, cz, { rz: Math.PI / 2, ry: ang, cast: false });
      stat(new THREE.CylinderGeometry(0.012, 0.012, L, 4), galv, cx, 0.06, cz, { rz: Math.PI / 2, ry: ang, cast: false });
      if (run.razor !== false) {
        // three outriggers' worth of coil: one on top, canted arms every 3 m
        coilRun(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, h + 0.36, 0.36, coil);
        for (let i = 0; i <= n; i++) {
          const t = a + (L * i) / n;
          stat(new THREE.BoxGeometry(0.04, 0.7, 0.04), galv, x0 + ux * t, h + 0.3, z0 + uz * t, { cast: false });
        }
      }
      if (solid && !run.noCollide) {
        // axis-aligned AABBs 0.16 m thick; a diagonal run is chopped
        const pieces = Math.abs(ux) > 0.99 || Math.abs(uz) > 0.99 ? 1 : Math.max(1, Math.ceil(L / 2));
        for (let i = 0; i < pieces; i++) {
          const ta = a + (L * i) / pieces, tb = a + (L * (i + 1)) / pieces;
          const ax = x0 + ux * ta, az = z0 + uz * ta, bx = x0 + ux * tb, bz = z0 + uz * tb;
          CBZ.colliders.push({
            minX: Math.min(ax, bx) - 0.08, maxX: Math.max(ax, bx) + 0.08,
            minZ: Math.min(az, bz) - 0.08, maxZ: Math.max(az, bz) + 0.08,
            fence: true, noBreach: true,
          });
        }
      }
    }
    // gates
    for (const g of gates) {
      const a = Math.max(0, g.at - g.w / 2), b = Math.min(len, g.at + g.w / 2);
      const L = b - a;
      for (const t of [a, b]) stat(new THREE.CylinderGeometry(0.07, 0.07, h + 0.4, 8), steel, x0 + ux * t, (h + 0.4) / 2, z0 + uz * t, {});
      const leaf = function (t0, L2, swing) {
        // a framed leaf hinged at t0, swung `swing` radians off the run line
        const hx = x0 + ux * t0, hz = z0 + uz * t0;
        const ca = Math.cos(swing), sa = Math.sin(swing);
        const lx = ux * ca + nx * sa, lz = uz * ca + nz * sa;      // leaf direction
        const cx = hx + lx * L2 / 2, cz = hz + lz * L2 / 2, la = -Math.atan2(lz, lx);
        const lh = h - 0.2;
        stat(new THREE.BoxGeometry(L2, 0.07, 0.07), steel, cx, lh, cz, { ry: la, cast: false });
        stat(new THREE.BoxGeometry(L2, 0.07, 0.07), steel, cx, 0.12, cz, { ry: la, cast: false });
        stat(new THREE.BoxGeometry(0.07, lh, 0.07), steel, hx + lx * (L2 - 0.04), lh / 2 + 0.08, hz + lz * (L2 - 0.04), { cast: false });
        const p = new THREE.PlaneGeometry(L2 - 0.1, lh - 0.2);
        p.rotateY(la); p.translate(cx, lh / 2 + 0.1, cz);
        const uv = p.attributes.uv, pos = p.attributes.position;
        for (let i = 0; i < pos.count; i++) uv.setXY(i, ((pos.getX(i) - hx) * lx + (pos.getZ(i) - hz) * lz) / 2, pos.getY(i) / 2);
        stat(p, mesh, 0, 0, 0, { cast: false });
        return { x: cx, z: cz };
      };
      if (g.open) {
        leaf(a, L / 2 - 0.05, 1.75 * (g.side || 1));
        leaf(b, L / 2 - 0.05, Math.PI - 1.75 * (g.side || 1));
      } else {
        leaf(a, L - 0.05, 0);
        if (solid && !run.noCollide) {
          const ax = x0 + ux * a, az = z0 + uz * a, bx = x0 + ux * b, bz = z0 + uz * b;
          CBZ.colliders.push({
            minX: Math.min(ax, bx) - 0.08, maxX: Math.max(ax, bx) + 0.08,
            minZ: Math.min(az, bz) - 0.08, maxZ: Math.max(az, bz) + 0.08,
            fence: true, gate: true, noBreach: true,
          });
        }
        if (g.sign) signPlate(g.sign, x0 + ux * g.at + nx * 0.1, 1.55, z0 + uz * g.at + nz * 0.1, 1.2, 0.36, ang, "#f3f3ef", "#b3261e");
      }
    }
    fenceM += len;
    return run;
  }
  CBZ.prisonFence = fence;

  // a printed plate: text on a coloured board, facing +z before `ry`
  function signPlate(text, x, y, z, w, h, ry, fg, bg) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = Math.max(64, Math.round(512 * h / w));
    const g = c.getContext("2d");
    g.fillStyle = bg || "#b3261e"; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.fillStyle = fg || "#f3f3ef";
    g.textAlign = "center"; g.textBaseline = "middle";
    const lines = String(text).split("\n");
    let size = Math.round(c.height * (lines.length > 1 ? 0.36 : 0.44));
    for (;;) {
      g.font = "700 " + size + "px Arial, Helvetica, sans-serif";
      const widest = Math.max.apply(null, lines.map((ln) => g.measureText(ln).width));
      if (widest <= c.width * 0.9 || size <= 12) break;
      size -= 2;
    }
    lines.forEach((ln, i) => g.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * c.height * 0.46));
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry || 0;
    m.userData.sign = true;
    root().add(m);
    return m;
  }
  CBZ.prisonSign = signPlate;

  /* ==========================================================
     7. FLOODLIGHT MAST. 18 m, four heads on a crossarm, on the flood
        circuit (strikes at dusk, systems/prisonnight.js).
     ========================================================== */
  let masts = 0;
  function floodMast(x, z, h, aim) {
    h = h || 18;
    const galv = skin("galv", 0xb4bcc4), concrete = skin("concrete", 0x9ea3a8), dark = skin("steel", 0x3a4048);
    aim = aim || { x: 0, z: 1 };
    const fa = Math.atan2(aim.x, aim.z);
    stat(new THREE.BoxGeometry(1.0, 0.5, 1.0), concrete, x, 0.25, z, {});
    stat(new THREE.CylinderGeometry(0.11, 0.22, h, 8), galv, x, h / 2 + 0.5, z, {});
    stat(new THREE.BoxGeometry(2.8, 0.14, 0.14), dark, x, h + 0.3, z, { ry: fa + Math.PI / 2, cast: false });
    const heads = [];
    for (let i = 0; i < 4; i++) {
      const s = (i - 1.5) * 0.7;
      const hx = x + Math.cos(fa) * s, hz = z - Math.sin(fa) * s;
      stat(new THREE.BoxGeometry(0.5, 0.34, 0.5), dark, hx, h + 0.05, hz, { ry: fa, rx: 0.55, cast: false });
      const lamp = addBox(hx + aim.x * 0.18, h - 0.06, hz + aim.z * 0.18, 0.44, 0.16, 0.3, 0x2b2b2b, { cast: false });
      lamp.rotation.y = fa; lamp.rotation.x = 0.55;
      lamp.userData.mover = true;
      heads.push(lamp);
    }
    const rec = { x: x + aim.x * 8, z: z + aim.z * 8, r: 22, kind: "flood", mesh: heads[0], color: 0xfff4d2, emissive: 0xffd88a, off: 0x2b2b2b };
    if (CBZ.prisonLights && CBZ.prisonLights.register) { try { CBZ.prisonLights.register(rec); } catch (e) {} }
    else (CBZ._prisonLateFixtures || (CBZ._prisonLateFixtures = [])).push(rec);
    // the other three heads follow the first's material
    for (let i = 1; i < heads.length; i++) heads[i].material = heads[0].material;
    if (CBZ.colliders) CBZ.colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, mast: true, noBreach: true });
    masts++;
    return rec;
  }
  CBZ.floodMast = floodMast;

  /* ==========================================================
     8. GROUND. A patch of asphalt, turf or concrete through the shared
        institutional-ground author (world/materials.js prisonGroundTex).
        `program` names what the patch is for; the audit sums it.
     ========================================================== */
  const programs = [];
  function ground(x, z, w, d, kind, o) {
    o = o || {};
    let tex = null;
    const kinds = { asphalt: ["#4b515a", "#434950"], turf: ["#6f8a4a", "#5d7a3e"], concrete: ["#5b636c", "#535b64"], gravel: ["#6c6a63", "#5e5c56"], track: ["#8a4d3d", "#7a4335"] };
    const gk = kind === "turf" ? "yard-grass" : kind === "track" || kind === "gravel" ? "asphalt" : kind;
    const ab = kinds[kind] || kinds.concrete;
    if (CBZ.prisonGroundTex) tex = CBZ.prisonGroundTex(gk, { a: o.a || ab[0], b: o.b || ab[1] });
    else if (CBZ.checkerTex) tex = CBZ.checkerTex(ab[0], ab[1], 2);
    if (!tex) return null;
    tex.repeat.set(Math.max(1, Math.round(w / 6.3)), Math.max(1, Math.round(d / 6.3)));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, o.y != null ? o.y : 0.02, z);
    m.receiveShadow = true;
    m.userData.ground = kind;
    root().add(m);
    if (o.program) programs.push({ id: o.program, x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, m2: w * d });
    return m;
  }
  CBZ.prisonGround = ground;
  // a painted line on the ground (a thin box; nothing casts, nothing collides)
  function paint(x, z, w, d, color, y) {
    return addBox(x, y != null ? y : 0.045, z, w, 0.012, d, color != null ? color : 0xe9e9e4, { cast: false });
  }
  CBZ.prisonPaint = paint;
  function program(id, x0, x1, z0, z1) { programs.push({ id, x0, x1, z0, z1, m2: (x1 - x0) * (z1 - z0) }); }

  /* ==========================================================
     9. THE AUDIT. Numbers the exterior preset prints, and what the
        "empty and dumb" complaint is as a fraction.
     ========================================================== */
  CBZ.prisonExteriorAudit = function () {
    const W = CBZ.WORLD || {};
    const OUT = W.wings || { x0: -124, x1: 124, z0: -116, z1: 128 };
    const N = W.northYard || { x0: -30, x1: 30, z0: -8, z1: 52 };
    const S = W.southBlock || { x0: -44, x1: 44, z0: 52, z1: 128 };
    const CB = W.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
    const AD = W.adminWing || { x0: -20, x1: 20, z0: -64, z1: -44 };
    const inner = (N.x1 - N.x0) * (N.z1 - N.z0) + (S.x1 - S.x0) * (S.z1 - S.z0)
      + (CB.x1 - CB.x0) * (CB.z1 - CB.z0) + (AD.x1 - AD.x0) * (AD.z1 - AD.z0);
    const ring = (OUT.x1 - OUT.x0) * (OUT.z1 - OUT.z0) - inner;
    // rooms in the ring take their own footprint out of "open"
    let rooms = 0;
    for (const s of (CBZ.prisonShells || [])) {
      if (!s || !isFinite(+s.x0)) continue;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const inOld = cx > N.x0 && cx < N.x1 && cz > CB.z0 && cz < N.z1 || cx > S.x0 && cx < S.x1 && cz > S.z0 && cz < S.z1 || cz > AD.z0 && cz < AD.z1 && cx > AD.x0 && cx < AD.x1;
      if (!inOld) rooms += Math.abs((s.x1 - s.x0) * (s.z1 - s.z0));
    }
    let programmed = 0;
    for (const p of programs) programmed += p.m2;
    const open = Math.max(0, ring - rooms);
    return {
      fenceM: fenceM, masts: masts, towers: towerRecs.length, mergedMeshes: merged,
      texturedWalls: texturedWalls, programmedM2: Math.round(programmed),
      ringM2: ring, ringRoomsM2: Math.round(rooms), ringOpenM2: Math.round(open),
      ringOpenShare: open > 0 ? Math.max(0, 1 - programmed / open) : 0,
      programs: programs.map((p) => p.id),
    };
  };

  CBZ.prisonKit = {
    skin, skinBox, worldUV, stat, flush, octRing, post, coilRun, fence, floodMast, ground, paint, program, sign: signPlate, toneUp,
    TOWER_DECK, TILE,
    // roombuild.js's roomShell skins its walls with this when a caller does not
    // say; world/prisongrounds.js (the last prison builder) clears it so the
    // city's interiors, built later, keep their flat plaster
    defaultSkin: "panel",
  };
})();
