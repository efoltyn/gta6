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
    // painted once (seeded): the canvas goes back once the texture is on the
    // GPU (core/texfree.js), not 30 s later; the leaf atlas and the bark were
    // 3 MB of canvases on the phone boot's peak
    if (CBZ.freeCanvasAfterUpload) CBZ.freeCanvasAfterUpload(t);
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

    // A LEAF SPRAY — what a broadleaf card really is: one twig, its
    // branchlets, and the leaves they carry, seen against the light. The
    // twig enters at a tile edge (the card's attachment to its bough), the
    // branchlets fan out, and leaves cluster thickest toward the tips the
    // way new growth does. Leaves are shaded across their width (one half
    // catches the sky, the other is in the leaf's own shade) with a pale
    // midrib, and the hue wanders between yellow-green and blue-green. The
    // ragged outline is the twig structure itself, not a noise rim on a
    // disc; the alpha-0.42 body underneath (under the cutoff) only exists
    // to keep the far mips solid.
    function clump(ox, oy, pointed) {
      const cx = ox + S * 0.5, cy = oy + S * 0.5;
      ctx.save();
      ctx.beginPath(); ctx.rect(ox + 2, oy + 2, S - 4, S - 4); ctx.clip();
      const twigs = [];                       // [x0,y0,x1,y1,width]
      const leaves = [];                      // [x,y,angle,len,L,warm]
      // the stem: in from the bottom edge, bending across the tile
      const bend = (rnd() - 0.5) * S * 0.25;
      const stem = function (t) { return [cx + bend * Math.sin(t * Math.PI * 0.9) * (1 - t * 0.3), oy + S * (0.98 - 0.80 * t)]; };
      for (let i = 0; i < 8; i++) { const a = stem(i / 8), b = stem((i + 1) / 8); twigs.push([a[0], a[1], b[0], b[1], 5.5 - i * 0.55]); }
      const nB = 7;
      for (let i = 0; i < nB; i++) {
        const t = 0.18 + 0.72 * (i / (nB - 1)) + (rnd() - 0.5) * 0.05;
        const p = stem(t), side = i & 1 ? 1 : -1;
        const ang = -Math.PI / 2 + side * (0.55 + rnd() * 0.45);   // up and out
        const len = S * (0.20 + 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * (0.8 + rnd() * 0.35);
        let x = p[0], y = p[1], a = ang;
        const seg = 5;
        for (let k = 0; k < seg; k++) {
          const nx = x + Math.cos(a) * len / seg, ny = y + Math.sin(a) * len / seg;
          twigs.push([x, y, nx, ny, 3.2 - k * 0.5]);
          // a leaf every step, alternate sides, bigger toward the tip
          for (let q = 0; q < 2; q++) {
            const la = a + (q ? 1 : -1) * (0.7 + rnd() * 0.5);
            leaves.push([nx, ny, la, S * (0.050 + 0.020 * (k / seg) + rnd() * 0.022), 0.5 + 0.5 * rnd(), 0.70 + rnd() * 0.28]);
          }
          x = nx; y = ny; a += (rnd() - 0.5) * 0.35 - side * 0.05;
        }
        leaves.push([x, y, a, S * (0.075 + rnd() * 0.02), 0.6 + 0.4 * rnd(), 0.72 + rnd() * 0.26]);   // terminal leaf
      }
      const tipP = stem(1);
      leaves.push([tipP[0], tipP[1], -Math.PI / 2, S * 0.08, 0.9, 0.8]);
      // inner fill leaves so the spray is a mass, not a skeleton
      for (let i = 0; i < 150; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * S * 0.36;
        leaves.push([cx + Math.cos(a) * rr, cy - S * 0.04 + Math.sin(a) * rr, rnd() * Math.PI * 2, S * (0.045 + rnd() * 0.03), 0.25 + 0.5 * rnd(), 0.70 + rnd() * 0.26]);
      }
      // THE FAR-MIP BODY follows the spray (fat strokes along every twig,
      // painted opaque on a scratch canvas and laid down at ONE alpha under
      // the cutoff), so a distant card keeps the spray's outline, not a disc
      const body = makeCanvas(S, S);
      if (body) {
        const b = body.getContext("2d");
        b.lineCap = "round"; b.strokeStyle = "rgb(140,175,92)"; b.fillStyle = "rgb(140,175,92)";
        for (const w of twigs) { b.lineWidth = S * 0.13; b.beginPath(); b.moveTo(w[0] - ox, w[1] - oy); b.lineTo(w[2] - ox, w[3] - oy); b.stroke(); }
        b.beginPath(); b.arc(cx - ox, cy - oy - S * 0.04, S * 0.26, 0, Math.PI * 2); b.fill();
        ctx.globalAlpha = 0.42; ctx.drawImage(body, ox, oy); ctx.globalAlpha = 1;
      }
      // dark (deep) leaves first, bright ones on top
      leaves.sort(function (p, q) { return p[4] - q[4]; });
      ctx.lineCap = "round";
      for (const w of twigs) {
        ctx.strokeStyle = "rgb(96,82,66)"; ctx.lineWidth = Math.max(1.2, w[4]);
        ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke();
      }
      for (const lf of leaves) {
        const len = lf[3], wid = len * (pointed ? 0.40 : 0.62), L = 0.40 + 0.60 * lf[4], warm = lf[5];
        ctx.save(); ctx.translate(lf[0], lf[1]); ctx.rotate(lf[2] + Math.PI / 2);
        // the petiole, then the blade hanging off it
        ctx.strokeStyle = "rgb(90,100,60)"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.18); ctx.stroke();
        ctx.translate(0, -len * 0.18 - len / 2);
        const gr = ctx.createLinearGradient(-wid / 2, 0, wid / 2, 0);
        gr.addColorStop(0, rgb(L * 1.08, warm, 1, 0.52));
        gr.addColorStop(0.5, rgb(L, warm, 1, 0.50));
        gr.addColorStop(0.52, rgb(L * 0.80, warm * 0.96, 1, 0.52));
        gr.addColorStop(1, rgb(L * 0.70, warm * 0.94, 1, 0.56));
        ctx.fillStyle = gr;
        ctx.beginPath();
        if (pointed) {
          ctx.moveTo(0, -len / 2);
          ctx.quadraticCurveTo(wid * 0.62, -len * 0.05, 0, len / 2);
          ctx.quadraticCurveTo(-wid * 0.62, -len * 0.05, 0, -len / 2);
        } else {
          ctx.moveTo(0, -len / 2);
          ctx.bezierCurveTo(wid * 0.62, -len * 0.40, wid * 0.58, len * 0.30, 0, len / 2);
          ctx.bezierCurveTo(-wid * 0.58, len * 0.30, -wid * 0.62, -len * 0.40, 0, -len / 2);
        }
        ctx.fill();
        ctx.strokeStyle = "rgba(225,240,180,0.35)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, len / 2 - 1); ctx.lineTo(0, -len / 2 + 2); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }

    // A SPRUCE BOUGH, seen from above or below: the bough's twig runs down
    // the tile from the trunk end (top edge, v 1) to its tip (bottom edge,
    // v 0); side shoots leave it at ~45 degrees pointing tipward, longest
    // in the middle (the spade outline a spruce bough has), and every shoot
    // is a bottle-brush of short needles, dark on the old wood and paler
    // at the new-growth tips. No straight-edged body: the outline is the
    // shoots themselves. The far-mip body follows the shoots, laid at one
    // alpha under the cutoff, as for the broadleaf sprays.
    function sprig(ox, oy) {
      ctx.save();
      ctx.beginPath(); ctx.rect(ox + 2, oy + 2, S - 4, S - 4); ctx.clip();
      const cx = ox + S * 0.5, yTop = oy + S * 0.02, yEnd = oy + S * 0.96;
      const shoots = [];                                  // [x0,y0,x1,y1,depth]
      const sway = (rnd() - 0.5) * S * 0.08;
      const main = function (t) { return [cx + sway * Math.sin(t * Math.PI), yTop + (yEnd - yTop) * t]; };
      for (let i = 0; i < 10; i++) { const a = main(i / 10), b = main((i + 1) / 10); shoots.push([a[0], a[1], b[0], b[1], 0]); }
      const nS = 11;
      for (let i = 0; i < nS; i++) {
        const t = 0.08 + 0.86 * (i / (nS - 1));
        const len = S * (0.12 + 0.30 * Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.08))) * (0.85 + rnd() * 0.3);
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const p = main(t), ang = Math.PI / 2 - sgn * (0.75 + rnd() * 0.3);   // out and tipward
          const ex = p[0] + Math.cos(ang) * len, ey = p[1] + Math.sin(ang) * len;
          shoots.push([p[0], p[1], ex, ey, 1]);
          // a secondary shoot or two off the outer half
          if (len > S * 0.2) {
            const u = 0.5 + rnd() * 0.2, qx = p[0] + (ex - p[0]) * u, qy = p[1] + (ey - p[1]) * u;
            const a2 = ang + sgn * 0.6, l2 = len * 0.35;
            shoots.push([qx, qy, qx + Math.cos(a2) * l2, qy + Math.sin(a2) * l2, 2]);
          }
        }
      }
      const body = makeCanvas(S, S);
      if (body) {
        const b = body.getContext("2d");
        b.lineCap = "round"; b.strokeStyle = "rgb(80,120,80)"; b.lineWidth = S * 0.045;
        for (const w of shoots) { b.beginPath(); b.moveTo(w[0] - ox, w[1] - oy); b.lineTo(w[2] - ox, w[3] - oy); b.stroke(); }
        ctx.globalAlpha = 0.42; ctx.drawImage(body, ox, oy); ctx.globalAlpha = 1;
      }
      ctx.lineCap = "round";
      for (const w of shoots) {
        ctx.strokeStyle = "rgb(104,84,62)"; ctx.lineWidth = w[4] === 0 ? 3.4 : (w[4] === 1 ? 2.0 : 1.4);
        ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); ctx.stroke();
      }
      // needles: a brush along every shoot, both sides, angled forward
      for (const w of shoots) {
        const dx = w[2] - w[0], dy = w[3] - w[1], L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L, px = -uy, py = ux;
        const n = Math.max(4, (L / 2.6) | 0);
        for (let k = 0; k < n; k++) {
          const u = (k + rnd() * 0.6) / n;
          const x = w[0] + dx * u, y = w[1] + dy * u;
          const nl = S * (0.030 + rnd() * 0.016);
          const Lc = (0.38 + 0.40 * u + rnd() * 0.18) * (w[4] === 0 ? 0.8 : 1);
          ctx.strokeStyle = rgb(Lc, 0.70, 1, 0.70); ctx.lineWidth = 2.2;
          for (let q = -1; q <= 1; q += 2) {
            const fx = ux * 0.55 + px * q * 0.85, fy = uy * 0.55 + py * q * 0.85;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + fx * nl, y + fy * nl); ctx.stroke();
          }
        }
        // the pale new growth at the shoot's tip
        ctx.strokeStyle = rgb(0.95, 0.80, 1, 0.62); ctx.lineWidth = 2.4;
        for (let q = -1; q <= 1; q += 2) {
          ctx.beginPath(); ctx.moveTo(w[2], w[3]);
          ctx.lineTo(w[2] + (ux * 0.8 + px * q * 0.5) * S * 0.03, w[3] + (uy * 0.8 + py * q * 0.5) * S * 0.03); ctx.stroke();
        }
      }
      ctx.restore();
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
  // `tint` (optional, rgb per vertex) is the leaf cards' per-card hue: a
  // canopy is never one green — sunlit outer sprays run yellow-warm, deep
  // ones blue-cool, and every spray differs a little from its neighbour.
  function shadeByHeight(g, floor, power, occ, tint) {
    g.computeBoundingBox();
    const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
      let v = floor + (1 - floor) * Math.pow(t, power || 0.72);
      if (occ) v *= occ[i];
      if (tint) { c[i * 3] = v * tint[i * 3]; c[i * 3 + 1] = v * tint[i * 3 + 1]; c[i * 3 + 2] = v * tint[i * 3 + 2]; }
      else { c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v; }
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

  /* A LIMB IS A CURVE, NOT A STICK. tube() sweeps a ring along a polyline
     with a parallel-transported frame, so a bent bough is ONE continuous
     skin (no gaps or kinks at the joints a chain of cylinders shows) with
     the bark running along it. Indexed like CylinderGeometry so it merges
     with the roots. */
  const _tA = new THREE.Vector3(), _tB = new THREE.Vector3(), _tC = new THREE.Vector3();
  function tube(pts, radii, sides, around, metres) {
    const rings = pts.length, row = sides + 1;
    const pos = new Float32Array(rings * row * 3), nrm = new Float32Array(rings * row * 3), uv = new Float32Array(rings * row * 2);
    const idx = [];
    let n = null, vAcc = 0;
    for (let i = 0; i < rings; i++) {
      const t = new THREE.Vector3();
      if (i < rings - 1) t.add(_tA.copy(pts[i + 1]).sub(pts[i]).normalize());
      if (i > 0) t.add(_tA.copy(pts[i]).sub(pts[i - 1]).normalize());
      t.normalize();
      if (!n) n = new THREE.Vector3().crossVectors(t, Math.abs(t.y) < 0.9 ? UP : _tC.set(1, 0, 0)).normalize();
      else n.sub(_tB.copy(t).multiplyScalar(n.dot(t))).normalize();
      const bx = new THREE.Vector3().crossVectors(t, n);
      if (i > 0) vAcc += pts[i].distanceTo(pts[i - 1]);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const dx = n.x * ca + bx.x * sa, dy = n.y * ca + bx.y * sa, dz = n.z * ca + bx.z * sa;
        const k = i * row + s;
        pos[k * 3] = pts[i].x + dx * radii[i]; pos[k * 3 + 1] = pts[i].y + dy * radii[i]; pos[k * 3 + 2] = pts[i].z + dz * radii[i];
        nrm[k * 3] = dx; nrm[k * 3 + 1] = dy; nrm[k * 3 + 2] = dz;
        uv[k * 2] = (s / sides) * around; uv[k * 2 + 1] = vAcc / metres;
        if (i < rings - 1 && s < sides) {
          const p0 = k, p1 = k + row;
          idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // quadratic bezier sampled at `n` + 1 points
  function arc(p0, p1, p2, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push(new THREE.Vector3(
        u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
        u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z));
    }
    return out;
  }

  /* THE BROADLEAF SKELETON. A real deciduous tree reads by its structure
     long before its leaves: a bole that flares at the foot, leans and
     tapers into a leader; scaffold limbs leaving it at 35-60 degrees and
     bending UP toward the light; each limb forking into secondary boughs
     that end inside the crown's clumps. The crown cards are alpha-tested
     with gaps, so this skeleton is what shows through them and below them.
     CONTRACTS KEPT: the bole's radius AT y = 0 is exactly rBase (the
     BIOME_SOLID_TRUNKS colliders are typed as 0.82 / 0.76 m), the height
     tops out at H (= 20 m nominal), roots end below y = 0, and the trunk is
     not varied per instance (one geometry per archetype). */
  function skeleton(o, mid) {
    const rnd = vrng(o.seed);
    const H = o.h, rB = o.rBase;
    const parts = [];
    // ---- the bole: flare, taper, a gentle sweep, a thin leader
    const ys = mid ? [0, 1.2, 6, 12, 17, H] : [0, 0.45, 1.3, 3.2, 6.5, 10, 13.5, 16.5, 18.6, H];
    const swayA = rnd() * Math.PI * 2, sway = o.sway;
    const boleAt = function (y) {
      const t = y / H;
      const off = sway * Math.sin(t * Math.PI * 0.9) + sway * 0.35 * Math.sin(t * Math.PI * 2.6 + 0.8);
      return new THREE.Vector3(Math.cos(swayA) * off, y, Math.sin(swayA) * off);
    };
    const boleR = function (y) {
      const t = y / H;
      const taper = o.rTop + (o.rMid - o.rTop) * Math.pow(1 - t, 1.25);
      const flare = (rB - o.rMid) * Math.exp(-y / 0.9);
      return taper + flare;
    };
    const bp = [], br = [];
    for (let i = 0; i < ys.length; i++) { bp.push(boleAt(ys[i])); br.push(boleR(ys[i])); }
    br[0] = rB;                               // the collider's radius, exactly
    parts.push(tube(bp, br, mid ? o.sides - 2 : o.sides, 3, 3.2));
    // ---- roots: buttress spurs into the ground
    for (let i = 0; i < (mid ? 0 : o.roots); i++) {
      const a = i * GOLDEN + 0.4 + (rnd() - 0.5) * 0.4, r = o.rootReach * (0.8 + rnd() * 0.45);
      parts.push(cylinderBetween([0, 0.5 + rnd() * 0.3, 0], [Math.cos(a) * r, -0.12, Math.sin(a) * r], rB * 0.55, 0.07, 5, true));
    }
    // ---- scaffold limbs + secondary boughs
    const N = o.limbs;
    let az = rnd() * Math.PI * 2;
    const limbSides = mid ? 3 : 6, twigSides = 4, rings = mid ? 2 : 4;
    for (let i = 0; i < N; i++) {
      az += GOLDEN + (rnd() - 0.5) * 0.5;
      const t = i / Math.max(1, N - 1);
      const y0 = o.limbLo + (o.limbHi - o.limbLo) * t + (rnd() - 0.5) * 0.6;
      const base = boleAt(y0);
      const reach = o.reach * (1 - 0.35 * t) * (0.85 + rnd() * 0.3);
      const rise = o.rise * (0.75 + 0.5 * t) * (0.85 + rnd() * 0.3);
      const dx = Math.cos(az), dz = Math.sin(az);
      const tip = new THREE.Vector3(base.x + dx * reach, y0 + rise, base.z + dz * reach);
      // the control point keeps the limb low and outward first, then turns
      // it up: the elbow every hardwood bough has
      const ctl = new THREE.Vector3(base.x + dx * reach * 0.62, y0 + rise * 0.25, base.z + dz * reach * 0.62);
      const pts = arc(base, ctl, tip, rings);
      const r0 = Math.min(boleR(y0) * 0.72, o.limbR * (1 - 0.3 * t));
      const radii = pts.map(function (_, k) { return r0 * (1 - 0.72 * (k / rings)); });
      parts.push(tube(pts, radii, limbSides, 1, 2.6));
      if (mid) continue;
      // two (sometimes three) boughs fork off the outer half of the limb
      const forks = 2 + (rnd() < 0.35 ? 1 : 0);
      for (let f = 0; f < forks; f++) {
        const u = 0.45 + 0.4 * (f / forks) + rnd() * 0.08;
        const k = Math.min(rings - 1, Math.floor(u * rings));
        const from = pts[k].clone().lerp(pts[k + 1], u * rings - k);
        const side = (f & 1 ? 1 : -1) * (0.55 + rnd() * 0.5);
        const baz = az + side;
        const len = reach * (0.42 + rnd() * 0.22);
        const to = new THREE.Vector3(from.x + Math.cos(baz) * len, from.y + len * (0.30 + rnd() * 0.30), from.z + Math.sin(baz) * len);
        const mid2 = from.clone().lerp(to, 0.5); mid2.y -= len * 0.12;
        const rr = r0 * (1 - 0.72 * u) * 0.75;
        parts.push(tube([from, mid2, to], [rr, rr * 0.6, 0.025], twigSides, 1, 2.0));
      }
    }
    // the leader carries on above the scaffold into the crown top
    const g = shadeByHeight(merged(parts, parts[0]), o.floor, o.pow);
    return g;
  }

  function matureWood(mid) {
    const g = skeleton({
      seed: 0x3a7e, h: 20, rBase: 0.82, rMid: 0.62, rTop: 0.08, sway: 0.38, sides: 10,
      roots: 5, rootReach: 2.5, limbs: 6, limbLo: 9.6, limbHi: 14.2, reach: 5.0, rise: 3.4, limbR: 0.38,
      floor: 0.55, pow: 0.8,
    }, mid);
    g.name = "cbz-mature-tree-wood" + (mid ? "-mid" : "");
    g.userData.vegetationArchetype = "mature-wood";
    return g;
  }

  function landscapeWood(mid) {
    // The country-wide bole: drawn at 0.72 of its height by continent.js, so
    // the scaffold rises steeper in authored metres to read at that squash.
    // The root footprint stays inside the 0.82 m seating samples.
    const g = skeleton({
      seed: 0x51d3, h: 20, rBase: 0.76, rMid: 0.52, rTop: 0.07, sway: 0.30, sides: 8,
      roots: 4, rootReach: 0.95, limbs: 5, limbLo: 10.0, limbHi: 13.8, reach: 4.4, rise: 4.2, limbR: 0.32,
      floor: 0.55, pow: 0.82,
    }, mid);
    g.name = "cbz-landscape-tree-wood" + (mid ? "-mid" : "");
    g.userData.vegetationArchetype = "landscape-wood";
    return g;
  }

  // THE SPRUCE BOLE. OWNER: "the evergreen tree has weird sticks sticking
  // out of it." Those sticks were the broadleaf LIMBS: every conifer spire
  // stood on `landscape-wood` (backcountry) or `mature-wood` (Redhollow),
  // whose crown-bearing limbs reach 3.8-4.6 m out at 11-19 m up — built to
  // hold a round crown. A spire is 2-3 m wide at that height and is drawn as
  // crossed branch-layer cards, so every limb poked out past the silhouette
  // and showed through the gaps between the cards. A spruce's branches ARE
  // its foliage: the bole is a straight taper with roots and nothing else.
  // Same 20 m height and 0.76 m base as landscape-wood, so seating, the
  // collider radius and the audit chain are unchanged.
  // The bole runs to 28 m, past the nominal 20: every consumer stretches the
  // spire's tip well above the wood's own scale (continent: tip ~23 m over a
  // 0.72-squashed bole; Redhollow/woods: ~30 sc over a 20 sc bole), and once
  // the spire became open boughs instead of a solid cone, the top third
  // stood on nothing. The leader now reaches the tip; the radius at y = 0
  // (the 0.76 m collider) is unchanged.
  function coniferWood(mid) {
    const parts = [bole(0.05, 0.76, 28, mid ? 5 : 7)];
    for (let i = 0; i < (mid ? 0 : 4); i++) {
      const a = i * GOLDEN + 0.7;
      parts.push(cylinderBetween([0, 0.28, 0], [Math.cos(a) * 0.76, -0.08, Math.sin(a) * 0.76], 0.37, 0.06, 5, true));
    }
    const g = shadeByHeight(merged(parts, parts[0]), 0.50, 0.85);
    g.name = "cbz-conifer-tree-wood" + (mid ? "-mid" : "");
    g.userData.vegetationArchetype = "conifer-wood";
    return g;
  }

  /* ======================================================================
     THE LEAF CARD SET — one non-indexed buffer of quads, each written in
     both windings, with authored lighting normals and atlas uvs.
  ====================================================================== */
  const ATLAS_INSET = 0.012;
  function CardSet() { this.pos = []; this.nrm = []; this.uv = []; this.occ = []; this.tint = []; this.cards = 0; }
  // light: {x,y,z,rx,ry,up} crown-centred, or {axis:true,rx,up}; with an
  // optional CLUMP {cx,cy,cz,cr,cw}: the normal then blends the crown's
  // sphere with the clump's own, so each clump is lit on top and shaded
  // underneath — the cauliflower read of a real canopy instead of one ball.
  CardSet.prototype.add = function (c, ax, ay, w, h, tile, flip, light, occ, tint) {
    const P = [], N = [], T = [];
    const tu = (tile & 1) * 0.5, tv = tile < 2 ? 0.5 : 0;
    for (let k = 0; k < 4; k++) {
      const sx = (k === 1 || k === 2 ? 1 : -1) * w * 0.5, sy = (k >= 2 ? 1 : -1) * h * 0.5;
      const x = c.x + ax.x * sx + ay.x * sy, y = c.y + ax.y * sx + ay.y * sy, z = c.z + ax.z * sx + ay.z * sy;
      P.push([x, y, z]);
      let nx, ny, nz;
      if (light.axis) { nx = x / light.rx; ny = light.up; nz = z / light.rx; }
      else { nx = (x - light.x) / light.rx; ny = (y - light.y) / light.ry + light.up; nz = (z - light.z) / light.rx; }
      if (light.cr) {
        const cw = light.cw, cl = Math.hypot(x - light.cx, y - light.cy, z - light.cz) || 1, ol = Math.hypot(nx, ny, nz) || 1;
        nx = nx / ol * (1 - cw) + (x - light.cx) / cl * cw;
        ny = ny / ol * (1 - cw) + (y - light.cy) / cl * cw + light.up * 0.4;
        nz = nz / ol * (1 - cw) + (z - light.cz) / cl * cw;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      N.push([nx / nl, ny / nl, nz / nl]);
      let u = (k === 1 || k === 2) ? 1 : 0; if (flip) u = 1 - u;
      const v = k >= 2 ? 1 : 0;
      T.push([tu + ATLAS_INSET + u * (0.5 - 2 * ATLAS_INSET), tv + ATLAS_INSET + v * (0.5 - 2 * ATLAS_INSET)]);
    }
    const self = this;
    const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
    function tri(a, b, d) {
      for (const i of [a, b, d]) {
        self.pos.push(P[i][0], P[i][1], P[i][2]);
        self.nrm.push(N[i][0], N[i][1], N[i][2]);
        self.uv.push(T[i][0], T[i][1]);
        self.occ.push(occ);
        self.tint.push(tr, tg, tb);
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
    g.userData.tint = this.tint;
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

  /* THE BROADLEAF CROWN — lobes of CLUMPS of leaf sprays.
     A canopy is not a ball of leaves: it is a few big masses (the lobes,
     one per scaffold limb), each made of smaller clumps (one per bough),
     each a handful of sprays. Cards are placed per CLUMP on the lobe's
     outer shell, a few dark ones fill the interior so it never reads
     hollow, and the gaps between clumps are where sky and the limbs show.
     Each card carries its own tint: outer/upper sprays sun-warm and
     yellower, inner and lower sprays cool and darker, every spray jittered
     a little — so 300 instances under one material are not one green. */
  function broadleafCards(set, spec, rnd) {
    const R = spec.r, H = spec.h;
    const lobes = lobeLayout(spec, rnd);
    const dens = cardDensity();
    const nClump = Math.max(2, Math.round((spec.cards / 2.5) * (0.6 + 0.4 * dens)));
    const perClump = dens < 0.75 ? 3 : 4;
    const inner = dens < 0.75 ? 1 : 3;
    const tileBase = rnd() < 0.5 ? 0 : 1;
    const cy0 = H * 0.5, ry0 = H * 0.55;
    const tint = [1, 1, 1];
    function tintFor(y, depth) {
      const hi = Math.max(0, Math.min(1, (y - H * 0.2) / (H * 0.8)));
      const sun = Math.max(0, depth) * (0.4 + 0.6 * hi);
      const j = (rnd() - 0.5) * 0.14, jg = (rnd() - 0.5) * 0.06;
      tint[0] = (0.90 + 0.20 * sun) * (1 + j);
      tint[1] = (0.97 + 0.07 * sun) * (1 + jg);
      tint[2] = (1.06 - 0.22 * sun) * (1 - j * 0.6);
      return tint;
    }
    for (let li = 0; li < lobes.length; li++) {
      const L = lobes[li];
      const LC = new THREE.Vector3(L.x, L.y, L.z);
      const mean = (L.rx + L.ry + L.rz) / 3;
      // clumps on the lobe's shell, biased up and out (the light side)
      for (let ci = 0; ci < nClump; ci++) {
        const d = randomUnit(rnd);
        d.y = d.y * 0.8 + 0.28; d.x += Math.sign(L.x || 1e-3) * 0.15; d.z += Math.sign(L.z || 1e-3) * 0.15; d.normalize();
        const rho = 0.55 + rnd() * 0.32;
        const cc = new THREE.Vector3(L.x + d.x * rho * L.rx, L.y + d.y * rho * L.ry, L.z + d.z * rho * L.rz);
        const cr = mean * (0.46 + rnd() * 0.16);
        const gx = cc.x / R, gy = (cc.y - cy0) / ry0, gz = cc.z / R;
        const depth = Math.min(1, Math.hypot(gx, gy, gz));
        const light = { x: 0, y: cy0, z: 0, rx: R, ry: ry0, up: 0.30, cx: cc.x, cy: cc.y - cr * 0.25, cz: cc.z, cr: cr, cw: 0.5 };
        for (let k = 0; k < perClump; k++) {
          const o = randomUnit(rnd);
          const c = new THREE.Vector3(cc.x + o.x * cr * 0.55, cc.y + o.y * cr * 0.45, cc.z + o.z * cr * 0.55);
          const out = c.clone().sub(LC).normalize();
          const n = randomUnit(rnd).multiplyScalar(0.55).add(out.multiplyScalar(0.45)).normalize();
          const f = frame(n, rnd() * Math.PI * 2);
          const size = cr * (1.9 + rnd() * 0.7);
          const occ = 0.60 + 0.40 * depth;
          set.add(c, f.ax, f.ay, size, size * (0.88 + rnd() * 0.24), (tileBase + (rnd() < 0.3 ? 1 : 0)) & 1, rnd() < 0.5,
            light, occ, tintFor(c.y, depth));
        }
      }
      // the dark interior: big cards near the lobe core so it is never hollow
      const lightIn = { x: 0, y: cy0, z: 0, rx: R, ry: ry0, up: 0.30 };
      for (let k = 0; k < inner; k++) {
        const o = randomUnit(rnd), rho = 0.15 + rnd() * 0.35;
        const c = new THREE.Vector3(L.x + o.x * rho * L.rx, L.y + o.y * rho * L.ry, L.z + o.z * rho * L.rz);
        const f = frame(randomUnit(rnd), rnd() * Math.PI * 2);
        const size = mean * (1.1 + rnd() * 0.4);
        set.add(c, f.ax, f.ay, size, size, tileBase, rnd() < 0.5, lightIn, 0.50 + rnd() * 0.08, tintFor(c.y, 0.1));
      }
    }
  }

  // THE SPRUCE — whorls of drooping BOUGHS, not crossed planes. The old
  // spire was three full-diameter vertical cards per level plus two flat
  // ones: a perfect cone in silhouette, and the flat cards seen edge-on
  // printed as dark horizontal spikes. A real spruce is tiers of branches
  // leaving the axis level and drooping toward their tips, each tier a
  // little ragged, with the bole visible through the lower gaps. Each bough
  // here is ONE card hung from the axis (twig base at the trunk, tip out
  // and down), rolled about its own length so it shows area from every
  // bearing; 5-7 per whorl, whorls offset by a golden turn, lengths
  // jittered so the outline is serrated by real branches. A crossed leader
  // tops it. Same triangle count as the planes it replaces.
  function spireCards(set, spec, rnd) {
    const R = spec.r, H = spec.h;
    const light = { axis: true, rx: R, up: 0.45 };
    const levels = Math.max(7, Math.round(13 * cardDensity()));
    const per = cardDensity() < 0.75 ? 5 : 6;
    const span = H * 0.86;
    const step = span / levels;
    const tint = [1, 1, 1];
    let az = rnd() * Math.PI * 2;
    for (let li = 0; li < levels; li++) {
      const t = (li + 0.5) / levels;
      const yc = H * 0.06 + t * span;
      const radL = R * (0.14 + 0.86 * Math.pow(1 - t, 0.85));
      const occ = 0.72 + 0.28 * t;
      const n = per + (li < levels * 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        az += GOLDEN + (rnd() - 0.5) * 0.5;
        const len = radL * (0.82 + rnd() * 0.30);
        const droop = 0.22 + 0.25 * (1 - t) + rnd() * 0.12;           // lower boughs hang more
        const dir = new THREE.Vector3(Math.cos(az), -droop, Math.sin(az)).normalize();
        const root = new THREE.Vector3(0, yc + rnd() * step * 0.4, 0);
        const c = root.clone().addScaledVector(dir, len * 0.5);
        // width axis: horizontal, perpendicular to the bough, then rolled
        // about the bough so it is neither flat nor edge-on
        const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
        side.applyAxisAngle(dir, (rnd() < 0.5 ? 1 : -1) * (0.35 + rnd() * 0.45));
        const j = (rnd() - 0.5) * 0.10;
        tint[0] = (0.94 + 0.10 * t) * (1 + j); tint[1] = 1 + j * 0.4; tint[2] = (1.04 - 0.08 * t) * (1 - j * 0.5);
        set.add(c, side, dir.clone().negate(), 0.5 + len * 0.85, len * 1.22, 2 + (k & 1), rnd() < 0.5, light, occ, tint);
      }
    }
    const tipH = H * 0.11;
    for (let k = 0; k < 2; k++) {
      const a = k * Math.PI / 2 + 0.3;
      set.add(new THREE.Vector3(0, H - tipH * 0.5, 0), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), UP, R * 0.42, tipH, 2 + k, false, light, 1);
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
    const occ = g.userData.occlusion, tint = g.userData.tint;
    delete g.userData.occlusion; delete g.userData.tint;
    return shadeByHeight(g, spec.floor, spec.pow, occ, tint);
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

  const builders = {
    "mature-wood": function () { return matureWood(false); },
    "landscape-wood": function () { return landscapeWood(false); },
    "conifer-wood": function () { return coniferWood(false); },
  };

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

  /* ======================================================================
     THE MID FORM — the same tree, simplified, for the middle distance
     (world/treelod.js owns the distances and the crossfades; past them the
     tree is an octahedral impostor baked from the NEAR form).

     Owner, 2026-10-12, on the far crowns that stood here: trunkless half-leaf
     crowns are not the tree. A mid form is a faithful simplified copy:
       • CROWN: cut FROM the near crown, never drawn anew: same variant, same
         lobes, same cards in the same places with the same uvs, lighting
         normals and baked shade. Every other card is kept and grown 1.3x
         about its own centre, so the silhouette and coverage stay where they
         were while the overlapping interior cards (what only a close eye
         resolves) halve. ~88 instead of ~176 triangles.
       • WOOD: the same bole, same taper, same limbs, with fewer sides; the
         ground roots (sub-pixel there) go. The trunk stays: a crown floating
         over bare ground was exactly what the owner saw.
     midOf(g) applies the crown cut to any leaf-card crown (the kit's custom
     crowns: wildnature, the island grove); null for anything else, whose
     near form is already cheap enough to carry the mid range itself. */
  const midCache = Object.create(null);
  function midOf(near) {
    if (!near || !near.attributes || !near.attributes.position) return null;
    const key = near.uuid;
    if (midCache[key] !== undefined) return midCache[key];
    const P = near.attributes.position, N = near.attributes.normal, T = near.attributes.uv, C = near.attributes.color;
    const per = 12;                         // a card: front + back quad, non-indexed
    const cards = (P.count / per) | 0;
    if (near.index || !N || !T || !C || !near.userData.leafCards || cards < 4 || P.count % per) { midCache[key] = null; return null; }
    const keep = [];
    for (let c = 0; c < cards; c += 2) keep.push(c);
    const n = keep.length * per;
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const GROW = 1.3;
    let w = 0;
    for (const c of keep) {
      const v0 = c * per;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < per; k++) { cx += P.getX(v0 + k); cy += P.getY(v0 + k); cz += P.getZ(v0 + k); }
      cx /= per; cy /= per; cz /= per;
      for (let k = 0; k < per; k++, w++) {
        const i = v0 + k;
        pos[w * 3] = cx + (P.getX(i) - cx) * GROW;
        pos[w * 3 + 1] = cy + (P.getY(i) - cy) * GROW;
        pos[w * 3 + 2] = cz + (P.getZ(i) - cz) * GROW;
        nrm[w * 3] = N.getX(i); nrm[w * 3 + 1] = N.getY(i); nrm[w * 3 + 2] = N.getZ(i);
        uv[w * 2] = T.getX(i); uv[w * 2 + 1] = T.getY(i);
        col[w * 3] = C.getX(i); col[w * 3 + 1] = C.getY(i); col[w * 3 + 2] = C.getZ(i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingBox(); g.computeBoundingSphere();
    g.name = (near.name || "cbz-crown") + "-mid";
    g.userData.vegetationArchetype = near.userData.vegetationArchetype;
    g.userData.vegetationVariant = near.userData.vegetationVariant;
    g.userData.leafCards = keep.length;
    g.userData.midOf = near.name || "";
    g._shared = true;
    midCache[key] = g;
    return g;
  }
  const midWoods = {
    "mature-wood": function () { return matureWood(true); },
    "landscape-wood": function () { return landscapeWood(true); },
    "conifer-wood": function () { return coniferWood(true); },
  };
  function midGeometry(kind, variant) {
    if (midWoods[kind]) {
      const key = kind + "#mid";
      if (!cache[key]) { cache[key] = midWoods[kind](); cache[key]._shared = true; }
      return cache[key];
    }
    return midOf(geometry(kind, variant)) || geometry(kind, variant);
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

  /* THE PALM (moved here from world/disaster_arena.js, 2026-09-27, so the
     island and any Gang Life coast plant ONE palm, not two forks). Both
     return cached geometries with a white-ish vertex colour ramp (the kit
     materials run vertexColors); the trunk's geometry.userData.top is its
     bent tip at unit height, where the crown hub sits. Wear them with
     material("wood") for the trunk and a DoubleSide vertex-colour Lambert
     for the fronds (a frond is a comb of leaflet triangles, not a card). */
  const palmCache = Object.create(null);
  function palmOnce(key, fn) { return palmCache[key] || (palmCache[key] = fn()); }
  function h01(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : 0.5; }
  function palmRamp(g, low) {
    g.computeBoundingBox();
    const p = g.attributes.position, y0 = g.boundingBox.min.y, dy = Math.max(0.001, g.boundingBox.max.y - y0);
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const t = Math.max(0, Math.min(1, (p.getY(i) - y0) / dy));
      const val = low + (1 - low) * Math.sqrt(t);
      c[i * 3] = val; c[i * 3 + 1] = val; c[i * 3 + 2] = val;
    }
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return g;
  }
  /* A COCONUT PALM, in two meshes. The trunk is a leaning curve (slender,
     swelling at the foot, banded by the dark leaf-scar collars a palm trunk
     is read by — vertex colour, not extra meshes); the crown is 11 pinnate
     fronds — a spine that leaves the hub near level and hangs over its
     length, with a leaflet pair at every step — merged into ONE geometry.
     Geometry, not a texture: a frond's read is its comb of leaflets
     against the sky. */
  function palmTrunk(v) {
    return palmOnce("pt" + v, function () {
      const SEG = 7, parts = [];
      const bend = [0.10, 0.16, 0.06][v];
      const at = function (t) { return new THREE.Vector3(bend * Math.pow(t, 1.8), t, 0); };
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < SEG; i++) {
        const a = at(i / SEG), b = at((i + 1) / SEG);
        const r0 = 0.20 - 0.07 * (i / SEG) + (i === 0 ? 0.06 : 0), r1 = 0.20 - 0.07 * ((i + 1) / SEG);
        const len = a.distanceTo(b);
        const c = new THREE.CylinderGeometry(r1, r0, len * 1.02, 8, 1, true);
        const uv = c.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 1.5, uv.getY(k) * 0.35 + i * 0.35);
        const dir = b.clone().sub(a).normalize();
        c.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir)));
        c.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        parts.push(c);
      }
      const BGU = THREE.BufferGeometryUtils;
      const g = (BGU && BGU.mergeBufferGeometries && BGU.mergeBufferGeometries(parts, false)) || parts[0];
      palmRamp(g, 0.62);
      const p = g.attributes.position, col = g.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const band = 0.5 + 0.5 * Math.cos(p.getY(i) * Math.PI * 2 * 9);
        const k = 1 - 0.3 * Math.pow(band, 6);
        col.setXYZ(i, col.getX(i) * k, col.getY(i) * k * 0.98, col.getZ(i) * k * 0.95);
      }
      g.userData.top = at(1);
      g.computeBoundingSphere();
      return g;
    });
  }
  function palmCrown(v) {
    return palmOnce("pc" + v, function () {
      const pos = [], col = [];
      const N = 11, SEG = 17;
      function tri(a, b, c, ca, cb, cc) {
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        col.push(ca, ca, ca * 0.85, cb, cb, cb * 0.85, cc, cc, cc * 0.85);
      }
      for (let f = 0; f < N; f++) {
        const yaw = (f / N) * Math.PI * 2 + (h01(f, v, 0x9a1) - 0.5) * 0.35;
        const len = 2.6 + h01(f, v, 0x9a2) * 0.9;
        const lift = -0.2 + h01(f, v, 0x9a3) * 0.7;              // start pitch, above/below level
        const hang = 1.2 + h01(f, v, 0x9a4) * 0.7;               // how hard it droops
        const dx = Math.cos(yaw), dz = Math.sin(yaw);
        const sx = -dz, sz = dx;                                   // leaflet side direction
        // the spine: integrate the pitch so it is a real arc, not a chord
        const pts = [new THREE.Vector3(0, 0, 0)];
        const STEPS = 18;
        for (let s = 1; s <= STEPS; s++) {
          const u = (s - 0.5) / STEPS, ang = lift - hang * u * u, dl = len / STEPS;
          const q = pts[s - 1];
          pts.push(new THREE.Vector3(q.x + dx * Math.cos(ang) * dl, q.y + Math.sin(ang) * dl, q.z + dz * Math.cos(ang) * dl));
        }
        const spine = function (u) {
          const f2 = u * STEPS, i0 = Math.min(STEPS - 1, Math.floor(f2));
          return pts[i0].clone().lerp(pts[i0 + 1], f2 - i0);
        };
        for (let i = 0; i < SEG; i++) {
          const u0 = 0.06 + (i / SEG) * 0.94, u1 = 0.06 + ((i + 1) / SEG) * 0.94;
          // a leaflet is a narrow blade: its base spans only the first half
          // of the step, so the comb has gaps between blades
          const a = spine(u0), b = spine(u0 + (u1 - u0) * 0.5);
          const w = 0.8 * Math.sin(Math.PI * Math.min(1, 0.12 + u0 * 0.95)) + 0.12;   // leaflet length
          const shade = 0.6 + 0.4 * u0;
          for (let sgn = -1; sgn <= 1; sgn += 2) {
            const tip = new THREE.Vector3(
              (a.x + b.x) / 2 + sx * sgn * w + dx * w * 0.55,
              (a.y + b.y) / 2 - w * 0.6,
              (a.z + b.z) / 2 + sz * sgn * w + dz * w * 0.55);
            tri(a, b, tip, shade * 0.85, shade * 0.95, shade * 1.1);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      // lighting normals point OUT of the crown, up-biased, so both faces
      // of a leaflet shade as part of the canopy mass, not as a flipped card
      const nrm = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1] + 0.8, z = pos[i + 2];
        const l = Math.hypot(x, y, z) || 1;
        let nx = x / l * 0.55, ny = y / l * 0.55 + 0.45, nz = z / l * 0.55;
        const m = Math.hypot(nx, ny, nz) || 1;
        nrm[i] = nx / m; nrm[i + 1] = ny / m; nrm[i + 2] = nz / m;
      }
      g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      g.computeBoundingSphere();
      return g;
    });
  }

  CBZ.vegetationKit = {
    palmTrunk: palmTrunk,
    palmCrown: palmCrown,
    geometry: geometry,
    midGeometry: midGeometry,
    midOf: midOf,
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
