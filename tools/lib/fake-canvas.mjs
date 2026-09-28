/* tools/lib/fake-canvas.mjs — a small, HONEST software 2D canvas for plain-node
   checks. It rasterises what the game's painters actually call (fillRect,
   clearRect, filled paths with lines + arcs, linear gradients, source-over /
   source-atop / destination-out compositing, globalAlpha, save/restore,
   getImageData / putImageData / createImageData) into a real RGBA buffer, so a
   test can ask "what alpha did the painter leave at this texel" and get the
   answer the browser would give (pixel-centre coverage, no anti-aliasing).
   Text is NOT rasterised (fillText is recorded and ignored): every fillText in
   this game paints ink over an already opaque region, so it cannot change an
   alpha answer. Anything else unknown is a recorded no-op. */

function parseColor(s) {
  if (typeof s !== "string") return [0, 0, 0, 1];
  s = s.trim().toLowerCase();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? p[3] : 1];
  }
  const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0], red: [255, 0, 0, 1] };
  return NAMED[s] || [0, 0, 0, 1];
}

class Gradient {
  constructor(x0, y0, x1, y1) { this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.stops = []; }
  addColorStop(t, c) { this.stops.push([t, parseColor(c)]); this.stops.sort((a, b) => a[0] - b[0]); }
  at(x, y) {
    const dx = this.x1 - this.x0, dy = this.y1 - this.y0, L = dx * dx + dy * dy;
    let t = L > 0 ? ((x - this.x0) * dx + (y - this.y0) * dy) / L : 0;
    const S = this.stops;
    if (!S.length) return [0, 0, 0, 0];
    if (t <= S[0][0]) return S[0][1];
    if (t >= S[S.length - 1][0]) return S[S.length - 1][1];
    for (let i = 1; i < S.length; i++) if (t <= S[i][0]) {
      const a = S[i - 1], b = S[i], k = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
      return a[1].map((v, j) => v + (b[1][j] - v) * k);
    }
    return S[S.length - 1][1];
  }
}

