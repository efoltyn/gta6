"use strict";
/* src/battle/arenas/yard.js — NPC War: MAPS + THE YARD (the kill box).
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ MAPS
   Each ground answers the same three questions: height, where RED stands,
   where BLUE stands. The kill box registers its crates as real colliders,
   which is all it takes for combat_iq to treat them as cover and for
   segmentBlocked to treat them as walls. */
/* ============================================================ THE YARD
   THE KILL BOX WAS SLOP, EVEN AFTER ITS FIRST FIX. It had a canvas texture,
   but the "containers" were boxes of RANDOM size (2.4-6.8 m long, 1.9-2.5 m
   tall, 1.6-4.2 m deep) with ribs painted on and the texture cloned per
   face, the "timber crates" were 6 m planks of wood the height of a table,
   and the walls were 2 m thick slabs of grey. Nothing in it was a thing.

   It is a container yard now, and every object is the real article at its
   real size:
     - ISO containers, 20 ft (6.06 m) and 40 ft (12.19 m), 2.44 m wide and
       2.59 m tall, stacked square on their castings. The sides are REAL
       corrugation (a trapezoid sheet in the geometry, so the sun rakes the
       ribs), with corner posts, top and bottom rails, eight corner
       castings, a door end with four locking bars and their handles, and a
       painted, faded, rust-streaked skin. Rows run in lines like a yard.
     - precast concrete "lego" blocks for the perimeter (1.6 x 0.8 x 0.8 m,
       running bond, chamfered edges, the two lifting knobs on the top
       course), which is what a yard is actually walled with.
     - jersey barriers (the real F-shape profile) and timber crates on
       pallets for the low cover in between.
   Surfaces are canvas textures WITH normal maps derived from their own
   height fields, tiled at world scale, plus one shared world-space shader
   patch (macro mottle so the tiling never shows, and grime where things
   meet the ground). Everything of one material is ONE merged mesh. */
const TEX = {};
let _tr = 90127;            // the paint has its own dice, so the director's lcg() stream is untouched
function trand() { _tr = (_tr * 1103515245 + 12345) & 0x7fffffff; return _tr / 0x7fffffff; }
function cvs(S, H) { const c = document.createElement("canvas"); c.width = S; c.height = H || S; return c; }
function wrapTex(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  return t;
}
/* a tangent-space normal map from a grey height canvas (white = high).
   Canvas y runs DOWN and texture v runs UP (flipY), hence the sign on ny. */
function normalFromHeight(hc, strength) {
  const S = hc.width, H = hc.height;
  const src = hc.getContext("2d").getImageData(0, 0, S, H).data;
  const out = cvs(S, H), og = out.getContext("2d"), img = og.createImageData(S, H), d = img.data;
  const h = function (x, y) { x = (x + S) % S; y = (y + H) % H; return src[(y * S + x) * 4] / 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
    let nx = -(h(x + 1, y) - h(x - 1, y)) * strength;
    let ny = (h(x, y + 1) - h(x, y - 1)) * strength;
    const l = Math.sqrt(nx * nx + ny * ny + 1);
    const i = (y * S + x) * 4;
    d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}
// colour + normal from one pair of draw calls, cached by key
function texPair(key, S, drawColor, drawHeight, strength) {
  if (TEX[key]) return TEX[key];
  const c = cvs(S); drawColor(c.getContext("2d"), S);
  const out = { map: wrapTex(c, true), normalMap: null };
  if (drawHeight) {
    const h = cvs(S); drawHeight(h.getContext("2d"), S);
    out.normalMap = wrapTex(normalFromHeight(h, strength || 2), false);
  }
  return (TEX[key] = out);
}
function speckle(g, S, n, a, dark, maxS) {
  for (let i = 0; i < n; i++) {
    const v = dark ? 0 : 255;
    g.fillStyle = "rgba(" + v + "," + v + "," + v + "," + (trand() * a) + ")";
    const s = 1 + trand() * (maxS || 2.5);
    g.fillRect(trand() * S, trand() * S, s, s);
  }
}
function blotches(g, S, n, r0, r1, rgba0) {
  for (let i = 0; i < n; i++) {
    const x = trand() * S, y = trand() * S, r = r0 + trand() * (r1 - r0);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba0(trand())); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    // wrap the blotch so the tile has no seam
    for (let ox = -S; ox <= S; ox += S) for (let oy = -S; oy <= S; oy += S) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
  }
}
/* POURED SLAB: 512 px = 8 m. Saw-cut joints every 4 m, broom finish,
   aggregate, oil and tyre stains, patch repairs. */
function slabTex() {
  return texPair("slab", 512, function (g, S) {
    g.fillStyle = "#8b867c"; g.fillRect(0, 0, S, S);
    blotches(g, S, 36, 20, 110, function (k) { return k < 0.7 ? "rgba(40,36,30,0.14)" : "rgba(255,250,240,0.09)"; });
    blotches(g, S, 6, 10, 34, function () { return "rgba(22,20,18,0.30)"; });     // oil drips where trucks stood
    for (let y = 0; y < S; y += 2) {                                               // broom finish
      g.fillStyle = "rgba(0,0,0," + (0.015 + trand() * 0.03) + ")"; g.fillRect(0, y, S, 1);
    }
    speckle(g, S, 6000, 0.2, true); speckle(g, S, 3500, 0.14, false);
    for (let k = 0; k < 2; k++) {                                                  // tyre tracks
      const y0 = trand() * S; g.strokeStyle = "rgba(25,22,20,0.07)"; g.lineWidth = 14;
      g.beginPath(); g.moveTo(0, y0); g.bezierCurveTo(S * 0.3, y0 + 40, S * 0.7, y0 - 40, S, y0); g.stroke();
    }
    g.fillStyle = "rgba(20,19,17,0.6)";                                            // joints
    for (let k = 0; k < 2; k++) { g.fillRect(k * S / 2, 0, 2, S); g.fillRect(0, k * S / 2, S, 2); }
    g.strokeStyle = "rgba(30,28,24,0.35)"; g.lineWidth = 1;                         // hairline cracks off the joints
    for (let i = 0; i < 5; i++) {
      let x = trand() * S, y = (trand() < 0.5 ? 0 : S / 2) + 1; g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (trand() - 0.5) * 18; y += 6 + trand() * 10; g.lineTo(x, y); }
      g.stroke();
    }
  }, function (g, S) {
    g.fillStyle = "#808080"; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) { g.fillStyle = "rgba(0,0,0," + (0.03 + trand() * 0.05) + ")"; g.fillRect(0, y, S, 1); }
    speckle(g, S, 2500, 0.35, true, 2); speckle(g, S, 1500, 0.25, false, 2);
    g.fillStyle = "#1a1a1a";
    for (let k = 0; k < 2; k++) { g.fillRect(k * S / 2 - 1, 0, 3, S); g.fillRect(0, k * S / 2 - 1, S, 3); }
  }, 2.5);
}
/* PRECAST CONCRETE: 512 px = 2 m. Form-face concrete, bug holes (the air
   pockets every cast face has), rain runs and a pale laitance. */
