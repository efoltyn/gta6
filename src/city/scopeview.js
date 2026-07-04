/* ============================================================
   city/scopeview.js — LOOKING THROUGH THE SCOPE.

   When you hold aim (RMB / controller LT) with an optic fitted (city/gunmods.js
   sold it, bolted it to your gun), this is what you SEE:

     • the LENS ZOOMS — cityScopeFov() feeds systems/camera.js (over-shoulder)
       and systems/fpsmode.js (first-person) a much tighter FOV than plain ADS.
       A red-dot barely nudges it; a 4× ACOG pulls in real; an 8× sniper scope
       slams it to a hair.
     • the RETICLE appears — a glowing dot / reflex ring / holo chevron for the
       1× optics, or the full blacked-out SCOPE RING + mil-dot crosshair for the
       magnified optics (with a white-hot THERMAL wash for the thermal scope).
     • magnified optics SNAP to first person (the GTA sniper feel), so the zoomed
       image is a clean down-the-barrel view, not an over-shoulder crop; release
       aim and you fall straight back to where you were.

   Pure overlay + FOV: it never touches the shot math (systems/fpsmode.js already
   fires down the crosshair), so aiming through glass stays honest. City-gated,
   headless-guarded, zero per-frame allocation.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- is a scope live right now? (shared by the FOV hook + the overlay) ----
  function currentScope() {
    if (!g || g.mode !== "city" || g.state !== "playing") return null;
    if (!(CBZ.isADS && CBZ.isADS())) return null;
    const P = CBZ.player;
    if (P && (P.dead || P.driving)) return null;
    const id = CBZ.currentWeaponId;
    if (!id || !CBZ.gunModsScopeOf) return null;
    return CBZ.gunModsScopeOf(id);   // { id,name,fov,overlay,highMag?,thermal?,tint } | null
  }

  // ---- the FOV hook read every frame by camera.js (shoulder) + fpsmode (FP) --
  CBZ.cityScopeFov = function () { const s = currentScope(); return s ? s.fov : null; };
  // true when a MAGNIFIED optic is live — systems/gamepad.js reads this to slow
  // the right-stick look right down for fine long-range aim.
  CBZ.cityScopeHigh = function () { const s = currentScope(); return !!(s && s.highMag); };

  if (typeof document === "undefined") return;   // headless: FOV hook only

  // ==========================================================================
  //  OVERLAY
  // ==========================================================================
  let root = null, ring = null, retic = null, curType = "";
  function build() {
    if (root || !document.body) return;
    root = document.createElement("div");
    root.id = "scopeOverlay";
    root.style.cssText = "position:fixed;inset:0;z-index:44;display:none;pointer-events:none;overflow:hidden";
    // the blacked-out ring (magnified optics only)
    ring = document.createElement("div");
    ring.id = "scopeRing";
    ring.style.cssText = "position:absolute;inset:0;display:none";
    root.appendChild(ring);
    // the reticle layer (rebuilt when the optic type changes)
    retic = document.createElement("div");
    retic.id = "scopeReticle";
    retic.style.cssText = "position:absolute;inset:0";
    root.appendChild(retic);
    document.body.appendChild(root);
  }

  // full sniper ring: transparent circle, hard black surround, thin bezel.
  function ringHTML(thermal) {
    const glass = thermal
      ? "radial-gradient(circle at 50% 50%, rgba(255,150,60,.10) 0, rgba(255,120,30,.05) 24vmin, rgba(0,0,0,0) 33vmin, rgba(3,2,0,.99) 33.6vmin)"
      : "radial-gradient(circle at 50% 50%, rgba(120,160,200,.05) 0, rgba(0,0,0,0) 33vmin, rgba(0,0,0,.99) 33.6vmin)";
    return "<div style='position:absolute;inset:0;background:" + glass + "'></div>" +
      "<div style='position:absolute;left:50%;top:50%;width:66vmin;height:66vmin;transform:translate(-50%,-50%);" +
      "border-radius:50%;border:2px solid rgba(10,10,12,.9);box-shadow:0 0 0 1px rgba(60,70,80,.4) inset, 0 0 40px rgba(0,0,0,.6) inset'></div>";
  }
  // magnified crosshair: fine cross + centre dot + mil ticks, tinted per optic.
  function crosshairHTML(tint) {
    const c = tint || "rgba(15,20,24,.85)";
    const line = "position:absolute;background:" + c + ";";
    return (
      "<div style='" + line + "left:50%;top:calc(50% - 33vmin);width:1px;height:66vmin;transform:translateX(-.5px)'></div>" +
      "<div style='" + line + "top:50%;left:calc(50% - 33vmin);height:1px;width:66vmin;transform:translateY(-.5px)'></div>" +
      "<div style='position:absolute;left:50%;top:50%;width:4px;height:4px;border-radius:50%;background:" + c + ";transform:translate(-50%,-50%)'></div>" +
      tick(c, 0, -8) + tick(c, 0, 8) + tick(c, -8, 0) + tick(c, 8, 0) +
      tick(c, 0, -16) + tick(c, 0, 16) + tick(c, -16, 0) + tick(c, 16, 0)
    );
  }
  function tick(c, dxV, dyV) {
    // small mil dot at ±(dx,dy) vmin from centre along an axis
    return "<div style='position:absolute;left:calc(50% + " + dxV + "vmin);top:calc(50% + " + dyV + "vmin);width:3px;height:3px;border-radius:50%;background:" + c + ";transform:translate(-50%,-50%)'></div>";
  }
  // 1× optics: a compact centre reticle, no blackout.
  function dotHTML(tint) {
    return "<div style='position:absolute;left:50%;top:50%;width:10px;height:10px;border-radius:50%;transform:translate(-50%,-50%);" +
      "background:" + tint + ";box-shadow:0 0 8px " + tint + ",0 0 2px #fff'></div>";
  }
  function reflexHTML(tint) {
    return "<div style='position:absolute;left:50%;top:50%;width:56px;height:56px;border-radius:50%;transform:translate(-50%,-50%);" +
      "border:2px solid " + tint + ";box-shadow:0 0 10px " + tint + ",0 0 4px " + tint + " inset'></div>" +
      "<div style='position:absolute;left:50%;top:50%;width:6px;height:6px;border-radius:50%;transform:translate(-50%,-50%);background:" + tint + ";box-shadow:0 0 6px " + tint + "'></div>";
  }
  function holoHTML(tint) {
    return "<div style='position:absolute;left:50%;top:50%;width:64px;height:64px;border-radius:50%;transform:translate(-50%,-50%);" +
      "border:1px solid " + tint + ";box-shadow:0 0 8px " + tint + "'></div>" +
      "<div style='position:absolute;left:50%;top:calc(50% - 3px);transform:translate(-50%,-50%);color:" + tint + ";font-size:20px;line-height:1;text-shadow:0 0 6px " + tint + "'>▲</div>" +
      "<div style='position:absolute;left:50%;top:50%;width:5px;height:5px;border-radius:50%;transform:translate(-50%,-50%);background:" + tint + "'></div>";
  }
  function acogHTML(tint) {
    // 4× chevron + thin crosshair + a light vignette to sell the magnification
    return "<div style='position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 40vmin, rgba(0,0,0,.5) 60vmin)'></div>" +
      "<div style='position:absolute;left:50%;top:calc(50% - 40vmin);width:1px;height:80vmin;background:rgba(20,24,28,.6);transform:translateX(-.5px)'></div>" +
      "<div style='position:absolute;left:calc(50% - 40vmin);top:50%;height:1px;width:80vmin;background:rgba(20,24,28,.6);transform:translateY(-.5px)'></div>" +
      "<div style='position:absolute;left:50%;top:calc(50% - 2px);transform:translate(-50%,-50%);color:" + tint + ";font-size:18px;line-height:1;text-shadow:0 0 6px " + tint + "'>▲</div>";
  }

  function renderType(spec) {
    const type = spec.overlay + (spec.thermal ? "T" : "");
    if (type === curType) return;
    curType = type;
    const tint = spec.tint || "#ff5b5b";
    if (spec.highMag) {
      ring.style.display = "block";
      ring.innerHTML = ringHTML(!!spec.thermal);
      retic.innerHTML = crosshairHTML(spec.thermal ? "rgba(40,20,0,.9)" : "rgba(10,14,18,.9)");
    } else {
      ring.style.display = "none";
      ring.innerHTML = "";
      if (spec.overlay === "dot") retic.innerHTML = dotHTML(tint);
      else if (spec.overlay === "reflex") retic.innerHTML = reflexHTML(tint);
      else if (spec.overlay === "holo") retic.innerHTML = holoHTML(tint);
      else if (spec.overlay === "acog") retic.innerHTML = acogHTML(tint);
      else retic.innerHTML = dotHTML(tint);
    }
  }

  // thermal wash on the render canvas (cheap, stylised — the "white-hot" read).
  function canvasEl() { return (CBZ.renderer && CBZ.renderer.domElement) || CBZ.canvas || null; }
  let filterOn = false;
  function setThermal(on) {
    const cv = canvasEl(); if (!cv) return;
    if (on && !filterOn) { cv.style.filter = "grayscale(1) contrast(1.5) brightness(1.15) sepia(1) saturate(6) hue-rotate(-18deg)"; filterOn = true; }
    else if (!on && filterOn) { cv.style.filter = ""; filterOn = false; }
  }

  // ---- FP snap for magnified optics ---------------------------------------
  let forcedFP = false;
  function wantFP(spec) {
    return !!(spec && spec.highMag);
  }

  // ---- per-frame: run AFTER camera (50) + fpsmode (52) + city view (49) -----
  const crossEl = () => document.getElementById("crosshair");
  CBZ.onAlways(53, function () {
    const spec = currentScope();
    if (spec) {
      build();
      if (!root) return;
      renderType(spec);
      setThermal(!!spec.thermal);
      root.style.display = "block";
      // hide the default reticle while the optic's own reticle is up
      const cx = crossEl(); if (cx) cx.style.display = "none";
      // magnified optic → drop to first person for a clean down-scope image
      if (wantFP(spec)) {
        const P = CBZ.player;
        if (CBZ.fpsSetActive && CBZ.fpsActive && !CBZ.fpsActive() && !(P && (P.driving || P.dead))) {
          CBZ.fpsSetActive(true);
          forcedFP = true;
        }
      }
    } else {
      if (root && root.style.display !== "none") root.style.display = "none";
      curType = "";
      setThermal(false);
      // restore the first-person snap we forced
      if (forcedFP) {
        if (CBZ.fpsSetActive && CBZ.fpsActive && CBZ.fpsActive()) CBZ.fpsSetActive(false);
        forcedFP = false;
      }
    }
  });
})();
