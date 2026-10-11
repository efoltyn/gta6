"use strict";
/* src/battle/arenas/woods.js — NPC War: THE WOOD, and the trees of the snow.

   FOREST is a real wood, not trees scattered on grass. It is built in the
   storeys a temperate wood actually has:

     CANOPY     mature broadleaf (the kit's mature-wood bole under a mature
                crown, 16-32 m) with conifer patches (spruce bole and spire),
                on a jittered lattice thinned by stand density, so the trees
                stand in groups with gaps instead of on a grid.
     UNDERSTORY saplings (subcanopy) where light gets in, holly/hazel
                thicket in clumps, bracken (a fern of real fronds) on the
                floor between them.
     DEADFALL   fallen trunks with their bark and their torn-up root plates,
                and mossy boulders: the wood's real low cover.
     FLOOR      leaf litter, moss, twigs and fallen leaves in the ground
                shader, DAPPLED by a canopy map this file paints from the
                crowns it placed (shade under crowns, sun flecks through).

   Every bole is a collider and a cover point set (a man behind a beech is
   behind a beech), every log is cover, and a bole a bomb beats falls: its
   crown and trunk instances are put away and a log lies where it was,
   pointing away from the blast. Glades and the two start clearings are
   kept open, and a forestry ride (a straight 6 m track) crosses the wood so
   a vehicle has a way through.

   Everything is instanced and chunked: 4 x 4 chunks over the stand, each its
   own InstancedMesh per part with a bounding sphere of its own, so the
   camera culls the wood by the chunk. The outer belt (beyond the fighting
   ground, to the skin's edge) is the same trees, thinner, without colliders
   and without shadows: the horizon is a wood, not a cut-out.

   SNOW wears spruce groves on the flanks and in no-man's land (frosted
   spires), granite with drifts in the lee of it.

   PUBLIC  CBZ.battleWoods = { forest(ctx), snow(ctx), stats() } */

