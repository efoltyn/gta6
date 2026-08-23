/* tools/lib/pngjoin.mjs — STITCH TWO SCREENSHOTS INTO ONE IMAGE.

   WHY THIS EXISTS. The before/after tool's whole output was built for a person
   with a screen: an HTML contact sheet and a PDF, both of which put the two
   sides next to each other so your eye can do the comparison in one saccade.
   Its two most frequent callers cannot open either one. A CI job can't. And an
   AGENT — which is now the main way this repo gets changed, and the reason
   `before-after.mjs` grew a measurements table on stdout at all — can read a
   PNG but cannot render a report.

   An agent CAN look at two separate PNGs. It is much worse at it than at
   looking at one image with the two halves side by side and a label on each,
   for the same reason you are: comparison is a spatial operation and paging
   between two files destroys the spatial relationship. So: one file, before on
   the left, after on the right, a divider, and a caption bar naming which is
   which. That single image is what gets handed to the vision model.

   WHY IT IS WRITTEN OUT LONGHAND. `sharp`/`jimp`/`canvas` are all native or
   heavy, and this repo's visual pipeline deliberately has NO npm dependency
   for imaging — visual-compare.mjs drives Chromium over raw CDP rather than
   pulling in Playwright. Adding a native module to the dependency tree so a
   wrapper can paste two bitmaps together would be a bad trade. PNG is a
   simple enough container that decode-and-re-encode of the exact subset
   Chromium emits (8-bit RGB/RGBA, non-interlaced) is ~150 lines of zlib.

   Scope, honestly: it handles what our capture path produces and nothing
   else. Interlaced, 16-bit and palette PNGs throw rather than silently
   producing garbage — a wrong picture is worse here than no picture. */

import { inflateSync, deflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crcTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---- decode ------------------------------------------------------------- */

/** PNG buffer -> { width, height, data } where data is tightly packed RGBA. */
export function decodePNG(buf) {
  if (!buf.slice(0, 8).equals(SIG)) throw new Error("not a PNG");
  let off = 8, width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported PNG bit depth ${depth} (need 8)`);
  if (interlace) throw new Error("unsupported interlaced PNG");
  if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG color type ${colorType} (need 2 or 6)`);

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  // Un-filter, one scanline at a time. Filters are defined against the byte
  // `channels` back (a), the byte above (b) and above-left (c); the first
  // scanline and the first pixel of every line treat those as zero.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }
  return { width, height, data: out };
}

/* ---- encode ------------------------------------------------------------- */

function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, body])), 0);
  return Buffer.concat([len, t, body, crc]);
}

/** { width, height, data } (RGBA) -> PNG buffer. Filter 0; zlib does the work. */
export function encodePNG(img) {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG, chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---- the actual job ----------------------------------------------------- */

function blank(w, h, rgb) {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    const from = y * src.width * 4;
    const w = Math.min(src.width, dst.width - dx);
    if (w <= 0) continue;
    src.data.copy(dst.data, (ty * dst.width + dx) * 4, from, from + w * 4);
  }
}

/* A 5x7 bitmap alphabet, because the caption has to say BEFORE and AFTER and
   pulling a font renderer in for eleven glyphs would be absurd. Only the
   characters the captions actually use are defined; anything else draws as a
   blank cell rather than throwing, so a caller can pass a subject id through
   without sanitising it. */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(img, text, x0, y0, scale, rgb) {
  let x = x0;
  for (const raw of String(text).toUpperCase()) {
    const rows = GLYPHS[raw] || GLYPHS[" "];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (rows[gy][gx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = x + gx * scale + sx, py = y0 + gy * scale + sy;
            if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
            const d = (py * img.width + px) * 4;
            img.data[d] = rgb[0]; img.data[d + 1] = rgb[1]; img.data[d + 2] = rgb[2]; img.data[d + 3] = 255;
          }
        }
      }
    }
    x += 6 * scale;
  }
}

