/* ============================================================
   systems/gungamehud.js — the GUN GAME HUD. Wordless.

   The owner deleted the old text panel twice ("MASSIVE HUD SPACE WASTED ON
   WORDS THAT DONT EVER CHANGE", then "you know what gun you're on because
   you're holding it"). So nothing here is a sentence. Everything is either a
   shape that changes when the match changes, or news (a name you just killed,
   the name that just killed you).

     .gg-track     top-centre: nine slim segments = the ladder. Cleared rungs
                   are filled, your rung glows, the last segment is a fist.
                   A small red tick under a segment marks the leading bot's
                   rung, ONLY while a bot is ahead of you. Promote flashes the segment gold;
                   demote drains it red and shakes the track. It is NOT
                   permanent (HUD purge 2026-09-27): it shows for a few seconds
                   when your rung changes, while a bot sits on the fists, and
                   while you are dead, then fades (.gg-quiet).
     .gg-pulse     one full-screen edge pulse: gold (promote), orange-gold
                   (you reached the fists). A demotion is the track draining
                   and shaking, never a red screen.
     (low HP is your eyelids, systems/eyes.js fed by vitals.js; nothing here
      tints the view: owner 2026-09-30, "the red, what does that even mean?")
     .gg-shield    edge shimmer while spawn protection is live.
     .gg-arcs      damage direction: a pool of 4 pale arcs around the reticle,
                   each pointing at the attacker relative to where you face,
                   re-aimed every frame as you turn, gone in 0.9 s.
     .gg-kc        kill confirm under the reticle: skull pop + the victim's
                   name, tiny; melee kills are a gold fist (humiliation).
     .gg-death     while dead: killer name + their gun's picture, countdown ring
                   (the ring is the countdown; no digit inside it).
     #survBars     restyled (css/screens.css, gungame only) into one slim HP
                   bar with a .gg-hpghost damage trail. It fades in when you
                   are hit and stays while you are hurt (.gg-show); at full
                   health there is nothing on screen. No HP digit, no
                   stamina hairline.
     CBZ.gungameResultCard(win)  standings table on #survwin/#survlose.

   Events come from modes/gungame.js via gg.on(type, fn). Every field is
   guarded: a missing event or field makes the matching piece inert, never
   throws. Writes are change-only to prebuilt nodes; nothing here writes
   innerHTML per frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const hud = document.getElementById("hud");
  if (!hud) return;

  const SVGNS = "http://www.w3.org/2000/svg";
  // a knuckle-forward fist (viewBox 0 0 24 24) and a skull; drawn, never typed
  const FIST_D = "M6.2 9.4V7.3c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v-.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v.2c0-1 .8-1.7 1.8-1.7s1.7.8 1.7 1.7v.9c.2-.8.9-1.3 1.7-1.3 1 0 1.7.8 1.7 1.7v5.2c0 3.6-2.9 6.6-6.6 6.6h-1.2c-2.8 0-5.2-1.8-6.1-4.4l-.9-2.5c-.3-.9.1-1.9 1-2.3.8-.3 1.6-.1 2.1.5z";
  const SKULL_D = "M12 2.6c-4.7 0-8.2 3.3-8.2 7.8 0 2.6 1.2 4.6 3.1 5.8v2.6c0 .9.7 1.6 1.6 1.6h.8v-1.9h1.5v1.9h2.4v-1.9h1.5v1.9h.8c.9 0 1.6-.7 1.6-1.6v-2.6c1.9-1.2 3.1-3.2 3.1-5.8 0-4.5-3.5-7.8-8.2-7.8zM8.6 14.1c-1.2 0-2-.9-2-2.1s.9-2 2-2 2.1.9 2.1 2-.9 2.1-2.1 2.1zm6.8 0c-1.2 0-2.1-.9-2.1-2.1s.9-2 2.1-2 2 .9 2 2-.8 2.1-2 2.1zM12 17l-1.1-1.9h2.2z";

  function mk(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(d, cls, parent) {
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    if (cls) s.setAttribute("class", cls);
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    s.appendChild(p);
    if (parent) parent.appendChild(s);
    return s;
  }
  // restart a one-shot CSS animation class (remove, reflow, add, auto-clear)
  const timers = new WeakMap();
  function fire(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    const key = cls;
    let m = timers.get(el); if (!m) { m = {}; timers.set(el, m); }
    clearTimeout(m[key]);
    m[key] = setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function setCls(el, cls, on) {
    if (!el) return;
    if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
  }
  function ladder() { return (CBZ.CONFIG && CBZ.CONFIG.GUNGAME_LADDER) || []; }
  function N() { return Math.max(1, ladder().length || 9); }

  // ---- weapon picture (cached; the same photographs the hotbar chip uses) --
  const iconCache = {};
  function resolveRung(weapon) {
    // weapon may be an FPS id ("ak47"), a ladder name ("AK-47"), or "fists"
    if (weapon == null) return null;
    const w = String(weapon).toLowerCase();
    const L = ladder();
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      if (!r) continue;
      if ((r.id && r.id.toLowerCase() === w) || (r.name && r.name.toLowerCase() === w)) return r;
    }
    if (w === "fists" || w === "fist" || w === "melee" || w === "punch") return { id: "fists", melee: true };
    return { id: String(weapon) };
  }
  function iconSrc(id) {
    if (!id) return "";
    if (iconCache[id] !== undefined) return iconCache[id];
    let src = "";
    try { if (CBZ.itemIconGun) src = CBZ.itemIconGun(id) || ""; } catch (e) { src = ""; }
    if (!src) { try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(id) || ""; } catch (e) { src = ""; } }
    iconCache[id] = src;
    return src;
  }

  // ======================================================================
  // DOM (built once; css/screens.css hides #ggHud outside a live gungame)
  // ======================================================================
  const root = mk("div", "", hud);
  root.id = "ggHud";

  // full-screen layers, back to front
  const shieldEl = mk("div", "gg-shield", root);
  const pulseEl = mk("div", "gg-pulse", root);

  // ---- ladder track
  const trackEl = mk("div", "gg-track", root);
  const segs = [];
  let segCount = 0;
  function buildTrack() {
    const n = N();
    if (n === segCount) return;
    for (const s of segs) s.remove();
    segs.length = 0;
    const L = ladder();
    for (let i = 0; i < n; i++) {
      const s = mk("div", "gg-seg");
      if (i === n - 1 || (L[i] && L[i].melee)) { s.classList.add("fist"); svg(FIST_D, "gg-fistic", s); }
      trackEl.appendChild(s);
      segs.push(s);
    }
    segCount = n;
    S.rung = -1; S.rival = -1;   // fresh nodes carry no state
  }

  // ---- damage arcs (pool of 4)
  const arcsEl = mk("div", "gg-arcs", root);
  const arcs = [];
  for (let i = 0; i < 4; i++) {
    const w = mk("div", "gg-arc", arcsEl);
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 100 100");
    const p = document.createElementNS(SVGNS, "path");
    // arc at 12 o'clock, radius 44, spanning -26..+26 degrees
    p.setAttribute("d", "M30.7 10.5 A44 44 0 0 1 69.3 10.5");
    s.appendChild(p);
    w.appendChild(s);
    arcs.push({ el: w, t0: -1e9, x: 0, z: 0, by: null, deg: null, live: false });
  }

  // ---- kill confirm
  const kcEl = mk("div", "gg-kc", root);
  const kcSkull = svg(SKULL_D, "gg-kc-skull", kcEl);
  const kcFist = svg(FIST_D, "gg-kc-fist", kcEl);
  const kcName = mk("div", "gg-kc-name", kcEl);
  void kcSkull; void kcFist;

  // ---- death card
  const deathEl = mk("div", "gg-death", root);
  const ringWrap = mk("div", "gg-ring", deathEl);
  const RING_R = 21, RING_C = 2 * Math.PI * RING_R;
  const ringSvg = document.createElementNS(SVGNS, "svg");
  ringSvg.setAttribute("viewBox", "0 0 50 50");
  const ringBg = document.createElementNS(SVGNS, "circle");
  const ringFg = document.createElementNS(SVGNS, "circle");
  for (const c of [ringBg, ringFg]) {
    c.setAttribute("cx", "25"); c.setAttribute("cy", "25"); c.setAttribute("r", String(RING_R));
    ringSvg.appendChild(c);
  }
  ringBg.setAttribute("class", "bg"); ringFg.setAttribute("class", "fg");
  ringFg.setAttribute("stroke-dasharray", RING_C.toFixed(2));
  ringWrap.appendChild(ringSvg);
  const deathInfo = mk("div", "gg-death-info", deathEl);
  const deathSkull = svg(SKULL_D, "gg-death-skull", deathInfo);
  void deathSkull;
  const deathName = mk("div", "gg-death-name", deathInfo);
  const deathWep = mk("div", "gg-death-wep", deathInfo);
  const deathImg = mk("img", "", deathWep); deathImg.alt = "";
  const deathFist = svg(FIST_D, "gg-death-fist", deathWep);
  void deathFist;

  // ---- health plate: restyle the shared #survBars, add a ghost trail
  const bars = document.getElementById("survBars");
  const hpBar = document.getElementById("hpBar");
  let hpGhost = null;
  if (bars && hpBar && hpBar.parentNode) {
    hpGhost = mk("div", "gg-hpghost");
    hpBar.parentNode.insertBefore(hpGhost, hpBar);
  }

  // ======================================================================
  // state
  // ======================================================================
  const S = {
    gg: null, subscribed: false, match: null,
    rung: -1, rival: -2, threat: null,
    hp: -1, ghost: 100, ghostHoldT: 0, hpState: "", hpShowT: 0, hpShown: false,
    trackT: 0, trackShown: true,
    dead: false, deathBy: "", deathWeapon: null, respawnMax: 3, ringOff: "",
    shield: false,
    lastT: 0,
  };

  function resetMatch() {
    drawRival(-1);
    S.rung = -1; S.threat = null;
    S.ghost = 100; S.hp = -1;
    S.dead = false; S.deathBy = ""; S.deathWeapon = null;
    S.trackT = 3.5; S.hpShowT = 0;
    for (const a of arcs) { a.live = false; a.t0 = -1e9; a.el.classList.remove("on"); }
    setCls(deathEl, "on", false);
    setCls(kcEl, "on", false);
    buildTrack();
  }

  // ======================================================================
  // events (modes/gungame.js)
  // ======================================================================
  function onPromote(e) {
    const r = e && typeof e.rung === "number" ? e.rung : (S.gg ? S.gg.playerRung : 0);
    drawTrack(r); S.trackT = 3;
    if (segs[r - 1]) fire(segs[r - 1], "flash", 650);
    if (segs[r]) fire(segs[r], "arrive", 650);
    if (r < N() - 1) fire(pulseEl, "promote", 600);
  }
  function onDemote(e) {
    const r = e && typeof e.rung === "number" ? e.rung : (S.gg ? S.gg.playerRung : 0);
    drawTrack(r); S.trackT = 3;
    if (segs[r + 1]) fire(segs[r + 1], "drain", 750);
    fire(trackEl, "shake", 480);
  }
  function onFinal(e) {
    if (!e) return;
    S.trackT = 3;
    if (e.you) { fire(pulseEl, "final", 1100); if (segs[N() - 1]) fire(segs[N() - 1], "arrive", 900); }
    else fire(trackEl, "threatpop", 900);
  }
  function onKill(e) {
    if (!e) return;
    setCls(kcEl, "melee", !!e.melee);
    setCls(kcEl, "hs", !!e.headshot && !e.melee);
    const nm = e.victim ? String(e.victim) : "";
    if (kcName.textContent !== nm) kcName.textContent = nm;
    fire(kcEl, "on", 800);
  }
  function onHurt(e) {
    if (!e || typeof e.fromX !== "number" || typeof e.fromZ !== "number") return;
    const now = performance.now();
    // same attacker still on screen → refresh that arc; else oldest slot
    let slot = null;
    if (e.by) for (const a of arcs) if (a.live && a.by === e.by) { slot = a; break; }
    if (!slot) { slot = arcs[0]; for (const a of arcs) if (a.t0 < slot.t0) slot = a; }
    slot.x = e.fromX; slot.z = e.fromZ; slot.by = e.by || null; slot.t0 = now; slot.live = true;
    const k = Math.max(0.45, Math.min(1, (+e.dmg || 20) / 40));
    slot.el.style.setProperty("--k", k.toFixed(2));
    aimArc(slot);
    fire(slot.el, "on", 900);
    if (CBZ.eyes) CBZ.eyes.flinch(k);
  }
  function onDeath(e) {
    S.deathBy = e && e.by ? String(e.by) : "";
    S.deathWeapon = e ? resolveRung(e.weapon) : null;
    S.respawnMax = 0;   // captured from the first respawnT we see
    paintDeathInfo();
  }
  function onRespawn() {
    for (const a of arcs) { a.live = false; a.el.classList.remove("on"); }
  }
  function onMatchStart() { resetMatch(); }

  function subscribe(gg) {
    if (S.subscribed || !gg || typeof gg.on !== "function") return;
    S.subscribed = true;
    const on = function (type, fn) { try { gg.on(type, function (e) { try { fn(e); } catch (err) { /* HUD must never break the match */ } }); } catch (err) {} };
    on("matchstart", onMatchStart);
    on("promote", onPromote);
    on("demote", onDemote);
    on("final", onFinal);
    on("kill", onKill);
    on("hurt", onHurt);
    on("death", onDeath);
    on("respawn", onRespawn);
  }

  // ======================================================================
  // painters
  // ======================================================================
  function drawTrack(r) {
    buildTrack();
    if (r === S.rung) return;
    for (let i = 0; i < segs.length; i++) {
      setCls(segs[i], "done", i < r);
      setCls(segs[i], "cur", i === r);
    }
    S.rung = r;
  }
  function drawRival(rv) {
    if (rv === S.rival) return;
    if (segs[S.rival]) segs[S.rival].classList.remove("rv");
    if (segs[rv]) segs[rv].classList.add("rv");
    S.rival = rv;
  }

  function aimArc(a) {
    const P = CBZ.player && CBZ.player.pos;
    const yaw = CBZ.cam && typeof CBZ.cam.yaw === "number" ? CBZ.cam.yaw : 0;
    if (!P) return;
    const dx = a.x - P.x, dz = a.z - P.z;
    // forward (-sin, -cos), right (cos, -sin): angle 0 = ahead, + = clockwise
    const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    const rgt = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
    const deg = Math.round(Math.atan2(rgt, fwd) * 180 / Math.PI);
    if (deg !== a.deg) { a.deg = deg; a.el.style.transform = "translate(-50%,-50%) rotate(" + deg + "deg)"; }
  }

  function paintDeathInfo() {
    const nm = S.deathBy;
    if (deathName.textContent !== nm) deathName.textContent = nm;
    setCls(deathInfo, "anon", !nm);
    const r = S.deathWeapon;
    const melee = !!(r && (r.melee || r.id === "fists"));
    const src = r && !melee ? iconSrc(r.id) : "";
    setCls(deathWep, "melee", melee);
    setCls(deathWep, "img", !!src);
    if (src && deathImg.getAttribute("src") !== src) deathImg.setAttribute("src", src);
    // no picture and not fists: nothing (a typed gun name was the old fallback)
    setCls(deathWep, "none", !r || (!melee && !src));
  }

  function leaderBot(gg) {
    let lead = null;
    for (const b of gg.bots || []) {
      if (!b) continue;
      if (!lead || b.rung > lead.rung || (b.rung === lead.rung && (b.kills | 0) > (lead.kills | 0))) lead = b;
    }
    return lead;
  }

  // ======================================================================
  // tick
  // ======================================================================
  CBZ.onUpdate(49.2, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "gungame" || g.state !== "playing") return;
    const gg = CBZ.gungame;
    if (!gg || !gg.match) return;
    if (S.gg !== gg) { S.gg = gg; S.subscribed = false; }
    subscribe(gg);
    if (S.match !== gg.match) { S.match = gg.match; resetMatch(); }
    const step = typeof dt === "number" && dt > 0 && dt < 0.5 ? dt : 1 / 60;

    // ---- ladder: diff-driven fallback when the event bus is missing
    const r = Math.max(0, gg.playerRung | 0);
    if (r !== S.rung) {
      const prev = S.rung;
      if (!S.subscribed && prev >= 0) {
        if (r > prev) onPromote({ rung: r });
        else onDemote({ rung: r });
      } else drawTrack(r);
    }
    // the leading bot's tick: only while somebody is ahead of you
    const lead = leaderBot(gg);
    const rv = lead && lead.rung > r ? lead.rung : -1;
    drawRival(rv);
    const threat = !!(lead && lead.rung >= N() - 1 && r < N() - 1);
    setCls(trackEl, "threat", threat);
    if (S.trackT > 0) S.trackT -= step;
    const showTrack = S.trackT > 0 || threat || !!(CBZ.player && CBZ.player.dead);
    if (showTrack !== S.trackShown) { S.trackShown = showTrack; setCls(trackEl, "gg-quiet", !showTrack); }

    // ---- health plate
    const P = CBZ.player || {};
    const hp = Math.max(0, Math.min(100, Math.round(P.hp || 0)));
    if (hp !== S.hp) {
      if (hpBar) hpBar.style.width = hp + "%";
      if (hp > S.hp) { S.ghost = hp; if (hpGhost) hpGhost.style.width = hp + "%"; }
      else S.ghostHoldT = 0.45;
      if (S.hp >= 0 && hp < S.hp) S.hpShowT = 3;
      S.hp = hp;
      const st = hp > 60 ? "" : hp > 30 ? "gg-amber" : "gg-red";
      if (bars && st !== S.hpState) {
        bars.classList.remove("gg-amber", "gg-red");
        if (st) bars.classList.add(st);
        S.hpState = st;
      }
    }
    // the damage trail: holds, then drains toward the real bar
    if (S.ghost > hp) {
      if (S.ghostHoldT > 0) S.ghostHoldT -= step;
      else {
        S.ghost = Math.max(hp, S.ghost - 70 * step);
        if (hpGhost) hpGhost.style.width = S.ghost.toFixed(1) + "%";
      }
    }
    // the plate: on for a few seconds after a hit, and while you are hurt
    if (S.hpShowT > 0) S.hpShowT -= step;
    const showHp = !P.dead && (S.hpShowT > 0 || hp <= 60);
    if (showHp !== S.hpShown) { S.hpShown = showHp; setCls(bars, "gg-show", showHp); }

    const dead = !!P.dead;

    // ---- spawn protection shimmer
    const shield = !dead && (+gg.spawnProtectT || 0) > 0;
    if (shield !== S.shield) { S.shield = shield; setCls(shieldEl, "on", shield); }

    // ---- damage arcs follow your turning
    const now = performance.now();
    for (const a of arcs) {
      if (!a.live) continue;
      if (now - a.t0 > 900 || dead) { a.live = false; continue; }
      aimArc(a);
    }

    // ---- death card
    const showDeath = dead && (+gg.respawnT || 0) > 0 && !gg.match.over;
    if (showDeath !== S.dead) {
      S.dead = showDeath;
      setCls(deathEl, "on", showDeath);
      if (showDeath) { paintDeathInfo(); S.ringOff = ""; }
    }
    if (showDeath) {
      const t = +gg.respawnT;
      if (t > S.respawnMax) S.respawnMax = t;
      const max = Math.max(S.respawnMax, +(CBZ.CONFIG && CBZ.CONFIG.GUNGAME_RESPAWN_SEC) || 3, 0.01);
      const off = (RING_C * (1 - Math.min(1, t / max))).toFixed(1);
      if (off !== S.ringOff) { S.ringOff = off; ringFg.setAttribute("stroke-dashoffset", off); }
    }
  });

  // ======================================================================
  // RESULT CARD — standings on the shared survival result screens.
  // modes/gungame.js calls this from gungameFillResult. Built once per card,
  // rows rewritten per call (the end screen, not a frame loop).
  // ======================================================================
  function standingsNode(card) {
    const box = card && card.querySelector(".card-box");
    if (!box) return null;
    let t = box.querySelector(".gg-standings");
    if (t) return t;
    t = mk("div", "gg-standings");
    const stats = box.querySelector(".stats");
    if (stats && stats.nextSibling) box.insertBefore(t, stats.nextSibling);
    else box.appendChild(t);
    return t;
  }
  function miniTrack(rung, n) {
    const tr = mk("span", "gg-mini");
    for (let i = 0; i < n; i++) {
      const s = mk("i", i < rung ? "d" : i === rung ? "c" : "", tr);
      if (i === n - 1) s.classList.add("f");
    }
    return tr;
  }
  CBZ.gungameResultCard = function (win) {
    try {
      const card = document.getElementById(win ? "survwin" : "survlose");
      const t = standingsNode(card);
      if (!t) return;
      const rows = (CBZ.gungameStandings && CBZ.gungameStandings()) || [];
      const n = N();
      const gg = CBZ.gungame || {};
      const winner = gg.winner;
      while (t.firstChild) t.removeChild(t.firstChild);
      const show = [];
      for (let i = 0; i < rows.length && i < 6; i++) show.push(i);
      const youIdx = rows.findIndex(function (r) { return r && r.you; });
      if (youIdx >= 6) show.push(youIdx);
      for (const i of show) {
        const r = rows[i];
        const row = mk("div", "gg-row", t);
        if (r.you) row.classList.add("you");
        if (winner && (r.name === winner || (r.you && winner === "You"))) row.classList.add("win");
        if (i === youIdx && youIdx >= 6) row.classList.add("gap");
        mk("span", "gg-pl", row).textContent = String(i + 1);
        mk("span", "gg-nm", row).textContent = r.you ? "You" : String(r.name || "");
        row.appendChild(miniTrack(Math.max(0, r.rung | 0), n));
        mk("span", "gg-k", row).textContent = String(r.kills | 0);
      }
    } catch (e) { /* the end screen must still open */ }
  };
})();
