/* ============================================================
   systems/survivalhud.js — the island HUD (Disaster Survival, and the bars
   Shark Sim borrows).

   HUD PURGE (2026-09-27). Owner: "every HUD ... should be considered for
   removal, including the minimap, the timer, the PB ... SHOW DON'T TELL".
   What a Disaster Survival player sees now, and only when it matters:

     THE CUE      top centre, one round glyph, no words. While a disaster is
                  coming it shows the KIND of place that saves you (a house:
                  get inside; a hill and an arrow: get high; a struck-out
                  house: get out of the buildings; a struck-out tree: get away
                  from the trees; arrows: get clear of it) inside a ring that
                  burns down to impact. The glyph turns green when you are
                  standing somewhere that works and pulses red when you are
                  not. It stays small while the disaster runs, then fades.
                  The name, round number, tip sentence, seconds readout, the
                  SAFE HERE / NOT SAFE chip and the SURVIVED card are gone:
                  the world shows WHAT it is, the glyph says WHERE to go.
     HURT EDGE    red screen edge that flares with every loss and breathes
                  when you are low.
     BARS         health shows for a few seconds after you are hit and stays
                  while you are low; stamina only while it is not full; the
                  stamina bar becomes an AIR bar in the water. No captions.
     ALIVE COUNT  the #survTop pill fades in for the lull after each disaster
                  (what the round cost) and stays for the last five.
     FLASH        lightning / nuke white-out (a screen effect, not a readout).

   Deleted for survival: the minimap drawing (the canvas was never visible in
   this mode: systems/minimap.js only raises it in escape), the match clock,
   and the casualty kill feed (99 names nobody knows; the crowd visibly thins
   and the alive count says what it cost). Those two are hidden by a
   survival-scoped rule below because their elements are shared.

   Shark Sim also carries body.mode-survival and runs through islandModeOn,
   so every rule here is scoped `:not(.mode-sharksim)` and the shark keeps its
   bars exactly as they were.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    alive: document.getElementById("aliveCount"),
    top: document.getElementById("survTop"),
    bars: document.getElementById("survBars"),
    hp: document.getElementById("hpBar"),
    stam: document.getElementById("stamBar"),
    flash: document.getElementById("survFlash"),
  };
  // tag the two rows so the survival rules can show them one at a time
  // (gungamehud.js inserts its own node first in #survBars, so :first-child
  // cannot be trusted)
  const hpRow = el.hp && el.hp.closest ? el.hp.closest(".sbar") : null;
  const stRow = el.stam && el.stam.closest ? el.stam.closest(".sbar") : null;
  if (hpRow) hpRow.classList.add("sv-hprow");
  if (stRow) stRow.classList.add("sv-strow");

  const SV = "body.mode-survival:not(.mode-sharksim)";
  (function injectStyle() {
    const st = document.createElement("style");
    st.id = "survHudStyle";
    st.textContent =
      SV + " #topright #timer," + SV + " #cityKillFeed," + SV + " #minimap," +
      SV + " #interactNote{display:none!important}" +
      SV + " #topright #survTop{opacity:0;transition:opacity .6s ease}" +
      SV + " #topright #survTop.sv-on{opacity:1}" +
      SV + " #survBars{width:min(220px,46vw);bottom:calc(20px + env(safe-area-inset-bottom,0px))}" +
      SV + " #survBars .slab{display:none}" +
      SV + " #survBars .sbar{margin-top:5px;opacity:0;transition:opacity .5s ease}" +
      SV + " #survBars .sbarbg{height:6px}" +
      SV + " #survBars.sv-hp .sv-hprow," + SV + " #survBars.sv-st .sv-strow{opacity:1}" +
      "#survCue{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));width:64px;height:64px;margin-left:-32px;z-index:40;" +
      "pointer-events:none;opacity:0;transform:scale(1);transform-origin:50% 0;transition:opacity .4s ease,transform .4s ease}" +
      "#survCue.slim{transform:scale(.78)}" +
      "#survCue .disc{position:absolute;inset:6px;border-radius:50%;background:rgba(10,14,22,.55);box-shadow:0 4px 14px rgba(0,0,0,.3)}" +
      "#survCue svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}" +
      "#survCue .trk{fill:none;stroke:rgba(255,255,255,.14);stroke-width:3}" +
      "#survCue .fuse{fill:none;stroke:#ffb03a;stroke-width:3;stroke-linecap:round;transform:rotate(-90deg);transform-origin:32px 32px}" +
      "#survCue .gl{fill:none;stroke:#f4f7fb;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:stroke .25s}" +
      "#survCue.safe .gl{stroke:#3ddc84}#survCue.safe .trk{stroke:rgba(61,220,132,.55)}" +
      "#survCue.bad .gl{stroke:#ff5a46}#survCue.bad .disc{animation:survCuePulse 1s ease-in-out infinite}" +
      "@keyframes survCuePulse{50%{box-shadow:0 0 0 4px rgba(255,80,60,.45),0 4px 14px rgba(0,0,0,.3)}}" +
      "@media (prefers-reduced-motion:reduce){#survCue.bad .disc{animation:none}}";
    document.head.appendChild(st);
  })();

  CBZ.survHud = {};

  /* ---- THE CUE ------------------------------------------------------------
     Glyphs are drawn in a 24-unit box, placed in the 64-unit cue at (20,20). */
  const HOUSE = "M4.5 11.5 12 5.2l7.5 6.3M6.8 9.8V19h10.4V9.8M10.4 19v-4.3h3.2V19";
  const GLYPH = {
    indoors: HOUSE,
    indoors_far: HOUSE,
    high: "M2.5 20 9 10.5l3.6 5 2.6-3.4L21.5 20zM17 3.2v5.6M14.6 5.6 17 3.2l2.4 2.4",
    open: HOUSE + "M3.5 3.5l17 17",
    clear: "M12 3.5 6.8 11h3L6.3 16h11.4l-3.5-5h3zM12 16v4M3.5 3.5l17 17",
    away: "M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M2.8 12h4.4M4.9 9.8 2.8 12l2.1 2.2M21.2 12h-4.4M19.1 9.8l2.1 2.2-2.1 2.2",
  };
  const FUSE_R = 29, FUSE_C = 2 * Math.PI * FUSE_R;
  let cue = null, cueGl = null, cueFuse = null, cueKind = "", cueCls = "", cueOff = "", lastSeen = null;
  function buildCue() {
    if (cue) return;
    cue = document.createElement("div");
    cue.id = "survCue";
    cue.innerHTML = '<div class="disc"></div><svg viewBox="0 0 64 64" aria-hidden="true">' +
      '<circle class="trk" cx="32" cy="32" r="' + FUSE_R + '"/>' +
      '<circle class="fuse" cx="32" cy="32" r="' + FUSE_R + '" stroke-dasharray="' + FUSE_C.toFixed(2) + '"/>' +
      '<g transform="translate(20 20)"><path class="gl" d=""/></g></svg>';
    document.body.appendChild(cue);
    cueGl = cue.querySelector(".gl");
    cueFuse = cue.querySelector(".fuse");
  }
  function drawCue() {
    const D = CBZ.disasters;
    const live = CBZ.game.mode === "survival" && CBZ.game.state === "playing" && D && D.advice;
    const adv = live ? D.advice() : null;
    if (!adv) { if (cue) cue.style.opacity = "0"; return; }
    buildCue();
    const kind = GLYPH[adv.kind] ? adv.kind : "away";
    if (kind !== cueKind) { cueKind = kind; cueGl.setAttribute("d", GLYPH[kind]); }
    const active = adv.phase === "active";
    let off;
    if (active) off = FUSE_C.toFixed(1);   // the fuse has burnt out: impact
    else {
      const total = Math.max(1, adv.brief + adv.warnSecs);
      const frac = Math.max(0, Math.min(1, adv.tLeft / total));
      off = (FUSE_C * (1 - frac)).toFixed(1);
    }
    if (off !== cueOff) { cueOff = off; cueFuse.setAttribute("stroke-dashoffset", off); }
    const P = CBZ.player;
    const s = !P.dead && D.safeAt ? D.safeAt(P.pos.x, P.pos.z, P.pos.y) : null;
    const cls = (active ? "slim " : "") + (s ? (s.safe ? "safe" : "bad") : "");
    if (cls !== cueCls) { cueCls = cls; cue.className = cls; }
    cue.style.opacity = "1";
  }

  /* ---- YOU ARE BEING HURT: a red edge that flares with every loss (scaled
     by it) and stays faintly on when you are low. ---- */
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

  /* ---- WHAT SHOWS WHEN: bars and the alive pill, survival only ---- */
  let hpShowT = 0, aliveShowT = 0, barHp = null;
  const shown = { hp: false, st: false, alive: false };
  function setCls(node, name, on, key) {
    if (!node || shown[key] === on) return;
    shown[key] = on; node.classList.toggle(name, on);
  }
  function drawContext(dt) {
    const g = CBZ.game;
    const on = g.mode === "survival" && g.state === "playing";
    if (!on) {
      setCls(el.bars, "sv-hp", false, "hp"); setCls(el.bars, "sv-st", false, "st"); setCls(el.top, "sv-on", false, "alive");
      barHp = null; hpShowT = 0; aliveShowT = 0; lastSeen = null;
      return;
    }
    const P = CBZ.player;
    const hp = P.hp;
    if (barHp != null && hp < barHp - 0.01) hpShowT = 3.5;
    barHp = hp;
    if (hpShowT > 0) hpShowT -= dt;
    setCls(el.bars, "sv-hp", !P.dead && (hpShowT > 0 || hp < 40), "hp");
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
    const max = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    setCls(el.bars, "sv-st", !P.dead && (!!(sw && sw.swimming) || (P.stamina != null && P.stamina < max - 0.5)), "st");

    // the lull after a disaster: what it cost, and a coin for living through it
    const D = CBZ.disasters;
    const last = D && D.lastResult ? D.lastResult() : null;
    if (last && last !== lastSeen) {
      lastSeen = last;
      if (last.you && !P.dead) {
        aliveShowT = 4.5;
        if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
      }
    }
    if (aliveShowT > 0) aliveShowT -= dt;
    const n = CBZ.surv && CBZ.surv.aliveCount ? CBZ.surv.aliveCount() : 99;
    setCls(el.top, "sv-on", aliveShowT > 0 || n <= 5, "alive");
  }

  // onAlways, not onUpdate: the cue must fade when the round ends or pauses
  CBZ.onAlways(49.5, function (dt) {
    const d = Math.min(0.1, dt || 1 / 60);
    drawCue(); drawHurt(d); drawContext(d);
  });

  CBZ.onUpdate(49, function () {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
    const surv = CBZ.surv;
    if (el.alive) el.alive.textContent = surv.aliveCount();
    if (el.hp) { const h = Math.max(0, CBZ.player.hp); el.hp.style.width = h + "%"; el.hp.style.background = h > 50 ? "#3ad17a" : (h > 22 ? "#ffd451" : "#ff4d4d"); }
    // THE STAMINA BAR BECOMES AN AIR BAR IN THE WATER. city/swim.js owns the
    // island's swimmer, and its breath tank decides whether you make the roof,
    // so the same bar shows it in a colour that says "this one is different".
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
  });
})();