/** Stitch N PNG buffers into ONE labelled horizontal strip — the storyboard
    shape (the tsunami pages' "t+0s · t+40s · t+90s" row). frames is
    [{ buf, label }] in display order; labels draw in the bar above each cell.
    Same cell law as joinPNGs below: different sizes top-left align in a
    common cell, never rescale — a viewport drift IS a finding. */
export function stripPNGs(frames, opts = {}) {
  const BAR = 26, GAP = 8, PAD = 6;
  const INK = [235, 238, 242], BG = [16, 19, 24], RULE = [70, 78, 90];
  const imgs = frames.map((f) => ({ img: decodePNG(f.buf), label: f.label || "" }));
  if (!imgs.length) throw new Error("stripPNGs: no frames");
  const cellW = Math.max(...imgs.map((f) => f.img.width));
  const cellH = Math.max(...imgs.map((f) => f.img.height));
  const W = PAD * 2 + cellW * imgs.length + GAP * (imgs.length - 1);
  const H = PAD * 2 + BAR + cellH;
  const out = blank(W, H, BG);
  for (let i = 0; i < imgs.length; i++) {
    const x0 = PAD + i * (cellW + GAP);
    blit(out, imgs[i].img, x0, PAD + BAR);
    drawText(out, imgs[i].label.slice(0, Math.floor(cellW / 12)), x0 + 2, PAD + 6, 2, INK);
    if (i) {
      for (let y = PAD + BAR; y < H - PAD; y++) {
        for (let x = x0 - GAP + 1; x < x0 - 1; x++) {
          const d = (y * W + x) * 4;
          out.data[d] = RULE[0]; out.data[d + 1] = RULE[1]; out.data[d + 2] = RULE[2];
        }
      }
    }
  }
  if (opts.title) {
    const tw = String(opts.title).length * 12;
    drawText(out, opts.title, Math.max(PAD, W - PAD - tw), PAD + 6, 2, INK);
  }
  return encodePNG(out);
}

/** Stitch two PNG buffers into one labelled side-by-side PNG buffer.
    Different-sized sides are allowed and are top-left aligned in a common
    cell — a viewport change between the two builds is itself a finding, and
    silently rescaling one side to match would hide it. */
export function joinPNGs(beforeBuf, afterBuf, opts = {}) {
  const BAR = 26, GAP = 8, PAD = 6;
  const INK = [235, 238, 242], BG = [16, 19, 24], RULE = [70, 78, 90];
  const b = beforeBuf ? decodePNG(beforeBuf) : null;
  const a = afterBuf ? decodePNG(afterBuf) : null;
  if (!b && !a) throw new Error("joinPNGs: both sides missing");
  const cellW = Math.max(b ? b.width : 0, a ? a.width : 0);
  const cellH = Math.max(b ? b.height : 0, a ? a.height : 0);
  const W = PAD * 2 + cellW * 2 + GAP;
  const H = PAD * 2 + BAR + cellH;
  const out = blank(W, H, BG);

  if (b) blit(out, b, PAD, PAD + BAR);
  if (a) blit(out, a, PAD + cellW + GAP, PAD + BAR);

  // the divider, so the eye lands on the seam and not on a picture edge
  for (let y = PAD + BAR; y < H - PAD; y++) {
    for (let x = PAD + cellW + 1; x < PAD + cellW + GAP - 1; x++) {
      const d = (y * W + x) * 4;
      out.data[d] = RULE[0]; out.data[d + 1] = RULE[1]; out.data[d + 2] = RULE[2];
    }
  }
  const left = "BEFORE" + (opts.beforeLabel ? "  " + opts.beforeLabel : "");
  const right = "AFTER" + (opts.afterLabel ? "  " + opts.afterLabel : "");
  drawText(out, left, PAD + 2, PAD + 6, 2, INK);
  drawText(out, right, PAD + cellW + GAP + 2, PAD + 6, 2, INK);
  if (opts.title) {
    const tw = String(opts.title).length * 12;
    drawText(out, opts.title, Math.max(PAD, W - PAD - tw), PAD + 6, 2, INK);
  }
  return encodePNG(out);
}