function precastTex() {
  return texPair("precast", 512, function (g, S) {
    g.fillStyle = "#9a968c"; g.fillRect(0, 0, S, S);
    blotches(g, S, 30, 30, 120, function (k) { return k < 0.6 ? "rgba(60,56,48,0.12)" : "rgba(255,252,244,0.10)"; });
    for (let i = 0; i < 14; i++) {                    // rain runs
      const x = trand() * S, w = 4 + trand() * 16, gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, "rgba(40,36,30,0.16)"); gr.addColorStop(1, "rgba(40,36,30,0)");
      g.fillStyle = gr; g.fillRect(x, 0, w, S * (0.4 + trand() * 0.6));
    }
    speckle(g, S, 5000, 0.16, true); speckle(g, S, 3000, 0.12, false);
    _tr = 90127 + 17;                                 // the height pass rolls the same dice for the holes
    for (let i = 0; i < 260; i++) {                   // bug holes
      const x = trand() * S, y = trand() * S, r = 0.8 + trand() * 2.6;
      g.fillStyle = "rgba(38,35,30,0.75)"; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
  }, function (g, S) {
    g.fillStyle = "#808080"; g.fillRect(0, 0, S, S);
    speckle(g, S, 3000, 0.25, true, 2); speckle(g, S, 2000, 0.2, false, 2);
    _tr = 90127 + 17;                                 // same dice as the colour pass: the holes line up
    for (let i = 0; i < 260; i++) {
      const x = trand() * S, y = trand() * S, r = 0.8 + trand() * 2.6;
      g.fillStyle = "#222"; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }
  }, 3);
}
/* SAWN PINE: 256 px = 1.2 m, six 200 mm boards, grain, knots, nail heads. */
function pineTex() {
  return texPair("pine", 256, function (g, S) {
    g.fillStyle = "#a5835a"; g.fillRect(0, 0, S, S);
    const B = S / 6;
    for (let y = 0; y < S; y += B) {
      const k = trand();
      g.fillStyle = k < 0.5 ? "rgba(255,236,200," + (0.04 + trand() * 0.1) + ")" : "rgba(60,38,16," + (0.05 + trand() * 0.12) + ")";
      g.fillRect(0, y, S, B);
    }
    for (let i = 0; i < 140; i++) {
      g.strokeStyle = "rgba(70,44,18," + (0.06 + trand() * 0.12) + ")"; g.lineWidth = 1;
      const y = trand() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + 2 + trand() * 3, S * 0.6, y - 3, S, y); g.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = trand() * S, y = trand() * S;
      g.fillStyle = "rgba(80,48,20,0.55)"; g.beginPath(); g.ellipse(x, y, 4 + trand() * 3, 2 + trand() * 2, 0, 0, 6.283); g.fill();
    }
    blotches(g, S, 8, 20, 60, function () { return "rgba(70,72,66,0.18)"; });     // weathering to silver-grey
    g.fillStyle = "rgba(30,20,10,0.75)";
    for (let y = 0; y < S; y += B) g.fillRect(0, y, S, 2);                         // board gaps
    g.fillStyle = "rgba(40,40,44,0.8)";
    for (let y = 0; y < S; y += B) { g.fillRect(10, y + B / 2 - 1, 3, 3); g.fillRect(S - 13, y + B / 2 - 1, 3, 3); }
  }, function (g, S) {
    g.fillStyle = "#909090"; g.fillRect(0, 0, S, S);
    const B = S / 6;
    for (let i = 0; i < 160; i++) {
      g.strokeStyle = "rgba(0,0,0," + (0.1 + trand() * 0.2) + ")"; g.lineWidth = 1;
      const y = trand() * S; g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (trand() - 0.5) * 4); g.stroke();
    }
    g.fillStyle = "#101010";
    for (let y = 0; y < S; y += B) g.fillRect(0, y - 1, S, 3);
  }, 2.2);
}
/* THE CONTAINER SKIN, one 512 atlas per paint:
     SIDE  u 0..1,       v 0.5..1   (one 20 ft side, 6.06 x 2.59 m)
     DOOR  u 0..0.4375,  v 0..0.5   (the door end, 2.44 x 2.59 m)
     CAST  u 0.4375..0.5 v 0.375..0.5 (bare dark steel: castings, bars)
     ROOF  u 0.5..1,     v 0..0.5   (roof and painted frame)
   The ribs are geometry, so the paint only has to age: sun-faded top, rust
   bleeding from the rail and the rib roots, scratches, a road-dirt skirt,
   the CSC plate and the stencilled data block (blank, no invented words). */
