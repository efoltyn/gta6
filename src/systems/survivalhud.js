/* ============================================================
   systems/survivalhud.js — the SURVIVAL disaster HUD.

   Alive-count pill ("87" + a people glyph, riding the top-right rail beside
   the match clock — index.html/#topright), HP + stamina bars, a BREATH bar while
   you are in the water, the screen white-out (lightning/nuke), and a
   minimap drawn to the
   existing #minimap canvas (the prison minimap is gated off in this
   mode): terrain, survivors, you — and the ACTUAL location of the
   live hazard (CBZ.disasters.hazards(): tornado funnel, strike
   markers, sinkholes, lava vent, the advancing wave front, the nuke
   shockwave). There are no zones in this mode — just disasters.

   SHOW DON'T TELL (2026-08-02). Two channels were DELETED here, not
   hidden: the giant pulsing #disasterBanner ("EARTHQUAKE — INCOMING")
   and the #survStatusText countdown that re-stated the same disaster's
   name and remaining seconds every single frame. Between them and the
   flashHints in systems/disasters.js the mode was narrating itself four
   ways at once, and every one of those lines named an event that now
   HAPPENS in front of you instead: the ground rattles, the sea goes
   out, the sky closes in. What is left on screen is game STATE (how
   many are alive, your health, your air) and the map, which shows the
   hazard WHERE IT REALLY IS. Deaths go to the killfeed, which is the
   one sanctioned popup.

   Most elements are hidden in escape mode via the body.mode-survival
   class (see hud.css), so this only writes data while survival is live.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    alive: document.getElementById("aliveCount"),
    hp: document.getElementById("hpBar"),
    stam: document.getElementById("stamBar"),
    flash: document.getElementById("survFlash"),
  };
  const cv = document.getElementById("minimap");
  const ctx = cv ? cv.getContext("2d") : null;
  const W = cv ? cv.width : 0, H = cv ? cv.height : 0;

  // The banner() API is GONE. It is named here so the next author looking for
  // it finds the reason rather than re-adding it: a full-screen pulsing title
  // is the loudest possible way to tell somebody something the world could
  // have shown them, and every one of its nine call sites now drives a
  // physical telegraph in systems/disasters.js instead.
  CBZ.survHud = {};

  function drawMinimap() {
    if (!ctx) return;
    const surv = CBZ.surv, A = surv.arena;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,18,30,.55)"; ctx.fillRect(0, 0, W, H);
    if (!A) return;
    const cx = A.center.x, cz = A.center.z;
    const sc = Math.min(W, H) / (2 * (A.radius + 8));
    const mx = (x) => W / 2 + (x - cx) * sc;
    const mz = (z) => H / 2 + (z - cz) * sc;

    // island
    ctx.fillStyle = "rgba(90,150,90,.30)";
    ctx.beginPath(); ctx.arc(W / 2, H / 2, A.radius * sc, 0, 7); ctx.fill();
    // terrain: the refuge mountain + hills, so "get to high ground" is readable
    if (A.hills) {
      for (let i = 0; i < A.hills.length; i++) {
        const h = A.hills[i];
        ctx.fillStyle = i === 0 ? "rgba(160,150,132,.5)" : "rgba(110,150,90,.45)";
        ctx.beginPath(); ctx.arc(mx(h.x), mz(h.z), Math.max(2, h.r * sc), 0, 7); ctx.fill();
      }
    }

    // THE HAZARD, where it actually is (SURV_MAP_HAZARDS): red circles for
    // point threats (funnel, strikes, sinkholes, vent, shockwave front), a
    // sweeping chord for a wave front. No rings, no zones — the map shows the
    // disaster itself.
    if ((!CBZ.CONFIG || CBZ.CONFIG.SURV_MAP_HAZARDS !== false) && CBZ.disasters && CBZ.disasters.hazards) {
      const marks = CBZ.disasters.hazards();
      if (marks && marks.length) {
        const pulse = 0.55 + 0.35 * Math.abs(Math.sin((CBZ.now || 0) * 0.006));
        ctx.strokeStyle = "rgba(255,80,50," + pulse.toFixed(2) + ")";
        ctx.fillStyle = "rgba(255,80,50,.22)";
        ctx.lineWidth = 1.6;
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          if (m.line) {
            // a front line (tsunami/flood wall): the chord through (x,z)
            // perpendicular to the travel direction (dx,dz)
            const px = -m.dz, pz = m.dx, L = A.radius + 10;
            ctx.beginPath();
            ctx.moveTo(mx(m.x - px * L), mz(m.z - pz * L));
            ctx.lineTo(mx(m.x + px * L), mz(m.z + pz * L));
            ctx.stroke();
          } else {
            const r = Math.max(2.5, (m.r || 6) * sc);
            ctx.beginPath(); ctx.arc(mx(m.x), mz(m.z), r, 0, 7);
            if (m.fill !== false) ctx.fill();
            ctx.stroke();
          }
        }
      }
    }

    // bots
    ctx.fillStyle = "rgba(220,225,235,.8)";
    const bots = CBZ.bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i]; if (b.dead) continue;
      ctx.beginPath(); ctx.arc(mx(b.pos.x), mz(b.pos.z), 1.4, 0, 7); ctx.fill();
    }
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint();
    if (wp) {
      if (CBZ.fullMap.trace) CBZ.fullMap.trace(ctx, mx, mz);
      ctx.strokeStyle = "#7de7ff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx(wp.x), mz(wp.z), 4, 0, 7); ctx.stroke();
    }

    // player arrow
    if (!CBZ.player.dead) {
      const px = mx(CBZ.player.pos.x), pz = mz(CBZ.player.pos.z);
      const h = CBZ.playerChar.group.rotation.y;
      ctx.save(); ctx.translate(px, pz); ctx.rotate(Math.atan2(Math.cos(h), Math.sin(h)));
      ctx.fillStyle = "#ff7a1a";
      ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, 3); ctx.lineTo(-3.5, -3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  CBZ.onUpdate(49, function () {
    if (CBZ.game.mode !== "survival") return;
    const surv = CBZ.surv;
    if (el.alive) el.alive.textContent = surv.aliveCount();
    if (el.hp) { const h = Math.max(0, CBZ.player.hp); el.hp.style.width = h + "%"; el.hp.style.background = h > 50 ? "#3ad17a" : (h > 22 ? "#ffd451" : "#ff4d4d"); }
    // THE STAMINA BAR BECOMES AN AIR BAR IN THE WATER. city/swim.js owns the
    // island's swimmer now, and its 28 s breath tank is the one number that
    // decides whether you make the roof — so the bar the player is already
    // watching shows it, in a colour that says "this one is different",
    // instead of the mode growing a second meter. Out of the water it is the
    // stamina bar again, byte-identical.
    if (el.stam) {
      const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
      if (sw && sw.swimming && CBZ.player.breathMax) {
        const air = Math.max(0, Math.min(1, (CBZ.player.breath || 0) / CBZ.player.breathMax));
        el.stam.style.width = (air * 100).toFixed(1) + "%";
        el.stam.style.background = air > 0.3 ? "#5bc8ff" : "#ff4d4d";
      } else {
        el.stam.style.width = Math.max(0, CBZ.player.stamina || 0) + "%";
        el.stam.style.background = "#5bc8ff";
      }
    }

    // screen flash (lightning / nuke white-out)
    if (el.flash) {
      const f = CBZ.survEnv.flash;
      el.flash.style.opacity = Math.min(0.92, f).toFixed(2);
    }

    drawMinimap();
  });
})();
