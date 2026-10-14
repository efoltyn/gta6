/* tools/shot/page/lab.js — the IN-PAGE half of the shot service for the LAB
   (lab.html, src/lab/labworld.js). Same contract as page/world.js and
   page/npcwar.js: window.__shot.stage(spec) / at(t) / shot(cam, W, H, fmt) /
   clear(), plus probe() (the kit's numbers). Everything is window.__lab's:
   at(t) runs the kit's fixed-dt sim to t (its script fires on its times),
   shot() is __lab.capture (cams: 3q side front back top wide close
   follow:<name> orbit:<yaw>:<pitch>[:distMul] at:<x,y,z>:<lx,ly,lz>).
   stage() reports the kit's duration as the "period", so a preset's
   `cycle:N` is N frames evenly across the kit's run. */
(function () {
  "use strict";
  var V = "dev";   // the daemon stamps a content hash here
  if (window.__shot && window.__shot.v === V) return true;
  var L = window.__lab;
  if (!L || !L.boot) return false;
  var S = window.__shot = { v: V };
  S.stage = function (spec) {
    if (!L.ready) return { ok: false, error: "lab kit '" + L.kitName + "' did not boot: " + (L.error || "?") + (L.boot && L.boot.loadErrors && L.boot.loadErrors.length ? " | load errors: " + L.boot.loadErrors.slice(0, 3).join(" | ") : "") };
    if (spec && spec.js) {
      try { new Function("W", "L", "CBZ", "THREE", "spec", spec.js)(L.W, L, window.CBZ, window.THREE, spec); }
      catch (e) { return { ok: false, error: "setup js threw: " + (e && e.message || e) }; }
    }
    var dur = (L.kit && L.kit.duration) || 5;
    var warn = [];
    if (L.boot.loadErrors && L.boot.loadErrors.length) warn.push("load errors: " + L.boot.loadErrors.slice(0, 3).join(" | "));
    warn.push("info lab " + L.kitName + ": " + L.boot.scripts + " scripts of " + L.boot.indexCount + ", boot " + L.boot.ms + " ms");
    return { ok: true, period: dur, warn: warn };
  };
  S.at = function (t) { if (+t > L.t) L.runTo(+t); return { t: L.t }; };
  S.shot = function (cam, W, H, fmt) { return L.capture(cam, W, H, fmt); };
  S.probe = function () {
    if (L.kit && L.kit.duration && L.t < L.kit.duration) L.runTo(L.kit.duration);
    var r = L.probe();
    r.events = (r.events || []).slice(0, 120);
    return r;
  };
  S.clear = function () { return true; };   // a stepped lab page is closed by the daemon (cheap to reboot)
  S.cams = ["3q", "side", "front", "back", "top", "wide", "close", "follow:<name>", "orbit:<yaw>:<pitch>[:distMul]", "at:<x,y,z>:<lx,ly,lz>"];
  return true;
})();