const ATLAS = {
  SIDE: [0, 0.5, 1, 1], DOOR: [0, 0, 0.4375, 0.5], CAST: [0.4375, 0.375, 0.5, 0.5], ROOF: [0.5, 0, 1, 0.5],
};
function containerSkin(hex) {
  return texPair("cont" + hex, 512, function (g, S) {
    const c = new THREE.Color(hex);
    const rgb = function (k, a) {
      return "rgba(" + Math.round(Math.min(255, c.r * 255 * k)) + "," + Math.round(Math.min(255, c.g * 255 * k)) + "," +
        Math.round(Math.min(255, c.b * 255 * k)) + "," + (a == null ? 1 : a) + ")";
    };
    const rust = function (a) { return "rgba(" + (96 + trand() * 30 | 0) + "," + (44 + trand() * 14 | 0) + ",22," + a + ")"; };
    const age = function (x, y, w, h, topFade) {
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.fillStyle = rgb(1); g.fillRect(x, y, w, h);
      const fade = g.createLinearGradient(0, y, 0, y + h);        // the sun bleaches the top
      fade.addColorStop(0, "rgba(235,230,220," + topFade + ")"); fade.addColorStop(0.6, "rgba(235,230,220,0)");
      g.fillStyle = fade; g.fillRect(x, y, w, h);
      for (let i = 0; i < 26; i++) {                               // patchy repaint and fade
        const bx = x + trand() * w, by = y + trand() * h, r = 12 + trand() * 50;
        const gr = g.createRadialGradient(bx, by, 0, bx, by, r);
        gr.addColorStop(0, trand() < 0.5 ? rgb(0.82, 0.35) : rgb(1.15, 0.3)); gr.addColorStop(1, rgb(1, 0));
        g.fillStyle = gr; g.fillRect(bx - r, by - r, r * 2, r * 2);
      }
      for (let i = 0; i < 18; i++) {                               // rust runs from the top rail
        const rx = x + trand() * w, rw = 1.5 + trand() * 5, rh = h * (0.12 + trand() * 0.55);
        const gr = g.createLinearGradient(0, y, 0, y + rh);
        gr.addColorStop(0, rust(0.7)); gr.addColorStop(1, rust(0));
        g.fillStyle = gr; g.fillRect(rx, y, rw, rh);
      }
      for (let i = 0; i < 40; i++) {                               // scratches and chips to bare steel
        g.strokeStyle = trand() < 0.5 ? rust(0.5) : "rgba(200,196,188,0.25)"; g.lineWidth = 1;
        const sx = x + trand() * w, sy = y + trand() * h; g.beginPath(); g.moveTo(sx, sy);
        g.lineTo(sx + (trand() - 0.5) * 40, sy + (trand() - 0.5) * 8); g.stroke();
      }
      const dirt = g.createLinearGradient(0, y + h, 0, y + h * 0.7);  // road dirt skirt
      dirt.addColorStop(0, "rgba(70,58,42,0.45)"); dirt.addColorStop(1, "rgba(70,58,42,0)");
      g.fillStyle = dirt; g.fillRect(x, y + h * 0.7, w, h * 0.3);
      speckle(g, S, 600, 0.12, true);
      g.restore();
    };
    // SIDE (canvas y 0..256)
    age(0, 0, S, S / 2, 0.22);
    g.fillStyle = "rgba(190,188,180,0.55)"; g.fillRect(S * 0.9, S * 0.28, 22, 14);          // CSC plate by the doors
    g.fillStyle = "rgba(40,38,34,0.5)"; for (let k = 0; k < 4; k++) g.fillRect(S * 0.9 + 3, S * 0.28 + 3 + k * 3, 16, 1);
    g.fillStyle = "rgba(235,232,224,0.55)";                                                    // stencilled data block
    for (let k = 0; k < 3; k++) g.fillRect(S * 0.82, S * 0.08 + k * 7, 18 + trand() * 24, 4);
    // DOOR (canvas x 0..224, y 256..512)
    const dx = 0, dy = S / 2, dw = 224, dh = S / 2;
    age(dx, dy, dw, dh, 0.18);
    for (let x = dx + 8; x < dx + dw - 8; x += 12) {                                           // door corrugation, drawn
      g.fillStyle = "rgba(255,255,255,0.06)"; g.fillRect(x, dy + 10, 4, dh - 20);
      g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(x + 6, dy + 10, 4, dh - 20);
    }
    g.fillStyle = "rgba(15,14,12,0.85)"; g.fillRect(dx + dw / 2 - 1, dy, 3, dh);               // the door meeting line
    g.strokeStyle = "rgba(15,14,12,0.6)"; g.lineWidth = 3; g.strokeRect(dx + 4, dy + 4, dw - 8, dh - 8);   // gasket
    g.fillStyle = "rgba(30,28,25,0.9)";                                                        // hinge blocks
    for (let k = 0; k < 4; k++) { const hy = dy + 18 + k * (dh - 44) / 3; g.fillRect(dx + 2, hy, 8, 12); g.fillRect(dx + dw - 10, hy, 8, 12); }
    g.fillStyle = "rgba(190,188,180,0.5)"; g.fillRect(dx + dw * 0.62, dy + dh * 0.3, 20, 13);   // blank weathered placard
    // CAST (x 224..256, y 256..320)
    g.fillStyle = "#302b27"; g.fillRect(224, 256, 32, 64);
    for (let i = 0; i < 60; i++) { g.fillStyle = rust(0.5); g.fillRect(224 + trand() * 32, 256 + trand() * 64, 2, 2); }
    // the rest of that column is plain door paint so filtering never bleeds grey into it
    g.fillStyle = rgb(0.9); g.fillRect(224, 320, 32, 192);
    // ROOF (x 256..512, y 256..512)
    age(256, 256, 256, 256, 0.3);
    for (let i = 0; i < 10; i++) {                                                             // standing-water rust pools
      const bx = 256 + trand() * 256, by = 256 + trand() * 256, r = 6 + trand() * 22;
      const gr = g.createRadialGradient(bx, by, 0, bx, by, r);
      gr.addColorStop(0, rust(0.55)); gr.addColorStop(1, rust(0));
      g.fillStyle = gr; g.fillRect(bx - r, by - r, r * 2, r * 2);
    }
  }, null);
}
/* ---- ONE SHADER PATCH FOR THE WHOLE YARD. World-space value noise at two
   scales multiplies the albedo (paint and concrete are never one colour, and
   an 8 m tile repeated 65 times would otherwise show), and every vertical
   face picks up grime and splash in the bottom half metre above uGround. */
const YARD_GLSL =
  "varying vec3 vYW;\nvarying float vYNy;\nuniform float uMot;\nuniform float uGrime;\nuniform float uGround;\nuniform float uMotScale;\n" +
  "float yH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
  "float yN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n" +
  "  return mix(mix(yH(i), yH(i + vec2(1.0, 0.0)), f.x), mix(yH(i + vec2(0.0, 1.0)), yH(i + vec2(1.0, 1.0)), f.x), f.y); }\n";
function yardPatch(mat, o) {
  o = o || {};
  mat.onBeforeCompile = function (sh) {
    sh.uniforms.uMot = { value: o.mottle == null ? 0.25 : o.mottle };
    sh.uniforms.uGrime = { value: o.grime == null ? 0.4 : o.grime };
    sh.uniforms.uGround = { value: o.ground || 0 };
    sh.uniforms.uMotScale = { value: o.scale || 1 };
    sh.vertexShader = "varying vec3 vYW;\nvarying float vYNy;\n" + sh.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n{ vec4 yw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n yw = instanceMatrix * yw;\n#endif\n" +
      " vYW = (modelMatrix * yw).xyz; vYNy = normalize(mat3(modelMatrix) * objectNormal).y; }");
    sh.fragmentShader = YARD_GLSL + sh.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\n" +
      "{ vec2 q = vYW.xz * uMotScale;\n" +
      "  float m = 0.82 + 0.3 * yN(q * 0.043) + 0.1 * (yN(q * 0.29 + 17.0) - 0.5) + 0.06 * (yN(vYW.xy * 0.5 + vYW.zz * 0.5) - 0.5);\n" +
      "  diffuseColor.rgb *= mix(1.0, m, uMot);\n" +
      "  float side = 1.0 - abs(vYNy);\n" +
      "  float low = 1.0 - smoothstep(0.0, 0.55 + 0.25 * yN(vYW.xz * 1.7 + vYW.yy), vYW.y - uGround);\n" +
      "  float gr = side * low * uGrime;\n" +
      "  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.55, 0.46), gr); }");
  };
  mat.customProgramCacheKey = function () { return "npcwar-yard1"; };
  return mat;
}

