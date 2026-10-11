"use strict";
/* src/battle/arenas/fields.js — NPC War: OPEN FIELDS are farmland.

   "Rolling grass" was a green sheet. Farm country is PARCELS — the same
   turned grid the ground shader colours (erg.js PARCEL / CROP, read from one
   type table so the crop you see standing is the crop the ground shows
   between its rows) — and what divides them is what an army fights from:

     HEDGEROWS  on an earth BANK (a ground.js berm, 0.9 m, so terrain sight
                and the men's feet both know it) with holly/hawthorn thicket
                along the top and the odd hedgerow oak. Bocage: a bank and a
                hedge stop a rifle round, so each run is a collider and a
                line of cover points. Gateways are left open.
     DRY WALLS  dry-stone field walls with coping (dress.js), 1.1 m.
     CROPS      standing wheat (0.95 m) and maize (2.3 m), real rows of
                alpha-cut stalk cards, instanced: concealment, not cover.
                Round bales on the stubble, which ARE cover.
     PASTURE    the turf shader (groundTurf) and tufts.

   PUBLIC  CBZ.battleFields = { build(ctx), stats() } */

CBZ.battleFields = (function () {
  const F = { hedges: 0, walls: 0, wheat: 0, maize: 0, bales: 0, tufts: 0 };
  function h01(a, b, s) {
    let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(s | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ---- THE CROPS: two alpha cards per row strip, slightly crossed, so a row
     is never seen exactly edge-on. Textures are painted once. */
  const T = {};
  function cropTex(kind) {
    if (T[kind]) return T[kind];
    const W = 256, H = kind === "maize" ? 256 : 128;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.clearRect(0, 0, W, H);
    let s = kind === "maize" ? 77 : 33;
    const r = function () { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    if (kind === "wheat") {
      for (let i = 0; i < 150; i++) {
        const x = r() * W, top = H * (0.08 + r() * 0.22), lean = (r() - 0.5) * 10;
        const t = 0.75 + r() * 0.3;
        g.strokeStyle = "rgb(" + Math.round(178 * t) + "," + Math.round(146 * t) + "," + Math.round(70 * t) + ")";
        g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + lean * 0.3, H * 0.5, x + lean, top + 12); g.stroke();
        // the ear: a tight plait of grains with its awns
        g.fillStyle = "rgb(" + Math.round(196 * t) + "," + Math.round(160 * t) + "," + Math.round(78 * t) + ")";
        g.beginPath(); g.ellipse(x + lean, top + 6, 2.6, 9, lean * 0.02, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(210,180,110,0.8)"; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(x + lean, top - 2); g.lineTo(x + lean + (r() - 0.5) * 6, top - 12); g.stroke();
      }
    } else {
      for (let i = 0; i < 9; i++) {
        const x = 14 + i * 27 + (r() - 0.5) * 8, t = 0.8 + r() * 0.3;
        g.strokeStyle = "rgb(" + Math.round(86 * t) + "," + Math.round(120 * t) + "," + Math.round(48 * t) + ")";
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(x, H); g.lineTo(x + (r() - 0.5) * 6, H * 0.06); g.stroke();
        // broad leaves arching off the stalk, alternate sides
        for (let k = 0; k < 7; k++) {
          const y = H * (0.88 - k * 0.11), side = k % 2 ? 1 : -1, len = 34 + r() * 22;
          g.fillStyle = "rgb(" + Math.round(70 * t + r() * 20) + "," + Math.round(118 * t + r() * 18) + "," + Math.round(42 * t) + ")";
          g.beginPath(); g.moveTo(x, y);
          g.quadraticCurveTo(x + side * len * 0.6, y - 18, x + side * len, y + 6 + r() * 8);
          g.quadraticCurveTo(x + side * len * 0.5, y - 6, x, y + 4); g.fill();
        }
        // the tassel
        g.strokeStyle = "rgb(190,160,96)"; g.lineWidth = 1.5;
        for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(x, H * 0.07); g.lineTo(x + (k - 2) * 4, H * 0.02); g.stroke(); }
        // the cob in its husk
        g.fillStyle = "rgb(150,160,90)"; g.beginPath(); g.ellipse(x + 5, H * 0.5, 4, 13, 0.3, 0, Math.PI * 2); g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return (T[kind] = t);
  }
  function stripGeo(len, hgt) {
    const pos = [], uv = [], nrm = [];
    for (const k of [-1, 1]) {
      const a = k * 0.18, off = k * 0.1;
      const ca = Math.cos(a), sa = Math.sin(a);
      const P = function (s, y) { return [s * ca - off * sa, y, s * sa + off * ca]; };
      const q = [P(-len / 2, 0), P(len / 2, 0), P(len / 2, hgt), P(-len / 2, hgt)];
      const u = [[0, 0], [len / 3, 0], [len / 3, 1], [0, 1]];
      [0, 1, 2, 0, 2, 3].forEach(function (i) { pos.push(q[i][0], q[i][1], q[i][2]); uv.push(u[i][0], u[i][1]); nrm.push(0, 0.85, 0.5 * k); });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    return g;
  }
  function cropMat(kind) {
    const tex = cropTex(kind);
    tex.wrapS = THREE.RepeatWrapping;
    const m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide });
    // a breeze through the standing crop: the tops lean together in waves
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uT = CROP_T;
      sh.vertexShader = "uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n{ vec4 w = instanceMatrix * vec4(transformed, 1.0);\n" +
        "  float sway = sin(uT * 1.3 + w.x * 0.11 + w.z * 0.07) * 0.5 + sin(uT * 2.1 + w.x * 0.31) * 0.2;\n" +
        "  transformed.x += sway * 0.12 * transformed.y * transformed.y; }");
    };
    m.customProgramCacheKey = function () { return "npcwar-crop"; };
    return m;
  }
  const CROP_T = { value: 0 };

  /* ---- the parcels in the fighting window ---- */
  function build(ctx) {
    const g = ctx.groundAt, cx = ctx.cx, cz = ctx.cz;
    const D = CBZ.battleDress, GR = CBZ.battleGround, K = CBZ.vegetationKit;
    const c = Math.cos(PARCEL.ang), s = Math.sin(PARCEL.ang);
    // parcel-local (a, b) -> world
    const W = function (a, b) { return [cx + a * c - b * s, cz + a * s + b * c]; };
    const keep = function (x, z, pad) {
      for (let i = 0; i < ctx.keepOut.length; i++) {
        const k = ctx.keepOut[i];
        if (Math.abs(x - k.x) < k.hx + pad && Math.abs(z - k.z) < k.hz + pad) return true;
      }
      return false;
    };
    const REACH = 420, CROPS = 340;
    const iMin = Math.floor(-REACH / PARCEL.w), iMax = Math.ceil(REACH / PARCEL.w);
    const jMin = Math.floor(-REACH / PARCEL.d), jMax = Math.ceil(REACH / PARCEL.d);
    /* 1. THE BOUNDARIES FIRST: banks are part of the ground, so they go in
       before anything is seated on it. Each parcel owns its west and south
       edge; the kind of edge is the hash of the edge. */
    const hedgeRuns = [];
    for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) {
      for (const side of [0, 1]) {
        // side 0: the edge at a = i*w running along b; side 1: b = j*d running along a
        const a0 = side ? i * PARCEL.w : i * PARCEL.w, b0 = side ? j * PARCEL.d : j * PARCEL.d;
        const L = side ? PARCEL.w : PARCEL.d;
        const kindR = h01(i * 2 + side, j, 601);
        if (kindR > 0.72) continue;                              // an open edge: just the turn of the plough
        const hedge = kindR < 0.47;
        // a gateway somewhere along it
        const gate = 8 + h01(i, j * 2 + side, 603) * (L - 16);
        const segs = [[0, gate - 2.6], [gate + 2.6, L]];
        segs.forEach(function (sg) {
          if (sg[1] - sg[0] < 3) return;
          const A = side ? W(a0 + sg[0], b0) : W(a0, b0 + sg[0]);
          const B = side ? W(a0 + sg[1], b0) : W(a0, b0 + sg[1]);
          const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
          if (Math.abs(mx - cx) > REACH || Math.abs(mz - cz) > REACH) return;
          if (hedge) {
            GR.berm(A[0], A[1], B[0], B[1], 0.85, 1.7);
            hedgeRuns.push({ A: A, B: B });
          } else hedgeRuns.push({ A: A, B: B, wall: true });
        });
      }
    }
    /* 2. the hedges on their banks, the walls, as cover */
    const thick = [], oaks = [];
    hedgeRuns.forEach(function (r, ri) {
      const dx = r.B[0] - r.A[0], dz = r.B[1] - r.A[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
      const yaw = Math.atan2(-uz, ux);                         // local +x along the run
      const midClear = !keep((r.A[0] + r.B[0]) / 2, (r.A[1] + r.B[1]) / 2, 2);
      if (r.wall) {
        const n = Math.floor(L / 3);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) * 3;
          const x = r.A[0] + ux * t, z = r.A[1] + uz * t;
          if (keep(x, z, 1)) continue;
          D.place("drywall", x, z, yaw + (h01(ri, k, 605) - 0.5) * 0.02);
          F.walls++;
        }
        return;
      }
      if (!midClear && L < 20) return;
      // the bank + hedge as cover: one collider per ~6 m, 2 m high (bank and growth)
      for (let t = 0; t < L - 1; t += 6) {
        const tl = Math.min(6, L - t), x = r.A[0] + ux * (t + tl / 2), z = r.A[1] + uz * (t + tl / 2);
        if (keep(x, z, 1)) continue;
        CBZ.battleCover.add({ kind: "hedge", x: x, z: z, yaw: yaw, hw: tl / 2, hd: 0.9, h: 2.0, hp: 600, rubbleH: 0.9 });
        F.hedges++;
      }
      for (let t = 1.2; t < L - 1; t += 2.6) {
        const x = r.A[0] + ux * t + (h01(ri, t * 10, 607) - 0.5) * 0.6, z = r.A[1] + uz * t + (h01(ri, t * 10, 609) - 0.5) * 0.6;
        if (keep(x, z, 0)) continue;
        thick.push({ x: x, z: z, y: g(x, z), s: 0.5 + h01(ri, t * 10, 611) * 0.3, yaw: h01(ri, t * 7, 613) * 6.28 });
        if (h01(ri, t * 3, 615) < 0.035) oaks.push({ x: x, z: z, y: g(x, z), s: 0.75 + h01(ri, t, 617) * 0.35 });
      }
    });
    const GL = !!(CBZ.micro && CBZ.micro.renderer) && typeof document !== "undefined";
    if (K && GL) {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
      const pool = function (kind, items, mat, place, name, colour) {
        const v = K.variantCount ? K.variantCount(kind) : 1;
        for (let vi = 0; vi < v; vi++) {
          const its = items.filter(function (it) { return (K.variantAt ? K.variantAt(it.x, it.z, kind) : 0) === vi; });
          if (!its.length) continue;
          const mesh = new THREE.InstancedMesh(K.geometry(kind, vi), mat, its.length);
          const col = new Float32Array(its.length * 3);
          its.forEach(function (it, i) {
            place(it, m4); mesh.setMatrixAt(i, m4);
            const cc = colour(it); col[i * 3] = cc[0]; col[i * 3 + 1] = cc[1]; col[i * 3 + 2] = cc[2];
          });
          mesh.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
          const dm = K.depthMaterial ? K.depthMaterial(kind) : null; if (dm) mesh.customDepthMaterial = dm;
          mesh.userData.dynamic = true; mesh.name = name + vi;
          CBZ.scene.add(mesh);
        }
      };
      pool("thicket", thick, K.material("thicket"), function (it, M) {
        e.set(0, it.yaw, 0); q.setFromEuler(e);
        return M.compose(p.set(it.x, it.y - 0.15, it.z), q, sc.set(it.s, it.s * 0.75, it.s));
      }, "hedge-", function (it) { const j = h01(it.x * 3, it.z * 3, 619); return [0.13 + j * 0.06, 0.25 + j * 0.08, 0.08]; });
      if (oaks.length) {
        const trunks = new THREE.InstancedMesh(K.geometry("mature-wood"), K.material("mature-wood"), oaks.length);
        oaks.forEach(function (o, i) {
          e.set(0, h01(o.x, o.z, 621) * 6.28, 0); q.setFromEuler(e);
          trunks.setMatrixAt(i, m4.compose(p.set(o.x, o.y - 0.3 * o.s, o.z), q, sc.set(o.s, o.s, o.s)));
          CBZ.battleCover.add({ kind: "tree", x: o.x, z: o.z, hw: 0.36 * o.s, hd: 0.36 * o.s, h: 9, hp: 400, gy: o.y });
        });
        trunks.instanceMatrix.needsUpdate = true; trunks.castShadow = true; trunks.receiveShadow = true; trunks.frustumCulled = false;
        trunks.userData.dynamic = true; trunks.name = "hedge-oaks";
        CBZ.scene.add(trunks);
        pool("mature-crown", oaks, K.material("mature-crown"), function (o, M) {
          e.set(0, h01(o.x, o.z, 623) * 6.28, 0); q.setFromEuler(e);
          return M.compose(p.set(o.x, o.y + 13 * o.s, o.z), q, sc.set(o.s, o.s, o.s));
        }, "hedge-oak-crown-", function () { return [0.2, 0.33, 0.12]; });
      }
    }
    /* 3. the crops and the bales, parcel by parcel */
    const wheat = [], maize = [], tufts = [];
    for (let i = iMin; i <= iMax; i++) for (let j = jMin; j <= jMax; j++) {
      const P = parcelAt.apply(null, W((i + 0.5) * PARCEL.w, (j + 0.5) * PARCEL.d));
      const ctr = W((i + 0.5) * PARCEL.w, (j + 0.5) * PARCEL.d);
      if (Math.abs(ctr[0] - cx) > CROPS + 60 || Math.abs(ctr[1] - cz) > CROPS + 60) continue;
      // rows === 0: the rows are lines of constant a (they run along b), as
      // the shader draws them (rc = loc.x); rows === 1: they run along a
      const rows0 = P.rows === 0;
      const dir = rows0 ? [-s, c] : [c, s];
      const yaw = Math.atan2(-dir[1], dir[0]);
      if (P.type === CROP.wheat || P.type === CROP.maize) {
        const sp = 0.76, strip = P.type === CROP.wheat ? 4 : 3;
        const LA = rows0 ? PARCEL.w : PARCEL.d, LB = rows0 ? PARCEL.d : PARCEL.w;
        for (let r = sp * 4; r < LA - 3; r += sp) for (let t = 3.2 + strip / 2; t < LB - 3.2; t += strip) {
          const a = i * PARCEL.w + (rows0 ? r : t), b = j * PARCEL.d + (rows0 ? t : r);
          const w = W(a, b);
          if (Math.abs(w[0] - cx) > CROPS || Math.abs(w[1] - cz) > CROPS) continue;
          if (keep(w[0], w[1], 1)) continue;
          (P.type === CROP.wheat ? wheat : maize).push({ x: w[0], z: w[1], yaw: yaw });
        }
      } else if (P.type === CROP.stubble) {
        // a line of round bales left where the baler dropped them
        const n = 6 + ((h01(i, j, 631) * 8) | 0);
        for (let k = 0; k < n; k++) {
          const a = i * PARCEL.w + 12 + h01(i, j * 9 + k, 633) * (PARCEL.w - 24), b = j * PARCEL.d + 10 + h01(i * 9 + k, j, 635) * (PARCEL.d - 20);
          const w = W(a, b);
          if (keep(w[0], w[1], 2) || !D.free(w[0], w[1], 1.2)) continue;
          D.claim(w[0], w[1], 1.1);
          D.place("bale", w[0], w[1], h01(i, k, 637) * 6.28);
          F.bales++;
        }
      } else if (P.type === CROP.pasture) {
        for (let k = 0; k < 220; k++) {
          const a = i * PARCEL.w + h01(i, j * 300 + k, 639) * PARCEL.w, b = j * PARCEL.d + h01(i * 300 + k, j, 641) * PARCEL.d;
          const w = W(a, b);
          tufts.push({ x: w[0], z: w[1] });
        }
      }
    }
    const stripPool = function (items, kind, len, hgt) {
      if (!items.length || !GL) return;
      const mesh = new THREE.InstancedMesh(stripGeo(len, hgt), cropMat(kind), items.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      items.forEach(function (it, i) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
        const k = 0.88 + h01(it.x * 9, it.z * 9, 643) * 0.22;
        mesh.setMatrixAt(i, m4.compose(p.set(it.x, g(it.x, it.z) - 0.04, it.z), q, sc.set(1, k, 1)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = kind === "maize"; mesh.receiveShadow = true; mesh.frustumCulled = false;
      mesh.userData.dynamic = true; mesh.name = "crop-" + kind;
      CBZ.scene.add(mesh);
    };
    stripPool(wheat, "wheat", 4, 0.98); F.wheat = wheat.length;
    stripPool(maize, "maize", 3, 2.3); F.maize = maize.length;
    if (tufts.length && GL) {
      const mesh = new THREE.InstancedMesh(tuftGeometry(), new THREE.MeshLambertMaterial({ color: 0x5b7a30 }), tufts.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      tufts.forEach(function (t, i) {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h01(t.x, t.z, 645) * 6.28);
        const k = 0.6 + h01(t.x * 3, t.z, 647) * 0.7;
        mesh.setMatrixAt(i, m4.compose(p.set(t.x, g(t.x, t.z) - 0.04, t.z), q, sc.set(k, k * 0.7, k)));
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.userData.dynamic = true; mesh.name = "pasture-tufts";
      CBZ.scene.add(mesh);
      F.tufts = tufts.length;
    }
    return F;
  }
  CBZ.npcwar.onBoot(function () {
    if (CBZ.micro && CBZ.micro.onFrame) CBZ.micro.onFrame(function (dt) { CROP_T.value += dt || 0; });
  });
  return { build: build, stats: function () { return Object.assign({}, F); } };
})();
