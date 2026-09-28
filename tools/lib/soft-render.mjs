/* tools/lib/soft-render.mjs — a tiny software rasterizer for rig SHAPE
   reviews in plain node (no browser, no GPU): orthographic views of every
   visible mesh under a root, z-buffered, smooth Lambert + a rim, material
   colour (or a mid grey for a textured material), written as a PNG.

     renderViews(THREE, root, [{yaw, pitch}], {w, h, file, span}) */
import { writeFileSync } from "node:fs";
import zlib from "node:zlib";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// collect world-space triangles (with smooth normals) of every visible mesh
function collect(THREE, root) {
  root.updateMatrixWorld(true);
  const tris = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal;
    if (!pos) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    let col = [0.6, 0.6, 0.6];
    if (m && m.color && !m.map) col = [m.color.r, m.color.g, m.color.b];
    else if (m && m.map) col = [0.72, 0.70, 0.66];
    const img = m && m.map && m.map.image && typeof m.map.image._data === "function" ? m.map.image : null;   // tools/lib/fake-canvas.mjs
    const tint = m && m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
    const uvA = g.attributes.uv;
    nm.getNormalMatrix(o.matrixWorld);
    const W = [], N = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); W.push(v.x, v.y, v.z);
      if (nor) { n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); N.push(n.x, n.y, n.z); } else N.push(0, 0, 1);
    }
    const idx = g.index ? g.index.array : null, cnt = idx ? idx.length : pos.count;
    for (let t = 0; t < cnt; t += 3) {
      const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
      tris.push({ p: [a, b, c].map((i) => [W[i * 3], W[i * 3 + 1], W[i * 3 + 2]]), n: [a, b, c].map((i) => [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]), col, ds: !!(m && m.side === 2),
        img, tint, at: (m && m.alphaTest) || 0, flip: !(m && m.map && m.map.flipY === false), uv: img && uvA ? [a, b, c].map((i) => [uvA.getX(i), uvA.getY(i)]) : null });
    }
  });
  return tris;
}

export function renderViews(THREE, root, views, opts) {
  const tris = collect(THREE, root);
  const w = opts.w || 320, h = opts.h || 520, pad = 6;
  let y0 = Infinity, y1 = -Infinity, r = 0, cx = 0, cz = 0, cnt = 0;
  for (const t of tris) for (const p of t.p) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); cx += p[0]; cz += p[2]; cnt++; }
  cx /= cnt; cz /= cnt;
  for (const t of tris) for (const p of t.p) r = Math.max(r, Math.hypot(p[0] - cx, p[2] - cz));
  if (opts.focus) { y0 = opts.focus[0]; y1 = opts.focus[1]; }
  const span = opts.span || Math.max(y1 - y0, 2 * r) * 1.04;
  const sc = (h - 2 * pad) / span, midY = (y0 + y1) / 2;
  const W = w * views.length;
  const rgb = Buffer.alloc(W * h * 3);
  for (let i = 0; i < W * h; i++) { rgb[i * 3] = 222; rgb[i * 3 + 1] = 226; rgb[i * 3 + 2] = 232; }
  const L = [0.45, 0.75, 0.55], Ll = Math.hypot(...L); L[0] /= Ll; L[1] /= Ll; L[2] /= Ll;
  views.forEach((vw, vi) => {
    const cy = Math.cos(vw.yaw || 0), sy = Math.sin(vw.yaw || 0), cp = Math.cos(vw.pitch || 0), spt = Math.sin(vw.pitch || 0);
    const X = (p) => {                         // camera looks down -Z from +Z after yaw/pitch
      const x = (p[0] - cx) * cy - (p[2] - cz) * sy, z0 = (p[0] - cx) * sy + (p[2] - cz) * cy;
      const y = (p[1] - midY) * cp - z0 * spt, z = (p[1] - midY) * spt + z0 * cp;
      return [w / 2 + x * sc, h / 2 - y * sc, z];
    };
    const R3 = (n) => { const x = n[0] * cy - n[2] * sy, z0 = n[0] * sy + n[2] * cy; return [x, n[1] * cp - z0 * spt, n[1] * spt + z0 * cp]; };
    const zb = new Float32Array(w * h).fill(-Infinity);
    for (const t of tris) {
      const P = t.p.map(X), Nn = t.n.map(R3);
      const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
      if (area >= 0 && !t.ds) continue;         // back-facing (screen y is down)
      const xa = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), xb = Math.min(w - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
      const ya = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), yb = Math.min(h - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
      for (let py = ya; py <= yb; py++) for (let px = xa; px <= xb; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((P[1][0] - qx) * (P[2][1] - qy) - (P[2][0] - qx) * (P[1][1] - qy)) / area;
        const w1 = ((P[2][0] - qx) * (P[0][1] - qy) - (P[0][0] - qx) * (P[2][1] - qy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
        const k = py * w + px;
        if (z <= zb[k]) continue;
        let col = t.col;
        if (t.uv) {
          const u = w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0], v = w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1];
          const I = t.img, tx = Math.min(I.width - 1, Math.max(0, Math.floor(u * I.width))), ty = Math.min(I.height - 1, Math.max(0, Math.floor((t.flip ? 1 - v : v) * I.height)));
          const d = I._data(), o4 = (ty * I.width + tx) * 4;
          if (d[o4 + 3] / 255 < t.at) continue;
          col = [d[o4] / 255 * t.tint[0], d[o4 + 1] / 255 * t.tint[1], d[o4 + 2] / 255 * t.tint[2]];
        }
        zb[k] = z;
        let nx = w0 * Nn[0][0] + w1 * Nn[1][0] + w2 * Nn[2][0], ny = w0 * Nn[0][1] + w1 * Nn[1][1] + w2 * Nn[2][1], nz = w0 * Nn[0][2] + w1 * Nn[1][2] + w2 * Nn[2][2];
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const dif = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const rim = Math.pow(1 - Math.abs(nz), 3) * 0.15;
        const sh = 0.30 + 0.72 * dif + rim;
        const o = (py * W + vi * w + px) * 3;
        rgb[o] = Math.min(255, col[0] * sh * 255); rgb[o + 1] = Math.min(255, col[1] * sh * 255); rgb[o + 2] = Math.min(255, col[2] * sh * 255);
      }
    }
  });
  writePNG(opts.file, W, h, rgb);
  return { tris: tris.length, span };
}