/* ---- GEOMETRY BATCH: every static part of one material goes into one
   non-indexed buffer, transformed by a yaw + origin, flat-normalled per face
   (so corrugation and chamfers catch the light as facets, which is what
   pressed steel and cast concrete do). */
function GeoBatch() { this.p = []; this.n = []; this.u = []; this.c = []; this.xf(0, 0, 0, 0); }
CBZ.npcwar.onBoot(function () {
  GeoBatch.prototype.xf = function (x, y, z, yaw) {
    this.ox = x; this.oy = y; this.oz = z; this.cs = Math.cos(yaw || 0); this.sn = Math.sin(yaw || 0); return this;
  };
  GeoBatch.prototype._v = function (v, uv, nx, ny, nz, col) {
    const x = v[0], z = v[2];
    this.p.push(this.ox + x * this.cs + z * this.sn, this.oy + v[1], this.oz - x * this.sn + z * this.cs);
    this.n.push(nx, ny, nz); this.u.push(uv[0], uv[1]);
    this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
  };
  // a..d counter-clockwise seen from the side the face looks at
  GeoBatch.prototype.quad = function (a, b, c, d, ua, ub, uc, ud, col) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const wx = nx * this.cs + nz * this.sn, wz = -nx * this.sn + nz * this.cs;
    this._v(a, ua, wx, ny, wz, col); this._v(b, ub, wx, ny, wz, col); this._v(c, uc, wx, ny, wz, col);
    if (d === c) return;                                 // quad(a, b, c, c) is a triangle
    this._v(a, ua, wx, ny, wz, col); this._v(c, uc, wx, ny, wz, col); this._v(d, ud, wx, ny, wz, col);
  };
  /* a quad in a face frame: origin O, in-plane axes U (along) and V (up), and
     its outward normal N = U x V. Points are given as (s, t, depth). `uv`
     maps (s, t) -> [u, v]. */
  GeoBatch.prototype.fq = function (F, pts, uv, col) {
    const P = pts.map(function (q) {
      return [F.O[0] + F.U[0] * q[0] + F.V[0] * q[1] + F.N[0] * q[2],
              F.O[1] + F.U[1] * q[0] + F.V[1] * q[1] + F.N[1] * q[2],
              F.O[2] + F.U[2] * q[0] + F.V[2] * q[1] + F.N[2] * q[2]];
    });
    this.quad(P[0], P[1], P[2], P[3], uv(pts[0][0], pts[0][1]), uv(pts[1][0], pts[1][1]),
      uv(pts[2][0], pts[2][1]), uv(pts[3][0], pts[3][1]), col);
  };
});
// the six faces of an axis-aligned box as frames (s runs 0..width, t 0..height)
function boxFrames(cx, cy, cz, w, h, d) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  return [
    { O: [cx + hx, cy - hy, cz + hz], U: [0, 0, -1], V: [0, 1, 0], N: [1, 0, 0], w: d, h: h },     // +x
    { O: [cx - hx, cy - hy, cz - hz], U: [0, 0, 1], V: [0, 1, 0], N: [-1, 0, 0], w: d, h: h },     // -x
    { O: [cx - hx, cy + hy, cz + hz], U: [1, 0, 0], V: [0, 0, -1], N: [0, 1, 0], w: w, h: d },     // +y
    { O: [cx - hx, cy - hy, cz - hz], U: [1, 0, 0], V: [0, 0, 1], N: [0, -1, 0], w: w, h: d },     // -y
    { O: [cx - hx, cy - hy, cz + hz], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1], w: w, h: h },      // +z
    { O: [cx + hx, cy - hy, cz - hz], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1], w: w, h: h },    // -z
  ];
}
const UV_TILE = function (tile, ou, ov) { return function (s, t) { return [s / tile + (ou || 0), t / tile + (ov || 0)]; }; };
const UV_RECT = function (r, w, h) {
  const e = 1 / 512;                                   // half a texel in, so the atlas never bleeds
  return function (s, t) { return [r[0] + e + (r[2] - r[0] - 2 * e) * s / w, r[1] + e + (r[3] - r[1] - 2 * e) * t / h]; };
};
CBZ.npcwar.onBoot(function () {
  /* box(): opt.uv(frame) -> (s,t)->uv, opt.skip = face mask (bit i = face i:
     +x -x +y -y +z -z), opt.col */
  GeoBatch.prototype.box = function (cx, cy, cz, w, h, d, opt) {
    opt = opt || {};
    const F = boxFrames(cx, cy, cz, w, h, d);
    for (let i = 0; i < 6; i++) {
      if (opt.skip && (opt.skip & (1 << i))) continue;
      const f = F[i];
      this.fq(f, [[0, 0, 0], [f.w, 0, 0], [f.w, f.h, 0], [0, f.h, 0]], opt.uv ? opt.uv(f) : UV_TILE(1), opt.col);
    }
  };
  GeoBatch.prototype.mesh = function (mat, shadows) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    mat.vertexColors = true;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadows !== false; m.receiveShadow = true;
    m.matrixAutoUpdate = false; m.updateMatrix();
    CBZ.scene.add(m);
    return m;
  }
});

/* ---- THE ISO CONTAINER, built into a batch in its own frame: length on x,
   width on z, floor at y = 0 (the batch's xf() places and turns it). */
