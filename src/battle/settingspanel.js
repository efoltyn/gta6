"use strict";
/* src/battle/settingspanel.js — NPC War: THE SETTINGS. How big a war this
   device fights and how it is drawn. One panel, opened from the gear in the
   war room and in the battle's control row; every choice is saved
   ("cbz-npcwar-settings") and most apply at once.

     ARMY CAP        the most men a side may field (the war room's number is
                     clamped to it when the war starts)
     FULL BODIES     how many men near the lens are full rigs with the page's
                     own brain (core/lod.js FULL_CAP)
     NEAR / MID      the FULL and MID tier radii (m), and how many individual
                     MID brains run (src/battle/mass.js, core/tiersim.js)
     QUALITY         the crowd's LOD bands and caps (entities/crowdgpu.js): how
                     close a man must be for the full instanced mesh, and from
                     how far he is an impostor (a few pixels tall), plus the
                     pixel-ratio ceiling
     SHADOWS         off / near (the rigs round the lens) / all
     DRAW DISTANCE   how far the crowd is drawn (m)
     AUTO            keep the frame rate: when it sags, give back what is FAR
                     first (draw distance, the far re-cut, impostor range, MID
                     brains, MID range) and the full rigs last; take it back
                     when there is room. What is near the lens is never the
                     first thing to go: speed never costs HD.
   Defaults are per device class (core/lod.js device()). URL keys still win
   for a tool (?fullcap ?midcap ?fullr ?midr, src/battle/mass.js).
   Every src/battle file shares ONE script scope (see ARCHITECTURE.md). */