class Ctx2D {
  constructor(cv) {
    this.canvas = cv;
    this.fillStyle = "#000"; this.strokeStyle = "#000";
    this.globalAlpha = 1; this.globalCompositeOperation = "source-over";
    this.font = "10px sans-serif"; this.textAlign = "start"; this.textBaseline = "alphabetic";
    this.lineWidth = 1; this.lineCap = "butt"; this.lineJoin = "miter";
    this._stack = []; this._path = []; this._sub = null;
    this._tx = [1, 0, 0, 1, 0, 0];
    this.ignored = {};
  }
  get _buf() { return this.canvas._data(); }
  save() { this._stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, gco: this.globalCompositeOperation, tx: this._tx.slice(), font: this.font }); }
  restore() { const s = this._stack.pop(); if (!s) return; this.fillStyle = s.fillStyle; this.globalAlpha = s.globalAlpha; this.globalCompositeOperation = s.gco; this._tx = s.tx; this.font = s.font; }
  // transforms (translate/scale only are honoured for paths; enough for the painters)
  translate(x, y) { this._tx[4] += x * this._tx[0]; this._tx[5] += y * this._tx[3]; }
  scale(x, y) { this._tx[0] *= x; this._tx[3] *= y; }
  setTransform(a, b, c, d, e, f) { this._tx = [a, b, c, d, e, f]; }
  resetTransform() { this._tx = [1, 0, 0, 1, 0, 0]; }
  _p(x, y) { const t = this._tx; return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]; }
  createLinearGradient(x0, y0, x1, y1) { const a = this._p(x0, y0), b = this._p(x1, y1); return new Gradient(a[0], a[1], b[0], b[1]); }
  createRadialGradient(x0, y0, r0, x1, y1) { const a = this._p(x0, y0); return new Gradient(a[0], a[1], a[0] + 1, a[1] + 1); }
  createPattern() { return "#808080"; }
  _src(x, y) {
    const fs = this.fillStyle;
    const c = fs instanceof Gradient ? fs.at(x, y) : parseColor(fs);
    return [c[0], c[1], c[2], c[3] * this.globalAlpha];
  }
  _plot(i, j) {
    const cv = this.canvas;
    if (i < 0 || j < 0 || i >= cv.width || j >= cv.height) return;
    const d = this._buf, o = (j * cv.width + i) * 4;
    const s = this._src(i + 0.5, j + 0.5);
    const sa = s[3], da = d[o + 3] / 255;
    const op = this.globalCompositeOperation;
    if (op === "destination-out") { d[o + 3] = Math.round(255 * da * (1 - sa)); return; }
    if (op === "source-atop") {
      if (da <= 0) return;
      for (let k = 0; k < 3; k++) d[o + k] = Math.round(s[k] * sa + d[o + k] * (1 - sa));
      return;                                            // alpha unchanged
    }
    if (op === "copy") { for (let k = 0; k < 3; k++) d[o + k] = s[k]; d[o + 3] = Math.round(sa * 255); return; }
    // source-over (and anything unrecognised)
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) d[o + k] = oa > 0 ? Math.round((s[k] * sa + d[o + k] * da * (1 - sa)) / oa) : 0;
    d[o + 3] = Math.round(oa * 255);
  }
  fillRect(x, y, w, h) {
    const a = this._p(x, y), b = this._p(x + w, y + h);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    for (let j = Math.max(0, Math.ceil(y0 - 0.5)); j < Math.min(this.canvas.height, Math.ceil(y1 - 0.5)); j++)
      for (let i = Math.max(0, Math.ceil(x0 - 0.5)); i < Math.min(this.canvas.width, Math.ceil(x1 - 0.5)); i++) this._plot(i, j);
  }
  clearRect(x, y, w, h) {
    const a = this._p(x, y), b = this._p(x + w, y + h), d = this._buf, W = this.canvas.width;
    for (let j = Math.max(0, Math.ceil(Math.min(a[1], b[1]) - 0.5)); j < Math.min(this.canvas.height, Math.ceil(Math.max(a[1], b[1]) - 0.5)); j++)
      for (let i = Math.max(0, Math.ceil(Math.min(a[0], b[0]) - 0.5)); i < Math.min(W, Math.ceil(Math.max(a[0], b[0]) - 0.5)); i++) {
        const o = (j * W + i) * 4; d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
      }
  }
  strokeRect() { this.ignored.strokeRect = (this.ignored.strokeRect || 0) + 1; }
  beginPath() { this._path = []; this._sub = null; }
  moveTo(x, y) { this._sub = [this._p(x, y)]; this._path.push(this._sub); }
  lineTo(x, y) { if (!this._sub) return this.moveTo(x, y); this._sub.push(this._p(x, y)); }
  closePath() { if (this._sub && this._sub.length) { const f = this._sub[0]; this._sub = [f.slice()]; this._path.push(this._sub); } }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(cx, cy, r, a0, a1, ccw) {
    let span = a1 - a0;
    if (ccw) span = -(((-span) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || -2 * Math.PI;
    const n = Math.max(8, Math.ceil(Math.abs(span) * 8));
    for (let k = 0; k <= n; k++) {
      const a = a0 + span * k / n, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!this._sub) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    const n = 32;
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * k / n, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      if (!this._sub) this.moveTo(x, y); else this.lineTo(x, y);
    }
  }
  quadraticCurveTo(cx, cy, x, y) { this.lineTo(x, y); }
  bezierCurveTo(a, b, c, d, x, y) { this.lineTo(x, y); }
  fill() {
    const polys = this._path.filter((p) => p.length >= 3);
    if (!polys.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const W = this.canvas.width, H = this.canvas.height;
    for (let j = Math.max(0, Math.floor(y0)); j <= Math.min(H - 1, Math.ceil(y1)); j++) {
      const py = j + 0.5;
      for (let i = Math.max(0, Math.floor(x0)); i <= Math.min(W - 1, Math.ceil(x1)); i++) {
        const px = i + 0.5;
        let wn = 0;
        for (const p of polys) for (let k = 0; k < p.length; k++) {
          const a = p[k], b = p[(k + 1) % p.length];
          if (a[1] <= py) { if (b[1] > py && (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]) > 0) wn++; }
          else if (b[1] <= py && (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]) < 0) wn--;
        }
        if (wn !== 0) this._plot(i, j);
      }
    }
  }
  stroke() { this.ignored.stroke = (this.ignored.stroke || 0) + 1; }
  clip() { this.ignored.clip = (this.ignored.clip || 0) + 1; }
  fillText() { this.ignored.fillText = (this.ignored.fillText || 0) + 1; }
  strokeText() { this.ignored.strokeText = (this.ignored.strokeText || 0) + 1; }
  measureText(t) { return { width: String(t).length * 6 }; }
  drawImage() { this.ignored.drawImage = (this.ignored.drawImage || 0) + 1; }
  createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }
  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4), d = this._buf, W = this.canvas.width;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= W || sy >= this.canvas.height) continue;
      const s = (sy * W + sx) * 4, o = (j * w + i) * 4;
      out[o] = d[s]; out[o + 1] = d[s + 1]; out[o + 2] = d[s + 2]; out[o + 3] = d[s + 3];
    }
    return { width: w, height: h, data: out };
  }
  putImageData(img, x, y) {
    const d = this._buf, W = this.canvas.width;
    for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
      const sx = x + i, sy = y + j;
      if (sx < 0 || sy < 0 || sx >= W || sy >= this.canvas.height) continue;
      const s = (j * img.width + i) * 4, o = (sy * W + sx) * 4;
      for (let k = 0; k < 4; k++) d[o + k] = img.data[s + k];
    }
  }
  setLineDash() {}
}

export class FakeCanvas {
  constructor() { this._w = 300; this._h = 150; this._buf = null; this._ctx = null; this.style = {}; }
  get width() { return this._w; } set width(v) { this._w = v | 0; this._buf = null; }
  get height() { return this._h; } set height(v) { this._h = v | 0; this._buf = null; }
  _data() { if (!this._buf) this._buf = new Uint8ClampedArray(this._w * this._h * 4); return this._buf; }
  getContext(kind) { if (kind !== "2d") return null; return this._ctx || (this._ctx = new Ctx2D(this)); }
  // alpha (0..255) at a texel, clamped to the canvas
  alphaAt(i, j) {
    i = Math.min(this._w - 1, Math.max(0, i | 0)); j = Math.min(this._h - 1, Math.max(0, j | 0));
    return this._data()[(j * this._w + i) * 4 + 3];
  }
  addEventListener() {} removeEventListener() {}
  toDataURL() { return "data:,"; }
}

export function fakeDocument() {
  const el = () => ({ style: {}, appendChild() {}, removeChild() {}, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } });
  return {
    createElement(tag) { return tag === "canvas" ? new FakeCanvas() : el(); },
    createElementNS(ns, tag) { return tag === "canvas" ? new FakeCanvas() : el(); },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, body: el(), head: el(), documentElement: el(),
  };
}