const CN = { W: 2.438, H: 2.591, POST: 0.16, RAILB: 0.16, RAILT: 0.12, PITCH: 0.278, DEPTH: 0.045 };
function corrugate(B, F, len, t0, t1, uvOf, col) {
  // trapezoid sheet: outer flat, slope, inner flat, slope — per pitch
  let n = Math.max(2, Math.round(len / CN.PITCH));
  if (len > 8) n += n % 2;                      // a 40 ft side is two sheets: no rib straddles the seam
  const p = len / n, D = CN.DEPTH;
  const prof = [[0, D], [0.38, D], [0.5, 0], [0.88, 0], [1, D]];
  for (let i = 0; i < n; i++) {
    const uv = uvOf(i, n, p);
    for (let k = 0; k < 4; k++) {
      const s0 = (i + prof[k][0]) * p, s1 = (i + prof[k + 1][0]) * p;
      B.fq(F, [[s0, t0, prof[k][1]], [s1, t0, prof[k + 1][1]], [s1, t1, prof[k + 1][1]], [s0, t1, prof[k][1]]], uv, col);
    }
  }
}
function containerInto(B, L) {
  const W = CN.W, H = CN.H, P = CN.POST, hx = L / 2, hz = W / 2;
  const frame = function (f) { return UV_RECT(ATLAS.ROOF, Math.max(f.w, 0.01) * 4, Math.max(f.h, 0.01) * 4); };
  const cast = function (f) { return UV_RECT(ATLAS.CAST, f.w, f.h); };
  const tone = [0.93, 0.93, 0.93];
  // corner posts, rails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * (hx - P / 2), H / 2, sz * (hz - P / 2), P, H - 0.02, P, { uv: frame, skip: 12, col: tone });
  for (const sz of [-1, 1]) {
    B.box(0, CN.RAILB / 2 + 0.012, sz * (hz - 0.06), L - 2 * P, CN.RAILB, 0.12, { uv: frame, skip: 8, col: tone });
    B.box(0, H - CN.RAILT / 2, sz * (hz - 0.06), L - 2 * P, CN.RAILT, 0.12, { uv: frame, col: tone });
  }
  for (const sx of [-1, 1]) {
    B.box(sx * (hx - 0.07), CN.RAILB / 2 + 0.012, 0, 0.14, CN.RAILB, W - 2 * P, { uv: frame, skip: 8, col: tone });
    B.box(sx * (hx - 0.07), H - CN.RAILT / 2, 0, 0.14, CN.RAILT, W - 2 * P, { uv: frame, col: tone });
  }
  // eight castings, a hair proud of the posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const top of [0, 1]) {
    B.box(sx * (hx - 0.083), top ? H - 0.059 : 0.059, sz * (hz - 0.075), 0.178, 0.118, 0.162, { uv: cast, skip: 8 });
  }
  // corrugated sides: each 20 ft run of sheet maps the SIDE panel once
  const t0 = CN.RAILB + 0.012, t1 = H - CN.RAILT, sp = L - 2 * P;
  const segs = L > 8 ? 2 : 1;
  const sideUV = function (flip) {
    return function (i, n) {
      const per = n / segs, seg = Math.floor(i / per);
      return function (s, t) {
        let u = (s - seg * sp / segs) / (sp / segs); if (flip) u = 1 - u;
        const e = 1 / 512;
        return [e + u * (1 - 2 * e), ATLAS.SIDE[1] + e + (ATLAS.SIDE[3] - ATLAS.SIDE[1] - 2 * e) * (t / H)];
      };
    };
  };
  corrugate(B, { O: [-hx + P, 0, hz - 0.075], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] }, sp, t0, t1, sideUV(false));
  corrugate(B, { O: [hx - P, 0, -hz + 0.075], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] }, sp, t0, t1, sideUV(true));
  // the blind end (x = -L/2): corrugated too
  const ew = W - 2 * P;
  corrugate(B, { O: [-hx + 0.075, 0, -hz + P], U: [0, 0, 1], V: [0, 1, 0], N: [-1, 0, 0] }, ew, t0, t1, function () {
    return function (s, t) { return [0.1 + 0.3 * s / ew, ATLAS.SIDE[1] + 0.002 + (ATLAS.SIDE[3] - ATLAS.SIDE[1] - 0.004) * (t / H)]; };
  });
  // the door end (x = +L/2): two doors, four locking bars, handles, cam keepers
  const DF = { O: [hx - 0.04, 0, hz - P], U: [0, 0, -1], V: [0, 1, 0], N: [1, 0, 0] };
  const doorUV = UV_RECT(ATLAS.DOOR, ew, t1 - t0);
  B.fq(DF, [[0, t0, 0], [ew, t0, 0], [ew, t1, 0], [0, t1, 0]], function (s, t) { return doorUV(s, t - t0); });
  const barZ = [-0.87, -0.35, 0.35, 0.87];
  for (let k = 0; k < 4; k++) {
    const z = barZ[k] * (ew / 2) / 1.06;
    B.box(hx - 0.005, (t0 + t1) / 2, z, 0.04, t1 - t0 - 0.12, 0.04, { uv: cast, skip: 12 });
    B.box(hx - 0.02, t0 + 0.08, z, 0.07, 0.07, 0.1, { uv: cast, skip: 8 });           // cam keeper, bottom
    B.box(hx - 0.02, t1 - 0.08, z, 0.07, 0.07, 0.1, { uv: cast, skip: 8 });           // cam keeper, top
    B.box(hx + 0.03, 1.15, z + (k % 2 ? -0.16 : 0.16) * 0.5, 0.03, 0.05, 0.2, { uv: cast });  // handle
  }
  // the roof, sitting 2 cm into the rails the way a dented roof does
  const rw = L - 2 * P, rd = W - 0.24;
  B.fq({ O: [-hx + P, H - 0.02, hz - 0.12], U: [1, 0, 0], V: [0, 0, -1], N: [0, 1, 0] },
    [[0, 0, 0], [rw, 0, 0], [rw, rd, 0], [0, rd, 0]], UV_RECT(ATLAS.ROOF, rw, rd));
}
// container paints: the faded fleet colours of a real yard
const CONT_PAINT = [0x8b3b2c, 0x355b78, 0x4f6a45, 0xa4845a, 0x7a7d7e, 0xc2bfb5, 0x9a5530];

/* ---- PRECAST "LEGO" BLOCK, chamfered, in a face frame per visible face */
/* mode "all": a long face, chamfered on every edge. "lr": the top of the
   top course, chamfered only at the block ends (the long faces' own
   chamfers close the front and back). "b": a wall-end face, chamfered at
   the bottom only (the top face's end chamfer closes it, or the next course
   up); "tb": a wall-end face below the top course. */
