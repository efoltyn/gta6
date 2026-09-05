/* ============================================================
   entities/heritage.js — WHO IS IN THIS PRISON.

   OWNER (2026-09-05): "i want different races in the jail game … black
   latino asian white (add tattoos especially for white nationalists) indian,
   etc etc".

   Before this file every inmate was one of 8 skin hexes and 8 hair hexes rolled
   independently, no facial hair, no ink, every face the same. A yard of men who
   differ only by tint is not a population; it is a palette. A real yard sorts
   itself by where people came from — the car you run with, the ink on your
   neck, the beard or the shaved head — and that is what this file authors:

     TEN HERITAGES, each a coherent look — a skin RANGE (not one hex), hair
     colour + style odds, facial-hair odds, tattoo odds + which INK SET, and
     how likely the man wears the jumpsuit tied at the waist over a tank top
     (the only way arm ink is ever seen).

   One roll (heritageRoll) produces a complete `look` that IS a character.js
   colour object — makeCharacter(look) builds the body, heritageApply(ch, look)
   stamps the head ink and the tags the wardrobe reads. No second rig, no
   second wardrobe: arm ink is painted INTO the shared clothes.js atlas
   (PAINT.inmate_tank, keyed by skin + ink set) and head ink is one small
   canvas multiplied under the head's own skin colour, so reactions.js's
   flash / gore's corpse tint / mugshot's skinTone read all keep working.

   THE INK. Prison tattoos are drawn as abstract blue-black marks at atlas
   resolution (64 px across a whole face) — bands, webs, script lines, dots,
   stars, tribal bands. The white-power crew ("skinhead") wears the HEAVIEST
   set: throat script, temple marks, a bolt behind the ear, a mark under the
   eye, a blackwork sleeve with the elbow web. None of it is a real-world hate
   symbol drawn to be legible; it is the silhouette of that ink culture, which
   is what reads at yard distance anyway.

   API
     CBZ.HERITAGE                    the catalogue (id -> def), CBZ.HERITAGE_IDS
     CBZ.heritageRoll(id?, rng?, o?) -> look (a makeCharacter colour object +
                                       {heritage, beard, bald, ink, tank})
     CBZ.heritageApply(ch, look)     stamp head ink + tags on a built rig
     CBZ.inkPaintArm(A, set, skinCss)   sleeve painter for clothes.js's atlas
     CBZ.heritageCensus()            live counts (preset metric)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;

  // ---- the catalogue -------------------------------------------------------
  // weight   share of the anonymous crowd (US state-prison shape, men only)
  // skins    the RANGE — every roll picks one, so brothers still differ
  // hair     colour pool; styles: weighted list of character.js HAIR_STYLES ids
  // bald     odds of a shaved head (no hair mesh at all)
  // beard    odds per facial-hair style (character.js c.beard)
  // ink      odds of tattoos at all; sets: which ink set when inked
  // tank     odds the jumpsuit top is tied at the waist over a tank (bare arms)
  const H = {
    black: { name: "Black", weight: 34,
      // the game's exposure lifts every tone ~a stop (a 0x25282d shoe reads
      // mid-grey), so the range starts darker than the hex suggests
      skins: [0x6b4a32, 0x5a3c28, 0x4a3020, 0x3c2618, 0x2e1c12, 0x7a5236],
      hair: [0x141010, 0x1a120c, 0x0d0b0a], styles: [["buzz", 5], ["short", 2], ["crop", 2]],
      bald: 0.18, beard: { full: 0.22, goatee: 0.28, stubble: 0.15 },
      ink: 0.45, sets: [["script", 3], ["chest", 2]], tank: 0.35 },
    white: { name: "White", weight: 26,
      skins: [0xf0c39a, 0xfae0c8, 0xe8b58c, 0xe8c39a, 0xf5d3b3, 0xd9b08e],
      hair: [0x4a3526, 0x2a2018, 0x7a4a2e, 0xb08a4a, 0xa3401f, 0x8c7a68], styles: [["short", 4], ["crop", 3], ["buzz", 3], ["long", 1]],
      bald: 0.12, beard: { full: 0.20, goatee: 0.18, stubble: 0.22, moustache: 0.06 },
      ink: 0.35, sets: [["script", 2], ["web", 2]], tank: 0.30 },
    skinhead: { name: "White-power crew", weight: 8,
      skins: [0xf5d3b3, 0xfae0c8, 0xf0c39a, 0xecc6a3],
      hair: [0x8c7a68, 0x7a4a2e, 0x4a3526], styles: [["buzz", 1]],
      bald: 0.65, beard: { goatee: 0.35, stubble: 0.30 },
      ink: 1.0, sets: [["skinhead", 1]], tank: 0.85 },
    latino: { name: "Latino", weight: 22,
      skins: [0xc08a5a, 0xd8a177, 0xb5825a, 0xb67b52, 0xa87049, 0xd9a983],
      hair: [0x101820, 0x1a120c, 0x0d0b0a], styles: [["buzz", 5], ["short", 2], ["crop", 2]],
      bald: 0.28, beard: { goatee: 0.35, moustache: 0.18, stubble: 0.20 },
      ink: 0.80, sets: [["chicano", 4], ["script", 1], ["teardrop", 1]], tank: 0.60 },
    eastasian: { name: "East Asian", weight: 5,
      skins: [0xf0d0a8, 0xe8c39a, 0xd9b08e, 0xf5d3b3],
      hair: [0x0d0b0a, 0x101820], styles: [["short", 3], ["crop", 3], ["buzz", 2]],
      bald: 0.05, beard: { stubble: 0.12, goatee: 0.08 },
      ink: 0.30, sets: [["sleeve", 1]], tank: 0.25 },
    southasian: { name: "South Asian (Indian)", weight: 4,
      skins: [0x9c6a45, 0x8a5a3a, 0xb5825a, 0x7a4a2e, 0xa87049],
      hair: [0x0d0b0a, 0x141010], styles: [["short", 4], ["crop", 2], ["buzz", 2]],
      bald: 0.10, beard: { full: 0.40, stubble: 0.30, moustache: 0.15 },
      ink: 0.15, sets: [["script", 1]], tank: 0.20 },
    mideast: { name: "Middle Eastern", weight: 4,
      skins: [0xd0b08a, 0xc9a27a, 0xb58a62, 0xdcb691],
      hair: [0x0d0b0a, 0x1a120c], styles: [["short", 4], ["crop", 2], ["buzz", 2]],
      bald: 0.15, beard: { full: 0.50, stubble: 0.30 },
      ink: 0.10, sets: [["script", 1]], tank: 0.15 },
    native: { name: "Native American", weight: 4,
      skins: [0xb06f48, 0x9c5f3c, 0xc4835a, 0xa8683f],
      hair: [0x0d0b0a, 0x141010], styles: [["long", 4], ["pony", 3], ["short", 2]],
      bald: 0.04, beard: { stubble: 0.10 },
      ink: 0.35, sets: [["chest", 2], ["script", 1]], tank: 0.30 },
    islander: { name: "Pacific Islander", weight: 4,
      skins: [0x8a5a3a, 0x9c6a45, 0x7a4a2e, 0xa87049],
      hair: [0x0d0b0a, 0x141010], styles: [["buzz", 3], ["short", 3], ["crop", 2], ["bun", 1]],
      bald: 0.12, beard: { goatee: 0.30, full: 0.20, stubble: 0.20 },
      ink: 0.85, sets: [["tribal", 1]], tank: 0.70 },
    easteuro: { name: "Eastern European", weight: 6,
      skins: [0xf0c39a, 0xfae0c8, 0xe8b58c, 0xecc6a3],
      hair: [0x4a3526, 0x2a2018, 0x8c7a68, 0xb08a4a], styles: [["buzz", 5], ["short", 2]],
      bald: 0.30, beard: { stubble: 0.35, goatee: 0.10 },
      ink: 0.75, sets: [["vory", 1]], tank: 0.55 },
  };
  const IDS = Object.keys(H);
  let totalW = 0;
  for (let i = 0; i < IDS.length; i++) totalW += H[IDS[i]].weight;

  // ---- rolling -------------------------------------------------------------
  function pickW(list, r) {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += list[i][1];
    let x = r * t;
    for (let i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function pick(list, r) { return list[Math.min(list.length - 1, (r * list.length) | 0)]; }
  function rollId(r) {
    let x = r * totalW;
    for (let i = 0; i < IDS.length; i++) { x -= H[IDS[i]].weight; if (x <= 0) return IDS[i]; }
    return IDS[IDS.length - 1];
  }
  // a deterministic rng from a name, so a named man looks the same every boot
  function seeded(str) {
    let s = 0x9e3779b9;
    for (let i = 0; i < str.length; i++) s = (Math.imul(s ^ str.charCodeAt(i), 0x01000193) >>> 0) || 1;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  // hair colour read as a scalp: a shaved head is skin, not a black cap
  function heritageRoll(id, rng, over) {
    const r = typeof rng === "function" ? rng : (typeof rng === "string" ? seeded(rng) : Math.random);
    if (!id || !H[id]) id = rollId(r());
    const d = H[id];
    const look = {
      heritage: id,
      skin: pick(d.skins, r()),
      hair: pick(d.hair, r()),
      hairStyle: pickW(d.styles, r()),
      bald: r() < d.bald,
      beard: null, ink: "", tank: false,
    };
    // facial hair: one style at most, odds independent per style, first hit wins
    const bk = Object.keys(d.beard);
    for (let i = 0; i < bk.length; i++) if (r() < d.beard[bk[i]]) { look.beard = bk[i]; break; }
    if (r() < d.ink) look.ink = pickW(d.sets, r());
    look.tank = r() < d.tank;
    if (over) Object.assign(look, over);
    return look;
  }

  // ---- HEAD INK: one small atlas under the skin colour ----------------------
  // atlas 128x64: front [0,64) · side [64,96) (both sides, mirrored) · back [96,128)
  // Drawn WHITE with grey-blue ink, so material.color (the skin) multiplies
  // through: white*skin = skin, ink*skin = dark ink. Nothing downstream that
  // reads or resets the head's colour has to know a texture exists.
  const HW = 128, HH = 64;
  const HCOL = { front: [0, 64], side: [64, 96], back: [96, 128] };
  const HFACE = ["side", "side", "back", "back", "front", "back"];   // +x -x +y -y +z -z
  const headGeoCache = Object.create(null);
  function headInkGeom(size) {
    const key = size.toFixed(3);
    let g = headGeoCache[key];
    if (g) return g;
    g = new THREE.BoxGeometry(size, size, size);
    const uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const col = HCOL[HFACE[f]];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v, u = uv.getX(i), vv = uv.getY(i);
        // top/bottom faces land on a plain 8x8 corner of the back column
        if (f === 2 || f === 3) uv.setXY(i, (col[0] + 2 + u * 6) / HW, 1 - (2 + (1 - vv) * 6) / HH);
        else uv.setXY(i, (col[0] + u * (col[1] - col[0])) / HW, vv);
      }
    }
    uv.needsUpdate = true;
    g._shared = true;
    headGeoCache[key] = g;
    return g;
  }
  // Under the game's own exposure a 0x25282d shoe reads as mid grey, so ink
  // has to start near black to end up as ink (measured on the first lineup run).
  const INK = "rgba(16,20,28,0.94)", INK2 = "rgba(16,20,28,0.62)";
  function headPainter(ctx) {
    function R(col, x, y, w, h, c) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      ctx.fillStyle = c || INK; ctx.fillRect(cc[0] + x * cw, y * HH, Math.max(1, w * cw), Math.max(1, h * HH));
    }
    function P(col, pts, c) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      ctx.fillStyle = c || INK; ctx.beginPath();
      for (let i = 0; i < pts.length; i++) { const px = cc[0] + pts[i][0] * cw, py = pts[i][1] * HH; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); ctx.fill();
    }
    function D(col, x, y, r, c) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      ctx.fillStyle = c || INK; ctx.beginPath(); ctx.arc(cc[0] + x * cw, y * HH, Math.max(1, r * cw), 0, 6.2832); ctx.fill();
    }
    // a "script" line: a wavy band that reads as cursive at 64 px
    function script(col, x0, x1, y, amp, c) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      ctx.strokeStyle = c || INK; ctx.lineWidth = 1.4; ctx.beginPath();
      for (let x = x0; x <= x1; x += 0.02) {
        const px = cc[0] + x * cw, py = y * HH + Math.sin(x * 55) * amp * HH;
        if (x === x0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    function star(col, x, y, r) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      const cx = cc[0] + x * cw, cy = y * HH, rr = r * cw;
      ctx.fillStyle = INK; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i & 1 ? rr * 0.42 : rr; ctx.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); }
      ctx.closePath(); ctx.fill();
    }
    function web(col, x, y, r) {
      const cc = HCOL[col], cw = cc[1] - cc[0];
      const cx = cc[0] + x * cw, cy = y * HH, rr = r * cw;
      ctx.strokeStyle = INK2; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      for (let k = 1; k <= 3; k++) { const q = rr * k / 3; ctx.moveTo(cx + q, cy); for (let i = 1; i <= 8; i++) { const a = i * Math.PI / 4; ctx.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } }
      ctx.stroke();
    }
    return { R, P, D, script, star, web };
  }
  // the head sets. Atlas y: 0 = crown, 1 = chin. The face's eyes sit near
  // y≈0.43, mouth y≈0.73 (character.js: eye 0.34/0.60 from the bottom, mouth 0.16).
  const HEAD_INK = {
    script: function (p) { p.script("front", 0.12, 0.88, 0.93, 0.02); },
    teardrop: function (p) { p.D("front", 0.30, 0.56, 0.028); p.P("front", [[0.30, 0.50], [0.27, 0.56], [0.33, 0.56]]); },
    chicano: function (p) {
      p.script("front", 0.10, 0.90, 0.93, 0.02);                          // throat script
      p.D("front", 0.72, 0.52, 0.02); p.D("front", 0.76, 0.56, 0.02); p.D("front", 0.68, 0.56, 0.02);   // three dots
      p.script("side", 0.15, 0.85, 0.90, 0.015);                          // script round the neck
    },
    web: function (p) { p.web("side", 0.5, 0.86, 0.34); },
    vory: function (p) { p.star("side", 0.5, 0.84, 0.22); p.D("front", 0.40, 0.94, 0.018); p.D("front", 0.60, 0.94, 0.018); },
    tribal: function (p) {
      p.P("side", [[0, 0.80], [1, 0.74], [1, 0.84], [0, 0.90]]); p.P("side", [[0, 0.93], [1, 0.88], [1, 0.96], [0, 1]]);
      p.P("back", [[0.2, 0.78], [0.8, 0.78], [0.62, 1], [0.38, 1]]);
    },
    skinhead: function (p) {
      p.R("front", 0.08, 0.86, 0.84, 0.10);                               // solid throat band (script block)
      p.script("front", 0.10, 0.90, 0.91, 0.02, "rgba(255,255,255,0.28)");
      p.P("front", [[0.31, 0.50], [0.27, 0.58], [0.34, 0.58]]);           // mark under the eye
      p.P("side", [[0.40, 0.30], [0.60, 0.30], [0.50, 0.46], [0.66, 0.46], [0.42, 0.68], [0.50, 0.50], [0.34, 0.50]]);   // the bolt behind the ear
      p.R("side", 0.12, 0.14, 0.30, 0.05); p.R("side", 0.12, 0.22, 0.30, 0.05);   // temple bars
      p.R("back", 0.25, 0.70, 0.50, 0.08); p.P("back", [[0.5, 0.40], [0.68, 0.70], [0.32, 0.70]]);   // nape crest
      p.web("side", 0.5, 0.90, 0.30);
    },
    chest: function () {}, sleeve: function () {},
  };
  function headInkCanvas(set) {
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas"); cv.width = HW; cv.height = HH;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, HW, HH);
    const fn = HEAD_INK[set];
    if (fn) fn(headPainter(ctx));
    return cv;
  }
  const headTexCache = Object.create(null);
  function headInkTex(set) {
    let t = headTexCache[set];
    if (t) return t;
    const cv = headInkCanvas(set);
    if (!cv) return null;
    t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.LinearFilter;
    t._shared = true;
    headTexCache[set] = t;
    return t;
  }

  // ---- ARM INK: painted into the clothes.js sleeve row ----------------------
  // A is clothes.js's rowPainter for the arm row (rect/poly/dot in 0-1 of a
  // column; y 0 = shoulder, 1 = wrist; the elbow is ~0.5). skinCss is the
  // wearer's tone as css. Only bare-arm garments call this.
  function inkPaintArm(A, set, skinCss) {
    const cols = ["front", "back", "side"];
    const band = (y, h, c) => { for (const k of cols) A.rect(k, 0, y, 1, h, c || INK); };
    const webAt = (k, cx, cy, r) => {
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; A.poly(k, [[cx, cy], [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6], [cx + Math.cos(a + 0.12) * r, cy + Math.sin(a + 0.12) * r * 0.6]], INK2); }
      for (let q = 1; q <= 3; q++) { const rr = r * q / 3; A.rect(k, cx - rr, cy - rr * 0.6, rr * 2, 0.012, INK2); A.rect(k, cx - rr, cy + rr * 0.6, rr * 2, 0.012, INK2); }
    };
    const scriptDown = (k, x, y0, y1) => { for (let y = y0; y < y1; y += 0.06) A.rect(k, x + (((y * 37) | 0) % 3) * 0.05, y, 0.16, 0.025, INK); };
    const star = (k, cx, cy, r) => { A.poly(k, [[cx, cy - r], [cx + r * 0.3, cy - r * 0.3], [cx + r, cy], [cx + r * 0.3, cy + r * 0.3], [cx, cy + r], [cx - r * 0.3, cy + r * 0.3], [cx - r, cy], [cx - r * 0.3, cy - r * 0.3]], INK); };
    switch (set) {
      case "skinhead":                                                    // full blackwork sleeve
        band(0.04, 0.09); band(0.17, 0.05); band(0.26, 0.12); band(0.62, 0.05); band(0.72, 0.16);
        for (const k of cols) { webAt(k, 0.5, 0.49, 0.42); A.rect(k, 0.30, 0.90, 0.40, 0.05, INK); }
        break;
      case "chicano":                                                     // fine script down the forearm, one motif high
        for (const k of ["front", "side"]) scriptDown(k, 0.30, 0.56, 0.94);
        A.poly("front", [[0.5, 0.10], [0.72, 0.24], [0.5, 0.38], [0.28, 0.24]], INK2);
        A.rect("back", 0.2, 0.62, 0.6, 0.03, INK); A.rect("back", 0.2, 0.70, 0.6, 0.03, INK);
        break;
      case "tribal":                                                      // Polynesian bands, thick and curved
        for (const k of cols) {
          A.poly(k, [[0, 0.06], [1, 0.02], [1, 0.14], [0, 0.20]]); A.poly(k, [[0, 0.26], [1, 0.22], [1, 0.30], [0, 0.36]]);
          A.poly(k, [[0.5, 0.40], [1, 0.36], [1, 0.46], [0.5, 0.52], [0, 0.46], [0, 0.36]], INK2);
          A.poly(k, [[0, 0.66], [1, 0.60], [1, 0.72], [0, 0.80]]); A.poly(k, [[0, 0.86], [1, 0.82], [1, 0.90], [0, 0.94]], INK2);
        }
        break;
      case "vory":                                                        // stars at the shoulder, rings on the forearm
        for (const k of cols) star(k, 0.5, 0.14, 0.34);
        band(0.60, 0.03); band(0.66, 0.03); band(0.84, 0.03);
        A.rect("front", 0.35, 0.72, 0.30, 0.08, INK2);
        break;
      case "sleeve":                                                      // dense wave pattern: the irezumi read
        for (let y = 0.08; y < 0.92; y += 0.10) for (const k of cols) { A.rect(k, 0, y, 1, 0.045, INK2); A.rect(k, (y * 7) % 0.6, y + 0.045, 0.35, 0.03, INK); }
        break;
      case "web": for (const k of cols) webAt(k, 0.5, 0.50, 0.40); break;
      case "script": scriptDown("front", 0.34, 0.58, 0.92); break;
      case "chest": case "teardrop": default: break;                    // nothing on the arm
    }
  }

  // ---- apply to a built rig ------------------------------------------------
  function heritageApply(ch, look) {
    if (!ch || !look) return false;
    ch.heritage = look.heritage || null;
    ch.ink = look.ink || "";
    ch.beardStyle = look.beard || null;
    const head = ch.skinSlots && ch.skinSlots.head && ch.skinSlots.head[0];
    if (head && look.ink && HEAD_INK[look.ink] && head.material && !head.material.map) {
      const tex = headInkTex(look.ink);
      if (tex) {
        const size = head.geometry && head.geometry.parameters ? head.geometry.parameters.width : 0.6;
        head.geometry = headInkGeom(size);
        head.material.map = tex;
        head.material.needsUpdate = true;
      }
    }
    return true;
  }

  function heritageCensus(list) {
    const rows = list || (CBZ.npcs || []).map((n) => n && n.char);
    const out = { actors: 0, byHeritage: {}, inked: 0, bearded: 0, bald: 0, tank: 0, skins: {} };
    for (let i = 0; i < rows.length; i++) {
      const ch = rows[i]; if (!ch) continue;
      out.actors++;
      if (ch.heritage) out.byHeritage[ch.heritage] = (out.byHeritage[ch.heritage] || 0) + 1;
      if (ch.ink) out.inked++;
      if (ch.beardStyle) out.bearded++;
      if (ch.skinSlots && ch.skinSlots.hair && !ch.skinSlots.hair.length && !(ch.skinSlots.cap && ch.skinSlots.cap.length)) out.bald++;
      if (ch._prisonOutfitKey === "inmate_tank") out.tank++;
      if (ch.skinTone != null) out.skins[ch.skinTone] = 1;
    }
    out.distinctSkins = Object.keys(out.skins).length;
    delete out.skins;
    return out;
  }

  CBZ.HERITAGE = H;
  CBZ.HERITAGE_IDS = IDS;
  CBZ.heritageRoll = heritageRoll;
  CBZ.heritageApply = heritageApply;
  CBZ.heritageSeeded = seeded;
  CBZ.inkPaintArm = inkPaintArm;
  CBZ.headInkCanvas = headInkCanvas;
  CBZ.heritageCensus = heritageCensus;
})();