const SETTINGS = (function () {
  const KEY = "cbz-npcwar-settings";
  const QUAL = {
    low:    { d1: 16, d2: 42, cap1: 24, cap2: 160, farEvery: 10, px: 1 },
    medium: { d1: 24, d2: 64, cap1: 60, cap2: 420, farEvery: 8, px: 1.5 },
    high:   { d1: 36, d2: 96, cap1: 120, cap2: 900, farEvery: 6, px: 2 },
    ultra:  { d1: 52, d2: 140, cap1: 260, cap2: 2200, farEvery: 4, px: 2 },
  };
  const DEF = {
    desktop: { army: 100000, fullcap: 320, midcap: 4000, fullr: 90, midr: 400, quality: "high", shadows: "near", draw: 4000, auto: true },
    tablet:  { army: 25000, fullcap: 160, midcap: 1500, fullr: 70, midr: 300, quality: "medium", shadows: "near", draw: 2400, auto: true },
    phone:   { army: 10000, fullcap: 90, midcap: 600, fullr: 55, midr: 220, quality: "low", shadows: "off", draw: 1600, auto: true },
  };
  const dev = CBZ.battleLod.DEVICE;
  const S = { dev: dev, QUAL: QUAL, user: null, cur: null, autoLvl: 0, autoT: 0, goodT: 0 };
  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
    S.user = Object.assign({}, DEF[dev] || DEF.desktop);
    for (const k in S.user) if (saved[k] != null) S.user[k] = saved[k];
    S.cur = Object.assign({}, S.user);
    Object.assign(S.cur, QUAL[S.cur.quality] || QUAL.high);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S.user)); } catch (e) {} }
  load();
  S.defaults = function () { return Object.assign({}, DEF[dev] || DEF.desktop); };
  /* what the war can apply now: the tiers' caps and radii, the crowd's
     bands, shadows, draw distance, the pixel-ratio ceiling */
  S.apply = function () {
    const c = S.cur;
    if (typeof MASS !== "undefined" && MASS.caps) {
      MASS.caps.full = c.fullcap; MASS.caps.mid = c.midcap;
      MASS.opt.fullr = c.fullr; MASS.opt.midr = c.midr;
    }
    if (CBZ.crowdGPU && CBZ.crowdGPU.setTier) CBZ.crowdGPU.setTier({ d1: c.d1, d2: c.d2, cap1: c.cap1, cap2: c.cap2 });
    if (CBZ.massDraw && CBZ.massDraw.on) CBZ.massDraw.applySettings();
    const R = CBZ.renderer || (CBZ.micro && CBZ.micro.renderer);
    if (R && R.shadowMap) {
      // a tiered war casts only its FULL rigs' shadows (the crowd casts none),
      // so NEAR is affordable at any size; an all-FULL war over 170 men was
      // always drawn without (begin.js), and the bench measures without
      const want = !bench && c.shadows !== "off" && (c.shadows === "all" || MASS.on || (SET.redN + SET.blueN) <= 170);
      if (R.shadowMap.enabled !== want) { R.shadowMap.enabled = want; R.shadowMap.needsUpdate = true; }
    }
    if (typeof RES !== "undefined" && RES.steps) {
      const top = Math.min(window.devicePixelRatio || 1, c.px || 2);
      RES.cap = top;
      if (RES.steps[RES.idx] > top + 1e-3 && typeof applyRes === "function") {
        RES.idx = Math.max(0, RES.steps.findIndex(function (v) { return v <= top + 1e-3; }));
        applyRes();
      }
    }
  };
  S.set = function (k, v) {
    S.user[k] = v;
    S.cur = Object.assign({}, S.user, QUAL[S.user.quality] || QUAL.high);
    S.autoLvl = 0;
    save();
    S.apply();
  };
  S.reset = function () {
    S.user = S.defaults(); save();
    S.cur = Object.assign({}, S.user, QUAL[S.user.quality] || QUAL.high);
    S.autoLvl = 0; S.apply(); paint();
  };
  // the war room's number, held to the cap when the war starts
  S.clampArmy = function () {
    const cap = Math.max(1, S.cur.army | 0);
    if (SET.redN > cap) SET.redN = cap;
    if (SET.blueN > cap) SET.blueN = cap;
  };
  /* ---- AUTO: the far gives way first, the near last ---- */
  const STEPS = [
    function (c, u, k) { c.draw = Math.max(600, u.draw * Math.pow(0.85, k)); },
    function (c, u, k) { c.farEvery = Math.min(16, (QUAL[u.quality] || QUAL.high).farEvery + 2 * k); },
    function (c, u, k) { const q = QUAL[u.quality] || QUAL.high; c.d2 = Math.max(c.d1 + 6, q.d2 * Math.pow(0.85, k)); c.cap2 = Math.max(80, Math.round(q.cap2 * Math.pow(0.8, k))); },
    function (c, u, k) { c.midcap = Math.max(300, Math.round(u.midcap * Math.pow(0.8, k))); },
    function (c, u, k) { c.midr = Math.max(c.fullr * 1.6, u.midr * Math.pow(0.85, k)); },
    function (c, u, k) { c.fullcap = Math.max(80, Math.round(u.fullcap * Math.pow(0.85, k))); },
  ];
  function autoApply() {
    const u = S.user, c = Object.assign({}, u, QUAL[u.quality] || QUAL.high);
    // level L: each step taken floor(L / n) + (its index < L % n) times, in order
    const L = S.autoLvl, n = STEPS.length;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(L / n) + (i < L % n ? 1 : 0);
      if (k > 0) STEPS[i](c, u, k);
    }
    S.cur = c;
    S.apply();
  }
  S.tick = function (dt) {
    if (!S.cur.auto || !started || bench) return;
    S.autoT += dt;
    if (S.autoT < 2) return;
    S.autoT = 0;
    const fps = CBZ.micro.fps || 0;
    if (fps <= 4) return;
    const target = dev === "desktop" ? 55 : 30;
    if (fps < target * 0.85 && S.autoLvl < STEPS.length * 4) { S.autoLvl++; S.goodT = 0; autoApply(); }
    else if (fps > target * 1.12 && S.autoLvl > 0) { if ((S.goodT += 2) >= 6) { S.goodT = 0; S.autoLvl--; autoApply(); } }
    else S.goodT = 0;
  };

  /* ---- THE PANEL (built here: battle.html stays markup + scripts) ---- */
  let P = null;
  const ROWS = [
    ["army", "ARMY CAP", "sel", [1000, 5000, 10000, 25000, 50000, 100000, 250000], function (v) { return v >= 1000 ? (v / 1000) + "K" : v; }],
    ["fullcap", "FULL BODIES", "sel", [60, 120, 200, 320, 500, 800, 1200]],
    ["fullr", "NEAR RANGE", "sel", [40, 55, 70, 90, 120, 160], function (v) { return v + " M"; }],
    ["midcap", "MID BRAINS", "sel", [300, 600, 1500, 2500, 4000, 8000, 16000]],
    ["midr", "MID RANGE", "sel", [150, 220, 300, 400, 600, 900], function (v) { return v + " M"; }],
    ["quality", "QUALITY", "sel", ["low", "medium", "high", "ultra"], function (v) { return v.toUpperCase(); }],
    ["shadows", "SHADOWS", "sel", ["off", "near", "all"], function (v) { return v.toUpperCase(); }],
    ["draw", "DRAW DISTANCE", "sel", [800, 1600, 2400, 4000, 6000], function (v) { return v >= 1000 ? (v / 1000) + " KM" : v + " M"; }],
    ["auto", "AUTO QUALITY", "sel", [true, false], function (v) { return v ? "ON" : "OFF"; }],
  ];
  function build() {
    if (P || typeof document === "undefined" || !document.body || !document.body.appendChild) return;
    P = document.createElement("div");
    P.id = "setp";
    let h = '<div class="in"><h2>SETTINGS</h2><div class="dev" id="setDev"></div>';
    for (let i = 0; i < ROWS.length; i++) {
      const R = ROWS[i];
      h += '<label class="f"><span>' + R[1] + '</span><select data-k="' + R[0] + '">';
      for (let j = 0; j < R[3].length; j++) {
        const v = R[3][j];
        h += '<option value="' + j + '">' + (R[4] ? R[4](v) : v) + "</option>";
      }
      h += "</select></label>";
    }
    h += '<div class="acts"><button id="setReset">DEVICE DEFAULTS</button><button id="setDone">DONE</button></div></div>';
    P.innerHTML = h;
    document.body.appendChild(P);
    const sels = P.querySelectorAll("select");
    for (let i = 0; i < sels.length; i++) {
      const s = sels[i];
      s.addEventListener("change", function () {
        const R = ROWS.find(function (x) { return x[0] === s.dataset.k; });
        S.set(R[0], R[3][+s.value]);
      });
    }
    const btn = function (id, fn) { const b = el(id); if (b) b.addEventListener("click", fn); };
    btn("setReset", function () { S.reset(); });
    btn("setDone", function () { S.close(); });
  }
  function nearest(list, v) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = typeof v === "number" ? Math.abs(list[i] - v) : (list[i] === v ? 0 : 1);
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  }
  function paint() {
    if (!P || !P.querySelectorAll) return;
    const sels = P.querySelectorAll("select");
    for (let i = 0; i < sels.length; i++) {
      const R = ROWS.find(function (x) { return x[0] === sels[i].dataset.k; });
      if (R) sels[i].value = String(nearest(R[3], S.user[R[0]]));
    }
    const d = el("setDev");
    if (d) d.textContent = dev.toUpperCase() + (S.autoLvl ? "  AUTO -" + S.autoLvl : "");
  }
  S.open = function () { build(); if (!P) return; paint(); P.classList.add("on"); };
  S.close = function () { if (P) P.classList.remove("on"); };
  S.toggle = function () { if (P && P.classList.contains("on")) S.close(); else S.open(); };
  return S;
})();
CBZ.npcwar.onBoot(function () {
  // the gear: in the battle's control row and on the war room's dock
  const gear = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
  const ctl = el("ctl");
  if (ctl && ctl.appendChild) {
    const b = document.createElement("button");
    b.id = "cSet"; b.setAttribute("aria-label", "settings"); b.innerHTML = gear;
    b.addEventListener("click", function () { SETTINGS.toggle(); });
    ctl.appendChild(b);
  }
  const dock = document.querySelector ? document.querySelector("#menu .din") : null;
  if (dock && dock.appendChild) {
    const b = document.createElement("button");
    b.id = "mSet"; b.className = "setlink"; b.textContent = "SETTINGS";
    b.addEventListener("click", function () { SETTINGS.open(); });
    dock.appendChild(b);
  }
  CBZ.micro.onFrame(function (dt) { SETTINGS.tick(dt); }, { order: 60 });
});