function chamferFace(B, F, w, h, c, uv, col, mode) {
  mode = mode || "all";
  const L = mode === "all" || mode === "lr", T = mode === "all" || mode === "tb", Bo = mode !== "lr";
  const s0 = c, s1 = w - c, t0 = c, t1 = h - c;
  B.fq(F, [[s0, t0, 0], [s1, t0, 0], [s1, t1, 0], [s0, t1, 0]], uv, col);
  if (Bo) B.fq(F, [[L ? 0 : s0, 0, -c], [L ? w : s1, 0, -c], [s1, c, 0], [s0, c, 0]], uv, col);
  if (T) B.fq(F, [[s0, h - c, 0], [s1, h - c, 0], [L ? w : s1, h, -c], [L ? 0 : s0, h, -c]], uv, col);
  if (L) {
    const a = mode === "lr" ? c : 0, b = mode === "lr" ? h - c : h;
    B.fq(F, [[0, a, -c], [c, t0, 0], [c, t1, 0], [0, b, -c]], uv, col);
    B.fq(F, [[w - c, t0, 0], [w, a, -c], [w, b, -c], [w - c, t1, 0]], uv, col);
  }
}
function knob(B, x, y, z, r, hgt, uv, col) {
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832;
    const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
    const q0 = [x + Math.cos(a0) * r * 0.9, y + hgt, z + Math.sin(a0) * r * 0.9], q1 = [x + Math.cos(a1) * r * 0.9, y + hgt, z + Math.sin(a1) * r * 0.9];
    B.quad(p1, p0, q0, q1, uv(a1 * r, 0), uv(a0 * r, 0), uv(a0 * r, hgt), uv(a1 * r, hgt), col);
    const cc = [x, y + hgt, z];
    B.quad(q1, q0, cc, cc, uv(q1[0], q1[2]), uv(q0[0], q0[2]), uv(x, z), uv(x, z), col);
  }
}
/* a straight run of block wall along the local x axis of the batch frame,
   from x0 to x1, centred on z = 0, `courses` high, running bond */
function legatoRun(B, x0, x1, courses, capEnds) {
  const BL = 1.6, BH = 0.8, BD = 0.8, C = 0.035, hd = BD / 2;
  const tint = function () { const k = 0.9 + trand() * 0.16; return [k, k * (0.99 + trand() * 0.02), k * (0.97 + trand() * 0.04)]; };
  for (let k = 0; k < courses; k++) {
    let x = x0;
    const y0 = k * BH, top = k === courses - 1;
    let first = true;
    while (x < x1 - 0.05) {
      const len = Math.min(first && (k % 2) ? BL / 2 : BL, x1 - x);
      const col = tint(), uv = UV_TILE(2, trand() * 7, trand() * 7);
      // the two long faces
      chamferFace(B, { O: [x, y0, hd], U: [1, 0, 0], V: [0, 1, 0], N: [0, 0, 1] }, len, BH, C, uv, col);
      chamferFace(B, { O: [x + len, y0, -hd], U: [-1, 0, 0], V: [0, 1, 0], N: [0, 0, -1] }, len, BH, C, uv, col);
      if (top) {
        chamferFace(B, { O: [x, y0 + BH, hd], U: [1, 0, 0], V: [0, 0, -1], N: [0, 1, 0] }, len, BD, C, uv, col, "lr");
        if (len > 1.2) { knob(B, x + len * 0.25, y0 + BH, 0, 0.16, 0.09, uv, col); knob(B, x + len * 0.75, y0 + BH, 0, 0.16, 0.09, uv, col); }
      }
      if (capEnds && (x === x0 || x + len >= x1 - 0.01)) {
        const em = top ? "b" : "tb";
        if (x === x0) chamferFace(B, { O: [x, y0, -hd], U: [0, 0, 1], V: [0, 1, 0], N: [-1, 0, 0] }, BD, BH, C, uv, col, em);
        if (x + len >= x1 - 0.01) chamferFace(B, { O: [x + len, y0, hd], U: [0, 0, -1], V: [0, 1, 0], N: [1, 0, 0] }, BD, BH, C, uv, col, em);
      }
      x += len; first = false;
    }
  }
}
/* ---- JERSEY BARRIER, the F-shape: 610 mm base, 810 mm tall, 3 m long */
const JERSEY = [[0.305, 0], [0.305, 0.076], [0.127, 0.33], [0.077, 0.81]];
function jerseyInto(B, L, col) {
  const hl = L / 2, uv = UV_TILE(2, trand() * 5, trand() * 5);
  const prof = JERSEY.concat(JERSEY.slice().reverse().map(function (p) { return [-p[0], p[1]]; }));
  // around the profile: +z side up, across the top, -z side down
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    if (a[0] === -b[0] && a[1] === b[1] && a[1] === 0) continue;
    const along = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const s0 = i * 0.3, s1 = s0 + along;
    B.quad([-hl, a[1], a[0]], [hl, a[1], a[0]], [hl, b[1], b[0]], [-hl, b[1], b[0]],
      uv(0, s0), uv(L, s0), uv(L, s1), uv(0, s1), col);
  }
  // end caps: a convex profile, fanned
  for (const sx of [-1, 1]) {
    for (let i = 1; i < prof.length - 1; i++) {
      const a = prof[0], b = prof[i], c = prof[i + 1];
      const P = function (p) { return [sx * hl, p[1], p[0]]; };
      const pa = P(a), pb = P(b), pc = P(c);
      if (sx > 0) B.quad(pa, pc, pb, pb, uv(a[0], a[1]), uv(c[0], c[1]), uv(b[0], b[1]), uv(b[0], b[1]), col);
      else B.quad(pa, pb, pc, pc, uv(a[0], a[1]), uv(b[0], b[1]), uv(c[0], c[1]), uv(c[0], c[1]), col);
    }
  }
}
/* ---- A PALLET AND ITS CRATES. A 1.2 x 1.0 m pallet (three stringers, a
   five-board deck) carrying sawn-pine crates with framing battens. */
function palletInto(B) {
  const uv = function () { return UV_TILE(1.2, trand(), trand()); }, pale = [1.12, 1.08, 1.0];
  for (const z of [-0.44, 0, 0.44]) B.box(0, 0.05, z, 1.2, 0.1, 0.1, { uv: uv, skip: 8, col: pale });
  for (let i = 0; i < 5; i++) B.box(-0.53 + i * 0.265, 0.111, 0, 0.14, 0.022, 1.0, { uv: uv, skip: 8, col: pale });
}
function crateInto(B, y0, w, h, d) {
  const hx = w / 2, hz = d / 2, T = 0.02, bw = 0.09, cy = y0 + h / 2;
  const plank = function () { return UV_TILE(1.2, trand(), trand()); };
  const dark = [0.78, 0.74, 0.7];
  B.box(0, cy, 0, w, h, d, { uv: plank, skip: 8 });
  for (const sz of [-1, 1]) {                                 // long faces: corner posts, rails, a middle rail
    for (const sx of [-1, 1]) B.box(sx * (hx - bw / 2), cy, sz * (hz + T / 2), bw, h, T, { uv: plank, skip: 8, col: dark });
    for (const yy of [y0 + bw / 2, y0 + h - bw / 2, cy]) B.box(0, yy, sz * (hz + T / 2), w - 2 * bw, bw, T, { uv: plank, col: dark });
  }
  for (const sx of [-1, 1]) {                                 // short faces
    for (const sz of [-1, 1]) B.box(sx * (hx + T / 2), cy, sz * (hz - bw / 2), T, h, bw, { uv: plank, skip: 8, col: dark });
    for (const yy of [y0 + bw / 2, y0 + h - bw / 2]) B.box(sx * (hx + T / 2), yy, 0, T, bw, d - 2 * bw, { uv: plank, col: dark });
  }
  for (const sz of [-0.3, 0.3]) B.box(0, y0 + h + T / 2, sz * d, w, T, bw, { uv: plank, skip: 8, col: dark });
}

