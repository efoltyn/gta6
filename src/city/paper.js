/* ============================================================
   city/paper.js — A SHEET OF PAPER SOMEBODY HANDS YOU.

   OWNER: "No dashboards are needed. Everything can be existing."

   Gang City's lists used to be HTML panels: a job board, a car-yard table,
   an "Empire" screen, a bet slip, a storage menu. What is left of a list in
   the world is a piece of paper: the job a man wrote down for you, the
   ledger a manager turns round on his desk, the race card at the betting
   window, the ticket the bookmaker tears off. This file draws that paper
   and puts it in your hands (CBZ.hmHold, city/hitman_hands.js: a real plane
   in front of the camera; you can still walk and look while you read it,
   and E, J, Esc or a tap puts it away).

   ONE SHEET AT A TIME, described, not drawn by the caller:
     CBZ.cityPaper.show({
       key      who owns the sheet now (isUp(key) asks)
       org      the letterhead ("PREMIUM AUTOS"); title, the form's name
       ink      the letterhead's colour; tone, the paper's
       hand     true = a note in somebody's handwriting (no letterhead)
       lines    what is on it, top to bottom:
                  { k, v, big? }        a ruled line: label left, value right
                  { text, italic?, dim? } a sentence (wraps)
                  { cols: [..], head?, mark?, strike? }  a table row; mark
                                        circles it in pen, strike rules it out
                  { gap }               air
       foot     small print under the last line
       stamp    a rubber stamp ("PAID"), sign: a signature on the line
       onClose  called when it leaves your hands
     })
     CBZ.cityPaper.isUp(key?) / down(key?)

   The sheet stands on the right of the view so the person you are dealing
   with stays in it (city/bank.js's slips do the same).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof document === "undefined") return;

  const CW = 1500, CH = 1000;          // the canvas the held plane shows
  const SW = 640;                      // the sheet's width on it
  const PAD = 36;
  let cv = null, cur = null;

  let swapping = false;
  function canvas() {
    // core/texfree.js gives a painted canvas's pixels back (1x1) once its
    // texture has sat on the GPU for 30 s: the sheet in your hands is fine,
    // but the next thing written has to go on a new one
    if (cv && cv.width !== CW) cv = null;
    if (!cv) { cv = document.createElement("canvas"); cv.width = CW; cv.height = CH; }
    return cv;
  }
  const SERIF = "Georgia, 'Times New Roman', serif";
  const SANS = "Helvetica, Arial, sans-serif";
  const MONO = "'Courier New', Courier, monospace";
  const PEN = "'Bradley Hand', 'Segoe Print', 'Marker Felt', 'Comic Sans MS', cursive";

  function wrap(c, text, maxW) {
    const words = String(text == null ? "" : text).split(/\s+/), out = [];
    let line = "";
    for (let i = 0; i < words.length; i++) {
      const t = line ? line + " " + words[i] : words[i];
      if (line && c.measureText(t).width > maxW) { out.push(line); line = words[i]; }
      else line = t;
    }
    if (line) out.push(line);
    return out;
  }
  // how tall one line is, so the sheet is cut to what is written on it
  function heightOf(c, ln, hand, innerW) {
    if (ln.gap != null) return ln.gap;
    if (ln.cols) return ln.head ? 40 : 46;
    if (ln.text != null) {
      c.font = (ln.italic ? "italic " : "") + (hand ? "400 34px " + PEN : "400 25px " + SERIF);
      return wrap(c, ln.text, innerW).length * (hand ? 44 : 34) + 10;
    }
    return ln.big ? 84 : 62;
  }
  function draw(spec) {
    const c = canvas().getContext("2d");
    c.clearRect(0, 0, CW, CH);
    const hand = !!spec.hand;
    const w = spec.w || SW, innerW = w - PAD * 2;
    const lines = spec.lines || [];
    const headH = hand ? 26 : 78;
    let bodyH = 0;
    for (let i = 0; i < lines.length; i++) bodyH += heightOf(c, lines[i], hand, innerW);
    c.font = "italic 20px " + SERIF;
    const footLines = spec.foot ? wrap(c, spec.foot, innerW) : [];
    const tail = (footLines.length ? footLines.length * 26 + 16 : 0) + (spec.stamp || spec.sign ? 96 : 0);
    const h = Math.min(CH - 60, headH + 30 + bodyH + tail + 26);
    const x = spec.center ? (CW - w) / 2 : CW - w - 56;
    const y = Math.max(30, (CH - h) / 2);

    c.save();
    if (hand) { c.translate(x + w / 2, y + h / 2); c.rotate(-0.025); c.translate(-(x + w / 2), -(y + h / 2)); }
    c.save();
    c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 26; c.shadowOffsetY = 10;
    c.fillStyle = spec.tone || (hand ? "#f4eeda" : "#f7f3e8");
    c.fillRect(x, y, w, h);
    c.restore();
    c.textBaseline = "middle";
    if (hand) {
      // a torn-off sheet: faint rules, nothing printed
      c.strokeStyle = "rgba(70,96,140,.22)"; c.lineWidth = 1.5;
      for (let ry = y + 64; ry < y + h - 12; ry += 44) { c.beginPath(); c.moveTo(x + 14, ry); c.lineTo(x + w - 14, ry); c.stroke(); }
    } else {
      c.fillStyle = spec.ink || "#1d3a5c"; c.fillRect(x, y, w, 74);
      c.fillStyle = "#f7f3e8"; c.textAlign = "left";
      let fs = 32; c.font = "700 " + fs + "px " + SERIF;
      const org = String(spec.org || "").toUpperCase();
      c.font = "600 21px " + SANS;
      const tw = spec.title ? c.measureText(spec.title).width + 30 : 0;
      c.font = "700 " + fs + "px " + SERIF;
      while (fs > 18 && c.measureText(org).width > innerW - tw) { fs -= 2; c.font = "700 " + fs + "px " + SERIF; }
      c.fillText(org, x + 28, y + 38);
      if (spec.title) { c.textAlign = "right"; c.font = "600 21px " + SANS; c.fillText(spec.title, x + w - 28, y + 39); }
    }
    let cy = y + headH + 30;
    const lx = x + PAD;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i], lh = heightOf(c, ln, hand, innerW);
      if (cy + lh > y + h - tail - 8) break;                 // never off the sheet
      if (ln.gap != null) { cy += lh; continue; }
      if (ln.cols) {
        const n = ln.cols.length, ws = spec.colw || null;
        let px = lx;
        c.font = ln.head ? "700 18px " + SANS : (hand ? "400 30px " + PEN : "600 25px " + MONO);
        c.fillStyle = ln.head ? "#6a6458" : (ln.dim ? "#8a8474" : "#16140f");
        for (let k = 0; k < n; k++) {
          const cw = ws ? ws[k] * innerW : innerW / n;
          const right = k > 0 && k === n - 1;
          c.textAlign = right ? "right" : "left";
          let s = String(ln.cols[k] == null ? "" : ln.cols[k]);
          while (s.length > 3 && c.measureText(s).width > cw - 8) s = s.slice(0, -2);
          c.fillText(s, right ? px + cw : px, cy + lh / 2);
          px += cw;
        }
        if (ln.head) { c.strokeStyle = "#8f8876"; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, cy + lh - 3); c.lineTo(lx + innerW, cy + lh - 3); c.stroke(); }
        if (ln.strike) { c.strokeStyle = "#16140f"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(lx - 4, cy + lh / 2 + 2); c.lineTo(lx + innerW + 4, cy + lh / 2 - 3); c.stroke(); }
        if (ln.mark) {
          // circled in pen: the one you picked
          c.save(); c.strokeStyle = "#1b3fa8"; c.lineWidth = 3.5; c.beginPath();
          c.ellipse(lx + innerW / 2, cy + lh / 2, innerW / 2 + 12, lh / 2 + 1, -0.012, 0.25, Math.PI * 2 + 0.55);
          c.stroke(); c.restore();
        }
        cy += lh; continue;
      }
      if (ln.text != null) {
        c.font = (ln.italic ? "italic " : "") + (hand ? "400 34px " + PEN : "400 25px " + SERIF);
        c.fillStyle = ln.dim ? "#6a6458" : (hand ? "#1c2a5e" : "#26231d"); c.textAlign = "left";
        const rows = wrap(c, ln.text, innerW), step = hand ? 44 : 34;
        for (let r = 0; r < rows.length; r++) c.fillText(rows[r], lx, cy + step / 2 + r * step);
        cy += lh; continue;
      }
      // a ruled line: label left, value right
      c.fillStyle = "#6a6458"; c.font = "600 20px " + SANS; c.textAlign = "left";
      c.fillText(String(ln.k || ""), lx, cy + lh / 2 - 6);
      c.fillStyle = "#16140f"; c.textAlign = "right";
      let vf = ln.big ? 42 : 28; c.font = (ln.big ? "700 " : "600 ") + vf + "px " + MONO;
      const v = String(ln.v == null ? "" : ln.v);
      c.font = "600 20px " + SANS; const kw = c.measureText(String(ln.k || "")).width + 18;
      c.font = (ln.big ? "700 " : "600 ") + vf + "px " + MONO;
      while (vf > 16 && c.measureText(v).width > innerW - kw) { vf -= 2; c.font = (ln.big ? "700 " : "600 ") + vf + "px " + MONO; }
      c.fillText(v, lx + innerW, cy + lh / 2 - 6);
      c.strokeStyle = "#b9b2a0"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(lx, cy + lh - 14); c.lineTo(lx + innerW, cy + lh - 14); c.stroke();
      cy += lh;
    }
    if (footLines.length) {
      c.fillStyle = "#6a6458"; c.font = "italic 20px " + SERIF; c.textAlign = "left";
      for (let r = 0; r < footLines.length; r++) c.fillText(footLines[r], lx, cy + 20 + r * 26);
    }
    if (spec.sign) {
      c.strokeStyle = "#6a6458"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(lx, y + h - 40); c.lineTo(lx + 300, y + h - 40); c.stroke();
      c.fillStyle = "#1b3fa8"; c.font = "400 40px " + PEN; c.textAlign = "left"; c.fillText(String(spec.sign), lx + 12, y + h - 60);
    }
    if (spec.stamp) {
      c.save(); c.translate(x + w - 150, y + h - 62); c.rotate(-0.16);
      const col = spec.stampInk || "#a3261f";
      c.strokeStyle = col; c.lineWidth = 4; c.strokeRect(-112, -30, 224, 60);
      c.fillStyle = col; c.textAlign = "center";
      let sf = 26; c.font = "800 " + sf + "px " + SANS;
      while (sf > 13 && c.measureText(spec.stamp).width > 204) { sf -= 1; c.font = "800 " + sf + "px " + SANS; }
      c.fillText(spec.stamp, 0, 1);
      c.restore();
    }
    c.restore();
  }

  function isUp(key) {
    const H = CBZ.hmHold;
    return !!(cur && H && H.isOpen && H.isOpen() && H.canvas() === cv && (key == null || cur.key === key));
  }
  function show(spec) {
    if (!spec) return false;
    const H = CBZ.hmHold;
    if (!H || !H.open) return false;
    // the same sheet, on a new canvas (see canvas()): not a sheet put down
    const held = !!(cur && H.isOpen && H.isOpen() && H.canvas() === cv);
    swapping = held && cv.width !== CW;
    draw(spec);
    // the sheet is being redrawn in your hands (he wrote a new figure on it)
    if (H.isOpen() && H.canvas() === cv) {
      cur = { key: spec.key, onClose: spec.onClose || null };
      H.update(cv);
      return true;
    }
    const next = { key: spec.key, onClose: spec.onClose || null };
    const ok = !!H.open(cv, {
      kind: "paper",
      // whoever's sheet it is by the time it leaves your hands hears about it
      onClose: function () {
        if (swapping) return;
        const was = cur; cur = null;
        if (was && was.onClose) { try { was.onClose(); } catch (e) {} }
      },
    });
    swapping = false;
    cur = ok ? next : null;
    return ok;
  }
  function down(key) {
    const H = CBZ.hmHold;
    if (!isUp(key)) return false;
    if (H && H.close) H.close();
    return true;
  }
  function money(n) {
    n = Math.round(n || 0);
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }

  CBZ.cityPaper = {
    show: show, isUp: isUp, down: down, money: money,
    key: function () { return isUp() ? cur.key : null; },
  };
})();
