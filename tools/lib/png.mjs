/* tools/lib/png.mjs — write a PNG with nothing but node's own zlib.

   The App Store needs a 1024×1024 icon and a 2732×2732 splash, and this repo
   has no image library, no canvas and no network dependency worth adding for
   two files. A PNG is a signature, three chunks and a zlib stream, so it is
   about forty lines: filter byte 0 on every row, deflate, CRC each chunk.

     writePng("icon.png", 1024, 1024, (x, y) => [r, g, b, a]);   // 0-255

   Nothing here is clever and nothing here is fast. It is correct, which is
   what an app icon needs. */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* pixel(x, y) returns [r, g, b] or [r, g, b, a]; a defaults to 255 (opaque —
   an iOS app icon may not have transparency at all). */
export function encodePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                                   // filter: none
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0] | 0; raw[o++] = p[1] | 0; raw[o++] = p[2] | 0;
      raw[o++] = p[3] == null ? 255 : p[3] | 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 6;        // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writePng(file, w, h, pixel) {
  const buf = encodePng(w, h, pixel);
  writeFileSync(file, buf);
  return buf.length;
}