/* ---- THE YARD, laid out. Returns the list of named props for the audit. */
const SCENERY = [];
function buildYard(W, D, gap) {
  // FLOOR: the poured slab, 520 m out to the fog; UVs in metres/8
  const slab = slabTex();
  const fg = new THREE.PlaneGeometry(520, 520);
  fg.rotateX(-Math.PI / 2);
  const fuv = fg.attributes.uv;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 65, fuv.getY(i) * 65);
  const floorMat = yardPatch(new THREE.MeshPhongMaterial({ map: slab.map, normalMap: slab.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6), specular: 0x141414, shininess: 10 }), { mottle: 0.38, grime: 0 });
  const floor = new THREE.Mesh(fg, floorMat);
  floor.receiveShadow = true; floor.matrixAutoUpdate = false; floor.updateMatrix();
  floor.userData.terrain = true;
  CBZ.scene.add(floor);

  // PERIMETER: four courses of block (3.2 m), knobs up
  const pc = precastTex();
  const blockB = new GeoBatch();
  const hw = W / 2, hd = D / 2;
  blockB.xf(0, 0, -hd, 0); legatoRun(blockB, -hw - 0.4, hw + 0.4, 4, true);
  blockB.xf(0, 0, hd, Math.PI); legatoRun(blockB, -hw - 0.4, hw + 0.4, 4, true);
  blockB.xf(-hw, 0, 0, Math.PI / 2); legatoRun(blockB, -hd + 0.4, hd - 0.4, 4, false);
  blockB.xf(hw, 0, 0, -Math.PI / 2); legatoRun(blockB, -hd + 0.4, hd - 0.4, 4, false);
  CBZ.micro.addBoxCollider(0, 1.6, -hd, W + 0.8, 3.2, 0.8); CBZ.micro.addBoxCollider(0, 1.6, hd, W + 0.8, 3.2, 0.8);
  CBZ.micro.addBoxCollider(-hw, 1.6, 0, 0.8, 3.2, D); CBZ.micro.addBoxCollider(hw, 1.6, 0, 0.8, 3.2, D);

  // PLACEMENT: every prop claims its footprint (+ an aisle) and nothing
  // intersects anything; the spawn columns stay open ground
  const taken = [];
  const lane0 = gap / 2 - 6, lane1 = gap / 2 + 18;
  const fits = function (x, z, ex, ez, aisle) {
    if (Math.abs(x) + ex > hw - 2.5 || Math.abs(z) + ez > hd - 2.5) return false;
    if (Math.abs(x) + ex > lane0 && Math.abs(x) - ex < lane1 && Math.abs(z) - ez < 24) return false;
    for (let i = 0; i < taken.length; i++) {
      const t = taken[i];
      if (Math.abs(x - t[0]) < ex + t[2] + aisle && Math.abs(z - t[1]) < ez + t[3] + aisle) return false;
    }
    return true;
  };
  const claim = function (x, z, ex, ez) { taken.push([x, z, ex, ez]); };

  const contB = {};                  // one batch per paint
  const batchFor = function (hex) { return contB[hex] || (contB[hex] = new GeoBatch()); };
  const paint = function () { return CONT_PAINT[(sWorld() * CONT_PAINT.length) | 0]; };
  const place = function (x, z, L, alongX, tiers, flip) {
    const ex = alongX ? L / 2 : CN.W / 2, ez = alongX ? CN.W / 2 : L / 2;
    const yaw = alongX ? (flip ? Math.PI : 0) : (flip ? Math.PI / 2 : -Math.PI / 2);
    for (let t = 0; t < tiers; t++) {
      const B = batchFor(paint());
      B.xf(x, t * CN.H, z, yaw);
      containerInto(B, L);
    }
    claim(x, z, ex, ez);
    CBZ.micro.addBoxCollider(x, tiers * CN.H / 2, z, ex * 2, tiers * CN.H, ez * 2);
    SCENERY.push({ kind: "container", x: x, y: tiers * CN.H / 2, z: z, len: L, tiers: tiers });
  };
  const L20 = 6.058, L40 = 12.192;

  // 1. THE BACK OF THE YARD behind each start line: rows along x, stacked
  //    two high, on the flanks so the columns form up in the open
  for (const side of [-1, 1]) {
    for (const zs of [-1, 1]) {
      let z = zs * (28 + sWorld() * 6);
      for (let r = 0; r < 3; r++) {
        const L = sWorld() < 0.55 ? L40 : L20;
        const x = side * (hw - 3 - L / 2 - sWorld() * 2);
        if (fits(x, z, L / 2, CN.W / 2, 0.25)) place(x, z, L, true, sWorld() < 0.6 ? 2 : 1, side > 0);
        z += zs * (CN.W + 0.35 + (sWorld() < 0.3 ? 5 : 0));
      }
    }
  }
  // 2. NO-MAN'S LAND: broadside rows (long axis across the fire line), some
  //    stacked, some in pairs, with aisles to move through
  let tries = 0, placed = 0;
  while (placed < 14 && tries++ < 80) {
    const x = (sWorld() - 0.5) * (gap - 20), z = (sWorld() - 0.5) * (D - 24);
    const L = sWorld() < 0.7 ? L20 : L40;
    if (!fits(x, z, CN.W / 2, L / 2, 3.2)) continue;
    const tiers = sWorld() < 0.3 ? 2 : 1;
    place(x, z, L, false, tiers, sWorld() < 0.5);
    placed++;
    // a neighbour in the same row, 30 cm off, the way they get dropped
    const nx = x + (x > 0 ? -1 : 1) * (CN.W + 0.3);
    if (sWorld() < 0.35 && fits(nx, z, CN.W / 2, L / 2, 0.1)) { place(nx, z, L, false, 1, sWorld() < 0.5); placed++; }
  }
  // 3. JERSEY BARRIER RUNS: low cover, laid end to end
  const jB = new GeoBatch();
  let runs = 0; tries = 0;
  while (runs < 9 && tries++ < 80) {
    const x = (sWorld() - 0.5) * (gap - 14), z = (sWorld() - 0.5) * (D - 30);
    const n = 2 + ((sWorld() * 3) | 0), alongZ = sWorld() < 0.6, len = n * 3.05;
    const ex = alongZ ? 0.31 : len / 2, ez = alongZ ? len / 2 : 0.31;
    if (!fits(x, z, ex, ez, 2.2)) continue;
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + 1.525 + i * 3.05, k = 0.92 + sWorld() * 0.14;
      jB.xf(alongZ ? x : x + o, 0, alongZ ? z + o : z, alongZ ? Math.PI / 2 + (sWorld() - 0.5) * 0.02 : (sWorld() - 0.5) * 0.02);
      jerseyInto(jB, 3.0, [k, k, k * 0.98]);
    }
    claim(x, z, ex, ez);
    CBZ.micro.addBoxCollider(x, 0.405, z, ex * 2, 0.81, ez * 2);
    SCENERY.push({ kind: "barrier", x: x, y: 0.4, z: z });
    runs++;
  }
  // 4. CRATES ON PALLETS, beside the containers they came out of
  const cB = new GeoBatch();
  let piles = 0; tries = 0;
  while (piles < 8 && tries++ < 60) {
    const x = (sWorld() - 0.5) * (gap - 10), z = (sWorld() - 0.5) * (D - 30);
    const two = sWorld() < 0.5;             // two pallets side by side
    const ex = two ? 1.25 : 0.62, ez = 0.52;
    if (!fits(x, z, ex, ez, 1.6)) continue;
    const yaw = sWorld() < 0.5 ? 0 : Math.PI;
    let high = 0;
    for (let p = 0; p < (two ? 2 : 1); p++) {
      const px = two ? x + (p ? 0.63 : -0.63) : x;
      cB.xf(px, 0, z, yaw); palletInto(cB);
      const stack = 1 + ((sWorld() * 2) | 0);
      for (let s = 0; s < stack; s++) crateInto(cB, 0.122 + s * 1.02, 1.14, 1.0, 0.94);
      high = Math.max(high, 0.122 + stack * 1.02);
    }
    claim(x, z, ex, ez);
    CBZ.micro.addBoxCollider(x, high / 2, z, ex * 2, high, ez * 2);
    SCENERY.push({ kind: "crates", x: x, y: high / 2, z: z });
    piles++;
  }

  // ONE MESH PER MATERIAL
  const concreteMat = function () {
    return yardPatch(new THREE.MeshPhongMaterial({ map: pc.map, normalMap: pc.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8), specular: 0x111111, shininess: 8 }), { mottle: 0.22, grime: 0.55 });
  };
  blockB.mesh(concreteMat());
  jB.mesh(concreteMat());
  const pine = pineTex();
  cB.mesh(yardPatch(new THREE.MeshPhongMaterial({ map: pine.map, normalMap: pine.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7), specular: 0x0c0c0c, shininess: 6 }), { mottle: 0.2, grime: 0.35 }));
  Object.keys(contB).forEach(function (hex) {
    const skin = containerSkin(+hex);
    contB[hex].mesh(yardPatch(new THREE.MeshPhongMaterial({ map: skin.map, specular: 0x262626, shininess: 22 }),
      { mottle: 0.16, grime: 0.5 }));
  });
}
/* One deep plate under the ISLAND maps, so a raised island reads as an
   island and the horizon is water rather than the inside of the sky dome.

   DEEP is the operative word, and the first draft got it wrong at -1.2 m:
   measured from a street-level camera, the sea won the depth test against
   the road surface and the whole downtown rendered as open water with lane
   markings floating on it. A 26 km plane and a 16 km far plane leave very
   little depth resolution to separate two surfaces a metre apart. At -9 m
   it is unambiguous at every camera range, and the apron edge below reads
   as the quay it now is. */
