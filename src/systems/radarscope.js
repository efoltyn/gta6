/* ============================================================
   systems/radarscope.js — A RADAR, NOT A MAP.

   WHY THIS IS NOT src/systems/minimap.js. A minimap is a GOD VIEW: it
   knows where the buildings are, where the park is, where every shelter
   and every enemy stands, because the game knows and hands it over. That
   is the correct instrument for a character walking a city he lives in.

   It is the WRONG instrument for a cockpit, and wrong in a way that
   quietly removes the game: an aircraft that can see every enemy on a
   printed street plan is never searching for anything. The tension in a
   strike is not "fly to the marker", it is "there is something out there
   and I have a scope that paints it once a revolution".

   So this draws a PPI SCOPE — the round, sweeping, heading-up display an
   aircraft actually carries — and it obeys the four rules that make it
   one:

     1. IT ONLY SEES WHAT RADAR SEES. Contacts are supplied by the
        caller and are things in the AIR (and whatever else the caller
        decides is a return). No terrain, no buildings, no map. A scope
        that draws the park is a map wearing a costume.
     2. IT PAINTS ON THE SWEEP. A contact does not sit there glowing; it
        flares to full when the sweep line crosses its bearing and then
        DECAYS. So the display is always slightly out of date, and how
        out of date depends on where the sweep is — which is the whole
        character of the instrument.
     3. HEADING-UP. The scope rotates under you: straight ahead is
        always twelve o'clock, and the compass rim turns instead. A
        north-up scope makes the pilot do trigonometry.
     4. ALTITUDE IS A SEPARATE CHANNEL. A PPI is a flat, top-down
        picture, so height cannot be a position — it is a caret above or
        below the blip, and the number beside it.

   IT IS ALSO A THREAT DISPLAY. `contacts()` may return entries tagged
   `threat:true` (inbound ordnance, a missile, a warning) and those are
   drawn HOT: painted every frame regardless of the sweep, in the alarm
   colour, with a decaying ring. A man on the ground under an air raid
   carries the same scope and it shows him the things that are about to
   land — same instrument, different returns.

   CANVAS 2D on purpose: it is a handful of arcs and lines at 15 Hz, and
   a WebGL pass for that would cost more than it drew.

   USE:
     const scope = CBZ.radar.create({
       canvas: document.getElementById("radar"),
       range: 3000,
       self:     () => ({x, z, y, heading}),
       contacts: () => [{x, z, y, id, friend|foe|neutral|threat, label}],
     });
     scope.draw(dt);            // call it from your frame hook

   Flags: RADAR_V1 (master), RADAR_SWEEP_RATE, RADAR_PAINT_DECAY.
   Audit: CBZ.radarAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});

  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.RADAR_V1 == null) C.RADAR_V1 = true;
  if (C.RADAR_SWEEP_RATE == null) C.RADAR_SWEEP_RATE = 1.15;   // rad/s ≈ 3.4 s a turn
  if (C.RADAR_PAINT_DECAY == null) C.RADAR_PAINT_DECAY = 0.42; // paint units/s
  if (C.RADAR_V1 === false) return;

  const radar = (CBZ.radar = CBZ.radar || {});
  radar.scopes = [];

  const PALETTE = {
    face: "rgba(6,16,12,0.72)",
    grid: "rgba(120,235,170,0.20)",
    gridHot: "rgba(120,235,170,0.34)",
    sweep: "rgba(120,255,180,0.55)",
    friend: "#6fe8ff",
    foe: "#ff6a3d",
    neutral: "#d8e4b0",
    threat: "#ff3b28",
    self: "#ffffff",
    text: "rgba(190,235,205,0.75)",
  };
  radar.palette = PALETTE;

  radar.create = function (opts) {
    opts = opts || {};
    const cv = typeof opts.canvas === "string" ? document.querySelector(opts.canvas) : opts.canvas;
    if (!cv) return null;
    const g = cv.getContext("2d");

    const S = {
      canvas: cv, ctx: g,
      range: opts.range != null ? opts.range : 3000,
      ranges: opts.ranges || [800, 1600, 3000, 6000],   // the range knob's detents
      rangeIndex: 2,
      sweep: 0,
      self: opts.self || function () { return { x: 0, z: 0, y: 0, heading: 0 }; },
      contacts: opts.contacts || function () { return []; },
      paint: new Map(),          // id → 0..1, how freshly this return was painted
      label: opts.label || "",
      lastCount: 0,
    };
    if (opts.range != null) {
      // snap the initial range onto the knob so cycling starts somewhere real
      let best = 0;
      for (let i = 1; i < S.ranges.length; i++) {
        if (Math.abs(S.ranges[i] - S.range) < Math.abs(S.ranges[best] - S.range)) best = i;
      }
      S.rangeIndex = best;
      S.range = S.ranges[best];
    }

    S.cycleRange = function (dir) {
      S.rangeIndex = (S.rangeIndex + (dir || 1) + S.ranges.length) % S.ranges.length;
      S.range = S.ranges[S.rangeIndex];
      return S.range;
    };

    S.draw = function (dt) {
      const W = cv.width, H = cv.height;
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 3;
      const me = S.self() || { x: 0, z: 0, y: 0, heading: 0 };

      // ---- 2. THE SWEEP. Advance it first, so a contact crossed this frame
      //         paints this frame.
      const prev = S.sweep;
      S.sweep = (S.sweep + C.RADAR_SWEEP_RATE * dt) % (Math.PI * 2);
      const wrapped = S.sweep < prev;

      g.clearRect(0, 0, W, H);

      // scope face
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fillStyle = PALETTE.face; g.fill();

      // range rings + cross hairs
      g.strokeStyle = PALETTE.grid; g.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        g.beginPath(); g.arc(cx, cy, R * (i / 3), 0, 7); g.stroke();
      }
      g.beginPath();
      g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
      g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
      g.stroke();

      // ---- 3. HEADING-UP: the compass rim turns, the pilot does not
      g.save();
      g.translate(cx, cy);
      g.rotate(-me.heading);
      g.strokeStyle = PALETTE.gridHot;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const big = i % 3 === 0;
        g.lineWidth = big ? 2 : 1;
        g.beginPath();
        g.moveTo(Math.sin(a) * R, -Math.cos(a) * R);
        g.lineTo(Math.sin(a) * (R - (big ? 9 : 5)), -Math.cos(a) * (R - (big ? 9 : 5)));
        g.stroke();
      }
      g.fillStyle = PALETTE.text;
      g.font = "bold 9px monospace";
      g.textAlign = "center"; g.textBaseline = "middle";
      const cards = ["N", "E", "S", "W"];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        g.save();
        g.translate(Math.sin(a) * (R - 17), -Math.cos(a) * (R - 17));
        g.rotate(me.heading);          // keep the letter upright
        g.fillText(cards[i], 0, 0);
        g.restore();
      }
      g.restore();

      // the sweep line + its decaying wedge
      g.save();
      g.translate(cx, cy);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
      grad.addColorStop(0, "rgba(120,255,180,0.02)");
      grad.addColorStop(1, "rgba(120,255,180,0.16)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R, S.sweep - Math.PI / 2 - 0.55, S.sweep - Math.PI / 2);
      g.closePath();
      g.fill();
      g.strokeStyle = PALETTE.sweep;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(S.sweep - Math.PI / 2) * R, Math.sin(S.sweep - Math.PI / 2) * R);
      g.stroke();
      g.restore();

      // ---- 1. THE RETURNS
      const list = S.contacts() || [];
      S.lastCount = 0;
      const seen = new Set();

      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c) continue;
        const dx = c.x - me.x, dz = c.z - me.z;
        const dist = Math.hypot(dx, dz);
        if (dist > S.range) continue;
        const id = c.id != null ? c.id : ("i" + i);
        seen.add(id);

        // Into the aircraft's own frame, explicitly. Deriving a "bearing" and
        // then subtracting heading invites exactly one sign error, and a
        // scope with a sign error is a scope that puts the enemy on the wrong
        // side — which is worse than no scope. Forward and right are written
        // out, the two dot products are unambiguous, and the screen angle
        // falls straight out of them.
        const h = me.heading || 0;
        const fwdX = -Math.sin(h), fwdZ = -Math.cos(h);
        const rgtX = Math.cos(h), rgtZ = -Math.sin(h);
        const along = dx * fwdX + dz * fwdZ;           // + = ahead of me
        const side = dx * rgtX + dz * rgtZ;            // + = off my right
        const rel = Math.atan2(side, along);           // 0 = twelve o'clock, + = clockwise

        // the sweep runs in the SAME frame, so "has it passed this bearing
        // since last frame" is one wrapped comparison and no conversion
        let sweepRel = rel;
        while (sweepRel < 0) sweepRel += Math.PI * 2;
        while (sweepRel >= Math.PI * 2) sweepRel -= Math.PI * 2;
        // NOTE the sweep runs in the aircraft's own frame too, so the compare
        // is direct: no second conversion, no drift between the two.
        const crossed = wrapped
          ? (sweepRel > prev || sweepRel <= S.sweep)
          : (sweepRel > prev && sweepRel <= S.sweep);

        let p = S.paint.get(id) || 0;
        if (c.threat) p = 1;                            // hot returns never wait
        else if (crossed) p = 1;
        else p = Math.max(0, p - C.RADAR_PAINT_DECAY * dt);
        S.paint.set(id, p);
        if (p <= 0.03) continue;
        S.lastCount++;

        const rr = (dist / S.range) * R;
        const sx = cx + Math.sin(rel) * rr;   // same (sin, −cos) frame the sweep uses
        const sy = cy - Math.cos(rel) * rr;
        const col = c.threat ? PALETTE.threat
          : c.foe ? PALETTE.foe
            : c.friend ? PALETTE.friend : PALETTE.neutral;

        g.globalAlpha = c.threat ? 1 : (0.20 + p * 0.80);
        if (c.threat) {
          // a decaying ring: the closer to impact, the tighter it draws
          const t = Math.max(0, Math.min(1, (c.ttl != null ? c.ttl : 4) / 6));
          g.strokeStyle = col; g.lineWidth = 1.6;
          g.beginPath(); g.arc(sx, sy, 3 + t * 7, 0, 7); g.stroke();
          g.fillStyle = col;
          g.beginPath(); g.arc(sx, sy, 2.2, 0, 7); g.fill();
        } else {
          // aircraft returns are BARS, not dots — a bar can carry a heading
          g.save();
          g.translate(sx, sy);
          if (c.heading != null) g.rotate(c.heading - me.heading);
          g.fillStyle = col;
          g.fillRect(-4, -1.6, 8, 3.2);
          if (c.heading != null) { g.fillRect(-0.9, -5.5, 1.8, 4); }
          g.restore();

          // ---- 4. ALTITUDE IS A SEPARATE CHANNEL
          const dy = (c.y || 0) - (me.y || 0);
          if (Math.abs(dy) > 40) {
            g.fillStyle = col;
            g.font = "8px monospace";
            g.textAlign = "left"; g.textBaseline = "middle";
            g.fillText((dy > 0 ? "▲" : "▼") + Math.round(Math.abs(dy) / 10), sx + 6, sy);
          }
        }
        g.globalAlpha = 1;
      }
      // forget anything that has left the scope entirely
      if (S.paint.size > 64) {
        S.paint.forEach(function (v, k) { if (!seen.has(k)) S.paint.delete(k); });
      }

      // own-ship marker: a caret at the centre, always pointing up
      g.fillStyle = PALETTE.self;
      g.beginPath();
      g.moveTo(cx, cy - 6); g.lineTo(cx - 4.5, cy + 5); g.lineTo(cx, cy + 2.6); g.lineTo(cx + 4.5, cy + 5);
      g.closePath(); g.fill();

      // range readout, bottom-right of the face — an instrument states its scale
      g.fillStyle = PALETTE.text;
      g.font = "bold 9px monospace";
      g.textAlign = "right"; g.textBaseline = "bottom";
      g.fillText((S.range / 1000).toFixed(1) + "km", W - 6, H - 4);
      if (S.label) {
        g.textAlign = "left";
        g.fillText(S.label, 6, H - 4);
      }

      // bezel
      g.strokeStyle = "rgba(150,255,200,0.30)"; g.lineWidth = 2;
      g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    };

    radar.scopes.push(S);
    return S;
  };

  CBZ.radarAudit = function () {
    return radar.scopes.map(function (s) {
      return { range: s.range, contacts: s.lastCount, painted: s.paint.size, sweep: +s.sweep.toFixed(2) };
    });
  };
})();
