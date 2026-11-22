/* ============================================================
   city/paper.js — A SHEET OF PAPER SOMEBODY HANDS YOU.

   OWNER: "No dashboards are needed. Everything can be existing."

   Gang City's lists used to be HTML panels: a job board, a car-yard table,
   an "Empire" screen, a bet slip, a storage menu. What is left of a list in
   the world is a piece of paper: the job a man wrote down for you, the
   ledger a manager turns round on his desk, the race card at the betting
   window, the ticket the bookmaker tears off, a teller's slip, a loan offer.
   This file draws that paper and puts it in your hands (CBZ.hmHold,
   city/hitman_hands.js: a real plane in front of the camera; you can still
   walk and look while you read it, and E, J, Esc or a tap puts it away).

   ONE SHEET AT A TIME, described, not drawn by the caller:
     CBZ.cityPaper.show({
       key      who owns the sheet now (isUp(key) asks)
       org      the letterhead ("PREMIUM AUTOS"); title, the form's name
       ink      the letterhead's colour; tone, the paper's
       hand     true = a note in somebody's handwriting (no letterhead)
       lines    what is on it, top to bottom:
                  { k, v, big?, sub?, minus?, plus?, tap? }
                                        a ruled line: label left, value right;
                                        sub is small print under it; minus /
                                        plus are functions: the two pencil
                                        boxes beside the value
                  { text, italic?, dim?, big?, ink? }   a sentence (wraps)
                  { cols: [..], head?, mark?, strike?, tap? }  a table row;
                                        mark circles it in pen
                  { btn: "HAND IT IN", tap }   a boxed line you tap
                  { gap }               air
       foot     small print under the last line
       stamp    a rubber stamp ("PAID"), stampInk its colour
       sign     a name written on the signature line, or { label, date,
                name, scribble, tap }: a labelled line you sign
       sticky   a tap on the screen does not lower this sheet (you are
                dealing with a person while you hold it)
       onClose  called when it leaves your hands
     })
     CBZ.cityPaper.isUp(key?) / down(key?)

   A LINE YOU CAN TAP. On a touch screen a sheet is marked with a finger: a
   line given `tap` (or minus / plus, or a btn) is a target on the paper
   itself (hmHold's onTap), so a runner is circled by tapping his row and an
   offer is signed by tapping its signature line. The same things are verbs
   on the person or the slip for a keyboard. On a touch screen the sheet is
   drawn larger so a row is big enough for a finger.

   The sheet stands on the right of the view so the person you are dealing
   with stays in it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || typeof document === "undefined") return;

  const CW = 1500, CH = 1000;          // the canvas the held plane shows
  const SW = 640;                      // the sheet's width on it (before the touch scale)
  const PAD = 36;
  let cv = null, cur = null, hits = [], swapping = false;

  function canvas() {
    // core/texfree.js gives a painted canvas's pixels back (1x1) once its
    // texture has sat on the GPU for 30 s: the sheet in your hands is fine,
    // but the next thing written has to go on a new one
    if (cv && cv.width !== CW) cv = null;
    if (!cv) { cv = document.createElement("canvas"); cv.width = CW; cv.height = CH; }
    return cv;
  }
  function touch() { return !!(CBZ.touchMode || (document.body && document.body.classList && document.body.classList.contains("touch"))); }
  const SERIF = "Georgia, 'Times New Roman', serif";
  const SANS = "Helvetica, Arial, sans-serif";
  const MONO = "'Courier New', Courier, monospace";
  const PEN = "'Bradley Hand', 'Segoe Print', 'Marker Felt', 'Comic Sans MS', cursive";
  const PEN_INK = "#1b3fa8";

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
  function textFont(ln, hand) {
    if (ln.big) return "800 44px " + SANS;
    return (ln.italic ? "italic " : "") + (hand ? "400 34px " + PEN : "400 25px " + SERIF);
  }
  function textStep(ln, hand) { return ln.big ? 54 : (hand ? 44 : 34); }
  // how tall one line is, so the sheet is cut to what is written on it
  function heightOf(c, ln, hand, innerW) {
    if (ln.gap != null) return ln.gap;
    if (ln.btn != null) return 84;
    if (ln.cols) return ln.head ? 40 : 46;
    if (ln.text != null) {
      c.font = textFont(ln, hand);
      return wrap(c, ln.text, innerW).length * textStep(ln, hand) + 10;
    }
    return (ln.big ? 84 : 62) + (ln.sub ? 24 : 0);
  }
  function signOf(spec) {
    const s = spec.sign;
    if (!s) return null;
    return typeof s === "string" ? { name: s } : s;
  }
  function draw(spec) {
    const c = canvas().getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, CW, CH);
    hits = [];
    const hand = !!spec.hand;
    const w = spec.w || SW, innerW = w - PAD * 2;
    const lines = spec.lines || [];
    const headH = hand ? 26 : 78;
    let bodyH = 0;
    for (let i = 0; i < lines.length; i++) bodyH += heightOf(c, lines[i], hand, innerW);
    c.font = "italic 20px " + SERIF;
    const footLines = spec.foot ? wrap(c, spec.foot, innerW) : [];
    const sg = signOf(spec);
    const tail = (footLines.length ? footLines.length * 26 + 16 : 0) + (spec.stamp || sg ? 104 : 0);
    const h = headH + 30 + bodyH + tail + 26;
    // a finger needs a bigger sheet than an eye does; and a long sheet is
    // drawn smaller rather than run off the canvas
    let s = touch() ? 1.5 : 1;
    s = Math.min(s, (CH - 40) / h, (CW - 80) / w);
    const X0 = spec.center ? (CW - w * s) / 2 : CW - w * s - 56;
    const Y0 = Math.max(20, (CH - h * s) / 2);
    const hit = function (x0, y0, x1, y1, fn) { if (typeof fn === "function") hits.push({ x0: X0 + x0 * s, y0: Y0 + y0 * s, x1: X0 + x1 * s, y1: Y0 + y1 * s, fn: fn }); };

    c.save();
    c.translate(X0, Y0); c.scale(s, s);
    if (hand) { c.translate(w / 2, h / 2); c.rotate(-0.025); c.translate(-w / 2, -h / 2); }
    c.save();
    c.shadowColor = "rgba(0,0,0,.45)"; c.shadowBlur = 26; c.shadowOffsetY = 10;
    c.fillStyle = spec.tone || (hand ? "#f4eeda" : "#f7f3e8");
    c.fillRect(0, 0, w, h);
    c.restore();
    c.textBaseline = "middle";
    if (hand) {
      // a torn-off sheet: faint rules, nothing printed
      c.strokeStyle = "rgba(70,96,140,.22)"; c.lineWidth = 1.5;
      for (let ry = 64; ry < h - 12; ry += 44) { c.beginPath(); c.moveTo(14, ry); c.lineTo(w - 14, ry); c.stroke(); }
    } else {
      c.fillStyle = spec.ink || "#1d3a5c"; c.fillRect(0, 0, w, 74);
      c.fillStyle = "#f7f3e8"; c.textAlign = "left";
      const org = String(spec.org || "").toUpperCase();
      c.font = "600 21px " + SANS;
      const tw = spec.title ? c.measureText(spec.title).width + 30 : 0;
      let fs = 32; c.font = "700 " + fs + "px " + SERIF;
      while (fs > 18 && c.measureText(org).width > innerW - tw) { fs -= 2; c.font = "700 " + fs + "px " + SERIF; }
      c.fillText(org, 28, 38);
      if (spec.title) { c.textAlign = "right"; c.font = "600 21px " + SANS; c.fillText(spec.title, w - 28, 39); }
    }
    let cy = headH + 30;
    const lx = PAD;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i], lh = heightOf(c, ln, hand, innerW);
      if (ln.gap != null) { cy += lh; continue; }
      if (ln.btn != null) {
        // a boxed line: the thing you do with this sheet
        c.strokeStyle = PEN_INK; c.lineWidth = 3;
        c.strokeRect(lx, cy + 10, innerW, lh - 24);
        c.fillStyle = PEN_INK; c.font = "800 26px " + SANS; c.textAlign = "center";
        c.fillText(String(ln.btn), lx + innerW / 2, cy + lh / 2 - 1);
        hit(lx - 6, cy + 2, lx + innerW + 6, cy + lh - 6, ln.tap);
        cy += lh; continue;
      }
      if (ln.cols) {
        const n = ln.cols.length, ws = spec.colw || null;
        let px = lx;
        c.font = ln.head ? "700 18px " + SANS : (hand ? "400 30px " + PEN : "600 25px " + MONO);
        c.fillStyle = ln.head ? "#6a6458" : (ln.dim ? "#8a8474" : "#16140f");
        for (let k = 0; k < n; k++) {
          const cw = ws ? ws[k] * innerW : innerW / n;
          const right = k > 0 && k === n - 1;
          c.textAlign = right ? "right" : "left";
          let t = String(ln.cols[k] == null ? "" : ln.cols[k]);
          while (t.length > 3 && c.measureText(t).width > cw - 8) t = t.slice(0, -2);
          c.fillText(t, right ? px + cw : px, cy + lh / 2);
          px += cw;
        }
        if (ln.head) { c.strokeStyle = "#8f8876"; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, cy + lh - 3); c.lineTo(lx + innerW, cy + lh - 3); c.stroke(); }
        if (ln.strike) { c.strokeStyle = "#16140f"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(lx - 4, cy + lh / 2 + 2); c.lineTo(lx + innerW + 4, cy + lh / 2 - 3); c.stroke(); }
        if (ln.mark) {
          // circled in pen: the one you picked
          c.save(); c.strokeStyle = PEN_INK; c.lineWidth = 3.5; c.beginPath();
          c.ellipse(lx + innerW / 2, cy + lh / 2, innerW / 2 + 12, lh / 2 + 1, -0.012, 0.25, Math.PI * 2 + 0.55);
          c.stroke(); c.restore();
        }
        hit(lx - 10, cy, lx + innerW + 10, cy + lh, ln.tap);
        cy += lh; continue;
      }
      if (ln.text != null) {
        c.font = textFont(ln, hand);
        c.fillStyle = ln.ink || (ln.dim ? "#6a6458" : (hand ? "#1c2a5e" : "#26231d")); c.textAlign = "left";
        const rows = wrap(c, ln.text, innerW), step = textStep(ln, hand);
        for (let r = 0; r < rows.length; r++) c.fillText(rows[r], lx, cy + step / 2 + r * step);
        hit(lx - 10, cy, lx + innerW + 10, cy + lh, ln.tap);
        cy += lh; continue;
      }
      // a ruled line: label left, value right (and the pencil boxes beside it)
      const rowH = ln.big ? 84 : 62, steppers = !!(ln.minus || ln.plus), box = 46;
      const vRight = lx + innerW - (steppers ? box * 2 + 22 : 0);
      c.fillStyle = "#6a6458"; c.font = "600 20px " + SANS; c.textAlign = "left";
      c.fillText(String(ln.k || ""), lx, cy + rowH / 2 - 6);
      const kw = c.measureText(String(ln.k || "")).width + 18;
      c.fillStyle = "#16140f"; c.textAlign = "right";
      let vf = ln.big ? 42 : 28;
      const v = String(ln.v == null ? "" : ln.v);
      c.font = (ln.big ? "700 " : "600 ") + vf + "px " + MONO;
      while (vf > 16 && c.measureText(v).width > (vRight - lx) - kw) { vf -= 2; c.font = (ln.big ? "700 " : "600 ") + vf + "px " + MONO; }
      c.fillText(v, vRight, cy + rowH / 2 - 6);
      c.strokeStyle = "#b9b2a0"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(lx, cy + rowH - 14); c.lineTo(lx + innerW, cy + rowH - 14); c.stroke();
      if (steppers) {
        const by = cy + rowH / 2 - 6 - box / 2;
        const boxes = [[lx + innerW - box * 2 - 10, ln.minus, "-"], [lx + innerW - box, ln.plus, "+"]];
        for (let b = 0; b < 2; b++) {
          const bx = boxes[b][0];
          c.strokeStyle = boxes[b][1] ? PEN_INK : "#c9c2b0"; c.lineWidth = 2.5; c.strokeRect(bx, by, box, box);
          c.fillStyle = boxes[b][1] ? PEN_INK : "#c9c2b0"; c.font = "800 30px " + SANS; c.textAlign = "center";
          c.fillText(boxes[b][2], bx + box / 2, by + box / 2 + 1);
          hit(bx - 8, by - 10, bx + box + 8, by + box + 10, boxes[b][1]);
        }
      } else hit(lx - 10, cy, lx + innerW + 10, cy + rowH, ln.tap);
      if (ln.sub) { c.fillStyle = "#6a6458"; c.font = "500 18px " + SANS; c.textAlign = "left"; c.fillText(String(ln.sub), lx, cy + rowH + 2); }
      cy += lh;
    }
    if (footLines.length) {
      c.fillStyle = "#6a6458"; c.font = "italic 20px " + SERIF; c.textAlign = "left";
      for (let r = 0; r < footLines.length; r++) c.fillText(footLines[r], lx, cy + 20 + r * 26);
    }
    if (sg) {
      const ly = h - 44;
      c.strokeStyle = "#26231d"; c.lineWidth = 1.8; c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + 330, ly); c.stroke();
      if (sg.label) { c.fillStyle = "#6a6458"; c.font = "600 16px " + SANS; c.textAlign = "left"; c.fillText(String(sg.label), lx, ly + 20); }
      if (sg.date) { c.fillStyle = "#6a6458"; c.font = "600 16px " + SANS; c.textAlign = "right"; c.fillText(String(sg.date), w - PAD, ly + 20); }
      if (sg.scribble) {
        c.strokeStyle = "#1a2a66"; c.lineWidth = 3.5; c.lineCap = "round"; c.beginPath();
        let px = lx + 26; c.moveTo(px, ly - 10);
        for (let i = 0; i < 9; i++) { const nx = px + 31, ny = ly - 10 + (i % 2 ? 14 : -26) * (1 - i / 14); c.quadraticCurveTo(px + 10, ny - 16, nx, ny); px = nx; }
        c.stroke();
      } else if (sg.name) {
        c.fillStyle = PEN_INK; c.font = "400 40px " + PEN; c.textAlign = "left"; c.fillText(String(sg.name), lx + 12, ly - 20);
      } else if (sg.tap) {
        c.fillStyle = "rgba(27,63,168,.55)"; c.font = "italic 24px " + SERIF; c.textAlign = "left"; c.fillText("sign here", lx + 14, ly - 16);
      }
      hit(lx - 10, ly - 62, lx + 350, ly + 30, sg.tap);
    }
    if (spec.stamp) {
      c.save(); c.translate(w - 150, h - 62); c.rotate(-0.16);
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
  // a tap that landed on the sheet (u, v across the canvas): one of its own targets?
  function tapAt(u, v) {
    const x = u * CW, y = v * CH;
    for (let i = 0; i < hits.length; i++) {
      const r = hits[i];
      if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) { try { r.fn(); } catch (e) { console.error("[paper tap]", e); } return true; }
    }
    return false;
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
    const sticky = !!spec.sticky;
    // the sheet is being redrawn in your hands (he wrote a new figure on it)
    if (H.isOpen() && H.canvas() === cv && cur && cur.sticky === sticky) {
      cur = { key: spec.key, onClose: spec.onClose || null, sticky: sticky };
      H.update(cv);
      holding(sticky);
      return true;
    }
    // (a sheet that changes how it answers a tap is taken up afresh)
    if (H.isOpen() && H.canvas() === cv) swapping = true;
    const next = { key: spec.key, onClose: spec.onClose || null, sticky: sticky };
    const ok = !!H.open(cv, {
      kind: "paper", sticky: sticky, onTap: tapAt,
      // whoever's sheet it is by the time it leaves your hands hears about it
      onClose: function () {
        if (swapping) return;
        holding(false);
        const was = cur; cur = null;
        if (was && was.onClose) { try { was.onClose(); } catch (e) {} }
      },
    });
    swapping = false;
    cur = ok ? next : null;
    holding(ok && sticky);
    return ok;
  }
  // a sheet you are marking fills your hands: the bar under it steps aside
  // (css/city.css body.paper-held), so a finger on its bottom line lands on
  // the paper and not on a hotbar cell
  function holding(on) { if (document.body) document.body.classList.toggle("paper-held", !!on); }
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
    // where the sheet's own tap targets are, in canvas pixels (1500 x 1000)
    targets: function () { return hits.map(function (r) { return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }; }); },
  };
})();