function seaPlate(y) {
  /* ...and it is WATER, not a blue sheet: the deep plate under the island
     venues is shaded by the one water material (world/water_spec.js via
     CBZ.waterAdoptSea) — the dome's sky in it, glint, depth colour — flat
     and opaque (nothing is drawn under it), at -9 m. */
  const py = y == null ? -9 : y;
  const g = new THREE.PlaneGeometry(26000, 26000);
  g.rotateX(-Math.PI / 2); g.translate(0, py, 0);
  const m = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ color: 0x1d4a64, specular: 0x9fb6c4, shininess: 64 }));
  m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
  m.userData.terrain = true;
  CBZ.scene.add(m);
  if (CBZ.waterAdoptSea) CBZ.waterAdoptSea(m, { name: "NPC War Sea Plate", seaY: py, opaque: true });
}
/* OPEN WATER's floor. It used to be the same flat blue plate as the island
   sea, forty metres down: a seabed the colour of the water over it. It is
   sand now, mottled at two scales so the fog has something to swallow. */
function seabed(y) {
  const g = new THREE.PlaneGeometry(26000, 26000);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  const m = new THREE.Mesh(g, yardPatch(new THREE.MeshLambertMaterial({ color: 0x7a7458 }),
    { mottle: 0.55, grime: 0, scale: 0.5 }));
  m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
  m.userData.terrain = true;
  CBZ.scene.add(m);
}
/* GROUND OUT TO THE FOG around a raised venue or the city. It was a flat
   colour 4 mm ABOVE the venue's own lowest floor, which is a depth fight
   across the whole venue at any range past a few hundred metres. It sits
   under the venue now (2 cm down and pushed back in depth), and it is the
   poured slab texture at 8 m a tile, tinted to the colour the venue asked
   for, so the far ground has joints and stains instead of paint. */
function apron(minX, maxX, minZ, maxZ, color, y) {
  const sx = maxX - minX, sz = maxZ - minZ;
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate((minX + maxX) / 2, (y == null ? 0 : y) - 0.02, (minZ + maxZ) / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx / 8, uv.getY(i) * sz / 8);
  const want = new THREE.Color(color || 0x8d9198), base = new THREE.Color(0x8b867c);
  const tint = new THREE.Color(Math.min(1, want.r / base.r), Math.min(1, want.g / base.g), Math.min(1, want.b / base.b));
  const slab = slabTex();
  const mat = yardPatch(new THREE.MeshLambertMaterial({ map: slab.map, color: tint,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }), { mottle: 0.35, grime: 0 });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
  m.userData.terrain = true;
  CBZ.scene.add(m);
}
