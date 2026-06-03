/* ============================================================
   systems/survivalhud.js — the SURVIVAL battle-royale HUD.

   Alive-count pill ("87 ALIVE"), HP + stamina bars, the big disaster
   warning banner, a zone/disaster status line, the screen white-out
   (lightning/nuke), and a zone-aware minimap drawn to the existing
   #minimap canvas (the prison minimap is gated off in this mode).

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
    banner: document.getElementById("disasterBanner"),
    zone: document.getElementById("survZoneText"),
    flash: document.getElementById("survFlash"),
  };
  const cv = document.getElementById("minimap");
  const ctx = cv ? cv.getContext("2d") : null;
  const W = cv ? cv.width : 0, H = cv ? cv.height : 0;

  CBZ.survHud = {
    banner(html, on) {
      if (!el.banner) return;
      if (on && html) { el.banner.innerHTML = html; el.banner.classList.add("show"); }
      else el.banner.classList.remove("show");
    },
  };

  function drawMinimap() {
    if (!ctx) return;
    const surv = CBZ.surv, A = surv.arena, zone = surv.zone;
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
    if (el.stam) el.stam.style.width = Math.max(0, CBZ.player.stamina || 0) + "%";

    // disaster status line (no safe zone — disasters are the only threat)
    if (el.zone) {
      const D = CBZ.disasters;
      let s = "";
      if (D && D.state() === "warn" && D.current()) s = "⚠ " + D.current() + " · " + Math.ceil(D.timeLeft()) + "s";
      else if (D && D.state() === "active" && D.current()) s = D.current() + " · " + Math.ceil(D.timeLeft()) + "s";
      el.zone.textContent = s;
    }

    // screen flash (lightning / nuke white-out)
    if (el.flash) {
      const f = CBZ.survEnv.flash;
      el.flash.style.opacity = Math.min(0.92, f).toFixed(2);
    }

    drawMinimap();
  });
})();
