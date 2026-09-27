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

    /* THE TOWN, and WHERE TO GO. The map drew the hills and nothing else, so
       the one question every card asks (which building? which hill?) had no
       answer on it. Every standing building is a footprint now, and while a
       disaster is announced the places that answer it light up green (the
       buildings for "get inside", the tall ones and the hills for "get
       high"), the ones that kill you in it go red (buildings in a quake). */
    const adv = CBZ.game.mode === "survival" && CBZ.disasters && CBZ.disasters.advice ? CBZ.disasters.advice() : null;
    const kind = adv ? adv.kind : null;
    if (A.fragile) {
      for (let i = 0; i < A.fragile.length; i++) {
        const b = A.fragile[i]; if (b.fallen) continue;
        let fill = "rgba(205,210,220,.42)";
        if (kind === "indoors") fill = "rgba(70,230,130,.85)";
        else if (kind === "indoors_far") fill = adv.from && Math.hypot(b.ox - adv.from.x, b.oz - adv.from.z) > 65 ? "rgba(70,230,130,.85)" : "rgba(205,210,220,.3)";
        else if (kind === "high") fill = (b.h || 0) >= 12 ? "rgba(70,230,130,.85)" : "rgba(205,210,220,.3)";
        else if (kind === "open") fill = "rgba(255,90,70,.7)";
        ctx.fillStyle = fill;
        const w = Math.max(1.5, b.w * sc), d = Math.max(1.5, b.d * sc);
        ctx.fillRect(mx(b.ox) - w / 2, mz(b.oz) - d / 2, w, d);
      }
    }
    if (kind === "high" && A.hills) {
      ctx.strokeStyle = "rgba(70,230,130,.9)"; ctx.lineWidth = 1.5;
      for (let i = 0; i < A.hills.length; i++) {
        const h = A.hills[i]; if (h.peak < 9 && i !== 0) continue;
        ctx.beginPath(); ctx.arc(mx(h.x), mz(h.z), Math.max(2, h.r * 0.45 * sc), 0, 7); ctx.stroke();
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

  /* ============================================================
     THE ROUND CARD (2026-09-27). Show-don't-tell went one step too far:
     with every word gone a new player spent each disaster not knowing what
     it was or what the right move was, and the mode's whole idea (read the
     sky, run to the RIGHT kind of shelter) was invisible. The world still
     does the telling; this card says the two things the world cannot say
     in time: WHAT is coming and WHICH kind of place saves you, plus the one
     piece of feedback that makes the choice a game: are you somewhere safe
     right now. It lives in three shapes:
       brief / warn   the card: round number, name, the tip, a fuse that
                      burns down to impact, and the SAFE / EXPOSED chip
       active         a slim strip: name, the chip, the time it has left
       all-clear      SURVIVED, what it cost the island, how many are left
     Data comes from CBZ.disasters.advice() / safeAt() / lastResult().
     ============================================================ */
  let card = null, cEls = null, lastSeen = null, survT = 0, survMsg = null;
  function buildCard() {
    if (card) return;
    const st = document.createElement("style");
    st.textContent =
      "#survRound{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);z-index:40;pointer-events:none;" +
      "font-family:Fredoka,system-ui,sans-serif;color:#f4f7fb;text-align:center;min-width:min(88vw,420px);max-width:92vw;transition:opacity .35s ease}" +
      "#survRound .box{background:linear-gradient(180deg,rgba(12,16,24,.78),rgba(12,16,24,.62));border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:10px 18px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);backdrop-filter:blur(3px)}" +
      "#survRound .n{font-size:12px;letter-spacing:.22em;font-weight:600;color:#ffb46a;opacity:.95}" +
      "#survRound .nm{font-size:clamp(26px,5.2vw,44px);font-weight:700;letter-spacing:.02em;line-height:1.02;margin:2px 0 4px;text-shadow:0 3px 0 rgba(0,0,0,.35)}" +
      "#survRound .tip{font-size:clamp(14px,2.1vw,17px);font-weight:500;color:#dfe8f2}" +
      "#survRound .row{display:flex;align-items:center;gap:10px;margin-top:9px}" +
      "#survRound .fuse{flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}" +
      "#survRound .fuse i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#ff5a36,#ffb03a);border-radius:4px;transform-origin:left center}" +
      "#survRound .sec{font-size:15px;font-weight:700;min-width:30px;text-align:right;font-variant-numeric:tabular-nums}" +
      "#survRound .chip{font-size:12px;font-weight:700;letter-spacing:.12em;padding:4px 9px;border-radius:999px;white-space:nowrap}" +
      "#survRound .chip.safe{background:#1f9a55;color:#eafff2}#survRound .chip.bad{background:#c8322a;color:#fff1ee;animation:survPulse 1s ease-in-out infinite}" +
      "@keyframes survPulse{50%{opacity:.62}}" +
      "#survRound.slim .box{padding:6px 12px 8px}#survRound.slim .n,#survRound.slim .tip{display:none}#survRound.slim .nm{font-size:clamp(17px,2.8vw,22px);margin:0}#survRound.slim .row{margin-top:5px}" +
      "#survRound.won .nm{color:#7dffb0}#survRound.won .fuse,#survRound.won .sec,#survRound.won .chip{display:none}";
    document.head.appendChild(st);
    card = document.createElement("div");
    card.id = "survRound";
    card.style.opacity = "0";
    card.innerHTML = '<div class="box"><div class="n"></div><div class="nm"></div><div class="tip"></div>' +
      '<div class="row"><span class="chip"></span><div class="fuse"><i></i></div><span class="sec"></span></div></div>';
    document.body.appendChild(card);
    cEls = { n: card.querySelector(".n"), nm: card.querySelector(".nm"), tip: card.querySelector(".tip"),
      chip: card.querySelector(".chip"), fuse: card.querySelector(".fuse i"), sec: card.querySelector(".sec"), row: card.querySelector(".row") };
  }
  function setText(e, s) { if (e.textContent !== s) e.textContent = s; }
  function drawRoundCard(dt) {
    const D = CBZ.disasters;
    const live = CBZ.game.mode === "survival" && CBZ.game.state === "playing" && D && D.advice;
    if (!live) { if (card) card.style.opacity = "0"; return; }
    buildCard();
    const adv = D.advice();
    const last = D.lastResult ? D.lastResult() : null;
    if (last && last !== lastSeen) {
      lastSeen = last;
      if (last.you && !CBZ.player.dead) {
        survT = 3.6;
        survMsg = { n: "DISASTER " + last.n + " SURVIVED", nm: "YOU MADE IT",
          tip: (last.killed > 0 ? last.killed + (last.killed === 1 ? " person" : " people") + " did not.  " : "Nobody died.  ") + last.alive + " left alive" };
        if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
      }
    }
    if (survT > 0) survT -= dt;
    if (adv && (adv.phase !== "brief" || survT <= 0)) {
      survT = 0;
      const slim = adv.phase === "active";
      card.classList.toggle("slim", slim); card.classList.remove("won");
      setText(cEls.n, "DISASTER " + adv.n);
      setText(cEls.nm, adv.name);
      setText(cEls.tip, adv.tip);
      let frac, secs;
      if (slim) { const total = Math.max(1, adv.activeSecs || 20); secs = Math.max(0, -adv.tLeft); frac = secs / total; }
      else { const total = adv.brief + adv.warnSecs; secs = Math.max(0, adv.tLeft); frac = secs / total; }
      cEls.fuse.style.transform = "scaleX(" + Math.max(0, Math.min(1, frac)).toFixed(3) + ")";
      setText(cEls.sec, Math.ceil(secs) + "s");
      const P = CBZ.player;
      const s = !P.dead && D.safeAt ? D.safeAt(P.pos.x, P.pos.z, P.pos.y) : null;
      cEls.chip.style.display = s ? "" : "none";
      if (s) { cEls.chip.className = "chip " + (s.safe ? "safe" : "bad"); setText(cEls.chip, s.safe ? "SAFE HERE" : "NOT SAFE"); }
      card.style.opacity = "1";
    } else if (survT > 0 && survMsg) {
      card.classList.remove("slim"); card.classList.add("won");
      setText(cEls.n, survMsg.n); setText(cEls.nm, survMsg.nm); setText(cEls.tip, survMsg.tip);
      card.style.opacity = survT < 0.5 ? String(Math.max(0, survT / 0.5)) : "1";
    } else card.style.opacity = "0";
  }
  CBZ.survRoundCard = { el: () => card };

  /* ---- YOU ARE BEING HURT. The health bar was the only sign: ash in your
     lungs, a frostbite tick or a lightning side flash all just shortened a
     bar in the corner. A red edge that flares with every loss (scaled by
     it) and stays faintly on when you are low. ---- */
  let hurtEl = null, hurtK = 0, lastHp = null;
  function drawHurt(dt) {
    const on = CBZ.game.mode === "survival" && CBZ.game.state === "playing" && !CBZ.player.dead;
    if (!hurtEl) {
      hurtEl = document.createElement("div");
      hurtEl.id = "survHurt";
      hurtEl.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:35;opacity:0;" +
        "background:radial-gradient(ellipse at center,rgba(150,0,0,0) 52%,rgba(150,0,0,.55) 82%,rgba(90,0,0,.9) 100%)";
      document.body.appendChild(hurtEl);
    }
    const hp = CBZ.player.hp;
    if (!on) { hurtEl.style.opacity = "0"; lastHp = hp; hurtK = 0; return; }
    if (lastHp != null && hp < lastHp) {
      const d = lastHp - hp;
      hurtK = Math.min(1, hurtK + d * 0.045);
      if (d >= 12 && CBZ.shake) CBZ.shake(Math.min(0.5, d * 0.02));
    }
    lastHp = hp;
    hurtK *= Math.pow(0.12, dt);
    const low = hp < 35 ? (35 - hp) / 35 * (0.35 + 0.15 * Math.sin((CBZ.now || 0) * 0.008)) : 0;
    const o = Math.max(hurtK, low);
    hurtEl.style.opacity = o < 0.01 ? "0" : o.toFixed(3);
  }

  // onAlways, not onUpdate: the card must fade when the round ends or pauses
  CBZ.onAlways(49.5, function (dt) {
    const d = Math.min(0.1, dt || 1 / 60);
    drawRoundCard(d); drawHurt(d);
  });

  CBZ.onUpdate(49, function () {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
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
