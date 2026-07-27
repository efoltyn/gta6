/* ============================================================
   city/cockpit_panel.js — THE GLASS: every instrument face in the game,
   drawn with 2D canvas primitives, in ONE place.

   This is the second half of the cockpit grammar (city/cockpit.js is the
   first). It owns NO scene objects and NO state: you hand it a 2D context,
   a rectangle and a FLIGHT STATE struct, and it paints an instrument. That
   makes it trivially reusable — the same `adi()` that draws the fighter's
   HUD pitch ladder draws the airliner's PFD horizon and the Cessna's
   vacuum attitude gyro, because an artificial horizon is an artificial
   horizon. A new airframe picks a LAYOUT string; it never draws a gauge.

   WHY A CANVAS AND NOT DOM: a cockpit instrument is not HUD. HUD doctrine
   (CLAUDE.md) says the only screen-space popup is the killfeed — and it is
   right. These pixels live on a MESH inside the aircraft, lit by the same
   sun, occluded by the same canopy frame, tilted away from you when you
   lean. You read them by looking down, exactly like the real thing.

   WHAT'S IN HERE
   --------------
   • CBZ.cockpitGauges — the primitive kit: adi (artificial horizon, round
     or PFD-square), dial (a round instrument with coloured arcs, ticks and
     up to two needles), tape (the rolling speed/altitude ribbons of a glass
     PFD), vsi, compassCard, turnCoord, bar, caution, screen (a bezelled
     display panel), and the small text/label helpers they share.
   • CBZ.cockpitLayouts — one draw(ctx,W,H,S,PAL) per COCKPIT CLASS
     (fighter / heli / airliner / bomber / prop). Each is a page of
     furniture calls; adding a sixth class is ~30 lines, not a system.
   • CBZ.cockpitHudDraw — the fighter/bomber HEAD-UP symbology (velocity
     vector, pitch ladder, heading tape, speed & altitude boxes, AoA
     bracket, gun cross, stall/lock cues) on its own transparent canvas.
   • CBZ.cockpitBaseCanvas — the static-furniture cache. Bezels, tick marks,
     colour arcs and legends never change, so they're painted ONCE into an
     offscreen canvas and blitted; only needles/tapes/horizons are redrawn.

   EVERY NUMBER COMES FROM THE FLIGHT MODEL. The state struct S is filled by
   cockpit.js from the live craft + CBZ.aeroPhysics — nothing here invents a
   value, and no gauge is decorative. If a needle moves, the aeroplane did
   something.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const PI = Math.PI, TAU = PI * 2;
  const D2R = PI / 180;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---- shared text helper: the ONE place font strings are built, so every
  // instrument in every cockpit shares a type scale (a cockpit with five
  // different label fonts reads as five different artists).
  function txt(ctx, s, x, y, size, color, align, weight) {
    ctx.fillStyle = color || "#c8d4e0";
    ctx.font = (weight || 600) + " " + size + "px ui-monospace,Menlo,Consolas,monospace";
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillText(s, x, y);
  }

  // ============================================================
  //  ARTIFICIAL HORIZON — the instrument everything else orbits.
  //  The sky/ground disc TRANSLATES with pitch and ROTATES opposite bank
  //  inside a fixed bezel; a fixed aircraft symbol sits dead centre. Set
  //  opts.square for the PFD/glass presentation (clipped to a rectangle,
  //  no round bezel), opts.mono for the monochrome HUD ladder (no fill).
  // ============================================================
  function adi(ctx, cx, cy, r, pitchDeg, roll, opts) {
    opts = opts || {};
    const pxPerDeg = opts.pxPerDeg || (r / 22);      // ~2.2px/deg at r=48 — the sim standard band
    const halfW = opts.halfW || r, halfH = opts.halfH || r;
    ctx.save();
    ctx.beginPath();
    if (opts.square) ctx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2);
    else ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-roll);                                // bank: the world rolls the other way
    const off = pitchDeg * pxPerDeg;                  // pitch: the world slides down when you pull up
    const span = (halfW + halfH) * 2.2;
    if (!opts.mono) {
      ctx.fillStyle = opts.sky || "#2f6fa8";
      ctx.fillRect(-span, -span + off, span * 2, span);
      ctx.fillStyle = opts.ground || "#6d5330";
      ctx.fillRect(-span, off, span * 2, span);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1.2, r * 0.035);
      ctx.beginPath(); ctx.moveTo(-span, off); ctx.lineTo(span, off); ctx.stroke();
    }
    // pitch ladder: a long rung every 10°, a short one every 5°, numbered
    ctx.strokeStyle = opts.ink || "#ffffff";
    ctx.lineWidth = Math.max(1, r * 0.022);
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const y = off - d * pxPerDeg;
      if (y < -span * 0.6 || y > span * 0.6) continue;
      const major = (d % 10) === 0;
      const w = major ? r * 0.62 : r * 0.3;
      ctx.beginPath();
      if (d < 0 && opts.dashNeg !== false) ctx.setLineDash([r * 0.1, r * 0.07]);
      ctx.moveTo(-w, y); ctx.lineTo(-w * 0.18, y);
      ctx.moveTo(w * 0.18, y); ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major && Math.abs(d) <= 60) {
        txt(ctx, String(Math.abs(d)), -w - r * 0.16, y, Math.max(7, r * 0.17), opts.ink || "#ffffff", "center");
        txt(ctx, String(Math.abs(d)), w + r * 0.16, y, Math.max(7, r * 0.17), opts.ink || "#ffffff", "center");
      }
    }
    // bank pointer riding the rotating disc against the fixed scale
    ctx.fillStyle = opts.ink || "#ffe9a8";
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.86); ctx.lineTo(-r * 0.07, -r * 0.74); ctx.lineTo(r * 0.07, -r * 0.74);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // ---- fixed furniture (never rotates) ----
    ctx.save();
    ctx.translate(cx, cy);
    // bank scale ticks across the top
    ctx.strokeStyle = opts.ink || "#dfe8f2"; ctx.lineWidth = Math.max(1, r * 0.03);
    [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].forEach(function (a) {
      const t = (a - 90) * D2R, big = (a % 30 === 0) || a === 45 || a === -45;
      const r0 = r * (big ? 0.86 : 0.91);
      ctx.beginPath();
      ctx.moveTo(Math.cos(t) * r0, Math.sin(t) * r0);
      ctx.lineTo(Math.cos(t) * r * 0.99, Math.sin(t) * r * 0.99);
      ctx.stroke();
    });
    // the aircraft reference symbol: wings + a dot. Amber, always level.
    const a1 = opts.symbol || "#ffcf4a";
    ctx.strokeStyle = a1; ctx.lineWidth = Math.max(1.6, r * 0.055);
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, 0); ctx.lineTo(-r * 0.22, 0); ctx.lineTo(-r * 0.14, r * 0.11);
    ctx.moveTo(r * 0.62, 0); ctx.lineTo(r * 0.22, 0); ctx.lineTo(r * 0.14, r * 0.11);
    ctx.stroke();
    ctx.fillStyle = a1;
    ctx.fillRect(-r * 0.035, -r * 0.035, r * 0.07, r * 0.07);
    ctx.restore();
  }

  // ============================================================
  //  ROUND DIAL — one function for airspeed, altimeter, RPM, torque,
  //  fuel, manifold pressure and anything else with a needle. Coloured
  //  arcs, tick marks, one or two needles, an optional digital counter.
  //  Angles run clockwise from `a0` (default 7:30) through `a1` (4:30).
  // ============================================================
  function dialFace(ctx, cx, cy, r, o) {
    o = o || {};
    const a0 = o.a0 != null ? o.a0 : 135 * D2R, a1 = o.a1 != null ? o.a1 : 405 * D2R;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = o.face || "#0b0d10"; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.strokeStyle = o.bezel || "#3a424c"; ctx.stroke();
    const lo = o.min != null ? o.min : 0, hi = o.max != null ? o.max : 100;
    const A = function (v) { return a0 + (a1 - a0) * clamp((v - lo) / (hi - lo || 1), 0, 1); };
    // coloured arcs (green band / yellow caution / red line) under the ticks
    (o.arcs || []).forEach(function (arc) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.83, A(arc[0]), A(arc[1]));
      ctx.lineWidth = Math.max(2, r * 0.1); ctx.strokeStyle = arc[2]; ctx.stroke();
    });
    if (o.redline != null) {
      const t = A(o.redline);
      ctx.beginPath(); ctx.strokeStyle = "#ff3a28"; ctx.lineWidth = Math.max(2, r * 0.09);
      ctx.moveTo(cx + Math.cos(t) * r * 0.72, cy + Math.sin(t) * r * 0.72);
      ctx.lineTo(cx + Math.cos(t) * r * 0.95, cy + Math.sin(t) * r * 0.95);
      ctx.stroke();
    }
    // ticks + numerals
    const step = o.step || (hi - lo) / 10, sub = o.sub || 0;
    ctx.strokeStyle = o.ink || "#e6edf5";
    for (let v = lo; v <= hi + 0.0001; v += step) {
      const t = A(v);
      ctx.lineWidth = Math.max(1.4, r * 0.045);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(t) * r * 0.7, cy + Math.sin(t) * r * 0.7);
      ctx.lineTo(cx + Math.cos(t) * r * 0.9, cy + Math.sin(t) * r * 0.9);
      ctx.stroke();
      if (o.numbers !== false) {
        const lbl = o.fmt ? o.fmt(v) : String(Math.round(v));
        txt(ctx, lbl, cx + Math.cos(t) * r * 0.54, cy + Math.sin(t) * r * 0.54,
          Math.max(7, r * 0.2), o.ink || "#e6edf5");
      }
      if (sub) for (let s = v + sub; s < v + step - 0.0001 && s <= hi; s += sub) {
        const ts = A(s);
        ctx.lineWidth = Math.max(1, r * 0.028);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ts) * r * 0.78, cy + Math.sin(ts) * r * 0.78);
        ctx.lineTo(cx + Math.cos(ts) * r * 0.9, cy + Math.sin(ts) * r * 0.9);
        ctx.stroke();
      }
    }
    if (o.label) txt(ctx, o.label, cx, cy + r * 0.42, Math.max(7, r * 0.19), o.labelInk || "#93a2b4");
    ctx.restore();
  }
  function needle(ctx, cx, cy, r, frac, o) {
    o = o || {};
    const a0 = o.a0 != null ? o.a0 : 135 * D2R, a1 = o.a1 != null ? o.a1 : 405 * D2R;
    const t = a0 + (a1 - a0) * clamp(frac, 0, 1);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t);
    ctx.fillStyle = o.color || "#ffffff";
    const L = r * (o.len || 0.84), w = r * (o.w || 0.055);
    ctx.beginPath();
    ctx.moveTo(-r * 0.18, -w * 0.7); ctx.lineTo(L, -w * 0.32);
    ctx.lineTo(L, w * 0.32); ctx.lineTo(-r * 0.18, w * 0.7);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (o.hub !== false) {
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.08, 0, TAU);
      ctx.fillStyle = o.hubColor || "#20262e"; ctx.fill();
    }
  }

  // ============================================================
  //  ROLLING TAPE — the glass-cockpit speed/altitude ribbon. A window of
  //  the scale slides past a fixed pointer with the live value boxed in
  //  the middle. Same function both sides; `right` mirrors the pointer.
  // ============================================================
  function tape(ctx, x, y, w, h, value, o) {
    o = o || {};
    const per = o.perUnit || (h / (o.span || 200));   // px per unit
    const step = o.step || 20;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = o.bg || "rgba(10,14,20,0.72)"; ctx.fillRect(x, y, w, h);
    const cy = y + h / 2;
    const first = Math.floor((value - (h / 2) / per) / step) * step;
    const last = value + (h / 2) / per;
    ctx.strokeStyle = o.ink || "#dfe8f2"; ctx.lineWidth = 1.4;
    for (let v = first; v <= last; v += step) {
      const ty = cy + (value - v) * per;
      const major = Math.abs(v % (step * 2)) < 0.001;
      ctx.beginPath();
      if (o.right) { ctx.moveTo(x, ty); ctx.lineTo(x + (major ? w * 0.24 : w * 0.13), ty); }
      else { ctx.moveTo(x + w, ty); ctx.lineTo(x + w - (major ? w * 0.24 : w * 0.13), ty); }
      ctx.stroke();
      if (major && v >= (o.min != null ? o.min : -1e9)) {
        txt(ctx, o.fmt ? o.fmt(v) : String(Math.round(v)),
          o.right ? x + w * 0.66 : x + w * 0.34, ty, Math.max(8, w * 0.2), o.ink || "#dfe8f2");
      }
    }
    ctx.restore();
    // the value box + pointer
    const bh = Math.max(14, h * 0.13), bw = w * 0.98;
    ctx.fillStyle = o.boxBg || "#0d1218";
    ctx.strokeStyle = o.ink || "#dfe8f2"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.rect(x + (w - bw) / 2, y + h / 2 - bh / 2, bw, bh);
    ctx.fill(); ctx.stroke();
    txt(ctx, o.valFmt ? o.valFmt(value) : String(Math.round(value)),
      x + w / 2, y + h / 2, Math.max(10, bh * 0.68), o.valInk || "#ffffff", "center", 700);
    if (o.title) txt(ctx, o.title, x + w / 2, y - 7, Math.max(7, w * 0.18), o.ink || "#93a2b4");
  }

  // ---- vertical speed: needle at 9 o'clock for level, climb sweeps up ----
  function vsi(ctx, cx, cy, r, fpm, o) {
    o = o || {};
    const lim = o.limit || 2000;
    dialFace(ctx, cx, cy, r, {
      min: -lim, max: lim, step: lim / 2, a0: 210 * D2R, a1: 510 * D2R,
      face: o.face, bezel: o.bezel, ink: o.ink, label: o.label || "VS",
      fmt: function (v) { return String(Math.round(Math.abs(v) / 100)); },
    });
    needle(ctx, cx, cy, r, (clamp(fpm, -lim, lim) + lim) / (lim * 2),
      { a0: 210 * D2R, a1: 510 * D2R, color: o.needle || "#ffffff" });
  }

  // ---- rotating compass card under a fixed lubber line ----
  function compassCard(ctx, cx, cy, r, hdg, o) {
    o = o || {};
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.fillStyle = o.face || "#0b0d10"; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.07); ctx.strokeStyle = o.bezel || "#3a424c"; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.94, 0, TAU); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-hdg * D2R);
    ctx.strokeStyle = o.ink || "#e6edf5";
    for (let d = 0; d < 360; d += 5) {
      const t = (d - 90) * D2R, major = d % 30 === 0;
      ctx.lineWidth = major ? Math.max(1.5, r * 0.045) : Math.max(1, r * 0.025);
      ctx.beginPath();
      ctx.moveTo(Math.cos(t) * r * (major ? 0.66 : 0.76), Math.sin(t) * r * (major ? 0.66 : 0.76));
      ctx.lineTo(Math.cos(t) * r * 0.9, Math.sin(t) * r * 0.9);
      ctx.stroke();
      if (major) {
        const lbl = d === 0 ? "N" : d === 90 ? "E" : d === 180 ? "S" : d === 270 ? "W" : String(d / 10);
        ctx.save();
        ctx.translate(Math.cos(t) * r * 0.5, Math.sin(t) * r * 0.5);
        ctx.rotate(hdg * D2R);
        txt(ctx, lbl, 0, 0, Math.max(8, r * (lbl.length > 1 ? 0.2 : 0.26)), o.ink || "#e6edf5");
        ctx.restore();
      }
    }
    ctx.restore();
    // fixed lubber line + aeroplane
    ctx.fillStyle = o.symbol || "#ffcf4a";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.98); ctx.lineTo(cx - r * 0.09, cy - r * 0.8); ctx.lineTo(cx + r * 0.09, cy - r * 0.8);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = o.symbol || "#ffcf4a"; ctx.lineWidth = Math.max(1.4, r * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.3); ctx.lineTo(cx, cy + r * 0.32);
    ctx.moveTo(cx - r * 0.3, cy); ctx.lineTo(cx + r * 0.3, cy);
    ctx.stroke();
    if (o.digital !== false) {
      const s = String(Math.round(((hdg % 360) + 360) % 360));
      txt(ctx, ("00" + s).slice(-3) + "°", cx, cy + r * 0.62, Math.max(8, r * 0.22), "#9fe8ff");
    }
  }

  // ---- turn coordinator: a rolling aeroplane + the slip ball ----
  function turnCoord(ctx, cx, cy, r, rollRad, slip, o) {
    o = o || {};
    dialFace(ctx, cx, cy, r, { numbers: false, step: 1e9, face: o.face, bezel: o.bezel, label: "TURN" });
    ctx.save();
    ctx.translate(cx, cy - r * 0.16); ctx.rotate(clamp(rollRad, -0.9, 0.9) * 0.8);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1.6, r * 0.06);
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, 0); ctx.lineTo(r * 0.62, 0);
    ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.2);
    ctx.stroke();
    ctx.restore();
    // standard-rate marks
    ctx.strokeStyle = "#c9d4e0"; ctx.lineWidth = Math.max(1.2, r * 0.04);
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(cx + s * r * 0.62, cy - r * 0.36); ctx.lineTo(cx + s * r * 0.62, cy - r * 0.12);
      ctx.stroke();
    });
    // slip/skid ball in its curved tube
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - r * 0.5, cy + r * 0.42, r, r * 0.3); ctx.clip();
    ctx.fillStyle = "#161b21"; ctx.fillRect(cx - r * 0.5, cy + r * 0.42, r, r * 0.3);
    ctx.beginPath();
    ctx.arc(cx + clamp(slip, -1, 1) * r * 0.34, cy + r * 0.57, r * 0.11, 0, TAU);
    ctx.fillStyle = "#e8e2d0"; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#7d8896"; ctx.lineWidth = 1.2;
    [-0.13, 0.13].forEach(function (s) {
      ctx.beginPath(); ctx.moveTo(cx + s * r, cy + r * 0.42); ctx.lineTo(cx + s * r, cy + r * 0.72); ctx.stroke();
    });
  }

  // ---- a bezelled screen panel (the MFD/PFD/ND housing) ----
  function screen(ctx, x, y, w, h, o) {
    o = o || {};
    ctx.fillStyle = o.bezel || "#1d232b";
    ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
    ctx.fillStyle = o.bg || "#05090c";
    ctx.fillRect(x, y, w, h);
    if (o.title) txt(ctx, o.title, x + w / 2, y + 9, 9, o.ink || "#4e5b69");
    // soft screen sheen so a display never reads as a flat hole
    const gr = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    gr.addColorStop(0, "rgba(255,255,255,0.055)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
  }

  // ---- a labelled horizontal bar (torque, fuel, integrity, ordnance) ----
  function bar(ctx, x, y, w, h, frac, o) {
    o = o || {};
    ctx.fillStyle = o.bg || "#10151b"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = o.color || "#5ad07a";
    ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(frac, 0, 1)), h - 2);
    ctx.strokeStyle = o.ink || "#39424e"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (o.label) txt(ctx, o.label, x - 6, y + h / 2, Math.max(7, h * 0.78), o.labelInk || "#8e9cad", "right");
    if (o.value) txt(ctx, o.value, x + w + 6, y + h / 2, Math.max(7, h * 0.78), o.labelInk || "#8e9cad", "left");
  }

  // ---- the caution/annunciator block: only lights when something is wrong.
  // Reads live warnings out of the flight state — never a decorative panel.
  function caution(ctx, x, y, w, h, list, o) {
    o = o || {};
    const rows = 2, cols = 2, cw = w / cols, ch = h / rows;
    for (let i = 0; i < 4; i++) {
      const it = list[i];
      const cx2 = x + (i % cols) * cw, cy2 = y + ((i / cols) | 0) * ch;
      ctx.fillStyle = it && it.on ? (it.color || "#c8341f") : "#161b22";
      ctx.fillRect(cx2 + 1, cy2 + 1, cw - 2, ch - 2);
      if (it) txt(ctx, it.text, cx2 + cw / 2, cy2 + ch / 2, Math.max(7, ch * 0.42),
        it.on ? "#fff4e2" : "#39424e", "center", 700);
    }
  }

  const G = { txt, adi, dialFace, needle, dial: dialFace, tape, vsi, compassCard, turnCoord, screen, bar, caution, clamp };
  CBZ.cockpitGauges = G;

  // ============================================================
  //  LAYOUTS — one page of furniture per cockpit class.
  //  draw(ctx, W, H, S, PAL, base) paints the LIVE elements; drawBase()
  //  paints the furniture that never changes (cached, blitted per frame).
  //  S is the flight state struct built by cockpit.js.
  // ============================================================
  function panelBackdrop(ctx, W, H, PAL) {
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, PAL.panelTop || "#1b2027");
    gr.addColorStop(1, PAL.panelBot || "#0e1116");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    // panel screws + seam lines: two strokes that stop the face reading as
    // one flat rectangle at any distance
    ctx.strokeStyle = "rgba(255,255,255,0.045)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H * 0.06); ctx.lineTo(W, H * 0.06); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * 0.94); ctx.lineTo(W, H * 0.94); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 14; i++) {
      ctx.beginPath(); ctx.arc(24 + i * (W - 48) / 13, 14, 3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(24 + i * (W - 48) / 13, H - 14, 3, 0, TAU); ctx.fill();
    }
  }

  // small shared readout row used by several layouts
  function statusRow(ctx, x, y, w, S, PAL) {
    bar(ctx, x, y, w, 12, S.hp, { color: S.hp < 0.35 ? "#d8452c" : "#5ad07a", label: "AIRFRAME", value: Math.round(S.hp * 100) + "%" });
    bar(ctx, x, y + 20, w, 12, S.thr, { color: "#e0a23c", label: "PWR", value: Math.round(S.thr * 100) + "%" });
    if (S.maxAmmo > 0) bar(ctx, x, y + 40, w, 12, S.ammo / S.maxAmmo, { color: "#7fb4ff", label: "ORDNANCE", value: S.ammo + "/" + S.maxAmmo });
  }

  // ============================================================
  //  THE STATE CONTRACT. Every layout below reads fields off S. A layout is
  //  a page of furniture, NOT a place to write defensive `|| 0`s — so the
  //  ONE normalizer lives here and every paint runs through it. An airframe
  //  that has no rotor still gets a rotor gauge reading zero rather than a
  //  half-painted panel (a thrown TypeError inside a layout used to be
  //  swallowed by the try/catch below, leaving the glass visibly torn).
  //  NOTE these are the units the layouts are drawn in — knots, feet,
  //  feet/min, degrees — NOT the game's metres. cockpit.js converts once.
  // ============================================================
  const S_DEFAULTS = {
    ias: 0, gs: 0, mach: 0, alt: 0, agl: 0, vsi: 0, hdg: 0,
    pitch: 0, roll: 0, aoa: 0, slip: 0, slipDeg: 0, g: 1,
    thr: 0, rpm: 0, rotor: 0, ng: 0, torque: 0, fuel: 1,
    hp: 1, ammo: 0, maxAmmo: 0, vne: 999,
    stalled: false, gear: false, onGround: true, autorotating: false,
    bayOpen: false, lock: false, name: "",
  };
  function normalizeState(S) {
    S = S || {};
    for (const k in S_DEFAULTS) {
      const d = S_DEFAULTS[k];
      if (typeof d === "number") { const v = +S[k]; S[k] = Number.isFinite(v) ? v : d; }
      else if (typeof d === "boolean") S[k] = !!S[k];
      else if (S[k] == null) S[k] = d;
    }
    return S;
  }
  CBZ.cockpitNormalizeState = normalizeState;

  const LAYOUTS = {
    // ---- FIGHTER: two MFDs and an up-front control panel. The pilot flies
    // off the HUD; the panel is for stores, systems and a standby horizon.
    fighter: {
      // Layouts draw in ABSOLUTE pixels, so each declares the canvas it was
      // composed for. cockpit.js sizes the texture and the panel mesh's
      // aspect ratio from this — nobody hand-measures a layout again.
      size: [1024, 384],
      base: function (ctx, W, H, PAL) {
        panelBackdrop(ctx, W, H, PAL);
        screen(ctx, 40, 70, 250, 250, { title: "TSD", bezel: PAL.bezel });
        screen(ctx, W - 290, 70, 250, 250, { title: "STORES", bezel: PAL.bezel });
        txt(ctx, "UP-FRONT CONTROL", W / 2, 44, 12, "#59677a");
        ctx.strokeStyle = "#2a323c"; ctx.lineWidth = 2;
        ctx.strokeRect(W / 2 - 150, 62, 300, 96);
      },
      draw: function (ctx, W, H, S, PAL) {
        // standby attitude + speed/alt read-out on the centre panel
        adi(ctx, W / 2, 236, 82, S.pitch, S.roll, { face: "#0a0d11", symbol: "#ffcf4a" });
        txt(ctx, "STBY ADI", W / 2, 330, 11, "#59677a");
        // up-front control: the four numbers a fighter pilot reads without the HUD
        txt(ctx, (S.ias | 0) + " KT", W / 2 - 74, 88, 26, "#67ff9c", "center", 700);
        txt(ctx, (S.alt | 0) + " FT", W / 2 + 74, 88, 26, "#67ff9c", "center", 700);
        txt(ctx, "M " + S.mach.toFixed(2), W / 2 - 74, 126, 20, "#67ff9c");
        txt(ctx, "G " + S.g.toFixed(1), W / 2 + 74, 126, 20, S.g > 7 ? "#ff8a5a" : "#67ff9c");
        // LEFT MFD — tactical situation: heading rose + the live target ring
        compassCard(ctx, 165, 195, 100, S.hdg, { face: "#04140a", bezel: "#1d3626", ink: "#59d97e", symbol: "#9dffbd" });
        txt(ctx, "AGL " + (S.agl | 0), 165, 300, 13, "#59d97e");
        // RIGHT MFD — stores and systems
        statusRow(ctx, W - 250, 130, 170, S, PAL);
        txt(ctx, S.name, W - 165, 96, 13, "#7fb4ff");
        vsi(ctx, W - 165, 250, 58, S.vsi, { face: "#04140a", bezel: "#1d3626", ink: "#59d97e", needle: "#9dffbd" });
        // master caution strip
        caution(ctx, W / 2 - 150, 268, 300, 62, [
          { text: "STALL", on: S.stalled, color: "#c8341f" },
          { text: "GEAR", on: S.gear, color: "#1f7a3a" },
          { text: "LOW ALT", on: S.agl < 60 && !S.onGround, color: "#c07a1f" },
          { text: "DAMAGE", on: S.hp < 0.45, color: "#c8341f" },
        ]);
      },
    },

    // ---- HELICOPTER: a low, narrow panel — you must see over it. Airspeed,
    // altimeter, ADI, VSI, and the married-needle rotor/engine tachometer
    // that is the single most helicopter thing on any instrument panel.
    heli: {
      size: [1024, 384],
      base: function (ctx, W, H, PAL) {
        panelBackdrop(ctx, W, H, PAL);
        dialFace(ctx, 120, 150, 92, {
          min: 0, max: 160, step: 20, sub: 5, label: "AIRSPEED KT",
          arcs: [[0, 30, "#5b6470"], [30, 120, "#2f7a3c"], [120, 145, "#a8862a"]], redline: 150,
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, 340, 150, 92, {
          min: 0, max: 10, step: 1, sub: 0.5, label: "ALT x100 FT",
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, 690, 150, 92, {
          min: 0, max: 120, step: 20, sub: 5, label: "ROTOR / ENG %",
          arcs: [[0, 90, "#a8862a"], [90, 108, "#2f7a3c"], [108, 120, "#8c2a1e"]], redline: 110,
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, 900, 150, 92, {
          min: 0, max: 120, step: 20, sub: 10, label: "TORQUE %",
          arcs: [[0, 85, "#2f7a3c"], [85, 100, "#a8862a"], [100, 120, "#8c2a1e"]],
          face: PAL.dialFace, bezel: PAL.bezel,
        });
      },
      draw: function (ctx, W, H, S, PAL) {
        needle(ctx, 120, 150, 92, S.ias / 160, { color: "#ffffff" });
        needle(ctx, 340, 150, 92, ((S.alt / 100) % 10) / 10, { color: "#ffffff" });
        needle(ctx, 340, 150, 92, clamp(S.alt / 10000, 0, 1), { color: "#c6ccd4", len: 0.5, w: 0.09 });
        adi(ctx, 505, 150, 84, S.pitch, S.roll, { face: "#0a0d11" });
        // the married needles: rotor Nr (white) over engine Ng (amber)
        needle(ctx, 690, 150, 92, S.rotor * 100 / 120, { color: "#ffffff" });
        needle(ctx, 690, 150, 92, S.ng * 100 / 120, { color: "#ffb648", len: 0.62, w: 0.04, hub: false });
        needle(ctx, 900, 150, 92, S.torque * 100 / 120, { color: "#ffffff" });
        vsi(ctx, 505, 300, 62, S.vsi, { face: "#0a0d11", label: "VS x100" });
        compassCard(ctx, 690, 300, 62, S.hdg, { face: "#0a0d11" });
        statusRow(ctx, 96, 268, 190, S, PAL);
        caution(ctx, 830, 250, 150, 64, [
          { text: "LOW RPM", on: S.rotor < 0.85, color: "#c8341f" },
          { text: "AUTOROT", on: S.autorotating, color: "#c07a1f" },
          { text: "TORQUE", on: S.torque > 1.0, color: "#c07a1f" },
          { text: "DAMAGE", on: S.hp < 0.45, color: "#c8341f" },
        ]);
      },
    },

    // ---- AIRLINER: the captain's side of a glass flight deck. One big PFD
    // (attitude with the speed tape left, altitude tape right, heading strip
    // under) and a navigation display beside it. Boeing greys, magenta bugs.
    airliner: {
      size: [1024, 384],
      base: function (ctx, W, H, PAL) {
        panelBackdrop(ctx, W, H, PAL);
        screen(ctx, 34, 54, 300, 300, { title: "", bezel: PAL.bezel });
        screen(ctx, 360, 54, 300, 300, { title: "ND", bezel: PAL.bezel });
        screen(ctx, 690, 54, 300, 300, { title: "EICAS", bezel: PAL.bezel });
      },
      draw: function (ctx, W, H, S, PAL) {
        // ---- PFD ----
        const px = 34, py = 54, pw = 300, ph = 300;
        adi(ctx, px + pw * 0.5, py + ph * 0.44, 92, S.pitch, S.roll, {
          square: true, halfW: 86, halfH: 88, pxPerDeg: 4.2, sky: "#2f79c0", ground: "#7a5a2c",
        });
        tape(ctx, px + 6, py + 40, 46, 210, S.ias, { span: 120, step: 10, title: "IAS", perUnit: 210 / 120 });
        tape(ctx, px + pw - 62, py + 40, 56, 210, S.alt, { span: 2000, step: 200, right: true, title: "ALT", perUnit: 210 / 2000 });
        // heading strip along the bottom
        ctx.save();
        ctx.beginPath(); ctx.rect(px + 10, py + ph - 44, pw - 20, 30); ctx.clip();
        ctx.fillStyle = "rgba(10,14,20,0.75)"; ctx.fillRect(px + 10, py + ph - 44, pw - 20, 30);
        const hcx = px + pw / 2;
        for (let d = -60; d <= 60; d += 10) {
          const hh = Math.round((S.hdg + d) / 10) * 10;
          const hx = hcx + (hh - S.hdg) * 2.2;
          ctx.strokeStyle = "#dfe8f2"; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(hx, py + ph - 44); ctx.lineTo(hx, py + ph - 36); ctx.stroke();
          txt(ctx, String((((hh % 360) + 360) % 360) / 10 | 0), hx, py + ph - 25, 11, "#dfe8f2");
        }
        ctx.restore();
        ctx.fillStyle = "#ff4df0";
        ctx.beginPath();
        ctx.moveTo(hcx, py + ph - 46); ctx.lineTo(hcx - 6, py + ph - 56); ctx.lineTo(hcx + 6, py + ph - 56);
        ctx.closePath(); ctx.fill();
        txt(ctx, "V/S " + (S.vsi > 0 ? "+" : "") + (Math.round(S.vsi / 50) * 50), px + pw - 34, py + ph - 60, 12, "#7fe0a0");
        // ---- ND: a plan view with the aircraft at the bottom, track up ----
        const nx = 360 + 150, ny = 54 + 250;
        ctx.save();
        ctx.beginPath(); ctx.rect(360, 54, 300, 300); ctx.clip();
        ctx.strokeStyle = "#2c4a3c"; ctx.lineWidth = 1.4;
        [70, 140, 210].forEach(function (r) {
          ctx.beginPath(); ctx.arc(nx, ny, r, PI * 1.15, PI * 1.85); ctx.stroke();
        });
        ctx.strokeStyle = "#d8dee6"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nx, ny - 230); ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(nx, ny - 14); ctx.lineTo(nx - 9, ny + 6); ctx.lineTo(nx + 9, ny + 6);
        ctx.closePath(); ctx.fill();
        txt(ctx, "TRK " + ("00" + Math.round(S.hdg)).slice(-3), nx, 78, 14, "#59d97e");
        txt(ctx, "GS " + Math.round(S.gs), 400, 108, 13, "#59d97e", "left");
        ctx.restore();
        // ---- EICAS: engines + the airframe status stack ----
        const ex = 690;
        for (let i = 0; i < 2; i++) {
          dialFace(ctx, ex + 74 + i * 150, 140, 58, {
            min: 0, max: 110, step: 25, label: i ? "N1 R" : "N1 L",
            arcs: [[0, 95, "#2f7a3c"], [95, 110, "#8c2a1e"]], face: "#080b0f", bezel: "#232a33",
          });
          needle(ctx, ex + 74 + i * 150, 140, 58, S.thr * 100 / 110, { color: "#7fe0a0" });
        }
        statusRow(ctx, ex + 80, 236, 200, S, PAL);
        caution(ctx, ex + 20, 292, 260, 54, [
          { text: "GEAR DN", on: S.gear, color: "#1f7a3a" },
          { text: "STALL", on: S.stalled, color: "#c8341f" },
          { text: "OVERSPD", on: S.ias > S.vne, color: "#c07a1f" },
          { text: "DAMAGE", on: S.hp < 0.45, color: "#c8341f" },
        ]);
      },
    },

    // ---- BOMBER: heads-down by design. Four monochrome-green MFDs, no
    // decorative anything, a moving map and the bay/ordnance page.
    bomber: {
      size: [1024, 384],
      base: function (ctx, W, H, PAL) {
        panelBackdrop(ctx, W, H, PAL);
        for (let i = 0; i < 4; i++) screen(ctx, 40 + i * 245, 80, 210, 240, { bezel: "#14181d", bg: "#03080a" });
      },
      draw: function (ctx, W, H, S, PAL) {
        const ink = "#5ce08a";
        adi(ctx, 145, 190, 88, S.pitch, S.roll, {
          square: true, halfW: 100, halfH: 112, mono: true, ink: ink, symbol: "#c8ffdc", pxPerDeg: 3.4,
        });
        txt(ctx, "ATT", 145, 306, 11, ink);
        compassCard(ctx, 390, 185, 92, S.hdg, { face: "#03080a", bezel: "#14181d", ink: ink, symbol: "#c8ffdc" });
        txt(ctx, "NAV", 390, 306, 11, ink);
        txt(ctx, (S.ias | 0), 635, 140, 40, ink, "center", 700);
        txt(ctx, "KIAS", 635, 172, 12, ink);
        txt(ctx, (S.alt | 0), 635, 226, 34, ink, "center", 700);
        txt(ctx, "FT MSL", 635, 254, 12, ink);
        txt(ctx, "VS " + Math.round(S.vsi), 635, 292, 14, ink);
        statusRow(ctx, 810, 130, 180, S, PAL);
        txt(ctx, "STORES", 880, 108, 12, ink);
        caution(ctx, 800, 240, 200, 66, [
          { text: "BAY", on: !!S.bayOpen, color: "#1f7a3a" },
          { text: "STALL", on: S.stalled, color: "#c8341f" },
          { text: "LOW ALT", on: S.agl < 90 && !S.onGround, color: "#c07a1f" },
          { text: "DAMAGE", on: S.hp < 0.45, color: "#c8341f" },
        ]);
      },
    },

    // ---- PROP / GA: the six-pack in its standard T. Everything round,
    // everything mechanical, the cheapest cockpit to read at a glance.
    prop: {
      size: [1024, 512],
      base: function (ctx, W, H, PAL) {
        panelBackdrop(ctx, W, H, PAL);
        const R = 96, xs = [190, 400, 610], ys = [140, 330];
        dialFace(ctx, xs[0], ys[0], R, {
          min: 0, max: 200, step: 20, sub: 5, label: "AIRSPEED KT",
          arcs: [[35, 85, "#c8ccd2"], [50, 160, "#2f7a3c"], [160, 190, "#a8862a"]], redline: 190,
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, xs[2], ys[0], R, {
          min: 0, max: 10, step: 1, sub: 0.2, label: "ALTITUDE",
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, xs[2], ys[1], R, {
          min: -2000, max: 2000, step: 1000, sub: 250, a0: 210 * D2R, a1: 510 * D2R, label: "VERT SPEED",
          fmt: function (v) { return String(Math.abs(v) / 1000); }, face: PAL.dialFace, bezel: PAL.bezel,
        });
        dialFace(ctx, 830, ys[0], 72, {
          min: 0, max: 30, step: 5, label: "RPM x100",
          arcs: [[19, 26, "#2f7a3c"], [26, 30, "#8c2a1e"]], face: PAL.dialFace, bezel: PAL.bezel,
        });
        // AIRFRAME, not FUEL. There is no fuel model in this game, and a
        // needle pinned at F forever is exactly the "stat fiction" CLAUDE.md
        // bans — a gauge that claims to measure something with no world
        // presence. This one reads hull integrity, which is real, which the
        // damage system already tracks, and which you very much want to know.
        dialFace(ctx, 830, ys[1], 60, {
          min: 0, max: 1, step: 0.5, numbers: false, label: "AIRFRAME",
          arcs: [[0, 0.35, "#8c2a1e"], [0.35, 0.7, "#a8862a"]],
          face: PAL.dialFace, bezel: PAL.bezel,
        });
        txt(ctx, "0", 830 - 40, 330 + 14, 13, "#c8ccd2");
        txt(ctx, "1", 830 + 40, 330 + 14, 13, "#c8ccd2");
      },
      draw: function (ctx, W, H, S, PAL) {
        const R = 96, xs = [190, 400, 610], ys = [140, 330];
        needle(ctx, xs[0], ys[0], R, S.ias / 200, {});
        adi(ctx, xs[1], ys[0], R, S.pitch, S.roll, { face: "#0a0d11" });
        // three-pointer altimeter: 100s (long), 1000s (medium), 10000s (short)
        needle(ctx, xs[2], ys[0], R, ((S.alt / 100) % 10) / 10, { color: "#ffffff", len: 0.86, w: 0.04 });
        needle(ctx, xs[2], ys[0], R, ((S.alt / 1000) % 10) / 10, { color: "#e2e7ee", len: 0.58, w: 0.085, hub: false });
        needle(ctx, xs[2], ys[0], R, clamp(S.alt / 100000, 0, 1), { color: "#b7c0cc", len: 0.34, w: 0.11, hub: false });
        turnCoord(ctx, xs[0], ys[1], R, S.roll, S.slip, { face: PAL.dialFace, bezel: PAL.bezel });
        compassCard(ctx, xs[1], ys[1], R, S.hdg, { face: PAL.dialFace, bezel: PAL.bezel });
        needle(ctx, xs[2], ys[1], R, (clamp(S.vsi, -2000, 2000) + 2000) / 4000, { a0: 210 * D2R, a1: 510 * D2R });
        needle(ctx, 830, ys[0], 72, S.rpm, {});
        needle(ctx, 830, ys[1], 60, S.hp, { color: S.hp < 0.35 ? "#ff7a5a" : "#ffd27a" });
        statusRow(ctx, 96, 452, 190, S, PAL);
      },
    },
  };
  CBZ.cockpitLayouts = LAYOUTS;

  // ============================================================
  //  HEAD-UP SYMBOLOGY — the fighter's combining glass. Drawn on its own
  //  transparent canvas, green on nothing, and mapped to a small pane in
  //  front of the pilot's eye. Everything here is boresight-referenced:
  //  the pitch ladder and velocity vector move with the aircraft, the gun
  //  cross does not. That relationship IS the instrument.
  // ============================================================
  function hudDraw(ctx, W, H, S, o) {
    o = o || {};
    const ink = o.ink || "#7dff9e";
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.lineWidth = 2.4; ctx.strokeStyle = ink; ctx.fillStyle = ink;
    const cx = W / 2, cy = H / 2;
    // ---- pitch ladder + horizon, rolled and pitched about boresight ----
    const pxPerDeg = H / 34;
    ctx.save();
    ctx.beginPath(); ctx.rect(W * 0.06, H * 0.06, W * 0.88, H * 0.88); ctx.clip();
    ctx.translate(cx, cy); ctx.rotate(-S.roll);
    const off = S.pitch * pxPerDeg;
    ctx.beginPath();
    ctx.moveTo(-W * 0.46, off); ctx.lineTo(-W * 0.1, off);
    ctx.moveTo(W * 0.1, off); ctx.lineTo(W * 0.46, off);
    ctx.stroke();
    for (let d = -60; d <= 60; d += 5) {
      if (!d) continue;
      const y = off - d * pxPerDeg;
      if (Math.abs(y) > H * 0.52) continue;
      const half = (d % 10 === 0) ? W * 0.15 : W * 0.09;
      ctx.beginPath();
      if (d < 0) ctx.setLineDash([7, 6]);
      ctx.moveTo(-half, y); ctx.lineTo(-half * 0.35, y);
      ctx.lineTo(-half * 0.35, y + (d > 0 ? 8 : -8));
      ctx.moveTo(half, y); ctx.lineTo(half * 0.35, y);
      ctx.lineTo(half * 0.35, y + (d > 0 ? 8 : -8));
      ctx.stroke(); ctx.setLineDash([]);
      if (d % 10 === 0) {
        txt(ctx, String(Math.abs(d)), -half - 16, y, 15, ink);
        txt(ctx, String(Math.abs(d)), half + 16, y, 15, ink);
      }
    }
    ctx.restore();
    // ---- velocity vector: where the jet is actually GOING, not pointing.
    // The gap between it and the boresight cross is the whole point of a HUD.
    const vvx = cx + clamp(S.slipDeg, -14, 14) * pxPerDeg;
    const vvy = cy + clamp(S.aoa, -18, 18) * pxPerDeg;
    ctx.beginPath();
    ctx.arc(vvx, vvy, 11, 0, TAU);
    ctx.moveTo(vvx - 11, vvy); ctx.lineTo(vvx - 26, vvy);
    ctx.moveTo(vvx + 11, vvy); ctx.lineTo(vvx + 26, vvy);
    ctx.moveTo(vvx, vvy - 11); ctx.lineTo(vvx, vvy - 22);
    ctx.stroke();
    // ---- boresight gun cross (fixed) ----
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy - H * 0.2); ctx.lineTo(cx + 16, cy - H * 0.2);
    ctx.moveTo(cx, cy - H * 0.2 - 12); ctx.lineTo(cx, cy - H * 0.2 + 12);
    ctx.stroke();
    // ---- speed box (left) / altitude box (right) ----
    ctx.lineWidth = 2;
    ctx.strokeRect(W * 0.09, cy - 17, 92, 34);
    txt(ctx, String(S.ias | 0), W * 0.09 + 46, cy, 25, ink, "center", 700);
    txt(ctx, "M " + S.mach.toFixed(2), W * 0.09 + 46, cy - 30, 14, ink);
    txt(ctx, "G " + S.g.toFixed(1), W * 0.09 + 46, cy + 30, 14, ink);
    ctx.strokeRect(W * 0.91 - 108, cy - 17, 108, 34);
    txt(ctx, String(S.alt | 0), W * 0.91 - 54, cy, 25, ink, "center", 700);
    txt(ctx, "R " + (S.agl | 0), W * 0.91 - 54, cy + 30, 14, ink);
    // ---- heading tape across the top ----
    ctx.save();
    ctx.beginPath(); ctx.rect(W * 0.22, H * 0.06, W * 0.56, 34); ctx.clip();
    for (let d = -50; d <= 50; d += 10) {
      const hh = Math.round((S.hdg + d) / 10) * 10;
      const hx = cx + (hh - S.hdg) * (W * 0.0075);
      ctx.beginPath(); ctx.moveTo(hx, H * 0.06 + 20); ctx.lineTo(hx, H * 0.06 + 30); ctx.stroke();
      txt(ctx, ("00" + (((hh % 360) + 360) % 360)).slice(-3).slice(0, 2), hx, H * 0.06 + 10, 14, ink);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.06 + 40); ctx.lineTo(cx - 7, H * 0.06 + 32); ctx.lineTo(cx + 7, H * 0.06 + 32);
    ctx.closePath(); ctx.fill();
    // ---- AoA bracket on the left rail (on-speed indexer) ----
    const ay = cy + clamp(-S.aoa * 4, -70, 70);
    ctx.beginPath();
    ctx.moveTo(W * 0.055, ay - 9); ctx.lineTo(W * 0.035, ay); ctx.lineTo(W * 0.055, ay + 9);
    ctx.stroke();
    // ---- mode line + warnings ----
    txt(ctx, o.mode || "NAV", cx, H * 0.9, 16, ink);
    if (S.stalled) txt(ctx, "STALL", cx, H * 0.78, 30, "#ff6a4a", "center", 800);
    else if (S.gear) txt(ctx, "GEAR DOWN", cx, H * 0.78, 18, ink);
    if (S.maxAmmo > 0) txt(ctx, "MSL " + S.ammo, W * 0.09 + 46, H * 0.82, 16, ink);
    if (S.lock) txt(ctx, "LOCK", cx, H * 0.7, 20, "#ffd166", "center", 800);
    ctx.restore();
  }
  CBZ.cockpitHudDraw = hudDraw;

  // ============================================================
  //  BASE-CACHE — furniture is painted once. Layout authors get this for
  //  free: write base() and draw(), and the expensive half never re-runs.
  // ============================================================
  CBZ.cockpitPaintPanel = function (ctx, base, W, H, S, PAL, layoutId) {
    const L = LAYOUTS[layoutId] || LAYOUTS.prop;
    S = normalizeState(S);
    if (base) ctx.drawImage(base, 0, 0);
    else { ctx.clearRect(0, 0, W, H); L.base(ctx, W, H, PAL || {}); }
    try { L.draw(ctx, W, H, S, PAL || {}); } catch (e) {}
  };
  CBZ.cockpitPaintBase = function (ctx, W, H, PAL, layoutId) {
    const L = LAYOUTS[layoutId] || LAYOUTS.prop;
    ctx.clearRect(0, 0, W, H);
    try { L.base(ctx, W, H, PAL || {}); } catch (e) {}
  };
  // The canvas each layout was composed for. cockpit.js asks the LAYOUT how
  // big it wants to be rather than every airframe declaring a texture size —
  // one less number an airframe author has to invent.
  CBZ.cockpitLayoutSize = function (layoutId) {
    const L = LAYOUTS[layoutId] || LAYOUTS.prop;
    return { w: (L.size && L.size[0]) || 1024, h: (L.size && L.size[1]) || 384 };
  };
  CBZ.cockpitHasLayout = function (layoutId) { return !!LAYOUTS[layoutId]; };
})();