CBZ.battleWoods = (function () {
  const W = { trees: 0, under: 0, ferns: 0, logs: 0, belt: 0, felled: 0, chunks: 0 };
  function h01(a, b, s) {
    let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const KIT = function () { return CBZ.vegetationKit || null; };

  /* BRACKEN: one fern, eleven arching fronds, each a spine with pinnae —
     geometry, the way the palm crown is (a frond reads by its comb). */
  let fernG = null;
  function fernGeo() {
    if (fernG) return fernG;
    const pos = [], col = [];
    const N = 11, SEG = 9;
    for (let f = 0; f < N; f++) {
      const yaw = f / N * Math.PI * 2 + h01(f, 1, 5) * 0.4;
      const len = 0.75 + h01(f, 2, 5) * 0.45, lift = 0.9 + h01(f, 3, 5) * 0.5;
      const dx = Math.cos(yaw), dz = Math.sin(yaw), sx = -dz, sz = dx;
      let px = 0, py = 0, pz = 0;
      for (let s = 0; s < SEG; s++) {
        const u = (s + 0.5) / SEG, ang = lift - 2.1 * u * u, dl = len / SEG;
        const nx = px + dx * Math.cos(ang) * dl, ny = py + Math.sin(ang) * dl, nz = pz + dz * Math.cos(ang) * dl;
        const w = 0.2 * Math.sin(Math.PI * Math.min(1, 0.15 + u)) + 0.03;
        const shade = 0.55 + 0.45 * u;
        for (const sg of [-1, 1]) {
          const tx = (px + nx) / 2 + sx * sg * w + dx * w * 0.4, ty = (py + ny) / 2 - w * 0.35, tz = (pz + nz) / 2 + sz * sg * w + dz * w * 0.4;
          pos.push(px, py, pz, nx, ny, nz, tx, ty, tz);
          col.push(shade * 0.8, shade * 0.85, shade * 0.6, shade, shade, shade * 0.75, shade * 1.1, shade * 1.1, shade * 0.8);
        }
        px = nx; py = ny; pz = nz;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1] + 0.4, z = pos[i + 2], l = Math.hypot(x, y, z) || 1;
      nrm[i] = x / l * 0.5; nrm[i + 1] = y / l * 0.5 + 0.5; nrm[i + 2] = z / l * 0.5;
    }
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    return (fernG = g);
  }

  /* ---- chunked instance pools ---------------------------------------- */
  function Chunks(cx, cz, half, n) {
    this.cx = cx; this.cz = cz; this.half = half; this.n = n; this.size = half * 2 / n;
    this.parts = {};
  }
  Chunks.prototype.key = function (x, z) {
    const i = Math.max(0, Math.min(this.n - 1, Math.floor((x - this.cx + this.half) / this.size)));
    const j = Math.max(0, Math.min(this.n - 1, Math.floor((z - this.cz + this.half) / this.size)));
    return j * this.n + i;
  };
  Chunks.prototype.add = function (part, geoKey, x, z, m4, color) {
    const k = part + "|" + geoKey + "|" + this.key(x, z);
    let P = this.parts[k];
    if (!P) P = this.parts[k] = { part: part, geoKey: geoKey, ck: this.key(x, z), mats: [], cols: [], mesh: null };
    P.mats.push(m4.clone());
    P.cols.push(color ? color : null);
    return { P: P, i: P.mats.length - 1 };
  };
  Chunks.prototype.build = function (geoOf, matOf, opts) {
    opts = opts || {};
    const self = this;
    Object.keys(this.parts).forEach(function (k) {
      const P = self.parts[k];
      const base = geoOf(P.part, P.geoKey);
      if (!base) return;
      // a view of the shared geometry with this chunk's own bounds, so the
      // frustum culls the chunk (the GPU buffers are the same objects)
      const g = new THREE.BufferGeometry();
      for (const a in base.attributes) g.setAttribute(a, base.attributes[a]);
      if (base.index) g.setIndex(base.index);
      const ci = P.ck % self.n, cj = (P.ck / self.n) | 0;
      const ccx = self.cx - self.half + (ci + 0.5) * self.size, ccz = self.cz - self.half + (cj + 0.5) * self.size;
      let ymin = Infinity, ymax = -Infinity;
      const e = P.mats[0].elements;
      for (let i = 0; i < P.mats.length; i++) { const y = P.mats[i].elements[13]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
      void e;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(ccx, (ymin + ymax) / 2 + 10, ccz), self.size * 0.75 + 30 + (ymax - ymin) / 2);
      const mesh = new THREE.InstancedMesh(g, matOf(P.part, P.geoKey), P.mats.length);
      const hasCol = P.cols[0] != null;
      const cols = hasCol ? new Float32Array(P.mats.length * 3) : null;
      for (let i = 0; i < P.mats.length; i++) {
        mesh.setMatrixAt(i, P.mats[i]);
        if (hasCol) { const c = P.cols[i]; cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2]; }
      }
      if (hasCol) mesh.instanceColor = new THREE.InstancedBufferAttribute(cols, 3);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = true;
      mesh.castShadow = opts.shadows !== false && P.part !== "fern";
      if (mesh.castShadow && /crown|spire|under|thicket/.test(P.part)) {
        const dm = KIT() && KIT().depthMaterial ? KIT().depthMaterial("mature-crown") : null;
        if (dm) mesh.customDepthMaterial = dm;
      }
      mesh.receiveShadow = true;
      mesh.userData.dynamic = true;
      mesh.name = (opts.name || "woods") + "-" + P.part;
      CBZ.scene.add(mesh);
      P.mesh = mesh;
      W.chunks++;
    });
  };
  const ZERO = function () { return new THREE.Matrix4().makeScale(0, 0, 0); };
  function hide(h) {
    if (!h || !h.P.mesh) return;
    h.P.mesh.setMatrixAt(h.i, ZERO());
    h.P.mesh.instanceMatrix.needsUpdate = true;
  }

  function geoOf(part, key) {
    const K = KIT();
    if (part === "fern") return fernGeo();
    if (!K) return null;
    return K.geometry(part === "trunk" ? "mature-wood" : part === "ctrunk" ? "conifer-wood" : part === "spire" ? "conifer-spire" :
      part === "crown" ? "mature-crown" : part === "under" ? "subcanopy" : "thicket", key | 0);
  }
  let fernMat = null;
  function matOf(part) {
    const K = KIT();
    if (part === "fern") {
      if (!fernMat) fernMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      return fernMat;
    }
    if (part === "trunk" || part === "ctrunk") return K.material("mature-wood");
    return K.material("mature-crown");
  }

  /* ---- ONE TREE ---------------------------------------------------------- */
  const _m = { m: null, p: null, q: null, s: null, e: null };
  function M4(x, y, z, yaw, sx, sy, sz, lean) {
    if (!_m.m) { _m.m = new THREE.Matrix4(); _m.p = new THREE.Vector3(); _m.q = new THREE.Quaternion(); _m.s = new THREE.Vector3(); _m.e = new THREE.Euler(); }
    _m.e.set(lean || 0, yaw, (lean || 0) * 0.5);
    _m.q.setFromEuler(_m.e);
    return _m.m.compose(_m.p.set(x, y, z), _m.q, _m.s.set(sx, sy, sz));
  }
  function foliage(x, z, conifer, j) {
    // one ramp of greens, varied by stand and by tree
    const s = vn2(x * 0.01, z * 0.01, 301);
    if (conifer) return [0.1 + j * 0.06, 0.24 + s * 0.08 + j * 0.05, 0.12 + j * 0.04];
    return [0.16 + s * 0.08 + j * 0.06, 0.3 + s * 0.1 + j * 0.08, 0.1 + j * 0.05];
  }
  function tree(CH, g, x, z, sc, conifer, ctx, o) {
    const K = KIT();
    const y = g(x, z);
    const yaw = h01(x * 7, z * 7, 401) * 6.28, lean = (h01(x * 3, z * 3, 403) - 0.5) * 0.06;
    const v = K.variantAt ? K.variantAt(x, z, conifer ? "conifer-spire" : "mature-crown") : 0;
    const j = h01(x * 5, z * 5, 405);
    const trunk = CH.add(conifer ? "ctrunk" : "trunk", 0, x, z, M4(x, y - 0.3 * sc, z, yaw, sc, sc, sc, lean), null);
    let crown;
    if (conifer) {
      crown = CH.add("spire", v, x, z, M4(x, y + 13 * sc * 0.3, z, yaw, sc * 0.92, sc * (20 / 23) * 1.34, sc * 0.92, lean), (o && o.frost) ? [0.62, 0.68, 0.7] : foliage(x, z, true, j));
    } else {
      const folR = sc * (0.88 + h01(x, z, 407) * 0.2), folH = sc * (0.9 + h01(x, z, 409) * 0.16);
      crown = CH.add("crown", v, x, z, M4(x, y + 13 * sc, z, yaw, folR, folH, folR, lean), foliage(x, z, false, j));
    }
    W.trees++;
    return { x: x, z: z, y: y, sc: sc, trunk: trunk, crown: crown, conifer: conifer };
  }
  // the stump end shatters to splinters and the crown sheds a shower of
  // leaves in its own green (CBZ.debris: instanced, irregular, settling)
  function splinter(t) {
    const Db = CBZ.debris, cam = CBZ.camera && CBZ.camera.position;
    if (!Db || !Db.chips || !cam || (cam.x - t.x) * (cam.x - t.x) + (cam.z - t.z) * (cam.z - t.z) > 220 * 220) return;
    const f = foliage(t.x, t.z, t.conifer, h01(t.x * 5, t.z * 5, 405));
    const leaf = (Math.round(f[0] * 255) << 16) | (Math.round(f[1] * 255) << 8) | Math.round(f[2] * 255);
    try {
      Db.chips(t.x, t.y + 1.2 * t.sc, t.z, { kind: "wood", color: 0xb08a58, count: 10, size: 0.16 * t.sc, power: 1.4, spread: 0.8, dust: false });
      Db.chips(t.x, t.y + 9 * t.sc, t.z, { kind: "foliage", color: leaf, count: 20, size: 0.14, power: 0.9, spread: 4 * t.sc, dust: true, radius: 2.5 * t.sc });
    } catch (e) {}
  }
  /* A BOLE IS COVER, and a bole a bomb beats comes down: the crown and trunk
     are put away and a log lies where it stood, felled away from the blast. */
  function bole(t, ctx, collide) {
    if (!collide || !CBZ.battleCover) return;
    const r = 0.36 * t.sc;
    CBZ.battleCover.add({
      kind: "tree", x: t.x, z: t.z, yaw: 0, hw: r, hd: r, h: 9 * t.sc, hp: 330 * t.sc, rubbleH: 0, gy: t.y,
      onDestroy: function (rec) {
        hide(t.trunk); hide(t.crown);
        W.felled++;
        splinter(t);
        const a = h01(t.x * 11, t.z * 11, 411) * 6.28;
        const L = 13 * t.sc, cx = t.x + Math.cos(a) * L * 0.5, cz = t.z - Math.sin(a) * L * 0.5;
        if (CBZ.battleDress) {
          CBZ.battleDress.place("log", cx, cz, a, { len: L, r: 0.42 * t.sc, root: true });
          CBZ.battleDress.flush();
        }
        void rec;
      },
    });
  }

  /* ============================================================ FOREST */
  function forest(ctx) {
    const K = KIT();
    if (!K) return null;
    const g = ctx.groundAt, cx = ctx.cx, cz = ctx.cz;
    const MAIN = 330, BELT = 540;
    const CH = new Chunks(cx, cz, BELT, 6);
    const half = ctx.gap / 2;
    // what stays open: the two start clearings, glades, and the ride
    const glades = [];
    for (let k = 0; k < 4; k++) {
      glades.push({ x: cx + (h01(k, 1, 421) - 0.5) * ctx.gap * 0.9, z: cz + (h01(k, 2, 421) - 0.5) * 360, r: 16 + h01(k, 3, 421) * 16 });
    }
    const rideZ = cz + (h01(9, 9, 423) - 0.5) * 120;
    const open = function (x, z, pad) {
      pad = pad || 0;
      for (let i = 0; i < ctx.keepOut.length; i++) {
        const k = ctx.keepOut[i];
        if (Math.abs(x - k.x) < k.hx + pad && Math.abs(z - k.z) < k.hz + pad) return true;
      }
      for (let i = 0; i < glades.length; i++) { const q = glades[i]; if (Math.hypot(x - q.x, z - q.z) < q.r + pad) return true; }
      const rz = rideZ + Math.sin((x - cx) * 0.006) * 30;
      if (Math.abs(z - rz) < 3.5 + pad && Math.abs(x - cx) < MAIN + 40) return true;
      return false;
    };
    const stands = [];
    // canopy cover, painted as the crowns are placed (forest floor dapple)
    const CN = 256, cov = new Float32Array(CN * CN), CR = BELT + 40;
    const paint = function (x, z, r) {
      const fx = (x - cx + CR) / (CR * 2) * CN, fz = (z - cz + CR) / (CR * 2) * CN, fr = r / (CR * 2) * CN;
      for (let j = Math.max(0, Math.floor(fz - fr)); j <= Math.min(CN - 1, Math.ceil(fz + fr)); j++)
        for (let i = Math.max(0, Math.floor(fx - fr)); i <= Math.min(CN - 1, Math.ceil(fx + fr)); i++) {
          const d = Math.hypot(i - fx, j - fz) / fr;
          if (d < 1) cov[j * CN + i] += (1 - d * d) * 0.75;
        }
    };
    const feet = CBZ.treeFoot ? [] : null;
    // the lattice: 9.5 m in the fighting ground, 15 m in the belt
    for (const ring of [0, 1]) {
      const cell = ring ? 15 : 9.5;
      const R = ring ? BELT : MAIN;
      for (let gx = -R; gx < R; gx += cell) for (let gz = -R; gz < R; gz += cell) {
        if (ring && Math.abs(gx) < MAIN && Math.abs(gz) < MAIN) continue;
        const ix = Math.round(gx / cell), iz = Math.round(gz / cell);
        const x = cx + gx + h01(ix, iz, 431 + ring) * cell * 0.9, z = cz + gz + h01(ix, iz, 433 + ring) * cell * 0.9;
        // stand density: a low-frequency field, so trees group
        const dens = vn2(x * 0.012, z * 0.012, 437) * 0.7 + vn2(x * 0.05, z * 0.05, 439) * 0.3;
        if (h01(ix, iz, 441 + ring) > 0.25 + dens * 0.75) continue;
        if (open(x, z, 2)) continue;
        const conifer = vn2(x * 0.007 + 5, z * 0.007, 443) > 0.62;
        const giant = h01(ix, iz, 445) < 0.07;
        const sc = giant ? 1.3 + h01(ix, iz, 447) * 0.28 : 0.8 + h01(ix, iz, 449) * 0.42;
        const t = tree(CH, g, x, z, sc, conifer, ctx);
        if (!ring) { bole(t, ctx, true); stands.push(t); }
        else W.belt++;
        paint(x, z, (conifer ? 3.6 : 8.4) * sc);
        if (feet && !ring) feet.push(x, t.y, z, (conifer ? 3 : 6) * sc, 0);
      }
    }
    // the understory: saplings where the canopy is open, thicket in clumps,
    // bracken on the floor
    for (let gx = -MAIN; gx < MAIN; gx += 6) for (let gz = -MAIN; gz < MAIN; gz += 6) {
      const ix = Math.round(gx / 6), iz = Math.round(gz / 6);
      const x = cx + gx + h01(ix, iz, 451) * 5.5, z = cz + gz + h01(ix, iz, 453) * 5.5;
      if (open(x, z, 0.5)) continue;
      const r = h01(ix, iz, 455), y = g(x, z);
      const yaw = h01(ix, iz, 457) * 6.28;
      const v = K.variantAt ? K.variantAt(x, z, "thicket") : 0;
      if (r < 0.07) {
        const s = 0.55 + h01(ix, iz, 459) * 0.5;
        CH.add("under", v, x, z, M4(x, y - 0.1, z, yaw, s, s, s), [0.2, 0.34, 0.12]);
        W.under++;
      } else if (r < 0.16 && vn2(x * 0.04, z * 0.04, 461) > 0.45) {
        const s = 0.45 + h01(ix, iz, 463) * 0.35;
        CH.add("thicket", v, x, z, M4(x, y - 0.15, z, yaw, s, s * 0.8, s), [0.13, 0.26, 0.09]);
        W.under++;
      }
      // bracken in drifts
      const fb = vn2(x * 0.03, z * 0.03, 465);
      if (fb > 0.5) {
        const nF = fb > 0.7 ? 3 : 1;
        for (let f = 0; f < nF; f++) {
          const fx = x + (h01(ix, iz, 467 + f) - 0.5) * 4, fz = z + (h01(ix, iz, 469 + f) - 0.5) * 4;
          if (open(fx, fz, 0)) continue;
          const s = 0.7 + h01(ix + f, iz, 471) * 0.6;
          const j = h01(ix, iz + f, 473);
          CH.add("fern", 0, fx, fz, M4(fx, g(fx, fz) - 0.05, fz, h01(ix, f, 475) * 6.28, s, s * (0.8 + j * 0.4), s),
            [0.36 + j * 0.12, 0.48 + j * 0.1, 0.2]);
          W.ferns++;
        }
      }
    }
    CH.build(geoOf, matOf, { name: "forest" });
    // the floor in shade where the crowns are: blur the cover a little and
    // hand it to the skin (ERG_CANOPY, read by the forest floor shader)
    const out = new Uint8Array(CN * CN * 4);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= CN || b >= CN) continue;
        s += cov[b * CN + a]; n++;
      }
      const k = (j * CN + i) * 4;
      out[k] = Math.min(255, Math.round(Math.min(1, s / n) * 255)); out[k + 3] = 255;
    }
    const tex = new THREE.DataTexture(out, CN, CN, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    if (typeof ERG_CANOPY !== "undefined") {
      if (!ERG_CANOPY) ERG_CANOPY = { tex: tex, rect: new THREE.Vector4() };
      ERG_CANOPY.tex = tex;
      ERG_CANOPY.rect.set(cx - CR - DUNE.cx, cz - CR - DUNE.cz, CR * 2, CR * 2);
    }
    if (feet && feet.length && CBZ.treeFoot) {
      try { CBZ.treeFoot.add(CBZ.scene, feet, { name: "npcwar-forest", heightAt: g }); } catch (e) { console.warn("[woods] treeFoot", e); }
    }
    // the deadfall: fallen trunks lie across the wood, more where it is old
    const D = CBZ.battleDress;
    let logs = 0;
    for (let k = 0; k < 520 && logs < 150; k++) {
      const x = cx + (h01(k, 1, 481) - 0.5) * MAIN * 2, z = cz + (h01(k, 2, 481) - 0.5) * MAIN * 2;
      if (open(x, z, 7)) continue;
      const L = 6 + h01(k, 3, 481) * 9, yaw = h01(k, 4, 481) * 6.28;
      // a log must not lie through a standing bole
      let clear = true;
      for (let i = 0; i < stands.length && clear; i++) {
        const t = stands[i];
        if (Math.abs(t.x - x) > L || Math.abs(t.z - z) > L) continue;
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        const rx = t.x - x, rz = t.z - z, along = rx * ax + rz * az, off = Math.abs(-rx * az + rz * ax);
        if (Math.abs(along) < L / 2 + 0.6 && off < 1.4) clear = false;
      }
      if (!clear) continue;
      D.place("log", x, z, yaw, { len: L, r: 0.24 + h01(k, 5, 481) * 0.22, root: h01(k, 6, 481) < 0.3 });
      logs++;
    }
    W.logs += logs;
    // mossy granite where the wood is on a rise
    for (let k = 0; k < 160; k++) {
      const x = cx + (h01(k, 7, 485) - 0.5) * MAIN * 2, z = cz + (h01(k, 8, 485) - 0.5) * MAIN * 2;
      if (open(x, z, 4) || vn2(x * 0.02, z * 0.02, 487) < 0.6) continue;
      D.place("boulder", x, z, h01(k, 9, 485) * 6.28, { size: 0.9 + h01(k, 10, 485) * 1.4 });
    }
    return { trees: W.trees, ride: rideZ };
  }

  /* ============================================================ SNOW */
  function snow(ctx) {
    const K = KIT();
    const g = ctx.groundAt, cx = ctx.cx, cz = ctx.cz;
    const D = CBZ.battleDress;
    const CH = K ? new Chunks(cx, cz, 520, 4) : null;
    const wx = DUNE.wx, wz = DUNE.wz;
    const blocked = function (x, z, pad) {
      for (let i = 0; i < ctx.keepOut.length; i++) {
        const k = ctx.keepOut[i];
        if (Math.abs(x - k.x) < k.hx + pad && Math.abs(z - k.z) < k.hz + pad) return true;
      }
      return false;
    };
    // spruce groves: on the flanks, behind each line, and two in the middle
    const groves = [];
    for (let k = 0; k < 14; k++) {
      const side = k < 4 ? -1 : k < 8 ? 1 : 0;
      const x = cx + (side ? side * (ctx.gap / 2 + 40 + h01(k, 1, 491) * 180) : (h01(k, 1, 491) - 0.5) * ctx.gap * 0.7);
      const z = cz + (h01(k, 2, 491) - 0.5) * (side ? 520 : 420);
      groves.push({ x: x, z: z, r: 14 + h01(k, 3, 491) * 22 });
    }
    if (CH) {
      groves.forEach(function (G, gi) {
        const n = Math.round(G.r * G.r * 0.035);
        for (let i = 0; i < n; i++) {
          const a = h01(gi, i, 493) * 6.28, d = Math.sqrt(h01(gi, i, 495)) * G.r;
          const x = G.x + Math.cos(a) * d, z = G.z + Math.sin(a) * d;
          if (blocked(x, z, 3)) continue;
          const sc = 0.5 + h01(gi, i, 497) * 0.6 * (1 - d / G.r * 0.4);
          const t = tree(CH, g, x, z, sc, true, ctx, { frost: true });
          bole(t, ctx, true);
        }
      });
      CH.build(geoOf, matOf, { name: "snow-spruce" });
    }
    // granite outcrops with drifts tailing downwind of every stone
    for (let k = 0; k < 90; k++) {
      const x = cx + (h01(k, 4, 499) - 0.5) * 700, z = cz + (h01(k, 5, 499) - 0.5) * 500;
      if (blocked(x, z, 4)) continue;
      const s = 0.9 + h01(k, 6, 499) * 1.8;
      // the stone is seated first, then the drift builds against its lee
      D.place("boulder", x, z, h01(k, 7, 499) * 6.28, { size: s });
      if (CBZ.battleGround) CBZ.battleGround.drift(x + wx * s * 0.5, z + wz * s * 0.5, wx, wz, s * 5, s * 1.1, s * 0.5);
    }
    return { groves: groves.length };
  }

  return {
    forest: forest, snow: snow,
    stats: function () { return Object.assign({}, W); },
  };
})();
