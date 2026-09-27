/* dossier.js: presentation layer for the Bureau contract arc (agency.js drives it).
 * A classified paper file, a kill-confirm card, cinematic letterbox bars, an on-screen
 * FILE button and an ending card. Pure DOM + CSS, built lazily, zero per-frame work idle.
 * Text law: no em dashes, no middle dots in any authored string. */
(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : this;
  var CBZ = W.CBZ = W.CBZ || {};

  var TYPE_FONT = '"Courier Prime","Courier New",Courier,monospace';
  var STAMP_FONT = '"Arial Narrow","Helvetica Neue",Arial,sans-serif';

  // ---------- private state ----------
  var built = false;
  var nodes = {};
  var isOpenFlag = false;
  var lastFile = null;
  var menuHeldBy = { dossier: false, ending: false };
  var typeRaf = 0;
  var typeJobs = null;
  var confirmTimer = 0;
  var confirmShown = false;
  var endingShown = false;
  var endingInfo = null;
  var listenersInstalled = false;

  function reducedMotion() {
    try { return !!(W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  // ---------- DOM helpers (textContent only, never innerHTML with data) ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null && text !== "") n.textContent = String(text);
    return n;
  }
  function add(parent, child) { if (child) parent.appendChild(child); return child; }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function str(v) { return v == null ? "" : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }

  function redactBar(len, cls) {
    var n = Math.max(4, Math.min(38, (len | 0) || 12));
    var b = el("span", "dz-redact" + (cls ? " " + cls : ""));
    b.style.width = "min(100%, " + (n * 0.62).toFixed(1) + "em)";
    b.setAttribute("aria-label", "redacted");
    return b;
  }

  // ---------- CSS ----------
  var CSS = [
    ":root{--dz-paper:#efe8d6;--dz-paper2:#e6dcc4;--dz-edge:#cdbf9c;--dz-ink:#1d1b18;--dz-ink-soft:#4a453c;",
    "--dz-red:#a8201a;--dz-red-soft:rgba(168,32,26,.82);--dz-blue:#1f2a44;--dz-rule:rgba(60,90,140,.13);",
    "--dz-bar:#0d0d0d;--dz-type:" + TYPE_FONT + ";--dz-stamp:" + STAMP_FONT + ";}",

    ".dz-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:none;",
    "align-items:center;justify-content:center;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom);}",
    ".dz-backdrop.dz-on{display:flex;}",

    // the sheet: aged paper, faint ruled lines, grain from stacked gradients
    ".dz-sheet{position:relative;width:min(94vw,760px);max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;",
    "overscroll-behavior:contain;box-sizing:border-box;padding:30px 30px 26px;color:var(--dz-ink);",
    "font:14.5px/1.55 var(--dz-type);text-align:left;border-radius:2px;",
    "background-color:var(--dz-paper);",
    "background-image:",
    "radial-gradient(ellipse at 12% 8%,rgba(255,255,255,.35),transparent 55%),",
    "radial-gradient(ellipse at 90% 95%,rgba(120,90,40,.16),transparent 60%),",
    "radial-gradient(circle at 70% 30%,rgba(140,110,60,.06) 0 2px,transparent 3px),",
    "repeating-linear-gradient(0deg,transparent 0 25px,var(--dz-rule) 25px 26px),",
    "repeating-radial-gradient(circle at 30% 40%,rgba(0,0,0,.018) 0 1px,transparent 1px 3px),",
    "linear-gradient(180deg,var(--dz-paper),var(--dz-paper2));",
    "box-shadow:0 1px 0 var(--dz-edge) inset,0 0 0 1px rgba(0,0,0,.25),0 24px 60px rgba(0,0,0,.55);",
    "animation:dz-slide .32s ease-out;}",
    "@keyframes dz-slide{from{opacity:0;transform:translateY(18px) rotate(-.6deg)}to{opacity:1;transform:none}}",

    ".dz-x{position:absolute;top:6px;right:6px;width:44px;height:44px;border:0;background:transparent;",
    "color:var(--dz-ink);font:22px/44px var(--dz-stamp);cursor:pointer;z-index:3;}",
    ".dz-x:focus-visible,.dz-btn:focus-visible,.dz-endbtn:focus-visible{outline:2px solid var(--dz-red);outline-offset:2px;}",

    // header strip
    ".dz-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;",
    "border-bottom:2px solid var(--dz-ink);padding:0 44px 10px 0;margin-bottom:16px;}",
    ".dz-class{display:inline-block;font:700 12px/1 var(--dz-stamp);letter-spacing:.22em;color:var(--dz-red);",
    "border:2px solid var(--dz-red);padding:5px 8px 4px;transform:rotate(-1.5deg);margin-bottom:10px;}",
    ".dz-code{font:700 30px/1.05 var(--dz-stamp);letter-spacing:.06em;text-transform:uppercase;margin:0;",
    "font-stretch:condensed;}",
    ".dz-oplabel{font:12px/1.3 var(--dz-type);letter-spacing:.12em;color:var(--dz-ink-soft);white-space:nowrap;padding-top:4px;}",

    ".dz-cols{display:grid;grid-template-columns:minmax(180px,34%) 1fr;gap:26px;}",
    ".dz-col{min-width:0;}",
    "@media (max-width:640px){.dz-sheet{padding:24px 16px 20px;font-size:14px}.dz-cols{grid-template-columns:1fr;gap:14px}",
    ".dz-code{font-size:24px}.dz-head{flex-direction:column;gap:2px}}",

    // photo with a paper clip
    ".dz-photo{position:relative;width:150px;height:200px;margin:14px 0 10px 4px;padding:6px;background:#fbfaf6;",
    "box-shadow:0 2px 6px rgba(0,0,0,.35);transform:rotate(-2deg);box-sizing:content-box;}",
    ".dz-photo img{display:block;width:150px;height:200px;object-fit:cover;filter:grayscale(.25) contrast(1.05) sepia(.12);}",
    ".dz-nophoto{width:150px;height:200px;background:#262421;color:#b9b2a2;display:flex;align-items:center;",
    "justify-content:center;font:12px var(--dz-type);letter-spacing:.14em;text-align:center;}",
    ".dz-clip{position:absolute;top:-16px;left:26px;width:14px;height:46px;border:2px solid #8b9097;border-radius:8px;",
    "box-shadow:1px 1px 1px rgba(0,0,0,.25);z-index:2;}",
    ".dz-clip:after{content:'';position:absolute;left:2px;top:8px;width:6px;height:30px;border:2px solid #8b9097;",
    "border-bottom:0;border-radius:5px 5px 0 0;}",

    ".dz-idline{font:700 12px/1.4 var(--dz-type);letter-spacing:.12em;margin:4px 0 0;}",
    ".dz-idline.dz-no{color:var(--dz-red);}",
    ".dz-idline.dz-yes{color:var(--dz-ink);}",
    ".dz-pnote{font-size:13px;color:var(--dz-ink-soft);margin:2px 0 8px;}",

    ".dz-label{font:700 12px/1.2 var(--dz-stamp);letter-spacing:.2em;color:var(--dz-ink-soft);margin:16px 0 6px;",
    "border-bottom:1px solid rgba(0,0,0,.28);padding-bottom:3px;text-transform:uppercase;}",
    ".dz-col>.dz-label:first-child{margin-top:0;}",
    ".dz-name{font-weight:700;font-size:17px;letter-spacing:.04em;text-transform:uppercase;}",
    ".dz-role{font-size:13.5px;color:var(--dz-ink-soft);}",

    ".dz-status{display:inline-block;font:700 12px/1 var(--dz-stamp);letter-spacing:.18em;padding:5px 8px 4px;",
    "border:2px solid currentColor;margin-top:2px;}",
    ".dz-st-ACTIVE{color:#1d1b18}.dz-st-PENDING{color:#6b6250}.dz-st-CONFIRMED{color:var(--dz-red)}",
    ".dz-st-LOST{color:#6b6250}.dz-st-BURNED{color:var(--dz-red)}",

    ".dz-facts{margin:0;padding:0;}",
    ".dz-fact{display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:baseline;padding:3px 0;",
    "border-bottom:1px dotted rgba(0,0,0,.2);font-size:13.5px;}",
    ".dz-fact dt{font:700 12px var(--dz-stamp);letter-spacing:.12em;color:var(--dz-ink-soft);}",
    ".dz-fact dd{margin:0;min-width:0;overflow-wrap:anywhere;}",

    ".dz-redact{display:inline-block;height:1em;vertical-align:-2px;background:var(--dz-bar);",
    "border-radius:1px;box-shadow:0 0 0 1px rgba(0,0,0,.4);}",
    ".dz-unobs{display:inline-block;font:700 11.5px var(--dz-stamp);letter-spacing:.14em;color:var(--dz-ink-soft);",
    "margin-left:8px;vertical-align:1px;}",

    ".dz-kit{margin:0;padding:0 0 0 18px;font-size:13.5px;}",
    ".dz-kit li{margin:1px 0;}",

    ".dz-brief p{margin:0 0 10px;white-space:pre-wrap;}",
    ".dz-brief p.dz-typing:after{content:'_';animation:dz-caret .5s steps(1) infinite;}",
    "@keyframes dz-caret{50%{opacity:0}}",

    // routine timeline
    ".dz-tl{position:relative;margin:0;padding:2px 0 2px 26px;list-style:none;}",
    ".dz-tl:before{content:'';position:absolute;left:8px;top:6px;bottom:6px;width:2px;background:rgba(29,27,24,.55);}",
    ".dz-tl li{position:relative;margin:0 0 10px;}",
    ".dz-node{position:absolute;left:-24px;top:4px;width:12px;height:12px;border-radius:50%;box-sizing:border-box;",
    "border:2px solid var(--dz-ink);background:var(--dz-paper);}",
    ".dz-tl li.dz-now .dz-node{background:var(--dz-red);border-color:var(--dz-red);box-shadow:0 0 0 3px rgba(168,32,26,.18);}",
    ".dz-tl li.dz-unseen .dz-node{border-style:dashed;border-color:var(--dz-ink-soft);}",
    ".dz-tlhead{font-weight:700;}",
    ".dz-dur{font-size:12.5px;color:var(--dz-ink-soft);margin-left:6px;}",
    ".dz-nowtag{display:inline-block;font:700 11px/1 var(--dz-stamp);letter-spacing:.16em;color:#fff;background:var(--dz-red);",
    "padding:3px 5px 2px;margin-left:8px;vertical-align:2px;}",
    ".dz-tldet{font-size:13.5px;color:var(--dz-ink-soft);}",

    ".dz-rows{margin:0;padding:0;list-style:none;}",
    ".dz-rows li{padding:3px 0 5px;border-bottom:1px dotted rgba(0,0,0,.18);font-size:13.5px;}",
    ".dz-rows b{font-weight:700;margin-right:6px;}",
    ".dz-used .dz-strike{text-decoration:line-through;text-decoration-color:var(--dz-blue);text-decoration-thickness:2px;opacity:.7;}",
    ".dz-check{display:inline-block;margin-left:8px;color:var(--dz-blue);font:italic 700 17px/1 'Bradley Hand','Segoe Print',",
    "'Comic Neue',cursive;transform:rotate(-8deg);}",

    // field notes: handwritten, blue-black
    ".dz-notes{margin:4px 0 0;padding:0;list-style:none;}",
    ".dz-notes li{color:var(--dz-blue);font:italic 15px/1.45 'Bradley Hand','Segoe Print','Noteworthy','Comic Neue',",
    "Georgia,serif;margin:0 0 4px;transform:rotate(-.8deg);transform-origin:left center;}",
    ".dz-notes li:nth-child(even){transform:rotate(.5deg) translateX(6px);}",

    ".dz-footer{margin-top:18px;padding-top:8px;border-top:1px solid rgba(0,0,0,.3);font-size:12px;",
    "color:var(--dz-ink-soft);letter-spacing:.06em;}",

    // rubber stamp
    ".dz-stamp{position:absolute;pointer-events:none;font:700 44px/1 var(--dz-stamp);letter-spacing:.12em;",
    "color:var(--dz-red-soft);border:5px double var(--dz-red-soft);padding:8px 16px 4px;text-transform:uppercase;",
    "white-space:nowrap;mix-blend-mode:multiply;opacity:.88;border-radius:4px;",
    "-webkit-mask-image:repeating-radial-gradient(circle at 37% 61%,#000 0 3px,rgba(0,0,0,.72) 3px 4px);",
    "mask-image:repeating-radial-gradient(circle at 37% 61%,#000 0 3px,rgba(0,0,0,.72) 3px 4px);}",
    ".dz-sheet>.dz-stamp{top:42%;left:50%;transform:translate(-50%,-50%) rotate(-9deg);z-index:2;animation:dz-thump .28s ease-out;}",
    "@keyframes dz-thump{from{opacity:0;transform:translate(-50%,-50%) rotate(-9deg) scale(1.6)}",
    "to{opacity:.88;transform:translate(-50%,-50%) rotate(-9deg) scale(1)}}",
    "@media (max-width:640px){.dz-stamp{font-size:30px}.dz-sheet>.dz-stamp{top:220px}}",

    // confirm card
    ".dz-cf{position:fixed;left:50%;bottom:calc(12vh + env(safe-area-inset-bottom));z-index:58;width:min(92vw,420px);",
    "transform:translateX(-50%);display:none;pointer-events:none;}",
    ".dz-cf.dz-on{display:block;}",
    ".dz-card{position:relative;pointer-events:auto;cursor:pointer;box-sizing:border-box;padding:16px 18px 14px;",
    "color:var(--dz-ink);font:14px/1.45 var(--dz-type);background-color:var(--dz-paper);",
    "background-image:radial-gradient(ellipse at 85% 90%,rgba(120,90,40,.16),transparent 60%),",
    "repeating-linear-gradient(0deg,transparent 0 23px,var(--dz-rule) 23px 24px),linear-gradient(180deg,var(--dz-paper),var(--dz-paper2));",
    "box-shadow:0 0 0 1px rgba(0,0,0,.3),0 18px 40px rgba(0,0,0,.55);transform:rotate(-1deg);",
    "animation:dz-slam .22s cubic-bezier(.2,.9,.3,1.2);display:grid;grid-template-columns:96px 1fr;gap:14px;}",
    "@keyframes dz-slam{from{opacity:0;transform:scale(1.15) rotate(2deg)}to{opacity:1;transform:rotate(-1deg)}}",
    ".dz-cfphoto{position:relative;width:96px;height:128px;background:#262421;border:4px solid #fbfaf6;",
    "box-shadow:0 2px 5px rgba(0,0,0,.35);transform:rotate(-2deg);overflow:hidden;}",
    ".dz-cfphoto img{width:100%;height:100%;object-fit:cover;display:block;filter:grayscale(.3) sepia(.1);}",
    ".dz-cfphoto svg{position:absolute;inset:0;width:100%;height:100%;}",
    ".dz-cfphoto line{stroke:var(--dz-red);stroke-width:7;stroke-linecap:round;stroke-dasharray:160;stroke-dashoffset:160;",
    "animation:dz-draw .18s ease-out forwards;}",
    ".dz-cfphoto line+line{animation-delay:.14s;}",
    "@keyframes dz-draw{to{stroke-dashoffset:0}}",
    ".dz-cfop{font:700 11.5px var(--dz-stamp);letter-spacing:.2em;color:var(--dz-ink-soft);}",
    ".dz-cfname{font-weight:700;font-size:17px;text-transform:uppercase;letter-spacing:.03em;margin:2px 0 6px;overflow-wrap:anywhere;}",
    ".dz-cfrate{font:700 12.5px var(--dz-stamp);letter-spacing:.16em;}",
    ".dz-cfpay{font-weight:700;font-size:15px;margin-top:2px;}",
    ".dz-cflines{margin:6px 0 0;padding:0;list-style:none;font-size:13px;}",
    ".dz-cflines li:before{content:'[x] ';color:var(--dz-ink-soft);}",
    ".dz-card>.dz-stamp{font-size:28px;right:10px;top:12px;transform:rotate(-11deg);border-width:4px;padding:5px 10px 2px;",
    "opacity:0;animation:dz-thump2 .22s ease-out .35s forwards;}",
    "@keyframes dz-thump2{from{opacity:0;transform:rotate(-11deg) scale(1.7)}to{opacity:.88;transform:rotate(-11deg) scale(1)}}",

    // letterbox
    ".dz-lb{position:fixed;left:0;right:0;height:11vh;background:#000;z-index:55;pointer-events:none;",
    "transition:transform .45s ease;will-change:transform;}",
    ".dz-lb-top{top:0;transform:translateY(-101%);}",
    ".dz-lb-bot{bottom:0;transform:translateY(101%);}",
    ".dz-lb.dz-on{transform:translateY(0);}",

    // FILE button
    ".dz-btn{position:fixed;left:12px;top:calc(96px + env(safe-area-inset-top));z-index:50;min-width:56px;min-height:44px;",
    "display:none;align-items:center;justify-content:center;padding:0 12px;box-sizing:border-box;cursor:pointer;",
    "font:700 13px/1 var(--dz-stamp);letter-spacing:.2em;color:var(--dz-ink);border:1px solid rgba(0,0,0,.45);",
    "border-radius:2px;background:linear-gradient(180deg,#f1ead8,#ddd1b4);box-shadow:0 3px 10px rgba(0,0,0,.4);",
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation;}",
    ".dz-btn.dz-on{display:flex;}",
    ".dz-btn .dz-badge{position:absolute;top:-4px;right:-4px;width:12px;height:12px;border-radius:50%;background:var(--dz-red);",
    "box-shadow:0 0 0 2px #f1ead8;display:none;}",
    ".dz-btn.dz-hasbadge .dz-badge{display:block;}",

    // ending card
    ".dz-end{position:fixed;inset:0;z-index:65;display:none;align-items:center;justify-content:center;",
    "background:radial-gradient(ellipse at center,rgba(0,0,0,.72),rgba(0,0,0,.94));}",
    ".dz-end.dz-on{display:flex;}",
    ".dz-endsheet{position:relative;width:min(92vw,560px);max-height:88vh;overflow-y:auto;-webkit-overflow-scrolling:touch;",
    "box-sizing:border-box;padding:34px 30px 26px;color:var(--dz-ink);font:15px/1.6 var(--dz-type);text-align:left;",
    "background-color:var(--dz-paper);background-image:radial-gradient(ellipse at 80% 90%,rgba(120,90,40,.18),transparent 60%),",
    "repeating-linear-gradient(0deg,transparent 0 25px,var(--dz-rule) 25px 26px),linear-gradient(180deg,var(--dz-paper),var(--dz-paper2));",
    "box-shadow:0 0 0 1px rgba(0,0,0,.3),0 30px 80px rgba(0,0,0,.7);animation:dz-fade .9s ease-out;}",
    "@keyframes dz-fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}",
    ".dz-endtitle{font:700 30px/1.1 var(--dz-stamp);letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px;}",
    ".dz-endsub{font-size:13px;letter-spacing:.14em;color:var(--dz-ink-soft);text-transform:uppercase;margin-bottom:16px;",
    "border-bottom:2px solid var(--dz-ink);padding-bottom:10px;}",
    ".dz-endbody{display:flex;gap:18px;align-items:flex-start;}",
    ".dz-endbody .dz-photo{margin-top:6px;flex:none;}",
    ".dz-endlines p{margin:0 0 10px;}",
    ".dz-endsheet>.dz-stamp{top:46%;left:50%;transform:translate(-50%,-50%) rotate(-9deg);animation:dz-thump .3s ease-out .6s both;}",
    ".dz-endbtn{display:block;margin:22px auto 0;min-height:44px;padding:0 22px;cursor:pointer;",
    "font:700 13px/44px var(--dz-stamp);letter-spacing:.24em;color:var(--dz-paper);background:var(--dz-ink);border:0;border-radius:2px;}",
    "@media (max-width:640px){.dz-endbody{flex-direction:column}.dz-endtitle{font-size:24px}.dz-endsheet{padding:28px 16px 20px}}",

    "@media (prefers-reduced-motion:reduce){.dz-sheet,.dz-card,.dz-endsheet,.dz-stamp,.dz-sheet>.dz-stamp,",
    ".dz-card>.dz-stamp,.dz-endsheet>.dz-stamp,.dz-cfphoto line,.dz-brief p.dz-typing:after{animation:none!important;}",
    ".dz-card>.dz-stamp{opacity:.88;}.dz-cfphoto line{stroke-dashoffset:0;}.dz-lb{transition:none;}}"
  ].join("");

  // ---------- build ----------
  function build() {
    if (built) return true;
    if (typeof document === "undefined" || !document.body) return false;
    if (!document.getElementById("dossierCss")) {
      var st = document.createElement("style");
      st.id = "dossierCss";
      st.textContent = CSS;
      (document.head || document.body).appendChild(st);
    }
    // dossier
    var bd = el("div", "dz-backdrop");
    bd.setAttribute("role", "dialog");
    bd.setAttribute("aria-modal", "true");
    var sheet = add(bd, el("div", "dz-sheet"));
    var x = el("button", "dz-x", "X");
    x.type = "button";
    x.setAttribute("aria-label", "Close file");
    bd.addEventListener("click", function (e) { if (e.target === bd) api.close(); });
    x.addEventListener("click", function (e) { e.stopPropagation(); api.close(); });
    document.body.appendChild(bd);
    nodes.backdrop = bd; nodes.sheet = sheet; nodes.x = x;

    // confirm card
    var cf = el("div", "dz-cf");
    document.body.appendChild(cf);
    nodes.cf = cf;

    // letterbox
    var lt = el("div", "dz-lb dz-lb-top"), lb = el("div", "dz-lb dz-lb-bot");
    document.body.appendChild(lt); document.body.appendChild(lb);
    nodes.lbTop = lt; nodes.lbBot = lb;

    // FILE button
    var btn = el("button", "dz-btn");
    btn.type = "button";
    var bl = add(btn, el("span", "dz-btnlabel", "FILE"));
    add(btn, el("span", "dz-badge"));
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof api.onButton === "function") { try { api.onButton(); } catch (err) { if (W.console) console.warn("[dossier] onButton", err); } }
      else api.toggle(lastFile);
    });
    document.body.appendChild(btn);
    nodes.btn = btn; nodes.btnLabel = bl;

    // ending
    var end = el("div", "dz-end");
    end.setAttribute("role", "dialog");
    end.setAttribute("aria-modal", "true");
    document.body.appendChild(end);
    nodes.end = end;

    installListeners();
    built = true;
    return true;
  }

  function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    W.addEventListener("keydown", function (e) {
      var k = e.key;
      var isEsc = k === "Escape" || k === "Esc";
      if (isOpenFlag && isEsc) {
        e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.preventDefault();
        api.close();
        return;
      }
      if (endingShown && isEsc) {
        e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.preventDefault();
        return; // the ending only closes through its button
      }
      if (confirmShown && (isEsc || k === "Enter")) hideConfirm();
    }, false);
  }

  // ---------- menu / pointer lock ----------
  function holdMenu(who) {
    if (!CBZ.cityMenuOpen) { CBZ.cityMenuOpen = true; menuHeldBy[who] = true; }
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    var keys = CBZ.keys;
    if (keys && typeof keys === "object") {
      for (var kk in keys) { if (Object.prototype.hasOwnProperty.call(keys, kk) && keys[kk]) keys[kk] = false; }
    }
  }
  function releaseMenu(who) {
    if (!menuHeldBy[who]) return;
    menuHeldBy[who] = false;
    // hand the flag to the other surface if it is still up
    if (who === "dossier" && endingShown) { menuHeldBy.ending = true; return; }
    if (who === "ending" && isOpenFlag) { menuHeldBy.dossier = true; return; }
    CBZ.cityMenuOpen = false;
  }

  // ---------- dossier render ----------
  function section(parent, label) { add(parent, el("div", "dz-label", label)); }

  function renderStamp(parent, text) {
    if (!text) return;
    add(parent, el("div", "dz-stamp", String(text)));
  }

  function renderPhoto(parent, photo) {
    var wrap = el("div", "dz-photo");
    add(wrap, el("span", "dz-clip"));
    if (photo) {
      var img = el("img");
      img.alt = "";
      img.src = photo;
      add(wrap, img);
    } else {
      add(wrap, el("div", "dz-nophoto", "NO PHOTOGRAPH"));
    }
    add(parent, wrap);
    return wrap;
  }

  function render(file, animate) {
    var sheet = nodes.sheet;
    stopTyping(true);
    clear(sheet);
    add(sheet, nodes.x);
    var f = file || {};
    var subj = f.subject || {};

    // header
    var head = add(sheet, el("div", "dz-head"));
    var hl = add(head, el("div"));
    add(hl, el("div", "dz-class", str(f.classification || "EYES ONLY")));
    var cn = str(f.codename).trim();
    add(hl, el("h2", "dz-code", cn ? "OPERATION " + cn.toUpperCase() : "OPERATION"));
    if (f.opLabel) add(head, el("div", "dz-oplabel", str(f.opLabel)));

    var cols = add(sheet, el("div", "dz-cols"));
    var L = add(cols, el("div", "dz-col"));
    var R = add(cols, el("div", "dz-col"));

    // left: subject
    section(L, "SUBJECT");
    renderPhoto(L, subj.photo);
    if (f.identified === true) add(L, el("div", "dz-idline dz-yes", "IDENTIFIED"));
    else if (f.identified === false) add(L, el("div", "dz-idline dz-no", "NOT YET IDENTIFIED"));
    if (subj.note) add(L, el("div", "dz-pnote", str(subj.note)));
    add(L, el("div", "dz-name", str(subj.name || "UNKNOWN")));
    if (subj.role) add(L, el("div", "dz-role", str(subj.role)));

    if (f.status) {
      section(L, "STATUS");
      var s = String(f.status).toUpperCase();
      add(L, el("span", "dz-status dz-st-" + s.replace(/[^A-Z]/g, ""), s));
    }

    var facts = arr(f.facts);
    if (facts.length) {
      var dl = add(L, el("dl", "dz-facts"));
      if (!f.status) dl.style.marginTop = "12px";
      for (var i = 0; i < facts.length; i++) {
        var fa = facts[i] || {};
        var row = add(dl, el("div", "dz-fact"));
        add(row, el("dt", "", str(fa.k)));
        var dd = add(row, el("dd"));
        if (fa.redacted) add(dd, redactBar(str(fa.v).length || 10));
        else dd.textContent = str(fa.v);
      }
    }

    var kit = arr(f.kit);
    if (kit.length) {
      section(L, "KIT");
      var ul = add(L, el("ul", "dz-kit"));
      for (var ki = 0; ki < kit.length; ki++) add(ul, el("li", "", str(kit[ki])));
    }

    // right: brief
    var brief = arr(f.brief);
    var typeTargets = [];
    if (brief.length) {
      section(R, "BRIEF");
      var bw = add(R, el("div", "dz-brief"));
      for (var bi = 0; bi < brief.length; bi++) {
        var p = add(bw, el("p", "", str(brief[bi])));
        typeTargets.push({ el: p, text: str(brief[bi]) });
      }
    }

    // routine timeline
    var routine = arr(f.routine);
    if (routine.length) {
      section(R, "ROUTINE");
      var tl = add(R, el("ol", "dz-tl"));
      for (var ri = 0; ri < routine.length; ri++) {
        var r = routine[ri] || {};
        var seen = r.seen !== false;
        var li = add(tl, el("li", seen ? (r.now ? "dz-now" : "") : "dz-unseen"));
        add(li, el("span", "dz-node"));
        var h = add(li, el("div", "dz-tlhead"));
        add(h, el("span", "", str(r.label || "Unknown")));
        if (seen && r.dur) add(h, el("span", "dz-dur", str(r.dur)));
        if (seen && r.now) add(h, el("span", "dz-nowtag", "NOW"));
        var det = add(li, el("div", "dz-tldet"));
        if (seen) det.textContent = str(r.detail);
        else { add(det, redactBar(str(r.detail).length || 16)); add(det, el("span", "dz-unobs", "UNOBSERVED")); }
      }
    }

    // security
    var sec = arr(f.security);
    if (sec.length) {
      section(R, "SECURITY");
      var su = add(R, el("ul", "dz-rows"));
      for (var si = 0; si < sec.length; si++) {
        var sc = sec[si] || {};
        var sl = add(su, el("li"));
        add(sl, el("b", "", str(sc.label)));
        if (sc.seen === false) add(sl, redactBar(str(sc.detail).length || 18));
        else add(sl, el("span", "", str(sc.detail)));
      }
    }

    // approaches
    var ap = arr(f.approaches);
    if (ap.length) {
      section(R, "APPROACHES");
      var au = add(R, el("ul", "dz-rows"));
      for (var ai = 0; ai < ap.length; ai++) {
        var a = ap[ai] || {};
        var known = a.known !== false;
        var al = add(au, el("li", known && a.used ? "dz-used" : ""));
        if (!known) {
          add(al, el("b", "", str(a.label || "Unknown")));
          add(al, redactBar(str(a.detail).length || 20));
          continue;
        }
        var strike = add(al, el("span", "dz-strike"));
        add(strike, el("b", "", str(a.label)));
        if (a.detail) add(strike, el("span", "", str(a.detail)));
        if (a.used) add(al, el("span", "dz-check", "✓"));
      }
    }

    // field notes (newest last, max 8)
    var notes = arr(f.notes);
    if (notes.length) {
      section(R, "FIELD NOTES");
      var nu = add(R, el("ul", "dz-notes"));
      var start = Math.max(0, notes.length - 8);
      for (var ni = start; ni < notes.length; ni++) add(nu, el("li", "", str(notes[ni])));
    }

    if (f.footer) add(sheet, el("div", "dz-footer", str(f.footer)));
    renderStamp(sheet, f.stamp);

    if (animate && typeTargets.length && !reducedMotion()) startTyping(typeTargets);
  }

  // ---------- typewriter (one rAF loop, only while revealing) ----------
  function startTyping(targets) {
    var total = 0;
    for (var i = 0; i < targets.length; i++) { total += targets[i].text.length; targets[i].el.textContent = ""; }
    if (!total || typeof W.requestAnimationFrame !== "function") { stopTyping(true, targets); return; }
    var dur = Math.min(900, (total / 600) * 1000);
    var t0 = 0;
    typeJobs = targets;
    targets[0].el.className = "dz-typing";
    function step(ts) {
      if (!t0) t0 = ts;
      var k = dur > 0 ? Math.min(1, (ts - t0) / dur) : 1;
      var shown = Math.floor(total * k);
      for (var j = 0; j < targets.length; j++) {
        var t = targets[j];
        var n = Math.max(0, Math.min(t.text.length, shown));
        if (t.el.textContent.length !== n) t.el.textContent = t.text.slice(0, n);
        var active = shown > 0 && shown < t.text.length;
        var cls = active || (j === 0 && shown === 0) ? "dz-typing" : "";
        if (t.el.className !== cls) t.el.className = cls;
        shown -= t.text.length;
      }
      if (k < 1) typeRaf = W.requestAnimationFrame(step);
      else { typeRaf = 0; stopTyping(true); }
    }
    typeRaf = W.requestAnimationFrame(step);
  }
  function stopTyping(finish, list) {
    if (typeRaf && W.cancelAnimationFrame) W.cancelAnimationFrame(typeRaf);
    typeRaf = 0;
    var jobs = list || typeJobs;
    if (finish && jobs) {
      for (var i = 0; i < jobs.length; i++) { jobs[i].el.textContent = jobs[i].text; jobs[i].el.className = ""; }
    }
    typeJobs = null;
  }

  // ---------- confirm card ----------
  function hideConfirm() {
    if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = 0; }
    confirmShown = false;
    if (nodes.cf) { nodes.cf.classList.remove("dz-on"); clear(nodes.cf); }
  }

  function showConfirm(info) {
    if (!build()) return;
    hideConfirm();
    var d = info || {};
    var card = el("div", "dz-card");
    card.setAttribute("role", "status");
    var ph = add(card, el("div", "dz-cfphoto"));
    if (d.photo) { var img = el("img"); img.alt = ""; img.src = d.photo; add(ph, img); }
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 96 128");
    svg.setAttribute("preserveAspectRatio", "none");
    var l1 = document.createElementNS(svgNS, "line");
    l1.setAttribute("x1", "8"); l1.setAttribute("y1", "10"); l1.setAttribute("x2", "88"); l1.setAttribute("y2", "118");
    var l2 = document.createElementNS(svgNS, "line");
    l2.setAttribute("x1", "88"); l2.setAttribute("y1", "10"); l2.setAttribute("x2", "8"); l2.setAttribute("y2", "118");
    svg.appendChild(l1); svg.appendChild(l2);
    ph.appendChild(svg);

    var body = add(card, el("div"));
    var cn = str(d.codename).trim();
    add(body, el("div", "dz-cfop", cn ? "OPERATION " + cn.toUpperCase() : "THE BUREAU"));
    add(body, el("div", "dz-cfname", str(d.name || "SUBJECT")));
    if (d.rating) add(body, el("div", "dz-cfrate", "RATING: " + String(d.rating).toUpperCase()));
    if (typeof d.pay === "number" && isFinite(d.pay)) {
      var amt;
      try { amt = Math.round(d.pay).toLocaleString("en-US"); } catch (e) { amt = String(Math.round(d.pay)); }
      add(body, el("div", "dz-cfpay", "$" + amt));
    }
    var lines = arr(d.lines);
    if (lines.length) {
      var ul = add(body, el("ul", "dz-cflines"));
      for (var i = 0; i < lines.length && i < 6; i++) add(ul, el("li", "", str(lines[i])));
    }
    renderStamp(card, "CONFIRMED");
    card.addEventListener("click", function (e) { e.stopPropagation(); hideConfirm(); });
    card.addEventListener("touchend", function (e) { e.preventDefault(); hideConfirm(); });

    nodes.cf.appendChild(card);
    nodes.cf.classList.add("dz-on");
    confirmShown = true;
    confirmTimer = setTimeout(hideConfirm, 5000);
  }

  // ---------- ending ----------
  function hideEnding(fire) {
    if (!endingShown) return;
    endingShown = false;
    var info = endingInfo; endingInfo = null;
    if (nodes.end) { nodes.end.classList.remove("dz-on"); clear(nodes.end); }
    releaseMenu("ending");
    if (fire && info && typeof info.onClose === "function") {
      try { info.onClose(); } catch (e) { if (W.console) console.warn("[dossier] ending onClose", e); }
    }
  }

  function showEnding(info) {
    if (!build()) return;
    var d = info || {};
    endingInfo = d;
    var end = nodes.end;
    clear(end);
    var sh = add(end, el("div", "dz-endsheet"));
    add(sh, el("div", "dz-class", "EYES ONLY"));
    add(sh, el("h2", "dz-endtitle", str(d.title || "FILE CLOSED")));
    add(sh, el("div", "dz-endsub", str(d.subtitle || "THE BUREAU")));
    var body = add(sh, el("div", "dz-endbody"));
    if (d.photo) renderPhoto(body, d.photo);
    var ls = add(body, el("div", "dz-endlines"));
    var lines = arr(d.lines);
    for (var i = 0; i < lines.length; i++) add(ls, el("p", "", str(lines[i])));
    renderStamp(sh, d.stamp);
    var b = add(sh, el("button", "dz-endbtn", "CLOSE FILE"));
    b.type = "button";
    b.addEventListener("click", function (e) { e.stopPropagation(); hideEnding(true); });
    end.classList.add("dz-on");
    endingShown = true;
    holdMenu("ending");
    try { b.focus({ preventScroll: true }); } catch (e) {}
  }

  // ---------- public API ----------
  var api = {
    open: function (file) {
      if (file) lastFile = file;
      if (!build()) return;
      var wasOpen = isOpenFlag;
      render(lastFile, !wasOpen);
      nodes.backdrop.classList.add("dz-on");
      nodes.sheet.scrollTop = wasOpen ? nodes.sheet.scrollTop : 0;
      isOpenFlag = true;
      holdMenu("dossier");
    },
    update: function (file) {
      if (file) lastFile = file;
      if (!isOpenFlag || !built) return;
      var top = nodes.sheet.scrollTop;
      render(lastFile, false);
      nodes.sheet.scrollTop = top;
    },
    close: function () {
      if (!isOpenFlag) return;
      isOpenFlag = false;
      stopTyping(false);
      if (nodes.backdrop) nodes.backdrop.classList.remove("dz-on");
      releaseMenu("dossier");
    },
    isOpen: function () { return isOpenFlag; },
    toggle: function (file) {
      if (isOpenFlag) api.close();
      else api.open(file || lastFile);
    },
    confirm: function (info) { showConfirm(info); },
    letterbox: function (on) {
      if (!build()) return;
      var m = on ? "add" : "remove";
      nodes.lbTop.classList[m]("dz-on");
      nodes.lbBot.classList[m]("dz-on");
    },
    button: function (state) {
      if (!build()) return;
      var btn = nodes.btn;
      if (!state) { btn.classList.remove("dz-on"); return; }
      nodes.btnLabel.textContent = str(state.label || "FILE");
      btn.setAttribute("aria-label", str(state.label || "FILE"));
      btn.classList.toggle("dz-hasbadge", !!state.badge);
      btn.classList.add("dz-on");
    },
    ending: function (info) { showEnding(info); },
    onButton: null
  };

  CBZ.dossier = api;
  CBZ.dossierAudit = function () {
    return {
      built: built,
      open: isOpenFlag,
      lastCodename: lastFile && lastFile.codename != null ? String(lastFile.codename) : null
    };
  };
})();
