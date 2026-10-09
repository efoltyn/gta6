/* ============================================================
   city/phone.js — THE PHONE IN YOUR HAND (Gang City, every player).

   OWNER: "PHONE ADDED TO GANG CITY SO PRES CAN SEE NEWS, AND THEN ALSO CALL
   PEOPLE AND THINGS AND DECLARE WAR OVER IN-GAME FAKE TWITTER ETC".

   WHAT WAS HERE. A DOM modal on [P]: a dark card listing NEWS & MESSAGES,
   CONTACTS, GIG WORK, SERVICES and DEMOLITION as HTML rows. It had no
   hotbar slot, no touch way in, nothing in your hand, and it stood down
   whenever the story campaign's own handset (campaign_ui.js) was live. So in
   ordinary Gang City you had a phone only if you knew to press P, and what
   opened was a settings-style panel, not a phone. That is why the owner
   thought there was none. It is deleted; the demolition card went because
   the detonator is already a cell in your hand (systems/helditems.js).

   NOW. A real handset, drawn in 3D, with its screen painted on a canvas:
     - The PHONE cell on the hotbar (tap it, or its digit, or P) takes it out.
       In first person it comes up in front of you in your right hand
       (helditems.js poses the hand under it, this file owns the handset); in
       third person the body holds it at the chest and the same handset is
       raised in front of the camera so you can read it.
     - Taking it out frees the cursor (CBZ.cityMenuOpen is on camera.js's
       pause-exemption list). Clicks and taps land ON the glass: a ray from
       the camera through the pointer hits the screen plane, its UV is the
       canvas pixel. Touches elsewhere still walk and look.
     - Drawing a gun puts it away (the held-item rule: one thing in the hand).
     - While it is up, nothing from the world's HUD sits on it: any touch
       button, verb chip or the wheel whose box crosses the handset is hidden
       (coverHud), the handset stands above the hotbar, and the voice on the
       line is drawn beside it (CBZ.phoneScreenRect, systems/speech.js).
   Apps: News, Calls (opens on the call log), Holler, and the Map (which is the full map). All the
   logic is city/phone_apps.js; this file only draws it and routes input.

   KEYS: P take out / put away, Esc back (home: put away).

   PUBLIC: CBZ.phoneOpen(app?), CBZ.phoneClose(), CBZ.phoneToggle(),
   CBZ.phoneIsOpen(), CBZ.cityPhoneChip() (the hotbar cell),
   CBZ.cityOpenPhone / cityClosePhone (fullmap.js, campaign_ui.js),
   CBZ.phoneFpHold(vm, T) (helditems.js), CBZ.phoneBuildProp(kind),
   CBZ.phoneAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || typeof document === "undefined") return;
  const g = CBZ.game || (CBZ.game = {});
  const A = function () { return CBZ.phoneApps || null; };

  // ---------------------------------------------------------------- the device
  const BODY = { w: 0.072, h: 0.150, d: 0.0085 };
  const GLASS = { w: 0.0655, h: 0.131 };          // 1:2, the canvas's aspect
  const CW = 512, CH = 1024;

  let cv = null, ctx = null, tex = null, screenMat = null;
  function ensureCanvas() {
    if (cv) return true;
    cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
    ctx = cv.getContext("2d");
    if (!ctx) { cv = null; return false; }
    tex = new THREE.CanvasTexture(cv);
    if (THREE.sRGBEncoding != null) tex.encoding = THREE.sRGBEncoding;   // core/renderer.js outputs sRGB
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    screenMat = new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false });
    screenMat._shared = true;
    return true;
  }

  // one handset: graphite slab, the glass inset on its face, two side keys,
  // the camera island on the back. Real size; the caller scales it.
  const GEO = {};
  function geos() {
    if (GEO.body) return GEO;
    GEO.body = new THREE.BoxGeometry(BODY.w, BODY.h, BODY.d);
    GEO.glass = new THREE.PlaneGeometry(GLASS.w, GLASS.h);
    GEO.key = new THREE.BoxGeometry(0.0016, 0.018, 0.003);
    GEO.lens = new THREE.BoxGeometry(0.026, 0.026, 0.0016);
    for (const k in GEO) GEO[k]._shared = true;
    return GEO;
  }
  function build(kind) {
    ensureCanvas();
    const G = geos();
    const view = kind === "view";
    const grp = new THREE.Group();
    grp.name = "phone_" + kind;
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1d2026, fog: !view });
    const keyMat = new THREE.MeshLambertMaterial({ color: 0x3a3e46, fog: !view });
    const glassMat = view ? screenMat.clone() : screenMat;
    const body = new THREE.Mesh(G.body, bodyMat);
    grp.add(body);
    const glass = new THREE.Mesh(G.glass, glassMat);
    glass.position.set(0, 0.0015, BODY.d / 2 + 0.0002);
    grp.add(glass);
    const k1 = new THREE.Mesh(G.key, keyMat); k1.position.set(BODY.w / 2 + 0.0006, 0.03, 0); grp.add(k1);
    const k2 = new THREE.Mesh(G.key, keyMat); k2.position.set(-BODY.w / 2 - 0.0006, 0.035, 0); grp.add(k2);
    const lens = new THREE.Mesh(G.lens, keyMat); lens.position.set(-0.016, 0.052, -BODY.d / 2 - 0.0007); grp.add(lens);
    grp.userData.glass = glass; grp.userData.body = body;
    grp.traverse(function (o) {
      o.castShadow = false; o.receiveShadow = false;
      if (view) {
        // the handset you are looking at: drawn after the world (the depth clear
        // in first person, depthTest off in third), never culled, never fogged
        o.frustumCulled = false;
        if (o.material) { o.material.transparent = true; o.material.depthWrite = true; }
        o.renderOrder = o === glass ? 1004 : 1003;
      } else o.userData.dynamic = true;
    });
    return grp;
  }
  let VIEW = null;
  function view() {
    if (VIEW) return VIEW;
    VIEW = build("view");
    VIEW.visible = false;
    if (CBZ.camera) CBZ.camera.add(VIEW);
    return VIEW;
  }
  // helditems.js asks for the prop the body holds in third person
  CBZ.phoneBuildProp = function () { return build("tp"); };

  // ---------------------------------------------------------------- state
  const ST = { open: false, app: "home", scroll: { news: 0, calls: 0, social: 0 }, maxScroll: { news: 0, calls: 0, social: 0 },
    hits: [], dirty: true, paintT: 0, toast: null, toastUntil: 0, fpFrame: -9, frame: 0, buzzUntil: 0, ringT: 0, opens: 0, taps: 0 };

  function playing() { return g.mode === "city" && g.state === "playing"; }
  function campaignLive() {
    try { const c = CBZ.campaignPhoneChip ? CBZ.campaignPhoneChip() : null; return !!(c && c.available); } catch (e) { return false; }
  }
  function fpActive() { return !!(CBZ.fps && CBZ.fps.active); }

  // ---------------------------------------------------------------- open / close
  function open(app) {
    if (!playing() || campaignLive()) return false;
    const P = CBZ.player;
    if (!P || P.dead) return false;
    if (CBZ.fullMap && CBZ.fullMap.active && CBZ.fullMap.close) { try { CBZ.fullMap.close(false); } catch (e) {} }
    if (CBZ.cityMenuOpen && !ST.open) return false;
    if (!ensureCanvas()) return false;
    // into the hand: the held-item rule puts a drawn gun away. Behind the wheel
    // the hands stay on it and the handset is just raised to the eye.
    ST.inHand = false;
    if (CBZ.heldItem && !P.driving) {
      try { ST.inHand = CBZ.heldItem.current() === "phone" || !!CBZ.heldItem.select("phone"); } catch (e) { ST.inHand = false; }
      if (!ST.inHand) return false;                 // cuffed: nothing comes out of the pocket
    }
    ST.open = true; ST.opens++;
    CBZ.cityMenuOpen = true;
    if (document.body && document.body.classList) document.body.classList.add("city-phone-up");
    barReadT = 0; coverT = 0;
    if (CBZ.keys) for (const k in CBZ.keys) CBZ.keys[k] = false;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const Ap = A();
    if (app) ST.app = app;
    if (ST.app !== "home" && Ap && Ap.markRead) Ap.markRead(ST.app);
    ST.dirty = true;
    paint();
    if (CBZ.sfx) { try { CBZ.sfx("switch", { volume: 0.25, pitch: 1.4 }); } catch (e) {} }
    return true;
  }
  function close(relock) {
    if (!ST.open) return false;
    ST.open = false;
    CBZ.cityMenuOpen = false;
    if (document.body && document.body.classList) document.body.classList.remove("city-phone-up");
    RECT = null;
    uncoverAll();
    if (CBZ.heldItem && CBZ.heldItem.current && CBZ.heldItem.current() === "phone") { try { CBZ.heldItem.clear(); } catch (e) {} }
    if (VIEW) VIEW.visible = false;
    ST.drag = null;
    if (relock !== false && CBZ.requestLock && g.state === "playing" && !CBZ.touchMode && !(CBZ.fullMap && CBZ.fullMap.active)) {
      try { CBZ.requestLock(); } catch (e) {}
    }
    return true;
  }
  function toggle(app) { return ST.open ? close() : open(app); }
  CBZ.phoneOpen = open;
  CBZ.phoneClose = function () { return close(); };
  CBZ.phoneToggle = function () { return toggle(); };
  CBZ.phoneIsOpen = function () { return ST.open; };
  CBZ.cityOpenPhone = function (app) { return open(app); };
  CBZ.cityClosePhone = function () { return close(false); };     // fullmap.js: the map takes the screen
  CBZ.cityPhoneChip = function () {
    const Ap = A();
    // the LED is for people: a missed call, a text, a call ringing now. News
    // and the feed only badge their own tiles on the home screen.
    let u = false;
    try { u = !!Ap && (Ap.unread().calls > 0 || !!Ap.ringing()); } catch (e) { u = false; }
    return { on: true, available: playing() && !campaignLive(), open: ST.open, unread: u, buzz: Date.now() < ST.buzzUntil };
  };

  // ---------------------------------------------------------------- drawing
  const C = {
    bg0: "#0d1117", bg1: "#1a2130", text: "#eef2f7", dim: "#8d97a8", line: "rgba(255,255,255,.07)",
    red: "#ff4f4a", green: "#33c46b", blue: "#3d8bff", amber: "#ffb43d", card: "rgba(255,255,255,.05)",
  };
  const HEAD_Y = 118, BAR_Y = 966;              // content runs between the header and the home bar
  function font(px, w) { ctx.font = (w || "600") + " " + px + "px -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"; }
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function lines(text, maxW, max) {
    const words = String(text || "").split(/\s+/), out = [];
    let cur = "";
    for (let i = 0; i < words.length; i++) {
      const t = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && cur) {
        out.push(cur); cur = words[i];
        if (out.length === max) { cur = ""; out[max - 1] = out[max - 1].replace(/\s*\S*$/, "") + "..."; break; }
      } else cur = t;
    }
    if (cur && out.length < max) out.push(cur);
    return out;
  }
  function hit(x, y, w, h, fn, clip) {
    if (clip && (y + h < HEAD_Y || y > BAR_Y)) return;
    ST.hits.push({ x: x, y: y, w: w, h: h, fn: fn, clip: !!clip });
  }
  function clockText() {
    let h = 12;
    try { h = CBZ.citySunHour ? +CBZ.citySunHour() : 12; } catch (e) { h = 12; }
    if (!isFinite(h)) h = 12;
    const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60);
    return hh + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function statusBar() {
    font(26, "700"); ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(clockText(), 40, 38);
    // signal + battery, drawn, no glyph fonts
    for (let i = 0; i < 4; i++) { ctx.fillRect(400 + i * 9, 46 - (i + 1) * 5, 6, (i + 1) * 5); }
    ctx.strokeStyle = C.text; ctx.lineWidth = 2; rr(444, 28, 38, 20, 5); ctx.stroke();
    ctx.fillRect(448, 32, 26, 12); ctx.fillRect(484, 34, 3, 8);
  }
  function header(title) {
    font(36, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(title, CW / 2, 86);
    // back chevron
    ctx.strokeStyle = C.blue; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(50, 72); ctx.lineTo(34, 86); ctx.lineTo(50, 100); ctx.stroke();
    hit(0, 56, 120, 64, function () { goHome(); });
  }
  function homeBar() {
    ctx.fillStyle = "rgba(255,255,255,.75)";
    rr(CW / 2 - 80, 990, 160, 9, 5); ctx.fill();
    hit(CW / 2 - 150, 970, 300, 54, function () { if (ST.app === "home") close(); else goHome(); });
  }
  function goHome() { ST.app = "home"; ST.dirty = true; }
  function setApp(a) {
    ST.app = a; ST.scroll[a] = 0; ST.dirty = true;
    const Ap = A(); if (Ap && Ap.markRead) Ap.markRead(a);
  }
  function badge(x, y, n) {
    if (!(n > 0)) return;
    const s = n > 99 ? "99" : String(n);
    font(22, "800");
    const w = Math.max(34, ctx.measureText(s).width + 16);
    ctx.fillStyle = C.red; rr(x - w / 2, y - 17, w, 34, 17); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s, x, y + 1);
  }
  function avatar(x, y, r, name, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    font(Math.round(r * 0.95), "800"); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(name || "?").replace(/^(General|President|King|Queen|Prime Minister|Chancellor|Emir|Sultan)\s+/i, "").charAt(0).toUpperCase(), x, y + 2);
  }

  // ---- the app icons: drawn shapes, one per app
  function iconNews(x, y, s) {
    ctx.fillStyle = "#e9edf2"; rr(x + s * 0.2, y + s * 0.22, s * 0.6, s * 0.56, s * 0.06); ctx.fill();
    ctx.fillStyle = C.red; ctx.fillRect(x + s * 0.27, y + s * 0.3, s * 0.46, s * 0.1);
    ctx.fillStyle = "#9aa3b2";
    for (let i = 0; i < 4; i++) ctx.fillRect(x + s * 0.27, y + s * (0.47 + i * 0.07), s * (i === 3 ? 0.3 : 0.46), s * 0.035);
  }
  function iconCalls(x, y, s) {
    ctx.save(); ctx.translate(x + s / 2, y + s / 2); ctx.rotate(-0.75);
    ctx.fillStyle = "#fff";
    rr(-s * 0.28, -s * 0.07, s * 0.56, s * 0.14, s * 0.05); ctx.fill();
    rr(-s * 0.3, -s * 0.06, s * 0.13, s * 0.2, s * 0.05); ctx.fill();
    rr(s * 0.17, -s * 0.06, s * 0.13, s * 0.2, s * 0.05); ctx.fill();
    ctx.restore();
  }
  function iconHoller(x, y, s) {
    ctx.fillStyle = "#fff";
    rr(x + s * 0.18, y + s * 0.24, s * 0.64, s * 0.42, s * 0.12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.32, y + s * 0.62); ctx.lineTo(x + s * 0.28, y + s * 0.8); ctx.lineTo(x + s * 0.47, y + s * 0.64); ctx.fill();
    ctx.fillStyle = C.blue;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + s * (0.36 + i * 0.14), y + s * 0.45, s * 0.04, 0, Math.PI * 2); ctx.fill(); }
  }
  function iconMap(x, y, s) {
    ctx.fillStyle = "#f3e7c9";
    ctx.beginPath(); ctx.moveTo(x + s * 0.18, y + s * 0.26); ctx.lineTo(x + s * 0.4, y + s * 0.2); ctx.lineTo(x + s * 0.6, y + s * 0.26);
    ctx.lineTo(x + s * 0.82, y + s * 0.2); ctx.lineTo(x + s * 0.82, y + s * 0.74); ctx.lineTo(x + s * 0.6, y + s * 0.8);
    ctx.lineTo(x + s * 0.4, y + s * 0.74); ctx.lineTo(x + s * 0.18, y + s * 0.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(x + s * 0.55, y + s * 0.44, s * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + s * 0.47, y + s * 0.47); ctx.lineTo(x + s * 0.55, y + s * 0.62); ctx.lineTo(x + s * 0.63, y + s * 0.47); ctx.fill();
  }
  function drawHome() {
    const Ap = A();
    const un = Ap ? Ap.unread() : { news: 0, calls: 0, social: 0 };
    font(110, "300"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(clockText(), CW / 2, 210);
    let d = 0; try { d = CBZ.worldDay ? CBZ.worldDay() | 0 : 0; } catch (e) {}
    font(28, "500"); ctx.fillStyle = C.dim; ctx.fillText("Day " + (d + 1), CW / 2, 290);
    const tiles = [
      { id: "news", label: "News", col: "#b3261e", icon: iconNews, n: un.news },
      { id: "calls", label: "Calls", col: C.green, icon: iconCalls, n: un.calls },
      { id: "social", label: "Holler", col: C.blue, icon: iconHoller, n: un.social },
      { id: "map", label: "Map", col: "#2f6b4f", icon: iconMap, n: 0 },
    ];
    const S = 168, GAP = 56, x0 = (CW - S * 2 - GAP) / 2, y0 = 420;
    tiles.forEach(function (t, i) {
      const x = x0 + (i % 2) * (S + GAP), y = y0 + Math.floor(i / 2) * (S + 96);
      ctx.fillStyle = t.col; rr(x, y, S, S, 40); ctx.fill();
      t.icon(x, y, S);
      font(28, "600"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(t.label, x + S / 2, y + S + 12);
      badge(x + S - 8, y + 8, t.n);
      hit(x - 10, y - 10, S + 20, S + 60, function () {
        if (t.id === "map") { if (CBZ.fullMap && CBZ.fullMap.open) { close(false); try { CBZ.fullMap.open(); } catch (e) {} } return; }
        setApp(t.id);
      });
    });
  }

  // a scrolled list: rows draw themselves at y and return their height
  function list(app, rows) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, HEAD_Y, CW, BAR_Y - HEAD_Y); ctx.clip();
    let y = HEAD_Y + 10 - ST.scroll[app];
    for (let i = 0; i < rows.length; i++) y += rows[i](y);
    ctx.restore();
    const content = y + ST.scroll[app] - HEAD_Y;
    ST.maxScroll[app] = Math.max(0, content - (BAR_Y - HEAD_Y) + 20);
    if (ST.scroll[app] > ST.maxScroll[app]) ST.scroll[app] = ST.maxScroll[app];
  }
  function sectionTitle(t) {
    return function (y) { font(22, "700"); ctx.fillStyle = C.dim; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(t.toUpperCase(), 32, y + 14); return 52; };
  }
  function emptyRow(t) {
    return function (y) { font(28, "500"); ctx.fillStyle = C.dim; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(t, CW / 2, y + 120); return 200; };
  }

  function drawNews() {
    header("News");
    const Ap = A(), items = Ap ? Ap.news() : [];
    const rows = items.length ? items.map(function (s) {
      return function (y) {
        let h = 18;
        if (s.cat || s.breaking) {
          font(20, "800"); ctx.fillStyle = s.breaking ? C.red : C.amber; ctx.textAlign = "left"; ctx.textBaseline = "top";
          ctx.fillText((s.breaking ? "BREAKING  " : "") + (s.cat || ""), 32, y + h); h += 32;
        }
        font(32, "700"); ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "top";
        const L = lines(s.h, CW - 64, 3);
        L.forEach(function (l) { ctx.fillText(l, 32, y + h); h += 40; });
        if (s.sub) {
          font(25, "500"); ctx.fillStyle = C.dim;
          const L2 = lines(s.sub, CW - 64, 2);
          L2.forEach(function (l) { ctx.fillText(l, 32, y + h + 2); h += 32; });
        }
        h += 18;
        ctx.fillStyle = C.line; ctx.fillRect(32, y + h - 1, CW - 64, 2);
        return h;
      };
    }) : [emptyRow("Nothing yet.")];
    list("news", rows);
  }

  function kindColor(k) { return k === "leader" ? "#7a5cff" : k === "gang" ? "#c0392b" : k === "staff" ? "#2d6cdf" : k === "crew" ? "#d68910" : k === "service" ? "#16a085" : k === "press" ? "#b3261e" : k === "you" ? "#2f9e5b" : "#5d6d7e"; }
  /* CALLS opens on the log: who called, who you called, who you missed
     (red, with the line he left), newest first, then everybody you can ring.
     Every row is a number: tap it and it rings. */
  function arrow(x, y, dir) {
    // in: an arrow coming down-left into the corner; out: leaving up-right
    ctx.save(); ctx.translate(x, y); if (dir === "out") ctx.rotate(Math.PI);
    ctx.strokeStyle = dir === "missed" ? C.red : C.dim; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(-7, 7); ctx.moveTo(-7, -2); ctx.lineTo(-7, 7); ctx.lineTo(2, 7); ctx.stroke();
    ctx.restore();
  }
  function drawCalls() {
    header("Calls");
    const Ap = A();
    const log = Ap && Ap.log ? Ap.log().slice(0, 12) : [];
    const cs = Ap ? Ap.contacts() : [];
    const nMiss = Ap && Ap.missedCount ? Ap.missedCount() : 0;
    const rows = [];
    if (log.length) {
      rows.push(function (y) {
        font(22, "700"); ctx.fillStyle = C.dim; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText("RECENT", 32, y + 14);
        if (nMiss > 0) { ctx.fillStyle = C.red; ctx.textAlign = "right"; ctx.fillText(nMiss + " MISSED", CW - 32, y + 14); }
        return 52;
      });
      log.forEach(function (e) {
        rows.push(function (y) {
          const text = e.dir === "missed" || e.dir === "text" ? e.text : "";
          font(23, "500");
          const L = text ? lines(text, CW - 150, 2) : [];
          const h = Math.max(86, 60 + L.length * 30 + (L.length ? 6 : 0));
          if (e.dir === "text") {
            ctx.fillStyle = C.blue; rr(26, y + 22, 26, 20, 6); ctx.fill();
          } else arrow(40, y + 34, e.dir);
          font(28, "700"); ctx.fillStyle = e.missed ? C.red : C.text; ctx.textAlign = "left"; ctx.textBaseline = "top";
          ctx.fillText(lines(e.name, CW - 210, 1)[0] || "", 70, y + 16);
          font(22, "500"); ctx.fillStyle = C.dim; ctx.textAlign = "right";
          ctx.fillText(e.when || "", CW - 32, y + 20);
          ctx.textAlign = "left";
          if (L.length) { font(23, "500"); ctx.fillStyle = e.missed ? "#ffd2cf" : C.dim; L.forEach(function (l, i) { ctx.fillText(l, 70, y + 54 + i * 30); }); }
          else if (e.role) { font(22, "500"); ctx.fillStyle = C.dim; ctx.fillText(lines(e.role, CW - 150, 1)[0] || "", 70, y + 52); }
          ctx.fillStyle = C.line; ctx.fillRect(70, y + h - 1, CW - 102, 2);
          if (e.callable) hit(0, y, CW, h, function () { const r = Ap.callBack(e.n); if (r) ST.dirty = true; }, true);
          return h;
        });
      });
    }
    rows.push(sectionTitle("Contacts"));
    if (!cs.length) rows.push(emptyRow("No one yet."));
    cs.forEach(function (c) {
      rows.push(function (y) {
        const h = 96;
        avatar(66, y + h / 2, 30, c.name, kindColor(c.kind));
        font(29, "700"); ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(lines(c.name, CW - 170, 1)[0] || "", 112, y + 18);
        if (c.role) { font(23, "500"); ctx.fillStyle = C.dim; ctx.fillText(lines(c.role, CW - 170, 1)[0] || "", 112, y + 54); }
        if (c.pending || (Ap.pending && Ap.pending(c.id))) { ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(CW - 44, y + h / 2, 9, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = C.line; ctx.fillRect(112, y + h - 1, CW - 144, 2);
        hit(0, y, CW, h, function () { const r = Ap.call(c.id); if (r) ST.dirty = true; }, true);
        return h;
      });
    });
    list("calls", rows);
  }

  function ago(s) {
    s = Math.max(0, +s || 0);
    return s < 60 ? "now" : s < 3600 ? Math.floor(s / 60) + "m" : Math.floor(s / 3600) + "h";
  }
  function drawSocial() {
    header("Holler");
    const Ap = A();
    const opts = Ap ? Ap.postOptions() : [];
    const posts = Ap ? Ap.feed() : [];
    const rows = [];
    opts.forEach(function (o) {
      rows.push(function (y) {
        const h = 84;
        ctx.fillStyle = "rgba(61,139,255,.16)"; rr(28, y + 8, CW - 56, h - 16, 18); ctx.fill();
        ctx.strokeStyle = "rgba(61,139,255,.55)"; ctx.lineWidth = 2; rr(28, y + 8, CW - 56, h - 16, 18); ctx.stroke();
        font(27, "700"); ctx.fillStyle = "#cfe1ff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(lines(o.label, CW - 110, 1)[0] || "", 52, y + h / 2);
        hit(28, y + 8, CW - 56, h - 16, function () {
          const r = Ap.post(o.id);
          if (r && !r.ok) { ST.toast = r.why; ST.toastUntil = (ST.clock || 0) + 3.5; }
          ST.scroll.social = 0; ST.dirty = true;
        }, true);
        return h;
      });
    });
    if (ST.toast && (ST.clock || 0) < ST.toastUntil) {
      const t = ST.toast;
      rows.push(function (y) { font(23, "600"); ctx.fillStyle = C.red; ctx.textAlign = "left"; ctx.textBaseline = "top"; const L = lines(t, CW - 64, 2); L.forEach(function (l, i) { ctx.fillText(l, 32, y + 6 + i * 30); }); return 16 + L.length * 30; });
    }
    if (opts.length) rows.push(function (y) { ctx.fillStyle = C.line; ctx.fillRect(0, y + 10, CW, 4); return 22; });
    if (!posts.length) rows.push(emptyRow("Quiet out there."));
    posts.forEach(function (p) {
      rows.push(function (y) {
        const x0 = p.reply ? 60 : 0;
        avatar(x0 + 62, y + 52, 28, p.name, kindColor(p.kind));
        const tx = x0 + 104, tw = CW - 32 - tx;
        font(25, "800"); ctx.fillStyle = C.text; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(lines(p.name, tw, 1)[0] || "", tx, y + 20);
        font(21, "500"); ctx.fillStyle = C.dim;
        ctx.fillText(lines(p.handle + "  " + ago(p.age), tw, 1)[0] || "", tx, y + 52);
        font(27, "500"); ctx.fillStyle = "#dfe5ee";
        const L = lines(p.text, tw, 5);
        const ty = y + 86;
        L.forEach(function (l, i) { ctx.fillText(l, tx, ty + i * 35); });
        const h = (ty - y) + L.length * 35 + 22;
        ctx.fillStyle = C.line; ctx.fillRect(tx, y + h - 1, tw, 2);
        return h;
      });
    });
    list("social", rows);
  }

  /* ON A CALL, laid out like a real phone: who (name, title) and the timer
     at the top, his answers as the phone's own buttons in the middle, and
     the red hang-up ALONE at the bottom. The answers used to stack down from
     y 640 in 100 px rows, so a General with four of them ran straight over
     the hang-up (and the hang-up's hit box, pushed last, won the tap). Now
     the answer band is a fixed window that ends well above the hang-up and
     the rows shrink to fit it. */
  const CALL = { top: 400, bottom: 800, hang: 900, hangR: 46 };
  function drawCall(c) {
    const Ap = A();
    avatar(CW / 2, 196, 70, c.name, c.incoming ? C.green : "#2d6cdf");
    font(38, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(lines(c.name, CW - 60, 1)[0] || "", CW / 2, 284);
    font(25, "500"); ctx.fillStyle = C.dim;
    if (c.role) ctx.fillText(lines(c.role, CW - 60, 1)[0] || "", CW / 2, 330);
    const s = Math.floor(c.since || 0);
    ctx.fillText(c.state === "done" ? "Call ended" : (Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60)), CW / 2, 364);
    const ch = c.choices || [];
    if (ch.length) {
      const GAP = 16, band = CALL.bottom - CALL.top;
      const bh = Math.min(80, Math.floor((band - GAP * (ch.length - 1)) / ch.length));
      let y = CALL.top + Math.max(0, Math.floor((band - (bh * ch.length + GAP * (ch.length - 1))) / 2));
      ch.forEach(function (o) {
        ctx.fillStyle = "rgba(255,255,255,.13)"; rr(48, y, CW - 96, bh, bh / 2); ctx.fill();
        font(bh < 64 ? 26 : 30, "700"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(lines(o.label, CW - 140, 1)[0] || "", CW / 2, y + bh / 2 + 1);
        const yy = y;
        hit(48, yy, CW - 96, bh, function () { Ap.choose(o.id); ST.dirty = true; });
        y += bh + GAP;
      });
    }
    // hang up, alone at the bottom
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(CW / 2, CALL.hang, CALL.hangR, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(CW / 2, CALL.hang); ctx.rotate(Math.PI * 0.75);
    ctx.fillStyle = "#fff"; rr(-26, -6, 52, 12, 5); ctx.fill(); rr(-28, -6, 12, 18, 5); ctx.fill(); rr(16, -6, 12, 18, 5); ctx.fill();
    ctx.restore();
    hit(CW / 2 - 70, CALL.hang - 62, 140, 124, function () { Ap.hangup(); ST.dirty = true; });
  }
  function drawIncoming(r) {
    const Ap = A();
    const pulse = 0.5 + 0.5 * Math.sin((ST.clock || 0) * 6);
    ctx.fillStyle = "rgba(51,196,107," + (0.15 + 0.2 * pulse).toFixed(3) + ")";
    ctx.beginPath(); ctx.arc(CW / 2, 300, 120 + 10 * pulse, 0, Math.PI * 2); ctx.fill();
    avatar(CW / 2, 300, 96, r.name, C.green);
    font(40, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "top";
    lines(r.name, CW - 60, 2).forEach(function (l, i) { ctx.fillText(l, CW / 2, 430 + i * 46); });
    font(26, "500"); ctx.fillStyle = C.dim;
    if (r.role) ctx.fillText(lines(r.role, CW - 60, 1)[0] || "", CW / 2, 530);
    // decline (left), answer (right)
    const btn = function (x, col, ang, fn) {
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, 860, 52, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(x, 860); ctx.rotate(ang);
      ctx.fillStyle = "#fff"; rr(-28, -6, 56, 12, 5); ctx.fill(); rr(-30, -6, 13, 19, 5); ctx.fill(); rr(17, -6, 13, 19, 5); ctx.fill();
      ctx.restore();
      hit(x - 70, 790, 140, 140, fn);
    };
    btn(140, C.red, Math.PI * 0.75, function () { Ap.decline(); ST.dirty = true; });
    btn(CW - 140, C.green, -0.6, function () { Ap.answer(); ST.dirty = true; });
  }

  function paint() {
    if (!ensureCanvas()) return;
    ST.hits.length = 0;
    const gr = ctx.createLinearGradient(0, 0, 0, CH);
    gr.addColorStop(0, C.bg1); gr.addColorStop(1, C.bg0);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, CW, CH);
    statusBar();
    const Ap = A();
    const conv = Ap ? Ap.conv() : null;
    const ring = Ap ? Ap.ringing() : null;
    if (conv) drawCall(conv);
    else if (ring) drawIncoming(ring);
    else if (ST.app === "news") drawNews();
    else if (ST.app === "calls") drawCalls();
    else if (ST.app === "social") drawSocial();
    else drawHome();
    homeBar();
    tex.needsUpdate = true;
    ST.dirty = false; ST.paintT = 0;
  }

  // ---------------------------------------------------------------- where the handset sits
  // Camera space, one layout for both views: a phone held up at reading
  // distance, right of centre on a wide screen, centred on a tall one.
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
  // the bar along the bottom (systems/inventory.js #hotbar): the handset stands
  // ABOVE it, never over it. Its top as a fraction of the view, re-read twice
  // a second (it grows and shrinks with what you carry).
  let barTop = 1, barReadT = 0;
  function readBar() {
    barTop = 1;
    const hb = typeof document !== "undefined" && document.getElementById ? document.getElementById("hotbar") : null;
    if (!hb || !hb.getBoundingClientRect || hb.style.display === "none") return;
    const r = hb.getBoundingClientRect(), cr = canvasRect();
    if (r.height > 0 && cr.height > 0) barTop = Math.max(0.5, Math.min(1, (r.top - cr.top) / cr.height));
  }
  function layout() {
    const cam = CBZ.camera;
    const fov = (cam && cam.fov) || 62, aspect = (cam && cam.aspect) || 1.6;
    const d = 0.5;
    const halfH = d * Math.tan(fov * Math.PI / 360), halfW = halfH * aspect;
    // vertical window, as fractions of the view from the top: a margin under
    // the top edge, and the bottom a little clear of the hotbar
    const topMin = 0.04, botMax = Math.min(0.97, barTop - 0.015);
    let hf = Math.min(0.80, botMax - topMin);
    let H = 2 * halfH * hf;
    const Wd = H * BODY.w / BODY.h;
    if (Wd > 2 * halfW * 0.86) { H = 2 * halfW * 0.86 * BODY.h / BODY.w; hf = H / (2 * halfH); }
    const w = H * BODY.w / BODY.h;
    const x = aspect > 1.15 ? Math.min(halfW * 0.42, halfW - w * 0.62) : 0;
    const cf = Math.min(0.515, botMax - hf / 2);          // centre, fraction from the top
    return { x: x, y: halfH * (1 - 2 * cf), z: -d, s: H / BODY.h, w: w, h: H, halfW: halfW, halfH: halfH };
  }
  /* WHERE THE HANDSET IS ON SCREEN, in client pixels (the whole body, not just
     the glass). speech.js puts the voice on the line beside it, and the frame
     below keeps every HUD control off it. */
  let RECT = null;
  function screenRect() {
    if (!ST.open || !VIEW || !VIEW.visible) return null;
    const L = layout(), cr = canvasRect();
    const fx = function (x) { return cr.left + (0.5 + x / (2 * L.halfW)) * cr.width; };
    const fy = function (y) { return cr.top + (0.5 - y / (2 * L.halfH)) * cr.height; };
    return { left: fx(L.x - L.w / 2), right: fx(L.x + L.w / 2), top: fy(L.y + L.h / 2), bottom: fy(L.y - L.h / 2) };
  }
  CBZ.phoneScreenRect = function () { return ST.open ? RECT : null; };

  /* NOTHING FROM THE WORLD'S HUD ON THE GLASS (owner, iPad: "when you're on
     the phone, the buttons to interact overlap with the hang-up button").
     The handset sits right of centre at 80% of the view's height, and the
     touch cluster (FIRE, JUMP, the verb dock left of it), the verb chips and
     the wheel all live in that same lower right. They stayed up while the
     phone was out, drew over the call screen, and, being DOM above the
     canvas, took the finger before the glass ever saw it. So while the phone
     is up, any of them whose box crosses the handset's box is hidden and
     untouchable (body.city-phone-up + .phone-covered), and given back the
     moment it is put away. Taps then reach the glass first (this file's
     capture listeners), and only off the glass the world. */
  const HUD_SEL = "#tbtns > *, #tveh > *, #tstick, #interact, #verbWheel, #hotbar, .tpill, #cRadar, #minimap";
  let covered = [], coverT = 0, styled = false;
  function coverStyle() {
    if (styled || !document.head || !document.createElement) return;
    styled = true;
    const st = document.createElement("style");
    st.textContent = ".phone-covered{visibility:hidden!important;pointer-events:none!important}";
    try { document.head.appendChild(st); } catch (e) {}
  }
  function uncoverAll() {
    for (let i = 0; i < covered.length; i++) { try { covered[i].classList.remove("phone-covered"); } catch (e) {} }
    covered = [];
  }
  function coverHud(r) {
    if (!r || !document.querySelectorAll) return;
    coverStyle();
    let els = [];
    try { els = document.querySelectorAll(HUD_SEL); } catch (e) { els = []; }
    const now = [];
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const b = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!b || !(b.width > 0 && b.height > 0)) continue;
      // (visibility never moves a box, so a covered one measures true)
      if (b.right > r.left - 4 && b.left < r.right + 4 && b.bottom > r.top - 4 && b.top < r.bottom + 4) {
        el.classList.add("phone-covered"); now.push(el);
      }
    }
    for (let i = 0; i < covered.length; i++) if (now.indexOf(covered[i]) < 0) { try { covered[i].classList.remove("phone-covered"); } catch (e) {} }
    covered = now;
  }
  function placeView() {
    const v = view();
    const L = layout();
    v.position.set(L.x, L.y, L.z);
    v.rotation.set(-0.05, L.x > 0 ? -0.07 : 0, 0);
    v.scale.setScalar(L.s);
    // first person: the hand is in the same late pass and occludes the glass
    // where it should; third person: drawn over the world, nothing in front
    const fp = fpActive() && ST.fpFrame >= ST.frame - 2;
    v.traverse(function (o) { if (o.material && o.material.depthTest !== fp) { o.material.depthTest = fp; o.material.needsUpdate = true; } });
    v.visible = true;
    return L;
  }

  /* helditems.js calls this from fpsmode's viewmodel pass while the phone is
     the held thing: pose the right wrist under the handset (vm space). */
  /* THE HAND THAT HOLDS IT (first person). It used to be the fist path's
     default: fingers continuing the forearm, rolled 1.15 rad about it, so the
     hand pointed diagonally up and across the glass with its palm to the side
     and the wrist in front of the screen. A phone is cradled: the palm under
     its back, the fingers up behind it, the thumb on the right edge. So the
     wrist sits a little BEHIND the glass below its bottom right corner, and
     the hand's frame is set outright (T.handQ, vm space): palm toward you
     (against the handset's back), fingers up and a little in and away. The
     elbow stays down and out (fpsmode's pole), the forearm rising into it. */
  const _hq = new THREE.Quaternion(), _hx = new THREE.Vector3(), _hy = new THREE.Vector3(), _hz = new THREE.Vector3(), _hm = new THREE.Matrix4();
  CBZ.phoneFpHold = function (vm, T) {
    if (!ST.open || !vm || !T) return false;
    ST.fpFrame = ST.frame;
    const L = layout();
    _v.set(L.x + L.w * 0.30, L.y - L.h * 0.5 - 0.06, L.z - 0.02);
    vm.updateMatrix();
    _m.copy(vm.matrix).invert();
    _v.applyMatrix4(_m);
    T.vis = true; T.hook = 0; T.curl = "hold034";
    T.x = _v.x; T.y = _v.y; T.z = _v.z; T.roll = 0.6; T.bend = 0.2;
    // the hand frame in camera space (right hand: +Y_h the back of the hand,
    // -Z_h the fingers): palm to the camera, fingers up / in / away
    _hy.set(0.30, 0, -1).normalize();                     // back of the hand faces away
    _hz.set(0.18, -1, 0.35).normalize();                  // fingers (-Z) up, a touch left, away
    _hz.addScaledVector(_hy, -_hz.dot(_hy)).normalize();
    _hx.crossVectors(_hy, _hz);
    _hm.makeBasis(_hx, _hy, _hz);
    _hq.setFromRotationMatrix(_hm);
    // camera -> vm space
    if (!T.handQ) T.handQ = new THREE.Quaternion();
    T.handQ.copy(vm.quaternion).invert().multiply(_hq);
    T.handW = 1;
    return true;
  };

  // ---------------------------------------------------------------- input: the glass
  const ray = new THREE.Raycaster();
  const _ndc = new THREE.Vector2();
  function canvasRect() {
    const el = (CBZ.renderer && CBZ.renderer.domElement) || CBZ.canvas;
    return el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  // -> {u, v, px, py} on the glass, {body:true} on the handset, or null
  function pick(cx, cy) {
    if (!VIEW || !VIEW.visible || !CBZ.camera) return null;
    const r = canvasRect();
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    VIEW.updateMatrixWorld(true);
    ray.setFromCamera(_ndc, CBZ.camera);
    const gl = ray.intersectObject(VIEW.userData.glass, false);
    if (gl.length && gl[0].uv) return { u: gl[0].uv.x, v: gl[0].uv.y, px: gl[0].uv.x * CW, py: (1 - gl[0].uv.y) * CH };
    const bd = ray.intersectObject(VIEW.userData.body, false);
    return bd.length ? { body: true } : null;
  }
  function tapAt(px, py) {
    ST.taps++;
    for (let i = ST.hits.length - 1; i >= 0; i--) {
      const h = ST.hits[i];
      if (h.clip && (py < HEAD_Y || py > BAR_Y)) continue;
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
        try { h.fn(); } catch (e) {}
        if (CBZ.sfx) { try { CBZ.sfx("switch", { volume: 0.12, pitch: 2 }); } catch (e) {} }
        paint();
        return true;
      }
    }
    return false;
  }
  function scrollBy(dy) {
    const a = ST.app;
    if (!(a in ST.scroll)) return;
    ST.scroll[a] = Math.max(0, Math.min(ST.maxScroll[a] || 0, ST.scroll[a] + dy));
    ST.dirty = true;
  }
  let swallowClickUntil = 0;
  function down(cx, cy, id) {
    const p = pick(cx, cy);
    if (!p) return false;
    ST.drag = { id: id, x: cx, y: cy, py: p.px != null ? p.py : null, moved: 0, last: p.py };
    return true;
  }
  function move(cx, cy, id) {
    const D = ST.drag;
    if (!D || D.id !== id) return false;
    D.moved = Math.max(D.moved, Math.hypot(cx - D.x, cy - D.y));
    const p = pick(cx, cy);
    if (p && p.py != null && D.last != null) { scrollBy(D.last - p.py); D.last = p.py; }
    return true;
  }
  function up(cx, cy, id) {
    const D = ST.drag;
    if (!D || D.id !== id) return false;
    ST.drag = null;
    if (D.moved < 12 && D.py != null) {
      const p = pick(cx, cy);
      if (p && p.px != null) tapAt(p.px, p.py);
    }
    return true;
  }
  // the game's own surface (the WebGL canvas): DOM panels above it keep their clicks
  function onGame(e) {
    const el = (CBZ.renderer && CBZ.renderer.domElement) || CBZ.canvas;
    return !e.target || e.target === el || e.target === document.body || e.target === document.documentElement;
  }
  addEventListener("mousedown", function (e) {
    if (!ST.open || !onGame(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    swallowClickUntil = performance.now() + 400;
    if (!down(e.clientX, e.clientY, "m")) close();     // a click off the phone puts it away
  }, true);
  addEventListener("mousemove", function (e) { if (ST.open && ST.drag) move(e.clientX, e.clientY, "m"); }, true);
  addEventListener("mouseup", function (e) {
    if (!ST.open && !ST.drag) return;
    if (ST.drag) { e.preventDefault(); e.stopImmediatePropagation(); up(e.clientX, e.clientY, "m"); }
  }, true);
  addEventListener("click", function (e) {
    if ((ST.open || performance.now() < swallowClickUntil) && onGame(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener("wheel", function (e) {
    if (!ST.open) return;
    if (pick(e.clientX, e.clientY)) { e.preventDefault(); e.stopImmediatePropagation(); scrollBy(e.deltaY * 1.4); }
  }, { capture: true, passive: false });
  // touch: a finger on the glass is the phone's; anywhere else still walks and looks
  addEventListener("touchstart", function (e) {
    if (!ST.open || !onGame(e)) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (down(t.clientX, t.clientY, "t" + t.identifier)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }, { capture: true, passive: false });
  addEventListener("touchmove", function (e) {
    if (!ST.open || !ST.drag) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (move(t.clientX, t.clientY, "t" + t.identifier)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }
  }, { capture: true, passive: false });
  const touchEnd = function (e) {
    if (!ST.drag) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (up(t.clientX, t.clientY, "t" + t.identifier)) { e.preventDefault(); e.stopImmediatePropagation(); swallowClickUntil = performance.now() + 400; }
    }
  };
  addEventListener("touchend", touchEnd, { capture: true, passive: false });
  addEventListener("touchcancel", function () { ST.drag = null; }, { capture: true });

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (campaignLive()) return;                       // the story's own handset owns P
    const k = (e.key || "").toLowerCase();
    if (ST.open) {
      if (k === "p" || k === "escape" || k === "backspace") {
        e.preventDefault(); e.stopImmediatePropagation();
        const Ap = A();
        if (k === "p") close();
        else if (Ap && Ap.conv() && Ap.conv().state === "talk") { Ap.hangup(); paint(); }
        else if (ST.app !== "home") { goHome(); paint(); }
        else close();
      }
      return;
    }
    if (k === "p" && !e.repeat && !CBZ.cityMenuOpen) { e.preventDefault(); open(); }
  }, true);

  // ---------------------------------------------------------------- ringing
  function ringTone() {
    const actx = CBZ.getAudioCtx ? CBZ.getAudioCtx() : null;
    if (!actx || actx.state !== "running") return;
    try {
      const t = actx.currentTime + 0.02;
      const notes = [988, 1319, 988, 1319];
      notes.forEach(function (f, i) {
        const o = actx.createOscillator(), gn = actx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(f, t + i * 0.16);
        gn.gain.setValueAtTime(0.0001, t + i * 0.16);
        gn.gain.exponentialRampToValueAtTime(0.05, t + i * 0.16 + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.15);
        o.connect(gn); gn.connect(actx.destination);
        o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.17);
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------- the frame
  let wasRinging = false;
  function tick(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    ST.frame++;
    ST.clock = (ST.clock || 0) + dt;
    if (g.mode !== "city") {
      if (ST.open) close(false);
      if (VIEW) VIEW.visible = false;
      return;
    }
    const Ap = A();
    const ring = Ap ? Ap.ringing() : null;
    if (ring) {
      ST.ringT -= dt;
      if (ST.ringT <= 0) { ST.ringT = 3; ringTone(); ST.buzzUntil = Date.now() + 900; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
      if (ST.open && !wasRinging) ST.dirty = true;
    } else ST.ringT = 0;
    if (!!ring !== wasRinging) { wasRinging = !!ring; ST.dirty = true; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    if (!ST.open) { if (VIEW) VIEW.visible = false; return; }
    const P = CBZ.player;
    if (!P || P.dead || g.busted) { close(false); return; }
    // a gun came up, cuffs went on: it went back in the pocket
    const H = CBZ.heldItem;
    if (H && H.current && !P.driving) {
      if (H.current() === "phone") ST.inHand = true;
      else if (ST.inHand) { close(false); return; }
      else {                                         // opened behind the wheel, now on foot
        let ok = false;
        try { ok = !!H.select("phone"); } catch (e) { ok = false; }
        if (!ok) { close(false); return; }
        ST.inHand = true;
      }
    }
    barReadT -= dt;
    if (barReadT <= 0) { barReadT = 0.5; readBar(); }
    placeView();
    RECT = screenRect();
    coverT -= dt;
    if (coverT <= 0) { coverT = 0.2; coverHud(RECT); }
    // a call's timer and the ringing pulse move; everything else is a clock
    ST.paintT += dt;
    const live = !!(ring || (Ap && Ap.conv()));
    if (ST.dirty || ST.paintT > (live ? 0.25 : 1.0)) paint();
  }
  if (CBZ.onAlways) CBZ.onAlways(52.2, tick);

  CBZ.phoneAudit = function () {
    return {
      open: ST.open, app: ST.app, hits: ST.hits.length, opens: ST.opens, taps: ST.taps,
      view: !!(VIEW && VIEW.visible), rect: RECT, covered: covered.length, fp: ST.fpFrame >= ST.frame - 2, canvas: cv ? CW + "x" + CH : null,
      chip: CBZ.cityPhoneChip(), apps: A() ? A().audit() : null,
    };
  };
  // tests: tap a canvas pixel directly, read the hit list
  CBZ._phoneTap = function (px, py) { if (ST.open) { paint(); return tapAt(px, py); } return false; };
  CBZ._phoneHits = function () { return ST.hits.map(function (h) { return { x: h.x, y: h.y, w: h.w, h: h.h }; }); };
})();
