/* ============================================================
   world/vegetation.js — shared scenery-scale vegetation geometry.

   A TREE IS NOT A GREEN POLYHEDRON ON A BEIGE POLE. Until 2026-09-05 every
   crown in this game was three to five flat-shaded icosahedra and every
   trunk a smooth cylinder, and the owner's verdict from eye level in the
   backcountry was "fake af". This file now builds the thing every game
   builds when it wants a tree to read as a tree at the triangle budget of
   a low-poly blob:

     FOLIAGE = a cloud of LEAF CARDS. Each card is a small quad wearing a
       painted clump of leaves (alpha-tested, so no sorting and no
       transparency pass), placed inside the same lobe layout the old blobs
       used, so the silhouette is ragged the way a canopy is ragged. The
       LIGHTING NORMALS ARE NOT THE CARDS' OWN: every vertex takes the
       direction from the crown's centre through itself, blended toward
       up, so the mass shades like one soft sphere while its edge is a
       thousand leaf tips. Cards deeper in the crown carry a darker vertex
       colour (baked occlusion), which is what makes a crown look full
       rather than hollow. Every card is built with BOTH windings so it
       never disappears from behind; the material stays single-sided,
       which keeps r128's Lambert path from lighting the back of a card
       with the flipped normal.
     WOOD = a smooth-shaded bole wearing a painted bark map, with four
       limbs rising into the crown and four roots into the ground.
     SPRUCE = whorls of drooping needle-sprig cards around a bare axis,
       with a crossed leader at the tip.

   The textures are painted at load on a canvas from a seeded stream (no
   asset, no fetch, deterministic). Headless (no document) the kit still
   builds every geometry; the materials simply have no map, which is what
   the node test relies on.

   Everything is still authored in METRES, seated on y=0, boxed to the
   archetype's nominal radius and height (the CONNECTION LAW in
   world/treeaudit.js proves crown-over-trunk from those boxes), instanced
   through one material per kind and tinted per instance by instanceColor.
   Consumers did not have to change to get the new trees.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.SCENERY_VEGETATION == null) CFG.SCENERY_VEGETATION = true;
  // VEG_VARIANTS — see "NO TWO TREES ARE THE SAME MESH" below. Off → every
  // archetype has exactly one variant.
  if (CFG.VEG_VARIANTS == null) CFG.VEG_VARIANTS = true;
  // VEG_VARIANT_MAX — the ceiling on variants per archetype at full quality.
  // The live count is quality-scaled through CBZ.qScale (1 at tier 0), because
  // a variant costs one InstancedMesh per consumer that splits per instance.
  if (CFG.VEG_VARIANT_MAX == null) CFG.VEG_VARIANT_MAX = 3;

  const cache = Object.create(null);
  const mats = Object.create(null);
  const UP = new THREE.Vector3(0, 1, 0);
  const GOLDEN = 2.39996323;
  const LEAF_CUTOFF = 0.45;

  // Deterministic stream. Never Math.random: a crown that differed between
  // two clients would desync nothing but would make every screenshot
  // comparison a lie.
  function vrng(seed) {
    let s = (seed | 0) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ======================================================================
     THE PAINT — two canvas textures, painted once from a seeded stream.
     Both are painted BRIGHT and nearly grey-green so the per-instance
     instanceColor (forestlook.js's species/altitude/sun-face tints, the
     street planter palette, wildnature's bark) keeps owning the hue.
  ====================================================================== */
  function makeCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c.getContext && c.getContext("2d") ? c : null;
  }
  function finishTexture(cv, repeat) {
    const t = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;   // r128 spelling — pinned
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    const r = CBZ.renderer;
    if (r && r.capabilities && r.capabilities.getMaxAnisotropy) {
      t.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy() || 1);
    }
    t.needsUpdate = true;
    return t;
  }
  function rgb(l, r, g, b) {
    return "rgb(" + Math.round(255 * Math.min(1, l * r)) + "," + Math.round(255 * Math.min(1, l * g)) + "," +
      Math.round(255 * Math.min(1, l * b)) + ")";
  }

  // LEAF ATLAS — 2x2 tiles: [0] round-leaf clump, [1] pointed-leaf clump,
  // [2] and [3] spruce sprigs (twig base at the tile's bottom edge = v 0).
  //
  // THE FAR-MIP BODY. Alpha-tested cards thin out with distance: mipmaps
  // average leaf (alpha 1) with gap (alpha 0) and the average drops under
  // the cutoff, so a wood 400 m away becomes a scatter of specks. Each tile
  // therefore carries a body painted at alpha 0.40 — UNDER the 0.45 cutoff,
  // so up close it is discarded and the leaves stand alone — which lifts the
  // averaged alpha over the cutoff in the small mips. Near: leaves. Far: a
  // solid crown. That one number is the whole distance behaviour.
  function paintLeafAtlas() {
    const S = 256, cv = makeCanvas(S * 2, S * 2);
    if (!cv) return null;
    const ctx = cv.getContext("2d");
    const rnd = vrng(0x1eaf);
    ctx.lineCap = "round";

    function clump(ox, oy, pointed) {
      const cx = ox + S * 0.5, cy = oy + S * 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, S * 0.47, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(150,185,95,0.42)"; ctx.fill();
      // Many SMALL leaves, overlapping to a solid mass in the core and
      // thinning to a ragged rim: a card is a branch's worth of foliage, not
      // eight leaves the size of a door.
      const N = 620;
      for (let i = 0; i < N; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        if (rnd() < Math.pow(rr, 9)) continue;                    // ragged rim
        const rad = S * 0.49 * rr;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad * 0.96;
        // darker leaves first (they end up underneath), bright ones on top
        const L = 0.42 + 0.58 * Math.pow(i / N, 0.7) * (0.7 + rnd() * 0.3), warm = 0.70 + rnd() * 0.26;
        const len = S * (0.040 + rnd() * 0.034), wid = len * (pointed ? 0.42 : 0.66);
        ctx.save(); ctx.translate(x, y); ctx.rotate(rnd() * Math.PI * 2);
        ctx.fillStyle = rgb(L, warm, 1, 0.50);
        ctx.beginPath();
        if (pointed) {
          ctx.moveTo(0, -len / 2);
          ctx.quadraticCurveTo(wid * 0.55, 0, 0, len / 2);
          ctx.quadraticCurveTo(-wid * 0.55, 0, 0, -len / 2);
        } else ctx.ellipse(0, 0, wid / 2, len / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(20,40,10,0.30)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -len / 2 + 2); ctx.lineTo(0, len / 2 - 2); ctx.stroke();
        ctx.restore();
      }
    }

    // A BRANCH LAYER, not a single twig: a trapezoid of dense drooping
    // boughs, widest at the bottom edge (v 0). Stacked as crossed vertical
    // cards it prints the serrated cone a spruce is from the ground.
    function sprig(ox, oy) {
      const cx = ox + S * 0.5, yBase = oy + S * 0.97, yTip = oy + S * 0.03;
      const halfW = t => S * (0.49 - 0.30 * t);                   // t 0 bottom .. 1 top
      ctx.beginPath();
      ctx.moveTo(cx - halfW(0), yBase); ctx.lineTo(cx + halfW(0), yBase);
      ctx.lineTo(cx + halfW(1), yTip); ctx.lineTo(cx - halfW(1), yTip); ctx.closePath();
      ctx.fillStyle = "rgba(95,135,90,0.42)"; ctx.fill();
      ctx.strokeStyle = "rgb(118,96,72)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, yBase); ctx.lineTo(cx, yTip); ctx.stroke();
      const needle = (px, py, dirx, L) => {
        const nl = 8 + rnd() * 9;
        ctx.strokeStyle = rgb(L, 0.78, 1, 0.68); ctx.lineWidth = 3.2;
        for (let q = -1; q <= 1; q += 2) {
          const na = q * (0.7 + rnd() * 0.6) - 0.35;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px + dirx * Math.cos(na) * nl, py + Math.sin(na) * nl); ctx.stroke();
        }
      };
      const boughs = 13;
      for (let i = 0; i < boughs; i++) {
        const t = (i + 0.5) / boughs;
        const y = yBase + (yTip - yBase) * t;
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const len = halfW(t) * (0.86 + rnd() * 0.14);
          const droop = S * (0.06 + rnd() * 0.10);
          const ex = cx + sgn * len, ey = y + droop;
          ctx.strokeStyle = "rgb(112,92,68)"; ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.moveTo(cx, y - droop * 0.3); ctx.quadraticCurveTo(cx + sgn * len * 0.5, y - droop * 0.1, ex, ey); ctx.stroke();
          const nN = Math.max(6, (len / 3) | 0);
          for (let k = 0; k < nN; k++) {
            const u = (k + 0.5) / nN;
            const px = cx + sgn * len * u, py = y - droop * 0.3 + (ey - y + droop * 0.3) * u * u;
            needle(px, py, sgn, 0.42 + 0.58 * u * (0.7 + rnd() * 0.3));
          }
        }
      }
      // loose tufts fill the gaps between boughs
      for (let i = 0; i < 260; i++) {
        const t = rnd(), hw = halfW(t) * 0.95;
        const px = cx + (rnd() * 2 - 1) * hw, py = yBase + (yTip - yBase) * t;
        needle(px, py, px < cx ? -1 : 1, 0.45 + rnd() * 0.5);
      }
    }

    clump(0, 0, false);
    clump(S, 0, true);
    sprig(0, S);
    sprig(S, S);
    return finishTexture(cv, false);
  }

  // BARK — vertical grain, dark fissures, pale lenticel flecks. Tiles both
  // ways: every mark is drawn again one period over in x and y.
  function paintBark() {
    const W = 512, H = 1024, cv = makeCanvas(W, H);
    if (!cv) return null;
    const ctx = cv.getContext("2d");
    const rnd = vrng(0xba2c);
    ctx.fillStyle = "rgb(168,158,146)"; ctx.fillRect(0, 0, W, H);
    ctx.lineCap = "round";
    function tiled(fn) {
      for (let dx = -W; dx <= W; dx += W) for (let dy = -H; dy <= H; dy += H) fn(dx, dy);
    }
    for (let i = 0; i < 1100; i++) {
      const x = rnd() * W, w = 3 + rnd() * 14, y = rnd() * H, h = H * (0.10 + rnd() * 0.40);
      const L = 0.45 + rnd() * 0.72, j1 = (rnd() - 0.5) * 16, j2 = (rnd() - 0.5) * 16;
      ctx.fillStyle = "rgba(" + Math.round(255 * Math.min(1, L)) + "," + Math.round(255 * Math.min(1, L * 0.94)) + "," +
        Math.round(255 * Math.min(1, L * 0.86)) + ",0.55)";
      tiled(function (dx, dy) {
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + w + dx, y + dy);
        ctx.lineTo(x + w + j1 + dx, y + h + dy); ctx.lineTo(x + j2 + dx, y + h + dy);
        ctx.closePath(); ctx.fill();
      });
    }
    for (let i = 0; i < 110; i++) {
      const x0 = rnd() * W, y0 = rnd() * H, len = H * (0.20 + rnd() * 0.70), segs = 8;
      const wid = 2 + rnd() * 6, dark = 0.16 + rnd() * 0.14;
      const pts = [];
      let x = x0;
      for (let s = 0; s <= segs; s++) { pts.push([x, y0 + len * s / segs]); x += (rnd() - 0.5) * 34; }
      ctx.strokeStyle = "rgba(" + Math.round(255 * dark * 1.1) + "," + Math.round(255 * dark * 0.9) + "," +
        Math.round(255 * dark * 0.7) + ",0.78)";
      ctx.lineWidth = wid;
      tiled(function (dx, dy) {
        ctx.beginPath();
        for (let s = 0; s < pts.length; s++) {
          if (s) ctx.lineTo(pts[s][0] + dx, pts[s][1] + dy); else ctx.moveTo(pts[s][0] + dx, pts[s][1] + dy);
        }
        ctx.stroke();
      });
    }
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W, y = rnd() * H, len = 6 + rnd() * 20;
      ctx.strokeStyle = "rgba(236,230,218,0.55)"; ctx.lineWidth = 2 + rnd() * 2.5;
      tiled(function (dx, dy) {
        ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + len + dx, y + dy + (rnd() - 0.5) * 2); ctx.stroke();
      });
    }
    return finishTexture(cv, true);
  }

  const tex = { leaf: undefined, bark: undefined };
  function leafTexture() { if (tex.leaf === undefined) tex.leaf = paintLeafAtlas(); return tex.leaf; }
  function barkTexture() { if (tex.bark === undefined) tex.bark = paintBark(); return tex.bark; }

  /* ======================================================================
     GEOMETRY HELPERS
  ====================================================================== */
  function merged(parts, fallback) {
    const fn = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
    let out = null;
    if (fn) out = fn(parts, false);
    if (!out) out = fallback || parts[0];
    for (let i = 0; i < parts.length; i++) if (parts[i] !== out && parts[i].dispose) parts[i].dispose();
    return out;
  }

  // Bark repeats: `around` periods around the girth, one period per
  // `metres` of length. CylinderGeometry's v runs the length of the piece.
  function uvScale(g, around, metres, len) {
    const uv = g.attributes.uv;
    if (!uv) return g;
    const sv = Math.max(0.25, len / metres);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around, uv.getY(i) * sv);
    return g;
  }

  function cylinderBetween(a, b, r0, r1, sides, openEnded) {
    const av = new THREE.Vector3(a[0], a[1], a[2]);
    const bv = new THREE.Vector3(b[0], b[1], b[2]);
    const dir = bv.clone().sub(av), len = dir.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, sides || 5, 1, !!openEnded);
    uvScale(g, 1, 2.6, len);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    g.translate((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5);
    return g;
  }

  // A baked underside-to-crown ramp gives a mass depth even when thousands of
  // instances share one material. r128 multiplies vertex color by instanceColor.
  // `occ` (optional, per vertex) multiplies in a second darkening — the leaf
  // cards use it for depth inside the crown. Normals are NOT recomputed here:
  // cylinders arrive smooth and the cards carry authored lighting normals.
  function shadeByHeight(g, floor, power, occ) {
    g.computeBoundingBox();
    const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
      let v = floor + (1 - floor) * Math.pow(t, power || 0.72);
      if (occ) v *= occ[i];
      c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }

  /* ======================================================================
     WOOD — barked bole, limbs into the crown, roots into the ground.
  ====================================================================== */
  function bole(rTop, rBase, h, sides) {
    const g = new THREE.CylinderGeometry(rTop, rBase, h, sides, 1, true);
    uvScale(g, 3, 3.2, h);
    g.translate(0, h / 2, 0);
    return g;
  }

  function matureWood() {
    const parts = [bole(0.34, 0.82, 20, 9)];
    // Buttress roots, real metres so they stay broad when uniformly scaled.
    for (let i = 0; i < 5; i++) {
      const a = i * GOLDEN + 0.4, r = 2.2 + (i % 2) * 0.7;
      parts.push(cylinderBetween([0, 0.5, 0], [Math.cos(a) * r, 0.05, Math.sin(a) * r], 0.46, 0.09, 5, true));
    }
    // Crown-bearing limbs fork asymmetrically; collision stays on the bole.
    const limbs = [
      [[0, 11.8, 0], [3.9, 16.2, 1.2], 0.34, 0.11],
      [[0, 12.7, 0], [-3.2, 17.1, -1.8], 0.32, 0.11],
      [[0, 14.0, 0], [1.0, 18.8, -3.5], 0.28, 0.10],
      [[0, 14.8, 0], [-1.5, 19.4, 3.0], 0.27, 0.10],
      [[0, 13.2, 0], [4.6, 15.0, -2.6], 0.24, 0.09],
    ];
    for (let i = 0; i < limbs.length; i++) {
      const b = limbs[i]; parts.push(cylinderBetween(b[0], b[1], b[2], b[3], 6, true));
    }
    const g = shadeByHeight(merged(parts, parts[0]), 0.55, 0.8);
    g.name = "cbz-mature-tree-wood";
    g.userData.vegetationArchetype = "mature-wood";
    return g;
  }

  function landscapeWood() {
    // The country-wide bole: fewer sides, four limbs, four low roots. The
    // root footprint stays inside the 0.82 m seating samples.
    const parts = [bole(0.25, 0.76, 20, 7)];
    for (let i = 0; i < 4; i++) {
      const a = i * GOLDEN;
      parts.push(cylinderBetween([0, 0.28, 0], [Math.cos(a) * 0.76, -0.08, Math.sin(a) * 0.76], 0.37, 0.06, 5, true));
      parts.push(cylinderBetween([0, 11.5 + i * 1.2, 0],
        [Math.cos(a) * 3.8, 16.4 + i * 1.2, Math.sin(a) * 3.8], 0.27, 0.07, 5, true));
    }
    const g = shadeByHeight(merged(parts, parts[0]), 0.55, 0.82);
    g.name = "cbz-landscape-tree-wood";
    g.userData.vegetationArchetype = "landscape-wood";
    return g;
  }

  /* ======================================================================
     THE LEAF CARD SET — one non-indexed buffer of quads, each written in
     both windings, with authored lighting normals and atlas uvs.
  ====================================================================== */
  const ATLAS_INSET = 0.012;
  function CardSet() { this.pos = []; this.nrm = []; this.uv = []; this.occ = []; this.cards = 0; }
  CardSet.prototype.add = function (c, ax, ay, w, h, tile, flip, light, occ) {
    const P = [], N = [], T = [];
    const tu = (tile & 1) * 0.5, tv = tile < 2 ? 0.5 : 0;
    for (let k = 0; k < 4; k++) {
      const sx = (k === 1 || k === 2 ? 1 : -1) * w * 0.5, sy = (k >= 2 ? 1 : -1) * h * 0.5;
      const x = c.x + ax.x * sx + ay.x * sy, y = c.y + ax.y * sx + ay.y * sy, z = c.z + ax.z * sx + ay.z * sy;
      P.push([x, y, z]);
      // lighting normal: out from the crown's centre (or its axis) through
      // the vertex, leaned toward the sky
      let nx, ny, nz;
      if (light.axis) { nx = x / light.rx; ny = light.up; nz = z / light.rx; }
      else { nx = (x - light.x) / light.rx; ny = (y - light.y) / light.ry + light.up; nz = (z - light.z) / light.rx; }
      const nl = Math.hypot(nx, ny, nz) || 1;
      N.push([nx / nl, ny / nl, nz / nl]);
      let u = (k === 1 || k === 2) ? 1 : 0; if (flip) u = 1 - u;
      const v = k >= 2 ? 1 : 0;
      T.push([tu + ATLAS_INSET + u * (0.5 - 2 * ATLAS_INSET), tv + ATLAS_INSET + v * (0.5 - 2 * ATLAS_INSET)]);
    }
    const self = this;
    function tri(a, b, d) {
      for (const i of [a, b, d]) {
        self.pos.push(P[i][0], P[i][1], P[i][2]);
        self.nrm.push(N[i][0], N[i][1], N[i][2]);
        self.uv.push(T[i][0], T[i][1]);
        self.occ.push(occ);
      }
    }
    tri(0, 1, 2); tri(0, 2, 3);           // front
    tri(0, 2, 1); tri(0, 3, 2);           // back — same normal, same uv
    this.cards++;
  };
  CardSet.prototype.geometry = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.userData.occlusion = this.occ;
    g.userData.leafCards = this.cards;
    return g;
  };

  // an orthonormal (ax, ay) pair for a card whose plane normal is n
  function frame(n, roll) {
    const helper = Math.abs(n.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0);
    const ax = new THREE.Vector3().crossVectors(helper, n).normalize();
    const ay = new THREE.Vector3().crossVectors(n, ax).normalize();
    if (roll) { ax.applyAxisAngle(n, roll); ay.applyAxisAngle(n, roll); }
    return { ax: ax, ay: ay };
  }
  function randomUnit(rnd) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(Math.max(0, 1 - z * z));
    return new THREE.Vector3(Math.cos(a) * r, z, Math.sin(a) * r);
  }

  /* ======================================================================
     NO TWO TREES ARE THE SAME MESH — the variant set.

     One geometry per archetype would make every stand a crop: the eye finds
     the repeat long before it can name it. This renderer draws vegetation as
     InstancedMesh, so the affordable form is a small VARIANT SET: K
     structurally different crowns per archetype, dealt out by a POSITION
     hash, so a stand is a mix and a consumer pays K draw calls instead of
     one. K is quality-scaled and is 1 at tier 0.

     THE GRAMMAR. A crown is a core lobe over the trunk axis plus arms placed
     on a golden-angle spiral, their reach set by a CROWN ENVELOPE (the
     radius profile of the species as a function of height) and skewed by a
     per-variant LIGHT-COMPETITION bias so one flank carries the long arms,
     exactly as a tree that grew beside a gap does. Each lobe is then FILLED
     WITH LEAF CARDS rather than drawn as a polyhedron.

     TWO INVARIANTS, both load-bearing, both enforced by normalise():
       1. EVERY VARIANT SHARES THE ARCHETYPE'S BOUNDING BOX. Consumers scale
          a crown by (folR, folH, folR) and seat it at folY; the tree
          CONNECTION LAW (world/treeaudit.js) then proves the canopy AABB
          overlaps the trunk's.
       2. EVERY VARIANT COVERS ITS OWN AXIS. The core lobe is centred on
          (0, ·, 0), far wider than any bole this kit publishes.

     TRUNKS ARE DELIBERATELY NOT VARIED: `mature-wood` / `landscape-wood`
     size the BIOME_SOLID_TRUNKS collider from the geometry's own base radius
     (CBZ.treeGeoBounds).
  ====================================================================== */
  const VARIABLE = {
    "mature-crown":    { r: 9.3,  h: 12.8, n: 5, cards: 12, shape: "dome",      floor: 0.42, pow: 0.62, salt: 0x1a3 },
    "landscape-crown": { r: 8.1,  h: 11.4, n: 4, cards: 11, shape: "dome",      floor: 0.42, pow: 0.64, salt: 0x1a7 },
    subcanopy:         { r: 4.8,  h: 5.9,  n: 3, cards: 9,  shape: "ellipsoid", floor: 0.40, pow: 0.68, salt: 0x1ab },
    "canopy-patch":    { r: 7.8,  h: 5.6,  n: 4, cards: 9,  shape: "flat",      floor: 0.36, pow: 0.58, salt: 0x1af },
    thicket:           { r: 4.0,  h: 4.3,  n: 4, cards: 8,  shape: "irregular", floor: 0.34, pow: 0.75, salt: 0x1b3 },
    krummholz:         { r: 2.15, h: 1.24, n: 3, cards: 6,  shape: "flat",      floor: 0.36, pow: 0.80, salt: 0x1b7 },
    "conifer-spire":   { spire: true, r: 3.15, h: 23, floor: 0.52, pow: 0.7, salt: 0x1bb },
  };

  // CROWN ENVELOPE — radius as a fraction of the crown's widest, at height
  // fraction t (0 = crown base, 1 = crown top).
  function envelope(shape, t) {
    if (t < 0) t = 0; else if (t > 1) t = 1;
    switch (shape) {
      case "cone":      return 0.20 + 0.80 * Math.pow(1 - t, 0.9);
      case "ellipsoid": return Math.max(0.30, Math.sin(Math.PI * (0.10 + 0.86 * t)));
      case "column":    return 0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      case "flat":      return Math.max(0.34, Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.6))));
      case "irregular": return 0.34 + 0.66 * Math.abs(Math.sin(t * 9.7 + 1.3)) * (1 - t * 0.4);
      default:          return Math.max(0.32, Math.sqrt(Math.max(0, 1 - t * t * 0.92)));  // dome
    }
  }

  function cardDensity() {
    // tier 0 draws half the cards; the far-mip body keeps the crown solid
    const d = CBZ.qScale ? CBZ.qScale(0.5, 1) : 1;
    return d > 0 ? d : 1;
  }

  // The lobe layout: where the mass is. Returns [{x,y,z,rx,ry,rz}].
  function lobeLayout(spec, rnd) {
    const R = spec.r, H = spec.h;
    let n = spec.n + (rnd() < 0.42 ? 1 : 0) - (rnd() < 0.28 ? 1 : 0);
    if (n < 2) n = 2;
    const bias = rnd() * Math.PI * 2;
    const asym = 0.16 + rnd() * 0.30;
    const lobes = [];
    const coreT = 0.30 + rnd() * 0.14;
    const coreR = R * envelope(spec.shape, coreT) * (0.62 + rnd() * 0.12);
    lobes.push({ x: 0, y: H * coreT, z: 0, rx: coreR, ry: H * (0.30 + rnd() * 0.12), rz: coreR * (0.90 + rnd() * 0.18) });
    let az = rnd() * Math.PI * 2;
    for (let i = 1; i < n; i++) {
      az += GOLDEN + (rnd() - 0.5) * 0.9;
      const t = Math.min(0.94, Math.max(0.10, 0.20 + (i / n) * 0.66 + (rnd() - 0.5) * 0.14));
      const env = envelope(spec.shape, t);
      const k = 1 + asym * Math.cos(az - bias);
      const lr = R * env * (0.40 + rnd() * 0.18) * k;
      const off = Math.max(0, R * env * k - lr * 0.60);
      lobes.push({
        x: Math.cos(az) * off, y: H * t + (rnd() - 0.5) * H * 0.07, z: Math.sin(az) * off,
        rx: lr, ry: H * (0.22 + rnd() * 0.14), rz: lr * (0.84 + rnd() * 0.30),
      });
    }
    return lobes;
  }

  function broadleafCards(set, spec, rnd) {
    const R = spec.r, H = spec.h;
    const light = { x: 0, y: H * 0.50, z: 0, rx: R, ry: H * 0.55, up: 0.35 };
    const lobes = lobeLayout(spec, rnd);
    const per = Math.max(3, Math.round(spec.cards * cardDensity()));
    const tileBase = rnd() < 0.5 ? 0 : 1;
    for (let li = 0; li < lobes.length; li++) {
      const L = lobes[li];
      const mean = (L.rx + L.ry + L.rz) / 3;
      for (let i = 0; i < per; i++) {
        const dir = randomUnit(rnd);
        const rho = 0.20 + 0.70 * Math.sqrt(rnd());                 // surface-biased fill
        const c = new THREE.Vector3(L.x + dir.x * rho * L.rx, L.y + dir.y * rho * L.ry, L.z + dir.z * rho * L.rz);
        // plane: mostly random, leaning tangent so the rim reads as leaf tips
        const n = randomUnit(rnd).multiplyScalar(0.62).add(dir.clone().multiplyScalar(0.38)).normalize();
        const f = frame(n, rnd() * Math.PI * 2);
        const size = mean * (1.35 + rnd() * 0.65);                  // cards overlap: a mass, not a scatter
        // depth inside the whole crown → baked occlusion
        const gx = c.x / R, gy = (c.y - light.y) / light.ry, gz = c.z / R;
        const depth = Math.min(1, Math.hypot(gx, gy, gz));
        const occ = 0.52 + 0.48 * depth;
        set.add(c, f.ax, f.ay, size, size * (0.9 + rnd() * 0.2), (tileBase + (rnd() < 0.25 ? 1 : 0)) & 1, rnd() < 0.5, light, occ);
      }
    }
  }

  // THE SPRUCE — a cross-plane cone. Each level is three vertical
  // branch-layer cards crossed at 60° (the silhouette from the ground, dense
  // from every bearing) plus two flat cards (the mass from the air), levels
  // overlapping so the serrations of one hang over the next. A leader of
  // two crossed cards tops it.
  function spireCards(set, spec, rnd) {
    const R = spec.r, H = spec.h;
    const light = { axis: true, rx: R, up: 0.45 };
    const levels = Math.max(5, Math.round(8 * cardDensity()));
    const step = (H * 0.90) / levels;
    for (let li = 0; li < levels; li++) {
      const t = (li + 0.5) / levels;
      const yc = H * 0.05 + t * H * 0.90;
      const rad = R * (0.16 + 0.84 * Math.pow(1 - t, 0.8)) * (0.92 + rnd() * 0.16);
      const a0 = rnd() * Math.PI;
      const occ = 0.80 + 0.20 * t;
      for (let k = 0; k < 3; k++) {
        const a = a0 + k * Math.PI / 3;
        const ax = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        set.add(new THREE.Vector3(0, yc, 0), ax, UP, rad * 2.1, step * 1.8, 2 + (k & 1), rnd() < 0.5, light, occ);
      }
      for (let k = 0; k < 2; k++) {
        const a = a0 + rnd() * Math.PI;
        const ax = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const ay = new THREE.Vector3(-Math.sin(a), -0.18, Math.cos(a)).normalize();
        set.add(new THREE.Vector3(0, yc - step * 0.25, 0), ax, ay, rad * 2, rad * 2, 2 + k, false, light, occ * 0.9);
      }
    }
    const tipH = H * 0.12;
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI / 2 + 0.3;
      set.add(new THREE.Vector3(0, H - tipH * 0.5, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), UP, R * 0.5, tipH, 2 + k, false, light, 1);
    }
  }

  // THE CROWN. Layout → cards → boxed and seated → shaded.
  function cardCrown(spec, seed) {
    const rnd = vrng(seed);
    const set = new CardSet();
    if (spec.spire) spireCards(set, spec, rnd); else broadleafCards(set, spec, rnd);
    return normalise(set.geometry(), spec);
  }

  // INVARIANT 1 — seat the crown on y=0 and squeeze it into the archetype's
  // nominal box. Uniform in x/z (an anisotropic squeeze would print an
  // ellipse from above); y independently.
  function normalise(g, spec) {
    g.computeBoundingBox();
    let bb = g.boundingBox;
    const rx = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
    const rz = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
    const rad = Math.max(1e-4, Math.max(rx, rz));
    const hgt = Math.max(1e-4, bb.max.y - bb.min.y);
    g.scale(spec.r / rad, spec.h / hgt, spec.r / rad);
    g.computeBoundingBox(); bb = g.boundingBox;
    g.translate(0, -bb.min.y, 0);
    const occ = g.userData.occlusion;
    delete g.userData.occlusion;
    return shadeByHeight(g, spec.floor, spec.pow, occ);
  }

  // ---- the public variant surface ---------------------------------------
  const counts = Object.create(null);
  function variantCount(kind) {
    if (counts[kind] != null) return counts[kind];
    let k = 1;
    if (CFG.VEG_VARIANTS !== false && VARIABLE[kind]) {
      const hi = Math.max(1, CFG.VEG_VARIANT_MAX | 0);
      k = CBZ.qScale ? Math.round(CBZ.qScale(1, hi)) : hi;
      if (k < 1) k = 1; else if (k > hi) k = hi;
    }
    counts[kind] = k;
    return k;
  }

  // WHICH variant stands here. A pure position hash, so it consumes nothing
  // from any caller's sequential rng stream and two biomes meeting at a
  // border agree about the tree on the seam.
  function variantAt(x, z, kind) {
    const k = variantCount(kind);
    if (k <= 1) return 0;
    const spec = VARIABLE[kind];
    const h = CBZ.hash01 ? CBZ.hash01(x, z, (spec && spec.salt) || 0x1c1) : 0.5;
    const v = Math.floor(h * k);
    return v < 0 ? 0 : (v >= k ? k - 1 : v);
  }

  const usage = Object.create(null);   // site → kind → Set(variant) + count
  function noteUse(site, kind, variant, count) {
    if (!site) return;
    const bySite = usage[site] || (usage[site] = Object.create(null));
    const rec = bySite[kind] || (bySite[kind] = { used: Object.create(null), n: 0 });
    rec.used[variant | 0] = true;
    rec.n += count == null ? 1 : count;
  }

  const builders = { "mature-wood": matureWood, "landscape-wood": landscapeWood };

  function geometry(kind, variant) {
    let v = variant == null ? 0 : (variant | 0);
    const spec = VARIABLE[kind];
    if (!spec) {
      if (!cache[kind]) {
        const fn = builders[kind];
        if (!fn) throw new Error("unknown vegetation archetype: " + kind);
        cache[kind] = fn();
      }
      return cache[kind];
    }
    if (v < 0 || v >= variantCount(kind)) v = 0;
    const key = kind + "#" + v;
    if (!cache[key]) {
      // salt by BOTH archetype and index: two archetypes must never grow the
      // same variant geometry under a different name.
      const seed = (spec.salt * 2654435761 + v * 0x9e3779b1) | 0;
      const g = cardCrown(spec, seed);
      g.name = "cbz-" + kind + "-v" + v;
      g.userData.vegetationArchetype = kind;
      g.userData.vegetationVariant = v;
      cache[key] = g;
    }
    return cache[key];
  }

  // A one-off crown for a caller with its own metres (the street planter,
  // wildnature's far species, the island grove) — the ONE TREE GRAMMAR's
  // treeCrownGeo routes here with leaf:true. Cached by its numbers.
  function customCrown(o) {
    const spire = !!o.spire;
    const key = "custom#" + (spire ? "s" : "b") + "#" + o.r + "#" + o.h + "#" + (o.n || 0) + "#" + (o.cards || 0) + "#" + (o.seed | 0);
    if (cache[key]) return cache[key];
    const spec = {
      spire: spire, r: o.r, h: o.h, n: o.n || 3, cards: o.cards || 9, shape: o.shape || "dome",
      floor: o.floor == null ? 0.42 : o.floor, pow: o.pow == null ? 0.66 : o.pow,
    };
    const g = cardCrown(spec, (o.seed | 0) ^ 0x5eed);
    g.name = "cbz-custom-crown";
    g.userData.vegetationArchetype = spire ? "conifer-spire" : "custom-crown";
    cache[key] = g;
    return g;
  }

  /* THE RATCHET. `cloned` counts SITES that drew a real stand out of a single
     variant while the kit was offering more than one. It may only go down. */
  const CLONE_MIN = 40;
  function variantAudit() {
    const out = {
      enabled: CFG.VEG_VARIANTS !== false,
      tier: CBZ.qualityLevel == null ? 4 : CBZ.qualityLevel,
      archetypes: 0, variants: 0, sites: 0, instances: 0, cloned: 0, clonedSites: [], byKind: {},
    };
    for (const kind in VARIABLE) {
      out.archetypes++;
      out.byKind[kind] = variantCount(kind);
      out.variants += variantCount(kind);
    }
    for (const site in usage) {
      out.sites++;
      for (const kind in usage[site]) {
        const rec = usage[site][kind];
        out.instances += rec.n;
        let used = 0;
        for (const k in rec.used) if (rec.used[k]) used++;
        if (rec.n >= CLONE_MIN && variantCount(kind) > 1 && used < 2) {
          out.cloned++;
          out.clonedSites.push(site + ":" + kind + " (" + rec.n + " from 1 of " + variantCount(kind) + ")");
        }
      }
    }
    return out;
  }

  /* ======================================================================
     MATERIALS — one per kind (and per tint for callers that colour by
     material rather than by instance). Smooth-shaded: the crown's lighting
     lives in its authored normals, the bole's in its cylinder normals.
  ====================================================================== */
  function isWood(kind) { return /wood$/.test(kind); }
  function material(kind, color) {
    const wood = isWood(kind);
    const key = (wood ? "wood" : "foliage") + (color == null ? "" : "#" + color);
    if (mats[key]) return mats[key];
    const opts = { color: color == null ? 0xffffff : color, vertexColors: true };
    const map = wood ? barkTexture() : leafTexture();
    if (map) opts.map = map;
    if (!wood && map) { opts.alphaTest = LEAF_CUTOFF; opts.side = THREE.FrontSide; }
    const m = new THREE.MeshLambertMaterial(opts);
    m.name = "CBZ vegetation " + key; m._shared = true;
    mats[key] = m;
    return m;
  }
  // Shadow caster for leaf cards: without this the shadow pass draws every
  // card as a solid rectangle.
  function depthMaterial(kind) {
    if (isWood(kind)) return null;
    if (mats.depth !== undefined) return mats.depth;
    const map = leafTexture();
    mats.depth = map ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: map, alphaTest: LEAF_CUTOFF }) : null;
    if (mats.depth) mats.depth._shared = true;
    return mats.depth;
  }

  // Small shared assembly seam. Ecology owners provide placement and colour;
  // this owns the repetitive InstancedMesh wiring and publishes the layer so
  // browser QA can inspect scale/count without scraping anonymous scene nodes.
  const layers = (CBZ.vegetationLayers = CBZ.vegetationLayers || []);
  function instanceLayer(root, spec, items) {
    spec = spec || {}; items = items || [];
    if (!root || !items.length) return null;
    const kind = spec.kind || "canopy-patch";
    const mesh = new THREE.InstancedMesh(spec.geometry || geometry(kind), spec.material || material(kind), items.length);
    mesh.name = spec.name || ("vegetation-" + kind);
    mesh.castShadow = !!spec.castShadow;
    if (mesh.castShadow) { const dm = depthMaterial(kind); if (dm) mesh.customDepthMaterial = dm; }
    mesh.receiveShadow = spec.receiveShadow !== false;
    mesh.frustumCulled = spec.frustumCulled === true;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    const colors = new Float32Array(items.length * 3);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (spec.transform) spec.transform(dummy, it, i);
      else {
        dummy.position.set(it.x || 0, it.y || 0, it.z || 0);
        dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        dummy.scale.set(it.sx == null ? (it.s == null ? 1 : it.s) : it.sx,
          it.sy == null ? (it.s == null ? 1 : it.s) : it.sy,
          it.sz == null ? (it.s == null ? 1 : it.s) : it.sz);
      }
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (spec.color) spec.color(color, it, i);
      else if (it.color != null) color.set(it.color);
      else color.set(0xffffff);
      colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData.vegetationLayer = kind;
    mesh.userData.sceneryScale = true;
    mesh.userData.instanceCount = items.length;
    if (spec.owner) mesh.userData.vegetationOwner = spec.owner;
    root.add(mesh);
    layers.push(mesh);
    return mesh;
  }

  CBZ.vegetationKit = {
    geometry: geometry,
    customCrown: customCrown,
    material: material,
    depthMaterial: depthMaterial,
    leafTexture: leafTexture,
    barkTexture: barkTexture,
    instanceLayer: instanceLayer,
    variantCount: variantCount,
    variantAt: variantAt,
    noteUse: noteUse,
    nominal: {
      matureWoodHeight: 20,
      matureCrownBase: 13,
      matureCrownHeight: 14,
      matureCrownRadius: 8.9,
      subcanopyHeight: 7,
      canopyPatchRadius: 7.8,
      thicketHeight: 4.3,
      spireHeight: 23,
      spireRadius: 3.15,
      krummholzHeight: 1.2,
    },
  };
  CBZ.vegetationInstanceLayer = instanceLayer;
  CBZ.vegetationVariantAudit = variantAudit;
})();
