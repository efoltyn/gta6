/* ============================================================
   city/dossier.js — THE FOLDER. A real one, in your hands.

   The case file used to be a full-screen HTML sheet over a dimmed game, a
   slam-in "CONFIRMED" card with a rating on every kill, and a full-screen
   ending card. The owner: "Stop breaking the fourth wall." So:

     open(file)   draws the file onto a manila folder (city/hitman_paper.js,
                  the same aged paper, typewriter, stamps, redaction bars and
                  handwritten notes the sheet had) and you HOLD it up
                  (city/hitman_hands.js). You can still walk while you read.
     confirm()    gone. What happened is in the world now: the body, the
                  police, the witnesses, tomorrow's paper (hitman_fallout.js).
     ending(info) the last thing you read is a newspaper front page.
     button()     touch only: a small folder glyph to pull the file out. On a
                  keyboard, J does it. No word on it.
     letterbox()  cinema bars stay; they are film grammar, not a panel.

   API names are unchanged so city/agency.js drives it exactly as before.
============================================================ */
(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : this;
  var CBZ = W.CBZ = W.CBZ || {};

  var lastFile = null, lastKey = "", canvas = null, openFlag = false;
  var nodes = {};

  function paper() { return CBZ.hmPaper || null; }
  function hands() { return CBZ.hmHold || null; }
  function keyOf(f) { try { return JSON.stringify(f); } catch (e) { return String(Math.random()); } }

  function draw(file) {
    var Pp = paper(); if (!Pp || !file) return null;
    var k = keyOf(file);
    if (canvas && k === lastKey) return canvas;
    lastKey = k;
    canvas = Pp.folder(file, { canvas: canvas, onRedraw: function () { var Hh = hands(); if (Hh && openFlag) Hh.update(canvas); } });
    return canvas;
  }

  function build() {
    if (nodes.built || typeof document === "undefined" || !document.body) return !!nodes.built;
    var st = document.createElement("style");
    st.id = "dossierCss";
    st.textContent =
      ".dz-lb{position:fixed;left:0;right:0;height:11vh;background:#000;z-index:55;pointer-events:none;transition:transform .45s ease;will-change:transform;}" +
      ".dz-lb-top{top:0;transform:translateY(-101%);}.dz-lb-bot{bottom:0;transform:translateY(101%);}.dz-lb.dz-on{transform:translateY(0);}" +
      // the touch affordance: a manila folder, below the minimap (132 px), no words
      ".dz-btn{position:fixed;left:12px;top:calc(150px + env(safe-area-inset-top));z-index:44;width:52px;height:44px;display:none;padding:0;" +
      "border:0;background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;}" +
      ".dz-btn.dz-on{display:block;}.dz-btn svg{width:46px;height:38px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));}" +
      "@media (prefers-reduced-motion:reduce){.dz-lb{transition:none;}}";
    (document.head || document.body).appendChild(st);
    var lt = document.createElement("div"); lt.className = "dz-lb dz-lb-top";
    var lb = document.createElement("div"); lb.className = "dz-lb dz-lb-bot";
    document.body.appendChild(lt); document.body.appendChild(lb);
    nodes.lbTop = lt; nodes.lbBot = lb;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "dz-btn"; btn.setAttribute("aria-label", "Folder");
    btn.innerHTML = '<svg viewBox="0 0 46 38"><path d="M2 8h15l4 4h23v24H2z" fill="#c9a15e" stroke="#6b4f22" stroke-width="1.5"/>' +
      '<path d="M2 14h42v22H2z" fill="#d9b77a" stroke="#6b4f22" stroke-width="1.5"/><rect x="8" y="19" width="16" height="2" fill="#6b4f22" opacity=".5"/></svg>';
    var fire = function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof api.onButton === "function") { try { api.onButton(); } catch (err) {} }
      else api.toggle(lastFile);
    };
    btn.addEventListener("touchend", fire, { passive: false });
    btn.addEventListener("click", fire);
    document.body.appendChild(btn);
    nodes.btn = btn;
    nodes.built = true;
    return true;
  }

  var api = {
    open: function (file) {
      if (file) lastFile = file;
      var c = draw(lastFile); var Hh = hands();
      if (!c || !Hh) return;
      openFlag = Hh.open(c, { kind: "folder", onClose: function () { openFlag = false; } });
    },
    update: function (file) {
      if (file) lastFile = file;
      if (!openFlag) return;
      var k0 = lastKey;
      var c = draw(lastFile); var Hh = hands();
      if (c && Hh && lastKey !== k0) Hh.update(c);
    },
    close: function () { var Hh = hands(); if (openFlag && Hh) Hh.close(); openFlag = false; },
    isOpen: function () { var Hh = hands(); return !!(openFlag && Hh && Hh.isOpen() && Hh.kind() === "folder"); },
    toggle: function (file) { if (api.isOpen()) api.close(); else api.open(file || lastFile); },
    confirm: function () {},
    letterbox: function (on) {
      if (!build()) return;
      var m = on ? "add" : "remove";
      nodes.lbTop.classList[m]("dz-on"); nodes.lbBot.classList[m]("dz-on");
    },
    button: function (state) {
      if (!build()) return;
      nodes.btn.classList.toggle("dz-on", !!state && !!CBZ.touchMode);
    },
    // the last page: a newspaper front page, held. info: {title, subtitle, lines[], photo, masthead, onClose}
    ending: function (info) {
      var d = info || {}; var Pp = paper(); var Hh = hands();
      if (!Pp || !Hh) { if (typeof d.onClose === "function") d.onClose(); return; }
      var lines = Array.isArray(d.lines) ? d.lines : [];
      var paperC = Pp.newspaper({
        masthead: d.masthead, date: d.date || "", headline: d.headline || d.title || "",
        deck: d.deck || lines[0] || "", photo: d.photo || null, caption: d.caption || "",
        body: lines.slice(1), stories: d.stories, sidebar: d.sidebar,
      });
      Hh.open(paperC, { kind: "news", onClose: function () { if (typeof d.onClose === "function") { try { d.onClose(); } catch (e) {} } } });
    },
    onButton: null,
  };

  CBZ.dossier = api;
  CBZ.dossierAudit = function () {
    return { built: !!nodes.built, open: api.isOpen(), lastCodename: lastFile && lastFile.codename != null ? String(lastFile.codename) : null };
  };
})();
