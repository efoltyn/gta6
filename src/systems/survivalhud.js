/* ============================================================
   systems/survivalhud.js — the disaster island's HUD (and the bars Shark
   Sim borrows). Styles: css/survival_hud.css.

   2026-10-14 REDESIGN. Owner: minimal, clear, beautiful, phone and desktop;
   no slop text, no dead buttons, nothing that breaks the fourth wall. What is
   on screen, and nothing else:

     THE CARD    top centre. The disaster and its real-world size in the unit
                 the world measures it in (Earthquake M6.8, Tornado EF3,
                 Hurricane Cat 4, Volcanic eruption VEI 5, Tsunami 18 m wave),
                 from CBZ.disasters.scale(), the def's own roll. Before it
                 lands, a ring burns down beside a quiet m:ss countdown; the
                 glyph in the ring is the kind of place that saves you (a
                 house, a hill, open ground...) and turns green where you
                 stand is right, red where it is not. While it runs the ring
                 is spent and the card says only what it is. It fades when
                 the sky clears.
     THE CLOCK   top right. How long you have lasted, the round, and how
                 many are still alive. Tabular figures, no labels.
     HEALTH      bottom centre, one slim bar, always there while you live;
                 the air bar joins it in the water, stamina while you run.
     THE GHOST   after you die: a small panel where the bars were, saying
                 how it ended and your place, with the one PLAY AGAIN button.
                 When the field is decided while you watch, it says who won.
                 The first time only, a one-line key hint for the spectator
                 camera (systems/spectator.js).

   The card and the clock stay up while you spectate: the disaster you are
   watching is still named.

   Shark Sim also carries body.mode-survival and runs through islandModeOn;
   every rule here is scoped to the disaster game and the shark keeps its
   bars exactly as they were.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;

  const el = {
    bars: document.getElementById("survBars"),
    hp: document.getElementById("hpBar"),
    stam: document.getElementById("stamBar"),
    flash: document.getElementById("survFlash"),
    alive: document.getElementById("aliveCount"),
  };
  // tag the two rows so the survival rules can show them one at a time
  // (gungamehud.js inserts its own node first in #survBars)
  const hpRow = el.hp && el.hp.closest ? el.hp.closest(".sbar") : null;
  const stRow = el.stam && el.stam.closest ? el.stam.closest(".sbar") : null;
  if (hpRow) hpRow.classList.add("sv-hprow");
  if (stRow) stRow.classList.add("sv-strow");

  function on() { const g = CBZ.game; return !!g && g.mode === "survival" && g.state === "playing"; }
  function clock(s) {
    s = Math.max(0, s | 0);
    const m = (s / 60) | 0, r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  function title(name) { name = String(name || ""); return name.charAt(0) + name.slice(1).toLowerCase(); }
  function setText(node, v) { if (node && node._t !== v) { node._t = v; node.textContent = v; } }
  function setCls(node, cls) { if (node && node._c !== cls) { node._c = cls; node.className = cls; } }

  /* ---- glyphs: drawn in a 24-unit box --------------------------------------- */
  const HOUSE = "M4.5 11.5 12 5.2l7.5 6.3M6.8 9.8V19h10.4V9.8M10.4 19v-4.3h3.2V19";
  const GLYPH = {
    indoors: HOUSE,
    indoors_far: HOUSE,
    high: "M2.5 20 9 10.5l3.6 5 2.6-3.4L21.5 20zM17 3.2v5.6M14.6 5.6 17 3.2l2.4 2.4",
    open: HOUSE + "M3.5 3.5l17 17",
    clear: "M12 3.5 6.8 11h3L6.3 16h11.4l-3.5-5h3zM12 16v4M3.5 3.5l17 17",
    away: "M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M2.8 12h4.4M4.9 9.8 2.8 12l2.1 2.2M21.2 12h-4.4M19.1 9.8l2.1 2.2-2.1 2.2",
  };
  const RING_R = 17, RING_C = 2 * Math.PI * RING_R;
  const PEOPLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="7.1" r="3.4"/><path d="M2.5 20.5c0-3.7 2.9-6.3 6.5-6.3s6.5 2.6 6.5 6.3z"/><circle cx="17.6" cy="8.6" r="2.5" opacity=".7"/><path d="M16.1 13.3c3.2-.6 6 1.8 6 5.2h-4.4c0-1.9-.6-3.7-1.6-5.2z" opacity=".7"/></svg>';

  /* ---- the DOM, built once on first use ------------------------------------- */
  const D = {};
  function build() {
    if (D.card) return;
    const card = document.createElement("div");
    card.id = "dzCard";
    card.innerHTML =
      '<div class="dz-ring"><svg viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle class="trk" cx="20" cy="20" r="' + RING_R + '"/>' +
      '<circle class="fuse" cx="20" cy="20" r="' + RING_R + '" stroke-dasharray="' + RING_C.toFixed(2) + '"/>' +
      '<g transform="translate(9.2 9.2) scale(.9)"><path class="gl" d=""/></g></svg></div>' +
      '<div class="dz-txt"><div class="dz-name"></div><div class="dz-sub"><span class="dz-scale"></span><span class="dz-when"></span></div></div>';
    document.body.appendChild(card);
    D.card = card;
    D.gl = card.querySelector(".gl"); D.fuse = card.querySelector(".fuse");
    D.name = card.querySelector(".dz-name"); D.scale = card.querySelector(".dz-scale"); D.when = card.querySelector(".dz-when");

    const st = document.createElement("div");
    st.id = "dzStats";
    st.innerHTML = '<div class="dz-time"></div><div class="dz-meta"><span class="dz-round"></span><span class="dz-alive">' + PEOPLE + '<b></b></span></div>';
    document.body.appendChild(st);
    D.stats = st; D.time = st.querySelector(".dz-time"); D.round = st.querySelector(".dz-round"); D.alive = st.querySelector(".dz-alive b");

    const gh = document.createElement("div");
    gh.id = "dzGhost";
    gh.innerHTML = '<div class="g-title">Eliminated</div><div class="g-line"></div><div class="g-place"></div>' +
      '<button type="button" id="dzAgain">Play again</button>';
    document.body.appendChild(gh);
    D.ghost = gh; D.gLine = gh.querySelector(".g-line"); D.gPlace = gh.querySelector(".g-place");
    const again = gh.querySelector("#dzAgain");
    const go = function (e) { if (e) { e.preventDefault(); e.stopPropagation(); } if (CBZ.surv && CBZ.surv.playAgain) CBZ.surv.playAgain(); };
    again.addEventListener("click", go);
    again.addEventListener("touchend", go, { passive: false });

    const hint = document.createElement("div");
    hint.id = "dzHint";
    document.body.appendChild(hint);
    D.hint = hint;
  }

  /* ---- THE CARD --------------------------------------------------------- */
  let cardFade = 0, lastAdv = null;
  function drawCard(dt) {
    const Dz = CBZ.disasters;
    const adv = on() && Dz && Dz.advice ? Dz.advice() : null;
    if (!adv) {
      // the sky cleared: hold the last card a beat, then let it go
      if (lastAdv) { cardFade = 1.2; lastAdv = null; }
      if (cardFade > 0) { cardFade -= dt; if (cardFade <= 0 && D.card) D.card.classList.remove("on"); }
      else if (D.card) D.card.classList.remove("on");
      return;
    }
    build();
    lastAdv = adv;
    const kind = GLYPH[adv.kind] ? adv.kind : "away";
    if (D.gl._k !== kind) { D.gl._k = kind; D.gl.setAttribute("d", GLYPH[kind]); }
    const active = adv.phase === "active";
    let off;
    if (active) off = RING_C.toFixed(1);
    else {
      const total = Math.max(1, adv.brief + adv.warnSecs);
      off = (RING_C * (1 - Math.max(0, Math.min(1, adv.tLeft / total)))).toFixed(1);
    }
    if (D.fuse._o !== off) { D.fuse._o = off; D.fuse.setAttribute("stroke-dashoffset", off); }
    setText(D.name, title(adv.name));
    const sc = Dz.scale && adv.phase !== "brief" ? Dz.scale() : null;
    setText(D.scale, sc || "");
    setText(D.when, active ? "" : clock(Math.ceil(Math.max(0, adv.tLeft))));
    const P = CBZ.player;
    const s = P && !P.dead && Dz.safeAt ? Dz.safeAt(P.pos.x, P.pos.z, P.pos.y) : null;
    setCls(D.card, "on " + (active ? "live " : "soon ") + (s ? (s.safe ? "safe" : "bad") : "") + (sc ? " has-scale" : ""));
  }

  /* ---- THE CLOCK -------------------------------------------------------- */
  function drawStats() {
    if (!on()) { if (D.stats) D.stats.classList.remove("on"); return; }
    build();
    const P = CBZ.player, S = CBZ.surv, g = CBZ.game;
    const t = P.dead && S.stats && S.stats.survivedT != null ? S.stats.survivedT : g.elapsed;
    setText(D.time, clock(t));
    const r = CBZ.disasters && CBZ.disasters.round ? CBZ.disasters.round() : 0;
    setText(D.round, r > 0 ? "Round " + r : "");
    setText(D.alive, String(S && S.aliveCount ? S.aliveCount() : 0));
    D.stats.classList.add("on");
  }

  /* ---- HEALTH ----------------------------------------------------------- */
  const shown = { hp: false, st: false };
  function barCls(name, want, key) {
    if (shown[key] === want) return;
    shown[key] = want;
    if (el.bars) el.bars.classList.toggle(name, want);
  }
  let lastHp = null;
  function drawBody() {
    const live = on();
    const P = CBZ.player;
    const alive = live && P && !P.dead;
    barCls("sv-hp", !!alive, "hp");
    const sw = alive && CBZ.citySwimState ? CBZ.citySwimState() : null;
    const max = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    barCls("sv-st", !!alive && (!!(sw && sw.swimming) || (P.stamina != null && P.stamina < max - 0.5)), "st");
    if (el.bars) el.bars.classList.toggle("sv-low", !!alive && P.hp < 30);
    // every loss is a flinch and a jolt scaled by it (systems/eyes.js); being
    // LOW is the red rim + heartbeat vitals.js already drives
    const hp = P ? P.hp : null;
    if (alive && lastHp != null && hp < lastHp) {
      const d = lastHp - hp;
      if (CBZ.eyes) CBZ.eyes.flinch(Math.min(1, d / 30));
      if (d >= 12 && CBZ.shake) CBZ.shake(Math.min(0.5, d * 0.02));
    }
    lastHp = alive ? hp : null;
  }

  /* ---- THE GHOST -------------------------------------------------------- */
  let ghostT = 0, hintT = -1, hintShown = false;
  const HINT_KEY = "cbz_spectate_hint";
  function hintSeen() { try { return localStorage.getItem(HINT_KEY) === "1"; } catch (e) { return false; } }
  function hintMark() { try { localStorage.setItem(HINT_KEY, "1"); } catch (e) {} }
  function cause(c) {
    c = String(c || "eliminated");
    return c.charAt(0).toUpperCase() + c.slice(1);
  }
  function drawGhost(dt) {
    const S = CBZ.surv, P = CBZ.player;
    const dead = on() && S && S.spectating && P && P.dead;
    if (!dead) {
      ghostT = 0; hintT = -1; hintShown = false;
      if (D.ghost) D.ghost.classList.remove("on");
      if (D.hint) D.hint.classList.remove("on");
      return;
    }
    build();
    ghostT += dt;
    // the death plays clean first: the panel lands once the body has
    if (ghostT > 1.6) D.ghost.classList.add("on");
    const st = S.stats || {};
    if (S.decided) setText(D.gLine, S.decided.winner ? S.decided.winner + " won" : "Nobody made it");
    else setText(D.gLine, cause(S._deathCause));
    setText(D.gPlace, "#" + (st.placement || 1) + " of " + (st.total || 1));
    // the first time only: how to fly, once the camera is yours
    const ph = CBZ.spectator ? CBZ.spectator.phase() : null;
    if (!hintShown && ph === "free" && !hintSeen()) {
      hintShown = true; hintT = 7; hintMark();
      D.hint.innerHTML = CBZ.touchMode
        ? "<span>Drag to look</span><span>Pinch to zoom</span><span>Two fingers to move</span>"
        : "<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> fly</span><span><kbd>Space</kbd><kbd>Shift</kbd> up, down</span><span><kbd>Scroll</kbd> zoom</span><span><kbd>R</kbd> play again</span>";
      D.hint.classList.add("on");
    }
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) D.hint.classList.remove("on"); }
  }

  // onAlways, not onUpdate: everything must fade when the round ends or pauses
  CBZ.onAlways(49.5, function (dt) {
    const d = Math.min(0.1, dt || 1 / 60);
    drawCard(d); drawStats(); drawBody(); drawGhost(d);
  });

  CBZ.onUpdate(49, function () {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
    const surv = CBZ.surv;
    if (el.alive) el.alive.textContent = surv.aliveCount();   // Shark Sim's pill
    if (el.hp) { const h = Math.max(0, CBZ.player.hp); el.hp.style.width = h + "%"; el.hp.style.background = h > 50 ? "#3ad17a" : (h > 22 ? "#ffd451" : "#ff4d4d"); }
    // THE STAMINA BAR BECOMES AN AIR BAR IN THE WATER (city/swim.js's breath
    // tank decides whether you make the roof)
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
    if (el.flash) el.flash.style.opacity = Math.min(0.92, CBZ.survEnv.flash).toFixed(2);
  });

  CBZ.survHud = {
    // what is on screen right now, for probes
    read() {
      const vis = (n) => !!(n && n.classList.contains("on"));
      return {
        card: vis(D.card), name: D.name ? D.name.textContent : "", scale: D.scale ? D.scale.textContent : "",
        when: D.when ? D.when.textContent : "", stats: vis(D.stats), time: D.time ? D.time.textContent : "",
        round: D.round ? D.round.textContent : "", ghost: vis(D.ghost), ghostLine: D.gLine ? D.gLine.textContent : "",
        place: D.gPlace ? D.gPlace.textContent : "", hint: vis(D.hint),
        hp: shown.hp,
      };
    },
  };
})();
